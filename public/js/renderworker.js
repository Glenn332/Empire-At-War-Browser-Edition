import * as THREE from '../vendor/three/build/three.module.js';
import { env } from './gpu/env.js';

let R = null, doneAt = null, gpu = false, ready = null;
const early = [];
const arenas = [null, null, null];
const sabs = new Map();
const streamed = d => (ArrayBuffer.isView(d) ? d : d[0] === -1 ? sabs.get(d[1]).subarray(0, d[2]) : arenas[d[0]].subarray(d[1], d[1] + d[2]));
const things = new Map();
const cams = { P: new THREE.PerspectiveCamera(), O: new THREE.OrthographicCamera() };
for (const c of Object.values(cams)) { c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false; }
const pass = new THREE.Scene();
pass.matrixAutoUpdate = false; pass.matrixWorldAutoUpdate = false;
const stand = new THREE.Scene();

function opaqueSort(a, b) {
  const A = a.object.userData, B = b.object.userData;
  if (A.go !== B.go) return A.go - B.go;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const ma = a.material.userData.sid, mb = b.material.userData.sid;
  if (ma !== mb) return ma - mb;
  if (A.z !== B.z) return A.z - B.z;
  return A.sid - B.sid;
}
function transparentSort(a, b) {
  const A = a.object.userData, B = b.object.userData;
  if (A.go !== B.go) return A.go - B.go;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (A.z !== B.z) return B.z - A.z;
  return A.sid - B.sid;
}

function readyDrawsOnly(R) {
  if (!R.extensions.get('KHR_parallel_shader_compile')) return;
  const props = R.properties, direct = R.renderBufferDirect.bind(R), building = new WeakSet();
  R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const prog = props.get(material).currentProgram;
    if (prog) { if (prog.isReady()) return direct(camera, scene, geometry, material, object, group); return; }
    if (!scene || building.has(material)) return;
    building.add(material);
    queueMicrotask(() => Promise.resolve(R.compileAsync(object, camera, stand)).catch(() => {}).then(() => building.delete(material)));
  };
}

async function init({ canvas, params, done }) {
  doneAt = done;
  if (params.webgpu) {
    const { GPURenderer } = await import('./gpu/renderer.js');
    R = await GPURenderer.create(canvas).catch(e => { postMessage({ error: 'webgpu: ' + (e && e.message || e) }); return null; });
    if (R) { gpu = true; R.info.autoReset = false; return; }
    postMessage({ error: 'webgpu: not available on the worker, drawn with WebGL' });
  }
  R = new THREE.WebGLRenderer({ ...params, canvas });
  R.info.autoReset = false;
  R.setOpaqueSort(opaqueSort);
  R.setTransparentSort(transparentSort);
  readyDrawsOnly(R);
}

function dec(e, into) {
  switch (e[0]) {
    case 0: return e[1];
    case 1: return things.get(e[1]) || null;
    case 2: { const m = into && into.elements && into.elements.length === e[1].length ? into : e[1].length === 9 ? new THREE.Matrix3() : new THREE.Matrix4(); m.fromArray(e[1]); return m; }
    case 3: return (into && into.isVector2 ? into : new THREE.Vector2()).set(e[1], e[2]);
    case 4: return (into && into.isVector3 ? into : new THREE.Vector3()).set(e[1], e[2], e[3]);
    case 5: return (into && into.isVector4 ? into : new THREE.Vector4()).set(e[1], e[2], e[3], e[4]);
    case 6: return (into && into.isColor ? into : new THREE.Color()).setRGB(e[1], e[2], e[3]);
    case 7: return (into && into.isQuaternion ? into : new THREE.Quaternion()).set(e[1], e[2], e[3], e[4]);
    case 8: return e[1];
    case 9: return e[1].map(x => dec(x));
    case 11: return (into && into.isEuler ? into : new THREE.Euler()).set(e[1], e[2], e[3], e[4]);
    case 10: {
      const o = {};
      for (const k in e[1]) o[k] = dec(e[1][k]);
      if (o.normal && o.constant !== undefined) return new THREE.Plane(o.normal, o.constant);
      return o;
    }
  }
}

function uniform(id) {
  let u = things.get(id);
  if (!u) things.set(id, (u = { value: null }));
  return u;
}

function before(renderer, scene, camera, geometry, material) {
  const L = this.userData.ovr, sid = material.userData.mid;
  for (const [mid, set] of L) {
    if (mid !== sid) continue;
    const back = this.userData.back = [];
    for (const [uid, e] of set) { const u = uniform(uid); back.push(u, u.value); u.value = dec(e); }
    material.uniformsNeedUpdate = true;
  }
}
function after(renderer, scene, camera, geometry, material) {
  const back = this.userData.back;
  if (!back) return;
  for (let i = 0; i < back.length; i += 2) back[i].value = back[i + 1];
  this.userData.back = null;
  material.uniformsNeedUpdate = true;
}
const BEFORE = THREE.Object3D.prototype.onBeforeRender, AFTER = THREE.Object3D.prototype.onAfterRender;

const OBJ = { Mesh: THREE.Mesh, InstancedMesh: THREE.InstancedMesh, Points: THREE.Points, Line: THREE.Line, LineSegments: THREE.LineSegments, LineLoop: THREE.LineLoop, Sprite: THREE.Sprite };

function makeObject(id, kind, sid) {
  const o = kind === 'InstancedMesh' ? new THREE.InstancedMesh(undefined, undefined, 0) : new OBJ[kind]();
  o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; o.frustumCulled = false;
  o.userData.sid = sid; o.userData.go = 0; o.userData.z = 0;
  things.set(id, o);
}

function makeTexture(id, def) {
  let t = things.get(id);
  const Cls = typeof THREE[def.cls] === 'function' && /Texture$/.test(def.cls) ? THREE[def.cls] : THREE.Texture;
  if (!t) { t = new Cls(); things.set(id, t); }
  const p = def.props;
  for (const k in p) if (k !== 'offset' && k !== 'repeat' && k !== 'center' && k !== 'matrix') t[k] = p[k];
  t.offset.fromArray(p.offset); t.repeat.fromArray(p.repeat); t.center.fromArray(p.center); t.matrix.fromArray(p.matrix);
  const img = def.image;
  if (img && img.imageData) t.image = img.imageData;
  else if (img && img.pending) t.image = { width: img.width, height: img.height };
  else if (img) t.image = img;
  if (def.mipmaps) t.mipmaps = def.mipmaps.map(m => (m && m.imageData ? m.imageData : m));
  if (def.version > 0 && !(img && img.pending)) t.needsUpdate = true;
}

function makeMaterial(id, def) {
  const Cls = THREE[def.type] || THREE.ShaderMaterial;
  const m = new Cls();
  m.userData.sid = def.sid; m.userData.mid = id;
  shaderInto(m, def.version);
  if (def.uniforms) { m.uniforms = {}; for (const k in def.uniforms) m.uniforms[k] = uniform(def.uniforms[k]); }
  propsInto(m, def.props);
  things.set(id, m);
}

function shaderInto(m, v) {
  if (v.vs !== undefined) m.vertexShader = v.vs;
  if (v.fs !== undefined) m.fragmentShader = v.fs;
  if (v.defines !== undefined) m.defines = v.defines;
  if (v.extensions !== undefined) m.extensions = v.extensions;
  if (v.glslVersion !== undefined) m.glslVersion = v.glslVersion;
  if (v.index0AttributeName !== undefined) m.index0AttributeName = v.index0AttributeName;
}

function propsInto(m, p) {
  for (const k in p) m[k] = dec(p[k], m[k]);
}

function makeAttribute(id, d) {
  const a = d.instanced ? new THREE.InstancedBufferAttribute(d.array, d.itemSize, d.normalized, d.meshPerAttribute) : new THREE.BufferAttribute(d.array, d.itemSize, d.normalized);
  a.usage = d.usage;
  if (d.gpuType !== undefined) a.gpuType = d.gpuType;
  things.set(id, a);
}

function attributeArray(id, array) {
  const a = things.get(id);
  if (!a) return;
  if (a.array.length === array.length && a.array.constructor === array.constructor) { a.array = array; a.needsUpdate = true; return; }
  const b = a.isInstancedBufferAttribute ? new THREE.InstancedBufferAttribute(array, a.itemSize, a.normalized, a.meshPerAttribute) : new THREE.BufferAttribute(array, a.itemSize, a.normalized);
  b.usage = a.usage; b.gpuType = a.gpuType;
  things.set(id, b);
  for (const g of things.values()) {
    if (g.isBufferGeometry) { for (const k in g.attributes) if (g.attributes[k] === a) g.setAttribute(k, b); if (g.index === a) g.setIndex(b); }
    else if (g.isInstancedMesh) { if (g.instanceMatrix === a) g.instanceMatrix = b; if (g.instanceColor === a) g.instanceColor = b; }
  }
}

function makeTarget(id, d) {
  const t = new THREE.WebGLRenderTarget(d.width, d.height, { depthBuffer: d.depthBuffer, stencilBuffer: d.stencilBuffer, samples: d.samples,
    resolveDepthBuffer: d.resolveDepthBuffer, resolveStencilBuffer: d.resolveStencilBuffer, count: d.textures.length, depth: d.depth });
  d.textures.forEach((tid, i) => {
    const x = things.get(tid);
    if (!x) { things.set(tid, t.textures[i]); return; }
    x.image = t.textures[i].image; x.isRenderTargetTexture = true;
    t.textures[i] = x;
  });
  if (d.depthTexture) t.depthTexture = things.get(d.depthTexture) || null;
  things.set(id, t);
}

function dispose(id) {
  const x = things.get(id);
  if (x && typeof x.dispose === 'function' && !x.isObject3D) x.dispose();
}

function rows(id, width, n, d) {
  const t = things.get(id);
  if (!t) return;
  t.image.data.set(streamed(d), 0);
  if (gpu) return;
  const data = t.image.data;
  const props = R.properties.get(t);
  if (!props || !props.__webglTexture || props.__version !== t.version) { t.needsUpdate = true; return; }
  const gl = R.getContext();
  R.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, n, gl.RGBA, gl.FLOAT, data, 0);
}

function camera(c) {
  const k = cams[c.k];
  k.projectionMatrix.fromArray(c.p); k.projectionMatrixInverse.fromArray(c.pi);
  k.matrixWorld.fromArray(c.w); k.matrixWorldInverse.fromArray(c.wi);
  k.near = c.near; k.far = c.far;
  return k;
}

function sceneInto(s) {
  pass.background = s.bg ? new THREE.Color().setRGB(s.bg[0], s.bg[1], s.bg[2]) : null;
  const f = s.fog;
  pass.fog = !f ? null : f.exp2 ? new THREE.FogExp2(new THREE.Color().setRGB(...f.color), f.density) : new THREE.Fog(new THREE.Color().setRGB(...f.color), f.near, f.far);
}

const STRIDE = 24;
function render(c, items, arrs, ovr, s) {
  const kids = pass.children;
  kids.length = 0;
  for (let i = 0; i < items.length; i += STRIDE) {
    const o = things.get(items[i]);
    if (!o) continue;
    o.geometry = things.get(items[i + 1]);
    o.material = items[i + 2] === 0 ? things.get(items[i + 3]) : arrs[items[i + 3]].map(id => things.get(id));
    const U = o.userData;
    U.go = items[i + 4]; o.renderOrder = items[i + 5]; U.z = items[i + 6];
    const ov = items[i + 7];
    if (ov >= 0) { U.ovr = ovr[ov]; o.onBeforeRender = before; o.onAfterRender = after; }
    else if (U.ovr) { U.ovr = null; o.onBeforeRender = BEFORE; o.onAfterRender = AFTER; }
    o.matrixWorld.fromArray(items, i + 8);
    kids.push(o);
  }
  sceneInto(s);
  R.render(pass, camera(c));
  kids.length = 0;
}

function compile(job, c, list, async) {
  const s = new THREE.Scene();
  for (const [oid, gid, mats] of list) {
    const o = things.get(oid);
    if (!o) continue;
    o.geometry = things.get(gid);
    o.material = Array.isArray(mats) ? mats.map(id => things.get(id)) : things.get(mats);
    s.children.push(o);
  }
  const cam = camera(c);
  if (gpu) { s.children.length = 0; if (async) postMessage({ compiled: job }); return; }
  if (!async) { R.compile(s, cam, stand); s.children.length = 0; return; }
  const p = R.compileAsync(s, cam, stand);
  s.children.length = 0;
  Promise.resolve(p).catch(() => {}).then(() => postMessage({ compiled: job }));
}

function run(ops) {
  for (const op of ops) {
    try { step(op); } catch (e) { postMessage({ error: op[0] + ': ' + (e && e.stack || e) }); }
  }
}

function step(op) {
  switch (op[0]) {
    case 'size': R.setPixelRatio(op[3]); R.setSize(op[1], op[2], false); break;
    case 'viewport': if (!gpu) R.setViewport(op[1], op[2], op[3], op[4]); break;
    case 'scissor': if (!gpu) R.setScissor(op[1], op[2], op[3], op[4]); break;
    case 'scissorTest': if (!gpu) R.setScissorTest(op[1]); break;
    case 'clearColor': if (!gpu) R.setClearColor(new THREE.Color().setRGB(op[1], op[2], op[3]), op[4]); break;
    case 'clear': R.clear(op[1], op[2], op[3]); break;
    case 'depthMask': R.state.buffers.depth.setMask(op[1]); break;
    case 'target': R.setRenderTarget(op[1] ? things.get(op[1]) : null, op[2], op[3]); break;
    case 'state': {
      const d = op[1];
      for (const k in d) { if (k === 'checkShaderErrors') { if (!gpu) R.debug.checkShaderErrors = d[k]; } else R[k] = d[k]; }
      break;
    }
    case 'initTexture': { const t = things.get(op[1]); if (t) { if (gpu) R.sent(t); else R.initTexture(t); } break; }
    case 'gpuEnv': { const L = {}; for (const k in op[1]) L[k] = uniform(op[1][k]); env.lighting = L; env.programSources = op[2]; if (gpu) R.lighting = L; break; }
    case 'settle': { const id = op[1]; Promise.resolve(gpu ? R.settle() : null).then(() => postMessage({ compiled: id })); break; }
    case 'obj': makeObject(op[1], op[2], op[3]); break;
    case 'inst': { const o = things.get(op[1]); o.count = op[2]; o.instanceMatrix = things.get(op[3]); o.instanceColor = op[4] ? things.get(op[4]) : null; break; }
    case 'attr': makeAttribute(op[1], op[2]); break;
    case 'attrArray': attributeArray(op[1], op[2]); break;
    case 'attrRanges': {
      const a = things.get(op[1]), parts = op[2];
      for (let i = 0; i < parts.length; i += 2) { const d = streamed(parts[i + 1]); a.array.set(d, parts[i]); a.addUpdateRange(parts[i], d.length); }
      a.needsUpdate = true;
      break;
    }
    case 'geo': things.set(op[1], op[2] === 'InstancedBufferGeometry' ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry()); break;
    case 'geoSet': {
      const g = things.get(op[1]), d = op[2];
      for (const k in g.attributes) if (!(k in d.attrs)) g.deleteAttribute(k);
      for (const k in d.attrs) { const a = things.get(d.attrs[k]); if (a && g.attributes[k] !== a) g.setAttribute(k, a); }
      g.setIndex(d.index ? things.get(d.index) : null);
      g.setDrawRange(d.drawRange[0], d.drawRange[1]);
      g.clearGroups(); for (const x of d.groups) g.addGroup(x[0], x[1], x[2]);
      if (d.instanceCount !== undefined) g.instanceCount = d.instanceCount;
      break;
    }
    case 'mat': makeMaterial(op[1], op[2]); break;
    case 'matVersion': { const m = things.get(op[1]); shaderInto(m, op[2]); m.needsUpdate = true; break; }
    case 'matProps': propsInto(things.get(op[1]), op[2]); break;
    case 'matUniforms': { const m = things.get(op[1]); m.uniforms = {}; for (const k in op[2]) m.uniforms[k] = uniform(op[2][k]); break; }
    case 'u': { const u = uniform(op[1]); u.value = dec(op[2], u.value); break; }
    case 'tex': makeTexture(op[1], op[2]); break;
    case 'texBitmap': { const t = things.get(op[1]); if (t) { t.image = op[3]; t.needsUpdate = true; } break; }
    case 'rows': rows(op[1], op[2], op[3], op[4]); break;
    case 'rt': makeTarget(op[1], op[2]); break;
    case 'rtSize': {
      const t = things.get(op[1]);
      t.setSize(op[2], op[3], op[4]);
      t.viewport.fromArray(op[5]); t.scissor.fromArray(op[6]); t.scissorTest = op[7];
      break;
    }
    case 'arena': arenas[op[1]] = op[2]; break;
    case 'sab': sabs.set(op[1], new Float32Array(op[2])); break;
    case 'render': render(op[1], op[2], op[3], op[4], op[5]); break;
    case 'compile': compile(op[1], op[2], op[3], op[4]); break;
    case 'dispose': dispose(op[1]); break;
    case 'gc': dispose(op[1]); things.delete(op[1]); break;
    case 'read': {
      if (gpu) { const id = op[1]; R.readNext().then(p => postMessage({ read: id, pixels: p }, [p.data.buffer])); break; }
      const gl = R.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      postMessage({ read: op[1], pixels: { width: w, height: h, data: px } }, [px.buffer]);
      break;
    }
  }
}

onmessage = e => {
  const d = e.data;
  if (d.init) { ready = init(d.init).then(() => { for (const x of early.splice(0)) handle(x); ready = true; }); return; }
  if (ready !== true) { early.push(d); return; }
  handle(d);
};

function handle(d) {
  if (d.ops) {
    const t0 = performance.now();
    run(d.ops);
    if (gpu && d.frame) R.endFrame();
    if (d.frame) {
      const r = R.info.render;
      postMessage({ done: d.frame, ms: performance.now() - t0, at: performance.timeOrigin + t0, end: performance.timeOrigin + performance.now(), calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines, programs: R.info.programs ? R.info.programs.length : 0 });
      R.info.reset();
      if (doneAt) Atomics.store(doneAt, 0, d.frame);
    }
  }
};
