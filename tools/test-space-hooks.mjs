import assert from 'node:assert/strict';
const THREE = await import('../public/vendor/three/build/three.module.js');
const { plain, keeper } = await import('../public/js/game/spacebattlehooks.js');

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
console.log('space hooks: ok');
