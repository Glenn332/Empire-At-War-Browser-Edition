import { db } from '../gamedata.js';

const STORE = 'swr-keys';
export const MAX_KEYS = 3;

export const ACTIONS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(n => ({
    id: 'GROUP_' + n,
    page: 0,
    edit: `IDC_EDIT_GROUP_${n}_SELECT`,
    label: `TEXT_GROUP_${n}_SELECT`,
    keys: ['Digit' + n]
  })),
  { id: 'GUARD', page: 0, edit: 'IDC_EDIT_GUARD', label: 'TEXT_GUARD', keys: ['KeyG'] },
  { id: 'ATTACK', page: 0, edit: 'IDC_EDIT_ATTACK', label: 'TEXT_ATTACK', keys: ['KeyT'] },
  { id: 'STOP', page: 0, edit: 'IDC_EDIT_STOP', label: 'TEXT_STOP', keys: ['KeyX'] },
  { id: 'MOVE', page: 0, edit: 'IDC_EDIT_MOVE', label: 'TEXT_MOVE', keys: ['KeyM'] },
  { id: 'ATTACK_MOVE', page: 0, edit: 'IDC_EDIT_ATTACK_MOVE', label: 'TEXT_TOOLTIP_ATTACK_MOVE', keys: ['KeyF'] },
  { id: 'WAYPOINT', page: 0, edit: 'IDC_EDIT_WAYPOINT', label: 'TEXT_WAYPOINT', keys: [] },
  { id: 'SUPER_WEAPON', page: 0, edit: 'IDC_EDIT_SUPER_WEAPON', label: 'TEXT_SUPER_WEAPON', keys: [] },
  { id: 'SCROLL_UP', page: 3, edit: 'IDC_EDIT_SCROLL_UP', label: 'TEXT_SCROLL_UP', keys: ['KeyW', 'ArrowUp'] },
  { id: 'SCROLL_DOWN', page: 3, edit: 'IDC_EDIT_SCROLL_DOWN', label: 'TEXT_SCROLL_DOWN', keys: ['KeyS', 'ArrowDown'] },
  { id: 'SCROLL_LEFT', page: 3, edit: 'IDC_EDIT_SCROLL_LEFT', label: 'TEXT_SCROLL_LEFT', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'SCROLL_RIGHT', page: 3, edit: 'IDC_EDIT_SCROLL_RIGHT', label: 'TEXT_SCROLL_RIGHT', keys: ['KeyD', 'ArrowRight'] },
  { id: 'CAMERA_HOME', page: 3, edit: 'IDC_EDIT_CAMERA_HOME', label: 'TEXT_CAMERA_HOME', keys: ['Space'] },
  { id: 'TACTICAL_OVERVIEW', page: 3, edit: 'IDC_EDIT_TACTICAL_OVERVIEW', label: 'TEXT_TACTICAL_OVERVIEW', keys: ['Backspace'] },
  { id: 'BATTLE_CAM', page: 3, edit: 'IDC_EDIT_BATTLE_CAM', label: 'TEXT_MOVIE_MODE', keys: ['KeyC'] },
  { id: 'INITIATE_CHAT', page: 3, edit: 'IDC_EDIT_INITIATE_CHAT', label: 'TEXT_INITIATE_CHAT', keys: ['Enter', 'NumpadEnter'] },
  { id: 'PAUSE', page: 5, extra: { col: 0, y: 65 }, label: 'Pause', keys: ['KeyP', 'Pause'] },
  { id: 'SPEED_UP', page: 5, extra: { col: 0, y: 90 }, label: 'Increase Game Speed', keys: ['Equal', 'NumpadAdd'] },
  { id: 'SPEED_DOWN', page: 5, extra: { col: 0, y: 115 }, label: 'Decrease Game Speed', keys: ['Minus', 'NumpadSubtract'] },
  ...[1, 2, 3, 4, 5].map(n => ({
    id: 'ABILITY_' + n,
    page: 5,
    extra: { col: 0, y: 115 + 25 * n },
    label: 'Use Ability ' + n,
    keys: n === 1 ? ['KeyR'] : []
  })),
  { id: 'ROTATE_LEFT', page: 5, extra: { col: 1, y: 65 }, label: 'Rotate Camera Left', keys: ['KeyQ'] },
  { id: 'ROTATE_RIGHT', page: 5, extra: { col: 1, y: 90 }, label: 'Rotate Camera Right', keys: ['KeyE'] },
  { id: 'TILT_UP', page: 5, extra: { col: 1, y: 115 }, label: 'Tilt Camera Up', keys: ['Home'] },
  { id: 'TILT_DOWN', page: 5, extra: { col: 1, y: 140 }, label: 'Tilt Camera Down', keys: ['End'] },
  { id: 'DIRECT_CONTROL', page: 5, extra: { col: 1, y: 165 }, label: 'Direct Control', keys: ['KeyV'] },
  { id: 'TOGGLE_HUD', page: 5, extra: { col: 1, y: 190 }, label: 'Hide / Show HUD', keys: ['KeyH'] },
  { id: 'DIRECT_VIEW', page: 5, extra: { col: 1, y: 215 }, label: 'Direct Control View', keys: ['KeyB'] },
  { id: 'SQUAD_CAM', page: 5, extra: { col: 1, y: 240 }, label: 'Follow Whole Squad', keys: ['Alt+KeyC'] }
];
const byId = new Map(ACTIONS.map(a => [a.id, a]));

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (!v || typeof v !== 'object') return {};
    if (v.ABILITY && !v.ABILITY_1) v.ABILITY_1 = v.ABILITY;
    delete v.ABILITY;
    return v;
  } catch {
    return {};
  }
}
let custom = load();
const listeners = new Set();

export function keysOf(id) {
  return custom[id] || byId.get(id)?.keys || [];
}

export function bindings() {
  return Object.fromEntries(ACTIONS.map(a => [a.id, keysOf(a.id).slice()]));
}
export function defaultBindings() {
  return Object.fromEntries(ACTIONS.map(a => [a.id, a.keys.slice()]));
}

export function setBindings(map) {
  custom = {};
  for (const a of ACTIONS) {
    const k = map[a.id] || a.keys;
    if (k.join() !== a.keys.join()) custom[a.id] = k.slice();
  }
  try {
    if (Object.keys(custom).length) localStorage.setItem(STORE, JSON.stringify(custom));
    else localStorage.removeItem(STORE);
  } catch {}
  for (const fn of listeners) fn();
}
export function onBindingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const MODS = [
  ['Ctrl', 'ctrlKey', /^Control(Left|Right)$/],
  ['Shift', 'shiftKey', /^Shift(Left|Right)$/],
  ['Alt', 'altKey', /^Alt(Left|Right)$/]
];
const MOD_NAMES = new Set(MODS.map(([m]) => m));
export function modifierOf(code) {
  if (/^(Meta|OS)(Left|Right)?$/.test(code)) return null;
  return MODS.find(([, , re]) => re.test(code))?.[0] || '';
}
const split = k => {
  const p = k.split('+');
  return [p.filter(x => MOD_NAMES.has(x)), p.filter(x => !MOD_NAMES.has(x))];
};

export function comboFrom(mods, codes) {
  return [...MODS.map(([m]) => m).filter(m => mods.includes(m)), ...codes].join('+');
}

export function sameCombo(a, b) {
  const x = a.split('+'),
    y = b.split('+');
  return x.length === y.length && x.every(k => y.includes(k));
}

const down = new Set();
if (globalThis.addEventListener) {
  addEventListener('keydown', e => down.add(e.code), true);
  addEventListener('keyup', e => down.delete(e.code), true);
  addEventListener('blur', () => down.clear());
}

export function pressed(e, id) {
  if (e.metaKey) return false;
  for (const k of keysOf(id)) {
    const [mods, codes] = split(k);
    if (!codes.includes(e.code) || !codes.every(c => c === e.code || down.has(c))) continue;
    if (mods.length ? MODS.every(([m, prop]) => !!e[prop] === mods.includes(m)) : !e.ctrlKey && !e.altKey) return true;
  }
  return false;
}

export function held(keys, id) {
  for (const k of keysOf(id)) {
    const codes = split(k)[1];
    if (codes.length && codes.every(c => keys.has(c))) return true;
  }
  return false;
}

export function groupKey(e) {
  for (let n = 0; n <= 9; n++) {
    if (pressed(e, 'GROUP_' + n)) return { n, assign: false };
    if (e.ctrlKey && !e.altKey && keysOf('GROUP_' + n).some(k => k === e.code)) return { n, assign: true };
  }
  return null;
}

const NAMES = {
  ArrowLeft: 'TEXT_KEY_LEFT_ARROW',
  ArrowRight: 'TEXT_KEY_RIGHT_ARROW',
  ArrowUp: 'TEXT_KEY_UP_ARROW',
  ArrowDown: 'TEXT_KEY_DOWN_ARROW',
  Home: 'TEXT_KEY_HOME',
  End: 'TEXT_KEY_END',
  Tab: 'TEXT_KEY_TAB',
  Backspace: 'TEXT_KEY_BACKSPACE',
  Delete: 'TEXT_KEY_DELETE',
  PageUp: 'TEXT_KEY_PAGE_UP',
  PageDown: 'TEXT_KEY_PAGE_DOWN',
  Enter: 'TEXT_KEY_ENTER',
  NumpadEnter: 'TEXT_KEY_ENTER',
  Space: 'TEXT_KEY_SPACE',
  NumpadMultiply: 'TEXT_KEY_MULTIPLY',
  NumpadAdd: 'TEXT_KEY_ADD',
  NumpadSubtract: 'TEXT_KEY_SUBTRACT',
  NumpadDecimal: 'TEXT_KEY_DECIMAL',
  NumpadDivide: 'TEXT_KEY_DIVIDE',
  NumpadComma: 'TEXT_KEY_SEPERATOR',
  NumLock: 'TEXT_KEY_NUMLOCK',
  ScrollLock: 'TEXT_KEY_SCROLL',
  Insert: 'TEXT_KEY_INSERT',
  CapsLock: 'TEXT_KEY_CAPITAL',
  Escape: 'TEXT_KEY_ESCAPE'
};
const FALLBACK = {
  ArrowLeft: 'Left Arrow',
  ArrowRight: 'Right Arrow',
  ArrowUp: 'Up Arrow',
  ArrowDown: 'Down Arrow',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  NumpadEnter: 'Enter',
  NumpadMultiply: 'Num *',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadDecimal: 'Num .',
  NumpadDivide: 'Num /',
  CapsLock: 'Caps Lock',
  ScrollLock: 'Scroll Lock',
  NumLock: 'Num Lock',
  Escape: 'Esc',
  Pause: 'Pause',
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  IntlBackslash: '\\'
};
function codeName(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code)) || (m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return db.t('TEXT_KEY_NUMPAD_' + m[1]) || 'Num ' + m[1];
  if ((m = /^F(\d+)$/.exec(code)) && +m[1] <= 24) return db.t('TEXT_KEY_F' + m[1]) || code;
  return (NAMES[code] && db.t(NAMES[code])) || FALLBACK[code] || code;
}

export function keyName(k) {
  if (!k) return db.t('TEXT_KEY_UNDEFINED') || 'Not Set!';
  const [mods, codes] = split(k);
  return mods.map(m => db.t(`TEXT_KEY_${m.toUpperCase()}_MODIFIER`) || m + ' + ').join('') + codes.map(codeName).join(' + ');
}

export function actionName(id) {
  const a = byId.get(id);
  return a ? (/^TEXT_/.test(a.label) ? db.t(a.label) || a.label : a.label) : id;
}

export function keyNames(keys) {
  return keys.length ? keys.map(keyName).join(', ') : keyName(null);
}

export function withKey(text, id) {
  const k = keysOf(id);
  return k.length ? `${text} [${k.map(keyName).join(' / ')}]` : text;
}

let bothRotate = null;
export function bothButtonsRotate() {
  if (bothRotate === null) {
    try {
      bothRotate = localStorage.getItem('swr-both-rotate') === '1';
    } catch {
      bothRotate = false;
    }
  }
  return bothRotate;
}
export function setBothButtonsRotate(on) {
  bothRotate = !!on;
  try {
    localStorage.setItem('swr-both-rotate', on ? '1' : '0');
  } catch {}
}
