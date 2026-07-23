/**
 * PersonalIDE - Electron Main Process Entry
 */
import { app, BrowserWindow, ipcMain, dialog, Menu, Tray, globalShortcut, nativeImage, protocol, net } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as fs from 'fs';
import { setupIpcHandlers } from './ipc-handlers';
import { initDatabase, closeDatabase } from './db/sqlite';
import { PrivacyNet } from './privacy-net';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ─────────────────────────────────────────
// 窗口创建
// ─────────────────────────────────────────
function createWindow(): void {
  // 加载窗口图标
  const iconPath = isDev
    ? path.join(__dirname, '..', '..', 'resources', 'icon.png')
    : path.join(process.resourcesPath, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1E1E1E',
    title: '虎猫 TCIDE',
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/');
  } else {
    const loadPath = path.join(__dirname, '..', 'renderer', 'index.html');
    console.log('[Main] Loading:', loadPath);
    mainWindow.loadFile(loadPath).then(() => console.log('[Main] loadFile resolved')).catch((err) => console.error('[Main] loadFile error:', err));
  }

  mainWindow.webContents.on('did-start-loading', () => console.log('[Main] did-start-loading'));
  mainWindow.webContents.on('did-finish-load', () => console.log('[Main] did-finish-load'));
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[Main] did-fail-load:', code, desc, url));
  mainWindow.webContents.on('did-fail-provisional-load', (_e, code, desc, url) => console.error('[Main] did-fail-provisional-load:', code, desc, url));
  mainWindow.webContents.on('console-message', (_e, level, message) => console.log('[Renderer]', message));
  
  mainWindow.on('close', (event) => {
    if (tray && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] Renderer process gone:', details.reason);
  });
}

// ─────────────────────────────────────────
// 应用菜单
// ─────────────────────────────────────────
async function openProjectDialog(): Promise<void> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: '选择项目目录',
  });
  if (!result.canceled && result.filePaths[0]) {
    mainWindow?.webContents.send('project-opened', result.filePaths[0]);
  }
}

function showAboutDialog(): void {
  const aboutIconPath = isDev
    ? path.join(__dirname, '..', '..', 'resources', 'about-icon.png')
    : path.join(process.resourcesPath, 'about-icon.png');
  let appVersion = 'v1.5.0-p0';
  try {
    const pkgPath = isDev
      ? path.join(__dirname, '..', '..', 'package.json')
      : path.join(process.resourcesPath, 'app', 'package.json');
    if (fs.existsSync(pkgPath)) {
      appVersion = 'v' + JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
    }
  } catch { /* fallback */ }
  dialog.showMessageBox(mainWindow!, {
    type: 'info',
    title: '关于 虎猫 TCIDE',
    message: '虎猫 TCIDE ' + appVersion,
    detail: '作者：文森特骆\n公众号：文森特骆\n备注：PyClaw 作者骆戡的爸爸\n\n个人专属超级 AI 编程 IDE',
    icon: nativeImage.createFromPath(aboutIconPath),
  });
}

function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '打开项目...', accelerator: 'CmdOrCtrl+O', click: () => openProjectDialog() },
        { type: 'separator' },
        { label: '新建文件', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu-action', 'new-file') },
        { label: '新建文件夹', accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow?.webContents.send('menu-action', 'new-folder') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu-action', 'save') },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit(); } },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => mainWindow?.webContents.send('menu-action', 'find') },
        { label: '替换', accelerator: 'CmdOrCtrl+H', click: () => mainWindow?.webContents.send('menu-action', 'replace') },
        { type: 'separator' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '切换 AI 面板', accelerator: 'CmdOrCtrl+\\', click: () => mainWindow?.webContents.send('menu-action', 'toggle-ai-panel') },
        { label: 'Zen Mode', accelerator: 'CmdOrCtrl+Shift+M', click: () => mainWindow?.webContents.send('menu-action', 'zen-mode') },
        { type: 'separator' },
        { label: '终端', accelerator: 'Ctrl+`', click: () => mainWindow?.webContents.send('menu-action', 'toggle-terminal') },
        { type: 'separator' },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'AI',
      submenu: [
        { label: '发送至 Builder', accelerator: 'CmdOrCtrl+Enter', click: () => mainWindow?.webContents.send('menu-action', 'send-to-builder') },
        { label: '终止任务', accelerator: 'Escape', click: () => mainWindow?.webContents.send('menu-action', 'abort-task') },
        { type: 'separator' },
        { label: '清除对话', click: () => mainWindow?.webContents.send('menu-action', 'clear-chat') },
        { type: 'separator' },
        { label: '设置...', accelerator: 'F1', click: () => mainWindow?.webContents.send('menu-action', 'open-settings') },
      ],
    },
    {
      label: '帮助',
      submenu: [{ label: '关于', click: () => showAboutDialog() }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─────────────────────────────────────────
// 系统托盘
// ─────────────────────────────────────────
function createTray(): void {
  // 尝试多级回退加载托盘图标
  const candidates = isDev
    ? [
        path.join(__dirname, '..', '..', 'resources', 'tray-icon.png'),
        path.join(__dirname, '..', '..', 'resources', 'icon.png'),
      ]
    : [
        path.join(process.resourcesPath, 'tray-icon.png'),
        path.join(process.resourcesPath, 'tray-icon@2x.png'),
        path.join(process.resourcesPath, 'icon.png'),
      ];

  let icon = nativeImage.createEmpty();
  for (const p of candidates) {
    try {
      if (require('fs').existsSync(p)) {
        icon = nativeImage.createFromPath(p);
        if (!icon.isEmpty()) {
          console.log('[Main] Tray icon loaded:', p);
          break;
        }
      }
    } catch (e) {
      console.warn('[Main] Tray icon candidate failed:', p, e);
    }
  }

  if (icon.isEmpty()) {
    console.error('[Main] All tray icon candidates failed, tray will be invisible');
  }

  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 });
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip('虎猫 TCIDE');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => mainWindow?.show());
}

function registerGlobalShortcuts(): void {
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
    }
  });
}


// ============ Pet Window ============
let petWindow: Electron.BrowserWindow | null = null;
function syncPetPosition(): void {
  if (!mainWindow || !petWindow || petWindow.isDestroyed()) return;
  const mb = mainWindow.getBounds();
  if (!mb) return;
  petWindow.setPosition(
    Math.round(mb.x + mb.width - 384 - 20),
    Math.round(mb.y + mb.height - 416 - 50),
    false,
  );
}
function createPetWindow(): void {
  console.log('[Pet] createPetWindow called');
  try {
    if (!mainWindow) { console.log('[Pet] no mainWindow, abort'); return; }
    const { screen } = require('electron');
    const disp = screen.getPrimaryDisplay().workAreaSize;
    const petW = 384, petH = 416;
    let x = disp.width - petW - 40;
    let y = disp.height - petH - 40;
    const mb = mainWindow.getBounds();
    if (mb && mb.width > 100 && mb.height > 100) {
      x = mb.x + mb.width - petW - 20;
      y = mb.y + mb.height - petH - 50;
    }
    x = Math.max(0, Math.min(x, disp.width - petW));
    y = Math.max(0, Math.min(y, disp.height - petH));
    petWindow = new BrowserWindow({
      width: petW, height: petH,
      x: Math.round(x), y: Math.round(y),
      transparent: true, frame: false,
      alwaysOnTop: true, skipTaskbar: true,
      hasShadow: false, resizable: false,
      focusable: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    petWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log('[PetWindow]', message);
    });
    petWindow.webContents.on('crashed', (_e, killed) => {
      console.log('[Pet] renderer crashed, killed=' + killed);
    });
    petWindow.webContents.on('unresponsive', () => {
      console.log('[Pet] renderer unresponsive');
    });
    if (isDev) {
      petWindow.loadURL('http://localhost:5173/pet-window.html');
    } else {
      petWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pet-window.html'));
    }
    mainWindow.on('focus', () => { if (petWindow && !petWindow.isDestroyed()) petWindow.show(); });
    mainWindow.on('minimize', () => { if (petWindow && !petWindow.isDestroyed()) petWindow.hide(); });
    mainWindow.on('restore', () => { if (petWindow && !petWindow.isDestroyed()) { petWindow.show(); syncPetPosition(); } });
    mainWindow.on('close', () => { if (petWindow && !petWindow.isDestroyed()) petWindow.close(); });
    petWindow.webContents.on('dom-ready', () => {
      console.log('[Pet] dom-ready');
      syncPetPosition();
    });
    ipcMain.on('pet-set-state', (_e, state, label) => {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('pet-state-change', state, label);
      }
    });
    ipcMain.on('pet-move', (_e, dx, dy) => {
      if (petWindow && !petWindow.isDestroyed()) {
        const [cx, cy] = petWindow.getPosition();
        const nw = Math.max(0, Math.min(cx + dx, disp.width - petW));
        const nh = Math.max(0, Math.min(cy + dy, disp.height - petH));
        petWindow.setPosition(Math.round(nw), Math.round(nh), false);
      }
    });
    ipcMain.on('pet-wander', (_e, dx, dy) => {
      if (petWindow && !petWindow.isDestroyed()) {
        const [cx, cy] = petWindow.getPosition();
        const nw = Math.max(0, Math.min(cx + dx, disp.width - petW));
        const nh = Math.max(0, Math.min(cy + dy, disp.height - petH));
        petWindow.setPosition(Math.round(nw), Math.round(nh), false);
      }
    });
    ipcMain.handle('pet-hit-test', (_e, x, y) => {
      if (petWindow && !petWindow.isDestroyed()) {
        const [wx, wy] = petWindow.getPosition();
        return x >= wx && x <= wx + petW && y >= wy && y <= wy + petH;
      }
      return false;
    });
    console.log('[Main] Pet window created OK');
  } catch (err) {
    console.log('[Pet] createPetWindow error: ' + (err as Error).message);
  }
}
// ============ Pet Window End ============
function scheduleMemoryCleanup(): void {
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('memory-cleanup');
    }
  }, 30 * 60 * 1000);
}

// ─────────────────────────────────────────
// 单实例锁 + 托盘退出
// ─────────────────────────────────────────
if (process.platform === 'win32') {
  app.setAppUserModelId('com.tcide.personal-ide');
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─────────────────────────────────────────
// 应用生命周期
// ─────────────────────────────────────────
app.whenReady().then(async () => {
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'tcide-debug.log'), 'START\n'); } catch {}
  function dlog(msg: string) { console.log(msg); try { fs.appendFileSync(path.join(app.getPath('userData'), 'tcide-debug.log'), msg + '\n'); } catch {} }
  dlog('[Main] STEP: whenReady entered');
  // ── 自定义协议 ──
  // Electron 33+ 要求在 whenReady 后注册 protocol
  protocol.handle('tcide', (request) => {
    try {
      const requestUrl = new URL(request.url);
      const filename = requestUrl.pathname.replace(/^\//, '');
      const filePath = isDev
        ? path.join(__dirname, '..', '..', 'resources', filename)
        : path.join(process.resourcesPath, filename);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (e) {
      console.error('[Protocol] Failed to serve:', request.url, e);
      return new Response('Not Found', { status: 404 });
    }
  });

  dlog('[Main] PersonalIDE starting...');

  try {
    await initDatabase();
    dlog('[Main] Database initialized');
  } catch (err) {
    dlog('[Main] Database init failed: ' + err);
  }

  if (!isDev) {
    dlog('[Main] STEP: creating PrivacyNet');
    const privacyNet = new PrivacyNet();
    privacyNet.enable();
  }

  dlog('[Main] isDev=' + isDev);
  dlog('[Main] __dirname=' + __dirname);
  dlog('[Main] STEP: setupIpcHandlers');
  setupIpcHandlers();
  dlog('[Main] STEP: createAppMenu');
  createAppMenu();
  dlog('[Main] STEP: createWindow');
  createWindow();
  dlog('[Main] STEP: afterCreateWindow');
  dlog('[Main] STEP: createTray');
  createTray();
  dlog('[Main] STEP: afterCreateTray');
  dlog('[Main] STEP: registerGlobalShortcuts');
  registerGlobalShortcuts();
  dlog('[Main] STEP: scheduleMemoryCleanup');
  scheduleMemoryCleanup();
  dlog('[Main] STEP: createPetWindow');
  createPetWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  console.log('[Main] PersonalIDE ready');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); closeDatabase(); });
