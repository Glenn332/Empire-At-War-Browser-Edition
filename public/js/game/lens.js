import * as THREE from 'three';

export const LENS_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export const LENS_FRAG = `
uniform sampler2D map; uniform vec2 texel, motion; uniform vec3 tint;
uniform float focus, sat, contrast, vignette; varying vec2 vUv;
void main() {
  vec3 c = texture2D(map, vUv).rgb;
  if (abs(motion.x) + abs(motion.y) > 0.0005) {
    vec3 s = c;
    for (int i = 1; i <= 6; i++) s += texture2D(map, vUv + motion * (float(i) / 6.0 - 0.5)).rgb;
    c = s / 7.0;
  }
  vec2 q = (vUv - 0.5) * vec2(texel.y / texel.x, 1.0);
  float r = length(q);
  float b = smoothstep(0.16, 0.5, r) * focus;
  if (b > 0.01) {
    vec3 s = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      s += texture2D(map, vUv + vec2(cos(a), sin(a)) * texel * 4.0 * b).rgb;
      s += texture2D(map, vUv + vec2(cos(a + 0.39), sin(a + 0.39)) * texel * 8.0 * b).rgb;
    }
    c = mix(c, s / 16.0, min(1.0, b * 1.4));
  }
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, sat);
  c = (c - 0.5) * contrast + 0.5;
  c *= tint;
  c *= 1.0 - vignette * smoothstep(0.3, 0.85, r);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export function lensMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
    uniforms: {
      map: { value: null },
      texel: { value: new THREE.Vector2() },
      motion: { value: new THREE.Vector2() },
      tint: { value: new THREE.Color(1, 1, 1) },
      focus: { value: 0 },
      sat: { value: 1 },
      contrast: { value: 1 },
      vignette: { value: 0 }
    },
    depthTest: false,
    depthWrite: false
  });
}
