"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStore = getStore;
/**
 * PersonalIDE - Electron Store
 * 配置持久化
 */
const electron_store_1 = __importDefault(require("electron-store"));
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
let storeInstance = null;
function getStore() {
    if (!storeInstance) {
        const configDir = path_1.default.join(electron_1.app.getPath('appData'), 'TCIDE');
        const configPath = path_1.default.join(configDir, 'personal-ide-config.json');
        // 迁移旧配置：如果新位置不存在但旧位置有，自动复制
        const fs = require('fs');
        const oldLocations = [
            path_1.default.join(electron_1.app.getPath('appData'), 'tcide', 'personal-ide-config.json'),
            path_1.default.join(electron_1.app.getPath('appData'), 'personal-ide', 'personal-ide-config.json'),
        ];
        if (!fs.existsSync(configPath)) {
            for (const oldPath of oldLocations) {
                if (fs.existsSync(oldPath)) {
                    try {
                        if (!fs.existsSync(configDir))
                            fs.mkdirSync(configDir, { recursive: true });
                        fs.copyFileSync(oldPath, configPath);
                        console.log('[Store] 配置已迁移:', oldPath, '→', configPath);
                        break;
                    }
                    catch (e) {
                        console.warn('[Store] 配置迁移失败:', e);
                    }
                }
            }
        }
        storeInstance = new electron_store_1.default({
            name: 'personal-ide-config',
            cwd: configDir,
            defaults: {
                modelConfig: {},
                settings: {},
                recentProjects: [],
                windowBounds: { x: 100, y: 100, width: 1440, height: 900 },
                sessionState: {
                    projectPath: null,
                    openFiles: [],
                    activeFileIndex: -1,
                    chatSessions: [],
                    currentSessionId: '',
                    scrollPositions: {},
                    timestamp: 0,
                },
            },
        });
    }
    return storeInstance;
}
