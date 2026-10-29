import * as THREE from '../vendor/three/build/three.module.js';
import { loadTexture } from './dds.js';

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const COMMON = `
precision highp float;
uniform sampler2D src, srcNormal;
varying vec2 vUv;
float hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 hash22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float pnoise(vec2 x, float per) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 a = mod(i, per), b = mod(i + 1.0, per);
  return mix(mix(hash2(a), hash2(vec2(b.x, a.y)), f.x), mix(hash2(vec2(a.x, b.y)), hash2(b), f.x), f.y);
}
float pfbm(vec2 uv, float per) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 7; i++) { s += a * pnoise(uv * per, per); per *= 2.0; a *= 0.5; }
  return s;
}
float craters(vec2 uv, float per, float seed) {
  vec2 x = uv * per, i = floor(x), f = fract(x);
  float h = 0.0;
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    vec2 o = vec2(float(dx), float(dy)), c = mod(i + o, per) + seed;
    vec2 r = hash22(c);
    if (r.x > 0.55) continue;
    float rad = 0.16 + 0.3 * hash2(c + 7.7);
    float d = length(o + 0.2 + 0.6 * r - f) / rad;
    if (d < 1.4) h += (smoothstep(0.0, 1.0, d) - 1.0) * 0.9 + 0.35 * exp(-pow((d - 1.0) * 5.0, 2.0));
  }
  return h;
}
float height(vec2 uv) {
  float lum = dot(texture2D(src, uv).rgb, vec3(0.33));
  float ridge = 1.0 - abs(pfbm(uv + 0.37, 6.0) * 2.0 - 1.0);
  return lum * 0.9
    + pfbm(uv, 10.0) * 0.55 + ridge * ridge * 0.3
    + pfbm(uv + 0.71, 96.0) * 0.12
    + craters(uv, 7.0, 3.0) * 0.22 + craters(uv, 19.0, 11.0) * 0.1 + craters(uv, 53.0, 29.0) * 0.045;
}`;

const ALBEDO = COMMON + `
void main() {
  vec4 o = texture2D(src, vUv);
  float h = height(vUv);
  float fine = pfbm(vUv + 0.13, 160.0);
  vec3 col = o.rgb * (0.5 + 0.62 * h) * (0.9 + 0.2 * fine);
  col *= mix(vec3(1.05, 0.98, 0.9), vec3(0.9, 0.97, 1.06), pfbm(vUv + 0.5, 4.0));
  gl_FragColor = vec4(col, o.a);
}`;

const NORMAL = COMMON + `
uniform float texel;
void main() {
  vec4 n0 = texture2D(srcNormal, vUv);
  float h = height(vUv), hu = height(vUv + vec2(texel, 0.0)), hv = height(vUv + vec2(0.0, texel));
  vec2 g = vec2(h - hu, h - hv) / texel * 0.0016;
  vec3 n = normalize(vec3((n0.xy * 2.0 - 1.0) * 0.7 + g, max(n0.z * 2.0 - 1.0, 0.35)));
  gl_FragColor = vec4(n * 0.5 + 0.5, n0.a);
}`;

let baked = null;

export const rockTextures = () => baked;
let bakedOn = null, bakes = 0;
export const rockBake = () => bakes;

export async function bakeRockTextures(renderer, base = 'w_asteroid00.tga', normal = 'w_asteroid00_bc.tga') {
  if (baked && bakedOn === renderer) return baked;
  baked = null; bakedOn = renderer; bakes++;
  try {
    const size = Math.min(4096, renderer.capabilities.maxTextureSize);
    const src = loadTexture(base), srcN = loadTexture(normal);
    await Promise.all([src.userData.ready, srcN.userData.ready]);
    const target = () => {
      const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
      rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      rt.texture.colorSpace = THREE.NoColorSpace;
      return rt;
    };
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    scene.add(quad);
    const pass = (frag, rt) => {
      quad.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: { src: { value: src }, srcNormal: { value: srcN }, texel: { value: 1 / size } }, depthTest: false });
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      quad.material.dispose();
    };
    const a = target(), n = target(), sync = renderer.syncPipelines;
    renderer.syncPipelines = true;
    try { pass(ALBEDO, a); pass(NORMAL, n); } finally { renderer.syncPipelines = sync; }
    renderer.setRenderTarget(null);
    quad.geometry.dispose();
    baked = { map: a.texture, normalMap: n.texture, size };
  } catch (e) {
    console.warn('asteroid texture bake failed:', e.message);
    baked = null;
  }
  return baked;
}
