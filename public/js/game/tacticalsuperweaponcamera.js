import * as THREE from 'three';
export function cameraEase(t, a, b) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const d = 1 - b,
    k = 2 / (d + 1 - a),
    base = (k * a) / 2;
  if (a > 0 && t < a) return (k * t * t) / (2 * a);
  if (t < d) return base + k * (t - a);
  return base + k * (d - a) + (k * (t - (t * t) / 2 - d + (d * d) / 2)) / (1 - d);
}
export function superweaponShot(game, weapon, target) {
  const savedCamera = game.renderer.camera.clone(false),
    rig = game.renderer.rig,
    savedRig = rig ? Object.fromEntries(['x', 'y', 'yaw', 'pitch', 'dist'].map(k => [k, rig[k]])) : null;
  const model = weapon.model,
    box = model?.box;
  const size = box ? box.getSize(new THREE.Vector3()).multiplyScalar(0.5) : new THREE.Vector3(1, 1, 1);
  const offset0 = new THREE.Vector3(2 * size.x, -2 * size.y, 2 * size.z),
    offset1 = new THREE.Vector3(1.5 * size.x, -1.5 * size.y, 1.5 * size.z),
    offset2 = new THREE.Vector3(15 * size.x, -5 * size.y, 5 * size.z),
    lookOffset = new THREE.Vector3(0, -size.y, 0.15 * size.z);
  const midpoint = new THREE.Vector3((weapon.x + target.x) / 2, (weapon.y + target.y) / 2, (weapon.z + target.z) / 2);
  const station = game.map.objects.find(o => o.type.name.toUpperCase().replace(/[\s_]+/g, ' ') === 'SPACE STATION POSITION');
  let final = null;
  if (station) {
    const pos = new THREE.Vector3(...station.pos),
      direction = pos.clone().sub(new THREE.Vector3(target.x, target.y, target.z)),
      length = direction.length();
    final = pos.add(direction.multiplyScalar(length ? (length + 2000) / length : 0));
  }
  const relative = (offset, out) => {
    weapon.obj.updateMatrixWorld(true);
    out.copy(offset).applyMatrix4(weapon.obj.matrixWorld);
    out.z += weapon.type.num('Ranged_Target_Z_Adjust', 6);
    return out;
  };
  const p = new THREE.Vector3(),
    q = new THREE.Vector3(),
    look = new THREE.Vector3();
  let time = 0;
  return {
    duration: 25.5,
    stop() {
      game.renderer.camera.copy(savedCamera, false);
      game.renderer.camera.updateProjectionMatrix();
      if (rig) Object.assign(rig, savedRig);
    },
    frame(dt) {
      time += dt;
      if (time >= 25.5 || game.over) return false;
      if (time < 10) {
        relative(offset0, p);
        relative(offset1, q);
        p.lerp(q, cameraEase(time / 10, 0.5, 0.25));
      } else if (time < 10.5) relative(offset1, p);
      else {
        relative(offset2, p);
        if (final) p.lerp(final, cameraEase((time - 10.5) / 15, 0.5, 0));
      }
      if (time < 10.5) relative(lookOffset, look);
      else look.copy(midpoint);
      const camera = game.renderer.camera;
      camera.position.copy(p);
      camera.up.set(0, 0, 1);
      camera.lookAt(look);
      game.cine.lookX = look.x;
      game.cine.lookY = look.y;
      game.cine.camDist = p.distanceTo(look);
      return true;
    }
  };
}
