export function decodeDXT(src, width, height, kind) {
  const out = new Uint8Array(width * height * 4);
  const dxt1 = kind === 1,
    dxt5 = kind === 5;
  const col = new Uint8Array(16),
    alpha = new Uint8Array(16),
    a8 = new Uint8Array(8);
  let p = 0;
  for (let by = 0; by < height; by += 4)
    for (let bx = 0; bx < width; bx += 4) {
      alpha.fill(255);
      if (!dxt1) {
        if (dxt5) {
          a8[0] = src[p];
          a8[1] = src[p + 1];
          for (let i = 2; i < 8; i++) {
            a8[i] =
              a8[0] > a8[1] ? ((8 - i) * a8[0] + (i - 1) * a8[1]) / 7 : i < 6 ? ((6 - i) * a8[0] + (i - 1) * a8[1]) / 5 : i === 6 ? 0 : 255;
          }
          const lo = src[p + 2] | (src[p + 3] << 8) | (src[p + 4] << 16),
            hi = src[p + 5] | (src[p + 6] << 8) | (src[p + 7] << 16);
          for (let i = 0; i < 8; i++) {
            alpha[i] = a8[(lo >> (3 * i)) & 7];
            alpha[i + 8] = a8[(hi >> (3 * i)) & 7];
          }
        } else {
          for (let i = 0; i < 16; i++) alpha[i] = ((src[p + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
        }
        p += 8;
      }
      const c0 = src[p] | (src[p + 1] << 8),
        c1 = src[p + 2] | (src[p + 3] << 8);
      const r0 = (((c0 >> 11) & 31) * 255) / 31,
        g0 = (((c0 >> 5) & 63) * 255) / 63,
        b0 = ((c0 & 31) * 255) / 31;
      const r1 = (((c1 >> 11) & 31) * 255) / 31,
        g1 = (((c1 >> 5) & 63) * 255) / 63,
        b1 = ((c1 & 31) * 255) / 31;
      col[0] = r0;
      col[1] = g0;
      col[2] = b0;
      col[4] = r1;
      col[5] = g1;
      col[6] = b1;
      if (c0 > c1 || !dxt1) {
        col[8] = (2 * r0 + r1) / 3;
        col[9] = (2 * g0 + g1) / 3;
        col[10] = (2 * b0 + b1) / 3;
        col[12] = (r0 + 2 * r1) / 3;
        col[13] = (g0 + 2 * g1) / 3;
        col[14] = (b0 + 2 * b1) / 3;
      } else {
        col[8] = (r0 + r1) / 2;
        col[9] = (g0 + g1) / 2;
        col[10] = (b0 + b1) / 2;
        col[12] = 0;
        col[13] = 0;
        col[14] = 0;
      }
      const transparent = dxt1 && c0 <= c1;
      const idx = src[p + 4] | (src[p + 5] << 8) | (src[p + 6] << 16) | (src[p + 7] << 24);
      p += 8;
      for (let i = 0; i < 16; i++) {
        const x = bx + (i & 3),
          y = by + (i >> 2);
        if (x >= width || y >= height) continue;
        const ci = (idx >>> (2 * i)) & 3,
          o = (y * width + x) * 4;
        out[o] = col[ci * 4];
        out[o + 1] = col[ci * 4 + 1];
        out[o + 2] = col[ci * 4 + 2];
        out[o + 3] = transparent && ci === 3 ? 0 : alpha[i];
      }
    }
  return out;
}
