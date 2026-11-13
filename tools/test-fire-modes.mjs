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
const { hardpointModes, fireMode, modeAllows } = await import('../public/js/game/firemodes.js');
await loadGameData();

const on = kind => ({ active: true, def: { kind } });
const off = kind => ({ active: false, def: { kind } });

const rocket = db.hardpoint('HP_T4B_Tank_03'),
  ion = db.hardpoint('HP_BOMBER_04'),
  thrawn = db.hardpoint('HP_Thrawn_SD_Weapon_FL');
assert(rocket && ion && thrawn, 'base hardpoints with fire mode flags exist');
assert.equal(hardpointModes(rocket), 4 | 2 | 8, 'rocket-only missiles: not in normal mode');
assert.equal(hardpointModes(ion), 1 | 2 | 8, 'bomber ion cannon: not in rocket attack mode');
assert.equal(hardpointModes(thrawn), 15, 'no flag set: fires in every mode');

assert.equal(fireMode([]), 1, 'no ability on: normal attack mode');
assert.equal(fireMode([off('ROCKET_ATTACK')]), 1);
assert.equal(fireMode([on('ROCKET_ATTACK')]), 4);
assert.equal(fireMode([on('POWER_TO_WEAPONS'), on('TURBO')]), 2 | 8);
assert.equal(fireMode([on('FULL_SALVO')]), 1, 'other abilities leave the attack mode normal');

assert.equal(modeAllows(hardpointModes(rocket), []), false, 'rocket missiles hold fire in normal mode');
assert.equal(modeAllows(hardpointModes(rocket), [on('ROCKET_ATTACK')]), true, 'and fire in rocket attack mode');
assert.equal(modeAllows(hardpointModes(ion), [on('ROCKET_ATTACK')]), false, 'the ion cannon holds fire in rocket attack mode');
assert.equal(modeAllows(hardpointModes(ion), []), true);
assert.equal(modeAllows(1 | 4, [on('POWER_TO_WEAPONS'), on('ROCKET_ATTACK')]), false, 'every active mode must allow the weapon');
console.log('PASS: fire mode flags');
