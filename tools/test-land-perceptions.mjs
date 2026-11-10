import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { Mind, target, loadHintSets } = await import('../public/js/game/landbrain.js');
const sets = await loadHintSets();
const test = sets.get('TEST_HINT_SET');
assert(test && test.has('HIGH_GROUND') && !test.has('OFFENSEDELAYGROUND'), 'Test_Hint_Set read from Data/XML/AI/HintSets');
const zone = { index: 1, x: 100, y: 100, props: { High_Ground: '2', OffenseDelayGround: '90' } };
const team = [0, 1, 2],
  wild = 3;
const w = {
  wild,
  team,
  units: [],
  zoneAt: new Map(),
  ally: (a, b) => a === b || (team[a] !== undefined && team[a] === team[b]),
  groundZ: () => 0
};
const mind = Object.assign(Object.create(Mind.prototype), { w, side: 0, b: { hints: test }, memo: new Map() });
mind.zoneOf = () => zone;
const see = (name, t) => mind.see(name, [], t);
const spot = target.zone(zone);
assert.equal(see('Variable_Target.Hints.High_Ground', spot), 2, 'a zone value named in Test_Hint_Set');
assert.equal(see('Variable_Target.Hints.OffenseDelayGround', spot), 0, 'a zone value not in Test_Hint_Set is dropped');
assert.equal(see('Variable_Target.Hints.Retreat', spot), 0, 'missing zone value falls back to the set default');
const unit = (side, x, extra = {}) => ({ side, x, y: 0, z: 0, type: { name: 'X' }, ...extra });
assert.equal(see('Variable_Target.Hints.High_Ground', target.unit(unit(1, 100))), 0, 'unit evaluators have no hints');
const shield = (side, x, extra = {}) => unit(side, x, { dome: { on: true, r: 100 }, ...extra });
const at = target.place(50, 0);
const inside = name => see('Variable_Target.' + name, at);
w.units = [shield(-1, 0)];
assert.equal(inside('IsInsideFriendlyShield'), 1, 'a neutral shield counts as friendly');
assert.equal(inside('IsInsideEnemyShield'), 0);
w.units = [shield(wild, 0)];
assert.equal(inside('IsInsideFriendlyShield'), 1, 'a map-owned shield counts as friendly');
w.units = [shield(1, 0)];
assert.equal(inside('IsInsideEnemyShield'), 1);
assert.equal(inside('IsInsideFriendlyShield'), 0);
w.units = [shield(1, 0, { z: 90 })];
assert.equal(inside('IsInsideEnemyShield'), 0, 'distance is measured in 3D');
w.units = [shield(1, 0, { dome: { on: false, r: 100 } })];
assert.equal(inside('IsInsideEnemyShield'), 0, 'a shield that is down protects nothing');
w.units = [shield(0, 0)];
assert.equal(inside('IsInsideFriendlyShield'), 1);
assert.equal(see('Game.IsLandControlGame', null), 0, 'a team land game is no land control game');
w.landControl = true;
assert.equal(see('Game.IsLandControlGame', null), 1, 'the capture control points game');
assert.equal(see('Game.IsSetupPhase', null), 0, 'no setup phase: SetupPhaseEnabled is off in the game constants');
console.log('ok');
