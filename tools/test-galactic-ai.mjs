import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {openGame} from './megfs.mjs';
const mod=process.argv.indexOf('--mod'),archive=openGame(fileURLToPath(new URL('../../Star Wars Empire at War',import.meta.url)),mod<0?[]:[process.argv[mod+1]]);
globalThis.fetch=async input=>{const path=String(input);if(path.startsWith('api/find?q=')){const re=new RegExp(decodeURIComponent(path.slice(11)),'i');return new Response(JSON.stringify([...archive.index.keys()].filter(n=>re.test(n))));}const key=archive.resolve(decodeURIComponent(path.replace(/^asset\//,'').split('?')[0])),bytes=key&&archive.read(key);return new Response(bytes||null,{status:bytes?200:404});};
const {db,loadGameData}=await import('../public/js/gamedata.js');await loadGameData();
const {loadCampaignData,startingGalaxy,snapshotGalaxy,applyGalaxy}=await import('../public/js/game/galaxy.js');
const {loadBrain,aiPlayerType,difficultyAdjustment,Reason}=await import('../public/js/game/landbrain.js');
const {loadSpaceBrain}=await import('../public/js/game/spacebrain.js');
const {GalacticAI,GalacticMind,galacticNeighbours,galacticTargetMatches,galacticControllerName}=await import('../public/js/game/galacticai.js');
const {GalacticStoryHost}=await import('../public/js/game/galacticstory.js');
const campaignArg=process.argv.indexOf('--campaign'),data=await loadCampaignData(),campaign=data.campaigns.get(campaignArg<0?(mod<0?'SANDBOX_EQUAL_FOOTING_EMPIRE':'KNOWNSMALL_ERA_1_EMPIRE'):process.argv[campaignArg+1].toUpperCase());assert(campaign);const galaxy=startingGalaxy(data,campaign);
const game={galaxy,me:galaxy.active,setup:{difficulty:'hard'},paused:false,neutralizePopup:{close(){}},scriptUI:{visibility(){},enable(){},text(){},icon(){}}};
const {pauseGalactic}=await import('../public/js/game/galacticpause.js');game.galacticPauseCount=0;game.userPaused=false;game.pauseGalactic=on=>pauseGalactic(game,on);
game.scriptUI.click=(name,forced)=>{if(forced&&name.toUpperCase()==='B_PLAY_PAUSE')game.paused=!game.paused;else if(!forced)game.story?.clickGUI(name);};
game.story=await GalacticStoryHost.create(game);
for(let i=0;i<900;i++){if(game.story.pending.size)await Promise.all([...game.story.pending.values()]);game.story.update(1/30);}
assert.deepEqual(game.story.report().errors,{});
const ai=await GalacticAI.create(game),shared=ai.shared;assert.equal(ai,game.ai);assert(ai.plans.byGoal.size>20);assert.deepEqual(Object.fromEntries(ai.errors),{});
for(const p of galaxy.players){const name=galacticControllerName(game,p),c=ai.controllers.get(p.faction.toUpperCase());if(name.toUpperCase()==='HUMAN'){assert(!c);continue;}assert(c,p.faction);assert.equal(c.name,name);const type=await aiPlayerType(name);assert.deepEqual(c.type.templates.galactic,type.templates.galactic);assert.equal(c.type.galactic,type.galactic);assert.equal(c.difficulty,'hard');assert.equal(c.brain.eq,shared.eq,'Equation definitions are shared across faction controllers');}
const rebel=ai.controllers.get('REBEL');assert(rebel);assert(rebel.type.templates.galactic.length);assert(rebel.brain.fnOf.size>20);
const mind=new GalacticMind(ai,rebel),own=galaxy.planets.find(p=>p.owner==='Rebel'),other=galaxy.planets.find(p=>p.owner!== 'Rebel');assert(own&&other);
const radius=db.constants.num('MaximumFleetMovementDistance',100);assert(radius>0);
const points=[0,radius/2,radius*3,radius*5].map((x,index)=>({index,pos:[x,0,0],name:'Probe_'+index,owner:'Rebel'}));
const neighbours=galacticNeighbours({planets:points,routes:[{a:0,b:2}]});
assert.deepEqual(neighbours[0].map(n=>n.planet.index),[1,2],'Radius neighbours plus explicit distant route, excluding self and unlinked distant worlds');
const connected=new GalacticMind(Object.assign(Object.create(ai),{neighbours}),{...rebel});
assert.equal(connected.see('Variable_Target.IsConnectedTo',[['Parameter_Type','Probe_1'],['Parameter_Attenuator','1']],{planet:points[0]}),0.5);
assert.equal(connected.see('Variable_Target.IsConnectedTo',[['Parameter_Type','Probe_2'],['Parameter_Attenuator','1']],{planet:points[0]}),1,'Explicit routes have zero attenuation distance');
assert.equal(connected.see('Variable_Target.IsConnectedTo',[['Parameter_Type','Probe_3']],{planet:points[0]}),0);
assert.equal(await difficultyAdjustment('Empire','hard',{adjust:{}}),null,'An explicit type without a difficulty mapping retains internal defaults');
for(const [mode,brain]of [['land',await loadBrain('Empire')],['space',await loadSpaceBrain('Empire')]]){assert(brain.player[mode].length);assert(brain.fnOf.size>20);assert(brain.defs.size>20);}
assert(galacticTargetMatches(game,rebel.player,own,1));assert(!galacticTargetMatches(game,rebel.player,own,2));own.restricted=true;assert(!galacticTargetMatches(game,rebel.player,own,1));own.restricted=false;
galaxy.autoReveal=false;own.revealed=false;assert(!galacticTargetMatches(game,rebel.player,own,1));own.revealed=true;assert(galacticTargetMatches(game,rebel.player,own,1));galaxy.autoReveal=undefined;
assert.equal(mind.see('Variable_Self.TechLevel',[],null),rebel.player.tech);
for(const [difficulty,value]of [['easy',1],['normal',2],['hard',3]]){const probe=new GalacticMind(ai,{...rebel,difficulty});let display=0;for(const [name,n]of [['Easy',1],['Normal',2],['Hard',3]])display+=n*probe.see('Variable_Self.IsDifficulty',[['Parameter_Difficulty_Level_Type','DifficultyLevelType['+name+']']],null);assert.equal(display,value,'DifficultyLevelType enum parameters must select one native difficulty');if(rebel.brain.eq.has('DISPLAYDIFFICULTY'))assert.equal(probe.fn('DISPLAYDIFFICULTY',null),value);}
assert.equal(mind.see('Variable_Target.IsHumanControlled',[],{planet:other}),+(other.owner===game.me));
const probe=Object.assign(Object.create(rebel.brain),{eq:new Map([['UNSUPPORTED_NEGATION',['-',['num',1],['see','Variable_Unknown',[]]]],['INDIRECT',['-',['num',1],['see','Function_UNSUPPORTED_NEGATION.Evaluate',[]]]],['REALLYBIG',['num',50]]])});
const strict=new GalacticMind(ai,{...rebel,brain:probe});assert.equal(strict.fn('UNSUPPORTED_NEGATION',null),0,'Unknown descriptor must not become (1 - 0) and invent desire');assert.equal(new Reason(probe).fn('REALLYBIG',null),50,'Authored ReallyBig is not overwritten by a browser constant');
assert.equal(strict.fn('INDIRECT',null),0,'An invalid cached subequation must not turn into an ordinary zero');
const {simRandomState,setSimRandomState}=await import('../public/js/game/simrandom.js'),draws=simRandomState();
const interpretedAI=Object.assign(Object.create(ai),{typeValues:new WeakMap()}),fast=new GalacticMind(ai,rebel),reference=new GalacticMind(interpretedAI,rebel);reference.run=Reason.prototype.run;
for(const t of [null,{key:own.index,planet:own,type:own.type},{key:other.index,planet:other,type:other.type}])for(const name of rebel.brain.eq.keys()){
  if(/SCRIPT/i.test(JSON.stringify(rebel.brain.eq.get(name))))continue;
  setSimRandomState(draws);const a=fast.fn(name,t);setSimRandomState(draws);const b=reference.fn(name,t);assert(Math.abs(a-b)<1e-8||Object.is(a,b),name+': '+a+' != '+b);
}
const serviceStart=performance.now();for(let i=0;i<180;i++){galaxy.time+=1/30;ai.update(1/30);}const serviceMillisecondsPerUpdate=(performance.now()-serviceStart)/180;
assert([...ai.goals.sides.values()].some(s=>s.last?.pairs>0),'Real galactic goals are swept: '+JSON.stringify([...ai.goals.sides].map(([id,s])=>({id,last:s.last,on:[...(s.on?.cats||[])],templates:ai.controllers.get(id)?.type.templates.galactic}))));
for(const [id,c]of ai.controllers)if(/^(None|SandboxHuman)$/i.test(c.name))assert.equal(ai.goals.sides.get(id)?.pairs.length,0,c.name+' retains its authored inert template');
const before=JSON.stringify([...ai.goals.sides].map(([id,s])=>[id,s.at,s.owed,s.wake]));game.paused=true;galaxy.time+=10;ai.update(10);assert.equal(JSON.stringify([...ai.goals.sides].map(([id,s])=>[id,s.at,s.owed,s.wake])),before);game.paused=false;
game.suspendAI=true;ai.update(10);assert.equal(JSON.stringify([...ai.goals.sides].map(([id,s])=>[id,s.at,s.owed,s.wake])),before);game.suspendAI=false;
rebel.player.ai='Human';galaxy.time+=1/30;ai.update(1/30);if(ai.syncing)await ai.syncing;assert(!ai.controllers.has('REBEL'),'Live SWITCH_CONTROL removes the controller');assert(!ai.plans.live.some(p=>p.ai===rebel&&p.state==='run'),'Live control changes stop old plans before dropping their controller');
rebel.player.ai='Unknown_Controller';await ai.reconcile();assert(!ai.controllers.has('REBEL'));assert.match(ai.errors.get('REBEL'),/Unrecognized AI player type/);
rebel.player.ai='Human';await ai.reconcile();assert(!ai.errors.has('REBEL'),'Switching an unknown controller to Human clears its obsolete error');
rebel.player.ai=mod<0?'BasicRebel':'NRAI';await ai.reconcile();assert(ai.controllers.has('REBEL'));assert(!ai.errors.has('REBEL'));
own.restricted=true;own.revealed=true;const snapshot=snapshotGalaxy(galaxy),restored=startingGalaxy(data,campaign);applyGalaxy(restored,snapshot);assert.equal(restored.players.find(p=>p.faction==='Rebel').ai,rebel.player.ai);assert.equal(restored.planets[own.index].restricted,true);assert.equal(restored.planets[own.index].revealed,true);assert.deepEqual(snapshotGalaxy(restored),snapshot);
if(process.argv.includes('--details'))console.log(JSON.stringify(ai.report()));
console.log(JSON.stringify({mod:mod>=0,controllers:ai.controllers.size,planGoals:ai.plans.byGoal.size,pending:ai.plans.pending.size,unsupportedDescriptors:ai.missing.size,serviceMillisecondsPerUpdate,result:'Native AI types, templates, proposal scheduling, optimized equation equivalence, pause, control changes, native scalars and snapshot continuity passed'}));
ai.dispose();game.story.dispose();archive.close();
