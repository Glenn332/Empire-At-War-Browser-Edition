import { diag } from './diag.js';
import { ChunkReader, fetchBinary, fetchPart } from './vfs.js';

const PARAM_INT = 0x10102,
  PARAM_FLOAT = 0x10103,
  PARAM_FLOAT3 = 0x10104,
  PARAM_TEXTURE = 0x10105,
  PARAM_FLOAT4 = 0x10106;

function parseBone(r, c) {
  const bone = { name: '', parent: -1, visible: true, billboard: 0, matrix: null };
  for (const k of r.chunks(c.start, c.end)) {
    if (k.type === 0x203) bone.name = r.str(k.start, k.end);
    else if (k.type === 0x205 || k.type === 0x206) {
      let p = k.start;
      bone.parent = r.i32(p);
      p += 4;
      bone.visible = r.u32(p) !== 0;
      p += 4;
      if (k.type === 0x206) {
        bone.billboard = r.u32(p);
        p += 4;
      }
      bone.matrix = r.vec(p, 12);
    }
  }
  return bone;
}

function parseMaterial(r, c) {
  const mat = { shader: '', params: {} };
  for (const k of r.chunks(c.start, c.end)) {
    if (k.type === 0x10101) {
      mat.shader = r.str(k.start, k.end).toLowerCase().replace(/\.fxo$/, '.fx');
      continue;
    }
    let name = '',
      value = null;
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
      case 0x10001:
        g.nVerts = r.u32(k.start);
        g.nPrims = r.u32(k.start + 4);
        break;
      case 0x10002:
        g.format = r.str(k.start, k.end);
        break;
      case 0x10004:
        g.indices = new Uint16Array(r.buf.slice(k.start, k.end));
        break;
      case 0x10005:
        g.stride = 128;
        at = k.start;
        break;
      case 0x10007:
        g.stride = 144;
        at = k.start;
        break;
      case 0x10006:
        g.boneMap = new Uint32Array(r.buf.slice(k.start, k.end));
        break;
    }
  }
  if (g.stride) {
    try {
      g.vertices = readVertices(r.buf, g, at);
    } catch (e) {
      console.warn('model vertices', e.message);
      g.stride = 0;
    }
  }
  return g;
}

function readVertices(buf, g, at) {
  const n = g.nVerts,
    stride = g.stride,
    src = new DataView(buf, at, n * stride);
  const pos = new Float32Array(n * 3),
    nrm = new Float32Array(n * 3),
    uv = new Float32Array(n * 2);
  const tan = new Float32Array(n * 3),
    bin = new Float32Array(n * 3);
  const col = g.format.endsWith('C') ? new Float32Array(n * 4) : null;
  const skinned = /RSkin|B4I4/.test(g.format),
    rigid = /RSkin/.test(g.format);
  const skinIndex = skinned ? new Float32Array(n * 4) : null,
    skinWeight = skinned ? new Float32Array(n * 4) : null;
  const idxAt = stride === 144 ? 112 : 96,
    wAt = idxAt + 16;
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

function parseMesh(r, c, outline) {
  const mesh = { name: '', hidden: false, collision: false, bbox: null, subs: [], bone: -1 };
  let material = null;
  for (const k of r.chunks(c.start, c.end)) {
    if (k.type === 0x401) mesh.name = r.str(k.start, k.end);
    else if (k.type === 0x402) {
      mesh.bbox = r.vec(k.start + 4, 6);
      mesh.hidden = r.u32(k.start + 32) !== 0;
      mesh.collision = r.u32(k.start + 36) !== 0;
    } else if (outline) continue;
    else if (k.type === 0x10100) material = parseMaterial(r, k);
    else if (k.type === 0x10000) {
      mesh.subs.push({ material, geometry: parseGeometry(r, k) });
    }
  }
  return mesh;
}

export function parseALO(buffer, { outline = false } = {}) {
  const r = new ChunkReader(buffer);
  const model = { bones: [], meshes: [], proxies: [], isParticle: false };
  const objects = [];
  for (const c of r.chunks()) {
    if (c.type === 0x200) {
      for (const k of r.chunks(c.start, c.end)) if (k.type === 0x202) model.bones.push(parseBone(r, k));
    } else if (c.type === 0x400) {
      const m = parseMesh(r, c, outline);
      model.meshes.push(m);
      objects.push(m);
    } else if (c.type === 0x1300) {
      objects.push({ light: true });
    } else if (c.type === 0x600) {
      for (const k of r.chunks(c.start, c.end)) {
        if (k.type === 0x602) {
          let obj = -1,
            bone = -1;
          for (const m of r.minis(k)) {
            if (m.type === 2) obj = r.u32(m.start);
            else if (m.type === 3) bone = r.u32(m.start);
          }
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

// Parsing and vertex conversion are pure CPU work. Keep them off the UI thread, but retain the
// synchronous parser for Node, tests, non-browser hosts and a worker startup failure.
let parsers = null,
  parserNext = 0,
  parserId = 0;
const parserJobs = new Map();
function parserFailed() {
  for (const worker of parsers || []) worker.terminate?.();
  parsers = [];
  for (const job of parserJobs.values()) {
    clearTimeout(job.timer);
    job.resolve(null);
  }
  parserJobs.clear();
}
function parseElsewhere(buffer, outline) {
  if (parsers === null) {
    parsers = [];
    try {
      if (typeof Worker === 'undefined') return Promise.resolve(null);
      const count = Math.min(2, Math.max(1, (globalThis.navigator?.hardwareConcurrency || 4) - 2));
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./aloworker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          const job = parserJobs.get(data.id);
          parserJobs.delete(data.id);
          if (job) {
            clearTimeout(job.timer);
            job.resolve(data.error ? null : data.model);
          }
        };
        worker.onerror = parserFailed;
        parsers.push(worker);
      }
    } catch {
      parserFailed();
    }
  }
  if (!parsers.length) return Promise.resolve(null);
  const id = ++parserId;
  return new Promise(resolve => {
    // A worker that never answers (a stub in a test host, a wedged real worker) must not hang model
    // loading: the first silent worker tears the whole pool down and later loads parse synchronously.
    parserJobs.set(id, { resolve, timer: setTimeout(parserFailed, 5000) });
    // Do not transfer the caller's buffer: outline and fallback paths may still need it.
    const copy = buffer.slice(0);
    parsers[parserNext++ % parsers.length].postMessage({ id, buffer: copy, outline }, [copy]);
  });
}
async function parseLoaded(buffer, name, outline = false) {
  const parsed = await parseElsewhere(buffer, outline);
  return parsed || diag.task('model ' + name, () => parseALO(buffer, { outline }));
}

const modelStem = name =>
  name
    .replace(/^.*[\\/]/, '')
    .split('.')[0]
    .toUpperCase();

function fetchModelBytes(name) {
  const alo = modelStem(name) + '.ALO';
  return fetchBinary('Data/Art/Models/' + name, { keep: false }).then(buf =>
    buf || name.toUpperCase() === alo ? buf : fetchBinary('Data/Art/Models/' + alo, { keep: false })
  );
}

export function loadALO(name) {
  const key = modelStem(name);
  let p = models.get(key);
  if (!p) {
    p = fetchModelBytes(name).then(buf => (buf ? parseLoaded(buf, name) : null));
    models.set(key, p);
  }
  return p;
}

const OUTLINE_READ = 4096;
const WHOLE_CHUNKS = new Set([0x200, 0x600, 0x1300]);

class PartReader {
  constructor(path) {
    this.path = path;
    this.from = 0;
    this.bytes = new Uint8Array(0);
    this.total = null;
  }

  async at(offset, length) {
    if (this.total !== null && offset >= this.total) return new Uint8Array(0);
    const end = offset + length;
    if (offset < this.from || end > this.from + this.bytes.length) {
      const wanted = Math.max(length, OUTLINE_READ),
        part = await fetchPart(this.path, offset, this.total === null ? wanted : Math.min(wanted, this.total - offset));
      if (!part) return null;
      if (part.total !== null) this.total = part.total;
      this.from = offset;
      this.bytes = new Uint8Array(part.bytes);
    }
    const start = offset - this.from;
    return this.bytes.subarray(start, Math.min(start + length, this.bytes.length));
  }
}

const chunkHeader = (type, size, container) => {
  const header = new DataView(new ArrayBuffer(8));
  header.setUint32(0, type, true);
  header.setUint32(4, (size | (container ? 0x80000000 : 0)) >>> 0, true);
  return new Uint8Array(header.buffer);
};

async function meshOutline(reader, start, end) {
  const head = await reader.at(start, Math.min(end - start, OUTLINE_READ - 8));
  if (!head) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength),
    kept = [];
  for (let at = 0; at + 8 <= head.length; ) {
    const type = view.getUint32(at, true),
      size = view.getUint32(at + 4, true) & 0x7fffffff;
    if (type !== 0x401 && type !== 0x402) break;
    if (at + 8 + size > head.length) return null;
    kept.push(head.slice(at, at + 8 + size));
    at += 8 + size;
  }
  return kept;
}

async function outlineBytes(path) {
  const reader = new PartReader(path),
    parts = [];
  let offset = 0;
  for (;;) {
    const header = await reader.at(offset, 8);
    if (!header) return offset ? null : undefined;
    if (header.length < 8) break;
    const view = new DataView(header.buffer, header.byteOffset, 8),
      type = view.getUint32(0, true),
      raw = view.getUint32(4, true),
      size = raw & 0x7fffffff,
      container = raw >>> 31 === 1,
      body = offset + 8;
    if (WHOLE_CHUNKS.has(type)) {
      const whole = await reader.at(offset, 8 + size);
      if (!whole || whole.length < 8 + size) return null;
      parts.push(whole.slice());
    } else if (type === 0x400) {
      const kept = await meshOutline(reader, body, body + size);
      if (!kept) return null;
      parts.push(chunkHeader(type, kept.reduce((sum, part) => sum + part.length, 0), container), ...kept);
    } else if (type === 0x900) parts.push(chunkHeader(type, 0, container));
    offset = body + size;
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

async function outlineFrom(path) {
  const bytes = await outlineBytes(path);
  if (bytes === undefined) return undefined;
  if (bytes === null) {
    const whole = await fetchBinary(path, { keep: false });
    return whole ? parseLoaded(whole, path, true) : null;
  }
  return parseLoaded(bytes, path, true);
}

export async function loadALOOutline(name) {
  const loaded = models.get(modelStem(name));
  if (loaded) return loaded;
  const alo = modelStem(name) + '.ALO';
  const first = await outlineFrom('Data/Art/Models/' + name);
  if (first !== undefined || name.toUpperCase() === alo) return first ?? null;
  return (await outlineFrom('Data/Art/Models/' + alo)) ?? null;
}
