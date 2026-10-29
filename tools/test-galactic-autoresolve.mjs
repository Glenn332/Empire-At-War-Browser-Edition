import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod'),
  archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const k = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = k && archive.read(k);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, ObjType, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { autoCombatant, resolveAutoBattle, subtractForces, contrastWeight, nativeAutoContrast, specialCombatant, landBomber } = await import(
  '../public/js/game/galacticautoresolve.js'
);
const { battleStory, destroyStory, destroyBaseStory, conquerStory, resetCombatEvent, battleClassSummary } = await import(
  '../public/js/game/galacticbattleevents.js'
);
const { GalacticBattles } = await import('../public/js/game/galacticbattles.js');
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy, forceKind } = await import('../public/js/game/galaxy.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js'),
  { GalacticAI } = await import('../public/js/game/galacticai.js');
const { strategicPower, strategicCategories } = await import('../public/js/game/galacticforces.js');
const type = (name, power, categories, props = {}) => {
  const t = new ObjType('SpaceUnit', name);
  for (const [k, v] of Object.entries({ AI_Combat_Power: power, CategoryMask: categories, ...props }))
    t.props.set(k.toLowerCase(), [String(v)]);
  return t;
};
const factions = [...db.factions.values()].filter(t => t.bool('Is_Playable')),
  a = factions[0].name,
  b = factions.find(t =>
    db
      .faction(a)
      .list('Enemies')
      .some(n => n.toUpperCase() === t.name.toUpperCase())
  ).name;
const t = type('Fixture', 10, 'Fighter'),
  one = new Map([['FIGHTER', { types: new Map(), kinds: new Map([['FIGHTER', 1]]) }]]),
  normal = { num: (name, def) => (name === 'Overrun_Auto_Resolve_Multiple' ? 0 : db.constants.num(name, def)) },
  unit = owner => autoCombatant(t, owner);
await nativeAutoContrast(one);
let r = resolveAutoBattle([unit(a)], [unit(b)], one, { constants: normal, random: () => 0 });
assert.equal(r.winner, 1, 'Native equality favours defender');
assert.equal(r.sides[0].alive.size, 0);
assert.equal(r.sides[1].alive.size, 1, 'Weakest winning combatant survives');
r = resolveAutoBattle(
  Array.from({ length: 8 }, () => unit(a)),
  [unit(b)],
  one,
  { constants: normal, random: () => 0 }
);
assert.equal(r.winner, 0);
assert.equal(r.sides[0].alive.size, 7, 'Native residual70, interpolation72.5, allowance1/3 keeps seven power10 bodies');
const anti = type('Counter', 10, 'Fighter,AntiFighter,AntiBomber');
assert.equal(
  contrastWeight(anti, {
    types: new Map(),
    kinds: new Map([
      ['FIGHTER', 1],
      ['ANTIFIGHTER', 4],
      ['ANTIBOMBER', 2]
    ])
  }),
  3,
  'Average non-one category contrasts'
);
assert.equal(contrastWeight(anti, { types: new Map([[anti, 7]]), kinds: new Map([['FIGHTER', 1]]) }), 7, 'Exact type overrides categories');
assert.equal(contrastWeight(t, { types: new Map(), kinds: new Map([['VEHICLE', 1]]) }), 0, 'Missing category has zero contrast');
const residual = subtractForces(
  [autoCombatant(anti, a)],
  [
    { category: null, power: 20 },
    { category: 'FIGHTER', power: 20 }
  ],
  new Map([['FIGHTER', { types: new Map(), kinds: new Map([['ANTIFIGHTER', 4]]) }]])
);
assert.equal(residual[1].power, 0);
assert.equal(residual[0].power, -5, 'Damage20 plus unspent original power5 debits the domain total');
const transport = owner => autoCombatant(t, owner, { transport: true });
r = resolveAutoBattle([transport(a), transport(a)], [transport(b)], one, { constants: normal });
assert.equal(r.winner, 0);
assert.equal(r.sides[1].alive.size, 1, 'Zero-power transport-only battle skips normal attrition and retreats');
const strong = autoCombatant(type('Strong', 100, 'Fighter'), a),
  cargo = Array.from({ length: 4 }, () => transport(b));
r = resolveAutoBattle([strong], [unit(b), ...cargo], one, { constants: normal, random: () => 0 });
assert.equal(cargo.filter(u => r.sides[1].alive.has(u)).length, 3, 'Four losing transports keep round(4*2/3) bodies');
r = resolveAutoBattle([strong], [unit(b), transport(b)], one, { constants: normal, random: () => 0 });
assert.equal(r.sides[1].alive.size, 0, 'A lone losing transport is always lost');
const superUnit = autoCombatant(type('Super', 10, 'Super'), b);
r = resolveAutoBattle([strong], [superUnit], one, { constants: normal, random: () => 0 });
assert.equal(r.sides[1].alive.has(superUnit), mod < 0, 'Super protection requires the original category to exist in the mod enum');
if (specialCombatant(superUnit).super) {
  assert.equal(r.winner, 1, 'Defending Super forces the attacker to retreat');
  const coefficients = [];
  resolveAutoBattle([strong], [superUnit], one, {
    random: () => 0,
    constants: {
      num: (n, d) => {
        if (n.includes('Attrition')) coefficients.push(n);
        return normal.num(n, d);
      }
    }
  });
  assert(coefficients.includes('AutoResolveWinnerAttrition'));
  assert(!coefficients.some(n => n.startsWith('Retreat')), 'New Super retreat does not retroactively select retreat attrition');
  const killerType = type('FIXTURE_KILLER', 100, 'Fighter', { Is_Super_Weapon_Killer: 'Yes' });
  db.types.set(killerType.name, killerType);
  const killer = autoCombatant(type('Killer_Company', 999, 'Super', { Company_Units: killerType.name }), a);
  assert(specialCombatant(killer).killer);
  assert(!specialCombatant(killer).super, 'First child overrides the container category');
  r = resolveAutoBattle([killer], [superUnit], one, { constants: normal, random: () => 0 });
  assert.equal(r.winner, 0);
  assert(!r.sides[1].alive.has(superUnit));
  assert(r.superweaponDestroyed);
  r = resolveAutoBattle([autoCombatant(killerType, a)], [superUnit], one, { constants: normal, random: () => 0 });
  assert.equal(r.winner, 1, 'Bare killer flag does not substitute for a company member');
  const ownSuper = autoCombatant(type('OwnSuper', 100, 'Super'), a);
  r = resolveAutoBattle([ownSuper], [superUnit], one, { constants: normal, random: () => 0 });
  assert.equal(r.winner, 1, 'Native defender Super branch has first priority');
  assert(r.sides[0].alive.has(ownSuper), 'Losing playable Super survives without an opposing killer');
  const npc = [...db.factions.values()].find(t => !t.bool('Is_Playable')),
    npcSuper = autoCombatant(ownSuper.type, npc.name);
  r = resolveAutoBattle([npcSuper], [superUnit], one, { constants: normal, random: () => 0 });
  assert(!r.sides[0].alive.has(npcSuper), 'Losing nonplayable Super still passes the native annihilation guard');
  const zeroSuper = autoCombatant(type('ZeroSuper', 0, 'Super'), b);
  r = resolveAutoBattle([transport(a), transport(a)], [zeroSuper], one, { constants: normal, random: () => 0 });
  assert.equal(r.winner, 1, 'Super presence disables zero-power roster-count shortcut');
  db.types.delete(killerType.name);
}
const syntheticBase = { ...unit(b), groundBase: true, parts: [], power: 0 };
r = resolveAutoBattle([unit(a)], [unit(b), syntheticBase], one, { space: false, constants: normal, random: () => 0 });
assert.deepEqual([...r.sides[1].alive], [syntheticBase], 'Winning planet wrapper survives free and suppresses weakest-unit resurrection');
const bomber = type('FIXTURE_LAND_BOMBER', 100, 'Fighter'),
  fighter = type('FIXTURE_BOMBING_FIGHTER', 1, 'Fighter', { Land_Bomber_Type: bomber.name }),
  squadron = type('FIXTURE_BOMBER_SQUADRON', 1, 'Fighter', { Squadron_Units: fighter.name });
for (const t of [bomber, fighter, squadron]) db.types.set(t.name, t);
const carrier = type('Carrier', 1, 'Fighter', { Starting_Spawned_Units_Tech_0: squadron.name + ', 1' }),
  bombGalaxy = { players: [{ faction: a, tech: 2 }], fleets: [{ owner: a, planet: 0, leg: null, units: [{ type: carrier }] }] };
assert.equal(landBomber(bombGalaxy, 0, a), bomber, 'Cumulative lower-tech spawn tiers supply land bombers');
r = resolveAutoBattle([unit(a)], [unit(b)], one, { space: false, constants: normal, random: () => 0, bombardment: bomber });
assert.equal(r.remaining[1][0].power, -100, 'Orbital land bomber attacks before ordinary combatants');
assert.equal(r.initial[0][0].power, 10, 'Bomber contributes no strength bucket');
assert(
  [...r.sides[0].alive].every(u => u.original !== bomber),
  'Bomber is not a casualty participant'
);
for (const t of [bomber, fighter, squadron]) db.types.delete(t.name);
const overrun = { num: (name, def) => (name === 'Overrun_Auto_Resolve_Multiple' ? 8 : normal.num(name, def)) };
r = resolveAutoBattle(
  Array.from({ length: 20 }, () => unit(a)),
  [unit(b)],
  one,
  { constants: overrun, random: () => 0 }
);
assert(r.retreat);
assert.equal(r.sides[0].alive.size, 20, 'Overrun uses retreat attrition instead of ordinary winner attrition');
const hero = autoCombatant(type('Hero', 10, 'Fighter', { Is_Named_Hero: 'Yes' }), b);
r = resolveAutoBattle(
  Array.from({ length: 20 }, () => unit(a)),
  [hero],
  one,
  { constants: overrun, random: () => 0 }
);
assert(!r.retreat, 'Named heroes prevent overrun');
const base2 = type('FIXTURE_BASE_2', 60, 'Fighter'),
  base3 = type('FIXTURE_BASE_3', 100, 'Fighter', { Variant_Of_Existing_Type: 'Unrelated_Parent' });
db.types.set(base2.name, base2);
const base = autoCombatant(base3, a, { station: true });
r = resolveAutoBattle([base, unit(a)], [autoCombatant(type('Enemy', 105, 'Fighter'), b)], one, { constants: normal, random: () => 0 });
assert.equal(r.sides[0].stations.get(base), base2, 'Station downgrade decrements its own Name, not its parent type');
db.types.delete(base2.name);
const data = await loadCampaignData(),
  campaign = data.campaigns.get(mod < 0 ? 'SANDBOX_EQUAL_FOOTING_EMPIRE' : 'KNOWNSMALL_ERA_1_EMPIRE'),
  galaxy = startingGalaxy(data, campaign);
const game = {
  galaxy,
  me: galaxy.active,
  setup: {},
  paused: true,
  isHuman(f) {
    return String(f || '').toUpperCase() === String(this.me || '').toUpperCase();
  },
  scriptUI: { visibility() {}, enable() {}, text() {}, icon() {}, click() {} },
  neutralizePopup: { open() {}, close() {} }
};
game.story = await GalacticStoryHost.create(game);
await GalacticAI.create(game);
game.battles = new GalacticBattles(game);
game.story.vm.exec(
  `local t={10,20,30}; assert(table.remove(t,9)==nil); assert(#t==2 and t[2]==20); assert(table.remove(t,1)==10 and t[1]==20); assert(select('#',table.remove({}))==0)`,
  'native-table-remove'
);
game.story.vm.exec(
  `local t={1,2,3,4,5,6};t[1]=nil;t[3]=nil;t[5]=nil;local n=0;for k,v in pairs(t) do assert(v~=nil and k==v);n=n+1 end;assert(n==3)`,
  'native-sparse-pairs'
);
const contrast = game.ai.plans.autoContrast;
assert(contrast.size >= 11);
assert.deepEqual(
  [...(await nativeAutoContrast(contrast).then(m => m.keys()))],
  [...contrast.keys()],
  'Native contrast order is stable after rehash'
);
const p = galaxy.planets.find(p => !p.background && p.type.bool('Planet_Surface_Accessible', true)),
  q = galaxy.planets.find(q => q !== p && !q.background),
  other = galaxy.players.find(p => p.faction !== game.me && p.faction !== a)?.faction || b;
game.me = 'UninvolvedHuman';
galaxy.fleets = [];
for (const x of galaxy.planets) {
  x.station = null;
  x.garrison = [];
  x.groundStructures = [];
  x.orbitalStructures = [];
}
p.owner = b;
q.owner = a;
const ship = [...db.types.values()].find(
  t =>
    forceKind(t) === 'starship' &&
    t.num('AI_Combat_Power') > 0 &&
    t.num('Hyperspace_Speed') > 0 &&
    !t.bool('Is_Named_Hero') &&
    !t.categories().has('SUPER')
);
assert(ship);
const attackers = Array.from({ length: 12 }, () => ({ type: ship })),
  loser = { type: ship };
const orbitOnly = { type: ship, owner: b };
p.orbitalStructures = [orbitOnly];
assert.equal(game.battles.roster(p.index, b, true).length, 0, 'Orbital structures are not separate autoresolve combatants');
p.station = type('FIXTURE_STATION_1', 1, 'Fighter', { Base_Level: 1 });
p.stationOwner = b;
galaxy.fleets = [{ owner: a, units: attackers, planet: p.index, path: [], leg: null }];
game.battles.space(p.index, a, b);
assert(!p.station);
assert(orbitOnly.dead, 'Losing base cleanup removes its orbital structures');
game.battles.history = [];
let humanBattles = 0;
game.startBattle = () => humanBattles++;
game.pendingBattle = {
  busy: false,
  begin: () => {
    humanBattles++;
    return true;
  }
};
game.me = a;
galaxy.fleets = [
  { owner: b, units: [{ type: ship }], planet: p.index, path: [], leg: null },
  { owner: a, units: [{ type: ship }], planet: p.index, path: [], leg: null }
];
game.paused = false;
game.battles.arrive(galaxy.fleets[1], p.index);
game.battles.update();
assert.equal(humanBattles, 1);
assert.equal(game.battles.history.length, 0, 'Human encounters retain the tactical handoff');
assert.equal(galaxy.fleets.length, 2);
game.me = 'UninvolvedHuman';
p.destroyed = true;
game.battles.arrive(galaxy.fleets[1], p.index);
game.battles.update();
assert.equal(game.battles.history.at(-1).attacker, a, 'Arriving owner is attacker even when its fleet is later in the galaxy list');
assert.equal(game.battles.history.at(-1).winner, 'defender');
assert.equal(game.battles.history.length, 1, 'Preserved orbital opponents still fight above a destroyed planet');
p.destroyed = false;
const third = factions.find(
  t =>
    ![a, b].includes(t.name) &&
    [a, b].every(owner =>
      db
        .faction(owner)
        .list('Enemies')
        .some(n => n.toUpperCase() === t.name.toUpperCase())
    )
);
if (third) {
  galaxy.fleets = [
    { owner: a, units: Array.from({ length: 12 }, () => ({ type: ship })), planet: p.index, path: [], leg: null },
    { owner: b, units: [{ type: ship }], planet: p.index, path: [], leg: null },
    { owner: third.name, units: [{ type: ship }], planet: p.index, path: [], leg: null }
  ];
  const count = game.battles.history.length;
  game.battles.arrive(galaxy.fleets[0], p.index);
  game.battles.update();
  const battles = game.battles.history.slice(count);
  assert.equal(battles.length, 2, 'Three factions fight sequential pairs');
  assert.equal(battles[0].before[1], 1, 'The third faction does not join the first defender roster');
  assert.equal(battles[1].defender, third.name);
}
game.battles.history = [];
game.battles.dirty.add(p.index);
game.paused = true;
galaxy.fleets = [
  { owner: a, units: attackers, planet: p.index, path: [], leg: null },
  { owner: b, units: [loser], planet: p.index, path: [], leg: null }
];
game.battles.update();
assert.equal(game.battles.history.length, 0, 'Player pause prevents battle resolution');
game.paused = false;
game.battles.update();
assert.equal(game.battles.history.length, 1);
assert.equal(p.owner, b, 'Space victory does not conquer surface');
assert(attackers.some(u => !u.dead));
assert(loser.dead || galaxy.fleets.some(f => f.owner === b && f.leg), 'Losing survivors must leave orbit');
const company = [...db.types.values()].find(
  t =>
    forceKind(t) === 'company' &&
    db.type(t.list('Company_Transport_Unit')[0]) &&
    autoCombatant(t, a, { space: false }).power > 0 &&
    !t.bool('Is_Named_Hero')
);
assert(company);
const troop = () => ({ type: db.type(company.list('Company_Transport_Unit')[0]), carries: company, owner: a }),
  troops = Array.from({ length: 15 }, troop);
const companyMembers = company.list('Squadron_Units').length ? company.list('Squadron_Units') : company.list('Company_Units');
assert.equal(
  strategicPower(company),
  companyMembers.reduce((n, name) => Math.fround(n + strategicPower(db.type(name))), 0),
  'Native finalization derives company power from members'
);
assert.deepEqual(strategicCategories(company), new Set(companyMembers.flatMap(n => [...strategicCategories(db.type(n))])));
galaxy.fleets = [{ owner: a, units: troops, planet: p.index, path: [], leg: null }];
p.owner = b;
p.garrison = [{ type: company, owner: b }];
p.groundStructures = [];
r = game.battles.invade(p.index, a, b, troops);
assert.equal(r.winner, 'attacker');
assert.equal(p.owner, a);
assert(p.garrison.length);
assert(
  p.garrison.every(u => troops.includes(u)),
  'Landing preserves strategic record identity'
);
assert(p.garrison.every(u => !u.carries));
p.owner = b;
p.garrison = Array.from({ length: 20 }, () => ({ type: company, owner: b }));
const weak = troop();
galaxy.fleets = [{ owner: a, units: [weak], planet: p.index, path: [], leg: null }];
r = game.battles.invade(p.index, a, b, [weak]);
assert.equal(r.winner, 'defender');
assert.equal(p.owner, b);
assert(weak.dead || galaxy.fleets.some(f => f.owner === a && f.leg));
const specialCompany = type('FIXTURE_GROUND_INFANTRY', 10, 'Infantry', {
    Behavior: 'DUMMY_GROUND_COMPANY',
    Company_Transport_Unit: company.list('Company_Transport_Unit')[0]
  }),
  enemyCompany = type('FIXTURE_GROUND_VEHICLE', 10, 'Vehicle', {
    Behavior: 'DUMMY_GROUND_COMPANY',
    Company_Transport_Unit: company.list('Company_Transport_Unit')[0]
  });
db.types.set(specialCompany.name, specialCompany);
db.types.set(enemyCompany.name, enemyCompany);
const survivor = { type: db.type(company.list('Company_Transport_Unit')[0]), carries: specialCompany, owner: a };
galaxy.fleets = [{ owner: a, units: [survivor], planet: p.index, path: [], leg: null }];
const plans = game.ai.plans,
  inst = { ai: { player: galaxy.players.find(p => p.faction === a) }, thing: p },
  force = { inst, units: [survivor] };
plans.reservations.set(survivor, inst);
game.ai.invalidate();
p.garrison = [{ type: enemyCompany, owner: b }];
plans.autoContrast = new Map([
  ['INFANTRY', { types: new Map(), kinds: new Map([['VEHICLE', 0.5]]) }],
  ['VEHICLE', { types: new Map(), kinds: new Map([['INFANTRY', 0.25]]) }]
]);
const block = plans.invade(force);
plans.autoContrast = contrast;
assert(block);
assert.equal(block.IsFinished(), false);
galaxy.time++;
assert.equal(block.IsFinished(), true);
assert.equal(block.Result(), false, 'A failed invasion completes false even though its transport survives and ownership never changes');
assert(!survivor.dead);
assert(galaxy.fleets.some(f => f.owner === a && f.leg));
const snap = snapshotGalaxy(galaxy),
  restored = startingGalaxy(data, campaign);
applyGalaxy(restored, snap);
assert.equal(restored.planets[p.index].owner, b);
assert.deepEqual(snapshotGalaxy(restored).fleets, snap.fleets, 'Post-battle casualties and retreat routes survive snapshots');
const structure = [...db.types.values()].find(t => forceKind(t) === 'ground structure'),
  padRecord = { type: structure, owner: b, position: [3, 4, 5], baseLevel: 1 };
p.groundStructures = [{ type: structure, owner: b }];
p.tacticalStructures = [padRecord, { ...padRecord, baseLevel: 2 }, { ...padRecord, owner: a, baseLevel: 0 }];
const padSnapshot = snapshotGalaxy(galaxy),
  padGalaxy = startingGalaxy(data, campaign);
applyGalaxy(padGalaxy, padSnapshot);
assert.deepEqual(snapshotGalaxy(padGalaxy).planets[p.index].tacticalStructures, padSnapshot.planets[p.index].tacticalStructures);
const { applyInvasionResult } = await import('../public/js/game/invasion.js');
applyInvasionResult(galaxy, { planet: p.index, sides: [a, b], winner: 'defender', participants: [], alive: ['s:0'] });
assert.deepEqual(
  p.tacticalStructures,
  [padRecord],
  'Saved pad defenses prune foreign owners and entries above the surviving ground-base level'
);
assert.equal(restored.planets[p.index].lastSpaceConflict, p.lastSpaceConflict);
assert.equal(
  restored.players.find(p => p.faction === b).lastGroundDefense,
  galaxy.players.find(p => p.faction === b).lastGroundDefense,
  'Native AI conflict cooldowns survive tactical page transitions, including frame zero'
);
const history = game.battles.history;
for (const planet of galaxy.planets) if (planet !== p) planet.owner = null;
galaxy.fleets = [
  { owner: a, units: [troop()], planet: p.index, path: [], leg: null },
  { owner: b, units: [{ ...troop(), owner: b }], planet: p.index, path: [], leg: null }
];
game.battles = new GalacticBattles(game);
game.battles.update();
assert.equal(game.battles.history.length, 1);
assert(
  galaxy.fleets.every(f => !f.leg),
  'A single remaining planet leaves retreat at the original location'
);
galaxy.time += 2;
game.battles.update();
assert.equal(game.battles.history.length, 1, 'An unchanged completed encounter must not repeat every scan');
const host = game.story,
  plot = { name: 'Fixture', owner: a, events: new Map() },
  fired = [];
const event = (name, eventType, params = [], extra = {}) => {
  const e = {
    name,
    plot,
    type: eventType,
    params,
    active: true,
    completed: false,
    disabled: false,
    prereqs: [],
    dependents: [],
    reward: '',
    rewards: [],
    entries: [],
    ...extra
  };
  plot.events.set(name, e);
  return e;
};
const oldEvents = host.eventTypes;
host.eventTypes = new Map();
const win = event('Win', 'STORY_WIN_BATTLES', ['2', 'SPACE', '', 'MatchingPlanet']),
  lose = event('Lose', 'STORY_LOSE_BATTLES', ['1', 'GROUND']),
  perpetual = event('Repeat', 'STORY_WIN_BATTLES', ['2', 'EITHER'], { perpetual: true });
host.eventTypes.set(win.type, [win, perpetual]);
host.eventTypes.set(lose.type, [lose]);
const originalFire = host.fire.bind(host);
host.fire = e => {
  fired.push(e.name);
  return originalFire(e);
};
const storyPlanet = { name: 'OtherPlanet', owner: b },
  storySides = [[unit(a)], [unit(b)]];
battleStory(host, storyPlanet, [b, other], storySides, 0, true);
assert.equal(win.battleCount, undefined);
battleStory(host, storyPlanet, [a, b], storySides, 0, true);
battleStory(host, storyPlanet, [a, b], storySides, 0, true);
assert.equal(win.battleCount, 2);
assert(!win.completed);
assert.equal(perpetual.battleCount, 0, 'Perpetual native reset clears its count');
battleStory(host, { ...storyPlanet, name: 'MatchingPlanet' }, [a, b], storySides, 0, true);
assert(win.completed);
assert(!lose.completed);
battleStory(host, storyPlanet, [b, a], storySides, 0, false);
assert(lose.completed);
const filtered = event('Classes', 'STORY_WIN_BATTLES', ['1', 'SPACE', 'FRIENDLY_CONTAINS, Frigate, Capital']);
host.eventTypes.set(filtered.type, [filtered]);
const local = galaxy.active === a ? 0 : 1,
  summary = [new Set(), new Set()];
summary[local] = new Set(['FRIGATE', 'CAPITAL', 'FIGHTER']);
host.battleClasses = summary;
battleStory(host, storyPlanet, [a, b], storySides, 0, true);
assert(filtered.completed, 'Contains allows extra actual ship classes');
resetCombatEvent(filtered);
filtered.completed = false;
filtered.params[2] = 'FRIENDLY_ONLY_CONTAINS, Frigate, Capital';
battleStory(host, storyPlanet, [a, b], storySides, 0, true);
assert(!filtered.completed, 'Only-contains rejects an extra actual class');
summary[local] = new Set(['CAPITAL']);
battleStory(host, storyPlanet, [a, b], storySides, 0, true);
assert(filtered.completed, 'Only-contains does not require every listed class');
const keptLists = host.battleClasses;
battleClassSummary(host, storyPlanet, [a, b, other].filter(x => x !== galaxy.active).slice(0, 2));
assert.equal(host.battleClasses, keptLists, 'A battle the local player is not in leaves the class lists alone');
battleClassSummary(host, storyPlanet, [a, b]);
assert.notEqual(host.battleClasses, keptLists, 'A battle the local player fights rebuilds them');
resetCombatEvent(filtered);
filtered.completed = false;
filtered.params[2] = 'FILTER_FRIENDLY_ONLY';
host.battleClasses = [new Set(), new Set()];
battleStory(host, storyPlanet, [a, b], storySides, 0, true);
assert(filtered.completed, 'A lone FILTER_ token sets no class filter');
const destroy = event('Destroy', 'STORY_DESTROY', ['Fixture', 'OtherPlanet, MatchingPlanet', '2, 1', 'FILTER_ENEMY_ONLY']),
  named = type('NamedStoryHero', 10, 'Fighter', { Is_Named_Hero: 'Yes' }),
  heroDefeat = event('Hero', 'STORY_DEFEAT_HERO', [named.name, '1', 'FILTER_ENEMY_ONLY']);
host.eventTypes.set(destroy.type, [destroy]);
host.eventTypes.set(heroDefeat.type, [heroDefeat]);
destroyStory(host, t, t, storyPlanet);
assert(!destroy.completed);
destroyStory(host, t, t, storyPlanet);
assert(destroy.completed);
destroyStory(host, named, named, storyPlanet);
assert(heroDefeat.completed);
assert(!fired.includes('CaptureHero'));
const baseEvent = event('StationLoss', 'STORY_DESTROY_BASE', []);
host.eventTypes.set(baseEvent.type, [baseEvent]);
destroyBaseStory(host, { ...storyPlanet, owner: a, stationOwner: b });
assert(!baseEvent.completed, 'Default base-destruction filter reads the surface owner, not station owner');
destroyBaseStory(host, storyPlanet);
assert(baseEvent.completed);
baseEvent.completed = false;
baseEvent.params[1] = 'GROUND';
destroyBaseStory(host, storyPlanet);
assert(!baseEvent.completed, 'Station cleanup emits only the native SPACE base event');
const capture = event('Conquer', 'STORY_CONQUER', [storyPlanet.name, '2'], { perpetual: true }),
  captureCount = event('Count', 'STORY_CONQUER_COUNT', ['2'], { perpetual: true });
host.eventTypes.set(capture.type, [capture]);
host.eventTypes.set(captureCount.type, [captureCount]);
conquerStory(host, storyPlanet);
assert.equal(capture.remainingCounts, undefined, 'Conquer defaults to the current subplot owning faction');
assert.equal(captureCount.battleCount, 1, 'ConquerCount counts changes made by any faction');
conquerStory(host, { ...storyPlanet, owner: a });
assert.equal(capture.remainingCounts[0], 1);
assert.equal(captureCount.battleCount, 2);
resetCombatEvent(captureCount);
assert.equal(captureCount.battleCount, 2, 'Generic native reset leaves the conquest counter intact');
conquerStory(host, { ...storyPlanet, owner: a });
assert.equal(capture.remainingCounts, null, 'Single-object counts reset on perpetual conquest events');
assert.equal(captureCount.battleCount, 3);
assert.equal(fired.filter(n => n === 'Count').length, 2, 'A rearmed conquest counter remains above its threshold');
const fixtureStation = type('StationStoryFixture', 1, 'Fighter', { Base_Level: 1 }),
  stationObjectDeath = event('FalseStationObjectDeath', 'STORY_DESTROY', [fixtureStation.name]);
host.eventTypes.set(stationObjectDeath.type, [stationObjectDeath]);
host.stationChanged(p, fixtureStation, null, a);
assert(!stationObjectDeath.completed, 'Strategic station changes never fabricate XML object-destruction events');
host.eventTypes = oldEvents;
host.fire = originalFire;
const scored = { type: ship, owner: b },
  before = host.vm.call(host.scoring.env, 'Get_Frag_Count_For_Type', host.type(ship), host.player(a));
assert(before.ok, JSON.stringify(before));
host.combatDeath(scored, p, b, a);
const after = host.vm.call(host.scoring.env, 'Get_Frag_Count_For_Type', host.type(ship), host.player(a));
assert.equal(after.value, before.value + 1, 'Original Lua records the autoresolve kill');
host.vm.set(host.scoring.env, 'DeathFixture', host.object(scored, p, b));
assert.equal(
  host.vm.run(
    `SavedDeathTable=DeathTable;DeathTable={};DeathSeen=0;Register_Death_Event(DeathFixture,function(...) assert(select('#',...)==0);DeathSeen=DeathSeen+1 end);Process_Death_Events();assert(DeathSeen==0)`,
    'register original death helper',
    host.scoring.env
  ),
  null
);
scored.dead = true;
assert.equal(
  host.vm.run(
    `Process_Death_Events();Process_Death_Events();assert(DeathSeen==1);DeathTable=SavedDeathTable;SavedDeathTable=nil`,
    'pump original death helper',
    host.scoring.env
  ),
  null,
  'Original Lua observes the dead record once and invokes its callback without arguments'
);
const moveRecord = { type: ship, owner: a };
const callbackInst = { env: host.vm.environment(), state: 'run', events: [], ai: { player: { faction: a } }, forces: [] };
host.vm.run(
  'function Probe_Space_Conflict_Begin(tf) end; function Probe_Space_Conflict_End(tf) end; function Probe_Ground_Conflict_Begin(tf) end; function Probe_Ground_Conflict_End(tf) end',
  'conflict callback fixture',
  callbackInst.env
);
const moving = {
  inst: callbackInst,
  name: 'Probe',
  units: [moveRecord],
  wrapper: { __wrap: true },
  conflictCommand: { space: true, active: true, planets: new Set() }
};
callbackInst.forces = [moving];
galaxy.fleets = [{ owner: a, units: [moveRecord], planet: p.index, path: [], leg: null }];
plans.locationTime = -Infinity;
plans.live.push(callbackInst);
plans.conflict(p, [a, b], true, true);
plans.conflict(p, [a, b], true, false);
assert.equal(callbackInst.events.length, 2);
assert(
  callbackInst.events.every(e => e.params.length === 1 && e.params[0] === moving.wrapper),
  'Native conflict callbacks receive only the taskforce'
);
moving.conflictCommand.active = false;
plans.conflict(p, [a, b], true, true);
assert.equal(callbackInst.events.length, 2, 'Reservations without an active blocking command receive no conflict callbacks');
moving.conflictCommand = { space: false, active: true, planets: new Set() };
plans.conflict(p, [a, b], false, true);
plans.conflict(p, [a, b], false, false);
assert.equal(callbackInst.events.length, 4);
assert(callbackInst.events.every(e => e.params.length === 1));
plans.live.splice(plans.live.indexOf(callbackInst), 1);
for (const e of callbackInst.events) host.vm.free(e.fn);
host.vm.free(callbackInst.env);
assert.deepEqual([...host.errors], [], 'Native battle and scoring callbacks run without Lua errors');
game.ai.dispose();
game.story.dispose();
archive.close();
console.log(JSON.stringify({ mod: mod >= 0, contrast: [...contrast.keys()], battles: history, status: 'PASS' }));
