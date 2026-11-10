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
const { loadMap } = await import('../public/js/ted.js');
const { loadLandTables } = await import('../public/js/game/landtables.js');
const { surfaceAt, surfaceStatus, surfaceLight, SURFACES } = await import('../public/js/game/landsurface.js');
const { heightAt } = await import('../public/js/game/terrain.js');
const THREE = await import('three');

const tables = await loadLandTables();
const endor = (await loadMap('_MP_LAND_ENDOR.TED')).terrain;
const lake = surfaceAt(endor, 1908, 3507);
assert.equal(SURFACES[lake], 'water', 'the Endor lake reads as water');
assert(heightAt(endor, 1908, 3507) < endor.water.level - 0.5, 'the lake floor lies under the water plane');

const trooper = db.type('Stormtrooper');
assert(
  trooper.list('SurfaceFX_Name').some(n => /Infantry_Terrain_Modifier/i.test(n)),
  'troopers carry the infantry terrain modifier'
);
const wet = surfaceStatus(tables, trooper, lake);
assert(wet, 'wading troopers get a status');
assert.equal(wet.icon.toLowerCase(), 'i_surface_slow.tga', 'the slow ground icon from the surface settings');
assert.deepEqual(wet.tint, [1, 1, 0], 'the slow ground colour from the game constants');

let dry = null;
for (let y = 200; y < 4000 && !dry; y += 40)
  for (let x = 200; x < 4000; x += 40) {
    const s = surfaceAt(endor, x, y);
    if (SURFACES[s] === 'grass') {
      dry = s;
      break;
    }
  }
assert.equal(SURFACES[dry], 'grass', 'grass layers keep their own surface');
assert.equal(surfaceStatus(tables, trooper, dry), null, 'nothing shows on plain ground');

const walker = db.type('AT_AT_Walker');
assert.equal(surfaceStatus(tables, walker, lake), null, 'units without a terrain modifier show nothing');

const lavaMap = (await loadMap('_LAND_PLANET_MUSTAFAR_01.TED')).terrain;
assert.equal(lavaMap.water.mode, 2);
let lava = -1;
for (let y = 200; y < 4000 && lava < 0; y += 40)
  for (let x = 200; x < 4000; x += 40)
    if (SURFACES[surfaceAt(lavaMap, x, y)] === 'lava') {
      lava = surfaceAt(lavaMap, x, y);
      break;
    }
const hot = surfaceStatus(tables, trooper, lava);
assert.equal(hot && hot.icon.toLowerCase(), 'i_surface_damage.tga', 'lava shows the damage icon');
assert.deepEqual(hot.tint, [1, 0, 0], 'lava pulses in the lava colour');

const v = new THREE.Vector4();
surfaceLight(wet.tint, 0, v);
assert.deepEqual(v.toArray(), [1, 1, 1, -1], 'the pulse starts at the plain colour');
surfaceLight(wet.tint, 0.5, v);
assert.deepEqual(
  v.toArray().map(c => Math.round(c * 1000) / 1000),
  [1, 1, 0, -1],
  'half a second in it is fully the tint'
);
surfaceLight(wet.tint, 1, v);
assert(Math.abs(v.z - 1) < 1e-6, 'one second per pulse');

const { surfaceEffect, NO_SURFACE } = await import('../public/js/game/landsurface.js');
const { LandWorld, landUnit } = await import('../public/js/game/land.js');
const { CELL } = await import('../public/js/game/terrain.js');
const idx = n => SURFACES.indexOf(n);
const find = (T, name) => {
  for (let y = 0; y < T.size; y++)
    for (let x = 0; x < T.size; x++) if (surfaceAt(T, x * CELL, y * CELL) === idx(name)) return { x: x * CELL, y: y * CELL };
  return null;
};

const eff = name => surfaceEffect(tables, trooper, idx(name));
assert.equal(eff('water').speed, 0.5, 'water Speed_Mod -0.5 halves the speed');
assert.equal(eff('slow_ground').speed, 0.5, 'slow ground the same');
assert.equal(eff('mud'), NO_SURFACE, 'mud is not read by the engine although the settings give it a Speed_Mod');
assert.equal(eff('good_ground').taken, 0.5, 'good ground Defense_Mod 0.5 halves the damage taken');
assert.equal(eff('good_ground').dealt, 2, 'good ground Damage_Mod 1.0 doubles the damage dealt');
assert.equal(eff('high_ground').sight, 1.25, 'high ground FOW_Reveal_Range_Mod');
assert.equal(eff('high_ground').range, 1.25, 'troopers list High_Ground twice: the same source key keeps the largest, no stacking');
assert.deepEqual([eff('lava').damage, eff('lava').delay], [10, 1], 'lava burns 10 a second');
assert.deepEqual([eff('damage_ground').damage, eff('damage_ground').delay], [10, 1]);
assert.equal(eff('infantry_ground'), NO_SURFACE, 'infantry ground only shows its icon');
assert.equal(eff('grass'), NO_SURFACE);
assert.equal(surfaceEffect(tables, walker, idx('water')), NO_SURFACE, 'no terrain modifier, no effect: walkers wade at full speed');

const fake = {
  name: 'Fake',
  list: k => (k === 'SurfaceFX_Name' ? ['Fake_A', 'Fake_B'] : []),
  str: () => '',
  num: (k, d) => d
};
const sfx = (o = {}) => ({ speed: 0, defense: 0, dealt: 0, sight: 0, range: 0, damage: 0, delay: 0, icon: '', ...o });
const fakeTables = {
  surface: new Map([
    [
      'FAKE_A',
      new Map([
        ['slow_ground', sfx({ speed: -0.5 })],
        ['lava', sfx({ damage: 5, delay: 2 })]
      ])
    ],
    [
      'FAKE_B',
      new Map([
        ['slow_ground', sfx({ speed: -0.25 })],
        ['lava', sfx({ damage: 7, delay: 0.5 })]
      ])
    ]
  ])
};
assert.equal(surfaceEffect(fakeTables, fake, idx('slow_ground')).speed, 0.75, 'two lists: the larger modifier wins');
assert.deepEqual(
  [surfaceEffect(fakeTables, fake, idx('lava')).damage, surfaceEffect(fakeTables, fake, idx('lava')).delay],
  [7, 0.5],
  'two burning lists: the last one sets the damage and delay'
);

const naboo = (await loadMap('_MP_LAND_NABOO.TED')).terrain,
  bespin = (await loadMap('_MP_LAND_BESPIN.TED')).terrain;
const hill = find(naboo, 'high_ground'),
  rock = find(bespin, 'good_ground'),
  pit = find(lavaMap, 'lava');
assert(hill && rock && pit, 'Naboo has high ground, Bespin good ground, Mustafar lava');

const world = terrain =>
  Object.assign(Object.create(LandWorld.prototype), {
    terrain,
    tables,
    units: [],
    time: 0,
    weather: { level: 0, name: 'clear' },
    retreatState: null,
    ally: () => true,
    tracksDamage: () => false,
    hits: []
  });
const trooperAt = (W, at, extra = {}) => {
  const u = landUnit({
    type: trooper,
    x: at.x,
    y: at.y,
    z: 0,
    side: 0,
    health: 1000,
    maxHealth: 1000,
    shield: 0,
    maxShield: 0,
    path: [],
    squad: { foe: true },
    mod: { speed: 1, taken: 1, delay: 1, dealt: 1 },
    range: 100,
    ...extra
  });
  W.units.push(u);
  return u;
};

{
  const W = world(lavaMap);
  W.hurt = (u, d, from) => W.hits.push([W.time, d, from]);
  const u = trooperAt(W, pit);
  for (let f = 0; f <= 90; f++) {
    W.time = f / 30;
    W.tickSurfaces();
  }
  assert.deepEqual(
    W.hits.map(([t, d, from]) => [Math.round(t * 30), d, from]),
    [
      [30, 10, null],
      [60, 10, null],
      [90, 10, null]
    ],
    'lava hurts 10 with no attacker each Terrain_Damage_Delay after stepping on'
  );
  u.x = 200;
  u.y = 200;
  W.time = 3.5;
  W.tickSurfaces();
  const was = W.hits.length;
  u.x = pit.x;
  u.y = pit.y;
  for (let f = 0; f < 29; f++) {
    W.time = 4 + f / 30;
    W.tickSurfaces();
  }
  assert.equal(W.hits.length, was, 'stepping back on restarts the delay');
  u.inside = {};
  W.time = 10;
  W.tickSurfaces();
  assert.equal(W.hits.length, was, 'garrisoned units are off the ground');
  assert.equal(u.surf, NO_SURFACE);
}

{
  const W = world(endor);
  const u = trooperAt(W, { x: 1908, y: 3507 });
  W.tickSurfaces();
  assert.equal(W.paceOf(u), 0.5, 'wading troopers move at half speed through the one surface path');
  u.mod.speed = 0.8;
  assert.equal(Math.round(W.paceOf(u) * 1000), 400, 'it multiplies with other speed modifiers');
  const at = landUnit({ type: walker, x: 1908, y: 3507, mod: { speed: 1 } });
  W.units.push(at);
  W.tickSurfaces();
  assert.equal(W.paceOf(at), 1, 'walkers without a terrain modifier keep their speed in water');
}

{
  const W = world(naboo);
  const u = trooperAt(W, hill);
  u.guns = [];
  W.tickSurfaces();
  assert.equal(u.range, 125, 'high ground: a quarter farther fire range');
  assert.equal(u.baseRange, 100, 'the base range is kept');
  u.range = 80;
  assert.equal(u.range, 100, 'a weapon swap keeps the surface factor');
  assert.equal(W.sightMod(u), 1.25, 'high ground: a quarter farther sight');
  u.x = 100;
  u.y = 100;
  W.tickSurfaces();
  assert.equal(u.range, 80, 'off the hill the range is plain');
  assert.equal(W.sightMod(u), 1);
}

{
  const W = world(bespin);
  const a = trooperAt(W, rock),
    b = trooperAt(W, { x: 100, y: 100 });
  W.tickSurfaces();
  W.hurt(a, 100, b);
  assert.equal(a.health, 950, 'good ground halves the damage taken');
  W.hurt(b, 100, a);
  assert.equal(b.health, 800, 'a shooter on good ground deals double');
  a.dead = true;
  W.hurt(b, 100, a);
  assert.equal(b.health, 700, 'a dead shooter gives no bonus');
  b.x = rock.x;
  b.y = rock.y;
  W.tickSurfaces();
  W.hurt(b, 100, null);
  assert.equal(b.health, 650, 'terrain or other unowned damage is still reduced on good ground');
}

{
  const W = world(endor);
  const u = trooperAt(W, find(endor, 'grass'));
  W.tickSurfaces();
  let calls = 0;
  const real = W.terrain;
  W.terrain = new Proxy(real, {
    get(t, k) {
      if (k === 'layerIndex') calls++;
      return t[k];
    }
  });
  for (let i = 0; i < 10; i++) W.tickSurfaces();
  assert.equal(calls, 0, 'a standing unit does not look the surface up again');
  u.x += 30;
  W.tickSurfaces();
  assert.equal(calls, 1, 'a moving unit looks it up once per tick');
}
console.log('land surface status ok');
