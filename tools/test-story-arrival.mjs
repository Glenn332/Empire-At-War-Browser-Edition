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
assert.deepEqual(
  run(
    [
      ev('own', 'STORY_ENTER', P, 'FILTER_FRIENDLY_ONLY'),
      ev('enemy', 'STORY_ENTER', P, 'FILTER_ENEMY_ONLY'),
      ev('unit', 'STORY_ENTER', P, '', company.name)
    ],
    fleet(me, [])
  ),
  ['own'],
  'an empty new fleet passes on its owner but holds no listed unit'
);
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
assert.deepEqual(orbit.at(-1), [planet.name, me, 0], 'a ship built in orbit: its new fleet enters before the ship is added');
const ground = { ...planet, owner: me, garrison: [{ type: company, owner: me }] };
const gal = { planets: [ground], fleets: [] };
orbit.length = 0;
embarkGround(gal, 0, me, { fresh: true });
assert.deepEqual(orbit, [[planet.name, me, 0]], 'a launch into a new fleet: the empty fleet enters first');
ground.garrison.push({ type: company, owner: me });
orbit.length = 0;
embarkGround(gal, 0, me, { fleet: gal.fleets[0] });
assert.deepEqual(orbit, [], 'a launch into a fleet already in orbit enters nothing');
assert.equal(gal.fleets[0].units.length, 2);
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
{
  const hero = [...db.types.values()].find(t => t.bool('Is_Named_Hero') && !t.list('Company_Units').length);
  const waitingEv = (name, type, ...params) => ({ ...ev(name, type, ...params), plot: { owner: me }, prereqs: [] });
  const allowed = (events, f) => host(events).entryAllowed(f, planet);
  assert.equal(allowed([], fleet(me, [{ type: ship }])), false, 'nothing waits for it');
  assert.equal(allowed([waitingEv('in', 'STORY_ENTER', P)], fleet(me, [{ type: ship }])), true, 'a waiting STORY_ENTER lets it in');
  assert.equal(
    allowed([{ ...waitingEv('done', 'STORY_ENTER', P), completed: true }], fleet(me, [{ type: ship }])),
    false,
    'not a completed one'
  );
  assert.equal(allowed([{ ...waitingEv('off', 'STORY_ENTER', P), disabled: true }], fleet(me, [{ type: ship }])), false);
  assert.equal(
    allowed([waitingEv('need', 'STORY_ENTER', P, '', hero.name)], fleet(me, [{ type: ship }])),
    false,
    'its unit filter still applies'
  );
  assert.equal(
    allowed([waitingEv('mv', 'STORY_MOVE', hero.name, P)], fleet(me, [{ type: hero }])),
    true,
    'a waiting hero move lets the hero in'
  );
  assert.equal(allowed([waitingEv('mv', 'STORY_MOVE', hero.name, P)], fleet(me, [{ type: ship }])), false);
  assert.equal(
    allowed([waitingEv('land', 'STORY_LAND_ON', P)], fleet(me, [{ type: ship }])),
    false,
    'landing counts only with troops aboard'
  );
  assert.equal(allowed([waitingEv('land', 'STORY_LAND_ON', P)], fleet(me, [{ type: ship, carries: company }])), true);
  fired = [];
  host([ev('bounce', 'STORY_FLEET_BOUNCED', P), { ...ev('theirs', 'STORY_FLEET_BOUNCED'), plot: { owner: them } }]).fleetBounced(
    fleet(me, [{ type: ship }]),
    planet
  );
  assert.deepEqual(fired, ['bounce'], 'the bounce goes to the plots of the fleet owner');

  const F = await import('../public/js/game/fleets.js');
  const node = (index, x) => ({
    index,
    name: 'P' + index,
    type: planetType,
    pos: [x, 0, 0],
    radius: 0,
    garrison: [],
    groundStructures: [],
    orbitalStructures: []
  });
  const planets = [node(0, 0), node(1, 100), node(2, 200)];
  const bounced = [];
  let open = false;
  const g = {
    planets,
    links: [
      [{ to: 1, cost: 1 }],
      [
        { to: 0, cost: 1 },
        { to: 2, cost: 1 }
      ],
      [{ to: 1, cost: 1 }]
    ],
    fleets: [],
    routes: [],
    players: [
      { faction: me, ai: null },
      { faction: them, ai: 'Easy' }
    ],
    storyEntry: () => open,
    onBounce: (f, to) => bounced.push(to)
  };
  planets[2].restricted = true;
  const mine = fleet(me, [{ type: ship }]);
  assert.equal(F.orderMove(g, mine, 2, null, null, { human: true }), false, 'an order into a restricted planet is turned down');
  assert.deepEqual(bounced, [2], 'and tells the bounce');
  const theirs = fleet(them, [{ type: ship }]);
  F.orderMove(g, theirs, 2, null, null, { human: false });
  assert.deepEqual(bounced, [2], 'a computer fleet is not checked here');
  open = true;
  bounced.length = 0;
  const go = fleet(me, [{ type: ship }]);
  g.fleets.push(go);
  assert(F.orderMove(g, go, 2, null, null, { human: true }), 'an open planet takes the order');
  {
    open = false;
    F.stepFleets(g, 1e6, () => {});
    assert.deepEqual(bounced, [2], 'closed while under way: bounced before the last hop');
    assert.equal(go.planet, 1, 'it stops one planet short');
  }
}
console.log('ok', me, 'against', them, 'neutral', neutral, 'on', P);
