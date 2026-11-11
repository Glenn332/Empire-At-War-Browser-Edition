import { db } from '../gamedata.js';

let source = null,
  X = [],
  Y = [],
  Y2 = [];

function build() {
  const c = db.constants;
  if (source === c) return;
  source = c;
  const v = (c ? c.str('Diminishing_Firepower') : '')
    .split(/[\s,]+/)
    .filter(s => s !== '')
    .map(s => parseFloat(s) || 0);
  const pts = [];
  for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
  pts.sort((a, b) => a[0] - b[0]);
  X = pts.map(p => p[0]);
  Y = pts.map(p => p[1]);
  const n = X.length;
  Y2 = new Array(n).fill(0);
  if (n < 2) return;
  const u = new Array(n).fill(0);
  for (let i = 1; i + 1 < n; i++) {
    const sig = (X[i] - X[i - 1]) / (X[i + 1] - X[i - 1]),
      q = sig * Y2[i - 1] + 2;
    Y2[i] = (sig - 1) / q;
    u[i] = (Y[i + 1] - Y[i]) / (X[i + 1] - X[i]) - (Y[i] - Y[i - 1]) / (X[i] - X[i - 1]);
    u[i] = ((u[i] * 6) / (X[i + 1] - X[i - 1]) - sig * u[i - 1]) / q;
  }
  Y2[n - 1] = 0;
  for (let k = n - 2; k >= 1; k--) Y2[k] = Y2[k + 1] * Y2[k] + u[k];
}

export function diminishingFirepower(t) {
  build();
  const n = X.length;
  if (!n) return 1;
  let hi = 0;
  while (hi < n && !(X[hi] > t)) hi++;
  if (hi === n) return Y[n - 1];
  if (hi === 0) return Y[0];
  const lo = hi - 1,
    h = X[hi] - X[lo],
    a = (X[hi] - t) / h,
    b = (t - X[lo]) / h;
  return Y[hi] * b + Y[lo] * a + (((b * b * b - b) * Y2[hi] + (a * a * a - a) * Y2[lo]) * h * h) / 6;
}

export function normalDamage(proj) {
  if (!proj) return false;
  if (proj._normalDamage === undefined) {
    const s = proj.str('Internal_Damage_Type').trim().toUpperCase();
    proj._normalDamage = !s || s === 'DAMAGE_NORMAL' || !/^DAMAGE_/.test(s);
  }
  return proj._normalDamage;
}

export function diminishedHit(target, now) {
  const last = target.lastNormalHit;
  target.lastNormalHit = now;
  return diminishingFirepower(last === undefined || last < 0 ? 999999 : now - last);
}
