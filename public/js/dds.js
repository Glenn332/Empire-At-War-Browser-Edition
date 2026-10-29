import { diag } from './diag.js';
import * as THREE from '../vendor/three/build/three.module.js';
import { fetchBinary } from './vfs.js';
import { gfx } from './gfx.js';
import { decodeDXT } from './ddsdecode.js';
import { buildMips, mipsFit } from './ddsmips.js';

const FOURCC = s => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);
const DXT1 = FOURCC('DXT1'),
  DXT3 = FOURCC('DXT3'),
  DXT5 = FOURCC('DXT5');

const isDDS = buf => buf.byteLength >= 4 && new DataView(buf).getUint32(0, true) === 0x20534444;
export function parseDDS(buffer) {
  const h = new Int32Array(buffer, 0, 31);
  if (h[0] !== 0x20534444) throw new Error('not a DDS file');
  const height = h[3],
    width = h[4];
  const mipCount = h[2] & 0x20000 ? Math.max(1, h[7]) : 1;
  const pfFlags = h[20],
    fourCC = h[21],
    bits = h[22];
  const rMask = h[23] >>> 0,
    gMask = h[24] >>> 0,
    bMask = h[25] >>> 0,
    aMask = h[26] >>> 0;
  const cube = (h[28] & 0x200) !== 0;
  let offset = 128;
  const mipmaps = [];
  if (pfFlags & 0x4) {
    let format, block;
    if (fourCC === DXT1) {
      format = THREE.RGBA_S3TC_DXT1_Format;
      block = 8;
    } else if (fourCC === DXT3) {
      format = THREE.RGBA_S3TC_DXT3_Format;
      block = 16;
    } else if (fourCC === DXT5) {
      format = THREE.RGBA_S3TC_DXT5_Format;
      block = 16;
    } else throw new Error('unsupported DDS fourCC ' + fourCC.toString(16));
    let w = width,
      hh = height;
    for (let i = 0; i < mipCount; i++) {
      const size = Math.max(1, (w + 3) >> 2) * Math.max(1, (hh + 3) >> 2) * block;
      if (offset + size > buffer.byteLength) break;
      mipmaps.push({ data: new Uint8Array(buffer, offset, size), width: w, height: hh });
      offset += size;
      w = Math.max(1, w >> 1);
      hh = Math.max(1, hh >> 1);
    }
    return { width, height, format, compressed: true, mipmaps, cube, hasAlpha: fourCC !== DXT1 };
  }
  const bpp = bits >> 3;
  const shift = m => {
    let s = 0;
    if (!m) return 0;
    while (!((m >>> s) & 1)) s++;
    return s;
  };
  const scale = m => {
    const v = m >>> shift(m);
    return v ? 255 / v : 0;
  };
  const rs = shift(rMask),
    gs = shift(gMask),
    bs = shift(bMask),
    as = shift(aMask);
  const rk = scale(rMask),
    gk = scale(gMask),
    bk = scale(bMask),
    ak = scale(aMask);
  const lum = (pfFlags & 0x20000) !== 0 || (gMask === 0 && bMask === 0 && rMask !== 0);
  const alphaOnly = rMask === 0 && gMask === 0 && bMask === 0 && aMask !== 0;
  const src = new Uint8Array(buffer);
  let w = width,
    hh = height;
  for (let i = 0; i < mipCount; i++) {
    const n = w * hh;
    if (offset + n * bpp > buffer.byteLength) break;
    const out = new Uint8Array(n * 4);
    for (let j = 0, p = offset; j < n; j++, p += bpp) {
      let v = 0;
      for (let k = 0; k < bpp; k++) v |= src[p + k] << (8 * k);
      v >>>= 0;
      const o = j * 4;
      if (alphaOnly) {
        out[o] = out[o + 1] = out[o + 2] = 255;
      } else {
        const r = ((v & rMask) >>> rs) * rk;
        out[o] = r;
        out[o + 1] = lum ? r : ((v & gMask) >>> gs) * gk;
        out[o + 2] = lum ? r : ((v & bMask) >>> bs) * bk;
      }
      out[o + 3] = aMask ? ((v & aMask) >>> as) * ak : 255;
    }
    mipmaps.push({ data: out, width: w, height: hh });
    offset += n * bpp;
    w = Math.max(1, w >> 1);
    hh = Math.max(1, hh >> 1);
  }
  return { width, height, format: THREE.RGBAFormat, compressed: false, mipmaps, cube, hasAlpha: aMask !== 0 };
}

export function decodeTGA(buf) {
  const d = new DataView(buf),
    b = new Uint8Array(buf);
  if (b[0] === 0x42 && b[1] === 0x4d) {
    const at = d.getUint32(10, true),
      w = d.getInt32(18, true),
      hh = d.getInt32(22, true),
      h = Math.abs(hh),
      bpp = d.getUint16(28, true),
      px = bpp >> 3;
    if ((d.getUint32(30, true) !== 0 && d.getUint32(30, true) !== 3) || (bpp !== 32 && bpp !== 24)) throw new Error('unsupported bitmap');
    const out = new Uint8Array(w * h * 4),
      row = (w * px + 3) & ~3;
    for (let y = 0; y < h; y++) {
      let p = at + y * row,
        o = (hh > 0 ? h - 1 - y : y) * w * 4;
      for (let x = 0; x < w; x++, p += px, o += 4) {
        out[o] = b[p + 2];
        out[o + 1] = b[p + 1];
        out[o + 2] = b[p];
        out[o + 3] = px === 4 ? b[p + 3] : 255;
      }
    }
    return { data: out, width: w, height: h, alpha: px === 4 };
  }
  const idLen = b[0],
    type = b[2],
    w = d.getUint16(12, true),
    h = d.getUint16(14, true),
    bpp = b[16],
    desc = b[17];
  if ((type !== 2 && type !== 10) || (bpp !== 32 && bpp !== 24)) throw new Error('unsupported TGA');
  const px = bpp >> 3,
    topDown = (desc & 0x20) !== 0;
  const out = new Uint8Array(w * h * 4);
  let p = 18 + idLen;
  const put = (i, q) => {
    const o = ((topDown ? Math.floor(i / w) : h - 1 - Math.floor(i / w)) * w + (i % w)) * 4;
    out[o] = b[q + 2];
    out[o + 1] = b[q + 1];
    out[o + 2] = b[q];
    out[o + 3] = px === 4 ? b[q + 3] : 255;
  };
  if (type === 2) for (let i = 0; i < w * h; i++, p += px) put(i, p);
  else
    for (let i = 0; i < w * h; ) {
      const head = b[p++],
        n = (head & 127) + 1;
      if (head & 128) {
        for (let k = 0; k < n; k++) put(i++, p);
        p += px;
      } else for (let k = 0; k < n; k++, p += px) put(i++, p);
    }
  return { data: out, width: w, height: h, alpha: px === 4 };
}

function parseTGA(buffer) {
  const p = decodeTGA(buffer);
  return {
    width: p.width,
    height: p.height,
    format: THREE.RGBAFormat,
    compressed: false,
    mipmaps: [{ data: p.data, width: p.width, height: p.height }],
    cube: false,
    hasAlpha: p.alpha
  };
}

export const parseTexture = buf => (isDDS(buf) ? parseDDS(buf) : parseTGA(buf));

const isPicture = buf => {
  if (buf.byteLength < 4) return false;
  const b = new Uint8Array(buf, 0, 4);
  return (
    (b[0] === 0xff && b[1] === 0xd8) ||
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
    (b[0] === 0x42 && b[1] === 0x4d)
  );
};
const pictureBitmap = buf => createImageBitmap(new Blob([buf]));
async function parsePicture(buf) {
  const bmp = await pictureBitmap(buf),
    w = bmp.width,
    h = bmp.height;
  const cv =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = cv.getContext('2d');
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const data = new Uint8Array(g.getImageData(0, 0, w, h).data.buffer);
  return {
    width: w,
    height: h,
    format: THREE.RGBAFormat,
    compressed: false,
    mipmaps: [{ data, width: w, height: h }],
    cube: false,
    hasAlpha: true
  };
}
const parseAnyTexture = async buf => (isPicture(buf) ? parsePicture(buf) : parseTexture(buf));

const textures = new Map();
let fallback;

function detail(dds) {
  let skip = dds.cube ? 0 : Math.min(gfx.texMip | 0, dds.mipmaps.length - 1);
  while (skip > 0 && Math.min(dds.mipmaps[skip].width, dds.mipmaps[skip].height) < 64) skip--;
  return skip > 0 ? { ...dds, mipmaps: dds.mipmaps.slice(skip), width: dds.mipmaps[skip].width, height: dds.mipmaps[skip].height } : dds;
}

const dxtKind = dds =>
  !dds.compressed ? 0 : dds.format === THREE.RGBA_S3TC_DXT1_Format ? 1 : dds.format === THREE.RGBA_S3TC_DXT3_Format ? 3 : 5;

let dxtOK;
export function dxtSupported() {
  if (dxtOK === undefined) {
    dxtOK = !(typeof location !== 'undefined' && /[?&]nodxt/.test(location.search));
    if (dxtOK)
      try {
        const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        if (gl) {
          dxtOK = !!gl.getExtension('WEBGL_compressed_texture_s3tc');
          const lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        }
      } catch {}
    if (!dxtOK) console.warn('textures: no DXT support here, unpacked to RGBA');
  }
  return dxtOK;
}

async function wholeBlocks(dds) {
  if (!dds.compressed || (dds.width % 4 === 0 && dds.height % 4 === 0 && dxtSupported())) return dds;
  const kind = dxtKind(dds);
  const mipmaps = await Promise.all(
    dds.mipmaps.map(async m => {
      const off = await decodeElsewhere(m.data, m.width, m.height, kind, true);
      return { data: off && off.rgba ? off.rgba : decodeDXT(m.data, m.width, m.height, kind), width: m.width, height: m.height };
    })
  );
  return { ...dds, format: THREE.RGBAFormat, compressed: false, mipmaps };
}

async function fullChain(dds) {
  if (!dds.compressed || dds.cube || dds.mipmaps.length > 1 || !mipsFit(dds.width, dds.height)) return dds;
  const kind = dxtKind(dds),
    top = dds.mipmaps[0];
  const off = await decodeElsewhere(top.data, top.width, top.height, kind, false, true);
  const rest = off && off.mips ? off.mips : buildMips(top.data, top.width, top.height, kind);
  return { ...dds, mipmaps: [top, ...rest] };
}

function makeTexture(dds, repeat) {
  let tex;
  if (dds.compressed) {
    tex = new THREE.CompressedTexture(dds.mipmaps, dds.width, dds.height, dds.format);
  } else {
    tex = new THREE.DataTexture(dds.mipmaps[0].data, dds.width, dds.height, THREE.RGBAFormat);
    if (dds.mipmaps.length > 1) tex.mipmaps = dds.mipmaps;
    else tex.generateMipmaps = true;
  }
  const mipped = dds.mipmaps.length > 1 || !dds.compressed;
  tex.minFilter = mipped ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.userData.hasAlpha = dds.hasAlpha;
  tex.needsUpdate = true;
  return tex;
}

export function whiteTexture() {
  if (!fallback) {
    fallback = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    fallback.needsUpdate = true;
  }
  return fallback;
}

const fileOf = name => (/\.[a-z0-9]{2,4}$/i.test(name) ? name : name + '.dds');

export function loadTexture(name, { repeat = true } = {}) {
  if (!name) return whiteTexture();
  const key = name.toUpperCase() + (repeat ? '' : '|C');
  let tex = textures.get(key);
  if (tex) return tex;
  tex = new FileTexture();
  tex.userData.pending = true;
  textures.set(key, tex);
  tex.userData.ready = picture(name, repeat).then(real => {
    tex.copy(real);
    tex.userData.hasAlpha = real.userData.hasAlpha;
    tex.userData.pending = false;
    if (real !== fallback) {
      files.set(tex.source, { name, repeat });
      tex.onUpdate = releasePictures;
    }
    tex.needsUpdate = true;
    return tex;
  });
  return tex;
}

function picture(name, repeat) {
  return fetchBinary('Data/Art/Textures/' + fileOf(name), { keep: false }).then(async buf => {
    let real;
    try {
      const file = buf ? await fullChain(await wholeBlocks(detail(await parseAnyTexture(buf)))) : null;
      real = file ? diag.task('texture ' + name, () => makeTexture(file, repeat)) : null;
    } catch (e) {
      console.warn('texture', name, e.message);
    }
    return real || whiteTexture();
  });
}

const files = new WeakMap();
const keepData = new WeakSet(),
  restoring = new WeakSet();
const hasPictures = t => !!(t.mipmaps?.[0]?.data || t.image?.data);

class FileTexture extends THREE.Texture {
  copy(source) {
    super.copy(source);
    this.isCompressedTexture = source.isCompressedTexture === true;
    this.isDataTexture = source.isDataTexture === true;
    this.onUpdate = source.onUpdate;
    if (files.has(this.source) && !hasPictures(this)) {
      this.source = waiting(this, files.get(this.source));
      restorePictures(this);
    }
    return this;
  }
}

function waiting(t, file) {
  const { width, height, depth } = t.image;
  const source = new THREE.Source({
    width,
    height,
    depth,
    get complete() {
      restorePictures(t, true);
      return false;
    }
  });
  files.set(source, file);
  return source;
}

function releasePictures(t) {
  const file = files.get(t.source);
  if (!file || keepData.has(t) || !hasPictures(t)) return;
  t.mipmaps = t.mipmaps.map(m => ({ width: m.width, height: m.height }));
  t.source = waiting(t, file);
}

function restorePictures(t, keep = false) {
  if (keep) keepData.add(t);
  const file = files.get(t.source);
  if (!file || restoring.has(t) || hasPictures(t)) return;
  restoring.add(t);
  picture(file.name, file.repeat).then(real => {
    restoring.delete(t);
    t.mipmaps = real.mipmaps.slice();
    t.source = real.source;
    files.set(t.source, file);
    t.needsUpdate = true;
  });
}

export async function texturesReady() {
  let n = -1;
  while (n !== textures.size) {
    n = textures.size;
    await Promise.all([...textures.values()].map(t => t.userData.ready));
  }
  return [...textures.values()];
}

export function textureBytes() {
  let n = 0;
  for (const t of textures.values()) {
    if (t.mipmaps && t.mipmaps.length) for (const m of t.mipmaps) n += m.data ? m.data.byteLength : 0;
    else if (t.image && t.image.width) n += t.image.width * t.image.height * 4;
  }
  return n;
}

export async function loadDDS(name) {
  const buf = await fetchBinary('Data/Art/Textures/' + fileOf(name));
  if (!buf) return null;
  try {
    return await parseAnyTexture(buf);
  } catch (e) {
    console.warn('texture', name, e.message);
    return null;
  }
}

let urlWorker = null,
  urlNext = 0;
const urlWaiting = new Map();
export async function canvasUrl(cv) {
  if (urlWorker === null) {
    try {
      urlWorker =
        typeof OffscreenCanvas !== 'undefined' ? new Worker(new URL('./canvasurlworker.js', import.meta.url), { type: 'module' }) : false;
      if (urlWorker) {
        urlWorker.onmessage = e => {
          const w = urlWaiting.get(e.data.id);
          urlWaiting.delete(e.data.id);
          w && w(e.data.blob);
        };
        urlWorker.onerror = () => {
          urlWorker = false;
          for (const w of urlWaiting.values()) w(null);
          urlWaiting.clear();
        };
      }
    } catch {
      urlWorker = false;
    }
  }
  if (!urlWorker) return cv.toDataURL();
  const bitmap = await createImageBitmap(cv),
    id = ++urlNext;
  const blob = await new Promise(res => {
    urlWaiting.set(id, res);
    urlWorker.postMessage({ id, bitmap }, [bitmap]);
  });
  return blob ? URL.createObjectURL(blob) : cv.toDataURL();
}

export async function loadTextureCanvas(name) {
  const buf = await fetchBinary('Data/Art/Textures/' + fileOf(name));
  if (!buf) return null;
  if (isPicture(buf)) {
    const bmp = await pictureBitmap(buf),
      cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    return cv;
  }
  const dds = parseTexture(buf);
  const { width, height } = dds;
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const g = cv.getContext('2d');
  const kind = dxtKind(dds);
  const off = kind ? await decodeElsewhere(dds.mipmaps[0].data, width, height, kind) : null;
  if (off && off.bitmap) {
    g.drawImage(off.bitmap, 0, 0);
    off.bitmap.close();
    return cv;
  }
  const rgba = off && off.rgba ? off.rgba : kind ? decodeDXT(dds.mipmaps[0].data, width, height, kind) : dds.mipmaps[0].data;
  g.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4), width, height), 0, 0);
  return cv;
}

let decoders = null,
  decodeSeq = 0,
  nextDecoder = 0,
  decodersToCome = 0,
  decoderWatch = 0,
  decoderAnswered = false;
const decoding = new Map();
const DECODER_WAIT_MS = 4000;
function decodersFailed() {
  clearTimeout(decoderWatch);
  for (const d of decoders || []) d.terminate();
  decoders = [];
  decodersToCome = 0;
  for (const done of decoding.values()) done(null);
  decoding.clear();
}
function startDecoder() {
  const w = new Worker(new URL('./ddsworker.js', import.meta.url), { type: 'module' });
  w.onmessage = e => {
    if (!decoderAnswered) {
      decoderAnswered = true;
      clearTimeout(decoderWatch);
      try {
        for (; decodersToCome > 0; decodersToCome--) startDecoder();
      } catch {
        decodersToCome = 0;
      }
    }
    const done = decoding.get(e.data.id);
    decoding.delete(e.data.id);
    if (done) done(e.data);
  };
  w.onerror = decodersFailed;
  decoders.push(w);
}
function decodeElsewhere(src, width, height, kind, rgba = false, mips = false) {
  if (decoders === null) {
    decoders = [];
    try {
      decodersToCome = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 2)) - 1;
      startDecoder();
      decoderWatch = setTimeout(() => {
        if (!decoderAnswered) decodersFailed();
      }, DECODER_WAIT_MS);
    } catch {
      decodersFailed();
    }
  }
  if (!decoders.length) return Promise.resolve(null);
  return new Promise(done => {
    const id = ++decodeSeq,
      copy = src.slice();
    decoding.set(id, done);
    decoders[nextDecoder++ % decoders.length].postMessage({ id, src: copy, width, height, kind, rgba, mips }, [copy.buffer]);
  });
}
