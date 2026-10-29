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
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy } = await import('../public/js/game/galaxy.js');
const { LuaVM, loadFengari } = await import('../public/js/lua.js');
const { ScriptHost } = await import('../public/js/game/scripts.js');
const { TacticalStoryHost } = await import('../public/js/game/tacticalstory.js');
const { TacticalCampaign } = await import('../public/js/game/tacticalcampaign.js');
const { TacticalVictory } = await import('../public/js/game/tacticalvictory.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const { StoryFlags } = await import('../public/js/game/storyflags.js');
const { destroyPlanetStory } = await import('../public/js/game/planetdestruction.js');
const F = await loadFengari(),
  data = await loadCampaignData(),
  campaign = data.campaigns.get(mod < 0 ? 'SANDBOX_EQUAL_FOOTING_EMPIRE' : 'KNOWNSMALL_ERA_1_EMPIRE');
assert(campaign);
const g = startingGalaxy(data, campaign),
  p = g.planets.find(p => !p.background && p.owner === 'Rebel') || g.planets.find(p => !p.background),
  local = { id: 0, factionName: 'Empire', faction: db.faction('Empire'), human: true },
  enemy = { id: 1, factionName: 'Rebel', faction: db.faction('Rebel') };
local.team = { id: 0, factionName: 'Empire', players: [local] };
enemy.team = { id: 1, factionName: 'Rebel', players: [enemy] };
const order = [],
  game = {
    setup: { campaign: { planet: p.index, galaxy: snapshotGalaxy(g) } },
    world: {
      time: 0,
      players: [local, enemy],
      teams: [local.team, enemy.team],
      units: [],
      tacticalSuperweapons: { disableDepth: 1 },
      selectables: () => [],
      onEvent: () => {}
    },
    human: local,
    map: {},
    audio: {},
    message: () => {}
  };
game.tacticalCampaign = new TacticalCampaign(game, g);
const scripts = Object.assign(Object.create(ScriptHost.prototype), {
  game,
  world: game.world,
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
  types: new WeakMap(),
  current: null,
  plans: { ready: true, update() {} },
  attach() {},
  told: []
});
scripts.vm = new LuaVM(F, { source: n => scripts.source(n) });
scripts.globals();
const event = (name, type, params = [], reward = '', rewards = [], extra = '') =>
  `<Event Name="${name}"><Event_Type>${type}</Event_Type>${params.map((v, i) => (v ? `<Event_Param${i + 1}>${v}</Event_Param${i + 1}>` : '')).join('')}<Reward_Type>${reward}</Reward_Type>${rewards.map((v, i) => `<Reward_Param${i + 1}>${v}</Reward_Param${i + 1}>`).join('')}${extra}</Event>`;
const xml = events => `<Story>${events.join('')}</Story>`,
  put = (name, text) => overlay.set(('DATA/XML/' + name).toUpperCase(), text);
put(
  'CallbackMaster.xml',
  '<Story><Lua_Script>CallbackProbe.lua</Lua_Script><Active_Plot>CallbackProbe.xml</Active_Plot><Active_Plot>NoLua.xml</Active_Plot></Story>'
);
put('NoLua.xml', xml([]));
put(
  'CallbackProbe.xml',
  xml([
    event('Destroyed', 'STORY_PLANET_DESTROYED', [p.name, 'FILTER_ENEMY_ONLY', 'AbsentIncoming', ''], 'SET_FLAG', ['Before', '1']),
    event('Victory', 'STORY_TRIGGER', [], 'VICTORY', ['Empire', '1'], '<Prereq>Destroyed</Prereq>'),
    event('Won', 'STORY_VICTORY', ['Empire'], 'INCREMENT_FLAG', ['Wins', '1']),
    event('OtherWinner', 'STORY_VICTORY', ['Rebel'], 'SET_FLAG', ['WrongWinner', '1']),
    event('ExplicitError', 'STORY_AI_NOTIFICATION', ['', 'ERROR'], 'SET_FLAG', ['AfterError', '1']),
    event('PausedFlag', 'STORY_FLAG', ['PAUSED', '1'], 'SET_FLAG', ['PausedResult', '1'])
  ])
);
scripts.sources.set(
  'CALLBACKPROBE',
  `function Base_Definitions() ServiceRate=0.01 end
function main() while true do coroutine.yield() end end
function Story_Event_Trigger(name)
  Probe(name)
  if name == "Destroyed" then
    local plot=Get_Story_Plot("CallbackProbe.xml")
    local e=plot.Get_Event("Destroyed")
    e.Set_Reward_Parameter(0,"BeforeMutated")
    assert(not FindPlanet("${p.name}").Is_Planet_Destroyed())
  elseif name == "ExplicitError" then error("expected callback error") end
end`
);
scripts.vm.global('Probe', name => {
  order.push(name);
  if (name === 'Destroyed') {
    assert(!p.destroyed);
    assert.equal(host.plots.get('CALLBACKPROBE.XML').events.get('DESTROYED').completed, false);
  }
});
game.setup.campaign.storyPlots = [{ name: 'CallbackMaster.xml', owner: 'Empire' }];
let host = await TacticalStoryHost.create(game, scripts);
host.flags.set('Wins', 0);
assert.equal(host.plots.get('NOLUA.XML').scriptName, '', 'Pending Lua belongs to only the next Active_Plot');
assert.equal(scripts.storyInstances.length, 1);
game.tacticalVictory = new TacticalVictory(result => {
  assert(!p.destroyed);
  assert.equal(game.world.tacticalSuperweapons.disableDepth, 0);
  host.signal('STORY_VICTORY', result.team.factionName);
});
host.flags.set('Paused', 1);
scripts.updateStory(0);
host.update();
assert.equal(host.flags.get('PausedResult'), 1, 'Flags service while mode time is paused');
game.tacticalCampaign.destroy({ player: local });
assert(p.destroyed, 'The production superweapon campaign bridge runs the current XML host before cleanup');
assert.deepEqual(order.slice(-3), ['Destroyed', 'Victory', 'Won']);
assert.equal(host.flags.get('BeforeMutated'), 1);
assert.equal(host.flags.get('Before'), undefined);
assert.equal(host.flags.get('Wins'), 1);
assert.equal(host.flags.get('WrongWinner'), undefined);
assert(
  new StoryFlags(game.tacticalCampaign.result({ entity: new Map() }).galaxy.storyFlags).get('Wins') === 1,
  'Battle results retain tactical XML flags'
);
p.destroyed = false;
assert.equal(game.tacticalVictory.winner.frames, 30);
assert.equal(game.tacticalVictory.winner.suppressNotice, true);
assert.equal(host.plots.get('CALLBACKPROBE.XML').events.get('DESTROYED').disabled, true, 'Prune after every synchronous callback');
host.signal('STORY_AI_NOTIFICATION', 'ERROR');
assert.equal(host.flags.get('AfterError'), 1);
assert.match(scripts.errors.get('CallbackProbe.lua'), /expected callback error/);
const self = host.plots.get('CALLBACKPROBE.XML').events.get('EXPLICITERROR');
self.completed = false;
self.disabled = false;
scripts.vm.global('Probe', name => {
  if (name === 'ExplicitError') self.disabled = true;
});
host.signal('STORY_AI_NOTIFICATION', 'ERROR');
assert(self.completed && self.disabled);
await host.readPlot('CallbackMaster.xml', '', 'Rebel');
assert.equal([...host.plots.values()].filter(p => p.name === 'CallbackProbe.xml').length, 2);
game.setup.campaign.storyPlots = [
  { name: 'CallbackMaster.xml', owner: 'Empire' },
  { name: 'CallbackMaster.xml', owner: 'Rebel' }
];
const owned = await TacticalStoryHost.create(game, scripts),
  ownedPlots = [...owned.plots.values()].filter(p => p.name === 'CallbackProbe.xml');
assert.equal(ownedPlots.length, 2);
assert.notEqual(ownedPlots[0].instance.env, ownedPlots[1].instance.env, 'Every owned subplot has a distinct VM environment');
scripts.storyCallback(ownedPlots[1].instance, 'Destroyed');
assert.equal(ownedPlots[0].events.get('DESTROYED').rewards[0], 'Before');
assert.equal(ownedPlots[1].events.get('DESTROYED').rewards[0], 'BeforeMutated', 'Get_Story_Plot resolves within the callback owner');
scripts.story = host;
game.tacticalStory = host;
const plot = host.plots.get('NOLUA.XML'),
  type = p.type;
const make = (name, params) => ({
  name,
  type: 'STORY_PLANET_DESTROYED',
  params,
  reward: 'SET_FLAG',
  rewards: [name, '1'],
  active: true,
  completed: false,
  disabled: false,
  plot,
  dependents: []
});
const named = make('Named', [p.name, 'FILTER_FRIENDLY_ONLY', 'Absent', type.name]),
  wild = make('Wildcard', ['', '', '', 'Absent']),
  wrong = make('Wrong', ['NotThisPlanet']);
host.eventTypes.set('STORY_PLANET_DESTROYED', [named, wild, wrong]);
p.garrison = [];
p.orbitalStructures = [];
g.fleets = [];
destroyPlanetStory(host, p);
assert.equal(host.flags.get('Named'), undefined);
assert.equal(host.flags.get('Wildcard'), 1);
assert(wild.completed);
assert(named.disabled);
assert(!wrong.completed && !wrong.disabled);
named.disabled = false;
named.params[0] = p.name;
p.orbitalStructures = [{ type }];
destroyPlanetStory(host, p);
assert.equal(host.flags.get('Named'), 1);
const flags = new StoryFlags();
flags.set('Case', 2147483647);
flags.increment('CASE', 1);
assert.equal(flags.get('case'), -2147483648);
assert.equal(flags.increment('Missing', 1), false);
assert.equal(flags.get('Missing'), undefined);
const long = 'X'.repeat(32);
flags.set(long, 7);
assert.equal(flags.get(long), undefined);
assert.equal(flags.get(long.slice(0, 31)), 7);
const flagEvent = (name, mode, names = 'F1') => ({
  name,
  type: 'STORY_FLAG',
  params: [names, '1', mode],
  reward: '',
  rewards: [],
  active: true,
  disabled: false,
  completed: false,
  plot,
  dependents: []
});
const eq = flagEvent('Equality', ''),
  lower = flagEvent('UnknownLower', 'equal_to'),
  neq = flagEvent('NativeNotEqual', 'NOT_EQUAL_TO'),
  multi = flagEvent('Multiple', '', 'F1,F2');
host.flags.set('F1', 1);
host.flags.set('F2', 1);
host.timedEvents = new Set([eq, lower, neq, multi]);
let multiple = 0;
plot.instance = { env: 0 };
const callback = host.invokeStoryCallback;
host.invokeStoryCallback = (inst, name) => {
  if (name === 'Multiple') multiple++;
};
host.pollEvents();
assert(eq.completed);
assert(!lower.completed && !neq.completed);
assert.equal(multiple, 2);
plot.instance = null;
host.invokeStoryCallback = callback;
assert.equal(scripts.values.get('STORY_FLAG_WINS'), undefined);
put('Return.xml', xml([event('ReturnFlag', 'STORY_FLAG', ['Wins', '1', 'GREATER_THAN_EQUAL_TO'], 'SET_FLAG', ['Returned', '1'])]));
const galGame = { galaxy: g, setup: {}, neutralizePopup: { close() {} }, me: g.active },
  gal = new GalacticStoryHost(galGame, F, []);
await gal.readPlot('Return.xml', '', 'Empire');
g.storyFlagSnapshot = () => host.flags.snapshot();
const saved = snapshotGalaxy(g);
saved.storyLua = null;
const restored = startingGalaxy(data, campaign);
applyGalaxy(restored, saved);
const restoreHost = await GalacticStoryHost.create({ ...galGame, galaxy: restored, setup: { restore: saved } });
restoreHost.update(0);
assert.equal(restoreHost.flags.get('Returned'), 1);
assert(restoreHost.suspended);
assert.equal(restoreHost.instances.length, 0);
game.tacticalVictory = new TacticalVictory();
game.world.tacticalSuperweapons.disableDepth = 2;
game.tacticalVictory.request(enemy.team, 11, 210, 2);
host.reward({ reward: 'ENABLE_VICTORY', rewards: ['1'] });
assert(!game.tacticalVictory.winner);
host.reward({ reward: 'ENABLE_VICTORY', rewards: ['1'] });
assert.equal(game.tacticalVictory.winner.team, enemy.team);
game.tacticalVictory = new TacticalVictory();
game.tacticalVictory.request(enemy.team, 11, 210, 1);
game.world.tacticalSuperweapons.disableDepth = 3;
host.reward({ reward: 'VICTORY', rewards: ['Empire'] });
assert.equal(game.tacticalVictory.winner.team, local.team);
assert.equal(game.tacticalVictory.winner.frames, 210);
assert.equal(game.tacticalVictory.pending.length, 1);
const real = new TacticalStoryHost(game, null);
await real.readPlot('Story_Plots_Empire_ActIV_M11_SPACE.xml', '', 'Empire');
const mission = real.plots.get('STORY_EMPIRE_ACTIV_M11_SPACE.XML');
assert(mission?.scriptName);
for (const path of archive.index.keys())
  if (/\\SCRIPTS\\.*\.LUA$/i.test(path)) {
    const parts = path
      .replace(/^.*?\\SCRIPTS\\/i, '')
      .replace(/\.LUA$/i, '')
      .split('\\');
    for (let i = 0; i < parts.length; i++) {
      const n = parts.slice(i).join('/').toUpperCase();
      if (!scripts.index.has(n)) scripts.index.set(n, path);
    }
  }
scripts.errors.clear();
scripts.story = real;
real.scripts = scripts;
mission.instance = scripts.addStoryScript(mission.scriptName, mission);
await scripts.warm();
assert.equal(mission.instance.state, 'run', JSON.stringify([...scripts.errors]));
assert.equal(scripts.vm.read(mission.instance.env, 'Object'), undefined, 'Story scripts have no tactical Object binding');
assert.equal(scripts.errors.size, 0);
const destroyed = mission.events.get('EMPIRE_A04M11_ALDERAAN_DESTROYED_NOTIFICATION');
assert.equal(destroyed.type, 'STORY_PLANET_DESTROYED');
assert.equal(destroyed.params[0], undefined);
assert.equal(destroyed.params[1], 'ALDERAAN', 'Keep the original XML Param2 typo and native wildcard behavior');
real.fire(mission.events.get('EMPIRE_A04M11_BEGIN'), true);
game.tacticalVictory = new TacticalVictory(r => real.signal('STORY_VICTORY', r.team.factionName));
destroyPlanetStory(real, p);
assert.equal(real.flags.get('Empire_A04M11_Win'), 1);
assert.equal(game.tacticalVictory.winner.team, local.team);
scripts.sources.set(
  'PGCALLBACKPROBE',
  `require("PGStoryMode")
function Definitions() StoryModeEvents={First=First,Second=Second} end
function First(message) end
function Second(message) end`
);
const pg = scripts.addStoryScript('PGCallbackProbe', plot);
await scripts.warm();
assert.equal(pg.state, 'run', JSON.stringify([...scripts.errors]));
scripts.storyCallback(pg, 'First');
scripts.storyCallback(pg, 'Second');
assert.equal(scripts.vm.call(pg.env, 'Get_Next_State').value, 'First');
const { LandGame } = await import('../public/js/game/landgame.js');
const documentBefore = globalThis.document;
globalThis.document = {
  createElement: () => ({ remove() {} }),
  body: {
    appendChild() {
      throw Error('Suppressed victory must not show its notice');
    }
  }
};
const land = Object.assign(Object.create(LandGame.prototype), {
  setup: {},
  world: { time: 0 },
  players: [{ human: true, team: 1 }, { team: 0 }],
  teams: [1, 0],
  myTeam: 1,
  me: 0,
  factions: ['Empire', 'Rebel'],
  invasionBook: { pending: 0 },
  audio: {
    play() {
      throw Error('Suppressed victory must not play its notice');
    }
  },
  over: false
});
const landStory = (land.tacticalStory = new TacticalStoryHost(land, null));
put('Land.xml', xml([event('LandWon', 'STORY_VICTORY', ['Empire'], 'SET_FLAG', ['LandWin', '1'])]));
await landStory.readPlot('Land.xml', '', 'Empire');
landStory.disableDepth = 3;
landStory.reward({ reward: 'VICTORY', rewards: ['Empire', '1'] });
assert.equal(landStory.flags.get('LandWin'), 1);
assert.equal(land.invasionVictory.left, 1);
assert.equal(landStory.disableDepth, 0);
landStory.reward({ reward: 'VICTORY', rewards: ['Rebel', '1'] });
assert.equal(land.world.winner, 1, 'Native first-result latch survives reentrant scripted victory');
globalThis.document = documentBefore;
if (mod >= 0) {
  const bridges = new GalacticStoryHost(galGame, F, []);
  await bridges.readPlot('Conquests/Factions/Story_Generic_Empire.xml', '', 'Empire');
  const requests = bridges.startTactical(p, true);
  assert(requests.length);
  const tactical = new TacticalStoryHost(game, null);
  for (const r of requests) await tactical.readPlot(r.name, '', r.owner);
  assert([...tactical.plots.values()].some(p => p.events.size));
  assert(requests.every(r => r.owner === 'Empire'));
}
console.log(
  JSON.stringify({
    overlay: mod < 0 ? 'base' : 'mod',
    checks:
      'real Alderaan destruction-victory-flag chain, owned plot loading, synchronous Lua mutation/error/reentrancy, Enter filters, pruning, paused flags, snapshot return without Lua replay, native victory holds and notices'
  })
);
