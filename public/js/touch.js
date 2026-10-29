import { enterFullscreen, exitFullscreen, fullscreen } from './pointertrap.js';

const ID = 7;
const SLOP = 10;
const HOLD = 450;
const TWICE = 350;
const TURN_START = 0.15;
const NOTCH = Math.log(1.12);

const touch = { used: false, capture: null, over: null, el: null };
export default touch;

const fingers = new Map();
let g = null;
let lastTap = { t: 0, x: 0, y: 0 },
  endedAt = 0;

const onCanvas = el => !!el && el.tagName === 'CANVAS';

function down(e) {
  seen();
  if (!g && !onCanvas(e.target)) return;
  own(e);
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!g) {
    g = { kind: 'wait', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, button: 0, timer: setTimeout(hold, HOLD) };
    moveTo(e.clientX, e.clientY, 0);
    return;
  }
  if (g.kind === 'two') {
    if (fingers.size >= 2) Object.assign(g, pair(...fingers.values()));
    return;
  }
  clearTimeout(g.timer);
  if (g.kind === 'drag' || g.kind === 'hold') release(g.x, g.y, g.button, false);
  g = { kind: 'two', ...pair(...fingers.values()), zoom: 0, turned: 0, turning: false };
}

function move(e) {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  own(e);
  f.x = e.clientX;
  f.y = e.clientY;
  if (g.kind === 'two') {
    if (fingers.size >= 2) two();
    return;
  }
  g.x = f.x;
  g.y = f.y;
  if (g.kind === 'wait') {
    if (Math.hypot(f.x - g.x0, f.y - g.y0) <= SLOP) return;
    clearTimeout(g.timer);
    g.kind = 'drag';
    g.button = 0;
    press(g.x0, g.y0, 0);
  }
  moveTo(f.x, f.y, g.button === 2 ? 2 : 1);
}

function up(e, cancelled) {
  if (!fingers.delete(e.pointerId)) return;
  own(e);
  if (g.kind === 'wait') {
    clearTimeout(g.timer);
    if (!cancelled) tap(g.x0, g.y0, 0);
  } else if (g.kind === 'drag' || g.kind === 'hold') release(g.x, g.y, g.button, !cancelled && g.kind === 'hold');
  if (fingers.size) {
    if (fingers.size >= 2) Object.assign(g, pair(...fingers.values()));
    return;
  }
  g = null;
  endedAt = performance.now();
  lift();
}

function own(e) {
  e.stopImmediatePropagation();
  if (e.cancelable) e.preventDefault();
}

function hold() {
  if (!g || g.kind !== 'wait') return;
  g.kind = 'hold';
  g.button = 2;
  ring(g.x, g.y);
  press(g.x, g.y, 2);
}

function pair(a, b) {
  return {
    mx: (a.x + b.x) / 2,
    my: (a.y + b.y) / 2,
    d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    a: Math.atan2(b.y - a.y, b.x - a.x)
  };
}

function two() {
  const [a, b] = fingers.values(),
    p = pair(a, b),
    game = window.game;
  const dx = p.mx - g.mx,
    dy = p.my - g.my;
  let turn = Math.atan2(Math.sin(p.a - g.a), Math.cos(p.a - g.a));
  if (!g.turning) {
    g.turned += turn;
    turn = 0;
    if (Math.abs(g.turned) > TURN_START) g.turning = true;
  }
  moveTo(p.mx, p.my, 0);
  if (game && !game.controlsLocked && game.touchView && (dx || dy || turn)) game.touchView(dx, dy, turn);
  const step = game?.touchZoomStep || NOTCH;
  g.zoom += Math.log(p.d / g.d);
  while (g.zoom >= step) {
    g.zoom -= step;
    wheel(p.mx, p.my, -100);
  }
  while (g.zoom <= -step) {
    g.zoom += step;
    wheel(p.mx, p.my, 100);
  }
  Object.assign(g, { mx: p.mx, my: p.my, d: p.d, a: p.a });
}

const BUTTONS = [1, 4, 2];

function tap(x, y, button) {
  const now = performance.now(),
    again = button === 0 && now - lastTap.t < TWICE && Math.hypot(x - lastTap.x, y - lastTap.y) < SLOP * 3;
  moveTo(x, y, 0);
  press(x, y, button, again ? 2 : 1);
  release(x, y, button, true, again ? 2 : 1);
  if (again) send('dblclick', x, y, 0, 0, 2);
  lastTap = again ? { t: 0, x, y } : { t: now, x, y };
}

function press(x, y, button, detail = 1) {
  send('pointerdown', x, y, button, BUTTONS[button], detail);
  send('mousedown', x, y, button, BUTTONS[button], detail);
}

function release(x, y, button, clicked, detail = 1) {
  send('pointerup', x, y, button, 0, detail);
  send('mouseup', x, y, button, 0, detail);
  if (touch.capture) {
    const c = touch.capture;
    touch.capture = null;
    if (c.isConnected) c.dispatchEvent(make('lostpointercapture', x, y, 0, 0));
  }
  if (clicked) send(button === 2 ? 'contextmenu' : button === 0 ? 'click' : 'auxclick', x, y, button, 0, detail);
}

function wheel(x, y, deltaY) {
  const to = document.elementFromPoint(x, y) || document.documentElement;
  to.dispatchEvent(new WheelEvent('wheel', { ...init(x, y, 0, 0), deltaY, deltaMode: 0 }));
}

function moveTo(x, y, buttons) {
  const to = document.elementFromPoint(x, y) || document.documentElement;
  if (to !== touch.over) {
    const from = touch.over;
    touch.over = to;
    leaveAll(from, to, x, y);
    enterAll(from, to, x, y);
  }
  send('pointermove', x, y, -1, buttons);
  send('mousemove', x, y, 0, buttons);
}

function lift() {
  if (touch.over) leaveAll(touch.over, null, -1, -1);
  touch.over = null;
}

const init = (x, y, button, buttons, detail = 0) => ({
  bubbles: true,
  cancelable: true,
  composed: true,
  view: window,
  clientX: x,
  clientY: y,
  screenX: x,
  screenY: y,
  button,
  buttons,
  detail,
  pointerId: ID,
  pointerType: 'mouse',
  isPrimary: true,
  width: 1,
  height: 1,
  pressure: buttons ? 0.5 : 0
});

function make(type, x, y, button, buttons, detail, related = null) {
  const o = { ...init(x, y, button, buttons, detail), relatedTarget: related };
  if (/enter|leave/.test(type)) o.bubbles = false;
  return type.startsWith('pointer') || type.endsWith('pointercapture') ? new PointerEvent(type, o) : new MouseEvent(type, o);
}

function send(type, x, y, button, buttons, detail = 0) {
  const c = touch.capture;
  const to =
    c && c.isConnected && type !== 'click' && type !== 'contextmenu' && type !== 'dblclick'
      ? c
      : document.elementFromPoint(x, y) || document.documentElement;
  to.dispatchEvent(make(type, x, y, button, buttons, detail));
}

const chain = el => {
  const a = [];
  for (let o = el; o; o = o.parentElement) a.push(o);
  return a;
};
function leaveAll(from, to, x, y) {
  if (!from || !from.isConnected) return;
  from.dispatchEvent(make('pointerout', x, y, 0, 0, 0, to));
  from.dispatchEvent(make('mouseout', x, y, 0, 0, 0, to));
  const keep = new Set(chain(to));
  for (const o of chain(from)) {
    if (keep.has(o)) break;
    o.dispatchEvent(make('pointerleave', x, y, 0, 0, 0, to));
    o.dispatchEvent(make('mouseleave', x, y, 0, 0, 0, to));
  }
}
function enterAll(from, to, x, y) {
  if (!to) return;
  to.dispatchEvent(make('pointerover', x, y, 0, 0, 0, from));
  to.dispatchEvent(make('mouseover', x, y, 0, 0, 0, from));
  const had = new Set(chain(from && from.isConnected ? from : null));
  for (const o of chain(to).reverse()) {
    if (had.has(o)) continue;
    o.dispatchEvent(make('pointerenter', x, y, 0, 0, 0, from));
    o.dispatchEvent(make('mouseenter', x, y, 0, 0, 0, from));
  }
}

function ring(x, y) {
  const r = document.createElement('div');
  r.className = 'touch-ring';
  r.style.transform = `translate(${x}px, ${y}px)`;
  document.body.appendChild(r);
  setTimeout(() => r.remove(), 400);
}

const ICON = {
  full: '<path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"/>',
  window: '<path d="M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6"/>'
};
const svg = k =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

const CSS = `
canvas { touch-action: none; }
html { -webkit-tap-highlight-color: transparent; }
.touch-full { position: fixed; left: max(6px, env(safe-area-inset-left)); top: max(6px, env(safe-area-inset-top)); z-index: 2147483000; touch-action: none;
  width: 38px; height: 38px; padding: 0; border-radius: 50%; border: 1px solid rgba(160, 200, 235, .45); background: rgba(8, 14, 22, .55);
  color: #cfe3f5; display: grid; place-items: center; opacity: .75; cursor: pointer; }
.touch-full[hidden] { display: none; }
.touch-ring { position: fixed; left: -28px; top: -28px; width: 56px; height: 56px; border-radius: 50%; border: 3px solid #ffb347; pointer-events: none;
  z-index: 2147483001; animation: touch-ring .4s ease-out forwards; }
@keyframes touch-ring { from { scale: .4; opacity: 1; } to { scale: 1.2; opacity: 0; } }
.touch-hint { position: fixed; left: calc(max(6px, env(safe-area-inset-left)) + 46px); top: max(6px, env(safe-area-inset-top)); z-index: 2147483000; max-width: min(320px, 70vw);
  padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(160, 200, 235, .45); background: rgba(8, 14, 22, .9); color: #cfe3f5;
  font: 13px/1.45 system-ui, -apple-system, sans-serif; }
.touch-hint[hidden] { display: none; }
.touch-hint b { color: #fff; }
`;

function seen() {
  if (touch.el) touch.el.hidden = false;
  if (touch.used) return;
  touch.used = true;
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
    homeScreen();
    return;
  }
  const b = (touch.el = document.createElement('button'));
  b.type = 'button';
  b.className = 'touch-full';
  b.dataset.page = '';
  const shown = () => {
    const on = fullscreen();
    b.innerHTML = svg(on ? 'window' : 'full');
    b.title = on ? 'Leave fullscreen' : 'Fullscreen';
    b.setAttribute('aria-label', b.title);
  };
  shown();
  b.addEventListener('click', e => {
    e.stopPropagation();
    if (fullscreen()) exitFullscreen();
    else {
      enterFullscreen();
      landscape();
    }
  });
  document.addEventListener('fullscreenchange', shown);
  document.addEventListener('webkitfullscreenchange', shown);
  document.body.appendChild(b);
}

function homeScreen() {
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const app = navigator.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  if (!apple || app) return;
  const b = (touch.el = document.createElement('button')),
    hint = document.createElement('div');
  b.type = 'button';
  b.className = 'touch-full';
  b.innerHTML = svg('full');
  b.title = 'Fullscreen: add to Home Screen';
  b.setAttribute('aria-label', b.title);
  b.dataset.page = hint.dataset.page = '';
  hint.className = 'touch-hint';
  hint.hidden = true;
  hint.setAttribute('role', 'status');
  hint.innerHTML =
    'For fullscreen, add the game to your Home Screen: open the browser <b>Share</b> menu, choose <b>Add to Home Screen</b>, then start the game from its icon there.';
  b.addEventListener('click', e => {
    e.stopPropagation();
    hint.hidden = !hint.hidden;
  });
  hint.addEventListener('click', e => {
    e.stopPropagation();
    hint.hidden = true;
  });
  new MutationObserver(() => {
    if (b.hidden) hint.hidden = true;
  }).observe(b, { attributes: true, attributeFilter: ['hidden'] });
  document.body.append(b, hint);
}

function landscape() {
  const go = () => {
    try {
      const p = screen.orientation?.lock?.('landscape');
      if (p && p.catch) p.catch(() => {});
    } catch {}
  };
  if (fullscreen()) go();
  else document.addEventListener('fullscreenchange', go, { once: true });
}

touch.test = {};
for (const [name, fn] of [
  ['down', down],
  ['move', move],
  ['up', e => up(e, false)],
  ['cancel', e => up(e, true)]
])
  touch.test[name] = (id, x, y) =>
    fn({
      pointerId: id,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      target: document.elementFromPoint(x, y),
      cancelable: false,
      stopImmediatePropagation() {},
      preventDefault() {}
    });

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const real = fn => e => {
    if (e.isTrusted && e.pointerType === 'touch') fn(e);
  };
  addEventListener('pointerdown', real(down), { capture: true, passive: false });
  const mouse = e => {
    if (e.isTrusted && e.pointerType === 'mouse' && touch.el && !touch.el.hidden) touch.el.hidden = true;
  };
  addEventListener('pointerdown', mouse, { capture: true, passive: true });
  addEventListener('pointermove', mouse, { capture: true, passive: true });
  addEventListener('pointermove', real(move), { capture: true, passive: false });
  addEventListener(
    'pointerup',
    real(e => up(e, false)),
    { capture: true, passive: false }
  );
  addEventListener(
    'pointercancel',
    real(e => up(e, true)),
    { capture: true, passive: false }
  );
  const quiet = e => {
    if (g || onCanvas(e.target) || performance.now() - endedAt < 60) {
      if (e.cancelable) e.preventDefault();
    }
  };
  for (const type of ['touchstart', 'touchmove', 'touchend']) addEventListener(type, quiet, { capture: true, passive: false });
  if (matchMedia('(pointer: coarse)').matches) {
    if (document.body) seen();
    else addEventListener('DOMContentLoaded', seen, { once: true });
  }

  const P = Element.prototype,
    set = P.setPointerCapture,
    rel = P.releasePointerCapture,
    has = P.hasPointerCapture;
  P.setPointerCapture = function (id) {
    if (id !== ID) return set.call(this, id);
    if (touch.capture !== this) {
      touch.capture = this;
      this.dispatchEvent(make('gotpointercapture', 0, 0, 0, 0));
    }
  };
  P.releasePointerCapture = function (id) {
    if (id !== ID) return rel.call(this, id);
    if (touch.capture === this) touch.capture = null;
  };
  P.hasPointerCapture = function (id) {
    return id === ID ? touch.capture === this : has.call(this, id);
  };
}
