// Land and space AI perceptions, income streams and task force calls against what the game's own XML and Lua ask
// of them: Parameter_Type lists on the land perceptions, the ground base level of a campaign battle, the sharing
// tags of income streams, team type names in Set_Targeting_Priorities and the attacker of a land Unit_Damaged.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const archive = openGame(gameDir);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { Mind, target, loadBrain } = await import('../public/js/game/landbrain.js');
const { LandWorld, LandSquad, buildsFor, incomeSplit } = await import('../public/js/game/land.js');
const { Plans, ofKind } = await import('../public/js/game/aiplans.js');
const { namedSet, loadPrioritySets } = await import('../public/js/game/priorities.js').then(async m => {
  if (m.loadPrioritySets) await m.loadPrioritySets();
  return m;
});

const T = n => {
  const t = db.type(n);
  assert(t, 'the game data has ' + n);
  return t;
};
const first = (...names) => {
  for (const n of names) if (db.type(n)) return db.type(n);
  assert.fail('the game data has one of ' + names.join(', '));
};

// a land world of three sides: 0 and 1 are one team, 2 is the enemy
const makeWorld = (factions = ['Empire', 'Empire', 'Rebel']) =>
  Object.assign(Object.create(LandWorld.prototype), {
    factions,
    team: [0, 0, 1],
    wild: 3,
    campaign: false,
    time: 0,
    n: 51,
    map: { zones: [] },
    units: [],
    sites: [],
    points: [],
    ready: factions.map(() => []),
    owned: factions.map(() => new Set()),
    credits: factions.map(() => 0),
    earned: factions.map(() => 0),
    mods: factions.map(() => ({ credit: 1, build: 1 })),
    queues: factions.map(() => ({ units: [], upgrades: [] })),
    beaten: new Set(),
    bombing: []
  });
const unit = (type, side, extra = {}) => ({ type, side, x: 100, y: 100, z: 0, health: 100, maxHealth: 100, dead: false, ...extra });
const structure = (type, side, site) => {
  const u = unit(type, side, { structure: true, site });
  if (site) site.structure = u;
  return u;
};
const brain = await loadBrain('Empire');
const mindOf = (w, side = 0, b = brain) => new Mind(b, w, side, { difficulty: 'Normal' });
const P = (...types) => types.map(n => ['Parameter_Type', n]);

// ---- OpenBuildPadCount counts only the pads its Parameter_Type list names
{
  const w = makeWorld();
  const econPad = first('Skirmish_Mineral_Processor_Pad', 'Skirmish_Outpost_Pad');
  const otherPad = [...db.types.values()].find(
    t =>
      t !== econPad &&
      !/MINERAL|MINING|OUTPOST/i.test(t.name) &&
      t.behaviors().has('TACTICAL_BUILD_OBJECTS') &&
      buildsFor(t, 'Empire', false).length
  );
  assert(otherPad, 'a build pad that takes no mineral processor exists');
  assert(buildsFor(econPad, 'Empire', false).length, 'the Empire can build on ' + econPad.name);
  const pad = type => ({
    base: false,
    side: -1,
    point: { side: 0, type },
    pad: type,
    x: 100,
    y: 100,
    options: null,
    structure: null,
    building: null
  });
  const turretPad = pad(otherPad);
  w.sites.push(turretPad);
  let m = mindOf(w);
  assert.equal(m.see('Variable_Self.OpenBuildPadCount', [], null), 1, 'with no type list every open pad counts');
  assert.equal(m.see('Variable_Self.OpenBuildPadCount', P(econPad.name), null), 0, 'a pad of another type is left out');
  assert.equal(
    m.fn('NUM_OPEN_LAND_ECON_STRUCTURE_BUILD_LOCATIONS', null),
    0,
    'the equation of the game: an open turret pad is no refinery location'
  );
  assert.equal(m.fn('IS_SAVING_FOR_REFINERIES_LAND', null), 0, 'so a poor AI with only turret pads open is not saving for refineries');
  w.sites.push(pad(econPad));
  m = mindOf(w);
  assert.equal(m.see('Variable_Self.OpenBuildPadCount', [], null), 2);
  assert.equal(m.see('Variable_Self.OpenBuildPadCount', P(econPad.name), null), 1, 'the named pad counts');
  assert.equal(m.fn('NUM_OPEN_LAND_ECON_STRUCTURE_BUILD_LOCATIONS', null), 1);
  w.sites[1].building = { uc: buildsFor(econPad, 'Empire', false)[0], side: 0, left: 5, total: 10 };
  assert.equal(mindOf(w).see('Variable_Self.OpenBuildPadCount', P(econPad.name), null), 0, 'a pad being built on is not open');

  // ---- HasBuiltObject answers for the listed types only
  const aa = T('Empire_Anti_Aircraft_Turret'),
    av = T('Empire_Anti_Vehicle_Turret');
  const u = structure(aa, 0, turretPad);
  w.units.push(u);
  m = mindOf(w);
  const at = target.site(turretPad);
  assert.equal(m.see('Variable_Target.HasBuiltObject', [], at), 1, 'no type list: anything built');
  assert.equal(
    m.see('Variable_Target.HasBuiltObject', P(aa.name, 'Rebel_Anti_Aircraft_Turret'), at),
    1,
    'the turret on the pad is one of the types'
  );
  assert.equal(
    m.see('Variable_Target.HasBuiltObject', P(av.name, 'Rebel_Anti_Vehicle_Turret'), at),
    0,
    'an anti-air turret is no anti-vehicle turret'
  );
  assert.equal(m.see('Variable_Target.HasBuiltObject', P(av.name), target.unit(u)), 0, 'asked of the turret itself too');
  const buildable = [...db.types.values()].find(
    t => t.str('Tactical_Buildable_Constructed').trim().toUpperCase() === av.name.toUpperCase()
  );
  assert(buildable, 'a buildable makes ' + av.name);
  const rising = { ...pad(otherPad), building: { uc: buildable, side: 0, left: 5, total: 10 } };
  assert.equal(m.see('Variable_Target.HasBuiltObject', P(av.name), target.site(rising)), 1, 'what is going up counts by the type it makes');
  assert.equal(m.see('Variable_Target.HasBuiltObject', P(aa.name), target.site(rising)), 0);
  assert.equal(m.see('Variable_Target.HasBuiltObject', P(av.name), target.site(pad(otherPad))), 0, 'an empty pad has nothing built');

  // ---- TacticalBuiltStructureCount with no type list is what stands on build pads, not the base
  const hq = structure(first('Empire_Command_Center', 'E_Ground_Barracks', 'Empire_Barracks'), 0, {
    base: true,
    side: 0,
    pad: null,
    options: []
  });
  w.units.push(hq);
  m = mindOf(w);
  assert.equal(m.see('Variable_Self.TacticalBuiltStructureCount', [], null), 1, 'the base building is not a built pad');
  assert.equal(m.see('Variable_Self.TacticalBuiltStructureCount', P(hq.type.name), null), 1, 'a type list still finds it');
  assert.equal(m.see('Variable_Self.TacticalBuiltStructureCount', P(aa.name), null), 1);
  assert.equal(m.see('Variable_Self.TacticalBuiltStructureCount', P(av.name), null), 0);
  assert.equal(
    m.fn('BUILD_PAD_COUNT', null),
    m.see('Variable_Self.TacticalBuiltStructureCount', [], null) + m.see('Variable_Self.OpenBuildPadCount', [], null),
    'Build_Pad_Count is the pads, occupied or not'
  );
  assert.equal(m.fn('BUILD_PAD_COUNT', null), 1, 'one turret pad built on, the mineral pad under construction');
}

// ---- BaseLevel in a battle for a planet is the ground base that stands
{
  const w = makeWorld(['Empire', 'Empire', 'Rebel']);
  w.campaign = true;
  w.defenderSide = 0;
  const part = [...db.types.values()].find(
    t =>
      t.list('LandBehavior').some(b => /^DUMMY_LAND_BASE_LEVEL_COMPONENT$/i.test(b)) &&
      /^E/i.test(t.name) &&
      t.num('AI_Combat_Power', 0) >= 0
  );
  assert(part, 'a ground base structure with DUMMY_LAND_BASE_LEVEL_COMPONENT exists');
  const trooper = T('Squad_Stormtrooper');
  w.units.push(unit(trooper, 0), unit(T('Squad_Rebel_Trooper'), 2, { x: 900, y: 900 }));
  let m = mindOf(w);
  assert.equal(m.see('Variable_Self.BaseLevel', [], null), 0, 'a garrison with no base has base level 0');
  assert.equal(m.fn('ALLOWED_AS_DEFENDER_LAND', null), 1, 'so the defender may attack freely (IsDefender * (BaseLevel == 0))');
  const turret = structure(T('Empire_Anti_Aircraft_Turret'), 0, { base: false, pad: T('Empire_Anti_Aircraft_Turret') });
  w.units.push(turret);
  assert.equal(mindOf(w).see('Variable_Self.BaseLevel', [], null), 0, 'a turret is no base level');
  const base = structure(part, 0, { base: true, pad: null });
  w.units.push(base);
  m = mindOf(w);
  assert.equal(m.see('Variable_Self.BaseLevel', [], null), 1, 'one base structure, level one');
  assert.equal(mindOf(w, 2).see('Variable_Self.BaseLevel', [], null), 0, 'the attacker has none');
  base.dead = true;
  assert.equal(mindOf(w).see('Variable_Self.BaseLevel', [], null), 0, 'and none once it has fallen');
  base.dead = false;
  for (let i = 0; i < 7; i++) w.units.push(structure(part, 0, { base: true, pad: null }));
  assert.equal(
    mindOf(w).see('Variable_Self.BaseLevel', [], null),
    db.constants.num('MaximumGroundbaseLevel', 5),
    'capped at MaximumGroundbaseLevel'
  );
  w.campaign = false;
  assert(mindOf(w).see('Variable_Self.BaseLevel', [], null) >= 1, 'a skirmish keeps its tech level count');
}

// ---- ReinforcementsUnnormalized honours its category (Need_Heroes_Landed) and force perceptions their type list
{
  const w = makeWorld();
  const company = [...db.types.values()].find(
    t =>
      t.list('Company_Units').length &&
      t
        .list('Company_Units')
        .every(n => db.type(n) && !db.type(n).categories().has('LANDHERO') && db.type(n).num('AI_Combat_Power', 30) > 0)
  );
  const heroCo = [...db.types.values()].find(
    t => t.list('Company_Units').length && t.list('Company_Units').some(n => db.type(n) && db.type(n).categories().has('LANDHERO'))
  );
  assert(company && heroCo, 'a plain company and a hero company exist');
  const hero = [['Parameter_Category', 'GameObjectCategoryType[LandHero]']];
  w.ready[0].push(company);
  let m = mindOf(w);
  assert(m.see('Variable_Self.ReinforcementsUnnormalized', [], null) > 0, 'a waiting company counts');
  assert.equal(m.see('Variable_Self.ReinforcementsUnnormalized', hero, null), 0, 'but it is no hero waiting to land');
  assert.equal(m.fn('NEED_HEROES_LANDED', null), 0, 'Need_Heroes_Landed stays off with only troops waiting');
  w.ready[0].push(heroCo);
  m = mindOf(w);
  assert(m.see('Variable_Self.ReinforcementsUnnormalized', hero, null) > 0, 'a waiting hero does count');
  assert.equal(m.fn('NEED_HEROES_LANDED', null), 50, 'and Need_Heroes_Landed is on');
  assert(
    m.see('Variable_Self.ReinforcementsUnnormalized', [], null) > m.see('Variable_Self.ReinforcementsUnnormalized', hero, null),
    'the category narrows the sum'
  );

  // Should_Build_Ysalamiri_Cage: Variable_Target.EnemyForce {Parameter_Type = the Force users}
  const zone = { index: 0, x: 100, y: 100, cells: [], links: [] };
  for (let cx = 0; cx <= 12; cx++) for (let cy = 0; cy <= 12; cy++) zone.cells.push((cx & 0xffff) | (cy << 16));
  w.map.zones = [zone];
  const vader = T('Darth_Vader'),
    trooper = T('Squad_Stormtrooper');
  assert(vader.num('AI_Combat_Power', 0) > 0 && trooper.num('AI_Combat_Power', 0) > 0);
  const uw = makeWorld(['Underworld', 'Underworld', 'Empire']);
  uw.map.zones = [zone];
  uw.units.push(unit(first('Squad_Underworld_Merc', 'Underworld_Merc', 'Squad_Rebel_Trooper'), 0), unit(trooper, 2));
  const jedi = P('Emperor_Palpatine', 'Darth_Vader', 'Mara_Jade', 'Obi_Wan_Kenobi', 'Luke_Skywalker_Jedi', 'Yoda');
  const spot = target.place(100, 100);
  const ub = await loadBrain('Underworld');
  m = mindOf(uw, 0, ub);
  assert(m.see('Variable_Target.EnemyForce', [], spot) > 0, 'enemy troops stand at the place');
  assert.equal(m.see('Variable_Target.EnemyForce', jedi, spot), 0, 'none of them a Force user');
  assert.equal(m.see('Variable_Target.EnemyForceUnnormalized', jedi, spot), 0);
  assert.equal(m.see('Variable_Target.EnemyUnitConcentrationUnnormalized', jedi, spot), 0);
  if (ub.eq.has('SHOULD_BUILD_YSALAMIRI_CAGE'))
    assert.equal(m.fn('SHOULD_BUILD_YSALAMIRI_CAGE', spot), 0, 'no Ysalamiri cage against plain troops');
  uw.units.push(unit(vader, 2));
  m = mindOf(uw, 0, ub);
  assert(m.see('Variable_Target.EnemyForce', jedi, spot) > 0, 'Vader is one');
  assert(
    m.see('Variable_Target.EnemyForceUnnormalized', jedi, spot) < m.see('Variable_Target.EnemyForceUnnormalized', [], spot),
    'and only he is summed'
  );
  if (ub.eq.has('SHOULD_BUILD_YSALAMIRI_CAGE'))
    assert(m.fn('SHOULD_BUILD_YSALAMIRI_CAGE', spot) > 0, 'a cage is wanted where a Force user stands');
  assert.equal(
    m.see('Variable_Enemy.ForceUnnormalized', P('Darth_Vader'), null),
    vader.num('AI_Combat_Power', 0),
    'a side total with a type list sums that type alone'
  );
}

// ---- Income streams pay as their sharing tags say
{
  const stream = t => (t.sub ? t.sub('Abilities').flatMap(a => a.all('Income_Stream_Ability'))[0] : null);
  const processor = [...db.types.values()].find(t => /MINERAL_PROCESSOR$/i.test(t.name) && stream(t));
  assert(processor, 'a mineral processor with an income stream exists');
  const inc = stream(processor),
    tags = incomeSplit(inc);
  assert.deepEqual(
    { split: tags.split, full: tags.full, favors: tags.favors },
    { split: true, full: true, favors: false },
    processor.name + ': Split_Income_With_Allies Yes, Split_Favors_Owner No, Full_Amount_To_Everyone Yes'
  );
  const w = makeWorld();
  const value = inc.num('Base_Income_Value', 0),
    every = inc.num('Base_Interval_In_Secs', 5);
  assert(value > 0 && every > 0);
  const u = structure(processor, 0, { base: false, pad: T('Skirmish_Mineral_Processor_Pad'), point: { side: 0 } });
  u.income = { value, every, timer: 0, skirmish: false, ...tags };
  u.heals = [];
  w.units.push(u);
  w.bonusTimer = 1e9;
  w.updateEconomy(every);
  assert.deepEqual(
    w.credits,
    [value, value, 0],
    'a mineral processor on a pad pays its owner and the ally the full amount, the enemy nothing'
  );
  assert.deepEqual(w.earned, [value, value, 0]);
  assert.deepEqual(w.incomeShares(u), [
    [0, 1],
    [1, 1]
  ]);
  u.income = { value, every, timer: 0, split: false, full: true, favors: false };
  assert.deepEqual(w.incomeShares(u), [[0, 1]], 'Split_Income_With_Allies No keeps it with the owner');
  u.income = { value, every, timer: 0, split: true, full: false, favors: true, ownerShare: 0.5 };
  assert.deepEqual(
    w.incomeShares(u),
    [
      [0, 0.5],
      [1, 0.5]
    ],
    'the first game: Split_Favors_Owner with Owner_Income_Percentage 0.50'
  );
  w.team = [0, 0, 0];
  assert.deepEqual(w.incomeShares(u), [
    [0, 0.5],
    [1, 0.25],
    [2, 0.25]
  ]);
  u.income = { value, every, timer: 0, split: true, full: false, favors: false };
  assert.deepEqual(
    w.incomeShares(u).map(([, part]) => part),
    [1 / 3, 1 / 3, 1 / 3],
    'an even split'
  );
  w.team = [0, 1, 2];
  u.income = { value, every, timer: 0, split: true, full: false, favors: true, ownerShare: 0.5 };
  assert.deepEqual(w.incomeShares(u), [[0, 1]], 'with no ally there is nobody to share with');
  w.team = [0, 0, 1];
  u.income = { value, every, timer: 0 };
  assert.deepEqual(w.incomeShares(u), [[0, 1]], 'a stream with no sharing tags: a pad building pays its owner');
  u.site.base = true;
  assert.deepEqual(
    w.incomeShares(u).map(([s]) => s),
    [0, 1],
    'and a base building the team, as before'
  );
}

// ---- Set_Targeting_Priorities takes the name of a team type (Plex_Soldier_Team)
{
  const company = [...db.types.values()].find(
    t => /^Plex_Soldier_Team$/i.test(t.str('Create_Team_Type').trim()) && t.list('Company_Units').length
  );
  assert(company, 'a company makes Plex_Soldier_Team');
  const member = T(company.list('Company_Units')[0]);
  const squad = Object.assign(Object.create(LandSquad.prototype), { type: company, members: [{ type: member }] });
  assert.equal(squad.scriptType, T('Plex_Soldier_Team'), 'scripts see the squad as its team type');
  assert.notEqual(member.name.toUpperCase(), 'PLEX_SOLDIER_TEAM');
  assert(ofKind(squad, ['PLEX_SOLDIER_TEAM']), 'the team type name matches the squad');
  assert(ofKind(squad, ['INFANTRY']), 'a category still does');
  assert(ofKind(squad, [member.name.toUpperCase()]), 'and the member type');
  assert(!ofKind(squad, ['PIRATE_PLEX_SOLDIER_TEAM']) && !ofKind(squad, ['VEHICLE']));
  assert(ofKind(squad, []), 'no kind given: every unit');
  const troopers = [...db.types.values()].find(t => /^Rebel_Infantry_Squad$/i.test(t.name)) || T('Imperial_Stormtrooper_Squad');
  const plain = Object.assign(Object.create(LandSquad.prototype), {
    type: troopers,
    members: [{ type: T(troopers.list('Company_Units')[0]) }]
  });
  assert(!ofKind(plain, ['PLEX_SOLDIER_TEAM']));
  // PGCommands Set_Land_AI_Targeting_Priorities, in its order
  const calls = [
    ['Infantry_Attack_Move', 'Infantry'],
    ['Infantry_Attack_Move', 'LandHero'],
    ['Air_Attack_Move', 'Air'],
    ['Heavy_Vehicle_Attack_Move', 'Vehicle'],
    ['Rocket_Infantry_Attack_Move', 'Plex_Soldier_Team'],
    ['Rocket_Infantry_Attack_Move', 'Pirate_Plex_Soldier_Team']
  ];
  const setFor = q => {
    let got = null;
    for (const [set, kind] of calls) if (ofKind(q, [kind.toUpperCase()])) got = set;
    return got;
  };
  assert.equal(setFor(squad), 'Rocket_Infantry_Attack_Move', 'plex soldiers end on the rocket infantry set');
  assert.equal(setFor(plain), 'Infantry_Attack_Move', 'plain infantry keep the infantry set');
  if (loadPrioritySets) assert(namedSet('Rocket_Infantry_Attack_Move'), 'the set is in GroundUnitTargetingPriorities');
}

// ---- A land Unit_Damaged carries the company that fired and whether it aimed at the one hit
{
  const handlers = { Main_Unit_Damaged: 'main', Default_Unit_Damaged: 'default' };
  const plans = Object.assign(Object.create(Plans.prototype), {
    host: { land: true, wrap: x => (x ? { of: x } : undefined) },
    handler: (inst, name) => handlers[name] || null
  });
  const inst = { state: 'run', events: [], forces: [] },
    f = { name: 'Main', wrapper: { tf: true }, units: [] };
  inst.forces.push(f);
  const mine = { members: [{}], aiPlan: inst, dead: false },
    foe = { members: [{}], dead: false };
  f.units.push(mine);
  plans.landHit(mine, foe, true);
  assert.equal(inst.events.length, 1, 'the hit is queued for the plan');
  assert.equal(inst.events[0].fn, 'main', 'for the task force handler');
  const [tf, hurt, by, deliberate] = inst.events[0].params;
  assert.equal(tf, f.wrapper);
  assert.equal(hurt.of, mine);
  assert.equal(by.of, foe, 'the attacker is the company that fired, not the nearest enemy');
  assert.equal(deliberate, true);
  plans.landHit(mine, foe, true);
  assert.equal(inst.events.length, 1, 'one pending event a handler');
  inst.events.length = 0;
  plans.landHit(mine, null, false);
  assert.equal(inst.events[0].params[2], undefined, 'damage with no attacker passes none');
  inst.events.length = 0;
  plans.landHit({ members: [{}], aiPlan: null }, foe, true);
  plans.landHit({ members: [{}], aiPlan: { state: 'over', forces: [f], events: [] } }, foe, true);
  assert.equal(inst.events.length, 0, 'a unit of no running plan tells nobody');

  // the land world reports every hit it deals
  const { CombatMods } = await import('../public/js/game/combatmods.js');
  const w = Object.assign(Object.create(LandWorld.prototype), {
    team: [0, 1],
    wild: 2,
    time: 1,
    factions: ['Empire', 'Rebel'],
    units: [],
    squads: []
  });
  w.sideMods = w.factions.map(() => new CombatMods());
  w.trackDamage = () => {};
  w.retaliate = () => {};
  const seen = [];
  w.onHurt = (u, from, amount) => seen.push([u, from, amount]);
  const a = unit(T('Squad_Stormtrooper'), 0, { path: [], squad: { members: [], busy: true } }),
    b = unit(T('Squad_Rebel_Trooper'), 1, { path: [], shield: 0, squad: { members: [], busy: true } });
  w.units.push(a, b);
  w.hurt(b, 10, a);
  assert.equal(seen.length, 1, 'hurt reports the hit');
  assert.equal(seen[0][0], b);
  assert.equal(seen[0][1], a);
  assert(seen[0][2] > 0);
  b.invulnUntil = Infinity;
  w.hurt(b, 10, a);
  assert.equal(seen.length, 1, 'no report for a hit that did nothing');
}
console.log('ok');
