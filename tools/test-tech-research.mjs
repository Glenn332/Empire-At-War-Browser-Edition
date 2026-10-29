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
const { techAdvance, setTechLevel, queueUnit, stepProduction, productionBlock } = await import('../public/js/game/galacticproduction.js');
const advances = [...db.types.values()].filter(t => techAdvance(t) > 0 && t.list('Affiliation').length);
if (!advances.length) {
  console.log('no tech items in this data: skipped');
  process.exit(0);
}
const item = advances.sort((a, b) => a.num('Tech_Level') - b.num('Tech_Level'))[0],
  owner = item.list('Affiliation')[0];
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && t.num('Special_Structures_Land', 3) >= 2);
const needed = item
  .list('Required_Special_Structures')
  .map(n => db.type(n))
  .filter(Boolean);
const structures = [
  ...needed,
  ...Array(Math.max(0, item.num('Required_Ground_Base_Level', 0) - needed.length)).fill(needed[0] || db.type('E_Ground_Research_Facility'))
].filter(Boolean);
const planet = {
  index: 0,
  owner,
  type: planetType,
  groundStructures: structures.map(type => ({ type, owner })),
  orbitalStructures: [],
  garrison: [],
  station: null,
  spaceLevel: 0,
  production: { ground: [], space: [] },
  name: 'T'
};
const g = {
  planets: [planet],
  fleets: [],
  players: [{ faction: owner, credits: 100000, tech: item.num('Tech_Level', 1), maxTech: 5, builtCounts: {} }],
  active: owner,
  time: 0
};
const player = g.players[0],
  start = player.tech;
assert.equal(setTechLevel(g, owner, 99), 5, 'the level stops at the maximum');
assert.equal(setTechLevel(g, owner, -3), 0);
player.tech = start;
const why = productionBlock(g, 0, owner, item);
assert.equal(why, null, 'the tech item can be queued: ' + why);
assert.equal(queueUnit(g, 0, owner, item), null);
const credits = player.credits;
assert(credits < 100000, 'it is paid up front');
const done = stepProduction(g, item.num('Build_Time_Seconds', 1) + 1);
assert.equal(done.length, 1);
assert.equal(done[0].tech, techAdvance(item));
assert.equal(player.tech, techAdvance(item), 'the level is the item advance');
assert.equal(g.fleets.length, 0, 'no object is made');
assert.equal(player.builtCounts[item.name], 1);
assert.notEqual(productionBlock(g, 0, owner, item), null, 'an advance to a level already reached is not offered again');
console.log('ok', item.name, start, '->', player.tech);
