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
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { CombatMods, MOD } = await import('../public/js/game/combatmods.js');
const { LandWorld, LandSquad, landUnit } = await import('../public/js/game/land.js');
const { landAbilities, refreshMods } = await import('../public/js/game/landabilities.js');

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const near = (a, b, why) => assert(Math.abs(a - b) < 1e-6, why + ': ' + a + ' vs ' + b);

function makeWorld() {
  const factions = ['Empire', 'Rebel', 'Empire'];
  const world = Object.assign(Object.create(LandWorld.prototype), {
    team: [0, 1, 0],
    wild: 3,
    time: 1,
    factions,
    units: [],
    squads: [],
    sideMods: null,
    bonusHolders: [],
    bonusSeen: 0,
    shots: 0
  });
  world.sideMods = factions.map(() => new CombatMods());
  world.fire = () => world.shots++;
  world.make = (name, side) => {
    const type = T(name),
      squad = new LandSquad(world, type, side),
      hp = type.num('Tactical_Health', 100) || 100;
    const u = landUnit({
      type,
      side,
      squad,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      health: hp,
      maxHealth: hp,
      shield: 0,
      maxShield: 0,
      dead: false
    });
    world.arm(u, type, side, () => 0);
    world.energyOf(u);
    squad.members.push(u);
    world.units.push(u);
    world.squads.push(squad);
    world.syncCombatBonuses();
    return u;
  };
  return world;
}

function shoot(world, u, foe, secs) {
  const before = world.shots;
  let low = Infinity;
  for (let n = Math.round(secs / DT); n > 0; n--) {
    world.time += DT;
    world.serviceEnergy(u, DT);
    u.weapon.cooldown -= DT;
    world.burst(u, foe, u.weapon, DT);
    low = Math.min(low, u.energy.value);
  }
  assert(low >= 0, 'energy never goes below zero');
  return world.shots - before;
}

{
  const w = T('E_Ground_Turbolaser_Tower');
  const proj = T(w.list('Projectile_Types')[0]);
  assert.equal(proj.num('Projectile_Energy_Per_Shot', 0), 20, 'the turbolaser bolt costs 20 energy a shot');
  assert.equal(w.num('Energy_Capacity', 0), 500);
  assert.equal(w.num('Energy_Refresh_Rate', 0), 40);
  assert.equal(db.constants.num('EnergyRechargeIntervalInSecs', 0), 5);
  const gen = T('Power_Generator_E')
    .sub('Abilities')
    .flatMap(x => x.all('Combat_Bonus_Ability'))
    .find(a => a.num('Energy_Pool_Bonus_Percentage', 0) > 0);
  assert(gen, 'the power generator carries an energy pool bonus');
  near(gen.num('Energy_Pool_Bonus_Percentage', 0), 1, 'of 100%');
}

{
  const world = makeWorld();
  const tower = world.make('E_Ground_Turbolaser_Tower', 0),
    foe = world.make('Rebel_Trooper', 1);
  assert.equal(tower.weapon.energy, 20, 'the weapon knows its cost per shot');
  near(tower.energy.cap, 500, 'a POWERED tower has a pool of Energy_Capacity');
  near(tower.energy.value, 500, 'that starts full');
  near(tower.energy.refill, 40, 'and refills Energy_Refresh_Rate');

  const free = makeWorld(),
    freeTower = free.make('E_Ground_Turbolaser_Tower', 0),
    freeFoe = free.make('Rebel_Trooper', 1);
  freeTower.weapon.energy = 0;
  freeTower.energy.value = 0;
  const unbound = shoot(free, freeTower, freeFoe, 60);

  const shots = shoot(world, tower, foe, 60);
  assert(shots <= (500 + 40 * 12) / 20, 'sixty seconds of fire spend at most the pool and twelve refills: ' + shots);
  assert(shots >= (500 + 40 * 11) / 20, 'and the tower keeps firing as energy comes back: ' + shots);
  assert(shots < unbound * 0.75, 'an empty pool slows the tower below its unbounded rate: ' + shots + ' vs ' + unbound);
  const later = shoot(world, tower, foe, 30);
  assert(later >= 11 && later <= 13, 'drained, the tower fires as fast as the refill allows (40 per 5 s, 20 a shot): ' + later);

  const again = makeWorld(),
    t2 = again.make('E_Ground_Turbolaser_Tower', 0),
    f2 = again.make('Rebel_Trooper', 1);
  assert.equal(shoot(again, t2, f2, 60), shots, 'the same fight fires the same shots');
}

{
  const world = makeWorld();
  const tower = world.make('E_Ground_Turbolaser_Tower', 0),
    rebelTower = world.make('R_Ground_Turbolaser_Tower', 1),
    av = world.make('Empire_Anti_Vehicle_Turret', 2),
    foe = world.make('Rebel_Trooper', 1);
  tower.energy.value = 300;
  const gen = world.make('Power_Generator_E', 0);
  near(tower.energy.cap, 1000, 'a powered generator doubles the tower pool');
  near(tower.energy.value, 800, 'and the gain is added to what is stored');
  near(av.energy.cap, 999 * 2, 'it reaches the allied anti vehicle turret too');
  near(rebelTower.energy.cap, 500, 'not the enemy tower');
  assert.equal(gen.energy, null, 'the generator itself has no pool');
  tower.energy.value = 1000;
  const shots = shoot(world, tower, foe, 60);
  assert(shots >= (1000 + 40 * 11) / 20 && shots <= (1000 + 40 * 12) / 20, 'twice the pool: twice the burst before it slows: ' + shots);

  tower.energy.value = 900;
  gen.dead = true;
  world.syncCombatBonuses();
  near(tower.energy.cap, 500, 'the generator destroyed: the pool shrinks back');
  near(tower.energy.value, 500, 'and what is stored is clamped to it');

  const late = world.make('Power_Generator_E', 0);
  near(tower.energy.value, 1000, 'a new generator adds its gain again');
  late.dead = true;
  world.syncCombatBonuses();
}

{
  const world = makeWorld();
  const tower = world.make('E_Ground_Turbolaser_Tower', 0),
    foe = world.make('Rebel_Trooper', 1);
  tower.unpowered = true;
  tower.energy.tick = 0;
  world.serviceEnergy(tower, 4.9);
  near(tower.energy.value, 500, 'nothing happens between services');
  world.serviceEnergy(tower, 0.2);
  near(tower.energy.value, 0, 'a tower without base power is drained at its next service');
  tower.unpowered = false;
  world.serviceEnergy(tower, 5);
  near(tower.energy.value, 40, 'power back: it refills from empty');
  assert.equal(world.canShoot(tower, tower.weapon), true, 'and can fire once it holds a shot');
  tower.energy.value = 19.9;
  assert.equal(world.canShoot(tower, tower.weapon), false, 'less than one shot: it holds fire');
  tower.energy.value = 20;
  assert.equal(world.canShoot(tower, tower.weapon), true, 'exactly one shot is enough');
  void foe;
}

{
  const world = makeWorld();
  const node = world.make('Empire_Offensive_Sensor_Node', 0),
    foe = world.make('Rebel_Trooper', 1);
  assert.equal(node.energy, null, 'a type without POWERED has no pool');
  assert(node.weapon.energy > 0, 'yet its bolt asks for energy');
  assert.equal(world.canShoot(node, node.weapon), false, 'so, as in the engine, it cannot fire it');
  for (let n = 0; n < 300; n++) world.burst(node, foe, node.weapon, DT);
  assert.equal(world.shots, 0);

  const trooper = world.make('Stormtrooper', 0);
  assert.equal(trooper.weapon.energy, 0, 'blasters with no cost per shot');
  assert.equal(world.canShoot(trooper, trooper.weapon), true, 'fire without a pool');
}

{
  const world = makeWorld();
  const tower = world.make('E_Ground_Turbolaser_Tower', 0),
    q = tower.squad;
  const surge = landAbilities(T('M1_Repulsor_Tank')).find(d => d.mods.has('ENERGY_REGEN_MULTIPLIER'));
  assert(surge, 'the M1 repulsor tank ability carries ENERGY_REGEN_MULTIPLIER');
  near(surge.mods.get('ENERGY_REGEN_MULTIPLIER'), 0.3, 'of 0.3');
  const quick = { kind: 'TEST_QUICK', mods: new Map([['ENERGY_REGEN_INTERVAL_MULTIPLIER', 0.5], ['ENERGY_REGEN_MULTIPLIER', 2]]) };
  tower.abilityKinds = new Set([surge.kind, quick.kind]);
  q.abilities = [
    { def: surge, active: false },
    { def: quick, active: false }
  ];
  const refill = (secs, steps = 1) => {
    for (let n = 0; n < steps; n++) world.serviceEnergy(tower, secs / steps);
  };
  tower.energy.value = 0;
  tower.energy.tick = 0;
  q.abilities[0].active = true;
  refreshMods(world, q);
  near(tower.mod.energy, 0.3, 'an active ability sets the regen multiplier');
  refill(5);
  near(tower.energy.value, 12, 'a service refills Energy_Refresh_Rate times ENERGY_REGEN_MULTIPLIER');
  near(tower.energy.every, 5, 'with no interval multiplier the next service is EnergyRechargeIntervalInSecs away');
  q.abilities[1].active = true;
  refreshMods(world, q);
  near(tower.mod.energy, 0.6, 'two active abilities multiply');
  near(tower.mod.energyInterval, 0.5, 'and the interval multiplier is taken too');
  refill(4.9, 49);
  near(tower.energy.value, 12, 'the service already scheduled keeps its time');
  refill(0.11);
  near(tower.energy.value, 36, 'and refills at the new rate');
  near(tower.energy.every, 2.5, 'the next one comes after the interval times ENERGY_REGEN_INTERVAL_MULTIPLIER');
  refill(2.5);
  near(tower.energy.value, 60, 'so twice as often');
  q.abilities[0].active = q.abilities[1].active = false;
  refreshMods(world, q);
  refill(2.5);
  near(tower.energy.value, 100, 'expired abilities give the plain refill again');
  near(tower.energy.every, 5, 'and the plain interval after it');
  q.abilities = [{ def: { kind: 'TEST_DRAIN', mods: new Map([['ENERGY_REGEN_MULTIPLIER', -10]]) }, active: true }];
  tower.abilityKinds = new Set(['TEST_DRAIN']);
  refreshMods(world, q);
  refill(5);
  near(tower.energy.value, 0, 'a negative multiplier drains the pool, never below zero');
}

{
  const THREE = await import('../public/vendor/three/build/three.module.js');
  const S = await import('../public/js/game/sim.js');
  const { useAbility } = await import('../public/js/game/abilities.js');
  const { loadMap } = await import('../public/js/ted.js');
  const { preloadModels } = await import('../public/js/model.js');
  const { seedSim } = await import('../public/js/game/simrandom.js');
  const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
  const map = await loadMap(
    maps
      .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
      .split('\\')
      .pop()
  );
  const names = new Set();
  S.modelsForType(T('Nebulon_B_Frigate'), null, names, new Set());
  await preloadModels([...names].filter(Boolean));
  const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });
  S.resetEntityIds();
  seedSim(5);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const rebel = w.addPlayer(new S.Player(0, w.addTeam(new S.Team(0, 'Rebel')), { credits: 1e6 }));
  const neb = w.spawn(T('Nebulon_B_Frigate'), rebel, 0, 0);
  const defend = neb.abilities.find(s => s.def.mods.has('ENERGY_REGEN_MULTIPLIER'));
  assert(defend, 'the Nebulon B frigate has an ability with ENERGY_REGEN_MULTIPLIER');
  const regen = defend.def.mods.get('ENERGY_REGEN_MULTIPLIER'),
    every = defend.def.mods.get('ENERGY_REGEN_INTERVAL_MULTIPLIER');
  near(regen, 3, 'of 3');
  near(every, 0.1, 'and ENERGY_REGEN_INTERVAL_MULTIPLIER of 0.1');
  const en = neb.energy,
    rate = T('Nebulon_B_Frigate').num('Energy_Refresh_Rate', 0);
  assert(en && rate > 0, 'it has an energy pool that refills');
  const step = secs => {
    for (let n = Math.round(secs / DT); n > 0; n--) {
      neb.shield = neb.maxShield;
      w.updateUnit(neb, DT);
    }
  };
  en.value = 0;
  en.tick = 0;
  step(5.05);
  near(en.value, rate, 'space: a plain service refills Energy_Refresh_Rate');
  assert.equal(useAbility(w, neb, defend.def.kind, true), null, 'the frigate raises ' + defend.def.kind);
  assert(neb.mods.energyRegen === regen && neb.mods.energyInterval === every, 'its multipliers are on the ship');
  en.value = 0;
  step(4.9);
  near(en.value, 0, 'space: the service already scheduled keeps its time');
  step(0.2);
  near(en.value, rate * regen, 'space: the refill is Energy_Refresh_Rate times ENERGY_REGEN_MULTIPLIER');
  near(en.every, 5 * every, 'space: the next service comes after the interval times ENERGY_REGEN_INTERVAL_MULTIPLIER');
  step(5 * every);
  near(en.value, Math.min(en.cap, 2 * rate * regen), 'space: and refills again that much sooner');
}

console.log('land energy: ok');
