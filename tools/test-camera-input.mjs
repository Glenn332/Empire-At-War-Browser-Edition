import assert from 'node:assert/strict';
globalThis.window ??= globalThis;
const saved = new Map([['swr-edge-pan', '0']]);
globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
const { edgeAxis, panAxis } = await import('../public/js/game/edge-scroll.js');
const { edgePan, setEdgePan } = await import('../public/js/game/keybinds.js');
assert.equal(edgePan(), false, 'old explicit opt-out survives upgrade');
setEdgePan(true);
assert.equal(saved.get('swr-edge-pan'), '1');
assert.deepEqual(
  [-1, 0, 13, 14, 1105, 1106, 1119, 1120].map(x => edgeAxis(x, 1120, 14)),
  [0, -1, -1, 0, 0, 1, 1, 0]
);
assert.equal(panAxis(new Set(['ArrowUp']), 'SCROLL_UP', 'SCROLL_DOWN', 1), 1);
assert.equal(panAxis(new Set(['ArrowUp']), 'SCROLL_UP', 'SCROLL_DOWN', -1), 0);
const { terrainBoom } = await import('../public/js/game/infantry-camera.js');
const terrain = { size: 7, heights: new Float32Array(49) },
  c = { x: 100, y: 40, z: 12 };
for (let j = 0; j < 7; j++) terrain.heights[j * 7 + 3] = 28;
const limit = terrainBoom(c, 20, 40, 12, terrain, 1, 0.016);
assert.ok(c.x > 20 && c.x < 60 && limit < 1, 'ridge between clear endpoints shortens the boom');
terrain.heights.fill(0);
c.x = 100;
const release = terrainBoom(c, 20, 40, 12, terrain, limit, 0.016);
assert.ok(release > limit && release < 1, 'ease back out, do not pop to full distance');
c.x = 100;
assert.equal(terrainBoom(c, 20, 40, 12, terrain, 1, 0.016), 1, 'flat ground retains authored framing');
console.log('PASS: stored opt-out, all edge boundaries, key blending, ridge collision and recovery');
