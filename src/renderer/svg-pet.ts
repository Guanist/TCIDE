// SPDX-FileCopyrightText: 2026 Guanist, Inc.
// SPDX-License-Identifier: LGPL-3.0-only
/**
 * 虎猫宠物（平面矢量版）—— 状态栏里的宠物。
 *
 * ## 为什么需要这个文件
 *
 * 原实现有**两套**宠物：
 *   1. `pet-window.html`：Electron 的**独立透明窗口**，用 canvas 画像素画；
 *   2. 一段注入到首页的 `.tcide-pet` 样式（`vite.config.ts` 里的 PET_CSS）。
 *
 * 结果是：**Web / PyWebView 版里根本没有宠物** —— 样式在，但没有代码创建元素
 * （第 2 套只有 CSS，没有 DOM）。而"丑"的印象来自第 1 套的 canvas 像素画
 * （Electron 时代遗留）。
 *
 * 所以这里不是"美化"，而是**用新的矢量版把宠物接回界面**：
 *   · 复用 `/icons/pet/tcide-pet.svg`（手绘平面矢量，见 docs/PET_DESIGN.md）
 *   · 状态用类名切换（`.state-idle` / `.state-work` / `.state-sleep` / `.state-error`）
 *   · 应用现有的十个状态**映射**到这四个视觉（见 STATE_MAP）
 *   · 尊重 `prefers-reduced-motion`（动画写在 SVG 里，它会自己处理）
 *
 * 为什么用 fetch 内联 SVG 而不是 `<img src=...>`：外部 SVG 在 `<img>` 里是**独立文档**，
 * 外部的 CSS 类**影响不到它的内部元素**，状态就切不了。内联之后样式才生效。
 */

/** 应用现有的十个状态 → 矢量宠物的四个视觉状态。 */
export const STATE_MAP: Record<string, 'idle' | 'work' | 'sleep' | 'error'> = {
  idle: 'idle',
  thinking: 'work',
  tool: 'work',
  run: 'work',
  review: 'work',
  success: 'idle',
  jump: 'idle',
  wave: 'idle',
  error: 'error',
  failed: 'error',
};

/** 每个应用状态在气泡里显示什么（沿用原有文案风格）。 */
const LABELS: Record<string, string> = {
  idle: '待机',
  thinking: '分析中…',
  tool: '调用工具',
  run: '执行中…',
  review: '审查中…',
  success: '完成',
  jump: '完成',
  wave: '在的',
  error: '出错',
  failed: '失败',
};

/** 某个应用状态对应的矢量状态。未知状态一律按待机处理（不猜、也不报错）。 */
export function visualStateFor(state: string): 'idle' | 'work' | 'sleep' | 'error' {
  return STATE_MAP[state] ?? 'idle';
}

let container: HTMLElement | null = null;
let labelEl: HTMLElement | null = null;
let speechEl: HTMLElement | null = null;
let speechTimer: number | undefined;

/**
 * 找状态栏。
 *
 * 注意：这份遗产代码里 `#status-bar` 与 `.status-bar` **两套命名并存**
 * （注入样式里两者都有）。实测用 `getElementById('status-bar')` 拿到的是 null ——
 * 真实元素用的是类名 —— 于是宠物在初始化第一行就悄悄返回了。所以两种都认。
 */
function statusBar(): HTMLElement | null {
  return document.getElementById('status-bar')
    || document.querySelector<HTMLElement>('.status-bar')
    || document.querySelector<HTMLElement>('#statusbar, .statusbar');
}

/**
 * 盯着状态栏：应用的 `updateEditorStatusBar()` 会重写 `#status-bar` 的内容，
 * 把宠物一起冲掉（这是实测到的现象 —— 插进去了，一更新就没了）。
 * 所以不能"插一次就完"，要跟着重挂。
 */
function watchStatusBar(): void {
  const bar = statusBar();
  if (!bar) return;
  const ensure = (): void => {
    if (!container || !bar.contains(container)) bar.insertBefore(container, bar.firstChild);
  };
  try {
    new MutationObserver(ensure).observe(bar, { childList: true });
  } catch { /* 老浏览器没有 MutationObserver：退化为只在初始化时插入 */ }
  ensure();
}

/** 创建宠物容器（幂等）。找不到状态栏就安静退出 —— 宠物是可选装饰，不该影响主流程。 */
export function initSvgPet(): void {
  if (container || !statusBar()) return;

  container = document.createElement('div');
  container.id = 'tcide-pet';
  container.className = 'tcide-pet state-idle';
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', '虎猫宠物：待机');
  container.title = '虎猫会跟着 AI 的状态变化';

  labelEl = document.createElement('span');
  labelEl.className = 'pet-label';
  labelEl.textContent = LABELS.idle;

  speechEl = document.createElement('div');
  speechEl.className = 'pet-speech';
  speechEl.setAttribute('aria-live', 'polite');

  // 内联 SVG：外部 <img> 会把 SVG 变成独立文档，外部类名影响不到内部元素，状态就切不了。
  const holder = document.createElement('span');
  holder.className = 'pet-canvas';
  holder.style.cssText = ('display:inline-flex;width:36px;height:36px;flex-shrink:0;'
    + 'image-rendering:auto');   // 注入样式里带 pixelated，矢量图要覆盖掉
  container.append(holder, labelEl, speechEl);

  // 放在状态栏最前面（左侧），和原来的设计一致。
  const bar = statusBar()!;
  bar.insertBefore(container, bar.firstChild);
  watchStatusBar();

  fetch('/icons/pet/tcide-pet.svg')
    .then((response) => (response.ok ? response.text() : Promise.reject(new Error('svg'))))
    .then((markup) => {
      holder.innerHTML = markup;
      // SVG 自带 200x200 的宽高属性，不缩会溢出 36px 的容器
      const svg = holder.querySelector('svg');
      if (svg) { svg.setAttribute('width', '36'); svg.setAttribute('height', '36'); }
    })
    .catch(() => {
      // 取不到就不显示宠物，但**不隐藏状态栏**，也不抛错。
      container?.remove();
      container = null;
    });
}

/**
 * 设置宠物状态。所有状态变化都会经过 `pet.ts` 的 `petSetState`，
 * 所以只要在那一个地方接上，界面上的十个状态就都覆盖到了。
 */
export function setSvgPetState(state: string, label?: string): void {
  if (!container) return;
  const visual = visualStateFor(state);
  container.classList.remove('state-idle', 'state-work', 'state-sleep', 'state-error');
  container.classList.add(`state-${visual}`);
  const text = label || LABELS[state] || '';
  if (labelEl) labelEl.textContent = text;
  container.setAttribute('aria-label', `虎猫宠物：${text || visual}`);
  if (text) showSpeech(text);
}

/** 冒泡说话（沿用注入样式里的 .pet-speech）。 */
export function showSpeech(text: string, ms = 2200): void {
  if (!speechEl || !text) return;
  speechEl.textContent = text;
  speechEl.classList.add('show');
  window.clearTimeout(speechTimer);
  speechTimer = window.setTimeout(() => speechEl?.classList.remove('show'), ms);
}
