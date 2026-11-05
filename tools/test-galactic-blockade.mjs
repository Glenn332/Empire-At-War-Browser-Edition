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
const { orbitBlockaded, factionRelated } = await import('../public/js/game/galacticforces.js');
const playable = [...db.factions.values()].filter(f => f.bool('Is_Playable')).map(f => f.name),
  a = playable[0],
  b = playable.find(n => !factionRelated(a, n, true)),
  neutral = [...db.factions.values()].find(f => f.bool('Is_Neutral'))?.name;
const ally = [...db.factions.values()].map(f => f.name).find(n => n.toUpperCase() !== a.toUpperCase() && factionRelated(a, n, true));
const live = () => [{ type: null }];
const fleet = (owner, over = {}) => ({ owner, units: live(), planet: 0, leg: null, ...over });
const at = (owner, fleets) => [
  { planets: [{ index: 0, owner }], fleets },
  { index: 0, owner }
];
const check = (owner, fleets) => {
  const [g, p] = at(owner, fleets);
  return orbitBlockaded(g, p);
};
assert.equal(check(a, []), false, 'an empty orbit is no blockade');
assert.equal(check(a, [fleet(a)]), false, 'the owner fleet is no blockade');
assert.equal(check(a, [fleet(b)]), true, 'an enemy fleet blockades');
assert.equal(check(a, [fleet(b, { leg: {} })]), false, 'a fleet still moving does not count');
assert.equal(check(a, [fleet(b, { units: [{ dead: true }] })]), false, 'a fleet with no live unit does not count');
assert.equal(check(a, [fleet(b, { planet: 1 })]), false, 'a fleet at another planet does not count');
assert.equal(check(a, [fleet(a), fleet(b)]), false, 'the first fleet in orbit decides');
assert.equal(check(a, [fleet(b), fleet(a)]), true, 'the first fleet in orbit decides');
assert.equal(check(a, [fleet(b, { leg: {} }), fleet(a), fleet(b)]), false, 'a moving fleet is skipped for the next');
if (ally) assert.equal(check(a, [fleet(ally)]), false, 'an allied fleet is no blockade');
if (neutral) assert.equal(check(neutral, [fleet(a)]), true, 'a neutral planet with any fleet is blockaded');
console.log('ok', a, 'against', b, 'ally', ally ?? '(none)', 'neutral', neutral);
