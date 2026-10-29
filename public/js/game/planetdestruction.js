import { db } from '../gamedata.js';
import { allied, targetOwner, currentOwner, campaignPlanet } from './galacticvictory.js';
import { strategicStealth } from './galacticfog.js';
import { scheduleHeroRespawn } from './galacticherorespawn.js';
import { activateBlackMarket } from './blackmarket.js';
import { activateCorruption, activateRemoval, activateSiphon } from './galacticcorruption.js';
import { activateSlicer } from './galacticslicer.js';
import { activateSabotage } from './galacticsabotage.js';
import { activateHack } from './galactichack.js';
const key = x => String(x || '').toUpperCase(),
  list = x =>
    String(x || '')
      .split(',')
      .map(n => key(n.trim()))
      .filter(Boolean);
export const destroyedPlanetModel = p => p.type.str(p.destroyed ? 'Destroyed_Galactic_Model_Name' : 'Galactic_Model_Name');
const destroyers = new WeakMap();
export function hasPlanetDestruction(type) {
  if (!destroyers.has(type))
    destroyers.set(
      type,
      [type, ...type.list('Company_Units').map(n => db.type(n))]
        .filter(Boolean)
        .some(t =>
          t
            .sub('Abilities')
            .some(n =>
              n.children.some(
                a =>
                  key(a.tag) === 'PLANET_DESTRUCTION_ABILITY' && key(a.val('Activation_Style', 'Ground_Activated')) === 'GROUND_ACTIVATED'
              )
            )
        )
    );
  return destroyers.get(type);
}
export function planetDestructionAllowed(game, actor, planet) {
  if (!planet || !campaignPlanet(planet) || planet.destroyed || actor.dead || allied(actor.owner, targetOwner(planet))) return false;
  if (
    (actor.record || actor).checkContestedSpace !== false &&
    game.galaxy.fleets.some(
      f => f.planet === planet.index && !f.leg && f.units.some(u => !u.dead && !strategicStealth(u)) && !allied(actor.owner, f.owner)
    )
  )
    return false;
  return true;
}
function containsType(type, wanted, seen = new Set()) {
  if (!type || seen.has(type)) return false;
  seen.add(type);
  return (
    wanted.includes(key(type.name)) ||
    [...type.list('Company_Units'), ...type.list('Squadron_Units')].some(n => containsType(db.type(n), wanted, seen))
  );
}
export function destroyPlanetStory(host, p) {
  if (!host) return;
  for (const e of host.eventTypes.get('STORY_PLANET_DESTROYED') || []) {
    if (e.disabled || e.completed || !e.active || e.plot?.active === false) continue;
    const wanted = list(e.params[0]);
    if (wanted.length && !wanted.includes(key(p.name))) continue;
    const types = wanted.length ? list(e.params[3]) : [];
    const forces = [
      ...p.garrison,
      ...p.groundStructures,
      ...p.orbitalStructures,
      ...(host.galaxy || host.game.galaxy).fleets.filter(f => f.planet === p.index && !f.leg).flatMap(f => f.units)
    ];
    if (types.length && !forces.some(u => containsType(u.carries || u.type, types))) continue;
    host.fire(e);
  }
  const fields = {
    STORY_AI_NOTIFICATION: 0,
    STORY_CONSTRUCT_LEVEL: 0,
    STORY_DESTROY_BASE: 0,
    STORY_ENTER: 0,
    STORY_SPACE_TACTICAL: 1,
    STORY_LAND_TACTICAL: 1,
    STORY_HERO_MOVE: 1,
    STORY_LOAD_TACTICAL_MAP: 0,
    STORY_PLANET_DESTROYED: 0
  };
  for (const events of host.eventTypes.values())
    for (const e of events) {
      const index = fields[e.type];
      if (index === undefined) continue;
      const before = list(e.params[index]);
      if (!before.includes(key(p.name))) continue;
      const remaining = before.filter(n => n !== key(p.name));
      e.params[index] = remaining.join(',');
      if (!remaining.length) e.disabled = true;
    }
}
export function destroyPlanet(game, p, notify = true) {
  if (!p || p.destroyed) return false;
  if (notify) destroyPlanetStory(game.story, p);
  for (const record of [...p.garrison, ...p.groundStructures, ...(p.tacticalStructures || [])]) {
    scheduleHeroRespawn(game, record, p, record.owner);
    record.dead = true;
    const wrapped = game.story?.objectWrappers?.get(record);
    if (wrapped) wrapped.__object.dead = true;
  }
  p.garrison = [];
  p.groundStructures = [];
  p.tacticalStructures = [];
  p.groundLevel = 0;
  p.currentCorruption = -1;
  p.creditSiphonOwner = -1;
  p.corruptionOwner = -1;
  p.destroyed = true;
  if (game.battle?.p === p.index) {
    game.battle = null;
    if (game.fadeEl) game.fadeEl.style.opacity = '0';
  }
  game.battles?.dirty.add(p.index);
  if (game.story) {
    game.story.objectCache = null;
    game.story.reasonCache?.clear();
  }
  game.ai?.invalidate();
  game.galacticBattleChanged?.();
  game.planetDestroyed?.(p);
  return true;
}
export function activatePlanetDestruction(game, actor, p, ability) {
  if (!planetDestructionAllowed(game, actor, p)) {
    if (key(actor.owner) === key(game.me)) game.audio?.play('GUI_Bad_Sound');
    return false;
  }
  const leader = db.faction(currentOwner(p))?.str('Faction_Leader');
  if (leader && p.garrison.some(u => containsType(u.type, [key(leader)]))) game.victory?.declareCondition(7, actor.owner, 30);
  if (!destroyPlanet(game, p)) return false;
  game.audio?.play(ability.val('SFXEvent_Target_Affected'));
  game.planetAbilityEffect?.(p, ability.val('Target_Particle_Effect'), ability.val('Target_Particle_Bone_Name'));
  return true;
}

export function groundActivated(game, actor, filter, neutralize) {
  if (!actor || actor.dead || !actor.planet) return false;
  const p = actor.planet,
    record = actor.record || actor;
  if (p.garrison.includes(record) || p.groundStructures.includes(record)) return false;
  const wanted = filter?.__type?.name || filter;
  const root = record.carries || actor.type;
  if (wanted && key(root.name) !== key(wanted)) return false;
  const members = [...root.list('Company_Units'), ...root.list('Squadron_Units')];
  const types = members.length ? members.map(n => db.type(n)).filter(Boolean) : [root];
  let activated = false;
  for (const type of types) {
    for (const ability of type.sub('Abilities').flatMap(n => n.children)) {
      const defaultStyle = [
        'PLANET_DESTRUCTION_ABILITY',
        'NEUTRALIZE_HERO_ABILITY',
        'BLACK_MARKET_ABILITY',
        'CORRUPTION_ABILITY',
        'REMOVE_CORRUPTION_ABILITY',
        'SIPHON_CREDITS_ABILITY',
        'SLICER_ABILITY',
        'GALACTIC_SABOTAGE_ABILITY',
        'HACK_SUPER_WEAPON_ABILITY'
      ].includes(key(ability.tag))
        ? 'Ground_Activated'
        : '';
      if (
        key(ability.val('Activation_Style', defaultStyle)) !== 'GROUND_ACTIVATED' ||
        /^(no|false|0)$/i.test(ability.val('Initially_Enabled', 'Yes'))
      )
        continue;
      if (actor.abilitiesDisabled || record.abilitiesDisabled || game.abilitiesDisabled) continue;
      let fired = false;
      if (key(ability.tag) === 'PLANET_DESTRUCTION_ABILITY') fired = activatePlanetDestruction(game, actor, p, ability);
      else if (key(ability.tag) === 'NEUTRALIZE_HERO_ABILITY') fired = !!neutralize?.(actor, ability);
      else if (key(ability.tag) === 'BLACK_MARKET_ABILITY') fired = activateBlackMarket(game, actor, p, ability);
      else if (key(ability.tag) === 'CORRUPTION_ABILITY') fired = activateCorruption(game, actor, p, ability);
      else if (key(ability.tag) === 'REMOVE_CORRUPTION_ABILITY') fired = activateRemoval(game, actor, p, ability);
      else if (key(ability.tag) === 'SIPHON_CREDITS_ABILITY') fired = activateSiphon(game, actor, p, ability);
      else if (key(ability.tag) === 'SLICER_ABILITY') fired = activateSlicer(game, actor, p, ability);
      else if (key(ability.tag) === 'HACK_SUPER_WEAPON_ABILITY') fired = activateHack(game, actor, p, ability);
      else if (key(ability.tag) === 'GALACTIC_SABOTAGE_ABILITY')
        fired = !p.sabotageRestricted && game.galaxy.sabotageOff !== true && activateSabotage(game, actor, p, ability);
      if (fired && /^(yes|true|1)$/i.test(ability.val('Causes_Despawn'))) game.story?.despawn(actor);
      activated = fired || activated;
    }
  }
  return activated;
}
