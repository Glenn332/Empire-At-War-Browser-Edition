import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod >= 0 ? [process.argv[mod + 1]] : []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = decodeURIComponent(path.replace(/^asset\//, ''))
      .replaceAll('/', String.fromCharCode(92))
      .toUpperCase(),
    data = archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData, ObjType } = await import('../public/js/gamedata.js');
await loadGameData();
const { startingGalaxy, loadCampaignData, snapshotGalaxy, applyGalaxy, forceKind } = await import('../public/js/game/galaxy.js');
const { planetIncome, playerIncome, fiscalCycleSeconds, stepIncome, creditCap, adjustCredits } = await import(
  '../public/js/game/galacticeconomy.js'
);
const {
  availableUnits,
  productionBlock,
  productionCost,
  productionTime,
  queueUnit,
  cancelProduction,
  stepProduction,
  populationUsed,
  structureRequirements
} = await import('../public/js/game/galacticproduction.js');
const data = await loadCampaignData();
const campaign = data.campaigns.get(mod < 0 ? 'SANDBOX_EQUAL_FOOTING_REBEL' : 'FULLLARGE_ERA_3_EMPIRE');
assert(campaign);
const G = () => startingGalaxy(data, campaign);
const g = G(),
  owner = g.active,
  player = g.players.find(p => p.faction === owner);
let p = g.planets.find(
  p => p.owner === owner && availableUnits(g, p.index, owner, 'ground').length && availableUnits(g, p.index, owner, 'space').length
);
if (!p && mod >= 0) {
  const units = [...db.types.values()].filter(
    t =>
      t.list('Affiliation').some(n => n.toUpperCase() === owner.toUpperCase()) &&
      !t.bool('Build_Initially_Locked') &&
      !t.bool('Cinematic_Object_Only') &&
      t.num('Build_Cost_Credits') > 0 &&
      t.num('Required_Star_Base_Level') <= 5 &&
      t.num('Required_Ground_Base_Level') <= 5 &&
      t.num('Tech_Level') <= player.tech
  );
  const ground = units.find(
    t =>
      forceKind(t) === 'company' && t.bool('Build_Tab_Land_Units') && t.num('Required_Ground_Base_Level') > 0 && !t.has('Required_Planets')
  );
  const space = units.find(
    t =>
      ['starship', 'squadron'].includes(forceKind(t)) &&
      (t.num('Tactical_Health') > 0 || t.has('Squadron_Units')) &&
      t.bool('Build_Tab_Space_Units') &&
      t.num('Required_Star_Base_Level') > 0 &&
      !t.has('Required_Planets')
  );
  assert(ground && space, 'Generic production fixture has unlocked unit definitions');
  p = g.planets.find(p => p.owner === owner && !p.background && p.type.bool('Planet_Surface_Accessible', true));
  const names = new Set([...ground.list('Required_Special_Structures'), ...space.list('Required_Special_Structures')]);
  const types = [...names].map(n => db.type(n)).filter(Boolean);
  p.groundStructures = types.filter(t => forceKind(t) !== 'orbital structure').map(type => ({ type, owner }));
  p.orbitalStructures = types.filter(t => forceKind(t) === 'orbital structure').map(type => ({ type, owner }));
  const structure = [...db.types.values()].find(
    t => forceKind(t) === 'ground structure' && t.list('Affiliation').some(n => n.toUpperCase() === owner.toUpperCase())
  );
  while (p.groundStructures.length < ground.num('Required_Ground_Base_Level')) p.groundStructures.push({ type: structure, owner });
  p.station = [...db.types.values()].find(
    t =>
      forceKind(t) === 'station' &&
      t.num('Base_Level') >= space.num('Required_Star_Base_Level') &&
      (!t.has('Affiliation') || t.list('Affiliation').some(n => n.toUpperCase() === owner.toUpperCase()))
  );
  assert(p.station);
  p.stationOwner = owner;
  p.spaceLevel = p.station.num('Base_Level');
  player.tech = Math.max(player.tech, ground.num('Tech_Level'), space.num('Tech_Level'));
  assert(
    availableUnits(g, p.index, owner, 'ground').length && availableUnits(g, p.index, owner, 'space').length,
    'Staged data-defined producers satisfy eligibility'
  );
}
assert(p, 'Starting campaign has a planet capable of space and ground production');
const land = availableUnits(g, p.index, owner, 'ground')[0],
  ship = availableUnits(g, p.index, owner, 'space').find(t => t.num('Tactical_Health') > 0 || t.has('Squadron_Units'));
assert(ship);
assert(!availableUnits(g, p.index, owner, 'space').some(t => t.bool('Cinematic_Object_Only')));
const grammar = new ObjType('SpaceUnit', 'TEST_REQUIREMENTS');
grammar.props.set('required_special_structures', ['A | B, C|D E']);
assert.deepEqual(structureRequirements(grammar), [['A', 'B'], ['C', 'D'], ['E']]);
if (mod < 0) {
  const discounts = G(),
    target = discounts.planets.find(p => p.owner === owner),
    corellia = discounts.planets.find(p => p.name === 'Corellia');
  discounts.planets = [target, corellia];
  discounts.fleets = [];
  target.groundStructures = [];
  target.orbitalStructures = [];
  target.garrison = [];
  target.station = null;
  corellia.owner = owner;
  corellia.groundStructures = [];
  corellia.orbitalStructures = [];
  corellia.garrison = [];
  corellia.station = null;
  const corvette = db.type('Corellian_Corvette');
  assert.equal(productionCost(discounts, target, owner, corvette), 1000, 'Corellia global 20 percent price reduction');
  target.garrison = [{ type: db.type('Mon_Mothma'), owner }];
  assert.equal(productionCost(discounts, target, owner, corvette), 688, 'Different stacking categories add before final rounding');
  target.garrison.push({ type: db.type('Mon_Mothma'), owner });
  assert.equal(productionCost(discounts, target, owner, corvette), 688, 'Duplicate effects in the same category do not compound');
  const buildings = p.groundStructures;
  p.groundStructures = [...buildings, { type: db.type('Ground_Cantina_R'), owner }];
  assert(
    availableUnits(g, p.index, owner, 'ground').some(t => t.name === 'Smuggler_Team_R'),
    'Recruitable hero-tab companies are offered'
  );
  p.groundStructures = buildings;
}
const income = G(),
  a = income.planets.find(p => p.owner === owner && p.type.num('Planet_Credit_Value') > 0),
  b = income.planets.find(p => p !== a && !p.background);
income.planets = [a, b];
a.index = 0;
b.index = 1;
b.owner = owner;
for (const p of [a, b]) {
  p.groundStructures = [];
  p.orbitalStructures = [];
  p.garrison = [];
  p.station = null;
  p.politicalControl = 1;
}
income.fleets = [];
income.routes = [];
const base = a.type.num('Planet_Credit_Value'),
  otherBase = b.type.num('Planet_Credit_Value');
assert.equal(planetIncome(income, a), base);
const alignment = db.faction(owner).str('Force_Alignment', 'Neutral');
if (alignment.toUpperCase() !== 'NEUTRAL') {
  for (const matching of [true, false]) {
    const type = new ObjType('Planet', 'TEST_FORCE_' + matching);
    for (const [k, v] of Object.entries({ planet_credit_value: '100', force_strength: '0.5', the_force: matching ? alignment : 'Neutral' }))
      type.props.set(k, [v]);
    const planet = { type, owner, index: 0, groundStructures: [], orbitalStructures: [], garrison: [], station: null };
    const amount = 0.5 * 100 * db.constants.num(matching ? 'MaxCreditIncomeAlignmentBonus' : 'MaxCreditIncomeAlignmentPenalty', 0.5);
    assert.equal(planetIncome({ routes: [], fleets: [] }, planet), Math.fround(100 + (matching ? amount : -amount)));
  }
}
const positiveRoute = [...data.routes.values()].find(r => r.num('Credit_Gain_Factor') > 0);
if (positiveRoute) {
  income.routes = [{ a: 0, b: 1, type: positiveRoute }];
  const factor = positiveRoute.num('Credit_Gain_Factor');
  assert.equal(planetIncome(income, a), Math.fround(base * (1 + factor)));
  assert.equal(planetIncome(income, b), Math.fround(otherBase * (1 + factor)));
}
income.routes = [];
const mine = [...db.types.values()].find(t => t.sub('Abilities').some(a => a.all('Planet_Income_Bonus_Ability').length));
assert(mine);
const bonus = mine.sub('Abilities').flatMap(a => a.all('Planet_Income_Bonus_Ability'))[0];
const mining = a.type.bool('Planet_Is_Mining_Colony') ? bonus.num('Additional_Multiplier_On_Mining_Colonies', 1) : 1;
const addition = (base * bonus.num('Percentage_Income_Modifier') + bonus.num('Absolute_Income_Modifier')) * mining;
a.groundStructures = [
  { type: mine, owner },
  { type: mine, owner }
];
assert.equal(planetIncome(income, a), Math.fround(base + 2 * addition));
a.incomeHalted = true;
assert.equal(planetIncome(income, a), 0);
delete a.incomeHalted;
const total = playerIncome(income, owner),
  balance = income.players.find(p => p.faction === owner).credits,
  period = fiscalCycleSeconds();
assert.equal(period, mod < 0 ? 45 : 40);
stepIncome(income, period - 1 / 30);
assert.equal(income.players.find(p => p.faction === owner).credits, balance);
stepIncome(income, 1 / 30);
assert.equal(income.players.find(p => p.faction === owner).credits, Math.fround(balance + total));
stepIncome(income, period * 2);
assert.equal(income.fiscal.cycle, 2, 'One payday per invocation, with no catch-up loop');
stepIncome(income, 0);
assert.equal(income.fiscal.cycle, 3);
adjustCredits(income, owner, 1e9);
assert.equal(income.players.find(p => p.faction === owner).credits, creditCap(income, owner));
adjustCredits(income, owner, -1e9);
assert.equal(income.players.find(p => p.faction === owner).credits, 0);
player.credits = 100000;
const cost = productionCost(g, p, owner, land),
  before = player.credits,
  pop = populationUsed(g, owner);
assert.equal(queueUnit(g, p.index, owner, land), null);
assert.equal(player.credits, before - cost);
assert.equal(populationUsed(g, owner), pop + land.num('Population_Value'));
assert.equal(queueUnit(g, p.index, owner, land), null);
const head = p.production.ground[0],
  waiting = p.production.ground[1];
assert.equal(queueUnit(g, p.index, owner, ship), null);
const space = p.production.space[0],
  dt = Math.min(head.total, space.total) / 2;
stepProduction(g, dt);
assert(Math.abs(head.left - (head.total - dt)) < 1e-6);
assert(Math.abs(space.left - (space.total - dt)) < 1e-6);
assert.equal(waiting.left, waiting.total, 'Waiting company does not advance');
const paid = player.credits;
assert(cancelProduction(g, p.index, owner, waiting));
assert.equal(player.credits, paid + waiting.cost);
assert.equal(head.left, head.total - dt, 'Cancel waiting entry leaves active progress alone');
assert(cancelProduction(g, p.index, owner, head));
assert.equal(p.production.ground.length, 0);
for (let i = 0; i < 5; i++) assert.equal(queueUnit(g, p.index, owner, land), null);
assert.equal(productionBlock(g, p.index, owner, land), 'TEXT_PRODUCTION_QUEUE_FULL');
const fullPaid = player.credits;
stepProduction(g, Math.min(0.1, p.production.ground[0].total / 2));
const cancelled = p.production.ground[0];
assert(cancelProduction(g, p.index, owner, cancelled));
assert.equal(player.credits, fullPaid + cancelled.cost);
assert.equal(p.production.ground[0].left, p.production.ground[0].total, 'New head starts at full stored duration');
stepIncome(g, 7.25);
player.unlockedTypes.push(ship.name);
player.lockedTypes.push('TEST_LOCK');
const snap = snapshotGalaxy(g),
  restored = G();
applyGalaxy(restored, JSON.parse(JSON.stringify(snap)));
assert.deepEqual(snapshotGalaxy(restored), snap);
const target = restored.planets[p.index],
  rp = restored.players.find(p => p.faction === owner);
const field = target.garrison.length,
  fleetCount = restored.fleets.filter(f => f.owner === owner && f.planet === p.index).flatMap(f => f.units).length;
stepProduction(restored, Math.max(target.production.ground[0].left, target.production.space[0].left) + 0.1);
assert.equal(target.garrison.length, field + 1);
assert.equal(restored.fleets.filter(f => f.owner === owner && f.planet === p.index).flatMap(f => f.units).length, fleetCount + 1);
assert.equal(
  target.production.ground[0].left,
  target.production.ground[0].total,
  'Large step cannot finish a second company after promotion'
);
target.production.ground = [];
target.garrison = Array.from({ length: db.constants.num('Max_Ground_Forces_On_Planet', 10) }, () => ({ type: land, owner }));
assert.equal(queueUnit(restored, p.index, owner, land), null);
stepProduction(restored, productionTime(restored, target, owner, land) + 0.1);
assert(restored.fleets.some(f => f.planet === p.index && f.owner === owner && f.units.some(u => u.carries === land)));
rp.lockedTypes.push(land.name);
assert(productionBlock(restored, p.index, owner, land));
rp.lockedTypes = [];
rp.credits = 0;
assert.equal(productionBlock(restored, p.index, owner, land), 'TEXT_PRODUCTION_INSUFFICIENT_FUNDS');
rp.credits = 100000;
target.production.ground = [];
assert.equal(queueUnit(restored, p.index, owner, land), null);
const savedCredits = rp.credits;
target.groundStructures = [];
stepProduction(restored, 0);
assert.equal(target.production.ground.length, 0);
assert.equal(rp.credits, savedCredits, 'Automatic removal is distinct from manual cancellation');
const recheck = G();
applyGalaxy(recheck, snapshotGalaxy(g));
const site = recheck.planets[p.index],
  buyer = recheck.players.find(p => p.faction === owner);
site.production = { space: [], ground: [] };
buyer.credits = 100000;
assert.equal(queueUnit(recheck, p.index, owner, ship), null);
site.spaceLevel = ship.num('Required_Star_Base_Level') - 1;
stepProduction(recheck, 0);
assert.equal(site.production.space.length, 0, 'Station downgrade invalidates a queued ship');
site.spaceLevel = ship.num('Required_Star_Base_Level');
const escort = { owner, planet: p.index, leg: null, units: [{ type: ship }] };
recheck.fleets.push(escort);
const requiring = new ObjType(ship.tag, 'TEST_ORBITING_REQUIREMENT');
requiring.parent = ship;
requiring.props.set('required_orbiting_units', [ship.name]);
assert.equal(queueUnit(recheck, p.index, owner, requiring), null);
recheck.fleets = recheck.fleets.filter(f => f.planet !== p.index);
stepProduction(recheck, 0);
assert.equal(site.production.space.length, 0, 'Departing required orbiting unit invalidates production');
console.log(
  `PASS: ${mod < 0 ? 'base' : 'mod'} income/routes/mines/fiscal timing; ${p.name} ${land.name} + ${ship.name}; price, parallel queues, cancellation, limits, battle snapshots and completion placement`
);
