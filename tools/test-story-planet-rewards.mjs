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
const { galacticStoryReward } = await import('../public/js/game/storyrewards.js');
const { StoryPlots } = await import('../public/js/game/storyplots.js');
const { planetCreditValue, planetPolitics, planetMaxStarbase } = await import('../public/js/game/planetstats.js');

const planetType = n => [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && t.name.toUpperCase() === n);
const P = (index, name, owner, background = false) => ({ index, type: planetType(name), owner, background });
const planets = [P(0, 'CORUSCANT', 'Empire', true), P(1, 'KUAT', 'Empire'), P(2, 'YAVIN', 'Rebel'), P(3, 'TATOOINE', 'Neutral')];
assert.ok(planets.every(p => p.type), 'planet types load');

const host = Object.create(StoryPlots.prototype);
const e1 = { name: 'a', type: 'STORY_CONQUER', params: ['PLACEHOLDER_X', 'Tank,placeholder_x'], plot: {} };
const e2 = { name: 'b', type: 'STORY_DEFEAT_HERO', params: ['PLACEHOLDER_X'], plot: {} };
Object.assign(host, {
  game: { galaxy: { planets, players: [] }, me: 'Rebel' },
  errors: new Map(),
  objects: () => [],
  plots: new Map([['P', { events: new Map([['A', e1], ['B', e2]]) }]])
});
const run = (reward, ...rewards) => galacticStoryReward(host, { name: reward, reward, rewards });

run('PICK_PLANET', 'ENEMY_CONTAINS', 'Placeholder_X');
assert.deepEqual(e1.params, ['Kuat', 'Tank,Kuat'], 'the first enemy planet replaces the placeholder in every list, background planets are skipped');
assert.deepEqual(e2.params, ['PLACEHOLDER_X'], 'STORY_DEFEAT_HERO is left alone, as the engine skips it');
e1.params = ['P2'];
run('PICK_PLANET', 'FRIENDLY_CONTAINS', 'P2');
assert.deepEqual(e1.params, ['Yavin']);
e1.params = ['P3'];
run('PICK_PLANET', 'NO_SUCH_FILTER', 'P3');
assert.deepEqual(e1.params, ['Kuat'], 'an unknown filter takes the first planet');

const kuat = planets[1];
const credit = planetCreditValue(kuat),
  maxBase = planetMaxStarbase(kuat);
run('STATISTIC_CHANGE', 'CREDIT_VALUE', '77', 'Kuat');
run('STATISTIC_CHANGE', 'POLITICAL_CONTROL', '2', 'Kuat');
run('STATISTIC_CHANGE', 'MAX_STARBASE_LEVEL', '1', 'Kuat');
run('STATISTIC_CHANGE', 'MAX_SPECIAL_STRUCTS', '9', 'Kuat');
assert.equal(planetCreditValue(kuat), 77);
assert.equal(planetPolitics(kuat), 2);
assert.equal(planetMaxStarbase(kuat), 1);
assert.notEqual(credit, 77);
assert.ok(maxBase >= 1);
assert.equal(planetCreditValue(planets[2]), planets[2].type.num('Planet_Credit_Value', 0), 'other planets keep their type value');
run('STATISTIC_CHANGE', 'CREDIT_VALUE', '5');
assert.ok(host.errors.has('STATISTIC_CHANGE'), 'no planet and no triggering planet only reports');
console.log('ok');
