import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod >= 0 ? [process.argv[mod + 1]] : []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = decodeURIComponent(path.replace(/^asset\//, ''))
      .replaceAll('/', String.fromCharCode(92))
      .toUpperCase(),
    data = archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { startingGalaxy, loadCampaignData, forceKind } = await import('../public/js/game/galaxy.js');
const { productionBlock, queueUnit, stepProduction } = await import('../public/js/game/galacticproduction.js');
const { planetFactionChange } = await import('../public/js/game/galacticobliterate.js');
const data = await loadCampaignData();
const campaign = data.campaigns.get('SANDBOX_EQUAL_FOOTING_REBEL');
const g = startingGalaxy(data, campaign),
  owner = g.active,
  player = g.players.find(p => p.faction === owner);
player.credits = 1e6;
player.tech = 5;
const bases = [...db.types.values()]
  .filter(t => forceKind(t) === 'station' && t.list('Affiliation').some(a => a.toUpperCase() === owner.toUpperCase()) && t.num('Build_Cost_Credits', 0) > 0)
  .sort((a, b) => a.num('Base_Level', 0) - b.num('Base_Level', 0));
const level = n => bases.find(t => t.num('Base_Level', 0) === n);
const p = g.planets.find(q => q.owner === owner && q.type.num('Max_Space_Base', 5) >= 3 && !g.fleets.some(f => f.planet === q.index && f.owner !== owner));
assert(p && level(1) && level(2), 'a free planet and two base levels');
p.station = null;
p.spaceLevel = 0;
p.stationOwner = null;
p.orbitalStructures = [];
for (const list of Object.values(p.production)) list.length = 0;
assert.notEqual(productionBlock(g, p.index, owner, level(2)), null, 'no level may be skipped');
p.station = level(1);
p.spaceLevel = 1;
p.stationOwner = owner;
assert.equal(queueUnit(g, p.index, owner, level(2)), null, 'the next level can be queued');
assert.equal(productionBlock(g, p.index, owner, level(2)), 'Invalid starbase level', 'only one star base in the queue');
for (const list of Object.values(p.production)) list.length = 0;
p.station = null;
p.spaceLevel = 0;
p.stationOwner = null;
const enemy = g.players.find(q => q.faction !== owner).faction;
const intruder = { owner: enemy, planet: p.index, units: [{ type: bases[0], owner: enemy }], path: [], dest: -1, leg: null, pos: null };
g.fleets.push(intruder);
assert.equal(productionBlock(g, p.index, owner, level(1)), 'Cannot be produced here', 'not with an enemy in orbit');
g.fleets.splice(g.fleets.indexOf(intruder), 1);
p.orbitalStructures.push({ type: bases[0], owner });
queueUnit(g, p.index, owner, level(1));
for (let i = 0; i < 2000 && !p.station; i++) stepProduction(g, 1);
assert.equal(p.station, level(1));
assert.equal(p.orbitalStructures.length, 0, 'a level 1 star base clears what was in orbit');
const needs = [...db.types.values()].find(
  t => t.num('Required_Star_Base_Level', 0) === 1 && t.num('Build_Cost_Credits', 0) > 0 && t.list('Affiliation').some(a => a.toUpperCase() === owner.toUpperCase()) && forceKind(t) === 'starship'
);
if (needs) {
  p.production.space = [{ type: needs, owner, cost: 1, total: 1e6, left: 1e6 }];
  p.station = null;
  p.spaceLevel = 0;
  stepProduction(g, 0.01);
  assert.equal(p.production.space.length, 0, 'an item that needs the lost star base level is dropped');
}
p.station = level(1);
p.spaceLevel = 1;
p.stationOwner = owner;
p.groundStructures.push({ type: bases[0], owner });
const game = { galaxy: g, story: null };
planetFactionChange(game, p, enemy);
assert.equal(p.owner, enemy);
assert.equal(p.station, null, 'a faction change without a battle clears the star base');
assert.equal(p.groundStructures.length, 0, 'and every ground structure');
console.log('ok', owner, bases.map(t => t.name).join(','));
