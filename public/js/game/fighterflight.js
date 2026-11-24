// Fighter movement for one battle step: obstacle avoidance, then flight. Everything it reads is packed into
// typed arrays first, so the same functions run on the battle thread or on the job threads and give the same
// doubles either way. Each fighter only writes its own row, so fighters can move in any order or in parallel.
import { meshHit } from './collmesh.js';

export const LOGIC_FPS = 30;
export const PROBE_CELL = 1024;
const TAU = Math.PI * 2;
const LOOP_OVER = (170 * Math.PI) / 180,
  LOOP_KEEP = Math.PI / 2;
const AVOID_TIME = 15 / LOGIC_FPS;

export const wrapAngle = a => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// One row per moving fighter. Angles and positions are the unit's own fields; NaN stands for "not set" where
// the unit field may be undefined (pitch, loop, avoid).
export const F = {
  ID: 0,
  X: 1,
  Y: 2,
  Z: 3,
  HEADING: 4,
  PITCH: 5,
  ROLL: 6,
  SPEED: 7,
  TURN_RATE: 8,
  ACCEL: 9,
  LIFT: 10,
  ROLL_RATE: 11,
  THRUST: 12,
  BANK: 13,
  GOAL_X: 14,
  GOAL_Y: 15,
  GOAL_Z: 16,
  GOAL_Z_DEFAULT: 17,
  WANT: 18,
  WANT_IF_HIT: 19,
  TURN_FACTOR: 20,
  LOOP_ALLOWED: 21,
  LEADER: 22,
  LOOP: 23,
  AVOID: 24,
  FLIPPED: 25,
  STRIDE: 26
};

// One row per obstacle in the probe grid, with its pose at the start of the move.
export const O = {
  ID: 0,
  X: 1,
  Y: 2,
  Z: 3,
  HEADING: 4,
  PITCH: 5,
  ROLL: 6,
  SCALE: 7,
  HAS_CULL: 8,
  CULL: 9,
  HAS_BOX: 15,
  BOX: 16,
  MESH: 22,
  STRIDE: 23
};

// The packed probe grid: cell keys in ascending order, each with a run of obstacle rows, in the order the
// battle's own grid lists them.
export class MoveScene {
  constructor(fighters, obstacles, keys, starts, items, meshes) {
    this.fighters = fighters;
    this.obstacles = obstacles;
    this.keys = keys;
    this.starts = starts;
    this.items = items;
    this.meshes = meshes;
    this.cellCount = 0;
    this.minX = 0;
    this.minY = 0;
    this.maxX = 0;
    this.maxY = 0;
    this.dt = 0;
  }

  cellOf(key) {
    let lo = 0,
      hi = this.cellCount - 1;
    const keys = this.keys;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1,
        k = keys[mid];
      if (k === key) return mid;
      if (k < key) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}

const _from = { x: 0, y: 0, z: 0 },
  _to = { x: 0, y: 0, z: 0 },
  _away = { x: 0, y: 0, z: 0, hit: false };

function toModel(ob, row, x, y, z, out) {
  const k = 1 / (ob[row + O.SCALE] || 1),
    a = -((ob[row + O.HEADING] || 0) + Math.PI / 2),
    c = Math.cos(a),
    s = Math.sin(a),
    P = ob[row + O.PITCH] || 0,
    R = ob[row + O.ROLL] || 0;
  x -= ob[row + O.X];
  y -= ob[row + O.Y];
  z -= ob[row + O.Z];
  let X = x * c - y * s,
    Y = x * s + y * c,
    Z = z;
  if (P) {
    const cp = Math.cos(P),
      sp = Math.sin(P),
      y2 = Y * cp - Z * sp,
      z2 = Y * sp + Z * cp;
    Y = y2;
    Z = z2;
  }
  if (R) {
    const cr = Math.cos(-R),
      sr = Math.sin(-R),
      x2 = X * cr + Z * sr,
      z2 = -X * sr + Z * cr;
    X = x2;
    Z = z2;
  }
  out.x = X * k;
  out.y = Y * k;
  out.z = Z * k;
  return out;
}

function meshTransform(ob, row, x, y, z, out) {
  const k = 1 / (ob[row + O.SCALE] || 1),
    a = -((ob[row + O.HEADING] || 0) + Math.PI / 2),
    c = Math.cos(a),
    s = Math.sin(a),
    P = ob[row + O.PITCH] || 0,
    R = ob[row + O.ROLL] || 0,
    cp = Math.cos(P),
    sp = Math.sin(P),
    cr = Math.cos(-R),
    sr = Math.sin(-R);
  x -= ob[row + O.X];
  y -= ob[row + O.Y];
  z -= ob[row + O.Z];
  let X = x * c - y * s,
    Y = x * s + y * c,
    Z = z;
  if (P) {
    const y2 = Y * cp - Z * sp,
      z2 = Y * sp + Z * cp;
    Y = y2;
    Z = z2;
  }
  if (R) {
    const x2 = X * cr + Z * sr,
      z2 = -X * sr + Z * cr;
    X = x2;
    Z = z2;
  }
  out.x = X * k;
  out.y = Y * k;
  out.z = Z * k;
  return out;
}

// Where along the segment the obstacle starts (0..1), -1 for no hit, -2 when the start is already inside its
// look box. Returns undefined when its collision mesh is not available here.
function lookStep(scene, row, x0, y0, z0, x1, y1, z1) {
  const ob = scene.obstacles;
  if (!ob[row + O.HAS_BOX]) {
    const ref = ob[row + O.MESH];
    if (ref < 0) return -1;
    const mesh = scene.meshes(ref);
    if (!mesh) return undefined;
    const A = meshTransform(ob, row, x0, y0, z0, _from),
      B = meshTransform(ob, row, x1, y1, z1, _to);
    return meshHit(mesh, A.x, A.y, A.z, B.x - A.x, B.y - A.y, B.z - A.z);
  }
  toModel(ob, row, x0, y0, z0, _from);
  toModel(ob, row, x1, y1, z1, _to);
  const box = row + O.BOX,
    ox = _from.x,
    oy = _from.y,
    oz = _from.z;
  if (ox >= ob[box] && ox <= ob[box + 3] && oy >= ob[box + 1] && oy <= ob[box + 4] && oz >= ob[box + 2] && oz <= ob[box + 5]) return -2;
  const dx = _to.x - ox,
    dy = _to.y - oy,
    dz = _to.z - oz;
  let t0 = 0,
    t1 = 1;
  for (let axis = 0; axis < 3; axis++) {
    const p = axis === 0 ? ox : axis === 1 ? oy : oz,
      d = axis === 0 ? dx : axis === 1 ? dy : dz;
    if (Math.abs(d) < 1e-12) {
      if (p < ob[box + axis] || p > ob[box + axis + 3]) return -1;
      continue;
    }
    let a = (ob[box + axis] - p) / d,
      c = (ob[box + axis + 3] - p) / d;
    if (a > c) {
      const swap = a;
      a = c;
      c = swap;
    }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  return t0 < 1 ? t0 : -1;
}

// The point to steer for instead of the goal, or null. False when a collision mesh it needs is not available.
function probe(scene, row) {
  const fi = scene.fighters,
    ob = scene.obstacles,
    dt = scene.dt;
  const pitch = fi[row + F.PITCH] || 0,
    flat = Math.cos(pitch),
    heading = fi[row + F.HEADING],
    ex = Math.cos(heading) * flat,
    ey = Math.sin(heading) * flat,
    ez = Math.sin(pitch);
  const speed = fi[row + F.SPEED],
    x = fi[row + F.X],
    y = fi[row + F.Y],
    z = fi[row + F.Z];
  const v = speed * (2 / Math.max(0.05, fi[row + F.TURN_RATE])) * (fi[row + F.LEADER] ? 2 : 1);
  let hit = -1;
  if (v >= 1 && scene.cellCount) {
    const cell = scene.cellOf(Math.floor(x / PROBE_CELL) * 65536 + Math.floor(y / PROBE_CELL));
    if (cell >= 0) {
      const d = speed / LOGIC_FPS,
        x1 = x + ex * v,
        y1 = y + ey * v,
        z1 = z + ez * v,
        me = fi[row + F.ID];
      for (let i = scene.starts[cell], end = scene.starts[cell + 1]; i < end; i++) {
        const o = scene.items[i] * O.STRIDE;
        if (ob[o + O.ID] === me) continue;
        if (
          !ob[o + O.HAS_CULL] ||
          Math.abs(x - ob[o + O.CULL]) > ob[o + O.CULL + 3] + d ||
          Math.abs(y - ob[o + O.CULL + 1]) > ob[o + O.CULL + 4] + d ||
          Math.abs(z - ob[o + O.CULL + 2]) > ob[o + O.CULL + 5] + d
        )
          continue;
        const t = lookStep(scene, o, x, y, z, x1, y1, z1);
        if (t === undefined) return false;
        if (t === -2) break;
        if (t >= 0) {
          hit = o;
          break;
        }
      }
    }
  }
  if (hit >= 0) {
    fi[row + F.AVOID] = AVOID_TIME;
    const ax = x - ob[hit + O.X],
      ay = y - ob[hit + O.Y],
      az = z - ob[hit + O.Z];
    if (ax || ay || az) {
      _away.x = x + ax;
      _away.y = y + ay;
      _away.z = z + az;
    } else {
      _away.x = x + 1;
      _away.y = y;
      _away.z = z;
    }
    _away.hit = true;
    return _away;
  }
  if (fi[row + F.AVOID] > 0) {
    fi[row + F.AVOID] -= dt;
    const k = (speed * 10) / LOGIC_FPS;
    _away.x = x + ex * k;
    _away.y = y + ey * k;
    _away.z = z + ez * k;
    _away.hit = false;
    return _away;
  }
  return null;
}

export function flyRow(scene, row, tx, ty, tz, want) {
  const fi = scene.fighters,
    dt = scene.dt,
    k = fi[row + F.TURN_FACTOR],
    over = fi[row + F.LOOP_ALLOWED] !== 0,
    lift = fi[row + F.LIFT],
    rollRate = fi[row + F.ROLL_RATE],
    turnRate = fi[row + F.TURN_RATE];
  let x = fi[row + F.X],
    y = fi[row + F.Y],
    z = fi[row + F.Z],
    heading = fi[row + F.HEADING],
    pitch = fi[row + F.PITCH],
    roll = fi[row + F.ROLL] || 0,
    speed = fi[row + F.SPEED],
    loop = fi[row + F.LOOP];
  tx = clamp(tx, scene.minX, scene.maxX);
  ty = clamp(ty, scene.minY, scene.maxY);
  let err = wrapAngle(Math.atan2(ty - y, tx - x) - heading);
  if (loop === loop && Math.abs(err) < LOOP_KEEP) loop = NaN;
  if (loop !== loop && over && lift > 0 && Math.abs(err) > LOOP_OVER) {
    loop = Math.atan2(tz - z, Math.hypot(tx - x, ty - y)) - (pitch || 0) > 0 ? 1 : -1;
  }
  if (loop === loop) {
    pitch = (pitch || 0) + loop * lift * dt * k;
    roll += clamp(-roll, -rollRate * dt, rollRate * dt);
    if (Math.abs(pitch) >= Math.PI / 2) {
      pitch = (Math.PI - Math.abs(pitch) - lift / LOGIC_FPS) * Math.sign(pitch);
      heading = wrapAngle(heading + Math.PI);
      roll = wrapAngle(roll + Math.PI);
      loop = NaN;
      fi[row + F.FLIPPED] = 1;
    }
  } else {
    if (Math.abs(err - (turnRate * wrapAngle(roll)) / rollRate) > Math.PI) err -= Math.sign(err) * 2 * Math.PI;
    const bank = clamp(err, -fi[row + F.BANK], fi[row + F.BANK]);
    roll += clamp(bank - roll, -rollRate * dt, rollRate * dt);
    if (!(roll * bank < 0) || Math.abs(roll) < 0.02) heading = wrapAngle(heading + clamp(err, -turnRate * dt * k, turnRate * dt * k));
  }
  const a = (fi[row + F.THRUST] || fi[row + F.ACCEL]) * dt * k;
  speed += clamp(want - speed, -a, a);
  if (loop !== loop && lift > 0) {
    const h = Math.max(Math.hypot(tx - x, ty - y), speed / Math.max(0.1, turnRate)),
      p = pitch || 0;
    const level = (Math.abs(p) / lift) * speed;
    const dz = (tz - z) * (h < level ? h / level : 1);
    pitch = p + clamp(Math.atan2(dz, h) - p, -lift * dt * k, lift * dt * k);
  }
  const flat = Math.cos(pitch || 0);
  x = clamp(x + Math.cos(heading) * speed * flat * dt, scene.minX, scene.maxX);
  y = clamp(y + Math.sin(heading) * speed * flat * dt, scene.minY, scene.maxY);
  if (loop === loop || lift > 0) z += Math.sin(pitch || 0) * speed * dt;
  else z += (tz - z) * Math.min(1, dt * 0.8);
  fi[row + F.X] = x;
  fi[row + F.Y] = y;
  fi[row + F.Z] = z;
  fi[row + F.HEADING] = heading;
  fi[row + F.PITCH] = pitch;
  fi[row + F.ROLL] = roll;
  fi[row + F.SPEED] = speed;
  fi[row + F.LOOP] = loop;
}

// Moves fighter `index`. False when it needs a collision mesh this thread does not have; the row is then left
// as it was so the battle thread can move it instead.
export function moveFighter(scene, index) {
  const fi = scene.fighters,
    row = index * F.STRIDE,
    avoid = fi[row + F.AVOID];
  const away = probe(scene, row);
  if (away === false) {
    fi[row + F.AVOID] = avoid;
    return false;
  }
  let gx = fi[row + F.GOAL_X],
    gy = fi[row + F.GOAL_Y],
    gz = fi[row + F.GOAL_Z],
    want = fi[row + F.WANT];
  if (gz !== gz) gz = fi[row + F.GOAL_Z_DEFAULT];
  if (away) {
    gx = away.x;
    gy = away.y;
    gz = away.z;
    const ifHit = fi[row + F.WANT_IF_HIT];
    if (away.hit && ifHit === ifHit) want = ifHit;
  }
  flyRow(scene, row, gx, gy, gz, want);
  return true;
}
