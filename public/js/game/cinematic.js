import * as THREE from 'three';
import { db } from '../gamedata.js';

const rand = (a, b) => a + Math.random() * (b - a);
const _pos = new THREE.Vector3(), _look = new THREE.Vector3();

export class Cinematic {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.shot = null;
    this.lastSubject = null;
    this.bars = db.constants.num('Camera_FX_Manager_Letterbox_Height', 0.085);
  }

  toggle() { if (this.on) this.stop(); else this.start(); }

  start() {
    if (this.on) return;
    this.on = true;
    const g = this.game, R = g.renderer;
    document.body.classList.add('cinematic');
    document.documentElement.style.setProperty('--letterbox', (this.bars * 100) + 'vh');
    this.savedFov = R.camera.fov;
    R.cameraOverride = dt => this.frame(dt);
    g.ui.select([], false);
    g.ui.arm(null);
    this.shot = null;
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    this.sequence?.stop();this.sequence = null;
    const R = this.game.renderer;
    document.body.classList.remove('cinematic');
    R.cameraOverride = null;
    R.camera.fov = this.savedFov; R.camera.updateProjectionMatrix();
    if (this.subject && !this.subject.dead) { R.rig.x = this.subject.x; R.rig.y = this.subject.y; R.rig.clamp(); }
    this.subject = null;
  }

  onDeath(u) {
    if(this.sequence)return;
    if (!this.on || u.isSquad || u.visualRadius < 150 || !this.visible(u, true)) return;
    const spot = { x: u.x, y: u.y, z: u.z, heading: u.heading, speed: 0, visualRadius: u.visualRadius, wreck: true };
    this.subject = null;
    this.shot = { kind: 'orbit', u: spot, foe: null, t: 0, len: 9, r: Math.max(60, u.visualRadius), a0: u.heading + rand(1.2, 2.2) * (Math.random() < 0.5 ? -1 : 1), spin: rand(0.1, 0.16) * (Math.random() < 0.5 ? -1 : 1), up: rand(0.15, 0.35), dist: rand(2.4, 3.0), side: 1 };
  }

  visible(u, evenDead = false) {
    const w = this.game.world, me = this.game.human;
    return u && (evenDead || !u.dead) && !u.hyper && (!w.fog || (u.seenBy & me.bit) !== 0);
  }

  pickSubject() {
    const w = this.game.world;
    let best = null, bs = -Infinity;
    for (const u of w.units) {
      if (u.isFighter && u.squad && u.squad.fighters[0] !== u) continue;
      if (u.player.id < 0 || u.isPad || !this.visible(u)) continue;
      const fighting = (u.target && !u.target.dead) || w.time - (u.lastHitTime ?? -99) < 4;
      let s = Math.min(400, u.visualRadius) * 0.01 + (fighting ? 6 : 0) + (u.isStation ? -1 : 0) + Math.random() * 4;
      if (u === this.lastSubject) s -= 8;
      if (s > bs) { bs = s; best = u; }
    }
    return best;
  }

  newShot() {
    const u = this.pickSubject();
    if (!u) return null;
    this.lastSubject = this.subject = u;
    const r = Math.max(60, u.visualRadius), foe = u.target && !u.target.dead ? u.target : null;
    const kinds = ['orbit', 'chase', 'flyby'];
    if (foe) kinds.push('duel', 'duel');
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const shot = { kind, u, foe, t: 0, len: rand(5, 8.5), r, a0: rand(0, 6.283), spin: rand(0.08, 0.2) * (Math.random() < 0.5 ? -1 : 1), up: rand(0.12, 0.5), dist: rand(2.0, 3.2), side: Math.random() < 0.5 ? -1 : 1 };
    if (kind === 'flyby') {
      const ahead = Math.max(1.5 * r, (u.speed || 0) * shot.len * 0.5), c = Math.cos(u.heading), s = Math.sin(u.heading);
      shot.px = u.x + c * ahead - s * shot.side * r * 1.3; shot.py = u.y + s * ahead + c * shot.side * r * 1.3; shot.pz = u.z + r * rand(-0.15, 0.5);
    }
    return shot;
  }

  frame(dt) {
    if(this.sequence){if(!this.sequence.frame(dt))this.stop();return;}
    const cam = this.game.renderer.camera;
    const fov = 55;
    {
      let sh = this.shot;
      if (sh) sh.t += dt;
      if (!sh || sh.t > sh.len || (!sh.u.wreck && (sh.u.dead || !this.visible(sh.u)))) sh = this.shot = this.newShot();
      if (!sh) {
        const st = this.game.human.station, x = st && !st.dead ? st.x : 0, y = st && !st.dead ? st.y : 0, t = performance.now() / 1000 * 0.05;
        _pos.set(x + Math.cos(t) * 1500, y + Math.sin(t) * 1500, 500); _look.set(x, y, 0);
      } else {
        const u = sh.u, r = sh.r, c = Math.cos(u.heading), s = Math.sin(u.heading);
        const foe = sh.foe && !sh.foe.dead ? sh.foe : null;
        if (sh.kind === 'orbit') {
          const a = sh.a0 + sh.t * sh.spin, d = r * sh.dist;
          _pos.set(u.x + Math.cos(a) * d, u.y + Math.sin(a) * d, u.z + d * sh.up);
          _look.set(u.x, u.y, u.z);
        } else if (sh.kind === 'chase') {
          const back = r * (1.9 + sh.t * 0.05), off = sh.side * r * (0.5 + sh.t * 0.04);
          _pos.set(u.x - c * back - s * off, u.y - s * back + c * off, u.z + r * (0.45 + sh.up * 0.5));
          _look.set(u.x + c * r, u.y + s * r, u.z);
        } else if (sh.kind === 'flyby') {
          _pos.set(sh.px, sh.py, sh.pz);
          _look.set(u.x, u.y, u.z);
        } else {
          const dx = (foe ? foe.x : u.x + c) - u.x, dy = (foe ? foe.y : u.y + s) - u.y, l = Math.hypot(dx, dy) || 1, nx = dx / l, ny = dy / l;
          _pos.set(u.x - nx * r * 2.1 - ny * sh.side * r * 0.9, u.y - ny * r * 2.1 + nx * sh.side * r * 0.9, u.z + r * (0.5 + sh.up * 0.4));
          if (foe) _look.set(u.x + dx * 0.45, u.y + dy * 0.45, (u.z + foe.z) / 2); else _look.set(u.x, u.y, u.z);
        }
      }
    }
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.position.copy(_pos);
    cam.up.set(0, 0, 1);
    cam.lookAt(_look);
    this.lookX = _look.x; this.lookY = _look.y;
    this.camDist = _pos.distanceTo(_look);
  }
}
