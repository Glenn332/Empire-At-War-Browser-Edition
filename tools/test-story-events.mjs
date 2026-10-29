import assert from 'node:assert/strict';
import { GalacticStoryHost } from '../public/js/game/galacticstory.js';

const xml = `<Story_Mode>
  <Event Name="Click"><Event_Type>STORY_CLICK_GUI</Event_Type><Event_Param1>filter</Event_Param1><Perpetual>true</Perpetual></Event>
  <Event Name="Tab"><Event_Type>STORY_TRIGGER</Event_Type><Prereq>Click</Prereq><Perpetual>true</Perpetual><Reward_Type>FORCE_CLICK_GUI</Reward_Type><Reward_Param1>tab</Reward_Param1></Event>
  <Event Name="Chained"><Event_Type>STORY_TRIGGER</Event_Type><Prereq>Tab</Prereq><Perpetual>true</Perpetual><Reward_Type>FORCE_CLICK_GUI</Reward_Type><Reward_Param1>chained</Reward_Param1></Event>
  <Event Name="Later"><Event_Type>STORY_ELAPSED</Event_Type><Event_Param1>2</Event_Param1><Prereq>Click</Prereq><Reward_Type>FORCE_CLICK_GUI</Reward_Type><Reward_Param1>later</Reward_Param1></Event>
  <Event Name="A"><Event_Type>STORY_AI_NOTIFICATION</Event_Type><Event_Param1>A</Event_Param1><Branch>cycle</Branch></Event>
  <Event Name="B"><Event_Type>STORY_AI_NOTIFICATION</Event_Type><Event_Param1>B</Event_Param1><Branch>cycle</Branch></Event>
  <Event Name="C"><Event_Type>STORY_AI_NOTIFICATION</Event_Type><Event_Param1>C</Event_Param1><Branch>cycle</Branch></Event>
  <Event Name="AndOr"><Event_Type>STORY_TRIGGER</Event_Type><Prereq>A, B</Prereq><Prereq>C</Prereq><Branch>cycle</Branch><Reward_Type>FORCE_CLICK_GUI</Reward_Type><Reward_Param1>and-or</Reward_Param1></Event>
  <Event Name="Reset"><Event_Type>STORY_AI_NOTIFICATION</Event_Type><Event_Param1>reset</Event_Param1><Perpetual>true</Perpetual><Reward_Type>RESET_BRANCH</Reward_Type><Reward_Param1>cycle</Reward_Param1></Event>
  <Event Name="Timer"><Event_Type>STORY_ELAPSED</Event_Type><Event_Param1>1</Event_Param1><Perpetual>true</Perpetual><Reward_Type>FORCE_CLICK_GUI</Reward_Type><Reward_Param1>timer</Reward_Param1></Event>
  <Event Name="Cycle1"><Event_Type>STORY_TRIGGER</Event_Type><Prereq>Cycle2</Prereq><Perpetual>true</Perpetual></Event>
  <Event Name="Cycle2"><Event_Type>STORY_TRIGGER</Event_Type><Prereq>Cycle1</Prereq><Perpetual>true</Perpetual></Event>
  <Event Name="Combat"><Event_Type>STORY_WIN_BATTLES</Event_Type><Event_Param1>4</Event_Param1><Event_Param2>SPACE</Event_Param2></Event>
</Story_Mode>`;
globalThis.fetch = async () => new Response(xml);
const clicks = [],
  host = Object.assign(Object.create(GalacticStoryHost.prototype), {
    game: {
      scriptUI: {
        click: (name, forced) => {
          assert.equal(forced, true);
          clicks.push(name);
        }
      }
    },
    plots: new Map(),
    eventTypes: new Map(),
    timedEvents: new Set(),
    instances: [],
    time: 0,
    lastLogicTick: -1,
    reasonCache: new Map(),
    resetDepth: 0,
    errors: new Map()
  });
const plot = await host.readPlot('fixture.xml');
const count = name => clicks.filter(value => value === name).length;
host.clickGUI('filter');
for (let i = 0; i < 30; i++) host.update(1 / 30);
assert.equal(count('tab'), 1, 'Completed prerequisites must not replay a trigger every frame');
assert.equal(count('chained'), 1, 'Trigger propagation reaches chained dependants exactly once');
assert.equal(plot.events.get('CLICK').completed, false, 'Perpetual completion is transient through propagation');
host.clickGUI('filter');
assert.equal(count('tab'), 2, 'A new click must immediately reactivate the trigger');
assert.equal(count('chained'), 2);
for (let i = 0; i < 35; i++) host.update(1 / 30);
assert.equal(count('tab'), 2);
assert.equal(count('later'), 1, 'An activated elapsed event survives the perpetual prerequisite reset');
assert.equal(count('timer'), 2, 'Perpetual elapsed events retain their own interval');

host.signal('STORY_AI_NOTIFICATION', 'A');
host.update(0.1);
assert.equal(count('and-or'), 0, 'All names within a prerequisite group are required');
host.signal('STORY_AI_NOTIFICATION', 'B');
assert.equal(count('and-or'), 1, 'Nonperpetual prerequisite completion remains available');
host.signal('STORY_AI_NOTIFICATION', 'reset');
host.update(0.1);
assert.equal(plot.events.get('A').completed, false);
assert.equal(count('and-or'), 1);
host.signal('STORY_AI_NOTIFICATION', 'C');
assert.equal(count('and-or'), 2, 'Separate prerequisite groups are alternatives after reset');
host.fire(plot.events.get('CYCLE1'), true);
assert.equal(plot.events.get('CYCLE1').completed, false);
assert.equal(plot.events.get('CYCLE2').completed, false, 'In-flight activation blocks recursive cycles');
const other = await host.readPlot('other.xml'),
  otherClick = other.events.get('CLICK');
const disable = values => host.reward({ plot, reward: 'DISABLE_STORY_EVENT', rewards: values });
disable(['Click']);
assert.equal(plot.events.get('CLICK').disabled, false, 'Missing disable flag is a no-op');
disable(['Click', '1']);
host.clickGUI('filter');
assert.equal(count('tab'), 3, 'Local disable preserves the other plot');
assert.equal(plot.events.get('CLICK').disabled, true);
assert.equal(otherClick.disabled, false);
disable(['Click', '1', '1']);
host.clickGUI('filter');
assert.equal(count('tab'), 3, 'Global disable reaches every plot');
disable(['Click', '0', '1']);
assert.equal(count('tab'), 3, 'Enabling does not trigger events');
assert.equal(plot.events.get('CLICK').disabled, false);
assert.equal(otherClick.disabled, false);
host.clickGUI('filter');
assert.equal(count('tab'), 5, 'Enabled events remain available for new clicks');
const branch = values => host.reward({ plot, reward: 'DISABLE_BRANCH', rewards: values });
branch(['cycle']);
assert.equal(plot.events.get('A').disabled, false, 'Missing branch flag is a no-op');
branch(['CYCLE', '1']);
assert.equal(plot.events.get('A').disabled, false, 'Branch names compare case-sensitively');
branch(['cycle', '1']);
assert.equal(plot.events.get('A').disabled, true);
assert.equal(other.events.get('A').disabled, false);
branch(['cycle', '0']);
assert.equal(plot.events.get('A').disabled, false, 'Zero enables the local branch');
assert.equal(count('and-or'), 2, 'Branch enabling does not invoke completed triggers');
const pausedTime = host.time,
  pausedTimers = count('timer');
for (let i = 0; i < 90; i++) host.update(0, false, 1 / 30);
assert.equal(host.time, pausedTime, 'Mode time stays frozen while application service advances');
assert.equal(count('timer'), pausedTimers, 'STORY_ELAPSED timers do not run during a simulation pause');
const combat = plot.events.get('COMBAT');
combat.battleCount = 3;
combat.remainingCounts = [2, 0];
combat.params[0] = '5';
const saved = host.combatSnapshot(),
  copy = Object.assign(Object.create(GalacticStoryHost.prototype), {
    plots: new Map(),
    eventTypes: new Map(),
    timedEvents: new Set(),
    errors: new Map()
  });
await copy.restoreCombatEvents(saved);
const loaded = copy.plots.get('FIXTURE.XML').events.get('COMBAT');
assert.equal(loaded.battleCount, 3);
assert.deepEqual(loaded.remainingCounts, [2, 0]);
assert.equal(loaded.params[0], '5');
loaded.remainingCounts[0] = 9;
loaded.params[0] = '8';
assert.equal(combat.remainingCounts[0], 2);
assert.equal(combat.params[0], '5');
assert.equal(saved[0].events.find(e => e.name === 'Combat').remainingCounts[0], 2, 'Restored counters do not alias saved or live state');
console.log('Native story events passed: perpetual reset, dependencies, branch flags and independent persisted battle counters.');
