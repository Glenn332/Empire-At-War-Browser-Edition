export const C = { GEN: 0, COUNT: 1, NEXT: 2, DONE: 3, VER: 4, CHUNK: 5, ACTIVE: 6 };

export function mulInto(out, o, a, ai, b, bi) {
  const a11 = a[ai],
    a12 = a[ai + 4],
    a13 = a[ai + 8],
    a14 = a[ai + 12];
  const a21 = a[ai + 1],
    a22 = a[ai + 5],
    a23 = a[ai + 9],
    a24 = a[ai + 13];
  const a31 = a[ai + 2],
    a32 = a[ai + 6],
    a33 = a[ai + 10],
    a34 = a[ai + 14];
  const a41 = a[ai + 3],
    a42 = a[ai + 7],
    a43 = a[ai + 11],
    a44 = a[ai + 15];
  const b11 = b[bi],
    b12 = b[bi + 4],
    b13 = b[bi + 8],
    b14 = b[bi + 12];
  const b21 = b[bi + 1],
    b22 = b[bi + 5],
    b23 = b[bi + 9],
    b24 = b[bi + 13];
  const b31 = b[bi + 2],
    b32 = b[bi + 6],
    b33 = b[bi + 10],
    b34 = b[bi + 14];
  const b41 = b[bi + 3],
    b42 = b[bi + 7],
    b43 = b[bi + 11],
    b44 = b[bi + 15];
  out[o] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  out[o + 4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  out[o + 8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  out[o + 12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
  out[o + 1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  out[o + 5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  out[o + 9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  out[o + 13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
  out[o + 2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  out[o + 6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  out[o + 10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  out[o + 14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
  out[o + 3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  out[o + 7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  out[o + 11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  out[o + 15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
}

export function runJobs(t) {
  const ctl = t.ctl,
    count = Atomics.load(ctl, C.COUNT),
    chunk = Atomics.load(ctl, C.CHUNK) || 64,
    J = t.jobs,
    U = t.unit,
    L = t.local,
    P = t.pools;
  for (;;) {
    const from = Atomics.add(ctl, C.NEXT, chunk);
    if (from >= count) return;
    const to = Math.min(count, from + chunk);
    for (let j = from; j < to; j++) {
      const q = j * 4;
      mulInto(P[J[q + 2]], J[q + 3] * 16, U, J[q] * 16, L, J[q + 1] * 16);
    }
    if (Atomics.add(ctl, C.DONE, to - from) + (to - from) >= count) Atomics.notify(ctl, C.DONE);
  }
}

const shared = n => new SharedArrayBuffer(n);

export class CollectJobs {
  static create() {
    if (typeof SharedArrayBuffer !== 'function' || !globalThis.crossOriginIsolated) return null;
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nocollectjobs')) return null;
    const n = Math.min(4, Math.max(0, (navigator.hardwareConcurrency || 4) - 6));
    return n ? new CollectJobs(n) : null;
  }

  constructor(n) {
    this.ctl = new Int32Array(shared(64));
    this.unitCap = 4096;
    this.unit = new Float64Array(shared(this.unitCap * 128));
    this.localCap = 8192;
    this.local = new Float64Array(shared(this.localCap * 128));
    this.localN = 0;
    this.jobCap = 16384;
    this.jobs = new Int32Array(shared(this.jobCap * 16));
    this.pools = [];
    this.version = 0;
    this.units = 0;
    this.count = 0;
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const wk = new Worker(new URL('./collectworker.js', import.meta.url), { type: 'module' });
      wk.onerror = e => console.error('collect worker', e.message);
      this.workers.push(wk);
    }
    this.send({ k: 'init', ctl: this.ctl, unit: this.unit, local: this.local, jobs: this.jobs });
  }

  send(m) {
    m.version = ++this.version;
    for (const wk of this.workers) wk.postMessage(m);
    Atomics.store(this.ctl, C.VER, this.version);
  }

  pool(arr, id = -1) {
    if (id < 0) id = this.pools.length;
    this.pools[id] = arr;
    this.send({ k: 'pool', id, arr });
    return id;
  }

  slot() {
    if (this.localN === this.localCap) {
      const old = this.local;
      this.localCap *= 2;
      this.local = new Float64Array(shared(this.localCap * 128));
      this.local.set(old);
      this.send({ k: 'local', local: this.local });
    }
    return this.localN++;
  }

  setLocal(slot, el) {
    const L = this.local,
      o = slot * 16;
    for (let k = 0; k < 16; k++) L[o + k] = el[k];
  }

  begin() {
    const ctl = this.ctl;
    if (!(Atomics.load(ctl, C.GEN) & 1)) Atomics.add(ctl, C.GEN, 1);
    const t0 = performance.now();
    while (Atomics.load(ctl, C.ACTIVE) !== 0)
      if (performance.now() - t0 > 100) {
        this.stop();
        break;
      }
    this.units = 0;
    this.count = 0;
  }

  addUnit(el) {
    if (this.units === this.unitCap) {
      const old = this.unit;
      this.unitCap *= 2;
      this.unit = new Float64Array(shared(this.unitCap * 128));
      this.unit.set(old);
      this.send({ k: 'unit', unit: this.unit });
    }
    const U = this.unit,
      o = this.units * 16;
    for (let k = 0; k < 16; k++) U[o + k] = el[k];
    return this.units++;
  }

  add(uk, slot, pool, at) {
    if (this.count === this.jobCap) {
      const old = this.jobs;
      this.jobCap *= 2;
      this.jobs = new Int32Array(shared(this.jobCap * 16));
      this.jobs.set(old);
      this.send({ k: 'jobs', jobs: this.jobs });
    }
    const J = this.jobs,
      q = this.count * 4;
    J[q] = uk;
    J[q + 1] = slot;
    J[q + 2] = pool;
    J[q + 3] = at;
    this.count++;
  }

  run() {
    const ctl = this.ctl,
      count = this.count;
    if (!count) return;
    Atomics.store(ctl, C.COUNT, count);
    Atomics.store(ctl, C.NEXT, 0);
    Atomics.store(ctl, C.DONE, 0);
    Atomics.store(ctl, C.CHUNK, Math.max(32, Math.ceil(count / ((this.workers.length + 1) * 6))));
    Atomics.add(ctl, C.GEN, 1);
    Atomics.notify(ctl, C.GEN);
    runJobs(this);
    const t0 = performance.now();
    while (Atomics.load(ctl, C.DONE) < count)
      if (performance.now() - t0 > 100) {
        const J = this.jobs;
        for (let j = 0; j < count; j++) {
          const q = j * 4;
          mulInto(this.pools[J[q + 2]], J[q + 3] * 16, this.unit, J[q] * 16, this.local, J[q + 1] * 16);
        }
        this.stop();
        break;
      }
  }

  stop() {
    this.broken = true;
    for (const wk of this.workers) wk.terminate();
    this.workers.length = 0;
  }
}
