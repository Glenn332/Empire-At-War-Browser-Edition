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
const { leadCircle } = await import('../public/js/game/projflight.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const near = (a, b, eps, why) => assert(Math.abs(a - b) <= eps, why + ': ' + a + ' vs ' + b);

{
  const R = 200,
    a = 0.15,
    O = { x: 100, y: -50, z: 20 },
    on = k => ({ x: O.x + R * Math.cos(k * a), y: O.y + R * Math.sin(k * a), z: O.z });
  const B = on(0),
    A = on(1),
    C = on(2);
  const tgt = { x: C.x, y: C.y, z: C.z, l1x: A.x, l1y: A.y, l1z: A.z, l2x: B.x, l2y: B.y, l2z: B.z };
  const S0 = { x: 700, y: -400, z: 60 },
    speed = 600;
  const out = { x: 0, y: 0, z: 0 };
  const P = leadCircle(out, S0.x, S0.y, S0.z, tgt, 0, 0, 0, speed);
  assert(P, 'a turning target is led');
  const gentle = k => ({ x: R * Math.cos(k * 0.02), y: R * Math.sin(k * 0.02), z: 0 }),
    g1 = gentle(1),
    g2 = gentle(2);
  const G = leadCircle({ x: 0, y: 0, z: 0 }, 0, 600, 0, { x: g2.x, y: g2.y, z: 0, l1x: g1.x, l1y: g1.y, l1z: 0, l2x: R, l2y: 0, l2z: 0 }, 0, 0, 0, speed);
  near(G.x, g2.x + (g2.x - g1.x) * 30 * (Math.hypot(G.x, G.y - 600) / speed), 1e-6, 'chords within the collinear tolerance lead straight');
  near(Math.hypot(P.x - O.x, P.y - O.y, P.z - O.z), R, 1e-6, 'the lead point lies on the circle through the last three positions');
  const W = (Math.hypot(C.x - A.x, C.y - A.y) * 30) / R,
    t = Math.hypot(P.x - S0.x, P.y - S0.y, P.z - S0.z) / speed,
    E = { x: O.x + R * Math.cos(2 * a + W * t), y: O.y + R * Math.sin(2 * a + W * t) };
  near(Math.hypot(E.x - P.x, E.y - P.y), 0, 0.5, 'the target reaches it along the circle at its last chord speed as the shot does');
  const off = leadCircle({ x: 0, y: 0, z: 0 }, S0.x, S0.y, S0.z, tgt, 10, -4, 7, speed);
  near(off.x - P.x, 10, 1e-9, 'a hardpoint aim adds its offset unrotated');
  near(off.y - P.y, -4, 1e-9, 'a hardpoint aim adds its offset unrotated');
  near(off.z - P.z, 7, 1e-9, 'a hardpoint aim adds its offset unrotated');

  const line = { x: 2, y: 0, z: 0, l1x: 1, l1y: 0, l1z: 0, l2x: 0, l2y: 0, l2z: 0 };
  const L = leadCircle({ x: 0, y: 0, z: 0 }, 0, 500, 0, line, 0, 0, 0, speed);
  const tl = (L.x - 2) / 30;
  near(Math.hypot(L.x, L.y - 500, L.z), speed * tl, 1e-6, 'a straight mover is led along its last displacement');
  near(L.y, 0, 1e-9, 'a straight mover is led along its last displacement');

  const still = { x: 5, y: 6, z: 7, l1x: 5, l1y: 6, l1z: 7, l2x: 5, l2y: 6, l2z: 7 };
  const H = leadCircle({ x: 0, y: 0, z: 0 }, 0, 0, 0, still, 1, 0, 0, speed);
  assert(H.x === 6 && H.y === 6 && H.z === 7, 'a still target is aimed at directly');

  const big = 5000,
    wide = k => ({ x: big * Math.cos(k * 0.001), y: big * Math.sin(k * 0.001), z: 0 });
  const b0 = wide(0),
    b1 = wide(1),
    b2 = wide(2);
  const far = { x: b2.x, y: b2.y, z: 0, l1x: b1.x, l1y: b1.y, l1z: 0, l2x: b0.x, l2y: b0.y, l2z: 0 };
  const F = leadCircle({ x: 0, y: 0, z: 0 }, 0, 0, 0, far, 0, 0, 0, speed);
  const tf = Math.hypot(F.x, F.y, F.z) / speed;
  near(F.x, b2.x + (b2.x - b1.x) * 30 * tf, 1e-6, 'a circle wider than 1000 falls back to the straight lead');
}

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  maps
    .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
    .split('\\')
    .pop()
);
const field = [...db.types.values()].find(t => t.bool('Is_Asteroid_Field') && /STATICOBJECT/i.test(t.str('Space_Layer')) && t.str('Space_Model_Name'));
const station = [...db.types.values()].find(
  t => t.str('Space_Model_Name') && t.sub('Abilities').some(a => a.all('Income_Stream_Ability').length) && /^Skirmish_Empire_Star_Base/i.test(t.name)
);
const used = ['TIE_Fighter_Squadron', 'Corellian_Corvette', 'Star_Destroyer', ...(field ? [field.name] : []), ...(station ? [station.name] : [])];
{
  const names = new Set(),
    seen = new Set();
  for (const n of used) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

function battle(seed, fx = nothing) {
  S.resetEntityIds();
  seedSim(seed);
  const w = new S.World({ scene: new THREE.Scene(), fx, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const [empire, rebel] = ['Empire', 'Rebel'].map((f, i) => w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1000 })));
  const run = secs => {
    for (let n = Math.round(secs / DT); n > 0; n--) w.update(DT);
  };
  return { w, empire, rebel, run };
}

if (field) {
  const { w, empire, run } = battle(1);
  const f = w.spawn(field, w.neutral, 3000, 3000),
    sd = w.spawn(T('Star_Destroyer'), empire, -3000, -3000);
  run(DT);
  assert(!w.obstacles.includes(f), 'fields stay out of the look-ahead tree');
  assert(w.obstacles.includes(sd), 'ships are in it');
}

{
  const { w, empire, rebel, run } = battle(2);
  const sq = w.spawn(T('TIE_Fighter_Squadron'), empire, 0, 0);
  const calls = [];
  const was = w.collectBounty.bind(w);
  w.collectBounty = (e, at, k) => {
    calls.push(e);
    was(e, at, k);
  };
  const n = sq.fighters.length;
  for (const f of [...sq.fighters]) w.kill(f, rebel);
  assert(sq.dead, 'the squadron is gone with its last fighter');
  assert.equal(calls.length, n, 'a bounty for each fighter');
  assert(!calls.some(e => e.isSquad), 'and none for the squadron container');
  run(DT);
}

{
  const told = [];
  const fx = new Proxy({}, { get: (t, k) => (k === 'floatText' ? (...a) => told.push(a) : () => undefined) });
  const { w, empire, rebel } = battle(3, fx);
  const ally = w.addPlayer(new S.Player(2, empire.team, { credits: 1000, human: true }));
  empire.human = true;
  w.viewer = empire;
  w.bounty.payouts = () => [
    [empire, 40],
    [ally, 40]
  ];
  empire.creditCap = 1010;
  const foe = w.spawn(T('Corellian_Corvette'), rebel, 500, 0);
  w.kill(foe, empire);
  assert.equal(told.length, 1, 'only the local player sees its "+N"');
  assert.equal(told[0][3], '+40');
  assert.equal(empire.credits, 1010, 'tactical credits stop at the player cap');
  assert.equal(ally.credits, 1040, 'a player without a cap is paid in full');
}

if (station) {
  const { w, empire } = battle(4);
  const st = w.spawn(station, empire, 0, 0);
  assert(st.income, station.name + ' has an income stream');
  st.income.skirmish = false;
  const dock = st.type
    .sub('Abilities')
    .flatMap(a => a.all('Income_Stream_Mod_Ability'))
    .filter(
      m =>
        m.val('Target_Stream_Source').trim().toUpperCase() === station.name.toUpperCase() &&
        st.hardpoints.some(h => h.alive && h.def.str('Special_Ability_Name').trim().toUpperCase() === String(m.attrs.Name).toUpperCase())
    )
    .reduce((a, m) => a + m.num('Income_Additive_Value', 0), 0);
  assert(dock > 0, 'the station supply dock hardpoint adds to its income');
  const rate = (st.income.value + dock) / st.income.interval,
    c0 = empire.credits;
  w.update(DT);
  near(empire.credits - c0, rate * DT, 1e-6, 'income is paid a little every frame');
  for (let i = 0; i < 299; i++) w.update(DT);
  near(empire.credits - c0, rate * 10, 1e-6, 'adding up to the same total over ten seconds');
}

{
  const { w, empire } = battle(5);
  const sq = w.spawn(T('TIE_Fighter_Squadron'), empire, 0, 0);
  const lead = sq.fighters[0];
  const lo = db.constants.num('FormationMinimumSideError', 0.1),
    hi = db.constants.num('FormationMaximumSideError', 30);
  near(w.sideError({ x: 500, y: 200 }, { dx: 1, dy: 0, sx: 0, sy: 0 }), -(200 - lo) / hi, 1e-9, 'the side error past the minimum over the maximum');
  assert.equal(w.sideError({ x: 500, y: 0.05 }, { dx: 1, dy: 0, sx: 0, sy: 0 }), 0, 'none inside the minimum');
  near(w.sideCruise(lead, 0, 100, 150), 100, 1e-9, 'on the line the cruise is the group speed');
  assert(w.sideCruise(lead, -3, 100, 150) > 100, 'a sideways correction flies faster');
  assert(w.sideCruise(lead, -3, 100, 150) <= 150, 'no faster than the top speed');
}

{
  const { w, empire, run } = battle(6);
  const sq = w.spawn(T('TIE_Fighter_Squadron'), empire, -3000, 0);
  for (const f of sq.fighters) f.heading = 0;
  sq.setOrder({ kind: 'move', x: 3000, y: 0 });
  run(0.5);
  assert(sq.route, 'a moving squadron has a route');
  for (const f of sq.fighters) f.y += 300;
  run(6);
  const y = sq.fighters[0].y;
  assert(Math.abs(y) < 240, 'the leader is steered back onto its route line: ' + y);
}

{
  const { w, empire, rebel, run } = battle(7);
  const sq = w.spawn(T('TIE_Fighter_Squadron'), empire, 0, 0);
  const foe = w.spawn(T('Star_Destroyer'), rebel, 900, 0);
  foe.setOrder({ kind: 'idle' });
  const lead = sq.fighters[0],
    slow = lead.maxSpeed;
  lead.maxSpeed = slow * 1.4;
  sq.setOrder({ kind: 'attack', target: foe });
  let fast = 0;
  for (let i = 0; i < 120; i++) {
    run(DT);
    if (sq.mode === 'combat') fast = Math.max(fast, lead.speed);
  }
  assert(fast > slow * 1.2, 'a fighter closes in at its own top speed, not the slowest one: ' + fast + ' vs ' + slow);
}

{
  const { w, empire } = battle(8);
  const sq = w.spawn(T('TIE_Fighter_Squadron'), empire, 0, 0);
  const u = sq.fighters[0],
    F = w.flight(u);
  assert(F.lift > 0, 'a TIE climbs');
  u.fstate.loop = 1;
  u.heading = 0;
  u.roll = 0;
  u.pitch = Math.PI / 2 - F.lift * DT * 0.5;
  w.fly(u, -1000, 0, u.z, u.speed, DT);
  const p = Math.PI / 2 + F.lift * DT * 0.5;
  near(u.pitch, Math.PI - p - F.lift / 30, F.lift / 30 + 1e-9, 'the loop ends one frame of lift past the top, then steers level');
  assert(u.pitch < Math.PI - p, 'below the plain mirror of the top');
  near(Math.abs(u.heading), Math.PI, 1e-9, 'facing back');
}

console.log('space fighters: ok');
