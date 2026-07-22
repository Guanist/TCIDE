"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugManager = exports.DebugManager = exports.DebugSession = void 0;
// TCIDE Debug Manager - TS stub (canonical source in dist/)
class DebugSession {
}
exports.DebugSession = DebugSession;
class DebugManager {
    sessions;
    nextId;
    onEvent;
    constructor() {
        this.sessions = new Map();
        this.nextId = 1;
        this.onEvent = null;
    }
    getAvailableAdapters() { return []; }
    isAdapterInstalled(type) { return false; }
    getInstallGuide(type) { return ''; }
    async startSession(type, program, cwd, options) { return {}; }
    async stopSession(sessionId) { }
    getSession(sessionId) { return null; }
    listSessions() { return []; }
    async setBreakpoints(sessionId, filePath, breakpoints) { return {}; }
    async configurationDone(sessionId) { return {}; }
    async continue_(sessionId) { return {}; }
    async next(sessionId, threadId) { return {}; }
    async stepIn(sessionId, threadId) { return {}; }
    async stepOut(sessionId, threadId) { return {}; }
    async pause(sessionId, threadId) { return {}; }
    async getThreads(sessionId) { return {}; }
    async getStackTrace(sessionId, threadId) { return {}; }
    async getScopes(sessionId, frameId) { return {}; }
    async getVariables(sessionId, variablesReference) { return {}; }
    async evaluate(sessionId, expression, frameId) { return {}; }
    shutdownAll() { }
}
exports.DebugManager = DebugManager;
exports.debugManager = new DebugManager();
