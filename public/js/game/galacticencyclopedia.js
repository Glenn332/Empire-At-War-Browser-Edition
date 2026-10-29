import { db } from '../gamedata.js';
import { fontFamily } from '../fonts.js';
import { componentFont, loadComponentFont, paintNativeText } from '../nativefont.js';
import { iconUrl,iconCanvasRect } from '../icons.js';
import { loadTextureCanvas } from '../dds.js';
import { uiBoneTransforms } from './hud.js';
import { dialogFontPixels, uiTextHeight } from './dialogtext.js';
import { encyclopediaAbilityIcons } from './nativeabilityicons.js';

const yes=s=>/^(yes|true|1)$/i.test(s||'');
const pair=(c,k,fallback)=>c?.val(k)?c.val(k).split(/[\s,]+/).map(Number):fallback;
const token=(c,k)=>c?.val(k).trim().split(/\s+/)[0]||'';
const color=a=>`rgba(${a.slice(0,3).join(',')},${(a[3]??255)/255})`;

export function encyclopediaLines(text,count) {
  const out=[];if(text.length>1024)return out;const limit=Math.max(1,Math.trunc(count)-1);let line=String(text);
  while(line.length>limit){let end=line.lastIndexOf(' ',limit-1);if(end<=0)end=limit;out.push(line.slice(0,end));line=line.slice(end+(line[end]===' '?1:0));}
  if(line)out.push(line);
  return out;
}

export class GalacticEncyclopedia {
  constructor(game,data) {
    this.game=game;this.comps=data.comps;this.rows=[];this.droid=false;this.images=new Map();this.pending=new Map();this.generation=0;this.linkedGeneration=0;
    const index=data.model.bones.findIndex(b=>b.name.toUpperCase()==='TEXT_GALACTIC_HELP'),matrix=uiBoneTransforms(data.model)[index];
    this.anchor=matrix?[matrix[3],matrix[7]]:[0,0];
    this.root=document.createElement('div');this.root.className='galactic-encyclopedia';this.root.hidden=true;
    this.root.setAttribute('role','tooltip');this.root.style.cssText='position:fixed;pointer-events:none;z-index:61;transform-origin:0 0';
    this.linkedRoot=document.createElement('div');this.linkedRoot.hidden=true;this.linkedRoot.setAttribute('role','tooltip');this.linkedRoot.style.cssText='position:fixed;pointer-events:none;z-index:62';this.linkedTimer=null;
    document.body.append(this.root,this.linkedRoot);this.onResize=()=>{this.hideLinked();if(!this.root.hidden)this.paint();};addEventListener('resize',this.onResize);
  }
  component(name){return this.comps.get(name.toUpperCase());}
  sprite(name){return name&&(this.images.get(name.toUpperCase())||iconCanvasRect(name));}
  async warm(names) {
    await Promise.all(names.filter(Boolean).map(name=>{
      const key=name.toUpperCase();if(this.images.has(key)||iconCanvasRect(name))return;
      if(!this.pending.has(key))this.pending.set(key,loadTextureCanvas(name).then(canvas=>{this.images.set(key,canvas?{w:canvas.width,h:canvas.height,url:canvas.toDataURL(),canvas}:null);}).catch(()=>this.images.set(key,null)));
      return this.pending.get(key);
    }));
  }
  frameNames(kind){const c=this.component(kind);return [token(c,'Blank_Texture_Name'),...(c?.val('Icon_Alternate_Texture_Name').split(/\s+/)||[])];}
  image(name,x=0,y=0,{end=false,exclude=false,scale=1,tint=null}={}) {
    const r=this.sprite(name);if(!r)return null;
    return {image:name,x,y,w:r.w*scale,h:r.h*scale,end,exclude,tint};
  }
  text(text,kind='ENCYCLOPEDIA_TEXT',{x=0,y=0,end=true,tint=null,extra=0,align=null}={}) {
    const c=this.component(kind),size=pair(c,'Size',[41,14]),lines=encyclopediaLines(text,size[0]+extra);
    return lines.map((text,i)=>({text,kind,x,y,w:0,h:size[1],end:i<lines.length-1||end,tint,align}));
  }
  headerX(x){return x-pair(this.component('ENCYCLOPEDIA_BACK'),'Offset',[5,2])[0];}
  population(pop) {
    return this.text(String(Math.abs(pop)),this.component('ENCYCLOPEDIA_CENTER_TEXT')?'ENCYCLOPEDIA_CENTER_TEXT':'ENCYCLOPEDIA_HEADER_TEXT',{x:this.headerX(db.constants.num('Encyclopedia_Population_Offset',11)),end:false,tint:pop>0?[0,255,0,255]:[255,215,56,255]});
  }
  async showType(type,droid=true) {
    this.type=type;
    const generation=++this.generation;
    await this.warm([...this.frameNames('ENCYCLOPEDIA_BACK'),'e_topbar.tga','e_topbar2.tga','e_line.tga','e_line2.tga','e_against_frame.tga',type.str('Icon_Name'),...encyclopediaAbilityIcons(type),...['Encyclopedia_Good_Against','Encyclopedia_Vulnerable_To'].flatMap(k=>type.list(k).map(n=>db.type(n)?.str('Icon_Name')))]);
    if(generation!==this.generation)return;
    const C=db.constants,back=this.component('ENCYCLOPEDIA_BACK'),width=pair(back,'Size',[262,14])[0],padding=pair(back,'Offset',[5,2])[0];
    const pop=type.num('Population_Value',0)>0?-type.num('Population_Value'):type.num('Additional_Population_Capacity',0),shift=pop?0:-11,items=[];
    items.push(this.image(pop?'e_topbar.tga':'e_topbar2.tga',width/2-padding));
    if(pop)items.push(...this.population(pop));
    items.push(this.image(type.str('Icon_Name'),C.num('Encyclopedia_Icon_X_Offset',39)+shift-padding,C.num('Encyclopedia_Icon_Y_Offset',-12),{exclude:true}));
    items.push(...this.text(db.t(type.str('Text_ID'))||type.name,'ENCYCLOPEDIA_HEADER_TEXT',{x:this.headerX(C.num('Encyclopedia_Name_Offset',68)+shift),extra:8}));
    items.push(...this.text(db.t(type.str('Encyclopedia_Unit_Class')),'ENCYCLOPEDIA_TEXT',{x:C.num('Encyclopedia_Name_Offset',68)+shift,y:C.num('Encyclopedia_Class_Y_Offset',5),end:false}));
    let cursor=Math.trunc(width-padding);
    for(const name of encyclopediaAbilityIcons(type)){const image=this.image(name);if(image){const half=Math.trunc(image.w/2);image.x=cursor-half;cursor-=2*half;items.push(image);}}
    items.push(this.image('e_line.tga',width/2-padding,0,{end:true}));
    for(const id of [...type.list('Encyclopedia_Text'),...type.list('Hero_Ability')])items.push(...this.text(db.t(id)));
    const groups=[type.list('Encyclopedia_Good_Against'),type.list('Encyclopedia_Vulnerable_To')];
    if(groups.some(g=>g.length)){
      items.push(this.image('e_line2.tga',Math.trunc(width/2-padding)-padding,0,{end:true}));
      const frame=this.sprite('e_against_frame.tga');
      if(frame){const step=Math.trunc(frame.w/3),half=Math.trunc(step/2),tints=[[0,192,0,255],[192,0,0,255]];
        for(let side=0;side<2;side++){
          const x=side?frame.w+4:0;
          items.push(this.image('e_against_frame.tga',x+Math.trunc(frame.w/2)-padding,0,{tint:tints[side]}));
          items.push(...this.text(db.t(side?'TEXT_VULNERABLE_TO':'TEXT_GOOD_AGAINST'),'ENCYCLOPEDIA_TEXT',{x:side*3*step+side*4-padding,y:27,end:false,tint:tints[side]}));
          for(let i=0;i<3;i++){const icon=this.image(db.type(groups[side][i])?.str('Icon_Name'),(side*3+i)*step+side*4+half-padding);
            if(icon)items.push(icon);}
        }
        items.push({text:'',kind:'ENCYCLOPEDIA_TEXT',x:0,y:0,h:0,end:true});
      }
    }
    this.show(items,droid);this.root.setAttribute('aria-label',db.t(type.str('Text_ID'))||type.name);
  }
  async showItem(item) {
    const generation=++this.generation,units=item.units.map(n=>db.type(n)).filter(Boolean).slice(0,3);
    await this.warm(['e_topbar2.tga','e_line.tga','e_line2.tga','e_against_frame.tga',item.icon,...units.map(t=>t.str('Icon_Name'))]);
    if(generation!==this.generation)return;
    const C=db.constants,back=this.component('ENCYCLOPEDIA_BACK'),width=pair(back,'Size',[262,14])[0],padding=pair(back,'Offset',[5,2])[0],shift=-11,items=[];
    items.push(this.image('e_topbar2.tga',width/2-padding));
    items.push(this.image(item.icon,C.num('Encyclopedia_Icon_X_Offset',39)+shift-padding,C.num('Encyclopedia_Icon_Y_Offset',-12),{exclude:true}));
    items.push(...this.text(db.t(item.title)||item.name,'ENCYCLOPEDIA_HEADER_TEXT',{x:this.headerX(C.num('Encyclopedia_Name_Offset',68)+shift),extra:8}));
    items.push(this.image('e_line.tga',width/2-padding,0,{end:true}));
    items.push(...this.text(db.t(item.description)));
    if(units.length){
      items.push(this.image('e_line2.tga',Math.trunc(width/2-padding)-padding,0,{end:true}));
      const frame=this.sprite('e_against_frame.tga');
      if(frame){const step=Math.trunc(frame.w/3),half=Math.trunc(step/2);
        items.push(this.image('e_against_frame.tga',Math.trunc(frame.w/2)-padding,0));
        units.forEach((t,i)=>{const icon=this.image(t.str('Icon_Name'),i*step+half-padding);if(icon)items.push(icon);});
        items.push({text:'',kind:'ENCYCLOPEDIA_TEXT',x:0,y:0,h:0,end:true});
      }
    }
    this.show(items,false);this.root.setAttribute('aria-label',db.t(item.title)||item.name);
  }
  async showFleet(data) {
    this.type=null;this.shown='fleet:'+data.key;
    const generation=++this.generation,name='FLEETSTACK|'+data.key;
    this.images.set(name.toUpperCase(),{w:data.picture.width,h:data.picture.height,url:data.picture.toDataURL(),canvas:data.picture});
    const marks=(this.component('ICON_FLEET01')?.val('Icon_Alternate_Texture_Name')||'').trim().split(/\s+/).filter(Boolean);
    await this.warm([...this.frameNames('ENCYCLOPEDIA_BACK'),'e_topbar.tga','e_topbar2.tga','e_line.tga','i_icon_stealth.tga','i_button_temporary.tga','i_button_unknown.tga',...marks,...data.cells.map(c=>c.icon)]);
    if(generation!==this.generation)return;
    const C=db.constants,back=this.component('ENCYCLOPEDIA_BACK'),width=pair(back,'Size',[262,14])[0],padding=pair(back,'Offset',[5,2])[0],shift=data.pop>0?0:-11,items=[];
    items.push(this.image(data.pop>0?'e_topbar.tga':'e_topbar2.tga',width/2-padding));
    if(data.pop>0)items.push(...this.text(String(data.pop),this.component('ENCYCLOPEDIA_CENTER_TEXT')?'ENCYCLOPEDIA_CENTER_TEXT':'ENCYCLOPEDIA_HEADER_TEXT',{x:this.headerX(C.num('Encyclopedia_Population_Offset',11)),end:false,tint:[255,215,56,255]}));
    items.push(this.image(name,C.num('Encyclopedia_Icon_X_Offset',39)+shift-padding,C.num('Encyclopedia_Icon_Y_Offset',-12),{exclude:true}));
    items.push(...this.text(data.title,'ENCYCLOPEDIA_HEADER_TEXT',{x:this.headerX(C.num('Encyclopedia_Name_Offset',68)+shift),extra:8}));
    let cursor=Math.trunc(width-padding);
    for(const [flag,index] of [[data.stealth,0],[data.raid,1]])if(flag){const image=this.image(marks[index]);if(image){const half=Math.trunc(image.w/2);image.x=cursor-half;cursor-=2*half;items.push(image);}}
    items.push(this.image('e_line.tga',width/2-padding,0,{end:true}));
    if(data.body)items.push(...this.text(data.body));
    const step=Math.trunc((width-2*padding)/6);
    for(let i=0;i<data.cells.length;i++){
      const cell=data.cells[i],x=(i%6)*step+Math.trunc(step/2),last=i%6===5||i===data.cells.length-1;
      const icon=this.image(cell.icon,x);if(icon)items.push(icon);
      if(cell.badge){const badge=this.image('i_icon_stealth.tga',x,0,{exclude:true});if(badge)items.push(badge);}
      if(cell.label)items.push(...this.text(cell.label,'ENCYCLOPEDIA_TEXT',{x:x+Math.trunc(step/2)-14,y:-(icon?.h??step)/2+8,end:false}));
      if(last)items.push({text:'',kind:'ENCYCLOPEDIA_TEXT',x:0,y:0,h:0,end:true});
    }
    this.show(items,false);this.root.setAttribute('aria-label',data.title);
  }
  async showPlanet(data) {
    this.type=null;this.shown='planet:'+data.state;
    const generation=++this.generation,bars=['i_bar_icons_space.tga','i_bar_icons_land.tga'];
    await this.warm([...this.frameNames('ENCYCLOPEDIA_BACK'),'e_topbar.tga','e_topbar2.tga','e_line.tga','e_line2.tga',...bars]);
    if(generation!==this.generation)return;
    const C=db.constants,back=this.component('ENCYCLOPEDIA_BACK'),width=pair(back,'Size',[262,14])[0],padding=pair(back,'Offset',[5,2])[0],items=[];
    const pop=data.type.num('Additional_Population_Capacity',0),shift=pop?0:-11,rgb=data.color.map(c=>Math.round(c*255));
    items.push(this.image(pop?'e_topbar.tga':'e_topbar2.tga',width/2-padding));
    if(pop)items.push(...this.population(pop));
    items.push(...this.text(data.name,'ENCYCLOPEDIA_HEADER_TEXT',{x:this.headerX(C.num('Encyclopedia_Name_Offset',68)+shift),extra:8}));
    if(data.corruption)items.push(...this.text(data.corruption.text,'ENCYCLOPEDIA_TEXT',{x:C.num('Encyclopedia_Name_Offset',68)+shift,y:C.num('Encyclopedia_Class_Y_Offset',5),end:false,tint:[...data.corruption.color.map(c=>Math.round(c*255)),255]}));
    items.push(this.image('e_line.tga',width/2-padding,0,{end:true}));
    for(const id of data.destroyed?['TEXT_ENCYCLOPEDIA_PLANET_DESTROYED']:data.type.list('Encyclopedia_Text'))items.push(...this.text(db.t(id)));
    items.push(this.image('e_line2.tga',Math.trunc(width/2-padding)-padding,0,{end:true}));
    bars.forEach((name,row)=>{
      const icon=this.sprite(name),[have,max]=row?data.land:data.space;if(!icon||!max)return;
      for(let i=0;i<max;i++)items.push(this.image(name,i*icon.w+Math.trunc(icon.w/2)-padding,0,{end:i===max-1,tint:i<have?[...rgb,255]:[...rgb.map(c=>c>>1),255]}));
    });
    this.show(items,false);this.root.setAttribute('aria-label',data.name);
  }
  async showIncome(data) {
    this.type=null;this.shown='income:'+data.key;
    const generation=++this.generation;
    await this.warm([...this.frameNames('ENCYCLOPEDIA_BACK'),'e_topbar2.tga','e_line.tga']);
    if(generation!==this.generation)return;
    const C=db.constants,back=this.component('ENCYCLOPEDIA_BACK'),width=pair(back,'Size',[262,14])[0],padding=pair(back,'Offset',[5,2])[0],items=[],right=width-2*padding;
    const signed=v=>(v>=0?'+':'')+Math.round(v);
    items.push(this.image('e_topbar2.tga',width/2-padding));
    items.push(...this.text(data.title,'ENCYCLOPEDIA_HEADER_TEXT',{x:this.headerX(C.num('Encyclopedia_Population_Offset',11)),extra:8,end:data.cost===undefined}));
    if(data.cost!==undefined)items.push(...this.text('$ '+Math.round(data.cost),'ENCYCLOPEDIA_COST_TEXT',{x:this.headerX(C.num('Encyclopedia_Cost_Offset',250))}));
    items.push(this.image('e_line.tga',width/2-padding,0,{end:true}));
    let total=0;
    const row=(label,value,tint=null)=>{items.push(...this.text(label,'ENCYCLOPEDIA_TEXT',{end:false,tint}),...this.text(signed(value),'ENCYCLOPEDIA_RIGHT_TEXT',{x:right,tint}));total+=value;};
    for(const r of data.rows)row(db.t(r.label)||r.label,r.value,r.tint?[...r.tint.map(c=>Math.round(c*255)),255]:null);
    if(data.corruption)row(db.t('TEXT_ENCYCLOPEDIA_PLANET_CORRUPTION_INCOME'),data.corruption.value,[...data.corruption.color.map(c=>Math.round(c*255)),255]);
    items.push(...this.text(' '));
    row(db.t(data.total||'TEXT_ECONOMY_TOTAL_INCOME'),0);items.at(-1).text=signed(total);
    this.show(items,false);this.root.setAttribute('aria-label',data.title);
  }
  async showTech(faction,level) {
    return this.showInfo(`${db.faction(faction)?.str('Tech_Level_Icon_Name')||''}${level}.tga`,`${db.t('TEXT_TECH')} ${level}`,db.t(`${String(faction).toUpperCase()}_BM_TECH_${level}`));
  }
  async showInfo(icon,title,body) {
    const generation=++this.generation;
    await this.warm(['e_topbar2.tga','e_line.tga',icon]);
    if(generation!==this.generation)return;
    const C=db.constants,back=this.component('ENCYCLOPEDIA_BACK'),width=pair(back,'Size',[262,14])[0],padding=pair(back,'Offset',[5,2])[0],shift=-11,items=[];
    items.push(this.image('e_topbar2.tga',width/2-padding));
    items.push(this.image(icon,C.num('Encyclopedia_Icon_X_Offset',39)+shift-padding,C.num('Encyclopedia_Icon_Y_Offset',-12),{exclude:true}));
    items.push(...this.text(title,'ENCYCLOPEDIA_HEADER_TEXT',{x:this.headerX(C.num('Encyclopedia_Name_Offset',68)+shift),extra:8}));
    items.push(this.image('e_line.tga',width/2-padding,0,{end:true}));
    items.push(...this.text(body));
    this.show(items,false);this.root.setAttribute('aria-label',title);
  }
  async message(text,tint) {this.type=null;this.shown=null;const generation=++this.generation;await this.warm(this.frameNames('ENCYCLOPEDIA_BACK'));if(generation!==this.generation)return;this.show(this.text(text,this.component('TEXT_GALACTIC_HELP')?'TEXT_GALACTIC_HELP':'ENCYCLOPEDIA_TEXT',{tint,align:'left'}),false);this.root.setAttribute('aria-label',text);}
  async refreshLanguage() {
    if(!this.linkedRoot.hidden||this.linkedBuilding)await this.paintLinked(++this.linkedGeneration);
    if(this.root.hidden)return;
    if(this.type)await this.showType(this.type,this.droid);else this.paint();
  }
  linked(text,x,y) {
    this.hideLinked();this.linkedSource=text;this.linkedPoint={x,y};this.linkedTimer=setTimeout(()=>{
      this.linkedTimer=null;this.paintLinked(this.linkedGeneration);
    },db.constants.num('Tooltip_Delay',330));
  }
  async paintLinked(generation) {
      this.linkedBuilding=true;
      await this.warm(this.frameNames('TOOLTIP_BACK'));if(generation!==this.linkedGeneration)return;
      const {x,y}=this.linkedPoint,text=typeof this.linkedSource==='function'?this.linkedSource():this.linkedSource;
      const c=this.component('TOOLTIP_LEFT_TEXT'),back=this.component('TOOLTIP_BACK'),ctx=document.createElement('canvas').getContext('2d'),baseSize=dialogFontPixels(uiTextHeight(),c?.num('Font_Point_Size',7)||7),textScale=c?.num('Scale',1)??1,size=baseSize*textScale,face=c?.val('Font_Name')||'Arial';
      const bitmap=await loadComponentFont(face,baseSize);await bitmap?.ensure(text);if(generation!==this.linkedGeneration)return;
      const font=`${/bold/i.test(face)?'bold ':''}${size}px ${fontFamily(face)}`;ctx.font=font;ctx.fontKerning='none';
      const lines=text.split('\n').flatMap(s=>encyclopediaLines(s,pair(c,'Size',[60,20])[0])),metric=ctx.measureText('Mg'),pitch=bitmap?bitmap.height*textScale:Math.ceil((metric.fontBoundingBoxAscent||size)+(metric.fontBoundingBoxDescent||0)),width=Math.ceil(Math.max(0,...lines.map(s=>bitmap?bitmap.measure(s)*textScale:ctx.measureText(s).width)))+4,height=lines.length*(pitch+2)+2,scale=this.game.overlayScale();
      const w=width+2,h=height+2,marginX=8192/innerWidth*scale,marginY=18432/innerHeight*scale;
      let left=x+marginX,top=y+marginY;if(left+w>=innerWidth)left=x-marginX-w;if(top+h>=innerHeight)top=y-h;
      const root=this.linkedRoot;root.replaceChildren();Object.assign(root.style,{left:left+'px',top:top+'px',width:w+'px',height:h+'px'});
      for(const [name,inset]of [[back?.val('Icon_Alternate_Texture_Name').split(/\s+/)[0],0],[token(back,'Blank_Texture_Name'),1]]){
        const src=this.sprite(name)?.url||iconUrl(name);if(!src)continue;const image=document.createElement('img');image.src=src;image.alt='';image.style.cssText=`position:absolute;inset:${inset}px;width:${w-inset*2}px;height:${h-inset*2}px`;root.appendChild(image);
      }
      for(const[i,line]of lines.entries()){const span=document.createElement('span');span.textContent=line;span.style.cssText=`position:absolute;left:3px;top:${3+i*(pitch+2)}px;white-space:pre;font:${font};font-kerning:none;line-height:${pitch}px;color:${color(pair(c,'Text_Color',[255,255,255,255]))}`;root.appendChild(span);if(bitmap)paintNativeText(span,line,bitmap,{scaleX:1/textScale,scaleY:1/textScale,top:pair(c,'Text_Color',[255,255,255,255]),outline:yes(c?.val('Text_Outline'))});}
      root.hidden=false;this.linkedBuilding=false;
  }
  moveLinked(x,y){if(this.linkedTimer||this.linkedBuilding)this.linkedPoint={x,y};}
  hideLinked(){this.linkedGeneration++;clearTimeout(this.linkedTimer);this.linkedTimer=null;this.linkedBuilding=false;if(!this.linkedRoot.hidden)this.linkedRoot.hidden=true;}
  show(items,droid) {
    this.rows=[];let row=[];
    for(const item of items.filter(Boolean)){row.push(item);if(item.end){this.rows.push(row);row=[];}}
    if(row.length)this.rows.push(row);this.droid=droid;this.root.hidden=false;this.paint();
  }
  art(name,x,y,w,h,tint=[255,255,255,255],additive=false) {
    const sprite=this.sprite(name);let src=sprite?.url||iconUrl(name);
    if(tint.slice(0,3).some(v=>v!==255)){
      const tinted=this.game.tinted(name,tint.slice(0,3).map(v=>v/255));if(tinted)src=tinted.toDataURL();
      else if(sprite?.canvas){const canvas=document.createElement('canvas');canvas.width=sprite.w;canvas.height=sprite.h;const ctx=canvas.getContext('2d');ctx.drawImage(sprite.canvas,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<pixels.data.length;i+=4)for(let c=0;c<3;c++)pixels.data[i+c]*=tint[c]/255;ctx.putImageData(pixels,0,0);src=canvas.toDataURL();}
    }
    if(!src)return;
    const el=document.createElement('img');el.src=src;el.alt='';el.style.cssText=`position:absolute;left:${x-w/2}px;top:${-y-h/2}px;width:${w}px;height:${h}px;opacity:${(tint[3]??255)/255};mix-blend-mode:${additive?'plus-lighter':'normal'}`;this.root.appendChild(el);
  }
  paint() {
    const screenHeight=uiTextHeight(),missing=new Map();
    for(const row of this.rows)for(const item of row)if(!item.image){const c=this.component(item.kind),face=token(c,'Font_Name')||'Arial',pixels=dialogFontPixels(screenHeight,c?.num('Font_Point_Size',7)||7);if(!componentFont(face,pixels))missing.set(face+'~'+pixels,loadComponentFont(face,pixels));}
    if(missing.size)Promise.all(missing.values()).then(fonts=>{if(fonts.some(Boolean)&&uiTextHeight()===screenHeight&&!this.root.hidden)this.paint();});
    this.root.replaceChildren();const scale=this.game.overlayScale(),back=this.component('ENCYCLOPEDIA_BACK'),W=pair(back,'Size',[262,14])[0],P=pair(back,'Offset',[5,2]),D=pair(back,'Default_Offset',[0,0]),C=this.droid?db.constants.vec('Droid_Encyclopedia_Offset',[0,0]):[0,0];
    const heights=this.rows.map(row=>Math.max(0,...row.filter(r=>!r.exclude).map(r=>r.h))),height=heights.reduce((a,b)=>a+b,0)+P[1];
    const anchor=this.anchorFn?.()||this.anchor,x=anchor[0]+D[0]+W/2+C[0],y=anchor[1]+D[1]+C[1],alternates=back?.val('Icon_Alternate_Texture_Name').split(/[\s,]+/).filter(Boolean)||[];
    this.art(alternates[1],x,y+height/2,W+16/scale,height+16/scale,[128,128,128,128],yes(back?.val('Lower_Effect_Additive')));
    this.art(alternates[0],x,y+height/2,W+2/scale,height+2/scale);
    this.art(token(back,'Blank_Texture_Name'),x,y+height/2,W,height);
    const left=x-W/2+P[0];let top=y+height;
    for(let i=0;i<this.rows.length;i++){
      const center=top-heights[i]/2;top-=heights[i];
      for(const item of this.rows[i]){
        const ix=left+item.x,iy=center+item.y;
        if(item.image){this.art(item.image,ix,iy,item.w,item.h,item.tint||undefined);continue;}
        const c=this.component(item.kind),text=document.createElement('span'),font=dialogFontPixels(uiTextHeight(),c?.num('Font_Point_Size',7)||7)*(c?.num('Scale',1)??1)/scale,tint=item.tint||pair(c,'Text_Color',[192,192,192,200]);
        const face=token(c,'Font_Name')||'Arial';
        const shiftX=item.align==='left'||!item.align&&(yes(c?.val('Left_Justified'))||!c)?'0':item.align==='right'?'-100%':item.align==='center'?'-50%':yes(c?.val('Right_Justified'))?'-100%':'-50%';
        text.textContent=item.text;text.style.cssText=`position:absolute;left:${ix}px;top:${-iy}px;white-space:pre;line-height:1;transform:translate(${shiftX},-50%);font:${/bold/i.test(c?.val('Font_Name')||'')?'bold ':''}${font}px ${fontFamily(face)};color:${color(tint)}`;
        const bitmap=componentFont(c?.val('Font_Name')||'Arial',dialogFontPixels(uiTextHeight(),c?.num('Font_Point_Size',7)||7));
        if(bitmap){if(!bitmap.has(item.text))bitmap.ensure(item.text).then(()=>{if(!this.root.hidden)this.paint();});paintNativeText(text,item.text,bitmap,{scaleX:scale/(c?.num('Scale',1)??1),scaleY:scale/(c?.num('Scale',1)??1),top:tint,outline:yes(c?.val('Text_Outline'))});}
        else if(yes(c?.val('Text_Outline')))text.style.filter=`url(#${this.game.scriptUI.outline(c.num('Scale',1))})`;
        this.root.appendChild(text);
      }
    }
    Object.assign(this.root.style,{left:'0px',top:innerHeight+'px',transform:`scale(${scale})`});
  }
  hide(){this.shown=null;this.generation++;if(!this.root.hidden)this.root.hidden=true;if(this.rows.length)this.rows=[];this.hideLinked();}
  dispose(){this.hide();removeEventListener('resize',this.onResize);this.root.remove();this.linkedRoot.remove();}
}
