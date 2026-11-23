import assert from 'node:assert/strict';
import { fitSpawnDisc, projectDisc, DISC_EDGE, MARKER_LIMIT } from '../public/js/game/deploy-disc.js';

const lo = [0, 0],
  hi = [4000, 4000],
  points = (...xy) => xy.map(([x, y]) => ({ x, y }));
function check(pts, last, bounds = hi) {
  const view = fitSpawnDisc(pts, lo, bounds, last);
  assert(view.r > 0 && Number.isFinite(view.r));
  for (const size of [520, 760]) {
    const f = projectDisc(view, size, 4000);
    for (const p of pts.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) {
      const d = Math.hypot(f.X(p.x) - size / 2, f.Y(p.y) - size / 2);
      assert(d <= size * MARKER_LIMIT + 1e-7, 'spawn centre within safe inset');
      assert(d + (size * 25) / 520 < size * DISC_EDGE, 'outer halo and number fit');
    }
  }
  return view;
}
const clustered = points([380, 240], [1100, 400], [930, 820]);
const tight = check(clustered);
assert(tight.r < 1100 && tight.x < 1200 && tight.y < 900, 'zoom to the action rather than centring the whole level');
assert.equal(check(points([384, 241], [1102, 401], [930, 820]), tight), tight, 'minor motion does not move the map');
assert.notEqual(check([...clustered, { x: 3940, y: 3950 }], tight), tight, 'a newly eligible corner spawn immediately widens the view');
check(points([0, 0], [3999, 3999], [3999, 0], [0, 3999]));
check(points([50, 180], [7850, 60], [7400, 420]), null, [8000, 500]);
check(points([-190, -240], [2030, 2400], [4800, 4750]));
check(points([400, 400], [400, 400]));
check([null, { x: NaN, y: 4 }]);
check([]);
console.log('Spawn disc: clustered, moving, new, corner, long, out-of-bounds, coincident and empty layouts fit at both sizes.');
