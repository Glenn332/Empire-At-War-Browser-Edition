import { db } from '../gamedata.js';

const key = s => String(s || '').trim().toLowerCase();

function table(multiplayer) {
  const t = new Map();
  for (const [c, v] of db.constants.tuples(multiplayer ? 'Default_Bounty_By_Category_MP' : 'Default_Bounty_By_Category_SP')) { const n = parseFloat(v); if (c && Number.isFinite(n)) t.set(c.toUpperCase(), n); }
  return t;
}

export function bountyValue(type, multiplayer = false) {
  let v = type.num(multiplayer ? 'Override_Bounty_MP' : 'Override_Bounty_SP', -1);
  if (v >= 0) return v;
  const by = table(multiplayer);
  for (const c of type.categories()) { const n = by.get(c); if (n !== undefined && n > v) v = n; }
  return v > 0 ? v : 0;
}

export const roundAway = x => (x >= 0 ? Math.trunc(x + 0.5) : Math.trunc(x - 0.5));

export class BountyBook {
  constructor() {
    this.enabled = true;
    this.rules = new Map();
  }

  add(owner, ability, source, allies = [owner]) {
    const pct = Math.max(0, ability.num('Bounty_Percentage_Amount', 0)), category = parseInt(ability.val('Stacking_Category'), 10) || 0;
    const targets = ability.val('Target_Faction_Names').split(/[\s,]+/).filter(Boolean).map(key);
    for (const p of /^(yes|true|1)$/i.test(ability.val('Apply_To_All_Allies')) ? allies : [owner]) {
      const byFaction = this.rules.get(p) || this.rules.set(p, new Map()).get(p);
      for (const f of targets) {
        const byCategory = byFaction.get(f) || byFaction.set(f, new Map()).get(f);
        const sources = byCategory.get(category) || byCategory.set(category, new Map()).get(category);
        sources.set(source, pct);
      }
    }
  }

  percent(player, faction) {
    const byCategory = this.rules.get(player)?.get(key(faction));
    if (!byCategory) return 0;
    let sum = 0;
    for (const sources of byCategory.values()) { let best = -Infinity; for (const pct of sources.values()) if (pct > best) best = pct; if (best > -Infinity) sum += best; }
    return sum;
  }

  payouts(players, killer, victimFaction, value, allied) {
    const out = [];
    if (!this.enabled || killer === undefined || killer === null || !(value > 0)) return out;
    for (const p of players) {
      if (!allied(p, killer)) continue;
      const pct = this.percent(p, victimFaction);
      if (!(pct > 0)) continue;
      out.push([p, Math.max(1, roundAway(pct * value))]);
    }
    return out;
  }
}
