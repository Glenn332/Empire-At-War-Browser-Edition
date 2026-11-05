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
const { stepPolitics, presenceController, politicalGoal } = await import('../public/js/game/galacticpolitics.js');
const playable = [...db.factions.values()].filter(f => f.bool('Is_Playable')).map(f => f.name),
  [a, b] = playable,
  neutral = [...db.factions.values()].find(f => f.bool('Is_Neutral')).name;
const planets = [...db.types.values()].filter(t => t.num('Planet_Credit_Value', -1) >= 0 && t.has?.('Planet_Surface_Accessible'));
const land =
    planets.find(t => t.bool('Planet_Surface_Accessible', true) && !t.bool('Planet_Retains_Residual_Influence')) ||
    planets.find(t => t.bool('Planet_Surface_Accessible', true)),
  space = planets.find(t => !t.bool('Planet_Surface_Accessible', true));
assert(land && space, 'a land planet and a space-only planet');
const plain = { num: () => 0, bool: () => false, sub: () => [], str: () => '', list: () => [] };
const ship = control => ({ ...plain, num: (k, d) => (k === 'Political_Control' ? control : d) });
const planet = (type, owner, over = {}) => ({
  index: 0,
  type,
  owner,
  groundStructures: [],
  orbitalStructures: [],
  garrison: [],
  station: null,
  spaceLevel: 0,
  production: { space: [], ground: [] },
  ...over
});
const galaxy = (p, fleets = []) => ({ planets: [p], fleets, routes: [], time: 0, players: [] });
const fleet = (owner, units = [{ type: ship(0) }], over = {}) => ({ owner, units, planet: 0, leg: null, ...over });
const claim = (p, fleets = []) => presenceController(galaxy(p, fleets), p, fleets.filter(f => !f.leg));

assert.deepEqual(
  claim(planet(land, a, { groundStructures: [{ owner: b, type: plain }], garrison: [{ owner: a, type: plain }] })),
  { owner: b, by: 'base' },
  'the ground base comes before troops'
);
assert.deepEqual(claim(planet(land, a, { garrison: [{ owner: b, type: plain, dead: true }, { owner: a, type: plain }] })), {
  owner: a,
  by: 'troops'
});
assert.deepEqual(claim(planet(land, a, { station: plain, stationOwner: b, spaceLevel: 1 })), { owner: b, by: 'starbase' });
assert.deepEqual(claim(planet(land, a, { production: { space: [{ owner: a }], ground: [] } })), { owner: a, by: 'production' });
assert.deepEqual(
  claim(planet(land, a), [fleet(b)]),
  land.bool('Planet_Retains_Residual_Influence') ? { owner: a, by: 'residual' } : { owner: neutral, by: 'neutral' },
  'a fleet does not claim a reachable surface'
);
assert.deepEqual(claim(planet(space, a), [fleet(b)]), { owner: b, by: 'orbit' }, 'a fleet claims a space-only planet');
assert.deepEqual(claim(planet(space, a), [fleet(b, [{ type: plain }], { leg: {} })]).owner, space.bool('Planet_Retains_Residual_Influence') ? a : neutral);
assert.deepEqual(claim(planet(land, a, { destroyed: true }), [fleet(b)]), { owner: b, by: 'orbit' }, 'a destroyed planet is claimed from orbit');
assert.equal(claim(planet(land, a, { destroyed: true })).owner, neutral, 'a destroyed planet keeps no residual influence');

let changes = [];
const step = (g, dt = 0.5) => {
  g.time += dt;
  stepPolitics(g, dt, (pl, old, by) => changes.push([pl.owner, old, by]));
};
let p = planet(land, a),
  g = galaxy(p);
step(g);
assert.equal(p.owner, land.bool('Planet_Retains_Residual_Influence') ? a : neutral, 'an empty planet is settled at once');
assert.deepEqual(changes, [], 'the first evaluation sets the controller without a hand-over');

p = planet(land, a, { garrison: [{ owner: a, type: plain }] });
g = galaxy(p);
step(g);
assert.equal(p.owner, a);
const troops = p.garrison.splice(0);
step(g);
if (!land.bool('Planet_Retains_Residual_Influence')) {
  assert.equal(p.owner, neutral, 'the last troops leave and the planet goes neutral');
  assert.deepEqual(changes, [[neutral, a, 'neutral']]);
  assert.equal(p.politicalValue, 0, 'the meter starts again');
}
changes = [];
p.garrison.push(...troops);
step(g);
assert.equal(p.owner, a, 'troops landing on a neutral planet take it');
assert.deepEqual(changes, [[a, land.bool('Planet_Retains_Residual_Influence') ? undefined : neutral, 'troops']].filter(c => c[1]));

changes = [];
p = planet(space, a, { station: plain, stationOwner: a, spaceLevel: 1 });
const orbit = [fleet(b)];
g = galaxy(p, orbit);
step(g);
assert.equal(p.owner, a, 'a star base holds the planet against a fleet');
p.station = null;
p.spaceLevel = 0;
step(g);
assert.equal(p.owner, b, 'without the star base the fleet in orbit takes it');
assert.deepEqual(changes, [[b, a, 'orbit']]);
g.fleets = [];
step(g);
assert.equal(p.owner, space.bool('Planet_Retains_Residual_Influence') ? b : neutral, 'residual influence keeps the last controller');

p = planet(land, a, { groundStructures: [{ owner: a, type: plain }, { owner: a, type: plain }, { owner: a, type: plain }] });
const target = (fleets, by = 'base') => politicalGoal(galaxy(p, fleets), p, fleets, by).target;
const base = target([]);
assert.equal(target([fleet(a, [{ type: ship(1) }])]), base, 'own capital ships are one entry of the presence group, not added');
assert.equal(target([fleet(b, [{ type: ship(1) }])]), Math.max(1, base - 1), 'enemy capital ships take one away');
console.log('ok', land.name, space.name, 'neutral', neutral);
