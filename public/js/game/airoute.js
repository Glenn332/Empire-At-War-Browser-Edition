import { db } from '../gamedata.js';
import { relation, enemy, hidden } from './galacticrelation.js';
import { controllerOf } from './galacticbribe.js';

export const STATUS = Object.freeze({
  FRIENDLY_ONLY: 0,
  FRIENDLY_IGNORE_THREAT: 1,
  ENEMY_DESTINATION: 2,
  ENEMY_UNDEFENDED: 3,
  SINGLE_HOP_DISCONNECTED: 4,
  ANY: 5,
  NO_THREAT: 6,
  LOW_THREAT: 7,
  MEDIUM_THREAT: 8,
  HIGH_THREAT: 9,
  ANY_THREAT: 10
});
export const statusOf = mode => STATUS[String(mode || 'ENEMY_DESTINATION').toUpperCase()] ?? 2;

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const corrupted = p => (p.currentCorruption ?? -1) !== -1;
const strength = p => (db.faction(p.politicalOwner ?? p.owner)?.bool('Is_Neutral') ? 0 : (p.politicalValue ?? 1));
const benefits = owner => !!db.faction(owner)?.bool('Benefits_From_Corruption');
const ally = (mover, planet) => {
  const c = planet.politicalOwner ?? planet.owner;
  return !!c && relation(mover, c) === 0 && strength(planet) > 0;
};
const known = (galaxy, planet) =>
  galaxy.autoReveal !== false || !!planet.revealed || !!galaxy.visibility?.planets?.[planet.index]?.discovered;

export function hostilePlace(galaxy, planet, mover, orbit = null) {
  if ((planet.spaceLevel || 0) > 0) return !ally(mover, planet);
  const there = f => !f.leg && f.units.some(u => !u.dead) && !hidden(f) && enemy(mover, f.owner);
  return orbit ? (orbit.get(planet.index) || []).some(there) : galaxy.fleets.some(f => f.planet === planet.index && there(f));
}
const orbitIndex = galaxy => {
  const by = new Map();
  for (const f of galaxy.fleets) {
    let l = by.get(f.planet);
    if (!l) by.set(f.planet, (l = []));
    l.push(f);
  }
  return by;
};

export function aiRoute(galaxy, fleet, status) {
  const mover = fleet.owner,
    any = status === 5,
    pass = status > 2,
    target = status > 1,
    benefit = benefits(mover);
  return (planet, isTarget, from) => {
    if (planet.background || planet.destroyed || planet.restricted) return null;
    if (!known(galaxy, planet) || (from && !known(galaxy, from))) return null;
    if (target && isTarget) return 0;
    const corrupt = benefit && corrupted(planet),
      acceptable = ally(mover, planet) || corrupt || any,
      hostile = hostilePlace(galaxy, planet, mover);
    if (!acceptable) {
      if (!pass) return null;
      if (!hostile) return 0;
    } else if (any || !hostile) return 0;
    return corrupt ? 100 : null;
  };
}

export function hopBlocked(galaxy, fleet, hop, destination, status) {
  const controller = controllerOf(galaxy, hop);
  if (!controller || key(controller) === key(fleet.owner)) return false;
  if (hop !== destination && benefits(fleet.owner)) return false;
  return status < 2;
}

export function reachList(galaxy, mover, target, status) {
  const any = status === 5,
    pass = status === 1 || status === 5,
    cross = status > 2,
    own = status > 1,
    benefit = benefits(mover);
  let orbit = null;
  const hostile = p => hostilePlace(galaxy, p, mover, (orbit ||= orbitIndex(galaxy)));
  const usable = p => {
    if (p.background || p.destroyed || p.restricted || !known(galaxy, p)) return false;
    const corrupt = benefit && corrupted(p);
    if (!(ally(mover, p) || corrupt || any)) return cross && !hostile(p);
    return pass || corrupt || !hostile(p);
  };
  if (!own && !ally(mover, target)) return [];
  const seen = new Set([target.index]),
    flood = start => {
      const queue = [start],
        out = [];
      seen.add(start.index);
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i];
        if (ally(mover, p)) out.push(p);
        for (const link of galaxy.links[p.index] || []) {
          const next = galaxy.planets[link.to];
          if (!seen.has(next.index) && usable(next)) {
            seen.add(next.index);
            queue.push(next);
          }
        }
      }
      return out;
    };
  if (ally(mover, target) && (pass || !hostile(target))) {
    return flood(target);
  }
  const regions = [];
  for (const link of galaxy.links[target.index] || []) {
    const n = galaxy.planets[link.to];
    if (!seen.has(n.index) && usable(n)) regions.push(flood(n));
  }
  if (status === 4) return regions.flat();
  return regions.reduce((best, r) => (r.length > best.length ? r : best), []);
}
