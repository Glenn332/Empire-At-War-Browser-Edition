import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadTexture } from '../dds.js';
import { lighting } from '../model.js';
import { heightAt, CELL } from './terrain.js';

const MAX = 2400,
  SHEET = 4;
const STRIPS = ['w_tank_track_01.tga', 'w_footprint00.tga', 'w_r2d2_tracks.tga', 'Trk_Dirt.tga', 'Trk_Grass.tga'];

const VERT = `
  attribute vec4 uvRect; attribute vec3 look;
  varying vec2 vUv; varying vec3 vLook; varying vec3 vT, vB, vN; varying float vFlip;
  void main() {
    vUv = uvRect.xy + uv * uvRect.zw; vLook = look; vFlip = sign(uvRect.w);
    mat3 m = mat3(instanceMatrix);
    vT = normalize(m[0]); vB = normalize(m[1]); vN = normalize(cross(m[0], m[1]));
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const FRAG = `
  uniform sampler2D sheet, strip0, strip1, strip2, strip3, strip4; uniform vec3 sunDir;
  varying vec2 vUv; varying vec3 vLook; varying vec3 vT, vB, vN; varying float vFlip;
  void main() {
    vec4 t; bool strip = vLook.z > 0.5;
    if (!strip) t = texture2D(sheet, vUv);
    else if (vLook.z < 1.5) t = texture2D(strip0, vUv.yx);
    else if (vLook.z < 2.5) t = texture2D(strip1, vUv.yx);
    else if (vLook.z < 3.5) t = texture2D(strip2, vUv.yx);
    else if (vLook.z < 4.5) t = texture2D(strip3, vUv.yx);
    else t = texture2D(strip4, vUv.yx);
    float a = t.a * vLook.x, f;
    if (vLook.y > 0.5) {
      vec3 n = t.xyz * 2.0 - 1.0;
      if (strip) n = vec3(n.y, n.x, n.z); else n.xy *= vec2(-1.0, -vFlip);
      float dent = clamp(length(n.xy) * 2.5, 0.0, 1.0);
      vec3 N = normalize(vT * n.x + vB * n.y + vN * n.z);
      f = clamp(dot(N, sunDir) / max(0.25, dot(vN, sunDir)), 0.0, 2.0);
      a *= strip ? dent : 1.0;
      f = mix(1.0, f * 0.92, a);
    } else f = mix(1.0, 0.1, a);
    if (abs(f - 1.0) < 0.004) discard;
    gl_FragColor = vec4(vec3(f * 0.5), 1.0);
  }`;

export function groundKind(world, x, y) {
  const T = world.terrain,
    n = T.size,
    i = Math.min(n - 1, Math.max(0, Math.round(y / CELL))) * n + Math.min(n - 1, Math.max(0, Math.round(x / CELL)));
  if (world.wet && world.wet[i]) return 'water';
  if (T.water && T.water.on && T.heights[i] < T.water.level) return 'water';
  const L = T.layers[T.layerIndex[i]],
    name = L ? L.texture : '';
  return /snow|ice/i.test(name)
    ? 'snow'
    : /grass|temperate|swamp|jungle|forest|felucia|endr|moss/i.test(name)
      ? 'grass'
      : /concrete|urban|street|kamino|metal|asphalt|wall|bespin|goodground/i.test(name)
        ? 'concrete'
        : 'dirt';
}

const _v = new THREE.Vector3();

export class Decals {
  constructor(world, scene) {
    this.world = world;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.uvRect = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    geo.setAttribute('uvRect', this.uvRect);
    geo.setAttribute('look', this.look);
    const strips = Object.fromEntries(STRIPS.map((n, i) => ['strip' + i, { value: loadTexture(n) }]));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.SrcColorFactor,
      uniforms: { sheet: { value: loadTexture('D_MASTER_DECAL.dds', { repeat: false }) }, sunDir: lighting.sunDir, ...strips }
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.marks = [];
    this.trails = [];
    this.next = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.qz = new THREE.Quaternion();
    this.up = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.p = new THREE.Vector3();
    this.Z = new THREE.Vector3(0, 0, 1);
    this.stepAt = 0;
    this.lastTime = world.time;
  }

  put(x, y, w, h, angle, { uv, strength, bump, tex = 0 }, fade) {
    const T = this.world.terrain,
      i = this.next;
    this.next = (this.next + 1) % MAX;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    const d = Math.max(4, Math.min(w, h) * 0.35);
    const gx = (heightAt(T, x + d, y) - heightAt(T, x - d, y)) / (2 * d),
      gy = (heightAt(T, x, y + d) - heightAt(T, x, y - d)) / (2 * d);
    this.up.set(-gx, -gy, 1).normalize();
    this.q.setFromUnitVectors(this.Z, this.up).multiply(this.qz.setFromAxisAngle(this.Z, angle));
    this.mesh.setMatrixAt(i, this.m.compose(this.p.set(x, y, heightAt(T, x, y) + 0.35), this.q, this.s.set(w, h, 1)));
    this.uvRect.setXYZW(i, uv[0], uv[1], uv[2], uv[3]);
    this.look.setXYZ(i, strength, bump ? 1 : 0, tex);
    this.marks[i] = { strength, ...fade };
    this.mesh.instanceMatrix.needsUpdate = this.uvRect.needsUpdate = this.look.needsUpdate = true;
  }

  stamp(name, x, y, heading = 0) {
    const d = this.world.tables && this.world.tables.decals.get(String(name || '').toUpperCase());
    if (!d || d.additive) return;
    const [c, r] = d.slots[Math.floor(Math.random() * d.slots.length)],
      k = 1 + (Math.random() * 2 - 1) * d.vary,
      e = d.span / SHEET;
    this.put(
      x,
      y,
      d.w * k,
      d.h * k,
      d.spin ? Math.random() * Math.PI * 2 : heading - Math.PI / 2,
      { uv: [c / SHEET, r / SHEET + e, e, -e], strength: d.strength, bump: d.bump },
      { born: this.world.time, seconds: d.seconds, keeps: d.keeps }
    );
  }

  surface(group, x, y, heading = 0) {
    const g = this.world.tables && this.world.tables.surface.get(String(group || '').toUpperCase());
    if (!g) return null;
    const e = g.get(groundKind(this.world, x, y)) || g.get('default');
    if (e && e.decal) this.stamp(e.decal, x, y, heading);
    return e || null;
  }

  update() {
    const now = this.world.time,
      dt = Math.max(0, now - this.lastTime);
    this.lastTime = now;
    for (const S of this.trails) S.odo += S.rate * dt;
    let dirty = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const m = this.marks[i];
      if (!m || m.keeps || m.gone) continue;
      const k = m.trail ? (m.trail.odo - m.at - m.from) / Math.max(1, m.to - m.from) : ((now - m.born) / Math.max(1, m.seconds)) * 2 - 1;
      const a = k >= 1 ? 0 : m.strength * (1 - Math.max(0, k));
      if (Math.abs(a - this.look.getX(i)) > 0.01 || k >= 1) {
        this.look.setX(i, a);
        dirty = true;
        if (k >= 1) m.gone = true;
      }
    }
    if (dirty) this.look.needsUpdate = true;
  }

  trail(units, look, audio, fx) {
    const tabs = this.world.tables,
      w = this.world;
    if (!tabs || !tabs.tracks) return;
    for (const u of units) {
      if (u.dead && !u.anim) continue;
      if (u.structure || u.inside || u.flies || u.bomber || u.seen === false) continue;
      if (look && (u.x - look.x) ** 2 + (u.y - look.y) ** 2 > look.r * look.r) {
        u.evAnim = null;
        if (u.markAt) {
          u.markAt[0] = u.x;
          u.markAt[1] = u.y;
        }
        continue;
      }
      this.events(u, tabs, audio, fx);
      if (u.dead) continue;
      if (u.tracks === undefined) {
        u.tracks = null;
        u.markAt = [u.x, u.y];
        for (const name of u.type.list('SurfaceFX_Name')) {
          const g = tabs.surface.get(name.toUpperCase());
          if (!g || ![...g.values()].some(e => e.track)) continue;
          const bones = (g.bones || []).map(b => u.inst.bone(b)).filter(Boolean);
          u.tracks = { g, bones, gone: 0, S: { odo: 0, rate: 10 }, scale: u.holder.scale.x };
          this.trails.push(u.tracks.S);
          break;
        }
      }
      const M = u.tracks;
      if (!M) continue;
      const moved = Math.hypot(u.x - u.markAt[0], u.y - u.markAt[1]);
      if (moved < 0.3) continue;
      M.S.odo += moved;
      M.gone += moved;
      u.markAt[0] = u.x;
      u.markAt[1] = u.y;
      const e = M.g.get(groundKind(w, u.x, u.y)) || M.g.get('default'),
        def = e && e.track ? tabs.tracks.get(e.track.toUpperCase()) : null;
      if (!def) {
        M.gone = 0;
        continue;
      }
      M.S.rate = def.rate;
      if (M.gone < def.segment) continue;
      const tex =
          Math.max(
            0,
            STRIPS.findIndex(n => n.toUpperCase() === def.texture.toUpperCase())
          ) + 1,
        len = M.gone;
      M.gone = 0;
      const lay = (x, y) =>
        this.put(
          x - (Math.cos(u.heading) * len) / 2,
          y - (Math.sin(u.heading) * len) / 2,
          len * 1.04,
          def.width * M.scale,
          u.heading,
          { uv: [0, 0, 1, 1], strength: def.opacity, bump: def.bump, tex },
          { trail: M.S, at: M.S.odo, from: def.from, to: def.to }
        );
      if (M.bones.length)
        for (const b of M.bones) {
          b.getWorldPosition(_v);
          lay(_v.x, _v.y);
        }
      else lay(u.x, u.y);
    }
  }

  events(u, tabs, audio, fx) {
    const A = u.anim,
      list = A && A.anim && A.anim.name ? tabs.animEvents.get(A.anim.name) : null;
    if (!list) {
      u.evAnim = null;
      return;
    }
    const t = A.time,
      fresh = u.evAnim !== A;
    const t0 = fresh ? -1 : u.evT;
    u.evAnim = A;
    u.evT = t;
    if (fresh && t > 0.3) return;
    for (const ev of list) {
      const due = t >= t0 ? ev.t > t0 && ev.t <= t : ev.t > t0 || ev.t <= t;
      if (!due) continue;
      let x = u.x,
        y = u.y;
      const b = ev.bone && u.inst.bone(ev.bone);
      if (b) {
        b.getWorldPosition(_v);
        x = _v.x;
        y = _v.y;
      }
      if (ev.sound) {
        if (audio) audio.play(ev.sound, x, y);
        continue;
      }
      const e = this.surface(ev.surface, x, y, u.heading);
      if (!e) continue;
      if (e.sound && audio && (!u.foot || (this.stepAt = this.stepAt + 1) % 5 === 0)) audio.play(e.sound, x, y);
      if (e.particle && fx && !u.foot) fx(e.particle, x, y);
    }
  }
}

export function scorch(decals, particleType, x, y) {
  const t = db.type(particleType),
    mark = t && t.str('Explosion_Scorch_Mark');
  if (mark) decals.surface(mark, x, y);
}
