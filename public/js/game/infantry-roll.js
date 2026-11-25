import { Vector3, Quaternion } from 'three';

// About the same travel as the old .32s dash, but time to see the tuck,
// rotation and recovery. Movement and both presentations use this one clock.
export const ROLL = { duration: 0.5, distance: 0.832, cooldown: 1.4 };
export function startRoll(f, s, yaw) {
  const length = Math.hypot(f, s);
  if (length < 0.01) {
    f = 1;
    s = 0;
  } else {
    f /= length;
    s /= length;
  }
  const c = Math.cos(yaw),
    sn = Math.sin(yaw);
  return { f, s, x: c * f + sn * s, y: sn * f - c * s, t: ROLL.duration };
}
export function rollPhase(roll) {
  return roll ? Math.max(0, Math.min(1, 1 - roll.t / ROLL.duration)) : 0;
}
export function rollTuck(phase) {
  return Math.sin(Math.PI * phase) ** 2;
}

// Transform only for the scene draw (before instancing). Never rotate the
// simulated soldier, muzzle, collision shape or bones into the ground.
export class RollPose {
  constructor() {
    this.pos = new Vector3();
    this.scale = new Vector3();
    this.q = new Quaternion();
    this.axis = new Vector3();
    this.rotation = new Quaternion();
    this.offset = new Vector3();
  }
  apply(holder, roll, height) {
    const p = rollPhase(roll),
      tuck = rollTuck(p);
    if (!holder || !tuck) return;
    this.holder = holder;
    this.pos.copy(holder.position);
    this.scale.copy(holder.scale);
    this.q.copy(holder.quaternion);
    const angle = 2 * Math.PI * p * p * (3 - 2 * p),
      compressed = 1 - 0.3 * tuck,
      pivot = height * 0.47 * compressed;
    this.rotation.setFromAxisAngle(this.axis.set(-roll.y, roll.x, 0), angle);
    holder.scale.z *= compressed;
    // Roll a tucked silhouette around its own middle. Carry the pivot just
    // high enough for its changing vertical extent, rather than orbiting the feet.
    this.offset.set(0, 0, pivot).applyQuaternion(this.rotation);
    holder.position.sub(this.offset);
    holder.position.z += Math.hypot(pivot * Math.cos(angle), height * 0.25 * Math.sin(angle));
    holder.quaternion.premultiply(this.rotation);
    holder.updateMatrixWorld(true);
  }
  restore() {
    const h = this.holder;
    if (!h) return;
    h.position.copy(this.pos);
    h.quaternion.copy(this.q);
    h.scale.copy(this.scale);
    h.updateMatrixWorld(true);
    this.holder = null;
  }
}
