import { db } from '../gamedata.js';
import { fetchText, findFiles } from '../vfs.js';
import { parseXML } from '../xml.js';
import { aiPlayerType, aiPlayerTypes, difficultyAdjustment, readBrain, Reason } from './landbrain.js';
import { GoalSystem } from './landgoals.js';
import { simRandom } from './simrandom.js';
import { catParam } from './landbrain.js';
import { GalacticPlanning } from './galacticplanning.js';
import { GalacticBudget } from './galacticbudget.js';
import { GalacticForces, strategicPower } from './galacticforces.js';
import { GalacticFreeStore } from './galacticfreestore.js';
import { groundLevel } from './galacticproduction.js';
import { planetIncome, playerIncome, fiscalCycleSeconds, orbitFleets } from './galacticeconomy.js';
import { relation } from './galacticrelation.js';
import { blackMarketItems } from './blackmarket.js';

const KEYS = new Map(),
  key = x => {
    if (typeof x !== 'string') return String(x || '').toUpperCase();
    let k = KEYS.get(x);
    if (k === undefined) {
      k = x.toUpperCase();
      if (KEYS.size < 50000) KEYS.set(x, k);
    }
    return k;
  };
const AI_FRAME_MS = 4,
  AI_STEP_WORK = 80;
const KNOWN_HOST_RE =
    /^VARIABLE_TARGET\.(?:MAXSTRUCTURESLOTSUNNORMALIZED|TRADEROUTES|ACTIVETRADEROUTES|(?:FRIENDLYFORCE|ENEMYFORCE)\.HAS(?:SPACE|GROUND)FORCE)$/,
  NAME_RE = [
    /^VARIABLE_(?:SELF|HUMAN|ENEMY)\.|^GAME\./,
    /^SCRIPT_(.+)\.EVALUATE$/,
    /^VARIABLE_(SELF|HUMAN|ENEMY)\.PLANETSCONTROLLED(UNNORMALIZED)?$/,
    /^VARIABLE_SELF\.(?:NUM|HAS)(?:STAR|GROUND)BASEOFLEVEL$/,
    /^VARIABLE_(SELF|HUMAN|ENEMY)\.(SPACE|GROUND)DEFENDEDPLANETS$/,
    /^VARIABLE_TARGET\.(?:FRIENDLYFORCE|ENEMYFORCE)\.(?:SPACE|GROUND)TOTAL\.TIMELASTSEEN(?:UNNORMALIZED)?$/,
    /^VARIABLE_SELF\.AVERAGEAGEOF(?:SPACE|GROUND)INTELLIGENCE$/,
    /^VARIABLE_TARGET\.(FRIENDLYFORCE|ENEMYFORCE)\.HAS(GROUND|SPACE)UNITSBITFIELD$/,
    /^VARIABLE_TARGET\.(FRIENDLYFORCE|ENEMYFORCE)\.NEARBY(SPACE|GROUND)TOTAL$/,
    /^VARIABLE_(SELF|TARGET)\.(STRUCTURECOUNT|HASSTRUCTURE)$/,
    /^VARIABLE_TARGET\.(?:TYPE\.ISTYPE|ISSURFACEACCESSIBLE|(?:MAX|OPEN)?(?:GROUND|STAR|STRUCTURE)|BASEINCOME|INCOME)/,
    /^VARIABLE_STORYFLAG\[([^\]]+)\]$/,
    /^(GAME|VARIABLE_TARGET|VARIABLE_SELF|VARIABLE_HUMAN|VARIABLE_ENEMY)\.(?:(FRIENDLYFORCE|ENEMYFORCE)\.)?(PER[T]ARGETMAX(?:SPACE|GROUND)FORCE|(?:SPACE|GROUND)TOTAL(?:UNNORMALIZED|NBPTM|NBTD|NBTT)?|STARBASETOTALUNNORMALIZED|GROUNDBASETOTALUNNORMALIZED)$/
  ],
  nameMatches = new Map();
const nameMatch = (re, name) => {
  let m = nameMatches.get(re);
  if (!m) {
    m = new Map();
    nameMatches.set(re, m);
  }
  let r = m.get(name);
  if (r === undefined) {
    r = re.exec(name);
    m.set(name, r);
  }
  return r;
};
const level = value =>
  ({ easy: 'easy', medium: 'normal', normal: 'normal', hard: 'hard' })[
    key(String(value || '').match(/\[([^\]]+)\]$/)?.[1] ?? value).toLowerCase()
  ] || 'normal';
const named = (params, tag) => params.filter(([n]) => key(n) === key(tag)).map(([, v]) => key(v));
const dependencies = new WeakMap(),
  typeDependencies = new WeakMap();
function typeOnly(brain, name) {
  let cache = typeDependencies.get(brain.eq);
  if (!cache) {
    cache = new Map();
    typeDependencies.set(brain.eq, cache);
  }
  if (cache.has(name)) return cache.get(name);
  cache.set(name, false);
  const visit = e => {
    if (!Array.isArray(e)) return true;
    if (e[0] === '#') return false;
    if (e[0] === 'see') {
      const m = /^Function_(.+)\.Evaluate$/i.exec(e[1]);
      return m ? typeOnly(brain, key(m[1])) : /^Variable_Target\.Type\.IsType$/i.test(e[1]);
    }
    return e.every(v => !Array.isArray(v) || visit(v));
  };
  const result = visit(brain.eq.get(name));
  cache.set(name, result);
  return result;
}
function targetDependent(brain, name) {
  let cache = dependencies.get(brain.eq);
  if (!cache) {
    cache = new Map();
    dependencies.set(brain.eq, cache);
  }
  if (cache.has(name)) return cache.get(name);
  cache.set(name, true);
  const visit = e => {
    if (!Array.isArray(e)) return false;
    if (e[0] === '#') return true;
    if (e[0] === 'see') {
      const m = /^Function_(.+)\.Evaluate$/i.exec(e[1]);
      return m ? targetDependent(brain, key(m[1])) : /^Variable_Target\.|^Script_/i.test(e[1]);
    }
    return e.some(v => Array.isArray(v) && visit(v));
  };
  const result = visit(brain.eq.get(name));
  cache.set(name, result);
  return result;
}
export function galacticNeighbours(galaxy) {
  const radius = db.constants.num('MaximumFleetMovementDistance', 100),
    routes = new Set();
  for (const r of galaxy.routes) routes.add(Math.min(r.a, r.b) + ':' + Math.max(r.a, r.b));
  const out = galaxy.planets.map(() => []);
  for (let i = 0; i < galaxy.planets.length; i++)
    for (let j = i + 1; j < galaxy.planets.length; j++) {
      const a = galaxy.planets[i],
        b = galaxy.planets[j];
      if (a.background || b.background) continue;
      const route = routes.has(i + ':' + j),
        distance = route ? 0 : Math.hypot(...a.pos.map((v, k) => v - b.pos[k]));
      if (route || distance <= radius) {
        out[i].push({ planet: b, distance, route });
        out[j].push({ planet: a, distance, route });
      }
    }
  return out;
}

export const humanSide = (game, faction) => (game.isHuman ? game.isHuman(faction) : key(faction) === key(game.me));
export function galacticControllerName(game, player) {
  if (game.setup?.net && player.humanType && humanSide(game, player.faction)) return player.humanType;
  return player.ai ?? (humanSide(game, player.faction) ? 'Human' : db.faction(player.faction)?.str('Basic_AI') || 'Human');
}

export function galacticTargetMatches(game, player, planet, bits) {
  if (planet.background || planet.destroyed || planet.restricted || (game.galaxy.autoReveal === false && !planet.revealed)) return false;
  if (key(planet.owner) === key(player.faction)) return !!(bits & 1);
  const faction = db.faction(planet.owner);
  if (faction?.bool('Is_Neutral')) return !!(bits & 4);
  if (
    db
      .faction(player.faction)
      ?.list('Allies')
      .some(n => key(n) === key(planet.owner))
  )
    return false;
  return !!(bits & 2);
}

class UnknownPerception {
  constructor(message) {
    this.message = message;
  }
}
export class GalacticMind extends Reason {
  constructor(ai, controller) {
    super(controller.brain);
    this.ai = ai;
    this.controller = controller;
    this.depth = 0;
    this.unsupported = new Set();
    this.invalid = new Map();
    this.perceptions = new WeakMap();
  }
  fn(name, target) {
    const type = target?.type || target?.planet?.type,
      expression = this.b.eq.get(name);
    let staticValues;
    if (type && expression && typeOnly(this.b, name)) {
      staticValues = this.ai.typeValues.get(expression);
      if (!staticValues) {
        staticValues = new WeakMap();
        this.ai.typeValues.set(expression, staticValues);
      }
      if (staticValues.has(type)) return staticValues.get(type);
    }
    if (target && !targetDependent(this.b, name)) target = null;
    const outer = this.depth++ === 0;
    const id = name + '|' + (target ? target.key : '');
    try {
      if (this.invalid.has(id)) throw new UnknownPerception(this.invalid.get(id));
      const value = super.fn(name, target);
      if (staticValues) staticValues.set(type, value);
      return value;
    } catch (error) {
      if (!(error instanceof UnknownPerception)) throw error;
      this.invalid.set(id, error.message);
      if (!outer) throw error;
      this.unsupported.add(error.message);
      return 0;
    } finally {
      this.depth--;
    }
  }
  see(variable, params, target) {
    return this.perceive(this.descriptor(variable, params), params, target);
  }
  descriptor(variable, params) {
    let queries = this.ai.parameterKeys.get(params);
    if (!queries) {
      queries = new Map();
      this.ai.parameterKeys.set(params, queries);
    }
    let descriptor = queries.get(variable);
    if (!descriptor) {
      const name = key(variable),
        signature = name + '|' + params.map(([n, v]) => key(n) + '=' + key(v)).join(',');
      descriptor = this.ai.descriptors.get(signature);
      if (!descriptor) {
        descriptor = {
          name,
          global: !!nameMatch(NAME_RE[0], name),
          types:
            name === 'VARIABLE_TARGET.TYPE.ISTYPE'
              ? new Set(
                  named(params, 'Parameter_Type')
                    .map(n => db.type(n))
                    .filter(Boolean)
                )
              : null
        };
        this.ai.descriptors.set(signature, descriptor);
      }
      queries.set(variable, descriptor);
    }
    return descriptor;
  }
  perceive(descriptor, params, target) {
    if (descriptor.types) return +descriptor.types.has(target?.type || target?.planet?.type);
    let cache = this.perceptions.get(descriptor);
    if (!cache) {
      cache = new Map();
      this.perceptions.set(descriptor, cache);
    }
    const id = descriptor.global ? -1 : (target?.key ?? target?.planet?.index ?? -1);
    if (cache.has(id)) return cache.get(id);
    const value = this.read(descriptor.name, params, target);
    cache.set(id, value);
    return value;
  }
  run(expression, target) {
    let compiled = this.ai.compiled.get(expression);
    if (!compiled) {
      const queries = [],
        temps = [],
        temp = () => {
          const name = 'v' + temps.length;
          temps.push(name);
          return name;
        };
      const source = e => {
        const op = e[0];
        if (op === 'num') return String(e[1]);
        if (op === 'see') {
          const ref = /^Function_(.+)\.Evaluate$/i.exec(e[1]);
          if (ref) return 'm.fn(' + JSON.stringify(key(ref[1])) + ',t)';
          const n = queries.length;
          queries.push([this.descriptor(e[1], e[2]), e[2]]);
          return 'm.perceive(q[' + n + '][0],q[' + n + '][1],t)';
        }
        if (op === '*' || op === '/') {
          const v = temp(),
            first = source(e[op === '/' ? 2 : 1]),
            second = source(e[op === '/' ? 1 : 2]);
          return '(' + v + '=' + first + ',' + v + '===0?0:' + (op === '/' ? second + '/' + v : v + '*' + second) + ')';
        }
        if (op === '#') {
          const a = temp(),
            b = temp();
          return '(' + a + '=' + source(e[1]) + ',' + b + '=' + source(e[2]) + ',' + a + '+r()*(' + b + '-' + a + '))';
        }
        if (['+', '-', '>', '>=', '<', '<=', '==', '!='].includes(op)) {
          const value = '(' + source(e[1]) + ' ' + op + ' ' + source(e[2]) + ')';
          return ['+', '-'].includes(op) ? value : '+' + value;
        }
        if (op === 'call') {
          const args = e[2].map(source);
          if (e[1] === 'max' || e[1] === 'min') return 'Math.' + e[1] + '(' + args.join(',') + ')';
          if (e[1] === 'clamp') {
            const v = args.map(() => temp());
            return '(' + args.map((s, i) => v[i] + '=' + s).join(',') + ',Math.min(' + v[2] + ',Math.max(' + v[1] + ',' + v[0] + ')))';
          }
        }
        return '0';
      };
      const body = source(expression),
        fn = new Function('m', 't', 'q', 'r', (temps.length ? 'let ' + temps.join(',') + ';' : '') + 'return ' + body + ';');
      compiled = { fn, queries };
      this.ai.compiled.set(expression, compiled);
    }
    return compiled.fn(this, target, compiled.queries, simRandom);
  }
  read(variable, params, target) {
    const name = key(variable),
      g = this.ai.game.galaxy,
      c = this.controller,
      p = target?.planet,
      host = this.ai.game.story;
    let binding = this.ai.parameters.get(params);
    if (!binding) {
      binding = {
        factions: named(params, 'Parameter_Faction'),
        types: named(params, 'Parameter_Type'),
        categories: catParam(params),
        count: params.find(([n]) => key(n) === 'PARAMETER_COUNT')?.[1] ?? 1,
        complete: +named(params, 'Parameter_Only_Consider_Complete')[0] || 0,
        difficulty: named(params, 'Parameter_Difficulty_Level_Type'),
        attenuator: +named(params, 'Parameter_Attenuator')[0] || 0
      };
      this.ai.parameters.set(params, binding);
    }
    const { factions, types, categories, attenuator } = binding;
    const typeSet = (binding.typeSet ||= new Set(types));
    if (name === 'GAME.AGE') return g.time;
    if (name === 'GAME.ISSTORYCAMPAIGN') return +g.campaign.bool('Is_Story_Campaign');
    if (name === 'VARIABLE_TARGET.MARKUP') return this.ai.plans.markups.get(c.player.faction)?.get(p) || 0;
    if (name === 'VARIABLE_SELF.MARKUP') return this.ai.plans.markups.get(c.player.faction)?.get(c.player.faction) || 0;
    const script = nameMatch(NAME_RE[1], name);
    if (script) return this.ai.scriptPerception(script[1], params, target, c);
    const force = this.ai.forcePerception(name, binding, target, c);
    if (force !== undefined) return force;
    if (name === 'VARIABLE_TARGET.TARGETPOLITICALCONTROL') {
      if (!p) return 0;
      const sign = key(p.owner) === key(c.player.faction) ? 1 : -1;
      return (sign * Math.trunc(Math.abs(p.politicalTarget ?? 0))) / (db.constants.num('MaximumPoliticalControl', 5) || 5);
    }
    if (name === 'VARIABLE_TARGET.ISFACTION') return +(!!p && factions.includes(key(p.owner)));
    if (name === 'VARIABLE_TARGET.ISHUMANCONTROLLED') return +(!!p && humanSide(this.ai.game, p.owner));
    if (name === 'VARIABLE_SELF.ISFACTION') return +factions.includes(key(c.player.faction));
    if (name === 'VARIABLE_HUMAN.ISFACTION' || name === 'VARIABLE_ENEMY.ISFACTION') {
      const owner = name === 'VARIABLE_HUMAN.ISFACTION' ? this.ai.humanOf(c) : this.ai.primaryEnemy(c);
      if (!owner) throw new UnknownPerception('Variable_Enemy is unbound');
      return +factions.includes(key(owner));
    }
    if (name === 'VARIABLE_SELF.ISDIFFICULTY') return +binding.difficulty.some(v => level(v) === c.difficulty);
    if (name === 'VARIABLE_SELF.TECHLEVEL') return c.player.tech;
    if (name === 'VARIABLE_HUMAN.TECHLEVEL' || name === 'VARIABLE_ENEMY.TECHLEVEL') {
      const owner = name === 'VARIABLE_HUMAN.TECHLEVEL' ? this.ai.humanOf(c) : this.ai.primaryEnemy(c);
      if (!owner) throw new UnknownPerception('Variable_Enemy is unbound');
      return g.players.find(pl => key(pl.faction) === key(owner))?.tech || 0;
    }
    if (name === 'VARIABLE_SELF.CREDITSUNNORMALIZED') return c.player.credits;
    if (name === 'VARIABLE_SELF.TIMESINCESPACEDEFENDER')
      return c.player.lastSpaceDefense === undefined ? 9.999999843067494e17 : g.time - c.player.lastSpaceDefense;
    if (name === 'VARIABLE_SELF.TIMESINCEGROUNDDEFENDER')
      return c.player.lastGroundDefense === undefined ? 9.999999843067494e17 : g.time - c.player.lastGroundDefense;
    if (name === 'VARIABLE_TARGET.TIMESINCESPACECONFLICT')
      return p?.lastSpaceConflict === undefined ? 9.999999843067494e17 : g.time - p.lastSpaceConflict;
    if (name === 'VARIABLE_TARGET.TIMESINCEGROUNDCONFLICT')
      return p?.lastGroundConflict === undefined ? 9.999999843067494e17 : g.time - p.lastGroundConflict;
    const controlled = nameMatch(NAME_RE[2], name);
    if (controlled) {
      const owner = controlled[1] === 'HUMAN' ? this.ai.humanOf(c) : controlled[1] === 'ENEMY' ? this.ai.primaryEnemy(c) : c.player.faction;
      if (!owner) throw new UnknownPerception('Variable_Enemy is unbound');
      const planets = g.planets.filter(p => !p.background),
        count = planets.filter(p => key(p.owner) === key(owner)).length;
      return controlled[2] ? count : planets.length ? count / planets.length : 0;
    }
    if (name === 'VARIABLE_SELF.ACTIVEGOALS')
      return this.ai.plans.live.filter(
        plan => plan.ai === c && plan.state !== 'over' && (!categories?.length || categories.includes(plan.gdef?.category))
      ).length;
    if (name === 'VARIABLE_SELF.GROSSINCOMEUNNORMALIZED') return playerIncome(g, c.player.faction);
    if (name === 'VARIABLE_HUMAN.GROSSINCOMEUNNORMALIZED' || name === 'VARIABLE_ENEMY.GROSSINCOMEUNNORMALIZED') {
      const owner = name === 'VARIABLE_HUMAN.GROSSINCOMEUNNORMALIZED' ? this.ai.humanOf(c) : this.ai.primaryEnemy(c);
      if (!owner) throw new UnknownPerception('Variable_Enemy is unbound');
      return playerIncome(g, owner);
    }
    if (name === 'VARIABLE_SELF.ANYCURRENTTHREATS') {
      if (humanSide(this.ai.game, c.player.faction)) return 0;
      const human = owner => humanSide(this.ai.game, owner) || key(g.players.find(p => key(p.faction) === key(owner))?.ai) === 'HUMAN';
      return +g.planets.some(
        p =>
          human(p.owner) &&
          g.fleets.some(f => f.planet === p.index && !f.leg && f.units.length && human(f.owner)) &&
          this.ai.neighbours[p.index].some(({ planet }) => key(planet.owner) === key(c.player.faction))
      );
    }
    if (name === 'VARIABLE_SELF.WORSTISLANDFRACTIONOFLARGEST') {
      this.ai.islandConnectors(c);
      const counts = c.islands.counts;
      return counts.length > 1 && counts[0] > 0 ? counts[1] / counts[0] : 0;
    }
    if (
      name === 'VARIABLE_SELF.MAINTENANCE' ||
      name === 'VARIABLE_SELF.MAINTENANCEUNNORMALIZED' ||
      name === 'VARIABLE_SELF.NETINCOMEUNNORMALIZED'
    ) {
      const raw = this.ai.forces().maintenance(c.player.faction),
        gross = playerIncome(g, c.player.faction);
      return name === 'VARIABLE_SELF.MAINTENANCE'
        ? gross
          ? raw / gross
          : 0
        : name === 'VARIABLE_SELF.NETINCOMEUNNORMALIZED'
          ? gross - raw
          : raw;
    }
    if (name === 'VARIABLE_SELF.BUDGETFRACTIONTOBUILD') {
      const type = db.type(types[0] || '');
      if (!type) throw new UnknownPerception(variable + ' requires Parameter_Type');
      let need = type.num('Build_Cost_Credits', 0),
        time = type.num('Build_Time_Seconds', 0) * db.constants.num('Production_Speed_Factor', 1),
        building = false;
      for (const world of g.planets) {
        if (key(world.owner) !== key(c.player.faction)) continue;
        for (const q of Object.values(world.production || {})) {
          const head = q[0];
          if (!head || head.type !== type || key(head.owner) !== key(c.player.faction)) continue;
          need = Math.min(need, head.total > 0 ? (head.left / head.total) * head.cost : 0);
          time = Math.min(time, head.left);
          building = true;
        }
      }
      if (need < 0.0001) return 0;
      const category = categories?.length ? c.budget.category(categories[0]) : null;
      const rate = categories?.length ? category?.totalIncome || 0 : playerIncome(g, c.player.faction) / fiscalCycleSeconds();
      const funds = categories?.length ? category?.total || 0 : c.player.credits;
      const den = time * rate + (building ? 0 : funds);
      return den > 0 ? need / den : 9.999999843067494e17;
    }
    if (name === 'VARIABLE_SELF.BUDGETALLOCATION') return categories?.length ? c.budget.category(categories[0])?.weight || 0 : 0;
    if (name === 'VARIABLE_SELF.CANADVANCETECH') {
      const pl = c.player;
      return +(
        pl.tech < pl.maxTech &&
        [...db.types.values()].some(
          t =>
            t.num('Build_Advances_Tech_Level', 0) > pl.tech &&
            t.num('Tech_Level', 0) <= pl.tech &&
            t.list('Affiliation').some(a => key(a) === key(pl.faction))
        )
      );
    }
    if (name === 'VARIABLE_SELF.HASTECHTOPRODUCE') {
      if (!types.length) throw new UnknownPerception(variable + ' requires Parameter_Type');
      return +types.some(n => {
        const t = db.type(n);
        return (
          t &&
          t.list('Affiliation').some(n => key(n) === key(c.player.faction)) &&
          (t.bool('Build_Initially_Locked')
            ? c.player.unlockedTypes?.some(n => key(n) === key(t.name))
            : t.num('Tech_Level', 0) <= c.player.tech)
        );
      });
    }
    if (!!nameMatch(NAME_RE[3], name)) {
      const level = Math.floor(+(params.find(([n]) => key(n) === 'PARAMETER_LEVEL')?.[1] ?? 1) + 0.5);
      if (level <= 0) throw new UnknownPerception(variable + ' requires a positive Parameter_Level');
      const count = g.planets.filter(
          p => key(p.owner) === key(c.player.faction) && (name.includes('GROUND') ? groundLevel(p, p.owner) : p.spaceLevel) >= level
        ).length,
        value = Math.max(0, count - Math.floor(+binding.count + 0.5) + 1);
      return name.includes('NUM') ? value : Math.min(1, value);
    }
    if (name === 'VARIABLE_TARGET.ISCORRUPTED') return +(!!p && (p.currentCorruption ?? -1) !== -1);
    if (name === 'VARIABLE_TARGET.ISCONNECTEDTOCORRUPTION')
      return +(!!p && this.ai.neighbours[p.index].some(({ planet }) => (planet.currentCorruption ?? -1) !== -1));
    if (name === 'VARIABLE_TARGET.ISCORRUPTIONTRANSITIONACTIVE') return +!!p?.corruptionKind;
    if (name === 'VARIABLE_TARGET.TIMESINCECORRUPTIONCHANGE') return p ? (g.time || 0) - (p.corruptionLast || 0) : 0;
    if (name === 'VARIABLE_TARGET.TIMESINCECONVERSION')
      return p?.conversionTime === undefined ? 9.999999843067494e17 : (g.time || 0) - p.conversionTime;
    const defended = nameMatch(NAME_RE[4], name);
    if (defended) {
      const owner = defended[1] === 'HUMAN' ? this.ai.humanOf(c) : defended[1] === 'ENEMY' ? this.ai.primaryEnemy(c) : c.player.faction;
      if (!owner) throw new UnknownPerception('Variable_Enemy is unbound');
      const own = g.planets.filter(world => !world.background && key(world.owner) === key(owner));
      if (!own.length) return 0;
      if (!host) throw new UnknownPerception(variable + ' requires the story host');
      const asking = key(owner) === key(c.player.faction),
        has =
          'Variable_Target.' +
          (asking ? 'FriendlyForce' : 'EnemyForce') +
          '.Has' +
          (defended[2] === 'SPACE' ? 'Space' : 'Ground') +
          'Force',
        me = host.player(c.player.faction);
      return (
        own.reduce((n, world) => n + (+host.perception(has, [], me, { planet: world, key: world.index, type: world.type }) || 0), 0) /
        own.length
      );
    }
    if (name === 'GAME.TIMELINE') return Math.max(0, ...g.players.map(pl => pl.tech || 0));
    if (name === 'VARIABLE_TARGET.HASCREDITSIPHON') return +(p?.creditSiphonOwner != null && p.creditSiphonOwner !== -1);
    if (name === 'GAME.PLANETSCORRUPTED' || name === 'GAME.PLANETSCORRUPTEDUNNORMALIZED') {
      const targets = g.planets.filter(p => !p.background),
        count = targets.filter(p => (p.currentCorruption ?? -1) !== -1).length;
      return name.endsWith('UNNORMALIZED') ? count : targets.length ? count / targets.length : 0;
    }
    if (name === 'VARIABLE_TARGET.RETAINSRESIDUALINFLUENCE') return +!!p?.type.bool('Planet_Retains_Residual_Influence');
    if (name.startsWith('VARIABLE_TARGET.HINTS.')) {
      const value = this.ai.hint(c, p, name.slice(22));
      if (value !== undefined) return value;
    }
    if (name === 'VARIABLE_TARGET.CONNECTSLARGESTISLANDS') return +this.ai.islandConnectors(c).has(p);
    if (name === 'VARIABLE_TARGET.CONNECTSISOLATEDPLANETSBYFORCE') return +this.ai.isolatedConnectors(c).has(p);
    if (
      name === 'VARIABLE_TARGET.TIMELASTSEEN' ||
      name === 'VARIABLE_TARGET.TIMELASTSEENUNNORMALIZED' ||
      !!nameMatch(NAME_RE[5], name) ||
      !!nameMatch(NAME_RE[6], name)
    ) {
      if (!db.constants.bool('AIUsesFogOfWarGalactic', false)) return 0;
      throw new UnknownPerception(variable + ' requires per-player AI visibility history');
    }
    const bitfield = nameMatch(NAME_RE[7], name);
    if (bitfield) {
      if (!p || (!types.length && !params.some(([n]) => key(n) === 'PARAMETER_CATEGORY')))
        throw new UnknownPerception(variable + ' has no planet or parameters');
      const friendly = bitfield[1] === 'FRIENDLYFORCE',
        view = this.ai.forces(),
        me = c.player.faction,
        counts = owner => view.related(me, owner, friendly);
      const entries = params
        .filter(([n]) => key(n) === 'PARAMETER_CATEGORY')
        .map(([, v]) =>
          (String(v).match(/\[([^\]]*)\]/) || ['', v])[1]
            .split('|')
            .map(x => x.trim().toUpperCase())
            .filter(Boolean)
        );
      const members = t => {
        const list = [...t.list('Company_Units'), ...t.list('Squadron_Units')].map(n => db.type(n)).filter(Boolean);
        return list.length ? list : null;
      };
      const units = [];
      if (bitfield[2] === 'GROUND') {
        for (const r of p.garrison)
          if (!r.dead && counts(r.owner)) {
            const m = members(r.type);
            if (m) units.push(...m);
          }
      } else
        for (const f of g.fleets)
          if (f.planet === p.index && !f.leg && counts(f.owner))
            for (const u of f.units) {
              if (u.dead) continue;
              const m = members(u.type);
              if (m) units.push(...m);
              else units.push(u.type);
              if (u.carries) {
                const cm = members(u.carries);
                units.push(...(cm || [u.carries]));
              }
            }
      let mask = 0;
      for (const t of units) {
        const i = types.indexOf(key(t.name));
        if (i >= 0) mask |= 1 << i;
        const cats = t.categories();
        entries.forEach((e, j) => {
          if (!e.length || e.some(x => cats.has(x))) mask |= 1 << ((types.length + j) & 31);
        });
      }
      return mask;
    }
    const nearby = nameMatch(NAME_RE[8], name);
    if (nearby) {
      const view = this.ai.forces(),
        space = nearby[2] === 'SPACE',
        owner = c.player.faction,
        den = view.aggregate(owner, true, space) + view.aggregate(owner, false, space),
        radius = db.constants.num('MaximumFleetMovementDistance', 100),
        a = +(params.find(([n]) => key(n) === 'PARAMETER_ATTENUATOR')?.[1] ?? 1);
      let sum = 0;
      for (const { planet: other } of this.ai.neighbours[p?.index] || [])
        sum +=
          (1 - (Math.hypot(...p.pos.map((x, i) => x - other.pos[i])) / radius) * (1 - a)) *
          view.total(owner, nearby[1] === 'FRIENDLYFORCE', space, categories, other);
      if (!den && sum) throw new UnknownPerception(variable + ' has zero normalization denominator');
      return den ? sum / den : 0;
    }
    const structure = nameMatch(NAME_RE[9], name);
    if (structure) {
      if (!types.length) throw new UnknownPerception(variable + ' requires Parameter_Type');
      const worlds = structure[1] === 'TARGET' ? (p ? [p] : []) : g.planets.filter(p => key(p.owner) === key(c.player.faction));
      const matches = t => typeSet.has(key(t.name));
      let count = 0;
      for (const world of worlds) {
        for (const u of world.groundStructures) if (!u.dead && matches(u.type)) count++;
        for (const u of world.orbitalStructures) if (!u.dead && matches(u.type)) count++;
        if (binding.complete !== 1)
          for (const q of Object.values(world.production || {})) for (const item of q) if (matches(item.type)) count++;
      }
      if (structure[2] === 'STRUCTURECOUNT') return count;
      if (structure[1] === 'TARGET') return +(count >= 1);
      const worldCount = worlds.filter(
        world =>
          [...world.groundStructures, ...world.orbitalStructures].some(u => !u.dead && matches(u.type)) ||
          (binding.complete !== 1 &&
            Object.values(world.production || {})
              .flat()
              .some(q => matches(q.type)))
      ).length;
      return +(worldCount >= Math.floor(+binding.count + 0.5));
    }
    if (name === 'VARIABLE_SELF.HASUNIT') {
      if (!types.length) throw new UnknownPerception(variable + ' requires Parameter_Type');
      const objects = this.ai.forces().objects.filter(u => key(u.owner) === key(c.player.faction) && typeSet.has(key(u.type.name))).length;
      const queued =
        binding.complete > 0
          ? 0
          : g.planets.reduce(
              (n, p) =>
                n +
                Object.values(p.production || {})
                  .flat()
                  .filter(q => key(q.owner) === key(c.player.faction) && types.includes(key(q.type.name))).length,
              0
            );
      return +(objects + queued >= +binding.count);
    }
    if (name === 'VARIABLE_SELF.MAXEDSTARBASES' || name === 'VARIABLE_SELF.MAXEDGROUNDBASES') {
      const own = g.planets.filter(p => !p.background && key(p.owner) === key(c.player.faction));
      return own.length
        ? own.filter(p =>
            name.endsWith('STARBASES')
              ? (p.spaceLevel || 0) === p.type.num('Max_Space_Base', 5)
              : groundLevel(p, p.owner) === Math.min(5, p.type.num('Special_Structures_Land', 3))
          ).length / own.length
        : 0;
    }
    if (p?.type && !!nameMatch(NAME_RE[10], name)) {
      if (name === 'VARIABLE_TARGET.TYPE.ISTYPE') return +typeSet.has(key(p.type.name));
      if (name === 'VARIABLE_TARGET.ISSURFACEACCESSIBLE') return +p.type.bool('Planet_Surface_Accessible', true);
      const structureSlots = p.structureSlots ?? p.type.num('Special_Structures_Land', 3),
        ground = groundLevel(p, p.owner),
        space = p.spaceLevel || 0;
      const scalar = {
        GROUNDBASELEVELUNNORMALIZED: ground,
        GROUNDBASELEVEL: ground / db.constants.num('MaximumGroundbaseLevel', 5),
        STARBASELEVELUNNORMALIZED: space,
        STARBASELEVEL: space / db.constants.num('MaximumStarbaseLevel', 5),
        MAXGROUNDBASELEVELUNNORMALIZED: Math.min(5, structureSlots),
        MAXGROUNDBASELEVEL: Math.min(5, structureSlots) / db.constants.num('MaximumGroundbaseLevel', 5),
        MAXSTARBASELEVELUNNORMALIZED: p.type.num('Max_Space_Base', 5),
        MAXSTARBASELEVEL: p.type.num('Max_Space_Base', 5) / db.constants.num('MaximumStarbaseLevel', 5),
        OPENSTRUCTURESLOTSUNNORMALIZED: ground > 0 ? structureSlots - p.groundStructures.filter(u => !u.dead).length : 0,
        MAXSTRUCTURESLOTSUNNORMALIZED: structureSlots,
        MAXSTRUCTURESLOTS: structureSlots / db.constants.num('MaximumSpecialStructures', 5),
        OPENGROUNDCOMPANYSLOTS: db.constants.num('Max_Ground_Forces_On_Planet', 10) - p.garrison.length
      };
      const field = name.replace(/^VARIABLE_TARGET\./, '');
      if (Object.hasOwn(scalar, field)) return scalar[field];
      if (field === 'OPENSTRUCTURESLOTS') {
        const capacity = structureSlots + p.type.num('Special_Structures_Space', 5);
        return capacity ? 1 - (p.groundStructures.length + p.orbitalStructures.length) / capacity : 0;
      }
      if (field === 'BASEINCOME' || field === 'BASEINCOMENBTP') {
        const maximum = Math.max(
          0,
          ...g.planets
            .filter(world => !world.background && (field !== 'BASEINCOMENBTP' || world.owner === p.owner))
            .map(p => p.type.num('Planet_Credit_Value', 0))
        );
        return maximum ? Math.min(1, Math.max(0, p.type.num('Planet_Credit_Value', 0) / maximum)) : 0;
      }
      if (field === 'INCOMEUNNORMALIZED') return planetIncome(g, p);
      if (field === 'INCOME') {
        const orbit = orbitFleets(g),
          maximum = Math.max(0, ...g.planets.filter(p => !p.background).map(p => planetIncome(g, p, p.owner, orbit)));
        return maximum ? planetIncome(g, p, p.owner, orbit) / maximum : 0;
      }
    }
    if (name === 'VARIABLE_TARGET.ISOWNEDBYSELF') return +(!!p && key(p.owner) === key(c.player.faction));
    const flag = nameMatch(NAME_RE[11], name);
    if (flag) return +host?.flags.get(flag[1]) || 0;
    if (name === 'VARIABLE_TARGET.ISCONNECTEDTO') {
      if (!p) return 0;
      const radius = db.constants.num('MaximumFleetMovementDistance', 100);
      let best = 0;
      for (const { planet: other, route, distance } of this.ai.neighbours[p.index]) {
        if (!types.includes(key(other.name)) && !factions.includes(key(other.owner))) continue;
        if (attenuator <= 0) return 1;
        best = Math.max(best, route ? 1 : radius > 0 ? 1 - (distance / radius) * attenuator : 0);
      }
      return best;
    }

    const connected = /^VARIABLE_TARGET.(FRIENDLY|ENEMY)(INTERNAL|EXTERNAL)CONNECTIVITY$/.exec(name);
    if (connected) {
      if (!p) return 0;
      const internal = connected[2] === 'INTERNAL';
      if (connected[1] === 'FRIENDLY') return this.ai.connectivity(c.player.faction, internal)[p.index] || 0;
      let best = 0;
      for (const pl of g.players)
        if (relation(c.player.faction, pl.faction) !== 0) best = Math.max(best, this.ai.connectivity(pl.faction, internal)[p.index] || 0);
      return best;
    }
    if (name === 'VARIABLE_SELF.AVERAGEGROUNDBASE' || name === 'VARIABLE_SELF.AVERAGESTARBASE') {
      const ground = name.endsWith('GROUNDBASE'),
        own = g.planets.filter(world => !world.background && key(world.owner) === key(c.player.faction)),
        max = db.constants.num(ground ? 'MaximumGroundbaseLevel' : 'MaximumStarbaseLevel', 5);
      const sum = own.reduce((n, world) => n + (ground ? groundLevel(world, world.owner) : world.spaceLevel || 0) / max, 0);
      return sum ? sum / own.length : 0;
    }
    if (name === 'VARIABLE_TARGET.TYPE.TOKEN' || name === 'VARIABLE_SELF.HOMEPLANET.TYPE.TOKEN') {
      const type = name.startsWith('VARIABLE_SELF') ? g.planets[c.player.home]?.type : p?.type || target?.type;
      if (!type) return -1;
      if (!this.ai.typeTokens) {
        this.ai.typeTokens = new Map();
        let i = 0;
        for (const t of db.types.values()) this.ai.typeTokens.set(t, ++i);
      }
      return this.ai.typeTokens.get(type) ?? -1;
    }
    if (name === 'VARIABLE_TARGET.BLACKMARKETABILITIESAVAILABLE') {
      const buyer = factions.length ? g.players.find(pl => key(pl.faction) === factions[0]) : null;
      if (!buyer) throw new UnknownPerception(variable + ' requires a Parameter_Faction in the game');
      if (!p || (p.currentCorruption ?? -1) !== 6) return 0;
      return +blackMarketItems().some(
        item => key(item.faction) === key(p.owner) && !(buyer.blackMarket || []).some(n => key(n) === key(item.name))
      );
    }
    if (name === 'GAME.ACTIVESTORYGOALCOUNT') return this.ai.game.story?.storyGoals?.length || 0;
    if (name === 'GAME.TIMESINCESTORYPOPUP') {
      const story = this.ai.game.story;
      return story ? Math.max(0, (story.time || 0) - (story.storyGoalAt || 0)) : 0;
    }
    if (name === 'GAME.INTERVENTIONSENABLED') return 1;
    if (host && nameMatch(KNOWN_HOST_RE, name)) return host.perception(variable, params, host.player(c.player.faction), target || {});
    this.ai.missing.set(variable, (this.ai.missing.get(variable) || 0) + 1);
    throw new UnknownPerception(variable);
  }
}

class GalacticGoals extends GoalSystem {
  constructor(ai) {
    super();
    this.ai = ai;
    this.mode = 'GALACTIC';
  }
  env(side) {
    const c = this.ai.controllers.get(side);
    return c ? { w: this.ai.game.galaxy, brain: c.brain, cmdr: c, P: this.ai.plans, ais: this.ai.controllers.size } : null;
  }
  newMind(side) {
    return new GalacticMind(this.ai, this.ai.controllers.get(side));
  }
  switches(side, state, mind) {
    for (const id of this.ai.plans.pending.keys()) if (id.startsWith(side + '|')) this.ai.plans.pending.delete(id);
    super.switches(side, state, mind);
    const c = this.ai.controllers.get(side);
    this.ai.plans.switches(c, mind);
    const weights = [...state.on.budget].map(([cat, eq]) => [cat, mind.fn(eq, null), eq]);
    c.budget.weights(weights, c.player.credits, !weights.some(([, v, eq]) => mind.invalid.has(eq + '|')));
  }
  targets(side, bits) {
    if (bits === 16) return [null];
    const c = this.ai.controllers.get(side);
    return this.ai.game.galaxy.planets
      .filter(p => galacticTargetMatches(this.ai.game, c.player, p, bits))
      .map(planet => ({ key: planet.index, planet, type: planet.type }));
  }
  thingOf(target) {
    return target?.planet || null;
  }
  rest(controller) {
    return Math.max(0, Math.trunc(30 * (controller.adjustment?.galacticSleep ?? 1))) / 30;
  }
}

export class GalacticAI {
  static async create(game) {
    const ai = new GalacticAI(game);
    game.ai = ai;
    await ai.initialize();
    return ai;
  }
  constructor(game) {
    this.game = game;
    this.controllers = new Map();
    this.budgets = new Map();
    this.controls = new Map();
    this.errors = new Map();
    this.missing = new Map();
    this.profiles = new Map();
    this.parameters = new WeakMap();
    this.parameterKeys = new WeakMap();
    this.descriptors = new Map();
    this.compiled = new WeakMap();
    this.typeValues = new WeakMap();
    this.goals = new GalacticGoals(this);
    this.plans = new GalacticPlanning(this);
    this.productionHooks = this.plans.productionHooks;
    this.syncing = null;
    this.disposed = false;
    this.lastTime = game.galaxy.time || 0;
    this.forceView = null;
    this.forceAt = -Infinity;
    this.forceCache = new Map();
    this.evaluators = new Map();
    this.bonuses = [];
    this.freeStores = new Map();
  }
  async initialize() {
    this.shared = await readBrain(['BasicGalacticEquations'], []);
    this.neighbours = galacticNeighbours(this.game.galaxy);
    const types = await aiPlayerTypes();
    await Promise.all(types.map(type => this.profile(type.name)));
    await Promise.all([this.plans.load(), this.loadHints(), this.reconcile()]);
    const host = this.game.story,
      player = this.game.galaxy.players[0];
    for (const name of new Set(types.map(t => t.galactic).filter(Boolean))) {
      if (!host || !player) break;
      const fs = new GalacticFreeStore(this, { player, budget: new GalacticBudget(), type: {} }, name);
      for (let tries = 0; tries < 8 && fs.state === 'new' && !fs.start(); tries++) {
        if (!host.pending?.size) break;
        while (host.pending.size) await Promise.all([...host.pending.values()]);
      }
      fs.dispose();
    }
    this.plans.restore(this.game.galaxy.aiSaved);
    this.game.galaxy.aiSnapshot = () => this.plans.snapshot();
    for (const [id, c] of this.controllers) {
      if (this.freeStores.has(id) || !c.type?.galactic) continue;
      const fs = new GalacticFreeStore(this, c, c.type.galactic);
      this.freeStores.set(id, fs);
      for (let tries = 0; tries < 8 && fs.state === 'new' && !fs.start(); tries++) {
        const host = this.game.story;
        if (!host?.pending?.size) break;
        while (host.pending.size) await Promise.all([...host.pending.values()]);
      }
      if (fs.state === 'run') {
        try {
          fs.scan();
        } catch (error) {
          this.errors.set('FreeStore ' + id, error.message);
        }
      }
    }
  }
  async profile(name) {
    const id = key(name);
    if (!this.profiles.has(id))
      this.profiles.set(
        id,
        (async () => {
          const type = await aiPlayerType(name);
          if (!type) return null;
          const brain = await readBrain([], type.sets || [], null, this.shared);
          brain.player = { galactic: type.templates.galactic, ext: type.ext, defaultFirst: true };
          return { type, brain };
        })()
      );
    return this.profiles.get(id);
  }
  reconcile() {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      for (const player of this.game.galaxy.players) {
        const id = key(player.faction),
          name = galacticControllerName(this.game, player),
          old = this.controllers.get(id);
        if (key(old?.name) === key(name)) continue;
        this.controls.set(id, key(name));
        if (old) this.plans.stopController(old);
        this.controllers.delete(id);
        this.goals.sides.delete(id);
        for (const pending of this.plans.pending.keys()) if (pending.startsWith(id + '|')) this.plans.pending.delete(pending);
        if (key(name) === 'HUMAN') {
          this.errors.delete(id);
          continue;
        }
        const profile = await this.profile(name);
        if (this.disposed) return;
        if (!profile) {
          this.errors.set(id, 'Unrecognized AI player type: ' + name);
          continue;
        }
        if (key(galacticControllerName(this.game, player)) !== key(name)) continue;
        this.errors.delete(id);
        const difficulty = level(this.game.setup?.difficulty),
          adjustment = await difficultyAdjustment(player.faction, difficulty, profile.type);
        if (this.disposed) return;
        if (key(galacticControllerName(this.game, player)) !== key(name)) continue;
        player.bribeMultiplier = adjustment?.bribe ?? 1;
        const budget = this.budgets.get(id) || new GalacticBudget();
        this.budgets.set(id, budget);
        this.controllers.set(id, { player, name, brain: profile.brain, type: profile.type, difficulty, adjustment, budget });
      }
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }
  update(dt) {
    if (
      this.disposed ||
      this.game.paused ||
      this.game.suspendAI ||
      this.game.battle ||
      !(dt > 0) ||
      this.game.galaxy.time === this.lastTime
    )
      return;
    for (const p of this.game.galaxy.planets) {
      if (p.ownerSeen === undefined) p.ownerSeen = p.owner;
      else if (p.ownerSeen !== p.owner) {
        p.ownerSeen = p.owner;
        p.conversionTime = this.game.galaxy.time || 0;
      }
    }
    let changed = false;
    for (const player of this.game.galaxy.players) {
      const id = key(player.faction),
        name = galacticControllerName(this.game, player);
      if (this.controls.get(id) !== key(name)) changed = true;
    }
    if (changed) this.reconcile().catch(error => this.errors.set('Initialization', error.message));
    const ids = [...this.controllers.keys()],
      first = ids.length ? (this.turn = ((this.turn || 0) + 1) % ids.length) : 0;
    const net = !!this.game.net;
    if (net) this.goals.budget = AI_STEP_WORK;
    else this.goals.deadline = performance.now() + AI_FRAME_MS;
    try {
      for (let i = 0; i < ids.length; i++) this.goals.tick(ids[(first + i) % ids.length], dt);
    } finally {
      this.goals.deadline = undefined;
      this.goals.budget = undefined;
    }
    this.plans.deadline = net ? undefined : performance.now() + AI_FRAME_MS;
    try {
      this.plans.update(dt);
    } finally {
      this.plans.deadline = undefined;
    }
    this.freeStoreDeadline = net ? undefined : performance.now() + AI_FRAME_MS;
    this.freeStoreCalled = false;
    const stores = [...this.controllers];
    for (let i = 0; i < stores.length; i++) {
      const [id, c] = stores[(first + i) % stores.length];
      let fs = this.freeStores.get(id);
      if (fs && fs.c !== c) {
        fs.dispose();
        fs = null;
        this.freeStores.delete(id);
      }
      if (!fs && c.type?.galactic) {
        fs = new GalacticFreeStore(this, c, c.type.galactic);
        this.freeStores.set(id, fs);
      }
      try {
        fs?.update();
      } catch (error) {
        this.errors.set('FreeStore ' + id, error.message);
      }
    }
    this.freeStoreDeadline = undefined;
    this.lastTime = this.game.galaxy.time;
  }
  freeStoreTurn() {
    if (this.freeStoreDeadline === undefined || !this.freeStoreCalled || performance.now() <= this.freeStoreDeadline) {
      this.freeStoreCalled = true;
      return true;
    }
    return false;
  }
  forces() {
    if (!this.forceView || this.game.galaxy.time - this.forceAt > 0.5) {
      this.forceView = new GalacticForces(this.game);
      this.forceAt = this.game.galaxy.time;
    }
    return this.forceView;
  }
  async loadHints() {
    this.hintSets = new Map();
    this.markups = new Map();
    const files = await findFiles('XML\\\\AI\\\\HINTSETS\\\\[^\\\\]*\\.XML$');
    for (const path of files) {
      const text = await fetchText(path);
      if (!text) continue;
      for (const root of parseXML(text).children)
        for (const set of root.children) this.hintSets.set(key(set.tag), new Map(set.children.map(n => [key(n.tag), +n.text])));
    }
    for (const row of this.game.galaxy.campaign.props.get('markup_filename') || []) {
      const [owner, file] = row.split(',').map(s => s.trim());
      if (!owner || !file) continue;
      const text = await fetchText('Data/XML/AI/GalacticMarkup/' + file.replace(/\.xml$/i, '') + '.xml');
      if (!text) continue;
      const node = parseXML(text).children[0]?.child('Planets');
      if (!node) continue;
      this.markups.set(key(owner), {
        defaults: this.hintSets.get(key(node.attrs.HintSet)),
        planets: new Map(node.children.map(p => [key(p.tag), new Map(p.children.map(n => [key(n.tag), +n.text]))]))
      });
    }
  }
  hint(controller, planet, name) {
    const m = this.markups.get(key(controller.player.faction));
    return m?.planets.get(key(planet?.name))?.get(name) ?? m?.defaults?.get(name) ?? this.hintSets.get('GALACTIC_HINTS')?.get(name);
  }
  graphSignature(controller) {
    const g = this.game.galaxy;
    if (!controller.graphSignature || g.time - controller.graphAt > 0.5) {
      controller.graphSignature = g.planets
        .map(p => p.owner + ':' + +p.restricted + ':' + +p.destroyed + ':' + +this.plans.blockaded(controller.player.faction, p))
        .join('|');
      controller.graphAt = g.time;
    }
    return controller.graphSignature;
  }
  components(controller) {
    const signature = this.graphSignature(controller);
    if (controller.components?.signature === signature) return controller.components;
    const g = this.game.galaxy,
      remaining = new Set(
        g.planets.filter(p => !p.background && !p.destroyed && !p.restricted && key(p.owner) === key(controller.player.faction))
      ),
      rows = [];
    for (const p of g.planets)
      if (remaining.has(p)) {
        const worlds = new Set([p, ...this.plans.reach(controller, p, 'FRIENDLY_ONLY')]);
        rows.push({ planet: p, worlds, count: 0 });
        for (const world of worlds) remaining.delete(world);
      }
    for (const row of rows) row.count = this.plans.reach(controller, row.planet, 'FRIENDLY_IGNORE_THREAT').length;
    return (controller.components = { signature, rows });
  }
  connectorPath(controller, start, targets, chosen, byForce) {
    const g = this.game.galaxy,
      owner = controller.player.faction,
      view = this.forces(),
      costs = new Float64Array(g.planets.length).fill(Infinity),
      prev = new Int32Array(g.planets.length).fill(-1),
      closed = new Set(),
      open = [start.index];
    costs[start.index] = 0;
    const destination = this.plans.pathDestination || start,
      maxSpeed = Math.max(1, ...g.routes.map(r => r.type.num('HS_Speed_Factor', 1))),
      h = p =>
        targets.has(p)
          ? 0
          : (Math.hypot(...p.pos.map((x, k) => x - destination.pos[k])) / maxSpeed) *
            (this.plans.friendly(owner, p.owner) || chosen.has(p) ? 0.5 : 1);
    while (open.length) {
      let which = 0;
      for (let k = 1; k < open.length; k++)
        if (costs[open[k]] + h(g.planets[open[k]]) < costs[open[which]] + h(g.planets[open[which]])) which = k;
      const at = open.splice(which, 1)[0],
        p = g.planets[at];
      if (targets.has(p)) {
        for (let n = at; n >= 0; n = prev[n]) if (!this.plans.friendly(owner, g.planets[n].owner)) chosen.add(g.planets[n]);
        return;
      }
      closed.add(at);
      for (const link of g.links[at]) {
        const next = g.planets[link.to];
        if (closed.has(next.index) || next.background || next.destroyed || next.restricted) continue;
        const cost =
          costs[at] +
          (this.plans.friendly(owner, next.owner) || chosen.has(next)
            ? 0
            : link.cost + (byForce ? view.total(owner, false, true, null, next) + view.total(owner, false, false, null, next) : 100));
        if (cost < costs[next.index]) {
          costs[next.index] = cost;
          prev[next.index] = at;
          if (!open.includes(next.index)) open.push(next.index);
        }
      }
    }
  }
  connectivity(me, friendly) {
    const g = this.game.galaxy,
      id = key(me) + (friendly ? '|F' : '|E');
    if (this.ownersAt?.time !== g.time || this.ownersAt.galaxy !== g)
      this.ownersAt = { time: g.time, galaxy: g, sig: g.planets.map(p => p.owner || '').join('|') + '#' + g.routes.length };
    const sig = this.ownersAt.sig;
    const cache = (this.connectivityCache ||= new Map()),
      old = cache.get(id);
    if (old && old.sig === sig) return old.value;
    const n = g.planets.length,
      reach = db.constants.num('MaximumFleetMovementDistance', 100),
      factor = db.constants.num('TradeRouteMovementFactor', 1) || 1;
    const own = g.planets.map(p => !p.background && !!p.owner && relation(me, p.owner) === 0),
      routes = new Set();
    for (const r of g.routes) {
      routes.add(r.a * n + r.b);
      routes.add(r.b * n + r.a);
    }
    const edges = [],
      at = new Int32Array(n).fill(-1),
      nodes = [];
    for (let s = 0; s < n; s++) {
      if (!own[s]) continue;
      const a = g.planets[s].pos;
      for (let t = 0; t < n; t++) {
        if (t === s || g.planets[t].background || (friendly && !own[t])) continue;
        const b = g.planets[t].pos,
          len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        const w = routes.has(s * n + t) ? len / factor : len <= reach ? len : -1;
        if (w <= 0) continue;
        for (const x of [s, t])
          if (at[x] < 0) {
            at[x] = nodes.length;
            nodes.push(x);
          }
        edges.push(at[s], at[t], w);
      }
    }
    const m = nodes.length,
      d = new Float64Array(m * m).fill(Infinity),
      prev = new Int32Array(m * m).fill(-1);
    for (let i = 0; i < m; i++) d[i * m + i] = 0;
    for (let e = 0; e < edges.length; e += 3) {
      const i = edges[e],
        j = edges[e + 1];
      d[i * m + j] = edges[e + 2];
      prev[i * m + j] = i;
    }
    for (let k = 0; k < m; k++)
      for (let i = 0; i < m; i++) {
        const dik = d[i * m + k];
        if (dik === Infinity) continue;
        for (let j = 0; j < m; j++) {
          const v = dik + d[k * m + j];
          if (v < d[i * m + j]) {
            d[i * m + j] = v;
            prev[i * m + j] = prev[k * m + j];
          }
        }
      }
    const count = new Uint32Array(m);
    for (let i = 0; i < m; i++)
      for (let j = friendly ? i + 1 : 0; j < m; j++) {
        if (j === i || prev[i * m + j] < 0) continue;
        for (let u = prev[i * m + j]; u !== i && u >= 0; u = prev[i * m + u]) count[u]++;
      }
    let top = 0;
    for (const v of count) if (v > top) top = v;
    const value = new Float64Array(n);
    for (let i = 0; i < m; i++) value[nodes[i]] = top ? count[i] / top : 0;
    cache.set(id, { sig, value });
    return value;
  }
  islandConnectors(controller) {
    const { signature, rows } = this.components(controller);
    if (controller.islands?.signature === signature) return controller.islands.result;
    const ranked = rows.slice().sort((a, b) => b.count - a.count),
      result = new Set();
    if (ranked.length > 1) this.connectorPath(controller, ranked[1].planet, ranked[0].worlds, result, false);
    controller.islands = { signature, result, counts: ranked.map(row => row.count) };
    return result;
  }
  isolatedConnectors(controller) {
    const { signature, rows } = this.components(controller);
    if (controller.connectors?.signature === signature) return controller.connectors.result;
    const result = new Set();
    for (let i = 0; i < rows.length; i++) {
      let nearest = null,
        best = Infinity;
      for (let j = 0; j < rows.length; j++)
        if (i !== j) {
          const d = rows[i].planet.pos.reduce((n, x, k) => n + (x - rows[j].planet.pos[k]) ** 2, 0);
          if (d < best) {
            nearest = rows[j].planet;
            best = d;
          }
        }
      if (nearest) this.connectorPath(controller, nearest, rows[i].worlds, result, true);
    }
    controller.connectors = { signature, result };
    return result;
  }
  humanOf(controller) {
    return this.game.humanFor ? this.game.humanFor(controller.player.faction) : this.game.me;
  }
  primaryEnemy(controller) {
    if (Object.hasOwn(controller, 'primaryEnemy')) return controller.primaryEnemy;
    let enemy = null;
    const host = this.game.story,
      g = this.game.galaxy;
    for (const faction of db.factions.values()) {
      const p = g.players.find(p => key(p.faction) === key(faction.name));
      if (
        !p ||
        faction.bool('Is_Neutral') ||
        !host.player(controller.player.faction).Is_Enemy(host.player(p.faction)) ||
        (!g.planets.some(world => world.owner === p.faction) && !g.fleets.some(f => f.owner === p.faction && f.units.length))
      )
        continue;
      if (humanSide(this.game, p.faction)) {
        enemy = p.faction;
        break;
      }
      if (faction.bool('Is_Playable')) enemy = p.faction;
    }
    controller.primaryEnemy = enemy;
    return enemy;
  }
  invalidate() {
    this.forceView = null;
    this.forceCache.clear();
    for (const c of this.controllers.values()) {
      c.graphSignature = null;
      delete c.primaryEnemy;
    }
    this.plans.poolCache.clear();
    this.plans.locationTime = -Infinity;
    this.game.story.objectCache = null;
    this.game.story.reasonCache.clear();
  }
  forcePerception(name, binding, target, controller) {
    const m = nameMatch(NAME_RE[12], name);
    if (!m) return undefined;
    const scope = m[1],
      friendly = m[2] !== 'ENEMYFORCE',
      space = m[3].includes('SPACE'),
      cats = binding.categories,
      owner =
        scope === 'VARIABLE_HUMAN'
          ? this.humanOf(controller)
          : scope === 'VARIABLE_ENEMY'
            ? this.primaryEnemy(controller)
            : controller.player.faction;
    if (!owner) throw new UnknownPerception('Variable_Enemy is unbound');
    if (['VARIABLE_SELF', 'VARIABLE_HUMAN', 'VARIABLE_ENEMY'].includes(scope) && !m[3].endsWith('UNNORMALIZED')) return undefined;
    const id = [name, owner, target?.planet?.index, cats?.join('|')].join(':'),
      duration = scope === 'GAME' ? 30 : scope === 'VARIABLE_TARGET' ? 15 : 10,
      now = this.game.galaxy.time,
      cached = this.forceCache.get(id);
    if (cached && now - cached.time <= duration) return cached.value;
    const view = this.forces(),
      p = target?.planet;
    let value;
    if (m[3] === 'STARBASETOTALUNNORMALIZED')
      value = p?.station && view.related(owner, p.stationOwner || p.owner, friendly) ? p.station.num('AI_Combat_Power', 0) : 0;
    else if (m[3] === 'GROUNDBASETOTALUNNORMALIZED')
      value =
        p && view.related(owner, p.owner, friendly)
          ? [...p.groundStructures, ...p.garrison].reduce((n, u) => (u.dead ? n : n + strategicPower(u.type)), 0)
          : 0;
    else if (['VARIABLE_SELF', 'VARIABLE_HUMAN', 'VARIABLE_ENEMY'].includes(scope)) value = view.selfTotal(owner, space, cats);
    else if (scope === 'GAME') value = view.aggregate(owner, friendly, space, null, m[3].startsWith('PERTARGETMAX'));
    else {
      const numerator = p ? view.total(owner, friendly, space, cats, p) : 0;
      if (m[3].endsWith('UNNORMALIZED')) value = numerator;
      else {
        const denominator = m[3].endsWith('NBTT')
          ? p
            ? view.total(owner, friendly, space, null, p)
            : 0
          : m[3].endsWith('NBPTM')
            ? view.aggregate(owner, friendly, space, null, true)
            : m[3].endsWith('NBTD')
              ? view.aggregate(owner, friendly, space, null)
              : view.aggregate(owner, true, space, null) + view.aggregate(owner, false, space, null);
        value = numerator === 0 ? 0 : numerator > denominator ? 1 : Math.max(0, Math.min(1, numerator / denominator));
      }
    }
    this.forceCache.set(id, { time: now, value });
    return value;
  }
  evaluate(name, owner, planet = null) {
    const mind = this.perceiver(owner);
    if (!mind) return 0;
    return mind.fn(key(name), planet ? { key: planet.index, planet, type: planet.type } : null);
  }
  perceiver(owner) {
    const id = key(owner);
    let c = this.controllers.get(id);
    if (c) return this.goals.mind(id, this.goals.state(id));
    if (!this.perceptionPlayers) this.perceptionPlayers = new Map();
    c = this.perceptionPlayers.get(id);
    if (!c) {
      const player = this.game.galaxy.players.find(p => key(p.faction) === id);
      if (!player) return null;
      c = { player, brain: this.shared, budget: new GalacticBudget(), difficulty: level(this.game.setup?.difficulty) };
      this.perceptionPlayers.set(id, c);
    }
    if (!c.mind || this.game.galaxy.time - c.mindAt > 0.5 || this.game.galaxy.time < c.mindAt) {
      c.mind = new GalacticMind(this, c);
      c.mindAt = this.game.galaxy.time;
    }
    return c.mind;
  }
  scriptPerception(name, params, target, c) {
    const id = c.player.faction + '|' + name;
    let evaluator = this.evaluators.get(id);
    if (!evaluator) {
      const source = this.game.story.source(name);
      if (typeof source !== 'string') throw new UnknownPerception('Script_' + name + '.Evaluate');
      const inst = this.plans.instance('Evaluator ' + name);
      inst.ai = c;
      inst.env = this.plans.environment(inst);
      evaluator = { inst };
      this.plans.withInstance(inst, () => {
        const error = this.game.story.vm.run(source, name, inst.env);
        if (error) throw new Error(error);
        const result = this.game.story.vm.call(inst.env, 'Base_Definitions');
        if (!result.ok && !result.missing) throw new Error(result.error);
      });
      this.evaluators.set(id, evaluator);
    }
    const { inst } = evaluator,
      vm = this.game.story.vm;
    vm.set(inst.env, 'PlayerObject', this.game.story.player(c.player.faction));
    vm.set(inst.env, 'Target', this.game.story.planet(target?.planet));
    const args = params
      .filter(([n]) => key(n) === 'PARAMETER_SCRIPT_STRING')
      .map(([, v]) => String(v).toUpperCase())
      .concat(params.filter(([n]) => key(n) === 'PARAMETER_SCRIPT_NUMBER').map(([, v]) => +v));
    return this.plans.withInstance(inst, () => {
      const result = vm.call(inst.env, 'Evaluate', ...args);
      vm.call(inst.env, 'Evaluator_Clean_Up');
      if (!result.ok) {
        this.missing.set('Script_' + name + '.Evaluate', result.error);
        throw new UnknownPerception('Script_' + name + '.Evaluate');
      }
      if (typeof result.value !== 'number') throw new UnknownPerception('Script_' + name + '.Evaluate did not return a number');
      return result.value;
    });
  }
  giveDesireBonus(owner, name, target, amount, timeout) {
    return this.plans.block({
      k: 'bonus',
      owner,
      name,
      p: target,
      amount,
      end: this.game.galaxy.time + Math.trunc(timeout * 30) / 30,
      applied: false
    });
  }
  findTarget(owner, equation, flags, probability = 1, origin = null, reach = 'ANY', range = 0) {
    const c = this.controllers.get(key(owner)) || (this.perceiver(owner) && this.perceptionPlayers?.get(key(owner)));
    if (!c || !(probability > 0 && probability <= 1)) return undefined;
    const mask = String(flags || '')
        .split('|')
        .reduce((n, s) => n | ({ FRIENDLY: 1, ENEMY: 2, NEUTRAL: 4, CONTESTED: 8, GLOBAL: 16 }[key(s.trim())] || 0), 0),
      mind = this.perceiver(owner),
      positive = [];
    for (const p of this.game.galaxy.planets) {
      if (
        !galacticTargetMatches(this.game, c.player, p, mask) ||
        (origin && range !== 0 && p.pos.reduce((n, x, i) => n + (x - origin.pos[i]) ** 2, 0) > range * range) ||
        (origin && !this.plans.reach(c, p, key(reach)).includes(origin))
      )
        continue;
      const value = mind.fn(key(equation), { key: p.index, planet: p, type: p.type });
      if (value > 0) positive.push({ planet: p, value });
    }
    if (!positive.length) return undefined;
    let best = positive[0];
    for (const item of positive) if (item.value > best.value) best = item;
    if (probability === 1 || positive.length === 1 || simRandom() < probability) return this.plans.target(best.planet);
    const other = positive.filter(item => item !== best);
    let choice = simRandom() * other.reduce((n, item) => n + item.value, 0);
    for (const item of other) {
      choice -= item.value;
      if (choice <= 0) return this.plans.target(item.planet);
    }
    return this.plans.target(other.at(-1).planet);
  }
  income(payments) {
    for (const payment of payments || []) {
      const c = this.controllers.get(key(payment.owner));
      if (c && c.budget.initialized) c.budget.fiscal(payment.amount, c.player.credits, fiscalCycleSeconds());
    }
  }
  report() {
    return {
      controllers: [...this.controllers.values()].map(c => ({
        faction: c.player.faction,
        type: c.name,
        difficulty: c.difficulty,
        templates: c.type.templates.galactic,
        freeStore: c.type.galactic,
        goals: c.brain.fnOf.size,
        sleep: c.adjustment?.galacticSleep ?? 1,
        service: this.goals.sides.get(key(c.player.faction))?.last || null,
        budgets: c.budget.report()
      })),
      planGoals: this.plans.byGoal.size,
      plans: this.plans.live.map(p => ({
        faction: p.ai.player.faction,
        script: p.name,
        goal: p.goal,
        target: p.thing?.name,
        cost: p.budget.allocated,
        forces: p.forces.map(f => ({ name: f.name, units: f.units.length, jobs: f.jobs.length, stage: f.stage?.name }))
      })),
      reservations: this.plans.reservations.size,
      history: this.plans.history,
      pending: [...this.plans.pending.values()],
      missing: Object.fromEntries(this.missing),
      errors: Object.fromEntries(this.errors)
    };
  }
  dispose() {
    this.disposed = true;
    for (const fs of this.freeStores.values()) fs.dispose();
    this.freeStores.clear();
    this.plans.dispose();
    for (const { inst } of this.evaluators.values()) this.game.story.vm.free(inst.env);
    this.evaluators.clear();
    this.controllers.clear();
    this.goals.sides.clear();
    this.plans.pending.clear();
  }
}
