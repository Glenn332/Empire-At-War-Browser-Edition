import { db } from '../gamedata.js';
import { bribeRun, payBribes, hudQuote, passByBribe, canBribe } from './galacticbribe.js';
import { humanRoute } from './humanroute.js';
import { conflictAt } from './galacticrelation.js';
import { aiRoute, hopBlocked } from './airoute.js';

export const LOGIC_FPS = 30;

export function hyperspaceSpeed(units) {
  let lo = Infinity;
  const take = t => {
    if (!t.bool('Hyperspace')) return;
    const v = t.num('Hyperspace_Speed', NaN);
    lo = Math.min(lo, Number.isFinite(v) ? v : 1);
  };
  for (const { type: t } of units) {
    if (t.tag === 'Squadron') {
      for (const n of t.list('Squadron_Units')) {
        const m = db.type(n);
        if (m) take(m);
      }
    } else take(t);
  }
  return Number.isFinite(lo) ? lo : 0;
}

export function baseSpeed(fleet) {
  const f = db.faction(fleet.owner);
  return (
    hyperspaceSpeed(fleet.units) *
    (f ? f.num('Hyperspace_Speed_Factor', 0.07) : 0.07) *
    db.constants.num('Object_Max_Speed_Multiplier_Galactic', 5)
  );
}

export function legFactor(galaxy, a, b, owner = null) {
  let k = 1;
  const r = galaxy.routes.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  if (r) k = Math.max(k, r.type.num('HS_Speed_Factor', 1));
  if (
    owner &&
    db.faction(owner)?.bool('Benefits_From_Corruption') &&
    (galaxy.planets[a].currentCorruption ?? -1) !== -1 &&
    (galaxy.planets[b].currentCorruption ?? -1) !== -1
  )
    k = Math.max(k, db.constants.num('Corruption_Hyperspace_Bonus', 1));
  return k;
}

const fastest = new WeakMap();
function routeFactor(galaxy) {
  let f = fastest.get(galaxy.links);
  if (f === undefined) {
    f = 1;
    for (const list of galaxy.links) for (const l of list) if (l.route) f = Math.max(f, l.route.type.num('HS_Speed_Factor', 1) || 1);
    fastest.set(galaxy.links, f);
  }
  return f;
}

export function findPath(galaxy, from, to, canEnter = null, penalty = null) {
  if (from === to) return [];
  const planets = galaxy.planets,
    n = planets.length,
    g = new Float64Array(n).fill(Infinity),
    f = new Float64Array(n),
    prev = new Int32Array(n).fill(-1),
    state = new Uint8Array(n),
    slot = new Int32Array(n).fill(-1),
    heap = [],
    goal = planets[to].pos,
    factor = routeFactor(galaxy);
  const h = i => {
    const q = planets[i].pos;
    return Math.hypot(q[0] - goal[0], q[1] - goal[1], q[2] - goal[2]) / factor;
  };
  const put = (k, i) => {
    heap[k] = i;
    slot[i] = k;
  };
  const up = k => {
    const i = heap[k];
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!(f[i] < f[heap[parent]])) break;
      put(k, heap[parent]);
      k = parent;
    }
    put(k, i);
  };
  const down = k => {
    const i = heap[k],
      size = heap.length;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && f[heap[c + 1]] < f[heap[c]]) c++;
      if (!(f[heap[c]] < f[i])) break;
      put(k, heap[c]);
      k = c;
    }
    put(k, i);
  };
  g[from] = 0;
  f[from] = h(from);
  state[from] = 1;
  heap.push(from);
  slot[from] = 0;
  while (heap.length) {
    const u = heap[0],
      last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      slot[last] = 0;
      down(0);
    }
    state[u] = 2;
    if (u === to) {
      const path = [];
      for (let i = to; i !== from; i = prev[i]) path.unshift(i);
      return path;
    }
    for (const l of galaxy.links[u]) {
      const v = l.to;
      if (state[v] === 2) continue;
      if (canEnter && !canEnter(planets[v], v === to)) continue;
      const extra = penalty ? penalty(planets[v], v === to, planets[u]) : 0;
      if (extra === null) continue;
      const cost = g[u] + l.cost + extra;
      if (!(cost < g[v])) continue;
      g[v] = cost;
      f[v] = cost + h(v);
      prev[v] = u;
      if (state[v] === 1) up(slot[v]);
      else {
        state[v] = 1;
        heap.push(v);
        up(heap.length - 1);
      }
    }
  }
  return null;
}

export function blocks(galaxy, p, owner, fleet = null) {
  return conflictAt(galaxy, p, owner, fleet);
}

function piracyTariff(galaxy, fleet, from) {
  const origin = galaxy.planets[from];
  if ((origin.currentCorruption ?? -1) !== 1) return;
  const ben = galaxy.players.find(p => db.faction(p.faction)?.bool('Benefits_From_Corruption'));
  if (
    !ben ||
    ben.faction === fleet.owner ||
    db
      .faction(ben.faction)
      ?.list('Allies')
      .some(n => n.toUpperCase() === String(fleet.owner).toUpperCase())
  )
    return;
  const value = fleet.units.reduce((sum, u) => sum + (u.carries || u.type).num('Piracy_Value_Credits', 0), 0);
  if (value > 0) origin.piracy = (origin.piracy || 0) + value;
}

export function pullIn(galaxy, p, arriving) {
  const planet = galaxy.planets[p],
    same = (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase(),
    pulled = [];
  for (const o of galaxy.fleets) {
    if (o === arriving || !o.leg || o.dest !== p || !(same(o.owner, arriving.owner) || same(o.owner, planet.owner))) continue;
    o.slot = o.destinationSlot ?? arrivalSlot(galaxy, o, p);
    delete o.destinationSlot;
    o.leg = null;
    o.path = [];
    o.planet = p;
    pulled.push(o);
  }
  return pulled;
}

export function bribeQuote(galaxy, fleet, to, me, canEnter = null) {
  if (fleet.planet < 0 || fleet.planet === to) return 0;
  const path = findPath(galaxy, fleet.planet, to, canEnter, humanRoute(galaxy, fleet));
  return path && path.length ? hudQuote(galaxy, fleet, path, me) : 0;
}

export function arrivalSlot(galaxy, fleet, p) {
  const same = (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase();
  const taken = new Set(
    galaxy.fleets.filter(o => o !== fleet && !o.leg && o.planet === p && o.units.length && same(o.owner, fleet.owner)).map(o => o.slot ?? 0)
  );
  for (const s of [fleet.departSlot ?? 0, 1, 2, 0]) if (s <= 2 && !taken.has(s)) return s;
  return 0;
}

function barred(galaxy, fleet, to) {
  const planet = galaxy.planets[to];
  if (!planet?.restricted) return false;
  const owner = galaxy.players.find(p => p.faction === fleet.owner);
  return !!owner && !owner.ai && !galaxy.storyEntry?.(fleet, planet);
}

function validPath(galaxy, from, to, path) {
  if (!Array.isArray(path) || !path.length || path.at(-1) !== to) return false;
  let at = from;
  for (const next of path) {
    if (!Number.isInteger(next) || !(galaxy.links[at] || []).some(l => l.to === next)) return false;
    at = next;
  }
  return true;
}

export function humanPath(galaxy, fleet, to, from = fleet.planet) {
  return from >= 0 ? findPath(galaxy, from, to, null, humanRoute(galaxy, fleet)) : null;
}

export function orderMove(galaxy, fleet, to, canEnter = null, slot = null, options = {}) {
  const from = fleet.planet;
  if (from < 0 || from === to) return false;
  const order = options.human !== undefined;
  if (order && barred(galaxy, fleet, to)) {
    galaxy.onBounce?.(fleet, to);
    return false;
  }
  const ai = options.status !== undefined && !options.human;
  const path = validPath(galaxy, from, to, options.path)
    ? options.path.slice()
    : findPath(galaxy, from, to, canEnter, options.human ? humanRoute(galaxy, fleet) : ai ? aiRoute(galaxy, fleet, options.status) : null);
  if (!path || !path.length || baseSpeed(fleet) <= 0) return false;
  if (ai && hopBlocked(galaxy, fleet, path[0], to, options.status)) return false;
  if (!options.free) {
    const run = options.human ? bribeRun(galaxy, fleet, path, true) : { nodes: [], total: 0 };
    if (run.total > 0 && !payBribes(galaxy, fleet, run)) {
      options.denied && options.denied(run);
      return false;
    }
  }
  fleet.aiStatus = ai ? options.status : undefined;
  fleet.humanOrder = !!(options.human || options.free);
  fleet.playerOrder = order;
  fleet.path = path;
  fleet.dest = to;
  fleet.departSlot = fleet.slot ?? 0;
  if (slot === null || slot === undefined) delete fleet.destinationSlot;
  else fleet.destinationSlot = slot;
  piracyTariff(galaxy, fleet, from);
  startLeg(galaxy, fleet, from, path[0]);
  fleet.planet = -1;
  galaxy.onDepart?.(fleet);
  return true;
}

export function retreatFleet(galaxy, fleet, to) {
  const from = fleet.planet;
  if (from < 0 || to === from) return false;
  fleet.path = [to];
  fleet.dest = to;
  startLeg(galaxy, fleet, from, to);
  fleet.planet = -1;
  return true;
}

function startLeg(galaxy, fleet, a, b) {
  const A = galaxy.planets[a].pos,
    B = galaxy.planets[b].pos,
    rA = galaxy.planets[a].radius || 0,
    rB = galaxy.planets[b].radius || 0;
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]],
    len = Math.hypot(...d) || 1,
    u = d.map(x => x / len);
  fleet.leg = {
    a,
    b,
    from: A.map((x, i) => x + u[i] * rA),
    to: B.map((x, i) => x - u[i] * rB),
    dir: u,
    speed: baseSpeed(fleet) * legFactor(galaxy, a, b, fleet.owner),
    t: 0
  };
  fleet.pos = fleet.leg.from.slice();
}

function legFrames(L) {
  const len = Math.hypot(L.to[0] - L.from[0], L.to[1] - L.from[1], L.to[2] - L.from[2]);
  return Math.max(1, Math.floor(len / L.speed - 2) + 1);
}

export function stepFleets(galaxy, frames, arrive) {
  for (const f of galaxy.fleets) {
    if (!f.leg) continue;
    let left = frames;
    while (f.leg && left > 0) {
      const L = f.leg;
      if (L.t === undefined) L.t = Math.hypot(f.pos[0] - L.from[0], f.pos[1] - L.from[1], f.pos[2] - L.from[2]) / L.speed;
      const need = legFrames(L) - L.t;
      if (need > left) {
        L.t += left;
        for (let i = 0; i < 3; i++) f.pos[i] = L.from[i] + L.dir[i] * L.speed * L.t;
        left = 0;
        break;
      }
      left -= Math.max(0, need);
      f.pos = L.to.slice();
      const p = L.b;
      f.path.shift();
      if (f.playerOrder && barred(galaxy, f, p)) {
        galaxy.onBounce?.(f, p);
        f.path = [L.a];
        f.dest = L.a;
        startLeg(galaxy, f, p, L.a);
        continue;
      }
      const stop =
        !f.path.length || (blocks(galaxy, p, f.owner, f) && (!canBribe(f.owner) || (!f.humanOrder && !passByBribe(galaxy, f, p))));
      if (stop) {
        f.slot = (p === f.dest ? f.destinationSlot : undefined) ?? arrivalSlot(galaxy, f, p);
        delete f.destinationSlot;
        f.leg = null;
        f.path = [];
        f.planet = p;
        arrive && arrive(f, p);
      } else {
        if (f.aiStatus !== undefined && f.dest >= 0) {
          const again = findPath(galaxy, p, f.dest, null, aiRoute(galaxy, f, f.aiStatus));
          if (!again || !again.length || hopBlocked(galaxy, f, again[0], f.dest, f.aiStatus)) {
            f.slot = arrivalSlot(galaxy, f, p);
            delete f.destinationSlot;
            f.leg = null;
            f.path = [];
            f.planet = p;
            arrive && arrive(f, p);
            continue;
          }
          f.path = again;
        }
        startLeg(galaxy, f, p, f.path[0]);
      }
    }
  }
}
