import { db } from '../gamedata.js';
import { bountyValue, roundAway } from './bounty.js';
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
  const player = killer && g.players.find(p => key(p.faction) === key(killer));
  if (!player || !planet || friendly(owner, killer)) return 0;
  const benefits = f => !!db.faction(f)?.bool('Benefits_From_Corruption');
  let paid = false;
  if (benefits(killer)) paid = (planet.currentCorruption ?? -1) === 3;
  else if (benefits(owner)) paid = g.planets.some(q => /^NalHutta(_Story)?$/i.test(q.type.name) && key(q.owner) === key(killer));
  if (!paid) return 0;
  const n = roundAway(bountyValue(record.carries || record.type, !!game.setup?.net));
  if (!(n > 0)) return 0;
  adjustCredits(g, killer, n);
  player.bounty = (player.bounty || 0) + n;
  return n;
}
