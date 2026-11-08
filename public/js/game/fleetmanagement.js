import { embarkGround, landFriendly } from './invasion.js';
import { db } from '../gamedata.js';
import { isHumanFaction } from './galaxy.js';

export function pathfinderCell() {
  const i = Math.trunc(db.constants?.num('Pathfinder_Slot_Index', 0) ?? 0);
  return i < 0 ? null : String(Math.floor(i / 7)).padStart(2, '0') + String(i % 7).padStart(2, '0');
}

export function aiPathfinder(g, owner, records) {
  if (!g.aiPathfinders || isHumanFaction(g, owner) || !records.length || records.some(u => u.pathfinder)) return null;
  const up = s => String(s || '').toUpperCase(),
    wanted = db.constants.list('Preferred_Pathfinder_Types').map(up),
    types = u => [u.type, u.carries].filter(Boolean),
    hero = u => types(u).some(t => t.bool('Is_Named_Hero') || t.list('Company_Units').some(n => db.type(n)?.bool('Is_Named_Hero')));
  for (const heroes of [false, true])
    for (const name of wanted) {
      const u = records.find(r => hero(r) === heroes && types(r).some(t => up(t.name) === name));
      if (u) return u;
    }
  return null;
}

export function markPathfinder(fleet, record) {
  for (const u of fleet.units) if (u.pathfinder && u !== record) delete u.pathfinder;
  if (record && fleet.units.includes(record)) record.pathfinder = true;
}

const spaceSuperweapon = record =>
  (record?.carries || record?.type)
    ?.list('SpaceBehavior')
    .some(b => b.toUpperCase() === 'TACTICAL_SUPER_WEAPON') ?? false;

export function dropOverviewUnits(game, source, target) {
  if (!source || !target || game.busy || game.over || game.controlsLocked) return false;
  const g = game.galaxy,
    owner = game.me,
    p = g.planets[target.planet];
  if (!p || source.planet !== target.planet) return false;
  if (target.kind === 'fleet') {
    if (source.kind === 'ground')
      return !!embarkGround(g, p.index, owner, { records: source.records, fleet: target.fleet, slot: target.slot });
    if (target.pf && pathfinderCell() && (source.records || []).some(spaceSuperweapon)) {
      game.audio?.play('GUI_Bad_Sound');
      return false;
    }
    const fleet = transferFleetUnits(g, source.fleet, owner, target.slot, source.records, target.fleet);
    if (fleet && target.pf && source.records?.length === 1 && pathfinderCell()) markPathfinder(fleet, source.records[0]);
    else if (fleet) for (const u of source.records || []) delete u.pathfinder;
    return !!fleet;
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
