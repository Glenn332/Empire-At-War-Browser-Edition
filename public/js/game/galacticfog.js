import { db } from '../gamedata.js';
import { planetIncome } from './galacticeconomy.js';

export const VIS = Object.freeze({ OWNER: 1, SPACE_LEVEL: 2, GROUND_LEVEL: 4, INCOME: 8,
  FLEET_PRESENCE: 16, FLEET_COUNT: 32, FLEET_CONTENTS: 64, GROUND_COUNT: 128, GROUND_CONTENTS: 256,
  SPECIAL: 512, MOST_POWERFUL: 0x10000, ALL: 0x9fff });
const upper = new Map(), up = s => { let u = upper.get(s); if (u === undefined) { u = s.toUpperCase(); if (upper.size < 10000) upper.set(s, u); } return u; };
const same = (a, b) => !!a && !!b && (a === b || up(a) === up(b));
const friendly = (owner, viewer) => same(owner, viewer);
const controller = p => p.politicalOwner ?? p.owner;
const targetController = p => p.politicalTargetOwner ?? controller(p);
const strength = p => p.politicalControl ?? (db.faction(controller(p))?.bool('Is_Neutral') ? 0 : 1);
const caches = new WeakMap(), typeEffects = new WeakMap();
const yes = value => /^(yes|true|1)$/i.test(value);
function effects(type, depth = 0) {
  if (typeEffects.has(type)) return typeEffects.get(type);
  const result = { stealth: type.bool('Is_Stealth_Company'), spies: [] };
  typeEffects.set(type, result);
  for (const a of type.sub('Abilities').flatMap(n => n.children)) {
    if (/^Galactic_Stealth_Ability$/i.test(a.tag) && yes(a.val('Initially_Enabled'))) result.stealth = true;
    if (!yes(a.val('Initially_Enabled')) || !/^Galactic_Automatic$/i.test(a.val('Activation_Style'))) continue;
    if (!/^System_Spy_Ability$/i.test(a.tag) || a.num('Duration_In_Secs', 30) >= 0) continue;
    let mask = 0;
    for (const [tag, bits] of [['See_Base_Levels', 6], ['See_Credit_Income', 8], ['See_Num_Fleets', 0x30],
      ['See_Most_Powerful_Ship', 0x10000], ['See_Fleet_Contents', 0x70], ['See_Num_Ground_Companies', 0x80],
      ['See_Ground_Company_Contents', 0x180], ['See_Special_Structures', 0x200]]) if (yes(a.val(tag))) mask |= bits;
    if (mask) result.spies.push({ mask, range: type.num('Galactic_Influence_Range', 0) });
  }
  const members = [];
  if (depth < 8) for (const n of [...type.list('Company_Units'), ...type.list('Squadron_Units')]) {
    const child = db.type(n);
    if (child && child !== type) { const e = effects(child, depth + 1); result.spies.push(...e.spies); members.push(e); }
  }
  if (!result.stealth && members.length && members.every(e => e.stealth)) result.stealth = true;
  return result;
}
export function strategicStealth(u) { return u.stealth ?? effects(u.carries || u.type).stealth; }
function spyMasks(g, viewer, orbit) {
  const masks = new Uint32Array(g.planets.length);
  const grant = (type, at) => {
    for (const spy of effects(type).spies) {
      if (spy.range <= 0) masks[at.index] |= spy.mask;
      else for (const p of g.planets) if (!p.background && p.pos.reduce((s, n, k) => s + (n - at.pos[k]) ** 2, 0) < spy.range ** 2) masks[p.index] |= spy.mask;
    }
  };
  for (const p of g.planets) {
    if (same(p.owner, viewer)) grant(p.type, p);
    if (p.station && same(p.stationOwner || p.owner, viewer)) grant(p.station, p);
    for (const u of [...p.groundStructures, ...p.orbitalStructures, ...p.garrison]) if (same(u.owner, viewer)) grant(u.type, p);
    for (const f of orbit[p.index]) if (same(f.owner, viewer)) for (const u of f.units) grant(u.carries || u.type, p);
  }
  return masks;
}

function neighbours(g) {
  let list = caches.get(g);
  if (list) return list;
  const range = db.constants.num('MaximumFleetMovementDistance', 100), rr = range * range;
  list = g.planets.map(() => new Set());
  for (let i = 0; i < g.planets.length; i++) for (let j = i + 1; j < g.planets.length; j++) {
    const a = g.planets[i], b = g.planets[j];
    if (a.background || b.background) continue;
    if (a.pos.reduce((s, n, k) => s + (n - b.pos[k]) ** 2, 0) < rr) { list[i].add(j); list[j].add(i); }
  }
  for (const r of g.routes) { list[r.a].add(r.b); list[r.b].add(r.a); }
  caches.set(g, list); return list;
}

export const intelligence = (g, p) => g.visibility?.planets[p.index];
export const displayOwner = (g, p) => {
  const v = intelligence(g, p);
  return v?.discovered && v.ownerKnown ? p.owner : [...db.factions.values()].find(f => f.bool('Is_Neutral'))?.name;
};
export const displayIncome = (g, p, orbit = null) => intelligence(g, p)?.income ? planetIncome(g, p, p.owner, orbit) :
  p.type.num(p.destroyed ? 'Planet_Destroyed_Credit_Value' : 'Planet_Credit_Value', 0);
export const connectionOwner = (g, p) => intelligence(g, p)?.ownerKnown ? p.owner : intelligence(g, p)?.rememberedOwner;

export function stepVisibility(g, viewer, elapsedFrames = 0) {
  let state = g.visibility;
  if (!state || !same(state.viewer, viewer)) state = g.visibility = { viewer, clock: 0, planets: [] };
  state.clock = (state.clock || 0) + elapsedFrames;
  const ticks = Math.floor(state.clock + 1e-8); state.clock -= ticks;
  const known = state.planets.map(v => !!v?.discovered);
  const faction = db.faction(viewer), minLevel = faction?.num('Minimum_Visible_Base_Level', 1) ?? 1;
  const baseline = same(viewer, 'Rebel') || same(viewer, 'Underworld') ? 0x11 : 0;
  const orbit = g.planets.map(() => []);
  for (const f of g.fleets) if (!f.leg && f.planet >= 0 && f.units.length) orbit[f.planet]?.push(f);
  const spies = spyMasks(g, viewer, orbit);
  const qualified = [], adjacent = neighbours(g), limit = 30 * db.constants.num('Planet_Reveal_Delay_Time', 0.5);
  for (const p of g.planets) {
    const v = state.planets[p.index] ||= { discovered: false, revealFrames: 0, rememberedOwner: null };
    if (p.background) { v.discovered = true; continue; }
    if (g.observer) { v.discovered = true; }
    const corrupted = (p.currentCorruption ?? -1) !== -1 && !!faction?.bool('Benefits_From_Corruption');
    const ownOrbit = orbit[p.index].filter(f => friendly(f.owner, viewer));
    const present = ownOrbit.some(f => f.units.some(u => !strategicStealth(u)));
    let direct = strength(p) > 0 && friendly(controller(p), viewer) || corrupted;
    if (!present) v.revealFrames = 0;
    else if (!direct) {
      direct = ticks > 0 && (v.revealFrames > limit || v.revealFrames + ticks > Math.floor(limit) + 1);
      v.revealFrames = Math.min(Math.floor(limit) + 1, v.revealFrames + ticks);
    }
    if (direct) { v.discovered = true; qualified.push(p.index); }
    let mask = (g.observer || friendly(targetController(p), viewer) ? VIS.ALL : baseline) | spies[p.index];
    for (const m of p.visibilityModifiers || []) if (same(m.owner, viewer) && (m.expires == null || m.expires > g.time)) mask |= m.mask;
    for (const m of p.visibilityModifiers || []) if (same(m.owner, viewer)) {
      if (m.expires != null && m.expires <= g.time) continue;
      if (m.min != null) mask = Math.max(mask, m.min);
      if (m.max != null) mask = Math.min(mask, m.max);
    }
    if (corrupted) mask |= VIS.ALL;
    if ((v.mask & VIS.OWNER) && !(mask & VIS.OWNER)) v.rememberedOwner = controller(p);
    v.mask = mask;
    const groundOwner = p.groundStructures[0]?.owner;
    const spaceOwner = p.station ? p.stationOwner || p.owner : null;
    const groundBlocked = p.type.bool('Planet_Groundbase_Stealth') && groundOwner && !friendly(groundOwner, viewer) && !corrupted;
    const spaceBlocked = p.type.bool('Planet_Starbase_Stealth') && spaceOwner && !friendly(spaceOwner, viewer) && !corrupted;
    const groundLevel = Math.min(5, p.groundStructures.filter(u => same(u.owner, groundOwner)).length);
    v.groundLevel = !groundBlocked && (!!(mask & VIS.GROUND_LEVEL) || friendly(groundOwner, viewer) || groundLevel >= minLevel);
    v.spaceLevel = !spaceBlocked && (!!(mask & VIS.SPACE_LEVEL) || friendly(spaceOwner, viewer) || (p.spaceLevel || 0) >= minLevel);
    v.groundContents = !groundBlocked && !!(mask & VIS.GROUND_CONTENTS);
    v.groundCount = !groundBlocked && !!(mask & (VIS.GROUND_CONTENTS | VIS.GROUND_COUNT));
    v.fleetContents = !spaceBlocked && !!(mask & VIS.FLEET_CONTENTS);
    v.fleetCount = !spaceBlocked && !!(mask & (VIS.FLEET_CONTENTS | VIS.FLEET_COUNT));
    v.fleetPresence = !spaceBlocked && !!(mask & (VIS.FLEET_CONTENTS | VIS.FLEET_COUNT | VIS.FLEET_PRESENCE));
    v.fleetOverlay = !spaceBlocked && !!(mask & (VIS.FLEET_CONTENTS | VIS.FLEET_COUNT | VIS.MOST_POWERFUL));
    v.income = !!(mask & (VIS.INCOME | 0x8000));
    v.ownerKnown = corrupted || same(controller(p), viewer) ||
      !p.type.bool('Planet_Groundbase_Stealth') && (!p.type.bool('Planet_Starbase_Stealth') && !!(mask & VIS.OWNER) || ownOrbit.length > 0) ||
      v.spaceLevel && (p.spaceLevel || 0) > 0 || v.groundLevel && groundLevel > 0 || v.groundContents && p.garrison.length > 0;
  }
  if (g.autoReveal !== false) for (const i of qualified) for (const j of adjacent[i]) state.planets[j].discovered = true;
  const revealed = g.planets.some((p, i) => !p.background && state.planets[i]?.discovered && !known[i]);
  state.revealed = ticks > 0 && (revealed || !!state.revealPending);
  state.revealPending = ticks > 0 ? false : state.revealPending || revealed;
  return state;
}

export function visibleTransit(g, f, viewer) {
  if (!f.leg) return false;
  if (g.observer || same(f.owner, viewer)) return true;
  const hidden = f.units.length > 0 && f.units.every(strategicStealth);
  if (!hidden && same(g.planets[f.leg.b]?.owner, viewer)) return true;
  if (!intelligence(g, g.planets[f.leg.a])?.discovered && !intelligence(g, g.planets[f.leg.b])?.discovered) return false;
  if (f.units.every(strategicStealth)) return false;
  const benefits = !!db.faction(viewer)?.bool('Benefits_From_Corruption'), bribery = db.constants.num('Bribery_Fleet_Reveal_Range', 0);
  const near = (p, range) => f.pos.reduce((s, n, i) => s + (n - p.pos[i]) ** 2, 0) < range ** 2;
  return g.planets.some(p => {
    const type = p.currentCorruption ?? -1;
    if (benefits && type === 5) return near(p, bribery);
    return same(p.owner, viewer) && type !== 0 && near(p, p.type.num('Hyperspace_Fleet_Reveal_Range', 0));
  });
}
