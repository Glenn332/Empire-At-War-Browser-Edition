import { fetchBinary } from './vfs.js';
import { fontPolicy, fontPixels } from './fontpolicy.js';
import { onLanguageChange } from './language.js';
import { loadGameFonts, modFace, creditFont } from './fonts.js';

const fonts=new Map();
const readyFonts=new Map();
const glyphWork=new Set();
const track=p=>{glyphWork.add(p);p.then(()=>glyphWork.delete(p),()=>glyphWork.delete(p));return p;};
export async function settleNativeFonts(){while(glyphWork.size)await Promise.all([...glyphWork]);}
onLanguageChange(settleNativeFonts,3);
const keyOf=(face,height,stretch,bold,charset)=>JSON.stringify([face.toUpperCase(),Math.max(1,Math.round(height)),Math.fround(stretch),!!bold,charset]);
export function nativeFont(face,height,stretch=1,bold=false,charset) {
  const policy=fontPolicy(face);return readyFonts.get(keyOf(policy.face,height,stretch,bold,charset??policy.charset))||null;
}
const dirty=new Set();let snapFrame=0;
function queueSnap(el) {
  dirty.add(el);if(snapFrame)return;
  snapFrame=requestAnimationFrame(()=>{
    snapFrame=0;const items=new Map();
    for(const root of dirty)if(root.isConnected)for(const canvas of root.querySelectorAll('canvas[data-native-glyphs]'))if(!items.has(canvas)){
      const rect=canvas.getBoundingClientRect(),style=getComputedStyle(canvas),w=parseFloat(style.width),h=parseFloat(style.height);
      if(!rect.width||!rect.height)continue;
      const cx=canvas.width/+canvas.dataset.sx/w,cy=canvas.height/+canvas.dataset.sy/h;
      const sx=rect.width/w/(+canvas.dataset.correctX||1),sy=rect.height/h/(+canvas.dataset.correctY||1);
      items.set(canvas,{canvas,rect,sx,sy,cx,cy});
    }
    dirty.clear();for(const {canvas,rect,sx,sy,cx,cy} of items.values()){
      const x=rect.x-(+canvas.dataset.snapX||0)*sx,y=rect.y-(+canvas.dataset.snapY||0)*sy;
      const dx=(Math.floor(x+.5)-x)/sx,dy=(Math.floor(y+.5)-y)/sy;
      canvas.dataset.snapX=dx;canvas.dataset.snapY=dy;canvas.dataset.correctX=cx;canvas.dataset.correctY=cy;
      canvas.style.transformOrigin='0 0';canvas.style.transform=`scale(${cx},${cy})`;canvas.style.translate=`${dx}px ${dy}px`;
    }
  });
}
export const snapNativeText=queueSnap;
export const nativeFontPath=(face,height,stretch=1,page=0,bold=false,charset=0)=>`Data/Fonts/Raster/${encodeURIComponent(face)}~${height}~f${new Uint32Array(new Float32Array([stretch]).buffer)[0]}~${page}${bold?'~b1':''}${charset?'~c'+charset:''}.json`;
const emOf=(height,stretch)=>{const em=Math.fround(stretch)>=Math.fround(1.0001)||Math.fround(stretch)<=Math.fround(.9999)?Math.max(1,Math.floor(height*stretch+.5)):height;return {em,hx:height/em};};
function rasterPage(own,height,stretch,page,bold) {
  const {unitsPerEm,winAscent,winDescent,notdef}=own.info;
  const {em,hx}=emOf(height,stretch);
  const ascent=Math.ceil(winAscent*em/unitsPerEm)||Math.ceil(em*.8),cell=Math.max(1,ascent+(Math.ceil(winDescent*em/unitsPerEm)||Math.ceil(em*.2)));
  const canvas=new OffscreenCanvas(1,1),ctx=canvas.getContext('2d',{willReadFrequently:true}),font=`${bold?700:400} ${em}px ${JSON.stringify(own.name)}`;
  ctx.font=font;ctx.fontKerning='none';
  const chars=Array.from({length:256},(_,i)=>String.fromCharCode(page*256+i)),blank=i=>page===0&&(i<32||i===173);
  const widths=chars.map((c,i)=>blank(i)?Math.round(notdef*em/unitsPerEm*hx):page===0&&i>=128&&i<160?0:Math.max(0,Math.round(ctx.measureText(c).width*hx)));
  const box=Math.max(1,...widths);canvas.width=box*16;canvas.height=cell*16;
  ctx.font=font;ctx.fontKerning='none';ctx.textBaseline='alphabetic';ctx.fillStyle='#fff';
  chars.forEach((c,i)=>{const w=widths[i];if(!w||blank(i))return;const x=(i&15)*box,y=(i>>4)*cell;ctx.save();ctx.beginPath();ctx.rect(x,y,w,cell);ctx.clip();ctx.setTransform(hx,0,0,1,x,y+ascent);ctx.fillText(c,0,0);ctx.restore();});
  const image=ctx.getImageData(0,0,canvas.width,canvas.height).data,offsets=new Array(256);let total=0;
  for(let i=0;i<256;i++){offsets[i]=total;total+=widths[i]*cell;}
  const data=new Uint8Array(total);
  for(let i=0;i<256;i++){const w=widths[i],x0=(i&15)*box,y0=(i>>4)*cell;for(let y=0;y<cell;y++)for(let x=0;x<w;x++)data[offsets[i]+y*w+x]=image[((y0+y)*canvas.width+x0+x)*4+3];}
  return {height:cell,ascent,face:own.name,page,widths,offsets,data};
}
function withCredit(value,credit,height,stretch,bold) {
  const {em,hx}=emOf(height,stretch),cell=value.height,canvas=new OffscreenCanvas(1,1),ctx=canvas.getContext('2d',{willReadFrequently:true});
  const font=`${bold?700:400} ${em}px ${JSON.stringify(credit.name)}`;ctx.font=font;ctx.fontKerning='none';
  const w=Math.max(1,Math.round(ctx.measureText('$').width*hx));canvas.width=w;canvas.height=cell;
  ctx.font=font;ctx.fontKerning='none';ctx.textBaseline='alphabetic';ctx.fillStyle='#fff';ctx.setTransform(hx,0,0,1,0,value.ascent);ctx.fillText('$',0,0);
  const image=ctx.getImageData(0,0,w,cell).data,glyph=new Uint8Array(w*cell);for(let i=0;i<glyph.length;i++)glyph[i]=image[i*4+3];
  const widths=[...value.widths],offsets=new Array(256);widths[36]=w;let total=0;
  for(let i=0;i<256;i++){offsets[i]=total;total+=widths[i]*cell;}
  const data=new Uint8Array(total);
  for(let i=0;i<256;i++)data.set(i===36?glyph:value.data.subarray(value.offsets[i],value.offsets[i]+value.widths[i]*cell),offsets[i]);
  return {...value,widths,offsets,data};
}
const pagesOf=text=>[...new Set(Array.from({length:text.length},(_,i)=>text.charCodeAt(i)>>>8))];
export async function loadNativeFont(face,height,stretch=1,bold=false,charset) {
  const policy=fontPolicy(face);face=policy.face;charset??=policy.charset;
  height=Math.max(1,Math.round(height));const key=keyOf(face,height,stretch,bold,charset);
  if(!fonts.has(key))fonts.set(key,(async()=>{
    const pages=new Map(),pending=new Map();
    await loadGameFonts();const own=modFace(face),credit=creditFont(face);
    const page=async n=>{
      if(!pending.has(n))pending.set(n,track((async()=>{
        if(own){let value=rasterPage(own,height,stretch,n,bold);if(credit&&n===0)value=withCredit(value,credit,height,stretch,bold);pages.set(n,value);return value;}
        const bytes=await fetchBinary(nativeFontPath(face,height,stretch,n,bold,charset));if(!bytes){pages.set(n,null);return null;}
        const value=JSON.parse(new TextDecoder().decode(bytes));
        const encoded=Uint8Array.from(atob(value.mask),c=>c.charCodeAt(0));
        value.data=value.compression==='gzip'?new Uint8Array(await new Response(new Blob([encoded]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()):encoded;
        delete value.mask;const shown=credit&&n===0?withCredit(value,credit,height,stretch,bold):value;pages.set(n,shown);return shown;
      })()));return pending.get(n);
    };
    const metrics=await page(0);if(!metrics)return null;
    const font={height:metrics.height,ascent:metrics.ascent,face:metrics.face,pages,
      has:text=>pagesOf(String(text)).every(n=>pages.has(n)),
      ensure:text=>Promise.all(pagesOf(String(text)).map(page)),
      measure(text,padding=0){let width=0;for(let i=0;i<text.length;i++){const code=text.charCodeAt(i),p=pages.get(code>>>8);width+=((p||metrics).widths[p?code&255:63]||0)+padding;}return width;},
    };readyFonts.set(key,font);return font;
  })().catch(()=>null));return track(fonts.get(key));
}

export const componentFont=(face,height)=>nativeFont(face,height,1,true);
export const loadComponentFont=(face,height)=>loadNativeFont(face,height,1,true);

export async function prepareComponentFonts(components,screenHeight) {
  await Promise.all([...components.values()].filter(c=>c.val('Font_Name')).map(c=>loadNativeFont(c.val('Font_Name').trim(),fontPixels(screenHeight,c.num('Font_Point_Size',7)||7),1,true)));
}

export function nativeTextMask(font,text,padding=0) {
  const width=Math.max(2,Math.ceil(font.measure(text,padding)/2)*2),height=font.height,data=new Uint8Array(width*height);
  let cursor=0;
  for(let i=0;i<text.length;i++){
    const code=text.charCodeAt(i),found=font.pages.get(code>>>8),page=found||font.pages.get(0),index=found?code&255:63;
    const w=page.widths[index],offset=page.offsets[index];
    for(let y=0;y<height;y++)for(let x=0;x<w;x++)if(cursor+x>=0&&cursor+x<width)data[y*width+cursor+x]=page.data[offset+y*w+x];
    cursor+=w+padding;
  }
  return {width,height,data};
}

const rgba=value=>{
  if(Array.isArray(value))return value.length>=3?[value[0],value[1],value[2],value[3]??255]:[255,255,255,255];
  if(!value)return [255,255,255,255];
  if(value[0]==='#'){const h=value.slice(1);if(h.length===3)return [...h].map(c=>parseInt(c+c,16)).concat(255);return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).concat(h.length===8?parseInt(h.slice(6),16):255);}
  const n=value.match(/[\d.]+/g)?.map(Number)||[255,255,255,1];return [n[0],n[1],n[2],Math.round((n[3]??1)*255)];
};

export function nativeTextPixels(mask,{outline=false,emboss=false,top='#fff',bottom=top,screenHeight=768}={}) {
  const {width:w,height:h,data}=mask,dx=outline?1:0,dy=outline||emboss?1:0,width=w+(outline?2:emboss?1:0),height=h+(outline?2:emboss?1:0),pixels=new Uint8ClampedArray(width*height*4),shine=emboss&&!outline?new Uint8ClampedArray(width*height*4):null;
  const a=rgba(top),b=rgba(bottom),n=Math.trunc(Math.fround(screenHeight/600)+.5);
  if(outline){
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const m=data[y*w+x];if(!m)continue;for(let j=0;j<3;j++)for(let i=0;i<3;i++){const at=((y+j)*width+x+i)*4;pixels[at+3]=Math.max(pixels[at+3],m);}}
    for(let y=1;y<=h;y++)pixels[(y*width+w+1)*4+3]=data[(y-1)*w+w-1];
    for(let x=1;x<=w;x++)pixels[((h+1)*width+x)*4+3]=data[(h-1)*w+x-1];
    pixels[((h+1)*width+w+1)*4+3]=0;
  }
  else if(emboss)for(let y=0;y<h;y++)for(let x=0;x<w;x++){const m=data[y*w+x];if(m)pixels[(y*width+x)*4+3]=Math.trunc(m*.5);}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const m=data[y*w+x];if(!m)continue;const at=((y+dy)*width+x+dx)*4,t=(y+dy+.5)/height,alpha=(a[3]+(b[3]-a[3])*t)/255;
    for(let c=0;c<3;c++)pixels[at+c]=m*(a[c]+(b[c]-a[c])*t)/255;pixels[at+3]=m;
    if(shine){let min=255;if(y<h-n)for(let i=1;i<=n;i++)min=Math.min(min,data[(y+i)*w+x]);const q=Math.trunc(Math.fround((255-min)*.2509804));shine[at]=shine[at+1]=shine[at+2]=255;shine[at+3]=q*alpha;}
  }
  for(let y=0;y<height;y++){const alpha=(a[3]+(b[3]-a[3])*(y+.5)/height)/255;for(let x=0;x<width;x++)pixels[(y*width+x)*4+3]*=alpha;}
  return {width,height,pixels,shine};
}

export function paintNativeText(el,text,font,{scaleX=1,scaleY=scaleX,padding=0,...options}={}) {
  const version=(el._nativeTextVersion||0)+1;el._nativeTextVersion=version;
  el.setAttribute('aria-label',text);el.style.filter='';el.style.textShadow='';el.style.backgroundImage='none';
  const render=()=>{
    if(el._nativeTextVersion!==version)return;
    const bitmap=nativeTextPixels(nativeTextMask(font,String(text),padding),options);
    const make=data=>{const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.setAttribute('aria-hidden','true');canvas.dataset.nativeGlyphs='';canvas.dataset.sx=scaleX;canvas.dataset.sy=scaleY;canvas.getContext('2d').putImageData(new ImageData(data,bitmap.width,bitmap.height),0,0);canvas.style.cssText=`display:block;width:${bitmap.width/scaleX}px;height:${bitmap.height/scaleY}px;max-width:none;flex:none;pointer-events:none`;return canvas;};
    el.replaceChildren(make(bitmap.pixels));
    if(bitmap.shine){const shine=make(bitmap.shine);shine.style.position='absolute';shine.style.left='0';shine.style.top='0';shine.style.mixBlendMode='plus-lighter';el.appendChild(shine);}
    queueSnap(el);
  };
  render();if(pagesOf(String(text)).some(n=>!font.pages.has(n)))font.ensure(String(text)).then(render);
  return {width:Math.max(2,Math.ceil(font.measure(String(text),padding)/2)*2),height:font.height};
}
