import * as THREE from 'three';
import { AnimState, frameKeys } from '../ala.js';

const byModel = new WeakMap();
const REST = { name: 'rest' };
const _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4(), _x1 = new THREE.Matrix4(), _x2 = new THREE.Matrix4();
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);
const axis = i => (i === 1 ? _Y : i === 0 ? _X : _Z);
const GWP = THREE.Object3D.prototype.getWorldPosition;

const noWasm = typeof location !== 'undefined' && /[?&]nowasm/.test(location.search);
let W = null;
if (!noWasm && typeof WebAssembly !== 'undefined') {
  (async () => {
    try {
      const url = new URL('./landpose.wasm', import.meta.url);
      let r;
      try { r = await WebAssembly.instantiateStreaming(fetch(url), {}); }
      catch { r = await WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), {}); }
      W = { ex: r.instance.exports, mem: r.instance.exports.memory, top: 65536, buf: null };
      views();
      W.tmp = alloc(64); W.xs = alloc(64 * 3); W.out = alloc(64 * 64); W.idx = alloc(4 * 64); W.outN = 64;
    } catch (e) { W = null; }
  })();
}
function views() {
  if (W.buf === W.mem.buffer) return;
  W.buf = W.mem.buffer; W.F32 = new Float32Array(W.buf); W.I32 = new Int32Array(W.buf); W.U8 = new Uint8Array(W.buf);
  W.U16 = new Uint16Array(W.buf); W.I16 = new Int16Array(W.buf);
}

function alloc(bytes) {
  const at = W.top;
  W.top = (W.top + bytes + 15) & ~15;
  const need = Math.ceil(W.top / 65536) - W.mem.buffer.byteLength / 65536;
  if (need > 0) W.mem.grow(Math.max(need, 128));
  views();
  return at;
}

const copies = new WeakMap();
const maps = new WeakMap();
function copyIn(arr) {
  let at = copies.get(arr);
  if (at !== undefined) return at;
  at = alloc(arr.byteLength);
  new Uint8Array(W.mem.buffer, at, arr.byteLength).set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  views();
  copies.set(arr, at);
  return at;
}

function skeleton(model) {
  const root = new THREE.Group(), bones = [], boneByName = new Map(), m4 = new THREE.Matrix4();
  for (const b of model.bones) {
    const o = new THREE.Object3D(), m = b.matrix;
    o.name = b.name;
    m4.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
    m4.decompose(o.position, o.quaternion, o.scale);
    o.userData.rest = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
    bones.push(o); boneByName.set(b.name.toUpperCase(), o);
  }
  model.bones.forEach((b, i) => (b.parent >= 0 ? bones[b.parent] : root).add(bones[i]));
  root.updateMatrixWorld(true);
  const restInv = bones.map(o => new THREE.Matrix4().copy(o.matrixWorld).invert());
  const sk = { root, bones, boneByName, restInv, syncFromBones() {} };
  if (W) {
    const nb = bones.length, parent = model.bones.map(b => (b.parent >= 0 && b.parent < nb ? b.parent : -1));
    const order = [], done = new Uint8Array(nb);
    const visit = i => { if (done[i]) return; done[i] = 1; if (parent[i] >= 0) visit(parent[i]); order.push(i); };
    for (let i = 0; i < nb; i++) visit(i);
    sk.wParents = alloc(nb * 4); sk.wOrder = alloc(nb * 4); sk.wRest = alloc(nb * 40); sk.wRestInv = alloc(nb * 64);
    for (let i = 0; i < nb; i++) {
      W.I32[(sk.wParents >> 2) + i] = parent[i]; W.I32[(sk.wOrder >> 2) + i] = order[i];
      const r = bones[i].userData.rest, a = (sk.wRest >> 2) + i * 10;
      W.F32.set([r.p.x, r.p.y, r.p.z, r.q.x, r.q.y, r.q.z, r.q.w, r.s.x, r.s.y, r.s.z], a);
      W.F32.set(restInv[i].elements, (sk.wRestInv >> 2) + i * 16);
    }
  }
  return sk;
}

function entryOf(model, anim) {
  let rec = byModel.get(model);
  if (!rec) byModel.set(model, (rec = { skel: null, entries: new Map() }));
  let e = rec.entries.get(anim);
  if (e) return e;
  const sk = rec.skel ||= skeleton(model), nb = sk.bones.length, rest = anim === REST, frames = rest ? 1 : Math.max(1, anim.frames), stride = nb * 16;
  e = { have: new Uint8Array(frames), stride, frames, sk, anim, st: rest ? null : new AnimState(sk, anim, { loop: true }), w: !!(W && sk.wParents) };
  if (e.w) {
    e.mAt = alloc(frames * stride * 4); e.sAt = alloc(frames * stride * 4);
    e.recs = alloc(nb * 80);
    const I = e.recs >> 2;
    for (let i = 0; i < nb; i++) W.I32[I + i * 20] = -1;
    if (e.st) for (const { t, bone } of e.st.bound) {
      const i = sk.bones.indexOf(bone);
      if (i < 0) continue;
      const at = copyInTrack(t), b = I + i * 20;
      W.I32[b] = (t.trans ? 1 : 0) | (t.rot ? 2 : 0) | (!t.rot && t.defRot ? 4 : 0);
      W.I32[b + 1] = at.trans; W.I32[b + 2] = t.transStride || 0; W.I32[b + 3] = t.transAt || 0;
      W.I32[b + 4] = at.rot; W.I32[b + 5] = t.rotStride || 0; W.I32[b + 6] = t.rotAt || 0;
      W.F32.set([t.offset[0], t.offset[1], t.offset[2], t.scale[0], t.scale[1], t.scale[2]], b + 7);
      if (t.defRot) W.F32.set(t.defRot, b + 13);
    }
  } else { e.M = new Float32Array(frames * stride); e.S = new Float32Array(frames * stride); }
  rec.entries.set(anim, e);
  return e;
}
function copyInTrack(t) { const trans = t.trans ? copyIn(t.trans) : 0, rot = t.rot ? copyIn(t.rot) : 0; return { trans, rot }; }

function frameOf(e, f) {
  if (e.have[f]) return;
  e.have[f] = 1;
  const sk = e.sk, nb = sk.bones.length;
  if (e.w) { W.ex.poseFrame(sk.wParents, sk.wRest, sk.wRestInv, sk.wOrder, e.recs, nb, f, e.mAt + f * e.stride * 4, e.sAt + f * e.stride * 4, W.tmp); return; }
  const at = f * e.stride;
  for (const o of sk.bones) { const r = o.userData.rest; o.position.copy(r.p); o.quaternion.copy(r.q); o.scale.copy(r.s); }
  if (e.st) { e.st.done = false; e.st.time = (f + 1e-4) / e.anim.fps; e.st.pose(); }
  sk.root.updateMatrixWorld(true);
  for (let i = 0; i < nb; i++) {
    const w = sk.bones[i].matrixWorld;
    w.toArray(e.M, at + i * 16);
    _m.multiplyMatrices(w, sk.restInv[i]).toArray(e.S, at + i * 16);
  }
}

function eligible(u, A) {
  const inst = u.inst;
  if (!inst || !inst.model || inst.flat || inst.billboards.length || (A && (!A.bound.length || A.onFrame))) return false;
  if (inst.bones.length !== inst.model.bones.length) return false;
  if (u.looksOf && u.looksOf.holster) return false;
  if (u.guns && u.guns.some(g => g.turret && g.turret.bone)) return false;
  if ((A && A.bound.some(b => b.t.vis)) || inst.bones.some(b => b.userData.animHid)) return false;
  const T = u.turret;
  if (T && ((T.bone && !inst.bones.includes(T.bone)) || (T.barrel && !inst.bones.includes(T.barrel)))) return false;
  return true;
}

function realize(inst) {
  const P = inst.pc;
  if (!P || P.real) return;
  P.real = true;
  if (P.A) P.A.pose();
  if (P.u.turret) P.world.turnTurret(P.u);
}

function leave(inst) {
  if (inst.pc) { realize(inst); inst.pc = null; }
}

export function settlePose(inst) { if (inst) leave(inst); }

function hook(inst) {
  if (inst.pcHooked) return;
  inst.pcHooked = true;
  const gwp = function (out) { realize(inst); return GWP.call(this, out); };
  for (const b of inst.bones) b.getWorldPosition = gwp;
}

export function cachedPose(u, dt, world) {
  const A = u.anim, inst = u.inst;
  if (!inst || !inst.model) return false;
  if (!A && inst.animated) { leave(inst); return false; }
  const key = A || inst;
  if (key.pcOk === undefined || key.pcOkGen !== inst.pcGen) { if (u.looksOf === undefined) { leave(inst); return false; } key.pcOk = eligible(u, A); key.pcOkGen = inst.pcGen; }
  if (!key.pcOk) { leave(inst); return false; }
  hook(inst);
  let e, f0 = 0, f1 = 0, k = 0;
  if (A) {
    inst.animated = true;
    A.advance(dt);
    const a = A.anim, f = Math.max(0, A.time * a.fps);
    e = entryOf(inst.model, a);
    [f0, f1] = frameKeys(a, f, A.loop); k = f - Math.floor(f);
  } else e = entryOf(inst.model, REST);
  frameOf(e, f0); frameOf(e, f1);
  const P = inst.pc ||= { e: null, f0: 0, f1: 0, k: 0, A: null, real: false, u, world };
  P.e = e; P.f0 = f0; P.f1 = f1; P.k = k; P.A = A; P.real = false; P.u = u; P.world = world;
  return true;
}

function partsOf(inst) {
  if (inst.pcParts) return inst.pcParts;
  const index = new Map(inst.bones.map((b, i) => [b, i])), parts = [];
  const inv = new THREE.Matrix4(), attached = new Set(inst.attached || []);
  inst.root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    for (let a = o; a && a !== inst.root; a = a.parent) if (attached.has(a)) return;
    let p = o.parent;
    while (p && p !== inst.root && !index.has(p)) p = p.parent;
    const bi = p && p !== inst.root ? index.get(p) : -1;
    inv.copy((bi >= 0 ? inst.bones[bi] : inst.root).matrixWorld).invert();
    parts.push({ mesh: o, bi, rel: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
  });
  inst.pcPartBones = Int32Array.from(parts.filter(p => p.bi >= 0).map(p => p.bi));
  return (inst.pcParts = parts);
}

function turretFlags(inst, T) {
  if (inst.pcTurret && inst.pcTurret.T === T) return inst.pcTurret;
  const nb = inst.bones.length, flags = new Uint8Array(nb), under = (b, top) => { for (let o = b; o; o = o.parent) if (o === top) return true; return false; };
  for (let i = 0; i < nb; i++) {
    const b = inst.bones[i];
    if (T.bone && under(b, T.bone)) flags[i] |= 1;
    if (T.barrel && T.barrel !== T.bone && under(b, T.barrel)) flags[i] |= 2;
  }
  const ti = T.bone ? inst.bones.indexOf(T.bone) : -1, bi = T.barrel && T.barrel !== T.bone ? inst.bones.indexOf(T.barrel) : -1;
  let wFlags = 0;
  if (W) {
    const rec = byModel.get(inst.model), key = ti + ',' + bi, have = rec && (rec.turrets ||= new Map()).get(key);
    if (have !== undefined) wFlags = have;
    else { wFlags = alloc(nb); W.U8.set(flags, wFlags); if (rec) rec.turrets.set(key, wFlags); }
  }
  return (inst.pcTurret = { T, flags, ti, bi, wFlags });
}

function blendOne(e, which, bi, a0, a1, k, out) {
  const o = out.elements;
  if (e.w) { const F = W.F32, base = ((which === 'M' ? e.mAt : e.sAt) >> 2), p0 = base + (a0 >> 2) + bi * 16, p1 = base + (a1 >> 2) + bi * 16; for (let j = 0; j < 16; j++) { const v = F[p0 + j]; o[j] = v + (F[p1 + j] - v) * k; } }
  else { const src = which === 'M' ? e.M : e.S, p0 = (a0 >> 2) + bi * 16, p1 = (a1 >> 2) + bi * 16; for (let j = 0; j < 16; j++) { const v = src[p0 + j]; o[j] = v + (src[p1 + j] - v) * k; } }
  return out;
}

function turretTurns(e, Q, T, a0, a1, k) {
  const X12 = _r;
  let x1 = null, x2 = null;
  if (Q.ti >= 0) {
    blendOne(e, 'M', Q.ti, a0, a1, k, _t);
    x1 = _x1.copy(_t).multiply(_m.makeRotationAxis(axis(T.axis), T.yaw || 0));
    if (T.selfPitch) x1.multiply(_m.makeRotationAxis(axis(T.pitchAxis), (T.pitch || 0) * (T.pitchSign || 1)));
    x1.multiply(_b.copy(_t).invert());
  }
  if (Q.bi >= 0) {
    blendOne(e, 'M', Q.bi, a0, a1, k, _t);
    if (x1 && (Q.flags[Q.bi] & 1)) _t.premultiply(x1);
    x2 = _x2.copy(_t).multiply(_m.makeRotationAxis(axis(T.pitchAxis), (T.pitch || 0) * (T.pitchSign || 1))).multiply(_b.copy(_t).invert());
  }
  X12.identity(); if (x2) X12.copy(x2); if (x1) X12.multiply(x1);
  return [x1 || _m.identity(), x2 || _b.identity(), X12];
}

export function placeCached(u) {
  const inst = u.inst, P = inst.pc, h = u.holder;
  if (!P) return false;
  if (!inst.pcParts) { h.updateMatrixWorld(true); partsOf(inst); }
  const e = P.e, a0 = P.f0 * e.stride * 4, a1 = P.f1 * e.stride * 4, k = P.k;
  h.updateMatrix(); h.matrixWorld.copy(h.matrix);
  const root = inst.root;
  for (const c of h.children) if (c !== root) c.updateMatrixWorld(true);
  if (root.matrixAutoUpdate) root.updateMatrix();
  root.matrixWorld.multiplyMatrices(h.matrixWorld, root.matrix);
  const T = u.turret, Q = T ? turretFlags(inst, T) : null;
  let X = null;
  if (Q) {
    const [x1, x2, x12] = turretTurns(e, Q, T, a0, a1, k);
    if (e.w) { W.F32.set(x1.elements, W.xs >> 2); W.F32.set(x2.elements, (W.xs >> 2) + 16); W.F32.set(x12.elements, (W.xs >> 2) + 32); }
    else X = [x1.clone(), x2.clone(), x12.clone()];
  }
  if (e.w) placeWasm(inst, e, a0, a1, k, Q, root);
  else placeJS(inst, e, a0, a1, k, Q, X, root);
  if (inst.attached) placeAttached(inst, e, a0, a1, k, Q, X || (Q ? turretTurns(e, Q, T, a0, a1, k) : null), root);
  inst.dirty = false;
  return true;
}

function placeAttached(inst, e, a0, a1, k, Q, X, root) {
  const index = inst.pcIndex ||= new Map(inst.bones.map((b, i) => [b, i]));
  for (const A of inst.attached) {
    const bone = A.parent, bi = bone ? index.get(bone) : undefined;
    if (bi === undefined) continue;
    blendOne(e, 'M', bi, a0, a1, k, _b);
    const f = Q ? Q.flags[bi] : 0;
    if (f && X) _b.premultiply(X[f - 1]);
    bone.matrixWorld.multiplyMatrices(root.matrixWorld, _b);
    let R = A.userData.pcRel;
    if (!R) {
      A.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert();
      R = A.userData.pcRel = [];
      A.traverse(o => { if (o.isMesh && !o.isInstancedMesh) R.push({ mesh: o, rel: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) }); });
    }
    for (const p of R) p.mesh.matrixWorld.multiplyMatrices(bone.matrixWorld, p.rel);
  }
}

function placeJS(inst, e, a0, a1, k, Q, X, root) {
  for (const p of inst.pcParts) {
    if (p.bi < 0) { p.mesh.matrixWorld.multiplyMatrices(root.matrixWorld, p.rel); continue; }
    blendOne(e, 'M', p.bi, a0, a1, k, _b);
    const f = Q ? Q.flags[p.bi] : 0;
    if (f) _b.premultiply(X[f - 1]);
    p.mesh.matrixWorld.multiplyMatrices(root.matrixWorld, _b).multiply(p.rel);
  }
  for (const s of inst.skins) {
    const mats = s.mats ||= new Float32Array(s.boneMap.length * 16), map = s.boneMap, n = Math.min(map.length, mats.length >> 4);
    for (let i = 0; i < n; i++) {
      const bi = map[i], f = Q ? Q.flags[bi] : 0;
      blendOne(e, 'S', bi, a0, a1, k, _b);
      if (f) _b.premultiply(X[f - 1]);
      _b.toArray(mats, i * 16);
    }
  }
}

function room(n) {
  if (n <= W.outN) return;
  W.outN = Math.max(n, W.outN * 2); W.out = alloc(64 * W.outN); W.idx = alloc(4 * W.outN);
}

function placeWasm(inst, e, a0, a1, k, Q, root) {
  const ex = W.ex, flags = Q ? Q.wFlags : 0;
  const pb = inst.pcPartBones;
  if (pb.length) {
    room(pb.length);
    W.I32.set(pb, W.idx >> 2);
    ex.blend(e.mAt, a0, a1, k, W.idx, pb.length, flags, W.xs, W.out, W.tmp);
  }
  const F = W.F32;
  let j = 0;
  for (const p of inst.pcParts) {
    if (p.bi < 0) { p.mesh.matrixWorld.multiplyMatrices(root.matrixWorld, p.rel); continue; }
    const o = _b.elements, at = (W.out >> 2) + j++ * 16;
    for (let c = 0; c < 16; c++) o[c] = F[at + c];
    p.mesh.matrixWorld.multiplyMatrices(root.matrixWorld, _b).multiply(p.rel);
  }
  for (const s of inst.skins) {
    const mats = s.mats ||= new Float32Array(s.boneMap.length * 16), n = Math.min(s.boneMap.length, mats.length >> 4);
    room(n);
    let mp = maps.get(s.boneMap);
    if (mp === undefined) { mp = alloc(s.boneMap.length * 4); W.I32.set(s.boneMap, mp >> 2); maps.set(s.boneMap, mp); }
    ex.blend(e.sAt, a0, a1, k, mp, n, flags, W.xs, W.out, W.tmp);
    mats.set(W.F32.subarray(W.out >> 2, (W.out >> 2) + n * 16));
  }
}
