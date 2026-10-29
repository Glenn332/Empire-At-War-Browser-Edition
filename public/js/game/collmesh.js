const cache = new WeakMap();

function restBones(model) {
  const out = [];
  const world = i => {
    if (out[i]) return out[i];
    const b = model.bones[i], m = b.matrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    if (b.parent < 0 || b.parent === i) return (out[i] = m);
    const p = world(b.parent), r = new Array(12);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) r[row * 4 + col] = p[row * 4] * m[col] + p[row * 4 + 1] * m[4 + col] + p[row * 4 + 2] * m[8 + col];
      r[row * 4 + 3] = p[row * 4] * m[3] + p[row * 4 + 1] * m[7] + p[row * 4 + 2] * m[11] + p[row * 4 + 3];
    }
    return (out[i] = r);
  };
  for (let i = 0; i < model.bones.length; i++) world(i);
  return out;
}

export function collisionOf(model) {
  if (!model) return null;
  if (cache.has(model)) return cache.get(model);
  const bones = restBones(model), tri = [];
  for (const mesh of model.meshes) {
    if (!mesh.collision || /shield/i.test(mesh.name)) continue;
    const bm = bones[mesh.bone] || null;
    for (const sub of mesh.subs) {
      const g = sub.geometry;
      if (!g || !g.indices || !g.vertices || !g.nVerts) continue;
      const skinned = /RSkin|B4I4/.test(g.format || ''), m = skinned ? null : bm;
      const src = g.vertices.pos, pos = new Float32Array(g.nVerts * 3);
      for (let i = 0; i < g.nVerts; i++) {
        const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
        if (m) { pos[i * 3] = m[0] * x + m[1] * y + m[2] * z + m[3]; pos[i * 3 + 1] = m[4] * x + m[5] * y + m[6] * z + m[7]; pos[i * 3 + 2] = m[8] * x + m[9] * y + m[10] * z + m[11]; }
        else { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; }
      }
      const I = g.indices;
      for (let i = 0; i + 2 < I.length; i += 3) {
        const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
        if (a >= pos.length || b >= pos.length || c >= pos.length) continue;
        const t = [pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]];
        if (t.every(Number.isFinite)) tri.push(t);
      }
    }
  }
  const out = tri.length ? build(tri) : null;
  cache.set(model, out);
  return out;
}

function build(list) {
  const n = list.length, T = new Float32Array(n * 9), order = new Int32Array(n), cen = new Float32Array(n * 3);
  list.forEach((t, i) => { T.set(t, i * 9); order[i] = i; for (let k = 0; k < 3; k++) cen[i * 3 + k] = (t[k] + t[3 + k] + t[6 + k]) / 3; });
  const box = [], left = [], right = [], first = [], count = [];
  const make = (lo, hi) => {
    const id = box.length / 6;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = lo; i < hi; i++) { const o = order[i] * 9; for (let v = 0; v < 9; v += 3) { const x = T[o + v], y = T[o + v + 1], z = T[o + v + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; } }
    box.push(x0, y0, z0, x1, y1, z1); left.push(-1); right.push(-1); first.push(lo); count.push(hi - lo);
    if (hi - lo > 4) {
      const ax = x1 - x0 >= y1 - y0 && x1 - x0 >= z1 - z0 ? 0 : y1 - y0 >= z1 - z0 ? 1 : 2;
      const part = order.subarray(lo, hi), sorted = Array.from(part).sort((a, b) => cen[a * 3 + ax] - cen[b * 3 + ax]);
      part.set(sorted);
      const mid = (lo + hi) >> 1;
      count[id] = 0;
      left[id] = make(lo, mid); right[id] = make(mid, hi);
    }
    return id;
  };
  make(0, n);
  return { T, order, box: Float32Array.from(box), left: Int32Array.from(left), right: Int32Array.from(right), first: Int32Array.from(first), count: Int32Array.from(count) };
}

export function meshHit(C, ox, oy, oz, dx, dy, dz) {
  const { T, order, box, left, right, first, count } = C, stack = _stack;
  let best = 2, sp = 0;
  stack[sp++] = 0;
  const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
  while (sp) {
    const id = stack[--sp], b = id * 6;
    let t0 = 0, t1 = best, a = (box[b] - ox) * ix, c = (box[b + 3] - ox) * ix;
    if (a > c) { const s = a; a = c; c = s; } if (a > t0) t0 = a; if (c < t1) t1 = c;
    a = (box[b + 1] - oy) * iy; c = (box[b + 4] - oy) * iy;
    if (a > c) { const s = a; a = c; c = s; } if (a > t0) t0 = a; if (c < t1) t1 = c;
    a = (box[b + 2] - oz) * iz; c = (box[b + 5] - oz) * iz;
    if (a > c) { const s = a; a = c; c = s; } if (a > t0) t0 = a; if (c < t1) t1 = c;
    if (!(t0 <= t1) || t0 > 1) continue;
    if (left[id] >= 0) { stack[sp++] = left[id]; stack[sp++] = right[id]; continue; }
    for (let i = first[id], e = first[id] + count[id]; i < e; i++) {
      const o = order[i] * 9;
      const t = triangle(T, o, ox, oy, oz, dx, dy, dz);
      if (t >= 0 && t < best) best = t;
    }
  }
  return best <= 1 ? best : -1;
}
const _stack = new Int32Array(256);
function triangle(T, o, ox, oy, oz, dx, dy, dz) {
  const ax = T[o], ay = T[o + 1], az = T[o + 2];
  const e1x = T[o + 3] - ax, e1y = T[o + 4] - ay, e1z = T[o + 5] - az, e2x = T[o + 6] - ax, e2y = T[o + 7] - ay, e2z = T[o + 8] - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det, sx = ox - ax, sy = oy - ay, sz = oz - az, u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 && t <= 1 ? t : -1;
}
