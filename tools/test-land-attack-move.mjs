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
const { LandWorld, LandSquad, landUnit } = await import('../public/js/game/land.js');
const orders = [];
const world = Object.assign(Object.create(LandWorld.prototype), {
  team: [0, 1],
  wild: 3,
  time: 1,
  aiSuspended: false,
  units: [],
  squads: [],
  fowOn: false
});
world.order = (q, x, y) => {
  orders.push({ q, x, y });
  for (const u of q.members) u.path = [{ x, y }];
};
world.attack = (q, foe) => {
  q.foe = foe;
};
world.attackGroup = (l, foe) => {
  for (const q of l) q.foe = foe;
};
const type = db.type('Stormtrooper');
const K = 'Attack_Move_Response_Range';
const make = (side, x, y = 0, speed = 20, range = 100) => {
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
    dead: false,
    inside: false,
    flies: false,
    cloaked: false,
    path: [],
    range,
    speed,
    minRange: 0,
    antiAir: true,
    weapon: { cooldown: 0 },
    scanAt: Infinity
  });
  squad.members = [unit];
  world.units.push(unit);
  world.squads.push(squad);
  return squad;
};
const f = world.marchNum(make(0, -9999, -9999), K);
world.units.length = world.squads.length = 0;
assert(f > 0, 'the trooper has an attack-move response range');
const a = make(0, 0, 0, 20),
  b = make(0, 0, 30, 10);
for (const q of [a, b]) q.march = { x: 2000, y: 0 };
const G = world.marchTogether([a, b]);
const tick = (dt = 0.2) => {
  world.time += dt;
  world.groupMarch(G);
};
const far = make(1, 300, 400 + 100 + f + 5);
tick();
assert.equal(G.foe, null, 'Nothing beyond the unit attack range plus Attack_Move_Response_Range');
far.members[0].y = Math.min(100 + f - 5, 400);
far.members[0].x = 0;
far.members[0].y = 100 + f - 5;
tick();
assert.equal(G.foe, far, 'Acquired within attack range plus Attack_Move_Response_Range');
assert(a.foe === far && b.foe === far, 'The whole group takes the attack, none split off');
const L0 = world.leashAt(G);
assert(Math.abs(L0.x) < 1e-6 && Math.abs(L0.y) < 1e-6, 'The leash starts at the leader progress on its route');
world.time += 2;
const L1 = world.leashAt(G);
assert(Math.abs(L1.x - 20) < 1e-6, 'The leash moves on along the route at the slowest member speed');
world.time -= 2;
a.members[0].y = b.members[0].y = 0;
a.members[0].x = 0;
tick(0.5);
assert.equal(G.foe, far, 'Fighting goes on while the leader keeps within reach of the leash');
a.members[0].x = -f - 50;
a.members[0].y = 0;
tick(1);
assert.equal(G.foe, null, 'The chase fails once the leader is Attack_Move_Response_Range from the leash');
assert(a.foe === null && b.foe === null, 'The attack is popped for every squad');
assert(orders.some(o => o.q === a && o.x === 2000) && orders.some(o => o.q === b && o.x === 2000), 'The attack-move resumes at once');
far.members[0].x = a.members[0].x;
far.members[0].y = 50;
tick();
assert.equal(G.foe, null, 'New targets are refused while the leader is far from the leash');
a.members[0].x = world.leashAt(G).x;
tick();
assert.equal(G.foe, far, 'Back near the leash it takes targets again');
a.members[0].x = world.leashAt(G).x - f - 10;
far.members[0].x = a.members[0].x;
far.members[0].y = 10;
b.members[0].x = a.members[0].x;
b.members[0].y = 20;
tick(1.01);
assert.equal(G.foe, far, 'Out of the leash but every member in range: the fight goes on');
far.members = [];
tick();
assert.equal(G.foe, null, 'A dead target pops the attack');
assert.equal(a.foe, null);
console.log(
  JSON.stringify({
    checks: 'acquire range, group attack, leash start and speed, leash failure and pop, refusal, all in range, target death'
  })
);
