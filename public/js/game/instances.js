import * as THREE from 'three';
import { instanceable, skinBatchable } from '../model.js';

const ROW = 24 * 4;

const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sphere = new THREE.Sphere(), _inv = new THREE.Matrix4();
const _chain = [];

function placeBranch(root, node) {
  _chain.length = 0;
  for (let o = node.parent; o !== root; o = o.parent) { if (!o) return false; _chain.push(o); }
  for (let i = _chain.length - 1; i >= 0; i--) {
    const o = _chain[i];
    if (o.matrixAutoUpdate) o.updateMatrix();
    if (o.matrixWorldAutoUpdate === true) o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
  }
  node.updateWorldMatrix(false, true);
  return true;
}
const HIDDEN = 1;

export class Instances {
  static check = false;
  static mismatches = 0;
  static checked = 0;
  static skins = true;

  constructor(scene) {
    this.scene = scene;
    this.pools = new Map();
    this.list = [];
    this.units = new Set();
    this.taken = new WeakSet();
    this.known = new WeakSet();
    this.stamp = 0;
    this.drawn = 0;
    this.put = [];
    this.gpu = null;
    this.camera = null;
  }

  poolFor(mesh, skinned = false) {
    let byGeo = this.pools.get(mesh.material);
    if (!byGeo) this.pools.set(mesh.material, (byGeo = new Map()));
    let p = byGeo.get(mesh.geometry);
    if (!p) {
      let mat = mesh.material;
      if (skinned) {
        mat = mesh.material.clone();
        mat.defines = { ...mesh.material.defines, INSTSKIN: 1 };
        const tex = new THREE.DataTexture(new Float32Array(ROW * 4), ROW, 1, THREE.RGBAFormat, THREE.FloatType);
        mat.uniforms = { ...mesh.material.uniforms, boneTex: { value: tex } };
      }
      p = { src: mesh.geometry, mat, skinned, rows: skinned ? [] : null, ready: !skinned, order: mesh.renderOrder, n: 0, cap: 0, im: null, tint: null };
      this.size(p, 8);
      byGeo.set(mesh.geometry, p);
      this.list.push(p);
      if (skinned) {
        const im = p.im;
        im.count = 1; im.visible = true;
        Promise.resolve(this.gpu.compileAsync(im, this.camera)).catch(() => {}).then(() => { p.ready = true; });
        im.visible = false; im.count = 0;
      }
    }
    return p;
  }

  size(p, cap) {
    const old = p.im, oldTint = p.tint;
    const geo = new THREE.BufferGeometry();
    for (const k in p.src.attributes) geo.setAttribute(k, p.src.attributes[k]);
    geo.setIndex(p.src.index);
    for (const g of p.src.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.boundingSphere = p.src.boundingSphere; geo.boundingBox = p.src.boundingBox;
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    tint.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instanceTint', tint);
    const im = new THREE.InstancedMesh(geo, p.mat, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false; im.matrixAutoUpdate = false; im.renderOrder = p.order; im.count = 0; im.visible = false;
    if (old) {
      im.instanceMatrix.array.set(old.instanceMatrix.array);
      tint.array.set(oldTint.array);
      this.scene.remove(old);
      for (const k in old.geometry.attributes) if (k !== 'instanceTint') old.geometry.deleteAttribute(k);
      old.geometry.setIndex(null);
      old.geometry.dispose(); old.dispose();
    }
    this.scene.add(im);
    p.im = im; p.tint = tint; p.cap = cap;
  }

  scan(u) {
    const list = u.instList || (u.instList = []);
    const obj = u.obj, before = list.length;
    obj.userData.ship = true;
    obj.updateWorldMatrix(true, true);
    _inv.copy(obj.matrixWorld).invert();
    for (const e of list) e.local.multiplyMatrices(_inv, e.mesh.matrixWorld);
    let skins = null;
    obj.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || this.known.has(o)) return;
      this.known.add(o);
      const e = { mesh: o, mat: o.material, pool: null, skin: null, local: new THREE.Matrix4().multiplyMatrices(_inv, o.matrixWorld) };
      if (instanceable.has(o.material)) { e.pool = this.poolFor(o); this.taken.add(o); o.layers.set(HIDDEN); }
      else if (this.gpu && skinBatchable.has(o.material)) {
        skins ||= new Map([u.model, ...u.hardpoints.map(h => h.model)].flatMap(m => (m && m.skins ? m.skins.map(s => [s.mesh, s]) : [])));
        const skin = skins.get(o);
        if (skin) { e.skin = skin; e.pool = this.poolFor(o, true); }
      }
      list.push(e);
    });
    if (list.length !== before) u.instWarm = 4;
    u.instTurretsOnly = !!u.model && !!u.model.flat && u.model.billboards.length === 0
      && !u.hardpoints.some(h => h.model && (!h.model.flat || h.model.billboards.length > 0));
    u.instMoves = !u.instTurretsOnly || u.turrets.length > 0;
    u.instPosed = -1;
    this.units.add(u);
    return list;
  }

  release(u) {
    for (const e of u.instList || []) { if (e.pool) { e.mesh.layers.set(0); this.taken.delete(e.mesh); } this.known.delete(e.mesh); }
    for (const e of u.instList || []) if (e.skin) e.mesh.layers.set(0);
    u.instList = null;
    this.units.delete(u);
    u.obj.userData.ship = false;
  }

  collect(units, cam) {
    const stamp = ++this.stamp, scene = this.scene, put = this.put;
    _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const p of this.list) p.n = 0;
    let drawn = 0;
    for (const u of units) {
      if (u.dead || !u.obj) continue;
      const obj = u.obj;
      let list = u.instList;
      if (!list || ((u.id + stamp) & 63) === 0) list = this.scan(u);
      u.instStamp = stamp;
      if (!obj.visible) continue;
      let pose = -1;
      if (u.instTurretsOnly && u.turrets.length) { pose = 0; for (const t of u.turrets) pose += t.inst.poseVersion; }
      const posed = pose >= 0 && pose === u.instPosed;
      const whole = (u.instMoves && !posed) || u.instWarm > 0 || obj.parent !== scene || !!u.anim || !!u.buildAnim || !!u.construction
        || u.pendingProxies.length > 0;
      if (u.instWarm > 0) u.instWarm--;
      _sphere.center.set(u.x, u.y, u.z || 0); _sphere.radius = (u.visualRadius || 50) * 2.5;
      const inView = _frustum.intersectsSphere(_sphere);
      if (!inView && !u.casters) { obj.visible = false; put.push(obj); continue; }
      if (whole) obj.updateWorldMatrix(obj.parent !== scene, true);
      else obj.matrixWorld.copy(obj.matrix);
      if (!inView) continue;
      let tr = 0, tg = 0, tb = 0, ta = 0;
      if (u.hyper) ta = Math.max(0, Math.min(1, u.hyper.dark ?? 1));
      else if (u.haze && u.haze.color.w > 0) { const c = u.haze.color; tr = c.x; tg = c.y; tb = c.z; ta = c.w; }
      const world = obj.matrixWorld;
      if (whole && pose >= 0) {
        _inv.copy(world).invert();
        for (let i = 0; i < list.length; i++) list[i].local.multiplyMatrices(_inv, list[i].mesh.matrixWorld);
        u.instPosed = pose;
      }
      let rest = 0;
      for (let i = 0; i < list.length; i++) {
        const e = list[i], m = e.mesh;
        if (e.pool && (m.material !== e.mat || m.geometry !== e.pool.src)) { m.layers.set(0); this.taken.delete(m); e.pool = null; e.skin = null; }
        if (e.skin) {
          const go = Instances.skins && !!this.gpu && e.pool.ready && !!e.skin.mats;
          if (go !== this.taken.has(m)) { if (go) { this.taken.add(m); m.layers.set(HIDDEN); } else { this.taken.delete(m); m.layers.set(0); } }
        }
        let o = m;
        while (o && o !== obj && o.visible) o = o.parent;
        if (o !== obj) continue;
        if (!whole) m.matrixWorld.multiplyMatrices(world, e.local);
        const p = e.pool;
        if (!p || (e.skin && !this.taken.has(m))) { rest++; continue; }
        if (p.n === p.cap) this.size(p, p.cap * 2);
        const a = p.im.instanceMatrix.array, me = m.matrixWorld.elements, at = p.n * 16;
        for (let k = 0; k < 16; k++) a[at + k] = me[k];
        if (e.skin) p.rows[p.n] = e.skin.mats;
        const t = p.tint.array, tt = p.n * 4;
        t[tt] = tr; t[tt + 1] = tg; t[tt + 2] = tb; t[tt + 3] = ta;
        p.n++; drawn++;
      }
      const shield = u.shieldMesh;
      if (!whole && shield && shield.visible && u.shieldFlash > 0) {
        if (!placeBranch(obj, shield)) obj.updateWorldMatrix(false, true);
        else if (Instances.check) {
          const mine = [];
          shield.traverse(o => mine.push(o.matrixWorld.elements.slice()));
          obj.updateWorldMatrix(false, true);
          let k = 0;
          shield.traverse(o => { const a = mine[k++], b = o.matrixWorld.elements; Instances.checked++; if (a.some((v, j) => v !== b[j])) Instances.mismatches++; });
        }
      }
      if (!whole && !rest) { obj.visible = false; put.push(obj); }
    }
    for (const u of this.units) if (u.instStamp !== stamp) this.release(u);
    for (const p of this.list) {
      const im = p.im;
      im.count = p.n; im.visible = p.n > 0;
      if (!p.n) continue;
      if (p.skinned) p.mat.uniforms.boneTex.value.userData.rows = p.rows;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, p.n * 16); im.instanceMatrix.needsUpdate = true;
      p.tint.clearUpdateRanges(); p.tint.addUpdateRange(0, p.n * 4); p.tint.needsUpdate = true;
    }
    this.drawn = drawn;
  }

  prepare(renderer, camera) {
    const idle = this.list.filter(p => !p.im.visible);
    for (const p of idle) p.im.visible = true;
    try { renderer.compile(this.scene, camera); } finally { for (const p of idle) p.im.visible = false; }
  }

  restore() {
    for (const o of this.put) o.visible = true;
    this.put.length = 0;
  }
}
