import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadPrioritySets, namedSet } = await import('../public/js/game/priorities.js');
await loadPrioritySets();
const { LandWorld, LandSquad, landUnit } = await import('../public/js/game/land.js');
const { ALL_MODES } = await import('../public/js/game/firemodes.js');

const newWorld = () =>
  Object.assign(Object.create(LandWorld.prototype), { team: [0, 1], wild: 3, time: 1, aiSuspended: false, units: [], squads: [] });
let world = newWorld();
const make = (type, side, x, y = 0, more = {}) => {
  const squad = new LandSquad(world, type, side);
  const unit = landUnit({
    type,
    side,
    squad,
    x,
    y,
    z: 0,
    heading: 0,
    health: 100,
    maxHealth: 100,
    shield: 0,
    maxShield: 0,
    aimZ: 0,
    dead: false,
    inside: false,
    flies: false,
    cloaked: false,
    path: [],
    range: 300,
    minRange: 0,
    antiAir: true,
    scanAt: Infinity,
    speed: 30,
    turn: 3,
    kind: more.structure ? 'STRUCTURE' : 'INFANTRY',
    ...more
  });
  squad.members = [unit];
  world.units.push(unit);
  world.squads.push(squad);
  return unit;
};
const tick = () => (world.time += 1e-3);

const trooper = db.type('Stormtrooper'),
  walker = db.type('AT_ST_Walker'),
  barracks = db.type('R_Ground_Barracks');
assert(trooper && walker && barracks);
assert(barracks.categories().has('STRUCTURE'));

// 1. Range to a structure runs to its edge, as an ordered attack already measured it and as the space battle does.
const open = {
  rank: new Map([
    ['STRUCTURE', 4],
    ['INFANTRY', 1]
  ]),
  never: new Set(),
  noCats: [],
  noProps: [],
  memo: null
};
const gunner = make(walker, 0, 0, 0, { range: 100 });
gunner.prioSet = open;
gunner.weapon = { cooldown: 0 };
const hall = make(barracks, 1, 150, 0, { structure: true, hitRadius: 60 });
tick();
assert.equal(world.nearestFoe(gunner, world.units, 100), hall, 'A structure whose edge is inside the range is picked up without an order');
hall.x = 165;
tick();
assert.equal(world.nearestFoe(gunner, world.units, 100), null, 'Beyond range plus its radius it is not');
const man = make(trooper, 1, 150, 0, { hitRadius: 60 });
tick();
assert.equal(world.nearestFoe(gunner, world.units, 100), null, 'A mobile unit is still measured to its centre');
man.dead = true;
hall.x = 150;

// 2. The exclusions of a priority set hold back opportunity fire only; an ordered attack goes through.
const anti = namedSet('AntiInfantry');
assert(anti && anti.noCats.includes('STRUCTURE'), 'the stock AntiInfantry set leaves structures out');
gunner.prioSet = anti;
tick();
assert.equal(world.nearestFoe(gunner, world.units, 100), null, 'No opportunity fire at an excluded category');
assert.equal(world.nearestFoe(gunner, hall.squad.members, 100), hall, 'An ordered attack on an excluded category still finds its target');

// 3. Hard point guns pick by the priority set of their unit, and take the ordered target first.
const gun = () => ({
  cooldown: 9,
  left: 0,
  timer: 0,
  pulses: 1,
  scanAt: 0,
  range: 300,
  minRange: 0,
  modes: ALL_MODES,
  spare: new Set(),
  cone: Math.PI * 2,
  facing: 0,
  onHead: false,
  turret: null,
  target: null
});
world = newWorld();
const tank = make(walker, 0, 0, 0);
tank.prioSet = anti;
tank.guns = [gun()];
const nearTank = make(walker, 1, 60),
  farMan = make(trooper, 1, 200),
  wall = make(barracks, 1, 30, 0, { structure: true, hitRadius: 20 });
assert(anti.rank.get('INFANTRY') < anti.rank.get('VEHICLE'));
tick();
assert.equal(world.nearestFoe(tank, world.units, 300, tank.guns[0]), farMan, 'A gun ranks targets by the priority set, not by distance alone');
world.fireGuns(tank, 1 / 30);
assert.equal(tank.guns[0].target, farMan, 'A gun leaves an excluded category alone');
tank.squad.foe = nearTank.squad;
world.time = tank.guns[0].scanAt + 1e-3;
world.fireGuns(tank, 1 / 30);
assert.equal(tank.guns[0].target, nearTank, 'A gun turns to the ordered target when it can reach it');
tank.squad.foe = wall.squad;
world.time = tank.guns[0].scanAt + 1e-3;
world.fireGuns(tank, 1 / 30);
assert.equal(tank.guns[0].target, wall, 'An ordered attack on a structure outranks the exclusion');
nearTank.x = 900;
tank.squad.foe = nearTank.squad;
world.time = tank.guns[0].scanAt + 1e-3;
world.fireGuns(tank, 1 / 30);
assert.equal(tank.guns[0].target, wall, 'With the ordered target out of reach the gun keeps what it holds');
wall.dead = true;
world.time = tank.guns[0].scanAt + 1e-3;
world.fireGuns(tank, 1 / 30);
assert.equal(tank.guns[0].target, farMan, 'and otherwise fires on what it can reach');
tank.squad.foe = null;

// 4. A turret head on a unit with no main weapon: standing, it takes a target behind it and turns its hull to it.
world = newWorld();
const scout = make(walker, 0, 0, 0);
scout.prioSet = open;
scout.turret = { yaw: 0, pitch: 0, wantPitch: 0, extent: Math.PI / 4, speed: 3, lift: 0.5, target: null };
scout.guns = [{ ...gun(), cone: Math.PI / 2, onHead: true }];
const behind = make(trooper, 1, -150, 20);
tick();
assert.equal(world.nearestFoe(scout, world.units, 300, scout.guns[0]), behind, 'A standing unit picks up a target outside its head arc');
scout.path = [{ x: 500, y: 0 }];
tick();
assert.equal(world.nearestFoe(scout, world.units, 300, scout.guns[0]), null, 'On the move the head arc still limits it');
scout.path = [];
scout.guns[0].target = behind;
const bearing = () => {
  const a = Math.atan2(behind.y - scout.y, behind.x - scout.x) - scout.heading;
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
};
assert(bearing() > scout.turret.extent);
for (let i = 0; i < 90; i++) world.aimHead(scout, 1 / 30);
assert(bearing() <= scout.turret.extent + 1e-6, 'The hull turns until the target is inside the head arc');
const settled = scout.heading;
world.aimHead(scout, 1 / 30);
assert.equal(scout.heading, settled, 'and stops turning there');

// 5. Attack_Category_Restrictions bar a category outright.
const barred = [...db.types.values()].find(
  t => /\bInfantry\b/i.test(t.str('Attack_Category_Restrictions')) && !/\bStructure\b/i.test(t.str('Attack_Category_Restrictions'))
);
assert(barred, 'a stock type that may not attack infantry (the anti-aircraft turret)');
world = newWorld();
const flak = make(barred, 0, 0, 0);
flak.prioSet = open;
flak.weapon = { cooldown: 0 };
const walkerBy = make(trooper, 1, 80);
tick();
assert.equal(world.nearestFoe(flak, world.units, 300), null, 'No opportunity fire at a restricted category');
assert.equal(world.nearestFoe(flak, walkerBy.squad.members, 300), null, 'nor an ordered attack');
const plain = make(trooper, 0, 0, 10);
plain.prioSet = open;
plain.weapon = { cooldown: 0 };
tick();
assert.equal(world.nearestFoe(plain, world.units, 300), walkerBy);

// 6. Under fog a structure a team has sighted stays a known target; a mobile unit is lost when the fog regrows.
world = newWorld();
world.fowOn = true;
world.time = 100;
const eye = make(trooper, 0, 0, 0),
  depot = make(barracks, 1, 200, 0, { structure: true, hitRadius: 40 }),
  runner = make(trooper, 1, 120, 0);
assert(/HIDE_WHEN_FOGGED/i.test(barracks.str('LandBehavior') + ' ' + barracks.str('Behavior')));
assert.equal(world.sightOf(0, depot), false, 'Never sighted: not a target');
assert.equal(world.targetEnemy(eye, depot), false);
depot.vis = new Map([[0, { at: 10, cell: 0 }]]);
runner.vis = new Map([[0, { at: 10, cell: 0 }]]);
assert.equal(world.sightOf(0, depot), true, 'Sighted once: stays a target');
assert.equal(world.targetEnemy(eye, depot), true);
assert.equal(world.sightOf(0, runner), false, 'A mobile unit seen long ago is not');

// 7. Closing on a structure stops at its edge.
world = newWorld();
const rifle = make(trooper, 0, 0, 0, { range: 100 }),
  keep = make(barracks, 1, 400, 0, { structure: true, hitRadius: 60 });
let goal = null;
world.teamOf = () => null;
world.order = (q, x, y) => (goal = { x, y });
rifle.squad.foe = keep.squad;
world.advance(rifle.squad);
assert(goal && Math.abs(400 - goal.x - (100 * 0.8 + 60)) < 1e-6 && Math.abs(goal.y) < 1e-6, 'The advance aims for 0.8 of the range from the edge');
goal = null;
rifle.x = 400 - 135;
world.advance(rifle.squad);
assert.equal(goal, null, 'Already inside that: no move');

// 8. A structure with no Projectile_Types is armed from its hard points.
const hpType = [...db.types.values()].find(t =>
  t.list('HardPoints').some(n => db.hardpoint(n) && db.type(db.hardpoint(n).str('Fire_Projectile_Type')))
);
assert(hpType, 'a stock type with weapon hard points');
const first = hpType
  .list('HardPoints')
  .map(n => db.hardpoint(n))
  .find(h => h && db.type(h.str('Fire_Projectile_Type')));
const post = { type: hpType, weapons: [], weapon: null, range: 123 };
world.armHardPoints(post, hpType, { bone: () => null, meshByName: new Map() });
assert(post.weapon, 'the first weapon hard point becomes the weapon');
assert.equal(post.weapon.proj, db.type(first.str('Fire_Projectile_Type')));
assert.equal(post.range, first.num('Fire_Range_Distance', 123));
assert.equal(post.weapon.pulses, Math.max(1, first.num('Fire_Pulse_Count', 1)));

// 9. Fire modes: a hard point that does not fire in rocket mode holds while that mode is on, and the other way round.
world = newWorld();
const mode = make(walker, 0, 0, 0);
mode.prioSet = open;
const NORMAL_ONLY = 27,
  ROCKET_ONLY = 30;
const rocket = { def: { kind: 'ROCKET_ATTACK' }, active: false };
mode.squad.abilities = [rocket];
make(trooper, 1, 100, 0);
let bursts = [];
world.burst = (u, t, w) => bursts.push(w);
const normalGun = { ...gun(), modes: NORMAL_ONLY },
  rocketGun = { ...gun(), modes: ROCKET_ONLY };
mode.guns = [normalGun, rocketGun];
world.fireGuns(mode, 1 / 30);
assert.deepEqual(bursts, [normalGun], 'Normal mode: only the hard point with Fire_When_In_Normal_Attack_Mode fires');
rocket.active = true;
bursts = [];
world.fireGuns(mode, 1 / 30);
assert.deepEqual(bursts, [rocketGun], 'Rocket mode: only the hard point with Fire_When_In_Rocket_Attack_Mode fires');

console.log(
  JSON.stringify({
    checks:
      'structure edge range, exclusions only for opportunity fire, gun priority set and ordered target, idle head turn, Attack_Category_Restrictions, known structures under fog, advance to the edge, hard point armed structures, fire modes'
  })
);
