import assert from 'node:assert/strict';
import { CombatMods, MOD, combatBonus } from '../public/js/game/combatmods.js';

{
  const m = new CombatMods();
  assert.equal(m.factor(MOD.DAMAGE), 1, 'nothing registered: no change');
  m.add(MOD.DAMAGE, 0, 'a', 0.25);
  m.add(MOD.DAMAGE, 0, 'b', 0.5);
  m.add(MOD.DAMAGE, 0, 'c', 0.1);
  assert.equal(m.sum(MOD.DAMAGE), 0.5, 'one stacking key keeps its largest entry');
  m.add(MOD.DAMAGE, 3, 'd', 0.25);
  m.add(MOD.DAMAGE, -1, 'e', 0.25);
  assert.equal(m.sum(MOD.DAMAGE), 1, 'stacking keys add');
  assert.equal(m.remove(MOD.DAMAGE, 0, 'b'), true);
  assert.equal(m.sum(MOD.DAMAGE), 0.75, 'removing a source falls back to the next largest of its key');
  assert.equal(m.remove(MOD.DAMAGE, 3, 'b'), false, 'a source is removed only from the key it is in');
  assert.equal(m.drop('d'), true);
  assert.equal(m.drop('d'), false);
  assert.equal(m.sum(MOD.DAMAGE), 0.5);
  m.drop('a');
  m.drop('c');
  m.drop('e');
  assert.equal(m.size, 0);
  assert.equal(m.factor(MOD.DAMAGE), 1, 'everything unregistered restores');
}

{
  const m = new CombatMods();
  m.add(MOD.SPEED, 0, 'a', -0.6);
  m.add(MOD.SPEED, 1, 'b', -0.6);
  assert.equal(m.sum(MOD.SPEED), -0.99, 'speed stops at -0.99');
  m.add(MOD.DEFENSE, 0, 'a', 0.5);
  m.add(MOD.DEFENSE, 1, 'b', 0.5);
  assert.equal(m.sum(MOD.DEFENSE), 0.75, 'defense stops at 0.75');
  m.add(MOD.DAMAGE, 0, 'a', -0.8);
  m.add(MOD.DAMAGE, 1, 'b', -0.8);
  assert.equal(m.sum(MOD.DAMAGE), -1, 'damage stops at -1');
  m.add(MOD.HEALTH, 0, 'a', -0.8);
  m.add(MOD.HEALTH, 1, 'b', -0.8);
  assert.equal(m.sum(MOD.HEALTH), -0.99, 'health stops at -0.99');
  m.add(MOD.SIGHT, 0, 'a', -0.8);
  m.add(MOD.SIGHT, 1, 'b', -0.8);
  assert.equal(Math.round(m.sum(MOD.SIGHT) * 100), -160, 'sight and fire range have no bound');
  m.add(MOD.DAMAGE, 0, 'x', -0.1);
  assert.equal(m.sum(MOD.DAMAGE), -0.9, 'the largest of a key is the least negative');
}

{
  const m = new CombatMods();
  assert.equal(m.set(MOD.RANGE, 0, 'a', 0.25), true);
  assert.equal(m.set(MOD.RANGE, 0, 'a', 0.25), false, 'setting the same value again changes nothing');
  assert.equal(m.set(MOD.RANGE, 0, 'a', 0.5), true);
  assert.equal(m.sum(MOD.RANGE), 0.5, 'set replaces the entry of its source');
  const v = m.version;
  m.sum(MOD.RANGE);
  assert.equal(m.version, v, 'reading does not change the container');
}

{
  const sides = [new CombatMods(), new CombatMods()],
    unit = { side: 0 },
    m = new CombatMods(sides, unit);
  m.add(MOD.DEFENSE, 0, 'own', 0.25);
  sides[0].add(MOD.DEFENSE, 0, 'player', 0.5);
  assert.equal(m.sum(MOD.DEFENSE), 0.5, 'player and object entries of a key: the largest wins');
  sides[0].add(MOD.DEFENSE, 1, 'player', 0.1);
  assert.equal(m.sum(MOD.DEFENSE), 0.6, 'a player key the object lacks adds');
  sides[0].remove(MOD.DEFENSE, 0, 'player');
  assert.equal(m.sum(MOD.DEFENSE), 0.35, 'a change to the player container is seen at once');
  unit.side = 1;
  assert.equal(m.sum(MOD.DEFENSE), 0.25, 'a unit that changes side reads its new player');
  sides[1].add(MOD.SPEED, 0, 'player', 0.5);
  sides[1].add(MOD.BUILD, 0, 'player', 0.5);
  sides[1].add(MOD.FIRE_RATE, 0, 'player', 0.5);
  assert.equal(m.sum(MOD.SPEED), 0, 'speed reads the object only');
  assert.equal(m.sum(MOD.BUILD), 0, 'build time reads the object only');
  assert.equal(m.sum(MOD.FIRE_RATE), 0.5, 'fire rate reads both');
}

{
  const node = fields => ({ num: (k, d) => (k in fields ? fields[k] : d) });
  const b = combatBonus(
    node({
      Stacking_Category: 3,
      Health_Bonus_Percentage: 0.25,
      Damage_Bonus_Percentage: -1,
      Defense_Bonus_Percentage: 1.5,
      Movement_Speed_Bonus_Percentage: 0.15,
      Fire_Range_Bonus_Percentage: 0.1
    })
  );
  assert.equal(b.key, 3);
  assert.deepEqual(
    b.mods,
    [
      [MOD.HEALTH, 0.25],
      [MOD.SPEED, 0.15],
      [MOD.RANGE, 0.1]
    ],
    'zero fields are skipped, -1 or less and a defense over 1 are refused as the engine does'
  );
  assert.equal(combatBonus(node({})).key, 0, 'Stacking_Category defaults to 0');
}

console.log('combat modifiers ok');
