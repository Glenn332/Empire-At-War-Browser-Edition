import { onPointerFrame } from './game/pointers.js';

// Hardware Mouse, as in the original game's video options. On (the default), Windows draws the
// game's pointer as the system cursor. Off, the page hides the system cursor and draws the pointer
// itself on top of the page: on some graphics drivers the system cursor stops being drawn after
// Alt+Tab in fullscreen while the mouse still works, and a pointer the page draws is in every
// frame it shows. The drawn pointer moves at the page's frame rate, a little behind the hand when
// that is low. Each frame (the multiplayer galaxy and its battles run in frames) draws its own.

const KEY = 'swr-hardware-mouse';
let hardware = null;
const watchers = new Set();

export function hardwareMouse() {
  if (hardware === null) {
    try {
      hardware = localStorage.getItem(KEY) !== '0';
    } catch {
      hardware = true;
    }
  }
  return hardware;
}

export function setHardwareMouse(on) {
  hardware = !!on;
  try {
    localStorage.setItem(KEY, hardware ? '1' : '0');
  } catch {}
  draw();
  for (const f of watchers) f(hardware);
}
export const onHardwareMouse = f => watchers.add(f);

let canvas = null,
  shown = null,
  x = 0,
  y = 0,
  inside = false,
  target = null;

// the page has hidden its cursor here: pointer lock, an element over a frame (that frame draws its
// own), or a style rule that hides the cursor and marks it with --cursor-hidden
function cursorHidden(el) {
  if (document.pointerLockElement) return true;
  if (!el || el.nodeType !== 1 || el.tagName === 'IFRAME') return true;
  try {
    return getComputedStyle(el).getPropertyValue('--cursor-hidden').trim() === '1';
  } catch {
    return false;
  }
}

// the pointer the nearest element shows (the game sets POINTER_NORMAL on the page itself)
function frameFor(el) {
  for (let n = el; n; n = n.parentElement) if (n.swrPointer) return n.swrPointer;
  return null;
}

function setSoft(on) {
  document.documentElement.classList.toggle('soft-cursor', on);
}

function hide() {
  if (canvas) canvas.style.display = 'none';
}

function draw() {
  if (hardwareMouse()) {
    setSoft(false);
    hide();
    return;
  }
  if (!inside) return hide();
  if (cursorHidden(target)) {
    setSoft(true);
    return hide();
  }
  const f = frameFor(target);
  // nothing loaded to draw yet (the game data is still loading): the system cursor shows meanwhile
  if (!f) {
    setSoft(false);
    return hide();
  }
  setSoft(true);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'softCursor';
    canvas.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(canvas);
  }
  if (shown !== f.image) {
    const img = f.image,
      w = img.naturalWidth || img.width,
      h = img.naturalHeight || img.height;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, w, h);
    c.drawImage(img, 0, 0);
    shown = img;
  }
  canvas.style.transform = `translate(${x - f.x}px, ${y - f.y}px)`;
  canvas.style.display = 'block';
}

function moved(e) {
  if (e.pointerType === 'touch') {
    inside = false;
    return draw();
  }
  x = e.clientX;
  y = e.clientY;
  target = e.target;
  inside = true;
  draw();
}

let started = false;
export function initSoftCursor() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const opts = { capture: true, passive: true };
  for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointerover']) addEventListener(type, moved, opts);
  addEventListener(
    'pointerout',
    e => {
      if (e.relatedTarget) return;
      inside = false;
      draw();
    },
    opts
  );
  document.documentElement.addEventListener('mouseleave', () => {
    inside = false;
    draw();
  });
  document.addEventListener('pointerlockchange', draw);
  addEventListener('blur', draw);
  // the option set in another frame
  addEventListener('storage', e => {
    if (e.key !== KEY) return;
    hardware = null;
    draw();
  });
  onPointerFrame(el => {
    if (inside && target && !hardwareMouse() && (el === target || el.contains(target))) draw();
  });
  draw();
}
