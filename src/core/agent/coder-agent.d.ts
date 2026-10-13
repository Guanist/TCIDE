/**
 * PersonalIDE - Coder Agent
 * 程序员智能体：接收 Builder 任务 → 文件读写 → 终端执行 → 结果反馈
 */
import { ModelAdapter } from '../model/adapter';
import { FileService } from '../../main/file-service';
import { Task } from './builder-agent';
export declare class CoderAgent {
    private model;
    private fileService;
    constructor(model: ModelAdapter, fileService: FileService);
    run(task: Task, projectRoot: string): Promise<{
        success: boolean;
        output: string;
    }>;
    private buildTaskPrompt;
    private readContextFiles;
    private executeCoderActions;
}
