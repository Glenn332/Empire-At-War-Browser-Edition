import { db } from '../gamedata.js';

export const LOG_TABS=['IDC_DROID_LOG_RADIO','IDC_DATA_CHART_RADIO','IDC_TECH_TREE_RADIO','IDC_SUMMARY_SCREEN_RADIO'];
export const LOG_WEATHER=['i_pa_weather_sun.tga','i_pa_weather_fire.tga','i_pa_weather_snow.tga','i_pa_weather_rain.tga','i_pa_weather_wind.tga'];
export const logColor=c=>`rgba(${c.slice(0,3).join(',')},${(c[3]??255)/255})`;

export function logState(g) {
  return g.log ||= {messages:[],history:{}};
}
export function appendLog(g,text,color=db.constants.vec('Droid_Text_Color',[255,255,255])) {
  const record={cycle:g.fiscal?.cycle||0,text:String(text),color:color.slice(),
    heading:db.t('TEXT_LOG_CYCLE_01').replace('##0',String(g.fiscal?.cycle||0)),
    dateColor:db.constants.vec('Droid_Date_Color',[255,0,0]),separator:db.t('TEXT_HELP_SEPERATOR'),separatorColor:db.constants.vec('Droid_Seperator_Color',[128,128,128])};
  logState(g).messages.push(record);return record;
}
export function logRows(g) {
  return logState(g).messages.flatMap(r=>[
    {text:r.heading,color:logColor(r.dateColor),wrap:false},
    {text:r.text,color:logColor(r.color),wrap:true},
    {text:r.separator,color:logColor(r.separatorColor),wrap:false},
  ]);
}
export function logLegend() {
  const icons=db.constants.list('Planet_Ability_Icon_Names'),texts=db.constants.list('Planet_Ability_Text_IDs'),colors=db.constants.vec('Planet_Ability_RGBs',[]);
  return icons.slice(0,texts.length).map((icon,i)=>({icon,text:db.t(texts[i]),color:colors.slice(i*3,i*3+3)}));
}
export { advisorHints } from './advisorhints.js';
export function techTreeDialog(faction,space=false) {
  const name=db.faction(faction)?.str('Tech_Tree_Dialog_Name')||'IDD_TECH_TREE_REBEL';return name+(space?'_SPACE':'');
}

export function historyFactions(g) {
  return ['Good_Side_Name','Evil_Side_Name','Corrupt_Side_Name'].map(tag=>db.constants.str(tag)).map(name=>g.players.find(p=>p.faction.toUpperCase()===name.toUpperCase())).filter(Boolean);
}
const powers=new WeakMap();
function combatPower(type,seen=new Set()) {
  if(powers.has(type))return powers.get(type);if(seen.has(type))return 0;seen.add(type);
  const units=[...type.list('Company_Units'),...type.list('Squadron_Units')].map(n=>db.type(n)).filter(Boolean);
  const value=units.length?units.reduce((n,t)=>n+combatPower(t,seen),0):type.num('AI_Combat_Power',0);
  seen.delete(type);powers.set(type,value);return value;
}
export function sampleHistory(g,frame) {
  const state=logState(g);if(state.historyFrame===frame)return;
  state.historyFrame=frame;
  const powers=new Map(g.players.map(p=>[p.faction,0]));
  const add=(owner,type)=>{if(powers.has(owner))powers.set(owner,powers.get(owner)+2*combatPower(type));};
  for(const p of g.planets){if(p.station)add(p.stationOwner||p.owner,p.station);for(const u of [...p.groundStructures,...p.orbitalStructures,...p.garrison])add(u.owner,u.type);}
  for(const f of g.fleets)for(const u of f.units)add(f.owner,u.carries||u.type);
  for(const player of g.players){
    const rows=state.history[player.faction] ||= [];
    if(rows.length>=100&&rows.length%2===0){
      for(let i=0;i<rows.length/2;i++){const a=rows[i*2],b=rows[i*2+1];rows[i]={frame:Math.trunc((a.frame+b.frame)/2),economy:Math.fround((a.economy+b.economy)/2),planets:Math.trunc((a.planets+b.planets)/2),tech:Math.trunc((a.tech+b.tech)/2),military:Math.fround((a.military+b.military)/2)};}rows.length/=2;
    }
    rows.push({frame,economy:Math.fround(player.credits),planets:g.planets.filter(p=>p.owner===player.faction&&!p.background).length,tech:player.tech,military:Math.fround(powers.get(player.faction)||0)});
  }
}

export const nativeRound=n=>n<0?-Math.trunc(-n+.5):Math.trunc(n+.5);
const same=(a,b)=>String(a).toUpperCase()===String(b).toUpperCase();
export function summaryEconomy(g,p) {
  const base=p.destroyed?p.type.num('Planet_Destroyed_Credit_Value',0):(p.baseCreditValue??p.type.num('Planet_Credit_Value',0));
  let routes=0,mining=0,count=0,icon='',source=null;
  const controller=p.politicalOwner||p.owner;
  for(const r of g.routes){if(r.a!==p.index&&r.b!==p.index)continue;const other=g.planets[r.a===p.index?r.b:r.a];
    if(same(other.politicalOwner||other.owner,controller)&&!db.faction(controller)?.bool('Is_Neutral'))routes+=base*Math.max(0,r.type.num('Credit_Gain_Factor',0));}
  const sources=[...p.groundStructures,...p.orbitalStructures,...p.garrison];if(p.station)sources.push({type:p.station,owner:p.stationOwner||p.owner});
  for(const f of g.fleets)if(!f.leg&&f.planet===p.index)for(const u of f.units)sources.push({type:u.carries||u.type,owner:f.owner});
  for(const u of sources)if(same(u.owner,p.owner)&&u.type.behaviors().has('DUMMY_GROUND_STRUCTURE'))for(const ability of u.type.sub('Abilities').flatMap(n=>n.all('Planet_Income_Bonus_Ability'))){
    const value=(base*ability.num('Percentage_Income_Modifier',0)+ability.num('Absolute_Income_Modifier',0))*(p.type.bool('Planet_Is_Mining_Colony')?ability.num('Additional_Multiplier_On_Mining_Colonies',1):1);
    if(value){mining+=nativeRound(value);count++;if(!source){source=u.type;icon=u.type.str('Icon_Name');}}
  }
  const out={base:nativeRound(base),routes:nativeRound(routes),mining,count,icon,source};out.total=out.base+out.routes+mining;return out;
}
export function summaryPopulation(p,owner) {
  let total=p.type.num('Additional_Population_Capacity',0);
  for(const u of [...p.groundStructures,...p.orbitalStructures])if(same(u.owner,owner))total+=u.type.num('Additional_Population_Capacity',0);
  if(p.station&&same(p.stationOwner||p.owner,owner))total+=p.station.num('Additional_Population_Capacity',0);return Math.trunc(total);
}
const crcIds=new WeakMap();let indexedTypes=0;
function typeCRC(t) {if(indexedTypes!==db.types.size){for(const [id,type]of db.typesByCrc)crcIds.set(type,id);indexedTypes=db.types.size;}return crcIds.get(t)||0;}
function fleetIcons(units) {
  const special=[],grouped=new Map();
  for(const u of units){const type=u.carries||u.type;if(!type?.str('Icon_Name'))continue;
    if(type.bool('Is_Named_Hero')||type.bool('Is_Hero')||type.bool('Is_Special_Unit'))special.push({type,count:1,special:true});
    else {const id=typeCRC(type),record=grouped.get(id)||{type,count:0};record.count++;grouped.set(id,record);}}
  return [...special,...[...grouped].sort((a,b)=>a[0]-b[0]).map(([,r])=>r)];
}
export function summaryFleetRows(g,planets,owner) {
  return planets.flatMap(p=>{
    const rows=[],ground=fleetIcons(p.garrison.filter(u=>same(u.owner,owner)));if(ground.length)rows.push({planet:p,kind:0,icons:ground});
    for(let slot=0;slot<3;slot++){const units=g.fleets.filter(f=>!f.leg&&f.planet===p.index&&same(f.owner,owner)&&(f.slot||0)===slot).flatMap(f=>f.units),icons=fleetIcons(units);if(icons.length)rows.push({planet:p,kind:slot+1,icons});}
    if(!rows.length)rows.push({planet:p,kind:-1,icons:[]});rows[0].first=true;return rows;
  });
}
export function updateHistory(g) {
  const frame=Math.trunc((g.time||0)*30),state=logState(g);
  let next=state.historyFrame===undefined?0:state.historyFrame<2?state.historyFrame+1:Math.max(30,state.historyFrame+30);
  for(;next<=frame;next=next<2?next+1:next<30?30:next+30)sampleHistory(g,next);
}
export function historyChart(g,metric='economy') {
  const series=historyFactions(g).map(player=>({player,rows:logState(g).history[player.faction]||[]}));
  if(!series.length||series.some(s=>s.rows.length<2))return null;
  const frames=series.flatMap(s=>s.rows.map(r=>r.frame)),start=Math.min(...frames),end=Math.max(...frames);
  const maximum=metric==='tech'?5:Math.max(1,metric==='planets'?g.planets.filter(p=>!p.background).length:0,...series.flatMap(s=>s.rows.map(r=>r[metric])));
  const cycles=Math.floor(end/Math.max(1,Math.round(30*db.constants.num('Fiscal_Cycle_Time_In_Secs',45))))+1;
  return {start,end,maximum,cycles,metric,series:series.map(s=>({...s,points:s.rows.map(r=>({x:end===start?0:1.5*(r.frame-start)/(end-start),y:1-r[metric]/maximum}))}))};
}
