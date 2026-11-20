import { inApp } from './platform.js';
import { fullscreenCapture, onFullscreenCapture } from './pointertrap.js';

let held = null,
  listening = false;

function send(on) {
  if (held === on) return;
  held = on;
  fetch('api/cursor-grab?on=' + (on ? 1 : 0)).catch(() => {});
}

function update() {
  send(fullscreenCapture() && document.hasFocus() && document.visibilityState === 'visible');
}

export function initCursorLock() {
  if (!inApp()) return;
  if (!listening) {
    listening = true;
    addEventListener('focus', update);
    addEventListener('blur', update);
    addEventListener('pointerdown', update, true);
    document.addEventListener('visibilitychange', update);
    document.addEventListener('fullscreenchange', update);
    onFullscreenCapture(update);
  }
  update();
}
