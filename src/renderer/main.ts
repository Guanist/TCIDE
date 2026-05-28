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

interface ChatSession {
  id: string;
  name: string;
  chatHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  projectPath?: string;
  pendingReads?: Array<{ start: number; end: number }>;
}

interface AttachmentMeta {
  id: string;
  name: string;
  path: string;
  size: number;
  type: 'image' | 'file';
  mime: string;
  dataUrl?: string;  // base64 data URL for images
}

const IMG_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg']);
const TXT_EXTS = new Set(['.txt','.js','.ts','.tsx','.jsx','.json','.xml','.html','.css','.md','.py','.go','.rs','.java','.kt','.kts','.gradle','.yaml','.yml','.toml','.ini','.cfg','.sh','.bat','.cmd','.sql','.log','.csv']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_IMG_SIZE = 5 * 1024 * 1024;  // 5 MB

const state = {
  projectPath: null as string | null,
  openFiles: [] as OpenFile[],
  activeFileIndex: -1,
  chatHistory: [] as ChatMessage[],  // 向后兼容
  chatSessions: [] as ChatSession[],
  currentSessionId: '' as string,
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
let draggedTab: HTMLElement | null = null;
let terminalInitialized = false;

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

  // 注入暗色主题（老虎）
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

  // 注入浅色主题（白虎）
  monaco.editor.defineTheme('trae-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6D8B5E' },
      { token: 'keyword', foreground: '0451A5' },
      { token: 'string', foreground: 'A31515' },
      { token: 'number', foreground: '098658' },
      { token: 'type', foreground: '267F99' },
      { token: 'class', foreground: '267F99' },
      { token: 'function', foreground: '795E26' },
    ],
    colors: {
      'editor.background': '#FFFFFF',
      'editor.foreground': '#1E1E1E',
      'editor.lineHighlightBackground': '#F5F5F5',
      'editor.selectionBackground': '#DBE4F0',
      'editorLineNumber.foreground': '#999999',
      'editorCursor.foreground': '#333333',
      'editorIndentGuide.background': '#E0E0E0',
      'editorWidget.background': '#F5F5F5',
      'editorSuggestWidget.background': '#F5F5F5',
      'editorSuggestWidget.border': '#D0D0D0',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': '#C0C0C060',
      'scrollbarSlider.hoverBackground': '#A0A0A0',
    },
  });

  const container = document.getElementById('monaco-container')!;

  editor = monaco.editor.create(container, {
    value: '',
    language: 'kotlin',
    theme: (() => { try { return localStorage.getItem('tcide-theme') === 'light' ? 'trae-light' : 'trae-dark'; } catch { return 'trae-dark'; } })(),
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
    fontLigatures: true,
    lineHeight: 22,
    letterSpacing: 0,
    minimap: { enabled: true, scale: 1, showSlider: 'mouseover', renderCharacters: false, maxColumn: 80 },
    scrollBeyondLastLine: false,
    glyphMargin: true,
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
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicAscii: false },
  });

  // 编辑器事件
  editor.onDidChangeModelContent(() => {
    if (state.activeFileIndex >= 0) {
      const model = editor!.getModel();
      if (model) {
        state.openFiles[state.activeFileIndex].content = model.getValue();
        state.openFiles[state.activeFileIndex].dirty = true;
        const dirtyEl = document.getElementById('status-dirty');
        if (dirtyEl) dirtyEl.style.display = '';
        // ⏳ 自动保存：3 秒无操作后保存
        scheduleAutoSave();
      }
    }
  });

  // 编辑器失焦时立即触发自动保存
  editor.onDidBlurEditorText(() => { doAutoSave(); });

  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleAutoSave(): void {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(doAutoSave, 3000);
  }
  function doAutoSave(): void {
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
    if (state.activeFileIndex < 0) return;
    const file = state.openFiles[state.activeFileIndex];
    if (!file.dirty) return;
    try {
      window.api.writeFile(file.path, file.content);
      file.dirty = false;
      const dirtyEl = document.getElementById('status-dirty');
      if (dirtyEl) dirtyEl.style.display = 'none';
    } catch { /* 静默失败 */ }
  }

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

  // ── AI 重构 ──
  editor.addAction({
    id: 'tcide-ai-refactor',
    label: 'AI 重构代码',
    contextMenuGroupId: 'tcide-ai',
    contextMenuOrder: 3,
    run: (ed: monaco.editor.IStandaloneCodeEditor) => {
      const selection = ed.getSelection();
      if (!selection) return;
      const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
      if (!selectedText.trim()) {
        showMiniToast('请先选中要重构的代码');
        return;
      }
      const lang = state.openFiles[state.activeFileIndex]?.language || 'code';
      const prompt = `重构以下${lang}代码，提高可读性和可维护性，保持功能不变。直接返回完整重构后的代码块，不要解释：\n\n${selectedText}`;
      aiGenerateAndInsert(ed, prompt, selection);
    },
  });

  // ── AI 生成测试 ──
  editor.addAction({
    id: 'tcide-ai-tests',
    label: 'AI 生成测试',
    contextMenuGroupId: 'tcide-ai',
    contextMenuOrder: 4,
    run: (ed: monaco.editor.IStandaloneCodeEditor) => {
      const selection = ed.getSelection();
      if (!selection) return;
      const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
      if (!selectedText.trim()) {
        showMiniToast('请先选中要生成测试的函数/类');
        return;
      }
      const lang = state.openFiles[state.activeFileIndex]?.language || 'code';
      const prompt = `为以下${lang}代码生成完整的单元测试。覆盖主要功能和边界情况。直接返回测试代码块，不要解释：\n\n${selectedText}`;
      aiGenerateAndInsert(ed, prompt, selection);
    },
  });

  // ── AI 修复 Bug ──
  editor.addAction({
    id: 'tcide-ai-fix',
    label: 'AI 修复 Bug',
    contextMenuGroupId: 'tcide-ai',
    contextMenuOrder: 5,
    run: (ed: monaco.editor.IStandaloneCodeEditor) => {
      const selection = ed.getSelection();
      if (!selection) return;
      const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
      if (!selectedText.trim()) {
        showMiniToast('请先选中可能有 Bug 的代码');
        return;
      }
      const prompt = `检查并修复以下代码中的潜在 Bug、性能问题和安全漏洞。直接返回修复后的完整代码块，不要解释：\n\n${selectedText}`;
      aiGenerateAndInsert(ed, prompt, selection);
    },
  });

  // ── AI 生成注释/文档 ──
  editor.addAction({
    id: 'tcide-ai-docs',
    label: 'AI 生成文档注释',
    contextMenuGroupId: 'tcide-ai',
    contextMenuOrder: 6,
    run: (ed: monaco.editor.IStandaloneCodeEditor) => {
      const selection = ed.getSelection();
      if (!selection) return;
      const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
      if (!selectedText.trim()) {
        showMiniToast('请先选中要生成文档的代码');
        return;
      }
      const lang = state.openFiles[state.activeFileIndex]?.language || 'code';
      const prompt = `为以下${lang}代码生成详细的文档注释（JSDoc/KDoc/Docstring格式），包含参数说明和返回值说明。只返回注释块，不要返回代码：\n\n${selectedText}`;
      aiGenerateAndInsert(ed, prompt, selection);
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
// ── 文件夹图标映射 ──
const FOLDER_ICONS: Record<string, string> = {
  '.git': '🔀', '.github': '🐙', '.gitlab': '🦊',
  'node_modules': '📦', '.pnpm': '📦',
  '.venv': '🐍', 'venv': '🐍', '.tox': '🐍', '__pycache__': '🐍',
  '.idea': '⚙️', '.vscode': '⚙️', '.cursor': '⚙️', '.windsurf': '⚙️',
  'dist': '🏗️', 'build': '🏗️', 'out': '🏗️', 'target': '🏗️', '.next': '🏗️', '.nuxt': '🏗️', '.output': '🏗️',
  'src': '📁', 'source': '📁', 'sources': '📁', 'lib': '📁', 'app': '📁',
  'core': '🧩', 'agent': '🤖', 'compat': '🔗', 'indexer': '🔍',
  'model': '🧠', 'config': '⚙️', 'configs': '⚙️',
  'renderer': '🖥️', 'main': '⚡',
  'components': '🧩', 'modules': '🧩', 'utils': '🔧', 'helpers': '🔧',
  'styles': '🎨', 'types': '📋', 'hooks': '🪝',
  'test': '🧪', 'tests': '🧪', 'spec': '🧪', '__tests__': '🧪', 'e2e': '🧪',
  'docs': '📚', 'doc': '📚', 'documentation': '📚', 'wiki': '📚',
  'public': '🌐', 'static': '🌐', 'assets': '🎨', 'images': '🖼️', 'img': '🖼️', 'icons': '🖼️',
  'scripts': '💻', 'tools': '🔧', 'tasks': '📋',
  'logs': '📄', 'temp': '🗑️', 'tmp': '🗑️', '.cache': '🗑️',
  'docker': '🐳', 'kubernetes': '☸️', 'k8s': '☸️', 'helm': '☸️',
  'terraform': '🏗️', 'ansible': '⚙️', 'ci': '🔄', 'cd': '🔄',
  'migrations': '🗃️', 'database': '🗃️', 'db': '🗃️',
  '.husky': '🪝', '.storybook': '📖',
  'release': '🚀', 'resources': '📦', 'task-artifacts': '📄',
};

function getFileIcon(name: string, isDir: boolean): string {
  const base = name.toLowerCase();
  const ext = name.split('.').pop()?.toLowerCase() || '';

  // ── 目录：特殊文件夹有专属图标 ──
  if (isDir) {
    const dirIcon = FOLDER_ICONS[base];
    if (dirIcon) return `<span class="file-icon-emoji">${dirIcon}</span>`;
    return '<span class="file-icon-emoji">📁</span>';
  }

  // ── 无扩展名文件（无点号或多段点号特殊名）──
  const noExtFiles: Record<string, string> = {
    dockerfile: '🐳', containerfile: '🐳', vagrantfile: '📦',
    makefile: '🔨', gnumakefile: '🔨', justfile: '🔨',
    rakefile: '💎', jenkinsfile: '🔄', procfile: '⚙️',
  };
  if (noExtFiles[base]) return `<span class="file-icon-emoji">${noExtFiles[base]}</span>`;
  if (base.startsWith('license') || base === 'licence' || base === 'copying' || base.startsWith('license-')) return '<span class="file-icon-emoji">📜</span>';
  if (base.startsWith('readme')) return '<span class="file-icon-emoji">📖</span>';
  if (base.startsWith('changelog')) return '<span class="file-icon-emoji">📋</span>';
  if (base === '.gitignore' || base === '.gitattributes' || base === '.gitmodules' || base === '.mailmap' || base === '.gitkeep') return '<span class="file-icon-emoji">🔀</span>';
  if (base === '.dockerignore' || base === '.npmignore' || base === '.eslintignore' || base === '.prettierignore') return '<span class="file-icon-emoji">🙈</span>';
  if (base === '.editorconfig') return '<span class="file-icon-emoji">⚙️</span>';
  if (base === '.env' || base.startsWith('.env.')) return '<span class="file-icon-emoji">⚙️</span>';
  if (base === '.npmrc' || base === '.yarnrc' || base === '.yarnrc.yml' || base === '.nvmrc') return '<span class="file-icon-emoji">⚙️</span>';
  if (base === '.babelrc' || base === '.browserslistrc' || base === '.babelrc.js' || base === '.babelrc.json') return '<span class="file-icon-emoji">⚙️</span>';
  if (base === '.prettierrc' || base === '.prettierrc.json' || base === '.prettierrc.yaml' || base === '.prettierrc.yml' || base === '.prettierrc.js' || base === '.prettierrc.toml') return '<span class="file-icon-emoji">🎨</span>';
  if (base === '.eslintrc' || base === '.eslintrc.json' || base === '.eslintrc.js' || base === '.eslintrc.yaml' || base === '.eslintrc.yml' || base === '.eslintrc.cjs' || base === 'eslint.config.js' || base === 'eslint.config.mjs' || base === 'eslint.config.ts' || base === 'eslint.config.cjs') return '<span class="file-icon-emoji">✅</span>';
  if (base === '.stylelintrc' || base === '.stylelintrc.json' || base === '.stylelintrc.js' || base === 'stylelint.config.js') return '<span class="file-icon-emoji">🎨</span>';
  if (base.startsWith('.env.')) return '<span class="file-icon-emoji">⚙️</span>';

  // ── 知名项目配置文件 ──
  const knownFiles: Record<string, string> = {
    'tsconfig.json': '📘', 'jsconfig.json': '📘',
    'package.json': '📦', 'package-lock.json': '📦',
    'composer.json': '🐘', 'composer.lock': '🐘',
    'cargo.toml': '🦀', 'cargo.lock': '🦀',
    'go.mod': '🔵', 'go.sum': '🔵',
    'gemfile': '💎', 'gemfile.lock': '💎',
    'pyproject.toml': '🐍', 'setup.py': '🐍', 'setup.cfg': '🐍', 'requirements.txt': '🐍', 'requirements-dev.txt': '🐍', 'pipfile': '🐍', 'pipfile.lock': '🐍',
    'pom.xml': '🐘', 'build.gradle': '🐘', 'build.gradle.kts': '🐘', 'settings.gradle': '🐘', 'settings.gradle.kts': '🐘',
    'cmakelists.txt': '🔨',
    'docker-compose.yml': '🐳', 'docker-compose.yaml': '🐳', 'docker-compose.override.yml': '🐳',
    'vite.config.ts': '⚡', 'vite.config.js': '⚡', 'vite.config.mts': '⚡', 'vite.config.mjs': '⚡',
    'tailwind.config.js': '🎨', 'tailwind.config.ts': '🎨',
    'webpack.config.js': '📦', 'webpack.config.ts': '📦', 'rollup.config.js': '📦', 'rollup.config.ts': '📦',
    '.travis.yml': '🔄', '.circleci': '🔄', 'bitbucket-pipelines.yml': '🔄', 'azure-pipelines.yml': '🔄',
    '.gitlab-ci.yml': '🦊', 'jenkinsfile': '🔄',
    'nginx.conf': '🌐', 'apache.conf': '🌐', '.htaccess': '🌐',
    'robots.txt': '🤖', 'sitemap.xml': '🗺️',
    'favicon.ico': '⭐',
    '.slugignore': '🙈', '.nowignore': '🙈', '.vercelignore': '🙈',
    '.gcloudignore': '🙈', '.cfignore': '🙈',
  };
  if (knownFiles[base]) return `<span class="file-icon-emoji">${knownFiles[base]}</span>`;

  // ── 有专用 PNG 的扩展 ──
  const pngMap: Record<string, string> = {
    ts: 'file-ts.png', tsx: 'file-ts.png', mts: 'file-ts.png', cts: 'file-ts.png',
    js: 'file-js.png', jsx: 'file-js.png', mjs: 'file-js.png', cjs: 'file-js.png',
    py: 'file-py.png', pyw: 'file-py.png', pyi: 'file-py.png', pyx: 'file-py.png', ipynb: 'file-py.png',
    go: 'file-go.png', rs: 'file-rs.png', java: 'file-java.png',
    kt: 'file-kt.png', kts: 'file-gradle.png', gradle: 'file-gradle.png',
    xml: 'file-xml.png', xsd: 'file-xml.png', wsdl: 'file-xml.png', plist: 'file-xml.png', svg: 'file-xml.png',
    html: 'file-html.png', htm: 'file-html.png', shtml: 'file-html.png',
    css: 'file-css.png', scss: 'file-css.png', less: 'file-css.png', styl: 'file-css.png',
    json: 'file-json.png', jsonc: 'file-json.png', json5: 'file-json.png',
    md: 'file-md.png', mdx: 'file-md.png', markdown: 'file-md.png',
    sh: 'file-sh.png', bash: 'file-sh.png', zsh: 'file-sh.png', fish: 'file-sh.png',
    bat: 'file-sh.png', cmd: 'file-sh.png', ps1: 'file-sh.png',
    yml: 'file-json.png', yaml: 'file-json.png', toml: 'file-json.png',
    cfg: 'file-json.png', ini: 'file-json.png', conf: 'file-json.png',
    properties: 'file-json.png', editorconfig: 'file-json.png',
  };
  if (pngMap[ext]) return `<img src="icons/file/${pngMap[ext]}" alt="" class="ft-icon" />`;

  // ── Emoji 分类图标 ──
  const docExts = new Set(['pdf','docx','doc','rtf','odt','pages','wpd']);
  const sheetExts = new Set(['xlsx','xls','xlsm','csv','tsv','ods','numbers']);
  const slideExts = new Set(['pptx','ppt','pptm','odp','key']);
  const archiveExts = new Set(['zip','rar','7z','gz','tar','tgz','bz2','xz','zst','lz','lz4','br','ar','cpio','whl','egg','apk','aab','ipa','dmg','pkg','deb','rpm','msi','appx']);
  const imgExts = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','icns','tiff','tif','jfif','avif','heic','heif','raw','cr2','nef','dng','psd','ai','eps','xcf','sketch','fig']);
  const audioExts = new Set(['mp3','wav','ogg','flac','aac','wma','m4a','opus','aiff','alac','mid','midi','ape','amr','caf','ra']);
  const videoExts = new Set(['mp4','avi','mov','wmv','flv','mkv','m4v','mpg','mpeg','3gp','ogv','rm','rmvb','vob','f4v','webm']);
  const fontExts = new Set(['ttf','otf','woff','woff2','eot','ttc','otc']);
  const dbExts = new Set(['sql','db','sqlite','sqlite3','mdb','accdb','dbf','sqlitedb','duckdb','parquet','ndjson','jsonl','avro','orc']);
  const cExts = new Set(['c','cpp','cc','cxx','h','hpp','hxx','hh','inl','ipp','c++','cu','cuh']);
  const binaryExts = new Set(['exe','dll','so','dylib','wasm','bin','dat','sys','drv','lib','a','o','obj','pdb','ilk','exp','pyc','pyo','pyd','class']);
  const certExts = new Set(['pem','crt','key','cer','p12','pfx','der','csr','p7b','p7c','jks','keystore','truststore']);
  const texExts = new Set(['tex','bib','cls','sty','bbl','bst','bcf','lco','dtx','ins']);
  const langExts: Record<string, string> = {
    cs: '🧩', csx: '🧩', rb: '💎', erb: '💎', php: '🐘',
    swift: '🍎', dart: '🎯', lua: '🌙', r: '📊', rmd: '📊', qmd: '📊',
    scala: '🔴', sc: '🔴', elm: '🌳',
    ex: '💧', exs: '💧', eex: '💧', heex: '💧',
    clj: '🔮', cljs: '🔮', cljc: '🔮', edn: '🔮',
    fs: '🧩', fsx: '🧩', fsi: '🧩',
    hs: 'λ', lhs: 'λ', ml: '🧩', mli: '🧩',
    nim: '👑', zig: '⚡', v: '🔷', odin: '🔶', jl: '🔬',
    cr: '💎', vala: '🧩', vapi: '🧩',
    groovy: '🧩', gvy: '🧩', gy: '🧩', gsh: '🧩',
    haxe: '🧩', hx: '🧩', pony: '🐴',
    solidity: '🧩', sol: '🧩',
    purs: '🧩', idr: '🧩', lidr: '🧩',
    agda: '🧩', coq: '🧩', lean: '🧩',
    nix: '❄️', dhall: '🧩', cue: '🧩',
    wast: '🧩', wat: '🧩', wai: '🧩',
    f: '🧩', f90: '🧩', f95: '🧩', f03: '🧩', f08: '🧩', for: '🧩', fpp: '🧩',
    asm: '🧩', s: '🧩', S: '🧩',
    m: '🧩', mm: '🧩',
    pl: '🧩', pm: '🧩', t: '🧩',
    tcl: '🧩', tk: '🧩',
    coffee: '🧩', litcoffee: '🧩',
    lisp: '🧩', lsp: '🧩', cl: '🧩', fasl: '🧩', scm: '🧩', ss: '🧩', rkt: '🧩',
    erl: '🧩', hrl: '🧩',
    d: '🧩', di: '🧩',
    pas: '🧩', pp: '🧩',
    ada: '🧩', adb: '🧩', ads: '🧩',
    cbl: '🧩', cob: '🧩', cpy: '🧩',
    abap: '🧩',
    dot: '🧩', gv: '🧩',
  };
  const webExts = new Set(['vue','svelte','astro','ejs','pug','jade','hbs','handlebars','mustache','twig','liquid','njk','nunjucks','jinja','jinja2','j2','tera','latte']);
  const docFormatExts = new Set(['rst','adoc','asciidoc','org','txt','log','text','diff','patch']);
  const certExtSet = new Set(['pem','crt','key','cer','p12','pfx','der','csr','p7b']);
  const i18nExts = new Set(['po','pot','mo','resx','resw','xliff','xlf']);
  const infraExts = new Set(['tf','tfvars','tfstate','hcl','bicep','pulumi','cdk']);
  const notebookExts = new Set(['ipynb']);

  if (ext === 'lock') return '<span class="file-icon-emoji">🔒</span>';
  if (ext === 'cmake') return '<span class="file-icon-emoji">🔨</span>';
  if (ext === 'proto' || ext === 'thrift' || ext === 'graphql' || ext === 'gql' || ext === 'prisma') return '<span class="file-icon-emoji">🔧</span>';

  if (texExts.has(ext)) return '<span class="file-icon-emoji">📝</span>';
  if (docExts.has(ext)) return '<span class="file-icon-emoji">📝</span>';
  if (ext === 'pdf') return '<span class="file-icon-emoji">📕</span>';
  if (sheetExts.has(ext)) return '<span class="file-icon-emoji">📊</span>';
  if (slideExts.has(ext)) return '<span class="file-icon-emoji">📽️</span>';
  if (archiveExts.has(ext)) return '<span class="file-icon-emoji">📦</span>';
  if (imgExts.has(ext)) return '<span class="file-icon-emoji">🖼️</span>';
  if (audioExts.has(ext)) return '<span class="file-icon-emoji">🎵</span>';
  if (videoExts.has(ext)) return '<span class="file-icon-emoji">🎬</span>';
  if (fontExts.has(ext)) return '<span class="file-icon-emoji">🔤</span>';
  if (dbExts.has(ext)) return '<span class="file-icon-emoji">🗃️</span>';
  if (cExts.has(ext)) return '<span class="file-icon-emoji">🧩</span>';
  if (binaryExts.has(ext)) return '<span class="file-icon-emoji">⚡</span>';
  if (certExtSet.has(ext)) return '<span class="file-icon-emoji">🔐</span>';
  if (i18nExts.has(ext)) return '<span class="file-icon-emoji">🌐</span>';
  if (infraExts.has(ext)) return '<span class="file-icon-emoji">🏗️</span>';
  if (notebookExts.has(ext)) return '<span class="file-icon-emoji">📓</span>';
  if (docFormatExts.has(ext)) return '<span class="file-icon-emoji">📄</span>';
  if (langExts[ext]) return `<span class="file-icon-emoji">${langExts[ext]}</span>`;
  if (webExts.has(ext)) return '<span class="file-icon-emoji">🧩</span>';

  // 3D 模型文件
  const model3dExts = new Set(['obj','fbx','blend','stl','glb','gltf','3ds','dae','ply','usd','usda','usdc','usdz']);
  if (model3dExts.has(ext)) return '<span class="file-icon-emoji">🧊</span>';

  // 兜底：无扩展名文件
  if (!ext) return '<span class="file-icon-emoji">📄</span>';

  return '<img src="icons/file/file-default.png" alt="" class="ft-icon" />';
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
    icon.innerHTML = getFileIcon(node.name, node.isDirectory);

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
  // 隐藏欢迎页
  hideWelcomePage();

  // 检查是否已打开
  const existing = state.openFiles.findIndex(f => f.path === filePath);
  if (existing >= 0) {
    switchToFile(existing);
    return;
  }

  const lang = detectLanguage(name);

  // 二进制文件 - Hex 预览
  if (lang === 'binary') {
    try {
      const hexData = await window.api.readHex(filePath, 16384);
      const content = [
        `文件: ${name}`,
        `大小: ${(hexData.size / 1024).toFixed(1)} KB`,
        `${hexData.truncated ? `（仅显示前 ${(hexData.maxBytes / 1024).toFixed(0)} KB）` : ''}`,
        '',
        hexData.hex
      ].join('\n');
      state.openFiles.push({ path: filePath, name, content, dirty: false, language: 'plaintext' });
      const index = state.openFiles.length - 1;
      renderEditorTabs();
      switchToFile(index);
    } catch (err) {
      showToast(`无法打开: ${(err as Error).message}`, 'error');
    }
    return;
  }

  // ── HTML/SVG/XML 预览 + 源码编辑 双模式 ──
  if (lang === 'html' || lang === 'xml' || name.endsWith('.svg')) {
    try {
      const content = await window.api.readFile(filePath);
      const fileLang = name.endsWith('.svg') ? 'html' : (lang === 'xml' ? 'xml' : 'html');
      state.openFiles.push({ path: filePath, name, content, dirty: false, language: fileLang });
      const index = state.openFiles.length - 1;
      renderEditorTabs();
      switchToFile(index);
      // 默认预览模式
      toggleHtmlMode('preview');
      // SVG 设置 iframe 使用 image 模式
      if (name.endsWith('.svg')) {
        const htmlFrame = document.getElementById('html-preview') as HTMLIFrameElement;
        if (htmlFrame) {
          const svgBlob = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }));
          htmlFrame.src = svgBlob;
          htmlFrame.srcdoc = '';
        }
      }
    } catch {
      showToast(`${name.split('.').pop()?.toUpperCase()} 加载失败`, 'error');
    }
    return;
  }

  // ── PDF 预览 ──
  if (lang === 'pdf') {
    try {
      const { base64 } = await window.api.readPdfBase64(filePath);
      // 创建 Blob URL（Electron file:// 兼容）
      const byteChars = atob(base64);
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
      const byteArr = new Uint8Array(byteNums);
      const blobUrl = URL.createObjectURL(new Blob([byteArr], { type: 'application/pdf' }));
      state.openFiles.push({ path: filePath, name, content: blobUrl, dirty: false, language: 'pdf' });
      const index = state.openFiles.length - 1;
      renderEditorTabs();
      switchToFile(index);
    } catch (err) {
      showToast(`PDF 加载失败: ${(err as Error).message}`, 'error');
    }
    return;
  }

  // ── DOCX 文本提取 ──
  if (lang === 'docx') {
    try {
      const text = await window.api.readDocxText(filePath);
      state.openFiles.push({ path: filePath, name, content: text, dirty: false, language: 'markdown' });
      const index = state.openFiles.length - 1;
      renderEditorTabs();
      switchToFile(index);
    } catch (err) {
      showToast(`DOCX 加载失败: ${(err as Error).message}`, 'error');
    }
    return;
  }

  try {
    const content = await window.api.readFile(filePath);

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

  // ── HTML / PDF 预览 ──
  const pdfFrame = document.getElementById('pdf-preview') as HTMLIFrameElement;
  const htmlFrame = document.getElementById('html-preview') as HTMLIFrameElement;
  const editorEl = document.getElementById('monaco-container')!;

  // 全部先隐藏
  editorEl.classList.add('hidden');
  if (pdfFrame) { pdfFrame.classList.add('hidden'); pdfFrame.src = ''; }
  if (htmlFrame) { htmlFrame.classList.add('hidden'); htmlFrame.src = ''; }

  if (file.language === 'pdf') {
    if (pdfFrame) { pdfFrame.classList.remove('hidden'); pdfFrame.src = file.content; }
  } else if (file.language === 'html' || file.language === 'xml' || file.name.endsWith('.svg')) {
    // 预览/源码可切换
    const htmlErr = document.getElementById('html-error-console');
    if (file.name.endsWith('.svg')) {
      // SVG 用 Blob URL
      const svgBlob = URL.createObjectURL(new Blob([file.content], { type: 'image/svg+xml' }));
      if (htmlFrame) { htmlFrame.classList.remove('hidden'); htmlFrame.src = svgBlob; htmlFrame.srcdoc = ''; }
    } else {
      if (htmlFrame) { htmlFrame.classList.remove('hidden'); htmlFrame.src = ''; htmlFrame.srcdoc = wrapHtmlWithErrorCapture(file.content); }
    }
    const modeBtn = document.getElementById('html-mode-toggle');
    if (modeBtn) { modeBtn.style.display = ''; modeBtn.textContent = '📝 源码'; }
    const toolbar = document.getElementById('html-toolbar');
    if (toolbar) toolbar.style.display = 'flex';
    if (htmlErr) htmlErr.classList.remove('hidden');
    htmlMode = 'preview';
  } else {
    editorEl.classList.remove('hidden');
    const toolbar = document.getElementById('html-toolbar');
    if (toolbar) toolbar.style.display = 'none';
    const htmlErrCon = document.getElementById('html-error-console');
    if (htmlErrCon) { htmlErrCon.classList.add('hidden'); htmlErrCon.innerHTML = ''; }
    const modeBtn = document.getElementById('html-mode-toggle');
    if (modeBtn) modeBtn.style.display = 'none';
    const errInd = document.getElementById('html-error-indicator');
    if (errInd) errInd.classList.add('hidden');
    const model = monaco.editor.createModel(file.content, file.language);
    editor?.setModel(model);
  }

  renderEditorTabs();
  updateEditorStatusBar(file.language);
  // 🔀 Git diff 标记
  showGitDiffDecorations(file.path);

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
    tab.className = 'tab-item' + (index === state.activeFileIndex ? ' active' : '');
    tab.draggable = true;
    tab.dataset.fileIndex = String(index);
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

    // 拖拽
    tab.addEventListener('dragstart', (e) => {
      draggedTab = tab;
      tab.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
    });
    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
    });

    // 右键菜单
    tab.addEventListener('contextmenu', (e) => {
      showTabContextMenu(e as MouseEvent, index);
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
    const pdfFrame = document.getElementById('pdf-preview') as HTMLIFrameElement;
    if (pdfFrame) { pdfFrame.style.display = 'none'; pdfFrame.src = ''; }
    document.getElementById('monaco-container')!.style.display = 'block';
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
    cpp: 'cpp', c: 'c', h: 'c', cs: 'csharp', rb: 'ruby',
    php: 'php', sql: 'sql', css: 'css', scss: 'scss', less: 'less',
    html: 'html', htm: 'html', svg: 'xml', vue: 'html', svelte: 'html',
    dart: 'dart', swift: 'swift', scala: 'scala', lua: 'lua', r: 'r',
  };
  // 特殊文件类型
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  // 其他二进制文件不应在编辑器中打开
  const binaryExts = new Set(['doc','xlsx','xls','pptx','ppt','zip','rar','7z','gz','tar','exe','dll','so','dylib','wasm','ttf','otf','woff','woff2','eot','mp3','mp4','avi','mov','wmv','flv','mkv','webm','ogg','wav','flac','ico','icns','bin','dat','db','sqlite','sqlite3']);
  if (binaryExts.has(ext || '')) return 'binary';
  return langs[ext || ''] || 'plainText';
}

let gitDiffDeco: monaco.editor.IEditorDecorationsCollection | null = null;

async function showGitDiffDecorations(filePath: string): Promise<void> {
  if (!editor || !state.projectPath) { clearGitDecorations(); return; }
  try {
    const diff = await window.api.getDiff(filePath, state.projectPath);
    if (!diff.success) { clearGitDecorations(); return; }
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const ln of diff.added) {
      decorations.push({
        range: new monaco.Range(ln, 1, ln, 1),
        options: { isWholeLine: true, linesDecorationsClassName: 'git-line-added', glyphMarginClassName: 'git-glyph-added' },
      });
    }
    for (const ln of diff.modified) {
      decorations.push({
        range: new monaco.Range(ln, 1, ln, 1),
        options: { isWholeLine: true, linesDecorationsClassName: 'git-line-modified', glyphMarginClassName: 'git-glyph-modified' },
      });
    }
    for (const ln of diff.removed) {
      // 已删除行在当前版本中不存在，跳过（或显示在附近行）
    }
    if (gitDiffDeco) gitDiffDeco.clear();
    gitDiffDeco = editor.createDecorationsCollection(decorations);
  } catch { clearGitDecorations(); }
}

function clearGitDecorations(): void {
  if (gitDiffDeco) { gitDiffDeco.clear(); gitDiffDeco = null; }
}

// ═══ HTML 预览/源码 双模式 ═══
let htmlMode: 'preview' | 'source' = 'preview';

function toggleHtmlMode(mode?: 'preview' | 'source'): void {
  if (mode) htmlMode = mode; else htmlMode = htmlMode === 'preview' ? 'source' : 'preview';
  
  const frame = document.getElementById('html-preview') as HTMLIFrameElement;
  const toolbar = document.getElementById('html-toolbar');
  const editorEl = document.getElementById('monaco-container')!;
  const toggleBtn = document.getElementById('html-mode-toggle');
  const errCon = document.getElementById('html-error-console');
  
  if (htmlMode === 'preview') {
    if (frame) {
      frame.classList.remove('hidden');
      const file = state.openFiles[state.activeFileIndex];
      if (file && (file.language === 'html' || file.language === 'xml' || file.name.endsWith('.svg'))) {
        if (file.name.endsWith('.svg')) {
          const svgBlob = URL.createObjectURL(new Blob([file.content], { type: 'image/svg+xml' }));
          frame.src = svgBlob;
        } else {
          frame.srcdoc = wrapHtmlWithErrorCapture(file.content);
        }
      }
    }
    editorEl.classList.add('hidden');
    if (toolbar) toolbar.style.display = 'flex';
    if (toggleBtn) toggleBtn.textContent = '📝 源码';
  } else {
    if (frame) { frame.classList.add('hidden'); frame.srcdoc = ''; }
    editorEl.classList.remove('hidden');
    if (toolbar) toolbar.style.display = 'flex';
    if (toggleBtn) toggleBtn.textContent = '👁 预览';
    if (errCon) errCon.classList.add('hidden');
    const file = state.openFiles[state.activeFileIndex];
    if (file && file.language === 'html') {
      const model = monaco.editor.createModel(file.content, 'html');
      editor?.setModel(model);
    }
  }
}

function wrapHtmlWithErrorCapture(html: string): string {
  // 注入错误捕获脚本
  const errorScript = `
<script>
window.onerror = function(msg, url, line, col, err) {
  var detail = (err && err.stack) ? err.stack : msg + ' (line ' + line + ':' + col + ')';
  try {
    window.parent.postMessage({ type: 'html-error', detail: String(detail) }, '*');
  } catch(e) {}
};
window.addEventListener('unhandledrejection', function(e) {
  try {
    window.parent.postMessage({ type: 'html-error', detail: String(e.reason) }, '*');
  } catch(_) {}
});
</script>`;
  // 注入到 </head> 或 <body> 之前
  if (html.includes('</head>')) {
    return html.replace('</head>', errorScript + '</head>');
  } else if (html.includes('<body')) {
    return html.replace('<body', errorScript + '<body');
  }
  return errorScript + html;
}

// 监听 iframe 错误消息
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'html-error') {
    const errCon = document.getElementById('html-error-console');
    const indicator = document.getElementById('html-error-indicator');
    if (errCon) {
      errCon.classList.remove('hidden');
      errCon.innerHTML += `<div class="html-error-line">⚠ ${e.data.detail}</div>`;
    }
    if (indicator) indicator.classList.remove('hidden');
  }
});

document.getElementById('html-mode-toggle')?.addEventListener('click', () => toggleHtmlMode());

// ═══ AI 文件大纲生成 ═══
function generateFileOutline(content: string, lang: string): string {
  const lines = content.split('\n');
  const parts: string[] = [];
  
  // 搜索结构化标记
  const patterns: Array<{ regex: RegExp; label: string }> = [];
  if (['html', 'xml'].includes(lang)) {
    patterns.push({ regex: /<\s*(\w+)[\s>]/g, label: '<$1>' });
  } else if (['typescript', 'javascript'].includes(lang)) {
    patterns.push(
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, label: 'fn $1()' },
      { regex: /^(?:export\s+)?class\s+(\w+)/gm, label: 'class $1' },
      { regex: /^\s*\/\/\s*(={2,}|#{1,4})\s*(.+)/gm, label: '## $2' },
    );
  } else if (['kotlin', 'java'].includes(lang)) {
    patterns.push(
      { regex: /^(?:public\s+|private\s+|internal\s+|protected\s+)?(?:suspend\s+)?fun\s+(\w+)/gm, label: 'fun $1()' },
      { regex: /^(?:data\s+)?class\s+(\w+)/gm, label: 'class $1' },
    );
  } else if (lang === 'python') {
    patterns.push(
      { regex: /^class\s+(\w+)/gm, label: 'class $1' },
      { regex: /^def\s+(\w+)/gm, label: 'def $1()' },
    );
  } else if (lang === 'css') {
    patterns.push({ regex: /^([.#@]?[\w-]+)\s*\{/gm, label: '$1 {}' });
  } else {
    // 通用：搜索缩进为 0 的行（顶层结构）
    patterns.push({ regex: /^(?!\s)(.+)$/gm, label: '$1' });
  }

  const found = new Map<number, string>();
  for (const p of patterns) {
    for (const m of content.matchAll(p.regex)) {
      const lineNum = (content.slice(0, m.index).match(/\n/g) || []).length + 1;
      const name = p.label.replace('$1', m[1]).replace('$2', (m[2] || ''));
      if (name.trim().length < 100) {
        found.set(lineNum, name.slice(0, 80));
      }
    }
  }

  // 按行号排序，最多 100 条
  const sorted = Array.from(found.entries()).sort((a, b) => a[0] - b[0]).slice(0, 100);
  
  if (sorted.length === 0) {
    // 降级：显示行号范围
    const chunkSize = Math.ceil(lines.length / 20);
    for (let i = 1; i <= lines.length; i += chunkSize) {
      const line = lines[i - 1]?.trim().slice(0, 60) || '';
      parts.push(`L${i}: ${line}`);
    }
  } else {
    for (const [ln, name] of sorted) {
      parts.push(`L${ln}: ${name}`);
    }
  }

  return `共 ${lines.length} 行，${sorted.length} 个结构标记:\n${parts.join('\n')}`;
}

function streamToAI(userMsg: string, ctxMsg: string, fileName: string): void {
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
  if (chatInput) chatInput.value = '';
  state.isStreaming = true;
  state.currentStreamContent = '';
  document.getElementById('btn-send')!.classList.add('hidden');
  document.getElementById('btn-abort')!.classList.remove('hidden');
  (async () => {
    try {
      const session = ensureSession();
      const msg = [
        { role: 'system' as const, content: `你是虎猫 TCIDE 本地 IDE 的 AI 助手。当前文件: ${fileName}。严禁说「我看不到」「无法访问」。` },
        { role: 'user' as const, content: userMsg + '\n\n' + ctxMsg },
      ];
      window.api.sendToAIStream(msg, { model: state.config.model });
      showTypingIndicator();
      session.chatHistory.push({ id: crypto.randomUUID(), role: 'user', content: userMsg, timestamp: Date.now() });
      session.updatedAt = Date.now();
    } catch (err) {
      addChatMessage('assistant', `错误: ${(err as Error).message}`);
      stopStreaming();
    }
  })();
}

function updateEditorStatusBar(language?: string): void {
  if (language) {
    const langLabels: Record<string, string> = {
      pdf: 'PDF 预览', markdown: 'Markdown (DOCX 提取)',
      plainText: '纯文本', plaintext: '纯文本',
      javascript: 'JavaScript', typescript: 'TypeScript',
      python: 'Python', kotlin: 'Kotlin', java: 'Java',
      go: 'Go', rust: 'Rust', cpp: 'C++', c: 'C',
      csharp: 'C#', ruby: 'Ruby', php: 'PHP',
      dart: 'Dart', swift: 'Swift', scala: 'Scala',
      lua: 'Lua', r: 'R', sql: 'SQL',
      html: 'HTML', css: 'CSS', xml: 'XML',
      json: 'JSON', yaml: 'YAML', toml: 'TOML',
      shell: 'Shell', powershell: 'PowerShell',
      gradle: 'Gradle', bat: 'Batch',
    };
    document.getElementById('status-language')!.textContent =
      langLabels[language] || language;
  }
}

// ─────────────────────────────────────────
// AI 面板 - Chat
// ─────────────────────────────────────────
function addChatMessage(role: 'user' | 'assistant' | 'system', content: string, attachList?: AttachmentMeta[]): void {
  const msg: ChatMessage = {
    id: crypto.randomUUID(),
    role, content,
    timestamp: Date.now(),
    attachments: attachList?.length ? attachList : undefined,
  };
  // 保存到当前会话
  ensureSession().chatHistory.push(msg);
  // 渲染
  renderChatMessage(msg);
}

function appendStreamChunk(chunk: string): void {
  const container = document.getElementById('chat-messages')!;
  let lastMsg = container.lastElementChild as HTMLElement;

  if (!lastMsg || !lastMsg.classList.contains('assistant')) {
    lastMsg = document.createElement('div');
    lastMsg.className = 'chat-message assistant';
    lastMsg.setAttribute('data-role', 'assistant');
    lastMsg.innerHTML = `
      <div class="msg-avatar">🐯</div>
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-role">虎猫 AI</span>
          <span class="msg-time">${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="msg-content"></div>
      </div>`;
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
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  html = html.replace(/\n\n/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');

  // 还原代码块：带语言标签 + 复制按钮
  html = html.replace(/___CODEBLOCK_(\d+)___/g, (_m, idx) => {
    const block = codeBlocks[parseInt(idx)];
    if (!block) return '';
    const escaped = block.code
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const langLabel = block.lang ? `<span class="code-lang">${block.lang}</span>` : '';
    const copyId = 'cb_' + Math.random().toString(36).slice(2, 8);
    return `<div class="code-block-wrapper">
      <div class="code-block-header">${langLabel}<span class="code-block-spacer"></span><button class="copy-code-btn" data-copy-id="${copyId}" onclick="var t=this.parentElement.nextElementSibling.textContent;navigator.clipboard.writeText(t).then(()=>{this.textContent='✓已复制';setTimeout(()=>{this.textContent='📋 复制'},2000)})">📋 复制</button></div>
      <pre class="code-block-pre"><code class="lang-${block.lang}">${escaped}</code></pre>
    </div>`;
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
    '.docx': '📝', '.doc': '📝', '.pdf': '📕',
    '.xlsx': '📊', '.xls': '📊', '.pptx': '📽️', '.ppt': '📽️',
    '.zip': '📦', '.rar': '📦', '.gz': '📦',
    '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.gif': '🖼️', '.svg': '🖼️',
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
      const meta: AttachmentMeta = { id, name: f.name, path: f.path, size: f.size, type: isImg ? 'image' : 'file', mime: isImg ? 'image/' + ext.slice(1) : 'text/plain' };
      // 图片立即转 base64
      if (isImg) {
        try {
          meta.dataUrl = await window.api.readFileAsDataURL(f.path);
        } catch (_) { /* 转换失败则回退 */ }
      }
      attachments.push(meta);
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
  const dot = document.getElementById('model-status');
  if (!dot) return;
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
  updateModelIndicator();
  showToast(`已切换到 ${meta.name}`, 'info');
  saveConfig().catch(() => {});
}

// ═══════════════════════════════════════════
// 多会话管理
// ═══════════════════════════════════════════
function ensureSession(): ChatSession {
  if (!state.currentSessionId || !state.chatSessions.find(s => s.id === state.currentSessionId)) {
    createSession();
  }
  const s = state.chatSessions.find(s => s.id === state.currentSessionId)!;
  // 向后兼容：迁移旧 chatHistory
  if (state.chatHistory.length > 0 && s.chatHistory.length === 0) {
    s.chatHistory = [...state.chatHistory];
    state.chatHistory = [];
  }
  return s;
}

function createSession(name?: string): ChatSession {
  const id = crypto.randomUUID();
  const session: ChatSession = {
    id,
    name: name || `对话 ${state.chatSessions.length + 1}`,
    chatHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPath: state.projectPath || undefined,
  };
  state.chatSessions.unshift(session);
  state.currentSessionId = id;
  renderChatList();
  return session;
}

// ═══ 会话持久化（聊天记忆） ═══
async function saveSessionsToDisk(): Promise<void> {
  if (!state.projectPath) return;
  try {
    const p = (window as any).path || require('path');
    const tcideDir = `${state.projectPath}/.tcide/chat`;
    // 通过 API 创建目录
    await window.api.writeFile(`${tcideDir}/.gitkeep`, '');
    // 只保存最近 500 条消息
    const data = JSON.stringify(state.chatSessions.map(s => ({
      id: s.id, name: s.name, chatHistory: s.chatHistory.slice(-500),
      createdAt: s.createdAt, updatedAt: s.updatedAt, projectPath: s.projectPath,
    })));
    await window.api.writeFile(`${tcideDir}/sessions.json`, data);
  } catch (e) {
    console.warn('[虎猫] 保存会话失败:', e);
  }
}

async function loadSessionsFromDisk(): Promise<void> {
  if (!state.projectPath) return;
  try {
    const raw = await window.api.readTextFile(`${state.projectPath}/.tcide/chat/sessions.json`);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data) && data.length > 0) {
      state.chatSessions = data.map((s: any) => ({
        id: s.id, name: s.name, chatHistory: s.chatHistory || [],
        createdAt: s.createdAt, updatedAt: Date.now(), projectPath: s.projectPath,
      }));
      state.currentSessionId = state.chatSessions[0].id;
      renderChatList();
      renderChatHistory();
      addChatMessage('system', `📂 已恢复 ${state.chatSessions.length} 个历史会话`);
    }
  } catch (e) {
    // 文件不存在或损坏，忽略
  }
}

// ═══ AI 分段读取交互 ═══
function confirmAiRead(start: number, end: number): void {
  const session = state.chatSessions.find(s => s.id === state.currentSessionId);
  if (!session) return;
  if (!session.pendingReads) session.pendingReads = [];
  session.pendingReads.push({ start, end });
  
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  const readId = `read-${session.pendingReads.length}`;
  const file = state.openFiles[state.activeFileIndex];
  const readDiv = document.createElement('div');
  readDiv.className = 'chat-message system read-confirm';
  readDiv.id = readId;
  readDiv.innerHTML = `
    <div class="read-confirm-card">
      <div class="read-confirm-title">📖 虎猫想继续读取文件</div>
      <div class="read-confirm-file">${file?.name || '当前文件'} L${start}-L${end}</div>
      <div class="read-confirm-actions">
        <button class="btn-read-confirm">✅ 允许读取</button>
        <button class="btn-read-deny">❌ 拒绝</button>
      </div>
    </div>`;
  
  readDiv.querySelector('.btn-read-confirm')?.addEventListener('click', () => {
    readDiv.remove();
    executeAiRead(start, end);
  });
  readDiv.querySelector('.btn-read-deny')?.addEventListener('click', () => {
    readDiv.remove();
    addChatMessage('system', '⏭ 已拒绝分段读取请求');
  });
  
  container.appendChild(readDiv);
  readDiv.scrollIntoView({ behavior: 'smooth' });
}

async function executeAiRead(start: number, end: number): Promise<void> {
  if (state.activeFileIndex < 0) return;
  const file = state.openFiles[state.activeFileIndex];
  const lines = file.content.split('\n');
  const sliceStart = Math.max(0, start - 1);
  const sliceEnd = Math.min(lines.length, end);
  const chunk = lines.slice(sliceStart, sliceEnd).join('\n');
  
  addChatMessage('system', `📄 ${file.name} L${sliceStart + 1}-L${sliceEnd}:\n\`\`\`${file.language}\n${chunk}\n\`\`\``);
  
  state.isStreaming = true;
  state.currentStreamContent = '';
  document.getElementById('btn-send')!.classList.add('hidden');
  document.getElementById('btn-abort')!.classList.remove('hidden');
  
  const session = state.chatSessions.find(s => s.id === state.currentSessionId)!;
  const historyMsgs = session.chatHistory.slice(-30).map(m => ({ role: m.role, content: m.content }));
  const msg = [
    { role: 'system' as const, content: `你是虎猫 TCIDE 的 AI 助手。文件 ${file.name} 的 L${sliceStart + 1}-L${sliceEnd} 行已发送给你。如需继续，在回复中用 /read N-M 请求更多行。` },
    ...historyMsgs,
    { role: 'user' as const, content: `已读取 L${sliceStart + 1}-L${sliceEnd}，请继续分析。` },
  ];
  window.api.sendToAIStream(msg, { model: state.config.model });
  showTypingIndicator();
}

// ═══ 会话删除 / 重命名（带确认） ═══
function deleteSession(id: string): void {
  const session = state.chatSessions.find(s => s.id === id);
  if (!session) return;
  const name = session.name;
  const title = session.chatHistory.find(m => m.role === 'user')?.content?.slice(0, 30) || name;
  
  showConfirm(`确定要删除「${title}」吗？此操作不可撤销。`, () => {
    state.chatSessions = state.chatSessions.filter(s => s.id !== id);
    if (state.currentSessionId === id) {
      state.currentSessionId = state.chatSessions[0]?.id || '';
      state.chatHistory = [];
      if (!state.chatSessions[0]) createSession();
      renderChatHistory();
    }
    renderChatList();
    saveSessionsToDisk();
    showToast('已删除对话', 'success');
  });
}

function renameSession(id: string): void {
  const session = state.chatSessions.find(s => s.id === id);
  if (!session) return;
  const newName = prompt('重命名对话:', session.name);
  if (newName && newName.trim()) {
    session.name = newName.trim();
    session.updatedAt = Date.now();
    renderChatList();
    saveSessionsToDisk();
    showToast('已重命名', 'success');
  }
}

/** 通用二次确认模态框 */
function showConfirm(message: string, onConfirm: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <div class="confirm-msg">${message}</div>
      <div class="confirm-actions">
        <button class="btn-confirm-cancel">取消</button>
        <button class="btn-confirm-ok">确定删除</button>
      </div>
    </div>`;
  overlay.querySelector('.btn-confirm-cancel')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('.btn-confirm-ok')?.addEventListener('click', () => { overlay.remove(); onConfirm(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function switchSession(id: string): void {
  state.currentSessionId = id;
  state.chatHistory = [];
  // 重新渲染消息
  const container = document.getElementById('chat-messages')!;
  container.innerHTML = '';
  const session = state.chatSessions.find(s => s.id === id);
  if (session) {
    // 恢复 AI 欢迎页
    const welcome = document.getElementById('ai-welcome');
    if (welcome) welcome.style.display = '';
    // 重新渲染消息
    for (const msg of session.chatHistory) {
      renderChatMessage(msg);
    }
  }
  renderChatList();
}

function renderChatMessage(msg: ChatMessage): void {
  const container = document.getElementById('chat-messages')!;
  const welcome = document.getElementById('ai-welcome');
  if (welcome && welcome.style.display !== 'none') {
    welcome.style.display = 'none';
  }

  const el = document.createElement('div');
  el.className = `chat-message ${msg.role}`;
  el.setAttribute('data-role', msg.role);

  const avatars: Record<string, string> = { user: '🧑', assistant: '🐯', system: '⚙' };
  const labels: Record<string, string> = { user: '你', assistant: '虎猫 AI', system: '系统' };
  const timeStr = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  let attachHtml = '';
  if (msg.attachments?.length) {
    attachHtml = '<div class="msg-attachments">' + msg.attachments.map(a => {
      if (a.type === 'image') {
        const src = a.dataUrl || `tcide://${encodeURIComponent(a.name)}`;
        return `<img class="msg-attachment-img" src="${src}" alt="${a.name}" title="${a.name}" loading="lazy">`;
      }
      return `<span class="msg-attachment">📄 ${a.name}</span>`;
    }).join('') + '</div>';
  }

  el.innerHTML = `
    <div class="msg-avatar">${avatars[msg.role] || '💬'}</div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-role">${labels[msg.role] || msg.role}</span>
        <span class="msg-time">${timeStr}</span>
      </div>
      <div class="msg-content">${renderMarkdown(msg.content)}${attachHtml}</div>
    </div>
  `;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
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
      addChatMessage('assistant', '命令列表:\n/task <描述> — Builder 架构模式，自动拆分任务并执行\n/file — 发送当前文件给 AI（超大文件自动生成大纲）\n/lines N-M — 发送指定行范围，如 /lines 100-200');
      return;
    }
    addChatMessage('user', text);
    await executeTaskAgentLoop(desc);
    return;
  }

  // ── /file 命令：发送当前文件给 AI（超大文件自动生成大纲）──
  if (text.startsWith('/file') && state.activeFileIndex >= 0) {
    const file = state.openFiles[state.activeFileIndex];
    const lines = file.content.split('\n');
    const totalChars = file.content.length;
    const MAX_SEND = 200000;
    let ctx: string;
    
    if (totalChars <= MAX_SEND) {
      // 小文件：直接发送
      ctx = `📄 ${file.name} (${lines.length} 行, ${(totalChars/1000).toFixed(0)}k 字符):\n\`\`\`${file.language}\n${file.content}\n\`\`\`\n\n请分析以上文件内容。`;
    } else {
      // 大文件：生成结构化大纲
      const outline = generateFileOutline(file.content, file.language);
      ctx = `📐 ${file.name} — 文件过大，发送结构化大纲\n\n文件行数: ${lines.length} | 字符数: ${(totalChars/1000).toFixed(0)}k\n\n## 文件结构大纲:\n${outline}\n\n---\n💡 使用 /lines N-M 命令获取指定行范围的内容。\n例如: /lines 1500-1600 查看第 1500 到 1600 行。\n\n请根据大纲回答，需要查看具体代码时告诉我行号范围。`;
    }

    const fileMsg = text.replace(/^\/file\s*/, '').trim() || file.name;
    addChatMessage('user', `/file ${fileMsg}`);
    addChatMessage('system', ctx);
    streamToAI(fileMsg, ctx, file.name);
    return;
  }

  // ── /lines 命令：发送指定行范围 ──
  const linesMatch = text.match(/^\/lines\s+(\d+)(?:\s*-\s*(\d+))?/);
  if (linesMatch && state.activeFileIndex >= 0) {
    const file = state.openFiles[state.activeFileIndex];
    const lines = file.content.split('\n');
    const start = Math.max(1, parseInt(linesMatch[1]));
    const end = linesMatch[2] ? parseInt(linesMatch[2]) : start + 50;
    const sliceStart = Math.max(0, start - 1);
    const sliceEnd = Math.min(lines.length, end);
    const chunk = lines.slice(sliceStart, sliceEnd).join('\n');
    const ctx = `📄 ${file.name} 第 ${start}-${sliceEnd} 行 (共 ${lines.length} 行):\n\`\`\`${file.language}\n${chunk}\n\`\`\``;
    addChatMessage('user', text);
    addChatMessage('system', ctx);
    streamToAI(text, ctx, file.name);
    return;
  }

  addChatMessage('user', text, [...attachments]);

  // 构建附件上下文（仅手动附件 + 编辑器选中内容）
  let attachContext = '';

  // 1) 编辑器选中文本（用户主动选择 = 明确意图）
  if (editor) {
    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      const selectedText = editor.getModel()?.getValueInRange(selection) || '';
      if (selectedText) {
        const activeFile = state.openFiles[state.activeFileIndex];
        const lang = activeFile?.language || '';
        // 20 万字符以内直接发送，超出则智能截断（头+尾）
        const MAX_SELECTION = 200000;
        let sendText = selectedText;
        let truncNote = '';
        if (selectedText.length > MAX_SELECTION) {
          sendText = selectedText.slice(0, MAX_SELECTION * 0.3) + 
            `\n\n...（中间省略 ${selectedText.length - MAX_SELECTION * 0.6} 字符）...\n\n` +
            selectedText.slice(-MAX_SELECTION * 0.3);
          truncNote = `（已截断：共 ${(selectedText.length/1000).toFixed(0)}k 字符，发送了开头和结尾各 ${(MAX_SELECTION*0.3/1000).toFixed(0)}k）`;
        }
        attachContext += `\n---\n📌 选中代码 ${truncNote} (${activeFile?.name || '编辑器'}):\n\`\`\`${lang}\n${sendText}\n\`\`\`\n---\n`;
      }
    }
  }

  // 2) 手动附件
  if (attachments.length > 0) {
    for (const a of attachments) {
      if (a.type === 'file') {
        try {
          const content = await window.api.readTextFile(a.path);
          if (content) {
            attachContext += `\n---\n📄 ${a.name}:\n\`\`\`${a.name.split('.').pop() || ''}\n${content.slice(0, 5000)}\n\`\`\`\n---\n`;
          }
        } catch (_) { /* 跳过 */ }
      }
    }
  }

  const currentAttach = [...attachments];
  attachments = [];
  renderAttachmentBar();

  const session = ensureSession();
  session.updatedAt = Date.now();

  state.isStreaming = true;
  state.currentStreamContent = '';
  document.getElementById('btn-send')!.classList.add('hidden');
  document.getElementById('btn-abort')!.classList.remove('hidden');

  try {
    const userContent = attachContext ? text + '\n\n' + attachContext : text;
    const messages = [
      { role: 'system' as const, content: `【绝对规则 - 必须遵守】
你正在虎猫 TCIDE（本地 IDE）中运行，直接嵌在用户的编辑器中。

## 你的真实能力
你已接入 IDE 的文件系统、终端和项目上下文。你可以：
• 看到用户当前打开的文件和编辑器选区
• 分析项目代码结构
• 生成/修改代码
• 执行终端命令

## 当前 IDE 状态
${state.projectPath ? `项目: ${state.projectPath}` : '未打开项目'}
${state.openFiles.length > 0 ? `已打开文件: ${state.openFiles.slice(0, 10).map(f => `  - ${f.name} (${f.language})`).join('\n')}` : ''}
${state.activeFileIndex >= 0 && state.openFiles[state.activeFileIndex] ? `当前活跃文件: ${state.openFiles[state.activeFileIndex].name}` : ''}

## 严禁事项
• 严禁说「我无法访问你的文件」「我看不到你的屏幕」「请粘贴内容」—— 你已经在 IDE 里了
• 严禁说「我是一个纯文本模型」—— 你是有工具接入的 IDE Agent
• 严禁假装自己是网页版 AI —— 你是桌面 IDE 内置助手
• 如果用户问文件内容但你缺上下文，直接说：「请打开该文件或在编辑器中选中相关代码，我就能看到」

## 应该这样做
• 用户问「左边是什么文件」→ 看上面已打开文件列表，直接回答
• 用户问「帮我改这个文件」→ 直接给出修改后的完整代码
• 用户问项目结构 → 描述你知道的上下文
• 用户说「继续」→ 继续之前的工作` },
      ...session.chatHistory.slice(-20).map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userContent },
    ];

    window.api.sendToAIStream(messages, { model: state.config.model });
    showTypingIndicator();

    session.chatHistory.push({
      id: crypto.randomUUID(), role: 'user', content: text,
      timestamp: Date.now(), attachments: currentAttach.length > 0 ? currentAttach : undefined
    });
    // 首次对话自动命名为用户第一条消息
    if (session.name.startsWith('对话 ') && session.chatHistory.filter(m => m.role === 'user').length === 1) {
      session.name = text.slice(0, 30) + (text.length > 30 ? '...' : '');
      renderChatList();
    }
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
// Toast 通知系统（支持队列、多类型、自动消失）
// ─────────────────────────────────────────
interface ToastItem {
  id: string;
  text: string;
  type: 'info' | 'warn' | 'error' | 'success';
  duration: number;
  action?: { label: string; callback: () => void };
}

let toastQueue: ToastItem[] = [];
let activeToasts: string[] = [];
const MAX_VISIBLE_TOASTS = 2;

function showToast(text: string, type: 'info' | 'warn' | 'error' | 'success' = 'info', duration: number = 3000): void {
  const id = crypto.randomUUID();
  toastQueue.push({ id, text, type, duration });
  processToastQueue();
}

function processToastQueue(): void {
  if (activeToasts.length >= MAX_VISIBLE_TOASTS || toastQueue.length === 0) return;
  const toast = toastQueue.shift()!;
  activeToasts.push(toast.id);
  renderToast(toast);
}

function renderToast(toast: ToastItem): void {
  const container = document.getElementById('toast-container')!;
  const icons: Record<string, string> = { success: '✅', warn: '⚠️', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast-item toast-${toast.type}`;
  el.id = `toast-${toast.id}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[toast.type]}</span>
    <span class="toast-msg">${toast.text}</span>
    ${toast.action ? `<button class="toast-action">${toast.action.label}</button>` : ''}
    <span class="toast-close">✕</span>
  `;
  container.appendChild(el);

  // 关闭按钮
  el.querySelector('.toast-close')?.addEventListener('click', () => dismissToast(toast.id));
  el.querySelector('.toast-action')?.addEventListener('click', () => { toast.action?.callback(); dismissToast(toast.id); });

  // 自动消失
  setTimeout(() => dismissToast(toast.id), toast.duration);
}

function dismissToast(id: string): void {
  const el = document.getElementById(`toast-${id}`);
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    el.style.transition = 'all 0.2s ease';
    setTimeout(() => el.remove(), 200);
  }
  activeToasts = activeToasts.filter(t => t !== id);
  processToastQueue();
}

// 保留 showMiniToast 别名（兼容旧代码）
function showMiniToast(msg: string, duration: number = 2000): void {
  showToast(msg, 'info', duration);
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

// ── 打字指示器（AI 响应时显示动画点）──
function showTypingIndicator(): void {
  hideTypingIndicator();
  const container = document.getElementById('chat-messages')!;
  const indicator = document.createElement('div');
  indicator.id = 'typing-indicator';
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  container.appendChild(indicator);
  container.scrollTop = container.scrollHeight;
}

function hideTypingIndicator(): void {
  document.getElementById('typing-indicator')?.remove();
}

// ── AI 模型状态指示器 ──
function updateModelIndicator(): void {
  const dot = document.getElementById('ai-model-dot');
  const name = document.getElementById('ai-model-name');
  const cfg = state.config;

  if (!dot || !name) return;

  if (!cfg.apiKey) {
    dot.className = 'ai-model-dot offline';
    name.textContent = '未配置';
    return;
  }

  const meta = modelListCache?.find(m => m.id === cfg.model && m.provider === cfg.provider);
  const displayName = meta?.name || cfg.model || '未知模型';
  name.textContent = displayName;
  dot.className = 'ai-model-dot';
}

/** 错误降级：返回缓存的模板提示 */
function getFallbackResponse(): string {
  return '// 网络异常，请检查 API 配置后重试\n// 提示：设置 → 模型服务商 → 测试连接';
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
  const session = ensureSession();
  const messages = buildSlidingWindowContext(session.chatHistory, 5, 4000);
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
      updateModelIndicator();
      // 已配置 API 则隐藏快速配置按钮
      if (config.apiKey) {
        document.querySelectorAll('.quick-btn[data-action^="config-"]').forEach(b => b.classList.add('hidden'));
      }
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
    updateModelIndicator();
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

  // 火山引擎特殊提示
  if (provider === 'huoshan') {
    showToast('⚠️ 火山引擎需要推理接入点ID，请在火山方舟控制台创建接入点后填写', 'warning');
  }
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

  // ── 动态更新模型 ID 输入提示 ──
  const modelInput = document.getElementById('cfg-model') as HTMLInputElement;
  const modelHint = document.getElementById('hint-model-id');
  const hints: Record<string, { placeholder: string; hint: string }> = {
    deepseek: { placeholder: '如：deepseek-chat、deepseek-reasoner', hint: '在 DeepSeek 平台的 API Keys 页面查看可用模型' },
    huoshan: { placeholder: 'ep-20240601xxxxxxxx-xxxxx', hint: '⚠️ 火山引擎需要推理接入点ID（endpoint ID），不是模型名。在火山方舟控制台 → 推理接入 → 创建接入点后获取。每个模型需单独创建接入点。' },
    ollama: { placeholder: '如：qwen2.5:7b、codellama', hint: '运行 ollama list 查看本地已拉取的模型' },
    anthropic: { placeholder: '如：claude-sonnet-4-20250514', hint: '在 Anthropic Console 创建 API Key，模型名可查文档' },
    custom: { placeholder: '如：gpt-4o、qwen-max', hint: '自定义 OpenAI 兼容接口，填入服务商提供的模型名称' },
  };
  const hint = hints[provider] || hints.custom;
  if (modelInput) modelInput.placeholder = hint.placeholder;
  if (modelHint) {
    modelHint.textContent = hint.hint;
    modelHint.className = provider === 'huoshan' ? 'input-hint input-hint-warn' : 'input-hint';
  }

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
    if (provider === 'huoshan' && apiKey.startsWith('ark-')) {
      // 火山方舟 endpoint key 无需 model
    } else {
      showConfigStatus('请先填写模型 ID', 'error');
      return;
    }
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
    if (provider === 'huoshan' && apiKey.startsWith('ark-')) {
      // 火山方舟 endpoint key 自带端点，model 可为空
    } else {
      showConfigStatus('模型 ID 不能为空', 'error');
      return;
    }
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
    updateModelIndicator();
    // 隐藏快速配置按钮
    document.querySelectorAll('.quick-btn[data-action^="config-"]').forEach(b => b.classList.add('hidden'));
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
  const settingsTab = document.querySelector('.ai-tab[data-tab="settings"]') as HTMLElement;
  if (settingsTab) settingsTab.classList.add('active');
  document.getElementById('tab-settings')?.classList.remove('hidden');
  loadConfig();
}

function switchToChatTab(): void {
  document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ai-tab-content').forEach(t => t.classList.add('hidden'));
  const chatTab = document.querySelector('.ai-tab[data-tab="chat"]') as HTMLElement;
  if (chatTab) chatTab.classList.add('active');
  document.getElementById('tab-chat')?.classList.remove('hidden');
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

  // 导出配置
  document.getElementById('btn-export-config')?.addEventListener('click', async () => {
    try {
      const result = await window.api.exportConfig();
      if (result.success) {
        showToast(`配置已导出到 ${result.path}`, 'success');
      }
    } catch (err) {
      showToast(`导出失败: ${(err as Error).message}`, 'error');
    }
  });

  // 导入配置
  document.getElementById('btn-import-config')?.addEventListener('click', async () => {
    try {
      const imported = await window.api.importConfig();
      if (!imported) return; // 用户取消
      // 应用导入的配置（保留当前 API Key）
      if (imported.provider) state.config.provider = imported.provider as string;
      if (imported.baseUrl) state.config.baseUrl = imported.baseUrl as string;
      if (imported.model) state.config.model = imported.model as string;
      if (imported.builderModel) state.config.builderModel = imported.builderModel as string;
      if (imported.coderModel) state.config.coderModel = imported.coderModel as string;
      updateSettingsUI();
      updateModelListSelection();
      updateModelIndicator();
      await saveConfig();
      showToast('配置已导入并保存', 'success');
    } catch (err) {
      showToast(`导入失败: ${(err as Error).message}`, 'error');
    }
  });
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
// 终端（多标签）
// ─────────────────────────────────────────
interface TermSession {
  id: number;
  name: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  cmdBuffer: string;
  container: HTMLElement;
}

let termSessions: TermSession[] = [];
let activeTermId = -1;
let termIdCounter = 0;

function initTerminal(): void {
  if (terminalInitialized) return;
  terminalInitialized = true;
  addTerminalSession('终端 1');
  renderTerminalTabs();

  document.getElementById('btn-terminal-add')?.addEventListener('click', () => {
    addTerminalSession(`终端 ${termIdCounter + 1}`);
    renderTerminalTabs();
  });
}

function addTerminalSession(name: string): number {
  const id = ++termIdCounter;
  const container = document.getElementById('terminal-container')!;

  // 创建独立的容器
  const termEl = document.createElement('div');
  termEl.className = 'term-instance';
  termEl.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:none';
  container.appendChild(termEl);

  const term = new Terminal({
    theme: { background: '#0C0C0C', foreground: '#CCCCCC', cursor: '#CCCCCC' },
    fontFamily: "'JetBrains Mono', 'Consolas', monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: false,
    scrollback: 1000,
  });

  const fa = new FitAddon();
  term.loadAddon(fa);
  term.open(termEl);

  let cmdBuf = '';
  term.onData((data) => {
    if (data === '\r') {
      const cmd = cmdBuf.trim();
      if (cmd && state.projectPath) {
        term.writeln(`\r\n$ ${cmd}`);
        execInTerminal(term, cmd, state.projectPath);
        cmdBuf = '';
      }
    } else {
      cmdBuf += data;
    }
  });

  const session: TermSession = { id, name, terminal: term, fitAddon: fa, cmdBuffer: cmdBuf, container: termEl };
  termSessions.push(session);

  if (activeTermId < 0) activateTerminal(id);
  return id;
}

function activateTerminal(id: number): void {
  for (const s of termSessions) {
    s.container.style.display = s.id === id ? 'block' : 'none';
  }
  activeTermId = id;
  const active = termSessions.find(s => s.id === id);
  if (active) {
    try { active.fitAddon.fit(); } catch {}
  }
  renderTerminalTabs();
}

function closeTerminal(id: number): void {
  const idx = termSessions.findIndex(s => s.id === id);
  if (idx < 0) return;
  const session = termSessions[idx];
  session.terminal.dispose();
  session.container.remove();
  termSessions.splice(idx, 1);
  if (activeTermId === id) {
    if (termSessions.length > 0) {
      activateTerminal(termSessions[termSessions.length - 1].id);
    } else {
      activeTermId = -1;
      addTerminalSession('终端 1');
      activateTerminal(termIdCounter);
    }
  }
  renderTerminalTabs();
}

function renderTerminalTabs(): void {
  const list = document.getElementById('terminal-tabs-list');
  if (!list) return;
  list.innerHTML = termSessions.map(s => `
    <div class="terminal-tab ${s.id === activeTermId ? 'active' : ''}" data-term-id="${s.id}">
      <span>${s.name}</span>
      <span class="terminal-tab-close" data-close="${s.id}">&times;</span>
    </div>
  `).join('');

  list.querySelectorAll('.terminal-tab').forEach(el => {
    const id = parseInt((el as HTMLElement).dataset.termId || '0');
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.close) {
        e.stopPropagation();
        closeTerminal(parseInt((e.target as HTMLElement).dataset.close || '0'));
      } else {
        activateTerminal(id);
      }
    });
  });
}

async function execInTerminal(term: Terminal, cmd: string, cwd: string): Promise<void> {
  try {
    const result = await window.api.execCommand(cmd, cwd);
    if (result.stdout) term.writeln(result.stdout);
    if (result.stderr) term.writeln(`\x1b[31m${result.stderr}\x1b[0m`);
    if (result.exitCode !== 0) term.writeln(`\x1b[33m[exit ${result.exitCode}]\x1b[0m`);
    term.writeln('');
  } catch (err) {
    term.writeln(`\x1b[31mError: ${(err as Error).message}\x1b[0m`);
  }
}

function fitActiveTerminal(): void {
  const active = termSessions.find(s => s.id === activeTermId);
  if (active) { try { active.fitAddon.fit(); } catch {} }
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
      const newWidth = Math.max(280, Math.min(window.innerWidth * 0.6, window.innerWidth - e.clientX));
      aiPanel.style.width = `${newWidth}px`;
      state.aiPanelWidth = newWidth;
    }
    editor?.layout();
  });

  document.addEventListener('mouseup', () => {
    isResizing = false;
    resizerType = null;
  });

  // ═══ HTML 错误控制台拖拽调整高度 ═══
  const errConsole = document.getElementById('html-error-console');
  if (errConsole) {
    // 默认给个合适高度
    errConsole.style.maxHeight = '150px';
    errConsole.style.height = 'auto';
    // 拖拽手柄
    const errHandle = document.createElement('div');
    errHandle.className = 'error-console-handle';
    errConsole.prepend(errHandle);
    let errStartY = 0, errStartH = 0, errDragging = false;
    errHandle.addEventListener('mousedown', (e) => {
      errDragging = true;
      errStartY = e.clientY;
      errStartH = errConsole.offsetHeight;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!errDragging) return;
      const delta = errStartY - e.clientY;
      const h = Math.max(60, Math.min(450, errStartH + delta));
      errConsole.style.maxHeight = h + 'px';
      errConsole.style.height = h + 'px';
      editor?.layout();
    });
    document.addEventListener('mouseup', () => {
      errDragging = false;
    });
  }
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
    case 'new-file':
      newFileDialog();
      break;
    case 'new-folder': {
      const dirName = prompt('文件夹名:');
      if (dirName && contextMenuTarget) {
        const targetDir = contextMenuTarget.isDirectory ? path : path.substring(0, path.replace(/\\/g, '/').lastIndexOf('/'));
        const newPath = (targetDir || state.projectPath || '') + '/' + dirName;
        try {
          await window.api.createDir?.(newPath);
          if (state.projectPath) await loadFileTree(state.projectPath);
          showToast('文件夹已创建', 'success');
        } catch (err) {
          showToast(`创建失败: ${(err as Error).message}`, 'error');
        }
      }
      break;
    }
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
    case 'rename': {
      const newName = prompt('新名称:', contextMenuTarget?.name || '');
      if (newName && newName !== contextMenuTarget?.name && contextMenuTarget) {
        const dir = path.replace(/[\\/][^\\/]+$/, '');
        const newPath = dir + '/' + newName;
        try {
          await window.api.renameFile(path, newPath);
          if (state.projectPath) await loadFileTree(state.projectPath);
          showToast('已重命名', 'success');
        } catch (err) {
          showToast(`重命名失败: ${(err as Error).message}`, 'error');
        }
      }
      break;
    }
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
    hideWelcomePage();
    await loadFileTree(state.projectPath);
    // 记录到最近项目
    window.api.addRecentProject?.(state.projectPath).catch(() => {});
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
        <h3>虎猫</h3>
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
    hideTypingIndicator();
    stopStreaming();
    const session = ensureSession();
    const content = state.currentStreamContent;
    session.chatHistory.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });
    state.currentStreamContent = '';

    // ── 检测 AI 分段读取请求 ──
    const readMatches = content.match(/\/read\s+(\d+)\s*-\s*(\d+)/g);
    if (readMatches && readMatches.length > 0 && state.activeFileIndex >= 0) {
      const lastMatch = readMatches[readMatches.length - 1];
      const m = lastMatch.match(/\/read\s+(\d+)\s*-\s*(\d+)/);
      if (m) {
        const start = parseInt(m[1]);
        const end = parseInt(m[2]);
        confirmAiRead(start, end);
      }
    }

    // ── 持久化聊天记录 ──
    saveSessionsToDisk();
  });

  window.api.on('ai-stream-error', (_event, error) => {
    hideTypingIndicator();
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
        toggleTerminal();
        break;
      case 'send-to-builder':
        sendToAI();
        break;
      case 'abort-task':
        stopStreaming();
        break;
      case 'clear-chat':
        document.getElementById('chat-messages')!.innerHTML = '';
        ensureSession().chatHistory = [];
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
    } else if (ctrl && e.shiftKey && e.key.toUpperCase() === 'P') {
      // 命令面板
      e.preventDefault();
      openCommandPalette();
    } else if (ctrl && e.shiftKey && e.key.toUpperCase() === 'F') {
      // 项目级搜索
      e.preventDefault();
      openSearchPanel();
    } else if (ctrl && e.key === '`') {
      // 切换终端
      e.preventDefault();
      toggleTerminal();
    } else if (ctrl && e.key === 'w') {
      // 关闭当前标签页
      e.preventDefault();
      if (state.openFiles.length > 0) {
        const idx = state.activeFileIndex >= 0 ? state.activeFileIndex : state.openFiles.length - 1;
        closeFile(idx);
      }
    } else if (ctrl && e.key === 'Tab') {
      // 切换下一个标签页
      e.preventDefault();
      if (state.openFiles.length > 1) {
        const next = (state.activeFileIndex + 1) % state.openFiles.length;
        switchToFile(next);
      }
    } else if (ctrl && e.shiftKey && e.key === 'Tab') {
      // 切换上一个标签页
      e.preventDefault();
      if (state.openFiles.length > 1) {
        const prev = (state.activeFileIndex - 1 + state.openFiles.length) % state.openFiles.length;
        switchToFile(prev);
      }
    } else if (ctrl && e.key === 'p') {
      // 快速打开文件：触发全局搜索
      e.preventDefault();
      openSearchPanel();
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
  document.getElementById('btn-new-folder')?.addEventListener('click', () => {
    const dirName = prompt('文件夹名:');
    if (dirName && state.projectPath) {
      const newPath = state.projectPath.replace(/\\/g, '/') + '/' + dirName;
      window.api.createDir(newPath).then(() => {
        loadFileTree(state.projectPath!);
        showToast('文件夹已创建', 'success');
      }).catch((err: Error) => showToast(`创建失败: ${err.message}`, 'error'));
    }
  });

  // 系统操作按钮
  document.getElementById('btn-open-terminal')?.addEventListener('click', () =>
    window.api.openTerminal(state.projectPath || undefined));
  document.getElementById('btn-open-browser')?.addEventListener('click', () => {
    const url = prompt('输入 URL (默认 http://localhost:3000):', 'http://localhost:3000');
    if (url) window.api.openBrowser(url);
  });
  document.getElementById('btn-open-folder')?.addEventListener('click', () =>
    window.api.openFolder(state.projectPath || undefined));

  // 折叠全部
  document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
    document.querySelectorAll('.tree-children').forEach(el => el.remove());
    document.querySelectorAll('.arrow.open').forEach(el => el.classList.remove('open'));
  });

  // ═══ 活动栏：视图切换 ═══
  document.querySelectorAll('.activity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = (btn as HTMLElement).dataset.view;
      if (!view) return;
      // 更新按钮激活状态
      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // 切换视图面板
      document.querySelectorAll('.view-panel').forEach(p => p.classList.add('hidden'));
      const searchBar = document.getElementById('sidebar-search-explorer');
      if (view === 'explorer') {
        document.getElementById('file-tree')?.classList.remove('hidden');
        if (searchBar) searchBar.classList.remove('hidden');
        document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('EXPLORER');
      } else if (view === 'search') {
        document.getElementById('file-tree')?.classList.remove('hidden');
        if (searchBar) searchBar.classList.remove('hidden');
        document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('SEARCH');
        document.getElementById('file-tree-search')?.focus();
      } else if (view === 'git') {
        document.getElementById('git-panel')?.classList.remove('hidden');
        if (searchBar) searchBar.classList.add('hidden');
        document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('GIT');
        refreshGitPanel();
      } else if (view === 'arch') {
        document.getElementById('arch-panel')?.classList.remove('hidden');
        if (searchBar) searchBar.classList.add('hidden');
        document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('ARCH');
        refreshArchPanel();
      } else if (view === 'settings') {
        // settings 打开设置弹窗，保持当前视图
        switchToSettingsTab();
        // 恢复激活状态到 explorer
        document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.activity-btn[data-view="explorer"]')?.classList.add('active');
      }
    });
  });

  // ═══ 主题切换（白虎 / 老虎） ═══
  const themeBtn = document.getElementById('btn-toggle-theme');
  function applyEditorTheme(isLight: boolean): void {
    if (editor) {
      monaco.editor.setTheme(isLight ? 'trae-light' : 'trae-dark');
    }
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const isLight = document.documentElement.classList.toggle('theme-light');
      themeBtn.setAttribute('title', isLight ? '切换为老虎（暗色）' : '切换为白虎（亮色）');
      applyEditorTheme(isLight);
      try { localStorage.setItem('tcide-theme', isLight ? 'light' : 'dark'); } catch {}
    });
    try {
      if (localStorage.getItem('tcide-theme') === 'light') {
        document.documentElement.classList.add('theme-light');
        themeBtn.setAttribute('title', '切换为老虎（暗色）');
        applyEditorTheme(true);
      }
    } catch {}
  }

  // ═══ Git 面板 ═══
  async function refreshGitPanel() {
    const statusList = document.getElementById('git-status-list');
    const branchEl = document.getElementById('git-branch-name');
    if (!statusList || !state.projectPath) {
      if (statusList) statusList.innerHTML = '<div class="git-empty">请先打开项目</div>';
      return;
    }
    statusList.innerHTML = '<div class="git-empty">加载中...</div>';
    try {
      const status = await window.api.getGitStatus(state.projectPath);
      if (!status.success) {
        statusList.innerHTML = '<div class="git-empty">非 Git 仓库或无变更</div>';
        return;
      }
      if (branchEl) branchEl.textContent = status.branch;
      if (status.files.length === 0) {
        statusList.innerHTML = '<div class="git-empty">✓ 工作区干净</div>';
      } else {
        statusList.innerHTML = status.files.map(f => {
          const iconMap: Record<string, string> = { M: '📝', A: '➕', D: '🗑️', R: '📋', '??': '🆕', '!': '⚠️', 'U': '⚠️' };
          const statusCode = f.status || '??';
          const icon = iconMap[statusCode] || '📄';
          const cssClass = statusCode === 'M' ? 'modified' : statusCode === 'A' ? 'added' : statusCode === 'D' ? 'deleted' : statusCode === '??' ? 'untracked' : '';
          return `<div class="git-status-item"><span class="status-icon ${cssClass}">${icon}</span><span class="status-path">${f.path}</span></div>`;
        }).join('');
      }
    } catch {
      statusList.innerHTML = '<div class="git-empty">Git 状态读取失败</div>';
    }
  }

  document.getElementById('btn-git-pull')?.addEventListener('click', async () => {
    if (!state.projectPath) return;
    showToast('正在拉取...', 'info');
    const result = await window.api.pull(state.projectPath);
    if (result.success) {
      showToast('拉取成功', 'success');
      refreshGitPanel();
    } else {
      showToast(`拉取失败: ${result.error}`, 'error');
    }
  });

  document.getElementById('btn-git-commit')?.addEventListener('click', () => {
    document.getElementById('git-commit-area')?.classList.toggle('hidden');
  });

  document.getElementById('btn-git-do-commit')?.addEventListener('click', async () => {
    if (!state.projectPath) return;
    const msgInput = document.getElementById('git-commit-message') as HTMLInputElement;
    const msg = msgInput?.value?.trim();
    if (!msg) { showToast('请输入提交信息', 'warn'); return; }
    showToast('正在提交...', 'info');
    // Stage all first
    await window.api.stageAll(state.projectPath);
    const commitResult = await window.api.commit(state.projectPath, msg);
    if (commitResult.success) {
      showToast('提交成功', 'success');
      // Auto push
      const pushResult = await window.api.push(state.projectPath);
      if (pushResult.success) showToast('已推送到远程', 'success');
      else showToast(`推送失败: ${pushResult.error}`, 'warn');
      msgInput.value = '';
      document.getElementById('git-commit-area')?.classList.add('hidden');
      refreshGitPanel();
    } else {
      showToast(`提交失败: ${commitResult.error}`, 'error');
    }
  });

  document.getElementById('btn-git-push')?.addEventListener('click', async () => {
    if (!state.projectPath) return;
    showToast('正在推送...', 'info');
    const result = await window.api.push(state.projectPath);
    if (result.success) {
      showToast('推送成功', 'success');
    } else {
      showToast(`推送失败: ${result.error}`, 'error');
    }
  });

  // ═══ 架构分析面板 ═══
  async function refreshArchPanel() {
    const overview = document.getElementById('arch-overview');
    const depsEl = document.getElementById('arch-deps');
    const smellsEl = document.getElementById('arch-smells');
    if (!overview || !state.projectPath) {
      if (overview) overview.innerHTML = '<div class="arch-empty">请先打开项目</div>';
      return;
    }
    overview.innerHTML = '<div class="arch-empty">正在分析依赖… ⏳</div>';
    if (depsEl) depsEl.classList.add('hidden');
    if (smellsEl) smellsEl.classList.add('hidden');
    try {
      const arch = await window.api.analyzeArchitecture(state.projectPath);
      
      // 语言颜色
      const langColors: Record<string, string> = {
        kotlin: '#7F52FF', java: '#b07219', typescript: '#3178c6', javascript: '#f7df1e',
        python: '#3572A5', go: '#00ADD8', rust: '#dea584', xml: '#0060ac',
        markdown: '#083fa1', json: '#292929', css: '#563d7c', html: '#e34c26',
        yaml: '#cb171e', toml: '#9c4221', shell: '#89e051', gradle: '#02303a',
      };

      const totalLang = Object.values(arch.languages).reduce((a: number, b: number) => a + b, 0);
      const langBar = Object.entries(arch.languages).map(([lang, count]) => {
        const pct = ((count as number / totalLang) * 100).toFixed(1);
        const color = langColors[lang] || '#666';
        return `<div class="arch-lang-segment" style="width:${pct}%;background:${color}" title="${lang}"></div>`;
      }).join('');

      const langLegend = Object.entries(arch.languages).map(([lang, count]) => {
        const color = langColors[lang] || '#666';
        return `<span class="arch-lang-item"><span class="arch-lang-dot" style="background:${color}"></span>${lang}:${count}</span>`;
      }).join('');

      // 概览
      overview.innerHTML = `
        <div class="arch-stats">
          <div class="arch-stat"><div class="stat-value">${arch.totalFiles}</div><div class="stat-label">文件数</div></div>
          <div class="arch-stat"><div class="stat-value">${(arch.totalLines / 1000).toFixed(1)}k</div><div class="stat-label">总行数</div></div>
          <div class="arch-stat"><div class="stat-value">${(arch.totalSize / 1024 / 1024).toFixed(1)}MB</div><div class="stat-label">总大小</div></div>
          <div class="arch-stat"><div class="stat-value">${arch.nodes.filter((n: any) => n.type === 'file').length}</div><div class="stat-label">源文件</div></div>
        </div>
        <div class="arch-lang-bar">${langBar}</div>
        <div class="arch-lang-legend">${langLegend}</div>
        ${arch.entryPoints.length > 0 ? `
          <div class="arch-entry-points">
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px">入口点:</div>
            ${arch.entryPoints.slice(0, 5).map((e: string) => `<div class="arch-entry-item">${e}</div>`).join('')}
          </div>
        ` : ''}
      `;

      // 依赖图（Top 15 被依赖最多的文件）
      const fileNodes = arch.nodes.filter((n: any) => n.type === 'file').sort((a: any, b: any) => b.depCount - a.depCount).slice(0, 15);
      if (fileNodes.length > 0 && depsEl) {
        depsEl.classList.remove('hidden');
        const depGraph = document.getElementById('arch-dep-graph');
        if (depGraph) {
          depGraph.innerHTML = fileNodes.map((n: any) => `
            <div class="arch-dep-item">
              <span class="dep-from">${n.name}</span>
              <span class="dep-arrow">←</span>
              <span class="dep-to">${n.exports.slice(0, 3).join(', ') || '(无导出)'}</span>
              <span class="dep-count">${n.depCount} 引用</span>
            </div>
          `).join('');
        }
      }

      // 代码异味
      if (arch.smells.length > 0 && smellsEl) {
        smellsEl.classList.remove('hidden');
        const smellList = document.getElementById('arch-smell-list');
        if (smellList) {
          smellList.innerHTML = arch.smells.slice(0, 30).map((s: any) => `
            <div class="arch-smell-item">
              <span class="arch-smell-icon ${s.severity}">${s.severity === 'error' ? '🔴' : '🟡'}</span>
              <div>
                <div class="arch-smell-text">${s.message}</div>
                <div class="arch-smell-file">${s.file}:${s.line}</div>
              </div>
            </div>
          `).join('');
        }
      }
    } catch (err: unknown) {
      overview.innerHTML = `<div class="arch-empty">分析失败: ${(err as Error).message}</div>`;
    }
  }

  document.getElementById('btn-arch-refresh')?.addEventListener('click', refreshArchPanel);

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
      const f = files[i] as File & { path?: string };
      if (!f.path) continue; // 跳过无路径的文件
      const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
      const isImg = IMG_EXTS.has(ext);
      const maxSize = isImg ? MAX_IMG_SIZE : MAX_FILE_SIZE;
      if (f.size > maxSize) { showToast(`文件 "${f.name}" 超过限制`, 'warn'); continue; }
      const meta: AttachmentMeta = {
        id: crypto.randomUUID(), name: f.name, path: f.path,
        size: f.size, type: isImg ? 'image' : 'file',
        mime: isImg ? 'image/' + ext.slice(1) : 'text/plain',
      };
      if (isImg) {
        try { meta.dataUrl = await window.api.readFileAsDataURL(f.path); } catch (_) {}
      }
      attachments.push(meta);
    }
    renderAttachmentBar();
  });

  // ── 终端切换按钮 ──
  document.getElementById('status-panel-toggle')?.addEventListener('click', toggleTerminal);

  // ── 模型快速切换 ──
  document.getElementById('quick-model-select')?.addEventListener('change', onQuickModelChange);

  // ═══ v1.2 新交互 ═══

  // ── Activity Bar ──
  document.querySelectorAll('.activity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = (btn as HTMLElement).dataset.view;
      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (view === 'explorer') {
        document.getElementById('sidebar')!.style.display = '';
        showToast('资源管理器', 'info');
      } else if (view === 'search') {
        openSearchPanel();
      } else if (view === 'settings') {
        switchToSettingsTab();
      }
    });
  });

  // ── Panel 标签切换 ──
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const panelName = (tab as HTMLElement).dataset.panel!;
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById(`panel-${panelName}`);
      if (content) {
        content.classList.add('active');
        if (panelName === 'terminal') {
          setTimeout(() => fitActiveTerminal(), 50);
        }
      }
    });
  });

  // ── Panel 关闭按钮 ──
  document.getElementById('btn-panel-close')?.addEventListener('click', toggleTerminal);

  // ── Panel 拖拽调整器 ──
  let panelResizeY = 0;
  let panelStartHeight = 0;
  const panelResizer = document.getElementById('panel-resizer')!;
  const panelArea = document.getElementById('panel-area')!;
  panelResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    panelResizeY = e.clientY;
    panelStartHeight = panelArea.offsetHeight;
    panelResizer.classList.add('dragging');
    const onMouseMove = (ev: MouseEvent) => {
      const delta = panelResizeY - ev.clientY;
      const newHeight = Math.max(80, Math.min(500, panelStartHeight + delta));
      panelArea.style.height = newHeight + 'px';
      editor?.layout();
      fitActiveTerminal();
    };
    const onMouseUp = () => {
      panelResizer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // ── AI 面板：新建对话 ──
  document.getElementById('btn-new-chat')?.addEventListener('click', () => {
    const welcome = document.getElementById('ai-welcome');
    if (welcome) welcome.style.display = '';
    const container = document.getElementById('chat-messages')!;
    container.innerHTML = '';
    createSession();
    switchSession(state.currentSessionId);
    // 切回聊天视图
    document.getElementById('chat-list-view')!.classList.add('hidden');
    document.getElementById('chat-content-view')!.classList.remove('hidden');
    showToast('新对话已创建', 'success');
  });

  // ── AI 面板：对话历史 ──
  document.getElementById('btn-chat-history')?.addEventListener('click', () => {
    const listView = document.getElementById('chat-list-view')!;
    const contentView = document.getElementById('chat-content-view')!;
    listView.classList.toggle('hidden');
    contentView.classList.toggle('hidden');
    renderChatList();
  });

  document.getElementById('btn-back-to-chat')?.addEventListener('click', () => {
    document.getElementById('chat-list-view')!.classList.add('hidden');
    document.getElementById('chat-content-view')!.classList.remove('hidden');
  });

  // ── AI 欢迎页提示词芯片 ──
  document.querySelectorAll('.ai-prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = (chip as HTMLElement).dataset.prompt;
      if (prompt) {
        const input = document.getElementById('chat-input') as HTMLTextAreaElement;
        input.value = prompt;
        input.focus();
      }
    });
  });

  // ── Header 模型选择器 ──
  document.getElementById('model-select-header')?.addEventListener('change', (e) => {
    const model = (e.target as HTMLSelectElement).value;
    if (model) {
      state.config.model = model;
      document.getElementById('chat-footer-model')!.textContent = model;
      // 同步更新旧的选择器
      const quickSelect = document.getElementById('quick-model-select') as HTMLSelectElement;
      if (quickSelect) quickSelect.value = model;
    }
  });

  // ── 标签页拖拽排序 ──
  document.getElementById('editor-tabs')?.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedTab) return;
    const tabs = document.getElementById('editor-tabs')!;
    const tab = (e.target as HTMLElement).closest('.tab-item') as HTMLElement;
    if (tab && tab !== draggedTab) {
      const rect = tab.getBoundingClientRect();
      const isAfter = e.clientX > rect.left + rect.width / 2;
      if (isAfter) {
        tab.after(draggedTab);
      } else {
        tab.before(draggedTab);
      }
    }
  });
  document.getElementById('editor-tabs')?.addEventListener('drop', () => {
    if (draggedTab) {
      draggedTab.classList.remove('dragging');
      draggedTab.draggable = false;
      draggedTab = null;
      // 同步 openFiles 数组顺序
      syncOpenFilesOrder();
    }
  });

  // ── 输出通道选择 ──
  document.getElementById('output-channel')?.addEventListener('change', (e) => {
    const channel = (e.target as HTMLSelectElement).value;
    const output = document.getElementById('output-content')!;
    output.textContent = `等待 ${channel === 'build' ? '构建' : channel === 'ai' ? 'AI 执行' : '主进程'} 输出...`;
  });

  document.getElementById('btn-clear-output')?.addEventListener('click', () => {
    document.getElementById('output-content')!.textContent = '';
  });

}

async function openProjectDialog(): Promise<void> {
  const path = await window.api.openProject();
  if (path) {
    state.projectPath = path;
    await loadFileTree(path);
    loadSessionsFromDisk();

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

    // 👁 启动文件监听
    window.api.watchProject(path, true);
    window.api.onFileChanged(() => {
      if (state.projectPath) loadFileTree(state.projectPath);
    });

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
    const dirtyEl = document.getElementById('status-dirty');
    if (dirtyEl) dirtyEl.style.display = 'none';
    renderEditorTabs();
  } catch (err) {
    alert(`保存失败: ${(err as Error).message}`);
  }
}

// ─────────────────────────────────────────
// 命令面板
// ─────────────────────────────────────────
interface Command {
  id: string; label: string; category: string; shortcut?: string; action: () => void;
}

const commandRegistry: Command[] = [
  { id: 'new-file', label: '新建文件', category: '文件', shortcut: 'Ctrl+N', action: () => newFileDialog() },
  { id: 'new-folder', label: '新建文件夹', category: '文件', shortcut: 'Ctrl+Shift+N', action: () => { /* TODO */ showToast('请使用文件树操作', 'info'); } },
  { id: 'save', label: '保存文件', category: '文件', shortcut: 'Ctrl+S', action: () => saveCurrentFile() },
  { id: 'open-project', label: '打开项目', category: '文件', shortcut: 'Ctrl+O', action: () => openProjectDialog() },
  { id: 'search-global', label: '全局搜索', category: '搜索', shortcut: 'Ctrl+Shift+F', action: () => openSearchPanel() },
  { id: 'goto-line', label: '跳转到行...', category: '搜索', shortcut: 'Ctrl+G', action: () => { const n = prompt('行号:'); if (n) editor?.revealLine(parseInt(n)); } },
  { id: 'ai-generate', label: 'AI 生成代码', category: 'AI', shortcut: 'Ctrl+Shift+I', action: () => editor?.getAction('tcide-ai-insert')?.run() },
  { id: 'ai-explain', label: 'AI 解释代码', category: 'AI', shortcut: 'Ctrl+Shift+E', action: () => editor?.getAction('tcide-ai-explain')?.run() },
  { id: 'ai-refactor', label: 'AI 重构代码', category: 'AI', action: () => editor?.getAction('tcide-ai-refactor')?.run() },
  { id: 'ai-tests', label: 'AI 生成测试', category: 'AI', action: () => editor?.getAction('tcide-ai-tests')?.run() },
  { id: 'ai-fix', label: 'AI 修复 Bug', category: 'AI', action: () => editor?.getAction('tcide-ai-fix')?.run() },
  { id: 'ai-docs', label: 'AI 生成文档注释', category: 'AI', action: () => editor?.getAction('tcide-ai-docs')?.run() },
  { id: 'ai-builder', label: 'Builder 架构模式', category: 'AI', shortcut: 'Ctrl+Shift+B', action: () => { document.getElementById('chat-input')?.focus(); showToast('Builder 模式激活', 'info'); } },
  { id: 'open-terminal', label: '打开终端', category: '系统', shortcut: 'Ctrl+Shift+T', action: () => window.api.openTerminal(state.projectPath || undefined) },
  { id: 'open-browser', label: '打开浏览器测试', category: '系统', shortcut: 'Ctrl+Shift+U', action: () => { const url = prompt('输入 URL (默认 localhost:3000):', 'http://localhost:3000'); if (url) window.api.openBrowser(url); } },
  { id: 'open-folder', label: '在文件管理器打开', category: '系统', shortcut: 'Ctrl+Shift+O', action: () => window.api.openFolder(state.projectPath || undefined) },
  { id: 'open-system-file', label: '用默认程序打开当前文件', category: '系统', action: () => { const f = state.openFiles[state.activeFileIndex]; if (f) window.api.openSystemFile(f.path); } },
  { id: 'ai-coder', label: 'Coder 编程模式', category: 'AI', shortcut: 'Ctrl+Shift+C', action: () => { document.getElementById('chat-input')?.focus(); showToast('Coder 模式激活', 'info'); } },
  { id: 'task-loop', label: '/task 任务循环', category: 'AI', action: () => { (document.getElementById('chat-input') as HTMLTextAreaElement).value = '/task '; document.getElementById('chat-input')?.focus(); } },
  { id: 'toggle-ai', label: '切换 AI 面板', category: '视图', shortcut: 'Ctrl+\\', action: () => { document.getElementById('ai-panel')!.classList.toggle('hidden'); editor?.layout(); } },
  { id: 'zen-mode', label: 'Zen 专注模式', category: '视图', shortcut: 'Ctrl+Shift+M', action: () => { document.body.classList.toggle('zen-mode'); editor?.layout(); updateZenStatusBar(); } },
  { id: 'toggle-terminal', label: '切换终端', category: '视图', shortcut: 'Ctrl+`', action: () => toggleTerminal() },
  { id: 'open-settings', label: '打开设置', category: '设置', shortcut: 'Ctrl+,', action: () => switchToSettingsTab() },
  { id: 'show-help', label: '快捷键速查', category: '帮助', action: () => document.getElementById('help-dialog')?.classList.remove('hidden') },
  { id: 'show-about', label: '关于 TCIDE', category: '帮助', action: () => document.getElementById('about-dialog')?.classList.toggle('hidden') },
  { id: 'abort-task', label: '终止 AI 任务', category: 'AI', shortcut: 'Esc', action: () => { stopStreaming(); window.api.abortTask?.(); } },
];

let cmdPaletteSelectedIdx = 0;
let cmdPaletteFiltered: Command[] = [];

function openCommandPalette(): void {
  document.getElementById('command-palette')!.classList.remove('hidden');
  const input = document.getElementById('cmd-palette-input') as HTMLInputElement;
  input.value = '';
  cmdPaletteSelectedIdx = 0;
  cmdPaletteFiltered = [...commandRegistry];
  renderCommandPaletteResults();
  setTimeout(() => input.focus(), 50);
}

function closeCommandPalette(): void {
  document.getElementById('command-palette')!.classList.add('hidden');
}

function renderCommandPaletteResults(): void {
  const container = document.getElementById('cmd-palette-results')!;
  const groups = new Map<string, Command[]>();
  for (const cmd of cmdPaletteFiltered) {
    const list = groups.get(cmd.category) || [];
    list.push(cmd);
    groups.set(cmd.category, list);
  }
  let html = '';
  let idx = 0;
  for (const [cat, cmds] of groups) {
    html += `<div class="cmd-palette-category">${cat}</div>`;
    for (const cmd of cmds) {
      html += `<div class="cmd-palette-item${idx === cmdPaletteSelectedIdx ? ' selected' : ''}" data-idx="${idx}">
        <span class="cmd-label">${cmd.label}</span>
        ${cmd.shortcut ? `<span class="cmd-shortcut">${cmd.shortcut}</span>` : ''}
      </div>`;
      idx++;
    }
  }
  if (cmdPaletteFiltered.length === 0) {
    html = '<div class="cmd-palette-category">无匹配命令</div>';
  }
  container.innerHTML = html;
  // 绑定点击
  container.querySelectorAll('.cmd-palette-item').forEach(item => {
    item.addEventListener('click', () => {
      const i = parseInt((item as HTMLElement).dataset.idx!);
      if (i >= 0 && i < cmdPaletteFiltered.length) {
        cmdPaletteFiltered[i].action();
        closeCommandPalette();
      }
    });
  });
}

function filterCommandPalette(query: string): void {
  const q = query.toLowerCase();
  cmdPaletteFiltered = commandRegistry.filter(c =>
    c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || (c.shortcut?.toLowerCase().includes(q))
  );
  cmdPaletteSelectedIdx = 0;
  renderCommandPaletteResults();
}

function initCommandPalette(): void {
  document.getElementById('cmd-palette-input')?.addEventListener('input', (e) => {
    filterCommandPalette((e.target as HTMLInputElement).value);
  });
  document.getElementById('cmd-palette-input')?.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Escape') { closeCommandPalette(); return; }
    if (ke.key === 'Enter') {
      if (cmdPaletteFiltered[cmdPaletteSelectedIdx]) {
        cmdPaletteFiltered[cmdPaletteSelectedIdx].action();
      }
      closeCommandPalette();
      return;
    }
    if (ke.key === 'ArrowDown') {
      e.preventDefault();
      cmdPaletteSelectedIdx = Math.min(cmdPaletteSelectedIdx + 1, cmdPaletteFiltered.length - 1);
      renderCommandPaletteResults();
    }
    if (ke.key === 'ArrowUp') {
      e.preventDefault();
      cmdPaletteSelectedIdx = Math.max(cmdPaletteSelectedIdx - 1, 0);
      renderCommandPaletteResults();
    }
  });
  document.getElementById('cmd-palette-backdrop')?.addEventListener('click', closeCommandPalette);
}

// ─────────────────────────────────────────
// 欢迎页
// ─────────────────────────────────────────
let recentProjects: Array<{ path: string; name: string; lastOpened: number }> = [];

async function loadRecentProjects(): Promise<void> {
  try {
    recentProjects = await window.api.getRecentProjects?.() || [];
  } catch { recentProjects = []; }
}

function renderWelcomePage(): void {
  const welcome = document.getElementById('welcome-page')!;
  const recentList = document.getElementById('welcome-recent-list')!;
  const recentSection = document.getElementById('welcome-recent')!;

  if (recentProjects.length > 0) {
    recentSection.classList.remove('hidden');
    recentList.innerHTML = recentProjects.slice(0, 10).map(p => {
      const time = formatRelativeTime(p.lastOpened);
      return `<div class="welcome-recent-item" data-path="${p.path}">
        <span class="recent-name">📁 ${p.name}</span>
        <span class="recent-path" title="${p.path}">${p.path}</span>
        <span class="recent-time">${time}</span>
      </div>`;
    }).join('');
    recentList.querySelectorAll('.welcome-recent-item').forEach(item => {
      item.addEventListener('click', async () => {
        const p = (item as HTMLElement).dataset.path!;
        state.projectPath = p;
        await loadFileTree(p);
        welcome.classList.add('hidden');
        loadSessionsFromDisk();
        showToast(`已打开 ${p.split(/[\\/]/).pop()}`, 'success');
      });
    });
  } else {
    recentSection.classList.add('hidden');
  }
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 3600000) return '刚刚';
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function showWelcomePage(): void {
  document.getElementById('welcome-page')!.classList.remove('hidden');
  document.getElementById('editor-tabs')!.style.display = 'none';
  document.getElementById('monaco-container')!.style.display = 'none';
  renderWelcomePage();
}

function hideWelcomePage(): void {
  document.getElementById('welcome-page')!.classList.add('hidden');
  document.getElementById('editor-tabs')!.style.display = '';
  document.getElementById('monaco-container')!.style.display = '';
}

function initWelcomePage(): void {
  document.getElementById('welcome-open-project')?.addEventListener('click', () => openProjectDialog());
  document.getElementById('welcome-new-project')?.addEventListener('click', () => {
    openProjectDialog().then(() => {
      if (state.projectPath) newFileDialog();
    });
  });
  loadRecentProjects().then(() => renderWelcomePage());
  if (!state.projectPath) showWelcomePage();
}

// ─────────────────────────────────────────
// 代码大纲
// ─────────────────────────────────────────
interface OutlineSymbol {
  name: string; kind: string; line: number; level: number; children: OutlineSymbol[];
}

function parseOutlineSymbols(code: string, language: string): OutlineSymbol[] {
  const lines = code.split('\n');
  const symbols: OutlineSymbol[] = [];
  const lang = language.toLowerCase();

  if (['kotlin', 'java', 'typescript', 'javascript', 'go', 'rust', 'python'].includes(lang)) {
    // 通用：匹配 fun/function/def/func/fn 定义
    const funcRegex = /^\s*(?:fun\s+|function\s+|def\s+|func\s+|fn\s+|public\s+(?:fun\s+|function\s+)?|private\s+(?:fun\s+|function\s+)?|protected\s+(?:fun\s+|function\s+)?|suspend\s+fun\s+)([\w]+)\s*\(/;
    const classRegex = /^\s*(?:class\s+|interface\s+|object\s+|enum\s+class\s+|data\s+class\s+|sealed\s+class\s+)([\w]+)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match = classRegex.exec(line);
      if (match) {
        symbols.push({ name: match[1], kind: 'class', line: i + 1, level: 1, children: [] });
        continue;
      }
      match = funcRegex.exec(line);
      if (match) {
        const indent = line.match(/^\s*/)?.[0].length || 0;
        const level = indent > 4 ? 3 : indent > 0 ? 2 : 1;
        symbols.push({ name: match[1], kind: 'function', line: i + 1, level, children: [] });
      }
    }
  }

  // Markdown 标题
  if (lang === 'markdown') {
    const headingRegex = /^(#{1,6})\s+(.+)/;
    for (let i = 0; i < lines.length; i++) {
      const match = headingRegex.exec(lines[i]);
      if (match) {
        symbols.push({ name: match[2], kind: 'heading', line: i + 1, level: match[1].length, children: [] });
      }
    }
  }

  // JSON keys
  if (lang === 'json') {
    const keyRegex = /^\s*"([^"]+)"\s*:/;
    for (let i = 0; i < lines.length; i++) {
      const match = keyRegex.exec(lines[i]);
      if (match) {
        const indent = lines[i].match(/^\s*/)?.[0].length || 0;
        const level = Math.min(Math.floor(indent / 2) + 1, 4);
        symbols.push({ name: match[1], kind: 'property', line: i + 1, level, children: [] });
      }
    }
  }

  return symbols;
}

function renderOutline(): void {
  const tree = document.getElementById('outline-tree')!;
  const filter = (document.getElementById('outline-filter') as HTMLInputElement).value.toLowerCase();

  if (!editor || state.activeFileIndex < 0) {
    tree.innerHTML = '<div class="outline-empty">打开文件以查看大纲</div>';
    return;
  }

  const code = editor.getValue();
  const lang = state.openFiles[state.activeFileIndex]?.language || 'plaintext';
  const symbols = parseOutlineSymbols(code, lang);

  if (symbols.length === 0) {
    tree.innerHTML = '<div class="outline-empty">未检测到符号</div>';
    return;
  }

  const filtered = filter ? symbols.filter(s => s.name.toLowerCase().includes(filter)) : symbols;

  if (filtered.length === 0) {
    tree.innerHTML = '<div class="outline-empty">无匹配符号</div>';
    return;
  }

  const icons: Record<string, string> = { class: '📦', function: 'ƒ', heading: '#', property: '•' };
  tree.innerHTML = filtered.map(s =>
    `<div class="outline-item level-${s.level}" data-line="${s.line}">
      <span class="outline-icon">${icons[s.kind] || '·'}</span>
      <span class="outline-name">${s.name}</span>
      <span class="outline-detail">:${s.line}</span>
    </div>`
  ).join('');

  tree.querySelectorAll('.outline-item').forEach(item => {
    item.addEventListener('click', () => {
      const line = parseInt((item as HTMLElement).dataset.line!);
      editor?.revealLineInCenter(line);
      editor?.setPosition({ lineNumber: line, column: 1 });
      editor?.focus();
    });
  });
}

function initOutline(): void {
  document.getElementById('outline-filter')?.addEventListener('input', renderOutline);
  // 监听编辑器内容变化，更新大纲
  editor?.onDidChangeModelContent(() => {
    if (!document.getElementById('tab-outline')?.classList.contains('hidden')) {
      renderOutline();
    }
  });
}

// ─────────────────────────────────────────
// 文件树搜索
// ─────────────────────────────────────────
function filterFileTree(query: string): void {
  const items = document.querySelectorAll('.tree-item') as NodeListOf<HTMLElement>;
  const q = query.toLowerCase();
  let anyVisible = false;

  items.forEach(item => {
    const name = (item.querySelector('.name') as HTMLElement)?.textContent?.toLowerCase() || '';
    if (!q || name.includes(q)) {
      item.style.display = '';
      anyVisible = true;
    } else {
      item.style.display = 'none';
    }
  });

  // 隐藏/显示折叠的子容器
  document.querySelectorAll('.tree-children').forEach(el => {
    (el as HTMLElement).style.display = q ? 'none' : '';
  });

  document.getElementById('btn-clear-search')!.classList.toggle('hidden', !q);
}

function initFileTreeSearch(): void {
  const searchInput = document.getElementById('file-tree-search') as HTMLInputElement;
  searchInput?.addEventListener('input', () => filterFileTree(searchInput.value));
  document.getElementById('btn-clear-search')?.addEventListener('click', () => {
    searchInput.value = '';
    filterFileTree('');
  });
}

// ─────────────────────────────────────────
// 项目搜索面板
// ─────────────────────────────────────────
function openSearchPanel(): void {
  document.getElementById('search-panel')!.classList.remove('hidden');
  document.getElementById('search-input')!.focus();
}

function closeSearchPanel(): void {
  document.getElementById('search-panel')!.classList.add('hidden');
}

async function executeSearch(): Promise<void> {
  const query = (document.getElementById('search-input') as HTMLInputElement).value;
  if (!query || !state.projectPath) return;

  const container = document.getElementById('search-results')!;
  container.innerHTML = '<div class="search-empty"><span class="loading-spinner"></span> 搜索中...</div>';

  try {
    const results = await window.api.searchInProject?.(state.projectPath, query) || [];
    if (results.length === 0) {
      container.innerHTML = '<div class="search-empty">未找到匹配结果</div>';
      return;
    }
    container.innerHTML = results.slice(0, 100).map((r: { file: string; line: number; text: string }) => {
      const relPath = r.file.replace(state.projectPath!, '').replace(/^[\\/]/, '');
      return `<div class="search-result-item" data-file="${r.file}" data-line="${r.line}">
        <span class="search-result-file">${relPath}</span>
        <span class="search-result-line">${r.line}:</span>
        <span class="search-result-text">${r.text.slice(0, 120)}</span>
      </div>`;
    }).join('');

    container.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', async () => {
        const el = item as HTMLElement;
        const file = el.dataset.file!;
        const line = parseInt(el.dataset.line!);
        const name = file.split(/[\\/]/).pop()!;
        await openFile(file, name);
        editor?.revealLineInCenter(line);
        editor?.setPosition({ lineNumber: line, column: 1 });
      });
    });
  } catch {
    container.innerHTML = '<div class="search-empty">搜索出错</div>';
  }
}

function initSearchPanel(): void {
  document.getElementById('search-input')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') executeSearch();
  });
  document.getElementById('btn-search-next')?.addEventListener('click', executeSearch);
  document.getElementById('btn-search-close')?.addEventListener('click', closeSearchPanel);
  document.getElementById('btn-toggle-replace')?.addEventListener('click', () => {
    document.getElementById('search-replace')!.classList.toggle('hidden');
  });
}

// ─────────────────────────────────────────
// 标签页右键菜单
// ─────────────────────────────────────────
let tabContextTargetIndex = -1;

function showTabContextMenu(e: MouseEvent, tabIndex: number): void {
  tabContextTargetIndex = tabIndex;
  const menu = document.getElementById('tab-context-menu')!;
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.classList.remove('hidden');
  e.preventDefault();
  e.stopPropagation();
}

function hideTabContextMenu(): void {
  document.getElementById('tab-context-menu')!.classList.add('hidden');
}

async function handleTabContextAction(action: string): Promise<void> {
  hideTabContextMenu();
  if (tabContextTargetIndex < 0) return;
  const file = state.openFiles[tabContextTargetIndex];
  if (!file) return;

  switch (action) {
    case 'tab-close':
      closeFile(tabContextTargetIndex);
      break;
    case 'tab-close-others':
      state.openFiles = [file];
      state.activeFileIndex = 0;
      renderEditorTabs();
      switchToFile(0);
      break;
    case 'tab-close-right':
      state.openFiles = state.openFiles.slice(0, tabContextTargetIndex + 1);
      if (state.activeFileIndex > tabContextTargetIndex) state.activeFileIndex = tabContextTargetIndex;
      renderEditorTabs();
      break;
    case 'tab-copy-path':
      navigator.clipboard.writeText(file.path);
      showToast('路径已复制', 'success');
      break;
    case 'tab-reveal':
      await window.api.showItemInFolder(file.path);
      break;
    case 'tab-close-all':
      state.openFiles = [];
      state.activeFileIndex = -1;
      renderEditorTabs();
      editor?.setModel(null);
      break;
    case 'tab-split-right':
      showToast('分屏编辑功能即将上线', 'info');
      break;
  }
}

function initTabContextMenu(): void {
  document.addEventListener('click', hideTabContextMenu);
  document.querySelectorAll('#tab-context-menu .ctx-item').forEach(item => {
    item.addEventListener('click', () => {
      handleTabContextAction((item as HTMLElement).dataset.action || '');
    });
  });
}

// ─────────────────────────────────────────
// 面包屑导航
// ─────────────────────────────────────────
function updateBreadcrumb(): void {
  const bar = document.getElementById('breadcrumb-bar')!;
  const pathEl = document.getElementById('breadcrumb-path')!;
  const symbolEl = document.getElementById('breadcrumb-symbol')!;

  if (state.activeFileIndex < 0 || !state.projectPath) {
    bar.classList.add('hidden');
    return;
  }

  const file = state.openFiles[state.activeFileIndex];
  const relPath = file.path.replace(state.projectPath, '').replace(/^[\\/]/, '');
  const parts = relPath.split(/[\\/]/);

  pathEl.innerHTML = parts.map((p, i) => {
    if (i === parts.length - 1) return `<span style="color:var(--text-primary)">📄 ${p}</span>`;
    return `<span>📁 ${p}</span><span class="breadcrumb-sep">›</span>`;
  }).join('');

  // 当前光标所在符号
  if (editor) {
    const pos = editor.getPosition();
    if (pos) {
      const line = editor.getModel()?.getLineContent(pos.lineNumber) || '';
      const match = line.match(/(?:fun|function|def|func|fn|class|interface|object)\s+(\w+)/);
      symbolEl.textContent = match ? ` › ${match[1]}() :${pos.lineNumber}` : ` :${pos.lineNumber}`;
    }
  }

  bar.classList.remove('hidden');
}

// ─────────────────────────────────────────
// 终端切换
// ─────────────────────────────────────────
function toggleTerminal(): void {
  const panel = document.getElementById('panel-area')!;
  const resizer = document.getElementById('panel-resizer')!;
  const toggle = document.getElementById('status-panel-toggle');
  const isVisible = !panel.classList.contains('hidden');
  
  if (isVisible) {
    panel.classList.add('hidden');
    resizer.classList.add('hidden');
    toggle?.classList.remove('panel-visible');
  } else {
    panel.classList.remove('hidden');
    resizer.classList.remove('hidden');
    toggle?.classList.add('panel-visible');
    // 自动初始化终端（如果还没创建）
    initTerminal();
    setTimeout(() => fitActiveTerminal(), 100);
  }
  editor?.layout();
}

// ─────────────────────────────────────────
// 标签拖拽：同步文件顺序
// ─────────────────────────────────────────
function syncOpenFilesOrder(): void {
  const tabs = document.getElementById('editor-tabs')!.querySelectorAll('.tab-item');
  const newOrder: typeof state.openFiles = [];
  tabs.forEach(tab => {
    const idx = parseInt((tab as HTMLElement).dataset.fileIndex || '0');
    if (idx >= 0 && idx < state.openFiles.length) {
      newOrder.push(state.openFiles[idx]);
    }
  });
  if (newOrder.length === state.openFiles.length) {
    state.openFiles = newOrder;
    state.activeFileIndex = 0; // 保持第一个为活跃
  }
}

// ─────────────────────────────────────────
// 对话历史列表
// ─────────────────────────────────────────
function renderChatList(): void {
  const list = document.getElementById('chat-list')!;
  if (state.chatSessions.length === 0) {
    list.innerHTML = '<div class="chat-list-empty">暂无对话</div>';
    return;
  }
  list.innerHTML = state.chatSessions.map(session => {
    const isActive = session.id === state.currentSessionId;
    const firstName = session.chatHistory.find(m => m.role === 'user');
    const title = firstName
      ? firstName.content.slice(0, 40) + (firstName.content.length > 40 ? '...' : '')
      : session.name;
    const time = new Date(session.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const msgCount = session.chatHistory.length;
    return `
      <div class="chat-list-item${isActive ? ' active' : ''}" data-session-id="${session.id}">
        <span class="chat-list-title">${title}</span>
        <span class="chat-list-meta">${msgCount > 0 ? msgCount + ' 条' : '新对话'} · ${time}</span>
        <div class="chat-list-actions">
          <button class="chat-list-rename" data-session-id="${session.id}" title="重命名">✎</button>
          <button class="chat-list-delete" data-session-id="${session.id}" title="删除">×</button>
        </div>
      </div>`;
  }).join('');

  // 点击切换
  list.querySelectorAll('.chat-list-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('chat-list-delete') || target.classList.contains('chat-list-rename')) return;
      const id = (item as HTMLElement).dataset.sessionId!;
      switchSession(id);
    });
  });

  // 删除按钮
  list.querySelectorAll('.chat-list-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.sessionId!;
      deleteSession(id);
    });
  });

  // 重命名按钮
  list.querySelectorAll('.chat-list-rename').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.sessionId!;
      renameSession(id);
    });
  });
}

// ─────────────────────────────────────────
// Zen Mode 状态栏同步
// ─────────────────────────────────────────
function updateZenStatusBar(): void {
  const lang = document.getElementById('zen-language')!;
  const pos = document.getElementById('zen-position')!;
  if (editor) {
    const p = editor.getPosition();
    if (p) pos.textContent = `行 ${p.lineNumber}, 列 ${p.column}`;
  }
  if (state.activeFileIndex >= 0) {
    lang.textContent = state.openFiles[state.activeFileIndex]?.language || '';
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

  // 初始化首个会话
  ensureSession();

  // v1.1 新功能初始化
  initCommandPalette();
  initWelcomePage();
  initOutline();
  initFileTreeSearch();
  initSearchPanel();
  initTabContextMenu();
  initTerminal();

  // ── 会话恢复 ──
  await restoreLastSession();

  // 编辑器光标变化时更新面包屑和 Zen 状态栏
  editor?.onDidChangeCursorPosition(() => {
    updateBreadcrumb();
    updateZenStatusBar();
  });

  // ── 定期自动保存会话 ──
  setInterval(() => saveSession(), 30_000); // 每 30 秒
  window.addEventListener('beforeunload', () => saveSession());

  console.log('[Renderer] PersonalIDE ready');
}

init().catch(console.error);

// ─────────────────────────────────────────
// 会话持久化
// ─────────────────────────────────────────

let _savePending = false;

async function saveSession(): Promise<void> {
  if (_savePending) return;
  _savePending = true;
  try {
    // 收集编辑器滚动位置
    const scrollPositions: Record<string, { scrollTop: number; scrollLeft: number }> = {};
    for (const f of state.openFiles) {
      if (f.path && editor) {
        scrollPositions[f.path] = {
          scrollTop: editor.getScrollTop(),
          scrollLeft: editor.getScrollLeft(),
        };
      }
    }

    await window.api.saveSession({
      projectPath: state.projectPath,
      openFiles: state.openFiles.map(f => ({
        path: f.path, name: f.name, language: f.language,
      })),
      activeFileIndex: state.activeFileIndex,
      chatSessions: state.chatSessions.map(s => ({
        id: s.id, name: s.name,
        chatHistory: s.chatHistory.map(m => ({
          id: m.id, role: m.role, content: m.content, timestamp: m.timestamp,
        })),
        createdAt: s.createdAt, updatedAt: s.updatedAt, projectPath: s.projectPath,
      })),
      currentSessionId: state.currentSessionId,
      scrollPositions,
    });
  } catch (err) {
    // 静默失败
  } finally {
    _savePending = false;
  }
}

async function restoreLastSession(): Promise<void> {
  try {
    const saved = await window.api.restoreSession();
    if (!saved || !saved.projectPath) return;

    console.log('[Session] 恢复上次会话...', saved.timestamp ? new Date(saved.timestamp).toLocaleString() : '');

    // 恢复项目
    state.projectPath = saved.projectPath;
    await loadFileTree(saved.projectPath);
    hideWelcomePage();

    // 恢复 AI 会话
    if (saved.chatSessions && saved.chatSessions.length > 0) {
      state.chatSessions = saved.chatSessions.map(s => ({
        id: s.id, name: s.name,
        chatHistory: s.chatHistory || [],
        createdAt: s.createdAt, updatedAt: s.updatedAt,
        projectPath: s.projectPath,
      }));
      state.currentSessionId = saved.currentSessionId || state.chatSessions[0]?.id || '';
      
      // 恢复对话 UI
      if (state.currentSessionId) {
        renderChatSessions();
        switchSession(state.currentSessionId);
      }
    }

    // 恢复打开的文件
    if (saved.openFiles && saved.openFiles.length > 0) {
      for (let i = 0; i < saved.openFiles.length; i++) {
        const f = saved.openFiles[i];
        try {
          if (f.language === 'pdf') {
            const { base64 } = await window.api.readPdfBase64(f.path);
            const byteChars = atob(base64);
            const byteNums = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
            const byteArr = new Uint8Array(byteNums);
            const blobUrl = URL.createObjectURL(new Blob([byteArr], { type: 'application/pdf' }));
            state.openFiles.push({ path: f.path, name: f.name, content: blobUrl, dirty: false, language: 'pdf' });
          } else if (f.language === 'markdown') {
            // DOCX 文本提取
            try {
              const text = await window.api.readDocxText(f.path);
              state.openFiles.push({ path: f.path, name: f.name, content: text, dirty: false, language: 'markdown' });
            } catch {
              // 可能是普通 md 文件
              const content = await window.api.readFile(f.path);
              state.openFiles.push({ path: f.path, name: f.name, content, dirty: false, language: f.language });
            }
          } else {
            const content = await window.api.readFile(f.path);
            state.openFiles.push({ path: f.path, name: f.name, content, dirty: false, language: f.language || detectLanguage(f.name) });
          }
        } catch {
          // 文件可能已被删除，跳过
        }
      }

      if (state.openFiles.length > 0) {
        const activeIdx = Math.min(saved.activeFileIndex, state.openFiles.length - 1);
        if (activeIdx >= 0) {
          switchToFile(activeIdx);
        }
        renderEditorTabs();

        // 恢复滚动位置
        const savedScroll = saved.scrollPositions?.[state.openFiles[activeIdx]?.path];
        if (savedScroll && editor) {
          setTimeout(() => {
            editor?.setScrollPosition(savedScroll);
          }, 100);
        }
      }
    }

    showToast('已恢复上次工作状态', 'info');
  } catch (err) {
    console.error('[Session] 恢复失败:', err);
  }
}

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
