import assert from 'node:assert/strict';
import { Group, Vector3 } from 'three';
import { ROLL, startRoll, RollPose, rollPhase, rollTuck } from '../public/js/game/infantry-roll.js';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
for (const yaw of [0, 0.77, -2.08])
  for (const f of [-1, 0, 1])
    for (const s of [-1, 0, 1]) {
      const r = startRoll(f, s, yaw),
        len = Math.hypot(f, s) || 1;
      close(Math.hypot(r.x, r.y), 1);
      close(r.x * Math.cos(yaw) + r.y * Math.sin(yaw), f || s ? f / len : 1);
      close(r.x * Math.sin(yaw) - r.y * Math.cos(yaw), s / len);
      close(rollPhase(r), 0);
      r.t = ROLL.duration / 2;
      close(rollTuck(rollPhase(r)), 1);
      const h = new Group();
      h.scale.setScalar(1.24);
      h.rotation.z = yaw;
      h.position.set(10, 4, 30);
      const pos = h.position.clone(),
        q = h.quaternion.clone(),
        sc = h.scale.clone(),
        pose = new RollPose();
      pose.apply(h, r, 12);
      close(new Vector3(0, 0, 1).applyQuaternion(h.quaternion).z, -1);
      pose.restore();
      assert.ok(pos.equals(h.position) && q.equals(h.quaternion) && sc.equals(h.scale));
      assert.ok(!pose.holder);
    }
console.log('PASS: eight camera-relative roll directions + idle forward, equal travel, tucked flip and exact draw restore');
