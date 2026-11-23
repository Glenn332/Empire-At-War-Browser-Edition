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
  campaignName = arg('--campaign', 'Multiplayer_Sandbox_Heart_Of_The_Maw').toUpperCase(),
  seconds = +arg('--seconds', 240),
  slack = +arg('--slack', 0.25),
  update = flag('--update'),
  verbose = flag('--verbose');

if (update) updateBaseline('lockstep-galaxy', fileURLToPath(import.meta.url));

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

const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy } = await import('../public/js/game/galaxy.js');
const { GalacticGame } = await import('../public/js/game/galactic.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const { GalacticAI } = await import('../public/js/game/galacticai.js');
const { GalacticBattles } = await import('../public/js/game/galacticbattles.js');
const { GalacticVictory } = await import('../public/js/game/galacticvictory.js');
const { PendingBattle } = await import('../public/js/game/galacticpending.js');
const { stepVisibility } = await import('../public/js/game/galacticfog.js');
const { galaxyHash, runCommand, orders, GTICK, GalacticNet } = await import('../public/js/game/galacticnet.js');
const { humanPath } = await import('../public/js/game/fleets.js');
const { seedSim } = await import('../public/js/game/simrandom.js');
const { loadBlackMarket } = await import('../public/js/game/blackmarket.js');

const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : nothing), apply: () => nothing });
const data = await loadCampaignData();
await loadBlackMarket().catch(() => null);
const campaign = data.campaigns.get(campaignName);
if (!campaign) throw new Error('no campaign ' + campaignName);
const sides = [
  ...new Set(
    [...campaign.tuples('Starting_Credits'), ...campaign.tuples('Home_Location')]
      .map(t => db.faction(t[0])?.name)
      .filter(f => f && db.faction(f).bool('Is_Playable'))
  )
];
const HASH_EVERY = 30,
  ORDER_EVERY = 150;
const steps = Math.round(seconds / GTICK);

async function galaxyRun() {
  const players = sides.map((faction, i) =>
    i < 2 ? { human: true, peer: 0, name: 'P' + i, faction, color: '#ffffff' } : { human: false, faction, difficulty: 'hard', color: '#ffffff' }
  );
  const setup = {
    mode: 'galactic',
    type: 'campaign',
    campaign: campaign.name,
    seed: 4242,
    options: { credits: 10000, tech: 1, maxTech: 5, autoResolve: false, randomEvents: false },
    players,
    net: { session: { id: 0, on: () => () => {}, send() {}, broadcast() {} }, me: 0 }
  };
  const game = Object.create(GalacticGame.prototype);
  Object.assign(game, {
    setup,
    progress() {},
    audio: nothing,
    galacticLog: nothing,
    fleetViews: new Map(),
    listeners: [],
    holds: new Map(),
    speed: 1,
    paused: false,
    over: false
  });
  const proto = GalacticGame.prototype;
  for (const k of ['fleetView', 'syncFleetViews', 'message', 'refreshLanguage', 'fit', 'showMessage']) {
    const d = Object.getOwnPropertyDescriptor(proto, k);
    if (d && typeof d.value === 'function') game[k] = () => {};
  }
  for (const k of ['ui', 'overview', 'radar', 'planetInfo']) {
    let d = null;
    for (let o = proto; o && !d; o = Object.getPrototypeOf(o)) d = Object.getOwnPropertyDescriptor(o, k);
    if (!d || 'value' in d) game[k] = nothing;
  }
  game.data = data;
  seedSim(setup.seed >>> 0);
  const g = (game.galaxy = startingGalaxy(data, campaign));
  game.multiplayerGalaxy(g);
  g.budgetCreditChange = (owner, amount) => game.ai?.creditChange?.(owner, amount);
  g.storyEntry = (fleet, planet) => !!game.story?.entryAllowed?.(fleet, planet);
  g.onBounce = (fleet, to) => game.story?.fleetBounced?.(fleet, g.planets[to]);
  g.onDepart = () => {};
  game.victory = new GalacticVictory(game);
  game.me = game.localFaction;
  stepVisibility(g, game.me);
  game.story = await GalacticStoryHost.create(game, { warm: false });
  game.ai = await GalacticAI.create(game);
  if (game.story?.unwarmed) {
    game.story.unwarmed = false;
    await game.story.warm();
  }
  game.battles = new GalacticBattles(game);
  game.pendingBattle = new PendingBattle(game);
  game.net = new GalacticNet(game, setup.net);
  await game.net.lock.ready();
  const L = game.net.lock;
  const humans = players.filter(p => p.human).map(p => p.faction);
  const log = [],
    ms = [];
  let battles = 0,
    moves = 0,
    lastVote = null;
  const sendFleets = k => {
    for (const f of humans) {
      const mine = g.fleets.filter(x => x.owner === f && x.planet >= 0 && !x.leg && x.units.length);
      if (!mine.length) continue;
      const fleet = mine[k % mine.length],
        targets = g.planets
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.owner && p.owner !== f && !p.background)
          .map(({ i }) => ({ i, path: humanPath(g, fleet, i) }))
          .filter(t => t.path && t.path.length);
      if (!targets.length) continue;
      const t = targets[k % targets.length];
      const cmd = orders.move(g, fleet, t.i);
      if (f === game.me) game.order(cmd);
      else {
        game.actingPid = humans.indexOf(f);
        runCommand(game, f, cmd);
      }
      moves++;
    }
  };
  for (let step = 0; step < steps; step++) {
    if (game.story.pending?.size) await Promise.all([...game.story.pending.values()]);
    if (step % HASH_EVERY === 0) log.push(galaxyHash(game));
    if (step % ORDER_EVERY === 0) sendFleets(step / ORDER_EVERY);
    if (game.pendingBattle?.request && game.pendingBattle.request.id !== lastVote) {
      lastVote = game.pendingBattle.request.id;
      battles++;
    }
    for (let spin = 0; !L.step(); spin++) {
      if (spin > 1000) throw new Error('the lockstep never let step ' + step + ' through: ' + L.blocked);
      await new Promise(r => setImmediate(r));
    }
    if (verbose && game.pendingBattle?.request && !game.__saidReq) { game.__saidReq = true; const r = game.pendingBattle.request; console.log('  vote', step, JSON.stringify({ voters: r.voters, answers: [...(r.answers || [])], fallback: r.fallback, humans: r.humans, att: r.attacker, def: r.defender })); }
    if (verbose && game.battle && !game.__saidBattle) { game.__saidBattle = true; console.log('  battle', step, game.battle.attacker, game.battle.defender, game.battle.mode); }
    const t0 = performance.now();
    game.netStep(GTICK * game.speed);
    ms.push(performance.now() - t0);
    L.stepped();
    if (game.over) break;
  }
  const state = { paused: game.paused, busy: game.busy, held: game.held, over: game.over, battle: !!game.battle, pending: !!game.pendingBattle?.request, holds: game.holds?.size };
  game.net.stop();
  return { state, log, ms, battles, moves, planets: g.planets.filter(p => p.owner).map(p => p.owner[0]).join(''), time: Math.round(g.time) };
}

const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const t0 = performance.now();
const a = await galaxyRun(),
  b = await galaxyRun();
let diff = -1;
for (let i = 0; i < Math.max(a.log.length, b.log.length); i++)
  if (a.log[i] !== b.log[i]) {
    diff = i;
    break;
  }
const now = { stepMs: +mean(a.ms).toFixed(3), p99: +pct(a.ms, 0.99).toFixed(2), worst: +Math.max(...a.ms).toFixed(1) };
console.log(
  `galaxy lockstep: ${campaignName}, ${sides.join('/')} (two human, the rest AI), ${a.time} galactic seconds, ${a.log.length} checkpoints, ${a.moves} human fleet moves, ${a.battles} battle votes, ${Math.round((performance.now() - t0) / 1000)} s`
);
console.log(`  step ${now.stepMs} ms (p99 ${now.p99}, worst ${now.worst})`);
if (verbose) console.log('  state', JSON.stringify(a.state), 'owners', a.planets, '| hashes', a.log.slice(0, 6).join(' '));

const fails = [];
if (diff >= 0) fails.push(`the same galaxy ran differently twice: checkpoint ${diff} (step ${diff * HASH_EVERY}) differs`);
const sample = sampleFile();
const key = `${hostname()}|${campaignName}|${seconds}|${mod || ''}`;
const base = sample ? null : readBaseline('lockstep-galaxy', key);
if (base) {
  if (now.stepMs > base.stepMs * (1 + slack) && now.stepMs - base.stepMs > 0.05)
    fails.push(`a galaxy step takes ${now.stepMs} ms, ${Math.round((now.stepMs / base.stepMs - 1) * 100)}% over the baseline ${base.stepMs} ms`);
  if (now.p99 > base.p99 * (1 + slack * 2) && now.p99 - base.p99 > 1) fails.push(`the slowest 1% of galaxy steps take ${now.p99} ms, the baseline ${base.p99} ms`);
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
