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
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy } = await import('../public/js/game/galaxy.js');
const { GalacticVictory, GALACTIC_VICTORIES } = await import('../public/js/game/galacticvictory.js');
const { destroyPlanet, groundActivated, planetDestructionAllowed, destroyedPlanetModel } = await import(
  '../public/js/game/planetdestruction.js'
);
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const { adjustCredits, stepIncome } = await import('../public/js/game/galacticeconomy.js');
const { scheduleHeroRespawn, stepHeroRespawns } = await import('../public/js/game/galacticherorespawn.js');
const data = await loadCampaignData(),
  c = data.campaigns.get(mod < 0 ? 'SANDBOX_EQUAL_FOOTING_EMPIRE' : 'KNOWNSMALL_ERA_1_EMPIRE');
const g = startingGalaxy(data, c),
  game = {
    galaxy: g,
    me: g.active,
    setup: {},
    paused: true,
    scriptUI: { visibility() {}, enable() {}, text() {}, icon() {}, click() {} },
    neutralizePopup: { open() {}, close() {} }
  };
const a = g.active,
  b = g.players.find(
    p =>
      db
        .faction(a)
        .list('Enemies')
        .some(n => n.toUpperCase() === p.faction.toUpperCase()) && db.faction(p.faction).bool('Is_Playable')
  ).faction;
const fixture = (props = {}) => {
  const campaign = new ObjType('Campaign', 'Fixture');
  for (const [k, v] of Object.entries(props)) campaign.props.set(k.toLowerCase(), [String(v)]);
  return campaign;
};
const fresh = (props = {}) => {
  const galaxy = {
      campaign: fixture(props),
      active: a,
      time: 0,
      players: [
        { faction: a, credits: 100, ai: null },
        { faction: b, credits: 100, ai: 'AI' }
      ],
      planets: [
        { name: 'One', owner: a },
        { name: 'Two', owner: b }
      ],
      fleets: []
    },
    game = { galaxy, me: a, story: { signal: (...args) => game.signals.push(args) }, signals: [], endCampaign: r => (game.ended = r) };
  game.victory = new GalacticVictory(game);
  return game;
};
let f = fresh();
assert.deepEqual(
  f.victory.records.filter(r => r.player === a).map(r => r.type),
  [0, 6]
);
assert.deepEqual(
  f.victory.records.filter(r => r.player === b).map(r => r.type),
  [0, 6, 1]
);
f.galaxy.players[1].ai = null;
assert(new GalacticVictory(f).registered(1, b), 'Nonactive default registration does not depend on an AI controller pointer');
assert(!f.victory.declareCondition(3, a, 5), 'Unregistered producer is ignored');
assert(!f.victory.test(0, a));
f.galaxy.planets[1].owner = a;
f.galaxy.planets[1].destroyed = true;
f.victory.ownershipChanged();
assert.equal(f.victory.winner.type, 0);
assert.equal(f.signals.length, 0, 'Strategic victories do not broadcast STORY_VICTORY');
f.galaxy.time = 29 / 30;
f.victory.update();
assert(!f.ended);
f.galaxy.time = 1;
f.victory.update();
assert.equal(f.ended.player, a);
f = fresh({ Human_Victory_Conditions: GALACTIC_VICTORIES[2], Human_Victory_Credit_Target: 120 });
f.victory.enable(false);
f.victory.enable(false);
adjustCredits(f.galaxy, a, 50);
assert(!f.victory.winner);
assert.equal(f.victory.deferred.length, 1);
f.victory.enable(true);
assert(!f.victory.winner);
f.victory.enable(true);
assert.equal(f.victory.winner.type, 2);
f = fresh({ Human_Victory_Conditions: GALACTIC_VICTORIES[4] });
assert.equal(f.victory.registered(4, a).value, 1);
f.galaxy.planets[1].politicalTargetOwner = a;
assert(f.victory.test(4, a), 'Type4 tests target political ownership');
f = fresh({ Human_Victory_Conditions: GALACTIC_VICTORIES[10], Human_Victory_Cycle_Limit: 1 });
f.galaxy.fiscal = { cycle: 1 };
assert(!f.victory.test(10, a));
f.galaxy.fiscal.cycle = 2;
assert(f.victory.test(10, a), 'Cycle comparison is strictly greater');
f = fresh();
f.victory.enable(false);
assert(f.victory.storyVictory(b, true));
assert.equal(f.victory.disableDepth, 0);
assert.equal(f.victory.winner.frames, 30);
assert.deepEqual(f.signals, [['STORY_VICTORY', b]]);
assert(!f.victory.storyVictory(a), 'First result stays latched');
f.galaxy.victorySaved = f.victory.snapshot();
const restored = new GalacticVictory(f);
assert.deepEqual(restored.snapshot(), f.victory.snapshot());
f = fresh({ Human_Victory_Conditions: GALACTIC_VICTORIES[9], Human_Victory_Planet_Names: 'Unknown' });
assert(f.victory.test(9, a), 'Unknown named planets are ignored, including empty result');
f = fresh({ Human_Victory_Conditions: GALACTIC_VICTORIES[8] });
const leader = db.type(db.faction(b).str('Faction_Leader_Company'));
if (leader) {
  f.galaxy.planets[1].killedHeroes = [{ type: leader.name, owner: b, killer: b, dueFrame: 1000 }];
  assert(!f.victory.test(8, a), 'Killer attribution matters');
  f.galaxy.planets[1].killedHeroes[0].killer = a;
  assert(f.victory.test(8, a));
  f = fresh({ Human_Victory_Conditions: GALACTIC_VICTORIES[8] });
  f.victory.deadLeaders = [{ type: leader.list('Company_Units')[0], owner: b, killer: a }];
  assert(f.victory.test(8, a), 'Native dead leader object path works without a respawn entry');
}
const primary = db.faction(db.faction(a).str('Primary_Enemy'));
if (primary?.str('Home_Planet') && primary.str('Faction_Leader_Company')) {
  f = fresh({ Human_Victory_Conditions: GALACTIC_VICTORIES[5] });
  f.galaxy.planets[1].name = primary.str('Home_Planet');
  f.galaxy.planets[1].politicalTargetOwner = a;
  f.galaxy.planets[0].killedHeroes = [{ type: primary.str('Faction_Leader_Company'), killer: b }];
  assert(f.victory.test(5, a), 'Homeworld target owner plus leader queue anywhere, without killer filter');
}
game.victory = new GalacticVictory(game);
game.story = await GalacticStoryHost.create(game);
assert(!game.victory.winner, 'Initial balance and ownership do not invent a victory trigger');
const host = game.story,
  p = g.planets.find(p => !p.background && p.owner === b),
  killer = [...db.types.values()].find(t =>
    t.sub('Abilities').some(n => n.children.some(a => a.tag.toUpperCase() === 'PLANET_DESTRUCTION_ABILITY'))
  );
assert(killer, 'Overlay supplies its own destruction ability');
const actor = { type: killer, owner: a, planet: p, dead: false },
  ship = [...db.types.values()].find(t => t.behaviors().has('DUMMY_STARSHIP')) || killer;
g.fleets = [{ owner: b, planet: p.index, leg: null, path: [], dest: -1, units: [{ type: ship }] }];
assert(!planetDestructionAllowed(game, actor, p), 'Contested space blocks the strategic ability');
actor.checkContestedSpace = false;
assert(planetDestructionAllowed(game, actor, p));
const victim = { type: ship, owner: b },
  building = { type: ship, owner: b },
  orbital = { type: ship, owner: b };
p.garrison = [victim];
p.groundStructures = [building];
p.orbitalStructures = [orbital];
p.currentCorruption = 3;
p.creditSiphonOwner = a;
p.station = ship;
p.tacticalStructures = [{ type: ship, owner: b, position: [0, 0, 0] }];
const wrapper = host.object(victim, p, b),
  planetWrapper = host.planet(p),
  events = host.eventTypes.get('STORY_PLANET_DESTROYED');
let observed = 0;
const event = {
  type: 'STORY_PLANET_DESTROYED',
  name: 'FixtureDestruction',
  active: true,
  disabled: false,
  completed: false,
  params: [p.name, 'FILTER_FRIENDLY_ONLY', 'AbsentIncomingUnit', ship.name],
  rewards: [],
  reward: '',
  plot: { owner: b, events: new Map() }
};
host.eventTypes.set('STORY_PLANET_DESTROYED', [event]);
const fire = host.fire.bind(host);
host.fire = e => {
  if (e === event) {
    assert(!p.destroyed);
    assert.equal(p.garrison[0], victim);
    observed++;
  } else fire(e);
};
assert(!groundActivated(game, actor, 'WrongType'));
assert(!p.destroyed);
assert(groundActivated(game, actor, killer.name));
assert.equal(observed, 1);
assert(p.destroyed);
assert(planetWrapper.Is_Valid());
assert(planetWrapper.Is_Planet_Destroyed());
assert(!wrapper.Is_Valid());
assert.equal(p.owner, b);
assert.equal(p.station, ship);
assert.deepEqual(p.orbitalStructures, [orbital]);
assert.equal(g.fleets.length, 1);
assert.equal(p.currentCorruption, -1);
assert.equal(p.creditSiphonOwner, -1);
assert.equal(p.tacticalStructures.length, 0);
assert(!destroyPlanet(game, p));
assert.equal(observed, 1);
assert.equal(destroyedPlanetModel(p), p.type.str('Destroyed_Galactic_Model_Name'));
const saved = snapshotGalaxy(g),
  copy = startingGalaxy(data, c);
applyGalaxy(copy, saved);
assert(copy.planets[p.index].destroyed);
assert.equal(copy.planets[p.index].station, ship);
assert.deepEqual(saved.victory, game.victory.snapshot());
p.destroyed = false;
p.garrison = [];
host.eventTypes.set('STORY_PLANET_DESTROYED', []);
host.fire = fire;
host.vm.set(host.scoring.env, 'KillerFixture', host.object(actor));
host.vm.set(host.scoring.env, 'KillerType', host.type(killer));
assert.equal(
  host.vm.run(
    'KillerFixture.Set_Check_Contested_Space(false);assert(KillerFixture.Activate_Ability(KillerType)==nil)',
    'native destruction command',
    host.scoring.env
  ),
  null
);
assert(p.destroyed);
host.eventTypes.set('STORY_PLANET_DESTROYED', events || []);
const depth = game.victory.disableDepth;
host.reward({ reward: 'ENABLE_VICTORY', rewards: ['0'] });
assert.equal(game.victory.disableDepth, depth + 1);
host.reward({ reward: 'ENABLE_VICTORY', rewards: ['1'] });
assert.equal(game.victory.disableDepth, depth);
host.reward({ reward: 'VICTORY', rewards: [a, '1'] });
assert.equal(game.victory.winner.type, 16);
assert.equal(game.victory.winner.frames, 30);
assert.equal(game.victory.disableDepth, 0);
assert.deepEqual(Object.fromEntries(host.errors), {});
host.dispose();
const hero = [...db.types.values()].find(
  t => t.bool('Is_Named_Hero') && t.list('Company_Units').length && t.list('Company_Transport_Unit').length
);
assert(hero);
const hplanet = g.planets.find(p => !p.background);
hplanet.owner = a;
hplanet.destroyed = true;
hplanet.garrison = [];
hplanet.groundStructures = [];
g.fleets = [];
const scheduled = scheduleHeroRespawn(game, { type: hero, owner: a }, hplanet, a, b);
assert.equal(scheduled, db.constants.num('Default_Hero_Respawn_Time') >= 0);
if (scheduled) {
  const entry = hplanet.killedHeroes.at(-1);
  g.time = (entry.dueFrame - 1) / 30;
  stepHeroRespawns(game);
  assert(hplanet.killedHeroes.includes(entry));
  g.time = entry.dueFrame / 30;
  stepHeroRespawns(game);
  assert(!hplanet.killedHeroes.includes(entry));
  assert(
    g.fleets.some(f => f.planet === hplanet.index && f.units.some(u => u.carries === hero)),
    'Destroyed nearest world receives an orbiting hero transport'
  );
}
console.log(
  JSON.stringify({
    overlay: mod < 0 ? 'base' : 'mod',
    killer: killer.name,
    conditions: GALACTIC_VICTORIES.length,
    checks:
      'registration, countdown, disable nesting, script reward, ownership axes, producer guard, Lua activation, cleanup, event ordering, snapshot'
  })
);
