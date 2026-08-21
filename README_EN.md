# 🐯 Tiger Cat TCIDE — Your Personal AI Coding IDE

**Put an AI engineer in your IDE — build complete projects through conversation**

> Builder → Coder → Compile → Deploy, fully automated

[![Release](https://img.shields.io/github/v/release/Guanist/TCIDE?color=ff8c00)](https://github.com/Guanist/TCIDE/releases)
[![License](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)

---

## ✨ Core Philosophy

**TCIDE** ships with a complete **Builder + Coder dual-Agent collaboration engine**:

> 🧠 Builder reads requirements → 📋 Breaks down tasks → 💻 Coder writes code → ✅ Compiles & verifies → 🔄 Auto-commits

Just say "build me a xxx", and Tiger Cat handles the rest.

---

## 🎯 Feature Highlights

### 🤖 Dual AI Agent Engine

| Agent | Role |
|-------|------|
| **Builder** | Requirements analysis & task breakdown |
| **Coder** | Code generation & compile verification |

- Auto-reads project context (file tree, open files, code structure)
- Compile errors auto-fetch logs and self-fix
- Multi-model support: DeepSeek / Volcano Ark / Ollama / Anthropic / Custom OpenAI API

### ✏️ Code Editor (Monaco)

- 23 language syntax highlighting + Minimap
- LSP language services: TS/JS built-in + Python pyright + auto-detect 5 languages
- Git Diff line markers + Blame inline annotation
- Auto-save + dirty indicator in status bar
- Multi-tab switching + drag-to-reorder
- Split editor: dual Monaco instances
- Emmet expansion + Snippets system (50+ presets)

### 📄 File Preview

| Format | Preview |
|--------|---------|
| 🖼️ Images | PNG/JPG/GIF/WebP/BMP inline |
| 🎬 Video/Audio | MP4/WebM/MP3/WAV media player |
| 📄 PDF | iframe Blob URL |
| 🌐 HTML / XML / SVG | iframe srcdoc + source toggle |
| 🔢 Binary | Hex viewer |

### 🔀 Git Integration

- Status panel: branch name, changed files, status icons
- One-click Stage → Commit → Push
- Branch switcher dropdown
- Coder Agent auto-commits on successful compile

### 💬 AI Chat

- Chat list: create / delete / rename
- `/file` command sends files
- `/task` command: Builder → Coder auto-execution loop
- Code block save prompt

### 🖥️ Terminal

- xterm.js multi-tab terminal
- Spawn streaming output with incremental rendering

### 🔧 Engineering Capabilities

- **Problems Panel**: Real-time diagnostics, sorted by severity
- **Architecture Analysis**: dependency graph, code smell detection
- **Command Palette** (`Ctrl+Shift+P`): 21 built-in commands
- **Zen Mode** (`Ctrl+Shift+Z`): distraction-free fullscreen
- **Code Outline** (`Ctrl+Shift+O`): symbol extraction
- **Project Search** (`Ctrl+Shift+F`): cross-file regex search

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

## 🙏 Acknowledgements

- **Monaco Editor** — Microsoft's open-source editor core
- **xterm.js** — Terminal emulator
- **Electron** — Cross-platform desktop framework
- **Vite** — Next-gen build tool
- **DeepSeek / Volcano Ark / Anthropic** — AI model providers

---

Built by [Guanist, Inc.](https://github.com/guanist) | Author: Vincent Luo | WeChat: 文森特骆
