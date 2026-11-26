// No retail data required: atypical rigs and missing ALA files still get an idle.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeployMotion } from '../public/js/game/deploy-motion.js';
const sample = chest => {
  const root = new THREE.Group(),
    body = chest ? new THREE.Object3D() : root;
  if (chest) {
    body.name = 'B_Chest';
    root.add(body);
  }
  const inst = {
    root,
    bones: chest ? [body] : [],
    bone: n => (chest && n === body.name ? body : null),
    box: new THREE.Box3(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 10)),
    syncFromBones: () => root.updateMatrixWorld(true)
  };
  return { body, motion: new DeployMotion(inst, [null, null, null]) };
};
for (const skeletal of [true, false]) {
  const { body, motion } = sample(skeletal),
    q = body.quaternion.clone(),
    p = body.position.clone();
  motion.step(2.25);
  assert(body.quaternion.angleTo(q) > 0.03, 'visible rising idle');
  assert.equal(body.position.z > p.z, skeletal, 'only flexible torsos lift');
  motion.step(2.25);
  assert(body.position.distanceTo(p) < 1e-9 && body.quaternion.angleTo(q) < 1e-6, 'no drift');
  for (let i = 0; i < 600; i++) motion.step(1 / 60);
  assert(motion.active && !motion.active.g, 'model without gestures gets a surveying turn');
  motion.step(1.4);
  assert(Math.abs(body.quaternion.z) > 0.07);
  motion.step(2.4);
  assert(!motion.active && Math.abs(body.quaternion.z) < 1e-6);
  assert(motion.next - motion.time > 13, 'standing interval between gestures');
}
console.log('PASS: breathing and occasional gestures with no clips, both torso and rigid rigs');
