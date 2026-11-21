import * as THREE from 'three';
import { db } from '../gamedata.js';
import { pickCinematicSubject, cinematicShot } from './spacecinematic.js';

const CINEMATIC_NEAR = 1,
  CINEMATIC_FAR = 10000;
const _pos = new THREE.Vector3(),
  _look = new THREE.Vector3(),
  _target = new THREE.Vector3();

export class Cinematic {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.shot = null;
    this.lastSubject = null;
    this.bars = db.constants.num('Camera_FX_Manager_Letterbox_Height', 0.085);
  }

  toggle() {
    if (this.on) this.stop();
    else this.start();
  }

  start({ letterbox = true } = {}) {
    if (this.on) return;
    this.on = true;
    const g = this.game,
      R = g.renderer;
    document.body.classList.add('cinematic');
    document.documentElement.style.setProperty('--letterbox', (letterbox ? this.bars * 100 : 0) + 'vh');
    this.savedFov = R.camera.fov;
    this.savedNear = R.camera.near;
    this.savedFar = R.camera.far;
    R.cameraOverride = dt => this.frame(dt);
    g.ui.select([], false);
    g.ui.arm(null);
    this.shot = null;
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    this.sequence?.stop();
    this.sequence = null;
    const R = this.game.renderer;
    document.body.classList.remove('cinematic');
    R.cameraOverride = null;
    R.camera.fov = this.savedFov;
    R.camera.near = this.savedNear;
    R.camera.far = this.savedFar;
    R.camera.updateProjectionMatrix();
    if (this.subject && !this.subject.dead) {
      R.rig.x = this.subject.x;
      R.rig.y = this.subject.y;
      R.rig.clamp();
    }
    this.subject = null;
  }

  visible(u, evenDead = false) {
    const w = this.game.world,
      me = this.game.human;
    return u && (evenDead || !u.dead) && !u.hyper && (!w.fog || (u.seenBy & me.bit) !== 0);
  }

  nextShot() {
    const subject = pickCinematicSubject(this.game, this.subject, !this.lastSubject);
    if (!subject) return null;
    this.lastSubject = this.subject = subject;
    const shot = cinematicShot(this.game, subject);
    shot.t = 0;
    shot.fresh = true;
    return shot;
  }

  frame(dt) {
    if (this.sequence) {
      if (!this.sequence.frame(dt)) this.stop();
      return;
    }
    const cam = this.game.renderer.camera;
    let shot = this.shot;
    if (shot) shot.t += dt;
    if (!shot || shot.t > shot.duration || shot.unit.dead || !this.visible(shot.unit)) shot = this.shot = this.nextShot();
    if (!shot) {
      const station = this.game.human.station,
        x = station && !station.dead ? station.x : 0,
        y = station && !station.dead ? station.y : 0,
        t = (performance.now() / 1000) * 0.05;
      _pos.set(x + Math.cos(t) * 1500, y + Math.sin(t) * 1500, 500);
      _look.set(x, y, 0);
    } else {
      shot.camera(shot.t, _target);
      shot.look(shot.t, _look);
      if (shot.fresh || !shot.lag) _pos.copy(_target);
      else _pos.lerp(_target, 1 - Math.pow(shot.lag, dt * 30));
      shot.fresh = false;
    }
    const near = shot ? CINEMATIC_NEAR : this.savedNear,
      far = shot ? CINEMATIC_FAR : this.savedFar;
    if (cam.near !== near || cam.far !== far) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    cam.position.copy(_pos);
    cam.up.set(0, 0, 1);
    cam.lookAt(_look);
    this.lookX = _look.x;
    this.lookY = _look.y;
    this.camDist = _pos.distanceTo(_look);
  }
}
