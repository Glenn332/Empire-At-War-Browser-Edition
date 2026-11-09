import assert from 'node:assert/strict';
const { cinematicFov, cinematicAnimTime } = await import('../public/js/game/storycinematic.js');
const { parseStoryDialog } = await import('../public/js/game/galacticstorydialog.js');
assert.ok(Math.abs(cinematicFov(4 / 3) - 20.08) < 0.01, 'the 4:3 picture sees 26.57 degrees across and 20.08 up');
const anim = { frames: 31, fps: 30 };
assert.equal(cinematicAnimTime(5, 7, anim), 0, 'before its start time the first frame is held');
assert.ok(Math.abs(cinematicAnimTime(7.5, 7, anim) - 0.5) < 1e-9);
assert.ok(Math.abs(cinematicAnimTime(9.25, 7, anim) - 0.25) < 1e-9, 'loops');
assert.deepEqual(parseStoryDialog(`[CHAPTER 0]\nLOADCINEMATIC W_Probe.alo\nANIM 3\nHIDECINEMATIC 1`, 0), [
  { op: 'LOADCINEMATIC', value: 'W_Probe.alo' },
  { op: 'ANIM', value: '3' },
  { op: 'HIDECINEMATIC', value: '1' }
]);
console.log('ok');
