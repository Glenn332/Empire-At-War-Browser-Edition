import { fetchText } from './vfs.js';
import { parseXML } from './xml.js';
import { env } from './gpu/env.js';

const KEY = 'swr-gfx';
const OWN = {
  shadows: true,
  bloom: true,
  heat: true,
  flare: true,
  soft: true,
  scale: 1,
  aa: true,
  supersample: 1,
  particle: 1,
  mesh: 1,
  texMip: 0,
  shader: 3,
  shadow: 2,
  shadowRange: 8,
  gamma: 0.5,
  level: -1,
  // frames per second the galaxy map and battles draw at most; 0 draws at the screen's own refresh rate
  fpsCap: 0
};

function read() {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (kept) return kept;
    const old = localStorage.getItem('swr-shadows');
    return old === null ? {} : { shadows: old === '1' };
  } catch {
    return {};
  }
}

export const gfx = Object.assign({}, OWN, read());
export const gfxDefaults = OWN;
env.soft = gfx.soft !== false;

export function storeGfx() {
  try {
    localStorage.setItem(KEY, JSON.stringify(gfx));
  } catch {}
  env.soft = gfx.soft !== false;
  applyGamma();
}

export function shadowSize() {
  return [512, 1024, 2048, 4096][Math.max(0, Math.min(3, gfx.shadow | 0))];
}

export const SHADOW_RANGE_MAX = 8;
export function shadowReach() {
  return Math.max(1, Math.min(SHADOW_RANGE_MAX, +gfx.shadowRange || OWN.shadowRange));
}

export function frameCap() {
  const cap = +gfx.fpsCap;
  return Number.isFinite(cap) && cap > 0 ? Math.max(15, cap) : 0;
}

// The 3D battle behind the main menu is only a backdrop: it draws at most this many frames a second.
export const MENU_FPS = 30;
export const MENU_MOVIE_FPS = 15;
export const MENU_SUBPAGE_FPS = 15;
export function menuFrameCap(moviePlaying = false, subpage = false) {
  const cap = frameCap(),
    backdrop = moviePlaying || subpage ? MENU_MOVIE_FPS : MENU_FPS;
  return cap ? Math.min(cap, backdrop) : backdrop;
}

// Decides which screen refreshes draw a frame under a frames-per-second cap (the galaxy map's rule, shared with the
// battles and the menu backdrop). A refresh up to a quarter interval early still draws, so a 60 Hz screen keeps every
// frame under a 60 cap while a 144 Hz one draws 60 of its 144. A skipped refresh does nothing at all, so the next drawn
// one catches up the time it missed and game time is unchanged.
export class FrameGate {
  constructor(cap = frameCap) {
    this.cap = cap;
    this.next = undefined;
  }
  skip(now) {
    const cap = typeof this.cap === 'function' ? this.cap() : this.cap;
    if (cap > 0 && this.next === undefined) this.next = now;
    if (!(cap > 0)) {
      this.next = undefined;
      return false;
    }
    const interval = 1000 / cap;
    if (this.next !== undefined && now < this.next - interval / 4) return true;
    this.next = this.next === undefined || now - this.next > interval ? now + interval : this.next + interval;
    return false;
  }
}

export const battleFrameCap = (benchmark, attract, paused, presenting, moviePlaying = false, subpage = false) =>
  benchmark || paused || presenting ? 0 : attract ? menuFrameCap(moviePlaying, subpage) : frameCap();

export const SUPERSAMPLE_STEPS = [1, 1.5, 2];
const SUPERSAMPLE_PIXEL_BUDGET = 3840 * 2160;

export function supersampling() {
  if (gfx.aa === false) return 1;
  return Math.max(1, Math.min(2, +gfx.supersample || 1));
}

export function pixelRatio() {
  const screenRatio = Math.min(devicePixelRatio, 2) * Math.max(0.25, Math.min(1, +gfx.scale || 1));
  const screenPixels = Math.max(1, innerWidth * innerHeight * screenRatio * screenRatio);
  const affordable = Math.sqrt(SUPERSAMPLE_PIXEL_BUDGET / screenPixels);
  return screenRatio * Math.max(1, Math.min(supersampling(), affordable));
}

const canvases = new Set();
export function gammaOn(canvas) {
  canvases.add(canvas);
  applyGamma();
}
function applyGamma() {
  const g = Math.max(0, Math.min(1, +gfx.gamma));
  const off = !(Math.abs(g - 0.5) > 0.02);
  let f = document.getElementById('gfxGammaFilter');
  if (!off && !f) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.dataset.page = '';
    svg.innerHTML =
      '<filter id="gfxGammaFilter" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="gamma"/><feFuncG type="gamma"/><feFuncB type="gamma"/></feComponentTransfer></filter>';
    document.body.appendChild(svg);
    f = document.getElementById('gfxGammaFilter');
  }
  if (f) for (const fn of f.querySelectorAll('feFuncR, feFuncG, feFuncB')) fn.setAttribute('exponent', String(Math.pow(1.6, 1 - 2 * g)));
  for (const c of canvases) c.style.filter = off ? '' : 'url(#gfxGammaFilter)';
}

let levels = null;
export async function presets() {
  if (levels) return levels;
  levels = [];
  const xml = await fetchText('Data/XML/GraphicDetails.xml').catch(() => null);
  if (!xml) return levels;
  const root = parseXML(xml);
  const all = [];
  root.walk
    ? root.walk(n => all.push(n))
    : (function go(n) {
        all.push(n);
        for (const c of n.children || []) go(c);
      })(root);
  const byName = new Map(),
    configs = [];
  for (const n of all) {
    const tag = (n.tag || '').toLowerCase(),
      name = n.attrs && (n.attrs.name || n.attrs.Name);
    if (tag === 'graphicdetaillevel' && name) byName.set(name.toUpperCase(), n);
    else if (tag === 'hardwareconfiguration') configs.push(n);
  }
  const val = (n, k) => {
    const c = (n.children || []).find(x => (x.tag || '').toLowerCase() === k.toLowerCase());
    return c ? String(c.text || '').trim() : null;
  };
  const get = (n, k, seen = new Set()) => {
    for (; n && !seen.has(n); n = byName.get(String(val(n, 'Based_On') || '').toUpperCase())) {
      seen.add(n);
      const v = val(n, k);
      if (v !== null && v !== '') return v;
    }
    return null;
  };
  let best = null;
  for (const c of configs) {
    const names = String(val(c, 'GraphicDetailSettingName') || '')
      .split(/\s+/)
      .filter(Boolean);
    if (!names.length) continue;
    const d = +val(c, 'DefaultGraphicDetailLevel') || 0;
    if (!best || d > best.d) best = { names, d };
  }
  const names = best ? best.names : [...byName.keys()].slice(0, 4);
  const yes = v => /^(yes|true|1)$/i.test(v || ''),
    num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  for (const nm of names) {
    const n = byName.get(nm.toUpperCase());
    if (!n) continue;
    levels.push({
      texMip: num(get(n, 'TextureMipLevel'), 0),
      shader: num(get(n, 'ShaderDetailLevel'), 3),
      shadow: num(get(n, 'ShadowDetail'), 2),
      shadows: yes(get(n, 'ShadowVolumes')),
      bloom: yes(get(n, 'Bloom')),
      heat: yes(get(n, 'HeatDistortions')),
      particle: num(get(n, 'ParticleDetail'), 1),
      mesh: num(get(n, 'MeshDetail'), 1),
      aa: num(get(n, 'ScreenAALevel'), 0) > 0
    });
  }
  return levels;
}
