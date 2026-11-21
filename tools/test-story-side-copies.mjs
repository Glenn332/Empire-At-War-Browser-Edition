import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
const LUA_PATH = 'Data\\Scripts\\Story\\SideTest.lua';
const xml = `<Story_Mode>
  <Event Name="Template_Text"><Event_Type>STORY_AI_NOTIFICATION</Event_Type><Event_Param1>SHOW_TEXT</Event_Param1><Perpetual>true</Perpetual><Reward_Type>SCREEN_TEXT</Reward_Type><Reward_Param1></Reward_Param1></Event>
  <Event Name="Flag"><Event_Type>STORY_AI_NOTIFICATION</Event_Type><Event_Param1>EMPIRE_FLAG</Event_Param1></Event>
  <Event Name="Later"><Event_Type>STORY_ELAPSED</Event_Type><Event_Param1>0.2</Event_Param1><Story_Dialog>Dialog_Side</Story_Dialog><Story_Dialog_Popup>False</Story_Dialog_Popup><Prereq>Flag</Prereq></Event>
  <Event Name="Clicked"><Event_Type>STORY_AI_NOTIFICATION</Event_Type><Event_Param1>CLICKED</Event_Param1><Perpetual>true</Perpetual></Event>
</Story_Mode>`;
const lua = `
function Base_Definitions()
  StoryModeEvents = { Clicked = On_Clicked }
end
function Story_Event_Trigger(name)
  if StoryModeEvents[name] then StoryModeEvents[name]() end
end
function Show(text)
  local e = Get_Story_Plot("sidetest.xml").Get_Event("Template_Text")
  e.Set_Reward_Parameter(0, text)
  Story_Event("SHOW_TEXT")
end
function On_Clicked()
  Find_Player("local").Give_Money(7)
  Show("TEXT_CLICK_" .. Find_Player("local").Get_Faction_Name())
end
function main()
  local me = Find_Player("local")
  Find_Player("Underworld").Give_Money(100)
  me.Give_Money(1000)
  GlobalValue.Set("ROLL_" .. me.Get_Faction_Name(), GameRandom(1, 1000000))
  GlobalValue.Set("R_" .. me.Get_Faction_Name(), math.random())
  Show("TEXT_SHARED")
  if me == Find_Player("Rebel") then
    Show("TEXT_FOR_REBEL")
  elseif me == Find_Player("Empire") then
    Show("TEXT_FOR_EMPIRE")
    Story_Event("EMPIRE_FLAG")
  end
  while true do coroutine.yield() end
end
`;
globalThis.fetch = async input => {
  const path = decodeURIComponent(String(input));
  if (/sidetest\.xml$/i.test(path)) return new Response(xml);
  if (/sidetest\.lua$/i.test(path)) return new Response(lua);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(path.slice(11), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n)).concat(LUA_PATH)));
  }
  const at = archive.resolve(path.replace(/^asset\//, '')),
    bytes = at && archive.read(at);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy } = await import('../public/js/game/galaxy.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const { loadFengari } = await import('../public/js/lua.js');
const data = await loadCampaignData();
const fengari = await loadFengari();
const k = x => String(x || '').toUpperCase();

async function play(me, clicker) {
  const galaxy = startingGalaxy(data, data.campaigns.get('SANDBOX_EQUAL_FOOTING_EMPIRE'));
  galaxy.humans = ['REBEL', 'EMPIRE'];
  const texts = [];
  const game = {
    galaxy,
    me,
    setup: { net: {} },
    scriptUI: {},
    neutralizePopup: { open() {}, close() {} },
    isHuman: f => galaxy.humans.includes(k(f)),
    storyLocal: owner => (owner && galaxy.humans.includes(k(owner)) ? owner : 'Rebel'),
    showScreenText: t => texts.push(t.textId)
  };
  game.storyAudience = owner => k(game.storyLocal(owner)) === k(game.me);
  const host = new GalacticStoryHost(game, fengari, [LUA_PATH]);
  const plot = await host.readPlot('sidetest.xml', 'SideTest', 'Underworld');
  const before = Object.fromEntries(galaxy.players.map(p => [k(p.faction), p.credits]));
  host.startPlot(plot);
  await host.warm();
  for (let i = 0; i < 30; i++) host.update(1 / 30);
  const after = Object.fromEntries(galaxy.players.map(p => [k(p.faction), p.credits]));
  if (clicker) host.asSide(clicker, () => host.signal('STORY_AI_NOTIFICATION', 'CLICKED'));
  const clicked = Object.fromEntries(galaxy.players.map(p => [k(p.faction), p.credits]));
  return { host, texts, before, after, clicked, errors: Object.fromEntries(host.errors) };
}

const asEmpire = await play('Empire', 'EMPIRE');
assert.deepEqual(asEmpire.errors, {}, 'the scripts run without errors');
assert.equal(asEmpire.host.storyGoals.find(r => r.name === 'Dialog_Side')?.audience, 'EMPIRE', 'a timed event after a side copy story event keeps that side');
assert.equal(asEmpire.host.instances.filter(i => i.side === 'EMPIRE').length, 1, 'one copy for the second human side');
assert.deepEqual(asEmpire.texts.slice(0, 2), ['TEXT_SHARED', 'TEXT_FOR_EMPIRE'], 'the second side sees the shared text and its own branch');
assert.ok(!asEmpire.texts.includes('TEXT_FOR_REBEL'), 'the second side does not see the host side branch');
const values = asEmpire.host.values;
assert.equal(values.get('ROLL_REBEL'), values.get('ROLL_EMPIRE'), 'GameRandom is shared, not rolled twice');
assert.equal(values.get('R_REBEL'), values.get('R_EMPIRE'), 'math.random replays the main copy draws');
assert.ok(asEmpire.texts.includes('TEXT_CLICK_EMPIRE') && !asEmpire.texts.includes('TEXT_CLICK_REBEL'), 'a click reaches only the side that clicked');
assert.equal(asEmpire.clicked.EMPIRE - asEmpire.after.EMPIRE, 7);
assert.equal(asEmpire.clicked.REBEL, asEmpire.after.REBEL, 'the click does not run in the host side script');

const asRebel = await play('Rebel', null);
assert.deepEqual(asRebel.texts, ['TEXT_SHARED', 'TEXT_FOR_REBEL'], 'the host side sees only its own story');
assert.equal(asRebel.after.EMPIRE, asEmpire.after.EMPIRE, 'both machines agree on the world');
assert.equal(asRebel.after.REBEL, asEmpire.after.REBEL);
assert.equal(asRebel.after.UNDERWORLD, asEmpire.after.UNDERWORLD);
const gain = side => asRebel.after[side] - asRebel.before[side];
console.log('gains', gain('REBEL'), gain('EMPIRE'), gain('UNDERWORLD'));
assert.equal(gain('UNDERWORLD'), 100, 'shared effects happen once');
const { saveStory, restoreStory } = await import('../public/js/game/galacticstorysave.js');
const saved = JSON.parse(JSON.stringify(saveStory(asEmpire.host)));
const again = new GalacticStoryHost(asEmpire.host.game, fengari, [LUA_PATH]);
await restoreStory(again, saved);
await again.fetchSources();
const [mainAgain, copyAgain] = again.instances;
assert.equal(copyAgain.side, 'EMPIRE', 'the copy keeps its side through a save');
assert.equal(copyAgain.main, mainAgain);
assert.deepEqual(mainAgain.copies, [copyAgain]);
assert.equal(mainAgain.plot.instance, mainAgain, 'the plot keeps its main script');
const textsBefore = asEmpire.texts.length;
again.asSide('EMPIRE', () => again.signal('STORY_AI_NOTIFICATION', 'CLICKED'));
assert.equal(asEmpire.texts.at(-1), 'TEXT_CLICK_EMPIRE', 'the restored copy still answers its side');
assert.equal(asEmpire.texts.length, textsBefore + 1);
console.log('story side copies ok');
