import { db } from '../gamedata.js';
import { strategicStealth, VIS } from './galacticfog.js';

const key = s => String(s || '').trim().toUpperCase();
const same = (a, b) => !!a && !!b && key(a) === key(b);
export const allied = (a, b) => same(a, b) || !!db.faction(a)?.list('Allies').some(n => same(n, b));
const strength = p => db.faction(p.politicalOwner ?? p.owner)?.bool('Is_Neutral') ? 0 : (p.politicalValue ?? 1);

export function hostilePresence(galaxy, planet, owner, v = galaxy.visibility?.planets?.[planet.index]) {
  const ctl = planet.politicalOwner ?? planet.owner;
  if ((planet.spaceLevel || 0) > 0) return !(ctl && allied(owner, ctl) && strength(planet) > 0);
  if (v && !((v.mask || 0) & VIS.FLEET_PRESENCE)) return false;
  return galaxy.fleets.some(f => f.planet === planet.index && !f.leg && f.units.length && !allied(owner, f.owner));
}

export function humanRoute(galaxy, fleet) {
  const owner = fleet.owner, benefits = !!db.faction(owner)?.bool('Benefits_From_Corruption');
  const stealth = fleet.units.length > 0 && fleet.units.every(u => strategicStealth(u)), vis = galaxy.visibility?.planets;
  return (planet, isTarget) => {
    if (vis && !vis[planet.index]?.discovered) return null;
    if (isTarget || stealth || !hostilePresence(galaxy, planet, owner, vis?.[planet.index])) return 0;
    return benefits && (planet.currentCorruption ?? -1) !== -1 ? 100 : null;
  };
}

export function humanReach(galaxy, fleet) {
  const route = humanRoute(galaxy, fleet), seen = new Set([fleet.planet]);
  if (!galaxy.planets[fleet.planet]) return seen;
  const reach = new Set(), queue = [fleet.planet];
  for (let i = 0; i < queue.length; i++) for (const edge of galaxy.links[queue[i]] || []) {
    if (seen.has(edge.to)) continue;
    const planet = galaxy.planets[edge.to];
    if (route(planet, true) === null) continue;
    seen.add(edge.to); reach.add(edge.to);
    if (route(planet, false) !== null) queue.push(edge.to);
  }
  reach.add(fleet.planet);
  return reach;
}
