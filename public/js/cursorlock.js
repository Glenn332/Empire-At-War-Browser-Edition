import { inApp, topFrame } from './platform.js';
import { fullscreen, fullscreenCapture, onFullscreenCapture } from './pointertrap.js';
import { edgePan, onEdgePan } from './game/keybinds.js';

let held = null,
  listening = false;
const frameLocks = new Set();

function send(mode, on) {
  const query = 'mode=' + mode + '&on=' + (on ? 1 : 0);
  if (held === query) return;
  held = query;
  fetch('api/cursor-grab?' + query).catch(() => {});
}

const pointerLocked = () => {
  for (const w of frameLocks) if (w.closed) frameLocks.delete(w);
  return !!document.pointerLockElement || frameLocks.size > 0;
};

// The app keeps the mouse in by what the page wants (mode), whenever the game window is in
// front: the page's own focus events are not enough, as focus coming back after Alt+Tab goes
// to whichever frame had it. Screen-edge panning needs the mouse kept on the game's monitor
// in fullscreen, or it slides past the edge onto the next monitor and never pans that way.
// `on` is the page's own reckoning, for app builds from before mode.
function update() {
  const mode = pointerLocked() ? 'off' : fullscreenCapture() ? 'always' : edgePan() ? 'fullscreen' : 'off';
  send(mode, mode !== 'off' && (mode === 'always' || fullscreen()) && document.hasFocus() && document.visibilityState === 'visible');
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
    onEdgePan(update);
  }
  update();
}
