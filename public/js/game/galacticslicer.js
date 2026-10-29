import { simRandom } from './simrandom.js';
import { db } from '../gamedata.js';
import { adjustCredits } from './galacticeconomy.js';
import { scheduleHeroRespawn } from './galacticherorespawn.js';
import { setTechLevel } from './galacticproduction.js';

const key = s => String(s || '').trim().toUpperCase();
const same = (a, b) => key(a) === key(b);
const main = f => ['REBEL', 'EMPIRE', 'UNDERWORLD'].includes(key(f));
const allied = (a, b) => same(a, b) || !!db.faction(a)?.list('Allies').some(n => same(n, b));

export function curve(text, fallback = [[0, 0], [5, 0]]) {
  const v = String(text || '').split(/[\s,]+/).map(parseFloat).filter(Number.isFinite), points = [];
  for (let i = 0; i + 1 < v.length; i += 2) points.push([v[i], v[i + 1]]);
  const pts = points.length >= 2 ? points : fallback;
  return x => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1; }
    return pts.at(-1)[1];
  };
}

export function pool(g, player) {
  const out = [];
  for (const type of db.types.values()) {
    if (!type.bool('Build_Can_Be_Unlocked_By_Slicer') || !type.bool('Build_Initially_Locked')) continue;
    if (!type.list('Affiliation').some(n => same(n, player.faction)) || type.num('Tech_Level', 0) > (player.tech || 0)) continue;
    if ((player.unlockedTypes || []).some(n => same(n, type.name)) || (player.lockedTypes || []).some(n => same(n, type.name))) continue;
    out.push(type);
  }
  return out;
}

const baseLevelOf = type => (type.num('Build_Cost_Credits', 0) > 0 && (type.num('Base_Level', 0) || type.num('Required_Ground_Base_Level', 0)) > 0 ? type.num('Base_Level', 0) || type.num('Required_Ground_Base_Level', 0) : null);

export function options(game, actorOwner, planet, ability, types) {
  const priceMod = 1, affinity = planet.type.list('Planet_Slice_Affinity_Types');
  const costMult = curve(ability.val('Cost_Multiplier_By_Planet_Tech_Availability'), [[0, 1], [5, 1]]);
  const baseMod = curve(ability.val('Chance_Modifier_By_Base_Level')), diffMod = curve(ability.val('Chance_Modifier_By_Planet_Difficulty'));
  const costAff = ability.num('Cost_Affinity_Modifier', 0), chanceAff = ability.num('Chance_Affinity_Modifier', 0);
  return types.map(type => {
    const liked = affinity.some(n => same(n, type.name)), base = baseLevelOf(type);
    const cost = Math.max(0, (costMult(planet.type.num('Planet_Tech_Availability_Rating', 0)) + (liked ? costAff : 0)) * type.num('Slice_Cost_Credits', 0) * priceMod);
    const chance = Math.max(0, Math.min(1, (base === null ? 0 : baseMod(base)) + 1 + diffMod(planet.type.num('Planet_Slice_Difficulty_Rating', 0)) + (liked ? chanceAff : 0)));
    return { type, cost, chance };
  });
}

export function respawnRoll(player, ability, random = simRandom) {
  const list = tag => ability.val(tag).split(/[\s,]+/).map(parseFloat).filter(Number.isFinite), lo = list('Min_Respawn_Time_Per_Tech_Level'), hi = list('Max_Respawn_Time_Per_Tech_Level');
  const level = player.tech || 0;
  if (!lo.length || level < 0 || level > 4) return 0;
  const a = lo[level] ?? 0, b = hi[level] ?? a;
  return a + (b - a) * random();
}

export function canSlice(game, actor, planet) {
  const g = game.galaxy, owner = planet.politicalOwner ?? planet.owner, player = g.players.find(p => same(p.faction, actor.owner));
  return !!player && !!owner && !planet.destroyed && !planet.background && !allied(actor.owner, owner) && main(owner) && main(actor.owner) && pool(g, player).length > 0;
}

export function activateSlicer(game, actor, planet, ability) {
  const g = game.galaxy, owner = planet.politicalOwner ?? planet.owner, player = g.players.find(p => same(p.faction, actor.owner));
  if (!player || !owner || planet.destroyed || planet.background || allied(actor.owner, owner) || !main(owner) || !main(actor.owner)) return false;
  const types = pool(g, player);
  if (!types.length) return false;
  const rows = options(game, actor.owner, planet, ability, types), respawn = respawnRoll(player, ability);
  if (player.ai === null || same(player.faction, game.me)) { game.openSliceDialog?.({ actor, planet, rows, respawn, only: rows.length === 1 }); return false; }
  const can = rows.filter(r => r.cost <= player.credits);
  if (!can.length) return false;
  return executeSlice(game, actor, planet, can[Math.floor(simRandom() * can.length)], rows.length === 1, respawn);
}

export const vigilant = (planet, actor) => planet.type.bool('Planet_Vigilance') && [actor.type, ...actor.type.list('Company_Units').map(n => db.type(n))].some(t => t?.bool('Is_Generic_Hero'));

export function executeSlice(game, actor, planet, row, only, respawn, random = simRandom) {
  const g = game.galaxy, player = g.players.find(p => same(p.faction, actor.owner));
  if (!player || actor.dead || row.cost > player.credits) return false;
  if (vigilant(planet, actor)) {
    if (same(player.faction, game.me)) game.notify?.(db.t('TEXT_SLICE_FAILURE_VIGILANCE'), player.faction);
    else if (same(planet.owner, game.me)) game.notify?.(db.t('TEXT_SLICE_PREVENTED_VIGILANCE'), planet.owner);
    scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, 0, true);
    game.story?.despawn?.(actor);
    return false;
  }
  let success = random() * 0.999 < row.chance, time = respawn;
  if (success) {
    adjustCredits(g, player.faction, -row.cost);
    if (!(player.unlockedTypes ||= []).some(n => same(n, row.type.name))) player.unlockedTypes.push(row.type.name);
    if (only) setTechLevel(g, player.faction, (player.tech || 0) + 1);
    const sfx = db.faction(player.faction)?.str('SFXEvent_Slice_Success').trim();
    if (sfx && same(player.faction, game.me)) game.audio?.play(sfx);
    if (same(player.faction, game.me)) game.notify?.(db.t('TEXT_SLICE_SUCCESS') + ' ' + (db.t(row.type.str('Text_ID')) || row.type.name), player.faction);
    game.ui?.refresh?.();
  } else {
    const k = 1 + Math.floor(random() * 3);
    if (k === 1) time *= 2;
    else if (k === 3) adjustCredits(g, player.faction, -row.cost);
    const sfx = db.faction(player.faction)?.str('SFXEvent_Slice_Failure').trim();
    if (sfx && same(player.faction, game.me)) game.audio?.play(sfx);
    if (same(player.faction, game.me)) game.notify?.(db.t(['TEXT_SLICE_FAILURE_CAPTURED', 'TEXT_SLICE_FAILURE_LOST_EFFORT', 'TEXT_SLICE_FAILURE_CHEATED'][k - 1]), player.faction);
  }
  scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, time, true);
  game.story?.despawn?.(actor);
  return success;
}
