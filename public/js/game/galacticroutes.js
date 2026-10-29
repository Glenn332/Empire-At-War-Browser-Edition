const same = (a, b) => !!a && !!b && a.toUpperCase() === b.toUpperCase();
const rgba = value => {
  const a = String(value || '')
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isFinite);
  return a.length >= 3 ? [a[0] / 255, a[1] / 255, a[2] / 255, a.length > 3 ? a[3] / 255 : 1] : [0.5, 0.5, 0.5, 1];
};
export function routeStyle(a, b, faction, constants, viewer, simplified = false, allied = same) {
  if (!a || !b || !same(a, b) || !faction || faction.bool('Is_Neutral')) return 'Neutral';
  if (simplified) return allied(a, viewer) ? 'Ally' : 'Enemy';
  return same(a, constants.str('Good_Side_Name')) ? 'Good' : same(a, constants.str('Evil_Side_Name')) ? 'Evil' : 'Corrupt';
}
export function routeSettings(line, style) {
  const block = line?.sub('Settings_For_Faction').find(n => same(n.attrs.Name, style));
  return {
    style,
    neutral: style === 'Neutral',
    out: rgba(block?.val('Color_Zoomed_Out')),
    in: rgba(block?.val('Color_Zoomed_In')),
    width: block?.num('Width', 0) ?? 0,
    mode: String(block?.val('Render_Mode') || 'ADDITIVE').toUpperCase(),
    texture: block?.val('Texture_Name') || 'W_galaxy_line_alpha.tga',
    spark: block?.val('Spark_Texture_Name') || 'w_galaxy_dot.tga'
  };
}
export const ROUTE_SPARK_SEEDS = Object.freeze([0.15, 0.4, 0.55, 0.89, -0.45, -0.7, -0.5, -0.89]);
export const ROUTE_SPARK_PERIOD = 50;
export function routeSparkFraction(seed, ticks) {
  const t = Math.abs(seed) + (seed < 0 ? -ticks : ticks) / ROUTE_SPARK_PERIOD;
  return ((t % 1) + 1) % 1;
}
export function routeAxes(a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dz = b[2] - a[2];
  const flat = Math.hypot(dx, dy),
    length = Math.hypot(dx, dy, dz) || 1;
  return { across: flat ? [dy / flat, -dx / flat, 0] : [0, -1, 0], along: [dx / length, dy / length, dz / length], length };
}
export const ROUTE_VERT = `
attribute float side;
uniform float width;
uniform vec3 across;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + across * side * width * .5, 1.0);
}`;
export const ROUTE_FRAG = `
uniform sampler2D map;
uniform vec3 color;
uniform float opacity;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(map, vUv) * vec4(color, opacity); }`;
