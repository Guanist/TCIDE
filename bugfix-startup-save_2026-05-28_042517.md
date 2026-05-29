# TCIDE v1.2 Bug 修复 — 启动失败 + 保存失败

**时间**: 2026-05-28 04:04-04:25 CST
**修复**: 2 个崩溃级 bug

---

## Bug #1: 安装后应用不启动

**现象**: 构建产物安装/运行后，窗口不显示，无任何错误提示。

**调试过程**:
1. 先怀疑 renderer HTML 结构错误 → 验证编译通过
2. 加入 `dlog()` 细粒度日志到 `src/main/index.ts` 启动流程
3. 清空 release 目录后重建运行

**根因日志**:
```
[Main] STEP: setupIpcHandlers
[Main] setupIpcHandlers ERROR: Error: Attempted to register a second handler for 'file:mkdir'
```

**根因**: `src/main/ipc-handlers.ts` 中 `file:mkdir` 被重复注册：
- 第 89 行（原有）
- 第 555 行（v1.1 新增功能时无意中复制添加）

Electron 的 `ipcMain.handle()` 在同一 channel 上注册两次会**抛出异常**。由于 `setupIpcHandlers()` 在 `app.whenReady()` 中同步执行且无 try-catch，异常导致后续的 `createAppMenu()`、`createWindow()`、`createTray()` 全部未执行 → 窗口从未创建。

**修复**: 删除第 555 行重复的 `ipcMain.handle('file:mkdir', ...)` 注册块。

---

## Bug #2: API 测试成功但保存报错 `Cannot set properties of null`

**现象**: 在设置面板测试大模型 API 连接成功，点击「保存配置」时提示：
```
保存失败: Cannot set properties of null (setting 'textContent')
```

**根因**: v1.2 UI 升级时对 AI 面板 Header 进行了重构，删除了两个旧元素：
- `#ai-model-dot` — 模型连接状态指示灯
- `#ai-model-name` — 模型名称显示

但 `updateModelIndicator()` 函数（`main.ts:1109`）仍然引用这两个元素做 `!` 非空断言：
```typescript
const dot = document.getElementById('ai-model-dot')!;  // null!
const name = document.getElementById('ai-model-name')!; // null!
```

`saveConfig()` → 成功保存 → `updateModelIndicator()` → `null.textContent = ...` → 崩溃

**修复**:
1. `index.html`: AI Header 中补回 `ai-model-dot` + `ai-model-name` 元素
2. `main.css`: 添加 `.ai-model-dot` / `.ai-model-name-text` 样式
3. `main.ts`: `updateModelIndicator()` 改为空安全（`if (!dot || !name) return`）
4. `main.ts`: `updateModelStatusDot()` 同步改为空安全（`model-status` 元素也不存在）

---

## 验证
```
✅ tsc --noEmit                → 0 errors
✅ tsc -p tsconfig.main.json   → 0 errors
✅ Vite build                  → 1062 modules, 10.59s
✅ electron-builder            → TCIDE-1.0.0-x64.exe + portable
✅ 启动测试                    → HWND 6293258, 完整初始化链路通过
```

## 产物
```
personal-ide\release\TCIDE-1.0.0-x64.exe       (97.41 MB)
personal-ide\release\TCIDE-1.0.0-portable.exe   (96.92 MB)
```
