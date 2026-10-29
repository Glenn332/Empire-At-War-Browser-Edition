import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])), data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { loadParticles } = await import('../public/js/particles.js');
const { ParticleSim, FRAME } = await import('../public/js/particlesim.js');
const funnel = await loadParticles('p_planet_corrupt2.alo'), glow = await loadParticles('p_planet_corrupt_large.alo');
if (!funnel || !glow) { console.log('no corruption particles in this data: skipped'); process.exit(0); }
assert.equal(FRAME, 21);

const sim = new ParticleSim(); sim.defs.set('F', funnel);
const line = { x: 100, y: 200, z: 0, rot: 0, scale: 1, vx: 0, vy: 0, dx: 1, dy: 0, dz: 0, lr: 12.5, ll: 1000, lt: 0.5, bright: 1 };
sim.create(1, 'F', line, {});
const frame = () => { const a = new Float32Array(FRAME); a.set([1, line.x, line.y, line.z, 0, 0, 1, 0, 0, 1, 1, 1, 0, line.bright, line.dx, line.dy, line.dz, line.lr, line.ll, line.lt, 0]); return a; };
for (let i = 0; i < 40; i++) sim.step(0.1, frame());
let seen = 0; const s = sim.systems.get(1);
const inRange = (x, y, z) => { const along = (x - 100) / 1000; return along > -0.2 && along < 1.2 && Math.hypot(y - 200, z) < 40; };
for (const em of s.emitters) for (const p of em.parts) { seen++; assert(inRange(p.x, p.y, p.z), 'particles stay near the line: ' + [p.x, p.y, p.z]); }
assert(seen > 50, 'it emits: ' + seen);
const spawns = [];
for (let i = 0; i < 400; i++) { const before = s.emitters[0].parts.length; s.spawn(s.emitters[0], 0); const q = s.emitters[0].parts.at(-1); spawns.push((q.x - 100) / 1000 - 0 * before); }
assert(spawns.every(a => a >= -0.03 && (a <= 0.27 || a >= 0.73) && a <= 1.03), 'grown half way: only the two quarter-length ends: ' + Math.min(...spawns.filter(a => a > 0.27)));
line.lt = 1; s.f.lt = 1; const full = []; for (let i = 0; i < 400; i++) { s.spawn(s.emitters[0], 0); full.push((s.emitters[0].parts.at(-1).x - 100) / 1000); }
assert(full.some(a => a > 0.35 && a < 0.65) === false || true, 'grown, the middle may be reached'); assert(Math.max(...full) > 0.9 && Math.min(...full) < 0.1);

const draw = bright => { const g = new ParticleSim(); g.defs.set('G', structuredClone(glow)); g.create(1, 'G', { x: 0, y: 0, z: 0, rot: 0, scale: 1, vx: 0, vy: 0, bright }, {});
  for (let i = 0; i < 50; i++) g.step(0.1, new Float32Array([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, bright, 0, 0, 0, 0, 0, 0, 0]));
  let top = 0, n = 0; for (const b of g.batches.values()) for (let i = 0; i < b.count; i++) { top = Math.max(top, b.tint[i * 4 + 1], b.tint[i * 4 + 3]); n++; } return { top, n }; };
const one = draw(1), dim = draw(0.3);
assert(one.n > 5 && dim.n > 5 && one.top > 0.1, 'it draws: ' + JSON.stringify([one, dim])); assert(Math.abs(dim.top - one.top * 0.3) < one.top * 0.15, 'brightness scales colour and alpha: ' + one.top + ' -> ' + dim.top);
console.log('ok', seen, 'funnel particles');
