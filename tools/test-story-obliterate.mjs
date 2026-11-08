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
const { obliterate } = await import('../public/js/game/galacticobliterate.js');
const [A, B] = [...db.factions.values()].filter(f => f.bool('Is_Playable')).map(f => f.name);
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet');
const station = [...db.types.values()].find(t => t.num('Base_Level', 0) > 0);
const u = owner => ({ type: planetType, owner });
const make = () => {
  const p = {
    index: 0,
    type: planetType,
    owner: A,
    station,
    stationOwner: A,
    spaceLevel: 2,
    garrison: [u(A), u(B)],
    groundStructures: [u(A)],
    orbitalStructures: [u(A)],
    production: {}
  };
  const g = { planets: [p], fleets: [{ owner: A, planet: 0, units: [u(A)] }, { owner: B, planet: 0, units: [u(B)] }, { owner: A, planet: 0, leg: {}, units: [u(A)] }] };
  const events = [];
  return { p, g, events, game: { galaxy: g, story: { stationChanged: (...a) => events.push(a), despawn: () => {} } } };
};
{
  const w = make();
  obliterate(w.game, w.p, A);
  assert.equal(w.p.station, null, 'the star base goes');
  assert.equal(w.p.spaceLevel, 0);
  assert.equal(w.p.stationOwner, null);
  assert.equal(w.events.length, 1, 'with the base destroyed story event');
  assert.equal(w.p.orbitalStructures.length, 0);
  assert.equal(w.p.groundStructures.length, 0, 'the ground base and special structures go');
  assert.deepEqual(w.p.garrison.map(x => x.owner), [B], 'landed companies of that player only');
  assert.deepEqual(w.g.fleets.map(f => f.owner), [B, A], 'orbiting fleets go, fleets in transit stay');
}
{
  const w = make();
  w.p.stationOwner = B;
  obliterate(w.game, w.p, A);
  assert.equal(w.p.station, station, 'a star base held by someone else stays');
  assert.equal(w.p.orbitalStructures.length, 1);
}
console.log('ok', A, B);
