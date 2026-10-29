import { db } from '../gamedata.js';
import { locate, recordAt } from './galacticstorysave.js';
import { strategicProductionKind } from './galacticproduction.js';
import { GalacticFreeStore } from './galacticfreestore.js';

const key = s => String(s || '').toUpperCase();
export const PLAN_SAVE_VERSION = 1;
const KINDS = new Set(['pt', 'ptf', 'pmk', 'pwl', 'pbk', 'pfs', 'pfsv']);

export function installPlanPersistence(plans) {
  const host = plans.host,
    hooks = host.persist.hooks;
  host.plans = plans;
  if (hooks.planned) return;
  hooks.planned = true;
  const { describe, resolve, boundTable } = hooks;
  hooks.describe = o => describePlan(host.plans, o) ?? describe(o);
  hooks.resolve = d => (KINDS.has(d.k) || d.pid !== undefined ? resolvePlan(host.plans, d) : resolve(d));
  hooks.boundTable = name =>
    /^p(env|loaded):/.test(name)
      ? plannedTable(host.plans, name)
      : /^fs(env|loaded):/.test(name)
        ? freeStoreTable(host.plans, name)
        : boundTable(name);
}

function freeStoreTable(plans, name) {
  const [kind, id] = name.split(':'),
    fs = plans.ai.freeStores.get(id);
  if (!fs?.inst || fs.inst.env == null) return null;
  const env = plans.host.persist.refValue(fs.inst.env).value,
    info = plans.vm.envInfo.get(env);
  return kind === 'fsenv' ? env : info?.loaded;
}

function plannedTable(plans, name) {
  const [kind, id] = name.split(':'),
    inst = plans.live.find(i => i.id === +id);
  if (!inst || inst.env == null) return null;
  const env = plans.host.persist.refValue(inst.env).value,
    info = plans.vm.envInfo.get(env);
  return kind === 'penv' ? env : info?.loaded;
}

function describePlan(plans, o) {
  if (o.__freeStore) return { k: 'pfs', f: key(o.__freeStore.owner) };
  if (o.__inst && o.__inst.freeStore) return { k: 'pfsv', f: key(o.__inst.freeStore.owner), w: o.__hostName };
  if (o.__inst && o.__inst.plan && o.__inst.id !== undefined) return { k: 'inst', pid: o.__inst.id, w: o.__hostName };
  if (o.__aitarget) return { k: 'pt', i: o.__planet.index };
  if (o.__force && o.__force.inst) return { k: 'ptf', id: o.__force.inst.id, f: o.__force.name };
  if (o.__markup) {
    const h = o.__markup;
    return { k: 'pmk', id: h.inst?.id, i: [...(h.inst?.markups || [])].indexOf(h) };
  }
  if (o.__weighted) return { k: 'pwl', t: o.__weighted.map(([t, w]) => [t.name, w]), g: o.__kinds.map(([n, w]) => [n, w]) };
  if (o.__spec) return { k: 'pbk', s: encodeSpec(plans, o.__spec) };
  return undefined;
}

function resolvePlan(plans, d) {
  const g = plans.game.galaxy,
    inst = id => plans.live.find(i => i.id === id);
  switch (d.k) {
    case 'pfs':
      return plans.ai.freeStores.get(d.f)?.wrapper();
    case 'pfsv':
      return plans.ai.freeStores.get(d.f)?.inst?.hostValues?.[d.w];
    case 'inst':
      return inst(d.pid)?.hostValues?.[d.w];
    case 'pt':
      return plans.target(g.planets[d.i]);
    case 'ptf':
      return inst(d.id)?.forces.find(f => f.name === d.f)?.wrapper;
    case 'pmk': {
      const h = [...(inst(d.id)?.markups || [])][d.i];
      return h && plans.markupObject(h);
    }
    case 'pwl': {
      const w = plans.weighted();
      for (const [n, x] of d.t) w.__weighted.push([db.type(n), x]);
      for (const [n, x] of d.g) w.__kinds.push([n, x]);
      return w;
    }
    case 'pbk':
      return plans.block(decodeSpec(plans, d.s));
  }
  return undefined;
}

const fleetsOf = g => g.fleets.filter(f => f.units.length);
const planetIndex = p => (p == null ? -1 : typeof p === 'number' ? p : p.index);

function encodeSpec(plans, s) {
  const g = plans.game.galaxy,
    force = f => ({ id: f.inst.id, f: f.name });
  const out = { k: s.k, born: s.born };
  switch (s.k) {
    case 'starbase':
      out.p = planetIndex(s.p);
      break;
    case 'assemble':
      out.force = force(s.force);
      break;
    case 'move':
      out.force = force(s.force);
      out.ticket = {
        space: s.ticket.space,
        planets: [...s.ticket.planets].map(planetIndex),
        active: s.ticket.active,
        cur: s.ticket === s.force.conflictCommand
      };
      break;
    case 'fleets': {
      const list = fleetsOf(g);
      out.fleets = s.fleets.map(f => list.indexOf(f)).filter(i => i >= 0);
      break;
    }
    case 'captured':
      out.p = planetIndex(s.p);
      out.owner = s.owner;
      break;
    case 'const':
      out.result = !!s.result;
      break;
    case 'engage':
      out.force = force(s.force);
      out.p = planetIndex(s.p);
      out.former = s.former;
      out.owner = s.owner;
      break;
    case 'spendable':
    case 'unallocated':
      out.inst = s.inst.id;
      out.amount = s.amount;
      break;
    case 'bonus':
      Object.assign(out, { owner: s.owner, name: s.name, p: planetIndex(s.p), amount: s.amount, end: s.end, applied: !!s.applied });
      break;
  }
  return out;
}

function decodeSpec(plans, d) {
  const g = plans.game.galaxy,
    planet = i => (i >= 0 ? g.planets[i] : undefined);
  const need = (x, what) => {
    if (x === undefined) throw new Error('a command of a saved plan waits on ' + what + ' that is not there');
    return x;
  };
  const force = r =>
    need(
      plans.live.find(i => i.id === r.id)?.forces.find(f => f.name === r.f),
      'a task force'
    );
  const s = { k: d.k, born: d.born };
  switch (d.k) {
    case 'starbase':
      s.p = planet(d.p);
      break;
    case 'assemble':
      s.force = force(d.force);
      break;
    case 'move':
      s.force = force(d.force);
      s.ticket =
        d.ticket.cur && s.force.conflictCommand
          ? s.force.conflictCommand
          : { space: d.ticket.space, planets: new Set(d.ticket.planets.map(planet)), active: d.ticket.active };
      break;
    case 'fleets': {
      const list = fleetsOf(g);
      s.fleets = d.fleets.map(i => list[i]).filter(Boolean);
      break;
    }
    case 'captured':
      s.p = need(planet(d.p), 'a planet');
      s.owner = d.owner;
      break;
    case 'const':
      s.result = d.result;
      break;
    case 'engage':
      s.force = force(d.force);
      s.p = need(planet(d.p), 'a planet');
      s.former = d.former;
      s.owner = d.owner;
      break;
    case 'spendable':
    case 'unallocated':
      s.inst = need(
        plans.live.find(i => i.id === d.inst),
        'a plan'
      );
      s.amount = d.amount;
      break;
    case 'bonus':
      Object.assign(s, { owner: d.owner, name: d.name, p: planet(d.p), amount: d.amount, end: d.end, applied: d.applied });
      break;
  }
  return s;
}

const planetOf = t => (t ? t.planet.index : -1);
function goalState(S, controller) {
  return {
    switches: controller?.planSwitches ? [...controller.planSwitches] : null,
    signature: controller?.planSwitchSignature ?? null,
    phase: S.phase === 'select' ? 'sweep' : S.phase,
    at: S.at,
    owed: S.owed,
    wake: S.wake,
    learn: [...S.learn].map(([k, l]) => [k, l.slice()]),
    log: S.log.map(r => r.slice()),
    last: S.last ? { ...S.last, cats: S.last.cats.slice() } : null,
    pairs: S.pairs.map((x, i) => (i % 2 ? planetOf(x) : x)),
    proposed: [...S.proposed].map(([k, p]) => [k, { name: p.name, t: planetOf(p.t), d: p.d }]),
    on: S.on ? { cats: [...S.on.cats], goals: [...S.on.goals], budget: [...S.on.budget] } : null
  };
}
function setGoalState(plans, side, S, saved) {
  const g = plans.game.galaxy,
    controller = plans.ai.controllers.get(side),
    brain = controller.brain;
  if (saved.switches) {
    controller.planSwitches = new Map(saved.switches);
    controller.planSwitchSignature = saved.signature;
  }
  const target = i => (i < 0 ? null : { key: i, planet: g.planets[i], type: g.planets[i].type });
  Object.assign(S, {
    phase: saved.phase,
    at: saved.at,
    owed: saved.owed,
    wake: saved.wake ?? 0,
    learn: new Map(saved.learn || []),
    log: saved.log || [],
    last: saved.last ?? null
  });
  S.pairs = saved.pairs.map((x, i) => (i % 2 ? target(x) : x));
  S.proposed = new Map(saved.proposed.map(([k, p]) => [k, { name: p.name, t: target(p.t), d: p.d, def: brain.defs.get(p.name) }]));
  S.on = saved.on && { cats: new Map(saved.on.cats), goals: new Map(saved.on.goals), budget: new Map(saved.on.budget) };
  S.mind = null;
  S.mindAt = -1;
}

export function savablePlans(plans) {
  const host = plans.host;
  if (host.running || host.current || host.vm.L.errorJmp) return [];
  return plans.live.filter(i => i.state === 'run' && i.plan && i.env != null && !i.running && i.id !== undefined);
}

export function savePlans(plans, live, rowIndex) {
  const host = plans.host,
    persist = host.persist,
    g = plans.game.galaxy,
    s = persist.begin();
  const rec = r => (r ? (r.dead ? { dead: 1 } : locate(host, r)) : null);
  const queueOf = q => {
    if (!q) return null;
    const kind = strategicProductionKind(q.type),
      i = g.planets[q.planet]?.production[kind].indexOf(q);
    return i >= 0 ? { p: q.planet, kind, i } : null;
  };
  const markTarget = t => (g.planets.includes(t) ? { p: t.index } : typeof t === 'string' ? { f: t } : { r: rec(t) });
  const thread = t => ({
    co: s.enc({ type: 8, value: t.co }),
    started: !!t.started,
    id: t.id ?? null,
    arg: s.js(t.arg),
    values: t.values ? s.js(t.values) : null
  });
  const entryOf = e => ({
    prod: !!e.production,
    type: e.type.name,
    rec: e.record ? rec(e.record) : null,
    force: e.force,
    fac: e.factory
      ? {
          p: e.factory.planet.index,
          time: e.factory.time,
          cost: e.factory.cost,
          base: e.factory.base,
          kind: e.factory.kind,
          travel: e.factory.travel,
          penalty: e.factory.penalty
        }
      : null
  });
  const instOf = inst => {
    return {
      id: inst.id,
      name: inst.name,
      faction: inst.ai.player.faction,
      goal: inst.goal,
      thing: planetIndex(inst.thing),
      tgt: inst.tgt ? planetIndex(inst.tgt.planet) : -1,
      gside: inst.gside ?? null,
      row: rowIndex(inst),
      requiredTime: inst.requiredTime,
      gd: inst.gd ?? null,
      retained: !!inst.retained,
      removable: inst.removable,
      result: inst.result,
      born: inst.born,
      next: inst.next,
      rate: inst.rate,
      exit: !!inst.exit,
      threadIds: inst.threadIds,
      testContrast: inst.testContrast ?? null,
      stolen: !!inst.stolen,
      stages: [...inst.stages].map(([n, p]) => [n, planetIndex(p)]),
      staffed: [...inst.staffed].map(([n, list]) => [n, list.map(entryOf)]),
      forces: inst.forces.map(f => ({
        name: f.name,
        units: f.units
          .filter(u => !u.dead)
          .map(rec)
          .filter(Boolean),
        moved: [...f.moved].map(rec).filter(Boolean),
        had: !!f.had,
        produced: !!f.produced,
        emptyNotified: !!f.emptyNotified,
        lastOwner: f.lastOwner,
        stage: planetIndex(f.stage),
        cc: f.conflictCommand
          ? { space: f.conflictCommand.space, planets: [...f.conflictCommand.planets].map(planetIndex), active: f.conflictCommand.active }
          : null,
        jobs: f.jobs
          .map(j => ({
            e: (inst.staffed.get(f.name) || []).indexOf(j.entry),
            stage: planetIndex(j.stage),
            rec: rec(j.record),
            q: queueOf(j.queue),
            complete: j.complete,
            failed: j.failed,
            orphan: j.orphan,
            allocated: j.allocated,
            created: j.created
          }))
          .filter(j => j.e >= 0)
      })),
      markups: [...(inst.markups || [])].map(h => ({ owner: h.owner, value: h.value, entries: h.entries.map(markTarget) })),
      env: s.enc(persist.refValue(inst.env)),
      threads: inst.threads.map(thread),
      events: inst.events.map(e => ({ fn: s.js(e.fn ?? null), params: s.js(e.params), release: !!e.release })),
      params: s.js(inst.params),
      values: s.js(inst.values)
    };
  };
  const insts = live.map(instOf);
  const fleets = fleetsOf(g),
    fleetForces = [];
  fleets.forEach((f, i) => {
    if (f.aiForce && live.includes(f.aiForce.inst)) fleetForces.push([i, f.aiForce.inst.id, f.aiForce.name]);
  });
  const out = {
    v: PLAN_SAVE_VERSION,
    sequence: plans.sequence,
    lastDispatch: plans.lastDispatch,
    pathDestination: planetIndex(plans.pathDestination),
    history: plans.history.slice(-100),
    insts,
    fleetForces,
    reservations: [...plans.reservations]
      .filter(([r, i]) => live.includes(i) && !r.dead)
      .map(([r, i]) => [rec(r), i.id])
      .filter(([r]) => r),
    goals: [...plans.ai.goals.sides].map(([side, S]) => [side, goalState(S, plans.ai.controllers.get(side))])
  };
  const stores = [...(plans.ai.freeStores?.values() || [])]
    .filter(f => f.state === 'run' && f.inst?.env != null && !f.c.player.dummy)
    .map(f => f.save(s, rec));
  out.freeStores = stores;
  out.lua = insts.length || stores.length ? s.end() : null;
  return out;
}

export function restorePlans(plans, data, rowsOf) {
  const host = plans.host,
    persist = host.persist,
    vm = host.vm,
    g = plans.game.galaxy,
    failed = [];
  plans.sequence = Math.max(plans.sequence, data.sequence || 0);
  plans.lastDispatch = data.lastDispatch ?? plans.lastDispatch;
  plans.history = (data.history || []).slice();
  if (data.pathDestination >= 0) plans.pathDestination = g.planets[data.pathDestination];
  for (const [side, saved] of data.goals || []) {
    if (!plans.ai.controllers.has(side)) continue;
    setGoalState(plans, side, plans.ai.goals.state(side), saved);
  }
  const place = d => {
    if (d && d.dead) return { dead: true, type: null, owner: null };
    const found = d ? recordAt(host, d) : null;
    return found ? found.record : null;
  };
  const made = [];
  for (const di of data.insts) {
    let inst = null;
    try {
      const controller = plans.ai.controllers.get(key(di.faction)),
        def = plans.defs.get(di.name),
        row = rowsOf(di.faction)?.[di.row];
      if (!controller) throw new Error('its computer player is gone');
      if (!def) throw new Error('its script is gone');
      if (!row) throw new Error('its budget is gone');
      inst = plans.instance(di.name);
      const planet = i => (i >= 0 ? g.planets[i] : null),
        target = planet(di.tgt);
      const entries = new Map(
        di.staffed.map(([n, list]) => [
          n,
          list.map(e => ({
            production: e.prod,
            type: db.type(e.type),
            record: place(e.rec),
            force: e.force,
            factory: e.fac
              ? {
                  planet: g.planets[e.fac.p],
                  time: e.fac.time,
                  cost: e.fac.cost,
                  base: e.fac.base,
                  kind: e.fac.kind,
                  travel: e.fac.travel,
                  penalty: e.fac.penalty
                }
              : null
          }))
        ])
      );
      Object.assign(inst, {
        id: di.id,
        ai: controller,
        goal: di.goal,
        thing: planet(di.thing),
        def,
        staffed: entries,
        stages: new Map(di.stages.map(([n, i]) => [n, planet(i)])),
        budget: row,
        requiredTime: di.requiredTime,
        gd: di.gd ?? undefined,
        plan: true,
        retained: di.retained,
        removable: di.removable,
        result: di.result,
        born: di.born,
        next: di.next,
        rate: di.rate,
        exit: di.exit,
        threadIds: di.threadIds,
        state: 'run'
      });
      if (di.testContrast !== null) inst.testContrast = di.testContrast;
      if (di.stolen) inst.stolen = true;
      if (di.gside !== null) {
        inst.gdef = controller.brain.defs.get(di.goal);
        inst.tgt = target ? { key: target.index, planet: target, type: target.type } : null;
        inst.tkey = target ? target.index : '';
        inst.gside = di.gside;
        inst.gsys = plans.ai.goals;
      }
      for (const fd of di.forces) {
        const definition = def.forces.find(f => f.name === fd.name);
        if (!definition) throw new Error('a task force of the script is gone');
        const force = {
          ...definition,
          inst,
          units: fd.units.map(place).filter(Boolean),
          entries: entries.get(fd.name) || [],
          jobs: [],
          stage: planet(fd.stage),
          had: fd.had,
          moved: new Set(fd.moved.map(place).filter(Boolean)),
          produced: fd.produced,
          lastOwner: fd.lastOwner
        };
        if (fd.emptyNotified) force.emptyNotified = true;
        if (fd.cc) force.conflictCommand = { space: fd.cc.space, planets: new Set(fd.cc.planets.map(planet)), active: fd.cc.active };
        force.wrapper = plans.force(force);
        inst.forces.push(force);
      }
      if (di.markups.length) {
        inst.markups = new Set();
        for (const m of di.markups) {
          const handle = {
            owner: m.owner,
            entries: m.entries.map(t => (t.p !== undefined ? g.planets[t.p] : t.f !== undefined ? t.f : place(t.r))).filter(Boolean),
            value: m.value,
            inst
          };
          let map = plans.markups.get(m.owner);
          if (!map) {
            map = new Map();
            plans.markups.set(m.owner, map);
          }
          for (const t of handle.entries) map.set(t, (map.get(t) || 0) + handle.value);
          inst.markups.add(handle);
        }
      }
      inst.env = plans.environment(inst);
      vm.set(inst.env, 'PlayerObject', plans.host.player(controller.player.faction));
      vm.set(inst.env, 'Target', plans.host.planet(inst.thing));
      vm.set(inst.env, 'AITarget', plans.target(inst.thing));
      for (const force of inst.forces) vm.set(inst.env, force.name, force.wrapper);
      plans.live.push(inst);
      made.push([inst, di]);
    } catch (error) {
      plans.ai.errors.set('Plan restore ' + di.name, error.message);
      if (inst) discard(plans, inst);
      failed.push(di);
    }
  }
  const stores = [];
  for (const d of data.freeStores || []) {
    const controller = plans.ai.controllers.get(key(d.faction));
    if (!controller) continue;
    plans.ai.freeStores.get(key(d.faction))?.dispose();
    const fs = new GalacticFreeStore(plans.ai, controller, d.name);
    fs.prepare();
    plans.ai.freeStores.set(key(d.faction), fs);
    stores.push([fs, d]);
  }
  if (made.length || stores.length) {
    try {
      const restored = persist.restore(data.lua);
      for (const [fs, d] of stores) fs.finish(d, restored, place);
      for (const [inst, di] of made) {
        const thread = t => {
          const tv = restored.value(t.co);
          return {
            co: tv.value,
            ref: persist.newRef(tv),
            started: t.started,
            ...(t.id !== null ? { id: t.id } : {}),
            arg: restored.js(t.arg),
            ...(t.values ? { values: restored.js(t.values) } : {})
          };
        };
        inst.threads = di.threads.map(thread);
        inst.events = di.events.map(e => ({
          ...(restored.js(e.fn) ? { fn: restored.js(e.fn) } : {}),
          params: restored.js(e.params),
          ...(e.release ? { release: true } : {})
        }));
        inst.params = restored.js(di.params);
        inst.values = restored.js(di.values);
      }
    } catch (error) {
      plans.ai.errors.set('Plan restore', error.message);
      for (const [fs] of stores) {
        fs.dispose();
        plans.ai.freeStores.delete(key(fs.owner));
      }
      for (const [inst, di] of made) {
        discard(plans, inst);
        failed.push(di);
      }
      made.length = 0;
    }
  }
  for (const [inst, di] of made) {
    for (const fd of di.forces) {
      const force = inst.forces.find(f => f.name === fd.name),
        entries = inst.staffed.get(fd.name) || [];
      for (const jd of fd.jobs) {
        const entry = entries[jd.e],
          queue = jd.q ? g.planets[jd.q.p]?.production[jd.q.kind]?.[jd.q.i] : null;
        const job = {
          inst,
          force,
          type: entry.type,
          entry,
          stage: jd.stage >= 0 ? g.planets[jd.stage] : null,
          record: place(jd.rec),
          queue: queue?.ai ? queue : null,
          complete: jd.complete,
          failed: jd.failed,
          orphan: jd.orphan,
          allocated: jd.allocated,
          created: jd.created
        };
        force.jobs.push(job);
        plans.jobs.add(job);
        if (job.queue) plans.queueJobs.set(job.queue, job);
      }
    }
  }
  const byId = id => plans.live.find(i => i.id === id);
  for (const [saved, id] of data.reservations) {
    const r = place(saved),
      inst = byId(id);
    if (r && inst) plans.reservations.set(r, inst);
  }
  const fleets = fleetsOf(g);
  for (const [i, id, name] of data.fleetForces) {
    const force = byId(id)?.forces.find(f => f.name === name);
    if (fleets[i] && force) fleets[i].aiForce = force;
  }
  return failed;
}

function discard(plans, inst) {
  const i = plans.live.indexOf(inst);
  if (i >= 0) plans.live.splice(i, 1);
  for (const handle of inst.markups || []) plans.clearMarkup(handle);
  for (const thread of inst.threads) plans.vm.free(thread.ref);
  inst.threads.length = 0;
  if (inst.env != null) plans.vm.free(inst.env);
  inst.env = null;
  inst.state = 'over';
}
