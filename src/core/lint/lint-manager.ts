export class LintManager {
  constructor() { this.onDiagnostics = null; this.onStatusChange = null; this.status = { totalErrors: 0, totalWarnings: 0, linting: false, formatting: false }; this.diagnosticsByFile = new Map(); this.installedCache = new Map(); }
  isInstalled(projectRoot: string, tool: string): boolean { return false; }
  getInstallGuide(tool: string): string { return ''; }
  async lintFile(filePath: string, projectRoot: string): Promise<any> { return { diagnostics: [], errors: 0, warnings: 0 }; }
  async formatFile(filePath: string, projectRoot: string): Promise<any> { return { success: false, formatted: null, error: '' }; }
  async lintProject(projectRoot: string, onProgress?: any): Promise<any> { return new Map(); }
  async fixAll(projectRoot: string, filePaths?: string[]): Promise<any[]> { return []; }
  getFileSummary(filePath: string): any { return { errors: 0, warnings: 0, total: 0 }; }
  getProjectSummary(): any { return { totalErrors: 0, totalWarnings: 0 }; }
  clearFile(filePath: string): void { }
  clearAll(): void { }
  onDiagnostics: any; onStatusChange: any; status: any; diagnosticsByFile: Map<string, any[]>; installedCache: Map<string, any>;
}
export const lintManager = new LintManager();