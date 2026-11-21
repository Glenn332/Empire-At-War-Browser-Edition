import assert from 'node:assert/strict';
const THREE = await import('../public/vendor/three/build/three.module.js');
const { plain, keeper, guard, send } = await import('../public/js/game/spacebattlehooks.js');
const { World } = await import('../public/js/game/sim.js');

const events = [],
  fx = keeper('fx', events),
  audio = keeper('audio', events);
const world = { fx, audio, time: 3, nested: { deeper: { fx } } };

assert.equal(plain(fx), undefined);
assert.equal(plain(audio), undefined);
assert.deepEqual(plain({ fx, n: 1 }), { n: 1 });
assert.deepEqual(plain([fx, 2]), [undefined, 2]);
assert.deepEqual(plain(world), { time: 3, nested: { deeper: {} } });

fx.spawn('Explosion', new THREE.Vector3(1, 2, 3), { world, owner: { fx, audio } });
audio.play('Boom', { source: world, gain: 0.5 });
fx.hit({ color: new THREE.Color(0xff0000), f: () => 1, s: Symbol('x'), big: 1n });

const copy = structuredClone(events);
assert.deepEqual(copy[0], ['fx', 'spawn', ['Explosion', { $v: [1, 2, 3] }, { world: { time: 3, nested: { deeper: {} } }, owner: {} }]]);
assert.deepEqual(copy[1], ['audio', 'play', ['Boom', { source: { time: 3, nested: { deeper: {} } }, gain: 0.5 }]]);
assert.deepEqual(copy[2], ['fx', 'hit', [{ color: { $c: 0xff0000 } }]]);

structuredClone({ k: 'step', events: events.splice(0) });

const battle = Object.create(World.prototype);
battle.fx = fx;
assert.deepEqual(plain({ weapon: { world: battle, x: 4 } }), { weapon: { world: { $w: 1 }, x: 4 } });

const said = new Set(),
  errors = [],
  error = console.error;
console.error = (...a) => errors.push(a.join(' '));
const boom = () => {
  throw new Error('boom');
};
assert.equal(guard(said, 'the battle step', boom), undefined);
guard(said, 'the battle step', boom);
assert.equal(
  guard(said, 'the battle step', () => 5),
  5
);
assert.equal(errors.length, 1, 'the same failure is reported once');

const post = (m, transfer) => structuredClone(m, { transfer });
const buffer = new Float32Array([1, 2]).buffer,
  bad = {
    k: 'step',
    units: new Float32Array(buffer),
    events: [
      ['fx', 'ok', [1]],
      ['fx', 'bad', [() => 1]],
      ['audio', 'ok', [2]]
    ]
  };
const got = send(post, bad, [buffer], said);
assert.deepEqual(got.events, [
  ['fx', 'ok', [1]],
  ['audio', 'ok', [2]]
]);
assert.deepEqual([...got.units], [1, 2]);
assert.equal(buffer.byteLength, 0, 'the step buffers are still handed over');
assert(errors.some(e => e.includes('fx.bad')));
assert.throws(
  () =>
    send(
      () => {
        throw new TypeError('other');
      },
      { events: [] },
      [],
      said
    ),
  TypeError
);
const { beamMessage, beamFromMessage } = await import('../public/js/game/spacerecord.js');
const shooter = { id: 7 },
  victim = { id: 9, type: {} },
  units = new Map([
    [7, { id: 7, page: true }],
    [9, { id: 9, page: true }]
  ]);
const pointBeam = { a: shooter, b: { x: 10, y: -20, z: 30 }, color: [0.5, 1, 0.5], width: 4, bone: 'MUZZLEA_00', kind: '' },
  unitBeam = { a: shooter, b: victim, color: [1, 0, 0], width: 12, bone: null, kind: 'tractor' };
const sent = structuredClone([pointBeam, unitBeam].map(beamMessage)),
  [pointBack, unitBack] = sent.map(entry => beamFromMessage(units, entry));
assert(pointBack, 'a beam to a point crosses the worker');
assert.equal(pointBack.a, units.get(7));
assert.deepEqual(pointBack.b, { x: 10, y: -20, z: 30 });
assert.deepEqual(pointBack.color, [0.5, 1, 0.5]);
assert.equal(pointBack.width, 4);
assert.equal(pointBack.bone, 'MUZZLEA_00');
assert.equal(unitBack.b, units.get(9));
assert.equal(unitBack.kind, 'tractor');
assert.equal(beamFromMessage(new Map(), sent[0]), null, 'a beam from an unknown unit is dropped');
console.error = error;
console.log('space hooks: ok');
