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
const { hardpointModes, hardpointDelays, modeAllows, modeDelay, rechargeDelay, ALL_MODES } = await import('../public/js/game/firemodes.js');
await loadGameData();

const on = kind => ({ active: true, def: { kind } });
const off = kind => ({ active: false, def: { kind } });

const rocket = db.hardpoint('HP_T4B_Tank_03'),
  ion = db.hardpoint('HP_BOMBER_04'),
  thrawn = db.hardpoint('HP_Thrawn_SD_Weapon_FL');
assert(rocket && ion && thrawn, 'base hardpoints with fire mode flags exist');
assert.equal(hardpointModes(rocket), 4 | 2 | 8 | 16, 'rocket-only missiles: not in normal mode');
assert.equal(hardpointModes(ion), 1 | 2 | 8 | 16, 'bomber ion cannon: not in rocket attack mode');
assert.equal(hardpointModes(thrawn), ALL_MODES, 'no flag set: fires in every mode');

assert.equal(modeAllows(hardpointModes(rocket), []), false, 'rocket missiles hold fire in normal mode');
assert.equal(modeAllows(hardpointModes(rocket), [on('ROCKET_ATTACK')]), true, 'and fire in rocket attack mode');
assert.equal(modeAllows(hardpointModes(ion), [on('ROCKET_ATTACK')]), false, 'the ion cannon holds fire in rocket attack mode');
assert.equal(modeAllows(hardpointModes(ion), []), true);
assert.equal(modeAllows(1 | 4, [on('POWER_TO_WEAPONS'), on('ROCKET_ATTACK')]), false, 'every active mode must allow the weapon');
assert.equal(modeAllows(1 | 2, [on('POWER_TO_WEAPONS')]), true, 'normal attack mode means rocket attack is off, whatever else is on');
assert.equal(modeAllows(2 | 4, [on('POWER_TO_WEAPONS')]), false, 'a weapon barred from normal mode holds fire under power to weapons alone');
assert.equal(modeAllows(1, [off('X'), off('Y'), on('TURBO')]), true, 'only the first two ability slots count');

const salvo = db.hardpoint('HP_Interceptor4_Frigate_Weapon_FL') || [...db.hardpoints.values()].find(h => h.has('Full_Salvo_Weapon_Delay_Multiplier'));
const hp = { delays: hardpointDelays(salvo) };
assert.deepEqual(hp.delays, { FULL_SALVO: 0.18 }, 'the base Interceptor IV hardpoint sets its full salvo delay');
assert.deepEqual(hardpointDelays(thrawn), { POWER_TO_WEAPONS: 0.5 });
assert.equal(hardpointDelays(rocket), null, 'unset multipliers default to 1');
assert.equal(modeDelay(hp, [on('FULL_SALVO')]), 0.18);
assert.equal(modeDelay(hp, []), 1);
assert.equal(rechargeDelay({ delays: { TURBO: 2 } }, [on('TURBO')]), 1, 'a multiplier above 1 leaves the burst recharge alone');
assert.equal(modeDelay({ delays: { TURBO: 2 } }, [on('TURBO')]), 2, 'and still stretches the pulse delay');
console.log('PASS: fire mode flags and weapon delay multipliers');
