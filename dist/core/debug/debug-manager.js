"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugManager = exports.DebugManager = void 0;
class DebugManager {
    breakpoints = new Map();
    state = { running: false, paused: false, allFrames: [], variables: [] };
    listeners = [];
    /** Add or update a breakpoint */
    setBreakpoint(filePath, line, column, condition, logMessage) {
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
    removeBreakpoint(id) {
        return this.breakpoints.delete(id);
    }
    /** Toggle breakpoint enabled state */
    toggleBreakpoint(id) {
        const bp = this.breakpoints.get(id);
        if (!bp)
            return false;
        bp.enabled = !bp.enabled;
        return bp.enabled;
    }
    /** Get all breakpoints, optionally filtered by file */
    getBreakpoints(filePath) {
        const all = Array.from(this.breakpoints.values());
        return filePath ? all.filter(b => b.filePath === filePath) : all;
    }
    /** Get breakpoints for a specific file and line */
    getBreakpointsAt(filePath, line) {
        return this.getBreakpoints(filePath).filter(b => b.line === line);
    }
    /** Check if a line has an enabled breakpoint */
    hasEnabledBreakpoint(filePath, line) {
        return this.getBreakpointsAt(filePath, line).some(b => b.enabled);
    }
    /** Record a breakpoint hit */
    hitBreakpoint(id) {
        const bp = this.breakpoints.get(id);
        if (bp)
            bp.hitCount = (bp.hitCount || 0) + 1;
    }
    /** Update debug state (called by debug adapter) */
    updateState(partial) {
        Object.assign(this.state, partial);
        this.notifyListeners();
    }
    /** Get current debug state */
    getState() {
        return { ...this.state };
    }
    /** Get variables for the current paused frame */
    getVariables() {
        return this.state.variables;
    }
    /** Get current call stack */
    getCallStack() {
        return this.state.allFrames;
    }
    /** Subscribe to state changes */
    onStateChange(listener) {
        this.listeners.push(listener);
        return () => { this.listeners = this.listeners.filter(l => l !== listener); };
    }
    notifyListeners() {
        const s = this.getState();
        for (const l of this.listeners)
            l(s);
    }
    /** Check if debugger is active */
    get isRunning() { return this.state.running; }
    get isPaused() { return this.state.paused; }
    /** Clear all breakpoints */
    clearAllBreakpoints() {
        this.breakpoints.clear();
    }
    /** Reset debug state */
    reset() {
        this.state = { running: false, paused: false, allFrames: [], variables: [] };
        this.notifyListeners();
    }
}
exports.DebugManager = DebugManager;
exports.debugManager = new DebugManager();
