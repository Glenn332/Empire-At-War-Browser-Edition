import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
globalThis.fetch = async input => {
  const key = archive.resolve(decodeURIComponent(String(input).replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { raiseTech, unlockBelowTech, engineRoll } = await import('../public/js/game/galacticproduction.js');
const { seedSim, simRandom } = await import('../public/js/game/simrandom.js');

const key = s => String(s).toUpperCase();
const sliceable = f =>
  [...db.types.values()].filter(
    t => t.bool('Build_Initially_Locked') && t.bool('Build_Can_Be_Unlocked_By_Slicer') && t.list('Affiliation').some(n => key(n) === key(f))
  );
const types = sliceable('Rebel');
assert.ok(types.length, 'the data has sliceable Rebel types');
const top = Math.max(...types.map(t => t.num('Tech_Level', 0)));

const signals = [],
  sounds = [];
const player = { faction: 'Rebel', tech: 0, maxTech: 5, unlockedTypes: [], lockedTypes: [] };
const game = { me: 'Rebel', galaxy: { players: [player] }, story: { signalTech: (f, l) => signals.push([f, l]) }, audio: { play: s => sounds.push(s) } };
raiseTech(game, 'Rebel', top + 1);
assert.equal(player.tech, Math.min(5, top + 1));
assert.deepEqual(signals, [['Rebel', player.tech]], 'the story hears every level set');
const below = types.filter(t => t.num('Tech_Level', 0) < player.tech).map(t => key(t.name));
assert.deepEqual(new Set(player.unlockedTypes.map(key)), new Set(below), 'every sliceable type below the new level is unlocked');
assert.deepEqual(sounds, [db.faction('Rebel').str('SFXEvent_New_Construction_Options_Available')], 'the local player hears the new options');
raiseTech(game, 'Rebel', 99);
assert.equal(player.tech, 5, 'clamped to the maximum');
assert.equal(sounds.length, 1, 'no sound when nothing new unlocks');
const other = { faction: 'Rebel', tech: 2, unlockedTypes: [] };
unlockBelowTech(other);
assert.ok(other.unlockedTypes.every(n => db.type(n).num('Tech_Level', 0) < 2), 'a campaign start unlocks the levels below its start');

seedSim(7);
const a = engineRoll(0, 10, simRandom);
seedSim(7);
const raw = Math.floor(simRandom() * 32768) / 32767;
assert.equal(a, Math.fround(10 * Math.fround(raw)), 'the engine draw is a 15-bit fraction scaled in float32');
assert.ok(engineRoll(0, 1, () => 0.99999999) === 1, 'the draw can reach its top');
console.log('ok', types.length, 'sliceable Rebel types, top level', top);
