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
const { scheduleHeroRespawn, forceHeroRespawn } = await import('../public/js/game/galacticherorespawn.js');
const named = [...db.types.values()].find(t => t.bool('Is_Named_Hero') && !t.has('Respawn_Tied_To_Structure'));
const plain = [...db.types.values()].find(
  t =>
    !t.bool('Is_Named_Hero') && !t.has('Respawn_Tied_To_Structure') && !t.list('Company_Units').some(n => db.type(n)?.bool('Is_Named_Hero'))
);
const game = { galaxy: { time: 10, planets: [{ killedHeroes: [] }] } };
const planet = game.galaxy.planets[0],
  base = Math.floor(10 * 30);
const deflt = db.constants.num('Default_Hero_Respawn_Time', -1);
assert.equal(scheduleHeroRespawn(game, { type: plain }, planet, 'Empire', null), false, 'a unit that is not a named hero is not queued');
if (deflt >= 0) {
  assert.equal(scheduleHeroRespawn(game, { type: named }, planet, 'Empire', 'Rebel'), true);
  assert.equal(planet.killedHeroes[0].dueFrame, base + Math.round(deflt * 30), 'the default time');
  planet.killedHeroes.length = 0;
} else assert.equal(scheduleHeroRespawn(game, { type: named }, planet, 'Empire', 'Rebel'), false, 'a negative default means no respawn');
assert.equal(scheduleHeroRespawn(game, { type: plain }, planet, 'Empire', null, 250, true), true);
assert.equal(planet.killedHeroes[0].dueFrame, base + 250 * 30);
assert.equal(scheduleHeroRespawn(game, { type: plain }, planet, 'Empire', null, 250, true), false, 'one entry for a hero of an owner');
assert.equal(forceHeroRespawn(game, plain.name), true);
assert.equal(planet.killedHeroes[0].dueFrame, base);
assert.equal(game.galaxy.heroRespawnNext, 0);
assert.equal(forceHeroRespawn(game, 'No_Such_Hero'), false);
console.log('ok, default', deflt);
