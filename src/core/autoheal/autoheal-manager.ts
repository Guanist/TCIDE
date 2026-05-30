export class AutoHealManager {
  constructor() { this.retryCounts = new Map(); this.onProgress = null; this.onComplete = null; this.isRunning = false; this.abortController = null; }
  parseErrors(output: string, projectRoot: string): any[] { return []; }
  async autoHeal(errors: any[], projectRoot: string, aiFixFn: any, buildCmd: string): Promise<any> { return { fixed: 0, failed: 0, results: [] }; }
  abort(): void { }
  retryCounts: Map<string, number>; onProgress: any; onComplete: any; isRunning: boolean; abortController: any;
}
export const autoHealManager = new AutoHealManager();