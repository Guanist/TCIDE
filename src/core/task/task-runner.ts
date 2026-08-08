/**
 * PersonalIDE - TaskRunner
 * 全自动工程化任务闭环引擎：分解 → 执行 → 编译验证 → 修复 → 提交
 */
import { ModelAdapter } from '../model/adapter';
import { FileService } from '../../main/file-service';
import { Task } from '../agent/builder-agent';
import * as path from 'path';
import * as fs from 'fs';

/** 以参数数组方式执行命令（禁用 shell 字符串拼接，防命令注入） */
function runCommand(file: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process') as typeof import('child_process');
    const isWin = process.platform === 'win32';
    let actualFile = file;
    let actualArgs = args;
    if (isWin && (/\\.(bat|cmd)$/i.test(file) || ['npm', 'npx', 'yarn', 'pnpm', 'gradle', 'mvn'].includes(file))) {
      // Windows 下 .bat/.cmd 包装器需经 cmd.exe 执行（file 为固定命令或项目内固定路径）
      actualFile = process.env.ComSpec || 'cmd.exe';
      actualArgs = ['/d', '/s', '/c', file, ...args];
    }
    const proc = spawn(actualFile, actualArgs, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } }, timeoutMs);
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code: number) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err: any = new Error(`命令执行失败 (exit ${code})`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

export interface TaskProgress {
  taskId: string;
  status: 'pending' | 'running' | 'compiling' | 'fixing' | 'done' | 'failed';
  message: string;
  retryCount: number;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  output: string;
  compileOutput?: string;
  retries: number;
}

const MAX_RETRIES = 3;

export class TaskRunner {
  private aborted = false;

  constructor(
    private model: ModelAdapter,
    private fileService: FileService,
    private onProgress?: (progress: TaskProgress) => void
  ) {}

  async run(tasks: Task[], projectRoot: string): Promise<{ success: boolean; results: TaskResult[] }> {
    this.aborted = false;
    const results: TaskResult[] = [];
    const taskMap = new Map(tasks.map(t => [t.id, { ...t }]));

    // 拓扑排序：优先执行无依赖的任务
    const sorted = this.topologicalSort(tasks);
    const pending = [...sorted];
    const running: Array<{ taskId: string; promise: Promise<void> }> = [];

    // 并行度控制：文件操作可并行，编译类互斥
    const MAX_PARALLEL = 3;
    const compiling = new Set<string>();

    while (pending.length > 0 || running.length > 0) {
      if (this.aborted) {
        return { success: false, results };
      }

      // 依赖失败的子任务直接标记 failed 并移出 pending，防止死等
      const failedIds = new Set<string>(results.filter(r => !r.success).map(r => r.taskId));
      if (failedIds.size > 0) {
        for (let i = pending.length - 1; i >= 0; i--) {
          const t = pending[i];
          if (t.dep.some(depId => failedIds.has(depId))) {
            pending.splice(i, 1);
            const tmap = taskMap.get(t.id);
            if (tmap) tmap.status = 'failed';
            this.report({ taskId: t.id, status: 'failed', message: `依赖任务失败，跳过: ${t.desc}`, retryCount: t.retries });
            results.push({ taskId: t.id, success: false, output: '依赖任务失败，跳过', retries: t.retries });
          }
        }
      }

      while (pending.length > 0 && running.length < MAX_PARALLEL) {
        const task = pending[0];
        const depsDone = task.dep.every(depId => {
          const dep = taskMap.get(depId);
          return dep?.status === 'done';
        });

        if (depsDone && !compiling.has('build')) {
          pending.shift();
          const promise = this.runTask(task, projectRoot, results, taskMap, compiling);
          const entry = { taskId: task.id, promise };
          running.push(entry);
          promise.finally(() => {
            const idx = running.findIndex(r => r.promise === promise);
            if (idx >= 0) running.splice(idx, 1);
          });
        } else {
          break;
        }
      }

      if (running.length > 0) {
        await Promise.race(running.map(r => r.promise));
      } else if (pending.length > 0) {
        // 防御：running 为空但 pending 仍有任务（循环依赖/异常），标记 failed 防止死循环
        const leftover = pending.shift()!;
        const tmap = taskMap.get(leftover.id);
        if (tmap) tmap.status = 'failed';
        this.report({ taskId: leftover.id, status: 'failed', message: `无法执行（依赖缺失或循环依赖）: ${leftover.desc}`, retryCount: leftover.retries });
        results.push({ taskId: leftover.id, success: false, output: '无法执行（依赖缺失或循环依赖）', retries: leftover.retries });
      }
    }
    const allSuccess = results.every(r => r.success);
    return { success: allSuccess, results };
  }

  private async runTask(
    task: Task,
    projectRoot: string,
    results: TaskResult[],
    taskMap: Map<string, Task>,
    compiling: Set<string>
  ): Promise<void> {
    if (this.aborted) return;

    this.report({ taskId: task.id, status: 'running', message: `开始执行: ${task.desc}`, retryCount: task.retries });

    try {
      // 构建验证命令（自动检测项目类型）
      const buildCmd = this.detectBuildCommand(projectRoot);
      let compileOutput = '';

      if (buildCmd) {
        compiling.add('build');
        this.report({ taskId: task.id, status: 'compiling', message: `编译验证: ${buildCmd.type}`, retryCount: task.retries });

        try {
          const { stdout, stderr } = await runCommand(buildCmd.file, buildCmd.args, projectRoot, 180000);
          compileOutput = stdout + stderr;
        } catch (err: unknown) {
          const error = err as { stderr?: string; stdout?: string };

          // 编译失败 → 自动修复（最多 MAX_RETRIES 次）
          task.retries++;
          if (task.retries < MAX_RETRIES) {
            this.report({ taskId: task.id, status: 'fixing', message: `编译失败，尝试修复 (${task.retries}/${MAX_RETRIES})`, retryCount: task.retries });
            compileOutput = (error.stderr || '') + (error.stdout || '');

            // 用错误信息询问 Coder 修复
            const fixed = await this.tryFixCompileError(task, compileOutput, projectRoot);
            if (!fixed) {
              this.report({ taskId: task.id, status: 'failed', message: `修复失败，放弃任务`, retryCount: task.retries });
              results.push({ taskId: task.id, success: false, output: compileOutput, compileOutput, retries: task.retries });
              task.status = 'failed';
              compiling.delete('build');
              return;
            }

            // 重新编译
            try {
              const retry = await runCommand(buildCmd.file, buildCmd.args, projectRoot, 180000);
              compileOutput = retry.stdout + retry.stderr;
            } catch (retryErr: unknown) {
              const retryError = retryErr as { stderr?: string; stdout?: string };
              compileOutput = (retryError.stderr || '') + (retryError.stdout || '');
              this.report({ taskId: task.id, status: 'failed', message: `重试编译仍失败`, retryCount: task.retries });
              results.push({ taskId: task.id, success: false, output: compileOutput, compileOutput, retries: task.retries });
              task.status = 'failed';
              compiling.delete('build');
              return;
            }
          } else {
            this.report({ taskId: task.id, status: 'failed', message: `达到最大重试次数`, retryCount: task.retries });
            results.push({ taskId: task.id, success: false, output: (error.stderr || '').slice(0, 5000), compileOutput, retries: task.retries });
            task.status = 'failed';
            compiling.delete('build');
            return;
          }
        }

        compiling.delete('build');
      }

      task.status = 'done';
      this.report({ taskId: task.id, status: 'done', message: `任务完成: ${task.desc}`, retryCount: task.retries });
      results.push({ taskId: task.id, success: true, output: 'OK', compileOutput, retries: task.retries });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.report({ taskId: task.id, status: 'failed', message: `任务异常: ${msg}`, retryCount: task.retries });
      results.push({ taskId: task.id, success: false, output: msg, retries: task.retries });
      task.status = 'failed';
    }
  }

  private async tryFixCompileError(task: Task, compileOutput: string, projectRoot: string): Promise<boolean> {
    try {
      const { CoderAgent } = await import('../agent/coder-agent');
      const coder = new CoderAgent(this.model, this.fileService);
      const result = await coder.run(task, projectRoot);
      return result.success;
    } catch {
      return false;
    }
  }

  private detectBuildCommand(projectRoot: string): { file: string; args: string[]; type: string } | null {
    const isWin = process.platform === 'win32';
    if (fs.existsSync(path.join(projectRoot, 'build.gradle.kts')) ||
        fs.existsSync(path.join(projectRoot, 'build.gradle'))) {
      const gradlewBat = path.join(projectRoot, 'gradlew.bat');
      const gradlewSh = path.join(projectRoot, 'gradlew');
      if (isWin && fs.existsSync(gradlewBat)) {
        return { file: gradlewBat, args: ['assembleDebug'], type: 'gradle' };
      }
      if (fs.existsSync(gradlewSh)) return { file: gradlewSh, args: ['assembleDebug'], type: 'gradle' };
      return { file: 'gradle', args: ['assembleDebug'], type: 'gradle' };
    }
    if (fs.existsSync(path.join(projectRoot, 'pom.xml'))) {
      const mvnwCmd = path.join(projectRoot, 'mvnw.cmd');
      const mvnwSh = path.join(projectRoot, 'mvnw');
      if (isWin && fs.existsSync(mvnwCmd)) return { file: mvnwCmd, args: ['compile'], type: 'maven' };
      if (fs.existsSync(mvnwSh)) return { file: mvnwSh, args: ['compile'], type: 'maven' };
      return { file: 'mvn', args: ['compile'], type: 'maven' };
    }
    if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
      return { file: 'npm', args: ['run', 'build'], type: 'npm' };
    }
    if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
      return { file: 'cargo', args: ['build'], type: 'cargo' };
    }
    return null;
  }

  private topologicalSort(tasks: Task[]): Task[] {
    const visited = new Set<string>();
    const result: Task[] = [];

    const visit = (task: Task) => {
      if (visited.has(task.id)) return;
      visited.add(task.id);
      for (const depId of task.dep) {
        const dep = tasks.find(t => t.id === depId);
        if (dep) visit(dep);
      }
      result.push(task);
    };

    for (const task of tasks) {
      visit(task);
    }
    return result;
  }

  private report(progress: TaskProgress): void {
    this.onProgress?.(progress);
  }

  abort(): void {
    this.aborted = true;
  }
}
