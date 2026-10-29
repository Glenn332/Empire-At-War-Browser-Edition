import * as THREE from 'three';
import { loadTexture } from '../dds.js';

export class LaserBatch {
  constructor(max, kite) {
    this.max = max; this.count = 0; this.kite = kite;
    const geo = new THREE.InstancedBufferGeometry();
    const corners = kite ? 4 : 6;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Array.from({ length: corners }, (_, i) => [i, 0, 0]).flat()), 3));
    geo.setIndex(kite ? [0, 1, 2, 0, 2, 3] : [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
    this.a = new Float32Array(max * 4); this.b = new Float32Array(max * 4); this.c = new Float32Array(max * 4); this.d = new Float32Array(max * 3);
    const attr = (name, arr, n) => { const at = new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, at); return at; };
    this.attrs = [attr('center', this.a, 4), attr('dir', this.b, 4), attr('cell', this.c, 4), attr('tint', this.d, 3)];
    const head = 'attribute vec4 center; attribute vec4 dir; attribute vec4 cell; attribute vec3 tint; uniform float zScale; uniform vec2 depthSpan;';
    const vertex = kite ? head + `        varying vec2 vUv; varying vec3 vTint;
        void main() { vTint = tint;
          vec4 h = viewMatrix * vec4(center.xyz, 1.0); vec3 f = (viewMatrix * vec4(dir.xyz, 0.0)).xyz;
          float s = dir.w * max(0.0, 1.0 + (max(0.0, -h.z) * depthSpan.x - depthSpan.y) * zScale);
          float fl = length(f.xy); vec2 back = fl > 1e-5 ? -f.xy / fl : vec2(0.0, -1.0); vec2 side = vec2(-back.y, back.x);
          float k = max(1.0, center.w * fl);
          int c = int(position.x + 0.5);
          vec2 o = c == 0 ? side * s : c == 1 ? back * s * k : c == 2 ? -side * s : -back * s;
          vec2 uv = c == 0 ? vec2(0.0, 1.0) : c == 1 ? vec2(0.0, 0.0) : c == 2 ? vec2(1.0, 0.0) : vec2(1.0, 1.0);
          vUv = cell.xy + uv * cell.z;
          gl_Position = projectionMatrix * vec4(h.xy + o, h.z, 1.0); }`
      : head + `        varying vec2 vUv; varying vec3 vTint;
        void main() { vTint = tint;
          vec4 h = viewMatrix * vec4(center.xyz, 1.0); vec3 f = normalize((viewMatrix * vec4(dir.xyz, 0.0)).xyz);
          float s = dir.w * max(0.0, 1.0 + (max(0.0, -h.z) * depthSpan.x - depthSpan.y) * zScale);
          vec3 A = h.xyz + f * center.w * 0.5; vec3 B = h.xyz - f * center.w * 0.5;
          vec2 sd = B.xy - A.xy; float sl = length(sd); vec3 p = vec3(sl > 1e-5 ? vec2(-sd.y, sd.x) / sl : vec2(1.0, 0.0), 0.0);
          int c = int(position.x + 0.5);
          vec3 P = c == 0 ? A + f * s : c == 1 ? A + p * s : c == 2 ? A - p * s : c == 3 ? B + p * s : c == 4 ? B - p * s : B - f * s;
          vec2 uv = c == 0 ? vec2(1.0, 0.0) : c == 1 ? vec2(0.5, 0.0) : c == 2 ? vec2(1.0, 0.5) : c == 3 ? vec2(0.0, 0.5) : c == 4 ? vec2(0.5, 1.0) : vec2(0.0, 1.0);
          vUv = cell.xy + uv * cell.z;
          gl_Position = projectionMatrix * vec4(P, 1.0); }`;
    const mat = new THREE.ShaderMaterial({
      name: kite ? 'laserKite' : 'laserBeam',
      uniforms: { map: { value: loadTexture(kite ? 'p_particle_master.tga' : 'W_LASER_PILL.tga', { repeat: false }) }, zScale: { value: kite ? 1.2 : 8 }, depthSpan: { value: new THREE.Vector2(1 / 90000, 20 / 90000) } },
      vertexShader: vertex,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vTint;
        void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vTint * t.a, 1.0); }`,
      transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }
  static lookOf(P) {
    if (P._laser) return P._laser;
    const file = P.str('Space_Model_Name') || P.str('Land_Model_Name'), kite = P.num('Projectile_Custom_Render', 0) === 2;
    const slot = P.has('Projectile_Texture_Slot') ? P.list('Projectile_Texture_Slot').map(Number) : P.has('Projectile_Laser_Color') ? [2, 0] : [/G\.ALO$/i.test(file) ? 3 : 0, 0];
    const c = kite ? P.vec('Projectile_Laser_Color', [255, 255, 255, 255]).map(x => x / 255) : [1, 1, 1, 1];
    const size = kite ? 0.125 : 0.25, a = c[3] ?? 1;
    return (P._laser = { kite, u: (slot[0] || 0) * size, v: (slot[1] || 0) * size, size, r: c[0] * a, g: c[1] * a, b: c[2] * a });
  }
  begin() { this.count = 0; }
  add(x, y, z, dx, dy, dz, length, width, L) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const a = this.a, b = this.b, c = this.c, d = this.d, k = i * 4, k3 = i * 3;
    a[k] = x; a[k + 1] = y; a[k + 2] = z; a[k + 3] = length;
    b[k] = dx; b[k + 1] = dy; b[k + 2] = dz; b[k + 3] = width;
    c[k] = L.u; c[k + 1] = L.v; c[k + 2] = L.size; c[k + 3] = 0;
    d[k3] = L.r; d[k3 + 1] = L.g; d[k3 + 2] = L.b;
  }
  end() { this.mesh.geometry.instanceCount = this.count; for (const a of this.attrs) a.needsUpdate = true; }
}
