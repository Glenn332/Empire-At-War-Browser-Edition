import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { openGame } from './megfs.mjs';
import { readBaseline, recordSample, sampleFile, updateBaseline } from './lockstep-baseline.mjs';

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i < 0 ? d : process.argv[i + 1];
};
const flag = k => process.argv.includes(k);
const mod = arg('--mod'),
  mapName = arg('--map', '@dynamic/massive/1891830317'),
  steps = +arg('--steps', 1800),
  ships = +arg('--ships', 60),
  minTps = +arg('--min-tps', 28),
  slack = +arg('--slack', 0.25),
  update = flag('--update'),
  noScripts = flag('--noscripts'),
  verbose = flag('--verbose');

if (update) updateBaseline('lockstep', fileURLToPath(import.meta.url));

const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod ? [mod] : []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('file:')) {
    try {
      return new Response(readFileSync(fileURLToPath(path.split('?')[0])));
    } catch {
      return new Response(null, { status: 404 });
    }
  }
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};

let routeMs = 0;
let routeSeq = 0;
globalThis.onmessage = null;
globalThis.postMessage = () => {};
globalThis.SWR_PAGE_ROUTES = true;
globalThis.SWR_SPAWN_ROUTE = port => {
  const pending = import('../public/js/game/pathworker.js?thread=' + ++routeSeq).then(() => {
    const handle = globalThis.onmessage;
    const inbox = new MessageChannel();
    handle({ data: { kind: 'port', port: inbox.port1 } });
    const deliver = inbox.port1.onmessage;
    inbox.port1.onmessage = null;
    inbox.port1.close();
    inbox.port1.postMessage = m => port.postMessage(m);
    port.onmessage = e => {
      const t = performance.now();
      try {
        deliver(e);
      } finally {
        if (e.data && e.data.kind === 'batch') routeMs += performance.now() - t;
      }
    };
  });
  port.whenReady = pending;
};

const THREE = await import('../public/vendor/three/build/three.module.js');
const { db, loadGameData, spawnList } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadMap } = await import('../public/js/ted.js');
await import('../public/js/game/dynamicmap.js');
const { preloadModels } = await import('../public/js/model.js');
const S = await import('../public/js/game/sim.js');
const { seedSim } = await import('../public/js/game/simrandom.js');
const { execute } = await import('../public/js/game/commands.js');
const { stateHash } = await import('../public/js/game/netgame.js');
const { SkirmishAI } = await import('../public/js/game/ai.js');
const { SpaceGoals } = await import('../public/js/game/spacegoals.js');
const { ScriptHost } = await import('../public/js/game/scripts.js');
const { scriptTypes } = await import('../public/js/game/storyart.js');
const { aiFreeStore } = await import('../public/js/game/landbrain.js');

const TICK = 1 / 30,
  HASH_EVERY = 30,
  ORDER_EVERY = 240,
  AI_STEP_WORK = 80;
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

const map = await loadMap(mapName, { teams: 2 });
assert(map, 'map ' + mapName);
const affiliated = (t, f) =>
  t
    .str('Affiliation')
    .toUpperCase()
    .split(/[,\s]+/)
    .includes(f.toUpperCase());
const stationOf = f => db.type(`Skirmish_${f}_Star_Base_1`) || [...db.types.values()].find(t => new RegExp(`^Skirmish_${f}_Star_Base_1$`, 'i').test(t.name));
const fleetOf = f =>
  [...db.types.values()]
    .filter(
      t =>
        t.tag === 'SpaceUnit' &&
        t.str('Space_Model_Name') &&
        affiliated(t, f) &&
        t.num('Build_Cost_Credits', 0) > 0 &&
        !t.categories().has('HERO') &&
        !t.categories().has('SPACEHERO') &&
        !S.isSquadronType(t) &&
        !t.behaviors().has('FIGHTER_LOCOMOTOR')
    )
    .sort((a, b) => a.name.localeCompare(b.name));
const sides = [
  { faction: 'Empire', team: 0, humans: 2, ais: 0 },
  { faction: 'Underworld', team: 1, humans: 1, ais: 2 }
];
for (const s of sides) {
  s.station = stationOf(s.faction);
  s.fleet = fleetOf(s.faction);
  assert(s.station, 'station for ' + s.faction);
  assert(s.fleet.length, 'fleet for ' + s.faction);
}

const names = new Set(),
  seen = new Set();
for (const s of sides) {
  for (const t of [s.station, ...s.fleet]) {
    S.modelsForType(t, null, names, seen);
    for (const e of spawnList(t, 1)) S.modelsForType(e.type, null, names, seen);
  }
  for (const n of db.faction(s.faction).list('Space_Skirmish_AI_Default_Forces')) {
    const t = db.type(n);
    if (t) S.modelsForType(t, null, names, seen);
  }
}
for (const o of map.objects || []) if (o.type) S.modelsForType(o.type, null, names, seen);
await preloadModels([...names].filter(Boolean));

const half = Math.min(map.max[0] - map.min[0], map.max[1] - map.min[1]) / 2;

async function battle(threads) {
  Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', { value: threads * 3, configurable: true });
  routeMs = 0;
  S.resetEntityIds();
  seedSim(4242);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.skirmish = true;
  w.fog = true;
  const players = [];
  let id = 0;
  for (const s of sides) {
    const team = w.addTeam(new S.Team(s.team, s.faction)),
      sx = (s.team ? 1 : -1) * half * 0.12;
    team.spawnPoints.push({ x: sx, y: 0, heading: s.team ? Math.PI : 0 });
    for (let k = 0; k < s.humans + s.ais; k++) {
      const human = k < s.humans,
        p = w.addPlayer(new S.Player(id++, team, { human, credits: 30000, difficulty: human ? undefined : 'hard', color: new THREE.Color(0xffffff) }));
      players.push(p);
      const y = (k - (s.humans + s.ais - 1) / 2) * half * 0.1;
      if (!team.station) team.station = team.firstStation = w.spawn(s.station, p, sx, y, s.team ? Math.PI : 0);
      for (let i = 0; i < ships; i++) {
        const t = s.fleet[(i * 7 + k * 3) % s.fleet.length],
          col = i % 8,
          row = Math.floor(i / 8);
        w.spawn(t, p, sx + (s.team ? 1 : -1) * (600 + row * 320), y + (col - 3.5) * 260, s.team ? Math.PI : 0);
      }
    }
  }
  w.viewer = players[0];
  w.recountPop();
  const game = {
    world: w,
    land: false,
    map,
    setup: { mode: 'space', mapFile: mapName, seed: 4242, net: { me: 0 } },
    human: w.viewer,
    ais: [],
    message() {},
    setEnvironmentIndex() {},
    startCinematicRetreat() {}
  };
  const scripts = noScripts ? null : await ScriptHost.create(game);
  if (scripts) {
    const named = new Set(),
      known = new Set(),
      more = new Set();
    for (const e of [...w.units, ...w.squads]) if (e.type) named.add(e.type.str('Lua_Script').trim());
    for (const t of await scriptTypes([...named]).catch(() => [])) S.modelsForType(t, null, more, known);
    await preloadModels([...more].filter(Boolean)).catch(() => null);
    game.scripts = w.scripts = scripts;
  }
  const ais = (game.ais = players.filter(p => !p.human).map(p => new SkirmishAI(w, p, 'hard')));
  w.goals = new SpaceGoals(w, () => ais);
  for (const ai of ais) {
    const fs = await aiFreeStore(ai.player.factionName).catch(() => null);
    if (scripts && fs && fs.space) scripts.freeStore(ai.player, fs.space, () => ai.mine().filter(e => !e.aiPlan), ai);
  }
  await Promise.all(ais.map(ai => ai.brainReady));
  if (scripts) {
    await scripts.prime();
    await scripts.compileAll(3000);
  }
  await w.paths.deterministic();
  if (scripts) await scripts.preloadAll();
  const spots = [
    [-0.8, 0.8],
    [0.8, -0.8],
    [0.7, 0.7],
    [-0.7, -0.7],
    [0, 0],
    [0.5, -0.2]
  ];
  const humans = players.filter(p => p.human),
    log = [],
    simMs = [],
    routeAt = [];
  let turn = 0,
    held = 0,
    shots = 0;
  for (let step = 0; step < steps; step++) {
    for (let spin = 0; !w.paths.ready(); spin++) {
      if (spin > 200000) throw new Error('route answers never arrived at step ' + step);
      held++;
      await new Promise(r => setImmediate(r));
    }
    if (step % HASH_EVERY === 0) log.push(stateHash(w));
    if (step % ORDER_EVERY === 0) {
      const k = step / ORDER_EVERY;
      humans.forEach((p, i) => {
        const [fx, fy] = spots[(i + k) % spots.length],
          list = [...w.units.filter(u => u.player === p && !u.dead && u.isMobile && !u.squad), ...w.squads.filter(q => q.player === p && !q.dead)];
        if (k % 2 === 0) execute(w, p, { c: 'move', u: list.map(e => e.id), x: (i - 1) * 500, y: (i - 1) * 300, attack: true });
        else execute(w, p, { c: 'move', u: list.map(e => e.id), x: fx * half * 0.15, y: fy * half * 0.15, attack: false });
      });
    }
    const t0 = performance.now();
    w.updateBegin(TICK);
    w.updateSome(Infinity);
    w.updateEnd();
    if (ais.length && !w.aiSuspended) {
      const first = (turn = (turn + 1) % ais.length);
      w.goals.budget = AI_STEP_WORK;
      try {
        for (let i = 0; i < ais.length; i++) ais[(first + i) % ais.length].update(TICK);
      } finally {
        w.goals.budget = undefined;
      }
    }
    if (scripts) scripts.update(TICK);
    simMs.push(performance.now() - t0);
    shots = Math.max(shots, (w.projectiles || []).length);
    routeAt.push(routeMs);
    if (step % 30 === 0) await new Promise(r => setImmediate(r));
  }
  const units = w.units.filter(u => !u.dead).length,
    squads = w.squads.filter(q => !q.dead).length;
  w.paths.stop?.();
  const routePer = routeAt.map((v, i) => v - (routeAt[i - 1] || 0));
  return { log, simMs, routePer, units, squads, held, lost: players.reduce((n, p) => n + p.stats.lost, 0), scripts: scripts ? scripts.instances.filter(i => i.state === 'run').length : 0, shots, gap: (() => { const c = t => { const l = w.units.filter(u => !u.dead && u.player.team?.id === t && u.isMobile); return [l.reduce((x, u) => x + u.x, 0) / Math.max(1, l.length), l.reduce((y, u) => y + u.y, 0) / Math.max(1, l.length), l.length]; }; const a = c(0), b = c(1); return [Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])), a[2], b[2]]; })() };
}

const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
function rates(r, threads) {
  let worst = 30;
  for (let i = 0; i + 30 <= r.simMs.length; i += 30) {
    const sim = r.simMs.slice(i, i + 30).reduce((x, y) => x + y, 0),
      route = r.routePer.slice(i, i + 30).reduce((x, y) => x + y, 0) / threads;
    worst = Math.min(worst, (30 * 1000) / Math.max(1000, sim, route));
  }
  const sim = mean(r.simMs),
    route = mean(r.routePer) / threads;
  return { sustained: Math.min(30, 1000 / Math.max(1000 / 30, sim, route)), worst };
}

const t0 = performance.now();
const a = await battle(2),
  b = await battle(4),
  c = await battle(2);
const firstDiff = (x, y) => {
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i;
  return -1;
};
const dAB = firstDiff(a.log, b.log),
  dAC = firstDiff(a.log, c.log);
const two = rates(a, 2),
  four = rates(a, 4);
const now = {
  simMs: +mean(a.simMs).toFixed(2),
  simP99: +pct(a.simMs, 0.99).toFixed(2),
  routeMs: +mean(a.routePer).toFixed(2),
  tps2: +two.sustained.toFixed(1),
  worst2: +two.worst.toFixed(1),
  tps4: +four.sustained.toFixed(1),
  worst4: +four.worst.toFixed(1)
};
console.log(
  `lockstep: ${mapName}, ${steps} steps, ${a.units} ships and stations, ${a.squads} squadrons at the end, ${a.lost} lost in the fighting, ${noScripts ? 'no Lua AI scripts' : a.scripts + ' Lua AI scripts'}, ${a.log.length} checkpoints, ${Math.round((performance.now() - t0) / 1000)} s`
);
console.log(
  `  step ${now.simMs} ms (p99 ${now.simP99}), route searches ${now.routeMs} ms a step; 2 route threads ${now.tps2} ticks/s (worst second ${now.worst2}), 4 threads ${now.tps4} (worst ${now.worst4})`
);
if (verbose) console.log('  peak shots', a.shots, 'team gap and mobile counts', a.gap, 'held', a.held);
if (verbose) console.log('  hashes', a.log.slice(0, 8).join(' '), '...');

const fails = [];
if (dAC >= 0) fails.push(`the same battle ran differently twice: checkpoint ${dAC} (step ${dAC * HASH_EVERY}) differs`);
if (dAB >= 0) fails.push(`2 and 4 route threads went apart at checkpoint ${dAB} (step ${dAB * HASH_EVERY})`);
if (now.worst2 < minTps) fails.push(`with 2 route threads the worst second falls to ${now.worst2} ticks/s (minimum ${minTps})`);

const sample = sampleFile();
const key = `${hostname()}|${mapName}|${steps}|${ships}|${mod || ''}${noScripts ? '|noscripts' : ''}`;
const base = sample ? null : readBaseline('lockstep', key);
if (base) {
  if (now.simMs > base.simMs * (1 + slack)) fails.push(`a step takes ${now.simMs} ms, ${Math.round((now.simMs / base.simMs - 1) * 100)}% over the baseline ${base.simMs} ms`);
  if (now.routeMs > base.routeMs * (1 + slack) && now.routeMs - base.routeMs > 0.5)
    fails.push(`route searches take ${now.routeMs} ms a step, ${Math.round((now.routeMs / base.routeMs - 1) * 100)}% over the baseline ${base.routeMs} ms`);
  console.log(`  baseline ${base.simMs} ms a step, ${base.routeMs} ms routes (${base.at})`);
} else if (!sample)
  console.log('  no baseline for this machine yet: run with --update to keep the median of three runs');
if (sample) recordSample(sample, key, now);
if (fails.length) {
  for (const f of fails) console.error('FAIL ' + f);
  process.exit(1);
}
console.log('ok');
process.exit(0);
