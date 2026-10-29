import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {openGame} from './megfs.mjs';
const archive=openGame(fileURLToPath(new URL('../../Star Wars Empire at War',import.meta.url)));
globalThis.fetch=async input=>{const name=decodeURIComponent(String(input).replace(/^asset\//,'').split('?')[0]),k=archive.resolve(name),bytes=k&&archive.read(k);return new Response(bytes||null,{status:bytes?200:404});};
const {db,loadGameData}=await import('../public/js/gamedata.js');await loadGameData();
const {sandboxPlot,setSandboxObjectives}=await import('../public/js/game/tacticalsandbox.js');
const {ObjectiveList}=await import('../public/js/game/objectives.js');
const names=['Sandbox_Objective_1','Sandbox_Objective_1_Complete','Sandbox_Objective_2','Sandbox_Objective_2_Complete','Sandbox_Objective_3','Sandbox_Objective_3_Complete','Sandbox_Objective_3_Failed','Sandbox_Objective_3_Enable','Sandbox_Objective_4','Sandbox_Objective_4_Complete','Sandbox_Objective_4_Enable'];
const run=(structure,{defend=false,weather={name:'rain',level:1}}={})=>{
  const plot={events:new Map(names.map(n=>[n.toUpperCase(),{name:n,params:['','',''],rewards:['']}]))};
  const host={fired:[],fire(e){this.fired.push(e.name);},objectives:new ObjectiveList()};
  const game={setup:{mode:'land',teamFactions:defend?['Rebel','Empire']:['Empire','Rebel'],campaign:{galaxy:{players:[]}}},human:{factionName:'Empire'},sandboxStructure:structure&&{type:db.type(structure)},
    world:{units:[],squads:[],weather,tables:{weather:new Map([['clear',{objective:''}],['rain',{objective:'TEXT_TACTICAL_WEATHER_OBJECTIVE_RAIN'}]])}}};
  assert.equal(setSandboxObjectives(host,game,plot,db.constants),true);
  return {plot:sandboxPlot(game),ev:n=>plot.events.get(n.toUpperCase()),host};
};
{ const r=run('Secondary_Mining_Facility');
  assert.equal(r.plot,'SANDBOX_LAND_CAPTURE.XML');
  assert.equal(r.ev('Sandbox_Objective_2').rewards[0],'TEXT_TACTICAL_SECONDARY_MINING_CAPTURE');
  assert.deepEqual(r.ev('Sandbox_Objective_2_Complete').params,['Secondary_Mining_Facility','Empire','']);
  assert.equal(r.ev('Sandbox_Objective_2_Complete').rewards[0],'TEXT_TACTICAL_SECONDARY_MINING_CAPTURE');
  assert.deepEqual(r.host.objectives.items.map(o=>[o.id,o.flag]),[['TEXT_TACTICAL_WEATHER_OBJECTIVE_RAIN',true]]); }
{ const r=run('Secondary_Prison_E',{weather:{name:'rain',level:0.4}});
  assert.equal(r.plot,'SANDBOX_LAND_DESTROY.XML');
  assert.equal(r.ev('Sandbox_Objective_2').rewards[0],'TEXT_TACTICAL_SECONDARY_PRISON_DESTROY');
  assert.deepEqual(r.ev('Sandbox_Objective_2_Complete').params,['Secondary_Prison_E','','1']);
  assert.equal(r.host.objectives.items.length,0,'clear weather below 0.5 intensity has no line'); }
{ const r=run(null); assert.equal(r.plot,'SANDBOX_STANDARD.XML'); assert.equal(r.ev('Sandbox_Objective_2').rewards[0],''); }
{ const r=run('Secondary_Mining_Facility',{defend:true}); assert.equal(r.plot,'SANDBOX_STANDARD.XML'); }
{ const plot={events:new Map(names.map(n=>[n.toUpperCase(),{name:n,params:['','',''],rewards:['']}]))},added=[];
  const host={fire(){},objectives:new ObjectiveList(),addEvent(pl,e){added.push(e);pl.events.set(e.name.toUpperCase(),e);}};
  const tat=db.type('Tatooine'),house=db.type('Ewok_Spawn_House');
  const game={me:0,setup:{mode:'land',teamFactions:['Empire','Rebel'],campaign:{planet:0,galaxy:{planets:[{type:'Tatooine',owner:'Rebel'}],players:[{faction:'Empire',captureRewards:[]}]}}},human:{factionName:'Empire'},
    world:{units:[{structure:true,type:house,side:2}],squads:[],ally:(a,b)=>a===b,weather:null,tables:{weather:new Map()}}};
  setSandboxObjectives(host,game,plot,db.constants);
  const items=host.objectives.items.map(o=>[o.id,o.flag]);
  assert.deepEqual(items[0],['TEXT_TACTICAL_PLANETARY_CREDIT_BONUS',true]);
  assert.ok(host.objectives.items[0].text.includes(String(tat.num('Planet_Capture_Bonus_Reward',0))),'the bonus is in the line');
  assert.deepEqual(items[1],['TEXT_TACTICAL_INDIGENOUS_OBJECTIVE_E_EWOK',false]);
  assert.deepEqual(added.map(e=>[e.name,e.type,e.reward]),[['Ewok_Spawn_House_00','STORY_CHECK_DESTROYED','OBJECTIVE_COMPLETE'],['Ewok_Spawn_House_01','STORY_TRIGGER','CREDITS']]);
  assert.deepEqual(added[0].params,['Empire','DESTROY_ALL_INDIGENOUS_SPAWNERS','Ewok_Spawn_House']);
  game.setup.campaign.galaxy.players[0].captureRewards=['Tatooine'];host.objectives=new ObjectiveList();plot.events.delete('EWOK_SPAWN_HOUSE_00');
  setSandboxObjectives(host,game,plot,db.constants);
  assert.ok(!host.objectives.items.some(o=>o.id==='TEXT_TACTICAL_PLANETARY_CREDIT_BONUS'),'no line once the reward was had'); }
console.log('sandbox objectives ok');
