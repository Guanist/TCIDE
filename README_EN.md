# 🐯 Tiger Cat TCIDE — Your Personal Super AI Coding IDE

**Put an AI engineer in your IDE — build complete projects through conversation**

> Builder → Coder → Compile → Deploy, fully automated

[![Release](https://img.shields.io/github/v/release/Guanist/TCIDE?color=ff8c00)](https://github.com/Guanist/TCIDE/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## ✨ Core Philosophy

**TCIDE** isn't just another "ChatGPT wrapper" editor. It ships with a complete **Builder + Coder dual-Agent collaboration engine** that actually gets things done:

> 🧠 Builder Agent reads requirements → 📋 Breaks down tasks → 💻 Coder Agent writes code → ✅ Compiles & verifies → 🔄 Auto-commits

Just say "build me a xxx", and Tiger Cat handles the rest — design, coding, compilation, and commits.

---

## 🎯 Feature Highlights

### 🤖 Dual AI Agent Engine

| Agent | Role | Input | Output |
|-------|------|-------|--------|
| **Builder** | Requirements analysis & task breakdown | Natural language | Structured task list |
| **Coder** | Code generation & compile verification | Single task | Code diff + compile result |

- Auto-reads project context (file tree, open files, code structure)
- Compile errors auto-fetch logs and self-fix
- Large file smart chunking: `/read N-M` reads by line range
- Multi-model support: DeepSeek V4 / Volcano Ark / Ollama / Anthropic Claude / Custom OpenAI API

### 🎨 UI Design

| Feature | Description |
|---------|-------------|
| 🐯/🐅 Dual Themes | Tiger dark + White Tiger light, synced with Monaco |
| 🏷️ Activity Bar | Icon + label vertical layout (files/search/Git/architecture/problems) |
| 📂 File Tree | 24+ emoji folder icons + 40+ file type icons + recursive watcher |
| 🐯 Thinking Animation | Bouncing Tiger Cat + stage text (analyzing → tool calls → deep reasoning) |
| 📊 AI Stats Bar | Real-time tool call count + deep reasoning count |

### ✏️ Code Editor (Monaco)

- 23 language syntax highlighting + Minimap
- LSP language services: TS/JS built-in + Python pyright + auto-detect 5 languages
- Git Diff line markers (green add / orange modify) + Blame inline annotation
- Auto-save (2s debounce) + dirty indicator in status bar
- Multi-tab switching + drag-to-reorder + right-click menu
- Split editor: dual Monaco instances, `Ctrl+\` vertical / `Alt+2` horizontal
- Emmet expansion: Tab trigger, HTML/CSS/JSX
- Snippets system: 50+ presets (7 languages)

### 📄 File Preview

| Format | Preview |
|--------|---------|
| 🖼️ Images | PNG/JPG/GIF/WebP/BMP inline |
| 🎬 Video/Audio | MP4/WebM/MP3/WAV media player |
| 📄 PDF | iframe Blob URL |
| 📝 DOCX | EOCD ZIP central directory |
| 🌐 HTML / XML / SVG | iframe srcdoc + source toggle |
| 🔢 Binary | Hex viewer (offset + hex + ASCII) |

### 📦 Code Block Capabilities

- Long code blocks (>10 lines) collapse to ~8 lines with expand/collapse button
- 📂 Open in editor / 👁 Preview / ▶ Run / 💾 Save to project / 📋 Copy

### 🔀 Git Integration

- Status panel: branch name, changed files, status icons
- Diff line markers: green/orange bars in editor gutter
- One-click Stage → Commit → Push
- Branch switcher dropdown
- Coder Agent auto-commits on successful compile

### 💬 AI Chat

- Chat list: create / delete / rename (double-click to edit)
- Session persistence to `.tcide/chat/sessions.json` + electron-store
- Select all / delete selected / clear all multi-select operations
- `/file` command sends files (auto-generates outline for huge files)
- `/lines N-M` command sends specific line ranges
- `/task` command: Builder → Coder auto-execution loop
- Code block save prompt: confirms when closing modified files

### 🖥️ Terminal

- xterm.js multi-tab terminal
- Spawn streaming output with incremental rendering
- Tab switch/close auto-rebuilds
- Bottom drag-to-resize panel height

### 🔧 Engineering Capabilities

- **Problems Panel**: Real-time diagnostics, sorted by severity, click-to-jump
- **Debug Panel**: breakpoints / variables / call stack / console
- **Architecture Analysis**: dependency graph, code smell detection, entry point analysis
- **Command Palette** (`Ctrl+Shift+P`): 21 built-in commands, fuzzy search
- **Zen Mode** (`Ctrl+Shift+Z`): distraction-free fullscreen
- **Code Outline** (`Ctrl+Shift+O`): symbol extraction, tree rendering
- **Template System**: 5 built-in + custom creation
- **Keybinding Editor**: visual CRUD, conflict detection
- **Project Search** (`Ctrl+Shift+F`): cross-file regex search

---

## 📦 P0–P3 Module Matrix

### P0 Core (8 modules)
| Module | Function |
|--------|---------|
| DebugManager | Breakpoints / variables / call stack / console panel |
| LintManager | ESLint → Monaco squiggles + problems panel + badge |
| SemanticChunker | Large file AST-boundary smart chunking |
| ContextTrimmer | Chat compression / token budget adaptation |
| AutoHealManager | Compile error auto-parse + fix proposal |
| BatchModifier | Batch replace + Diff preview + one-click rollback |
| PerfOptimizer | Performance metrics + GC cleanup |
| Keybindings | Customizable hotkey system |

### P1 Smart Enhancement (4 modules)
| Module | Function |
|--------|---------|
| GitIntelligence | Smart Commit + Blame/Diff visualization |
| ProjectMemory | Chat memory + context window optimization |
| VectorIndexer | Full-project vector embedding index |
| SemanticCompletion | Context-aware code completion |

### P2 Engineering (3 modules)
| Module | Function |
|--------|---------|
| AgentOrchestrator | Builder+Coder dual-Agent orchestration |
| WarehouseAnalyzer | Metadata + dependency graph + call chain |
| UnattendedRunner | Sandbox execution + step tracking |

### P3 Quality Assurance (3 modules)
| Module | Function |
|--------|---------|
| EntropyEvaluator | Code complexity / coupling evaluation |
| EntropyController | Scheduled health checks + session suggestions |
| SmartTrimmer | Intelligent context pruning strategy |

---

## 🚀 Quick Start

### Download & Install

Get the latest version from [Releases](https://github.com/Guanist/TCIDE/releases):

- **Installer**: NSIS installer with uninstaller and desktop shortcut
- **Portable**: No install needed, run from anywhere

### Development Setup

```bash
git clone https://github.com/Guanist/TCIDE.git
cd TCIDE
npm install
npm run build
```

### Tech Stack

| Layer | Tech |
|-------|------|
| Desktop Framework | Electron 28 |
| Editor | Monaco Editor (VS Code core) |
| Terminal | xterm.js |
| Storage | electron-store + SQLite |
| Build | Vite + electron-builder (NSIS) |
| Language | TypeScript / JavaScript |

---

## 📋 Changelog

### v1.5.1 (2026-05-30) — Experience Polish
- 🐯 Tiger thinking animation: bouncing Tiger Cat + stage indicators
- 📊 AI stats bar: real-time tool calls + deep reasoning counts
- 📦 Long code block auto-collapse + expand/collapse toggle
- 💾 Save confirmation on close of modified files
- 🔧 MCP tool switch visual feedback
- 🐛 Fix: AI reply content loss / duplicate user messages / reply interruption

### v1.5.0-p0 (2026-05-30) — Full Module Delivery
- 🏗️ All P0–P3 modules shipped in one release
- 🔌 57 IPC channels + 397 lines of Preload
- 📂 Image / video / audio preview
- 📋 Version history timeline
- 🏷️ Activity bar icon + label layout
- 🧹 Chat multi-select / select all / clear all

### v1.4.0 (2026-05-30) — Pro Edition
- 🧠 LSP multi-language services (TS/JS/Python/5 languages)
- ⚠️ Problems panel
- 📐 Split editor
- ⚡ Emmet expansion
- 📦 Snippets system
- 🔧 MCP tool integration (9 built-in tools)

### v1.3.0 (2026-05-30) — AI-Powered
- 📝 Template system (5 built-in + custom)
- 🎭 AI persona system
- 🔍 Project-level search
- 🏠 Welcome page (recent projects)
- 🔔 Toast notification system
- 🩺 Self-diagnostic engine

### v1.2.0 (2026-05-30) — Pro Evolution
- 📋 Code outline panel
- ⌨️ Command palette (21 commands)
- 🧘 Zen Mode
- 🖥️ Terminal streaming output
- 🧠 Context manager

### v1.1.0 (2026-05-28) — Full Upgrade
- 🎨 Dual theme switching
- 🔀 Git integration
- 📄 File preview (PDF/DOCX/HTML/SVG/Hex)
- 💬 Chat management
- 🖥️ xterm.js multi-tab terminal
- 🤖 AI auto-read protocol

### v1.0.0 (2026-05-26) — Tiger Cat is Born
- Electron three-process architecture
- Monaco Editor (23 languages)
- AI dual Agent engine
- Multi-model support
- File tree + dark theme

---

## 📊 Project Stats

| Metric | Value |
|--------|-------|
| Total source lines | 7,000+ (src/) |
| TypeScript modules | 33+ |
| IPC channels | 57 |
| Supported file formats | 40+ preview types |
| Supported languages | 23+ syntax highlighting |
| LSP languages | 7 auto-detected |

---

## 🙏 Acknowledgements

- **Monaco Editor** — Microsoft's open-source editor core
- **xterm.js** — Terminal emulator
- **Electron** — Cross-platform desktop framework
- **Vite** — Next-gen build tool
- **DeepSeek / Volcano Ark / Anthropic** — AI model providers

---

Built by [Guanist, Inc.](https://github.com/guanist) | Author: Vincent Luo | WeChat: 文森特骆
