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
const world = Object.assign(Object.create(LandWorld.prototype), { team: [0, 1], wild: 3, time: 1, aiSuspended: false, units: [] });
const make = (type, side, x, y = 0, hp = 100) => {
  const squad = new LandSquad(world, type, side);
  const unit = landUnit({
    type,
    side,
    squad,
    x,
    y,
    z: 0,
    heading: 0,
    health: hp,
    maxHealth: 100,
    shield: 0,
    maxShield: 0,
    dead: false,
    inside: false,
    flies: false,
    cloaked: false,
    path: [],
    range: 300,
    minRange: 0,
    antiAir: true,
    scanAt: Infinity
  });
  squad.members = [unit];
  world.units.push(unit);
  return unit;
};
const pick = () => {
  world.time += 1e-3;
  return world.nearestFoe(shooter, world.units, 300);
};
const anti = namedSet('AntiInfantry');
assert(anti, 'AntiInfantry priority set loaded');
const trooper = db.type('Stormtrooper'),
  tank =
    db.type('AT_ST_Walker') ||
    db.type('Imperial_Light_Scout_Walker') ||
    [...db.types.values()].find(t => t.categories().has('VEHICLE') && t.str('LandBehavior'));
assert(trooper && tank);
const shooter = make(trooper, 0, 0);
shooter.prioSet = anti;
shooter.weapon = { cooldown: 0 };
const near = make(tank, 1, 50),
  far = make(trooper, 1, 200);
assert(anti.rank.get('INFANTRY') < anti.rank.get('VEHICLE'));
assert.equal(pick(), far, 'A lower priority weight beats a nearer target');
near.health = 30;
assert.equal(pick(), near, 'A target at or below Health_Low_Percent_Threshold beats a better priority');
near.health = 34;
assert.equal(pick(), far, 'Above the threshold the priority decides again');
near.dead = far.dead = true;
const ahead = make(trooper, 1, 150),
  behind = make(trooper, 1, -100);
shooter.cone = 0.5;
assert.equal(pick(), ahead, 'The one its weapon can fire at now beats the nearer one');
shooter.cone = Math.PI * 2;
assert.equal(pick(), behind, 'Else the nearer');
behind.dead = true;

const plain = [...db.types.values()].find(
  t => t.str('LandBehavior') && !/\bDAMAGE_TRACKING\b/i.test(t.str('LandBehavior') + ' ' + t.str('Behavior'))
);
const T = make(plain, 1, 120);
world.trackDamage(T, 10, shooter);
assert.equal(T.dmgTrack, undefined, 'A type without DAMAGE_TRACKING keeps no record');
const tracked = [...db.types.values()].find(
  t => /\bDAMAGE_TRACKING\b/i.test(t.str('LandBehavior')) && t.categories().has('INFANTRY') && t.num('Tactical_Health', 0) > 0
);
assert(tracked, 'a land infantry type with DAMAGE_TRACKING');
const victim = make(tracked, 1, 100, 0, 100);
world.trackDamage(victim, 20, shooter);
const D = victim.dmgTrack;
assert(D && D.acc === 20 && D.next >= world.time && D.next < world.time + 1, 'The first service a random part of a second on');
if (D.next > world.time) assert.equal(world.timeToKill(victim), 1e18, 'No rate before the first service');
world.time = D.next;
assert.equal(world.damageTrack(victim).rate, 20, 'The window rate is its damage per second');
assert.equal(world.timeToKill(victim), 5);
assert(world.attackedBy(victim, shooter.squad));
world.time += 1;
assert.equal(world.damageTrack(victim).rate, 0, 'An empty window gives no rate');
assert.equal(victim.dmgTrack.by.get(shooter.squad), 10);
world.time += 1;
assert(world.attackedBy(victim, shooter.squad));
world.time += 1;
assert.equal(
  world.attackedBy(victim, shooter.squad),
  false,
  'The attacker record decays by (max health + shield) x AI_SpaceThreatDecayStep a second'
);

ahead.dead = true;
const cur = make(trooper, 1, 100),
  better = make(trooper, 1, 60);
const vehicleOnly = { rank: new Map([['INFANTRY', 2]]), never: new Set(), noCats: [], noProps: [], memo: null };
shooter.prioSet = vehicleOnly;
world.time = 10;
shooter.rethinkAt = undefined;
assert.equal(world.rethink(shooter, cur, 300), cur, 'The first look only starts the cadence');
const wait = shooter.rethinkAt - world.time;
assert(wait >= 30 / 30 - 1e-9 && wait <= 45 / 30 + 1e-9, 'Looked at again 30 to 45 frames on');
assert.equal(world.rethink(shooter, cur, 300), cur, 'Not before the cadence');
world.time = shooter.rethinkAt;
assert.equal(world.rethink(shooter, cur, 300), better, 'A nearer target of the same rank replaces an unforced one');
world.time = shooter.rethinkAt;
const vic2 = make(tracked, 1, 100);
world.trackDamage(vic2, 100, shooter);
world.time = vic2.dmgTrack.next;
world.damageTrack(vic2);
shooter.stickiness = 5;
world.time = shooter.rethinkAt = Math.max(shooter.rethinkAt, world.time);
assert.equal(world.rethink(shooter, vic2, 300), vic2, 'A sticky target (time to die within the threshold) is kept');
shooter.stickiness = undefined;
shooter.prioSet = anti;
world.time = shooter.rethinkAt;
assert.equal(world.priorityFor(anti, cur), 1);
assert.equal(world.rethink(shooter, cur, 300), cur, 'A target of the top rank (1.0) is not looked past');
console.log(
  JSON.stringify({
    checks: 'low health first, priority, fire now, nearer; damage tracking window and decay; re-evaluation cadence, stickiness, top rank'
  })
);
