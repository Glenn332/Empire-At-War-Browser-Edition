import { edgePan, held } from './keybinds.js';

// Equal mouse/key directions don't double the speed; opposite inputs cancel.
export function panAxis(keys, positive, negative, hover = 0) {
  return Number(held(keys, positive) || hover === 1) - Number(held(keys, negative) || hover === -1);
}

// Screen-space intent only. Modes still own their speeds, yaw, locks and bounds.
export function edgeAxis(pos, size, band) {
  if (!(size > 0) || pos < 0 || pos >= size) return 0;
  return pos < band ? -1 : pos >= size - band ? 1 : 0;
}
const idle = Object.freeze({ right: 0, forward: 0 });
export function edgeCursor(canvas, signal) {
  let active = false,
    x = 0,
    y = 0;
  const reset = () => {
    active = false;
  };
  const move = e => {
    active = e.pointerType === 'mouse' && !e.buttons;
    x = e.clientX;
    y = e.clientY;
  };
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal, passive: true });
  on(canvas, 'pointermove', move);
  for (const type of ['pointerdown', 'pointerleave', 'pointercancel', 'lostpointercapture']) on(canvas, type, reset);
  on(window, 'blur', reset);
  on(document, 'visibilitychange', reset);
  on(document, 'pointerlockchange', reset);
  const out = { ...idle };
  return (band = 14) => {
    const lock = document.pointerLockElement;
    // Fullscreen pointertrap locks the document root and dispatches virtual
    // mouse positions on the canvas. A canvas lock instead belongs to look.
    if (!active || !edgePan() || document.hidden || (lock && lock !== document.documentElement) || !document.hasFocus()) return idle;
    out.right = edgeAxis(x, innerWidth, band);
    out.forward = -edgeAxis(y, innerHeight, band);
    // A dialog or minimap may open under a stationary cursor between events.
    if ((out.right || out.forward) && document.elementFromPoint(x, y) !== canvas) return idle;
    return out;
  };
}
