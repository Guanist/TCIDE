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
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 绐楀彛鍒涘缓
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function createWindow() {
    // 鍔犺浇绐楀彛鍥炬爣
    const iconPath = isDev
        ? path.join(__dirname, '..', '..', 'resources', 'icon.png')
        : path.join(process.resourcesPath, 'icon.png');
    mainWindow = new electron_1.BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: '#1E1E1E',
        title: '铏庣尗 TCIDE',
        show: false,
        icon: iconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,
            nodeIntegration: true,
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
    }
    else {
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
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 搴旂敤鑿滃崟
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function openProjectDialog() {
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '閫夋嫨椤圭洰鐩綍',
    });
    if (!result.canceled && result.filePaths[0]) {
        mainWindow?.webContents.send('project-opened', result.filePaths[0]);
    }
}
function showAboutDialog() {
    const aboutIconPath = isDev
        ? path.join(__dirname, '..', '..', 'resources', 'about-icon.png')
        : path.join(process.resourcesPath, 'about-icon.png');
    let appVersion = 'v0.17.0';
    try {
        const pkgPath = isDev
            ? path.join(__dirname, '..', '..', 'package.json')
            : path.join(process.resourcesPath, 'app', 'package.json');
        if (fs.existsSync(pkgPath)) {
            appVersion = 'v' + JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
        }
    } catch { /* fallback to default */ }
    electron_1.dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '鍏充簬 铏庣尗 TCIDE',
        message: '铏庣尗 TCIDE ' + appVersion,
        detail: '浣滆€咃細鏂囨．鐗归獑\n鍏紬鍙凤細鏂囨．鐗归獑\n澶囨敞锛歅yClaw 浣滆€呴獑鎴＄殑鐖哥埜\n\n涓汉涓撳睘瓒呯骇 AI 缂栫▼ IDE',
        icon: electron_1.nativeImage.createFromPath(aboutIconPath),
    });
}
function createAppMenu() {
    const template = [
        {
            label: '鏂囦欢',
            submenu: [
                { label: '鎵撳紑椤圭洰...', accelerator: 'CmdOrCtrl+O', click: () => openProjectDialog() },
                { type: 'separator' },
                { label: '鏂板缓鏂囦欢', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu-action', 'new-file') },
                { label: '鏂板缓鏂囦欢澶?, accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow?.webContents.send('menu-action', 'new-folder') },
                { type: 'separator' },
                { label: '淇濆瓨', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu-action', 'save') },
                { type: 'separator' },
                { label: '閫€鍑?, accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; electron_1.app.quit(); } },
            ],
        },
        {
            label: '缂栬緫',
            submenu: [
                { label: '鎾ら攢', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
                { label: '閲嶅仛', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
                { type: 'separator' },
                { label: '鍓垏', accelerator: 'CmdOrCtrl+X', role: 'cut' },
                { label: '澶嶅埗', accelerator: 'CmdOrCtrl+C', role: 'copy' },
                { label: '绮樿创', accelerator: 'CmdOrCtrl+V', role: 'paste' },
                { type: 'separator' },
                { label: '鏌ユ壘', accelerator: 'CmdOrCtrl+F', click: () => mainWindow?.webContents.send('menu-action', 'find') },
                { label: '鏇挎崲', accelerator: 'CmdOrCtrl+H', click: () => mainWindow?.webContents.send('menu-action', 'replace') },
                { type: 'separator' },
                { label: '鍏ㄩ€?, accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
            ],
        },
        {
            label: '瑙嗗浘',
            submenu: [
                { label: '鍒囨崲 AI 闈㈡澘', accelerator: 'CmdOrCtrl+\\', click: () => mainWindow?.webContents.send('menu-action', 'toggle-ai-panel') },
                { label: 'Zen Mode', accelerator: 'CmdOrCtrl+Shift+M', click: () => mainWindow?.webContents.send('menu-action', 'zen-mode') },
                { type: 'separator' },
                { label: '缁堢', accelerator: 'Ctrl+`', click: () => mainWindow?.webContents.send('menu-action', 'toggle-terminal') },
                { type: 'separator' },
                { label: '閲嶆柊鍔犺浇', accelerator: 'CmdOrCtrl+R', role: 'reload' },
                { label: '寮€鍙戣€呭伐鍏?, accelerator: 'F12', role: 'toggleDevTools' },
            ],
        },
        {
            label: 'AI',
            submenu: [
                { label: '鍙戦€佽嚦 Builder', accelerator: 'CmdOrCtrl+Enter', click: () => mainWindow?.webContents.send('menu-action', 'send-to-builder') },
                { label: '缁堟浠诲姟', accelerator: 'Escape', click: () => mainWindow?.webContents.send('menu-action', 'abort-task') },
                { type: 'separator' },
                { label: '娓呴櫎瀵硅瘽', click: () => mainWindow?.webContents.send('menu-action', 'clear-chat') },
                { type: 'separator' },
                { label: '璁剧疆...', accelerator: 'F1', click: () => mainWindow?.webContents.send('menu-action', 'open-settings') },
            ],
        },
        {
            label: '甯姪',
            submenu: [{ label: '鍏充簬', click: () => showAboutDialog() }],
        },
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 绯荤粺鎵樼洏
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function createTray() {
    // 灏濊瘯澶氱骇鍥為€€鍔犺浇鎵樼洏鍥炬爣
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
    tray.setToolTip('铏庣尗 TCIDE');
    tray.setContextMenu(electron_1.Menu.buildFromTemplate([
        { label: '鏄剧ず绐楀彛', click: () => mainWindow?.show() },
        { type: 'separator' },
        { label: '閫€鍑?, click: () => { isQuitting = true; electron_1.app.quit(); } },
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
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 鍗曞疄渚嬮攣 + 鎵樼洏閫€鍑?
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 搴旂敤鐢熷懡鍛ㄦ湡
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
    // 鈹€鈹€ 鑷畾涔夊崗璁?鈹€鈹€
    // Electron 33+ 瑕佹眰鍦?whenReady 鍚庢敞鍐?protocol
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
