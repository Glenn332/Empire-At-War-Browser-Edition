import { db } from '../gamedata.js';
import { simRandom } from './simrandom.js';
import { CELL } from './terrain.js';
import { TERRAIN } from './landtables.js';

const FPS = 30;
const CLASSES = {
  'LANDING TRANSPORT': 0,
  'BUILD PAD': 1,
  'LOW OBSTACLE': 2,
  'MEDIUM OBSTACLE': 3,
  'HIGH OBSTACLE': 4,
  INFANTRY: 5,
  BIKE: 6,
  VEHICLE: 7,
  'LARGE VEHICLE': 8,
  'GIANT VEHICLE': 9
};
export const collisionClass = t => CLASSES[t.str('UnitCollisionClass').trim().toUpperCase()] ?? -1;

const MM = { NONE: 0, PATH_AROUND: 1, SPEED_SLAVE: 2, PASS: 4, SPEED_ONLY: 6, THROUGH: 7, RESOLVED: 8, LATER: 10 };
const MS = { NONE: 0, PATH_AROUND: 1, THROUGH: 4, RESOLVED: 5, LATER: 7, ATTACK: 8 };
const SS = { START: 0, MOVING: 1, DONE: 2, GONE: 3, WAIT: 4 };

const K = { least: 0.15, quota: 100, near: 20, past: 60, pad: 3, penalty: 15, predict: 2 };

function readConstants() {
  const c = db.constants;
  K.least = c.num('MinimumStoppedVsStoppedOverlapCoefficient', 0.15);
  K.quota = c.num('DynamicLandComplexityQuota', 100);
  K.near = c.num('LandTemporaryDestinationProximity', 20);
  K.past = c.num('LandDestinationProximity', 60);
  K.pad = c.num('DynamicAvoidanceRectangleBound', 3);
  K.penalty = c.num('DynamicObstacleOverlapPenalty', 15);
  K.predict = c.num('LandPredictionTimeInterval', 2);
}

let BODY_ID = 0;
export function resetCollideIds() {
  BODY_ID = 0;
}

function standing(W, u) {
  const cls = (u.ccls ??= collisionClass(u.type));
  if (cls < 0 || cls === 1 || u.inside || u.scriptHidden) return null;
  if (cls <= 4 && W.kind) {
    const n = W.n,
      ix = Math.round(u.x / CELL),
      iy = Math.round(u.y / CELL);
    if (ix >= 0 && iy >= 0 && ix < n && iy < n && W.kind[iy * n + ix] & (TERRAIN.STEEP | TERRAIN.WATER)) return null;
  }
  const t = u.type,
    s = t.num('Scale_Factor', 1) || 1,
    b =
      u.cb ||
      (u.cb = {
        id: ++BODY_ID,
        u,
        q: null,
        cls,
        fixed: true,
        hx: t.num('Custom_Hard_XExtent', 0) * s || u.body || 10,
        hy: t.num('Custom_Hard_YExtent', 0) * s || u.body || 10,
        ox: t.num('Custom_Hard_XExtent_Offset', 0) * s,
        oy: t.num('Custom_Hard_YExtent_Offset', 0) * s,
        r: 0,
        mpi: 0,
        spacing: 0,
        expand: 0,
        turn: 0,
        path: [],
        v: 0,
        max: 0,
        min: 0,
        moving: false,
        need: 2,
        form: null
      }),
    c = Math.cos(u.heading),
    sn = Math.sin(u.heading);
  b.x = u.x + c * b.ox - sn * b.oy;
  b.y = u.y + sn * b.ox + c * b.oy;
  b.h = u.heading;
  b.r ||= Math.hypot(b.hx, b.hy);
  b.side = u.side;
  return b;
}

export function collides(W, a, b) {
  if (a.fixed && b.fixed) return false;
  const p = a.cls,
    q = b.cls;
  if (p === 1 || q === 1) {
    const A = unitOf(a),
      B = unitOf(b);
    return !(p === 1 ? b : a).fixed && !!A && !!B && !W.ally(A.side, B.side);
  }
  const other = k => (p === k ? q : p);
  if (p === 2 || q === 2) return other(2) === 5;
  if (p === 3 || q === 3) return other(3) >= 5 && other(3) <= 8;
  if (p === 4 || q === 4) return other(4) >= 5 && other(4) <= 9;
  return true;
}

function gather(W) {
  const out = [];
  for (const u of W.units) {
    if (u.structure && !u.dead && !u.flies && !u.squad?.craft) {
      const b = standing(W, u);
      if (b) out.push(b);
      continue;
    }
    if (u.dead || u.structure || u.flies || u.inside || u.flight || u.rope || u.cinematicTransport || u.scriptHidden || !u.squad) continue;
    if (u.squad.box && u.slot) continue;
    const cls = (u.ccls ??= collisionClass(u.type));
    if (cls < 5) continue;
    const b =
      u.cb ||
      (u.cb = {
        id: ++BODY_ID,
        u,
        q: null,
        cls,
        hx: u.type.num('Custom_Hard_XExtent', 0) * (u.type.num('Scale_Factor', 1) || 1) || u.body || 10,
        hy: u.type.num('Custom_Hard_YExtent', 0) * (u.type.num('Scale_Factor', 1) || 1) || u.body || 10,
        r: 0,
        mpi: u.type.num('MovementPredictionInterval', 0),
        spacing: u.type.num('FormationSpacing', 0),
        expand: u.type.num('MovementBoxExpansionFactor', 0),
        turn: u.stopTurn || u.turn || 0
      });
    b.x = u.x;
    b.y = u.y;
    b.h = u.heading;
    b.r ||= Math.hypot(b.hx, b.hy);
    b.path = u.path;
    b.side = u.side;
    b.v = u.v || 0;
    b.max = u.rooted || u.stunUntil > W.time ? 0 : (u.squad.formSpeed ? Math.min(u.speed, u.squad.formSpeed.v) : u.speed) * W.paceOf(u);
    b.min = b.max * Math.min(1, (u.minFrac ??= u.type.num('Min_Speed', 0) / (u.type.num('Max_Speed', 0) || 1)));
    b.moving = b.path.length > 0 && b.max > 0;
    b.need = u.need || 2;
    b.form = u.squad.formMove || null;
    out.push(b);
  }
  for (const q of W.squads) {
    const box = q.box;
    if (!box || !q.members.length || q.dead) continue;
    const u = q.members.find(m => !m.dead && !m.inside);
    if (!u || u.flies) continue;
    const b =
      q.cb ||
      (q.cb = {
        id: ++BODY_ID,
        u: null,
        q,
        cls: 5,
        mpi: u.type.num('MovementPredictionInterval', 0) || (q.type ? q.type.num('MovementPredictionInterval', 0) : 0),
        spacing: u.type.num('FormationSpacing', 0),
        expand: u.type.num('MovementBoxExpansionFactor', 0),
        turn: u.stopTurn || u.turn || 0
      });
    b.x = box.x;
    b.y = box.y;
    b.h = box.heading;
    b.path = box.path;
    b.side = u.side;
    b.v = box.speed || 0;
    b.hx = box.hl;
    b.hy = box.hs;
    b.r = Math.hypot(b.hx, b.hy);
    b.max = q.formSpeed ? Math.min(box.max, q.formSpeed.v) : box.max;
    b.min = b.max * Math.min(1, (q.minFrac ??= u.type.num('Min_Speed', 0) / (u.type.num('Max_Speed', 0) || 1)));
    b.moving = !q.ext && b.path.length > 0;
    b.need = u.need || 1;
    b.form = q.formMove || null;
    b.lead = u;
    out.push(b);
  }
  return out;
}

const unitOf = b => b.u || b.lead;
const cosH = b => Math.cos(b.h),
  sinH = b => Math.sin(b.h);
function reach(b, dx, dy, h = b.h) {
  const c = Math.cos(h) * dx + Math.sin(h) * dy,
    k = c * c;
  return (1 - k) * b.hy + k * b.hx;
}
const radius = b => b.r;

function crushes(W, a, b) {
  const A = unitOf(a),
    B = unitOf(b);
  return !!A && !!B && W.enemy(A, B) && !!A.crusher && (!!B.squashable || (!!A.supercrusher && !!B.squashableBig));
}

function along(b, v, t) {
  let x = b.x,
    y = b.y,
    h = b.h,
    left = v * t;
  for (const p of b.path) {
    const dx = p.x - x,
      dy = p.y - y,
      d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    h = Math.atan2(dy, dx);
    if (left <= d) return { x: x + (dx / d) * left, y: y + (dy / d) * left, h };
    x = p.x;
    y = p.y;
    left -= d;
  }
  return { x, y, h };
}

function willMeet(a, b, T) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = Math.hypot(dx, dy) || 1;
  const va = a.moving ? ((Math.cos(a.h) * dx + Math.sin(a.h) * dy) / d >= 0 ? a.max : a.v) : 0;
  const vb = b.moving ? ((Math.cos(b.h) * dx + Math.sin(b.h) * dy) / d <= 0 ? b.max : b.v) : 0;
  const step = 2 / FPS;
  for (let t = 0; t <= T + 1e-6; t += step) {
    const A = va > 0 ? along(a, va, t) : a,
      B = vb > 0 ? along(b, vb, t) : b;
    const ex = B.x - A.x,
      ey = B.y - A.y,
      e = Math.hypot(ex, ey);
    if (e < 1e-6) return true;
    if (e < reach(a, ex / e, ey / e, A.h) + reach(b, ex / e, ey / e, B.h)) return true;
  }
  return false;
}

function runsInto(a, b, far) {
  let x = a.x,
    y = a.y,
    h = a.h,
    gone = 0;
  const hit = (px, py, ph) => {
    const ex = b.x - px,
      ey = b.y - py,
      e = Math.hypot(ex, ey);
    return e < 1e-6 || e < reach(a, ex / e, ey / e, ph) + reach(b, -ex / e, -ey / e);
  };
  if (hit(x, y, h)) return 0;
  for (const p of a.path) {
    const dx = p.x - x,
      dy = p.y - y,
      d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    h = Math.atan2(dy, dx);
    for (let s = Math.min(4, d); ; s = Math.min(d, s + 4)) {
      if (hit(x + (dx / d) * s, y + (dy / d) * s, h)) return gone + s;
      if (gone + s >= far) return -1;
      if (s >= d) break;
    }
    x = p.x;
    y = p.y;
    gone += d;
  }
  return -1;
}

function holdOff(a, b, T) {
  const vmax = a.max,
    vmin = Math.min(vmax, a.min || 0);
  let dx = b.x - a.x,
    dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  const away = (b.moving ? b.v : 0) * (Math.cos(b.h) * dx + Math.sin(b.h) * dy);
  const toward = vmax * (Math.cos(a.h) * -dx + Math.sin(a.h) * -dy);
  if (toward + away >= 0) return vmax;
  const gap = Math.max(0, d - reach(a, dx, dy) - reach(b, -dx, -dy));
  const t = gap / -(toward + away);
  const follow = toward !== 0 ? Math.max(vmin, Math.min(vmax, Math.abs(away / toward) * vmax * 0.8)) : 0;
  const k = Math.max(0, Math.min(1, t / T));
  if (away > 0) return gap <= 0 ? 0 : follow + (vmax - follow) * k;
  return vmin + (vmax - vmin) * k;
}

function laneSpeed(a, b, T) {
  const dot = Math.cos(a.h) * Math.cos(b.h) + Math.sin(a.h) * Math.sin(b.h);
  if (Math.abs(dot) >= 0.9848) {
    const side = Math.abs(-Math.sin(a.h) * (b.x - a.x) + Math.cos(a.h) * (b.y - a.y));
    if (side >= a.hy + b.hy) return a.max;
  }
  return holdOff(a, b, T);
}

function relation(a, b) {
  if (a.max <= 0) return 2;
  const dot = Math.cos(a.h) * Math.cos(b.h) + Math.sin(a.h) * Math.sin(b.h);
  if (dot > 0.5) return a.max < b.max ? 0x20 : 0x10;
  const ahead = Math.cos(a.h) * (b.x - a.x) + Math.sin(a.h) * (b.y - a.y);
  if (ahead >= b.hy) return dot <= -0.5 ? 4 : 8;
  return 0x10;
}

function canPass(a, b) {
  if (a.cls === 9 || !a.max) return false;
  const vb = Math.min(b.max, a.max * 0.5);
  if (a.max - vb <= 0) return false;
  let left = 0,
    x = a.x,
    y = a.y;
  for (const p of a.path) {
    left += Math.hypot(p.x - x, p.y - y);
    x = p.x;
    y = p.y;
  }
  const need = (radius(a) + radius(b) + Math.hypot(b.x - a.x, b.y - a.y)) / (a.max - vb);
  return need <= left / a.max;
}

const COS44 = Math.cos((44 * Math.PI) / 180);

function boxOf(b, grow) {
  return { x: b.x, y: b.y, c: Math.cos(b.h), s: Math.sin(b.h), hx: b.hx + grow, hy: b.hy + grow, o: b, motion: 0, outer: null };
}

function inBox(B, x, y) {
  const dx = x - B.x,
    dy = y - B.y;
  return Math.abs(dx * B.c + dy * B.s) <= B.hx && Math.abs(-dx * B.s + dy * B.c) <= B.hy;
}

function segHitsBox(B, ax, ay, bx, by) {
  const px = ax - B.x,
    py = ay - B.y,
    qx = bx - B.x,
    qy = by - B.y;
  const u0 = px * B.c + py * B.s,
    u1 = qx * B.c + qy * B.s,
    v0 = -px * B.s + py * B.c,
    v1 = -qx * B.s + qy * B.c;
  if (Math.max(u0, u1) < -B.hx || Math.min(u0, u1) > B.hx || Math.max(v0, v1) < -B.hy || Math.min(v0, v1) > B.hy) return false;
  const nx = -(by - ay),
    ny = bx - ax,
    off = Math.abs(nx * (B.x - ax) + ny * (B.y - ay)),
    span = B.hx * Math.abs(nx * B.c + ny * B.s) + B.hy * Math.abs(-nx * B.s + ny * B.c);
  return off <= span;
}

function rayIntoBox(B, x, y, dx, dy) {
  const px = x - B.x,
    py = y - B.y,
    p = [px * B.c + py * B.s, -px * B.s + py * B.c],
    d = [dx * B.c + dy * B.s, -dx * B.s + dy * B.c],
    h = [B.hx, B.hy];
  let t0 = 0,
    t1 = Infinity;
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-9) {
      if (p[k] < -h[k] || p[k] > h[k]) return -1;
      continue;
    }
    let a = (-h[k] - p[k]) / d[k],
      b = (h[k] - p[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  return t0;
}

function motionOf(o, s) {
  if (!o.moving) return 0;
  if (!(o.max > 0)) return 2;
  const dot = Math.cos(o.h) * Math.cos(s.h) + Math.sin(o.h) * Math.sin(s.h);
  if (dot > 0.5) return o.max < s.max ? 0x20 : 0x10;
  const ahead = Math.cos(o.h) * (s.x - o.x) + Math.sin(o.h) * (s.y - o.y);
  if (ahead > s.hx) return dot <= -0.5 ? 4 : 8;
  return 0x10;
}

function pathLength(b) {
  let x = b.x,
    y = b.y,
    len = 0;
  for (const p of b.path) {
    len += Math.hypot(p.x - x, p.y - y);
    x = p.x;
    y = p.y;
  }
  return len;
}

function pointOnPath(b, at) {
  let x = b.x,
    y = b.y,
    gone = 0;
  for (let i = 0; i < b.path.length; i++) {
    const p = b.path[i],
      d = Math.hypot(p.x - x, p.y - y);
    if (gone + d >= at && d > 1e-6) {
      const k = (at - gone) / d;
      return { x: x + (p.x - x) * k, y: y + (p.y - y) * k, next: i };
    }
    gone += d;
    x = p.x;
    y = p.y;
  }
  return null;
}

function sweptBox(s, o, grow, T) {
  const B = boxOf(o, 1),
    motion = motionOf(o, s);
  B.motion = motion;
  if (motion && o.max > 0) {
    const dx = o.x - s.x,
      dy = o.y - s.y,
      d = Math.hypot(dx, dy) || 1,
      ux = dx / d,
      uy = dy / d,
      close = (s.moving ? s.max : 0) * (Math.cos(s.h) * ux + Math.sin(s.h) * uy) - o.max * (Math.cos(o.h) * ux + Math.sin(o.h) * uy);
    const t = close > 0 ? Math.max(0, Math.min(T, (d - radius(s) - radius(o)) / close)) : T;
    let far = t * o.max;
    if (motion === 0x10 || motion === 0x20) far = Math.min(far, pathLength(o));
    if (far > 1e-3) {
      const e = along(o, 1, far),
        ex = e.x - o.x,
        ey = e.y - o.y,
        el = Math.hypot(ex, ey);
      if (el > 1e-3) {
        const c = ex / el,
          sn = ey / el;
        let side = 0;
        for (const p of o.path) {
          const k = (p.x - o.x) * c + (p.y - o.y) * sn;
          if (k > el) break;
          side = Math.max(side, Math.abs(-(p.x - o.x) * sn + (p.y - o.y) * c));
        }
        B.x = o.x + ex / 2;
        B.y = o.y + ey / 2;
        B.c = c;
        B.s = sn;
        B.hx = reach(o, c, sn) + 1 + el / 2;
        B.hy = reach(o, -sn, c) + 1 + side;
      }
    }
  } else if (o.path.length === 2 && o.path[0].x === o.path[1].x && o.path[0].y === o.path[1].y) B.hx = B.hy = Math.max(B.hx, B.hy);
  B.hx += grow;
  B.hy += grow;
  return B;
}

function ringNext(W, s, q) {
  const R = radius(s) || 1;
  while (q.ring < 20) {
    let n = Math.floor((q.r * 2 * Math.PI) / R) + 1;
    if (q.ring && n < 4) n = 4;
    while (q.k < n) {
      const th = (q.k++ / n) * 2 * Math.PI,
        x = q.x + Math.cos(th + s.h) * q.r,
        y = q.y + Math.sin(th + s.h) * q.r;
      if (!W.isOpen(x, y, s.need)) continue;
      if (q.close && q.close.some(o => footHit(o, x, y, q.half))) continue;
      return { x, y };
    }
    q.k = 0;
    q.r += q.step;
    q.step = Math.min(Math.min(10, R * 1.5 || 5), q.step + 0.8);
    q.ring++;
  }
  return null;
}

const ringAt = (x, y) => ({ x, y, r: 0, step: 1, ring: 0, k: 0, close: null, half: 0 });

function boxesMeet(A, B) {
  const dx = B.x - A.x,
    dy = B.y - A.y;
  for (const [nx, ny] of [
    [A.c, A.s],
    [-A.s, A.c],
    [B.c, B.s],
    [-B.s, B.c]
  ]) {
    const ra = A.hx * Math.abs(A.c * nx + A.s * ny) + A.hy * Math.abs(-A.s * nx + A.c * ny),
      rb = B.hx * Math.abs(B.c * nx + B.s * ny) + B.hy * Math.abs(-B.s * nx + B.c * ny);
    if (Math.abs(dx * nx + dy * ny) > ra + rb) return false;
  }
  return true;
}

function footFree(W, s, f, end, prev, m, flags, linked) {
  let dx = f.x - end.x,
    dy = f.y - end.y,
    d = Math.hypot(dx, dy);
  if (d < 1e-9) {
    dx = Math.cos(s.h);
    dy = Math.sin(s.h);
    d = 1;
  }
  const F = { x: f.x, y: f.y, c: dx / d, s: dy / d, hx: s.hx, hy: s.hy };
  if (prev) {
    for (const B of prev) if (B.o !== s && boxesMeet(F, B) && !ignored(W, s, B.o, m, flags, linked, 0x10)) return false;
    return true;
  }
  const far = s.r;
  for (const o of W.ccBodies) {
    if (o === s || o === s.own || Math.abs(o.x - f.x) > far + o.r || Math.abs(o.y - f.y) > far + o.r) continue;
    if (boxesMeet(F, boxOf(o, 0)) && !ignored(W, s, o, m, flags, linked, 0x10)) return false;
  }
  return true;
}

function routeOk(W, s, a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d <= 0) return true;
  const way = W.route(a.x, a.y, b.x, b.y, s.need);
  if (!way) return false;
  let wl = 0,
    x = a.x,
    y = a.y;
  for (const q of way) {
    wl += Math.hypot(q.x - x, q.y - y);
    x = q.x;
    y = q.y;
  }
  return wl <= 2 * d + 1e-6;
}

function rejoin(W, s, at, m, flags, linked, prev) {
  const len = pathLength(s),
    end = s.path[s.path.length - 1],
    spot = (x, y) => ringNext(W, s, ringAt(x, y)),
    good = (f, x, y) => !!f && Math.hypot(f.x - x, f.y - y) <= K.near && footFree(W, s, f, end, prev, m, flags, linked);
  while (at.s < len) {
    const p = pointOnPath(s, at.s);
    at.s += 10;
    if (!p) break;
    const f = spot(p.x, p.y);
    if (good(f, p.x, p.y)) return { x: f.x, y: f.y, next: p.next };
  }
  const before = s.path.length > 1 ? s.path[s.path.length - 2] : s,
    t = targetOf(s);
  let dx = t ? t.x - end.x : end.x - before.x,
    dy = t ? t.y - end.y : end.y - before.y;
  const dl = Math.hypot(dx, dy),
    most = t ? dl : K.past;
  if (dl > 1e-6) {
    dx /= dl;
    dy /= dl;
  } else dx = dy = 0;
  while (dl > 1e-6 && at.s - len < most) {
    const k = at.s - len,
      x = end.x + dx * k,
      y = end.y + dy * k;
    at.s += 10;
    const f = spot(x, y),
      ok = good(f, x, y);
    if (!routeOk(W, s, end, f || { x, y })) break;
    if (ok) return { x: f.x, y: f.y, next: s.path.length };
  }
  if (!at.ring) {
    at.ring = ringAt(end.x, end.y);
    at.ring.half = radius(s) + Math.max(s.spacing * 6, radius(s) * 0.25);
    const most = 20 * 10 + at.ring.half;
    at.ring.close = W.ccBodies.filter(
      o => o !== s && o !== s.own && Math.abs(o.x - end.x) <= most + o.r && Math.abs(o.y - end.y) <= most + o.r
    );
  }
  let f;
  do {
    f = ringNext(W, s, at.ring);
    if (!f) return null;
  } while ((f.x - end.x) * dx + (f.y - end.y) * dy < -0.001);
  return routeOk(W, s, end, f) ? { x: f.x, y: f.y, next: s.path.length } : null;
}

function cellWindow(W, s, goal, grow) {
  const n = W.n,
    cell = CELL,
    pad = K.pad + (s.cls === 9 ? 2 : 0);
  let x0 = Math.min(Math.round(s.x / cell), Math.round(goal.x / cell)) - pad,
    x1 = Math.max(Math.round(s.x / cell), Math.round(goal.x / cell)) + pad,
    y0 = Math.min(Math.round(s.y / cell), Math.round(goal.y / cell)) - pad,
    y1 = Math.max(Math.round(s.y / cell), Math.round(goal.y / cell)) + pad;
  const r = (x1 - x0 + 1) / (y1 - y0 + 1);
  if (r > 1.5) {
    const k = Math.trunc(r - 0.5);
    y0 -= k;
    y1 += k;
  } else if (r < 2 / 3) {
    const k = Math.trunc(1 / r - 0.5);
    x0 -= k;
    x1 += k;
  }
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(n - 1, x1);
  y1 = Math.min(n - 1, y1);
  if (x1 < x0 || y1 < y0) return null;
  return { x0: x0 - grow * pad, y0: y0 - grow * pad, x1: x1 + grow * pad, y1: y1 + grow * pad };
}

function widenWindow(W, s, win, bodies) {
  const cell = CELL,
    half = Math.max(s.hx, s.hy);
  const busy = (ax, ay, bx, by) =>
    bodies.some(o => o !== s && o.x + radius(o) >= ax && o.x - radius(o) <= bx && o.y + radius(o) >= ay && o.y - radius(o) <= by);
  for (;;) {
    if (win.x1 - win.x0 + 1 >= 20 && win.y1 - win.y0 + 1 >= 20) return;
    const X0 = win.x0 * cell,
      X1 = win.x1 * cell,
      Y0 = win.y0 * cell,
      Y1 = win.y1 * cell;
    if (busy(X0, Y0 - 10 - half, X1, Y0 - 10 + half)) win.y0--;
    else if (busy(X0, Y1 + 10 - half, X1, Y1 + 10 + half)) win.y1++;
    else if (busy(X0 - 10 - half, Y0, X0 - 10 + half, Y1)) win.x0--;
    else if (busy(X1 + 10 - half, Y0, X1 + 10 + half, Y1)) win.x1++;
    else return;
  }
}

const NB = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1]
];

function terrainCorners(W, s, win, goal) {
  const n = W.n,
    room = W.rooms(s.need),
    wide = s.need & 3,
    w = win.x1 - win.x0 + 1,
    h = win.y1 - win.y0 + 1,
    W4 = w + 4,
    ok = new Uint8Array(W4 * (h + 4)),
    seen = new Uint8Array(W4 * (h + 4)),
    at = (x, y) => (y - win.y0 + 2) * W4 + x - win.x0 + 2;
  for (let y = Math.max(0, win.y0); y <= Math.min(n - 1, win.y1); y++)
    for (let x = Math.max(0, win.x0); x <= Math.min(n - 1, win.x1); x++) if (room[y * n + x] >= wide) ok[at(x, y)] = 1;
  const sx = Math.round(s.x / CELL),
    sy = Math.round(s.y / CELL);
  if (sx < win.x0 || sx > win.x1 || sy < win.y0 || sy > win.y1 || !ok[at(sx, sy)]) return null;
  const stack = [at(sx, sy)],
    step = [1, W4, -1, -W4];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop();
    for (let k = 0; k < 4; k++) {
      const j = i + step[k];
      if (!ok[j] || seen[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  const gx = Math.round(goal.x / CELL),
    gy = Math.round(goal.y / CELL);
  if (gx < win.x0 || gx > win.x1 || gy < win.y0 || gy > win.y1 || !seen[at(gx, gy)]) return null;
  const nb = NB.map(([dx, dy]) => dy * W4 + dx),
    masks = new Int16Array(W4 * (h + 4));
  for (let y = win.y0 - 1; y <= win.y1 + 1; y++)
    for (let x = win.x0 - 1; x <= win.x1 + 1; x++) {
      const i = at(x, y);
      let m = 0;
      for (let k = 0; k < 8; k++) if (!ok[i + nb[k]]) m |= 1 << k;
      masks[i] = m;
    }
  const isCorner = m =>
    (m & 0xd0) === 0x80 ||
    (m & 0x68) === 0x20 ||
    (m & 0x0b) === 0x01 ||
    (m & 0x16) === 0x04 ||
    (m & 0x50) === 0x50 ||
    (m & 0x48) === 0x48 ||
    (m & 0x0a) === 0x0a ||
    (m & 0x12) === 0x12;
  const corner = i => seen[i] === 1 && isCorner(masks[i]);
  const out = [];
  for (let y = win.y0; y <= win.y1; y++)
    for (let x = win.x0; x <= win.x1; x++) {
      const i = at(x, y);
      if (!corner(i)) continue;
      const m = masks[i];
      if ((m & 0xda) === 0x0a && corner(i + 1) && corner(i + W4)) continue;
      if ((m & 0x7a) === 0x12 && corner(i + W4) && corner(i - 1)) continue;
      if ((m & 0x5b) === 0x50 && corner(i - 1) && corner(i - W4)) continue;
      if ((m & 0x5e) === 0x48 && corner(i - W4) && corner(i + 1)) continue;
      if (m === 0x20 && (masks[i - 1 + W4] & 0x81) === 0x81) continue;
      if (m === 1 && (masks[i - 1 - W4] & 0x24) === 0x24) continue;
      if (m === 4 && (masks[i + 1 - W4] & 0x81) === 0x81) continue;
      if (m === 0x80 && (masks[i + 1 + W4] & 0x24) === 0x24) continue;
      out.push({ x: x * CELL, y: y * CELL, type: 4, o: null, dx: 0, dy: 0, edges: null, room: 0 });
    }
  return out;
}

const clashing = o => (o.q ? o.q.members.some(u => u.clash) : !!o.u.clash);

const boxMask = s => (s.cls === 5 || s.cls === 9 ? 0x11 : 0x10);

function ignored(W, s, o, m, flags, linked, mask) {
  if (o === s || o === s.own || crushes(W, s, o)) return true;
  if (o === m) return false;
  if (mask & 1 && o.cls === 5 && !clashing(o) && !linked(o)) return true;
  if (!o.moving) {
    if (linked(o)) return false;
    if (flags & 4 && o.cls >= 2 && o.cls <= 4) return true;
    if (flags & 2) return true;
    return !!(flags & 1) && W.enemy(unitOf(s), unitOf(o));
  }
  return motionOf(o, s) === 0x10 && !linked(o);
}

function astar(nodes, edgesOf, from, to, second) {
  const N = nodes.length,
    g = new Float64Array(N).fill(Infinity),
    shut = new Uint8Array(N),
    back = new Int32Array(N).fill(-1),
    heap = [];
  let pushed = 0;
  const h = i => Math.hypot(nodes[i].x - nodes[to].x, nodes[i].y - nodes[to].y);
  const push = (i, f) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1,
          r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top[1];
  };
  g[from] = 0;
  push(from, h(from));
  while (heap.length) {
    const i = pop();
    if (shut[i]) continue;
    if (i === to) {
      const out = [];
      for (let k = i; k >= 0; k = back[k]) out.push(k);
      return out.reverse();
    }
    shut[i] = 1;
    for (const e of edgesOf(i)) {
      if (!second && e.flag) continue;
      const j = e.to;
      if (shut[j]) continue;
      const g2 = g[i] + Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y) * e.mult;
      if (g2 < g[j]) {
        if (++pushed > 3 * N) return null;
        g[j] = g2;
        back[j] = i;
        push(j, g2 + h(j));
      }
    }
  }
  return null;
}

const isExit = p => p.type === 7 || p.type === 8;

function sameOwnerLinks(p, q) {
  if (p > q) [p, q] = [q, p];
  if ((p === 0 && q === 2) || (p === 1 && q === 3) || (p === 7 && q === 8)) return false;
  if (q === 7) return p === 0 || p === 3;
  if (q === 8) return p === 1 || p === 2;
  return true;
}

function linkNodes(W, s, nodes, boxes, exits) {
  const penalty = K.penalty,
    n = W.n,
    N = nodes.length,
    room = W.rooms(s.need),
    wide = s.need & 3,
    far = W.openness(room, wide),
    pairs = new Map();
  for (const p of nodes) {
    p.edges = null;
    const ix = Math.round(p.x / CELL),
      iy = Math.round(p.y / CELL),
      i = iy * n + ix;
    p.room = ix >= 0 && iy >= 0 && ix < n && iy < n && room[i] >= wide && far[i] > 2 ? (far[i] - 2.01) * CELL : -1;
  }
  const link = (i, j) => {
    const a = nodes[i],
      b = nodes[j],
      ex = b.x - a.x,
      ey = b.y - a.y,
      el = Math.hypot(ex, ey);
    if (el < 1e-6) return 0;
    if (a.o === b.o) {
      if (!sameOwnerLinks(a.type, b.type)) return 0;
    } else {
      if (a.o && !isExit(a) && (ex * a.dx + ey * a.dy) / el >= COS44) return 0;
      if (b.o && (-ex * b.dx - ey * b.dy) / el >= COS44) return 0;
      if (isExit(a) && b.type !== 5) return 0;
      if (isExit(b) && !(-ex * b.dx - ey * b.dy < -0.001)) return 0;
    }
    if (exits && b.type === 5 && !isExit(a)) return 0;
    if (el > a.room && el > b.room && !W.clear(a.x, a.y, b.x, b.y, s.need)) return 0;
    const lx = Math.min(a.x, b.x),
      hx = Math.max(a.x, b.x),
      ly = Math.min(a.y, b.y),
      hy = Math.max(a.y, b.y);
    for (const B of boxes) {
      const O = B.outer;
      if (O.x1 < lx || O.x0 > hx || O.y1 < ly || O.y0 > hy) continue;
      if (B.o !== a.o && B.o !== b.o && segHitsBox(O, a.x, a.y, b.x, b.y)) return 2;
    }
    return 1;
  };
  return i => {
    const p = nodes[i];
    if (p.edges) return p.edges;
    p.edges = [];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const lo = Math.min(i, j),
        hi = Math.max(i, j),
        key = lo * N + hi;
      let k = pairs.get(key);
      if (k === undefined) pairs.set(key, (k = link(lo, hi)));
      if (k) p.edges.push({ to: j, mult: k === 2 ? penalty : 1, flag: k === 2 });
    }
    return p.edges;
  };
}

function goalBlocked(W, s, m, goal, flags, linked, grow, extra, T) {
  for (const o of W.ccBodies) {
    if (o === m) continue;
    const r = o.r + (o.moving ? o.max * T : 0) + grow + extra + 2;
    if (Math.abs(o.x - goal.x) > r || Math.abs(o.y - goal.y) > r || ignored(W, s, o, m, flags, linked, boxMask(s))) continue;
    const B = sweptBox(s, o, grow + extra, T);
    if (inBox(B, goal.x, goal.y)) return true;
  }
  return false;
}

function goRound(W, c, s, m, near, flags, T, mode = 4) {
  for (let i = s.path.length - 1; i >= 0; i--) if (s.path[i].round && i < s.path.length - 1) s.path.splice(i, 1);
  if (!s.path.length || !(s.max > 0)) return false;
  const bodies = W.ccBodies,
    rm = radius(s),
    ro = m ? radius(m) : 0,
    mb = m ? boxOf(m, 0) : null,
    gap = m ? Math.hypot(m.x - s.x, m.y - s.y) : 0;
  let L = gap + rm + ro;
  if (!m) L = rm;
  else if (near) L = Math.max(gap, Math.hypot(m.x + mb.c * m.hx - s.x, m.y + mb.s * m.hx - s.y)) + rm + ro;
  else {
    const p0 = s.path[0],
      dx = p0.x - s.x,
      dy = p0.y - s.y,
      d = Math.hypot(dx, dy),
      t = d > 1e-6 ? rayIntoBox(mb, s.x, s.y, dx / d, dy / d) : -1;
    if (t >= 0) L = t + rm;
  }
  if (mode === 3) L += 40;
  const linked = o => W.colls.some(k => k.kind !== 'ss' && ((k.a === s && k.b === o) || (k.b === s && k.a === o)));
  const grow = Math.min(s.hx, s.hy) + 0.5,
    extra = Math.max(0, s.expand);
  const at = { s: Math.max(c.cursor || 0, L + 2), ring: null };
  let prev = null;
  for (let tries = 0; tries < 11; tries++) {
    const goal = rejoin(W, s, at, m, flags, linked, prev);
    if (!goal) return false;
    c.cursor = at.s;
    if (goalBlocked(W, s, m, goal, flags, linked, grow, extra, T)) continue;
    let win = null,
      corners = null;
    for (let k = 0; k < 5 && !corners; k++) {
      win = cellWindow(W, s, goal, k);
      if (!win) break;
      widenWindow(W, s, win, bodies);
      corners = terrainCorners(W, s, win, goal);
    }
    if (!corners) continue;
    const X0 = win.x0 * CELL,
      X1 = win.x1 * CELL,
      Y0 = win.y0 * CELL,
      Y1 = win.y1 * CELL,
      boxes = [];
    for (const o of bodies) {
      const r = radius(o) + (o.moving ? o.max * T : 0);
      if (o.x + r < X0 || o.x - r > X1 || o.y + r < Y0 || o.y - r > Y1) continue;
      if (ignored(W, s, o, m, flags, linked, boxMask(s)) || (o.fixed && !collides(W, s, o))) continue;
      const B = sweptBox(s, o, grow, T);
      const ox = B.hx + extra,
        oy = B.hy + extra,
        wx = ox * Math.abs(B.c) + oy * Math.abs(B.s),
        wy = ox * Math.abs(B.s) + oy * Math.abs(B.c);
      B.outer = { x: B.x, y: B.y, c: B.c, s: B.s, hx: ox, hy: oy, x0: B.x - wx, x1: B.x + wx, y0: B.y - wy, y1: B.y + wy };
      boxes.push(B);
    }
    prev = boxes;
    if (boxes.some(B => B.o !== m && inBox(B.outer, goal.x, goal.y))) continue;
    const nodes = [],
      sides = [];
    let exits = false,
      startIn = false,
      goalIn = false;
    for (const p of corners) if (!boxes.some(B => inBox(B.outer, p.x, p.y))) nodes.push(p);
    for (const B of boxes) {
      const O = B.outer;
      if (inBox(O, s.x, s.y)) {
        startIn = true;
        if (B.motion === 0x10) {
          const u = (s.x - B.x) * B.c + (s.y - B.y) * B.s;
          for (const k of [1, -1])
            sides.push({
              x: B.x + B.c * u - B.s * B.hy * k,
              y: B.y + B.s * u + B.c * B.hy * k,
              type: k > 0 ? 7 : 8,
              o: B.o,
              dx: B.s * k,
              dy: -B.c * k,
              edges: null,
              room: 0
            });
          exits = true;
        }
      }
      if (inBox(O, goal.x, goal.y)) goalIn = true;
      for (let t = 0; t < 4; t++) {
        const sx = t < 2 ? -1 : 1,
          sy = t === 0 || t === 3 ? 1 : -1,
          x = B.x + B.c * B.hx * sx - B.s * B.hy * sy,
          y = B.y + B.s * B.hx * sx + B.c * B.hy * sy,
          ox = O.x + O.c * O.hx * sx - O.s * O.hy * sy,
          oy = O.y + O.s * O.hx * sx + O.c * O.hy * sy;
        if (!W.isOpen(ox, oy, s.need) || boxes.some(o => o !== B && inBox(o.outer, ox, oy))) continue;
        const ix = -(B.c * sx - B.s * sy),
          iy = -(B.s * sx + B.c * sy),
          il = Math.hypot(ix, iy);
        nodes.push({ x, y, type: t, o: B.o, dx: ix / il, dy: iy / il, edges: null, room: 0 });
      }
    }
    nodes.push(...sides);
    let from = -1,
      to = -1;
    if (!startIn || exits) {
      from = nodes.length;
      nodes.push({ x: s.x, y: s.y, type: 5, o: null, dx: 0, dy: 0, edges: null, room: 0 });
    }
    if (!goalIn) {
      to = nodes.length;
      nodes.push({ x: goal.x, y: goal.y, type: 6, o: null, dx: 0, dy: 0, edges: null, room: 0 });
    }
    const nearest = (x, y) => {
      let best = -1,
        bd = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const d = (nodes[i].x - x) ** 2 + (nodes[i].y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };
    if (from < 0) from = nearest(s.x, s.y);
    if (to < 0) to = nearest(goal.x, goal.y);
    if (from < 0 || to < 0 || from === to) continue;
    const edgesOf = linkNodes(W, s, nodes, boxes, exits);
    W.dynUsed += nodes.length;
    const route = astar(nodes, edgesOf, from, to, false) || astar(nodes, edgesOf, from, to, true);
    if (!route) continue;
    const pts = route.map(i => ({ x: nodes[i].x, y: nodes[i].y, round: true }));
    if (startIn && !exits) pts.unshift({ x: s.x, y: s.y, round: true });
    if (goalIn && pts.length > 1) {
      const l = pts[pts.length - 1],
        p = pts[pts.length - 2],
        d = Math.hypot(l.x - p.x, l.y - p.y) || 1;
      pts.push({ x: l.x + (l.x - p.x) / d, y: l.y + (l.y - p.y) / d, round: true });
    }
    const nextWp = goal.next < s.path.length ? s.path[goal.next] : null;
    if (mode !== 3 && pts.length > 2 && nextWp) {
      const pen = pts[pts.length - 2];
      let skip = false;
      if (near) {
        const fx = m.x + mb.c * (m.hx - s.hx - m.hx),
          fy = m.y + mb.s * (m.hx - s.hx - m.hx);
        skip = (pen.x - fx) * mb.c + (pen.y - fy) * mb.s <= 60;
      }
      if (!skip && W.clear(pen.x, pen.y, nextWp.x, nextWp.y, s.need)) pts.pop();
    }
    pts.shift();
    if (!pts.length) continue;
    s.path.splice(0, goal.next, ...pts);
    return true;
  }
  return false;
}

export function terrainRound(W, u, to, hx, hy, team) {
  readConstants();
  W.ccBodies ||= [];
  W.colls ||= [];
  const t = u.type,
    s = team
      ? (u.tb ||= { id: 0, u, q: null, cls: 5, r: 0, mpi: 0, expand: 0, turn: 0, fixed: false })
      : u.cb || (u.tb ||= { id: 0, u, q: null, cls: Math.max(5, (u.ccls ??= collisionClass(t))), r: 0, mpi: 0, expand: 0, turn: 0 });
  if (s.id === 0) {
    s.hx = hx;
    s.hy = hy;
    s.r = Math.hypot(hx, hy);
    s.spacing = t.num('FormationSpacing', 0);
    s.expand = t.num('MovementBoxExpansionFactor', 0);
  }
  s.x = u.x;
  s.y = u.y;
  s.h = u.heading;
  s.side = u.side;
  s.v = u.v || 0;
  s.max = u.speed * W.paceOf(u);
  s.min = 0;
  s.need = team ? (u.need & ~3) | 1 : u.need || 2;
  s.own = team ? u.squad.cb || null : null;
  s.path = team ? [{ x: to.x, y: to.y }] : u.path;
  s.moving = s.path.length > 0 && s.max > 0;
  const T = db.constants.num('MovingVsMovingLookAheadTime', 1.5);
  if (!goRound(W, { cursor: 0 }, s, null, false, 0, T, 3)) return null;
  return s.path;
}

function busy(b) {
  const u = unitOf(b);
  return !u || !!u.structure || !!u.rooted || !!u.inside || !!u.setup || !!(u.needsDeploy && u.deployed);
}

function standAside(W, mover, b, bodies) {
  if (b.side < 0 || busy(b)) return false;
  const side = -Math.sin(mover.h) * (b.x - mover.x) + Math.cos(mover.h) * (b.y - mover.y) > 0 ? 1 : -1;
  const h = mover.h + (side * Math.PI) / 4,
    dx = Math.cos(h),
    dy = Math.sin(h),
    far = radius(mover) + radius(b) + 10;
  for (let r = 10; r <= far * 2; r += 5) {
    const x = b.x + dx * r,
      y = b.y + dy * r;
    if (!W.isOpen(x, y, b.need) || !W.clear(b.x, b.y, x, y, b.need)) continue;
    if (bodies.some(o => o !== b && o !== mover && (o.x - x) ** 2 + (o.y - y) ** 2 < (radius(o) + radius(b)) ** 2)) continue;
    if (r < far && Math.abs(-Math.sin(mover.h) * (x - mover.x) + Math.cos(mover.h) * (y - mover.y)) < radius(mover) + radius(b)) continue;
    if (b.q) W.order(b.q, x, y);
    else b.u.path = [{ x, y }];
    return true;
  }
  return false;
}

function stopShort(a, b) {
  const end = a.path[a.path.length - 1],
    prev = a.path.length > 1 ? a.path[a.path.length - 2] : { x: a.x, y: a.y };
  const dx = end.x - prev.x,
    dy = end.y - prev.y,
    len = Math.hypot(dx, dy);
  if (len < 1e-6) return false;
  const on = (x, y) => {
    const ex = b.x - x,
      ey = b.y - y,
      e = Math.hypot(ex, ey);
    return e < 1e-6 || e < reach(a, ex / e, ey / e, Math.atan2(dy, dx)) + reach(b, -ex / e, -ey / e);
  };
  let back = 5;
  while (back < len && on(end.x - (dx / len) * back, end.y - (dy / len) * back)) back += 5;
  const keep = Math.max(0, len - back + 3);
  if (keep < 4) {
    a.path.length = Math.max(0, a.path.length - 1);
    return true;
  }
  a.path[a.path.length - 1] = { x: prev.x + (dx / len) * keep, y: prev.y + (dy / len) * keep };
  return true;
}

function endsOn(a, b) {
  const end = a.path[a.path.length - 1];
  if (!end) return false;
  const ex = b.x - end.x,
    ey = b.y - end.y,
    e = Math.hypot(ex, ey);
  return e < 1e-6 || e < reach(a, ex / e, ey / e) + reach(b, -ex / e, -ey / e);
}

const later = () => (FPS + Math.floor(simRandom() * 16)) / FPS;

function similar(A, B) {
  const a = A.u.type,
    b = B.u.type;
  if (a === b) return true;
  if (a.str('FormationOrder').trim() !== b.str('FormationOrder').trim()) return false;
  const ta = a.num('FormationSpacing', 0) * 10,
    tb = b.num('FormationSpacing', 0) * 10;
  return B.hx + tb >= A.hx && B.hy + tb >= A.hy && A.hx + ta >= B.hx && A.hy + ta >= B.hy;
}

function swapOrders(A, B) {
  const ua = A.u,
    ub = B.u,
    F = A.form,
    path = ua.path;
  ua.path = ub.path;
  ub.path = path;
  A.path = ua.path;
  B.path = ub.path;
  for (const u of [ua, ub]) {
    u.legTo = null;
    u.stopping = null;
  }
  const ea = F.members?.find(e => e.q === ua.squad),
    eb = F.members?.find(e => e.q === ub.squad);
  if (ea && eb) [ea.dest, eb.dest] = [eb.dest, ea.dest];
  const fa = ua.squad.formSpeed,
    fb = ub.squad.formSpeed;
  if (fa && fb) [fa.x, fa.y, fb.x, fb.y] = [fb.x, fb.y, fa.x, fa.y];
}

function classifyMM(W, c, T) {
  const A = c.a,
    B = c.b;
  c.state = MM.RESOLVED;
  if (!willMeet(A, B, T)) return;
  const set = (state, master, slave) => {
    c.state = state;
    c.master = master;
    c.slave = slave;
  };
  if (A.form && A.form === B.form) {
    if (!(A.cls <= 6 && B.cls <= 6) && A.u && B.u && A.path.length && B.path.length && similar(A, B)) {
      const ch = Math.cos(A.h),
        sh = Math.sin(A.h),
        ga = A.path[A.path.length - 1],
        gb = B.path[B.path.length - 1],
        pa = ga.x * ch + ga.y * sh,
        pb = gb.x * ch + gb.y * sh,
        aLeads = (A.x - B.x) * ch + (A.y - B.y) * sh > 0.001,
        bLeads = (B.x - A.x) * ch + (B.y - A.y) * sh > 0.001;
      if ((aLeads && pb > pa) || (bLeads && pa > pb)) {
        swapOrders(A, B);
        return;
      }
    }
    const aheadA = Math.cos(B.h) * (A.x - B.x) + Math.sin(B.h) * (A.y - B.y);
    return aheadA > 0 ? set(MM.SPEED_SLAVE, A, B) : set(MM.SPEED_SLAVE, B, A);
  }
  const cA = crushes(W, A, B),
    cB = crushes(W, B, A);
  const dot = Math.cos(A.h) * Math.cos(B.h) + Math.sin(A.h) * Math.sin(B.h);
  const bAhead = Math.cos(A.h) * (B.x - A.x) + Math.sin(A.h) * (B.y - A.y),
    aAhead = Math.cos(B.h) * (A.x - B.x) + Math.sin(B.h) * (A.y - B.y);
  if (dot > 0) {
    if (bAhead >= -0.001) {
      if (aAhead < -0.001 && !cA) return canPass(A, B) ? set(MM.PASS, A, B) : set(MM.SPEED_ONLY, B, A);
    } else if (!cB) return canPass(B, A) ? set(MM.PASS, B, A) : set(MM.SPEED_ONLY, A, B);
  }
  if (A.cls === 9 && B.cls !== 9 && !cA) return set(MM.PATH_AROUND, A, B);
  if (B.cls === 9 && A.cls !== 9 && !cB) return set(MM.PATH_AROUND, B, A);
  const r = relation(A, B);
  switch (r) {
    case 0:
    case 2:
      return cB ? set(MM.THROUGH, B, A) : set(MM.PATH_AROUND, B, A);
    case 4: {
      if (cA) return set(MM.THROUGH, A, B);
      if (cB) return set(MM.THROUGH, B, A);
      if (A.cls !== B.cls) return A.cls < B.cls ? set(MM.PATH_AROUND, B, A) : set(MM.PATH_AROUND, A, B);
      return A.max <= B.max ? set(MM.PATH_AROUND, A, B) : set(MM.PATH_AROUND, B, A);
    }
    case 8: {
      if (cA) return set(MM.PATH_AROUND, A, B);
      if (cB) return set(MM.THROUGH, B, A);
      return bAhead <= aAhead ? set(MM.PATH_AROUND, A, B) : set(MM.PATH_AROUND, B, A);
    }
    default:
      return aAhead <= bAhead ? set(MM.SPEED_ONLY, B, A) : set(MM.SPEED_ONLY, A, B);
  }
}

function beginMM(W, c, T) {
  if (c.state === MM.PATH_AROUND) {
    for (const flags of [0, 1]) {
      if (goRound(W, c, c.slave, c.master, false, flags, T)) return;
      if (goRound(W, c, c.master, c.slave, false, flags, T)) {
        const m = c.master;
        c.master = c.slave;
        c.slave = m;
        return;
      }
    }
    c.state = MM.LATER;
    c.until = W.time + later();
  } else if (c.state === MM.PASS) {
    if (!goRound(W, c, c.master, c.slave, true, 0, T)) {
      c.state = MM.SPEED_ONLY;
      const m = c.master;
      c.master = c.slave;
      c.slave = m;
    }
  }
}

function classifyMS(W, c, bodies, T) {
  const A = c.a,
    B = c.b,
    crush = crushes(W, A, B);
  c.state = MS.RESOLVED;
  if (A.cls === 9 && !crush && standAside(W, A, B, bodies)) return;
  if (!crush) {
    if (endsOn(A, B) && !(A.cls >= 7 && B.cls <= 6) && stopShort(A, B)) return;
    if (goRound(W, c, A, B, false, 0, T) || goRound(W, c, A, B, false, 4, T)) {
      c.state = MS.PATH_AROUND;
      return;
    }
  }
  const friend = !W.enemy(unitOf(A), unitOf(B));
  if ((friend || crush) && A.cls !== 5 && !(A.cls === 6 && B.cls === 5) && A.cls !== 9 && standAside(W, A, B, bodies)) return;
  if (crush) {
    c.state = MS.THROUGH;
    return;
  }
  if (A.cls > 6 || B.cls > 6) {
    if (goRound(W, c, A, B, false, 1, T) || goRound(W, c, A, B, false, 5, T)) {
      c.state = MS.PATH_AROUND;
      return;
    }
    if (!friend && B.u && A.u) {
      W.attack(A.u.squad, B.u.squad);
      c.state = MS.ATTACK;
      return;
    }
  }
  c.state = MS.LATER;
}

function overlapCoef(a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    ca = Math.cos(a.h),
    sa = Math.sin(a.h),
    cb = Math.cos(b.h),
    sb = Math.sin(b.h);
  let least = 1;
  for (let k = 0; k < 4; k++) {
    const nx = k === 0 ? ca : k === 1 ? -sa : k === 2 ? cb : -sb,
      ny = k === 0 ? sa : k === 1 ? ca : k === 2 ? sb : cb;
    const sum =
      a.hx * Math.abs(ca * nx + sa * ny) +
      a.hy * Math.abs(-sa * nx + ca * ny) +
      b.hx * Math.abs(cb * nx + sb * ny) +
      b.hy * Math.abs(-sb * nx + cb * ny);
    const along = dx * nx + dy * ny;
    if (sum === 0 || along > sum || along < -sum) return 0;
    least = Math.min(least, 1 - Math.abs(along / sum));
  }
  return least;
}

function targetOf(b) {
  if (b.q) {
    const q = b.q;
    for (const u of q.members) if (u.target && !u.target.dead) return u.target;
    return q.foe && q.foe.members.length ? q.foe.members[0] : null;
  }
  const t = b.u.target;
  return t && !t.dead ? t : null;
}

function cannotMove(b) {
  const u = unitOf(b);
  if (b.q && (b.q.busy || b.q.pending)) return true;
  return !u || !!u.rooted || !!u.setup || !!(u.needsDeploy && u.deployed) || !(b.max > 0);
}

function awayHeading(M, O) {
  const t = targetOf(M);
  if (t) return Math.atan2(t.y - M.y, t.x - M.x);
  if (M.cls >= 7 && M.cls < O.cls && Math.cos(M.h) * (M.x - O.x) + Math.sin(M.h) * (M.y - O.y) > 0) return M.h;
  return Math.atan2(M.y - O.y, M.x - O.x);
}

function clearCost(M, O, H) {
  const ux = Math.cos(H),
    uy = Math.sin(H),
    v = M.max / FPS,
    R = radius(M) + radius(O),
    dx = O.x - M.x,
    dy = O.y - M.y,
    d = Math.hypot(dx, dy),
    along = v * (ux * dx + uy * dy),
    lat = v * (uy * dx - ux * dy);
  let t = -1;
  if (along > 0) t = (d + R) / along;
  else if (along < 0) t = R - d < 0 ? 0 : (R - d) / -along;
  if (lat !== 0 && (t === -1 || R / lat < t)) t = R / lat;
  if (t < 0) return 0;
  const turn = Math.abs(Math.atan2(Math.sin(H - M.h), Math.cos(H - M.h))) / Math.max(1e-6, M.turn / FPS);
  return turn + t;
}

function pickMover(A, B) {
  const fa = cannotMove(A),
    fb = cannotMove(B);
  if (fa) return fb ? null : B;
  if (fb) return A;
  const ta = !!targetOf(A),
    tb = !!targetOf(B);
  if (!ta && tb) return A;
  if (ta && !tb) return B;
  if (A.cls === 5 && B.cls === 5 && ta && tb) return null;
  if (A.cls < B.cls && B.cls === 9) return A;
  if (A.cls > B.cls && A.cls === 9) return B;
  return clearCost(B, A, awayHeading(B, A)) <= clearCost(A, B, awayHeading(A, B)) ? B : A;
}

function footHit(o, x, y, half) {
  const dx = o.x - Math.max(x, Math.min(x + 1, o.x)),
    dy = o.y - y,
    e = Math.hypot(dx, dy);
  return e < 1e-6 || e < half + reach(o, dx / e, dy / e);
}

function comingWays(W, M) {
  const out = [];
  for (const c of W.colls || []) {
    const a = c.a;
    if (c.kind !== 'ms' || c.b !== M || !a.moving) continue;
    const X = Math.max(a.mpi, K.predict),
      far = a.max * Math.min(2 * X, X + 4),
      pts = [{ x: a.x, y: a.y }];
    let gone = 0,
      x = a.x,
      y = a.y;
    for (const p of a.path) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (gone + d >= far) {
        const k = d > 1e-6 ? (far - gone) / d : 0;
        pts.push({ x: x + (p.x - x) * k, y: y + (p.y - y) * k });
        break;
      }
      pts.push(p);
      gone += d;
      x = p.x;
      y = p.y;
    }
    if (pts.length > 1) out.push({ pts, w: a.hy + radius(M) + 4 });
  }
  return out;
}

function onWay(w, x, y) {
  for (let i = 1; i < w.pts.length; i++) {
    const a = w.pts[i - 1],
      b = w.pts[i],
      ex = b.x - a.x,
      ey = b.y - a.y,
      L = ex * ex + ey * ey,
      k = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / L)) : 0;
    if (Math.hypot(a.x + ex * k - x, a.y + ey * k - y) < w.w) return true;
  }
  return false;
}

function freeSpot(W, M, H, bodies) {
  const R = radius(M),
    cap = Math.min(10, R * 1.5 || 5),
    half = R + M.spacing * 5,
    cone = M.cls === 5 ? Math.PI : 2.3561945,
    near = M.cls === 5 ? 1 : 0.75,
    most = 20 * 10 + half,
    close = bodies.filter(o => o !== M && Math.abs(o.x - M.x) <= most + half + o.r && Math.abs(o.y - M.y) <= most + half + o.r),
    ways = comingWays(W, M);
  let r = 0,
    step = 1;
  for (let ring = 0; ring < 20; ring++) {
    let n = Math.floor((r * 2 * Math.PI) / R) + 1;
    if (ring && n < 4) n = 4;
    for (let k = 0; k < n; k++) {
      const th = (k / n) * 2 * Math.PI,
        far = th > cone ? near : r,
        x = M.x + Math.cos(th + H) * far,
        y = M.y + Math.sin(th + H) * far;
      if (!W.isOpen(x, y, M.need)) continue;
      if (close.some(o => footHit(o, x, y, half))) continue;
      if (ways.some(w => onWay(w, x, y))) continue;
      return { x, y };
    }
    r += step;
    step = Math.min(cap, step + 0.8);
  }
  return null;
}

function sidePush(W, I, V) {
  const R = 1.3 * (I.r + V.r),
    d = Math.hypot(I.x - V.x, I.y - V.y),
    w = Math.max(0, Math.min(1, 1 - d / R)) * (I.max > 0 ? Math.max(0, Math.min(1, I.v / I.max)) : 0);
  if (!(w > 0)) return 0;
  const fx = Math.cos(I.h),
    fy = Math.sin(I.h),
    left = W.isOpen(V.x - fy * R, V.y + fx * R, I.need),
    right = W.isOpen(V.x + fy * R, V.y - fx * R, I.need);
  return (-fy * (V.x - I.x) + fx * (V.y - I.y) < 0 && left) || right ? w : 0;
}

function stoppedOverlap(W, a, b) {
  const [I, V] = a.cls === 5 ? [a, b] : b.cls === 5 ? [b, a] : [null, null];
  if (I && I.u && (V.cls === 8 || V.cls === 9) && !sidePush(W, I, V)) return false;
  return overlapCoef(a, b) > K.least;
}

function tickStopped(W, c, bodies) {
  const A = c.a,
    B = c.b;
  if (c.state === SS.WAIT) {
    if (W.time < c.clock) return;
    c.clock = W.time + 1;
    c.state = SS.START;
  }
  if ((!A.fixed && !W.isOpen(A.x, A.y, A.need)) || (!B.fixed && !W.isOpen(B.x, B.y, B.need))) {
    c.state = SS.GONE;
    return;
  }
  if (c.state === SS.MOVING) {
    const M = c.mover,
      end = M.path[M.path.length - 1];
    if (!M.moving) c.state = SS.DONE;
    else if (!end || Math.abs(end.x - c.spot.x) > 1 || Math.abs(end.y - c.spot.y) > 1) c.state = SS.WAIT;
    return;
  }
  const M = pickMover(A, B);
  if (!M) {
    c.state = SS.WAIT;
    return;
  }
  const O = M === A ? B : A,
    spot = freeSpot(W, M, awayHeading(M, O), bodies);
  if (!spot || (spot.x === M.x && spot.y === M.y)) {
    c.state = SS.WAIT;
    return;
  }
  const way = W.route(M.x, M.y, spot.x, spot.y, M.need);
  if (!way || !way.length) {
    c.state = SS.WAIT;
    return;
  }
  W.standMove(M, way.slice());
  M.path = M.q ? M.q.box.path : M.u.path;
  M.moving = true;
  c.mover = M;
  c.spot = way[way.length - 1];
  c.state = SS.MOVING;
}

function timeLeft(W, c, bodies) {
  if (!(W.time < c.recount)) {
    c.recount = W.time + 1;
    const mx = (c.a.x + c.b.x) / 2,
      my = (c.a.y + c.b.y) / 2;
    let n = 0;
    for (const o of bodies) if (Math.abs(o.x - mx) <= 80 && Math.abs(o.y - my) <= 80) n++;
    c.allowed = (n * 5) / FPS;
  }
  return c.allowed - (W.time - c.start);
}

function decide(W, c, bodies, T) {
  if (W.dynUsed >= K.quota) {
    c.pending = true;
    return;
  }
  c.pending = false;
  if (c.kind === 'mm') {
    classifyMM(W, c, T);
    if (c.state !== MM.RESOLVED) beginMM(W, c, T);
  } else classifyMS(W, c, bodies, T);
}

export function tickCollisions(W) {
  readConstants();
  const T = db.constants.num('MovingVsMovingLookAheadTime', 1.5),
    every = Math.max(1, db.constants.num('FramesPerCollisionCheck', 4));
  W.cframe = (W.cframe || 0) + 1;
  if (!(W.dynUsed >= 0) || W.cframe % Math.max(1, db.constants.num('DynamicLandQuotaResetInterval', 5)) === 0) W.dynUsed = 0;
  for (const b of W.ccBodies || []) {
    if (b.u) b.u.ccCap = Infinity;
    else b.q.ccCap = Infinity;
  }
  const bodies = (W.ccBodies = gather(W));
  if (!W.colls) W.colls = [];
  for (const b of bodies) b.cap = Infinity;
  const live = [],
    here = new Set(bodies),
    waiting = W.colls.filter(c => c.pending && here.has(c.a) && here.has(c.b));
  if (waiting.length) {
    for (const c of waiting) c.left = timeLeft(W, c, bodies);
    waiting.sort((p, q) => p.left - q.left);
    for (const c of waiting) decide(W, c, bodies, T);
  }
  for (const c of W.colls) {
    if (!here.has(c.a) || !here.has(c.b)) continue;
    if (c.pending) {
      live.push(c);
      continue;
    }
    const look = (W.cframe + c.a.id) % every === 0;
    if (c.kind === 'mm') {
      const { master: M, slave: S } = c;
      if (c.state === MM.LATER) {
        if (W.time >= c.until) decide(W, c, bodies, T);
      } else {
        if (c.state === MM.PATH_AROUND) {
          if (!S.path.some(p => p.round) || Math.cos(M.h) * (S.x - M.x) + Math.sin(M.h) * (S.y - M.y) < -(radius(M) + radius(S))) continue;
        } else if (look && !(c.a.moving && c.b.moving && willMeet(c.a, c.b, T))) continue;
        if (c.state === MM.PATH_AROUND)
          M.cap = Math.min(M.cap, crushes(W, M, S) || M.path.some(p => p.round) ? Infinity : laneSpeed(M, S, T));
        else if (c.state === MM.SPEED_ONLY || c.state === MM.SPEED_SLAVE)
          S.cap = Math.min(S.cap, crushes(W, S, M) ? Infinity : holdOff(S, M, T));
        else if (c.state === MM.PASS) {
          if (Math.cos(M.h) * (S.x - M.x) + Math.sin(M.h) * (S.y - M.y) < -(radius(M) + radius(S))) continue;
          S.cap = Math.min(S.cap, Math.min(holdOff(S, M, T), S.max * 0.5));
        }
        if (look && c.state === MM.SPEED_ONLY) {
          classifyMM(W, c, T);
          if (c.state !== MM.SPEED_ONLY && c.state !== MM.RESOLVED) beginMM(W, c, T);
          if (c.state === MM.RESOLVED) continue;
        }
      }
    } else if (c.kind === 'ss') {
      tickStopped(W, c, bodies);
      if (c.state === SS.DONE || c.state === SS.GONE) continue;
    } else {
      const A = c.a,
        B = c.b;
      if (B.moving) continue;
      if (c.state === MS.LATER) {
        if (W.time >= c.clock) {
          c.clock = W.time + 1;
          decide(W, c, bodies, T);
        }
      } else if (look) {
        const far = A.max * (Math.max(T, A.mpi) + (crushes(W, A, B) ? 1.5 : 0));
        if (!A.moving || runsInto(A, B, far) < 0) continue;
      }
      if (c.state === MS.RESOLVED || c.state === MS.ATTACK) continue;
    }
    if (c.state === MM.RESOLVED && c.kind === 'mm') continue;
    live.push(c);
  }
  W.colls = live;
  const grid = new Map(),
    CELLS = 160;
  for (const b of bodies) {
    const k = Math.floor(b.x / CELLS) * 65536 + Math.floor(b.y / CELLS);
    (grid.get(k) || grid.set(k, []).get(k)).push(b);
  }
  const inColl = new Set();
  for (const c of W.colls) {
    inColl.add(c.a.id * 1e6 + c.b.id);
    inColl.add(c.b.id * 1e6 + c.a.id);
  }
  for (const a of bodies) {
    if ((W.cframe + a.id) % every) continue;
    const gx = Math.floor(a.x / CELLS),
      gy = Math.floor(a.y / CELLS);
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gy - 1; j <= gy + 1; j++)
        for (const b of grid.get(i * 65536 + j) || []) {
          if (b === a || inColl.has(a.id * 1e6 + b.id) || !collides(W, a, b)) continue;
          const rb = radius(b);
          if (Math.abs(b.x - a.x) > 80 + rb || Math.abs(b.y - a.y) > 80 + rb) continue;
          let c = null;
          if (!a.moving) {
            if (b.moving || (a.x - b.x) ** 2 + (a.y - b.y) ** 2 > (a.r + rb) ** 2 || !stoppedOverlap(W, a, b)) continue;
            c = { kind: 'ss', a, b, state: SS.START, clock: W.time + 1, mover: null, spot: null };
            tickStopped(W, c, bodies);
            if (c.state === SS.DONE || c.state === SS.GONE) c = null;
          } else if (a.cls <= 6 && b.cls <= 6 && !b.fixed) continue;
          else if (b.moving) {
            const crushEither = crushes(W, a, b) || crushes(W, b, a);
            if (willMeet(a, b, T + (crushEither ? 1.5 : 0))) {
              c = { kind: 'mm', a, b, start: W.time, recount: 0, allowed: 0, left: 0, pending: false, cursor: 0 };
              classifyMM(W, c, T);
              if (c.state === MM.RESOLVED) c = null;
              else if (W.dynUsed >= K.quota) c.pending = true;
              else beginMM(W, c, T);
            }
          } else {
            const far = a.max * (Math.max(T, a.mpi) + (crushes(W, a, b) ? 1.5 : 0));
            if (runsInto(a, b, far) >= 0) {
              c = { kind: 'ms', a, b, clock: W.time + 1, start: W.time, recount: 0, allowed: 0, left: 0, pending: false, cursor: 0 };
              decide(W, c, bodies, T);
              if (!c.pending && (c.state === MS.RESOLVED || c.state === MS.ATTACK)) c = null;
            }
          }
          if (c) {
            W.colls.push(c);
            inColl.add(a.id * 1e6 + b.id);
            inColl.add(b.id * 1e6 + a.id);
          }
        }
  }
  for (const c of W.colls) {
    if (c.kind === 'ms' && c.state === MS.LATER) c.a.cap = 0;
    if (c.kind === 'mm' && c.state === MM.LATER) {
      const { master: M, slave: S } = c;
      if (!(Math.cos(S.h) * (M.x - S.x) + Math.sin(S.h) * (M.y - S.y) < -0.001)) S.cap = 0;
      if (!(Math.cos(M.h) * (S.x - M.x) + Math.sin(M.h) * (S.y - M.y) < -0.001)) M.cap = 0;
    }
  }
  for (const b of bodies) {
    if (b.u) b.u.ccCap = b.cap;
    else b.q.ccCap = b.cap;
  }
  for (const a of bodies) {
    const u = a.u;
    if (!u) continue;
    u.ccPush = null;
    if (!a.moving || a.cls > 6) continue;
    const gx = Math.floor(a.x / CELLS),
      gy = Math.floor(a.y / CELLS),
      ca = Math.cos(a.h),
      sa = Math.sin(a.h),
      pushes = [];
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gy - 1; j <= gy + 1; j++)
        for (const b of grid.get(i * 65536 + j) || []) {
          if (b === a || b.cls > 6) continue;
          const dx = b.x - a.x,
            dy = b.y - a.y,
            d = Math.hypot(dx, dy),
            R = 1.3 * (radius(a) + radius(b));
          if (d >= R || ca * dx + sa * dy < 0) continue;
          const side = -sa * dx + ca * dy > 0 ? -1 : 1,
            px = -sa * side,
            py = ca * side;
          if (!W.isOpen(a.x + px * 25, a.y + py * 25, a.need)) continue;
          const w = 1 - d / R;
          pushes.push({ x: px * w, y: py * w, w });
        }
    if (!pushes.length) continue;
    pushes.sort((p, q) => q.w - p.w);
    const top = pushes[0];
    let x = 0,
      y = 0;
    for (const p of pushes)
      if (p.x * top.x + p.y * top.y >= -0.5 * p.w * top.w) {
        x += p.x;
        y += p.y;
      }
    u.ccPush = { x, y };
  }
}
