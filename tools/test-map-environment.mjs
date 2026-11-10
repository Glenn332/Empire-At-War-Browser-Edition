import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
import { parseTED, pickEnvironment, environmentRoll, startEnvironment } from '../public/js/ted.js';

const fake = names => {
  const environments = names.map(name => ({ name }));
  return { environments, environment: environments[0], activeEnvironment: 0 };
};

let m = fake(['A', 'Cinematic', 'B']);
pickEnvironment(m, 0.4);
assert.equal(m.activeEnvironment, 2);
assert.equal(m.environment.name, 'B');
m = fake(['A', 'B', 'Cinematic']);
pickEnvironment(m, 0.9);
assert.equal(m.activeEnvironment, 0);
m = fake(['A', 'B', 'C']);
pickEnvironment(m, 0.999999);
assert.equal(m.activeEnvironment, 2);
m = fake(['Only']);
pickEnvironment(m, 0.7);
assert.equal(m.activeEnvironment, 0);

m = fake(['A', 'B', 'C', 'D']);
startEnvironment(m, { restore: { battle: { environment: 3 } } });
assert.equal(m.activeEnvironment, 3);
assert.equal(m.environment.name, 'D');
m = fake(['A', 'B', 'C', 'D']);
startEnvironment(m, { net: true, seed: 12345, restore: { battle: { environment: 9 } } });
assert.equal(m.activeEnvironment, Math.floor(environmentRoll(12345) * 4));

const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
const ted = name => {
  const b = archive.read(archive.resolve('Data/Art/Maps/' + name + '.ted'));
  return parseTED(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};
const endor = ted('_MP_LAND_ENDOR');
assert.deepEqual(
  endor.environments.map(e => [e.name, e.weather || '']),
  [
    ['Sunrise_Clear', ''],
    ['Noon_Clear', ''],
    ['Sunrise_Rain', 'RAIN_RANDOM'],
    ['Noon_Rain', 'RAIN_RANDOM']
  ]
);
assert.equal(endor.activeEnvironment, 0);

const seen = new Map();
for (let seed = 0; seed < 40; seed++) {
  const a = ted('_MP_LAND_ENDOR'),
    b = ted('_MP_LAND_ENDOR');
  startEnvironment(a, { net: true, seed });
  startEnvironment(b, { net: true, seed });
  assert.equal(a.activeEnvironment, b.activeEnvironment, 'peers on one seed start in one environment');
  assert.equal(a.environment, a.environments[a.activeEnvironment]);
  seen.set(a.activeEnvironment, (seen.get(a.activeEnvironment) || 0) + 1);
}
assert.deepEqual([...seen.keys()].sort(), [0, 1, 2, 3], 'every Endor environment can start a battle');

const rolls = [0, 0, 0, 0];
for (let k = 0; k < 4000; k++) {
  const e = fake(['A', 'B', 'C', 'D']);
  startEnvironment(e, {});
  rolls[e.activeEnvironment]++;
}
assert.ok(
  rolls.every(n => n > 800),
  'single-player rolls spread over the environments: ' + rolls
);

const space = ted('_MP_SPACE_ENDOR');
assert.ok(space.environments.length >= 1);
startEnvironment(space, { net: true, seed: 7 });
assert.equal(space.environment, space.environments[space.activeEnvironment]);
assert.notEqual(space.environment.name, 'Cinematic');

const hoth = ted('_MP_LAND_HOTH');
startEnvironment(hoth, { restore: { battle: { environment: 2 } } });
assert.equal(hoth.environment.name, 'Nighttime_Snow');

console.log('map environment ok', JSON.stringify(Object.fromEntries(seen)));
