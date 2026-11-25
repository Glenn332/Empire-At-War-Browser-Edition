import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const archive = openGame(gameDir);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
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

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const { orderMove } = await import('../public/js/game/orders.js');

const maps = [...archive.index.keys()].filter(name => /\\MAPS\\[^\\]*\.TED$/.test(name));
const map = await loadMap(
  maps
    .find(name => /_SPACE_PLANET_/.test(name) && /KUAT/.test(name))
    .split('\\')
    .pop()
);
const used = [
  'TIE_Fighter_Squadron',
  'TIE_Bomber_Squadron',
  'Corellian_Corvette',
  'Star_Destroyer',
  'Tartan_Patrol_Cruiser',
  'Rebel_X-Wing_Squadron'
];
{
  const names = new Set(),
    seen = new Set();
  for (const name of used) S.modelsForType(T(name), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, {
  get: (target, key) => (key === Symbol.toPrimitive ? () => 0 : nothing),
  apply: () => undefined
});

function battle(seed) {
  S.resetEntityIds();
  seedSim(seed);
  const world = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  world.modelOpts = { headless: true };
  world.artReady = () => true;
  world.onEvent = () => {};
  world.fog = false;
  const [empire, rebel] = ['Empire', 'Rebel'].map((faction, i) =>
    world.addPlayer(new S.Player(i, world.addTeam(new S.Team(i, faction)), { credits: 1000 }))
  );
  const run = seconds => {
    for (let n = Math.round(seconds / DT); n > 0; n--) world.update(DT);
  };
  return { world, empire, rebel, run };
}

{
  const { world, empire, run } = battle(3);
  const ships = [],
    squadrons = [];
  for (let i = 0; i < 4; i++)
    ships.push(world.spawn(T(i % 2 ? 'Tartan_Patrol_Cruiser' : 'Star_Destroyer'), empire, -6000 + (i % 2) * 1200, -1800 + i * 1200));
  for (let i = 0; i < 8; i++)
    squadrons.push(world.spawn(T(i % 3 ? 'TIE_Fighter_Squadron' : 'TIE_Bomber_Squadron'), empire, -5400 + (i % 2) * 1600, -2400 + i * 650));
  run(2);
  orderMove([...ships, ...squadrons], 6000, 0, true);
  const escort = squadrons[0].order.wing && squadrons[0].order.wing.escort;
  assert(escort, 'squadrons moved with a fleet escort one of its ships');
  const placeOf = squadron => ({ x: squadron.fighters[0].x - escort.x, y: squadron.fighters[0].y - escort.y });
  const before = squadrons.map(placeOf);
  run(30);
  squadrons.forEach((squadron, i) => {
    const now = placeOf(squadron),
      drift = Math.hypot(now.x - before[i].x, now.y - before[i].y);
    assert(drift < 400, 'a squadron keeps its place in the fleet while it moves: drifted ' + drift.toFixed(0));
  });
  assert(escort.x > -4000, 'the fleet has moved on');
  run(200);
  for (const squadron of squadrons) {
    const lead = squadron.fighters[0];
    assert(
      Math.hypot(lead.x - squadron.order.x, lead.y - squadron.order.y) < 600 || squadron.order.kind !== 'attackmove',
      'squadrons finish at the goal with the fleet'
    );
  }
}

for (const withShip of [false, true]) {
  const { world, empire, rebel, run } = battle(4);
  const squadrons = [0, 1, 2].map(i => world.spawn(T('TIE_Fighter_Squadron'), empire, -4000, -400 + i * 400));
  const movers = [...squadrons];
  if (withShip) movers.push(world.spawn(T('Tartan_Patrol_Cruiser'), empire, -4300, 0));
  const fighters = world.spawn(T('Rebel_X-Wing_Squadron'), rebel, 0, 500);
  const corvette = world.spawn(T('Corellian_Corvette'), rebel, 0, -500);
  corvette.setOrder({ kind: 'idle' });
  run(0.5);
  orderMove(movers, 5000, 0, true);
  let engaged = 0;
  for (let step = 0; step < 60 * 30; step++) {
    run(DT);
    for (const squadron of squadrons) if (!squadron.dead && squadron.target && squadron.mode === 'combat') engaged++;
  }
  const label = withShip ? 'escorting a ship' : 'on their own';
  assert(engaged > 30 * 10, 'squadrons on attack-move ' + label + ' stop to fight what they pass: ' + engaged);
  assert(fighters.dead || corvette.shield < corvette.maxShield, 'and their attacks land ' + label);
}

console.log('space escort: ok');
