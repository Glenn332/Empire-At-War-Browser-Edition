import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const arg = (name, fallback) => process.argv.find(a => a.startsWith('--' + name + '='))?.split('=')[1] ?? fallback;
let seed = +arg('seed', 0x5a01318);
Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const mod = process.argv.indexOf('--mod'),
  archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy } = await import('../public/js/game/galaxy.js'),
  { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const { GalacticAI } = await import('../public/js/game/galacticai.js'),
  { stepIncome } = await import('../public/js/game/galacticeconomy.js'),
  { stepProduction } = await import('../public/js/game/galacticproduction.js'),
  { stepFleets } = await import('../public/js/game/fleets.js');
const { pauseGalactic } = await import('../public/js/game/galacticpause.js'),
  { GalacticBattles } = await import('../public/js/game/galacticbattles.js');
const { stepPolitics } = await import('../public/js/game/galacticpolitics.js'),
  { stepVisibility } = await import('../public/js/game/galacticfog.js');
const data = await loadCampaignData(),
  name = arg('campaign', mod < 0 ? 'SANDBOX_EQUAL_FOOTING_EMPIRE' : 'FULLLARGE_ERA_3_EMPIRE').toUpperCase(),
  campaign = data.campaigns.get(name);
if (!campaign) throw new Error('No campaign ' + name + ' (' + [...data.campaigns.keys()].slice(0, 20).join(', ') + ')');
const galaxy = startingGalaxy(data, campaign);
const game = {
  galaxy,
  me: galaxy.active,
  setup: { difficulty: 'hard' },
  paused: false,
  userPaused: false,
  galacticPauseCount: 0,
  neutralizePopup: { close() {}, open() {} },
  scriptUI: { visibility() {}, enable() {}, text() {}, icon() {} }
};
game.pauseGalactic = on => pauseGalactic(game, on);
game.scriptUI.click = (n, forced) => {
  if (forced && n.toUpperCase() === 'B_PLAY_PAUSE') game.paused = !game.paused;
  else if (!forced) game.story?.clickGUI(n);
};
game.story = await GalacticStoryHost.create(game);
for (let i = 0; i < 900; i++) {
  if (game.story.pending.size) await Promise.all([...game.story.pending.values()]);
  game.story.update(1 / 30);
}
const ai = await GalacticAI.create(game);
game.ai = ai;
game.battles = new GalacticBattles(game);
const fps = +arg('fps', 60),
  dt = 1 / fps,
  seconds = +arg('seconds', 60),
  warm = +arg('warm', 20),
  parts = ['story', 'ai', 'income', 'production', 'fleets', 'battles', 'visibility'];
const frames = [];
let t = performance.now(),
  cur = null;
if (process.argv.includes('--detail')) {
  const wrap = (obj, name, label) => {
    const orig = obj[name];
    obj[name] = function (...a) {
      if (!cur) return orig.apply(this, a);
      const s = performance.now();
      try {
        return orig.apply(this, a);
      } finally {
        const d = performance.now() - s;
        cur.d[label] = (cur.d[label] || 0) + d;
        cur.c[label] = (cur.c[label] || 0) + 1;
      }
    };
  };
  wrap(ai.goals, 'tick', 'goals');
  wrap(ai.plans, 'update', 'plans');
  wrap(ai.plans, 'start', 'plans.start');
  wrap(ai.plans, 'detach', 'detach');
  wrap(ai.plans, 'solve', 'solve');
  wrap(ai.plans, 'refreshLocations', 'locations');
  wrap(ai, 'forces', 'forces');
  wrap(ai.plans.network, 'matrix', 'matrix');
  wrap(ai, 'invalidate', 'invalidate');
  const fsProto = Object.getPrototypeOf(
    new (await import('../public/js/game/galacticfreestore.js')).GalacticFreeStore(
      ai,
      { player: galaxy.players[0], budget: null, type: {} },
      'x'
    )
  );
  {
    const orig = game.story.service;
    game.story.service = function (inst, ...a) {
      if (!cur) return orig.call(this, inst, ...a);
      const s = performance.now();
      try {
        return orig.call(this, inst, ...a);
      } finally {
        const k = 'story:' + inst.name;
        cur.d[k] = (cur.d[k] || 0) + performance.now() - s;
        cur.c[k] = (cur.c[k] || 0) + 1;
      }
    };
  }
  wrap(game.ai, 'evaluate', 'evaluate');
  wrap(fsProto, 'update', 'fs');
  wrap(fsProto, 'scan', 'fs.scan');
  wrap(fsProto, 'add', 'fs.add');
  wrap(fsProto, 'stepMoves', 'fs.moves');
  wrap(fsProto, 'call', 'fs.call');
}
const time = (f, label, fn) => {
  const a = performance.now();
  fn();
  f[label] = performance.now() - a;
};
for (let i = 0; i < (warm + seconds) * fps; i++) {
  if (game.paused) game.paused = false;
  const f = { d: {}, c: {} },
    a = performance.now();
  cur = f;
  time(f, 'story', () => game.story.update(dt, false, dt));
  if (game.story.pending.size) await Promise.all([...game.story.pending.values()]);
  time(f, 'income', () => {
    ai.income(stepIncome(galaxy, dt));
    stepPolitics(galaxy, dt);
  });
  time(f, 'ai', () => ai.update(dt));
  time(f, 'production', () => stepProduction(galaxy, dt, ai.productionHooks));
  time(f, 'fleets', () =>
    stepFleets(galaxy, dt * 30, (fl, p) => {
      ai.invalidate();
      game.battles.arrive(fl, p);
    })
  );
  time(f, 'battles', () => game.battles.update());
  time(f, 'visibility', () => stepVisibility(galaxy, game.me, dt * 30));
  f.total = performance.now() - a;
  f.end = process.hrtime.bigint();
  if (i >= warm * fps) frames.push(f);
}
const sorted = frames.map(f => f.total).sort((a, b) => a - b),
  pct = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length),
  top = sorted.slice(Math.floor(sorted.length * 0.99));
const out = {
  campaign: name,
  fps,
  seconds,
  fleets: galaxy.fleets.length,
  frames: frames.length,
  avg: +mean(sorted).toFixed(2),
  p50: +pct(0.5).toFixed(2),
  p99: +pct(0.99).toFixed(2),
  slowest1pct: +mean(top).toFixed(1),
  max: +sorted.at(-1).toFixed(1),
  over8: frames.filter(f => f.total > 8).length,
  over16: frames.filter(f => f.total > 16).length,
  over33: frames.filter(f => f.total > 33).length,
  parts: Object.fromEntries(
    parts.map(p => {
      const v = frames.map(f => f[p]).sort((a, b) => a - b);
      return [p, { avg: +mean(v).toFixed(2), p99: +v[Math.floor(v.length * 0.99)].toFixed(1), max: +v.at(-1).toFixed(1) }];
    })
  ),
  slow: [...frames]
    .sort((a, b) => b.total - a.total)
    .slice(0, +arg('slow', 8))
    .map(
      f =>
        f.total.toFixed(1) +
        ': ' +
        parts
          .filter(p => f[p] > 1)
          .sort((a, b) => f[b] - f[a])
          .map(p => p + ' ' + f[p].toFixed(1))
          .join(', ') +
        (Object.keys(f.d).length
          ? ' | ' +
            Object.entries(f.d)
              .filter(([, v]) => v > 0.5)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => k + ' ' + v.toFixed(1) + 'x' + f.c[k])
              .join(', ')
          : '')
    ),
  errors: Object.keys(ai.report().errors).length,
  storyErrors: Object.keys(game.story.report().errors).length,
  wall: +((performance.now() - t) / 1000).toFixed(1)
};
console.log(JSON.stringify(out, null, 1));
const dump = arg('windows');
if (dump)
  (await import('node:fs')).writeFileSync(
    dump,
    JSON.stringify(
      frames
        .filter(f => f.total > 16)
        .map(f => {
          const e = Number(f.end / 1000n);
          return [e - Math.round(f.total * 1000), e];
        })
    )
  );
process.exit(0);
