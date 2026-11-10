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
const { surfaceAt, surfaceStatus, SURFACES } = await import('../public/js/game/landsurface.js');
const { heightAt } = await import('../public/js/game/terrain.js');

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

console.log('land surface status ok');
