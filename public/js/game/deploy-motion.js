// A presentation-only rig. No world clock, faction checks or gameplay RNG.
import * as THREE from 'three';
import { AnimState, loopTime } from '../ala.js';

const TAU = Math.PI * 2,
  DEG = Math.PI / 180;
const smooth = x => {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
};
const sampler = bones => ({ bones, boneByName: new Map(bones.map(b => [b.name.toUpperCase(), b])), syncFromBones() {} });
const up = new THREE.Vector3(),
  pitch = new THREE.Vector3(),
  parent = new THREE.Quaternion(),
  turn = new THREE.Quaternion();

export class DeployMotion {
  constructor(inst, [stand, ...variants]) {
    this.inst = inst;
    this.time = this.count = 0;
    this.next = 14;
    this.active = null;
    const rig = sampler(inst.bones),
      pose = stand || variants.find(Boolean);
    if (pose) {
      this.stand = new AnimState(rig, pose, { loop: true, speed: stand ? Math.min(1, loopTime(stand) / 12) : 0 });
      this.stand.pose();
    }
    // Sample gestures into scratch bones so blends don't switch meshes or
    // change the neutral ALA, which is also cached for the live battlefield.
    const scratch = sampler(inst.bones.map(b => Object.assign(new THREE.Object3D(), { name: b.name })));
    const real = new Map(scratch.bones.map((b, i) => [b, inst.bones[i]]));
    this.gestures = variants
      .filter(c => c?.frames > 2)
      .map(clip => {
        const state = new AnimState(scratch, clip);
        return { state, pairs: state.bound.map(({ bone }) => [real.get(bone), bone]) };
      })
      .filter(g => g.pairs.length);
    this.chest = inst.bone('B_Chest') || inst.bone('B_Torso') || inst.bone('Spine');
    this.body = this.chest || inst.root;
    this.height = inst.box.max.z - inst.box.min.z;
    const touched = new Set([this.body, ...this.gestures.flatMap(g => g.pairs.map(([b]) => b))]);
    this.rest = [...touched].map(b => ({ b, p: b.position.clone(), q: b.quaternion.clone() }));
    this.step(0);
  }

  step(dt) {
    this.time += dt;
    for (const { b, p, q } of this.rest) {
      b.position.copy(p);
      b.quaternion.copy(q);
    }
    this.stand?.step(dt);
    if (!this.active && this.time >= this.next) {
      const g = this.gestures.length ? this.gestures[this.count % this.gestures.length] : null;
      const seconds = g ? Math.min(5.5, Math.max(3.8, loopTime(g.state.anim) * 1.45)) : 3.8;
      this.active = { g, start: this.next, seconds };
      this.next += seconds + [16, 18, 14][this.count++ % 3];
    }
    let glance = 0;
    if (this.active) {
      const { g, start, seconds } = this.active,
        phase = (this.time - start) / seconds;
      if (phase >= 1) this.active = null;
      else if (g) {
        const weight = 0.84 * smooth(phase / 0.18) * smooth((1 - phase) / 0.22);
        g.state.seek(phase);
        for (const [b, sample] of g.pairs) {
          b.position.lerp(sample.position, weight);
          b.quaternion.slerp(sample.quaternion, weight);
        }
      } else glance = Math.sin(phase * Math.PI) ** 2 * (this.count % 2 ? 1 : -1);
    }
    // Lift and open the torso, not the feet. Work in the parent's axes since
    // native and mod rigs need not agree on which local direction is up.
    const b = this.body,
      breath = (1 - Math.cos((TAU * this.time) / 4.5)) / 2;
    if (b.parent) b.parent.getWorldQuaternion(parent).invert();
    else parent.identity();
    up.set(0, 0, 1).applyQuaternion(parent);
    pitch.set(1, 0, 0).applyQuaternion(parent);
    if (this.chest) b.position.addScaledVector(up, this.height * 0.022 * breath);
    // Rigid vehicles/droids get engine rock and a surveying turn, not stretching.
    b.quaternion.premultiply(turn.setFromAxisAngle(pitch, (this.chest ? 5.2 : 2.2) * DEG * breath));
    if (glance) b.quaternion.premultiply(turn.setFromAxisAngle(up, (this.chest ? 18 : 12) * DEG * glance));
    this.inst.syncFromBones();
  }
}
