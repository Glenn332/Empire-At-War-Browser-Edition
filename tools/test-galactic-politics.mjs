import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) { const re = new RegExp(decodeURIComponent(path.slice(11)), 'i'); return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n)))); }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])), data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js'); await loadGameData();
const { stepPolitics, changeController, politicalGoal, politicallyHeld } = await import('../public/js/game/galacticpolitics.js');
const { planetIncome } = await import('../public/js/game/galacticeconomy.js');
const playable = [...db.factions.values()].filter(f => f.bool('Is_Playable')).map(f => f.name), [a, b] = playable;
const type = [...db.types.values()].find(t => t.num('Planet_Credit_Value', 0) > 0 && t.bool('Planet_Surface_Accessible', true)) || [...db.types.values()].find(t => t.num('Planet_Credit_Value', 0) > 0);
const change = db.constants.num('Political_Control_Change_Time_Seconds', 7);
const planet = (owner, over = {}) => ({ index: 0, type, owner, groundStructures: [], orbitalStructures: [], garrison: [{ owner, type: { num: () => 0, bool: () => false, sub: () => [] } }], station: null, spaceLevel: 0, ...over });
const galaxy = p => ({ planets: [p], fleets: [], routes: [], time: 0, players: [] });

let p = planet(a), g = galaxy(p);
stepPolitics(g, 1 / 30);
assert(p.politicalTarget >= 1, 'a controller has at least 1: ' + p.politicalTarget);
assert.equal(p.politicalValue, p.politicalTarget, 'it starts at full value');
assert(politicallyHeld(p));
const full = planetIncome(g, p, a);

changeController(p, b);
assert.equal(p.owner, b); assert.equal(p.politicalValue, 0);
assert(!politicallyHeld(p), 'a value of 0 is not held');
assert.equal(changeController(p, b), b, 'the same faction changes nothing'); assert.equal(p.politicalValue, 0);
g.time = 0.1; p.garrison = [{ owner: b, type: p.garrison[0].type }];
stepPolitics(g, 0.5);
const rate = p.politicalRate, expect = 0.5 / (rate * change);
assert(Math.abs(p.politicalValue - expect) < 1e-9, `the value climbs one level in ${change} s times the rate: ${p.politicalValue} vs ${expect}`);
if (p.politicalValue < 1) assert(planetIncome(g, p, b) < planetIncome({ ...g, planets: [{ ...p, politicalValue: 1 }] }, { ...p, politicalValue: 1 }, b) + 1e-6, 'a planet below 1 pays less');
for (let i = 0; i < 400; i++) { g.time += 1; stepPolitics(g, 1); if (p.politicalValue >= p.politicalTarget) break; }
assert.equal(p.politicalValue, p.politicalTarget);

const guard = { type: { sub: () => [{ all: tag => (tag === 'Political_Control_Protection_Ability' ? [{}] : []) }], num: () => 0, bool: () => false }, owner: a };
p = planet(a, { groundStructures: [guard] }); g = galaxy(p); stepPolitics(g, 0.1);
assert(politicalGoal(g, p).protect, 'the protecting ability is seen');
p.politicalValue = p.politicalTarget + 1; g.time = 1; p.politicalChecked = -1; stepPolitics(g, 1); assert.equal(p.politicalValue, p.politicalTarget + 1, 'protected: frozen');
const office = (value, category) => ({ type: { sub: () => [{ all: tag => (tag === 'Political_Transition_Bonus_Ability' ? [{ num: (k, d) => (k === 'Stacking_Category' ? category : k === 'Time_Reduction_Percentage' ? value : d) }] : []) }], num: () => 0, bool: () => false }, owner: a });
p = planet(a, { groundStructures: [office(0.25, 0), office(0.5, 0), office(0.1, 1)] });
const goal = politicalGoal(galaxy(p), p), align = politicalGoal(galaxy(planet(a)), planet(a)).rate;
assert(Math.abs(goal.rate - align * 0.25 * 0.1) < 1e-9, 'the smallest of each category, then multiplied: ' + goal.rate);
console.log('ok', a, b, 'change time', change, 'target', p.politicalTarget ?? goal.target);
