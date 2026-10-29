import { simRandom } from './simrandom.js';
import {db} from '../gamedata.js';
import {forceKind} from './galaxy.js';
import {aiProductionBlock,aiTypeBlocked,productionSnapshot,productionContexts,queueAIProduction,productionCost,productionTime,productionContext,strategicProductionKind,populationCap,populationUsed,groundLevel} from './galacticproduction.js';
import {adjustCredits} from './galacticeconomy.js';
import {orderMove,blocks,LOGIC_FPS} from './fleets.js';
import {isRaidForce} from './raid.js';
import {statusOf,reachList} from './airoute.js';
import {canLand,landFriendly,carriedCompany,planetAllowsCompany,applyInvasionResult,invasionForces} from './invasion.js';
import {strategicCategories,strategicPower,factionRelated} from './galacticforces.js';
import {GalacticNetwork} from './galacticnetwork.js';
import {GalacticBudget} from './galacticbudget.js';
import {aidebug as D,who,group,nameOf} from '../aidebug.js';
import {nativeAutoContrast} from './galacticautoresolve.js';
import {installPlanPersistence,savablePlans,savePlans,restorePlans} from './galacticplansave.js';

const KEYS=new Map(),key=x=>{if(typeof x!=='string')return String(x||'').toUpperCase();let k=KEYS.get(x);if(k===undefined){k=x.toUpperCase();if(KEYS.size<50000)KEYS.set(x,k);}return k;},num=(vm,env,name,fallback)=>{const v=vm.read(env,name);return typeof v==='number'?v:fallback;};
const distance=(a,b)=>Math.hypot(...a.pos.map((n,i)=>n-b.pos[i]));
const REACH=['FRIENDLY_ONLY','FRIENDLY_IGNORE_THREAT','ENEMY_DESTINATION','ENEMY_UNDEFENDED','SINGLE_HOP_DISCONNECTED','ANY'];
function forceDefinition(def){
  const force={name:String(def[0]),specs:[],flags:new Set(),minSize:0,minForce:0},excluded=[];
  for(const raw of def.slice(1)){
    const line=String(raw).trim(),total=/^MinimumTotal(Size|Force)\s*=\s*([\d.]+)/i.exec(line);
    if(total){force[/size/i.test(total[1])?'minSize':'minForce']=+total[2];continue;}
    if(line[0]==='-'){const type=db.type(line.slice(1).trim());if(type)excluded.push(type);continue;}
    const percent=/^(.+?)=\s*(\d+)\s*%\s*$/.exec(line),m=percent||/^(.+?)=\s*(\d+)\s*(?:,\s*(\d+))?\s*$/.exec(line);
    if(!m){force.flags.add(key(line));continue;}
    const names=m[1].split('|').map(n=>n.trim()).filter(Boolean),types=names.map(n=>db.type(n)).filter(Boolean);
    force.specs.push({types:types.length?types:null,cats:types.length?null:names.map(key),excluded,min:percent?0:+m[2],max:percent?Infinity:m[3]!==undefined?+m[3]:+m[2],percent:percent?+percent[2]:0});
  }
  return force;
}
function fits(type,spec){return !spec.excluded.includes(type)&&(spec.types?spec.types.includes(type):spec.cats.some(c=>strategicCategories(type).has(c)));}
const lineFits=new WeakMap(),producible=new WeakMap();
function linesOf(def,type){
  let byType=lineFits.get(def);if(!byType){byType=new Map();lineFits.set(def,byType);}
  let out=byType.get(type);if(!out){out=[];let i=0;for(const force of def.forces)for(const spec of force.specs){if(fits(type,spec))out.push(i);i++;}byType.set(type,out);}
  return out;
}
function producibleFor(def,types){
  let byList=producible.get(def);if(!byList){byList=new WeakMap();producible.set(def,byList);}
  let out=byList.get(types);if(!out){out=[];for(const type of types){const idx=linesOf(def,type);if(idx.length)out.push([type,idx]);}byList.set(types,out);}
  return out;
}

export class GalacticPlanning {
  constructor(ai){
    this.ai=ai;this.game=ai.game;this.host=ai.game.story;this.vm=this.host.vm;this.ready=false;this.live=[];this.byGoal=new Map();this.defs=new Map();this.pending=new Map();
    this.reservations=new Map();this.jobs=new Set();this.queueJobs=new WeakMap();this.routeCache=new Map();this.reachSets=new WeakMap();this.poolCache=new Map();this.sequence=0;this.lastDispatch=-Infinity;this.history=[];this.counts={};this.locations=new Map();this.locationTime=-Infinity;this.typesByFaction=new Map();
    this.productionHooks={pay:(q,n)=>this.pay(q,n),complete:(q,u)=>this.complete(q,u),failed:q=>this.failed(q)};this.network=new GalacticNetwork(ai);this.targets=new WeakMap();this.markups=new Map();
    if(this.host?.persist)installPlanPersistence(this);
  }
  unavailable(kind){return name=>/^[A-Z]/.test(name)?()=>{throw new Error('Unported native '+kind+'.'+name);}:undefined;}
  weighted(){
    const types=[],kinds=[],add=(name,weight)=>{const t=name?.__type||db.type(String(name));(t?types:kinds).push([t||key(name),+weight||0]);};
    return {__wrap:true,__name:'WeightedTypeList',__weighted:types,__kinds:kinds,Is_Valid:()=>true,Add_Type:add,Parse:(names,weights)=>{
      if(Array.isArray(names))names.forEach((n,i)=>add(n,Array.isArray(weights)?weights[i]:weights));
      else{const parts=String(names||'').split(',').map(s=>s.trim());if(Array.isArray(weights))parts.forEach((n,i)=>add(n,weights[i]));else for(let i=0;i+1<parts.length;i+=2)add(parts[i],parts[i+1]);}
    },Get_Count:()=>types.length,Get_Weight:name=>types.find(([t])=>t===(name?.__type||db.type(String(name))))?.[1]||0,__missing:this.unavailable('WeightedTypeList')};
  }
  environment(inst,definition=false){
    const vm=this.vm,game=this.game;
    const values={PlanDefinitionLoad:definition,WeightedTypeList:{__wrap:true,Create:()=>this.weighted()},
      EvaluatePerception:(name,owner,target)=>this.ai.evaluate(name,owner?.__faction||inst.ai?.player.faction,target?.__planet||target?.__object?.planet),
      GetCurrentTime:{__wrap:true,__name:'GetCurrentTime',__call:()=>game.galaxy.time,Frame:()=>game.galaxy.time,Galactic_Time:()=>game.galaxy.time},
      Budget:this.budgetWrapper(inst),GiveDesireBonus:(owner,name,target,amount,duration)=>this.ai.giveDesireBonus(owner?.__faction,name,target?.__planet,+amount||0,+duration||0),
      FindTarget:{__wrap:true,__call:(owner,equation,flags,probability,range)=>this.ai.findTarget(owner?.__faction||inst.ai?.player.faction,equation,flags,probability,null,null,range),Reachable_Target:(owner,equation,flags,reach,probability,target,range)=>this.ai.findTarget(owner?.__faction,equation,flags,probability,target?.__planet,reach,range)},
      _FindStageArea:(owner,target,force)=>{const c=this.ai.controllers.get(key(owner?.__faction)),p=target?.__planet;return c&&p?this.host.planet(this.reach(c,p,force?.__force?.inst.gdef?.reach||'FRIENDLY_ONLY')[0]):undefined;},
      WaitForStarbase:target=>this.block({k:'starbase',p:target?.__planet}),
      GetEvent:{__wrap:true,__name:'GetEvent',__call:()=>{const event=inst.events.shift();inst.params=event?.params;if(event?.release)(inst.consumedEvents||=[]).push(event.fn);return event?.fn;},Params:()=>inst.params,Reset:()=>{for(const e of inst.events)if(e.release)this.vm.free(e.fn);inst.events.length=0;}},
      Find_Path:(owner,from,to)=>this.network.path(owner?.__faction,from?.__planet,to?.__planet).map(p=>this.host.planet(p)),
      Apply_Markup:(owner,targets,value,old)=>this.markup(inst,owner?.__faction,targets,+value||0,old),
      Purge_Goals:player=>{const c=this.ai.controllers.get(key(player?.__faction));if(!c)return;for(const other of [...this.live])if(other!==inst&&other.ai===c&&other.state!=='over'&&other.removable!==false)this.stop(other,true);},
    };
    return this.host.environment(inst,values);
  }
  withInstance(inst,callback){const previous=this.host.current;this.host.current=inst;try{return callback();}finally{this.host.current=previous;}}
  snapshot(){
    let live=savablePlans(this),plans=null;
    const rowAt=new Map();
    for(const inst of live){const id=key(inst.ai.player.faction);rowAt.set(inst,live.filter(i=>rowAt.has(i)&&key(i.ai.player.faction)===id).length);}
    if(live.length){try{plans=savePlans(this,live,i=>rowAt.get(i));}catch(error){console.warn('The computer-player plans could not be saved: '+error.message);this.saveError=error.message;live=[];}}
    if(!plans)plans=savePlans(this,[],()=>-1);
    const out={v:2,factions:{},plans},controllers=new Map([...this.ai.controllers.values(),...[...this.jobs].map(j=>j.inst.ai)].map(c=>[c.player.faction,c]));for(const controller of controllers.values()){
      const id=key(controller.player.faction),mine=live.filter(i=>key(i.ai.player.faction)===id);
      const jobs=[...this.jobs].filter(j=>key(j.inst.ai.player.faction)===id&&j.queue&&!j.complete&&!live.includes(j.inst)),rows=[...new Set(jobs.filter(j=>!j.orphan).map(j=>j.inst.budget))];
      const saved=[...mine.map(i=>i.budget),...rows.map(row=>({...row,requested:0,allocated:jobs.filter(j=>j.inst.budget===row&&!j.orphan).reduce((n,j)=>n+Math.max(0,j.queue.cost-(j.queue.paid||0)),0)}))];
      out.factions[controller.player.faction]={exact:!rows.length,budget:controller.budget.snapshot(saved),jobs:jobs.map(job=>{const q=job.queue,p=this.game.galaxy.planets[q.planet],kind=strategicProductionKind(q.type),at=rows.indexOf(job.inst.budget);return {planet:q.planet,kind,index:p.production[kind].indexOf(q),row:at<0?-1:at+mine.length,orphan:job.orphan};})};
    }return out;
  }
  restore(saved){
    if(!saved)return;
    const factions=saved.v===2?saved.factions:saved,rowsBy=new Map(),controllerOf=new Map(),serviced=new Set();
    for(const [owner,data] of Object.entries(factions)){
      const player=this.game.galaxy.players.find(p=>key(p.faction)===key(owner));if(!player)continue;
      const controller=this.ai.controllers.get(key(owner))||{player,budget:new GalacticBudget()};this.ai.budgets.set(key(owner),controller.budget);const rows=controller.budget.restore(data.budget),instances=new Map();
      rowsBy.set(key(owner),rows);controllerOf.set(key(owner),controller);if(!data.exact)serviced.add(controller);
      for(const entry of data.jobs){const q=this.game.galaxy.planets[entry.planet]?.production[entry.kind]?.[entry.index];if(!q||!q.ai||q.owner!==controller.player.faction)continue;const row=rows[entry.row];if(!entry.orphan&&!row)continue;
        let inst=instances.get(entry.row);if(!inst){inst={ai:controller,budget:row,state:'restored',env:null,restored:true};instances.set(entry.row,inst);}const job={inst,force:null,type:q.type,entry:{production:true},stage:null,record:null,queue:q,complete:false,failed:false,orphan:entry.orphan};this.jobs.add(job);this.queueJobs.set(q,job);
      }
    }
    if(saved.plans){
      let failed=[];
      try{failed=restorePlans(this,saved.plans,faction=>rowsBy.get(key(faction)));}
      catch(error){this.ai.errors.set('Plan restore',error.message);failed=saved.plans.insts;}
      for(const di of failed){const controller=controllerOf.get(key(di.faction));this.keepFunded(di,rowsBy.get(key(di.faction)),controller);if(controller)serviced.add(controller);}
    }
    for(const controller of serviced)controller.budget.service();
  }
  keepFunded(di,rows,controller){
    const row=rows?.[di.row];if(!row||!controller)return;
    const queues=di.forces.flatMap(f=>f.jobs).map(jd=>({jd,q:jd.q?this.game.galaxy.planets[jd.q.p]?.production[jd.q.kind]?.[jd.q.i]:null})).filter(({jd,q})=>q&&q.ai&&!jd.complete&&q.owner===controller.player.faction);
    if(!queues.length){controller.budget.release(row);return;}
    row.requested=0;row.allocated=queues.reduce((n,{q})=>n+Math.max(0,q.cost-(q.paid||0)),0);
    const inst={ai:controller,budget:row,state:'restored',env:null,restored:true};
    for(const {jd,q} of queues){const job={inst,force:null,type:q.type,entry:{production:true},stage:null,record:null,queue:q,complete:false,failed:false,orphan:jd.orphan};this.jobs.add(job);this.queueJobs.set(q,job);}
  }
  target(p){if(!p)return undefined;let wrapper=this.targets.get(p);if(!wrapper){wrapper={...this.host.planet(p),__name:'AITarget '+p.name,__aitarget:true,Get_Game_Object:()=>this.host.planet(p)};this.targets.set(p,wrapper);}return wrapper;}
  markup(inst,owner,targets,value,old){
    const handle=old?.__markup||{owner,entries:[],value:0,inst};this.clearMarkup(handle);
    handle.value=value;handle.entries=(Array.isArray(targets)?targets:[targets]).map(t=>t?.__planet||t?.__object?.record||t?.__object||t?.__faction).filter(Boolean);
    let map=this.markups.get(owner);if(!map){map=new Map();this.markups.set(owner,map);}for(const target of handle.entries)map.set(target,(map.get(target)||0)+value);
    if(!inst.markups)inst.markups=new Set();inst.markups.add(handle);return this.markupObject(handle);
  }
  markupObject(handle){return handle.object||={__wrap:true,__name:'Markup',__markup:handle,Is_Valid:()=>true};}
  clearMarkup(handle){const map=this.markups.get(handle.owner);for(const target of handle.entries)if(map)map.set(target,(map.get(target)||0)-handle.value);handle.entries=[];}
  async load(){
    this.host.source('PGAICommands');
    while(this.host.pending.size)await Promise.all([...this.host.pending.values()]);
    const defaults=this.instance('PGAICommands');defaults.env=this.environment(defaults,true);
    try{
      const error=this.vm.run(this.host.source('PGAICommands'),'PGAICommands',defaults.env);if(error)throw new Error(error);
      const call=this.vm.call(defaults.env,'Base_Definitions');if(!call.ok)throw new Error(call.error||'Missing Base_Definitions');
      this.autoContrast=await nativeAutoContrast(this.readContrast(defaults.env));
    }finally{this.vm.free(defaults.env);}
    for(const type of db.types.values())if(strategicProductionKind(type)&&(['company','starship','squadron','ground structure','orbital structure','station'].includes(forceKind(type))||type.num('Build_Advances_Tech_Level',0)>0)&&type.num('Build_Cost_Credits',0)>0)for(const faction of type.list('Affiliation')){const id=key(faction);if(!this.typesByFaction.has(id))this.typesByFaction.set(id,[]);this.typesByFaction.get(id).push(type);}
    const paths=[...new Set(this.host.index.values())].filter(path=>/\\SCRIPTS\\AI\\[^\\]+\.LUA$/i.test(path));
    for(const path of paths)this.host.source(path.split('\\').pop().replace(/\.LUA$/i,''));
    for(const [name,path]of this.host.index)if(/\\SCRIPTS\\EVALUATORS\\[^\\]+\.LUA$/i.test(path))this.host.source(name);
    while(this.host.pending.size)await Promise.all([...this.host.pending.values()]);
    for(const path of paths){
      const name=path.split('\\').pop().replace(/\.LUA$/i,''),inst=this.instance(name);inst.env=this.environment(inst,true);
      try{
        this.withInstance(inst,()=>{const error=this.vm.run(this.host.source(name),name,inst.env);if(error)throw new Error(error);const r=this.vm.call(inst.env,'Base_Definitions');if(!r.ok&&!r.missing)throw new Error(r.error);if(r.missing){const d=this.vm.call(inst.env,'Definitions');if(!d.ok&&!d.missing)throw new Error(d.error);}});
        const v=n=>this.vm.read(inst.env,n),forces=v('TaskForce');
        const def={name,path,forces:(Array.isArray(forces)?forces:[]).filter(f=>Array.isArray(f)&&typeof f[0]==='string').map(forceDefinition),freeStore:v('AllowFreeStoreUnits')!==false,engaged:v('AllowEngagedUnits')!==false,
          magic:v('MagicPlan')===true,ignoreTarget:v('IgnoreTarget')===true,min:num(this.vm,inst.env,'MinContrastScale',1),max:num(this.vm,inst.env,'MaxContrastScale',1.2),perFail:num(this.vm,inst.env,'PerFailureContrastAdjust',0.1),
          additional:num(this.vm,inst.env,'AdditionalCost',0),minimum:num(this.vm,inst.env,'MinimumCost',0),required:(v('RequiredCategories')||[]).map(n=>String(n).split('|').map(s=>key(s.trim()))),contrast:new Map()};
        const enemies=v('EnemyContrastTypes')||[],friends=v('FriendlyContrastTypes')||[];
        enemies.forEach((enemy,i)=>{const list=friends[i];if(list)def.contrast.set(key(enemy),{types:new Map(list.__weighted||[]),kinds:new Map(list.__kinds||[])});});
        def.goals=String(v('Category')||'').split('|').map(s=>key(s.trim())).filter(s=>s&&s!=='ALWAYSOFF');this.defs.set(name,def);
        for(const category of def.goals){if(!this.byGoal.has(category))this.byGoal.set(category,[]);this.byGoal.get(category).push(name);}
      }catch(error){this.ai.errors.set('Definition '+name,error.message);}finally{this.vm.free(inst.env);}
    }
    this.ready=true;
  }
  readContrast(env){
    const enemies=this.vm.read(env,'EnemyContrastTypes')||[],friends=this.vm.read(env,'FriendlyContrastTypes')||[],out=new Map();
    enemies.forEach((enemy,i)=>{const list=friends[i];if(list&&!out.has(key(enemy)))out.set(key(enemy),{types:new Map(list.__weighted||[]),kinds:new Map(list.__kinds||[])});});return out;
  }
  instance(name){return {name,key:name,state:'new',env:null,values:new Map(),events:[],threads:[],running:null,exit:false,forces:[],next:0,rate:0.5,threadIds:0,result:null,removable:true,born:this.game.galaxy.time};}
  can(name){return this.ready&&this.byGoal.has(key(name));}
  switches(controller,mind){
    const brain=controller.brain,templates=controller.type.templates.galactic.map(n=>brain.templates.get(key(n))).filter((t,i)=>t&&(i===0||mind.fn(t.trigger||'ONE',null)>0&&!(t.untrigger&&mind.fn(t.untrigger,null)>0))),map=new Map([...this.defs.keys()].map(n=>[n,-1]));
    templates.sort((a,b)=>a.priority-b.priority);const signature=templates.map(t=>t.name).join('|');if(controller.planSwitchSignature===signature)return;controller.planSwitchSignature=signature;
    for(const t of templates)for(const selector of ['cats','goals','names'])for(const on of [false,true]){
      const values=(on?t.on:t.off).plans?.[selector]||[];
      for(const [name]of map){const match=selector==='names'?values.includes(name):this.defs.get(name).goals.some(goal=>values.some(v=>v==='ALL'||(selector==='goals'?goal===v:brain.defs.get(goal)?.category===v)));if(match&&t.priority>=Math.abs(map.get(name)))map.set(name,on?t.priority:-t.priority);}
    }
    controller.planSwitches=map;
  }
  beginSelection(controller){
    for(const inst of this.live)if(inst.ai===controller&&inst.state==='run'){
      inst.selectionRecords=new Set([...this.reservations].filter(([,p])=>p===inst).map(([u])=>u));inst.retained=false;
    }
    for(const [u,p]of this.reservations)if(p.ai===controller)this.reservations.delete(u);
    for(const inst of this.live)if(inst.ai===controller&&inst.state==='run'&&inst.removable===false)this.retain(inst);
  }
  canRetain(inst){return ![...(inst.selectionRecords||[])].some(u=>this.reservations.has(u)&&this.reservations.get(u)!==inst);}
  retain(inst){if(!this.canRetain(inst))return false;for(const u of inst.selectionRecords||[])this.reservations.set(u,inst);inst.retained=true;return true;}
  endSelection(controller){for(const inst of this.live)if(inst.ai===controller&&inst.state==='run'&&!inst.retained){inst.stolen=true;this.stop(inst);}}
  reach(controller,target,mode='ENEMY_DESTINATION'){
    if(!target)return this.game.galaxy.planets.filter(p=>p.owner===controller.player.faction&&!p.restricted&&!p.background);
    const id=[controller.player.faction,target.index,mode].join('|'),now=this.game.galaxy.time,cached=this.routeCache.get(id);if(cached&&now-cached.time<=10)return cached.planets;
    const out=reachList(this.game.galaxy,controller.player.faction,target,statusOf(mode));
    this.pathDestination=target;this.routeCache.set(id,{time:now,planets:out});return out;
  }
  friendly(owner,other){return factionRelated(owner,other,true);}
  blockaded(owner,p){const enemy=other=>factionRelated(owner,other,false);return !!(p.station&&enemy(p.stationOwner||p.owner)||this.game.galaxy.fleets.some(f=>f.planet===p.index&&!f.leg&&f.units.length&&enemy(f.owner)));}
  canEnter(controller,mode,target){return (p,last)=>!p.background&&!p.destroyed&&!p.restricted&&(mode==='ANY'||last&&['ENEMY_DESTINATION','ENEMY_UNDEFENDED','SINGLE_HOP_DISCONNECTED'].includes(mode)||this.friendly(controller.player.faction,p.owner)&&(mode==='FRIENDLY_IGNORE_THREAT'||!this.blockaded(controller.player.faction,p))||mode==='ENEMY_UNDEFENDED'&&!this.blockaded(controller.player.faction,p));}
  refreshLocations(){
    if(this.locationTime===this.game.galaxy.time)return;this.locationTime=this.game.galaxy.time;
    this.locations.clear();const g=this.game.galaxy;
    for(const p of g.planets)for(const record of p.garrison)if(!record.dead)this.locations.set(record,{record,type:record.type,owner:record.owner,planet:p,fleet:null});
    for(const fleet of g.fleets)for(const record of fleet.units)if(!record.dead)this.locations.set(record,{record,type:record.carries||record.type,owner:fleet.owner,planet:g.planets[fleet.planet]||null,fleet});
    this.standing=new Map();for(const p of g.planets)for(const record of [...p.groundStructures,...p.orbitalStructures])if(!record.dead)this.standing.set(record,{record,type:record.type,owner:record.owner||p.owner,planet:p,fleet:null,structure:true});
    this.locationsByOwner=null;
  }
  ownedLocations(owner){
    this.refreshLocations();
    if(!this.locationsByOwner){const by=this.locationsByOwner=new Map();for(const at of this.locations.values()){const k=key(at.owner);let list=by.get(k);if(!list){list=[];by.set(k,list);}list.push(at);}}
    return this.locationsByOwner.get(key(owner))||[];
  }
  pool(controller){
    const now=this.game.galaxy.time,id=key(controller.player.faction);let cache=this.poolCache.get(id);if(cache&&now-cache.time<=1)return cache;
    this.refreshLocations();const g=this.game.galaxy,owner=controller.player.faction;
    const entries=this.ownedLocations(owner).filter(e=>e.planet&&!e.fleet?.leg&&!this.host.object(e.record,e.planet,e.owner).__object.noAI);
    const types=this.typesByFaction.get(key(owner))||[];
    cache={time:now,entries,types,eligibility:new Map(),typeBlocked:new Map(),rows:new Map(),speeds:new Map(),worlds:null,factories:new Map(),contexts:new Map(),contextOf:null,room:populationCap(g,owner)-populationUsed(g,owner),snap:productionSnapshot(g,owner)};this.poolCache.set(id,cache);return cache;
  }
  factoryRow(controller,type,p,cache){
    const g=this.game.galaxy,owner=controller.player.faction,id=type.name+'|'+p.index;let row=cache.rows.get(id);if(row!==undefined)return row;row=null;
    if(!(key(p.owner)!==key(owner)||p.background||p.restricted||p.destroyed)){
      let allowed=cache.eligibility.get(id);if(allowed===undefined){allowed=!aiProductionBlock(g,p.index,owner,type,cache.room,cache.snap);cache.eligibility.set(id,allowed);}
      if(allowed){
        let context=cache.contexts.get(p);if(!context){context=(cache.contextOf||=productionContexts(g,owner))(p);cache.contexts.set(p,context);}
        const kind=strategicProductionKind(type),time=productionTime(g,p,owner,type,context)*(controller.adjustment?.build[kind]??1),cost=productionCost(g,p,owner,type,context),base=productionCost(g,p,owner,type,[]);
        const required=type.num('Required_Ground_Base_Level',0)||type.num('Required_Star_Base_Level',0),capacity=type.num('Required_Ground_Base_Level',0)?groundLevel(p,owner):p.spaceLevel||0;
        let speed=cache.speeds.get(type);if(speed===undefined){const first=db.type(type.list('Company_Units')[0]);speed=(first||type).num('Hyperspace_Speed',0)*db.faction(owner).num('Hyperspace_Speed_Factor',0.07)*LOGIC_FPS;cache.speeds.set(type,speed);}
        row={time,cost,base,kind,speed,penalty:(1+capacity-required)*(base>0&&cost>0?cost/base:1)};
      }
    }
    cache.rows.set(id,row);return row;
  }
  reachSet(controller,target,mode){
    const list=this.reach(controller,target,mode);let set=this.reachSets.get(list);if(!set){set=new Set(list);this.reachSets.set(list,set);}return set;
  }
  factory(controller,type,stage,target,reach,cache,queues=null){
    const g=this.game.galaxy,owner=controller.player.faction,id=type.name+'|'+(stage?.index??-1)+'|'+reach;let choices=cache.factories.get(id);
    if(!choices){
      choices=[];const structure=['ground structure','orbital structure','station'].includes(forceKind(type)),worlds=structure?(target?[target]:[]):(cache.worlds||=g.planets.filter(p=>key(p.owner)===key(owner)&&!p.background&&!p.restricted&&!p.destroyed));
      let typeBlocked=cache.typeBlocked.get(type);if(typeBlocked===undefined){typeBlocked=aiTypeBlocked(g,owner,type,cache.room,cache.snap);cache.typeBlocked.set(type,typeBlocked);}
      if(!typeBlocked){
        const near=stage?this.reachSet(controller,stage,'FRIENDLY_ONLY'):null;
        for(const p of worlds){
          if(stage&&p!==stage&&!near.has(p))continue;
          const row=this.factoryRow(controller,type,p,cache);if(!row)continue;
          const travel=stage&&stage!==p?(row.speed>0?distance(stage,p)/row.speed:Infinity):0;
          choices.push({planet:p,time:row.time,cost:row.cost,base:row.base,kind:row.kind,travel,penalty:row.penalty});
        }
      }
      cache.factories.set(id,choices);
    }
    let best=null,score=Infinity;
    for(const f of choices){const queued=queues?.get(f.planet.index+'|'+f.kind)??f.planet.production[f.kind].reduce((n,q)=>n+q.left,0),value=(queued+f.time+f.travel)*f.penalty;if(value<score){score=value;best=f;}}
    return best;
  }
  solve(controller,name,target,options={}){
    const def=this.defs.get(name),g=this.game.galaxy,goal=controller.brain.defs.get(key(options.goal)),cache=this.pool(controller);
    if(!def||def.magic||(controller.planSwitches?.get(name)??-1)<0)return null;
    const reach=goal?.reach||'ENEMY_DESTINATION',stages=this.reach(controller,target,reach),forceStages=new Map(),previous=[];
    for(const force of def.forces){let stage=target?stages.find(p=>(!force.flags.has('REQUIREUNIQUESTAGE')||!previous.includes(p))&&(!force.flags.has('REQUIREMATCHINGSTAGE')||!previous.length||previous.includes(p))):null;
      if(target&&!stage)return null;forceStages.set(force.name,stage);if(stage)previous.push(stage);}
    const lines=def.forces.flatMap(force=>force.specs.map(spec=>({force,spec,n:0,fit:0,escort:force.flags.has('ESCORTFORCE')}))),candidates=[];
    const existing=def.freeStore?cache.entries.filter(e=>!this.reservations.has(e.record)||options.all):[];
    for(const e of existing){
      if(!def.engaged&&(this.game.battle?.p===e.planet.index||this.game.pendingBattle?.request?.p===e.planet.index))continue;
      const matches=linesOf(def,e.type).map(i=>lines[i]).filter(l=>!forceStages.get(l.force.name)||this.reachSet(controller,forceStages.get(l.force.name),'FRIENDLY_ONLY').has(e.planet));
      if(matches.length)candidates.push({...e,production:false,lines:matches,power:strategicPower(e.type),cats:strategicCategories(e.type)});
    }
    const ownedCost=t=>productionCost(g,g.planets[0],controller.player.faction,t,[]);
    for(const [type,idx] of producibleFor(def,cache.types)){
      const matches=idx.map(i=>lines[i]);
      const factories=new Map();for(const l of matches){const factory=this.factory(controller,type,forceStages.get(l.force.name),target,reach,cache);if(factory)factories.set(l,factory);}
      if(factories.size)candidates.push({type,production:true,lines:[...factories.keys()],factories,power:strategicPower(type),cats:strategicCategories(type)});
    }
    for(const l of lines)l.fit=candidates.filter(c=>!c.production&&c.lines.includes(l)).length;
    const room=l=>l.spec.percent?l.spec.percent>=100||l.n<Math.ceil(l.fit*l.spec.percent/100):l.n<l.spec.max;
    const table=def.ignoreTarget?null:def.contrast,kinds=table?[...table.keys()]:[],fails=options.fails||0,scale=(def.max+fails*def.perFail)*(controller.adjustment?.galacticContrast??1),threshold=1-(def.min+fails*def.perFail)/(def.max+fails*def.perFail);
    const rows=kinds.flatMap(category=>[{category,space:false},{category,space:true}]);
    const threat=(categories,space)=>target?this.ai.forces().total(controller.player.faction,false,space,categories,target):0;
    const mk=()=>{const E=rows.map(r=>threat([r.category],r.space)*scale);return {E,R:E.slice(),total:[threat(null,false),threat(null,true)],left:[threat(null,false),threat(null,true)],domains:new Set()};};
    const main=table?mk():null,escort=table&&lines.some(l=>l.escort)?mk():null;
    const sat=T=>!T||[...T.domains].every(domain=>{let sum=0,left=0;for(let i=0;i<rows.length;i++)if(+rows[i].space===domain){sum+=T.E[i];left+=Math.max(0,T.R[i]);}return !sum||left/sum<=threshold;});
    const factor=(e,category)=>{const weights=table.get(category);if(weights.types.has(e.type))return weights.types.get(e.type);let n=0,sum=0,one=false;for(const [c,w]of weights.kinds)if(e.cats.has(c)){if(w===1)one=true;else{sum+=w;n++;}}return n?sum/n:one?1:0;};
    const factors=new Map(candidates.map(e=>[e,rows.map(r=>factor(e,r.category))])),distanceOf=new Map();let maximumDistance=0;
    if(table)for(const e of candidates)for(const T of [main,escort])if(T&&e.lines.some(l=>l.escort===(T===escort))){for(let i=0;i<rows.length;i++)if(T.E[i]>0&&factors.get(e)[i]>0)T.domains.add(+rows[i].space);}
    for(const e of candidates)if(!e.production){const stage=target||e.planet,d=distance(e.planet,stage)**2;distanceOf.set(e,d);maximumDistance=Math.max(maximumDistance,d);}
    const picked=[],taken=new Set(),typeCounts=new Map(),sizes=new Map(),powers=new Map(),queues=new Map(),first=new Map(),groups=new Map(def.forces.map(f=>[f.name,[]]));let cost=def.additional,allCost=0,pop=0,horizon=0;
    const short=f=>(sizes.get(f)||0)<f.minSize||(powers.get(f)||0)<f.minForce;
    const pooled=new Map();for(const x of cache.entries)pooled.set(x.type,(pooled.get(x.type)||0)+1);
    const category=goal?.category||'',limit=goal?.timeLimit??-1;
    for(;;){
      const mainShort=lines.some(l=>!l.escort&&!l.spec.percent&&l.n<l.spec.min),mainOK=sat(main),escortOK=sat(escort),random=new Map();let available=[];
      for(const e of candidates){
        if(taken.has(e))continue;const role=!!escort&&mainOK&&!mainShort&&e.lines.some(l=>l.escort&&room(l)),open=e.lines.filter(l=>room(l)&&(!escort||l.escort===role));if(!open.length)continue;
        if(!first.has(e.type))first.set(e.type,Math.floor(simRandom()*8));
        const l=open[first.get(e.type)%open.length],factory=e.production?this.factory(controller,e.type,forceStages.get(l.force.name),target,reach,cache,queues):null,price=e.production?factory.base:0;
        if(e.production){
          if(pop+e.type.num('Population_Value',0)>cache.room||!controller.budget.admits(category,cost+price,factory.time,limit))continue;
          const max=e.type.num('Build_Limit_Current_Per_Player',-1);if(max>=0&&(pooled.get(e.type)||0)+(typeCounts.get(e.type)||0)>=max)continue;
        }
        let score=(l.spec.percent?1:1-l.n/l.spec.max)+2*Math.max(0,e.type.num('Tech_Level',0))/5+(e.production?0.5:2+(maximumDistance>0?1-distanceOf.get(e)/maximumDistance:0));
        let selected=-1,weight=0,T=null;
        if(!table){if(!random.has(e.type))random.set(e.type,simRandom()*e.power/500);score+=random.get(e.type);}
        else{
          T=role?escort:main;const weights=factors.get(e);let best=0;
          for(let i=0;i<rows.length;i++){const R=T.R[i],x=weights[i]*e.power;if(!(R>0&&x>0))continue;const value=weights[i]*(1-(Math.max(R-x,0)/Math.max(R,x))**2);if(value>best){best=value;selected=i;weight=weights[i];}}
          if(best>0)score+=2*best;
          else if(!(T===main?mainOK:escortOK))continue;
          else if(!(T.left.some(v=>v>0)&&weights.some(w=>w>0)||e.lines.some(l=>!l.spec.percent&&l.n<l.spec.min)||short(l.force)||def.required.some(q=>q.some(c=>e.cats.has(c))&&!picked.some(p=>q.some(c=>p.cats.has(c))))))continue;
        }
        available.push({e,l,score,selected,weight,T,factory,price});
      }
      if(!available.length)break;
      if(picked.length){const varied=available.filter(x=>(typeCounts.get(x.e.type)||0)/picked.length<0.5);if(varied.length)available=varied;}
      let best=available[0];for(const c of available)if(c.score>best.score)best=c;
      const {e,l,T,factory,price}=best,entry={...e,factory,force:l.force.name};
      if(!e.production)taken.add(e);else{cost+=price;pop+=e.type.num('Population_Value',0);const kind=strategicProductionKind(e.type),queue=factory.planet.index+'|'+kind,total=(queues.get(queue)??factory.planet.production[kind].reduce((n,q)=>n+q.left,0))+factory.time;queues.set(queue,total);horizon=Math.max(horizon,total);}
      allCost+=ownedCost(e.type);picked.push(entry);groups.get(l.force.name).push(entry);typeCounts.set(e.type,(typeCounts.get(e.type)||0)+1);l.n++;sizes.set(l.force,(sizes.get(l.force)||0)+1);powers.set(l.force,(powers.get(l.force)||0)+e.power);
      if(T){const domain=best.selected>=0?+rows[best.selected].space:+(forceKind(e.type)!=='company');if(best.selected>=0)T.R[best.selected]-=best.weight*e.power;T.left[domain]-=e.power;}
    }
    if(!picked.length&&!def.forces.some(f=>f.flags.has('TASKFORCEREQUIRED'))||lines.some(l=>!l.spec.percent&&l.n<l.spec.min)||def.forces.some(f=>f.specs.length&&short(f))||def.required.some(q=>!picked.some(e=>q.some(c=>e.cats.has(c))))||allCost<def.minimum)return null;
    for(const T of [main,escort])if(T&&picked.length&&(!sat(T)||[...T.domains].some(d=>T.total[d]>0&&T.left[d]/T.total[d]>threshold)))return null;
    if(!controller.budget.admits(category,cost,horizon,limit))return null;
    return {def,goal,groups,stages:forceStages,cost,horizon,limit};
  }
  staffable(controller,goal,target,options={}){
    const id=controller.player.faction+'|'+key(goal)+'|'+(target?.index??'global');let valid=false;
    for(const name of this.byGoal.get(key(goal))||[])if(this.solve(controller,name,target,{...options,goal,all:true})){valid=true;break;}
    if(!valid)this.pending.set(id,{faction:controller.player.faction,goal,target:target?.name||null,blocked:'Native force, staging or category funding constraints'});else this.pending.delete(id);return valid;
  }
  start(controller,goal,target,options={}){
    const names=this.byGoal.get(key(goal))||[];if(!names.length)return null;
    const offset=Math.floor(simRandom()*names.length);let selection=null;
    for(let i=0;i<names.length&&!selection;i++)selection=this.solve(controller,names[(i+offset)%names.length],target,{...options,goal});
    if(!selection)return null;
    for(const entries of selection.groups.values())for(const e of entries)if(!e.production&&this.reservations.has(e.record))return null;
    const budget=controller.budget.reserve(selection.goal.category,selection.cost,selection.horizon,selection.limit);if(!budget)return null;
    const inst=this.instance(selection.def.name);Object.assign(inst,{id:++this.sequence,ai:controller,goal:key(goal),thing:target,def:selection.def,staffed:selection.groups,stages:selection.stages,budget,requiredTime:selection.horizon,gd:options.desire,plan:true,retained:true});
    for(const entries of selection.groups.values())for(const e of entries)if(!e.production)this.reservations.set(e.record,inst);
    this.live.push(inst);
    try{
      inst.env=this.environment(inst);
      this.withInstance(inst,()=>{
        const error=this.vm.run(this.host.source(inst.name),inst.name,inst.env);if(error)throw new Error(error);
        const definitions=this.vm.call(inst.env,'Base_Definitions');if(!definitions.ok&&!definitions.missing)throw new Error(definitions.error);
        if(definitions.missing){const r=this.vm.call(inst.env,'Definitions');if(!r.ok&&!r.missing)throw new Error(r.error);}
      });
      this.vm.set(inst.env,'PlayerObject',this.host.player(controller.player.faction));this.vm.set(inst.env,'Target',this.host.planet(target));this.vm.set(inst.env,'AITarget',this.target(target));this.vm.set(inst.env,'Budget',inst.hostValues.Budget);
      for(const definition of inst.def.forces){
        const entries=inst.staffed.get(definition.name)||[],force={...definition,inst,units:[],entries,jobs:[],stage:inst.stages.get(definition.name),had:false,moved:new Set(),produced:false,lastOwner:target?.owner};
        const wrapper=this.force(force);force.wrapper=wrapper;inst.forces.push(force);this.vm.set(inst.env,force.name,wrapper);
        if(!entries.length&&force.specs.length&&!force.flags.has('TASKFORCEREQUIRED'))continue;
        const thread=this.vm.thread(inst.env,force.name+'_Thread');if(thread){Object.assign(thread,{id:++inst.threadIds,values:new Map(),arg:wrapper});inst.threads.push(thread);}
      }
      inst.state='run';inst.rate=Math.max(1/30,num(this.vm,inst.env,'ServiceRate',0.5));
      this.history.push({time:this.game.galaxy.time,faction:controller.player.faction,goal:inst.goal,target:target?.name||null,script:inst.name,status:'started'});this.trimHistory();this.tally('plans');
      if(D.on)this.dbg('plan',inst,'begun '+inst.name+' on '+(target?.name||'global')+' with '+group([...inst.staffed.values()].flat().map(e=>e.record||e)));
      if(!inst.threads.length)inst.exit=true;
      return inst;
    }catch(error){this.ai.errors.set('Plan '+inst.name,error.message);this.stop(inst);return null;}
  }
  tally(kind,n=1){this.counts[kind]=(this.counts[kind]||0)+n;}
  dbg(kind,inst,text){D.log(kind,'G',this.game.galaxy.time,who(inst.ai),(inst.goal?inst.goal+': ':'')+text,'plan');}
  trimHistory(){if(this.history.length>100)this.history.splice(0,this.history.length-100);}
  queueJob(force,entry,stage){
    const inst=force.inst,job={inst,force,type:entry.type,entry,stage,record:entry.record||null,queue:null,complete:false,failed:false,orphan:false,allocated:entry.production?entry.factory.base:0,created:this.game.galaxy.time};
    force.jobs.push(job);this.jobs.add(job);
    if(entry.production)inst.ai.budget.allocate(inst.budget,job.allocated);
    else{if(!force.units.includes(entry.record))force.units.push(entry.record);force.had=true;}
    return job;
  }
  detach(force,stage,records=force.units){
    const g=this.game.galaxy,owner=force.inst.ai.player.faction;this.refreshLocations();
    const groups=new Map();for(const record of records){const at=this.locations.get(record);if(!at?.planet||at.fleet?.leg)continue;if(!groups.has(at.planet))groups.set(at.planet,[]);groups.get(at.planet).push(at);}
    const fleets=[];
    for(const [planet,entries]of groups){
      const units=[];
      for(const e of entries){
        if(e.fleet){e.fleet.units=e.fleet.units.filter(u=>u!==e.record);units.push(e.record);}
        else{const transport=db.type(e.type.list('Company_Transport_Unit')[0]);if(!transport||this.blockaded(owner,planet))continue;planet.garrison=planet.garrison.filter(u=>u!==e.record);e.record.carries=e.type;e.record.type=transport;units.push(e.record);}
      }
      if(!units.length)continue;let fleet=g.fleets.find(f=>f.owner===owner&&f.planet===planet.index&&!f.leg&&f.aiForce===force);
      if(!fleet){fleet={owner,units:[],planet:planet.index,pos:null,path:[],dest:-1,leg:null,aiForce:force};g.fleets.push(fleet);}
      fleet.units.push(...units);fleets.push(fleet);this.game.fleetView?.(fleet)?.catch(error=>this.ai.errors.set('Fleet model',error.message));
      if(stage&&stage!==planet&&orderMove(g,fleet,stage.index,null,0,{status:statusOf('FRIENDLY_ONLY')})){this.tally('moves');if(D.on)this.dbg('move',force.inst,'fleet of '+group(fleet.units)+' from '+planet.name+' to stage at '+stage.name);}
    }
    g.fleets=g.fleets.filter(f=>f.units.length);const time=this.locationTime;this.ai.invalidate();
    for(const fleet of fleets)for(const record of fleet.units)if(!record.dead)this.locations.set(record,{record,type:record.carries||record.type,owner:fleet.owner,planet:g.planets[fleet.planet]||null,fleet});
    this.locationTime=time;this.locationsByOwner=null;return fleets;
  }
  assemble(force,stage){
    if(!force.produced){force.produced=true;for(const entry of force.entries)this.queueJob(force,entry,stage);}
    for(const job of force.jobs)if(!job.entry.production&&!job.complete){
      if(stage){const at=this.locations.get(job.record);if(at?.planet===stage){job.complete=true;continue;}if(at?.planet&&!at.fleet?.leg)this.detach(force,stage,[job.record]);}
      else job.complete=true;
    }
    return this.block({k:'assemble',force});
  }
  where(record){return this.locations.get(record)||this.standing?.get(record);}
  alive(force){this.refreshLocations();force.units=force.units.filter(u=>!u.dead&&(this.locations.has(u)||this.standing.has(u))&&this.reservations.get(u)===force.inst);return force.units;}
  force(force){
    const inst=force.inst,owner=inst.ai.player.faction,planet=()=>{this.refreshLocations();const u=this.alive(force)[0];return (this.locations.get(u)||this.standing.get(u))?.planet||null;};
    const wrapper={__wrap:true,__name:force.name,__force:force,Is_Valid:()=>inst.state!=='over',Get_Force_Count:()=>this.alive(force).length,
      Get_Unit_Table:()=>this.alive(force).map(record=>{const at=this.where(record);return this.host.object(record,at?.planet,owner);}),
      Get_Stage:()=>this.host.planet(force.stage),Get_Position:()=>{const p=planet();return p?this.host.position(...p.pos):undefined;},Get_Planet_Location:()=>this.host.planet(planet()),
      Get_Distance:target=>{const a=planet(),b=target?.__planet||target?.__force?.stage;return a&&b?distance(a,b):1e9;},
      Get_Self_Threat_Sum:()=>this.alive(force).reduce((n,u)=>n+strategicPower(u.carries||u.type),0),Get_Self_Threat_Max:()=>Math.max(0,...this.alive(force).map(u=>strategicPower(u.carries||u.type))),
      Are_All_Units_On_Free_Store:()=>force.entries.every(e=>!e.production||force.jobs.some(j=>j.entry===e&&j.record)),
      Produce_Force:target=>this.assemble(force,target?.__planet||force.stage),Form_Units:()=>{const fleets=this.detach(force,null);return this.block({k:'fleets',fleets});},
      Is_Raid_Capable:()=>{const units=this.alive(force);return units.length>0&&isRaidForce({owner,units});},
      Raid:target=>{if(!target?.__planet||!isRaidForce({owner,units:this.alive(force)}))return undefined;return wrapper.__move(target,true);},
      Move_To:target=>wrapper.__move(target,false),
      __move:(target,raid)=>{
        const to=target?.__planet;if(!to||!this.alive(force).length)return undefined;
        const fleets=this.detach(force,null),mode=inst.gdef?.reach||'ENEMY_DESTINATION';let ordered=false;
        for(const fleet of fleets)if(fleet.planet===to.index)ordered=true;else if(orderMove(this.game.galaxy,fleet,to.index,null,0,{status:statusOf(mode)})){ordered=true;this.tally('moves');if(raid)fleet.raid=to.index;}
        if(!ordered)return undefined;
        for(const u of force.units)force.moved.add(u);
        const hostile=factionRelated(owner,to.owner,false);
        this.history.push({time:this.game.galaxy.time,faction:owner,goal:inst.goal,script:inst.name,target:to.name,status:'move',hostile});this.trimHistory();
        if(D.on)this.dbg(raid||hostile?'attack':'move',inst,(raid?'raid with ':hostile?'attack with ':'')+'fleet of '+group(force.units)+' to '+to.name+(to.owner?' (held by '+to.owner+')':''));
        const ticket=force.conflictCommand={space:true,planets:new Set(),active:true};
        return this.block({k:'move',force,ticket});
      },
      Activate_Ability:filter=>{for(const u of this.alive(force)){const at=this.locations.get(u);if(!at?.fleet||at.fleet.leg||!at.planet)continue;const o=this.host.object(u,at.planet,owner)?.__object;if(o){this.host.activate(o,filter);this.tally('abilities');if(D.on)this.dbg('ability',inst,nameOf(u)+' uses its abilities at '+at.planet.name);}}},
      Land_Units:()=>this.land(force),Launch_Units:()=>{
        if(this.alive(force).some(u=>{const at=this.where(u);return !at.fleet&&this.blockaded(owner,at.planet);}))return undefined;
        const fleets=this.detach(force,null);return this.block({k:'fleets',fleets});
      },Invade:()=>this.invade(force),Force_Test_Space_Conflict:()=>{const p=planet();return p?this.game.battles?.testSpace(p.index,owner):undefined;},
      Release_Forces:()=>{for(const u of force.units)if(this.reservations.get(u)===inst)this.reservations.delete(u);force.units=[];},
      Release_Unit:wrapped=>{const object=wrapped?.__object,record=object?.record||object;if(record&&this.reservations.get(record)===inst)this.reservations.delete(record);force.units=force.units.filter(u=>u!==record);},
      Collect_All_Free_Units:()=>{for(const e of this.pool(inst.ai).entries)if(!this.reservations.has(e.record)){this.reservations.set(e.record,inst);force.units.push(e.record);}},
      Set_Plan_Result:value=>{inst.result=value!==false;},Set_As_Goal_System_Removable:value=>{inst.removable=value!==false;},Test_Target_Contrast:value=>{inst.testContrast=value!==false;},
      Get_Goal_Type_Name:()=>inst.goal,Get_Planet:()=>this.host.planet(planet()),__missing:this.unavailable('GalacticTaskForce')};
    return wrapper;
  }
  land(force){
    const g=this.game.galaxy,owner=force.inst.ai.player.faction;this.alive(force);let changed=false;
    for(const u of force.units){const at=this.locations.get(u),type=carriedCompany(u);if(!at?.fleet||!at.planet||!type||at.planet.owner!==owner||!canLand(g,at.fleet,at.planet.index)||!planetAllowsCompany(at.planet,type)||at.planet.garrison.length>=db.constants.num('Max_Ground_Forces_On_Planet',10))continue;
      at.fleet.units=at.fleet.units.filter(x=>x!==u);u.type=type;u.carries=null;u.owner=owner;at.planet.garrison.push(u);changed=true;this.tally('landings');if(D.on)this.dbg('reinforce',force.inst,'landed '+nameOf(u)+' on '+at.planet.name);
    }
    if(changed){g.fleets=g.fleets.filter(f=>f.units.length);this.ai.invalidate();this.refreshLocations();}
    for(const u of force.units){const at=this.locations.get(u);if(at?.planet&&at.fleet&&at.planet.owner!==owner&&!u.dead){const o=this.host.object(u,at.planet,owner)?.__object;if(o)this.host.activate(o);}}
    return this.block({k:'true'});
  }
  invade(force){
    const inst=force.inst,g=this.game.galaxy,target=inst.thing,owner=inst.ai.player.faction;this.alive(force);
    const fleet=g.fleets.find(f=>f.owner===owner&&f.planet===target?.index&&!f.leg&&f.units.some(u=>force.units.includes(u)&&carriedCompany(u)));
    if(!target||!fleet||!canLand(g,fleet,target.index))return undefined;
    if(target.owner===owner)return this.land(force);
    this.tally('invasions');const former=target.owner;if(D.on)this.dbg('attack',inst,'invades '+target.name+' (held by '+former+') with '+group(force.units));
    if(!target.garrison.length&&!target.groundStructures.length){
      const troops=invasionForces(g,target.index,owner).filter(({gid})=>{const [fi,ui]=gid.split(':').map(Number);return force.units.includes(g.fleets[fi].units[ui]);}),ids=troops.map(u=>u.gid);
      this.host.captureBaseCleanup(target,owner);
      applyInvasionResult(g,{mode:'land',planet:target.index,sides:[owner,former],participants:ids,alive:ids,winner:'attacker'});this.ai.invalidate();this.refreshLocations();
      this.host.planetCaptured(target,former);
      return this.block({k:'captured',p:target,owner});
    }
    if(!this.game.isHuman(owner)&&!this.game.isHuman(former)&&this.game.battles){
      const ticket=force.conflictCommand={space:false,planets:new Set(),active:true};
      const result=this.game.battles.invade(target.index,owner,former,force.units);
      ticket.active=false;this.refreshLocations();return this.block({k:'const',result:result?.winner==='attacker'});
    }
    if((this.game.isHuman(owner)||this.game.isHuman(former))&&!this.game.busy)this.game.battles?.engage(target.index,owner,former,'land',{records:force.units});
    return this.block({k:'engage',force,p:target,former,owner});
  }
  dispatch(){
    const g=this.game.galaxy,now=g.time;if(now-this.lastDispatch<=1)return;this.lastDispatch=now;
    const pending=[...this.jobs].filter(j=>!j.complete&&j.entry.production&&!j.queue);
    for(const p of g.planets)for(const kind of ['space','ground']){
      if(p.production[kind].length)continue;let best=null,slack=Infinity;
      for(const job of pending){
        if(job.complete||job.queue||job.inst.state==='over'||job.inst.ai.player.faction!==p.owner||strategicProductionKind(job.type)!==kind||aiProductionBlock(g,p.index,p.owner,job.type))continue;
        if(job.entry.factory.planet!==p)continue;
        if(job.inst.ai.budget.wait(job.inst.budget,job.allocated)>0)continue;
        const current=job.inst.requiredTime-(now-job.inst.born)-productionTime(g,p,p.owner,job.type);
        if(current<slack){slack=current;best=job;}
      }
      if(!best)continue;
      const q=queueAIProduction(g,p.index,p.owner,best.type,best.inst.ai.adjustment);if(!q)continue;
      best.queue=q;this.queueJobs.set(q,best);this.tally('builds');if(D.on)this.dbg('build',best.inst,'production of '+best.type.name+' at '+p.name);
      this.history.push({time:now,faction:p.owner,goal:best.inst.goal,script:best.inst.name,type:best.type.name,planet:p.name,status:'production'});this.trimHistory();this.ai.invalidate();
    }
  }
  pay(queue,amount){
    const job=this.queueJobs.get(queue);if(!job||job.complete)return false;
    const player=job.inst.ai.player,budget=job.inst.ai.budget;if(player.credits+0.0001<amount)return false;
    if(job.orphan){if(budget.spare+0.0001<amount)return false;budget.spare=Math.max(0,Math.fround(budget.spare-amount));adjustCredits(this.game.galaxy,player.faction,-amount);return true;}
    const paid=budget.pay(job.inst.budget,amount);if(paid===false)return false;adjustCredits(this.game.galaxy,player.faction,-paid);return true;
  }
  complete(queue,record){
    const job=this.queueJobs.get(queue);if(!job)return;job.queue=null;job.record=record;
    if(record&&!job.orphan&&job.inst.state==='run'){
      this.reservations.set(record,job.inst);job.force.units.push(record);job.force.had=true;
      const owner=job.inst.ai.player.faction,p=this.game.galaxy.planets[queue.planet];this.host.object(record,p,owner);
    }
    job.complete=!job.stage||!record;this.ai.invalidate();this.refreshLocations();
    if(record&&job.stage&&!job.complete){const at=this.where(record);if(at?.planet===job.stage||at?.structure)job.complete=true;else this.detach(job.force,job.stage,[record]);}
    if(job.orphan){job.complete=true;this.jobs.delete(job);}
    if(job.inst.restored){this.jobs.delete(job);if(![...this.jobs].some(j=>j.inst===job.inst&&!j.complete))job.inst.ai.budget.release(job.inst.budget);}
    this.history.push({time:this.game.galaxy.time,faction:queue.owner,type:queue.type.name,planet:this.game.galaxy.planets[queue.planet]?.name,status:'built'});this.trimHistory();
  }
  failed(queue){const job=this.queueJobs.get(queue);if(!job)return;job.failed=true;job.complete=true;job.queue=null;if(job.force)this.notify(job.force,'Production_Failed',job.force.wrapper,this.host.type(job.type));if(job.inst.restored){this.jobs.delete(job);if(![...this.jobs].some(j=>j.inst===job.inst&&!j.complete))job.inst.ai.budget.release(job.inst.budget);}this.ai.invalidate();}
  notify(force,event,...args){
    const inst=force.inst;if(inst.env===null)return;let fn=this.vm.ref(inst.env,force.name+'_'+event)||this.vm.ref(inst.env,'Default_'+event);if(fn)inst.events.push({fn,params:args,release:true});
  }
  conflict(planet,owners,space,begin){
    this.refreshLocations();
    for(const inst of this.live)if(inst.state==='run'&&owners.includes(inst.ai.player.faction))for(const force of inst.forces){
      const command=force.conflictCommand;if(!command?.active||command.space!==space)continue;
      if(begin){
        if(!force.units.some(u=>{const at=this.locations.get(u);return !u.dead&&at?.planet===planet&&!at.fleet?.leg;}))continue;
        command.planets.add(planet);
      }else if(!command.planets.delete(planet))continue;
      this.notify(force,(space?'Space':'Ground')+'_Conflict_'+(begin?'Begin':'End'),force.wrapper);
    }
  }
  update(){
    this.refreshLocations();this.dispatch();
    for(const job of this.jobs){if(job.complete)continue;if(job.queue&&!this.game.galaxy.planets[job.queue.planet]?.production[strategicProductionKind(job.type)].includes(job.queue)){this.failed(job.queue);continue;}if(job.record){const at=this.where(job.record);if(!at){job.failed=true;job.complete=true;}else if(at.structure)job.complete=true;else if(!job.stage||at.planet===job.stage&&!at.fleet?.leg)job.complete=true;}}
    for(const inst of this.live.slice()){
      if(inst.state!=='run')continue;
      for(const force of inst.forces){
        const count=force.units.length;this.alive(force);
        if(count&&!force.units.length&&force.had&&!force.emptyNotified){force.emptyNotified=true;this.notify(force,'No_Units_Remaining');}
        if(inst.thing?.owner!==force.lastOwner){this.notify(force,'Original_Target_Owner_Changed',force.wrapper,this.host.player(force.lastOwner),this.host.player(inst.thing?.owner));force.lastOwner=inst.thing?.owner;}
        for(const record of force.moved){const at=this.locations.get(record);if(at?.planet&&!at.fleet?.leg&&!this.game.busy){force.moved.delete(record);this.notify(force,'Unit_Move_Finished',force.wrapper,this.host.object(record,at.planet,at.owner));}}
      }
      if(this.game.galaxy.time<inst.next&&!inst.exit)continue;
      if(this.deadline!==undefined&&performance.now()>this.deadline&&!inst.exit)continue;
      inst.next=this.game.galaxy.time+inst.rate;
      try{
        this.withInstance(inst,()=>{
          for(const thread of inst.threads.slice()){
            if(inst.exit)break;inst.running=thread;const result=this.vm.resume(thread,thread.arg);inst.running=null;
            if(result.error)throw new Error(result.error);
            if(result.done||result.value===false){this.vm.free(thread.ref);inst.threads.splice(inst.threads.indexOf(thread),1);}
          }
        });
        if(inst.exit||!inst.threads.length)this.stop(inst);
      }catch(error){this.ai.errors.set('Plan '+inst.name,error.message);this.stop(inst);}finally{for(const ref of inst.consumedEvents||[])this.vm.free(ref);if(inst.consumedEvents)inst.consumedEvents.length=0;}
    }
    for(const job of this.jobs)if(job.complete&&job.inst.state==='over')this.jobs.delete(job);
    this.live=this.live.filter(inst=>inst.state!=='over');
  }
  stop(inst,kill=false){
    if(inst.state==='over')return;inst.state='over';const budget=inst.ai.budget,row=inst.budget;let backing=row&&!kill?row.saved+row.immediate:0;
    for(const handle of inst.markups||[])this.clearMarkup(handle);
    const released=[...this.jobs].filter(job=>job.inst===inst&&!job.complete).sort((a,b)=>a.created-b.created||strategicPower(b.type)-strategicPower(a.type));
    for(const job of released){
      const q=job.queue,remaining=q?Math.max(0,q.cost-(q.paid||0)):0;
      if(q&&remaining>0&&remaining<=backing){job.orphan=true;job.stage=null;backing-=remaining;row.category.total=Math.fround(row.category.total-remaining);row.category.cash=Math.fround(row.category.cash-remaining);budget.spare=Math.fround(budget.spare+remaining);q.aiOrphan=true;}
      else{
        if(q){const p=this.game.galaxy.planets[q.planet],list=p.production[strategicProductionKind(q.type)],at=list.indexOf(q);if(at>=0)list.splice(at,1);adjustCredits(this.game.galaxy,q.owner,q.paid||0);row.category.total=Math.fround(row.category.total+(q.paid||0));}
        job.complete=true;job.failed=true;
      }
    }
    budget.release(row);
    for(const [record,owner]of this.reservations)if(owner===inst)this.reservations.delete(record);
    for(const fleet of this.game.galaxy.fleets)if(fleet.aiForce?.inst===inst)fleet.aiForce=null;
    for(const thread of inst.threads)this.vm.free(thread.ref);inst.threads.length=0;
    for(const event of inst.events)if(event.release)this.vm.free(event.fn);inst.events.length=0;
    if(inst.env!==null)this.vm.free(inst.env);inst.env=null;
    this.history.push({time:this.game.galaxy.time,faction:inst.ai.player.faction,goal:inst.goal,target:inst.thing?.name||null,script:inst.name,status:inst.result===true?'success':'failed'});this.trimHistory();
    if(D.on)this.dbg('plan',inst,'ended '+inst.name+': '+(inst.stolen?'its units went to a goal wanted more':inst.result===true?'succeeded':'failed'));
    this.poolCache.delete(key(inst.ai.player.faction));this.onEnd?.(inst);
  }
  stopController(controller){for(const inst of this.live)if(inst.ai===controller)this.stop(inst);}
  dispose(){for(const inst of this.live)this.stop(inst);this.live.length=0;this.jobs.clear();this.reservations.clear();this.routeCache.clear();this.poolCache.clear();}
  budgetWrapper(inst){const budget=()=>inst.ai?.budget,row=()=>inst.budget;return {__wrap:true,__name:'Budget',
    Get_Unallocated_Resources:()=>row()?.requested||0,Get_Spendable_Resources:()=>budget()?.spendable(row())||0,
    Allocate_Resources:amount=>budget()?.allocate(row(),+amount||0),Flush_Unallocated:()=>{if(row())row().requested=0;},
    Flush_All:()=>{if(row()){row().requested=0;row().allocated=0;}},Release_Resources:()=>{if(row()){row().requested=0;row().allocated=0;}},
    Flush_Category:name=>{const c=budget()?.category(name);if(c)c.cash=0;},
    Wait_For_Spendable:amount=>this.block({k:'spendable',inst,amount}),Wait_For_Unallocated:amount=>this.block({k:'unallocated',inst,amount}),
    __missing:this.unavailable('Budget')};}
  block(spec){
    spec.born??=this.game.galaxy.time;const [done,result]=this.blockFns(spec);
    return {__wrap:true,__name:'Block',__spec:spec,Is_Valid:()=>true,IsFinished:()=>this.game.galaxy.time>spec.born&&!!done(),Result:result};
  }
  blockFns(s){
    switch(s.k){
      case 'idle':return [()=>!this.game.busy,()=>true];
      case 'starbase':return [()=>!!s.p?.station,()=>true];
      case 'assemble':return [()=>s.force.jobs.every(job=>job.complete),()=>!s.force.jobs.some(job=>job.failed)];
      case 'move':return [()=>{const force=s.force,done=!this.alive(force).length||force.units.every(u=>{const at=this.locations.get(u);return at?.planet&&!at.fleet?.leg&&!this.game.busy;});if(done)s.ticket.active=false;return done;},()=>this.alive(s.force).length>0];
      case 'fleets':return [()=>s.fleets.every(f=>!f.leg),()=>true];
      case 'captured':return [()=>true,()=>s.p.owner===s.owner];
      case 'const':return [()=>true,()=>s.result];
      case 'engage':return [()=>s.p.owner!==s.former||!this.alive(s.force).length,()=>s.p.owner===s.owner];
      case 'spendable':return [()=>s.inst.ai?.budget.spendable(s.inst.budget)-s.amount>=-0.0001,()=>true];
      case 'unallocated':return [()=>s.inst.budget.requested-s.amount>=-0.0001,()=>true];
      case 'bonus':return [()=>{
        if(s.applied)return true;
        const plan=this.live.find(p=>p.state==='run'&&key(p.ai.player.faction)===key(s.owner)&&p.goal===key(s.name)&&p.thing===s.p);
        if(plan){plan.gd=Math.fround((plan.gd||0)+s.amount);s.applied=true;return true;}
        return this.game.galaxy.time>=s.end;
      },()=>true];
      default:return [()=>true,()=>true];
    }
  }
}
