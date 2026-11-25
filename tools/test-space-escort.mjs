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
    // fighters keep at least their minimum speed, so beside a slow ship they weave around their place
    assert(drift < 600, 'a squadron keeps its place in the fleet while it moves: drifted ' + drift.toFixed(0));
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

{
  // A fleet on attack-move that stops to fight on the way keeps its squadrons beside it: they used to let go of
  // the stopped ship and fly on to their own spot far ahead of the fleet.
  const { world, empire, rebel, run } = battle(6);
  const ships = [],
    squadrons = [];
  for (let i = 0; i < 4; i++) ships.push(world.spawn(T('Star_Destroyer'), empire, -6000, -1800 + i * 1200));
  for (let i = 0; i < 6; i++) squadrons.push(world.spawn(T('TIE_Fighter_Squadron'), empire, -5600, -2000 + i * 800));
  for (let i = 0; i < 3; i++) world.spawn(T('Corellian_Corvette'), rebel, -1500, -800 + i * 800).setOrder({ kind: 'idle' });
  run(1);
  orderMove([...ships, ...squadrons], 8000, 0, true);
  let worst = 0,
    stopped = false;
  for (let t = 0; t < 120; t++) {
    run(1);
    const alive = ships.filter(e => !e.dead);
    if (!alive.length) break;
    if (alive.some(e => !e.going && e.order.kind === 'attackmove')) stopped = true;
    for (const squadron of squadrons) {
      if (squadron.dead || !squadron.fighters[0]) continue;
      const lead = squadron.fighters[0];
      worst = Math.max(worst, Math.min(...alive.map(e => Math.hypot(e.x - lead.x, e.y - lead.y))));
    }
  }
  assert(stopped, 'the fleet stops to fight on its attack-move');
  assert(worst < 2000, 'squadrons stay with a fleet that stops to fight: one got ' + worst.toFixed(0) + ' from the nearest ship');
}

{
  // Squadrons moved with a fleet guard a ship when they arrive: the one they guarded before the move, else the
  // ship their wing escorted. Idle and guarding fighters keep at least their minimum speed.
  const { world, empire, run } = battle(7);
  const a = world.spawn(T('Star_Destroyer'), empire, -3000, -600),
    b = world.spawn(T('Tartan_Patrol_Cruiser'), empire, -3000, 600);
  const guarding = world.spawn(T('TIE_Fighter_Squadron'), empire, -2800, -700),
    plain = world.spawn(T('TIE_Bomber_Squadron'), empire, -2800, 700);
  run(1);
  guarding.setOrder({ kind: 'guard', target: a });
  run(2);
  orderMove([a, b, guarding, plain], 1500, 0, false);
  run(150);
  assert.equal(guarding.order.kind, 'guard', 'a guarding squadron guards again after the move');
  assert.equal(guarding.order.target, a, 'and guards the ship it guarded before');
  assert.equal(plain.order.kind, 'guard', 'a squadron moved with the fleet guards a ship on arrival');
  assert(plain.order.target === a || plain.order.target === b, 'one of the fleet ships');
  let slowest = Infinity;
  for (let i = 0; i < 20 * 30; i++) {
    run(DT);
    for (const q of [guarding, plain]) for (const f of q.fighters) slowest = Math.min(slowest, f.speed / f.minSpeed);
  }
  assert(slowest > 0.9, 'fighters never hover below their minimum speed: ' + slowest.toFixed(2));
}

for (const attack of [false, true]) {
  // A double-click move or attack-move sends every ship and squadron at full speed: no formation pace, no escort.
  const { world, empire, run } = battle(8);
  const slow = world.spawn(T('Star_Destroyer'), empire, -6000, -500),
    quick = world.spawn(T('Tartan_Patrol_Cruiser'), empire, -6000, 500),
    wing = world.spawn(T('TIE_Fighter_Squadron'), empire, -5800, 0);
  run(1);
  orderMove([slow, quick, wing], 4000, 0, attack, false, false, 0, true);
  for (const e of [slow, quick, wing]) {
    assert.equal(e.order.pace, 1, 'full pace for every unit');
    assert(!e.order.wing, 'no escort for squadrons');
  }
  run(40);
  assert(quick.x - slow.x > 1500, 'the faster ship pulls ahead of the slower one: ' + (quick.x - slow.x).toFixed(0));
  const { world: w2, empire: e2, run: run2 } = battle(8);
  const s2 = w2.spawn(T('Star_Destroyer'), e2, -6000, -500),
    q2 = w2.spawn(T('Tartan_Patrol_Cruiser'), e2, -6000, 500);
  run2(1);
  orderMove([s2, q2], 4000, 0, attack);
  run2(40);
  assert(Math.abs(q2.x - s2.x) < 1000, 'a normal group move keeps them together: ' + (q2.x - s2.x).toFixed(0));
}

console.log('space escort: ok');
