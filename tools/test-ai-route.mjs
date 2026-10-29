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
const F = await import('../public/js/game/fleets.js');
const A = await import('../public/js/game/airoute.js');

const ship = [...db.types.values()].find(t => t.tag === 'SpaceUnit' && t.num('Hyperspace_Speed', 0) > 0);
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && t.num('Planet_Credit_Value', 0) > 0);
const planet = (i, owner, extra = {}) => ({
  index: i,
  type: planetType,
  name: 'P' + i,
  owner,
  pos: [i * 100, 0, 0],
  radius: 5,
  currentCorruption: -1,
  spaceLevel: 0,
  garrison: [],
  groundStructures: [],
  orbitalStructures: [],
  ...extra
});
const fleetOf = (owner, at, stealth = false) => ({
  owner,
  planet: at,
  leg: null,
  path: [],
  units: [
    { type: ship, owner, stealth },
    { type: ship, owner, stealth }
  ]
});
const mk = (mover = 'Rebel', owners = ['Rebel', 'Rebel', 'Rebel', 'Rebel']) => {
  const planets = owners.map((o, i) => planet(i, o));
  planets[2].pos = [100, 300, 0];
  const d = (a, b) => Math.hypot(...a.pos.map((v, i) => v - b.pos[i])),
    links = planets.map(() => []);
  for (const [a, b] of [
    [0, 1],
    [1, 3],
    [0, 2],
    [2, 3]
  ]) {
    links[a].push({ to: b, cost: d(planets[a], planets[b]) });
    links[b].push({ to: a, cost: d(planets[a], planets[b]) });
  }
  return {
    planets,
    links,
    routes: [],
    fleets: [],
    players: [
      { faction: mover, credits: 9000, ai: 1 },
      { faction: 'Empire', credits: 100 }
    ],
    autoReveal: true,
    time: 0
  };
};
const route = (g, f, status, to = 3) => F.findPath(g, f.planet, to, null, A.aiRoute(g, f, status));

assert.equal(A.statusOf('FRIENDLY_ONLY'), 0);
assert.equal(A.statusOf('enemy_undefended'), 3);
assert.equal(A.statusOf('Any'), 5);
assert.equal(A.statusOf(undefined), 2);
{
  const g = mk(),
    f = fleetOf('Rebel', 0);
  g.fleets.push(f);
  assert.deepEqual(route(g, f, 0), [1, 3]);
  g.fleets.push(fleetOf('Empire', 1));
  assert.deepEqual(route(g, f, 0), [2, 3], 'round the enemy');
  assert.deepEqual(route(g, f, 3), [2, 3]);
  assert.deepEqual(route(g, f, 5), [1, 3], 'any crosses it');
  assert.deepEqual(route(g, f, 2, 1), [1], 'the target is allowed for status 2 and over');
  assert.equal(route(g, f, 1, 1), null, 'status 1 still tests for a hostile presence');
  g.fleets.at(-1).units.forEach(u => {
    u.stealth = true;
  });
  assert.deepEqual(route(g, f, 0), [1, 3], 'a hidden fleet is not a hostile presence');
}
{
  const g = mk('Rebel', ['Rebel', 'Empire', 'Rebel', 'Rebel']),
    f = fleetOf('Rebel', 0);
  g.fleets.push(f);
  assert.deepEqual(route(g, f, 2), [2, 3], 'status 2 keeps to friendly ground');
  assert.deepEqual(route(g, f, 3), [1, 3], 'status 3 crosses undefended enemy ground');
  Object.assign(g.planets[1], { station: db.type('Empire_Star_Base_1') || ship, stationOwner: 'Empire', spaceLevel: 1 });
  assert.deepEqual(route(g, f, 3), [2, 3], 'not a hostile star base');
}
{
  const g = mk('Underworld', ['Underworld', 'Empire', 'Underworld', 'Underworld']),
    f = fleetOf('Underworld', 0);
  g.fleets.push(f, fleetOf('Empire', 1));
  g.planets[1].currentCorruption = 2;
  const r = A.aiRoute(g, f, 3);
  assert.equal(r(g.planets[1], false, g.planets[0]), 100);
  g.planets[2].pos = [100, 4000, 0];
  for (const l of g.links.flat()) if (l.to === 2 || g.links[2].includes(l)) l.cost = 1e6;
  assert.deepEqual(F.findPath(g, 0, 3, null, r), [1, 3]);
  g.planets[1].currentCorruption = -1;
  assert.equal(F.findPath(g, 0, 3, null, A.aiRoute(g, f, 3))?.includes(1), false);
}
{
  const g = mk(),
    f = fleetOf('Rebel', 0);
  g.fleets.push(f);
  g.autoReveal = false;
  g.visibility = { planets: g.planets.map(() => ({ discovered: false })) };
  assert.equal(route(g, f, 0), null, 'nothing known');
  g.visibility.planets.forEach(v => {
    v.discovered = true;
  });
  g.visibility.planets[1].discovered = false;
  assert.deepEqual(route(g, f, 0), [2, 3]);
  g.planets[1].revealed = true;
  assert.deepEqual(route(g, f, 0), [1, 3], 'revealed by the story');
  g.autoReveal = true;
  g.visibility.planets[1].discovered = false;
  assert.deepEqual(route(g, f, 0), [1, 3]);
}
{
  const g = mk('Rebel', ['Rebel', 'Rebel', 'Rebel', 'Rebel']),
    f = fleetOf('Rebel', 0);
  g.fleets.push(f, fleetOf('Empire', 1));
  assert(A.hopBlocked(g, f, 1, 3, 0), 'held by the Empire');
  assert(!A.hopBlocked(g, f, 1, 3, 2), 'status 2 goes on');
  assert(!A.hopBlocked(g, f, 2, 3, 0), 'a hop nobody holds');
  g.fleets.push(fleetOf('Rebel', 2));
  assert(!A.hopBlocked(g, f, 2, 3, 0), 'its own fleet');
  const u = fleetOf('Underworld', 0);
  assert(!A.hopBlocked(g, u, 1, 3, 0), 'benefits: through a hop that is not the target');
  assert(A.hopBlocked(g, u, 1, 1, 0), 'but not the target');
}
{
  const g = mk(),
    f = fleetOf('Rebel', 0);
  g.fleets.push(f);
  assert(F.orderMove(g, f, 3, null, 0, { status: 0 }) && f.aiStatus === 0 && f.path[0] === 1);
  g.fleets.push(fleetOf('Empire', 1), fleetOf('Empire', 2));
  let arrived = null;
  F.stepFleets(g, 1e6, (fl, p) => {
    arrived = p;
  });
  assert.equal(arrived, 1, 'it stopped at the first planet');
  assert.equal(f.planet, 1);
  assert(!f.leg);
  const h = mk(),
    e = fleetOf('Rebel', 0);
  h.fleets.push(e, fleetOf('Empire', 1));
  assert.equal(F.orderMove(h, e, 3, null, 0, { status: 0 }) && e.path[0], 2, 'it goes round the held planet');
  const k = mk(),
    m = fleetOf('Rebel', 0);
  k.fleets.push(m, fleetOf('Empire', 1), fleetOf('Empire', 2));
  assert.equal(F.orderMove(k, m, 3, null, 0, { status: 0 }), false, 'no way: no move');
}
{
  const g = mk();
  const reach = (target, status) =>
    A.reachList(g, 'Rebel', g.planets[target], status)
      .map(p => p.index)
      .sort();
  assert.deepEqual(reach(3, 0), [0, 1, 2, 3], 'friendly ground, all connected');
  g.fleets.push(fleetOf('Empire', 1));
  assert.deepEqual(reach(3, 0), [0, 2, 3], 'an enemy fleet cuts planet 1 off');
  assert.deepEqual(reach(3, 1), [0, 1, 2, 3], 'status 1 ignores the threat');
  g.planets[3].owner = 'Empire';
  g.fleets.push(fleetOf('Empire', 3));
  assert.deepEqual(reach(3, 0), [], 'status 0 from ground that is not an ally ground');
  assert.deepEqual(reach(3, 2), [0, 2], 'status 2: from a hostile target the region round it with most ally planets');
  g.planets[1].owner = 'Empire';
  assert.deepEqual(reach(3, 4), [0, 2], 'status 4: all the regions round it');
}
{
  const g = mk(),
    arriving = fleetOf('Rebel', 3),
    friend = fleetOf('Rebel', -1),
    foe = fleetOf('Empire', -1),
    other = fleetOf('Rebel', -1);
  g.planets[3].owner = 'Empire';
  for (const f of [friend, foe, other]) {
    f.leg = { a: 0, b: 3 };
    f.dest = 3;
    f.path = [3];
  }
  other.dest = 1;
  g.fleets.push(arriving, friend, foe, other);
  const pulled = F.pullIn(g, 3, arriving);
  assert.deepEqual(pulled, [friend, foe], 'owned by the arriving owner or the planet owner, on their way to this planet');
  assert(pulled.every(f => f.planet === 3 && !f.leg && !f.path.length));
  assert(other.leg && other.planet === -1, 'one bound elsewhere is not');
}
console.log('ok');
