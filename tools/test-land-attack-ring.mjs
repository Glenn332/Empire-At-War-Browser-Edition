// attackGroup() gives the squads of a group attack their places on rings round the foe. It skips rings that cannot
// be filled and remembers the spots it has judged; this checks, on fields of obstacles and bystanders, that it
// still hands out the places, in the order, of the search that tried every ring and every spot (fullSearch below,
// the method as it was), that it fills the tick's clutter grid in the same cases, and that it asks far less.
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
const DEG = Math.PI / 180;

let seed = 2024;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const type = db.type('Stormtrooper');
let acts, asked, field;
const world = Object.assign(Object.create(LandWorld.prototype), { team: [0, 1], wild: 3, time: 1, units: [], squads: [] });
world.teamOf = () => null;
world.ground = q => q.g;
const turnTo = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
world.isOpen = (x, y) => {
  if (field.note) field.note(x, y);
  if (field.only) return (x - field.only.x) ** 2 + (y - field.only.y) ** 2 < 0.01;
  return (
    (!field.gap || turnTo(Math.atan2(y, x), field.gap.at) < field.gap.wide) &&
    !field.rocks.some(o => (x - o.x) ** 2 + (y - o.y) ** 2 < o.r * o.r)
  );
};
world.clear = (ax, ay, bx, by) => {
  for (let i = 0; i <= 8; i++) if (!world.isOpen(ax + ((bx - ax) * i) / 8, ay + ((by - ay) * i) / 8)) return false;
  return true;
};
// a way exists unless the spot lies behind the wall
world.route = (ax, ay, bx, by) => (asked++, field.wall !== null && by > field.wall ? null : [{ x: bx, y: by }]);
world.reaches = (ax, ay, bx, by) => world.route(ax, ay, bx, by) !== null;
world.attack = (q, foe) => acts.push(['attack', q.id, foe.id]);
world.order = (q, x, y, face) => acts.push(['order', q.id, x, y, face]);

// The search as it was: every count of squads on every ring, every spot judged anew.
function fullSearch(squads, foe) {
  const list = squads.filter(q => q.members.length && !q.structure);
  if (!foe || !foe.members.length) return;
  const tb = this.teamOf(foe),
    fm = foe.members;
  const T = tb && !foe.ext ? tb : { x: fm.reduce((a, u) => a + u.x, 0) / fm.length, y: fm.reduce((a, u) => a + u.y, 0) / fm.length };
  const edge = tb ? Math.max(6, tb.slack - 10) : fm[0].body || fm[0].hitRadius || 0,
    lone = db.constants.num('Solo_Attack_Range', 60);
  const all = list.map(q => this.ground(q)),
    cands = [];
  for (const g of all) {
    const d = Math.hypot(g.x - T.x, g.y - T.y),
      reach = Math.min(...g.q.members.map(u => u.range || 0));
    if (
      g.solo ||
      d <= reach + edge ||
      d < Math.hypot(g.hx, g.hy) + reach + lone ||
      g.q.members.some(u => u.flies || (u.needsDeploy && u.weapon))
    )
      this.attack(g.q, foe);
    else cands.push(g);
  }
  if (!cands.length) return;
  if (cands.length === 1) {
    this.attack(cands[0].q, foe);
    return;
  }
  const R = Math.min(...list.map(q => Math.min(...q.members.map(u => u.range || 0)))) + edge;
  const mx = cands.reduce((a, g) => a + g.x, 0) / cands.length,
    my = cands.reduce((a, g) => a + g.y, 0) / cands.length;
  const P = cands.reduce((a, g) => ((g.x - mx) ** 2 + (g.y - my) ** 2 < (a.x - mx) ** 2 + (a.y - my) ** 2 ? g : a));
  const dir = Math.atan2(P.y - T.y, P.x - T.x),
    c = Math.cos(dir),
    s = Math.sin(dir);
  cands.sort((a, b) => -(a.x - T.x) * s + (a.y - T.y) * c - (-(b.x - T.x) * s + (b.y - T.y) * c));
  const least = edge * 1.4;
  const ring = (set, r, half) => {
    const n = set.length,
      mid = n >> 1,
      out = new Array(n),
      FIVE = 5 * DEG;
    const at = (g, ang) => {
      const px = T.x + Math.cos(dir + ang) * r,
        py = T.y + Math.sin(dir + ang) * r;
      for (const o of out) if (o && (o.x - px) ** 2 + (o.y - py) ** 2 < ((o.g.hy + g.hy) * 0.9) ** 2) return null;
      if (
        !this.isOpen(px, py, g.need) ||
        this.cluttered(px, py, g.hx, g.hy, Math.cos(dir + ang + Math.PI), Math.sin(dir + ang + Math.PI), g.need, list)
      )
        return null;
      const stop = Math.max(0, r - edge - 10);
      if (!this.clear(px, py, px - Math.cos(dir + ang) * stop, py - Math.sin(dir + ang) * stop, 1)) return null;
      if (!this.route(g.x, g.y, px, py, g.need)) return null;
      return { g, x: px, y: py };
    };
    const step = (i, k) => Math.asin(Math.min(1, (set[i].hy + set[k].hy) / (2 * r)));
    let a = n & 1 ? 0 : 2 * Math.asin(Math.min(1, set[mid].hy / (2 * r)));
    for (; Math.abs(a) <= half && !(out[mid] = at(set[mid], a)); a = a === 0 ? FIVE : a > 0 ? -a : -a + FIVE);
    if (!out[mid]) return null;
    for (const way of [-1, 1]) {
      let cur = a;
      for (let k = mid + way; k >= 0 && k < n; k += way) {
        let ang = cur + way * (k === mid + way ? 2 : 1) * step(k, k - way);
        for (; Math.abs(ang) <= half && !(out[k] = at(set[k], ang)); ang += way * FIVE);
        if (!out[k]) return null;
        cur = ang;
      }
    }
    return out;
  };
  let plan = null;
  for (let k = db.constants.num('Base_Land_Targeting_Arc_Angle_Coefficient', 0.2); k > -1 && !plan; k -= 0.2) {
    const half = ((1 - k) * Math.PI) / 2,
      got = [];
    let rest = cands.slice(),
      r = R,
      ok = true;
    while (rest.length && ok) {
      const D = Math.max(...rest.map(g => g.hx)),
        at = r - D;
      if (at - D < least || at < Math.max(least, R * k)) {
        ok = false;
        break;
      }
      let put = null,
        n = rest.length;
      for (; n > 0 && !(put = ring(rest.slice(0, n), at, half)); n--);
      if (!put) {
        ok = false;
        break;
      }
      got.push(...put);
      rest = rest.slice(n);
      r = at - D;
    }
    if (ok) plan = got;
  }
  if (!plan) {
    for (const g of cands) this.attack(g.q, foe);
    return;
  }
  for (const p of plan) {
    const q = p.g.q;
    q.foe = foe;
    q.advance = this.time + 1.5;
    for (const u of q.members) u.target = null;
    this.order(q, p.x, p.y, Math.atan2(T.y - p.y, T.x - p.x));
    q.spot = { foe, x: T.x, y: T.y };
  }
}

let id = 0;
const unit = (q, x, y, more) => ({
  squad: q,
  side: q.side,
  type,
  x,
  y,
  heading: rnd() * 6,
  dead: false,
  inside: false,
  flies: false,
  ccls: 6,
  hardX: 6,
  hardY: 4,
  ...more
});
function squad(side, x, y, hx, hy, range) {
  const q = { id: id++, side, members: [], box: null, ext: false, structure: false };
  for (let k = 0; k < 3; k++) q.members.push(unit(q, x + (k - 1) * 5, y + (rnd() - 0.5) * 6, { range }));
  q.g = { q, x, y, hx, hy, need: 1, solo: false };
  return q;
}
function scene(n) {
  id = 0;
  world.squads = [];
  const foe = squad(1, 0, 0, 10, 10, 100);
  foe.members[0].body = 4 + rnd() * 20;
  const from = rnd() * 6.28,
    far = 500 + rnd() * 400,
    range = 120 + rnd() * 320,
    wide = rnd() < 0.5,
    group = [];
  for (let i = 0; i < n; i++) {
    const a = from + (rnd() - 0.5) * 1.2,
      d = far + rnd() * 250;
    group.push(
      squad(
        0,
        Math.cos(a) * d,
        Math.sin(a) * d,
        6 + rnd() * (wide ? 30 : 10),
        8 + rnd() * (wide ? 40 : 14),
        range + (rnd() < 0.2 ? rnd() * 60 : 0)
      )
    );
  }
  // some stand in range already, one has only the solo rule: those attack at once and take no place
  if (rnd() < 0.3) group[0].g.solo = true;
  const bystanders = [];
  for (let i = Math.floor(rnd() * 14); i > 0; i--) {
    const a = from + (rnd() - 0.5) * 3,
      d = 60 + rnd() * range,
      q = squad(i % 2, Math.cos(a) * d, Math.sin(a) * d, 8, 8, 100);
    for (const u of q.members) Object.assign(u, { hardX: 6 + rnd() * 18, hardY: 6 + rnd() * 18 });
    bystanders.push(q);
  }
  world.squads = [foe, ...group, ...bystanders];
  field = {
    rocks: Array.from({ length: Math.floor(rnd() * 9) }, () => {
      const a = from + (rnd() - 0.5) * 2.5,
        d = 40 + rnd() * range;
      return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: 15 + rnd() * 70 };
    }),
    wall: rnd() < 0.25 ? (rnd() - 0.5) * range : null,
    // the ground is open only in a narrow gap seen from the foe: few of the spots the search tries fall in it
    gap: rnd() < 0.3 ? { at: from + (rnd() - 0.5) * 1.6, wide: 0.01 + rnd() * 0.05 } : null
  };
  // now and then nothing round the foe is open at all
  if (rnd() < 0.06) field.rocks.push({ x: 0, y: 0, r: 5000 });
  return { foe, group };
}
const run = (search, S) => {
  acts = [];
  asked = 0;
  world.clutterAt = -1;
  world.clutterHeld = false;
  search.call(world, S.group, S.foe);
  return { acts, asked, filled: world.clutterAt === world.time };
};
const sum = { scenes: 0, placed: 0, fallback: 0, filledOnly: 0, fullAsked: 0, nowAsked: 0, mostNow: 0 };
for (let i = 0; i < 600; i++) {
  const n = 2 + Math.floor(rnd() * (i % 5 ? 14 : 44)),
    S = scene(n),
    full = run(fullSearch, S),
    now = run(world.attackGroup, S);
  assert.deepEqual(now.acts, full.acts, `scene ${i} (${n} squads): the places differ from the full search`);
  assert.equal(now.filled, full.filled, `scene ${i} (${n} squads): the clutter grid is filled in one search and not in the other`);
  assert(now.asked <= full.asked, `scene ${i}: ${now.asked} ways asked where the full search asked ${full.asked}`);
  assert.equal(world.clutterHeld, false);
  sum.scenes++;
  if (full.acts.some(a => a[0] === 'order')) sum.placed++;
  else sum.fallback++;
  if (full.filled && !full.acts.some(a => a[0] === 'order')) sum.filledOnly++;
  sum.fullAsked += full.asked;
  sum.nowAsked += now.asked;
  sum.mostNow = Math.max(sum.mostNow, now.asked);
}
// The tick's clutter grid is filled at the first open spot the full search looks at. Here that spot is one the
// shortened search never judges (it lies on a ring too full to fit): the grid must be filled all the same.
let lone = 0;
for (let i = 0; i < 40; i++) {
  const S = scene(24 + Math.floor(rnd() * 20)),
    looked = [],
    judged = new Set();
  field = { rocks: [], wall: null, gap: null, only: { x: 1e9, y: 1e9 }, note: (x, y) => looked.push({ x, y }) };
  run(fullSearch, S);
  field.note = (x, y) => world.clutterHeld && judged.add(x + ',' + y);
  run(world.attackGroup, S);
  const spot = looked.find(p => !judged.has(p.x + ',' + p.y));
  if (!spot) continue;
  field = { rocks: [], wall: null, gap: null, only: spot };
  const full = run(fullSearch, S),
    now = run(world.attackGroup, S);
  assert.equal(full.filled, true);
  assert.equal(now.filled, true, `lone spot ${i}: the full search fills the clutter grid at a spot the shortened one passes over`);
  assert.deepEqual(now.acts, full.acts);
  lone++;
}
assert(lone >= 10, `spots only the full search judges were found in ${lone} scenes`);
sum.lone = lone;
assert(sum.placed > 100 && sum.fallback > 40, `both outcomes are exercised (${sum.placed} placed, ${sum.fallback} not)`);
assert(sum.nowAsked * 2 < sum.fullAsked, `the search asks for ${sum.nowAsked} ways where the full search asked for ${sum.fullAsked}`);
console.log(JSON.stringify({ checks: 'group attack places against the full ring search', ...sum }));
