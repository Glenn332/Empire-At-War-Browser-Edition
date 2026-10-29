import * as THREE from 'three';
import { loadTexture } from '../dds.js';

const LEVELS = 4,
  SEGS = 1 << LEVELS,
  MAX_BOLTS = 160;
const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _s = new THREE.Vector3(),
  _u = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _p = new THREE.Vector3(),
  _q = new THREE.Vector3();
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function endOf(u, bone, out) {
  const b = bone && u.inst && u.inst.bone ? u.inst.bone(bone) : null;
  if (b && u.holder && u.holder.visible !== false) return b.getWorldPosition(out);
  return out.set(u.x, u.y, (u.z || 0) + (u.aimZ !== undefined ? u.aimZ * 0.7 : 8));
}

export class Bolts {
  constructor(scene) {
    this.bolts = [];
    const quads = MAX_BOLTS * SEGS;
    this.pos = new Float32Array(quads * 12);
    this.uv = new Float32Array(quads * 8);
    this.col = new Float32Array(quads * 16);
    const index = new Uint32Array(quads * 6);
    for (let i = 0; i < quads; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.mats = new Map();
    this.mesh = new THREE.Mesh(g, this.material('lightning_default.tga'));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  material(texture) {
    const key = (texture || 'lightning_default.tga').toUpperCase();
    if (!this.mats.has(key))
      this.mats.set(
        key,
        new THREE.ShaderMaterial({
          uniforms: { map: { value: loadTexture(texture || 'lightning_default.tga') } },
          vertexShader:
            'attribute vec4 color; varying vec4 vColor; varying vec2 vUv; void main() { vColor = color; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader:
            'uniform sampler2D map; varying vec4 vColor; varying vec2 vUv; void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vColor.rgb * vColor.a, 1.0); }',
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide
        })
      );
    return this.mats.get(key);
  }

  strike(def, a, b) {
    const pts = new Float32Array((SEGS + 1) * 3);
    _d.subVectors(b, a);
    const len = _d.length() || 1;
    _s.set(-_d.y, _d.x, 0);
    if (_s.lengthSq() < 1e-6) _s.set(1, 0, 0);
    _s.normalize();
    _u.crossVectors(_d, _s).normalize();
    pts.set([a.x, a.y, a.z], 0);
    pts.set([b.x, b.y, b.z], SEGS * 3);
    for (let step = SEGS; step > 1; step >>= 1) {
      const span = (len * step) / SEGS,
        half = step >> 1;
      for (let i = half; i < SEGS; i += step) {
        const l = (i - half) * 3,
          r = (i + half) * 3,
          o = i * 3,
          ds = rand(-1, 1) * def.displace[0] * span * 0.5,
          du = Math.abs(rand(-1, 1)) * def.displace[1] * span * 0.5;
        pts[o] = (pts[l] + pts[r]) / 2 + _s.x * ds + _u.x * du;
        pts[o + 1] = (pts[l + 1] + pts[r + 1]) / 2 + _s.y * ds + _u.y * du;
        pts[o + 2] = (pts[l + 2] + pts[r + 2]) / 2 + _s.z * ds + _u.z * du;
      }
    }
    if (this.bolts.length >= MAX_BOLTS) this.bolts.shift();
    this.bolts.push({ pts, age: 0, life: Math.max(0.05, rand(def.fade[0], def.fade[1])), width: rand(def.width[0], def.width[1]), def });
  }

  update(dt, world, defs, camera) {
    world.bolts = world.bolts.filter(e => {
      if (world.time >= e.until || e.a.dead || e.b.dead) return false;
      const def = (defs && defs.get(String(e.effect || 'Default').toUpperCase())) || (defs && defs.get('DEFAULT'));
      if (!def) return false;
      e.live = (e.live || []).filter(x => x.age < x.life);
      if (e.wait === undefined) e.wait = 0;
      e.wait -= dt;
      const L = world.look;
      if (L && (e.b.x - L.x) ** 2 + (e.b.y - L.y) ** 2 > L.r * L.r && (e.a.x - L.x) ** 2 + (e.a.y - L.y) ** 2 > L.r * L.r) return true;
      let made = 0;
      while (e.wait <= 0 && e.live.length < def.bolts && made++ < 3) {
        this.strike(def, endOf(e.a, e.aBone, _a), endOf(e.b, e.bBone, _b));
        e.live.push(this.bolts[this.bolts.length - 1]);
        e.wait += Math.max(0.02, rand(def.every[0], def.every[1]));
      }
      if (e.wait <= 0) e.wait = Math.max(0.02, rand(def.every[0], def.every[1]));
      return true;
    });
    let q = 0,
      tex = null;
    const pos = this.pos,
      uv = this.uv,
      col = this.col;
    camera.getWorldPosition(_c);
    this.bolts = this.bolts.filter(B => (B.age += dt) < B.life);
    for (const B of this.bolts) {
      const k = B.age / B.life,
        d = B.def,
        P = B.pts,
        hw = B.width / 2;
      const r = d.from[0] + (d.to[0] - d.from[0]) * k,
        g = d.from[1] + (d.to[1] - d.from[1]) * k,
        b = d.from[2] + (d.to[2] - d.from[2]) * k,
        a = d.from[3] + (d.to[3] - d.from[3]) * k;
      tex = tex || d.texture;
      for (let i = 0; i < SEGS; i++) {
        _p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        _q.set(P[i * 3 + 3], P[i * 3 + 4], P[i * 3 + 5]);
        _d.subVectors(_q, _p);
        _s.subVectors(_c, _p).cross(_d).normalize().multiplyScalar(hw);
        const o = q * 12;
        pos[o] = _p.x + _s.x;
        pos[o + 1] = _p.y + _s.y;
        pos[o + 2] = _p.z + _s.z;
        pos[o + 3] = _p.x - _s.x;
        pos[o + 4] = _p.y - _s.y;
        pos[o + 5] = _p.z - _s.z;
        pos[o + 6] = _q.x + _s.x;
        pos[o + 7] = _q.y + _s.y;
        pos[o + 8] = _q.z + _s.z;
        pos[o + 9] = _q.x - _s.x;
        pos[o + 10] = _q.y - _s.y;
        pos[o + 11] = _q.z - _s.z;
        const u0 = i / SEGS,
          u1 = (i + 1) / SEGS;
        uv.set([u0, 0, u0, 1, u1, 0, u1, 1], q * 8);
        for (let v = 0; v < 4; v++) col.set([r, g, b, a], q * 16 + v * 4);
        q++;
      }
    }
    this.geo.setDrawRange(0, q * 6);
    if (q) {
      this.geo.attributes.position.needsUpdate = this.geo.attributes.uv.needsUpdate = this.geo.attributes.color.needsUpdate = true;
      if (tex) this.mesh.material = this.material(tex);
    }
    this.mesh.visible = q > 0;
  }
}
