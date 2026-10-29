import * as THREE from 'three';

const BEFORE = THREE.Object3D.prototype.onBeforeRender;
const STRIDE = 24;
const _frustum = new THREE.Frustum(),
  _proj = new THREE.Matrix4(),
  _v4 = new THREE.Vector4();
const MAT_SKIP = new Set([
  'uuid',
  'name',
  'type',
  'userData',
  '_listeners',
  'version',
  'uniforms',
  'uniformsGroups',
  'vertexShader',
  'fragmentShader',
  'defines',
  'extensions',
  'defaultAttributeValues',
  'index0AttributeName',
  'uniformsNeedUpdate',
  'glslVersion',
  'id',
  '_m'
]);
const TEX_SKIP = new Set([
  'uuid',
  'name',
  'source',
  'userData',
  'version',
  'onUpdate',
  '_listeners',
  'image',
  'mipmaps',
  'matrix',
  'offset',
  'repeat',
  'center',
  'layerUpdates',
  'pmremVersion',
  'id',
  '_m'
]);

export function mirrorSupported() {
  return (
    typeof OffscreenCanvas !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'transferControlToOffscreen' in HTMLCanvasElement.prototype
  );
}

function kindOf(v) {
  if (v === null || typeof v !== 'object') return 0;
  if (v.isTexture) return 1;
  if (v.isMatrix4 || v.isMatrix3) return 2;
  if (v.isVector2) return 3;
  if (v.isVector3) return 4;
  if (v.isVector4) return 5;
  if (v.isColor) return 6;
  if (v.isQuaternion) return 7;
  if (ArrayBuffer.isView(v)) return 8;
  if (Array.isArray(v)) return 9;
  if (v.isEuler) return 11;
  return 10;
}

let active = null;

function own(x, s) {
  Object.defineProperty(x, '_m', { value: s, enumerable: false, writable: true, configurable: true });
  return s;
}

function dirty(x, list) {
  const s = x._m;
  if (s && !s.dirty && active) {
    s.dirty = true;
    active[list].push(x);
  }
}

let tracked = false;
function track() {
  if (tracked) return;
  tracked = true;
  const wrapSetter = (proto, list) => {
    const d = Object.getOwnPropertyDescriptor(proto, 'needsUpdate');
    Object.defineProperty(proto, 'needsUpdate', {
      get: d.get,
      set(v) {
        d.set.call(this, v);
        if (v === true) dirty(this, list);
      },
      configurable: true
    });
  };
  wrapSetter(THREE.BufferAttribute.prototype, 'dAttrs');
  wrapSetter(THREE.Texture.prototype, 'dTexs');
  wrapSetter(THREE.Material.prototype, 'dMats');
  const G = THREE.BufferGeometry.prototype;
  for (const k of ['setAttribute', 'deleteAttribute', 'setIndex', 'addGroup', 'clearGroups', 'setDrawRange']) {
    const f = G[k];
    G[k] = function (...a) {
      const r = f.apply(this, a);
      dirty(this, 'dGeos');
      return r;
    };
  }
}

const propDesc = new Map();
function propSetter(k) {
  let d = propDesc.get(k);
  if (!d) {
    d = {
      get() {
        return this._m.v[k];
      },
      set(x) {
        const s = this._m;
        if (s.v[k] !== x) {
          s.v[k] = x;
          dirty(this, 'dMats');
        }
      },
      enumerable: true,
      configurable: true
    };
    propDesc.set(k, d);
  }
  return d;
}
const valueDesc = {
  get() {
    return this._m.v;
  },
  set(x) {
    const s = this._m;
    if (s.v !== x) {
      s.v = x;
      dirty(this, 'dUnis');
    }
  },
  enumerable: true,
  configurable: true
};
const uniformsDesc = {
  get() {
    return this._m.v.uniforms;
  },
  set(x) {
    this._m.v.uniforms = x;
    this._m.restruct = true;
    dirty(this, 'dMats');
  },
  enumerable: true,
  configurable: true
};
const keyDesc = new Map();
function keySetter(k) {
  let d = keyDesc.get(k);
  if (!d) {
    d = {
      get() {
        return this._m.v[k];
      },
      set(x) {
        const s = this._m;
        s.v[k] = x;
        for (const m of s.owners) {
          m._m.restruct = true;
          dirty(m, 'dMats');
        }
      },
      enumerable: true,
      configurable: true
    };
    keyDesc.set(k, d);
  }
  return d;
}

export class MirrorRenderer {
  constructor(params = {}) {
    this.isMirror = true;
    track();
    active = this;
    const canvas = (this.domElement = document.createElement('canvas'));
    canvas.style.display = 'block';
    this.width = canvas.width;
    this.height = canvas.height;
    this.pixelRatio = 1;
    const off = canvas.transferControlToOffscreen();
    this.done = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated ? new Int32Array(new SharedArrayBuffer(4)) : null;
    this.worker = new Worker(new URL('./renderworker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = e => this.answer(e.data);
    this.worker.onerror = e => console.warn('render worker failed', e.message || e);
    this.worker.postMessage({ init: { canvas: off, params: { ...params }, done: this.done } }, [off]);
    this.webgpu = !!params.webgpu;
    if (this.webgpu) canvas.style.transform = 'scaleY(-1)';

    this.autoClear = this.autoClearColor = this.autoClearDepth = this.autoClearStencil = true;
    this.sortObjects = true;
    this.outputColorSpace = THREE.SRGBColorSpace;
    this.toneMapping = THREE.NoToneMapping;
    this.toneMappingExposure = 1;
    this.localClippingEnabled = false;
    this.clippingPlanes = [];
    this.debug = { checkShaderErrors: true, onShaderError: null };
    const info = (this.info = {
      autoReset: true,
      memory: { geometries: 0, textures: 0 },
      render: { frame: 0, calls: 0, triangles: 0, points: 0, lines: 0 },
      programs: [],
      reset() {
        info.render.calls = info.render.triangles = info.render.points = info.render.lines = 0;
      }
    });
    this.extensions = { get: () => null, has: () => false, init() {} };
    this.capabilities = { isWebGL2: true, maxTextures: 16, precision: 'highp', logarithmicDepthBuffer: false };
    this.shadowMap = { enabled: false, autoUpdate: true, needsUpdate: false, type: THREE.PCFShadowMap };
    this.state = { buffers: { depth: { setMask: b => this.ops.push(['depthMask', !!b]) } } };
    this.properties = { get: t => ({ __version: t._m && !t._m.dirty ? t._m.version : -1 }) };

    this.clear0 = new THREE.Color(0x000000);
    this.clearA = params.alpha === true ? 0 : 1;
    this.target = null;
    this.sentState = {};
    this.ops = [];
    this.xfer = [];
    this.next = 1;
    this.frameNo = 0;
    this.pass = 0;
    this.pending = 0;
    this.jobs = new Map();
    this.reads = new Map();
    this.buf = new Float64Array(STRIDE * 1024);
    this.dAttrs = [];
    this.dTexs = [];
    this.dMats = [];
    this.dGeos = [];
    this.dUnis = [];
    this.inPlace = [];
    this.rowOps = new Map();
    this.rangeOps = new Map();
    this.compiling = false;
    this.arena = [null, null, null];
    this.arenaPar = -1;
    this.arenaAt = 0;
    this.sabs = new WeakMap();
    this.gone = new FinalizationRegistry(id => this.ops.push(['gc', id]));
    this.goneU = new FinalizationRegistry(s => {
      s.dead = true;
    });
    this.warned = new Set();
  }

  getPixelRatio() {
    return this.pixelRatio;
  }
  setPixelRatio(v) {
    if (v === undefined) return;
    this.pixelRatio = v;
    this.setSize(this.width, this.height, false);
  }
  getSize(t) {
    return t.set(this.width, this.height);
  }
  getDrawingBufferSize(t) {
    return t.set(this.width * this.pixelRatio, this.height * this.pixelRatio).floor();
  }
  setSize(w, h, updateStyle = true) {
    this.width = w;
    this.height = h;
    if (updateStyle !== false) {
      this.domElement.style.width = w + 'px';
      this.domElement.style.height = h + 'px';
    }
    this.ops.push(['size', w, h, this.pixelRatio]);
  }
  setViewport(x, y, w, h) {
    if (x.isVector4) this.ops.push(['viewport', x.x, x.y, x.z, x.w]);
    else this.ops.push(['viewport', x, y, w, h]);
  }
  setScissor(x, y, w, h) {
    if (x.isVector4) this.ops.push(['scissor', x.x, x.y, x.z, x.w]);
    else this.ops.push(['scissor', x, y, w, h]);
  }
  setScissorTest(b) {
    this.ops.push(['scissorTest', !!b]);
  }
  getClearColor(t) {
    return t.copy(this.clear0);
  }
  setClearColor(c, a = 1) {
    this.clear0.set(c);
    this.clearA = a;
    this.ops.push(['clearColor', this.clear0.r, this.clear0.g, this.clear0.b, a]);
  }
  getClearAlpha() {
    return this.clearA;
  }
  setClearAlpha(a) {
    this.clearA = a;
    this.ops.push(['clearColor', this.clear0.r, this.clear0.g, this.clear0.b, a]);
  }
  clear(c = true, d = true, s = true) {
    this.ops.push(['clear', !!c, !!d, !!s]);
  }
  clearColor() {
    this.clear(true, false, false);
  }
  clearDepth() {
    this.clear(false, true, false);
  }
  clearStencil() {
    this.clear(false, false, true);
  }
  getRenderTarget() {
    return this.target;
  }
  setRenderTarget(t, face = 0, level = 0) {
    this.target = t;
    this.ops.push(['target', t ? this.rt(t) : 0, face, level]);
  }
  getContext() {
    return null;
  }
  initTexture(t) {
    const id = this.tex(t);
    if (t._m.dirty) {
      t._m.dirty = false;
      this.texSend(t);
    }
    this.ops.push(['initTexture', id]);
  }
  dispose() {
    this.worker.terminate();
    if (active === this) active = null;
  }
  forceContextLoss() {}

  compile(object, camera, scene = null) {
    this.compileJob(object, camera, false);
    return new Set();
  }
  compileAsync(object, camera, scene = null) {
    return this.compileJob(object, camera, true);
  }
  compileJob(object, camera, async) {
    const list = [];
    this.pass++;
    this.compiling = true;
    object.traverse(o => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material) return;
      const m = o.material,
        ids = Array.isArray(m) ? m.map(x => this.mat(x)) : this.mat(m);
      const oid = this.obj(o),
        gid = this.geo(o.geometry);
      if (o.isInstancedMesh) this.inst(o);
      list.push([oid, gid, ids]);
    });
    this.compiling = false;
    this.drain();
    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();
    const job = this.next++;
    this.ops.push(['compile', job, this.cam(camera), list, async]);
    this.send(false);
    if (!async) return;
    return new Promise(res => this.jobs.set(job, res));
  }

  render(scene, camera) {
    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();
    if (scene.onBeforeRender !== BEFORE) this.warn('scene.onBeforeRender');
    this.pass++;
    this.sync();
    _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_proj);
    this.n = 0;
    this.arrs = [];
    this.ovr = [];
    this.scn = scene;
    this.camNow = camera;
    this.walk(scene, camera, 0);
    this.drain();
    const items = this.buf.slice(0, this.n * STRIDE);
    this.xfer.push(items.buffer);
    this.ops.push(['render', this.cam(camera), items, this.arrs, this.ovr, this.sceneOf(scene)]);
    this.rowOps.clear();
    this.rangeOps.clear();
  }

  flush() {
    this.frameNo++;
    this.rowOps.clear();
    this.rangeOps.clear();
    return this.send(true);
  }

  skip() {
    const A = this.dAttrs;
    for (let i = 0; i < A.length; i++) {
      A[i]._m.dirty = false;
      this.attrSend(A[i]);
    }
    A.length = 0;
  }

  get shared() {
    return !!this.done;
  }
  parity() {
    return (this.frameNo + 1) % 3;
  }

  behind() {
    return this.done ? this.frameNo - Atomics.load(this.done, 0) >= 2 : this.pending >= 1;
  }

  idle() {
    const at = this.frameNo;
    const drawn = new Promise(res => {
      const t = () => (this.drawnUpTo() >= at ? res() : setTimeout(t, 2));
      t();
    });
    if (!this.webgpu) return drawn;
    return drawn.then(() => {
      const id = this.next++;
      this.ops.push(['settle', id]);
      this.send(false);
      return new Promise(res => this.jobs.set(id, res));
    });
  }

  gpuEnv(lighting, sources) {
    const ids = {};
    for (const k in lighting) ids[k] = this.uni(lighting[k]);
    this.ops.push(['gpuEnv', ids, { ...sources }]);
  }
  drawnUpTo() {
    return this.done ? Atomics.load(this.done, 0) : this.frameNo - this.pending;
  }

  readPixels() {
    const id = this.next++;
    this.ops.push(['read', id]);
    return new Promise(res => this.reads.set(id, res));
  }

  send(frame) {
    if (!this.ops.length) return false;
    const ops = this.ops,
      xfer = this.xfer;
    this.ops = [];
    this.xfer = [];
    this.rowOps.clear();
    this.rangeOps.clear();
    if (frame) this.pending++;
    if (frame && this.trace) this.trace.push([this.frameNo, performance.timeOrigin + performance.now(), 'sent']);
    this.worker.postMessage({ ops, frame: frame ? this.frameNo : 0 }, xfer);
    return true;
  }

  answer(d) {
    if (d.done) {
      this.pending = Math.max(0, this.pending - 1);
      const r = this.info.render;
      r.frame++;
      r.calls += d.calls;
      r.triangles += d.triangles;
      r.points += d.points;
      r.lines += d.lines;
      this.info.programs = { length: d.programs };
      this.workMs = (this.workMs || 0) + d.ms;
      this.workN = (this.workN || 0) + 1;
      if (this.trace) this.trace.push([d.done, d.at, d.end]);
    }
    if (d.compiled) {
      const res = this.jobs.get(d.compiled);
      this.jobs.delete(d.compiled);
      if (res) res();
    }
    if (d.read) {
      const res = this.reads.get(d.read);
      this.reads.delete(d.read);
      if (res) res(d.pixels);
    }
    if (d.error) console.warn('render worker:', d.error);
  }

  warn(what) {
    if (!this.warned.has(what)) {
      this.warned.add(what);
      console.warn('mirror renderer: not drawn as three would -', what);
    }
  }

  give(a) {
    const c = a.slice();
    this.xfer.push(c.buffer);
    return c;
  }

  stream(a) {
    if (!this.done || !(a instanceof Float32Array)) return this.give(a);
    const par = this.parity();
    if (this.arenaPar !== par) {
      this.arenaPar = par;
      this.arenaAt = 0;
    }
    let A = this.arena[par];
    if (!A || this.arenaAt + a.length > A.length) {
      let n = A ? A.length : 1 << 20;
      while (n < (this.arenaAt + a.length) * 1.5) n *= 2;
      A = this.arena[par] = new Float32Array(new SharedArrayBuffer(n * 4));
      this.ops.push(['arena', par, A]);
      this.arenaAt = 0;
    }
    const at = this.arenaAt;
    A.set(a, at);
    this.arenaAt += a.length;
    return [par, at, a.length];
  }

  sync() {
    const was = this.sentState;
    let d = null;
    const set = (k, v) => {
      if (was[k] !== v) {
        was[k] = v;
        (d ||= {})[k] = v;
      }
    };
    set('autoClear', this.autoClear);
    set('autoClearColor', this.autoClearColor);
    set('autoClearDepth', this.autoClearDepth);
    set('autoClearStencil', this.autoClearStencil);
    set('sortObjects', this.sortObjects);
    set('outputColorSpace', this.outputColorSpace);
    set('toneMapping', this.toneMapping);
    set('toneMappingExposure', this.toneMappingExposure);
    set('checkShaderErrors', this.debug.checkShaderErrors);
    set('localClippingEnabled', this.localClippingEnabled);
    if (this.clippingPlanes.length) this.warn('renderer.clippingPlanes');
    if (d) this.ops.push(['state', d]);
  }

  sceneOf(scene) {
    const b = scene.background,
      f = scene.fog;
    if (scene.overrideMaterial) this.warn('scene.overrideMaterial');
    if (scene.environment) this.warn('scene.environment');
    let bg = null;
    if (b && b.isColor) bg = [b.r, b.g, b.b];
    else if (b) this.warn('scene.background other than a colour');
    const fog = f
      ? f.isFogExp2
        ? { exp2: true, color: [f.color.r, f.color.g, f.color.b], density: f.density }
        : { color: [f.color.r, f.color.g, f.color.b], near: f.near, far: f.far }
      : null;
    return { bg, fog };
  }

  cam(c) {
    return {
      k: c.isOrthographicCamera ? 'O' : 'P',
      p: c.projectionMatrix.elements.slice(),
      pi: c.projectionMatrixInverse.elements.slice(),
      w: c.matrixWorld.elements.slice(),
      wi: c.matrixWorldInverse.elements.slice(),
      near: c.near,
      far: c.far
    };
  }

  walk(o, camera, groupOrder) {
    if (o.visible === false) return;
    if (o.layers.test(camera.layers)) {
      if (o.isGroup) groupOrder = o.renderOrder;
      else if (o.isLOD) {
        if (o.autoUpdate === true) o.update(camera);
      } else if (o.isLight) this.warn('lights');
      else if (o.isSprite) {
        if (!o.frustumCulled || _frustum.intersectsSprite(o)) {
          if (this.sortObjects) _v4.setFromMatrixPosition(o.matrixWorld).applyMatrix4(_proj);
          if (o.material.visible) this.item(o, groupOrder, _v4.z);
        }
      } else if (o.isMesh || o.isLine || o.isPoints) {
        if (!o.frustumCulled || _frustum.intersectsObject(o)) {
          const geometry = o.geometry,
            material = o.material;
          if (this.sortObjects) {
            if (o.boundingSphere !== undefined) {
              if (o.boundingSphere === null) o.computeBoundingSphere();
              _v4.copy(o.boundingSphere.center);
            } else {
              if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
              _v4.copy(geometry.boundingSphere.center);
            }
            _v4.applyMatrix4(o.matrixWorld).applyMatrix4(_proj);
          }
          if (Array.isArray(material)) {
            let any = false;
            for (const g of geometry.groups) {
              const gm = material[g.materialIndex];
              if (gm && gm.visible) {
                any = true;
                break;
              }
            }
            if (any) this.item(o, groupOrder, _v4.z);
          } else if (material.visible) this.item(o, groupOrder, _v4.z);
        }
      }
    }
    const c = o.children;
    for (let i = 0, l = c.length; i < l; i++) this.walk(c[i], camera, groupOrder);
  }

  item(o, groupOrder, z) {
    const oid = o._m ? o._m.id : this.obj(o),
      m = o.material;
    const g = o.geometry,
      gid = g._m && g._m.frame === this.frameNo ? g._m.id : this.geo(g);
    let kind = 0,
      ref;
    if (Array.isArray(m)) {
      kind = 1;
      ref = this.arrs.length;
      this.arrs.push(m.map(x => this.mat(x)));
    } else ref = m._m && m._m.frame === this.frameNo ? m._m.id : this.mat(m);
    if (o.isInstancedMesh) this.inst(o);
    else if (o.morphTargetInfluences && o.morphTargetInfluences.length) this.warn('morph targets');
    const ov = o.onBeforeRender !== BEFORE ? this.hooked(o, m) : -1;
    if (this.n * STRIDE >= this.buf.length) {
      const b = new Float64Array(this.buf.length * 2);
      b.set(this.buf);
      this.buf = b;
    }
    const B = this.buf,
      at = this.n++ * STRIDE,
      e = o.matrixWorld.elements;
    B[at] = oid;
    B[at + 1] = gid;
    B[at + 2] = kind;
    B[at + 3] = ref;
    B[at + 4] = groupOrder;
    B[at + 5] = o.renderOrder;
    B[at + 6] = z;
    B[at + 7] = ov;
    for (let k = 0; k < 16; k++) B[at + 8 + k] = e[k];
  }

  hooked(o, m) {
    const list = [],
      scene = this.scn,
      camera = this.camNow,
      geometry = o.geometry;
    const one = (mat, group) => {
      o.onBeforeRender(this, scene, camera, geometry, mat, group);
      const S = mat._m,
        set = [];
      if (S && S.uo)
        for (let i = 0; i < S.uo.length; i++) {
          const u = S.uo[i],
            s = u._m;
          if (!this.same(s, s.v)) set.push([s.id, this.enc(s.v)]);
        }
      o.onAfterRender(this, scene, camera, geometry, mat, group);
      if (set.length) list.push([S.id, set]);
    };
    if (Array.isArray(m)) {
      for (const g of o.geometry.groups) {
        const gm = m[g.materialIndex];
        if (gm && gm.visible) one(gm, g);
      }
    } else one(m, null);
    if (!list.length) return -1;
    this.ovr.push(list);
    return this.ovr.length - 1;
  }

  state0(x, s) {
    s.id = this.next++;
    s.dirty = false;
    own(x, s);
    this.gone.register(x, s.id);
    return s;
  }

  drain() {
    const M = this.dMats;
    for (let i = 0; i < M.length; i++) {
      M[i]._m.dirty = false;
      this.matChanged(M[i]);
    }
    M.length = 0;
    const G = this.dGeos;
    for (let i = 0; i < G.length; i++) {
      G[i]._m.dirty = false;
      this.geoSend(G[i]);
    }
    G.length = 0;
    const A = this.dAttrs;
    for (let i = 0; i < A.length; i++) {
      A[i]._m.dirty = false;
      this.attrSend(A[i]);
    }
    A.length = 0;
    const T = this.dTexs;
    for (let i = 0; i < T.length; i++) {
      T[i]._m.dirty = false;
      this.texSend(T[i]);
    }
    T.length = 0;
    const U = this.dUnis;
    for (let i = 0; i < U.length; i++) {
      const u = U[i];
      u._m.dirty = false;
      this.uniSend(u);
    }
    U.length = 0;
    const P = this.inPlace;
    let j = 0;
    for (let i = 0; i < P.length; i++) {
      const s = P[i];
      if (s.dead) continue;
      P[j++] = s;
      const v = s.v,
        L = s.last;
      let same;
      switch (s.k) {
        case 4:
          same = v != null && v.isVector3 === true && L[0] === v.x && L[1] === v.y && L[2] === v.z;
          break;
        case 5:
          same = v != null && v.isVector4 === true && L[0] === v.x && L[1] === v.y && L[2] === v.z && L[3] === v.w;
          break;
        case 6:
          same = v != null && v.isColor === true && L[0] === v.r && L[1] === v.g && L[2] === v.b;
          break;
        case 3:
          same = v != null && v.isVector2 === true && L[0] === v.x && L[1] === v.y;
          break;
        case 0:
        case 1:
          continue;
        default:
          same = this.same(s, v);
      }
      if (!same) {
        this.take(s, v);
        this.ops.push(['u', s.id, this.enc(v)]);
      }
    }
    P.length = j;
  }

  obj(o) {
    if (o._m) return o._m.id;
    const s = this.state0(o, { count: -1, im: null, ic: null });
    const kind = o.isInstancedMesh
      ? 'InstancedMesh'
      : o.isMesh
        ? 'Mesh'
        : o.isPoints
          ? 'Points'
          : o.isLineSegments
            ? 'LineSegments'
            : o.isLineLoop
              ? 'LineLoop'
              : o.isLine
                ? 'Line'
                : o.isSprite
                  ? 'Sprite'
                  : 'Mesh';
    if (o.isSkinnedMesh) this.warn('SkinnedMesh');
    if (o.isBatchedMesh) this.warn('BatchedMesh');
    this.ops.push(['obj', s.id, kind, o.id]);
    return s.id;
  }

  inst(o) {
    const s = o._m,
      im = o.instanceMatrix,
      ic = o.instanceColor;
    if (s.count !== o.count || s.im !== im || s.ic !== ic) {
      s.count = o.count;
      s.im = im;
      s.ic = ic;
      this.ops.push(['inst', s.id, o.count, this.attr(im), ic ? this.attr(ic) : 0]);
    }
    if (o.morphTexture) this.warn('morph texture');
  }

  attr(a) {
    if (a._m) return a._m.id;
    if (a.isInterleavedBufferAttribute) {
      this.warn('interleaved attributes');
      return 0;
    }
    const s = this.state0(a, { version: a.version, array: a.array });
    this.ops.push([
      'attr',
      s.id,
      {
        array: this.give(a.array),
        itemSize: a.itemSize,
        normalized: a.normalized,
        usage: a.usage,
        gpuType: a.gpuType,
        instanced: !!a.isInstancedBufferAttribute,
        meshPerAttribute: a.meshPerAttribute || 1
      }
    ]);
    a.clearUpdateRanges();
    return s.id;
  }

  attrSend(a) {
    const s = a._m;
    if (s.array !== a.array) {
      s.array = a.array;
      s.version = a.version;
      this.ops.push(['attrArray', s.id, this.give(a.array)]);
      a.clearUpdateRanges();
      return;
    }
    if (s.version === a.version) return;
    s.version = a.version;
    const R = a.updateRanges;
    if (!R.length) {
      this.ops.push(['attrArray', s.id, this.give(a.array)]);
      return;
    }
    if (R.length === 1 && R[0].start === 0) {
      const end = R[0].count === -1 ? a.array.length : R[0].count,
        at = this.rangeOps.get(s.id);
      if (at !== undefined && this.ops[at] && this.ops[at][1] === s.id && this.ops[at][3] <= end) {
        this.ops[at] = ['attrRanges', s.id, [0, this.stream(a.array.subarray(0, end))], end];
        a.clearUpdateRanges();
        return;
      }
      this.rangeOps.set(s.id, this.ops.length);
      this.ops.push(['attrRanges', s.id, [0, this.stream(a.array.subarray(0, end))], end]);
      a.clearUpdateRanges();
      return;
    }
    const parts = [];
    for (const r of R) {
      const end = r.count === -1 ? a.array.length : r.start + r.count;
      parts.push(r.start, this.stream(a.array.subarray(r.start, end)));
    }
    this.ops.push(['attrRanges', s.id, parts, -1]);
    a.clearUpdateRanges();
  }

  geo(g) {
    let s = g._m;
    if (!s) {
      s = this.state0(g, { frame: -1 });
      const id = s.id;
      g.addEventListener('dispose', () => this.ops.push(['dispose', id]));
      this.ops.push(['geo', id, g.isInstancedBufferGeometry ? 'InstancedBufferGeometry' : 'BufferGeometry']);
      this.geoSend(g);
    }
    if (s.frame === this.frameNo) return s.id;
    if (!this.compiling) s.frame = this.frameNo;
    const R = g.drawRange;
    if (
      g.index !== s.index ||
      R.start !== s.start ||
      R.count !== s.count ||
      g.instanceCount !== s.ic ||
      g.groups.length !== s.groups.length
    )
      this.geoSend(g);
    return s.id;
  }

  geoSend(g) {
    const s = g._m,
      A = g.attributes,
      R = g.drawRange,
      attrs = {};
    for (const k in A) attrs[k] = this.attr(A[k]);
    s.index = g.index;
    s.start = R.start;
    s.count = R.count;
    s.ic = g.instanceCount;
    s.groups = g.groups.map(x => [x.start, x.count, x.materialIndex]);
    if (Object.keys(g.morphAttributes).length) this.warn('morph attributes');
    this.ops.push([
      'geoSet',
      s.id,
      { attrs, index: g.index ? this.attr(g.index) : 0, drawRange: [R.start, R.count], groups: s.groups, instanceCount: g.instanceCount }
    ]);
  }

  mat(m) {
    let s = m._m;
    if (!s) return this.matNew(m);
    if (s.frame === this.frameNo) return s.id;
    if (!this.compiling) s.frame = this.frameNo;
    const O = s.objProps;
    if (O.length) {
      let d = null;
      for (const i of O) {
        const k = s.props[i],
          v = m[k],
          t = s.pst[i];
        if (!this.same(t, v)) {
          this.take(t, v);
          (d ||= {})[k] = this.enc(v);
        }
      }
      if (d) this.ops.push(['matProps', s.id, d]);
    }
    return s.id;
  }

  matNew(m) {
    const props = Object.keys(m).filter(k => !MAT_SKIP.has(k) && !k.startsWith('is') && typeof m[k] !== 'function');
    const s = this.state0(m, {
      frame: this.compiling ? -1 : this.frameNo,
      version: m.version,
      vs: m.vertexShader,
      fs: m.fragmentShader,
      props,
      pst: props.map(() => ({ k: -1 })),
      objProps: [],
      uk: null,
      uo: null,
      v: {},
      restruct: false
    });
    const id = s.id;
    m.addEventListener('dispose', () => this.ops.push(['dispose', id]));
    const p = {};
    props.forEach((k, i) => {
      const v = m[k];
      this.take(s.pst[i], v);
      p[k] = this.enc(v);
      if (v !== null && typeof v === 'object' && !v.isTexture) s.objProps.push(i);
      else {
        s.v[k] = v;
        Object.defineProperty(m, k, propSetter(k));
      }
    });
    s.v.uniforms = m.uniforms;
    Object.defineProperty(m, 'uniforms', uniformsDesc);
    const def = { type: m.type, sid: m.id, props: p, version: this.shaderOf(m), uniforms: this.uniMap(m, s) };
    this.ops.push(['mat', id, def]);
    return id;
  }

  matChanged(m) {
    const s = m._m;
    if (s.version !== m.version || s.vs !== m.vertexShader || s.fs !== m.fragmentShader) {
      s.version = m.version;
      s.vs = m.vertexShader;
      s.fs = m.fragmentShader;
      this.ops.push(['matVersion', s.id, this.shaderOf(m)]);
    }
    let d = null;
    const P = s.props,
      T = s.pst;
    for (let i = 0; i < P.length; i++) {
      const v = m[P[i]],
        t = T[i];
      if (!this.same(t, v)) {
        this.take(t, v);
        (d ||= {})[P[i]] = this.enc(v);
      }
    }
    if (d) this.ops.push(['matProps', s.id, d]);
    if (s.restruct) {
      s.restruct = false;
      this.ops.push(['matUniforms', s.id, this.uniMap(m, s)]);
    }
  }

  shaderOf(m) {
    if (m.uniformsGroups && m.uniformsGroups.length) this.warn('uniform groups');
    return m.isShaderMaterial
      ? {
          vs: m.vertexShader,
          fs: m.fragmentShader,
          defines: m.defines ? { ...m.defines } : undefined,
          extensions: m.extensions ? { ...m.extensions } : undefined,
          glslVersion: m.glslVersion,
          index0AttributeName: m.index0AttributeName
        }
      : {};
  }

  uniMap(m, s) {
    const U = m.uniforms;
    if (!U) {
      s.uk = [];
      s.uo = [];
      return null;
    }
    let us = U._m;
    if (!us) {
      us = own(U, { v: {}, owners: [] });
      for (const k of Object.keys(U)) {
        us.v[k] = U[k];
        Object.defineProperty(U, k, keySetter(k));
      }
    }
    if (!us.owners.includes(m)) us.owners.push(m);
    const map = {};
    s.uk = [];
    s.uo = [];
    for (const k in U) {
      const u = U[k];
      map[k] = this.uni(u);
      s.uk.push(k);
      s.uo.push(u);
    }
    return map;
  }

  uni(u) {
    if (u._m) return u._m.id;
    const s = this.state0(u, { k: -1, last: undefined, ref: undefined, v: u.value, cmp: false });
    Object.defineProperty(u, 'value', valueDesc);
    this.take(s, s.v);
    this.ops.push(['u', s.id, this.enc(s.v)]);
    this.inPlaceCheck(u, s);
    return s.id;
  }

  inPlaceCheck(u, s) {
    if (s.k >= 2 && !s.cmp) {
      s.cmp = true;
      this.inPlace.push(s);
      this.goneU.register(u, s);
    }
  }

  uniSend(u) {
    const s = u._m;
    if (this.same(s, s.v)) return;
    this.take(s, s.v);
    this.ops.push(['u', s.id, this.enc(s.v)]);
    this.inPlaceCheck(u, s);
  }

  same(s, v) {
    const L = s.last;
    switch (s.k) {
      case 0:
        return L === v && (v === null || typeof v !== 'object');
      case 1:
        return L === v;
      case 2: {
        if (!v || !v.elements) return false;
        const e = v.elements;
        if (L.length !== e.length) return false;
        for (let i = 0; i < e.length; i++) if (L[i] !== e[i]) return false;
        return true;
      }
      case 3:
        return !!v && v.isVector2 === true && L[0] === v.x && L[1] === v.y;
      case 4:
        return !!v && v.isVector3 === true && L[0] === v.x && L[1] === v.y && L[2] === v.z;
      case 5:
        return !!v && v.isVector4 === true && L[0] === v.x && L[1] === v.y && L[2] === v.z && L[3] === v.w;
      case 6:
        return !!v && v.isColor === true && L[0] === v.r && L[1] === v.g && L[2] === v.b;
      case 7:
        return !!v && v.isQuaternion === true && L[0] === v.x && L[1] === v.y && L[2] === v.z && L[3] === v.w;
      case 8: {
        if (s.ref !== v || L.length !== v.length) return false;
        for (let i = 0; i < v.length; i++) if (L[i] !== v[i]) return false;
        return true;
      }
      case 11:
        return !!v && v.isEuler === true && L[0] === v.x && L[1] === v.y && L[2] === v.z && L[3] === v.order;
      case 9:
      case 10:
        return kindOf(v) === s.k && L === JSON.stringify(this.enc(v));
      default:
        return false;
    }
  }

  take(s, v) {
    const k = (s.k = kindOf(v));
    s.ref = v;
    switch (k) {
      case 0:
      case 1:
        s.last = v;
        break;
      case 2:
        s.last = v.elements.slice();
        break;
      case 3:
        s.last = [v.x, v.y];
        break;
      case 4:
        s.last = [v.x, v.y, v.z];
        break;
      case 5:
      case 7:
        s.last = [v.x, v.y, v.z, v.w];
        break;
      case 6:
        s.last = [v.r, v.g, v.b];
        break;
      case 8:
        s.last = v.slice();
        break;
      case 11:
        s.last = [v.x, v.y, v.z, v.order];
        break;
      default:
        s.last = JSON.stringify(this.enc(v));
        break;
    }
  }

  enc(v) {
    switch (kindOf(v)) {
      case 0:
        return [0, v];
      case 1:
        return [1, this.tex(v)];
      case 2:
        return [2, v.elements.slice()];
      case 3:
        return [3, v.x, v.y];
      case 4:
        return [4, v.x, v.y, v.z];
      case 5:
        return [5, v.x, v.y, v.z, v.w];
      case 6:
        return [6, v.r, v.g, v.b];
      case 7:
        return [7, v.x, v.y, v.z, v.w];
      case 8:
        return [8, v.slice()];
      case 9:
        return [9, v.map(x => this.enc(x))];
      case 11:
        return [11, v.x, v.y, v.z, v.order];
      default: {
        const o = {};
        for (const k in v) if (typeof v[k] !== 'function') o[k] = this.enc(v[k]);
        return [10, o];
      }
    }
  }

  tex(t) {
    if (t._m) return t._m.id;
    const s = this.state0(t, { version: -1 });
    const id = s.id;
    t.addEventListener('dispose', () => this.ops.push(['dispose', id]));
    this.texSend(t);
    return id;
  }

  texSend(t) {
    const s = t._m;
    if (s.version === t.version) return;
    if ((t.isCompressedTexture || t.isDataTexture) && !(t.mipmaps?.[0]?.data || t.image?.data)) {
      void t.image?.complete;
      return;
    }
    s.version = t.version;
    const props = {};
    for (const k of Object.keys(t)) {
      if (TEX_SKIP.has(k)) continue;
      const v = t[k];
      if (v === null || typeof v !== 'object') {
        if (typeof v !== 'function') props[k] = v;
      } else this.warn('texture property ' + k);
    }
    props.offset = [t.offset.x, t.offset.y];
    props.repeat = [t.repeat.x, t.repeat.y];
    props.center = [t.center.x, t.center.y];
    props.matrix = t.matrix.elements.slice();
    const def = { cls: t.constructor.name, version: t.version, props };
    const img = t.image;
    if (t.isRenderTargetTexture || (t.isDepthTexture && !img?.data))
      def.image = img ? { width: img.width, height: img.height, depth: img.depth } : null;
    else if (t.isCompressedTexture || t.mipmaps?.length) {
      def.image = img ? { width: img.width, height: img.height, depth: img.depth } : null;
      def.mipmaps = t.mipmaps.map(mp =>
        mp.data ? { data: this.give(mp.data), width: mp.width, height: mp.height, depth: mp.depth } : this.pixels(mp)
      );
    } else if (img && img.data !== undefined)
      def.image = { data: img.data ? this.give(img.data) : null, width: img.width, height: img.height, depth: img.depth };
    else if (img) def.image = this.pixels(img, t, s.id);
    else def.image = null;
    if (t.layerUpdates && t.layerUpdates.size) this.warn('texture layer updates');
    this.ops.push(['tex', s.id, def]);
  }

  pixels(img, t, id) {
    if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) {
      const c = img.getContext('2d');
      if (c) return { imageData: c.getImageData(0, 0, img.width, img.height) };
    }
    if (t && typeof createImageBitmap === 'function') {
      const v = t.version;
      createImageBitmap(img, {
        imageOrientation: t.flipY ? 'flipY' : 'from-image',
        premultiplyAlpha: t.premultiplyAlpha ? 'premultiply' : 'none',
        colorSpaceConversion: 'none'
      }).then(
        b => {
          this.ops.push(['texBitmap', id, v, b]);
          this.xfer.push(b);
        },
        () => this.warn('a texture image that could not be copied')
      );
      this.warn('a texture image copied on the side (one picture without it)');
      return { pending: true, width: img.width, height: img.height };
    }
    this.warn('a texture image of a kind not sent');
    return null;
  }

  rt(t) {
    let s = t._m;
    if (!s) {
      s = this.state0(t, { w: -1, h: -1, vp: '' });
      const id = s.id;
      t.addEventListener('dispose', () => this.ops.push(['dispose', id]));
      this.ops.push([
        'rt',
        id,
        {
          width: t.width,
          height: t.height,
          depth: t.depth,
          depthBuffer: t.depthBuffer,
          stencilBuffer: t.stencilBuffer,
          resolveDepthBuffer: t.resolveDepthBuffer,
          resolveStencilBuffer: t.resolveStencilBuffer,
          samples: t.samples,
          textures: t.textures.map(x => this.tex(x)),
          depthTexture: t.depthTexture ? this.tex(t.depthTexture) : 0
        }
      ]);
    }
    const vp = t.viewport.toArray().join() + '|' + t.scissor.toArray().join() + '|' + t.scissorTest;
    if (s.w !== t.width || s.h !== t.height || s.vp !== vp) {
      s.w = t.width;
      s.h = t.height;
      s.vp = vp;
      this.ops.push(['rtSize', s.id, t.width, t.height, t.depth, t.viewport.toArray(), t.scissor.toArray(), t.scissorTest]);
    }
    return s.id;
  }

  sendRows(t, width, rows) {
    const d = t.image.data,
      id = this.tex(t);
    let src;
    if (d.buffer instanceof SharedArrayBuffer) {
      let b = this.sabs.get(d.buffer);
      if (b === undefined) {
        b = this.next++;
        this.sabs.set(d.buffer, b);
        this.ops.push(['sab', b, d.buffer]);
      }
      src = [-1, b, width * rows * 4];
    } else src = this.stream(d.subarray(0, width * rows * 4));
    const op = ['rows', id, width, rows, src];
    const at = this.rowOps.get(id);
    if (at !== undefined && this.ops[at] && this.ops[at][0] === 'rows' && this.ops[at][1] === id) this.ops[at] = op;
    else {
      this.rowOps.set(id, this.ops.length);
      this.ops.push(op);
    }
  }
}
