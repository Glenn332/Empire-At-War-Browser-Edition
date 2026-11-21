import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const modPath = process.env.SWR_TEST_MOD;
if (!modPath) {
  console.log('space detour: set SWR_TEST_MOD to the Thrawns Revenge mod to run the Atravis Madness case');
  process.exit(0);
}
const archive = openGame(gameDir, [modPath]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const pattern = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(name => pattern.test(name))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const THREE = await import('../public/vendor/three/build/three.module.js');
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const S = await import('../public/js/game/sim.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');

const MAP_NAME = '_MP_SPACE_ATRAVIS_MADNESS.TED',
  SHIP_NAME = 'Skirmish_Imperial_I_Star_Destroyer_Command',
  START = { x: -5500, y: -5500 },
  GOAL = { x: 5500, y: 5500 },
  STEP = 1 / 30,
  LIMIT_SECONDS = 600;
const shipType = db.type(SHIP_NAME);
if (![...archive.index.keys()].some(name => name.endsWith(MAP_NAME)) || !shipType) {
  console.log('space detour: ' + MAP_NAME + ' or ' + SHIP_NAME + ' is not in this mod, skipped');
  process.exit(0);
}
const map = await loadMap(MAP_NAME);
{
  const names = new Set(),
    seen = new Set();
  S.modelsForType(shipType, null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (target, key) => (key === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });
const goalArea = 600;
async function fly(lockstep) {
  S.resetEntityIds();
  seedSim(7);
  const world = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  world.modelOpts = { headless: true };
  world.artReady = () => true;
  world.onEvent = () => {};
  world.fog = false;
  if (lockstep) await world.paths.deterministic();
  for (const placed of map.objects) world.addField(placed.type, placed.pos[0], placed.pos[1], placed.type.num('Scale_Factor', 1) * (placed.scale || 1));
  assert(world.fields.length > 50, 'the map has its fields: ' + world.fields.length);
  const empire = world.addPlayer(new S.Player(0, world.addTeam(new S.Team(0, 'Empire')), { credits: 1e6, human: true }));
  const ship = world.spawn(shipType, empire, START.x, START.y, 0);
  ship.setOrder({ kind: 'move', x: GOAL.x, y: GOAL.y });
  const engineRoute = world.paths.engineFind(ship, GOAL.x, GOAL.y);
  assert(engineRoute && !engineRoute.length, 'the engine tries find no route here');
  let seconds = 0,
    closest = Infinity,
    secondsInField = 0,
    usedDetour = false;
  while (seconds < LIMIT_SECONDS) {
    world.update(STEP);
    seconds += STEP;
    const route = ship.route?.pts;
    if (route && route.length && route[route.length - 1].detour) usedDetour = true;
    if (world.inHazard(ship)) secondsInField += STEP;
    closest = Math.min(closest, Math.hypot(ship.x - GOAL.x, ship.y - GOAL.y));
    if (closest < goalArea) break;
  }
  console.log(
    SHIP_NAME + ' on ' + MAP_NAME + ' (' + world.fields.length + ' fields, ' + (lockstep ? 'lockstep' : 'single player') + '): ' +
      (closest < goalArea ? 'reached the goal area in ' + seconds.toFixed(1) + ' s' : 'closest ' + Math.round(closest) + ' after ' + LIMIT_SECONDS + ' s') +
      ', ' + secondsInField.toFixed(1) + ' s inside a field, flown on our detour: ' + usedDetour
  );
  assert(usedDetour, 'the move is flown on our detour');
  assert(closest < goalArea, 'the ship reaches the goal area');
  assert(secondsInField < 1, 'the detour keeps out of the fields');
  return { seconds, x: ship.x, y: ship.y };
}
const singlePlayer = await fly(false),
  lockstep = await fly(true),
  again = await fly(true);
assert.deepEqual(again, lockstep, 'lockstep flies the detour the same way every time');
console.log('space detour ok');
