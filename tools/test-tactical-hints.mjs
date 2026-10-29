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
const { db, loadGameData } = await import('../public/js/gamedata.js');
const { loadMap } = await import('../public/js/ted.js');
const { LandSquad } = await import('../public/js/game/land.js');
const { TacticalMarker, hintedObjects, tacticalObjectType } = await import('../public/js/game/tacticalobjects.js');
const { ScriptHost } = await import('../public/js/game/scripts.js');
const { LuaVM, loadFengari } = await import('../public/js/lua.js');
await loadGameData();
const map = await loadMap('EM02_An_Organized_Resistance.TED');
const players = ['Empire', 'Rebel', 'Neutral'].map((factionName, id) => ({
  factionName,
  id,
  team: { id },
  faction: db.faction(factionName)
}));
const world = {
  time: 0,
  units: [],
  squads: [],
  players,
  neutral: players[2],
  wild: 2,
  sidePlayers: players,
  mapObjects: new Map(),
  selectables() {
    return this.units;
  },
  onEvent() {}
};
const makeSquad = (type, at, side = 0) => {
  const squad = new LandSquad(world, type, side);
  const memberType = db.type(type.list('Company_Units')[0]) || type;
  squad.members.push({ type: memberType, x: at.x, y: at.y, z: at.z || 0, health: 100, maxHealth: 100, abilities: [] });
  squad.full = 100;
  world.units.push(squad);
  return squad;
};
for (const [index, placed] of map.objects.entries()) {
  const at = { x: placed.pos[0], y: placed.pos[1], z: placed.pos[2] || 0 };
  const marker = placed.type.bool('Is_Marker') || placed.type.list('Behavior').some(s => s.toUpperCase() === 'MARKER');
  const object = marker
    ? new TacticalMarker(placed, () => players[placed.owner] || players[2])
    : makeSquad(placed.type, at, placed.owner >= 0 && placed.owner < 2 ? placed.owner : 2);
  object.mapIndex = index;
  world.mapObjects.set(index, [object]);
}
const game = {
  map,
  world,
  land: true,
  human: players[0],
  setup: { fog: true },
  environmentFogEnabled: true,
  spawnNow: (type, player, at) => makeSquad(type, at, player.id)
};
const scripts = Object.assign(Object.create(ScriptHost.prototype), {
  game,
  world,
  land: true,
  instances: [],
  storyInstances: [],
  storyTime: 0,
  sources: new Map(),
  index: new Map(),
  fetching: 0,
  missing: new Map(),
  errors: new Map(),
  values: new Map(),
  wrapped: new WeakMap(),
  current: null,
  plans: {
    ready: true,
    update() {},
    block(done) {
      return { __wrap: true, Is_Finished: done };
    }
  },
  cmd: { teleport() {}, move() {}, guard() {}, stop() {} },
  attach() {},
  told: [],
  inert: new Set(),
  messages: new Map()
});
scripts.vm = new LuaVM(await loadFengari(), { source: key => scripts.source(key) });
scripts.globals();
for (const [path] of archive.index)
  if (/\\SCRIPTS\\.*\.LUA$/i.test(path)) {
    const parts = path
      .replace(/^.*?\\SCRIPTS\\/i, '')
      .replace(/\.LUA$/i, '')
      .split('\\');
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(i).join('/').toUpperCase();
      if (!scripts.sources.has(key)) scripts.sources.set(key, archive.read(path).toString());
    }
  }
const probe = scripts.vm.environment({});
const lua = source => {
  assert.equal(scripts.vm.run('function HintProbe() ' + source + ' end', 'Hint regression', probe), null);
  const result = scripts.vm.call(probe, 'HintProbe');
  assert(result.ok, result.error);
  return result.value;
};
const authoredFog = map.environment.fog.on;
lua('Enable_Fog(false)');
assert.equal(game.environmentFogEnabled, false);
assert.equal(game.setup.fog, true);
assert.equal(map.environment.fog.on, authoredFog);
lua('Enable_Fog(1)');
assert.equal(game.environmentFogEnabled, false);
lua('Enable_Fog(true)');
assert.equal(game.environmentFogEnabled, true);
lua('Enable_Distance_Fog(false)');
assert.equal(map.environment.fog.on, false);
assert.equal(game.environmentFogEnabled, true);
lua('Enable_Distance_Fog(1)');
assert.equal(map.environment.fog.on, false);
lua('Enable_Distance_Fog(true,false)');
assert.equal(map.environment.fog.on, false);
map.environment.fog.on = authoredFog;
const placed = map.objects.find(o => o.hint.toUpperCase() === 'HIDETROOPERS1');
assert(placed);
const company = placed.type,
  team = db.type(company.str('Create_Team_Type'));
assert(team, 'The installed hinted company must declare its effective tactical team type');
const squad = world.mapObjects.get(map.objects.indexOf(placed))[0];
assert.equal(tacticalObjectType(squad), team);
assert.deepEqual(hintedObjects(scripts, team, 'HiDeTrOoPeRs1'), [squad]);
assert.equal(lua(`return Find_Hint("${team.name}","HiDeTrOoPeRs1")`).__entity, squad);
assert.equal(
  lua(`return Find_Hint("${team.name}","hidetroopers1").Get_Hint()`),
  placed.hint,
  'Generated team wrappers retain the authored company hint'
);
assert.equal(lua(`return Find_Hint(Find_Object_Type("${team.name}"),"hidetroopers1")`).__entity, squad);
assert.equal(
  lua(`return Find_Hint("${team.name}")`).__entity,
  hintedObjects(scripts, team)[0],
  'Omitting the hint returns the first live hinted object of that exact type'
);
assert.equal(
  lua(`return Find_Hint("${company.name}","hidetroopers1")`),
  undefined,
  'A company name must not match the generated team effective type'
);
assert.equal(
  lua(`return Find_Hint("${squad.members[0].type.name}","hidetroopers1")`),
  undefined,
  'A child soldier must not stand in for its team'
);
assert.equal(lua('return Find_Hint("Not_An_Object_Type","hidetroopers1")'), undefined);
assert.equal(lua('return Find_Hint("Generic_Marker_Land","no-such-hint")'), undefined, 'Missing hints never manufacture positions');
assert.equal(lua('return Find_Hint()'), undefined);
const markerPlaced = map.objects.find(o => o.hint.toUpperCase() === 'SPACECINEMATICCENTER');
assert(markerPlaced);
const marker = world.mapObjects.get(map.objects.indexOf(markerPlaced))[0];
assert(marker instanceof TacticalMarker);
assert.equal(lua(`return Find_Hint("${marker.type.name}","spacecinematiccenter")`).__entity, marker);
assert.equal(
  lua(`return Find_Hint("${marker.type.name}","spacecinematiccenter").Get_Game_Object()`).__entity,
  marker,
  'Markers are live objects rather than position wrappers'
);
assert.deepEqual(scripts.at(scripts.wrap(marker)), { x: markerPlaced.pos[0], y: markerPlaced.pos[1], z: markerPlaced.pos[2] || 0 });
assert.equal(lua(`return Find_Hint("${marker.type.name}","spacecinematiccenter").Get_Hint()`), markerPlaced.hint);
const standaloneMarker = new TacticalMarker(markerPlaced, () => players[2]);
assert.equal(
  scripts.wrap(standaloneMarker).Get_Hint(),
  markerPlaced.hint,
  'A lightweight marker retains its hint even without a map index'
);
const dynamic = makeSquad(team, { x: 1, y: 2, z: 3 });
world.dynamicHints = [{ hint: 'Cinematic_Transport_Hint', object: dynamic }];
assert.equal(lua(`return Find_Hint("${team.name}","cinematic_transport_hint")`).__entity, dynamic);
assert.equal(
  lua(`return Find_Hint("${team.name}","cinematic_transport_hint").Get_Hint()`),
  'Cinematic_Transport_Hint',
  'Dynamic transport hints preserve authored spelling'
);
world.w = { dynamicHints: world.dynamicHints };
delete world.dynamicHints;
assert.equal(
  lua(`return Find_Hint("${team.name}","cinematic_transport_hint").Get_Hint()`),
  'Cinematic_Transport_Hint',
  'LandView forwards the underlying world dynamic hint queue'
);
delete world.w;
assert(players[2].id >= 0);
assert.equal(lua('return Find_Player("Neutral").Is_Neutral()'), true);
assert.equal(lua('return Find_Player("Empire").Is_Neutral()'), false);
assert.equal(lua('return Find_Player("Empire").Is_Enemy(Find_Player("Neutral"))'), false);
assert.equal(lua('return Find_Player("Neutral").Is_Enemy(Find_Player("Empire"))'), false);
assert.equal(lua('return Find_Player("Empire").Is_Enemy(Find_Player("Rebel"))'), true);
world.players = [players[0], players[2], players[1]];
assert.equal(
  lua('return Find_Player("Empire").Get_Enemy()').__player,
  players[1],
  'Get_Enemy skips a preceding positive-ID Neutral player'
);
world.players = players;
const all = lua('return Find_All_Objects_With_Hint("FIELDGUARD")');
assert(Array.isArray(all) && all.length > 1);
assert(all.every(o => o.__entity && !o.__pos));
assert.equal(lua('return Find_All_Objects_With_Hint()'), undefined);
assert.equal(lua('return Find_All_Objects_With_Hint("fieldguard","extra")'), undefined);
const old = squad.members;
squad.members = [];
assert.equal(
  lua(`return Find_Hint("${team.name}","hidetroopers1")`),
  undefined,
  'Despawned teams disappear even though their authored map hint remains'
);
assert.deepEqual(lua('return Find_All_Objects_With_Hint("hidetroopers1")'), [], 'The untyped lookup also omits dead objects');
squad.members = old;
marker.dead = true;
assert.equal(lua(`return Find_Hint("${marker.type.name}","spacecinematiccenter")`), undefined, 'Dead markers disappear from lookup');
marker.dead = false;

const fades = [],
  movieCalls = [];
scripts.vm.global('Fade_Screen_In', seconds => fades.push(seconds));
scripts.vm.global('Play_Bink_Movie', name => {
  movieCalls.push(name);
  return { __wrap: true, Is_Finished: () => false };
});
const instance = scripts.addStoryScript('Story_Empire_ActI_M02_LAND', null);
await scripts.warm();
assert.equal(instance.state, 'run', JSON.stringify([...scripts.errors]));
const begun = scripts.vm.call(instance.env, 'State_Empire_M02_Begin', scripts.vm.read(instance.env, 'OnEnter'));
assert(begun.ok, begun.error);
assert(instance.threads.length > 0, 'Original opening must not stop at its typed team hint');
scripts.service(instance);
assert.equal(scripts.errors.size, 0, JSON.stringify([...scripts.errors]));
assert.deepEqual(fades, [1], 'Original intro thread reaches its authored one-second fade in');
assert.deepEqual(movieCalls, ['Star_Wars_Intro'], 'The original thread waits on the first movie after fading in');
assert.equal(game.environmentFogEnabled, false, 'Original opening disables environmental fog before displaying its stars');
assert.equal(game.setup.fog, true, 'Original Enable_Fog does not change the saved fog-of-war setting');
const escapeEvents = [],
  transports = [],
  controls = [],
  suspensions = [],
  fadeOuts = [];
scripts.vm.global('Story_Event', name => escapeEvents.push(name));
scripts.vm.global('Fade_Screen_Out', seconds => fadeOuts.push(seconds));
scripts.vm.global('Lock_Controls', n => controls.push(n));
scripts.vm.global('Suspend_AI', n => suspensions.push(n));
scripts.vm.global('Create_Cinematic_Transport', (...args) => {
  transports.push(args);
  const type = db.type(args[0]),
    at = scripts.at(args[2]);
  assert(type && at);
  return scripts.wrap(makeSquad(type, at, args[1]));
});
world.removeUnit = object => {
  object.members.length = 0;
};
world.recountPop = () => {};
world.reveals = [];
assert(scripts.storyEscape(), 'The production Escape dispatcher finds the original story handler');
assert.equal(scripts.errors.size, 0, JSON.stringify([...scripts.errors]));
assert.equal(scripts.vm.read(instance.env, 'intro_cinematic_skipped'), true);
assert.equal(instance.threads.length, 0, 'Original Thread.Kill removes the movie-waiting intro coroutine');
assert.deepEqual(fadeOuts, [0]);
assert.deepEqual(fades, [1, 1], 'Escape reaches its authored fade back into the mission');
assert.deepEqual(escapeEvents, ['M1_START_HINT', 'M1_START_MISSION']);
assert.deepEqual(controls, [0]);
assert.deepEqual(suspensions, [0]);
assert.equal(game.environmentFogEnabled, true, 'Original Escape handler restores environmental fog');
assert.equal(game.setup.fog, true);
assert.equal(transports.length, 1);
assert.deepEqual(transports[0].slice(0, 2), ['Shuttle_Tyderium_Landing', 0]);
assert.deepEqual(transports[0].slice(3), [180, 1, 1, 20, 1], 'Escape creates the native persisted, fully landed transport');
console.log(
  JSON.stringify({
    overlay: 'base',
    checks:
      'real TED typed team hints, exact effective types, marker/company/dynamic hint roundtrips, positive-ID Neutral Lua diplomacy, missing/dead omission, unmodified Thyferra Lua initial fade/movie wait and Escape cleanup/fade/mission events'
  })
);
