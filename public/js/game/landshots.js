import * as THREE from 'three';
import { loadModel } from '../model.js';
import { db } from '../gamedata.js';
import { LaserBatch } from './laser.js';
import { MuzzleLaunches } from './shot-presentation.js';
import { CAT, categoryOf } from './projflight.js';

const MAX = 900;
const _q = new THREE.Quaternion(),
  _X = new THREE.Vector3(1, 0, 0),
  _up = new THREE.Vector3(0, 0, 1);

export class Shots {
  constructor(scene, fx, battlefront = false) {
    this.scene = scene;
    this.fx = fx;
    this.beams = new LaserBatch(MAX, false, battlefront);
    this.kites = new LaserBatch(MAX, true);
    // Tinted, particle-atlas blasters (e.g. ion bolts) use the same round
    // silhouette, without turning a missile that uses that atlas into a laser.
    this.kiteBolts = battlefront ? new LaserBatch(MAX, true, true) : null;
    this.batches = [this.beams, this.kites, ...(this.kiteBolts ? [this.kiteBolts] : [])];
    scene.add(...this.batches.map(b => b.mesh));
    this.looks = new Map();
    this.live = new Map();
    this.launches = new MuzzleLaunches();
    this.spare = new Map();
  }

  lookOf(P) {
    let L = this.looks.get(P);
    if (L) return L;
    const file = P.str('Land_Model_Name') || P.str('Space_Model_Name'),
      mode = P.num('Projectile_Custom_Render', 0);
    if (/INVISIBLE/i.test(file)) L = { kind: 'none' };
    else if (!mode && !file) L = { kind: 'none' };
    else if (mode > 0) {
      const laser = LaserBatch.lookOf(P);
      let batch = laser.kite ? this.kites : this.beams;
      if (laser.kite && this.kiteBolts && categoryOf(P) === CAT.LASER) batch = this.kiteBolts;
      L = { kind: 'pill', laser, batch, long: P.num('Projectile_Length', 3), wide: P.num('Projectile_Width', 0.3) };
    } else if (/^P_/i.test(file)) L = { kind: 'fx', file };
    else L = { kind: 'model', file, scale: P.num('Scale_Factor', 1) };
    this.looks.set(P, L);
    return L;
  }

  update(shots, camera, look, source = null) {
    const seen = new Set(), span = 1 / Math.max(1, camera.far - camera.near),
      beamScale = db.constants.num('Laser_Beam_Z_Scale_Factor', 8), kiteScale = db.constants.num('Laser_Kite_Z_Scale_Factor', 1.2);
    for (const batch of this.batches) {
      batch.begin();
      const u = batch.mesh.material.uniforms;
      u.depthSpan.value.set(span, camera.near * span);
      u.zScale.value = batch.kite ? kiteScale : beamScale;
    }
    for (const s of shots) {
      if (s.hidden) continue;
      const L = this.lookOf(s.w.proj);
      if (L.kind === 'none') continue;
      const p = this.launches.sample(s, source);
      if (L.kind === 'pill') {
        if (look && (s.x - look.x) ** 2 + (s.y - look.y) ** 2 > look.r * look.r * 1.5) continue;
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1,
          dx = p.vx / sp,
          dy = p.vy / sp,
          dz = p.vz / sp;
        const near = p.near || 0,
          scale = 1 - near * 0.91,
          focused = this.launches.focused.has(s),
          len = L.long * scale * (focused ? 1.7 : 1),
          width = L.wide * scale * (focused ? 1.8 : 1);
        // The pill is centered. Its trailing cap, not its middle, leaves the tip.
        const front = (p.launch || 0) * (len * 0.5 + width);
        L.batch.add(p.x + dx * front, p.y + dy * front, p.z + dz * front, dx, dy, dz, len, width, L.laser);
        continue;
      }
      seen.add(s);
      let it = this.live.get(s);
      if (!it) {
        if (L.kind === 'fx') {
          it = { pose: p };
          it.sys = this.fx.spawn(L.file, f => {
            const a = it.pose;
            f.x = a.x;
            f.y = a.y;
            f.z = a.z;
            f.rot = Math.atan2(a.vy, a.vx) + Math.PI / 2;
            f.scale = 1 - 0.91 * (a.near || 0);
            f.vx = a.vx;
            f.vy = a.vy;
            f.vz = a.vz || 0;
          });
          if (!it.sys) continue;
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
      if (it.sys) it.pose = p;
      if (it.holder) {
        const sp = Math.hypot(p.vx, p.vy) || 1e-3,
          k = Math.max(0, 1 - s.left / s.total);
        const rise = p.vz + (s.arc ? (s.arc * 4 * (1 - 2 * k) * (s.speed ?? s.w.speed)) / Math.max(1, s.total) : 0);
        it.holder.position.set(p.x, p.y, p.z);
        it.holder.scale.setScalar(L.scale * (1 - 0.91 * (p.near || 0)));
        it.holder.quaternion
          .setFromAxisAngle(_up, Math.atan2(p.vy, p.vx) + Math.PI / 2)
          .multiply(_q.setFromAxisAngle(_X, -Math.atan2(rise, sp)));
      }
    }
    for (const batch of this.batches) batch.end();
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
