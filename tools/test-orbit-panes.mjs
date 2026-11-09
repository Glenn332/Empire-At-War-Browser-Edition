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
const { orbitPanes, orbitController } = await import('../public/js/game/orbitpanes.js');

const T = n => db.type(n);
const xwing = T('X-Wing_Squadron') || T('Rebel_X-Wing_Squadron') || T('Y-Wing_Squadron') || [...db.types.values()].find(t => /squadron/i.test(t.name) && /rebel/i.test(t.str('Affiliation'))),
  corvette = T('Corellian_Corvette'),
  tie = T('TIE_Fighter_Squadron') || T('Tie_Fighter_Squadron'),
  superType = [...db.types.values()].find(t => t.list('CategoryMask').some(m => /^super$/i.test(m)) && t.str('Affiliation').toUpperCase().includes('EMPIRE'));
assert.ok(xwing && corvette && tie && superType);
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && !t.bool('Planet_Starbase_Stealth'));
const P = i => ({ index: i, type: planetType, owner: 'Rebel', pos: [0, 0, 0] });
const F = (owner, planet, slot, ...types) => ({ owner, planet, slot, leg: null, units: types.map(type => ({ type, owner })) });
const make = (fleets, overlay = false) => ({ planets: [P(0)], fleets, visibility: { planets: [{ discovered: true, fleetOverlay: overlay }] } });
const panes = g => orbitPanes(g, 'Rebel').spots.map(s => [s.displaySlot, s.fleets.map(f => g.fleets.indexOf(f))]);

{
  const g = make([F('Rebel', 0, 0, xwing), F('Rebel', 0, 0, corvette), F('Rebel', 0, 1, xwing), F('Rebel', 0, 1, corvette)]);
  assert.deepEqual(panes(g), [[0, [0, 1]], [1, [2]]], 'own orbit: slot 0 merges, a second fleet in slot 1 is not shown');
}
{
  const g = make([F('Rebel', 0, 0, xwing), F('Empire', 0, 1, tie)], true);
  assert.deepEqual(panes(g), [[0, [1]], [2, [0]]], 'mixed orbit: the local slot 0 fleet moves to the right, others go left');
}
{
  const g = make([F('Rebel', 0, 1, xwing), F('Empire', 0, 0, tie)], false);
  assert.deepEqual(panes(g), [[1, [0]]], 'without fleet intelligence an enemy fleet stays hidden');
  assert.equal(orbitController(g, g.planets[0], g.fleets), 'Rebel');
}
{
  const g = make([F('Rebel', 0, 1, xwing), F('Empire', 0, 0, tie, superType)], false);
  assert.deepEqual(panes(g), [[0, [1]], [1, [0]]], 'a Super ship in orbit shows the fleets there');
}
{
  const g = make([F('Empire', 0, 0, tie)], false);
  g.planets[0].owner = 'Empire';
  assert.deepEqual(panes(g), [], 'no allied fleet and no intelligence: nothing shown');
  g.fleets.push(F('Rebel', 0, 2));
  assert.deepEqual(panes(g), [], 'empty fleets are never shown');
}
console.log('ok');
