import { db } from '../gamedata.js';
import { getModelData } from '../model.js';
import { visibleExtentsOf } from './collmesh.js';

const FPS = 30;
const DEG = Math.PI / 180;
const random = (low, high) => low + Math.random() * (high - low);
const randomInt = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
const sign = () => (Math.random() < 0.5 ? -1 : 1);
const NO_PASS_ALTERNATIVE = new Set(['NEBULON_B_FRIGATE', 'ALLIANCE_ASSAULT_FRIGATE']);

export function unitExtents(unit) {
  const type = unit.type;
  if (!type._cinematicExtents) {
    const data = getModelData(type.str('Space_Model_Name')),
      box = data ? visibleExtentsOf(data) : null,
      fallback = unit.visualRadius || unit.radius || 50;
    type._cinematicExtents = box && Math.max(...box) > 1 ? [Math.abs(box[0]), Math.abs(box[1]), Math.abs(box[2])] : [fallback, fallback, fallback * 0.5];
  }
  const scale = unit.scale || 1,
    extents = type._cinematicExtents;
  return [extents[0] * scale, extents[1] * scale, extents[2] * scale];
}

function sizeFactor(length) {
  const t = Math.min(1, Math.max(0, (length - 30) / 470));
  return t * t * (3 - 2 * t);
}

function easeProgress(t, easeIn, easeOut) {
  t = Math.min(1, Math.max(0, t));
  const a = Math.max(0, easeIn),
    b = Math.max(0, easeOut);
  if (a + b <= 0) return t;
  const peak = 1 / (1 - (a + b) / 2);
  if (t < a) return (peak * t * t) / (2 * a);
  if (t <= 1 - b) return peak * (a / 2 + (t - a));
  const left = 1 - t;
  return 1 - (peak * left * left) / (2 * b);
}

function modelToWorld(unit, heading, local, out) {
  const c = Math.cos(heading),
    s = Math.sin(heading),
    forward = -local[1],
    left = local[0];
  out.x = unit.x + c * forward - s * left;
  out.y = unit.y + s * forward + c * left;
  out.z = (unit.z || 0) + local[2];
  return out;
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function salient(game, candidate) {
  const type = candidate.type;
  if (candidate.dead || candidate.hyper || candidate.cloaked || candidate.isPad) return false;
  if (candidate.player?.id < 0) return false;
  if (!type.bool('Movie_Object', true) || !type.str('Space_Model_Name')) return false;
  if (type.categories?.().has('WALL')) return false;
  return game.cine.visible(candidate);
}

function scoreCandidates(game, list) {
  const constants = db.constants,
    weights = {
      size: constants.num('Saliency_Size', 1),
      power: constants.num('Saliency_Power', 1),
      x: constants.num('Saliency_X', 0.5),
      y: constants.num('Saliency_Y', 0.5),
      health: constants.num('Saliency_Health', 1),
      targets: constants.num('Saliency_Targets', 1.5),
      speed: constants.num('Saliency_Speed', 1)
    };
  const targeted = new Map();
  for (const unit of list) if (unit.target && !unit.target.dead) targeted.set(unit.target, (targeted.get(unit.target) || 0) + 1);
  const rows = list.map(unit => {
    const extents = unitExtents(unit);
    return {
      unit,
      size: extents[0] ** 2 + extents[1] ** 2 + extents[2] ** 2,
      power: unit.type.num('AI_Combat_Power', 0),
      x: unit.x,
      y: unit.y,
      health: unit.health,
      targets: targeted.get(unit) || 0,
      speed: unit.speed || 0
    };
  });
  const range = key => {
    let low = Infinity,
      high = -Infinity,
      sum = 0;
    for (const row of rows) {
      low = Math.min(low, row[key]);
      high = Math.max(high, row[key]);
      sum += row[key];
    }
    return { low, span: high - low, mean: sum / rows.length };
  };
  const ranges = Object.fromEntries(Object.keys(weights).map(key => [key, range(key)]));
  const norm = (key, value) => (ranges[key].span > 0 ? (value - ranges[key].low) / ranges[key].span : 0);
  const central = (key, value) => (ranges[key].span > 0 ? 1 - Math.abs(value - ranges[key].mean) / ranges[key].span : 1);
  for (const row of rows)
    row.score =
      weights.size * norm('size', row.size) +
      weights.power * norm('power', row.power) +
      weights.x * central('x', row.x) +
      weights.y * central('y', row.y) +
      weights.health * (1 - norm('health', row.health)) +
      weights.targets * norm('targets', row.targets) +
      weights.speed * norm('speed', row.speed);
  return rows.sort((a, b) => b.score - a.score).map(row => row.unit);
}

export function pickCinematicSubject(game, previous, first) {
  const world = game.world;
  if (first) {
    const own = world.units.filter(unit => unit.player === game.human && salient(game, unit));
    if (own.length) return own[Math.floor(Math.random() * own.length)];
  }
  if (previous && randomInt(0, 2) > 0) {
    const target = previous.target;
    if (target && !target.dead && target.type && salient(game, target)) return target;
  }
  const candidates = world.units.filter(unit => unit.isMobile && salient(game, unit));
  if (!candidates.length) return null;
  const ranked = scoreCandidates(game, candidates),
    top = Math.min(ranked.length - 1, 10);
  let pick = ranked[randomInt(0, top)];
  for (let attempt = 0; attempt < 8 && previous && (pick === previous || pick.type === previous.type); attempt++) pick = ranked[randomInt(0, top)];
  return pick;
}

function pathShot({ unit, duration, lag = 0.9, camera, look }) {
  return { unit, duration, lag, camera, look };
}

function orbitShot(unit, extents) {
  const length = Math.hypot(...extents),
    f = sizeFactor(length),
    direction = sign(),
    start = Math.random() < 0.5 ? 0 : Math.PI,
    period = 600 / FPS,
    duration = (90 + 180 * f) / FPS;
  return pathShot({
    unit,
    duration,
    camera: (t, out) => {
      const turn = direction * ((2 * Math.PI) / period) * duration * easeProgress(t / duration, 0.25, 0),
        angle = start + turn;
      out.x = unit.x + Math.cos(angle) * 2 * length;
      out.y = unit.y + Math.sin(angle) * 2 * length;
      out.z = (unit.z || 0) + 1.25 * extents[2];
    },
    look: (t, out) => modelToWorld(unit, unit.heading, [0, 0, 0], out)
  });
}

function passShot(unit, extents) {
  const length = Math.hypot(...extents),
    f = sizeFactor(length);
  if (Math.random() < 0.5 && !NO_PASS_ALTERNATIVE.has(unit.type.name.toUpperCase())) {
    const duration = (1 + f) * 8,
      from = [0, -0.6 * extents[1], -extents[2]],
      to = [0, 3 * extents[1], -1.5 * extents[2]];
    return pathShot({
      unit,
      duration,
      camera: (t, out) => modelToWorld(unit, unit.heading, mix(from, to, easeProgress(t / duration, 0.1, 0)), out),
      look: (t, out) => modelToWorld(unit, unit.heading, [0, -6 * extents[1], 0], out)
    });
  }
  const side = sign(),
    frozen = unit.heading,
    duration = 3 + 4 * f,
    from = [2 * extents[0], 2 * side * extents[1], 2 * extents[2]],
    to = [2 * extents[0], -2 * side * extents[1], 2 * extents[2]];
  return pathShot({
    unit,
    duration,
    camera: (t, out) => modelToWorld(unit, frozen, mix(from, to, easeProgress(t / duration, 0.25, 0.25)), out),
    look: (t, out) => modelToWorld(unit, unit.heading, [0, 0, 0], out)
  });
}

function fighterShot(unit, extents) {
  const length = Math.hypot(...extents),
    theta = (Math.random() < 0.5 ? random(-45, 45) : random(135, 225)) * DEG,
    c = Math.cos(theta),
    s = Math.sin(theta);
  let from, to, duration;
  if (Math.random() < 0.5) {
    duration = randomInt(2, 4);
    from = [6 * length * c, sign() * Math.random() * length, 6 * length * s];
    to = [6 * length * c, sign() * Math.random() * length, 6 * length * s];
  } else {
    duration = 4;
    const reach = Math.random() * length;
    from = [3 * length * c, -reach, 3 * length * s];
    to = [3 * length * c, reach, 3 * length * s];
  }
  return pathShot({
    unit,
    duration,
    lag: 0.99,
    camera: (t, out) => modelToWorld(unit, unit.heading, mix(from, to, easeProgress(t / duration, 0.1, 0)), out),
    look: (t, out) => modelToWorld(unit, unit.heading, [0, 0, 0], out)
  });
}

function flybyShot(unit, extents) {
  const length = Math.hypot(...extents),
    azimuth = random(0, 360) * DEG,
    elevation = random(20, 45) * DEG * sign(),
    distance = random(2 * length, 4 * length),
    centre = { x: unit.x, y: unit.y, z: unit.z || 0 },
    camera = {
      x: centre.x + distance * Math.cos(elevation) * Math.cos(azimuth),
      y: centre.y + distance * Math.cos(elevation) * Math.sin(azimuth),
      z: centre.z + distance * Math.sin(elevation)
    };
  return pathShot({
    unit,
    duration: 60 / FPS,
    lag: 0,
    camera: (t, out) => Object.assign(out, camera),
    look: (t, out) => Object.assign(out, centre)
  });
}

function targetInFront(unit) {
  const target = unit.target;
  if (!target || target.dead) return null;
  const dx = target.x - unit.x,
    dy = target.y - unit.y;
  if (Math.hypot(dx, dy) <= 80) return null;
  return dx * Math.cos(unit.heading) + dy * Math.sin(unit.heading) > 0 ? target : null;
}

function frigateShot(unit, extents) {
  const largest = Math.max(extents[0], extents[2]),
    hold = randomInt(90, 120) / FPS,
    start = [0, randomInt(5, 10) * extents[1], randomInt(1, 7) * largest],
    target = targetInFront(unit);
  if (!target) {
    const end = [0, 0, largest],
      ahead = [0, -5 * random(1, 2) * extents[1], 0];
    return pathShot({
      unit,
      duration: hold,
      camera: (t, out) => modelToWorld(unit, unit.heading, mix(start, end, easeProgress(t / hold, 0, 0.25)), out),
      look: (t, out) => modelToWorld(unit, unit.heading, mix([0, 0, 0], ahead, Math.min(1, t / hold)), out)
    });
  }
  const targetExtents = unitExtents(target),
    onTarget = [0, -1.5 * targetExtents[1], 2 * targetExtents[2]],
    from = { x: 0, y: 0, z: 0 },
    to = { x: 0, y: 0, z: 0 };
  return pathShot({
    unit,
    duration: 2 * hold,
    camera: (t, out) => {
      if (t < hold) return modelToWorld(unit, unit.heading, start, out);
      modelToWorld(unit, unit.heading, start, from);
      modelToWorld(target, target.heading, onTarget, to);
      const k = easeProgress((t - hold) / hold, 0, 0.5);
      out.x = from.x + (to.x - from.x) * k;
      out.y = from.y + (to.y - from.y) * k;
      out.z = from.z + (to.z - from.z) * k;
    },
    look: (t, out) => {
      const k = Math.min(1, Math.max(0, (t - hold) / hold));
      out.x = unit.x + (target.x - unit.x) * k;
      out.y = unit.y + (target.y - unit.y) * k;
      out.z = (unit.z || 0) + ((target.z || 0) - (unit.z || 0)) * k;
    }
  });
}

function stationShot(unit, extents) {
  const hold = randomInt(60, 90) / FPS,
    sideX = sign(),
    sideY = sign(),
    from = [sideX * extents[0], sideY * extents[1], 2 * extents[2]],
    to = [2 * sideX * extents[0], 2 * sideY * extents[1], 3 * extents[2]],
    target = unit.target && !unit.target.dead ? unit.target : null;
  return pathShot({
    unit,
    duration: target ? 2 * hold : hold,
    camera: (t, out) => modelToWorld(unit, unit.heading, mix(from, to, easeProgress(t / hold, 0.25, 0.25)), out),
    look: (t, out) => {
      const k = target ? Math.min(1, Math.max(0, (t - hold) / hold)) : 0;
      out.x = unit.x + ((target?.x ?? unit.x) - unit.x) * k;
      out.y = unit.y + ((target?.y ?? unit.y) - unit.y) * k;
      out.z = (unit.z || 0) + ((target?.z ?? unit.z ?? 0) - (unit.z || 0)) * k;
    }
  });
}

function hardpointShot(game, unit, hardpoint) {
  const target = hardpoint.target;
  if (!target || target.dead || !game.cine.visible(target)) return null;
  const point = { x: 0, y: 0, z: 0 };
  return pathShot({
    unit,
    duration: randomInt(120, 180) / FPS,
    camera: (t, out) => {
      hardpoint.worldPos(point);
      out.x = point.x;
      out.y = point.y;
      out.z = point.z + 200;
    },
    look: (t, out) => {
      out.x = target.x;
      out.y = target.y;
      out.z = target.z || 0;
    }
  });
}

export function cinematicShot(game, unit) {
  const extents = unitExtents(unit),
    categories = unit.type.categories(),
    liveHardpoints = unit.hardpoints?.filter(h => h.alive && h.isWeapon) || [];
  if (liveHardpoints.length && randomInt(0, 2) > 0) {
    const shot = hardpointShot(game, unit, liveHardpoints[Math.floor(Math.random() * liveHardpoints.length)]);
    if (shot) return shot;
  }
  if (categories.has('FIGHTER')) return fighterShot(unit, extents);
  if (randomInt(0, 3) === 0) return flybyShot(unit, extents);
  if (categories.has('BOMBER') || categories.has('CORVETTE')) return Math.random() < 0.5 ? frigateShot(unit, extents) : fighterShot(unit, extents);
  if (categories.has('FRIGATE')) return frigateShot(unit, extents);
  if (!unit.isMobile) return stationShot(unit, extents);
  return Math.random() < 0.5 ? orbitShot(unit, extents) : passShot(unit, extents);
}
