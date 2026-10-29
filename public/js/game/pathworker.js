import { PathCore, loadPathWasm } from './pathcore.js';

let core = null;
const objs = new Map();
const waiting = new Map();
let scheduled = false;

const stub = id => {
  let o = objs.get(id);
  if (!o) objs.set(id, (o = { id }));
  return o;
};

function world(m) {
  const w = core.world;
  w.time = m.time;
  w.min = m.min;
  w.max = m.max;
  w.fields = m.fields;
  core.still.length = 0;
  for (const l of core.cells.values()) l.length = 0;
  for (const e of m.still) {
    const o = stub(e.id);
    o.isStructure = e.structure;
    o.layer = e.layer;
    o.pathExt = e.ext;
    const entry = { o, x: e.x, y: e.y, dx: e.dx, dy: e.dy, ext: e.ext, layer: e.layer, structure: e.structure };
    core.still.push(entry);
    const r = e.ext.r,
      S = m.scell,
      x0 = Math.floor((e.x - r) / S),
      x1 = Math.floor((e.x + r) / S),
      y0 = Math.floor((e.y - r) / S),
      y1 = Math.floor((e.y + r) / S);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++) {
        const k = ix * 65536 + iy;
        let l = core.cells.get(k);
        if (!l) core.cells.set(k, (l = []));
        l.push(entry);
      }
  }
  core.tracks = m.tracks.map(t => {
    const o = stub(t.id);
    o.layer = t.layer;
    o.pathExt = t.ext;
    return { ...t, o };
  });
}

function run() {
  scheduled = false;
  for (const [id, m] of waiting) {
    waiting.delete(id);
    const u = stub(id),
      s = m.ship;
    Object.assign(u, s);
    u.pathExt = s.ext;
    let pts = null;
    try {
      pts = core.find(u, m.gx, m.gy);
    } catch (e) {
      pts = null;
    }
    postMessage({ rid: m.rid, id, pts, partial: !!(pts && pts.partial), time: core.world.time });
    if (waiting.size) {
      scheduled = true;
      setTimeout(run, 0);
      return;
    }
  }
}

const SEARCH_STATES = 20000,
  BATCH_STATES = 40000;
function batch(m) {
  world(m.world);
  const answers = [];
  let left = BATCH_STATES;
  for (const f of m.finds) {
    core.expBudget = Math.max(0, Math.min(SEARCH_STATES, left));
    const u = stub(f.ship.id);
    Object.assign(u, f.ship);
    u.pathExt = f.ship.ext;
    let pts = null;
    try {
      pts = core.find(u, f.gx, f.gy);
    } catch (e) {
      pts = null;
    }
    left -= core.statesUsed;
    answers.push({ rid: f.rid, id: f.ship.id, pts, partial: !!(pts && pts.partial) });
  }
  core.expBudget = Infinity;
  postMessage({ kind: 'batch', bid: m.bid, answers });
}

onmessage = ({ data: m }) => {
  if (m.kind === 'fixed') {
    core.searchMs = Infinity;
    postMessage({ kind: 'fixed', wasm: !!core.wasm });
    return;
  }
  if (m.kind === 'batch') {
    batch(m);
    return;
  }
  if (m.kind === 'wasm') {
    core.wasm = m.on ? core.wasmKept || core.wasm : ((core.wasmKept = core.wasm), null);
    return;
  }
  if (m.kind === 'init') {
    core = new PathCore(
      {
        time: 0,
        min: { x: 0, y: 0 },
        max: { x: 0, y: 0 },
        fields: [],
        hazardous: (f, u) => (f.asteroid && u.asteroidDamage) || (f.ion && u.shielded)
      },
      m.K,
      m.ringStep
    );
    core.searchMs = m.searchMs;
    if (!m.noWasm)
      loadPathWasm(new URL('./pathsearch.wasm', import.meta.url)).then(w => {
        core.wasm = w;
        postMessage({ kind: 'wasm', ok: !!w });
      });
    return;
  }
  if (m.kind === 'world') {
    world(m);
    return;
  }
  if (m.kind === 'find') {
    waiting.delete(m.ship.id);
    waiting.set(m.ship.id, m);
    if (!scheduled) {
      scheduled = true;
      setTimeout(run, 0);
    }
  }
};
