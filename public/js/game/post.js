import * as THREE from 'three';
import { db } from '../gamedata.js';
import { fetchBinary, fetchText } from '../vfs.js';
import { parseXML } from '../xml.js';
import { loadTexture } from '../dds.js';

const BLOOM_CUTOFF = 0.9, BLOOM_STRENGTH = 1, BLOOM_SIZE = 0.25, BLOOM_PASSES = 4;
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const BRIGHT = `
uniform sampler2D map; uniform float cutoff; varying vec2 vUv;
void main() {
  vec3 c = clamp(texture2D(map, vUv).rgb, 0.0, 1.0), c2 = c * c;
  gl_FragColor = vec4(dot(c, vec3(0.299, 0.587, 0.114)) > cutoff ? c : c * c2 * c2, 1.0);
}`;

const BLUR = `
uniform sampler2D map; uniform vec2 offset; varying vec2 vUv;
void main() {
  vec2 o = offset, p = vec2(offset.x, -offset.y);
  gl_FragColor = vec4((texture2D(map, vUv + o).rgb + texture2D(map, vUv - o).rgb + texture2D(map, vUv + p).rgb + texture2D(map, vUv - p).rgb) * 0.25, 1.0);
}`;

const COMBINE = `
uniform sampler2D scene, glow, heat;
uniform vec2 texel;
uniform float bloom, haze; varying vec2 vUv;
vec3 smoothEdges(vec2 uv) {
  vec3 nw = texture2D(scene, uv + vec2(-1.0, -1.0) * texel).rgb, ne = texture2D(scene, uv + vec2(1.0, -1.0) * texel).rgb;
  vec3 sw = texture2D(scene, uv + vec2(-1.0, 1.0) * texel).rgb, se = texture2D(scene, uv + vec2(1.0, 1.0) * texel).rgb;
  vec3 m = texture2D(scene, uv).rgb;
  const vec3 L = vec3(0.299, 0.587, 0.114);
  float lnw = dot(nw, L), lne = dot(ne, L), lsw = dot(sw, L), lse = dot(se, L), lm = dot(m, L);
  float lo = min(lm, min(min(lnw, lne), min(lsw, lse))), hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float reduce = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * texel;
  vec3 a = 0.5 * (texture2D(scene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(scene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(scene, uv - dir * 0.5).rgb + texture2D(scene, uv + dir * 0.5).rgb);
  float lb = dot(b, L);
  return (lb < lo || lb > hi) ? a : b;
}
void main() {
  vec2 uv = vUv;
  if (haze > 0.0) { vec2 push = texture2D(heat, vUv).rg - 0.5; uv += push * step(0.006, max(abs(push.x), abs(push.y))) * haze; }
  vec3 c = smoothEdges(uv);
  if (bloom > 0.0) { vec3 g = clamp(texture2D(glow, vUv).rgb * bloom, 0.0, 1.0); c = clamp(c, 0.0, 1.0); c += g * (1.0 - c); }
  gl_FragColor = vec4(c, 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.r = renderer;
    this.bloom = false; this.heat = false; this.flare = false;
    this.targets = null;
    this.heatScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mBright = mat(BRIGHT, { map: { value: null }, cutoff: { value: BLOOM_CUTOFF } });
    this.mBlur = mat(BLUR, { map: { value: null }, offset: { value: new THREE.Vector2() } });
    this.mCombine = mat(COMBINE, { texel: { value: new THREE.Vector2() }, scene: { value: null }, glow: { value: null }, heat: { value: null }, bloom: { value: 0 }, haze: { value: 0 } });
    this.flares = null;
    this.flareLevel = 0;
  }

  get active() { return this.bloom || this.heat; }

  resize(w, h) {
    this.w = w; this.h = h;
    if (this.targets) { for (const t of Object.values(this.targets)) t.dispose(); this.targets = null; }
  }

  ensureTargets() {
    if (this.targets) return this.targets;
    const pr = this.r.getPixelRatio(), W = Math.max(2, Math.round(this.w * pr)), H = Math.max(2, Math.round(this.h * pr));
    const rt = (w, h, opts = {}) => {
      const t = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), { depthBuffer: false, ...opts });
      t.texture.colorSpace = THREE.NoColorSpace;
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      t.texture.generateMipmaps = false;
      return t;
    };
    this.targets = {
      scene: rt(W, H, { depthBuffer: true, stencilBuffer: true }),
      a1: rt(W >> 2, H >> 2), a2: rt(W >> 2, H >> 2),
      heat: rt(W >> 2, H >> 2),
    };
    return this.targets;
  }

  begin() {
    if (!this.active) return false;
    this.r.setRenderTarget(this.ensureTargets().scene);
    return true;
  }

  pass(material, target) {
    this.quad.material = material;
    this.r.setRenderTarget(target);
    this.r.render(this.quadScene, this.quadCam);
  }

  end(camera) {
    const t = this.targets, r = this.r;
    if (this.heat) {
      r.getClearColor(_clear); const alpha = r.getClearAlpha();
      r.setRenderTarget(t.heat);
      r.setClearColor(_rest, 1);
      r.clear();
      r.render(this.heatScene, camera);
      r.setClearColor(_clear, alpha);
    }
    if (this.bloom) {
      this.mBright.uniforms.map.value = t.scene.texture;
      this.pass(this.mBright, t.a1);
      let src = t.a1, dst = t.a2;
      for (let i = 0; i < BLOOM_PASSES; i++) {
        this.mBlur.uniforms.map.value = src.texture;
        this.mBlur.uniforms.offset.value.set(BLOOM_SIZE * (2 * i + 1) * 0.5 / src.width, BLOOM_SIZE * (2 * i + 1) * 0.5 / src.height);
        this.pass(this.mBlur, dst);
        [src, dst] = [dst, src];
      }
    }
    const u = this.mCombine.uniforms;
    u.scene.value = t.scene.texture; u.glow.value = t.a1.texture; u.heat.value = t.heat.texture;
    u.texel.value.set(1 / t.scene.width, 1 / t.scene.height);
    u.bloom.value = this.bloom ? BLOOM_STRENGTH : 0; u.haze.value = this.heat ? 0.035 : 0;
    this.pass(this.mCombine, null);
  }

  async loadFlares() {
    if (this.flares !== null) return;
    this.flares = false;
    const [xml, art] = await Promise.all([fetchText('Data/XML/LensFlares.xml'), fetchBinary('Data/Art/Textures/LENSFLARE.DDS')]);
    if (!xml || !art) return;
    const def = parseXML(xml).children.flatMap(n => n.children).find(n => /lensflare/i.test(n.tag));
    if (!def) return;
    const tex = loadTexture('LENSFLARE.DDS', { repeat: false });
    const scene = new THREE.Scene(), geo = new THREE.PlaneGeometry(1, 1), sprites = [];
    for (const f of def.all('Flare')) {
      const n = Math.max(1, f.num('Num_Slots', 1)), c = f.val('Diffuse').split(',').map(parseFloat);
      const m = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, cell: { value: new THREE.Vector3(f.num('Slot_X', 0), f.num('Slot_Y', 0), 1 / n) }, tint: { value: new THREE.Color(c[0] ?? 1, c[1] ?? 1, c[2] ?? 1) }, level: { value: 0 } },
        vertexShader: 'uniform vec3 cell; varying vec2 vUv; void main() { vUv = (cell.xy + vec2(uv.x, 1.0 - uv.y)) * cell.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D map; uniform vec3 tint; uniform float level; varying vec2 vUv; void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * tint * t.a * level, 1.0); }',
        transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.frustumCulled = false;
      scene.add(mesh);
      sprites.push({ mesh, fraction: f.num('Fraction', 0), radius: f.num('Radius', 1) });
    }
    this.flares = { scene, camera: new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1), sprites };
  }

  drawFlare(camera, sun, blocked, dt) {
    if (!this.flare) { this.flareLevel = 0; return; }
    if (this.flares === null) this.loadFlares();
    const fl = this.flares;
    if (!fl) return;
    const p = _v.copy(sun).project(camera);
    const inFront = p.z < 1 && p.z > -1;
    const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
    const want = inFront && !blocked ? 1 - THREE.MathUtils.smoothstep(edge, 0.85, 1.15) : 0;
    this.flareLevel += (want - this.flareLevel) * Math.min(1, dt * 6);
    if (this.flareLevel < 0.01) return;
    const w = this.w, h = this.h, cam = fl.camera;
    cam.right = w; cam.top = h; cam.updateProjectionMatrix();
    const sx = (p.x * 0.5 + 0.5) * w, sy = (p.y * 0.5 + 0.5) * h, cx = w / 2, cy = h / 2, unit = h * 0.11;
    for (const s of fl.sprites) {
      s.mesh.position.set(sx + (cx - sx) * s.fraction, sy + (cy - sy) * s.fraction, 0);
      s.mesh.scale.set(s.radius * unit, s.radius * unit, 1);
      s.mesh.material.uniforms.level.value = this.flareLevel * (s.fraction === 0 ? 0.9 : 0.45);
    }
    this.r.setRenderTarget(null);
    this.r.render(fl.scene, cam);
  }
}
const _v = new THREE.Vector3();
const _clear = new THREE.Color(), _rest = new THREE.Color().setRGB(0.5, 0.5, 0);
