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
const A = await import('../public/js/game/planetabilities.js');
const P = await import('../public/js/game/galacticproduction.js');
const E = await import('../public/js/game/galacticeconomy.js');
const planetTypes = [...db.types.values()].filter(t => t.tag.toLowerCase() === 'planet');
const has = (t, tag) => t.sub('Abilities').some(n => n.children.some(a => a.tag.toUpperCase() === tag));
const mk = (type, owner, extra = {}) => ({
  index: 0,
  type,
  name: type.name,
  owner,
  currentCorruption: -1,
  garrison: [],
  groundStructures: [],
  orbitalStructures: [],
  production: { ground: [], space: [] },
  ...extra
});

const maw = planetTypes.find(t => has(t, 'REDUCE_TECHNOLOGY_PRICE_ABILITY'));
if (maw) {
  const g = { planets: [mk(maw, 'Empire')], routes: [], fleets: [], players: [] };
  const pct = maw
    .sub('Abilities')
    .flatMap(n => n.children)
    .find(a => a.tag.toUpperCase() === 'REDUCE_TECHNOLOGY_PRICE_ABILITY')
    .num('Price_Reduction_Percentage', 0);
  assert(Math.abs(A.techFactor(g, 'Empire') - (1 - pct)) < 1e-9, 'one planet: one minus its share');
  assert.equal(A.techFactor(g, 'Rebel'), 1, 'only its owner');
  g.planets[0].currentCorruption = 0;
  assert.equal(A.techFactor(g, 'Empire'), 1, 'Intimidation switches it off');
  g.planets[0].currentCorruption = -1;
  g.planets[0].destroyed = true;
  assert.equal(A.techFactor(g, 'Empire'), 1, 'and a destroyed planet');
  g.planets[0].destroyed = false;
  g.planets.push(mk(maw, 'Empire'));
  assert(Math.abs(A.techFactor(g, 'Empire') - (1 - 2 * pct)) < 1e-9, 'the shares add up');
  const advance = [...db.types.values()].find(t => P.techAdvance(t) > 0 && t.list('Affiliation').includes('Empire'));
  if (advance) {
    const planet = mk(planetTypes[0], 'Empire');
    planet.groundStructures = [];
    const gg = { planets: [planet, g.planets[0]], routes: [], fleets: [], players: [] };
    g.planets[0].index = 1;
    const plain = P.productionCost({ ...gg, planets: [planet], fleets: [] }, planet, 'Empire', advance),
      cheap = P.productionCost(gg, planet, 'Empire', advance);
    assert(
      cheap < plain && Math.abs(cheap - Math.round(plain * (1 - pct))) <= 1,
      'the item that advances the tech level costs less: ' + plain + ' -> ' + cheap
    );
    const unit = [...db.types.values()].find(
      t => t.num('Build_Cost_Credits', 0) > 0 && P.techAdvance(t) === 0 && t.list('Affiliation').includes('Empire')
    );
    assert.equal(
      P.productionCost(gg, planet, 'Empire', unit),
      P.productionCost({ ...gg, planets: [planet] }, planet, 'Empire', unit),
      'nothing else is cheaper'
    );
  }
}

const wide = planetTypes.filter(t => has(t, 'GALAXY_WIDE_UPGRADE_ABILITY'));
assert(wide.length > 5, 'planets with galaxy-wide upgrades');
{
  const space = wide.find(t =>
    t
      .sub('Abilities')
      .flatMap(n => n.children)
      .some(a => a.tag.toUpperCase() === 'GALAXY_WIDE_UPGRADE_ABILITY' && a.val('Space_Upgrade_Type').trim())
  );
  const land = wide.find(t =>
    t
      .sub('Abilities')
      .flatMap(n => n.children)
      .some(a => a.tag.toUpperCase() === 'GALAXY_WIDE_UPGRADE_ABILITY' && a.val('Land_Upgrade_Type').trim())
  );
  const g = { planets: [mk(space, 'Rebel'), mk(land, 'Empire')], routes: [], fleets: [], players: [] },
    held = A.galaxyWideUpgrades(g);
  assert(held.Rebel.space.length >= 1 && held.Empire.land.length >= 1, 'each owner holds its planets upgrades');
  g.planets[0].currentCorruption = 0;
  assert(!A.galaxyWideUpgrades(g).Rebel, 'Intimidation switches it off');
  g.planets[0].currentCorruption = -1;
  g.planets[1].destroyed = true;
  assert(!A.galaxyWideUpgrades(g).Empire, 'a destroyed planet gives nothing');
  const name = held.Rebel.space[0],
    type = db.type(name),
    given = [],
    taken = new Set();
  const owner = type.list('Affiliation')[0];
  A.giveFreeUpgrades(
    [name],
    owner,
    t => taken.has(t.name),
    t => {
      given.push(t.name);
      taken.add(t.name);
    }
  );
  assert.deepEqual(given, [name], 'the upgrade of a faction it is for is given');
  A.giveFreeUpgrades(
    [name],
    owner,
    t => taken.has(t.name),
    t => given.push(t.name)
  );
  assert.equal(given.length, 1, 'not twice');
  const other = [...db.factions.values()].find(
    f => f.bool('Is_Playable') && !type.list('Affiliation').some(n => n.toUpperCase() === f.name.toUpperCase())
  );
  const none = [];
  A.giveFreeUpgrades(
    [name],
    other.name,
    () => false,
    t => none.push(t)
  );
  assert.equal(none.length, 0, 'not for another faction');
  const chain = [...db.types.values()].find(
    t => t.str('Next_Upgrade_Level_Type').trim() && !t.str('Previous_Upgrade_Level_Type').trim() && t.list('Affiliation').length
  );
  if (chain) {
    const next = db.type(chain.str('Next_Upgrade_Level_Type').trim()),
      out = [];
    A.giveFreeUpgrades(
      [chain.name],
      chain.list('Affiliation')[0],
      t => t === next,
      t => out.push(t)
    );
    assert.equal(out.length, 0, 'a chain whose later link is held is not given again');
  }
}

{
  const wideType = planetTypes.find(t =>
    t
      .sub('Abilities')
      .flatMap(n => n.children)
      .some(a => /^Reduce_Production_Price_Ability$/i.test(a.tag) && /^(yes|true)$/i.test(a.val('Galaxy_Wide')))
  );
  const localType = planetTypes.find(t =>
    t
      .sub('Abilities')
      .flatMap(n => n.children)
      .some(a => /^Reduce_Production_(Price|Time)_Ability$/i.test(a.tag) && !/^(yes|true)$/i.test(a.val('Galaxy_Wide')))
  );
  for (const [type, expectOn] of [
    [wideType, false],
    [localType, true]
  ]) {
    if (!type) continue;
    const planet = mk(type, 'Empire', { currentCorruption: 0 }),
      g = { planets: [planet], routes: [], fleets: [], players: [] };
    assert.equal(
      P.productionContext(g, planet, 'Empire').length > 0,
      expectOn,
      type.name + (expectOn ? ' local stays on under Intimidation' : ' wide goes off under Intimidation')
    );
    planet.currentCorruption = -1;
    assert(P.productionContext(g, planet, 'Empire').length > 0);
    planet.destroyed = true;
    assert.equal(P.productionContext(g, planet, 'Empire').length, 0, 'a destroyed planet gives nothing');
  }
}

const arena = [...db.types.values()].find(t => has(t, 'PLANET_INCOME_GAMBLING_ABILITY'));
if (arena) {
  const ability = arena
    .sub('Abilities')
    .flatMap(n => n.children)
    .find(a => a.tag.toUpperCase() === 'PLANET_INCOME_GAMBLING_ABILITY');
  const lo = ability.num('Min_Income_Modifier'),
    hi = ability.num('Max_Income_Modifier'),
    chance = ability.num('Chance_To_Win'),
    interval = ability.num('Evaluation_Interval_In_Secs');
  const planet = mk(
    planetTypes.find(t => t.num('Planet_Credit_Value', 0) > 0),
    'Empire'
  );
  planet.groundStructures = [{ type: arena, owner: 'Empire' }];
  const g = { planets: [planet], routes: [], fleets: [], players: [] },
    base = planet.type.num('Planet_Credit_Value', 0);
  A.stepGambling(g, 0, () => 0.99);
  assert(
    planet.gambling.mod <= 0 && planet.gambling.mod >= lo,
    'a draw above the chance is a loss: a share between the minimum and nothing'
  );
  const gain = E.planetIncome(g, planet, 'Empire');
  assert(gain <= base + 1e-6, 'it lowers the income');
  A.stepGambling(g, interval / 2, () => 0.01);
  assert(planet.gambling.mod <= 0, 'nothing changes inside an interval');
  A.stepGambling(g, interval + 0.1, () => 0.01);
  assert(planet.gambling.mod >= 0 && planet.gambling.mod <= hi, 'a low draw wins: between nothing and the maximum');
  const win = E.planetIncome(g, planet, 'Empire');
  assert(win >= base - 1e-6, 'it raises the income');
  planet.groundStructures = [];
  A.stepGambling(g, 1000, Math.random);
  assert.equal(planet.gambling, null, 'no arena, no modifier');
}
console.log('ok', wide.length, 'planets with galaxy-wide upgrades;', maw?.name || 'no Maw', arena?.name || 'no arena');
