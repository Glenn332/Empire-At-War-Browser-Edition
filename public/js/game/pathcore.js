const MOVING = 1,
  STILL = 2,
  FIELD = 4;
const SCELL = 512;
const FRAME = 1 / 30;
const TS = 0.5,
  TB = 4,
  TCELL = 800;
const TAU = Math.PI * 2;
const len = (x, y) => Math.sqrt(x * x + y * y);
const wrap = a => {
  a %= TAU;
  return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a;
};

const reachToward = (e, dx, dy, ux, uy) => {
  const c = ux * dx + uy * dy,
    c2 = c * c;
  return c2 * e.ax + (1 - c2) * e.sd;
};

function touch(q, qdx, qdy, ax, ay, bx, by, e, edx, edy, ex0, ey0, ex1, ey1) {
  const px = ax - ex0,
    py = ay - ey0,
    qx = bx - ex1,
    qy = by - ey1;
  const d0 = len(px, py) || 1,
    d1 = len(qx, qy) || 1;
  const R0 = reachToward(e, edx, edy, px / d0, py / d0) + reachToward(q, qdx, qdy, px / d0, py / d0);
  const R1 = reachToward(e, edx, edy, qx / d1, qy / d1) + reachToward(q, qdx, qdy, qx / d1, qy / d1);
  const c = px * px + py * py - R0 * R0;
  if (c <= 0) return true;
  const vx = qx - px,
    vy = qy - py,
    dR = R1 - R0;
  const a = vx * vx + vy * vy - dR * dR,
    b = 2 * (px * vx + py * vy - R0 * dR);
  if (a + b + c <= 0) return true;
  if (a > 0) {
    const t = -b / (2 * a);
    if (t > 0 && t < 1 && c - (b * b) / (4 * a) <= 0) return true;
  }
  return false;
}

export function arrivalTangent(px, py, h, gx, gy, face, rs, left, out) {
  if (px === gx && py === gy) {
    out[0] = px;
    out[1] = py;
    out[2] = Math.abs(wrap(h - face));
    return out;
  }
  const fc = Math.cos(face),
    fs = Math.sin(face),
    cx = left ? gx - fs * rs : gx + fs * rs,
    cy = left ? gy + fc * rs : gy - fc * rs;
  const d = len(px - cx, py - cy),
    m = rs > d ? rs : d,
    tl = Math.sqrt(m * m - rs * rs);
  let beta = Math.acos(m > 0 ? Math.min(1, tl / m) : 1);
  if (left) beta = -beta;
  let ux = cx - px,
    uy = cy - py;
  const l = len(ux, uy) || 1;
  ux /= l;
  uy /= l;
  const cb = Math.cos(beta),
    sb = Math.sin(beta),
    qx = px + (ux * cb - uy * sb) * tl,
    qy = py + (ux * sb + uy * cb) * tl;
  let ax = qx - cx,
    ay = qy - cy,
    bx = gx - cx,
    by = gy - cy;
  const la = len(ax, ay) || 1,
    lb = len(bx, by) || 1;
  ax /= la;
  ay /= la;
  bx /= lb;
  by /= lb;
  let ang = Math.acos(Math.max(-1, Math.min(1, bx * ax + by * ay)));
  if ((left ? -1 : 1) * (by * ax - bx * ay) > 0) ang = TAU - ang;
  out[0] = qx;
  out[1] = qy;
  out[2] = ang;
  return out;
}

export function speedTime(s0, vt, dist, acc, dec) {
  if (s0 === vt) return dist / Math.max(1e-6, s0);
  const A = vt < s0 ? dec : acc,
    reach = Math.abs(s0 * s0 - vt * vt) / (2 * A);
  if (dist > reach) return Math.abs(vt - s0) / A + (dist - reach) / Math.max(vt, s0);
  return Math.sqrt(2 * A * dist) / A;
}

const ARC_STEP = Math.PI / 6;
export function routeOf(NX, NY, NS, NT, NH, NOP, NP, end, now, F) {
  const out = [];
  for (let n = end; n > 0; n = NP[n]) {
    out.push({ x: NX[n], y: NY[n], speed: NS[n], t: now + NT[n], h: NH[n], turn: NOP[n] === 8 || NOP[n] === 9 });
    if ((NOP[n] === 15 || NOP[n] === 16) && F) {
      out[out.length - 1].close = Math.max(15, F.rs * 0.5);
      const p = NP[n],
        s0 = NS[p],
        dx = NX[n] - NX[p],
        dy = NY[n] - NY[p],
        d = len(dx, dy),
        reach = (s0 * s0 - NS[n] * NS[n]) / (2 * F.dec);
      if (s0 > NS[n] && d > reach && s0 > 0) {
        const f = (d - reach) / d;
        out.push({ x: NX[p] + dx * f, y: NY[p] + dy * f, speed: s0, t: now + NT[p] + (d - reach) / s0, h: NH[n], turn: false, close: 15 });
      }
    }
    if (NOP[n] === 17 && F) {
      const q = NP[n],
        left = NOP[q] === 15,
        fc = Math.cos(F.face),
        fs = Math.sin(F.face),
        cx = left ? F.gx - fs * F.rs : F.gx + fs * F.rs,
        cy = left ? F.gy + fc * F.rs : F.gy - fc * F.rs,
        a0 = Math.atan2(NY[q] - cy, NX[q] - cx),
        T = arrivalTangent(NX[q], NY[q], NH[q], F.gx, F.gy, F.face, F.rs, left, [0, 0, 0]),
        sweep = T[2] * (left ? 1 : -1),
        k = Math.floor(Math.abs(sweep) / ARC_STEP);
      for (let i = k; i >= 1; i--) {
        const f = (i * ARC_STEP) / Math.abs(sweep);
        if (f >= 1) continue;
        const a = a0 + sweep * f;
        out.push({
          x: cx + Math.cos(a) * F.rs,
          y: cy + Math.sin(a) * F.rs,
          speed: NS[n],
          t: now + NT[q] + (NT[n] - NT[q]) * f,
          h: a + (left ? Math.PI / 2 : -Math.PI / 2),
          turn: false,
          arc: true
        });
      }
    }
  }
  return out.reverse();
}

export { MOVING, STILL, FIELD, SCELL, touch };

export async function loadPathWasm(url) {
  try {
    const env = { now: () => performance.now(), cos: Math.cos, sin: Math.sin, atan2: Math.atan2, acos: Math.acos };
    let r;
    try {
      r = await WebAssembly.instantiateStreaming(fetch(url), { env });
    } catch {
      r = await WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), { env });
    }
    return { ex: r.instance.exports, mem: r.instance.exports.memory };
  } catch (e) {
    return null;
  }
}
const WASM_BASE = 1 << 20;

export class PathCore {
  constructor(world, K, ringStep) {
    this.world = world;
    this.K = K;
    this.shipCost = K.minObs / Math.max(0.01, K.coef);
    this.ringStep = ringStep;
    this.still = [];
    this.cells = new Map();
    this.tracks = [];
    this.searchMs = Infinity;
    this.expBudget = Infinity;
    this.statesUsed = 0;
    this.irun = 0;
  }

  ext(o) {
    if (o.pathExt) return o.pathExt;
    const t = o.type,
      s = o.scale || t.num('Scale_Factor', 1) || 1,
      cx = t.num('Custom_Hard_XExtent', 0),
      cy = t.num('Custom_Hard_YExtent', 0);
    const b = o.model && o.model.box;
    if (o.isStructure) {
      const soft = t.num('Custom_Soft_Footprint_Radius', 0),
        obs = t.num('Space_Obstacle_Radius', 0),
        R = Math.max(
          4,
          (soft > 0
            ? soft
            : obs > 0
              ? obs
              : b
                ? Math.max(Math.abs(b.max.x), Math.abs(b.min.x), Math.abs(b.max.y), Math.abs(b.min.y))
                : o.radius || 40) * s
        );
      return (o.pathExt = { ax: R, sd: R, r: R });
    }
    const E = o.extBox || (b ? [(b.max.x - b.min.x) * 0.5, (b.max.y - b.min.y) * 0.5] : null);
    const long = cx > 0 ? cx * s : E ? E[0] * s : 0;
    const wide = cy > 0 ? cy * s : E ? E[1] * s : 0;
    return (o.pathExt = { ax: long, sd: wide, r: Math.max(long, wide) });
  }

  sees(u, o) {
    return o !== u && (o.isStructure || (o.layer & u.layer) === u.layer);
  }

  tracking() {
    return this.tracks;
  }

  index(cand, H) {
    const w = this.world,
      now = w.time,
      n = cand.length,
      S = Math.ceil(H / TS) + 1;
    const X = (this.ix = this.ix && this.ix.length >= n * S ? this.ix : new Float32Array(Math.max(n * S, 1024)));
    const Y = (this.iy = this.iy && this.iy.length >= n * S ? this.iy : new Float32Array(Math.max(n * S, 1024)));
    const DX = (this.idx = this.idx && this.idx.length >= n * S ? this.idx : new Float32Array(Math.max(n * S, 1024)));
    const DY = (this.idy = this.idy && this.idy.length >= n * S ? this.idy : new Float32Array(Math.max(n * S, 1024)));
    const p = {};
    for (let k = 0; k < n; k++)
      for (let j = 0; j < S; j++) {
        this.at(cand[k], now + j * TS, p);
        const o = k * S + j;
        X[o] = p.x;
        Y[o] = p.y;
        DX[o] = p.dx;
        DY[o] = p.dy;
      }
    const gw = Math.max(1, Math.ceil((w.max.x - w.min.x) / TCELL) + 2),
      gh = Math.max(1, Math.ceil((w.max.y - w.min.y) / TCELL) + 2),
      B = Math.ceil(H / TB) + 1;
    const cells = gw * gh * B,
      per = Math.round(TB / TS);
    const head = (this.ihead = this.ihead && this.ihead.length >= cells + 1 ? this.ihead : new Int32Array(cells + 1));
    head.fill(0, 0, cells + 1);
    const cellsOf = (k, b, fn) => {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let j = b * per; j <= Math.min(S - 1, (b + 1) * per); j++) {
        const o = k * S + j;
        if (X[o] < x0) x0 = X[o];
        if (X[o] > x1) x1 = X[o];
        if (Y[o] < y0) y0 = Y[o];
        if (Y[o] > y1) y1 = Y[o];
      }
      const r = cand[k].ext.r;
      const c0 = Math.max(0, Math.floor((x0 - r - w.min.x) / TCELL) + 1),
        c1 = Math.min(gw - 1, Math.floor((x1 + r - w.min.x) / TCELL) + 1);
      const r0 = Math.max(0, Math.floor((y0 - r - w.min.y) / TCELL) + 1),
        r1 = Math.min(gh - 1, Math.floor((y1 + r - w.min.y) / TCELL) + 1);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) fn((b * gh + cy) * gw + cx);
    };
    for (let k = 0; k < n; k++) for (let b = 0; b < B; b++) cellsOf(k, b, c => head[c + 1]++);
    for (let c = 0; c < cells; c++) head[c + 1] += head[c];
    const list = (this.ilist = this.ilist && this.ilist.length >= head[cells] ? this.ilist : new Int32Array(Math.max(head[cells], 1024)));
    const fill = (this.ifill = this.ifill && this.ifill.length >= cells ? this.ifill : new Int32Array(cells));
    fill.set(head.subarray(0, cells));
    for (let k = 0; k < n; k++)
      for (let b = 0; b < B; b++)
        cellsOf(k, b, c => {
          list[fill[c]++] = k;
        });
    this.iS = S;
    this.igw = gw;
    this.igh = gh;
    this.iB = B;
    this.iN = n;
    this.istamp = this.istamp && this.istamp.length >= n ? this.istamp : new Int32Array(Math.max(n, 256));
  }

  at(tr, T, out) {
    const ts = tr.ts;
    let i = 0;
    if (ts.length > 2) while (i < ts.length - 1 && ts[i + 1] < T) i++;
    else if (ts.length === 2 && ts[1] < T) i = 1;
    if (i >= ts.length - 1) {
      out.x = tr.xs[ts.length - 1];
      out.y = tr.ys[ts.length - 1];
      out.dx = tr.hx;
      out.dy = tr.hy;
      if (ts.length > 1) {
        const k = ts.length - 1,
          dx = tr.xs[k] - tr.xs[k - 1],
          dy = tr.ys[k] - tr.ys[k - 1],
          d = len(dx, dy);
        if (d > 1) {
          out.dx = dx / d;
          out.dy = dy / d;
        }
      }
      return out;
    }
    const f = Math.max(0, Math.min(1, (T - ts[i]) / Math.max(1e-6, ts[i + 1] - ts[i])));
    const dx = tr.xs[i + 1] - tr.xs[i],
      dy = tr.ys[i + 1] - tr.ys[i],
      d = len(dx, dy);
    out.x = tr.xs[i] + dx * f;
    out.y = tr.ys[i] + dy * f;
    if (d > 1) {
      out.dx = dx / d;
      out.dy = dy / d;
    } else {
      out.dx = tr.hx;
      out.dy = tr.hy;
    }
    return out;
  }

  stillQ(q) {
    const B = this.K.staticBonus || 0;
    return B > 0 ? q.st || (q.st = { ax: q.ax, sd: q.sd + B, r: Math.max(q.ax, q.sd + B) }) : q;
  }

  sweep(u, q, ax, ay, bx, by, t0, t1) {
    let bits = 0;
    let qdx = bx - ax,
      qdy = by - ay;
    const ql = len(qdx, qdy);
    if (ql > 1e-3) {
      qdx /= ql;
      qdy /= ql;
    } else {
      qdx = Math.cos(u.heading);
      qdy = Math.sin(u.heading);
    }
    const qs = this.stillQ(q);
    const pad = Math.max(q.r, qs.r);
    const minx = Math.min(ax, bx) - pad,
      maxx = Math.max(ax, bx) + pad,
      miny = Math.min(ay, by) - pad,
      maxy = Math.max(ay, by) + pad;
    if (this.cand && this.candFor === u) {
      const ss = this.sStill,
        sl = ss.length;
      for (let i = 0; i < sl; i++) {
        const e = ss[i],
          R = (e.field ? q.r : qs.r) + e.ext.r;
        const px = ax - e.x,
          py = ay - e.y,
          vx = bx - ax,
          vy = by - ay,
          vv = vx * vx + vy * vy;
        let f = vv > 1e-9 ? -(px * vx + py * vy) / vv : 0;
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        const cx = px + vx * f,
          cy = py + vy * f;
        if (cx * cx + cy * cy > R * R) continue;
        if (
          e.field
            ? touch(q, qdx, qdy, ax, ay, bx, by, e.ext, 1, 0, e.x, e.y, e.x, e.y)
            : touch(qs, qdx, qdy, ax, ay, bx, by, e.ext, e.dx, e.dy, e.x, e.y, e.x, e.y)
        )
          bits |= e.field ? FIELD : STILL;
        if (bits & STILL) break;
      }
      return bits | this.sweepIndexed(q, qdx, qdy, ax, ay, bx, by, t0, t1, minx, miny, maxx, maxy);
    }
    const seen = (this.seenRun = (this.seenRun || 0) + 1);
    for (let ix = Math.floor(minx / SCELL), x1 = Math.floor(maxx / SCELL); ix <= x1 && !(bits & STILL); ix++)
      for (let iy = Math.floor(miny / SCELL), y1 = Math.floor(maxy / SCELL); iy <= y1; iy++) {
        const l = this.cells.get(ix * 65536 + iy);
        if (!l) continue;
        for (const e of l) {
          if (e.seen === seen) continue;
          e.seen = seen;
          if (e.o === u || !this.sees(u, e.o)) continue;
          if (touch(qs, qdx, qdy, ax, ay, bx, by, e.ext, e.dx, e.dy, e.x, e.y, e.x, e.y)) {
            bits |= STILL;
            break;
          }
        }
        if (bits & STILL) break;
      }
    for (const f of this.world.fields) {
      if (!this.world.hazardous(f, u)) continue;
      const fe = { ax: f.r, sd: f.r };
      if (touch(q, qdx, qdy, ax, ay, bx, by, fe, 1, 0, f.x, f.y, f.x, f.y)) {
        bits |= FIELD;
        break;
      }
    }
    const now = this.world.time,
      p0 = this._p0 || (this._p0 = {}),
      p1 = this._p1 || (this._p1 = {});
    if (this.cand && this.candFor === u) return bits | this.sweepIndexed(q, qdx, qdy, ax, ay, bx, by, t0, t1, minx, miny, maxx, maxy);
    const list = this.tracking(),
      filtered = false;
    for (let i = 0; i < list.length; i++) {
      const tr = list[i];
      if (!filtered && (tr.o === u || (tr.layer & u.layer) !== u.layer)) continue;
      if (tr.maxx < minx || tr.minx > maxx || tr.maxy < miny || tr.miny > maxy) continue;
      this.at(tr, now + t0, p0);
      this.at(tr, now + t1, p1);
      const px = ax - p0.x,
        py = ay - p0.y,
        vx = bx - p1.x - px,
        vy = by - p1.y - py,
        vv = vx * vx + vy * vy;
      let k = vv > 1e-9 ? -(px * vx + py * vy) / vv : 0;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      const cx = px + vx * k,
        cy = py + vy * k,
        R = q.r + tr.ext.r;
      if (cx * cx + cy * cy > R * R) continue;
      if (touch(q, qdx, qdy, ax, ay, bx, by, tr.ext, p1.dx, p1.dy, p0.x, p0.y, p1.x, p1.y)) {
        bits |= MOVING;
        break;
      }
    }
    return bits;
  }

  sweepIndexed(q, qdx, qdy, ax, ay, bx, by, t0, t1, minx, miny, maxx, maxy) {
    const w = this.world,
      S = this.iS,
      gw = this.igw,
      gh = this.igh,
      X = this.ix,
      Y = this.iy,
      DX = this.idx,
      DY = this.idy,
      head = this.ihead,
      list = this.ilist,
      cand = this.cand,
      stamp = this.istamp;
    const run = ++this.irun;
    const b0 = Math.max(0, Math.floor(t0 / TB)),
      b1 = Math.min(this.iB - 1, Math.floor(t1 / TB));
    const c0 = Math.max(0, Math.floor((minx - w.min.x) / TCELL) + 1),
      c1 = Math.min(gw - 1, Math.floor((maxx - w.min.x) / TCELL) + 1);
    const r0 = Math.max(0, Math.floor((miny - w.min.y) / TCELL) + 1),
      r1 = Math.min(gh - 1, Math.floor((maxy - w.min.y) / TCELL) + 1);
    const j0f = Math.min(S - 1, t0 / TS),
      j1f = Math.min(S - 1, t1 / TS);
    const ja = Math.floor(j0f),
      fa = j0f - ja,
      jb = Math.floor(j1f),
      fb = j1f - jb;
    for (let b = b0; b <= b1; b++)
      for (let cy = r0; cy <= r1; cy++)
        for (let cx = c0; cx <= c1; cx++) {
          const c = (b * gh + cy) * gw + cx;
          for (let i = head[c], e = head[c + 1]; i < e; i++) {
            const k = list[i];
            if (stamp[k] === run) continue;
            stamp[k] = run;
            const oa = k * S + ja,
              ob = k * S + jb,
              na = ja < S - 1 ? oa + 1 : oa,
              nb = jb < S - 1 ? ob + 1 : ob;
            const ex0 = X[oa] + (X[na] - X[oa]) * fa,
              ey0 = Y[oa] + (Y[na] - Y[oa]) * fa;
            const ex1 = X[ob] + (X[nb] - X[ob]) * fb,
              ey1 = Y[ob] + (Y[nb] - Y[ob]) * fb;
            const px = ax - ex0,
              py = ay - ey0,
              vx = bx - ex1 - px,
              vy = by - ey1 - py,
              vv = vx * vx + vy * vy;
            let f = vv > 1e-9 ? -(px * vx + py * vy) / vv : 0;
            f = f < 0 ? 0 : f > 1 ? 1 : f;
            const tr = cand[k],
              R = q.r + tr.ext.r,
              cxx = px + vx * f,
              cyy = py + vy * f;
            if (cxx * cxx + cyy * cyy > R * R) continue;
            if (touch(q, qdx, qdy, ax, ay, bx, by, tr.ext, DX[ob], DY[ob], ex0, ey0, ex1, ey1)) return MOVING;
          }
        }
    return 0;
  }

  slot(u, x, y) {
    const q = this.ext(u);
    const free = (px, py) => !(this.sweep(u, q, px, py, px, py, 0, 0) & STILL);
    if (free(x, y)) return null;
    const w = this.world,
      back = Math.atan2(u.y - y, u.x - x);
    for (let ring = 1; ring <= 40; ring++) {
      const r = ring * this.ringStep,
        n = Math.max(8, Math.round(r / 40));
      for (let k = 0; k < n; k++) {
        const a = back + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / n),
          px = x + Math.cos(a) * r,
          py = y + Math.sin(a) * r;
        if (px < w.min.x || py < w.min.y || px > w.max.x || py > w.max.y) continue;
        if (free(px, py)) return { x: px, y: py };
      }
    }
    return null;
  }

  find(u, gx, gy, face) {
    const pts = this.findOnce(u, gx, gy, 0, face);
    if (!pts || pts.length) return pts;
    const used = this.statesUsed || 0,
      again = this.findOnce(u, gx, gy, 600, face);
    this.statesUsed = used + (this.statesUsed || 0);
    return again;
  }

  findOnce(u, gx, gy, loose, face) {
    if (this.note) this.note('path search');
    const free = this.slot(u, gx, gy);
    if (free) {
      gx = free.x;
      gy = free.y;
    }
    const q = this.ext(u),
      v = Math.max(1, u.maxSpeed || 40),
      d = len(gx - u.x, gy - u.y);
    this.candFor = u;
    this.cand = this.tracking().filter(tr => tr.o !== u && (tr.layer & u.layer) === u.layer);
    this.index(this.cand, Math.min(this.K.horizon, Math.max(30, (4 * d) / v)));
    const inside = e => {
      const R = (e.ext?.r || 0) + q.r;
      return (e.x - u.x) ** 2 + (e.y - u.y) ** 2 < (R + loose) ** 2 || (e.x - gx) ** 2 + (e.y - gy) ** 2 < R * R;
    };
    this.sStill = this.still
      .filter(e => e.o !== u && this.sees(u, e.o) && !inside(e))
      .concat(
        this.world.fields
          .filter(f => this.world.hazardous(f, u))
          .map(f => ({ field: true, x: f.x, y: f.y, ext: { ax: f.r, sd: f.r, r: f.r } }))
      );
    if (this.wasm) this.wasmScene(q);
    try {
      const faced = Number.isFinite(face) && d >= 40;
      if (!faced && !this.sweep(u, q, u.x, u.y, gx, gy, 0, d / v)) return null;
      const K = this.K,
        inField = this.world.fields.some(
          f =>
            this.world.hazardous(f, u) && ((u.x - f.x) ** 2 + (u.y - f.y) ** 2 < f.r * f.r || (gx - f.x) ** 2 + (gy - f.y) ** 2 < f.r * f.r)
        );
      let rotMult = 1,
        fwdMult = 1,
        maxExp = K.maxExp,
        soft = inField,
        speed = v,
        cutoff = 0,
        wMult = 1,
        progress = 0;
      const until = performance.now() + this.searchMs;
      this.statesUsed = 0;
      for (let k = 0; k < K.tries; k++) {
        if (k >= 1) {
          rotMult += K.rotInc;
          fwdMult += K.fwdInc;
          maxExp *= K.expGrow;
        }
        if (this.statesUsed >= this.expBudget) break;
        if (k >= 2) {
          cutoff = Math.max(cutoff + K.cutK * d, progress);
          wMult *= K.coef;
        }
        if (k >= 3) soft = true;
        if (k >= 4) speed *= 0.5;
        const pts = this.search(u, q, gx, gy, {
          rotMult,
          fwdMult,
          maxExp: Math.min(maxExp, this.expBudget - this.statesUsed),
          soft,
          v: speed,
          cutoff,
          w: 1 / wMult,
          until,
          face: faced && k < 2 ? face : undefined
        });
        this.statesUsed += this.dbg.pushed || 0;
        if (pts) return pts;
        progress = Math.max(progress, d - this.dbg.best);
        if (performance.now() > until) break;
      }
      return [];
    } finally {
      this.cand = null;
      this.candFor = null;
      this.wl = null;
    }
  }

  wasmScene(q) {
    const { ex, mem } = this.wasm,
      K = this.K;
    const ss = this.sStill,
      ns = ss.length,
      cand = this.cand,
      nT = cand.length,
      S = this.iS;
    const cells = this.igw * this.igh * this.iB,
      listLen = this.ihead[cells];
    const most = K.maxExp * Math.pow(K.expGrow, Math.max(0, K.tries - 1));
    const cap = 1 << Math.ceil(Math.log2(Math.ceil(most) + 80)),
      hs = cap * 2;
    let at = WASM_BASE;
    const take = (n, bytes) => {
      at = (at + 7) & ~7;
      const a = at;
      at += Math.max(1, n) * bytes;
      return a;
    };
    const L = {};
    L.table = take(40, 4);
    L.P = take(80, 8);
    for (const k of ['SX', 'SY', 'SDX', 'SDY', 'SAX', 'SSD', 'SR', 'SF']) L[k] = take(ns, 8);
    for (const k of ['TX', 'TY', 'TDX', 'TDY']) L[k] = take(nT * S, 4);
    L.THEAD = take(cells + 1, 4);
    L.TLIST = take(listLen, 4);
    L.TSTAMP = take(nT, 4);
    for (const k of ['TAX', 'TSD', 'TR']) L[k] = take(nT, 8);
    for (const k of ['NX', 'NY', 'NH', 'NT', 'NS', 'NG', 'NF']) L[k] = take(cap, 8);
    for (const k of ['NOP', 'NP', 'NK', 'HEAP']) L[k] = take(cap, 4);
    for (const k of ['HKEY', 'HGEN', 'HSHUT']) L[k] = take(hs, 4);
    L.HVAL = take(hs, 8);
    const need = Math.ceil(at / 65536) - mem.buffer.byteLength / 65536;
    if (need > 0) mem.grow(need);
    const buf = mem.buffer,
      F = (a, n) => new Float64Array(buf, a, Math.max(1, n)),
      I = (a, n) => new Int32Array(buf, a, Math.max(1, n)),
      F32 = (a, n) => new Float32Array(buf, a, Math.max(1, n));
    const order = [
      'P',
      'SX',
      'SY',
      'SDX',
      'SDY',
      'SAX',
      'SSD',
      'SR',
      'SF',
      'TX',
      'TY',
      'TDX',
      'TDY',
      'THEAD',
      'TLIST',
      'TSTAMP',
      'TAX',
      'TSD',
      'TR',
      'NX',
      'NY',
      'NH',
      'NT',
      'NS',
      'NG',
      'NF',
      'NOP',
      'NP',
      'NK',
      'HEAP',
      'HKEY',
      'HGEN',
      'HSHUT',
      'HVAL'
    ];
    I(L.table, 40).set(order.map(k => L[k]));
    ex.setup(L.table, hs - 1, cap);
    const SX = F(L.SX, ns),
      SY = F(L.SY, ns),
      SDX = F(L.SDX, ns),
      SDY = F(L.SDY, ns),
      SAX = F(L.SAX, ns),
      SSD = F(L.SSD, ns),
      SR = F(L.SR, ns),
      SF = F(L.SF, ns);
    for (let i = 0; i < ns; i++) {
      const e = ss[i];
      SX[i] = e.x;
      SY[i] = e.y;
      SDX[i] = e.field ? 1 : e.dx;
      SDY[i] = e.field ? 0 : e.dy;
      SAX[i] = e.ext.ax;
      SSD[i] = e.ext.sd;
      SR[i] = e.ext.r;
      SF[i] = e.field ? 1 : 0;
    }
    if (nT * S) {
      F32(L.TX, nT * S).set(this.ix.subarray(0, nT * S));
      F32(L.TY, nT * S).set(this.iy.subarray(0, nT * S));
      F32(L.TDX, nT * S).set(this.idx.subarray(0, nT * S));
      F32(L.TDY, nT * S).set(this.idy.subarray(0, nT * S));
    }
    I(L.THEAD, cells + 1).set(this.ihead.subarray(0, cells + 1));
    if (listLen) I(L.TLIST, listLen).set(this.ilist.subarray(0, listLen));
    I(L.TSTAMP, nT).fill(0);
    const TAX = F(L.TAX, nT),
      TSD = F(L.TSD, nT),
      TR = F(L.TR, nT);
    for (let k = 0; k < nT; k++) {
      TAX[k] = cand[k].ext.ax;
      TSD[k] = cand[k].ext.sd;
      TR[k] = cand[k].ext.r;
    }
    I(L.HGEN, hs).fill(0);
    this.wl = { L, cap, ns, nT, S, cells };
  }

  wasmSearch(u, q, gx, gy, o) {
    const K = this.K,
      w = this.world,
      v = o.v,
      om = Math.max(0.05, u.turnRate || 0.5),
      acc = Math.max(1, u.accel || 20),
      dec = acc * 1.5;
    const N = Math.max(4, Math.round(K.rots / o.rotMult)),
      th = TAU / N;
    const dist0 = len(gx - u.x, gy - u.y);
    let D = K.xy * o.fwdMult;
    if (dist0 < 2 * D) D = Math.max(50, dist0 / 2);
    const step = v * Math.max(FRAME, D / v),
      cell = step / 1.5;
    const r = v / om,
      chord = 2 * r * Math.sin(th / 2),
      arcF = Math.cos(th / 2) * chord,
      arcS = Math.sin(th / 2) * chord,
      arcT = th / om;
    const slow = v * K.slowK,
      near = K.occR * (u.radius || q.r) + r;
    const mapped =
      u.x >= w.min.x &&
      u.x <= w.max.x &&
      u.y >= w.min.y &&
      u.y <= w.max.y &&
      gx >= w.min.x &&
      gx <= w.max.x &&
      gy >= w.min.y &&
      gy <= w.max.y;
    const startS = u.speed >= v * 0.95 ? v : Math.min(u.speed, v),
      nearOff = near + (v - startS) ** 2 / (2 * dec) + 100;
    const turns = [],
      run = Math.max(q.r, (v * v) / (2 * dec));
    for (const side of [1, -1])
      for (let k = 1; k <= 18; k++) {
        const h = u.heading + (side * k * 10 * Math.PI) / 180,
          bx = u.x + Math.cos(h) * run,
          by = u.y + Math.sin(h) * run;
        if (!(this.sweep(u, q, u.x, u.y, bx, by, 0, run / v) & (STILL | FIELD))) {
          turns.push(h);
          break;
        }
      }
    const { ex, mem } = this.wasm,
      { L, cap, ns, nT, S } = this.wl;
    const P = new Float64Array(mem.buffer, L.P, 80);
    P.set([
      u.x,
      u.y,
      gx,
      gy,
      u.heading,
      q.ax,
      q.sd,
      q.r,
      ns,
      nT,
      S,
      this.igw,
      this.igh,
      this.iB,
      TS,
      TB,
      TCELL,
      w.min.x,
      w.min.y,
      w.max.x,
      w.max.y,
      v,
      om,
      acc,
      dec,
      N,
      th,
      step,
      cell,
      r,
      arcF,
      arcS,
      arcT,
      slow,
      near,
      K.waitDist,
      K.waitCost,
      Math.min(o.maxExp, cap - 80),
      o.soft ? STILL : STILL | FIELD,
      this.shipCost,
      K.offMap,
      o.w,
      o.cutoff,
      mapped ? 1 : 0,
      startS,
      o.until && isFinite(o.until) ? o.until : 0,
      turns.length,
      turns[0] || 0,
      turns[1] || 0,
      FRAME,
      dist0,
      nearOff,
      this.stillQ(q).sd,
      this.stillQ(q).r,
      o.face !== undefined ? 1 : 0,
      o.face ?? 0,
      slow / om,
      K.alignK ?? 0.6,
      K.matchFace ?? (10 * Math.PI) / 180,
      K.pen180 ?? 1.5
    ]);
    const found = ex.search();
    const R = new Float64Array(mem.buffer, L.P, 80);
    this.dbg = { pops: R[60], pushed: R[61], best: R[62], op4: R[64], op4hard: R[65], N, D: step };
    const buf = mem.buffer,
      NX = new Float64Array(buf, L.NX, cap),
      NY = new Float64Array(buf, L.NY, cap),
      NH = new Float64Array(buf, L.NH, cap),
      NT = new Float64Array(buf, L.NT, cap),
      NS = new Float64Array(buf, L.NS, cap),
      NOP = new Int32Array(buf, L.NOP, cap),
      NP = new Int32Array(buf, L.NP, cap);
    return found < 0
      ? null
      : routeOf(
          NX,
          NY,
          NS,
          NT,
          NH,
          NOP,
          NP,
          found,
          this.world.time,
          o.face !== undefined ? { gx, gy, face: o.face, rs: slow / om, dec } : null
        );
  }

  room(cap) {
    if (this.cap >= cap) return;
    const n = 1 << Math.ceil(Math.log2(cap + 16));
    this.cap = n;
    this.NX = new Float64Array(n);
    this.NY = new Float64Array(n);
    this.NH = new Float64Array(n);
    this.NT = new Float64Array(n);
    this.NS = new Float64Array(n);
    this.NG = new Float64Array(n);
    this.NF = new Float64Array(n);
    this.NOP = new Int8Array(n);
    this.NP = new Int32Array(n);
    this.NK = new Int32Array(n);
    this.HEAP = new Int32Array(n);
    const hs = n * 2;
    this.HMASK = hs - 1;
    this.HKEY = new Int32Array(hs);
    this.HGEN = new Int32Array(hs);
    this.HVAL = new Float64Array(hs);
    this.HSHUT = new Uint8Array(hs);
    this.hgen = 0;
  }

  search(u, q, gx, gy, o) {
    if (this.wasm && this.wl) return this.wasmSearch(u, q, gx, gy, o);
    const K = this.K,
      w = this.world,
      v = o.v,
      om = Math.max(0.05, u.turnRate || 0.5),
      acc = Math.max(1, u.accel || 20),
      dec = acc * 1.5;
    const N = Math.max(4, Math.round(K.rots / o.rotMult)),
      th = TAU / N;
    const dist0 = len(gx - u.x, gy - u.y);
    let D = K.xy * o.fwdMult;
    if (dist0 < 2 * D) D = Math.max(50, dist0 / 2);
    const step = v * Math.max(FRAME, D / v),
      cell = step / 1.5;
    const r = v / om,
      chord = 2 * r * Math.sin(th / 2),
      arcF = Math.cos(th / 2) * chord,
      arcS = Math.sin(th / 2) * chord,
      arcT = th / om;
    const slow = v * K.slowK;
    const near = K.occR * (u.radius || q.r) + r;
    const face = o.face,
      faced = face !== undefined,
      rs = slow / om,
      alignK = K.alignK ?? 0.6,
      pen180 = K.pen180 ?? 1.5,
      matchFace = K.matchFace ?? (10 * Math.PI) / 180,
      TT = [0, 0, 0];
    const est = (op, x, y, h) => {
      if (!faced) return len(gx - x, gy - y);
      if (op === 11 || op === 12 || op === 15 || op === 16) {
        arrivalTangent(x, y, h, gx, gy, face, rs, op === 11 || op === 15, TT);
        return TT[2] * rs * (TT[2] > Math.PI ? pen180 : 1) + len(x - TT[0], y - TT[1]) * alignK;
      }
      return alignK * len(gx - x, gy - y);
    };
    const minX = w.min.x,
      maxX = w.max.x,
      minY = w.min.y,
      maxY = w.max.y;
    const mapped = u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY && gx >= minX && gx <= maxX && gy >= minY && gy <= maxY;
    const ux = u.x,
      uy = u.y,
      gcx = Math.floor((gx - ux) / cell),
      gcy = Math.floor((gy - uy) / cell);
    this.room(Math.ceil(o.maxExp) + 64);
    const NX = this.NX,
      NY = this.NY,
      NH = this.NH,
      NT = this.NT,
      NS = this.NS,
      NG = this.NG,
      NF = this.NF,
      NOP = this.NOP,
      NP = this.NP,
      NK = this.NK,
      HEAP = this.HEAP;
    const HMASK = this.HMASK,
      HKEY = this.HKEY,
      HGEN = this.HGEN,
      HVAL = this.HVAL,
      HSHUT = this.HSHUT,
      gen = ++this.hgen;
    const slotOf = key => {
      let i = (Math.imul(key, 0x9e3779b1) >>> 0) & HMASK;
      while (HGEN[i] === gen && HKEY[i] !== key) i = (i + 1) & HMASK;
      return i;
    };
    let count = 0,
      hn = 0,
      pushed = 0;
    const heapPush = id => {
      let i = hn++;
      const f = NF[id];
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (NF[HEAP[p]] <= f) break;
        HEAP[i] = HEAP[p];
        i = p;
      }
      HEAP[i] = id;
    };
    const heapPop = () => {
      const top = HEAP[0],
        last = HEAP[--hn];
      if (hn) {
        const f = NF[last];
        let i = 0;
        for (;;) {
          let c = i * 2 + 1;
          if (c >= hn) break;
          if (c + 1 < hn && NF[HEAP[c + 1]] < NF[HEAP[c]]) c++;
          if (NF[HEAP[c]] >= f) break;
          HEAP[i] = HEAP[c];
          i = c;
        }
        HEAP[i] = last;
      }
      return top;
    };
    const dbg = (this.dbg = { pops: 0, op4: 0, op4hard: 0, best: Infinity, N: 0, D: 0 });
    const startS = u.speed >= v * 0.95 ? v : Math.min(u.speed, v),
      nearOff = near + (v - startS) ** 2 / (2 * dec) + 100;
    NX[0] = ux;
    NY[0] = uy;
    NH[0] = u.heading;
    NOP[0] = -1;
    NT[0] = 0;
    NS[0] = startS;
    NP[0] = -1;
    NG[0] = 0;
    NF[0] = est(-1, ux, uy, u.heading) / v;
    NK[0] = -1;
    count = 1;
    heapPush(0);
    const turns = [];
    const run = Math.max(q.r, (v * v) / (2 * dec));
    for (const side of [1, -1])
      for (let k = 1; k <= 18; k++) {
        const h = u.heading + (side * k * 10 * Math.PI) / 180,
          bx = ux + Math.cos(h) * run,
          by = uy + Math.sin(h) * run;
        if (!(this.sweep(u, q, ux, uy, bx, by, 0, run / v) & (STILL | FIELD))) {
          turns.push(h);
          break;
        }
      }
    const maxExp = o.maxExp,
      hardMask = o.soft ? STILL : STILL | FIELD,
      shipCost = this.shipCost,
      offMap = K.offMap,
      ow = o.w,
      cutoff = o.cutoff;
    const add = (n, op, x, y, h, dt, s, mult) => {
      if (pushed > maxExp || dt < 0) return;
      let cost = dt * mult;
      const from = len(NX[n] - ux, NY[n] - uy);
      const jump = op === 4 || op === 15 || op === 16;
      if (x < minX || x > maxX || y < minY || y > maxY) {
        if (mapped && (jump || from > nearOff)) return;
        cost *= offMap;
      }
      const t0 = NT[n],
        bits = this.sweep(u, q, NX[n], NY[n], x, y, t0, t0 + dt);
      if (bits & hardMask && (jump || from > near)) {
        if (op === 4) dbg.op4hard++;
        return;
      }
      if (op === 4) dbg.op4++;
      if (bits) cost *= shipCost;
      const g = NG[n] + cost;
      let key = -1;
      if (op === 0 || op === 2 || op === 3 || op === 4) {
        const hb = Math.floor(((((h % TAU) + TAU) % TAU) / TAU) * N);
        key = ((Math.floor((x - ux) / cell) + 2048) * 4096 + (Math.floor((y - uy) / cell) + 2048)) * 64 + hb;
        const sl = slotOf(key);
        if (HGEN[sl] === gen) {
          if (HSHUT[sl] || HVAL[sl] <= g) return;
          HVAL[sl] = g;
        } else {
          HGEN[sl] = gen;
          HKEY[sl] = key;
          HVAL[sl] = g;
          HSHUT[sl] = 0;
        }
      }
      if (count >= this.cap) return;
      pushed++;
      const id = count++,
        t = t0 + dt,
        wh = ow > 1 && t * v < cutoff ? ow : 1;
      NX[id] = x;
      NY[id] = y;
      NH[id] = h;
      NOP[id] = op;
      NT[id] = t;
      NS[id] = s;
      NP[id] = n;
      NG[id] = g;
      NK[id] = key;
      NF[id] = g + (wh * est(op, x, y, h)) / v;
      heapPush(id);
    };
    let found = -1;
    const until = o.until;
    while (hn && pushed <= maxExp) {
      if ((dbg.pops & 255) === 255 && until && performance.now() > until) break;
      const n = heapPop();
      dbg.pops++;
      const nx = NX[n],
        ny = NY[n],
        nh = NH[n],
        ns = NS[n],
        nop = NOP[n];
      const dGoal = len(gx - nx, gy - ny);
      if (dGoal < dbg.best) dbg.best = dGoal;
      if (
        (faced ? n > 0 && Math.abs(wrap(nh - face)) < matchFace : nop === 4) &&
        Math.floor((nx - ux) / cell) === gcx &&
        Math.floor((ny - uy) / cell) === gcy
      ) {
        found = n;
        break;
      }
      if (NK[n] >= 0) {
        const sl = slotOf(NK[n]);
        if (HGEN[sl] === gen) {
          if (HSHUT[sl]) continue;
          HSHUT[sl] = 1;
        }
      }
      const full = Math.abs(ns - v) < 1e-3,
        isSlow = Math.abs(ns - slow) < 1e-3,
        ch = Math.cos(nh),
        sh = Math.sin(nh);
      if (nop === 6) {
        if (isSlow) add(n, 7, nx + ch * K.waitDist, ny + sh * K.waitDist, nh, K.waitDist / slow, slow, K.waitCost);
        continue;
      }
      if (nop === 7) {
        add(n, 7, nx + ch * K.waitDist, ny + sh * K.waitDist, nh, K.waitDist / slow, slow, K.waitCost);
        const dd = (v * v - ns * ns) / (2 * acc);
        add(n, 5, nx + ch * dd, ny + sh * dd, nh, (v - ns) / acc, v, 1);
        continue;
      }
      if (faced && nop >= 11) {
        if (nop === 11 || nop === 12) this.faceJump(add, n, nop + 4, nx, ny, nh, ns, slow, acc, dec, alignK, gx, gy, face, rs, TT);
        else if (nop === 15 || nop === 16) {
          arrivalTangent(nx, ny, nh, gx, gy, face, rs, nop === 15, TT);
          add(n, 17, gx, gy, face, (TT[2] * rs) / slow, slow, slow / v);
        }
        continue;
      }
      if (nop === 1) add(n, 4, gx, gy, Math.atan2(gy - ny, gx - nx), dGoal / v, v, 0.98);
      if (full) {
        const L = Math.min(dGoal, step);
        if (L > 1) add(n, 0, nx + ch * L, ny + sh * L, nh, L / v, v, 1);
        const phi = wrap(Math.atan2(gy - ny, gx - nx) - nh);
        if (faced)
          for (let side = 0; side < 2; side++) {
            arrivalTangent(nx, ny, nh, gx, gy, face, rs, side === 0, TT);
            const y = Math.atan2(TT[1] - ny, TT[0] - nx),
              dif = Math.abs(wrap(y - nh));
            if (dif <= th && dif >= 0.01) {
              const dq = len(TT[0] - nx, TT[1] - ny),
                dd = dq > step ? step : dq;
              add(n, 11 + side, nx + Math.cos(y) * dd, ny + Math.sin(y) * dd, y, dd / v, v, alignK);
            }
            this.faceJump(add, n, 15 + side, nx, ny, nh, ns, slow, acc, dec, alignK, gx, gy, face, rs, TT);
          }
        else if (Math.abs(phi) <= th && nop !== 1) {
          const a = Math.abs(phi),
            sg = Math.sign(phi) || 1,
            fw = r * Math.sin(a),
            sd = r * (1 - Math.cos(a)) * sg;
          add(n, 1, nx + ch * fw - sh * sd, ny + sh * fw + ch * sd, nh + phi, a / om, v, 0.99);
        }
        const tm = 1 + 0.5 / Math.max(1, dGoal / 400);
        add(n, 2, nx + ch * arcF - sh * arcS, ny + sh * arcF + ch * arcS, nh + th, arcT, v, tm);
        add(n, 3, nx + ch * arcF + sh * arcS, ny + sh * arcF - ch * arcS, nh - th, arcT, v, tm);
        const dd = (v * v - slow * slow) / (2 * dec);
        add(n, 6, nx + ch * dd, ny + sh * dd, nh, (v - slow) / dec, slow, 1);
      } else {
        const dd = Math.max(0, (v * v - ns * ns) / (2 * acc));
        add(n, 5, nx + ch * dd, ny + sh * dd, nh, Math.max(FRAME, (v - ns) / acc), v, 1);
      }
      if (n === 0)
        for (let i = 0; i < turns.length; i++) {
          const dh = Math.abs(wrap(turns[i] - nh));
          add(n, 8 + i, nx, ny, turns[i], dh / om, 0, 1);
        }
    }
    dbg.pushed = pushed;
    dbg.N = N;
    dbg.D = step;
    return found < 0 ? null : routeOf(NX, NY, NS, NT, NH, NOP, NP, found, this.world.time, faced ? { gx, gy, face, rs, dec } : null);
  }

  faceJump(add, n, op, nx, ny, nh, ns, slow, acc, dec, alignK, gx, gy, face, rs, TT) {
    arrivalTangent(nx, ny, nh, gx, gy, face, rs, op === 15, TT);
    const d = len(TT[0] - nx, TT[1] - ny);
    add(n, op, TT[0], TT[1], nh, speedTime(ns, slow, d, acc, dec), slow, alignK);
  }
}
