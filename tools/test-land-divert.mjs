import assert from 'node:assert/strict';
const { ScriptHost } = await import('../public/js/game/scripts.js');
const signals = [],
  calls = [];
const world = { time: 1 };
const squad = () => {
  const q = {
    type: { name: 'Squad' },
    members: [{ x: 0, y: 0, path: [] }],
    foe: null,
    march: null,
    post: null,
    leash: null,
    legs: null,
    get order() {
      return this.foe ? { kind: 'attack' } : this.members.some(u => u.path.length) ? { kind: 'move' } : { kind: 'idle' };
    }
  };
  return q;
};
const cmd = {
  move: (us, x, y, attack) => {
    calls.push(['move', x, y, !!attack]);
    for (const q of us) {
      q.foe = null;
      q.post = null;
      q.legs = null;
      q.march = attack ? { x, y } : null;
      for (const u of q.members) u.path = [{ x, y }];
    }
  },
  attack: (us, t) => {
    calls.push(['attack', t]);
    for (const q of us) q.foe = t;
  },
  stop: us => {
    calls.push(['stop']);
    for (const q of us) for (const u of q.members) u.path = [];
  }
};
const host = Object.assign(Object.create(ScriptHost.prototype), {
  land: true,
  world,
  cmd,
  wrapped: new Map(),
  plans: { signal: (e, name) => signals.push([name, e]) },
  at: v => v
});
const arrive = q => {
  for (const u of q.members) {
    const p = u.path[u.path.length - 1];
    if (p) Object.assign(u, { x: p.x, y: p.y });
    u.path = [];
  }
};
const q = squad();
const unit = host.unitWrap(q);
assert.equal(unit.Divert({ x: 10, y: 10 }), false, 'a unit with no order (between moves) cannot be diverted');
cmd.move([q], 500, 0, true);
q.legs = [{ x: 900, y: 0 }];
host.lock(q);
assert.equal(unit.Divert({ x: 10, y: 10 }), false, 'locked orders cannot be diverted');
host.locks.delete(q);
assert.equal(unit.Divert({ x: 10, y: 10 }), true);
assert(unit.Is_On_Diversion());
assert.deepEqual(calls.at(-1), ['move', 10, 10, false]);
world.time = 2;
host.stepDiversions();
assert(unit.Is_On_Diversion(), 'still on the way');
arrive(q);
host.stepDiversions();
assert(!unit.Is_On_Diversion());
assert.deepEqual(signals.pop(), ['Unit_Diversion_Finished', q]);
assert.deepEqual(calls.at(-1), ['move', 500, 0, true], 'the earlier attack-move is planned again');
assert.deepEqual(q.legs, [{ x: 900, y: 0 }], 'queued waypoints come back');
const foe = { members: [{}] };
cmd.attack([q], foe);
unit.Divert({ x: 20, y: 20 });
world.time = 3;
unit.Divert({ x: 30, y: 30 });
world.time = 4;
arrive(q);
host.stepDiversions();
assert(unit.Is_On_Diversion(), 'the earlier diversion carries on');
assert.deepEqual(calls.at(-1), ['move', 20, 20, false]);
world.time = 5;
arrive(q);
host.stepDiversions();
assert(!unit.Is_On_Diversion());
assert.deepEqual(calls.at(-1), ['attack', foe], 'the attack before both diversions resumes');
unit.Divert({ x: 40, y: 40 });
world.time = 6;
cmd.move([q], 800, 800, false);
host.stepDiversions();
assert(!unit.Is_On_Diversion(), 'a new order ends the diversion');
assert.deepEqual(signals.pop(), ['Unit_Diversion_Finished', q], 'leaving while diverted signals too');
assert.deepEqual(calls.at(-1), ['move', 800, 800, false], 'the new order is kept');
console.log('ok');
