import * as THREE from 'three';
import { loadModel } from '../model.js';
import { db } from '../gamedata.js';
import { LaserBatch } from './laser.js';

const MAX = 900;
const _q = new THREE.Quaternion(),
  _X = new THREE.Vector3(1, 0, 0),
  _up = new THREE.Vector3(0, 0, 1);

export class Shots {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.beams = new LaserBatch(MAX, false);
    this.kites = new LaserBatch(MAX, true);
    scene.add(this.beams.mesh, this.kites.mesh);
    this.looks = new Map();
    this.live = new Map();
    this.spare = new Map();
  }

  lookOf(P) {
    let L = this.looks.get(P);
    if (L) return L;
    const file = P.str('Land_Model_Name') || P.str('Space_Model_Name'),
      mode = P.num('Projectile_Custom_Render', 0);
    if (/INVISIBLE/i.test(file)) L = { kind: 'none' };
    else if (!mode && !file) L = { kind: 'none' };
    else if (mode > 0)
      L = { kind: 'pill', laser: LaserBatch.lookOf(P), long: P.num('Projectile_Length', 3), wide: P.num('Projectile_Width', 0.3) };
    else if (/^P_/i.test(file)) L = { kind: 'fx', file };
    else L = { kind: 'model', file, scale: P.num('Scale_Factor', 1) };
    this.looks.set(P, L);
    return L;
  }

  update(shots, camera, look) {
    const seen = new Set(),
      beams = this.beams,
      kites = this.kites;
    beams.begin();
    kites.begin();
    {
      const span = 1 / Math.max(1, camera.far - camera.near),
        C = db.constants,
        bu = beams.mesh.material.uniforms,
        ku = kites.mesh.material.uniforms;
      bu.depthSpan.value.set(span, camera.near * span);
      ku.depthSpan.value.set(span, camera.near * span);
      bu.zScale.value = C.num('Laser_Beam_Z_Scale_Factor', 8);
      ku.zScale.value = C.num('Laser_Kite_Z_Scale_Factor', 1.2);
    }
    for (const s of shots) {
      if (s.hidden) continue;
      const L = this.lookOf(s.w.proj);
      if (L.kind === 'none') continue;
      if (L.kind === 'pill') {
        if (look && (s.x - look.x) ** 2 + (s.y - look.y) ** 2 > look.r * look.r * 1.5) continue;
        const sp = Math.hypot(s.vx, s.vy, s.vz) || 1;
        (L.laser.kite ? kites : beams).add(s.x, s.y, s.z, s.vx / sp, s.vy / sp, s.vz / sp, L.long, L.wide, L.laser);
        continue;
      }
      seen.add(s);
      let it = this.live.get(s);
      if (!it) {
        if (L.kind === 'fx') {
          const sys = this.fx.spawn(L.file, f => {
            f.x = s.x;
            f.y = s.y;
            f.z = s.z;
            f.rot = Math.atan2(s.vy, s.vx);
            f.scale = 1;
            f.vx = s.vx;
            f.vy = s.vy;
            f.vz = s.vz || 0;
          });
          if (!sys) continue;
          it = { sys };
        } else {
          const pool = this.spare.get(L.file) || [];
          let holder = pool.pop();
          if (!holder) {
            holder = new THREE.Group();
            holder.scale.setScalar(L.scale);
            loadModel(L.file)
              .then(inst => {
                if (inst) holder.add(inst.root);
              })
              .catch(() => {});
            this.scene.add(holder);
          }
          holder.visible = true;
          it = { holder, file: L.file };
        }
        this.live.set(s, it);
      }
      if (it.holder) {
        const sp = Math.hypot(s.vx, s.vy) || 1e-3,
          k = Math.max(0, 1 - s.left / s.total);
        const rise = s.vz + (s.arc ? (s.arc * 4 * (1 - 2 * k) * (s.speed ?? s.w.speed)) / Math.max(1, s.total) : 0);
        it.holder.position.set(s.x, s.y, s.z);
        it.holder.quaternion
          .setFromAxisAngle(_up, Math.atan2(s.vy, s.vx) + Math.PI / 2)
          .multiply(_q.setFromAxisAngle(_X, -Math.atan2(rise, sp)));
      }
    }
    beams.end();
    kites.end();
    for (const [s, it] of this.live) {
      if (seen.has(s)) continue;
      if (it.sys) it.sys.release();
      else {
        it.holder.visible = false;
        if (!this.spare.has(it.file)) this.spare.set(it.file, []);
        this.spare.get(it.file).push(it.holder);
      }
      this.live.delete(s);
    }
  }
}
