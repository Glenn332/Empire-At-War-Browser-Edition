// North-up, uniform scale. Reserve space for the full selection halo and the
// number above a post, not just its centre. The same view is used for hit tests.
export const DISC_EDGE = 0.492,
  MARKER_LIMIT = 0.43;

export function fitSpawnDisc(points, lo, hi, previous) {
  const pts = points.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const span = Math.max(1, hi[0] - lo[0], hi[1] - lo[1]);
  if (!pts.length) return { x: (lo[0] + hi[0]) / 2, y: (lo[1] + hi[1]) / 2, r: span / 2 };
  const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  // Start with the widest pair (posts, available spawns and visible defenses).
  // Grow towards any outlier. Unlike fitting the map rectangle, this also zooms
  // in on an off-centre fight and keeps diagonal layouts inside a circle.
  let a = pts[0],
    b = a,
    diameter = 0;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = distance(pts[i], pts[j]);
      if (d > diameter) {
        diameter = d;
        a = pts[i];
        b = pts[j];
      }
    }
  const v = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: diameter / 2 };
  for (const p of pts) {
    const d = distance(p, v);
    if (d <= v.r) continue;
    const grow = (d - v.r) / 2;
    v.x += ((p.x - v.x) * grow) / d;
    v.y += ((p.y - v.y) * grow) / d;
    v.r += grow;
  }
  // Keep terrain context around single or nearly coincident spawns. A little
  // headroom and a dead band keep moving squads from wobbling the map. Never
  // keep an old view once even one marker is outside the safe radius.
  v.r = Math.max(span * 0.19, v.r * 1.035);
  if (previous && previous.r <= v.r * 1.14 && pts.every(p => distance(p, previous) <= previous.r)) return previous;
  return v;
}

export function projectDisc(view, width, side) {
  const k = (width * MARKER_LIMIT) / view.r;
  return { W: width, side, k, X: x => width / 2 + (x - view.x) * k, Y: y => width / 2 - (y - view.y) * k };
}
