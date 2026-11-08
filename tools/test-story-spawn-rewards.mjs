import assert from 'node:assert/strict';
const { activateSpawners } = await import('../public/js/game/landbase.js');
const { tutorialReward } = await import('../public/js/game/tutorialrewards.js');
const { finishTutorial, tutorialFinished } = await import('../public/js/game/tutorialprofile.js');

const type = (name, chance) => ({ name, num: (tag, d) => (tag === 'Spawn_Indigenous_Units_Chance' ? chance : d) });
const hut = type('Hut', 0.5),
  den = type('Den', 1);
const world = { units: [] };
for (let i = 0; i < 6; i++) world.units.push({ type: hut, house: { state: -1 } });
for (let i = 0; i < 3; i++) world.units.push({ type: den, house: { state: -1 } });
const active = t => world.units.filter(u => u.type === t && u.house.state === 1).length;

assert.equal(activateSpawners(world, 'hut', -1), true);
assert.equal(active(hut), 3, 'the type chance picks floor(count x chance) spawners');
assert.ok(world.units.filter(u => u.type === hut).every(u => u.house.state === 0 || u.house.state === 1));
assert.equal(active(den), 0, 'other types are untouched');
activateSpawners(world, 'Hut', 50);
assert.equal(active(hut), 3, 'values above one are percentages');
activateSpawners(world, 'Hut', 1);
assert.equal(active(hut), 6);
activateSpawners(world, 'Hut', 0.34);
assert.equal(active(hut), 2, 'extra active spawners are turned off');
activateSpawners(world, 'Hut', -5);
assert.equal(active(hut), 3, 'a negative value falls back to the type chance');
assert.equal(activateSpawners(world, 'Nothing', 1), false);

const errors = new Map();
const galaxy = { planets: [{ type: { name: 'Kashyyyk' } }] };
const tactical = { world, galaxy: null };
const host = game => ({ game, errors });
const run = (game, reward, ...rewards) => tutorialReward(host(game), { name: reward, reward, rewards });

assert.equal(run(tactical, 'SET_SPAWN', 'Den', '0.7'), true);
assert.equal(active(den), 2);
run(tactical, 'SET_SPAWN', 'Den');
assert.ok(errors.has('SET_SPAWN'), 'SET_SPAWN needs both parameters');

run({ galaxy }, 'SET_PLANET_SPAWN', '', '', '1.0');
assert.ok(errors.has('SET_PLANET_SPAWN'), 'the intervention plot form without planet and type only reports an error');
assert.equal(galaxy.planets[0].spawnOverrides, undefined);
run({ galaxy }, 'SET_PLANET_SPAWN', 'kashyyyk', 'Hut', '0.25');
assert.deepEqual(galaxy.planets[0].spawnOverrides, { HUT: 0.25 });

run(tactical, 'BOMBARD_DELAY', '20');
assert.equal(world.bombardDelay, 20);

run(tactical, 'SKIRMISH_RULES', '1');
assert.equal(tactical.skirmishRules, true);
run(tactical, 'SKIRMISH_RULES', '0');
assert.equal(tactical.skirmishRules, false);

const store = new Map();
const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
assert.equal(tutorialFinished('Tutorial_Five', storage), false);
finishTutorial('TUTORIAL_FIVE', storage);
assert.equal(tutorialFinished('Tutorial_Five', storage), true, 'the profile matches the campaign name');
assert.equal(tutorialFinished('Tutorial_Six', storage), false);
console.log('ok');

const { StoryPlots } = await import('../public/js/game/storyplots.js');
const ev = (name, extra = {}) => ({ name, type: 'STORY_TRIGGER', prereqs: [['X']], completed: true, active: true, elapsedFrom: 5, ...extra });
const plot = { events: new Map() };
for (const n of ['A', 'B', 'C', 'D']) plot.events.set(n, ev(n));
const fake = { errors: new Map(), timedEvents: new Set(), resetEvent: StoryPlots.prototype.resetEvent };
const reset = (rewards, rewardList = [], reward = 'RESET_EVENT') =>
  StoryPlots.prototype.commonReward.call(fake, { name: 'R', plot, reward, rewards, rewardList });
assert.equal(reset(['a'], ['C']), true);
assert.deepEqual(
  ['A', 'B', 'C', 'D'].map(n => plot.events.get(n).completed),
  [false, true, false, true],
  'RESET_EVENT resets its first parameter and every name of Reward_Param_List'
);
assert.equal(plot.events.get('A').active, false, 'a reset event waits for its prerequisites again');
assert.equal(plot.events.get('A').elapsedFrom, null);
reset([], [], 'DISABLE_AUTORESOLVE');
assert.ok(fake.errors.has('R'), 'DISABLE_AUTORESOLVE only reports that it no longer works');
console.log('ok reset');

const { tacticalMapLoad, takeStoryMap } = await import('../public/js/game/linktactical.js');
const { galacticStoryReward } = await import('../public/js/game/storyrewards.js');
{
  const fired = [];
  const T = n => ({ name: n });
  const galaxy = {
    planets: [
      { index: 0, type: T('Naboo'), garrison: [{ type: T('Hero_A') }] },
      { index: 1, type: T('Kamino'), garrison: [] }
    ],
    fleets: [{ planet: 1, leg: { to: 0 }, units: [{ type: T('Hero_B') }] }]
  };
  const ev = (n, params) => ({ name: n, params });
  const host = {
    game: { galaxy },
    eventTypes: new Map([
      [
        'STORY_LOAD_TACTICAL_MAP',
        [
          ev('any', ['Naboo', '', 'LAND']),
          ev('space', ['Naboo', '', 'SPACE']),
          ev('heroHere', ['Kamino,Naboo', 'Hero_A', 'LAND']),
          ev('heroAway', ['Naboo', 'Hero_B', 'LAND']),
          ev('other', ['Kamino', '', 'LAND'])
        ]
      ]
    ]),
    fire: e => fired.push(e.name)
  };
  tacticalMapLoad(host, galaxy.planets[0], 'land');
  assert.deepEqual(fired, ['any', 'heroHere'], 'planet, mode and hero presence select the events, a hero in hyperspace is not at the planet');
  const game = { galaxy: { autoReveal: undefined } };
  const gh = { game, errors: new Map(), objects: () => [] };
  galacticStoryReward(gh, { name: 'm', reward: 'SET_TACTICAL_MAP', rewards: ['_X_LAND.TED', 'LAND', 'EMPIRE'] });
  galacticStoryReward(gh, { name: 'm', reward: 'SET_TACTICAL_MAP', rewards: ['_X_SPACE.TED', 'SPACE'] });
  assert.equal(takeStoryMap(game, 'land'), '_X_LAND.TED');
  assert.equal(takeStoryMap(game, 'land'), '', 'the story map is used by one battle');
  assert.equal(takeStoryMap(game, 'space'), '_X_SPACE.TED');
  galacticStoryReward(gh, { name: 'r', reward: 'ENABLE_GALACTIC_REVEAL', rewards: ['0'] });
  assert.equal(game.galaxy.autoReveal, false);
  galacticStoryReward(gh, { name: 'r', reward: 'ENABLE_GALACTIC_REVEAL', rewards: ['1'] });
  assert.equal(game.galaxy.autoReveal, true);
}
console.log('ok maps');

{
  const T = n => ({ name: n });
  const units = [
    { type: T('Tank'), health: 100, maxHealth: 100 },
    { type: T('Tank'), health: 100, maxHealth: 100 },
    { def: T('Tank'), health: 50, maxHealth: 200 },
    { type: T('Shield_Gen'), dome: { on: true } }
  ];
  const game = { world: { units }, paused: false, togglePause() { this.paused = !this.paused; } };
  const errors = new Map();
  const run = (reward, ...rewards) => tutorialReward({ game, errors }, { name: reward, reward, rewards });
  run('SET_HEALTH', 'tank', '40');
  assert.deepEqual(units.slice(0, 3).map(u => u.health), [40, 100, 50], 'one object by default');
  run('SET_HEALTH', 'TANK', '25', '0');
  assert.deepEqual(units.slice(0, 3).map(u => u.health), [25, 25, 50], 'zero means every object of the type');
  run('DISABLE_SPECIAL_STRUCTURE', 'Shield_Gen', '1');
  assert.equal(units[3].dome.storyOff, true);
  run('DISABLE_SPECIAL_STRUCTURE', 'Shield_Gen', '0');
  assert.equal(units[3].dome.storyOff, false);
  run('PAUSE_GAME');
  run('PAUSE_GAME');
  assert.equal(game.paused, true, 'PAUSE_GAME pauses, it does not toggle back');
  run('SET_WEATHER');
  assert.ok(errors.has('SET_WEATHER'));
}
console.log('ok tactical');

{
  const { switchTarget } = await import('../public/js/game/switchsides.js');
  const f = ['Rebel', 'Pirates', 'Empire', 'Underworld'],
    can = i => f[i] !== 'Pirates',
    fo = i => f[i];
  assert.equal(switchTarget(4, 0, can, fo), 2, 'no faction: the next switchable player');
  assert.equal(switchTarget(4, 3, can, fo), 0, 'wraps around');
  assert.equal(switchTarget(4, 0, can, fo, 'underworld'), 3, 'a named faction keeps switching until it is reached');
  assert.equal(switchTarget(4, 0, can, fo, 'Pirates'), 0, 'an unreachable faction stops back at the start');
  assert.equal(switchTarget(4, 0, () => false, fo), 0);
  const calls = [];
  tutorialReward({ game: { switchSides: t => calls.push(t) }, errors: new Map() }, { name: 's', reward: 'SWITCH_SIDES', rewards: [] });
  tutorialReward({ game: { switchSides: t => calls.push(t) }, errors: new Map() }, { name: 's', reward: 'SWITCH_SIDES', rewards: ['Empire'] });
  assert.deepEqual(calls, ['', 'Empire']);
}
{
  const { StoryPlots } = await import('../public/js/game/storyplots.js');
  const fired = [];
  const mk = (type, params, owner = '') => ({ name: type + params[0], type, params, plot: { owner } });
  const host = Object.create(StoryPlots.prototype);
  Object.assign(host, {
    game: { me: 'Rebel' },
    fire: e => fired.push(e.name),
    eventTypes: new Map([
      ['STORY_BEGIN_ERA', [mk('STORY_BEGIN_ERA', ['3']), mk('STORY_BEGIN_ERA', ['-1']), mk('STORY_BEGIN_ERA', [''])]],
      ['STORY_TECH_LEVEL', [mk('STORY_TECH_LEVEL', ['-1'], 'Empire'), mk('STORY_TECH_LEVEL', ['2'], 'Rebel')]],
      ['STORY_REINFORCE', [mk('STORY_REINFORCE', ['Tank,X_Wing_Squadron']), mk('STORY_REINFORCE', ['']), mk('STORY_REINFORCE', ['Tank'], 'Empire')]]
    ])
  });
  host.signalEra(2);
  assert.deepEqual(fired, ['STORY_BEGIN_ERA-1', 'STORY_BEGIN_ERA'], 'era at or above the level; -1 and an empty level fire at once');
  fired.length = 0;
  host.signalEra(3);
  assert.equal(fired.length, 3);
  fired.length = 0;
  host.signalTech('Empire', 1);
  host.signalTech('Rebel', 1);
  assert.deepEqual(fired, ['STORY_TECH_LEVEL-1'], 'tech level keeps its owner filter');
  fired.length = 0;
  host.signalReinforce('Rebel', 'x_wing_squadron');
  host.signalReinforce('Empire', 'Tank');
  assert.deepEqual(fired, ['STORY_REINFORCETank,X_Wing_Squadron', 'STORY_REINFORCETank'], 'only the plot player, an empty name list never matches');
}
console.log('ok events');

{
  const units = [{ type: { name: 'Probe' } }];
  const game = { world: { units, time: 10 } };
  const errors = new Map();
  const run = (reward, rewards, extra = {}) => tutorialReward({ game, errors }, { name: reward, reward, rewards, ...extra });
  run('FLASH_TERRAIN', ['4'], { position: [120, -40, 0] });
  const blip = [...game.world.storyBlips.values()][0];
  assert.deepEqual([blip.x, blip.y, blip.until], [120, -40, 14], 'a radar flash at the reward position for its duration');
  run('FLASH_OBJECT', ['probe']);
  assert.ok(units[0].guiFlash && units[0].guiFlash.count === 3, 'the object flashes three times');
  run('FLASH_OBJECT', ['Nothing']);
  assert.ok(errors.has('FLASH_OBJECT'));
  run('FLASH_UNIT', ['FLASH_FLEET', 'Probe']);
  assert.ok(errors.has('FLASH_UNIT'), 'a region must be one of the REGION_ values');
}
console.log('ok flash');
