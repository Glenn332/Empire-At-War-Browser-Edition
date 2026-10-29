import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const modPath = arg('--mod', null),
  seconds = +arg('--seconds', 100),
  after = +arg('--after', 60);
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), modPath ? [modPath] : []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
let seed = 0x5a01318;
Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy, isHumanFaction } = await import('../public/js/game/galaxy.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const { GalacticAI } = await import('../public/js/game/galacticai.js');
const { stepIncome } = await import('../public/js/game/galacticeconomy.js');
const { stepProduction } = await import('../public/js/game/galacticproduction.js');
const { stepFleets } = await import('../public/js/game/fleets.js');
const { pauseGalactic } = await import('../public/js/game/galacticpause.js');
const { GalacticBattles } = await import('../public/js/game/galacticbattles.js');
const { seedSim } = await import('../public/js/game/simrandom.js');
const { stepVisibility } = await import('../public/js/game/galacticfog.js');
const data = await loadCampaignData();
const campaign = data.campaigns.get(modPath ? 'KNOWNSMALL_ERA_1_EMPIRE' : arg('--campaign', 'SANDBOX_EQUAL_FOOTING_EMPIRE'));
const dt = 1 / 15;

const makeGame = async restore => {
  const galaxy = startingGalaxy(data, campaign);
  if (restore) applyGalaxy(galaxy, restore);
  stepVisibility(galaxy, galaxy.active);
  const game = {
    galaxy,
    me: galaxy.active,
    isHuman: f => isHumanFaction(galaxy, f),
    setup: restore ? { difficulty: 'hard', restore } : { difficulty: 'hard' },
    paused: false,
    userPaused: false,
    galacticPauseCount: 0,
    neutralizePopup: { close() {}, open() {} },
    scriptUI: { visibility() {}, enable() {}, text() {}, icon() {}, click() {} },
    onLoadCampaign() {},
    showStoryDialog() {},
    showScreenText() {},
    audio: { speech: { replace() {}, stopActive() {} } },
    movies: { play() {}, stop() {} }
  };
  game.pauseGalactic = on => pauseGalactic(game, on);
  game.story = await GalacticStoryHost.create(game);
  game.ai = await GalacticAI.create(game);
  game.battles = new GalacticBattles(game);
  return game;
};
const realNow = performance.now.bind(performance);
const step = async game => {
  performance.now = () => 0;
  try {
    await stepNow(game);
  } finally {
    performance.now = realNow;
  }
};
const stepNow = async game => {
  const { galaxy, story, ai } = game;
  story.update(dt, game.paused);
  if (story.pending.size) await Promise.all([...story.pending.values()]);
  ai.income(stepIncome(galaxy, dt));
  ai.update(dt);
  stepProduction(galaxy, dt, ai.productionHooks);
  stepFleets(galaxy, dt * 30, (f, p) => {
    ai.invalidate();
    game.battles.arrive(f, p);
  });
  game.battles.update();
};
const run = async (game, s) => {
  for (let i = 0; i < s / dt; i++) await step(game);
};
const idOf = (galaxy, r) => {
  for (const p of galaxy.planets)
    for (const l of ['garrison', 'groundStructures', 'orbitalStructures']) {
      const i = p[l].indexOf(r);
      if (i >= 0) return p.index + l[0] + i;
    }
  const fleets = galaxy.fleets.filter(f => f.units.length);
  for (let f = 0; f < fleets.length; f++) {
    const i = fleets[f].units.indexOf(r);
    if (i >= 0) return 'f' + f + '.' + i;
  }
  return '?';
};
const summary = game =>
  JSON.stringify({
    plans: game.ai.plans.live
      .filter(i => i.state === 'run')
      .map(i => ({
        id: i.id,
        name: i.name,
        goal: i.goal,
        thing: i.thing?.index,
        gd: i.gd,
        retained: i.retained,
        removable: i.removable,
        born: i.born,
        next: i.next,
        threads: i.threads.map(t => [t.id, t.started]),
        budget: i.budget && [i.budget.requested, i.budget.allocated, i.budget.saved, i.budget.immediate],
        forces: i.forces.map(f => [
          f.name,
          f.stage?.index,
          f.units.map(u => idOf(game.galaxy, u)).filter(u => u !== '?'),
          f.produced,
          f.had,
          f.jobs.map(j => [j.complete, j.failed, !!j.queue, !!j.record, j.orphan, j.stage?.index])
        ])
      })),
    reservations: [...game.ai.plans.reservations].map(([r, i]) => [idOf(game.galaxy, r), i.id]).filter(([r]) => r !== '?'),
    jobs: game.ai.plans.jobs.size,
    history: game.ai.plans.history.length,
    errors: Object.fromEntries(game.ai.errors)
  });
const world = game => {
  const s = JSON.parse(JSON.stringify(snapshotGalaxy(game.galaxy)));
  delete s.storyLua;
  delete s.ai;
  return JSON.stringify(s);
};

const show = (sa, sb) => {
  const a = JSON.parse(sa),
    b = JSON.parse(sb);
  const walk = (x, y, path) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return false;
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (walk(x[k], y[k], path + '.' + k)) return true;
      return true;
    }
    console.log(' first difference at', path, 'A', JSON.stringify(x), 'B', JSON.stringify(y));
    return true;
  };
  walk(a, b, '');
};
const A = await makeGame(null);
await run(A, 3);
await run(A, seconds);
const running = A.ai.plans.live.filter(i => i.state === 'run');
console.log('plans running', running.length, running.map(i => i.name).join(' '));
assert(running.length, 'some plans are running to save');
assert.deepEqual(Object.fromEntries(A.ai.errors), {}, 'the plans run clean before the save');

for (const S of A.ai.goals.sides.values()) {
  S.mind = null;
  S.mindAt = -1;
}
A.ai.invalidate();
A.ai.plans.routeCache.clear();
for (const c of A.ai.controllers.values()) {
  delete c.components;
  delete c.islands;
  delete c.connectors;
}
A.battles = new GalacticBattles(A);
const t0 = performance.now();
const snapshot = JSON.parse(JSON.stringify(snapshotGalaxy(A.galaxy)));
console.log('save took', Math.round(performance.now() - t0), 'ms');
assert(!A.ai.plans.saveError, 'the plans were written: ' + A.ai.plans.saveError);
assert.equal(snapshot.ai.plans.insts.length, running.length, 'every running plan is in the save');
console.log(
  'plans state',
  JSON.stringify(snapshot.ai.plans).length,
  'bytes,',
  snapshot.ai.plans.lua.nodes.length,
  'nodes, whole save',
  JSON.stringify(snapshot).length
);

const t1 = performance.now();
const B = await makeGame(snapshot);
console.log('load took', Math.round(performance.now() - t1), 'ms');
assert.deepEqual(Object.fromEntries(B.ai.errors), {}, 'the load is clean');
B.ai.controllers = new Map([...A.ai.controllers.keys()].map(k => [k, B.ai.controllers.get(k)]));
{
  const a = summary(A),
    b = summary(B);
  if (a !== b) show(a, b);
  assert(a === b, 'the plans are as they were saved');
}

let sa, sb;
for (let i = 0; i < after / dt; i++) {
  seed = 1000 + i;
  seedSim(1000 + i);
  await step(A);
  seed = 1000 + i;
  seedSim(1000 + i);
  await step(B);
  sa = summary(A);
  sb = summary(B);
  if (sa !== sb) {
    console.log('the games part at tick', i, 'time', A.galaxy.time);
    const a = JSON.parse(sa),
      b = JSON.parse(sb);
    const walk = (x, y, path) => {
      if (JSON.stringify(x) === JSON.stringify(y)) return false;
      if (x && y && typeof x === 'object' && typeof y === 'object') {
        for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (walk(x[k], y[k], path + '.' + k)) return true;
        return true;
      }
      console.log(' first difference at', path, 'A', JSON.stringify(x), 'B', JSON.stringify(y));
      return true;
    };
    walk(a, b, '');
    break;
  }
}
assert(sb === sa, 'after the same time the plans are the same');
const wa = world(A),
  wb = world(B);
assert.equal(wb, wa, 'and so is the galaxy');
assert(
  A.ai.plans.history.some(e => e.status === 'move' || e.status === 'built' || e.status === 'production'),
  'the plans did something after the save'
);

const again = JSON.parse(JSON.stringify(snapshotGalaxy(B.galaxy)));
assert(!B.ai.plans.saveError, 'the loaded game can be saved again: ' + B.ai.plans.saveError);
const C = await makeGame(again);
assert.equal(summary(C), summary(B));
{
  const damaged = JSON.parse(JSON.stringify(snapshot));
  damaged.ai.plans.lua.nodes = damaged.ai.plans.lua.nodes.slice(0, 3);
  const D = await makeGame(damaged);
  assert(D.ai.errors.has('Plan restore'), 'the failure is reported');
  assert.equal(D.ai.plans.live.filter(i => i.state === 'run').length, 0, 'no half-restored plan is left running');
  const queued = D.galaxy.planets.reduce(
    (n, p) =>
      n +
      Object.values(p.production)
        .flat()
        .filter(q => q.ai).length,
    0
  );
  assert.equal([...D.ai.plans.jobs].filter(j => j.queue).length, queued, 'every build already asked for keeps its funding');
  seed = 99;
  seedSim(99);
  await run(D, 20);
  D.ai.dispose();
  D.story.dispose();
}
console.log('PASS');
for (const g of [A, B, C]) {
  g.ai.dispose();
  g.story.dispose();
}
archive.close();
