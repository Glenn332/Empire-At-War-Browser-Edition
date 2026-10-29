import { db } from '../gamedata.js';
import { forceKind } from './galaxy.js';
const KEYS = new Map(),
  key = x => {
    if (typeof x !== 'string') return String(x || '').toUpperCase();
    let k = KEYS.get(x);
    if (k === undefined) {
      k = x.toUpperCase();
      if (KEYS.size < 50000) KEYS.set(x, k);
    }
    return k;
  },
  spawnCache = new WeakMap(),
  categoryCache = new WeakMap(),
  relationCache = new WeakMap(),
  relationMemo = new Map(),
  powerCache = new WeakMap();
function members(type) {
  const company = type.list('Company_Units'),
    squadron = type.list('Squadron_Units');
  return (squadron.length ? squadron : company).map(n => db.type(n)).filter(Boolean);
}
export function strategicCategories(type, seen = new Set()) {
  if (categoryCache.has(type)) return categoryCache.get(type);
  if (seen.has(type)) return new Set();
  seen.add(type);
  const units = members(type),
    cats = new Set(units.length ? [] : type.categories());
  for (const member of units) for (const c of strategicCategories(member, seen)) cats.add(c);
  seen.delete(type);
  categoryCache.set(type, cats);
  return cats;
}
export function strategicPower(type, seen = new Set()) {
  if (powerCache.has(type)) return powerCache.get(type);
  if (seen.has(type)) return 0;
  seen.add(type);
  const units = members(type),
    power = units.length
      ? units.reduce((n, t) => Math.fround(n + strategicPower(t, seen)), 0)
      : Math.max(0, Math.fround(type.num('AI_Combat_Power', 0)));
  seen.delete(type);
  powerCache.set(type, power);
  return power;
}
export function startingSpawns(type, tech, exact = false) {
  let cache = spawnCache.get(type);
  if (!cache) {
    cache = new Map();
    spawnCache.set(type, cache);
  }
  const id = tech + '|' + exact;
  if (cache.has(id)) return cache.get(id);
  let out = [];
  for (let i = Math.min(tech, 5); i >= 0; i--) {
    const values = type.list('Starting_Spawned_Units_Tech_' + i);
    for (let j = 0; j + 1 < values.length; j += 2) {
      const t = db.type(values[j]);
      if (t) out.push({ type: t, count: +values[j + 1] || 0 });
    }
    if (out.length || exact) break;
  }
  cache.set(id, out);
  return out;
}
export function factionRelated(owner, other, friendly) {
  let row = relationMemo.get(owner);
  if (!row) {
    row = new Map();
    relationMemo.set(owner, row);
  }
  let r = row.get(other);
  if (r === undefined) {
    const faction = db.faction(owner);
    r = 4;
    if (faction) {
      let relations = relationCache.get(faction);
      if (!relations) {
        relations = {
          allies: new Set([key(owner), ...faction.list('Allies').map(key)]),
          enemies: new Set(faction.list('Enemies').map(key))
        };
        relationCache.set(faction, relations);
      }
      if (relations.allies.has(key(other))) r |= 1;
      if (relations.enemies.has(key(other))) r |= 2;
    }
    row.set(other, r);
  }
  return !!(r & (friendly ? 1 : 2));
}
export class GalacticForces {
  constructor(game) {
    this.game = game;
    const g = game.galaxy;
    this.space = g.planets.map(() => []);
    this.ground = g.planets.map(() => []);
    this.units = [];
    const tech = new Map(g.players.map(p => [key(p.faction), p.tech]));
    const add = (list, type, owner, count = 1, record = null, cats = strategicCategories(type)) =>
      list.push({ type, owner, power: strategicPower(type) * count, cats, record });
    const spawns = (type, owner, at) => {
      for (const x of startingSpawns(type, tech.get(key(owner)) || 0)) add(this.space[at], x.type, owner, x.count);
    };
    for (const p of g.planets) {
      if (p.station) spawns(p.station, p.stationOwner || p.owner, p.index);
      for (const u of p.garrison)
        if (!u.dead) {
          add(this.ground[p.index], u.type, u.owner, 1, u);
          this.units.push({ record: u, type: u.type, owner: u.owner, planet: p, fleet: null });
        }
      for (const u of [...p.groundStructures, ...p.orbitalStructures])
        if (!u.dead) {
          const space = u.type.bool('Is_Special_Weapon_In_Space') || forceKind(u.type) === 'orbital structure';
          if (space)
            add(
              this.space[p.index],
              u.type,
              u.owner,
              1,
              u,
              new Set(
                u.type
                  .str('Space_Or_Garrison_Category', u.type.str('Garrison_Category', 'Capital'))
                  .toUpperCase()
                  .split(/[\s,|]+/)
              )
            );
          if (forceKind(u.type) === 'ground structure')
            for (const x of startingSpawns(u.type, tech.get(key(u.owner)) || 0)) add(this.ground[p.index], x.type, u.owner, x.count);
        }
    }
    for (const fleet of g.fleets)
      for (const u of fleet.units)
        if (!u.dead) {
          const type = u.carries || u.type,
            planet = g.planets[fleet.planet] || null;
          this.units.push({ record: u, type, owner: fleet.owner, planet, fleet });
          if (planet && !fleet.leg) {
            add(this.space[planet.index], type, fleet.owner, 1, u);
            spawns(type, fleet.owner, planet.index);
          }
        }
    this.objects = this.units.slice();
    for (const p of g.planets) {
      this.objects.push({ type: p.type, owner: p.owner, planet: p });
      if (p.station) this.objects.push({ type: p.station, owner: p.stationOwner || p.owner, planet: p });
      for (const u of [...p.groundStructures, ...p.orbitalStructures])
        if (!u.dead) this.objects.push({ record: u, type: u.type, owner: u.owner, planet: p });
    }
    this.aggregates = new Map();
  }
  related(owner, other, friendly) {
    return factionRelated(owner, other, friendly);
  }
  maintenance(owner) {
    const id = 'maintenance:' + owner;
    if (this.aggregates.has(id)) return this.aggregates.get(id);
    const faction = db.faction(owner)?.num('Maintenance_Cost', 0) || 0,
      factor = db.constants.num('Production_Speed_Factor', 1);
    let value = 0;
    for (const u of this.units)
      if (u.fleet && key(u.owner) === key(owner)) {
        const t = u.type,
          time = Math.trunc(t.num('Build_Time_Seconds', 0)) * factor,
          maintenance = t.num('Maintenance_Cost', 0) * faction;
        if (time && maintenance) value += (t.num('Build_Cost_Credits', 0) / time / 30) * maintenance;
      }
    this.aggregates.set(id, value);
    return value;
  }
  total(owner, friendly, space, categories = null, planet = null) {
    const cats = categories?.length ? categories.map(key) : null;
    const sum = list => {
      let n = 0;
      for (const e of list) {
        let hit = this.related(owner, e.owner, friendly);
        if (hit && cats) {
          hit = false;
          for (const c of cats)
            if (e.cats.has(c)) {
              hit = true;
              break;
            }
        }
        n += hit ? e.power : 0;
      }
      return n;
    };
    const lists = space ? this.space : this.ground;
    if (planet) return sum(lists[planet.index] || []);
    return lists.reduce((n, l) => n + sum(l), 0);
  }
  aggregate(owner, friendly, space, categories = null, max = false) {
    const id = [owner, friendly, space, categories?.join('|'), max].join(':');
    if (this.aggregates.has(id)) return this.aggregates.get(id);
    const values = (space ? this.space : this.ground).map((_, index) =>
      this.total(owner, friendly, space, categories, this.game.galaxy.planets[index])
    );
    const value = max ? Math.max(0, ...values) : values.reduce((a, b) => a + b, 0);
    this.aggregates.set(id, value);
    return value;
  }
  selfTotal(owner, space, categories = null) {
    const g = this.game.galaxy,
      tech = g.players.find(p => key(p.faction) === key(owner))?.tech || 0;
    const objects = this.units.filter(u => key(u.owner) === key(owner)).map(u => u.type);
    for (const p of g.planets) {
      if (key(p.owner) === key(owner)) objects.push(p.type);
      if (p.station && key(p.stationOwner || p.owner) === key(owner)) objects.push(p.station);
      for (const u of [...p.groundStructures, ...p.orbitalStructures]) if (key(u.owner) === key(owner)) objects.push(u.type);
    }
    const match = (t, cats = strategicCategories(t)) => !categories?.length || categories.some(c => cats.has(key(c)));
    let power = 0;
    for (const type of objects) {
      const kind = forceKind(type),
        own = space
          ? ['starship', 'squadron', 'orbital structure'].includes(kind) || type.bool('Is_Special_Weapon_In_Space')
          : kind === 'company';
      const cats =
        space && !['starship', 'squadron'].includes(kind)
          ? new Set(
              type
                .str('Space_Or_Garrison_Category', type.str('Garrison_Category', 'Capital'))
                .toUpperCase()
                .split(/[\s,|]+/)
            )
          : strategicCategories(type);
      if (own && match(type, cats)) power += strategicPower(type);
      for (const x of startingSpawns(type, tech, true)) if (match(x.type)) power += strategicPower(x.type) * x.count;
    }
    return power;
  }
}
