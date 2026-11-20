import { inApp } from './platform.js';
import { fullscreen, fullscreenCapture, onFullscreenCapture } from './pointertrap.js';

const KEY = 'swr-cursor-lock';
let want = false,
  held = null,
  listening = false;

export function cursorLockSetting() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

function send(on) {
  if (held === on) return;
  held = on;
  fetch('api/cursor-grab?on=' + (on ? 1 : 0)).catch(() => {});
}

function update() {
  send((fullscreen() ? fullscreenCapture() : want) && document.hasFocus() && document.visibilityState === 'visible');
}

export function setCursorLock(on) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {}
  want = !!on && inApp();
  update();
}

export function initCursorLock(box) {
  if (box) {
    box.checked = cursorLockSetting();
    box.parentElement.hidden = !inApp();
    box.parentElement.title = 'Keeps the mouse inside the game window while windowed, for playing on one screen of several. Alt+Tab frees it.';
    box.onchange = () => setCursorLock(box.checked);
  }
  if (!inApp()) return;
  want = cursorLockSetting();
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
