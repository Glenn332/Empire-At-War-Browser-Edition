import * as THREE from 'three';
import {db} from '../gamedata.js';
import {fetchText,findFiles} from '../vfs.js';
import {parseXML} from '../xml.js';
import {activeLanguage,LANGUAGES} from '../language.js';
import {loadNativeFont,nativeTextMask} from '../nativefont.js';
import {loadModel} from '../model.js';
import {loadALA,AnimState} from '../ala.js';
import {wrapStaticText} from './dialogtext.js';

const key=s=>String(s||'').toUpperCase(),yes=s=>/^(yes|true|1)$/i.test(s||'');
const defaults={Font_Name:'Arial Bold',Font_Size:'100',Texture_Width_Pow_2:'512',Texture_Height_Pow_2:'128',Has_Header:'Yes',Header_Font_Name:'Arial Bold',Header_Font_Size:'100',Header_Texture_Width_Pow_2:'512',Header_Texture_Height_Pow_2:'128',Polygon_Shader_Name:'MeshAlpha',Polygon_Tex_Param_Name:'BaseTexture',Model_Name:'W_TextScroll.alo',Model_Camera_Bone_Name:'camera',Fadeout_Start_Frame:'0',Fadeout_End_Frame:'0',Fadein_Start_Frame:'0',Fadein_End_Frame:'0',Font_Stretch_Factor:'1',Font_Character_Padding:'0',Header_Font_Stretch_Factor:'1',Header_Font_Character_Padding:'0'};
export function crawlDefinition(source,name,language=activeLanguage){
  const attribute=(n,name)=>Object.entries(n.attrs).find(([k])=>key(k)===key(name))?.[1],initial=Object.fromEntries(Object.entries(defaults).map(([k,v])=>[key(k),v]));
  let found;const visit=n=>{if(key(n.tag)==='TEXTSCROLL'&&key(attribute(n,'name'))===key(name))found=n;for(const c of n.children)visit(c);};visit(parseXML(source));if(!found)return null;
  const specs=new Map();for(const n of found.all('Data_Specifications')){const lang=key(attribute(n,'language')),base=lang==='ENGLISH'?{...initial}:{...(specs.get('ENGLISH')||initial)};for(const c of n.children)base[key(c.tag)]=c.text.trim();specs.set(lang,base);}
  const fields=specs.get(LANGUAGES[language])||specs.get('ENGLISH');if(!fields)return null;
  return {val:(n,d='')=>fields[key(n)]??d,num:(n,d=0)=>Number.isFinite(+fields[key(n)])?+fields[key(n)]:d,list:n=>(fields[key(n)]||'').split(/[\s,]+/).filter(Boolean),fields};
}
export function crawlCamera(){return new THREE.PerspectiveCamera(2*Math.atan(Math.tan(.5)/(4/3))*180/Math.PI,4/3,1,1000);}
export function crawlOpacity(def,frame,frames){
  const start=Math.min(frames,def.num('Fadein_Start_Frame')),end=def.num('Fadein_End_Frame');
  let alpha=start!==end&&frame>=start&&frame<=end?(frame-start)/(end-start):1;
  const out=Math.min(frames,def.num('Fadeout_Start_Frame')),authoredEnd=def.num('Fadeout_End_Frame'),last=out<authoredEnd?Math.min(frames,authoredEnd):frames;
  if(out<last&&frame>=out)alpha=1-(frame-out+1)/(last-out);
  return Math.max(0,Math.min(1,alpha));
}
export function crawlTextPixels(font,text,width,height,{header=false,padding=0}={}){
  const measure=s=>font.measure(s,padding),lines=wrapStaticText(text,width*.9,measure),data=new Uint8Array(width*height*4);
  let row=0;
  for(const line of lines){
    if(row>=height-1)break;
    let extra=0;
    if(!header&&!/[\0\n!.?]$/.test(line.trimEnd())){const spaces=(line.match(/ /g)||[]).length;if(spaces&&measure(line)<=width)extra=Math.trunc((width-measure(line))/spaces);}
    let x=header?Math.max(0,Math.trunc((width-measure(line))/2)):0;
    for(let i=0;i<line.length;i++){
      const character=line[i],mask=nativeTextMask(font,character,0);
      for(let y=0;y<Math.min(mask.height,height-1-row);y++)for(let j=0;j<mask.width&&x+j<width;j++)if(x+j>=0){const coverage=mask.data[y*mask.width+j],at=((row+y)*width+x+j)*4;data[at]=data[at+1]=data[at+2]=data[at+3]=coverage;}
      x+=font.measure(character,padding)+(character===' '?extra:0);
    }
    row+=font.height;
  }
  return {width,height,data,lines};
}
export async function crawlFont(face,cell,stretch=1){
  cell=Math.max(1,Math.round(cell));
  const probe=await loadNativeFont(face,cell,1,true);if(!probe)return null;
  let em=Math.max(1,Math.round(cell*cell/probe.height));
  for(let i=0;i<4;i++){const f=await loadNativeFont(face,em,1,true);if(!f)break;if(f.height>cell)em--;else if(f.height<cell){const g=await loadNativeFont(face,em+1,1,true);if(g&&g.height<=cell)em++;else break;}else break;}
  return loadNativeFont(face,em,stretch,true);
}
let definitions;
export class TacticalCrawl{
  constructor(){this.active=false;this.disposed=false;this.materials=[];this.textures=[];this.last=-1;}
  static async create(name){const crawl=new TacticalCrawl();try{await crawl.open(name);return crawl;}catch(error){crawl.dispose();throw error;}}
  async open(name){
    definitions??=fetchText('Data/XML/StarWars3DTextCrawl.xml');
    const def=this.def=crawlDefinition(await definitions||'',name);if(!def)return;
    const modelName=def.val('Model_Name');this.inst=await loadModel(modelName);if(!this.inst||this.disposed)return;
    const base=modelName.replace(/\.alo$/i,'').toUpperCase(),files=await findFiles('MODELS\\\\'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'_[A-Z_]+_\\d\\d\\.ALA$');
    const names=files.map(n=>n.split(/[\\/]/).pop()).sort(),animation=await loadALA(names.find(n=>n===base+'_IDLE_00.ALA')||names[0]||base+'_IDLE_00.ALA');
    if(!animation||this.disposed)return;this.anim=new AnimState(this.inst,animation);this.frames=animation.frames;
    for(const [meshName,prefix]of [['text',''],['header','Header_']]){
      if(prefix&&!yes(def.val('Has_Header')))continue;
      const text=def.list(prefix+'Text_IDs').map(id=>db.t(id)).join('\n \n \n')+'\n \n \n';
      const font=await crawlFont(def.val(prefix+'Font_Name'),def.num(prefix+'Font_Size'),def.num(prefix+'Font_Stretch_Factor',1));if(!font)throw Error('Missing native crawl font');await font.ensure(text);
      const pixels=crawlTextPixels(font,text,def.num(prefix+'Texture_Width_Pow_2'),def.num(prefix+'Texture_Height_Pow_2'),{header:!!prefix,padding:def.num(prefix+'Font_Character_Padding')});
      const texture=new THREE.DataTexture(pixels.data,pixels.width,pixels.height,THREE.RGBAFormat);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearFilter;texture.needsUpdate=true;this.textures.push(texture);
      const group=this.inst.mesh(meshName);group?.traverse(o=>{
        if(!o.isMesh)return;
        const material=o.material.clone();o.material=material;this.materials.push(material);
        const original=this.inst.model.meshes.find(m=>key(m.name)===key(meshName))?.subs.find(s=>s.material)?.material;
        if(key(original?.shader).replace(/\.(FX|FXO)$/,'')!==key(def.val('Polygon_Shader_Name')).replace(/\.(FX|FXO)$/,''))return;
        if(def.val('Polygon_Tex_Param_Name')!=='BaseTexture')return;
        material.uniforms.map.value=texture;
        const p=original.params;
        if((p.Diffuse||[]).slice(0,3).every(v=>v===0)&&(p.Specular||[]).slice(0,3).every(v=>v===0))material.uniforms.diffuse.value.set(...(p.Emissive||[0,0,0])).multiplyScalar(2);
        material.uniforms.fogRange.value.set(0,0);material.uniforms.opacity.value=1;
      });
    }
    if(this.disposed)return;
    this.camera=crawlCamera();
    const bone=this.inst.bone(def.val('Model_Camera_Bone_Name'));if(!bone)return;
    this.inst.root.updateMatrixWorld(true);bone.matrixWorld.decompose(this.camera.position,this.camera.quaternion,this.camera.scale);this.camera.updateMatrixWorld();
    this.scene=new THREE.Scene();this.scene.add(this.inst.root);
    this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,premultipliedAlpha:true});this.renderer.outputColorSpace=THREE.LinearSRGBColorSpace;this.renderer.setClearColor(0,0);this.renderer.setPixelRatio(1);
    this.canvas=this.renderer.domElement;this.canvas.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10';this.canvas.dataset.crawl=name;document.body.appendChild(this.canvas);this.active=true;
  }
  update(frame){
    if(!this.active||frame===this.last)return;this.last=frame;
    if(frame<0||frame>=this.frames){this.canvas.hidden=true;return;}
    this.canvas.hidden=false;
    this.anim.done=false;this.anim.time=frame/this.anim.anim.fps;this.anim.step(0);
    const opacity=crawlOpacity(this.def,frame,this.frames);for(const material of this.materials)material.uniforms.opacity.value=opacity;
    if(this.width!==innerWidth||this.height!==innerHeight){this.width=innerWidth;this.height=innerHeight;this.renderer.setSize(this.width,this.height,false);}
    this.renderer.render(this.scene,this.camera);
  }
  dispose(){this.disposed=true;this.active=false;this.canvas?.remove();this.renderer?.dispose();this.renderer?.forceContextLoss();for(const m of this.materials)m.dispose();for(const t of this.textures)t.dispose();}
}
