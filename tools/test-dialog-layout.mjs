import assert from 'node:assert/strict';

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.parentNode=null;this.dataset={};this.attributes={};this.className='';this.hidden=false;this.style={setProperty(k,v){this[k]=v;}};
    Object.defineProperty(this.style,'cssText',{set(text){for(const pair of text.split(';')){const at=pair.indexOf(':');if(at>=0)this[pair.slice(0,at).trim().replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=pair.slice(at+1).trim();}}});
    this.classList={contains:n=>this.className.split(' ').includes(n),add:n=>{if(!this.classList.contains(n))this.className+=' '+n;},toggle:(n,on)=>{on??=!this.classList.contains(n);this.className=this.className.split(' ').filter(x=>x!==n).concat(on?[n]:[]).join(' ');return on;}};
  }
  appendChild(n){n.remove();this.children.push(n);n.parentNode=this;return n;}
  append(...nodes){for(const n of nodes)this.appendChild(n);}
  remove(){if(this.parentNode){const a=this.parentNode.children;a.splice(a.indexOf(this),1);this.parentNode=null;}}
  replaceChildren(...nodes){for(const n of [...this.children])n.remove();this.append(...nodes);}
  insertBefore(n,anchor){n.remove();this.children.splice(this.children.indexOf(anchor),0,n);n.parentNode=this;}
  get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
  get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
  get firstChild(){return this.children[0]||null;}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k];}
  addEventListener(){}
  querySelectorAll(selector){return this.children.flatMap(n=>[(selector==='*'||selector[0]==='.'&&n.classList.contains(selector.slice(1)))?n:null,...n.querySelectorAll(selector)]).filter(Boolean);}
  getContext(){return {putImageData(){},measureText:t=>({width:t.length*10,fontBoundingBoxAscent:16,fontBoundingBoxDescent:4})};}
  toDataURL(){return 'data:image/png;base64,AA==';}
}
globalThis.document={createElement:tag=>new Element(tag),body:new Element('body'),fonts:{add(){}}};
globalThis.ImageData=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
globalThis.innerWidth=2048;globalThis.innerHeight=1536;globalThis.window={};
globalThis.requestAnimationFrame=()=>1;
const listeners=new Map();globalThis.addEventListener=(type,fn)=>listeners.set(type,fn);globalThis.removeEventListener=(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);};

const rc=`IDD_LAYOUT DIALOGEX 0,0,400,300
BEGIN
    LTEXT "TEXT_LONG",IDC_LABEL,20,20,120,60
    LISTBOX IDC_LIST,20,100,180,100,WS_VSCROLL
    CONTROL "",IDC_IMAGE,"PETROGLYPH_DIALOG_IMAGE",WS_TABSTOP,220,100,100,100
    CONTROL "TEXT_CLOSE",IDC_RADIO,"Button",BS_AUTORADIOBUTTON,220,170,100,30
    CONTROL "TEXT_CLOSE",IDC_TAB,"Button",BS_AUTORADIOBUTTON | BS_PUSHLIKE,220,200,100,30
    PUSHBUTTON "TEXT_CLOSE",IDC_CLOSE,220,240,100,30
END
IDD_LAYOUT_ODD DIALOGEX 0,0,975,718
BEGIN
    LTEXT "TEXT_LONG",IDC_LABEL,20,20,120,60
END`;
const names=['corner','left','top','right','bottom','arrow'];
const xml=`<GUIDialogs><Textures><Default>
  <Frame_Top_Left>corner</Frame_Top_Left><Frame_Left>left</Frame_Left><Frame_Top>top</Frame_Top>
  <Small_Frame_Top_Left>corner</Small_Frame_Top_Left><Small_Frame_Left>left</Small_Frame_Left><Small_Frame_Top>top</Small_Frame_Top><Small_Frame_Right>right</Small_Frame_Right><Small_Frame_Bottom>bottom</Small_Frame_Bottom>
  <Button_Left>corner</Button_Left><Button_Middle>arrow</Button_Middle><Button_Right>corner</Button_Right><Radio_On>arrow</Radio_On><Radio_Off>arrow</Radio_Off><Radio_Mouse_Over>arrow</Radio_Mouse_Over><Scroll_Up_Button>arrow</Scroll_Up_Button><Scroll_Down_Button>arrow</Scroll_Down_Button><Scroll_Tab>arrow</Scroll_Tab><Scroll_Middle>arrow</Scroll_Middle>
  </Default></Textures><Fonts><Default><Global_Default><Name>Arial</Name><Size>8</Size></Global_Default><Radio_Button><Name>Arial</Name><Size>6</Size></Radio_Button><Push_Button><Name>Arial</Name><Size>8</Size></Push_Button><L_Text><Name>Arial</Name><Size>8</Size></L_Text><List_Box><Name>Arial</Name><Size>8</Size></List_Box></Default></Fonts></GUIDialogs>`;
const sizes=[[4,6],[4,1],[1,6],[4,1],[1,6],[12,12]],mtd=Buffer.alloc(4+81*names.length),tga=Buffer.alloc(18+4);
mtd.writeUInt32LE(names.length);names.forEach((name,i)=>{const at=4+81*i;mtd.write(name,at);mtd.writeUInt32LE(sizes[i][0],at+72);mtd.writeUInt32LE(sizes[i][1],at+76);});
tga[2]=2;tga.writeUInt16LE(1,12);tga.writeUInt16LE(1,14);tga[16]=32;
globalThis.fetch=async input=>{
  const path=decodeURIComponent(String(input)).replace(/^asset\//,'');let body=null;
  if(path.endsWith('GUIDialogs.rc'))body=rc;else if(path.endsWith('GUIDialogs.xml'))body=xml;
  else if(path.endsWith('MT_CommandBar.mtd'))body=mtd;else if(path.endsWith('MT_CommandBar.tga'))body=tga;
  else if(path.includes('/Raster/')){
    const height=Number(path.split('~')[1]),width=Math.ceil(height/2),glyphHeight=height+4;
    body=JSON.stringify({height:glyphHeight,ascent:height,face:'Arial',widths:Array(256).fill(width),offsets:Array.from({length:256},(_,i)=>i*width*glyphHeight),mask:Buffer.alloc(256*width*glyphHeight).toString('base64')});
  }
  return new Response(body,{status:body===null?404:200});
};
const {loadIcons}=await import('../public/js/icons.js');await loadIcons();
const {db}=await import('../public/js/gamedata.js');db.t=key=>key==='TEXT_LONG'?'Alpha beta gamma delta epsilon':'Close';
const {openDialog}=await import('../public/js/game/dialogs.js');
const dialog=await openDialog('IDD_LAYOUT',{nativeImages:true,nativeLists:true,nativeFonts:true});
const label=dialog.ctl('IDC_LABEL'),list=dialog.ctl('IDC_LIST'),image=dialog.ctl('IDC_IMAGE'),close=dialog.ctl('IDC_CLOSE');
assert.equal(parseFloat(list.querySelectorAll('.dlg-native-lines')[0].style.left),8,'Twice a 4-pixel sprite inset is 8 RC units');
assert.equal(close.style.height,'12px','Button height is the normalized middle sprite height, not its RC height');
assert.equal(parseFloat(image._image.style.left),4,'Custom image reserves an authored 4-pixel border');
assert.equal(parseFloat(dialog.el.querySelectorAll('.dlg-fr')[0].style.height),6,'Frame corners use their authored 6-pixel height');
dialog.imageFrame('IDC_IMAGE',false);
const rows=Array.from({length:15},(_,i)=>({key:i,label:'Row '+i}));let picked=0;
const selection=dialog.list('IDC_LIST',rows,()=>picked++);selection.select(2);assert.equal(picked,1);
assert.equal(dialog.ctl('IDC_RADIO').children[0].style.left,'26px','Plain radio label follows icon by native 14 RC gap');
assert.equal(dialog.ctl('IDC_RADIO').children[0].children[0].height,24,'Radio uses its Radio_Button font descriptor');
assert.equal(dialog.ctl('IDC_TAB').style.width,'12px','Pushlike tabs use the off sprite bounds');
assert.equal(dialog.ctl('IDC_TAB').children[0].style.left,undefined,'Pushlike labels remain centered');
const oldGlyphHeight=label.children[0].children[0].height;
innerWidth=1024;innerHeight=768;await listeners.get('resize')();
assert.strictEqual(dialog.ctl('IDC_LABEL'),label);assert.strictEqual(dialog.ctl('IDC_CLOSE'),close,'Resize preserves callers and event targets');
assert.equal(close.style.height,'12px');assert.equal(image._image.style.left,'4px');assert(image.querySelectorAll('.dlg-fr').every(n=>n.hidden),'Hidden image borders survive resize');
assert.equal(parseFloat(list.querySelectorAll('.dlg-native-lines')[0].style.left),8,'Inset remains 8 RC units after resize');
assert(label.children[0].children[0].height<oldGlyphHeight,'Raster face is recreated for the new physical screen height');
assert.equal(list.querySelectorAll('.dlg-native-row').find(n=>n.getAttribute('aria-selected')==='true')?.children[0]?.getAttribute('aria-label'),'Row 2');
assert.equal(picked,1,'Reflow preserves list selection without dispatching a click');
selection.select(1);assert.equal(selection.selected().key,1);assert.equal(list.querySelectorAll('.dlg-native-row').find(n=>n.getAttribute('aria-selected')==='true')?.children[0]?.getAttribute('aria-label'),'Row 1','Existing list handles stay live after resize');
const keylessRows=[{label:'No key one'},{label:'No key two'}],keyless=dialog.list('IDC_LIST',keylessRows);
assert.equal(keyless.selected(),null,'A keyless first row is not implicitly selected');
assert.equal(selection.selected(),null,'Handles for replaced contents have no selection');
await listeners.get('resize')();assert.equal(keyless.selected(),null,'Resize preserves an unselected keyless list');
assert(list.querySelectorAll('.dlg-native-row').every(n=>n.getAttribute('aria-selected')==='false'));
list.querySelectorAll('.dlg-native-row')[1].onclick();assert.strictEqual(keyless.selected(),keylessRows[1],'Clicking a keyless row selects that row, not the first matching undefined key');
await listeners.get('resize')();assert.strictEqual(keyless.selected(),keylessRows[1],'Selected keyless row survives reflow by its native row index');
const replacement=dialog.list('IDC_LIST',keylessRows.slice());assert.equal(replacement.selected(),null,'Replacing list contents clears selection');
assert.equal(keyless.selected(),null,'Replacing contents invalidates the previous list handle');
const nativeLines=list.querySelectorAll('.dlg-native-lines')[0];assert(list.children.indexOf(nativeLines)>list.children.indexOf(list.querySelectorAll('.dlg-fr')[0]),'Reflow leaves frame primitives behind text');
const {setActiveLanguage,refreshLanguageViews}=await import('../public/js/language.js');
let callbacks=0,picks=0;
db.t=key=>key==='TEXT_LONG'?'Translated heading':key==='TEXT_CLOSE'?'Закрыть':key;
dialog.setText('IDC_LABEL','literal_with_underscores');
const bound=dialog.list('IDC_LIST',()=>Array.from({length:20},(_,i)=>({key:i,label:db.t('TEXT_CLOSE')+' '+i})),()=>picks++);
bound.select(15);const oldSelected=bound.selected().key,beforePicks=picks;
const stopRefresh=dialog.onLanguageRefresh(()=>callbacks++);
setActiveLanguage(8);await refreshLanguageViews({language:8});
assert.strictEqual(dialog.ctl('IDC_LABEL'),label);assert.strictEqual(dialog.ctl('IDC_CLOSE'),close);
assert.equal(label.getAttribute('aria-label'),'literal_with_underscores','Literal source is not reverse-translated or prettified');
assert.equal(close.firstChild._nativeLabel.text,'Закрыть','Authored RC keys resolve in place');
assert.equal(bound.selected().key,oldSelected);assert.equal(picks,beforePicks,'Refresh must not invoke row selection side effects');
assert(list.querySelectorAll('.dlg-native-row').some(n=>n.getAttribute('aria-selected')==='true'),'Scroll keeps the selected row visible');
assert.equal(callbacks,1);await refreshLanguageViews({language:8});assert.equal(callbacks,2,'Same-language refresh still relayouts');
stopRefresh();dialog.close();await refreshLanguageViews({language:8});assert.equal(callbacks,2,'Closed dialogs unsubscribe');
setActiveLanguage(0);assert(!listeners.has('resize'));
const full=await openDialog('IDD_LAYOUT_ODD',{anchor:9,nativeImages:true,nativeLists:true,nativeFonts:true});
assert.equal(full.el.style.width,'1024px');assert.equal(full.el.style.height,'768px');
assert.equal(full.ctl('IDC_LABEL').style.left,'44px','Fullscreen anchor truncates the odd-width control offset to24RC, not24.5');
assert.equal(full.ctl('IDC_LABEL').style.top,'45px');
full.close();
const centered=await openDialog('IDD_LAYOUT_ODD',{nativeFonts:true});
assert.equal(centered.el.style.width,'975px');assert.equal(centered.ctl('IDC_LABEL').style.left,'20px','Fullscreen anchoring must not mutate the cached resource or alter other dialogs');centered.close();
const {GalacticEncyclopedia}=await import('../public/js/game/galacticencyclopedia.js');
const tooltip=Object.assign(Object.create(GalacticEncyclopedia.prototype),{game:{overlayScale:()=>1},root:new Element('div'),linkedRoot:new Element('div'),linkedGeneration:1,linkedTimer:null,linkedBuilding:false,linkedPoint:{x:30,y:40},warm:async()=>{},frameNames:()=>[],sprite:()=>null,component:()=>({val:k=>k==='Font_Name'?'Arial':'',num:(k,d)=>d})});
tooltip.root.hidden=true;document.body.appendChild(tooltip.linkedRoot);let translated='Initial tooltip';tooltip.linkedSource=()=>translated;
await tooltip.paintLinked(1);const tooltipNode=tooltip.linkedRoot;translated='Translated tooltip';await tooltip.refreshLanguage();
assert.strictEqual(tooltip.linkedRoot,tooltipNode);assert.equal(tooltip.linkedRoot.hidden,false);assert.equal(tooltip.linkedTimer,null,'Visible tooltip refresh does not restart its delay');
assert(tooltip.linkedRoot.children.some(n=>n.getAttribute('aria-label')==='Translated tooltip'),'Retained tooltip source and font are repainted in place');tooltip.linkedRoot.remove();
console.log('Native dialog normalized borders, font/wrap resize, fullscreen anchoring, image insets, stable controls and list selection passed');

