import { ParticleSim } from './particlesim.js';

const sim = new ParticleSim();

const spare = new Map();
const give = buf => {
  const l = spare.get(buf.byteLength);
  if (l) l.push(buf);
  else spare.set(buf.byteLength, [buf]);
};
const take = bytes => {
  const size = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, bytes))));
  const l = spare.get(size);
  return l && l.length ? l.pop() : new ArrayBuffer(size);
};
const copy = (src, n) => {
  const out = new Float32Array(take(n * 4), 0, n);
  out.set(src.subarray(0, n));
  return out;
};

onmessage = ev => {
  const m = ev.data;
  if (m.type === 'def') sim.defs.set(m.key, m.def);
  else if (m.type === 'create') {
    sim.heatOn = !!m.heatOn;
    sim.create(m.id, m.key, m.f, m.opts);
  } else if (m.type === 'step') {
    sim.detail = m.detail;
    sim.heatOn = !!m.heatOn;
    sim.heatScene = !!m.heatScene;
    for (const b of m.free || []) give(b);
    const dead = sim.step(m.dt, m.frames);
    const batches = [],
      move = [];
    for (const b of sim.batches.values()) {
      if (!b.count && b.told) continue;
      const n = b.count,
        out = {
          key: b.key,
          count: n,
          center: copy(b.center, n * 4),
          tint: copy(b.tint, n * 4),
          cell: copy(b.cell, n * 4),
          slot: copy(b.slot, n)
        };
      if (!b.told) {
        out.desc = b.desc;
        b.told = true;
      }
      batches.push(out);
      move.push(out.center.buffer, out.tint.buffer, out.cell.buffer, out.slot.buffer);
    }
    const framesBuf = m.frames.buffer;
    move.push(framesBuf);
    postMessage({ type: 'drawn', batches, dead, total: sim.total, framesBuf }, move);
  }
};
