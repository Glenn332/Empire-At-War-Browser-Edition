import { db } from '../gamedata.js';
import { buildCost, isUpgradeType } from './sim.js';
import { fetchText } from '../vfs.js';
import { simRandom } from './simrandom.js';
import { zonePaths, zoneThreat } from './landzones.js';
import { namedSet } from './priorities.js';
import { aidebug as D, who, group, targetOf, nameOf } from '../aidebug.js';

const lead = e => (e && e.isSquad ? e.fighters[0] : e);
const gone = e => !e || e.dead || (e.isSquad && !e.fighters.length);
const bodies = e => (e.isSquad ? e.fighters : e.members) || [e];
const unset = e => {
  if (e)
    for (const b of bodies(e)) {
      if (b && b.prioSet) b.prioSet = undefined;
      if (b && b.attackPositioning) b.attackPositioning = false;
    }
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const idle = e => !e.order || e.order.kind === 'idle' || !!e.order.fs || (!!e.fsKind && e.fsKind === e.order.kind);
const SERVICE = 0.5;

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
    this.sleepBy = null;
    this.contrastBy = [1, 1, 1];
    this.otherMode = new Set();
    this.needs = new Map();
    this.builds = new Map();
    this.goalName = new Map();
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
    const adj = await fetchText('Data/XML/DifficultyAdjustments.xml').catch(() => null);
    if (adj) {
      const v = [...adj.matchAll(new RegExp('<' + (host.land ? 'Land' : 'Space') + '_AI_Contrast_Multiplier>\\s*([\\d.]+)', 'gi'))].map(
        m => +m[1]
      );
      if (v.length >= 3) this.contrastBy = v.slice(0, 3);
      const z = [
        ...adj.matchAll(new RegExp('<' + (host.land ? 'Land' : 'Space') + '_AI_Goal_Cycle_Sleep_Duration>\\s*([\\d.]+)', 'gi'))
      ].map(m => +m[1]);
      if (z.length >= 3) this.sleepBy = z.slice(0, 3);
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
    const list = this.byGoal.get(String(goal).toUpperCase()) || [],
      w = this.world;
    return list.some(key => {
      const jobs = this.builds.get(key);
      if (jobs) {
        const mine = jobs.flatMap(j => j.types),
          pads = w.openPads ? w.openPads(ai.player) : w.units.filter(u => !u.dead && u.isPad && !u.padChild && u.padOwner === ai.player);
        return pads.some(u => w.buildOptions(u, ai.player).some(t => mine.includes(t) && !w.cantBuild(u, t, ai.player)));
      }
      if (thing && thing.isSite) return w.buildOptions(thing, ai.player).some(t => !w.cantBuild(thing, t, ai.player));
      const b = this.buys.get(key);
      if (b) return b.bare || this.choose(ai.player, b.specs, b.required).chosen.length > 0;
      return !!this.staff(ai, key, thing, { ...o, all: true });
    });
  }

  staff(ai, key, thing, o = {}) {
    const hf0 = e => {
      let h = 0,
        m = 0;
      for (const u of e.isSquad ? e.fighters : e.members || [e]) {
        h += u.health || 0;
        m += u.maxHealth || 0;
      }
      return m > 0 ? h / m : 1;
    };
    const D = this.defs.get(key),
      got = new Map(),
      w0 = this.world;
    if (!D || D.magic || !D.freeStore) return got;
    const lines = [];
    for (const f of D.forces)
      for (const sp of f.specs)
        if (!(sp.types && sp.types.every(t => t.has('Tactical_Buildable_Constructed'))))
          lines.push({ s: sp, f, n: 0, fit: 0, escort: f.flags.has('ESCORTFORCE') });
    if (!lines.length) return got;
    const mind = o.mind || ai.mind || null,
      t = o.t || (thing && thing.type ? { unit: thing, x: thing.x, y: thing.y } : thing) || null;
    const at = t && t.x !== undefined ? t : null;
    const stolen = e => {
      const v = e.aiPlan;
      return o.desire !== undefined && !!v.plan && v.ai === ai && v.removable !== false && v.gd !== undefined && v.gd < o.desire;
    };
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
    for (const e of pool) {
      if (hf0(e) < floor) continue;
      if (heroesAttach && !e.isSpecialWeapon && scriptedHero(e)) continue;
      if (e.noAI || gone(e) || this.host.locked(e) || !(o.all || !e.aiPlan || stolen(e)) || !(D.engaged || idle(e))) continue;
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
        h += u.health || 0;
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
    for (const e of units) if (e.pooled) dOf.set(e, maxD);
    for (const l of lines) if (l.s.pct && l.s.pct < 100) l.fit = units.filter(e => mine.get(e).includes(l)).length;
    const room = l => (l.s.pct ? l.s.pct >= 100 || l.n < Math.ceil((l.fit * l.s.pct) / 100) : l.n < l.s.max);
    const table = D.ignoreTarget ? null : this.host.contrast() || new Map(),
      cs = table ? [...table.keys()] : [];
    const fails = o.fails || 0,
      lv = String(ai.difficulty || (ai.player && ai.player.difficulty) || 'normal').toLowerCase();
    const scale = (D.max + fails * D.perFail) * this.contrastBy[lv === 'easy' ? 0 : lv === 'hard' ? 2 : 1],
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
        const l = open[k % open.length];
        let sc = (l.s.pct ? 1 : 1 - l.n / l.s.max) + (maxD > 0 ? 1 - dOf.get(e) / maxD : 0) + (tech(e) / 5) * 2,
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
    const key = list[Math.floor(simRandom() * list.length)];
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
    const robbed = new Set();
    for (const list of staffed.values())
      for (const e of list) {
        if (e.pooled) {
          e.pooled.owner = inst;
          continue;
        }
        const v = e.aiPlan;
        if (v && v !== inst) {
          if (v.staffed && [...v.staffed.values()].some(l => l.includes(e))) robbed.add(v);
          for (const f of v.forces) f.units = f.units.filter(x => x !== e);
          unset(e);
        }
        e.aiPlan = inst;
      }
    for (const v of robbed) {
      v.stolen = true;
      this.stop(v);
    }
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
      target = !t ? undefined : t.type ? host.wrap(t) : host.pos(t.x, t.y, 0);
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

  buy(inst, f) {
    const w = this.world,
      p = inst.ai.player,
      got = this.choose(p, f.specs, inst.flags.required);
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

  choose(p, specs, required) {
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
        top = -Infinity;
      for (const t of cands) {
        const s = 0.4 * tech(t) + (simRandom() * power(t)) / 500;
        if (s > top) {
          top = s;
          best = t;
        }
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
            return !now.length || now.every(e => idle(e) || dist(e, r.at) < 350);
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
        return this.reinforceWait(f, r.at, r.until, born);
    }
    return this.block(
      () => true,
      () => false,
      { f, k: 'now', r: false },
      born
    );
  }

  reinforceWait(f, at, until, born = this.world.time) {
    const w = this.world,
      inst = f.inst,
      p = inst.ai.player,
      recipe = { f, k: 'reinforce', at, until };
    if (this.host.land)
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
          return !f.pool.length || w.time > until;
        },
        () => !f.pool.length,
        recipe,
        born
      );
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

  free(inst) {
    return inst.ai.mine().filter(e => !e.aiPlan && !e.noAI && !this.host.locked(e) && (inst.flags.engaged || idle(e)));
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
    const go = (kind, v, attack, tol, zonePath) => {
      const t = host.of(v),
        at = this.at(v),
        us = alive();
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
      for (const e of us) f.moving.add(e);
      return this.waitFor({ f, k: 'move', at: { x: spot.x, y: spot.y } });
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
            for (const e of us) f.moving.add(e);
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
          if (now.every(e => idle(e) || dist(e, leg) < 350)) plan();
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
        mine = jobs.flatMap(x => x.types),
        most = Math.max(
          1,
          jobs.reduce((a, x) => a + x.max, 0)
        );
      const at = inst.thing && inst.thing.x !== undefined ? inst.thing : null;
      const every = w.openPads ? w.openPads(p) : w.units.filter(u => !u.dead && u.isPad && !u.padChild && u.padOwner === p);
      const can = every.filter(u => w.buildOptions(u, p).some(t => mine.includes(t) && !w.cantBuild(u, t, p)));
      if (at) can.sort((a, b) => (a.x - at.x) ** 2 + (a.y - at.y) ** 2 - (b.x - at.x) ** 2 - (b.y - at.y) ** 2);
      return (f.pads = can.slice(0, most));
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
      Get_Stage: () => undefined,
      Produce_Force: () => {
        const bought = [],
          st = p.station;
        if (inst.flags.buys) {
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
      Move_To: (v, tol, zones) => go('move', v, false, tol, zones),
      Attack_Move: (v, tol, zones) => go('move', v, true, tol, zones),
      Explore_Area: v => go('move', v, false),
      Prepare_Ambush: v => go('move', v, false),
      Attack_Target: (v, tol, zones) => go('attack', v, false, tol, zones),
      Guard_Target: v => go('guard', v),
      Activate_Ability: (name, on) => {
        for (const e of alive()) host.wrap(e).Activate_Ability(name, on);
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
        for (const u of this.builds.has(inst.key) ? reserved() : openPads()) {
          const can = w.buildOptions(u, p).filter(t => (!mine.length || mine.includes(t)) && !w.cantBuild(u, t, p));
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
      vm = host.vm,
      w = this.world;
    const fn = name => {
      const c = (inst.fns ||= new Map());
      if (!c.has(name)) c.set(name, vm.ref(inst.env, name));
      return c.get(name);
    };
    const say = (name, ...params) => {
      const r = fn(name);
      if (r) inst.events.push({ fn: r, params });
      return !!r;
    };
    const tell = (f, event, ...params) => say(f.name + '_' + event, ...params) || say('Default_' + event, ...params);
    const t = inst.thing && inst.thing.type ? inst.thing : null;
    const lost = t && gone(t) && !inst.toldLost;
    if (lost) inst.toldLost = true;
    for (const f of inst.forces) {
      f.units = f.units.filter(e => !gone(e) && e.aiPlan === inst);
      if (lost) {
        say(f.name + '_Target_Destroyed');
        tell(f, 'Original_Target_Destroyed', f.wrapper);
      }
      if (f.had && !f.units.length && !f.toldEmpty) {
        f.toldEmpty = true;
        tell(f, 'No_Units_Remaining');
      }
      for (const e of f.units) {
        if (f.moving.has(e) && idle(e)) {
          f.moving.delete(e);
          tell(f, 'Unit_Move_Finished', f.wrapper, host.wrap(e));
        }
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
    for (const inst of this.live) {
      if (inst.state === 'run' && (inst.purged || w.time - inst.born > 900)) {
        this.host.drop(inst);
        inst.state = 'over';
      }
      if (inst.state === 'run' && !inst.flags.buys && inst.forces.some(f => f.specs.length)) {
        if (inst.forces.some(f => f.units.some(e => !gone(e) && e.aiPlan === inst) || (f.pool && f.pool.length))) inst.emptySince = null;
        else if ((inst.emptySince ??= w.time) < w.time - 8) {
          this.host.drop(inst);
          inst.state = 'over';
        }
      }
      if (inst.state !== 'over') continue;
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
