import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
globalThis.fetch = async input => {
  const key = archive.resolve(decodeURIComponent(String(input).replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { seedSim } = await import('../public/js/game/simrandom.js');
const { StoryPlots } = await import('../public/js/game/storyplots.js');
const { startRandomStory, generatedPlotSave, restoreGeneratedPlot, resetRandomStory } = await import('../public/js/game/randomstory.js');
const { parseStoryDialog } = await import('../public/js/game/galacticstorydialog.js');
const { galacticStoryReward } = await import('../public/js/game/storyrewards.js');

const planetType = n => [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && t.name.toUpperCase() === n);
const hero = [...db.types.values()].find(t => t.bool('Is_Named_Hero') && t.str('Affiliation').toUpperCase().includes('EMPIRE'));
const mine = [...db.types.values()].find(t => t.bool('Is_Named_Hero') && t.str('Affiliation').toUpperCase().includes('REBEL'));
const P = (index, name, owner) => ({ index, type: planetType(name), owner, garrison: [], groundStructures: [], orbitalStructures: [], spaceLevel: 1, revealed: true });
const C = db.constants;
const triggers = C.list('Random_Story_Triggers').map(s => s.toUpperCase());

const make = () => {
  const host = Object.create(StoryPlots.prototype);
  const shown = [];
  const galaxy = {
    planets: [P(0, 'YAVIN', 'Rebel'), P(1, 'KUAT', 'Empire'), P(2, 'TATOOINE', 'Empire'), P(3, 'CORELLIA', 'Rebel')],
    players: [
      { faction: 'Rebel', credits: 4321.7 },
      { faction: 'Empire', credits: 9000 }
    ],
    fleets: [
      { owner: 'Empire', planet: 1, units: [{ type: hero }] },
      { owner: 'Rebel', planet: 0, units: [{ type: mine }] }
    ]
  };
  Object.assign(host, {
    game: { galaxy, me: 'Rebel', storyDialog: { show: o => shown.push(o), refreshSummary() {} } },
    plots: new Map(),
    eventTypes: new Map(),
    timedEvents: new Set(),
    errors: new Map(),
    storyGoals: [],
    storyGoalId: 0
  });
  return { host, shown, galaxy };
};

const seen = new Set();
resetRandomStory();
for (let seed = 1; seed <= 60; seed++) {
  seedSim(seed);
  const { host, shown } = make();
  const plot = startRandomStory(host);
  assert.ok(plot && plot.generated);
  const evs = [...plot.events.values()];
  const n = (evs.length - 1) / 2;
  assert.ok(Number.isInteger(n) && n >= 1 && n <= C.num('Random_Story_Max_Triggers', 3), 'one to the maximum triggers, each with a completion event, and one reward');
  for (let i = 0; i < n; i++) {
    const t = plot.events.get('RANDOM_TRIGGER_' + i),
      done = plot.events.get('RANDOM_TRIGGER_' + i + 'A');
    assert.ok(triggers.includes(t.type));
    seen.add(t.type);
    assert.deepEqual(t.prereqs, i ? [['RANDOM_TRIGGER_' + (i - 1)]] : []);
    assert.equal(t.chapter, i);
    assert.equal(t.tag, plot.name + 'RANDOM_TRIGGER_' + i);
    assert.equal(t.popup, false);
    assert.equal(done.type, 'STORY_TRIGGER');
    assert.equal(done.reward, 'REMOVE_STORY_GOAL');
    assert.deepEqual(done.rewards, [t.tag]);
    assert.equal(done.dialog, '', 'completion events have no dialog');
    if (t.type === 'STORY_ACCUMULATE') assert.equal((+t.params[0] - 4321) % 1000, 0, 'credits target is the current credits plus thousands');
    if (t.type === 'STORY_DEFEAT_HERO') assert.equal(t.params[0], hero.name);
    if (t.type === 'STORY_DEPLOY') assert.ok(['Kuat', 'Tatooine'].includes(t.params[1]), 'deploy targets an enemy planet');
  }
  const last = plot.events.get('RANDOM_TRIGGER_' + n);
  assert.ok(['BUILDABLE_UNIT', 'UNIQUE_UNIT', 'CREDITS'].includes(last.reward));
  if (last.reward === 'CREDITS') assert.deepEqual(last.rewards, [String(n * 10000)]);
  assert.deepEqual(last.prereqs, [['RANDOM_TRIGGER_' + (n - 1)]]);
  for (let c = 0; c <= n; c++) assert.ok(parseStoryDialog(plot.script, c).length > 0, 'every chapter has script lines');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].choice, true, 'the first chapter opens with accept and decline');
  assert.equal(shown[0].name, plot.name);
  assert.equal(host.storyGoals[0].tag, plot.events.get('RANDOM_TRIGGER_0').tag);
  if (seed === 1) {
    const { host: h2 } = make();
    const copy = restoreGeneratedPlot(h2, { name: plot.name, owner: 'Rebel', generated: generatedPlotSave(plot) });
    assert.deepEqual([...copy.events.keys()], [...plot.events.keys()], 'a generated plot survives a save');
    assert.equal(copy.events.get('RANDOM_TRIGGER_0').tag, plot.events.get('RANDOM_TRIGGER_0').tag);
  }
  if (seed === 2) {
    shown[0].onCancel();
    assert.equal(host.plots.size, 0, 'declining removes the plot');
    assert.equal((host.eventTypes.get('STORY_TRIGGER') || []).length, 0);
  }
}
assert.ok(seen.size >= 6, 'many trigger kinds are generated: ' + [...seen].join(' '));

seedSim(5);
const { host } = make();
galacticStoryReward(Object.assign(host, { objects: () => [] }), { name: 'r', reward: 'RANDOM_STORY', rewards: [] });
assert.equal(host.plots.size, 1, 'the RANDOM_STORY reward starts one');
console.log('ok', [...seen].join(' '));
