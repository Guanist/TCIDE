/**
 * PersonalIDE - Electron Store
 * 配置持久化
 */
import Store from 'electron-store';
import { app } from 'electron';
import path from 'path';

interface StoreSchema {
  modelConfig: Record<string, unknown>;
  settings: Record<string, unknown>;
  recentProjects: Array<{ path: string; name: string; lastOpened: number }>;
  windowBounds: { x: number; y: number; width: number; height: number };
  sessionState: SessionState;
}

export interface SessionState {
  projectPath: string | null;
  openFiles: Array<{ path: string; name: string; language: string }>;
  activeFileIndex: number;
  chatSessions: Array<{
    id: string;
    name: string;
    chatHistory: Array<{ id: string; role: string; content: string; timestamp: number }>;
    createdAt: number;
    updatedAt: number;
    projectPath?: string;
  }>;
  currentSessionId: string;
  scrollPositions: Record<string, { scrollTop: number; scrollLeft: number }>;
  timestamp: number;
}

let storeInstance: Store<StoreSchema> | null = null;

export function getStore(): Store<StoreSchema> {
  if (!storeInstance) {
    const configDir = path.join(app.getPath('appData'), 'TCIDE');
    const configPath = path.join(configDir, 'personal-ide-config.json');

    // 迁移旧配置：如果新位置不存在但旧位置有，自动复制
    const fs = require('fs');
    const oldLocations = [
      path.join(app.getPath('appData'), 'tcide', 'personal-ide-config.json'),
      path.join(app.getPath('appData'), 'personal-ide', 'personal-ide-config.json'),
    ];
    if (!fs.existsSync(configPath)) {
      for (const oldPath of oldLocations) {
        if (fs.existsSync(oldPath)) {
          try {
            if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
            fs.copyFileSync(oldPath, configPath);
            console.log('[Store] 配置已迁移:', oldPath, '→', configPath);
            break;
          } catch (e) {
            console.warn('[Store] 配置迁移失败:', e);
          }
        }
      }
    }

    storeInstance = new Store<StoreSchema>({
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
