import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) { const re = new RegExp(decodeURIComponent(path.slice(11)), 'i'); return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n)))); }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])), data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js'); await loadGameData();
const F = await import('../public/js/game/fleets.js');
const H = await import('../public/js/game/humanroute.js');
const { VIS } = await import('../public/js/game/galacticfog.js');

const ship = [...db.types.values()].find(t => t.num('Hyperspace_Speed', 0) > 0 && t.tag === 'SpaceUnit');
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && t.num('Planet_Credit_Value', 0) > 0);
const planet = (i, owner, extra = {}) => ({ index: i, type: planetType, name: 'P' + i, owner, pos: [i * 100, 0, 0], radius: 5, currentCorruption: -1, garrison: [], groundStructures: [], orbitalStructures: [], ...extra });
const fleetOf = (owner, at, units = [{ type: ship, owner }]) => ({ owner, planet: at, leg: null, path: [], units: units.map(u => ({ ...u })) });
const mk = (viewer = 'Rebel') => {
  const planets = [planet(0, viewer), planet(1, 'Empire'), planet(2, viewer), planet(3, viewer)];
  planets[2].pos = [100, 300, 0];
  const dist = (a, b) => Math.hypot(...a.pos.map((v, i) => v - b.pos[i]));
  const links = planets.map(() => []);
  for (const [a, b] of [[0, 1], [1, 3], [0, 2], [2, 3]]) { links[a].push({ to: b, cost: dist(planets[a], planets[b]) }); links[b].push({ to: a, cost: dist(planets[a], planets[b]) }); }
  const visibility = { planets: planets.map(() => ({ discovered: true, mask: VIS.ALL })) };
  return { planets, links, routes: [], fleets: [], players: [{ faction: viewer, credits: 9000, ai: null }, { faction: 'Empire', credits: 100 }], visibility, time: 0 };
};

{ const g = mk(), f = fleetOf('Rebel', 0); g.fleets.push(f); assert.deepEqual(F.findPath(g, 0, 3, null, H.humanRoute(g, f)), [1, 3]); }
{
  const g = mk(), f = fleetOf('Rebel', 0); g.fleets.push(f, fleetOf('Empire', 1));
  assert.deepEqual(F.findPath(g, 0, 3, null, H.humanRoute(g, f)), [2, 3], 'round it');
  assert.deepEqual(F.findPath(g, 0, 1, null, H.humanRoute(g, f)), [1], 'but it may be the destination');
  assert(H.humanReach(g, f).has(1) && H.humanReach(g, f).has(3));
  assert(F.orderMove(g, f, 3, null, 0, { human: true }) && f.path[0] === 2, 'the order runs round it');
  f.planet = 0; f.leg = null; f.path = [];
  g.visibility.planets[1].mask = VIS.OWNER; assert.deepEqual(F.findPath(g, 0, 3, null, H.humanRoute(g, f)), [1, 3], 'an unseen fleet does not stop the route');
  g.visibility.planets[1].mask = VIS.ALL;
  const s = fleetOf('Rebel', 0, [{ type: ship, owner: 'Rebel', stealth: true }]); assert.deepEqual(F.findPath(g, 0, 3, null, H.humanRoute(g, s)), [1, 3], 'stealth');
  const h = mk(), e = fleetOf('Rebel', 0); h.fleets.push(e, fleetOf('Rebel', 1)); assert.deepEqual(F.findPath(h, 0, 3, null, H.humanRoute(h, e)), [1, 3]);
}
{
  const g = mk(), f = fleetOf('Rebel', 0); g.fleets.push(f, fleetOf('Empire', 1), fleetOf('Empire', 2));
  assert.equal(F.findPath(g, 0, 3, null, H.humanRoute(g, f)), null);
  assert.equal(F.orderMove(g, f, 3, null, 0, { human: true }), false);
  assert(!H.humanReach(g, f).has(3), '3 is out of reach');
  assert(F.orderMove(g, f, 3, null, 0, {}), 'a computer player routes by its own rule');
}
{
  const g = mk(), f = fleetOf('Rebel', 0); g.fleets.push(f); Object.assign(g.planets[1], { station: db.type('Empire_Star_Base_1') || ship, stationOwner: 'Empire', spaceLevel: 1 });
  assert.deepEqual(F.findPath(g, 0, 3, null, H.humanRoute(g, f)), [2, 3]);
  g.planets[1].owner = 'Rebel'; assert.deepEqual(F.findPath(g, 0, 3, null, H.humanRoute(g, f)), [1, 3]);
}
{
  const g = mk(), f = fleetOf('Rebel', 0); g.fleets.push(f); g.visibility.planets[1].discovered = false;
  assert.deepEqual(F.findPath(g, 0, 3, null, H.humanRoute(g, f)), [2, 3]); assert(!H.humanReach(g, f).has(1));
}
{
  const g = mk('Underworld'), f = fleetOf('Underworld', 0); g.fleets.push(f, fleetOf('Empire', 1)); g.planets[1].currentCorruption = 2;
  const route = H.humanRoute(g, f);
  assert.equal(route(g.planets[1], false), 100); assert.equal(route(g.planets[3], false), 0);
  g.planets[2].pos = [100, 5000, 0]; for (const l of [...g.links[0], ...g.links[3], ...g.links[2]]) if (l.to === 2 || (g.links[2].includes(l))) l.cost = 1e6;
  assert.deepEqual(F.findPath(g, 0, 3, null, route), [1, 3], 'through it when the other way costs more than 100 extra');
  g.planets[1].currentCorruption = -1; assert.equal(F.findPath(g, 0, 3, null, H.humanRoute(g, f))?.includes(1), false, 'a clean hostile planet cannot be crossed');
}
console.log('ok');
