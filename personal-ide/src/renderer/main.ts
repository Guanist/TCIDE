/**
 * PersonalIDE - Renderer Main Entry
 * 三栏 UI 交互、Monaco Editor、文件树、AI 面板全部逻辑
 */
import * as monaco from 'monaco-editor';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

// ─────────────────────────────────────────
// 全局状态
// ─────────────────────────────────────────
interface OpenFile {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
  language: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachments?: AttachmentMeta[];
}

interface AttachmentMeta {
  id: string;
  name: string;
  path: string;
  size: number;
  type: 'image' | 'file';
  mime: string;
}

const IMG_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg']);
const TXT_EXTS = new Set(['.txt','.js','.ts','.tsx','.jsx','.json','.xml','.html','.css','.md','.py','.go','.rs','.java','.kt','.kts','.gradle','.yaml','.yml','.toml','.ini','.cfg','.sh','.bat','.cmd','.sql','.log','.csv']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_IMG_SIZE = 5 * 1024 * 1024;  // 5 MB

const state = {
  projectPath: null as string | null,
  openFiles: [] as OpenFile[],
  activeFileIndex: -1,
  chatHistory: [] as ChatMessage[],
  isStreaming: false,
  currentStreamContent: '',
  zenMode: false,
  sidebarWidth: 240,
  aiPanelWidth: 480,
  config: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-v4-pro',
    builderModel: 'deepseek-reasoner',
    coderModel: 'deepseek-v4-pro',
  },
};

let attachments: AttachmentMeta[] = [];
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let xtermTerminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;

// ─────────────────────────────────────────
// Monaco Editor 初始化
// ─────────────────────────────────────────
function initMonaco(): void {
  // 配置 Monaco（去除多余功能，保持轻量）
  self.MonacoEnvironment = {
    getWorker(_workerId: string, _label: string) {
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        { type: 'module' }
      );
    },
  };

  // 注入暗色主题（Trae 风格）
  monaco.editor.defineTheme('trae-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955' },
      { token: 'keyword', foreground: '569CD6' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'type', foreground: '4EC9B0' },
      { token: 'class', foreground: '4EC9B0' },
      { token: 'function', foreground: 'DCDCAA' },
    ],
    colors: {
      'editor.background': '#1E1E1E',
      'editor.foreground': '#D4D4D4',
      'editor.lineHighlightBackground': '#2A2D2E',
      'editor.selectionBackground': '#094771',
      'editorLineNumber.foreground': '#858585',
      'editorCursor.foreground': '#AEAFAD',
      'editorIndentGuide.background': '#3C3C3C',
      'editorWidget.background': '#252526',
      'editorSuggestWidget.background': '#252526',
      'editorSuggestWidget.border': '#3C3C3C',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': '#42424280',
      'scrollbarSlider.hoverBackground': '#686868',
    },
  });

  const container = document.getElementById('monaco-container')!;

  editor = monaco.editor.create(container, {
    value: '',
    language: 'kotlin',
    theme: 'trae-dark',
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
    fontLigatures: true,
    lineHeight: 22,
    letterSpacing: 0,
    minimap: { enabled: true, scale: 1, showSlider: 'mouseover', renderCharacters: false, maxColumn: 80 },
    scrollBeyondLastLine: false,
    renderWhitespace: 'none',
    bracketPairColorization: { enabled: false },
    suggest: { showWords: false },
    quickSuggestions: false,
    parameterHints: { enabled: false },
    padding: { top: 12, bottom: 12 },
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
    },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    renderLineHighlight: 'line',
    smoothScrolling: false,
    mouseWheelZoom: false,
    cursorBlinking: 'solid',
    cursorSmoothCaretAnimation: 'off',
    wordWrap: 'off',
    automaticLayout: true,
  });

  // 编辑器事件
  editor.onDidChangeModelContent(() => {
    if (state.activeFileIndex >= 0) {
      const model = editor!.getModel();
      if (model) {
        state.openFiles[state.activeFileIndex].content = model.getValue();
        state.openFiles[state.activeFileIndex].dirty = true;
      }
    }
  });

  editor.onDidChangeCursorPosition((e) => {
    document.getElementById('status-position')!.textContent =
      `行 ${e.position.lineNumber}, 列 ${e.position.column}`;
  });

  // 光标位置同步到状态栏
  updateEditorStatusBar();

  // ── AI 实时代码补全（Inline Completion） ──
  const inlineLangs = ['javascript', 'typescript', 'python', 'java', 'kotlin',
    'go', 'rust', 'cpp', 'c', 'csharp', 'swift', 'ruby', 'php',
    'html', 'css', 'scss', 'json', 'yaml', 'xml', 'markdown', 'shell', 'sql', 'dart'];

  let completionTimer: ReturnType<typeof setTimeout> | null = null;
  let completionRequestId = 0;

  for (const lang of inlineLangs) {
    monaco.languages.registerInlineCompletionsProvider(lang, {
      provideInlineCompletions: async (model, position, context, token) => {
        if (context.triggerKind !== monaco.languages.InlineCompletionTriggerKind.Automatic) {
          return { items: [] };
        }
        // 只在行尾触发
        const lineContent = model.getLineContent(position.lineNumber);
        if (position.column <= lineContent.length && lineContent.trim().length > 0) return { items: [] };
        // 当前行空白不补全
        if (lineContent.trim().length === 0) return { items: [] };

        const requestId = ++completionRequestId;
        return new Promise((resolve) => {
          if (completionTimer) clearTimeout(completionTimer);
          completionTimer = setTimeout(async () => {
            if (token.isCancellationRequested || requestId !== completionRequestId) {
              resolve({ items: [] }); return;
            }
            try {
              const startLine = Math.max(1, position.lineNumber - 25);
              const textBefore = model.getValueInRange({
                startLineNumber: startLine, startColumn: 1,
                endLineNumber: position.lineNumber, endColumn: position.column,
              });
              const language = model.getLanguageId();
              const completion = await window.api.aiComplete(textBefore, language);
              if (!completion || token.isCancellationRequested || requestId !== completionRequestId) {
                resolve({ items: [] }); return;
              }
              resolve({
                items: [{ insertText: completion, range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column } }]
              });
            } catch { resolve({ items: [] }); }
          }, 350);
        });
      },
      freeInlineCompletions: () => {},
    });
  }

  // ── AI 一键编程 Action ──────────────────
  // 快捷键：Ctrl+Shift+I 或右键菜单
  editor.addAction({
    id: 'tcide-ai-insert',
    label: 'AI 生成代码并插入',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI],
    contextMenuGroupId: 'tcide-ai',
    contextMenuOrder: 1,
    run: (ed: monaco.editor.IStandaloneCodeEditor) => {
      const selection = ed.getSelection();
      if (!selection) return;
      const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
      const prompt = selectedText
        ? `请改进以下代码，直接返回完整代码块，不要解释：\n\n${selectedText}`
        : `请根据当前文件上下文生成代码。当前光标位置在行 ${selection?.startLineNumber}。`;
      aiGenerateAndInsert(ed, prompt, selection);
    },
  });

  editor.addAction({
    id: 'tcide-ai-explain',
    label: 'AI 解释代码',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE],
    contextMenuGroupId: 'tcide-ai',
    contextMenuOrder: 2,
    run: (ed: monaco.editor.IStandaloneCodeEditor) => {
      const selection = ed.getSelection();
      if (!selection) return;
      const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
      if (!selectedText.trim()) {
        showMiniToast('请先选中要解释的代码');
        return;
      }
      const prompt = `请用中文简洁解释以下代码的功能（不超过5句话）：\n\n${selectedText}`;
      aiGenerateAndInsert(ed, prompt, selection, true); // true = 插入为注释
    },
  });

  // 监听窗口 resize
  window.addEventListener('resize', () => {
    editor?.layout();
  });
}

// ─────────────────────────────────────────
// 文件树
// ─────────────────────────────────────────
function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return '📁';
  const ext = name.split('.').pop()?.toLowerCase();
  const icons: Record<string, string> = {
    kt: '🇰', java: '☕', xml: '📄', gradle: '⚙️',
    kts: '⚙️', json: '📋', md: '📝', txt: '📃',
    sh: '🖥️', bat: '📦', ps1: '💻', go: '🐹',
    rs: '🦀', py: '🐍', ts: '📘', tsx: '⚛️',
  };
  return icons[ext || ''] || '📄';
}

function renderFileTree(nodes: Array<{ name: string; path: string; isDirectory: boolean; children?: unknown[] }>, container: HTMLElement, depth = 0): void {
  for (const node of nodes) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.style.paddingLeft = `${8 + depth * 16}px`;
    item.dataset.path = node.path;
    item.dataset.isDir = String(node.isDirectory);

    const arrow = document.createElement('span');
    arrow.className = 'arrow' + (node.isDirectory ? '' : ' empty');
    arrow.textContent = node.isDirectory ? '▶' : '';

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = getFileIcon(node.name, node.isDirectory);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = node.name;

    item.appendChild(arrow);
    item.appendChild(icon);
    item.appendChild(name);
    container.appendChild(item);

    // 点击事件
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (node.isDirectory) {
        toggleTreeNode(item, node as { name: string; path: string; isDirectory: boolean; children?: Array<{ name: string; path: string; isDirectory: boolean }> });
      } else {
        openFile(node.path, node.name);
      }
    });

    // 右键菜单
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e as MouseEvent, node);
    });
  }
}

function toggleTreeNode(item: HTMLElement, node: { children?: Array<{ name: string; path: string; isDirectory: boolean }> }): void {
  const arrow = item.querySelector('.arrow')!;
  const existingChildren = item.nextElementSibling;

  if (arrow.classList.contains('open')) {
    // 折叠
    arrow.classList.remove('open');
    if (existingChildren?.classList.contains('tree-children')) {
      existingChildren.remove();
    }
  } else {
    // 展开
    arrow.classList.add('open');
    if (node.children && node.children.length > 0) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      childContainer.style.display = 'block';
      item.after(childContainer);
      renderFileTree(node.children as Array<{ name: string; path: string; isDirectory: boolean; children?: unknown[] }>, childContainer, 0);
    }
  }
}

async function loadFileTree(projectPath: string): Promise<void> {
  const container = document.getElementById('file-tree')!;
  container.innerHTML = '';

  try {
    const tree = await window.api.readDirectory(projectPath) as Array<{ name: string; path: string; isDirectory: boolean; children?: Array<{ name: string; path: string; isDirectory: boolean }> }>;
    (state as Record<string, unknown>).fileTree = tree;
    if (tree.length === 0) {
      container.innerHTML = '<div class="empty-state">项目为空</div>';
      return;
    }
    renderFileTree(tree, container);

    // ⚙ Gradle 检测
    const gradleBadges = document.getElementById('status-gradle');
    if (gradleBadges) {
      const hasGradle = tree.some((n: { name: string }) =>
        ['gradlew', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].includes(n.name)
      );
      gradleBadges.style.display = hasGradle ? '' : 'none';
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state">加载失败: ${(err as Error).message}</div>`;
  }
}

// ─────────────────────────────────────────
// 文件操作
// ─────────────────────────────────────────
async function openFile(filePath: string, name: string): Promise<void> {
  // 检查是否已打开
  const existing = state.openFiles.findIndex(f => f.path === filePath);
  if (existing >= 0) {
    switchToFile(existing);
    return;
  }

  try {
    const content = await window.api.readFile(filePath);
    const lang = detectLanguage(name);

    state.openFiles.push({ path: filePath, name, content, dirty: false, language: lang });
    const index = state.openFiles.length - 1;
    renderEditorTabs();
    switchToFile(index);

    // 更新文件树选中
    document.querySelectorAll('.tree-item').forEach(el => {
      el.classList.toggle('selected', (el as HTMLElement).dataset.path === filePath);
    });
  } catch (err) {
    console.error('打开文件失败:', err);
  }
}

function switchToFile(index: number): void {
  if (index < 0 || index >= state.openFiles.length) return;

  state.activeFileIndex = index;
  const file = state.openFiles[index];

  const model = monaco.editor.createModel(file.content, file.language);
  editor?.setModel(model);

  renderEditorTabs();
  updateEditorStatusBar(file.language);

  // 更新文件树选中
  document.querySelectorAll('.tree-item').forEach(el => {
    el.classList.toggle('selected', (el as HTMLElement).dataset.path === file.path);
  });
}

function renderEditorTabs(): void {
  const tabs = document.getElementById('editor-tabs')!;
  tabs.innerHTML = '';

  state.openFiles.forEach((file, index) => {
    const tab = document.createElement('div');
    tab.className = 'editor-tab' + (index === state.activeFileIndex ? ' active' : '');
    tab.innerHTML = `
      <span class="tab-icon">${getFileIcon(file.name, false)}</span>
      <span class="tab-name">${file.name}${file.dirty ? ' ●' : ''}</span>
      <button class="tab-close" data-index="${index}">×</button>
    `;

    tab.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('tab-close')) {
        closeFile(parseInt(target.dataset.index!));
      } else {
        switchToFile(index);
      }
    });

    tabs.appendChild(tab);
  });
}

function closeFile(index: number): void {
  if (index < 0 || index >= state.openFiles.length) return;

  state.openFiles.splice(index, 1);
  if (state.activeFileIndex >= state.openFiles.length) {
    state.activeFileIndex = Math.max(0, state.openFiles.length - 1);
  }

  renderEditorTabs();
  if (state.openFiles.length === 0) {
    editor?.setModel(null);
  } else {
    switchToFile(state.activeFileIndex);
  }
}

function detectLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const langs: Record<string, string> = {
    kt: 'kotlin', java: 'java', xml: 'xml', gradle: 'gradle',
    kts: 'kotlin', json: 'json', md: 'markdown', txt: 'plainText',
    sh: 'shell', bat: 'bat', ps1: 'powershell', go: 'go',
    rs: 'rust', py: 'python', ts: 'typescript', tsx: 'typescript',
    js: 'javascript', yml: 'yaml', yaml: 'yaml', toml: 'toml',
  };
  return langs[ext || ''] || 'plainText';
}

function updateEditorStatusBar(language?: string): void {
  if (language) {
    document.getElementById('status-language')!.textContent = language;
  }
}

// ─────────────────────────────────────────
// AI 面板 - Chat
// ─────────────────────────────────────────
function addChatMessage(role: 'user' | 'assistant' | 'system', content: string, attachList?: AttachmentMeta[]): void {
  const container = document.getElementById('chat-messages')!;
  const welcome = container.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  const msg = document.createElement('div');
  msg.className = `chat-message ${role}`;

  const labels: Record<string, string> = { user: '你', assistant: 'AI', system: '系统' };
  const label = labels[role] || role;

  let attachHtml = '';
  if (attachList && attachList.length > 0) {
    const items = attachList.map(a => {
      if (a.type === 'image') {
        return `<img class="msg-attachment-img" src="tcide://${encodeURIComponent(a.name)}" alt="${a.name}" data-path="${a.path}">`;
      }
      return `<span class="msg-attachment">${fileIcon(a.name.slice(a.name.lastIndexOf('.')))} ${a.name}</span>`;
    }).join('');
    attachHtml = `<div class="msg-attachments">${items}</div>`;
  }

  msg.innerHTML = `
    <div class="msg-role">${label}</div>
    <div class="msg-content">${renderMarkdown(content)}${attachHtml}</div>
  `;

  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function appendStreamChunk(chunk: string): void {
  const container = document.getElementById('chat-messages')!;
  let lastMsg = container.lastElementChild as HTMLElement;

  if (!lastMsg || !lastMsg.classList.contains('assistant')) {
    lastMsg = document.createElement('div');
    lastMsg.className = 'chat-message assistant';
    lastMsg.innerHTML = '<div class="msg-role">AI</div><div class="msg-content"></div>';
    container.appendChild(lastMsg);
  }

  state.currentStreamContent += chunk;
  const contentEl = lastMsg.querySelector('.msg-content')!;
  contentEl.innerHTML = renderMarkdown(state.currentStreamContent);
  container.scrollTop = container.scrollHeight;
}

function renderMarkdown(text: string): string {
  // 先用占位符替换代码块，处理完其他 markdown 后再还原
  const codeBlocks: Array<{ lang: string; code: string }> = [];
  let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    codeBlocks.push({ lang: lang || '', code });
    return `___CODEBLOCK_${codeBlocks.length - 1}___`;
  });

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^\*\*([^*]+)\*\*/gm, '<strong>$1</strong>');
  html = html.replace(/^\*([^*]+)\*/gm, '<em>$1</em>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  html = html.replace(/\n\n/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');

  // 还原代码块，SVG/HTML 用预览组件
  html = html.replace(/___CODEBLOCK_(\d+)___/g, (_m, idx) => {
    const block = codeBlocks[parseInt(idx)];
    if (!block) return '';
    const escaped = block.code
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // 检测 SVG/HTML 内容
    const isSVG = /<svg\b[\s\S]*?<\/svg>/i.test(block.code.trim());
    const isHTML = /<html\b|<body\b/i.test(block.code.trim()) && isSVG;
    const canPreview = isSVG || isHTML;

    if (canPreview) {
      // 生成 HTML blob data URL 用于 iframe 预览
      const htmlContent = isHTML ? block.code :
        '<html><body style="margin:0;background:transparent;">' + block.code + '</body></html>';
      const blobData = btoa(unescape(encodeURIComponent(htmlContent)));
      const dataUrl = 'data:text/html;base64,' + blobData;
      const id = 'svgpv_' + Math.random().toString(36).slice(2, 8);
      return `<div class="svg-preview-block">
        <div class="svg-preview-toolbar">
          <button class="svg-toggle-btn active" data-target="${id}-preview" data-hide="${id}-code" onclick="var p=document.getElementById('${id}-preview'),c=document.getElementById('${id}-code');if(p.style.display==='none'){p.style.display='';c.style.display='none';this.classList.add('active');this.nextElementSibling.classList.remove('active')}">预览</button>
          <button class="svg-toggle-btn" data-target="${id}-code" data-hide="${id}-preview" onclick="var p=document.getElementById('${id}-preview'),c=document.getElementById('${id}-code');if(c.style.display==='none'){c.style.display='';p.style.display='none';this.classList.add('active');this.previousElementSibling.classList.remove('active')}">代码</button>
          <button class="svg-copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(block.code)}'))" title="复制代码">📋</button>
        </div>
        <div id="${id}-preview" class="svg-preview-view">
          <iframe sandbox="allow-scripts" src="${dataUrl}" class="svg-preview-iframe" loading="lazy"></iframe>
        </div>
        <pre id="${id}-code" class="svg-code-view" style="display:none"><code class="lang-${block.lang}">${escaped}</code></pre>
      </div>`;
    }

    return `<pre><code class="lang-${block.lang}">${escaped}</code></pre>`;
  });

  return html;
}

// ─────────────────────────────────────────
// 附件管理
// ─────────────────────────────────────────
function isImageFile(name: string): boolean {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  return IMG_EXTS.has(ext);
}

function isTextFile(name: string): boolean {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  return TXT_EXTS.has(ext);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function fileIcon(ext: string): string {
  const map: Record<string, string> = {
    '.ts': '📘', '.tsx': '📘', '.js': '📒', '.jsx': '📒',
    '.json': '📋', '.xml': '📋', '.html': '🌐', '.css': '🎨',
    '.md': '📝', '.py': '🐍', '.go': '🔵', '.rs': '🦀',
    '.java': '☕', '.kt': '☕', '.kts': '☕', '.gradle': '🐘',
    '.yaml': '⚙️', '.yml': '⚙️', '.toml': '⚙️', '.ini': '⚙️',
    '.sh': '💻', '.bat': '💻', '.sql': '🗃️', '.csv': '📊',
    '.txt': '📄', '.log': '📄',
  };
  return map[ext] || '📎';
}

async function openAttachDialog(): Promise<void> {
  try {
    const files = await window.api.openFileDialog();
    if (!files || files.length === 0) return;
    for (const f of files) {
      const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
      const isImg = IMG_EXTS.has(ext);
      const maxSize = isImg ? MAX_IMG_SIZE : MAX_FILE_SIZE;
      if (f.size > maxSize) {
        showToast(`文件 "${f.name}" 超过 ${formatFileSize(maxSize)} 限制`, 'warn');
        continue;
      }
      const id = crypto.randomUUID();
      attachments.push({ id, name: f.name, path: f.path, size: f.size, type: isImg ? 'image' : 'file', mime: isImg ? 'image/' + ext.slice(1) : 'text/plain' });
    }
    renderAttachmentBar();
  } catch (err: unknown) {
    showToast('打开文件失败: ' + ((err as Error).message || err), 'error');
  }
}

function removeAttachment(id: string): void {
  attachments = attachments.filter(a => a.id !== id);
  renderAttachmentBar();
}

function renderAttachmentBar(): void {
  const bar = document.getElementById('attachment-preview')!;
  if (attachments.length === 0) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  bar.innerHTML = attachments.map(a => {
    const ext = a.name.slice(a.name.lastIndexOf('.'));
    const isImg = a.type === 'image';
    return `<div class="attachment-item ${isImg ? 'att-image' : ''}" data-att-id="${a.id}" title="${a.name}">
      ${isImg ? `<span class="att-icon">🖼️</span><span class="att-name">${a.name}</span>`
              : `<span class="att-icon">${fileIcon(ext)}</span><span class="att-name">${a.name}</span><span class="att-size">${formatFileSize(a.size)}</span>`}
      <span class="att-remove" data-remove="${a.id}">✕</span>
    </div>`;
  }).join('');
  // 绑定删除事件
  bar.querySelectorAll('.att-remove').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      removeAttachment((el as HTMLElement).dataset.remove!);
    });
  });
}

// ─────────────────────────────────────────
// 模型快速切换
// ─────────────────────────────────────────
function populateModelSelector(): void {
  const sel = document.getElementById('quick-model-select') as HTMLSelectElement;
  if (!sel) return;

  const provider = state.config.provider || 'deepseek';
  const providerModels = modelListCache.filter(m => m.provider === provider);

  // 头部：已配置 provider 的模型
  sel.innerHTML = '<option value="">-- 选择模型 --</option>';
  if (providerModels.length > 0) {
    const icon = provider === 'deepseek' ? '🐋' : provider === 'huoshan' ? '🌋' : provider === 'ollama' ? '🦙' : '⚙️';
    for (const m of providerModels) {
      const reasoning = m.reasoning ? ' 🧠' : '';
      const selected = state.config.model === m.id ? ' selected' : '';
      sel.innerHTML += `<option value="${m.provider}|${m.id}"${selected}>${icon} ${m.name}${reasoning}</option>`;
    }
  }

  // 分隔线 + 其他 provider 的模型（归入"自定义"）
  const otherModels = modelListCache.filter(m => m.provider !== provider);
  if (otherModels.length > 0) {
    sel.innerHTML += '<option disabled>──────────</option>';
    for (const m of otherModels) {
      sel.innerHTML += `<option value="${m.provider}|${m.id}">🔌 ${m.name} (${m.provider})</option>`;
    }
  }

  updateModelStatusDot();
}

function updateModelStatusDot(): void {
  const dot = document.getElementById('model-status')!;
  if (state.config.apiKey) {
    dot.className = 'model-status connected';
    dot.title = '已配置: ' + state.config.model;
  } else {
    dot.className = 'model-status disconnected';
    dot.title = '未配置 API Key';
  }
}

function onQuickModelChange(): void {
  const sel = document.getElementById('quick-model-select') as HTMLSelectElement;
  const val = sel.value;
  if (!val) return;
  const [provider, modelId] = val.split('|');
  const meta = modelListCache.find(m => m.provider === provider && m.id === modelId);
  if (!meta) return;
  state.config.provider = provider;
  state.config.model = modelId;
  // 自动填充 baseUrl
  const defaultBaseUrls: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    huoshan: 'https://ark.cn-beijing.volces.com/api/v3',
    anthropic: 'https://api.anthropic.com',
    custom: '',
  };
  state.config.baseUrl = defaultBaseUrls[provider] || '';
  updateModelStatusDot();
  showToast(`已切换到 ${meta.name}`, 'info');
  saveConfig().catch(() => {});
}

async function sendToAI(): Promise<void> {
  const input = document.getElementById('chat-input') as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text && attachments.length === 0) return;
  if (state.isStreaming) return;

  if (!state.config.apiKey) {
    addChatMessage('system' as 'user', '请先在设置中配置 API Key');
    switchToSettingsTab();
    return;
  }

  input.value = '';

  // ── /task 命令：Builder → Coder 自动执行循环 ──
  if (text.startsWith('/task') && state.projectPath) {
    const desc = text.replace(/^\/task\s*/, '').trim();
    if (!desc) {
      addChatMessage('assistant', '用法：/task <任务描述>\n\n例如：\n/task 创建用户登录 API\n/task 添加 Redis 缓存层');
      return;
    }
    addChatMessage('user', text);
    await executeTaskAgentLoop(desc);
    return;
  }

  addChatMessage('user', text, [...attachments]);

  // 构建附件上下文
  let attachContext = '';
  if (attachments.length > 0) {
    for (const a of attachments) {
      if (a.type === 'file') {
        try {
          const content = await window.api.readTextFile(a.path);
          if (content) {
            attachContext += `\n---\n📄 ${a.name}:\n${content.slice(0, 5000)}\n---\n`;
          }
        } catch (_) { /* 跳过 */ }
      }
    }
  }
  const currentAttach = [...attachments];
  attachments = [];
  renderAttachmentBar();

  state.isStreaming = true;
  state.currentStreamContent = '';
  document.getElementById('btn-send')!.classList.add('hidden');
  document.getElementById('btn-abort')!.classList.remove('hidden');

  try {
    const userContent = attachContext ? text + '\n\n' + attachContext : text;
    const messages = [
      ...state.chatHistory.slice(-20).map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userContent },
    ];

    window.api.sendToAIStream(messages, { model: state.config.model });

    state.chatHistory.push({
      id: crypto.randomUUID(), role: 'user', content: text,
      timestamp: Date.now(), attachments: currentAttach.length > 0 ? currentAttach : undefined
    });
  } catch (err) {
    addChatMessage('assistant', `错误: ${(err as Error).message}`);
    stopStreaming();
  }
}

function stopStreaming(): void {
  window.api.abortAI();
  state.isStreaming = false;
  state.currentStreamContent = '';
  document.getElementById('btn-send')!.classList.remove('hidden');
  document.getElementById('btn-abort')!.classList.add('hidden');
}

// ── Agent 自动执行循环（/task 命令） ──
async function executeTaskAgentLoop(description: string): Promise<void> {
  if (!state.projectPath) {
    addChatMessage('assistant', '⚠️ 请先打开一个项目文件夹');
    return;
  }

  // Step 1: Builder 分解任务
  addChatMessage('assistant', '🧱 **Builder 正在分析需求…**');
  let tasks: any[];
  try {
    tasks = await window.api.runBuilder(description, { projectPath: state.projectPath });
    if (!tasks || (tasks as any).length === 0) {
      addChatMessage('assistant', '⚠️ Builder 未生成有效任务，请更具体地描述需求。');
      return;
    }
  } catch (err: any) {
    addChatMessage('assistant', `❌ Builder 出错: ${err?.message || err}`);
    return;
  }

  // 显示计划
  const planLines = tasks.map((t: any, i: number) =>
    `${i + 1}. ${t.title || t.name || t.description || `子任务 ${i + 1}`}`);
  addChatMessage('assistant', `📋 **执行计划**（共 ${tasks.length} 个任务）：

${planLines.join('\n')}`);

  // Step 2: Coder 逐个执行 + 自动修复
  let successCount = 0;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const title = task.title || task.name || `任务 ${i + 1}`;
    addChatMessage('assistant', `🔧 **[${i + 1}/${tasks.length}] ${title}**`);

    try {
      let result = await window.api.runCoder(task, state.projectPath);
      let retries = 0;
      const maxRetries = 2;

      // 自动修复循环
      while (!result.success && retries < maxRetries) {
        retries++;
        addChatMessage('assistant', `⚠️ ${title} 失败（第 ${retries} 次尝试），自动分析错误…`);

        const fixTask = {
          ...task,
          description: task.description || task.title || '',
          previousError: result.output?.slice(0, 800) || '',
        };

        try {
          result = await window.api.runCoder(fixTask, state.projectPath);
        } catch { break; }
      }

      if (result.success) {
        successCount++;
        const preview = result.output?.slice(0, 250) || '';
        addChatMessage('assistant', `✅ ${title} 完成${preview ? '\n\n\`\`\`\n' + preview + '\n\`\`\`' : ''}`);
      } else {
        addChatMessage('assistant', `❌ ${title} 未能完成: ${result.output?.slice(0, 200) || '未知错误'}`);
      }
    } catch (err: any) {
      addChatMessage('assistant', `❌ ${title} 异常: ${err?.message || err}`);
    }
  }

  addChatMessage('assistant', `🏁 **全部完成！** ${successCount}/${tasks.length} 个任务成功。`);
}

// ─────────────────────────────────────────
// 轻量 Toast 提示
// ─────────────────────────────────────────
function showToast(text: string, type: 'info' | 'warn' | 'error' = 'info'): void {
  const existing = document.getElementById('tcide-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'tcide-toast';
  toast.textContent = text;
  toast.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translate(-50%,0);z-index:99999;' +
    'background:' + (type === 'error' ? '#ef4444' : type === 'warn' ? '#f59e0b' : 'var(--tc-orange,#FF8C00)') + ';' +
    'color:#fff;padding:8px 24px;border-radius:6px;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.4);' +
    'animation:fadeIn 0.2s ease-out;pointer-events:none;user-select:none;' +
    'font-family:"Segoe UI","Microsoft YaHei",sans-serif;';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ─────────────────────────────────────────
// AI 代码生成 & 插入（Monaco 集成）
// ─────────────────────────────────────────

/** 提取 Markdown 代码块内容 */
function extractCodeBlocks(text: string): string {
  const blocks: string[] = [];
  const fenceRegex = /```(?:[a-zA-Z+]+)?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  if (blocks.length === 0) {
    return text.replace(/^[`*#>\-\s]+/gm, '').trim();
  }
  return blocks.join('\n\n');
}

/** 构建滑动窗口上下文（最近 N 轮对话 + 当前文件上下文）*/
function buildSlidingWindowContext(
  chatHistory: ChatMessage[],
  maxRounds: number = 5,
  maxFileChars: number = 4000
): Array<{ role: string; content: string }> {
  const recent = chatHistory.filter(m => m.role !== 'system').slice(-maxRounds * 2);
  const messages = recent.map(m => ({ role: m.role, content: m.content }));
  if (editor && state.openFiles.length > 0 && state.activeFileIndex >= 0) {
    const file = state.openFiles[state.activeFileIndex];
    const content = editor.getValue();
    if (content.length > 0) {
      const snippet = content.length > maxFileChars
        ? content.slice(0, maxFileChars) + '\n\n... (已截断)'
        : content;
      messages.unshift({
        role: 'system',
        content: `当前正在编辑文件: ${file.path}\n\n${snippet}`,
      });
    }
  }
  return messages;
}

/** 错误降级：返回缓存的模板提示 */
function getFallbackResponse(): string {
  return '// 网络异常，请检查 API 配置后重试\n// 提示：设置 → 模型服务商 → 测试连接';
}

/** Mini Toast 提示 */
function showMiniToast(msg: string, duration: number = 2000): void {
  const existing = document.getElementById('tcide-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'tcide-toast';
  toast.textContent = msg;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '48px', left: '50%', transform: 'translateX(-50%)',
    background: '#333', color: '#fff', padding: '8px 20px', borderRadius: '6px',
    fontSize: '13px', zIndex: '9999', opacity: '0.9', transition: 'opacity 0.3s',
  });
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Diff 预览 ──
let diffState: { selection: monaco.Selection; insertText: string; editor: monaco.editor.IStandaloneCodeEditor } | null = null;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function computeLineDiff(original: string[], modified: string[]): { o: string[]; m: string[] } {
  const maxLen = Math.max(original.length, modified.length);
  const oResult: string[] = []; const mResult: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const ol = original[i]; const ml = modified[i];
    if (ol === undefined) {
      oResult.push('<div class="diff-empty"></div>');
      mResult.push(`<div class="diff-added">+ ${escapeHtml(ml)}</div>`);
    } else if (ml === undefined) {
      oResult.push(`<div class="diff-removed">- ${escapeHtml(ol)}</div>`);
      mResult.push('<div class="diff-empty"></div>');
    } else if (ol === ml) {
      oResult.push(`<div class="diff-unchanged">  ${escapeHtml(ol)}</div>`);
      mResult.push(`<div class="diff-unchanged">  ${escapeHtml(ml)}</div>`);
    } else {
      oResult.push(`<div class="diff-removed">- ${escapeHtml(ol)}</div>`);
      mResult.push(`<div class="diff-added">+ ${escapeHtml(ml)}</div>`);
    }
  }
  return { o: oResult, m: mResult };
}

function showDiffModal(originalText: string, modifiedText: string, selection: monaco.Selection, editor: monaco.editor.IStandaloneCodeEditor): void {
  diffState = { selection, insertText: modifiedText, editor };
  const modal = document.getElementById('diff-modal')!;
  const diff = computeLineDiff(originalText.split('\n'), modifiedText.split('\n'));
  document.getElementById('diff-original-content')!.innerHTML = diff.o.join('');
  document.getElementById('diff-modified-content')!.innerHTML = diff.m.join('');
  modal.style.display = 'flex';
  document.getElementById('diff-accept')!.focus();
}

function acceptDiff(): void {
  if (!diffState) return;
  diffState.editor.executeEdits('tcide-ai', [{ range: diffState.selection, text: diffState.insertText, forceMoveMarkers: true }]);
  closeDiffModal();
  showMiniToast('✓ 变更已应用');
}

function closeDiffModal(): void {
  diffState = null;
  document.getElementById('diff-modal')!.style.display = 'none';
}

// 暴露到全局（供 HTML onclick 使用）
(window as any).acceptDiff = acceptDiff;
(window as any).closeDiffModal = closeDiffModal;

/** AI 生成代码并插入到编辑器 */
async function aiGenerateAndInsert(
  ed: monaco.editor.IStandaloneCodeEditor,
  prompt: string,
  selection: monaco.Selection,
  asComment: boolean = false
): Promise<void> {
  if (!state.config.apiKey && state.config.provider !== 'ollama') {
    showMiniToast('请先在设置中配置 API Key');
    return;
  }
  showMiniToast('AI 正在生成...');
  const messages = buildSlidingWindowContext(state.chatHistory, 5, 4000);
  messages.push({ role: 'user', content: prompt });
  try {
    const result = await window.api.sendToAI(messages, { model: state.config.model });
    const code = extractCodeBlocks(result);
    const originalText = ed.getModel()?.getValueInRange(selection) || '';
    const insertText = asComment ? `// [AI] ${code.split('\n').join('\n// ')}` : code;

    // 有原始选中文本 → Diff 预览；无原文（空选择）→ 直接插入
    if (originalText.trim() && originalText !== insertText) {
      showDiffModal(originalText, insertText, selection, ed);
    } else {
      ed.executeEdits('tcide-ai', [{
        range: selection,
        text: insertText,
        forceMoveMarkers: true,
      }]);
      showMiniToast('✓ 代码已插入');
    }
  } catch (err) {
    showMiniToast(`生成失败: ${(err as Error).message}`);
  }
}

// Settings code already embedded above - this comment prevents duplicate declarations

// ─────────────────────────────────────────
// AI 面板 - Settings
// ─────────────────────────────────────────
async function loadConfig(): Promise<void> {
  try {
    const config = await window.api.getModelConfig();
    if (config) {
      state.config.provider = config.provider || 'deepseek';
      state.config.baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';
      state.config.apiKey = config.apiKey || '';
      state.config.model = config.model || 'deepseek-v4-pro';
      state.config.builderModel = config.builderModel || 'deepseek-reasoner';
      state.config.coderModel = config.coderModel || 'deepseek-v4-pro';
      updateSettingsUI();
      updateModelListSelection();
    }
  } catch { /* ignore */ }
}

function updateSettingsUI(): void {
  const providerSelect = document.getElementById('cfg-provider') as HTMLSelectElement;
  if (providerSelect) providerSelect.value = state.config.provider;

  const baseUrlInput = document.getElementById('cfg-base-url') as HTMLInputElement;
  if (baseUrlInput) baseUrlInput.value = state.config.baseUrl;

  const apiKey = document.getElementById('cfg-api-key') as HTMLInputElement;
  const modelInput = document.getElementById('cfg-model') as HTMLInputElement;
  if (apiKey) apiKey.value = state.config.apiKey;
  if (modelInput) modelInput.value = state.config.model;

  // 更新 provider 下拉 → 自动填充默认 baseUrl
  updateProviderDefaults();
  // 显示模型元数据
  updateModelMetaDisplay();
}

// ── 动态模型列表（从注册表加载） ──
interface ModelItem {
  id: string;
  provider: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  cost: { input: number; output: number };
  capabilities: string[];
}

let modelListCache: ModelItem[] = [];

async function loadModelList(): Promise<void> {
  try {
    modelListCache = await window.api.listModelMeta() as ModelItem[];
    renderModelList();
    populateModelSelector();
  } catch (err) {
    console.error('[Settings] 加载模型列表失败:', err);
    modelListCache = [];
  }
}

function renderModelList(): void {
  const container = document.getElementById('model-list-container');
  if (!container) return;

  if (modelListCache.length === 0) {
    container.innerHTML = '<div class="model-list-empty">暂无已注册模型</div>';
    return;
  }

  // 按 provider 分组
  const groups = new Map<string, ModelItem[]>();
  for (const m of modelListCache) {
    const list = groups.get(m.provider) || [];
    list.push(m);
    groups.set(m.provider, list);
  }

  const providerIcons: Record<string, string> = {
    deepseek: '🐋', huoshan: '🌋', ollama: '🦙', anthropic: '🧠', custom: '⚙️',
  };

  let html = '';
  for (const [provider, models] of groups) {
    const icon = providerIcons[provider] || '🔌';
    html += `<div class="provider-section"><div class="provider-section-title">${icon} ${provider}</div>`;
    for (const m of models) {
      const isActive = state.config.provider === m.provider && state.config.model === m.id;
      const costStr = `¥${m.cost.input.toFixed(1)}/${m.cost.output.toFixed(1)} 每1M`;
      html += `<div class="model-item ${isActive ? 'active' : ''}"
        data-provider="${m.provider}" data-model="${m.id}"
        onclick="void(0)">
        <span class="model-icon">${m.reasoning ? '🧠' : icon}</span>
        <span class="model-name">${m.name}</span>
        <span class="model-provider">${costStr} | ${m.contextWindow >= 1000000 ? (m.contextWindow / 1000000).toFixed(0) + 'M' : (m.contextWindow / 1000).toFixed(0) + 'K'} ctx</span>
        <span class="model-status">${isActive ? '✓' : '-'}</span>
      </div>`;
    }
    html += '</div>';
  }
  container.innerHTML = html;

  // 绑定点击事件
  container.querySelectorAll('.model-item[data-model]').forEach(item => {
    item.addEventListener('click', () => {
      const el = item as HTMLElement;
      selectBuiltinModel(el.dataset.provider || 'deepseek', el.dataset.model || 'deepseek-v4-pro');
    });
  });
}

function updateModelListSelection(): void {
  const items = document.querySelectorAll('.model-item[data-model]');
  items.forEach(item => {
    const el = item as HTMLElement;
    if (el.dataset.provider === state.config.provider && el.dataset.model === state.config.model) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

function selectBuiltinModel(provider: string, model: string): void {
  // 从注册表查找模型元数据
  const meta = modelListCache.find(m => m.provider === provider && m.id === model);

  state.config.provider = provider;
  state.config.model = model;

  // 默认 baseUrl（后续可在自定义 Tab 中覆盖）
  const defaultBaseUrls: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    huoshan: 'https://ark.cn-beijing.volces.com/api/v3',
    ollama: 'http://localhost:11434',
    anthropic: 'https://api.anthropic.com',
    custom: '',
  };
  state.config.baseUrl = defaultBaseUrls[provider] || state.config.baseUrl;
  state.config.builderModel = meta?.reasoning ? model : (meta ? model : model);
  state.config.coderModel = model;

  // 更新 UI
  (document.getElementById('cfg-provider') as HTMLSelectElement).value = provider;
  (document.getElementById('cfg-base-url') as HTMLInputElement).value = state.config.baseUrl;
  updateProviderDefaults();
  updateModelListSelection();
  updateModelMetaDisplay();
  switchSettingsSubTab('custom');
}

function switchSettingsSubTab(tab: string): void {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-tab-content').forEach(t => t.classList.add('hidden'));
  
  const targetTab = document.querySelector(`[data-settings-tab="${tab}"]`) as HTMLElement;
  targetTab?.classList.add('active');
  document.getElementById(`settings-${tab}`)?.classList.remove('hidden');
}

/** Provider 切换时自动填充默认 baseUrl + 协议 */
function updateProviderDefaults(): void {
  const provider = (document.getElementById('cfg-provider') as HTMLSelectElement)?.value || state.config.provider;

  const defaultBaseUrls: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    huoshan: 'https://ark.cn-beijing.volces.com/api/v3',
    ollama: 'http://localhost:11434',
    anthropic: 'https://api.anthropic.com',
    custom: '',
  };
  const defaultProtocols: Record<string, string> = {
    deepseek: 'openai-compatible',
    huoshan: 'openai-compatible',
    ollama: 'ollama',
    anthropic: 'anthropic',
    custom: 'openai-compatible',
  };

  const baseUrlInput = document.getElementById('cfg-base-url') as HTMLInputElement;
  const protocolSelect = document.getElementById('cfg-api-protocol') as HTMLSelectElement;

  // 仅当 baseUrl 为空或用户未手动改过时才自动填充
  if (baseUrlInput && (!baseUrlInput.value || baseUrlInput.value === state.config.baseUrl)) {
    baseUrlInput.value = defaultBaseUrls[provider] || '';
  }
  if (protocolSelect) {
    protocolSelect.value = defaultProtocols[provider] || 'openai-compatible';
  }

  // 更新文档链接
  const docsLink = document.getElementById('link-provider-docs') as HTMLAnchorElement;
  const apiKeyLink = document.getElementById('link-get-api-key') as HTMLAnchorElement;
  const links: Record<string, { docs: string; apiKey: string }> = {
    deepseek: { docs: 'https://platform.deepseek.com/docs', apiKey: 'https://platform.deepseek.com/api_keys' },
    huoshan: { docs: 'https://console.volcengine.com/ark', apiKey: 'https://console.volcengine.com/ark' },
    ollama: { docs: 'https://ollama.com/models', apiKey: 'http://localhost:11434' },
    anthropic: { docs: 'https://docs.anthropic.com', apiKey: 'https://console.anthropic.com' },
    custom: { docs: 'https://platform.openai.com/docs', apiKey: 'https://platform.openai.com/api-keys' },
  };
  const link = links[provider] || links.deepseek;
  if (docsLink) docsLink.href = link.docs;
  if (apiKeyLink) apiKeyLink.href = link.apiKey;

  updateModelMetaDisplay();
}

/** 显示当前选中模型的元数据 */
async function updateModelMetaDisplay(): Promise<void> {
  const provider = state.config.provider;
  const model = state.config.model;
  if (!model) return;

  try {
    const meta = await window.api.getModelMeta(provider, model);
    const ctxEl = document.getElementById('meta-context');
    const maxTokEl = document.getElementById('meta-max-tokens');
    const costEl = document.getElementById('meta-cost');
    const reasoningBadge = document.getElementById('meta-reasoning-badge');

    if (meta) {
      if (ctxEl) ctxEl.textContent = meta.contextWindow >= 1000000
        ? `${(meta.contextWindow / 1000000).toFixed(0)}M tokens`
        : `${(meta.contextWindow / 1000).toFixed(0)}K tokens`;
      if (maxTokEl) maxTokEl.textContent = `${(meta.maxTokens / 1000).toFixed(0)}K tokens`;
      if (costEl) costEl.textContent = `¥${meta.cost.input}/${meta.cost.output} 每1M tokens`;
      if (reasoningBadge) reasoningBadge.style.display = meta.reasoning ? 'inline' : 'none';
    } else {
      if (ctxEl) ctxEl.textContent = '未知';
      if (maxTokEl) maxTokEl.textContent = '未知';
      if (costEl) costEl.textContent = '未知（默认 ¥0.3/0.6）';
      if (reasoningBadge) reasoningBadge.style.display = 'none';
    }
  } catch { /* ignore */ }
}

// 测试连接
async function testConfig(): Promise<void> {
  const provider = (document.getElementById('cfg-provider') as HTMLSelectElement).value;
  const apiKey = (document.getElementById('cfg-api-key') as HTMLInputElement).value;
  const model = (document.getElementById('cfg-model') as HTMLInputElement).value;

  if (!apiKey) {
    showConfigStatus('请先填写 API 密钥', 'error');
    return;
  }
  if (!model) {
    showConfigStatus('请先填写模型 ID', 'error');
    return;
  }

  const btn = document.getElementById('btn-test-config') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = '测试中...';
  showConfigStatus('正在连接...', 'info');

  try {
    const baseUrl = getEffectiveBaseUrl();
    const testResult = await window.api.testModelConnection({
      provider, baseUrl, apiKey, model
    });
    
    if (testResult.success) {
      showConfigStatus(`连接成功！${testResult.message || ''}`, 'success');
    } else {
      showConfigStatus(`连接失败: ${testResult.message}`, 'error');
    }
  } catch (err) {
    showConfigStatus(`连接异常: ${(err as Error).message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

function getEffectiveBaseUrl(): string {
  return (document.getElementById('cfg-base-url') as HTMLInputElement).value || 'https://api.deepseek.com/v1';
}

async function saveConfig(): Promise<void> {
  const provider = (document.getElementById('cfg-provider') as HTMLSelectElement).value;
  const apiKey = (document.getElementById('cfg-api-key') as HTMLInputElement).value;
  const model = (document.getElementById('cfg-model') as HTMLInputElement).value;
  const baseUrl = getEffectiveBaseUrl();

  // 验证必填项
  if (!apiKey || apiKey.trim() === '') {
    showConfigStatus('API 密钥不能为空', 'error');
    return;
  }
  if (!model || model.trim() === '') {
    showConfigStatus('模型 ID 不能为空', 'error');
    return;
  }
  if (provider === 'custom' && (!baseUrl || baseUrl.trim() === '')) {
    showConfigStatus('自定义接口的 Base URL 不能为空', 'error');
    return;
  }

  // 保存配置
  state.config = {
    provider,
    baseUrl,
    apiKey: apiKey.trim(),
    model: model.trim(),
    builderModel: state.config.builderModel,
    coderModel: state.config.coderModel,
  };

  try {
    await window.api.saveModelConfig(state.config);
    showConfigStatus('配置已保存，切换到「模型服务商」选择要使用的模型', 'success');
    updateModelListSelection();
  } catch (err) {
    showConfigStatus(`保存失败: ${(err as Error).message}`, 'error');
  }
}

function showConfigStatus(msg: string, type: string): void {
  const el = document.getElementById('cfg-status')!;
  el.textContent = msg;
  el.className = `cfg-status show ${type}`;
  clearTimeout((showConfigStatus as any).timer);
  (showConfigStatus as any).timer = setTimeout(() => { el.className = 'cfg-status'; }, 5000);
}

function switchToSettingsTab(): void {
  document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ai-tab-content').forEach(t => t.classList.add('hidden'));
  const settingsTab = document.querySelector('[data-tab="settings"]') as HTMLElement;
  settingsTab?.classList.add('active');
  document.getElementById('tab-settings')?.classList.remove('hidden');
  loadConfig();
}

// 初始化设置面板事件
function initSettingsEvents(): void {
  // 设置 Tab 切换
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = (tab as HTMLElement).dataset.settingsTab || 'providers';
      switchSettingsSubTab(tabName);
    });
  });

  // Provider 切换 → 自动填充默认值
  document.getElementById('cfg-provider')?.addEventListener('change', updateProviderDefaults);

  // 模型 ID 变更 → 自动显示元数据
  document.getElementById('cfg-model')?.addEventListener('input', () => {
    state.config.model = (document.getElementById('cfg-model') as HTMLInputElement).value;
    updateModelMetaDisplay();
  });

  // 添加自定义模型
  document.getElementById('btn-add-model')?.addEventListener('click', () => {
    switchSettingsSubTab('custom');
    // 清空表单准备新建
    (document.getElementById('cfg-api-key') as HTMLInputElement).value = '';
    (document.getElementById('cfg-model') as HTMLInputElement).value = '';
  });

  // 测试连接
  document.getElementById('btn-test-config')?.addEventListener('click', testConfig);

  // 保存配置
  document.getElementById('btn-save-config')?.addEventListener('click', saveConfig);
}
function renderTaskProgress(tasks: Array<{ taskId: string; status: string; message: string; retryCount: number }>): void {
  const container = document.getElementById('task-list')!;
  container.innerHTML = '';

  for (const task of tasks) {
    const item = document.createElement('div');
    item.className = `task-item ${task.status}`;
    item.innerHTML = `
      <div class="task-id">#${task.taskId}</div>
      <div class="task-desc">${task.message}</div>
      ${task.retryCount > 0 ? `<div class="task-status">重试 ${task.retryCount} 次</div>` : ''}
    `;
    container.appendChild(item);
  }
}

// ─────────────────────────────────────────
// 终端
// ─────────────────────────────────────────
function initTerminal(): void {
  const container = document.getElementById('terminal-container')!;

  xtermTerminal = new Terminal({
    theme: { background: '#0C0C0C', foreground: '#CCCCCC', cursor: '#CCCCCC' },
    fontFamily: "'JetBrains Mono', 'Consolas', monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: false,
    scrollback: 1000,
  });

  fitAddon = new FitAddon();
  xtermTerminal.loadAddon(fitAddon);
  xtermTerminal.open(container);
  fitAddon.fit();

  // xterm 输入回传到主进程执行
  xtermTerminal.onData((data) => {
    // 简单的交互式命令支持（仅回车触发执行）
    if (data === '\r') {
      const cmd = currentCommandBuffer.trim();
      if (cmd && state.projectPath) {
        xtermTerminal?.writeln(`\r\n$ ${cmd}`);
        executeTerminalCommand(cmd, state.projectPath);
        currentCommandBuffer = '';
      }
    } else {
      currentCommandBuffer += data;
    }
  });
}

let currentCommandBuffer = '';

async function executeTerminalCommand(cmd: string, cwd: string): Promise<void> {
  try {
    const result = await window.api.execCommand(cmd, cwd);
    if (result.stdout) xtermTerminal?.writeln(result.stdout);
    if (result.stderr) xtermTerminal?.writeln(`\x1b[31m${result.stderr}\x1b[0m`);
    if (result.exitCode !== 0) xtermTerminal?.writeln(`\x1b[33m[exit ${result.exitCode}]\x1b[0m`);
    xtermTerminal?.writeln('');
  } catch (err) {
    xtermTerminal?.writeln(`\x1b[31mError: ${(err as Error).message}\x1b[0m`);
  }
}

// ─────────────────────────────────────────
// 拖拽调整器
// ─────────────────────────────────────────
function setupResizers(): void {
  const sidebarResizer = document.getElementById('sidebar-resizer')!;
  const aiPanelResizer = document.getElementById('ai-panel-resizer')!;
  const sidebar = document.getElementById('sidebar')!;
  const aiPanel = document.getElementById('ai-panel')!;

  let isResizing = false;
  let resizerType: 'sidebar' | 'ai' | null = null;

  sidebarResizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizerType = 'sidebar';
    e.preventDefault();
  });

  aiPanelResizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizerType = 'ai';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    if (resizerType === 'sidebar') {
      const newWidth = Math.max(120, Math.min(600, e.clientX));
      sidebar.style.width = `${newWidth}px`;
      state.sidebarWidth = newWidth;
    } else if (resizerType === 'ai') {
      const newWidth = Math.max(200, Math.min(700, window.innerWidth - e.clientX));
      aiPanel.style.width = `${newWidth}px`;
      state.aiPanelWidth = newWidth;
    }
    editor?.layout();
  });

  document.addEventListener('mouseup', () => {
    isResizing = false;
    resizerType = null;
  });
}

// ─────────────────────────────────────────
// 上下文菜单
// ─────────────────────────────────────────
let contextMenuTarget: { name: string; path: string; isDirectory: boolean } | null = null;

function showContextMenu(e: MouseEvent, node: { name: string; path: string; isDirectory: boolean }): void {
  contextMenuTarget = node;
  const menu = document.getElementById('context-menu')!;
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.classList.remove('hidden');
}

function hideContextMenu(): void {
  document.getElementById('context-menu')!.classList.add('hidden');
}

async function handleContextAction(action: string): Promise<void> {
  if (!contextMenuTarget) return;
  const { path, isDirectory } = contextMenuTarget;
  hideContextMenu();

  switch (action) {
    case 'delete':
      if (confirm(`确定删除 ${contextMenuTarget.name || path}？`)) {
        await window.api.deleteFile(path);
        if (state.projectPath) await loadFileTree(state.projectPath);
      }
      break;
    case 'copy-path':
      navigator.clipboard.writeText(path);
      break;
    case 'show-in-folder':
      await window.api.showItemInFolder(path);
      break;
    case 'rename':
      // 通过事件触发 rename 输入框
      break;
    case 'restore-snapshot': {
      // 恢复 AI 修改前的文件快照
      const snapshots = await window.api.listSnapshots(state.projectPath || '', path);
      if (!snapshots || snapshots.length === 0) {
        showToast('未找到该文件的快照记录', 'info');
        break;
      }
      const latest = snapshots[snapshots.length - 1];
      await window.api.restoreSnapshot(latest.id);
      // 如果当前编辑器中是该文件，更新内容
      const openEntry = state.openFiles.find(f => f.path === path);
      if (openEntry) {
        try {
          const restored = await window.api.readFile(path);
          if (editor) editor.setValue(restored);
        } catch { /* ignore */ }
      }
      showToast('已恢复至 AI 修改前版本', 'info');
      break;
    }
  }
}

// ─────────────────────────────────────────
// 全局事件绑定
// ─────────────────────────────────────────
function setupEventListeners(): void {
  // 项目打开
  window.api.on('project-opened', async (_event, projectPath) => {
    state.projectPath = projectPath as string;
    await loadFileTree(state.projectPath);
    // 📋 加载 AI 行为规则（CLAUDE.md）
    try {
      const rules = await window.api.getProjectRules(state.projectPath);
      window.api.setProjectRules(rules);
    } catch (_) { /* 无规则文件，使用内置默认 */ }
    // 清除欢迎消息
    const container = document.getElementById('chat-messages')!;
    container.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'welcome-message';
    welcome.innerHTML = `
      <div class="welcome-icon">🤖</div>
      <div class="welcome-text">
        <h3>PersonalIDE</h3>
        <p>项目已加载：${path.basename(state.projectPath)}</p>
        <div class="quick-actions">
          <button class="quick-btn" data-action="new-feature">新增功能</button>
          <button class="quick-btn" data-action="refactor">代码重构</button>
          <button class="quick-btn" data-action="fix-bug">修复 Bug</button>
        </div>
      </div>
    `;
    container.appendChild(welcome);
  });

  // AI 流式响应
  window.api.on('ai-stream-chunk', (_event, chunk) => {
    appendStreamChunk(chunk as string);
  });

  window.api.on('ai-stream-end', () => {
    stopStreaming();
    state.chatHistory.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: state.currentStreamContent,
      timestamp: Date.now(),
    });
    state.currentStreamContent = '';
  });

  window.api.on('ai-stream-error', (_event, error) => {
    appendStreamChunk(`\n\n**错误**: ${error}`);
    stopStreaming();
  });

  // 任务进度
  window.api.on('task-progress', (_event, progress) => {
    const p = progress as { taskId: string; status: string; message: string; retryCount: number };
    const taskList = document.getElementById('task-list')!;
    let taskEl = taskList.querySelector(`[data-task-id="${p.taskId}"]`) as HTMLElement | null;
    if (!taskEl) {
      taskEl = document.createElement('div');
      taskEl.className = `task-item ${p.status}`;
      taskEl.dataset.taskId = p.taskId;
      taskEl.innerHTML = `
        <div class="task-id">#${p.taskId}</div>
        <div class="task-desc">${p.message}</div>
      `;
      taskList.appendChild(taskEl);
    }
    taskEl.className = `task-item ${p.status}`;
    taskEl.querySelector('.task-desc')!.textContent = p.message;
  });

  // 菜单操作
  window.api.on('menu-action', (_event, action) => {
    switch (action) {
      case 'toggle-ai-panel':
        document.getElementById('ai-panel')!.classList.toggle('hidden');
        document.getElementById('ai-panel-resizer')!.classList.toggle('hidden');
        editor?.layout();
        break;
      case 'zen-mode':
        document.body.classList.toggle('zen-mode');
        editor?.layout();
        break;
      case 'toggle-terminal':
        document.getElementById('terminal-container')!.classList.toggle('hidden');
        editor?.layout();
        if (!document.getElementById('terminal-container')!.classList.contains('hidden')) {
          fitAddon?.fit();
        }
        break;
      case 'send-to-builder':
        sendToAI();
        break;
      case 'abort-task':
        stopStreaming();
        break;
      case 'clear-chat':
        document.getElementById('chat-messages')!.innerHTML = '';
        state.chatHistory = [];
        break;
      case 'open-settings':
        switchToSettingsTab();
        break;
      case 'show-about':
        document.getElementById('about-dialog')?.classList.toggle('hidden');
        break;
      case 'save':
        saveCurrentFile();
        break;
      case 'new-file':
        newFileDialog();
        break;
    }
  });

  // 全局快捷键
  document.addEventListener('keydown', (e) => {
    // ── Diff 预览弹窗快捷键 ──
    if (diffState) {
      if (e.key === 'Enter') { e.preventDefault(); acceptDiff(); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeDiffModal(); return; }
    }

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === 'o') {
      e.preventDefault();
      openProjectDialog();
    } else if (ctrl && e.key === 'n') {
      e.preventDefault();
      newFileDialog();
    } else if (ctrl && e.key === 's') {
      e.preventDefault();
      saveCurrentFile();
    } else if (ctrl && e.shiftKey && e.key === 'M') {
      e.preventDefault();
      document.body.classList.toggle('zen-mode');
      editor?.layout();
    } else if (ctrl && e.key === '\\') {
      e.preventDefault();
      document.getElementById('ai-panel')!.classList.toggle('hidden');
      editor?.layout();
    } else if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      sendToAI();
    } else if (e.key === 'Escape' && state.isStreaming) {
      stopStreaming();
    } else if (ctrl && e.shiftKey && e.key.toUpperCase() === 'B') {
      // Builder 模式：直接输入需求
      e.preventDefault();
      const builderInput = document.getElementById('chat-input') as HTMLTextAreaElement;
      builderInput.focus();
      builderInput.placeholder = 'Builder 模式 — 在此输入你的需求…';
      showToast('🧱 Builder 模式激活', 'info');
    } else if (ctrl && e.shiftKey && e.key.toUpperCase() === 'C') {
      // Coder 模式：输入代码指令
      e.preventDefault();
      const coderInput = document.getElementById('chat-input') as HTMLTextAreaElement;
      coderInput.focus();
      coderInput.placeholder = 'Coder 模式 — 在此输入代码指令…';
      showToast('🔧 Coder 模式激活', 'info');
    } else if (ctrl && e.shiftKey && e.key.toUpperCase() === 'X') {
      // 终止 AI 任务
      e.preventDefault();
      stopStreaming();
      window.api.abortTask?.();
      showToast('⏹ 已终止 AI 任务', 'info');
    }
  });

  // Chat 输入框自动高度
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      sendToAI();
    }
  });

  // AI Tab 切换
  document.querySelectorAll('.ai-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = (tab as HTMLElement).dataset.tab!;
      document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.ai-tab-content').forEach(c => c.classList.add('hidden'));
      (tab as HTMLElement).classList.add('active');
      document.getElementById(`tab-${tabName}`)?.classList.remove('hidden');
    });
  });

  // 快捷按钮
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = (btn as HTMLElement).dataset.action;
      const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
      if (action === 'config-deepseek') {
        // 快速配置 DeepSeek：切到设置并预填
        switchToSettingsTab();
        const provEl = document.getElementById('cfg-provider') as HTMLSelectElement;
        const baseEl = document.getElementById('cfg-base-url') as HTMLInputElement;
        if (provEl) provEl.value = 'deepseek';
        if (baseEl) baseEl.value = 'https://api.deepseek.com/v1';
        updateProviderDefaults();
        if (baseEl) baseEl.focus();
        showToast('已切换到 DeepSeek，请在下方填入 API Key', 'info');
      } else if (action === 'config-ollama') {
        switchToSettingsTab();
        const provEl = document.getElementById('cfg-provider') as HTMLSelectElement;
        const baseEl = document.getElementById('cfg-base-url') as HTMLInputElement;
        if (provEl) provEl.value = 'ollama';
        if (baseEl) baseEl.value = 'http://localhost:11434';
        const modelEl = document.getElementById('cfg-model') as HTMLInputElement;
        if (modelEl) modelEl.value = 'llama3.2';
        updateProviderDefaults();
        showToast('已切换到 Ollama，请确保本地服务已启动', 'info');
      } else {
        const prompts: Record<string, string> = {
          'open-project': '',
          'new-feature': '新增一个功能模块',
          'refactor': '帮我重构这段代码',
          'fix-bug': '修复一个 bug',
        };
        chatInput.value = prompts[action || ''] || '';
        chatInput.focus();
      }
    });
  });

  // ── Gradle 快捷按钮 ──
  document.querySelectorAll('.gradle-badge').forEach(badge => {
    badge.addEventListener('click', async () => {
      const task = (badge as HTMLElement).dataset.gradle;
      if (!task || !state.projectPath) return;
      showToast('正在执行 gradle ' + task + '...', 'info');
      const result = await window.api.gradleExec(state.projectPath, task);
      const exitOk = result.exitCode === 0;
      addChatMessage('system', 'Gradle ' + task + (exitOk ? ' ✅ 完成' : ' ❌ 失败(exit ' + result.exitCode + ')') + '\n\n' + result.output.slice(-2000));
    });
  });

  // ── 帮助图标 ──
  document.getElementById('status-help')?.addEventListener('click', () => {
    document.getElementById('help-dialog')?.classList.toggle('hidden');
  });
  document.querySelector('.help-close')?.addEventListener('click', () => {
    document.getElementById('help-dialog')?.classList.add('hidden');
  });
  // 点击遮罩层关闭
  document.getElementById('help-dialog')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'help-dialog') {
      (e.target as HTMLElement).classList.add('hidden');
    }
  });

  // 设置保存
  document.getElementById('btn-save-config')?.addEventListener('click', saveConfig);

  // 发送按钮
  document.getElementById('btn-send')?.addEventListener('click', sendToAI);
  document.getElementById('btn-abort')?.addEventListener('click', stopStreaming);

  // ── 输入框键盘：Ctrl+Enter 发送，Shift+Enter 换行 ──
  document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' && ke.ctrlKey) {
      e.preventDefault();
      sendToAI();
    } else if (ke.key === 'Enter' && !ke.shiftKey) {
      // Plain Enter also sends (in addition to Ctrl+Enter)
      // Shift+Enter is the only newline path
      e.preventDefault();
      sendToAI();
    }
  });

  // 新建文件/文件夹
  document.getElementById('btn-new-file')?.addEventListener('click', newFileDialog);

  // 折叠全部
  document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
    document.querySelectorAll('.tree-children').forEach(el => el.remove());
    document.querySelectorAll('.arrow.open').forEach(el => el.classList.remove('open'));
  });

  // 上下文菜单
  document.addEventListener('click', hideContextMenu);
  document.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('click', () => {
      handleContextAction((item as HTMLElement).dataset.action || '');
    });
  });

  // ── 附件按钮 ──
  document.getElementById('btn-attach')?.addEventListener('click', openAttachDialog);

  // ── 拖拽上传 ──
  const chatArea = document.getElementById('tab-chat')!;
  chatArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  chatArea.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.path) continue; // 跳过无路径的文件
      const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
      const isImg = IMG_EXTS.has(ext);
      const maxSize = isImg ? MAX_IMG_SIZE : MAX_FILE_SIZE;
      if (f.size > maxSize) { showToast(`文件 "${f.name}" 超过限制`, 'warn'); continue; }
      attachments.push({
        id: crypto.randomUUID(), name: f.name, path: f.path,
        size: f.size, type: isImg ? 'image' : 'file',
        mime: isImg ? 'image/' + ext.slice(1) : 'text/plain',
      });
    }
    renderAttachmentBar();
  });

  // ── 模型快速切换 ──
  document.getElementById('quick-model-select')?.addEventListener('change', onQuickModelChange);

}

async function openProjectDialog(): Promise<void> {
  const path = await window.api.openProject();
  if (path) {
    state.projectPath = path;
    await loadFileTree(path);

    // 🔀 更新 Git 分支状态栏
    try {
      const gitResult = await window.api.getGitBranch(path);
      const gitEl = document.getElementById('status-git');
      if (gitResult && gitResult.success && gitEl) {
        gitEl.textContent = '🔀 ' + gitResult.branch;
        gitEl.style.display = '';
      } else if (gitEl) {
        gitEl.style.display = 'none';
      }
    } catch (_) { /* 非 Git 项目 */ }

    // 📋 加载 AI 行为规则（CLAUDE.md）
    try {
      const rules = await window.api.getProjectRules(path);
      window.api.setProjectRules(rules);
    } catch (_) { /* 无规则文件，使用内置默认 */ }

    // ⏯ 检查断点续做
    try {
      const session = await window.api.getTaskSession(path);
      if (session && session.tasksJson) {
        const tasks = JSON.parse(session.tasksJson);
        if (Array.isArray(tasks) && tasks.length > 0) {
          const pending = tasks.filter((t: { status: string }) => t.status !== 'done');
          if (pending.length > 0) {
            addChatMessage('system', '⏯ 检测到 ' + pending.length + ' 个未完成的任务（上次中断于 ' + new Date(session.updatedAt).toLocaleString() + '），输入"继续"以恢复。');
            (state as Record<string, unknown>).pendingTasks = tasks;
          }
        }
      }
    } catch (_) { /* 无会话 */ }
  }
}

async function newFileDialog(): Promise<void> {
  if (!state.projectPath) {
    alert('请先打开项目 (Ctrl+O)');
    return;
  }
  const name = prompt('文件名：');
  if (!name) return;
  const filePath = `${state.projectPath}/${name}`;
  try {
    await window.api.writeFile(filePath, '');
    await loadFileTree(state.projectPath);
    openFile(filePath, name);
  } catch (err) {
    alert(`创建失败: ${(err as Error).message}`);
  }
}

async function saveCurrentFile(): Promise<void> {
  if (state.activeFileIndex < 0) return;
  const file = state.openFiles[state.activeFileIndex];
  try {
    await window.api.writeFile(file.path, file.content);
    file.dirty = false;
    renderEditorTabs();
  } catch (err) {
    alert(`保存失败: ${(err as Error).message}`);
  }
}

// ─────────────────────────────────────────
// 初始化入口
// ─────────────────────────────────────────
async function init(): Promise<void> {
  console.log('[Renderer] PersonalIDE initializing...');

  initMonaco();
  setupEventListeners();
  setupResizers();
  await loadConfig();
  loadModelList();  // 异步加载模型注册表

  // 尝试恢复上次打开的项目
  const savedPath = await window.api.getProjectPath();
  if (savedPath) {
    state.projectPath = savedPath;
    await loadFileTree(savedPath);
  }

  console.log('[Renderer] PersonalIDE ready');
}

init().catch(console.error);

// 辅助：path.basename polyfill
const path = { basename: (p: string) => p.split(/[\\/]/).pop() || p };


// 状态栏 Git 分支点击：复制分支名
const statusGitEl = document.getElementById('status-git');
if (statusGitEl) {
  statusGitEl.addEventListener('click', () => {
    const text = statusGitEl.textContent || '';
    if (text.length > 2) {
      navigator.clipboard.writeText(text.replace('🔀 ', '')).catch(() => {});
      showToast('分支名已复制', 'info');
    }
  });
}

// ─────────────────────────────────────────
// 用量统计面板
// ─────────────────────────────────────────
async function loadUsageData(): Promise<void> {
  try {
    const [today, total, byProject, byDate] = await Promise.all([
      window.api.getUsageToday(),
      window.api.getUsageTotal(),
      window.api.getUsageByProject(),
      window.api.getUsageByDate(30),
    ]);

    // 今日卡片
    const todayTokens = document.getElementById('usage-today-tokens');
    const todayCost   = document.getElementById('usage-today-cost');
    if (todayTokens) todayTokens.textContent = formatTokenCount(today.totalTokens);
    if (todayCost)   todayCost.textContent   = `${today.costRmb.toFixed(4)} 元`;

    // 累计卡片
    const totalTokens = document.getElementById('usage-total-tokens');
    const totalCost   = document.getElementById('usage-total-cost');
    if (totalTokens) totalTokens.textContent = formatTokenCount(total.totalTokens);
    if (totalCost)   totalCost.textContent   = `${total.costRmb.toFixed(4)} 元`;

    // 项目列表
    renderUsageProjectList(byProject);

    // 柱状图
    renderUsageChart(byDate);
  } catch (err) {
    console.error('[Usage] 加载失败:', err);
  }
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function renderUsageProjectList(projects: Array<{ projectName: string; projectPath: string; totalTokens: number; costRmb: number; lastUsed: string }>): void {
  const container = document.getElementById('usage-project-list');
  if (!container) return;
  if (projects.length === 0) {
    container.innerHTML = '<div class="usage-empty">暂无数据</div>';
    return;
  }
  container.innerHTML = projects.map(p => {
    const name = p.projectName || p.projectPath.split(/[\\/]/).pop() || '未命名';
    return `<div class="usage-project-item">
      <span class="usage-project-name" title="${p.projectPath}">${name}</span>
      <span class="usage-project-stats">${formatTokenCount(p.totalTokens)} tokens / ${p.costRmb.toFixed(4)} 元</span>
    </div>`;
  }).join('');
}

function renderUsageChart(days: Array<{ date: string; totalTokens: number; costRmb: number }>): void {
  const container = document.getElementById('usage-chart-bars');
  if (!container) return;
  if (days.length === 0) {
    container.innerHTML = '<div class="usage-empty" style="width:100%;text-align:center;">暂无数据</div>';
    return;
  }
  const maxTokens = Math.max(...days.map(d => d.totalTokens), 1);
  container.innerHTML = days.map(d => {
    const h = Math.max(2, (d.totalTokens / maxTokens) * 100);
    const tip = `${d.date}\n${formatTokenCount(d.totalTokens)} tokens\n${d.costRmb.toFixed(4)} 元`;
    return `<div class="usage-chart-bar" style="height:${h}%" data-tip="${tip.replace(/"/g, '&quot;')}"></div>`;
  }).join('');
}

// 状态栏用量更新
async function updateStatusBarUsage(): Promise<void> {
  try {
    const today = await window.api.getUsageToday();
    const el = document.getElementById('status-usage');
    if (el) {
      el.textContent = `${formatTokenCount(today.totalTokens)} tokens / ${today.costRmb.toFixed(4)} 元`;
      el.title = `今日用量\n请求次数: ${today.requestCount}\n耗时: ${(today.durationMs / 1000).toFixed(1)}s`;
    }
  } catch { /* ignore */ }
}

// 余额不足弹窗
function showBalanceWarning(detail: string): void {
  const dialog = document.getElementById('balance-warning-dialog');
  const msg    = document.getElementById('balance-warning-msg');
  if (msg)    msg.textContent = `API 余额不足或欠费，请充值后继续使用。\n\n详情：${detail}`;
  if (dialog) dialog.classList.remove('hidden');
}

// 初始化用量相关事件
function initUsageEvents(): void {
  // 用量 Tab 切换时加载数据
  document.querySelectorAll('.ai-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = (tab as HTMLElement).dataset.tab;
      if (tabName === 'usage') loadUsageData();
    });
  });

  // 刷新按钮
  document.getElementById('btn-refresh-usage')?.addEventListener('click', loadUsageData);

  // 关闭余额警告
  document.getElementById('btn-dismiss-warning')?.addEventListener('click', () => {
    document.getElementById('balance-warning-dialog')?.classList.add('hidden');
  });

  // 监听主进程余额警告
  if (window.api.onBalanceWarning) {
    window.api.onBalanceWarning(showBalanceWarning);
  }

  // 状态栏用量点击 → 切换到用量 Tab
  document.getElementById('status-usage')?.addEventListener('click', () => {
    document.querySelector('.ai-tab[data-tab="usage"]')?.dispatchEvent(new Event('click'));
  });

  // 初始化时更新状态栏
  updateStatusBarUsage();
}

initUsageEvents();
initSettingsEvents();
