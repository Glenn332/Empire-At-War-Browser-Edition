import { inApp } from './platform.js';
import { fullscreen } from './pointertrap.js';
import { gfx, storeGfx } from './gfx.js';

const SIZES = [
  [1280, 720],
  [1366, 768],
  [1600, 900],
  [1920, 1080],
  [2560, 1080],
  [2560, 1440],
  [3440, 1440],
  [3840, 2160],
  [5120, 1440],
  [5120, 2880]
];

export async function windowSize(w = 0, h = 0) {
  if (!inApp()) return null;
  try {
    const r = await fetch(`api/window-size?w=${w | 0}&h=${h | 0}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function windowSizes() {
  const now = await windowSize();
  if (!now || !now.w) return null;
  const mw = now.fw || now.mw || screen.availWidth * devicePixelRatio,
    mh = now.fh || now.mh || screen.availHeight * devicePixelRatio;
  const list = SIZES.filter(([w, h]) => w <= mw && h <= mh);
  if (!list.some(([w, h]) => w === mw && h === mh)) list.push([mw, mh]);
  if (!list.some(([w, h]) => w === now.w && h === now.h)) list.push([now.w, now.h]);
  return { now: [now.w, now.h], list: list.sort((a, b) => a[0] * a[1] - b[0] * b[1] || a[0] - b[0]) };
}

export function pickWindowSize(w, h) {
  gfx.window = [w, h];
  gfx.scale = 1;
  storeGfx();
  return windowSize(w, h);
}

export async function restoreWindowSize() {
  const s = gfx.window;
  if (!inApp() || !Array.isArray(s) || !(s[0] >= 640 && s[1] >= 480) || fullscreen()) return;
  try {
    if (sessionStorage.getItem('swr-window-set')) return;
    sessionStorage.setItem('swr-window-set', '1');
  } catch {}
  const now = await windowSize();
  if (now && (now.w !== s[0] || now.h !== s[1])) windowSize(s[0], s[1]);
}
