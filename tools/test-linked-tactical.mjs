import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod'),
  archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]),
  overlay = new Map();
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const name = decodeURIComponent(path.replace(/^asset\//, '').split('?')[0]),
    k = archive.resolve(name),
    bytes = overlay.get(name.toUpperCase()) ?? (k && archive.read(k));
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { parseXML } = await import('../public/js/xml.js');
const { loadCampaignData, startingGalaxy } = await import('../public/js/game/galaxy.js');
const { GalacticGame } = await import('../public/js/game/galactic.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const { GalacticBattles } = await import('../public/js/game/galacticbattles.js');
const { loadFengari } = await import('../public/js/lua.js');
const { readLinkedTactical, linkedTacticalSetup, linkedMapLoaded, finishLinkedTactical, authoredMapOwner, missionMapActor } = await import(
  '../public/js/game/linktactical.js'
);
const { launchLinkedMission, returnLinkedMission, linkedMissionVictory } = await import('../public/js/game/linkedmission.js');
const { splitForCap } = await import('../public/js/game/campaignbattle.js');
const { pathfinder, placeLandInvasion } = await import('../public/js/game/campaignland.js');
const { loadMap } = await import('../public/js/ted.js');
const { isTacticalSuperweapon } = await import('../public/js/game/tacticalsuperweapon.js');
const { LinkedPresentation } = await import('../public/js/game/linkedpresentation.js');
const { TacticalCampaign } = await import('../public/js/game/tacticalcampaign.js');
const { StoryFlags } = await import('../public/js/game/storyflags.js');
const data = await loadCampaignData(),
  campaign = data.campaigns.get(mod < 0 ? 'SANDBOX_EQUAL_FOOTING_EMPIRE' : 'KNOWNSMALL_ERA_1_EMPIRE'),
  g = startingGalaxy(data, campaign),
  p = g.planets.find(p => !p.background && p.owner !== g.active),
  me = g.active,
  enemy = p.owner;
const game = {
  setup: { difficulty: 'medium' },
  galaxy: g,
  me,
  keys: new Set(),
  mouse: { in: false },
  neutralizePopup: { close() {} },
  pendingLinkedTactical: null,
  linkedMission: null,
  paused: true,
  modeSuspended: false,
  uiPauseReasons: new Set(),
  setUIPause(reason, on) {
    on ? this.uiPauseReasons.add(reason) : this.uiPauseReasons.delete(reason);
  },
  mergeFleets() {},
  fleetViews: new Map(),
  async fleetView(f) {
    this.fleetViews.set(f, {});
  },
  fit() {},
  frame() {}
};
game.queueLinkedTactical = GalacticGame.prototype.queueLinkedTactical;
const host = (game.story = new GalacticStoryHost(game, await loadFengari(), []));
game.battles = new GalacticBattles(game);
const ship = [...db.types.values()].find(
    t => t.str('Space_Model_Name') && t.str('Ship_Class') === 'Capital' && t.num('Build_Cost_Credits', 0) > 0
  ),
  weapon = [...db.types.values()].find(isTacticalSuperweapon);
assert(ship && weapon);
const params = [p.name, 'SPACE', me, 'EM15_The_Destruction_of_Alderaan.TED', enemy, ship.name, 'Story_Plots_Empire_ActIV_M11_SPACE.xml'];
const request = readLinkedTactical(game, params);
assert(request);
assert.equal(request.sandbox, false);
assert.equal(request.cinematic, 1);
assert.equal(request.resolution, 3);
assert(request.pending && request.pathfinder);
assert.equal(readLinkedTactical(game, params.slice(0, 4)), null);
assert.equal(readLinkedTactical(game, ['Absent', ...params.slice(1)]), null);
assert.equal(readLinkedTactical(game, [p.name, 'space', ...params.slice(2)]).mode, 'land', 'Unknown enum defaults to native GROUND');
const chosen = readLinkedTactical(game, [...params, '1', '2', '1', '1', 'RETREAT_AI', '0', '0']);
assert.equal(chosen.resolution, 2);
assert.equal(chosen.cinematic, 2);
assert(chosen.faded && chosen.letterbox && chosen.sandbox);
assert(!chosen.pending && !chosen.pathfinder);
let authored = 0;
for (const [name] of archive.index)
  if (/\.XML$/i.test(name) && /STORY_(CAMPAIGN|SANDBOX|TUTORIAL)/i.test(name)) {
    const text = archive.read(name)?.toString();
    if (!text?.includes('LINK_TACTICAL')) continue;
    for (const root of parseXML(text).children)
      for (const e of root.children)
        if (e.val('Reward_Type') === 'LINK_TACTICAL') {
          const values = Array.from({ length: 14 }, (_, i) => e.val('Reward_Param' + (i + 1)));
          assert(values.slice(0, 5).every(Boolean), name);
          authored++;
        }
  }
assert(authored > 10, 'Read original authored LINK_TACTICAL missions');
const human = { type: ship },
  reserve = { type: ship },
  ai = { type: ship };
g.fleets = [
  { owner: me, planet: p.index, units: [human, reserve], leg: null, path: [] },
  { owner: enemy, planet: p.index, units: [ai], leg: null, path: [] }
];
let session = linkedTacticalSetup(game, request);
assert.equal(session.participants.size, 0);
assert.equal(session.setup.mapFile, params[3]);
assert.equal(session.setup.tacticalStoryPlot, params[6]);
session = linkedTacticalSetup(game, { ...request, sandbox: true });
assert.equal(session.participants.size, 2);
assert.equal(session.setup.campaign.defender.units.length, 0, 'Sandbox excludes AI strategic units');
const roster = [
  { type: ship, gid: 'a' },
  { type: ship, gid: 'b' },
  { type: weapon, gid: 'w' }
];
let split = splitForCap(roster, 1, { hero: ship.name, pathfinder: true });
assert.deepEqual(
  split.field.map(u => u.gid),
  ['a', 'w']
);
assert.deepEqual(
  split.waiting.map(u => u.gid),
  ['b']
);
split = splitForCap(roster, 1, { hero: 'Absent', pathfinder: true });
assert.equal(split.field.filter(u => u.type === weapon).length, 1, 'TSW always deploys');
assert.equal(pathfinder([{ type: ship.name }, { type: weapon.name }], weapon.name).type, weapon.name);
const mapOnlyLand = await placeLandInvasion({}, { objects: [] }, { attacker: {}, defender: {}, linked: { sandbox: false } });
assert.equal(mapOnlyLand.companies.size, 0, 'Map-only land missions do not require invasion entry markers');
const actualMap = await loadMap(mod < 0 ? 'EM15_The_Destruction_of_Alderaan.TED' : p.type.str('Space_Tactical_Map'));
assert(actualMap.objects.some(o => o.owner >= 0));
if (mod < 0) {
  const home = actualMap.objects.find(o => o.type.name.toUpperCase() === 'HOME_ONE');
  assert(home);
  assert.equal(home.owner, 0);
  assert.equal(authoredMapOwner({ linkedTactical: request }, home), 'Rebel');
}
if (mod < 0) {
  const ground = await loadMap('EM02_An_Organized_Resistance.TED');
  for (const name of ['Darth_Vader', 'MOV_FIELD_COMMANDER_EMPIRE', 'Imperial_Medium_Stormtrooper_Squad']) {
    const o = ground.objects.find(o => o.type.name === name);
    assert(o);
    assert(missionMapActor({ mode: 'land' }, o), 'Authored mission actors include containers and nonselectable cinematic objects: ' + name);
  }
}
const events = `<Story><Event Name="Load"><Event_Type>STORY_LOAD_TACTICAL_MAP</Event_Type><Event_Param1>${p.name}</Event_Param1><Event_Param2>${ship.name}</Event_Param2><Event_Param3>SPACE</Event_Param3><Reward_Type>SET_FLAG</Reward_Type><Reward_Param1>Loaded</Reward_Param1><Reward_Param2>1</Reward_Param2></Event><Event Name="Loss"><Event_Type>STORY_MISSION_LOST</Event_Type><Event_Param1>${params[6]}</Event_Param1><Reward_Type>SET_FLAG</Reward_Type><Reward_Param1>MissionLost</Reward_Param1><Reward_Param2>1</Reward_Param2></Event></Story>`;
overlay.set('DATA/XML/LINKPROBE.XML', events);
await host.readPlot('LinkProbe.xml', '', me);
linkedMapLoaded(host, { ...request, hero: 'Absent' });
assert.equal(host.flags.get('Loaded'), undefined);
linkedMapLoaded(host, request);
assert.equal(host.flags.get('Loaded'), 1);
host.sources.set(
  '__LINK_CONTINUATION',
  'function main() while true do GlobalValue.Set("Continuations",(GlobalValue.Get("Continuations") or 0)+1); coroutine.yield() end end'
);
const inst = host.addScript('__LINK_CONTINUATION');
host.update(0, true);
const env = inst.env,
  before = host.values.get('Continuations');
const oldDocument = globalThis.document,
  oldLocation = globalThis.location,
  oldRAF = globalThis.requestAnimationFrame;
let removed = false,
  frames = 0;
globalThis.document = {
  createElement: () => ({
    style: {},
    contentWindow: { game: { paused: false, over: false } },
    focus() {},
    remove() {
      removed = true;
    }
  }),
  body: { appendChild() {} }
};
globalThis.location = { pathname: '/play.html', href: 'http://localhost/play.html', search: '' };
globalThis.requestAnimationFrame = () => frames++;
await launchLinkedMission(game, { ...request, sandbox: true, resolution: 1 });
assert(game.modeSuspended);
assert.equal(host.instances[0].env, env);
assert(game.paused);
assert(game.linkedMission.frame.src.includes('linked-tactical=1'));
const flags = host.flags.snapshot();
linkedMissionVictory(game, enemy, flags);
assert.equal(host.flags.get('MissionLost'), 1);
assert.equal(game.modeSuspended, true, 'Mission loss is delivered at latch, before return');
assert(game.queueLinkedTactical(params), 'A callback can queue the next mission during tactical play');
const next = game.pendingLinkedTactical;
const live = game.linkedMission;
assert.equal(live.participants.size, 2);
const originalFleet = g.fleets[0];
await returnLinkedMission(game, { winner: 'attacker', alive: ['0:0', '0:1'], storyFlags: host.flags.snapshot() });
assert(removed);
assert(!game.modeSuspended && game.linkedMission === null);
assert(game.paused, 'Existing player pause survives mission');
assert.equal(host.instances[0].env, env);
assert.equal(inst.starts, 1);
host.update(1, true);
assert(host.values.get('Continuations') > before);
assert(frames > 0);
assert(originalFleet.units.includes(human), 'Strategic identity is retained');
assert.equal(game.pendingLinkedTactical, next, 'Returning must not drop the queued next mission');
game.pendingLinkedTactical = null;
globalThis.document = oldDocument;
globalThis.location = oldLocation;
globalThis.requestAnimationFrame = oldRAF;
p.owner = enemy;
p.station = ship;
p.stationOwner = enemy;
p.orbitalStructures = [];
p.groundStructures = [];
p.garrison = [];
g.fleets = [
  { owner: me, planet: p.index, units: [human], leg: null, path: [] },
  { owner: enemy, planet: p.index, units: [{ type: ship }], leg: null, path: [] }
];
const player = g.players.find(p => p.faction === enemy);
player.credits = 0;
const expected = ship.num('Build_Cost_Credits', 0) * 2;
session = linkedTacticalSetup(game, { ...request, resolution: 3, sandbox: false });
finishLinkedTactical(game, session, { winner: 'attacker', alive: [] });
assert(g.fleets.some(f => f.units.includes(human)));
assert(!g.fleets.some(f => f.owner === enemy && f.planet === p.index));
assert.equal(p.station, null);
assert.equal(p.owner, enemy);
assert.equal(player.credits, expected);
p.station = ship;
p.spaceLevel = 2;
p.stationOwner = enemy;
p.orbitalStructures = [{ type: ship, owner: enemy }];
p.production.space = [{}];
session = linkedTacticalSetup(game, { ...request, sandbox: false });
finishLinkedTactical(game, session, { winner: 'defender', alive: [], linkedStation: null });
assert.equal(p.station, null);
assert.equal(p.spaceLevel, 0);
assert.equal(p.orbitalStructures.length, 0);
assert.equal(p.owner, enemy);
p.groundStructures = [{ type: ship, owner: me }];
p.production.ground = [{}];
const originalOwner = p.owner;
session = linkedTacticalSetup(game, { ...request, mode: 'land', attacker: enemy, defender: me, sandbox: false });
finishLinkedTactical(game, session, { winner: 'attacker', alive: [] });
assert.equal(p.groundStructures.length, 0);
assert.equal(p.owner, originalOwner);
assert.equal(p.groundBaseOwner, enemy);
assert.equal(p.production.ground.length, 0);
const faction = db.faction(enemy),
  leader = faction.str('Faction_Leader'),
  leaderCompany = [...db.types.values()].find(t => t.list('Company_Units').some(n => n.toUpperCase() === leader.toUpperCase()));
if (leaderCompany) {
  const parentPlanet = {
      ...p,
      destroyed: false,
      garrison: [{ type: leaderCompany, owner: enemy }],
      groundStructures: [],
      tacticalStructures: []
    },
    childPlanet = { ...parentPlanet, garrison: parentPlanet.garrison.slice() };
  const declarations = [],
    previous = {
      setup: {},
      galaxy: { ...g, planets: g.planets.map(q => (q === p ? parentPlanet : q)) },
      victory: { declareCondition: (...args) => declarations.push(args) }
    };
  const child = {
    setup: { linkedTactical: request, campaign: { planet: p.index } },
    world: { onEvent() {} },
    tacticalStory: { flags: new StoryFlags(), eventTypes: new Map() }
  };
  const oldWindow = globalThis.window;
  globalThis.window = { parent: { game: previous } };
  previous.linkedMission = { frame: { contentWindow: globalThis.window } };
  const campaign = new TacticalCampaign(child, { ...g, planets: g.planets.map(q => (q === p ? childPlanet : q)) });
  campaign.victory.records.push({ type: 7, player: me, names: [] });
  assert(campaign.destroy({ player: { factionName: me } }));
  assert(parentPlanet.destroyed);
  assert(childPlanet.destroyed);
  assert.deepEqual(declarations, [[7, me, 30]]);
  assert.equal(previous.galaxy.planets[p.index], parentPlanet);
  globalThis.window = oldWindow;
}

const fx = new LinkedPresentation({ faded: true, letterbox: false }, 0.085);
fx.fadeTo(true, 2);
fx.update(0.5);
assert.equal(fx.alpha, 0.75);
fx.fadeTo(false, 1);
assert.equal(fx.alpha, 0);
fx.update(0.5);
assert.equal(fx.alpha, 0.5);
fx.bars(true, 2);
fx.update(1);
assert.equal(fx.bar, 0.0425);
fx.bars(false, 2);
fx.update(0.5);
assert(Math.abs(fx.bar - 0.02125) < 1e-9);
console.log(
  JSON.stringify({
    overlay: mod < 0 ? 'base' : 'mod',
    authored,
    checks:
      'original LINK parameters and TED owners, map-only/sandbox rosters, hero/TSW staging, live VM and pause retention, latch-time mission loss, return policies/refunds, native presentation'
  })
);
