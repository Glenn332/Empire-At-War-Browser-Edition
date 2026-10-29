import * as THREE from '../../vendor/three/build/three.module.js';
import { families, PARAMS } from './programs.js';
import './programs-galactic.js';
import { env, webkit } from './env.js';

const SLOT = 256;
const SLOTS = 4096;
const PASS = 512;
const PASSES = 64;
const BONES = 1536;
const ARENA = 8 << 20;
const MSAA = 4;
const START_WAIT_MS = 5000;
const DEPTH = 'depth24plus-stencil8';

const WRAP = {
  [THREE.RepeatWrapping]: 'repeat',
  [THREE.ClampToEdgeWrapping]: 'clamp-to-edge',
  [THREE.MirroredRepeatWrapping]: 'mirror-repeat'
};
const COMPARE = ['never', 'always', 'less', 'less-equal', 'equal', 'greater-equal', 'greater', 'not-equal'];
const STENCIL_FN = {
  [THREE.NeverStencilFunc]: 'never',
  [THREE.LessStencilFunc]: 'less',
  [THREE.EqualStencilFunc]: 'equal',
  [THREE.LessEqualStencilFunc]: 'less-equal',
  [THREE.GreaterStencilFunc]: 'greater',
  [THREE.NotEqualStencilFunc]: 'not-equal',
  [THREE.GreaterEqualStencilFunc]: 'greater-equal',
  [THREE.AlwaysStencilFunc]: 'always'
};
const STENCIL_OP = {
  [THREE.ZeroStencilOp]: 'zero',
  [THREE.KeepStencilOp]: 'keep',
  [THREE.ReplaceStencilOp]: 'replace',
  [THREE.IncrementStencilOp]: 'increment-clamp',
  [THREE.DecrementStencilOp]: 'decrement-clamp',
  [THREE.IncrementWrapStencilOp]: 'increment-wrap',
  [THREE.DecrementWrapStencilOp]: 'decrement-wrap',
  [THREE.InvertStencilOp]: 'invert'
};
const FACTOR = {
  [THREE.ZeroFactor]: 'zero',
  [THREE.OneFactor]: 'one',
  [THREE.SrcColorFactor]: 'src',
  [THREE.OneMinusSrcColorFactor]: 'one-minus-src',
  [THREE.SrcAlphaFactor]: 'src-alpha',
  [THREE.OneMinusSrcAlphaFactor]: 'one-minus-src-alpha',
  [THREE.DstAlphaFactor]: 'dst-alpha',
  [THREE.OneMinusDstAlphaFactor]: 'one-minus-dst-alpha',
  [THREE.DstColorFactor]: 'dst',
  [THREE.OneMinusDstColorFactor]: 'one-minus-dst',
  [THREE.SrcAlphaSaturateFactor]: 'src-alpha-saturated'
};
const EQUATION = {
  [THREE.AddEquation]: 'add',
  [THREE.SubtractEquation]: 'subtract',
  [THREE.ReverseSubtractEquation]: 'reverse-subtract',
  [THREE.MinEquation]: 'min',
  [THREE.MaxEquation]: 'max'
};
const MIP_FILTERS = new Set([
  THREE.NearestMipmapNearestFilter,
  THREE.NearestMipmapLinearFilter,
  THREE.LinearMipmapNearestFilter,
  THREE.LinearMipmapLinearFilter
]);

function blendOf(m) {
  if (m.blending === THREE.NoBlending || (m.blending === THREE.NormalBlending && m.transparent === false)) return undefined;
  const add = (s, d, op = 'add') => ({ srcFactor: s, dstFactor: d, operation: op });
  if (m.blending === THREE.CustomBlending) {
    const op = EQUATION[m.blendEquation],
      opA = EQUATION[m.blendEquationAlpha ?? m.blendEquation];
    return {
      color: add(FACTOR[m.blendSrc], FACTOR[m.blendDst], op),
      alpha: add(FACTOR[m.blendSrcAlpha ?? m.blendSrc], FACTOR[m.blendDstAlpha ?? m.blendDst], opA)
    };
  }
  const pre = m.premultipliedAlpha;
  switch (m.blending) {
    case THREE.NormalBlending:
      return pre
        ? { color: add('one', 'one-minus-src-alpha'), alpha: add('one', 'one-minus-src-alpha') }
        : { color: add('src-alpha', 'one-minus-src-alpha'), alpha: add('one', 'one-minus-src-alpha') };
    case THREE.AdditiveBlending:
      return pre
        ? { color: add('one', 'one'), alpha: add('one', 'one') }
        : { color: add('src-alpha', 'one'), alpha: add('src-alpha', 'one') };
    case THREE.SubtractiveBlending:
      return pre
        ? { color: add('zero', 'one-minus-src'), alpha: add('zero', 'one') }
        : { color: add('zero', 'one-minus-src'), alpha: add('zero', 'one') };
    case THREE.MultiplyBlending:
      return pre
        ? { color: add('zero', 'src'), alpha: add('zero', 'src-alpha') }
        : { color: add('zero', 'src'), alpha: add('zero', 'src') };
  }
  return undefined;
}

let attrIds = new WeakMap(),
  nextAttr = 1;
const attrId = a => {
  let id = attrIds.get(a);
  if (!id) attrIds.set(a, (id = nextAttr++));
  return id;
};

const NOOP_OBJECT = THREE.Object3D.prototype.onBeforeRender,
  NOOP_OBJECT_AFTER = THREE.Object3D.prototype.onAfterRender,
  NOOP_MATERIAL = THREE.Material.prototype.onBeforeRender;

const _proj = new THREE.Matrix4(),
  _frustum = new THREE.Frustum(),
  _v4 = new THREE.Vector4(),
  _cam = new THREE.Vector3();

export class GPURenderer {
  static async create(canvas = null) {
    let late = false;
    const within = p =>
      Promise.race([
        p,
        new Promise(r =>
          setTimeout(() => {
            late = true;
            r(null);
          }, START_WAIT_MS)
        )
      ]);
    const adapter = navigator.gpu && (await within(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })));
    if (!adapter || !adapter.features.has('texture-compression-bc')) {
      if (late) console.warn('webgpu: no adapter in ' + START_WAIT_MS + ' ms');
      return null;
    }
    const requiredFeatures = ['texture-compression-bc', 'float32-filterable'].filter(f => adapter.features.has(f));
    const asked = adapter.requestDevice({ requiredFeatures });
    const device = await within(asked);
    if (!device) {
      console.warn('webgpu: no device in ' + START_WAIT_MS + ' ms');
      asked.then(
        d => d && d.destroy(),
        () => {}
      );
      return null;
    }
    return new GPURenderer(device, canvas);
  }

  constructor(device, canvas = null) {
    this.device = device;
    this.depthFormat = DEPTH;
    this.domElement = canvas || document.createElement('canvas');
    this.context = this.domElement.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    if (this.domElement.style) this.domElement.style.transform = 'scaleY(-1)';
    this.context.configure({
      device,
      format: this.format,
      alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    this.autoClear = true;
    this.sortObjects = true;
    this.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.debug = { checkShaderErrors: false };
    this.capabilities = { isWebGL2: true, maxTextureSize: device.limits.maxTextureDimension2D, getMaxAnisotropy: () => 16 };
    this.info = {
      autoReset: true,
      render: { frame: 0, calls: 0, triangles: 0, points: 0, lines: 0 },
      memory: { geometries: 0, textures: 0 },
      programs: null,
      reset() {
        this.render.calls = 0;
        this.render.triangles = 0;
      }
    };
    this.state = { buffers: { depth: { setMask() {} }, color: { setMask() {} } } };
    this.ratio = 1;
    this.width = 1;
    this.height = 1;
    this.cssViewport = [0, 0, 1, 1];
    this.curViewport = null;
    this.target = null;
    this.clears = new Map();
    this.unsupported = new Map();
    this.lists = { opaque: [], transparent: [], items: [], n: 0 };
    this.frameNo = 0;
    this.encoder = null;
    this.canvasTex = null;
    this.capture = null;
    this.textures = new WeakMap();
    this.targets = new WeakMap();
    this.depthViews = new WeakMap();
    this.geos = new WeakMap();
    this.instBufs = new WeakMap();
    this.framedAt = new WeakMap();
    this.geoSeen = new WeakMap();
    this.matState = new WeakMap();
    this.modules = new Map();
    this.pipelines = new Map();
    this.layouts = new Map();
    this.samplers = new Map();
    this.chunks = [];
    this.chunkAt = 0;
    this.arenaObj = null;
    this.retired = [];
    this.retiredSlots = [];
    this.trash = [];
    this.ctxs = new WeakMap();
    this.rec = { vb: [], vo: [] };
    const q = typeof location !== 'undefined' ? location.search : '';
    this.bundles = /[?&]bundle(&|$)/.test(q) || (!webkit && !/[?&]nobundle/.test(q));
    this.bundlesMade = 0;
    this.pending = new Set();
    this.passChunk = null;
    this.passAt = 0;
    this.lighting = env.lighting;
    this.setup();
  }

  setup() {
    const d = this.device,
      V = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.g0 = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PASS } },
        { binding: 1, visibility: V, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: V, sampler: { type: 'comparison' } },
        { binding: 3, visibility: V, texture: { sampleType: 'float' } },
        { binding: 4, visibility: V, sampler: { type: 'filtering' } }
      ]
    });
    this.g2 = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: V, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: SLOT } }]
    });
    this.g3 = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }]
    });
    this.arenaObj = this.makeArena(ARENA);
    this.makeSlots(1024);
    this.passChunk = this.makePassChunk(PASSES);
    this.retiredPass = [];
    const tex = (format, dim = '2d', data) => {
      const t = d.createTexture({
        size: [1, 1, 1],
        format,
        dimension: '2d',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      if (data) d.queue.writeTexture({ texture: t }, data, { bytesPerRow: data.byteLength }, [1, 1, 1]);
      return t.createView({ dimension: dim });
    };
    this.empty = {
      '2d': tex('rgba8unorm', '2d', new Uint8Array([0, 0, 0, 255])),
      '2d-array': tex('rgba8unorm', '2d-array', new Uint8Array([0, 0, 0, 255])),
      'unfilterable-float': tex('rgba32float', '2d', new Float32Array(4))
    };
    this.noDepth = d
      .createTexture({ size: [1, 1], format: DEPTH, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT })
      .createView({ aspect: 'depth-only' });
    this.compareSampler = d.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
    const n = 1 << 16,
      def = new Float32Array(n * 4);
    for (let i = 3; i < def.length; i += 4) def[i] = 1;
    this.defaults = d.createBuffer({ size: def.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.defaults, 0, def);
  }

  setPixelRatio(r) {
    this.ratio = r;
    this.setSize(this.width, this.height, false);
  }
  getPixelRatio() {
    return this.ratio;
  }
  setSize(w, h, style = true) {
    this.width = w;
    this.height = h;
    const c = this.domElement;
    c.width = Math.floor(w * this.ratio);
    c.height = Math.floor(h * this.ratio);
    if (style && c.style) {
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    this.setViewport(0, 0, w, h);
  }
  getDrawingBufferSize(v) {
    return v.set(this.domElement.width, this.domElement.height);
  }
  getRenderTarget() {
    return this.target;
  }
  setRenderTarget(t) {
    this.target = t || null;
    const v = t ? t.viewport : null;
    this.curViewport = t ? [v.x, v.y, v.z, v.w] : this.cssViewport.map(x => x * this.ratio);
  }
  setViewport(x, y, w, h) {
    if (x && x.isVector4) ({ x, y, z: w, w: h } = x);
    this.cssViewport = [x, y, w, h];
    this.curViewport = this.cssViewport.map(k => k * this.ratio);
  }
  getViewport(v) {
    return v.set(...this.cssViewport);
  }
  setClearColor(c, a = 1) {
    const k = (this.clearColorV ||= [0, 0, 0, 1]);
    const col =
      c && c.isColor
        ? c
        : {
            r: 0,
            g: 0,
            b: 0,
            ...(typeof c === 'number' ? { r: ((c >> 16) & 255) / 255, g: ((c >> 8) & 255) / 255, b: (c & 255) / 255 } : {})
          };
    k[0] = col.r;
    k[1] = col.g;
    k[2] = col.b;
    k[3] = a;
  }
  getClearColor(t) {
    const k = this.clearColorV || [0, 0, 0, 1];
    return t.setRGB(k[0], k[1], k[2]);
  }
  getClearAlpha() {
    return (this.clearColorV || [0, 0, 0, 1])[3];
  }
  clear(color = true, depth = true) {
    const c = this.clears.get(this.target) || {};
    c.color ||= color;
    c.depth ||= depth;
    if (color) c.value = (this.clearColorV || [0, 0, 0, 1]).slice();
    this.clears.set(this.target, c);
  }
  clearDepth() {
    this.clear(false, true);
  }
  getContext() {
    return null;
  }
  initTexture(t) {
    this.sent(t);
  }
  compile(scene, camera) {
    const T = this.targetOf(null);
    scene.traverseVisible(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const S = this.stateOf(m);
        if (!S.fam) continue;
        const sides =
          m.transparent === true && m.side === THREE.DoubleSide && m.forceSinglePass === false
            ? [THREE.BackSide, THREE.FrontSide]
            : [m.side];
        for (const side of sides) {
          const pipe = this.pipeline(S, m, !!o.isInstancedMesh, side, o.matrixWorld.determinant() < 0, T);
          for (const t of S.fam.textures(m)) if (t) this.sent(t);
          if (pipe.ready) this.materialGroup(S, m, pipe);
        }
      }
    });
  }
  compileAsync(scene, camera) {
    this.compile(scene, camera);
    return this.settle();
  }
  dispose() {
    this.device.destroy();
  }
  later(...xs) {
    for (const x of xs) if (x) this.trash.push(x);
  }

  begin() {
    if (this.encoder) return;
    this.encoder = this.device.createCommandEncoder();
    this.frameNo++;
    this.chunkAt = 0;
    this.passAt = 0;
    this.canvasTex = null;
    for (const c of this.chunks) c.used = 0;
    this.arenaObj.used = 0;
    this.retired.length = 0;
  }

  endFrame() {
    if (!this.encoder) return;
    const q = this.device.queue,
      enc = this.encoder;
    let shot = null;
    if (this.capture && this.canvasTex) {
      const t = this.canvasTex,
        w = t.width,
        h = t.height,
        row = Math.ceil((w * 4) / 256) * 256;
      const buf = this.device.createBuffer({ size: row * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: row }, [w, h]);
      shot = { buf, w, h, row, done: this.capture, bgra: this.format === 'bgra8unorm' };
      this.capture = null;
    }
    for (const c of this.chunks) if (c.used) q.writeBuffer(c.buffer, 0, c.f32, 0, (c.used * SLOT) / 4);
    for (const a of this.retired) {
      if (a.used) q.writeBuffer(a.buffer, 0, a.f32, 0, a.used / 4);
    }
    for (const [P, I, n] of this.retiredSlots) {
      q.writeBuffer(P.buffer, 0, P.f32, 0, (n * SLOT) / 4);
      q.writeBuffer(I.buffer, 0, I.u32, 0, n * 5);
    }
    if (this.arenaObj.used) q.writeBuffer(this.arenaObj.buffer, 0, this.arenaObj.f32, 0, this.arenaObj.used / 4);
    if (this.pslots.used) {
      q.writeBuffer(this.pslots.buffer, 0, this.pslots.f32, 0, (this.pslots.used * SLOT) / 4);
      q.writeBuffer(this.indirect.buffer, 0, this.indirect.u32, 0, this.pslots.used * 5);
    }
    for (const [C, n] of this.retiredPass) q.writeBuffer(C.buffer, 0, C.f32, 0, (n * PASS) / 4);
    if (this.passAt) q.writeBuffer(this.passChunk.buffer, 0, this.passChunk.f32, 0, (this.passAt * PASS) / 4);
    q.submit([enc.finish()]);
    this.encoder = null;
    for (const [C] of this.retiredPass) C.buffer.destroy();
    this.retiredPass.length = 0;
    for (const a of this.retired) this.later(a.buffer);
    this.retired.length = 0;
    for (const [P, I] of this.retiredSlots) this.later(P.buffer, I.buffer);
    this.retiredSlots.length = 0;
    for (const x of this.trash) x.destroy();
    this.trash.length = 0;
    if (shot)
      shot.buf.mapAsync(GPUMapMode.READ).then(() => {
        const src = new Uint8Array(shot.buf.getMappedRange()),
          out = new Uint8Array(shot.w * shot.h * 4);
        for (let y = 0; y < shot.h; y++)
          for (let x = 0; x < shot.w; x++) {
            const s = (shot.h - 1 - y) * shot.row + x * 4,
              o = (y * shot.w + x) * 4;
            out[o] = src[s + (shot.bgra ? 2 : 0)];
            out[o + 1] = src[s + 1];
            out[o + 2] = src[s + (shot.bgra ? 0 : 2)];
            out[o + 3] = src[s + 3];
          }
        shot.buf.destroy();
        shot.done({ width: shot.w, height: shot.h, data: out });
      });
  }

  async settle() {
    while (this.pending.size) await Promise.all([...this.pending]);
    await this.device.queue.onSubmittedWorkDone();
  }

  readNext() {
    return new Promise(done => {
      this.capture = done;
    });
  }

  async readRenderTargetPixelsAsync(t, x, y, w, h, buffer) {
    const s = this.targets.get(t);
    if (!s || !s.color) return buffer;
    this.begin();
    const row = Math.ceil((w * 4) / 256) * 256,
      buf = this.device.createBuffer({ size: row * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.encoder.copyTextureToBuffer({ texture: s.color, origin: [x, y] }, { buffer: buf, bytesPerRow: row }, [w, h]);
    this.endFrame();
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    for (let j = 0; j < h; j++) buffer.set(src.subarray(j * row, j * row + w * 4), j * w * 4);
    buf.destroy();
    return buffer;
  }

  targetOf(t) {
    if (!t) {
      const c = this.domElement,
        w = c.width,
        h = c.height;
      let s = this.canvasState;
      if (!s || s.w !== w || s.h !== h) {
        if (s) this.later(s.color, s.depth);
        const usage = GPUTextureUsage.RENDER_ATTACHMENT;
        s = this.canvasState = {
          w,
          h,
          samples: MSAA,
          format: this.format,
          color: this.device.createTexture({ size: [w, h], format: this.format, sampleCount: MSAA, usage }),
          depth: this.device.createTexture({ size: [w, h], format: this.depthFormat, sampleCount: MSAA, usage }),
          depthFormat: this.depthFormat
        };
        s.colorView = s.color.createView();
        s.depthView = s.depth.createView();
        s.key = 'canvas|' + this.format + '|' + this.depthFormat;
      }
      return s;
    }
    let s = this.targets.get(t);
    if (!s || s.w !== t.width || s.h !== t.height) {
      if (s) this.later(s.color, s.depth);
      const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
      const tx = t.texture,
        levels = tx.generateMipmaps && MIP_FILTERS.has(tx.minFilter) ? Math.floor(Math.log2(Math.max(t.width, t.height))) + 1 : 1;
      s = { w: t.width, h: t.height, samples: 1, format: 'rgba8unorm', resolve: null, gen: (s ? s.gen : 0) + 1, levels };
      s.color = this.device.createTexture({ size: [t.width, t.height], format: 'rgba8unorm', mipLevelCount: levels, usage });
      s.colorView = s.color.createView({ baseMipLevel: 0, mipLevelCount: 1 });
      s.depthFormat = t.depthBuffer ? DEPTH : undefined;
      if (t.depthBuffer) {
        s.depth = this.device.createTexture({ size: [t.width, t.height], format: DEPTH, usage });
        s.depthView = s.depth.createView();
      }
      s.key = 'rt|rgba8unorm|' + (t.depthBuffer ? 'd' : '');
      this.targets.set(t, s);
      if (t.depthTexture && s.depth)
        this.depthViews.set(t.depthTexture, { view: s.depth.createView({ aspect: 'depth-only' }), gen: s.gen });
      this.textures.set(t.texture, {
        view: levels > 1 ? s.color.createView() : s.colorView,
        gen: s.gen,
        version: t.texture.version,
        rt: true,
        dim: '2d',
        levels
      });
    }
    return s;
  }

  render(scene, camera) {
    this.begin();
    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();
    if (scene.isScene === true && scene.onBeforeRender) scene.onBeforeRender(this, scene, camera, this.target);
    if (this.autoClear) this.clear();
    if (this.info.autoReset) this.info.reset();
    _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_proj);
    const L = this.lists;
    L.opaque.length = 0;
    L.transparent.length = 0;
    L.n = 0;
    this.project(scene, camera, 0);
    if (this.sortObjects) {
      L.opaque.sort(painterSortStable);
      L.transparent.sort(reversePainterSortStable);
    }
    this.info.render.frame++;
    const T = this.targetOf(this.target),
      owed = this.clears.get(this.target);
    this.clears.delete(this.target);
    if (!this.target) {
      if (!this.canvasTex) this.canvasTex = this.context.getCurrentTexture();
      T.resolve = this.canvasTex.createView();
    }
    const color = {
      view: T.colorView,
      resolveTarget: T.samples > 1 ? T.resolve : undefined,
      loadOp: owed && owed.color ? 'clear' : 'load',
      storeOp: 'store',
      clearValue: (owed && owed.value) || [0, 0, 0, 1]
    };
    const pass = this.encoder.beginRenderPass({
      colorAttachments: [color],
      depthStencilAttachment: T.depthView
        ? {
            view: T.depthView,
            depthLoadOp: owed && owed.depth ? 'clear' : 'load',
            depthStoreOp: 'store',
            depthClearValue: 1,
            stencilLoadOp: owed && owed.depth ? 'clear' : 'load',
            stencilStoreOp: 'store',
            stencilClearValue: 0
          }
        : undefined
    });
    this.pass = pass;
    this.passT = T;
    this.last = { pipeline: null, g1: null, g3: null, vb: [], vo: [], ib: null, ref: 0 };
    const vp = this.curViewport;
    if (vp && (vp[0] !== 0 || vp[1] !== 0 || vp[2] !== T.w || vp[3] !== T.h))
      pass.setViewport(vp[0], vp[1], Math.max(1, Math.min(vp[2], T.w - vp[0])), Math.max(1, Math.min(vp[3], T.h - vp[1])), 0, 1);
    this.scene = scene;
    this.camera = camera;
    const ctx = (this.ctx = this.contextOf(camera, T));
    this.ctxGroup(ctx, camera, T);
    pass.setBindGroup(0, ctx.group, [0]);
    this.curLight = this.lighting;
    const O = L.opaque;
    for (let i = 0; i < O.length; ) {
      if (this.bundles && this.bundleable(O[i])) {
        let j = i + 1;
        while (j < O.length && this.bundleable(O[j])) j++;
        if (j - i >= 2) {
          this.drawRun(O, i, j, ctx);
          i = j;
          continue;
        }
      }
      this.renderObject(O[i++]);
    }
    for (const it of L.transparent) this.renderObject(it);
    pass.end();
    this.pass = null;
    if (T.levels > 1) this.mipmaps(T.color, T.levels, this.encoder);
  }

  contextOf(camera, T) {
    let byT = this.ctxs.get(camera);
    if (!byT) this.ctxs.set(camera, (byT = new Map()));
    let list = byT.get(T);
    if (!list) byT.set(T, (list = []));
    if (this.ctxFrame !== this.frameNo) {
      this.ctxFrame = this.frameNo;
      this.ctxUse = new Map();
    }
    const k = this.ctxUse.get(list) || 0;
    this.ctxUse.set(list, k + 1);
    let ctx = list[k];
    if (!ctx) {
      ctx = {
        buffer: this.device.createBuffer({ size: PASS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        f32: new Float32Array(PASS / 4),
        group: null,
        key: '',
        slots: new WeakMap(),
        runs: new Map()
      };
      list[k] = ctx;
    }
    return ctx;
  }

  ctxGroup(ctx, camera, T) {
    const s = this.fillPass(ctx.f32, 0, camera, T, this.lighting);
    this.device.queue.writeBuffer(ctx.buffer, 0, ctx.f32);
    if (!ctx.group || ctx.key !== s.key) {
      ctx.group = this.passBindGroup(ctx.buffer, s);
      ctx.key = s.key;
    }
  }

  fillPass(f, o, camera, T, L) {
    camera.matrixWorldInverse.toArray(f, o);
    camera.projectionMatrix.toArray(f, o + 16);
    L.shadowMatrix.value.toArray(f, o + 32);
    _cam.setFromMatrixPosition(camera.matrixWorld);
    const v3 = (at, c) => {
      f[o + at] = c.x ?? c.r;
      f[o + at + 1] = c.y ?? c.g;
      f[o + at + 2] = c.z ?? c.b;
    };
    v3(48, _cam);
    f[o + 51] = L.shadowOn.value;
    v3(52, L.sunDir.value);
    f[o + 55] = L.shadowTexel.value;
    v3(56, L.sunColor.value);
    f[o + 59] = L.fowSide.value;
    v3(60, L.fillDir.value);
    f[o + 63] = T.h;
    v3(64, L.fillColor.value);
    v3(68, L.ambient.value);
    v3(72, L.fogTint.value);
    f[o + 76] = L.fogRange.value.x;
    f[o + 77] = L.fogRange.value.y;
    const drawingIt = !!this.target && this.target.depthTexture === L.shadowMap.value;
    const sh = drawingIt ? undefined : this.depthViews.get(L.shadowMap.value),
      fow = this.texture(L.fowMap.value, '2d');
    const shadow = sh || { view: this.noDepth, gen: 0 };
    const out = this.passOut || (this.passOut = {});
    out.shadow = shadow;
    out.fow = fow;
    out.fowTex = L.fowMap.value;
    out.key = (sh ? 1 : 0) + '|' + shadow.gen + '|' + fow.gen + '|' + fow.id;
    return out;
  }

  passBindGroup(buffer, s) {
    return this.device.createBindGroup({
      layout: this.g0,
      entries: [
        { binding: 0, resource: { buffer, size: PASS } },
        { binding: 1, resource: s.shadow.view },
        { binding: 2, resource: this.compareSampler },
        { binding: 3, resource: s.fow.view },
        { binding: 4, resource: this.sampler(s.fowTex, s.fow.levels) }
      ]
    });
  }

  lightGroup(camera, T, L) {
    const F = (this.lightsNow ||= new Map());
    if (this.lightsFrame !== this.frameNo) {
      this.lightsFrame = this.frameNo;
      F.clear();
    }
    const seen = F.get(L);
    if (seen && seen.camera === camera && seen.T === T && seen.chunk === this.passChunk) {
      this.lightAt = seen.at;
      return seen.g;
    }
    if (this.passAt === this.passChunk.cap) {
      this.retiredPass.push([this.passChunk, this.passAt]);
      this.passChunk = this.makePassChunk(this.passChunk.cap * 2);
      this.passAt = 0;
    }
    const C = this.passChunk,
      s = this.fillPass(C.f32, (this.passAt * PASS) / 4, camera, T, L),
      G = C.groups;
    let g = G.get(s.key);
    if (!g) G.set(s.key, (g = this.passBindGroup(C.buffer, s)));
    this.lightAt = this.passAt++ * PASS;
    F.set(L, { camera, T, chunk: C, at: this.lightAt, g });
    return g;
  }

  makePassChunk(cap) {
    return {
      cap,
      buffer: this.device.createBuffer({ size: PASS * cap, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      f32: new Float32Array((PASS * cap) / 4),
      groups: new Map()
    };
  }

  project(object, camera, groupOrder) {
    if (object.visible === false) return;
    if (object.layers.test(camera.layers)) {
      if (object.isGroup) groupOrder = object.renderOrder;
      else if (object.isMesh || object.isLine || object.isPoints || object.isSprite) {
        if (object.isMesh && (!object.frustumCulled || _frustum.intersectsObject(object))) {
          const geometry = object.geometry,
            material = object.material;
          if (this.sortObjects) {
            if (object.boundingSphere !== undefined) {
              if (object.boundingSphere === null) object.computeBoundingSphere();
              _v4.copy(object.boundingSphere.center);
            } else {
              if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
              _v4.copy(geometry.boundingSphere.center);
            }
            _v4.w = 1;
            _v4.applyMatrix4(object.matrixWorld).applyMatrix4(_proj);
          }
          if (Array.isArray(material)) {
            for (const group of geometry.groups) {
              const gm = material[group.materialIndex];
              if (gm && gm.visible) this.push(object, geometry, gm, groupOrder, _v4.z, group);
            }
          } else if (material.visible) this.push(object, geometry, material, groupOrder, _v4.z, null);
        } else if (!object.isMesh) this.skip('not a mesh: ' + object.type);
      }
    }
    const ch = object.children;
    for (let i = 0, l = ch.length; i < l; i++) this.project(ch[i], camera, groupOrder);
  }

  push(object, geometry, material, groupOrder, z, group) {
    const L = this.lists;
    let it = L.items[L.n];
    if (!it) L.items[L.n] = it = { id: 0, object: null, geometry: null, material: null, groupOrder: 0, renderOrder: 0, z: 0, group: null };
    L.n++;
    it.id = object.id;
    it.object = object;
    it.geometry = geometry;
    it.material = material;
    it.groupOrder = groupOrder;
    it.renderOrder = object.renderOrder;
    it.z = z;
    it.group = group;
    const U = object.userData;
    if (U.sid !== undefined) {
      it.id = U.sid;
      it.groupOrder = U.go;
      it.z = U.z;
    }
    it.mid = material.userData.sid ?? material.id;
    (material.transparent === true ? L.transparent : L.opaque).push(it);
  }

  skip(kind) {
    this.unsupported.set(kind, (this.unsupported.get(kind) || 0) + 1);
  }

  renderObject(it) {
    const { object, geometry, material, group } = it,
      scene = this.scene,
      camera = this.camera;
    if (!object.layers.test(camera.layers)) return;
    object.onBeforeRender(this, scene, camera, geometry, material, group);
    object.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
    material.onBeforeRender(this, scene, camera, geometry, object, group);
    if (material.transparent === true && material.side === THREE.DoubleSide && material.forceSinglePass === false) {
      this.draw(object, geometry, material, group, THREE.BackSide);
      this.draw(object, geometry, material, group, THREE.FrontSide);
    } else this.draw(object, geometry, material, group, material.side);
    object.onAfterRender(this, scene, camera, geometry, material, group);
  }

  stateOf(m) {
    let s = this.matState.get(m);
    if (!s || s.version !== m.version) {
      const fam = families.find(f => f.match(m)) || null;
      s = {
        version: m.version,
        fam,
        light: fam && fam.light ? fam.light(m) : null,
        variants: new Map(),
        group: null,
        gens: null,
        block: null
      };
      this.matState.set(m, s);
    }
    return s;
  }

  draw(object, geometry, material, group, side) {
    const r = this.prepare(object, geometry, material, group, side, null);
    if (!r) return;
    const pass = this.pass;
    const light = r.light || this.lighting;
    if (light !== this.curLight) {
      if (light === this.lighting) pass.setBindGroup(0, this.ctx.group, [0]);
      else pass.setBindGroup(0, this.lightGroup(this.camera, this.passT, light), [this.lightAt]);
      this.curLight = light;
    }
    this.encode(pass, r, this.last, false);
  }

  prepare(object, geometry, material, group, side, ctx) {
    const S = this.stateOf(material),
      fam = S.fam;
    if (!fam) {
      this.skip(material.type + (material.isShaderMaterial ? ':' + material.vertexShader.trim().slice(0, 40) : ''));
      return null;
    }
    const index = geometry.index,
      position = geometry.attributes.position,
      dr = geometry.drawRange;
    let start = dr.start,
      end = dr.start + dr.count;
    if (group !== null) {
      start = Math.max(start, group.start);
      end = Math.min(end, group.start + group.count);
    }
    if (index !== null) {
      start = Math.max(start, 0);
      end = Math.min(end, index.count);
    } else if (position) {
      start = Math.max(start, 0);
      end = Math.min(end, position.count);
    }
    const count = end - start;
    if (count < 0 || count === Infinity) return null;
    const instanced = !!object.isInstancedMesh;
    let instances = 1;
    if (instanced) instances = object.count;
    else if (geometry.isInstancedBufferGeometry) {
      let max = Infinity;
      for (const k in geometry.attributes) {
        const a = geometry.attributes[k];
        if (a.isInstancedBufferAttribute) max = Math.min(max, a.meshPerAttribute * a.count);
      }
      instances = Math.min(geometry.instanceCount, max);
    }
    if (!(instances > 0) || count === 0) return null;
    const cw = object.matrixWorld.determinant() < 0;
    const T = this.passT;
    const pipe = this.pipeline(S, material, instanced, side, cw, T);
    if (!pipe || !pipe.ready) return null;
    const r = this.rec;
    r.pipe = pipe;
    r.light = S.light;
    r.g1 = this.materialGroup(S, material, pipe);
    r.stencilRef = material.stencilRef;
    r.indexed = index !== null;
    r.start = start;
    r.count = count;
    r.instances = instances;
    r.vb.length = 0;
    r.vo.length = 0;
    this.vertexBuffers(r, pipe, geometry, object, instances);
    if (r.indexed) {
      const ib = this.indexBuffer(index);
      r.ib = ib.buffer;
      r.ibFormat = ib.format;
    }
    let f, u, o;
    if (ctx) {
      let k = ctx.slots.get(object);
      if (k === undefined) ctx.slots.set(object, (k = this.slotAlloc()));
      const P = this.pslots;
      f = P.f32;
      u = P.u32;
      o = (k * SLOT) / 4;
      r.slotGroup = P.group;
      r.slotOffset = k * SLOT;
      r.slot = k;
      const a = this.indirect.u32,
        q = k * 5;
      a[q] = count;
      a[q + 1] = instances;
      a[q + 2] = start;
      a[q + 3] = 0;
      a[q + 4] = 0;
    } else {
      let c = this.chunks[this.chunkAt];
      if (c && c.used === SLOTS) c = this.chunks[++this.chunkAt];
      if (!c) {
        const buffer = this.device.createBuffer({ size: SLOT * SLOTS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const f32 = new Float32Array((SLOT * SLOTS) / 4);
        c = {
          buffer,
          f32,
          u32: new Uint32Array(f32.buffer),
          used: 0,
          group: this.device.createBindGroup({ layout: this.g2, entries: [{ binding: 0, resource: { buffer, size: SLOT } }] })
        };
        this.chunks[this.chunkAt] = c;
      }
      f = c.f32;
      u = c.u32;
      o = (c.used * SLOT) / 4;
      r.slotGroup = c.group;
      r.slotOffset = c.used++ * SLOT;
      r.slot = -1;
    }
    object.matrixWorld.toArray(f, o);
    if (fam.modelView !== false) object.modelViewMatrix.toArray(f, o + 16);
    fam.params(material, f, o + PARAMS);
    if (pipe.storage) {
      let ib = 0,
        tb = 0,
        bb = 0;
      if (instanced) {
        const m = object.instanceMatrix,
          t = geometry.attributes.instanceTint;
        ib = this.framed(m, m.array, Math.min(m.array.length, instances * 16)).at / 16;
        tb = t ? this.framed(t, t.array, Math.min(t.array.length, instances * 4)).at / 16 : this.tintDefaults(instances);
      }
      if (pipe.bones) {
        const src = fam.boneSource(material);
        if (!src) return null;
        const rows = material.defines.INSTSKIN && material.uniforms.boneTex.value.userData.rows;
        if (rows) bb = this.framedRows(material.uniforms.boneTex.value, rows, instanced ? instances : 1).at / 16;
        else if (material.defines.INSTSKIN)
          bb = this.framed(src, src, Math.min(src.length, ((instanced ? instances : 1) * BONES) / 4)).at / 16;
        else {
          const at = this.arena(BONES / 4);
          this.arenaObj.f32.set(src.length > BONES / 4 ? src.subarray(0, BONES / 4) : src, at / 4);
          bb = at / 16;
        }
      }
      u[o + 60] = ib;
      u[o + 61] = tb;
      u[o + 62] = bb;
    }
    return r;
  }

  encode(enc, r, last, indirect) {
    if (r.pipe.pipeline !== last.pipeline) {
      enc.setPipeline(r.pipe.pipeline);
      last.pipeline = r.pipe.pipeline;
    }
    if (r.pipe.stencil && !indirect && last.ref !== r.stencilRef) {
      enc.setStencilReference(r.stencilRef);
      last.ref = r.stencilRef;
    }
    if (r.g1 !== last.g1) {
      enc.setBindGroup(1, r.g1);
      last.g1 = r.g1;
    }
    enc.setBindGroup(2, r.slotGroup, [r.slotOffset]);
    if (r.pipe.storage && last.g3 !== this.arenaObj.group) {
      enc.setBindGroup(3, this.arenaObj.group);
      last.g3 = this.arenaObj.group;
    }
    for (let i = 0; i < r.vb.length; i++)
      if (last.vb[i] !== r.vb[i] || last.vo[i] !== r.vo[i]) {
        enc.setVertexBuffer(i, r.vb[i], r.vo[i]);
        last.vb[i] = r.vb[i];
        last.vo[i] = r.vo[i];
      }
    if (r.indexed) {
      if (last.ib !== r.ib) {
        enc.setIndexBuffer(r.ib, r.ibFormat);
        last.ib = r.ib;
      }
      if (indirect) enc.drawIndexedIndirect(this.indirect.buffer, r.slot * 20);
      else enc.drawIndexed(r.count, r.instances, r.start, 0, 0);
    } else enc.draw(r.count, r.instances, r.start, 0);
    this.info.render.calls++;
    this.info.render.triangles += r.instances * (r.count / 3);
  }

  bundleable(it) {
    const o = it.object,
      m = it.material;
    if (!o.isInstancedMesh || it.group !== null || it.geometry.index === null) return false;
    if (o.onBeforeRender !== NOOP_OBJECT || o.onAfterRender !== NOOP_OBJECT_AFTER || m.onBeforeRender !== NOOP_MATERIAL) return false;
    const S = this.stateOf(m);
    return S.fam !== null && S.fam.storage === true && S.light === null && !(m.transparent === true && m.side === THREE.DoubleSide);
  }

  drawRun(O, i, j, ctx) {
    const camera = this.camera,
      key = O[i].object;
    let run = ctx.runs.get(key);
    const sig = this.sigOut || (this.sigOut = []),
      recs = this.recsOut || (this.recsOut = []);
    sig.length = 0;
    let n = 0;
    for (let k = i; k < j; k++) {
      const { object, geometry, material } = O[k];
      if (!object.layers.test(camera.layers)) continue;
      const r = this.prepare(object, geometry, material, null, material.side, ctx);
      if (!r) continue;
      let c = recs[n];
      if (!c) recs[n] = c = { vb: [], vo: [] };
      c.pipe = r.pipe;
      c.g1 = r.g1;
      c.slotGroup = r.slotGroup;
      c.slotOffset = r.slotOffset;
      c.slot = r.slot;
      c.indexed = true;
      c.ib = r.ib;
      c.ibFormat = r.ibFormat;
      c.count = r.count;
      c.instances = r.instances;
      c.start = r.start;
      c.vb.length = r.vb.length;
      c.vo.length = r.vo.length;
      for (let v = 0; v < r.vb.length; v++) {
        c.vb[v] = r.vb[v];
        c.vo[v] = r.vo[v];
      }
      sig.push(c.pipe.pipeline, c.g1, c.slot, c.ib, c.vb[0], c.slotGroup);
      n++;
    }
    const gens = this.arenaObj.group,
      pg = this.pslots.group,
      ig = this.indirect.buffer;
    let same =
      !!run &&
      run.n === n &&
      run.ctxGroup === ctx.group &&
      run.arena === gens &&
      run.pslots === pg &&
      run.indirect === ig &&
      run.T === this.passT;
    if (same)
      for (let k = 0; k < sig.length; k++)
        if (sig[k] !== run.sig[k]) {
          same = false;
          break;
        }
    if (!same) {
      const T = this.passT;
      const enc = this.device.createRenderBundleEncoder({
        colorFormats: [T.format],
        depthStencilFormat: T.depthFormat,
        sampleCount: T.samples
      });
      enc.setBindGroup(0, ctx.group, [0]);
      const last = { pipeline: null, g1: null, g3: null, vb: [], vo: [], ib: null },
        calls = this.info.render.calls,
        tris = this.info.render.triangles;
      for (let k = 0; k < n; k++) this.encode(enc, recs[k], last, true);
      this.info.render.calls = calls;
      this.info.render.triangles = tris;
      run = { bundle: enc.finish(), n, sig: sig.slice(), ctxGroup: ctx.group, arena: gens, pslots: pg, indirect: ig, T };
      ctx.runs.set(key, run);
      this.bundlesMade++;
    }
    for (let k = 0; k < n; k++) {
      this.info.render.calls++;
      this.info.render.triangles += recs[k].instances * (recs[k].count / 3);
    }
    const pass = this.pass;
    pass.executeBundles([run.bundle]);
    const L = this.last;
    L.pipeline = null;
    L.g1 = null;
    L.g3 = null;
    L.vb.length = 0;
    L.vo.length = 0;
    L.ib = null;
    L.ref = -1;
    pass.setBindGroup(0, this.ctx.group, [0]);
    this.curLight = this.lighting;
  }

  slotAlloc() {
    const P = this.pslots;
    if (P.used === P.cap) {
      const cap = P.cap * 2,
        f32 = new Float32Array((cap * SLOT) / 4),
        ind = new Uint32Array(cap * 5);
      f32.set(P.f32);
      ind.set(this.indirect.u32);
      this.retiredSlots.push([P, this.indirect, P.used]);
      this.makeSlots(cap, f32, ind, P.used);
    }
    return this.pslots.used++;
  }

  makeSlots(cap, f32 = new Float32Array((cap * SLOT) / 4), ind = new Uint32Array(cap * 5), used = 0) {
    const d = this.device,
      buffer = d.createBuffer({ size: cap * SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.pslots = {
      buffer,
      f32,
      u32: new Uint32Array(f32.buffer),
      cap,
      used,
      group: d.createBindGroup({ layout: this.g2, entries: [{ binding: 0, resource: { buffer, size: SLOT } }] })
    };
    this.indirect = { buffer: d.createBuffer({ size: cap * 20, usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST }), u32: ind };
  }

  pipeline(S, m, instanced, side, cw, T) {
    const flip = (side === THREE.BackSide) !== cw;
    const vkey = (instanced ? 1 : 0) | (flip ? 2 : 0) | (side === THREE.DoubleSide ? 4 : 0);
    let byT = S.variants.get(T.key);
    if (!byT) S.variants.set(T.key, (byT = []));
    let p = byT[vkey];
    if (p !== undefined) {
      if (p && !p.ready && !p.bad && this.syncPipelines) {
        p.pipeline = this.device.createRenderPipeline(p.desc);
        p.ready = true;
      }
      return p;
    }
    const fam = S.fam,
      d = this.device,
      code = fam.code(m, instanced),
      skey = fam.key(m, instanced);
    let mod = this.modules.get(skey);
    if (!mod) {
      mod = d.createShaderModule({ code, label: skey });
      mod.getCompilationInfo().then(info => {
        for (const e of info.messages) if (e.type === 'error') console.error('webgpu', skey, e.lineNum + ':' + e.linePos, e.message);
      });
      this.modules.set(skey, mod);
    }
    const { vertex, instance } = fam.attributes(m, instanced);
    let stride = 0;
    const attrs = vertex.map(([name, n, loc]) => {
      const a = { shaderLocation: loc, offset: stride, format: n === 1 ? 'float32' : 'float32x' + n };
      stride += n * 4;
      return a;
    });
    const buffers = [{ arrayStride: stride, stepMode: 'vertex', attributes: attrs }];
    for (const [name, n, loc] of instance) {
      if (n === 16)
        buffers.push({
          arrayStride: 64,
          stepMode: 'instance',
          attributes: [0, 1, 2, 3].map(k => ({ shaderLocation: loc + k, offset: k * 16, format: 'float32x4' }))
        });
      else
        buffers.push({
          arrayStride: n * 4,
          stepMode: 'instance',
          attributes: [{ shaderLocation: loc, offset: 0, format: n === 1 ? 'float32' : 'float32x' + n }]
        });
    }
    const storage = !!fam.storage,
      bones = !!(fam.bones && fam.bones(m));
    let layout = this.layouts.get(fam.name);
    if (!layout) {
      const g1 = d.createBindGroupLayout({ entries: fam.layout });
      layout = { g1, pl: d.createPipelineLayout({ bindGroupLayouts: storage ? [this.g0, g1, this.g2, this.g3] : [this.g0, g1, this.g2] }) };
      this.layouts.set(fam.name, layout);
    }
    const depthOn = m.depthTest !== false;
    const desc = {
      layout: layout.pl,
      label: skey,
      vertex: { module: mod, entryPoint: 'vs', buffers },
      fragment: {
        module: mod,
        entryPoint: 'fs',
        targets: [{ format: T.format, blend: blendOf(m), writeMask: m.colorWrite === false ? 0 : GPUColorWrite.ALL }]
      },
      primitive: { topology: 'triangle-list', cullMode: side === THREE.DoubleSide ? 'none' : 'back', frontFace: flip ? 'ccw' : 'cw' },
      depthStencil: T.depthFormat
        ? {
            format: T.depthFormat,
            depthWriteEnabled: depthOn && m.depthWrite !== false,
            depthCompare: depthOn ? COMPARE[m.depthFunc] : 'always',
            depthBias: m.polygonOffset ? m.polygonOffsetUnits : 0,
            depthBiasSlopeScale: m.polygonOffset ? m.polygonOffsetFactor : 0
          }
        : undefined,
      multisample: { count: T.samples }
    };
    if (m.stencilWrite && desc.depthStencil) {
      const face = {
        compare: STENCIL_FN[m.stencilFunc],
        failOp: STENCIL_OP[m.stencilFail],
        depthFailOp: STENCIL_OP[m.stencilZFail],
        passOp: STENCIL_OP[m.stencilZPass]
      };
      Object.assign(desc.depthStencil, {
        stencilFront: face,
        stencilBack: face,
        stencilReadMask: m.stencilFuncMask,
        stencilWriteMask: m.stencilWriteMask
      });
    }
    const pkey =
      skey + '|' + JSON.stringify([desc.fragment.targets, desc.primitive, desc.depthStencil, T.samples, buffers.map(b => b.arrayStride)]);
    p = this.pipelines.get(pkey);
    if (p && !p.ready && !p.bad && this.syncPipelines) {
      p.pipeline = d.createRenderPipeline(desc);
      p.ready = true;
    }
    if (!p && this.syncPipelines) {
      p = {
        pipeline: d.createRenderPipeline(desc),
        ready: true,
        layout,
        storage,
        bones,
        stride,
        instance,
        vertex,
        stencil: !!(m.stencilWrite && desc.depthStencil)
      };
      this.pipelines.set(pkey, p);
    }
    if (!p) {
      p = {
        pipeline: null,
        ready: false,
        layout,
        storage,
        bones,
        stride,
        instance,
        vertex,
        desc,
        stencil: !!(m.stencilWrite && desc.depthStencil)
      };
      const job = d.createRenderPipelineAsync(desc).then(
        q => {
          p.pipeline = q;
          p.ready = true;
        },
        e => {
          console.error('webgpu pipeline', skey, e.message);
          p.bad = true;
        }
      );
      this.pending.add(job);
      job.then(() => this.pending.delete(job));
      this.pipelines.set(pkey, p);
    }
    byT[vkey] = p;
    return p;
  }

  materialGroup(S, m, pipe) {
    const fam = S.fam,
      list = fam.textures(m),
      dims = fam.dims || (fam.dims = fam.layout.filter(e => e.texture));
    if (S.groupFrame === this.frameNo && S.layout === pipe.layout.g1 && sameList(S.texRefs, list)) return S.group;
    S.groupFrame = this.frameNo;
    S.texRefs = list;
    const views = this.viewsOut || (this.viewsOut = []);
    let same = !!S.group && S.layout === pipe.layout.g1 && S.gens.length === list.length * 2;
    for (let i = 0; i < list.length; i++) {
      const e = (views[i] = this.texture(list[i], dims[i].texture.viewDimension || '2d', dims[i].texture.sampleType));
      if (same && (S.gens[i * 2] !== e.view || S.gens[i * 2 + 1] !== e.gen)) same = false;
    }
    if (same) {
      if (fam.block) this.fillBlock(S, m);
      return S.group;
    }
    const gens = [];
    for (let i = 0; i < list.length; i++) gens.push(views[i].view, views[i].gen);
    const entries = [];
    dims.forEach((e, i) => {
      entries.push({ binding: e.binding, resource: views[i].view });
      if (fam.layout.find(x => x.binding === e.binding + 1 && x.sampler))
        entries.push({ binding: e.binding + 1, resource: this.sampler(list[i], views[i].levels) });
    });
    if (fam.block) {
      if (!S.block)
        S.block = {
          buffer: this.device.createBuffer({ size: fam.block.size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
          f32: new Float32Array(fam.block.size / 4),
          frame: -1
        };
      entries.push({ binding: fam.layout.find(e => e.buffer).binding, resource: { buffer: S.block.buffer } });
      this.fillBlock(S, m);
    }
    S.group = this.device.createBindGroup({ layout: pipe.layout.g1, entries });
    S.gens = gens;
    S.layout = pipe.layout.g1;
    return S.group;
  }

  fillBlock(S, m) {
    if (S.block.frame === this.frameNo) return;
    S.block.frame = this.frameNo;
    S.fam.block.fill(m, S.block.f32);
    this.device.queue.writeBuffer(S.block.buffer, 0, S.block.f32);
  }

  geometryOf(pipe, geometry) {
    const names = pipe.vertex,
      attrs = geometry.attributes;
    let byGeo = this.geoSeen.get(geometry);
    if (!byGeo) this.geoSeen.set(geometry, (byGeo = new Map()));
    let seen = byGeo.get(names);
    if (seen) {
      let same = true;
      for (let i = 0; i < names.length; i++) {
        const x = attrs[names[i][0]];
        if (x !== seen.attrs[i] || (x && x.version !== seen.versions[i])) {
          same = false;
          break;
        }
      }
      if (same) return seen.buffer;
    }
    let sig = '';
    for (const [n] of names) {
      const a = attrs[n];
      sig += (a ? attrId(a) + '.' + a.version : '-') + ',';
    }
    const keyAttr = attrs.position || geometry;
    let byKey = this.geos.get(keyAttr);
    if (!byKey) this.geos.set(keyAttr, (byKey = new Map()));
    const lay = names.map(n => n[0]).join(',');
    let g = byKey.get(lay);
    if (!g || g.sig !== sig) {
      const count = attrs.position ? attrs.position.count : 0,
        stride = pipe.stride / 4,
        data = new Float32Array(Math.max(1, count) * stride);
      let at = 0;
      for (const [n, k] of names) {
        const a = attrs[n];
        if (a && !a.isInterleavedBufferAttribute && !a.normalized && a.itemSize === k) {
          const src = a.array;
          for (let i = 0, o = at, q = 0; i < count; i++, o += stride) for (let j = 0; j < k; j++) data[o + j] = src[q++];
        } else if (a)
          for (let i = 0; i < count; i++)
            for (let j = 0; j < k; j++)
              data[i * stride + at + j] =
                j < a.itemSize ? (j === 0 ? a.getX(i) : j === 1 ? a.getY(i) : j === 2 ? a.getZ(i) : a.getW(i)) : j === 3 ? 1 : 0;
        else if (k === 4) for (let i = 0; i < count; i++) data[i * stride + at + 3] = 1;
        at += k;
      }
      if (g && g.buffer.size >= data.byteLength) this.device.queue.writeBuffer(g.buffer, 0, data);
      else {
        if (g) this.later(g.buffer);
        g = { buffer: this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }) };
        this.device.queue.writeBuffer(g.buffer, 0, data);
        byKey.set(lay, g);
      }
      g.sig = sig;
    }
    byGeo.set(names, {
      attrs: names.map(n => attrs[n[0]]),
      versions: names.map(n => attrs[n[0]] && attrs[n[0]].version),
      buffer: g.buffer
    });
    return g.buffer;
  }

  arena(floats) {
    const need = Math.ceil((floats * 4) / 256) * 256;
    let a = this.arenaObj;
    if (a.used + need > a.cap) {
      this.retired.push(a);
      a = this.arenaObj = this.makeArena(Math.max(a.cap * 2, need * 2));
    }
    const at = a.used;
    a.used += need;
    return at;
  }

  makeArena(cap) {
    const buffer = this.device.createBuffer({ size: cap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    return {
      buffer,
      cap,
      used: 0,
      f32: new Float32Array(cap / 4),
      group: this.device.createBindGroup({ layout: this.g3, entries: [{ binding: 0, resource: { buffer } }] })
    };
  }

  framed(key, src, n) {
    let e = this.framedAt.get(key);
    if (e && e.frame === this.frameNo && e.a === this.arenaObj && e.n >= n) return e;
    if (!e) this.framedAt.set(key, (e = { frame: 0, n: 0, a: null, at: 0 }));
    e.at = this.arena(n);
    e.a = this.arenaObj;
    e.frame = this.frameNo;
    e.n = n;
    e.a.f32.set(n < src.length ? src.subarray(0, n) : src, e.at / 4);
    return e;
  }

  framedRows(key, rows, n) {
    let e = this.framedAt.get(key);
    if (e && e.frame === this.frameNo && e.a === this.arenaObj && e.n >= (n * BONES) / 4) return e;
    if (!e) this.framedAt.set(key, (e = { frame: 0, n: 0, a: null, at: 0 }));
    const per = BONES / 4;
    e.at = this.arena(n * per);
    e.a = this.arenaObj;
    e.frame = this.frameNo;
    e.n = n * per;
    const f = e.a.f32,
      at = e.at / 4;
    for (let i = 0; i < n; i++) {
      const m = rows[i];
      f.set(m.length > per ? m.subarray(0, per) : m, at + i * per);
    }
    return e;
  }

  tintDefaults(n) {
    const at = this.arena(n * 4),
      f = this.arenaObj.f32;
    for (let i = 0; i < n; i++) {
      f[at / 4 + i * 4] = f[at / 4 + i * 4 + 1] = f[at / 4 + i * 4 + 2] = 0;
      f[at / 4 + i * 4 + 3] = 1;
    }
    return at / 16;
  }

  vertexBuffers(r, pipe, geometry, object, instances) {
    r.vb.push(this.geometryOf(pipe, geometry));
    r.vo.push(0);
    for (const [name] of pipe.instance) {
      const a = name === 'instanceMatrix' ? object.instanceMatrix : geometry.attributes[name];
      if (!a) {
        r.vb.push(this.defaults);
        r.vo.push(0);
        continue;
      }
      const e = this.framed(a, a.array, Math.min(a.array.length, instances * a.itemSize));
      r.vb.push(e.a.buffer);
      r.vo.push(e.at);
    }
  }

  indexBuffer(index) {
    let b = this.instBufs.get(index);
    if (!b || b.version !== index.version) {
      const arr = index.array,
        u32 = arr instanceof Uint32Array,
        bytes = Math.ceil(arr.byteLength / 4) * 4;
      if (!b || b.size < bytes) {
        if (b) this.later(b.buffer);
        b = {
          buffer: this.device.createBuffer({ size: Math.max(4, bytes), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }),
          size: bytes,
          format: u32 ? 'uint32' : 'uint16'
        };
        this.instBufs.set(index, b);
      }
      const src = u32 || arr instanceof Uint16Array ? arr : Uint32Array.from(arr);
      if (!(u32 || arr instanceof Uint16Array)) b.format = 'uint32';
      const data =
        src.byteLength % 4
          ? (() => {
              const c = new Uint16Array(src.length + 1);
              c.set(src);
              return c;
            })()
          : src;
      this.device.queue.writeBuffer(b.buffer, 0, data.buffer, data.byteOffset, data.byteLength);
      b.version = index.version;
    }
    return b;
  }

  sent(t) {
    const e = this.textures.get(t);
    if (e && (e.rt || e.version === t.version)) return false;
    this.texture(t, t.isCompressedArrayTexture || t.isDataArrayTexture ? '2d-array' : '2d');
    return true;
  }

  texture(t, dim = '2d', kind = 'float') {
    if (!t) return { view: kind === 'unfilterable-float' ? this.empty['unfilterable-float'] : this.empty[dim], gen: 0, id: 0, levels: 1 };
    const dv = this.depthViews.get(t);
    if (dv) return dv;
    let e = this.textures.get(t);
    if (e && e.rt) return e;
    if (!e) {
      e = { id: attrId(t), gen: 0, version: 0, view: null, tex: null, levels: 1, w: 0, h: 0, fmt: '' };
      this.textures.set(t, e);
    }
    if (t.version > 0 && e.version !== t.version) {
      try {
        this.upload(t, e, dim);
      } catch (err) {
        console.warn('webgpu texture', t.name || t.uuid, err.message);
      }
      e.version = t.version;
    }
    if (!e.view)
      return { view: kind === 'unfilterable-float' ? this.empty['unfilterable-float'] : this.empty[dim], gen: 0, id: e.id, levels: 1 };
    return e;
  }

  upload(t, e, dim) {
    const d = this.device,
      q = d.queue;
    const FMT = {
      [THREE.RGBA_S3TC_DXT1_Format]: ['bc1-rgba-unorm', 8],
      [THREE.RGBA_S3TC_DXT3_Format]: ['bc2-rgba-unorm', 16],
      [THREE.RGBA_S3TC_DXT5_Format]: ['bc3-rgba-unorm', 16],
      [THREE.RGB_S3TC_DXT1_Format]: ['bc1-rgba-unorm', 8]
    };
    let fmt,
      w,
      h,
      layers = 1,
      levels,
      writes = [],
      external = null,
      genMips = false;
    if ((t.isCompressedTexture || t.isDataTexture) && !(t.mipmaps?.[0]?.data || t.image?.data)) {
      if (!e.tex) void t.image?.complete;
      return;
    }
    if (t.isCompressedTexture || t.isCompressedArrayTexture) {
      const f = FMT[t.format];
      if (!f) throw new Error('compressed format ' + t.format);
      fmt = f[0];
      w = t.image.width;
      h = t.image.height;
      layers = t.isCompressedArrayTexture ? t.image.depth : 1;
      const mips = t.mipmaps;
      levels = mips.length;
      mips.forEach((m, k) => {
        const mw = Math.max(1, w >> k),
          mh = Math.max(1, h >> k),
          bw = Math.ceil(mw / 4),
          bh = Math.ceil(mh / 4);
        writes.push({ level: k, data: m.data, bytesPerRow: bw * f[1], rows: bh, size: [bw * 4, bh * 4, layers] });
      });
    } else if (t.isDataTexture || t.isData3DTexture) {
      const img = t.image;
      w = img.width;
      h = img.height;
      const float = t.type === THREE.FloatType,
        comps = t.format === THREE.RedFormat ? 1 : t.format === THREE.RGFormat ? 2 : 4;
      fmt = (comps === 1 ? 'r' : comps === 2 ? 'rg' : 'rgba') + (float ? '32float' : '8unorm');
      const bpp = comps * (float ? 4 : 1),
        align = t.unpackAlignment || 4;
      const mips = t.mipmaps && t.mipmaps.length ? t.mipmaps : [{ data: img.data, width: w, height: h }];
      levels = mips.length;
      mips.forEach((m, k) => {
        const tight = m.width * bpp,
          row = Math.ceil(tight / align) * align;
        if (m.data.byteLength < row * (m.height - 1) + tight) throw new Error('data shorter than GL would read');
        let data = m.data;
        if (t.flipY) {
          const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
            o = new Uint8Array(row * m.height);
          for (let y = 0; y < m.height; y++) o.set(src.subarray(y * row, y * row + tight), (m.height - 1 - y) * row);
          data = o;
        }
        writes.push({ level: k, data, bytesPerRow: row, rows: m.height, size: [m.width, m.height, 1] });
      });
      if (levels === 1 && t.generateMipmaps && MIP_FILTERS.has(t.minFilter) && !float) {
        genMips = true;
        levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
      }
    } else if (t.image && (t.image.width || t.image.videoWidth)) {
      const img = t.image;
      if (img.complete === false) return;
      external = img;
      w = img.width || img.videoWidth;
      h = img.height || img.videoHeight;
      fmt = 'rgba8unorm';
      levels = 1;
      if (t.generateMipmaps && MIP_FILTERS.has(t.minFilter)) {
        genMips = true;
        levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
      }
    } else return;
    if (!e.tex || e.w !== w || e.h !== h || e.fmt !== fmt || e.levels !== levels || e.layers !== layers) {
      if (e.tex) this.later(e.tex);
      e.tex = d.createTexture({
        size: [w, h, layers],
        format: fmt,
        mipLevelCount: levels,
        dimension: '2d',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | (genMips || external ? GPUTextureUsage.RENDER_ATTACHMENT : 0)
      });
      e.view = e.tex.createView({ dimension: t.isCompressedArrayTexture ? '2d-array' : dim === '2d-array' ? '2d-array' : '2d' });
      e.w = w;
      e.h = h;
      e.fmt = fmt;
      e.levels = levels;
      e.layers = layers;
      e.gen++;
    }
    for (const x of writes)
      q.writeTexture({ texture: e.tex, mipLevel: x.level }, x.data, { bytesPerRow: x.bytesPerRow, rowsPerImage: x.rows }, x.size);
    if (external)
      q.copyExternalImageToTexture({ source: external, flipY: t.flipY }, { texture: e.tex, premultipliedAlpha: t.premultiplyAlpha }, [
        w,
        h
      ]);
    if (genMips) this.mipmaps(e.tex, levels);
    if (t.onUpdate) t.onUpdate(t);
  }

  mipmaps(tex, levels, into = null) {
    const d = this.device;
    if (!this.mipPipe) {
      const mod = d.createShaderModule({
        code: `
        @group(0) @binding(0) var src: texture_2d<f32>; @group(0) @binding(1) var s: sampler;
        struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f }
        @vertex fn vs(@builtin(vertex_index) i: u32) -> V { let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); var v: V; v.p = vec4f(xy * 2.0 - 1.0, 0.0, 1.0); v.uv = vec2f(xy.x, 1.0 - xy.y); return v; }
        @fragment fn fs(v: V) -> @location(0) vec4f { return textureSampleLevel(src, s, v.uv, 0.0); }`
      });
      this.mipPipe = d.createRenderPipeline({
        layout: 'auto',
        vertex: { module: mod, entryPoint: 'vs' },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' }
      });
      this.mipSampler = d.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    }
    const enc = into || d.createCommandEncoder();
    for (let k = 1; k < levels; k++) {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: tex.createView({ baseMipLevel: k, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }]
      });
      pass.setPipeline(this.mipPipe);
      pass.setBindGroup(
        0,
        d.createBindGroup({
          layout: this.mipPipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: tex.createView({ baseMipLevel: k - 1, mipLevelCount: 1 }) },
            { binding: 1, resource: this.mipSampler }
          ]
        })
      );
      pass.draw(3);
      pass.end();
    }
    if (!into) d.queue.submit([enc.finish()]);
  }

  sampler(t, levels) {
    t = t || {};
    const mip = MIP_FILTERS.has(t.minFilter);
    const minLinear =
      t.minFilter === undefined ||
      t.minFilter === THREE.LinearFilter ||
      t.minFilter === THREE.LinearMipmapNearestFilter ||
      t.minFilter === THREE.LinearMipmapLinearFilter;
    const mipLinear = t.minFilter === THREE.LinearMipmapLinearFilter || t.minFilter === THREE.NearestMipmapLinearFilter;
    const aniso = t.magFilter !== THREE.NearestFilter && mipLinear && t.anisotropy > 1 && minLinear ? Math.min(16, t.anisotropy) : 1;
    const desc = {
      addressModeU: WRAP[t.wrapS] || 'clamp-to-edge',
      addressModeV: WRAP[t.wrapT] || 'clamp-to-edge',
      magFilter: t.magFilter === THREE.NearestFilter ? 'nearest' : 'linear',
      minFilter: minLinear ? 'linear' : 'nearest',
      mipmapFilter: mipLinear ? 'linear' : 'nearest',
      lodMaxClamp: mip ? 32 : 0,
      maxAnisotropy: aniso
    };
    if (aniso > 1) desc.mipmapFilter = desc.minFilter = desc.magFilter = 'linear';
    const key = JSON.stringify(desc);
    let s = this.samplers.get(key);
    if (!s) this.samplers.set(key, (s = this.device.createSampler(desc)));
    return s;
  }
}

const sameList = (a, b) => {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

function painterSortStable(a, b) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.mid !== b.mid) return a.mid - b.mid;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}
function reversePainterSortStable(a, b) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.z !== b.z) return b.z - a.z;
  return a.id - b.id;
}
