// cluttered() answers "is this spot taken?" for every place a move or an attack tries. It reads the squads through
// flat per-cell lists that a search holds for its whole run (clutterHold); this checks its answers against the
// plain walk over the squads it replaced, with and without a held search, and after the units have moved.
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
const { LandWorld } = await import('../public/js/game/land.js');

let seed = 12345;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const world = Object.assign(Object.create(LandWorld.prototype), { team: [0, 1], wild: 3, time: 1, units: [], squads: [] });
const type = db.type('Stormtrooper');
for (let i = 0; i < 70; i++) {
  const q = { side: i % 2, members: [], box: null, ext: false },
    cx = rnd() * 700,
    cy = rnd() * 700,
    big = rnd() < 0.3;
  for (let k = 0, n = i % 9 === 8 ? 0 : 1 + Math.floor(rnd() * 9); k < n; k++)
    q.members.push({
      squad: q,
      side: q.side,
      type,
      x: cx + (rnd() - 0.5) * 60,
      y: cy + (rnd() - 0.5) * 60,
      heading: rnd() * 7 - 3.5,
      dead: rnd() < 0.08,
      inside: rnd() < 0.05,
      flies: rnd() < 0.05,
      ccls: rnd() < 0.1 ? 4 : 5 + Math.floor(rnd() * 3),
      hardX: big ? 14 + rnd() * 12 : 2 + rnd() * 3,
      hardY: big ? 8 + rnd() * 8 : 2 + rnd() * 3,
      crusher: rnd() < 0.15,
      supercrusher: rnd() < 0.05,
      squashable: rnd() < 0.5,
      squashableBig: rnd() < 0.2
    });
  if (rnd() < 0.5 && q.members.length) q.box = { x: cx, y: cy };
  world.squads.push(q);
}

// the walk cluttered() made before it kept packs: every squad of the grid cells in reach, member by member
function plain(px, py, hx, hy, c, s, sent, slots) {
  const CELL = 128,
    most = 0.15 * hx * hy,
    wide = Math.hypot(hx, hy) + db.constants.num('Destination_Collision_Query_Extension', 60);
  const mine = [];
  for (const q of sent) for (const u of q.members) if (!u.dead && !u.inside && !u.flies) mine.push(u);
  const boxes = (slots && slots.length ? slots : [{ x: 0, y: 0, hx, hy, q: null }]).map(b => ({
    x: px + c * b.x - s * b.y,
    y: py + s * b.x + c * b.y,
    c,
    s,
    hx: b.hx,
    hy: b.hy,
    q: b.q
  }));
  const crushed = (list, u) =>
    list.length > 0 &&
    list.every(v => v.dead || v.inside || (v.crusher && world.enemy(v, u) && (u.squashable || (v.supercrusher && u.squashableBig))));
  world.clutterFresh();
  const near = [],
    r = wide + 24;
  for (let cx = Math.floor((px - r) / CELL); cx <= Math.floor((px + r) / CELL); cx++)
    for (let cy = Math.floor((py - r) / CELL); cy <= Math.floor((py + r) / CELL); cy++)
      near.push(...(world.clutterGrid.get(cx * 4096 + cy) || []));
  let area = 0;
  for (const q of near) {
    if (!q.members.length || sent.includes(q)) continue;
    for (const u of q.members) {
      if (u.dead || u.inside || u.flies || u.ccls < 5) continue;
      if ((u.x - px) ** 2 + (u.y - py) ** 2 > wide * wide) continue;
      const ub = { x: u.x, y: u.y, c: Math.cos(u.heading), s: Math.sin(u.heading), hx: u.hardX, hy: u.hardY };
      let hit = false;
      for (const b of boxes) {
        if (world.overlap(b, ub) <= 0 || crushed(b.q ? b.q.members : mine, u)) continue;
        hit = true;
        break;
      }
      if (!hit) continue;
      area += u.hardX * u.hardY;
      if (area > most) return true;
    }
  }
  return false;
}

const count = { spots: 0, taken: 0 };
function ask() {
  const px = rnd() * 760 - 30,
    py = rnd() * 760 - 30,
    hx = 4 + rnd() * 40,
    hy = 4 + rnd() * 30,
    face = rnd() * 7 - 3.5,
    c = Math.cos(face),
    s = Math.sin(face),
    live = world.squads.filter(q => q.members.length),
    pick = () => live[Math.floor(rnd() * live.length)],
    sent = Array.from({ length: rnd() < 0.5 ? 1 : 7 }, pick),
    slots = rnd() < 0.3 ? sent.slice(0, 3).map((q, i) => ({ x: (i - 1) * 20, y: (i - 1) * 6, hx: hx / 2, hy: hy / 2, q })) : null;
  const want = plain(px, py, hx, hy, c, s, sent, slots),
    got = world.cluttered(px, py, hx, hy, c, s, 1, sent, slots);
  assert.equal(got, want, `spot ${count.spots} at ${px.toFixed(1)}, ${py.toFixed(1)}: ${got} where the plain walk says ${want}`);
  count.spots++;
  if (want) count.taken++;
}
const shuffle = () => {
  for (const q of world.squads)
    for (const u of q.members) {
      u.x += (rnd() - 0.5) * 80;
      u.y += (rnd() - 0.5) * 80;
      u.heading += rnd() - 0.5;
      if (rnd() < 0.03) u.dead = !u.dead;
    }
};

for (let i = 0; i < 400; i++) ask();
// a held search: the members are read once and every spot is tested against that reading
for (let round = 0; round < 6; round++) {
  // moved since the last question: a search that starts now reads the members where they stand now
  shuffle();
  const held = world.clutterHold();
  assert.equal(held, false);
  const inner = world.clutterHold();
  assert.equal(inner, true, 'a search inside a search keeps the outer reading');
  for (let i = 0; i < 150; i++) ask();
  world.clutterFree(inner);
  assert.equal(world.clutterHeld, true);
  for (let i = 0; i < 150; i++) ask();
  world.clutterFree(held);
  assert.equal(world.clutterHeld, false);
  // the units move within the tick (the grid stays as it was filled): the next search must read them again
  shuffle();
  for (let i = 0; i < 60; i++) ask();
  if (round % 2) world.time += 1 / 30;
}
// placeAnchors holds for its search and lets go when the search throws
assert.throws(() =>
  world.placeAnchors(100, 100, 1, () => {
    assert.equal(world.clutterHeld, true);
    throw new Error('stop');
  })
);
assert.equal(world.clutterHeld, false, 'a search that throws does not leave the reading held');
assert(
  count.taken > count.spots * 0.1 && count.taken < count.spots * 0.9,
  `both answers are exercised (${count.taken} of ${count.spots} taken)`
);
console.log(JSON.stringify({ checks: 'cluttered against the plain walk: unheld, held, nested, after moves, after a throw', ...count }));
