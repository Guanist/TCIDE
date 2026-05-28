@echo off
:: PersonalIDE - 快速启动脚本 (Windows)
:: 双击运行，或在 VSCode 终端中执行

cd /d "%~dp0"

echo === PersonalIDE 构建 ===
echo.

echo [1/3] 安装依赖...
call npm install
if errorlevel 1 (
    echo npm install 失败，尝试 --ignore-scripts...
    call npm install --ignore-scripts
)

echo.
echo [2/3] 编译主进程 TypeScript...
call npm run build:main
if errorlevel 1 (
    echo 编译失败！
    pause
    exit /b 1
)

echo.
echo [3/3] 启动开发服务器...
echo 前端: http://localhost:5173
echo 然后另开终端运行: npm start
echo.
call npm run dev

pause
