import { families, simple } from './programs.js';
import { LENS_VERT } from '../game/lens.js';

const lens = simple({
  name: 'lens',
  textures: ['map'],
  params: [
    ['texel', 'v2'],
    ['motion', 'v2'],
    ['tint', 'c3'],
    ['focus', 'f'],
    ['sat', 'f'],
    ['contrast', 'f'],
    ['vignette', 'f']
  ],
  vertex: () => [
    ['position', 3, 0],
    ['uv', 2, 1]
  ],
  match: m => m.isShaderMaterial && m.vertexShader === LENS_VERT && m.fragmentShader.includes('uniform float focus, sat, contrast, vignette;'),
  code: () => `
struct VIn { @location(0) position: vec3f, @location(1) uv: vec2f }
struct VOut { @builtin(position) pos: vec4f, @location(0) vUv: vec2f }
@vertex fn vs(i: VIn) -> VOut { var o: VOut; o.vUv = i.uv; o.pos = glDepth(vec4f(i.position.xy, 0.0, 1.0)); return o; }
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let uv = v.vUv;
  var c = textureSampleLevel(mapT, mapS, uv, 0.0).rgb;
  if (abs(D.motion.x) + abs(D.motion.y) > 0.0005) {
    var s = c;
    for (var i = 1; i <= 6; i++) { s += textureSampleLevel(mapT, mapS, uv + D.motion * (f32(i) / 6.0 - 0.5), 0.0).rgb; }
    c = s / 7.0;
  }
  let q = (uv - 0.5) * vec2f(D.texel.y / D.texel.x, 1.0);
  let r = length(q);
  let b = smoothstep(0.16, 0.5, r) * D.focus;
  if (b > 0.01) {
    var s = vec3f(0.0);
    for (var i = 0; i < 8; i++) {
      let a = f32(i) * 0.785398;
      s += textureSampleLevel(mapT, mapS, uv + vec2f(cos(a), sin(a)) * D.texel * 4.0 * b, 0.0).rgb;
      s += textureSampleLevel(mapT, mapS, uv + vec2f(cos(a + 0.39), sin(a + 0.39)) * D.texel * 8.0 * b, 0.0).rgb;
    }
    c = mix(c, s / 16.0, min(1.0, b * 1.4));
  }
  let l = dot(c, vec3f(0.299, 0.587, 0.114));
  c = mix(vec3f(l), c, D.sat);
  c = (c - 0.5) * D.contrast + 0.5;
  c *= D.tint;
  c *= 1.0 - D.vignette * smoothstep(0.3, 0.85, r);
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}`
});

families.push(lens);
