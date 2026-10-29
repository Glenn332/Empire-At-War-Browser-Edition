import { simRandom } from './simrandom.js';

export const CAT = {
  DEFAULT: 0,
  MISSILE: 1,
  BOMB: 2,
  GRENADE: 3,
  ROCKET: 4,
  STATIC_BOMB: 5,
  MPTL_ROCKET: 6,
  LASER: 7,
  LIGHT_SABER: 8,
  CLUSTER_BOMB: 9
};

export const categoryOf = P => (P._cat ??= CAT[P.str('Projectile_Category').trim().toUpperCase()] ?? 0);

export const aimsOff = cat => cat < 8 && ((0xd9 >> cat) & 1) === 1;

const rand = (lo, hi) => lo + (hi - lo) * simRandom();

export function intercept(out, x, y, z, tx, ty, tz, vx, vy, vz, speed) {
  const dx = tx - x,
    dy = ty - y,
    dz = tz - z;
  const a = vx * vx + vy * vy + vz * vz - speed * speed,
    b = 2 * (dx * vx + dy * vy + dz * vz),
    c = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (Math.abs(a) < 1e-6) t = b < 0 ? -c / b : 0;
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc),
        t1 = (-b - s) / (2 * a),
        t2 = (-b + s) / (2 * a);
      t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2, 0);
    }
  }
  out.x = tx + vx * t;
  out.y = ty + vy * t;
  out.z = tz + vz * t;
  return out;
}

export function inaccuracy(out, dist, d, maxAttack, fixed = 0, space = true) {
  out.x = out.y = out.z = 0;
  if (fixed > 0) {
    out.x = rand(-fixed, fixed);
    out.y = rand(-fixed, fixed);
    if (space) out.z = rand(-fixed, fixed);
    return out;
  }
  if (!(d > 0) || !(dist > 0)) return out;
  const s = (dist * d) / Math.max(1, maxAttack || dist);
  out.x = rand(-s, s);
  out.y = rand(-s, s);
  out.z = rand(-s, s);
  return out;
}

export function turnToward(out, dx, dy, dz, ux, uy, uz, max) {
  const step = (from, to) => {
    const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + Math.max(-max, Math.min(max, d));
  };
  const yaw = step(Math.atan2(dy, dx), Math.atan2(uy, ux));
  const pitch = step(Math.atan2(dz, Math.hypot(dx, dy)), Math.atan2(uz, Math.hypot(ux, uy)));
  const c = Math.cos(pitch);
  out.x = Math.cos(yaw) * c;
  out.y = Math.sin(yaw) * c;
  out.z = Math.sin(pitch);
  return out;
}

export function rocketPath(P, x, y, z, hx, hy, hz, ax, ay, az, ground = null) {
  const straight = P.num('Projectile_Rocket_Straight_Distance', 0),
    curve = Math.max(1, P.num('Projectile_Rocket_Curve_Distance', 100));
  const offset = P.num('Projectile_Rocket_Curve_Offset', 0),
    maxFlight = P.num('Projectile_Max_Flight_Distance', 0);
  const toGround = !!ground,
    onTerrain = P.bool('Projectile_Target_Point_On_Terrain', false),
    atTarget = P.bool('Explode_When_Reached_Target_Radius', false);
  if (toGround && onTerrain) az = ground(ax, ay);
  const keys = [[x, y, z]];
  const leg = (from, to, amount, lastOnGround) => addLeg(keys, from, to, amount, lastOnGround, curve, offset, ground);
  const across = Math.hypot(ax - x, ay - y) * 0.5,
    ahead = Math.min(straight, across);
  let p1 = [x, y, z];
  if (ahead > 0) {
    p1 = [x + hx * ahead, y + hy * ahead, z + hz * ahead];
    leg([x, y, z], p1, 0.1, false);
  }
  leg(p1, [ax, ay, az], 1, onTerrain);
  if (!atTarget && maxFlight > 0) {
    const a = keys[keys.length - 2] || keys[0],
      b = keys[keys.length - 1];
    let so = 0;
    for (let i = 1; i < keys.length; i++)
      so += Math.hypot(keys[i][0] - keys[i - 1][0], keys[i][1] - keys[i - 1][1], keys[i][2] - keys[i - 1][2]);
    const more = maxFlight - so,
      ex = b[0] - a[0],
      ey = b[1] - a[1],
      ez = b[2] - a[2],
      el = Math.hypot(ex, ey, ez) || 1;
    if (more > 0) leg(b, [b[0] + (ex / el) * more, b[1] + (ey / el) * more, b[2] + (ez / el) * more], 0.3, false);
  }
  return spline(keys);
}

function addLeg(keys, from, to, amount, lastOnGround, curve, offset, ground) {
  const toGround = !!ground;
  const dx = to[0] - from[0],
    dy = to[1] - from[1],
    dz = to[2] - from[2],
    dist = Math.hypot(dx, dy, dz);
  const n = Math.ceil(dist / (1.1 * curve));
  if (!(n > 0)) return;
  const mx = (from[0] + to[0]) / 2 + 1,
    my = (from[1] + to[1]) / 2 + 1,
    mz = (from[2] + to[2]) / 2 + 1;
  const fx = from[0] - to[0],
    fy = from[1] - to[1],
    fz = from[2] - to[2];
  let ux = my * fz - mz * fy,
    uy = -(mx * fz - fx * mz),
    uz = mx * fy - fx * my;
  let vx = uy * fz - uz * fy,
    vy = -(ux * fz - uz * fx),
    vz = ux * fy - uy * fx;
  const ul = Math.hypot(ux, uy, uz) || 1,
    vl = Math.hypot(vx, vy, vz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  vx /= vl;
  vy /= vl;
  vz /= vl;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    let px = from[0] + dx * k,
      py = from[1] + dy * k,
      pz = from[2] + dz * k;
    if (i < n) {
      const ang = rand(0, Math.PI * 2),
        r = rand(0, amount * offset),
        c = Math.cos(ang),
        s = Math.sin(ang);
      px += (c * ux + s * vx) * r;
      py += (c * uy + s * vy) * r;
      pz += (c * uz + s * vz) * r;
      if (toGround) pz = Math.max(pz, ground(px, py) + amount * offset + 1);
    } else if (toGround && lastOnGround) pz = ground(px, py);
    keys.push([px, py, pz]);
  }
}

export function boomerangPath(P, x, y, z, ax, ay, az, bx, by, bz, ground = null) {
  const curve = Math.max(1, P.num('Projectile_Rocket_Curve_Distance', 100)),
    offset = P.num('Projectile_Rocket_Curve_Offset', 0),
    keys = [[x, y, z]];
  addLeg(keys, [x, y, z], [ax, ay, az], 1, ground && P.bool('Projectile_Target_Point_On_Terrain', false), curve, offset, ground);
  addLeg(keys, [ax, ay, az], [bx, by, bz], 0.3, true, curve, offset, ground);
  return spline(keys);
}

export function spline(keys) {
  const n = keys.length;
  if (n < 3) {
    const a = keys[0],
      b = keys[n - 1];
    keys = [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], b];
  }
  const N = keys.length - 1,
    c = new Float64Array(N * 12),
    gam = new Float64Array(N + 1),
    del = new Float64Array(N + 1),
    D = new Float64Array(N + 1);
  gam[0] = 0.5;
  for (let i = 1; i < N; i++) gam[i] = 1 / (4 - gam[i - 1]);
  gam[N] = 1 / (2 - gam[N - 1]);
  for (let j = 0; j < 3; j++) {
    const x = i => keys[i][j];
    del[0] = 3 * (x(1) - x(0)) * gam[0];
    for (let i = 1; i < N; i++) del[i] = (3 * (x(i + 1) - x(i - 1)) - del[i - 1]) * gam[i];
    del[N] = (3 * (x(N) - x(N - 1)) - del[N - 1]) * gam[N];
    D[N] = del[N];
    for (let i = N - 1; i >= 0; i--) D[i] = del[i] - gam[i] * D[i + 1];
    for (let i = 0; i < N; i++) {
      const o = i * 12 + j * 4;
      c[o] = x(i);
      c[o + 1] = D[i];
      c[o + 2] = 3 * (x(i + 1) - x(i)) - 2 * D[i] - D[i + 1];
      c[o + 3] = 2 * (x(i) - x(i + 1)) + D[i] + D[i + 1];
    }
  }
  const seg = new Float64Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) {
    seg[i] = pieceLength(c, i, 0, 1, 0);
    total += seg[i];
  }
  return { c, seg, total };
}
function pieceAt(c, i, u, out) {
  const o = i * 12;
  out.x = ((c[o + 3] * u + c[o + 2]) * u + c[o + 1]) * u + c[o];
  out.y = ((c[o + 7] * u + c[o + 6]) * u + c[o + 5]) * u + c[o + 4];
  out.z = ((c[o + 11] * u + c[o + 10]) * u + c[o + 9]) * u + c[o + 8];
  return out;
}
const _a = { x: 0, y: 0, z: 0 },
  _b = { x: 0, y: 0, z: 0 },
  _m = { x: 0, y: 0, z: 0 };
function pieceLength(c, i, u0, u1, depth) {
  pieceAt(c, i, u0, _a);
  const ax = _a.x,
    ay = _a.y,
    az = _a.z;
  pieceAt(c, i, u1, _b);
  const bx = _b.x,
    by = _b.y,
    bz = _b.z;
  const chord = Math.hypot(bx - ax, by - ay, bz - az);
  if (chord < 1e-6) return chord;
  const um = (u0 + u1) / 2;
  pieceAt(c, i, um, _m);
  const two = Math.hypot(_m.x - ax, _m.y - ay, _m.z - az) + Math.hypot(bx - _m.x, by - _m.y, bz - _m.z);
  if (Math.abs(chord / two - 1) <= 1e-6 || Math.abs(chord - two) <= 1e-6 || depth >= 16) return two;
  return pieceLength(c, i, u0, um, depth + 1) + pieceLength(c, i, um, u1, depth + 1);
}

export function pathAt(out, path, d) {
  const { c, seg } = path,
    N = seg.length;
  let i = 0,
    acc = 0;
  while (i < N - 1 && d >= acc + seg[i]) acc += seg[i++];
  const u = seg[i] > 0 ? Math.max(0, Math.min(1, (d - acc) / seg[i])) : 1,
    o = i * 12;
  pieceAt(c, i, u, out);
  const dx = (3 * c[o + 3] * u + 2 * c[o + 2]) * u + c[o + 1],
    dy = (3 * c[o + 7] * u + 2 * c[o + 6]) * u + c[o + 5],
    dz = (3 * c[o + 11] * u + 2 * c[o + 10]) * u + c[o + 9];
  const dl = Math.hypot(dx, dy, dz) || 1;
  out.dx = dx / dl;
  out.dy = dy / dl;
  out.dz = dz / dl;
  return out;
}

export function sweep(x0, y0, z0, x1, y1, z1, cx, cy, cz, heading, a, b, c) {
  const co = Math.cos(heading),
    si = Math.sin(heading);
  const lx = (x, y) => ((x - cx) * co + (y - cy) * si) / a,
    ly = (x, y) => (-(x - cx) * si + (y - cy) * co) / b;
  const ox = lx(x0, y0),
    oy = ly(x0, y0),
    oz = (z0 - cz) / c;
  const dx = lx(x1, y1) - ox,
    dy = ly(x1, y1) - oy,
    dz = (z1 - cz) / c - oz;
  const A = dx * dx + dy * dy + dz * dz,
    B = 2 * (ox * dx + oy * dy + oz * dz),
    C = ox * ox + oy * oy + oz * oz - 1;
  if (C <= 0) return 0;
  if (A < 1e-12) return -1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : -1;
}

export function sweepBox(x0, y0, z0, x1, y1, z1, cx, cy, cz, heading, a, b, c) {
  const co = Math.cos(heading),
    si = Math.sin(heading);
  const ox = (x0 - cx) * co + (y0 - cy) * si,
    oy = -(x0 - cx) * si + (y0 - cy) * co,
    oz = z0 - cz;
  const dx = (x1 - cx) * co + (y1 - cy) * si - ox,
    dy = -(x1 - cx) * si + (y1 - cy) * co - oy,
    dz = z1 - cz - oz;
  _slab[0] = 0;
  _slab[1] = 1;
  return slab(ox, dx, a) && slab(oy, dy, b) && slab(oz, dz, c) ? _slab[0] : -1;
}
const _slab = [0, 1];
function slab(o, d, h) {
  if (Math.abs(d) < 1e-9) return o >= -h && o <= h;
  let ta = (-h - o) / d,
    tb = (h - o) / d;
  if (ta > tb) {
    const s = ta;
    ta = tb;
    tb = s;
  }
  if (ta > _slab[0]) _slab[0] = ta;
  if (tb < _slab[1]) _slab[1] = tb;
  return _slab[0] <= _slab[1];
}

export function leadTurning(out, x, y, z, tx, ty, tz, vx, vy, vz, turn, speed) {
  const s = Math.hypot(vx, vy);
  if (!(Math.abs(turn) > 1e-4) || !(s > 1e-3) || s / Math.abs(turn) > 1000 || !(speed > 0))
    return intercept(out, x, y, z, tx, ty, tz, vx, vy, vz, speed);
  const R = s / Math.abs(turn),
    sg = Math.sign(turn);
  const cx = tx - (vy / s) * R * sg,
    cy = ty + (vx / s) * R * sg,
    rx = tx - cx,
    ry = ty - cy;
  const at = t => {
    const a = turn * t,
      c = Math.cos(a),
      si = Math.sin(a);
    out.x = cx + rx * c - ry * si;
    out.y = cy + rx * si + ry * c;
    out.z = tz + vz * t;
    return Math.hypot(out.x - x, out.y - y, out.z - z) - speed * t;
  };
  let lo = 0,
    hi = (Math.hypot(tx - x, ty - y, tz - z) + 2 * R + Math.abs(vz) * 10) / speed;
  if (at(hi) > 0) return intercept(out, x, y, z, tx, ty, tz, vx, vy, vz, speed);
  for (let i = 0; i < 15; i++) {
    const m = (lo + hi) / 2;
    if (at(m) > 0) lo = m;
    else hi = m;
  }
  at(hi);
  return out;
}
