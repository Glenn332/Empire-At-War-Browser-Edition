import * as THREE from '../vendor/three/build/three.module.js';
import { ChunkReader, fetchBinary } from './vfs.js';

export function parseALA(buffer) {
  const r = new ChunkReader(buffer), dv = r.dv;
  const anim = { frames: 1, fps: 30, tracks: [], duration: 0 };
  let rotBlock = 0, transBlock = 0, sharedRot = null, sharedTrans = null;
  for (const top of r.chunks()) {
    if (top.type !== 0x1000) continue;
    for (const c of r.chunks(top.start, top.end)) {
      if (c.type === 0x1001) {
        for (const m of r.minis(c)) {
          if (m.type === 1) anim.frames = Math.max(1, r.u32(m.start));
          else if (m.type === 2) anim.fps = r.f32(m.start) || 30;
          else if (m.type === 11) rotBlock = r.u32(m.start);
          else if (m.type === 12) transBlock = r.u32(m.start);
        }
      } else if (c.type === 0x1002) {
        const t = { name: '', index: -1, offset: [0, 0, 0], scale: [0, 0, 0], trans: null, transAt: -1, rot: null, rotAt: -1, defRot: null, vis: null };
        for (const k of r.chunks(c.start, c.end)) {
          if (k.type === 0x1003) {
            for (const m of r.minis(k)) {
              if (m.type === 4) t.name = r.str(m.start, m.start + m.size);
              else if (m.type === 5) t.index = r.u32(m.start);
              else if (m.type === 6) t.offset = r.vec(m.start, 3);
              else if (m.type === 7) t.scale = r.vec(m.start, 3);
              else if (m.type === 14) t.transAt = dv.getInt16(m.start, true);
              else if (m.type === 16) t.rotAt = dv.getInt16(m.start, true);
              else if (m.type === 17) t.defRot = [0, 1, 2, 3].map(i => dv.getInt16(m.start + i * 2, true));
            }
          } else if (k.type === 0x1004) t.trans = new Uint16Array(buffer.slice(k.start, k.end));
          else if (k.type === 0x1006) t.rot = new Int16Array(buffer.slice(k.start, k.end));
          else if (k.type === 0x1007) t.vis = new Uint8Array(buffer.slice(k.start, k.end));
        }
        anim.tracks.push(t);
      } else if (c.type === 0x1009) sharedRot = new Int16Array(buffer.slice(c.start, c.end));
      else if (c.type === 0x100a) sharedTrans = new Uint16Array(buffer.slice(c.start, c.end));
    }
  }
  for (const t of anim.tracks) {
    if (t.trans) { t.transStride = 3; t.transAt = 0; }
    else if (sharedTrans && t.transAt >= 0 && transBlock) { t.trans = sharedTrans; t.transStride = transBlock; }
    else t.trans = null;
    if (t.rot && t.rot.length >= anim.frames * 4) { t.rotStride = 4; t.rotAt = 0; }
    else if (t.rot) { t.defRot = Array.from(t.rot.subarray(0, 4)); t.rot = null; }
    else if (sharedRot && t.rotAt >= 0 && rotBlock) { t.rot = sharedRot; t.rotStride = rotBlock; }
  }
  anim.duration = anim.frames / anim.fps;
  return anim;
}

const anims = new Map();
let known = null;

export function knownAnimations(names) { known = names ? new Set(names) : null; }

export function loadALA(name) {
  const key = name.toUpperCase();
  let a = anims.get(key);
  if (a === undefined && known && !known.has(key)) { anims.set(key, null); return null; }
  if (a === undefined) {
    a = fetchBinary('Data/Art/Models/' + key, { keep: false }).then(buf => {
      let anim = null;
      try { anim = buf ? parseALA(buf) : null; } catch (e) { console.warn('animation', key, e.message); }
      if (anim) anim.name = key.replace(/\.ALA$/, '');
      anims.set(key, anim);
      return anim;
    });
    anims.set(key, a);
  }
  return a;
}

export function getALA(name) {
  const a = name ? anims.get(name.toUpperCase()) : null;
  return a && !(a instanceof Promise) ? a : null;
}

export const animName = (model, kind, n = 0) => model.replace(/\.alo$/i, '').toUpperCase() + `_${kind}_${String(n).padStart(2, '0')}.ALA`;

const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();

export function frameKeys(a, f, loop) {
  if (loop) { const n = Math.max(1, a.frames - 1), f0 = Math.floor(f % n); return [f0, (f0 + 1) % n]; }
  const end = Math.max(0, a.frames - 2), f0 = Math.min(end, Math.floor(f));
  return [f0, Math.min(end, f0 + 1)];
}

export const loopTime = a => Math.max(1, a.frames - 1) / a.fps;

export class AnimState {
  constructor(inst, anim, { loop = false, speed = 1, time = 0, onFrame = null } = {}) {
    this.inst = inst;
    this.anim = anim;
    this.loop = loop;
    this.speed = speed;
    this.time = time;
    this.done = false;
    this.onFrame = onFrame;
    const own = t => { const b = inst.bones[t.index]; return b && b.name === t.name ? b : null; };
    this.bound = anim.tracks.map(t => ({ t, bone: own(t) || inst.boneByName.get(t.name.toUpperCase()) || (!t.name && inst.bones[t.index]) || null })).filter(b => b.bone);
  }

  seek(fraction) {
    this.done = false;
    this.time = Math.max(0, Math.min(0.9999, fraction)) * this.anim.duration;
    this.step(0);
  }

  step(dt) {
    if (this.done) return false;
    this.advance(dt);
    this.pose();
    return !this.done;
  }

  advance(dt) {
    if (this.done) return false;
    const a = this.anim;
    this.time += dt * this.speed;
    const end = this.loop ? loopTime(a) : a.duration;
    if (this.time >= end) {
      if (this.loop) this.time %= end;
      else { this.time = a.duration - 1e-4; this.done = true; }
    }
    return !this.done;
  }

  pose() {
    const a = this.anim;
    this.inst.animated = true;
    const f = Math.max(0, this.time * a.fps), [f0, f1] = frameKeys(a, f, this.loop), k = f - Math.floor(f);
    for (const { t, bone } of this.bound) {
      const o = t.offset, s = t.scale;
      if (t.trans) {
        const a0 = f0 * t.transStride + t.transAt, a1 = f1 * t.transStride + t.transAt, d = t.trans;
        bone.position.set(
          o[0] + s[0] * (d[a0] + (d[a1] - d[a0]) * k),
          o[1] + s[1] * (d[a0 + 1] + (d[a1 + 1] - d[a0 + 1]) * k),
          o[2] + s[2] * (d[a0 + 2] + (d[a1 + 2] - d[a0 + 2]) * k));
      } else bone.position.set(o[0], o[1], o[2]);
      if (t.rot) {
        const a0 = f0 * t.rotStride + t.rotAt, a1 = f1 * t.rotStride + t.rotAt, d = t.rot;
        _q0.set(d[a0], d[a0 + 1], d[a0 + 2], d[a0 + 3]).normalize();
        _q1.set(d[a1], d[a1 + 1], d[a1 + 2], d[a1 + 3]).normalize();
        bone.quaternion.copy(_q0).slerp(_q1, k);
      } else if (t.defRot) bone.quaternion.set(t.defRot[0], t.defRot[1], t.defRot[2], t.defRot[3]).normalize();
      if (t.vis) { bone.visible = ((t.vis[f0 >> 3] >> (f0 & 7)) & 1) === 1; bone.userData.animHid = !bone.visible; }
    }
    this.inst.syncFromBones();
    if (this.onFrame) this.onFrame(this);
  }
}
