/**
 * PersonalIDE - Builder Agent
 * 架构师智能体：需求分析 → 架构设计 → JSON 任务拆分
 * 借鉴 Claude Code 的分层推理流程
 */
import { ModelAdapter } from '../model/adapter';
export interface Task {
    id: string;
    desc: string;
    dep: string[];
    files: string[];
    status: 'pending' | 'running' | 'done' | 'failed';
    retries: number;
}
export declare class BuilderAgent {
    private model;
    constructor(model: ModelAdapter);
    run(requirement: string, projectContext: object): Promise<Task[]>;
    private buildContextPrompt;
    private parseTaskList;
}
