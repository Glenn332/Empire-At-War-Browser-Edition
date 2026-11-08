import { allied } from './galacticvictory.js';
import { scheduleHeroRespawn, abilityRespawnTime } from './galacticherorespawn.js';

const key = x => String(x || '').toUpperCase();
const yes = value => /^(yes|true|1)$/i.test(String(value ?? '').trim());

const SEES = [
  ['See_Base_Levels', 0x6],
  ['See_Credit_Income', 0x8],
  ['See_Credit_Income_Breakdown', 0x8000],
  ['See_Num_Fleets', 0x30],
  ['See_Most_Powerful_Ship', 0x10000],
  ['See_Fleet_Contents', 0x40],
  ['See_Num_Ground_Companies', 0x80],
  ['See_Ground_Company_Contents', 0x100],
  ['See_Special_Structures', 0x200],
  ['See_Political_Control', 0x400],
  ['See_Political_Control_Breakdown', 0x800],
  ['See_Current_Production', 0x1000],
  ['See_Minor_Stealth_Heroes', 0x2000],
  ['See_Major_Stealth_Heroes', 0x4000],
  ['See_Force_Sensitive_Heroes', 0x20000],
  ['See_Super_Weapons', 0x40000]
];
const NEEDS = [
  ['See_Most_Powerful_Ship', 'See_Num_Fleets'],
  ['See_Fleet_Contents', 'See_Num_Fleets'],
  ['See_Ground_Company_Contents', 'See_Num_Ground_Companies'],
  ['See_Political_Control_Breakdown', 'See_Political_Control'],
  ['See_Credit_Income_Breakdown', 'See_Credit_Income']
];

export function spyMask(ability) {
  const on = new Set(SEES.filter(([tag]) => yes(ability.val(tag))).map(([tag]) => tag));
  for (const [tag, need] of NEEDS) if (on.has(tag)) on.add(need);
  let mask = 0;
  for (const [tag, bits] of SEES) if (on.has(tag)) mask |= bits;
  return mask;
}

export function spyDuration(ability) {
  const seconds = ability.num('Duration_In_Secs', 0);
  return seconds > 0 ? seconds : 30;
}

export const canSpy = (game, actor, planet) =>
  !!actor && !!planet && !planet.background && !planet.destroyed && !allied(actor.owner, planet.owner);

export function activateSpy(game, actor, planet, ability, type) {
  const g = game.galaxy;
  if (!canSpy(game, actor, planet) || actor.dead) {
    if (key(actor?.owner) === key(game.me)) game.audio?.play('GUI_Bad_Sound');
    return false;
  }
  const mask = spyMask(ability),
    range = type?.num('Galactic_Influence_Range', 0) || 0,
    expires = (g.time || 0) + spyDuration(ability),
    source = 'SPY:' + key(type?.name || ability.tag);
  const targets =
    range > 0
      ? g.planets.filter(p => !p.background && p.pos.reduce((s, n, k) => s + (n - planet.pos[k]) ** 2, 0) < range * range)
      : [planet];
  for (const p of targets) (p.visibilityModifiers ||= []).push({ owner: actor.owner, source, mask, expires });
  if (key(ability.val('Activation_Style')) === 'GROUND_ACTIVATED') game.story?.abilityLanded?.(planet, actor);
  game.audio?.play(ability.val('SFXEvent_Activate', ''));
  if (yes(ability.val('Causes_Despawn'))) scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, abilityRespawnTime(ability), true);
  game.galacticBattleChanged?.();
  return true;
}
