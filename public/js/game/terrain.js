import * as THREE from 'three';
import { lighting } from '../model.js';
import { loadDDS, loadTexture } from '../dds.js';

export const CELL = 20;
const TILE = 512;
const SLOTS = 64;

const VERT = `
  in vec4 layers; in vec2 corner; in float shade;
  out vec2 vCorner; out vec3 vNormal; out vec3 vWorld; out float vShade; flat out vec4 vLayers;
  void main() {
    vCorner = corner; vLayers = layers; vShade = shade;
    vNormal = normal; vWorld = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = `
  precision highp sampler2DArray;
  uniform sampler2DArray map, bump;
  uniform vec4 texU[${SLOTS}], texV[${SLOTS}];
  uniform vec3 matDiffuse[${SLOTS}], matSpecular[${SLOTS}];
  uniform sampler2D fog, clouds; uniform float side; uniform vec3 cloudAt;
  uniform vec3 sunDir, sunColor, fillDir, fillColor, ambient, fogTint; uniform vec2 fogRange;
  uniform highp sampler2DShadow shadowMap; uniform mat4 shadowMatrix; uniform float shadowOn, shadowTexel;
  float sunlit(vec3 wp) {
    if (shadowOn < 0.5) return 1.0;
    vec3 p = (shadowMatrix * vec4(wp + vec3(0.0, 0.0, 1.5), 1.0)).xyz;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
    float d = p.z - 0.0015, o = shadowTexel * 1.3, s = texture(shadowMap, vec3(p.xy, d));
    s += texture(shadowMap, vec3(p.xy + vec2(-o, -o), d)) + texture(shadowMap, vec3(p.xy + vec2(o, -o), d)) + texture(shadowMap, vec3(p.xy + vec2(-o, o), d)) + texture(shadowMap, vec3(p.xy + vec2(o, o), d));
    vec2 e = min(p.xy, 1.0 - p.xy);
    return mix(1.0, mix(0.5, 1.0, s / 5.0), smoothstep(0.0, 0.05, min(e.x, e.y)));
  }
  in vec2 vCorner; in vec3 vNormal; in vec3 vWorld; in float vShade; flat in vec4 vLayers;
  out vec4 outColor;
  vec3 n, toEye, dPx, dPy, soft;
  vec3 layer(float slot) {
    int i = int(slot + 0.5);
    vec3 U = texU[i].xyz, V = texV[i].xyz;
    vec3 at = vec3(dot(U, vWorld), dot(V, vWorld), slot);
    vec2 gx = vec2(dot(U, dPx), dot(V, dPx)), gy = vec2(dot(U, dPy), dot(V, dPy));
    vec4 t = textureGrad(map, at, gx, gy);
    vec3 b = textureGrad(bump, at, gx, gy).xyz * 2.0 - 1.0;
    vec3 T = normalize(vec3(U.xy, -dot(U.xy, n.xy) / n.z)), B = normalize(vec3(V.xy, -dot(V.xy, n.xy) / n.z));
    vec3 L = normalize(vec3(dot(sunDir, T), dot(sunDir, B), dot(sunDir, n)));
    vec3 h = normalize(toEye + sunDir), H = normalize(vec3(dot(h, T), dot(h, B), dot(h, n)));
    float shine = clamp(dot(b, H), 0.0, 1.0); shine *= shine; shine *= shine; shine *= shine; shine *= shine;
    return t.rgb * (sunColor * clamp(dot(b, L), 0.0, 1.0) + soft) * matDiffuse[i] + t.a * shine * 0.5 * sunColor * matSpecular[i];
  }
  void main() {
    n = normalize(vNormal); toEye = normalize(cameraPosition - vWorld);
    dPx = dFdx(vWorld); dPy = dFdy(vWorld);
    soft = ambient + fillColor * max(dot(n, fillDir), 0.0);
    vec3 c;
    if (vLayers.x == vLayers.y && vLayers.x == vLayers.z && vLayers.x == vLayers.w) c = layer(vLayers.x);
    else {
      vec4 w = vec4((1.0 - vCorner.x) * (1.0 - vCorner.y), vCorner.x * (1.0 - vCorner.y), (1.0 - vCorner.x) * vCorner.y, vCorner.x * vCorner.y);
      if (vLayers.y == vLayers.x) { w.x += w.y; w.y = 0.0; }
      if (vLayers.z == vLayers.x) { w.x += w.z; w.z = 0.0; } else if (vLayers.z == vLayers.y) { w.y += w.z; w.z = 0.0; }
      if (vLayers.w == vLayers.x) { w.x += w.w; w.w = 0.0; } else if (vLayers.w == vLayers.y) { w.y += w.w; w.w = 0.0; } else if (vLayers.w == vLayers.z) { w.z += w.w; w.w = 0.0; }
      c = vec3(0.0);
      if (w.x > 0.004) c += layer(vLayers.x) * w.x;
      if (w.y > 0.004) c += layer(vLayers.y) * w.y;
      if (w.z > 0.004) c += layer(vLayers.z) * w.z;
      if (w.w > 0.004) c += layer(vLayers.w) * w.w;
    }
    c *= texture(clouds, (vWorld.xy + cloudAt.xy) / cloudAt.z).rgb * sunlit(vWorld);
    float seen = texture(fog, vWorld.xy / side).r;
    float clear = fogRange.y > 0.0 ? clamp((fogRange.y - distance(cameraPosition, vWorld)) / max(1.0, fogRange.y - fogRange.x), 0.0, 1.0) : 1.0;
    outColor = vec4(mix(fogTint, c * vShade * mix(0.3, 1.0, seen), clear), 1.0);
  }`;

function texturePlanes(L) {
  const k = 1 / (L.tile > 0 ? L.tile : 215), s = Math.sin(L.tilt || 0), c = Math.cos(L.tilt || 0), S = Math.sin(L.turn || 0), C = Math.cos(L.turn || 0);
  return [[k * C, -k * S, 0, 0], [k * c * S, k * c * C, -k * s, 0]];
}

const BLOCK = 16;
const blocksOf = w => Math.max(1, w >> 2) ** 2;
function flatBlocks(w, [r, g, b, a]) {
  const out = new Uint8Array(blocksOf(w) * BLOCK), c = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
  for (let o = 0; o < out.length; o += BLOCK) { out[o] = out[o + 1] = a; out[o + 8] = out[o + 10] = c & 255; out[o + 9] = out[o + 11] = c >> 8; }
  return out;
}
function dxt1To5(src) {
  const n = src.length / 8, out = new Uint8Array(n * BLOCK);
  for (let i = 0; i < n; i++) { out[i * BLOCK] = out[i * BLOCK + 1] = 255; out.set(src.subarray(i * 8, i * 8 + 8), i * BLOCK + 8); }
  return out;
}
function doubled(src, w) {
  const ob = Math.max(1, w >> 2), W = w * 2, nb = Math.max(1, W >> 2), out = new Uint8Array(nb * nb * BLOCK);
  const ai = new Uint8Array(16), ci = new Uint8Array(16);
  for (let by = 0; by < nb; by++) for (let bx = 0; bx < nb; bx++) {
    const from = (Math.min(ob - 1, by >> 1) * ob + Math.min(ob - 1, bx >> 1)) * BLOCK, to = (by * nb + bx) * BLOCK;
    let bits = 0, have = 0, p = from + 2;
    for (let i = 0; i < 16; i++) { while (have < 3) { bits |= src[p++] << have; have += 8; } ai[i] = bits & 7; bits >>= 3; have -= 3; }
    for (let i = 0; i < 16; i++) ci[i] = (src[from + 12 + (i >> 2)] >> ((i & 3) * 2)) & 3;
    out[to] = src[from]; out[to + 1] = src[from + 1];
    for (let k = 8; k < 12; k++) out[to + k] = src[from + k];
    const ox = W >= 8 ? (bx & 1) * 2 : 0, oy = W >= 8 ? (by & 1) * 2 : 0;
    bits = 0; have = 0; p = to + 2;
    for (let i = 0; i < 16; i++) {
      const j = (oy + ((i >> 2) >> 1)) * 4 + ox + ((i & 3) >> 1);
      bits |= ai[j] << have; have += 3;
      while (have >= 8) { out[p++] = bits & 255; bits >>= 8; have -= 8; }
      out[to + 12 + (i >> 2)] |= ci[j] << ((i & 3) * 2);
    }
  }
  return out;
}
function layerChain(dds, flat) {
  const levels = Math.log2(TILE) + 1;
  let chain = null, w = 0;
  const dxt1 = dds && dds.format === THREE.RGBA_S3TC_DXT1_Format, dxt5 = dds && dds.format === THREE.RGBA_S3TC_DXT5_Format;
  if (dds && dds.compressed && dds.width === dds.height && (dds.width & (dds.width - 1)) === 0 && (dxt1 || dxt5)) {
    chain = dds.mipmaps.map(m => (dxt1 ? dxt1To5(m.data) : m.data)); w = dds.width;
    while (w > TILE && chain.length > 1) { chain.shift(); w >>= 1; }
    while (w < TILE) { chain.unshift(doubled(chain[0], w)); w *= 2; }
    if (w !== TILE) chain = null;
  }
  if (!chain) return Array.from({ length: levels }, (_, k) => flatBlocks(TILE >> k, flat));
  for (let k = chain.length; k < levels; k++) chain.push(flatBlocks(TILE >> k, flat));
  return chain.slice(0, levels).map((d, k) => (d.length === blocksOf(TILE >> k) * BLOCK ? d : flatBlocks(TILE >> k, flat)));
}
function arrayTexture(chains) {
  const depth = Math.max(1, chains.length), mips = [];
  for (let k = 0; k <= Math.log2(TILE); k++) {
    const w = Math.max(1, TILE >> k), each = blocksOf(w) * BLOCK, data = new Uint8Array(each * depth);
    chains.forEach((c, i) => data.set(c[k], i * each));
    mips.push({ data, width: w, height: w });
  }
  const tex = new THREE.CompressedArrayTexture(mips, TILE, TILE, depth, THREE.RGBA_S3TC_DXT5_Format);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function heightAt(t, x, y) {
  const n = t.size, gx = Math.min(n - 1.001, Math.max(0, x / CELL)), gy = Math.min(n - 1.001, Math.max(0, y / CELL));
  const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy, h = t.heights;
  const a = h[iy * n + ix], b = h[iy * n + ix + 1], c = h[(iy + 1) * n + ix], d = h[(iy + 1) * n + ix + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

export function fogTexture(t) {
  if (t.fog) return t.fog;
  const m = Math.ceil(t.size / 2), data = new Uint8Array(m * m).fill(255);
  const tex = new THREE.DataTexture(data, m, m, THREE.RedFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  t.fog = tex; t.fogSeen = new Uint8Array(m * m);
  return tex;
}
export function paintFog(t, eyes, remember = true, dt = 0, regrow = 6) {
  const tex = fogTexture(t), d = tex.image.data, m = tex.image.width, seen = t.fogSeen, cell = CELL * 2;
  const light = t.fogLight ||= new Float32Array(d.length);
  if (!eyes) { d.fill(255); light.fill(1); if(remember)seen.fill(1); tex.needsUpdate = true; return; }
  const fall = regrow > 0 ? dt / regrow : 1;
  for (let i = 0; i < light.length; i++) if (light[i] > 0) light[i] = Math.max(0, light[i] - fall);
  for (const [x, y, r] of eyes) {
    const cx = x / cell, cy = y / cell, cr = r / cell, r2 = cr * cr;
    for (let j = Math.max(0, Math.floor(cy - cr)); j <= Math.min(m - 1, Math.ceil(cy + cr)); j++)
      for (let i = Math.max(0, Math.floor(cx - cr)); i <= Math.min(m - 1, Math.ceil(cx + cr)); i++)
        if ((i - cx) ** 2 + (j - cy) ** 2 <= r2) { light[j * m + i] = 1; seen[j * m + i] = 1; }
  }
  for (let i = 0; i < d.length; i++) d[i] = seen[i] ? 150 + Math.round(105 * light[i]) : 0;
  tex.needsUpdate = true;
}

function quadLayers(t, slot, quad) {
  const any = quad.find(i => slot.has(t.layerIndex[i]));
  return quad.map(i => slot.get(t.layerIndex[slot.has(t.layerIndex[i]) ? i : any]) ?? 0);
}

export async function buildTerrain(t) {
  const n = t.size, h = t.heights;
  const normals = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const l = h[y * n + Math.max(0, x - 1)], r = h[y * n + Math.min(n - 1, x + 1)], d = h[Math.max(0, y - 1) * n + x], u = h[Math.min(n - 1, y + 1) * n + x];
    const nx = (l - r) / (2 * CELL), ny = (d - u) / (2 * CELL), len = Math.hypot(nx, ny, 1), o = (y * n + x) * 3;
    normals[o] = nx / len; normals[o + 1] = ny / len; normals[o + 2] = 1 / len;
  }
  const used = [...new Set([...t.layerIndex, ...(t.extraLayers || [])])].filter(i => t.layers[i] && t.layers[i].texture).sort((a, b) => a - b);
  const bare = i => !!t.layers[t.layerIndex[i]]?.hole;
  const slot = new Map(used.map((i, k) => [i, k]));
  const tris = (n - 1) * (n - 1) * 2;
  const pos = new Float32Array(tris * 9), nor = new Float32Array(tris * 9), lay = new Float32Array(tris * 12), cor = new Float32Array(tris * 6), sh = new Float32Array(tris * 3);
  let v = 0;
  const triAt = new Int32Array(tris).fill(-1);
  const put = (ids, quad) => {
    const L = quadLayers(t, slot, quad), x0 = quad[0] % n, y0 = (quad[0] / n) | 0;
    ids.forEach(i => {
      const x = i % n, y = (i / n) | 0, o = v * 3;
      pos[o] = x * CELL; pos[o + 1] = y * CELL; pos[o + 2] = h[i];
      nor[o] = normals[i * 3]; nor[o + 1] = normals[i * 3 + 1]; nor[o + 2] = normals[i * 3 + 2];
      lay.set(L, v * 4);
      cor[v * 2] = x - x0; cor[v * 2 + 1] = y - y0;
      sh[v] = Math.min(1, t.shade[i] / 254);
      v++;
    });
  };
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const a = y * n + x, b = a + 1, c = a + n, d = c + 1;
    const q = (y * (n - 1) + x) * 2;
    if ([a, b, c, d].every(bare)) continue;
    triAt[q] = v; put([a, b, d], [a, b, c, d]);
    triAt[q + 1] = v; put([a, d, c], [a, b, c, d]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setDrawRange(0, v);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('layers', new THREE.BufferAttribute(lay, 4));
  geo.setAttribute('corner', new THREE.BufferAttribute(cor, 2));
  geo.setAttribute('shade', new THREE.BufferAttribute(sh, 1));
  geo.computeBoundingSphere();

  const texU = [], texV = [], matDiffuse = [], matSpecular = [];
  for (let k = 0; k < SLOTS; k++) {
    const L = t.layers[used[k]] || {}, [U, V] = texturePlanes(L);
    texU.push(new THREE.Vector4(...U)); texV.push(new THREE.Vector4(...V));
    matDiffuse.push(new THREE.Vector3(...(L.diffuse || [1, 1, 1]))); matSpecular.push(new THREE.Vector3(...(L.specular || [1, 1, 1])));
  }
  const files = await Promise.all(used.map(i => Promise.all([loadDDS(t.layers[i].texture), t.layers[i].bump ? loadDDS(t.layers[i].bump) : null])));
  const tex = arrayTexture(files.map(f => layerChain(f[0], [128, 128, 128, 0])));
  const bump = arrayTexture(files.map(f => layerChain(f[1], [128, 128, 255, 255])));
  const C = t.clouds || {}, cloudAt = new THREE.Vector3(0, 0, C.tile > 0 ? C.tile : 500);
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { map: { value: tex }, bump: { value: bump }, texU: { value: texU }, texV: { value: texV }, matDiffuse: { value: matDiffuse }, matSpecular: { value: matSpecular },
      clouds: { value: loadTexture(C.texture || '') }, cloudAt: { value: cloudAt },
      fog: { value: fogTexture(t) }, side: { value: (n - 1) * CELL }, sunDir: lighting.sunDir, sunColor: lighting.sunColor, fillDir: lighting.fillDir, fillColor: lighting.fillColor, ambient: lighting.ambient, fogTint: lighting.fogTint, fogRange: lighting.fogRange,
      shadowMap: lighting.shadowMap, shadowMatrix: lighting.shadowMatrix, shadowOn: lighting.shadowOn, shadowTexel: lighting.shadowTexel },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const drift = C.drift || [0, 0, 0];
  mesh.userData.tick = dt => { cloudAt.x += drift[0] * dt; cloudAt.y += drift[1] * dt; };
  t.paint = { slot, triAt, geo };
  return mesh;
}

export function paveTerrain(t, cells, layer) {
  const P = t.paint;
  if (!P || !P.slot.has(layer)) return;
  const n = t.size, lay = P.geo.getAttribute('layers'), quads = new Set();
  for (const i of cells) {
    if (!P.slot.has(t.layerIndex[i])) continue;
    t.layerIndex[i] = layer;
    const x = i % n, y = (i / n) | 0;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < n - 1 && y + dy < n - 1) quads.add((y + dy) * (n - 1) + x + dx);
  }
  for (const q of quads) {
    const x = q % (n - 1), y = (q / (n - 1)) | 0, a = y * n + x, L = quadLayers(t, P.slot, [a, a + 1, a + n, a + n + 1]);
    for (let k = 0; k < 2; k++) {
      const v0 = P.triAt[q * 2 + k];
      if (v0 >= 0) for (let j = 0; j < 3; j++) lay.setXYZW(v0 + j, L[0], L[1], L[2], L[3]);
    }
  }
  lay.needsUpdate = true;
}

const WATER_VERT = `
  attribute float depth;
  uniform mat4 mirror;
  varying vec3 vWorld; varying vec4 vMirror; varying float vDepth;
  void main() { vWorld = position; vDepth = depth; vMirror = mirror * vec4(position, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HAZE = `
  uniform vec3 fogTint; uniform vec2 fogRange;
  float haze(vec3 at) { return fogRange.y > 0.0 ? clamp((fogRange.y - distance(cameraPosition, at)) / max(1.0, fogRange.y - fogRange.x), 0.0, 1.0) : 1.0; }`;
const SHORE = `
  uniform vec2 shore;
  float shoreAlpha(float depth) { return clamp(shore.y + (1.0 - shore.y) * clamp(depth * shore.x, 0.0, 1.0), 0.0, 1.0); }`;
const SLIDE = `
  uniform float time;
  vec2 slide(vec4 r, float aside) { return vec2((vWorld.x * cos(r.y) + vWorld.y * sin(r.y)) / r.x + r.z * cos(r.w + aside) * time, vWorld.y * cos(r.y) / r.x + r.z * sin(r.w + aside) * time); }`;

const WATER_UNDER = `
  uniform vec3 under;
  varying float vDepth; varying vec3 vWorld;
  ${SHORE} ${HAZE}
  void main() { float a = shoreAlpha(vDepth) * haze(vWorld); gl_FragColor = vec4(vec3(1.0 - a) + a * under, 1.0); }`;
const WATER_OVER = `
  uniform sampler2D bump, reflection, fog; uniform vec3 over; uniform vec4 ripple; uniform float bend, side;
  varying vec3 vWorld; varying vec4 vMirror; varying float vDepth;
  ${SHORE} ${SLIDE} ${HAZE}
  void main() {
    vec2 d = (texture2D(bump, slide(ripple, -0.7853982)).xy - 0.5) * 2.0 + (texture2D(bump, slide(ripple, 0.7853982)).xy - 0.5) * 2.0;
    vec3 r = texture2D(reflection, clamp((vMirror.xy + d * bend * 200.0) / vMirror.w, 0.002, 0.998)).rgb;
    float seen = mix(0.3, 1.0, texture2D(fog, vWorld.xy / side).r);
    gl_FragColor = vec4(r * over * shoreAlpha(vDepth) * seen * haze(vWorld), 1.0);
  }`;
const LAVA_FRAG = `
  uniform sampler2D base, crust, bump, fog; uniform vec4 flow, lie; uniform vec3 sunDir, sunColor, ambient, glint; uniform float side;
  varying vec3 vWorld;
  ${SLIDE} ${HAZE}
  void main() {
    vec2 at = slide(lie, 0.0);
    vec4 c = texture2D(crust, at); vec3 n = texture2D(bump, at).xyz * 2.0 - 1.0;
    vec3 h = normalize(normalize(cameraPosition - vWorld) + sunDir);
    float s = clamp(dot(n, h), 0.0, 1.0);
    vec3 lit = c.rgb * (sunColor * clamp(dot(n, sunDir), 0.0, 1.0) + ambient) + glint * sunColor * 0.5 * s * s * s * s * s;
    float seen = mix(0.3, 1.0, texture2D(fog, vWorld.xy / side).r);
    gl_FragColor = vec4(mix(fogTint, mix(texture2D(base, slide(flow, 0.0)).rgb, lit, c.a) * seen, haze(vWorld)), 1.0);
  }`;
const ICE_FRAG = `
  uniform sampler2D base, bump, reflection, fog; uniform vec4 flow, lie; uniform vec3 sunDir, sunColor, ambient, tint; uniform float bend, side;
  varying vec3 vWorld; varying vec4 vMirror;
  ${SLIDE} ${HAZE}
  void main() {
    vec3 n = texture2D(bump, slide(lie, 0.0)).xyz * 2.0 - 1.0;
    vec4 c = texture2D(base, slide(flow, 0.0));
    vec3 lit = c.rgb * (sunColor * tint * clamp(dot(n, sunDir), 0.0, 1.0) + ambient);
    vec3 r = texture2D(reflection, clamp(vMirror.xy / vMirror.w + n.xy * bend, 0.002, 0.998)).rgb;
    float seen = mix(0.3, 1.0, texture2D(fog, vWorld.xy / side).r);
    gl_FragColor = vec4(mix(fogTint, mix(lit, r, c.a) * seen, haze(vWorld)), 1.0);
  }`;

function mirrorOf(level) {
  const target = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter; target.texture.colorSpace = THREE.NoColorSpace;
  const eye = new THREE.PerspectiveCamera(), matrix = new THREE.Matrix4();
  const at = new THREE.Vector3(0, 0, level), up = new THREE.Vector3(0, 0, 1), camAt = new THREE.Vector3(), view = new THREE.Vector3(), look = new THREE.Vector3(), aim = new THREE.Vector3();
  const turn = new THREE.Matrix4(), plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4(), size = new THREE.Vector2();
  return {
    target, matrix,
    render(renderer, camera, draw) {
      camAt.setFromMatrixPosition(camera.matrixWorld);
      if (camAt.z <= level) return false;
      renderer.getDrawingBufferSize(size);
      const w = Math.max(4, size.x >> 1), h = Math.max(4, size.y >> 1);
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      view.subVectors(at, camAt).reflect(up).negate().add(at);
      turn.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(turn).add(camAt);
      aim.subVectors(at, look).reflect(up).negate().add(at);
      eye.position.copy(view); eye.up.set(0, 1, 0).applyMatrix4(turn).reflect(up); eye.lookAt(aim);
      eye.far = camera.far; eye.updateMatrixWorld(); eye.projectionMatrix.copy(camera.projectionMatrix);
      matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(eye.projectionMatrix).multiply(eye.matrixWorldInverse);
      plane.setFromNormalAndCoplanarPoint(up, at).applyMatrix4(eye.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const p = eye.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1 - 0.003; p[14] = clip.w;
      eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
      const was = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      draw(eye);
      renderer.setRenderTarget(was);
      return true;
    },
  };
}

export function buildWater(t) {
  const w = t.water;
  if (!w || !w.mode) return null;
  const n = t.size, h = t.heights, level = w.level, side = (n - 1) * CELL;
  const pos = [], depth = [];
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const a = y * n + x, ids = [a, a + 1, a + n + 1, a, a + n + 1, a + n];
    if (!ids.some(i => h[i] < level)) continue;
    for (const i of ids) { pos.push((i % n) * CELL, ((i / n) | 0) * CELL, level); depth.push(level - h[i]); }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const file = name => (name ? (/\.\w+$/.test(name) ? name : name + '.tga') : '');
  const layer = i => { const r = w.ripples[i] || { tile: 150, turn: 0, speed: 0.05, heading: 0 }; return new THREE.Vector4(r.tile > 0 ? r.tile : 150, r.turn, r.speed, r.heading); };
  const time = { value: 0 }, fog = { value: fogTexture(t) }, sideU = { value: side }, fogTint = lighting.fogTint, fogRange = lighting.fogRange;
  const shore = { value: new THREE.Vector2(w.fade > 0 ? 1 / w.fade : 0.1, w.least) };
  const light = { sunDir: lighting.sunDir, sunColor: lighting.sunColor, ambient: lighting.ambient };
  const group = new THREE.Group();
  const add = (fragmentShader, uniforms, more = {}) => {
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader, uniforms: { time, fog, side: sideU, shore, fogTint, fogRange, ...uniforms }, ...more }));
    m.renderOrder = 1 + group.children.length * 0.1;
    group.add(m);
    return m;
  };
  let glass = null;
  if (w.mode === 1) {
    const k = Math.min(1, Math.max(0, w.reflect));
    glass = mirrorOf(level);
    add(WATER_UNDER, { under: { value: new THREE.Vector3(...w.tint).multiplyScalar(1 - k) } }, { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor });
    add(WATER_OVER, { over: { value: new THREE.Vector3(...w.tint).multiplyScalar(k) }, bump: { value: loadTexture(file(w.textures[0])) }, ripple: { value: layer(0) }, bend: { value: w.bend * 0.02 },
      reflection: { value: glass.target.texture }, mirror: { value: glass.matrix } }, { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
  } else if (w.mode === 2) {
    add(LAVA_FRAG, { ...light, base: { value: loadTexture(file(w.textures[0])) }, crust: { value: loadTexture(file(w.textures[1])) }, bump: { value: loadTexture(file(w.textures[2])) },
      flow: { value: layer(0) }, lie: { value: layer(1) }, glint: { value: new THREE.Vector3(...w.glint) }, mirror: { value: new THREE.Matrix4() } });
  } else {
    glass = mirrorOf(level);
    add(ICE_FRAG, { ...light, base: { value: loadTexture(file(w.textures[0])) }, bump: { value: loadTexture(file(w.textures[1])) }, flow: { value: layer(0) }, lie: { value: layer(1) },
      tint: { value: new THREE.Vector3(...w.tint) }, bend: { value: w.bend * 0.02 }, reflection: { value: glass.target.texture }, mirror: { value: glass.matrix } });
  }
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  let turn = 0;
  group.userData.tick = dt => { time.value += dt; };
  group.userData.mirror = (renderer, camera, draw) => {
    if (!glass) return;
    frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (!frustum.intersectsBox(geo.boundingBox)) { turn = 0; return; }
    if (turn++ & 1) return;
    group.visible = false;
    glass.render(renderer, camera, draw);
    group.visible = true;
  };
  return group;
}

const SKY_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `
  uniform sampler2D map, clouds; uniform float cloudScale, cloudRate, time;
  varying vec2 vUv;
  void main() {
    vec3 base = texture2D(map, vUv).rgb;
    vec4 c = texture2D(clouds, vUv * cloudScale + vec2(time * cloudRate, 0.0));
    gl_FragColor = vec4(base + c.rgb * c.a * 0.35, 1.0);
  }`;

export function skyMaterial(params) {
  const time = { value: 0 };
  const m = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { map: { value: loadTexture(params.BaseTexture || '') }, clouds: { value: loadTexture(params.CloudTexture || params.BaseTexture || '') },
      cloudScale: { value: params.CloudScale ?? 1 }, cloudRate: { value: params.CloudScrollRate ?? 0 }, time },
  });
  m.userData.tick = dt => { time.value += dt; };
  return m;
}
