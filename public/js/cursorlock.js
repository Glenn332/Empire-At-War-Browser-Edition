import { inApp, topFrame } from './platform.js';
import { fullscreenCapture, onFullscreenCapture } from './pointertrap.js';

let held = null,
  listening = false;
const frameLocks = new Set();

function send(on) {
  if (held === on) return;
  held = on;
  fetch('api/cursor-grab?on=' + (on ? 1 : 0)).catch(() => {});
}

const pointerLocked = () => {
  for (const w of frameLocks) if (w.closed) frameLocks.delete(w);
  return !!document.pointerLockElement || frameLocks.size > 0;
};

function update() {
  send(fullscreenCapture() && document.hasFocus() && document.visibilityState === 'visible' && !pointerLocked());
}

function lockChanged() {
  if (!pointerLocked()) held = null;
  update();
}

function frameLock(win, on) {
  if (on) frameLocks.add(win);
  else frameLocks.delete(win);
  lockChanged();
}

function reportToTop() {
  try {
    window.top.swrFrameLock?.(window, !!document.pointerLockElement);
  } catch {}
}

export function initCursorLock() {
  if (!inApp()) return;
  if (!topFrame()) {
    if (!listening) {
      listening = true;
      document.addEventListener('pointerlockchange', reportToTop);
      addEventListener('pagehide', () => {
        try {
          window.top.swrFrameLock?.(window, false);
        } catch {}
      });
    }
    return;
  }
  if (!listening) {
    listening = true;
    window.swrFrameLock = frameLock;
    addEventListener('focus', update);
    addEventListener('blur', update);
    addEventListener('pointerdown', update, true);
    document.addEventListener('visibilitychange', update);
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('pointerlockchange', lockChanged);
    onFullscreenCapture(update);
  }
  update();
}
