import { simRandom } from './simrandom.js';
import { db } from '../gamedata.js';

const key = s => String(s || '').trim().toUpperCase();
const same = (a, b) => key(a) === key(b);
const yes = s => !/^(no|false|0)$/i.test(String(s ?? 'yes').trim() || 'yes');

const holder = p => p.politicalOwner ?? p.owner;

export const planetBonusesOn = p => !!holder(p) && !p.destroyed && (p.currentCorruption ?? -1) !== 0 && !db.faction(holder(p))?.bool('Is_Neutral');

const abilitiesOf = (type, tag) => type.sub('Abilities').flatMap(n => n.children).filter(a => a.tag.toUpperCase() === tag && yes(a.val('Initially_Enabled', 'Yes')));

export function techFactor(g, owner) {
  let sum = 0;
  for (const p of g.planets) if (same(holder(p), owner) && planetBonusesOn(p)) for (const a of abilitiesOf(p.type, 'REDUCE_TECHNOLOGY_PRICE_ABILITY')) sum += Math.min(1, a.num('Price_Reduction_Percentage', 0));
  return Math.max(0.0001, 1 - sum);
}

export function galaxyWideUpgrades(g) {
  const out = {};
  for (const p of g.planets) {
    if (!planetBonusesOn(p)) continue;
    for (const a of abilitiesOf(p.type, 'GALAXY_WIDE_UPGRADE_ABILITY')) {
      const own = out[holder(p)] ||= { space: [], land: [] };
      for (const [list, tag] of [[own.space, 'Space_Upgrade_Type'], [own.land, 'Land_Upgrade_Type']]) { const name = a.val(tag).trim(); if (name && db.type(name)) list.push(name); }
    }
  }
  return out;
}

export function giveFreeUpgrades(names, faction, has, give) {
  for (const name of names || []) {
    const head = db.type(name);
    if (!head || !head.list('Affiliation').some(n => same(n, faction)) || head.str('Previous_Upgrade_Level_Type').trim()) continue;
    let held = false;
    for (let t = head, seen = new Set(); t && !seen.has(t); t = db.type(t.str('Next_Upgrade_Level_Type').trim())) { seen.add(t); if (has(t)) { held = true; break; } }
    if (!held) give(head);
  }
}

export function stepGambling(g, now, random = simRandom) {
  for (const p of g.planets) {
    const arenas = (p.owner && !p.destroyed ? p.groundStructures : []).filter(u => !u.dead && same(u.owner, p.owner)).flatMap(u => abilitiesOf(u.type, 'PLANET_INCOME_GAMBLING_ABILITY').map(a => [u, a]));
    if (!arenas.length) { if (p.gambling) p.gambling = null; continue; }
    const state = p.gambling ||= { next: 0, mod: 0 };
    if (now + 1e-7 < state.next) continue;
    let mod = 0;
    for (const [, a] of arenas) {
      const lo = a.num('Min_Income_Modifier', 0), hi = a.num('Max_Income_Modifier', 0), chance = a.num('Chance_To_Win', 0), interval = a.num('Evaluation_Interval_In_Secs', 0);
      mod += chance <= random() ? lo * random() : hi * random();
      state.next = now + Math.max(interval, 1);
    }
    state.mod = mod;
  }
}
