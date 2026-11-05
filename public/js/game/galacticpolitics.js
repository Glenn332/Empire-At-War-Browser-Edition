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
  if (!surfaceReachable(p))
    for (const f of orbit || []) if (f.owner && live(f.units)) return { owner: f.owner, by: 'orbit' };
  if (!p.destroyed && p.type.bool('Planet_Retains_Residual_Influence') && p.owner) return { owner: p.owner, by: 'residual' };
  const leaning = Math.max(0, Math.min(5, p.type.num('Political_Control', 0))),
    faction = db.faction(p.type.str('Political_Faction').trim());
  if (leaning > 0 && faction) return { owner: faction.name, by: 'leaning' };
  return { owner: neutralFaction(), by: 'neutral' };
}

export function politicalGoal(g, p, orbit, by = null) {
  const owner = p.owner,
    have = !!owner && !db.faction(owner)?.bool('Is_Neutral');
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
  const ceiling = Math.min(5, db.constants.num('Planet_Max_Political_Control_For_Faction', top) || top);
  const target = Math.max(have ? 1 : 0, Math.min(ceiling, sum));
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
