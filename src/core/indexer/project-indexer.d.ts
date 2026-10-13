export interface IndexedFile {
    path: string;
    relativePath: string;
    size: number;
    language: string;
    summary?: string;
}
export interface ModuleInfo {
    name: string;
    path: string;
    type: 'package' | 'module' | 'directory';
    exports: string[];
    imports: string[];
}
export interface SymbolEntry {
    name: string;
    type: 'class' | 'function' | 'method' | 'interface' | 'enum' | 'val' | 'var';
    file: string;
    line: number;
    signature?: string;
    dependencies: string[];
}
export declare class ProjectIndexer {
    private projectRoot;
    constructor(projectRoot: string);
    index(): Promise<{
        fileTree: object;
        modules: ModuleInfo[];
        symbols: SymbolEntry[];
        projectType: string;
    }>;
    private buildFileTree;
    private indexModules;
    private scanJavaModules;
    private indexSymbols;
    private getSourceFiles;
    private extractImports;
    private detectProjectType;
}
