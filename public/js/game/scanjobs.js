export const UNIT_CELL = 1024;
export const UNIT_PAD = 200;
export const CAP_UNITS = 1 << 15;
export const CAP_REQS = 1 << 15;
export const OUT_CAP = 1 << 20;
export const CTL = { GEN: 0, COUNT: 1, NEXT: 2, DONE: 3, UNITS: 4, CHUNK: 5, ACTIVE: 6, READY: 7 };

export function makeShared(workers) {
  const S = typeof SharedArrayBuffer === 'function' ? SharedArrayBuffer : ArrayBuffer;
  return {
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
        u.scanTimer - dt <= 0
      )
        this.req.set(u, count++);
    }
    if (!count) return;
    const t0 = performance.now();
    const ctl = sh.ctl;
    Atomics.add(ctl, CTL.GEN, 1);
    for (let a; (a = Atomics.load(ctl, CTL.ACTIVE)) !== 0; ) Atomics.wait(ctl, CTL.ACTIVE, a, 5);
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
