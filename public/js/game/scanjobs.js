import { F, O, MoveScene, moveFighter } from './fighterflight.js';
import { DF, DS, DecideScene, decideSquad } from './fighterdecide.js';

export const UNIT_CELL = 1024;
export const UNIT_PAD = 200;
export const CAP_UNITS = 1 << 15;
export const CAP_REQS = 1 << 15;
export const OUT_CAP = 1 << 20;
export const CTL = { GEN: 0, COUNT: 1, NEXT: 2, DONE: 3, UNITS: 4, CHUNK: 5, ACTIVE: 6, READY: 7, KIND: 8 };
export const JOB = { SCAN: 0, MOVE: 1, DECIDE: 2 };

// Fighter decisions shared with the job threads, one squadron per job.
export const DECIDE_CAP = { FIGHTERS: 1 << 15, SQUADS: 1 << 13 };
export const DECIDE_HEAD = { SQUADS: 0, SIDE_MIN: 1, SIDE_MAX: 2 };

function makeDecideShared(S) {
  return {
    head: new Float64Array(new S(64)),
    fighters: new Float64Array(new S(DECIDE_CAP.FIGHTERS * DF.STRIDE * 8)),
    squads: new Float64Array(new S(DECIDE_CAP.SQUADS * DS.STRIDE * 8))
  };
}

export function decideWork(sh, scene) {
  const ctl = sh.ctl,
    count = Atomics.load(ctl, CTL.COUNT),
    chunk = Atomics.load(ctl, CTL.CHUNK) || 8,
    head = sh.decide.head;
  scene.sideMin = head[DECIDE_HEAD.SIDE_MIN];
  scene.sideMax = head[DECIDE_HEAD.SIDE_MAX];
  for (;;) {
    const from = Atomics.add(ctl, CTL.NEXT, chunk);
    if (from >= count) break;
    const to = Math.min(count, from + chunk);
    for (let i = from; i < to; i++) decideSquad(scene, i);
    if (Atomics.add(ctl, CTL.DONE, to - from) + (to - from) >= count) Atomics.notify(ctl, CTL.DONE);
  }
}

export const sharedDecideScene = decide => new DecideScene(decide.fighters, decide.squads);

// Fighter moves shared with the job threads. Battles past these sizes move the rest on the battle thread.
export const MOVE_CAP = {
  FIGHTERS: 1 << 15,
  OBSTACLES: 1 << 13,
  CELLS: 1 << 16,
  ITEMS: 1 << 18,
  MESHES: 1024,
  MESH_FLOATS: 1 << 21,
  MESH_INTS: 1 << 21
};
export const MOVE_HEAD = { CELLS: 0, MIN_X: 1, MIN_Y: 2, MAX_X: 3, MAX_Y: 4, DT: 5, MESHES: 6 };
const MESH_ROW = 16;

function makeMoveShared(S) {
  return {
    head: new Float64Array(new S(64)),
    fighters: new Float64Array(new S(MOVE_CAP.FIGHTERS * F.STRIDE * 8)),
    obstacles: new Float64Array(new S(MOVE_CAP.OBSTACLES * O.STRIDE * 8)),
    keys: new Float64Array(new S(MOVE_CAP.CELLS * 8)),
    starts: new Int32Array(new S((MOVE_CAP.CELLS + 1) * 4)),
    items: new Int32Array(new S(MOVE_CAP.ITEMS * 4)),
    status: new Int32Array(new S(MOVE_CAP.FIGHTERS * 4)),
    meshRows: new Int32Array(new S(MOVE_CAP.MESHES * MESH_ROW * 4)),
    meshFloats: new Float32Array(new S(MOVE_CAP.MESH_FLOATS * 4)),
    meshInts: new Int32Array(new S(MOVE_CAP.MESH_INTS * 4))
  };
}

// A move scene over the shared columns. On a job thread the collision meshes come from the shared pool; a
// mesh that did not fit there is only on the battle thread, which then moves that fighter itself.
export function sharedMoveScene(move, localMeshes = null) {
  const views = new Map();
  const meshes = ref => {
    if (localMeshes) return localMeshes[ref] || null;
    let view = views.get(ref);
    if (view !== undefined) return view;
    const r = move.meshRows,
      at = ref * MESH_ROW;
    if (ref >= move.head[MOVE_HEAD.MESHES] || r[at] !== 1) return null;
    const floats = (off, len) => move.meshFloats.subarray(off, off + len),
      ints = (off, len) => move.meshInts.subarray(off, off + len);
    view = {
      T: floats(r[at + 1], r[at + 2]),
      box: floats(r[at + 3], r[at + 4]),
      order: ints(r[at + 5], r[at + 6]),
      left: ints(r[at + 7], r[at + 8]),
      right: ints(r[at + 9], r[at + 8]),
      first: ints(r[at + 10], r[at + 8]),
      count: ints(r[at + 11], r[at + 8])
    };
    views.set(ref, view);
    return view;
  };
  return new MoveScene(move.fighters, move.obstacles, move.keys, move.starts, move.items, meshes);
}

export function readMoveHead(scene, move) {
  const h = move.head;
  scene.cellCount = h[MOVE_HEAD.CELLS];
  scene.minX = h[MOVE_HEAD.MIN_X];
  scene.minY = h[MOVE_HEAD.MIN_Y];
  scene.maxX = h[MOVE_HEAD.MAX_X];
  scene.maxY = h[MOVE_HEAD.MAX_Y];
  scene.dt = h[MOVE_HEAD.DT];
}

export function moveWork(sh, scene) {
  const ctl = sh.ctl,
    count = Atomics.load(ctl, CTL.COUNT),
    chunk = Atomics.load(ctl, CTL.CHUNK) || 32,
    status = sh.move.status;
  readMoveHead(scene, sh.move);
  for (;;) {
    const from = Atomics.add(ctl, CTL.NEXT, chunk);
    if (from >= count) break;
    const to = Math.min(count, from + chunk);
    for (let i = from; i < to; i++) status[i] = moveFighter(scene, i) ? 1 : 0;
    if (Atomics.add(ctl, CTL.DONE, to - from) + (to - from) >= count) Atomics.notify(ctl, CTL.DONE);
  }
}

export function makeShared(workers) {
  const S = typeof SharedArrayBuffer === 'function' ? SharedArrayBuffer : ArrayBuffer;
  return {
    move: workers ? makeMoveShared(S) : null,
    decide: workers ? makeDecideShared(S) : null,
    ctl: new Int32Array(new S(64)),
    x: new Float64Array(new S(CAP_UNITS * 8)),
    y: new Float64Array(new S(CAP_UNITS * 8)),
    range: new Float64Array(new S(CAP_UNITS * 8)),
    team: new Int32Array(new S(CAP_UNITS * 4)),
    ok: new Int32Array(new S(CAP_UNITS * 4)),
    seen: new Int32Array(new S(CAP_UNITS * 4)),
    bit: new Int32Array(new S(CAP_UNITS * 4)),
    reqs: new Int32Array(new S(CAP_REQS * 4)),
    res: new Int32Array(new S(CAP_REQS * 12)),
    outs: Array.from({ length: workers + 1 }, () => new Int32Array(new S(OUT_CAP * 4)))
  };
}

export class Grid {
  constructor() {
    this.cells = new Map();
    this.gen = -1;
  }

  build(sh, n, gen) {
    if (this.gen === gen) return;
    this.gen = gen;
    const cells = this.cells;
    for (const l of cells.values()) l.length = 0;
    for (let i = 0; i < n; i++) {
      if (sh.ok[i] < 0) continue;
      const k = Math.floor(sh.x[i] / UNIT_CELL) * 65536 + Math.floor(sh.y[i] / UNIT_CELL);
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      l.push(i);
    }
  }

  gather(sh, u, out) {
    out.length = 0;
    const range = sh.range[u],
      r2 = range * range,
      team = sh.team[u],
      bit = sh.bit[u],
      ux = sh.x[u],
      uy = sh.y[u],
      pad = range + UNIT_PAD,
      x0 = Math.floor((ux - pad) / UNIT_CELL),
      x1 = Math.floor((ux + pad) / UNIT_CELL),
      y0 = Math.floor((uy - pad) / UNIT_CELL),
      y1 = Math.floor((uy + pad) / UNIT_CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++) {
        const l = this.cells.get(ix * 65536 + iy);
        if (!l) continue;
        for (let j = 0; j < l.length; j++) {
          const o = l[j];
          if (sh.ok[o] !== 1 || sh.team[o] === team || !(sh.seen[o] & bit)) continue;
          const dx = ux - sh.x[o],
            dy = uy - sh.y[o];
          if (dx * dx + dy * dy <= r2) out.push(o);
        }
      }
    if (out.length > 1) out.sort((a, b) => a - b);
    return out;
  }
}

export function work(sh, grid, slot, scratch) {
  const ctl = sh.ctl,
    count = Atomics.load(ctl, CTL.COUNT),
    chunk = Atomics.load(ctl, CTL.CHUNK) || 8,
    out = sh.outs[slot];
  let at = 0;
  for (;;) {
    const from = Atomics.add(ctl, CTL.NEXT, chunk);
    if (from >= count) break;
    const to = Math.min(count, from + chunk);
    for (let r = from; r < to; r++) {
      const list = grid.gather(sh, sh.reqs[r], scratch);
      const q = r * 3;
      sh.res[q] = slot;
      if (at + list.length > out.length) {
        sh.res[q + 1] = 0;
        sh.res[q + 2] = -1;
        continue;
      }
      sh.res[q + 1] = at;
      sh.res[q + 2] = list.length;
      for (let j = 0; j < list.length; j++) out[at + j] = list[j];
      at += list.length;
    }
    if (Atomics.add(ctl, CTL.DONE, to - from) + (to - from) >= count) Atomics.notify(ctl, CTL.DONE);
  }
}

export class ScanAhead {
  constructor() {
    const canWait =
      typeof WorkerGlobalScope !== 'undefined' &&
      self.crossOriginIsolated === true &&
      typeof SharedArrayBuffer === 'function' &&
      typeof globalThis.SWR_SPAWN_JOBS === 'function';
    const n = canWait && !globalThis.SWR_NOJOBS ? Math.max(0, Math.min(8, (navigator.hardwareConcurrency || 4) - 3)) : 0;
    this.sh = makeShared(n);
    this.slot = n;
    this.helpers = n;
    if (n) globalThis.SWR_SPAWN_JOBS(this.sh, n);
    this.grid = new Grid();
    this.scratch = [];
    this.req = new Map();
    this.units = null;
    this.gen = 0;
    this.on = true;
    this.ms = 0;
    this.n = 0;
    this.reqs = 0;
    this.moveScene = this.sh.move ? sharedMoveScene(this.sh.move) : null;
    this.meshRefs = new Map();
    this.meshList = [];
    this.meshFloatsUsed = 0;
    this.meshIntsUsed = 0;
  }

  // The shared columns fighter decisions are packed into, or null when this battle decides on its own thread.
  decideShared() {
    return this.helpers && this.on ? this.sh.decide : null;
  }

  // Decides `count` packed squadrons on the job threads and this one.
  runDecisions(count) {
    const sh = this.sh,
      ctl = sh.ctl;
    Atomics.add(ctl, CTL.GEN, 1);
    for (let a; (a = Atomics.load(ctl, CTL.ACTIVE)) !== 0; ) Atomics.wait(ctl, CTL.ACTIVE, a, 5);
    Atomics.store(ctl, CTL.KIND, JOB.DECIDE);
    Atomics.store(ctl, CTL.COUNT, count);
    Atomics.store(ctl, CTL.NEXT, 0);
    Atomics.store(ctl, CTL.DONE, 0);
    Atomics.store(ctl, CTL.CHUNK, Math.max(2, Math.min(32, Math.ceil(count / ((this.helpers + 1) * 4)))));
    Atomics.add(ctl, CTL.GEN, 1);
    Atomics.notify(ctl, CTL.GEN);
    decideWork(sh, (this.decideScene ||= sharedDecideScene(sh.decide)));
    for (let d; (d = Atomics.load(ctl, CTL.DONE)) < count; ) Atomics.wait(ctl, CTL.DONE, d, 5);
  }

  // The shared columns fighter moves are packed into, or null when this battle moves fighters on its own thread.
  moveShared() {
    return this.helpers && this.on ? this.sh.move : null;
  }

  // A stable number for a collision mesh. With job threads the mesh is copied into the shared pool once; one
  // that does not fit keeps its number and is only used on the battle thread.
  meshRef(mesh) {
    let ref = this.meshRefs.get(mesh);
    if (ref !== undefined) return ref;
    ref = this.meshList.length;
    this.meshList.push(mesh);
    this.meshRefs.set(mesh, ref);
    const move = this.sh.move;
    if (!move || ref >= MOVE_CAP.MESHES) return ref;
    const floats = mesh.T.length + mesh.box.length,
      ints = mesh.order.length + mesh.left.length * 4;
    const r = move.meshRows,
      at = ref * MESH_ROW;
    if (this.meshFloatsUsed + floats <= MOVE_CAP.MESH_FLOATS && this.meshIntsUsed + ints <= MOVE_CAP.MESH_INTS) {
      const putFloats = list => {
        const off = this.meshFloatsUsed;
        move.meshFloats.set(list, off);
        this.meshFloatsUsed += list.length;
        return off;
      };
      const putInts = list => {
        const off = this.meshIntsUsed;
        move.meshInts.set(list, off);
        this.meshIntsUsed += list.length;
        return off;
      };
      r[at + 1] = putFloats(mesh.T);
      r[at + 2] = mesh.T.length;
      r[at + 3] = putFloats(mesh.box);
      r[at + 4] = mesh.box.length;
      r[at + 5] = putInts(mesh.order);
      r[at + 6] = mesh.order.length;
      r[at + 7] = putInts(mesh.left);
      r[at + 8] = mesh.left.length;
      r[at + 9] = putInts(mesh.right);
      r[at + 10] = putInts(mesh.first);
      r[at + 11] = putInts(mesh.count);
      r[at] = 1;
    } else r[at] = 0;
    move.head[MOVE_HEAD.MESHES] = ref + 1;
    return ref;
  }

  // Moves `count` packed fighters on the job threads and this one. Rows a job thread could not finish (a mesh
  // that is not in the shared pool) are moved here afterwards, so the result never depends on the threads.
  runMoves(count, localScene) {
    const sh = this.sh,
      ctl = sh.ctl,
      status = sh.move.status;
    Atomics.add(ctl, CTL.GEN, 1);
    for (let a; (a = Atomics.load(ctl, CTL.ACTIVE)) !== 0; ) Atomics.wait(ctl, CTL.ACTIVE, a, 5);
    Atomics.store(ctl, CTL.KIND, JOB.MOVE);
    Atomics.store(ctl, CTL.COUNT, count);
    Atomics.store(ctl, CTL.NEXT, 0);
    Atomics.store(ctl, CTL.DONE, 0);
    Atomics.store(ctl, CTL.CHUNK, Math.max(8, Math.min(64, Math.ceil(count / ((this.helpers + 1) * 4)))));
    Atomics.add(ctl, CTL.GEN, 1);
    Atomics.notify(ctl, CTL.GEN);
    moveWork(sh, this.moveScene);
    for (let d; (d = Atomics.load(ctl, CTL.DONE)) < count; ) Atomics.wait(ctl, CTL.DONE, d, 5);
    readMoveHead(localScene, sh.move);
    for (let i = 0; i < count; i++) if (status[i] !== 1) moveFighter(localScene, i);
  }

  report() {
    const r = {
      workers: this.helpers,
      ready: Atomics.load(this.sh.ctl, CTL.READY),
      prepareMs: this.n ? this.ms / this.n : 0,
      reqs: this.n ? this.reqs / this.n : 0
    };
    this.ms = this.n = this.reqs = 0;
    return r;
  }

  prepare(units, dt) {
    this.req.clear();
    this.units = units;
    const n = units.length,
      sh = this.sh;
    if (n > CAP_UNITS) return;
    let count = 0;
    for (let i = 0; i < n && count < CAP_REQS; i++) {
      const u = units[i];
      if (
        !u.dead &&
        !u.hyper &&
        !u.retreatFlight &&
        !u.construction &&
        u.player.id >= 0 &&
        (u.hasWeapons || u.squad) &&
        !u.isFighter &&
        u.scanTimer - dt <= 0
      )
        this.req.set(u, count++);
    }
    if (!count) return;
    const t0 = performance.now();
    const ctl = sh.ctl;
    Atomics.add(ctl, CTL.GEN, 1);
    for (let a; (a = Atomics.load(ctl, CTL.ACTIVE)) !== 0; ) Atomics.wait(ctl, CTL.ACTIVE, a, 5);
    Atomics.store(ctl, CTL.KIND, JOB.SCAN);
    for (let i = 0; i < n; i++) {
      const o = units[i];
      sh.x[i] = o.x;
      sh.y[i] = o.y;
      sh.range[i] = o.maxRange + 250;
      sh.team[i] = o.player.team ? o.player.team.id : -1;
      sh.ok[i] = o.dead ? -1 : o.player.id >= 0 && o.targetableUnit && !o.hyper ? 1 : 0;
      sh.seen[i] = o.seenBy | 0;
      sh.bit[i] = o.player.bit | 0;
    }
    for (const [u, r] of this.req) sh.reqs[r] = u.gridAt;
    Atomics.store(ctl, CTL.COUNT, count);
    Atomics.store(ctl, CTL.NEXT, 0);
    Atomics.store(ctl, CTL.DONE, 0);
    Atomics.store(ctl, CTL.UNITS, n);
    Atomics.store(ctl, CTL.CHUNK, Math.max(1, Math.min(16, Math.ceil(count / ((this.helpers + 1) * 4)))));
    const g = Atomics.add(ctl, CTL.GEN, 1) + 1;
    if (this.helpers && this.on) Atomics.notify(ctl, CTL.GEN);
    this.grid.build(sh, n, g);
    work(sh, this.grid, this.slot, this.scratch);
    for (let d; (d = Atomics.load(ctl, CTL.DONE)) < count; ) Atomics.wait(ctl, CTL.DONE, d, 5);
    this.gen = g;
    this.ms += performance.now() - t0;
    this.n++;
    this.reqs += count;
  }

  take(u) {
    const r = this.req.get(u);
    if (r === undefined) return null;
    this.req.delete(u);
    const sh = this.sh,
      q = r * 3,
      len = sh.res[q + 2],
      units = this.units,
      list = [];
    if (len < 0) {
      for (const i of this.grid.gather(sh, sh.reqs[r], this.scratch)) list.push(units[i]);
      return list;
    }
    const out = sh.outs[sh.res[q]],
      off = sh.res[q + 1];
    for (let j = 0; j < len; j++) list.push(units[out[off + j]]);
    return list;
  }

  clear() {
    this.req.clear();
    this.units = null;
  }
}
