// SPDX-FileCopyrightText: 2026 Guanist, Inc.
// SPDX-License-Identifier: LGPL-3.0-only
/**
 * 虎猫 TCIDE · Web 端主题切换（约 60 行，不依赖任何构建）
 *
 * 为什么这么小：前端是压缩产物、**没有源码可重建**，所以主题只能做成"在页面里
 * 挂一个属性 + 一层 CSS 覆盖"。这既够用，也不需要动 bundle。
 *
 * 行为：
 * 1. 优先读本机记住的选择（localStorage），没有就跟随系统（prefers-color-scheme）；
 * 2. 把 `data-tcide-theme` 写到 <html> 上（CSS 变量据此切换）；
 * 3. 右下角挂一个切换按钮 —— 用户能自己选，而不是被系统偏好锁死。
 */
(function () {
  "use strict";
  var KEY = "tcide-theme";
  var root = document.documentElement;

  // URL 参数优先（?theme=light / ?theme=dark）：一次性显式指定，不写入 localStorage。
  // 用途：分享"浅色版"链接；以及文档/截图需要确定性地得到某个主题。
  function fromQuery() {
    try {
      var match = /[?&]theme=(light|dark)\b/.exec(window.location.search);
      return match ? match[1] : "";
    } catch (e) { return ""; }
  }

  function preferred() {
    var asked = fromQuery();
    if (asked) return asked;
    try {
      var saved = localStorage.getItem(KEY);
      if (saved === "dark" || saved === "light") return saved;
    } catch (e) { /* 隐私模式下 localStorage 可能抛异常，忽略即可 */ }
    try {
      if (window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    } catch (e) { /* 老浏览器没有 matchMedia */ }
    return "dark"; // 默认深色：与桌面端的默认主题一致
  }

  function apply(name) {
    root.setAttribute("data-tcide-theme", name);
    // 同步应用自带的类名机制（main.ts 用 classList.toggle('theme-light')）：
    // 两套触发指向同一份变量，才不会互相打架。
    try {
      root.classList.toggle("theme-light", name === "light");
    } catch (e) { /* 老浏览器没有 classList.toggle 的第二参数 */ }
    var button = document.getElementById("tcide-theme-toggle");
    if (button) {
      button.textContent = name === "dark" ? "☀" : "☾"; // 显示"点了会变成什么"
      button.title = name === "dark" ? "切换到浅色（白橙）" : "切换到深色（黑橙）";
      button.setAttribute("aria-label", button.title);
    }
  }

  function set(name) {
    apply(name);
    try { localStorage.setItem(KEY, name); } catch (e) { /* 存不下也不影响本次使用 */ }
  }

  function mount() {
    if (document.getElementById("tcide-theme-toggle")) return;
    var button = document.createElement("button");
    button.id = "tcide-theme-toggle";
    button.type = "button";
    button.addEventListener("click", function () {
      set(root.getAttribute("data-tcide-theme") === "dark" ? "light" : "dark");
    });
    document.body.appendChild(button);
    apply(root.getAttribute("data-tcide-theme") || preferred());
  }

  // 尽早把属性写上（避免"先白闪一下再变黑"）
  var bootstrapped = root.classList.contains("theme-light") ? "light" : preferred();
  apply(bootstrapped);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  // 给外部（自检 / 控制台）用
  window.tcideTheme = { get: function () { return root.getAttribute("data-tcide-theme"); },
                        set: set };
})();
