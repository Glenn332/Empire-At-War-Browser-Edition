import { families, simple } from './programs.js';
import './programs-galactic.js';

const f32 = (...xs) => { let v = Math.fround(xs[0]); for (let i = 1; i < xs.length; i++) v = Math.fround(v * Math.fround(xs[i])); return v.toPrecision(9); };
const only = (m, ...names) => !!m.uniforms && Object.keys(m.uniforms).length === names.length && names.every(n => n in m.uniforms);

const sprites = simple({
  name: 'sprites', textures: ['map'],
  match: m => m.isShaderMaterial && only(m, 'map') && m.vertexShader.startsWith('attribute vec4 center; attribute vec4 tint; varying vec2 vUv; varying vec4 vTint;'),
  vertex: () => [['position', 3, 0]],
  perInstance: [['center', 4, 1], ['tint', 4, 2]],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) center: vec4f, @location(2) tint: vec4f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vTint: vec4f }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vUv = i.position.xy * 0.5 + 0.5; o.vTint = i.tint;
  var mv = P.view * vec4f(i.center.xyz, 1.0); mv = vec4f(mv.xy + i.position.xy * i.center.w, mv.zw);
  o.pos = glDepth(P.proj * mv);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = textureSample(mapT, mapS, v.vUv);
  return vec4f(t.rgb * v.vTint.rgb * v.vTint.a * t.a, 1.0);
}`,
});

const beams = simple({
  name: 'beams', textures: ['map'],
  match: m => m.isShaderMaterial && only(m, 'map') && m.vertexShader.startsWith('attribute vec4 tail; attribute vec4 head; attribute vec3 tint;'),
  vertex: () => [['position', 3, 0]],
  perInstance: [['tail', 4, 1], ['head', 4, 2], ['tint', 3, 3]],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) tail: vec4f, @location(2) head: vec4f, @location(3) tint: vec3f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f, @location(1) vTint: vec3f }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vTint = i.tint; o.vUv = vec2f(i.position.x * 0.5 + 0.5, i.position.y);
  let a = P.view * vec4f(i.tail.xyz, 1.0); let b = P.view * vec4f(i.head.xyz, 1.0);
  var d = b.xy - a.xy; let l = length(d); d = select(vec2f(0.0, 1.0), d / l, l > 1e-4);
  var p = mix(a, b, i.position.y); p = vec4f(p.xy + vec2f(-d.y, d.x) * i.position.x * i.tail.w, p.zw);
  o.pos = glDepth(P.proj * p);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = textureSample(mapT, mapS, v.vUv);
  return vec4f(v.vTint * t.r * 2.2 + vec3f(t.a) * 0.55, 1.0);
}`,
});

const ringCut = simple({
  name: 'ringCut', textures: ['map'],
  match: m => m.isShaderMaterial && only(m, 'map') && m.vertexShader.startsWith('varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix'),
  vertex: () => [['position', 3, 0], ['uv', 2, 1]],
  code: (m, instanced) => `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f, ${instanced ? '@location(8) im0: vec4f, @location(9) im1: vec4f, @location(10) im2: vec4f, @location(11) im3: vec4f,' : ''} }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.vUv = i.uv;
  ${instanced ? 'let im = mat4x4f(i.im0, i.im1, i.im2, i.im3);' : 'let im = mat4x4f(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);'}
  o.pos = glDepth(P.proj * P.view * D.model * im * vec4f(i.position, 1.0));
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = textureSample(mapT, mapS, v.vUv);
  if (max(t.r, max(t.g, t.b)) * t.a < 0.5) { discard; }
  return vec4f(0.0);
}`,
});

const spaceFog = simple({
  name: 'spaceFog', textures: ['state', 'grid', 'gridRed'],
  params: [['cells', 'v2'], ['tint', 'c3'], ['tintRed', 'c3'], ['haveGrid', 'f'], ['placing', 'f'], ['redLit', 'f']],
  match: m => m.isShaderMaterial && !!m.uniforms && !!m.uniforms.state && !!m.uniforms.gridRed && !!m.uniforms.tintRed,
  vertex: () => [['position', 3, 0], ['uv', 2, 1]],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = i.uv; o.pos = glDepth(P.proj * D.modelView * vec4f(i.position, 1.0)); return o; }
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let m = v.vUv * 3.0 - 1.0;
  let inside = step(0.0, m.x) * step(m.x, 1.0) * step(0.0, m.y) * step(m.y, 1.0);
  let fog = mix(1.0, textureSample(stateT, stateS, clamp(m, vec2f(0.0), vec2f(1.0))).r, inside);
  let t = m * D.cells;
  let g = textureSample(gridT, gridS, t); let r = textureSample(gridRedT, gridRedS, t);
  let cellMask = smoothstep(0.1, 0.34, max(g.r, max(g.g, g.b)));
  let blue = mix(vec3f(0.0), vec3f(0.78, 0.8, 0.84) * D.tint, cellMask);
  let blueA = mix(0.32, 0.09, cellMask);
  let redMask = smoothstep(0.2, 0.6, r.r);
  let red = mix(mix(blue * 0.35, r.rgb * D.tintRed, cellMask), r.rgb * D.tintRed, D.redLit);
  let redA = mix(blueA, mix(0.05, 0.42, redMask), D.redLit);
  var col = mix(blue, red, D.placing);
  var a = mix(blueA, redA, D.placing);
  col = mix(vec3f(0.008, 0.02, 0.04), col, D.haveGrid);
  a = mix(0.72, a, D.haveGrid);
  return vec4f(col, a * fog);
}`,
});

const POST_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const screenVS = `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = i.uv; o.pos = glDepth(vec4f(i.position.xy, 0.0, 1.0)); return o; }`;
const screen = (name, test, spec) => simple({ name, vertex: () => [['position', 3, 0], ['uv', 2, 1]],
  match: m => m.isShaderMaterial && m.vertexShader === POST_VERT && test(m.fragmentShader), ...spec });

const bright = screen('bright', f => f.includes('uniform float cutoff;'), {
  textures: ['map'], params: [['cutoff', 'f']],
  code: () => screenVS + `
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let c = clamp(textureSample(mapT, mapS, v.vUv).rgb, vec3f(0.0), vec3f(1.0)); let c2 = c * c;
  return vec4f(select(c * c2 * c2, c, dot(c, vec3f(0.299, 0.587, 0.114)) > D.cutoff), 1.0);
}`,
});

const blur = screen('blur', f => f.includes('uniform vec2 offset;'), {
  textures: ['map'], params: [['offset', 'v2']],
  code: () => screenVS + `
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let o = D.offset; let p = vec2f(D.offset.x, -D.offset.y);
  return vec4f((textureSample(mapT, mapS, v.vUv + o).rgb + textureSample(mapT, mapS, v.vUv - o).rgb + textureSample(mapT, mapS, v.vUv + p).rgb + textureSample(mapT, mapS, v.vUv - p).rgb) * 0.25, 1.0);
}`,
});

const combine = screen('combine', f => f.includes('vec3 smoothEdges(vec2 uv)'), {
  textures: ['scene', 'glow', 'heat'], params: [['texel', 'v2'], ['bloom', 'f'], ['haze', 'f']],
  code: () => screenVS + `
const L = vec3f(0.299, 0.587, 0.114);
fn smoothEdges(uv: vec2f) -> vec3f {
  let tx = D.texel;
  let nw = textureSampleLevel(sceneT, sceneS, uv + vec2f(-1.0, -1.0) * tx, 0.0).rgb; let ne = textureSampleLevel(sceneT, sceneS, uv + vec2f(1.0, -1.0) * tx, 0.0).rgb;
  let sw = textureSampleLevel(sceneT, sceneS, uv + vec2f(-1.0, 1.0) * tx, 0.0).rgb; let se = textureSampleLevel(sceneT, sceneS, uv + vec2f(1.0, 1.0) * tx, 0.0).rgb;
  let m = textureSampleLevel(sceneT, sceneS, uv, 0.0).rgb;
  let lnw = dot(nw, L); let lne = dot(ne, L); let lsw = dot(sw, L); let lse = dot(se, L); let lm = dot(m, L);
  let lo = min(lm, min(min(lnw, lne), min(lsw, lse))); let hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
  var dir = vec2f(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  let reduce = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), vec2f(-8.0), vec2f(8.0)) * tx;
  let a = 0.5 * (textureSampleLevel(sceneT, sceneS, uv + dir * (${f32(1 / 3)} - 0.5), 0.0).rgb + textureSampleLevel(sceneT, sceneS, uv + dir * (${f32(2 / 3)} - 0.5), 0.0).rgb);
  let b = a * 0.5 + 0.25 * (textureSampleLevel(sceneT, sceneS, uv - dir * 0.5, 0.0).rgb + textureSampleLevel(sceneT, sceneS, uv + dir * 0.5, 0.0).rgb);
  let lb = dot(b, L);
  return select(b, a, lb < lo || lb > hi);
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  var uv = v.vUv;
  let hz = textureSample(heatT, heatS, v.vUv).rg - 0.5;
  if (D.haze > 0.0) { uv += hz * step(0.006, max(abs(hz.x), abs(hz.y))) * D.haze; }
  var c = smoothEdges(uv);
  let gl = textureSample(glowT, glowS, v.vUv).rgb;
  if (D.bloom > 0.0) { let g = clamp(gl * D.bloom, vec3f(0.0), vec3f(1.0)); c = clamp(c, vec3f(0.0), vec3f(1.0)); c += g * (1.0 - c); }
  return vec4f(c, 1.0);
}`,
});

const flare = simple({
  name: 'flare', textures: ['map'], params: [['cell', 'c3'], ['tint', 'c3'], ['level', 'f']],
  match: m => m.isShaderMaterial && only(m, 'map', 'cell', 'tint', 'level') && m.vertexShader.startsWith('uniform vec3 cell; varying vec2 vUv;'),
  vertex: () => [['position', 3, 0], ['uv', 2, 1]],
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = (D.cell.xy + vec2f(i.uv.x, 1.0 - i.uv.y)) * D.cell.z; o.pos = glDepth(P.proj * D.modelView * vec4f(i.position, 1.0)); return o; }
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = textureSample(mapT, mapS, v.vUv);
  return vec4f(t.rgb * D.tint * t.a * D.level, 1.0);
}`,
});

const ROCK_COMMON = `
fn gmod(x: vec2f, y: f32) -> vec2f { return x - y * floor(x / y); }
fn hash2(p: vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn hash22(p: vec2f) -> vec2f { var q = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
fn pnoise(x: vec2f, per: f32) -> f32 {
  let i = floor(x); var f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  let a = gmod(i, per); let b = gmod(i + 1.0, per);
  return mix(mix(hash2(a), hash2(vec2f(b.x, a.y)), f.x), mix(hash2(vec2f(a.x, b.y)), hash2(b), f.x), f.y);
}
fn pfbm(uv: vec2f, per0: f32) -> f32 {
  var a = 0.5; var s = 0.0; var per = per0;
  for (var i = 0; i < 7; i++) { s += a * pnoise(uv * per, per); per *= 2.0; a *= 0.5; }
  return s;
}
fn craters(uv: vec2f, per: f32, seed: f32) -> f32 {
  let x = uv * per; let i = floor(x); let f = fract(x);
  var h = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let o = vec2f(f32(dx), f32(dy)); let c = gmod(i + o, per) + seed;
      let r = hash22(c);
      if (r.x > 0.55) { continue; }
      let rad = 0.16 + 0.3 * hash2(c + 7.7);
      let d = length(o + 0.2 + 0.6 * r - f) / rad;
      let e = (d - 1.0) * 5.0;
      if (d < 1.4) { h += (smoothstep(0.0, 1.0, d) - 1.0) * 0.9 + 0.35 * exp(-(e * e)); }
    }
  }
  return h;
}
fn height(uv: vec2f) -> f32 {
  let lum = dot(textureSampleLevel(srcT, srcS, uv, 0.0).rgb, vec3f(0.33));
  let ridge = 1.0 - abs(pfbm(uv + 0.37, 6.0) * 2.0 - 1.0);
  return lum * 0.9 + pfbm(uv, 10.0) * 0.55 + ridge * ridge * 0.3 + pfbm(uv + 0.71, 96.0) * 0.12
    + craters(uv, 7.0, 3.0) * 0.22 + craters(uv, 19.0, 11.0) * 0.1 + craters(uv, 53.0, 29.0) * 0.045;
}`;
const isRock = (f, normal) => f.includes('float pfbm(vec2 uv, float per)') && f.includes('uniform float texel;') === normal;
const rockAlbedo = screen('rockAlbedo', f => isRock(f, false), {
  textures: ['src', 'srcNormal'],
  code: () => screenVS + ROCK_COMMON + `
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let o = textureSample(srcT, srcS, v.vUv);
  let h = height(v.vUv);
  let fine = pfbm(v.vUv + 0.13, 160.0);
  var col = o.rgb * (0.5 + 0.62 * h) * (0.9 + 0.2 * fine);
  col *= mix(vec3f(1.05, 0.98, 0.9), vec3f(0.9, 0.97, 1.06), pfbm(v.vUv + 0.5, 4.0));
  return vec4f(col, o.a);
}`,
});
const rockNormal = screen('rockNormal', f => isRock(f, true), {
  textures: ['src', 'srcNormal'], params: [['texel', 'f']],
  code: () => screenVS + ROCK_COMMON + `
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let n0 = textureSample(srcNormalT, srcNormalS, v.vUv);
  let h = height(v.vUv); let hu = height(v.vUv + vec2f(D.texel, 0.0)); let hv = height(v.vUv + vec2f(0.0, D.texel));
  let g = vec2f(h - hu, h - hv) / D.texel * 0.0016;
  let n = normalize(vec3f((n0.xy * 2.0 - 1.0) * 0.7 + g, max(n0.z * 2.0 - 1.0, 0.35)));
  return vec4f(n * 0.5 + 0.5, n0.a);
}`,
});

families.push(sprites, beams, ringCut, spaceFog, bright, blur, combine, flare, rockAlbedo, rockNormal);
