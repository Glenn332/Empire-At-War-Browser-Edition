import { CELL } from './terrain.js';
import { TERRAIN } from './landtables.js';

const HALF = CELL / 2;
const HASH_MOST = 20000;
const f32 = Math.fround;

export class LandPaths {
  constructor(world) {
    this.w = world;
    this.n = world.n;
    this.ver = -1;
    this.mask = 0;
    this.clearance = 0;
    this.bits = new Int32Array(this.n * this.n);
  }

  sync() {
    const w = this.w;
    if (this.ver === w.groundVer) return;
    this.ver = w.groundVer;
    const n = this.n,
      kind = w.kind,
      open = w.open,
      bits = this.bits,
      T = TERRAIN;
    const side = (n - 1) * CELL,
      lo = w.map.playMin || [0, 0],
      hi = w.map.playMax || [side, side];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x,
          X = x * CELL,
          Y = y * CELL;
        let b = kind[i];
        if (X <= lo[0] || X >= hi[0] || Y <= lo[1] || Y >= hi[1]) b |= T.OBSTACLE;
        if (!open[i]) b |= T.OBSTACLE;
        bits[i] = b & ~T.CLEAR || b;
      }
    const ox = Math.trunc((lo[0] + 5) / 20),
      oy = Math.trunc((lo[1] + 5) / 20);
    const rw = Math.trunc((hi[0] - lo[0] + 5) / 20),
      rh = Math.trunc((hi[1] - lo[1] + 5) / 20);
    const W1 = rw + 1,
      H1 = rh + 1;
    this.ox = ox;
    this.oy = oy;
    this.rw = rw;
    this.rh = rh;
    this.W1 = W1;
    this.H1 = H1;
    const cb = new Int32Array(W1 * H1),
      ids = new Int32Array(W1 * H1).fill(-1);
    for (let r = 0; r < H1; r++)
      for (let c = 0; c < W1; c++) {
        const X = c + ox,
          Y = r + oy;
        cb[r * W1 + c] = c === W1 - 1 || r === H1 - 1 || X < 0 || Y < 0 || X >= n || Y >= n ? -1 : bits[Y * n + X];
      }
    const RX = [],
      RY = [],
      RW = [],
      RH = [],
      RB = [],
      out = [0, 0];
    for (let y = 0; y + 1 < H1; y++)
      for (let x = 0; x + 1 < W1; ) {
        const p = y * W1 + x,
          have = ids[p];
        if (have !== -1) {
          x += RW[have];
          continue;
        }
        grow(cb, ids, W1, p, W1 - x - 1, H1 - y - 1, x !== 0, y !== 0, out);
        const id = RX.length,
          rwid = out[0],
          rhei = out[1];
        for (let r = 0; r < rhei; r++) ids.fill(id, p + r * W1, p + r * W1 + rwid);
        RX.push(x);
        RY.push(y);
        RW.push(rwid);
        RH.push(rhei);
        RB.push(cb[p]);
        x += rwid;
      }
    this.ids = ids;
    const count = RX.length;
    this.rx = Int32Array.from(RX, v => v + ox);
    this.ry = Int32Array.from(RY, v => v + oy);
    this.rwd = Int32Array.from(RW);
    this.rht = Int32Array.from(RH);
    this.rbits = Int32Array.from(RB);
    const start = new Int32Array(count + 1),
      list = [];
    for (let k = 0; k < count; k++) {
      start[k] = list.length;
      const x = RX[k],
        y = RY[k],
        wd = RW[k],
        ht = RH[k];
      let last = -1;
      if (x + wd + 1 < W1)
        for (let r = 0; r < ht; r++) {
          const id = ids[(y + r) * W1 + x + wd];
          if (id !== last) {
            list.push(id);
            last = id;
          }
        }
      if (x !== 0)
        for (let r = 0; r < ht; r++) {
          const id = ids[(y + r) * W1 + x - 1];
          if (id !== last) {
            list.push(id);
            last = id;
          }
        }
      if (y + ht + 1 < H1)
        for (let c = 0; c < wd; c++) {
          const id = ids[(y + ht) * W1 + x + c];
          if (id !== last && id !== -1) {
            list.push(id);
            last = id;
          }
        }
      if (y !== 0)
        for (let c = 0; c < wd; c++) {
          const id = ids[(y - 1) * W1 + x + c];
          if (id !== last && id !== -1) {
            list.push(id);
            last = id;
          }
        }
    }
    start[count] = list.length;
    this.nbStart = start;
    this.nbList = Int32Array.from(list);
    this.count = count;
  }

  rectOfCell(cx, cy) {
    const x = cx - this.ox,
      y = cy - this.oy;
    return x >= 0 && x < this.rw && y >= 0 && y < this.rh ? this.ids[y * this.W1 + x] : -1;
  }
  rectOf(px, py) {
    return this.rectOfCell(Math.trunc((HALF + px) / CELL), Math.trunc((HALF + py) / CELL));
  }
  enters(cx, cy) {
    const n = this.n;
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return false;
    const b = this.bits[cy * n + cx];
    return (b & this.mask) === b;
  }

  route(ax, ay, bx, by, mask, clearance = 0) {
    this.sync();
    this.mask = mask;
    let a = { x: ax, y: ay },
      b = { x: bx, y: by };
    if (!this.enters(cellOf(ax), cellOf(ay)) || this.rectOf(ax, ay) < 0) {
      a = this.nearestCell(ax, ay);
      if (!a) return null;
    }
    if (!this.enters(cellOf(bx), cellOf(by)) || this.rectOf(bx, by) < 0) {
      b = this.nearestCell(bx, by);
      if (!b) return null;
    }
    const way = this.request(a, b, clearance, true);
    if (!way) return null;
    way.shift();
    if (a.x !== ax || a.y !== ay) way.unshift({ x: a.x, y: a.y });
    return way.length ? way : [{ x: b.x, y: b.y }];
  }

  nearestCell(x, y) {
    const cx = cellOf(x),
      cy = cellOf(y);
    for (let r = 0; r < 40; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r, edge = dy === -r || dy === r; dx <= r; dx = edge || dx === r ? dx + 1 : r) {
          const ix = cx + dx,
            iy = cy + dy;
          if (this.enters(ix, iy) && this.rectOfCell(ix, iy) >= 0) return { x: ix * CELL, y: iy * CELL };
        }
    return null;
  }

  request(a, b, clearance, smooth) {
    if (!(clearance > 0)) {
      this.clearance = 0;
      return this.search(a, b, smooth);
    }
    this.clearance = 0;
    const pts = this.search(a, b, false);
    if (!pts) return null;
    this.clearance = clearance;
    const out = [],
      count = pts.length;
    let bad = false,
      from = 0;
    for (let u = 1; u < count; ) {
      const k = u - 1,
        A = pts[k],
        B = pts[u];
      u++;
      const last = u === count && bad;
      if (clearance - 0.1 <= this.across(A, B) || last) {
        if (bad) {
          bad = false;
          const sub = this.search(pts[from], last ? B : A, false);
          if (!sub) return null;
          out.push(...sub);
        } else out.push(A);
      } else if (!bad) {
        bad = true;
        from = k;
      }
    }
    const end = pts[count - 1];
    if (out.length && (out[out.length - 1].x !== end.x || out[out.length - 1].y !== end.y)) out.push(end);
    return smooth ? this.finish(out) : out;
  }

  search(a, b, smooth) {
    const sx = cellOf(a.x),
      sy = cellOf(a.y),
      gx = cellOf(b.x),
      gy = cellOf(b.y);
    const rs = this.rectOfCell(sx, sy),
      rg = this.rectOfCell(gx, gy);
    if (rs === rg) {
      const pts = [];
      if (a.x !== sx * CELL || a.y !== sy * CELL) pts.push({ x: a.x, y: a.y });
      pts.push({ x: sx * CELL, y: sy * CELL }, { x: gx * CELL, y: gy * CELL });
      if (b.x !== gx * CELL || b.y !== gy * CELL) pts.push({ x: b.x, y: b.y });
      if (!smooth) return pts;
      const out = this.pull(pts);
      this.cut(out, 0, length(out));
      return out;
    }
    if (rs < 0 || rg < 0) return null;
    const mask = this.mask,
      rb = this.rbits;
    if ((rb[rs] & mask) !== rb[rs]) return null;
    const n = this.n,
      most = 2 * n * n;
    if (!this.nodeX || this.nodeX.length < most) {
      this.nodeX = new Int32Array(most);
      this.nodeY = new Int32Array(most);
      this.nodeR = new Int32Array(most);
      this.nodeUp = new Int32Array(most);
      this.entG = new Float32Array(most);
      this.entF = new Float32Array(most);
      this.entNode = new Int32Array(most);
      this.heap = new Int32Array(most + 2);
    }
    const NX = this.nodeX,
      NY = this.nodeY,
      NR = this.nodeR,
      NU = this.nodeUp,
      EG = this.entG,
      EF = this.entF,
      EN = this.entNode,
      heap = this.heap;
    const RXa = this.rx,
      RYa = this.ry,
      RWa = this.rwd,
      RHa = this.rht,
      nbS = this.nbStart,
      nbL = this.nbList,
      R = this.count;
    const seen = new Map();
    let nodes = 0,
      ents = 0,
      size = 0;
    const push = e => {
      if (size >= most) return;
      let i = ++size;
      for (; i > 1; i >>= 1) {
        const p = heap[i >> 1];
        if (EF[p] <= EF[e]) break;
        heap[i] = p;
      }
      heap[i] = e;
    };
    const pop = () => {
      const top = heap[1];
      heap[1] = heap[size];
      size--;
      for (let i = 1; ; ) {
        let c = i;
        if (2 * i <= size && EF[heap[2 * i]] < EF[heap[i]]) c = 2 * i;
        if (2 * i + 1 <= size && EF[heap[2 * i + 1]] < EF[heap[c]]) c = 2 * i + 1;
        if (c === i) break;
        const t = heap[i];
        heap[i] = heap[c];
        heap[c] = t;
        i = c;
      }
      return top;
    };
    NX[0] = sx;
    NY[0] = sy;
    NR[0] = rs;
    NU[0] = -1;
    nodes = 1;
    EN[0] = 0;
    EG[0] = 0;
    EF[0] = 0;
    ents = 1;
    push(0);
    seen.set(rs * R + rs, { g: 0, closed: false });
    const q = [0, 0];
    while (size) {
      const e = pop(),
        node = EN[e],
        cur = NR[node];
      if (cur === rg) return this.way(node, a, b, sx, sy, gx, gy, smooth);
      const prev = NU[node] >= 0 ? NR[NU[node]] : rs,
        mine = seen.get(prev * R + cur);
      if (mine) mine.closed = true;
      const px = NX[node],
        py = NY[node],
        ax = RXa[cur],
        ay = RYa[cur],
        aw = RWa[cur],
        ah = RHa[cur];
      for (let k = nbS[cur]; k < nbS[cur + 1]; k++) {
        const nb = nbL[k];
        if (nb === rs) continue;
        const key = cur * R + nb,
          had = seen.get(key);
        if (had && had.closed) continue;
        if ((rb[nb] & mask) !== rb[nb]) continue;
        cross(px, py, ax, ay, aw, ah, RXa[nb], RYa[nb], RWa[nb], RHa[nb], q);
        const g = f32(this.stepCost(px, py, q[0], q[1], cur, nb) + EG[e]);
        if (had && !(g < had.g)) continue;
        if (had) had.g = g;
        if (nodes >= most) return null;
        const m = nodes++;
        NX[m] = q[0];
        NY[m] = q[1];
        NR[m] = nb;
        NU[m] = node;
        const f = ents++;
        EN[f] = m;
        EG[f] = g;
        EF[f] = f32(Math.sqrt((q[1] - gy) * (q[1] - gy) + (q[0] - gx) * (q[0] - gx)) + g);
        push(f);
        if (!had) {
          if (seen.size + 1 >= HASH_MOST) return null;
          seen.set(key, { g, closed: false });
        }
      }
    }
    return null;
  }

  stepCost(px, py, qx, qy, from, into) {
    let c = Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py));
    const cl = this.clearance;
    if (cl > 20) {
      const r = [0, 0];
      cross(
        qx,
        qy,
        this.rx[into],
        this.ry[into],
        this.rwd[into],
        this.rht[into],
        this.rx[from],
        this.ry[from],
        this.rwd[from],
        this.rht[from],
        r
      );
      const P = { x: px * CELL, y: py * CELL },
        Rp = { x: r[0] * CELL, y: r[1] * CELL },
        Q = { x: qx * CELL, y: qy * CELL };
      const w1 = this.across(P, Rp),
        w2 = this.across(Rp, Q),
        m = w2 > w1 ? w1 : w2;
      if (cl > m) c = c * (cl / m + 1 + 0.1) + 15;
    }
    return c;
  }

  way(node, a, b, sx, sy, gx, gy, smooth) {
    const rects = [];
    for (let k = node; k >= 0; k = this.nodeUp[k]) rects.push(this.nodeR[k]);
    rects.reverse();
    const RXa = this.rx,
      RYa = this.ry,
      RWa = this.rwd,
      RHa = this.rht,
      cells = [[sx, sy]],
      p1 = [0, 0],
      p0 = [0, 0];
    for (let i = 1; i < rects.length; i++) {
      const A = rects[i - 1],
        B = rects[i],
        last = cells[cells.length - 1];
      cross(last[0], last[1], RXa[A], RYa[A], RWa[A], RHa[A], RXa[B], RYa[B], RWa[B], RHa[B], p1);
      cross(p1[0], p1[1], RXa[B], RYa[B], RWa[B], RHa[B], RXa[A], RYa[A], RWa[A], RHa[A], p0);
      if (p0[0] !== last[0] || p0[1] !== last[1]) cells.push([p0[0], p0[1]]);
      cells.push([p1[0], p1[1]]);
    }
    const end = cells[cells.length - 1];
    if (end[0] !== gx || end[1] !== gy) cells.push([gx, gy]);
    const pts = cells.map(c => ({ x: c[0] * CELL, y: c[1] * CELL }));
    if (a.x !== pts[0].x || a.y !== pts[0].y) pts.unshift({ x: a.x, y: a.y });
    const z = pts[pts.length - 1];
    if (b.x !== z.x || b.y !== z.y) pts.push({ x: b.x, y: b.y });
    return smooth ? this.finish(pts) : pts;
  }

  finish(pts) {
    this.halve(pts);
    this.cut(pts, 0, length(pts));
    return pts;
  }

  halve(pts) {
    if (pts.length < 2) return;
    let i = 0;
    do {
      const P = pts[i],
        next = i + 1,
        count = pts.length;
      let hi = count - 1,
        lo = i,
        mid = (hi + i) >>> 1,
        best = next;
      if (next <= mid)
        for (;;) {
          if (mid >= pts.length) break;
          const Q = pts[mid];
          if (this.line(P, Q) && this.roomy(P, Q)) {
            lo = mid + 1;
            best = mid;
          } else {
            if (mid === 0) break;
            hi = mid - 1;
          }
          if (hi < lo) break;
          mid = (hi + lo) >>> 1;
          if (mid < best) break;
        }
      if (best < pts.length && next < best) pts.splice(next, best - next);
      i = next;
    } while (i + 1 < pts.length);
  }

  pull(src) {
    const out = [],
      count = src.length;
    for (let i = 0; i < count; ) {
      out.push(src[i]);
      let j = count - 1,
        hop = -1;
      for (; i < j; j--)
        if (this.wide(src[i], src[j]) && this.roomy(src[i], src[j])) {
          hop = j;
          break;
        }
      if (hop >= 0) {
        i = hop;
        continue;
      }
      if (i === count - 1) break;
      i++;
    }
    return out;
  }

  cut(pts, s, e) {
    if (!(s <= e - 15)) return;
    const A = along(pts, s),
      B = along(pts, e);
    if (A.i === B.i) return;
    if (A.i + 1 === B.i) {
      const P = at(pts, A.i),
        Q = at(pts, B.i + 1);
      const d1 = unit(A.x - P.x, A.y - P.y),
        d2 = unit(B.x - A.x, B.y - A.y),
        d3 = unit(Q.x - B.x, Q.y - B.y);
      if (d1[0] * d2[0] + d1[1] * d2[1] > 0.9 && d2[0] * d3[0] + d2[1] * d3[1] > 0.9) return;
    }
    const P = at(pts, A.i),
      Q = at(pts, B.i + 1);
    const l1 = Math.hypot(A.x - P.x, A.y - P.y),
      l2 = Math.hypot(Q.x - B.x, Q.y - B.y);
    if (!((l1 >= 20 || l1 <= 0) && (l2 >= 20 || l2 <= 0))) return;
    const ok = (s === 0 ? this.line(A, B) : this.wide(A, B)) && this.roomy(A, B);
    if (!ok) {
      const L = length(pts);
      this.cut(pts, s, (e - s) * 0.66 + s);
      const L2 = length(pts),
        e2 = (e / L) * L2,
        s2 = (s / L) * L2;
      this.cut(pts, (e2 - s2) * 0.33 + s2, e2);
      return;
    }
    if (B.t <= 0) erase(pts, A.i + 1, B.i);
    else {
      erase(pts, A.i + 1, B.i + 1);
      if (B.t < 1) insert(pts, { x: B.x, y: B.y }, A.i + 1);
    }
    if (A.t > 0) insert(pts, { x: A.x, y: A.y }, A.i + 1);
  }

  line(P, Q, out = SCRATCH) {
    const d = Math.hypot(P.x - Q.x, P.y - Q.y);
    if (!Number.isFinite(d)) {
      out.d = 0;
      return false;
    }
    return this.seg(P, this.rectOf(P.x, P.y), Q, this.rectOf(Q.x, Q.y), d, out);
  }
  seg(P, ra, Q, rq, d, out) {
    if (d === 0) {
      out.d = 0;
      return true;
    }
    const cx = Math.trunc((HALF + P.x) / CELL),
      cy = Math.trunc((HALF + P.y) / CELL),
      n = this.n;
    if (cx < 0 || cx >= n || cy < 0 || cy >= n) {
      out.d = 0;
      return false;
    }
    const b = this.bits[cy * n + cx];
    if ((b & this.mask) !== b || ra !== rq) {
      if (d < 40) return this.cells(P, Q, out);
      const h = d * 0.5,
        M = { x: (P.x + Q.x) * 0.5, y: (P.y + Q.y) * 0.5 },
        rm = this.rectOf(M.x, M.y),
        t = { d: 0 };
      if (!this.seg(P, ra, M, rm, h, t)) {
        out.d = t.d;
        return false;
      }
      const ok = this.seg(M, rm, Q, rq, h, t);
      out.d = t.d + h;
      return ok;
    }
    out.d = d;
    return true;
  }
  cells(P, Q, out) {
    out.d = 0;
    if (P.x === Q.x && P.y === Q.y) return true;
    const dx = Q.x - P.x,
      dy = Q.y - P.y,
      n = this.n,
      bits = this.bits,
      mask = this.mask;
    const sx = dx < 0 ? -1 : dx > 0 ? 1 : 0,
      sy = dy < 0 ? -1 : dy > 0 ? 1 : 0;
    const fx1 = (HALF + Q.x) / CELL,
      fy1 = (HALF + Q.y) / CELL,
      fx0 = (HALF + P.x) / CELL,
      fy0 = (HALF + P.y) / CELL;
    const ddx = fx1 - fx0,
      ddy = fy1 - fy0;
    let ix = Math.trunc(fx0),
      iy = Math.trunc(fy0);
    if (sx < 0) {
      if (fx0 - ix === 0) ix--;
    } else if (sx > 0) ix++;
    if (sy < 0) {
      if (fy0 - iy === 0) iy--;
    } else if (sy > 0) iy++;
    let tx = 0,
      ty = 0,
      cx = fx0,
      cy = fy0;
    const fail = () => {
      out.d = Math.hypot(cx * CELL - HALF - P.x, cy * CELL - HALF - P.y);
      return false;
    };
    const open = (mx, my) => {
      if (mx < 0 || my < 0 || mx >= n || my >= n) return false;
      const b = bits[my * n + mx];
      return (b & mask) === b;
    };
    while (tx <= 1 || ty <= 1) {
      tx = ddx !== 0 ? (ix - fx0) * (1 / ddx) : 1.1;
      ty = ddy !== 0 ? (iy - fy0) * (1 / ddy) : 1.1;
      if (tx >= 1 && ty >= 1) break;
      let nx, ny;
      if (Math.abs(tx - ty) >= 1e-7) {
        if (ty <= tx) {
          if (tx <= ty) return false;
          nx = ty * ddx + fx0;
          ny = iy;
          iy += sy;
        } else {
          nx = ix;
          ny = tx * ddy + fy0;
          ix += sx;
        }
      } else {
        nx = ix;
        ix += sx;
        ny = iy;
        iy += sy;
      }
      if (cx !== nx || cy !== ny) {
        if (!open(Math.trunc((cx + nx) * 0.5), Math.trunc((cy + ny) * 0.5))) return fail();
        cx = nx;
        cy = ny;
      }
    }
    if ((cx !== fx1 || cy !== fy1) && !open(Math.trunc((cx + fx1) * 0.5), Math.trunc((cy + fy1) * 0.5))) return fail();
    out.d = Math.hypot(P.x - Q.x, P.y - Q.y);
    return true;
  }
  wide(A, B) {
    if (B.x - A.x !== 0) {
      const ox = B.x - A.x > 0 ? HALF : -HALF;
      for (let k = 0; k < 2; k++) {
        const oy = k === 1 ? HALF : -HALF;
        if (!this.line({ x: A.x + ox, y: A.y + oy }, { x: B.x + ox, y: B.y + oy })) return false;
      }
    }
    if (B.y - A.y !== 0) {
      const oy = B.y - A.y > 0 ? HALF : -HALF;
      for (let k = 0; k < 2; k++) {
        const ox = k === 1 ? HALF : -HALF;
        if (!this.line({ x: A.x + ox, y: A.y + oy }, { x: B.x + ox, y: B.y + oy })) return false;
      }
    }
    return true;
  }
  roomy(A, B) {
    const cl = this.clearance;
    if (cl === 0) return true;
    const d = unit(B.x - A.x, B.y - A.y);
    if (cl <= this.side(A, d) && cl <= this.side(B, d)) return cl <= this.across(A, B);
    return true;
  }
  across(P, Q) {
    const L = Math.hypot(Q.x - P.x, Q.y - P.y),
      d = unit(Q.x - P.x, Q.y - P.y);
    let m = this.clearance;
    for (let t = 0; t < L; t += 20) m = Math.min(this.side({ x: P.x + d[0] * t, y: P.y + d[1] * t }, d), m);
    return m;
  }
  side(P, d) {
    const w = this.clearance * 2,
      o = { d: 0 };
    this.line(P, { x: -d[1] * w + P.x, y: d[0] * w + P.y }, o);
    const one = o.d;
    o.d = 0;
    this.line(P, { x: P.x - -d[1] * w, y: P.y - d[0] * w }, o);
    return one + o.d;
  }
}

const SCRATCH = { d: 0 };
const cellOf = v => Math.trunc((HALF + v) / CELL);

function cross(px, py, ax, ay, aw, ah, bx, by, bw, bh, out) {
  if (ax === bx + bw || ax + aw === bx) {
    const lo = Math.max(ay, by),
      end = Math.min(ay + ah, by + bh);
    out[0] = bx <= ax ? bx + bw - 1 : bx;
    out[1] = py < lo ? lo : py > end - 1 ? end - 1 : py;
  } else {
    const lo = Math.max(ax, bx),
      end = Math.min(ax + aw, bx + bw);
    out[1] = by <= ay ? by + bh - 1 : by;
    out[0] = px < lo ? lo : px > end - 1 ? end - 1 : px;
  }
}

function grow(cb, ids, W1, p, maxW, maxH, left, up, out) {
  const v = cb[p],
    same = q => cb[q] === v && ids[q] === -1;
  let k = 1,
    h = 1,
    colB = false,
    rowB = false,
    cornerB = false,
    W = maxW,
    H = maxH,
    mode = 0;
  const settle = () => {
    W = k < maxW ? k : maxW;
    H = h < maxH ? h : maxH;
    mode = rowB ? (colB ? 0 : 1) : colB || cornerB ? 2 : 0;
  };
  if (maxW === 0) settle();
  else
    for (;;) {
      if (maxH < h) {
        settle();
        break;
      }
      for (let r = 0; r < h; r++)
        if (!same(p + r * W1 + k)) {
          colB = true;
          break;
        }
      let c = 0;
      for (; c < k; c++)
        if (!same(p + h * W1 + c)) {
          rowB = true;
          break;
        }
      if (!same(p + h * W1 + c)) cornerB = true;
      if (colB || cornerB) {
        if (rowB) {
          settle();
          break;
        }
        W = k < maxW ? k : maxW;
        H = h + 1 < maxH ? h + 1 : maxH;
        mode = 2;
        break;
      }
      k++;
      if (rowB) {
        W = k < maxW ? k : maxW;
        H = h < maxH ? h : maxH;
        mode = 1;
        break;
      }
      h++;
      if (!(k <= maxW)) {
        if (h < maxH) maxH = h;
        W = maxW;
        H = maxH;
        mode = 0;
        break;
      }
    }
  if (mode === 1) {
    let fail = false;
    for (;;) {
      if (!(W < H * 2)) break;
      if (maxW < W) break;
      if (fail) break;
      const q = p + W;
      if (up && ids[q - W1] !== ids[q - W1 + 1]) break;
      for (let r = 0; r < H; r++)
        if (!same(q + r * W1)) {
          fail = true;
          break;
        }
      if (!fail) W++;
    }
    if (maxW < W) W = maxW;
  } else if (mode === 2) {
    let fail = false;
    for (;;) {
      if (!(H < W * 2)) break;
      if (maxH < H) break;
      if (fail) break;
      const q = p + H * W1;
      if ((left && ids[q - 1] !== ids[q - 1 - W1]) || ids[q + W] !== ids[q + W - W1]) break;
      for (let c = 0; c < W; c++)
        if (!same(q + c)) {
          fail = true;
          break;
        }
      if (!fail) H++;
    }
    if (maxH < H) H = maxH;
  }
  if ((W === 2 && H === 1) || (W === 1 && H === 2)) {
    W = 1;
    H = 1;
  }
  out[0] = W;
  out[1] = H;
}

const unit = (x, y) => {
  const l = Math.hypot(x, y);
  return l > 0 ? [x / l, y / l] : [x, y];
};
const at = (pts, i) => pts[i < pts.length ? i : pts.length - 1];
function length(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}
function along(pts, dist) {
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i],
      b = pts[i + 1],
      l = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist <= l + acc) {
      let t = 0;
      if (l > 0) {
        const u = (dist - acc) / l;
        if (u >= 0) t = u <= 1 ? u : 1;
      }
      t = t < 0.0001 ? 0 : t > 0.9999 ? 1 : t;
      return { i, t, x: (b.x - a.x) * t + a.x, y: (b.y - a.y) * t + a.y };
    }
    acc += l;
  }
  if (pts.length === 1) return { i: 0, t: 0, x: pts[0].x, y: pts[0].y };
  const z = pts[pts.length - 1],
    y = pts[pts.length - 2],
    d = unit(z.x - y.x, z.y - y.y),
    over = dist - acc;
  return { i: pts.length - 1, t: 1, x: z.x + d[0] * over, y: z.y + d[1] * over };
}
function erase(pts, a, b) {
  const n = pts.length;
  if (!n) return;
  if (a >= n) a = n - 1;
  if (b >= n) b = n - 1;
  const lo = Math.min(a, b),
    hi = Math.max(a, b);
  if (lo !== hi) pts.splice(lo, hi - lo);
}
function insert(pts, p, i) {
  if (i < pts.length) pts.splice(i, 0, p);
  else pts.push(p);
}
