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
const { db, loadGameData, ObjType } = await import('../public/js/gamedata.js');
const { parseXML } = await import('../public/js/xml.js');
await loadGameData();
const { LandWorld, LandSquad, landUnit } = await import('../public/js/game/land.js');
const { specialAttack } = await import('../public/js/game/landbase.js');
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
  for (let n = Math.round(secs / DT); n > 0; n--) {
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

{
  const world = makeWorld();
  const chewie = world.make(db.type('Chewbacca'), 0, 0, 0);
  const walker = world.make(db.type('AT_ST_Walker'), 1, 30, 5, 1.2);
  walker.health = walker.maxHealth * 0.6;
  const swaps = [];
  world.onReselect = (from, to) => swaps.push([from, to]);
  const q = chewie.squad,
    hp = chewie.health;
  assert.equal(useAbility(world, q, 'CAPTURE_VEHICLE', { unit: walker }), null);
  assert(walker.dead && walker.gone && !walker.squad.members.length, 'The captured vehicle is replaced, not killed');
  assert.equal(world.deaths.length, 0);
  await settle(world, 0.1);
  const clone = world.units.find(u => !u.dead && u.type.name === 'AT_ST_Walker_Captured');
  assert(clone, 'The inside clone takes its place');
  assert.deepEqual([clone.x, clone.y, clone.heading, clone.side], [30, 5, 1.2, 0]);
  assert(Math.abs(clone.health / clone.maxHealth - 0.6) < 1e-9, 'The clone keeps the health share');
  assert.equal(chewie.inside, clone);
  assert.equal(clone.thief, chewie);
  assert(q.abilityState('CAPTURE_VEHICLE').cooldown > 1e6, 'Capture recharge waits for the thief to leave');
  assert(clone.squad.abilityState('EJECT_VEHICLE_THIEF'));
  clone.x = 80;
  clone.y = 40;
  clone.heading = -0.4;
  clone.squad.selected = true;
  assert.equal(useAbility(world, clone.squad, 'EJECT_VEHICLE_THIEF'), null);
  assert(
    clone.dead && world.deaths.includes(clone) && clone.lastDamage === 'Damage_Vehicle_Thief',
    'Eject destroys the vehicle by thief damage'
  );
  await settle(world, 0.1);
  assert.equal(chewie.inside, null);
  assert.deepEqual([chewie.heading, chewie.health], [-0.4, hp], 'The thief steps out unharmed, facing as the vehicle did');
  const out = Math.hypot(chewie.x - 80, chewie.y - 40);
  assert(out >= (clone.hitRadius || 10) && out < (clone.hitRadius || 10) + 60, 'The thief is set down on open ground beside the wreck');
  const cap = q.abilityState('CAPTURE_VEHICLE');
  assert(cap.cooldown <= cap.def.recharge && cap.cooldown > cap.def.recharge - 0.2, 'Capture recharge starts on exit');
  assert.deepEqual(swaps, [[clone.squad, q]], 'A selected vehicle hands the selection to the thief');

  const tank = world.make(db.type('AT_ST_Walker'), 1, 90, 40);
  q.abilityState('CAPTURE_VEHICLE').cooldown = 0;
  assert.equal(useAbility(world, q, 'CAPTURE_VEHICLE', { unit: tank }), null);
  await settle(world, 0.1);
  const second = world.units.find(u => !u.dead && u.type.name === 'AT_ST_Walker_Captured');
  second.x = 120;
  world.hurt(second, 1e9);
  await settle(world, 0.1);
  assert(!chewie.dead && chewie.inside === null && chewie.x === 120, 'Any vehicle death releases the thief at its spot');
}

const castable = (world, length = 2) => {
  world.cast = (u, K, secs = 0, loop = false, rate = 1) => {
    const anim = { fps: 30, frames: 30 * length, duration: length };
    u.anim = { anim, time: 0, kind: K };
    u.cast = world.time + (secs || anim.duration / rate);
    (world.casts ||= []).push([u, K, rate]);
    return true;
  };
  return world;
};
const synthetic = (base, xml) => {
  const T = new ObjType(db.type(base).tag, 'Test_' + base);
  T.parent = db.type(base);
  T.subs.set('abilities', [parseXML(`<Abilities>${xml}</Abilities>`).children[0]]);
  return T;
};

{
  const world = castable(makeWorld());
  const T = synthetic(
    'Kyle_Katarn',
    `<Demolition_Ability Name="Test_Demolition">
      <Activation_Min_Range>-5</Activation_Min_Range>
      <Activation_Max_Range>50</Activation_Max_Range>
      <Activation_Chance>1.0</Activation_Chance>
      <Damage_Amount>100</Damage_Amount>
      <Damage_Percentage>0.5</Damage_Percentage>
      <Bomb_Damage_Type>Damage_Bomb</Bomb_Damage_Type>
      <Bomb_Position_Offset>0, -10, 0</Bomb_Position_Offset>
      <Bomb_Spawn_Frame>15</Bomb_Spawn_Frame>
      <Bomb_Timer_In_Secs>2</Bomb_Timer_In_Secs>
      <Applicable_Unit_Categories>Vehicle</Applicable_Unit_Categories>
    </Demolition_Ability>`
  );
  const kyle = world.make(T, 0, 0, 0, Math.PI);
  const walker = world.make(db.type('AT_ST_Walker'), 1, 30, 0);
  const hp = walker.health;
  assert.equal(specialAttack(world, kyle, walker, DT), true, 'Demolition starts on a valid target in range');
  assert(kyle.special.lock && world.fight(kyle, DT) === true, 'The demolisher stops moving and firing');
  await settle(world, 0.5);
  assert(!world.casts?.length, 'No animation while still turning');
  await settle(world, 0.6);
  assert(Math.abs(Math.atan2(Math.sin(kyle.heading), Math.cos(kyle.heading))) < 0.1 + 1e-9, 'It turns to face the target first');
  assert.equal(world.casts.at(-1)[1], 'DEMOLITION');
  assert(!world.units.some(u => u.type.name === 'Demolition_Bomb'));
  await settle(world, 0.6);
  const bomb = world.units.find(u => u.type.name === 'Demolition_Bomb');
  assert(bomb && bomb.side === 0, 'The bomb appears once the animation reaches Bomb_Spawn_Frame');
  assert(Math.hypot(bomb.x - 10, bomb.y) < 0.5, 'At the unit transform times Bomb_Position_Offset');
  assert.equal(kyle.demoBomb, bomb);
  kyle.specialAt = 0;
  await settle(world, 1.5);
  assert.equal(kyle.special, null, 'The unit is released when the animation ends');
  assert.equal(specialAttack(world, kyle, walker, DT), false, 'No second charge while its bomb is live');
  assert.equal(walker.health, hp);
  await settle(world, 1);
  assert(bomb.dead && world.deaths.includes(bomb), 'The bomb dies at the end of its timer');
  const want = (walker.maxHealth * 0.5 + 100) * db.damageMod('Damage_Bomb', walker.armor);
  assert(
    walker.dead || Math.abs(hp - walker.health - want) < 1e-6,
    'The target takes max health share plus amount as the bomb damage type'
  );
  assert(walker.dead || walker.lastDamage === 'Damage_Bomb');

  const none = synthetic(
    'Kyle_Katarn',
    `<Demolition_Ability Name="Test_Demolition_None"><Activation_Max_Range>50</Activation_Max_Range></Demolition_Ability>`
  );
  const idle = world.make(none, 0, 0, 40);
  const tank = world.make(db.type('AT_ST_Walker'), 1, 20, 40);
  assert.equal(specialAttack(world, idle, tank, DT), false, 'Without categories or types the ability never activates');
  const plain = synthetic(
    'Stormtrooper',
    `<Demolition_Ability Name="Test_Demolition_Plain"><Applicable_Unit_Categories>Vehicle</Applicable_Unit_Categories></Demolition_Ability>`
  );
  const trooper = world.make(plain, 0, 0, 80);
  const tank2 = world.make(db.type('AT_ST_Walker'), 1, 20, 80);
  assert.equal(specialAttack(world, trooper, tank2, DT), false, 'Units without the DEMOLITION behaviour never activate it');
}

{
  const world = castable(makeWorld(), 4);
  const squadOf = (n, x0) => {
    const first = world.make(db.type('Stormtrooper'), 0, x0, 0);
    for (let i = 1; i < n; i++) {
      const m = world.make(db.type('Stormtrooper'), 0, x0 + i, 0);
      world.squads.splice(world.squads.indexOf(m.squad), 1);
      m.squad = first.squad;
      first.squad.members.push(m);
    }
    return first.squad;
  };
  const S = db.type('Rancor').sub('Abilities')[0].all('Eat_Attack_Ability')[0];
  assert.equal(S.num('Activation_Min_Range', 0), 45);
  const xmlOf = n => `<${n.tag} Name="Only_${n.attrs.Name}">${n.children.map(c => `<${c.tag}>${c.text}</${c.tag}>`).join('')}</${n.tag}>`;
  const rancor = world.make(synthetic('Rancor', xmlOf(S)), 1, 0, 0);
  assert.equal(rancor.type.sub('Abilities')[0].children.length, 1);
  const group = squadOf(3, 0);
  const [near, mid, last] = group.members;
  near.x = 30;
  mid.x = 47;
  last.x = 48;
  group.selected = true;
  const swaps = [];
  world.onReselect = (from, to) => swaps.push([from, to]);
  rancor.health = rancor.maxHealth - 500;
  const before = rancor.health;
  rancor.once = 'attack';
  rancor.onceEnd = world.time + 1;
  specialAttack(world, rancor, near, DT);
  assert(
    group.members.length === 3 && !(world.casts || []).some(c => c[1] === 'EAT_ATTACK'),
    'No eating in the middle of an attack animation'
  );
  rancor.special = null;
  rancor.once = null;
  rancor.specialAt = 0;
  assert.equal(specialAttack(world, rancor, near, DT), true);
  assert(
    !group.members.includes(mid) && mid.squad !== group && group.members.length === 2,
    'The first reachable member in squad order is taken out of its squad'
  );
  assert.deepEqual(world.casts.at(-1).slice(1), ['EAT_ATTACK', 1]);
  assert(world.fight(rancor, DT), 'The rancor holds still while eating');
  await settle(world, 13 / 30);
  assert(!(mid.stunUntil > world.time), 'Not grabbed before Attachment_Frame');
  await settle(world, 2 / 30);
  assert(
    mid.stunUntil > world.time + 100 && world.casts.at(-1)[0] === mid && world.casts.at(-1)[1] === 'EATEN_DIE',
    'Grabbed at Attachment_Frame'
  );
  assert(!mid.squad.selectable);
  await settle(world, 94 / 30);
  assert(!mid.dead, 'Still held before Target_Destruction_Frame');
  await settle(world, 3 / 30);
  assert(mid.dead && mid.lastDamage === 'Damage_Eat', 'Killed with the ability damage type at Target_Destruction_Frame');
  assert.equal(rancor.health, before + 120, 'Health_Per_Victim heals the eater');
  assert.equal(rancor.special, null);

  rancor.specialAt = 0;
  assert.equal(specialAttack(world, rancor, near, DT), true);
  const taken = world.casts.length;
  await settle(world, 20 / 30);
  assert(last.stunUntil > world.time + 100);
  rancor.anim = { anim: { fps: 30 }, time: 0 };
  await settle(world, 2 / 30);
  assert(last.dead && last.lastDamage === 'Damage_Normal', 'An interrupted eat still kills the held victim');
  assert(taken > 0 && rancor.special === null);

  const lone = squadOf(2, 46);
  rancor.specialAt = 0;
  assert.equal(specialAttack(world, rancor, lone.members[0], DT), true);
  const grabbedFirst = lone.members.length === 1;
  rancor.anim = { anim: { fps: 30 }, time: 0 };
  await settle(world, 2 / 30);
  assert(
    grabbedFirst && lone.members.length === 2 && lone.members.every(m => !m.dead && m.squad === lone),
    'Interrupted before the grab, the soldier returns to its squad'
  );

  const solo = world.make(db.type('Stormtrooper'), 0, 0, -47);
  solo.squad.selected = true;
  rancor.specialAt = 0;
  assert.equal(specialAttack(world, rancor, solo, DT), true);
  await settle(world, 15 / 30);
  assert.deepEqual(swaps.at(-1), [solo.squad, null], 'A grabbed victim is deselected');

  const never = synthetic(
    'Rancor',
    `<Eat_Attack_Ability Name="Test_Eat"><Activation_Chance>0</Activation_Chance><Activation_Min_Range>0</Activation_Min_Range><Activation_Max_Range>60</Activation_Max_Range><Applicable_Unit_Categories>Infantry</Applicable_Unit_Categories></Eat_Attack_Ability>`
  );
  const picky = world.make(never, 1, 0, 300);
  const snack = world.make(db.type('Stormtrooper'), 0, 20, 300);
  assert.equal(specialAttack(world, picky, snack, DT), false, 'Activation_Chance 0 never eats');
}

console.log(
  JSON.stringify({
    checks:
      'remote bomb: stick and ride, owner-only friendly damage, enemy-only tiered blast, shot bomb, orphan cleanup; vehicle thief: clone swap with health share, eject by thief damage, release beside the wreck, recharge on exit, reselection; demolition: behaviour and category gates, turn, spawn frame, offset, timer, damage; eat attack: squad order pick, attack-animation gate, attachment and destruction frames, fixed kill with damage type, heal, interrupted eat, chance 0'
  })
);
