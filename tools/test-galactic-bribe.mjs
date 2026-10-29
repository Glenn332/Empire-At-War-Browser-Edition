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
const X = await import('../public/js/game/galacticbribe.js');
const F = await import('../public/js/game/fleets.js');
if (!db.faction('Underworld')?.bool('Benefits_From_Corruption')) { console.log('no Benefits_From_Corruption faction in this data: skipped'); process.exit(0); }

const ship = [...db.types.values()].find(t => t.num('Cheap_Bribe_Cost', 0) > 0 && t.num('Expensive_Bribe_Cost', 0) > 0 && t.num('Hyperspace_Speed', 0) > 0);
assert(ship, 'a ship with both prices');
const cheap = ship.num('Cheap_Bribe_Cost', 0), dear = ship.num('Expensive_Bribe_Cost', 0);
assert(db.faction('Empire').bool('Easily_Bribed') && !db.faction('Rebel').bool('Easily_Bribed'), 'the Empire is bought cheaply, the Rebels not');
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && t.num('Planet_Credit_Value', 0) > 0);
const planet = (i, owner, extra = {}) => ({ index: i, type: planetType, name: 'P' + i, owner, pos: [i * 100, 0, 0], radius: 5, currentCorruption: 3, garrison: [], groundStructures: [], orbitalStructures: [], ...extra });
const fleetOf = (owner, planetIndex, n = 2) => ({ owner, planet: planetIndex, leg: null, path: [], units: Array.from({ length: n }, () => ({ type: ship, owner })) });
const mk = () => {
  const planets = [planet(0, 'Underworld'), planet(1, 'Empire'), planet(2, 'Rebel', { station: db.type('Empire_Star_Base_1') || ship, stationOwner: 'Rebel', spaceLevel: 1 }), planet(3, 'Empire', { currentCorruption: -1 }), planet(4, 'Empire'), planet(5, 'Underworld')];
  const links = planets.map((_, i) => [i - 1, i + 1].filter(j => j >= 0 && j < planets.length).map(to => ({ to, cost: 100 })));
  const g = { planets, links, routes: [], fleets: [], players: [{ faction: 'Underworld', credits: 5000, ai: null }, { faction: 'Empire', credits: 100 }, { faction: 'Rebel', credits: 100 }], time: 0 };
  g.fleets.push(fleetOf('Empire', 1, 3)); return g;
};

{
  const g = mk();
  assert.equal(X.controllerOf(g, 1), 'Empire'); assert.equal(X.controllerOf(g, 2), 'Rebel'); assert.equal(X.controllerOf(g, 4), null);
  g.fleets.push({ ...fleetOf('Rebel', 1, 1), units: [{ type: ship, owner: 'Rebel', stealth: true }] });
  assert.equal(X.controllerOf(g, 1), 'Empire', 'a hidden fleet comes after a seen one');
}
{
  const g = mk(), f = fleetOf('Underworld', 0);
  assert.equal(X.orderCost(g, f, 1), 2 * cheap, 'the Empire: cheap');
  assert.equal(X.orderCost(g, f, 2), 2 * dear, 'the Rebels: dear');
  assert.equal(X.orderCost(g, f, 3), 2 * cheap, 'no corruption needed for an order');
  assert.equal(X.orderCost(g, f, 4), 2 * cheap, 'nobody controls it: still priced');
  assert.equal(X.orderCost(g, fleetOf('Empire', 0), 2), 0, 'only a faction that benefits from corruption');
  g.fleets.push(fleetOf('Underworld', 4, 1)); assert.equal(X.orderCost(g, f, 4), 0, 'its own fleet controls it');
  g.players[0].bribeMultiplier = 0.25; assert.equal(X.orderCost(g, f, 1, false), Math.trunc(2 * cheap * 0.25), 'a computer player: cut'); assert.equal(X.orderCost(g, f, 1, true), 2 * cheap);
}
{
  const g = mk(), f = fleetOf('Underworld', 0); g.fleets.push(f);
  const run = X.bribeRun(g, f, [1, 2, 3, 4, 5]);
  assert.deepEqual(run.nodes.map(n => n.planet), [1, 2, 3, 4]); assert.equal(run.total, 2 * cheap + 2 * dear + 2 * cheap + 2 * cheap);
  assert(F.orderMove(g, f, 5, null, 0, { human: true }));
  assert.equal(g.players[0].credits, 5000 - run.total, 'paid');
  assert.equal(g.players[1].credits, 100 + 6 * cheap, 'the Empire is paid its parts'); assert.equal(g.players[2].credits, 100 + 2 * dear, 'the Rebels theirs');
  assert(f.leg && f.dest === 5 && f.humanOrder, 'it sets out');
  const h = mk(), e = fleetOf('Underworld', 0); h.fleets.push(e); h.players[0].credits = X.bribeRun(h, e, [1, 2, 3, 4, 5]).total;
  assert(F.orderMove(h, e, 5, null, 0, { human: true }), 'equal credits suffice');
}
{
  const g = mk(), f = fleetOf('Underworld', 0); g.fleets.push(f); g.players[0].credits = 10; let denied = false;
  assert.equal(F.orderMove(g, f, 5, null, 0, { human: true, denied: () => { denied = true; } }), false);
  assert(denied && g.players[0].credits === 10 && f.planet === 0 && !f.leg);
}
{
  const g = mk(), f = fleetOf('Underworld', 0); g.fleets.push(f); g.players[0].credits = 10000; g.players[0].bribeMultiplier = 0.25;
  assert(F.orderMove(g, f, 5, null, 0, {}), 'no charge at the order'); assert.equal(g.players[0].credits, 10000); assert(!f.humanOrder);
  assert(X.passByBribe(g, f, 1), 'corrupted, held by the Empire: bought'); assert.equal(g.players[0].credits, 10000 - Math.trunc(2 * cheap * 0.25)); assert.equal(g.players[1].credits, 100, 'nobody is paid');
  assert(!X.passByBribe(g, f, 3), 'a planet with no corruption cannot be bought');
  g.players[0].credits = 0; assert(!X.passByBribe(g, f, 2) || Math.trunc(2 * dear * 0.25) === 0, 'without credits it fights');
}
{
  const g = mk(), f = fleetOf('Underworld', 0);
  assert.equal(X.hudQuote(g, f, [1, 2, 3, 4, 5], 'Underworld'), 2 * cheap + 2 * dear, 'planets 3 (clean) and 4 (no controller) are not in the quote');
  assert.equal(X.hudQuote(g, f, [1, 2, 3, 4, 5], 'Empire'), 0, 'a faction that does not benefit sees none');
  assert.equal(F.bribeQuote(g, f, 5, 'Underworld'), 2 * cheap + 2 * dear);
}
{
  const g = mk(), f = fleetOf('Underworld', 0); g.fleets.push(f); g.players[0].credits = 0;
  assert(F.orderMove(g, f, 5, null, 0, { free: true }), 'free');
}
console.log('ok');
