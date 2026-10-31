import * as THREE from 'three';
import { db } from '../gamedata.js';
import { Bolts } from './landbolts.js';
import { loadLandTables } from './landtables.js';

const DOTS = [0.45, 0.7, 0.5, 0.89],
  PERIOD = 50 / 30,
  DOT = 3.5,
  MAX = 32;
const _c = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _s = new THREE.Vector3();

export class TractorBeams {
  constructor(scene) {
    this.lightning = new Bolts(scene);
    this.defs = null;
    loadLandTables()
      .then(t => (this.defs = t.lightning))
      .catch(() => {});
    const C = db.constants,
      rgb = C.str('Tractor_Beam_Color')
        .split(',')
        .map(parseFloat)
        .filter(Number.isFinite);
    this.width = C.num('Tractor_Beam_Width', 10) || 10;
    this.color = rgb.length >= 3 ? rgb.slice(0, 3).map(v => Math.min(1, Math.max(0, v / 255))) : [1, 1, 1];
    this.pos = new Float32Array(MAX * 12);
    this.col = new Float32Array(MAX * 16);
    const uv = new Float32Array(MAX * 8),
      index = new Uint32Array(MAX * 6);
    for (let i = 0; i < MAX; i++) {
      uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, this.lightning.material(C.str('Tractor_Beam_Texture').trim() || 'tractor_beam00.tga'));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.time = 0;
    this.arcs = new Map();
  }

  update(dt, beams, camera, sprites) {
    this.time += dt;
    camera.getWorldPosition(_c);
    const [r, g, b] = this.color,
      hw = this.width / 2,
      P = this.pos,
      seen = new Set();
    let q = 0;
    for (const B of beams) {
      const a = B.from,
        t = B.to;
      _d.subVectors(t, a);
      if (q < MAX) {
        _s.subVectors(_c, a).cross(_d).normalize().multiplyScalar(hw);
        P.set([a.x + _s.x, a.y + _s.y, a.z + _s.z, a.x - _s.x, a.y - _s.y, a.z - _s.z], q * 12);
        P.set([t.x + _s.x, t.y + _s.y, t.z + _s.z, t.x - _s.x, t.y - _s.y, t.z - _s.z], q * 12 + 6);
        for (let v = 0; v < 4; v++) this.col.set([r, g, b, 1], q * 16 + v * 4);
        q++;
      }
      for (const off of DOTS) {
        const f = 1 - ((((this.time / PERIOD + off) % 1) + 1) % 1);
        sprites.add(a.x + _d.x * f, a.y + _d.y * f, a.z + _d.z * f, DOT / 2, Math.min(1, r * 0.7), Math.min(1, g * 0.7), Math.min(1, b * 0.7), 1);
      }
      const key = B.a.id + '>' + B.b.id;
      seen.add(key);
      let arc = this.arcs.get(key);
      if (!arc) this.arcs.set(key, (arc = { a: B.a, b: B.b, effect: 'Tractor_Beam', until: Infinity, from: new THREE.Vector3(), to: new THREE.Vector3() }));
      arc.from.copy(a);
      arc.to.copy(t);
    }
    for (const k of this.arcs.keys()) if (!seen.has(k)) this.arcs.delete(k);
    this.geo.setDrawRange(0, q * 6);
    if (q) this.geo.attributes.position.needsUpdate = this.geo.attributes.color.needsUpdate = true;
    this.mesh.visible = q > 0;
    if (this.defs) this.lightning.update(dt, { bolts: [...this.arcs.values()], time: 0, look: null }, this.defs, camera);
  }
}
