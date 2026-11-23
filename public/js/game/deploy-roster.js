// Only the player-facing class list is grouped. A card still refers to one
// real company, reserve pool, hero or seat; never synthesize pooled resources.
export const cardGroup = (c, nameOf) => `${c.vehicle ? 'ride' : c.hero || c.heroSpawn ? 'hero' : 'foot'}:${nameOf(c).trim().toLowerCase()}`;
export function groupRoster(raw, nameOf, picked) {
  const groups = new Map();
  const sameSource = c =>
    picked &&
    c.unit === picked.unit &&
    c.company === picked.company &&
    c.vehicle === picked.vehicle &&
    c.hero === picked.hero &&
    c.gid === picked.gid;
  for (const c of raw) {
    if (c.gid && c.spare <= 0) continue;
    const key = cardGroup(c, nameOf),
      old = groups.get(key);
    // Prefer an existing hero, then the cheapest source. If tied, retain
    // the player's available seat/pool rather than hopping between duplicates.
    const rank = x => (x.hero ? -1 : x.cost || 0);
    if (!old || rank(c) < rank(old) || (rank(c) === rank(old) && sameSource(c))) groups.set(key, c);
  }
  return [...groups.values()];
}
