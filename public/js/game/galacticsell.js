import { isHero } from './abilityslots.js';
import { adjustCredits } from './galacticeconomy.js';

const key = s => String(s || '').toUpperCase();
const superType = t => !!t && t.list('CategoryMask').some(m => /^super$/i.test(m));

export function locateRecord(g, rec) {
  if (!rec) return null;
  for (const f of g.fleets) if (f.units.includes(rec)) return { list: f.units, owner: f.owner, fleet: f, planet: f.leg ? -1 : f.planet };
  for (const p of g.planets)
    for (const list of [p.garrison, p.groundStructures, p.orbitalStructures])
      if (list.includes(rec)) return { list, owner: rec.owner ?? p.owner, fleet: null, planet: p.index };
  return null;
}

export const sellPrice = rec => Math.trunc((rec.carries || rec.type).num('Build_Cost_Credits', 0) / 2);

export function canSell(g, rec, faction) {
  const at = rec && !rec.dead && locateRecord(g, rec);
  if (!at || at.planet < 0 || key(at.owner) !== key(faction)) return false;
  const rule = key((rec.carries || rec.type)?.str('Is_Sellable').trim());
  if (rule === 'SELLABLE_NEVER') return false;
  if (rule === 'SELLABLE_ALWAYS') return true;
  return !isHero(rec) && !superType(rec.type) && !superType(rec.carries);
}

export function sellRecord(g, rec, faction) {
  if (!canSell(g, rec, faction)) return 0;
  const at = locateRecord(g, rec),
    price = sellPrice(rec);
  at.list.splice(at.list.indexOf(rec), 1);
  if (at.fleet && !at.fleet.units.length) g.fleets = g.fleets.filter(f => f !== at.fleet);
  rec.dead = true;
  if (price > 0) adjustCredits(g, faction, price);
  return Math.max(1, price);
}
