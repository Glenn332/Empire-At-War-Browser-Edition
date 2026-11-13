import { db } from '../gamedata.js';
import { buildCost, isUpgradeType } from './sim.js';
import { fetchText } from '../vfs.js';
import { simRandom } from './simrandom.js';
import { zonePaths, zoneThreat } from './landzones.js';
import { namedSet } from './priorities.js';
import { aidebug as D, who, group, targetOf, nameOf } from '../aidebug.js';
import { difficultyAdjustment } from './landbrain.js';

const lead = e => (e && e.isSquad ? e.fighters[0] : e);
const gone = e => !e || e.dead || (e.isSquad && !e.fighters.length);
const bodies = e => (e.isSquad ? e.fighters : e.members) || [e];
const unset = e => {
  if (e)
    for (const b of bodies(e)) {
      if (b && b.prioSet) b.prioSet = undefined;
      if (b && b.stickiness !== undefined) b.stickiness = undefined;
      if (b && b.attackPositioning) b.attackPositioning = false;
    }
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const idle = e => !e.order || e.order.kind === 'idle' || !!e.order.fs || (!!e.fsKind && e.fsKind === e.order.kind);
const SERVICE = 0.5;
const HP_KINDS = [
  'HARD_POINT_ENGINE',
  'HARD_POINT_SHIELD_GENERATOR',
  'HARD_POINT_GRAVITY_WELL',
  'HARD_POINT_FIGHTER_BAY',
  'HARD_POINT_TRACTOR_BEAM',
  'HARD_POINT_WEAPON_LASER',
  'HARD_POINT_WEAPON_MISSILE',
  'HARD_POINT_WEAPON_TORPEDO',
  'HARD_POINT_WEAPON_ION_CANNON',
  'HARD_POINT_WEAPON_MASS_DRIVER',
  'HARD_POINT_WEAPON_SPECIAL',
  'HARD_POINT_ENABLE_SPECIAL_ABILITY',
  'HARD_POINT_DUMMY_ART'
];
const COLLISION = { NONE: 0, MOVING: 1, STATIC: 2, ASTEROID: 4, ION_STORM: 8, NEBULA: 16 };
const AMBUSH_DIRS = { FRONT: 0, LEFT: 1, RIGHT: 2, BACK: 3 };

export function hardpointKind(name) {
  let t = String(name ?? '')
    .trim()
    .toUpperCase();
  if (!t.startsWith('HARD_POINT_')) t = 'HARD_POINT_' + t;
  return HP_KINDS.indexOf(t);
}

export function collisionBits(text) {
  let m = 0;
  for (const part of String(text ?? '').split('|')) {
    const k = part.trim().toUpperCase();
    if (!k) continue;
    if (!(k in COLLISION)) return null;
    m |= COLLISION[k];
  }
  return m;
}

export function weakestHardpoint(t, kind) {
  let best = null,
    m = Infinity;
  for (const h of (t && t.hardpoints) || []) {
    if (h.kind !== HP_KINDS[kind] || !(h.alive || !h.destroyable)) continue;
    const hp = (h.route || h).health,
      f = h.maxHealth > 0 ? Math.max(0, Math.min(1, hp / h.maxHealth)) : 0;
    if (f < m) {
      m = f;
      best = h;
    }
  }
  return best;
}

const attackable = t =>
  !!t &&
  !gone(t) &&
  (t.isSquad || (t.type.bool('Collidable_By_Projectile_Living') && t.type.bool('Is_Valid_Target', true))) &&
  !(t.type.behaviors().has('SPECIAL_WEAPON') && !t.type.behaviors().has('DUMMY_STAR_BASE'));
const adjustKey = (faction, difficulty) => String(faction || '').toUpperCase() + '|' + String(difficulty || 'normal').toLowerCase();

function fits(e, spec) {
  const u = lead(e);
  if (!u) return false;
  if (spec.not && spec.not.length && (spec.not.includes(e.type) || spec.not.includes(u.type))) return false;
  if (spec.types) {
    if (spec.types.includes(e.type) || spec.types.includes(u.type)) return true;
    const is = (e.isTypes ||= new Set(
      [
        ...(e.members || e.fighters || []).map(m => m.type),
        db.type(e.type.str('Create_Team_Type')),
        ...e.type.list('Company_Units').map(n => db.type(n)),
        ...e.type.list('Company_Units').map(n => {
          const t = db.type(n);
          return t && t.parent;
        })
      ].filter(Boolean)
    ));
    return spec.types.some(t => is.has(t));
  }
  const c = e.cats ? e.cats() : u.type.categories(),
    cats = spec.cats;
  return cats.some(
    x =>
      c.has(x) ||
      (x === 'FIGHTER' && e.isSquad && !e.isBomber) ||
      (x === 'BOMBER' && e.isSquad && e.isBomber) ||
      (x === 'SPACEHERO' && c.has('HERO'))
  );
}

export function readForce(def) {
  const f = { name: String(def[0]), specs: [], flags: new Set(), minSize: 0, minForce: 0 },
    not = [];
  for (const raw of def.slice(1)) {
    const line = String(raw).trim();
    const tot = /^MinimumTotal(Size|Force)\s*=\s*([\d.]+)/i.exec(line);
    if (tot) {
      if (/size/i.test(tot[1])) f.minSize = +tot[2];
      else f.minForce = +tot[2];
      continue;
    }
    if (line[0] === '-') {
      const t = db.type(line.slice(1).trim());
      if (t) not.push(t);
      continue;
    }
    const pc = /^(.+?)=\s*(\d+)\s*%\s*$/.exec(line),
      m = pc || /^(.+?)=\s*(\d+)\s*(?:,\s*(\d+))?\s*$/.exec(line);
    if (!m) {
      f.flags.add(line.toUpperCase());
      continue;
    }
    const names = m[1]
        .split('|')
        .map(x => x.trim())
        .filter(Boolean),
      types = names.map(n => db.type(n)).filter(Boolean);
    f.specs.push({
      types: types.length ? types : null,
      cats: types.length ? null : names.map(n => n.toUpperCase()),
      not,
      min: pc ? 0 : +m[2],
      max: pc ? Infinity : m[3] !== undefined ? +m[3] : +m[2],
      pct: pc ? +pc[2] : 0
    });
  }
  return f;
}

function readPlan(code) {
  const num = (n, d) => {
    const m = new RegExp('^[ \\t]*' + n + '\\s*=\\s*([\\d.]+)', 'm').exec(code);
    return m ? +m[1] : d;
  };
  const flag = (n, d) => {
    const m = new RegExp('^[ \\t]*' + n + '\\s*=\\s*(true|false)', 'm').exec(code);
    return m ? m[1] === 'true' : d;
  };
  const forces = [],
    at = /TaskForce\s*=\s*\{/.exec(code);
  if (at) {
    let depth = 1,
      start = -1;
    for (let i = at.index + at[0].length; i < code.length && depth > 0; i++) {
      const c = code[i];
      if (c === '{') {
        if (++depth === 2) start = i + 1;
      } else if (c === '}' && --depth === 1 && start >= 0) {
        const strs = [...code.slice(start, i).matchAll(/"([^"]*)"/g)].map(x => x[1]);
        if (strs.length) forces.push(readForce(strs));
        start = -1;
      }
    }
  }
  const req = /RequiredCategories\s*=\s*\{([^}]*)\}/.exec(code);
  return {
    forces,
    ignoreTarget: flag('IgnoreTarget', false),
    engaged: flag('AllowEngagedUnits', true),
    freeStore: flag('AllowFreeStoreUnits', true),
    magic: flag('MagicPlan', false),
    min: num('MinContrastScale', 1.1),
    max: num('MaxContrastScale', 1.5),
    perFail: num('PerFailureContrastAdjust', 0.1),
    extraCost: num('MinimumCost', 0) + num('AdditionalCost', 0),
    required: req
      ? [...req[1].matchAll(/"([^"]*)"/g)]
          .map(y =>
            y[1]
              .split('|')
              .map(x => x.trim().toUpperCase())
              .filter(Boolean)
          )
          .filter(q => q.length)
      : []
  };
}

export class Plans {
  constructor(host) {
    this.host = host;
    this.world = host.world;
    this.byGoal = new Map();
    this.live = [];
    this.ready = false;
    this.failed = new Map();
    this.buys = new Map();
    this.defs = new Map();
    this.adjusts = new Map();
    this.otherMode = new Set();
    this.needs = new Map();
    this.builds = new Map();
    this.goalName = new Map();
    if (!host.land && this.world && typeof this.world.applyDamage === 'function') {
      this.world.onUnitHit = (t, from, loss) => this.hit(t, from, loss);
      this.world.onUnitSignal = (e, name, extra) => this.signal(e, name, extra);
    }
    this.find();
  }

  async find() {
    const host = this.host,
      keys = [];
    const other = host.land ? /\\SPACEMODE\\/ : /\\LANDMODE\\/;
    for (const [key, file] of host.index)
      if (/\\SCRIPTS\\AI\\/.test(file) && !key.includes('/')) {
        keys.push(key);
        host.fetch(key, file);
        if (other.test(file)) this.otherMode.add(key);
      }
    while (host.fetching) await new Promise(r => setTimeout(r, 50));
    const g = host.game || {},
      sides = host.land
        ? (g.factions || []).map((f, side) => [f, g.players?.[side]?.difficulty])
        : (this.world.players || []).filter(p => p.id >= 0).map(p => [p.factionName, p.difficulty]);
    for (const [f, lv] of sides) {
      const k = adjustKey(f, lv);
      if (f && !this.adjusts.has(k)) this.adjusts.set(k, await difficultyAdjustment(f, lv).catch(() => null));
    }
    for (const key of keys) {
      const src = host.sources.get(key);
      const m = src && /^[ \t]*Category\s*=\s*"([^"]*)"/m.exec(src.replace(/--[^\n]*/g, ''));
      if (!m) continue;
      if (this.otherMode.has(key) && !(host.land ? /(^|[\s|])Land_/i : /(^|[\s|])Space_/i).test(m[1])) continue;
      const needs = [],
        code = src.replace(/--[^\n]*/g, '').replace(/"\s*\.\.\s*"/g, '');
      const built = [];
      for (const x of code.matchAll(/"([A-Za-z_0-9 |-]+?)=\s*(\d+)\s*(?:,\s*(\d+))?\s*"/g)) {
        const types = x[1]
          .split('|')
          .map(n => db.type(n.trim()))
          .filter(Boolean)
          .filter(t => t.has('Tactical_Buildable_Constructed'));
        if (types.length) built.push({ types, max: Math.max(1, x[3] !== undefined ? +x[3] : +x[2]) });
      }
      if (built.length) this.builds.set(key, built);
      if (!/^[ \t]*AllowFreeStoreUnits\s*=\s*false/m.test(code))
        for (const x of code.matchAll(/"([A-Za-z_0-9 |-]+?)=\s*(\d+)\s*(?:,\s*\d+)?\s*"/g)) {
          const names = x[1]
              .split('|')
              .map(n => n.trim())
              .filter(Boolean),
            types = names.map(n => db.type(n)).filter(Boolean);
          if (types.length && types.every(t => t.has('Tactical_Buildable_Constructed'))) continue;
          if (+x[2] > 0 && names.length)
            needs.push({ types: types.length ? types : null, cats: types.length ? null : names.map(n => n.toUpperCase()), min: +x[2] });
        }
      else {
        const specs = [];
        for (const x of code.matchAll(/"([A-Za-z_0-9 |-]+?)=\s*(\d+)\s*(?:,\s*(\d+))?\s*"/g)) {
          const names = x[1]
              .split('|')
              .map(n => n.trim())
              .filter(Boolean),
            types = names.map(n => db.type(n)).filter(Boolean);
          specs.push({
            types: types.length ? types : null,
            cats: types.length ? null : names.map(n => n.toUpperCase()),
            min: +x[2],
            max: x[3] !== undefined ? +x[3] : +x[2]
          });
        }
        const req = /RequiredCategories\s*=\s*\{([^}]*)\}/.exec(code);
        this.buys.set(key, {
          specs,
          required: req ? [...req[1].matchAll(/"([^"]*)"/g)].map(y => y[1]) : [],
          bare: /"\s*TaskForceRequired\s*"/i.test(code)
        });
      }
      needs.idle = /^[ \t]*AllowEngagedUnits\s*=\s*false/m.test(code);
      this.defs.set(key, readPlan(code));
      this.needs.set(key, needs);
      for (const g of m[1]
        .split('|')
        .map(x => x.trim())
        .filter(Boolean))
        if (!this.goalName.has(g.toUpperCase())) this.goalName.set(g.toUpperCase(), g);
      for (const g of m[1]
        .split('|')
        .map(x => x.trim().toUpperCase())
        .filter(Boolean)) {
        if (g === 'ALWAYSOFF') continue;
        if (!this.byGoal.has(g)) this.byGoal.set(g, []);
        this.byGoal.get(g).push(key);
      }
    }
    this.ready = true;
    const todo = [...host.sources].filter(([, src]) => typeof src === 'string');
    const step = () => {
      const next = todo.pop();
      if (!next) return;
      host.vm.compile(next[1], next[0]);
      setTimeout(step, 30);
    };
    setTimeout(step, 30);
  }

  adjustment(ai) {
    const p = ai && ai.player;
    if (p && p.adjust) return p.adjust;
    return (p && this.adjusts.get(adjustKey(p.factionName, ai.difficulty || p.difficulty))) || null;
  }

  contrastScale(ai) {
    const a = this.adjustment(ai),
      v = a && (this.host.land ? a.landContrast : a.spaceContrast);
    return Number.isFinite(v) ? v : 1;
  }

  sleep(ai) {
    const a = this.adjustment(ai),
      v = a && (this.host.land ? a.landSleep : a.spaceSleep);
    return Number.isFinite(v) ? Math.max(0, Math.trunc(30 * v)) / 30 : 0;
  }

  draw(goal, S) {
    const list = this.byGoal.get(String(goal).toUpperCase());
    if (!list || !list.length) return null;
    const stats = (S && (S.planStats ||= new Map())) || this.stats;
    let sum = 0;
    const cum = list.map(key => {
      const s = stats.get(key);
      return (sum += (s && s.total > 0 ? s.wins / s.total : 1) + 1);
    });
    const r = simRandom() * sum;
    for (let i = 0; i < list.length; i++) if (r < cum[i]) return list[i];
    return list[list.length - 1];
  }

  can(goal) {
    return this.ready && this.byGoal.has(String(goal).toUpperCase()) && (this.failed.get(String(goal).toUpperCase()) || 0) < 3;
  }
  running(ai, goal, thing = null) {
    const g = String(goal).toUpperCase();
    return this.live.some(p => p.ai === ai && p.goal === g && (thing === null || p.thing === thing));
  }
  count(ai, goal = null) {
    const g = goal && String(goal).toUpperCase();
    return this.live.filter(p => p.ai === ai && (!g || p.goal === g)).length;
  }

  staffable(ai, goal, thing = null, o = {}) {
    const list = o.key ? [o.key] : this.byGoal.get(String(goal).toUpperCase()) || [],
      w = this.world;
    return list.some(key => {
      const jobs = this.builds.get(key);
      if (jobs) {
        const mine = jobs.flatMap(j => j.types),
          pads = w.openPads ? w.openPads(ai.player) : w.units.filter(u => !u.dead && u.isPad && !u.padChild && u.padOwner === ai.player);
        return pads.some(u => w.buildOptions(u, ai.player).some(t => mine.includes(t) && !w.cantBuild(u, t, ai.player)));
      }
      if (thing && thing.isSite && !this.fieldsUnits(key))
        return w.buildOptions(thing, ai.player).some(t => !w.cantBuild(thing, t, ai.player));
      const b = this.buys.get(key);
      if (b)
        return (
          b.bare ||
          this.choose(ai.player, b.specs, b.required, { D: this.defs.get(key), t: o.t, mind: o.mind, ai, fails: o.fails }).chosen.length > 0
        );
      return !!this.staff(ai, key, thing, this.pass ? o : { ...o, all: true });
    });
  }

  heroes(ai, D, got) {
    const w = this.world,
      p = ai.player,
      sellers = w.buildersOf ? w.buildersOf(p) : [];
    if (!sellers.length) return got;
    const taken = new Set();
    for (const f of D.forces)
      for (const sp of f.specs)
        for (const e of ai.mine()) {
          const u = lead(e);
          if (taken.has(e) || e.aiPlan || gone(e) || e.noAI || !u || !(u.type.bool('Is_Named_Hero') || e.type.bool('Is_Named_Hero'))) continue;
          if (!fits(e, sp) || !sellers.some(b => w.buildOptions(b, p).includes(e.type) && !w.cantBuild(b, e.type, p))) continue;
          taken.add(e);
          if (!got.has(f.name)) got.set(f.name, []);
          got.get(f.name).push(e);
          break;
        }
    return got;
  }

  engaged(e) {
    if (!e.isSquad && !e.members) return false;
    const t = e.target || e.fireTarget;
    return !!t && !gone(t);
  }

  fieldsUnits(key) {
    const D = this.defs.get(key);
    return (
      !!D &&
      !D.magic &&
      !!D.freeStore &&
      D.forces.some(f => f.specs.some(sp => !(sp.types && sp.types.every(t => t.has('Tactical_Buildable_Constructed')))))
    );
  }

  staff(ai, key, thing, o = {}) {
    const hf0 = e => {
      let h = 0,
        m = 0;
      for (const u of e.isSquad ? e.fighters : e.members || [e]) {
        h += u.hpDies ? u.healthFrac * u.maxHealth : u.health || 0;
        m += u.maxHealth || 0;
      }
      return m > 0 ? h / m : 1;
    };
    const D = this.defs.get(key),
      got = new Map(),
      w0 = this.world;
    if (!D || D.magic) return got;
    if (!D.freeStore) return this.heroes(ai, D, got);
    const lines = [];
    for (const f of D.forces)
      for (const sp of f.specs)
        if (!(sp.types && sp.types.every(t => t.has('Tactical_Buildable_Constructed'))))
          lines.push({ s: sp, f, n: 0, fit: 0, escort: f.flags.has('ESCORTFORCE') });
    if (!lines.length) return got;
    const mind = o.mind || ai.mind || null,
      t = o.t || (thing && thing.type ? { unit: thing, x: thing.x, y: thing.y } : thing) || null;
    const at = t && t.x !== undefined ? t : null;
    const mine = new Map();
    const pool = ai.mine();
    if (lines.some(l => l.s.types && l.s.types.some(t => t.bool('Is_Special_Weapon_In_Space'))))
      for (const sw of w0.specialWeapons || []) if (sw.player === ai.player && sw.charge >= 0.99 && sw.enabled()) pool.push(sw);
    const floor = db.constants.num('Health_Low_Percent_Threshold', 0.33);
    const heroesAttach = D.forces.some(f => !f.flags.has('DENYHEROATTACH'));
    const scriptedHero = e => {
      const t = (e.isSquad ? e.fighters[0] || e : e).type;
      return (
        (t.bool('Is_Named_Hero') || t.bool('Is_Generic_Hero') || e.type.bool('Is_Named_Hero')) &&
        !!(t.str('Lua_Script') || e.type.str('Lua_Script'))
      );
    };
    let far = 0;
    for (const e of pool) {
      if (!e.isSquad && !e.members && hf0(e) < floor) continue;
      if (e.x !== undefined && this.unheld(e, ai, o) && t && t.x !== undefined) far = Math.max(far, (e.x - t.x) ** 2 + (e.y - t.y) ** 2);
      if (heroesAttach && !e.isSpecialWeapon && scriptedHero(e)) continue;
      if (e.noAI || gone(e) || this.host.locked(e) || !this.unheld(e, ai, o) || !(D.engaged || !this.engaged(e))) continue;
      const ls = lines.filter(l => fits(e, l.s));
      if (ls.length) mine.set(e, ls);
    }
    const P0 = ai.player,
      entries = new Map(),
      land = !!this.host.land,
      pool0 = land ? (w0.landPool ? w0.landPool(P0) : null) : P0.aiPool;
    if (pool0 && pool0.length) {
      const landed = land ? 0 : P0.pop - P0.reinforcements.reduce((a, t) => a + t.num('Population_Value', 0), 0);
      for (const x of pool0) {
        if (x.owner && x.owner.state !== 'over') continue;
        const t = x.type,
          sq = !land && t.has('Squadron_Units'),
          m = sq
            ? t
                .list('Squadron_Units')
                .map(n => db.type(n))
                .filter(Boolean)
            : land
              ? t
                  .list('Company_Units')
                  .map(n => db.type(n))
                  .filter(Boolean)
                  .slice(0, 1)
              : [];
        const ty0 = m[0] || t,
          cats = ty0.categories();
        const e = {
          pooled: x,
          type: t,
          isSquad: sq,
          isBomber: sq && cats.has('BOMBER'),
          fighters: sq ? m.map(type => ({ type, health: 1, maxHealth: 1 })) : null,
          health: 1,
          maxHealth: 1,
          cats: () => cats,
          popv: t.num('Population_Value', 0)
        };
        if (land)
          e.members = t
            .list('Company_Units')
            .map(n => db.type(n))
            .filter(Boolean)
            .map(type => ({ type, health: 1, maxHealth: 1 }));
        const ls = lines.filter(l => fits(e, l.s));
        if (ls.length) {
          mine.set(e, ls);
          entries.set(e, true);
        }
      }
      entries.room = land ? () => w0.landRoom(P0) : () => P0.popCap - landed;
    }
    const way = new Map();
    if (this.host.land && at && mind && mind.route && mind.zoneOf) {
      const tz = mind.zone(at),
        tol = db.constants.num('Low_Threat_Reachability_Tolerance', 500);
      if (tz)
        for (const e of mine.keys()) {
          if (e.pooled) continue;
          const s = mind.route(mind.zoneOf(e.x, e.y), tz);
          if (s >= 0 && Math.floor(s / 65536) * 100 <= tol) way.set(e, (s % 65536) / 10);
        }
    }
    const units = [...mine.keys()];
    const parts = e => (e.isSquad ? e.fighters : e.members || [e]);
    const pow = e => {
      let n = 0;
      for (const u of parts(e)) n += Math.max(0, u.type.num('AI_Combat_Power', 0));
      return n;
    };
    const hf = e => {
      let h = 0,
        m = 0;
      for (const u of parts(e)) {
        h += u.hpDies ? u.healthFrac * u.maxHealth : u.health || 0;
        m += u.maxHealth || 0;
      }
      return m > 0 ? Math.min(1, h / m) : 1;
    };
    const kinds = e =>
      (e.ckinds ||= new Set([
        ...(typeof e.cats === 'function' ? e.cats() : lead(e).type.categories()),
        ...(e.isSquad ? [e.isBomber ? 'BOMBER' : 'FIGHTER'] : [])
      ]));
    const tech = e => {
      const u = lead(e);
      return Math.max(0, e.type.num('Tech_Level', 0) || (u ? u.type.num('Tech_Level', 0) : 0));
    };
    const dOf = new Map();
    let maxD = 0;
    if (at)
      for (const e of units) {
        if (e.pooled) continue;
        const d = (way.get(e) || 0) ** 2 + (e.x - at.x) ** 2 + (e.y - at.y) ** 2;
        dOf.set(e, d);
        if (d > maxD) maxD = d;
      }
    if (far > maxD) maxD = far;
    for (const e of units) if (e.pooled) dOf.set(e, maxD);
    for (const l of lines) if (l.s.pct && l.s.pct < 100) l.fit = units.filter(e => mine.get(e).includes(l)).length;
    const room = l => (l.s.pct ? l.s.pct >= 100 || l.n < Math.ceil((l.fit * l.s.pct) / 100) : l.n < l.s.max);
    const table = D.ignoreTarget ? null : this.host.contrast() || new Map(),
      cs = table ? [...table.keys()] : [];
    const fails = o.fails || 0,
      lv = String(ai.difficulty || (ai.player && ai.player.difficulty) || 'normal').toLowerCase();
    const scale = (D.max + fails * D.perFail) * this.contrastScale(ai),
      thr = 1 - (fails * D.perFail + D.min) / (fails * D.perFail + D.max);
    const about = c => (t && mind && mind.at ? mind.at(t, true, 'force', c ? [c] : null, 0) : 0);
    const own = c => (t && t.unit && !t.zone ? (!c || kinds(t.unit).has(c) ? pow(t.unit) : 0) : about(c));
    const facs = new Map();
    const fac = e => {
      let a = facs.get(e);
      if (a) return a;
      const k = kinds(e),
        u = lead(e);
      a = cs.map(c => {
        const en = table.get(c),
          w = en.types.get(e.type) ?? (u ? en.types.get(u.type) : undefined);
        if (w !== undefined) return w;
        let n = 0,
          sum = 0,
          one = false;
        for (const [kc, x] of en.kinds)
          if (k.has(kc)) {
            if (x === 1) one = true;
            else {
              n++;
              sum += x;
            }
          }
        return n ? sum / n : one ? 1 : 0;
      });
      if (this.host.land && this.host.terrainEffect) {
        const f = this.host.terrainEffect(e.type);
        if (f !== 1) for (let i = 0; i < a.length; i++) a[i] *= f;
      }
      facs.set(e, a);
      return a;
    };
    const mk = f => {
      const E = cs.map(c => f(c) * scale),
        tot = f(null);
      return {
        E,
        R: E.slice(),
        tot,
        left: tot,
        sum: E.reduce((a, b) => a + b, 0),
        can: units.some(e => fac(e).some((x, i) => x > 0 && E[i] > 0))
      };
    };
    const main = table ? mk(own) : null,
      esc = table && lines.some(l => l.escort) ? mk(about) : null;
    const sat = T => {
      if (!T.can || T.sum <= 0) return true;
      let r = 0;
      for (const x of T.R) if (x > 0) r += x;
      return r / T.sum <= thr;
    };
    const picks = [],
      byType = new Map(),
      taken = new Set(),
      size = new Map(),
      force = new Map(),
      first = new Map();
    let poolPop = 0;
    const short = f => (f.minSize > 0 && (size.get(f) || 0) < f.minSize) || (f.minForce > 0 && (force.get(f) || 0) < f.minForce);
    const has = (e, q) => q.some(c => kinds(e).has(c) || (c === 'SPACEHERO' && kinds(e).has('HERO')));
    for (;;) {
      const mainOk = !main || sat(main),
        rnd = new Map(),
        mainShort = lines.some(l => !l.escort && !l.s.pct && l.n < l.s.min);
      let cands = [];
      for (const e of units) {
        if (taken.has(e)) continue;
        if (e.pooled && entries.room() < poolPop + e.popv) continue;
        const ls = mine.get(e),
          role = !!esc && mainOk && !mainShort && ls.some(l => l.escort && room(l));
        const open = ls.filter(l => l.escort === (esc ? role : l.escort) && room(l));
        if (!open.length) continue;
        let k = first.get(e.type);
        if (k === undefined) first.set(e.type, (k = Math.floor(simRandom() * 8)));
        const l = open[k % open.length],
          head = open.find(x => !x.s.pct || !D.ignoreTarget) || l;
        let sc = (head.s.pct ? 1 : 1 - head.n / head.s.max) + (maxD > 0 ? 1 - dOf.get(e) / maxD : 0) + (tech(e) / 5) * 2,
          idx = -1,
          f = 0,
          P = 0,
          T = null;
        if (!table) {
          let r = rnd.get(e.type);
          if (r === undefined) rnd.set(e.type, (r = (simRandom() * pow(e)) / 500));
          sc += r;
        } else {
          T = role ? esc : main;
          P = pow(e) * hf(e);
          const fc = fac(e);
          let best = 0;
          for (let i = 0; i < cs.length; i++) {
            const R = T.R[i],
              x = fc[i] * P;
            if (!(R > 0) || !(x > 0)) continue;
            const g = fc[i] * (1 - (Math.max(R - x, 0) / Math.max(R, x)) ** 2);
            if (g > best) {
              best = g;
              idx = i;
              f = fc[i];
            }
          }
          if (best > 0) sc += 2 * best;
          else if (!sat(T)) continue;
          else if (
            !(
              D.extraCost > 0 ||
              (T.left > 0 && fc.some(x => x > 0)) ||
              ls.some(x => !x.s.pct && x.n < x.s.min) ||
              short(l.f) ||
              D.required.some(q => has(e, q) && !picks.some(x => has(x, q)))
            )
          )
            continue;
        }
        cands.push({ e, l, sc, idx, f, P, T });
      }
      if (entries.size && cands.some(c => c.e.pooled)) {
        const best = new Map(),
          waiting = new Set();
        for (const c of cands) {
          if (c.e.pooled) {
            waiting.add(c.e.type);
            continue;
          }
          const d = dOf.get(c.e) ?? Infinity,
            b = best.get(c.e.type);
          if (b === undefined || d < b) best.set(c.e.type, d);
        }
        cands = cands.filter(c => {
          if (!waiting.has(c.e.type)) return true;
          const keep = best.get(c.e.type) < 300;
          return c.e.pooled ? !keep : keep;
        });
        for (const c of cands)
          if (c.e.pooled) {
            const b = best.get(c.e.type);
            c.sc += 2 + (b !== undefined && Number.isFinite(b) && maxD > 0 ? 1 - b / maxD : 0);
          }
      }
      if (!cands.length) break;
      if (picks.length) {
        const rest = cands.filter(c => (byType.get(c.e.type) || 0) / picks.length < 0.5);
        if (rest.length) cands = rest;
      }
      let c = cands[0];
      for (const x of cands) if (x.sc > c.sc) c = x;
      if (c.e.pooled) poolPop += c.e.popv;
      taken.add(c.e);
      picks.push(c.e);
      byType.set(c.e.type, (byType.get(c.e.type) || 0) + 1);
      c.l.n++;
      size.set(c.l.f, (size.get(c.l.f) || 0) + 1);
      force.set(c.l.f, (force.get(c.l.f) || 0) + pow(c.e));
      if (!got.has(c.l.f.name)) got.set(c.l.f.name, []);
      got.get(c.l.f.name).push(c.e);
      if (c.T) {
        if (c.idx >= 0) c.T.R[c.idx] -= c.f * c.P;
        c.T.left -= c.P;
      }
    }
    const no = why => {
      if (o.why) o.why.push(why);
      return null;
    };
    if (!picks.length && !D.forces.some(f => f.flags.has('TASKFORCEREQUIRED'))) return no('none');
    if (lines.some(l => !l.s.pct && l.n < l.s.min)) return no('line');
    if (picks.length && D.forces.some(f => f.specs.length && short(f))) return no('total');
    if (D.required.some(q => !picks.some(e => has(e, q))) && picks.length) return no('required');
    for (const T of [main, esc]) {
      if (!T || !picks.length) continue;
      if (T.tot > 0 && T.left / T.tot > thr) return no('whole');
      for (let i = 0; i < cs.length; i++) if (T.E[i] > 0 && T.R[i] / T.E[i] > thr) return no('kind ' + cs[i]);
    }
    return got;
  }

  beginSelection(ai) {
    this.pass = { ai, held: new Set() };
  }
  canRetain(inst) {
    return inst.state !== 'over';
  }
  retain(inst) {
    if (inst.state === 'over') return false;
    if (this.pass) this.pass.held.add(inst);
    return true;
  }
  endSelection() {
    this.pass = null;
  }
  unheld(e, ai, o = {}) {
    return !!o.all || !e.aiPlan || e.aiPlan.state === 'over' || this.open(e, ai);
  }
  open(e, ai) {
    const p = this.pass,
      v = e.aiPlan;
    return !!p && p.ai === ai && v.ai === ai && (v.state === 'over' || (!!v.gdef && !p.held.has(v)));
  }

  dbg(kind, inst, text) {
    D.log(kind, this.host.land ? 'L' : 'S', this.world.time, who(inst.ai), (inst.goal ? inst.goal + ': ' : '') + text, 'plan');
  }

  stop(inst) {
    if (inst.state !== 'over') {
      this.host.drop(inst);
      inst.state = 'over';
    }
  }

  start(ai, goal, thing = null, o = {}) {
    const g = String(goal).toUpperCase(),
      list = this.byGoal.get(g);
    if (!list) return null;
    const key = o.key && list.includes(o.key) ? o.key : list[Math.floor(simRandom() * list.length)];
    const staffed = this.staff(ai, key, thing, o);
    if (!staffed) return null;
    const inst = {
      plan: true,
      global: true,
      e: null,
      name: key,
      key,
      state: 'new',
      next: 0,
      prox: [],
      events: [],
      values: new Map(),
      exit: false,
      ai,
      goal: g,
      thing,
      forces: [],
      born: this.world.time,
      result: null,
      removable: true,
      begin: () => this.begin(inst),
      poll: () => this.poll(inst)
    };
    inst.staffed = staffed;
    inst.gd = o.desire;
    inst.aim = { t: o.t, mind: o.mind, fails: o.fails || 0 };
    if (!this.reserve(inst)) return null;
    const robbed = new Set();
    for (const list of staffed.values())
      for (const e of list) {
        if (e.pooled) {
          e.pooled.owner = inst;
          continue;
        }
        const v = e.aiPlan;
        if (v && v !== inst) {
          if (v.state !== 'over' && (v.gdef || (v.staffed && [...v.staffed.values()].some(l => l.includes(e))))) robbed.add(v);
          for (const f of v.forces) f.units = f.units.filter(x => x !== e);
          unset(e);
        }
        e.aiPlan = inst;
      }
    for (const v of robbed) {
      v.stolen = true;
      this.stop(v);
    }
    if (this.pass) this.pass.held.add(inst);
    this.host.add(inst);
    this.live.push(inst);
    if (D.on)
      this.dbg(
        'plan',
        inst,
        'begun ' + key + ' on ' + (thing ? targetOf(thing) : 'global') + ' with ' + group([...staffed.values()].flat())
      );
    return inst;
  }

  begin(inst) {
    const host = this.host,
      vm = host.vm,
      env = inst.env;
    const defs = vm.read(env, 'TaskForce');
    inst.flags = {
      engaged: vm.read(env, 'AllowEngagedUnits') !== false,
      noTarget: vm.read(env, 'IgnoreTarget') === true,
      required: vm.read(env, 'RequiredCategories'),
      buys: vm.read(env, 'AllowFreeStoreUnits') === false,
      min: +vm.read(env, 'MinContrastScale') || 1.1,
      max: +vm.read(env, 'MaxContrastScale') || 1.5
    };
    vm.set(env, 'PlayerObject', host.player(inst.ai.player));
    const t = inst.thing,
      target = !t ? undefined : t.type ? host.wrap(t) : host.pos(t.x, t.y, 0, t.name || 'Position');
    vm.set(env, 'AITarget', target);
    vm.set(env, 'Target', target);
    for (const def of Array.isArray(defs) ? defs : []) {
      if (!Array.isArray(def) || typeof def[0] !== 'string') continue;
      const f = Object.assign(readForce(def), {
        def: def.map(String),
        units: [],
        had: false,
        moving: new Set(),
        seen: new Map(),
        inst,
        pool: []
      });
      inst.forces.push(f);
      vm.set(env, f.name, this.force(f));
      const D = this.defs.get(inst.key);
      const staffs = f.specs.some(sp => !(sp.types && sp.types.length && sp.types.every(t => t.has('Tactical_Buildable_Constructed'))));
      if (inst.staffed && D && D.freeStore && !D.magic && staffs && !(inst.staffed.get(f.name) || []).length) continue;
      const th = vm.thread(env, f.name + '_Thread');
      if (th) {
        th.id = ++inst.threadIds;
        th.values = new Map();
        inst.threads.push(th);
      }
    }
    inst.rate = SERVICE;
    return inst.threads.length > 0;
  }

  reserve(inst) {
    const b = this.buys.get(inst.key);
    if (!b || b.bare || this.builds.has(inst.key) || this.defs.get(inst.key)?.magic) return true;
    const p = inst.ai.player,
      got = this.choose(p, b.specs, b.required, this.aimOf(inst));
    if (!got.chosen.length) return false;
    const w = this.world,
      cost = got.chosen.reduce((a, t) => a + (w.costOf ? w.costOf(t) : buildCost(t)), 0);
    p.credits -= cost;
    inst.reserved = cost;
    return true;
  }

  refund(inst, most = Infinity) {
    const n = Math.min(inst.reserved || 0, most);
    if (!(n > 0)) return 0;
    inst.reserved -= n;
    inst.ai.player.credits += n;
    return n;
  }

  buy(inst, f) {
    const w = this.world,
      p = inst.ai.player;
    this.refund(inst);
    const got = this.choose(p, f.specs, inst.flags?.required, this.aimOf(inst, f));
    for (const e of (inst.staffed && inst.staffed.get(f.name)) || [])
      if (!gone(e) && e.aiPlan === inst && !f.units.includes(e) && f.take) f.take(e);
    if (D.on && !got.chosen.length)
      this.dbg('build', inst, 'nothing could be bought for ' + f.name + ' (credits ' + Math.round(p.credits) + ')');
    return got.chosen.filter(t => {
      const at = got.at.get(t),
        why = w.startBuild(at, t, p);
      if (D.on)
        this.dbg(
          'build',
          inst,
          (why ? 'refused ' + t.name + ' (' + why + ')' : 'ordered ' + t.name) + ' at ' + nameOf(at) + ' for ' + f.name
        );
      return !why;
    });
  }

  canBegin(ai, goal) {
    const list = this.byGoal.get(String(goal).toUpperCase()) || [];
    return list.some(key => {
      const b = this.buys.get(key);
      return !b || b.bare || this.choose(ai.player, b.specs, b.required).chosen.length > 0;
    });
  }

  aimOf(inst, f = null) {
    const a = inst.aim || {};
    return {
      D: this.defs.get(inst.key),
      t: a.t,
      mind: (inst.ai && inst.ai.mind) || a.mind,
      ai: inst.ai,
      fails: a.fails || 0,
      escort: !!(f && f.flags && f.flags.has && f.flags.has('ESCORTFORCE'))
    };
  }

  choose(p, specs, required, o = {}) {
    const w = this.world,
      f = { specs },
      none = { chosen: [], at: new Map() };
    const cost = t => (w.costOf ? w.costOf(t) : buildCost(t));
    const sellers = w.buildersOf(p),
      at = new Map();
    if (!sellers.length) return none;
    const craft = t =>
      (t._craft ||= [...new Set([...t.list('Squadron_Units'), ...t.list('Company_Units')])].map(n => db.type(n)).filter(Boolean));
    const kind = (t, cats) =>
      [t, ...craft(t)].some(x => {
        const c = x.categories();
        return cats.some(y => c.has(y) || (y === 'SPACEHERO' && c.has('HERO')));
      });
    const power = t => t.num('AI_Combat_Power', 0) || craft(t).reduce((a, x) => a + x.num('AI_Combat_Power', 0), 0);
    const tech = t => Math.max(0, t.num('Tech_Level', 0) || (craft(t)[0] ? craft(t)[0].num('Tech_Level', 0) : 0));
    const takes = (spec, t) => (spec.types ? spec.types.includes(t) : kind(t, spec.cats));
    for (const b of sellers)
      for (const t of w.buildOptions(b, p)) if (!at.has(t) && f.specs.some(s => takes(s, t)) && !w.cantBuild(b, t, p)) at.set(t, b);
    const open = [...at.keys()];
    const D = o.D,
      table = D && !D.ignoreTarget && o.t ? this.host.contrast() : null,
      cs = table ? [...table.keys()] : [];
    let T = null,
      thr = 1;
    const facs = new Map();
    const fac = t => {
      let a = facs.get(t);
      if (a) return a;
      const k = new Set();
      for (const x of [t, ...craft(t)]) for (const c of x.categories()) k.add(c);
      a = cs.map(c => {
        const en = table.get(c),
          v = en.types.get(t) ?? (craft(t)[0] ? en.types.get(craft(t)[0]) : undefined);
        if (v !== undefined) return v;
        let n = 0,
          sum = 0,
          one = false;
        for (const [kc, x] of en.kinds)
          if (k.has(kc)) {
            if (x === 1) one = true;
            else {
              n++;
              sum += x;
            }
          }
        return n ? sum / n : one ? 1 : 0;
      });
      if (this.host.land && this.host.terrainEffect) {
        const e = this.host.terrainEffect(t);
        if (e !== 1) for (let i = 0; i < a.length; i++) a[i] *= e;
      }
      facs.set(t, a);
      return a;
    };
    if (cs.length) {
      const fails = o.fails || 0,
        scale = (D.max + fails * D.perFail) * this.contrastScale(o.ai),
        g = o.t,
        mind = o.mind;
      thr = 1 - (fails * D.perFail + D.min) / (fails * D.perFail + D.max);
      const about = c => (mind && mind.at ? mind.at(g, true, 'force', c ? [c] : null, 0) : 0);
      const own = c => {
        const u = g.unit;
        if (!u || g.zone) return about(c);
        const parts = u.isSquad ? u.fighters : u.members || [u];
        const k = new Set([
          ...(typeof u.cats === 'function' ? u.cats() : (lead(u) || u).type.categories()),
          ...(u.isSquad ? [u.isBomber ? 'BOMBER' : 'FIGHTER'] : [])
        ]);
        if (c && !k.has(c)) return 0;
        let n = 0;
        for (const x of parts) n += Math.max(0, x.type.num('AI_Combat_Power', 0));
        return n;
      };
      const by = o.escort ? about : own,
        E = cs.map(c => by(c) * scale),
        tot = by(null);
      T = { E, R: E.slice(), tot, left: tot, can: open.some(t => fac(t).some((x, i) => x > 0 && E[i] > 0)) };
    }
    const met = () => !T || !T.can || !T.R.some(x => x > 0);
    const filled = f.specs.map(() => 0),
      picks = new Map(),
      chosen = [],
      lineOf = [];
    let spent = 0,
      pop = 0;
    const room = t => {
      if (spent + cost(t) > p.credits) return false;
      const n = picks.get(t) || 0,
        limit = t.num('Build_Limit_Current_Per_Player', 0);
      if (isUpgradeType(t)) return n < 1;
      if (limit > 0 && w.ownedCount(p, t.name) + w.queuedCount(p, t) + n >= limit) return false;
      const v = t.num('Population_Value', 0);
      return !(v > 0 && p.pop + w.queuedPop(p) + pop + v > p.popCap);
    };
    for (;;) {
      let cands = open.filter(t => room(t) && f.specs.some((s, i) => takes(s, t) && filled[i] < s.max));
      if (!cands.length) break;
      const rest = cands.filter(t => (picks.get(t) || 0) / chosen.length < 0.5);
      if (chosen.length && rest.length) cands = rest;
      let best = null,
        top = -Infinity,
        row = -1;
      for (const t of cands) {
        const li = f.specs.findIndex((s, i) => takes(s, t) && filled[i] < s.max);
        let s = 0.4 * tech(t) + (li >= 0 ? 1 - filled[li] / f.specs[li].max : 0),
          r = -1;
        if (!T) s += (simRandom() * power(t)) / 500;
        else {
          const fc = fac(t),
            P = power(t);
          let g = 0;
          for (let i = 0; i < cs.length; i++) {
            const R = T.R[i],
              x = fc[i] * P;
            if (!(R > 0) || !(x > 0)) continue;
            const v = fc[i] * (1 - (Math.max(R - x, 0) / Math.max(R, x)) ** 2);
            if (v > g) {
              g = v;
              r = i;
            }
          }
          if (g > 0) s += 2 * g;
          else if (
            !met() ||
            !(
              D.extraCost > 0 ||
              (T.left > 0 && fc.some(x => x > 0)) ||
              f.specs.some((sp, i) => takes(sp, t) && filled[i] < sp.min) ||
              (Array.isArray(required) &&
                required.some(line => {
                  const q = String(line)
                    .split('|')
                    .map(x => x.trim().toUpperCase())
                    .filter(Boolean);
                  return q.length && kind(t, q) && !chosen.some(x => kind(x, q));
                }))
            )
          )
            continue;
        }
        if (s > top) {
          top = s;
          best = t;
          row = r;
        }
      }
      if (!best) break;
      if (T) {
        const P = power(best);
        if (row >= 0) T.R[row] -= fac(best)[row] * P;
        T.left -= P;
      }
      const lines = f.specs.map((s, i) => i).filter(i => takes(f.specs[i], best) && filled[i] < f.specs[i].max);
      const line = lines[Math.floor(simRandom() * lines.length)];
      filled[line]++;
      lineOf.push(line);
      picks.set(best, (picks.get(best) || 0) + 1);
      chosen.push(best);
      spent += cost(best);
      if (!isUpgradeType(best)) pop += best.num('Population_Value', 0);
    }
    if (f.specs.some((s, i) => filled[i] < s.min)) return none;
    if (T && T.can && chosen.length) {
      if (T.tot > 0 && T.left / T.tot > thr) return none;
      for (let i = 0; i < cs.length; i++) if (T.E[i] > 0 && T.R[i] / T.E[i] > thr) return none;
    }
    for (const line of Array.isArray(required) ? required : []) {
      const cats = String(line)
        .split('|')
        .map(x => x.trim().toUpperCase())
        .filter(Boolean);
      if (cats.length && !chosen.some(t => kind(t, cats))) return none;
    }
    const order = chosen.map((t, i) => i).sort((a, b) => lineOf[a] - lineOf[b] || a - b);
    return { chosen: order.map(i => chosen[i]), at };
  }

  at(v) {
    if (v && v.__force) {
      const u = v.__force.units.filter(e => !gone(e));
      if (!u.length) return null;
      return { x: u.reduce((a, e) => a + e.x, 0) / u.length, y: u.reduce((a, e) => a + e.y, 0) / u.length };
    }
    return this.host.at(v);
  }

  block(done, result = () => true, recipe = null, born = this.world.time) {
    return {
      __wrap: true,
      __name: 'Block',
      __block: recipe && { recipe, born },
      Is_Valid: () => true,
      IsFinished: () => this.world.time > born && !!done(),
      Result: () => result(),
      __missing: this.host.absent('Block')
    };
  }

  waitFor(r, born = this.world.time) {
    const w = this.world,
      f = r.f,
      inst = f.inst,
      p = inst.ai.player;
    const alive = () => (f.units = f.units.filter(e => !gone(e) && e.aiPlan === inst));
    switch (r.k) {
      case 'now':
        return this.block(
          () => true,
          () => r.r,
          r,
          born
        );
      case 'gone':
        return this.block(() => gone(r.x) || !alive().length, undefined, r, born);
      case 'move':
        return this.block(
          () => {
            const now = alive();
            this.settle(f);
            return !now.length || now.every(e => !f.moving.has(e));
          },
          undefined,
          r,
          born
        );
      case 'bought':
        return this.block(
          () => !r.types.some(t => w.queuedCount(p, t, false) > 0) || !r.st || r.st.dead,
          () => true,
          r,
          born
        );
      case 'deploy':
        return this.block(
          () =>
            w.time - r.t0 > 20 ||
            alive().every(e =>
              (e.members || []).every(
                u => !u || u.dead || !u.abilityKinds || !u.abilityKinds.has('DEPLOY') || (r.want ? u.deployed : !u.setup)
              )
            ),
          () => true,
          r,
          born
        );
      case 'bomb':
        return this.block(
          () => !!r.why || w.time - r.t0 > 12,
          () => (r.why ? 0 : 1),
          r,
          born
        );
      case 'build':
        return this.block(() => !r.pad.padChild || !r.pad.padChild.construction, undefined, r, born);
      case 'reinforce':
        return this.reinforceWait(f, r.at, r.until, born, r.keep);
      case 'tgt':
        this.claim(r);
        return this.block(
          () => this.checkTarget(r) || !alive().length,
          () => undefined,
          r,
          born
        );
      case 'exp':
        this.claim(r);
        return this.block(
          () => this.checkExplore(r),
          () => undefined,
          r,
          born
        );
      case 'amb':
        this.claim(r);
        return this.block(
          () => this.checkAmbush(r),
          () => r.result,
          r,
          born
        );
    }
    return this.block(
      () => true,
      () => false,
      { f, k: 'now', r: false },
      born
    );
  }

  reinforceWait(f, at, until, born = this.world.time, keep) {
    const w = this.world,
      inst = f.inst,
      p = inst.ai.player,
      recipe = { f, k: 'reinforce', at, until };
    if (this.host.land) {
      if (keep === undefined) {
        keep = inst.removable !== false;
        inst.removable = false;
      }
      recipe.keep = keep;
      return this.block(
        () => {
          if (
            f.pool.length &&
            w.time <= until &&
            w.landEntry(p, f.pool[f.pool.length - 1], at, q => {
              if (q && !gone(q) && inst.state !== 'over') {
                f.take(q);
                if (D.on) this.dbg('reinforce', inst, f.name + ' brought in ' + nameOf(q) + ' at ' + targetOf(at));
              }
            })
          )
            f.pool.pop();
          if (!f.pool.length) inst.removable = recipe.keep;
          return !f.pool.length || w.time > until;
        },
        () => !f.pool.length,
        recipe,
        born
      );
    }
    const st = { r: w.insidePrevention(p, at) ? 1000 : 0 };
    return this.block(
      () => {
        if (f.pool.length && w.time <= until) {
          const e = w.reinforceStep(p, f.pool, at, st);
          if (e) {
            f.take(e);
            w.recountPop();
            if (D.on) this.dbg('reinforce', inst, f.name + ' brought in ' + nameOf(e) + ' at ' + targetOf(at));
          }
        }
        return !f.pool.length || w.time > until;
      },
      () => !f.pool.length,
      recipe,
      born
    );
  }

  moved(f, us) {
    const o = (f.owners ||= new Map());
    for (const e of us) {
      f.moving.add(e);
      o.set(e, e.player);
    }
  }

  settle(f) {
    const inst = f.inst,
      o = f.owners;
    for (const e of f.moving) {
      if (gone(e) || e.aiPlan !== inst || (o && o.has(e) && o.get(e) !== e.player) || this.host?.diversions?.get(e)?.length) {
        f.moving.delete(e);
        if (o) o.delete(e);
      } else if (idle(e)) {
        f.moving.delete(e);
        if (o) o.delete(e);
        (f.arrived ||= []).push(e);
      }
    }
  }

  signal(e, name, extra) {
    const inst = e && e.aiPlan,
      f = inst && inst.forces && inst.forces.find(x => x.units.includes(e));
    if (!f) return;
    const s = (f.signals ||= []);
    if (!s.some(x => x[0] === name && x[1] === e && x[2] === extra)) s.push([name, e, extra]);
  }

  free(inst) {
    return inst.ai.mine().filter(e => !e.aiPlan && !e.noAI && !this.host.locked(e) && (inst.flags?.engaged || idle(e)));
  }

  handler(inst, name) {
    if (inst.env === undefined) return null;
    const c = (inst.fns ||= new Map());
    if (!c.has(name)) c.set(name, this.host.vm.ref(inst.env, name));
    return c.get(name);
  }

  say(inst, name, ...params) {
    const r = this.handler(inst, name);
    if (r) inst.events.push({ fn: r, params });
    return !!r;
  }

  tell(inst, f, event, ...params) {
    return this.say(inst, f.name + '_' + event, ...params) || this.say(inst, 'Default_' + event, ...params);
  }

  queueOnce(inst, f, event, params) {
    const r = this.handler(inst, f.name + '_' + event) || this.handler(inst, 'Default_' + event);
    if (!r || inst.events.some(ev => ev.fn === r)) return false;
    inst.events.push({ fn: r, params: params() });
    return true;
  }

  neutral(q) {
    return !q || q === this.world.neutral || q.id < 0 || !!q.faction?.bool?.('Is_Neutral');
  }

  enemy(t, p) {
    const o = this.host.owner(t);
    return !this.neutral(o) && !this.neutral(p) && o.team !== p.team;
  }

  hidden(t, p) {
    const w = this.world,
      u = lead(t);
    if (!w.fog || !u || !w.canSee) return false;
    const T = u.type;
    if (T.bool('Last_State_Visible_Under_FOW') || T.bool('Initial_State_Visible_Under_FOW')) return false;
    return !w.canSee(p, t);
  }

  hit(t, from, loss) {
    const e = t.squad || t,
      inst = e.aiPlan;
    if (!inst || !inst.forces || inst.state !== 'run' || gone(e) || !from || from.dead) return;
    const f = inst.forces.find(x => x.units.includes(e));
    if (!f) return;
    const a = from.squad || from,
      aim = a.isSquad ? a.target : from.target,
      deliberate = !!aim && (aim === e || aim === t || aim.squad === e);
    if (!gone(a)) this.queueOnce(inst, f, 'Unit_Damaged', () => [f.wrapper, this.host.wrap(e), this.host.wrap(a), deliberate]);
    if (
      loss > 0 &&
      !t.squad &&
      t.type.behaviors().has('DAMAGE_TRACKING') &&
      from.type.bool('Is_Valid_Target', true) &&
      from.type.bool('Collidable_By_Projectile_Living')
    ) {
      const k = (t.threats ||= { map: new Map(), next: this.world.time + 1 });
      k.map.set(a, (k.map.get(a) || 0) + loss);
    }
  }

  decayThreats(inst, f, e) {
    const k = e.threats;
    if (!k || !k.map.size) return;
    const w = this.world,
      step = db.constants.num('AI_SpaceThreatDecayStep', 0.05),
      drop = ((e.maxHealth || 0) + (e.maxShield || 0)) * step;
    while (k.next <= w.time && k.map.size) {
      k.next += 1;
      for (const [a, v] of k.map) {
        if (v - drop > 0) k.map.set(a, v - drop);
        else {
          k.map.delete(a);
          if (!k.map.size) this.tell(inst, f, 'Unit_No_Threat', f.wrapper, this.host.wrap(e));
        }
      }
    }
    if (!k.map.size) k.next = w.time + 1;
  }

  claim(r) {
    for (const e of r.us) e.planBlock = r;
    const inst = r.f.inst;
    if (!(inst.blocks ||= []).includes(r)) inst.blocks.push(r);
  }

  members(r) {
    const inst = r.f.inst;
    return (r.us = r.us.filter(e => !gone(e) && e.aiPlan === inst && e.planBlock === r));
  }

  aimTarget(r) {
    const t = r.x;
    if (r.mode !== 'g' && r.hp >= 0 && r.hp < 11) {
      r.cur = t && !gone(t) ? weakestHardpoint(t, r.hp) : null;
      if (!r.cur) {
        r.hears = false;
        r.done = true;
        return;
      }
    }
    const us = this.members(r);
    r.pend = us.slice();
    if (!us.length || !t || gone(t)) return;
    if (r.mode === 'g') this.host.cmd.guard(us, t, r.through);
    else this.host.cmd.attack(us, t, r.cur || null, r.through);
  }

  reached(e, t, mode) {
    if (idle(e)) return true;
    const u = lead(e),
      T = lead(t);
    if (!u || !T) return true;
    const R =
      mode === 'g'
        ? (T.radius || 60) + (u.radius || 0) + 180
        : Math.max(u.maxRange || 0, u.engageRange || 0, (u.weapon && u.weapon.range) || 0, 300) + (T.hitRadius || 0);
    return (u.x - T.x) ** 2 + (u.y - T.y) ** 2 <= R * R;
  }

  checkTarget(r) {
    const w = this.world,
      f = r.f,
      inst = f.inst,
      p = inst.ai.player;
    if (r.done) return true;
    if (r.seenAt === w.time) return false;
    r.seenAt = w.time;
    const us = this.members(r),
      t = r.x;
    if (!us.length) return (r.done = true);
    if (r.hears) {
      if (gone(t)) {
        r.hears = false;
        r.done = true;
        for (const g of inst.forces) this.tell(inst, g, 'Current_Target_Destroyed', g.wrapper);
        return true;
      }
      const o = this.host.owner(t);
      if (o !== r.owner) {
        r.hears = false;
        r.owner = o;
        const foe = this.enemy(t, p);
        if (r.mode === 'g' ? foe : !foe) return (r.done = true);
      }
    }
    if (r.cur && (gone(t) || (r.cur.destroyable && !r.cur.alive))) {
      if (!r.rep) return (r.done = true);
      this.aimTarget(r);
      if (r.done) return true;
    }
    if (r.pend.length) {
      const left = [];
      for (const e of r.pend)
        if (!us.includes(e)) continue;
        else if (gone(t) || this.reached(e, t, r.mode)) (f.arrived ||= []).push(e);
        else left.push(e);
      r.pend = left;
      if (!left.length) {
        if (!t || gone(t)) r.done = true;
        else if (r.mode !== 'g' && (!this.enemy(t, p) || !attackable(t))) r.done = true;
        else if (this.hidden(t, p)) r.done = true;
      }
    }
    return r.done;
  }

  seenGrid(p) {
    const w = this.world,
      G = (this.seenGrids ||= new Map());
    let g = G.get(p);
    if (!g) {
      const c = db.constants,
        cell = Math.max(50, c.num('DesiredSpaceFOWCellSize', 100) * Math.max(1, c.num('AI_FogCellsPerThreatCell', 4)));
      const nx = Math.max(1, Math.ceil((w.max.x - w.min.x) / cell)),
        ny = Math.max(1, Math.ceil((w.max.y - w.min.y) / cell));
      g = { cell, nx, ny, at: new Float64Array(nx * ny).fill(-1), next: -Infinity };
      G.set(p, g);
    }
    if (w.time < g.next) return g;
    g.next = w.time + 1;
    const { cell, nx, ny, at } = g,
      x0 = w.min.x,
      y1 = w.max.y,
      now = w.time;
    for (const u of w.units) {
      if (u.dead || u.hyper || u.player !== p || !(u.revealRange > 0)) continue;
      const R = u.revealRange,
        c0 = Math.max(0, Math.floor((u.x - R - x0) / cell)),
        c1 = Math.min(nx - 1, Math.floor((u.x + R - x0) / cell)),
        r0 = Math.max(0, Math.floor((y1 - (u.y + R)) / cell)),
        r1 = Math.min(ny - 1, Math.floor((y1 - (u.y - R)) / cell));
      for (let row = r0; row <= r1; row++) {
        const cy = y1 - (row + 0.5) * cell,
          dy = (cy - u.y) ** 2;
        for (let col = c0; col <= c1; col++) {
          const cx = x0 + (col + 0.5) * cell;
          if ((cx - u.x) ** 2 + dy <= R * R) at[row * nx + col] = now;
        }
      }
    }
    return g;
  }

  explorePick(r) {
    const w = this.world,
      p = r.f.inst.ai.player,
      us = this.members(r);
    r.repick = false;
    const t = r.x && !gone(r.x) ? r.x : null;
    if (!us.length || (!t && !r.at) || !w.fog) return void (r.done = true);
    let rect;
    if (t) {
      const u = lead(t),
        R = (u && (u.maxRange || (u.weapon && u.weapon.range))) || 0;
      rect = [t.x - R, t.y - R, R + R, R + R];
    } else {
      const S = db.constants.num('AI_SpaceEvaluatorRegionSize', 2000);
      rect = [r.at.x - S / 2, r.at.y - S / 2, S, S];
    }
    const g = this.seenGrid(p),
      { cell, nx, ny, at } = g;
    const c0 = Math.max(0, Math.floor((rect[0] - w.min.x) / cell)),
      c1 = Math.min(nx - 1, Math.floor((rect[0] - w.min.x + rect[2]) / cell)),
      r0 = Math.max(0, Math.floor((w.max.y - (rect[3] + rect[1])) / cell)),
      r1 = Math.min(ny - 1, Math.floor((w.max.y - rect[1]) / cell));
    let before = r.start,
      pick = null;
    for (let row = r0; row <= r1; row++)
      for (let col = c0; col <= c1; col++) {
        const x = (col + 0.5) * cell + w.min.x,
          y = w.max.y - (row + 0.5) * cell;
        if (x < w.min.x || x > w.max.x || y < w.min.y || y > w.max.y) continue;
        const s = at[row * nx + col];
        if (s >= w.time - 1.5) continue;
        if (s < before) {
          before = s;
          pick = { x, y };
        }
      }
    if (!pick) return void (r.done = true);
    this.host.cmd.move(us, pick.x, pick.y, false, true);
    r.goal = pick;
  }

  checkExplore(r) {
    if (r.done) return true;
    const us = this.members(r);
    if (!us.length) return (r.done = true);
    if (!r.repick && us.some(e => idle(e))) r.repick = true;
    if (r.repick) this.explorePick(r);
    return r.done;
  }

  ambushPoint(r) {
    const w = this.world,
      t = r.x;
    if (!t || gone(t)) return null;
    const u = lead(t),
      a = u.heading || 0,
      sn = Math.sin(a),
      cs = Math.cos(a);
    const D = [
        [cs, sn],
        [-sn, cs],
        [sn, -cs],
        [-cs, -sn]
      ][r.dir],
      T = t.isSquad ? t.type : u.scriptType || u.type;
    let R = T.num('Space_FOW_Reveal_Range', 0);
    if (!(R > 0)) R = db.constants.num('AI_SpaceEvaluatorRegionSize', 2000);
    let x = t.x + r.dist * D[0],
      y = t.y + r.dist * D[1];
    const cx = (w.min.x + w.max.x) / 2,
      cy = (w.min.y + w.max.y) / 2,
      hx = (w.max.x - w.min.x) / 2,
      hy = (w.max.y - w.min.y) / 2,
      mind = r.f.inst.ai.mind;
    for (;;) {
      if (Math.abs(x - cx) > hx || Math.abs(y - cy) > hy) return null;
      const th = mind && mind.at ? mind.at({ rect: { x: x - R / 2, y: y - R / 2, w: R, h: R } }, true, 'force', null, 0) : 0;
      if (th <= r.tol) return { x, y };
      x += D[0] * R;
      y += D[1] * R;
    }
  }

  ambushPlan(r) {
    r.last = this.world.time;
    const P = this.ambushPoint(r);
    if (!P) {
      r.done = true;
      r.result = false;
      return;
    }
    r.lists = true;
    const us = this.members(r);
    for (const e of us) if (!r.pend.includes(e)) r.pend.push(e);
    if (!us.length) return;
    this.host.cmd.move(us, P.x, P.y, false, true);
    r.goal = P;
  }

  checkAmbush(r) {
    if (r.done) return true;
    const f = r.f,
      us = this.members(r);
    if (r.hears && gone(r.x)) {
      r.hears = false;
      r.result = true;
      return (r.done = true);
    }
    const before = r.pend.length;
    r.pend = r.pend.filter(e => us.includes(e));
    if (!us.length || (before && !r.pend.length)) {
      r.result = us.length > 0;
      return (r.done = true);
    }
    for (const e of r.pend.slice())
      if (idle(e)) {
        r.pend.splice(r.pend.indexOf(e), 1);
        (f.arrived ||= []).push(e);
        if (!r.pend.length) {
          r.result = true;
          return (r.done = true);
        }
      }
    if (this.world.time - r.last > 5) this.ambushPlan(r);
    return r.done;
  }

  chase(e, x) {
    const p = e.player,
      st = { pend: true };
    this.host.cmd.attack([e], x);
    return this.block(() => {
      if (gone(e) || gone(x) || !this.enemy(x, p)) return true;
      if (st.pend && this.reached(e, x, 'a')) {
        st.pend = false;
        if (!attackable(x) || this.hidden(x, p)) return true;
      }
      return false;
    });
  }

  spaceOrder(f, kind, v, us, o) {
    const host = this.host,
      inst = f.inst,
      p = inst.ai.player;
    let t = host.of(v);
    if (kind === 'guard' && v && v.__force) {
      const g = v.__force,
        list = g.units.filter(e => !gone(e) && e.aiPlan === g.inst);
      if (!list.length) return undefined;
      t = list[Math.floor(simRandom() * list.length)];
    }
    if (t && gone(t)) return undefined;
    const x = t && t.isPad && kind !== 'guard' ? t.padChild : t;
    if (x && !gone(x) && (kind === 'attack' || (kind === 'amove' && this.enemy(x, p)) || kind === 'guard')) {
      if (kind === 'attack' && !this.enemy(x, p)) return this.waitFor({ f, k: 'now', r: false });
      if (us.includes(x)) return undefined;
      const r = {
        f,
        k: 'tgt',
        mode: kind === 'guard' ? 'g' : kind === 'amove' ? 'm' : 'a',
        x,
        hp: kind === 'attack' ? o.hp ?? -1 : -1,
        rep: kind === 'amove' || !!o.rep,
        through: kind === 'guard' ? 0 : o.through | 0,
        us: us.slice(),
        pend: [],
        owner: host.owner(x),
        hears: true,
        done: false
      };
      this.claim(r);
      this.aimTarget(r);
      if (r.done) return undefined;
      return this.waitFor(r);
    }
    if (kind === 'attack') return this.waitFor({ f, k: 'now', r: false });
    const at = this.at(v);
    if (!at) return this.waitFor({ f, k: 'now', r: false });
    const attack = kind === 'amove';
    host.cmd.move(us, at.x, at.y, attack, !attack, o.through | 0);
    this.moved(f, us);
    const r = { f, k: 'move', at: { x: at.x, y: at.y }, us: us.slice() };
    for (const e of us) e.planBlock = r;
    return this.waitFor(r);
  }

  force(f) {
    const host = this.host,
      w = this.world,
      inst = f.inst,
      ai = inst.ai,
      p = ai.player;
    const alive = () => (f.units = f.units.filter(e => !gone(e) && e.aiPlan === inst));
    const here = () => this.at(wrapper);
    const take = (f.take = e => {
      for (const b of bodies(e)) if (b && b.attackPositioning) b.attackPositioning = false;
      e.aiPlan = inst;
      e.fsKind = null;
      if (e.order && e.order.fs) e.order.fs = false;
      f.units.push(e);
      f.had = true;
    });
    const go = (kind, v, attack, tol, zonePath, o = null) => {
      const t = host.of(v),
        at = this.at(v),
        us = alive();
      if (o && us.length) return this.spaceOrder(f, kind, v, us, o);
      if (!us.length || (!t && !at)) return this.waitFor({ f, k: 'now', r: false });
      if (zonePath === true && host.land && (kind === 'move' || kind === 'attack')) {
        const b = byZones(kind, v, t, at, attack, tol);
        if (b) return b;
      }
      if (kind === 'attack' && t && !gone(t)) {
        const x = t.isPad ? t.padChild : t;
        if (!host.land && (!x || gone(x) || x.player.team === p.team)) return this.waitFor({ f, k: 'now', r: false });
        host.cmd.attack(us, t);
        return this.waitFor({ f, k: 'gone', x: x || t });
      }
      if (kind === 'guard' && t && !gone(t)) {
        host.cmd.guard(us, t);
        return this.waitFor({ f, k: 'gone', x: t });
      }
      const spot = at || { x: t.x, y: t.y };
      host.cmd.move(us, spot.x, spot.y, !!attack, !attack);
      this.moved(f, us);
      return this.waitFor({ f, k: 'move', at: { x: spot.x, y: spot.y } });
    };
    const avoid = a => (typeof a === 'string' ? collisionBits(a) || 0 : 0);
    const attackArgs = a => {
      const n = a.length + 1,
        o = { hp: -1, rep: false, through: 0 };
      let i = 0;
      if (a.length && typeof a[0] === 'string') {
        const k = hardpointKind(a[0]);
        if (k >= 0) o.hp = k;
        else if (a[0] === 'Random') {
          const r = Math.floor(simRandom() * 14);
          o.hp = r === 13 ? -1 : r;
        } else if (n === 2) {
          const b = collisionBits(a[0]);
          if (b === null) return null;
          o.through = b;
        } else return null;
        i = 1;
      } else if (n >= 2 && n !== 2 && n !== 3) return null;
      if (i < a.length && typeof a[i] === 'boolean') o.rep = a[i++];
      if (i < a.length && typeof a[i] === 'number') o.threat = a[i++];
      if (i < a.length) {
        const b = typeof a[i] === 'string' ? collisionBits(a[i]) : null;
        if (b === null) return null;
        o.through = b;
      }
      return o;
    };
    const explore = v => {
      const us = alive(),
        t = host.of(v),
        at = !t && v && v.__pos ? { x: v.x, y: v.y } : null;
      if (!t && !at) return undefined;
      const r = { f, k: 'exp', x: t, at, us: us.slice(), start: w.time, done: false, repick: false };
      this.claim(r);
      this.explorePick(r);
      return this.waitFor(r);
    };
    const ambush = (v, dir, far, tol) => {
      const t = host.of(v),
        d = AMBUSH_DIRS[String(dir ?? '').toUpperCase()];
      if (!t || gone(t) || d === undefined || typeof dir !== 'string' || !(+far > 0) || typeof tol !== 'number') return undefined;
      const r = { f, k: 'amb', x: t, dir: d, dist: +far, tol, us: alive().slice(), pend: [], last: w.time, lists: false, hears: true, result: false, done: false };
      this.claim(r);
      this.ambushPlan(r);
      return this.waitFor(r);
    };
    const byZones = (kind, v, t, at, attack, tol) => {
      const L = w.w,
        mind = ai.mind;
      if (!L || !L.map || !mind || !mind.zoneOf) return null;
      const here0 = here(),
        goalAt = t && !gone(t) ? { x: t.x, y: t.y } : at;
      let cur = here0 && mind.zoneOf(here0.x, here0.y);
      const end = goalAt && mind.zoneOf(goalAt.x, goalAt.y);
      if (!cur || !end || cur === end) return null;
      const Z = zonePaths(L.map),
        threshold = (Number.isFinite(+tol) && tol !== undefined ? +tol : 1e18) * 2;
      let leg = null,
        last = null,
        failed = false;
      const plan = () => {
        const us = alive();
        if (!us.length) return;
        if (cur !== end) {
          let linkMask = -1;
          for (const q of us) for (const u of q.members || []) linkMask &= L.maskOf(u.need || 1);
          const way = Z.route(cur, end, { threat: zoneThreat(mind), threshold, weight: 1, linkMask });
          if (!way) {
            failed = true;
            return;
          }
          if (way.length > 2) {
            const nz = way[1];
            leg = { x: nz.x, y: nz.y };
            cur = nz;
            host.cmd.move(us, leg.x, leg.y, !!attack, !attack);
            this.moved(f, us);
            return;
          }
        }
        leg = null;
        last = go(kind, v, attack);
      };
      plan();
      return this.block(
        () => {
          if (failed) return true;
          if (last) return last.IsFinished();
          const now = alive();
          if (!now.length) return true;
          this.settle(f);
          if (now.every(e => !f.moving.has(e))) plan();
          return failed;
        },
        () => !failed && (!last || last.Result()),
        { f, k: 'move', at: { x: goalAt.x, y: goalAt.y } }
      );
    };
    const openPads = () => {
      const all = w.openPads ? w.openPads(p) : w.units.filter(u => !u.dead && u.isPad && !u.padChild && u.padOwner === p),
        t = inst.thing;
      return t && t.isPad ? all.filter(u => u === t) : all;
    };
    const reserved = () => {
      if (f.pads) return f.pads.filter(u => w.buildOptions(u, p).length);
      const jobs = this.builds.get(inst.key) || [],
        at = inst.thing && inst.thing.x !== undefined ? inst.thing : null,
        free = (w.openPads ? w.openPads(p) : w.units.filter(u => !u.dead && u.isPad && !u.padChild && u.padOwner === p)).slice(),
        offers = (u, t) => w.buildOptions(u, p).includes(t) && !w.cantBuild(u, t, p),
        tech = t => Math.max(0, t.num('Tech_Level', 0)),
        power = t => Math.max(0, t.num('AI_Combat_Power', 0));
      f.pads = [];
      f.padTypes = [];
      if (!at) return f.pads;
      let spent = 0;
      for (const job of jobs)
        for (let n = 0; n < job.max; n++) {
          let best = null,
            top = -Infinity;
          for (const t of job.types) {
            if (spent + (w.costOf ? w.costOf(t) : buildCost(t)) > p.credits || !free.some(u => offers(u, t))) continue;
            const v = 0.4 * tech(t) + (1 - n / job.max) + (simRandom() * power(t)) / 500;
            if (v > top) {
              top = v;
              best = t;
            }
          }
          if (!best) break;
          let pad = null,
            d = Infinity;
          for (const u of free) {
            if (!offers(u, best)) continue;
            const e = (u.x - at.x) ** 2 + (u.y - at.y) ** 2;
            if (e < d) {
              d = e;
              pad = u;
            }
          }
          free.splice(free.indexOf(pad), 1);
          spent += w.costOf ? w.costOf(best) : buildCost(best);
          f.pads.push(pad);
          f.padTypes.push(best);
        }
      return f.pads;
    };
    const wrapper = {
      __wrap: true,
      __force: f,
      __name: f.name,
      Is_Valid: () => true,
      Get_Force_Count: () => alive().length,
      Get_Unit_Table: () => alive().map(e => host.wrap(e)),
      Are_All_Units_On_Free_Store: () => !(f.pool && f.pool.length),
      Get_Distance: v => {
        const a = here(),
          b = this.at(v);
        return a && b ? dist(a, b) : 1e9;
      },
      Get_Self_Threat_Max: () => Math.max(0, ...alive().map(e => ai.value(e))),
      Get_Self_Threat_Sum: () => alive().reduce((a, e) => a + ai.value(e), 0),
      Get_Stage: () => {
        const D = this.defs.get(inst.key);
        if (!inst.thing || (D && (!D.freeStore || D.magic))) return undefined;
        const z = inst.stage;
        return z ? this.host.pos(z.x, z.y, 0, 'Position') : this.host.vm.read(inst.env, 'AITarget');
      },
      Produce_Force: () => {
        const bought = [],
          st = p.station;
        if (inst.flags?.buys) {
          if (f.specs.length) bought.push(...this.buy(inst, f));
        } else
          for (const e of (inst.staffed && inst.staffed.get(f.name)) || []) {
            if (e.pooled) {
              if (e.pooled.owner === inst && !f.pool.includes(e.pooled)) f.pool.push(e.pooled);
            } else if (!gone(e) && e.aiPlan === inst && !f.units.includes(e)) take(e);
          }
        if (bought.length) return this.waitFor({ f, k: 'bought', types: bought, st });
        return this.block(
          () => true,
          () => f.units.length > 0 || f.pool.length > 0,
          {
            f,
            k: 'now',
            get r() {
              return f.units.length > 0 || f.pool.length > 0;
            }
          }
        );
      },
      Fire_Special_Weapon: (name, v) => {
        const t = host.of(v),
          ty = db.type(String(name || ''));
        const sw = alive().find(e => e.isSpecialWeapon && (!ty || e.type === ty) && e.charge >= 0.99);
        if (!sw || !t || sw.fire(t.squad || t)) return undefined;
        if (D.on) this.dbg('ability', inst, nameOf(sw) + ' fires at ' + nameOf(t));
        return host.wrap(sw);
      },
      Collect_All_Free_Units: () => {
        for (const e of this.free(inst)) if (!f.units.includes(e)) take(e);
      },
      Release_Forces: () => {
        for (const e of f.units)
          if (e.aiPlan === inst) {
            e.aiPlan = null;
            unset(e);
          }
        f.units = [];
      },
      Release_Unit: v => {
        const e = host.of(v);
        if (e && e.aiPlan === inst) {
          e.aiPlan = null;
          unset(e);
        }
        f.units = f.units.filter(x => x !== e);
      },
      Withdraw_Units: () => {
        const ok = !!w.retreat && w.retreat.requestByPlan(w.retreatKey ? w.retreatKey(p) : p) === 0;
        if (D.on) this.dbg('retreat', inst, 'asks to retreat: ' + (ok ? 'begun' : 'refused'));
        return ok;
      },
      Reinforce: (v, most) => {
        if (host.land) {
          const at = this.at(v),
            E = w.landPool ? w.landPool(p) || [] : [];
          f.pool = f.pool.filter(x => x.owner === inst && E.includes(x));
          if (!at || !f.pool.length) return undefined;
          return this.reinforceWait(f, at, most > 0 ? w.time + +most : Infinity);
        }
        const at = this.at(v);
        f.pool = f.pool.filter(x => x.owner === inst && (p.aiPool || []).includes(x));
        if (!at || !f.pool.length || (w.skirmish && (!p.station || p.station.dead))) return undefined;
        return this.reinforceWait(f, at, most > 0 ? w.time + +most : Infinity);
      },
      Move_To: (v, tol, zones) =>
        host.land ? go('move', v, false, tol, zones) : go('move', v, false, tol, undefined, { through: avoid(zones) }),
      Attack_Move: (v, tol, zones) =>
        host.land ? go('move', v, true, tol, zones) : go('amove', v, true, tol, undefined, { through: avoid(zones) }),
      Explore_Area: v => (host.land ? go('move', v, false) : explore(v)),
      Prepare_Ambush: (v, dir, far, tol) => (host.land ? go('move', v, false) : ambush(v, dir, far, tol)),
      Attack_Target: (v, ...rest) => {
        if (host.land) return go('attack', v, false, rest[0], rest[1]);
        const o = attackArgs(rest);
        return o ? go('attack', v, false, undefined, undefined, o) : undefined;
      },
      Guard_Target: v => {
        if (host.land) return go('guard', v);
        const t = host.of(v);
        if (!(v && v.__force) && !t) return go('move', v, false, undefined, undefined, {});
        return go('guard', v, false, undefined, undefined, {});
      },
      Activate_Ability: (name, on) => {
        for (const e of alive()) {
          const ok = host.wrap(e).Activate_Ability(name, on);
          if (ok === false) this.tell(inst, f, 'Unit_Ability_Finished', wrapper, host.wrap(e));
        }
        if (!host.land || String(name || '').toUpperCase() !== 'DEPLOY') return undefined;
        return this.waitFor({ f, k: 'deploy', want: on !== false, t0: w.time });
      },
      Set_Plan_Result: ok => {
        inst.result = ok !== false;
      },
      Set_As_Goal_System_Removable: on => {
        inst.removable = on !== false;
      },
      Enable_Attack_Positioning: on => {
        if (!host.land) for (const e of alive()) for (const b of bodies(e)) if (b) b.attackPositioning = !!on;
      },
      Set_Targeting_Priorities: (name, kind) => {
        const set = namedSet(name),
          want = String(kind || '')
            .split('|')
            .map(s => s.trim().toUpperCase())
            .filter(Boolean);
        if (!set) return;
        for (const e of alive()) {
          const lead = bodies(e)[0],
            t = lead && (lead.scriptType || lead.type);
          if (!t || (want.length && !want.some(k => t.categories().has(k) || t.name.toUpperCase() === k))) continue;
          for (const b of bodies(e)) if (b) b.prioSet = set;
        }
      },
      Block_Goal_Proposal: () => {
        inst.blocksGoals = true;
      },
      Unblock_Goal_Proposal: () => {
        inst.blocksGoals = false;
      },
      Fire_Orbital_Bombardment: v => {
        const at = this.at(v);
        if (at && w.orbitalBombard) {
          w.orbitalBombard(p, at.x, at.y);
          if (D.on) this.dbg('ability', inst, 'orbital bombardment at ' + targetOf(at));
        }
        return undefined;
      },
      Bombing_Run: v => {
        const at = this.at(v),
          why = at && w.bombingRun ? w.bombingRun(p, at.x, at.y) : 'none',
          t0 = w.time;
        if (D.on) this.dbg('ability', inst, 'bombing run at ' + targetOf(at) + (why ? ': refused (' + why + ')' : ''));
        return this.waitFor({ f, k: 'bomb', why: why || '', t0 });
      },
      Get_Reserved_Build_Pads: () => {
        if (this.builds.has(inst.key)) return reserved().map(u => host.wrap(u));
        const mine = f.specs.flatMap(x => x.types || []);
        return openPads()
          .filter(u => !mine.length || w.buildOptions(u, p).some(t => mine.includes(t)))
          .map(u => host.wrap(u));
      },
      Build: (type, pad) => {
        const t = (type && type.__type) || db.type(String(type || '')),
          u = host.of(pad),
          why = t && u ? w.startBuild(u, t, p) : 'no ' + (t ? 'pad' : 'type ' + type);
        if (D.on)
          this.dbg(
            'build',
            inst,
            (why ? 'refused ' : 'ordered ') + (t ? t.name : String(type)) + ' at ' + nameOf(u) + (why ? ' (' + why + ')' : '')
          );
        return !why ? this.waitFor({ f, k: 'build', pad: u }) : undefined;
      },
      Build_All: () => {
        const mine = f.specs.flatMap(s => s.types || []);
        let n = 0;
        const held = this.builds.has(inst.key);
        for (const u of held ? reserved() : openPads()) {
          const kept = held && f.padTypes ? f.padTypes[f.pads.indexOf(u)] : null;
          const can = kept
            ? [kept].filter(t => w.buildOptions(u, p).includes(t) && !w.cantBuild(u, t, p))
            : w.buildOptions(u, p).filter(t => (!mine.length || mine.includes(t)) && !w.cantBuild(u, t, p));
          if (!can.length) continue;
          const t = can[Math.floor(simRandom() * can.length)],
            why = w.startBuild(u, t, p);
          if (D.on) this.dbg('build', inst, (why ? 'refused ' : 'ordered ') + t.name + ' at ' + nameOf(u) + (why ? ' (' + why + ')' : ''));
          if (!why) n++;
        }
        return this.waitFor({ f, k: 'now', r: n > 0 });
      },
      Get_Goal_Type_Name: () => this.goalName.get(inst.goal) || inst.goal,
      Set_Single_Ability_Autofire: (name, on) => {
        for (const e of f.units) {
          const u = host.wrap(e);
          if (u && u.Set_Single_Ability_Autofire) u.Set_Single_Ability_Autofire(name, on);
        }
      },
      Set_All_Abilities_Autofire: on => {
        for (const e of f.units) host.wrap(e)?.Set_All_Abilities_Autofire?.(on);
      },
      Set_Targeting_Stickiness_Time_Threshold: (seconds, kind) => {
        const want = String(kind || '')
          .split('|')
          .map(s => s.trim().toUpperCase())
          .filter(Boolean);
        for (const e of f.units) {
          const lead = bodies(e)[0],
            t = lead && (lead.scriptType || lead.type);
          if (!t || (want.length && !want.some(k => t.categories().has(k) || t.name.toUpperCase() === k))) continue;
          host.wrap(e)?.Set_Targeting_Stickiness_Time_Threshold?.(seconds);
        }
      },
      Get_AI_Power_Vs_Unit: () => alive().reduce((n, e) => n + (host.wrap(e)?.Get_AI_Power_Vs_Unit?.() || 0), 0),
      Add_Force: v => {
        const e = host.of(v);
        if (e && !f.units.includes(e)) take(e);
      },
      Get_Type_Of_Unit: index => {
        const spec = f.def?.specs?.[Math.max(0, (+index || 1) - 1)] || f.specs?.[Math.max(0, (+index || 1) - 1)];
        const t = spec?.types?.[0];
        return t ? host.type(t) : undefined;
      },
      Find_Closest_Enemy: category => {
        const a = here();
        if (!a) return undefined;
        const cat = category ? String(category).toUpperCase() : '';
        let best = null,
          bd = Infinity;
        for (const u of w.units) {
          const q = u.player;
          if (u.dead || !q || !p || q === p || q.team === p.team || q.neutral || p.neutral) continue;
          if (cat && !u.type.categories().has(cat)) continue;
          const d = (u.x - a.x) ** 2 + (u.y - a.y) ** 2;
          if (d < bd) {
            bd = d;
            best = u;
          }
        }
        return best ? host.wrap(best.squad || best) : undefined;
      },
      Add_Opportunity_Fire_Event_Subscription: () => {},
      Remove_Opportunity_Fire_Event_Subscription: () => {},
      Clear_Opportunity_Fire_Event_Subscriptions: () => {},
      Can_Garrison: v => {
        const t = host.of(v);
        return !!(host.cmd.canGarrison && t && f.units.some(e => host.cmd.canGarrison(e, t)));
      },
      Garrison: v => {
        const t = host.of(v);
        if (host.cmd.garrison && t) for (const e of f.units) if (host.cmd.canGarrison(e, t)) host.cmd.garrison(e, t);
      },
      __missing: host.absent('TaskForce')
    };
    f.wrapper = wrapper;
    return wrapper;
  }

  poll(inst) {
    const host = this.host,
      w = this.world;
    const say = (name, ...params) => this.say(inst, name, ...params);
    const tell = (f, event, ...params) => this.tell(inst, f, event, ...params);
    const t = inst.thing && inst.thing.type ? inst.thing : null;
    const lost = t && gone(t) && !inst.toldLost;
    if (lost) inst.toldLost = true;
    let moved = null;
    if (t && !host.land && !lost && !inst.toldLost) {
      const o = host.owner(t);
      if (inst.thingOwner === undefined) inst.thingOwner = o;
      else if (o !== inst.thingOwner) {
        moved = [host.player(inst.thingOwner), host.player(o)];
        inst.thingOwner = o;
      }
    }
    if (inst.blocks && inst.blocks.length) {
      for (const r of inst.blocks.slice())
        if (r.k === 'tgt') this.checkTarget(r);
        else if (r.k === 'exp') this.checkExplore(r);
        else if (r.k === 'amb') this.checkAmbush(r);
      inst.blocks = inst.blocks.filter(r => !r.done);
    }
    for (const f of inst.forces) {
      f.units = f.units.filter(e => !gone(e) && e.aiPlan === inst);
      if (lost) {
        say(f.name + '_Target_Destroyed');
        tell(f, 'Original_Target_Destroyed', f.wrapper);
      }
      if (moved) tell(f, 'Original_Target_Owner_Changed', f.wrapper, moved[0], moved[1]);
      if (f.had && !f.units.length && !f.toldEmpty) {
        f.toldEmpty = true;
        tell(f, 'No_Units_Remaining');
      }
      this.settle(f);
      if (f.signals && f.signals.length) {
        const sent = f.signals;
        f.signals = [];
        for (const [name, e, extra] of sent)
          if (!gone(e) && e.aiPlan === inst)
            if (extra === undefined) tell(f, name, f.wrapper, host.wrap(e));
            else tell(f, name, f.wrapper, host.wrap(e), extra);
      }
      if (f.arrived && f.arrived.length) {
        const done = f.arrived;
        f.arrived = [];
        for (const e of done) if (!gone(e) && e.aiPlan === inst) tell(f, 'Unit_Move_Finished', f.wrapper, host.wrap(e));
      }
      for (const e of f.units) {
        const st = (f.state ||= new Map()).get(e) || { target: null, ready: new Set() };
        f.state.set(e, st);
        const lu = lead(e);
        let aim = null;
        if (lu) {
          for (const h of lu.hardpoints || [])
            if (h.isWeapon && h.target && !h.target.dead) {
              aim = h.target;
              break;
            }
          if (!aim && lu.target && !lu.target.dead && dist(lu, lu.target) <= (lu.maxRange || 0) + (lu.target.hitRadius || 0))
            aim = lu.target;
        }
        if (aim && aim !== st.target) {
          const t2 = host.wrap(aim.squad || aim);
          tell(f, 'Target_In_Range', f.wrapper, host.wrap(e), t2);
          say(f.name + '_Hardpoint_Target_In_Range', f.wrapper, host.wrap(e), t2);
        }
        st.target = aim;
        if (lu && lu.abilities)
          for (const s of lu.abilities) {
            const ok = !s.active && !(s.cooldown > 0),
              k = s.def.kind;
            if (ok && !st.ready.has(k) && st.seen) tell(f, 'Unit_Ability_Ready', f.wrapper, host.wrap(e), k);
            if (ok) st.ready.add(k);
            else st.ready.delete(k);
          }
        if (e.isSpecialWeapon) {
          const on = e.charge >= 0.99;
          if (on && st.seen && !st.online) tell(f, 'Special_Weapon_Online', f.wrapper, host.wrap(e));
          st.online = on;
        }
        st.seen = true;
        if (!host.land) {
          this.decayThreats(inst, f, e);
          continue;
        }
        const u = lead(e),
          total = u ? u.health + (u.shield || 0) : 0,
          was = f.seen.get(e);
        if (was && total < was.total - 1 && w.time - was.told > 3) {
          was.told = w.time;
          let foe = null,
            bd = 1e18;
          for (const o of w.units) {
            if (o.dead || o.player.id < 0 || o.player.team === e.player.team) continue;
            const d = dist(o, e);
            if (d < bd) {
              bd = d;
              foe = o;
            }
          }
          tell(f, 'Unit_Damaged', f.wrapper, host.wrap(e), host.wrap(foe && foe.squad ? foe.squad : foe), false);
        }
        f.seen.set(e, { total, told: was ? was.told : -99 });
      }
    }
  }

  update() {
    const w = this.world;
    if (!this.host.land && w.fog && w.units) for (const inst of this.live) if (inst.ai && inst.ai.player) this.seenGrid(inst.ai.player);
    for (const inst of this.live) {
      if (inst.state === 'run' && (inst.purged || w.time - inst.born > 900)) {
        this.host.drop(inst);
        inst.state = 'over';
      }
      if (inst.state === 'run' && !inst.flags?.buys && inst.forces.some(f => f.specs.length)) {
        if (inst.forces.some(f => f.units.some(e => !gone(e) && e.aiPlan === inst) || (f.pool && f.pool.length))) inst.emptySince = null;
        else if ((inst.emptySince ??= w.time) < w.time - 8) {
          this.host.drop(inst);
          inst.state = 'over';
        }
      }
      if (inst.state !== 'over') continue;
      this.refund(inst);
      for (const f of inst.forces)
        for (const e of f.units)
          if (e.aiPlan === inst) {
            e.aiPlan = null;
            unset(e);
          }
      for (const x of (this.host.land ? w.landPool && w.landPool(inst.ai.player) : inst.ai.player.aiPool) || [])
        if (x.owner === inst) x.owner = null;
      for (const list of inst.staffed ? inst.staffed.values() : []) for (const e of list) if (e.aiPlan === inst) e.aiPlan = null;
      if (D.on)
        this.dbg(
          'plan',
          inst,
          'ended ' +
            inst.name +
            ': ' +
            (inst.stolen
              ? 'lost a unit to a goal wanted more'
              : inst.result === true
                ? 'succeeded'
                : 'failed' + (inst.purged ? ' (nothing left to do)' : w.time - inst.born > 900 ? ' (ran too long)' : '')) +
            ' after ' +
            Math.round(w.time - inst.born) +
            's'
        );
      if (this.onEnd) this.onEnd(inst);
      if (!inst.flags?.buys && inst.forces.some(f => f.specs.length) && !inst.forces.some(f => f.had) && inst.ai.tried && inst.tryKey)
        inst.ai.tried.set(inst.tryKey, w.time + 20);
      if (this.host.errors.has(inst.name) && w.time - inst.born < 5) this.failed.set(inst.goal, (this.failed.get(inst.goal) || 0) + 1);
    }
    this.live = this.live.filter(i => i.state !== 'over');
  }
}
