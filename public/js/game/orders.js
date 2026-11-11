import { db } from '../gamedata.js';

const occupation = e => {
  const c = db.constants;
  const turning = e.isSquad || !(e.turnRate > 0) ? 0 : e.maxSpeed / e.turnRate;
  return Math.max(
    e.halfLen || 0,
    (e.radius || 40) * c.num('OccupationRadiusCoefficientSpace', 1.2) + turning * c.num('WaitOperatorSpeedCoefficient', 0.2)
  );
};

export function formationSlots(entities, x, y) {
  const n = entities.length;
  if (n <= 1) return [{ x, y }];
  const slots = new Array(n);
  const layers = new Map();
  entities.forEach((e, i) => {
    const k = e.isSquad ? 'squads' : e.layer;
    if (!layers.has(k)) layers.set(k, []);
    layers.get(k).push(i);
  });
  for (const members of layers.values()) {
    let cx = 0,
      cy = 0;
    for (const i of members) {
      cx += entities[i].x;
      cy += entities[i].y;
    }
    cx /= members.length;
    cy /= members.length;
    members.sort((p, q) => Math.hypot(entities[p].x - cx, entities[p].y - cy) - Math.hypot(entities[q].x - cx, entities[q].y - cy));
    const placed = [];
    members.forEach((i, k) => {
      const e = entities[i],
        R = occupation(e);
      let vx = e.x - cx,
        vy = e.y - cy,
        l = Math.hypot(vx, vy);
      if (l < 1e-3) {
        vx = e.x - x;
        vy = e.y - y;
        l = Math.hypot(vx, vy);
      }
      if (l < 1e-3) {
        vx = 1;
        vy = 0;
        l = 1;
      }
      vx /= l;
      vy /= l;
      let px = x,
        py = y;
      if (k === 0) {
        if (members.length > 1) {
          px += vx * R;
          py += vy * R;
        }
      } else {
        const step = Math.max(50, R * 0.25);
        let clear = false;
        for (let t = 0; t < 30 && !clear; t++) {
          clear = placed.every(q => Math.hypot(px - q.x, py - q.y) >= q.R + R);
          if (!clear) {
            px += vx * step;
            py += vy * step;
          }
        }
        if (!clear) {
          px = x;
          py = y;
        }
      }
      placed.push({ x: px, y: py, R });
      slots[i] = { x: px, y: py };
    });
  }
  return slots;
}

function travelTime(e, p) {
  const d = Math.hypot(p.x - e.x, p.y - e.y);
  if (e.isSquad) return d / Math.max(1, e.speed);
  let turn = Math.atan2(p.y - e.y, p.x - e.x) - e.heading;
  turn = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
  return d / Math.max(1, e.maxSpeed) + (turn * 0.5) / Math.max(0.01, e.turnRate);
}

function formationSpeeds(movers, goal) {
  const times = movers.map(e => (e.isSquad ? 0 : travelTime(e, goal)));
  const longest = Math.max(0, ...times);
  const floor = db.constants.num('SpaceIdleMovementSpeed', 0);
  return movers.map((e, i) => {
    if (e.isSquad || longest <= 0 || movers.length < 2) return 1;
    return Math.max(floor / Math.max(1, e.maxSpeed), Math.min(1, times[i] / longest));
  });
}

const layered = e => !e.isSquad && !e.isFighter && !!e.type.str('Space_Layer').trim();
const layerOrder = [1, 2, 4, 8];

function wingTop(s) {
  let v = Infinity;
  for (const f of s.fighters) if (!f.dead && f.maxSpeed < v) v = f.maxSpeed;
  return v === Infinity ? 0 : v;
}

function wingLow(s) {
  let v = 0;
  for (const f of s.fighters) if (!f.dead && f.minSpeed > v) v = f.minSpeed;
  return v;
}

const typeSpeeds = s => {
  const t = s.type;
  if (!t._wingV) {
    let hi = Infinity,
      lo = 0;
    for (const n of s.members || []) {
      const m = db.type(n);
      if (!m) continue;
      hi = Math.min(hi, m.num('Max_Speed', 0));
      lo = Math.max(lo, m.num('Min_Speed', 0));
    }
    t._wingV = { hi: hi === Infinity ? 0 : hi, lo };
  }
  return t._wingV;
};

function boxOf(s, out) {
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (const f of s.fighters) {
    if (f.dead) continue;
    const r = f.radius || f.hitRadius || 0,
      z = f.z || 0;
    if (f.x - r < x0) x0 = f.x - r;
    if (f.x + r > x1) x1 = f.x + r;
    if (f.y - r < y0) y0 = f.y - r;
    if (f.y + r > y1) y1 = f.y + r;
    if (z - r < z0) z0 = z - r;
    if (z + r > z1) z1 = z + r;
  }
  if (x0 === Infinity) return null;
  out.cx = (x0 + x1) / 2;
  out.cy = (y0 + y1) / 2;
  out.cz = (z0 + z1) / 2;
  out.ex = (x1 - x0) / 2;
  out.ey = (y1 - y0) / 2;
  out.ez = (z1 - z0) / 2;
  return out;
}
const _ba = { cx: 0, cy: 0, cz: 0, ex: 0, ey: 0, ez: 0 },
  _bb = { cx: 0, cy: 0, cz: 0, ex: 0, ey: 0, ez: 0 };

const wingKey = w => w.kind + '|' + w.tx + '|' + w.ty + '|' + (w.target ? w.target.id : '') + '|' + (w.escort ? w.escort.id : '');

function newWing(world, first, kind, gx, gy, target) {
  const id = (world.wingSeq = (world.wingSeq || 0) + 1);
  const w = {
    id,
    squads: [first],
    kind,
    tx: gx,
    ty: gy,
    target: target || null,
    escort: null,
    check: world.time + 1 + ((id % 30) + 1) / 30,
    follow: false,
    at: null,
    reached: false,
    key: '',
    v: 0,
    vAt: -1,
    next: null,
    tail: null,
    gone: false
  };
  w.key = wingKey(w);
  return w;
}

function composeWings(movers, kind, gx, gy, target) {
  const world = movers[0] && movers[0].world;
  const out = new Map();
  if (!world) return out;
  const squads = movers.filter(e => e.isSquad && !e.dead && e.fighters.length),
    ships = movers.filter(e => layered(e) && !e.dead);
  if (!squads.length) return out;
  const gz = target ? posOf(target).z || 0 : 0;
  const pending = squads.slice(),
    wings = [];
  while (pending.length) {
    let li = 0,
      bd = Infinity;
    pending.forEach((s, i) => {
      const p = posOf(s),
        d = Math.hypot(gx - p.x, gy - p.y, gz - (p.z || 0));
      if (d < bd) {
        bd = d;
        li = i;
      }
    });
    const L = pending.splice(li, 1)[0],
      w = newWing(world, L, kind, gx, gy, target),
      bL = boxOf(L, _ba),
      vL = wingTop(L),
      sL = wingLow(L);
    wings.push(w);
    if (!bL || !(vL > 0)) continue;
    const d = bd * 0.33,
      ex = Math.max(bL.ex * 2, d),
      ey = Math.max(bL.ey * 2, d);
    for (let i = 0; i < pending.length; ) {
      const u = pending[i],
        b = boxOf(u, _bb),
        vu = wingTop(u);
      if (
        b &&
        Math.abs(b.cx - bL.cx) <= ex + b.ex &&
        Math.abs(b.cy - bL.cy) <= ey + b.ey &&
        vu !== 0 &&
        wingLow(u) / vL <= 0.9 &&
        sL / vu <= 0.9
      ) {
        w.squads.push(u);
        pending.splice(i, 1);
      } else i++;
    }
  }
  for (const w of wings) {
    if (ships.length) {
      const p = posOf(w.squads[0]);
      let best = Infinity;
      for (const e of ships) {
        const q = (e.x - p.x) ** 2 + (e.y - p.y) ** 2 + ((e.z || 0) - (p.z || 0)) ** 2;
        if (q < best) {
          best = q;
          w.escort = e;
        }
      }
      if (w.escort) {
        w.at = { x: w.escort.x, y: w.escort.y };
        w.reached = false;
        w.key = wingKey(w);
      }
    }
    (world.wings ||= []).push(w);
    for (const s of w.squads) out.set(s, w);
  }
  return out;
}

function staggerStarts(movers, gx, gy) {
  const out = new Map(),
    ships = movers.filter(e => layered(e) && !e.dead);
  if (!ships.length) return out;
  const now = ships[0].world ? ships[0].world.time : 0,
    every = db.constants.num('SpacePathfindFrameDelayDelta', 2) / 30;
  for (const layer of layerOrder) {
    const list = ships.filter(e => e.layer === layer);
    if (!list.length) continue;
    const c = centreOf(list);
    let dx = gx - c.x,
      dy = gy - c.y;
    const l = Math.hypot(dx, dy);
    if (l > 0) {
      dx /= l;
      dy /= l;
    }
    const ahead = e => (e.x - c.x) * dx + (e.y - c.y) * dy;
    list
      .map((e, i) => ({ e, i, a: ahead(e) }))
      .sort((p, q) => q.a - p.a || p.i - q.i)
      .forEach((o, k) => out.set(o.e, now + k * every));
  }
  return out;
}

export function wingSpeed(w, now) {
  if (w.vAt !== now) {
    let v = Infinity;
    for (const s of w.squads) if (!s.dead && s.order.wing === w && s.speed < v) v = s.speed;
    w.v = v;
    w.vAt = now;
  }
  return w.v;
}

export function dropEscort(w) {
  w.escort = null;
  w.follow = false;
  w.at = null;
  w.key = wingKey(w);
}

const inWing = (s, w) => !s.dead && s.fighters.length && (s.order.wing === w || (s.order.resume && s.order.resume.wing === w));

function canMergeWings(a, b) {
  const A = a.squads[0],
    B = b.squads[0];
  if (!A || !B || (A.queue && A.queue.length) || (B.queue && B.queue.length)) return false;
  const sa = typeSpeeds(A),
    sb = typeSpeeds(B);
  if (!(sa.hi >= 0.0001) || !(sb.hi >= 0.0001) || !(sb.lo / sa.hi <= 0.9) || !(sa.lo / sb.hi <= 0.9)) return false;
  const p = boxOf(A, _ba),
    q = boxOf(B, _bb);
  return (
    !!p &&
    !!q &&
    Math.abs(q.cx - p.cx) <= q.ex * 2 + p.ex * 2 &&
    Math.abs(q.cy - p.cy) <= q.ey * 2 + p.ey * 2 &&
    Math.abs(q.cz - p.cz) <= q.ez * 2 + p.ez * 2
  );
}

function absorbWing(a, b) {
  for (const s of b.squads) {
    if (!inWing(s, b)) continue;
    a.squads.push(s);
    if (s.order.wing === b) s.order.wing = a;
    if (s.order.resume && s.order.resume.wing === b) s.order.resume.wing = a;
  }
  b.squads.length = 0;
  b.gone = true;
  a.vAt = -1;
}

export function mergeWings(world) {
  const W = world.wings;
  if (!W || !W.length) return;
  let n = 0;
  for (const w of W) {
    let k = 0;
    for (const s of w.squads) if (inWing(s, w)) w.squads[k++] = s;
    w.squads.length = k;
    if (k) W[n++] = w;
  }
  W.length = n;
  if (n < 2) return;
  const first = (world.wingBuckets ||= new Map());
  first.clear();
  let gone = 0;
  for (const w of W) {
    w.next = null;
    w.gone = false;
    const h = first.get(w.key);
    if (!h) {
      first.set(w.key, w);
      w.tail = w;
      continue;
    }
    let into = null;
    for (let a = h; a; a = a.next)
      if (!a.gone && canMergeWings(a, w)) {
        into = a;
        break;
      }
    if (into) {
      absorbWing(into, w);
      gone++;
    } else {
      h.tail.next = w;
      h.tail = w;
    }
  }
  if (gone) {
    n = 0;
    for (const w of W) if (!w.gone) W[n++] = w;
    W.length = n;
  }
  first.clear();
}

const centreOf = list => {
  let x = 0,
    y = 0;
  for (const p of list) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(1, list.length), y: y / Math.max(1, list.length) };
};

export const fieldPassed = (f, through) =>
  !!through && ((f.asteroid && (through & 4) !== 0) || (f.ion && (through & 8) !== 0) || (f.nebula && (through & 16) !== 0));

export function orderMove(entities, x, y, attackMove = false, waypoint = false, safe = false, through = 0) {
  const movers = entities.filter(e => e.isSquad || e.isMobile);
  const kind = attackMove ? 'attackmove' : 'move';
  const moving = e => e.order.kind === 'move' || e.order.kind === 'attackmove';
  if (waypoint && movers.some(moving)) {
    const from = movers.map(e => {
      const last = e.queue && e.queue.length ? e.queue[e.queue.length - 1] : moving(e) ? e.order : e;
      const v = Object.create(e);
      v.x = last.x;
      v.y = last.y;
      return v;
    });
    const slots = formationSlots(from, x, y),
      speeds = formationSpeeds(from, { x, y });
    movers.forEach((e, i) => {
      const leg = { kind, x: slots[i].x, y: slots[i].y, pace: speeds[i], group: movers.length };
      if (through) leg.through = through;
      if (moving(e)) (e.queue ||= []).push(leg);
      else e.setOrder(leg);
    });
    return movers.length;
  }
  const slots = formationSlots(movers, x, y);
  if (safe)
    movers.forEach((e, i) => {
      if (e.world) slots[i] = e.world.clearOf(e, slots[i].x, slots[i].y, through);
    });
  const speeds = formationSpeeds(movers, { x, y }),
    wings = composeWings(movers, kind, x, y, null),
    starts = staggerStarts(movers, x, y);
  movers.forEach((e, i) => {
    const o = { kind, x: slots[i].x, y: slots[i].y, pace: speeds[i], group: movers.length };
    if (through) o.through = through;
    if (wings.has(e)) o.wing = wings.get(e);
    if (starts.has(e)) o.startAt = starts.get(e);
    e.setOrder(o);
  });
  return movers.length;
}

export function orderPlaced(placed, face, attackMove = false) {
  const kind = attackMove ? 'attackmove' : 'move',
    movers = placed.map(o => o.e),
    c = centreOf(placed),
    speeds = formationSpeeds(movers, c),
    wings = composeWings(movers, kind, c.x, c.y, null),
    starts = staggerStarts(movers, c.x, c.y);
  placed.forEach((o, i) => {
    const ord = { kind, x: o.x, y: o.y, pace: speeds[i], group: placed.length, ...(o.e.isSquad ? {} : { face }) };
    if (wings.has(o.e)) ord.wing = wings.get(o.e);
    if (starts.has(o.e)) ord.startAt = starts.get(o.e);
    o.e.setOrder(ord);
  });
  return placed.length;
}

export function orderAttack(entities, target, hardpoint = null, through = 0) {
  let n = 0;
  const ships = entities.filter(e => !e.isSquad && e.hasWeapons && e.isMobile),
    placed = attackSlots(ships, target, through);
  const T = posOf(target),
    wings = composeWings(
      entities.filter(e => e.isSquad || (e.hasWeapons && e.isMobile)),
      'attack',
      T.x,
      T.y,
      target
    );
  const world = (ships[0] || entities[0] || {}).world;
  let force = null;
  if (world && ships.length) {
    const per = new Map();
    for (const e of ships) per.set(e.layer, (per.get(e.layer) || 0) + 1);
    const most = Math.max(...per.values());
    force = {
      id: (world.forceSeq = (world.forceSeq || 0) + 1),
      target,
      hp: hardpoint,
      through,
      ships: ships.slice(),
      squads: entities.filter(e => e.isSquad),
      staggerEnd: world.time + (most * db.constants.num('SpacePathfindFrameDelayDelta', 2)) / 30
    };
    (world.forces ||= []).push(force);
  }
  for (const e of entities) {
    if (e.isSquad) {
      const o = { kind: 'attack', target, hp: hardpoint };
      if (through) o.through = through;
      if (wings.has(e)) o.wing = wings.get(e);
      if (force) o.force = force;
      e.setOrder(o);
      n++;
    } else if (e.hasWeapons) {
      const at = placed.get(e);
      const o = at
        ? { kind: 'attack', target, offset: at.offset, pace: at.pace, meetAt: at.meetAt, startAt: at.startAt }
        : { kind: 'attack', target };
      if (through) o.through = through;
      if (force && e.isMobile) o.force = force;
      e.setOrder(o);
      e.targetHp = hardpoint;
      e.target = target.isSquad ? target.fighters[0] : target;
      n++;
    }
  }
  return n;
}

const DEG = Math.PI / 180;
const posOf = t => (t.isSquad ? t.fighters[0] || t : t);
const reachOf = (e, T) => (e.type.num('Targeting_Max_Attack_Distance', 0) || e.maxRange || 0) + (T.hitRadius || 0);
const tooCloseOf = (e, T) => e.type.num('Targeting_Min_Attack_Distance', 0) + (T.hitRadius || 0);
const sweep = e => (e.turnRate > 0 ? e.maxSpeed / e.turnRate : 0);
const eta = (e, T) => {
  let yaw = Math.atan2(T.y - e.y, T.x - e.x) - e.heading;
  yaw = Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw)));
  return Math.hypot(T.x - e.x, T.y - e.y) / Math.max(1, e.maxSpeed) + (yaw * 0.5) / Math.max(0.01, e.turnRate);
};

const trackOf = p => (!p.isFighter && p.world && p.world.paths && p.world.paths.trackOf ? p.world.paths.trackOf(p) : null);
function along(k, t) {
  const { ts, xs, ys } = k;
  if (t <= ts[0]) return { x: xs[0], y: ys[0] };
  for (let i = 1; i < ts.length; i++)
    if (t <= ts[i]) {
      const f = (t - ts[i - 1]) / Math.max(1e-6, ts[i] - ts[i - 1]);
      return { x: xs[i - 1] + (xs[i] - xs[i - 1]) * f, y: ys[i - 1] + (ys[i] - ys[i - 1]) * f };
    }
  return { x: xs[xs.length - 1], y: ys[ys.length - 1] };
}
const goingAt = p => ((p.isMobile || p.isFighter) && (p.speed || 0) > 1 ? (p.maxSpeed || p.speed) * ((p.order && p.order.pace) || 1) : 0);

export function leadPoint(target, dt) {
  const p = posOf(target),
    t = Math.max(0, dt || 0);
  if (t <= 0) return { x: p.x, y: p.y };
  const k = trackOf(p);
  if (k) return along(k, p.world.time + t);
  const v = goingAt(p);
  return v > 0 ? { x: p.x + Math.cos(p.heading) * v * t, y: p.y + Math.sin(p.heading) * v * t } : { x: p.x, y: p.y };
}

function meetTime(ships, target) {
  const p = posOf(target),
    v = goingAt(p),
    Vx = Math.cos(p.heading || 0) * v,
    Vy = Math.sin(p.heading || 0) * v;
  const R = Math.min(...ships.map(e => reachOf(e, p)));
  let best = null;
  for (const e of ships) {
    const Dx = p.x - e.x,
      Dy = p.y - e.y,
      s = e.maxSpeed || 0,
      a = Vx * Vx + Vy * Vy - s * s,
      b = 2 * (Vx * Dx + Vy * Dy),
      c = Dx * Dx + Dy * Dy;
    let t;
    if (Math.abs(a) < 1e-4) {
      if (!b) continue;
      t = -c / b;
    } else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const r1 = (-b - Math.sqrt(disc)) / (2 * a),
        r2 = (-b + Math.sqrt(disc)) / (2 * a),
        lo = Math.min(r1, r2),
        hi = Math.max(r1, r2);
      if (hi < 0) continue;
      t = lo > 0 ? lo : hi;
    }
    if (t >= 0 && (best === null || t < best)) {
      best = t;
      const D = Math.sqrt(c);
      if (t > 0) best = R <= D ? Math.max(0, t - (R * t) / D) : 0;
    }
  }
  return best ?? 0;
}

function obstacleAt(world, e, p, r, group, T) {
  const bonus = db.constants.num('SpaceStaticObstacleAvoidanceBonusDistance', 0);
  for (const o of world.units) {
    if (o.dead || group.has(o) || o.isFighter || o.isPad || o === e) continue;
    const dx = p.x - o.x,
      dy = p.y - o.y,
      d = Math.hypot(dx, dy),
      ro = o.radius || o.hitRadius || 0;
    if (o.isStructure) {
      if (d < r + ro + (d > 0 ? bonus * (dy / d) ** 2 : bonus)) return true;
      continue;
    }
    if (o.layer !== e.layer) continue;
    const k = trackOf(o);
    if (k ? nearPath(k, p) < r + k.ext.r : d < r + occupation(o)) return true;
  }
  const inside = (q, kind) => world.fields.some(f => f[kind] && (q.x - f.x) ** 2 + (q.y - f.y) ** 2 < f.r * f.r);
  for (const f of world.fields) {
    const kind = f.asteroid ? 'asteroid' : f.ion ? 'ion' : f.nebula ? 'nebula' : null;
    if (!kind || fieldPassed(f, group.through) || (kind === 'asteroid' && !world.hazardous(f, e)) || inside(e, kind) || inside(T, kind))
      continue;
    if ((p.x - f.x) ** 2 + (p.y - f.y) ** 2 < (f.r + r) ** 2) return true;
  }
  return false;
}

function nearPath(k, p) {
  const { xs, ys } = k;
  let best = Math.hypot(p.x - xs[0], p.y - ys[0]);
  for (let i = 1; i < xs.length; i++) {
    const ax = xs[i - 1],
      ay = ys[i - 1],
      bx = xs[i] - ax,
      by = ys[i] - ay,
      L = bx * bx + by * by;
    const f = L > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * bx + (p.y - ay) * by) / L)) : 0;
    best = Math.min(best, Math.hypot(p.x - ax - bx * f, p.y - ay - by * f));
  }
  return best;
}

export function attackSlots(ships, target, through = 0, maxEta) {
  const out = new Map();
  if (!ships.length || !target) return out;
  const world = ships[0].world,
    now = world.time,
    group = new Set(ships);
  group.through = through;
  const every = db.constants.num('SpacePathfindFrameDelayDelta', 2) / 30;
  const T0 = posOf(target),
    longest = maxEta ?? Math.max(0, ...ships.map(e => eta(e, T0)));
  const floor = db.constants.num('SpaceIdleMovementSpeed', 0);
  const pace = e => (longest > 0 ? Math.max(floor / Math.max(1, e.maxSpeed), Math.min(1, eta(e, T0) / longest)) : 1);
  const layers = new Map();
  for (const e of ships) {
    if (!layers.has(e.layer)) layers.set(e.layer, []);
    layers.get(e.layer).push(e);
  }
  for (const layer of layers.values()) {
    const meet = meetTime(layer, target),
      T = leadPoint(target, meet),
      meetAt = now + meet,
      P = posOf(target);
    T.hitRadius = posOf(target).hitRadius;
    let cx = 0,
      cy = 0;
    for (const e of layer) {
      cx += e.x;
      cy += e.y;
    }
    cx /= layer.length;
    cy /= layer.length;
    let ax = cx - T.x,
      ay = cy - T.y,
      al = Math.hypot(ax, ay);
    if (al < 1e-3) {
      ax = 1;
      ay = 0;
    } else {
      ax /= al;
      ay /= al;
    }
    const order = layer.slice().sort((p, q) => (q.x - cx) * ax + (q.y - cy) * ay - ((p.x - cx) * ax + (p.y - cy) * ay));
    const taken = [],
      rest = [];
    for (const e of order) {
      const d = Math.hypot(e.x - P.x, e.y - P.y);
      if (d <= reachOf(e, T) && d > tooCloseOf(e, T)) {
        out.set(e, { offset: { x: e.x - T.x, y: e.y - T.y }, meetAt, startAt: now });
        taken.push({ x: e.x, y: e.y, r: occupation(e) });
      } else rest.push(e);
    }
    let d = 100000,
      best = 0;
    const placed = [];
    while (rest.length) {
      let kmax = 0,
        sum = 0,
        lim = Infinity;
      for (const e of rest) {
        sum += occupation(e);
        lim = Math.min(lim, Math.min(0.9 * reachOf(e, T), Math.abs(d)));
        if (sum <= Math.PI * lim) kmax++;
        else break;
      }
      let lo = 1,
        hi = Math.min(kmax, rest.length),
        got = null,
        k = 0,
        lastOut = null,
        first = true;
      while (lo <= hi) {
        const mid = first ? hi : (lo + hi) >> 1;
        first = false;
        const res = ring(rest.slice(0, mid), T, cx, cy, d, taken.slice(), world, group);
        if (res.ok) {
          got = res;
          k = mid;
          lo = mid + 1;
        } else {
          lastOut = res.outR;
          hi = mid - 1;
        }
      }
      if (!k) d = (lastOut ?? d) - 200;
      else {
        for (const [e, p] of got.places) {
          out.set(e, { offset: { x: p.x - T.x, y: p.y - T.y }, pace: pace(e), meetAt });
          placed.push(e);
          taken.push({ x: p.x, y: p.y, r: occupation(e) });
        }
        rest.splice(0, k);
        d = got.outR;
      }
      best = Math.max(best, d);
      if (d < -best && rest.length) break;
    }
    placed.sort((p, q) => (q.x - cx) * -ax + (q.y - cy) * -ay - ((p.x - cx) * -ax + (p.y - cy) * -ay));
    placed.forEach((e, i) => {
      out.get(e).startAt = now + i * every;
    });
  }
  return out;
}

const _rp = { x: 0, y: 0, z: 0 };

function recheckLayer(world, F, list, T) {
  const now = world.time;
  let ok = true;
  for (const e of list) {
    const o = e.order;
    if (world.fog !== false && e.player && !(T.seenBy & e.player.bit)) return;
    if (F.target.isSquad) {
      const X = F.target.target;
      if (X && !X.dead && ((X.order && X.order.force === F) || (X.squad && X.squad.order.force === F))) return;
    }
    const hp = F.hp && F.hp.alive && F.hp.unit === T ? F.hp : null,
      P = hp ? hp.worldPos(_rp) : T,
      reach = reachOf(e, T),
      near = tooCloseOf(e, T),
      r = e.route && e.route.pts && e.route.pts.length ? e.route.pts[e.route.pts.length - 1] : e.slotAt || e,
      G = leadPoint(F.target, Math.max(0, (o.meetAt ?? now) - now)),
      dG = Math.hypot(G.x - r.x, G.y - r.y),
      dP = Math.hypot(P.x - e.x, P.y - e.y);
    if (!(dG <= reach || dP <= reach) || dP < near) ok = false;
  }
  if (ok) return;
  const first = list[0],
    ref = (first.maxSpeed * (first.order.pace ?? 1)) / 900,
    placed = attackSlots(list, F.target, F.through || 0, ref);
  let most = 0;
  for (const e of list) {
    const at = placed.get(e);
    if (!at) continue;
    const o = e.order;
    o.offset = at.offset;
    o.meetAt = at.meetAt;
    o.startAt = at.startAt;
    if (at.pace !== undefined) o.pace = at.pace;
    else delete o.pace;
    most++;
  }
  F.staggerEnd = Math.max(F.staggerEnd, now + (most * db.constants.num('SpacePathfindFrameDelayDelta', 2)) / 30);
  F.replans = (F.replans || 0) + 1;
}

export function recheckForces(world) {
  const L = world.forces;
  if (!L || !L.length) return;
  const N = db.constants.num('MovementReevaluationFrameCount', 10);
  if (!(N > 0)) return;
  const frame = Math.round(world.time * 30);
  let n = 0;
  for (const F of L) {
    if (F.id % N !== frame % N) {
      L[n++] = F;
      continue;
    }
    let k = 0;
    for (const e of F.ships) if (!e.dead && e.order.force === F) F.ships[k++] = e;
    F.ships.length = k;
    let q = 0;
    for (const s of F.squads) if (!s.dead && s.order.force === F) F.squads[q++] = s;
    F.squads.length = q;
    if (!k && !q) continue;
    L[n++] = F;
    if (!k || F.staggerEnd > world.time + 1e-6) continue;
    const T = posOf(F.target);
    if (!T || T.dead || F.target.dead) continue;
    if (!F.target.isSquad && (!F.hp || !F.hp.alive)) {
      const a = F.ships[0],
        h = world.pickHardpoint ? world.pickHardpoint(F.target, a.x, a.y, a) : null;
      if (h) {
        F.hp = h;
        for (const e of F.ships) e.targetHp = h;
        for (const s of F.squads) s.order.hp = h;
      }
    }
    for (const layer of layerOrder) {
      const list = F.ships.filter(e => e.layer === layer && e.order.offset);
      if (list.length) recheckLayer(world, F, list, T);
    }
  }
  L.length = n;
}

function ring(ships, T, cx, cy, d, taken, world, group) {
  const n = ships.length,
    rs = ships.map(occupation);
  const minRng = 0.9 * Math.min(...ships.map(e => reachOf(e, T))),
    maxR = Math.max(...rs),
    minD = Math.max(...ships.map(e => tooCloseOf(e, T)));
  let Rp = d - maxR;
  if (Math.abs(Rp) < maxR) Rp = -maxR;
  if (Rp < -minRng) return { ok: false };
  let R = Math.min(Rp, minRng);
  if (Math.abs(R) < minD) R = (R < 0 ? -1 : 1) * minD;
  const sg = R < 0 ? -1 : 1,
    aR = Math.abs(R);
  let ux = cx - T.x,
    uy = cy - T.y,
    ul = Math.hypot(ux, uy);
  if (ul < 1e-3) {
    ux = 1;
    uy = 0;
  } else {
    ux /= ul;
    uy /= ul;
  }
  const at = th => ({ x: T.x + (Math.cos(th) * ux - Math.sin(th) * uy) * R, y: T.y + (Math.sin(th) * ux + Math.cos(th) * uy) * R });
  const outR = Math.abs(R - maxR) < maxR ? -maxR : R - maxR;
  const dx = -ux,
    dy = -uy,
    px = -dy,
    py = dx;
  const key = (e, i) => {
    let a = Math.atan2(Math.sin(e.heading - Math.atan2(dy, dx)), Math.cos(e.heading - Math.atan2(dy, dx)));
    if (a > Math.PI / 2) a -= Math.PI;
    else if (a < -Math.PI / 2) a += Math.PI;
    const turn = (1 - Math.cos(a)) * sweep(e);
    return (e.x - cx) * px + (e.y - cy) * py + (a > 0 ? -turn : turn);
  };
  const idx = ships.map((e, i) => i).sort((p, q) => key(ships[q], q) - key(ships[p], p));
  const free = (p, r, e) =>
    p.x >= world.min.x &&
    p.x <= world.max.x &&
    p.y >= world.min.y &&
    p.y <= world.max.y &&
    taken.every(o => Math.hypot(p.x - o.x, p.y - o.y) >= r + o.r) &&
    !obstacleAt(world, e, p, r, group, T);
  let thc = 0;
  for (let k = 0; k <= 45; k++) {
    const th = (k & 1 ? 1 : -1) * Math.ceil(k / 2) * 4 * DEG;
    if (free(at(th), rs[idx[0]], ships[idx[0]])) {
      thc = th;
      break;
    }
  }
  const m = n >> 1;
  let Ls = 0,
    Rs = 0;
  idx.forEach((i, k) => {
    if (k < m) Ls += 2.04 * rs[i];
    else if (k > m) Rs += 2.04 * rs[i];
  });
  const w = 0.5 * (Ls - Rs);
  const half = c => (c >= 2 * aR ? Math.PI : Math.acos(Math.sqrt(Math.max(0, R * R - (c * c) / 4)) / aR));
  const thm = thc + sg * half(w);
  const H = Math.min(Math.abs(Math.atan2(Ls + Rs + rs[idx[m]], aR)), Math.PI / 2);
  const places = new Map(),
    put = (k, th) => {
      const i = idx[k],
        p = at(th);
      if (!free(p, rs[i], ships[i])) return false;
      places.set(ships[i], p);
      taken.push({ x: p.x, y: p.y, r: rs[i] });
      return true;
    };
  let th = thm;
  while (!put(m, th)) {
    th = th > 0 ? -th : th < 0 ? -th + 5 * DEG : 5 * DEG;
    if (Math.abs(th - thc) >= H) return { ok: false, outR };
  }
  const mid = th;
  for (const dir of [-1, 1]) {
    th = mid;
    for (let k = m + dir; k >= 0 && k < n; k += dir) {
      th += dir * sg * 2 * half(1.02 * (rs[idx[k - dir]] + rs[idx[k]]));
      while (!put(k, th)) {
        th += dir * sg * 5 * DEG;
        if (Math.abs(th - thc) >= H) return { ok: false, outR };
      }
      if (Math.abs(th - thc) >= H) return { ok: false, outR };
    }
  }
  return { ok: true, places, outR };
}

export function orderGuard(entities, target, x, y, through = 0) {
  const movers = entities.filter(e => e.isSquad || e.isMobile);
  if (target) {
    for (const e of movers) e.setOrder(through ? { kind: 'guard', target, through } : { kind: 'guard', target });
    return movers.length;
  }
  const slots = formationSlots(movers, x, y);
  movers.forEach((e, i) => e.setOrder(through ? { kind: 'guard', x: slots[i].x, y: slots[i].y, through } : { kind: 'guard', x: slots[i].x, y: slots[i].y }));
  return movers.length;
}

export function orderStop(entities) {
  for (const e of entities) {
    if (e.isSquad || e.isMobile) e.setOrder({ kind: 'idle' });
    if (!e.isSquad) e.target = null;
  }
}
