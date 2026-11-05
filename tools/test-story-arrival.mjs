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
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { StoryPlots } = await import('../public/js/game/storyplots.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const playable = [...db.factions.values()].filter(f => f.bool('Is_Playable')).map(f => f.name),
  [me, them] = playable,
  neutral = [...db.factions.values()].find(f => f.bool('Is_Neutral')).name;
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet');
const planet = { index: 0, type: planetType, name: planetType.name, garrison: [], groundStructures: [], orbitalStructures: [] };
const company = [...db.types.values()].find(t => t.list('Company_Units').length && t.list('Company_Transport_Unit').length),
  member = db.type(company.list('Company_Units')[0]),
  ship = [...db.types.values()].find(t => t.tag === 'SpaceUnit' && !t.list('Company_Units').length) || company;
let fired = [];
const host = (events, fleets = []) => {
  const h = Object.create(GalacticStoryHost.prototype);
  h.eventTypes = new Map();
  for (const e of events) {
    e.plot ??= { owner: me };
    (h.eventTypes.get(e.type) || h.eventTypes.set(e.type, []).get(e.type)).push(e);
  }
  h.game = { me, galaxy: { planets: [planet], fleets } };
  h.fire = e => fired.push(e.name);
  return h;
};
const ev = (name, type, ...params) => ({ name, type, params });
const fleet = (owner, units, over = {}) => ({ owner, planet: 0, leg: null, units, ...over });
const run = (events, f, fleets = []) => {
  fired = [];
  host(events, fleets).fleetEntered(f, planet);
  return fired;
};
const P = planetType.name;
assert.deepEqual(run([ev('any', 'STORY_ENTER')], fleet(them, [{ type: ship }])), ['any'], 'no planet: any fleet, any owner');
assert.deepEqual(run([ev('here', 'STORY_ENTER', P)], fleet(them, [{ type: ship }])), ['here']);
assert.deepEqual(run([ev('other', 'STORY_ENTER', 'Nowhere_Planet')], fleet(me, [{ type: ship }])), []);
const filtered = owner =>
  run(
    [
      'FILTER_NONE',
      'FILTER_FRIENDLY_ONLY',
      'FILTER_NEUTRAL_ONLY',
      'FILTER_ENEMY_ONLY',
      'FILTER_FRIENDLY_AND_NEUTRAL',
      'FILTER_ENEMY_AND_NEUTRAL',
      'FILTER_FRIENDLY_AND_ENEMY'
    ].map(f => ev(f, 'STORY_ENTER', P, f)),
    fleet(owner, [{ type: ship }])
  );
assert.deepEqual(filtered(me), ['FILTER_NONE', 'FILTER_FRIENDLY_ONLY', 'FILTER_FRIENDLY_AND_NEUTRAL', 'FILTER_FRIENDLY_AND_ENEMY']);
assert.deepEqual(filtered(them), ['FILTER_NONE', 'FILTER_ENEMY_ONLY', 'FILTER_ENEMY_AND_NEUTRAL', 'FILTER_FRIENDLY_AND_ENEMY']);
assert.deepEqual(filtered(neutral), ['FILTER_NONE', 'FILTER_NEUTRAL_ONLY', 'FILTER_FRIENDLY_AND_NEUTRAL', 'FILTER_ENEMY_AND_NEUTRAL']);
assert.deepEqual(
  run([ev('none', 'STORY_ENTER', '', 'FILTER_ENEMY_ONLY')], fleet(me, [{ type: ship }])),
  ['none'],
  'without a planet the filter is not checked'
);
const carried = { type: db.type(company.list('Company_Transport_Unit')[0]) || company, carries: company };
assert.deepEqual(
  run([ev('unit', 'STORY_ENTER', P, '', company.name)], fleet(me, [carried, { type: ship }])),
  ['unit'],
  'the listed unit is in the fleet'
);
assert.deepEqual(run([ev('member', 'STORY_ENTER', P, '', member.name)], fleet(me, [carried])), ['member'], 'company members count');
assert.deepEqual(run([ev('missing', 'STORY_ENTER', P, '', company.name)], fleet(me, [{ type: ship }])), []);
assert.deepEqual(
  run([ev('exact', 'STORY_ENTER', P, '', company.name, '', '', '1')], fleet(me, [carried, { type: ship }])),
  [],
  'exact count'
);
assert.deepEqual(run([ev('exact', 'STORY_ENTER', P, '', company.name, '', '', '1')], fleet(me, [carried])), ['exact']);
assert.deepEqual(
  run([ev('true', 'STORY_ENTER', P, '', company.name, '', '', 'true')], fleet(me, [carried, { type: ship }])),
  ['true'],
  'flags read as numbers'
);
assert.deepEqual(run([ev('raid', 'STORY_ENTER', P, '', '', '', '', '', '1')], fleet(me, [{ type: ship }])), [], 'raid fleets only');
assert.deepEqual(run([ev('raid', 'STORY_ENTER', P, '', '', '', '', '', '1')], fleet(me, [{ type: ship }], { raid: 0 })), ['raid']);
const there = fleet(them, [{ type: ship }]);
assert.deepEqual(
  run([ev('present', 'STORY_ENTER', P, '', '', ship.name)], fleet(me, [carried]), [there]),
  ['present'],
  'a listed type already at the planet'
);
assert.deepEqual(run([ev('present', 'STORY_ENTER', P, '', '', ship.name)], fleet(me, [carried]), []), []);
const hero = [...db.types.values()].find(t => t.bool('Is_Named_Hero') && !t.list('Company_Units').length);
if (hero) {
  assert.deepEqual(
    run([ev('move', 'STORY_MOVE', hero.name, P)], fleet(me, [{ type: hero }])),
    ['move'],
    'a named hero entering tells STORY_MOVE'
  );
  assert.deepEqual(run([ev('move', 'STORY_MOVE', hero.name, '')], fleet(me, [{ type: hero }])), [], 'STORY_MOVE needs its planet');
}
fired = [];
const h = host([ev('land', 'STORY_LAND_ON', P, 'FILTER_FRIENDLY_ONLY')]);
h.unitLanded(planet, { type: company, owner: them });
assert.deepEqual(fired, [], 'an enemy landing does not pass FILTER_FRIENDLY_ONLY');
h.unitLanded(planet, { type: company, owner: me });
assert.deepEqual(fired, ['land']);
fired = [];
host([ev('land', 'STORY_LAND_ON', P, 'FILTER_ENEMY_ONLY')]).abilityLanded(planet, { owner: me, record: { type: company } });
assert.deepEqual(fired, ['land'], 'an ability landing has no object, so the filter is not checked');
if (hero) {
  fired = [];
  const hd = host([ev('deploy', 'STORY_DEPLOY', hero.name, P), ev('nowhere', 'STORY_DEPLOY', hero.name, '')]);
  hd.unitLanded(planet, { type: hero, owner: me });
  assert.deepEqual(fired, ['deploy'], 'STORY_DEPLOY needs the hero and the planet, like STORY_MOVE');
}
const { placeStartingForce, onOrbit, forceKind } = await import('../public/js/game/galaxy.js');
const starship = [...db.types.values()].find(t => forceKind(t) === 'starship');
const { embarkGround, raiseGround, onLanded } = await import('../public/js/game/invasion.js');
const orbit = [];
onOrbit((pl, owner, units) => orbit.push([pl.name, owner, units.length]));
const fleets = [];
placeStartingForce(planet, me, starship, fleets);
assert.deepEqual(orbit.at(-1), [planet.name, me, 1], 'a ship placed in orbit enters it');
const ground = { ...planet, owner: me, garrison: [{ type: company, owner: me }] };
const gal = { planets: [ground], fleets: [] };
orbit.length = 0;
embarkGround(gal, 0, me, {});
assert.deepEqual(orbit, [[planet.name, me, 1]], 'a launch puts the company into orbit');
ground.garrison.push({ type: company, owner: them });
orbit.length = 0;
raiseGround(gal, ground, them);
assert.deepEqual(orbit, [[planet.name, them, 1]]);
assert.equal(ground.garrison.length, 0);
const { setCorruptionNow } = await import('../public/js/game/galacticcorruption.js');
const rp = {
  ...planet,
  owner: me,
  garrison: [{ type: company, owner: me }],
  groundStructures: [],
  orbitalStructures: [],
  currentCorruption: -1
};
const retreats = [];
const rg = {
  galaxy: { planets: [rp], fleets: [], players: [], routes: [], time: 0 },
  battles: { retreat: (p, o) => retreats.push(o) },
  notify() {}
};
orbit.length = 0;
setCorruptionNow(rg, rp, 4);
setCorruptionNow(rg, rp, -1);
assert.equal(rp.owner, neutral, 'the revolt hands the planet to the neutral faction');
assert(!rp.garrison.some(u => u.owner === me), 'the old ground forces leave the surface');
assert.deepEqual(orbit, [[planet.name, me, 1]], 'they go up into orbit');
assert.deepEqual(retreats, [me], 'and their fleets retreat');
onOrbit(null);
onLanded(null);
console.log('ok', me, 'against', them, 'neutral', neutral, 'on', P);
