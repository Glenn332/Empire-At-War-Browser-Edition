import { db } from '../gamedata.js';
import { strategicStealth } from './galacticfog.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();

const relations = new Map(),
  UNSET = -1;
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
  const fa = db.faction(a),
    fb = db.faction(b);
  if (fa?.bool('Is_Neutral') || fb?.bool('Is_Neutral')) return 2;
  if (fa?.list('Enemies').some(n => key(n) === key(b))) return 1;
  if (fa?.list('Allies').some(n => key(n) === key(b))) return 0;
  return undefined;
}
export const enemy = (a, b) => relation(a, b) === 1;

export const hidden = fleet => fleet.units.length > 0 && fleet.units.every(u => strategicStealth(u));
const live = fleet => fleet.units.some(u => !u.dead);

export function conflictAt(galaxy, p, owner, fleet = null) {
  if (fleet && hidden(fleet)) return false;
  const planet = galaxy.planets[p];
  if (planet.station && (planet.spaceLevel || 0) > 0 && enemy(planet.stationOwner || planet.owner, owner)) return true;
  return galaxy.fleets.some(f => f !== fleet && f.planet === p && !f.leg && live(f) && !hidden(f) && enemy(owner, f.owner));
}
