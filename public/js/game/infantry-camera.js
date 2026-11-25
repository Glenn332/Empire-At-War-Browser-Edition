import { Quaternion, Vector3 } from 'three';
import { heightAt } from './terrain.js';

// The dot stays at the hip reticle's height. Shoulder focus brings it a
// little left, toward the helmet, without changing the selected world point.
export const FOOT_SIGHT = 0.34,
  SHOULDER_X = 0.47;
const forward = new Vector3(0, 0, -1),
  localRay = new Vector3(),
  rotation = new Quaternion();
export function infantryChase(out, x, y, z, yaw, pitch, back, fov, shoulder = 0) {
  const c = Math.cos(pitch),
    s = Math.sin(pitch),
    lift = back * Math.tan((fov * Math.PI) / 360) * (0.39 - 0.21 * shoulder),
    side = back * 0.15 * shoulder;
  const horizontal = back * c + lift * s;
  out.set(
    x - Math.cos(yaw) * horizontal + Math.sin(yaw) * side,
    y - Math.sin(yaw) * horizontal - Math.cos(yaw) * side,
    z - back * s + lift * c
  );
}
// cam already looks at the actual aim point. Rotate so the ray at the HUD
// pixel maps to that direction, including at narrow FOVs and wide aspects.
// No projection offsets left behind for first person, seats, death cam or RTS.
export function composeSight(cam, screenX, screenY) {
  const tan = Math.tan((cam.fov * Math.PI) / 360);
  localRay.set((2 * screenX - 1) * tan * cam.aspect, (1 - 2 * screenY) * tan, -1).normalize();
  cam.quaternion.multiply(rotation.setFromUnitVectors(localRay, forward));
}

// Test the whole boom, not just its endpoint. Retract immediately and ease out
// when the sight line clears. This affects only the render camera, never shots.
export function terrainBoom(camera, x, y, z, terrain, previous = 1, dt = 0) {
  const dx = camera.x - x,
    dy = camera.y - y,
    dz = camera.z - z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / 4));
  let limit = 1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (z + dz * t < heightAt(terrain, x + dx * t, y + dy * t) + 2) {
      limit = (i - 1) / steps;
      break;
    }
  }
  const t = Math.min(limit, previous + (1 - previous) * (1 - Math.exp(-9 * dt)));
  camera.x = x + dx * t;
  camera.y = y + dy * t;
  camera.z = z + dz * t;
  return t;
}
