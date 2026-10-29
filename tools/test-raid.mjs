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
const R = await import('../public/js/game/raid.js');
const I = await import('../public/js/game/invasion.js');
if (!db.constants.str('Raid_Force_Required_Faction').trim()) {
  console.log('no raid force in this data: skipped');
  process.exit(0);
}

const company = n => db.type(n);
const tank = company('Rebel_Light_Tank_Brigade'),
  heavy = company('Rebel_Heavy_Tank_Brigade'),
  speeder = company('Rebel_Speeder_Wing'),
  droids = company('Droids_Team'),
  han = company('Han_Solo_Team'),
  mothma = company('Mon_Mothma_Team');
const carried = (type, owner = 'Rebel') => ({ type: I.companyTransport(type) || type, carries: type, owner });
const fleet = (units, owner = 'Rebel', planet = 0) => ({ owner, planet, leg: null, units, path: [] });
assert(tank && heavy && speeder && droids && han);

assert(R.isRaidForce(fleet([carried(tank)])));
assert(R.isRaidForce(fleet([carried(tank), carried(speeder)])));
assert(!R.isRaidForce(fleet([carried(tank), carried(speeder), carried(heavy)])), 'three limited companies are too many');
assert(R.isRaidForce(fleet([carried(tank), carried(droids)])), 'a hero is free');
assert(!R.isRaidForce(fleet([carried(droids)])), 'heroes alone are not a raid');
assert(!R.isRaidForce(fleet([carried(tank), carried(droids), carried(han)])), 'only one hero');
assert(!R.isRaidForce(fleet([carried(tank), carried(mothma)])), 'a non-combat hero is neither free nor limited');
assert(!R.isRaidForce(fleet([carried(tank)], 'Empire')), 'Rebel only');
assert(!R.isRaidForce(fleet([{ type: db.type('Nebulon_B_Frigate'), owner: 'Rebel' }, carried(tank)])), 'a ship fails it');
assert(!R.isRaidForce(fleet([])));

const planetType = [...db.types.values()].find(
  t => t.tag.toLowerCase() === 'planet' && t.bool('Planet_Surface_Accessible', true) && !t.list('Planet_Restricted_Unit_Categories').length
);
const planet = (i, owner, extra = {}) => ({
  index: i,
  type: planetType,
  name: 'P' + i,
  owner,
  pos: [i * 100, 0, 0],
  garrison: [],
  groundStructures: [],
  orbitalStructures: [],
  ...extra
});
const galaxy = {
  planets: [planet(0, 'Rebel'), planet(1, 'Empire'), planet(2, null), planet(3, 'Rebel'), planet(4, 'Empire', { destroyed: true })],
  fleets: [],
  players: []
};
const f = fleet([carried(tank)]);
assert(R.raidCapable(galaxy, f, 1), 'an enemy planet');
assert(R.raidCapable(galaxy, f, 2), 'a planet with no owner');
assert(!R.raidCapable(galaxy, f, 0), 'not where it is');
assert(!R.raidCapable(galaxy, f, 3), 'its own side');
assert(!R.raidCapable(galaxy, f, 4), 'a destroyed planet');
assert(!R.raidCapable(galaxy, fleet([carried(tank), carried(speeder), carried(heavy)]), 1), 'not a raid force');
assert.equal(R.RAID_SLOT().text, 'TEXT_ABILITY_SLOT_RAID');
assert.equal(R.RAID_SLOT().code, 0);

{
  const g = {
    planets: [planet(0, 'Rebel'), planet(1, 'Empire', { station: db.type('Empire_Star_Base_1'), stationOwner: 'Empire', garrison: [] })],
    fleets: [],
    players: []
  };
  const raiders = fleet([carried(tank)], 'Rebel', 1);
  g.fleets.push(raiders);
  assert(!I.canLand(g, raiders, 1), 'an ordinary landing waits for the orbit to be cleared');
  assert(I.canLand(g, raiders, 1, { raid: true }), 'a raid lands past it');
}
console.log('ok');
