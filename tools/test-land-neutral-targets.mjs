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
const { loadMap } = await import('../public/js/ted.js');
const { LandWorld, LandSquad, landUnit } = await import('../public/js/game/land.js');
const map = await loadMap('EM02_An_Organized_Resistance.TED');
const placed = map.objects.find(o => o.type.name === 'MOV_FIELD_COMMANDER_EMPIRE');
assert(placed);
const factions = [...db.factions.values()];
assert(factions[placed.owner].bool('Is_Neutral'), 'The cinematic actor is map-owned by Neutral despite its Empire type affiliation');
assert.equal(placed.type.str('Affiliation'), 'Empire');
assert.equal(db.type('Rancor').str('Affiliation'), 'Hostile');
assert(!db.faction('Hostile').bool('Is_Neutral'));
const world = Object.assign(Object.create(LandWorld.prototype), { team: [0, 1, 0], wild: 3, time: 1, aiSuspended: false, units: [] });
const make = (type, side, x, native = false) => {
  const squad = new LandSquad(world, type, side);
  squad.native = native;
  const unit = landUnit({
    type,
    side,
    squad,
    x,
    y: 0,
    z: 0,
    health: 100,
    maxHealth: 100,
    dead: false,
    inside: false,
    flies: false,
    cloaked: false,
    path: [],
    range: 200,
    minRange: 0,
    antiAir: true,
    scanAt: Infinity
  });
  squad.members = [unit];
  world.units.push(unit);
  return unit;
};
const soldier = make(db.type('Stormtrooper'), 0, 0),
  commander = make(placed.type, world.wild, 5),
  enemy = make(db.type('Stormtrooper'), 1, 90),
  ally = make(db.type('Stormtrooper'), 2, 10),
  beast = make(db.type('Rancor'), world.wild, 50, true);
assert(!world.ally(soldier.side, commander.side), 'Neutral actors do not become allies and reveal fog');
assert(!world.enemy(soldier, commander) && !world.enemy(commander, soldier));
assert(world.enemy(soldier, enemy));
assert(!world.enemy(soldier, ally));
assert(world.enemy(soldier, beast) && world.enemy(beast, soldier), 'Existing hostile wildlife remains hostile in both directions');
assert.equal(world.nearestFoe(soldier, world.units, 200), beast, 'Automatic targeting skips a nearer neutral actor and teammate');
assert.equal(world.nearestFoe(commander, world.units, 200), null, 'Neutral mission actors do not automatically attack either player');
world.aiSuspended = true;
assert.equal(world.nearestFoe(soldier, world.units, 200), null);
world.aiSuspended = false;
assert.equal(world.nearestFoe(soldier, [commander], 200), null, 'Resuming cinematic AI does not make neutral mission actors targets');
soldier.guns = [{ target: commander, cooldown: 0, scanAt: Infinity, range: 200, left: 3 }];
world.fireGuns(soldier, 1 / 30);
assert.equal(soldier.guns[0].target, null);
assert.equal(soldier.guns[0].left, 0);
soldier.weapon = { cooldown: 0 };
soldier.target = commander;
assert.equal(world.fight(soldier, 1 / 30), false);
assert.equal(soldier.target, null);
assert.equal(commander.health, 100);
soldier.confuseUntil = 2;
assert.equal(world.nearestFoe(soldier, world.units, 200), ally, 'Confusion retains the existing ally-targeting behavior');
assert(!world.targetEnemy(soldier, commander), 'Confusion does not reinterpret neutral as friendly');
soldier.confuseUntil = 0;
assert.equal(new Set(world.units.map(unit => Object.keys(unit).join())).size, 1, 'The targeting change adds no per-unit shape drift');
console.log(
  JSON.stringify({
    checks:
      'original Neutral TED owner versus Empire actor affiliation, neutral hostility/vision distinction, hostile Rancor preservation, cinematic AI resume, cached gun/main weapon targets, confusion, uniform LandUnit shapes'
  })
);
