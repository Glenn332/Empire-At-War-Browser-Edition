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
const { loadParticles, groupSpeed } = await import('../public/js/particles.js');
const { ParticleSim, FRAME, wrapCube, weatherOrigin, weatherFade, emitterPoolSize, energyCap } = await import('../public/js/particlesim.js');

const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);

near(wrapCube(250, 100), 100, 'inside stays');
near(wrapCube(250, 260), -240, 'one edge over wraps to the other side');
near(wrapCube(250, -260), 240, 'and from below');
near(wrapCube(250, 250), 250, 'the edge itself stays');
near(wrapCube(250, 250 + 1200), 1200 - 2 - 250, 'two edges or more over subtracts the whole count, not that many edges');
near(wrapCube(250, -250 - 1200), 250 - (1200 - 2), 'the same below');

const e = { weatherOffset: 500, pos: { cube: 250 } },
  o = new Float64Array(6);
weatherOrigin(e, { x: 1000, y: -1300, z: 300, dx: 0, dy: 0.6, dz: -0.8 }, o);
near(o[0], 1000, 'origin x');
near(o[1], -1000, 'origin y is offset ahead of the camera');
near(o[2], -100, 'origin z');
near(o[3], 1000 - 500 * 2, 'cell remainder x');
near(o[4], 0, 'cell remainder y');
near(o[5], -100, 'cell remainder z');

const fe = { weatherFadeStart: 50, weatherFadeLength: 100 };
assert.equal(weatherFade(fe, 10), 0, 'closer than the start is hidden');
near(weatherFade(fe, 100), 0.5, 'linear through the fade length');
assert.equal(weatherFade(fe, 200), 1, 'past the fade');
assert.equal(weatherFade({ weatherFadeStart: 0, weatherFadeLength: 0 }, 0), 1, 'no fade');

const rain = await loadParticles('p_rain_med00.alo');
if (!rain) {
  console.log('no rain particles in this data: skipped');
  process.exit(0);
}
const we = rain.emitters.filter(x => x.weather);
assert.ok(we.length, 'the rain has a weather emitter');
const r = we[0];
assert.equal(r.weatherCube, 500);
assert.equal(r.weatherFadeStart, 0);
assert.equal(r.weatherFadeLength, 0);
assert.equal(r.weatherOffset, 500);
assert.equal(r.stretch, true);
near(r.stretchFactor, 33, 'stretch factor');
assert.equal(r.blend, 1);
assert.equal(r.pos.type, 2, 'a weather emitter spawns in a cube');
assert.equal(r.pos.cube, 250, 'of half the weather cube edge');
assert.deepEqual(r.accel, [0, 0, 0]);
assert.equal(r.gravity, 0);
assert.equal(r.burst, false);
assert.equal(r.inherit, false);
near(r.maxSpeed, groupSpeed(r.vel), 'the stretch reference speed is the velocity shape maximum');

const pool = emitterPoolSize(r);
assert.equal(pool, Math.min(5003, Math.ceil(r.perSecond)), 'the pool is one second of emission');
const sim = new ParticleSim();
sim.cap = 1e6;
sim.defs.set('R', rain);
const cam = { x: 3000, y: 2000, z: 800, dx: 0, dy: 0.6, dz: -0.8 };
sim.create(1, 'R', { ...cam, rot: 0, scale: 1, vx: 0, vy: 0, bright: 1 }, {});
const s = sim.systems.get(1),
  st = s.emitters.find(x => x.e === r);
assert.equal(st.parts.length, pool, 'the whole pool is spawned at once');
for (const p of st.parts) {
  assert.ok(Math.abs(p.x) <= 250 && Math.abs(p.y) <= 250 && Math.abs(p.z) <= 250, 'inside the cube');
  assert.ok(p.age >= 0 && p.age <= r.lifetime, 'a random starting age');
}
const frame = energy => {
  const a = new Float32Array(FRAME);
  a.set([1, cam.x, cam.y, cam.z, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, cam.dx, cam.dy, cam.dz, 0, 0, 0, 0, 1, energy]);
  return a;
};
for (let i = 0; i < 60; i++) sim.step(0.1, frame(1));
assert.equal(st.parts.length, pool, 'weather particles never die while the system runs');
for (const p of st.parts) {
  assert.ok(p.age <= p.life, 'the age wraps around the life');
  assert.ok(Math.abs(p.x) <= 250 && Math.abs(p.y) <= 250 && Math.abs(p.z) <= 250, 'and the position around the cube');
}
const b = sim.batch(r);
assert.ok(b.dir, 'a stretched emitter draws into a batch with directions');
assert.ok(b.key.endsWith('S'));
const ox = cam.x,
  oy = cam.y + 0.6 * 500,
  oz = cam.z - 0.8 * 500;
const cnt = b.count;
assert.ok(cnt >= pool, 'every particle drawn at full intensity');
let inCube = 0;
for (let i = 0; i < cnt; i++) {
  const x = b.center[i * 4],
    y = b.center[i * 4 + 1],
    z = b.center[i * 4 + 2];
  if (Math.abs(x - ox) <= 250.01 && Math.abs(y - oy) <= 250.01 && Math.abs(z - oz) <= 250.01) inCube++;
  if (b.dir[i * 4 + 3] > 0) near(b.dir[i * 4 + 3], 33, 'the stretch factor rides along');
}
assert.ok(inCube >= pool, 'drawn around the point ahead of the camera');
near(energyCap(r, 0.5), Math.ceil(pool * 0.5), 'half intensity');
sim.step(0.1, frame(0.5));
assert.equal(sim.batch(r).count - (cnt - pool), Math.ceil(pool * 0.5), 'half the pool is drawn at half intensity');
sim.step(0, frame(1));
const before = Float32Array.from(sim.batch(r).center.subarray(0, sim.batch(r).count * 4));
cam.x += 37;
sim.step(0, frame(1));
const after = sim.batch(r);
let same = 0;
for (let i = 0; i < after.count; i++) if (Math.abs(after.center[i * 4] - before[i * 4]) < 1e-3) same++;
assert.ok(same > after.count * 0.8, 'the rain stays put in the world while the cube follows the camera');
assert.ok(same < after.count, 'and the part that left the cube comes back on the far side');
console.log('ok');
