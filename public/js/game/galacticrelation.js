import { db } from '../gamedata.js';
import { strategicStealth } from './galacticfog.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();

const relations = new Map(),
  UNSET = -1;
let overrides = new Map();
export function setDiplomacy(table) {
  overrides = new Map(Object.entries(table || {}));
  relations.clear();
}
export function diplomacy(a, b) {
  return overrides.get(key(a) + '|' + key(b));
}
export function setRelation(galaxy, a, b, r) {
  if (!galaxy || !a || !b || key(a) === key(b)) return;
  (galaxy.diplomacy ||= {})[key(a) + '|' + key(b)] = r;
  setDiplomacy(galaxy.diplomacy);
}
export function relation(a, b) {
  let row = relations.get(a);
  if (!row) {
    row = new Map();
    relations.set(a, row);
  }
  let r = row.get(b);
  if (r === undefined) {
    r = relationOf(a, b) ?? UNSET;
    row.set(b, r);
  }
  return r === UNSET ? undefined : r;
}
function relationOf(a, b) {
  if (!a || !b || key(a) === key(b)) return 0;
  const set = overrides.get(key(a) + '|' + key(b));
  if (set !== undefined) return set;
  const fa = db.faction(a),
    fb = db.faction(b);
  if (fa?.bool('Is_Neutral') || fb?.bool('Is_Neutral')) return 2;
  if (fa?.list('Enemies').some(n => key(n) === key(b))) return 1;
  if (fa?.list('Allies').some(n => key(n) === key(b))) return 0;
  return undefined;
}
export const enemy = (a, b) => relation(a, b) === 1;

export const hidden = fleet => fleet.units.length > 0 && fleet.units.every(u => strategicStealth(u, fleet.owner));
const live = fleet => fleet.units.some(u => !u.dead);

export function conflictAt(galaxy, p, owner, fleet = null) {
  if (fleet && hidden(fleet)) return false;
  const planet = galaxy.planets[p];
  if (planet.station && (planet.spaceLevel || 0) > 0 && enemy(planet.stationOwner || planet.owner, owner)) return true;
  return galaxy.fleets.some(f => f !== fleet && f.planet === p && !f.leg && live(f) && !hidden(f) && enemy(owner, f.owner));
}
