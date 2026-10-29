@external("env", "now") declare function now(): f64;
@external("env", "cos") declare function jcos(x: f64): f64;
@external("env", "sin") declare function jsin(x: f64): f64;
@external("env", "atan2") declare function jatan2(y: f64, x: f64): f64;

const MOVING: i32 = 1,
  STILL: i32 = 2,
  FIELD: i32 = 4;
const TAU: f64 = Math.PI * 2;

let P: usize = 0;
let SX: usize = 0,
  SY: usize = 0,
  SDX: usize = 0,
  SDY: usize = 0,
  SAX: usize = 0,
  SSD: usize = 0,
  SR: usize = 0,
  SF: usize = 0;
let TX: usize = 0,
  TY: usize = 0,
  TDX: usize = 0,
  TDY: usize = 0;
let THEAD: usize = 0,
  TLIST: usize = 0,
  TSTAMP: usize = 0;
let TAX: usize = 0,
  TSD: usize = 0,
  TR: usize = 0;
let NX: usize = 0,
  NY: usize = 0,
  NH: usize = 0,
  NT: usize = 0,
  NS: usize = 0,
  NG: usize = 0,
  NF: usize = 0;
let NOP: usize = 0,
  NP: usize = 0,
  NK: usize = 0,
  HEAP: usize = 0;
let HKEY: usize = 0,
  HGEN: usize = 0,
  HSHUT: usize = 0;
let HVAL: usize = 0;
let HMASK: i32 = 0,
  CAP: i32 = 0,
  gen: i32 = 0,
  irun: i32 = 0;

@inline function f(a: usize, i: i32): f64 {
  return load<f64>(a + ((<usize>i) << 3));
}
@inline function fs(a: usize, i: i32, v: f64): void {
  store<f64>(a + ((<usize>i) << 3), v);
}
@inline function g32(a: usize, i: i32): f32 {
  return load<f32>(a + ((<usize>i) << 2));
}
@inline function ii(a: usize, i: i32): i32 {
  return load<i32>(a + ((<usize>i) << 2));
}
@inline function is(a: usize, i: i32, v: i32): void {
  store<i32>(a + ((<usize>i) << 2), v);
}

export function setup(table: usize, hmask: i32, cap: i32): void {
  P = <usize>ii(table, 0);
  SX = <usize>ii(table, 1);
  SY = <usize>ii(table, 2);
  SDX = <usize>ii(table, 3);
  SDY = <usize>ii(table, 4);
  SAX = <usize>ii(table, 5);
  SSD = <usize>ii(table, 6);
  SR = <usize>ii(table, 7);
  SF = <usize>ii(table, 8);
  TX = <usize>ii(table, 9);
  TY = <usize>ii(table, 10);
  TDX = <usize>ii(table, 11);
  TDY = <usize>ii(table, 12);
  THEAD = <usize>ii(table, 13);
  TLIST = <usize>ii(table, 14);
  TSTAMP = <usize>ii(table, 15);
  TAX = <usize>ii(table, 16);
  TSD = <usize>ii(table, 17);
  TR = <usize>ii(table, 18);
  NX = <usize>ii(table, 19);
  NY = <usize>ii(table, 20);
  NH = <usize>ii(table, 21);
  NT = <usize>ii(table, 22);
  NS = <usize>ii(table, 23);
  NG = <usize>ii(table, 24);
  NF = <usize>ii(table, 25);
  NOP = <usize>ii(table, 26);
  NP = <usize>ii(table, 27);
  NK = <usize>ii(table, 28);
  HEAP = <usize>ii(table, 29);
  HKEY = <usize>ii(table, 30);
  HGEN = <usize>ii(table, 31);
  HSHUT = <usize>ii(table, 32);
  HVAL = <usize>ii(table, 33);
  HMASK = hmask;
  CAP = cap;
}

let ux: f64 = 0,
  uy: f64 = 0,
  gx: f64 = 0,
  gy: f64 = 0,
  uh: f64 = 0,
  qax: f64 = 0,
  qsd: f64 = 0,
  qr: f64 = 0;
let nStill: i32 = 0,
  nT: i32 = 0,
  S: i32 = 0,
  gw: i32 = 0,
  gh: i32 = 0,
  B: i32 = 0;
let TS: f64 = 0,
  TB: f64 = 0,
  TCELL: f64 = 0,
  wminx: f64 = 0,
  wminy: f64 = 0,
  wmaxx: f64 = 0,
  wmaxy: f64 = 0;

@inline function reach(ax: f64, sd: f64, dx: f64, dy: f64, ux_: f64, uy_: f64): f64 {
  const c = ux_ * dx + uy_ * dy,
    c2 = c * c;
  return c2 * ax + (1 - c2) * sd;
}

function touch(
  qdx: f64,
  qdy: f64,
  ax: f64,
  ay: f64,
  bx: f64,
  by: f64,
  eax: f64,
  esd: f64,
  edx: f64,
  edy: f64,
  ex0: f64,
  ey0: f64,
  ex1: f64,
  ey1: f64
): bool {
  const px = ax - ex0,
    py = ay - ey0,
    qx = bx - ex1,
    qy = by - ey1;
  let d0 = Math.sqrt(px * px + py * py);
  if (d0 == 0) d0 = 1;
  let d1 = Math.sqrt(qx * qx + qy * qy);
  if (d1 == 0) d1 = 1;
  const R0 = reach(eax, esd, edx, edy, px / d0, py / d0) + reach(qax, qsd, qdx, qdy, px / d0, py / d0);
  const R1 = reach(eax, esd, edx, edy, qx / d1, qy / d1) + reach(qax, qsd, qdx, qdy, qx / d1, qy / d1);
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

function sweep(ax: f64, ay: f64, bx: f64, by: f64, t0: f64, t1: f64): i32 {
  let bits: i32 = 0;
  let qdx = bx - ax,
    qdy = by - ay;
  const ql = Math.sqrt(qdx * qdx + qdy * qdy);
  if (ql > 1e-3) {
    qdx /= ql;
    qdy /= ql;
  } else {
    qdx = jcos(uh);
    qdy = jsin(uh);
  }
  const pad = qr;
  const minx = Math.min(ax, bx) - pad,
    maxx = Math.max(ax, bx) + pad,
    miny = Math.min(ay, by) - pad,
    maxy = Math.max(ay, by) + pad;
  for (let i = 0; i < nStill; i++) {
    const ex = f(SX, i),
      ey = f(SY, i),
      R = qr + f(SR, i);
    const px = ax - ex,
      py = ay - ey,
      vx = bx - ax,
      vy = by - ay,
      vv = vx * vx + vy * vy;
    let k = vv > 1e-9 ? -(px * vx + py * vy) / vv : 0.0;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const cx = px + vx * k,
      cy = py + vy * k;
    if (cx * cx + cy * cy > R * R) continue;
    const field = f(SF, i) != 0;
    if (
      field
        ? touch(qdx, qdy, ax, ay, bx, by, f(SAX, i), f(SSD, i), 1, 0, ex, ey, ex, ey)
        : touch(qdx, qdy, ax, ay, bx, by, f(SAX, i), f(SSD, i), f(SDX, i), f(SDY, i), ex, ey, ex, ey)
    )
      bits |= field ? FIELD : STILL;
    if (bits & STILL) break;
  }
  const run = ++irun;
  let b0 = <i32>Math.floor(t0 / TB);
  if (b0 < 0) b0 = 0;
  let b1 = <i32>Math.floor(t1 / TB);
  if (b1 > B - 1) b1 = B - 1;
  let c0 = <i32>Math.floor((minx - wminx) / TCELL) + 1;
  if (c0 < 0) c0 = 0;
  let c1 = <i32>Math.floor((maxx - wminx) / TCELL) + 1;
  if (c1 > gw - 1) c1 = gw - 1;
  let r0 = <i32>Math.floor((miny - wminy) / TCELL) + 1;
  if (r0 < 0) r0 = 0;
  let r1 = <i32>Math.floor((maxy - wminy) / TCELL) + 1;
  if (r1 > gh - 1) r1 = gh - 1;
  const j0f = Math.min(<f64>(S - 1), t0 / TS),
    j1f = Math.min(<f64>(S - 1), t1 / TS);
  const ja = <i32>Math.floor(j0f),
    fa = j0f - <f64>ja,
    jb = <i32>Math.floor(j1f),
    fb = j1f - <f64>jb;
  for (let b = b0; b <= b1; b++)
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        const c = (b * gh + cy) * gw + cx;
        for (let i = ii(THEAD, c), e = ii(THEAD, c + 1); i < e; i++) {
          const k = ii(TLIST, i);
          if (ii(TSTAMP, k) == run) continue;
          is(TSTAMP, k, run);
          const oa = k * S + ja,
            ob = k * S + jb,
            na = ja < S - 1 ? oa + 1 : oa,
            nb = jb < S - 1 ? ob + 1 : ob;
          const xa = <f64>g32(TX, oa),
            ya = <f64>g32(TY, oa),
            xb = <f64>g32(TX, ob),
            yb = <f64>g32(TY, ob);
          const ex0 = xa + (<f64>g32(TX, na) - xa) * fa,
            ey0 = ya + (<f64>g32(TY, na) - ya) * fa;
          const ex1 = xb + (<f64>g32(TX, nb) - xb) * fb,
            ey1 = yb + (<f64>g32(TY, nb) - yb) * fb;
          const px = ax - ex0,
            py = ay - ey0,
            vx = bx - ex1 - px,
            vy = by - ey1 - py,
            vv = vx * vx + vy * vy;
          let t = vv > 1e-9 ? -(px * vx + py * vy) / vv : 0.0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const R = qr + f(TR, k),
            cxx = px + vx * t,
            cyy = py + vy * t;
          if (cxx * cxx + cyy * cyy > R * R) continue;
          if (touch(qdx, qdy, ax, ay, bx, by, f(TAX, k), f(TSD, k), <f64>g32(TDX, ob), <f64>g32(TDY, ob), ex0, ey0, ex1, ey1))
            return bits | MOVING;
        }
      }
  return bits;
}

@inline function wrap(a: f64): f64 {
  a %= TAU;
  return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a;
}

let count: i32 = 0,
  hn: i32 = 0,
  pushed: i32 = 0;
let v: f64 = 0,
  om: f64 = 0,
  acc: f64 = 0,
  dec: f64 = 0,
  th: f64 = 0,
  step: f64 = 0,
  cell: f64 = 0,
  rr: f64 = 0,
  arcF: f64 = 0,
  arcS: f64 = 0,
  arcT: f64 = 0;
let slow: f64 = 0,
  near: f64 = 0,
  waitDist: f64 = 0,
  waitCost: f64 = 0,
  maxExp: f64 = 0,
  shipCost: f64 = 0,
  offMap: f64 = 0,
  ow: f64 = 0,
  cutoff: f64 = 0;
let N: i32 = 0,
  hardMask: i32 = 0,
  mapped: bool = false,
  op4: i32 = 0,
  op4hard: i32 = 0;

function heapPush(id: i32): void {
  let i = hn++;
  const fv = f(NF, id);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (f(NF, ii(HEAP, p)) <= fv) break;
    is(HEAP, i, ii(HEAP, p));
    i = p;
  }
  is(HEAP, i, id);
}
function heapPop(): i32 {
  const top = ii(HEAP, 0),
    last = ii(HEAP, --hn);
  if (hn) {
    const fv = f(NF, last);
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= hn) break;
      if (c + 1 < hn && f(NF, ii(HEAP, c + 1)) < f(NF, ii(HEAP, c))) c++;
      if (f(NF, ii(HEAP, c)) >= fv) break;
      is(HEAP, i, ii(HEAP, c));
      i = c;
    }
    is(HEAP, i, last);
  }
  return top;
}
@inline function slotOf(key: i32): i32 {
  let i = <i32>((<u32>key * 0x9e3779b1) & (<u32>HMASK));
  while (ii(HGEN, i) == gen && ii(HKEY, i) != key) i = (i + 1) & HMASK;
  return i;
}

function add(n: i32, op: i32, x: f64, y: f64, h: f64, dt: f64, s: f64, mult: f64): void {
  if (<f64>pushed > maxExp || dt < 0) return;
  let cost = dt * mult;
  if (x < wminx || x > wmaxx || y < wminy || y > wmaxy) {
    const dx = x - ux,
      dy = y - uy;
    if (mapped && Math.sqrt(dx * dx + dy * dy) > near) return;
    cost *= offMap;
  }
  const t0 = f(NT, n),
    bits = sweep(f(NX, n), f(NY, n), x, y, t0, t0 + dt);
  if (bits & hardMask) {
    const dx = x - ux,
      dy = y - uy;
    if (op == 4 || Math.sqrt(dx * dx + dy * dy) > near) {
      if (op == 4) op4hard++;
      return;
    }
  }
  if (op == 4) op4++;
  if (bits) cost *= shipCost;
  const gg = f(NG, n) + cost;
  let key: i32 = -1;
  if (op == 0 || op == 2 || op == 3 || op == 4) {
    const hb = <i32>Math.floor(((((h % TAU) + TAU) % TAU) / TAU) * <f64>N);
    key = ((<i32>Math.floor((x - ux) / cell) + 2048) * 4096 + (<i32>Math.floor((y - uy) / cell) + 2048)) * 64 + hb;
    const sl = slotOf(key);
    if (ii(HGEN, sl) == gen) {
      if (ii(HSHUT, sl) || f(HVAL, sl) <= gg) return;
      fs(HVAL, sl, gg);
    } else {
      is(HGEN, sl, gen);
      is(HKEY, sl, key);
      fs(HVAL, sl, gg);
      is(HSHUT, sl, 0);
    }
  }
  if (count >= CAP) return;
  pushed++;
  const id = count++,
    t = t0 + dt,
    wh = ow > 1 && t * v < cutoff ? ow : 1.0;
  fs(NX, id, x);
  fs(NY, id, y);
  fs(NH, id, h);
  is(NOP, id, op);
  fs(NT, id, t);
  fs(NS, id, s);
  is(NP, id, n);
  fs(NG, id, gg);
  is(NK, id, key);
  const ddx = gx - x,
    ddy = gy - y;
  fs(NF, id, gg + (wh * Math.sqrt(ddx * ddx + ddy * ddy)) / v);
  heapPush(id);
}

export function search(): i32 {
  ux = f(P, 0);
  uy = f(P, 1);
  gx = f(P, 2);
  gy = f(P, 3);
  uh = f(P, 4);
  qax = f(P, 5);
  qsd = f(P, 6);
  qr = f(P, 7);
  nStill = <i32>f(P, 8);
  nT = <i32>f(P, 9);
  S = <i32>f(P, 10);
  gw = <i32>f(P, 11);
  gh = <i32>f(P, 12);
  B = <i32>f(P, 13);
  TS = f(P, 14);
  TB = f(P, 15);
  TCELL = f(P, 16);
  wminx = f(P, 17);
  wminy = f(P, 18);
  wmaxx = f(P, 19);
  wmaxy = f(P, 20);
  v = f(P, 21);
  om = f(P, 22);
  acc = f(P, 23);
  dec = f(P, 24);
  N = <i32>f(P, 25);
  th = f(P, 26);
  step = f(P, 27);
  cell = f(P, 28);
  rr = f(P, 29);
  arcF = f(P, 30);
  arcS = f(P, 31);
  arcT = f(P, 32);
  slow = f(P, 33);
  near = f(P, 34);
  waitDist = f(P, 35);
  waitCost = f(P, 36);
  maxExp = f(P, 37);
  hardMask = <i32>f(P, 38);
  shipCost = f(P, 39);
  offMap = f(P, 40);
  ow = f(P, 41);
  cutoff = f(P, 42);
  mapped = f(P, 43) != 0;
  const startS = f(P, 44),
    until = f(P, 45);
  const nTurns = <i32>f(P, 46),
    turn0 = f(P, 47),
    turn1 = f(P, 48),
    FRAME = f(P, 49),
    dist0 = f(P, 50);
  const gcx = <i32>Math.floor((gx - ux) / cell),
    gcy = <i32>Math.floor((gy - uy) / cell);
  gen++;
  count = 0;
  hn = 0;
  pushed = 0;
  op4 = 0;
  op4hard = 0;
  fs(NX, 0, ux);
  fs(NY, 0, uy);
  fs(NH, 0, uh);
  is(NOP, 0, -1);
  fs(NT, 0, 0);
  fs(NS, 0, startS);
  is(NP, 0, -1);
  fs(NG, 0, 0);
  fs(NF, 0, dist0 / v);
  is(NK, 0, -1);
  count = 1;
  heapPush(0);
  let found: i32 = -1,
    best: f64 = Infinity,
    bestNode: i32 = -1,
    pops: i32 = 0;
  const wd = waitDist;
  while (hn && <f64>pushed <= maxExp) {
    if ((pops & 255) == 255 && until > 0 && now() > until) break;
    const n = heapPop();
    pops++;
    const nx = f(NX, n),
      ny = f(NY, n),
      nh = f(NH, n),
      ns = f(NS, n),
      nop = ii(NOP, n);
    const ddx = gx - nx,
      ddy = gy - ny,
      dGoal = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dGoal < best) {
      best = dGoal;
      bestNode = n;
    }
    if (nop == 4 && <i32>Math.floor((nx - ux) / cell) == gcx && <i32>Math.floor((ny - uy) / cell) == gcy) {
      found = n;
      break;
    }
    const nk = ii(NK, n);
    if (nk >= 0) {
      const sl = slotOf(nk);
      if (ii(HGEN, sl) == gen) {
        if (ii(HSHUT, sl)) continue;
        is(HSHUT, sl, 1);
      }
    }
    const full = Math.abs(ns - v) < 1e-3,
      isSlow = Math.abs(ns - slow) < 1e-3,
      ch = jcos(nh),
      sh = jsin(nh);
    if (nop == 6) {
      if (isSlow) add(n, 7, nx + ch * wd, ny + sh * wd, nh, wd / slow, slow, waitCost);
      continue;
    }
    if (nop == 7) {
      add(n, 7, nx + ch * wd, ny + sh * wd, nh, wd / slow, slow, waitCost);
      const dd = (v * v - ns * ns) / (2 * acc);
      add(n, 5, nx + ch * dd, ny + sh * dd, nh, (v - ns) / acc, v, 1);
      continue;
    }
    if (nop == 1) add(n, 4, gx, gy, jatan2(gy - ny, gx - nx), dGoal / v, v, 0.98);
    if (full) {
      const L = Math.min(dGoal, step);
      if (L > 1) add(n, 0, nx + ch * L, ny + sh * L, nh, L / v, v, 1);
      const phi = wrap(jatan2(gy - ny, gx - nx) - nh);
      if (Math.abs(phi) <= th && nop != 1) {
        const a = Math.abs(phi),
          sg: f64 = phi > 0 ? 1 : phi < 0 ? -1 : 1,
          fw = rr * jsin(a),
          sd = rr * (1 - jcos(a)) * sg;
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
    if (n == 0) {
      if (nTurns > 0) add(n, 8, nx, ny, turn0, Math.abs(wrap(turn0 - nh)) / om, 0, 1);
      if (nTurns > 1) add(n, 9, nx, ny, turn1, Math.abs(wrap(turn1 - nh)) / om, 0, 1);
    }
  }
  fs(P, 60, <f64>pops);
  fs(P, 61, <f64>pushed);
  fs(P, 62, best);
  fs(P, 63, <f64>bestNode);
  fs(P, 64, <f64>op4);
  fs(P, 65, <f64>op4hard);
  fs(P, 66, <f64>count);
  return found;
}

export function sweepOnly(ax: f64, ay: f64, bx: f64, by: f64, t0: f64, t1: f64): i32 {
  ux = f(P, 0);
  uy = f(P, 1);
  uh = f(P, 4);
  qax = f(P, 5);
  qsd = f(P, 6);
  qr = f(P, 7);
  nStill = <i32>f(P, 8);
  nT = <i32>f(P, 9);
  S = <i32>f(P, 10);
  gw = <i32>f(P, 11);
  gh = <i32>f(P, 12);
  B = <i32>f(P, 13);
  TS = f(P, 14);
  TB = f(P, 15);
  TCELL = f(P, 16);
  wminx = f(P, 17);
  wminy = f(P, 18);
  wmaxx = f(P, 19);
  wmaxy = f(P, 20);
  return sweep(ax, ay, bx, by, t0, t1);
}
