import assert from 'node:assert/strict';
import { GalacticStoryHost } from '../public/js/game/galacticstory.js';

const xml = `<Story_Mode>
  <Event Name="Plain"><Event_Type>STORY_AI_NOTIFICATION</Event_Type><Event_Param1>go</Event_Param1><Perpetual>true</Perpetual><Reward_Type>FORCE_CLICK_GUI</Reward_Type><Reward_Param1>plain</Reward_Param1></Event>
  <Event Name="Shared"><Event_Type>STORY_AI_NOTIFICATION</Event_Type><Event_Param1>go</Event_Param1><Multiplayer>True</Multiplayer><Perpetual>true</Perpetual><Reward_Type>FORCE_CLICK_GUI</Reward_Type><Reward_Param1>shared</Reward_Param1></Event>
  <Event Name="Solo"><Event_Type>STORY_AI_NOTIFICATION</Event_Type><Event_Param1>go</Event_Param1><Multiplayer>False</Multiplayer><Perpetual>true</Perpetual><Reward_Type>FORCE_CLICK_GUI</Reward_Type><Reward_Param1>solo</Reward_Param1></Event>
  <Event Name="AfterSolo"><Event_Type>STORY_TRIGGER</Event_Type><Prereq>Solo</Prereq><Reward_Type>FORCE_CLICK_GUI</Reward_Type><Reward_Param1>after</Reward_Param1></Event>
</Story_Mode>`;
globalThis.fetch = async () => new Response(xml);

async function run(net) {
  const clicks = [];
  const host = Object.assign(Object.create(GalacticStoryHost.prototype), {
    game: { setup: net ? { net: true } : {}, scriptUI: { click: name => clicks.push(name) } },
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
  await host.readPlot('fixture.xml');
  host.signal('STORY_AI_NOTIFICATION', 'go');
  host.update(0.1);
  return clicks.sort();
}

assert.deepEqual(await run(false), ['after', 'plain', 'shared', 'solo'], 'Single player ignores the Multiplayer tag');
assert.deepEqual(await run(true), ['plain', 'shared'], 'Multiplayer skips events tagged False and what waits on them');
console.log('story multiplayer tag ok');
