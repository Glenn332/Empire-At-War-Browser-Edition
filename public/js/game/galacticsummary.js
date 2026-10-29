import * as THREE from 'three';
import { db } from '../gamedata.js';
import { lighting, planetLighting, updateBillboards } from '../model.js';
import { preparePlanetPortrait, alignPortraitPixels } from './planetportrait.js';
import { planetIncome } from './galacticeconomy.js';
import { summaryEconomy,summaryPopulation,summaryFleetRows } from './galacticlogdata.js';

const label=p=>db.t(p.type.str('Text_ID'))||p.name;
export async function captureSummaryPlanet(game,p) {
  const source=game.planetViews[p.index]?.inst;if(!source)return '';
  const portrait=await preparePlanetPortrait(source),inst=portrait.inst,root=inst.root,scene=new THREE.Scene();scene.add(root);
  const camera=new THREE.PerspectiveCamera(2*Math.atan(Math.tan(.5)/(4/3))*180/Math.PI,4/3,1,1000);camera.up.set(0,0,1);
  alignPortraitPixels(camera,128,128);
  camera.position.copy(root.position).add(new THREE.Vector3(0,35.5,15));camera.lookAt(root.position);
  let read=null;const r=game.renderer,target=new THREE.WebGLRenderTarget(128,128),pixels=new Uint8Array(128*128*4),previous=r.getRenderTarget(),viewport=r.getViewport(new THREE.Vector4()),clear=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();
  const nativeSaved=Object.fromEntries(Object.entries(planetLighting).map(([key,uniform])=>[key,uniform.value.clone()]));
  const saved=Object.fromEntries(['sunDir','sunColor','sunSpecular','fillColor','fillColor2','ambient','fogRange'].map(k=>[k,lighting[k].value.clone()])),shadow=lighting.shadowOn.value;
  try {
    lighting.sunDir.value.set(-Math.SQRT1_2/2,-Math.sqrt(3/8),Math.SQRT1_2);lighting.sunColor.value.setRGB(.5,.5,.5);lighting.sunSpecular.value.setRGB(1,1,1);lighting.fillColor.value.setRGB(0,0,0);lighting.fillColor2.value.setRGB(0,0,0);lighting.ambient.value.setRGB(.05,.05,.07);lighting.fogRange.value.set(0,0);lighting.shadowOn.value=0;
    for(const key of Object.keys(planetLighting))planetLighting[key].value.copy(lighting[key].value);
    updateBillboards(inst,camera);inst.syncFromBones();
    r.syncPipelines=true;r.setRenderTarget(target);r.setViewport(0,0,128,128);r.setClearColor(0,1);r.clear();r.render(scene,camera);read=r.isWebGLRenderer?r.readRenderTargetPixels(target,0,0,128,128,pixels):r.readRenderTargetPixelsAsync(target,0,0,128,128,pixels);
  }finally{for(const[key,value]of Object.entries(nativeSaved))planetLighting[key].value.copy(value);for(const[k,v]of Object.entries(saved))lighting[k].value.copy(v);lighting.shadowOn.value=shadow;r.setRenderTarget(previous);r.setViewport(viewport);r.setClearColor(clear,alpha);r.syncPipelines=false;target.dispose();portrait.dispose();}
  await read;
  const cv=document.createElement('canvas');cv.width=cv.height=128;const ctx=cv.getContext('2d'),image=ctx.createImageData(128,128);
  image.data.set(pixels);for(let i=3;i<image.data.length;i+=4)image.data[i]=255;ctx.putImageData(image,0,0);return cv.toDataURL();
}

export async function renderSummary(owner,d) {
  const game=owner.game,g=game.galaxy,kind=owner.summaryKind;
  const planets=g.planets.filter(p=>p.owner===game.me&&!p.background),economy=new Map(planets.map(p=>[p,summaryEconomy(g,p)])),population=new Map(planets.map(p=>[p,summaryPopulation(p,game.me)]));
  let offset=0,scrollControl=null;
  const categories={IDC_PRODUCTION_RADIO:'production',IDC_FLEETS_RADIO:'fleets',IDC_ECONOMY_RADIO:'economy'};
  d.radios(Object.keys(categories),Object.keys(categories).find(id=>categories[id]===kind),id=>owner.show(3,{summary:categories[id]}));
  const headers={IDC_BUTTON_PLANETARY:'planet',IDC_BUTTON_INCOME:'income',IDC_BUTTON_TOTAL_INCOME:'total',IDC_BUTTON_BASE_CREDIT_VALUE:'base',IDC_BUTTON_TRADE_ROUTE_INCOME:'routes',IDC_BUTTON_MINING_FACILITY_INCOME:'mining',IDC_BUTTON_POP_CAP:'population',IDC_BUTTON_PRODUCING:'producing',IDC_BUTTON_UPGRADES:'upgrades',IDC_BUTTON_LAND_FLEETS:'land',IDC_BUTTON_SPACE_FLEETS:'space'};
  const groups=new Map(planets.map(p=>[p,summaryFleetRows(g,[p],game.me)]));
  const value=(p,key)=>key==='planet'?label(p):key==='population'?population.get(p):key==='income'?planetIncome(g,p):key==='producing'?Object.values(p.production).filter(q=>q.length).length:key==='upgrades'?(p.upgrades||[]).length:key==='land'||key==='space'?groups.get(p).filter(r=>key==='land'?r.kind===0:r.kind>0).reduce((n,r)=>n+r.icons.filter(i=>!i.special).length,0):economy.get(p)[key]||0;
  const sorted=()=>planets.slice().sort((a,b)=>{const x=value(a,owner.summarySort),y=value(b,owner.summarySort);return (typeof x==='string'?x<y?-1:x>y?1:0:x-y)*(owner.summaryDescending?-1:1);});
  const visible=kind==='fleets'?10:6;
  let rows=[];
  const text=(id,value)=>d.setText(id,typeof value==='function'?value:String(value));
  const icon=(id,name,type=null)=>{const ctl=d.ctl(id);if(ctl){ctl.onmouseenter=e=>owner.showLinked(type,e);ctl.onpointermove=e=>owner.moveLinked(e);ctl.onmouseleave=()=>owner.hideLinked();}return owner.picture(d,id,name);};
  const choose=p=>{owner.close();game.select(p.index);game.view.x=p.pos[0];game.view.y=p.pos[1];if(game.view.zoom===1)game.view.planet=p.index;};
  const slots=new Map();
  const planetImage=(i,p,show)=>{
    const id='IDC_PLANET_ICON'+i,ctl=d.ctl(id);d.show(id,show);text('IDC_PLANET_NAME'+i,show?label(p):'');
    slots.set(i,show?p:null);
    if(!show||!ctl)return;let image=owner.portraits.get(p.index);if(image===undefined){image=captureSummaryPlanet(game,p);owner.portraits.set(p.index,image);}
    d.imageFrame(id,false);Promise.resolve(image).then(url=>{if(slots.get(i)===p&&owner.dialog===d)d.setImage(id,url);}).catch(console.error);ctl.setAttribute('role','button');ctl.setAttribute('aria-label',label(p));ctl.tabIndex=0;ctl.onclick=()=>choose(p);ctl.onkeydown=e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();choose(p);}};
  };
  const totals={base:0,routes:0,mining:0,total:0};for(const e of economy.values())for(const k of Object.keys(totals))totals[k]+=e[k];
  for(const[key,id]of Object.entries({base:'IDC_BASE_CREDIT_VALUE_TOTAL',routes:'IDC_TRADE_ROUTE_INCOME_TOTAL',mining:'IDC_MINING_FACILITIES_INCOME_TOTAL',total:'IDC_TOTAL_INCOME_TOTAL'}))text(id,totals[key]);
  text('IDC_POP_TOTAL_STATIC','+'+[...population.values()].reduce((a,b)=>a+b,0));
  const player=g.players.find(p=>p.faction===game.me);
  text('IDC_STATIC_SUMMARYA',()=>db.t('TEXT_CURRENT_TIME_ERA')+' '+Math.max(0,...g.players.map(p=>p.tech)));
  text('IDC_STATIC_SUMMARYB',()=>db.t('TEXT_CURRENT_CREDIT_RESERVE')+' '+Math.round(player?.credits||0));
  for(const [i,p]of g.players.filter(p=>db.faction(p.faction)?.bool('Is_Playable')).slice(0,2).entries())text('IDC_STATIC_SUMMARY'+i,
    ()=>`${db.t(db.faction(p.faction).str('Text_ID'))}: ${db.t('TEXT_PLANETS')} ${g.planets.filter(q=>q.owner===p.faction&&!q.background).length} ${db.t('TEXT_TECH_LEVEL')} ${p.tech}`);
  const paint=()=>{
    owner.hideLinked();
    const work=[];
    for(let i=0;i<visible;i++){
      const row=rows[offset+i],p=kind==='fleets'?row?.planet:row;
      planetImage(i,p,!!p&&(kind!=='fleets'||row.first));
      if(kind==='economy'){
        const e=p&&economy.get(p);for(const [key,prefix]of Object.entries({total:'TOTAL_INCOME',base:'BASE_CREDIT_VALUE',routes:'TRADE_ROUTE_INCOME',mining:'MINING_FACILITY_INCOME'}))text(`IDC_${prefix}_${i}`,e?e[key]:'');
        work.push(icon('IDC_MINING_FACILITY_ICON_'+i,e?.icon||'',e?.source));text('IDC_NUM_MINING_FACILITIES_STATIC_'+i,e?.count?'x'+e.count:'');
      }else if(kind==='production'){
        text('IDC_POP_CAP_'+i,p?'+'+population.get(p):'');text('IDC_INCOME_'+i,p?planetIncome(g,p).toFixed(1).padStart(7,' ')+' cr':'');
        for(const[k,prefix]of [['ground','GP'],['space','SP']]){const head=p?.production[k]?.[0];work.push(icon(`IDC_${prefix}_ICON${i}`,head?.type.str('Icon_Name')||'',head?.type));text(`IDC_PER_${prefix}_STATIC${i}`,head?Math.trunc(100*(1-head.left/Math.max(head.total,1e-9)))+'%':'');}
        for(let j=0;j<8;j++){const value=p?.upgrades?.[j],type=value?.str?value:db.type(value);work.push(icon(`IDC_HERO${i}_ICON${j}`,type?.str('Icon_Name')||'',type));}
      }else{
        if(i<9){const next=rows[offset+i+1],show=!!next?.first;d.show('IDC_HEROES_DIVIDERS'+i,show);if(show)work.push(icon('IDC_HEROES_DIVIDERS'+i,'i_tree_arrow_right.tga'));}
        for(let j=0;j<15;j++){const record=row?.icons[j],id=`IDC_ROW${i}_FLEET${j}`;d.show(id,!!record);work.push(icon(id,record?.type.str('Icon_Name')||'',record?.type));
          const ctl=d.ctl(id);if(ctl)ctl.setAttribute('aria-label',record?(db.t(record.type.str('Text_ID'))||record.type.name)+(record.count>1?' x'+record.count:''):'');
          d.imageText(id,record?.count>1?'x'+record.count:'');
        }
      }
    }
    Promise.all(work).catch(console.error);
  };
  const rebuild=()=>{
    const order=sorted();rows=kind==='fleets'?summaryFleetRows(g,order,game.me):order;offset=0;
    const max=Math.max(0,rows.length-visible),rect=d.def.controls.find(c=>c.id==='IDC_LIST2');
    if(scrollControl)scrollControl.set(0);else scrollControl=d.scroll('IDC_SCROLLBAR_SLIDER',max,n=>{offset=n;paint();},rect);paint();
  };
  for(const[id,key]of Object.entries(headers)){const ctl=d.ctl(id);if(!ctl)continue;ctl.setAttribute('role','button');ctl.tabIndex=0;const sort=()=>{owner.summaryDescending=owner.summarySort===key?!owner.summaryDescending:key!=='planet';owner.summarySort=key;rebuild();};d.on(id,sort);ctl.onkeydown=e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();sort();}};}
  const refreshLanguage=()=>{d.ctl('IDC_LIST2')?.setAttribute('aria-label',db.t('TEXT_PLANETARY'));paint();};
  d.onLanguageRefresh(refreshLanguage);rebuild();
}
