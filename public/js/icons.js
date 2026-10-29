import { fetchBinary } from './vfs.js';
import { decodeTGA as decodePixels } from './dds.js';

const decodeTGA = buf => {
  const p = decodePixels(buf);
  return new ImageData(new Uint8ClampedArray(p.data.buffer), p.width, p.height);
};

function pixelsUrl(w, h, fill) {
  const head = 14 + 108,
    bytes = new Uint8Array(head + w * h * 4),
    d = new DataView(bytes.buffer);
  fill(bytes, head);
  let seen = false;
  for (let i = head + 3; i < bytes.length && !seen; i += 4) seen = bytes[i] !== 0;
  if (!seen) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, head), w, h), 0, 0);
    return cv.toDataURL();
  }
  d.setUint16(0, 0x4d42, true);
  d.setUint32(2, bytes.length, true);
  d.setUint32(10, head, true);
  d.setUint32(14, 108, true);
  d.setInt32(18, w, true);
  d.setInt32(22, -h, true);
  d.setUint16(26, 1, true);
  d.setUint16(28, 32, true);
  d.setUint32(30, 3, true);
  d.setUint32(34, w * h * 4, true);
  d.setUint32(54, 0x000000ff, true);
  d.setUint32(58, 0x0000ff00, true);
  d.setUint32(62, 0x00ff0000, true);
  d.setUint32(66, 0xff000000, true);
  d.setUint32(70, 0x73524742, true);
  return 'data:image/bmp;base64,' + base64(bytes);
}
function base64(bytes) {
  if (bytes.toBase64) return bytes.toBase64();
  const parts = [];
  for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
  return btoa(parts.join(''));
}

const rects = new Map();
let atlas = null,
  pixels = null;
const urls = new Map();

export async function loadIcons() {
  const [mtd, tga] = await Promise.all([
    fetchBinary('Data/Art/Textures/MT_CommandBar.mtd', { keep: false }),
    fetchBinary('Data/Art/Textures/MT_CommandBar.tga', { keep: false })
  ]);
  if (!mtd || !tga) return;
  const d = new DataView(mtd),
    b = new Uint8Array(mtd);
  const n = d.getUint32(0, true);
  for (let i = 0; i < n; i++) {
    const o = 4 + i * 81;
    let name = '';
    for (let j = 0; j < 64 && b[o + j]; j++) name += String.fromCharCode(b[o + j]);
    rects.set(name.toUpperCase(), {
      x: d.getUint32(o + 64, true),
      y: d.getUint32(o + 68, true),
      w: d.getUint32(o + 72, true),
      h: d.getUint32(o + 76, true)
    });
  }
  const img = (pixels = decodeTGA(tga));
  atlas = document.createElement('canvas');
  atlas.width = img.width;
  atlas.height = img.height;
  atlas.getContext('2d').putImageData(img, 0, 0);
}

export function iconUrl(name) {
  if (!name || !atlas) return '';
  const key = name.trim().toUpperCase();
  if (urls.has(key)) return urls.get(key);
  const r = rects.get(key);
  let url = '';
  if (r) {
    const src = pixels.data,
      cw = Math.max(0, Math.min(r.w, pixels.width - r.x)) * 4;
    url = pixelsUrl(r.w, r.h, (dst, at) => {
      for (let y = 0; y < Math.min(r.h, pixels.height - r.y); y++) {
        const i = ((r.y + y) * pixels.width + r.x) * 4;
        dst.set(src.subarray(i, i + cw), at + y * r.w * 4);
      }
    });
  }
  urls.set(key, url);
  return url;
}

export function iconAdditiveUrl(name, tint = null) {
  if (!name || !pixels) return '';
  const key = name.trim().toUpperCase(),
    t = tint && tint.slice(0, 3).some(v => v !== 1) ? tint.slice(0, 3) : null;
  const cacheKey = key + '|+' + (t ? t.join(',') : '');
  if (urls.has(cacheKey)) return urls.get(cacheKey);
  const r = rects.get(key);
  let url = '';
  if (r) {
    const src = pixels.data,
      [tr, tg, tb] = t || [1, 1, 1];
    url = pixelsUrl(r.w, r.h, (bytes, at) => {
      const dst = new Uint8ClampedArray(bytes.buffer, at);
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          const i = ((r.y + y) * pixels.width + r.x + x) * 4,
            o = (y * r.w + x) * 4;
          const cr = src[i] * tr,
            cg = src[i + 1] * tg,
            cb = src[i + 2] * tb,
            a = Math.max(cr, cg, cb);
          if (a <= 0) continue;
          dst[o] = (cr * 255) / a;
          dst[o + 1] = (cg * 255) / a;
          dst[o + 2] = (cb * 255) / a;
          dst[o + 3] = a;
        }
    });
  }
  urls.set(cacheKey, url);
  return url;
}

export function iconCanvasRect(name) {
  return name ? rects.get(name.trim().toUpperCase()) : null;
}
export function iconAtlas() {
  return atlas;
}

export function warmIcons(names) {
  const todo = [...new Set(names)].filter(n => n && !urls.has(n.trim().toUpperCase()));
  return new Promise(done => {
    const step = () => {
      const until = performance.now() + 6;
      while (todo.length && performance.now() < until) iconUrl(todo.pop());
      if (todo.length) setTimeout(step, 0);
      else done();
    };
    step();
  });
}
