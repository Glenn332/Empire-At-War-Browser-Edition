import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const archive = openGame(gameDir);
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { LandWorld } = await import('../public/js/game/land.js');

// Land fog buckets eyes into a grid; the result must match testing every enemy against every eye.
let seed = 7;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
const size = 257,
  heights = new Float32Array(size * size);
for (let i = 0; i < heights.length; i++) heights[i] = 40 * Math.sin(i * 0.013) * Math.cos(i * 0.0007) + rnd() * 20;
const trooper = db.type('Stormtrooper'),
  rebel = db.type('Rebel_Infantry') || trooper,
  sides = [trooper, rebel, trooper];

function world(n) {
  const w = Object.assign(Object.create(LandWorld.prototype), {
    team: [0, 1, 0],
    time: 1,
    units: [],
    points: [],
    shots: [],
    pings: [{ side: 1, x: 2500, y: 2500, r: 400 }],
    reveals: [{ until: 1e9, team: { id: 0 }, x: 4000, y: 1000, r: 3000 }],
    revealUntil: [0, 0, 0],
    fowOn: true,
    terrain: { size, heights },
    map: { playMin: [0, 0], playMax: [5000, 5000] },
    sightMod: () => 1,
    markViewCells() {}
  });
  for (let s = 0; s < 3; s++)
    for (let i = 0; i < n; i++)
      w.units.push({
        side: s,
        type: sides[s],
        sight: 100 + rnd() * 700,
        x: rnd() * 5000,
        y: rnd() * 5000,
        z: rnd() * 30,
        aimZ: 10,
        flies: rnd() < 0.1,
        cloaked: rnd() < 0.05,
        dead: false
      });
  w.points.push({ side: 2, x: 600, y: 4400, z: 0, sight: 900 }, { side: 1, x: -50, y: 300, z: 0, sight: Infinity });
  return w;
}

function reference(w, T, ally) {
  const eyes = [];
  for (const u of w.units)
    if (!u.dead && ally(u.side)) eyes.push([u.x, u.y, (u.sight * (u.structure ? 1 : w.sightMod(u))) ** 2, u.z + Math.max(8, u.aimZ * 1.5)]);
  for (const p of w.points) if (p.side >= 0 && ally(p.side)) eyes.push([p.x, p.y, p.sight ** 2, p.z + 30]);
  for (const p of w.pings) if (ally(p.side)) eyes.push([p.x, p.y, p.r ** 2, 1e6]);
  for (const r of w.reveals) if (r.until > w.time && r.team.id === T) eyes.push([r.x, r.y, r.r * r.r, 1e6]);
  const out = new Set();
  for (const u of w.units) {
    if (u.dead || ally(u.side) || u.cloaked) continue;
    if (eyes.some(e => (u.x - e[0]) ** 2 + (u.y - e[1]) ** 2 <= e[2] && (u.flies || w.sightLine(e[0], e[1], e[3], u)))) out.add(u);
  }
  return out;
}

for (let round = 0; round < 4; round++) {
  const w = world(120);
  w.teamSight();
  for (const T of [0, 1]) {
    const want = reference(w, T, s => w.team[s] === T);
    const got = new Set(w.units.filter(u => u.vis?.get(T)?.at === w.time));
    assert.equal(got.size, want.size, `team ${T} sees the same number of units`);
    for (const u of want) assert(got.has(u), 'team sight matches brute force');
  }
  for (const side of [0, 1]) {
    w.updateSight(side);
    const want = reference(w, w.team[side], s => w.ally(s, side));
    for (const u of w.units) if (!w.ally(u.side, side)) assert.equal(u.seen, want.has(u), 'viewer sight matches brute force');
  }
  const before = w.units.find(u => u.vis?.get(0));
  const rec = before.vis.get(0);
  w.time += 1;
  w.teamSight();
  if (before.vis.get(0).at === w.time) assert.equal(before.vis.get(0), rec, 'sight records are reused between passes');
}

if (process.env.BENCH) {
  for (const n of [150, 300, 600]) {
    const w = world(n);
    // Two armies that mostly cannot see each other, as in a battle's opening.
    for (const u of w.units) {
      u.x = (w.team[u.side] ? 3000 : 1000) + rnd() * 800;
      u.sight = 150 + rnd() * 250;
      u.flies = u.cloaked = false;
    }
    w.reveals.length = 0;
    for (let i = 0; i < 5; i++) {
      w.time += 1;
      w.teamSight();
    }
    let t = performance.now();
    for (let i = 0; i < 100; i++) {
      w.time += 1;
      w.teamSight();
    }
    const a = (performance.now() - t) / 100;
    t = performance.now();
    for (let i = 0; i < 100; i++) w.updateSight(0);
    console.log(`units/side ${n}: teamSight ${a.toFixed(2)} ms, updateSight ${((performance.now() - t) / 100).toFixed(2)} ms`);
  }
}
console.log('land sight grid ok');
