export class LandZonePaths {
  constructor(zones) {
    this.zones = zones || [];
    const n = this.zones.length, idx = new Map(this.zones.map((z, i) => [z, i]));
    this.idx = idx;
    const nb = this.nb = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      const z = this.zones[i];
      const links = (z.links || []).filter(l => l.flags && this.zones[l.to]).map(l => this.zones[l.to]);
      links.sort((a, b) => crcOf(a) - crcOf(b));
      for (const o of links) { const j = idx.get(o); if (i < j) { nb[j].push(i); nb[i].push(j); } }
    }
    this.flags = new Map();
    for (let i = 0; i < n; i++) for (const l of this.zones[i].links || []) this.flags.set(i * n + l.to, l.flags >>> 0);
  }

  route(from, to, opt = {}) {
    const zs = this.zones, n = zs.length, a = this.idx.get(from), g = this.idx.get(to);
    if (a === undefined || g === undefined) return null;
    if (a === g) return [from];
    const threshold = opt.threshold ?? 1e18, weight = opt.weight ?? 1, mask = opt.linkMask ?? -1;
    const linkFactors = opt.linkFactors || [], hints = opt.hints || [], threat = opt.threat || (() => 0);
    const f32 = Math.fround, G = zs[g];
    const seen = new Uint8Array(n), closed = new Uint8Array(n), best = new Float32Array(n);
    const nodeZ = [a], nodeUp = [-1], entN = [0], entG = [0], entF = [0], entD = [1], heap = [0, 0];
    let size = 1;
    seen[a] = 1;
    const push = e => {
      let i = ++size;
      for (; i > 1; i >>= 1) { const p = heap[i >> 1]; if (entF[p] <= entF[e]) break; heap[i] = p; }
      heap[i] = e;
    };
    const step = (i, j) => {
      const A = zs[i], B = zs[j];
      if (mask !== -1 && !((this.flags.get(i * n + j) ?? 0) & mask)) return -1;
      let c = f32(Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z));
      if (j === g) return c;
      let k = 1;
      for (const L of linkFactors) if ((this.flags.get(i * n + j) ?? 0) & L.flags) k *= L.by;
      c = f32(k * c);
      for (const h of hints) {
        const v = B.props && B.props[h.name];
        c = f32((v !== undefined ? (v - (h.base || 0)) * c * h.weight : 0) + c);
      }
      const t = threat(B);
      if (t !== 0) {
        if (threshold < t) return -1;
        c = f32(((t * weight) / threshold + 1) * c);
      }
      return c;
    };
    while (size) {
      const e = heap[1];
      heap[1] = heap[size]; size--;
      for (let i = 1; ;) {
        let c = i;
        if (2 * i <= size && entF[heap[2 * i]] < entF[heap[i]]) c = 2 * i;
        if (2 * i + 1 <= size && entF[heap[2 * i + 1]] < entF[heap[c]]) c = 2 * i + 1;
        if (c === i) break;
        const t = heap[i]; heap[i] = heap[c]; heap[c] = t; i = c;
      }
      const node = entN[e], z = nodeZ[node];
      if (z === g) {
        const out = [];
        for (let k = node; k >= 0; k = nodeUp[k]) out.push(zs[nodeZ[k]]);
        out.reverse();
        out.cost = entG[e];
        return out;
      }
      closed[z] = 1;
      for (const j of this.nb[z]) {
        if (seen[j] && closed[j]) continue;
        const c = step(z, j);
        if (c < 0) continue;
        const f = f32(c + entG[e]);
        if (seen[j] && !(f < best[j])) continue;
        const m = nodeZ.length;
        nodeZ.push(j); nodeUp.push(node);
        const q = entN.length;
        entN.push(m); entG.push(f); entD.push(entD[e] + 1);
        entF.push(f32(Math.hypot(zs[j].x - G.x, zs[j].y - G.y, zs[j].z - G.z) + f));
        push(q);
        seen[j] = 1; best[j] = f; closed[j] = 0;
      }
    }
    return null;
  }

  reach(from, opt = {}) {
    const a = this.idx.get(from);
    if (a === undefined) return [];
    const threshold = opt.threshold ?? 1e18, threat = opt.threat || (() => 0), zs = this.zones;
    const over = z => { const t = threat(z); return t !== 0 && threshold < t; };
    const mark = new Uint8Array(zs.length);
    if (!over(from)) return this.fill(a, mark, over);
    let most = [];
    for (const j of this.nb[a]) {
      if (mark[j]) continue;
      if (over(zs[j])) { mark[j] = 1; continue; }
      const got = this.fill(j, mark, over);
      if (got.length > most.length) most = got;
    }
    return most;
  }
  fill(a, mark, over) {
    const zs = this.zones, out = [];
    mark[a] = 1;
    let ring = [a];
    while (ring.length) {
      const next = [];
      for (const i of ring) {
        out.push(zs[i]);
        for (const j of this.nb[i]) {
          if (mark[j]) continue;
          mark[j] = 1;
          if (!over(zs[j])) next.push(j);
        }
      }
      ring = next;
    }
    return out;
  }
}

export const zonePaths = map => map.zonePaths || (map.zonePaths = new LandZonePaths(map.zones));
export const zoneThreat = mind => z => mind.at(z.target || { zone: z, x: z.x, y: z.y }, true, 'force', null, 0);

const TABLE = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
const buf = new DataView(new ArrayBuffer(12));
function crcOf(z) {
  if (z.placeCrc !== undefined) return z.placeCrc;
  buf.setFloat32(0, z.x, true); buf.setFloat32(4, z.y, true); buf.setFloat32(8, z.z, true);
  let c = 0xffffffff;
  for (let i = 0; i < 12; i++) c = TABLE[(c ^ buf.getUint8(i)) & 0xff] ^ (c >>> 8);
  return (z.placeCrc = (~c) >>> 0);
}
