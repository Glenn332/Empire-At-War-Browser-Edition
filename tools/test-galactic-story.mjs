import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

const modArg = process.argv.indexOf('--mod'),
  originArg = process.argv.indexOf('--origin');
const origin = originArg < 0 ? null : process.argv[originArg + 1];
const networkFetch = globalThis.fetch;
let liveLuaRequests = 0,
  peakLuaRequests = 0;
const archive = openGame(
  fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)),
  modArg < 0 ? [] : [process.argv[modArg + 1]]
);
globalThis.fetch = async input => {
  const path = String(input);
  if (origin) {
    const lua = /^asset\/.*\.lua$/i.test(path);
    if (lua) peakLuaRequests = Math.max(peakLuaRequests, ++liveLuaRequests);
    try {
      return await networkFetch(new URL(path, origin), { cache: 'no-store' });
    } finally {
      if (lua) liveLuaRequests--;
    }
  }
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, ''))),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy } = await import('../public/js/game/galaxy.js');
const { stepVisibility } = await import('../public/js/game/galacticfog.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const { pauseGalactic, userPauseGalactic } = await import('../public/js/game/galacticpause.js');
const data = await loadCampaignData(),
  menu = data.campaigns.get('GCMENU_REBEL');
const campaign = menu || data.campaigns.get('SANDBOX_EQUAL_FOOTING_EMPIRE');
assert(campaign);
const galaxy = startingGalaxy(data, campaign),
  controls = new Map(),
  loads = [],
  forceClicks = [];
stepVisibility(galaxy, galaxy.active);
const scriptUI = {};
for (const method of ['visibility', 'enable', 'text', 'icon'])
  scriptUI[method] = (name, value) => {
    const n = name.toUpperCase(),
      state = controls.get(n) || {};
    state[method] = value;
    controls.set(n, state);
  };
const popup = {
  opened: false,
  rows: [],
  open(rows, choose) {
    this.opened = true;
    this.rows = rows;
    this.choose = choose;
  },
  close() {
    this.opened = false;
  }
};
const game = { galaxy, me: galaxy.active, setup: {}, scriptUI, neutralizePopup: popup, onLoadCampaign: setup => loads.push(setup) };
const storyDialogs = [];
game.showStoryDialog = request => storyDialogs.push(request);
const screenTexts = [],
  movies = [];
const speechCalls = [];
game.audio = { speech: { replace: name => speechCalls.push(name), stopActive: () => speechCalls.push('STOP_ACTIVE') } };
game.showScreenText = request => screenTexts.push(request);
game.movies = { play: (name, loop) => movies.push({ name, loop }), stop: () => movies.push({ stop: true }) };
scriptUI.click = (name, forced) => {
  if (forced) {
    forceClicks.push(name);
    if (name.toUpperCase() === 'B_PLAY_PAUSE') {
      game.paused = !game.paused;
      return;
    }
    if (name.toUpperCase() === 'B_SPACE_TAB') return;
  }
  game.story?.clickGUI(name);
};
let host = await GalacticStoryHost.create(game);
assert(host);
assert.equal(game.story, host);
const restart = async () => {
  host.dispose();
  controls.clear();
  game.galaxy = startingGalaxy(data, campaign);
  stepVisibility(game.galaxy, game.me);
  host = await GalacticStoryHost.create(game);
};
const step = (count = 12) => {
  for (let i = 0; i < count; i++) host.update(0.2);
};
const click = name => {
  host.clickGUI(name);
  step();
};
const clean = () => {
  assert.deepEqual(host.report().errors, {});
  assert.deepEqual(host.report().missing, {});
};
clean();

const hintPlayer = game.galaxy.players.find(p => p.faction === game.galaxy.active),
  oldHints = { ...hintPlayer.advisorHints };
host.vm.global('__hintPlayer', host.player(hintPlayer.faction));
host.vm.exec(
  '__hintPlayer.Enable_Advisor_Hints("Galactic", false); __hintPlayer.Enable_Advisor_Hints("Land", true)',
  'native advisor hint flags'
);
assert.equal(hintPlayer.advisorHints.Galactic, false);
assert.equal(hintPlayer.advisorHints.Land, true);
assert.equal(hintPlayer.advisorHints.Space, oldHints.Space, 'Lua changes only the selected hint modes');
hintPlayer.advisorHints = oldHints;

if (menu) {
  assert.equal(host.values.get('MOD_ID'), 'icw');
  assert.equal(controls.get('S_SHIELD_25').text, 'Known Galaxy Large');
  assert.match(controls.get('S_SHIELD_26').text, /4 ABY.*The New Republic/);
  assert.equal(controls.get('START_GC').enable, true);
  assert(forceClicks.includes('difficulty_select_med') && forceClicks.includes('Prog_Text'));
  click('difficulty_select_hard');
  click('prog_map_01');
  click('Start_GC');
  assert.equal(loads.at(-1).campaign, 'FullLarge_Era_1_REBEL');
  assert.equal(loads.at(-1).difficulty, 'hard');
  clean();

  await restart();
  click('era_02');
  click('faction_02');
  click('Start_GC');
  assert(popup.opened);
  const regime = popup.rows.find(r => r.type.name.toUpperCase() === 'REGIME_CHOICE_CCOGM');
  assert(regime);
  assert.equal(popup.choose(regime), true);
  popup.close();
  step(30);
  assert.equal(loads.at(-1).campaign, 'KnownLarge_Era_2_EMPIRE_CCoGM', JSON.stringify(host.report()));
  assert.equal(loads.at(-1).faction, 'Empire');
  clean();

  await restart();
  click('Inf_Text');
  click('inf_map_03');
  click('era_01');
  click('faction_01');
  click('Start_GC');
  assert(popup.opened);
  const progressive = popup.rows.find(r => r.type.name.toUpperCase() === 'CUSTOM_GC_PROGRESSIVE_ERA');
  assert(progressive);
  assert.equal(popup.choose(progressive), true);
  popup.close();
  step(30);
  assert.equal(loads.at(-1).campaign, 'Custom_Small_Era_1_REBEL');
  assert.equal(loads.at(-1).startingTechLevel, 4);
  clean();

  const weeks = +host.flags.get('WEEKS');
  host.update(40);
  assert.equal(+host.flags.get('WEEKS'), weeks + 1);
  host.update(0.1);
  assert.equal(+host.flags.get('WEEKS'), weeks + 1);
  host.update(39.9);
  assert.equal(+host.flags.get('WEEKS'), weeks + 2);
  host.vm.global('__testPlayer', host.player('Rebel'));
  host.vm.exec('assert(type(Check_Story_Flag(__testPlayer, "SELECT_NON_CAPITAL", nil, true)) == "boolean")', 'native story flag signature');
  clean();

  host.dispose();
  controls.clear();
  game.galaxy = startingGalaxy(data, data.campaigns.get('KNOWNSMALL_ERA_1_EMPIRE'));
  game.me = 'Empire';
  game.setup = { difficulty: 'hard' };
  game.paused = false;
  game.controlsLocked = undefined;
  stepVisibility(game.galaxy, game.me);
  game.galacticPauseCount = 0;
  game.userPaused = false;
  game.pauseGalactic = on => pauseGalactic(game, on);
  game.setUIPause = () => {};
  host = await GalacticStoryHost.create(game);
  for (let i = 0; i < 900 && (game.controlsLocked !== false || host.pending.size); i++) {
    if (host.pending.size) await Promise.all([...host.pending.values()]);
    host.update(1 / 30);
  }
  assert.equal(game.controlsLocked, false, JSON.stringify(host.report()));
  assert.equal(game.paused, false, 'Native forced pause/resume setup must not leave campaign startup paused');
  assert.equal(host.values.get('GALACTIC_DISPLAY_ON'), 1);
  const subtitle = screenTexts.find(r => r.id === 'TEXT_CONQUEST_WARLORDS_GE_INTRO_PESTAGE');
  assert(subtitle);
  assert.equal(subtitle.duration, 15);
  assert.match(subtitle.text, /Sate Pestage/);
  assert(
    movies.some(m => m.name === 'Pestage_Loop' && m.loop === false),
    'Unchanged MULTIMEDIA requests its alpha Bink independently of subtitle duration'
  );
  assert.deepEqual(host.report().errors, {});
  const docCount = storyDialogs.length;
  click('b_doc_filter02');
  assert.equal(storyDialogs.at(-1).name, 'Documentation_TiersAndTraits');
  click('b_doc_filter03');
  assert.equal(storyDialogs.at(-1).name, 'Documentation_StoryOverview');
  assert.equal(storyDialogs.length, docCount + 2);
  const docButtons = {
    b_doc_filter02: 'Documentation_TiersAndTraits',
    b_doc_filter03: 'Documentation_StoryOverview',
    b_doc_filter04: 'Documentation_Influence',
    b_doc_filter05: 'Dialog_Stat_Display',
    b_doc_important01: 'Dialog_Government_Display',
    b_doc_important02: 'Dialog_Abstract_Resource_Display'
  };
  const docs = [];
  for (const [button, expected] of Object.entries(docButtons)) {
    const count = storyDialogs.length;
    click(button);
    for (let i = 0; i < 100 && !storyDialogs.slice(count).some(r => r.name === expected); i++) step(1);
    const request = storyDialogs.slice(count).find(r => r.name === expected);
    assert(request, button + ': ' + JSON.stringify(host.report()));
    assert.equal(request.chapter, 0);
    assert.equal(request.popup, true);
    if (button !== 'b_doc_filter02' && button !== 'b_doc_filter03') assert(request.entries.length > 0);
    docs.push({ button, name: request.name, entries: request.entries.length });
  }
  userPauseGalactic(game, true);
  const frozenTime = host.time,
    frozenGalaxy = game.galaxy.time,
    uiStart = host.serviceTime;
  for (const [button, expected] of Object.entries(docButtons)) {
    const count = storyDialogs.length;
    host.clickGUI(button);
    for (let i = 0; i < 90 && !storyDialogs.slice(count).some(r => r.name === expected); i++) host.update(0, false, 1 / 30);
    assert(
      storyDialogs.slice(count).some(r => r.name === expected),
      button + ' responds while paused'
    );
    assert.equal(host.time, frozenTime);
    assert.equal(game.galaxy.time, frozenGalaxy);
    assert.equal(game.paused, true);
  }
  assert(host.serviceTime > uiStart, 'Application service clock advances independently');
  host.vm.exec(
    'assert(GetCurrentTime() > GetCurrentTime.Frame()); assert(GetCurrentTime.Frame() == GetCurrentTime.Galactic_Time())',
    'Native application and mode clocks'
  );
  userPauseGalactic(game, false);
  assert.equal(game.galacticPauseCount, 0);
  const repeatCount = storyDialogs.length;
  click('b_doc_important01');
  assert(
    storyDialogs.slice(repeatCount).some(r => r.name === 'Dialog_Government_Display'),
    'Government documentation branch must reset for another click'
  );
  assert.deepEqual(host.report().errors, {});
  console.log(JSON.stringify({ docs }));
  const countForces = () =>
    game.galaxy.planets.reduce((n, p) => n + p.garrison.length, 0) + game.galaxy.fleets.reduce((n, f) => n + f.units.length, 0);
  const spaceClicks = () => forceClicks.filter(name => name.toUpperCase() === 'B_SPACE_TAB').length;
  const idleClicks = spaceClicks();
  const forces = countForces(),
    before = performance.now();
  for (let i = 0; i < 100; i++) host.update(0.05);
  const scriptMilliseconds = performance.now() - before;
  assert.equal(spaceClicks(), idleClicks, 'Idle campaign updates must not replay perpetual Force_Space_Tab clicks');
  for (let i = 1; i <= 2; i++) {
    click('b_space_filter01');
    assert.equal(spaceClicks(), idleClicks + i, 'Each new filter click must force the space tab exactly once');
  }
  assert.equal(countForces(), forces, 'Servicing initialized scripts must not repeat starting military spawns');
  assert(
    host.instances.every(i => i.starts === 1),
    JSON.stringify(host.instances.map(i => ({ name: i.name, starts: i.starts, needs: i.needs })))
  );
  console.log(
    JSON.stringify({
      startup: 'KnownSmall_Era_1_Empire',
      unlocked: true,
      scriptMillisecondsPerUpdate: scriptMilliseconds / 100,
      missing: host.report().missing
    })
  );
}
const scriptNames = host.instances.map(i => i.name);
const originalGoals = host.storyGoals.slice(),
  originalDialogCount = storyDialogs.length;
const event = {
  type: 'STORY_TRIGGER',
  name: 'HistoryProbe',
  plot: {},
  disabled: false,
  reward: '',
  rewards: [],
  dialog: 'Dialog_E_Sandbox_Intro',
  chapter: 0,
  tag: 'ExactTag',
  entries: [],
  popup: true
};
host.fire({ ...event }, true);
host.fire({ ...event }, true);
host.fire({ ...event, tag: 'exacttag' }, true);
host.fire({ ...event, tag: '' }, true);
assert.equal(host.storyGoals.length, originalGoals.length + 4);
assert.equal(host.storyGoals[0].removeAfterRead, true);
assert.equal(host.storyGoals[0].tag, 'Dialog_E_Sandbox_Intro_0');
assert.equal(host.storyGoals[1].tag, 'exacttag');
assert.equal(host.storyGoals[2].tag, 'ExactTag');
assert.equal(host.storyGoals[3].tag, 'ExactTag');
host.reward({ reward: 'STORY_GOAL_COMPLETED', rewards: ['ExactTag'] });
assert.equal(host.storyGoals[2].completed, true);
assert.equal(host.storyGoals[3].completed, false);
assert.equal(host.storyGoals[1].completed, false);
host.reward({ reward: 'REMOVE_STORY_GOAL', rewards: ['ExactTag'] });
assert.equal(host.storyGoals[2].completed, false);
host.storyGoals = originalGoals;
storyDialogs.length = originalDialogCount;
host.reward({ reward: 'COMMANDBAR_MOVIE', rewards: ['TestMovie', '1'] });
assert.deepEqual(movies.at(-1), { name: 'TestMovie', loop: true });
host.reward({ reward: 'STOP_COMMANDBAR_MOVIE', rewards: [] });
assert.deepEqual(movies.at(-1), { stop: true });
host.reward({ reward: 'SPEECH', rewards: ['TAR_EVENT_CONQUER_00'] });
assert.equal(speechCalls.at(-1), 'TAR_EVENT_CONQUER_00');
host.reward({
  reward: 'MULTIMEDIA',
  rewards: ['TEXT_SPEECH_TEST', '-1', '', '0', '1', '255 255 255 255', '', 'TAR_EVENT_CONQUER_00', 'Tarkin_Loop', '1']
});
assert.equal(speechCalls.at(-1), 'TAR_EVENT_CONQUER_00');
assert.equal(screenTexts.at(-1).duration, -1);
assert.deepEqual(movies.at(-1), { name: 'Tarkin_Loop', loop: true });
host.vm.exec('Stop_All_Speech()', 'native stream stop');
assert.equal(speechCalls.at(-1), 'STOP_ACTIVE');
const speechDone = {
  ...event,
  name: 'SpeechDoneProbe',
  dialog: '',
  type: 'STORY_SPEECH_DONE',
  params: ['tar_event_conquer_00'],
  prereqs: [],
  completed: false,
  reward: 'SET_FLAG',
  rewards: ['VOICE_DONE', '1']
};
host.eventTypes.set('STORY_SPEECH_DONE', [speechDone]);
host.signal('STORY_SPEECH_DONE', 'OTHER');
assert.equal(speechDone.completed, false);
host.signal('STORY_SPEECH_DONE', 'TAR_EVENT_CONQUER_00');
assert.equal(speechDone.completed, true);
assert.equal(host.flags.get('VOICE_DONE'), 1);
const beforeRestore = JSON.stringify(game.galaxy),
  guiBeforeRestore = JSON.stringify([...controls]);
const restoredGame = { ...game, setup: { restore: {} } },
  restored = await GalacticStoryHost.create(restoredGame);
restored.update(100, true);
assert.equal(restored.instances.length, 0);
assert.equal(restored.suspended, true);
assert.match(restored.report().errors['Tactical return'], /The story scripts were not saved with this game/);
assert.equal(JSON.stringify(game.galaxy), beforeRestore);
assert.equal(JSON.stringify([...controls]), guiBeforeRestore);
restored.dispose();
if (origin) {
  assert(peakLuaRequests <= 8, 'Live Lua source requests must remain bounded');
  console.log(JSON.stringify({ origin, peakLuaRequests }));
}

let mutations = 0;
host.vm.global('__recordReplayProbe', () => mutations++);
host.sources.set('__REPLAY_SAFETY_PROBE', 'function main() __recordReplayProbe(); error("@@need unpredicted/module") end');
const probe = host.addScript('__REPLAY_SAFETY_PROBE');
host.update(0, true);
host.update(1, true);
assert.equal(mutations, 1);
assert.equal(probe.starts, 1);
assert.equal(probe.state, 'over');
assert.match(host.report().errors.__REPLAY_SAFETY_PROBE, /Runtime module was not prefetched: unpredicted\/module/);
{
  const { db } = await import('../public/js/gamedata.js');
  const type = [...db.types.values()].find(t => t.name);
  const plot = [...host.plots.values()][0],
    event = plot && [...plot.events.values()][0];
  if (event) {
    const wrapper = host.eventWrapperOf(plot, event),
      before = event.rewards.slice();
    wrapper.Set_Reward_Parameter(2, host.type(type));
    assert.equal(event.rewards[2], type.name, 'a type wrapper is written as its name');
    event.rewards.length = 0;
    before.forEach((v, i) => {
      if (v !== undefined) event.rewards[i] = v;
    });
  }
}
host.dispose();
console.log(
  JSON.stringify({
    mod: modArg >= 0,
    selector: !!menu,
    scripts: scriptNames,
    loads: loads.map(s => s.campaign),
    passed: menu
      ? 'Unchanged Lua menu, forced clicks, difficulty, campaign popups, elapsed events, flags, all six docs, restore and replay guards'
      : 'Base campaign plot loading, GameScoring bootstrap, restore and replay guards'
  })
);
