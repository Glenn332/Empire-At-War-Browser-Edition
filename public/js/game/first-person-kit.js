import * as THREE from 'three';
import { buildModel } from '../model.js';
import { AnimState } from '../ala.js';

const origin = new THREE.Vector3(),
  up = new THREE.Vector3(0, 0, 1),
  tmp = new THREE.Vector3(),
  bore = new THREE.Vector3(),
  turn = new THREE.Quaternion();
const weaponName = /GUN(?!NER|SHIP)|WEAPON|BLASTER|RIFLE|PISTOL|LAUNCHER|BOWCASTER|CARBINE|CANNON/i;
const excluded = /FLASH|SHADOW|^COL_|COLLISION|PROJECTILE/i;

// Remove whole triangles, not bones collapsed to a point: collapsing a hidden
// shoulder leaves long connecting triangles across the screen on a quick turn.
export function handIndices(geometry, boneMap, bones, keep) {
  const { skinIndex: ids, skinWeight: weights } = geometry.attributes;
  if (!ids || !weights || !geometry.index) return [];
  const allowed = new Uint8Array(ids.count);
  for (let i = 0; i < ids.count; i++) {
    let total = 0,
      held = 0;
    for (let j = 0; j < 4; j++) {
      const w = weights.array[i * 4 + j];
      total += w;
      if (keep.has(bones[boneMap[ids.array[i * 4 + j]]])) held += w;
    }
    allowed[i] = total > 0 && held >= total * 0.98;
  }
  const out = [],
    ix = geometry.index.array;
  for (let i = 0; i < ix.length; i += 3)
    if (allowed[ix[i]] && allowed[ix[i + 1]] && allowed[ix[i + 2]]) out.push(ix[i], ix[i + 1], ix[i + 2]);
  return out;
}

// Only stretch the render copy's sleeve back past the near plane. The wrist,
// gun and fingers retain their authored world transforms. This keeps the weapon
// at a readable scale without a cut elbow floating in front of the player.
function tuckSleeve(arm, wrist, tip, forward, eyeDistance) {
  const elbow = arm.getWorldPosition(new THREE.Vector3());
  const hand = wrist.getWorldPosition(new THREE.Vector3());
  const along = elbow.clone().sub(hand),
    len2 = along.lengthSq();
  const extra = eyeDistance - tip.clone().sub(elbow).dot(forward);
  if (extra <= 0 || len2 < 1e-5 || !arm.parent) return;
  along.divideScalar(len2);
  const move = forward.clone().multiplyScalar(-extra),
    t = -along.dot(hand);
  const stretch = new THREE.Matrix4().set(
    1 + move.x * along.x,
    move.x * along.y,
    move.x * along.z,
    move.x * t,
    move.y * along.x,
    1 + move.y * along.y,
    move.y * along.z,
    move.y * t,
    move.z * along.x,
    move.z * along.y,
    1 + move.z * along.z,
    move.z * t,
    0,
    0,
    0,
    1
  );
  const children = arm.children.filter(o => o.userData.restInv).map(o => [o, o.matrixWorld.clone()]);
  arm.matrix.premultiply(arm.parent.matrixWorld.clone().invert().multiply(stretch).multiply(arm.parent.matrixWorld));
  arm.matrixAutoUpdate = false;
  arm.updateMatrixWorld(true);
  for (const [bone, world] of children) {
    bone.matrix.copy(arm.matrixWorld).invert().multiply(world);
    bone.matrixAutoUpdate = false;
  }
}

export class FirstPersonKit {
  constructor(unit, clip, color) {
    this.scene = new THREE.Scene();
    this.mount = new THREE.Group();
    this.scene.add(this.mount);
    this.owned = [];
    this.stride = this.sprint = this.phase = 0;
    this.model = unit.inst?.model;
    this.weapon = unit.weapon;
    if (!this.model) return;
    const inst = buildModel(unit.inst.model, { teamColor: color, fresh: true });
    if (clip) new AnimState(inst, clip).pose();
    inst.root.updateMatrixWorld(true);
    let muzzle = inst.bone(unit.weapon?.muzzles?.[0]?.bone?.name) || inst.bones.find(b => /^MUZZLE/i.test(b.name));
    const boneSet = new Set(inst.bones),
      keep = new Set(),
      elbows = [];
    const keepTree = b =>
      b?.traverse(o => {
        if (boneSet.has(o)) keep.add(o);
      });
    for (const side of ['R', 'L']) {
      const arm = inst.bone('B_FARM_' + side);
      const hand = inst.bone('B_HAND_' + side);
      if (arm && hand) elbows.push([arm, hand]);
      keepTree(arm);
      keepTree(hand);
    }
    for (const b of inst.bones) if (weaponName.test(b.name) && !excluded.test(b.name)) keepTree(b);
    keepTree(muzzle);
    const skins = new Map(inst.skins.map(sk => [sk.mesh, sk]));
    let meshes = 0;
    const rigidWeapon = new THREE.Box3();
    for (const g of new Set(inst.meshByName.values())) {
      if (!g.parent || !g.visible || excluded.test(g.name)) {
        g.visible = false;
        continue;
      }
      for (const o of g.children) {
        const sk = skins.get(o);
        if (sk) {
          const indices = handIndices(o.geometry, sk.boneMap, inst.bones, keep);
          if (!indices.length) {
            o.visible = false;
            continue;
          }
          // Geometry is cached across world units. Own the filtered copy and
          // its GPU buffers; never mutate/dispose the shared source geometry.
          const geo = o.geometry.clone();
          geo.setIndex(indices);
          o.geometry = geo;
          this.owned.push(geo);
        } else if (!keep.has(g.parent) && !weaponName.test(g.name)) {
          o.visible = false;
          continue;
        }
        if (!muzzle && !sk && (weaponName.test(g.name) || weaponName.test(g.parent.name))) {
          o.geometry.computeBoundingBox();
          rigidWeapon.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
        }
        o.frustumCulled = false;
        meshes++;
      }
    }
    // Some replacement weapons name the rigid mesh but omit the muzzle bone.
    // Use the front of that mesh, never a whole-character box or the head.
    if (!muzzle && !rigidWeapon.isEmpty()) {
      muzzle = new THREE.Object3D();
      rigidWeapon.getCenter(muzzle.position);
      muzzle.position.y = rigidWeapon.min.y;
      inst.root.add(muzzle);
    }
    // A monolithic unrigged mod model isn't safe to crop. Never expose its body.
    if (!meshes || !muzzle) return;
    this.flashes = [...new Set(inst.meshByName.values())].filter(
      g => /flash/i.test(g.name) && (g.parent === muzzle || g.parent?.parent === muzzle)
    );
    this.muzzle = muzzle;
    this.barrels = (unit.weapon?.muzzles || []).map(m => inst.bone(m.bone?.name) || muzzle);
    this.tip = muzzle.getWorldPosition(new THREE.Vector3());
    // Attack poses face local -Y. When the model has an authored flash marker
    // beyond the bore, use it (the grip-to-tip line isn't the barrel axis).
    const forward = new THREE.Vector3(0, -1, 0),
      flash = muzzle.children.find(b => boneSet.has(b) && /flash/i.test(b.name));
    if (flash) {
      tmp.copy(flash.getWorldPosition(new THREE.Vector3())).sub(this.tip).normalize();
      if (tmp.dot(forward) > 0.8) forward.copy(tmp);
    }
    const upright = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(origin, forward, up)).invert();
    this.axis = forward;
    // Place the firing grip between the muzzle and the eye, irrespective of
    // asset units. A short pistol should not fill the screen like a launcher.
    const grip = inst.bone('B_HAND_R') || muzzle.parent;
    const bodyHeight = Math.max(1, inst.box.max.z - inst.box.min.z);
    const length = Math.max(bodyHeight * 0.26, grip ? tmp.copy(this.tip).sub(grip.getWorldPosition(new THREE.Vector3())).dot(forward) : 0);
    this.depth = 3;
    this.scale = (this.depth * 0.55) / length;
    for (const [arm, hand] of elbows) tuckSleeve(arm, hand, this.tip, forward, (this.depth * 1.5) / this.scale);
    inst.syncFromBones();
    inst.root.quaternion.copy(upright);
    inst.root.scale.setScalar(this.scale);
    inst.root.position.copy(this.tip).applyQuaternion(upright).multiplyScalar(-this.scale);
    this.mount.add(inst.root);
    this.root = inst.root;
  }

  place(cam, kick = 0, firing = false, dt = 0, pace = 0, sprinting = false, sway = 1, tuck = 0, forward = 0, side = 0, focusAt = null) {
    if (!this.root) return;
    for (const flash of this.flashes) flash.visible = firing;
    cam.updateWorldMatrix(true, false);
    const d = this.depth,
      tan = Math.tan((cam.fov * Math.PI) / 360);
    // Place the muzzle in the lower right by translation, NOT by pitching the
    // whole weapon upward. Keep the same sight line under yaw, pitch and recoil.
    // Local gait, normalized by the character's height: no world-space lag on
    // fast turns. Keep the lower carry even if the player disables rhythmic bob.
    const ease = 1 - Math.exp(-dt * 13);
    this.stride += ((pace > 0 ? sway : 0) - this.stride) * ease;
    this.sprint += (Number(sprinting) - this.sprint) * ease;
    this.phase = (this.phase + dt * Math.min(15, pace * 4.5)) % (Math.PI * 2);
    const step = Math.sin(this.phase) * this.stride,
      lift = Math.cos(this.phase * 2) * this.stride,
      run = this.sprint;
    tmp
      .set(
        d * tan * Math.min(cam.aspect, 2) * (0.22 - 0.34 * run + step * (0.017 + 0.012 * run) - tuck * (0.15 + side * 0.13)),
        d * tan * (-0.22 - 0.31 * run + lift * (0.024 + 0.023 * run) - tuck * (0.33 + forward * 0.08)),
        -d + Math.min(0.15, kick)
      )
      .applyMatrix4(cam.matrixWorld);
    this.mount.position.copy(tmp);
    this.mount.quaternion.copy(cam.quaternion);
    this.mount.rotateY(0.065 + run * 0.48 + step * 0.012 + tuck * 0.26);
    this.mount.rotateX(0.03 - run * 0.34 + lift * 0.008 - tuck * (0.25 + 0.34 * forward));
    this.mount.rotateZ(-run * 0.23 + step * 0.024 - tuck * (0.2 + 0.78 * side));
    if (focusAt) {
      // The mount pivots at the muzzle. Sight the bore on the actual focus
      // point without sliding the hands off the gun or centering the muzzle.
      bore.copy(this.axis).applyQuaternion(this.root.quaternion).applyQuaternion(this.mount.quaternion);
      tmp.set(focusAt.x, focusAt.y, focusAt.z).sub(this.mount.position).normalize();
      if (tmp.dot(bore) > .5) this.mount.quaternion.premultiply(turn.setFromUnitVectors(bore, tmp));
    }
    this.scene.updateMatrixWorld(true);
  }
  dispose() {
    for (const g of this.owned) g.dispose();
    this.scene.clear();
  }
}
