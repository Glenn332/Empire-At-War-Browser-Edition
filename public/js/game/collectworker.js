import { C, runJobs } from './collectjobs.js';

const t = { ctl: null, unit: null, local: null, jobs: null, pools: [] };
let version = 0,
  started = false;

async function loop() {
  const ctl = t.ctl;
  let seen = Atomics.load(ctl, C.GEN);
  for (;;) {
    const w = Atomics.waitAsync(ctl, C.GEN, seen);
    if (w.async) await w.value;
    const g = (seen = Atomics.load(ctl, C.GEN));
    if (g & 1 || version < Atomics.load(ctl, C.VER)) continue;
    Atomics.add(ctl, C.ACTIVE, 1);
    try {
      if (Atomics.load(ctl, C.GEN) === g) runJobs(t);
    } finally {
      Atomics.sub(ctl, C.ACTIVE, 1);
    }
  }
}

self.onmessage = e => {
  const m = e.data;
  if (m.k === 'init') {
    t.ctl = m.ctl;
    t.unit = m.unit;
    t.local = m.local;
    t.jobs = m.jobs;
  } else if (m.k === 'pool') t.pools[m.id] = m.arr;
  else if (m.k === 'local') t.local = m.local;
  else if (m.k === 'unit') t.unit = m.unit;
  else if (m.k === 'jobs') t.jobs = m.jobs;
  version = m.version;
  if (!started && t.ctl) {
    started = true;
    loop();
  }
};
