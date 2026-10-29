import { db } from '../gamedata.js';
import { LuaPersist } from '../luapersist.js';

const key = s =>
  String(s || '')
    .replace(/\\/g, '/')
    .toUpperCase();
export const STORY_SAVE_VERSION = 1;

export function installPersistence(host) {
  const persist = (host.persist = new LuaPersist(host.vm));
  host.envOwners = new WeakMap();
  persist.hooks.describe = o => describeObject(host, o);
  persist.hooks.resolve = d => resolveObject(host, d);
  persist.hooks.bound = t => {
    const o = host.envOwners.get(t);
    return o ? o.kind + ':' + o.i : undefined;
  };
  persist.hooks.boundTable = name => {
    const [kind, i] = name.split(':'),
      inst = host.instances[+i];
    if (!inst || inst.env == null) return null;
    const info = host.vm.envInfo.get(persist.refValue(inst.env).value);
    return kind === 'env' ? persist.refValue(inst.env).value : info?.loaded;
  };
  persist.freezePerms();
  return persist;
}

export function locate(host, record) {
  const g = host.game.galaxy;
  for (const p of g.planets)
    for (const [code, list] of [
      ['g', 'groundStructures'],
      ['o', 'orbitalStructures'],
      ['r', 'garrison']
    ]) {
      const i = p[list]?.indexOf(record);
      if (i >= 0) return { l: code, p: p.index, i };
    }
  const fleets = g.fleets.filter(f => f.units.length);
  for (let f = 0; f < fleets.length; f++) {
    const i = fleets[f].units.indexOf(record);
    if (i >= 0) return { f, i };
  }
  const c = host.created.indexOf(record);
  if (c >= 0) return { c };
  return null;
}

function describeObject(host, o) {
  if (o.__inst) return { k: 'inst', i: host.instances.indexOf(o.__inst), w: o.__hostName };
  if (o.__plotRef) return { k: 'plot', n: o.__plotRef.name, o: o.__plotRef.owner };
  if (o.__eventRef) return { k: 'ev', n: o.__eventRef.plot.name, o: o.__eventRef.plot.owner, e: o.__eventRef.name };
  if (o.__planet) return { k: 'pl', i: o.__planet.index };
  if (o.__object) {
    const object = o.__object,
      record = object.record || object,
      where = locate(host, record);
    const flags = {};
    if (object.noAI) flags.noAI = 1;
    if (object.deleteAfterBattle) flags.del = 1;
    if (object.finalBlowOwner) flags.fb = object.finalBlowOwner;
    return {
      k: 'ob',
      ...(where || { dead: 1, t: object.type.name, ow: object.owner }),
      ...(Object.keys(flags).length ? { fl: flags } : {})
    };
  }
  if (o.__force) return { k: 'fl', o: (o.__objects || []).map(x => describeObject(host, { __object: x })) };
  if (o.__type) return { k: 'ty', n: o.__type.name };
  if (o.__faction !== undefined) return { k: 'pc', n: o.__faction };
  if (o.__pos) return { k: 'ps', x: o.x, y: o.y, z: o.z };
  return undefined;
}

export function recordAt(host, d) {
  const g = host.game.galaxy;
  let record, planet, owner;
  if (d.c !== undefined) record = host.created[d.c];
  else if (d.f !== undefined) {
    const fleet = g.fleets.filter(f => f.units.length)[d.f];
    record = fleet?.units[d.i];
    planet = g.planets[fleet?.planet];
    owner = fleet?.owner;
  } else if (d.l) {
    planet = g.planets[d.p];
    record = planet?.[{ g: 'groundStructures', o: 'orbitalStructures', r: 'garrison' }[d.l]]?.[d.i];
  } else return undefined;
  return record ? { record, planet, owner } : null;
}

function resolveObject(host, d) {
  const g = host.game.galaxy;
  switch (d.k) {
    case 'inst':
      return host.instances[d.i]?.hostValues?.[d.w];
    case 'plot':
      return host.plotWrapperOf([...host.plots.values()].find(p => key(p.name) === key(d.n) && key(p.owner) === key(d.o)));
    case 'ev': {
      const plot = [...host.plots.values()].find(p => key(p.name) === key(d.n) && key(p.owner) === key(d.o)),
        e = plot?.events.get(key(d.e));
      return e && host.eventWrapperOf(plot, e);
    }
    case 'pl':
      return host.planet(g.planets[d.i]);
    case 'ty':
      return host.type(db.type(d.n));
    case 'pc':
      return host.player(d.n);
    case 'ps':
      return host.position(d.x, d.y, d.z);
    case 'fl':
      return host.fleet(d.o.map(x => resolveObject(host, x)));
    case 'ob': {
      let found = recordAt(host, d);
      if (found === undefined) found = { record: { type: db.type(d.t), owner: d.ow, planet: null, pos: [0, 0, 0], dead: true } };
      if (!found) return undefined;
      const { record, planet, owner } = found;
      const wrapper = host.object(record, planet, owner),
        object = wrapper.__object;
      if (d.fl) {
        if (d.fl.noAI) object.noAI = true;
        if (d.fl.del) object.deleteAfterBattle = true;
        if (d.fl.fb) object.finalBlowOwner = d.fl.fb;
      }
      return wrapper;
    }
  }
  return undefined;
}

export function saveStory(host) {
  const vm = host.vm,
    persist = host.persist;
  if (!persist) throw new Error('the story has no persistence');
  if (host.running || host.current || vm.L.errorJmp) throw new Error('the story scripts are running');
  const s = persist.begin();
  const planInst = inst => {
    const th = t =>
      t && {
        co: s.enc({ type: 8, value: t.co }),
        started: !!t.started,
        id: t.id ?? null,
        arg: s.js(t.arg),
        values: t.values ? s.js(t.values) : null
      };
    return {
      name: inst.name,
      key: inst.key,
      scoring: !!inst.scoring,
      state: inst.state,
      next: inst.next,
      exit: !!inst.exit,
      initialized: !!inst.initialized,
      starts: inst.starts,
      rate: inst.rate ?? null,
      tags: inst.tags.slice(),
      history: inst.history.slice(),
      needs: inst.needs.slice(),
      initialCallbacks: s.js(inst.initialCallbacks ?? null),
      plot: inst.plot ? { name: inst.plot.name, owner: inst.plot.owner } : null,
      params: s.js(inst.params),
      values: s.js(inst.values),
      env: inst.env == null ? null : s.enc(persist.refValue(inst.env)),
      thread: th(inst.thread),
      threads: inst.threads.map(th),
      events: inst.events.map(e => ({ fn: s.js(e.fn ?? null), params: s.js(e.params), release: !!e.release }))
    };
  };
  const out = {
    v: STORY_SAVE_VERSION,
    time: host.time,
    serviceTime: host.serviceTime,
    lastLogicTick: host.lastLogicTick,
    storyGoalId: host.storyGoalId,
    goals: s.js(host.storyGoals),
    goalAt: host.storyGoalAt || 0,
    objectives: host.objectives.snapshot(),
    neutralized: [...(host.neutralized || [])],
    flags: host.flags.snapshot(),
    values: s.js(host.values),
    battleClasses: (host.battleClasses || [[], []]).map(set => [...set]),
    aiFlags: [...host.aiFlags].map(([k, set]) => [k, [...set]]),
    created: host.created.map(o => ({
      t: o.type.name,
      ow: o.owner,
      p: o.planet ? o.planet.index : -1,
      pos: o.pos.slice(),
      dead: !!o.dead
    })),
    plots: [...host.plots.values()].map(p => ({
      name: p.name,
      owner: p.owner,
      scriptName: p.scriptName || '',
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
          timed: host.timedEvents.has(e)
        })
      }))
    })),
    instances: host.instances.map(planInst)
  };
  out.lua = s.end();
  return out;
}

export async function restoreStory(host, data) {
  const vm = host.vm,
    persist = host.persist;
  if (data.v !== STORY_SAVE_VERSION) throw new Error('this save was written by another version of the story');
  host.time = data.time;
  host.serviceTime = data.serviceTime;
  host.lastLogicTick = data.lastLogicTick;
  host.storyGoalId = data.storyGoalId;
  host.plots.clear();
  host.eventTypes.clear();
  host.timedEvents.clear();
  host.storyScripts.clear();
  for (const sp of data.plots) await host.readPlot(sp.name, sp.scriptName, sp.owner);
  host.instances.length = 0;
  for (const si of data.instances) {
    const inst = {
      name: si.name,
      key: si.key,
      scoring: si.scoring,
      state: si.state,
      env: null,
      thread: null,
      events: [],
      tags: si.tags.slice(),
      history: si.history.slice(),
      values: new Map(),
      threads: [],
      next: si.next,
      exit: si.exit,
      initialized: si.initialized,
      starts: si.starts,
      needs: si.needs.slice(),
      rate: si.rate ?? undefined
    };
    host.instances.push(inst);
    if (si.plot) {
      const plot = [...host.plots.values()].find(p => key(p.name) === key(si.plot.name) && key(p.owner) === key(si.plot.owner));
      if (plot) {
        inst.plot = plot;
        plot.instance = inst;
        host.storyScripts.set(plot, inst);
      }
    }
    if (si.scoring) host.scoring = inst;
    if (si.env !== null) inst.env = host.environment(inst);
  }
  const restored = persist.restore(data.lua);
  data.instances.forEach((si, i) => {
    const inst = host.instances[i];
    inst.initialCallbacks = restored.js(si.initialCallbacks) || undefined;
    inst.params = restored.js(si.params);
    inst.values = restored.js(si.values);
    const thread = t => {
      if (!t) return null;
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
    inst.thread = thread(si.thread);
    inst.threads = si.threads.map(thread);
    inst.events = si.events.map(e => ({
      ...(restored.js(e.fn) ? { fn: restored.js(e.fn) } : {}),
      params: restored.js(e.params),
      ...(e.release ? { release: true } : {})
    }));
  });
  host.values = restored.js(data.values);
  host.storyGoals = restored.js(data.goals);
  host.storyGoalAt = +data.goalAt || 0;
  if (data.objectives) host.objectives.restore(data.objectives);
  host.neutralized = new Map(data.neutralized || []);
  host.battleClasses = (data.battleClasses || [[], []]).map(list => new Set(list));
  host.aiFlags = new Map(data.aiFlags.map(([k, ids]) => [k, new Set(ids)]));
  host.created.length = 0;
  for (const c of data.created)
    host.created.push({
      type: db.type(c.t),
      owner: c.ow,
      planet: c.p >= 0 ? host.game.galaxy.planets[c.p] : null,
      pos: c.pos.slice(),
      dead: c.dead
    });
  for (const sp of data.plots) {
    const plot = [...host.plots.values()].find(p => key(p.name) === key(sp.name) && key(p.owner) === key(sp.owner));
    if (!plot) continue;
    for (const se of sp.events) {
      const e = plot.events.get(key(se.name));
      if (!e) continue;
      const st = restored.js(se.state),
        { timed, ...rest } = st;
      Object.assign(e, rest);
      if (timed) host.timedEvents.add(e);
      else host.timedEvents.delete(e);
    }
  }
  host.objectCache = null;
  host.reasonCache.clear();
}
