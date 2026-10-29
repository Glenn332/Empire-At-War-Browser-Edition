import assert from 'node:assert/strict';
import {parseXML} from '../public/js/xml.js';
import {setComponentText} from '../public/js/game/componenttext.js';
import {loadComponentFont,loadNativeFont,snapNativeText} from '../public/js/nativefont.js';

class Element {
  constructor(){this.children=[];this.style={};this.dataset={};this.attrs={};this.isConnected=true;}
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k];}
  set textContent(text){this.children=[];this.text=String(text);}
  replaceChildren(...nodes){this.children=nodes;}
  appendChild(node){this.children.push(node);}
  getContext(){return {putImageData(){}};}
  querySelectorAll(){return this.children;}
  getBoundingClientRect(){const s=getComputedStyle(this);return {x:10.25+(+this.dataset.snapX||0)*2,y:20.75+(+this.dataset.snapY||0)*2,width:+s.width*2*(+this.dataset.correctX||1),height:+s.height*2*(+this.dataset.correctY||1)};}
}
globalThis.document={createElement:()=>new Element()};
globalThis.ImageData=class{};globalThis.innerHeight=600;let frame;
globalThis.requestAnimationFrame=fn=>{frame=fn;return 1;};
globalThis.getComputedStyle=el=>Object.fromEntries(['width','height'].map(k=>[k,String(Math.floor(parseFloat(new RegExp(k+':([^;]+)').exec(el.style.cssText)[1])*64)/64)]));
const requests=[];
globalThis.fetch=async input=>{
  const path=decodeURIComponent(String(input));requests.push(path);const height=+path.split('~')[1];
  const advance=({13:9,12:8,10:7,9:6,8:5})[height]||4,glyphHeight=height+4;
  return new Response(JSON.stringify({height:glyphHeight,ascent:height,face:'Arial',widths:Array(256).fill(advance),offsets:Array.from({length:256},(_,i)=>i*advance*glyphHeight),mask:Buffer.alloc(256*advance*glyphHeight).toString('base64')}));
};
const component=xml=>parseXML(`<C>${xml}</C>`).children[0],settle=async el=>{for(let i=0;i<100&&!el._componentText?.font;i++)await new Promise(r=>setImmediate(r));assert(el._componentText?.font,'Native glyph loading completed');};
const c=component('<Type>TextButton</Type><Font_Name>Arial</Font_Name><Font_Point_Size>10</Font_Point_Size><Text_Outline>True</Text_Outline><Max_Text_Width>12</Max_Text_Width><Left_Justified>True</Left_Justified>');
const el=new Element();setComponentText(el,c,'AAA',{scale:2});await settle(el);
assert.equal(el._componentText.point,9,'Exact raw advance width fits; outline pixels do not force a smaller point size');
assert.equal(el.children[0].width,26,'Even 24-pixel advance plus two native outline pixels');
assert.equal(el.style.transform,'translate(0,-50%)','Left TextButton alignment uses actual raster width, not Max_Text_Width');
const atlases=requests.filter(p=>p.includes('Data/Fonts/Raster/'));
assert(atlases.length&&atlases.every(p=>p.includes('~b1.json')),'Components request native bold700 atlases');
const before=el.children[0];setComponentText(el,c,'AAA',{scale:2});assert.strictEqual(el.children[0],before,'Unchanged labels retain their cached canvas');
frame();const once=before.style.translate;snapNativeText(el);frame();assert.equal(before.style.translate,once,'Repeated pixel snapping is idempotent');
setComponentText(el,c,'BB',{scale:2});await settle(el);assert.equal(el._componentText.point,10,'New shorter text restores the authored size');
const floor=component('<Font_Name>Arial</Font_Name><Font_Point_Size>10</Font_Point_Size><Max_Text_Width>1</Max_Text_Width>');
setComponentText(el,floor,'AAA',{scale:2});await settle(el);assert.equal(el._componentText.point,6,'Native fit stops at point6 even when the text still overflows');
const scaled=component('<Type>Text</Type><Font_Name>Arial</Font_Name><Font_Point_Size>9</Font_Point_Size><Scale>0.25</Scale><Left_Justified>True</Left_Justified><Text_Emboss>True</Text_Emboss>');
setComponentText(el,scaled,'AAA',{scale:2});await settle(el);assert.equal(el.style.transform,'translate(calc(-50% + 12px),-50%)','TextComponent retains native integer physical half-width alignment');
assert.equal(el.children[0].style.cssText.includes('width:3.125px'),true,'Component Scale affects glyph size independently of model offsets');
setComponentText(el,c,'stale',{scale:2});setComponentText(el,c,'',{scale:2});await new Promise(r=>setImmediate(r));assert.equal(el.children.length,0,'Cleared labels cannot be restored by an older font request');
const ordinary=await loadNativeFont('Arial',12),bold=await loadComponentFont('Arial',12);assert.notStrictEqual(ordinary,bold,'Resource dialogs and command-bar components do not alias font caches');
innerHeight=768;setComponentText(el,c,'A',{scale:1});await settle(el);assert.equal(el._componentText.point,10);assert.equal(el.children[0].height,22,'Resolution changes request a new integer-height raster');
innerHeight=600;setComponentText(el,c,'A',{scale:1.7});await settle(el);snapNativeText(el);snapNativeText({isConnected:true,querySelectorAll:()=>el.children});frame();
const corrected=el.children[0];assert(+corrected.dataset.correctX>1,'Fractional CSS layout is corrected before native glyph compositing');
assert(Math.abs(corrected.getBoundingClientRect().width-12/1.7*2)<1e-9,'Correction retains the intended glyph dimensions through a fractional parent scale');
const translated=corrected.style.translate;snapNativeText(el);frame();assert.equal(corrected.style.translate,translated,'Overlapping dirty roots cannot snap a glyph twice');
console.log('Native component weight, exact-width point fitting, floor6, effects, alignment, cache reuse, resize and stale async text passed');
