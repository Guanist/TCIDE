"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DebugPanel = void 0;
/**
 * TCIDE Debug Panel — P0 调试面板 UI
 *
 * 负责:
 *   - 在 Monaco Editor 边栏渲染断点标记
 *   - 变量监视面板
 *   - 调用栈视图
 *   - 调试控制台
 *   - 调试工具栏（启动/暂停/步进/停止）
 *
 * 集成: 通过 IPC 调用 DebugManager（主进程），通过 Monaco 装饰器渲染断点
 */
class DebugPanel {
    constructor() {
        /** @type {object} Monaco 编辑器实例 */
        this.monaco = null;
        /** @type {object} 编辑器实例 */
        this.editor = null;
        /** @type {HTMLElement} 容器元素 */
        this.containerEl = null;
        /** @type {number|null} 当前活动会话 ID */
        this.sessionId = null;
        /** @type {boolean} 面板是否可见 */
        this.visible = false;
        /** @type {Map<number, string[]>} 断点装饰器 ID 集合 */
        this.breakpointDecorations = new Map();
        /** @type {object[]} 当前断点列表 */
        this.breakpoints = [];
        /** @type {object[]} 变量列表 */
        this.variables = [];
        /** @type {object[]} 调用栈 */
        this.callStack = [];
        /** @type {object[]} 控制台输出 */
        this.consoleOutput = [];
        /** @type {string} 当前求值表达式输入 */
        this.evaluateInput = '';
        /** @type {object[]} 可用适配器 */
        this.adapters = [];

        // IPC 引用
        this._ipc = null;

        // DOM 元素引用
        this._panelRoot = null;
        this._toolbarEl = null;
        this._variablesEl = null;
        this._callStackEl = null;
        this._consoleEl = null;
        this._consoleInputEl = null;
    }

    /**
     * 初始化调试面板
     * @param {object} monaco - Monaco Editor 全局对象
     * @param {object} editor - Monaco Editor 实例
     * @param {HTMLElement} containerEl - 面板挂载容器
     * @param {object} [ipcRenderer] - Electron IPC Renderer
     */
    init(monaco, editor, containerEl, ipcRenderer) {
        this.monaco = monaco;
        this.editor = editor;
        this.containerEl = containerEl;
        this._ipc = ipcRenderer;

        this._buildPanel();
        this._registerEditorListeners();
        this._loadAdapters();
    }

    // ── 面板构建 ──
    _buildPanel() {
        const root = document.createElement('div');
        root.className = 'tcide-debug-panel';
        root.style.cssText = 'display:none;flex-direction:column;height:100%;background:var(--bg-primary,#1e1e1e);color:var(--fg-primary,#ccc);font-family:monospace;font-size:12px;';

        // 工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'tcide-debug-toolbar';
        toolbar.style.cssText = 'display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid var(--border,#333);flex-shrink:0;';
        toolbar.innerHTML = `
            <select class="debug-adapter-select" style="background:#2d2d2d;color:#ccc;border:1px solid #444;padding:2px 6px;font-size:11px;border-radius:3px;">
                <option value="">-- 选择调试器 --</option>
            </select>
            <button class="debug-btn-start" title="启动调试 (F5)" style="background:#0e639c;color:#fff;border:none;padding:2px 10px;border-radius:3px;cursor:pointer;font-size:11px;">▶ 启动</button>
            <button class="debug-btn-stop" title="停止调试 (Shift+F5)" style="background:#c72e2e;color:#fff;border:none;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;">■</button>
            <span style="flex:1;"></span>
            <button class="debug-btn-pause" title="暂停 (F6)" style="background:#2d2d2d;color:#ccc;border:1px solid #444;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;">⏸</button>
            <button class="debug-btn-continue" title="继续 (F5)" style="background:#2d2d2d;color:#ccc;border:1px solid #444;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;">▶</button>
            <button class="debug-btn-stepover" title="逐过程 (F10)" style="background:#2d2d2d;color:#ccc;border:1px solid #444;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;">⤵</button>
            <button class="debug-btn-stepin" title="逐语句 (F11)" style="background:#2d2d2d;color:#ccc;border:1px solid #444;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;">↓</button>
            <button class="debug-btn-stepout" title="跳出 (Shift+F11)" style="background:#2d2d2d;color:#ccc;border:1px solid #444;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;">↑</button>
        `;
        root.appendChild(toolbar);

        // 内容区域（上半部分：变量+调用栈 | 下半部分：控制台）
        const body = document.createElement('div');
        body.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

        // 变量区
        const variablesSection = this._buildSection('变量', 'debug-variables');
        this._variablesEl = variablesSection.querySelector('.section-content');
        body.appendChild(variablesSection);

        // 调用栈区
        const callStackSection = this._buildSection('调用栈', 'debug-callstack');
        this._callStackEl = callStackSection.querySelector('.section-content');
        body.appendChild(callStackSection);

        // 断点列表
        const bpSection = this._buildSection('断点', 'debug-breakpoints');
        this._breakpointsEl = bpSection.querySelector('.section-content');
        body.appendChild(bpSection);

        // 调试控制台
        const consoleSection = this._buildSection('调试控制台', 'debug-console');
        this._consoleEl = document.createElement('div');
        this._consoleEl.style.cssText = 'flex:1;min-height:80px;overflow-y:auto;padding:4px 8px;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;background:#1a1a1a;';
        consoleSection.querySelector('.section-content').appendChild(this._consoleEl);

        // 控制台输入行
        const inputRow = document.createElement('div');
        inputRow.style.cssText = 'display:flex;border-top:1px solid #333;';
        const promptSpan = document.createElement('span');
        promptSpan.textContent = '> ';
        promptSpan.style.cssText = 'color:#569cd6;padding:2px 4px;flex-shrink:0;font-size:11px;';
        this._consoleInputEl = document.createElement('input');
        this._consoleInputEl.type = 'text';
        this._consoleInputEl.placeholder = '输入表达式求值...';
        this._consoleInputEl.style.cssText = 'flex:1;background:transparent;border:none;color:#d4d4d4;font-family:monospace;font-size:11px;outline:none;padding:2px 4px;';
        inputRow.appendChild(promptSpan);
        inputRow.appendChild(this._consoleInputEl);
        consoleSection.querySelector('.section-content').appendChild(inputRow);

        body.appendChild(consoleSection);
        root.appendChild(body);

        // 状态栏
        const statusBar = document.createElement('div');
        statusBar.className = 'debug-statusbar';
        statusBar.style.cssText = 'padding:2px 8px;background:#007acc;color:#fff;font-size:11px;flex-shrink:0;display:none;';
        statusBar.textContent = '调试器就绪';
        this._statusBar = statusBar;
        root.appendChild(statusBar);

        this._panelRoot = root;
        this._toolbarEl = toolbar;
        this.containerEl.appendChild(root);

        // 绑定工具栏事件
        this._bindToolbarEvents();
        this._bindConsoleInput();
    }

    _buildSection(title, cls) {
        const section = document.createElement('div');
        section.className = `debug-section ${cls}`;
        section.style.cssText = 'border-bottom:1px solid #2a2a2a;flex-shrink:0;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:#252526;cursor:pointer;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;';
        header.textContent = title;
        header.onclick = () => {
            const content = header.nextElementSibling;
            content.style.display = content.style.display === 'none' ? 'block' : 'none';
        };

        const content = document.createElement('div');
        content.className = 'section-content';
        content.style.cssText = 'max-height:200px;overflow-y:auto;';

        section.appendChild(header);
        section.appendChild(content);
        return section;
    }

    _bindToolbarEvents() {
        const t = this._toolbarEl;

        t.querySelector('.debug-btn-start').onclick = () => this.start();
        t.querySelector('.debug-btn-stop').onclick = () => this.stop();
        t.querySelector('.debug-btn-pause').onclick = () => this.pause();
        t.querySelector('.debug-btn-continue').onclick = () => this.continue_();
        t.querySelector('.debug-btn-stepover').onclick = () => this.stepOver();
        t.querySelector('.debug-btn-stepin').onclick = () => this.stepIn();
        t.querySelector('.debug-btn-stepout').onclick = () => this.stepOut();
        t.querySelector('.debug-adapter-select').onchange = (e) => {
            this._selectedAdapter = e.target.value;
        };
    }

    _bindConsoleInput() {
        this._consoleInputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const expr = this._consoleInputEl.value.trim();
                if (expr && this.sessionId && this._ipc) {
                    this._appendConsole('input', `> ${expr}`);
                    this._ipc.invoke('debug:evaluate', this.sessionId, expr).then((res) => {
                        if (res.error) {
                            this._appendConsole('error', res.error);
                        } else {
                            this._appendConsole('output', String(res.result));
                        }
                    }).catch((err) => {
                        this._appendConsole('error', err.message || String(err));
                    });
                }
                this._consoleInputEl.value = '';
            }
        };
    }

    _appendConsole(type, text) {
        this.consoleOutput.push({ type, text, timestamp: Date.now() });
        if (!this._consoleEl) return;
        const line = document.createElement('div');
        const colors = { input: '#569cd6', output: '#d4d4d4', error: '#f44747', stdout: '#6a9955', stderr: '#f44747' };
        line.style.color = colors[type] || '#d4d4d4';
        line.textContent = text;
        this._consoleEl.appendChild(line);
        this._consoleEl.scrollTop = this._consoleEl.scrollHeight;
    }

    // ── 编辑器监听 ──
    _registerEditorListeners() {
        if (!this.monaco || !this.editor) return;

        // 行号点击 → 添加/移除断点
        this.editor.onMouseDown((e) => {
            if (e.target.type === this.monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
                e.target.type === this.monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
                const line = e.target.position.lineNumber;
                this._toggleBreakpoint(line);
            }
        });

        // 快捷键
        this.editor.addAction({
            id: 'debug-toggle-breakpoint',
            label: '切换断点',
            keybindings: [this.monaco.KeyCode.F9],
            run: () => {
                const pos = this.editor.getPosition();
                if (pos) this._toggleBreakpoint(pos.lineNumber);
            },
        });
    }

    _toggleBreakpoint(line) {
        const filePath = this.editor.getModel()?.uri?.fsPath;
        if (!filePath) return;

        const existing = this.breakpoints.find(bp => bp.filePath === filePath && bp.line === line);
        if (existing) {
            this.breakpoints = this.breakpoints.filter(bp => bp !== existing);
            if (this.sessionId && this._ipc) {
                this._ipc.invoke('debug:setBreakpoints', this.sessionId, filePath,
                    this.breakpoints.filter(b => b.filePath === filePath));
            }
            this._removeBreakpointDecoration(filePath, line);
        } else {
            const bp = { line, filePath, column: 1, enabled: true, condition: null, temporary: false };
            this.breakpoints.push(bp);
            if (this.sessionId && this._ipc) {
                this._ipc.invoke('debug:setBreakpoints', this.sessionId, filePath,
                    this.breakpoints.filter(b => b.filePath === filePath));
            }
            this._addBreakpointDecoration(filePath, line);
        }
    }

    _addBreakpointDecoration(filePath, line) {
        if (!this.monaco || !this.editor) return;
        const model = this.editor.getModel();
        if (!model || model.uri.fsPath !== filePath) return;

        const decorations = this.editor.deltaDecorations([], [{
            range: new this.monaco.Range(line, 1, line, 1),
            options: {
                isWholeLine: true,
                glyphMarginClassName: 'debug-breakpoint-glyph',
                glyphMarginHoverMessage: { value: '断点 (点击切换)' },
                className: 'debug-breakpoint-line',
                overviewRuler: { color: '#e51400', position: this.monaco.editor.OverviewRulerLane.Left },
            },
        }]);

        const existing = this.breakpointDecorations.get(filePath) || [];
        this.breakpointDecorations.set(filePath, [...existing, ...decorations]);
    }

    _removeBreakpointDecoration(filePath, line) {
        // 简化：清除该文件所有装饰并重建
        if (!this.editor) return;
        const existing = this.breakpointDecorations.get(filePath) || [];
        this.editor.deltaDecorations(existing, []);
        this.breakpointDecorations.delete(filePath);

        // 重建剩余断点装饰
        const remaining = this.breakpoints.filter(bp => bp.filePath === filePath && bp.line !== line);
        for (const bp of remaining) {
            this._addBreakpointDecoration(bp.filePath, bp.line);
        }
    }

    _refreshBreakpointDecorations(filePath) {
        if (!this.editor) return;
        const existing = this.breakpointDecorations.get(filePath) || [];
        this.editor.deltaDecorations(existing, []);
        this.breakpointDecorations.delete(filePath);

        const remaining = this.breakpoints.filter(bp => bp.filePath === filePath);
        for (const bp of remaining) {
            this._addBreakpointDecoration(bp.filePath, bp.line);
        }
    }

    // ── 适配器加载 ──
    async loadAdapters() {
        if (this._ipc) {
            try {
                this.adapters = await this._ipc.invoke('debug:getAdapters');
            } catch { this.adapters = []; }
        }
        this._updateAdapterSelect();
    }

    _updateAdapterSelect() {
        const select = this._toolbarEl?.querySelector('.debug-adapter-select');
        if (!select) return;
        // 保留第一个 placeholder option
        select.innerHTML = '<option value="">-- 选择调试器 --</option>';
        for (const adapter of this.adapters) {
            const opt = document.createElement('option');
            opt.value = adapter.type;
            opt.textContent = `${adapter.name} ${adapter.installed ? '✓' : '(未安装)'}`;
            opt.disabled = !adapter.installed;
            select.appendChild(opt);
        }
    }

    // ── 调试操作 ──
    async start() {
        const type = this._selectedAdapter || 'node';
        const filePath = this.editor?.getModel()?.uri?.fsPath;
        if (!filePath || !this._ipc) {
            this._appendConsole('error', '没有打开的文件或 IPC 不可用');
            return;
        }

        try {
            const result = await this._ipc.invoke('debug:startSession', type, filePath, filePath.replace(/[^/\\]+$/, ''));
            this.sessionId = result.sessionId;
            this._appendConsole('stdout', `调试会话 #${result.sessionId} 已启动 (${type}, 端口 ${result.port})`);

            // 应用已有断点
            const fileBreakpoints = this.breakpoints.filter(bp => bp.filePath === filePath);
            if (fileBreakpoints.length > 0) {
                await this._ipc.invoke('debug:setBreakpoints', this.sessionId, filePath, fileBreakpoints);
            }

            this._setStatus(`调试运行中 — ${type}`);
        } catch (err) {
            this._appendConsole('error', `启动失败: ${err.message || String(err)}`);
        }
    }

    async stop() {
        if (!this.sessionId || !this._ipc) return;
        await this._ipc.invoke('debug:stopSession', this.sessionId);
        this.sessionId = null;
        this._setStatus('调试已停止');
        this._appendConsole('stdout', '调试会话已终止');
    }

    async continue_() {
        if (!this.sessionId || !this._ipc) return;
        await this._ipc.invoke('debug:continue', this.sessionId);
        this._setStatus('继续执行中...');
    }

    async pause() {
        if (!this.sessionId || !this._ipc) return;
        await this._ipc.invoke('debug:pause', this.sessionId);
        this._setStatus('已暂停');
    }

    async stepOver() {
        if (!this.sessionId || !this._ipc) return;
        await this._ipc.invoke('debug:next', this.sessionId);
    }

    async stepIn() {
        if (!this.sessionId || !this._ipc) return;
        await this._ipc.invoke('debug:stepIn', this.sessionId);
    }

    async stepOut() {
        if (!this.sessionId || !this._ipc) return;
        await this._ipc.invoke('debug:stepOut', this.sessionId);
    }

    // ── 事件处理 ──
    handleDebugEvent(sessionId, event) {
        switch (event.event) {
            case 'consoleOutput':
                this._appendConsole(event.data.type, event.data.text);
                break;
            case 'paused':
                this._setStatus(`暂停 — ${event.data.reason || 'breakpoint'}`);
                this._updateVariables();
                this._updateCallStack();
                break;
            case 'continued':
                this._setStatus('运行中');
                this._clearVariables();
                this._clearCallStack();
                break;
            case 'stopped':
                this._setStatus('已停止');
                this.sessionId = null;
                this._appendConsole('stdout', `进程退出，代码: ${event.data.exitCode || 'N/A'}`);
                break;
            case 'breakpointsUpdated':
                // 断点验证后同步状态
                if (event.data.breakpoints) {
                    for (const bp of event.data.breakpoints) {
                        const existing = this.breakpoints.find(b => b.filePath === event.data.filePath && b.line === bp.line);
                        if (existing) existing.verifiedLine = bp.verifiedLine;
                    }
                    this._refreshBreakpointDecorations(event.data.filePath);
                }
                break;
            case 'error':
                this._appendConsole('error', event.data.message);
                this._setStatus(`错误: ${event.data.message}`);
                break;
        }
    }

    // ── 视图切换 ──
    toggle(visible) {
        if (visible !== undefined) {
            this.visible = visible;
        } else {
            this.visible = !this.visible;
        }
        if (this._panelRoot) {
            this._panelRoot.style.display = this.visible ? 'flex' : 'none';
        }
    }

    // ── 内部 UI 更新 ──
    _updateVariables() {
        if (!this._variablesEl) return;
        this._variablesEl.innerHTML = this.variables.length === 0
            ? '<div style="color:#808080;padding:4px 8px;font-size:11px;">无变量</div>'
            : this.variables.map(v => {
                const valStr = typeof v.value === 'object' ? JSON.stringify(v.value) : String(v.value);
                return `<div style="padding:1px 8px;font-size:11px;display:flex;justify-content:space-between;">
                    <span style="color:#9cdcfe;">${this._escapeHtml(v.name)}</span>
                    <span style="color:#ce9178;">${this._escapeHtml(valStr)}</span>
                    <span style="color:#808080;">${this._escapeHtml(v.type || '')}</span>
                </div>`;
            }).join('');
    }

    _updateCallStack() {
        if (!this._callStackEl) return;
        this._callStackEl.innerHTML = this.callStack.length === 0
            ? '<div style="color:#808080;padding:4px 8px;font-size:11px;">调用栈为空</div>'
            : this.callStack.map((frame, i) =>
                `<div style="padding:2px 8px;font-size:11px;cursor:pointer;${i === 0 ? 'background:#094771;' : ''}"
                    onclick="this.dispatchEvent(new CustomEvent('debug-frame-select', {bubbles:true, detail:${frame.id}}))">
                    <span style="color:#dcdcaa;">${this._escapeHtml(frame.name || '<anonymous>')}</span>
                    <span style="color:#808080;margin-left:8px;">${this._escapeHtml(frame.source?.name || '')}:${frame.line}</span>
                </div>`
            ).join('');
    }

    _updateBreakpointsList() {
        if (!this._breakpointsEl) return;
        this._breakpointsEl.innerHTML = this.breakpoints.length === 0
            ? '<div style="color:#808080;padding:4px 8px;font-size:11px;">无断点</div>'
            : this.breakpoints.map(bp => {
                const fileName = (bp.filePath || '').replace(/^.*[/\\]/, '');
                return `<div style="padding:1px 8px;font-size:11px;display:flex;align-items:center;gap:4px;">
                    <input type="checkbox" ${bp.enabled ? 'checked' : ''} style="margin:0;"
                        onchange="this.dispatchEvent(new CustomEvent('debug-bp-toggle',{bubbles:true,detail:${bp.line}}))">
                    <span style="color:#e51400;cursor:pointer;" title="${this._escapeHtml(bp.filePath)}:${bp.line}">●</span>
                    <span>${this._escapeHtml(fileName)}:${bp.line}</span>
                    ${bp.condition ? `<span style="color:#ce9178;font-size:10px;">if ${this._escapeHtml(bp.condition)}</span>` : ''}
                </div>`;
            }).join('');
    }

    _clearVariables() {
        if (this._variablesEl) this._variablesEl.innerHTML = '';
    }

    _clearCallStack() {
        if (this._callStackEl) this._callStackEl.innerHTML = '';
    }

    _setStatus(text) {
        if (this._statusBar) {
            this._statusBar.textContent = text;
            this._statusBar.style.display = 'block';
        }
    }

    _escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
exports.DebugPanel = DebugPanel;
