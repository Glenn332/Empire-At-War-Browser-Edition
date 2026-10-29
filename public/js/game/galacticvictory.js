import {db} from '../gamedata.js';
import {isHumanFaction} from './galaxy.js';
import {scheduleHeroRespawn,stepHeroRespawns} from './galacticherorespawn.js';
const key=x=>String(x||'').toUpperCase();
export const GALACTIC_VICTORIES=[
  'Galactic_All_Planets_Controlled','Galactic_Opponent_Controls_No_Planets',
  'Galactic_Credits_Accrued','Galactic_Super_Weapon_Destruction',
  'Galactic_Percentage_Control','Galactic_Conquer_Enemy_Homeworld_And_Leader',
  'Galactic_Super_Weapon_Destroys_Last_Enemy_Planet','Galactic_Super_Weapon_Kills_Enemy_Leader',
  'Galactic_Kill_Enemy_Leader','Galactic_Control_Named_Planets','Galactic_Cycles_Elapsed',
];
export const allied=(a,b)=>!!b&&(key(a)===key(b)||!!db.faction(a)?.list('Allies').some(n=>key(n)===key(b)));
const enemy=(a,b)=>!!b&&!!db.faction(a)?.list('Enemies').some(n=>key(n)===key(b));
export const currentOwner=p=>p.politicalOwner??p.owner;
export const targetOwner=p=>p.politicalTargetOwner??p.owner;
export const campaignPlanet=p=>!!p.owner&&(p.type?p.type.list('Behavior').some(n=>key(n)==='PLANET'):!p.background);
export class GalacticVictory {
  constructor(game){
    this.game=game;this.records=[];this.disableDepth=0;this.deferred=[];this.winner=null;this.finished=false;this.deadLeaders=[];
    this.lastFrame=Math.floor((game.galaxy.time||0)*30);this.nextLeaderFrame=this.lastFrame+30;
    const g=game.galaxy,c=g.campaign;
    for(const player of g.players){
      if(db.faction(player.faction)?.bool('Is_Neutral'))continue;
      const human=isHumanFaction(g,player.faction),prefix=human?'Human_':'AI_';
      for(const token of c.list(prefix+'Victory_Conditions').map(key)){
        const type=GALACTIC_VICTORIES.findIndex(n=>key(n)===token);if(type<0)continue;
        const fields={1:'Faction_Names',2:'Credit_Target',4:'Galactic_Control',7:'Leader_Names',8:'Leader_Names',9:'Planet_Names',10:'Cycle_Limit'};
        const param=prefix+'Victory_'+fields[type];
        this.records.push({type,player:player.faction,frames:30,names:[1,7,8,9].includes(type)?c.list(param).map(key):[],value:c.num(param,type===4?1:0)});
      }
      for(const type of human?[0,6]:[0,6,1])this.records.push({type,player:player.faction,frames:30,names:[],value:0});
    }
    if(g.victorySaved){const s=g.victorySaved;this.records=s.records;this.disableDepth=s.disableDepth;this.deferred=s.deferred;this.winner=s.winner;this.lastFrame=s.lastFrame;this.nextLeaderFrame=s.nextLeaderFrame;this.deadLeaders=s.deadLeaders||[];}
    this.credits=new Map(g.players.map(p=>[p.faction,p.credits]));
    g.victorySnapshot=()=>this.snapshot();
    g.victoryCreditChange=owner=>this.test(2,owner);
    g.victoryCycle=()=>{for(const p of g.players)this.test(10,p.faction);};
  }
  snapshot(){return structuredClone({records:this.records,disableDepth:this.disableDepth,deferred:this.deferred,winner:this.winner,lastFrame:this.lastFrame,nextLeaderFrame:this.nextLeaderFrame,deadLeaders:this.deadLeaders});}
  registered(type,owner){return this.records.find(r=>r.type===type&&key(r.player)===key(owner));}
  hasAI(player){
    if(this.game.ai?.controllers)return this.game.ai.controllers.has(key(player?.faction));
    const name=player?.ai??(isHumanFaction(this.game.galaxy,player?.faction)?'Human':db.faction(player?.faction)?.str('Basic_AI')||'Human');
    return !!name&&key(name)!=='HUMAN';
  }
  declareCondition(type,owner,frames=30,suppressNotice=false){
    if(this.winner||!this.registered(type,owner))return false;
    this.winner={type,player:this.registered(type,owner).player,frames,suppressNotice};
    if(type>=11&&type<=22)this.game.story?.signal('STORY_VICTORY',this.winner.player);
    return true;
  }
  enable(on){
    if(!on){this.disableDepth++;return;}
    if(this.disableDepth>0)this.disableDepth--;
    if(!this.disableDepth){const waiting=this.deferred;this.deferred=[];for(const [type,owner]of waiting)this.test(type,owner);}
  }
  storyVictory(owner,suppress=false){
    const player=this.game.galaxy.players.find(p=>key(p.faction)===key(owner));if(!player)return false;
    this.disableDepth=0;this.records.push({type:16,player:player.faction,frames:30,names:[],value:0});
    return this.declareCondition(16,player.faction,suppress?30:210,suppress);
  }
  ownershipChanged(){this.announcing=true;try{for(const p of this.game.galaxy.players)for(const type of [0,1,4,5,9])if(this.test(type,p.faction)||this.winner)return;}finally{this.announcing=false;}}
  heroKilled(record,planet,owner,killer){
    const t=record.carries||record.type;
    scheduleHeroRespawn(this.game,record,planet,owner,killer);
    const actual=[record.type,...t.list('Company_Units').map(n=>db.type(n))];
    const leader=db.faction(owner)?.str('Faction_Leader');
    if(actual.some(t=>t&&key(t.name)===key(leader))){
      this.deadLeaders.push({type:leader,owner,killer});
      for(const p of this.game.galaxy.players)if(enemy(p.faction,owner))for(const type of [5,8])this.test(type,p.faction);
    }
  }
  heroSpawned(type,owner){const actual=[type.name,...type.list('Company_Units')];this.deadLeaders=this.deadLeaders.filter(u=>key(u.owner)!==key(owner)||!actual.some(n=>key(n)===key(u.type)));}
  tacticalDeaths(r){
    const g=this.game.galaxy,p=g.planets[r.planet];if(!p||!r.sides)return;
    const alive=new Set(r.alive),participants=new Set(r.participants||[]),winner=r.sides[r.winner==='attacker'?0:1];
    const killed=(record,owner)=>this.heroKilled(record,p,owner,winner);
    for(const [fi,f]of g.fleets.entries())if(f.planet===r.planet&&!f.leg&&r.sides.includes(f.owner))for(const [ui,u]of f.units.entries()){
      const id=fi+':'+ui;if((r.mode!=='land'||participants.has(id))&&!alive.has(id))killed(u,f.owner);
    }
    if(r.mode==='land')for(const [prefix,rows]of [['g',p.garrison],['s',p.groundStructures]])for(const [i,u]of rows.entries())if(!alive.has(prefix+':'+i))killed(u,u.owner);
    if(r.superweaponDestroyed)this.declareCondition(3,winner,5);
  }
  superweaponBattle(r){
    const g=this.game.galaxy,winner=r.sides?.[r.winner==='attacker'?0:1],loser=r.sides?.[r.winner==='attacker'?1:0];
    if(!winner||!loser)return;
    const isKiller=record=>{const type=record.carries||record.type,children=[...type.list('Company_Units'),...type.list('Squadron_Units')].map(n=>db.type(n)).filter(Boolean);return (children.length?children:[type]).some(t=>t.bool('Is_Super_Weapon_Killer'));};
    const alive=new Set(r.alive),killer=g.fleets.some((f,fi)=>f.planet===r.planet&&!f.leg&&key(f.owner)===key(winner)&&f.units.some((u,ui)=>alive.has(fi+':'+ui)&&isKiller(u)));
    for(const weapon of r.superweapons||[]){
      if(!alive.has(weapon.gid))continue;
      if(key(weapon.owner)!==key(winner)&&killer){
        const [fi,ui]=weapon.gid.split(':').map(Number),record=g.fleets[fi]?.units[ui];
        if(record)record.dead=true;
        alive.delete(weapon.gid);r.superweaponDestroyed=true;this.declareCondition(3,winner,5);continue;
      }
      if(!db.faction(loser)?.bool('Is_Playable'))continue;
      const opponent=key(weapon.owner)===key(winner)?loser:winner;
      if(this.registered(6,weapon.owner)&&!g.planets.some(p=>campaignPlanet(p)&&!p.destroyed&&key(currentOwner(p))===key(opponent)))this.declareCondition(6,weapon.owner,30);
    }
    r.alive=[...alive];
  }
  test(type,owner){
    const r=this.registered(type,owner);if(!r)return false;
    if(this.disableDepth){if(!this.deferred.some(([t,p])=>t===type&&key(p)===key(owner)))this.deferred.push([type,owner]);return false;}
    if(this.winner)return this.winner.type===type&&key(this.winner.player)===key(owner);
    if(this.matches(r))return this.declareCondition(type,owner,r.frames);
    return false;
  }
  matches(r){
    const g=this.game.galaxy,owner=r.player,player=g.players.find(p=>key(p.faction)===key(owner));
    const planets=g.planets.filter(campaignPlanet),playable=n=>db.faction(n)?.bool('Is_Playable');
    if([0,1,2,4,5,8].includes(r.type)&&!playable(owner))return false;
    const opponents=g.players.filter(p=>enemy(owner,p.faction)&&playable(p.faction));
    const ledger=planets.flatMap(p=>p.killedHeroes||[]);
    switch(r.type){
      case 0:return planets.length>0&&!db.faction(currentOwner(planets[0]))?.bool('Is_Neutral')&&planets.every(p=>allied(owner,currentOwner(p)));
      case 1:return planets.length>0&&!planets.some(p=>opponents.some(o=>key(o.faction)===key(currentOwner(p))&&(!r.names.length||r.names.includes(key(o.faction)))&&!(this.hasAI(player)&&key(owner)!==key(g.active)&&this.hasAI(o)&&key(o.faction)!==key(g.active))));
      case 2:return Math.trunc(player?.credits||0)>=Math.trunc(r.value);
      case 4:{
        if(!planets.length)return false;
        const share=Math.fround(planets.filter(p=>key(targetOwner(p))===key(owner)).length/planets.length),met=share>=Math.fround(r.value);
        if(!met&&this.announcing&&key(owner)===key(this.game.me))this.game.galacticLog?.message(String(db.t('TEXT_GALACTIC_PERCENTAGE_CONTROL')).replace(/%[-+0-9.]*[fd]/,()=>(share*100).toFixed(0)).replace(/%[-+0-9.]*[fd]/,()=>(r.value*100).toFixed(0)).replace(/%%/g,'%'),{urgent:true,color:[109,247,255]});
        return met;
      }
      case 5:{
        const faction=db.faction(db.faction(owner)?.str('Primary_Enemy')),home=planets.find(p=>key(p.name)===key(faction?.str('Home_Planet'))),leader=faction?.str('Faction_Leader_Company');
        return !!home&&key(targetOwner(home))===key(owner)&&!!leader&&ledger.some(u=>key(u.type)===key(leader));
      }
      case 8:return g.players.filter(p=>enemy(owner,p.faction)).some(p=>{
        const leader=db.type(db.faction(p.faction)?.str('Faction_Leader_Company'));if(!leader)return false;
        const first=leader.list('Company_Units')[0];
        return (!r.names.length||r.names.includes(key(first)))&&(ledger.some(u=>key(u.type)===key(leader.name)&&key(u.killer)===key(owner))||this.deadLeaders.some(u=>key(u.type)===key(first)&&key(u.killer)===key(owner)));
      });
      case 9:return planets.filter(p=>r.names.includes(key(p.name))).every(p=>key(p.owner)===key(owner));
      case 10:return (g.fiscal?.cycle||0)>Math.trunc(r.value);
      default:return false;
    }
  }
  update(){
    const g=this.game.galaxy,frame=Math.floor((g.time||0)*30),delta=Math.max(0,frame-this.lastFrame);this.lastFrame=frame;
    stepHeroRespawns(this.game);
    for(const p of g.players)if(this.credits.get(p.faction)!==p.credits){this.credits.set(p.faction,p.credits);this.test(2,p.faction);}
    if(frame>=this.nextLeaderFrame){this.nextLeaderFrame=frame+30;for(const p of g.players)this.test(8,p.faction);}
    if(this.winner){this.winner.frames-=delta;if(this.winner.frames<=0&&!this.disableDepth&&!this.finished){this.finished=true;this.game.endCampaign?.(this.winner);}}
  }
}
