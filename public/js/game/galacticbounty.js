import { db } from '../gamedata.js';
import { bountyValue, roundAway } from './bounty.js';
import { adjustCredits } from './galacticeconomy.js';
import { ownerChanged } from './galacticcorruption.js';

const key = s => String(s || '').toUpperCase();
const benefits = name => !!db.faction(name)?.bool('Benefits_From_Corruption');
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
  let paid = false;
  if (benefits(killer)) paid = (planet?.currentCorruption ?? -1) === 3;
  else if (benefits(owner))
    paid = g.planets.some(p => ['NALHUTTA', 'NALHUTTA_STORY'].includes(key(p.type.name)) && key(p.owner) === key(killer));
  if (!paid) return 0;
  const n = roundAway(value),
    player = g.players.find(p => key(p.faction) === key(killer));
  adjustCredits(g, killer, n * (player?.adjust?.credit ?? 1));
  player.bounty = (player.bounty || 0) + n;
  return n;
}
