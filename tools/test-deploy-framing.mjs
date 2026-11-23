import assert from 'node:assert/strict';
import { fitPortrait, silhouetteBounds } from '../public/js/game/deploy-framing.js';

const n = 32,
  pixels = new Uint8Array(n * n * 4);
assert.equal(silhouetteBounds(pixels, n, 32), null);
// Off-center 12 × 4 bike, plus a nearly invisible FX pixel outside it.
for (let y = 19; y <= 22; y++) for (let x = 2; x <= 13; x++) pixels[4 * (y * n + x) + 3] = 255;
pixels[3] = 1;
const b = silhouetteBounds(pixels, n, 32);
assert.deepEqual(b, { x: -8, y: 5, width: 12, height: 4, clipped: false });
for (const aspect of [0.25, 0.8, 1, 2.4]) {
  const f = fitPortrait(b, aspect);
  assert.equal((f.left + f.right) / 2, b.x);
  assert.equal((f.top + f.bottom) / 2, b.y);
  assert(Math.abs((f.right - f.left) / (f.top - f.bottom) - aspect) < 1e-8);
  assert(f.right > b.x + b.width / 2 && f.top > b.y + b.height / 2);
}
pixels[3] = 255;
assert(silhouetteBounds(pixels, n, 32).clipped);
console.log('Portrait fit: visible silhouette, off-origin pivot, safe insets, aspect changes and clipped probe.');
