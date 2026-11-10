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
const N = 128;
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

{
  const W = makeWorld();
  const A = [],
    B = [];
  for (let i = 0; i < 30; i++) {
    const a = unitOf(W, 'T2B_Tank', 0, 1500 + (i % 6) * 70, 1500 + Math.floor(i / 6) * 70, 0);
    a.path = [{ x: a.x + 1800, y: a.y }];
    A.push(a);
    const b = unitOf(W, CRAWLER, 1, 3300 + (i % 6) * 70, 1520 + Math.floor(i / 6) * 70, Math.PI);
    b.path = [{ x: b.x - 1800, y: b.y }];
    B.push(b);
  }
  let total = 0,
    frames = 0;
  for (let f = 0; f < 1500; f++) {
    total += step(W, 1 / 30);
    frames++;
  }
  const ms = total / frames;
  const got = [...A, ...B].filter(u => !u.path.length).length;
  const prog = [...A.map(u => u.x - 1500), ...B.map(u => 3300 - u.x)].reduce((s, v) => s + v, 0) / 60;
  console.log(
    '30 v 30 crossing: ' +
      ms.toFixed(3) +
      ' ms a collision step, ' +
      got +
      ' of 60 through, mean progress ' +
      prog.toFixed(0) +
      ', states ' +
      JSON.stringify(W.colls.reduce((m, c) => ((m[c.kind + c.state] = (m[c.kind + c.state] || 0) + 1), m), {}))
  );
  if (process.argv.includes('--bench')) process.exit(0);
}

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

console.log('ok land collisions');
