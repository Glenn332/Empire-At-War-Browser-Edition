import { Quaternion, Vector3 } from 'three';

// Opaque hull bounds, not muzzle flashes, selection rings or a world-axis box
// that changes size as the model turns. EaW land models face local -Y.
export function vehicleRig(u) {
  const box = u.inst?.box,
    s = u.holder.scale.x;
  const fallback = Math.max(8, (u.hitRadius || 4) * 2);
  const half = new Vector3(fallback / 2, fallback / 2, Math.max(4, u.aimZ || fallback * 0.45) / 2);
  const center = new Vector3(0, 0, half.z);
  if (box && !box.isEmpty() && (box.max.y - box.min.y) * s > 2) {
    box.getCenter(center).multiplyScalar(s);
    box
      .getSize(half)
      .multiplyScalar(s / 2)
      .max(minHalf);
  }
  return { unit: u, center, half, pivot: new Vector3(), fresh: true };
}

const minHalf = new Vector3(1, 1, 1.5),
  zAxis = new Vector3(0, 0, 1),
  inv = new Quaternion();
const center = new Vector3(),
  right = new Vector3(),
  up = new Vector3(),
  local = new Vector3();
function extent(half, axis) {
  local.copy(axis).applyQuaternion(inv);
  return Math.abs(local.x) * half.x + Math.abs(local.y) * half.y + Math.abs(local.z) * half.z;
}

// Project the oriented hull onto the view axes. Reserve the upper screen for
// aiming and the bottom strip for the HUD. This frames a tall walker and a
// banking speeder without per-unit offsets or scanning meshes every frame.
export function chaseVehicle(out, rig, d, dt, aspect, fov, zoom = false, pull = 0, raise = 0) {
  const { unit, half, pivot } = rig,
    q = unit.holder.quaternion;
  center.copy(rig.center).applyQuaternion(q).add(unit.holder.position);
  right.crossVectors(d, zAxis).normalize();
  up.crossVectors(right, d);
  inv.copy(q).invert();
  const roof = extent(half, up),
    depth = extent(half, d),
    tan = Math.tan((fov * Math.PI) / 360);
  const clearance =
    Math.max((2 * roof) / (zoom ? 0.86 : 0.72), extent(half, right) / (0.72 * Math.max(0.3, aspect)), half.length() * 0.75) / tan;
  const back = (depth + clearance) * (1 + pull * 1.8);
  // Let the hull lead slightly in motion, but never leave the frame at takeoff,
  // on a teleport or when switching seats. Mouse aim itself is never damped.
  if (rig.fresh) pivot.copy(center);
  else
    pivot
      .sub(center)
      .multiplyScalar(Math.exp(-12 * dt))
      .clampLength(0, Math.min(roof, depth) * 0.15)
      .add(center);
  rig.fresh = false;
  return out
    .copy(pivot)
    .addScaledVector(d, -back)
    .addScaledVector(up, roof + clearance * tan * 0.07 + raise * back);
}

// EaW doesn't ship BFII cockpit interiors. Put the driver's eye just clear of
// the roof, toward the front, and follow the actual chassis pose when it banks.
export function vehicleEye(out, rig) {
  const { unit, half } = rig;
  out.copy(rig.center);
  out.y -= half.y * 0.48;
  out.z += half.z + Math.max(1.5, half.z * 0.14);
  return out.applyQuaternion(unit.holder.quaternion).add(unit.holder.position);
}
