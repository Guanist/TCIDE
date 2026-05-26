# PersonalIDE - 快速启动脚本
# 在 npm install && npm run dev 之前运行即可

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

Write-Host "=== PersonalIDE 构建工具 ===" -ForegroundColor Cyan

# 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "错误: 未找到 Node.js，请先安装" -ForegroundColor Red
    exit 1
}

Write-Host "Node: $(node --version)"
Write-Host "npm: $(npm --version)"

# 检查 Python (better-sqlite3 需要)
$pythonCmd = $null
foreach ($cmd in @("python3", "python", "py")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        $pythonCmd = $cmd
        break
    }
}

if (-not $pythonCmd) {
    Write-Host "警告: 未找到 Python，native 模块构建可能失败" -ForegroundColor Yellow
} else {
    Write-Host "Python: $(& $pythonCmd --version)"
}

# 安装依赖
Write-Host "`n[1/3] 安装依赖..." -ForegroundColor Green
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "npm install 失败，尝试用 --ignore-scripts" -ForegroundColor Yellow
    npm install --ignore-scripts
}

# 编译主进程
Write-Host "`n[2/3] 编译主进程 TypeScript..." -ForegroundColor Green
npm run build:main

# 启动开发模式
Write-Host "`n[3/3] 启动开发服务器..." -ForegroundColor Green
Write-Host "打开 http://localhost:5173 查看前端" -ForegroundColor Cyan
Write-Host "然后运行 'npm start' 启动 Electron" -ForegroundColor Cyan

npm run dev
