import { simRandom } from './simrandom.js';
import { db } from '../gamedata.js';
import { adjustCredits } from './galacticeconomy.js';
import { scheduleHeroRespawn } from './galacticherorespawn.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const same = (a, b) => key(a) === key(b);
const yes = s => /^(yes|true|1)$/i.test(String(s || '').trim());
const main = f => ['REBEL', 'EMPIRE', 'UNDERWORLD'].includes(key(f));
const friendly = (a, b) =>
  same(a, b) ||
  !!db
    .faction(a)
    ?.list('Allies')
    .some(n => same(n, b));
const round = x => (x < 0 ? -Math.round(-x) : Math.round(x));
const live = list => list.filter(u => !u.dead);
const groundLevel = planet => Math.min(5, live(planet.groundStructures).length);
const controllerOf = planet => planet.politicalOwner ?? planet.owner;

export const structuresOf = planet => [...live(planet.groundStructures), ...live(planet.orbitalStructures)];
const countable = planet =>
  live(planet.groundStructures).length + ((planet.spaceLevel || 0) > 0 ? live(planet.orbitalStructures).length : 0);

export function sabotagePrice(ability, planet, structure, tutorial = false) {
  if (tutorial) return structure.type.num('Tutorial_Sabotage_Cost_Credits', 0) || structure.type.num('Sabotage_Cost_Credits', 0);
  const base = structure.type.num('Sabotage_Cost_Credits', 0);
  return base > 0 ? round(ability.num('Sabotage_Cost_Increase_Factor', 2) ** (planet.sabotageCount || 0) * base) : -1;
}

export function sabotageOptions(ability, planet, owner) {
  const out = [],
    ctrl = controllerOf(planet);
  if (yes(ability.val('Can_Reduce_Ground_Base_Level')) && groundLevel(planet) > 0) out.push(0);
  if (yes(ability.val('Can_Reduce_Starbase_Level')) && planet.station && (planet.spaceLevel || 0) > 0) out.push(1);
  if (yes(ability.val('Can_Cancel_Production')) && (planet.production?.space?.length || planet.production?.ground?.length)) out.push(2);
  if (yes(ability.val('Can_Destroy_Special_Structure')) && (planet.currentCorruption ?? -1) !== -1 && countable(planet) > 0) out.push(3);
  if (yes(ability.val('Can_Halt_Credit_Production')) && main(ctrl) && main(owner) && !same(ctrl, owner)) out.push(4);
  return out;
}

export function canSabotageWith(game, actor, planet, ability) {
  const ctrl = controllerOf(planet);
  return !!ctrl && !planet.background && !friendly(actor.owner, ctrl) && sabotageOptions(ability, planet, actor.owner).length > 0;
}

const playerOf = (g, f) => g.players.find(p => same(p.faction, f));
const nameOf = type => db.t(type.str('Text_ID')) || type.name;
const heroName = actor => nameOf(actor.record?.carries || actor.record?.type || actor.type);
const placeName = planet => nameOf(planet.type) || planet.name;

function tell(game, planet, actor, ally, enemy) {
  if (same(actor.owner, game.me)) game.message?.(ally);
  else if (same(planet.owner, game.me)) game.message?.(enemy);
}
const told = (game, planet, actor, structure) => {
  const fill = text =>
    String(text).replace('##1', heroName(actor)).replace('##2', nameOf(structure.type)).replace('##3', placeName(planet));
  tell(game, planet, actor, fill(db.t('TEXT_SABOTAGE_ACCOMPLISHED_ALLY')), fill(db.t('TEXT_SABOTAGE_ACCOMPLISHED_ENEMY')));
};

function effects(game, planet, owner) {
  game.planetAbilityEffect?.(planet, db.constants.str('Sabotage_Particle_Effect').trim(), '');
  const sfx = owner && same(owner, game.me) ? db.faction(owner)?.str('SFXEvent_Sabotage_Success').trim() : '';
  if (sfx) game.audio?.play(sfx);
}

function drop(game, planet, structure) {
  structure.dead = true;
  planet.groundStructures = planet.groundStructures.filter(u => u !== structure);
  planet.orbitalStructures = planet.orbitalStructures.filter(u => u !== structure);
  if (game.story) {
    game.story.objectCache = null;
    game.story.reasonCache?.clear();
  }
}

export function sabotageStructure(game, actor, planet, structure, price, free = false) {
  const g = game.galaxy,
    player = actor && playerOf(g, actor.owner);
  if (!free && (!player || price < 0 || price > player.credits)) return false;
  if (!structuresOf(planet).includes(structure)) return false;
  drop(game, planet, structure);
  game.story?.signal?.('STORY_GALACTIC_SABOTAGE', structure.type.name);
  if (!free) {
    adjustCredits(g, actor.owner, -price);
    scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, 0, true);
    game.story?.despawn?.(actor);
  }
  effects(game, planet, free ? null : actor.owner);
  planet.sabotageCount = (planet.sabotageCount || 0) + 1;
  if (!free) told(game, planet, actor, structure);
  game.ai?.invalidate?.();
  return true;
}

function reduceGround(game, actor, planet) {
  const level = groundLevel(planet),
    target = Math.max(0, level - 1);
  for (const s of [...live(planet.groundStructures)]) if (s.type.num('Required_Ground_Base_Level', 0) > target) drop(game, planet, s);
  while (groundLevel(planet) > target && live(planet.groundStructures).length) drop(game, planet, live(planet.groundStructures).at(-1));
  const fill = (a, e) => {
    const f = t => t.replace('%s', heroName(actor)).replace('%s', placeName(planet)).replace('%u', target);
    tell(game, planet, actor, f(a), f(e));
  };
  if (target === 0)
    fill(
      'TEMP TEXT: %s has destroyed the ground base on %s!',
      'TEMP TEXT: Sabotage! An enemy hero, %s, has destroyed your ground base on %s!'
    );
  else
    fill(
      'TEMP TEXT: %s has reduced ground base on %s to level %u!',
      'TEMP TEXT: Sabotage! An enemy hero, %s, has reduced your ground base on %s to level %u!'
    );
  return true;
}

function refundUpgrade(game, planet, old) {
  const next = db.type(old.str('Next_Level_Base').trim()),
    list = planet.production?.space;
  if (!next || !list) return;
  const at = list.map(item => item.type).lastIndexOf(next);
  if (at < 0) return;
  const [item] = list.splice(at, 1);
  adjustCredits(game.galaxy, item.owner, item.ai ? item.paid || 0 : item.cost);
}

function reduceStation(game, actor, planet) {
  const old = planet.station;
  if (!old) return false;
  refundUpgrade(game, planet, old);
  const next = db.type(old.str('Prev_Level_Base').trim());
  game.story?.stationChanged?.(planet, old, next || null, actor.owner);
  planet.station = next || null;
  planet.spaceLevel = next ? Math.min(5, next.num('Base_Level', 0)) : 0;
  if (!next) planet.stationOwner = null;
  const level = planet.spaceLevel,
    fill = (a, e) => {
      const f = t => t.replace('%s', heroName(actor)).replace('%s', placeName(planet)).replace('%u', level);
      tell(game, planet, actor, f(a), f(e));
    };
  if (!next)
    fill('TEMP TEXT: %s has destroyed the starbase on %s!', 'TEMP TEXT: Sabotage! An enemy hero, %s, has destroyed your starbase on %s!');
  else
    fill(
      'TEMP TEXT: %s has reduced starbase on %s to level %u!',
      'TEMP TEXT: Sabotage! An enemy hero, %s, has reduced your starbase on %s to level %u!'
    );
  return true;
}

function cancelProduction(game, actor, planet) {
  for (const kind of ['space', 'ground']) {
    const list = planet.production?.[kind];
    if (!list?.length) continue;
    const item = list.shift(),
      name = nameOf(item.type);
    tell(
      game,
      planet,
      actor,
      `TEMP TEXT: ${heroName(actor)} has sabotaged the production of ${name} on ${placeName(planet)}!`,
      `TEMP TEXT: Sabotage! An enemy hero, ${heroName(actor)}, has disrupted the production of ${name} on ${placeName(planet)}!`
    );
    return true;
  }
  return false;
}

function haltIncome(game, actor, planet, ability) {
  const now = game.galaxy.time || 0,
    seconds = ability.num('Duration_Of_Credit_Halt', 0) > 0 ? ability.num('Duration_Of_Credit_Halt', 0) : 10;
  planet.incomeHaltUntil = Math.max(planet.incomeHaltUntil > now ? planet.incomeHaltUntil : 0, now + seconds);
  tell(
    game,
    planet,
    actor,
    `TEMP TEXT: ${heroName(actor)} has halted all credit production on ${placeName(planet)} for the next ${seconds} seconds!`,
    `TEMP TEXT: Sabotage! An enemy hero, ${heroName(actor)}, has halted all credit production from ${placeName(planet)} for the next ${seconds} seconds!`
  );
  return true;
}

function structureOutcome(game, actor, planet, ability) {
  const g = game.galaxy,
    player = playerOf(g, actor.owner),
    human = player?.ai === null || same(actor.owner, game.me);
  if (human) {
    const rows = structuresOf(planet).map(structure => ({
      structure,
      price: sabotagePrice(ability, planet, structure, !!player?.tutorial)
    }));
    game.openSabotageMenu?.({ actor, planet, ability, rows: rows.filter(r => r.price >= 1) });
    return false;
  }
  const can = structuresOf(planet).filter(structure => {
    const price = sabotagePrice(ability, planet, structure);
    return price <= player.credits;
  });
  if (!can.length) return false;
  const pick = can[Math.floor(simRandom() * can.length)];
  drop(game, planet, pick);
  planet.sabotageCount = (planet.sabotageCount || 0) + 1;
  told(game, planet, actor, pick);
  if (game.galaxy.visibility?.planets?.[planet.index]?.discovered ?? true) effects(game, planet, actor.owner);
  game.ai?.invalidate?.();
  return true;
}

export function activateSabotage(game, actor, planet, ability) {
  if (!canSabotageWith(game, actor, planet, ability)) return false;
  const options = sabotageOptions(ability, planet, actor.owner),
    code = options[Math.floor(simRandom() * options.length)];
  const hero = actor.record?.carries || actor.record?.type || actor.type,
    members = [
      hero,
      ...hero
        .list('Company_Units')
        .map(n => db.type(n))
        .filter(Boolean)
    ];
  if (planet.type.bool('Planet_Vigilance') && members.some(m => m.bool('Is_Generic_Hero'))) {
    if (same(actor.owner, game.me)) game.message?.(db.t('TEXT_SABOTAGE_FAILURE_VIGILANCE'));
    if (same(controllerOf(planet), game.me)) game.message?.(db.t('TEXT_SABOTAGE_PREVENTED_VIGILANCE'));
    scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, 0, true);
    return true;
  }
  const done =
    code === 0
      ? reduceGround(game, actor, planet)
      : code === 1
        ? reduceStation(game, actor, planet)
        : code === 2
          ? cancelProduction(game, actor, planet)
          : code === 3
            ? structureOutcome(game, actor, planet, ability)
            : haltIncome(game, actor, planet, ability);
  if (done) {
    game.story?.signal?.('STORY_LAND_ON', planet.type.name);
    scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, 0, true);
  }
  return done;
}

export function sabotageReward(game, planet, typeName) {
  const structure = live(planet.groundStructures).find(u => same(u.type.name, typeName));
  return !!structure && sabotageStructure(game, null, planet, structure, 0, true);
}
