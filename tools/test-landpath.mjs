import assert from 'node:assert/strict';
import { LandPaths } from '../public/js/game/landpath.js';
import { TERRAIN } from '../public/js/game/landtables.js';

const C = 20,
  OPEN = TERRAIN.CLEAR,
  MASK = TERRAIN.CLEAR | TERRAIN.SHIELD;

function field(n, wall = () => false) {
  const kind = new Uint16Array(n * n),
    open = new Uint8Array(n * n).fill(1);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) kind[y * n + x] = wall(x, y) ? TERRAIN.OBSTACLE : OPEN;
  const w = { n, kind, open, groundVer: 0, map: { playMin: [0, 0], playMax: [(n - 1) * C, (n - 1) * C] } };
  return { w, P: new LandPaths(w) };
}
const length = (a, way) => {
  let L = 0,
    p = a;
  for (const q of way) {
    L += Math.hypot(q.x - p.x, q.y - p.y);
    p = q;
  }
  return L;
};

{
  const { P } = field(60, x => x === 30);
  assert.equal(P.route(200, 600, 900, 600, MASK), null, 'a goal in another zone fails before any search');
  const g = P.zoneGoal(200, 600, 900, 600, MASK);
  assert(g, 'the goal moves into the mover zone');
  assert.equal(g.x, 580, 'first ring with a cell of the mover zone, nearest to the mover');
  assert.equal(g.y, 600);
  assert.equal(P.zoneGoal(200, 600, 220, 600, MASK).x, 220, 'a goal in the mover zone stays where it is');
  assert(P.route(200, 600, g.x, g.y, MASK));
}

{
  const { P } = field(80, x => x >= 30 && x <= 79);
  assert.equal(P.zoneGoal(100, 100, 1400, 800, MASK), null, 'nothing of the mover zone within 29 rings: the move fails');
}

{
  const { P } = field(60, (x, y) => x === 30 && y !== 10 && !(y >= 17 && y <= 23));
  const a = { x: 400, y: 260 },
    plain = P.route(a.x, a.y, 800, 260, MASK),
    wide = P.route(a.x, a.y, 800, 260, MASK, 60);
  assert(plain && wide, 'a clearance search still finds a way through');
  P.mask = MASK;
  let p = a;
  for (const q of wide) {
    assert(P.line(p, q), 'every leg of the clearance way is open');
    p = q;
  }
  assert.equal(p.x, 800);
}

{
  const { P } = field(60);
  const at = (x, y) => (Math.hypot(x - 600, y - 600) < 200 ? 50 : 0),
    a = { x: 200, y: 600 },
    plain = P.route(a.x, a.y, 1000, 600, MASK),
    safe = P.route(a.x, a.y, 1000, 600, MASK, 0, { danger: { at, threshold: 0.01, weight: 1 } });
  assert(plain && safe);
  const near = way => {
    let best = Infinity,
      p = a;
    for (const q of way) {
      for (let t = 0; t <= 1; t += 0.05) best = Math.min(best, Math.hypot(p.x + (q.x - p.x) * t - 600, p.y + (q.y - p.y) * t - 600));
      p = q;
    }
    return best;
  };
  assert(near(plain) < 50, 'without the danger option the way goes straight through');
  assert(near(safe) >= 180, 'the danger cost keeps the way out of the threatened ground');
}

{
  const { LandWorld } = await import('../public/js/game/land.js');
  const n = 10,
    W = Object.create(LandWorld.prototype);
  Object.assign(W, {
    n,
    kind: new Uint16Array(n * n).fill(OPEN),
    occ: new Map(),
    groundVer: 0,
    roomDirty: true,
    time: 0
  });
  W.baseKind = W.kind.slice();
  W.kind[5] = W.baseKind[5] = TERRAIN.WATER;
  const a = [3, 4, 5],
    b = [4];
  W.occupy(a, a, TERRAIN.OBSTACLE);
  W.occupy(b, b, TERRAIN.REBELWALL);
  assert.equal(W.kind[3], TERRAIN.OBSTACLE, 'clear is dropped when an occupant sets a bit');
  assert.equal(W.kind[4], TERRAIN.OBSTACLE | TERRAIN.REBELWALL, 'occupant bits are joined');
  assert.equal(W.kind[5], TERRAIN.WATER | TERRAIN.OBSTACLE);
  W.vacate(a);
  assert.equal(W.kind[3], OPEN, 'the ground comes back when the occupant goes');
  assert.equal(W.kind[4], TERRAIN.REBELWALL, 'other occupants stay');
  assert.equal(W.kind[5], TERRAIN.WATER);
  W.vacate(b);
  assert.equal(W.kind[4], OPEN);
  const u = { x: 100, y: 100, dome: { r: 45 }, type: { str: k => (k === 'SecondaryOccupationPassability' ? ' Shield ' : '') } };
  W.shieldCover(u, true);
  const cov = u.dome.cover;
  assert(cov.length > 0 && cov.every(i => W.kind[i] === TERRAIN.SHIELD), 'a raised base shield puts shield on the cells it covers');
  W.shieldCover(u, false);
  assert(
    cov.every(i => W.kind[i] === OPEN),
    'and takes it off when it drops'
  );
}

{
  const { P } = field(160, (x, y) => (x % 16 === 8 && y % 20 < 14) || (y % 18 === 9 && x % 22 < 15));
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 3000 + 100;
  const pairs = Array.from({ length: 400 }, () => [rnd(), rnd(), rnd(), rnd()]);
  for (const [ax, ay, bx, by] of pairs.slice(0, 20)) P.route(ax, ay, bx, by, MASK, 30);
  for (const cl of [0, 30]) {
    const t0 = performance.now();
    let ok = 0;
    for (const [ax, ay, bx, by] of pairs) if (P.route(ax, ay, bx, by, MASK, cl)) ok++;
    const ms = (performance.now() - t0) / pairs.length;
    console.log(`route, clearance ${cl}: ${ms.toFixed(3)} ms a search (${ok}/${pairs.length} found)`);
  }
}

console.log('landpath ok');
