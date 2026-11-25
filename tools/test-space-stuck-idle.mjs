// Space battles: squadrons that sat idle next to enemies, and big ships that stood still at fields.
//  - a squadron escorting a ship on an attack order answers an enemy squadron at its side (it ignored it before),
//  - an escort whose ship is held still lets go of the ship (it orbited a stalled ship before),
//  - a squadron whose guarded ship dies goes idle where it is and answers what comes (a blind move before),
//  - our detour keeps a leg the engine search cannot fly when it is clear in a straight line (the whole detour was
//    thrown away and the ship stood),
//  - a ship on the far side of a field edge it touches gets the field kind left out of the detour as the engine
//    tries leave it out,
//  - the steering point of a held ship or a turn on the spot stays on the map near the edge,
//  - a Star Destroyer ordered across an asteroid field wall and nebulae gets there without standing still.
// With SWR_TEST_MOD set (Thrawns Revenge) the same runs with its ships.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const modPath = process.env.SWR_TEST_MOD;
const archive = openGame(gameDir, modPath ? [modPath] : []);
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
const pick = (...names) => {
  for (const n of names) if (db.type(n)) return db.type(n);
  assert.fail('none of ' + names.join(', '));
};
const SQUAD = pick('TIE_Fighter_Squadron'),
  FOE = pick('X_Wing_Squadron', 'Rebel_X-Wing_Squadron'),
  SHIP = pick(modPath ? 'Victory_I_Star_Destroyer' : 'Star_Destroyer', 'Star_Destroyer'),
  BIG = pick(modPath ? 'Imperial_I_Star_Destroyer' : 'Star_Destroyer', 'Star_Destroyer'),
  ROCKS = pick('Asteroid Field Large'),
  CLOUD = pick('Nebula Huge', 'Nebula Large');
{
  const names = new Set(),
    seen = new Set();
  for (const t of [SQUAD, FOE, SHIP, BIG, ROCKS, CLOUD]) S.modelsForType(t, null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const mapName = ['_MP_SPACE_ALDERAAN.TED', '_MP_SPACE_ATRAVIS_MADNESS.TED'].find(n => [...archive.index.keys()].some(k => k.endsWith(n)));
assert(mapName, 'a space map to fight on');
const map = await loadMap(mapName);
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });
function setup() {
  S.resetEntityIds();
  seedSim(11);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const empire = w.addPlayer(new S.Player(0, w.addTeam(new S.Team(0, 'Empire')), { credits: 1e6, human: true })),
    rebel = w.addPlayer(new S.Player(1, w.addTeam(new S.Team(1, 'Rebel')), { credits: 1e6 }));
  return { w, empire, rebel };
}
const step = (w, s) => {
  for (let t = 0; t < s; t += DT) w.update(DT);
};
const quiet = q => {
  for (const f of q.fighters || [q]) f.holdFire = true;
  q.setOrder({ kind: 'idle' });
  if (q.isSquad) q.alone = false;
};

// A ship and a squadron sent to attack a far ship: the squadron escorts the ship, and answers an enemy squadron
// that turns up at its side as if it guarded the ship.
{
  const { w, empire, rebel } = setup();
  const ship = w.spawn(SHIP, empire, -3000, 0, 0),
    sq = w.spawn(SQUAD, empire, -3000, 600, 0),
    far = w.spawn(SHIP, rebel, 6000, 0, Math.PI);
  quiet(far);
  O.orderAttack([ship, sq], far);
  step(w, 4);
  assert(sq.order.wing && sq.order.wing.escort === ship, 'the squadron escorts the ship');
  const lead = sq.fighters[0],
    foe = w.spawn(FOE, rebel, lead.x + 400, lead.y + 100, Math.PI);
  quiet(foe);
  let answered = -1;
  for (let t = 0; t < 6 && answered < 0; t += DT) {
    w.update(DT);
    if (sq.target === foe) answered = t;
  }
  assert(answered >= 0, 'an escort answers an enemy squadron at its side');
  console.log('escort answers an enemy squadron at its side after ' + answered.toFixed(1) + ' s');
}

// The escorted ship is held still: the escort lets go of it instead of circling it with its order unanswered.
{
  const { w, empire, rebel } = setup();
  const ship = w.spawn(SHIP, empire, -3000, 0, 0),
    sq = w.spawn(SQUAD, empire, -3000, 600, 0),
    far = w.spawn(SHIP, rebel, 4000, 0, Math.PI);
  quiet(far);
  O.orderAttack([ship, sq], far);
  step(w, 2);
  const wing = sq.order.wing;
  assert(wing && wing.escort === ship, 'the squadron escorts the ship');
  ship.mods.speed = 0;
  let left = -1;
  for (let t = 0; t < 8 && left < 0; t += DT) {
    w.update(DT);
    if (!wing.escort) left = t;
  }
  assert(ship.going && ship.speed < 1, 'the ship still has its order but stands');
  assert(left >= 0 && left < 6, 'the escort lets go of a ship held still');
  step(w, 3);
  assert.equal(sq.target, far, 'and goes on to the target itself');
  console.log('escort of a ship held still lets go after ' + left.toFixed(1) + ' s');
}

// The guarded ship dies: the squadron goes idle where it is and answers an enemy within Idle_Chase_Range.
{
  const { w, empire, rebel } = setup();
  const ship = w.spawn(SHIP, empire, 0, 0, 0),
    sq = w.spawn(SQUAD, empire, 300, 300, 0);
  O.orderGuard([sq], ship);
  step(w, 2);
  ship.dead = true;
  step(w, 0.5);
  assert.equal(sq.order.kind, 'idle', 'a squadron whose guarded ship died is idle');
  assert(sq.alone, 'and answers what comes, as one that has arrived');
  const lead = sq.fighters[0],
    foe = w.spawn(FOE, rebel, lead.x + 300, lead.y, Math.PI);
  quiet(foe);
  step(w, 4);
  assert.equal(sq.target, foe, 'it takes on an enemy squadron next to it');
}

// Our detour: a leg the engine search cannot fly that is clear in a straight line is flown straight.
{
  const { w, empire } = setup();
  w.addField(ROCKS, 0, 0, 3);
  const ship = w.spawn(BIG, empire, -3500, 0, 0);
  w.update(DT);
  const P = w.paths,
    findOnce = P.findOnce;
  let legs = 0;
  P.findOnce = function (...a) {
    legs++;
    return [];
  };
  let route;
  try {
    route = P.detour(ship, 3500, 0);
  } finally {
    P.findOnce = findOnce;
  }
  assert(legs > 0, 'the detour asked the engine search for a leg');
  assert(route && route.length > 1, 'a detour whose legs the engine search cannot fly is flown on its clear legs');
  for (const p of route) assert(Math.hypot(p.x, p.y) > 2100 * 0.98, 'the straight legs keep out of the field');
}

// A ship just outside a field kind it touches with its reach: that kind is left out of the detour, as fieldsAvoidedOn
// leaves it out of the engine tries.
{
  const { w, empire } = setup();
  const ship = w.spawn(BIG, empire, 0, 0, 0);
  w.update(DT);
  const P = w.paths,
    q = P.ext(ship);
  ship.pathExt = { ax: 300, sd: 120, r: 300 };
  w.fields.push({ x: 1000 + 150, y: 0, r: 1000, asteroid: true, nebula: false, ion: false, radar: true });
  if (ship.asteroidDamage) {
    const obs = P.detourObstacles(ship, -3000, 0);
    assert(!obs.some(o => o.x === 1150), 'a field kind the ship touches with its reach is left out of the detour');
  }
  ship.pathExt = q;
}

// The steering point of a held ship stays on the map near its edge.
{
  const { w, empire } = setup();
  const ship = w.spawn(BIG, empire, w.max.x - 200, 0, 0);
  const r = { wp: { x: 0, y: 0, via: true, speed: undefined } },
    wp = w.paths.stopAhead(ship, r);
  assert(wp.x <= w.max.x && wp.x > ship.x, 'the point ahead of a ship at the map edge is on the map');
  assert.equal(wp.speed, 0, 'and holds the ship');
}

// A Star Destroyer ordered across an asteroid field wall with nebulae gets there without standing still.
for (const lockstep of [false, true]) {
  const { w, empire } = setup();
  if (lockstep) await w.paths.deterministic();
  for (let y = -3000; y <= 3000; y += 1000) w.addField(ROCKS, 0, y, 1);
  w.addField(CLOUD, -2000, 600, 1);
  w.addField(CLOUD, 2000, -600, 1);
  for (const [x, y] of [[0, -3000], [0, 0], [0, 3000], [-2000, 600], [2000, -600]]) w.spawn(y % 1000 ? CLOUD : ROCKS, w.neutral, x, y, 0);
  const ships = [w.spawn(BIG, empire, -5000, -500, 0), w.spawn(SHIP, empire, -5000, 700, 0)];
  O.orderMove(ships, 5000, 0);
  const still = ships.map(() => 0),
    worst = ships.map(() => 0);
  let t = 0;
  while (t < 300 && ships.some(e => e.order.kind !== 'idle')) {
    w.update(DT);
    t += DT;
    ships.forEach((e, i) => {
      still[i] = e.order.kind !== 'idle' && e.speed < 1 ? still[i] + DT : 0;
      worst[i] = Math.max(worst[i], still[i]);
    });
  }
  ships.forEach((e, i) => {
    assert.equal(e.order.kind, 'idle', e.type.name + ' arrives across the fields');
    assert(Math.hypot(e.x - 5000, e.y) < 1500, e.type.name + ' is at the goal');
    assert(worst[i] < 15, e.type.name + ' never stands still for long: ' + worst[i].toFixed(1) + ' s');
  });
  console.log((lockstep ? 'lockstep' : 'single player') + ': across the field wall in ' + t.toFixed(0) + ' s, longest stand ' + Math.max(...worst).toFixed(1) + ' s');
}
console.log('space stuck idle ok');
