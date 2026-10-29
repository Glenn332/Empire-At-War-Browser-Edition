import * as THREE from '../../vendor/three/build/three.module.js';
import { loadGameData, db } from '../gamedata.js';
import { loadMap } from '../ted.js';
import { World, Player, Team, Unit, Squad, modelsForType, resetEntityIds } from './sim.js';
import { seedSim } from './simrandom.js';
import { TacticalMarker } from './tacticalobjects.js';
import { restore, snapshot } from './savegame.js';
import { restoreBattleScripts } from './tacticalsave.js';
import { preloadModels } from '../model.js';
import { loadALA, animName } from '../ala.js';
import { findFiles } from '../vfs.js';
import { loadPrioritySets } from './priorities.js';
import { SpaceRecorder, UNIT, SHOT, POINT, ABILITY } from './spacerecord.js';
import { ScriptHost } from './scripts.js';
import { SkirmishAI } from './ai.js';
import { SpaceGoals } from './spacegoals.js';
import { aiFreeStore } from './landbrain.js';
import { execute } from './commands.js';
import { stateHash } from './netgame.js';
import { loadSpaceBrain } from './spacebrain.js';

const TICK = 1 / 30;
const AI_STEP_MS = 4,
  AI_STEP_WORK = 80;
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

function plain(v, depth = 0, seen = new Set()) {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'function') return undefined;
  if (v instanceof Unit || v instanceof Squad) return { $u: v.id };
  if (v instanceof Player) return { $pl: v.id };
  if (v instanceof Team) return { $tm: v.id };
  if (v.isVector3) return { $v: [v.x, v.y, v.z] };
  if (v.isColor) return { $c: v.getHex() };
  if (typeof v.str === 'function' && typeof v.name === 'string') return { $t: v.name };
  if (v.def && v.vx !== undefined && v.id) return { $p: v.id };
  if (ArrayBuffer.isView(v)) return Array.from(v);
  if (depth > 3 || seen.has(v)) return undefined;
  seen.add(v);
  if (Array.isArray(v)) return v.map(x => plain(x, depth + 1, seen));
  const o = {};
  for (const k in v) {
    const x = plain(v[k], depth + 1, seen);
    if (x !== undefined) o[k] = x;
  }
  return o;
}

function keeper(to, events) {
  const call =
    name =>
    (...args) => {
      events.push([to, name, args.map(a => plain(a))]);
    };
  return new Proxy({}, { get: (t, k) => (typeof k === 'string' ? call(k) : undefined) });
}

async function setUp(m, events) {
  const ms = {};
  let t = performance.now();
  const lap = k => {
    const n = performance.now();
    ms[k] = Math.round(n - t);
    t = n;
  };
  await loadGameData(() => {}, { language: m.language });
  lap('data');
  const map = await loadMap(m.mapFile);
  lap('map');
  const names = new Set(),
    seen = new Set();
  const types = new Set([...m.mapObjects.map(x => x.type), ...m.save.battle.entities.map(x => x.type)]);
  for (const n of types) {
    const ty = db.type(n);
    if (ty) modelsForType(ty, null, names, seen);
  }
  await preloadModels([...names].filter(Boolean));
  const clips = new Set((await findFiles('MODELS\\\\[^\\\\]*_(IDLE|DIE|DEPLOY|UNDEPLOY|BUILD)_00\\.ALA$')).map(n => n.split('\\').pop()));
  const wanted = [];
  for (const n of names)
    for (const kind of ['IDLE', 'DIE', 'DEPLOY', 'UNDEPLOY', 'BUILD']) {
      const a = animName(n, kind);
      if (clips.has(a)) wanted.push(a);
    }
  await Promise.all(wanted.map(a => loadALA(a)));
  await loadPrioritySets().catch(() => null);
  lap('models');

  if (m.net) {
    resetEntityIds();
    seedSim(m.net.seed);
  }
  const w = new World({
    scene: new THREE.Scene(),
    fx: events ? keeper('fx', events) : nothing,
    audio: events ? keeper('audio', events) : nothing,
    map
  });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = !!m.fog;
  w.autofire = m.autofire;
  w.skirmish = !!m.skirmish;
  w.campaign = !!m.campaign;
  const teams = m.teams.map((tm, i) => {
    const t = w.addTeam(new Team(i, tm.faction));
    t.mapSide = !!tm.mapSide;
    t.spawnPoints.push(...tm.spawnPoints);
    return t;
  });
  for (const p of m.players) {
    const pl = w.addPlayer(
      new Player(p.id, teams[p.team], {
        human: p.human,
        credits: p.credits,
        popCap: p.popCap,
        color: new THREE.Color(p.color),
        difficulty: p.difficulty,
        name: p.name
      })
    );
    if (p.adjust) pl.adjust = p.adjust;
    if (p.campaignTech !== undefined) pl.campaignTech = p.campaignTech;
    if (p.autofire !== undefined) pl.autofire = p.autofire;
    if (p.spawn) pl.spawn = p.spawn;
  }
  w.viewer = w.players.find(p => p.human) || null;
  for (const f of m.fields) w.fields.push(f);
  w.mapObjects = new Map();
  for (const [i, o] of map.objects.entries())
    if (o.type.behaviors().has('MARKER') || o.type.bool('Is_Marker')) w.mapObjects.set(i, [new TacticalMarker(o, () => w.neutral)]);
  const byId = id => (id < 0 ? w.neutral : w.players.find(p => p.id === id));
  for (const x of m.mapObjects) {
    const ty = db.type(x.type),
      owner = byId(x.player);
    if (!ty || !owner) continue;
    const u = w.spawn(ty, owner, x.x, x.y, x.heading);
    if (!u || u.isSquad) continue;
    u.z = x.z || 0;
    u.roll = x.roll;
    u.pitch = x.pitch;
    u.mapIndex = x.mapIndex;
    u.syncObj?.();
    w.mapObjects.set(x.mapIndex, [u]);
  }
  m.teams.forEach((tm, i) => {
    if (tm.station !== null) {
      const u = w.units.find(u => u.mapIndex === tm.station);
      if (u) teams[i].station = teams[i].firstStation = u;
    }
  });
  const { refs } = restore({ world: w }, m.save);
  for (const [i, tm] of m.teams.entries())
    if (!teams[i].station && tm.station !== null) {
      const u = refs.get('m' + tm.station);
      if (u) teams[i].station = teams[i].firstStation = u;
    }
  const thing = r => {
    const [e, n] = String(r).split('.'),
      x = refs.get(e) || null;
    return n === undefined ? x : x?.fighters?.[+n] || null;
  };
  const ids = [];
  for (const [r, pid] of m.pids) {
    const x = thing(r);
    if (x) ids.push([x.id, pid]);
  }
  w.recountPop();
  lap('spawn');
  return { w, ms, ids, map, thing };
}

onmessage = async e => {
  const m = e.data;
  globalThis.SWR_BASE = m.base;
  try {
    if (m.k === 'run') return await run(m);
    const { w, ms } = await setUp(m, null);
    const rec = new SpaceRecorder(w);
    const steps = [],
      recs = [];
    let bytes = 0;
    for (let i = 0; i < m.steps; i++) {
      const s = performance.now();
      w.updateBegin(TICK);
      w.updateSome(Infinity);
      w.updateEnd();
      const r = performance.now();
      bytes = rec.write();
      steps.push(r - s);
      recs.push(performance.now() - r);
    }
    const avg = a => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3);
    const p99 = a =>
      +a
        .slice()
        .sort((x, y) => x - y)
        [Math.floor(a.length * 0.99)].toFixed(2);
    postMessage({
      ok: true,
      ms,
      put: w.units.length,
      units: w.units.length,
      alive: w.units.filter(u => !u.dead).length,
      shots: w.projectiles.length,
      stepAvg: avg(steps),
      stepP99: p99(steps),
      stepWorst: +Math.max(...steps).toFixed(1),
      recordAvg: avg(recs),
      recordKB: Math.round(bytes / 1024),
      time: +w.time.toFixed(2),
      bySecond: Array.from({ length: Math.ceil(steps.length / 30) }, (_, k) => avg(steps.slice(k * 30, k * 30 + 30)))
    });
  } catch (err) {
    postMessage({ ok: false, error: String((err && err.stack) || err) });
  }
};

async function minds(w, m, map, events, thing) {
  const has = k => (m.switches || []).includes(k);
  const tell =
    name =>
    (...a) => {
      events.push(['game', name, a.map(x => plain(x))]);
    };
  const game = {
    world: w,
    land: false,
    map,
    setup: m.setup,
    human: w.viewer,
    ais: [],
    message: tell('message'),
    setEnvironmentIndex: tell('setEnvironmentIndex'),
    startCinematicRetreat: tell('startCinematicRetreat')
  };
  const scripts = has('noscripts')
    ? null
    : await ScriptHost.create(game).catch(e => {
        console.warn('space worker: scripts', e);
        return null;
      });
  if (scripts) {
    game.scripts = w.scripts = scripts;
    if (!m.net) scripts.budgetMs = 4;
    if (has('noplans')) scripts.plansOff = true;
  }
  const ais = (game.ais = m.ai
    ? w.players.filter(p => p.id >= 0 && !p.human && !p.team.mapSide).map(p => new SkirmishAI(w, p, p.difficulty))
    : []);
  w.goals = has('oldai') ? null : new SpaceGoals(w, () => ais);
  const freeStore = (ai, fs) => {
    if (scripts && fs && fs.space && !has('nofreestore'))
      scripts.freeStore(ai.player, fs.space, () => ai.mine().filter(e => !e.aiPlan), ai);
  };
  for (const ai of ais) freeStore(ai, await aiFreeStore(ai.player.factionName).catch(() => null));
  const takeovers = new Map();
  if (m.net)
    for (const p of w.players.filter(p => p.human))
      takeovers.set(p, {
        brain: await loadSpaceBrain(p.factionName).catch(() => null),
        fs: await aiFreeStore(p.factionName).catch(() => null)
      });
  await Promise.all(ais.map(ai => ai.brainReady));
  const saved = scripts && m.save.battle.scripts;
  let scriptsFrom = scripts ? (saved ? 'the save' : 'the start') : 'none';
  if (scripts && !saved) await scripts.prime().catch(e => console.warn('space worker: scripts', e));
  if (scripts) await scripts.compileAll(3000).catch(() => null);
  if (saved) {
    try {
      restoreBattleScripts(game, saved, null, thing);
    } catch (error) {
      console.warn('space worker: the saved scripts could not be put back, they start over:', error);
      scriptsFrom = 'the start (the saved ones could not be put back: ' + (error.message || error) + ')';
      await scripts.prime().catch(() => null);
    }
  }
  if (m.net) {
    await w.paths?.deterministic?.();
    if (scripts) await scripts.preloadAll();
  }
  let turn = 0;
  const think = () => {
    if (ais.length && !w.aiSuspended) {
      const G = w.goals,
        first = (turn = (turn + 1) % ais.length);
      if (G) {
        if (m.net) G.budget = AI_STEP_WORK;
        else G.deadline = performance.now() + AI_STEP_MS;
      }
      try {
        for (let i = 0; i < ais.length; i++) ais[(first + i) % ais.length].update(TICK);
      } finally {
        if (G) {
          G.deadline = undefined;
          G.budget = undefined;
        }
      }
    }
    if (scripts) scripts.update(TICK);
  };
  const takeOver = p => {
    const pre = takeovers.get(p);
    if (!pre || !pre.brain || p.defeated) return;
    p.human = false;
    p.difficulty = 'medium';
    const ai = new SkirmishAI(w, p, 'medium', pre.brain);
    ais.push(ai);
    freeStore(ai, pre.fs);
  };
  return { think, game, takeOver, scriptsFrom };
}

async function run(m) {
  const events = [],
    spawns = [];
  const { w, ms, ids, map, thing } = await setUp(m, events);
  w.onEvent = (kind, data) => {
    events.push(['world', 'onEvent', [kind, plain(data)]]);
  };
  const { think, game, takeOver, scriptsFrom } = await minds(w, m, map, events, thing);
  events.length = 0;
  const spawn = w.spawn.bind(w);
  w.spawn = (...a) => {
    const en = spawn(...a);
    if (en)
      spawns.push({
        wid: en.id,
        type: en.type.name,
        player: en.player.id,
        x: en.x,
        y: en.y,
        heading: en.heading || 0,
        fighters: en.isSquad ? en.fighters.map(f => f.id) : null
      });
    return en;
  };
  const play = Unit.prototype.playAnim;
  Unit.prototype.playAnim = function (kind, opts) {
    events.push(['unit', 'playAnim', [{ $u: this.id }, kind, plain(opts)]]);
    return play.call(this, kind, opts);
  };
  const entity = id => w.units.find(u => u.id === id) || w.squads.find(q => q.id === id) || null;
  const rec = new SpaceRecorder(w);
  let stepMs = 0,
    steps = 0;
  const step = (cmds, wantHash) => {
    const s = performance.now();
    const hash = wantHash ? stateHash(w) : undefined;
    for (const [pid, cmd] of cmds) {
      const player = w.players.find(p => p.id === pid);
      if (!player) continue;
      if (cmd.c === 'left' && !player.left) takeOver(player);
      let r;
      try {
        r = execute(w, player, cmd) || {};
      } catch (e) {
        console.error('space worker: command', cmd, e);
        continue;
      }
      if (r.why && player === w.viewer) postMessage({ k: 'result', cmd, why: r.why });
    }
    w.updateBegin(TICK);
    w.updateSome(Infinity);
    w.updateEnd();
    think();
    stepMs += performance.now() - s;
    steps++;
    rec.write();
    const units = rec.units.slice(0, rec.nUnits * UNIT),
      shots = rec.shots.slice(0, rec.nShots * SHOT),
      points = rec.points.slice(0, rec.nPoints * POINT),
      abilities = rec.abilities.slice(0, rec.nAbilities * ABILITY);
    postMessage(
      {
        k: 'step',
        time: w.time,
        hash,
        units,
        shots,
        points,
        abilities,
        players: rec.players,
        queues: rec.queues,
        fresh: rec.fresh.slice(),
        spawns: spawns.splice(0),
        events: events.splice(0),
        stepMs: steps % 30 === 0 ? stepMs / 30 : undefined
      },
      [units.buffer, shots.buffer, points.buffer, abilities.buffer]
    );
    if (steps % 30 === 0) stepMs = 0;
  };
  const commands = [];
  let speed = 1,
    paused = false;
  onmessage = e => {
    const c = e.data;
    if (c.k === 'cmd') commands.push([w.viewer ? w.viewer.id : 0, c.cmd]);
    else if (c.k === 'lockstep') step(c.cmds, c.hash);
    else if (c.k === 'pace') {
      speed = c.speed || 1;
      paused = !!c.paused;
    } else if (c.k === 'save') {
      try {
        const v = c.view,
          list = ids => ids.map(entity).filter(Boolean);
        const g = {
          ...game,
          speed: v.speed,
          renderer: { rig: v.camera },
          ui: { groups: new Map(v.groups.map(([n, l]) => [n, list(l)])), selection: list(v.selection) },
          retreat: null,
          campaignBook: null
        };
        postMessage({ k: 'saved', id: c.id, save: snapshot(g, c.name) });
      } catch (err) {
        postMessage({ k: 'saved', id: c.id, error: String((err && err.message) || err) });
      }
    }
  };
  postMessage({ k: 'ready', ms, ids, scriptsFrom });
  if (m.net) return;
  let next = performance.now();
  const tick = () => {
    const now = performance.now();
    let n = 0;
    if (paused) next = now;
    while (!paused && next <= now && n < 4) {
      step(commands.splice(0), false);
      next += (TICK * 1000) / speed;
      n++;
    }
    if (next < now - 200) next = now;
    setTimeout(tick, Math.max(0, next - performance.now()));
  };
  tick();
}
