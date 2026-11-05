import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const key = s => String(s || '').toUpperCase();
const sliceable = f =>
  [...db.types.values()].filter(
    t => t.list('Affiliation').some(n => key(n) === key(f)) && t.bool('Build_Initially_Locked') && t.bool('Build_Can_Be_Unlocked_By_Slicer')
  );
const faction = db.faction('Rebel')?.name;
if (!faction || !sliceable(faction).length) {
  console.log('no slicer-unlockable Rebel types in this data: skipped');
  process.exit(0);
}
const types = sliceable(faction);
const level = Math.min(...types.map(t => t.num('Tech_Level', 0)));
const atLevel = types.filter(t => t.num('Tech_Level', 0) <= level);
const run = (who, unlocked, give, tech = level) => {
  const player = { faction: who, tech, maxTech: 5, unlockedTypes: [...unlocked], lockedTypes: [] },
    signals = [];
  const host = {
    game: { me: faction, galaxy: { players: [player], planets: [], fleets: [] } },
    commonReward: () => false,
    signalTech: (f, l) => signals.push([f, l])
  };
  GalacticStoryHost.prototype.reward.call(host, { reward: 'BUILDABLE_UNIT', rewards: [give, ''], plot: { owner: who } });
  return { player, signals };
};
const last = atLevel.at(-1).name,
  rest = atLevel.slice(0, -1).map(t => key(t.name));
let r = run(faction, rest, last);
assert.equal(r.player.tech, level + 1, 'the last locked type at the level raises the tech level');
assert.deepEqual(r.signals, [[faction, level + 1]], 'the story hears the new level');
if (atLevel.length > 1) {
  r = run(faction, rest.slice(1), last);
  assert.equal(r.player.tech, level, 'a locked type left at the level keeps it');
}
const other = [...db.factions.values()].find(f => f.bool('Is_Playable') && key(f.name) !== 'REBEL')?.name;
if (other) {
  r = run(other, [], last);
  assert.equal(r.player.tech, level, 'only the Rebel faction advances this way');
}
r = run(faction, rest, last, 5);
assert.equal(r.player.tech, 5, 'never past the maximum');
console.log('ok', faction, 'level', level, atLevel.length, 'types at the level');
