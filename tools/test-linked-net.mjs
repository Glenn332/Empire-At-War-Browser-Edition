import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const C = await import('../public/js/game/galacticcorruption.js');
const { preloadLinkedPlots, resolveNetLinked } = await import('../public/js/game/linkednet.js');
const { StoryFlags } = await import('../public/js/game/storyflags.js');
const noop = () => {};

// Corruption: a mission choice in a network game corrupts at once instead of opening a local battle.
const factions = [...db.factions.values()],
  uw = factions.find(f => f.bool('Benefits_From_Corruption')),
  plain = factions.find(f => f.bool('Is_Playable') && !f.bool('Benefits_From_Corruption')),
  planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && C.choicesOf(t).some(c => c.map && c.mode)),
  saboteur = [...db.types.values()].find(t =>
    t.sub('Abilities').some(n => n.children.some(a => a.tag.toUpperCase() === 'CORRUPTION_ABILITY'))
  );
if (uw && plain && planetType && saboteur) {
  const choice = {
    ...C.choicesOf(planetType).find(c => c.map && c.mode),
    cost: 100,
    units: [],
    unitCount: 0,
    missionType: -1,
    planets: []
  };
  const world = setup => {
    const planet = {
      index: 0,
      type: planetType,
      name: planetType.name,
      owner: plain.name,
      currentCorruption: -1,
      garrison: [],
      groundStructures: [],
      orbitalStructures: [],
      production: { ground: [], space: [] },
      killedHeroes: []
    };
    const players = [
      { faction: plain.name, ai: 'Easy', credits: 5000, tech: 0, unlockedTypes: [] },
      { faction: uw.name, ai: null, credits: 5000, tech: 0, unlockedTypes: [], corruptionMissions: Array(8).fill(0) }
    ];
    const game = {
      galaxy: { planets: [planet], fleets: [], routes: [], players, time: 0 },
      me: uw.name,
      setup,
      despawned: [],
      audio: { play: noop, speech: { replace: noop } },
      story: { signalCorruption: noop, despawn: o => game.despawned.push(o), signal: noop, abilityLanded: noop }
    };
    return { game, planet, actor: { owner: uw.name, type: saboteur, record: { type: saboteur, owner: uw.name }, dead: false, planet } };
  };
  {
    const { game, planet, actor } = world({});
    assert.equal(C.executeCorruption(game, actor, planet, choice), true);
    assert(game.pendingLinkedTactical?.corruption, 'single player queues the tactical mission');
    assert(!planet.corruptionKind);
  }
  {
    const { game, planet, actor } = world({});
    game.battle = {};
    assert.equal(C.executeCorruption(game, actor, planet, choice), false, 'no mission while a battle is running');
    assert.equal(game.galaxy.players[1].credits, 5000, 'and nothing is paid');
    assert.equal(game.despawned.length, 0, 'nor the hero spent');
  }
  {
    const { game, planet, actor } = world({ net: {} });
    assert.equal(C.executeCorruption(game, actor, planet, choice), true);
    assert(!game.pendingLinkedTactical, 'no local battle in a network game');
    assert.equal(planet.corruptionKind, 'corrupt', 'the corruption starts as if the mission was won');
    assert.equal(game.galaxy.players[1].corruptionMissions[choice.type], 1);
    assert.equal(game.galaxy.players[1].credits, 4900);
  }
} else console.log('no corruption mission in this data: corruption part skipped');

// Linked story missions: every peer resolves them the same way, as won by the plot owner.
const plotName = 'Story_Plots_Empire_ActI_M03_SPACE.xml';
const story = {
  plots: new Map([
    ['P', { events: new Map([['E', { reward: 'LINK_TACTICAL', rewards: ['Ilum', 'SPACE', 'Empire', 'm.ted', 'Pirates', '', plotName] }]]) }]
  ]),
  flags: new StoryFlags(),
  errors: new Map(),
  eventTypes: new Map(),
  reasonCache: new Map(),
  startTactical: noop,
  battleFinished(...args) {
    this.finished = args;
  }
};
const holder = { story };
await preloadLinkedPlots(holder);
const flags = holder.linkedPlotFlags.get(plotName.toUpperCase());
if (!flags?.length) console.log('no tactical plot ' + plotName + ' in this data: linked part skipped');
else {
  assert(
    flags.some(f => f.flag.toUpperCase() === 'EMPIRE_A01M03_WIN' && f.reward === 'INCREMENT_FLAG'),
    'the win flag is read from the tactical plot'
  );
  const unit = (owner, dead = false) => ({ type: saboteur || [...db.types.values()][0], owner, dead });
  const planet = {
    index: 0,
    name: 'Ilum',
    type: { name: 'Ilum' },
    garrison: [],
    groundStructures: [],
    orbitalStructures: [],
    production: { space: [], ground: [] }
  };
  const game = {
    me: 'REBEL',
    galaxy: { planets: [planet], fleets: [{ owner: 'PIRATES', planet: 0, units: [unit('PIRATES')], leg: null }], players: [] },
    story,
    linkedPlotFlags: holder.linkedPlotFlags,
    battles: { dirty: new Set(), retreat: noop },
    pendingLinkedTactical: {
      planet: 0,
      mode: 'space',
      attacker: 'EMPIRE',
      defender: 'PIRATES',
      plot: plotName,
      resolution: 3,
      player: 'EMPIRE'
    }
  };
  story.game = game;
  resolveNetLinked(game);
  assert.equal(game.pendingLinkedTactical, null);
  assert.equal(story.flags.get('Empire_A01M03_Win'), 1, 'the campaign sees the mission as won');
  assert.equal(story.finished[3], 0, 'the attacker that owns the plot wins, whoever the local player is');
  assert.equal(game.galaxy.fleets.length, 0, 'DESTROY_AI clears the losing side at the planet');
  story.flags.set('Empire_A01M03_Win', 0);
  game.pendingLinkedTactical = {
    planet: 0,
    mode: 'land',
    attacker: 'REBEL',
    defender: 'EMPIRE',
    plot: plotName,
    resolution: 1,
    player: 'EMPIRE'
  };
  resolveNetLinked(game);
  assert.equal(story.finished[3], 1, 'a defending plot owner wins as the defender');
  assert.equal(story.flags.get('Empire_A01M03_Win'), 1);
}
console.log('ok linked missions resolve the same on every peer');
