import { db } from '../gamedata.js';
import { LuaPersist } from '../luapersist.js';
import { readForce } from './aiplans.js';

export const SCRIPTS_SAVE_VERSION = 1;
const key = s =>
  String(s || '')
    .replace(/\\/g, '/')
    .toUpperCase();

export function installBattlePersistence(host) {
  let persist;
  try {
    persist = new LuaPersist(host.vm);
  } catch (error) {
    console.warn('battle scripts cannot be saved:', error);
    return;
  }
  const P = (host.persistence = {
    persist,
    owners: new WeakMap(),
    names: null,
    owned(inst, values) {
      for (const k of Object.keys(values))
        if (values[k] && values[k].__wrap) {
          values[k].__inst = inst;
          values[k].__hostName = k;
        }
      inst.hostValues = values;
      const env = persist.refValue(inst.env).value,
        info = host.vm.envInfo.get(env);
      P.owners.set(env, { kind: 'env', inst });
      if (info) P.owners.set(info.loaded, { kind: 'loaded', inst });
    }
  });
  persist.hooks.describe = o => describe(host, o);
  persist.hooks.resolve = d => resolve(host, d);
  persist.hooks.bound = t => {
    const o = P.owners.get(t);
    return o ? o.kind + ':' + o.inst.sid : undefined;
  };
  persist.hooks.boundTable = name => {
    const [kind, sid] = name.split(':'),
      inst = host.instances.find(i => i.sid === +sid);
    if (!inst || inst.env == null) return null;
    const env = persist.refValue(inst.env).value;
    return kind === 'env' ? env : host.vm.envInfo.get(env)?.loaded;
  };
  persist.freezePerms();
}

function battle(game, ref, thing) {
  const land = !!game.landBattle,
    host = land ? game.scripts?.host : game.scripts;
  const players = land ? game.world.sidePlayers : game.world.players;
  const cmdrs = land ? game.scripts?.commanders || [] : game.ais || [];
  const goals = land ? game.goals : game.world.goals;
  return {
    land,
    host,
    game,
    players,
    cmdrs,
    goals,
    ref,
    thing,
    goalKey: c => (land ? cmdrs.indexOf(c) : c),
    time: () => (land ? game.world.time : game.world.time)
  };
}

function describe(host, o) {
  const B = host.persistence.names;
  if (!B) return undefined;
  if (o.__inst && o.__hostName) return { k: 'iv', s: o.__inst.sid, w: o.__hostName };
  if (o.__entity) {
    const r = B.ref(o.__entity);
    return r ? { k: 'e', r } : { k: 'gone', t: o.__entity.type?.name || '' };
  }
  if (o.__player) return { k: 'pl', i: B.players.indexOf(o.__player), f: o.__player.factionName || '' };
  if (o.__type) return { k: 'ty', n: o.__type.name };
  if (o.__pos) return { k: 'ps', x: o.x, y: o.y, z: o.z || 0 };
  if (o.__force) return { k: 'tf', s: o.__force.inst.sid, n: o.__force.name };
  if (o.__block) return { k: 'bk', r: recipeOut(B, o.__block.recipe), b: o.__block.born };
  if (o.__fsOf) return { k: 'fs', s: o.__fsOf.sid };
  if (o.__hollow) return { k: 'ho', n: o.__hollow };
  if (o.__dist) return { k: 'dd', items: o.__dist.map(([v, w]) => [valueOut(B, v), w]) };
  if (o.__weighted) return { k: 'wl', t: o.__weighted.map(([t, w]) => [t.name, w]), g: o.__kinds.map(([n, w]) => [n, w]) };
  if (o.__reveal) return { k: 'rv', i: B.reveals.indexOf(o.__reveal) };
  if (o.__planet) return { k: 'pt', i: o.__planet.index };
  if (o.__plotRef) return { k: 'plot', n: o.__plotRef.name, o: o.__plotRef.owner };
  if (o.__eventRef) return { k: 'ev', n: o.__eventRef.plot.name, o: o.__eventRef.plot.owner, e: o.__eventRef.name };
  return undefined;
}

function resolve(host, d) {
  const B = host.persistence.names;
  if (!B) return undefined;
  switch (d.k) {
    case 'iv':
      return host.instances.find(i => i.sid === d.s)?.hostValues?.[d.w];
    case 'e': {
      const e = B.thing(d.r);
      return e ? host.wrap(e) : host.wrap(goneThing(B, d.t));
    }
    case 'gone':
      return host.wrap(goneThing(B, d.t));
    case 'pl':
      return host.player(B.players[d.i] ?? host.campaignPlayer?.(d.f) ?? B.players[0]);
    case 'ty':
      return host.type(db.type(d.n));
    case 'ps':
      return host.pos(d.x, d.y, d.z);
    case 'tf':
      return host.instances.find(i => i.sid === d.s)?.forces?.find(f => f.name === d.n)?.wrapper;
    case 'bk': {
      const r = recipeIn(B, host, d.r);
      return r
        ? host.plans.waitFor(r, d.b)
        : host.plans.block(
            () => true,
            () => false
          );
    }
    case 'fs': {
      const inst = host.instances.find(i => i.sid === d.s);
      return inst ? host.freeStoreWrap(inst) : undefined;
    }
    case 'ho':
      return host.hollow(d.n);
    case 'dd': {
      const dist = host.distributions.Create();
      for (const [v, w] of d.items) dist.Insert(valueIn(B, host, v), w);
      return dist;
    }
    case 'wl': {
      const list = host.weightedLists.Create();
      for (const [n, w] of d.t) {
        const t = db.type(n);
        if (t) list.__weighted.push([t, w]);
      }
      for (const [n, w] of d.g) list.__kinds.push([n, w]);
      return list;
    }
    case 'rv':
      return B.reveals[d.i] ? host.revealWrap(B.reveals[d.i]) : host.revealWrap({ until: 0 });
    case 'pt':
      return host.story?.planet(host.story.galaxy?.planets[d.i]);
    case 'plot':
      return host.story?.plotWrapperOf([...host.story.plots.values()].find(p => key(p.name) === key(d.n) && key(p.owner) === key(d.o)));
    case 'ev': {
      const plot = host.story && [...host.story.plots.values()].find(p => key(p.name) === key(d.n) && key(p.owner) === key(d.o)),
        e = plot?.events.get(key(d.e));
      return e && host.story.eventWrapperOf(plot, e);
    }
  }
  return undefined;
}

function goneThing(B, typeName) {
  return {
    dead: true,
    type: db.type(typeName) || {
      name: typeName,
      str: () => '',
      num: (k, d) => d,
      bool: () => false,
      list: () => [],
      categories: () => new Set()
    },
    player: B.players[0],
    x: 0,
    y: 0,
    z: 0,
    fighters: [],
    members: [],
    hardpoints: [],
    abilities: []
  };
}

function valueOut(B, v) {
  if (v && typeof v === 'object') {
    if (v.__type) return { ty: v.__type.name };
    if (v.__entity) return { e: B.ref(v.__entity) };
    return { s: String(v.__name || '') };
  }
  return { v };
}
function valueIn(B, host, o) {
  if (o.ty) return host.type(db.type(o.ty));
  if (o.e !== undefined) {
    const e = o.e && B.thing(o.e);
    return e ? host.wrap(e) : undefined;
  }
  return o.v;
}

function recipeOut(B, r) {
  const out = { k: r.k, s: r.f.inst.sid, f: r.f.name };
  if (r.k === 'now') out.r = r.r;
  if (r.x) out.x = B.ref(r.x);
  if (r.pad) out.pad = B.ref(r.pad);
  if (r.st) out.st = B.ref(r.st);
  if (r.at) out.at = { x: r.at.x, y: r.at.y };
  if (r.types) out.types = r.types.map(t => t.name);
  for (const k of ['want', 'why', 't0', 'until']) if (r[k] !== undefined) out[k] = r[k] === Infinity ? 'inf' : r[k];
  return out;
}
function recipeIn(B, host, o) {
  const inst = host.instances.find(i => i.sid === o.s),
    f = inst?.forces?.find(x => x.name === o.f);
  if (!f) return null;
  const r = { f, k: o.k };
  if (o.k === 'now') r.r = o.r;
  if (o.x !== undefined) r.x = (o.x && B.thing(o.x)) || { dead: true };
  if (o.pad !== undefined) r.pad = (o.pad && B.thing(o.pad)) || { padChild: null };
  if (o.st !== undefined) r.st = (o.st && B.thing(o.st)) || null;
  if (o.at) r.at = { x: o.at.x, y: o.at.y };
  if (o.types) r.types = o.types.map(n => db.type(n)).filter(Boolean);
  for (const k of ['want', 'why', 't0', 'until']) if (o[k] !== undefined) r[k] = o[k] === 'inf' ? Infinity : o[k];
  return r;
}

export function saveBattleScripts(game, ref) {
  const B = battle(game, ref, null),
    host = B.host;
  if (!host) return null;
  const P = host.persistence;
  if (!P) throw new Error('the battle scripts have no persistence');
  if (host.current || host.vm.L.errorJmp) throw new Error('a battle script is running');
  if (host.instances.some(i => i.state === 'run' && i.blocked && !i.blocked.ready))
    throw new Error('a battle script waits inside a call of the engine');
  const w = game.world;
  B.reveals = (w.reveals || []).filter(r => r.by && r.by.sid !== undefined && r.until > w.time);
  P.names = B;
  try {
    P.persist.adoptGlobals();
    const s = P.persist.begin(),
      persist = P.persist;
    const th = t =>
      t && {
        co: s.enc({ type: 8, value: t.co }),
        started: !!t.started,
        id: t.id ?? null,
        arg: s.js(t.arg),
        values: t.values ? s.js(t.values) : null
      };
    const plans = host.plans;
    const instances = [];
    for (const inst of host.instances) {
      if (inst.state === 'over') continue;
      const kind = inst === host.scoring ? 'scoring' : inst.story ? 'story' : inst.fs ? 'fs' : inst.plan ? 'plan' : 'object';
      const o = { sid: inst.sid, kind, name: inst.name, key: inst.key, state: inst.state };
      if (kind === 'object') {
        o.e = inst.e ? ref(inst.e) : null;
        if (!o.e) continue;
      }
      if (kind === 'story') o.plot = inst.plot ? { name: inst.plot.name, owner: inst.plot.owner } : null;
      if (kind === 'fs') o.player = B.players.indexOf(inst.player);
      if (kind === 'plan') o.plan = savePlan(B, s, inst);
      if (inst.state === 'run')
        Object.assign(o, {
          next: inst.next,
          rate: inst.rate,
          services: inst.services || 0,
          exit: !!inst.exit,
          threadIds: inst.threadIds || 0,
          env: s.enc(persist.refValue(inst.env)),
          thread: th(inst.thread),
          threads: (inst.threads || []).map(th),
          values: s.js(inst.values),
          params: s.js(inst.params ?? null),
          events: inst.events.map(e => ({ fn: s.js(e.fn ?? null), params: s.js(e.params) })),
          prox: inst.prox
            .map(p => ({ fn: s.js(p.fn), of: p.of ? ref(p.of) : null, range: p.range, who: p.who ? B.players.indexOf(p.who) : -1 }))
            .filter(p => p.of),
          ...(inst.fs ? { mainEvery: inst.mainEvery, mainAt: inst.mainAt } : {})
        });
      instances.push(o);
    }
    const out = {
      v: SCRIPTS_SAVE_VERSION,
      sids: host.sids,
      storyTime: host.storyTime,
      values: s.js(host.values),
      told: s.js(host.told || []),
      instances,
      scripted: [...w.units, ...(w.squads || [])]
        .filter(e => e.scripted && !e.dead)
        .map(ref)
        .filter(Boolean),
      inert: [...host.inert].map(t => t.name),
      reveals: B.reveals.map(r => ({
        p: B.players.indexOf(r.pl),
        x: r.x,
        y: r.y,
        r: r.r,
        until: r.until === Infinity ? 'inf' : r.until,
        by: r.by.sid
      })),
      locks: host.locks
        ? [...w.units, ...(w.squads || [])]
            .filter(e => !e.dead && host.locks.get(e) !== undefined)
            .map(e => [ref(e), host.locks.get(e)])
            .filter(([r]) => r)
        : [],
      plans: plans ? { failed: [...plans.failed] } : null,
      goals: saveGoals(B),
      story: host.story ? saveStory(host.story, s) : null
    };
    out.lua = s.end();
    return out;
  } finally {
    P.names = null;
  }
}

function savePlan(B, s, inst) {
  const ref = B.ref,
    w = B.game.world;
  const thing = inst.thing
    ? inst.thing.type
      ? { e: ref(inst.thing) }
      : { x: inst.thing.x, y: inst.thing.y, key: inst.thing.key ?? null }
    : null;
  const poolOf = f => (f.pool || []).map(x => x.type?.name).filter(Boolean);
  return {
    ai: B.cmdrs.indexOf(inst.ai),
    goal: inst.goal,
    thing,
    born: inst.born,
    result: inst.result,
    removable: !!inst.removable,
    blocksGoals: !!inst.blocksGoals,
    toldLost: !!inst.toldLost,
    tryKey: inst.tryKey ?? null,
    emptySince: inst.emptySince ?? null,
    gd: inst.gd ?? null,
    stolen: !!inst.stolen,
    flags: inst.flags ? s.js(inst.flags) : null,
    staffed: inst.staffed ? [...inst.staffed].map(([n, list]) => [n, list.map(e => (e.pooled ? null : ref(e))).filter(Boolean)]) : null,
    tkey: inst.tkey ?? null,
    gdef: inst.gdef ? defName(B, inst) : null,
    forces: (inst.forces || []).map(f => ({
      name: f.name,
      def: f.def || [f.name],
      units: f.units.map(ref).filter(Boolean),
      had: !!f.had,
      toldEmpty: !!f.toldEmpty,
      moving: [...f.moving].map(ref).filter(Boolean),
      pads: f.pads ? f.pads.map(ref).filter(Boolean) : null,
      pool: poolOf(f)
    }))
  };
}

function defName(B, inst) {
  const E = B.goals?.env(B.land ? B.cmdrs.indexOf(inst.ai) : inst.ai);
  for (const [n, d] of E?.brain?.defs || []) if (d === inst.gdef) return n;
  return null;
}

function saveGoals(B) {
  const G = B.goals;
  if (!G || !G.sides) return null;
  const out = [];
  for (const [k, S] of G.sides) {
    const i = B.land ? k : B.cmdrs.indexOf(k);
    if (i < 0 || i === undefined) continue;
    out.push({ i, wake: S.wake, learn: [...S.learn] });
  }
  return out;
}

function saveStory(story, s) {
  return {
    time: story.time,
    storyGoalId: story.storyGoalId,
    goals: s.js(story.storyGoals),
    flags: story.flags?.snapshot?.() ?? null,
    disableDepth: story.disableDepth || 0,
    resetDepth: story.resetDepth || 0,
    objectives: story._objectives ? story.objectives.snapshot() : null,
    plots: [...story.plots.values()].map(p => ({
      name: p.name,
      owner: p.owner,
      events: [...p.events.values()].map(e => ({
        name: e.name,
        state: s.js({
          completed: e.completed,
          active: e.active,
          disabled: e.disabled,
          elapsedFrom: e.elapsedFrom,
          params: e.params,
          rewards: e.rewards,
          reward: e.reward,
          dialog: e.dialog,
          entries: e.entries,
          battleCount: e.battleCount || 0,
          remainingCounts: e.remainingCounts || null,
          timed: story.timedEvents.has(e)
        })
      }))
    }))
  };
}

export function restoreBattleScripts(game, data, ref, thing) {
  const B = battle(game, ref, thing),
    host = B.host;
  if (!host || !data) return;
  if (data.v !== SCRIPTS_SAVE_VERSION) throw new Error('these battle scripts were saved by another version');
  const P = host.persistence,
    w = game.world;
  if (!P) throw new Error('the battle scripts have no persistence');
  B.reveals = [];
  P.names = B;
  try {
    P.persist.adoptGlobals();
    host.storyTime = data.storyTime || 0;
    host.sids = Math.max(host.sids, data.sids || 0);
    for (const n of data.inert || []) {
      const t = db.type(n);
      if (t) host.inert.add(t);
    }
    for (const r of data.scripted || []) {
      const e = thing(r);
      if (e) e.scripted = true;
    }
    const made = [],
      fresh = new Set(host.instances);
    for (const si of data.instances) {
      let inst = null;
      if (si.kind === 'scoring') inst = host.scoring;
      else if (si.kind === 'story')
        inst = host.storyInstances.find(
          i => i.plot && si.plot && key(i.plot.name) === key(si.plot.name) && key(i.plot.owner) === key(si.plot.owner)
        );
      else if (si.kind === 'fs') {
        const player = B.players[si.player];
        if (!player) continue;
        inst = host.instances.find(i => i.fs && i.player === player) || {
          global: true,
          fs: true,
          player,
          ai: null,
          name: si.name,
          key: si.key,
          next: 0,
          prox: [],
          events: [],
          values: new Map(),
          exit: false,
          mainAt: 0,
          restored: true
        };
      } else if (si.kind === 'plan') inst = makePlan(B, host, si);
      else {
        const e = thing(si.e);
        if (!e) continue;
        inst = { e, name: si.name, key: si.key, next: 0, prox: [], events: [], values: new Map(), exit: false };
        e.scripted = true;
      }
      if (!inst) continue;
      fresh.delete(inst);
      inst.sid = si.sid;
      inst.state = si.state;
      if (si.state === 'run') {
        Object.assign(inst, {
          next: si.next,
          rate: si.rate,
          services: si.services,
          exit: si.exit,
          threadIds: si.threadIds,
          threads: [],
          running: null,
          blocked: null
        });
        if (si.mainEvery !== undefined) {
          inst.mainEvery = si.mainEvery;
          inst.mainAt = si.mainAt;
        }
        host.makeEnv(inst);
      }
      made.push([inst, si]);
    }
    host.instances = [
      ...made.map(([i]) => i),
      ...[...fresh].filter(i => i.state !== 'over' && !(i.story && made.some(([m]) => m.plot === i.plot)))
    ];
    host.plans.live = made.map(([i]) => i).filter(i => i.plan);
    for (const [inst, si] of made) if (si.kind === 'plan') finishPlan(B, host, inst, si);
    for (const r of data.reveals || []) {
      const p = B.players[r.p],
        by = host.instances.find(i => i.sid === r.by);
      if (!p || !by) continue;
      const rv = { team: p.team, pl: p, x: r.x, y: r.y, r: r.r, until: r.until === 'inf' ? Infinity : r.until, by, env: by.env };
      B.reveals.push(rv);
      (w.reveals ||= []).push(rv);
    }
    const restored = P.persist.restore(data.lua);
    for (const [inst, si] of made) {
      if (si.state !== 'run') continue;
      const thread = t => {
        if (!t) return null;
        const tv = restored.value(t.co);
        return {
          co: tv.value,
          ref: P.persist.newRef(tv),
          started: t.started,
          ...(t.id !== null ? { id: t.id } : {}),
          arg: restored.js(t.arg),
          ...(t.values ? { values: restored.js(t.values) } : {})
        };
      };
      inst.thread = thread(si.thread);
      inst.threads = si.threads.map(thread);
      inst.values = restored.js(si.values) || new Map();
      inst.params = restored.js(si.params) ?? undefined;
      inst.events = si.events.map(e => ({ ...(restored.js(e.fn) ? { fn: restored.js(e.fn) } : {}), params: restored.js(e.params) }));
      inst.prox = si.prox
        .map(p => ({ fn: restored.js(p.fn), of: thing(p.of), range: p.range, who: p.who >= 0 ? B.players[p.who] : null }))
        .filter(p => p.of);
      if (si.kind === 'plan' && si.plan.flags) inst.flags = restored.js(si.plan.flags);
    }
    host.values = restored.js(data.values) || new Map();
    host.told = restored.js(data.told) || [];
    if (data.locks?.length) {
      host.locks ||= new WeakMap();
      for (const [r, k] of data.locks) {
        const e = thing(r);
        if (e) host.locks.set(e, k);
      }
    }
    if (data.plans && host.plans) host.plans.failed = new Map(data.plans.failed);
    restoreGoals(B, data.goals);
    if (data.story && host.story) restoreStory(host.story, data.story, restored);
  } finally {
    P.names = null;
  }
}

function makePlan(B, host, si) {
  const pl = si.plan,
    ai = B.cmdrs[pl.ai];
  if (!ai) return null;
  const plans = host.plans,
    thing = pl.thing
      ? pl.thing.e !== undefined
        ? B.thing(pl.thing.e)
        : { x: pl.thing.x, y: pl.thing.y, ...(pl.thing.key !== null ? { key: pl.thing.key } : {}) }
      : null;
  if (pl.thing && pl.thing.e !== undefined && !thing) return null;
  const inst = {
    plan: true,
    global: true,
    e: null,
    name: si.name,
    key: si.key,
    state: 'new',
    next: 0,
    prox: [],
    events: [],
    values: new Map(),
    exit: false,
    ai,
    goal: pl.goal,
    thing,
    forces: [],
    born: pl.born,
    result: pl.result,
    removable: pl.removable,
    blocksGoals: pl.blocksGoals,
    toldLost: pl.toldLost,
    stolen: pl.stolen,
    begin: () => plans.begin(inst),
    poll: () => plans.poll(inst)
  };
  if (pl.tryKey !== null) inst.tryKey = pl.tryKey;
  if (pl.emptySince !== null) inst.emptySince = pl.emptySince;
  if (pl.gd !== null) inst.gd = pl.gd;
  if (pl.staffed) inst.staffed = new Map(pl.staffed.map(([n, refs]) => [n, refs.map(r => B.thing(r)).filter(Boolean)]));
  const G = B.goals;
  if (G && pl.gdef) {
    const E = G.env(B.land ? pl.ai : ai),
      def = E?.brain?.defs?.get?.(pl.gdef);
    if (def) {
      inst.gdef = def;
      inst.tkey = pl.tkey || '';
      inst.tgt = pl.tkey ? { key: pl.tkey } : null;
      inst.gside = B.goalKey(ai);
      inst.gsys = G;
    }
  }
  return inst;
}

function finishPlan(B, host, inst, si) {
  const plans = host.plans,
    pl = si.plan,
    p = inst.ai.player,
    w = B.game.world;
  const pool = B.land ? host.world.landPool?.(p) || [] : p.aiPool || [];
  for (const sf of pl.forces) {
    const f = Object.assign(readForce(sf.def), {
      def: sf.def,
      units: [],
      had: sf.had,
      toldEmpty: sf.toldEmpty,
      moving: new Set(),
      seen: new Map(),
      inst,
      pool: []
    });
    f.units = sf.units.map(r => B.thing(r)).filter(e => e && !e.dead);
    for (const e of f.units) e.aiPlan = inst;
    f.moving = new Set(sf.moving.map(r => B.thing(r)).filter(Boolean));
    if (sf.pads) f.pads = sf.pads.map(r => B.thing(r)).filter(Boolean);
    for (const n of sf.pool) {
      const x = pool.find(x => x.type?.name === n && (!x.owner || x.owner === inst) && !f.pool.includes(x));
      if (x) {
        x.owner = inst;
        f.pool.push(x);
      }
    }
    inst.forces.push(f);
    plans.force(f);
  }
  for (const list of inst.staffed?.values() || []) for (const e of list) if (!e.aiPlan) e.aiPlan = inst;
  void w;
}

function restoreGoals(B, list) {
  const G = B.goals;
  if (!G || !list) return;
  for (const g of list) {
    const k = B.land ? g.i : B.cmdrs[g.i];
    if (k === undefined) continue;
    const S = G.state(k);
    S.wake = g.wake;
    S.learn = new Map(g.learn);
    S.phase = 'idle';
  }
}

function restoreStory(story, data, restored) {
  story.time = data.time;
  story.storyGoalId = data.storyGoalId;
  story.storyGoals = restored.js(data.goals) || [];
  if (data.flags && story.flags?.restore) story.flags.restore(data.flags);
  story.disableDepth = data.disableDepth;
  story.resetDepth = data.resetDepth;
  if (data.objectives) story.objectives.restore(data.objectives);
  for (const sp of data.plots) {
    const plot = [...story.plots.values()].find(p => key(p.name) === key(sp.name) && key(p.owner) === key(sp.owner));
    if (!plot) continue;
    for (const se of sp.events) {
      const e = plot.events.get(key(se.name));
      if (!e) continue;
      const { timed, ...rest } = restored.js(se.state);
      Object.assign(e, rest);
      if (timed) story.timedEvents.add(e);
      else story.timedEvents.delete(e);
    }
  }
}
