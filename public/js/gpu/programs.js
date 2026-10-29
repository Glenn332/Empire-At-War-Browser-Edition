import * as THREE from '../../vendor/three/build/three.module.js';
import { env } from './env.js';

export const PASS_WGSL = `
struct Pass {
  view: mat4x4f, proj: mat4x4f, shadowMatrix: mat4x4f,
  cameraPosition: vec3f, shadowOn: f32,
  sunDir: vec3f, shadowTexel: f32,
  sunColor: vec3f, fowSide: f32,
  fillDir: vec3f, height: f32,
  fillColor: vec3f, _a: f32,
  ambient: vec3f, _b: f32,
  fogTint: vec3f, _c: f32,
  fogRange: vec2f, _d: vec2f,
}
@group(0) @binding(0) var<uniform> P: Pass;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowS: sampler_comparison;
@group(0) @binding(3) var fowMap: texture_2d<f32>;
@group(0) @binding(4) var fowS: sampler;
fn glDepth(p: vec4f) -> vec4f { return vec4f(p.x, -p.y, (p.z + p.w) * 0.5, p.w); }
fn glMod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
`;

export const PARAMS = 32;

const MODEL_DEFINES = [
  'ADDITIVE',
  'NATIVE_MESH_ADDITIVE',
  'NEBULA',
  'NATIVE_MESH_GLOSS_EMISSIVE',
  'ALPHA',
  'UNLIT',
  'COLORIZE',
  'BUMP',
  'GLOSSMAP',
  'GLOSS',
  'USE_VCOLOR',
  'FOW_DIM',
  'DETAIL',
  'SKINNED',
  'INSTSKIN'
];
const LIGHTING_KEYS = [
  'sunDir',
  'sunColor',
  'fillDir',
  'fillColor',
  'ambient',
  'shadowMap',
  'shadowMatrix',
  'shadowOn',
  'shadowTexel',
  'fogTint',
  'fogRange',
  'fowMap',
  'fowSide'
];

function modelCode(D, instanced, depth, turned = false) {
  const L = [];
  const on = k => !!D[k];
  L.push(
    PASS_WGSL,
    `
struct Draw {
  model: mat4x4f, modelView: mat4x4f,
  colorization: vec4f, tint: vec4f,
  emissive: vec3f, shininess: f32,
  diffuse: vec3f, opacity: f32,
  specular: vec3f, glow: f32,
  uvScroll: vec2f, uvScrollRate: vec2f,
  ghost: f32, dissolve: f32, time: f32, detailScale: f32,
  instBase: u32, tintBase: u32, boneBase: u32, _e: u32,
}
@group(1) @binding(0) var mapT: texture_2d<f32>;
@group(1) @binding(1) var mapS: sampler;
@group(1) @binding(2) var normalT: texture_2d<f32>;
@group(1) @binding(3) var normalS: sampler;
@group(1) @binding(4) var glossT: texture_2d<f32>;
@group(1) @binding(5) var glossS: sampler;
@group(2) @binding(0) var<uniform> D: Draw;
`
  );
  L.push(`
@group(3) @binding(0) var<storage, read> arena: array<vec4f>;
fn arenaAt(at: u32, n: u32) -> u32 { return min(at, arrayLength(&arena) - n); }
fn boneAt(b: f32, inst: u32) -> mat4x4f { let at = arenaAt(D.boneBase + inst * 96u + u32(clamp(i32(b), 0, 23)) * 4u, 4u); return mat4x4f(arena[at], arena[at + 1u], arena[at + 2u], arena[at + 3u]); }
`);
  L.push(`
struct VIn {
  @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f,
  @location(3) tangent: vec3f, @location(4) binormal: vec3f,
  ${on('USE_VCOLOR') ? '@location(5) color: vec4f,' : ''}
  ${on('SKINNED') ? '@location(6) skinIndex: vec4f, @location(7) skinWeight: vec4f,' : ''}
  @builtin(instance_index) ii: u32,
}
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) vUv: vec2f, @location(1) vNormal: vec3f, @location(2) vTangent: vec3f, @location(3) vBinormal: vec3f,
  @location(4) vWorldPos: vec3f, @location(5) vTint: vec4f,
  ${on('USE_VCOLOR') ? '@location(6) vColor: vec4f,' : ''}
  ${on('DETAIL') ? '@location(7) vObjPos: vec3f,' : ''}
  ${on('NEBULA') ? '@location(8) vShade: vec3f,' : ''}
}
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vUv = i.uv + D.uvScroll;
  ${on('NATIVE_MESH_ADDITIVE') ? 'o.vUv += D.time * D.uvScrollRate;' : ''}
  ${
    on('SKINNED')
      ? `let bi = ${on('INSTSKIN') ? 'i.ii' : '0u'};
  let skin = boneAt(i.skinIndex.x, bi) * i.skinWeight.x + boneAt(i.skinIndex.y, bi) * i.skinWeight.y
           + boneAt(i.skinIndex.z, bi) * i.skinWeight.z + boneAt(i.skinIndex.w, bi) * i.skinWeight.w;
  var mm = D.model * skin;`
      : 'var mm = D.model;'
  }
  ${
    instanced
      ? `let ib = arenaAt(D.instBase + i.ii * 4u, 4u);
  mm = D.model * mat4x4f(arena[ib], arena[ib + 1u], arena[ib + 2u], arena[ib + 3u]);
  ${on('SKINNED') ? 'mm = mm * skin;' : ''}
  o.vTint = arena[arenaAt(D.tintBase + i.ii, 1u)];`
      : 'o.vTint = vec4f(0.0);'
  }
  ${
    on('NEBULA')
      ? `let wave = sin(6.2831853 * (D.specular.y * (mm * vec4f(i.position, 1.0)).xyz + D.time * D.specular.z));
  let wp = mm * vec4f(i.position + D.specular.x * wave, 1.0);
  let vn = normalize(mat3x3f(P.view[0].xyz, P.view[1].xyz, P.view[2].xyz) * (mat3x3f(mm[0].xyz, mm[1].xyz, mm[2].xyz) * i.normal));
  var facing = vn.z * vn.z; facing *= facing; facing *= facing;
  o.vShade = clamp(${on('USE_VCOLOR') ? 'i.color.rgb' : 'vec3f(1.0)'} * (2.0 * facing + 0.1), vec3f(0.0), vec3f(1.0));`
      : 'let wp = mm * vec4f(i.position, 1.0);'
  }
  o.vWorldPos = wp.xyz;
  ${on('DETAIL') ? 'o.vObjPos = i.position;' : ''}
  let nm = mat3x3f(mm[0].xyz, mm[1].xyz, mm[2].xyz);
  o.vNormal = nm * i.normal;
  o.vTangent = nm * i.tangent;
  o.vBinormal = nm * i.binormal;
  ${on('USE_VCOLOR') ? 'o.vColor = i.color;' : ''}
  o.pos = glDepth(P.proj * P.view * wp);
  return o;
}
fn bayer2(a0: vec2f) -> f32 { let a = floor(a0); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
fn bayer4(a: vec2f) -> f32 { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
fn haze(at: vec3f) -> f32 { return select(1.0, clamp((P.fogRange.y - distance(P.cameraPosition, at)) / max(1.0, P.fogRange.y - P.fogRange.x), 0.0, 1.0), P.fogRange.y > 0.0); }
`);
  if (depth) {
    L.push(`
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  ${
    on('UNLIT')
      ? ''
      : `let fc = v.pos.xy;
  if (D.ghost > 0.5 && glMod(floor(fc.x) + floor(fc.y), 2.0) < 1.0) { discard; }
  if (D.dissolve > 0.0 && bayer4(fc) < D.dissolve) { discard; }`
  }
  return vec4f(0.0);
}`);
    return L.join('');
  }
  if (!on('UNLIT'))
    L.push(`
fn sunlit(wp: vec3f, n: vec3f) -> f32 {
  if (P.shadowOn < 0.5) { return 1.0; }
  let p = (P.shadowMatrix * vec4f(wp + n * 3.0, 1.0)).xyz;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) { return 1.0; }
  let d = p.z - 0.0012; let o = P.shadowTexel * 1.4;
  var s = textureSampleCompareLevel(shadowMap, shadowS, p.xy, d) * 2.0;
  s += textureSampleCompareLevel(shadowMap, shadowS, p.xy + vec2f(-o, -o), d);
  s += textureSampleCompareLevel(shadowMap, shadowS, p.xy + vec2f(o, -o), d);
  s += textureSampleCompareLevel(shadowMap, shadowS, p.xy + vec2f(-o, o), d);
  s += textureSampleCompareLevel(shadowMap, shadowS, p.xy + vec2f(o, o), d);
  s /= 6.0;
  let e = min(p.xy, 1.0 - p.xy);
  return mix(1.0, mix(0.38, 1.0, s), smoothstep(0.0, 0.06, min(e.x, e.y)));
}`);
  if (on('DETAIL'))
    L.push(`
fn dHash(p0: vec3f) -> f32 { var p = fract(fma(p0, vec3f(0.3183099), vec3f(0.1))); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn dNoise(x: vec3f) -> f32 {
  let i = floor(x); var f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3f(1, 0, 0)), f.x), mix(dHash(i + vec3f(0, 1, 0)), dHash(i + vec3f(1, 1, 0)), f.x), f.y),
             mix(mix(dHash(i + vec3f(0, 0, 1)), dHash(i + vec3f(1, 0, 1)), f.x), mix(dHash(i + vec3f(0, 1, 1)), dHash(i + vec3f(1, 1, 1)), f.x), f.y), f.z);
}
fn dFbm(p0: vec3f) -> f32 {
  var a = 0.5; var s = 0.0; var p = p0;
  for (var i = 0; i < 4; i++) { s += a * dNoise(p); p = p * 2.07 + 7.3; a *= 0.5; }
  return s;
}
fn rock(p: vec3f) -> f32 {
  let ridges = 1.0 - abs(dFbm(p * 0.6) * 2.0 - 1.0);
  return dFbm(p) * 0.6 + ridges * ridges * 0.3 + dNoise(p * 6.0) * 0.1;
}`);
  L.push(`
@fragment fn fs(v: VOut, @builtin(front_facing) facing: bool) -> @location(0) vec4f {
  let front = ${turned ? '!facing' : 'facing'};
  let fc = v.pos.xy;
  let base = textureSample(mapT, mapS, v.vUv);
  var albedo = base.rgb;
  ${on('COLORIZE') ? 'albedo = mix(albedo, albedo * D.colorization.rgb * 1.25, base.a);' : ''}
`);
  if (on('UNLIT')) {
    L.push(`
  var col = albedo * D.diffuse;
  var a = base.a;
  ${on('USE_VCOLOR') ? 'col *= v.vColor.rgb; a *= v.vColor.a;' : ''}
  ${
    on('NEBULA')
      ? 'return vec4f(albedo * v.vShade * D.opacity * D.glow * haze(v.vWorldPos), 1.0);'
      : on('NATIVE_MESH_ADDITIVE')
        ? 'return vec4f(col * D.opacity * D.glow * haze(v.vWorldPos), 1.0);'
        : on('ADDITIVE')
          ? 'return vec4f(col * a * D.opacity * D.glow * haze(v.vWorldPos), 1.0);'
          : 'return vec4f(mix(P.fogTint, col, haze(v.vWorldPos)), a * D.opacity);'
  }
}`);
    return L.join('');
  }
  L.push(`
  var n = normalize(v.vNormal);
  var gloss = 0.25;
  ${
    on('BUMP')
      ? `let nt = textureSample(normalT, normalS, v.vUv);
  let tn = nt.xyz * 2.0 - 1.0;
  n = normalize(tn.x * normalize(v.vTangent) + tn.y * normalize(v.vBinormal) + tn.z * n);
  gloss = nt.a;`
      : ''
  }
  ${on('GLOSS') ? 'gloss = base.a;' : ''}
  ${on('GLOSSMAP') ? '{ let gm = textureSample(glossT, glossS, v.vUv).rgb; gloss = max(gm.r, max(gm.g, gm.b)); }' : ''}
  ${
    on('DETAIL')
      ? `{
    let q = v.vObjPos * D.detailScale;
    let tu = normalize(v.vTangent); let bv = normalize(v.vBinormal);
    let ou = normalize(cross(n, vec3f(0.31, 0.57, 0.76))); let ov = cross(n, ou);
    let h = rock(q); let hu = rock(q + ou * 0.35); let hv = rock(q + ov * 0.35);
    n = normalize(n + (ou * (h - hu) + ov * (h - hv)) * 2.6);
    albedo *= 0.62 + 0.76 * h;
    albedo *= mix(vec3f(1.0, 0.96, 0.9), vec3f(0.9, 0.96, 1.04), dNoise(q * 0.35));
  }`
      : ''
  }
  if (!front) { n = -n; }
  let sun = sunlit(v.vWorldPos, normalize(v.vNormal) * select(-1.0, 1.0, front));
  let light = P.ambient + P.sunColor * max(dot(n, P.sunDir), 0.0) * sun + P.fillColor * max(dot(n, P.fillDir), 0.0);
  let vv = normalize(P.cameraPosition - v.vWorldPos);
  let sp = pow(max(dot(n, normalize(P.sunDir + vv)), 0.0), max(D.shininess, 1.0)) * sun;
  ${
    on('NATIVE_MESH_GLOSS_EMISSIVE')
      ? 'var col = albedo * D.emissive * 2.0;'
      : 'var col = albedo * (D.emissive + D.diffuse * light) + D.specular * P.sunColor * sp * gloss * 0.6;'
  }
  col = mix(col, D.tint.rgb, D.tint.a);
  col = mix(col, v.vTint.rgb, v.vTint.a);
  if (D.ghost > 0.5 && glMod(floor(fc.x) + floor(fc.y), 2.0) < 1.0) { discard; }
  if (D.dissolve > 0.0 && bayer4(fc) < D.dissolve) { discard; }
  ${on('FOW_DIM') ? 'if (P.fowSide > 0.0) { col *= mix(0.3, 1.0, textureSample(fowMap, fowS, v.vWorldPos.xy / P.fowSide).r); }' : ''}
  col = mix(P.fogTint, col, haze(v.vWorldPos));
  ${on('ALPHA') ? 'return vec4f(col, base.a * D.opacity);' : 'return vec4f(col, D.opacity);'}
}`);
  return L.join('');
}

export const texBinding = (b, kind = 'float', dim = '2d') => [
  { binding: b, visibility: 3, texture: { sampleType: kind, viewDimension: dim } },
  { binding: b + 1, visibility: 3, sampler: { type: kind === 'unfilterable-float' ? 'non-filtering' : 'filtering' } }
];

export const col3 = (f, o, c, d = 0) => {
  if (c) {
    f[o] = c.r ?? c.x;
    f[o + 1] = c.g ?? c.y;
    f[o + 2] = c.b ?? c.z;
  } else f[o] = f[o + 1] = f[o + 2] = d;
};
export const vec4 = (f, o, v) => {
  if (v) {
    f[o] = v.x;
    f[o + 1] = v.y;
    f[o + 2] = v.z;
    f[o + 3] = v.w;
  } else f[o] = f[o + 1] = f[o + 2] = f[o + 3] = 0;
};
export const num = u => (u ? +u.value || 0 : 0);

let turnedSrc = null;
const turnedFrag = () => (turnedSrc ||= env.programSources.FRAG.replace(/\bgl_FrontFacing\b/g, '(!gl_FrontFacing)'));

const model = {
  name: 'model',
  match(m) {
    const P = env.programSources;
    if (!m.isShaderMaterial || m.vertexShader !== P.VERT) return false;
    return m.fragmentShader === P.FRAG || m.fragmentShader === P.DEPTH_FRAG || m.fragmentShader === turnedFrag();
  },
  light: m => (LIGHTING_KEYS.every(k => !m.uniforms[k] || m.uniforms[k] === env.lighting[k]) ? null : m.uniforms),
  key(m, instanced) {
    const D = m.defines || {};
    return (
      'model|' +
      MODEL_DEFINES.filter(k => D[k]).join(',') +
      (instanced ? '|I' : '') +
      (m.fragmentShader === env.programSources.DEPTH_FRAG ? '|Z' : '') +
      (m.fragmentShader === turnedFrag() ? '|T' : '')
    );
  },
  code(m, instanced) {
    return modelCode(m.defines || {}, instanced, m.fragmentShader === env.programSources.DEPTH_FRAG, m.fragmentShader === turnedFrag());
  },
  attributes(m, instanced) {
    const D = m.defines || {},
      a = [
        ['position', 3, 0],
        ['normal', 3, 1],
        ['uv', 2, 2],
        ['tangent', 3, 3],
        ['binormal', 3, 4]
      ];
    if (D.USE_VCOLOR) a.push(['color', 4, 5]);
    if (D.SKINNED) a.push(['skinIndex', 4, 6], ['skinWeight', 4, 7]);
    return { vertex: a, instance: [] };
  },
  storage: true,
  modelView: false,
  bones: m => !!(m.defines && m.defines.SKINNED),
  layout: [...texBinding(0), ...texBinding(2), ...texBinding(4)],
  textures(m) {
    const U = m.uniforms;
    return [U.map && U.map.value, U.normalMap && U.normalMap.value, U.glossMap && U.glossMap.value];
  },
  params(m, f, o) {
    const U = m.uniforms;
    vec4(f, o, U.colorization && U.colorization.value);
    vec4(f, o + 4, U.tint && U.tint.value);
    col3(f, o + 8, U.emissive && U.emissive.value);
    f[o + 11] = num(U.shininess);
    col3(f, o + 12, U.diffuse && U.diffuse.value);
    f[o + 15] = num(U.opacity);
    col3(f, o + 16, U.nebulaWave ? U.nebulaWave.value : U.specular && U.specular.value);
    f[o + 19] = num(U.glow);
    const s = U.uvScroll && U.uvScroll.value,
      r = U.uvScrollRate && U.uvScrollRate.value;
    f[o + 20] = s ? s.x : 0;
    f[o + 21] = s ? s.y : 0;
    f[o + 22] = r ? r.x : 0;
    f[o + 23] = r ? r.y : 0;
    f[o + 24] = num(U.ghost);
    f[o + 25] = num(U.dissolve);
    f[o + 26] = num(U.time);
    f[o + 27] = num(U.detailScale);
  },
  boneSource(m) {
    const U = m.uniforms;
    if (m.defines.INSTSKIN) return U.boneTex && U.boneTex.value ? U.boneTex.value.image.data : null;
    return U.boneMatrices && U.boneMatrices.value;
  }
};

const TERRAIN_SLOTS = 64;
const terrainCode = () =>
  PASS_WGSL +
  `
struct Draw { model: mat4x4f, modelView: mat4x4f }
struct Terrain { texU: array<vec4f, ${TERRAIN_SLOTS}>, texV: array<vec4f, ${TERRAIN_SLOTS}>, matDiffuse: array<vec4f, ${TERRAIN_SLOTS}>, matSpecular: array<vec4f, ${TERRAIN_SLOTS}>, cloudAt: vec4f, side: vec4f }
@group(1) @binding(0) var mapT: texture_2d_array<f32>;
@group(1) @binding(1) var mapS: sampler;
@group(1) @binding(2) var bumpT: texture_2d_array<f32>;
@group(1) @binding(3) var bumpS: sampler;
@group(1) @binding(4) var cloudsT: texture_2d<f32>;
@group(1) @binding(5) var cloudsS: sampler;
@group(1) @binding(6) var fogT: texture_2d<f32>;
@group(1) @binding(7) var fogS: sampler;
@group(1) @binding(8) var<uniform> T: Terrain;
@group(2) @binding(0) var<uniform> D: Draw;
struct VIn { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) layers: vec4f, @location(3) corner: vec2f, @location(4) shade: f32 }
struct VOut { @builtin(position) pos: vec4f, @location(0) vCorner: vec2f, @location(1) vNormal: vec3f, @location(2) vWorld: vec3f, @location(3) vShade: f32, @location(4) @interpolate(flat) vLayers: vec4f }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vCorner = i.corner; o.vLayers = i.layers; o.vShade = i.shade;
  o.vNormal = i.normal; o.vWorld = i.position;
  o.pos = glDepth(P.proj * D.modelView * vec4f(i.position, 1.0));
  return o;
}
fn sunlit(wp: vec3f) -> f32 {
  if (P.shadowOn < 0.5) { return 1.0; }
  let p = (P.shadowMatrix * vec4f(wp + vec3f(0.0, 0.0, 1.5), 1.0)).xyz;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) { return 1.0; }
  let d = p.z - 0.0015; let o = P.shadowTexel * 1.3;
  var s = textureSampleCompareLevel(shadowMap, shadowS, p.xy, d);
  s += textureSampleCompareLevel(shadowMap, shadowS, p.xy + vec2f(-o, -o), d) + textureSampleCompareLevel(shadowMap, shadowS, p.xy + vec2f(o, -o), d) + textureSampleCompareLevel(shadowMap, shadowS, p.xy + vec2f(-o, o), d) + textureSampleCompareLevel(shadowMap, shadowS, p.xy + vec2f(o, o), d);
  let e = min(p.xy, 1.0 - p.xy);
  return mix(1.0, mix(0.5, 1.0, s / 5.0), smoothstep(0.0, 0.05, min(e.x, e.y)));
}
var<private> n: vec3f;
var<private> toEye: vec3f;
var<private> dPx: vec3f;
var<private> dPy: vec3f;
var<private> soft: vec3f;
var<private> vWorld: vec3f;
fn layer(slot: f32) -> vec3f {
  let i = clamp(i32(slot + 0.5), 0, ${TERRAIN_SLOTS - 1});
  let U = T.texU[i].xyz; let V = T.texV[i].xyz;
  let at = vec2f(dot(U, vWorld), dot(V, vWorld));
  let gx = vec2f(dot(U, dPx), dot(V, dPx)); let gy = vec2f(dot(U, dPy), dot(V, dPy));
  let t = textureSampleGrad(mapT, mapS, at, i, gx, gy);
  let b = textureSampleGrad(bumpT, bumpS, at, i, gx, gy).xyz * 2.0 - 1.0;
  let Tv = normalize(vec3f(U.xy, -dot(U.xy, n.xy) / n.z)); let Bv = normalize(vec3f(V.xy, -dot(V.xy, n.xy) / n.z));
  let L = normalize(vec3f(dot(P.sunDir, Tv), dot(P.sunDir, Bv), dot(P.sunDir, n)));
  let h = normalize(toEye + P.sunDir); let H = normalize(vec3f(dot(h, Tv), dot(h, Bv), dot(h, n)));
  var shine = clamp(dot(b, H), 0.0, 1.0); shine *= shine; shine *= shine; shine *= shine; shine *= shine;
  return t.rgb * (P.sunColor * clamp(dot(b, L), 0.0, 1.0) + soft) * T.matDiffuse[i].xyz + t.a * shine * 0.5 * P.sunColor * T.matSpecular[i].xyz;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  vWorld = v.vWorld;
  n = normalize(v.vNormal); toEye = normalize(P.cameraPosition - vWorld);
  dPx = dpdx(vWorld); dPy = dpdy(vWorld);
  soft = P.ambient + P.fillColor * max(dot(n, P.fillDir), 0.0);
  let cl = textureSample(cloudsT, cloudsS, (vWorld.xy + T.cloudAt.xy) / T.cloudAt.z).rgb;
  let seen = textureSample(fogT, fogS, vWorld.xy / T.side.x).r;
  let Ly = v.vLayers;
  var c: vec3f;
  if (Ly.x == Ly.y && Ly.x == Ly.z && Ly.x == Ly.w) { c = layer(Ly.x); }
  else {
    var w = vec4f((1.0 - v.vCorner.x) * (1.0 - v.vCorner.y), v.vCorner.x * (1.0 - v.vCorner.y), (1.0 - v.vCorner.x) * v.vCorner.y, v.vCorner.x * v.vCorner.y);
    if (Ly.y == Ly.x) { w.x += w.y; w.y = 0.0; }
    if (Ly.z == Ly.x) { w.x += w.z; w.z = 0.0; } else if (Ly.z == Ly.y) { w.y += w.z; w.z = 0.0; }
    if (Ly.w == Ly.x) { w.x += w.w; w.w = 0.0; } else if (Ly.w == Ly.y) { w.y += w.w; w.w = 0.0; } else if (Ly.w == Ly.z) { w.z += w.w; w.w = 0.0; }
    c = vec3f(0.0);
    if (w.x > 0.004) { c += layer(Ly.x) * w.x; }
    if (w.y > 0.004) { c += layer(Ly.y) * w.y; }
    if (w.z > 0.004) { c += layer(Ly.z) * w.z; }
    if (w.w > 0.004) { c += layer(Ly.w) * w.w; }
  }
  c *= cl * sunlit(vWorld);
  let clear = select(1.0, clamp((P.fogRange.y - distance(P.cameraPosition, vWorld)) / max(1.0, P.fogRange.y - P.fogRange.x), 0.0, 1.0), P.fogRange.y > 0.0);
  return vec4f(mix(P.fogTint, c * v.vShade * mix(0.3, 1.0, seen), clear), 1.0);
}`;

const terrain = {
  name: 'terrain',
  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.texU && !!m.uniforms.bump && !!m.uniforms.cloudAt,
  key: () => 'terrain',
  code: terrainCode,
  attributes: () => ({
    vertex: [
      ['position', 3, 0],
      ['normal', 3, 1],
      ['layers', 4, 2],
      ['corner', 2, 3],
      ['shade', 1, 4]
    ],
    instance: []
  }),
  layout: [
    ...texBinding(0, 'float', '2d-array'),
    ...texBinding(2, 'float', '2d-array'),
    ...texBinding(4),
    ...texBinding(6),
    { binding: 8, visibility: 3, buffer: { type: 'uniform' } }
  ],
  textures: m => [m.uniforms.map.value, m.uniforms.bump.value, m.uniforms.clouds.value, m.uniforms.fog.value],
  block: {
    size: (TERRAIN_SLOTS * 4 + 2) * 16,
    fill(m, f) {
      const U = m.uniforms,
        S = TERRAIN_SLOTS * 4;
      for (let k = 0; k < TERRAIN_SLOTS; k++) {
        const u = U.texU.value[k],
          v = U.texV.value[k],
          d = U.matDiffuse.value[k],
          s = U.matSpecular.value[k];
        vec4(f, k * 4, u);
        vec4(f, S + k * 4, v);
        col3(f, 2 * S + k * 4, d);
        col3(f, 3 * S + k * 4, s);
      }
      const c = U.cloudAt.value;
      f[4 * S] = c.x;
      f[4 * S + 1] = c.y;
      f[4 * S + 2] = c.z;
      f[4 * S + 4] = num(U.side);
    }
  },
  params() {}
};

const particleCode = kind =>
  PASS_WGSL +
  `
struct Draw { model: mat4x4f, modelView: mat4x4f }
@group(1) @binding(0) var mapT: texture_2d<f32>;
@group(1) @binding(1) var mapS: sampler;
@group(1) @binding(2) var framesT: texture_2d<f32>;
@group(2) @binding(0) var<uniform> D: Draw;
struct VIn { @location(0) position: vec3f, @location(1) center: vec4f, @location(2) tint: vec4f, @location(3) cell: vec4f, @location(4) slot: f32 }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vTint: vec4f }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vTint = i.tint;
  o.vUv = (i.cell.xy + vec2f(i.position.x * 0.5 + 0.5, 0.5 - i.position.y * 0.5)) * i.cell.z;
  let c = cos(i.cell.w); let s = sin(i.cell.w);
  let corner = vec2f(i.position.x * c - i.position.y * s, i.position.x * s + i.position.y * c) * i.center.w;
  var at = i.center.xyz;
  if (i.slot >= 0.0) {
    let row = clamp(i32(i.slot + 0.5), 0, i32(textureDimensions(framesT).y) - 1);
    let fa = textureLoad(framesT, vec2i(0, row), 0); let fb = textureLoad(framesT, vec2i(1, row), 0);
    let cr = cos(fa.w); let sr = sin(fa.w); let co = cos(fb.x); let so = sin(fb.x);
    let lx = at.x * co + at.z * so; let lz = at.z * co - at.x * so;
    at = vec3f(fa.x + cr * lx - sr * at.y, fa.y + sr * lx + cr * at.y, fa.z + lz);
  }
  var mv = P.view * vec4f(at, 1.0); mv = vec4f(mv.xy + corner, mv.zw);
  o.pos = glDepth(P.proj * mv);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  ${
    kind === 'heat'
      ? 'let t = textureSample(mapT, mapS, v.vUv); return vec4f(t.rg, 0.0, t.a * v.vTint.a);'
      : kind === 'add'
        ? 'let t = textureSample(mapT, mapS, v.vUv) * v.vTint; return vec4f(t.rgb * t.a, 1.0);'
        : 'return textureSample(mapT, mapS, v.vUv) * v.vTint;'
  }
}`;
const particleKind = m =>
  m.fragmentShader.includes('t.rg, 0.0') ? 'heat' : m.fragmentShader.includes('t.rgb * t.a, 1.0') ? 'add' : 'normal';
const particles = {
  name: 'particles',
  match: m =>
    m.isShaderMaterial &&
    !!m.uniforms &&
    !!m.uniforms.frames &&
    m.vertexShader.startsWith('attribute vec4 center; attribute vec4 tint; attribute vec4 cell; attribute float slot;'),
  key: m => 'particles|' + particleKind(m),
  code: m => particleCode(particleKind(m)),
  attributes: () => ({
    vertex: [['position', 3, 0]],
    instance: [
      ['center', 4, 1],
      ['tint', 4, 2],
      ['cell', 4, 3],
      ['slot', 1, 4]
    ]
  }),
  layout: [...texBinding(0), { binding: 2, visibility: 3, texture: { sampleType: 'unfilterable-float' } }],
  textures: m => [m.uniforms.map.value, m.uniforms.frames.value],
  params() {}
};

const basicCode = (map, instanced, opaque) =>
  PASS_WGSL +
  `
struct Draw { model: mat4x4f, modelView: mat4x4f, diffuse: vec4f, uv0: vec4f, uv1: vec4f, uv2: vec4f }
@group(1) @binding(0) var mapT: texture_2d<f32>;
@group(1) @binding(1) var mapS: sampler;
@group(2) @binding(0) var<uniform> D: Draw;
struct VIn { @location(0) position: vec3f, ${map ? '@location(1) uv: vec2f,' : ''} ${instanced ? '@location(8) im0: vec4f, @location(9) im1: vec4f, @location(10) im2: vec4f, @location(11) im3: vec4f,' : ''} }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  ${map ? 'o.vUv = (mat3x3f(D.uv0.xyz, D.uv1.xyz, D.uv2.xyz) * vec3f(i.uv, 1.0)).xy;' : 'o.vUv = vec2f(0.0);'}
  var mv = vec4f(i.position, 1.0);
  ${instanced ? 'mv = mat4x4f(i.im0, i.im1, i.im2, i.im3) * mv;' : ''}
  mv = D.modelView * mv;
  o.pos = glDepth(P.proj * mv);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  var c = D.diffuse;
  ${map ? 'c *= textureSample(mapT, mapS, v.vUv);' : ''}
  ${opaque ? 'c.a = 1.0;' : ''}
  return c;
}`;
const basicOpaque = m => !m.transparent && m.blending === THREE.NormalBlending;
const basic = {
  name: 'basic',
  match: m =>
    m.isMeshBasicMaterial &&
    !m.vertexColors &&
    !m.alphaMap &&
    !m.envMap &&
    !m.lightMap &&
    !m.aoMap &&
    !m.specularMap &&
    !m.alphaTest &&
    !m.wireframe,
  key: (m, instanced) => 'basic|' + (m.map ? 'M' : '') + (instanced ? 'I' : '') + (basicOpaque(m) ? 'O' : ''),
  code: (m, instanced) => basicCode(!!m.map, instanced, basicOpaque(m)),
  attributes: (m, instanced) => ({
    vertex: m.map
      ? [
          ['position', 3, 0],
          ['uv', 2, 1]
        ]
      : [['position', 3, 0]],
    instance: instanced ? [['instanceMatrix', 16, 8]] : []
  }),
  layout: texBinding(0),
  textures: m => [m.map],
  params(m, f, o) {
    col3(f, o, m.color);
    f[o + 3] = m.opacity;
    const t = m.map;
    if (t) {
      if (t.matrixAutoUpdate) t.updateMatrix();
      const e = t.matrix.elements;
      f[o + 4] = e[0];
      f[o + 5] = e[1];
      f[o + 6] = e[2];
      f[o + 8] = e[3];
      f[o + 9] = e[4];
      f[o + 10] = e[5];
      f[o + 12] = e[6];
      f[o + 13] = e[7];
      f[o + 14] = e[8];
    }
  }
};

const SIZE = { f: [4, 4], v2: [8, 8], c3: [12, 16], v4: [16, 16], m4: [64, 16] };
export function simple(spec) {
  const fields = [],
    at = [];
  let o = 128;
  for (const [name, kind] of spec.params || []) {
    const [sz, al] = SIZE[kind];
    o = Math.ceil(o / al) * al;
    at.push([name, kind, o / 4 - PARAMS]);
    fields.push(`${name}: ${{ f: 'f32', v2: 'vec2f', c3: 'vec3f', v4: 'vec4f', m4: 'mat4x4f' }[kind]}`);
    o += sz;
  }
  if (o > 256) throw new Error(spec.name + ': block too large');
  const tex = (spec.textures || [])
    .map((t, i) => `@group(1) @binding(${i * 2}) var ${t}T: texture_2d<f32>;\n@group(1) @binding(${i * 2 + 1}) var ${t}S: sampler;`)
    .join('\n');
  const head =
    PASS_WGSL +
    `struct Draw { model: mat4x4f, modelView: mat4x4f, ${fields.join(', ')}${fields.length ? ',' : ''} }\n${tex}\n@group(2) @binding(0) var<uniform> D: Draw;\n`;
  return {
    name: spec.name,
    match: spec.match,
    key: (m, instanced) => spec.name + (instanced ? '|I' : '') + (spec.variant ? '|' + spec.variant(m) : ''),
    code: (m, instanced) => head + spec.code(m, instanced),
    attributes: (m, instanced) => ({
      vertex: spec.vertex(m),
      instance: spec.perInstance || (instanced ? spec.instance || [['instanceMatrix', 16, 8]] : [])
    }),
    layout: (spec.textures || []).flatMap((t, i) => texBinding(i * 2)),
    textures: m => (spec.textures || []).map(t => m.uniforms[t] && m.uniforms[t].value),
    params(m, f, base) {
      const U = m.uniforms;
      for (const [name, kind, k] of at) {
        const v = U[name] && U[name].value;
        if (kind === 'f') f[base + k] = +v || 0;
        else if (kind === 'c3') col3(f, base + k, v);
        else if (kind === 'v2') {
          f[base + k] = v ? v.x : 0;
          f[base + k + 1] = v ? v.y : 0;
        } else if (kind === 'm4') {
          if (v) v.toArray(f, base + k);
        } else vec4(f, base + k, v);
      }
    }
  };
}

const decals = simple({
  name: 'decals',
  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.sheet && !!m.uniforms.strip0,
  params: [['sunDir', 'c3']],
  textures: ['sheet', 'strip0', 'strip1', 'strip2', 'strip3', 'strip4'],
  vertex: () => [
    ['position', 3, 0],
    ['uv', 2, 1]
  ],
  instance: [
    ['instanceMatrix', 16, 8],
    ['uvRect', 4, 2],
    ['look', 3, 3]
  ],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f, @location(2) uvRect: vec4f, @location(3) look: vec3f,
  @location(8) im0: vec4f, @location(9) im1: vec4f, @location(10) im2: vec4f, @location(11) im3: vec4f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vLook: vec3f, @location(2) vT: vec3f, @location(3) vB: vec3f, @location(4) vN: vec3f, @location(5) vFlip: f32 }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vUv = i.uvRect.xy + i.uv * i.uvRect.zw; o.vLook = i.look; o.vFlip = sign(i.uvRect.w);
  let im = mat4x4f(i.im0, i.im1, i.im2, i.im3);
  let m = mat3x3f(im[0].xyz, im[1].xyz, im[2].xyz);
  o.vT = normalize(m[0]); o.vB = normalize(m[1]); o.vN = normalize(cross(m[0], m[1]));
  o.pos = glDepth(P.proj * P.view * D.model * im * vec4f(i.position, 1.0));
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t0 = textureSample(sheetT, sheetS, v.vUv);
  let t1 = textureSample(strip0T, strip0S, v.vUv.yx); let t2 = textureSample(strip1T, strip1S, v.vUv.yx);
  let t3 = textureSample(strip2T, strip2S, v.vUv.yx); let t4 = textureSample(strip3T, strip3S, v.vUv.yx);
  let t5 = textureSample(strip4T, strip4S, v.vUv.yx);
  let strip = v.vLook.z > 0.5;
  var t: vec4f;
  if (!strip) { t = t0; } else if (v.vLook.z < 1.5) { t = t1; } else if (v.vLook.z < 2.5) { t = t2; } else if (v.vLook.z < 3.5) { t = t3; } else if (v.vLook.z < 4.5) { t = t4; } else { t = t5; }
  var a = t.a * v.vLook.x;
  var f: f32;
  if (v.vLook.y > 0.5) {
    var n = t.xyz * 2.0 - 1.0;
    if (strip) { n = vec3f(n.y, n.x, n.z); } else { n = vec3f(n.xy * vec2f(-1.0, -v.vFlip), n.z); }
    let dent = clamp(length(n.xy) * 2.5, 0.0, 1.0);
    let N = normalize(v.vT * n.x + v.vB * n.y + v.vN * n.z);
    f = clamp(dot(N, D.sunDir) / max(0.25, dot(v.vN, D.sunDir)), 0.0, 2.0);
    a *= select(1.0, dent, strip);
    f = mix(1.0, f * 0.92, a);
  } else { f = mix(1.0, 0.1, a); }
  if (abs(f - 1.0) < 0.004) { discard; }
  return vec4f(vec3f(f * 0.5), 1.0);
}`
});

const shield = simple({
  name: 'shield',
  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.waveMap && !!m.uniforms.distortMap && !!m.uniforms.hitPos,
  variant: m => (m.defines && m.defines.USE_VCOLOR ? 'C' : ''),
  params: [
    ['tint', 'c3'],
    ['edgeBrightness', 'f'],
    ['hitPos', 'c3'],
    ['baseScale', 'f'],
    ['waveScale', 'f'],
    ['distortScale', 'f'],
    ['baseScroll', 'f'],
    ['waveScroll', 'f'],
    ['distortScroll', 'f'],
    ['time', 'f'],
    ['flash', 'f'],
    ['hitRadius', 'f'],
    ['opacity', 'f'],
    ['steady', 'f']
  ],
  textures: ['map', 'waveMap', 'distortMap'],
  vertex: m => [['position', 3, 0], ['normal', 3, 1], ['uv', 2, 2], ...(m.defines && m.defines.USE_VCOLOR ? [['color', 4, 3]] : [])],
  code: m => {
    const C = !!(m.defines && m.defines.USE_VCOLOR);
    return `
struct VIn { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f, ${C ? '@location(3) color: vec4f,' : ''} }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vNormal: vec3f, @location(2) vWorldPos: vec3f, @location(4) vNz: f32, ${C ? '@location(3) vColor: vec4f,' : ''} }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vUv = i.uv;
  o.vNz = i.normal.z;
  let wp = D.model * vec4f(i.position, 1.0);
  o.vWorldPos = wp.xyz;
  o.vNormal = mat3x3f(D.model[0].xyz, D.model[1].xyz, D.model[2].xyz) * i.normal;
  ${C ? 'o.vColor = i.color;' : ''}
  o.pos = glDepth(P.proj * P.view * wp);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let sd = textureSample(distortMapT, distortMapS, vec2f(v.vUv.x * D.waveScale, v.vUv.y * D.waveScale + D.time * D.waveScroll));
  let sb = textureSample(mapT, mapS, vec2f(v.vUv.x * D.baseScale, v.vUv.y * D.baseScale + D.time * D.baseScroll) + sd.xy * 0.25);
  let sw = textureSample(waveMapT, waveMapS, vec2f(v.vUv.x * D.distortScale, v.vUv.y * D.distortScale + D.time * D.distortScroll));
  var sc = sb.rgb * sw.rgb * D.tint * clamp(v.vNz + D.edgeBrightness, 0.0, 1.0);
  ${C ? 'sc *= v.vColor.rgb;' : ''}
  if (D.steady > 0.5) { return vec4f(sc * D.opacity, 1.0); }
  let ripple = textureSample(distortMapT, distortMapS, v.vUv * D.distortScale + vec2f(0.0, D.time * D.distortScroll)).rg * 2.0 - 1.0;
  let base = textureSample(mapT, mapS, v.vUv * D.baseScale + vec2f(D.time * D.baseScroll, 0.0) + ripple * 0.08);
  let wave = textureSample(waveMapT, waveMapS, v.vUv * D.waveScale + vec2f(0.0, D.time * D.waveScroll) + ripple * 0.03);
  let n = normalize(v.vNormal); let vv = normalize(P.cameraPosition - v.vWorldPos);
  let rim = pow(1.0 - abs(dot(n, vv)), 2.0);
  let dp = v.vWorldPos - D.hitPos;
  let near = 0.3 + 1.1 * exp(-dot(dp, dp) / (D.hitRadius * D.hitRadius));
  let energy = max(wave.r, max(wave.g, wave.b)) * 0.9 + rim * (0.35 + D.edgeBrightness * 1.6) + 0.08;
  var col = base.rgb * D.tint * energy * near;
  ${C ? 'col *= v.vColor.rgb * v.vColor.a;' : ''}
  return vec4f(col * D.flash * D.opacity, 1.0);
}`;
  }
});

const skydome = simple({
  name: 'skydome',
  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.clouds && !!m.uniforms.cloudScale && !!m.uniforms.cloudRate,
  params: [
    ['cloudScale', 'f'],
    ['cloudRate', 'f'],
    ['time', 'f']
  ],
  textures: ['map', 'clouds'],
  vertex: () => [
    ['position', 3, 0],
    ['uv', 2, 1]
  ],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = i.uv; o.pos = glDepth(P.proj * D.modelView * vec4f(i.position, 1.0)); return o; }
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let base = textureSample(mapT, mapS, v.vUv).rgb;
  let c = textureSample(cloudsT, cloudsS, v.vUv * D.cloudScale + vec2f(D.time * D.cloudRate, 0.0));
  return vec4f(base + c.rgb * c.a * 0.35, 1.0);
}`
});

const glowLines = (name, n, test) =>
  simple({
    name,
    textures: ['map'],
    match: m =>
      m.isShaderMaterial && !!m.uniforms && !!m.uniforms.map && Object.keys(m.uniforms).length === 1 && m.vertexShader.startsWith(test),
    vertex: () => [
      ['position', 3, 0],
      ['uv', 2, 1],
      ['color', n, 2]
    ],
    code: () => `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f, @location(2) color: ${n === 3 ? 'vec3f' : 'vec4f'} }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vColor: ${n === 3 ? 'vec3f' : 'vec4f'} }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vColor = i.color; o.vUv = i.uv; o.pos = glDepth(P.proj * D.modelView * vec4f(i.position, 1.0)); return o; }
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = textureSample(mapT, mapS, v.vUv);
  return ${n === 3 ? 'vec4f(t.rgb * v.vColor * t.a, 1.0)' : 'vec4f(t.rgb * v.vColor.rgb * v.vColor.a, 1.0)'};
}`
  });
const pills = glowLines('pills', 3, 'attribute vec3 color; varying vec3 vColor; varying vec2 vUv;');
const bolts = glowLines('bolts', 4, 'attribute vec4 color; varying vec4 vColor; varying vec2 vUv;');

const ghost = simple({
  name: 'ghost',
  params: [['tint', 'c3']],
  match: m => m.isShaderMaterial && m.vertexShader.startsWith('varying vec3 vN, vP; void main() { vec4 wp = modelMatrix'),
  vertex: () => [
    ['position', 3, 0],
    ['normal', 3, 1]
  ],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) normal: vec3f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vN: vec3f, @location(1) vP: vec3f }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  let wp = D.model * vec4f(i.position, 1.0); o.vP = wp.xyz; o.vN = mat3x3f(D.model[0].xyz, D.model[1].xyz, D.model[2].xyz) * i.normal;
  o.pos = glDepth(P.proj * P.view * wp);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let f = abs(dot(normalize(v.vN), normalize(P.cameraPosition - v.vP)));
  return vec4f(D.tint * (0.55 + 0.75 * (1.0 - f)), 0.3 + 0.4 * (1.0 - f));
}`
});

const SHEET_WGSL = `

struct VIn { @location(0) position: vec3f, @location(1) depth: f32 }

struct VOut { @builtin(position) pos: vec4f, @location(0) vWorld: vec3f, @location(1) vMirror: vec4f, @location(2) vDepth: f32 }

fn sheetHaze(at: vec3f) -> f32 { return select(1.0, clamp((P.fogRange.y - distance(P.cameraPosition, at)) / max(1.0, P.fogRange.y - P.fogRange.x), 0.0, 1.0), P.fogRange.y > 0.0); }

fn slide(vWorld: vec3f, r: vec4f, aside: f32) -> vec2f {

  return vec2f((vWorld.x * cos(r.y) + vWorld.y * sin(r.y)) / r.x + r.z * cos(r.w + aside) * D.time, vWorld.y * cos(r.y) / r.x + r.z * sin(r.w + aside) * D.time);

}

`;

const sheetVS = mirror => `

@vertex fn vs(i: VIn) -> VOut {

  var o: VOut;

  o.vWorld = i.position; o.vDepth = i.depth; o.vMirror = ${mirror ? 'D.mirror * vec4f(i.position, 1.0)' : 'vec4f(0.0)'};

  o.pos = glDepth(P.proj * D.modelView * vec4f(i.position, 1.0));

  return o;

}`;

const SHORE_WGSL = `fn shoreAlpha(depth: f32) -> f32 { return clamp(D.shore.y + (1.0 - D.shore.y) * clamp(depth * D.shore.x, 0.0, 1.0), 0.0, 1.0); }`;

const sheetVertex = () => [
  ['position', 3, 0],
  ['depth', 1, 1]
];

const waterUnder = simple({
  name: 'waterUnder',

  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.under && !!m.uniforms.shore,

  params: [
    ['under', 'c3'],
    ['time', 'f'],
    ['shore', 'v2']
  ],

  vertex: sheetVertex,

  code: () =>
    SHEET_WGSL +
    SHORE_WGSL +
    sheetVS(false) +
    `

@fragment fn fs(v: VOut) -> @location(0) vec4f { let a = shoreAlpha(v.vDepth) * sheetHaze(v.vWorld); return vec4f(vec3f(1.0 - a) + a * D.under, 1.0); }`
});

const waterOver = simple({
  name: 'waterOver',

  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.over && !!m.uniforms.ripple,

  params: [
    ['mirror', 'm4'],
    ['over', 'c3'],
    ['bend', 'f'],
    ['ripple', 'v4'],
    ['side', 'f'],
    ['time', 'f'],
    ['shore', 'v2']
  ],

  textures: ['bump', 'reflection', 'fog'],

  vertex: sheetVertex,

  code: () =>
    SHEET_WGSL +
    SHORE_WGSL +
    sheetVS(true) +
    `

@fragment fn fs(v: VOut) -> @location(0) vec4f {

  let d = (textureSample(bumpT, bumpS, slide(v.vWorld, D.ripple, -0.7853982)).xy - 0.5) * 2.0 + (textureSample(bumpT, bumpS, slide(v.vWorld, D.ripple, 0.7853982)).xy - 0.5) * 2.0;

  let r = textureSample(reflectionT, reflectionS, clamp((v.vMirror.xy + d * D.bend * 200.0) / v.vMirror.w, vec2f(0.002), vec2f(0.998))).rgb;

  let seen = mix(0.3, 1.0, textureSample(fogT, fogS, v.vWorld.xy / D.side).r);

  return vec4f(r * D.over * shoreAlpha(v.vDepth) * seen * sheetHaze(v.vWorld), 1.0);

}`
});

const lava = simple({
  name: 'lava',

  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.crust && !!m.uniforms.flow,

  params: [
    ['flow', 'v4'],
    ['lie', 'v4'],
    ['glint', 'c3'],
    ['side', 'f'],
    ['time', 'f']
  ],

  textures: ['base', 'crust', 'bump', 'fog'],

  vertex: sheetVertex,

  code: () =>
    SHEET_WGSL +
    sheetVS(false) +
    `

@fragment fn fs(v: VOut) -> @location(0) vec4f {

  let at = slide(v.vWorld, D.lie, 0.0);

  let c = textureSample(crustT, crustS, at); let n = textureSample(bumpT, bumpS, at).xyz * 2.0 - 1.0;

  let h = normalize(normalize(P.cameraPosition - v.vWorld) + P.sunDir);

  let s = clamp(dot(n, h), 0.0, 1.0);

  let lit = c.rgb * (P.sunColor * clamp(dot(n, P.sunDir), 0.0, 1.0) + P.ambient) + D.glint * P.sunColor * 0.5 * s * s * s * s * s;

  let seen = mix(0.3, 1.0, textureSample(fogT, fogS, v.vWorld.xy / D.side).r);

  let flowed = textureSample(baseT, baseS, slide(v.vWorld, D.flow, 0.0)).rgb;

  return vec4f(mix(P.fogTint, mix(flowed, lit, c.a) * seen, sheetHaze(v.vWorld)), 1.0);

}`
});

const ice = simple({
  name: 'ice',

  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.lie && !!m.uniforms.reflection && !m.uniforms.crust,

  params: [
    ['mirror', 'm4'],
    ['flow', 'v4'],
    ['lie', 'v4'],
    ['tint', 'c3'],
    ['bend', 'f'],
    ['side', 'f'],
    ['time', 'f']
  ],

  textures: ['base', 'bump', 'reflection', 'fog'],

  vertex: sheetVertex,

  code: () =>
    SHEET_WGSL +
    sheetVS(true) +
    `

@fragment fn fs(v: VOut) -> @location(0) vec4f {

  let n = textureSample(bumpT, bumpS, slide(v.vWorld, D.lie, 0.0)).xyz * 2.0 - 1.0;

  let c = textureSample(baseT, baseS, slide(v.vWorld, D.flow, 0.0));

  let lit = c.rgb * (P.sunColor * D.tint * clamp(dot(n, P.sunDir), 0.0, 1.0) + P.ambient);

  let r = textureSample(reflectionT, reflectionS, clamp(v.vMirror.xy / v.vMirror.w + n.xy * D.bend, vec2f(0.002), vec2f(0.998))).rgb;

  let seen = mix(0.3, 1.0, textureSample(fogT, fogS, v.vWorld.xy / D.side).r);

  return vec4f(mix(P.fogTint, mix(lit, r, c.a) * seen, sheetHaze(v.vWorld)), 1.0);

}`
});

const onlyLaser = m =>
  !!m.uniforms && Object.keys(m.uniforms).length === 3 && 'map' in m.uniforms && 'zScale' in m.uniforms && 'depthSpan' in m.uniforms;
const LASER_HEAD =
  'attribute vec4 center; attribute vec4 dir; attribute vec4 cell; attribute vec3 tint; uniform float zScale; uniform vec2 depthSpan;';
const laserIn = `
struct VIn { @location(0) position: vec3f, @location(1) center: vec4f, @location(2) dir: vec4f, @location(3) cell: vec4f, @location(4) tint: vec3f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vTint: vec3f }`;
const laserOut = `
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = textureSample(mapT, mapS, v.vUv);
  return vec4f(t.rgb * v.vTint * t.a, 1.0);
}`;
const laserBeam = simple({
  name: 'laserBeam',
  textures: ['map'],
  params: [
    ['zScale', 'f'],
    ['depthSpan', 'v2']
  ],
  match: m => m.isShaderMaterial && onlyLaser(m) && m.name === 'laserBeam' && m.vertexShader.startsWith(LASER_HEAD),
  vertex: () => [['position', 3, 0]],
  perInstance: [
    ['center', 4, 1],
    ['dir', 4, 2],
    ['cell', 4, 3],
    ['tint', 3, 4]
  ],
  code: () =>
    laserIn +
    `
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vTint = i.tint;
  let h = P.view * vec4f(i.center.xyz, 1.0); let f = normalize((P.view * vec4f(i.dir.xyz, 0.0)).xyz);
  let s = i.dir.w * max(0.0, 1.0 + (max(0.0, -h.z) * D.depthSpan.x - D.depthSpan.y) * D.zScale);
  let A = h.xyz + f * i.center.w * 0.5; let B = h.xyz - f * i.center.w * 0.5;
  let sd = B.xy - A.xy; let sl = length(sd); let p = vec3f(select(vec2f(1.0, 0.0), vec2f(-sd.y, sd.x) / sl, sl > 1e-5), 0.0);
  let c = i32(i.position.x + 0.5);
  var P3 = B - f * s; var uv = vec2f(0.0, 1.0);
  if (c == 0) { P3 = A + f * s; uv = vec2f(1.0, 0.0); } else if (c == 1) { P3 = A + p * s; uv = vec2f(0.5, 0.0); } else if (c == 2) { P3 = A - p * s; uv = vec2f(1.0, 0.5); }
  else if (c == 3) { P3 = B + p * s; uv = vec2f(0.0, 0.5); } else if (c == 4) { P3 = B - p * s; uv = vec2f(0.5, 1.0); }
  o.vUv = i.cell.xy + uv * i.cell.z;
  o.pos = glDepth(P.proj * vec4f(P3, 1.0));
  return o;
}` +
    laserOut
});
const laserKite = simple({
  name: 'laserKite',
  textures: ['map'],
  params: [
    ['zScale', 'f'],
    ['depthSpan', 'v2']
  ],
  match: m => m.isShaderMaterial && onlyLaser(m) && m.name === 'laserKite' && m.vertexShader.startsWith(LASER_HEAD),
  vertex: () => [['position', 3, 0]],
  perInstance: [
    ['center', 4, 1],
    ['dir', 4, 2],
    ['cell', 4, 3],
    ['tint', 3, 4]
  ],
  code: () =>
    laserIn +
    `
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vTint = i.tint;
  let h = P.view * vec4f(i.center.xyz, 1.0); let f = (P.view * vec4f(i.dir.xyz, 0.0)).xyz;
  let s = i.dir.w * max(0.0, 1.0 + (max(0.0, -h.z) * D.depthSpan.x - D.depthSpan.y) * D.zScale);
  let fl = length(f.xy); let back = select(vec2f(0.0, -1.0), -f.xy / fl, fl > 1e-5); let side = vec2f(-back.y, back.x);
  let k = max(1.0, i.center.w * fl);
  let c = i32(i.position.x + 0.5);
  var off = -back * s; var uv = vec2f(1.0, 1.0);
  if (c == 0) { off = side * s; uv = vec2f(0.0, 1.0); } else if (c == 1) { off = back * s * k; uv = vec2f(0.0, 0.0); } else if (c == 2) { off = -side * s; uv = vec2f(1.0, 0.0); }
  o.vUv = i.cell.xy + uv * i.cell.z;
  o.pos = glDepth(P.proj * vec4f(h.xy + off, h.z, 1.0));
  return o;
}` +
    laserOut
});

export const families = [
  model,
  terrain,
  particles,
  basic,
  decals,
  shield,
  skydome,
  pills,
  bolts,
  ghost,
  waterUnder,
  waterOver,
  lava,
  ice,
  laserBeam,
  laserKite
];
