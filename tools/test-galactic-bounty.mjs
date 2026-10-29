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
const { galacticBounty, ownerCorruption } = await import('../public/js/game/galacticbounty.js');
const { bountyValue } = await import('../public/js/game/bounty.js');
const collectors = [...db.factions.values()].filter(f => f.bool('Benefits_From_Corruption')).map(f => f.name);
if (!collectors.length) {
  console.log('no faction benefits from corruption here: skipped');
  process.exit(0);
}
const uw = collectors[0],
  foe = [...db.factions.values()].find(
    f =>
      f.bool('Is_Playable') &&
      !f.bool('Benefits_From_Corruption') &&
      !f.list('Allies').includes(uw) &&
      !db.faction(uw).list('Allies').includes(f.name)
  )?.name;
const unit = [...db.types.values()].find(t => bountyValue(t, false) > 0);
const value = bountyValue(unit, false);
const mk = (corruption, nal = null) => ({
  galaxy: {
    players: [
      { faction: uw, credits: 100 },
      { faction: foe, credits: 100 }
    ],
    planets: [
      { type: { name: 'Kuat' }, owner: foe, currentCorruption: corruption, index: 0 },
      ...(nal ? [{ type: { name: 'NalHutta' }, owner: nal, index: 1 }] : [])
    ]
  },
  story: {}
});
const rec = { type: unit };
let game = mk(3);
assert.equal(galacticBounty(game, rec, game.galaxy.planets[0], foe, uw), Math.round(value));
assert.equal(game.galaxy.players[0].credits, 100 + Math.round(value));
assert.equal(game.galaxy.players[0].bounty, Math.round(value));
game = mk(-1);
assert.equal(galacticBounty(game, rec, game.galaxy.planets[0], foe, uw), 0);
game = mk(3);
game.story.bountyOn = false;
assert.equal(galacticBounty(game, rec, game.galaxy.planets[0], foe, uw), 0);
game = mk(3);
assert.equal(galacticBounty(game, rec, game.galaxy.planets[0], uw, uw), 0);
assert.equal(galacticBounty(game, rec, game.galaxy.planets[0], foe, null), 0);
game = mk(-1, foe);
assert.equal(galacticBounty(game, rec, game.galaxy.planets[0], uw, foe), Math.round(value));
game = mk(-1, uw);
assert.equal(galacticBounty(game, rec, game.galaxy.planets[0], uw, foe), 0, 'only for the owner of Nal Hutta');
const planet = { currentCorruption: -1 },
  galaxy = { time: 0 };
ownerCorruption(planet, foe, uw, galaxy);
assert.equal(planet.corruptionKind, 'corrupt');
assert.equal(planet.corruptionPending, 3);
console.log('ok', uw, foe, value);
