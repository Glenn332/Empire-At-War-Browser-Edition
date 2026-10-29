import { simRandom } from './simrandom.js';
import { db } from '../gamedata.js';
import { forceKind } from './galaxy.js';
import { strategicPower, strategicCategories, startingSpawns } from './galacticforces.js';
import { fetchText } from '../vfs.js';
import { parseXML } from '../xml.js';

const key = x => String(x || '').toUpperCase(),
  f = Math.fround;
let categoryMasks = new Map(),
  typeMasks = new WeakMap(),
  nameMasks = new Map(),
  contrastCache = new WeakMap();
const mask = names => names.reduce((m, n) => m | (categoryMasks.get(key(n)) || 0n), 0n);
const typeMask = type => {
  let m = typeMasks.get(type);
  if (m === undefined) {
    m = mask([...strategicCategories(type)]);
    typeMasks.set(type, m);
  }
  return m;
};
const nameMask = name => {
  let m = nameMasks.get(name);
  if (m === undefined) {
    m = mask(name.split(/[\s,|]+/));
    nameMasks.set(name, m);
  }
  return m;
};
const matches = (type, name) =>
  categoryMasks.size ? !!(typeMask(type) & nameMask(name)) : name.split('|').some(n => strategicCategories(type).has(key(n)));
export async function nativeAutoContrast(contrast) {
  const xml = await fetchText('Data/XML/Enum/GameObjectCategoryType.xml');
  categoryMasks = new Map(parseXML(xml || '').children[0]?.children.map(n => [key(n.tag), BigInt(n.text.trim())]) || []);
  typeMasks = new WeakMap();
  nameMasks = new Map();
  contrastCache = new WeakMap();
  let count = 8;
  const list = [],
    value = e => BigInt.asUintN(64, e.mask);
  const bucket = e => {
    const x = (Number(BigInt.asUintN(32, value(e))) ^ 0xdeadbeef) & 0x7fffffff;
    let h = (x % 127773) * 16807 - Math.floor(x / 127773) * 2836;
    if (h < 0) h += 2147483647;
    return h & (count - 1);
  };
  const place = (entry, same) => {
    const after = same.filter(e => value(e) <= value(entry)).at(-1);
    list.splice(same.length ? (after ? list.indexOf(after) + 1 : list.indexOf(same[0])) : list.length, 0, entry);
  };
  for (const [name, weights] of contrast) {
    const entry = { name, weights, mask: mask(name.split(/[\s,|]+/)) };
    if (list.some(e => value(e) === value(entry))) continue;
    if (list.length + 1 > count) {
      count = 2 ** Math.ceil(Math.log2(count < 512 ? count * 8 : list.length + 1));
      const seen = new Map();
      for (const old of [...list]) {
        const b = bucket(old),
          same = seen.get(b) || [];
        if (same.length) {
          list.splice(list.indexOf(old), 1);
          place(old, same);
        }
        same.push(old);
        same.sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0));
        seen.set(b, same);
      }
    }
    place(
      entry,
      list.filter(e => bucket(e) === bucket(entry))
    );
  }
  return new Map(list.map(e => [e.name, e.weights]));
}
export function contrastWeight(type, list) {
  if (!list) return 0;
  let cache = contrastCache.get(list);
  if (!cache) {
    cache = new WeakMap();
    contrastCache.set(list, cache);
  }
  if (cache.has(type)) return cache.get(type);
  if (list.types.has(type)) {
    const value = list.types.get(type);
    cache.set(type, value);
    return value;
  }
  let sum = 0,
    count = 0,
    matched = false;
  for (const [category, value] of list.kinds)
    if (matches(type, category)) {
      matched = true;
      if (value !== 1) {
        sum += value;
        count++;
      }
    }
  const value = count ? sum / count : matched ? 1 : 0;
  cache.set(type, value);
  return value;
}
export function namedHero(type, seen = new Set()) {
  if (seen.has(type)) return false;
  seen.add(type);
  return (
    type.bool('Is_Named_Hero') ||
    [...type.list('Company_Units'), ...type.list('Squadron_Units')].some(n => {
      const member = db.type(n);
      return member && namedHero(member, seen);
    })
  );
}
function effective(type, space) {
  for (const name of [...type.list('Company_Units'), ...type.list('Squadron_Units')]) {
    const unique = db.type(db.type(name)?.str(space ? 'Unique_Space_Unit' : 'Unique_Ground_Unit'));
    if (unique) return strategicPower(type) > strategicPower(unique) ? type : unique;
  }
  return type;
}
export function autoCombatant(type, owner, { record = null, station = false, transport = false, space = true } = {}) {
  const resolved = effective(type, space),
    parts = [];
  if (transport && resolved !== type && forceKind(resolved) !== 'company') transport = false;
  if (!transport) parts.push(resolved);
  return {
    type: resolved,
    original: type,
    owner,
    record,
    station,
    transport,
    hero: namedHero(type),
    parts,
    power: strategicPower(resolved)
  };
}
export function specialCombatant(u) {
  const type = u.original,
    children = [...type.list('Company_Units'), ...type.list('Squadron_Units')].map(n => db.type(n)).filter(Boolean);
  return { super: matches(children[0] || type, 'SUPER'), killer: children.some(t => t.bool('Is_Super_Weapon_Killer')) };
}
export function landBomber(g, planet, owner) {
  const tech = g.players.find(p => key(p.faction) === key(owner))?.tech || 0;
  const bomber = t => db.type(t?.str('Land_Bomber_Type'));
  for (const fleet of g.fleets)
    if (fleet.planet === planet && !fleet.leg && key(fleet.owner) === key(owner))
      for (const record of fleet.units) {
        if (record.dead) continue;
        const type = record.type;
        let found = null;
        for (let tier = 0; tier <= Math.min(5, tech) && !found; tier++)
          for (const spawn of startingSpawns(type, tier, true)) {
            for (const name of spawn.type.list('Squadron_Units')) {
              found = bomber(db.type(name));
              if (found) break;
            }
            if (found) break;
          }
        for (const name of [...type.list('Company_Units'), ...type.list('Squadron_Units')]) {
          const actual = bomber(db.type(name));
          if (actual) {
            found = actual;
            break;
          }
        }
        if (found) return found;
      }
  return null;
}
function buckets(roster, contrast) {
  const out = [{ category: null, power: 0 }, ...Array.from(contrast.keys(), category => ({ category, power: 0 }))];
  for (const u of roster)
    for (const type of u.parts) {
      const power = strategicPower(type);
      out[0].power += power;
      const row = out.find((r, i) => i && matches(type, r.category));
      if (row) row.power += power;
    }
  return out;
}
export function subtractForces(roster, initial, contrast, attackOnly = [], scale = 1) {
  const out = initial.map(r => ({ ...r }));
  const bonuses = new Map();
  for (const u of roster) {
    const type = db.type(u.type.list('Company_Units')[0]) || db.type(u.type.list('Squadron_Units')[0]) || u.type;
    for (const root of type.sub('Abilities'))
      for (const ability of root.children) {
        const categories = mask(ability.val('Unit_Strength_Category').split(/[\s,|]+/)),
          bonus = f(ability.num('Unit_Strength_Factor', 1) - 1);
        for (let i = 0; i < 32; i++) if (categories & (1n << BigInt(i))) bonuses.set(i, Math.max(bonuses.get(i) || 0, bonus));
      }
  }
  for (const u of attackOnly.concat(roster))
    for (const type of u.parts) {
      const original = f(f(strategicPower(type)) * scale);
      if (!(original > 0)) continue;
      let factor = 0;
      const cats = typeMask(type);
      for (let i = 0; i < 32; i++) if (cats & (1n << BigInt(i)) && (bonuses.get(i) || 0) > factor) factor = f(bonuses.get(i) + 1);
      const power = f(original * (factor || 1));
      let chosen = 0,
        best = 0,
        weight = 0;
      for (let j = 1; j < out.length; j++)
        if (out[j].power > 0) {
          const c = contrastWeight(type, contrast.get(out[j].category));
          if (!(c > 0)) continue;
          const p = original * c,
            b = out[j].power,
            score = c * Math.max(0, 1 - ((b - p) / Math.max(b, p)) ** 2);
          if (score > best) {
            best = score;
            chosen = j;
            weight = f(c);
          }
        }
      if (!chosen) {
        out[0].power -= power;
        continue;
      }
      const damage = Math.min(f(out[chosen].power), f(power * weight)),
        remaining = f(f(1 - f(damage / f(power * weight))) * original);
      out[chosen].power -= damage;
      out[0].power -= f(damage + remaining);
    }
  return out;
}
const positiveTotal = rows => rows.reduce((n, r) => n + Math.max(0, r.power), 0);
function downgrade(type, budget, allowance) {
  const seen = new Set();
  budget = f(budget);
  while (type && f(strategicPower(type) * allowance) > budget) {
    if (seen.has(type)) return null;
    seen.add(type);
    const name = type.name;
    type = db.type(name.slice(0, -1) + String.fromCharCode(name.charCodeAt(name.length - 1) - 1));
  }
  return type;
}
function casualties(roster, budget, won, playable, space, settings, random, enemyKiller) {
  const alive = new Set(),
    stations = new Map(),
    pending = roster.filter(u => !u.transport),
    transports = roster.filter(u => u.transport);
  let quota = won
    ? transports.length
    : playable && transports.length > 1
      ? Math.floor(f(f(f(1 - settings.transportLosses) * transports.length) + 0.5))
      : 0;
  for (const u of transports.filter(u => u.hero).concat(transports.filter(u => !u.hero))) if (quota-- > 0) alive.add(u);
  const smallest = roster.filter(u => !u.transport && !u.groundBase).reduce((a, u) => (!a || u.power < a.power ? u : a), null);
  while (pending.length) {
    const hero = pending.findIndex(u => u.hero || forceKind(u.original) === 'ground structure'),
      index = hero >= 0 ? hero : Math.min(pending.length - 1, Math.floor(random() * pending.length)),
      u = pending.splice(index, 1)[0];
    if (u.groundBase) {
      if (won) alive.add(u);
      continue;
    }
    if (matches(u.type, 'SUPER')) {
      if (won || (playable && !enemyKiller)) {
        alive.add(u);
        if (u.station) stations.set(u, u.original);
      }
      continue;
    }
    if (u.station) {
      const type = won ? downgrade(u.original, budget, settings.allowance) : null;
      if (type) {
        alive.add(u);
        stations.set(u, type);
        budget = Math.max(0, budget - strategicPower(type));
      }
    } else if (budget - f(u.power * settings.allowance) > 0) {
      alive.add(u);
      budget = Math.max(0, budget - u.power);
    }
  }
  if (won && !alive.size && smallest) {
    alive.add(smallest);
    if (smallest.station) stations.set(smallest, smallest.original);
  }
  return { alive, stations };
}
export function overrunSide(attacker, defender, contrast, constants = db.constants) {
  const multiple = f(constants.num('Overrun_Auto_Resolve_Multiple', 0));
  if (!(multiple > 0)) return -1;
  const raw = [buckets(attacker, contrast), buckets(defender, contrast)].map(r => r[0].power),
    weak = raw[0] < raw[1] ? 0 : 1;
  return Math.min(...raw) * multiple < Math.max(...raw) && ![attacker, defender][weak].some(u => u.hero) ? weak : -1;
}
export function resolveAutoBattle(
  attacker,
  defender,
  contrast,
  { space = true, random = simRandom, constants = db.constants, bombardment = null, scale = 1 } = {}
) {
  const settings = {
    allowance: f(constants.num('AutoResolveAttritionAllowanceFactor', 0.333333)),
    transportLosses: f(constants.num('AutoResolveTransportLosses', 0.333333))
  };
  const initial = [buckets(attacker, contrast), buckets(defender, contrast)],
    remaining = [
      subtractForces(defender, initial[0], contrast, [], scale),
      subtractForces(attacker, initial[1], contrast, !space && bombardment ? [{ parts: [bombardment] }] : [], scale)
    ];
  const playable = [attacker, defender].map(roster => db.faction(roster[0]?.owner)?.bool('Is_Playable') || false);
  let winner = positiveTotal(remaining[0]) > positiveTotal(remaining[1]) ? 0 : 1;
  if (positiveTotal(remaining[0]) > 0 && positiveTotal(remaining[1]) > 0 && playable[0] !== playable[1]) winner = playable[0] ? 0 : 1;
  const special = [attacker, defender].map(r => r.map(specialCombatant)),
    supers = special.map(r => r.some(u => u.super)),
    killers = special.map(r => r.some(u => u.killer));
  if (initial[0][0].power <= 0 && initial[1][0].power <= 0 && space && !supers.some(Boolean))
    return {
      winner: attacker.length > defender.length ? 0 : 1,
      initial,
      remaining,
      sides: [attacker, defender].map(r => ({ alive: new Set(r), stations: new Map(r.filter(u => u.station).map(u => [u, u.original])) }))
    };
  const raw = initial.map(r => r[0].power),
    weak = raw[0] < raw[1] ? 0 : 1,
    multiple = f(constants.num('Overrun_Auto_Resolve_Multiple', 0));
  const overrun = multiple > 0 && Math.min(...raw) * multiple < Math.max(...raw) && ![attacker, defender][weak].some(u => u.hero);
  let retreat = overrun;
  if (overrun) winner = 1 - weak;
  if (supers[1] && !killers[0]) {
    winner = 1;
    retreat = true;
  } else if (supers[0] && !killers[1]) {
    winner = 0;
    retreat = true;
  }
  const result = [];
  for (const i of [1, 0]) {
    const roster = [attacker, defender][i],
      won = i === winner,
      name = (overrun ? 'Retreat' : '') + (won ? 'AutoResolveWinnerAttrition' : 'AutoResolveLoserAttrition'),
      attrition = constants.num(name, overrun ? (won ? 0.5 : 0.65) : won ? 0.75 : 0.8);
    const budget = !won && !playable[i] ? 0 : remaining[i][0].power + (initial[i][0].power - remaining[i][0].power) * f(1 - f(attrition));
    result[i] = casualties(roster, budget, won, playable[i], space, settings, random, killers[1 - i]);
  }
  return { winner, initial, remaining, sides: result, retreat, superweaponDestroyed: supers[1 - winner] && killers[winner] };
}

export const packContrast = table =>
  table ? [...table].map(([name, w]) => [name, { types: [...w.types].map(([t, v]) => [t.name, v]), kinds: [...w.kinds] }]) : [];
export const unpackContrast = data =>
  new Map(
    (data || []).map(([name, w]) => [
      name,
      {
        types: new Map(
          w.types.flatMap(([n, v]) => {
            const t = db.type(n);
            return t ? [[t, v]] : [];
          })
        ),
        kinds: new Map(w.kinds)
      }
    ])
  );
