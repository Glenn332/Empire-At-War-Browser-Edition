import { db } from '../gamedata.js';
import { bountyValue, roundAway, BountyBook } from './bounty.js';
import { battleUpgrades } from './planetabilities.js';
import { adjustCredits } from './galacticeconomy.js';
import { ownerChanged } from './galacticcorruption.js';

const key = s => String(s || '').toUpperCase();
const friendly = (a, b) =>
  key(a) === key(b) ||
  !!db
    .faction(a)
    ?.list('Allies')
    .some(n => key(n) === key(b));

export function ownerCorruption(planet, oldOwner, newOwner, g) {
  ownerChanged({ galaxy: g }, planet, oldOwner, newOwner);
}

export function galacticBounty(game, record, planet, owner, killer) {
  const g = game.galaxy,
    story = game.story;
  if (story && story.bountyOn === false) return 0;
  if (!killer || friendly(owner, killer) || !g.players.some(p => key(p.faction) === key(killer))) return 0;
  const value = bountyValue(record.carries || record.type, false);
  if (!(value > 0)) return 0;
  const book = new BountyBook(),
    upgrades = battleUpgrades(g, planet);
  for (const p of g.players) {
    const own = upgrades[p.faction];
    if (!own) continue;
    for (const name of new Set([...own.space, ...own.land])) {
      const t = db.type(name);
      if (!t || !t.list('Affiliation').some(n => key(n) === key(p.faction))) continue;
      for (const a of t.sub('Abilities').flatMap(x => x.all('Bounty_On_Faction_Ability')))
        book.add(
          key(p.faction),
          a,
          key(t.name),
          g.players.filter(q => friendly(q.faction, p.faction)).map(q => key(q.faction))
        );
    }
  }
  const pct = book.percent(key(killer), owner);
  if (!(pct > 0)) return 0;
  const n = Math.max(1, roundAway(pct * value)),
    player = g.players.find(p => key(p.faction) === key(killer));
  adjustCredits(g, killer, n);
  player.bounty = (player.bounty || 0) + n;
  return n;
}
