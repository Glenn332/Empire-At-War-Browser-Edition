import { db } from '../gamedata.js';
import { heightAt, CELL } from './terrain.js';

export const SURFACES = [
  'default',
  'grass',
  'dirt',
  'snow',
  'water',
  'concrete',
  'mud',
  'ice',
  'lava',
  '',
  '',
  '',
  'good_ground',
  'high_ground',
  'slow_ground',
  'damage_ground',
  'infantry_ground'
];
const WATER_SURFACE = [-1, 4, 8, 7];
const WATER_GAP = 0.5;

const RULES = new Map([
  [12, { tint: 'Good_Ground_Color_Tint', on: s => s.defense !== 0 || s.dealt !== 0 }],
  [13, { tint: 'High_Ground_Color_Tint', on: s => s.sight !== 0 || s.range !== 0 }],
  [14, { tint: 'Slow_Ground_Color_Tint', on: s => s.speed !== 0 }],
  [4, { tint: 'Slow_Ground_Color_Tint', on: s => s.speed !== 0 }],
  [15, { tint: 'Lava_Ground_Color_Tint', on: s => s.damage > 0 }],
  [8, { tint: 'Lava_Ground_Color_Tint', on: s => s.damage > 0 }],
  [16, { tint: 'Infantry_Ground_Color_Tint', on: s => !!s.icon }]
]);

export function surfaceAt(T, x, y) {
  if (!T || !T.size) return 0;
  const w = T.water,
    wk = w ? (WATER_SURFACE[w.mode] ?? -1) : -1;
  if (wk >= 0 && heightAt(T, x, y) < w.level - WATER_GAP) return wk;
  const n = T.size,
    i = Math.min(n - 1, Math.max(0, Math.round(y / CELL))) * n + Math.min(n - 1, Math.max(0, Math.round(x / CELL))),
    L = T.layers[T.layerIndex[i]];
  return L ? L.kind | 0 : 0;
}

const tints = new Map();
function tintOf(key) {
  if (!tints.has(key)) {
    const v = db.constants.vec(key, []);
    tints.set(key, v.length >= 3 ? v.slice(0, 3).map(c => Math.min(1, Math.max(0, c / 255))) : null);
  }
  return tints.get(key);
}

const statuses = new WeakMap();
export function surfaceStatus(tables, type, surface) {
  if (!tables || !type || !RULES.has(surface)) return null;
  let byType = statuses.get(type);
  if (!byType) statuses.set(type, (byType = new Map()));
  if (byType.has(surface)) return byType.get(surface);
  const rule = RULES.get(surface),
    name = SURFACES[surface];
  let found = null;
  for (const g of type.list('SurfaceFX_Name')) {
    const s = tables.surface.get(g.toUpperCase())?.get(name);
    if (s && rule.on(s)) found = { icon: s.icon, tint: tintOf(rule.tint) };
  }
  byType.set(surface, found);
  return found;
}
