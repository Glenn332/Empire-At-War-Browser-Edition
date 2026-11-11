import { diag } from './diag.js';
import * as THREE from 'three';
import { ChunkReader, fetchBinary } from './vfs.js';
import { loadTexture } from './dds.js';
import { gfx } from './gfx.js';
import { FRAME, PARTICLE_CAP } from './particlesim.js';

const TAU = Math.PI * 2;
const SAMPLES = 32;

function parseGroup(r, c) {
  for (const k of r.chunks(c.start, c.end)) {
    if (k.type !== 0x1101) continue;
    const p = k.start,
      f = i => r.f32(p + i * 4);
    return {
      type: r.u32(p),
      min: [f(1), f(2), f(3)],
      max: [f(4), f(5), f(6)],
      cube: f(7),
      sphereR: f(8),
      sphereEdge: r.dv.getUint8(p + 36) !== 0,
      cylR: f(10),
      cylEdge: r.dv.getUint8(p + 44) !== 0,
      cylH: f(12),
      point: [f(13), f(14), f(15)]
    };
  }
  return { type: 0, point: [0, 0, 0] };
}

export function groupSpeed(g) {
  switch (g.type) {
    case 1: {
      const m = i => (Math.abs(g.min[i]) <= Math.abs(g.max[i]) ? Math.abs(g.max[i]) : Math.abs(g.min[i]));
      return Math.hypot(m(0), m(1), m(2));
    }
    case 2:
      return Math.sqrt(3 * g.cube * g.cube);
    case 3:
      return g.sphereR;
    case 4:
    case 5:
      return Math.hypot(g.cylH, g.cylR);
    default:
      return Math.hypot(...g.point);
  }
}

function bakeTrack(start, end, interp, keys) {
  const pts = [[0, start], ...keys.sort((a, b) => a[0] - b[0]), [1, end]];
  const table = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    let k = 0;
    while (k < pts.length - 2 && t >= pts[k + 1][0]) k++;
    const [t0, v0] = pts[k],
      [t1, v1] = pts[k + 1];
    let u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    if (interp === 2) u = 0;
    else if (interp === 1) u = (1 - Math.cos(Math.PI * u)) / 2;
    table[i] = v0 + (v1 - v0) * u;
  }
  return table;
}

function parseEmitter(r, c) {
  const e = {
    name: '',
    texture: 'p_particle_master.tga',
    blend: 1,
    burst: false,
    objectSpace: false,
    radialSpeed: 0,
    accel: [0, 0, 0],
    radialAccel: 0,
    gravity: 0,
    lifetime: 2,
    nTextures: 64,
    randScale: 0,
    randLife: 0,
    index: 0,
    randRot: 0,
    randRotDir: true,
    delay: 0,
    burstDelay: 1,
    perBurst: 10,
    nBursts: 1,
    perSecond: 5,
    randColor: [0, 0, 0, 0],
    greyRand: false,
    worldOriented: false,
    skipTime: 0,
    emitMode: 0,
    heat: false,
    weather: false,
    weatherCube: 500,
    weatherFadeStart: 50,
    weatherFadeLength: 100,
    weatherOffset: 0,
    stretch: false,
    stretchFactor: 50,
    wind: false,
    windDisturb: false,
    noDepth: false,
    staticRot: false,
    inherit: false,
    inheritFraction: 1,
    linkDeath: -1,
    linkLife: -1,
    vel: { type: 0, point: [0, 0, 0] },
    pos: { type: 0, point: [0, 0, 0] },
    tracks: [],
    slave: false
  };
  const dv = r.dv;
  const trackDefaults = [255, 255, 255, 255, 5, 2, 0];
  for (const k of r.chunks(c.start, c.end)) {
    if (k.type === 0x03) e.texture = r.str(k.start, k.end).split(/[\\/]/).pop() || e.texture;
    else if (k.type === 0x16) e.name = r.str(k.start, k.end);
    else if (k.type === 0x02) {
      for (const m of r.minis(k)) {
        const p = m.start;
        switch (m.type) {
          case 0x04:
            e.blend = r.u32(p);
            break;
          case 0x07:
            e.burst = dv.getUint8(p) !== 0;
            break;
          case 0x08:
            e.objectSpace = dv.getUint8(p) !== 0;
            break;
          case 0x09:
            e.radialSpeed = r.f32(p);
            break;
          case 0x0a:
            e.accel = r.vec(p, 3);
            break;
          case 0x0b:
            e.radialAccel = r.f32(p);
            break;
          case 0x0c:
            e.gravity = r.f32(p);
            break;
          case 0x0f:
            e.lifetime = r.f32(p);
            break;
          case 0x10:
            e.nTextures = r.u32(p);
            break;
          case 0x12:
            e.randScale = r.f32(p);
            break;
          case 0x13:
            e.randLife = r.f32(p);
            break;
          case 0x14:
            e.index = r.u32(p);
            break;
          case 0x17:
            e.randRot = Math.min(1, Math.max(0, r.f32(p)));
            break;
          case 0x23:
            e.randRotDir = dv.getUint8(p) !== 0;
            break;
          case 0x24:
            e.delay = r.f32(p);
            break;
          case 0x25:
            e.burstDelay = r.f32(p);
            break;
          case 0x26:
            e.perBurst = r.u32(p);
            break;
          case 0x27:
            e.nBursts = r.u32(p);
            break;
          case 0x28:
            e.inheritFraction = r.f32(p);
            break;
          case 0x2a:
            e.perSecond = r.u32(p);
            break;
          case 0x2c:
            e.randColor = r.vec(p, 4);
            break;
          case 0x2d:
            e.greyRand = dv.getUint8(p) !== 0;
            break;
          case 0x2e:
            e.worldOriented = dv.getUint8(p) !== 0;
            break;
          case 0x33:
            e.skipTime = r.f32(p);
            break;
          case 0x31:
            e.wind = dv.getUint8(p) !== 0;
            break;
          case 0x34:
            e.emitMode = r.u32(p);
            break;
          case 0x3b:
            e.heat = dv.getUint8(p) !== 0;
            break;
          case 0x3d:
            e.weather = dv.getUint8(p) !== 0;
            break;
          case 0x3e:
            e.weatherCube = r.f32(p);
            break;
          case 0x3f:
            e.weatherFadeStart = r.f32(p);
            break;
          case 0x40:
            e.weatherFadeLength = r.f32(p);
            break;
          case 0x41:
            e.stretch = dv.getUint8(p) !== 0;
            break;
          case 0x42:
            e.stretchFactor = r.f32(p);
            break;
          case 0x47:
            e.weatherOffset = r.f32(p);
            break;
          case 0x43:
            e.inherit = dv.getUint8(p) !== 0;
            break;
          case 0x44:
            e.windDisturb = dv.getUint8(p) !== 0;
            break;
          case 0x46:
            e.noDepth = dv.getUint8(p) !== 0;
            break;
          case 0x48:
            e.staticRot = dv.getUint8(p) !== 0;
            break;
        }
      }
    } else if (k.type === 0x29) {
      const groups = [...r.chunks(k.start, k.end)].filter(g => g.type === 0x1100).map(g => parseGroup(r, g));
      if (groups[0]) e.vel = groups[0];
      if (groups[2]) e.pos = groups[2];
    } else if (k.type === 0x01) {
      const parts = [...r.chunks(k.start, k.end)];
      for (let t = 0; t * 2 + 1 < parts.length && t < 7; t++) {
        const isByte = t < 4,
          read = p => (isByte ? dv.getUint8(p) : r.f32(p));
        let start = trackDefaults[t],
          end = trackDefaults[t],
          interp = t === 5 ? 2 : 0;
        for (const m of r.minis(parts[t * 2])) {
          if (m.type === 2) start = read(m.start);
          else if (m.type === 3) end = read(m.start);
          else if (m.type === 4) interp = r.u32(m.start);
        }
        const keys = [];
        for (const m of r.minis(parts[t * 2 + 1])) if (m.type === 5 && m.size === 8) keys.push([r.f32(m.start + 4), read(m.start)]);
        e.tracks[t] = bakeTrack(start, end, interp, keys);
      }
    } else if (k.type === 0x36) {
      for (const m of r.minis(k)) {
        if (m.type === 0x37) e.linkDeath = r.i32(m.start);
        else if (m.type === 0x39) e.linkLife = r.i32(m.start);
      }
    }
  }
  for (let t = 0; t < 7; t++) e.tracks[t] ||= new Float32Array(SAMPLES).fill(trackDefaults[t]);
  if (e.weather) {
    e.pos = { type: 2, min: [0, 0, 0], max: [0, 0, 0], cube: e.weatherCube * 0.5, sphereR: 0, sphereEdge: false, cylR: 0, cylEdge: false, cylH: 0, point: [0, 0, 0] };
    e.accel = [0, 0, 0];
    e.gravity = 0;
    e.radialAccel = 0;
    e.burst = false;
    e.inherit = false;
  }
  e.maxSpeed = e.inherit ? 1000 : Math.hypot(...e.accel) + groupSpeed(e.vel) + e.gravity;
  e.grid = Math.max(1, Math.floor(Math.sqrt(e.nTextures)));
  e.interval = e.burst ? Math.max(0.001, e.burstDelay) : 1 / Math.max(1, e.perSecond);
  return e;
}

export function parseParticles(buffer) {
  const r = new ChunkReader(buffer);
  const def = { name: '', emitters: [], leave: true };
  for (const c of r.chunks()) {
    if (c.type !== 0x900) continue;
    for (const k of r.chunks(c.start, c.end)) {
      if (k.type === 0) def.name = r.str(k.start, k.end);
      else if (k.type === 2 && k.end > k.start) def.leave = r.dv.getUint8(k.start) !== 0;
      else if (k.type === 0x800) for (const e of r.chunks(k.start, k.end)) if (e.type === 0x700) def.emitters.push(parseEmitter(r, e));
    }
  }
  const byIndex = new Map(def.emitters.map(e => [e.index, e]));
  for (const e of def.emitters) {
    e.trail = e.linkLife >= 0 ? byIndex.get(e.linkLife) || null : null;
    if (e.trail) e.trail.slave = true;
    const d = e.linkDeath >= 0 ? byIndex.get(e.linkDeath) : null;
    if (d) d.slave = true;
  }
  if (!def.emitters.every(e => e.weather)) def.emitters = def.emitters.filter(e => !e.weather);
  return def.emitters.length ? def : null;
}

const defs = new Map();

const groupReach = g => {
  switch (g.type) {
    case 1:
      return Math.hypot(...g.min.map((v, i) => Math.max(Math.abs(v), Math.abs(g.max[i]))));
    case 2:
      return Math.abs(g.cube) * Math.sqrt(3);
    case 3:
      return Math.abs(g.sphereR);
    case 4:
      return Math.hypot(g.cylR, g.cylH);
    default:
      return Math.hypot(...g.point);
  }
};

export function particleReach(name) {
  let key = name.toUpperCase();
  if (!key.endsWith('.ALO')) key += '.ALO';
  const def = defs.get(key);
  if (!def || def instanceof Promise) return 0;
  if (def.reach === undefined) {
    let reach = 0;
    for (const e of def.emitters) {
      const life = e.lifetime * (1 + Math.abs(e.randLife)),
        speed = groupReach(e.vel) + Math.abs(e.radialSpeed),
        push = Math.hypot(...e.accel) + Math.abs(e.radialAccel) + Math.abs(e.gravity),
        size = Math.max(...e.tracks[4]) * (1 + Math.abs(e.randScale)) * 0.5;
      reach = Math.max(reach, groupReach(e.pos) + speed * life + 0.5 * push * life * life + size);
    }
    def.reach = Math.min(reach, 50000);
  }
  return def.reach;
}

export function loadParticles(name) {
  let key = name.toUpperCase();
  if (!key.endsWith('.ALO')) key += '.ALO';
  let d = defs.get(key);
  if (d === undefined) {
    d = fetchBinary('Data/Art/Models/' + key, { keep: false }).then(
      buf => {
        let def = null;
        try {
          def = buf ? diag.task('effect ' + key, () => parseParticles(buf)) : null;
        } catch (e) {
          console.warn('particles', key, e.message);
        }
        defs.set(key, def);
        return def;
      },
      e => {
        defs.delete(key);
        throw e;
      }
    );
    defs.set(key, d);
  }
  return d;
}

const SLOTS = 2048;
let cap = PARTICLE_CAP.def;
try {
  const v = +localStorage.getItem('swr-particle-cap');
  if (v >= PARTICLE_CAP.min && v <= PARTICLE_CAP.max) cap = v;
} catch {}
export const particleCap = () => cap;
export const setParticleCap = v => {
  cap = Math.max(PARTICLE_CAP.min, Math.min(PARTICLE_CAP.max, Math.round(v / PARTICLE_CAP.step) * PARTICLE_CAP.step));
  try {
    localStorage.setItem('swr-particle-cap', String(cap));
  } catch {}
  return cap;
};
const _frustum = new THREE.Frustum(),
  _viewProj = new THREE.Matrix4(),
  _nearAt = new THREE.Vector3(),
  _near = new THREE.Sphere();

class Batch {
  constructor(texture, additive, noDepth, heat, frames) {
    this.cap = 256;
    this.count = 0;
    this.additive = additive;
    if (heat) additive = false;
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, frames },
      vertexShader: `attribute vec4 center; attribute vec4 tint; attribute vec4 cell; attribute float slot; attribute vec4 dir;
        uniform highp sampler2D frames;
        varying vec2 vUv; varying vec4 vTint;
        void main() { vTint = tint;
          vUv = (cell.xy + vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5)) * cell.z;
          float c = cos(cell.w), s = sin(cell.w);
          vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * center.w;
          vec3 at = center.xyz;
          if (slot >= 0.0) {
            vec4 fa = texelFetch(frames, ivec2(0, int(slot + 0.5)), 0), fb = texelFetch(frames, ivec2(1, int(slot + 0.5)), 0);
            float cr = cos(fa.w), sr = sin(fa.w), co = cos(fb.x), so = sin(fb.x);
            float lx = at.x * co + at.z * so, lz = at.z * co - at.x * so;
            at = vec3(fa.x + cr * lx - sr * at.y, fa.y + sr * lx + cr * at.y, fa.z + lz);
          }
          vec4 mv = viewMatrix * vec4(at, 1.0);
          if (dir.w > 0.0) {
            vec3 v = mat3(viewMatrix) * dir.xyz;
            float sp = length(v.xy);
            if (sp > 0.0) {
              vec4 c0 = projectionMatrix * mv, c1 = projectionMatrix * vec4(mv.xyz + normalize(v) * 100.0, 1.0);
              vec2 d = (c1.xy / c1.w - c0.xy / c0.w) / vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
              float dl = length(d);
              if (dl > 0.0) {
                vec2 u = d / dl, w = vec2(u.y, -u.x);
                float a = 0.5 * (position.x + position.y), b = 0.5 * (position.y - position.x);
                corner = (-a * w - b * (b > 0.0 ? 1.0 + dir.w * sp / max(sp, 1.0) : 1.0) * u) * center.w;
              }
            }
          }
          mv.xy += corner;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: heat
        ? `uniform sampler2D map; varying vec2 vUv; varying vec4 vTint;
           void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rg, 0.0, t.a * vTint.a); }`
        : additive
          ? `uniform sampler2D map; varying vec2 vUv; varying vec4 vTint;
           void main() { vec4 t = texture2D(map, vUv) * vTint; gl_FragColor = vec4(t.rgb * t.a, 1.0); }`
          : `uniform sampler2D map; varying vec2 vUv; varying vec4 vTint;
           void main() { gl_FragColor = texture2D(map, vUv) * vTint; }`,
      transparent: true,
      depthWrite: false,
      depthTest: !noDepth && !heat,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 5 : 3;
    this.alloc();
  }
  alloc() {
    const n = this.cap,
      old = this.mesh.geometry;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name, per) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(n * per), per).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.center = mk('center', 4);
    this.tint = mk('tint', 4);
    this.cell = mk('cell', 4);
    this.slot = mk('slot', 1);
    this.dir = mk('dir', 4);
    geo.instanceCount = 0;
    this.mesh.geometry = geo;
    old.dispose();
  }
  set(count, center, tint, cell, slot, dir) {
    if (count > this.cap) {
      while (this.cap < count) this.cap *= 2;
      this.alloc();
    }
    this.count = count;
    this.mesh.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    if (!count) return;
    for (const [a, src, per] of [
      [this.center, center, 4],
      [this.tint, tint, 4],
      [this.cell, cell, 4],
      [this.slot, slot, 1],
      [this.dir, dir, 4]
    ]) {
      if (!src) continue;
      a.array.set(src);
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * per);
      a.needsUpdate = true;
    }
  }
}

class Handle {
  constructor(id, frame, slot, leave) {
    this.id = id;
    this.leave = leave;
    this.frame = frame;
    this.slot = slot;
    this.density = 1;
    this.emitting = true;
    this.released = false;
    this.dead = false;
    this.gone = false;
    this.visible = true;
    this.f = { x: 0, y: 0, z: 0, rot: 0, roll: 0, scale: 1, vx: 0, vy: 0, bright: 1, dx: 0, dy: 0, dz: 0, lr: 0, ll: 0, lt: 0 };
  }
  stop() {
    this.emitting = false;
  }
  release() {
    this.emitting = false;
    this.released = true;
    if (!this.leave) this.dead = true;
  }
}

export class ParticleManager {
  constructor(scene) {
    this.scene = scene;
    this.systems = [];
    this.batches = new Map();
    this.total = 0;
    this.heatScene = null;
    this.heatOn = false;
    this.nextId = 1;
    this.byId = new Map();
    this.sent = new Set();
    this.busy = false;
    this.owedDt = 0;
    this.wind = null;
    this.frameData = new Float32Array(SLOTS * 8);
    const tex = (this.frameTex = new THREE.DataTexture(this.frameData, 2, SLOTS, THREE.RGBAFormat, THREE.FloatType));
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.frames = { value: tex };
    this.freeSlots = [];
    for (let i = SLOTS - 1; i >= 0; i--) this.freeSlots.push(i);
    this.worker = new Worker(new URL('./particleworker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ev => this.drawn(ev.data);
    this.worker.onerror = e => console.warn('particles: the thread failed', e.message || e);
  }

  prepare(renderer, camera) {
    if (this.kept) return;
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    tex.needsUpdate = true;
    this.kept = [
      [false, false],
      [true, false],
      [false, true]
    ].map(([additive, heat]) => new Batch(tex, additive, false, heat, this.frames));
    const g = new THREE.Group();
    for (const b of this.kept) {
      b.mesh.visible = true;
      g.add(b.mesh);
    }
    renderer.compile(g, camera);
  }

  drawn(m) {
    this.busy = false;
    this.total = m.total;
    if (m.framesBuf) this.framesSpare = m.framesBuf;
    const spare = (this.spare ||= []);
    for (const o of m.batches) {
      spare.push(o.center.buffer, o.tint.buffer, o.cell.buffer, o.slot.buffer);
      if (o.dir) spare.push(o.dir.buffer);
    }
    for (const b of this.batches.values()) if (b.count) b.set(0);
    for (const o of m.batches) {
      let b = this.batches.get(o.key);
      if (!b) {
        if (!o.desc) continue;
        const d = o.desc;
        b = new Batch(loadTexture(d.texture, { repeat: false }), d.additive, d.noDepth, d.heat, this.frames);
        this.batches.set(o.key, b);
        (d.heat && this.heatScene ? this.heatScene : this.scene).add(b.mesh);
      }
      b.set(o.count, o.center, o.tint, o.cell, o.slot, o.dir);
    }
    for (const id of m.dead) {
      const h = this.byId.get(id);
      if (!h) continue;
      h.dead = true;
      h.gone = true;
      this.byId.delete(id);
      if (h.slot >= 0) this.freeSlots.push(h.slot);
    }
  }

  state(name) {
    let key = name.toUpperCase();
    if (!key.endsWith('.ALO')) key += '.ALO';
    const d = defs.get(key);
    if (d === undefined) {
      loadParticles(name);
      return 'loading';
    }
    if (d instanceof Promise) return 'loading';
    return d ? 'ready' : 'missing';
  }

  ready(name) {
    let key = name.toUpperCase();
    if (!key.endsWith('.ALO')) key += '.ALO';
    const d = defs.get(key);
    if (d === undefined) loadParticles(name);
    return !!d && !(d instanceof Promise);
  }

  spawn(name, frame, opts = {}) {
    if (!name) return null;
    let key = name.toUpperCase();
    if (!key.endsWith('.ALO')) key += '.ALO';
    const d = defs.get(key);
    if (d === undefined) {
      loadParticles(name);
      return null;
    }
    if (!d || d instanceof Promise) return null;
    if (!this.sent.has(key)) {
      this.sent.add(key);
      this.worker.postMessage({ type: 'def', key, def: d });
    }
    const h = new Handle(this.nextId++, frame, this.freeSlots.length ? this.freeSlots.pop() : -1, d.leave !== false);
    frame(h.f);
    this.writeFrame(h);
    this.worker.postMessage({
      type: 'create',
      id: h.id,
      key,
      f: h.f,
      heatOn: this.heatOn,
      opts: {
        points: opts.points || null,
        basis: opts.basis || null,
        scale: opts.scale || 1,
        maxEmit: opts.maxEmit ?? Infinity,
        slot: h.slot
      }
    });
    this.byId.set(h.id, h);
    this.systems.push(h);
    return h;
  }

  writeFrame(h) {
    if (h.slot < 0) return;
    const d = this.frameData,
      i = h.slot * 8,
      f = h.f;
    d[i] = f.x;
    d[i + 1] = f.y;
    d[i + 2] = f.z;
    d[i + 3] = f.rot;
    d[i + 4] = f.roll || 0;
  }

  burst(name, x, y, z, scale = 1, maxEmit = 2.5) {
    return this.spawn(
      name,
      f => {
        f.x = x;
        f.y = y;
        f.z = z;
        f.rot = 0;
        f.scale = 1;
        f.vx = f.vy = 0;
      },
      { scale, maxEmit }
    );
  }

  update(dt, camera = null) {
    const list = this.systems;
    if (camera) _frustum.setFromProjectionMatrix(_viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const send = !this.busy && (dt > 0 || this.owedDt > 0);
    const need = list.length * FRAME;
    let frames = null;
    if (send) {
      const fb = this.framesSpare;
      frames =
        fb && fb.byteLength >= need * 4
          ? new Float32Array(fb, 0, need)
          : new Float32Array(new ArrayBuffer(Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, need * 4))))), 0, need);
      this.framesSpare = null;
    }
    let n = 0,
      k = 0;
    for (const h of list) {
      if (h.gone) continue;
      if (!h.dead && !h.released) h.visible = h.frame(h.f) !== false;
      if (h.dead && !h.killed) {
        if (!send) {
          list[n++] = h;
          continue;
        }
        h.killed = true;
      }
      const f = h.f;
      this.writeFrame(h);
      if (send) {
        frames[k] = h.id;
        frames[k + 1] = f.x;
        frames[k + 2] = f.y;
        frames[k + 3] = f.z;
        frames[k + 4] = f.rot;
        frames[k + 5] = f.roll || 0;
        frames[k + 6] = f.scale;
        frames[k + 7] = f.vx;
        frames[k + 8] = f.vy;
        frames[k + 9] = h.visible ? 1 : 0;
        frames[k + 10] = h.density;
        frames[k + 11] = h.emitting ? 1 : 0;
        frames[k + 12] = h.killed ? 1 : 0;
        frames[k + 13] = f.bright ?? 1;
        frames[k + 14] = f.dx || 0;
        frames[k + 15] = f.dy || 0;
        frames[k + 16] = f.dz || 0;
        frames[k + 17] = f.lr || 0;
        frames[k + 18] = f.ll || 0;
        frames[k + 19] = f.lt || 0;
        frames[k + 20] = f.vz || 0;
        frames[k + 21] = !camera || _frustum.intersectsSphere(_near.set(_nearAt.set(f.x, f.y, f.z), 400)) ? 1 : 0;
        frames[k + 22] = f.energy ?? 1;
        k += FRAME;
      }
      list[n++] = h;
    }
    list.length = n;
    this.frameTex.needsUpdate = true;
    this.owedDt = Math.min(0.25, this.owedDt + dt);
    if (send) {
      this.busy = true;
      const free = this.spare || [];
      this.spare = [];
      this.worker.postMessage(
        {
          type: 'step',
          dt: this.owedDt,
          frames: frames.subarray(0, k),
          detail: Math.max(0.1, Math.min(1, +gfx.particle)),
          cap,
          wind: this.wind && this.wind.length ? Float32Array.from(this.wind) : null,
          heatOn: this.heatOn,
          heatScene: !!this.heatScene,
          free
        },
        [frames.buffer, ...free]
      );
      this.owedDt = 0;
    }
  }
}
