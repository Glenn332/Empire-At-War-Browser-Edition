const ADAPT = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
const COEF = [
  [256, 0],
  [512, -256],
  [0, 0],
  [192, 64],
  [240, 0],
  [460, -208],
  [392, -232]
];

function chunks(v) {
  const out = new Map();
  if (v.byteLength < 12 || v.getUint32(0, false) !== 0x52494646 || v.getUint32(8, false) !== 0x57415645) return out;
  let p = 12;
  while (p + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3)),
      size = v.getUint32(p + 4, true);
    if (!out.has(id)) out.set(id, { at: p + 8, size: Math.min(size, v.byteLength - p - 8) });
    p += 8 + size + (size & 1);
  }
  return out;
}

const clamp16 = x => (x < -32768 ? -32768 : x > 32767 ? 32767 : x);

function decodeMsAdpcm(v, fmt, data, frames) {
  const ch = v.getUint16(fmt.at + 2, true),
    rate = v.getUint32(fmt.at + 4, true),
    align = v.getUint16(fmt.at + 12, true),
    extra = fmt.size >= 20 ? v.getUint16(fmt.at + 16, true) : 0,
    perBlock = extra >= 2 ? v.getUint16(fmt.at + 18, true) : ((align - 7 * ch) * 8) / (4 * ch) + 2,
    count = extra >= 4 ? v.getUint16(fmt.at + 20, true) : 7,
    coef = [];
  for (let i = 0; i < count; i++)
    coef.push(extra >= 4 + 4 * (i + 1) ? [v.getInt16(fmt.at + 22 + i * 4, true), v.getInt16(fmt.at + 24 + i * 4, true)] : COEF[i] || [0, 0]);
  if (!(ch >= 1 && ch <= 2) || !(align > 7 * ch) || !(perBlock >= 2)) return null;
  const blocks = Math.floor(data.size / align),
    total = Math.min(frames ?? blocks * perBlock, blocks * perBlock),
    pcm = new Int16Array(total * ch);
  let w = 0;
  for (let b = 0; b < blocks && w < pcm.length; b++) {
    let p = data.at + b * align;
    const c1 = [],
      c2 = [],
      delta = [],
      s1 = [],
      s2 = [];
    for (let c = 0; c < ch; c++) {
      const k = coef[Math.min(v.getUint8(p++), coef.length - 1)];
      c1[c] = k[0];
      c2[c] = k[1];
    }
    for (let c = 0; c < ch; c++, p += 2) delta[c] = v.getInt16(p, true);
    for (let c = 0; c < ch; c++, p += 2) s1[c] = v.getInt16(p, true);
    for (let c = 0; c < ch; c++, p += 2) s2[c] = v.getInt16(p, true);
    for (let c = 0; c < ch && w < pcm.length; c++) pcm[w++] = s2[c];
    for (let c = 0; c < ch && w < pcm.length; c++) pcm[w++] = s1[c];
    const end = data.at + (b + 1) * align;
    let c = 0;
    const step = nib => {
      const n = nib & 8 ? nib - 16 : nib;
      const pred = clamp16(((s1[c] * c1[c] + s2[c] * c2[c]) >> 8) + n * delta[c]);
      s2[c] = s1[c];
      s1[c] = pred;
      delta[c] = Math.max(16, (ADAPT[nib] * delta[c]) >> 8);
      if (w < pcm.length) pcm[w++] = pred;
      c = (c + 1) % ch;
    };
    for (let n = 2; n < perBlock && p < end; ) {
      const byte = v.getUint8(p++);
      step(byte >> 4);
      step(byte & 15);
      if (c === 0) n += ch === 1 ? 2 : 1;
    }
  }
  return { ch, rate, pcm: w < pcm.length ? pcm.subarray(0, w - (w % ch)) : pcm };
}

function wave(ch, rate, pcm) {
  const bytes = pcm.length * 2,
    out = new ArrayBuffer(44 + bytes),
    v = new DataView(out);
  const tag = (p, s) => {
    for (let i = 0; i < 4; i++) v.setUint8(p + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, bytes, true);
  new Int16Array(out, 44).set(pcm);
  return out;
}

export function playableWave(buf) {
  if (!buf || buf.byteLength < 44) return buf;
  const v = new DataView(buf),
    c = chunks(v),
    fmt = c.get('fmt '),
    data = c.get('data');
  if (!fmt || !data || v.getUint16(fmt.at, true) !== 2) return buf;
  const fact = c.get('fact'),
    frames = fact && fact.size >= 4 ? v.getUint32(fact.at, true) : undefined,
    out = decodeMsAdpcm(v, fmt, data, frames);
  return out ? wave(out.ch, out.rate, out.pcm) : buf;
}
