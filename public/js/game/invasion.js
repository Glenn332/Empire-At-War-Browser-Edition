import { db } from '../gamedata.js';
import { forceKind } from './galaxy.js';
import { ownerCorruption } from './galacticbounty.js';
import { groundLevel } from './galacticproduction.js';
import { changeController } from './galacticpolitics.js';

export const carriedCompany = u => u.carries || (forceKind(u.type) === 'company' ? u.type : null);
export const companyTransport = type => type && db.type(type.list('Company_Transport_Unit')[0]);
export const tacticalTransportType = record =>
  forceKind(record.type) === 'company' ? companyTransport(carriedCompany(record)) || record.type : record.type;
const hostile = (owner, other) =>
  !!other &&
  !!db
    .faction(owner)
    ?.list('Enemies')
    .some(n => n.toUpperCase() === other.toUpperCase());
const restrictions = new WeakMap(),
  masks = new WeakMap();
export function planetAllowsCompany(pl, type) {
  let r = restrictions.get(pl.type);
  if (!r) {
    r = {
      names: new Set(pl.type.list('Planet_Restricted_Unit_Types').map(n => n.toUpperCase())),
      categories: new Set(pl.type.list('Planet_Restricted_Unit_Categories').map(n => n.toUpperCase()))
    };
    restrictions.set(pl.type, r);
  }
  if (!r.names.size && !r.categories.size) return true;
  let m = masks.get(type);
  if (!m) {
    m = { name: type.name.toUpperCase(), cats: type.list('CategoryMask').map(n => n.toUpperCase()) };
    masks.set(type, m);
  }
  return !r.names.has(m.name) && !m.cats.some(n => r.categories.has(n));
}

export function embarkGround(g, p, owner, { records = null, fleet = null, slot, fresh = false } = {}) {
  const pl = g.planets[p];
  if (!pl || pl.owner !== owner) return null;
  if (slot !== undefined && (!Number.isInteger(slot) || slot < 0 || slot > 2)) return null;
  if (fleet && (!g.fleets.includes(fleet) || fleet.planet !== p || fleet.owner !== owner || fleet.leg)) return null;
  const selected = records === null ? null : new Set(records);
  const troops = pl.garrison.filter(
    u => !u.dead && u.owner === owner && (!selected || selected.has(u)) && companyTransport(carriedCompany(u))
  );
  if (!troops.length) return null;
  fleet ||= !fresh && g.fleets.find(f => f.planet === p && f.owner === owner && !f.leg && (slot === undefined || (f.slot ?? 0) === slot));
  if (!fleet) {
    fleet = { owner, units: [], planet: p, pos: null, path: [], dest: -1, leg: null };
    if (slot !== undefined) fleet.slot = slot;
    g.fleets.push(fleet);
  }
  for (const u of troops) {
    u.carries = carriedCompany(u);
    u.type = companyTransport(u.carries);
    fleet.units.push(u);
  }
  const moved = new Set(troops);
  pl.garrison = pl.garrison.filter(u => !moved.has(u));
  return fleet;
}

export function canLand(g, fleet, p, { raid = false } = {}) {
  const pl = g.planets[p];
  return (
    !!pl &&
    !pl.destroyed &&
    !pl.background &&
    (pl.owner === fleet.owner || pl.invasionEnabled !== false) &&
    pl.type.bool('Planet_Surface_Accessible', true) &&
    fleet.planet === p &&
    !fleet.leg &&
    fleet.units.some(u => carriedCompany(u) && planetAllowsCompany(pl, carriedCompany(u))) &&
    (raid ||
      (!(pl.station && hostile(fleet.owner, pl.stationOwner || pl.owner)) &&
        !g.fleets.some(f => f !== fleet && f.planet === p && !f.leg && f.units.length && hostile(fleet.owner, f.owner))))
  );
}

export function landFriendly(g, fleet, p, { records = null, raid = false } = {}) {
  const pl = g.planets[p];
  if (!canLand(g, fleet, p, { raid }) || pl.owner !== fleet.owner) return false;
  const selected = records === null ? null : new Set(records);
  let room = Math.max(0, db.constants.num('Max_Ground_Forces_On_Planet', 10) - pl.garrison.length),
    landed = false;
  fleet.units = fleet.units.filter(u => {
    const type = carriedCompany(u);
    if (u.dead || (selected && !selected.has(u)) || !type || !planetAllowsCompany(pl, type) || room <= 0) return true;
    u.type = type;
    u.carries = null;
    u.owner = fleet.owner;
    pl.garrison.push(u);
    room--;
    landed = true;
    return false;
  });
  g.fleets = g.fleets.filter(f => f.units.length);
  return landed;
}

export function invasionForces(g, p, attacker) {
  return g.fleets.flatMap((f, fi) =>
    f.planet === p && !f.leg && f.owner === attacker
      ? f.units.flatMap((u, ui) => {
          const type = carriedCompany(u);
          return type && planetAllowsCompany(g.planets[p], type) ? [{ gid: fi + ':' + ui, type: type.name }] : [];
        })
      : []
  );
}

export function applyInvasionResult(g, r) {
  const pl = g.planets[r.planet];
  if (!pl || !r.sides || !Array.isArray(r.participants)) return;
  const [attacker, defender] = r.sides,
    alive = new Set(r.alive),
    involved = new Set(r.participants);
  for (const f of g.fleets) for (const u of f.units) delete u.raiding;
  const won = r.winner === 'attacker',
    landed = [];
  g.fleets.forEach((f, fi) => {
    if (f.planet !== r.planet || f.leg || f.owner !== attacker) return;
    f.units = f.units.filter((u, ui) => {
      const id = fi + ':' + ui;
      if (!involved.has(id)) return true;
      if (!alive.has(id)) {
        u.dead = true;
        return false;
      }
      if (won) {
        u.type = carriedCompany(u);
        u.carries = null;
        u.owner = attacker;
        landed.push(u);
        return false;
      }
      return true;
    });
  });
  g.fleets = g.fleets.filter(f => f.units.length);
  const retain = (u, id) => {
    const keep = won ? u.owner === attacker : u.owner !== defender || alive.has(id);
    if (!keep) u.dead = true;
    return keep;
  };
  pl.garrison = pl.garrison.filter((u, i) => retain(u, 'g:' + i));
  pl.groundStructures = pl.groundStructures.filter((u, i) => retain(u, 's:' + i));
  if (won) {
    const oldOwner = pl.owner;
    changeController(pl, attacker, g);
    ownerCorruption(pl, oldOwner, attacker, g);
    const capacity = db.constants.num('Max_Ground_Forces_On_Planet', 10);
    for (const u of landed) {
      if (pl.garrison.length < capacity) pl.garrison.push(u);
      else {
        let fleet = g.fleets.find(f => f.planet === r.planet && !f.leg && f.owner === attacker);
        if (!fleet) {
          fleet = { owner: attacker, units: [], planet: r.planet, pos: null, path: [], dest: -1, leg: null };
          g.fleets.push(fleet);
        }
        u.carries = u.type;
        u.type = companyTransport(u.type) || u.type;
        fleet.units.push(u);
      }
    }
    if (pl.station && (pl.stationOwner || oldOwner) !== attacker) {
      pl.station = null;
      pl.spaceLevel = 0;
      pl.stationOwner = null;
    }
    pl.orbitalStructures = pl.orbitalStructures.filter(u => {
      if (u.owner === attacker) return true;
      u.dead = true;
      return false;
    });
  }
  if (Array.isArray(r.tacticalStructures))
    pl.tacticalStructures = r.tacticalStructures.flatMap(u => {
      const type = db.type(u.type);
      return type ? [{ ...u, type, position: u.position.slice() }] : [];
    });
  const level = groundLevel(pl, pl.owner),
    winner = won ? attacker : defender;
  pl.tacticalStructures = (pl.tacticalStructures || []).filter(u => u.owner === winner && u.baseLevel <= level);
}
