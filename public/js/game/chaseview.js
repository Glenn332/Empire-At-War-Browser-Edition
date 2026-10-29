import * as THREE from 'three';
import { keysOf, keyName } from './keybinds.js';

const BLEND = 0.9;
const LOOK = 0.0025;
const PITCH_LO = -0.6, PITCH_HI = 1.2;
const LIFT = 0.2;

const _box = new THREE.Box3(), _dir = new THREE.Vector3(), _fwd = new THREE.Vector3(), _eye = new THREE.Vector3(), _at = new THREE.Vector3(), _from = new THREE.Vector3();
const ease = t => t * t * (3 - 2 * t);

export class ChaseView {
  constructor(dom) {
    this.dom = dom;
    this.on = false;
    this.k = 0;
    this.yaw = 0; this.pitch = 0.18; this.dist = 100; this.size = 20; this.height = 10;
    this.min = 20; this.max = 2000;
    this.pivot = { x: 0, y: 0, z: 0 };
    this.locked = false; this.last = 0;
    this.onLost = null;
    this.reticle = null;
    this.lockChange = () => {
      const held = document.pointerLockElement === this.dom;
      if (this.locked && !held && this.on && this.onLost) this.onLost();
      this.locked = held;
    };
    document.addEventListener('pointerlockchange', this.lockChange);
  }

  get active() { return this.on || this.k > 0; }

  enter(x, y, z, size, heading, start = 0, obj = null) {
    this.size = Math.max(4, size || 20);
    this.height = this.size * 0.5;
    if (obj) { _box.setFromObject(obj); if (!_box.isEmpty()) this.height = Math.min(this.size * 4, Math.max(this.size * 0.2, _box.max.z - z)); }
    this.min = this.size * 1.6; this.max = Math.max(this.size * 40, start * 8);
    if (!this.on && this.k <= 0) { this.dist = Math.min(this.max, Math.max(this.min, this.size * 4.5, start)); this.yaw = heading || 0; this.pitch = 0.18; }
    this.setPivot(x, y, z);
    this.on = true;
    try { const p = this.dom.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch {}
    this.showReticle(true);
  }

  exit() {
    if (!this.on) return;
    this.on = false;
    if (document.pointerLockElement === this.dom) { this.locked = false; document.exitPointerLock?.(); }
    this.showReticle(false);
  }

  setPivot(x, y, z) { const p = this.pivot; p.x = x; p.y = y; p.z = z; }

  look(dx, dy) {
    if (!this.on) return;
    this.yaw -= dx * LOOK;
    this.pitch = Math.min(PITCH_HI, Math.max(PITCH_LO, this.pitch + dy * LOOK));
  }

  wheel(notches) { this.dist = Math.min(this.max, Math.max(this.min, this.dist * Math.exp(notches * 0.15))); }

  frame(cam, lx, ly, lz, floor = null) {
    const now = performance.now(), real = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.k = Math.min(1, Math.max(0, this.k + (this.on ? real : -real) / BLEND));
    if (this.k <= 0 && !this.on) { this.last = 0; return; }
    const cp = Math.cos(this.pitch), p = this.pivot;
    _fwd.set(Math.cos(this.yaw) * cp, Math.sin(this.yaw) * cp, -Math.sin(this.pitch));
    _eye.set(p.x, p.y, p.z + this.height).addScaledVector(_fwd, -this.dist);
    _eye.z += this.dist * LIFT;
    if (floor) _eye.z = Math.max(_eye.z, floor(_eye.x, _eye.y));
    _at.copy(_eye).addScaledVector(_fwd, this.dist * 2);
    const s = ease(this.k);
    _from.copy(cam.position);
    cam.position.lerpVectors(_from, _eye, s);
    _at.set(lx + (_at.x - lx) * s, ly + (_at.y - ly) * s, lz + (_at.z - lz) * s);
    cam.up.set(0, 0, 1);
    cam.lookAt(_at);
  }

  aimPoint(cam, z, far, out) {
    cam.getWorldDirection(_dir);
    const o = cam.position;
    let t = _dir.z < -1e-4 ? (z - o.z) / _dir.z : far;
    if (!(t > 0) || t > far) t = far;
    out.x = o.x + _dir.x * t; out.y = o.y + _dir.y * t; out.z = o.z + _dir.z * t;
    return out;
  }

  aim(state) { if (this.reticle) this.reticle.dataset.state = state || 'out'; }

  showReticle(on) {
    if (!this.reticle) {
      const st = document.createElement('style');
      st.textContent = `body.chase-view canvas { cursor: none !important; }
.chase-reticle { position: fixed; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px; z-index: 50; pointer-events: none; color: #d8e6f4; }
.chase-reticle[data-state="in"] { color: #ff7a3a; }
.chase-reticle svg { width: 100%; height: 100%; filter: drop-shadow(0 0 1px #000) drop-shadow(0 0 2px #000); }
.chase-note { position: fixed; left: 50%; top: 104px; transform: translateX(-50%); z-index: 50; pointer-events: none; font: 12px "Segoe UI", sans-serif; color: #ffd76a; text-shadow: 0 0 3px #000, 0 0 3px #000; }`;
      document.head.appendChild(st);
      const r = this.reticle = document.createElement('div');
      r.className = 'chase-reticle';
      r.innerHTML = '<svg viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="2"><circle cx="17" cy="17" r="9"/><path d="M17 1v9M17 24v9M1 17h9M24 17h9"/><circle cx="17" cy="17" r="1.2" fill="currentColor"/></svg>';
      const n = this.note = document.createElement('div');
      n.className = 'chase-note';
      document.body.append(r, n);
    }
    const key = keyName(keysOf('DIRECT_VIEW')[0] || null);
    this.note.textContent = `Mouse to look, wheel to zoom, left button fires at the reticle, ${key} for the battle view`;
    this.reticle.style.display = this.note.style.display = on ? 'block' : 'none';
    document.body.classList.toggle('chase-view', on);
  }

  destroy() {
    this.exit();
    document.removeEventListener('pointerlockchange', this.lockChange);
    this.reticle?.remove(); this.note?.remove();
  }
}
