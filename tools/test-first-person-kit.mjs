// No retail files: a mixed shoulder/hand skin must not produce a stretched
// triangle bridging the gap, even when its palette order differs from the rig.
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry } from 'three';
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null };
const { handIndices } = await import('../public/js/game/first-person-kit.js');
const g = new BufferGeometry();
g.setAttribute('skinIndex', new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]), 4));
g.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]), 4));
g.setIndex([0, 1, 2, 1, 2, 3, 1, 2, 4]);
const bones = ['shoulder', 'hand'];
assert.deepEqual(handIndices(g, [1, 0], bones, new Set(['hand'])), [0, 1, 2]);
assert.equal(g.index.count, 9, 'shared world mesh is untouched');
console.log('PASS: retain hand triangle, exclude shoulder and mixed seam, preserve original geometry');
