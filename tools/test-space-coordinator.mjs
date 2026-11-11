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
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const THREE = await import('../public/vendor/three/build/three.module.js');
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const S = await import('../public/js/game/sim.js');
const O = await import('../public/js/game/orders.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const K = db.constants;
const DELAY = K.num('SpacePathfindFrameDelayDelta', 0),
  EVERY = K.num('MovementReevaluationFrameCount', 0);
assert.equal(DELAY, 2, 'SpacePathfindFrameDelayDelta of the game');
assert.equal(EVERY, 10, 'MovementReevaluationFrameCount of the game');

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  maps
    .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
    .split('\\')
    .pop()
);
const used = [
  'TIE_Fighter_Squadron',
  'TIE_Bomber_Squadron',
  'Star_Destroyer',
  'Tartan_Patrol_Cruiser',
  'Corellian_Corvette',
  'Nebulon_B_Frigate'
];
{
  const names = new Set(),
    seen = new Set();
  for (const n of used) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

function battle(seed) {
  S.resetEntityIds();
  seedSim(seed);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const [empire, rebel] = ['Empire', 'Rebel'].map((f, i) => w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6 })));
  const step = () => w.update(DT);
  const run = secs => {
    for (let n = Math.round(secs / DT); n > 0; n--) step();
  };
  return { w, empire, rebel, run, step };
}
const lead = s => s.fighters[0];
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

{
  const { w, empire, run } = battle(3);
  const sd = w.spawn(T('Star_Destroyer'), empire, -3000, 0, 0);
  const tartan = w.spawn(T('Tartan_Patrol_Cruiser'), empire, -3000, 3300, 0);
  const near = w.spawn(T('TIE_Fighter_Squadron'), empire, -3100, -250, 0);
  const bombers = w.spawn(T('TIE_Bomber_Squadron'), empire, -3100, -150, 0);
  const far = w.spawn(T('TIE_Fighter_Squadron'), empire, -3300, 3500, 0);
  assert(w.max.y > 3800 && w.min.x < -3500, 'room on the map');
  for (const e of [sd, tartan, near, bombers, far]) e.setOrder({ kind: 'idle' });
  run(0.2);
  O.orderMove([sd, tartan, near, bombers, far], 0, 0);
  const wn = near.order.wing,
    wb = bombers.order.wing,
    wf = far.order.wing;
  assert(wn && wb && wf, 'every squadron of a group move flies in a fighter formation');
  assert.equal(wn, wb, 'squadrons about the one nearest the goal share its formation (speeds that fly together)');
  assert.notEqual(wn, wf, 'one far from it makes its own');
  assert.equal(wn.escort, sd, 'each fighter formation escorts the group ship nearest its leader');
  assert.equal(wf.escort, tartan, 'the far squadron escorts the patrol cruiser beside it');
  assert(!sd.order.wing && sd.order.startAt !== undefined, 'ships have start frames, no wing');
  const shipV = sd.maxSpeed;
  const tie = lead(near);
  assert(tie.maxSpeed > 2 * shipV, 'a TIE is more than twice as fast as a Star Destroyer');
  let worst = 0,
    ahead = -Infinity,
    followed = 0,
    capped = true,
    stoppedAt = -1;
  for (let i = 0; i < 30 * 150 && (wn.escort || wf.escort); i++) {
    run(DT);
    if (wn.escort && sd.going) {
      worst = Math.max(worst, d2(tie, sd));
      ahead = Math.max(ahead, tie.x - sd.x);
    }
    if (wf.escort && wf.follow) {
      followed++;
      if (far.cruise > 2 * tartan.cruise + 1e-6) capped = false;
    }
    if (stoppedAt < 0 && !sd.going) stoppedAt = w.time;
  }
  assert(worst < 1300, 'the squadron keeps with the Star Destroyer: ' + worst.toFixed(0));
  assert(ahead < 900, 'instead of racing ahead at its own speed: ' + ahead.toFixed(0));
  assert(followed > 30, 'near enough in three dimensions (Space_Guard_Range, half its attack range) it flies the ship course: ' + followed);
  assert(capped, 'then no faster than twice the ship');
  assert.equal(sd.order.kind, 'idle', 'the Star Destroyer got there');
  assert(!wn.escort && stoppedAt > 0, 'once its ship has stopped the escort is given up');
  run(20);
  assert(d2(tie, near.order.kind === 'idle' ? tie : near.order) < 900, 'and the squadron flies its own order on');
}

{
  const { w, empire, run, step } = battle(5);
  const sd = w.spawn(T('Star_Destroyer'), empire, -2000, 0, 0);
  const sq = w.spawn(T('TIE_Fighter_Squadron'), empire, -2100, -300, 0);
  sd.setOrder({ kind: 'idle' });
  sq.setOrder({ kind: 'idle' });
  run(0.2);
  O.orderMove([sd, sq], 3000, 0);
  const wing = sq.order.wing;
  assert.equal(wing.escort, sd);
  run(3);
  assert(wing.escort === sd, 'escorting while the ship flies');
  w.kill(sd, null);
  step();
  step();
  assert(!wing.escort, 'its ship destroyed, the escort is dropped at once');
  run(2);
  assert(sq.mode === 'move' || sq.order.kind === 'idle', 'and the squadron goes on with its own move');
}

{
  const { w, empire, run } = battle(7);
  const ships = [0, 1, 2, 3].map(k => w.spawn(T('Star_Destroyer'), empire, -3000 + k * 400, -2000 + k * 900, 0));
  const corv = [0, 1].map(k => w.spawn(T('Tartan_Patrol_Cruiser'), empire, -3000 + k * 500, 1500, 0));
  for (const e of [...ships, ...corv]) e.setOrder({ kind: 'idle' });
  run(0.2);
  const now = w.time;
  O.orderMove([...ships, ...corv], 4000, 0);
  const startOf = e => Math.round((e.order.startAt - now) * 30);
  const c = ships.reduce((a, e) => ({ x: a.x + e.x / 4, y: a.y + e.y / 4 }), { x: 0, y: 0 });
  const dir = { x: 4000 - c.x, y: 0 - c.y },
    l = Math.hypot(dir.x, dir.y);
  const byAhead = ships
    .slice()
    .sort((a, b) => ((b.x - c.x) * dir.x + (b.y - c.y) * dir.y) / l - ((a.x - c.x) * dir.x + (a.y - c.y) * dir.y) / l);
  assert.deepEqual(
    byAhead.map(startOf),
    [0, 1, 2, 3].map(k => k * DELAY),
    'the capital ships start SpacePathfindFrameDelayDelta frames apart, the one furthest ahead toward the goal first'
  );
  assert.deepEqual(
    corv.map(startOf).sort((a, b) => a - b),
    [0, DELAY],
    'each layer is staggered on its own'
  );
  const last = byAhead[3],
    h0 = last.heading,
    x0 = last.x;
  run(DT * (3 * DELAY - 1));
  assert.equal(last.heading, h0, 'before its start a ship holds its course (the engine wait marker)');
  assert(Math.abs(last.x - x0) < 1, 'and, at rest, stays put');
  run(3);
  assert(
    ships.every(e => e.speed > 1),
    'all under way after their starts'
  );
}

{
  const { w, empire, rebel, run } = battle(9);
  const a = w.spawn(T('Star_Destroyer'), empire, -2500, -300, 0);
  const b = w.spawn(T('Star_Destroyer'), empire, -2500, 300, 0);
  const foe = w.spawn(T('Nebulon_B_Frigate'), rebel, 0, 0, Math.PI);
  for (const e of [a, b, foe]) e.setOrder({ kind: 'idle' });
  foe.holdFire = true;
  run(0.2);
  O.orderAttack([a, b], foe);
  const F = a.order.force;
  assert(F && b.order.force === F && w.forces.includes(F), 'a group attack is re-checked as a group');
  assert(!F.hp, 'no sub-target given');
  const frameOf = () => Math.round(w.time * 30);
  let at = -1;
  while (at < 0) {
    run(DT);
    if (F.hp) at = frameOf();
  }
  assert.equal(at % EVERY, F.id % EVERY, 'the re-check runs on its own MovementReevaluationFrameCount frame');
  assert(at / 30 >= F.staggerEnd - 1e-6, 'and only once the staggered starts are over');
  assert.equal(F.hp, w.pickHardpoint(foe, a.x, a.y, a), 'a target with no sub-target gets the first ship pick');
  assert(a.targetHp === F.hp && b.targetHp === F.hp, 'which every ship of the group then takes');
  const was = F.hp;
  was.alive = false;
  run(EVERY * DT);
  assert(F.hp && F.hp !== was && F.hp.alive, 'a destroyed sub-target is picked again');
  const plans = F.replans || 0,
    offset = a.order.offset;
  foe.x = 3500;
  foe.y = 2500;
  foe.syncObj();
  run(EVERY * DT);
  assert(
    (F.replans || 0) > plans,
    'a ship that can no longer reach the target from its route end or from where it is has its layer placed again'
  );
  assert(a.order.offset !== offset, 'a new place on the ring');
  assert.equal(a.order.pace ?? 1, 1, 'placed again at full speed (the engine passes the first ship speed where the slowest ETA goes)');
  const after = F.replans;
  run(EVERY * DT * 0.5);
  assert.equal(F.replans, after, 'nothing in between the re-check frames');
}

{
  const { w, empire, run } = battle(13);
  const f1 = w.spawn(T('TIE_Fighter_Squadron'), empire, -1000, 0, 0);
  const b1 = w.spawn(T('TIE_Bomber_Squadron'), empire, -1000, 40, 0);
  const f2 = w.spawn(T('TIE_Fighter_Squadron'), empire, 1000, 1000, 0);
  for (const e of [f1, b1, f2]) e.setOrder({ kind: 'idle' });
  run(0.2);
  O.orderMove([f1], 2000, -500);
  O.orderMove([b1], 2000, -500);
  O.orderMove([f2], 2000, -500);
  const w1 = f1.order.wing,
    w2 = b1.order.wing;
  assert(w1 !== w2, 'two separate orders, two formations');
  run(DT);
  assert.equal(b1.order.wing, f1.order.wing, 'fighter formations with the same orders that overlap merge into one');
  assert(f1.order.wing.squads.includes(b1) && f1.order.wing.squads.includes(f1));
  assert(!w.wings.includes(w2) || !w.wings.includes(w1), 'the emptied formation is gone');
  assert.notEqual(f2.order.wing, f1.order.wing, 'one far off stays on its own');
  run(1);
  assert(Math.abs(f1.cruise - b1.speed) < 1e-6, 'the merged formation flies at its slowest member speed: ' + f1.cruise + ' ' + b1.speed);
  assert(b1.speed < f1.speed, 'bombers are slower');

  const f3 = w.spawn(T('TIE_Fighter_Squadron'), empire, -1000, -2000, 0);
  const f4 = w.spawn(T('TIE_Fighter_Squadron'), empire, -1000, -1960, 0);
  f3.setOrder({ kind: 'idle' });
  f4.setOrder({ kind: 'idle' });
  run(0.2);
  O.orderMove([f3], 2000, -2500);
  O.orderMove([f4], 2100, -2500);
  run(DT);
  assert.notEqual(f3.order.wing, f4.order.wing, 'different goals: no merge');
}

{
  const lo = n => T(n).num('Min_Speed', 0),
    hi = n => T(n).num('Max_Speed', 0);
  assert(
    lo('TIE_Bomber') / hi('TIE_Fighter') <= 0.9 && lo('TIE_Fighter') / hi('TIE_Bomber') <= 0.9,
    'TIE fighters and bombers can fly together'
  );
}

console.log('space coordinator ok');
