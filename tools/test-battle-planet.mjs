import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
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
const { battlePlanetName } = await import('../public/js/game/battleplanet.js');
const { retreatDestination } = await import('../public/js/game/fleetretreat.js');

const type =
  [...db.types.values()].find(t => t.str('Text_ID') && db.t(t.str('Text_ID')) && /^Coruscant$/i.test(t.name)) ||
  [...db.types.values()].find(t => /PLANET/i.test(t.str('Text_ID')) && db.t(t.str('Text_ID')));
assert(type, 'a planet type with a name');
assert.equal(battlePlanetName({ setup: { campaign: { planetType: type.name } }, map: {} }), db.t(type.str('Text_ID')));
assert.equal(
  battlePlanetName({ setup: {}, map: { planet: 'Skirmish - Somewhere' } }),
  'Somewhere',
  'a skirmish names the place its map does'
);
assert.equal(battlePlanetName({ setup: {}, map: {} }), '');

const unit = { dead: false, type: [...db.types.values()].find(t => t.name) };
const planet = (index, x, extra = {}) => ({
  index,
  name: 'P' + index,
  pos: [x, 0, 0],
  owner: null,
  destroyed: false,
  background: false,
  garrison: [],
  groundStructures: [],
  station: null,
  ...extra
});
const from = planet(0, 0, { owner: 'EMPIRE' }),
  withFleet = planet(1, 1, { owner: 'EMPIRE' }),
  withBase = planet(2, 5, { owner: 'EMPIRE', groundBaseOwner: 'EMPIRE' });
const g = { planets: [from, withFleet, withBase], fleets: [{ owner: 'EMPIRE', planet: 1, units: [unit], leg: null }] };
assert.equal(retreatDestination(g, from, 'EMPIRE', true).index, 1, 'the nearest fleet world first');
assert.equal(retreatDestination(g, from, 'EMPIRE', true, true).index, 2, 'a forced land battle tries the base world first');
assert.equal(retreatDestination(g, from, 'EMPIRE', false, true).index, 1, 'the space retreat never swaps');
console.log('PASS');
archive.close();
