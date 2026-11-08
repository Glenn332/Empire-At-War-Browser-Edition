import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { panelSide } = await import('../public/js/game/panelside.js');
const { runCommand, recordRef } = await import('../public/js/game/galacticnet.js');
const bm = await import('../public/js/game/blackmarket.js');
const humans = new Set(['UNDERWORLD', 'EMPIRE']);
const game = { me: 'Underworld', localFaction: 'Underworld', isHuman: f => humans.has(String(f).toUpperCase()) };
assert.equal(panelSide(game, 'Underworld'), 'local', 'the local player opens its own panel');
game.me = 'Empire';
assert.equal(panelSide(game, 'Empire'), 'remote', 'while another player command runs here, no panel opens and nothing is chosen for it');
assert.equal(panelSide(game, 'Rebel'), 'ai', 'a computer player chooses at once');
const sp = { me: 'Rebel', isHuman: f => String(f).toUpperCase() === 'REBEL' };
assert.equal(panelSide(sp, 'Rebel'), 'local', 'single player keeps its own panel');
const items = await bm.loadBlackMarket();
const item = items[0],
  planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet'),
  hero = [...db.types.values()].find(t => t.bool('Is_Generic_Hero') || t.bool('Is_Named_Hero'));
const record = { type: hero, owner: 'Underworld' };
const g = {
  time: 0,
  planets: [{ index: 0, type: planetType, owner: 'Empire', garrison: [record], groundStructures: [], orbitalStructures: [], pos: [0, 0, 0] }],
  fleets: [],
  players: [{ faction: 'Underworld', credits: 1000, blackMarket: [] }]
};
const host = { galaxy: g, story: null, me: 'Underworld' };
const r = runCommand(host, 'Underworld', { c: 'panel', kind: 'market', rec: recordRef(g, record), p: 0, item: item.name, price: 10, respawn: 0 });
assert.equal(r.ok, true, 'a market purchase runs as a command');
assert.deepEqual(g.players[0].blackMarket, [item.name]);
assert.equal(g.players[0].credits, 1000 - 10);
assert.deepEqual(runCommand(host, 'Empire', { c: 'panel', kind: 'market', rec: recordRef(g, record), p: 0, item: item.name, price: 10, respawn: 0 }), {}, 'never for another player unit');
console.log('ok', item.name);
