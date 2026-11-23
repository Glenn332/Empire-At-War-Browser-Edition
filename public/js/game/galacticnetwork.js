import { db } from '../gamedata.js';
const INF = 0xffffffff,
  key = x => String(x || '').toUpperCase(),
  edgeCache = new WeakMap();
function edges(g) {
  const n = g.planets.length,
    radius = db.constants.num('MaximumFleetMovementDistance', 100);
  let e = edgeCache.get(g);
  if (
    e &&
    e.n === n &&
    e.routes === g.routes &&
    e.routeCount === g.routes.length &&
    e.radius === radius &&
    g.planets.every((p, i) => p.type === e.types[i] && p.pos === e.pos[i])
  )
    return e;
  const routes = new Map();
  for (const r of g.routes) {
    routes.set(r.a + ':' + r.b, r);
    routes.set(r.b + ':' + r.a, r);
  }
  const dist = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < n; i++) {
    const a = g.planets[i],
      z = a.type.num('Layer_Z_Adjust', 0);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = g.planets[j];
      let distance = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] + z - a.pos[2]);
      const route = routes.get(i + ':' + j);
      if (route) distance /= route.type.num('HS_Speed_Factor', 1);
      else if (distance > radius) continue;
      dist[i * n + j] = Math.trunc(distance * 10) & 65535;
    }
  }
  e = { n, dist, radius, routes: g.routes, routeCount: g.routes.length, types: g.planets.map(p => p.type), pos: g.planets.map(p => p.pos) };
  edgeCache.set(g, e);
  return e;
}
// Cheapest routes from one planet, computed on first use (Dijkstra over usable planets; ties go to the lower planet index).
function routeRow(m, from) {
  let row = m.rows.get(from);
  if (row) return row;
  const { n, use, weight, dist } = m,
    cost = new Uint32Array(n).fill(INF),
    prev = new Int32Array(n).fill(-1);
  row = { cost, prev };
  m.rows.set(from, row);
  cost[from] = 0;
  if (!use[from]) return row;
  const best = new Float64Array(n).fill(Infinity),
    done = new Uint8Array(n);
  best[from] = 0;
  for (;;) {
    let i = -1;
    for (let k = 0; k < n; k++) if (!done[k] && use[k] && best[k] < Infinity && (i < 0 || best[k] < best[i])) i = k;
    if (i < 0) break;
    done[i] = 1;
    const base = i * n;
    for (let j = 0; j < n; j++) {
      if (done[j] || !use[j]) continue;
      const d = dist[base + j];
      if (d < 0) continue;
      const value = best[i] + ((weight[j] + d) >>> 0);
      if (value < best[j]) {
        best[j] = value;
        prev[j] = i;
      }
    }
  }
  for (let j = 0; j < n; j++) if (j !== from && best[j] < Infinity) cost[j] = best[j] >= INF ? INF - 1 : best[j];
  return row;
}
export class GalacticNetwork {
  constructor(ai) {
    this.ai = ai;
    this.cache = new Map();
  }
  matrix(controller) {
    const g = this.ai.game.galaxy,
      id = controller.player.faction,
      old = this.cache.get(id);
    if (old && g.time - old.time < 3) return old;
    const n = g.planets.length,
      { dist } = edges(g),
      view = this.ai.forces();
    const usable = p => !p.background && !p.destroyed && !p.restricted && (g.autoReveal !== false || p.revealed || !!g.humans),
      power = g.planets.map(
        p =>
          view.total(id, false, true, null, p) +
          (p.station && view.related(id, p.stationOwner || p.owner, false) ? p.station.num('AI_Combat_Power', 0) : 0)
      );
    const U = [],
      use = new Uint8Array(n),
      weight = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      if (usable(g.planets[i])) {
        use[i] = 1;
        U.push(i);
      }
      weight[i] = Math.trunc(power[i] / 100) << 16;
    }
    if (
      old &&
      old.n === n &&
      old.dist === dist &&
      old.use &&
      old.use.every((v, i) => v === use[i]) &&
      old.weight.every((v, i) => v === weight[i])
    ) {
      const result = { ...old, time: g.time };
      result.row = from => routeRow(result, from);
      this.cache.set(id, result);
      return result;
    }
    const result = { time: g.time, n, use, weight, dist, rows: new Map(), row: from => routeRow(result, from) };
    this.cache.set(id, result);
    return result;
  }
  path(owner, from, to) {
    const controller = this.ai.controllers.get(key(owner));
    if (!controller || !from || !to) return [];
    if (from === to) return [from, to];
    const m = this.matrix(controller),
      { prev } = m.row(from.index),
      n = m.n,
      out = [to];
    let at = to.index;
    while (at !== from.index) {
      at = prev[at];
      if (at < 0 || out.length > n) return [];
      out.unshift(this.ai.game.galaxy.planets[at]);
    }
    return out;
  }
}
