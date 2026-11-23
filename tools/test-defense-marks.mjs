import assert from 'node:assert/strict';
import { defenseMarks, noteMapShot, shotFlash } from '../public/js/game/defense-marks.js';
const tower = { structure: true, weapon: {}, side: 1, seen: true },
  bunker = { structure: true, side: 0, ports: 3, holds: [] };
const w = {
  time: 60,
  wild: 3,
  ally: (a, b) => a === b || (a % 2 === 0 && b % 2 === 0),
  units: [tower, bunker, { structure: true }, { speed: 2, turret: {}, weapon: {} }],
  sites: [{ building: { side: 1 } }]
};
const marks = () => defenseMarks(w, 0),
  mark = () => marks().get(tower);
assert.equal(marks().size, 2);
assert.deepEqual(mark(), { side: 1, relation: 'enemy', ready: true, flash: 0 });
tower.target = {};
assert.equal(mark().flash, 0); // Tracking isn't shooting.
noteMapShot(tower, 60);
assert.equal(mark().flash, 1);
w.time += 0.2;
assert(mark().flash > 0 && mark().flash < 1);
tower.side = 2;
assert.equal(mark().relation, 'ally');
assert.equal(mark().flash, 0); // Hacked; don't inherit the old owner's flash.
tower.side = w.wild;
assert.equal(mark().relation, 'wild');
tower.capturable = { side: -1 };
assert.equal(mark().relation, 'neutral');
assert.equal(mark().ready, false);
tower.capturable.side = 1;
assert.equal(mark().relation, 'enemy');
tower.unpowered = true;
assert.equal(mark().ready, false);
tower.unpowered = false;
tower.stunUntil = 99;
assert.equal(mark().ready, false);
w.time = 100;
assert.equal(mark().flash, 0);
assert(mark().ready);
for (const [k, v] of [
  ['seen', false],
  ['dead', true],
  ['gone', true]
]) {
  const old = tower[k];
  tower[k] = v;
  assert(!marks().has(tower));
  tower[k] = old;
}
assert.equal(marks().get(bunker).ready, false);
const m = { inside: bunker, gunner: true, weapon: {} };
bunker.holds = [{ members: [m] }];
assert(marks().get(bunker).ready);
m.side = 0;
noteMapShot(m, w.time);
assert(shotFlash(m, w.time) && !shotFlash(m, w.time + 0.3));
assert.equal(marks().get(bunker).flash, 1);
m.gunner = false;
assert.equal(marks().get(bunker).flash, 0);
w.shooter = { post: bunker };
assert(marks().get(bunker).ready);
w.time++;
assert.equal(marks().get(bunker).flash, 0);
console.log('PASS: live defense identity, alliances/capture, gunners, shots, inactive, expiry and removal');
