// A fighter's steering decision for one battle step: where to fly, how fast, whether it may loop, and what it
// fires at. Squadrons that are not dogfighting only read their own squadron and fighters, so each squadron is
// decided on its own (leader first, then its wingmen) from columns packed beforehand. The same code runs on the
// battle thread and on the job threads, so a battle plays out the same with or without job threads.
export const LOGIC_FPS = 30;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// One row per fighter, grouped by squadron in squadron order (leader first).
export const DF = {
  ID: 0,
  X: 1,
  Y: 2,
  Z: 3,
  HEADING: 4,
  PITCH: 5,
  SPEED: 6,
  TURN_RATE: 7,
  MIN_SPEED: 8,
  MAX_SPEED: 9,
  OWN: 10,
  SLOT_X: 11,
  SLOT_Y: 12,
  SLOT_Z: 13,
  THRUST: 14,
  ACCEL: 15,
  TYPE_MAX_SPEED: 16,
  OVERRIDE_DECEL: 17,
  GZ_BASE: 18,
  FIRE_IDLE: 19,
  // decided
  GOAL_X: 20,
  GOAL_Y: 21,
  GOAL_Z: 22,
  GOAL_Z_DEFAULT: 23,
  WANT: 24,
  WANT_IF_HIT: 25,
  TURN_FACTOR: 26,
  LOOP_ALLOWED: 27,
  FIRE: 28,
  ATTACKING: 29,
  STRIDE: 30
};

export const FIRE = { NONE: 0, TARGET: 1, SQUAD_TARGET: 2, DIRECT: 3 };
export const MODE = { IDLE: 0, MOVE: 1, COMBAT: 2 };
export const TARGET = { NONE: 0, SQUAD: 1, UNIT: 2 };

// One row per squadron.
export const DS = {
  FIRST: 0,
  COUNT: 1,
  MODE: 2,
  TARGET: 3,
  APPROACH: 4,
  AIM_X: 5,
  AIM_Y: 6,
  AIM_Z: 7,
  RUN_IN: 8,
  STACKED: 9,
  ROUTED: 10,
  ROUTE_DX: 11,
  ROUTE_DY: 12,
  ROUTE_SX: 13,
  ROUTE_SY: 14,
  GOAL_X: 15,
  GOAL_Y: 16,
  HAS_ABOUT: 17,
  ABOUT_X: 18,
  ABOUT_Y: 19,
  CRUISE: 20,
  PACE: 21,
  TRAVEL: 22,
  SPEED: 23,
  ERR: 24,
  TOLERANCE: 25,
  DIRECT: 26,
  DIRECT_TURN: 27,
  DIRECT_THROTTLE: 28,
  DIRECT_FIRING: 29,
  FIRE_TARGET_ALIVE: 30,
  ORDER_IDLE: 31,
  GUARDING_TARGET: 32,
  STRIDE: 33
};

export class DecideScene {
  constructor(fighters, squads) {
    this.fighters = fighters;
    this.squads = squads;
    this.sideMin = 0.1;
    this.sideMax = 30;
  }
}

function sideError(scene, x, y, sq) {
  const s = scene.squads,
    lo = scene.sideMin,
    e = -(s[sq + DS.ROUTE_DX] * (y - s[sq + DS.ROUTE_SY]) - s[sq + DS.ROUTE_DY] * (x - s[sq + DS.ROUTE_SX]));
  if (!(Math.abs(e) > lo)) return 0;
  return (e - Math.sign(e) * lo) / scene.sideMax;
}

function sideCruise(scene, row, lat, v, top) {
  const f = scene.fighters,
    od = f[row + DF.OVERRIDE_DECEL],
    tm = f[row + DF.TYPE_MAX_SPEED],
    dec = tm ? (top / LOGIC_FPS / tm) * od : od,
    x = Math.sqrt(dec * 2 * Math.abs(lat * scene.sideMax)) * LOGIC_FPS,
    cap = Math.min(x + v, top),
    s = Math.sqrt(lat * lat + 1),
    k = 1 / s,
    l = k * lat;
  v /= k;
  if (l > 0 && cap / l <= v) v = cap / l;
  return clamp(v, 0, top);
}

function matchSpeed(scene, row, lead, sq, v, lo, hi) {
  const f = scene.fighters,
    s = scene.squads,
    tol = s[sq + DS.TOLERANCE];
  if (Math.abs(s[sq + DS.ERR]) <= tol) return v;
  const l0 = Math.min(lo, hi),
    h0 = Math.max(l0, hi),
    p = f[lead + DF.PITCH] || 0,
    c = Math.cos(f[lead + DF.HEADING]),
    sn = Math.sin(f[lead + DF.HEADING]),
    dz = s[sq + DS.STACKED] ? f[lead + DF.SLOT_Z] - f[row + DF.SLOT_Z] : 0;
  const along =
    Math.cos(p) *
      (c * (f[row + DF.X] - f[lead + DF.X]) + sn * (f[row + DF.Y] - f[lead + DF.Y]) + f[lead + DF.SLOT_X] - f[row + DF.SLOT_X]) +
    Math.sin(p) * (f[row + DF.Z] - f[lead + DF.Z] + dz);
  const sp = f[row + DF.SPEED],
    thr = f[row + DF.THRUST] || f[row + DF.ACCEL];
  if (along > tol) {
    const a = Math.min(l0, sp),
      dDec = (v * v - a * a) / (2 * thr);
    if (dDec <= 0) return l0;
    const k = clamp(along / dDec, 0, 1);
    return (1 - k) * f[lead + DF.SPEED] + k * l0;
  }
  if (along < -tol) {
    const b = Math.max(h0, sp),
      dAcc = (b * b - v * v) / (2 * thr);
    if (dAcc <= 0) return h0;
    // never past the upper speed: see World.matchSpeed
    const k = clamp(-along / dAcc, 0, 1);
    return (1 - k) * f[lead + DF.SPEED] + k * h0;
  }
  return v;
}

function decideFighter(scene, row, lead, sq) {
  const f = scene.fighters,
    s = scene.squads;
  const isLead = row === lead,
    mode = s[sq + DS.MODE],
    own = f[row + DF.OWN];
  const top = (mode === MODE.MOVE ? s[sq + DS.SPEED] : f[row + DF.MAX_SPEED]) * own,
    low = f[row + DF.MIN_SPEED] * own;
  const tgt = mode === MODE.COMBAT ? s[sq + DS.TARGET] : TARGET.NONE;
  const x = f[row + DF.X],
    y = f[row + DF.Y],
    heading = f[row + DF.HEADING],
    speed = f[row + DF.SPEED],
    turnRate = f[row + DF.TURN_RATE];
  let gx = 0,
    gy = 0,
    gz = NaN,
    want = top,
    k = 1,
    form = !isLead,
    fire = FIRE.NONE;
  if (tgt && s[sq + DS.APPROACH]) {
    form = false;
    gx = s[sq + DS.AIM_X];
    gy = s[sq + DS.AIM_Y];
    gz = s[sq + DS.AIM_Z];
    fire = FIRE.TARGET;
  } else if (tgt) {
    fire = FIRE.TARGET;
    gz = s[sq + DS.AIM_Z] + (!isLead && s[sq + DS.STACKED] ? f[row + DF.SLOT_Z] - f[lead + DF.SLOT_Z] : 0);
    if (!form) {
      if (s[sq + DS.RUN_IN]) {
        gx = s[sq + DS.AIM_X];
        gy = s[sq + DS.AIM_Y];
      } else {
        const a = speed / Math.max(0.1, turnRate);
        gx = x + Math.cos(heading) * a;
        gy = y + Math.sin(heading) * a;
      }
    }
  } else if (mode === MODE.MOVE && !form) {
    const cruise = s[sq + DS.CRUISE];
    want = (cruise === cruise && cruise < top ? cruise : top) * s[sq + DS.PACE];
    if (s[sq + DS.ROUTED]) {
      const lat = sideError(scene, x, y, sq);
      if (lat) want = sideCruise(scene, row, lat, want, top);
      const R = Math.max(want, speed) / Math.max(0.1, turnRate);
      gx = x + s[sq + DS.ROUTE_DX] * R - lat * s[sq + DS.ROUTE_DY];
      gy = y + s[sq + DS.ROUTE_DY] * R + lat * s[sq + DS.ROUTE_DX];
    } else {
      gx = s[sq + DS.GOAL_X];
      gy = s[sq + DS.GOAL_Y];
    }
  } else if (mode === MODE.IDLE && !form) {
    const cx = s[sq + DS.HAS_ABOUT] ? s[sq + DS.ABOUT_X] : x,
      cy = s[sq + DS.HAS_ABOUT] ? s[sq + DS.ABOUT_Y] : y,
      d = Math.hypot(x - cx, y - cy);
    if (d < 10) {
      gx = x + Math.cos(heading) * 50;
      gy = y + Math.sin(heading) * 50;
    } else {
      gx = cx;
      gy = cy;
    }
    want = top;
  }
  if (mode === MODE.IDLE && !tgt) {
    const lx = f[lead + DF.X],
      ly = f[lead + DF.Y],
      cx = s[sq + DS.HAS_ABOUT] ? s[sq + DS.ABOUT_X] : lx,
      cy = s[sq + DS.HAS_ABOUT] ? s[sq + DS.ABOUT_Y] : ly,
      m = Math.max(1, Math.hypot(lx - cx, ly - cy));
    if (!isLead) {
      form = false;
      const lh = f[lead + DF.HEADING],
        ch = Math.cos(lh),
        sh = Math.sin(lh),
        ox = f[row + DF.SLOT_X] - f[lead + DF.SLOT_X],
        oy = f[row + DF.SLOT_Y] - f[lead + DF.SLOT_Y],
        ahead = ((f[lead + DF.SPEED] * Math.cos(f[lead + DF.PITCH] || 0)) / LOGIC_FPS) * 40;
      gx = lx + ch * ahead + 0.75 * (ch * ox - sh * oy);
      gy = ly + sh * ahead + 0.75 * (sh * ox + ch * oy);
    }
    // Same orbit as World.updateFighter: minimum speed on the tightest circle the fighter can turn.
    const orbit = low > 0 ? Math.max(60, (1.2 * low) / Math.max(0.1, turnRate)) : 60;
    if (m < orbit + 30) {
      form = false;
      let dx = x - cx,
        dy = y - cy;
      if (!dx && !dy) dx = 1;
      const nd = Math.hypot(dx, dy);
      if (isLead) {
        const a = Math.max(10 / nd, 0.5),
          ux = dx / nd,
          uy = dy / nd;
        gx = cx + orbit * (Math.cos(a) * ux - Math.sin(a) * uy);
        gy = cy + orbit * (Math.sin(a) * ux + Math.cos(a) * uy);
      }
      want = low > 0 ? low : (nd / m) * 0.5 * LOGIC_FPS;
    } else if (!isLead) want = low > 0 ? low : top;
    else {
      gx = cx;
      gy = cy;
      want = low > 0 ? low : top;
    }
  }
  if (form) {
    const lh = f[lead + DF.HEADING],
      ch = Math.cos(lh),
      sh = Math.sin(lh),
      ox = f[row + DF.SLOT_X] - f[lead + DF.SLOT_X],
      oy = f[row + DF.SLOT_Y] - f[lead + DF.SLOT_Y];
    const travel = s[sq + DS.TRAVEL],
      v = travel === travel ? travel : top,
      vm = matchSpeed(scene, row, lead, sq, v, v * 0.5, v * 1.5);
    want = vm;
    if (vm > top && top > 0) k = vm / top;
    const px = f[lead + DF.X] + ch * ox - sh * oy,
      py = f[lead + DF.Y] + sh * ox + ch * oy,
      ahead = Math.max(vm, speed) / Math.max(0.1, turnRate);
    gx = px + ch * ahead;
    gy = py + sh * ahead;
  } else if (isLead) s[sq + DS.TRAVEL] = want;
  if (s[sq + DS.DIRECT]) {
    const throttle = s[sq + DS.DIRECT_THROTTLE],
      pace = throttle > 0 ? top : throttle < 0 ? low : (top + low) / 2,
      h = f[lead + DF.HEADING] - clamp(s[sq + DS.DIRECT_TURN], -1, 1) * 1.2;
    if (!form) {
      gx = x + Math.cos(h) * 400;
      gy = y + Math.sin(h) * 400;
      want = pace;
    } else {
      const lh = f[lead + DF.HEADING],
        ch = Math.cos(lh),
        sh = Math.sin(lh),
        ox = f[row + DF.SLOT_X] - f[lead + DF.SLOT_X],
        oy = f[row + DF.SLOT_Y] - f[lead + DF.SLOT_Y];
      const px = f[lead + DF.X] + ch * ox - sh * oy,
        py = f[lead + DF.Y] + sh * ox + ch * oy,
        behind = (px - x) * ch + (py - y) * sh;
      gx = px + Math.cos(h) * 400;
      gy = py + Math.sin(h) * 400;
      want = pace * (1 + 0.5 * clamp(behind / 60, -1, 1));
    }
    fire = s[sq + DS.DIRECT_FIRING] ? FIRE.DIRECT : FIRE.NONE;
  } else if (!fire && s[sq + DS.FIRE_TARGET_ALIVE]) {
    if (mode !== MODE.IDLE || !s[sq + DS.ORDER_IDLE] || f[row + DF.FIRE_IDLE]) fire = FIRE.SQUAD_TARGET;
  }
  if (low > 0 && want < low) want = low;
  let wantIfHit = NaN;
  if (low > 0) wantIfHit = s[sq + DS.GUARDING_TARGET] ? Math.min(low, top * 0.5) : low;
  f[row + DF.GOAL_X] = gx;
  f[row + DF.GOAL_Y] = gy;
  f[row + DF.GOAL_Z] = gz;
  f[row + DF.GOAL_Z_DEFAULT] = gz !== gz ? f[row + DF.GZ_BASE] : gz;
  f[row + DF.WANT] = want;
  f[row + DF.WANT_IF_HIT] = wantIfHit;
  f[row + DF.TURN_FACTOR] = k;
  f[row + DF.LOOP_ALLOWED] = mode === MODE.IDLE && !tgt ? 0 : 1;
  f[row + DF.FIRE] = fire;
  f[row + DF.ATTACKING] = tgt ? 1 : 0;
}

// Decides every fighter of squadron `index`, leader first.
export function decideSquad(scene, index) {
  const sq = index * DS.STRIDE,
    s = scene.squads,
    first = s[sq + DS.FIRST],
    count = s[sq + DS.COUNT],
    lead = first * DF.STRIDE;
  for (let i = 0; i < count; i++) decideFighter(scene, (first + i) * DF.STRIDE, lead, sq);
}
