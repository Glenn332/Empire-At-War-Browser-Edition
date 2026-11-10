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
  for (const [x0, y0, x1, y1] of walls)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) W.kind[y * N + x] = TERRAIN.OBSTACLE;
  W.paths = new LandPaths(W);
  return W;
}

let ids = 0;
function squadOf(W, name, side, x, y, count = 1) {
  const type = db.type(name);
  assert(type, name);
  const q = new LandSquad(W, type, side);
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
  q.box = null;
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

console.log('ok placement');


