import { startRemoval } from './galacticcorruption.js';
import { db } from '../gamedata.js';
import { adjustCredits } from './galacticeconomy.js';
import { changeController } from './galacticpolitics.js';
import { scheduleHeroRespawn } from './galacticherorespawn.js';
import { destroyPlanet } from './planetdestruction.js';
import { allied } from './galacticvictory.js';

const key = s => String(s || '').toUpperCase();
const playerOf = (g, faction) => g.players.find(p => key(p.faction) === key(faction));
export const hackCost = () => db.constants.num('Hack_Super_Weapon_Cost', 0);

function target(game, actor, planet) {
  const wanted = key(db.constants.str('Hack_Super_Weapon_Required_Type'));
  if (!wanted || !planet || planet.destroyed || planet.background) return null;
  for (const f of game.galaxy.fleets)
    if (f.planet === planet.index && !f.leg && !allied(actor.owner, f.owner))
      for (const u of f.units) if (!u.dead && key((u.carries || u.type).name) === wanted) return u;
  return null;
}

const humanHacker = (game, player) => !!player && (player.ai === null || key(player.faction) === key(game.me));

export function canHack(game, actor, planet) {
  const player = playerOf(game.galaxy, actor.owner);
  return !!target(game, actor, planet) && (!humanHacker(game, player) || (player?.credits ?? 0) >= hackCost());
}

export function activateHack(game, actor, planet, ability) {
  const player = playerOf(game.galaxy, actor.owner);
  if (!player || !target(game, actor, planet)) return false;
  if (humanHacker(game, player)) {
    game.openHackDialog?.({ actor, planet });
    return false;
  }
  return executeHack(game, actor, planet, true);
}

export function executeHack(game, actor, planet, free = false) {
  const g = game.galaxy,
    player = playerOf(g, actor.owner),
    cost = free ? 0 : hackCost();
  if (!player || actor.dead || !target(game, actor, planet) || player.credits < cost) {
    if (key(actor.owner) === key(game.me)) game.audio?.play('GUI_Bad_Sound');
    return false;
  }
  if (cost) adjustCredits(g, player.faction, -cost);
  if (startRemoval(game, planet, 5)) game.story?.generic?.('decrease_corruption');
  if (!free) game.audio?.play(db.faction(player.faction)?.str('SFXEvent_Hack_Success').trim());
  game.story?.abilityLanded?.(planet, actor);
  scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, 0, true);
  game.story?.despawn?.(actor);
  for (const f of g.fleets)
    if (f.planet === planet.index && !f.leg && !allied(actor.owner, f.owner)) {
      for (const u of f.units) {
        scheduleHeroRespawn(game, u, planet, f.owner);
        u.dead = true;
      }
      f.units = [];
    }
  g.fleets = g.fleets.filter(f => f.units.length || f.leg);
  game.galacticBattleChanged?.();
  if (!destroyPlanet(game, planet)) return false;
  const neutral = [...db.factions.values()].find(f => f.bool('Is_Neutral'));
  if (neutral) changeController(planet, neutral.name, g);
  game.ui?.refresh?.();
  return true;
}
