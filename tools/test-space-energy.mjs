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
const near = (a, b, why) => assert(Math.abs(a - b) < 1e-6, why + ': ' + a + ' vs ' + b);
const costOf = n => T(n).num('Projectile_Energy_Per_Shot', 0);

{
  const tie = T('TIE_Fighter');
  assert(tie.behaviors().has('POWERED'), 'space fighters are POWERED');
  assert.equal(tie.num('Energy_Capacity', 0), 500);
  assert.equal(tie.num('Energy_Refresh_Rate', 0), 300);
  assert.equal(costOf(tie.list('Projectile_Types')[0]), 5, 'a TIE bolt costs 5');
  const sat = T('Empire_Defense_Satellite_Laser');
  assert(sat.behaviors().has('POWERED'));
  assert.equal(sat.num('Energy_Capacity', 0), 10000);
  assert.equal(sat.num('Energy_Refresh_Rate', 0), 20);
  assert.equal(costOf(sat.list('Projectile_Types')[0]), 15);
  assert.equal(db.constants.num('EnergyRechargeIntervalInSecs', 0), 5);
}

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  maps
    .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
    .split('\\')
    .pop()
);
const used = ['TIE_Fighter_Squadron', 'Empire_Defense_Satellite_Laser', 'Corellian_Corvette', 'Star_Destroyer'];
{
  const names = new Set(),
    seen = new Set();
  for (const n of used) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

function battle(seed) {
  S.resetEntityIds();
  seedSim(seed);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const [empire, rebel] = ['Empire', 'Rebel'].map((f, i) => w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6 })));
  const shots = new Map();
  w.launch = (proj, shooter) => {
    shots.set(shooter, (shots.get(shooter) || 0) + 1);
    return true;
  };
  const run = secs => {
    for (let n = Math.round(secs / DT); n > 0; n--) w.update(DT);
  };
  return { w, empire, rebel, shots, run };
}

{
  const { w, empire, rebel, shots, run } = battle(7);
  const sat = w.spawn(T('Empire_Defense_Satellite_Laser'), empire, 0, 0);
  const foe = w.spawn(T('Corellian_Corvette'), rebel, 250, 0);
  foe.setOrder({ kind: 'idle' });
  assert(sat.weapon && !sat.isFighter, 'the satellite fires its own Projectile_Types');
  assert.equal(sat.weapon.energy, 15, 'and knows the cost of a shot');
  near(sat.energy.cap, 10000, 'a POWERED satellite has a pool of Energy_Capacity');
  near(sat.energy.value, 10000, 'that starts full');
  run(20);
  const free = shots.get(sat) || 0;
  assert(free > 50, 'the full pool fires freely: ' + free);
  const refills = (sat.energy.value - (10000 - free * 15)) / 20;
  assert(refills === 3 || refills === 4, 'each bolt takes 15 and every 5 s the pool gains 20: ' + refills);

  sat.energy.value = 300;
  sat.energy.tick = 0;
  shots.set(sat, 0);
  run(60);
  const slow = shots.get(sat);
  assert(slow <= (300 + 12 * 20) / 15, 'sixty seconds spend at most what is stored and twelve refills: ' + slow);
  assert(slow >= (300 + 11 * 20) / 15 - 1, 'and fire again as energy comes back: ' + slow);
  assert(sat.energy.value >= 0 && sat.energy.value < 15, 'drained it holds less than one shot');
  shots.set(sat, 0);
  run(30);
  assert(Math.abs(shots.get(sat) - (6 * 20) / 15) <= 1, 'empty, it fires at the refill rate: ' + shots.get(sat));
}

{
  const { w, empire, rebel, shots, run } = battle(11);
  const ship = w.spawn(T('Star_Destroyer'), empire, 0, 0);
  const foe = w.spawn(T('Corellian_Corvette'), rebel, 900, 0);
  foe.setOrder({ kind: 'idle' });
  ship.setOrder({ kind: 'idle' });
  const charged = ship.hardpoints.filter(h => h.isWeapon && h.proj.num('Projectile_Energy_Per_Shot', 0) > 0);
  assert(charged.length, 'Star Destroyer hardpoints shoot bolts that list an energy cost');
  assert(ship.energy && ship.energy.cap > 0, 'and the ship has a pool');
  const pool = (ship.energy.value = ship.energy.cap * 0.5);
  run(20);
  assert((shots.get(ship) || 0) > 10, 'its hardpoints fire: ' + shots.get(ship));
  assert(ship.energy.value >= pool, 'hardpoint guns never take from the pool');
}

const fighterBattle = (seed, setup) => {
  const { w, empire, rebel, shots, run } = battle(seed);
  const foe = w.spawn(T('Corellian_Corvette'), rebel, 600, 0);
  foe.setOrder({ kind: 'idle' });
  const sq = w.spawn(T('TIE_Fighter_Squadron'), empire, 0, 0);
  assert(sq.isSquad && sq.fighters.length, 'a TIE squadron');
  sq.setOrder({ kind: 'attack', target: foe });
  for (const f of sq.fighters) setup(f);
  run(60);
  return sq.fighters.map(f => shots.get(f) || 0);
};

{
  let tie = null;
  const full = fighterBattle(3, f => {
    tie = f;
    assert.equal(f.weapon.energy, 5);
    near(f.energy.cap, 500, 'a TIE pool');
  });
  assert(
    full.every(n => n > 10),
    'TIE fighters fire: ' + full
  );
  assert(tie.energy.value > 400, 'and never come close to an empty pool: ' + tie.energy.value);
  assert.deepEqual(
    fighterBattle(3, () => {}),
    full,
    'the same fight fires the same shots'
  );

  const short = fighterBattle(3, f => {
    f.energy.value = 12;
    f.energy.refill = 10;
  });
  for (const n of short) assert(n <= (12 + 12 * 10) / 5, 'a starved TIE spends no more than it gets: ' + short);
  assert(short.reduce((a, b) => a + b) < full.reduce((a, b) => a + b) / 2, 'and fires far less: ' + short + ' vs ' + full);

  const none = fighterBattle(3, f => {
    f.energy = null;
  });
  assert.deepEqual(
    none.map(() => 0),
    none,
    'without a pool a weapon that costs energy never fires, as the engine refuses it'
  );
}

console.log('space energy: ok');
