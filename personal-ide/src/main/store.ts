/**
 * PersonalIDE - Electron Store
 * 配置持久化
 */
import Store from 'electron-store';

interface StoreSchema {
  modelConfig: Record<string, unknown>;
  settings: Record<string, unknown>;
  recentProjects: string[];
  windowBounds: { x: number; y: number; width: number; height: number };
}

let storeInstance: Store<StoreSchema> | null = null;

export function getStore(): Store<StoreSchema> {
  if (!storeInstance) {
    storeInstance = new Store<StoreSchema>({
      name: 'personal-ide-config',
      defaults: {
        modelConfig: {},
        settings: {},
        recentProjects: [],
        windowBounds: { x: 100, y: 100, width: 1440, height: 900 },
      },
    });
  }
  return storeInstance;
}
