import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { openGame } from './megfs.mjs';
import { readBaseline, recordSample, sampleFile, updateBaseline } from './lockstep-baseline.mjs';

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i < 0 ? d : process.argv[i + 1];
};
const flag = k => process.argv.includes(k);
const mod = arg('--mod'),
  mapPick = arg('--map', 'TATOOINE'),
  steps = +arg('--steps', 1800),
  companies = +arg('--companies', 24),
  minTps = +arg('--min-tps', 20),
  slack = +arg('--slack', 0.25),
  // most path searches one tick may run: planning a group attack once ran several thousand in a tick
  maxSearches = +arg('--max-searches', 2500),
  // --ai-army gives the spawned companies to the computer players and sends no orders for the human ones
  aiArmy = flag('--ai-army'),
  // --probe 12 lists the 12 slowest ticks with the methods that took the time (tools/landprobe.mjs)
  probeTicks = flag('--probe') ? +arg('--probe') || 12 : 0,
  update = flag('--update'),
  verbose = flag('--verbose');

if (update) updateBaseline('lockstep-land', fileURLToPath(import.meta.url));
const HASH_EVERY = 30,
  ORDER_EVERY = 240;

if (!flag('--child')) {
  const pass = process.argv.slice(2).filter(a => a !== '--update' && a !== '--verbose');
  const run = () => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', ...pass], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const line = (r.stdout || '').trim().split('\n').reverse().find(l => l.startsWith('{"result"'));
    if (!line) {
      console.error((r.stderr || r.stdout || '').slice(-3000));
      throw new Error('a land battle run did not finish');
    }
    return JSON.parse(line).result;
  };
  const t0 = performance.now();
  const a = run(),
    b = run();
  let diff = -1;
  for (let i = 0; i < Math.max(a.log.length, b.log.length); i++)
    if (a.log[i] !== b.log[i]) {
      diff = i;
      break;
    }
  const mean = l => l.reduce((x, y) => x + y, 0) / Math.max(1, l.length);
  const pct = (l, p) => [...l].sort((x, y) => x - y)[Math.min(l.length - 1, Math.floor(l.length * p))];
  let worst = 30,
    worstAt = 0;
  for (let i = 0; i + 30 <= a.ms.length; i += 30) {
    const tps = (30 * 1000) / Math.max(1000, a.ms.slice(i, i + 30).reduce((x, y) => x + y, 0));
    if (tps < worst) [worst, worstAt] = [tps, i / 30];
  }
  const now = { stepMs: +mean(a.ms).toFixed(2), p99: +pct(a.ms, 0.99).toFixed(2), worst: +worst.toFixed(1) };
  console.log(
    `land lockstep: ${a.map}, ${a.sides.join(' vs ')}, ${a.steps} steps, ${a.squads} squads and ${a.units} units at the end, ${a.lost} fewer units than at the start, ${a.scripts} Lua scripts, ${a.log.length} checkpoints, ${Math.round((performance.now() - t0) / 1000)} s`
  );
  console.log(`  step ${now.stepMs} ms (p99 ${now.p99}), worst second ${now.worst} ticks/s (second ${worstAt})`);
  let mostSearches = 0,
    searchedAt = 0;
  a.searches.forEach((n, i) => {
    if (n > mostSearches) [mostSearches, searchedAt] = [n, i];
  });
  console.log(`  slowest step ${Math.max(...a.ms).toFixed(0)} ms, most path searches in one step ${mostSearches} (step ${searchedAt})`);
  if (verbose) console.log('  hashes', a.log.slice(0, 6).join(' '));
  if (a.probe)
    for (const [i, t] of a.probe
      .map((t, i) => [i, t])
      .sort((x, y) => y[1].ms - x[1].ms)
      .slice(0, probeTicks)
      .sort((x, y) => x[0] - y[0]))
      console.log(`  step ${i}: ${t.ms.toFixed(0)} ms  ` + t.top.map(m => `${m[0]} ${m[1].toFixed(0)}/${m[2]}`).join(', '));
  const fails = [];
  if (diff >= 0) fails.push(`the same land battle ran differently twice: checkpoint ${diff} (step ${diff * HASH_EVERY}) differs`);
  if (mostSearches > maxSearches)
    fails.push(`step ${searchedAt} ran ${mostSearches} path searches (at most ${maxSearches}): a plan is trying every place again`);
  if (now.worst < minTps) fails.push(`the worst second falls to ${now.worst} ticks/s (second ${worstAt}, minimum ${minTps})`);
  const sample = sampleFile();
  const key = `${hostname()}|${a.map}|${steps}|${companies}|${mod || ''}`;
  const base = sample ? null : readBaseline('lockstep-land', key);
  if (base) {
    if (now.stepMs > base.stepMs * (1 + slack) && now.stepMs - base.stepMs > 0.2)
      fails.push(`a land step takes ${now.stepMs} ms, ${Math.round((now.stepMs / base.stepMs - 1) * 100)}% over the baseline ${base.stepMs} ms`);
    console.log(`  baseline ${base.stepMs} ms a step (p99 ${base.p99}, ${base.at})`);
  } else if (!sample)
    console.log('  no baseline for this machine yet: run with --update to keep the median of three runs');
  if (sample) recordSample(sample, key, now);
  if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
  }
  console.log('ok');
  process.exit(0);
}

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
const nothing = new Proxy(function () {}, {
  get: (t, k) =>
    k === Symbol.toPrimitive
      ? h => (h === 'string' ? 'WebGL 2.0' : 0)
      : k === 'then'
        ? undefined
        : k === Symbol.iterator
          ? function* () {}
          : k === 'length'
            ? 0
            : nothing,
  apply: () => nothing,
  construct: () => nothing,
  set: () => true
});
const quiet = console.log;
console.log = () => {};
console.warn = () => {};
console.info = () => {};
const errorOut = console.error;
console.error = (...x) => errorOut(...x.map(v => (v && v.stack) || v));
globalThis.window = globalThis;
globalThis.document = nothing;
globalThis.location = { search: '?nomenu&nowarm', href: 'http://localhost/play.html', pathname: '/play.html' };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.Image = class {
  set src(v) {
    setTimeout(() => this.onerror?.(), 0);
  }
};
globalThis.ImageData = class {
  constructor(d, w, h) {
    this.data = d;
    this.width = w;
    this.height = h;
  }
};
globalThis.HTMLCanvasElement = class {};
globalThis.HTMLElement = class {};
globalThis.Element = class {};
{
  const m = await import('fengari');
  globalThis.fengari = m.default || m;
}
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { LandGame } = await import('../public/js/game/landgame.js');
globalThis.Worker = class {
  postMessage() {}
  terminate() {}
  addEventListener() {}
};
const maps = [...archive.index.keys()].filter(n => /MAPS.*_LAND.*\.TED$/i.test(n)).map(n => n.split(String.fromCharCode(92)).pop());
const mapFile = maps.filter(m => m.toUpperCase().includes(mapPick.toUpperCase())).sort()[0] || maps.sort()[0];
const sides = ['Empire', 'Rebel'];
const setup = {
  mode: 'land',
  mapFile,
  credits: 20000,
  popCap: 0,
  fog: true,
  preBuilt: true,
  teamFactions: sides,
  seed: 77,
  players: [
    { human: true, peer: 0, name: 'A', team: 0, color: '#ff0000' },
    { human: true, peer: 0, name: 'B', team: 1, color: '#0000ff' },
    { human: false, team: 0, difficulty: 'hard', color: '#ffff00' },
    { human: false, team: 1, difficulty: 'hard', color: '#00ff00' }
  ],
  net: { session: { id: 0, on: () => () => {}, send() {}, broadcast() {} }, me: 0 },
  headless: { ui: nothing, cine: nothing, cam: { start: 1200 } }
};
const audio = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : k === 'audioXml' || k === 'useAudioMode' ? () => Promise.resolve(null) : nothing) });
const g = new LandGame(setup, { audio, progress() {} });
await g.start();
const w = g.world,
  L = g.lock;
const centre = side => {
  const own = w.squads.filter(q => q.side === side && !q.dead && q.members[0]);
  const n = Math.max(1, own.length);
  return { x: own.reduce((s, q) => s + q.members[0].x, 0) / n, y: own.reduce((s, q) => s + q.members[0].y, 0) / n };
};
const roster = f =>
  db
    .faction(f)
    .list('Land_Skirmish_AI_Default_Forces')
    .map(n => db.type(n))
    .filter(t => t && t.has('Company_Units'));
const homes = sides.map((f, side) => centre(side));
for (const [side, f] of sides.entries()) {
  const list = roster(f);
  if (!list.length) continue;
  const h = homes[side];
  for (let i = 0; i < companies; i++) {
    const t = list[i % list.length],
      a = (i / companies) * Math.PI * 2,
      r = 250 + (i % 3) * 120,
      spot = w.nearestOpen ? w.nearestOpen(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r) || { x: h.x, y: h.y } : { x: h.x, y: h.y };
    await w.spawn(t.name, spot.x, spot.y, 0, aiArmy ? side + 2 : side);
  }
}
const startUnits = w.units.filter(u => !u.dead).length;
const humans = setup.players.map((p, i) => (p.human ? i : -1)).filter(i => i >= 0);
const ms = [];
const probe = probeTicks
  ? (await import('./landprobe.mjs')).installProbe({ world: w, game: g, paths: w.paths, scripts: g.scripts, lock: L })
  : null;
const searches = [];
let searched = 0;
{
  const search = w.paths.search;
  w.paths.search = function (...args) {
    searched++;
    return search.apply(this, args);
  };
}
for (let step = 0; step < steps; step++) {
  if (step % ORDER_EVERY === 0 && !aiArmy)
    for (const pid of humans) {
      const side = setup.players[pid].team,
        foe = homes[1 - side],
        mine = w.squads.filter(q => q.side === side && !q.dead && q.isMobile && !q.native && q.members.length);
      if (mine.length) L.collected.push([pid, { c: 'move', u: mine.map(q => q.id), x: foe.x, y: foe.y, mode: (step / ORDER_EVERY) % 2 ? 'move' : 'attackmove' }]);
    }
  const before = L.tick,
    t0 = performance.now();
  g.owed = 1 / 30;
  await g.pump();
  ms.push(performance.now() - t0);
  searches.push(searched);
  searched = 0;
  if (probe) probe.end(ms[ms.length - 1]);
  if (L.tick === before) throw new Error('the land lockstep did not step at ' + step + ': ' + L.blocked);
}
console.log = quiet;
console.log(
  JSON.stringify({
    result: {
      map: mapFile,
      sides,
      steps,
      log: L.log,
      ms,
      searches,
      probe: probe?.ticks,
      squads: w.squads.filter(q => !q.dead).length,
      units: w.units.filter(u => !u.dead).length,
      lost: startUnits - w.units.filter(u => !u.dead).length,
      scripts: g.scripts?.host?.instances?.filter(i => i.state === 'run').length ?? 0
    }
  })
);
process.exit(0);
