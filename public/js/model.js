import { diag } from './diag.js';
import * as THREE from '../vendor/three/build/three.module.js';
import { loadALO } from './alo.js';
import { loadTexture, whiteTexture } from './dds.js';
import { rockTextures, rockBake } from './rockbake.js';
import { gfx } from './gfx.js';
import { planetVertex, planetFragment } from './planetshader.js';
import { effectInfo, effectLOD, selectEffectTechnique } from './fxo.js';
import { fetchBinary } from './vfs.js';
import { planetEnvironment } from './planetlighting.js';

const noShadow = new THREE.DepthTexture(1, 1);
noShadow.compareFunction = THREE.LessEqualCompare;
noShadow.magFilter = noShadow.minFilter = THREE.LinearFilter;
noShadow.needsUpdate = true;

export const lighting = {
  sunDir: { value: new THREE.Vector3(0.4, -0.5, 0.75).normalize() },
  sunColor: { value: new THREE.Color(1.0, 0.98, 0.94) },
  sunSpecular: { value: new THREE.Color(2, 1.96, 1.88) },
  fillDir: { value: new THREE.Vector3(-0.6, 0.5, 0.3).normalize() },
  fillColor: { value: new THREE.Color(0.25, 0.28, 0.36) },
  fillDir2: { value: new THREE.Vector3(0, 0, 1) },
  fillColor2: { value: new THREE.Color(0, 0, 0) },
  ambient: { value: new THREE.Color(0.32, 0.32, 0.36) },
  shadowMap: { value: noShadow },
  shadowMatrix: { value: new THREE.Matrix4() },
  shadowOn: { value: 0 },
  shadowTexel: { value: 1 / 2048 },
  fogTint: { value: new THREE.Color(0.8, 0.8, 0.8) },
  fogRange: { value: new THREE.Vector2(0, 0) },
  fowMap: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat); t.needsUpdate = true; return t; })() },
  fowSide: { value: 0 },
};
const lightingAtStart = Object.fromEntries(Object.entries(lighting).map(([k, u]) => [k, u.value?.isTexture || typeof u.value !== 'object' ? u.value : u.value.clone()]));
export function resetLighting() {
  for (const [k, v] of Object.entries(lightingAtStart)) {
    const u = lighting[k];
    if (v?.isTexture || typeof v !== 'object') u.value = v;
    else if (u.value?.constructor === v.constructor) u.value.copy(v);
    else u.value = v.clone();
  }
}

export const planetLighting = {
  sunDir:{value:new THREE.Vector3(0,0,1)},sunColor:{value:new THREE.Color(.5,.5,.5)},sunSpecular:{value:new THREE.Color(1,1,1)},
  fillDir:{value:new THREE.Vector3(0,0,1)},fillColor:{value:new THREE.Color(0,0,0)},fillDir2:{value:new THREE.Vector3(0,0,1)},fillColor2:{value:new THREE.Color(0,0,0)},ambient:{value:new THREE.Color(.05,.05,.05)},
};
export function setPlanetEnvironment(env) {
  if(!env)return;for(const [key,value]of Object.entries(planetEnvironment(env)))planetLighting[key].value.fromArray(value);
}

const SKIP = /collision|shadowvolume|lightvisualize|meshheat/;
const ADDITIVE = /additive|nebula|meshshield/;
const FOW_DIMMED = /^(terrainmeshgloss|terrainmeshbump|batchmeshgloss|batchmeshalpha|grass)\.fx$/;
const ALPHA = /alpha|tree\.fx|grass/;
const UNLIT = /skydome|nebula/;

const VERT = `
attribute vec3 tangent;
attribute vec3 binormal;
#ifdef USE_VCOLOR
attribute vec4 color;
varying vec4 vColor;
#endif
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBinormal;
varying vec3 vWorldPos;
#ifdef DETAIL
varying vec3 vObjPos;
#endif
varying vec4 vTint;
#ifdef USE_INSTANCING
attribute vec4 instanceTint;
#endif
uniform vec2 uvScroll;
#ifdef NATIVE_MESH_ADDITIVE
uniform vec2 uvScrollRate;
uniform float time;
#endif
#ifdef NEBULA
uniform vec3 nebulaWave;
varying vec3 vShade;
#endif
#ifdef SKINNED
attribute vec4 skinIndex;
attribute vec4 skinWeight;
#ifdef INSTSKIN
uniform highp sampler2D boneTex;
mat4 boneAt(float b) { int x = int(b) * 4, y = gl_InstanceID; return mat4(texelFetch(boneTex, ivec2(x, y), 0), texelFetch(boneTex, ivec2(x + 1, y), 0), texelFetch(boneTex, ivec2(x + 2, y), 0), texelFetch(boneTex, ivec2(x + 3, y), 0)); }
#else
uniform mat4 boneMatrices[24];
mat4 boneAt(float b) { return boneMatrices[int(b)]; }
#endif
#endif
void main() {
  vUv = uv + uvScroll;
#ifdef NATIVE_MESH_ADDITIVE
  vUv += time * uvScrollRate;
#endif
#ifdef SKINNED
  mat4 skin = boneAt(skinIndex.x) * skinWeight.x + boneAt(skinIndex.y) * skinWeight.y
            + boneAt(skinIndex.z) * skinWeight.z + boneAt(skinIndex.w) * skinWeight.w;
  mat4 mm = modelMatrix * skin;
#else
  mat4 mm = modelMatrix;
#endif
#ifdef USE_INSTANCING
  mm = modelMatrix * instanceMatrix;
#ifdef SKINNED
  mm = mm * skin;
#endif
  vTint = instanceTint;
#else
  vTint = vec4(0.0);
#endif
#ifdef NEBULA
  vec3 wave = sin(6.2831853 * (nebulaWave.y * (mm * vec4(position, 1.0)).xyz + time * nebulaWave.z));
  vec4 wp = mm * vec4(position + nebulaWave.x * wave, 1.0);
  vec3 vn = normalize(mat3(viewMatrix) * (mat3(mm) * normal));
  float facing = vn.z * vn.z; facing *= facing; facing *= facing;
  #ifdef USE_VCOLOR
  vShade = clamp(color.rgb * (2.0 * facing + 0.1), 0.0, 1.0);
  #else
  vShade = vec3(clamp(2.0 * facing + 0.1, 0.0, 1.0));
  #endif
#else
  vec4 wp = mm * vec4(position, 1.0);
#endif
  vWorldPos = wp.xyz;
#ifdef DETAIL
  vObjPos = position;
#endif
  mat3 nm = mat3(mm);
  vNormal = nm * normal;
  vTangent = nm * tangent;
  vBinormal = nm * binormal;
#ifdef USE_VCOLOR
  vColor = color;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = `
uniform sampler2D map;
uniform sampler2D normalMap;
#ifdef GLOSSMAP
uniform sampler2D glossMap;
#endif
uniform vec3 sunDir, sunColor, fillDir, fillColor, ambient;
#ifndef UNLIT
uniform highp sampler2DShadow shadowMap;
uniform mat4 shadowMatrix;
uniform float shadowOn, shadowTexel;
float sunlit(vec3 wp, vec3 n) {
  if (shadowOn < 0.5) return 1.0;
  vec3 p = (shadowMatrix * vec4(wp + n * 3.0, 1.0)).xyz;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float d = p.z - 0.0012, o = shadowTexel * 1.4;
  float s = texture(shadowMap, vec3(p.xy, d)) * 2.0;
  s += texture(shadowMap, vec3(p.xy + vec2(-o, -o), d));
  s += texture(shadowMap, vec3(p.xy + vec2(o, -o), d));
  s += texture(shadowMap, vec3(p.xy + vec2(-o, o), d));
  s += texture(shadowMap, vec3(p.xy + vec2(o, o), d));
  s /= 6.0;
  vec2 e = min(p.xy, 1.0 - p.xy);
  return mix(1.0, mix(0.38, 1.0, s), smoothstep(0.0, 0.06, min(e.x, e.y)));
}
#endif
uniform vec3 fogTint; uniform vec2 fogRange;
#ifdef FOW_DIM
uniform sampler2D fowMap; uniform float fowSide;
#endif
uniform float ghost;
uniform float dissolve;
uniform float alphaRef;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float haze(vec3 at) { return fogRange.y > 0.0 ? clamp((fogRange.y - distance(cameraPosition, at)) / max(1.0, fogRange.y - fogRange.x), 0.0, 1.0) : 1.0; }
uniform vec4 colorization;
uniform vec3 emissive, diffuse, specular;
uniform float shininess, opacity, glow;
uniform vec4 tint;
varying vec4 vTint;
varying vec2 vUv;
varying vec3 vNormal, vTangent, vBinormal, vWorldPos;
#ifdef USE_VCOLOR
varying vec4 vColor;
#endif
#ifdef NEBULA
varying vec3 vShade;
#endif
#ifdef DETAIL
varying vec3 vObjPos;
uniform float detailScale;
float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float dFbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * dNoise(p); p = p * 2.07 + 7.3; a *= 0.5; }
  return s;
}
float rock(vec3 p) {
  float ridges = 1.0 - abs(dFbm(p * 0.6) * 2.0 - 1.0);
  return dFbm(p) * 0.6 + ridges * ridges * 0.3 + dNoise(p * 6.0) * 0.1;
}
#endif
void main() {
  vec4 base = texture2D(map, vUv);
  vec3 albedo = base.rgb;
#ifdef COLORIZE
  albedo = mix(albedo, albedo * colorization.rgb * 1.25, base.a);
#endif
#ifdef UNLIT
  vec3 col = albedo * diffuse;
  float a = base.a;
  #ifdef USE_VCOLOR
  col *= vColor.rgb; a *= vColor.a;
  #endif
  #ifdef NEBULA
  gl_FragColor = vec4(albedo * vShade * opacity * glow * haze(vWorldPos), 1.0);
  #elif defined(NATIVE_MESH_ADDITIVE)
  gl_FragColor = vec4(col * opacity * glow * haze(vWorldPos), 1.0);
  #elif defined(ADDITIVE)
  gl_FragColor = vec4(col * a * opacity * glow * haze(vWorldPos), 1.0);
  #else
  gl_FragColor = vec4(mix(fogTint, col, haze(vWorldPos)), a * opacity);
  #endif
#else
  vec3 n = normalize(vNormal);
  float gloss = 0.25;
  #ifdef BUMP
  vec4 nt = texture2D(normalMap, vUv);
  vec3 tn = nt.xyz * 2.0 - 1.0;
  n = normalize(tn.x * normalize(vTangent) + tn.y * normalize(vBinormal) + tn.z * n);
  gloss = nt.a;
  #endif
  #ifdef GLOSS
  gloss = base.a;
  #endif
  #ifdef GLOSSMAP
  { vec3 gm = texture2D(glossMap, vUv).rgb; gloss = max(gm.r, max(gm.g, gm.b)); }
  #endif
  #ifdef DETAIL
  {
    vec3 q = vObjPos * detailScale;
    vec3 tu = normalize(vTangent), bv = normalize(vBinormal);
    vec3 ou = normalize(cross(n, vec3(0.31, 0.57, 0.76))), ov = cross(n, ou);
    float h = rock(q), hu = rock(q + ou * 0.35), hv = rock(q + ov * 0.35);
    n = normalize(n + (ou * (h - hu) + ov * (h - hv)) * 2.6);
    albedo *= 0.62 + 0.76 * h;
    albedo *= mix(vec3(1.0, 0.96, 0.9), vec3(0.9, 0.96, 1.04), dNoise(q * 0.35));
  }
  #endif
  if (!gl_FrontFacing) n = -n;
  float sun = sunlit(vWorldPos, normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0));
  vec3 light = ambient + sunColor * max(dot(n, sunDir), 0.0) * sun + fillColor * max(dot(n, fillDir), 0.0);
  vec3 v = normalize(cameraPosition - vWorldPos);
  float sp = pow(max(dot(n, normalize(sunDir + v)), 0.0), max(shininess, 1.0)) * sun;
  #ifdef NATIVE_MESH_GLOSS_EMISSIVE
  vec3 col = albedo * emissive * 2.0;
  #else
  vec3 col = albedo * (emissive + diffuse * light) + specular * sunColor * sp * gloss * 0.6;
  #endif
  col = mix(col, tint.rgb, tint.a);
  col = mix(col, vTint.rgb, vTint.a);
  if (ghost > 0.5 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;
  if (dissolve > 0.0 && bayer4(gl_FragCoord.xy) < dissolve) discard;
  #ifdef FOW_DIM
  if (fowSide > 0.0) col *= mix(0.3, 1.0, texture2D(fowMap, vWorldPos.xy / fowSide).r);
  #endif
  col = mix(fogTint, col, haze(vWorldPos));
  #ifdef ALPHA
  if (base.a * opacity <= alphaRef) discard;
  gl_FragColor = vec4(col, base.a * opacity);
  #else
  gl_FragColor = vec4(col, opacity);
  #endif
#endif
}`;

export const planetClock = { value: 0 };
let planetEffect = null;
function planetEffectInfo() {
  return planetEffect ||= Promise.all(['Data/Art/Shaders/Planet.fxo','Data/Art/Shaders/Engine/Global.fxo'].map(fetchBinary)).then(([bytes,global])=>{
    const effect=bytes?effectInfo(bytes):{samplers:new Map(),techniques:[]};
    const defaults=global?effectInfo(global):null;
    effect.globalSampler=defaults?.samplers.get('DefaultSampler')||new Map();
    effect.globalStates=defaults?.techniques.find(t=>t.name==='t0')?.passes.flatMap(p=>p.states)||[];
    return effect;
  });
}

function makePlanetMaterial(p) {
  const c3 = (v, d) => (v ? new THREE.Color(v[0], v[1], v[2]) : new THREE.Color(d, d, d));
  const detail=gfx.shader|0, requests=[];
  const definesFor=lod=>lod===0?{PLANET_FIXED:1}:lod===2?{PLANET_DX8:1}:{};
  const selected=planetEffectInfo().then(effect=>{
    const technique=selectEffectTechnique(effect,detail,{validate:t=>[0,2,3].includes(effectLOD(t.annotations.LOD))});
    const lod=technique?effectLOD(technique.annotations.LOD):detail>=3?3:detail>=2?2:0;
    m.defines=definesFor(lod);m.userData.planetTechnique=technique?.name||'';m.needsUpdate=true;
    return {effect,technique,lod};
  });
  const tex = (name, sampler, stage) => {
    const source = name ? loadTexture(name) : whiteTexture(), texture = source.clone();
    texture.userData = { ...source.userData };
    const ready=Promise.all([source.userData.ready,selected]).then(([, {effect,technique,lod}])=>{
      texture.copy(source);
      texture.isCompressedTexture = source.isCompressedTexture === true;
      texture.isDataTexture = source.isDataTexture === true;
      const fixedStates=[...effect.globalStates,...(technique?.passes.filter(p=>!p.annotations.AlamoCleanup).flatMap(p=>p.states)||[])];
      const states=lod===0?new Map([...effect.globalSampler,...fixedStates
        .filter(s=>s.index===stage&&s.value!==undefined).map(s=>[s.id,s.value])]):effect.samplers.get(sampler);
      const min=states?.get(0xaa)??2, mag=states?.get(0xa9)??2, mip=states?.get(0xab)??2;
      texture.anisotropy = min===3||mag===3 ? states?.get(0xae)??1 : 1;
      texture.magFilter = mag===1?THREE.NearestFilter:THREE.LinearFilter;
      texture.minFilter = mip===0||!texture.mipmaps?.length ? (min===1?THREE.NearestFilter:THREE.LinearFilter)
        : min===1 ? (mip===1?THREE.NearestMipmapNearestFilter:THREE.NearestMipmapLinearFilter)
        : mip===1?THREE.LinearMipmapNearestFilter:THREE.LinearMipmapLinearFilter;
      const wrap = value=>value===2?THREE.MirroredRepeatWrapping:value===3?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping;
      texture.wrapS=wrap(states?.get(0xa5));texture.wrapT=wrap(states?.get(0xa6));texture.needsUpdate=true;
      texture.userData.ready=ready;
    });
    texture.userData.ready=ready;requests.push(ready);return texture;
  };
  const m=new THREE.ShaderMaterial({
    vertexShader: planetVertex, fragmentShader: planetFragment, defines:definesFor(detail>=3?3:detail>=2?2:0),
    uniforms: {
      ...planetLighting,
      map: { value: tex(p.BaseTexture, 'BaseSampler',0) }, normalMap: { value: tex(p.NormalTexture, 'NormalSampler') },
      cloudMap: { value: tex(p.CloudTexture, 'CloudSampler',1) }, cloudNormalMap: { value: tex(p.CloudNormalTexture, 'CloudNormalSampler') },
      emissive: { value: c3(p.Emissive, 0) }, diffuse: { value: c3(p.Diffuse, 1) }, specular: { value: c3(p.Specular, 1) },
      atmosphere: { value: new THREE.Vector4(...(p.Atmosphere || [0,0,0,1])) }, cityColor: { value: c3(p.CityColor, 1) },
      atmospherePower: { value: p.AtmospherePower ?? 4.5 }, cloudScroll: { value: p.CloudScrollRate ?? .0025 },
      lightScale: { value: new THREE.Vector4(...(p.LightScale || [1,1,1,1])) },
      time: planetClock, opacity: { value: 1 },
    },
    blending:(p.LightScale?.[3]??1)<1?THREE.CustomBlending:THREE.NormalBlending,
    blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
  });
  m.userData.planet=true;m.userData.ready=Promise.all(requests);return m;
}

const SHIELD_VERT = `
#ifdef USE_VCOLOR
attribute vec4 color;
varying vec4 vColor;
#endif
varying vec2 vUv;
varying vec3 vNormal, vWorldPos;
varying float vNz;
void main() {
  vUv = uv;
  vNz = normal.z;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = mat3(modelMatrix) * normal;
#ifdef USE_VCOLOR
  vColor = color;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SHIELD_FRAG = `
uniform sampler2D map, waveMap, distortMap;
uniform vec3 tint, hitPos;
uniform float edgeBrightness, baseScale, waveScale, distortScale, baseScroll, waveScroll, distortScroll, time, flash, hitRadius, opacity, steady;
varying vec2 vUv;
varying vec3 vNormal, vWorldPos;
varying float vNz;
#ifdef USE_VCOLOR
varying vec4 vColor;
#endif
void main() {
  if (steady > 0.5) {
    vec4 d = texture2D(distortMap, vec2(vUv.x * waveScale, vUv.y * waveScale + time * waveScroll));
    vec4 b = texture2D(map, vec2(vUv.x * baseScale, vUv.y * baseScale + time * baseScroll) + d.xy * 0.25);
    vec4 wv = texture2D(waveMap, vec2(vUv.x * distortScale, vUv.y * distortScale + time * distortScroll));
    vec3 c = b.rgb * wv.rgb * tint * clamp(vNz + edgeBrightness, 0.0, 1.0);
#ifdef USE_VCOLOR
    c *= vColor.rgb;
#endif
    gl_FragColor = vec4(c * opacity, 1.0);
    return;
  }
  vec2 ripple = texture2D(distortMap, vUv * distortScale + vec2(0.0, time * distortScroll)).rg * 2.0 - 1.0;
  vec4 base = texture2D(map, vUv * baseScale + vec2(time * baseScroll, 0.0) + ripple * 0.08);
  vec4 wave = texture2D(waveMap, vUv * waveScale + vec2(0.0, time * waveScroll) + ripple * 0.03);
  vec3 n = normalize(vNormal), v = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - abs(dot(n, v)), 2.0);
  vec3 dp = vWorldPos - hitPos;
  float near = 0.3 + 1.1 * exp(-dot(dp, dp) / (hitRadius * hitRadius));
  float energy = max(wave.r, max(wave.g, wave.b)) * 0.9 + rim * (0.35 + edgeBrightness * 1.6) + 0.08;
  vec3 col = base.rgb * tint * energy * near;
#ifdef USE_VCOLOR
  col *= vColor.rgb * vColor.a;
#endif
  gl_FragColor = vec4(col * flash * opacity, 1.0);
}`;

function makeShieldMaterial(p, format) {
  const tex = name => (name ? loadTexture(name) : whiteTexture());
  const defines = {};
  if (format.endsWith('C')) defines.USE_VCOLOR = 1;
  const c = p.Color || [1, 1, 1];
  const m = new THREE.ShaderMaterial({
    vertexShader: SHIELD_VERT, fragmentShader: SHIELD_FRAG, defines,
    uniforms: {
      map: { value: tex(p.BaseTexture, 'BaseSampler') }, waveMap: { value: tex(p.WaveTexture) }, distortMap: { value: tex(p.DistortionTexture) },
      tint: { value: new THREE.Color(c[0], c[1], c[2]) }, edgeBrightness: { value: p.EdgeBrightness ?? 0.3 },
      baseScale: { value: p.BaseUVScale ?? 8 }, waveScale: { value: p.WaveUVScale ?? 1 }, distortScale: { value: p.DistortUVScale ?? 1 },
      baseScroll: { value: p.BaseUVScrollRate ?? -0.15 }, waveScroll: { value: p.WaveUVScrollRate ?? -0.15 }, distortScroll: { value: p.DistortUVScrollRate ?? -0.25 },
      time: planetClock, flash: { value: 0 }, hitPos: { value: new THREE.Vector3() }, hitRadius: { value: 100 }, opacity: { value: 1 }, steady: { value: 0 },
    },
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  m.userData.additive = true; m.userData.alpha = false; m.userData.shield = true;
  return m;
}

const materialCache = new Map();
export const instanceable = new WeakSet();
export const skinBatchable = new WeakSet();
const MAX_BONES = 24;
const DEPTH_FRAG = `
uniform float ghost;
uniform float dissolve;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
#ifndef UNLIT
  if (ghost > 0.5 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;
  if (dissolve > 0.0 && bayer4(gl_FragCoord.xy) < dissolve) discard;
#endif
  gl_FragColor = vec4(0.0);
}`;
export const programSources = { VERT, FRAG, DEPTH_FRAG };
const depthTwins = new WeakMap();
export function depthMaterial(m) {
  if (!m || !m.isShaderMaterial || !m.userData || !m.userData.depthOk || m.depthWrite === false || m.vertexShader !== VERT) return null;
  let d = depthTwins.get(m);
  if (d && (d.uniforms !== m.uniforms || d.defines !== m.defines)) d = null;
  if (!d) {
    d = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DEPTH_FRAG, defines: m.defines, uniforms: m.uniforms });
    d.uniforms = m.uniforms;
    depthTwins.set(m, d);
  }
  d.side = m.side; d.depthTest = m.depthTest; d.depthWrite = true; d.depthFunc = m.depthFunc; d.colorWrite = false;
  d.polygonOffset = m.polygonOffset; d.polygonOffsetFactor = m.polygonOffsetFactor; d.polygonOffsetUnits = m.polygonOffsetUnits;
  d.clipping = m.clipping; d.clippingPlanes = m.clippingPlanes; d.wireframe = m.wireframe;
  return d;
}

const IDENTITY_BONES = new Float32Array(MAX_BONES * 16);
for (let i = 0; i < MAX_BONES; i++) for (let k = 0; k < 4; k++) IDENTITY_BONES[i * 16 + k * 5] = 1;

function makeMaterial(mat, format, teamColor) {
  const shader = mat.shader;
  const p = mat.params;
  const nebula = shader === 'nebula.fx';
  const nativeAdditive = /^(mesh|rskin)additive(vcolor)?\.fx$/.test(shader) || nebula;
  const uvScrollRate = nativeAdditive ? (p.UVScrollRate || [0, 0]).map(v => v * (nebula ? 3 : 1)) : null;
  const skinned = /RSkin|B4I4/.test(format);
  const key = shader === 'planet.fx' ? shader+'|'+(gfx.shader|0)+'|'+JSON.stringify(Object.keys(p).sort().map(k=>[k,p[k]])) : [shader, p.BaseTexture, p.NormalTexture, p.GlossTexture, format.replace(/RSkin|B4I4/, 'S').endsWith('C'), skinned, teamColor ? teamColor.getHexString() : '-',
    (p.Emissive || []).join(), (p.Diffuse || []).join(), (p.Specular || []).join(), p.Shininess ?? '', (p.Color || []).join(), p.FowDimAllowed ?? '', uvScrollRate?.slice(0, 2).join() || '', gfx.shader | 0, /^w_asteroid00\.tga$/i.test(p.BaseTexture || '') ? rockBake() : ''].join('|');
  let m = materialCache.get(key);
  if (m) return m;
  if (shader === 'meshshield.fx') {
    m = makeShieldMaterial(p, format);
    materialCache.set(key, m);
    return m;
  }
  if (shader === 'planet.fx') {
    m = makePlanetMaterial(p);
    m.userData.additive = false; m.userData.alpha = false;
    materialCache.set(key, m);
    return m;
  }
  const additive = ADDITIVE.test(shader), alpha = !additive && ALPHA.test(shader);
  const unlit = additive || UNLIT.test(shader) || shader === 'batchmeshalpha.fx';
  const defines = {};
  if (additive) defines.ADDITIVE = 1;
  if (nativeAdditive) defines.NATIVE_MESH_ADDITIVE = 1;
  if (nebula) defines.NEBULA = 1;
  const zeroRGB = value => value?.length >= 3 && value[0] === 0 && value[1] === 0 && value[2] === 0;
  if (shader === 'meshgloss.fx' && zeroRGB(p.Diffuse) && zeroRGB(p.Specular)) defines.NATIVE_MESH_GLOSS_EMISSIVE = 1;
  if (alpha) defines.ALPHA = 1;
  if (unlit) defines.UNLIT = 1;
  if (shader.includes('colorize') && teamColor) defines.COLORIZE = 1;
  const detail = gfx.shader | 0;
  if (shader.includes('bump') && p.NormalTexture && detail >= 2) defines.BUMP = 1;
  if (detail < 1) { }
  else if (p.GlossTexture && !unlit) defines.GLOSSMAP = 1;
  else if (shader.includes('gloss')) defines.GLOSS = 1;
  if (format.endsWith('C')) defines.USE_VCOLOR = 1;
  if (FOW_DIMMED.test(shader) && p.FowDimAllowed !== 0 && p.FowDimAllowed !== false) defines.FOW_DIM = 1;
  const rock4k = !unlit && /^w_asteroid00\.tga$/i.test(p.BaseTexture || '') ? rockTextures() : null;
  const rocky = !rock4k && !unlit && /asteroid/i.test(p.BaseTexture || '');
  if (rocky) defines.DETAIL = 1;
  if (rock4k) defines.BUMP = 1;
  if (skinned) defines.SKINNED = 1;
  const c3 = (v, d) => (v ? new THREE.Color(v[0], v[1], v[2]) : new THREE.Color(d, d, d));
  const diffuse = c3(nativeAdditive ? p.Color : p.Diffuse || p.Color, 1);
  m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, defines,
    uniforms: {
      ...lighting,
      map: { value: rock4k ? rock4k.map : p.BaseTexture ? loadTexture(p.BaseTexture) : whiteTexture() },
      normalMap: { value: rock4k ? rock4k.normalMap : defines.BUMP ? loadTexture(p.NormalTexture) : whiteTexture() },
      ...(defines.GLOSSMAP ? { glossMap: { value: loadTexture(p.GlossTexture) } } : {}),
      colorization: { value: new THREE.Vector4(teamColor?.r ?? 1, teamColor?.g ?? 1, teamColor?.b ?? 1, 1) },
      emissive: { value: c3(p.Emissive, 0) },
      diffuse: { value: diffuse },
      specular: { value: c3(p.Specular, 0.5) },
      shininess: { value: p.Shininess ?? 32 },
      opacity: { value: 1 },
      tint: { value: new THREE.Vector4(1, 1, 1, 0) },
      alphaRef: { value: -1 },
      glow: { value: 1 },
      ghost: { value: 0 },
      dissolve: { value: 0 },
      uvScroll: { value: new THREE.Vector2() },
      ...(nativeAdditive ? { uvScrollRate: { value: new THREE.Vector2(uvScrollRate[0] || 0, uvScrollRate[1] || 0) }, time: planetClock } : {}),
      ...(nebula ? { nebulaWave: { value: new THREE.Vector3(p.DistortionScale ?? 0, p.SFreq ?? 0, p.TFreq ?? 0) } } : {}),
      ...(rocky ? { detailScale: { value: 0.09 } } : {}),
      ...(skinned ? { boneMatrices: { value: IDENTITY_BONES } } : {}),
    },
    side: (additive || alpha) && !/nebula/.test(shader) ? THREE.FrontSide : THREE.DoubleSide,
    transparent: additive || alpha,
    depthWrite: !(additive || alpha),
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  if (additive) { m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor; m.blending = THREE.CustomBlending; }
  m.userData.additive = additive;
  m.userData.alpha = alpha;
  if (alpha) shaderStates(shader, m);
  m.userData.depthOk = !(additive || alpha);
  if (!skinned && !alpha) instanceable.add(m);
  if (skinned && !alpha) skinBatchable.add(m);
  materialCache.set(key, m);
  return m;
}

const effectStates = new Map();
function shaderStates(shader, m) {
  let e = effectStates.get(shader);
  if (!e) {
    effectStates.set(shader, (e = { st: undefined, mats: new Set() }));
    fetchBinary('Data/Art/Shaders/' + shader.replace(/\.fx$/i, '.fxo')).then(bytes => {
      const info = bytes ? effectInfo(bytes) : null;
      const tech = info && (selectEffectTechnique(info, Math.max(1, gfx.shader | 0)) || info.techniques.find(t => t.name !== 'max_viewport'));
      const s = new Map();
      for (const x of tech?.passes[0]?.states || []) if (x.value !== undefined) s.set(x.id, x.value);
      e.st = tech ? { zwrite: s.has(3) ? !!s.get(3) : null, ref: s.get(4) === 1 && (s.get(11) === 5 || s.get(11) === 7) ? (s.get(10) ?? 0) / 255 - (s.get(11) === 7 ? 1 / 512 : 0) : -1 } : null;
    }).catch(() => { e.st = null; }).finally(() => { for (const x of e.mats) applyStates(x, e.st); e.mats.clear(); });
  }
  if (e.st !== undefined) applyStates(m, e.st); else e.mats.add(m);
}
function applyStates(m, st) {
  if (!st) return;
  if (st.zwrite !== null) m.depthWrite = st.zwrite;
  m.uniforms.alphaRef.value = st.ref;
}

const geometryCache = new WeakMap();
const geometryByContent = new Map();
const VERTEX_PARTS = ['pos', 'nrm', 'uv', 'tan', 'bin', 'col', 'skinIndex', 'skinWeight'];
const bytesOf = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const sameVertices = (a, b) => VERTEX_PARTS.every(k => (!a[k] || !b[k] ? a[k] === b[k] : sameBytes(bytesOf(a[k]), bytesOf(b[k]))));
const sameBytes = (a, b) => {
  if (a.byteLength !== b.byteLength) return false;
  let i = 0;
  if (((a.byteOffset | b.byteOffset) & 3) === 0) {
    const n4 = a.byteLength >> 2, a4 = new Uint32Array(a.buffer, a.byteOffset, n4), b4 = new Uint32Array(b.buffer, b.byteOffset, n4);
    for (; i < n4; i++) if (a4[i] !== b4[i]) return false;
    i <<= 2;
  }
  for (; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
};

function makeGeometry(model, g) {
  let perModel = geometryCache.get(model);
  if (!perModel) geometryCache.set(model, (perModel = new Map()));
  let geo = perModel.get(g);
  if (geo) return geo;
  const shape = g.nVerts + '|' + g.nPrims + '|' + g.stride + '|' + g.format;
  const verts = g.vertices;
  const idx = new Uint8Array(g.indices.buffer, g.indices.byteOffset, g.indices.byteLength);
  let alike = geometryByContent.get(shape);
  if (!alike) geometryByContent.set(shape, (alike = []));
  for (const c of alike) if (sameVertices(c.verts, verts) && sameBytes(c.idx, idx)) { perModel.set(g, c.geo); return c.geo; }
  geo = buildGeometry(model, g);
  alike.push({ verts, idx, geo });
  perModel.set(g, geo);
  return geo;
}

function buildGeometry(model, g) {
  let geo;
  const n = g.nVerts;
  let { pos, nrm, uv, tan, bin, col, skinIndex, skinWeight } = g.vertices;
  const skinned = !!skinIndex;
  if (skinned) for (let i = 0; i < skinIndex.length; i++) if (skinIndex[i] > MAX_BONES - 1) skinIndex[i] = MAX_BONES - 1;
  let indices = g.indices, bad = null;
  for (let i = 0; i < n * 3; i++) if (!Number.isFinite(pos[i])) (bad ??= new Uint8Array(n))[(i / 3) | 0] = 1;
  if (bad) {
    const keep = [];
    for (let i = 0; i + 2 < indices.length; i += 3) if (!bad[indices[i]] && !bad[indices[i + 1]] && !bad[indices[i + 2]]) keep.push(indices[i], indices[i + 1], indices[i + 2]);
    indices = new Uint16Array(keep);
    const at = bad.indexOf(0) * 3;
    pos = pos.slice();
    for (let i = 0; i < n; i++) if (bad[i]) for (let k = 0; k < 3; k++) pos[i * 3 + k] = at >= 0 ? pos[at + k] : 0;
  }
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('tangent', new THREE.BufferAttribute(tan, 3));
  geo.setAttribute('binormal', new THREE.BufferAttribute(bin, 3));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  if (skinned) {
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  }
  return geo;
}

export class ModelInstance {
  constructor() {
    this.root = new THREE.Group();
    this.bones = [];
    this.boneByName = new Map();
    this.meshByName = new Map();
    this.proxies = [];
    this.billboards = [];
    this.skins = [];
    this.flat = null;
    this.radius = 1;
    this.box = new THREE.Box3();
    this.model = null;
    this.poseVersion = 0;
    this.lazy = false;
    this.dirty = false;
  }
  bone(name) { return name ? this.boneByName.get(name.toUpperCase()) : undefined; }

  syncFromBones() {
    this.poseVersion++;
    if (this.lazy) { this.dirty = true; return; }
    this.root.updateMatrixWorld(true);
    this.syncSkins();
  }

  syncSkins() {
    const root = this.root;
    if (!this.flat && !this.offSplit) {
      this.offSplit = true;
      const bones = new Set(this.bones);
      for (const bn of this.bones) {
        if (bn.visible || bn === root || !bn.children.some(c => bones.has(c))) continue;
        bn.visible = true;
        for (const c of bn.children) if (!bones.has(c)) c.visible = false;
      }
    }
    const rel = root.parent ? _rel.copy(root.matrixWorld).invert() : null;
    if (this.flat) {
      for (const g of this.flat.children) {
        const b = g.userData.bone;
        if (!b) continue;
        if (b !== root) g.matrix.copy(b.matrixWorld);
        g.matrixWorldNeedsUpdate = true;
        let on = b.visible;
        for (let p = b.parent; on && p && p !== root; p = p.parent) if (!p.visible && p.userData.animHid) on = false;
        if (!on && g.visible) { g.visible = false; g.userData.hidByBone = true; }
        else if (on && g.userData.hidByBone) { g.visible = true; g.userData.hidByBone = false; }
      }
    }
    let off = null;
    if (this.skins.length) for (const b of this.bones) if (b.userData.animHid || (off && off.has(b.parent))) (off ||= new Set()).add(b);
    for (const s of this.skins) {
      s.mats ||= new Float32Array(IDENTITY_BONES);
      const n = Math.min(MAX_BONES, s.boneMap.length);
      for (let i = 0; i < n; i++) {
        const bone = this.bones[s.boneMap[i]];
        if (!bone) continue;
        if (off && off.has(bone)) { s.mats.fill(0, i * 16, i * 16 + 16); s.mats[i * 16 + 15] = 1; continue; }
        if (rel) _m.multiplyMatrices(rel, bone.matrixWorld).multiply(bone.userData.restInv);
        else _m.multiplyMatrices(bone.matrixWorld, bone.userData.restInv);
        _m.toArray(s.mats, i * 16);
      }
    }
  }
  mesh(name) { return name ? this.meshByName.get(name.toUpperCase()) : undefined; }
}

const NO_EULER = () => {};
const prebuilt = new Map();
export function prebuildModel(model, teamColor, n) {
  let list = prebuilt.get(model);
  if (!list) prebuilt.set(model, (list = []));
  for (let i = 0; i < n; i++) list.push({ teamColor, inst: buildModel(model, { teamColor, fresh: true }) });
}
export function dropPrebuilt() { prebuilt.clear(); }

const HEADLESS = new THREE.MeshBasicMaterial();
const seeThrough = shader => shader === 'meshshield.fx' || (shader !== 'planet.fx' && (ADDITIVE.test(shader) || ALPHA.test(shader)));

export function buildModel(model, { teamColor = null, showHidden = false, alt = 0, alts = false, fresh = false, headless = false } = {}) {
  if (!fresh && !headless && !showHidden && !alt && !alts) {
    const list = prebuilt.get(model), i = list ? list.findIndex(e => e.teamColor === teamColor) : -1;
    if (i >= 0) return list.splice(i, 1)[0].inst;
  }
  diag.note('model');
  const inst = new ModelInstance();
  inst.model = model;
  const m4 = new THREE.Matrix4();
  model.bones.forEach((b, i) => {
    const o = new THREE.Object3D();
    o.name = b.name;
    const m = b.matrix;
    m4.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
    m4.decompose(o.position, o.quaternion, o.scale);
    o.quaternion._onChange(NO_EULER);
    o.userData.rest = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
    o.visible = b.visible;
    inst.bones.push(o);
    inst.boneByName.set(b.name.toUpperCase(), o);
    if (b.billboard) inst.billboards.push({ bone: o, mode: b.billboard });
  });
  model.bones.forEach((b, i) => (b.parent >= 0 ? inst.bones[b.parent] : inst.root).add(inst.bones[i]));
  inst.root.updateMatrixWorld(true);
  for (const b of inst.bones) { b.userData.restInv = new THREE.Matrix4().copy(b.matrixWorld).invert(); b.userData.restAt = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); }

  const chainOf = name => (/_LOD\d$/i.test(name) ? name.replace(/_LOD\d?/gi, '').toUpperCase() : null);
  const tris = mesh => mesh.subs.reduce((n, sub) => n + (sub.geometry.indices ? sub.geometry.indices.length : 0), 0);
  const lodBest = new Map();
  for (const mesh of model.meshes) {
    const chain = chainOf(mesh.name);
    if (chain !== null && (!lodBest.has(chain) || tris(mesh) > tris(lodBest.get(chain)))) lodBest.set(chain, mesh);
  }
  const tmpBox = new THREE.Box3();
  const hasAlt = new Set(alt ? model.meshes.filter(m => new RegExp('_ALT' + alt + '(?![0-9])', 'i').test(m.name)).map(m => m.name.replace(/_ALT\d+/gi, '').replace(/_LOD\d/gi, '').toUpperCase()) : []);
  for (const mesh of model.meshes) {
    const chain = chainOf(mesh.name);
    if (chain !== null && lodBest.get(chain) !== mesh) continue;
    const altOf = /_ALT(\d+)/i.exec(mesh.name);
    if (altOf && Array.isArray(alts) && !alts.includes(+altOf[1])) continue;
    if (alt) { if (altOf ? +altOf[1] !== alt : hasAlt.has(mesh.name.replace(/_LOD\d/gi, '').toUpperCase())) continue; }
    else if (altOf && altOf[1] !== '0' && !showHidden && !alts) continue;
    const group = new THREE.Group();
    group.name = mesh.name;
    group.visible = !mesh.hidden || showHidden;
    if (alts && altOf && !alt) { ((inst.alts ||= [])[+altOf[1]] ||= []).push(group); if (altOf[1] !== '0') group.visible = false; }
    group.userData.hiddenByDefault = mesh.hidden;
    const skinnedMesh = mesh.subs.some(sub => sub.geometry && sub.geometry.boneMap && /RSkin|B4I4/.test(sub.geometry.format || ''));
    const parent = skinnedMesh ? inst.root : (inst.bones[mesh.bone] || inst.root);
    let any = false;
    for (const sub of mesh.subs) {
      if (!sub.material || !sub.geometry.indices || !sub.geometry.stride) continue;
      if (SKIP.test(sub.material.shader)) continue;
      const geo = makeGeometry(model, sub.geometry);
      if (headless) { const obj = new THREE.Mesh(geo, HEADLESS); group.add(obj); any = true; if (!mesh.hidden && !seeThrough(sub.material.shader)) { tmpBox.copy(geo.boundingBox).applyMatrix4(parent.matrixWorld); inst.box.union(tmpBox); } continue; }
      const obj = new THREE.Mesh(geo, makeMaterial(sub.material, sub.geometry.format, teamColor));
      if (obj.material.defines.SKINNED && sub.geometry.boneMap) {
        const skin = { mesh: obj, boneMap: sub.geometry.boneMap, mats: null };
        inst.skins.push(skin);
        obj.onBeforeRender = () => { obj.material.uniforms.boneMatrices.value = skin.mats || IDENTITY_BONES; obj.material.uniformsNeedUpdate = true; };
      }
      if (obj.material.userData.additive) obj.renderOrder = 2;
      else if (obj.material.userData.alpha) obj.renderOrder = 1;
      group.add(obj);
      any = true;
      if (!mesh.hidden && !obj.material.transparent) {
        tmpBox.copy(geo.boundingBox).applyMatrix4(parent.matrixWorld);
        inst.box.union(tmpBox);
      }
    }
    let key = mesh.name.toUpperCase();
    for (let n = 2; inst.meshByName.has(key); n++) key = mesh.name.toUpperCase() + '#' + n;
    inst.meshByName.set(key, group);
    if (chain !== null && !inst.meshByName.has(chain)) inst.meshByName.set(chain, group);
    if (any) parent.add(group);
  }
  for (const px of model.proxies) {
    inst.proxies.push({ name: px.name, bone: inst.bones[px.bone] || inst.root, hidden: px.hidden });
  }
  if (inst.box.isEmpty()) inst.box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const size = inst.box.getSize(new THREE.Vector3());
  inst.radius = Math.max(size.x, size.y) / 2;
  return inst;
}

export async function loadModel(name, opts) {
  const data = await loadALO(name);
  if (!data) return null;
  return buildModel(data, opts);
}

const ready = new Map();

export async function preloadModels(names, onProgress = () => {}) {
  const list = [...new Set([...names].filter(Boolean).map(n => n.toUpperCase()))].filter(n => !ready.has(n));
  let done = 0;
  await Promise.all(list.map(async n => {
    const data = await loadALO(n).catch(() => null);
    ready.set(n, data && !data.isParticle ? data : null);
    onProgress(++done, list.length);
  }));
}

export function getModelData(name) {
  return name ? ready.get(name.toUpperCase()) || null : null;
}

export function flattenModel(inst) {
  if (inst.billboards.length) return null;
  inst.root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(inst.root.matrixWorld).invert();
  const container = new THREE.Group();
  container.matrixAutoUpdate = false;
  for (const group of new Set(inst.meshByName.values())) {
    if (!group.parent) continue;
    let hidden = false;
    for (let b = group.parent; b && b !== inst.root; b = b.parent) if (!b.visible) hidden = true;
    const m = new THREE.Matrix4().multiplyMatrices(inv, group.matrixWorld);
    group.userData.bone = group.parent;
    group.removeFromParent();
    group.matrix.copy(m);
    group.matrixAutoUpdate = false;
    for (const mesh of group.children) mesh.matrixAutoUpdate = false;
    if (hidden) group.visible = false;
    container.add(group);
  }
  inst.flat = container;
  return container;
}

const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _rel = new THREE.Matrix4(), _m = new THREE.Matrix4();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
export function updateBillboards(inst, camera) {
  if (inst.billboards.length) inst.poseVersion++;
  for (const { bone, mode } of inst.billboards) {
    bone.parent.getWorldQuaternion(_pq).invert();
    if (mode === 6) {
      camera.getWorldDirection(_by).negate();
      _bx.copy(lighting.sunDir.value).addScaledVector(_by, -lighting.sunDir.value.dot(_by));
      if (_bx.lengthSq() < 1e-6) _bx.set(1, 0, 0).applyQuaternion(camera.quaternion);
      _bx.normalize();
      _bz.crossVectors(_bx, _by);
      _q.setFromRotationMatrix(_m.makeBasis(_bx, _by, _bz));
      bone.quaternion.copy(_pq).multiply(_q);
      bone.position.copy(_bx).applyQuaternion(_pq).multiplyScalar(bone.userData.rest.p.length());
      continue;
    }
    _q.copy(camera.quaternion);
    bone.quaternion.copy(_pq.multiply(_q));
  }
}
