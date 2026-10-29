import { db } from '../gamedata.js';
import { Mind, target } from './landbrain.js';
import { simRandom } from './simrandom.js';
import { zonePaths, zoneThreat } from './landzones.js';
import { aidebug as D, who, goalTarget } from '../aidebug.js';

export const FLAG = { GLOBAL: 0x10, FRIENDLY_UNIT: 0x20, ENEMY_UNIT: 0x40, FRIENDLY_STRUCTURE: 0x80, ENEMY_STRUCTURE: 0x100, TACTICAL_LOCATION: 0x200,
  FRIENDLY_BUILD_PAD: 0x400, ENEMY_BUILD_PAD: 0x800, FRIENDLY_CASH_POINT: 0x1000, ENEMY_CASH_POINT: 0x2000, FRIENDLY_REINFORCEMENT_POINT: 0x4000, ENEMY_REINFORCEMENT_POINT: 0x8000 };
const SWEEP = 5;

export class GoalSystem {
  constructor() { this.sides = new Map(); this.mode = 'LAND'; }

  state(side) {
    let S = this.sides.get(side);
    if (!S) this.sides.set(side, (S = { phase: 'idle', pairs: [], at: 0, owed: 0, proposed: new Map(), mind: null, mindAt: -1, wake: 0, learn: new Map(), seenAt: new Map(), sight: null, blocks: new Map(), on: null, log: [] }));
    return S;
  }

  mind(side, S) {
    const w = this.env(side).w;
    if (!S.mind || w.time - S.mindAt > 0.5 || w.time < S.mindAt) { S.mind = this.newMind(side, S); S.mindAt = w.time; }
    return S.mind;
  }

  switches(side, S, mind) {
    const brain = this.env(side).brain, names = (brain.player && brain.player[this.mode.toLowerCase()]) || [];
    const live = names.map(n => brain.templates.get(n.toUpperCase())).filter((t,i) => t && (brain.player.defaultFirst&&i===0 || mind.fn(t.trigger || 'ONE', null) > 0 && !(t.untrigger && mind.fn(t.untrigger, null) > 0)));
    live.sort((a, b) => a.priority - b.priority);
    const cats = new Map(), goals = new Map(), budget = new Map(), tactical = new Map();
    for (const t of live) {
      for (const c of t.on.cats) cats.set(c, true);
      for (const c of t.off.cats) cats.set(c, false);
      for (const gname of t.on.goals) goals.set(gname, true);
      for (const gname of t.off.goals) goals.set(gname, false);
      for (const [c, eq] of t.budget) budget.set(c, eq);
      for (const [c, share] of t.tactical || []) tactical.set(c, share);
    }
    S.on = { cats, goals, budget, tactical };
  }

  isOn(S, name, def) { const v = S.on.goals.get(name); return v !== undefined ? v : S.on.cats.get(def.category) === true; }

  failures(S, kind, goal, t) {
    const list = S.learn.get(kind + '|' + goal + '|' + (t ? t.key : ''));
    if (!list) return 0;
    const now = this.now;
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) { if (list[i] >= 0 && list[i] < now) list.splice(i, 1); else n++; }
    return n;
  }
  remember(S, kind, goal, t, secs) {
    if (!secs) return;
    const k = kind + '|' + goal + '|' + (t ? t.key : '');
    if (!S.learn.has(k)) S.learn.set(k, []);
    S.learn.get(k).push(secs < 0 ? -1 : this.now + secs);
  }

  active(cmdr) { return this.plans.live.filter(p => p.ai === cmdr && p.state !== 'over' && p.gdef); }

  blocked(S, cmdr, name) {
    for (const p of this.active(cmdr)) if (p.gdef.exclusions.includes(name)) return true;
    return false;
  }

  likeOn(list, def, name, t) {
    const key = t ? t.key : '';
    return list.some(p => p.tkey === key && (p.goal === name || def.like.includes(p.goal)));
  }

  tick(side, dt) {
    const E = this.env(side);
    if (!E || !E.brain || !E.brain.defs || !E.P || !E.P.ready || !E.cmdr) return false;
    const { w, brain, cmdr, P } = E, S = this.state(side);
    this.now = w.time; this.plans = P;
    if (!P.onEnd) P.onEnd = inst => this.ended(inst);
    const late = () => (this.deadline !== undefined && performance.now() > this.deadline) || (this.budget !== undefined && this.budget <= 0);
    if (this.active(cmdr).some(p => p.blocksGoals)) { S.phase = 'idle'; S.selecting = null; S.wake = w.time + 1; return true; }
    if (S.phase === 'idle') {
      if (w.time < S.wake || late()) return true;
      const mind = this.mind(side, S);
      if (cmdr.look) cmdr.look(mind, []);
      this.switches(side, S, mind);
      S.pairs = []; S.at = 0; S.owed = 0; S.proposed = new Map();
      if (this.budget !== undefined) this.budget -= 5;
      for (const [name, def] of brain.defs) {
        if (def.mode && def.mode !== this.mode) continue;
        if (!brain.fnOf.has(name) || !this.isOn(S, name, def) || !P.can(name)) continue;
        for (const t of this.targets(side, def.bits)) S.pairs.push(name, t);
      }
      S.phase = 'sweep';
    }
    if (S.phase === 'sweep') {
      const total = S.pairs.length / 2, ais = Math.max(1, E.ais || 1);
      S.owed += total / SWEEP * dt;
      const mind = this.mind(side, S), act = this.active(cmdr);
      for (; S.owed >= 1 && S.at < total && !late(); S.owed--, S.at++) {
        if (this.budget !== undefined) this.budget--;
        const name = S.pairs[S.at * 2], t = S.pairs[S.at * 2 + 1], def = brain.defs.get(name);
        if (t && t.unit && (t.unit.dead || t.unit.gone)) continue;
        if (this.blocked(S, cmdr, name) || this.likeOn(act, def, name, t)) continue;
        const d = Math.min(1e18, mind.desire(name, t) + this.failures(S, 'plan', name, t) * def.perFailure + this.failures(S, 'start', name, t) * def.perStartFailure);
        if (!(d > 0)) continue;
        if (!this.reachable(def, t, mind)) continue;
        if (!P.staffable(cmdr, name, this.thingOf(t), { mind, t, fails: this.failures(S, 'plan', name, t) })) continue;
        const key = name + '|' + (t ? t.key : ''), had = S.proposed.get(key);
        if (!had || d > had.d) S.proposed.set(key, { name, t, d, def });
      }
      if (S.at >= total && !late()) {
        if (this.deadline === undefined && this.budget === undefined) { this.select(side, S, cmdr, P); S.phase = 'idle'; S.wake = w.time + this.rest(cmdr, brain, P); }
        else { S.selecting = this.selectSteps(side, S, cmdr, P); S.phase = 'select'; }
      }
    }
    if (S.phase === 'select') {
      if (!S.selecting) S.selecting = this.selectSteps(side, S, cmdr, P);
      while (!late()) { if (this.budget !== undefined) this.budget--; if (S.selecting.next().done) { S.selecting = null; S.phase = 'idle'; S.wake = w.time + this.rest(cmdr, brain, P); break; } }
    }
    return true;
  }

  get selecting() { for (const S of this.sides.values()) if (S.phase === 'select') return true; return false; }

  rest(cmdr, brain, P) {
    const lv = String(cmdr.difficulty || 'normal').toLowerCase(), by = P.sleepBy;
    return by ? by[lv === 'easy' ? 0 : lv === 'hard' ? 2 : 1] : brain.sleep ?? 1;
  }

  reachable() { return true; }

  held(d) { return d > 0.01 && d < 40 ? d + (1 - (d - 0.01) / 39.99) * 1.6 : d; }

  select(side, S, cmdr, P) { const steps = this.selectSteps(side, S, cmdr, P); while (!steps.next().done); }

  *selectSteps(side, S, cmdr, P) {
    const E = this.env(side), w = E.w, brain = E.brain, mind = this.mind(side, S);
    P.beginSelection?.(cmdr);
    const ext = Math.max(1, Math.min(5, (brain.player && brain.player.ext) || 2));
    const cats = [...S.on.budget].map(([c, eq]) => [c, mind.fn(String(eq).toUpperCase(), null)]).sort((a, b) => b[1] - a[1]);
    const wanted = [];
    const M = this.mode[0], unbegun = new Map(), dropped = (p, why) => { if (D.on) D.log('drop', M, w.time, who(cmdr), 'stopped ' + p.goal + ' on ' + goalTarget(p.tgt) + ': ' + why, 'plan'); };
    if (D.on && D.show.proposals && S.proposed.size) D.log('proposals', M, w.time, who(cmdr), 'pass of ' + S.pairs.length / 2 + ' goal-target pairs, ' + S.proposed.size + ' proposed; budgets ' + cats.map(([c, v]) => c + ' ' + (+v).toFixed(2)).join(', ') + (S.proposed.size ? '; most wanted: ' + [...S.proposed.values()].sort((a, b) => b.d - a.d).slice(0, 8).map(p => p.name + '@' + goalTarget(p.t) + ' ' + p.d.toFixed(1)).join(', ') : ''), 'plan');
    for (const [cat] of cats) {
      const running = this.active(cmdr).filter(p => p.gdef.category === cat);
      const fresh = [...S.proposed.values()].filter(p => p.def.category === cat).sort((a, b) => b.d - a.d);
      const best = fresh.length ? fresh[0].d : -Infinity;
      const kept = [], list = fresh.slice();
      for (const p of running) {
        const d = mind.desire(p.goal, p.tgt), eff = this.held(d);
        yield;
        if (eff <= 0 && p.removable !== false) { dropped(p, 'not wanted any more (desire ' + d.toFixed(1) + ')'); P.stop(p); continue; }
        p.gd = eff;
        if (eff >= best || p.removable === false) { if(P.retain?.(p)!==false)kept.push(p);else { dropped(p, 'its units are held by another plan'); P.stop(p); } }
        else list.push({ name: p.goal, t: p.tgt, d: eff, def: p.gdef, inst: p });
      }
      list.sort((a, b) => b.d - a.d);
      const cap = running.length + ext;
      const fits = c => this.isOn(S, c.name, c.def) && !this.likeOn(kept, c.def, c.name, c.t) && (c.inst ? P.canRetain?.(c.inst)!==false : P.staffable(cmdr, c.name, this.thingOf(c.t), { mind, t: c.t, fails: this.failures(S, 'plan', c.name, c.t) }));
      const take = c => {
        if (c.inst) { if(P.retain?.(c.inst)===false)return false;kept.push(c.inst);return true; }
        const inst = P.start(cmdr, c.name, this.thingOf(c.t), { mind, t: c.t, fails: this.failures(S, 'plan', c.name, c.t), desire: c.d });
        if (!inst) { if (D.on) { const n = unbegun.get(c.name); if (n) { n.n++; if (c.d > n.d) { n.d = c.d; n.t = goalTarget(c.t); } } else unbegun.set(c.name, { n: 1, d: c.d, t: goalTarget(c.t) }); } this.remember(S, 'start', c.name, c.t, c.def.startTrack); return false; }
        inst.gdef = c.def; inst.tgt = c.t; inst.tkey = c.t ? c.t.key : ''; inst.gside = side; inst.gsys = this;
        kept.push(inst);
        if (D.on) D.log('decision', M, w.time, who(cmdr), 'chose ' + c.name + ' (' + cat + ') on ' + goalTarget(c.t) + ', desire ' + c.d.toFixed(1) + ' -> plan ' + inst.name, 'plan');
        wanted.push([c.name, c.t && c.t.type ? c.t.type.name : c.t && c.t.zone ? 'zone' + c.t.zone.index : '', +c.d.toFixed(1)]);
        return true;
      };
      while (kept.length < cap && list.length) {
        const c = list[0], ok = fits(c);
        yield;
        if (!ok) { if (!c.inst) this.remember(S, 'start', c.name, c.t, c.def.startTrack); break; }
        list.shift();
        const took = take(c);
        yield;
        if (!took) break;
      }
      const aside = [];
      while (kept.length < cap && list.length) {
        let pick = null;
        while (list.length) {
          const sum = list.reduce((a, c) => a + Math.max(0, c.d), 0);
          let c = list[0];
          if (sum > 0) { let r = simRandom() * sum; c = list[list.length - 1]; for (const x of list) { r -= Math.max(0, x.d); if (r <= 0) { c = x; break; } } }
          list.splice(list.indexOf(c), 1);
          const ok = fits(c);
          yield;
          if (ok) { pick = c; break; }
          aside.push(c);
        }
        if (!pick) break;
        take(pick);
        yield;
      }
      list.push(...aside);
      for (const c of list) if (c.inst && !kept.includes(c.inst)) { dropped(c.inst, 'outbid by goals wanted more (desire ' + c.d.toFixed(1) + ')'); P.stop(c.inst); }
    }
    P.endSelection?.(cmdr);
    if (D.on) for (const [g, n] of unbegun) D.log('decision', M, w.time, who(cmdr), 'could not begin ' + g + ' on ' + (n.n > 1 ? n.n + ' targets (most wanted: ' + n.t + ', desire ' + n.d.toFixed(1) + ')' : n.t + ' (desire ' + n.d.toFixed(1) + ')') + ' - its plan could not be staffed or bought', 'plan');
    S.log = wanted.concat(S.log).slice(0, 30);
    S.last = { time: w.time, pairs: S.pairs.length / 2, proposed: S.proposed.size, cats: cats.map(c => c[0]) };
  }

  ended(inst) {
    if (!inst.gdef || inst.gside === undefined || inst.stolen) return;
    if (inst.gsys && inst.gsys !== this) return inst.gsys.ended(inst);
    const S = this.state(inst.gside);
    if (inst.result !== true) this.remember(S, 'plan', inst.goal, inst.tgt, inst.gdef.track);
  }
}

const REACH = ['NO_THREAT', 'LOW_THREAT', 'MEDIUM_THREAT', 'HIGH_THREAT', 'ANY_THREAT'];
const REACH_TOL = ['Low_Threat_Reachability_Tolerance', 'Medium_Threat_Reachability_Tolerance', 'High_Threat_Reachability_Tolerance'];

export class LandGoals extends GoalSystem {
  constructor(game) { super(); this.game = game; this.mode = 'LAND'; }

  reachable(def, t, mind) {
    if (!t || !t.zone || !def.reach) return true;
    const k = REACH.indexOf(def.reach);
    if (k < 0) return false;
    const tol = k === 0 ? 0 : k === 4 ? 1e18 : db.constants.num(REACH_TOL[k - 1], [1000, 3000, 5000][k - 1]);
    return zonePaths(this.game.world.map).reach(t.zone, { threshold: tol, threat: zoneThreat(mind) }).length > 0;
  }

  env(side) {
    const g = this.game, sc = g.scripts;
    if (!sc || sc.off) return null;
    return { w: g.world, brain: g.brains[side], cmdr: sc.commanders[side], P: sc.host.plans, ais: g.players.filter((p, i) => g.ai[i] && !p.human && i !== (g.me ?? 0)).length };
  }

  newMind(side, S) {
    const g = this.game, w = g.world;
    let mind = null;
    mind = new Mind(g.brains[side], w, side, { difficulty: g.players[side].difficulty || 'Normal', seen: t => this.lastSeen(S, mind, t), sees: (x, y) => this.seesNow(S, mind, x, y) });
    this.look(S, mind);
    return mind;
  }

  look(S, mind) {
    const w = this.game.world, gn = mind.gn, cell = mind.cell, now = w.time;
    let G = S.sight;
    if (!G || G.gn !== gn || G.cell !== cell) G = S.sight = { gn, cell, at: new Float64Array(gn * gn).fill(-Infinity), regrow: db.constants.num('LandFOWRegrowTime', 6) };
    const mark = (x, y, r) => {
      if (!(r > 0)) return;
      const x0 = Math.max(0, Math.floor((x - r) / cell)), x1 = Math.min(gn - 1, Math.floor((x + r) / cell)), y0 = Math.max(0, Math.floor((y - r) / cell)), y1 = Math.min(gn - 1, Math.floor((y + r) / cell)), r2 = r * r;
      for (let cy = y0; cy <= y1; cy++) {
        const dy = (cy + 0.5) * cell - y;
        for (let cx = x0; cx <= x1; cx++) { const dx = (cx + 0.5) * cell - x; if (dx * dx + dy * dy <= r2) G.at[cy * gn + cx] = now; }
      }
    };
    for (const q of w.squads) {
      if (q.side < 0 || !w.ally(q.side, mind.side)) continue;
      const u = q.members.find(m => !m.dead && !m.inside);
      if (u) mark(u.x, u.y, (u.sight ??= u.type.num('Land_FOW_Reveal_Range', 150)) * (u.structure ? 1 : w.sightMod(u)));
    }
    for (const p of w.points) if (p.side >= 0 && w.ally(p.side, mind.side)) mark(p.x, p.y, p.sight ??= p.type.num('Land_FOW_Reveal_Range', 250));
  }

  seesNow(S, mind, x, y) {
    const G = S.sight;
    if (!G) return false;
    const cx = Math.min(G.gn - 1, Math.max(0, Math.floor(x / G.cell))), cy = Math.min(G.gn - 1, Math.max(0, Math.floor(y / G.cell)));
    return this.game.world.time - G.at[cy * G.gn + cx] <= G.regrow;
  }

  lastSeen(S, mind, t) {
    const G = S.sight, now = this.game.world.time, z = t && mind.zone(t);
    if (!G || !z) return 0;
    const cells = mind.cellsOf(z);
    if (!cells.length) return 0;
    let sum = 0;
    for (const c of cells) { const shut = G.at[c] + G.regrow; if (now > shut) sum += Number.isFinite(shut) ? now - shut : now; }
    return sum / cells.length;
  }

  targets(side, bits) {
    const g = this.game, w = g.world, out = [];
    const mine = s => s >= 0 && w.ally(s, side);
    if (bits === FLAG.GLOBAL) return [null];
    if (bits & FLAG.TACTICAL_LOCATION) for (const z of w.map.zones || []) out.push(z.target || (z.target = target.zone(z)));
    if (bits & (FLAG.FRIENDLY_UNIT | FLAG.ENEMY_UNIT)) for (const q of w.squads) {
      if (!q.members.length || q.structure || q.arriving || q.members[0].inside || q.side < 0) continue;
      if (!q.members.some(u => u.type.bool('Has_Land_Evaluator'))) continue;
      if (bits & (mine(q.side) ? FLAG.FRIENDLY_UNIT : FLAG.ENEMY_UNIT)) out.push(target.unit(q.members.find(u => u.type.bool('Has_Land_Evaluator'))));
    }
    if (bits & (FLAG.FRIENDLY_STRUCTURE | FLAG.ENEMY_STRUCTURE)) for (const u of w.units) {
      if (!u.structure || u.dead || u.side < 0 && !u.house || !u.type.bool('Has_Land_Evaluator')) continue;
      if (bits & (mine(u.side) ? FLAG.FRIENDLY_STRUCTURE : FLAG.ENEMY_STRUCTURE)) out.push(target.unit(u));
    }
    if (bits & (FLAG.FRIENDLY_BUILD_PAD | FLAG.ENEMY_BUILD_PAD)) for (const s of w.sites) {
      if (s.base && !s.pad) continue;
      const owner = s.base ? s.side : s.point ? s.point.side : -1;
      if (bits & (mine(owner) ? FLAG.FRIENDLY_BUILD_PAD : FLAG.ENEMY_BUILD_PAD)) out.push(target.site(s, s.base ? s.pad : s.point && s.point.type));
    }
    if (bits & (FLAG.FRIENDLY_REINFORCEMENT_POINT | FLAG.ENEMY_REINFORCEMENT_POINT)) for (const p of w.points) {
      if (!p.reinforce || p.locked) continue;
      if (bits & (mine(p.side) ? FLAG.FRIENDLY_REINFORCEMENT_POINT : FLAG.ENEMY_REINFORCEMENT_POINT)) out.push(target.point(p));
    }
    return out;
  }

  thingOf(t) {
    const sc = this.game.scripts;
    if (!t) return null;
    if (t.zone) return { x: t.x, y: t.y };
    if (t.site) return sc.view.site(t.site);
    if (t.point) return sc.thing(t.point);
    if (t.unit) return sc.thing(t.unit);
    return { x: t.x, y: t.y };
  }

  findable(side, bits) {
    const S = this.state(side), w = this.game.world, fog = this.game.setup.fog !== false;
    return this.targets(side, bits & ~FLAG.GLOBAL).filter(t => !fog || t.zone || (t.owner >= 0 && w.ally(t.owner, side)) || this.seesNow(S, null, t.x, t.y));
  }
}
