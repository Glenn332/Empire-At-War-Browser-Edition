import { decodeDXT } from './ddsdecode.js';

export function mipsFit(width, height) {
  const fits = n => n <= 2 || n % 4 === 0;
  while (width > 1 || height > 1) {
    width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
    if (!fits(width) || !fits(height)) return false;
  }
  return true;
}

export function buildMips(src, width, height, kind) {
  let rgba = decodeDXT(src, width, height, kind), w = width, h = height;
  const out = [];
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), next = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
        const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4, o = (y * nw + x) * 4;
        for (let i = 0; i < 4; i++) next[o + i] = (rgba[a + i] + rgba[b + i] + rgba[c + i] + rgba[d + i] + 2) >> 2;
      }
    }
    rgba = next; w = nw; h = nh;
    out.push({ data: encodeDXT(rgba, w, h, kind), width: w, height: h });
  }
  return out;
}

const q5 = v => Math.round(v * 31 / 255), q6 = v => Math.round(v * 63 / 255);

export function encodeDXT(rgba, width, height, kind) {
  const bw = Math.max(1, (width + 3) >> 2), bh = Math.max(1, (height + 3) >> 2), size = kind === 1 ? 8 : 16;
  const out = new Uint8Array(bw * bh * size), px = new Float32Array(48), al = new Uint8Array(16), use = new Uint8Array(16);
  let p = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    for (let i = 0; i < 16; i++) {
      const x = Math.min(width - 1, bx * 4 + (i & 3)), y = Math.min(height - 1, by * 4 + (i >> 2)), o = (y * width + x) * 4;
      px[i * 3] = rgba[o]; px[i * 3 + 1] = rgba[o + 1]; px[i * 3 + 2] = rgba[o + 2]; al[i] = rgba[o + 3];
    }
    if (kind === 5) {
      let lo = 255, hi = 0;
      for (let i = 0; i < 16; i++) { if (al[i] < lo) lo = al[i]; if (al[i] > hi) hi = al[i]; }
      out[p] = hi; out[p + 1] = lo;
      let bits0 = 0, bits1 = 0;
      for (let i = 0; i < 16; i++) {
        const k = hi === lo ? 7 : Math.round((al[i] - lo) * 7 / (hi - lo));
        const idx = k === 7 ? 0 : k === 0 ? 1 : 8 - k;
        if (i < 8) bits0 |= idx << (3 * i); else bits1 |= idx << (3 * (i - 8));
      }
      out[p + 2] = bits0 & 255; out[p + 3] = (bits0 >> 8) & 255; out[p + 4] = (bits0 >> 16) & 255;
      out[p + 5] = bits1 & 255; out[p + 6] = (bits1 >> 8) & 255; out[p + 7] = (bits1 >> 16) & 255;
      p += 8;
    } else if (kind === 3) {
      for (let i = 0; i < 8; i++) out[p + i] = Math.round(al[i * 2] / 17) | (Math.round(al[i * 2 + 1] / 17) << 4);
      p += 8;
    }
    let n = 0, holes = false;
    for (let i = 0; i < 16; i++) { use[i] = kind !== 1 || al[i] >= 128 ? 1 : 0; if (use[i]) n++; else holes = true; }
    colorBlock(px, use, n, holes, out, p);
    p += 8;
  }
  return out;
}

function colorBlock(px, use, n, holes, out, p) {
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < 16; i++) if (use[i]) { mr += px[i * 3]; mg += px[i * 3 + 1]; mb += px[i * 3 + 2]; }
  if (n) { mr /= n; mg /= n; mb /= n; }
  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
  for (let i = 0; i < 16; i++) if (use[i]) {
    const r = px[i * 3] - mr, g = px[i * 3 + 1] - mg, b = px[i * 3 + 2] - mb;
    cxx += r * r; cxy += r * g; cxz += r * b; cyy += g * g; cyz += g * b; czz += b * b;
  }
  let vr = 1, vg = 1, vb = 1;
  for (let k = 0; k < 4; k++) {
    const r = cxx * vr + cxy * vg + cxz * vb, g = cxy * vr + cyy * vg + cyz * vb, b = cxz * vr + cyz * vg + czz * vb;
    const m = Math.max(Math.abs(r), Math.abs(g), Math.abs(b));
    if (m < 1e-6) break;
    vr = r / m; vg = g / m; vb = b / m;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 16; i++) if (use[i]) {
    const t = (px[i * 3] - mr) * vr + (px[i * 3 + 1] - mg) * vg + (px[i * 3 + 2] - mb) * vb;
    if (t < lo) lo = t; if (t > hi) hi = t;
  }
  if (!n) lo = hi = 0;
  const vv = vr * vr + vg * vg + vb * vb || 1, clamp = v => Math.max(0, Math.min(255, v));
  const end = t => { const s = t / vv; return [clamp(mr + vr * s), clamp(mg + vg * s), clamp(mb + vb * s)]; };
  const pack = c => (q5(c[0]) << 11) | (q6(c[1]) << 5) | q5(c[2]);
  let a = pack(end(hi)), b = pack(end(lo));
  if (holes ? a > b : a < b) { const s = a; a = b; b = s; }
  if (!holes && a === b) { out[p] = a & 255; out[p + 1] = a >> 8; out[p + 2] = b & 255; out[p + 3] = b >> 8; return; }
  const deq = c => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  const c0 = deq(a), c1 = deq(b), steps = holes ? 2 : 3;
  const dr = c1[0] - c0[0], dg = c1[1] - c0[1], db = c1[2] - c0[2], dd = dr * dr + dg * dg + db * db || 1;
  const order = holes ? [0, 2, 1] : [0, 2, 3, 1];
  let bits = 0;
  for (let i = 0; i < 16; i++) {
    let idx = 3;
    if (use[i]) {
      const t = ((px[i * 3] - c0[0]) * dr + (px[i * 3 + 1] - c0[1]) * dg + (px[i * 3 + 2] - c0[2]) * db) / dd;
      idx = order[Math.max(0, Math.min(steps, Math.round(t * steps)))];
    }
    bits |= idx << (2 * i);
  }
  out[p] = a & 255; out[p + 1] = a >> 8; out[p + 2] = b & 255; out[p + 3] = b >> 8;
  out[p + 4] = bits & 255; out[p + 5] = (bits >>> 8) & 255; out[p + 6] = (bits >>> 16) & 255; out[p + 7] = (bits >>> 24) & 255;
}
