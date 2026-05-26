/**
 * PersonalIDE - Electron Main Process Entry
 */
import { app, BrowserWindow, ipcMain, dialog, Menu, Tray, globalShortcut, nativeImage, protocol, net } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
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
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

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
  dialog.showMessageBox(mainWindow!, {
    type: 'info',
    title: '关于 虎猫 TCIDE',
    message: '虎猫 TCIDE v1.0.0',
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

function scheduleMemoryCleanup(): void {
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('memory-cleanup');
    }
  }, 30 * 60 * 1000);
}

// ─────────────────────────────────────────
// 应用生命周期
// ─────────────────────────────────────────
app.whenReady().then(async () => {
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

  console.log('[Main] PersonalIDE starting...');

  try {
    await initDatabase();
    console.log('[Main] Database initialized');
  } catch (err) {
    console.error('[Main] Database init failed:', err);
  }

  if (!isDev) {
    const privacyNet = new PrivacyNet();
    privacyNet.enable();
  }

  setupIpcHandlers();
  createAppMenu();
  createWindow();
  createTray();
  registerGlobalShortcuts();
  scheduleMemoryCleanup();

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
