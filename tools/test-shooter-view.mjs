import assert from 'node:assert/strict';
import { Box3, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { chaseVehicle, vehicleRig, vehicleEye } from '../public/js/game/vehicle-camera.js';

globalThis.window ??= globalThis;
const saved = new Map();
globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
const { Shooter } = await import('../public/js/game/shooter.js');
const s = Object.assign(Object.create(Shooter.prototype), { cfg: { view: 'third' }, flash() {} });
s.toggleView();
assert.ok(!s.third && !s.cockpit, 'legacy infantry-only settings default vehicles to chase');
s.gunQ = { members: [{}] };
s.toggleView();
assert.ok(!s.third && s.cockpit, 'gunner setting does not overwrite infantry');
s.gunQ = null;
s.post = {};
s.toggleView();
assert.equal(s.third, false, 'view key in fixed garrison never changes infantry default');
s.post = null;
s.big = true;
s.toggleView();
assert.equal(s.cockpit, false, 'directly possessed vehicle uses vehicle preference too');
assert.deepEqual(JSON.parse(saved.get('swr-shooter-settings')), { view: 'first', vehicleView: 'chase' });

const cam = new PerspectiveCamera(70, 1.6, 0.3, 10000);
cam.up.set(0, 0, 1);
const hull = new Object3D();
hull.position.set(50, 90, 18);
hull.scale.setScalar(1.7);
const box = new Box3(new Vector3(-4, -23, -2), new Vector3(6, 7, 10));
const rig = vehicleRig({ inst: { box }, holder: hull });
const d = new Vector3(),
  p = new Vector3();
for (const aspect of [1.6, 0.5])
  for (const pitch of [-1.4, 0, 1.35])
    for (const roll of [0, 0.6, 2.7]) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
      hull.rotation.set(0.2, roll, 1.1);
      hull.updateMatrixWorld();
      rig.fresh = true;
      d.set(Math.cos(pitch), 0, Math.sin(pitch));
      chaseVehicle(cam.position, rig, d, 1 / 60, aspect, cam.fov);
      cam.lookAt(p.copy(cam.position).add(d));
      cam.updateMatrixWorld();
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            p.set(x, y, z).applyMatrix4(hull.matrixWorld).project(cam);
            assert.ok(Math.abs(p.x) < 1 && p.y < 0 && p.y > -0.88, `hull projects inside lower screen: ${p.toArray()}`);
          }
      hull.worldToLocal(vehicleEye(p, rig));
      assert.ok(p.z > box.max.z && p.y < (box.min.y + box.max.y) / 2, 'driver eye follows chassis, clear of hull');
    }
const fallback = vehicleRig({ holder: hull, hitRadius: 8 });
assert.ok(
  chaseVehicle(p, fallback, d, 1 / 60, 1.6, 70)
    .toArray()
    .every(Number.isFinite)
);
console.log('PASS: infantry and seat preferences, garrison, projected hull, banked driver eye and fallback');
