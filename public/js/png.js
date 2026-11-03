const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export const isPNG = buf => {
  if (buf.byteLength < 8) return false;
  const b = new Uint8Array(buf, 0, 8);
  return SIGNATURE.every((v, i) => b[i] === v);
};

function readChunks(buf) {
  const d = new DataView(buf),
    b = new Uint8Array(buf);
  const out = { ihdr: null, plte: null, trns: null, idat: [] };
  for (let p = 8; p + 12 <= b.length; ) {
    const n = d.getUint32(p),
      type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]),
      at = p + 8;
    if (at + n > b.length) break;
    if (type === 'IHDR')
      out.ihdr = {
        width: d.getUint32(at),
        height: d.getUint32(at + 4),
        depth: b[at + 8],
        color: b[at + 9],
        interlace: b[at + 12]
      };
    else if (type === 'PLTE') out.plte = b.subarray(at, at + n);
    else if (type === 'tRNS') out.trns = b.subarray(at, at + n);
    else if (type === 'IDAT') out.idat.push(b.subarray(at, at + n));
    else if (type === 'IEND') break;
    p = at + n + 4;
  }
  return out;
}

function unfilter(kind, row, prev, bpp) {
  const n = row.length;
  if (kind === 1) for (let i = bpp; i < n; i++) row[i] = (row[i] + row[i - bpp]) & 255;
  else if (kind === 2) for (let i = 0; i < n; i++) row[i] = (row[i] + prev[i]) & 255;
  else if (kind === 3) {
    for (let i = 0; i < bpp; i++) row[i] = (row[i] + (prev[i] >> 1)) & 255;
    for (let i = bpp; i < n; i++) row[i] = (row[i] + ((row[i - bpp] + prev[i]) >> 1)) & 255;
  } else if (kind === 4) {
    for (let i = 0; i < bpp; i++) row[i] = (row[i] + prev[i]) & 255;
    for (let i = bpp; i < n; i++) {
      const a = row[i - bpp],
        b = prev[i],
        c = prev[i - bpp],
        p = a + b - c,
        pa = p > a ? p - a : a - p,
        pb = p > b ? p - b : b - p,
        pc = p > c ? p - c : c - p;
      row[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  } else if (kind !== 0) throw new Error('bad PNG filter ' + kind);
}

function rowWriter(h, plte, trns, out) {
  const { width: w, depth, color } = h;
  const ch = CHANNELS[color];
  const wide = depth === 16;
  const key =
    trns && (color === 0 || color === 2)
      ? Array.from({ length: color === 0 ? 1 : 3 }, (_, i) => (trns[i * 2] << 8) | trns[i * 2 + 1])
      : null;
  const sample = (row, i) => (wide ? (row[i * 2] << 8) | row[i * 2 + 1] : row[i]);
  const to8 = v => (wide ? ((v * 255 + 32767) / 65535) | 0 : v);
  const small = depth < 8,
    max = (1 << depth) - 1,
    perByte = 8 / depth;
  const packed = (row, x) => (row[(x / perByte) | 0] >> ((perByte - 1 - (x % perByte)) * depth)) & max;
  if (depth === 8 && color === 6) return (row, y) => out.set(row, y * w * 4);
  if (depth === 8 && color === 2 && !key)
    return (row, y) => {
      for (let x = 0, i = 0, o = y * w * 4; x < w; x++, i += 3, o += 4) {
        out[o] = row[i];
        out[o + 1] = row[i + 1];
        out[o + 2] = row[i + 2];
        out[o + 3] = 255;
      }
    };
  if (depth === 16 && color === 6)
    return (row, y) => {
      for (let i = 0, o = y * w * 4, n = w * 8; i < n; i += 2, o++) out[o] = ((((row[i] << 8) | row[i + 1]) * 255 + 32767) / 65535) | 0;
    };
  return (row, y) => {
    let o = y * w * 4;
    for (let x = 0; x < w; x++, o += 4) {
      if (color === 3) {
        const k = small ? packed(row, x) : row[x];
        out[o] = plte ? plte[k * 3] : 0;
        out[o + 1] = plte ? plte[k * 3 + 1] : 0;
        out[o + 2] = plte ? plte[k * 3 + 2] : 0;
        out[o + 3] = trns && k < trns.length ? trns[k] : 255;
      } else if (color === 0 || color === 4) {
        const raw = small ? packed(row, x) : sample(row, x * ch);
        const g = small ? ((raw * 255) / max) | 0 : to8(raw);
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = color === 4 ? to8(sample(row, x * ch + 1)) : key && raw === key[0] ? 0 : 255;
      } else {
        const r = sample(row, x * ch),
          g = sample(row, x * ch + 1),
          b = sample(row, x * ch + 2);
        out[o] = to8(r);
        out[o + 1] = to8(g);
        out[o + 2] = to8(b);
        out[o + 3] = color === 6 ? to8(sample(row, x * ch + 3)) : key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255;
      }
    }
  };
}

export async function decodePNG(buf) {
  if (typeof DecompressionStream === 'undefined' || !isPNG(buf)) return null;
  const { ihdr: h, plte, trns, idat } = readChunks(buf);
  if (!h || !idat.length || h.interlace !== 0 || !CHANNELS[h.color] || !h.width || !h.height) return null;
  if (![1, 2, 4, 8, 16].includes(h.depth) || (h.depth < 8 && h.color !== 0 && h.color !== 3) || (h.depth === 16 && h.color === 3))
    return null;
  const bits = CHANNELS[h.color] * h.depth,
    stride = Math.ceil((h.width * bits) / 8),
    bpp = Math.max(1, bits >> 3);
  const data = new Uint8Array(new ArrayBuffer(h.width * h.height * 4));
  const write = rowWriter(h, plte, trns, data);
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const feeding = (async () => {
    for (const c of idat) await writer.write(c);
    await writer.close();
  })();
  feeding.catch(() => {});
  const reader = ds.readable.getReader();
  let row = new Uint8Array(stride),
    prev = new Uint8Array(stride),
    fill = -1,
    kind = 0,
    y = 0;
  try {
    while (y < h.height) {
      const { value, done } = await reader.read();
      if (done) break;
      for (let p = 0; p < value.length && y < h.height; ) {
        if (fill < 0) {
          kind = value[p++];
          fill = 0;
          continue;
        }
        const take = Math.min(stride - fill, value.length - p);
        row.set(value.subarray(p, p + take), fill);
        fill += take;
        p += take;
        if (fill === stride) {
          unfilter(kind, row, prev, bpp);
          write(row, y++);
          const t = prev;
          prev = row;
          row = t;
          fill = -1;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (y < h.height) throw new Error('PNG data ends early');
  return { data, width: h.width, height: h.height, alpha: h.color === 4 || h.color === 6 || !!trns };
}
