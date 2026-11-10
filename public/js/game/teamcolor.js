import * as THREE from '../../vendor/three/build/three.module.js';
import { db } from '../gamedata.js';

const cache = new Map();

const vec = s => {
  const v = String(s || '')
    .split(/[\s,]+/)
    .map(parseFloat)
    .filter(Number.isFinite);
  return v.length >= 3 && (v[0] || v[1] || v[2]) ? v : null;
};

const shared = v => {
  const id = v.slice(0, 3).join(',');
  let c = cache.get(id);
  if (!c) cache.set(id, (c = new THREE.Color(v[0] / 255, v[1] / 255, v[2] / 255)));
  return c;
};

export const colorizes = setup => !setup?.campaign && !setup?.linkedTactical;

export function uncolorized(type, faction) {
  const v = vec(type?.str('No_Colorization_Color')) || vec(db.faction(faction || '')?.str('No_Colorization_Color'));
  return v ? shared(v) : null;
}

export function unitTeamColor(colorize, type, faction, playerColor) {
  if (colorize && !db.faction(faction || '')?.bool('Is_Neutral')) return playerColor || null;
  return uncolorized(type, faction) || playerColor || null;
}
