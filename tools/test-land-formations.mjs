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

const N = 96;
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
  return W;
}

let ids = 0;
function squadOf(W, name, side, x, y, count = 1, member = null) {
  const type = db.type(member || name);
  assert(type, member || name);
  const q = new LandSquad(W, db.type(name), side);
  q.id = ++ids;
  const foot = /INFANTRY/i.test(type.str('LandBehavior'));
  q.members = [];
  for (let i = 0; i < count; i++) {
    const u = landUnit({
      type,
      side,
      squad: q,
      x: x + (i % 3) * 8,
      y: y + Math.floor(i / 3) * 8,
      z: 0,
      heading: 0,
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
    q.members.push(u);
    W.units.push(u);
  }
  q.box = member ? undefined : null;
  W.squads.push(q);
  return q;
}

{
  const W = makeWorld();
  const a = squadOf(W, 'T2B_Tank', 0, 400, 400),
    b = squadOf(W, 'T2B_Tank', 0, 440, 400),
    c = squadOf(W, 'T2B_Tank', 0, 480, 400);
  const at = W.places([a, b, c], 1200, 1200);
  assert.equal(at.size, 3, 'every squad of the group gets a place');
  const pts = [...at.values()];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      assert(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) > 15, 'formation places do not overlap');
  for (const p of pts) assert(Math.hypot(p.x - 1200, p.y - 1200) < 200, 'placed about the ordered point');
}

{
  const W = makeWorld([[50, 20, 52, 80]]);
  const a = squadOf(W, 'T2B_Tank', 0, 300, 1000),
    b = squadOf(W, 'T2B_Tank', 0, 340, 1000);
  const z0 = W.placeZone(300, 1000, 2),
    z1 = W.placeZone(1200, 1000, 2);
  assert(z0 >= 0 && z0 === z1, 'a wall with a way round leaves one zone');
  const at = W.places([a, b], 1100, 1000);
  for (const p of at.values()) assert(p.x > 52 * CELL + 10, 'no formation placed on the near side of the wall');
}

{
  const W = makeWorld([
    [40, 40, 60, 40],
    [40, 60, 60, 60],
    [40, 40, 40, 60],
    [60, 40, 60, 60]
  ]);
  const inside = W.placeZone(50 * CELL, 50 * CELL, 2),
    outside = W.placeZone(20 * CELL, 20 * CELL, 2);
  assert(inside >= 0 && outside >= 0 && inside !== outside, 'a closed ring is its own zone');
  const a = squadOf(W, 'T2B_Tank', 0, 300, 300),
    b = squadOf(W, 'T2B_Tank', 0, 340, 300);
  const at = W.places([a, b], 50 * CELL, 50 * CELL);
  for (const p of at.values()) assert.equal(W.placeZone(p.x, p.y, 2), inside, 'places stay in the zone of the ordered point');
}

{
  const W = makeWorld();
  const sit = squadOf(W, 'T2B_Tank', 0, 1000, 1000);
  sit.members[0].ccls = undefined;
  const a = squadOf(W, 'T2B_Tank', 0, 400, 400),
    b = squadOf(W, 'T2B_Tank', 0, 440, 400);
  const at = W.places([a, b], 1000, 1000);
  for (const p of at.values()) {
    const d = Math.hypot(p.x - 1000, p.y - 1000);
    assert(d > 20, 'a standing tank keeps its place: the formation boxes are put off it (' + d.toFixed(1) + ')');
  }
}

{
  const W = makeWorld();
  const q = squadOf(W, 'Imperial_Stormtrooper_Squad', 0, 600, 600, 6, 'Squad_Stormtrooper');
  const box = W.teamOf(q);
  assert(box, 'a stormtrooper team walks as a team');
  const u = q.members[0],
    hx = db.type('Squad_Stormtrooper').num('Custom_Hard_XExtent', 0) * db.type('Squad_Stormtrooper').num('Scale_Factor', 1);
  let lo = 0,
    hi = 0;
  for (const m of q.members) {
    const f = (m.x - box.x) * Math.cos(box.heading) + (m.y - box.y) * Math.sin(box.heading);
    lo = Math.min(lo, f - hx);
    hi = Math.max(hi, f + hx);
  }
  assert(Math.abs(box.hl - ((hi - lo) / 2 + box.jig)) < 1e-6, 'team half length is the box over its members plus the container jiggle');
  for (const m of q.members) {
    m.x = box.x;
    m.y = box.y;
  }
  W.teamExtent(q);
  assert(Math.abs(box.hl - (hx + box.jig)) < 1e-6 && box.hl < 4, 'no floor of 4 under a bunched team: ' + box.hl);
  const g = W.ground(q);
  assert.equal(g.hx, box.hl, 'a team formation box is its container box');
  assert(u.hardX === hx, 'unit hard extents are scaled by Scale_Factor');
}

{
  const W = makeWorld();
  const q = squadOf(W, 'Imperial_Stormtrooper_Squad', 0, 600, 600, 6, 'Squad_Stormtrooper');
  const box = W.teamOf(q);
  box.heading = 0;
  box.path = [{ x: 1800, y: box.y }];
  W.tickTeams(1 / 30);
  for (const u of q.members) {
    const k = Math.round((u.startAt - W.time) * 30);
    assert(k >= 0 && k <= 6 && Math.abs(k - (u.startAt - W.time) * 30) < 1e-6, 'a standing member starts 0 to 6 frames late: ' + k);
  }
  const lag = q.members[5];
  lag.x = box.x - 200;
  lag.stunUntil = 99;
  for (let i = 0; i < 20; i++) W.tickTeams(1 / 30);
  assert(box.speed < 1, 'the team holds for a member far behind, stunned or not: ' + box.speed);
  lag.x = box.x;
  for (let i = 0; i < 20; i++) W.tickTeams(1 / 30);
  assert(box.speed > 1, 'and goes on once he is with it');
  W.teamExtent(q);
  const L = box.hl;
  lag.x = box.x - 1000;
  W.teamExtent(q);
  assert(box.hl > L, 'the team box takes in the member behind');
}

{
  const W = makeWorld();
  const a = squadOf(W, 'T2B_Tank', 0, 400, 400),
    b = squadOf(W, 'T2B_Tank', 0, 400, 440);
  const at = W.places([a, b], 1600, 420);
  for (const q of [a, b]) {
    const p = at.get(q);
    assert(W.order(q, p.x, p.y, p.face), 'ordered');
  }
  const F = a.formMove;
  assert(F && b.formMove === F, 'the two tanks move as one formation');
  const base = F.speed;
  W.tickGroups(1 / 30);
  const ma = F.members.find(m => m.q === a),
    mb = F.members.find(m => m.q === b);
  const v0 = a.formSpeed.v;
  assert(Math.abs(a.formSpeed.v - b.formSpeed.v) < base * 0.5, 'side by side they go about the base speed');
  const ua = a.members[0];
  b.members[0].speed = base * 1.5;
  ua.x += 120;
  W.tickGroups(1 / 30);
  assert(ma.dev < 0 && mb.dev > 0, 'deviance: the one ahead negative, the one behind positive');
  assert(a.formSpeed.v < base, 'the one ahead slows: ' + a.formSpeed.v + ' < ' + base);
  assert(b.formSpeed.v > base, 'the one behind speeds up: ' + b.formSpeed.v + ' > ' + base);
  assert(b.formSpeed.v <= b.members[0].speed + 1e-9, 'never past its own top speed');
  assert(a.formSpeed.v >= 0.4 * base * 0.99, 'never below the floor of 0.4 of the base');
  for (const u of [...a.members, ...b.members]) assert(u.path.length, 'each member steers along the shared path');
  void v0;
  const ub = b.members[0];
  ua.x -= 120;
  ub.y += 40;
  W.tickGroups(1 / 30);
  assert(Math.abs(mb.err) > 20, 'side error read against the path');
  assert(b.formSpeed.v > a.formSpeed.v, 'a member off its line to the side goes faster to make it up');
}

console.log('ok placement, team box, team walk, formation speeds');
