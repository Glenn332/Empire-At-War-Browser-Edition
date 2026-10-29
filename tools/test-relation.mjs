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
const R = await import('../public/js/game/galacticrelation.js');

assert.equal(R.relation('Empire', 'Empire'), 0, 'itself');
assert.equal(R.relation('Empire', 'Rebel'), 1, 'the Enemies list');
assert.equal(R.relation('Rebel', 'Empire'), 1);
const neutral = [...db.factions.values()].find(f => f.bool('Is_Neutral'));
if (neutral) {
  assert.equal(R.relation('Empire', neutral.name), 2, 'neutral first');
  assert.equal(R.relation(neutral.name, 'Empire'), 2);
  assert(!R.enemy('Empire', neutral.name));
}
{
  const fake = (name, extra) => ({ bool: k => k === 'Is_Neutral' && !!extra.neutral, list: k => extra[k] || [] });
  const real = db.faction.bind(db);
  db.faction = n =>
    ({ A: fake('A', { Enemies: ['B', 'C'], Allies: ['B'] }), B: fake('B', {}), C: fake('C', { neutral: true }) })[
      String(n).toUpperCase()
    ] || real(n);
  assert.equal(R.relation('A', 'B'), 1, 'Enemies beat Allies');
  assert.equal(R.relation('A', 'C'), 2, 'neutral beats Enemies');
  assert.equal(R.relation('B', 'A'), undefined, 'not set: not hostile');
  db.faction = real;
}
const ship = [...db.types.values()].find(t => t.tag === 'SpaceUnit' && t.num('Hyperspace_Speed', 0) > 0);
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet');
const fleet = (owner, at, units = 2, stealth = false) => ({
  owner,
  planet: at,
  leg: null,
  units: Array.from({ length: units }, () => ({ type: ship, owner, stealth }))
});
const g = () => ({ planets: [{ index: 0, type: planetType, owner: 'Empire', station: null, spaceLevel: 0 }], fleets: [] });
{
  const a = g();
  assert(!R.conflictAt(a, 0, 'Rebel'), 'nothing there');
  a.planets[0].station = db.type('Empire_Star_Base_1') || ship;
  a.planets[0].stationOwner = 'Empire';
  assert(!R.conflictAt(a, 0, 'Rebel'), 'a station of level 0 is no base');
  a.planets[0].spaceLevel = 1;
  assert(R.conflictAt(a, 0, 'Rebel'), 'a hostile star base alone');
  assert(!R.conflictAt(a, 0, 'Empire'), 'its own');
  assert(!R.conflictAt(a, 0, 'Rebel', fleet('Rebel', -1, 1, true)), 'a hidden fleet meets none');
  const b = g();
  b.fleets.push(fleet('Empire', 0));
  assert(R.conflictAt(b, 0, 'Rebel'), 'a hostile fleet in orbit');
  assert(!R.conflictAt(b, 0, 'Empire'), 'a friend');
  b.fleets[0].units.forEach(u => {
    u.stealth = true;
  });
  assert(!R.conflictAt(b, 0, 'Rebel'), 'a hidden fleet in orbit is not met');
  b.fleets[0].units.forEach(u => {
    u.stealth = false;
    u.dead = true;
  });
  assert(!R.conflictAt(b, 0, 'Rebel'), 'one with no live ship is not met');
}
console.log('ok');
