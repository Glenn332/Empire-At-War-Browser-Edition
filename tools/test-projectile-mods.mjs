import assert from 'node:assert/strict';
import { openGame } from './megfs.mjs';
import { fileURLToPath } from 'node:url';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = decodeURIComponent(path.replace(/^asset\//, ''))
    .replaceAll('/', String.fromCharCode(92))
    .toUpperCase();
  const data = archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
const { projectileMod, ProjectileMods } = await import('../public/js/game/projectilemods.js');
const { MOD } = await import('../public/js/game/combatmods.js');
await loadGameData();

const P = db.type('Proj_MAL_Carbonite_Missile');
assert(P, 'base carbonite missile exists');
const pm = projectileMod(P);
assert(pm, 'its combat mod is read');
assert.equal(pm.type, MOD.SPEED);
assert.equal(pm.value, -0.8);
assert.equal(pm.dur, 10);
assert.deepEqual(pm.cats, ['VEHICLE', 'INFANTRY', 'LANDHERO']);
assert.equal(projectileMod(db.type('Proj_Ship_Turbolaser_Green')), null, 'a plain shot has none');

const vehicle = [...db.types.values()].find(t => t.categories().has('VEHICLE')),
  ship = [...db.types.values()].find(t => t.categories().has('CAPITAL'));
const book = new ProjectileMods(),
  applied = [],
  dropped = [];
const car = { type: vehicle, dead: false },
  cap = { type: ship, dead: false };
book.apply(0, car, P, (u, m) => applied.push([u, m]));
book.apply(0, cap, P, (u, m) => applied.push([u, m]));
assert.equal(applied.length, 1, 'only targets in the category mask take it');
book.apply(6, car, P, () => {});
assert.equal(book.live.length, 1, 'a second hit refreshes the same effect');
book.tick(15, (u, m) => dropped.push(u));
assert.equal(dropped.length, 0, 'the refresh moved the end time');
book.tick(16, (u, m) => dropped.push(u));
assert.deepEqual(dropped, [car], 'it ends after its duration');
assert.equal(book.live.length, 0);
console.log('PASS: projectile combat mods');
