import { db } from '../gamedata.js';
import { fontFamily } from '../fonts.js';
import { loadNativeFont, nativeFont, nativeTextMask, nativeTextPixels } from '../nativefont.js';
import { dialogFontPixels } from './dialogtext.js';
import { historyChart,logColor } from './galacticlogdata.js';

export function historyLabels(ends,height,screenHeight=0) {
  const labels=ends.map((value,i)=>{const y=screenHeight?(Math.floor(screenHeight*value+.5)-.5)/screenHeight:value;return {i,y:y+height>1?y-height:y,compare:y+height>1?y+height:y};});
  if(labels.length===2){const gap=Math.abs(labels[0].compare-labels[1].compare);if(gap<height)labels[0].y+=height-gap;}
  if(labels.length===3){const order=labels.slice().sort((a,b)=>b.compare-a.compare),gap1=order[0].compare-order[1].compare,gap2=order[1].compare-order[2].compare;
    if(gap1<height)order[0].y+=height-gap1;if(gap2<height)order[2].y-=height-gap2;}
  return labels.map(({i,y})=>({i,y}));
}
export function drawHistory(chart,game) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,512,256);
  const point=p=>[256*p.x,256*(p.y+.05)/1.1],half=5/1024;
  const colors=[];
  for(const series of chart.series){
    const f=db.faction(series.player.faction),color=game.simplifiedFactionColors?db.constants.vec(series.player.faction===game.me?'Player_Color':'Enemy_Color',f.vec('Color',[255,255,255])):f.vec('Color',[255,255,255]);
    ctx.fillStyle=logColor(color);colors.push(ctx.fillStyle);
    for(let i=1;i<series.points.length;i++){
      const a=series.points[i-1],b=series.points[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(!length)continue;
      const ox=-dy/length*half,oy=dx/length*half;
      const corners=[{x:a.x+ox,y:a.y+oy},{x:b.x+ox,y:b.y+oy},{x:b.x-ox,y:b.y-oy},{x:a.x-ox,y:a.y-oy}].map(point);
      ctx.beginPath();ctx.moveTo(...corners[0]);for(const p of corners.slice(1))ctx.lineTo(...p);ctx.closePath();ctx.fill();
    }
  }
  const size=dialogFontPixels(innerHeight,24),bitmap=nativeFont('EmpireAtWar-Bold',size);
  for(const label of historyLabels(chart.series.map(s=>s.points.at(-1).y),(bitmap?.height||size)/innerHeight,innerHeight)){
    const series=chart.series[label.i],f=db.faction(series.player.faction),last=point({x:(Math.floor(innerWidth*1.51+.5)-.5)/innerWidth,y:label.y});
    ctx.save();ctx.fillStyle=colors[label.i];ctx.translate(...last);ctx.scale(256/innerWidth,256/1.1/innerHeight);ctx.font=`${size}px ${fontFamily('EmpireAtWar-Bold')}`;ctx.textBaseline='top';if(bitmap){const image=nativeTextPixels(nativeTextMask(bitmap,db.t(f.str('Text_ID'))||f.name),{top:colors[label.i]}),glyphs=document.createElement('canvas');glyphs.width=image.width;glyphs.height=image.height;glyphs.getContext('2d').putImageData(new ImageData(image.pixels,image.width,image.height),0,0);ctx.drawImage(glyphs,0,0);}else ctx.fillText(db.t(f.str('Text_ID'))||f.name,0,0);ctx.restore();
  }
  return canvas;
}
export async function renderHistory(owner,d) {
  const prepare=async()=>{
    const bitmap=await loadNativeFont('EmpireAtWar-Bold',dialogFontPixels(innerHeight,24));
    await bitmap?.ensure(historyChart(owner.game.galaxy,owner.historyMetric)?.series.map(series=>{const faction=db.faction(series.player.faction);return db.t(faction.str('Text_ID'))||faction.name;}).join('')||'');
  };
  await prepare();
  if(owner.dialog!==d)return;
  const refresh=()=>{
    const metric=owner.historyMetric,chart=historyChart(owner.game.galaxy,metric);
    const captions={economy:'TEXT_AXIS_ECONOMY',military:'TEXT_AXIS_MILITARY',planets:'TEXT_AXIS_PLANETS',tech:'TEXT_AXIS_TECH_LEVEL'};
    d.setText('IDC_Y_CAPTION',db.t(captions[metric]));
    if(!chart){d.setImage('IDC_DATA_CHART_IMAGE','');for(const id of ['IDC_STATIC_START','IDC_STATIC_MIDDLE','IDC_STATIC_END','IDC_Y_MIN','IDC_Y_MAX'])d.setText(id,'');return;}
    d.setImage('IDC_DATA_CHART_IMAGE',drawHistory(chart,owner.game).toDataURL());d.imageFrame('IDC_DATA_CHART_IMAGE',false);
    d.setText('IDC_STATIC_START','0');d.setText('IDC_STATIC_MIDDLE',String(Math.trunc(chart.cycles/2)));d.setText('IDC_STATIC_END',String(chart.cycles));
    d.setText('IDC_Y_MIN',metric==='military'?'0%':'0');d.setText('IDC_Y_MAX',metric==='military'?'100%':String(Math.trunc(chart.maximum)));
  };
  const kinds={IDC_RADIO_ECONOMY:'economy',IDC_RADIO_MILITARY:'military',IDC_RADIO_PLANETS:'planets',IDC_RADIO_TECH:'tech'};
  d.radios(Object.keys(kinds),Object.keys(kinds).find(id=>kinds[id]===owner.historyMetric),id=>{owner.state.metric=owner.historyMetric=kinds[id];refresh();});refresh();
  let generation=0;
  const resize=async()=>{const version=++generation;await prepare();if(version===generation&&owner.dialog===d)refresh();};
  addEventListener('resize',resize);
  const unsubscribe=d.onLanguageRefresh(resize);
  return ()=>{generation++;unsubscribe();removeEventListener('resize',resize);};
}
