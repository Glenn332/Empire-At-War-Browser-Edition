import assert from 'node:assert/strict';
import { pinRadarPoint, spaceRimPins } from '../public/js/game/combat-hud.js';

assert.deepEqual(pinRadarPoint(65, 81, 100, 90), [65, 81]);
assert.deepEqual(pinRadarPoint(100, -990, 100, 90), [100, 10]);
const diagonal = pinRadarPoint(2100, 2100, 100, 90);
assert.ok(Math.abs(Math.hypot(diagonal[0] - 100, diagonal[1] - 100) - 90) < 1e-10);
for (const bearings of [
  [0, 0, 0],
  [-3.14, -0.3, 0.08, 3.13, 3.14],
  [0.8, -2, 0.79, 0.78]
]) {
  const pins = bearings.map(bearing => ({ bearing, angle: bearing }));
  spaceRimPins(pins, 90);
  const angles = pins.map(p => (p.angle + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
  for (let i = 0; i < angles.length; i++)
    assert.ok((angles[(i + 1) % angles.length] - angles[i] + 2 * Math.PI) % (2 * Math.PI) >= 0.2 - 1e-8);
}
console.log('PASS: near radar positions unchanged, distant objectives pinned to bearing, coincident/wraparound icons readable');
