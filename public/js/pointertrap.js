const VIRTUAL = 1;
const MOUSE_TYPES = [
  'pointermove',
  'mousemove',
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'auxclick',
  'wheel',
  'pointerover',
  'pointerout',
  'pointerenter',
  'pointerleave',
  'mouseover',
  'mouseout',
  'mouseenter',
  'mouseleave',
  'pointercancel'
];
const NATIVE = 'select, input[type=file], input[type=color], input[type=date], input[type=time], input[type=range]';
const TEXT =
  'input:not([type]), input[type=text], input[type=search], input[type=password], input[type=number], input[type=email], input[type=url], textarea, [contenteditable=""], [contenteditable=true]';

const trap = {
  locked: false,
  x: (globalThis.innerWidth || 0) / 2,
  y: (globalThis.innerHeight || 0) / 2,
  over: null,
  capture: null,
  buttons: 0,
  cursorEl: null,
  look: null,
  cursorFor: null
};
export default trap;

export const fullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const ownFullscreen = () => (document.fullscreenElement || document.webkitFullscreenElement) === document.documentElement;

function toggleFullscreen() {
  try {
    if (fullscreen()) exitFullscreen();
    else enterFullscreen();
  } catch {}
}

export function exitFullscreen() {
  try {
    const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.();
    if (p && p.catch) p.catch(() => {});
  } catch {}
}

export function enterFullscreen() {
  keepEscape();
  const el = document.documentElement,
    p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
  if (p && p.catch) p.catch(e => console.warn('fullscreen:', e.message));
}

function keepEscape() {
  trap.keyboard = 'unsupported';
  if (!navigator.keyboard || !navigator.keyboard.lock) return;
  trap.keyboard = 'asked';
  navigator.keyboard.lock(['Escape']).then(
    () => {
      trap.keyboard = 'locked';
    },
    e => {
      trap.keyboard = e.name + ': ' + e.message;
      console.warn('Escape not kept (Keyboard Lock):', e.message);
    }
  );
}

function lock() {
  if (trap.locked || !ownFullscreen() || document.pointerLockElement) return;
  try {
    const p = document.documentElement.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch {}
}

function locked(now) {
  if (now === trap.locked) return;
  trap.locked = now;
  if (now) {
    hoverRules();
    showCursor(true);
    move(trap.x, trap.y, 0, 0, null);
    requestAnimationFrame(redraw);
  } else {
    showCursor(false);
    if (trap.over) leaveAll(trap.over, null, null);
    trap.over = null;
    trap.capture = null;
    trap.buttons = 0;
    setHover(null);
  }
}

trap.test = {
  lock: on => locked(!!on),
  event: (type, props = {}) =>
    handle({
      type,
      button: 0,
      buttons: 0,
      movementX: 0,
      movementY: 0,
      detail: 1,
      deltaX: 0,
      deltaY: 0,
      deltaZ: 0,
      deltaMode: 0,
      cancelable: false,
      stopImmediatePropagation() {},
      preventDefault() {},
      target: document.documentElement,
      ...props
    })
};

function real(e) {
  if (e.isTrusted && e.pointerType !== 'touch') handle(e);
}

function handle(e) {
  if (!trap.locked) {
    if (e.type === 'pointermove' || e.type === 'pointerdown') {
      trap.x = e.clientX;
      trap.y = e.clientY;
    }
    if (e.type === 'pointerdown' && ownFullscreen() && !e.target.closest?.(NATIVE)) lock();
    return;
  }
  e.stopImmediatePropagation();
  if (e.cancelable && e.type !== 'pointermove' && e.type !== 'mousemove') e.preventDefault();
  switch (e.type) {
    case 'pointermove':
      move(trap.x + e.movementX, trap.y + e.movementY, e.movementX, e.movementY, e);
      return;
    case 'mousemove':
      send('mousemove', e, { mx: e.movementX, my: e.movementY });
      return;
    case 'pointerdown':
      trap.buttons = e.buttons;
      send('pointerdown', e);
      return;
    case 'mousedown':
      send('mousedown', e);
      focusAt(e);
      return;
    case 'pointerup':
      trap.buttons = e.buttons;
      send('pointerup', e);
      if (trap.capture && !e.buttons) release();
      return;
    case 'mouseup':
    case 'click':
    case 'dblclick':
    case 'contextmenu':
    case 'auxclick':
      send(e.type, e);
      return;
    case 'wheel':
      send('wheel', e);
      return;
    default:
      return;
  }
}

function under() {
  const el = document.elementFromPoint(trap.x, trap.y);
  return el || document.documentElement;
}

function init(e, extra = {}) {
  const x = trap.x,
    y = trap.y;
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + (screenX || 0),
    screenY: y + (screenY || 0),
    movementX: extra.mx ?? 0,
    movementY: extra.my ?? 0,
    button: e ? e.button : 0,
    buttons: e ? e.buttons : trap.buttons,
    ctrlKey: !!e?.ctrlKey,
    shiftKey: !!e?.shiftKey,
    altKey: !!e?.altKey,
    metaKey: !!e?.metaKey,
    pointerId: VIRTUAL,
    pointerType: 'mouse',
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: (e ? e.buttons : trap.buttons) ? 0.5 : 0,
    detail: e ? e.detail : 0,
    relatedTarget: extra.related ?? null
  };
}

function make(type, e, extra) {
  const o = init(e, extra);
  if (type === 'wheel') return new WheelEvent(type, { ...o, deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode });
  if (type.startsWith('pointer') || type === 'gotpointercapture' || type === 'lostpointercapture') return new PointerEvent(type, o);
  if (type === 'mouseenter' || type === 'mouseleave' || type === 'pointerenter' || type === 'pointerleave')
    return type.startsWith('pointer') ? new PointerEvent(type, { ...o, bubbles: false }) : new MouseEvent(type, { ...o, bubbles: false });
  return new MouseEvent(type, o);
}

function send(type, e, extra) {
  const to = type.startsWith('pointer') && trap.capture && trap.capture.isConnected ? trap.capture : under();
  const ev = make(type, e, extra);
  to.dispatchEvent(ev);
  if (type === 'click' && !ev.defaultPrevented) {
    const a = to.closest?.('a[href]');
    if (a && !a.closest('[draggable=true]')) a.click?.();
  }
  if (type === 'wheel' && !ev.defaultPrevented) scrollFrom(to, e);
}

function scrollFrom(el, e) {
  const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? null : 1;
  for (let o = el; o && o.nodeType === 1; o = o.parentElement) {
    const st = getComputedStyle(o),
      y = /(auto|scroll)/.test(st.overflowY),
      x = /(auto|scroll)/.test(st.overflowX);
    if (!x && !y) continue;
    const dy = y ? e.deltaY * (unit ?? o.clientHeight) : 0,
      dx = x ? e.deltaX * (unit ?? o.clientWidth) : 0;
    const canY = dy < 0 ? o.scrollTop > 0 : dy > 0 && o.scrollTop + o.clientHeight < o.scrollHeight - 1;
    const canX = dx < 0 ? o.scrollLeft > 0 : dx > 0 && o.scrollLeft + o.clientWidth < o.scrollWidth - 1;
    if (canY || canX) {
      o.scrollBy({ top: canY ? dy : 0, left: canX ? dx : 0 });
      return;
    }
  }
}

function move(x, y, mx, my, e) {
  trap.x = Math.max(0, Math.min(innerWidth - 1, x));
  trap.y = Math.max(0, Math.min(innerHeight - 1, y));
  const to = document.elementFromPoint(trap.x, trap.y) || document.documentElement;
  if (to.tagName === 'IFRAME') {
    document.exitPointerLock();
    return;
  }
  if (to !== trap.over) {
    const from = trap.over;
    trap.over = to;
    leaveAll(from, to, e);
    enterAll(from, to, e);
    setHover(to);
  }
  drawCursor(to);
  if (e) send('pointermove', e, { mx, my });
}

const chain = el => {
  const a = [];
  for (let o = el; o; o = o.parentElement) a.push(o);
  return a;
};
function leaveAll(from, to, e) {
  if (!from || !from.isConnected) return;
  from.dispatchEvent(make('pointerout', e, { related: to }));
  from.dispatchEvent(make('mouseout', e, { related: to }));
  const keep = new Set(chain(to));
  for (const o of chain(from)) {
    if (keep.has(o)) break;
    o.dispatchEvent(make('pointerleave', e, { related: to }));
    o.dispatchEvent(make('mouseleave', e, { related: to }));
  }
}
function enterAll(from, to, e) {
  if (!to) return;
  to.dispatchEvent(make('pointerover', e, { related: from }));
  to.dispatchEvent(make('mouseover', e, { related: from }));
  const had = new Set(chain(from && from.isConnected ? from : null));
  for (const o of chain(to).reverse()) {
    if (had.has(o)) continue;
    o.dispatchEvent(make('pointerenter', e, { related: from }));
    o.dispatchEvent(make('mouseenter', e, { related: from }));
  }
}

function focusAt(e) {
  const el = under();
  if (el.closest?.(NATIVE)) {
    document.exitPointerLock();
    return;
  }
  const t = el.closest?.(TEXT);
  if (t) t.focus({ preventScroll: true });
  else if (document.activeElement && document.activeElement !== document.body && document.activeElement.matches?.(TEXT))
    document.activeElement.blur();
}

function release() {
  const c = trap.capture;
  trap.capture = null;
  if (c && c.isConnected) c.dispatchEvent(make('lostpointercapture', null));
}

let rulesSeen = 0;
function hoverRules() {
  const sheets = [...document.styleSheets];
  if (sheets.length === rulesSeen) return;
  rulesSeen = sheets.length;
  for (const s of sheets) {
    let rules;
    try {
      rules = s.cssRules;
    } catch {
      continue;
    }
    if (!rules || s.ownerNode?.dataset?.pointertrap) continue;
    const add = [];
    for (const r of rules)
      if (r.selectorText && r.selectorText.includes(':hover'))
        add.push(r.selectorText.replace(/:hover/g, '.ptrap-hover') + '{' + r.style.cssText + '}');
    if (!add.length) continue;
    const st = document.createElement('style');
    st.dataset.pointertrap = '1';
    st.textContent = add.join('\n');
    document.head.appendChild(st);
  }
}
let hovered = [];
function setHover(el) {
  for (const o of hovered) o.classList.remove('ptrap-hover');
  hovered = el ? chain(el).filter(o => o !== document.documentElement && o !== document.body) : [];
  for (const o of hovered) o.classList.add('ptrap-hover');
}

function showCursor(on) {
  if (on && !trap.cursorEl) {
    const img = (trap.cursorEl = document.createElement('img'));
    img.alt = '';
    img.draggable = false;
    Object.assign(img.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      pointerEvents: 'none',
      zIndex: 2147483647,
      imageRendering: 'pixelated',
      display: 'none'
    });
    document.documentElement.appendChild(img);
  }
  if (trap.cursorEl) trap.cursorEl.style.display = on ? '' : 'none';
}

function redraw() {
  if (!trap.locked) return;
  drawCursor(trap.over);
  requestAnimationFrame(redraw);
}

function drawCursor(over) {
  const img = trap.cursorEl;
  if (!img) return;
  const c = (trap.cursorFor || cssCursor)(over);
  if (!c) {
    img.style.visibility = 'hidden';
    return;
  }
  img.style.visibility = '';
  if (img.dataset.src !== c.url) {
    img.dataset.src = c.url;
    img.src = c.url;
  }
  img.style.transform = `translate(${Math.round(trap.x - c.x)}px, ${Math.round(trap.y - c.y)}px)`;
}

const svg = s =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${s}</svg>`);
const KEYWORD = {
  default: {
    url: svg('<path d="M1 1 L1 19 L6 14 L10 22 L13 21 L9 13 L16 13 Z" fill="#fff" stroke="#000" stroke-width="1.2"/>'),
    x: 1,
    y: 1
  },
  pointer: {
    url: svg(
      '<path d="M9 2 C10.5 2 11 3 11 4 L11 11 L18 12 C20 12.5 20.5 14 20 16 L18 24 L9 24 L4 16 C3 14.5 4.5 13 6 14 L7 15 L7 4 C7 3 7.5 2 9 2 Z" fill="#fff" stroke="#000" stroke-width="1.2"/>'
    ),
    x: 9,
    y: 2
  },
  crosshair: {
    url: svg(
      '<path d="M16 3 V29 M3 16 H29" stroke="#000" stroke-width="3"/><path d="M16 3 V29 M3 16 H29" stroke="#fff" stroke-width="1"/>'
    ),
    x: 16,
    y: 16
  },
  text: {
    url: svg(
      '<path d="M12 4 H20 M16 4 V28 M12 28 H20" stroke="#000" stroke-width="3"/><path d="M12 4 H20 M16 4 V28 M12 28 H20" stroke="#fff" stroke-width="1"/>'
    ),
    x: 16,
    y: 16
  },
  grab: {
    url: svg(
      '<path d="M8 12 C8 9 12 9 12 12 L12 10 C12 7 16 7 16 10 L16 11 C16 8 20 8 20 11 L20 13 C20 10 24 10 24 13 L24 21 C24 26 20 29 16 29 C12 29 8 26 8 21 Z" fill="#fff" stroke="#000" stroke-width="1.2"/>'
    ),
    x: 16,
    y: 16
  }
};
function cssCursor(el) {
  const v = el ? getComputedStyle(el).cursor : 'default';
  if (v === 'none') return null;
  const m = /url\("?([^")]+)"?\)\s*(\d+)?\s*(\d+)?/.exec(v);
  if (m) return { url: m[1], x: +(m[2] || 0), y: +(m[3] || 0) };
  let k = v.split(',').pop().trim();
  if (k === 'auto')
    k =
      el &&
      (el.isContentEditable ||
        el.matches(
          'textarea, input:not([type]), input[type=text], input[type=search], input[type=number], input[type=password], input[type=email]'
        ))
        ? 'text'
        : 'default';
  return KEYWORD[k] || (k === 'grabbing' ? KEYWORD.grab : k === 'move' || k === 'all-scroll' ? KEYWORD.grab : KEYWORD.default);
}

if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    if (fullscreen()) {
      if (trap.keyboard !== 'locked' && trap.keyboard !== 'asked') keepEscape();
      lock();
    } else {
      try {
        navigator.keyboard?.unlock?.();
      } catch {}
      trap.keyboard = null;
      if (document.pointerLockElement) document.exitPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => locked(document.pointerLockElement === document.documentElement));

  addEventListener(
    'keydown',
    e => {
      if (e.altKey && e.code === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleFullscreen();
      }
    },
    true
  );
  addEventListener('blur', () => {
    if (document.pointerLockElement) document.exitPointerLock();
  });

  for (const type of MOUSE_TYPES) addEventListener(type, real, { capture: true, passive: false });

  const P = Element.prototype,
    nativeSet = P.setPointerCapture,
    nativeRelease = P.releasePointerCapture,
    nativeHas = P.hasPointerCapture;
  P.setPointerCapture = function (id) {
    if (!(trap.locked && id === VIRTUAL)) return nativeSet.call(this, id);
    if (trap.capture === this) return;
    if (trap.capture) release();
    trap.capture = this;
    this.dispatchEvent(make('gotpointercapture', null));
  };
  P.releasePointerCapture = function (id) {
    if (!(trap.locked && id === VIRTUAL)) return nativeRelease.call(this, id);
    if (trap.capture === this) release();
  };
  P.hasPointerCapture = function (id) {
    return trap.locked && id === VIRTUAL ? trap.capture === this : nativeHas.call(this, id);
  };
}
