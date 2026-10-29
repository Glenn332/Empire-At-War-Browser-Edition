import { diag } from '../diag.js';
import { db } from '../gamedata.js';
import { PathCore, MOVING, STILL, SCELL, loadPathWasm } from './pathcore.js';

const LAYER_BITS = { CORVETTE: 1, FRIGATE: 2, CAPITAL: 4, SUPERCAPITAL: 8 };
export const ASTEROID_LAYERS = new Set([2, 4, 8]);
export const ALL_LAYERS = 15;
export function layerMask(type) {
  let m = 0;
  for (const tok of type.str('Space_Layer').toUpperCase().split(/[|,\s]+/)) m |= LAYER_BITS[tok] || 0;
  return m || ALL_LAYERS;
}

const TAU = Math.PI * 2;
const wrap = a => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
const SEARCH_MS = 6;
const STEP_MS = 4;
const WORKER_MS = 60;
const STEP_SEARCHES = 6;
const BATCH_DELAY = 20;
const BATCH_MAX = 8;

export class Pathfinder extends PathCore {
  constructor(world) {
    const c = db.constants, n = (k, d) => c.num(k, d);
    super(world, {
      maxExp: n('SpacePathfindMaxExpansions', 3500), coef: n('CurrentPathCostCoefficientSpace', 0.66), minObs: n('MinObstacleCostSpace', 15),
      xy: n('XYExpansionDistanceSpace', 300), rots: n('MaxRotationsSpace', 24), tries: Math.max(1, n('SpacePathingTries', 6)),
      expGrow: n('SpacePathFailureMaxExpansionsCoefficient', 1.7), rotInc: n('SpacePathFailureRotationExpansionIncrement', 0.5), fwdInc: n('SpacePathFailureForwardExpansionIncrement', 0.5),
      occR: n('OccupationRadiusCoefficientSpace', 1.2), waitCost: n('WaitOperatorCostCoefficient', 0.8), waitDist: n('WaitOperatorBaseFrameTime', 100) * n('WaitOperatorSpeedCoefficient', 0.2),
      slowK: n('WaitOperatorSpeedCoefficient', 0.2), cutK: n('SpacePathFailureDistanceCutoffCoefficient', 0.25), offMap: n('OffMapCostPenalty', 20), horizon: n('SpaceObjectTrackingInterval', 90) / 30 * n('SpaceObjectTrackingTreeCount', 45),
    }, Math.max(10, n('DestinationSearchRadiusIncrementSpace', 50)));
    this.tracksAt = -1;
    this.trackBy = new Map();
    this.version = 0;
    this.structs = -1;
    this.searchMs = SEARCH_MS; this.stepMs = STEP_MS;
    this.note = name => diag.note(name);
    this.worker = null;
    const noWasm = typeof location !== 'undefined' && /[?&]nowasm/.test(location.search);
    this.wasmReady = noWasm ? Promise.resolve(null) : loadPathWasm(new URL('./pathsearch.wasm', import.meta.url)).then(w => { this.wasm = w; return w; });
    this.asked = new Map();
    this.rid = 0;
    if (typeof Worker !== 'undefined' && !(typeof location !== 'undefined' && /[?&]pathsync\b/.test(location.search))) {
      try {
        const wk = new Worker(new URL('./pathworker.js', import.meta.url), { type: 'module' });
        wk.postMessage({ kind: 'init', K: this.K, ringStep: this.ringStep, searchMs: WORKER_MS, noWasm: noWasm });
        wk.onmessage = e => { if (e.data.kind === 'wasm') this.workerWasm = e.data.ok; else this.answer(e.data); };
        wk.onerror = e => { console.warn('route thread', e.message || e); this.worker = null; };
        this.worker = wk;
      } catch (e) { this.worker = null; }
    }
  }

  async deterministic() {
    this.fixed = true;
    this.asked.clear();
    this.searchMs = Infinity;
    this.stepNo = 0; this.bid = 0;
    this.batch = []; this.due = new Map(); this.arrived = new Map();
    await this.wasmReady;
    if (!this.worker) { this.expBudget = 20000; return; }
    const wk = this.worker;
    if (this.workerWasm === undefined && !/[?&]nowasm/.test(location.search)) await new Promise(r => { const was = wk.onmessage; wk.onmessage = e => { was(e); if (e.data.kind === 'wasm') r(); }; setTimeout(r, 10000); });
    wk.onmessage = e => { if (e.data.kind === 'batch') this.arrived.set(e.data.bid, e.data.answers); else if (e.data.kind === 'wasm') this.workerWasm = e.data.ok; };
    wk.onerror = e => console.error('route thread', e.message || e);
    wk.postMessage({ kind: 'fixed' });
  }

  ready() {
    if (!this.fixed || !this.worker) return true;
    const bid = this.due.get(this.stepNo + 1);
    return bid === undefined || this.arrived.has(bid);
  }

  flush() {
    if (!this.fixed || !this.worker || !this.batch.length) return;
    const bid = ++this.bid;
    this.due.set(this.stepNo + BATCH_DELAY, bid);
    this.worker.postMessage({ kind: 'batch', bid, world: this.snapshot(), finds: this.batch });
    this.batch = [];
  }

  sendWorld() {
    const t = this.world.time;
    if (this.sentAt === t) return;
    this.sentAt = t;
    this.worker.postMessage(this.snapshot());
  }
  snapshot() {
    const w = this.world, t = w.time;
    return {
      kind: 'world', time: t, min: { x: w.min.x, y: w.min.y }, max: { x: w.max.x, y: w.max.y }, scell: SCELL,
      fields: w.fields.map(f => ({ x: f.x, y: f.y, r: f.r, asteroid: !!f.asteroid, ion: !!f.ion })),
      still: this.still.map(e => ({ id: e.o.id, x: e.x, y: e.y, dx: e.dx, dy: e.dy, ext: e.ext, layer: e.layer, structure: e.structure })),
      tracks: this.tracking().map(r => ({ id: r.o.id, ext: r.ext, layer: r.layer, ts: r.ts, xs: r.xs, ys: r.ys, minx: r.minx, maxx: r.maxx, miny: r.miny, maxy: r.maxy, hx: r.hx, hy: r.hy })),
    };
  }

  ask(u, goal) {
    const t = this.world.time, a = this.asked.get(u.id);
    if (a && a.gx === goal.x && a.gy === goal.y && (t - a.at < 2 || this.fixed)) return;
    if (this.fixed && this.batch.length >= BATCH_MAX) return;
    if (!this.fixed) this.sendWorld();
    const rid = ++this.rid;
    this.asked.set(u.id, { rid, u, gx: goal.x, gy: goal.y, ver: this.version, at: t });
    (this.fixed ? m => this.batch.push(m) : m => this.worker.postMessage(m))({ kind: 'find', rid, gx: goal.x, gy: goal.y, ship: {
      id: u.id, x: u.x, y: u.y, heading: u.heading, speed: u.speed, maxSpeed: u.maxSpeed, turnRate: u.turnRate, accel: u.accel,
      radius: u.radius, layer: u.layer, ext: this.ext(u), asteroidDamage: !!u.asteroidDamage, shielded: (u.maxShield || 0) > 0,
    } });
  }

  answer(m) {
    const a = this.asked.get(m.id);
    if (!a || a.rid !== m.rid) return;
    this.asked.delete(m.id);
    const u = a.u;
    if (u.dead) return;
    const t = this.world.time, pts = m.pts;
    if (pts && m.partial) pts.partial = true;
    const r = u.route = { gx: a.gx, gy: a.gy, ver: a.ver, pts, i: 0, wp: { x: 0, y: 0, via: true, speed: undefined }, check: t + 1 + (u.id % 7) * 0.05, again: t + 0.5 };
    if (pts) while (r.i < pts.length - 1 && !pts[r.i].turn && pts[r.i].t <= t) r.i++;
  }

  sync() {
    if (this.fixed && this.worker) {
      const bid = this.due.get(++this.stepNo);
      if (bid !== undefined) {
        this.due.delete(this.stepNo);
        for (const m of this.arrived.get(bid) || []) this.answer(m);
        this.arrived.delete(bid);
      }
    }
    const still = this.still, cells = this.cells;
    still.length = 0;
    for (const l of cells.values()) l.length = 0;
    let v = 0;
    for (const o of this.world.solid) {
      if (o.dead || o.hyper || !(o.isStructure || o.speed < 2)) continue;
      if (o.isStructure) v = (v * 31 + o.id + 1) | 0;
      const ext = this.ext(o), e = { o, x: o.x, y: o.y, dx: Math.cos(o.heading || 0), dy: Math.sin(o.heading || 0), ext, layer: o.layer, structure: !!o.isStructure };
      still.push(e);
      const r = ext.r, x0 = Math.floor((o.x - r) / SCELL), x1 = Math.floor((o.x + r) / SCELL), y0 = Math.floor((o.y - r) / SCELL), y1 = Math.floor((o.y + r) / SCELL);
      for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) { const k = ix * 65536 + iy; let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(e); }
    }
    if (v !== this.structs) { this.structs = v; this.version++; }
  }

  tracking() {
    const w = this.world;
    if (w.time - this.tracksAt <= 0.33 && w.time >= this.tracksAt) return this.tracks;
    this.tracksAt = w.time;
    const tracks = this.tracks, now = w.time, H = this.K.horizon;
    tracks.length = 0;
    this.trackBy.clear();
    for (const o of w.solid) {
      if (o.isStructure || o.dead || o.hyper || o.speed < 2) continue;
      const ts = [now], xs = [o.x], ys = [o.y], r = o.route, v = Math.max(o.speed, (o.maxSpeed || 40) * 0.5);
      if (r && r.pts) for (let i = r.i; i < r.pts.length; i++) { const p = r.pts[i], t = Math.max(ts[ts.length - 1] + 0.01, p.t ?? ts[ts.length - 1] + Math.hypot(p.x - xs[xs.length - 1], p.y - ys[ys.length - 1]) / v); ts.push(t); xs.push(p.x); ys.push(p.y); }
      else {
        const ord = o.order, to = r ? { x: r.gx, y: r.gy } : ord && ord.x !== undefined ? ord : { x: o.x + Math.cos(o.heading) * v * H, y: o.y + Math.sin(o.heading) * v * H };
        ts.push(now + Math.hypot(to.x - o.x, to.y - o.y) / v); xs.push(to.x); ys.push(to.y);
      }
      const ext = this.ext(o);
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (let i = 0; i < xs.length; i++) { minx = Math.min(minx, xs[i]); maxx = Math.max(maxx, xs[i]); miny = Math.min(miny, ys[i]); maxy = Math.max(maxy, ys[i]); }
      const k = { o, ext, layer: o.layer, ts, xs, ys, minx: minx - ext.r, maxx: maxx + ext.r, miny: miny - ext.r, maxy: maxy + ext.r, hx: Math.cos(o.heading), hy: Math.sin(o.heading) };
      tracks.push(k); this.trackBy.set(o, k);
    }
    return tracks;
  }

  trackOf(o) { this.tracking(); return this.trackBy.get(o) || null; }

  next(u, goal, park = false) {
    const t = this.world.time;
    let r = u.route;
    if (park && (t >= (u.slotCheck || 0) || t < (u.slotCheck || 0) - 2 || u.slotX !== goal.x || u.slotY !== goal.y)) {
      u.slotCheck = t + 1 + (u.id % 7) * 0.05; u.slotX = goal.x; u.slotY = goal.y;
      const end = this.slot(u, goal.x, goal.y);
      if (end) end.via = false;
      u.slotAt = end;
    }
    const end = park ? u.slotAt : null;
    if (end) { const wp = this.next(u, end); if (u.route) u.route.end = end; return wp || end; }
    const moved = r && ((r.gx - goal.x) ** 2 + (r.gy - goal.y) ** 2 > 150 * 150);
    if (!r || r.ver !== this.version || (moved && t >= r.again) || t >= r.check) {
      const keep = r && r.ver === this.version && !moved && this.stillGood(u, r, goal);
      if (this.stepAt !== t) { this.stepAt = t; this.spent = 0; }
      if (!keep && this.worker) {
        this.ask(u, goal);
        if (r) { r.check = t + 0.05; r.again = t + 0.05; } else return null;
      } else if (!keep && (this.fixed ? this.spent >= STEP_SEARCHES : this.spent >= this.stepMs)) { if (r) r.check = t + 0.05; else return null; }
      else {
        if (!keep) { const t0 = this.fixed ? 0 : performance.now(); r = u.route = { gx: goal.x, gy: goal.y, ver: this.version, pts: this.find(u, goal.x, goal.y), i: 0, wp: { x: 0, y: 0, via: true, speed: undefined } }; this.spent += this.fixed ? 1 : performance.now() - t0; }
        r.check = t + 1 + (u.id % 7) * 0.05;
        r.again = t + 0.5;
      }
    }
    if (!r.pts) return null;
    const near = Math.max(60, Math.min(u.radius * 0.7, 250));
    const last = r.pts.partial ? r.pts.length : r.pts.length - 1;
    for (;;) {
      if (r.i >= last) break;
      const p = r.pts[r.i];
      if (p.turn ? Math.abs(wrap(u.heading - p.h)) < 0.09 : (u.x - p.x) ** 2 + (u.y - p.y) ** 2 < near * near) r.i++;
      else break;
    }
    if (r.i >= last) { if (r.pts.partial) r.ver = -1; return null; }
    const p = r.pts[r.i];
    if (p.turn) { r.wp.x = u.x + Math.cos(p.h) * 1000; r.wp.y = u.y + Math.sin(p.h) * 1000; r.wp.speed = 0; }
    else { r.wp.x = p.x; r.wp.y = p.y; r.wp.speed = p.speed; }
    return r.wp;
  }

  stillGood(u, r, goal) {
    const q = this.ext(u), v = Math.max(1, u.maxSpeed || 40);
    const here = this.sweep(u, q, u.x, u.y, u.x, u.y, 0, 0) & ~MOVING;
    if (!r.pts) return here || !(this.sweep(u, q, u.x, u.y, goal.x, goal.y, 0, Math.hypot(goal.x - u.x, goal.y - u.y) / v) & ~MOVING);
    let ax = u.x, ay = u.y, t0 = 0;
    for (let i = r.i; i < r.pts.length; i++) {
      const p = r.pts[i], dt = Math.hypot(p.x - ax, p.y - ay) / Math.max(1, p.speed || v);
      if ((this.sweep(u, q, ax, ay, p.x, p.y, t0, t0 + dt) & ~MOVING) && !(i === r.i && here)) return false;
      ax = p.x; ay = p.y; t0 += dt;
    }
    return true;
  }
}
