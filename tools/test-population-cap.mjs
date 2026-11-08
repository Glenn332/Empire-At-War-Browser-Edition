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
const { populationCap } = await import('../public/js/game/galacticproduction.js');
const capType = [...db.types.values()].find(t => t.num('Additional_Population_Capacity', 0) > 0);
const extra = capType.num('Additional_Population_Capacity', 0);
const fake = (name, allies) => ({ name, num: (k, d) => (k === 'Base_Population_Capacity' ? 10 : d), list: k => (k === 'Allies' ? allies : []) });
const factions = { A: fake('A', []), B: fake('B', ['A']), C: fake('C', []) };
const original = db.faction.bind(db);
db.faction = n => factions[String(n)] || original(n);
const planet = (owner, unitOwner) => ({
  owner,
  type: { num: () => 0 },
  station: null,
  groundStructures: [{ owner: unitOwner, type: capType }],
  orbitalStructures: [],
  garrison: []
});
const g = { players: [{ faction: 'A' }, { faction: 'B' }, { faction: 'C' }], planets: [planet('A', 'A'), planet('B', 'B'), planet('C', 'C')], fleets: [] };
assert.equal(populationCap(g, 'A'), 10 + extra, 'single player: only what the player owns');
g.humans = ['A', 'B'];
assert.equal(populationCap(g, 'A'), 10 + 2 * extra, 'multiplayer: an ally adds what it owns');
assert.equal(populationCap(g, 'B'), 10 + extra, 'the ally test is the other player naming this one');
assert.equal(populationCap(g, 'C'), 10 + extra, 'no ally, no share');
db.faction = original;
console.log('ok', capType.name, extra);
