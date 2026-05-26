/**
 * PersonalIDE - Coder Agent
 * 程序员智能体：接收 Builder 任务 → 文件读写 → 终端执行 → 结果反馈
 */
import { ModelAdapter, SendOptions } from '../model/adapter';
import { FileService } from '../../main/file-service';
import { Task } from './builder-agent';
import * as path from 'path';
import * as fs from 'fs';
import { saveSnapshot } from '../../main/db/sqlite';

const CODER_SYSTEM_PROMPT = `你是一个严谨的程序员。你会收到一个 JSON 任务描述，请根据项目现有代码和任务描述，直接生成或修改相应文件。

你有以下工具能力：
1. read_file(path) - 读取文件内容
2. write_file(path, content) - 写入文件（自动创建目录）
3. run_terminal(command, cwd) - 执行终端命令

工作流程：
1. 分析任务涉及的文件
2. 读取相关现有文件（了解代码风格和上下文）
3. 生成或修改代码
4. 写入文件
5. 如果需要，运行构建命令验证（如 gradlew assembleDebug）
6. 返回执行结果

重要规则：
- 只修改任务涉及的文件，不要改动其他文件
- 保持与项目现有代码风格一致
- Kotlin 代码遵循官方编码规范
- Android 代码遵循 Jetpack 组件最佳实践
- 修改完成后，必须验证代码质量`;

export class CoderAgent {
  constructor(
    private model: ModelAdapter,
    private fileService: FileService
  ) {}

  async run(task: Task, projectRoot: string): Promise<{ success: boolean; output: string }> {
    const taskPrompt = this.buildTaskPrompt(task, projectRoot);
    const contextFiles = await this.readContextFiles(task.files, projectRoot);

    const messages = [
      { role: 'system', content: CODER_SYSTEM_PROMPT },
      { role: 'user', content: taskPrompt + '\n\n相关文件上下文：\n' + contextFiles },
    ];

    const options: SendOptions = {
      stream: false,
      temperature: 0.2,
      maxTokens: 8192,
    };

    try {
      const response = await this.model.send(messages, options);
      const result = await this.executeCoderActions(response, projectRoot, task.id);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Coder 执行失败: ${msg}` };
    }
  }

  private buildTaskPrompt(task: Task, projectRoot: string): string {
    return `当前任务：
- 任务 ID: ${task.id}
- 任务描述: ${task.desc}
- 涉及文件: ${task.files.join(', ') || '（新建文件，待分析）'}
- 项目根目录: ${projectRoot}
- 依赖任务: ${task.dep.length > 0 ? task.dep.join(', ') : '无'}

请执行代码编写和验证。`;
  }

  private async readContextFiles(files: string[], projectRoot: string): Promise<string> {
    if (!files || files.length === 0) return '（无相关文件，需新建）';

    const contents: string[] = [];
    for (const file of files.slice(0, 10)) { // 最多读取 10 个文件
      const fullPath = path.isAbsolute(file) ? file : path.join(projectRoot, file);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          const stat = fs.statSync(fullPath);
          if (stat.size < 200 * 1024) { // 单文件 < 200KB
            const content = fs.readFileSync(fullPath, 'utf-8');
            contents.push(`=== ${file} ===\n${content.slice(0, 5000)}`);
          }
        }
      } catch {
        // 忽略无权读取的文件
      }
    }

    return contents.join('\n\n') || '（无相关文件，需新建）';
  }

  private async executeCoderActions(response: string, projectRoot: string, taskId: string): Promise<{ success: boolean; output: string }> {
    const lines = response.split('\n');
    const actions: Array<{ type: string; path?: string; content?: string; command?: string; cwd?: string }> = [];

    // 简单指令解析：从响应中提取 write_file / read_file / run_terminal 指令
    const writeRegex = /write_file\s*\(\s*["']([^"']+)["']\s*,\s*(?:`([^`]+)`|"""([\s\S]*?)"""|"([^"]*)")\s*\)/g;
    const readRegex = /read_file\s*\(\s*["']([^"']+)["']\s*\)/g;
    const runRegex = /run_terminal\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']*)["']\s*\)/g;

    let match;

    while ((match = writeRegex.exec(response)) !== null) {
      actions.push({
        type: 'write',
        path: match[1],
        content: match[2] || match[3] || match[4] || '',
      });
    }

    while ((match = readRegex.exec(response)) !== null) {
      actions.push({ type: 'read', path: match[1] });
    }

    while ((match = runRegex.exec(response)) !== null) {
      actions.push({ type: 'run', command: match[1], cwd: match[2] });
    }

    // 执行写操作（先快照再写入）
    for (const action of actions) {
      if (action.type === 'write' && action.path && action.content !== undefined) {
        const fullPath = path.isAbsolute(action.path) ? action.path : path.join(projectRoot, action.path);
        try {
          // 📸 自动快照：写入前备份原文件
          if (fs.existsSync(fullPath)) {
            const originalContent = fs.readFileSync(fullPath, 'utf-8');
            saveSnapshot(projectRoot, taskId, fullPath, originalContent);
          }
          this.fileService.write(fullPath, action.content);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, output: `写入失败 ${action.path}: ${msg}` };
        }
      }
    }

    // 执行终端操作
    const terminalOutputs: string[] = [];
    for (const action of actions) {
      if (action.type === 'run' && action.command) {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        try {
          const { stdout, stderr } = await execAsync(action.command, {
            cwd: action.cwd || projectRoot,
            timeout: 120000,
            maxBuffer: 5 * 1024 * 1024,
            windowsHide: true,
          });
          terminalOutputs.push(`[TERM] ${action.command}\nstdout: ${stdout.slice(0, 2000)}\nstderr: ${stderr.slice(0, 1000)}`);
        } catch (err: unknown) {
          const error = err as { stderr?: string; stdout?: string };
          terminalOutputs.push(`[TERM] ${action.command} FAILED\n${error.stderr || ''}`);
        }
      }
    }

    return {
      success: true,
      output: `执行完成。\n文件变更：${actions.filter(a => a.type === 'write').length} 个\n终端操作：${terminalOutputs.length} 个\n\n${terminalOutputs.join('\n\n')}`,
    };
  }
}
