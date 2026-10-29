import { simRandom } from './simrandom.js';
import { db } from '../gamedata.js';
import { adjustCredits } from './galacticeconomy.js';
import { changeController } from './galacticpolitics.js';
import { scheduleHeroRespawn } from './galacticherorespawn.js';
import { intelligence } from './galacticfog.js';
import { vigilant } from './galacticslicer.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
export const CORRUPTION_TYPES = [
  'INTIMIDATION',
  'PIRACY',
  'KIDNAPPING',
  'RACKETEERING',
  'CORRUPT_MILITIA',
  'BRIBERY',
  'BLACK_MARKET',
  'BONDED_CITIZENS'
];
export const typeNamed = s => CORRUPTION_TYPES.indexOf(key(s).replace(/^CORRUPTION_/, ''));
export const benefits = faction => !!db.faction(faction)?.bool('Benefits_From_Corruption');
export const corruptionOf = planet => planet.currentCorruption ?? -1;
export const corrupted = planet => corruptionOf(planet) !== -1;
export const beneficiary = g => g.players.find(p => benefits(p.faction));
const same = (a, b) => key(a) === key(b);
const allied = (a, b) =>
  same(a, b) ||
  !!db
    .faction(a)
    ?.list('Allies')
    .some(n => same(n, b));

export function choicesOf(planetType) {
  const out = [];
  for (let n = 1; n <= 3; n++) {
    const type = typeNamed(planetType.str(`Corruption_${n}_Type`));
    if (type < 0) continue;
    const t = tag => `Corruption_${n}_${tag}`,
      mode = key(planetType.str(t('Tactical_Game_Mode')));
    const missionType = typeNamed(planetType.str(t('Required_Mission_Type'))),
      missionCount = planetType.num(t('Required_Mission_Count'), 0);
    out.push({
      slot: n,
      type,
      cost: planetType.num(t('Credit_Cost'), 0),
      units: planetType
        .list(t('Required_Unit_Type'))
        .map(name => db.type(name))
        .filter(Boolean),
      unitCount: planetType.num(t('Required_Unit_Count'), 0),
      missionType: missionType >= 0 && missionCount > 0 ? missionType : -1,
      missionCount: missionType >= 0 && missionCount > 0 ? missionCount : 0,
      planets: planetType.list(t('Required_Planets')).filter(name => db.type(name)),
      map: planetType.str(t('Tactical_Map_Name')).trim(),
      script: planetType.str(t('Tactical_Script_Name')).trim(),
      mode: mode === 'LAND' ? 'land' : mode === 'SPACE' ? 'space' : null,
      successSpeech: planetType.str(t('Success_Speech_Event')).trim(),
      successHologram: planetType.str(t('Success_Bink_Hologram_Name')).trim(),
      failureSpeech: planetType.str(t('Failure_Speech_Event')).trim(),
      failureHologram: planetType.str(t('Failure_Bink_Hologram_Name')).trim(),
      briefing: planetType.str(t('Mission_Briefing')).trim(),
      commencing: planetType.str(t('Mission_Commencing_Speech_Event')).trim(),
      bonus: planetType.num(t('Success_Credit_Bonus'), 0),
      unlock: planetType.str(t('Success_Unlock_Unit_Type')).trim()
    });
  }
  return out;
}
export const choiceOfType = (planetType, type) => choicesOf(planetType).find(c => c.type === type) || null;

const playerOf = (g, faction) => g.players.find(p => same(p.faction, faction));

export function startCorruption(game, planet, type, seconds) {
  if (planet.corruptionKind || corruptionOf(planet) !== -1 || type < 0 || type > 7) return false;
  planet.corruptionKind = 'corrupt';
  planet.corruptionPending = type;
  planet.corruptionStart = game.galaxy.time || 0;
  planet.corruptionEnd = planet.corruptionStart + (seconds > 0 ? seconds : 0.1);
  return true;
}

export function startRemoval(game, planet, seconds) {
  if (planet.corruptionKind || corruptionOf(planet) === -1) return false;
  planet.corruptionKind = 'remove';
  planet.corruptionPending = -1;
  planet.corruptionStart = game.galaxy.time || 0;
  planet.corruptionEnd = planet.corruptionStart + (seconds > 0 ? seconds : 0.1);
  return true;
}

const abort = planet => {
  planet.corruptionKind = null;
  planet.corruptionPending = -1;
  planet.corruptionEnd = 0;
};

export function stepCorruption(game) {
  const g = game.galaxy;
  for (const planet of g.planets) if (planet.corruptionKind && (g.time || 0) + 1e-7 >= planet.corruptionEnd) complete(game, planet);
}

function complete(game, planet) {
  const old = corruptionOf(planet),
    next = planet.corruptionPending ?? -1;
  planet.currentCorruption = next;
  planet.corruptionLast = game.galaxy.time || 0;
  abort(planet);
  const me = db.faction(game.me);
  const sfx = me?.str(next === -1 ? 'SFXEvent_Corruption_Removed' : 'SFXEvent_Planet_Corrupted').trim();
  if (sfx) game.audio?.play(sfx);
  changed(game, planet, next, old);
}

function changed(game, planet, next, old) {
  const g = game.galaxy,
    ben = beneficiary(g),
    offers = choicesOf(planet.type);
  if (ben) {
    const take = c => {
      const unit = c && db.type(c.unlock);
      if (unit) ben.unlockedTypes = (ben.unlockedTypes || []).filter(n => !same(n, unit.name));
    };
    if (old !== -1) take(offers.find(c => c.type === old));
    const c = next !== -1 ? offers.find(o => o.type === next) : null;
    if (c) {
      if (c.bonus > 0) adjustCredits(g, ben.faction, c.bonus);
      const unit = db.type(c.unlock);
      if (unit && unit.num('Build_Cost_Credits', 0) > 0 && !(ben.unlockedTypes ||= []).some(n => same(n, unit.name)))
        ben.unlockedTypes.push(unit.name);
    }
  }
  game.story?.signalCorruption?.('STORY_CORRUPTION_CHANGED', planet, next);
  if (old === 4 && next === -1) revolt(game, planet);
  game.ai?.invalidate?.();
}

export function setCorruptionNow(game, planet, type) {
  const old = corruptionOf(planet);
  abort(planet);
  planet.currentCorruption = type;
  if (old !== type) changed(game, planet, type, old);
}

function revolt(game, planet) {
  const g = game.galaxy,
    neutral = [...db.factions.values()].find(f => f.bool('Is_Neutral'));
  if (!neutral) return;
  const old = planet.owner;
  for (const owner of new Set(g.fleets.filter(f => f.planet === planet.index && !f.leg).map(f => f.owner)))
    game.battles?.retreat?.(planet.index, owner);
  planet.garrison = planet.garrison.filter(u => {
    if (u.owner === neutral.name) return true;
    u.dead = true;
    return false;
  });
  if (intelligence(g, planet)?.discovered) game.notify?.(String(db.t('TEXT_PLANETARY_REVOLT')).replace('%s', planetName(planet)), old);
  changeController(planet, neutral.name, g);
  game.story?.planetCaptured?.(planet, old);
  game.victory?.ownershipChanged?.();
}

export function ownerChanged(game, planet, oldOwner, newOwner) {
  const gain = benefits(newOwner),
    loss = benefits(oldOwner);
  if (gain && !loss) {
    if (planet.corruptionKind === 'corrupt') return;
    abort(planet);
    if (corruptionOf(planet) === -1) startCorruption(game, planet, 3, 10);
  } else if (!gain && loss) {
    abort(planet);
    if (corruptionOf(planet) !== -1) startRemoval(game, planet, 10);
  }
  if (planet.creditSiphonOwner && same(planet.creditSiphonOwner, newOwner)) clearSiphon(planet);
}

export function clearSiphon(planet) {
  planet.creditSiphonOwner = -1;
  planet.creditSiphonPct = 0;
  planet.creditSiphonEnd = 0;
  planet.creditSiphonAmount = 0;
  planet.creditSiphonFound = false;
}

export function canCorrupt(game, actor, planet) {
  const owner = planet.politicalOwner ?? planet.owner;
  return (
    !!owner &&
    !planet.corruptionRestricted &&
    !planet.destroyed &&
    !planet.background &&
    !db.faction(owner)?.bool('Is_Neutral') &&
    !allied(actor.owner, owner) &&
    corruptionOf(planet) === -1 &&
    !planet.corruptionKind &&
    choicesOf(planet.type).length > 0
  );
}

const groupsOf = (g, owner) =>
  [
    ...g.fleets.filter(f => same(f.owner, owner)).flatMap(f => f.units),
    ...g.planets.flatMap(p => p.garrison.filter(u => same(u.owner, owner)))
  ].filter(u => !u.dead);
const holds = (record, types) => {
  const t = record.carries || record.type,
    members = [t.name, ...t.list('Company_Units'), ...t.list('Squadron_Units')].map(key);
  return types.some(x => members.includes(key(x.name)));
};

export function requirements(game, player, choice) {
  const g = game.galaxy;
  const credits = choice.cost <= 0 || choice.cost <= player.credits;
  const missions =
    choice.missionType < 0 || choice.missionCount <= 0 || (player.corruptionMissions?.[choice.missionType] || 0) >= choice.missionCount;
  const planets =
    !choice.planets.length || g.planets.some(p => same(p.owner, player.faction) && choice.planets.some(n => same(n, p.type.name)));
  const have = choice.units.length ? groupsOf(g, player.faction).filter(u => holds(u, choice.units)).length : 0;
  const units = choice.unitCount <= 0 || !choice.units.length || have >= choice.unitCount;
  return {
    credits,
    missions,
    planets,
    units,
    haveUnits: have,
    haveMissions: choice.missionType >= 0 ? player.corruptionMissions?.[choice.missionType] || 0 : 0
  };
}

const AI_WEIGHT = (type, done) =>
  [2 / ((done[0] || 0) + 1), 1 / ((done[1] || 0) + 1) + 1, 0.75, 1.5, 1 / ((done[4] || 0) + 1) + 0.5, 0.25, 2.5, 0.75][type];

export function aiPick(game, player, choices, random = simRandom) {
  const can = choices.filter(c => {
    const r = requirements(game, player, c);
    return r.credits && r.missions && r.planets && r.units;
  });
  const weights = can.map(c => AI_WEIGHT(c.type, player.corruptionMissions || []));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!can.length || !(total > 0)) return null;
  let at = random() * total;
  for (let i = 0; i < can.length; i++) {
    at -= weights[i];
    if (at <= 0) return can[i];
  }
  return can.at(-1);
}

export function activateCorruption(game, actor, planet, ability = null) {
  if (!canCorrupt(game, actor, planet)) return false;
  const g = game.galaxy,
    player = playerOf(g, actor.owner),
    choices = choicesOf(planet.type);
  if (!player || !choices.length) return false;
  if (player.ai === null || same(player.faction, game.me)) {
    game.openCorruptionDialog?.({ actor, planet, choices });
    game.story?.signal?.('STORY_OPEN_CORRUPTION', planet.type.name);
    return false;
  }
  const choice = aiPick(game, player, choices);
  return !!choice && executeCorruption(game, actor, planet, choice);
}

export function executeCorruption(game, actor, planet, choice) {
  const g = game.galaxy,
    player = playerOf(g, actor.owner);
  if (!player || actor.dead || corruptionOf(planet) !== -1 || planet.corruptionKind || planet.destroyed) return false;
  if (player.credits < choice.cost) return false;
  if (choice.cost > 0) adjustCredits(g, player.faction, -choice.cost);
  const r = requirements(game, player, choice);
  if (!r.units) return false;
  if (choice.unitCount > 0 && choice.units.length) {
    const type = choice.units.find(t => groupsOf(g, player.faction).some(u => holds(u, [t]))) || choice.units[0];
    if (type.bool('Destroy_When_Used_As_Corruption_Prereq', true)) {
      const pool = groupsOf(g, player.faction).filter(u => holds(u, [type]) && u !== (actor.record || actor));
      for (let i = 0; i < choice.unitCount && pool.length; i++)
        game.story?.despawn?.(pool.splice(Math.floor(simRandom() * pool.length), 1)[0]);
    }
  }
  const mission = choice.map && choice.mode && player.ai === null && !game.setup?.noCorruptionMission;
  if (mission) {
    if (!queueMission(game, actor, planet, choice)) return false;
  } else begin(game, player, planet, choice.type);
  scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, 0, true);
  game.story?.despawn?.(actor);
  return true;
}

function begin(game, player, planet, type, choice = null) {
  startCorruption(game, planet, type, 5);
  (player.corruptionMissions ||= Array(8).fill(0))[type]++;
  const c = choice || choiceOfType(planet.type, type);
  if (c?.successSpeech && same(player.faction, game.me) && planet.showCorruptionHologram !== false)
    game.audio?.speech?.replace?.(c.successSpeech);
  if (same(player.faction, game.me)) game.notify?.(String(db.t('TEXT_CORRUPTION_BEGIN')).replace('%s', planetName(planet)), player.faction);
}

const planetName = p => db.t(p.type.str('Text_ID')) || p.name;

function queueMission(game, actor, planet, choice) {
  if (game.pendingLinkedTactical || game.linkedMission || game.battle) return false;
  const request = {
    planet: planet.index,
    mode: choice.mode,
    attacker: actor.owner,
    defender: planet.owner,
    map: choice.map,
    hero: '',
    plot: choice.script,
    sandbox: false,
    cinematic: 1,
    faded: false,
    letterbox: false,
    resolution: 0,
    pending: false,
    pathfinder: true,
    corruption: { type: choice.type, planet: planet.index }
  };
  game.pendingLinkedTactical = request;
  if (choice.commencing && same(actor.owner, game.me)) game.audio?.speech?.replace?.(choice.commencing);
  return true;
}

export function missionResult(game, request, won) {
  const g = game.galaxy,
    planet = g.planets[request.corruption.planet],
    type = request.corruption.type,
    player = playerOf(g, request.attacker);
  if (!planet || !player) return;
  const choice = choiceOfType(planet.type, type);
  if (won) {
    begin(game, player, planet, type, choice);
    game.story?.signalCorruption?.('STORY_CORRUPTION_TACTICAL_COMPLETE', planet, type);
  } else {
    if (choice?.failureSpeech && same(player.faction, game.me) && planet.showCorruptionHologram !== false)
      game.audio?.speech?.replace?.(choice.failureSpeech);
    game.story?.signalCorruption?.('STORY_CORRUPTION_TACTICAL_FAILED', planet, type);
  }
}

export function canRemove(game, actor, planet) {
  return (
    corruptionOf(planet) !== -1 &&
    !planet.corruptionKind &&
    !planet.corruptionRestricted &&
    same(planet.politicalOwner ?? planet.owner, actor.owner)
  );
}

export function activateRemoval(game, actor, planet, ability) {
  if (!canRemove(game, actor, planet)) return false;
  const g = game.galaxy,
    player = playerOf(g, actor.owner);
  const cost = Math.max(
    0,
    planet.type.num('Planet_Corruption_Removal_Base_Cost', 2000) * Math.max(0, ability.num('Corruption_Removal_Cost_Multiplier', 1))
  );
  const time = ability.num('Corruption_Removal_Time_In_Secs', 10);
  if (!player || (cost > 0 && player.credits < cost)) {
    if (same(actor.owner, game.me)) game.audio?.play('GUI_Bad_Sound');
    return false;
  }
  if (!startRemoval(game, planet, time > 0 ? time : 10)) return false;
  if (cost > 0) adjustCredits(g, player.faction, -cost);
  if (same(actor.owner, game.me))
    game.notify?.(String(db.t('TEXT_REMOVE_CORRUPTION_BEGIN')).replace('%s', planetName(planet)), actor.owner);
  return true;
}

export function activateSiphon(game, actor, planet, ability) {
  const g = game.galaxy,
    owner = planet.politicalOwner ?? planet.owner;
  const main = f => ['REBEL', 'EMPIRE', 'UNDERWORLD'].includes(key(f));
  if (!owner || !main(owner) || !main(actor.owner) || allied(actor.owner, owner) || planet.destroyed || planet.background) return false;
  if (planet.creditSiphonOwner && planet.creditSiphonOwner !== -1) return false;
  if (vigilant(planet, actor)) {
    if (same(actor.owner, game.me)) game.notify?.(db.t('TEXT_SIPHON_FAILURE_VIGILANCE'), actor.owner);
    else if (same(owner, game.me)) game.notify?.(db.t('TEXT_SIPHON_PREVENTED_VIGILANCE'), owner);
    scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, 0, true);
    game.story?.despawn?.(actor);
    return false;
  }
  const lo = Math.max(0, Math.min(1, ability.num('Min_Siphon_Percentage', 0))),
    hi = Math.max(0, Math.min(1, ability.num('Max_Siphon_Percentage', lo)));
  const cycles = ability.num('Siphon_Duration_In_Cycles', 1);
  if (cycles <= 0) return false;
  planet.creditSiphonOwner = actor.owner;
  planet.creditSiphonPct = lo + simRandom() * (hi - lo);
  planet.creditSiphonAmount = 0;
  planet.creditSiphonFound = false;
  planet.creditSiphonEnd = (g.time || 0) + cycles * db.constants.num('Fiscal_Cycle_Time_In_Secs', 45);
  scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, 0, true);
  if (same(actor.owner, game.me)) game.notify?.(String(db.t('TEXT_SIPHON_BEGIN')).replace('%s', planetName(planet)).trim(), owner);
  return true;
}
