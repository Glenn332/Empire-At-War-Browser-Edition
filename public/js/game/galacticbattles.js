import {retreatDestination} from './fleetretreat.js';
import {db} from '../gamedata.js';
import {autoCombatant,resolveAutoBattle,overrunSide,landBomber} from './galacticautoresolve.js';
import {carriedCompany,canLand,invasionForces,applyInvasionResult} from './invasion.js';
import {retreatFleet} from './fleets.js';
import {enemy,hidden,conflictAt} from './galacticrelation.js';
import {groundLevel} from './galacticproduction.js';

const key=x=>String(x||'').toUpperCase();
export const battleHostile=(owner,other)=>enemy(owner,other);
const raiding=f=>f.units.length>0&&f.units.every(u=>u.raiding);
const defenderOf=(g,planet,attacker,skip=()=>false)=>{
  const other=g.fleets.find(b=>b.planet===planet.index&&!b.leg&&b.units.some(u=>!u.dead)&&!hidden(b)&&!skip(b)&&key(b.owner)!==key(attacker));
  if(other)return other.owner;
  const owner=planet.station&&(planet.spaceLevel||0)>0?planet.stationOwner||planet.owner:null;return owner&&key(owner)!==key(attacker)?owner:null;
};
export class GalacticBattles {
  constructor(game){this.game=game;this.dirty=new Set(game.galaxy.planets.map(p=>p.index));this.attackers=new Map();this.orbits=new Map();this.recordIds=new WeakMap();this.nextId=0;this.nextScan=0;this.history=[];}
  arrive(fleet,p){if(fleet.units.length){this.dirty.add(p);const owners=this.attackers.get(p)||[];owners.push(fleet.owner);this.attackers.set(p,owners);}}
  signature(p){
    const g=this.game.galaxy,planet=g.planets[p],records=[];
    for(const fleet of g.fleets)if(fleet.planet===p&&!fleet.leg)for(const u of fleet.units){let id=this.recordIds.get(u);if(!id){id=++this.nextId;this.recordIds.set(u,id);}records.push(id+':'+fleet.owner+':'+u.type.name+':'+(u.carries?.name||''));}
    return (planet.station?.name||'')+':'+(planet.stationOwner||planet.owner)+':'+records.sort().join('|');
  }
  roster(p,owner,space,records=null){
    const g=this.game.galaxy,planet=g.planets[p],rows=[];
    const add=(type,record,extra={})=>rows.push(autoCombatant(type,owner,{record,space,...extra}));
    if(space){
      for(const fleet of g.fleets)if(fleet.planet===p&&!fleet.leg&&key(fleet.owner)===key(owner))for(const u of fleet.units)if(!u.dead)add(u.carries||u.type,u,{transport:!!carriedCompany(u)});
      if(planet.station&&key(planet.stationOwner||planet.owner)===key(owner))add(planet.station,null,{station:true});
    }else{
      if(records){for(const u of records)if(!u.dead&&carriedCompany(u))add(carriedCompany(u),u);}
      else {
        if(key(planet.owner)===key(owner)&&groundLevel(planet,owner)>0){const base=autoCombatant(planet.type,owner,{space:false});base.groundBase=true;base.parts=(planet.tacticalStructures||[]).filter(u=>key(u.owner)===key(owner)).map(u=>u.type);base.power=0;rows.push(base);}
        for(const u of [...planet.garrison,...planet.groundStructures])if(!u.dead&&key(u.owner)===key(owner))add(u.type,u);
      }
    }
    return rows;
  }
  resolve(p,attacker,defender,space,records){
    const planet=this.game.galaxy.planets[p];
    this.game.ai.plans.conflict?.(planet,[attacker,defender],space,true);
    this.game.story?.scoringCall('Reset_Tactical_Stats');
    const context=space?this.game.story?.battleContext(planet,[attacker,defender]):null,sides=[this.roster(p,attacker,space,records),this.roster(p,defender,space)],result=resolveAutoBattle(...sides,this.game.ai.plans.autoContrast,{space,bombardment:space?null:landBomber(this.game.galaxy,p,attacker)});
    planet[space?'lastSpaceConflict':'lastGroundConflict']=this.game.galaxy.time;
    const player=this.game.galaxy.players.find(p=>key(p.faction)===key(defender));if(player)player[space?'lastSpaceDefense':'lastGroundDefense']=this.game.galaxy.time;
    const row={time:this.game.galaxy.time,planet:p,attacker,defender,mode:space?'space':'land',winner:result.winner===0?'attacker':'defender',before:sides.map(r=>r.length),after:result.sides.map(r=>r.alive.size)};
    this.history.push(row);if(this.history.length>100)this.history.shift();
    this.last={sides,result,row,planet:p,space};
    return {sides,result,row,context};
  }
  finish(planet,sides,result,row,context){
    this.game.story?.battleFinished(planet,[row.attacker,row.defender],sides,result.winner,row.mode==='space',context);
    this.game.ai.plans.conflict?.(planet,[row.attacker,row.defender],row.mode==='space',false);
    if(result.superweaponDestroyed)this.game.victory?.declareCondition?.(3,[row.attacker,row.defender][result.winner],5);
  }
  retreat(p,owner){
    const g=this.game.galaxy,from=g.planets[p],dest=retreatDestination(g,from,owner);
    for(const fleet of g.fleets)if(fleet.planet===p&&!fleet.leg&&key(fleet.owner)===key(owner))retreatFleet(g,fleet,dest.index);
  }
  space(p,attacker,defender){
    const g=this.game.galaxy,planet=g.planets[p],{sides,result,row,context}=this.resolve(p,attacker,defender,true);
    for(const i of [1,0])for(const u of sides[i]){
      if(u.station){const type=result.sides[i].stations.get(u);this.game.story?.stationChanged(planet,planet.station,type||null,[attacker,defender][1-i]);planet.station=type||null;planet.spaceLevel=type?.num('Base_Level',0)||0;if(!type){planet.stationOwner=null;for(const record of planet.orbitalStructures){this.game.story?.combatDeath(record,planet,record.owner,[attacker,defender][1-i]);record.dead=true;}}}
      else if(!result.sides[i].alive.has(u)){this.game.story?.combatDeath(u.record,planet,u.owner,[attacker,defender][1-i]);u.record.dead=true;}
    }
    for(const fleet of g.fleets)if(fleet.planet===p&&!fleet.leg&&[attacker,defender].includes(fleet.owner)){fleet.units=fleet.units.filter(u=>!u.dead);fleet.path=[];fleet.dest=-1;}
    g.fleets=g.fleets.filter(f=>f.units.length);planet.orbitalStructures=planet.orbitalStructures.filter(u=>!u.dead);
    this.retreat(p,result.winner===0?defender:attacker);this.changed();this.finish(planet,sides,result,row,context);return row;
  }
  invade(p,attacker,defender,records,human=false){
    const g=this.game.galaxy,fleet=g.fleets.find(f=>f.planet===p&&!f.leg&&f.owner===attacker&&f.units.some(u=>records.includes(u)&&carriedCompany(u)));
    if(!fleet||!canLand(g,fleet,p,{raid:records.length>0&&records.every(u=>u.raiding)})||!human&&[attacker,defender].some(f=>this.game.isHuman(f)))return null;
    const participants=invasionForces(g,p,attacker).filter(({gid})=>{const [fi,ui]=gid.split(':').map(Number);return records.includes(g.fleets[fi].units[ui]);}),ids=new Map(participants.map(({gid})=>{const [fi,ui]=gid.split(':').map(Number);return [g.fleets[fi].units[ui],gid];}));
    const planet=g.planets[p],{sides,result,row,context}=this.resolve(p,attacker,defender,false,[...ids.keys()]),alive=[];
    for(let i=0;i<2;i++)for(const u of sides[i])if(!u.groundBase&&result.sides[i].alive.has(u)){
      const planet=g.planets[p],id=i===0?ids.get(u.record):planet.garrison.includes(u.record)?'g:'+planet.garrison.indexOf(u.record):'s:'+planet.groundStructures.indexOf(u.record);alive.push(id);
    }
    const escaping=result.winner===0?sides[1].filter(u=>!u.groundBase&&result.sides[1].alive.has(u)&&carriedCompany(u.record)&&db.type(u.record.type.list('Company_Transport_Unit')[0])).map(u=>u.record):[];
    for(const i of [1,0])for(const u of sides[i])if(!u.groundBase&&(!result.sides[i].alive.has(u)||i===1&&result.winner===0&&!escaping.includes(u.record)))this.game.story?.combatDeath(u.record,planet,u.owner,[attacker,defender][1-i],!result.sides[i].alive.has(u));
    if(escaping.length)g.planets[p].garrison=g.planets[p].garrison.filter(u=>!escaping.includes(u));
    const oldOwner=planet.owner;
    if(result.winner===0)this.game.story?.captureBaseCleanup(planet,attacker);
    applyInvasionResult(g,{...row,sides:[attacker,defender],participants:[...ids.values()],alive});
    this.game.story?.planetCaptured(planet,oldOwner);
    if(escaping.length){
      for(const u of escaping){u.carries=u.type;u.type=db.type(u.type.list('Company_Transport_Unit')[0]);}
      g.fleets.push({owner:defender,units:escaping,planet:p,pos:null,path:[],dest:-1,leg:null});this.retreat(p,defender);
    }
    if(result.winner!==0)this.retreat(p,attacker);
    this.changed();this.dirty.add(p);this.finish(planet,sides,result,row,context);return row;
  }
  changed(){this.game.ai?.invalidate();this.game.galacticBattleChanged?.();}
  engage(p,attacker,defender,mode='space',options={}){
    const game=this.game;if(game.busy||!game.pendingBattle)return false;
    if(options.invasionIds&&!options.records)options={...options,records:this.landRecords(options.invasionIds)};
    return game.pendingBattle.begin({p,attacker,defender,mode,options});
  }
  landRecords(ids){const g=this.game.galaxy;return ids.map(gid=>{const [fi,ui]=gid.split(':').map(Number);return g.fleets[fi]?.units[ui];}).filter(Boolean);}
  overrun({p,attacker,defender,mode,options}){
    const space=mode==='space';
    return overrunSide(this.roster(p,attacker,space,space?null:options.records),this.roster(p,defender,space),this.game.ai.plans.autoContrast)>=0;
  }
  resolveFor({p,attacker,defender,mode,options}){
    this.last=null;
    if(mode==='space')this.space(p,attacker,defender);
    else this.invade(p,attacker,defender,options.records||[],true);
    return this.last;
  }
  testSpace(p,owner){
    const g=this.game.galaxy,planet=g.planets[p];
    if(!planet||!g.fleets.some(f=>f.planet===p&&!f.leg&&f.owner===owner&&f.units.length))return undefined;
    const mine=g.fleets.find(f=>f.planet===p&&!f.leg&&f.owner===owner&&f.units.length),enemyOwner=conflictAt(g,p,owner,mine)?defenderOf(g,planet,owner):null;
    if(!enemyOwner)return undefined;
    if([owner,enemyOwner].some(f=>this.game.isHuman(f))){this.engage(p,owner,enemyOwner);return this.game.ai.plans.block({k:'idle'});}
    this.space(p,owner,enemyOwner);return this.game.ai.plans.block({k:'true'});
  }
  update(){
    const game=this.game,g=game.galaxy;if(game.paused||game.battle)return;
    if(!game.busy)for(const f of g.fleets)for(const u of f.units)if(u.raiding)delete u.raiding;
    if(g.time>=this.nextScan){this.nextScan=g.time+1;for(const p of new Set(g.fleets.filter(f=>f.planet>=0&&!f.leg).map(f=>f.planet)))if(this.orbits.get(p)!==this.signature(p))this.dirty.add(p);}
    for(const p of [...this.dirty]){
      this.dirty.delete(p);const planet=g.planets[p];if(!planet)continue;
      const owners=this.attackers.get(p)||[],fought=new Set();this.attackers.delete(p);
      for(;;){
        let pair=null;
        const preferred=owners.shift(),orbit=g.fleets.filter(f=>f.planet===p&&!f.leg&&f.units.length),fleets=preferred?[...orbit.filter(f=>f.owner===preferred),...orbit.filter(f=>f.owner!==preferred)]:orbit;
        for(const a of fleets){
          if(raiding(a)||hidden(a))continue;
          const paired=other=>[key(a.owner),key(other)].sort().join('|');
          if(!conflictAt(g,p,a.owner,a))continue;
          const defender=defenderOf(g,planet,a.owner,b=>raiding(b));
          if(defender&&!fought.has(paired(defender))){pair=[a.owner,defender];fought.add(paired(defender));break;}
        }
        if(!pair)break;
        if(pair.some(f=>game.isHuman(f))){this.engage(p,...pair);return;}
        this.space(p,...pair);
      }
      this.orbits.set(p,this.signature(p));
    }
  }
}
