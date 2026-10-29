import { diag } from './diag.js';
import { ChunkReader, fetchBinary } from './vfs.js';

const PARAM_INT = 0x10102, PARAM_FLOAT = 0x10103, PARAM_FLOAT3 = 0x10104, PARAM_TEXTURE = 0x10105, PARAM_FLOAT4 = 0x10106;

function parseBone(r, c) {
  const bone = { name: '', parent: -1, visible: true, billboard: 0, matrix: null };
  for (const k of r.chunks(c.start, c.end)) {
    if (k.type === 0x203) bone.name = r.str(k.start, k.end);
    else if (k.type === 0x205 || k.type === 0x206) {
      let p = k.start;
      bone.parent = r.i32(p); p += 4;
      bone.visible = r.u32(p) !== 0; p += 4;
      if (k.type === 0x206) { bone.billboard = r.u32(p); p += 4; }
      bone.matrix = r.vec(p, 12);
    }
  }
  return bone;
}

function parseMaterial(r, c) {
  const mat = { shader: '', params: {} };
  for (const k of r.chunks(c.start, c.end)) {
    if (k.type === 0x10101) { mat.shader = r.str(k.start, k.end).toLowerCase(); continue; }
    let name = '', value = null;
    for (const m of r.minis(k)) {
      if (m.type === 1) name = r.str(m.start, m.start + m.size);
      else if (m.type === 2) {
        if (k.type === PARAM_INT) value = r.i32(m.start);
        else if (k.type === PARAM_FLOAT) value = r.f32(m.start);
        else if (k.type === PARAM_FLOAT3) value = r.vec(m.start, 3);
        else if (k.type === PARAM_FLOAT4) value = r.vec(m.start, 4);
        else if (k.type === PARAM_TEXTURE) value = r.str(m.start, m.start + m.size);
      }
    }
    if (name) mat.params[name] = value;
  }
  return mat;
}

function parseGeometry(r, c) {
  const g = { nVerts: 0, nPrims: 0, format: '', stride: 0, vertices: null, indices: null, boneMap: null };
  let at = -1;
  for (const k of r.chunks(c.start, c.end)) {
    switch (k.type) {
      case 0x10001: g.nVerts = r.u32(k.start); g.nPrims = r.u32(k.start + 4); break;
      case 0x10002: g.format = r.str(k.start, k.end); break;
      case 0x10004: g.indices = new Uint16Array(r.buf.slice(k.start, k.end)); break;
      case 0x10005: g.stride = 128; at = k.start; break;
      case 0x10007: g.stride = 144; at = k.start; break;
      case 0x10006: g.boneMap = new Uint32Array(r.buf.slice(k.start, k.end)); break;
    }
  }
  if (g.stride) {
    try { g.vertices = readVertices(r.buf, g, at); } catch (e) { console.warn('model vertices', e.message); g.stride = 0; }
  }
  return g;
}

function readVertices(buf, g, at) {
  const n = g.nVerts, stride = g.stride, src = new DataView(buf, at, n * stride);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const tan = new Float32Array(n * 3), bin = new Float32Array(n * 3);
  const col = g.format.endsWith('C') ? new Float32Array(n * 4) : null;
  const skinned = /RSkin|B4I4/.test(g.format), rigid = /RSkin/.test(g.format);
  const skinIndex = skinned ? new Float32Array(n * 4) : null, skinWeight = skinned ? new Float32Array(n * 4) : null;
  const idxAt = stride === 144 ? 112 : 96, wAt = idxAt + 16;
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = src.getFloat32(o + k * 4, true);
      nrm[i * 3 + k] = src.getFloat32(o + 12 + k * 4, true);
      tan[i * 3 + k] = src.getFloat32(o + 56 + k * 4, true);
      bin[i * 3 + k] = src.getFloat32(o + 68 + k * 4, true);
    }
    uv[i * 2] = src.getFloat32(o + 24, true);
    uv[i * 2 + 1] = src.getFloat32(o + 28, true);
    if (col) for (let k = 0; k < 4; k++) col[i * 4 + k] = src.getFloat32(o + 80 + k * 4, true);
    if (skinned) {
      for (let k = 0; k < 4; k++) {
        skinIndex[i * 4 + k] = src.getUint32(o + idxAt + k * 4, true);
        skinWeight[i * 4 + k] = rigid ? (k === 0 ? 1 : 0) : src.getFloat32(o + wAt + k * 4, true);
      }
      if (rigid) skinIndex[i * 4 + 1] = skinIndex[i * 4 + 2] = skinIndex[i * 4 + 3] = skinIndex[i * 4];
    }
  }
  return { pos, nrm, uv, tan, bin, col, skinIndex, skinWeight };
}

function parseMesh(r, c) {
  const mesh = { name: '', hidden: false, collision: false, bbox: null, subs: [], bone: -1 };
  let material = null;
  for (const k of r.chunks(c.start, c.end)) {
    if (k.type === 0x401) mesh.name = r.str(k.start, k.end);
    else if (k.type === 0x402) {
      mesh.bbox = r.vec(k.start + 4, 6);
      mesh.hidden = r.u32(k.start + 32) !== 0;
      mesh.collision = r.u32(k.start + 36) !== 0;
    } else if (k.type === 0x10100) material = parseMaterial(r, k);
    else if (k.type === 0x10000) { mesh.subs.push({ material, geometry: parseGeometry(r, k) }); }
  }
  return mesh;
}

export function parseALO(buffer) {
  const r = new ChunkReader(buffer);
  const model = { bones: [], meshes: [], proxies: [], isParticle: false };
  const objects = [];
  for (const c of r.chunks()) {
    if (c.type === 0x200) {
      for (const k of r.chunks(c.start, c.end)) if (k.type === 0x202) model.bones.push(parseBone(r, k));
    } else if (c.type === 0x400) {
      const m = parseMesh(r, c);
      model.meshes.push(m); objects.push(m);
    } else if (c.type === 0x1300) {
      objects.push({ light: true });
    } else if (c.type === 0x600) {
      for (const k of r.chunks(c.start, c.end)) {
        if (k.type === 0x602) {
          let obj = -1, bone = -1;
          for (const m of r.minis(k)) { if (m.type === 2) obj = r.u32(m.start); else if (m.type === 3) bone = r.u32(m.start); }
          if (objects[obj]) objects[obj].bone = bone;
        } else if (k.type === 0x603) {
          const px = { name: '', bone: -1, hidden: false, altDecreaseStayHidden: false };
          for (const m of r.minis(k)) {
            if (m.type === 5) px.name = r.str(m.start, m.start + m.size);
            else if (m.type === 6) px.bone = r.u32(m.start);
            else if (m.type === 7) px.hidden = r.u32(m.start) !== 0;
            else if (m.type === 8) px.altDecreaseStayHidden = r.u32(m.start) !== 0;
          }
          model.proxies.push(px);
        }
      }
    } else if (c.type === 0x900) {
      model.isParticle = true;
    }
  }
  return model;
}

const models = new Map();

export function loadALO(name) {
  const stem = name.replace(/^.*[\\/]/, '').split('.')[0].toUpperCase(), key = stem;
  let p = models.get(key);
  if (!p) {
    const alo = stem + '.ALO';
    p = fetchBinary('Data/Art/Models/' + name, { keep: false })
      .then(buf => (buf || name.toUpperCase() === alo ? buf : fetchBinary('Data/Art/Models/' + alo, { keep: false })))
      .then(buf => (buf ? diag.task('model ' + name, () => parseALO(buf)) : null));
    models.set(key, p);
  }
  return p;
}
