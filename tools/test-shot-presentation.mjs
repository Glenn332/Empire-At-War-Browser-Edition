import assert from 'node:assert/strict';
import { Group, Vector3 } from 'three';
import { MuzzleLaunches } from '../public/js/game/shot-presentation.js';
const v = new MuzzleLaunches(),
  root = new Group(),
  a = new Group(),
  b = new Group();
root.add(a, b);
a.position.set(1, 2, 3);
b.position.set(2, 3, 4);
root.updateMatrixWorld(true);
const w = { turn: 1 },
  k = { root, weapon: w, tip: new Vector3(), axis: new Vector3(1, 0, 0), barrels: [a, b] };
const s = { x: 12, y: 5, z: 3, vx: 30, vy: 0, vz: 0, aimX: 170, aimY: 5, aimZ: 3, w };
const snapshot = { ...s };
assert.deepEqual(v.start(s, k).toArray(), [2, 3, 4]);
b.position.z = 4.1;
const p = v.sample(s, k);
assert.deepEqual([p.x, p.y, p.z], [2, 3, 4.1]);
assert.deepEqual(s, snapshot);
b.position.x = 29;
assert.equal(v.sample(s, k).x, 2, 'fired bolt never follows later mouse/weapon motion');
s.x += 10;
assert.ok(v.sample(s, k).x > 10);
s.x += 70;
assert.equal(v.sample(s, k), s, 'handoff to unchanged physical path');
assert.equal(v.sample({ ...s }, k).near, undefined, 'unregistered remote/AI unchanged');
assert.equal(v.start({ ...s, w: {} }, k), null, 'a thrown grenade is not launched from the gun');
v.start(s, k);
assert.equal(v.sample(s, null), s, 'scope or third person: no viewmodel path');
// Simulated first tick is already downrange; the focused world-space sample
// must still start on the rendered bone and lie on the tip-to-impact line.
const gun = { turn: 0, muzzles: [{ bone: b }] },
  body = { weapon: gun },
  shot = { from: body, w: gun, x: 25, y: 5, z: 3, vx: 40, vy: 0, vz: 0, aimX: 105, aimY: 5, aimZ: 3, cat: 7 };
b.position.set(4, -7, 1);
assert.ok(v.start(shot, body, true));
const pose = v.sample(shot, body);
assert.deepEqual([pose.x, pose.y, pose.z, pose.launch, pose.near], [4, -7, 1, 1, 0]);
b.position.y = 20;
shot.x = 65;
assert.deepEqual([v.sample(shot, body).x, pose.y, pose.z], [54.5, -1, 2]);
shot.x = shot.aimX;
assert.equal(v.sample(shot, body), shot);
assert.ok(v.focused.has(shot));
assert.equal(v.start({ ...shot, from: {} }, body, true), null);
console.log(
  'PASS: selected barrel, first rendered pose, straight focused convergence, world-space release, remote/weapon and scope exclusions'
);
