import * as THREE from 'three';
import { skinBatchable, instanceable } from '../model.js';
import { placeCached } from './posecache.js';

const HIDDEN = 1;
const ROW = 24 * 4;
const FAR2 = 700 * 700;
export const POSE_MARGIN = 150;
const DRAW_MARGIN = 40;
const FIRSTS = 8;

const stand = new WeakMap();
export function shaderScene(scene) {
  let t = stand.get(scene);
  if (!t) stand.set(scene, (t = new THREE.Scene()));
  t.fog = scene.fog; t.environment = scene.environment;
  return t;
}

const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _ball = new THREE.Sphere();

export function viewTest(camera) {
  _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_pv);
  const ball = (x, y, z, r) => { _ball.center.set(x, y, z); _ball.radius = r; return _frustum.intersectsSphere(_ball); };
  const see = (u, margin) => {
    const r = (u.inst ? u.inst.radius : 10) * (u.holder ? u.holder.scale.x : 1);
    return ball(u.x, u.y, (u.z || 0) + r * 0.5, r * 2 + margin);
  };
  see.ball = ball;
  return see;
}

const _box = new THREE.Box3(), _sph = new THREE.Sphere();

export class LandInstances {
  constructor(scene, renderer = null, camera = null) {
    this.scene = scene; this.renderer = renderer; this.camera = camera;
    scene.matrixAutoUpdate = false; scene.matrix.identity(); scene.matrixWorld.identity(); scene.matrixWorldNeedsUpdate = false;
    this.pools = new Map();
    this.list = [];
    this.lists = new WeakMap();
    this.out = [];
    this.own = [];
    this.hid = [];
    this.tick = 0;
    this.queue = [];
    this.drawn = 0;
    this.reach = new WeakMap();
    this.unmeasured = new WeakMap();
    this.parts = new WeakMap();
    this.box = new THREE.Group();
    this.box.matrixAutoUpdate = false; this.box.userData.casts = true;
    scene.add(this.box);
  }

  poolFor(mesh, skinned) {
    let byGeo = this.pools.get(mesh.material);
    if (!byGeo) this.pools.set(mesh.material, (byGeo = new Map()));
    let p = byGeo.get(mesh.geometry);
    if (!p) {
      let mat = mesh.material;
      if (skinned) {
        mat = mesh.material.clone();
        mat.defines = { ...mesh.material.defines, INSTSKIN: 1 };
        mat.uniforms = { ...mesh.material.uniforms, boneTex: { value: null } };
      }
      p = { src: mesh.geometry, mat, skinned, order: mesh.renderOrder, n: 0, cap: 0, im: null, tint: null, tex: null, ready: !this.renderer };
      this.size(p, 32);
      byGeo.set(mesh.geometry, p);
      this.list.push(p);
      if (!p.ready) this.queue.push(p);
    }
    return p;
  }

  readyAll() {
    for (const p of this.queue) {
      p.im.count = 1; p.im.visible = true;
      this.renderer.compile(p.im, this.camera, shaderScene(this.scene));
      p.im.visible = false; p.im.count = 0; p.ready = true;
    }
    this.queue.length = 0;
  }

  size(p, cap) {
    const old = p.im;
    const geo = new THREE.BufferGeometry();
    for (const k in p.src.attributes) geo.setAttribute(k, p.src.attributes[k]);
    geo.setIndex(p.src.index);
    for (const g of p.src.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.boundingSphere = p.src.boundingSphere; geo.boundingBox = p.src.boundingBox;
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    geo.setAttribute('instanceTint', tint);
    const im = new THREE.InstancedMesh(geo, p.mat, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false; im.matrixAutoUpdate = false; im.renderOrder = p.order; im.count = 0; im.visible = false;
    im.userData.casts = true;
    if (old) {
      im.instanceMatrix.array.set(old.instanceMatrix.array);
      old.parent = null;
      for (const k in old.geometry.attributes) if (k !== 'instanceTint') old.geometry.deleteAttribute(k);
      old.geometry.setIndex(null);
      old.geometry.dispose(); old.dispose();
    }
    if (p.skinned) {
      const R = this.renderer, shared = R && R.isMirror && R.shared;
      const bones = () => (shared ? new Float32Array(new SharedArrayBuffer(ROW * cap * 16)) : new Float32Array(ROW * cap * 4));
      const tex = new THREE.DataTexture(bones(), ROW, cap, THREE.RGBAFormat, THREE.FloatType);
      tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
      if (shared) p.bufs = [tex.image.data, bones(), bones()];
      if (p.tex) { if (shared) for (const b of p.bufs) b.set(p.tex.image.data); else tex.image.data.set(p.tex.image.data); p.tex.dispose(); }
      p.tex = tex;
    }
    im.parent = this.box;
    p.im = im; p.tint = tint; p.cap = cap;
  }

  rigidOf(u) {
    let L = this.lists.get(u);
    if (L && (++L.age & 63) !== 0) return L.rigid;
    if (!L) this.lists.set(u, (L = { age: 1, rigid: [] }));
    L.rigid.length = 0;
    u.holder.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !(o.material.defines && o.material.defines.SKINNED)) L.rigid.push(o); });
    return L.rigid;
  }

  meshesOf(h) {
    let L = this.parts.get(h);
    if (L && (++L.age & 63) !== 0) return L.list;
    if (!L) this.parts.set(h, (L = { age: 1, list: [] }));
    L.list.length = 0;
    h.traverse(o => { if (o.isMesh && !o.isInstancedMesh) L.list.push(o); });
    return L.list;
  }

  reachOf(h) {
    let r = this.reach.get(h);
    if (r !== undefined) return r;
    if (this.unmeasured.get(h) === h.children.length) return 50;
    _box.setFromObject(h);
    if (_box.isEmpty()) { this.unmeasured.set(h, h.children.length); return 50; }
    _box.getBoundingSphere(_sph);
    r = _sph.radius + _sph.center.distanceTo(h.position);
    this.reach.set(h, r);
    return r;
  }

  put(m, h, skinned, mats) {
    let b = m._batch;
    if (!b || b.mat !== m.material || b.geo !== m.geometry || b.skinned !== skinned) {
      const ok = skinned ? skinBatchable.has(m.material) : instanceable.has(m.material);
      m._batch = b = { mat: m.material, geo: m.geometry, skinned, ok, pool: ok ? this.poolFor(m, skinned) : null };
    }
    const p = b.pool;
    let o = m;
    while (o && o !== h && o.visible) o = o.parent;
    if (!b.ok || (skinned && !mats) || !p.ready) {
      if (m._taken) { m.layers.set(0); m._taken = false; }
      return o === h;
    }
    if (!m._taken) { m.layers.set(HIDDEN); m._taken = true; }
    if (o !== h) return false;
    if (p.n === p.cap) this.size(p, p.cap * 4);
    const a = p.im.instanceMatrix.array, me = m.matrixWorld.elements, at = p.n * 16;
    for (let k = 0; k < 16; k++) a[at + k] = me[k];
    if (skinned) { if (this.noGL) (p.rows ||= [])[p.n] = mats; else p.tex.image.data.set(mats, p.n * ROW * 4); }
    p.n++; this.drawn++;
    return false;
  }

  collect(units, look, extras = [], eye = null, loose = []) {
    const scene = this.scene, out = this.out, own = this.own, hid = this.hid, tick = ++this.tick;
    for (let k = 0; k < 4 && this.queue.length; k++) {
      const p = this.queue.shift();
      p.im.count = 1; p.im.visible = true;
      Promise.resolve(this.renderer.compileAsync(p.im, this.camera, shaderScene(this.scene))).catch(() => {}).then(() => { p.ready = true; });
      p.im.visible = false; p.im.count = 0;
    }
    let i = 0, firsts = 0;
    for (const p of this.list) p.n = 0;
    if (this.renderer && this.renderer.isMirror && this.renderer.shared) {
      const par = this.renderer.parity();
      for (const p of this.list) if (p.bufs) p.tex.image.data = p.bufs[par];
    }
    for (const u of units) {
      const h = u.holder, inst = u.inst;
      if (!h || h.parent !== scene) continue;
      u.inView = false;
      if (!h.visible) { h.matrixWorldAutoUpdate = false; own.push(h); continue; }
      if (h.userData.ready === false) { h.visible = false; h.matrixWorldAutoUpdate = false; out.push(h); continue; }
      if (inst && u.anim && !inst.animated && !this.warm) {
        if (this.poseNow) this.poseNow(u);
        if (!inst.animated) { h.visible = false; h.matrixWorldAutoUpdate = false; out.push(h); continue; }
      }
      if (look && ((u.x - look.x) ** 2 + (u.y - look.y) ** 2 > look.r * look.r || (look.see && !look.see(u, DRAW_MARGIN)))) { h.visible = false; h.matrixWorldAutoUpdate = false; out.push(h); continue; }
      if (inst && !this.warm && (!inst.lazy || (inst.pc && !inst.pcParts)) && firsts++ >= FIRSTS) { h.visible = false; h.matrixWorldAutoUpdate = false; out.push(h); continue; }
      u.inView = true;
      i++;
      if (eye && inst && inst.lazy && ((i + tick) & 1) && (u.x - eye.x) ** 2 + (u.y - eye.y) ** 2 + (u.z - eye.z) ** 2 > FAR2) { h.matrixWorldAutoUpdate = false; own.push(h); continue; }
      if (inst && !inst.lazy) {
        inst.lazy = true; inst.dirty = true;
        const bones = new Set(inst.bones);
        inst.root.traverse(o => { if (o !== inst.root && !bones.has(o)) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
      }
      if (inst && inst.pc && placeCached(u)) { h.matrixWorldAutoUpdate = false; own.push(h); continue; }
      h.updateMatrixWorld(true);
      if (inst && inst.dirty) { inst.dirty = false; inst.syncSkins(); }
      h.matrixWorldAutoUpdate = false; own.push(h);
    }
    if (look) for (const list of extras) for (const e of list) {
      const o = e.holder || e.grp;
      if (o && o.visible && o.parent === scene && ((e.x - look.x) ** 2 + (e.y - look.y) ** 2 > look.r * look.r ||
        (look.see && !look.see.ball(o.position.x, o.position.y, o.position.z, this.reachOf(o) * 1.5 + DRAW_MARGIN)))) { o.visible = false; hid.push(o); }
    }
    for (const c of scene.children) if (!c.visible && c.matrixWorldAutoUpdate) { c.matrixWorldAutoUpdate = false; own.push(c); }
    for (const c of scene.children) if (c.matrixWorldAutoUpdate) c.updateMatrixWorld();
    this.drawn = 0;
    for (const u of units) {
      const h = u.holder, inst = u.inst;
      if (!h || !h.visible || h.parent !== scene || !inst) continue;
      let rest = false;
      const S = u.skinOf;
      if (S && (S.ghost || S.fade >= 0 || S.tint.w > 0)) {
        const back = m => { if (m._taken) { m.layers.set(0); m._taken = false; } };
        if (inst.skins) for (const s of inst.skins) back(s.mesh);
        for (const m of this.rigidOf(u)) back(m);
        continue;
      }
      if (inst.skins) for (const s of inst.skins) if (this.put(s.mesh, h, true, s.mats)) rest = true;
      for (const m of this.rigidOf(u)) if (this.put(m, h, false, null)) rest = true;
      if (!rest) { h.visible = false; out.push(h); }
    }
    for (const h of loose) {
      if (!h || !h.visible || h.parent !== scene) continue;
      if (look && look.see && !look.see.ball(h.position.x, h.position.y, h.position.z, this.reachOf(h) * 1.5 + DRAW_MARGIN)) { h.visible = false; hid.push(h); continue; }
      let rest = false;
      for (const m of this.meshesOf(h)) if (this.put(m, h, false, null)) rest = true;
      if (!rest) { h.visible = false; hid.push(h); }
    }
    const drawing = this.box.children;
    drawing.length = 0;
    for (const p of this.list) {
      const im = p.im;
      im.count = p.n; im.visible = p.n > 0;
      if (!p.n) continue;
      drawing.push(im);
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, p.n * 16); im.instanceMatrix.needsUpdate = true;
      if (p.skinned) { if (!this.noGL) this.sendBones(p); p.mat.uniforms.boneTex.value = p.tex; p.tex.userData.rows = this.noGL ? p.rows : null; }
    }
  }

  sendBones(p) {
    const R = this.renderer, tex = p.tex;
    if (R && R.isMirror) { R.sendRows(tex, ROW, p.n); return; }
    const props = R && R.properties.get(tex);
    if (!props || !props.__webglTexture || props.__version !== tex.version) { tex.needsUpdate = true; return; }
    const gl = R.getContext();
    R.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, p.n, gl.RGBA, gl.FLOAT, tex.image.data, 0);
  }

  restore() {
    for (const h of this.out) { h.visible = true; h.matrixWorldAutoUpdate = true; }
    for (const h of this.own) h.matrixWorldAutoUpdate = true;
    for (const o of this.hid) o.visible = true;
    this.out.length = 0; this.own.length = 0; this.hid.length = 0;
  }
}
