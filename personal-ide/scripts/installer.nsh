; TCIDE - 虎猫 IDE 安装向导自定义脚本
; 品牌介绍 + 桌面快捷 + 开机自启

; ── 欢迎页面 ──
!define MUI_WELCOMEPAGE_TITLE "欢迎使用 虎猫 TCIDE"
!define MUI_WELCOMEPAGE_TEXT "虎猫 TCIDE 是由 Guanist, Inc. 开发的个人专属超级 AI 编程 IDE。$\r$\n$\r$\n作者：文森特骆$\r$\n公众号：文森特骆$\r$\n$\r$\n集成 DeepSeek / 火山方舟 / Ollama 三大 AI 引擎，内置 Builder + Coder 双 Agent 架构，支持 Android / Kotlin / Java / Python / TypeScript 全栈开发。$\r$\n$\r$\n三栏布局 · Monaco 编辑器 · 终端内嵌 · 实时 AI 对话 · 一键编译部署"

; ── 完成页面 ──
!define MUI_FINISHPAGE_TITLE "虎猫 TCIDE 安装完成"
!define MUI_FINISHPAGE_TEXT "虎猫 TCIDE 已成功安装到您的计算机。$\r$\n$\r$\n由 Guanist, Inc. 开发 | 作者：文森特骆$\r$\n公众号：文森特骆"

!define MUI_FINISHPAGE_LINK "访问 Guanist, Inc."
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/guanist"

; ── 确保桌面快捷创建 ──
!macro customInstall
  ; 强制创建桌面快捷方式
  CreateShortCut "$DESKTOP\虎猫TCIDE.lnk" "$INSTDIR\虎猫 TCIDE.exe"
  ; 开机自启
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "虎猫TCIDE" '"$INSTDIR\虎猫 TCIDE.exe" --minimized'
  ; 刷新图标缓存
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  Delete "$DESKTOP\虎猫TCIDE.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "虎猫TCIDE"
!macroend
