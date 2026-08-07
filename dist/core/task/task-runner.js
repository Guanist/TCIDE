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
exports.TaskRunner = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const MAX_RETRIES = 3;
class TaskRunner {
    model;
    fileService;
    onProgress;
    aborted = false;
    constructor(model, fileService, onProgress) {
        this.model = model;
        this.fileService = fileService;
        this.onProgress = onProgress;
    }
    async run(tasks, projectRoot) {
        this.aborted = false;
        const results = [];
        const taskMap = new Map(tasks.map(t => [t.id, { ...t }]));
        // 拓扑排序：优先执行无依赖的任务
        const sorted = this.topologicalSort(tasks);
        const pending = [...sorted];
        const running = [];
        // 并行度控制：文件操作可并行，编译类互斥
        const MAX_PARALLEL = 3;
        const compiling = new Set();
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
                }
                else {
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
    async runTask(task, projectRoot, results, taskMap, compiling) {
        if (this.aborted)
            return;
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
                }
                catch (err) {
                    const error = err;
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
                        }
                        catch (retryErr) {
                            const retryError = retryErr;
                            compileOutput = (retryError.stderr || '') + (retryError.stdout || '');
                            this.report({ taskId: task.id, status: 'failed', message: `重试编译仍失败`, retryCount: task.retries });
                            results.push({ taskId: task.id, success: false, output: compileOutput, compileOutput, retries: task.retries });
                            task.status = 'failed';
                            compiling.delete('build');
                            return;
                        }
                    }
                    else {
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.report({ taskId: task.id, status: 'failed', message: `任务异常: ${msg}`, retryCount: task.retries });
            results.push({ taskId: task.id, success: false, output: msg, retries: task.retries });
            task.status = 'failed';
        }
    }
    async tryFixCompileError(task, compileOutput, projectRoot) {
        try {
            const { CoderAgent } = await Promise.resolve().then(() => __importStar(require('../agent/coder-agent')));
            const coder = new CoderAgent(this.model, this.fileService);
            const result = await coder.run(task, projectRoot);
            return result.success;
        }
        catch {
            return false;
        }
    }
    detectBuildCommand(projectRoot) {
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
    topologicalSort(tasks) {
        const visited = new Set();
        const result = [];
        const visit = (task) => {
            if (visited.has(task.id))
                return;
            visited.add(task.id);
            for (const depId of task.dep) {
                const dep = tasks.find(t => t.id === depId);
                if (dep)
                    visit(dep);
            }
            result.push(task);
        };
        for (const task of tasks) {
            visit(task);
        }
        return result;
    }
    report(progress) {
        this.onProgress?.(progress);
    }
    abort() {
        this.aborted = true;
    }
}
exports.TaskRunner = TaskRunner;
