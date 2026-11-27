import * as THREE from 'three';

const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [0, 1],
  [0, -1],
  [-1, 0],
  [1, 0]
];
const ray = new THREE.Vector3(),
  hit = new THREE.Vector3(),
  local = new THREE.Vector3(),
  center = new THREE.Vector3();

export function fitShadowToView(view, light, cx, cy, z0, cap, { margin = 0.06, least = 60 } = {}) {
  view.updateMatrixWorld();
  light.updateMatrixWorld();
  const eye = view.position;
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const [sx, sy] of CORNERS) {
    ray.set(sx, sy, 0.5).unproject(view).sub(eye).normalize();
    if (ray.z < -1e-4) {
      const t = (z0 - eye.z) / ray.z;
      hit.copy(eye).addScaledVector(ray, t);
    } else {
      const h = Math.hypot(ray.x, ray.y) || 1;
      hit.set(cx + (ray.x / h) * cap * 2, cy + (ray.y / h) * cap * 2, z0);
    }
    hit.x = Math.max(cx - cap * 1.5, Math.min(cx + cap * 1.5, hit.x));
    hit.y = Math.max(cy - cap * 1.5, Math.min(cy + cap * 1.5, hit.y));
    local.copy(hit).applyMatrix4(light.matrixWorldInverse);
    x0 = Math.min(x0, local.x);
    x1 = Math.max(x1, local.x);
    y0 = Math.min(y0, local.y);
    y1 = Math.max(y1, local.y);
  }
  center.set(cx, cy, z0).applyMatrix4(light.matrixWorldInverse);
  const pad = Math.max(x1 - x0, y1 - y0) * margin;
  x0 = Math.max(center.x - cap, x0 - pad);
  x1 = Math.min(center.x + cap, x1 + pad);
  y0 = Math.max(center.y - cap, y0 - pad);
  y1 = Math.min(center.y + cap, y1 + pad);
  if (!(x1 - x0 >= least)) {
    const m = (x0 + x1) / 2 || center.x;
    x0 = m - least / 2;
    x1 = m + least / 2;
  }
  if (!(y1 - y0 >= least)) {
    const m = (y0 + y1) / 2 || center.y;
    y0 = m - least / 2;
    y1 = m + least / 2;
  }
  // Quantize the light-space window to whole depth texels. Sub-texel camera motion otherwise
  // makes an otherwise stable shadow edge crawl even when the depth map is reused.
  const texels = Math.max(1, light.userData.shadowTexels || 1024),
    sx = texels / Math.max(1e-6, x1 - x0),
    sy = texels / Math.max(1e-6, y1 - y0),
    ox = Math.round(x0 * sx) / sx - x0,
    oy = Math.round(y0 * sy) / sy - y0;
  light.left = x0 + ox;
  light.right = x1 + ox;
  light.bottom = y0 + oy;
  light.top = y1 + oy;
  light.updateProjectionMatrix();
}
