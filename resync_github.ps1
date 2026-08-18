# TCIDE 完整重推脚本 (在 personal-ide 目录用 PowerShell 运行)
# 用途: 共建者删了远程代码后, 把本地 main(含 v0.0.1 源码+README) 全量恢复, 并重新上传 Release exe
# 前置: 需有 github.com 网络 + 有效凭据(若 PAT 已撤销, 先跑 cmdkey /delete:git:https://github.com 再 push)

$ErrorActionPreference = 'Stop'
$repo = "C:\Users\noirh\.qclaw\workspace-ua58rsb93veqtxl7\personal-ide"
Set-Location $repo

Write-Host "=== [1/4] 确认本地状态 ==="
git status -sb
git rev-parse HEAD

Write-Host "=== [2/4] 推送完整代码到 main (force-with-lease 安全覆盖被删的远程) ==="
# 若远程仓库已不存在(404), 需先在 GitHub 网页建同名空仓库 Guanist/TCIDE, 再跑此步
git push -u origin main --force-with-lease
if ($LASTEXITCODE -ne 0) {
    Write-Host "PUSH 失败 (可能仓库被删/凭据失效)。排查: git ls-remote origin; 凭据失效则 cmdkey /delete:git:https://github.com 后重推"
    exit 1
}

Write-Host "=== [3/4] 删掉旧 release(如有) + 重建 v0.0.1 并上传两个 exe ==="
# 需要 GH_TOKEN 环境变量 (ghp_... 那个 token, 若已撤销需换新的)
if (-not $env:GH_TOKEN) { Write-Host "提示: 未设置 GH_TOKEN, 用 gh auth status 检查是否已登录, 否则 gh auth login" }
$portable = "release\TCIDE 0.0.1.exe"
$setup    = "release\TCIDE Setup 0.0.1.exe"
# 先删同名旧 tag/release(避免冲突)
gh release delete v0.0.1 --repo Guanist/TCIDE --yes 2>$null
git push origin :refs/tags/v0.0.1 2>$null
# 重建
gh release create v0.0.1 `
  --repo Guanist/TCIDE `
  --title "TCIDE v0.0.1" `
  --notes "TCIDE v0.0.1 基础 IDE 发布。`n`n包含:`n- Monaco 编辑器 + 文件树 + 内置终端`n- AI 对话 / 模型连接测试 (OpenAI/DeepSeek/Claude/Ollama)`n- 设置面板(模型/连接配置)`n- v0.0.1 前端架构对齐修复(index.html DOM 骨架 + xterm 全局挂载)`n- 完整 README.md`n`n安装包: 便携版(TCIDE 0.0.1.exe) 与 NSIS 安装版(TCIDE Setup 0.0.1.exe) 二选一。" `
  --latest `
  "$portable" "$setup"

Write-Host "=== [4/4] 完成 ==="
Write-Host "源码: https://github.com/Guanist/TCIDE"
Write-Host "发布: https://github.com/Guanist/TCIDE/releases/tag/v0.0.1"
