import { db } from '../gamedata.js';
import { simRandom } from './simrandom.js';

const FPS = 30;
const CLASSES = { 'LANDING TRANSPORT': 0, 'BUILD PAD': 1, 'LOW OBSTACLE': 2, 'MEDIUM OBSTACLE': 3, 'HIGH OBSTACLE': 4, INFANTRY: 5, BIKE: 6, VEHICLE: 7, 'LARGE VEHICLE': 8, 'GIANT VEHICLE': 9 };
export const collisionClass = t => CLASSES[t.str('UnitCollisionClass').trim().toUpperCase()] ?? -1;

const MM = { NONE: 0, PATH_AROUND: 1, SPEED_SLAVE: 2, PASS: 4, SPEED_ONLY: 6, THROUGH: 7, RESOLVED: 8, LATER: 10 };
const MS = { NONE: 0, PATH_AROUND: 1, THROUGH: 4, RESOLVED: 5, LATER: 7, ATTACK: 8 };

let BODY_ID = 0;
export function resetCollideIds() { BODY_ID = 0; }

function gather(W) {
  const out = [];
  for (const u of W.units) {
    if (u.dead || u.structure || u.flies || u.inside || u.flight || u.rope || u.cinematicTransport || u.scriptHidden || !u.squad) continue;
    if (u.squad.box && u.slot) continue;
    const cls = u.ccls ??= collisionClass(u.type);
    if (cls < 5) continue;
    const b = u.cb || (u.cb = { id: ++BODY_ID, u, q: null, cls, hx: u.type.num('Custom_Hard_XExtent', 0) || u.body || 10, hy: u.type.num('Custom_Hard_YExtent', 0) || u.body || 10, mpi: u.type.num('MovementPredictionInterval', 0) });
    b.x = u.x; b.y = u.y; b.h = u.heading; b.path = u.path; b.side = u.side;
    b.v = (b.v ?? 0) * 0.75 + (u.v ?? 0) * 0.25;
    b.max = u.rooted || u.stunUntil > W.time ? 0 : (u.squad.formSpeed ? Math.min(u.speed, u.squad.formSpeed.v) : u.speed) * W.paceOf(u);
    b.moving = b.path.length > 0 && b.max > 0;
    b.need = u.need || 2; b.form = u.squad.formMove || null;
    out.push(b);
  }
  for (const q of W.squads) {
    const box = q.box;
    if (!box || !q.members.length || q.dead) continue;
    const u = q.members.find(m => !m.dead && !m.inside);
    if (!u || u.flies) continue;
    const b = q.cb || (q.cb = { id: ++BODY_ID, u: null, q, cls: 5, mpi: u.type.num('MovementPredictionInterval', 0) || (q.type ? q.type.num('MovementPredictionInterval', 0) : 0) });
    b.x = box.x; b.y = box.y; b.h = box.heading; b.path = box.path; b.side = u.side; b.v = box.speed || 0;
    b.hx = Math.max(4, box.rear || 4); b.hy = Math.max(4, box.hw || 4);
    b.max = q.formSpeed ? Math.min(box.max, q.formSpeed.v) : box.max;
    b.moving = !q.ext && b.path.length > 0;
    b.need = u.need || 1; b.form = q.formMove || null; b.lead = u;
    out.push(b);
  }
  return out;
}

const unitOf = b => b.u || b.lead;
const cosH = b => Math.cos(b.h), sinH = b => Math.sin(b.h);
function reach(b, dx, dy, h = b.h) { const c = Math.cos(h) * dx + Math.sin(h) * dy, k = c * c; return (1 - k) * b.hy + k * b.hx; }
const radius = b => Math.hypot(b.hx, b.hy);

function crushes(W, a, b) {
  const A = unitOf(a), B = unitOf(b);
  return !!A && !!B && W.enemy(A, B) && !!A.crusher && (!!B.squashable || (!!A.supercrusher && !!B.squashableBig));
}

function along(b, v, t) {
  let x = b.x, y = b.y, h = b.h, left = v * t;
  for (const p of b.path) {
    const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    h = Math.atan2(dy, dx);
    if (left <= d) return { x: x + dx / d * left, y: y + dy / d * left, h };
    x = p.x; y = p.y; left -= d;
  }
  return { x, y, h };
}

function willMeet(a, b, T) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  const va = a.moving ? ((Math.cos(a.h) * dx + Math.sin(a.h) * dy) / d >= 0 ? a.max : a.v) : 0;
  const vb = b.moving ? ((Math.cos(b.h) * dx + Math.sin(b.h) * dy) / d <= 0 ? b.max : b.v) : 0;
  const step = 2 / FPS;
  for (let t = 0; t <= T + 1e-6; t += step) {
    const A = va > 0 ? along(a, va, t) : a, B = vb > 0 ? along(b, vb, t) : b;
    const ex = B.x - A.x, ey = B.y - A.y, e = Math.hypot(ex, ey);
    if (e < 1e-6) return true;
    if (e < reach(a, ex / e, ey / e, A.h) + reach(b, ex / e, ey / e, B.h)) return true;
  }
  return false;
}

function runsInto(a, b, far) {
  let x = a.x, y = a.y, h = a.h, gone = 0;
  const hit = (px, py, ph) => { const ex = b.x - px, ey = b.y - py, e = Math.hypot(ex, ey); return e < 1e-6 || e < reach(a, ex / e, ey / e, ph) + reach(b, -ex / e, -ey / e); };
  if (hit(x, y, h)) return 0;
  for (const p of a.path) {
    const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    h = Math.atan2(dy, dx);
    for (let s = Math.min(4, d); ; s = Math.min(d, s + 4)) {
      if (hit(x + dx / d * s, y + dy / d * s, h)) return gone + s;
      if (gone + s >= far) return -1;
      if (s >= d) break;
    }
    x = p.x; y = p.y; gone += d;
  }
  return -1;
}

function holdOff(a, b, T) {
  const vmax = a.max, vmin = 0;
  let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
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
  let left = 0, x = a.x, y = a.y;
  for (const p of a.path) { left += Math.hypot(p.x - x, p.y - y); x = p.x; y = p.y; }
  const need = (radius(a) + radius(b) + Math.hypot(b.x - a.x, b.y - a.y)) / (a.max - vb);
  return need <= left / a.max;
}

function wayRound(W, s, m, T) {
  for (let i = s.path.length - 1; i >= 0; i--) if (s.path[i].round && i < s.path.length - 1) s.path.splice(i, 1);
  if (!s.path.length) return false;
  const p0 = s.path[0], fx0 = p0.x - s.x, fy0 = p0.y - s.y, fd = Math.hypot(fx0, fy0);
  if (fd < 1e-6) return false;
  const fx = fx0 / fd, fy = fy0 / fd, nx = -fy, ny = fx;
  const pts = [{ x: m.x, y: m.y }];
  if (m.moving && m.max > 0) { const e = along(m, m.max, T); pts.push({ x: e.x, y: e.y }); }
  const room = radius(m) + Math.max(s.hx, s.hy) + 4;
  let f0 = Infinity, f1 = -Infinity, l0 = Infinity, l1 = -Infinity;
  for (const p of pts) {
    const a = (p.x - s.x) * fx + (p.y - s.y) * fy, l = (p.x - s.x) * nx + (p.y - s.y) * ny;
    f0 = Math.min(f0, a - room); f1 = Math.max(f1, a + room); l0 = Math.min(l0, l - room); l1 = Math.max(l1, l + room);
  }
  if (f1 <= 0) return false;
  const sides = Math.abs(l1) <= Math.abs(l0) ? [l1, l0] : [l0, l1];
  let k = 0;
  while (k < s.path.length - 1 && (s.path[k].x - s.x) * fx + (s.path[k].y - s.y) * fy < f1) k++;
  const on = s.path[k], need = s.need;
  for (const lat of sides) {
    const a = { x: s.x + fx * Math.max(0, f0) + nx * lat, y: s.y + fy * Math.max(0, f0) + ny * lat };
    const b = { x: s.x + fx * f1 + nx * lat, y: s.y + fy * f1 + ny * lat };
    if (!W.isOpen(a.x, a.y, need) || !W.isOpen(b.x, b.y, need)) continue;
    if (!W.clear(s.x, s.y, a.x, a.y, need) || !W.clear(a.x, a.y, b.x, b.y, need) || !W.clear(b.x, b.y, on.x, on.y, need)) continue;
    a.round = b.round = true;
    s.path.splice(0, k, a, b);
    return true;
  }
  return false;
}

function busy(b) { const u = unitOf(b); return !u || !!u.target || !!(u.squad && u.squad.foe); }

function standAside(W, mover, b, bodies) {
  if (b.side < 0 || busy(b)) return false;
  const side = -Math.sin(mover.h) * (b.x - mover.x) + Math.cos(mover.h) * (b.y - mover.y) > 0 ? 1 : -1;
  const h = mover.h + side * Math.PI / 4, dx = Math.cos(h), dy = Math.sin(h), far = radius(mover) + radius(b) + 10;
  for (let r = 10; r <= far * 2; r += 5) {
    const x = b.x + dx * r, y = b.y + dy * r;
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
  const end = a.path[a.path.length - 1], prev = a.path.length > 1 ? a.path[a.path.length - 2] : { x: a.x, y: a.y };
  const dx = end.x - prev.x, dy = end.y - prev.y, len = Math.hypot(dx, dy);
  if (len < 1e-6) return false;
  const on = (x, y) => { const ex = b.x - x, ey = b.y - y, e = Math.hypot(ex, ey); return e < 1e-6 || e < reach(a, ex / e, ey / e, Math.atan2(dy, dx)) + reach(b, -ex / e, -ey / e); };
  let back = 5;
  while (back < len && on(end.x - dx / len * back, end.y - dy / len * back)) back += 5;
  const keep = Math.max(0, len - back + 3);
  if (keep < 4) { a.path.length = Math.max(0, a.path.length - 1); return true; }
  a.path[a.path.length - 1] = { x: prev.x + dx / len * keep, y: prev.y + dy / len * keep };
  return true;
}

function endsOn(a, b) {
  const end = a.path[a.path.length - 1];
  if (!end) return false;
  const ex = b.x - end.x, ey = b.y - end.y, e = Math.hypot(ex, ey);
  return e < 1e-6 || e < reach(a, ex / e, ey / e) + reach(b, -ex / e, -ey / e);
}

const later = () => (FPS + Math.floor(simRandom() * 16)) / FPS;

function classifyMM(W, c, T) {
  const A = c.a, B = c.b;
  c.state = MM.RESOLVED;
  if (!willMeet(A, B, T)) return;
  const set = (state, master, slave) => { c.state = state; c.master = master; c.slave = slave; };
  if (A.form && A.form === B.form) {
    const aheadA = Math.cos(B.h) * (A.x - B.x) + Math.sin(B.h) * (A.y - B.y);
    return aheadA > 0 ? set(MM.SPEED_SLAVE, A, B) : set(MM.SPEED_SLAVE, B, A);
  }
  const cA = crushes(W, A, B), cB = crushes(W, B, A);
  const dot = Math.cos(A.h) * Math.cos(B.h) + Math.sin(A.h) * Math.sin(B.h);
  const bAhead = Math.cos(A.h) * (B.x - A.x) + Math.sin(A.h) * (B.y - A.y), aAhead = Math.cos(B.h) * (A.x - B.x) + Math.sin(B.h) * (A.y - B.y);
  if (dot > 0) {
    if (bAhead >= -0.001) { if (aAhead < -0.001 && !cA) return canPass(A, B) ? set(MM.PASS, A, B) : set(MM.SPEED_ONLY, B, A); }
    else if (!cB) return canPass(B, A) ? set(MM.PASS, B, A) : set(MM.SPEED_ONLY, A, B);
  }
  if (A.cls === 9 && B.cls !== 9 && !cA) return set(MM.PATH_AROUND, A, B);
  if (B.cls === 9 && A.cls !== 9 && !cB) return set(MM.PATH_AROUND, B, A);
  const r = relation(A, B);
  switch (r) {
    case 0: case 2: return cB ? set(MM.THROUGH, B, A) : set(MM.PATH_AROUND, B, A);
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
    default: return aAhead <= bAhead ? set(MM.SPEED_ONLY, B, A) : set(MM.SPEED_ONLY, A, B);
  }
}

function beginMM(W, c, T) {
  if (c.state === MM.PATH_AROUND) {
    if (wayRound(W, c.slave, c.master, T)) return;
    if (wayRound(W, c.master, c.slave, T)) { const m = c.master; c.master = c.slave; c.slave = m; return; }
    c.state = MM.LATER; c.until = W.time + later(); c.failures = (c.failures || 0) + 1;
  } else if (c.state === MM.PASS) {
    if (!wayRound(W, c.master, c.slave, T)) { c.state = MM.SPEED_ONLY; const m = c.master; c.master = c.slave; c.slave = m; }
  }
}

function classifyMS(W, c, bodies, T) {
  const A = c.a, B = c.b, crush = crushes(W, A, B);
  c.state = MS.RESOLVED;
  if (A.cls === 9 && !crush && standAside(W, A, B, bodies)) return;
  if (!crush) {
    if (endsOn(A, B) && !(A.cls >= 7 && B.cls <= 6) && stopShort(A, B)) return;
    if (wayRound(W, A, B, T)) { c.state = MS.PATH_AROUND; return; }
  }
  const friend = !W.enemy(unitOf(A), unitOf(B));
  if ((friend || crush) && A.cls !== 5 && !(A.cls === 6 && B.cls === 5) && A.cls !== 9 && standAside(W, A, B, bodies)) return;
  if (crush) { c.state = MS.THROUGH; return; }
  if (A.cls > 6 || B.cls > 6) {
    if (!friend && B.u && A.u) { W.attack(A.u.squad, B.u.squad); c.state = MS.ATTACK; return; }
  }
  c.state = MS.LATER; c.until = W.time + later(); c.failures = (c.failures || 0) + 1;
}

export function tickCollisions(W) {
  const T = db.constants.num('MovingVsMovingLookAheadTime', 1.5), every = Math.max(1, db.constants.num('FramesPerCollisionCheck', 4));
  W.cframe = (W.cframe || 0) + 1;
  for (const b of W.ccBodies || []) { if (b.u) b.u.ccCap = Infinity; else b.q.ccCap = Infinity; }
  const bodies = W.ccBodies = gather(W);
  if (!W.colls) W.colls = [];
  for (const b of bodies) b.cap = Infinity;
  const live = [], here = new Set(bodies);
  for (const c of W.colls) {
    if (!here.has(c.a) || !here.has(c.b)) continue;
    const look = (W.cframe + c.a.id) % every === 0;
    if (c.kind === 'mm') {
      const { master: M, slave: S } = c;
      if (c.state === MM.LATER) {
        if (W.time >= c.until) {
          if (c.failures >= 3) c.state = MM.THROUGH;
          else { classifyMM(W, c, T); if (c.state !== MM.RESOLVED) beginMM(W, c, T); }
        }
      } else {
        if (c.state === MM.PATH_AROUND) {
          if (!S.path.some(p => p.round) || Math.cos(M.h) * (S.x - M.x) + Math.sin(M.h) * (S.y - M.y) < -(radius(M) + radius(S))) continue;
        } else if (look && !(c.a.moving && c.b.moving && willMeet(c.a, c.b, T))) continue;
        if (c.state === MM.PATH_AROUND) M.cap = Math.min(M.cap, crushes(W, M, S) ? Infinity : laneSpeed(M, S, T));
        else if (c.state === MM.SPEED_ONLY || c.state === MM.SPEED_SLAVE) S.cap = Math.min(S.cap, crushes(W, S, M) ? Infinity : holdOff(S, M, T));
        else if (c.state === MM.PASS) {
          if (Math.cos(M.h) * (S.x - M.x) + Math.sin(M.h) * (S.y - M.y) < -(radius(M) + radius(S))) continue;
          S.cap = Math.min(S.cap, Math.min(holdOff(S, M, T), S.max * 0.5));
        }
        if (look && c.state === MM.SPEED_ONLY) { classifyMM(W, c, T); if (c.state !== MM.SPEED_ONLY && c.state !== MM.RESOLVED) beginMM(W, c, T); if (c.state === MM.RESOLVED) continue; }
      }
    } else {
      const A = c.a, B = c.b;
      if (B.moving) continue;
      if (c.state === MS.LATER) {
        if (W.time >= c.until) { if (c.failures >= 3) c.state = MS.THROUGH; else classifyMS(W, c, bodies, T); }
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
  const grid = new Map(), CELLS = 160;
  for (const b of bodies) { const k = Math.floor(b.x / CELLS) * 65536 + Math.floor(b.y / CELLS); (grid.get(k) || grid.set(k, []).get(k)).push(b); }
  const inColl = new Set();
  for (const c of W.colls) { inColl.add(c.a.id * 1e6 + c.b.id); inColl.add(c.b.id * 1e6 + c.a.id); }
  for (const a of bodies) {
    if (!a.moving || (W.cframe + a.id) % every) continue;
    const gx = Math.floor(a.x / CELLS), gy = Math.floor(a.y / CELLS);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++) for (const b of grid.get(i * 65536 + j) || []) {
      if (b === a || inColl.has(a.id * 1e6 + b.id)) continue;
      if (a.cls < 6 && b.cls < 6) continue;
      const rb = radius(b);
      if (Math.abs(b.x - a.x) > 80 + rb || Math.abs(b.y - a.y) > 80 + rb) continue;
      const crushEither = crushes(W, a, b) || crushes(W, b, a);
      let c = null;
      if (b.moving) {
        if (willMeet(a, b, T + (crushEither ? 1.5 : 0))) { c = { kind: 'mm', a, b }; classifyMM(W, c, T); if (c.state === MM.RESOLVED) c = null; else beginMM(W, c, T); }
      } else {
        const far = a.max * (Math.max(T, a.mpi) + (crushes(W, a, b) ? 1.5 : 0));
        if (runsInto(a, b, far) >= 0) { c = { kind: 'ms', a, b }; classifyMS(W, c, bodies, T); if (c.state === MS.RESOLVED || c.state === MS.ATTACK) c = null; }
      }
      if (c) { W.colls.push(c); inColl.add(a.id * 1e6 + b.id); inColl.add(b.id * 1e6 + a.id); }
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
  for (const b of bodies) { if (b.u) b.u.ccCap = b.cap; else b.q.ccCap = b.cap; }
}
