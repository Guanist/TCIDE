/*  TCIDE P2 功能前端逻辑 (重建桩)
   文件名：dist/renderer/assets/p2-modules.js
   由 index.html 通过 <script src=...> 加载

   说明：原始 p2-modules.js 在仓库历史中丢失，其曾定义的全局
   （acceptDiff / closeDiffModal 等）已在主 bundle (index-*.js) 内
   通过 window.acceptDiff / window.closeDiffModal 暴露，故此处仅需
   提供兼容性占位，确保 <script> 标签不 404，并补充少量缺失桥接。
*/

(function () {
  'use strict';

  // 安全兜底：若主 bundle 尚未暴露以下全局，则提供空实现，避免 inline onclick 抛错
  if (typeof window.acceptDiff !== 'function') {
    window.acceptDiff = function () { console.warn('[P2] acceptDiff 未初始化'); };
  }
  if (typeof window.closeDiffModal !== 'function') {
    window.closeDiffModal = function () {
      var m = document.getElementById('diff-modal');
      if (m) m.style.display = 'none';
    };
  }

  // 片段(Snippets)列表桥接：主 bundle 会赋值 window.__tcide_listSnippets
  if (typeof window.__tcide_listSnippets !== 'function') {
    window.__tcide_listSnippets = function () { return []; };
  }

  // 原始 sendToAI 备份桥接：主 bundle 在 MCP 补丁中读取 window.__tcide_originalSendToAI
  if (typeof window.__tcide_originalSendToAI !== 'function') {
    window.__tcide_originalSendToAI = function () { console.warn('[P2] originalSendToAI 未初始化'); };
  }

  console.log('[P2] 兼容桩已加载');
})();
