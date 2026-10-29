import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { LandWorld, LandSquad, landUnit, buildsFor } = await import('../public/js/game/land.js');
const world = Object.assign(Object.create(LandWorld.prototype), {
  factions: ['Rebel', 'Empire'],
  team: [0, 1],
  campaign: false,
  units: [],
  squads: [],
  transports: [],
  owned: [new Set(), new Set()],
  credits: [1e6, 1e6],
  queues: [
    { units: [], upgrades: [] },
    { units: [], upgrades: [] }
  ],
  ready: [[], []],
  popOverride: 100,
  points: []
});
world.popPlanned = () => 0;
const factory = [...db.types.values()].find(t => buildsFor(t, 'Rebel').some(x => x.name === 'Rebel_Speeder_Wing'));
assert(factory, 'a Rebel building sells Rebel_Speeder_Wing');
const u = landUnit({ type: factory, side: 0, squad: new LandSquad(world, factory, 0), dead: false });
const speeder = db.type('Rebel_Speeder_Wing');
const why = world.cantBuy(u, speeder, 0);
assert.match(why, /^Requires /, 'locked behind the level two tech upgrade: hidden by the bar (' + why + ')');
world.owned[0].add(db.type('RC_Level_Two_Tech_Upgrade').name);
assert.equal(world.cantBuy(u, speeder, 0), null, 'with the tech level it can be bought');
console.log('ok', factory.name);
