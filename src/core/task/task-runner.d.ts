/**
 * PersonalIDE - TaskRunner
 * 全自动工程化任务闭环引擎：分解 → 执行 → 编译验证 → 修复 → 提交
 */
import { ModelAdapter } from '../model/adapter';
import { FileService } from '../../main/file-service';
import { Task } from '../agent/builder-agent';
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
export declare class TaskRunner {
    private model;
    private fileService;
    private onProgress?;
    private aborted;
    constructor(model: ModelAdapter, fileService: FileService, onProgress?: ((progress: TaskProgress) => void) | undefined);
    run(tasks: Task[], projectRoot: string): Promise<{
        success: boolean;
        results: TaskResult[];
    }>;
    private runTask;
    private tryFixCompileError;
    private detectBuildCommand;
    private topologicalSort;
    private report;
    abort(): void;
}
