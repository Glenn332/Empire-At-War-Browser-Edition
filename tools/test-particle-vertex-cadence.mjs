import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { loadParticles } = await import('../public/js/particles.js');
const { ParticleSim, FRAME } = await import('../public/js/particlesim.js');

const points = [
  [0, 0, 0],
  [5, 0, 0],
  [-5, 0, 0]
];

function darkShare(name, def) {
  const sim = new ParticleSim();
  sim.defs.set(name, def);
  sim.create(1, name, { x: 0, y: 0, z: 0 }, { points, slot: -1 });
  const frame = new Float32Array(FRAME);
  frame[0] = 1;
  frame[6] = 1;
  frame[9] = 1;
  frame[10] = 1;
  frame[11] = 1;
  frame[13] = 1;
  frame[21] = 1;
  frame[22] = 1;
  const e = def.emitters.find(e => e.emitMode === 3),
    cadence = Math.max(e.interval, Math.min(0.25, e.lifetime)),
    want = Math.floor(e.lifetime / cadence + 1e-3) * points.length;
  let least = Infinity;
  for (const dt of [1 / 60, 1 / 144, 1 / 30]) {
    sim.systems.clear();
    sim.total = 0;
    sim.create(1, name, { x: 0, y: 0, z: 0 }, { points, slot: -1 });
    for (let t = 0; t < 4; t += dt) {
      sim.step(dt, frame);
      if (t < 1) continue;
      const s = sim.systems.get(1);
      least = Math.min(least, s ? s.emitters.find(x => x.e === e).parts.length : 0);
    }
  }
  return { least, want };
}

for (const file of ['pe_Z95engines', 'pe_awingengines', 'pe_bwing', 'pe_stardestroyerengines', 'pe_victoryengines']) {
  const def = await loadParticles(file);
  assert.ok(def && def.emitters.some(e => e.emitMode === 3), `${file} loads with a vertex emitter`);
  const { least, want } = darkShare(file, def);
  assert.ok(want > 0 && least >= want, `${file} keeps every overlapping glow lit on every frame: ${least} < ${want}`);
}
console.log('ok');
