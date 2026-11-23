// Coordinates are in the portrait camera's image plane; WebGL's first row is the bottom.
export function silhouetteBounds(rgba, n, span) {
  let left = n,
    right = -1,
    bottom = n,
    top = -1;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (rgba[4 * (y * n + x) + 3] < 32) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      bottom = Math.min(bottom, y);
      top = Math.max(top, y);
    }
  if (right < left) return null;
  const k = span / n;
  return {
    x: ((left + right + 1 - n) * k) / 2,
    y: ((bottom + top + 1 - n) * k) / 2,
    width: (right - left + 1) * k,
    height: (top - bottom + 1) * k,
    clipped: left === 0 || bottom === 0 || right === n - 1 || top === n - 1
  };
}

// Anchor in screen space, not at the model origin. Keep the same reference pose
// through gestures and resizes: the camera should not chase the breathing rig.
export function fitPortrait(bounds, aspect) {
  const height = Math.max(0.001, bounds.height, bounds.width / aspect) * 1.16;
  return {
    left: bounds.x - (height * aspect) / 2,
    right: bounds.x + (height * aspect) / 2,
    bottom: bounds.y - height / 2,
    top: bounds.y + height / 2
  };
}
