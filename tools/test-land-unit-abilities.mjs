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
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { LandWorld, LandSquad, landUnit } = await import('../public/js/game/land.js');
const { landAbilities, useAbility, tickAbilities, abilityBlocked, blastFactor, remoteBombs } = await import(
  '../public/js/game/landabilities.js'
);

const DT = 1 / 30;
function makeWorld() {
  const world = Object.assign(Object.create(LandWorld.prototype), {
    team: [0, 1, 0],
    wild: 3,
    time: 1,
    aiSuspended: false,
    factions: ['Underworld', 'Empire', 'Underworld'],
    units: [],
    squads: [],
    effects: [],
    beams: [],
    pings: [],
    shots: [],
    bolts: [],
    credits: [0, 0, 0],
    mods: [],
    deaths: []
  });
  world.groundZ = () => 0;
  world.nearestOpen = (x, y) => ({ x, y });
  world.cast = () => false;
  world.die = u => world.deaths.push(u);
  world.collectBounty = () => {};
  world.spawn = async (name, x, y, heading = 0, side = 0, saved = null) => {
    const sv = saved && saved[0];
    const u = make(db.type(name), side, sv ? sv.x : x, sv ? sv.y : y, sv ? sv.h : heading);
    return u.squad;
  };
  world.fired = [];
  world.fire = (from, aim, w) => {
    const s = { from, target: aim, w, x: aim.x, y: aim.y, z: aim.z || 0, struck: null, onLand: null };
    world.shots.push(s);
    world.fired.push(s);
  };
  const make = (type, side, x, y = 0, heading = 0) => {
    const squad = new LandSquad(world, type, side);
    const hp = type.num('Tactical_Health', 100) || 100;
    const unit = landUnit({
      type,
      side,
      squad,
      x,
      y,
      z: 0,
      heading,
      health: hp,
      maxHealth: hp,
      shield: 0,
      maxShield: 0,
      armor: type.str('Armor_Type'),
      aimZ: 6,
      hitRadius: 8,
      dead: false,
      inside: null,
      flies: false,
      cloaked: false,
      path: [],
      range: 200,
      minRange: 0,
      lift: 0,
      turn: 3,
      abilityKinds: new Set()
    });
    for (const def of landAbilities(type)) {
      unit.abilityKinds.add(def.kind);
      squad.abilities.push({ def, active: false, left: 0, cooldown: 0 });
    }
    squad.members = [unit];
    world.units.push(unit);
    world.squads.push(squad);
    return unit;
  };
  world.make = make;
  return world;
}
const settle = async (world, secs) => {
  for (let t = 0; t < secs; t += DT) {
    world.time += DT;
    tickAbilities(world, DT);
    await Promise.resolve();
  }
};

{
  assert.equal(blastFactor(0, 120, 3), 1);
  assert.equal(blastFactor(39, 120, 3), 1);
  assert.equal(blastFactor(40, 120, 3), 0.75);
  assert.equal(blastFactor(80, 120, 3), 0.5);
  assert.equal(blastFactor(120, 120, 3), 0.25);
  assert.equal(blastFactor(60, 120, 0), 1);

  const world = makeWorld();
  const sab = world.make(db.type('Underworld_Saboteur'), 0, 0, 0);
  const own = world.make(db.type('T2B_Tank'), 0, 60, 0);
  const rider = world.make(db.type('Stormtrooper'), 0, 60, 0);
  rider.inside = own;
  const friend = world.make(db.type('Stormtrooper'), 0, 70, 10);
  const foe = world.make(db.type('Stormtrooper'), 1, 90, 0);
  const far = world.make(db.type('Stormtrooper'), 1, 400, 0);
  const q = sab.squad;
  assert.equal(abilityBlocked(world, q, 'DETONATE_REMOTE_BOMB'), 'No bombs placed', 'Detonate is offered only once a bomb is out');
  assert.equal(useAbility(world, q, 'DETONATE_REMOTE_BOMB'), 'No bombs placed');
  assert.equal(useAbility(world, q, 'PLACE_REMOTE_BOMB', { x: own.x, y: own.y, unit: own }), null);
  await settle(world, 1);
  const shot = world.fired[0];
  assert(shot && shot.target === own, 'The bomb is thrown at its own target, so it may strike a friendly vehicle');
  shot.struck = own;
  shot.z = 10;
  shot.onLand(shot);
  await settle(world, 0.1);
  assert.equal(remoteBombs(world, 0).length, 1);
  const bomb = remoteBombs(world, 0)[0].u;
  own.x = 100;
  own.y = 20;
  own.heading = Math.PI / 2;
  await settle(world, 0.1);
  assert(Math.hypot(bomb.x - 100, bomb.y - 20) < 1e-6 && bomb.lift === 10, 'A stuck bomb rides its carrier');
  assert.equal(abilityBlocked(world, q, 'DETONATE_REMOTE_BOMB'), null);
  const hp = { own: own.health, rider: rider.health, friend: friend.health, foe: foe.health, far: far.health };
  foe.x = 140;
  foe.y = 20;
  assert.equal(useAbility(world, q, 'DETONATE_REMOTE_BOMB'), null);
  await settle(world, 0.1);
  const F = db.type('Proj_Remote_Bomb').num('Friendly_Damage_Amount', 0);
  assert.equal(F, 200);
  assert(Math.abs(hp.own - own.health - F * db.damageMod('Damage_Normal', own.armor)) < 1e-6, 'Own carrier takes Friendly_Damage_Amount');
  assert(
    Math.abs(hp.rider - rider.health - F * db.damageMod('Damage_Remote_Bomb', rider.armor)) < 1e-6 || rider.dead,
    'Passengers take it as remote bomb damage'
  );
  assert.equal(friend.health, hp.friend, 'The blast spares friendly units nearby');
  assert(foe.dead || foe.health < hp.foe, 'The blast hurts enemies');
  assert.equal(far.health, hp.far);
  assert(bomb.dead && !remoteBombs(world, 0).length);
  assert.equal(foe.lastDamage, 'Damage_Remote_Bomb', 'Blast victims die by the internal damage type, so remote bomb death clones apply');

  const w2 = makeWorld();
  const s2 = w2.make(db.type('Underworld_Saboteur'), 0, 0, 0);
  const enemyTank = w2.make(db.type('T2B_Tank'), 1, 60, 0);
  useAbility(w2, s2.squad, 'PLACE_REMOTE_BOMB', { x: enemyTank.x, y: enemyTank.y, unit: enemyTank });
  await settle(w2, 1);
  w2.fired[0].struck = enemyTank;
  w2.fired[0].onLand(w2.fired[0]);
  await settle(w2, 19);
  assert.equal(useAbility(w2, s2.squad, 'PLACE_REMOTE_BOMB', { x: 0, y: 125 }), null);
  await settle(w2, 1);
  w2.fired[1].onLand(w2.fired[1]);
  await settle(w2, 0.1);
  assert.equal(remoteBombs(w2, 0).length, 2);
  const tankHp = enemyTank.health;
  const ground = remoteBombs(w2, 0).find(b => !b.carrier).u;
  w2.hurt(ground, 5);
  await settle(w2, 0.1);
  assert(ground.dead && remoteBombs(w2, 0).length === 1, 'A shot bomb blows up on its own');
  assert.equal(enemyTank.health, tankHp, 'A shot bomb deals no friendly-damage amount and the enemy tank was outside its blast');
  s2.health = 0;
  s2.dead = true;
  s2.squad.members = [];
  await settle(w2, 0.1);
  assert.equal(remoteBombs(w2, 0).length, 0, 'Bombs are removed once the last bomb placer is gone');
  assert.equal(enemyTank.health, tankHp, 'Removed bombs do not explode');
}

console.log(
  JSON.stringify({ checks: 'remote bomb: stick and ride, owner-only friendly damage, enemy-only tiered blast, shot bomb, orphan cleanup' })
);
