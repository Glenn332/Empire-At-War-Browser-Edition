import * as THREE from 'three';
import { loadModel } from '../model.js';
import { loadALA, animName, AnimState } from '../ala.js';
import { heightAt, CELL } from './terrain.js';
import { db } from '../gamedata.js';
import { POSE_MARGIN } from './landinstances.js';

const FPS = 30,
  DEG = Math.PI / 180;
const _Z = new THREE.Vector3(0, 0, 1),
  _Y = new THREE.Vector3(0, 1, 0),
  _q = new THREE.Quaternion();

export const isAmbient = t => {
  const b = t.str('LandBehavior') + ' ' + t.str('Behavior');
  return (
    /INDIGENOUS_UNIT/i.test(b) && /LOCOMOTOR/i.test(b) && !t.list('Projectile_Types').length && !t.has('Spawned_Indigenous_Units_Type')
  );
};

export class Wildlife {
  constructor(world, scene, fog = true) {
    this.world = world;
    this.scene = scene;
    this.list = [];
    this.scan = 0;
    this.fog = fog;
  }

  async add(type, x, y, heading = 0, scale = 1) {
    const file = type.str('Land_Model_Name'),
      inst = file && (await loadModel(file).catch(() => null));
    if (!inst) return null;
    const holder = new THREE.Group();
    holder.add(inst.root);
    holder.scale.setScalar(type.num('Scale_Factor', 1) * scale);
    this.scene.add(holder);
    const [idle, move] = await Promise.all(['IDLE', 'MOVE'].map(k => Promise.resolve(loadALA(animName(file, k))).catch(() => null)));
    const flies = /FIGHTER_LOCOMOTOR/i.test(type.str('LandBehavior')) || /flying/i.test(type.str('MovementClass'));
    const c = {
      type,
      holder,
      inst,
      idle,
      move: move || idle,
      flies,
      x,
      y,
      z: 0,
      heading,
      home: { x, y },
      goal: null,
      wait: Math.random() * 6,
      anim: null,
      kind: '',
      speed: type.num('Max_Speed', 1) * FPS * db.constants.num('Object_Max_Speed_Multiplier_Land', 1),
      turn: type.num('Max_Rate_Of_Turn', 3) * FPS * DEG,
      pace: type.num('Movement_Animation_Speed', 1),
      shy: type.num('Sensor_Range', 0),
      lift: type.num('Hover_Offset', 0),
      bank: type.num('Bank_Turn_Angle', 0) * DEG,
      ring: 90 + Math.random() * 140,
      way: Math.random() < 0.5 ? 1 : -1,
      at: Math.random() * Math.PI * 2
    };
    this.list.push(c);
    return c;
  }

  setAnim(c, kind) {
    if (c.kind === kind) return;
    c.kind = kind;
    const a = kind === 'move' ? c.move : c.idle;
    c.anim = a ? new AnimState(c.inst, a, { loop: true, time: Math.random() * a.duration }) : null;
  }

  update(dt, look) {
    const w = this.world,
      T = w.terrain;
    const fright = (this.scan -= dt) <= 0;
    if (fright) this.scan = 0.5;
    for (const c of this.list) {
      if (c.flies) {
        c.at += ((c.way * c.speed) / c.ring) * dt;
        c.x = c.home.x + Math.cos(c.at) * c.ring;
        c.y = c.home.y + Math.sin(c.at) * c.ring;
        c.heading = c.at + (c.way * Math.PI) / 2;
        c.z = heightAt(T, c.x, c.y) + c.lift;
        this.setAnim(c, 'move');
      } else {
        if (fright && c.shy > 0) {
          let near = null,
            nd = c.shy * c.shy;
          for (const u of w.units) {
            if (u.dead || u.structure || u.inside || u.flies) continue;
            const d = (u.x - c.x) ** 2 + (u.y - c.y) ** 2;
            if (d < nd) {
              nd = d;
              near = u;
            }
          }
          if (near) {
            const a = Math.atan2(c.y - near.y, c.x - near.x) + (Math.random() - 0.5);
            const gx = c.x + Math.cos(a) * 110,
              gy = c.y + Math.sin(a) * 110;
            if (w.isOpen(gx, gy)) {
              c.goal = { x: gx, y: gy };
              c.wait = 0;
            }
          }
        }
        if (!c.goal && (c.wait -= dt) <= 0) {
          const a = Math.random() * Math.PI * 2,
            r = 40 + Math.random() * 130,
            gx = c.home.x + Math.cos(a) * r,
            gy = c.home.y + Math.sin(a) * r;
          if (w.isOpen(gx, gy) && w.clear(c.x, c.y, gx, gy)) c.goal = { x: gx, y: gy };
          else c.wait = 1;
        }
        if (c.goal) {
          const dx = c.goal.x - c.x,
            dy = c.goal.y - c.y,
            d = Math.hypot(dx, dy);
          let da = Math.atan2(dy, dx) - c.heading;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          c.heading += Math.max(-c.turn * dt, Math.min(c.turn * dt, da));
          if (Math.abs(da) < 0.7) {
            const go = Math.min(d, c.speed * dt),
              nx = c.x + Math.cos(c.heading) * go,
              ny = c.y + Math.sin(c.heading) * go;
            if (w.isOpen(nx, ny)) {
              c.x = nx;
              c.y = ny;
            } else {
              c.goal = null;
              c.wait = 2;
            }
          }
          if (d < 6) {
            c.goal = null;
            c.wait = 3 + Math.random() * 9;
          }
          this.setAnim(c, 'move');
        } else this.setAnim(c, 'idle');
        c.z = heightAt(T, c.x, c.y);
      }
      const m = T.fogSeen ? Math.ceil(T.size / 2) : 0;
      const seen =
        !m ||
        !this.fog ||
        T.fogSeen[
          Math.min(m - 1, Math.max(0, Math.round(c.y / (CELL * 2)))) * m + Math.min(m - 1, Math.max(0, Math.round(c.x / (CELL * 2))))
        ];
      c.holder.visible = !!seen;
      if (!seen || (look && ((c.x - look.x) ** 2 + (c.y - look.y) ** 2 > look.r * look.r || (look.see && !look.see(c, POSE_MARGIN)))))
        continue;
      c.holder.position.set(c.x, c.y, c.z);
      c.holder.quaternion.setFromAxisAngle(_Z, c.heading + Math.PI / 2);
      if (c.flies && c.bank) c.holder.quaternion.multiply(_q.setFromAxisAngle(_Y, c.way * c.bank * 0.5));
      if (c.anim) c.anim.step(dt * (c.kind === 'move' ? c.pace || 1 : 1));
    }
  }
}
