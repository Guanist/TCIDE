"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoderAgent = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const sqlite_1 = require("../../main/db/sqlite");
const { ContextManager } = require("./contextManager");
const CODER_SYSTEM_PROMPT = `你是虎猫 TCIDE 的 AI 程序员，运行在用户的本地开发环境中。你拥有对项目文件的完整读写权限和终端执行能力。你可以直接读取、修改、创建项目中的任何文件，也可以执行 gradle、npm、终端命令。

你会收到一个 JSON 任务描述，请根据项目现有代码和任务描述，直接生成或修改相应文件。

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
class CoderAgent {
    model;
    fileService;
    ctxManager;
    onTerminalOutput;
    constructor(model, fileService, projectRoot, onTerminalOutput) {
        this.model = model;
        this.fileService = fileService;
        this.ctxManager = new ContextManager(projectRoot || process.cwd());
        this.onTerminalOutput = onTerminalOutput || null;
    }
    async run(task, projectRoot) {
        const staticContext = this.ctxManager.getFullStaticContext();
        const taskPrompt = this.buildTaskPrompt(task, projectRoot);
        const contextFiles = await this.readContextFiles(task.files, projectRoot);
        const messages = [
            { role: 'system', content: CODER_SYSTEM_PROMPT },
            { role: 'system', content: staticContext },
            { role: 'user', content: taskPrompt + '\n\n相关文件上下文：\n' + contextFiles },
        ];
        const options = {
            stream: false,
            temperature: 0.2,
            maxTokens: 8192,
        };
        try {
            const response = await this.model.send(messages, options);
            const result = await this.executeCoderActions(response, projectRoot, task);
            return result;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, output: `Coder 执行失败: ${msg}` };
        }
    }
    buildTaskPrompt(task, projectRoot) {
        return `当前任务：
- 任务 ID: ${task.id}
- 任务描述: ${task.desc}
- 涉及文件: ${task.files.join(', ') || '（新建文件，待分析）'}
- 项目根目录: ${projectRoot}
- 依赖任务: ${task.dep.length > 0 ? task.dep.join(', ') : '无'}

请执行代码编写和验证。`;
    }
    async readContextFiles(files, projectRoot) {
        if (!files || files.length === 0)
            return '（无相关文件，需新建）';
        const contents = [];
        for (const file of files.slice(0, 3)) { // 最多读取 3 个文件（Token 节流）
            const fullPath = path.isAbsolute(file) ? file : path.join(projectRoot, file);
            try {
                if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                    const stat = fs.statSync(fullPath);
                    if (stat.size < 100 * 1024) { // 单文件 < 100KB
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        contents.push(`=== ${file} ===\n${content.slice(0, 3000)}`);
                    }
                }
            }
            catch {
                // 忽略无权读取的文件
            }
        }
        return contents.join('\n\n') || '（无相关文件，需新建）';
    }
    async executeCoderActions(response, projectRoot, task) {
        const lines = response.split('\n');
        const actions = [];
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
                        (0, sqlite_1.saveSnapshot)(projectRoot, task.id, fullPath, originalContent);
                    }
                    this.fileService.write(fullPath, action.content);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    return { success: false, output: `写入失败 ${action.path}: ${msg}` };
                }
            }
        }
        // 执行终端操作
        const terminalOutputs = [];
        let buildSucceeded = false;
        for (const action of actions) {
            if (action.type === 'run' && action.command) {
                const cwd = action.cwd || projectRoot;
                // 通过回调通知渲染进程终端面板
                if (this.onTerminalOutput) {
                    this.onTerminalOutput({ type: 'command', text: action.command, cwd });
                }
                try {
                    const { spawn } = require('child_process');
                    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
                    const shellArgs = process.platform === 'win32' ? ['/c', action.command] : ['-c', action.command];
                    const child = spawn(shell, shellArgs, { cwd, windowsHide: true });
                    let stdout = '';
                    let stderr = '';
                    child.stdout.on('data', (data) => {
                        const text = data.toString();
                        stdout += text;
                        if (this.onTerminalOutput) {
                            this.onTerminalOutput({ type: 'stdout', text });
                        }
                    });
                    child.stderr.on('data', (data) => {
                        const text = data.toString();
                        stderr += text;
                        if (this.onTerminalOutput) {
                            this.onTerminalOutput({ type: 'stderr', text });
                        }
                    });
                    await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 120000);
                        child.on('close', (code) => {
                            clearTimeout(timer);
                            if (this.onTerminalOutput) {
                                this.onTerminalOutput({ type: 'exit', code });
                            }
                            resolve(code);
                        });
                        child.on('error', (err) => { clearTimeout(timer); reject(err); });
                    });
                    terminalOutputs.push(`[TERM] ${action.command}\nstdout: ${stdout.slice(0, 2000)}\nstderr: ${stderr.slice(0, 1000)}`);
                    if (/gradle|assemble|build|compile/i.test(action.command) && !stderr.includes('FAILED') && !stderr.includes('BUILD FAILED')) {
                        buildSucceeded = true;
                    }
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    terminalOutputs.push(`[TERM] ${action.command} FAILED\n${msg}`);
                    if (this.onTerminalOutput) {
                        this.onTerminalOutput({ type: 'stderr', text: `\nError: ${msg}\n` });
                    }
                }
            }
        }
        // 🔄 构建成功 → 自动 Git 提交
        const fileCount = actions.filter(a => a.type === 'write').length;
        let gitCommitResult = '';
        if (buildSucceeded && fileCount > 0) {
            try {
                const { execSync } = require('child_process');
                const msg = `Auto: ${task.desc.slice(0, 60)} [task:${task.id}]`;
                execSync('git add -A', { cwd: projectRoot, timeout: 10000 });
                const commitOutput = execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: projectRoot, timeout: 10000 }).toString().trim();
                gitCommitResult = `\n[GIT] ✅ 自动提交: ${commitOutput}`;
            }
            catch (err) {
                gitCommitResult = `\n[GIT] ⚠️ 自动提��失败: ${err.message}`;
            }
        }
        return {
            success: true,
            output: `执行完成。\n文件变更：${fileCount} 个\n终端操作：${terminalOutputs.length} 个${gitCommitResult}\n\n${terminalOutputs.join('\n\n')}`,
        };
    }
}
exports.CoderAgent = CoderAgent;
