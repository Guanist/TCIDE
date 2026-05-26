# 虎猫 TCIDE - 个人专属超级 AI 编程 IDE

融合 Trae、Claude Code、OpenAI Codex、OpenClaw 四大工具设计精华，完全本地私有化的 AI 编程 IDE。

## 功能亮点

- 🏗️ **双智能体架构** — Builder 架构师 + Coder 程序员，职责分离，工程化闭环
- 🧠 **超长上下文索引** — 四层索引 + 按需拼装，5 万行代码工程也能精准重构
- ⚙️ **全自动工程闭环** — 分解→执行→编译→修复→提交，无需人工干预
- 🔒 **极致隐私** — 零云端、零上报、零埋点，仅连用户配置的私有 API
- 🪶 **轻量极速** — 安装包 ≤80MB，启动 ≤2 秒，内存 ≤180MB
- 🔄 **工程互操作** — 完美兼容 QClaw / CodeBuddy / Trae 工程文件

## 快速开始

### 环境要求

- Windows 10/11 (x64)
- Node.js 18+
- DeepSeek API Key（或 Ollama 本地模型）

### 安装构建

```bash
# 克隆 / 进入项目目录
cd personal-ide

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 生产构建
npm run dist
```

构建完成后，安装包位于 `release/` 目录。

### 配置 API

首次启动后，点击右侧 AI 面板顶部⚙️图标，打开设置：

- 选择模型：DeepSeek-V3 / DeepSeek-R1 / DeepSeek-Coder / Ollama / 自定义
- 填入 API Key 和 baseUrl（如使用 DeepSeek，baseUrl 为 `https://api.deepseek.com`）
- Builder 和 Coder 可独立选择模型

### 使用方式

1. **打开项目**: `Ctrl+O` 选择项目根目录
2. **自然语言需求**: 在 AI 面板输入需求，例如"新增蓝牙设备扫描功能"
3. **自动化闭环**: 系统自动拆解任务 → 生成代码 → 编译验证 → 修复错误 → 生成测试 → 提交
4. **Zen Mode**: `Ctrl+Shift+M` 一键隐藏两侧面板，专注编辑

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+O` | 打开项目目录 |
| `Ctrl+N` | 新建文件 |
| `Ctrl+Shift+N` | 新建文件夹 |
| `Ctrl+S` | 保存文件 |
| `Ctrl+Shift+F` | 全局搜索 |
| `Ctrl+Shift+P` | 命令面板 |
| `Ctrl+Shift+M` | Zen Mode |
| `Ctrl+\` | 切换 AI 面板 |
| `F1` | 打开设置 |

## 工程互操作

本 IDE 创建的项目可直接被以下工具打开和续写：

- **QClaw**: 读写 `.qclaw/` 配置
- **CodeBuddy**: 读写 `.codebuddy/` 配置
- **Trae**: 读写 `.trae/` 配置

打开项目时系统自动识别并转换，无需手动导入。

## 技术架构

```
src/
├── main/           # Electron 主进程
│   ├── index.ts    # 入口 + 窗口管理
│   ├── ipc-handlers.ts
│   ├── file-service.ts
│   ├── privacy-net.ts
│   └── db/sqlite.ts
├── renderer/       # 渲染进程
│   ├── index.html
│   ├── main.ts
│   ├── components/
│   └── styles/
└── core/           # 业务逻辑
    ├── agent/      # Builder + Coder + 调度器
    ├── model/      # 模型适配层
    ├── indexer/    # 项目索引引擎
    ├── task/       # TaskRunner 闭环引擎
    └── compat/     # 工程文件兼容适配器
```

## License

MIT
