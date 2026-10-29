import { embarkGround, landFriendly } from './invasion.js';

export function dropOverviewUnits(game, source, target) {
  if (!source || !target || game.busy || game.over || game.controlsLocked) return false;
  const g = game.galaxy,
    owner = game.me,
    p = g.planets[target.planet];
  if (!p || source.planet !== target.planet) return false;
  if (target.kind === 'fleet') {
    if (source.kind === 'ground')
      return !!embarkGround(g, p.index, owner, { records: source.records, fleet: target.fleet, slot: target.slot });
    return !!transferFleetUnits(g, source.fleet, owner, target.slot, source.records, target.fleet);
  }
  if (source.kind !== 'fleet' || source.fleet.owner !== owner) return false;
  if (p.owner === owner) return landFriendly(g, source.fleet, p.index, { records: source.records });
  return !!game.land(source.fleet, p.index, { records: source.records });
}
export function reachableFleetPlanets(g, from) {
  const seen = new Set();
  if (!g.planets[from]) return seen;
  const queue = [from];
  seen.add(from);
  for (let i = 0; i < queue.length; i++)
    for (const edge of g.links[queue[i]] || [])
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
  return seen;
}

export function orbitalFleet(g, planet, owner, slot = 0) {
  return g.fleets.find(f => !f.leg && f.planet === planet && f.owner === owner && (f.slot ?? 0) === slot) || null;
}

export function transferFleetUnits(g, source, owner, slot, records = null, target = null) {
  if (!g.fleets.includes(source) || source.leg || source.owner !== owner || !Number.isInteger(slot) || slot < 0 || slot > 2) return null;
  if (target && (!g.fleets.includes(target) || target.leg || target.planet !== source.planet || target.owner !== owner)) return null;
  const units = records ? source.units.filter(u => records.includes(u) && !u.dead) : source.units.filter(u => !u.dead);
  if (!units.length) return null;
  target ||= orbitalFleet(g, source.planet, owner, slot);
  if (target === source) return source;
  if (!target) {
    target = { owner, units: [], planet: source.planet, pos: null, path: [], dest: -1, leg: null, slot };
    g.fleets.push(target);
  }
  source.units = source.units.filter(u => !units.includes(u));
  target.units.push(...units);
  g.fleets = g.fleets.filter(f => f.units.length);
  return target;
}
