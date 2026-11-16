import * as THREE from 'three';
import { loadTexture, parseTexture } from '../dds.js';
import { decodeDXT } from '../ddsdecode.js';
import { fetchBinary } from '../vfs.js';

const LOOKS = {
  imperial: {
    wall: { tex: 'W_INTERIOR_WALL00', tile: [1.4, 2.1] },
    back: { tex: 'W_INTERIOR_WALL01', tile: [1.4, 2.1] },
    front: { tex: 'W_INTERIOR_WALL00', tile: [1.4, 2.1] },
    ceil: { tex: 'W_INTERIOR_WALL00', tile: [1.2, 1.2] },
    glow: { tex: 'W_INTERIOR_WALL02', tile: [1.2, 1.2], emit: 0.8 },
    floor: { tex: 'W_INTERIOR_FLOOR00', tile: [1.05, 1.05] },
    walk: { tex: 'W_URBAN_METAL01', tile: [0.8, 0.8], tint: 0.85 },
    trim: 'W_URBAN_METAL07',
    pipe: 'W_URBAN_METAL00',
    ramp: 'EV_LAMBDASHUTTLE_RAMP',
    rampTile: 0,
    lamp: [1, 0.97, 0.9],
    sky: [0.8, 0.88, 1],
    ambient: 0.09,
    exposure: 1
  },
  worn: {
    wall: { tex: 'W_WALL_METALS_C', tile: [1.6, 2.1] },
    back: { tex: 'W_WALL_METALS_A', tile: [1.6, 2.1] },
    front: { tex: 'W_WALL_METALS_C', tile: [1.6, 2.1] },
    ceil: { tex: 'W_URBAN_METAL07', tile: [1.3, 1.3] },
    glow: null,
    floor: { tex: 'W_URBAN_METAL01', tile: [0.9, 0.9] },
    walk: { tex: 'W_URBAN_METAL00', tile: [1.2, 1.2], tint: 0.8 },
    trim: 'W_URBAN_METAL07',
    pipe: 'W_URBAN_METAL00',
    ramp: 'W_URBAN_METAL01',
    rampTile: 0.9,
    lamp: [1, 0.88, 0.68],
    sky: [0.85, 0.9, 1],
    ambient: 0.08,
    exposure: 1.1
  }
};

const PPU = 112,
  GRID = 6,
  toLin = new Float32Array(256).map((_, i) => Math.pow(i / 255, 2.2)),
  baked = new Map(),
  tiles = new Map();

export function lookFor(faction) {
  return /empire|imperial|first.?order|sith|galactic.?republic/i.test(faction || '') ? 'imperial' : 'worn';
}

export function lookOf(key) {
  return LOOKS[key] || LOOKS.worn;
}

async function opaque(name) {
  const buf = await fetchBinary('Data/Art/Textures/' + name + '.dds', { keep: false });
  if (!buf) return null;
  const t = parseTexture(buf),
    m = t.mipmaps[0],
    kind = !t.compressed ? 0 : t.format === THREE.RGBA_S3TC_DXT1_Format ? 1 : t.format === THREE.RGBA_S3TC_DXT3_Format ? 3 : 5,
    rgba = new Uint8ClampedArray(kind ? decodeDXT(m.data, t.width, t.height, kind) : m.data);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  const cv = document.createElement('canvas');
  cv.width = t.width;
  cv.height = t.height;
  cv.getContext('2d').putImageData(new ImageData(rgba, t.width, t.height), 0, 0);
  return cv;
}

function tile(name) {
  if (!tiles.has(name)) tiles.set(name, opaque(name).catch(() => null));
  return tiles.get(name);
}

export function gameTexture(name) {
  return loadTexture(name);
}

export function fitUV(geo, tile) {
  const p = geo.attributes.position,
    n = geo.attributes.normal,
    uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)),
      ay = Math.abs(n.getY(i)),
      az = Math.abs(n.getZ(i)),
      x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    if (az >= ax && az >= ay) uv.setXY(i, x / tile, y / tile);
    else if (ax >= ay) uv.setXY(i, y / tile, z / tile);
    else uv.setXY(i, x / tile, z / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

export function shadedMat(tex, tint = 1) {
  return new THREE.MeshBasicMaterial({ map: gameTexture(tex), fog: false, side: THREE.DoubleSide, color: new THREE.Color(tint, tint, tint) });
}

export function sharedBay(t) {
  for (const b of baked.values()) for (const k in b.textures) if (b.textures[k] === t) return true;
  return false;
}

export function shadedBox(w, d, h, tex, tile, tint = 1) {
  const geo = fitUV(new THREE.BoxGeometry(w, d, h), tile),
    map = gameTexture(tex),
    face = k => new THREE.MeshBasicMaterial({ map, fog: false, color: new THREE.Color(k * tint, k * tint, k * tint) });
  return new THREE.Mesh(geo, [face(0.62), face(0.55), face(0.7), face(0.66), face(0.92), face(0.3)]);
}

export function shadedTube(len, r, tex, tint = 1, seg = 12) {
  const geo = new THREE.CylinderGeometry(r, r, len, seg, 1, false),
    uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) * len) / (r * 40));
  uv.needsUpdate = true;
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: gameTexture(tex), fog: false, color: new THREE.Color(0.85 * tint, 0.87 * tint, 0.9 * tint) }));
}

function paint(w, h, regions, imgs) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * PPU);
  cv.height = Math.round(h * PPU);
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#5a5f66';
  x.fillRect(0, 0, cv.width, cv.height);
  for (const r of regions) {
    const img = imgs.get(r.spec.tex);
    if (!img) continue;
    const tw = Math.max(4, Math.round(r.spec.tile[0] * PPU)),
      th = Math.max(4, Math.round(r.spec.tile[1] * PPU)),
      t = document.createElement('canvas');
    t.width = tw;
    t.height = th;
    const tx = t.getContext('2d');
    tx.drawImage(img, 0, 0, tw, th);
    if (r.spec.tint && r.spec.tint !== 1) {
      tx.globalCompositeOperation = 'multiply';
      const k = Math.round(255 * r.spec.tint);
      tx.fillStyle = `rgb(${k},${k},${k})`;
      tx.fillRect(0, 0, tw, th);
    }
    const pat = x.createPattern(t, 'repeat'),
      ox = (r.ox ?? 0) * PPU,
      oy = (r.oy ?? 0) * PPU;
    pat.setTransform(new DOMMatrix().translateSelf(ox, oy));
    x.save();
    x.fillStyle = pat;
    x.fillRect(r.u0 * PPU, cv.height - r.v1 * PPU, (r.u1 - r.u0) * PPU, (r.v1 - r.v0) * PPU);
    x.restore();
  }
  return { cv, x };
}

function light(S, lights, P, N, tu, tv, look) {
  let r = 0,
    g = 0,
    b = 0,
    du = 0,
    dv = 0;
  for (const L of lights) {
    const dx = L.p[0] - P[0],
      dy = L.p[1] - P[1],
      dz = L.p[2] - P[2],
      d2 = dx * dx + dy * dy + dz * dz,
      d = Math.sqrt(d2) || 1e-4,
      ndl = (N[0] * dx + N[1] * dy + N[2] * dz) / d;
    if (ndl <= 0) continue;
    let k = (L.i * ndl) / (d2 + (L.soft ?? 0.4));
    if (L.dir) {
      const f = -(L.dir[0] * dx + L.dir[1] * dy + L.dir[2] * dz) / d;
      if (f <= 0) continue;
      k *= Math.pow(f, L.cone ?? 1);
    }
    r += k * L.c[0];
    g += k * L.c[1];
    b += k * L.c[2];
    const lum = k * (L.c[0] + L.c[1] + L.c[2]);
    du += (lum * (tu[0] * dx + tu[1] * dy + tu[2] * dz)) / d;
    dv += (lum * (tv[0] * dx + tv[1] * dy + tv[2] * dz)) / d;
  }
  const ao = S.ao(P, N),
    a = look.ambient * (0.8 + 0.2 * N[2]);
  const tot = Math.max(1e-4, Math.abs(du) + Math.abs(dv) + (r + g + b));
  return [(r + a) * ao, (g + a) * ao, (b + a * 1.04) * ao, du / tot, dv / tot];
}

async function bakeSurface(S, look, imgs) {
  let t0 = performance.now();
  const yieldNow = async () => {
    if (performance.now() - t0 < 8) return;
    await new Promise(r => setTimeout(r, 0));
    t0 = performance.now();
  };
  const { cv, x } = paint(S.w, S.h, S.regions, imgs),
    W = cv.width,
    H = cv.height,
    id = x.getImageData(0, 0, W, H),
    px = id.data,
    gw = Math.ceil(W / GRID) + 1,
    gh = Math.ceil(H / GRID) + 1,
    grid = new Float32Array(gw * gh * 5);
  for (let j = 0; j < gh; j++) {
    await yieldNow();
    for (let i = 0; i < gw; i++) {
      const u = Math.min(S.w, (i * GRID) / PPU),
        v = Math.min(S.h, (j * GRID) / PPU),
        e = light(S, S.lights, S.pos(u, v), S.n, S.tu, S.tv, look);
      grid.set(e, (j * gw + i) * 5);
    }
  }
  const lum = new Float32Array(W * H);
  for (let i = 0, o = 0; i < W * H; i++, o += 4) lum[i] = px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114;
  const ex = look.exposure,
    out = new Uint8ClampedArray(px.length),
    emitAt = S.emit;
  for (let yy = 0; yy < H; yy++) {
    if ((yy & 15) === 0) await yieldNow();
    const gy = (H - 1 - yy) / GRID,
      j0 = Math.min(gh - 2, Math.floor(gy)),
      fy = gy - j0;
    for (let xx = 0; xx < W; xx++) {
      const gx = xx / GRID,
        i0 = Math.min(gw - 2, Math.floor(gx)),
        fx = gx - i0,
        a = (j0 * gw + i0) * 5,
        b = a + 5,
        c = a + gw * 5,
        d = c + 5,
        w00 = (1 - fx) * (1 - fy),
        w10 = fx * (1 - fy),
        w01 = (1 - fx) * fy,
        w11 = fx * fy,
        q = yy * W + xx,
        o = q * 4;
      const er = grid[a] * w00 + grid[b] * w10 + grid[c] * w01 + grid[d] * w11,
        eg = grid[a + 1] * w00 + grid[b + 1] * w10 + grid[c + 1] * w01 + grid[d + 1] * w11,
        eb = grid[a + 2] * w00 + grid[b + 2] * w10 + grid[c + 2] * w01 + grid[d + 2] * w11,
        lu = grid[a + 3] * w00 + grid[b + 3] * w10 + grid[c + 3] * w01 + grid[d + 3] * w11,
        lv = grid[a + 4] * w00 + grid[b + 4] * w10 + grid[c + 4] * w01 + grid[d + 4] * w11;
      const hx = (lum[yy * W + Math.min(W - 1, xx + 1)] - lum[yy * W + Math.max(0, xx - 1)]) / 255,
        hy = (lum[Math.max(0, yy - 1) * W + xx] - lum[Math.min(H - 1, yy + 1) * W + xx]) / 255,
        relief = Math.max(0.55, Math.min(1.45, 1 + 2.4 * (hx * lu + hy * lv)));
      let r = toLin[px[o]] * er * relief,
        g = toLin[px[o + 1]] * eg * relief,
        bl = toLin[px[o + 2]] * eb * relief;
      r = 1 - Math.exp(-r * ex);
      g = 1 - Math.exp(-g * ex);
      bl = 1 - Math.exp(-bl * ex);
      if (emitAt && S.glowAt(xx / PPU, (H - 1 - yy) / PPU)) {
        const t = Math.max(0, Math.min(1, (lum[q] / 255 - emitAt) / 0.12));
        if (t > 0) {
          r += (Math.min(1, toLin[px[o]] * 1.3) - r) * t;
          g += (Math.min(1, toLin[px[o + 1]] * 1.3) - g) * t;
          bl += (Math.min(1, toLin[px[o + 2]] * 1.3) - bl) * t;
        }
      }
      out[o] = Math.pow(r, 1 / 2.2) * 255;
      out[o + 1] = Math.pow(g, 1 / 2.2) * 255;
      out[o + 2] = Math.pow(bl, 1 / 2.2) * 255;
      out[o + 3] = 255;
    }
  }
  x.putImageData(new ImageData(out, W, H), 0, 0);
  return cv;
}

function room(B, look) {
  const { L, W, T, D, DH, winLo, winHi, benches, bench, seat } = B,
    band = W * 0.2,
    lights = [];
  for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) for (const y of [-band * 0.55, band * 0.55]) lights.push({ p: [x * L, y, T - 0.04], i: 0.55, c: look.lamp, soft: 0.3 });
  for (const sy of [-1, 1])
    for (const cx of B.windows) lights.push({ p: [cx, sy * (W / 2 - 0.05), (winLo + winHi) / 2], i: 0.22, c: look.sky, dir: [0, -sy, 0], cone: 1.5, soft: 0.4 });
  lights.push({ p: [L / 2 - 0.02, 0, DH * 0.55], i: 0.55, c: look.sky, dir: [-1, 0, 0], cone: 2, soft: 0.8 });
  for (const x of [-0.3, 0, 0.3]) lights.push({ p: [x * L, 0, 0.05], i: 0.32, c: [0.9, 0.9, 0.92], dir: [0, 0, 1], cone: 0.6, soft: 1.2 });
  lights.push({ p: [-L / 2 + 0.12, 0, 1.25], i: 0.12, c: [0.35, 0.6, 1], soft: 0.3 });
  lights.push({ p: [L / 2 - 0.15, D / 2 + 0.5, 1], i: 0.07, c: [1, 0.25, 0.12], soft: 0.08 });
  const underBench = (x, sy) => benches.some(b => b.sy === sy && x > b.x0 && x < b.x1),
    ao = (P, N) => {
      const [x, y, z] = P,
        ay = W / 2 - Math.abs(y),
        ax = L / 2 - Math.abs(x);
      let k = 1;
      k -= 0.32 * Math.exp(-z / 0.16) * (N[2] > 0.5 ? 0 : 1);
      k -= 0.28 * Math.exp(-(T - z) / 0.14) * (N[2] < -0.5 ? 0 : 1);
      if (N[2] > 0.5) k -= 0.35 * Math.exp(-ay / 0.2) + 0.22 * Math.exp(-ax / 0.22);
      if (N[2] < -0.5) k -= 0.3 * Math.exp(-ay / 0.22) + 0.2 * Math.exp(-ax / 0.22);
      if (Math.abs(N[1]) > 0.5) k -= 0.2 * Math.exp(-ax / 0.18);
      if (Math.abs(N[0]) > 0.5) k -= 0.22 * Math.exp(-ay / 0.18);
      const sy = Math.sign(y) || 1;
      if (N[2] > 0.5 && ay < bench + 0.12 && underBench(x, sy)) k *= 0.38 + 0.62 * Math.max(0, (bench + 0.12 - ay) < 0.12 ? 1 - (bench + 0.12 - ay) / 0.12 : 0);
      if (Math.abs(N[1]) > 0.5 && z < seat + 0.1 && underBench(x, sy)) k *= z < seat ? 0.45 + 0.3 * (z / seat) : 0.85;
      return Math.max(0.12, k);
    };
  const wallRegions = spec => [{ spec, u0: 0, u1: L, v0: 0, v1: T, ox: (L / 2) % spec.tile[0] }];
  const S = {
    wall: { w: L, h: T, n: [0, -1, 0], tu: [1, 0, 0], tv: [0, 0, 1], pos: (u, v) => [u - L / 2, W / 2, v], regions: wallRegions(look.wall) },
    back: { w: W, h: T, n: [1, 0, 0], tu: [0, 1, 0], tv: [0, 0, 1], pos: (u, v) => [-L / 2, u - W / 2, v], regions: [{ spec: look.back, u0: 0, u1: W, v0: 0, v1: T, ox: (W / 2) % look.back.tile[0] }] },
    front: { w: W, h: T, n: [-1, 0, 0], tu: [0, 1, 0], tv: [0, 0, 1], pos: (u, v) => [L / 2, u - W / 2, v], regions: [{ spec: look.front, u0: 0, u1: W, v0: 0, v1: T, ox: (W / 2 - D / 2) % look.front.tile[0] }] },
    floor: {
      w: L,
      h: W,
      n: [0, 0, 1],
      tu: [1, 0, 0],
      tv: [0, 1, 0],
      pos: (u, v) => [u - L / 2, v - W / 2, 0],
      regions: [
        { spec: look.floor, u0: 0, u1: L, v0: 0, v1: W },
        { spec: look.walk, u0: L * 0.05, u1: L, v0: W / 2 - D / 2, v1: W / 2 + D / 2, oy: W / 2 - D / 2 }
      ]
    },
    ceil: {
      w: L,
      h: W,
      n: [0, 0, -1],
      tu: [1, 0, 0],
      tv: [0, 1, 0],
      pos: (u, v) => [u - L / 2, v - W / 2, T],
      regions: [{ spec: look.ceil, u0: 0, u1: L, v0: 0, v1: W }, ...(look.glow ? [{ spec: look.glow, u0: L * 0.04, u1: L * 0.96, v0: W / 2 - band, v1: W / 2 + band, ox: L * 0.04, oy: W / 2 - band }] : [])],
      emit: look.glow ? look.glow.emit : 0.6,
      glowAt: look.glow ? (u, v) => Math.abs(v - W / 2) < band && u > L * 0.04 && u < L * 0.96 : (u, v) => u > L * 0.08 && u < L * 0.92 && Math.abs(Math.abs(v - W / 2) - band * 0.55) < 0.07
    }
  };
  for (const k in S) {
    S[k].lights = lights;
    S[k].ao = ao;
  }
  if (!look.glow)
    S.ceil.regions.push(
      ...[-1, 1].map(sy => ({ spec: { tex: '__lamp', tile: [1, 0.14] }, u0: L * 0.08, u1: L * 0.92, v0: W / 2 + sy * band * 0.55 - 0.07, v1: W / 2 + sy * band * 0.55 + 0.07, oy: W / 2 - sy * band * 0.55 - 0.07 }))
    );
  return S;
}

function lampCanvas(look) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const x = c.getContext('2d'),
    [r, g, b] = look.lamp.map(v => Math.round(255 * v)),
    grad = x.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#2c2f33');
  grad.addColorStop(0.16, '#55595e');
  grad.addColorStop(0.3, `rgb(${r},${g},${b})`);
  grad.addColorStop(0.5, '#fffdf6');
  grad.addColorStop(0.7, `rgb(${r},${g},${b})`);
  grad.addColorStop(0.84, '#55595e');
  grad.addColorStop(1, '#2c2f33');
  x.fillStyle = grad;
  x.fillRect(0, 0, 32, 64);
  return c;
}

export function bakeRoom(key, B) {
  const look = lookOf(key);
  if (!baked.has(key)) {
    const textures = {};
    for (const k of ['wall', 'back', 'front', 'floor', 'ceil']) {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const x = c.getContext('2d');
      x.fillStyle = '#2b2f35';
      x.fillRect(0, 0, 4, 4);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      textures[k] = t;
    }
    const ready = (async () => {
      const S = room(B, look),
        names = new Set();
      for (const s of Object.values(S)) for (const r of s.regions) if (!r.spec.tex.startsWith('__')) names.add(r.spec.tex);
      const imgs = new Map();
      await Promise.all([...names].map(async n => imgs.set(n, await tile(n))));
      imgs.set('__lamp', lampCanvas(look));
      for (const k of Object.keys(S)) {
        await new Promise(r => setTimeout(r, 0));
        const cv = await bakeSurface(S[k], look, imgs),
          t = textures[k];
        t.image = cv;
        t.needsUpdate = true;
      }
    })();
    baked.set(key, { textures, ready });
  }
  return baked.get(key);
}
