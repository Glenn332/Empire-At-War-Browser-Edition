import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadTexture } from '../dds.js';
import { ParticleManager } from '../particles.js';
import { ROUTE_VERT, ROUTE_FRAG, routeAxes } from './galacticroutes.js';

const type = p => p.currentCorruption ?? -1;
const active = p => type(p) !== -1 || !!p.corruptionKind;
const lerp = (a, b, t) => a + (b - a) * t;

export class CorruptionVisuals {
  constructor(game) {
    this.game = game; this.glow = new Map(); this.funnels = new Map(); this.paths = new Map();
    this.glowManager = null; this.lineManager = null;
    const C = db.constants;
    this.brightness = C.vec('Particle_Brightness_Per_Corruption_Level', [1, 1]); this.scales = C.vec('Particle_Scale_Per_Corruption_Level', [1, 1]);
    this.radius = C.num('Corruption_Line_Radius', 12.5); this.offset = C.num('Corruption_Line_Start_End_Offset', 18); this.grow = C.num('Corruption_Line_Grow_Seconds', 7);
    this.color = C.vec('Corruption_Path_Color', [36, 36, 0, 255]); this.width = C.num('Corruption_Path_Width', 16);
    this.texture = C.str('Fleet_Hyperspace_Band_Texture_Name') || 'w_galaxy_line.tga';
    this.glowFile = db.type(C.str('Corruption_Particle_Name').trim())?.str('Galactic_Model_Name') || '';
    this.lineFile = db.type(C.str('Corruption_Particle_Line_Name').trim())?.str('Galactic_Model_Name') || '';
  }

  pick(list, t) { return list[t === -1 ? 0 : 1] ?? list[0] ?? 1; }

  progress(p) {
    const g = this.game.galaxy;
    if (!p.corruptionKind || !(p.corruptionEnd > p.corruptionStart)) return 1;
    return Math.max(0, Math.min(1, ((g.time || 0) - p.corruptionStart) / (p.corruptionEnd - p.corruptionStart)));
  }

  update(dt) {
    const g = this.game.galaxy;
    if (!g) return;
    const want = g.planets.some(p => !p.background && active(p));
    if (!want && !this.glow.size && !this.funnels.size && !this.paths.size) return;
    if (want && !this.glowManager && this.glowFile) { this.glowManager = new ParticleManager(this.game.midgroundScene); this.lineManager = new ParticleManager(this.game.midforegroundScene); }
    this.updateGlows(g);
    this.updateLanes(g, dt);
    this.glowManager?.update(dt); this.lineManager?.update(dt);
  }

  updateGlows(g) {
    for (const p of g.planets) {
      if (p.background) continue;
      const on = active(p), have = this.glow.get(p.index);
      if (!on) { if (have) { have.stop?.(); have.dead = true; this.glow.delete(p.index); } continue; }
      if (have && !have.dead) continue;
      if (!this.glowManager) continue;
      const handle = this.glowManager.spawn(this.glowFile, f => {
        const now = type(p), target = p.corruptionKind ? p.corruptionPending ?? -1 : now, t = this.progress(p);
        f.x = p.pos[0]; f.y = p.pos[1]; f.z = p.pos[2]; f.rot = 0; f.vx = f.vy = 0;
        f.bright = lerp(this.pick(this.brightness, now), this.pick(this.brightness, target), t);
        f.scale = lerp(this.pick(this.scales, now), this.pick(this.scales, target), t);
      });
      if (handle) this.glow.set(p.index, handle);
    }
  }

  updateLanes(g, dt) {
    const wanted = new Set();
    for (let i = 0; i < g.planets.length; i++) {
      const a = g.planets[i];
      if (a.background || !active(a)) continue;
      for (const l of g.links[i] || []) {
        const j = l.to, b = g.planets[j];
        if (j < i || b.background || !active(b)) continue;
        const key = i + ':' + j;
        wanted.add('p' + key);
        this.path(g, key, a, b);
        if (type(a) !== -1 && type(b) !== -1 && (this.funnels.has(key) || (!a.corruptionKind && !b.corruptionKind))) { wanted.add('f' + key); this.funnel(g, key, a, b, dt); }
      }
    }
    for (const [key, f] of this.funnels) if (!wanted.has('f' + key)) { f.handle?.stop?.(); if (f.handle) f.handle.dead = true; this.funnels.delete(key); }
    for (const [key, m] of this.paths) if (!wanted.has('p' + key)) { this.game.scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); this.paths.delete(key); }
  }

  funnel(g, key, a, b, dt) {
    let f = this.funnels.get(key);
    if (!f) this.funnels.set(key, f = { t: 0, handle: null });
    f.t = Math.min(1, f.t + dt / Math.max(0.001, this.grow));
    if (!f.handle || f.handle.dead) {
      if (!this.lineManager || !this.lineFile) return;
      const A = a.pos, B = b.pos, d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], dist = Math.hypot(...d) || 1, u = d.map(v => v / dist);
      f.handle = this.lineManager.spawn(this.lineFile, o => {
        o.x = A[0] + u[0] * this.offset; o.y = A[1] + u[1] * this.offset; o.z = A[2] + u[2] * this.offset; o.rot = 0; o.scale = 1; o.vx = o.vy = 0;
        o.dx = u[0]; o.dy = u[1]; o.dz = u[2]; o.lr = this.radius; o.ll = Math.max(0, dist - 2 * this.offset); o.lt = f.t;
      });
    }
  }

  path(g, key, a, b) {
    let m = this.paths.get(key);
    if (!m) {
      const o = db.constants.vec('Corruption_Path_Offset', [0, 0, 0]), A = a.pos.map((v, i) => v + (o[i] || 0)), B = b.pos.map((v, i) => v + (o[i] || 0)), axes = routeAxes(A, B), geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...A, ...B, ...B], 3));
      geo.setAttribute('side', new THREE.Float32BufferAttribute([-1, 1, -1, 1], 1));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([1, 1, 0, 1, 1, 0, 0, 0], 2));
      geo.setIndex([0, 1, 2, 1, 3, 2]);
      const mat = new THREE.ShaderMaterial({
        vertexShader: ROUTE_VERT, fragmentShader: ROUTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { map: { value: loadTexture(this.texture, { repeat: false }) }, color: { value: new THREE.Color() }, opacity: { value: 1 }, width: { value: this.width }, across: { value: new THREE.Vector3(...axes.across) } },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 3;
      this.game.scene.add(mesh);
      this.paths.set(key, m = { mesh });
    }
    let fade = 1;
    for (const p of [a, b]) {
      if (p.corruptionKind === 'corrupt' && type(p) === -1) fade = Math.min(fade, this.progress(p));
      else if (p.corruptionKind === 'remove' && type(p) !== -1) fade = Math.min(fade, 1 - this.progress(p));
    }
    m.mesh.material.uniforms.color.value.setRGB(this.color[0] / 255 * fade, this.color[1] / 255 * fade, this.color[2] / 255 * fade);
  }

  dispose() {
    for (const h of this.glow.values()) h.dead = true;
    for (const f of this.funnels.values()) if (f.handle) f.handle.dead = true;
    for (const m of this.paths.values()) { this.game.scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); }
    this.glow.clear(); this.funnels.clear(); this.paths.clear();
    this.glowManager?.worker.terminate(); this.lineManager?.worker.terminate();
  }
}
