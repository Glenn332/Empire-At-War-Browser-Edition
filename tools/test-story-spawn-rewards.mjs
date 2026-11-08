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
