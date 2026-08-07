"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectCompatManager = void 0;
/**
 * PersonalIDE - Project Compatibility Manager
 * 工程文件互操作：QClaw / CodeBuddy / Trae 三方兼容
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 内部超集 schema
const UNIFIED_SCHEMA = {
    projectName: '',
    lastTool: 'personal-ide',
    lastUpdated: Date.now(),
    tasks: [],
    agentMemory: [],
    symbolIndex: {},
    modelConfig: {},
};
class ProjectCompatManager {
    projectRoot;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    // ─────────────────────────────────────────
    // 加载：扫描并合并三方工程配置
    // ─────────────────────────────────────────
    load() {
        const state = { ...UNIFIED_SCHEMA, projectName: path.basename(this.projectRoot) };
        const configs = [];
        // 扫描三个工具的配置目录
        const tools = [
            { name: 'qclaw', dir: '.qclaw', file: 'project-state.json' },
            { name: 'codebuddy', dir: '.codebuddy', file: 'session.json' },
            { name: 'trae', dir: '.trae', file: 'context.json' },
        ];
        for (const tool of tools) {
            const configPath = path.join(this.projectRoot, tool.dir, tool.file);
            if (fs.existsSync(configPath)) {
                try {
                    const content = fs.readFileSync(configPath, 'utf-8');
                    const data = JSON.parse(content);
                    configs.push({ tool: tool.name, data });
                }
                catch {
                    // 忽略损坏的配置文件
                }
            }
        }
        // 合并策略：以最后修改时间戳最晚的为准
        if (configs.length === 0) {
            return state;
        }
        // 简单合并：取所有任务的并集，以 lastTool 记录来源
        for (const { tool, data } of configs) {
            const d = data;
            if (d.tasks && Array.isArray(d.tasks)) {
                const existingIds = new Set(state.tasks.map(t => t.id));
                for (const task of d.tasks) {
                    if (!existingIds.has(String(task.id ?? ''))) {
                        state.tasks.push({
                            id: String(task.id ?? ''),
                            desc: String(task.desc ?? ''),
                            status: String(task.status ?? 'pending'),
                            files: Array.isArray(task.files) ? task.files : [],
                        });
                    }
                }
            }
            if (d.agentMemory && Array.isArray(d.agentMemory)) {
                state.agentMemory.push(...d.agentMemory);
            }
            if (d.symbolIndex) {
                Object.assign(state.symbolIndex, d.symbolIndex);
            }
            state.lastTool = tool;
        }
        state.lastUpdated = Date.now();
        return state;
    }
    // ─────────────────────────────────────────
    // 保存：同步写入所有启用的配置目录
    // ─────────────────────────────────────────
    save(state) {
        const unified = { ...UNIFIED_SCHEMA, ...state };
        unified.lastUpdated = Date.now();
        const tools = [
            { name: 'qclaw', dir: '.qclaw' },
            { name: 'codebuddy', dir: '.codebuddy' },
            { name: 'trae', dir: '.trae' },
        ];
        for (const tool of tools) {
            const toolDir = path.join(this.projectRoot, tool.dir);
            try {
                if (!fs.existsSync(toolDir)) {
                    fs.mkdirSync(toolDir, { recursive: true });
                }
                const data = this.convertToToolFormat(unified, tool.name);
                const filePath = path.join(toolDir, this.getToolFileName(tool.name));
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            }
            catch {
                // 忽略无法写入的目录
            }
        }
    }
    // ─────────────────────────────────────────
    // 格式转换
    // ─────────────────────────────────────────
    convertToToolFormat(unified, tool) {
        switch (tool) {
            case 'qclaw':
                return {
                    version: '1.0',
                    projectRoot: this.projectRoot,
                    tasks: unified.tasks,
                    agentMemory: unified.agentMemory,
                    symbolIndex: unified.symbolIndex,
                    modelConfig: unified.modelConfig,
                    lastUpdated: unified.lastUpdated,
                };
            case 'codebuddy':
                return {
                    session: {
                        projectName: unified.projectName,
                        history: unified.agentMemory.map(m => ({
                            role: m.role,
                            content: m.content,
                            timestamp: m.timestamp,
                        })),
                        buildInstructions: unified.tasks.map(t => t.desc),
                        codeStyle: {},
                    },
                    updatedAt: unified.lastUpdated,
                };
            case 'trae':
                return {
                    context: {
                        projectName: unified.projectName,
                        currentTask: unified.tasks[0] || null,
                        pendingTasks: unified.tasks.filter(t => t.status === 'pending'),
                        completedTasks: unified.tasks.filter(t => t.status === 'done'),
                        builderMemory: unified.agentMemory.filter(m => m.role === 'builder'),
                        coderMemory: unified.agentMemory.filter(m => m.role === 'coder'),
                        modelConfig: unified.modelConfig,
                    },
                    lastUpdated: unified.lastUpdated,
                };
            default:
                return unified;
        }
    }
    getToolFileName(tool) {
        const files = {
            qclaw: 'project-state.json',
            codebuddy: 'session.json',
            trae: 'context.json',
        };
        return files[tool] || 'state.json';
    }
}
exports.ProjectCompatManager = ProjectCompatManager;
