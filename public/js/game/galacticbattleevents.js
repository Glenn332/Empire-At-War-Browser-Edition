import {db} from '../gamedata.js';
const key=x=>String(x||'').toUpperCase(),list=x=>String(x||'').split(',').map(s=>key(s.trim())).filter(Boolean);
const active=e=>!e.disabled&&!e.completed&&e.active;
export function resetCombatEvent(e){if(e.type!=='STORY_CONQUER_COUNT')e.battleCount=0;e.remainingCounts=null;}
function factionFilter(host,e,filter,owner){
  const wanted=key(filter);if(!wanted||wanted==='FILTER_NONE')return true;
  if(!['FILTER_FRIENDLY_ONLY','FILTER_ENEMY_ONLY','FILTER_NEUTRAL_ONLY','FILTER_FRIENDLY_AND_NEUTRAL','FILTER_ENEMY_AND_NEUTRAL','FILTER_FRIENDLY_AND_ENEMY'].includes(wanted))return true;
  const relation=key(e.plot.owner)===key(owner)?'FRIENDLY':db.faction(owner)?.bool('Is_Neutral')?'NEUTRAL':'ENEMY';
  return wanted.slice(7).split(/_ONLY|_AND_/).includes(relation);
}
const CLASS=c=>key(c).replace(/^CLASS_/,'');
const MODES={FILTER_NONE:0,FILTER_FRIENDLY_ONLY:1,FILTER_NEUTRAL_ONLY:2,FILTER_ENEMY_ONLY:3,FILTER_FRIENDLY_AND_NEUTRAL:4,FILTER_ENEMY_AND_NEUTRAL:5,FILTER_FRIENDLY_AND_ENEMY:6,FRIENDLY_CONTAINS:1,FRIENDLY_ONLY_CONTAINS:2,ENEMY_CONTAINS:3,ENEMY_ONLY_CONTAINS:4};
function classFilter(value,own,other){
  const [name,...tokens]=list(value);if(!tokens.length)return true;
  const mode=MODES[name]??0;if(mode<1||mode>4)return true;
  const wanted=tokens.map(CLASS),actual=mode<3?own:other;
  return mode%2===0?[...actual].every(c=>wanted.includes(c)):wanted.every(c=>actual.has(c));
}
export function battleClassSummary(host,planet,owners){
  const g=host.game.galaxy;
  if(!owners||!owners.some(o=>key(o)===key(g.active)))return;
  const local=new Set(),other=new Set();
  for(const fleet of g.fleets)if(fleet.planet===planet.index&&!fleet.leg)for(const record of fleet.units)if(!record.dead){
    const set=key(fleet.owner)===key(g.active)?local:other;
    for(const t of [record.type,record.carries]){const c=t&&CLASS(t.str('Ship_Class'));if(c)set.add(c);}
  }
  host.battleClasses=[local,other];
}
export function battleStory(host,planet,owners,sides,winner,space){
  const lists=host.battleClasses||[new Set(),new Set()];
  for(const i of [winner,1-winner])for(const e of host.eventTypes.get(i===winner?'STORY_WIN_BATTLES':'STORY_LOSE_BATTLES')||[]){
    if(!active(e)||key(e.plot.owner)!==key(owners[i]))continue;
    const domain=e.params[1]||'EITHER';
    if(domain!=='EITHER'&&(domain==='SPACE')!==space)continue;
    const friendly=key(e.plot.owner)===key(host.game.galaxy.active)?0:1;
    if(space&&!classFilter(e.params[2],lists[friendly],lists[1-friendly]))continue;
    e.battleCount=(e.battleCount||0)+1;
    const planets=list(e.params[3]);
    if(e.battleCount>=(parseInt(e.params[0],10)||0)&&(!planets.length||planets.includes(key(planet.name))))host.fire(e);
  }
}
export function destroyBaseStory(host,planet){
  for(const e of host.eventTypes.get('STORY_DESTROY_BASE')||[]){
    if(!active(e))continue;
    const planets=list(e.params[0]),domain=key(e.params[1]||'EITHER');
    if(planets.length&&!planets.includes(key(planet.name))||!['SPACE','EITHER'].includes(domain))continue;
    if(factionFilter(host,e,e.params[2]||'FILTER_ENEMY_ONLY',planet.owner))host.fire(e);
  }
}
function counted(host,e,index,param){
  e.remainingCounts||=[];
  if(e.remainingCounts[index]===undefined)e.remainingCounts[index]=Number(list(e.params[param])[index]||1);
  if(--e.remainingCounts[index]<=0)host.fire(e);
}
export function constructStory(host,type,owner){
  for(const e of host.eventTypes.get('STORY_CONSTRUCT')||[]){
    if(!active(e))continue;
    const index=list(e.params[0]).indexOf(key(type.name));
    if(index>=0&&factionFilter(host,e,e.params[2]||'FILTER_FRIENDLY_ONLY',owner))counted(host,e,index,1);
  }
}
export function conquerStory(host,planet){
  for(const e of host.eventTypes.get('STORY_CONQUER')||[]){
    if(!active(e))continue;
    const index=list(e.params[0]).indexOf(key(planet.type?.name||planet.name));
    if(index>=0&&factionFilter(host,e,e.params[2]||'FILTER_FRIENDLY_ONLY',planet.owner))counted(host,e,index,1);
  }
  for(const e of host.eventTypes.get('STORY_CONQUER_COUNT')||[])if(active(e)){
    e.battleCount=(e.battleCount||0)+1;
    if(e.battleCount>=(parseInt(e.params[0],10)||0))host.fire(e);
  }
}
export function destroyStory(host,type,scoringType,planet){
  for(const t of type===scoringType?[type]:[type,scoringType])for(const e of host.eventTypes.get('STORY_DESTROY')||[]){
    if(!active(e)||!t)continue;
    const index=list(e.params[0]).indexOf(key(t.name));if(index<0)continue;
    const planets=list(e.params[1]),at=planets.indexOf(key(planet?.name));
    if(planets.length&&(at<0||!factionFilter(host,e,e.params[3],planet?.owner)))continue;
    counted(host,e,planets.length?at:index,2);
  }
  defeatHeroStory(host,type,planet);
}
export function defeatHeroStory(host,type,planet){
  if(host&&type.bool('Is_Named_Hero'))for(const e of host.eventTypes.get('STORY_DEFEAT_HERO')||[]){
    if(!active(e))continue;
    const index=list(e.params[0]).indexOf(key(type.name));
    if(index>=0&&factionFilter(host,e,e.params[2]||'FILTER_FRIENDLY_ONLY',planet?.owner))counted(host,e,index,1);
  }
}

export function scoringCall(host,name,...args){
  const inst=host?.scoring;if(!inst||inst.state!=='run')return;
  const previous=host.current;host.current=inst;
  try{const result=host.vm.call(inst.env,name,...args);if(!result.ok&&!result.missing)host.errors.set('GameScoring '+name,result.error);}
  finally{host.current=previous;}
}
