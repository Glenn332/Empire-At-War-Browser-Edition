import { db } from '../gamedata.js';
import { adjustCredits } from './galacticeconomy.js';

const key = s => String(s || '').toUpperCase();
const ability = (type, tag) => type?.sub('Abilities').flatMap(a => a.all(tag)) || [];
const maxControl = () => db.constants.num('MaximumPoliticalControl', 5);
const aligned = (owner, p) => {
  const alignment = db.faction(owner)?.str('Force_Alignment', 'Neutral').toUpperCase(),
    strength = p.type.num('Force_Strength', 0);
  if (!alignment || alignment === 'NEUTRAL' || !(strength > 0)) return 1;
  const c = db.constants;
  return alignment === p.type.str('The_Force', 'Neutral').toUpperCase()
    ? 1 - strength * c.num('MaxInfluenceTransitionAlignmentBonus', 0.5)
    : 1 + strength * c.num('MaxInfluenceTransitionAlignmentPenalty', 0.5);
};

function presence(p, owner, orbit) {
  const out = [];
  for (const u of [...p.groundStructures, ...p.orbitalStructures, ...p.garrison]) if (key(u.owner) === key(owner)) out.push(u.type);
  if (p.station && key(p.stationOwner || p.owner) === key(owner)) out.push(p.station);
  for (const f of orbit || []) if (key(f.owner) === key(owner)) for (const u of f.units) out.push(u.carries || u.type);
  return out;
}

const live = list => list.find(u => u && !u.dead);
const neutralFaction = () => [...db.factions.values()].find(f => f.bool('Is_Neutral'))?.name ?? null;
export const surfaceReachable = p => !p.destroyed && p.type.bool('Planet_Surface_Accessible', true);

export function presenceController(g, p, orbit) {
  const base = live(p.groundStructures);
  if (base) return { owner: base.owner, by: 'base' };
  const troop = live(p.garrison);
  if (troop) return { owner: troop.owner, by: 'troops' };
  if (p.station && (p.spaceLevel || 0) > 0) return { owner: p.stationOwner || p.owner, by: 'starbase' };
  for (const k of ['space', 'ground']) {
    const q = p.production?.[k]?.[0];
    if (q?.owner) return { owner: q.owner, by: 'production' };
  }
  if (!surfaceReachable(p)) for (const f of orbit || []) if (f.owner && live(f.units)) return { owner: f.owner, by: 'orbit' };
  if (!p.destroyed && p.type.bool('Planet_Retains_Residual_Influence') && p.owner) return { owner: p.owner, by: 'residual' };
  const leaning = Math.max(0, Math.min(5, p.type.num('Political_Control', 0))),
    faction = db.faction(p.type.str('Political_Faction').trim());
  if (leaning > 0 && faction) return { owner: faction.name, by: 'leaning' };
  return { owner: neutralFaction(), by: 'neutral' };
}

const yes = v => /^(yes|true|1)$/i.test(String(v ?? '').trim());
const groundActivated = a => /^ground_activated$/i.test(String(a.val('Activation_Style', '')).trim());

export function factionPoliticalMax(type, owner) {
  for (const [f, n] of type.tuples('Planet_Max_Political_Control_For_Faction')) if (key(f) === key(owner)) return parseInt(n, 10) || 0;
  return 5;
}

export function politicalEffects(g, p) {
  const now = g.time || 0;
  p.politicalEffects = (p.politicalEffects || []).filter(e => e.until < 0 || e.until >= now);
  return p.politicalEffects;
}

function heroesAt(g, p, orbit) {
  const out = [];
  for (const u of p.garrison) if (!u.dead) out.push({ owner: u.owner, type: u.carries || u.type });
  for (const f of orbit || []) for (const u of f.units) if (!u.dead) out.push({ owner: f.owner, type: u.carries || u.type });
  return out;
}

function automaticEffects(g, p, orbit) {
  const out = [];
  for (const { owner, type } of heroesAt(g, p, orbit)) {
    const members = [
      type,
      ...(type.list ? type : { list: () => [] })
        .list('Company_Units')
        .map(n => db.type(n))
        .filter(Boolean)
    ];
    for (const t of members) {
      for (const a of ability(t, 'Political_Control_Bonus_Ability'))
        if (yes(a.val('Initially_Enabled', 'Yes')) && !groundActivated(a) && key(owner) === key(p.owner))
          out.push({ group: 3, value: a.num('Political_Change', 1), source: key(a.attrs?.Name || t.name) });
      for (const a of ability(t, 'Sabotage_Political_Control_Ability'))
        if (yes(a.val('Initially_Enabled', 'Yes')) && !groundActivated(a) && key(owner) !== key(p.owner))
          out.push({ group: 14, value: -Math.max(1, a.num('Political_Change', 1)), source: key(a.attrs?.Name || t.name) });
    }
  }
  return out;
}

export function politicalGroups(g, p, orbit) {
  const groups = new Map();
  for (const e of [...politicalEffects(g, p), ...automaticEffects(g, p, orbit)]) {
    groups.set(e.group, Math.max(groups.get(e.group) ?? -Infinity, e.value));
  }
  return groups;
}

export function addPoliticalEffect(g, p, ability, actor, group, sign) {
  const effects = politicalEffects(g, p);
  if (group === 14 && effects.some(e => e.group === 14)) return false;
  const value = sign < 0 ? -Math.max(1, ability.num('Political_Change', 1)) : ability.num('Political_Change', 1),
    duration = ability.num('Change_Duration_In_Seconds', -1),
    source = key(ability.attrs?.Name || actor?.type?.name);
  const until = duration > 0 ? (g.time || 0) + duration : -1;
  const old = effects.find(e => e.group === group && e.source === source);
  if (old) Object.assign(old, { value, until });
  else effects.push({ group, value, until, source });
  p.politicalChecked = -1;
  return true;
}

export function politicalGoal(g, p, orbit, by = null) {
  const owner = p.owner,
    have = by ? !['leaning', 'neutral'].includes(by) : !!owner && !db.faction(owner)?.bool('Is_Neutral');
  if (!owner) return { target: 0, rate: 1, protect: false };
  const here = presence(p, owner, orbit),
    top = maxControl();
  let sum = 0;
  const typePolitics = Math.max(0, Math.min(top, p.type.num('Political_Control', 0))),
    faction = p.type.str('Political_Faction').trim();
  sum += faction && key(faction) !== key(owner) ? -typePolitics : typePolitics;
  let ships = 0;
  for (const f of orbit || [])
    for (const u of f.units) {
      const v = (u.carries || u.type).num('Political_Control', 0);
      ships += key(f.owner) === key(owner) ? v : -v;
    }
  const level = Math.max(
    Math.min(5, p.groundStructures.filter(u => key(u.owner) === key(owner)).length),
    p.garrison.some(u => key(u.owner) === key(owner)) ? 1 : 0,
    p.station && key(p.stationOwner || p.owner) === key(owner) ? p.spaceLevel || 0 : 0,
    by === 'orbit' ? 1 : 0,
    ships > 0 ? 1 : 0,
    by === 'residual' ? 1 : 0
  );
  sum += level + (ships < 0 ? -1 : 0);
  for (const u of [...p.groundStructures, ...p.orbitalStructures])
    if (key(u.owner) === key(owner)) sum += u.type.num('Political_Control', 0);
  for (const r of g.routes || [])
    if (r.a === p.index || r.b === p.index) {
      const gain = r.type.num('Political_Control_Gain', 0);
      if (!gain) continue;
      const other = g.planets[r.a === p.index ? r.b : r.a];
      if ((p.politicalValue ?? top) >= 1 && (other.politicalValue ?? top) >= 1 && key(other.owner) === key(owner)) sum += gain;
    }
  for (const v of politicalGroups(g, p, orbit).values()) sum += v;
  const floor = have ? 1 : 0;
  let ceiling = have ? factionPoliticalMax(p.type, owner) : 5;
  if (ceiling < floor) ceiling = 5;
  const target = Math.max(floor, Math.min(ceiling, sum));
  let rate = aligned(owner, p),
    protect = false;
  const byCategory = new Map();
  for (const type of here) {
    for (const a of ability(type, 'Political_Transition_Bonus_Ability')) {
      const category = a.num('Stacking_Category', 0),
        v = a.num('Time_Reduction_Percentage', 1);
      byCategory.set(category, Math.min(byCategory.get(category) ?? Infinity, v));
    }
    if (ability(type, 'Political_Control_Protection_Ability').length) protect = true;
  }
  for (const v of byCategory.values()) rate *= v;
  return { target, rate, protect };
}

export function politicalFlip(planet) {
  planet.politicalValue = 0;
  planet.politicalChecked = -1;
}

export function changeController(planet, faction, g = null) {
  const old = planet.owner;
  if (key(old) === key(faction)) return old;
  planet.owner = faction;
  planet.politicalOwner = undefined;
  planet.politicalTargetOwner = undefined;
  politicalFlip(planet);
  const bonus = g ? captureBonus(g, planet, faction) : 0;
  if (g) controllerListener?.(planet, old, faction, bonus);
  return old;
}

function captureBonus(g, planet, faction) {
  const player = g.players.find(p => p.faction === faction);
  if (!player || !db.faction(faction)?.bool('Is_Playable')) return 0;
  const rewarded = player.captureRewards || (player.captureRewards = []);
  if (rewarded.includes(planet.type.name)) return 0;
  rewarded.push(planet.type.name);
  const amount = Math.trunc(planet.type.num('Planet_Capture_Bonus_Reward', 0));
  if (amount) adjustCredits(g, faction, amount);
  return amount;
}

let controllerListener = null;
export function onControllerChange(fn) {
  controllerListener = fn;
}

export const politicallyHeld = p => (p.politicalValue ?? 1) > 0;

export function stepPolitics(g, dt, captured = null) {
  if (!(dt > 0)) return;
  const top = maxControl(),
    change = Math.max(1e-3, db.constants.num('Political_Control_Change_Time_Seconds', 7)),
    now = g.time || 0;
  let orbitOf = null;
  for (const p of g.planets) {
    if (p.background) continue;
    if (p.politicalChecked === undefined || p.politicalChecked < 0 || now - p.politicalChecked >= 0.25 || now < p.politicalChecked) {
      if (!orbitOf) {
        orbitOf = new Map();
        for (const f of g.fleets)
          if (!f.leg && f.planet >= 0 && f.units.length) (orbitOf.get(f.planet) || orbitOf.set(f.planet, []).get(f.planet)).push(f);
      }
      const orbit = orbitOf.get(p.index),
        claim = presenceController(g, p, orbit);
      if (claim.owner && key(claim.owner) !== key(p.owner) && p.politicalValue === undefined) p.owner = claim.owner;
      else if (claim.owner && key(claim.owner) !== key(p.owner)) {
        const old = changeController(p, claim.owner, g);
        captured?.(p, old, claim.by);
      }
      if (!p.owner) continue;
      const goal = politicalGoal(g, p, orbit, claim.by);
      p.politicalTarget = Math.min(top, goal.target);
      p.politicalRate = goal.rate;
      p.politicalProtected = goal.protect;
      p.politicalChecked = now;
      if (p.politicalValue === undefined) p.politicalValue = p.politicalTarget;
    }
    const v = p.politicalValue,
      t = p.politicalTarget;
    if (v === t) continue;
    if (p.politicalProtected && t < v) continue;
    const step = dt / Math.max(1e-6, p.politicalRate * change);
    p.politicalValue = v < t ? Math.min(t, v + step) : Math.max(t, v - step);
  }
}
