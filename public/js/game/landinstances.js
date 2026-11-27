import * as THREE from 'three';
import { skinBatchable, instanceable, alphaInstanceable } from '../model.js';
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
  t.fog = scene.fog;
  t.environment = scene.environment;
  return t;
}

const _frustum = new THREE.Frustum(),
  _pv = new THREE.Matrix4(),
  _ball = new THREE.Sphere();

export function viewTest(camera) {
  _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_pv);
  const ball = (x, y, z, r) => {
    _ball.center.set(x, y, z);
    _ball.radius = r;
    return _frustum.intersectsSphere(_ball);
  };
  const see = (u, margin) => {
    const r = (u.inst ? u.inst.radius : 10) * (u.holder ? u.holder.scale.x : 1);
    return ball(u.x, u.y, (u.z || 0) + r * 0.5, r * 2 + margin);
  };
  see.ball = ball;
  return see;
}

const _box = new THREE.Box3(),
  _sph = new THREE.Sphere(),
  _relative = new THREE.Matrix4(),
  _inverse = new THREE.Matrix4(),
  _normalMatrix = new THREE.Matrix3(),
  _vector = new THREE.Vector3();

const MERGE_MIN = 2;
const DIRECTIONS = new Set(['normal', 'tangent', 'binormal']);
const mergedByMaterial = new WeakMap();

function mergeableMaterial(material) {
  if (instanceable.has(material)) return true;
  return alphaInstanceable.has(material) && material.depthWrite !== false && (material.uniforms?.alphaRef?.value ?? -1) >= 0;
}

export function mergeableGeometry(geometry, names) {
  if (!geometry.index || geometry.groups.length > 1 || Object.keys(geometry.morphAttributes).length) return false;
  const own = Object.keys(geometry.attributes);
  if (own.length !== names.length) return false;
  for (const name of own) {
    const attribute = geometry.attributes[name];
    if (attribute.isInterleavedBufferAttribute || !(attribute.array instanceof Float32Array) || !names.includes(name)) return false;
  }
  return true;
}

function relativeMatrices(meshes, holder) {
  _inverse.copy(holder.matrixWorld).invert();
  return meshes.map(mesh => new THREE.Matrix4().multiplyMatrices(_inverse, mesh.matrixWorld));
}

export function mergeKey(meshes, relatives) {
  const parts = [];
  for (let i = 0; i < meshes.length; i++)
    parts.push(meshes[i].geometry.id + '@' + relatives[i].elements.map(value => value.toFixed(3)).join(','));
  return parts.join(';');
}

function bakeAttribute(target, source, offset, name, matrix, normalMatrix) {
  const size = source.itemSize,
    from = source.array,
    to = target.array,
    count = source.count;
  if (name === 'position' && size >= 3) {
    for (let i = 0; i < count; i++) {
      _vector.set(from[i * size], from[i * size + 1], from[i * size + 2]).applyMatrix4(matrix);
      to[(offset + i) * size] = _vector.x;
      to[(offset + i) * size + 1] = _vector.y;
      to[(offset + i) * size + 2] = _vector.z;
      for (let k = 3; k < size; k++) to[(offset + i) * size + k] = from[i * size + k];
    }
    return;
  }
  if (DIRECTIONS.has(name) && size >= 3) {
    for (let i = 0; i < count; i++) {
      _vector.set(from[i * size], from[i * size + 1], from[i * size + 2]);
      if (name === 'normal') _vector.applyMatrix3(normalMatrix);
      else _vector.transformDirection(matrix);
      _vector.normalize();
      to[(offset + i) * size] = _vector.x;
      to[(offset + i) * size + 1] = _vector.y;
      to[(offset + i) * size + 2] = _vector.z;
      for (let k = 3; k < size; k++) to[(offset + i) * size + k] = from[i * size + k];
    }
    return;
  }
  to.set(from.subarray(0, count * size), offset * size);
}

export function mergeGeometries(meshes, relatives) {
  const first = meshes[0].geometry,
    names = Object.keys(first.attributes);
  let vertexCount = 0,
    indexCount = 0;
  for (const mesh of meshes) {
    vertexCount += mesh.geometry.attributes.position.count;
    indexCount += mesh.geometry.index.count;
  }
  const merged = new THREE.BufferGeometry();
  for (const name of names)
    merged.setAttribute(
      name,
      new THREE.BufferAttribute(new Float32Array(vertexCount * first.attributes[name].itemSize), first.attributes[name].itemSize)
    );
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let vertexOffset = 0,
    indexOffset = 0;
  meshes.forEach((mesh, meshIndex) => {
    const geometry = mesh.geometry,
      matrix = relatives[meshIndex];
    _normalMatrix.getNormalMatrix(matrix);
    for (const name of names) bakeAttribute(merged.attributes[name], geometry.attributes[name], vertexOffset, name, matrix, _normalMatrix);
    const source = geometry.index.array,
      flip = matrix.determinant() < 0;
    for (let i = 0; i < geometry.index.count; i += 3) {
      indices[indexOffset + i] = source[i] + vertexOffset;
      indices[indexOffset + i + 1] = source[flip ? i + 2 : i + 1] + vertexOffset;
      indices[indexOffset + i + 2] = source[flip ? i + 1 : i + 2] + vertexOffset;
    }
    vertexOffset += geometry.attributes.position.count;
    indexOffset += geometry.index.count;
  });
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function mergedGeometry(material, meshes, holder) {
  const relatives = relativeMatrices(meshes, holder),
    key = mergeKey(meshes, relatives);
  let byKey = mergedByMaterial.get(material);
  if (!byKey) mergedByMaterial.set(material, (byKey = new Map()));
  let geometry = byKey.get(key);
  if (!geometry) byKey.set(key, (geometry = mergeGeometries(meshes, relatives)));
  return geometry;
}

function shownUnder(mesh, holder) {
  for (let node = mesh; node && node !== holder; node = node.parent) if (!node.visible) return false;
  return true;
}

export class LandInstances {
  constructor(scene, renderer = null, camera = null) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    scene.matrixAutoUpdate = false;
    scene.matrix.identity();
    scene.matrixWorld.identity();
    scene.matrixWorldNeedsUpdate = false;
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
    this.plans = new WeakMap();
    this.box = new THREE.Group();
    this.box.matrixAutoUpdate = false;
    this.box.userData.casts = true;
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
      p = {
        src: mesh.geometry,
        mat,
        skinned,
        renderOrder: mesh.renderOrder,
        n: 0,
        cap: 0,
        im: null,
        tint: null,
        tex: null,
        ready: !this.renderer,
        backToFront: !skinned && alphaInstanceable.has(mesh.material),
        order: null,
        distances: null,
        scratch: null
      };
      this.size(p, 32);
      byGeo.set(mesh.geometry, p);
      this.list.push(p);
      if (!p.ready) this.queue.push(p);
    }
    return p;
  }

  readyAll() {
    for (const p of this.queue) {
      p.im.count = 1;
      p.im.visible = true;
      this.renderer.compile(p.im, this.camera, shaderScene(this.scene));
      p.im.visible = false;
      p.im.count = 0;
      p.ready = true;
    }
    this.queue.length = 0;
  }

  size(p, cap) {
    const old = p.im;
    const geo = new THREE.BufferGeometry();
    for (const k in p.src.attributes) geo.setAttribute(k, p.src.attributes[k]);
    geo.setIndex(p.src.index);
    for (const g of p.src.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.boundingSphere = p.src.boundingSphere;
    geo.boundingBox = p.src.boundingBox;
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    geo.setAttribute('instanceTint', tint);
    const im = new THREE.InstancedMesh(geo, p.mat, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.matrixAutoUpdate = false;
    im.renderOrder = p.renderOrder;
    if (p.backToFront) im.boundingSphere = new THREE.Sphere();
    im.count = 0;
    im.visible = false;
    im.userData.casts = true;
    if (old) {
      im.instanceMatrix.array.set(old.instanceMatrix.array);
      old.parent = null;
      for (const k in old.geometry.attributes) if (k !== 'instanceTint') old.geometry.deleteAttribute(k);
      old.geometry.setIndex(null);
      old.geometry.dispose();
      old.dispose();
    }
    if (p.skinned) {
      const R = this.renderer,
        shared = R && R.isMirror && R.shared;
      const bones = () => (shared ? new Float32Array(new SharedArrayBuffer(ROW * cap * 16)) : new Float32Array(ROW * cap * 4));
      const tex = new THREE.DataTexture(bones(), ROW, cap, THREE.RGBAFormat, THREE.FloatType);
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      if (shared) p.bufs = [tex.image.data, bones(), bones()];
      if (p.tex) {
        if (shared) for (const b of p.bufs) b.set(p.tex.image.data);
        else tex.image.data.set(p.tex.image.data);
        p.tex.dispose();
      }
      p.tex = tex;
    }
    im.parent = this.box;
    p.im = im;
    p.tint = tint;
    p.cap = cap;
  }

  rigidOf(u) {
    let L = this.lists.get(u);
    if (L && (++L.age & 63) !== 0) return L.rigid;
    if (!L) this.lists.set(u, (L = { age: 1, rigid: [] }));
    L.rigid.length = 0;
    u.holder.traverse(o => {
      if (o.isMesh && !o.isInstancedMesh && !(o.material.defines && o.material.defines.SKINNED)) L.rigid.push(o);
    });
    return L.rigid;
  }

  planOf(holder) {
    let plan = this.plans.get(holder);
    if (plan && (++plan.age & 63) !== 0) return plan;
    if (!plan) this.plans.set(holder, (plan = { age: 1, singles: [], groups: [] }));
    plan.singles.length = 0;
    plan.groups.length = 0;
    const meshes = [];
    let still = true;
    holder.traverse(node => {
      if (node !== holder && node.matrixAutoUpdate) still = false;
      if (node.isMesh && !node.isInstancedMesh) meshes.push(node);
    });
    if (!still || this.noMerge) {
      plan.singles.push(...meshes);
      return plan;
    }
    const byMaterial = new Map();
    for (const mesh of meshes) {
      if (!mergeableMaterial(mesh.material) || !shownUnder(mesh, holder)) {
        plan.singles.push(mesh);
        continue;
      }
      const list = byMaterial.get(mesh.material);
      if (list) list.push(mesh);
      else byMaterial.set(mesh.material, [mesh]);
    }
    for (const [material, list] of byMaterial) {
      const first = list[0],
        names = Object.keys(first.geometry.attributes),
        merging = [];
      for (const mesh of list)
        if (mesh.renderOrder === first.renderOrder && mergeableGeometry(mesh.geometry, names)) merging.push(mesh);
        else plan.singles.push(mesh);
      if (merging.length < MERGE_MIN) {
        plan.singles.push(...merging);
        continue;
      }
      plan.groups.push({
        material,
        geometry: mergedGeometry(material, merging, holder),
        renderOrder: first.renderOrder,
        meshes: merging,
        probe: merging[0]
      });
    }
    return plan;
  }

  putLoose(holder) {
    const plan = this.planOf(holder);
    let rest = false;
    for (const mesh of plan.singles) if (this.put(mesh, holder, false, null)) rest = true;
    for (const group of plan.groups) {
      const merged = !group.probe.matrixAutoUpdate && group.meshes.every(mesh => shownUnder(mesh, holder)) && this.putMerged(group, holder);
      if (!merged) for (const mesh of group.meshes) if (this.put(mesh, holder, false, null)) rest = true;
    }
    return rest;
  }

  putMerged(group, holder) {
    const pool = (group.pool ||= this.poolFor(group, false));
    if (!pool.ready) return false;
    for (const mesh of group.meshes)
      if (!mesh._taken) {
        mesh.layers.set(HIDDEN);
        mesh._taken = true;
      }
    if (pool.n === pool.cap) this.size(pool, pool.cap * 4);
    const at = pool.n * 16,
      matrices = pool.im.instanceMatrix.array,
      world = holder.matrixWorld.elements;
    for (let k = 0; k < 16; k++) matrices[at + k] = world[k];
    pool.n++;
    this.drawn++;
    return true;
  }

  reachOf(h) {
    let r = this.reach.get(h);
    if (r !== undefined) return r;
    if (this.unmeasured.get(h) === h.children.length) return 50;
    _box.setFromObject(h);
    if (_box.isEmpty()) {
      this.unmeasured.set(h, h.children.length);
      return 50;
    }
    _box.getBoundingSphere(_sph);
    r = _sph.radius + _sph.center.distanceTo(h.position);
    this.reach.set(h, r);
    return r;
  }

  put(m, h, skinned, mats) {
    let b = m._batch;
    if (!b || b.mat !== m.material || b.geo !== m.geometry || b.skinned !== skinned) {
      const ok = skinned ? skinBatchable.has(m.material) : instanceable.has(m.material) || alphaInstanceable.has(m.material);
      m._batch = b = { mat: m.material, geo: m.geometry, skinned, ok, pool: ok ? this.poolFor(m, skinned) : null };
    }
    const p = b.pool;
    let o = m;
    while (o && o !== h && o.visible) o = o.parent;
    if (!b.ok || (skinned && !mats) || !p.ready) {
      if (m._taken) {
        m.layers.set(0);
        m._taken = false;
      }
      return o === h;
    }
    if (!m._taken) {
      m.layers.set(HIDDEN);
      m._taken = true;
    }
    if (o !== h) return false;
    if (p.n === p.cap) this.size(p, p.cap * 4);
    const a = p.im.instanceMatrix.array,
      me = m.matrixWorld.elements,
      at = p.n * 16;
    for (let k = 0; k < 16; k++) a[at + k] = me[k];
    if (skinned) {
      if (this.noGL) (p.rows ||= [])[p.n] = mats;
      else p.tex.image.data.set(mats, p.n * ROW * 4);
    }
    p.n++;
    this.drawn++;
    return false;
  }

  collect(units, look, extras = [], eye = null, loose = []) {
    const scene = this.scene,
      out = this.out,
      own = this.own,
      hid = this.hid,
      tick = ++this.tick;
    for (let k = 0; k < 4 && this.queue.length; k++) {
      const p = this.queue.shift();
      p.im.count = 1;
      p.im.visible = true;
      Promise.resolve(this.renderer.compileAsync(p.im, this.camera, shaderScene(this.scene)))
        .catch(() => {})
        .then(() => {
          p.ready = true;
        });
      p.im.visible = false;
      p.im.count = 0;
    }
    let i = 0,
      firsts = 0;
    for (const p of this.list) p.n = 0;
    if (this.renderer && this.renderer.isMirror && this.renderer.shared) {
      const par = this.renderer.parity();
      for (const p of this.list) if (p.bufs) p.tex.image.data = p.bufs[par];
    }
    for (const u of units) {
      const h = u.holder,
        inst = u.inst;
      if (!h || h.parent !== scene) continue;
      u.inView = false;
      if (!h.visible) {
        h.matrixWorldAutoUpdate = false;
        own.push(h);
        continue;
      }
      if (h.userData.ready === false) {
        h.visible = false;
        h.matrixWorldAutoUpdate = false;
        out.push(h);
        continue;
      }
      if (inst && u.anim && !inst.animated && !this.warm) {
        if (this.poseNow) this.poseNow(u);
        if (!inst.animated) {
          h.visible = false;
          h.matrixWorldAutoUpdate = false;
          out.push(h);
          continue;
        }
      }
      if (look && ((u.x - look.x) ** 2 + (u.y - look.y) ** 2 > look.r * look.r || (look.see && !look.see(u, DRAW_MARGIN)))) {
        h.visible = false;
        h.matrixWorldAutoUpdate = false;
        out.push(h);
        continue;
      }
      if (inst && !this.warm && (!inst.lazy || (inst.pc && !inst.pcParts)) && firsts++ >= FIRSTS) {
        h.visible = false;
        h.matrixWorldAutoUpdate = false;
        out.push(h);
        continue;
      }
      u.inView = true;
      i++;
      if (eye && inst && inst.lazy && (i + tick) & 1 && (u.x - eye.x) ** 2 + (u.y - eye.y) ** 2 + (u.z - eye.z) ** 2 > FAR2) {
        h.matrixWorldAutoUpdate = false;
        own.push(h);
        continue;
      }
      if (inst && !inst.lazy) {
        inst.lazy = true;
        inst.dirty = true;
        const bones = new Set(inst.bones);
        inst.root.traverse(o => {
          if (o !== inst.root && !bones.has(o)) {
            o.updateMatrix();
            o.matrixAutoUpdate = false;
          }
        });
      }
      if (inst && inst.pc && placeCached(u)) {
        h.matrixWorldAutoUpdate = false;
        own.push(h);
        continue;
      }
      h.updateMatrixWorld(true);
      if (inst && inst.dirty) {
        inst.dirty = false;
        inst.syncSkins();
      }
      h.matrixWorldAutoUpdate = false;
      own.push(h);
    }
    if (look)
      for (const list of extras)
        for (const e of list) {
          const o = e.holder || e.grp;
          if (
            o &&
            o.visible &&
            o.parent === scene &&
            ((e.x - look.x) ** 2 + (e.y - look.y) ** 2 > look.r * look.r ||
              (look.see && !look.see.ball(o.position.x, o.position.y, o.position.z, this.reachOf(o) * 1.5 + DRAW_MARGIN)))
          ) {
            o.visible = false;
            hid.push(o);
          }
        }
    for (const c of scene.children)
      if (!c.visible && c.matrixWorldAutoUpdate) {
        c.matrixWorldAutoUpdate = false;
        own.push(c);
      }
    for (const c of scene.children) if (c.matrixWorldAutoUpdate) c.updateMatrixWorld();
    this.drawn = 0;
    for (const u of units) {
      const h = u.holder,
        inst = u.inst;
      if (!h || !h.visible || h.parent !== scene || !inst) continue;
      let rest = false;
      const S = u.skinOf;
      if (S && (S.ghost || S.fade >= 0 || S.tint.w !== 0)) {
        const back = m => {
          if (m._taken) {
            m.layers.set(0);
            m._taken = false;
          }
        };
        if (inst.skins) for (const s of inst.skins) back(s.mesh);
        if (inst.attachedModels) for (const a of inst.attachedModels) for (const s of a.skins) back(s.mesh);
        for (const m of this.rigidOf(u)) back(m);
        continue;
      }
      if (inst.skins) for (const s of inst.skins) if (this.put(s.mesh, h, true, s.mats)) rest = true;
      if (inst.attachedModels)
        for (const a of inst.attachedModels) {
          if (!a.skins.length) continue;
          a.syncSkins();
          for (const s of a.skins) if (this.put(s.mesh, h, true, s.mats)) rest = true;
        }
      for (const m of this.rigidOf(u)) if (this.put(m, h, false, null)) rest = true;
      if (!rest) {
        h.visible = false;
        out.push(h);
      }
    }
    for (const h of loose) {
      if (!h || !h.visible || h.parent !== scene) continue;
      if (look && look.see && !look.see.ball(h.position.x, h.position.y, h.position.z, this.reachOf(h) * 1.5 + DRAW_MARGIN)) {
        h.visible = false;
        hid.push(h);
        continue;
      }
      if (!this.putLoose(h)) {
        h.visible = false;
        hid.push(h);
      }
    }
    const drawing = this.box.children;
    drawing.length = 0;
    for (const p of this.list) {
      const im = p.im;
      im.count = p.n;
      im.visible = p.n > 0;
      if (!p.n) continue;
      if (p.backToFront) this.sortBackToFront(p, eye);
      drawing.push(im);
      im.instanceMatrix.clearUpdateRanges();
      im.instanceMatrix.addUpdateRange(0, p.n * 16);
      im.instanceMatrix.needsUpdate = true;
      if (p.skinned) {
        if (!this.noGL) this.sendBones(p);
        p.mat.uniforms.boneTex.value = p.tex;
        p.tex.userData.rows = this.noGL ? p.rows : null;
      }
    }
  }

  sortBackToFront(pool, eye) {
    const count = pool.n,
      matrices = pool.im.instanceMatrix.array,
      center = pool.im.boundingSphere.center;
    let sumX = 0,
      sumY = 0,
      sumZ = 0;
    for (let i = 0; i < count; i++) {
      sumX += matrices[i * 16 + 12];
      sumY += matrices[i * 16 + 13];
      sumZ += matrices[i * 16 + 14];
    }
    center.set(sumX / count, sumY / count, sumZ / count);
    if (!eye || count < 2) return;
    if (!pool.order || pool.order.length < pool.cap) {
      pool.order = new Uint32Array(pool.cap);
      pool.distances = new Float32Array(pool.cap);
      pool.scratch = new Float32Array(pool.cap * 16);
    }
    const order = pool.order,
      distances = pool.distances,
      scratch = pool.scratch;
    for (let i = 0; i < count; i++) {
      const at = i * 16;
      order[i] = i;
      distances[i] = (matrices[at + 12] - eye.x) ** 2 + (matrices[at + 13] - eye.y) ** 2 + (matrices[at + 14] - eye.z) ** 2;
    }
    const sorted = order.subarray(0, count).sort((a, b) => distances[b] - distances[a]);
    scratch.set(matrices.subarray(0, count * 16));
    for (let i = 0; i < count; i++) matrices.set(scratch.subarray(sorted[i] * 16, sorted[i] * 16 + 16), i * 16);
  }

  sendBones(p) {
    const R = this.renderer,
      tex = p.tex;
    if (R && R.isMirror) {
      R.sendRows(tex, ROW, p.n);
      return;
    }
    const props = R && R.properties.get(tex);
    if (!props || !props.__webglTexture || props.__version !== tex.version) {
      tex.needsUpdate = true;
      return;
    }
    const gl = R.getContext();
    R.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, p.n, gl.RGBA, gl.FLOAT, tex.image.data, 0);
  }

  restore() {
    for (const h of this.out) {
      h.visible = true;
      h.matrixWorldAutoUpdate = true;
    }
    for (const h of this.own) h.matrixWorldAutoUpdate = true;
    for (const o of this.hid) o.visible = true;
    this.out.length = 0;
    this.own.length = 0;
    this.hid.length = 0;
  }
}
