/*  TCIDE P1 功能前端逻辑 (重建桩)
   文件名：dist/renderer/assets/p1-modules.js
   由 index.html 通过 <script src=...> 加载

   说明：原始 p1-modules.js 的增强功能（Zen Mode / 标签页右键菜单 /
   面包屑 / 空状态 / 新建项目向导 / 全局快捷键）在当前版本已由主逻辑
   (src/renderer/main.ts / 主 bundle) 原生实现。历史完整版在此加载会
   重复绑定 DOM/keydown/setInterval，与主逻辑冲突导致渲染不稳定，
   故此处仅提供兼容性占位：确保 <script> 标签不 404、不抛错，
   且不重复绑定任何事件。
*/

(function () {
  'use strict';

  // 仅当主逻辑未定义时补充占位，避免覆盖原生实现
  var defineOnce = function (name, fn) {
    if (typeof window[name] === 'undefined') {
      try { window[name] = fn; } catch (e) { /* ignore */ }
    }
  };

  defineOnce('__tcide_toggleZen', function () {
    console.log('[P1] Zen Mode 已由主逻辑接管，占位无操作');
  });
  defineOnce('toggleZenMode', function () {
    console.log('[P1] Zen Mode 已由主逻辑接管，占位无操作');
  });
  defineOnce('__tcide_showNewProject', function () {
    console.log('[P1] 新建项目向导已由主逻辑接管，占位无操作');
  });

  console.log('[P1] P1 兼容桩加载完成 (no-op)');
})();