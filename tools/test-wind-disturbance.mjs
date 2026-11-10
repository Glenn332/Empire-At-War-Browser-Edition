import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { loadParticles } = await import('../public/js/particles.js');
const { windNear, windPush, WIND } = await import('../public/js/particlesim.js');
const { windDisturbances } = await import('../public/js/game/landbase.js');

const smoke = await loadParticles('p_smoke_small01.alo');
if (!smoke) console.log('no stock smoke particle in this data: flag check skipped');
if (smoke) {
  assert.ok(
    smoke.emitters.some(e => e.wind && e.windDisturb),
    'stock smoke carries both wind flags'
  );
}

const D = Float32Array.from([0, 0, 0, 20, 0, 0, 50, 10, 0.4]);
assert.equal(WIND, 9);
const at = (x, y) => ({ x, y, z: 0, vx: 0, vy: 0, vz: 0, world: true });

const behind = at(-25, 0);
windPush(D, [0], behind, 1 / 30);
assert.ok(Math.abs(behind.vx - (10 * 20 * 1) / 30) < 1e-4, 'the wake behind is pulled along the facing, full weight at half the radius');
assert.equal(behind.vy, 0);

const ahead = at(25, 0);
windPush(D, [0], ahead, 1 / 30);
assert.equal(ahead.vx, 0, 'a positive alpha leaves the front alone');

const side = at(0, 25);
windPush(D, [0], side, 1 / 30);
assert.equal(side.vx, 0, 'sideways is (0+1)/2 = 0.5 > 0.4, outside the sector');

const far = at(60, 0);
windPush(D, [0], far, 1 / 30);
assert.equal(far.vx, 0, 'beyond the radius');

const near = at(-10, 0);
windPush(D, [0], near, 1 / 30);
assert.ok(Math.abs(near.vx - (10 * 20 * 0.4) / 30) < 1e-4, 'weight 1 - 2|t - 0.5|');

const negative = Float32Array.from([0, 0, 0, 20, 0, 0, 50, 10, -0.2]);
const back = at(-25, 0),
  front = at(25, 0);
windPush(negative, [0], back, 1 / 30);
windPush(negative, [0], front, 1 / 30);
assert.ok(front.vx > 0, 'a negative alpha pushes what is ahead');
assert.equal(back.vx, 0);

const a = at(-25, 0),
  b = at(-25, 0);
for (let i = 0; i < 60; i++) windPush(D, [0], a, 1 / 60);
for (let i = 0; i < 30; i++) windPush(D, [0], b, 1 / 30);
assert.ok(Math.abs(a.vx - b.vx) < 1e-3, 'the same push per second at any frame rate');

assert.equal(windNear(D, [at(400, 0)], { x: 400, y: 0, z: 0 }), null, 'an emitter far away gathers nothing');
assert.deepEqual(windNear(D, [at(30, 0)], { x: 30, y: 0, z: 0 }), [0]);

const type = (behave, fields) => ({
  str: k => (k === 'LandBehavior' ? behave : ''),
  num: (k, d) => fields[k] ?? d
});
const tank = {
  type: type('TREAD_SCROLL, WIND_DISTURBANCE', {
    Wind_Disturbance_Radius: 50,
    Wind_Disturbance_Strength: 10,
    Wind_Disturbance_Sphere_Alpha: 3
  }),
  x: 0,
  y: 0,
  z: 0,
  heading: Math.PI / 2
};
const quiet = { type: type('', { Wind_Disturbance_Radius: 50 }), x: 0, y: 0, z: 0, heading: 0 };
const world = { units: [tank, quiet] };
assert.deepEqual(windDisturbances(world, 1 / 30), [], 'nothing on the first frame');
tank.y = 1;
quiet.x = 5;
const out = windDisturbances(world, 1 / 30);
assert.equal(out.length, WIND, 'only units with the behaviour');
assert.ok(Math.abs(out[3]) < 1e-6 && Math.abs(out[4] - 30) < 1e-4, 'facing times speed');
assert.deepEqual(out.slice(6), [50, 10, 1], 'alpha clamped to 1');
assert.deepEqual(windDisturbances(world, 1 / 30), [], 'standing still registers nothing');
console.log('ok');
