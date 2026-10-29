import { db } from '../gamedata.js';
import { strategicStealth } from './galacticfog.js';
const key = s => String(s || '').toUpperCase();
export function retreatDestination(g, from, owner, land = false, forced = false) {
  const same = n => key(n) === key(owner);
  const spaceOwner = q => {
    if (q.station) return q.stationOwner || q.owner;
    const fleets = g.fleets.filter(f => f.planet === q.index && !f.leg && f.units.some(u => !u.dead));
    return (fleets.find(f => f.units.some(u => !u.dead && !strategicStealth(u))) || fleets[0])?.owner;
  };
  const tiers = [
    q => same(spaceOwner(q)),
    q => same(q.groundBaseOwner ?? (q.garrison.length || q.groundStructures.length ? q.owner : null)) || same(q.stationOwner),
    q => !q.owner || db.faction(q.politicalOwner ?? q.owner)?.bool('Is_Neutral'),
    () => true
  ];
  const order = land && forced ? [1, 0, 2, 3] : [0, 1, 2, 3];
  for (const i of order) {
    let dest = null,
      best = Infinity;
    for (const q of g.planets) {
      if (q.destroyed || q.background || !q.owner || (q === from && (!land || i === 3)) || !tiers[i](q)) continue;
      const d = q.pos.reduce((n, v, j) => n + (v - from.pos[j]) ** 2, 0);
      if (d < best) {
        best = d;
        dest = q;
      }
    }
    if (dest) return dest;
  }
  return from;
}
