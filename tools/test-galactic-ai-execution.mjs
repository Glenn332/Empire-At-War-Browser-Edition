import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {openGame} from './megfs.mjs';
let seed=0x5a01318;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
const mod=process.argv.indexOf('--mod'),archive=openGame(fileURLToPath(new URL('../../Star Wars Empire at War',import.meta.url)),mod<0?[]:[process.argv[mod+1]]);
globalThis.fetch=async input=>{const path=String(input);if(path.startsWith('api/find?q=')){const re=new RegExp(decodeURIComponent(path.slice(11)),'i');return new Response(JSON.stringify([...archive.index.keys()].filter(n=>re.test(n))));}const key=archive.resolve(decodeURIComponent(path.replace(/^asset\//,'').split('?')[0])),bytes=key&&archive.read(key);return new Response(bytes||null,{status:bytes?200:404});};
const {db,loadGameData}=await import('../public/js/gamedata.js');await loadGameData();
const {loadCampaignData,startingGalaxy,snapshotGalaxy,applyGalaxy}=await import('../public/js/game/galaxy.js'),{GalacticStoryHost}=await import('../public/js/game/galacticstory.js');
const {GalacticAI}=await import('../public/js/game/galacticai.js'),{stepIncome}=await import('../public/js/game/galacticeconomy.js'),{stepProduction,cancelProduction}=await import('../public/js/game/galacticproduction.js'),{stepFleets}=await import('../public/js/game/fleets.js');
const {pauseGalactic}=await import('../public/js/game/galacticpause.js');
const {GalacticBattles}=await import('../public/js/game/galacticbattles.js');
const data=await loadCampaignData(),campaign=data.campaigns.get(mod<0?'SANDBOX_EQUAL_FOOTING_EMPIRE':'KNOWNSMALL_ERA_1_EMPIRE'),galaxy=startingGalaxy(data,campaign);
const { isHumanFaction } = await import('../public/js/game/galaxy.js');
const game={galaxy,me:galaxy.active,setup:{difficulty:'hard'},paused:false,isHuman:f=>isHumanFaction(galaxy,f),userPaused:false,galacticPauseCount:0,neutralizePopup:{close(){},open(){}},scriptUI:{visibility(){},enable(){},text(){},icon(){}}};
game.pauseGalactic=on=>pauseGalactic(game,on);game.scriptUI.click=(name,forced)=>{if(forced&&name.toUpperCase()==='B_PLAY_PAUSE')game.paused=!game.paused;else if(!forced)game.story?.clickGUI(name);};
game.story=await GalacticStoryHost.create(game);
for(let i=0;i<900;i++){if(game.story.pending.size)await Promise.all([...game.story.pending.values()]);game.story.update(1/30);}
assert.deepEqual(game.story.report().errors,{});
const ai=await GalacticAI.create(game),events=[],seen=new WeakSet(),seconds=+(process.argv.find(a=>a.startsWith('--seconds='))?.split('=')[1]||120),dt=1/15,start=performance.now();
game.battles=new GalacticBattles(game);
for(let i=0;i<seconds/dt;i++){
  game.story.update(dt,game.paused);if(game.story.pending.size)await Promise.all([...game.story.pending.values()]);
  ai.income(stepIncome(galaxy,dt));ai.update(dt);stepProduction(galaxy,dt,ai.productionHooks);stepFleets(galaxy,dt*30,(f,p)=>{ai.invalidate();game.battles.arrive(f,p);});game.battles.update();
  for(const e of ai.plans.history)if(!seen.has(e)){seen.add(e);events.push(e);}
  assert(new Set(ai.plans.reservations.keys()).size===ai.plans.reservations.size);
  for(const inst of ai.plans.live)for(const force of inst.forces)for(const u of force.units)assert.equal(ai.plans.reservations.get(u),inst,'Active forces cannot share a reserved unit');
}
const report=ai.report(),builds=events.filter(e=>e.status==='built'),moves=events.filter(e=>e.status==='move'),attacks=moves.filter(e=>e.hostile&&e.goal==='CONQUER_PIRATE');
console.log(JSON.stringify({battles:game.battles.history}));
assert.deepEqual(game.story.report().errors,{},'Ongoing original story scripts must remain compatible with AI execution');
console.log(JSON.stringify({mod:mod>=0,seconds,millisecondsPerUpdate:(performance.now()-start)/(seconds/dt),builds:builds.slice(0,8),moves:moves.slice(0,8),counts:{built:builds.length,moves:moves.length,production:events.filter(e=>e.status==='production').length},errors:report.errors,missing:report.missing,budgets:report.controllers.filter(c=>c.budgets.length).map(c=>({faction:c.faction,budgets:c.budgets})),plans:report.plans}));
if(!process.argv.includes('--inspect')){assert(builds.length,'Original AI plans must complete production');assert(attacks.length,'Original military plans must attack a hostile world');assert.deepEqual(report.errors,{});}
const frozen=JSON.stringify(ai.report());game.paused=true;ai.update(1);assert.equal(JSON.stringify(ai.report()),frozen);game.paused=false;
const snapshot=snapshotGalaxy(galaxy),queueCount=galaxy.planets.reduce((n,p)=>n+Object.values(p.production).flat().filter(q=>q.ai).length,0);assert(queueCount,'Snapshot fixture needs real in-progress AI production');
const probe=startingGalaxy(data,campaign);applyGalaxy(probe,snapshot);const planet=probe.planets.find(p=>Object.values(p.production).flat().some(q=>q.ai)),item=Object.values(planet.production).flat().find(q=>q.ai),left=item.left;
stepProduction(probe,1,{pay:()=>false,failed(){},complete(){}});assert.equal(item.left,left,'Unavailable installments stall real production');const player=probe.players.find(p=>p.faction===item.owner),credits=player.credits;
assert(cancelProduction(probe,planet.index,item.owner,item));assert.equal(player.credits,Math.fround(credits+(item.paid||0)),'AI cancellation refunds paid installments with native float32 credit arithmetic');
ai.dispose();game.story.dispose();
const restored=startingGalaxy(data,campaign);applyGalaxy(restored,snapshot);const next={...game,galaxy:restored,setup:{...game.setup,restore:snapshot},story:null};
next.story=await GalacticStoryHost.create(next);const resumed=await GalacticAI.create(next);
assert.equal([...resumed.plans.jobs].filter(j=>j.queue).length,queueCount,'Every restored AI build retains a budget binding');
for(let i=0;i<900;i++){resumed.income(stepIncome(restored,dt));stepProduction(restored,dt,resumed.productionHooks);}
assert(resumed.plans.history.some(e=>e.status==='built'),'Restored progressive builds must finish without restarting story scripts or losing their funding');
assert.deepEqual(resumed.report().errors,{});resumed.dispose();next.story.dispose();archive.close();
