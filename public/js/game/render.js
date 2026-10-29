import * as THREE from 'three';
import { setPlanetEnvironment, lighting, getModelData, buildModel, updateBillboards, planetClock, programSources } from '../model.js';
import { env as gpuEnv, wantGPU } from '../gpu/env.js';
import { diag } from '../diag.js';
import { ParticleManager } from '../particles.js';
import { PostFX } from './post.js';
import { db } from '../gamedata.js';
import { SHIELD_FLASH, SHIELD_FADE } from './sim.js';
import { getALA, animName, AnimState } from '../ala.js';
import { loadTexture, whiteTexture, loadTextureCanvas } from '../dds.js';
import { fetchText, fetchBinary } from '../vfs.js';
import { parseXML } from '../xml.js';
import { gfx, pixelRatio, shadowSize, gammaOn } from '../gfx.js';
import { Instances } from './instances.js';
import { ShotModels } from './shotmodels.js';
import { LaserBatch } from './laser.js';

const DEG = Math.PI / 180;
const NO_FX = [];
const SHOT_FX_SCALE = false,
  SHOT_FX_CARRY = false;
const NO_INSTANCING = typeof location !== 'undefined' && new URLSearchParams(location.search).get('instancing') === '0';
const boneShown = (b, root) => {
  for (; b && b !== root; b = b.parent) if (!b.visible) return false;
  return true;
};

function canvasTexture(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const glowTex = () =>
  canvasTexture(128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });

const boltTex = () =>
  canvasTexture(64, (g, s) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const u = Math.abs(x / (s - 1) - 0.5) * 2,
          v = Math.abs(y / (s - 1) - 0.5) * 2;
        const across = Math.max(0, 1 - u) ** 2.2,
          along = Math.max(0, 1 - v ** 3);
        const a = across * along,
          core = Math.max(0, 1 - u * 3.2) * along;
        const o = (y * s + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255 * Math.min(1, a);
        img.data[o + 3] = 255 * Math.min(1, core);
      }
    g.putImageData(img, 0, 0);
  });

class SpriteBatch {
  constructor(max, texture) {
    this.max = max;
    this.count = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.center = new Float32Array(max * 4);
    this.color = new Float32Array(max * 4);
    this.aCenter = new THREE.InstancedBufferAttribute(this.center, 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('center', this.aCenter);
    geo.setAttribute('tint', this.aColor);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: `attribute vec4 center; attribute vec4 tint; varying vec2 vUv; varying vec4 vTint;
        void main() { vUv = position.xy * 0.5 + 0.5; vTint = tint;
          vec4 mv = viewMatrix * vec4(center.xyz, 1.0); mv.xy += position.xy * center.w;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec4 vTint;
        void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vTint.rgb * vTint.a * t.a, 1.0); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  begin() {
    this.count = 0;
  }
  add(x, y, z, size, r, g, b, a) {
    if (this.count >= this.max) return;
    const i = this.count++ * 4;
    this.center[i] = x;
    this.center[i + 1] = y;
    this.center[i + 2] = z;
    this.center[i + 3] = size;
    this.color[i] = r;
    this.color[i + 1] = g;
    this.color[i + 2] = b;
    this.color[i + 3] = a;
  }
  end() {
    this.mesh.geometry.instanceCount = this.count;
    this.aCenter.needsUpdate = true;
    this.aColor.needsUpdate = true;
  }
}

class BoltBatch {
  constructor(max, texture) {
    this.max = max;
    this.count = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.a = new Float32Array(max * 4);
    this.b = new Float32Array(max * 4);
    this.c = new Float32Array(max * 3);
    this.aA = new THREE.InstancedBufferAttribute(this.a, 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(this.b, 4).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('tail', this.aA);
    geo.setAttribute('head', this.aB);
    geo.setAttribute('tint', this.aC);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: `attribute vec4 tail; attribute vec4 head; attribute vec3 tint; varying vec2 vUv; varying vec3 vTint;
        void main() { vTint = tint; vUv = vec2(position.x * 0.5 + 0.5, position.y);
          vec4 a = viewMatrix * vec4(tail.xyz, 1.0); vec4 b = viewMatrix * vec4(head.xyz, 1.0);
          vec2 d = b.xy - a.xy; float l = length(d); d = l > 1e-4 ? d / l : vec2(0.0, 1.0);
          vec4 p = mix(a, b, position.y); p.xy += vec2(-d.y, d.x) * position.x * tail.w;
          gl_Position = projectionMatrix * p; }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vTint;
        void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(vTint * t.r * 2.2 + vec3(t.a) * 0.55, 1.0); }`,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }
  begin() {
    this.count = 0;
  }
  add(x0, y0, z0, x1, y1, z1, width, r, g, b) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const a = this.a,
      b4 = this.b,
      c = this.c,
      k = i * 4,
      k3 = i * 3;
    a[k] = x0;
    a[k + 1] = y0;
    a[k + 2] = z0;
    a[k + 3] = width;
    b4[k] = x1;
    b4[k + 1] = y1;
    b4[k + 2] = z1;
    b4[k + 3] = 0;
    c[k3] = r;
    c[k3 + 1] = g;
    c[k3 + 2] = b;
  }
  end() {
    this.mesh.geometry.instanceCount = this.count;
    this.aA.needsUpdate = this.aB.needsUpdate = this.aC.needsUpdate = true;
  }
}

const SKY_TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.x = 0;
    this.y = 0;
    this.dist = 2100;
    this.yaw = -90 * DEG;
    this.pitch = 52 * DEG;
    this.minDist = 250;
    this.maxDist = 9000;
    this.bounds = { minX: -6000, minY: -6000, maxX: 6000, maxY: 6000 };
    this.shake = 0;
    this.spec = null;
    this.fovH = 0;
  }
  setSpec(spec) {
    this.spec = spec;
    this.pitch = spec.pitchDefault * DEG;
    this.dist = spec.distDefault;
    this.fovH = spec.fovDefault;
    this.yaw = -Math.PI / 2 - (spec.yawDefault || 0) * DEG;
    this.minDist = spec.distMin;
    this.maxDist = Math.max(this.maxDist, spec.distMax);
    this.clamp();
  }
  tilt(by) {
    const s = this.spec,
      lo = s ? Math.max(-89, s.pitchMin) * DEG : 0.12,
      hi = s ? Math.min(89, s.pitchMax) * DEG : 1.45;
    this.pitch = Math.min(hi, Math.max(lo, this.pitch + by));
  }
  wheel(notches) {
    const s = this.spec;
    if (!s || !(s.distPerUnit > 0)) {
      this.dist *= Math.exp(notches * 0.11);
      this.clamp();
      return;
    }
    let d = this.dist,
      n = notches;
    if (n > 0 && d >= s.distMax - 0.5) {
      this.dist = d * Math.exp(n * 0.11);
      this.clamp();
      return;
    }
    if (n < 0 && d > s.distMax) {
      const out = Math.log(d / s.distMax) / 0.11;
      if (-n <= out) {
        this.dist = d * Math.exp(n * 0.11);
        this.clamp();
        return;
      }
      n += out;
      d = s.distMax;
    }
    this.dist = Math.min(s.distMax, Math.max(s.distMin, d + n * s.distPerUnit));
    this.fovH = Math.min(s.fovMax, Math.max(s.fovMin, this.fovH + n * s.fovPerUnit));
    this.clamp();
  }
  viewPitch() {
    const s = this.spec;
    if (!s || !(s.pitchZoomBegin > 0)) return this.pitch;
    const f = s.distPerUnit > 0 ? (this.dist - s.distMin) / (s.distMax - s.distMin) : (this.fovH - s.fovMin) / (s.fovMax - s.fovMin);
    const t = Math.min(1, Math.max(0, f || 0));
    return t < s.pitchZoomBegin
      ? this.pitch + ((s.pitchZoomedIn * DEG - this.pitch) * (s.pitchZoomBegin - t)) / s.pitchZoomBegin
      : this.pitch;
  }
  forward() {
    return { x: Math.cos(this.yaw + Math.PI), y: Math.sin(this.yaw + Math.PI) };
  }
  pan(right, fwd) {
    const f = this.forward();
    this.x += f.x * fwd + f.y * right * -1 * -1;
    this.y += f.y * fwd - f.x * right;
    this.clamp();
  }
  clamp() {
    const b = this.bounds;
    this.x = Math.min(b.maxX, Math.max(b.minX, this.x));
    this.y = Math.min(b.maxY, Math.max(b.minY, this.y));
    this.dist = Math.min(this.maxDist, Math.max(this.minDist, this.dist));
  }
  apply(dt) {
    const pitch = this.viewPitch(),
      c = this.camera,
      cp = Math.cos(pitch),
      sp = Math.sin(pitch);
    if (this.spec) {
      const fov = (2 * Math.atan(0.75 * Math.tan((this.fovH * DEG) / 2))) / DEG;
      if (Math.abs(c.fov - fov) > 1e-4) {
        c.fov = fov;
        c.updateProjectionMatrix();
      }
    }
    let sx = 0,
      sy = 0;
    if (this.shake > 0.01) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 5);
    }
    c.position.set(this.x + Math.cos(this.yaw) * cp * this.dist + sx, this.y + Math.sin(this.yaw) * cp * this.dist + sy, sp * this.dist);
    c.up.set(0, 0, 1);
    c.lookAt(this.x + sx, this.y + sy, 0);
  }
}

const RING_GRID = 8,
  RING_POINTS = (RING_GRID + 1) * (RING_GRID + 1),
  RING_TRIS = RING_GRID * RING_GRID * 2;
class RingBatch {
  constructor(max, texture, color, mask = null, ground = null) {
    this.max = max;
    this.ground = ground;
    const geo = ground ? this.drapedGeometry(max) : new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ map: texture, color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    if (ground) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits = -4;
    }
    if (mask) {
      mat.stencilWrite = true;
      mat.stencilRef = 1;
      mat.stencilFunc = THREE.NotEqualStencilFunc;
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = 0;
    this.mask = null;
    if (mask) {
      const cut = new THREE.ShaderMaterial({
        uniforms: { map: { value: mask } },
        vertexShader:
          'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'uniform sampler2D map; varying vec2 vUv; void main() { vec4 t = texture2D(map, vUv); if (max(t.r, max(t.g, t.b)) * t.a < 0.5) discard; gl_FragColor = vec4(0.0); }',
        transparent: true,
        colorWrite: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp
      });
      if (ground) {
        cut.polygonOffset = true;
        cut.polygonOffsetFactor = -1;
        cut.polygonOffsetUnits = -4;
      }
      this.mask = new THREE.InstancedMesh(geo, cut, max);
      this.mask.frustumCulled = false;
      this.mask.renderOrder = 3;
      this.mask.count = 0;
    }
    this.n = 0;
    if (ground)
      for (const m of [this.mesh, this.mask])
        if (m) {
          m.setMatrixAt(0, _ringM.identity());
          m.count = 0;
        }
  }
  drapedGeometry(max) {
    const geo = new THREE.BufferGeometry(),
      G = RING_GRID,
      uv = new Float32Array(max * RING_POINTS * 2),
      index = new Uint32Array(max * RING_TRIS * 3);
    for (let r = 0; r < max; r++) {
      const p0 = r * RING_POINTS;
      for (let j = 0; j <= G; j++)
        for (let i = 0; i <= G; i++) {
          const k = (p0 + j * (G + 1) + i) * 2;
          uv[k] = i / G;
          uv[k + 1] = j / G;
        }
      let t = r * RING_TRIS * 3;
      for (let j = 0; j < G; j++)
        for (let i = 0; i < G; i++) {
          const a = p0 + j * (G + 1) + i,
            b = a + 1,
            c = a + G + 1,
            d = c + 1;
          index[t++] = a;
          index[t++] = b;
          index[t++] = d;
          index[t++] = a;
          index[t++] = d;
          index[t++] = c;
        }
    }
    const pos = new THREE.BufferAttribute(new Float32Array(max * RING_POINTS * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    return geo;
  }
  begin() {
    this.n = 0;
  }
  add(x, y, z, size, heading) {
    if (this.n >= this.max) return;
    if (this.ground) {
      const P = this.mesh.geometry.attributes.position.array,
        G = RING_GRID,
        c = Math.cos(heading) * size,
        s = Math.sin(heading) * size;
      const lift = z - this.ground(x, y);
      let k = this.n++ * RING_POINTS * 3;
      for (let j = 0; j <= G; j++)
        for (let i = 0; i <= G; i++) {
          const lx = i / G - 0.5,
            ly = j / G - 0.5,
            px = x + lx * c - ly * s,
            py = y + lx * s + ly * c;
          P[k++] = px;
          P[k++] = py;
          P[k++] = this.ground(px, py) + lift;
        }
      return;
    }
    _ringQ.setFromAxisAngle(_ringZ, heading);
    _ringM.compose(_ringP.set(x, y, z), _ringQ, _ringS.set(size, size, 1));
    if (this.mask) this.mask.setMatrixAt(this.n, _ringM);
    this.mesh.setMatrixAt(this.n++, _ringM);
  }
  end() {
    if (this.ground) {
      const geo = this.mesh.geometry,
        pos = geo.attributes.position;
      geo.setDrawRange(0, this.n * RING_TRIS * 3);
      if (this.n) {
        pos.clearUpdateRanges();
        pos.addUpdateRange(0, this.n * RING_POINTS * 3);
        pos.needsUpdate = true;
      }
      this.mesh.count = this.n ? 1 : 0;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mask) {
        this.mask.count = this.mesh.count;
        this.mask.instanceMatrix.needsUpdate = true;
      }
      return;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mask) {
      this.mask.count = this.n;
      this.mask.instanceMatrix.needsUpdate = true;
    }
  }
}
const _sun = new THREE.Vector3(),
  _sunDir = new THREE.Vector3();
const NO_TINT = new THREE.Vector4(1, 1, 1, 0);
const _ringM = new THREE.Matrix4(),
  _ringQ = new THREE.Quaternion(),
  _ringP = new THREE.Vector3(),
  _ringS = new THREE.Vector3(),
  _ringZ = new THREE.Vector3(0, 0, 1);

export class SelectionRings {
  constructor(scene, faction, land, ground = null) {
    this.scene = scene;
    this.batches = new Map();
    this.ground = ground;
    this.base = faction
      .str(land ? 'Land_Mode_Selection_Blob_Material_Name' : 'Space_Mode_Selection_Blob_Material_Name')
      .trim()
      .toUpperCase();
    const rgba = faction
      .str('Selection_Blob_RGBA')
      .split(',')
      .map(v => parseFloat(v) / 255);
    this.color = (
      rgba.length >= 3 && rgba.every(Number.isFinite) ? new THREE.Color(rgba[0], rgba[1], rgba[2]) : new THREE.Color(1, 1, 1)
    ).lerp(new THREE.Color(1, 1, 1), 0.5);
  }
  get ok() {
    return !!(blobMaterials && blobMaterials.get(this.base));
  }
  batch(name, own) {
    const key = name + '|' + (own ? 1 : 0);
    let b = this.batches.get(key);
    if (b) return b;
    const m = blobMaterials && (blobMaterials.get(name) || blobMaterials.get(this.base));
    if (!m) return null;
    const tex = n => loadTexture(n, { repeat: false });
    b = new RingBatch(own ? 1024 : 256, tex(m.ring), own ? this.color : new THREE.Color(1, 1, 1), m.mask ? tex(m.mask) : null, this.ground);
    this.scene.add(b.mesh);
    if (b.mask) this.scene.add(b.mask);
    this.batches.set(key, b);
    return b;
  }
  begin() {
    for (const b of this.batches.values()) b.begin();
  }
  add(x, y, z, size, heading, own, type) {
    const name = own
      ? (type && type.has('Selection_Blob_Material_Name') ? type.str('Selection_Blob_Material_Name').trim().toUpperCase() : '') || this.base
      : blobMaterials && blobMaterials.has('INVALID_MOVE_LAND')
        ? 'INVALID_MOVE_LAND'
        : this.base;
    const b = this.batch(name, own);
    if (b) b.add(x, y, z, size, heading);
  }
  end() {
    for (const b of this.batches.values()) b.end();
  }
}

let blobMaterials = null;
export async function loadBlobMaterials() {
  if (blobMaterials) return blobMaterials;
  blobMaterials = new Map();
  const txt = await fetchText('Data/XML/ShadowBlobMaterials.xml');
  if (txt)
    for (const top of parseXML(txt).children)
      for (const m of top.children) {
        const name = m.attrs.name || m.attrs.Name;
        const masked = /stencilmasked/i.test(m.val('Shader_Name')) && m.val('Texture_Name_2');
        if (name)
          blobMaterials.set(name.toUpperCase(), { ring: masked || m.val('Texture_Name'), mask: masked ? m.val('Texture_Name') : '' });
      }
  return blobMaterials;
}

async function startGPU() {
  if (!wantGPU()) return null;
  gpuEnv.programSources = programSources;
  gpuEnv.lighting = lighting;
  try {
    const [{ GPURenderer }] = await Promise.all([import('../gpu/renderer.js'), import('../gpu/programs-space.js')]);
    const gpu = await GPURenderer.create();
    if (!gpu) console.warn('webgpu: not available here, drawn with WebGL');
    return gpu;
  } catch (e) {
    console.warn('webgpu', e);
    return null;
  }
}

const glOptions = () => ({ antialias: gfx.aa !== false, powerPreference: 'high-performance', stencil: true });

export class Renderer {
  static async create(container, spare = null) {
    if (spare) return new Renderer(container, spare.isWebGLRenderer ? null : spare, spare.isWebGLRenderer ? spare : null);
    return new Renderer(container, await startGPU());
  }

  constructor(container, gpu = null, gl = null) {
    lighting.fogRange.value.set(0, 0);
    lighting.fowSide.value = 0;
    this.gpu = gpu;
    this.renderer = gpu || gl || new THREE.WebGLRenderer(glOptions());
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(pixelRatio());
    this.dom = this.renderer.domElement;
    gammaOn(this.dom);
    container.appendChild(this.dom);
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'overlay';
    container.appendChild(this.overlay);
    this.ctx = this.overlay.getContext('2d');
    this.scene = new THREE.Scene();
    this.bgScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 20, 90000);
    this.rig = new CameraRig(this.camera);
    this.sprites = new SpriteBatch(6000, glowTex());
    this.bolts = new BoltBatch(4000, boltTex());
    this.pills = new LaserBatch(4000, false);
    this.kites = new LaserBatch(4000, true);
    this.shotModels = new ShotModels(this.scene);
    this.shotFx = [];
    this.shotStamp = 0;
    this.scene.add(this.sprites.mesh, this.bolts.mesh, this.pills.mesh, this.kites.mesh);
    this.fxParticles = new ParticleManager(this.scene);
    this.post = new PostFX(this.renderer);
    this.fxParticles.heatScene = this.post.heatScene;
    this.clones = [];
    this.fog = null;
    this.idlers = [];
    this.sceneryBillboards = [];
    this.particles = [];
    this.texts = [];
    this.skydomes = [];
    this.rings = null;
    this.shadows = null;
    this.shadowsOn = false;
    this.width = 1;
    this.height = 1;
    this.resize();
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
  }

  dispose(keep = false) {
    removeEventListener('resize', this.onResize);
    this.post.resize(1, 1);
    if (this.shadows) {
      this.shadows.target.depthTexture.dispose();
      this.shadows.target.dispose();
      this.shadows = null;
    }
    this.dom.remove();
    this.overlay.remove();
    if (keep) return this.renderer;
    if (this.gpu) this.gpu.dispose();
    else {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    return null;
  }

  resize() {
    const w = this.dom.parentElement.clientWidth || innerWidth,
      h = this.dom.parentElement.clientHeight || innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(pixelRatio());
    this.renderer.setSize(w, h, false);
    const pr = Math.min(devicePixelRatio, 2);
    this.overlay.width = w * pr;
    this.overlay.height = h * pr;
    this.ctx.setTransform(pr, 0, 0, pr, 0, 0);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.resize(w, h);
  }

  sunPoint(cam) {
    if (this.sunMesh === undefined) {
      this.sunMesh = null;
      for (const s of this.skydomes) for (const [name, grp] of s.meshByName) if (/^SUN/.test(name)) this.sunMesh = grp;
    }
    if (this.sunMesh) return this.sunMesh.getWorldPosition(_sun);
    return _sun.copy(lighting.sunDir.value).multiplyScalar(60000).add(cam.position);
  }

  sunBlocked(world, cam) {
    if (!world) return false;
    const o = cam.position,
      d = _sunDir.copy(_sun).sub(o).normalize();
    for (const u of world.units) {
      if (u.dead || u.isFighter || !u.obj.visible) continue;
      const px = u.x - o.x,
        py = u.y - o.y,
        pz = u.z - o.z,
        t = px * d.x + py * d.y + pz * d.z;
      if (t <= 0) continue;
      const r = u.visualRadius * 0.7;
      if (px * px + py * py + pz * pz - t * t < r * r) return true;
    }
    return false;
  }

  darken(u) {
    if (u.darkHooked) return;
    u.darkHooked = true;
    const dark = new THREE.Vector4(0, 0, 0, 0);
    u.obj.traverse(o => {
      const m = o.material;
      if (!o.isMesh || !m || !m.uniforms || !m.uniforms.tint) return;
      const before = o.onBeforeRender,
        after = o.onAfterRender;
      o.onBeforeRender = function (...a) {
        before.apply(this, a);
        if (u.hyper) {
          dark.w = Math.max(0, Math.min(1, u.hyper.dark ?? 1));
          this.material.uniforms.tint.value = dark;
          this.material.uniformsNeedUpdate = true;
        }
      };
      o.onAfterRender = function (...a) {
        after.apply(this, a);
        if (u.hyper) {
          this.material.uniforms.tint.value = NO_TINT;
          this.material.uniformsNeedUpdate = true;
        }
      };
    });
  }

  updateHaze(u, dt) {
    let h = u.haze;
    if (!h) {
      const c = db.constants.list('Nebula_Effect_Color').map(Number);
      h = u.haze = {
        v: 0,
        vel: 0,
        color: new THREE.Vector4((c[0] ?? 255) / 255, (c[1] ?? 255) / 255, (c[2] ?? 255) / 255, 0),
        strength: (c[3] ?? 64) / 255,
        inside: false
      };
    }
    if (u.inNebula && !h.inside) {
      u.obj.traverse(o => {
        const m = o.material;
        if (!o.isMesh || !m || !m.uniforms || !m.uniforms.tint || o.userData.hazed) return;
        o.userData.hazed = true;
        const before = o.onBeforeRender,
          after = o.onAfterRender;
        o.onBeforeRender = function (...a) {
          before.apply(this, a);
          if (h.color.w > 0) {
            this.material.uniforms.tint.value = h.color;
            this.material.uniformsNeedUpdate = true;
          }
        };
        o.onAfterRender = function (...a) {
          after.apply(this, a);
          if (h.color.w > 0) {
            this.material.uniforms.tint.value = NO_TINT;
            this.material.uniformsNeedUpdate = true;
          }
        };
      });
    }
    h.inside = !!u.inNebula;
    const target = u.inNebula ? 1 : 0,
      omega = 2 / 0.5,
      x = omega * dt;
    const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x),
      d = h.v - target,
      tmp = (h.vel + omega * d) * dt;
    h.vel = (h.vel - omega * tmp) * k;
    h.v = target + (d + tmp) * k;
    if (!u.inNebula && h.v < 0.004) {
      h.v = 0;
      h.vel = 0;
    }
    h.color.w = h.v * h.strength;
  }

  updateShadows(world, r = this.renderer) {
    if (!this.shadowsOn) {
      lighting.shadowOn.value = 0;
      return;
    }
    let sh = this.shadows;
    if (sh && sh.size !== shadowSize()) {
      sh.target.depthTexture.dispose();
      sh.target.dispose();
      for (const o of sh.scene.children.slice()) sh.scene.remove(o);
      sh.batches.clear();
      sh = this.shadows = null;
    }
    if (!sh) {
      const size = shadowSize();
      const target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
      target.depthTexture = new THREE.DepthTexture(size, size);
      target.depthTexture.type = THREE.UnsignedIntType;
      target.depthTexture.compareFunction = THREE.LessEqualCompare;
      target.depthTexture.magFilter = target.depthTexture.minFilter = THREE.LinearFilter;
      target.texture.minFilter = target.texture.magFilter = THREE.NearestFilter;
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2);
      const scene = new THREE.Scene();
      scene.matrixWorldAutoUpdate = false;
      sh = this.shadows = {
        size,
        target,
        camera,
        scene,
        batches: new Map(),
        stamp: 0,
        depth: new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }),
        frame: 0,
        bias: new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      };
      lighting.shadowMap.value = target.depthTexture;
      lighting.shadowTexel.value = 1 / size;
    }
    lighting.shadowOn.value = 1;
    if (sh.frame++ % 3) return;
    const rig = this.rig,
      cam = sh.camera,
      half = Math.max(500, Math.min(4500, rig.dist * 0.85)),
      far = half * 4;
    const dir = lighting.sunDir.value;
    cam.left = cam.bottom = -half;
    cam.right = cam.top = half;
    cam.near = 1;
    cam.far = far * 2;
    cam.position.set(rig.x + dir.x * far, rig.y + dir.y * far, dir.z * far);
    cam.up.set(0, 0, 1);
    cam.lookAt(rig.x, rig.y, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    lighting.shadowMatrix.value.copy(sh.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    const batches = sh.batches;
    for (const b of batches.values()) b.n = 0;
    if (world)
      for (const u of world.units) {
        if (u.dead || !u.casters || !u.obj.visible) continue;
        for (const m of u.casters) {
          let b = batches.get(m.geometry);
          if (!b) batches.set(m.geometry, (b = { n: 0, im: null }));
          if (!b.im || b.n === b.im.instanceMatrix.count) {
            const cap = b.im ? b.im.instanceMatrix.count * 2 : 8,
              im = new THREE.InstancedMesh(m.geometry, sh.depth, cap);
            im.frustumCulled = false;
            im.matrixAutoUpdate = false;
            im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            if (b.im) {
              im.instanceMatrix.array.set(b.im.instanceMatrix.array);
              sh.scene.remove(b.im);
              b.im.dispose();
            }
            sh.scene.add(im);
            b.im = im;
          }
          m.matrixWorld.toArray(b.im.instanceMatrix.array, b.n++ * 16);
        }
      }
    for (const [g, b] of batches) {
      if (!b.n) {
        if (b.im) {
          sh.scene.remove(b.im);
          b.im.dispose();
        }
        batches.delete(g);
        continue;
      }
      b.im.count = b.n;
      b.im.instanceMatrix.clearUpdateRanges();
      b.im.instanceMatrix.addUpdateRange(0, b.n * 16);
      b.im.instanceMatrix.needsUpdate = true;
    }
    r.setRenderTarget(sh.target);
    r.clear();
    r.render(sh.scene, cam);
    r.setRenderTarget(null);
  }

  setSelectionArt(faction) {
    if (!blobMaterials) return;
    const rings = new SelectionRings(this.scene, faction, false);
    this.rings = rings.ok ? rings : null;
  }

  updateSelection(selection, me) {
    const r = this.rings;
    if (!r) return;
    r.begin();
    for (const s of selection) {
      if (s.dead || s.isPad) continue;
      const own = s.player === me;
      if (s.isSquad)
        for (const f of s.fighters) {
          if (!f.dead) r.add(f.x, f.y, f.z + f.ringZ, f.ringSize, f.heading, own, f.type);
        }
      else r.add(s.x, s.y, s.z + s.ringZ, s.ringSize, s.heading, own, s.type);
    }
    r.end();
  }

  setEnvironment(env) {
    if (!env) return;
    for (const s of this.skydomes) this.bgScene.remove(s.root);
    this.skydomes = [];
    this.sunMesh = undefined;
    setPlanetEnvironment(env);
    const [sun, f1, f2] = env.lights;
    const n = v => new THREE.Vector3(...v).normalize();
    lighting.sunDir.value.copy(n(sun.dir));
    lighting.sunColor.value.setRGB(...sun.color.map(c => c * 1.9));
    lighting.fillDir.value.copy(n(f1.dir).add(n(f2.dir)).normalize());
    lighting.fillColor.value.setRGB(...f1.color.map((c, i) => (c + f2.color[i]) * 1.3));
    lighting.ambient.value.setRGB(...env.ambient.map(c => Math.max(c, 0.22)));
    for (const t of env.skydomes) {
      const data = getModelData(t.str('Space_Model_Name'));
      if (!data) continue;
      const inst = buildModel(data);
      inst.root.scale.setScalar(t.num('Scale_Factor', 1));
      const [ax, az] = env.skyAngles?.[t.name.toUpperCase()] || [0, 0];
      inst.root.quaternion.setFromEuler(new THREE.Euler((ax * Math.PI) / 180, 0, (az * Math.PI) / 180, 'ZYX')).multiply(SKY_TURN);
      inst.root.traverse(o => {
        if (!o.isMesh) return;
        const src = o.material;
        o.material = src.clone();
        o.material.uniforms.map.value = src.uniforms.map.value;
        if (src.uniforms.time) o.material.uniforms.time = src.uniforms.time;
        o.material.depthTest = false;
        o.material.depthWrite = false;
        o.frustumCulled = false;
      });
      this.bgScene.add(inst.root);
      this.skydomes.push(inst);
    }
  }

  spawnParticle(x, y, z, vx, vy, vz, size, grow, life, r, g, b, a = 1) {
    if (this.particles.length > 5000) return;
    this.particles.push({ x, y, z, vx, vy, vz, size, grow, life, age: 0, r, g, b, a });
  }

  updateFog(world, dt) {
    if (!world.fog || !world.viewer || world.reveal) {
      if (this.fog) this.fog.mesh.visible = false;
      return;
    }
    let f = this.fog;
    if (!f) {
      const c = db.constants;
      const cell = Math.max(25, c.num('DesiredSpaceFOWCellSize', 100));
      const w = world.max.x - world.min.x,
        h = world.max.y - world.min.y;
      const nx = Math.max(8, Math.round(w / cell)),
        ny = Math.max(8, Math.round(h / cell));
      const state = new Float32Array(nx * ny).fill(1);
      const bytes = new Uint8Array(nx * ny * 4);
      const texture = new THREE.DataTexture(bytes, nx, ny, THREE.RGBAFormat);
      texture.magFilter = texture.minFilter = THREE.LinearFilter;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = THREE.NoColorSpace;
      const rgb = (k, d) => {
        const v = c.str(k).split(',').map(parseFloat);
        return v.length >= 3 && v.every(Number.isFinite) ? new THREE.Color(v[0] / 255, v[1] / 255, v[2] / 255) : new THREE.Color(...d);
      };
      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          state: { value: texture },
          grid: { value: whiteTexture() },
          gridRed: { value: whiteTexture() },
          cells: { value: new THREE.Vector2(nx, ny) },
          tint: { value: rgb('SpaceFOWColor', [1, 1, 1]) },
          tintRed: { value: rgb('SpaceReinforceFOWColor', [1, 0, 0]) },
          haveGrid: { value: 0 },
          placing: { value: 0 },
          redLit: { value: 1 }
        },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          uniform sampler2D state, grid, gridRed;
          uniform vec2 cells; uniform vec3 tint, tintRed; uniform float haveGrid, placing, redLit;
          varying vec2 vUv;
          void main() {
            vec2 m = vUv * 3.0 - 1.0;
            float inside = step(0.0, m.x) * step(m.x, 1.0) * step(0.0, m.y) * step(m.y, 1.0);
            float fog = mix(1.0, texture2D(state, clamp(m, 0.0, 1.0)).r, inside);
            vec2 t = m * cells;
            vec4 g = texture2D(grid, t), r = texture2D(gridRed, t);
            float cellMask = smoothstep(0.1, 0.34, max(g.r, max(g.g, g.b)));
            vec3 blue = mix(vec3(0.0), vec3(0.78, 0.8, 0.84) * tint, cellMask);
            float blueA = mix(0.32, 0.09, cellMask);
            float redMask = smoothstep(0.2, 0.6, r.r);
            vec3 red = r.rgb * tintRed;
            float redA = mix(0.05, 0.42, redMask);
            red = mix(mix(blue * 0.35, red, cellMask), red, redLit);
            redA = mix(blueA, redA, redLit);
            vec3 col = mix(blue, red, placing);
            float a = mix(blueA, redA, placing);
            col = mix(vec3(0.008, 0.02, 0.04), col, haveGrid);
            a = mix(0.72, a, haveGrid);
            gl_FragColor = vec4(col, a * fog);
          }`
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * 3, h * 3), material);
      mesh.position.set((world.min.x + world.max.x) / 2, (world.min.y + world.max.y) / 2, c.num('SpaceFOWHeight', -80));
      mesh.renderOrder = -1;
      this.scene.add(mesh);
      const canvas = document.createElement('canvas');
      canvas.width = nx;
      canvas.height = ny;
      f = this.fog = {
        canvas,
        ctx: canvas.getContext('2d'),
        image: new ImageData(nx, ny),
        texture,
        mesh,
        material,
        state,
        bytes,
        nx,
        ny,
        cell,
        timer: 0,
        regrow: Math.max(0.1, c.num('SpaceFOWRegrowTime', 6))
      };
      fetchBinary('Data/Art/Textures/W_SPACE_FOW_GRID.DDS').then(buf => {
        if (!buf) return;
        material.uniforms.grid.value = loadTexture('W_SPACE_FOW_GRID.DDS');
        material.uniforms.gridRed.value = loadTexture('W_SPACE_REINFORCE_FOW_GRID.DDS');
        material.uniforms.haveGrid.value = 1;
        loadTextureCanvas('W_SPACE_REINFORCE_FOW_GRID.DDS')
          .then(cv => {
            if (!cv) return;
            const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            let top = 0;
            for (let i = 0; i < d.length; i += 4) top = Math.max(top, d[i], d[i + 1], d[i + 2]);
            material.uniforms.redLit.value = top >= 100 ? 1 : 0;
          })
          .catch(() => {});
      });
    }
    f.mesh.visible = !this.cameraOverride;
    f.material.uniforms.placing.value = this.fogPlacing ? 1 : 0;
    if ((f.timer -= dt) > 0) return;
    const step = 0.1 - f.timer;
    f.timer = 0.1;
    const { state, nx, ny } = f;
    const grow = step / f.regrow;
    for (let i = 0; i < state.length; i++) if (state[i] < 1) state[i] = Math.min(1, state[i] + grow);
    const sx = nx / (world.max.x - world.min.x),
      sy = ny / (world.max.y - world.min.y);
    const team = world.viewer.team;
    const clear = (x, y, r) => {
      const cx = (x - world.min.x) * sx,
        cy = (y - world.min.y) * sy,
        cr = r * sx;
      const x0 = Math.max(0, Math.floor(cx - cr - 1)),
        x1 = Math.min(nx - 1, Math.ceil(cx + cr + 1));
      const y0 = Math.max(0, Math.floor(cy - cr - 1)),
        y1 = Math.min(ny - 1, Math.ceil(cy + cr + 1));
      if (x0 > x1 || y0 > y1) return;
      const out2 = (cr + 1) * (cr + 1),
        in2 = cr > 1 ? (cr - 1) * (cr - 1) : -1;
      for (let j = y0; j <= y1; j++) {
        const dy = j + 0.5 - cy,
          dy2 = dy * dy,
          row = j * nx;
        for (let i = x0; i <= x1; i++) {
          const dx = i + 0.5 - cx,
            dd = dx * dx + dy2;
          if (dd >= out2) continue;
          const k = row + i;
          if (dd <= in2) {
            state[k] = 0;
            continue;
          }
          const d = Math.sqrt(dd) - cr;
          if (d >= 1) continue;
          const v = d <= -1 ? 0 : (d + 1) * 0.5;
          if (v < state[k]) state[k] = v;
        }
      }
    };
    for (const u of world.units) if (!u.dead && !u.hyper && u.player.team === team) clear(u.x, u.y, u.revealRange);
    for (const r of world.reveals) if (r.team === team) clear(r.x, r.y, r.r);
    const bytes = f.bytes,
      img = f.image.data;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = Math.round(state[j * nx + i] * 255),
          o = (j * nx + i) * 4;
        bytes[o] = bytes[o + 1] = bytes[o + 2] = bytes[o + 3] = v;
        const q = ((ny - 1 - j) * nx + i) * 4;
        img[q] = 2;
        img[q + 1] = 5;
        img[q + 2] = 10;
        img[q + 3] = Math.round(v * 0.72);
      }
    f.texture.needsUpdate = true;
    f.ctx.putImageData(f.image, 0, 0);
  }

  addIdle(inst, modelFile) {
    const a = getALA(animName(modelFile, 'IDLE'));
    if (a) this.idlers.push(new AnimState(inst, a, { loop: true, time: Math.random() * a.duration }));
  }

  deathClone(u) {
    const tuple = u.type.tuples('Death_Clone')[0];
    const type = tuple && db.type(tuple[1]);
    const file = type && type.str('Space_Model_Name');
    const data = file && getModelData(file),
      anim = file && getALA(animName(file, 'DIE'));
    if (!data || !anim || !u.obj.visible || this.clones.length > 24) return;
    const inst = buildModel(data, { teamColor: u.player && u.player.id >= 0 ? u.player.color : null });
    const holder = new THREE.Group();
    u.syncObj();
    holder.position.copy(u.obj.position);
    holder.quaternion.copy(u.obj.quaternion);
    holder.scale.setScalar(type.num('Scale_Factor', u.scale));
    holder.add(inst.root);
    for (const [name, mesh] of inst.meshByName) if (/BLAST/.test(name)) mesh.visible = true;
    this.scene.add(holder);
    const proxies = inst.proxies.filter(p => !/engine/i.test(p.name)).map(p => ({ name: p.name, bone: p.bone, on: false }));
    const state = new AnimState(inst, anim, {});
    this.clones.push({ holder, inst, state, proxies, age: 0, limit: Math.min(anim.duration, 40) });
  }

  makeGhost(models) {
    const group = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      uniforms: { tint: { value: new THREE.Color(0x55ff77) } },
      vertexShader:
        'varying vec3 vN, vP; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = mat3(modelMatrix) * normal; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader:
        'uniform vec3 tint; varying vec3 vN, vP; void main() { float f = abs(dot(normalize(vN), normalize(cameraPosition - vP))); gl_FragColor = vec4(tint * (0.55 + 0.75 * (1.0 - f)), 0.3 + 0.4 * (1.0 - f)); }'
    });
    const depth = new THREE.ShaderMaterial({
      colorWrite: false,
      vertexShader: mat.vertexShader,
      fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }'
    });
    const dress = root => {
      const meshes = [];
      root.traverse(o => {
        if (o.isMesh) meshes.push(o);
      });
      for (const o of meshes) {
        if (o.material.transparent || (o.material.userData && o.material.userData.additive)) {
          o.visible = false;
          continue;
        }
        const d = new THREE.Mesh(o.geometry, depth);
        d.renderOrder = 6;
        o.parent.add(d);
        d.position.copy(o.position);
        d.quaternion.copy(o.quaternion);
        d.scale.copy(o.scale);
        o.material = mat;
        o.renderOrder = 7;
        o.onBeforeRender = () => {};
      }
    };
    let radius = 0;
    for (const m of models) {
      const data = getModelData(m.file);
      if (!data) continue;
      const inst = buildModel(data);
      radius = Math.max(radius, (inst.radius || 0) * m.scale + Math.hypot(m.x, m.y));
      for (const [name, mesh] of inst.meshByName) if (/BLAST|GIRDER/.test(name) || name === 'SHIELD') mesh.visible = false;
      for (const hp of m.hardpoints || []) {
        const part = getModelData(hp.model),
          bone = inst.bone(hp.bone);
        if (part && bone) bone.add(buildModel(part).root);
      }
      dress(inst.root);
      const holder = new THREE.Group();
      holder.add(inst.root);
      holder.position.set(m.x, m.y, m.z);
      holder.scale.setScalar(m.scale);
      group.add(holder);
    }
    this.scene.add(group);
    return {
      group,
      radius,
      set: (x, y, heading, ok) => {
        group.position.set(x, y, 0);
        group.rotation.z = heading + Math.PI / 2;
        mat.uniforms.tint.value.setHex(ok ? 0x55ff77 : 0xff5544);
      },
      remove: () => {
        this.scene.remove(group);
        mat.dispose();
        depth.dispose();
      }
    };
  }

  startShotFx(p, look) {
    const scale = p.def._shotModel.scale,
      hs = [];
    for (const px of look.proxies) {
      const h = this.fxParticles.spawn(px.name, f => {
        const inv = 1 / (Math.hypot(p.vx, p.vy, p.vz) || 1),
          dx = p.vx * inv,
          dy = p.vy * inv,
          dz = p.vz * inv;
        let ux = -dz * dx,
          uy = -dz * dy,
          uz = 1 - dz * dz;
        const ul = Math.hypot(ux, uy, uz);
        if (ul < 1e-4) {
          ux = 1;
          uy = 0;
          uz = 0;
        } else {
          ux /= ul;
          uy /= ul;
          uz /= ul;
        }
        const ax = -(dy * uz - dz * uy),
          ay = -(dz * ux - dx * uz),
          az = -(dx * uy - dy * ux);
        const lx = px.x * scale,
          ly = px.y * scale,
          lz = px.z * scale;
        f.x = p.x + ax * lx - dx * ly + ux * lz;
        f.y = p.y + ay * lx - dy * ly + uy * lz;
        f.z = p.z + az * lx - dz * ly + uz * lz;
        f.rot = Math.atan2(dy, dx) + Math.PI / 2;
        f.roll = 0;
        f.scale = SHOT_FX_SCALE ? scale : 1;
        f.vx = SHOT_FX_CARRY ? p.vx : 0;
        f.vy = SHOT_FX_CARRY ? p.vy : 0;
        return !p.hidden;
      });
      if (h) hs.push(h);
    }
    if (hs.length) this.shotFx.push(p);
    return hs.length ? hs : NO_FX;
  }

  attachProxy(u, px) {
    const state = this.fxParticles.state(px.name);
    if (state !== 'ready') return state === 'missing';
    const l = px.local;
    const sys = this.fxParticles.spawn(
      px.name,
      f => {
        if (u.dead) {
          sys.dead = true;
          return false;
        }
        const c = Math.cos(u.heading),
          s = Math.sin(u.heading);
        const ro = u.roll || 0,
          cr = Math.cos(ro),
          sr = Math.sin(ro),
          ly = l.y * cr + l.z * sr,
          rz = l.z * cr - l.y * sr;
        const pi = u.pitch || 0,
          cp = Math.cos(pi),
          sp = Math.sin(pi),
          lx = l.x * cp - rz * sp,
          lz = l.x * sp + rz * cp;
        f.x = u.x + c * lx - s * ly;
        f.y = u.y + s * lx + c * ly;
        f.z = u.z + lz;
        f.rot = u.heading + Math.PI / 2;
        f.roll = ro;
        f.scale = u.scale;
        f.vx = c * u.speed * cp;
        f.vy = s * u.speed * cp;
        f.vz = u.speed * sp;
        return (
          u.obj.visible &&
          !u.hyper &&
          (!px.engine || u.engineAlive()) &&
          (!px.byBone || boneShown(px.bone, u.model.root)) &&
          (!px.ion || u.ionUntil > u.world.time)
        );
      },
      { points: u.proxyPoints(px) }
    );
    px.engine = /engine/i.test(px.name);
    px.sys = sys;
    return true;
  }

  explosion(x, y, z, size, big = false, file = '') {
    if (x === undefined) return;
    if (file && this.fxParticles.state(file) === 'ready') {
      this.fxParticles.burst(file, x, y, z);
      this.spawnParticle(x, y, z, 0, 0, 0, size * 1.2, size * 1.5, 0.22, 1, 0.9, 0.7, 1.1);
      if (big)
        this.rig.shake = Math.min(40, this.rig.shake + size * 0.05 * Math.min(1, 2500 / (Math.hypot(x - this.rig.x, y - this.rig.y) + 1)));
      return;
    }
    const n = Math.min(60, 8 + Math.round(size / 6));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        e = (Math.random() - 0.5) * 1.6,
        sp = size * (0.2 + Math.random() * 1.1);
      const heat = Math.random();
      this.spawnParticle(
        x + (Math.random() - 0.5) * size * 0.5,
        y + (Math.random() - 0.5) * size * 0.5,
        z + (Math.random() - 0.5) * size * 0.3,
        Math.cos(a) * Math.cos(e) * sp,
        Math.sin(a) * Math.cos(e) * sp,
        Math.sin(e) * sp,
        size * (0.25 + Math.random() * 0.35),
        size * 0.5,
        0.5 + Math.random() * (big ? 2.2 : 0.9),
        1,
        0.45 + heat * 0.45,
        0.1 + heat * 0.3,
        0.9
      );
    }
    this.spawnParticle(x, y, z, 0, 0, 0, size * 1.8, size * 2, 0.25, 1, 0.95, 0.8, 1.6);
    if (big) {
      this.spawnParticle(x, y, z, 0, 0, 0, size * 0.6, size * 6, 0.9, 0.7, 0.8, 1, 0.8);
      this.rig.shake = Math.min(40, this.rig.shake + size * 0.05 * Math.min(1, 2500 / (Math.hypot(x - this.rig.x, y - this.rig.y) + 1)));
    }
  }

  made(file, x, y, z) {
    if (file && this.fxParticles.systems.length < 450 && this.fxParticles.state(file) === 'ready') this.fxParticles.burst(file, x, y, z);
  }

  hit(x, y, z, size, file = '') {
    if (x === undefined) return;
    if (file && this.fxParticles.systems.length < 450 && this.fxParticles.state(file) === 'ready') {
      this.fxParticles.burst(file, x, y, z);
      return;
    }
    this.spawnParticle(x, y, z, 0, 0, 0, size, size * 2, 0.18, 1, 0.75, 0.35, 1);
    if (Math.random() < 0.4) {
      const a = Math.random() * 6.28;
      this.spawnParticle(x, y, z, Math.cos(a) * 60, Math.sin(a) * 60, 30, size * 0.4, 0, 0.4, 1, 0.6, 0.2, 0.9);
    }
  }

  shieldHit(x, y, z, target, file = '') {
    if (x === undefined) return;
    if (file && this.fxParticles.systems.length < 450 && this.fxParticles.state(file) === 'ready') {
      this.fxParticles.burst(file, x, y, z);
      return;
    }
    this.spawnParticle(x, y, z + 4, 0, 0, 0, 10, 40, 0.2, 0.35, 0.6, 1, target.shieldMesh ? 0.5 : 0.9);
  }

  flash(x, y, z, size, color) {
    const c = new THREE.Color(color);
    this.spawnParticle(x, y, z, 0, 0, 0, size * 0.3, size * 2, 0.8, c.r, c.g, c.b, 1.2);
  }

  aimTurrets(u, dt) {
    let moved = null,
      one = null;
    for (const t of u.turrets) {
      let want = 0,
        lift = 0;
      const tg = t.hp
        ? t.hp.alive && t.hp.target && !t.hp.target.dead
          ? t.hp.target
          : null
        : u.target && !u.target.dead
          ? u.target
          : null;
      if (tg) {
        want = t.hp ? Math.atan2(tg.y - u.y, tg.x - u.x) - u.heading - t.hp.facing : u.aim !== undefined ? u.aim - u.heading : 0;
        const from = u.z + (t.hp ? t.hp.local.z : u.height * 0.5);
        lift = Math.atan2(tg.z - from, Math.max(1, Math.hypot(tg.x - u.x, tg.y - u.y)));
      }
      want = ((((want + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
      if (t.yawLimit < Math.PI) want = Math.max(-t.yawLimit, Math.min(t.yawLimit, want));
      lift = Math.max(-t.pitchLimit, Math.min(t.pitchLimit, lift));
      let d = want - t.yaw;
      if (t.yawLimit >= Math.PI) {
        d %= Math.PI * 2;
        if (d > Math.PI) d -= Math.PI * 2;
        else if (d < -Math.PI) d += Math.PI * 2;
      }
      const dp = t.tilt ? lift - t.pitch : 0;
      if (Math.abs(d) < 0.002 && Math.abs(dp) < 0.002) continue;
      const step = t.speed * dt;
      t.yaw += Math.max(-step, Math.min(step, d));
      t.pitch += Math.max(-step, Math.min(step, dp));
      _tq.setFromAxisAngle(_up, t.yaw);
      t.bone.quaternion.copy(t.rest).multiply(_tq);
      if (t.tilt) {
        _tq.setFromAxisAngle(t.axis, t.pitch);
        if (t.tilt === t.bone) t.bone.quaternion.multiply(_tq);
        else t.tilt.quaternion.copy(t.tiltRest).multiply(_tq);
      }
      if (!one) one = t.inst;
      else if (t.inst !== one) (moved ||= new Set([one])).add(t.inst);
    }
    if (moved) for (const inst of moved) inst.syncFromBones();
    else if (one) one.syncFromBones();
  }

  updateClones(dt) {
    let n = 0;
    for (const c of this.clones) {
      c.age += dt;
      const playing = c.state.step(dt);
      for (const p of c.proxies) {
        let on = true;
        for (let b = p.bone; b && b !== c.inst.root; b = b.parent)
          if (!b.visible) {
            on = false;
            break;
          }
        if (on && !p.on) {
          const bone = p.bone,
            scale = c.holder.scale.x,
            pos = new THREE.Vector3();
          if (this.fxParticles.state(p.name) === 'ready') {
            p.sys = this.fxParticles.spawn(
              p.name,
              f => {
                bone.getWorldPosition(pos);
                f.x = pos.x;
                f.y = pos.y;
                f.z = pos.z;
                f.rot = 0;
                f.scale = 1;
                f.vx = f.vy = 0;
              },
              { scale }
            );
          } else {
            bone.getWorldPosition(pos);
            this.explosion(pos.x, pos.y, pos.z, 40);
          }
        } else if (!on && p.on && p.sys) {
          p.sys.stop();
          p.sys = null;
        }
        p.on = on;
      }
      if (!playing || c.age > c.limit) {
        c.inst.box.getCenter(_cv).applyMatrix4(c.holder.matrixWorld);
        this.explosion(_cv.x, _cv.y, _cv.z, Math.min(300, c.inst.radius * 0.6 * c.holder.scale.x), false);
        for (const p of c.proxies) if (p.sys) p.sys.stop();
        this.scene.remove(c.holder);
        continue;
      }
      this.clones[n++] = c;
    }
    this.clones.length = n;
  }

  floatText(x, y, z, text, color = '#ffe27a') {
    this.texts.push({ x, y, z, text, color, age: 0 });
  }

  project(x, y, z, out) {
    _v.set(x, y, z).project(this.camera);
    out.x = (_v.x * 0.5 + 0.5) * this.width;
    out.y = (-_v.y * 0.5 + 0.5) * this.height;
    out.behind = _v.z > 1;
    return out;
  }

  pickGround(sx, sy, out = { x: 0, y: 0 }, z = 0) {
    _v.set((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1, 0.5).unproject(this.camera);
    const o = this.camera.position;
    const dz = _v.z - o.z;
    if (Math.abs(dz) < 1e-6) return null;
    const t = (z - o.z) / dz;
    if (t < 0) return null;
    out.x = o.x + (_v.x - o.x) * t;
    out.y = o.y + (_v.y - o.y) * t;
    return out;
  }

  render(world, dt, drawOverlay) {
    planetClock.value += dt;
    if (this.cameraOverride) this.cameraOverride(dt);
    else {
      this.rig.apply(dt);
      if (this.chase && this.chase.active) this.chase.frame(this.camera, this.rig.x, this.rig.y, 0);
    }
    this.camera.updateMatrixWorld();
    const cam = this.camera;

    const sp = this.sprites;
    sp.begin();
    const ps = this.particles;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = p.age / p.life,
        drag = Math.exp(-dt * 1.5);
      p.vx *= drag;
      p.vy *= drag;
      p.vz *= drag;
      const fade = (1 - k) * (1 - k);
      sp.add(p.x, p.y, p.z, p.size + p.grow * k, p.r, p.g * (1 - k * 0.5), p.b * (1 - k * 0.8), p.a * fade);
      ps[n++] = p;
    }
    ps.length = n;

    const bolts = this.bolts,
      pills = this.pills,
      kites = this.kites;
    bolts.begin();
    pills.begin();
    kites.begin();
    this.shotModels.begin();
    {
      const span = 1 / Math.max(1, cam.far - cam.near),
        C = db.constants;
      const pu = pills.mesh.material.uniforms,
        ku = kites.mesh.material.uniforms;
      pu.depthSpan.value.set(span, cam.near * span);
      ku.depthSpan.value.set(span, cam.near * span);
      pu.zScale.value = C.num('Laser_Beam_Z_Scale_Factor', 8);
      ku.zScale.value = C.num('Laser_Kite_Z_Scale_Factor', 1.2);
    }
    const laser = (p, inv) => {
      const L = LaserBatch.lookOf(p.def);
      (L.kite ? kites : pills).add(p.x, p.y, p.z, p.vx * inv, p.vy * inv, p.vz * inv, p.length, p.width, L);
    };
    if (world) {
      const stamp = ++this.shotStamp;
      for (const p of world.projectiles) {
        p.fxSeen = stamp;
        if (p.hidden) continue;
        const P = p.def;
        if (!(P._cr ??= P.num('Projectile_Custom_Render', 0)) && !(P._sm ??= P.str('Space_Model_Name'))) continue;
        const inv = 1 / p.speed;
        const look = this.shotModels.lookOf(p.def);
        if (p.fxs === null) p.fxs = look && look.proxies.length ? this.startShotFx(p, look) : NO_FX;
        if (look) {
          if (look.parts.length) this.shotModels.add(look.parts, p.def._shotModel.scale, p.x, p.y, p.z, p.vx * inv, p.vy * inv, p.vz * inv);
        } else if (p.missile && p.def.num('Projectile_Custom_Render', 0) > 0) {
          laser(p, inv);
        } else if (p.missile) {
          sp.add(p.x, p.y, p.z, 7 + p.width, p.r, p.g, p.b, 1.2);
          if (Math.random() < dt * 40) this.spawnParticle(p.x, p.y, p.z, 0, 0, 0, 4, 6, 0.5, p.r * 0.6, p.g * 0.6, p.b * 0.6, 0.6);
        } else laser(p, inv);
      }
      const fx = this.shotFx;
      let fn = 0;
      for (let i = 0; i < fx.length; i++) {
        const p = fx[i];
        if (p.fxSeen === stamp) {
          fx[fn++] = p;
          continue;
        }
        for (const h of p.fxs) h.stop();
      }
      fx.length = fn;
      const viewer = world.viewer ? world.viewer.bit : 0;
      _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      for (const u of world.units) {
        if (u.dead) continue;
        const seen = (!viewer || (u.seenBy & viewer) !== 0) && !u.scriptHidden;
        if (u.obj.visible !== seen && !(u.isPad && u.padChild)) u.obj.visible = seen;
        if (!seen) continue;
        if (u.inNebula || u.haze) this.updateHaze(u, dt);
        if (u.pendingProxies.length) u.pendingProxies = u.pendingProxies.filter(px => !this.attachProxy(u, px));
        _sphere.center.set(u.x, u.y, u.z || 0);
        _sphere.radius = (u.visualRadius || 50) * 2.5;
        const inView = !!u.casters || _frustum.intersectsSphere(_sphere);
        if (u.buildAnim && u.construction) {
          if (inView) u.buildAnim.seek(1 - u.construction.left / u.construction.total);
        } else if (u.anim) {
          if (!inView) u.animOwed = (u.animOwed || 0) + dt;
          else {
            if (!u.anim.step(dt + (u.animOwed || 0))) u.anim = null;
            u.animOwed = 0;
          }
        }
        if (u.turrets.length) this.aimTurrets(u, dt);
        if (u.model && u.model.billboards.length) updateBillboards(u.model, cam);
        const c = Math.cos(u.heading),
          s = Math.sin(u.heading);
        if (u.shieldMesh) {
          if (u.shieldFlash > 0) u.shieldFlash -= dt;
          const on = u.shieldFlash > 0;
          if (u.shieldMesh.visible !== on) u.shieldMesh.visible = on;
          if (on) {
            const t = SHIELD_FLASH + SHIELD_FADE - u.shieldFlash,
              keys = (this.shieldScale ||= db.constants.str('Shield_Flash_Scale').split(',').map(parseFloat).filter(Number.isFinite));
            const k = Math.min(1, t / SHIELD_FLASH) * Math.max(0, keys.length - 1),
              i = Math.min(keys.length - 1, Math.floor(k));
            const sc = keys.length ? keys[i] + ((keys[Math.min(keys.length - 1, i + 1)] ?? keys[i]) - keys[i]) * (k - i) : 1;
            u.shieldMesh.scale.setScalar(sc);
            u.shieldGlow = t < SHIELD_FLASH ? 1 : Math.max(0, 1 - (t - SHIELD_FLASH) / SHIELD_FADE) ** 2;
          }
        }
        if (u.hyper) this.darken(u);
        if (u.engineMeshes.length) {
          const on = !u.hyper && u.speed > u.maxSpeed * 0.08 && u.engineAlive();
          for (const m of u.engineMeshes) if (m.visible !== on) m.visible = on;
        }
        if (u.isMobile && !u.hyper) {
          const thrust = 0.55 + 0.45 * Math.min(1, u.speed / (u.maxSpeed || 1));
          const ro = u.roll || 0,
            cro = Math.cos(ro),
            sro = Math.sin(ro);
          for (const g of u.engineGlows) {
            if (g.hp && !g.hp.alive) continue;
            const l = g.local,
              size = Math.max(6, u.visualRadius * 0.16) * g.size * thrust;
            const ly = l.y * cro + l.z * sro,
              lz = l.z * cro - l.y * sro;
            sp.add(u.x + c * l.x - s * ly, u.y + s * l.x + c * ly, u.z + lz, size, 0.45, 0.65, 1, 0.9);
          }
        }
        for (const hp of u.hardpoints) {
          if (hp.alive || !hp.smoke) continue;
          if (Math.random() < dt * 5) {
            hp.worldPos(_w);
            this.spawnParticle(
              _w.x,
              _w.y,
              _w.z + 3,
              (Math.random() - 0.5) * 12,
              (Math.random() - 0.5) * 12,
              14 + Math.random() * 10,
              7,
              14,
              0.9,
              1,
              0.5,
              0.15,
              0.55
            );
          }
        }
      }
    }
    for (const a of this.idlers) a.step(dt);
    for (const inst of this.sceneryBillboards) updateBillboards(inst, cam);
    if (this.clones.length) this.updateClones(dt);
    if (world)
      for (const b of world.beams) {
        const a = b.a,
          t = b.b;
        if (a.obj && !a.obj.visible) continue;
        const tz = t.z ?? 0;
        bolts.add(
          a.x,
          a.y,
          a.z + (a.height || 0) * 0.3,
          t.x,
          t.y,
          tz,
          b.width * (0.8 + Math.random() * 0.4),
          b.color[0],
          b.color[1],
          b.color[2]
        );
        sp.add(t.x, t.y, tz, b.width * 2.2, b.color[0], b.color[1], b.color[2], 0.7);
      }
    sp.end();
    bolts.end();
    pills.end();
    kites.end();
    this.shotModels.end();
    diag.lap('scene update');
    this.fxParticles.update(dt);
    diag.lap('particles');

    if (world) this.updateFog(world, dt || 0.016);
    diag.lap('fog');
    for (const sky of this.skydomes) sky.root.position.copy(cam.position);
    this.draw(world, this.renderer, dt);

    const g = this.ctx;
    g.clearRect(0, 0, this.width, this.height);
    if (drawOverlay) drawOverlay(g);
    let tn = 0;
    g.font = 'bold 13px "Segoe UI", sans-serif';
    g.textAlign = 'center';
    for (const t of this.texts) {
      t.age += dt;
      if (t.age > 1.6) continue;
      this.project(t.x, t.y, t.z, _s);
      if (!_s.behind) {
        g.globalAlpha = 1 - t.age / 1.6;
        g.fillStyle = t.color;
        g.fillText(t.text, _s.x, _s.y - 20 - t.age * 22);
      }
      this.texts[tn++] = t;
    }
    this.texts.length = tn;
    g.globalAlpha = 1;
    diag.lap('overlay');
  }

  draw(world, r, dt) {
    const cam = this.camera;
    r.autoClear = false;
    this.updateShadows(world, r);
    diag.lap('shadows');
    const post = this.post;
    post.r = r;
    const offscreen = post.begin();
    r.clear();
    r.render(this.bgScene, cam);
    r.clearDepth();
    if (world && !NO_INSTANCING) {
      for (const o of this.scene.children) if (!o.userData.ship) o.updateMatrixWorld();
      this.instances ||= new Instances(this.scene);
      this.instances.gpu = r === this.gpu ? r : null;
      this.instances.camera = cam;
      this.instances.collect(world.units, cam);
      this.instances.hidden = this.instances.put.length;
      this.scene.matrixWorldAutoUpdate = false;
      r.render(this.scene, cam);
      this.scene.matrixWorldAutoUpdate = true;
      this.instances.restore();
    } else r.render(this.scene, cam);
    diag.lap('draw');
    if (offscreen) post.end(cam);
    if (post.flare) post.drawFlare(cam, this.sunPoint(cam), this.sunBlocked(world, cam), dt || 0.016);
    if (r.endFrame) r.endFrame();
    diag.lap('post');
  }

  async skinCompare(world) {
    const G = this.gpu;
    if (!G || !this.instances) return null;
    const C = this.instances.constructor;
    const shot = async () => {
      if (this.shadows) this.shadows.frame = 0;
      const p = G.readNext();
      this.draw(world, G, 0);
      return p;
    };
    const keep = C.skins;
    let a,
      a2,
      b,
      batched = 0;
    try {
      C.skins = true;
      await shot();
      a = await shot();
      batched = this.instances.list.filter(p => p.skinned).reduce((n, p) => n + p.n, 0);
      a2 = await shot();
      C.skins = false;
      await shot();
      b = await shot();
    } finally {
      C.skins = keep;
    }
    const diff = (p, q) => {
      let n = 0,
        max = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        const d = Math.max(
          Math.abs(p.data[i] - q.data[i]),
          Math.abs(p.data[i + 1] - q.data[i + 1]),
          Math.abs(p.data[i + 2] - q.data[i + 2])
        );
        if (d) {
          n++;
          max = Math.max(max, d);
        }
      }
      return { differ: n, max };
    };
    window.SKIN_COMPARE = { batched: a, alone: b };
    return { size: [a.width, a.height], batchedVsBatchedAgain: diff(a, a2), batchedVsAlone: diff(a, b), batchedSkinned: batched };
  }

  async gpuCompare(world) {
    const G = this.gpu;
    if (!G) return null;
    const W = G.domElement.width,
      H = G.domElement.height;
    let gl = this.glCheck;
    if (!gl) {
      gl = this.glCheck = new THREE.WebGLRenderer({ ...glOptions(), preserveDrawingBuffer: true });
      gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    }
    gl.setPixelRatio(G.getPixelRatio());
    gl.setSize(this.width, this.height, false);
    const ctx = gl.getContext();
    const readGL = () => {
      const px = new Uint8Array(W * H * 4),
        out = new Uint8Array(W * H * 4);
      ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      for (let y = 0; y < H; y++) out.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      return { width: W, height: H, data: out };
    };
    const draw = r => {
      if (this.shadows) this.shadows.frame = 0;
      this.draw(world, r, 0);
    };
    let a, b, c;
    try {
      draw(gl);
      draw(gl);
      a = readGL();
      const shot = G.readNext();
      draw(G);
      draw(gl);
      c = readGL();
      this.post.r = this.renderer;
      b = await shot;
    } finally {
      this.post.r = this.renderer;
    }
    const diff = (p, q) => {
      let n = 0,
        max = 0,
        sum = 0;
      const hist = new Array(9).fill(0),
        img = new Uint8Array(p.data.length);
      for (let i = 0; i < p.data.length; i += 4) {
        const d = Math.max(
          Math.abs(p.data[i] - q.data[i]),
          Math.abs(p.data[i + 1] - q.data[i + 1]),
          Math.abs(p.data[i + 2] - q.data[i + 2])
        );
        img[i + 3] = 255;
        if (!d) continue;
        n++;
        sum += d;
        max = Math.max(max, d);
        hist[Math.min(8, Math.ceil(Math.log2(d + 1)))]++;
        img[i + 1] = Math.min(255, 64 + d * 4);
      }
      return {
        differ: n,
        share: +(n / (p.data.length / 4)).toFixed(5),
        max,
        mean: n ? +(sum / n).toFixed(2) : 0,
        hist: hist.join(' '),
        img
      };
    };
    const d = diff(a, b),
      dc = diff(a, c);
    window.GPU_COMPARE = { webgl: a, webgpu: b, webglAgain: c, diff: d };
    const strip = x => {
      const { img, ...rest } = x;
      return rest;
    };
    return { size: [W, H], webglVsWebgpu: strip(d), webglVsWebgl: strip(dc), unsupported: Object.fromEntries(G.unsupported) };
  }
}

const _v = new THREE.Vector3(),
  _w = { x: 0, y: 0, z: 0 },
  _s = { x: 0, y: 0, behind: false };
const _frustum = new THREE.Frustum(),
  _pm = new THREE.Matrix4(),
  _sphere = new THREE.Sphere();
const _tq = new THREE.Quaternion(),
  _up = new THREE.Vector3(0, 0, 1),
  _cv = new THREE.Vector3();
