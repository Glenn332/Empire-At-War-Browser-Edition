import { db } from '../gamedata.js';
import { intelligence } from './galacticfog.js';

export const radarPlanets = g => g.planets.filter(p => p.owner != null && p.type.list('Behavior').some(b => b.toUpperCase() === 'PLANET'));
export const radarPoint = (pos, size) => ({ x: pos[0] / 380 * size[0] / 2, y: pos[1] / 460 * size[1] / 2 });
export const radarWorld = (point, size) => ({ x: point.x / (size[0] / 2) * 380, y: point.y / (size[1] / 2) * 460 });
export const nativeRound = n => Math.sign(n) * Math.floor(Math.abs(n) + 0.5);
const colors = new WeakMap(), neutralColor = [100, 100, 100, 255];

export function radarAppearance(g, p) {
  const v = intelligence(g, p), known = !!v?.discovered;
  const faction = known && v.ownerKnown ? db.faction(p.owner) : db.faction('Neutral');
  if (faction && !colors.has(faction)) colors.set(faction, faction.vec('Color', neutralColor));
  return { known, color: faction ? colors.get(faction) : neutralColor, alpha: known ? 1 : 128 / 255 };
}

export function radarViewPoint(position, direction, size, viewSize) {
  if (Math.abs(direction.z) < 1e-8) return null;
  const t = -position.z / direction.z, p = radarPoint([position.x + direction.x * t, position.y + direction.y * t], size);
  p.y -= 10;
  const clamp = (n, outer, inner) => { if (n - inner / 2 < -outer / 2) n = (inner - outer) / 2; if (n + inner / 2 > outer / 2) n = (outer - inner) / 2; return n; };
  return { x: clamp(p.x, size[0], viewSize[0]), y: clamp(p.y, size[1], viewSize[1]) };
}

export function selectRadarPlanet(game, index) {
  const p = game.galaxy.planets[index];
  if (!p || !intelligence(game.galaxy, p)?.discovered) return false;
  const v = game.view;
  if (v.dir > 0 || v.zoom === 1 && v.dir === 0) { v.planet = index; v.zoom = 1; v.dir = 0; }
  game.select(index);
  return true;
}

export function recenterRadar(game, point) {
  if (game.battle) return false;
  game.view.x = point.x; game.view.y = point.y;
  game.view.z = 10;
  game.placeCamera();
  return true;
}

export function advanceRadarFlash(state, dt) {
  state.timer = Math.fround(state.timer - dt);
  if (state.timer <= 0) {
    state.count--;
    if (state.count < 1 && !state.persistent) { state.count = 0; state.timer = 0; }
    else state.timer = Math.fround(state.timer + 0.5);
  }
  return state.timer > 0 ? Math.trunc(Math.fround(Math.fround(state.timer * 255) / 0.5)) & 255 : state.color || 0;
}
