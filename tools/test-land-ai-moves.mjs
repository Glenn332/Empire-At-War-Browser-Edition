import assert from 'node:assert/strict';
const { Plans } = await import('../public/js/game/aiplans.js');
const P = Object.create(Plans.prototype);
const inst = {},
  red = { id: 0 },
  blue = { id: 1 };
const squad = (over = {}) => ({ members: [{}], aiPlan: inst, player: red, order: { kind: 'move' }, ...over });
const f = { inst, moving: new Set() };
const walking = squad(),
  stopped = squad(),
  died = squad(),
  turned = squad(),
  released = squad();
P.moved(f, [walking, stopped, died, turned, released]);
stopped.order = { kind: 'idle' };
died.dead = true;
turned.player = blue;
released.aiPlan = null;
P.settle(f);
assert.deepEqual([...f.moving], [walking], 'only the unit still on its way stays pending');
assert.deepEqual(f.arrived, [stopped], 'arrival is the unit order completing, drop-outs report nothing');
const far = squad({ x: 5000, y: 0 });
P.moved(f, [far]);
far.order = { kind: 'idle' };
P.settle(f);
assert(!f.moving.has(far), 'a unit that stopped short of the goal still finishes the move, there is no radius');
walking.order = { kind: 'attack' };
P.settle(f);
assert(f.moving.has(walking), 'a unit fighting on the way has not finished its move');
P.host = { diversions: new Map([[walking, [{}]]]) };
P.settle(f);
assert(!f.moving.has(walking), 'a diverted unit leaves the formation move');
console.log('ok');
