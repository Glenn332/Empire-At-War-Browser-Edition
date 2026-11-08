import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { TacticalStoryHost } = await import('../public/js/game/tacticalstory.js');
const T = name => ({ name });
const me = { factionName: 'Empire' },
  them = { factionName: 'Rebel' };
const marker = { type: T('Story_Trigger_Zone_00'), x: 1000, y: 0, z: 0, mapMarker: true };
const run = (params, units, owner = 'Empire') => {
  const h = Object.create(TacticalStoryHost.prototype),
    fired = [];
  const e = { name: 'near', type: 'STORY_UNIT_PROXIMITY', params, plot: { owner }, prereqs: [] };
  h.eventTypes = new Map([['STORY_UNIT_PROXIMITY', [e]]]);
  h.game = { human: me, world: { mapObjects: new Map([[0, [marker]]]) } };
  h.scripts = { world: { selectables: () => units } };
  h.fire = ev => fired.push(ev.name);
  h.pollProximity();
  return fired;
};
const unit = (player, x, type = 'Darth_Vader') => ({ player, type: T(type), x, y: 0, z: 0 });
assert.deepEqual(run(['', 'Story_Trigger_Zone_00', '180'], [unit(me, 900)]), ['near'], 'a unit of the player within range');
assert.deepEqual(run(['', 'Story_Trigger_Zone_00', '180'], [unit(me, 700)]), [], 'out of range');
assert.deepEqual(run(['', 'Story_Trigger_Zone_00', '180'], [unit(them, 900)]), [], 'only the units of the local player');
assert.deepEqual(run(['Darth_Vader', 'Story_Trigger_Zone_00', '180'], [unit(me, 900, 'Stormtrooper')]), [], 'the unit type filter');
assert.deepEqual(run(['Darth_Vader', 'Story_Trigger_Zone_00', '180'], [unit(me, 900)]), ['near']);
assert.deepEqual(run(['', 'Story_Trigger_Zone_00', '180'], [unit(me, 900)], 'Rebel'), [], 'only plots of the local player');
assert.deepEqual(run(['', 'Story_Trigger_Zone_00, Other_Zone', '180'], [unit(me, 900)]), ['near'], 'a list of targets');
{
  const { StoryPlots } = await import('../public/js/game/storyplots.js');
  const credits = (params, value, owner = 'Empire') => {
    const h = Object.create(StoryPlots.prototype),
      fired = [];
    h.eventTypes = new Map([['STORY_ACCUMULATE', [{ name: 'acc', params, plot: { owner: 'Empire' } }]]]);
    h.fire = e => fired.push(e.name);
    h.signalCredits(owner, value);
    return fired.length;
  };
  assert.equal(credits(['10000'], 10000.9), 0, 'more than: the whole credits must exceed it');
  assert.equal(credits(['10000'], 10001), 1);
  assert.equal(credits(['10000', 'LESS_THAN'], 9999), 1);
  assert.equal(credits(['10000', 'EQUAL_TO'], 10000.5), 1);
  assert.equal(credits(['10000', 'NOT_EQUAL_TO'], 5), 0, 'not equal never fires');
  assert.equal(credits(['10000', 'GREATER_THAN_EQUAL_TO'], 10000), 1);
  assert.equal(credits(['10000', 'LESS_THAN_EQUAL_TO'], 10000), 1);
  assert.equal(credits(['10000'], 20000, 'Rebel'), 0, 'only the plot owner credits');
}
{
  const fired = [];
  const h = Object.create(TacticalStoryHost.prototype);
  const ev = (name, type, ...params) => ({ name, type, params, plot: { owner: 'Empire' }, prereqs: [] });
  const star = { id: 9, type: T('Empire_Star_Base_1'), x: 5000, y: 0, z: 0 },
    frigate = { id: 1, type: T('Nebulon_B_Frigate'), x: 0, y: 0 },
    xwing = { id: 2, type: T('X-Wing'), x: 0, y: 0 },
    ywing = { id: 3, type: T('Y-Wing'), x: 0, y: 0 };
  const events = [
    ev('cmd', 'STORY_COMMAND_UNIT', 'Nebulon_B_Frigate'),
    ev('near', 'STORY_COMMAND_UNIT', 'Nebulon_B_Frigate', 'Empire_Star_Base_1', '2100'),
    ev('guard', 'STORY_GUARD_UNIT', 'X-WING', 'Y-WING'),
    ev('sel', 'STORY_SELECT_UNIT', 'Nebulon_B_Frigate')
  ];
  h.eventTypes = new Map();
  for (const e of events) (h.eventTypes.get(e.type) || h.eventTypes.set(e.type, []).get(e.type)).push(e);
  h.game = { human: me, world: { mapObjects: new Map() } };
  h.scripts = { world: { selectables: () => [star, frigate, xwing, ywing] } };
  h.fire = e => fired.push(e.name);
  const world = { units: [star, frigate, xwing, ywing], squads: [] };
  h.command(world, { c: 'move', u: [1], x: 0, y: 0 });
  assert.deepEqual(fired, ['cmd'], 'any move of the type; the far one waits');
  fired.length = 0;
  h.command(world, { c: 'move', u: [1], x: 4000, y: 0 });
  assert.deepEqual(fired, ['cmd', 'near'], 'a move close to the target');
  fired.length = 0;
  h.command(world, { c: 'move', u: [1], t: 9 });
  assert.deepEqual(fired, [], 'an attack order is not a move');
  h.command(world, { c: 'guard', u: [3], t: 2 });
  assert.deepEqual(fired, [], 'the guard pair is ordered');
  h.command(world, { c: 'guard', u: [2], t: 3 });
  assert.deepEqual(fired, ['guard']);
  fired.length = 0;
  h.selected([xwing, frigate]);
  assert.deepEqual(fired, ['sel'], 'selecting the type');
}
console.log('ok');
