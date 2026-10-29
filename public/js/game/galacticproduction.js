import { db } from '../gamedata.js';
import { techFactor } from './planetabilities.js';
import { forceKind, placeStartingForce } from './galaxy.js';
import { planetAllowsCompany } from './invasion.js';
import { adjustCredits } from './galacticeconomy.js';
import { strategicStealth } from './galacticfog.js';

const mobile = t => ['company', 'starship', 'squadron'].includes(forceKind(t));
export const techAdvance = t => t.num('Build_Advances_Tech_Level', 0);
export function setTechLevel(g, owner, level) {
  const p = g.players.find(q => q.faction === owner);
  if (!p) return null;
  p.tech = Math.max(0, Math.min(p.maxTech, Math.trunc(level)));
  return p.tech;
}

export function ownedTypes(g, owner) {
  const out = [];
  for (const p of g.planets) {
    if (p.owner === owner) out.push(p.type);
    if (p.station && (p.stationOwner || p.owner) === owner) out.push(p.station);
    for (const u of [...p.groundStructures, ...p.orbitalStructures, ...p.garrison]) if (u.owner === owner) out.push(u.type);
  }
  for (const f of g.fleets) if (f.owner === owner) for (const u of f.units) out.push(u.carries || u.type);
  return out;
}

function ownedCount(g, owner, type) {
  const name = upperName(type),
    is = t => t === type || upperName(t) === name;
  let n = 0;
  for (const p of g.planets) {
    if (p.owner === owner && is(p.type)) n++;
    if (p.station && (p.stationOwner || p.owner) === owner && is(p.station)) n++;
    for (const list of [p.groundStructures, p.orbitalStructures, p.garrison])
      for (const u of list) if (u.owner === owner && is(u.type)) n++;
  }
  for (const f of g.fleets) if (f.owner === owner) for (const u of f.units) if (is(u.carries || u.type)) n++;
  return n;
}
export function productionSnapshot(g, owner) {
  const owned = new Map(),
    queuedNames = new Map(),
    add = (m, t) => {
      const n = upperName(t);
      m.set(n, (m.get(n) || 0) + 1);
    };
  for (const t of ownedTypes(g, owner)) add(owned, t);
  const jobs = queued(g, owner);
  for (const q of jobs) add(queuedNames, q.type);
  return { owned, queued: queuedNames, jobs };
}
const limitCount = (g, owner, type, snap) =>
  snap
    ? (snap.owned.get(upperName(type)) || 0) + (snap.queued.get(upperName(type)) || 0)
    : ownedCount(g, owner, type) + queuedCount(g, owner, type);
function queuedCount(g, owner, type) {
  const name = upperName(type);
  let n = 0;
  for (const p of g.planets)
    for (const q of Object.values(p.production || {}))
      for (const job of q) if (job.owner === owner && (job.type === type || upperName(job.type) === name)) n++;
  return n;
}

export function populationCap(g, owner) {
  if (g.popCapOverride) return g.popCapOverride;
  return ownedTypes(g, owner).reduce(
    (n, t) => n + t.num('Additional_Population_Capacity', 0),
    db.faction(owner)?.num('Base_Population_Capacity', 0) || 0
  );
}

export function populationUsed(g, owner) {
  const value = t => t.num('Population_Value', 0);
  let used = ownedTypes(g, owner).reduce((n, t) => n + value(t), 0);
  for (const p of g.planets) for (const q of Object.values(p.production || {}).flat()) if (q.owner === owner) used += value(q.type);
  return Math.floor(used + 0.5);
}

const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
const typeInfo = new WeakMap();
function info(type) {
  let i = typeInfo.get(type);
  if (!i) {
    i = {
      upper: String(type.name).toUpperCase(),
      affiliation: new Set(type.list('Affiliation').map(n => String(n).toUpperCase())),
      lists: new Map(),
      structures: null
    };
    typeInfo.set(type, i);
  }
  return i;
}
const upperName = type => info(type).upper;
const listSets = new WeakMap();
function listed(list, type) {
  if (!list?.length) return false;
  let c = listSets.get(list);
  if (!c || c.n !== list.length) {
    c = { n: list.length, set: new Set(list.map(n => String(n).toUpperCase())) };
    listSets.set(list, c);
  }
  return c.set.has(upperName(type));
}
export const payAsYouGo = (g, owner) => owner === g.active && db.constants.bool('Pay_As_You_Go', true);
const queued = (g, owner) =>
  g.planets.flatMap(p =>
    Object.values(p.production || {})
      .flat()
      .filter(q => q.owner === owner)
  );
const playerOf = (g, owner) => g.players.find(p => p.faction === owner);
export const productionKind = t =>
  t.num('Required_Ground_Base_Level', 0) > 0 ? 'ground' : t.num('Required_Star_Base_Level', 0) > 0 ? 'space' : null;
export const strategicProductionKind = t =>
  ['station', 'orbital structure'].includes(forceKind(t)) ? 'space' : forceKind(t) === 'ground structure' ? 'ground' : productionKind(t);
export const strategicItem = t =>
  ['station', 'ground structure', 'orbital structure'].includes(forceKind(t)) || t.num('Build_Advances_Tech_Level', 0) > 0;
const kindOf = t => (strategicItem(t) ? strategicProductionKind(t) : productionKind(t));

export const groundLevel = (p, owner) => Math.min(5, p.groundStructures.filter(u => u.owner === owner).length);

function structures(p, owner) {
  return [...p.groundStructures, ...p.orbitalStructures].filter(u => u.owner === owner);
}
function requirements(type, key) {
  const lists = info(type).lists;
  let v = lists.get(key);
  if (!v) {
    v = type.list(key).map(n => n.toUpperCase());
    lists.set(key, v);
  }
  return v;
}

export function structureRequirements(type) {
  const i = info(type);
  return i.structures || (i.structures = readStructureRequirements(type));
}
function readStructureRequirements(type) {
  const tokens = (type.raw('Required_Special_Structures') || []).join(' ').match(/[^\s,|]+|\|/g) || [];
  const groups = [];
  let alternative = false;
  for (const token of tokens) {
    if (token === '|') {
      alternative = true;
      continue;
    }
    if (alternative && groups.length) groups[groups.length - 1].push(token.toUpperCase());
    else groups.push([token.toUpperCase()]);
    alternative = false;
  }
  return groups;
}
function hasStructures(p, owner, type) {
  const groups = structureRequirements(type);
  if (!groups.length) return true;
  const own = structures(p, owner).map(u => upperName(u.type));
  return groups.every(group => group.some(n => !db.type(n) || own.includes(n)));
}
function hasOrbiting(g, p, owner, type) {
  const needed = requirements(type, 'Required_Orbiting_Units');
  if (!needed.length) return true;
  return needed.every(n =>
    g.fleets.some(f => f.owner === owner && f.planet === p.index && !f.leg && f.units.some(u => upperName(u.carries || u.type) === n))
  );
}

const abilityLists = new WeakMap();
function effects(type) {
  let list = abilityLists.get(type);
  if (!list) {
    list = type
      .sub('Abilities')
      .flatMap(a => a.children)
      .filter(a => /^Reduce_Production_(Price|Time)_Ability$/i.test(a.tag))
      .map(a => ({
        price: /Price/i.test(a.tag),
        wide: /^yes|true$/i.test(a.val('Galaxy_Wide')),
        category: a.num('Stacking_Category', 0),
        amount: a.num(/Price/i.test(a.tag) ? 'Price_Reduction_Percentage' : 'Time_Reduction_Percentage', 0),
        types: a
          .val('Applicable_Unit_Types')
          .toUpperCase()
          .split(/[\s,|]+/),
        categories: a
          .val('Applicable_Unit_Categories')
          .toUpperCase()
          .split(/[\s,|]+/),
        excludedTypes: a
          .val('Excluded_Unit_Types')
          .toUpperCase()
          .split(/[\s,|]+/),
        excludedCategories: a
          .val('Excluded_Unit_Categories')
          .toUpperCase()
          .split(/[\s,|]+/)
      }));
    abilityLists.set(type, list);
  }
  return list;
}

export function productionContexts(g, owner) {
  const items = [],
    visit = (type, where, depth = 0, wideOn = true) => {
      for (const a of effects(type)) items.push({ a, where, wideOn });
      if (depth < 2)
        for (const name of [...type.list('Company_Units'), ...type.list('Squadron_Units')]) {
          const t = db.type(name);
          if (t) visit(t, where, depth + 1);
        }
    };
  for (const at of g.planets) {
    if (at.owner === owner && !at.destroyed) visit(at.type, at.index, 0, at.currentCorruption !== 0);
    if (at.station && (at.stationOwner || at.owner) === owner) visit(at.station, at.index);
    for (const u of [...at.groundStructures, ...at.orbitalStructures, ...at.garrison]) if (u.owner === owner) visit(u.type, at.index);
  }
  for (const f of g.fleets) if (f.owner === owner) for (const u of f.units) visit(u.carries || u.type, f.leg ? -1 : f.planet);
  return p => {
    const out = [];
    for (const { a, where, wideOn } of items) if (a.wide ? wideOn : where === p.index) out.push(a);
    return out;
  };
}

export function productionContext(g, p, owner) {
  const out = [],
    visit = (type, local, depth = 0, wideOn = true) => {
      for (const a of effects(type)) if (a.wide ? wideOn : local) out.push(a);
      if (depth < 2)
        for (const name of [...type.list('Company_Units'), ...type.list('Squadron_Units')]) {
          const t = db.type(name);
          if (t) visit(t, local, depth + 1);
        }
    };
  for (const at of g.planets) {
    if (at.owner === owner && !at.destroyed) visit(at.type, at === p, 0, at.currentCorruption !== 0);
    if (at.station && (at.stationOwner || at.owner) === owner) visit(at.station, at === p);
    for (const u of [...at.groundStructures, ...at.orbitalStructures, ...at.garrison]) if (u.owner === owner) visit(u.type, at === p);
  }
  for (const f of g.fleets) if (f.owner === owner) for (const u of f.units) visit(u.carries || u.type, f.planet === p.index && !f.leg);
  return out;
}

function discount(type, context, price) {
  if (!context.length) return 1;
  const categories = type.categories(),
    groups = new Map();
  let cap = 0.999999;
  for (const a of context) {
    if (a.price !== price) continue;
    const explicit = a.types.includes(type.name.toUpperCase());
    const category =
      a.categories.some(c => c === 'ALL' || categories.has(c)) &&
      !a.excludedTypes.includes(type.name.toUpperCase()) &&
      !a.excludedCategories.some(c => c === 'ALL' || categories.has(c));
    if (!explicit && !category) continue;
    if (a.wide) cap = Math.min(cap, 0.99);
    groups.set(a.category, Math.max(groups.get(a.category) || 0, a.amount));
  }
  return (
    1 -
    Math.min(
      cap,
      [...groups.values()].reduce((a, b) => a + b, 0)
    )
  );
}

const factorLists = new WeakMap();
export function corruptionFactor(p, owner, tag) {
  const faction = db.faction(owner);
  if (!faction || faction.bool('Benefits_From_Corruption')) return 1;
  let lists = factorLists.get(faction);
  if (!lists) {
    lists = new Map();
    factorLists.set(faction, lists);
  }
  let list = lists.get(tag);
  if (!list) {
    list = faction.list(tag).map(parseFloat);
    lists.set(tag, list);
  }
  const value = list[(p.currentCorruption ?? -1) !== -1 ? 1 : 0];
  return Number.isFinite(value) ? value : 1;
}

export function productionCost(g, p, owner, type, context = productionContext(g, p, owner)) {
  const value =
    type.num('Build_Cost_Credits', 0) *
    discount(type, context, true) *
    corruptionFactor(p, owner, 'Corruption_Galactic_Production_Price_Multipliers') *
    (techAdvance(type) > 0 ? techFactor(g, owner) : 1);
  return Math.round(value > 0 ? Math.max(1, value) : value);
}

export function productionTime(g, p, owner, type, context = productionContext(g, p, owner)) {
  let time = Math.trunc(type.num('Build_Time_Seconds', 0) * db.constants.num('Production_Speed_Factor', 1));
  if (productionKind(type) === 'space') {
    const diff = p.spaceLevel - type.num('Tech_Level', 0);
    if (diff > 0) time *= db.constants.num('Production_Speed_Mod_Base_Vs_Tech_' + Math.min(4, diff - 1), 1);
  }
  if (type.bool('Build_Time_Reduced_By_Multiple_Factories')) {
    const names = requirements(type, 'Required_Special_Structures');
    time /= Math.max(1, structures(p, owner).filter(u => names.includes(u.type.name.toUpperCase())).length);
  }
  return (
    Math.max(
      0,
      Math.trunc(time * discount(type, context, false) * corruptionFactor(p, owner, 'Corruption_Galactic_Production_Time_Multipliers') * 30)
    ) / 30
  );
}

function prerequisite(g, p, owner, type, strategic = false, snap = null) {
  strategic = strategic || strategicItem(type);
  const player = playerOf(g, owner),
    kind = strategic ? strategicProductionKind(type) : productionKind(type),
    force = forceKind(type);
  if (
    !p ||
    p.owner !== owner ||
    !player ||
    !(mobile(type) || techAdvance(type) > 0 || (strategic && ['station', 'ground structure', 'orbital structure'].includes(force))) ||
    !kind
  )
    return 'Requires an owned production planet';
  if (p.destroyed && kind === 'ground') return 'Cannot be produced here';
  if (type.bool('Cinematic_Object_Only') || !planetAllowsCompany(p, type)) return 'Cannot be produced here';
  if (!info(type).affiliation.has(String(owner).toUpperCase())) return 'Requires the matching faction';
  if (type.num('Build_Cost_Credits', 0) <= 0 || type.num('Build_Time_Seconds', -1) < 0) return 'Cannot be produced';
  if (type.num('Tech_Level', 0) > player.tech) return 'Requires a higher tech level';
  if (techAdvance(type) > 0 && !(player.tech === type.num('Tech_Level', 0) && player.maxTech >= techAdvance(type)))
    return 'Cannot be produced';
  if (listed(player.disabledTypes, type) && owner !== g.active) return 'Cannot be produced';
  if (listed(player.lockedTypes, type) || (type.bool('Build_Initially_Locked') && !listed(player.unlockedTypes, type)))
    return 'Requires an unlock';
  if (groundLevel(p, owner) < type.num('Required_Ground_Base_Level', 0)) return 'Requires a ground base';
  const stationLevel = p.station && (p.stationOwner || p.owner) === owner ? p.spaceLevel : 0;
  if (stationLevel < type.num('Required_Star_Base_Level', 0)) return 'Requires a starbase';
  const allowed = requirements(type, 'Required_Planets');
  if (allowed.length && !allowed.includes(p.type.name.toUpperCase())) return 'Requires another production planet';
  if (!hasStructures(p, owner, type)) return 'Requires a special structure';
  if (!hasOrbiting(g, p, owner, type)) return 'Requires an orbiting unit';
  if (strategic) {
    const jobs = ['ground structure', 'orbital structure'].includes(force) ? (snap ? snap.jobs : queued(g, owner)) : [];
    if (
      force === 'ground structure' &&
      p.groundStructures.length + jobs.filter(q => q.planet === p.index && forceKind(q.type) === 'ground structure').length >=
        p.type.num('Special_Structures_Land', 3)
    )
      return 'No ground structure slots';
    if (
      force === 'orbital structure' &&
      p.orbitalStructures.length + jobs.filter(q => q.planet === p.index && forceKind(q.type) === 'orbital structure').length >=
        p.type.num('Special_Structures_Space', 5)
    )
      return 'No orbital structure slots';
    if (force === 'station' && (type.num('Base_Level', 0) > p.type.num('Max_Space_Base', 5) || type.num('Base_Level', 0) <= p.spaceLevel))
      return 'Invalid starbase level';
  }
  if (planetLimited(p, type)) return 'Cannot be produced here';
  const current = type.num('Build_Limit_Current_Per_Player', -1),
    lifetime = type.num('Build_Limit_Lifetime_Per_Player', -1);
  if (lifetime >= 0 && (player.builtCounts?.[type.name] || 0) >= lifetime) return 'TEXT_PRODUCTION_POP_CAP_REACHED';
  if (current >= 0 && limitCount(g, owner, type, snap) >= current) return 'TEXT_PRODUCTION_POP_CAP_REACHED';
  return null;
}

function planetLimited(p, type) {
  const max = type.num('Build_Max_Instances_Per_Planet', -1);
  if (max < 0 || !(hasBehavior(type, 'DUMMY_GROUND_STRUCTURE') || hasBehavior(type, 'DUMMY_ORBITAL_STRUCTURE'))) return false;
  const name = upperName(type),
    is = t => t === type || upperName(t) === name;
  let n = 0;
  for (const list of [p.groundStructures, p.orbitalStructures]) for (const u of list) if (is(u.type)) n++;
  for (const q of Object.values(p.production || {})) for (const job of q) if (is(job.type)) n++;
  return n >= max;
}

export function aiTypeBlocked(g, owner, type, room = null, snap = null) {
  const player = playerOf(g, owner),
    strategic = true,
    kind = strategicProductionKind(type),
    force = forceKind(type);
  if (
    !player ||
    !(mobile(type) || techAdvance(type) > 0 || (strategic && ['station', 'ground structure', 'orbital structure'].includes(force))) ||
    !kind
  )
    return true;
  if (type.bool('Cinematic_Object_Only')) return true;
  if (!info(type).affiliation.has(String(owner).toUpperCase())) return true;
  if (type.num('Build_Cost_Credits', 0) <= 0 || type.num('Build_Time_Seconds', -1) < 0) return true;
  if (type.num('Tech_Level', 0) > player.tech) return true;
  if (techAdvance(type) > 0 && !(player.tech === type.num('Tech_Level', 0) && player.maxTech >= techAdvance(type))) return true;
  if (listed(player.disabledTypes, type) && owner !== g.active) return true;
  if (listed(player.lockedTypes, type) || (type.bool('Build_Initially_Locked') && !listed(player.unlockedTypes, type))) return true;
  const current = type.num('Build_Limit_Current_Per_Player', -1),
    lifetime = type.num('Build_Limit_Lifetime_Per_Player', -1);
  if (current >= 0 && limitCount(g, owner, type, snap) >= current) return true;
  if (lifetime >= 0 && (player.builtCounts?.[type.name] || 0) >= lifetime) return true;
  if (
    db.constants.bool('AI_Uses_Galactic_Pop_Cap', false) &&
    type.num('Population_Value', 0) > Math.max(0, room ?? populationCap(g, owner) - populationUsed(g, owner))
  )
    return true;
  return false;
}

export function aiProductionBlock(g, planet, owner, type, room = null, snap = null) {
  const p = g.planets[planet],
    why = prerequisite(g, p, owner, type, true, snap);
  if (why) return why;
  if (
    db.constants.bool('AI_Uses_Galactic_Pop_Cap', false) &&
    type.num('Population_Value', 0) > Math.max(0, room ?? populationCap(g, owner) - populationUsed(g, owner))
  )
    return 'TEXT_PRODUCTION_POP_CAP_REACHED';
  return null;
}
export function queueAIProduction(g, planet, owner, type, adjustment = null) {
  const why = aiProductionBlock(g, planet, owner, type);
  if (why) return null;
  const p = g.planets[planet],
    context = productionContext(g, p, owner),
    kind = strategicProductionKind(type);
  const total = Math.max(0, Math.trunc(productionTime(g, p, owner, type, context) * (adjustment?.build[kind] ?? 1) * 30) / 30);
  const q = { type, owner, planet, cost: productionCost(g, p, owner, type, context), total, left: total, ai: true, paid: 0 };
  p.production[kind].push(q);
  return q;
}

const candidates = new Map();
const BUILD_TABS = [
  'Build_Tab_Land_Units',
  'Build_Tab_Space_Units',
  'Build_Tab_Heroes',
  'Build_Tab_Special_Structures',
  'Build_Tab_Outpost',
  'Build_Tab_Space_Station'
];
const hasBehavior = (t, b) => t.list('Behavior').some(x => x.toUpperCase() === b);
export const groundProduced = t =>
  t.num('Build_Cost_Credits', 0) > 0 && (t.num('Required_Ground_Base_Level', 0) !== 0 || hasBehavior(t, 'DUMMY_GROUND_STRUCTURE'));
const spaceProduced = t =>
  t.num('Build_Cost_Credits', 0) > 0 &&
  (t.num('Required_Star_Base_Level', 0) !== 0 || (hasBehavior(t, 'DUMMY_STAR_BASE') && t.num('Base_Level', 0) === 1));
export function availableUnits(g, planet, owner, kind) {
  const key = owner + ':' + kind;
  if (!candidates.has(key))
    candidates.set(
      key,
      [...db.types.values()].filter(
        t =>
          t.num('Build_Cost_Credits', 0) > 0 &&
          t.list('Affiliation').some(n => same(n, owner)) &&
          BUILD_TABS.some(f => t.bool(f)) &&
          !hasBehavior(t, 'DUMMY_GROUND_BASE') &&
          (groundProduced(t) || spaceProduced(t)) &&
          (groundProduced(t) ? 'ground' : 'space') === kind
      )
    );
  const p = g.planets[planet];
  return candidates.get(key).filter(t => !prerequisite(g, p, owner, t));
}

export function productionBlock(g, planet, owner, type, context) {
  const p = g.planets[planet],
    why = prerequisite(g, p, owner, type);
  if (why) return why;
  const list = p.production[kindOf(type)];
  if (type.num('Population_Value', 0) > Math.max(0, populationCap(g, owner) - populationUsed(g, owner)))
    return 'TEXT_PRODUCTION_POP_CAP_REACHED';
  if (!payAsYouGo(g, owner) && Math.trunc(playerOf(g, owner).credits) < productionCost(g, p, owner, type, context))
    return 'TEXT_PRODUCTION_INSUFFICIENT_FUNDS';
  if (owner === g.active && list.length >= db.constants.num('Max_Build_Queue', 5)) return 'TEXT_PRODUCTION_QUEUE_FULL';
  return null;
}

export function queueUnit(g, planet, owner, type) {
  const p = g.planets[planet];
  if (!p) return 'Requires an owned production planet';
  const context = productionContext(g, p, owner),
    why = productionBlock(g, planet, owner, type, context);
  if (why) return why;
  const cost = productionCost(g, p, owner, type, context),
    total = productionTime(g, p, owner, type, context);
  const payg = payAsYouGo(g, owner);
  if (!payg) adjustCredits(g, owner, -cost);
  p.production[kindOf(type)].push({ type, owner, cost, total, left: total, ...(payg ? { payg: true, paid: 0 } : {}) });
  return null;
}

export function cancelProduction(g, planet, owner, item) {
  const p = g.planets[planet];
  if (!p || p.owner !== owner || item.owner !== owner) return false;
  for (const list of Object.values(p.production)) {
    const at = list.indexOf(item);
    if (at < 0) continue;
    list.splice(at, 1);
    adjustCredits(g, owner, item.ai || item.payg ? item.paid || 0 : item.cost);
    return true;
  }
  return false;
}

export function stepProduction(g, seconds, ai = null, conflictAt = null) {
  const completed = [];
  for (const p of g.planets)
    for (const list of Object.values(p.production)) {
      for (let i = list.length - 1; i >= 0; i--) {
        const q = list[i];
        const player = playerOf(g, q.owner);
        const stationLevel = p.station && (p.stationOwner || p.owner) === q.owner ? p.spaceLevel : 0;
        const ownBase =
          groundLevel(p, q.owner) >= q.type.num('Required_Ground_Base_Level', 0) &&
          stationLevel >= q.type.num('Required_Star_Base_Level', 0);
        if (p.owner !== q.owner || !player || !ownBase || !hasStructures(p, q.owner, q.type) || !hasOrbiting(g, p, q.owner, q.type)) {
          list.splice(i, 1);
          if (q.ai) ai?.failed(q);
        }
      }
      let q = list[0];
      if (!q) continue;
      if (
        hasBehavior(q.type, 'DUMMY_STAR_BASE') &&
        !conflictAt?.(p.index) &&
        g.fleets.some(
          f =>
            f.planet === p.index && !f.leg && f.owner !== q.owner && f.units.some(u => !u.dead) && !f.units.every(u => strategicStealth(u))
        )
      ) {
        list.shift();
        if (q.ai) ai?.failed(q);
        (completed.interrupted ||= []).push({ planet: p, owner: q.owner, type: q.type });
        q = list[0];
        if (!q) continue;
      }
      const next = Math.max(0, q.left - seconds);
      if (q.payg) {
        const amount = q.total > 0 ? ((q.left - next) / q.total) * q.cost : q.cost - (q.paid || 0);
        if (amount > (playerOf(g, q.owner)?.credits ?? 0)) continue;
        adjustCredits(g, q.owner, -amount);
        q.paid = (q.paid || 0) + amount;
      }
      if (q.ai) {
        const amount = q.total > 0 ? ((q.left - next) / q.total) * q.cost : q.cost - (q.paid || 0);
        if (!ai || !ai.pay(q, amount)) continue;
        q.paid = (q.paid || 0) + amount;
      }
      q.left = next;
      if (q.left > 1e-7) continue;
      list.shift();
      const advance = techAdvance(q.type);
      const record = advance > 0 ? null : placeStartingForce(p, q.owner, q.type, g.fleets);
      const player = playerOf(g, q.owner),
        counts = player.builtCounts || (player.builtCounts = {});
      counts[q.type.name] = (counts[q.type.name] || 0) + 1;
      completed.push({
        planet: p.index,
        type: q.type,
        owner: q.owner,
        ...(advance > 0 ? { tech: setTechLevel(g, q.owner, advance) } : {})
      });
      if (q.ai) ai?.complete(q, record);
    }
  return completed;
}
