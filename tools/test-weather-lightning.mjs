import assert from 'node:assert/strict';
import { lightningState, lightningFrame, stepLightning, LIGHTNING_FRAME } from '../public/js/game/weatherlightning.js';

const seq = values => {
  let i = 0;
  return () => values[i++ % values.length];
};

{
  const s = lightningState();
  assert.equal(lightningFrame(s, 0, seq([0.9])), null);
  assert.equal(s.wait, 0);
}

{
  const s = lightningState();
  assert.equal(lightningFrame(s, 0.5, seq([0.1, 0.4])), null);
  assert.equal(s.wait, 25);
  assert.equal(s.flash, 6);
  let lit = 0,
    peak = 0;
  for (let f = 0; f < 6; f++) {
    const l = lightningFrame(s, 0.5, seq([0.5, 1, 0.5, 0.999]));
    assert.ok(l);
    lit++;
    peak = Math.max(peak, l.strength);
    assert.ok(Math.abs(Math.hypot(...l.dir) - 1) < 1e-9);
  }
  assert.equal(lit, 6);
  assert.ok(peak <= 0.25);
  for (let f = 0; f < 25; f++) assert.equal(lightningFrame(s, 0.5, seq([0.5])), null);
  assert.equal(s.wait, 0);
  lightningFrame(s, 0.5, seq([0.99, 0.99]));
  assert.ok(s.wait <= 250 && s.flash <= 15);
}

{
  const s = lightningState();
  lightningFrame(s, 0.25, seq([0.2, 0.9]));
  assert.ok(s.flash > 0);
  lightningFrame(s, 0.5, seq([0.5]));
  assert.equal(s.L, 0.5);
  assert.ok(s.flash <= 15);
}

{
  const s = lightningState();
  const rnd = seq([0.37, 0.81, 0.12, 0.66, 0.29, 0.93, 0.48]);
  let litTime = 0,
    total = 0,
    maxB = 0;
  for (let t = 0; t < 600; t += 1 / 60) {
    const l = stepLightning(s, 0.5, 1 / 60, rnd);
    total += 1 / 60;
    if (l) {
      litTime += 1 / 60;
      maxB = Math.max(maxB, l.strength);
    }
  }
  assert.ok(litTime > 0 && litTime / total < 0.2, 'flashes are short against long waits ' + litTime / total);
  assert.ok(maxB <= 0.25);
  assert.equal(stepLightning(s, 0, LIGHTNING_FRAME, rnd), null);
}

console.log('weather lightning ok');
