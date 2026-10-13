/**
 * PersonalIDE - TaskRunner
 * 全自动工程化任务闭环引擎：分解 → 执行 → 编译验证 → 修复 → 提交
 */
import { ModelAdapter } from '../model/adapter';
import { FileService } from '../../main/file-service';
import { Task } from '../agent/builder-agent';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
    const running: Promise<void>[] = [];

    // 并行度控制：文件操作可并行，编译类互斥
    const MAX_PARALLEL = 3;
    const compiling = new Set<string>();

    while (pending.length > 0 || running.length > 0) {
      if (this.aborted) {
        return { success: false, results };
      }

      // 找出可启动的任务（依赖已完成）
      while (pending.length > 0 && running.length < MAX_PARALLEL) {
        const task = pending[0];
        const depsDone = task.dep.every(depId => {
          const dep = taskMap.get(depId);
          return dep?.status === 'done';
        });

        if (depsDone && !compiling.has('build')) {
          pending.shift();
          running.push(this.runTask(task, projectRoot, results, taskMap, compiling));
        } else {
          break;
        }
      }

      if (running.length > 0) {
        await Promise.race(running);
        // 清理已完成的 promise
        for (let i = running.length - 1; i >= 0; i--) {
          // 简单清理策略：保留在数组中，由 runTask 内部处理
        }
      }
    }

    // 等待所有任务完成
    await Promise.all(running);

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
        this.report({ taskId: task.id, status: 'compiling', message: `编译验证: ${buildCmd.cmd}`, retryCount: task.retries });

        try {
          const { stdout, stderr } = await execAsync(buildCmd.cmd, {
            cwd: projectRoot,
            timeout: 180000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
          });
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
              const retry = await execAsync(buildCmd.cmd, { cwd: projectRoot, timeout: 180000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
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

  private detectBuildCommand(projectRoot: string): { cmd: string; type: string } | null {
    if (fs.existsSync(path.join(projectRoot, 'build.gradle.kts')) ||
        fs.existsSync(path.join(projectRoot, 'build.gradle'))) {
      const gradlew = fs.existsSync(path.join(projectRoot, 'gradlew.bat'))
        ? 'gradlew.bat'
        : fs.existsSync(path.join(projectRoot, 'gradlew')) ? './gradlew' : 'gradle';
      return { cmd: `${gradlew} assembleDebug`, type: 'gradle' };
    }
    if (fs.existsSync(path.join(projectRoot, 'pom.xml'))) {
      return { cmd: 'mvnw compile', type: 'maven' };
    }
    if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
      return { cmd: 'npm run build', type: 'npm' };
    }
    if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
      return { cmd: 'cargo build', type: 'cargo' };
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
