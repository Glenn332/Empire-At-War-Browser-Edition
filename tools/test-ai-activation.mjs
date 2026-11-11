import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { Plans } = await import('../public/js/game/aiplans.js');

const P = Object.create(Plans.prototype);
const ai = { name: 'ai' },
  other = { name: 'other' };
const rush = { ai, gdef: { category: 'MAP_CONTROL' }, state: 'run' },
  scout = { ai, gdef: { category: 'TACTICAL_TARGETED' }, state: 'run' },
  story = { ai, state: 'run' },
  done = { ai, gdef: {}, state: 'over' };
const squad = v => ({ aiPlan: v });

assert.equal(P.open(squad(rush), ai), false, 'outside an activation a held unit is not open');
P.beginSelection(ai);
assert.equal(P.open(squad(rush), ai), true, 'activation releases the reservations of every goal plan');
assert.equal(P.open(squad(scout), ai), true);
assert.equal(P.open(squad(story), ai), false, 'a plan no goal started keeps its units');
assert.equal(P.open(squad(done), ai), true, 'a finished plan holds nothing');
assert.equal(P.open(squad(rush), other), false, 'only the activating player');
assert.equal(P.retain(rush), true, 'a kept goal reserves its units again');
assert.equal(P.open(squad(rush), ai), false, 'kept: no longer open in this pass');
assert.equal(P.open(squad(scout), ai), true, 'a category not yet worked stays open');
assert.equal(P.retain(done), false, 'a plan that lost a unit cannot be kept');
assert.equal(P.canRetain(done), false);
P.endSelection(ai);
assert.equal(P.open(squad(scout), ai), false, 'after the pass every unit is held again');

const goals = readFileSync(new URL('../public/js/game/landgoals.js', import.meta.url), 'utf8');
assert.ok(!/\.slice\(0, ext \+ running\.length\)/.test(goals), 'every proposal of a category is pooled, not only the extension');

const plans = readFileSync(new URL('../public/js/game/aiplans.js', import.meta.url), 'utf8');
assert.match(plans, /removable: true/, 'plans start removable, as the plan constructor writes it');

const R = Object.create(Plans.prototype);
let tick = null;
R.world = { time: 5, landEntry: () => true };
R.host = { land: true };
R.block = (fn, res, recipe) => ((tick = fn), recipe);
const inst = { ai: { player: {} }, removable: true, state: 'run' },
  f = { inst, pool: [1, 2], take: () => {} };
const recipe = R.reinforceWait(f, { x: 0, y: 0 }, Infinity);
assert.equal(inst.removable, false, 'land Reinforce clears the removable flag while it runs');
assert.equal(recipe.keep, true, 'and keeps the value it had');
tick();
assert.equal(inst.removable, false, 'still held while reinforcements are owed');
tick();
assert.equal(inst.removable, true, 'restored when the last has landed');
inst.removable = false;
const again = R.reinforceWait({ inst, pool: [1], take: () => {} }, { x: 0, y: 0 }, Infinity, 5, true);
assert.equal(again.keep, true, 'a loaded block keeps the saved value');

console.log('ai activation ok');
