// Multiplayer land battles stay in agreement when files load at different speeds on each machine.
//
// The same headless land lockstep battle runs twice in child processes. Mid battle two mixed companies (whose models
// were not preloaded) and a landing transport are asked for; in run A every file request is answered at once in the
// order it was made, in run B one request is answered per frame, newest first, so the loads finish in another order
// and straddle ticks. The companies' members must come out in the same order, with the same ids, types and places,
// and the battle hashes and random draws must match. The runs also check a spinning flier wreck, an arriving
// company's health, the desync report's NaN handling and the battle report kept over a resync.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { openGame } from './megfs.mjs';

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i < 0 ? d : process.argv[i + 1];
};
const flag = k => process.argv.includes(k);
const mod = arg('--mod'),
  mapPick = arg('--map', 'TATOOINE'),
  ticks = +arg('--ticks', 600);

if (!flag('--child')) {
  const run = mode => {
    const pass = process.argv.slice(2);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', '--mode', mode, ...pass], {
      encoding: 'utf8',
      maxBuffer: 64 << 20
    });
    const line = (r.stdout || '').trim().split('\n').reverse().find(l => l.startsWith('{"result"'));
    if (!line) {
      console.error((r.stderr || r.stdout || '').slice(-3000));
      throw new Error(`the ${mode} run did not finish`);
    }
    return JSON.parse(line).result;
  };
  const a = run('fast'),
    b = run('slow');
  const fails = [];
  const same = (what, x, y) => {
    const sx = JSON.stringify(x),
      sy = JSON.stringify(y);
    if (sx !== sy) {
      let i = 0;
      while (i < sx.length && sx[i] === sy[i]) i++;
      fails.push(`${what} differ: ...${sx.slice(Math.max(0, i - 80), i + 80)}\n   vs ...${sy.slice(Math.max(0, i - 80), i + 80)}`);
    }
  };
  console.log(`land desync: ${a.map}; companies ${a.picked.join(', ')}; transport ${a.transport || 'none'}`);
  console.log(`  fast run: ${a.held} frames held for loading, slow run: ${b.held} frames held, ${b.answered} file answers spread over frames`);
  if (!(b.held > 0)) fails.push('the slow run never had to wait for a load: the test did not exercise late files');
  same('company members (order, ids, types, places)', a.members, b.members);
  same('arrival ticks', a.arrived, b.arrived);
  same('transports', a.transports, b.transports);
  same('random draws', a.draws, b.draws);
  same('battle hashes', a.log, b.log);
  for (const r of [a, b]) for (const f of r.fails) fails.push(`${r.mode}: ${f}`);
  if (fails.length) {
    for (const f of fails) console.error('FAIL ' + f);
    process.exit(1);
  }
  console.log(`  ${a.members.length} members in the same order, ${a.log.length} hashes and ${a.draws} random draws the same`);
  console.log('ok');
  process.exit(0);
}

const mode = arg('--mode', 'fast');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod ? [mod] : []);
// Model and animation requests can be held back and answered later (see answer()).
const held = [];
let holding = false,
  answered = 0;
const serve = path => {
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
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
  if (holding && /art[\\/]+models/i.test(decodeURIComponent(path))) return new Promise(r => held.push(() => r(serve(path))));
  return serve(path);
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
const { SpectatorView } = await import('../public/js/game/spectator.js');
const { unitDetail } = await import('../public/js/game/desyncreport.js');
const { seedSim, simRandomDraws, simRandomState, setSimRandomState } = await import('../public/js/game/simrandom.js');
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
  seed: 91,
  players: [
    { human: true, peer: 0, name: 'A', team: 0, color: '#ff0000' },
    { human: true, peer: 0, name: 'B', team: 1, color: '#0000ff' }
  ],
  net: { session: { id: 0, on: () => () => {}, send() {}, broadcast() {} }, me: 0 },
  headless: { ui: nothing, cine: nothing, cam: { start: 1200 } }
};
const audio = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : k === 'audioXml' || k === 'useAudioMode' ? () => Promise.resolve(null) : nothing) });
const g = new LandGame(setup, { audio, progress() {} });
await g.start();
const w = g.world,
  L = g.lock;
const fails = [];

// Companies of more than one member type from a faction that is not in the battle, so their files were not preloaded.
const affiliated = t =>
  t
    .list('Affiliation')
    .map(x => x.toUpperCase())
    .some(x => sides.some(s => s.toUpperCase() === x));
const mixed = [...db.types.values()]
  .filter(t => t.has('Company_Units') && !affiliated(t))
  .filter(t => {
    const ks = t
      .list('Company_Units')
      .map(n => db.type(n))
      .filter(k => k && k.str('Land_Model_Name'));
    return ks.length >= 3 && new Set(ks.map(k => k.name)).size >= 2;
  })
  .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
const picked = mixed.slice(0, 2);
if (picked.length < 2) fails.push('no two mixed companies outside the battle factions to spawn');
const hauled = [...db.types.values()]
  .filter(t => t.has('Company_Units') && affiliated(t) && db.type(t.str('Company_Transport_Unit') || ''))
  .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))[0];

const own = w.squads.filter(q => q.side === 0 && !q.dead && q.members[0] && !q.structure);
const home = own.length ? own[0].members[0] : { x: 1000, y: 1000 };
const spot = k => (w.nearestOpen ? w.nearestOpen(home.x + 160 + k * 120, home.y) || { x: home.x, y: home.y } : { x: home.x, y: home.y });

// one request answered per call, newest first (slow), or all of them in the order they were made (fast)
const answer = () => {
  if (!held.length) return;
  if (mode === 'slow') {
    held.pop()();
    answered++;
  } else for (const r of held.splice(0)) r();
};
const before = L.tick;
const arrived = [];
const wants = [];
const at = 30;
let heldFrames = 0;
for (let frame = 0; L.tick < before + ticks && frame < ticks * 20; frame++) {
  if (L.tick === before + at && !wants.length) {
    holding = true;
    picked.forEach((t, k) => {
      const p = spot(k);
      wants.push(Promise.resolve(w.spawn(t.name, p.x, p.y, 0, 0)).then(q => arrived.push([t.name, L.tick, q ? q.id : null])));
    });
    if (hauled) {
      const p = spot(3);
      wants.push(Promise.resolve(w.reinforce(0, hauled.name, p.x, p.y, 0)).then(t => arrived.push([hauled.name, L.tick, t ? 'transport' : null])));
    }
  }
  if (holding) answer();
  const t0 = L.tick;
  g.owed = 1 / 30;
  await g.pump();
  if (L.tick === t0) {
    if (w.spawnsPending > 0) heldFrames++;
    // let the file answers come in, as the next frame would
    await new Promise(r => setTimeout(r, 1));
  }
}
holding = false;
for (const r of held.splice(0)) r();
await Promise.all(wants);
if (L.tick < before + ticks) fails.push(`the battle stopped at tick ${L.tick - before}: ${L.blocked}`);

const members = [];
for (const q of w.squads)
  if (picked.some(t => t === q.type))
    for (const u of q.members) members.push([q.id, w.units.indexOf(u), u.type.name, +u.x.toFixed(6), +u.y.toFixed(6), +u.heading.toFixed(6)]);
if (picked.length && !members.length) fails.push('the companies never came');
const transports = w.transports.map(t => [t.typeName, w.units.indexOf(t.craft), t.craft.squad.id, t.stage]);
const draws = simRandomDraws(),
  log = L.log.slice();

// --- the checks below change the battle, so they come after what the two runs compare ---
const state = simRandomState();
const check = (name, fn) => {
  try {
    fn();
  } catch (e) {
    fails.push(name + ": " + e.message);
  }
};
// a spinning wreck stays a unit until it lands: its path comes from the simulation's generator
check("spinning wreck", () => {
  const u = { x: 1500, y: 1500, z: 300, air: { vx: 120, vy: -40, vz: -10 }, type: db.type(picked[0]?.name || 'Rebel_Infantry_Squad') };
  seedSim(5);
  const p1 = w.spinAway(u).path?.pts;
  seedSim(5);
  const p2 = w.spinAway(u).path?.pts;
  if (!p1 || JSON.stringify(p1) !== JSON.stringify(p2)) fails.push('a spinning flier wreck takes a different path from the same random state');
  setSimRandomState(state);
});
// an arriving company holds a placeholder member until its transport lands: its health is still a number
check("arriving company", () => {
  const t = hauled || picked[0];
  const q = w.squadOf(t, 0, { arriving: true });
  q.members = [0];
  if (![q.health, q.maxHealth, q.shield, q.maxShield, q.healthFrac].every(Number.isFinite))
    fails.push(`an arriving company's health is ${q.health}, shield ${q.shield}`);
  w.squads.push(q);
  const row = unitDetail(w).find(r => r[15] === 1 && r[0] === (q.id ?? 's' + (w.squads.length - 1)));
  if (!row || row.slice(4, 11).some(v => typeof v === 'number' && !Number.isFinite(v))) fails.push('the desync report row of an arriving company holds NaN');
  w.squads.pop();
  const nan = { id: 'x', type: t, side: 0, x: NaN, y: 1, z: 1, heading: 0, health: NaN, shield: Infinity };
  const r2 = unitDetail({ units: [nan], squads: [] })[0];
  if (JSON.parse(JSON.stringify(r2))[4] !== 'NaN' || r2[10] !== 'Infinity') fails.push('the desync report sends NaN as null');
});
// the battle report goes on over a resync instead of starting again at nothing
check("battle report over a resync", () => {
  const R = g.reportView;
  if (!R) fails.push('no battle report view');
  else {
    R.update();
    R.src.tally[0].built += 7;
    R.src.tally[1].lost += 3;
    const peak = R.stats[0].peak;
    const k = g.keepReport();
    g.setup.keepReport = k;
    const next = L.nextSetup();
    if ('keepReport' in next) fails.push('the resync setup sent to the other machines carries the local battle report');
    delete g.setup.keepReport;
    R.destroy();
    g.reportView = new SpectatorView(g, 'land', { quiet: true });
    g.takeReport(JSON.parse(JSON.stringify(k)));
    const T = g.reportView.src.tally;
    if (T[0].built !== k.view.tally[0].built || T[1].lost !== k.view.tally[1].lost) fails.push(`the report counts start again after a resync: ${JSON.stringify(T)}`);
    if (g.reportView.history.length < k.view.history.length) fails.push('the combat power graph starts again after a resync');
    if (g.reportView.stats[0].peak !== peak) fails.push('the peak power starts again after a resync');
    g.reportView.destroy();
  }
});

console.log = quiet;
console.log(
  JSON.stringify({
    result: {
      mode,
      map: mapFile,
      picked: picked.map(t => t.name),
      transport: hauled?.name || null,
      held: heldFrames,
      answered,
      members,
      arrived: arrived.sort(),
      transports,
      draws,
      log,
      fails
    }
  })
);
process.exit(0);
