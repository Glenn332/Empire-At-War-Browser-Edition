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
const R = await import('../public/js/game/tacticalrules.js');

const both = [...db.types.values()].find(
  t => t.num('Tactical_Build_Cost_Campaign', 0) > 0 && t.num('Tactical_Build_Cost_Campaign', 0) !== t.num('Tactical_Build_Cost_Multiplayer', 0)
);
assert.ok(both, 'the data has a type with its own campaign cost');
const mp = both.num('Tactical_Build_Cost_Multiplayer', 0),
  camp = both.num('Tactical_Build_Cost_Campaign', 0);
R.setTacticalRules({ campaign: false });
assert.equal(R.tacticalCost(both), mp, 'skirmish pays the multiplayer cost');
assert.equal(R.buildListTag(), 'Tactical_Buildable_Objects_Multiplayer');
R.setTacticalRules({ campaign: true });
assert.equal(R.tacticalCost(both), camp, 'a campaign battle pays the campaign cost');
assert.equal(R.buildListTag(), 'Tactical_Buildable_Objects_Campaign');
R.setSkirmishRules(true);
assert.equal(R.tacticalCost(both), mp, 'SKIRMISH_RULES brings the multiplayer cost back');
const real = db.faction;
db.faction = n => (n === 'Scaled' ? { list: () => ['1.0, 1.5'] } : real.call(db, n));
R.setTacticalRules({ campaign: true, corrupted: true });
assert.equal(R.padCost(both, 'Scaled'), Math.trunc(camp * 1.5), 'a corrupted battle planet scales the pad price by the second entry, truncated');
assert.equal(R.padCost(both, 'Empire'), camp, 'the shipped factions keep 1.0');
R.setTacticalRules({ campaign: true, corrupted: false });
assert.equal(R.padCost(both, 'Scaled'), camp);
db.faction = real;
R.setTacticalRules({ campaign: false });
console.log('ok', both.name, mp, camp);
