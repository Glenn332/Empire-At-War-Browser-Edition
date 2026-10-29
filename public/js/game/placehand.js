import { iconUrl } from '../icons.js';
import { iconNameFor } from './hud.js';

let el = null,
  sig = '';

export function showHand(list, x, y) {
  if (!list || !list.length) {
    if (el) el.style.display = 'none';
    sig = '';
    return;
  }
  if (!el || !el.isConnected) {
    el = document.createElement('div');
    el.style.cssText =
      'position:fixed;z-index:60;pointer-events:none;display:flex;gap:3px;padding:3px;background:rgba(0,0,0,0.55);border:1px solid rgba(120,170,220,0.6)';
    document.body.appendChild(el);
  }
  const counts = new Map();
  for (const t of list) counts.set(t, (counts.get(t) || 0) + 1);
  const s = [...counts].map(([t, n]) => t.name + n).join();
  if (s !== sig) {
    sig = s;
    el.replaceChildren();
    for (const [t, n] of counts) {
      const d = document.createElement('div');
      d.style.cssText = `position:relative;width:32px;height:32px;background:center/cover no-repeat url("${iconUrl(iconNameFor(t))}")`;
      const c = document.createElement('span');
      c.style.cssText =
        'position:absolute;right:1px;bottom:0;font:bold 11px "Segoe UI",sans-serif;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000';
      c.textContent = n;
      d.appendChild(c);
      el.appendChild(d);
    }
  }
  el.style.display = 'flex';
  el.style.left = x + 20 + 'px';
  el.style.top = y + 22 + 'px';
}

export function formation(radii, gap, perRow = 4) {
  const out = [];
  let back = 0;
  for (let i = 0; i < radii.length; i += perRow) {
    const row = radii.slice(i, i + perRow),
      deep = Math.max(...row);
    const width = row.reduce((s, r) => s + 2 * r, 0) + gap * (row.length - 1);
    let x = -width / 2;
    for (const r of row) {
      out.push({ a: -(back + deep), c: x + r });
      x += 2 * r + gap;
    }
    back += 2 * deep + gap;
  }
  const mid = back > 0 ? (back - gap) / 2 : 0;
  for (const o of out) o.a += mid;
  return out;
}

export function slotAt(o, x, y, heading) {
  const ch = Math.cos(heading),
    sh = Math.sin(heading);
  return { x: x + ch * o.a - sh * o.c, y: y + sh * o.a + ch * o.c };
}

export function stretched(radii, gap, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    L = Math.hypot(dx, dy) || 1,
    ux = dx / L,
    uy = dy / L;
  const fx = -uy,
    fy = ux;
  const pts = [];
  let back = 0;
  for (let i = 0; i < radii.length; ) {
    let n = 0,
      used = 0;
    while (i + n < radii.length && (n === 0 || used + gap + 2 * radii[i + n] <= L)) {
      used += (n ? gap : 0) + 2 * radii[i + n];
      n++;
    }
    const row = radii.slice(i, i + n),
      deep = Math.max(...row),
      spare = Math.max(0, L - used);
    const step = n > 1 ? gap + spare / (n - 1) : 0;
    let s = n > 1 ? 0 : (L - used) / 2;
    for (const r of row) {
      const at = s + r;
      pts.push({ x: a.x + ux * at - fx * (back + deep), y: a.y + uy * at - fy * (back + deep) });
      s += 2 * r + step;
    }
    back += 2 * deep + gap;
    i += n;
  }
  return { pts, facing: Math.atan2(fy, fx) };
}

export function kindOrders(types) {
  const kinds = [...new Set(types)].slice(0, 4),
    out = [];
  const go = (done, left) => {
    if (!left.length) {
      out.push(done);
      return;
    }
    left.forEach((k, i) => go([...done, k], [...left.slice(0, i), ...left.slice(i + 1)]));
  };
  go([], kinds);
  return out;
}

export function arranged(types, kinds) {
  const rank = t => {
    const i = kinds.indexOf(t);
    return i < 0 ? kinds.length : i;
  };
  return types.map((t, i) => i).sort((a, b) => rank(types[a]) - rank(types[b]) || a - b);
}

export function laidOut(types, radii, n, place) {
  const orders = kindOrders(types),
    seq = arranged(types, orders[((n % orders.length) + orders.length) % orders.length] || []);
  const got = place(seq.map(i => radii[i])),
    list = got.pts || got,
    out = new Array(types.length);
  seq.forEach((i, j) => {
    out[i] = list[j];
  });
  return { pts: out, seq, facing: got.facing };
}

export const WHEEL_TURN = Math.PI / 12;
