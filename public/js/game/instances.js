import * as THREE from 'three';
import { instanceable, alphaInstanceable, skinBatchable } from '../model.js';
import { CollectJobs } from './collectjobs.js';
import { mergeableGeometry, mergeGeometries, mergeKey } from './landinstances.js';

const ROW = 24 * 4;

const _frustum = new THREE.Frustum(),
  _pm = new THREE.Matrix4(),
  _sphere = new THREE.Sphere(),
  _inv = new THREE.Matrix4();
const _chain = [];

function placeBranch(root, node) {
  _chain.length = 0;
  for (let o = node.parent; o !== root; o = o.parent) {
    if (!o) return false;
    _chain.push(o);
  }
  for (let i = _chain.length - 1; i >= 0; i--) {
    const o = _chain[i];
    if (o.matrixAutoUpdate) o.updateMatrix();
    if (o.matrixWorldAutoUpdate === true) o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
  }
  node.updateWorldMatrix(false, true);
  return true;
}
const HIDDEN = 1;

// Writes a * b (column-major 4x4) straight into an instance row: a batched part's own matrixWorld is never read (with
// collect jobs it is not even written), so the multiply and the copy into the batch are one step.
export function mulInto(out, o, a, b) {
  const a11 = a[0], a12 = a[4], a13 = a[8], a14 = a[12];
  const a21 = a[1], a22 = a[5], a23 = a[9], a24 = a[13];
  const a31 = a[2], a32 = a[6], a33 = a[10], a34 = a[14];
  const a41 = a[3], a42 = a[7], a43 = a[11], a44 = a[15];
  for (let c = 0; c < 4; c++) {
    const b1 = b[c * 4], b2 = b[c * 4 + 1], b3 = b[c * 4 + 2], b4 = b[c * 4 + 3];
    out[o + c * 4] = a11 * b1 + a12 * b2 + a13 * b3 + a14 * b4;
    out[o + c * 4 + 1] = a21 * b1 + a22 * b2 + a23 * b3 + a24 * b4;
    out[o + c * 4 + 2] = a31 * b1 + a32 * b2 + a33 * b3 + a34 * b4;
    out[o + c * 4 + 3] = a41 * b1 + a42 * b2 + a43 * b3 + a44 * b4;
  }
}
// Hull decals (alpha-blended hardpoint blast marks, girders) are batched like the opaque parts (ours) and drawn first
// among transparent things: they sit on the hull and write no depth, so whatever is behind them is already hidden by
// the hull and whatever is in front (shots, effects, shields) draws over them, as it did when each decal was sorted
// on its own. Before, every decal was a draw call of its own and kept its ship in the renderer's scene walk.
const DECAL_ORDER = -1000;
// Opaque hull parts that never change (not decals, shields, engines, girders or collision meshes, which the game
// shows and hides) are joined per material into one mesh per ship type (ours), so a ship type costs a draw call per
// material instead of one per part. A unit whose joined part ever hides or changes material goes back to its parts.
const MERGE_PARTS = !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('nomerge'));
const TOGGLED = /BLAST|DECAL|SHIELD|ENGINE|GIRDER|COLLISION|_ALT/i;
const IDENTITY = new THREE.Matrix4();
const mergedParts = new WeakMap();
const SPACE_DECALS = !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('nodecalbatch'));

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
    this.jobs = CollectJobs.create();
  }

  poolFor(mesh, skinned = false, decal = false) {
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
      p = {
        src: mesh.geometry,
        mat,
        skinned,
        rows: skinned ? [] : null,
        ready: !skinned,
        order: decal ? DECAL_ORDER + mesh.renderOrder : mesh.renderOrder,
        n: 0,
        cap: 0,
        im: null,
        tint: null
      };
      this.size(p, 8);
      byGeo.set(mesh.geometry, p);
      this.list.push(p);
      if (skinned) {
        const im = p.im;
        im.count = 1;
        im.visible = true;
        Promise.resolve(this.gpu.compileAsync(im, this.camera))
          .catch(() => {})
          .then(() => {
            p.ready = true;
          });
        im.visible = false;
        im.count = 0;
      }
    }
    return p;
  }

  fadePool(base) {
    const twins = (this.twins ||= new WeakMap());
    let twin = twins.get(base.mat);
    if (!twin) {
      twin = base.mat.clone();
      twin.uniforms = { ...base.mat.uniforms };
      twin.userData = base.mat.userData;
      twin.transparent = true;
      twin.blending = THREE.NormalBlending;
      twin.depthWrite = true;
      twins.set(base.mat, twin);
    }
    const p = this.poolFor({ material: twin, geometry: base.src, renderOrder: base.order });
    if (p.compiling === undefined) {
      p.compiling = true;
      p.ready = false;
      const r = this.gpu || this.renderer,
        im = p.im;
      if (r && r.compileAsync) {
        im.count = 1;
        im.visible = true;
        Promise.resolve(r.compileAsync(im, this.camera))
          .catch(() => {})
          .then(() => {
            p.ready = true;
          });
        im.visible = false;
        im.count = 0;
      } else p.ready = true;
    }
    return p;
  }

  size(p, cap) {
    const old = p.im,
      oldTint = p.tint;
    const geo = new THREE.BufferGeometry();
    for (const k in p.src.attributes) geo.setAttribute(k, p.src.attributes[k]);
    geo.setIndex(p.src.index);
    for (const g of p.src.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.boundingSphere = p.src.boundingSphere;
    geo.boundingBox = p.src.boundingBox;
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    tint.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instanceTint', tint);
    const im = new THREE.InstancedMesh(geo, p.mat, cap);
    if (this.jobs) {
      im.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(new SharedArrayBuffer(cap * 64)), 16);
      p.pid = this.jobs.pool(im.instanceMatrix.array, p.pid ?? -1);
    }
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.matrixAutoUpdate = false;
    im.renderOrder = p.order;
    im.count = 0;
    im.visible = false;
    if (old) {
      im.instanceMatrix.array.set(old.instanceMatrix.array);
      tint.array.set(oldTint.array);
      this.scene.remove(old);
      for (const k in old.geometry.attributes) if (k !== 'instanceTint') old.geometry.deleteAttribute(k);
      old.geometry.setIndex(null);
      old.geometry.dispose();
      old.dispose();
    }
    this.scene.add(im);
    p.im = im;
    p.tint = tint;
    p.cap = cap;
  }

  scan(u) {
    const list = u.instList || (u.instList = []);
    const obj = u.obj,
      before = list.length;
    obj.userData.ship = true;
    obj.updateWorldMatrix(true, true);
    _inv.copy(obj.matrixWorld).invert();
    for (const e of list) {
      if (e.members) continue;
      e.local.multiplyMatrices(_inv, e.mesh.matrixWorld);
      e.dirty = true;
    }
    let skins = null;
    obj.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || this.known.has(o)) return;
      this.known.add(o);
      const e = { mesh: o, mat: o.material, pool: null, skin: null, local: new THREE.Matrix4().multiplyMatrices(_inv, o.matrixWorld) };
      o.userData.instEntry = e;
      if (instanceable.has(o.material)) {
        e.pool = this.poolFor(o);
        this.taken.add(o);
        o.layers.set(HIDDEN);
      } else if (SPACE_DECALS && alphaInstanceable.has(o.material) && !o.isSkinnedMesh) {
        e.pool = this.poolFor(o, false, true);
        this.taken.add(o);
        o.layers.set(HIDDEN);
      } else if (this.gpu && skinBatchable.has(o.material)) {
        skins ||= new Map([u.model, ...u.hardpoints.map(h => h.model)].flatMap(m => (m && m.skins ? m.skins.map(s => [s.mesh, s]) : [])));
        const skin = skins.get(o);
        if (skin) {
          e.skin = skin;
          e.pool = this.poolFor(o, true);
        }
      }
      list.push(e);
    });
    if (list.length !== before) {
      u.instWarm = 4;
      if (MERGE_PARTS && !u.instMergeOff) this.mergeParts(u, list);
    }
    u.instTurretsOnly =
      !!u.model &&
      !!u.model.flat &&
      u.model.billboards.length === 0 &&
      !u.hardpoints.some(h => h.model && (!h.model.flat || h.model.billboards.length > 0));
    u.instMoves = !u.instTurretsOnly || u.turrets.length > 0;
    u.instPosed = -1;
    this.units.add(u);
    return list;
  }

  mergeParts(u, list) {
    const obj = u.obj,
      decals = new Set(u.hardpoints.map(h => h.decal).filter(Boolean)),
      groups = new Map();
    const steady = m => {
      if (u.engineMeshes && u.engineMeshes.includes(m)) return false;
      for (let o = m; o && o !== obj; o = o.parent) if (!o.visible || decals.has(o) || TOGGLED.test(o.name || '')) return false;
      return true;
    };
    for (const e of list) {
      const p = e.pool;
      if (!p || e.members || e.merged || e.skin || p.skinned || p.order <= DECAL_ORDER / 2 || e.mesh.isSkinnedMesh || !steady(e.mesh)) continue;
      let g = groups.get(p.mat);
      if (!g) groups.set(p.mat, (g = []));
      g.push(e);
    }
    for (const [mat, g] of groups) {
      if (g.length < 2) continue;
      const names = Object.keys(g[0].mesh.geometry.attributes);
      const parts = g.filter(e => e.mesh.renderOrder === g[0].mesh.renderOrder && mergeableGeometry(e.mesh.geometry, names));
      if (parts.length < 2) continue;
      const meshes = parts.map(e => e.mesh),
        locals = parts.map(e => e.local),
        key = mergeKey(meshes, locals);
      let byKey = mergedParts.get(mat);
      if (!byKey) mergedParts.set(mat, (byKey = new Map()));
      let geometry = byKey.get(key);
      if (!geometry) byKey.set(key, (geometry = mergeGeometries(meshes, locals)));
      const entry = {
        mesh: meshes[0],
        mat,
        pool: this.poolFor({ material: mat, geometry, renderOrder: meshes[0].renderOrder }),
        skin: null,
        local: IDENTITY.clone(),
        members: meshes,
        parts
      };
      for (const e of parts) e.merged = entry;
      list.push(entry);
    }
    let n = 0;
    for (const e of list) if (!e.merged) list[n++] = e;
    list.length = n;
    u.instMerges = list.some(e => e.members);
  }

  // A joined part hid or changed material: this unit draws its parts one by one from now on.
  unmerge(u) {
    const list = u.instList,
      back = [];
    let n = 0;
    for (const e of list) {
      if (e.members) {
        for (const p of e.parts) {
          p.merged = null;
          p.dirty = true;
          back.push(p);
        }
      } else list[n++] = e;
    }
    list.length = n;
    list.push(...back);
    u.instMerges = false;
    u.instMergeOff = true;
  }

  release(u) {
    for (const e of u.instList || []) {
      if (e.members) {
        for (const p of e.parts) {
          p.mesh.layers.set(0);
          this.taken.delete(p.mesh);
          this.known.delete(p.mesh);
        }
        continue;
      }
      if (e.pool) {
        e.mesh.layers.set(0);
        this.taken.delete(e.mesh);
      }
      this.known.delete(e.mesh);
    }
    for (const e of u.instList || []) if (e.skin) e.mesh.layers.set(0);
    u.instList = null;
    this.units.delete(u);
    u.obj.userData.ship = false;
  }

  collect(units, cam, castsShadowInView = () => false) {
    const stamp = ++this.stamp,
      scene = this.scene,
      put = this.put;
    _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const p of this.list) p.n = 0;
    if (this.jobs?.broken) this.jobs = null;
    const J = this.jobs;
    if (J) J.begin();
    let drawn = 0;
    for (const u of units) {
      if (u.dead || !u.obj) continue;
      const obj = u.obj;
      let list = u.instList;
      if (!list || ((u.id + stamp) & 63) === 0) list = this.scan(u);
      u.instStamp = stamp;
      if (!obj.visible) continue;
      let pose = -1;
      if (u.instTurretsOnly && u.turrets.length) {
        pose = 0;
        for (const t of u.turrets) pose += t.inst.poseVersion;
      }
      const posed = pose >= 0 && pose === u.instPosed;
      const whole =
        (u.instMoves && !posed) ||
        u.instWarm > 0 ||
        obj.parent !== scene ||
        !!u.anim ||
        !!u.buildAnim ||
        !!u.construction ||
        u.pendingProxies.length > 0;
      if (u.instWarm > 0) u.instWarm--;
      // the shadow pass places a static unit's parts from its current matrix and their offsets (see updateShadows)
      u.instStatic = !whole;
      _sphere.center.set(u.x, u.y, u.z || 0);
      _sphere.radius = Math.max((u.visualRadius || 50) * 2.5, u.fxReach);
      const inView = _frustum.intersectsSphere(_sphere);
      const castsShadow = !!u.casters && castsShadowInView(u);
      if (!inView && !castsShadow) {
        obj.visible = false;
        put.push(obj);
        continue;
      }
      if (whole) obj.updateWorldMatrix(obj.parent !== scene, true);
      else obj.matrixWorld.copy(obj.matrix);
      if (!inView) {
        // Only the shadow pass, which has already drawn this frame, needs a ship off screen; it keeps
        // its pose for the next frame's shadow map but stays out of the camera draw.
        obj.visible = false;
        put.push(obj);
        continue;
      }
      let tr = 0,
        tg = 0,
        tb = 0,
        ta = 0;
      if (u.hyper) ta = Math.max(0, Math.min(1, u.hyper.dark ?? 1));
      else if (u.haze && u.haze.color.w !== 0) {
        const c = u.haze.color;
        tr = c.x;
        tg = c.y;
        tb = c.z;
        ta = c.w;
      }
      const fading = ta < -1.001;
      const world = obj.matrixWorld;
      if (u.instMerges)
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (!e.members) continue;
          let ok = true;
          for (const p of e.parts) {
            if (p.mesh.material !== p.mat) ok = false;
            for (let o = p.mesh; ok && o && o !== obj; o = o.parent) if (!o.visible) ok = false;
            if (!ok) break;
          }
          if (!ok) {
            this.unmerge(u);
            break;
          }
        }
      if (whole && pose >= 0) {
        _inv.copy(world).invert();
        for (let i = 0; i < list.length; i++) {
          if (list[i].members) continue;
          list[i].local.multiplyMatrices(_inv, list[i].mesh.matrixWorld);
          list[i].dirty = true;
        }
        u.instPosed = pose;
      }
      let rest = 0,
        uk = -1;
      const defer0 = !!J && !whole && !castsShadow;
      for (let i = 0; i < list.length; i++) {
        const e = list[i],
          m = e.mesh;
        if (e.members) {
          let p = e.pool;
          if (fading && !p.mat.transparent) {
            const fp = (e.fpool ||= this.fadePool(p));
            if (fp.ready) p = fp;
          }
          if (p.n === p.cap) this.size(p, p.cap * 2);
          if (defer0) {
            if (uk < 0) uk = J.addUnit(world.elements);
            if (e.slot === undefined) e.slot = J.slot();
            if (e.dirty !== false) {
              J.setLocal(e.slot, e.local.elements);
              e.dirty = false;
            }
            J.add(uk, e.slot, p.pid, p.n);
          } else {
            const a = p.im.instanceMatrix.array,
              we = world.elements,
              at = p.n * 16;
            for (let k = 0; k < 16; k++) a[at + k] = we[k];
          }
          if (castsShadow && !whole) for (const q of e.parts) q.mesh.matrixWorld.multiplyMatrices(world, q.local);
          const t = p.tint.array,
            tt = p.n * 4;
          t[tt] = tr;
          t[tt + 1] = tg;
          t[tt + 2] = tb;
          t[tt + 3] = ta;
          p.n++;
          drawn++;
          continue;
        }
        if (e.pool && m.geometry !== e.pool.src) {
          m.layers.set(0);
          this.taken.delete(m);
          e.pool = null;
          e.skin = null;
        }
        const away = !!e.pool && m.material !== e.mat;
        if (away !== !!e.away) {
          e.away = away;
          if (away) {
            m.layers.set(0);
            this.taken.delete(m);
          } else if (!e.skin) {
            this.taken.add(m);
            m.layers.set(HIDDEN);
          }
        }
        if (e.skin && !away) {
          const go = Instances.skins && !!this.gpu && e.pool.ready && !!e.skin.mats;
          if (go !== this.taken.has(m)) {
            if (go) {
              this.taken.add(m);
              m.layers.set(HIDDEN);
            } else {
              this.taken.delete(m);
              m.layers.set(0);
            }
          }
        }
        let o = m;
        while (o && o !== obj && o.visible) o = o.parent;
        if (o !== obj) continue;
        let p = e.pool;
        if (fading && p && !e.skin && !p.mat.transparent) {
          const f = (e.fpool ||= this.fadePool(p));
          if (f.ready) p = f;
        }
        const pooled = !!p && !away && !(e.skin && !this.taken.has(m)),
          defer = defer0 && pooled;
        if (!pooled) {
          if (!whole) m.matrixWorld.multiplyMatrices(world, e.local);
          rest++;
          continue;
        }
        if (p.n === p.cap) this.size(p, p.cap * 2);
        if (defer) {
          if (uk < 0) uk = J.addUnit(world.elements);
          if (e.slot === undefined) e.slot = J.slot();
          if (e.dirty !== false) {
            J.setLocal(e.slot, e.local.elements);
            e.dirty = false;
          }
          J.add(uk, e.slot, p.pid, p.n);
        } else if (whole) {
          const a = p.im.instanceMatrix.array,
            me = m.matrixWorld.elements,
            at = p.n * 16;
          for (let k = 0; k < 16; k++) a[at + k] = me[k];
        } else if (castsShadow) {
          // shadow casters keep their own world matrix current, as other readers of a caster expect
          const a = p.im.instanceMatrix.array,
            me = m.matrixWorld.multiplyMatrices(world, e.local).elements,
            at = p.n * 16;
          for (let k = 0; k < 16; k++) a[at + k] = me[k];
        } else mulInto(p.im.instanceMatrix.array, p.n * 16, world.elements, e.local.elements);
        if (e.skin) p.rows[p.n] = e.skin.mats;
        const t = p.tint.array,
          tt = p.n * 4;
        t[tt] = tr;
        t[tt + 1] = tg;
        t[tt + 2] = tb;
        t[tt + 3] = ta;
        p.n++;
        drawn++;
      }
      const shield = u.shieldMesh;
      if (!whole && shield && shield.visible) {
        if (!placeBranch(obj, shield)) obj.updateWorldMatrix(false, true);
        else if (Instances.check) {
          const mine = [];
          shield.traverse(o => mine.push(o.matrixWorld.elements.slice()));
          obj.updateWorldMatrix(false, true);
          let k = 0;
          shield.traverse(o => {
            const a = mine[k++],
              b = o.matrixWorld.elements;
            Instances.checked++;
            if (a.some((v, j) => v !== b[j])) Instances.mismatches++;
          });
        }
      }
      if (!rest) {
        obj.visible = false;
        put.push(obj);
      }
    }
    if (J) J.run();
    for (const u of this.units) if (u.instStamp !== stamp) this.release(u);
    for (const p of this.list) {
      const im = p.im;
      im.count = p.n;
      im.visible = p.n > 0;
      if (!p.n) continue;
      if (p.skinned) p.mat.uniforms.boneTex.value.userData.rows = p.rows;
      im.instanceMatrix.clearUpdateRanges();
      im.instanceMatrix.addUpdateRange(0, p.n * 16);
      im.instanceMatrix.needsUpdate = true;
      p.tint.clearUpdateRanges();
      p.tint.addUpdateRange(0, p.n * 4);
      p.tint.needsUpdate = true;
    }
    this.drawn = drawn;
  }

  prepare(renderer, camera) {
    const idle = this.list.filter(p => !p.im.visible);
    for (const p of idle) p.im.visible = true;
    try {
      renderer.compile(this.scene, camera);
    } finally {
      for (const p of idle) p.im.visible = false;
    }
  }

  restore() {
    for (const o of this.put) o.visible = true;
    this.put.length = 0;
  }
}
