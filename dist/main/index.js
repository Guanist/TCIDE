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
/**
 * PersonalIDE - Electron Main Process Entry
 */
const electron_1 = require("electron");
const path = __importStar(require("path"));
const url_1 = require("url");
const fs = __importStar(require("fs"));
const ipc_handlers_1 = require("./ipc-handlers");
const sqlite_1 = require("./db/sqlite");
const privacy_net_1 = require("./privacy-net");
const isDev = !electron_1.app.isPackaged;
let mainWindow = null;
let tray = null;
let isQuitting = false;
// ─────────────────────────────────────────
// 窗口创建
// ─────────────────────────────────────────
function createWindow() {
    // 开发模式下启动内置静态文件服务器
    if (isDev) {
        try {
            const http = require('http');
            const serveRoot = path.join(__dirname, '..', 'renderer');
            const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.json': 'application/json' };
            const srv = http.createServer((req, res) => {
                const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
                try {
                    const data = fs.readFileSync(path.join(serveRoot, url));
                    const ext = path.extname(url);
                    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
                    res.end(data);
                } catch { res.writeHead(404); res.end('Not Found'); }
            });
            srv.listen(5173, '127.0.0.1', () => console.log('[Main] Dev server on http://127.0.0.1:5173'));
        } catch (e) { console.log('[Main] Dev server init failed:', e.message); }
    }
    // 加载窗口图标
    const iconPath = isDev
        ? path.join(__dirname, '..', '..', 'resources', 'icon.png')
        : path.join(process.resourcesPath, 'icon.png');
    mainWindow = new electron_1.BrowserWindow({
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
    // Use built-in HTTP server to serve renderer (avoids file:// protocol issues)
    try {
        const http = require('http');
        const serveRoot = path.join(__dirname, '..', 'renderer');
        const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ttf': 'font/ttf',
            '.ico': 'image/x-icon',
            '.json': 'application/json'
        };
        const srv = http.createServer((req, res) => {
            const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
            try {
                const data = fs.readFileSync(path.join(serveRoot, url));
                const ext = path.extname(url);
                res.writeHead(200, {
                    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(data);
            } catch { res.writeHead(404); res.end('Not Found'); }
        });
        srv.listen(5173, '127.0.0.1', () => {
            dlog('[Main] Loading via http://127.0.0.1:5173/');
            mainWindow.loadURL('http://127.0.0.1:5173/');
        });
    } catch (e) {
        dlog('[Main] HTTP server failed: ' + e.message);
        // Fallback to loadFile
        const loadPath = path.join(__dirname, '..', 'renderer', 'index.html');
        dlog('[Main] Falling back to loadFile:', loadPath);
        mainWindow.loadFile(loadPath).catch((err) => console.error('[Main] loadFile error:', err));
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
async function openProjectDialog() {
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '选择项目目录',
    });
    if (!result.canceled && result.filePaths[0]) {
        mainWindow?.webContents.send('project-opened', result.filePaths[0]);
    }
}
function showAboutDialog() {
    const aboutIconPath = isDev
        ? path.join(__dirname, '..', '..', 'resources', 'about-icon.png')
        : path.join(process.resourcesPath, 'about-icon.png');
    electron_1.dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '关于 虎猫 TCIDE',
        message: '虎猫 TCIDE v1.0.0',
        detail: '作者：文森特骆\n公众号：文森特骆\n备注：PyClaw 作者骆戡的爸爸\n\n个人专属超级 AI 编程 IDE',
        icon: electron_1.nativeImage.createFromPath(aboutIconPath),
    });
}
function createAppMenu() {
    const template = [
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
                { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; electron_1.app.quit(); } },
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
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
// ─────────────────────────────────────────
// 系统托盘
// ─────────────────────────────────────────
function createTray() {
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
    let icon = electron_1.nativeImage.createEmpty();
    for (const p of candidates) {
        try {
            if (require('fs').existsSync(p)) {
                icon = electron_1.nativeImage.createFromPath(p);
                if (!icon.isEmpty()) {
                    console.log('[Main] Tray icon loaded:', p);
                    break;
                }
            }
        }
        catch (e) {
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
    tray = new electron_1.Tray(icon);
    tray.setToolTip('虎猫 TCIDE');
    tray.setContextMenu(electron_1.Menu.buildFromTemplate([
        { label: '显示窗口', click: () => mainWindow?.show() },
        { type: 'separator' },
        { label: '退出', click: () => { isQuitting = true; electron_1.app.quit(); } },
    ]));
    tray.on('double-click', () => mainWindow?.show());
}
function registerGlobalShortcuts() {
    electron_1.globalShortcut.register('CommandOrControl+Shift+D', () => {
        if (mainWindow?.isVisible()) {
            mainWindow.focus();
        }
        else {
            mainWindow?.show();
        }
    });
}
function scheduleMemoryCleanup() {
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
    electron_1.app.setAppUserModelId('com.tcide.personal-ide');
}
const gotLock = electron_1.app.requestSingleInstanceLock();
if (!gotLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}
// ─────────────────────────────────────────
// 应用生命周期
// ─────────────────────────────────────────
electron_1.app.whenReady().then(async () => {
    try {
        fs.writeFileSync(path.join(electron_1.app.getPath('userData'), 'tcide-debug.log'), 'START\n');
    }
    catch { }
    function dlog(msg) { console.log(msg); try {
        fs.appendFileSync(path.join(electron_1.app.getPath('userData'), 'tcide-debug.log'), msg + '\n');
    }
    catch { } }
    dlog('[Main] STEP: whenReady entered');
    // ── 自定义协议 ──
    // Electron 33+ 要求在 whenReady 后注册 protocol
    electron_1.protocol.handle('tcide', (request) => {
        try {
            const requestUrl = new URL(request.url);
            const filename = requestUrl.pathname.replace(/^\//, '');
            const filePath = isDev
                ? path.join(__dirname, '..', '..', 'resources', filename)
                : path.join(process.resourcesPath, filename);
            return electron_1.net.fetch((0, url_1.pathToFileURL)(filePath).toString());
        }
        catch (e) {
            console.error('[Protocol] Failed to serve:', request.url, e);
            return new Response('Not Found', { status: 404 });
        }
    });
    dlog('[Main] PersonalIDE starting...');
    try {
        await (0, sqlite_1.initDatabase)();
        dlog('[Main] Database initialized');
    }
    catch (err) {
        dlog('[Main] Database init failed: ' + err);
    }
    if (!isDev) {
        dlog('[Main] STEP: creating PrivacyNet');
        const privacyNet = new privacy_net_1.PrivacyNet();
        privacyNet.enable();
    }
    dlog('[Main] isDev=' + isDev);
    dlog('[Main] __dirname=' + __dirname);
    dlog('[Main] STEP: setupIpcHandlers');
    (0, ipc_handlers_1.setupIpcHandlers)();
    // 模板系统 IPC
    try {
      const templateIpc = require('./template-ipc');
      templateIpc.setupTemplateIpc();
      dlog('[Main] Template IPC loaded');
    } catch (e) { dlog('[Main] Template IPC failed: ' + e); }
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
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
    console.log('[Main] PersonalIDE ready');
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('before-quit', () => { isQuitting = true; });
electron_1.app.on('will-quit', () => { electron_1.globalShortcut.unregisterAll(); (0, sqlite_1.closeDatabase)(); });
