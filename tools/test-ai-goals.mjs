import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
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
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { difficultyAdjustment, aiPlayer, extension, adjustmentKey, hashOrder, loadBrain } = await import('../public/js/game/landbrain.js');
const { loadSpaceBrain } = await import('../public/js/game/spacebrain.js');
const { GoalSystem } = await import('../public/js/game/landgoals.js');
const { Plans } = await import('../public/js/game/aiplans.js');
const { World, spacePop } = await import('../public/js/game/sim.js');
const { SkirmishAI } = await import('../public/js/game/ai.js');
const { seedSim } = await import('../public/js/game/simrandom.js');

const text = async p => (await (await fetch(p)).text()).replace(/<!--[\s\S]*?-->/g, '');
const adjXml = await text('Data/XML/DifficultyAdjustments.xml');
const entry = name => {
  const m = new RegExp('<Difficulty_Adjustment\\s+Name\\s*=\\s*"' + name + '"[^>]*>([\\s\\S]*?)</Difficulty_Adjustment>', 'i').exec(adjXml);
  return k => {
    const v = new RegExp('<' + k + '>\\s*([-\\d.]+)', 'i').exec(m[1]);
    return v ? +v[1] : undefined;
  };
};
for (const [lv, faction] of [
  ['easy', 'Empire'],
  ['medium', 'Rebel'],
  ['hard', 'Empire']
]) {
  const p = await aiPlayer(faction),
    name = p.adjust[{ easy: 'easy', medium: 'normal', hard: 'hard' }[lv]],
    x = entry(name),
    a = await difficultyAdjustment(faction, lv);
  assert.equal(a.spaceContrast, x('Space_AI_Contrast_Multiplier') ?? 1, lv + ' space contrast is the player type entry ' + name);
  assert.equal(a.landContrast, x('Land_AI_Contrast_Multiplier') ?? 1, lv + ' land contrast');
  assert.equal(a.spaceSleep, x('Space_AI_Goal_Cycle_Sleep_Duration') ?? 0, lv + ' space goal cycle sleep');
  assert.equal(a.landSleep, x('Land_AI_Goal_Cycle_Sleep_Duration') ?? 0, lv + ' land goal cycle sleep');
  assert.equal(a.credit, x('Credit_Multiplier') ?? 1, lv + ' credit multiplier');
}
assert.equal(adjustmentKey({ player: { adjust: { hard: 'Hard_Default' } } }, 'hard'), 'hard', 'the stock entry keeps its table key');
assert.equal(adjustmentKey({ player: { adjust: { hard: 'Brutal_Custom' } } }, 'hard'), 'brutal_custom', 'a named entry is used as named');
assert.equal(adjustmentKey(null, 'medium'), 'normal');

assert.equal(extension(''), 2, 'no GoalSetExtensionSize: two');
assert.equal(extension('1'), 1);
assert.equal(extension('0'), 0, 'zero is taken as given');
assert.equal(extension('9'), 5, 'at most five');
assert.equal(extension('-1'), 5, 'a negative size wraps to the cap');
for (const f of ['Empire', 'Rebel', 'Underworld']) {
  const p = await aiPlayer(f),
    xml = await text('Data/XML/AI/Players/' + p.name.trim() + '.xml').catch(() => '');
  const raw = /<GoalSetExtensionSize>\s*([^<]*?)\s*<\/GoalSetExtensionSize>/i.exec(xml);
  if (xml) assert.equal(p.ext, extension(raw ? raw[1] : ''), f + ' player type extension');
}

const enumXml = await text('Data/XML/Enum/AIGoalCategoryType.xml');
const pairs = [...enumXml.matchAll(/<([A-Za-z_0-9]+)>\s*(-?\d+)\s*<\/\1>/g)].map(m => [+m[2], m[1].toUpperCase()]);
const order = hashOrder(pairs);
assert.equal(order.length, pairs.length, 'every category walked once');
assert.deepEqual([...order].sort(), pairs.map(p => p[1]).sort());
const brain = await loadSpaceBrain('Empire');
assert.deepEqual(brain.catOrder, order, 'the brain carries the engine walk order of the categories');
assert.equal(order[0], 'OFFENSIVE');
assert.equal(order[1], 'HERO', 'value 8 lands in the first bucket after 0');

const G0 = new GoalSystem();
assert.equal(G0.perFrame(260, 1), 2, 'evaluations over a five second sweep');
assert.equal(G0.perFrame(100000, 1), 20, 'at most round(20 / computer players) a frame');
assert.equal(G0.perFrame(100000, 3), 7);
assert.equal(G0.perFrame(0, 2), 1);

const cat = (name, category, extra = {}) => [name, { name, category, like: [], exclusions: [], perFailure: 0, perStartFailure: 0, bits: 16, mode: '', ...extra }];
function rig({ defs, desire, budget, ext = 1, catOrder = [], removable = {} }) {
  const live = [],
    started = [];
  const cmdr = { player: { credits: 1000 } };
  const P = {
    ready: true,
    live,
    can: () => true,
    staffable: () => true,
    start: (ai, name) => {
      const inst = { ai, goal: name, state: 'run', removable: removable[name] ?? true, key: name };
      live.push(inst);
      started.push(name);
      return inst;
    },
    stop: inst => (inst.state = 'over'),
    sleep: () => 0
  };
  const b = { defs: new Map(defs), fnOf: new Map(defs.map(([n]) => [n, n])), player: { ext }, catOrder };
  const mind = { desire: n => desire[n] ?? 0, fn: eq => budget[eq] ?? 0 };
  const G = new (class extends GoalSystem {
    env() {
      return { w: { time: 10 }, brain: b, cmdr, P, ais: 1 };
    }
    newMind() {
      return mind;
    }
    switches(side, S) {
      S.on = { cats: new Map([...b.defs.values()].map(d => [d.category, true])), goals: new Map(), budget: new Map(Object.keys(budget).map(c => [c, c])), tactical: new Map() };
    }
    targets() {
      return [null];
    }
    thingOf() {
      return null;
    }
  })();
  G.paced = true;
  const run = () => {
    for (let i = 0; i < 200; i++) G.tick(0, 1 / 30);
  };
  const keep = (name, d) => {
    const inst = P.start(cmdr, name);
    inst.gdef = b.defs.get(name);
    inst.tgt = null;
    inst.tkey = '';
    inst.gside = 0;
    inst.gsys = G;
    started.length = 0;
    desire[name] = d;
    return inst;
  };
  return { G, P, live, started, run, keep, desire };
}

{
  const r = rig({ defs: [cat('A', 'C1'), cat('B', 'C2')], desire: { B: 5 }, budget: { C1: 1, C2: 1 } });
  const a = r.keep('A', 0);
  r.run();
  assert.equal(a.state, 'over', 'a category with no proposal of its own drops a removable goal whose desire fell to 0');
  assert(r.started.includes('B'));
}
{
  const r = rig({ defs: [cat('A', 'C1'), cat('B', 'C2')], desire: { B: 5 }, budget: { C1: 1, C2: 1 }, removable: { A: false } });
  const a = r.keep('A', 0);
  r.run();
  assert.equal(a.state, 'run', 'a goal at desire 0 whose plan is not removable runs on');
}
{
  const r = rig({ defs: [cat('A', 'C1'), cat('B', 'C2')], desire: { B: 5 }, budget: { C1: 1, C2: 1 } });
  const a = r.keep('A', 3);
  r.run();
  assert.equal(a.state, 'run', 'a category with no proposal of its own keeps a goal still wanted');
}
{
  const r = rig({ defs: [cat('A', 'C1')], desire: {}, budget: { C1: 1 } });
  const a = r.keep('A', 3);
  r.G.tick(0, 1 / 30);
  const S = r.G.sides.get(0);
  S.kept = [a];
  S.phase = 'idle';
  S.wake = 0;
  a.state = 'over';
  r.started.length = 0;
  r.G.tick(0, 1 / 30);
  assert(!r.started.includes('A'), 'a goal whose plan ended stays active until the next activation: not proposed in the sweep before it');
  for (let i = 0; i < 10 && !r.started.includes('A'); i++) r.G.tick(0, 1 / 30);
  assert(r.started.includes('A'), 'and proposed again in the sweep after it');
}
{
  const r = rig({ defs: [cat('A', 'C1'), cat('B', 'C1')], desire: { B: 30 }, budget: { C1: 1 }, removable: { A: false } });
  const a = r.keep('A', 1);
  r.run();
  assert.equal(a.state, 'run', 'a goal whose plan is not removable is kept when outbid');
}
{
  const r = rig({ defs: [cat('A', 'C1'), cat('B', 'C1')], desire: { B: 30 }, budget: { C1: 1 }, ext: 0 });
  const a = r.keep('A', 1);
  r.run();
  assert.equal(a.state, 'over', 'a removable goal outbid in its category is dropped when the set is full');
  assert(r.started.includes('B'));
}
{
  const r = rig({
    defs: [cat('X', 'FIRST'), cat('Y', 'SECOND')],
    desire: { X: 5, Y: 5 },
    budget: { FIRST: 1, SECOND: 1 },
    catOrder: ['FIRST', 'SECOND']
  });
  r.run();
  assert.deepEqual(r.started.slice(0, 2), ['Y', 'X'], 'categories tied on budget share go in the reverse of the category list');
}
{
  const r = rig({ defs: [cat('X', 'BUDGETED'), cat('Y', 'UNBUDGETED')], desire: { X: 5, Y: 5 }, budget: { BUDGETED: 1 } });
  r.run();
  assert(r.started.includes('Y'), 'a category with no budget equation is still visited');
  const S = r.G.sides.get(0);
  assert.equal(r.G.exhausted(S, 'UNBUDGETED'), true, 'and it has no allocation, so only its drawn phase runs');
  assert.equal(r.G.exhausted(S, 'BUDGETED'), false);
}

seedSim(5);
const P = Object.create(Plans.prototype);
P.byGoal = new Map([['G', ['WIN', 'LOSE']]]);
P.stats = new Map();
const S = { planStats: new Map([['WIN', { total: 4, wins: 4 }], ['LOSE', { total: 4, wins: 0 }]]) };
let win = 0;
for (let i = 0; i < 3000; i++) if (P.draw('G', S) === 'WIN') win++;
assert(Math.abs(win / 3000 - 2 / 3) < 0.04, 'plans drawn by their success ratio + 1: ' + win / 3000);
P.adjusts = new Map();
const ai = { player: { adjust: { spaceContrast: 0.75, spaceSleep: 15, landContrast: 0.67, landSleep: 15 } } };
P.host = { land: false };
assert.equal(P.contrastScale(ai), 0.75, "the contrast multiplier is the player's own entry");
assert.equal(P.sleep(ai), 15);
P.host = { land: true };
assert.equal(P.contrastScale(ai), 0.67);

const fighter = [...db.types.values()].find(t => t.has('Squadron_Units') && spacePop(t) > 0),
  other = [...db.types.values()].find(t => t !== fighter && t.has('Squadron_Units') && spacePop(t) > 0);
const w = Object.create(World.prototype);
w.campaign = false;
w.min = { x: -1e4, y: -1e4 };
w.max = { x: 1e4, y: 1e4 };
let called = 0;
w.cantReinforce = () => {
  called++;
  return 'blocked';
};
w.startFacing = () => 0;
const player = { factionName: 'Empire', reinforcements: [fighter], pop: 0, popCap: 0 };
player.pop = spacePop(fighter) + 10;
player.popCap = 10;
const pool = [{ type: fighter }],
  st = { r: 0 };
assert.equal(w.reinforceStep(player, pool, { x: 0, y: 0 }, st), null);
assert.equal(called, 0, 'no room in the population: the drop waits');
assert.equal(pool.length, 1);
player.popCap = 10 + spacePop(fighter);
w.reinforceStep(player, pool, { x: 0, y: 0 }, st);
assert(called > 0, 'with room the drop is tried');
const gone = [{ type: fighter }, { type: other }];
called = 0;
w.reinforceStep(player, gone, { x: 0, y: 0 }, st);
assert.equal(gone.length, 1, 'an entry no longer in the reinforcement pool is dropped from the list');
assert.equal(called, 0);

const world = {
  teams: [],
  units: [],
  min: { x: -100, y: -100 },
  max: { x: 100, y: 100 },
  time: 0,
  goals: { tick: () => false },
  scripts: null,
  selectables: function* () {}
};
const me = { credits: 1000, team: { spawnPoints: [] }, spawn: null, factionName: 'Empire' };
const bot = new SkirmishAI(world, me, 'hard', null);
for (let i = 0; i < 300; i++) {
  me.credits += 10;
  bot.update(1 / 30);
}
assert.equal(me.credits, 4000, 'with the goal AI no difficulty income on top of Credit_Multiplier and no old cash drop');
const old = new SkirmishAI({ ...world, goals: null }, (me.credits = 1000) && me, 'hard', null);
old.economy = old.production = old.military = old.think = () => {};
for (let i = 0; i < 10; i++) {
  me.credits += 10;
  old.update(1 / 30);
}
assert(me.credits > 1100, 'the ?oldai path keeps its own income table');
console.log('ai goals: ok');
