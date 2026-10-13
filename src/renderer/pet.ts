import { setSvgPetState } from './svg-pet';
// TCIDE Pet Bridge — relays AI events to pet overlay window via IPC
// The actual pet rendering happens in the separate transparent BrowserWindow

let streaming = false;
let toolCount = 0;

/** 统一的状态出口：既通知独立宠物窗口（Electron），也更新界面里的矢量宠物。
 *  放在一个地方，是为了不漏状态 —— 原先 6 处直接调 IPC，加钩子很容易只改一半。 */
function emit(state: string, label: string): void {
  setSvgPetState(state, label);
  window.api?.petSetState?.(state, label);
}

export function initPixelPet(): void {
  // Pet window is created by main process automatically
  // This just listens for AI events and relays them
  window.api?.on('ai-stream-chunk', () => {
    if (!streaming) {
      streaming = true;
      window.api?.petSetState?.('thinking', '分析中…');
    }
  });
  window.api?.on('ai-stream-end', () => {
    streaming = false;
    window.api?.petSetState?.('success', '完成!');
    setTimeout(() => window.api?.petSetState?.('idle', 'Idle'), 2500);
  });
  window.api?.on('ai-stream-error', () => {
    streaming = false;
    window.api?.petSetState?.('error', '出错');
    setTimeout(() => window.api?.petSetState?.('idle', 'Idle'), 2500);
  });
}

export function petToolCallStart(name: string): void {
  toolCount++;
  window.api?.petSetState?.('tool', name);
}

export function petToolCallEnd(ok: boolean): void {
  window.api?.petSetState?.(ok ? 'success' : 'error', ok ? '✓' : '✗');
  setTimeout(() => window.api?.petSetState?.('idle', 'Idle'), 2000);
}

export function setPetState(state: string, label: string): void {
  window.api?.petSetState?.(state, label);
}
