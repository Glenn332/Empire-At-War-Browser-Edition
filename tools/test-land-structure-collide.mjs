import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
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
const { tickCollisions, collides, resetCollideIds } = await import('../public/js/game/landcollide.js');

const N = 96;
function makeWorld() {
  resetCollideIds();
  const W = Object.assign(Object.create(LandWorld.prototype), {
    n: N,
    team: [0, 1],
    wild: 3,
    time: 1,
    units: [],
    squads: [],
    groups: [],
    colls: [],
    open: new Uint8Array(N * N).fill(1),
    kind: new Uint16Array(N * N).fill(TERRAIN.CLEAR),
    wet: new Uint8Array(N * N),
    masks: [0],
    roomOf: new Map(),
    openOf: new WeakMap(),
    groundVer: 0,
    tables: null,
    weather: { phases: [] },
    map: { playMin: [0, 0], playMax: [(N - 1) * CELL, (N - 1) * CELL] }
  });
  W.paths = new LandPaths(W);
  W.pursuit = () => 1;
  W.wxOf = () => ({ speed: 1 });
  return W;
}

function squadOf(W, name, side, x, y, structure = false) {
  const type = db.type(name);
  assert(type, name);
  const q = new LandSquad(W, type, side, structure ? { structure: true } : {});
  const u = landUnit({
    type,
    side,
    squad: q,
    x,
    y,
    z: 0,
    heading: 0,
    health: 100,
    maxHealth: 100,
    dead: false,
    inside: false,
    flies: false,
    structure,
    foot: false,
    need: 2,
    body: 15,
    speed: structure ? 0 : type.num('Max_Speed', 1) * 30,
    turn: 3,
    off: { x: 0, y: 0 },
    path: [],
    range: 200,
    mod: { speed: 1 }
  });
  q.members = [u];
  q.box = null;
  W.units.push(u);
  W.squads.push(q);
  return q;
}

function overlapOf(a, b) {
  return W0.overlap(
    { x: a.x, y: a.y, c: Math.cos(a.heading), s: Math.sin(a.heading), hx: a.hx, hy: a.hy },
    { x: b.x, y: b.y, c: Math.cos(b.heading), s: Math.sin(b.heading), hx: b.hx, hy: b.hy }
  );
}
const W0 = makeWorld();

function drive(W, u, frames) {
  for (let f = 0; f < frames && u.path.length; f++) {
    W.time += 1 / 30;
    tickCollisions(W);
    const p = u.path[0],
      dx = p.x - u.x,
      dy = p.y - u.y,
      d = Math.hypot(dx, dy),
      go = Math.min(d, Math.min(u.speed, u.ccCap ?? Infinity) / 30);
    if (d > 1e-6) u.heading = Math.atan2(dy, dx);
    u.v = go * 30;
    u.x += (dx / (d || 1)) * go;
    u.y += (dy / (d || 1)) * go;
    if (d < 2) u.path.shift();
    yield_(u);
  }
}
let track = null;
const yield_ = u => track && track(u);

{
  const W = makeWorld();
  const turret = squadOf(W, 'Empire_Anti_Vehicle_Turret', 1, 1000, 1000, true),
    t = turret.members[0];
  W.stamp(t);
  assert.equal(t.footprint.length, 0, 'a turret with no obstacle behaviour leaves the path grid open');
  assert.equal(W.kind[Math.round(1000 / CELL) * N + Math.round(1000 / CELL)], TERRAIN.CLEAR);
  const tank = squadOf(W, 'T2B_Tank', 0, 600, 1000),
    u = tank.members[0];
  assert(W.order(tank, 1400, 1000), 'ordered through the turret');
  assert(W.units.includes(t));
  tickCollisions(W);
  const B = t.cb,
    A = u.cb;
  assert(B && B.fixed, 'the turret takes part in the collision system as a standing body');
  assert(collides(W, A, B), 'a vehicle collides with a Vehicle class structure');
  let worst = 0,
    side = 0;
  track = v => {
    const o = overlapOf({ x: v.x, y: v.y, heading: v.heading, hx: A.hx, hy: A.hy }, { x: B.x, y: B.y, heading: B.h, hx: B.hx, hy: B.hy });
    worst = Math.max(worst, o);
    side = Math.max(side, Math.abs(v.y - 1000));
  };
  drive(W, u, 900);
  track = null;
  assert(Math.hypot(u.x - 1400, u.y - 1000) < 30, 'the tank gets to its goal: ' + u.x.toFixed(0) + ',' + u.y.toFixed(0));
  assert(side > B.hy, 'it stepped aside of the turret: ' + side.toFixed(1));
  assert(worst <= 0, 'the tank went round the turret, never into it (overlap ' + worst + ')');
}

{
  const W = makeWorld();
  const k = cls => ({ cls, fixed: true, u: { side: 1 } }),
    m = cls => ({ cls, fixed: false, u: { side: 0 } });
  assert(collides(W, m(5), k(2)) && !collides(W, m(7), k(2)), 'a low obstacle stops infantry only');
  assert(collides(W, m(8), k(3)) && !collides(W, m(9), k(3)), 'a medium obstacle stops all but giant vehicles');
  assert(collides(W, m(9), k(4)) && collides(W, m(6), k(4)), 'a high obstacle stops every mobile class');
  assert(!collides(W, k(7), k(7)), 'two standing structures never collide');
  assert(collides(W, m(7), k(1)) && !collides(W, { cls: 7, fixed: false, u: { side: 1 } }, k(1)), 'a build pad stops enemies only');
}

{
  const W = makeWorld();
  for (let y = 45; y <= 55; y++) for (let x = 45; x <= 55; x++) W.kind[y * N + x] = TERRAIN.OBSTACLE;
  const q = squadOf(W, 'T2B_Tank', 0, 50 * CELL, 50 * CELL),
    u = q.members[0];
  assert(W.order(q, 70 * CELL, 50 * CELL, null, true), 'an exit move is ordered from closed ground');
  assert.equal(u.path.length, 1, 'an exit move is one straight leg');
  assert(u.path[0].free && u.path[0].x === 70 * CELL, 'its leg skips the ground test and keeps the goal as given');
  assert(W.order(q, 52 * CELL, 50 * CELL, null, true), 'an exit move to closed ground');
  const g = u.path[0];
  assert(
    W.isOpen(g.x, g.y, 2) && Math.hypot(g.x - 52 * CELL, g.y - 50 * CELL) < 20 * 1.5 * 40,
    'the goal goes to the first open spot of the ring search'
  );
  const f = W.freeRing(54 * CELL, 50 * CELL, 30, 2);
  assert(
    f && W.isOpen(f.x, f.y, 2) && Math.hypot(f.x - 54 * CELL, f.y - 50 * CELL) < 4 * CELL,
    'a flier goal on closed ground goes to the first open point of the rings about it'
  );
  assert.deepEqual(W.freeRing(70 * CELL, 50 * CELL, 30, 2), { x: 70 * CELL, y: 50 * CELL }, 'an open goal is kept');
  u.path = [{ x: 70 * CELL, y: 50 * CELL }];
  W.blocked(u, u.path[0]);
  assert.equal(u.path.length, 0, 'a unit standing on closed ground whose next step is closed gives the move up');
  u.x = 43 * CELL;
  const end = { x: 80 * CELL, y: 50 * CELL };
  u.path = [end];
  u.detourAt = 0;
  assert(W.blocked(u, end), 'closed ground ahead on open ground: the collision way round is looked for');
  assert(u.path.length > 1 && u.path[u.path.length - 1] === end, 'the way round is put before the rest of the path');
  assert(
    u.path.slice(0, -1).every(p => p.round && W.isOpen(p.x, p.y, 2)),
    'the way round goes over open ground'
  );
  const side = Math.max(...u.path.map(p => Math.abs(p.y - 50 * CELL)));
  assert(side > 5 * CELL, 'it goes round the closed block: ' + (side / CELL).toFixed(1) + ' cells aside');
  const north = Math.sign(u.path[0].y - 50 * CELL),
    foe = squadOf(W, 'T2B_Tank', 1, 50 * CELL, 50 * CELL + north * 7.5 * CELL).members[0];
  foe.heading = 0;
  const widest = () => {
    tickCollisions(W);
    u.path = [end];
    u.detourAt = 0;
    W.blocked(u, end);
    return Math.max(...u.path.map(p => Math.abs(p.y - 50 * CELL)));
  };
  assert(widest() > 7.5 * CELL + 10, 'the way round keeps clear of an enemy standing on it');
  u.crusher = true;
  foe.squashable = true;
  assert(widest() <= 7.5 * CELL + 1, 'an enemy the mover crushes is left out of the way-round search');
  u.crusher = false;
  foe.dead = true;
  tickCollisions(W);
  for (let y = 0; y < N; y++) for (let x = 58; x <= 60; x++) W.kind[y * N + x] = TERRAIN.OBSTACLE;
  W.groundVer++;
  W.roomDirty = true;
  u.path = [end];
  u.detourAt = 0;
  W.blocked(u, end);
  assert.equal(u.path.length, 0, 'no way round closed ground: the move is given up, not tried again');
}

{
  const W = makeWorld();
  for (let y = 45; y <= 55; y++) for (let x = 45; x <= 55; x++) W.kind[y * N + x] = TERRAIN.OBSTACLE;
  W.terrain = { size: N, heights: new Float32Array(N * N) };
  const stub = { position: { set() {} } },
    made = [0, 1].map(k => squadOf(W, 'T2B_Tank', 0, 70 * CELL, (50 + k) * CELL));
  for (const q of made) q.members[0].holder = stub;
  const from = { x: 50 * CELL, y: 50 * CELL },
    exits = W.unloadGrid(made, 70 * CELL, 50 * CELL, 0, from);
  assert.equal(exits.length, 2, 'each unit coming out has an exit');
  for (const q of made) {
    const u = q.members[0];
    assert(u.x === from.x && u.y === from.y, 'a unit leaving a transport or spawner starts where it comes out');
  }
  W.walkOut(exits, 0);
  const goals = made.map(q => q.members[0].path);
  for (const p of goals) {
    assert(p.length === 1 && p[0].free, 'it walks out on one straight leg that skips the ground test');
    assert(W.isOpen(p[0].x, p[0].y, 2) && Math.hypot(p[0].x - 70 * CELL, p[0].y - 50 * CELL) < 10 * CELL, 'to its place by the exit point');
  }
  assert(Math.hypot(goals[0][0].x - goals[1][0].x, goals[0][0].y - goals[1][0].y) > 20, 'the units get places of their own');
  const flier = squadOf(W, 'T2B_Tank', 0, 70 * CELL, 50 * CELL);
  flier.members[0].holder = stub;
  flier.members[0].flies = true;
  assert.equal(W.unloadGrid([flier], 70 * CELL, 50 * CELL, 0, from).length, 0, 'fliers are put in place');
}

console.log('ok exit moves, closed ground, structures as standing bodies of the collision system');
