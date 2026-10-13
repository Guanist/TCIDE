/**
 * DebugManager - breakpoint, variable inspection, and call stack management.
 * Integrates with debug adapter protocol for real debugging.
 */
export interface DebugBreakpoint {
  id: string;
  filePath: string;
  line: number;
  column?: number;
  enabled: boolean;
  condition?: string;
  hitCount?: number;
  logMessage?: string;
}

export interface DebugVariable {
  name: string;
  value: string;
  type: string;
  hasChildren: boolean;
  children?: DebugVariable[];
}

export interface DebugStackFrame {
  id: number;
  name: string;
  filePath: string;
  line: number;
  column: number;
}

export interface DebugState {
  running: boolean;
  paused: boolean;
  reason?: 'breakpoint' | 'step' | 'exception' | 'pause';
  currentFrame?: DebugStackFrame;
  allFrames: DebugStackFrame[];
  variables: DebugVariable[];
}

export class DebugManager {
  private breakpoints: Map<string, DebugBreakpoint> = new Map();
  private state: DebugState = { running: false, paused: false, allFrames: [], variables: [] };
  private listeners: Array<(state: DebugState) => void> = [];

  /** Add or update a breakpoint */
  setBreakpoint(filePath: string, line: number, column?: number, condition?: string, logMessage?: string): string {
    const id = `${filePath}:${line}${column ? ':' + column : ''}`;
    const existing = this.breakpoints.get(id);
    this.breakpoints.set(id, {
      id,
      filePath,
      line,
      column,
      enabled: existing?.enabled ?? true,
      condition,
      logMessage,
      hitCount: existing?.hitCount || 0,
    });
    return id;
  }

  /** Remove a breakpoint */
  removeBreakpoint(id: string): boolean {
    return this.breakpoints.delete(id);
  }

  /** Toggle breakpoint enabled state */
  toggleBreakpoint(id: string): boolean {
    const bp = this.breakpoints.get(id);
    if (!bp) return false;
    bp.enabled = !bp.enabled;
    return bp.enabled;
  }

  /** Get all breakpoints, optionally filtered by file */
  getBreakpoints(filePath?: string): DebugBreakpoint[] {
    const all = Array.from(this.breakpoints.values());
    return filePath ? all.filter(b => b.filePath === filePath) : all;
  }

  /** Get breakpoints for a specific file and line */
  getBreakpointsAt(filePath: string, line: number): DebugBreakpoint[] {
    return this.getBreakpoints(filePath).filter(b => b.line === line);
  }

  /** Check if a line has an enabled breakpoint */
  hasEnabledBreakpoint(filePath: string, line: number): boolean {
    return this.getBreakpointsAt(filePath, line).some(b => b.enabled);
  }

  /** Record a breakpoint hit */
  hitBreakpoint(id: string): void {
    const bp = this.breakpoints.get(id);
    if (bp) bp.hitCount = (bp.hitCount || 0) + 1;
  }

  /** Update debug state (called by debug adapter) */
  updateState(partial: Partial<DebugState>): void {
    Object.assign(this.state, partial);
    this.notifyListeners();
  }

  /** Get current debug state */
  getState(): DebugState {
    return { ...this.state };
  }

  /** Get variables for the current paused frame */
  getVariables(): DebugVariable[] {
    return this.state.variables;
  }

  /** Get current call stack */
  getCallStack(): DebugStackFrame[] {
    return this.state.allFrames;
  }

  /** Subscribe to state changes */
  onStateChange(listener: (state: DebugState) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notifyListeners(): void {
    const s = this.getState();
    for (const l of this.listeners) l(s);
  }

  /** Check if debugger is active */
  get isRunning(): boolean { return this.state.running; }
  get isPaused(): boolean { return this.state.paused; }

  /** Clear all breakpoints */
  clearAllBreakpoints(): void {
    this.breakpoints.clear();
  }

  /** Reset debug state */
  reset(): void {
    this.state = { running: false, paused: false, allFrames: [], variables: [] };
    this.notifyListeners();
  }
}

export const debugManager = new DebugManager();
