// TCIDE Debug Manager - TS stub (canonical source in dist/)
export class DebugSession { }
export class DebugManager {
  sessions: Map<number, any>;
  nextId: number;
  onEvent: any;
  constructor() {
    this.sessions = new Map();
    this.nextId = 1;
    this.onEvent = null;
  }
  getAvailableAdapters(): any[] { return []; }
  isAdapterInstalled(type: string): boolean { return false; }
  getInstallGuide(type: string): string { return ''; }
  async startSession(type: string, program: string, cwd: string, options?: any): Promise<any> { return {}; }
  async stopSession(sessionId: number): Promise<void> { }
  getSession(sessionId: number): any { return null; }
  listSessions(): any[] { return []; }
  async setBreakpoints(sessionId: number, filePath: string, breakpoints: any[]): Promise<any> { return {}; }
  async configurationDone(sessionId: number): Promise<any> { return {}; }
  async continue_(sessionId: number): Promise<any> { return {}; }
  async next(sessionId: number, threadId: number): Promise<any> { return {}; }
  async stepIn(sessionId: number, threadId: number): Promise<any> { return {}; }
  async stepOut(sessionId: number, threadId: number): Promise<any> { return {}; }
  async pause(sessionId: number, threadId: number): Promise<any> { return {}; }
  async getThreads(sessionId: number): Promise<any> { return {}; }
  async getStackTrace(sessionId: number, threadId: number): Promise<any> { return {}; }
  async getScopes(sessionId: number, frameId: number): Promise<any> { return {}; }
  async getVariables(sessionId: number, variablesReference: number): Promise<any> { return {}; }
  async evaluate(sessionId: number, expression: string, frameId?: number): Promise<any> { return {}; }
  shutdownAll(): void { }
}
export const debugManager = new DebugManager();