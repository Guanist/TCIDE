interface UnifiedProjectState {
    projectName: string;
    lastTool: string;
    lastUpdated: number;
    tasks: Array<{
        id: string;
        desc: string;
        status: string;
        files: string[];
    }>;
    agentMemory: Array<{
        role: string;
        content: string;
        timestamp: number;
    }>;
    symbolIndex: Record<string, unknown>;
    modelConfig: {
        builderModel?: string;
        coderModel?: string;
    };
}
export declare class ProjectCompatManager {
    private projectRoot;
    constructor(projectRoot: string);
    load(): UnifiedProjectState;
    save(state: object): void;
    private convertToToolFormat;
    private getToolFileName;
}
export {};
