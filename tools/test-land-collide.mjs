import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { LandWorld, LandSquad, landUnit } = await import('../public/js/game/land.js');
const { LandPaths } = await import('../public/js/game/landpath.js');
const { TERRAIN } = await import('../public/js/game/landtables.js');
const { CELL } = await import('../public/js/game/terrain.js');
const { tickCollisions } = await import('../public/js/game/landcollide.js');

const CRAWLER = 'TIE_Crawler';
const N = 256;
function makeWorld(walls = []) {
  const W = Object.assign(Object.create(LandWorld.prototype), {
    n: N,
    team: [0, 1],
    wild: 3,
    time: 1,
    units: [],
    squads: [],
    groups: [],
    open: new Uint8Array(N * N).fill(1),
    kind: new Uint16Array(N * N).fill(TERRAIN.CLEAR),
    wet: new Uint8Array(N * N),
    masks: [0],
    roomOf: new Map(),
    openOf: new WeakMap(),
    groundVer: 0,
    tables: null,
    map: { playMin: [0, 0], playMax: [(N - 1) * CELL, (N - 1) * CELL] }
  });
  for (const [x0, y0, x1, y1] of walls) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) W.kind[y * N + x] = TERRAIN.OBSTACLE;
  W.paths = new LandPaths(W);
  W.paceOf = () => 1;
  W.attack = () => {};
  return W;
}

let ids = 0;
function unitOf(W, name, side, x, y, heading = 0) {
  const type = db.type(name);
  assert(type, name);
  const q = new LandSquad(W, type, side);
  q.id = ++ids;
  const foot = /INFANTRY/i.test(type.str('LandBehavior'));
  const u = landUnit({
    type,
    side,
    squad: q,
    x,
    y,
    z: 0,
    heading,
    health: 100,
    maxHealth: 100,
    dead: false,
    inside: false,
    flies: false,
    foot,
    need: foot ? 1 : 2,
    body: foot ? 5.5 : 15,
    speed: type.num('Max_Speed', 1) * 30,
    turn: 3,
    off: { x: 0, y: 0 },
    path: [],
    range: 200
  });
  q.members = [u];
  q.box = null;
  W.units.push(u);
  W.squads.push(q);
  return u;
}

function step(W, dt) {
  W.time += dt;
  let t = performance.now();
  tickCollisions(W);
  t = performance.now() - t;
  for (const u of W.units) {
    const p = u.path[0];
    u.v = 0;
    if (!p) continue;
    const dx = p.x - u.x,
      dy = p.y - u.y,
      d = Math.hypot(dx, dy);
    const v = Math.min(u.speed, u.ccCap ?? Infinity),
      go = Math.min(d, v * dt);
    if (d > 1e-6) u.heading = Math.atan2(dy, dx);
    u.x += d > 1e-6 ? (dx / d) * go : 0;
    u.y += d > 1e-6 ? (dy / d) * go : 0;
    u.v = go / dt;
    if (go >= d - 1e-6) u.path.shift();
  }
  return t;
}

function crossing(name, place) {
  const W = makeWorld(),
    all = [];
  for (let i = 0; i < 30; i++)
    for (const side of [0, 1]) {
      const p = place(i, side),
        u = unitOf(W, side ? CRAWLER : 'T2B_Tank', side, p.x, p.y, Math.atan2(p.ty - p.y, p.tx - p.x));
      u.path = [{ x: p.tx, y: p.ty }];
      u.from = p;
      all.push(u);
    }
  let total = 0,
    frames = 0,
    worst = 0;
  for (let f = 0; f < 1500 && all.some(u => u.path.length); f++) {
    const t = step(W, 1 / 30);
    total += t;
    worst = Math.max(worst, t);
    frames++;
  }
  const got = all.filter(u => !u.path.length).length,
    prog = all.reduce((s, u) => s + Math.hypot(u.x - u.from.x, u.y - u.from.y), 0) / all.length;
  console.log(
    name +
      ': ' +
      (total / frames).toFixed(3) +
      ' ms a collision step (worst ' +
      worst.toFixed(1) +
      ' over ' +
      frames +
      ' frames), ' +
      got +
      ' of 60 through, mean progress ' +
      prog.toFixed(0)
  );
  return got;
}

crossing('30 v 30 head on', (i, side) =>
  side
    ? { x: 3300 + (i % 6) * 70, y: 1520 + Math.floor(i / 6) * 70, tx: 1500 + (i % 6) * 70, ty: 1520 + Math.floor(i / 6) * 70 }
    : { x: 1500 + (i % 6) * 70, y: 1500 + Math.floor(i / 6) * 70, tx: 3300 + (i % 6) * 70, ty: 1500 + Math.floor(i / 6) * 70 }
);
const across = crossing('30 v 30 across', (i, side) =>
  side
    ? { x: 2300 + (i % 6) * 70, y: 1300 + Math.floor(i / 6) * 70, tx: 2300 + (i % 6) * 70, ty: 3300 + Math.floor(i / 6) * 70 }
    : { x: 1300 + Math.floor(i / 6) * 70, y: 2300 + (i % 6) * 70, tx: 3300 + Math.floor(i / 6) * 70, ty: 2300 + (i % 6) * 70 }
);
if (process.argv.includes('--bench')) process.exit(0);
void across;

{
  const W = makeWorld();
  const a = unitOf(W, 'T2B_Tank', 0, 1000, 1000, 0);
  a.v = 37;
  W.ccBodies = null;
  tickCollisions(W);
  assert.equal(a.cb.v, 37, 'the collision step reads the current speed as it is');
  a.v = 0;
  tickCollisions(W);
  assert.equal(a.cb.v, 0, 'not smoothed over earlier steps');
}

const reachOf = (b, dx, dy) => {
  const c = Math.cos(b.h) * dx + Math.sin(b.h) * dy;
  return (1 - c * c) * b.hy + c * c * b.hx;
};

{
  const W = makeWorld();
  const a = unitOf(W, 'T2B_Tank', 0, 2000, 2000, 0),
    b = unitOf(W, 'T2B_Tank', 0, 2008, 2002, 0);
  for (let f = 0; f < 8 && !a.path.length && !b.path.length; f++) step(W, 1 / 30);
  const M = a.path.length ? a : b,
    O = M === a ? b : a;
  assert(M.path.length, 'two tanks standing in each other: one moves off');
  const E = M.path[M.path.length - 1],
    half = M.cb.r + M.cb.spacing * 5,
    dx = O.x - E.x,
    dy = O.y - E.y,
    e = Math.hypot(dx, dy);
  assert(e >= half + reachOf(O.cb, dx / e, dy / e) - 1.01, 'the free spot keeps the footprint test of the ring search: ' + e.toFixed(1));
}

{
  const W = makeWorld();
  const a = unitOf(W, 'T2B_Tank', 0, 2000, 2000, 0),
    b = unitOf(W, 'T2B_Tank', 0, 2600, 2600, 0),
    c = unitOf(W, 'T2B_Tank', 0, 1920, 2000, 0);
  c.path = [{ x: 2400, y: 2000 }];
  for (let f = 0; f < 12 && !W.colls?.some(k => k.kind === 'ms' && k.a === c.cb && k.b === a.cb); f++) {
    W.time += 1 / 30;
    tickCollisions(W);
  }
  assert(
    W.colls.some(k => k.kind === 'ms' && k.a === c.cb && k.b === a.cb),
    'a tank driving at a standing one makes a moving against standing collision'
  );
  b.x = 2002;
  b.y = 1993;
  b.rooted = true;
  for (let f = 0; f < 8 && !a.path.length; f++) {
    W.time += 1 / 30;
    tickCollisions(W);
  }
  assert(a.path.length, 'the free tank moves off the rooted one');
  const E = a.path[a.path.length - 1],
    X = Math.max(c.cb.mpi, db.constants.num('LandPredictionTimeInterval', 2)),
    far = c.cb.max * Math.min(2 * X, X + 4),
    w = c.cb.hy + a.cb.r + 4;
  let x = c.x,
    y = c.y,
    gone = 0;
  for (const p of c.path) {
    const d = Math.hypot(p.x - x, p.y - y),
      ex = p.x - x,
      ey = p.y - y,
      top = Math.min(1, (far - gone) / d),
      k = Math.max(0, Math.min(top, ((E.x - x) * ex + (E.y - y) * ey) / (d * d)));
    assert(Math.hypot(x + ex * k - E.x, y + ey * k - E.y) >= w - 1e-6, 'the free spot is off the way of the unit coming at it');
    gone += d;
    if (gone >= far) break;
    x = p.x;
    y = p.y;
  }
}

{
  const W = makeWorld();
  const s = unitOf(W, 'T2B_Tank', 0, 1050, 2000, 0);
  s.path = [{ x: 1300, y: 2000 }];
  const past = db.constants.num('LandDestinationProximity', 60);
  for (let x = 1120; x <= 1300 + past + 80; x += 40) unitOf(W, 'T2B_Tank', 0, x, 2000, 0);
  for (let f = 0; f < 12 && !s.path.some(p => p.round); f++) {
    W.time += 1 / 30;
    tickCollisions(W);
  }
  const E = s.path[s.path.length - 1];
  assert(
    s.path.some(p => p.round),
    'a tank whose way ends inside a line of standing tanks still finds a way round'
  );
  assert(
    Math.abs(E.y - 2000) > 20 && E.x >= 1300 - 1e-6,
    'it rejoins at a free spot round the end of its path, ahead of it: ' + JSON.stringify(E)
  );
}

for (const [walker, still, parts] of [
  ['AT_AT_Walker', true, false],
  ['AT_AT_Walker', false, true],
  ['T2B_Tank', true, true]
]) {
  const W = makeWorld();
  const v = unitOf(W, walker, 0, 2000, 2000, 0),
    i = unitOf(W, 'Squad_Stormtrooper', 0, 2004, 2001, 0);
  v.rooted = true;
  if (!still) i.v = i.speed * 0.5;
  for (let f = 0; f < 8; f++) {
    W.time += 1 / 30;
    tickCollisions(W);
  }
  assert.equal(
    W.colls.some(k => k.kind === 'ss'),
    parts,
    walker + (still ? ' with a trooper standing in it: ' : ' with a trooper still going in it: ') + (parts ? 'they part' : 'no parting')
  );
}

for (const clash of [false, true]) {
  const W = makeWorld();
  const s = unitOf(W, 'AT_AT_Walker', 0, 1000, 2000, 0),
    t = unitOf(W, 'T2B_Tank', 0, 1090, 2000, 0),
    men = [];
  s.path = [{ x: 1500, y: 2000 }];
  t.rooted = true;
  for (let x = 1020; x <= 1180; x += 8)
    for (const y of [1970, 1960, 2030, 2040]) {
      const u = unitOf(W, 'Squad_Stormtrooper', 0, x, y, 0);
      u.rooted = true;
      if (clash) u.clash = {};
      men.push(u);
    }
  for (let f = 0; f < 12 && !s.path.some(p => p.round); f++) {
    W.time += 1 / 30;
    tickCollisions(W);
  }
  console.log(
    'dbg',
    clash,
    JSON.stringify(s.path.map(p => [Math.round(p.x), Math.round(p.y)])),
    JSON.stringify(W.colls.map(k => [k.kind, k.state]))
  );
  const way = [{ x: s.x, y: s.y }, ...s.path],
    through = men.some(u => way.some((p, k) => k && Math.abs(p.y - u.y) < 12 && p.x > u.x - 12 && p.x < u.x + 12));
  if (clash) assert(!through, 'troopers in a hero clash stay in the way of a giant going round');
  else
    assert(
      s.path.some(p => p.round),
      'a giant going round leaves troopers out of its search'
    );
}

{
  const W = makeWorld([
    [0, 0, N - 1, 97],
    [0, 103, N - 1, N - 1]
  ]);
  const attacks = [];
  W.attack = (a, b) => attacks.push([a, b]);
  const s = unitOf(W, 'T2B_Tank', 0, 1050, 2000, 0),
    b = unitOf(W, 'T2B_Tank', 1, 1300, 2000, 0);
  b.rooted = true;
  for (let x = 1340; x <= 2000; x += 40) {
    const f = unitOf(W, 'T2B_Tank', 1, x, 2000, 0);
    f.rooted = true;
  }
  s.path = [{ x: 1700, y: 2000 }];
  let seen = null;
  for (let f = 0; f < 120 && !seen; f++) {
    step(W, 1 / 30);
    seen = W.colls.find(k => k.kind === 'ms' && k.a === s.cb && k.b === b.cb && k.state !== undefined) || null;
    if (seen && seen.state !== 1 && seen.state !== 8) seen = null;
  }
  assert(seen && seen.state === 1 && !attacks.length, 'a vehicle blocked by an enemy goes round with enemies passable before it attacks');
}

console.log('ok land collisions');
