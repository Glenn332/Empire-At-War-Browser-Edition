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
const { bountyValue, BountyBook, roundAway } = await import('../public/js/game/bounty.js');

const own = [...db.types.values()].find(t => t.num('Override_Bounty_SP', -1) > 0);
assert.equal(bountyValue(own, false), own.num('Override_Bounty_SP'), 'Override_Bounty_SP of a type');
const mp = [...db.types.values()].find(t => t.num('Override_Bounty_MP', -1) > 0);
assert.equal(bountyValue(mp, true), mp.num('Override_Bounty_MP'), 'Override_Bounty_MP');
const dflt = c => +db.constants.tuples('Default_Bounty_By_Category_SP').find(t => t[0].toUpperCase() === c)?.[1];
const byCategory = [...db.types.values()].find(
  t => !t.has('Override_Bounty_SP') && t.categories().has('CAPITAL') && !t.categories().has('SPACEHERO')
);
assert.equal(bountyValue(byCategory, false), dflt('CAPITAL'), 'no override: the Capital default');
const frigate = [...db.types.values()].find(
  t => !t.has('Override_Bounty_SP') && t.categories().has('FRIGATE') && !t.categories().has('CAPITAL') && !t.categories().has('SPACEHERO')
);
assert.equal(bountyValue(frigate, false), dflt('FRIGATE'));
const none = [...db.types.values()].find(
  t =>
    !t.has('Override_Bounty_SP') &&
    ![...t.categories()].some(c =>
      ['INFANTRY', 'VEHICLE', 'AIR', 'STRUCTURE', 'FIGHTER', 'BOMBER', 'CORVETTE', 'FRIGATE', 'CAPITAL', 'SPACEHERO', 'LANDHERO'].includes(
        c
      )
    )
);
assert.equal(bountyValue(none, false), 0, 'no category with a default: nothing');
const zero = [...db.types.values()].find(t => t.has('Override_Bounty_SP') && t.num('Override_Bounty_SP') === 0);
if (zero) assert.equal(bountyValue(zero, false), 0, 'an override of 0 pays nothing even for a category with a default');

assert.equal(roundAway(2.5), 3);
assert.equal(roundAway(2.4), 2);
assert.equal(roundAway(-2.5), -3);

const upgrade = [...db.types.values()].find(t => t.sub && t.sub('Abilities').some(x => x.all('Bounty_On_Faction_Ability').length));
assert(upgrade, 'an upgrade carries the ability');
const ability = upgrade.sub('Abilities').flatMap(x => x.all('Bounty_On_Faction_Ability'))[0];
console.log('upgrade:', upgrade.name);
const owner = { id: 0, team: 't1' },
  ally = { id: 1, team: 't1' },
  foe = { id: 2, team: 't2' },
  foe2 = { id: 3, team: 't2' };
const players = [owner, ally, foe, foe2],
  allied = (a, b) => a.team === b.team;
const book = new BountyBook();
book.add(owner, ability, 'UL_BOUNTY_UPGRADE', [owner, ally]);
const pct = ability.num('Bounty_Percentage_Amount'),
  named = ability
    .val('Target_Faction_Names')
    .split(/[\s,]+/)
    .filter(Boolean)[0];
assert(pct > 0 && named);
assert.equal(book.percent(owner, named), pct);
if (/yes/i.test(ability.val('Apply_To_All_Allies')))
  assert.equal(book.percent(ally, named.toUpperCase()), pct, 'for all allies, names compared without case');
assert.equal(book.percent(foe, named), 0);
assert.equal(book.percent(owner, 'No_Such_Faction'), 0);
const paid = book.payouts(players, owner, named, 500, allied);
assert.deepEqual(
  paid.map(([p, n]) => [p.id, n]),
  /yes/i.test(ability.val('Apply_To_All_Allies'))
    ? [
        [0, roundAway(pct * 500)],
        [1, roundAway(pct * 500)]
      ]
    : [[0, roundAway(pct * 500)]]
);
assert.deepEqual(book.payouts(players, owner, 'No_Such_Faction', 500, allied), []);
assert.deepEqual(book.payouts(players, owner, named, 0, allied), []);
assert.deepEqual(book.payouts(players, foe, named, 500, allied), []);
book.enabled = false;
assert.deepEqual(book.payouts(players, owner, named, 500, allied), []);
book.enabled = true;
assert.equal(book.payouts(players, owner, named, 0.0001, allied)[0][1], 1);
assert.equal(book.payouts(players, owner, named, 5, allied)[0][1], Math.max(1, roundAway(pct * 5)));
const rule = (pct, cat, all = 'No') => ({
  num: () => pct,
  val: k => (k === 'Stacking_Category' ? String(cat) : k === 'Target_Faction_Names' ? 'Empire' : k === 'Apply_To_All_Allies' ? all : '')
});
const stack = new BountyBook();
stack.add(owner, rule(0.5, 1), 'A');
stack.add(owner, rule(0.25, 1), 'B');
stack.add(owner, rule(0.1, 2), 'C');
assert.ok(Math.abs(stack.percent(owner, 'empire') - 0.6) < 1e-9, '0.5 (best of category 1) + 0.1');
const solo = new BountyBook();
solo.add(owner, rule(1, 1, 'No'), 'S', [owner, ally]);
assert.equal(solo.percent(ally, 'Empire'), 0);
assert.equal(solo.percent(owner, 'Empire'), 1);
const sides = new BountyBook();
sides.add(0, ability, 'U', [0]);
assert.deepEqual(
  sides.payouts([0, 1], 0, named, 100, (a, b) => a === b).map(([p, n]) => [p, n]),
  [[0, roundAway(pct * 100)]],
  'side 0 kills and is paid'
);
console.log('ok');
