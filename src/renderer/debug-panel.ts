/**
 * TCIDE Debug Panel — P0 调试面板 UI
 *
 * 负责:
 *   - 在 Monaco Editor 边栏渲染断点标记
 *   - 变量监视面板 / 调用栈视图 / 调试控制台
 *   - 调试工具栏（启动/暂停/步进/停止）
 */
export class DebugPanel {
  private monaco: any = null;
  private editor: any = null;
  private containerEl: HTMLElement | null = null;
  private sessionId: number | null = null;
  private visible = false;
  private breakpointDecorations = new Map<string, string[]>();
  private breakpoints: any[] = [];
  private variables: any[] = [];
  private callStack: any[] = [];
  private consoleOutput: Array<{ type: string; text: string; timestamp: number }> = [];
  private adapters: any[] = [];
  private _ipc: any = null;
  private _panelRoot: HTMLElement | null = null;
  private _toolbarEl: HTMLElement | null = null;
  private _variablesEl: HTMLElement | null = null;
  private _callStackEl: HTMLElement | null = null;
  private _consoleEl: HTMLElement | null = null;
  private _consoleInputEl: HTMLInputElement | null = null;
  private _breakpointsEl: HTMLElement | null = null;
  private _statusBar: HTMLElement | null = null;
  private _selectedAdapter = '';

  init(monaco: any, editor: any, containerEl: HTMLElement, ipcRenderer?: any): void {
    this.monaco = monaco;
    this.editor = editor;
    this.containerEl = containerEl;
    this._ipc = ipcRenderer;
    this._buildPanel();
    this._registerEditorListeners();
    this.loadAdapters();
  }

  private _buildPanel(): void {
    const root = document.createElement('div');
    root.className = 'tcide-debug-panel';
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;background:var(--bg-primary,#1e1e1e);color:var(--fg-primary,#ccc);font-family:monospace;font-size:12px;';

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

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

    const variablesSection = this._buildSection('变量', 'debug-variables');
    this._variablesEl = variablesSection.querySelector('.section-content');
    body.appendChild(variablesSection);

    const callStackSection = this._buildSection('调用栈', 'debug-callstack');
    this._callStackEl = callStackSection.querySelector('.section-content');
    body.appendChild(callStackSection);

    const bpSection = this._buildSection('断点', 'debug-breakpoints');
    this._breakpointsEl = bpSection.querySelector('.section-content');
    body.appendChild(bpSection);

    const consoleSection = this._buildSection('调试控制台', 'debug-console');
    this._consoleEl = document.createElement('div');
    this._consoleEl.style.cssText = 'flex:1;min-height:80px;overflow-y:auto;padding:4px 8px;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;background:#1a1a1a;';
    consoleSection.querySelector('.section-content')!.appendChild(this._consoleEl);

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
    consoleSection.querySelector('.section-content')!.appendChild(inputRow);
    body.appendChild(consoleSection);
    root.appendChild(body);

    const statusBar = document.createElement('div');
    statusBar.className = 'debug-statusbar';
    statusBar.style.cssText = 'padding:2px 8px;background:#007acc;color:#fff;font-size:11px;flex-shrink:0;display:none;';
    statusBar.textContent = '调试器就绪';
    this._statusBar = statusBar;
    root.appendChild(statusBar);

    this._panelRoot = root;
    this._toolbarEl = toolbar;
    this.containerEl!.appendChild(root);
    this._bindToolbarEvents();
    this._bindConsoleInput();
  }

  private _buildSection(title: string, _cls: string): HTMLElement {
    const section = document.createElement('div');
    section.className = `debug-section`;
    section.style.cssText = 'border-bottom:1px solid #2a2a2a;flex-shrink:0;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:#252526;cursor:pointer;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;';
    header.textContent = title;
    header.onclick = () => {
      const content = header.nextElementSibling as HTMLElement;
      if (content) content.style.display = content.style.display === 'none' ? 'block' : 'none';
    };
    const content = document.createElement('div');
    content.className = 'section-content';
    content.style.cssText = 'max-height:200px;overflow-y:auto;';
    section.appendChild(header);
    section.appendChild(content);
    return section;
  }

  private _bindToolbarEvents(): void {
    const t = this._toolbarEl!;
    t.querySelector('.debug-btn-start')!.addEventListener('click', () => this.start());
    t.querySelector('.debug-btn-stop')!.addEventListener('click', () => this.stop());
    t.querySelector('.debug-btn-pause')!.addEventListener('click', () => this.pause());
    t.querySelector('.debug-btn-continue')!.addEventListener('click', () => this.continue_());
    t.querySelector('.debug-btn-stepover')!.addEventListener('click', () => this.stepOver());
    t.querySelector('.debug-btn-stepin')!.addEventListener('click', () => this.stepIn());
    t.querySelector('.debug-btn-stepout')!.addEventListener('click', () => this.stepOut());
    t.querySelector('.debug-adapter-select')!.addEventListener('change', (e: any) => { this._selectedAdapter = e.target.value; });
  }

  private _bindConsoleInput(): void {
    if (!this._consoleInputEl) return;
    this._consoleInputEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const expr = this._consoleInputEl!.value.trim();
        if (expr && this.sessionId && this._ipc) {
          this._appendConsole('input', `> ${expr}`);
          this._ipc.invoke('debug:evaluate', this.sessionId, expr).then((res: any) => {
            this._appendConsole(res.error ? 'error' : 'output', res.error || String(res.result));
          }).catch((err: any) => {
            this._appendConsole('error', err.message || String(err));
          });
        }
        this._consoleInputEl!.value = '';
      }
    };
  }

  private _appendConsole(type: string, text: string): void {
    this.consoleOutput.push({ type, text, timestamp: Date.now() });
    if (!this._consoleEl) return;
    const line = document.createElement('div');
    const colors: Record<string, string> = { input: '#569cd6', output: '#d4d4d4', error: '#f44747', stdout: '#6a9955', stderr: '#f44747' };
    line.style.color = colors[type] || '#d4d4d4';
    line.textContent = text;
    this._consoleEl.appendChild(line);
    this._consoleEl.scrollTop = this._consoleEl.scrollHeight;
  }

  private _registerEditorListeners(): void {
    if (!this.monaco || !this.editor) return;
    this.editor.onMouseDown((e: any) => {
      if (e.target.type === this.monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
          e.target.type === this.monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
        this._toggleBreakpoint(e.target.position.lineNumber);
      }
    });
    this.editor.addAction({
      id: 'debug-toggle-breakpoint',
      label: '切换断点',
      keybindings: [this.monaco.KeyCode.F9],
      run: () => { const pos = this.editor.getPosition(); if (pos) this._toggleBreakpoint(pos.lineNumber); },
    });
  }

  private _toggleBreakpoint(line: number): void {
    const model = this.editor?.getModel();
    const filePath = model?.uri?.fsPath || model?.uri?.path;
    if (!filePath) return;
    const existing = this.breakpoints.find(bp => bp.filePath === filePath && bp.line === line);
    if (existing) {
      this.breakpoints = this.breakpoints.filter(bp => bp !== existing);
      if (this.sessionId && this._ipc) {
        this._ipc.invoke('debug:setBreakpoints', this.sessionId, filePath, this.breakpoints.filter((b: any) => b.filePath === filePath));
      }
      this._removeBreakpointDecoration(filePath, line);
    } else {
      const bp = { line, filePath, column: 1, enabled: true, condition: null, temporary: false };
      this.breakpoints.push(bp);
      if (this.sessionId && this._ipc) {
        this._ipc.invoke('debug:setBreakpoints', this.sessionId, filePath, this.breakpoints.filter((b: any) => b.filePath === filePath));
      }
      this._addBreakpointDecoration(filePath, line);
    }
  }

  private _addBreakpointDecoration(filePath: string, line: number): void {
    if (!this.monaco || !this.editor) return;
    const model = this.editor.getModel();
    if (!model || (model.uri.fsPath !== filePath && model.uri.path !== filePath)) return;
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

  private _removeBreakpointDecoration(filePath: string, _line: number): void {
    if (!this.editor) return;
    const existing = this.breakpointDecorations.get(filePath) || [];
    this.editor.deltaDecorations(existing, []);
    this.breakpointDecorations.delete(filePath);
    for (const bp of this.breakpoints.filter(b => b.filePath === filePath)) {
      this._addBreakpointDecoration(bp.filePath, bp.line);
    }
  }

  async loadAdapters(): Promise<void> {
    if (this._ipc) {
      try { this.adapters = await this._ipc.invoke('debug:getAdapters'); } catch { this.adapters = []; }
    }
    this._updateAdapterSelect();
  }

  private _updateAdapterSelect(): void {
    const select = this._toolbarEl?.querySelector('.debug-adapter-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- 选择调试器 --</option>';
    for (const a of this.adapters) {
      const opt = document.createElement('option');
      opt.value = a.type;
      opt.textContent = `${a.name} ${a.installed ? '✓' : '(未安装)'}`;
      (opt as any).disabled = !a.installed;
      select.appendChild(opt);
    }
  }

  async start(): Promise<void> {
    const type = this._selectedAdapter || 'node';
    const model = this.editor?.getModel();
    const filePath = model?.uri?.fsPath || model?.uri?.path;
    if (!filePath || !this._ipc) { this._appendConsole('error', '没有打开的文件'); return; }
    try {
      const cwd = filePath.replace(/[^/\\]+$/, '');
      const result = await this._ipc.invoke('debug:startSession', type, filePath, cwd, {});
      this.sessionId = result.sessionId;
      this._appendConsole('stdout', `调试会话 #${result.sessionId} 已启动 (${type}, 端口 ${result.port})`);
      const fileBreakpoints = this.breakpoints.filter(bp => bp.filePath === filePath);
      if (fileBreakpoints.length > 0) {
        await this._ipc.invoke('debug:setBreakpoints', this.sessionId, filePath, fileBreakpoints);
      }
      this._setStatus(`调试运行中 — ${type}`);
    } catch (err: any) {
      this._appendConsole('error', `启动失败: ${err.message}`);
    }
  }

  async stop(): Promise<void> { if (this.sessionId && this._ipc) { await this._ipc.invoke('debug:stopSession', this.sessionId); this.sessionId = null; this._setStatus('已停止'); } }
  async continue_(): Promise<void> { if (this.sessionId && this._ipc) { await this._ipc.invoke('debug:continue', this.sessionId); this._setStatus('继续中...'); } }
  async pause(): Promise<void> { if (this.sessionId && this._ipc) { await this._ipc.invoke('debug:pause', this.sessionId); this._setStatus('已暂停'); } }
  async stepOver(): Promise<void> { if (this.sessionId && this._ipc) { await this._ipc.invoke('debug:next', this.sessionId); } }
  async stepIn(): Promise<void> { if (this.sessionId && this._ipc) { await this._ipc.invoke('debug:stepIn', this.sessionId); } }
  async stepOut(): Promise<void> { if (this.sessionId && this._ipc) { await this._ipc.invoke('debug:stepOut', this.sessionId); } }

  handleDebugEvent(sessionId: number, event: any): void {
    switch (event.event) {
      case 'consoleOutput': this._appendConsole(event.data.type, event.data.text); break;
      case 'paused': this._setStatus(`暂停 — ${event.data.reason || 'breakpoint'}`); break;
      case 'continued': this._setStatus('运行中'); break;
      case 'stopped': this._setStatus('已停止'); this.sessionId = null; break;
      case 'error': this._appendConsole('error', event.data.message); break;
    }
  }

  toggle(visible?: boolean): void {
    this.visible = visible !== undefined ? visible : !this.visible;
    if (this._panelRoot) this._panelRoot.style.display = this.visible ? 'flex' : 'none';
  }

  private _setStatus(text: string): void { if (this._statusBar) { this._statusBar.textContent = text; this._statusBar.style.display = 'block'; } }
}
