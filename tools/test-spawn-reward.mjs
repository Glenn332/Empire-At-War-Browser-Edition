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
const { startingGalaxy, loadCampaignData, forceKind } = await import('../public/js/game/galaxy.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const key = s => String(s || '').toUpperCase();
const data = await loadCampaignData();
const campaign = [...data.campaigns.values()].find(c => {
  const g = startingGalaxy(data, c);
  const owners = new Set(g.planets.filter(p => !p.background).map(p => p.owner));
  return g.players.filter(p => owners.has(p.faction)).length >= 2;
});
const fresh = () => {
  const g = startingGalaxy(data, campaign);
  const host = Object.create(GalacticStoryHost.prototype);
  host.eventTypes = new Map();
  host.objectCache = null;
  host.reasonCache = new Map();
  host.fire = () => {};
  host.game = { galaxy: g, battles: { arrive() {} } };
  const owns = f => g.planets.some(p => !p.background && p.owner === f);
  const me = g.players.find(p => owns(p.faction)).faction;
  return { g, host, me, them: g.players.find(p => p.faction !== me && owns(p.faction)).faction };
};
let { g, host, me, them } = fresh();
const ship = [...db.types.values()].find(t => forceKind(t) === 'starship' && t.list('Affiliation').some(a => key(a) === key(me)));
const real = g.planets.filter(p => !p.background);
const mine = real.find(p => p.owner === me),
  theirs = real.find(p => p.owner === them);
const count = (pl, t = ship) =>
  g.fleets.filter(f => f.planet === pl.index).reduce((n, f) => n + f.units.filter(u => u.type === t).length, 0);
let before = count(mine);
host.spawnReward([ship.name, mine.type.name], me);
assert.equal(count(mine), before + 1, 'spawned at the named planet the owner holds');
before = count(mine);
host.spawnReward([ship.name, mine.type.name, '3'], me);
assert.equal(count(mine), before + 3, 'Reward_Param3 is the count');
before = count(mine);
host.spawnReward([ship.name, mine.type.name, '0'], me);
assert.equal(count(mine), before, 'a count below one spawns nothing');
const d2 = q => q.pos.reduce((s, n, k) => s + (n - theirs.pos[k]) ** 2, 0);
const near = real.filter(p => p.owner === me).sort((a, b) => d2(a) - d2(b))[0];
before = count(near);
host.spawnReward([ship.name, theirs.type.name], me);
assert.equal(count(near), before + 1, 'an enemy planet: the nearest planet the owner holds');
assert.equal(count(theirs), 0);
({ g, host, me, them } = fresh());
const home = g.planets.find(p => p.index === mine.index);
home.station = null;
home.spaceLevel = 0;
g.fleets = g.fleets.filter(f => f.planet !== home.index);
g.fleets.push({ owner: them, planet: home.index, units: [{ type: ship }], leg: null, path: [], dest: -1, pos: home.pos.slice() });
const d3 = q => q.pos.reduce((s, n, k) => s + (n - home.pos[k]) ** 2, 0);
const clearOwned = g.planets
  .filter(p => !p.background && p.owner === me && p !== home && !(p.station && p.spaceLevel > 0 && p.stationOwner && p.stationOwner !== me))
  .filter(p => !g.fleets.some(f => f.planet === p.index && f.units.length && f.owner !== me))
  .sort((a, b) => d3(a) - d3(b))[0];
const was = g.fleets.filter(f => f.planet === clearOwned.index).reduce((n, f) => n + f.units.length, 0);
host.spawnReward([ship.name, home.type.name], me);
assert.equal(
  g.fleets.filter(f => f.planet === clearOwned.index).reduce((n, f) => n + f.units.length, 0),
  was + 1,
  'an enemy fleet over the planet: the nearest held planet with a clear orbit'
);
assert.equal(host.spawnReward(['No_Such_Type', home.type.name], me), false);
console.log(
  'ok',
  campaign.name,
  ship.name,
  'at',
  mine.name,
  'near',
  theirs.name,
  '->',
  near.name,
  'blocked',
  home.name,
  '->',
  clearOwned.name
);
