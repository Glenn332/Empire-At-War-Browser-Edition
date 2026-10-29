import { fetchText } from './vfs.js';
import { parseXML } from './xml.js';

const KEY = 'swr-gfx';
const OWN = { shadows: true, bloom: true, heat: true, flare: true, scale: 1, aa: true, particle: 1, mesh: 1, texMip: 0, shader: 3, shadow: 3, gamma: 0.5, level: -1 };

function read() {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (kept) return kept;
    const old = localStorage.getItem('swr-shadows');
    return old === null ? {} : { shadows: old === '1' };
  } catch { return {}; }
}

export const gfx = Object.assign({}, OWN, read());
export const gfxDefaults = OWN;

export function storeGfx() {
  try { localStorage.setItem(KEY, JSON.stringify(gfx)); } catch { }
  applyGamma();
}

export function shadowSize() { return [512, 1024, 2048, 4096][Math.max(0, Math.min(3, gfx.shadow | 0))]; }

export function pixelRatio() { return Math.min(devicePixelRatio, 2) * Math.max(0.25, Math.min(1, +gfx.scale || 1)); }

const canvases = new Set();
export function gammaOn(canvas) { canvases.add(canvas); applyGamma(); }
function applyGamma() {
  const g = Math.max(0, Math.min(1, +gfx.gamma));
  const off = !(Math.abs(g - 0.5) > 0.02);
  let f = document.getElementById('gfxGammaFilter');
  if (!off && !f) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute'; svg.dataset.page = '';
    svg.innerHTML = '<filter id="gfxGammaFilter" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="gamma"/><feFuncG type="gamma"/><feFuncB type="gamma"/></feComponentTransfer></filter>';
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
  root.walk ? root.walk(n => all.push(n)) : (function go(n) { all.push(n); for (const c of n.children || []) go(c); })(root);
  const byName = new Map(), configs = [];
  for (const n of all) {
    const tag = (n.tag || '').toLowerCase(), name = n.attrs && (n.attrs.name || n.attrs.Name);
    if (tag === 'graphicdetaillevel' && name) byName.set(name.toUpperCase(), n);
    else if (tag === 'hardwareconfiguration') configs.push(n);
  }
  const val = (n, k) => { const c = (n.children || []).find(x => (x.tag || '').toLowerCase() === k.toLowerCase()); return c ? String(c.text || '').trim() : null; };
  const get = (n, k, seen = new Set()) => {
    for (; n && !seen.has(n); n = byName.get(String(val(n, 'Based_On') || '').toUpperCase())) { seen.add(n); const v = val(n, k); if (v !== null && v !== '') return v; }
    return null;
  };
  let best = null;
  for (const c of configs) { const names = String(val(c, 'GraphicDetailSettingName') || '').split(/\s+/).filter(Boolean); if (!names.length) continue; const d = +val(c, 'DefaultGraphicDetailLevel') || 0; if (!best || d > best.d) best = { names, d }; }
  const names = best ? best.names : [...byName.keys()].slice(0, 4);
  const yes = v => /^(yes|true|1)$/i.test(v || ''), num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  for (const nm of names) {
    const n = byName.get(nm.toUpperCase());
    if (!n) continue;
    levels.push({
      texMip: num(get(n, 'TextureMipLevel'), 0), shader: num(get(n, 'ShaderDetailLevel'), 3), shadow: num(get(n, 'ShadowDetail'), 2),
      shadows: yes(get(n, 'ShadowVolumes')), bloom: yes(get(n, 'Bloom')), heat: yes(get(n, 'HeatDistortions')),
      particle: num(get(n, 'ParticleDetail'), 1), mesh: num(get(n, 'MeshDetail'), 1), aa: num(get(n, 'ScreenAALevel'), 0) > 0,
    });
  }
  return levels;
}
