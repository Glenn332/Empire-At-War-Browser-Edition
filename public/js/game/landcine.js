import * as THREE from 'three';
import { db } from '../gamedata.js';
import { heightAt } from './terrain.js';

const rand = (a, b) => a + Math.random() * (b - a);
const _pos = new THREE.Vector3(),
  _look = new THREE.Vector3();

export class LandCinematic {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.shot = null;
    this.subject = this.lastSubject = null;
    this.bars = db.constants.num('Camera_FX_Manager_Letterbox_Height', 0.085);
  }

  toggle() {
    if (this.on) this.stop();
    else this.start();
  }

  start() {
    if (this.on) return;
    const g = this.game;
    this.on = true;
    document.body.classList.add('cinematic');
    document.documentElement.style.setProperty('--letterbox', this.bars * 100 + 'vh');
    this.fov = g.camera.fov;
    this.shot = null;
    if (g.ui) {
      g.ui.placing = g.ui.armed = g.ui.aiming = null;
    }
  }

  stop() {
    if (!this.on) return;
    const g = this.game;
    this.on = false;
    document.body.classList.remove('cinematic');
    g.camera.fov = this.fov;
    g.camera.up.set(0, 0, 1);
    g.camera.updateProjectionMatrix();
    this.subject = null;
  }

  seen(u) {
    return u && !u.dead && !u.inside && u.seen !== false && !u.scriptHidden && !u.mine;
  }

  pick() {
    const w = this.game.world;
    let best = null,
      bs = -Infinity;
    for (const u of w.units) {
      if (!this.seen(u) || u.structure) continue;
      const fighting = (u.target && !u.target.dead) || w.time - (u.lastHit ?? -99) < 4 || !!u.clash || !!u.quake;
      if (u.foot && u.squad && u.squad.members[0] !== u && !fighting) continue;
      let s = Math.min(60, u.hitRadius || 8) * 0.06 + (fighting ? 6 : 0) + (u.path && u.path.length ? 1.5 : 0) + Math.random() * 4;
      if (/HERO/i.test(u.type.str('CategoryMask'))) s += 3;
      if (u === this.lastSubject) s -= 8;
      if (s > bs) {
        bs = s;
        best = u;
      }
    }
    return best;
  }

  newShot() {
    const u = this.pick();
    if (!u) return null;
    this.lastSubject = this.subject = u;
    const r = Math.max(18, (u.hitRadius || 8) * 1.4, (u.aimZ || 6) * 2.4),
      foe = u.target && !u.target.dead ? u.target : null;
    const kinds = ['orbit', 'orbit', 'chase', 'low'];
    if (foe) kinds.push('duel', 'duel');
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    return {
      kind,
      u,
      foe,
      t: 0,
      len: rand(5, 8),
      r,
      a0: rand(0, 6.283),
      spin: rand(0.1, 0.24) * (Math.random() < 0.5 ? -1 : 1),
      up: rand(0.25, 0.6),
      dist: rand(2.2, 3.4),
      side: Math.random() < 0.5 ? -1 : 1
    };
  }

  frame(dt) {
    const g = this.game,
      cam = g.camera,
      T = g.terrain;
    let sh = this.shot;
    if (sh) sh.t += dt;
    if (!sh || sh.t > sh.len || !this.seen(sh.u)) sh = this.shot = this.newShot();
    if (!sh) {
      const v = g.view,
        t = (performance.now() / 1000) * 0.06,
        z = heightAt(T, v.x, v.y);
      _pos.set(v.x + Math.cos(t) * 420, v.y + Math.sin(t) * 420, z + 260);
      _look.set(v.x, v.y, z);
    } else {
      const u = sh.u,
        r = sh.r,
        c = Math.cos(u.heading),
        s = Math.sin(u.heading),
        mid = u.z + (u.aimZ || 6) * 0.8;
      const foe = sh.foe && !sh.foe.dead ? sh.foe : null;
      if (sh.kind === 'orbit') {
        const a = sh.a0 + sh.t * sh.spin,
          d = r * sh.dist;
        _pos.set(u.x + Math.cos(a) * d, u.y + Math.sin(a) * d, mid + d * sh.up);
        _look.set(u.x, u.y, mid);
      } else if (sh.kind === 'chase') {
        const back = r * (2.4 + sh.t * 0.05),
          off = sh.side * r * (0.6 + sh.t * 0.05);
        _pos.set(u.x - c * back - s * off, u.y - s * back + c * off, mid + r * (0.6 + sh.up));
        _look.set(u.x + c * r, u.y + s * r, mid);
      } else if (sh.kind === 'low') {
        const a = u.heading + sh.side * (0.5 + sh.t * 0.03),
          d = r * 2.6;
        _pos.set(u.x + Math.cos(a) * d, u.y + Math.sin(a) * d, u.z + Math.max(6, (u.aimZ || 6) * 0.5));
        _look.set(u.x, u.y, mid);
      } else {
        const dx = (foe ? foe.x : u.x + c) - u.x,
          dy = (foe ? foe.y : u.y + s) - u.y,
          l = Math.hypot(dx, dy) || 1,
          nx = dx / l,
          ny = dy / l;
        _pos.set(u.x - nx * r * 2.6 - ny * sh.side * r, u.y - ny * r * 2.6 + nx * sh.side * r, mid + r * (0.5 + sh.up * 0.6));
        if (foe) _look.set(u.x + dx * 0.45, u.y + dy * 0.45, (mid + foe.z + (foe.aimZ || 6) * 0.8) / 2);
        else _look.set(u.x, u.y, mid);
      }
    }
    let floor = heightAt(T, _pos.x, _pos.y);
    for (let k = 0.25; k < 1; k += 0.25)
      floor = Math.max(floor, heightAt(T, _pos.x + (_look.x - _pos.x) * k, _pos.y + (_look.y - _pos.y) * k) - (_look.z - _pos.z) * k);
    if (_pos.z < floor + 5) _pos.z = floor + 5;
    if (cam.fov !== 50) {
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }
    cam.position.copy(_pos);
    cam.up.set(0, 0, 1);
    cam.lookAt(_look);
    g.view.x = _look.x;
    g.view.y = _look.y;
  }
}
