import * as THREE from 'three';
import {planetVertex,planetFragment} from '../js/planetshader.js';
import {alignPortraitPixels} from '../js/game/planetportrait.js';
const output=document.querySelector('#result'),images=document.querySelector('#images');
const renderer=new THREE.WebGLRenderer({antialias:false,premultipliedAlpha:false});renderer.setSize(32,32);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
const canvas=(pixels,w,h)=>{const cv=document.createElement('canvas');cv.width=w;cv.height=h;const ctx=cv.getContext('2d'),im=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,j=(y*w+x)*4;im.data.set(pixels.subarray(j,j+3),i);im.data[i+3]=255;}ctx.putImageData(im,0,0);return cv;};
const show=(title,...contents)=>{const el=document.createElement('section'),label=document.createElement('b');label.textContent=title;el.append(label,...contents);images.append(el);};
async function compare(fixture){
  try{
    images.replaceChildren();const f=await(await fetch('test/'+fixture)).json(),p=f.parameters,scene=new THREE.Scene();
    const tex=name=>{const t=new THREE.DataTexture(new Uint8Array(f.textures[name]),2,2);t.minFilter=t.magFilter=THREE.LinearFilter;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.needsUpdate=true;return {value:t};};
    const v3=a=>({value:new THREE.Vector3(...a)}),c3=a=>({value:new THREE.Color(...a)});
    const uniforms={sunDir:v3(f.sunDir),sunColor:c3(f.sunDiffuse),sunSpecular:c3(f.sunSpecular),fillDir:v3(f.fills?.[0].dir||[1,0,0]),fillDir2:v3(f.fills?.[1].dir||[0,1,0]),fillColor:c3(f.fills?.[0].rgb.map(c=>c*f.fills[0].intensity)||[0,0,0]),fillColor2:c3(f.fills?.[1].rgb.map(c=>c*f.fills[1].intensity)||[0,0,0]),ambient:c3(f.ambient),fixtureEye:v3([0,0,5]),
      emissive:c3(p.Emissive),diffuse:c3(p.Diffuse),specular:c3(p.Specular),atmosphere:{value:new THREE.Vector4(...p.Atmosphere)},lightScale:{value:new THREE.Vector4(...p.m_lightScale)},cityColor:c3(p.CityColor),atmospherePower:{value:p.AtmospherePower[0]},cloudScroll:{value:p.CloudScrollRate[0]},time:{value:p.m_time[0]},opacity:{value:1},map:tex('BaseTexture'),normalMap:tex('NormalTexture'),cloudMap:tex('CloudTexture'),cloudNormalMap:tex('CloudNormalTexture')};
    const target=new THREE.WebGLRenderTarget(32,32),pixels=new Uint8Array(4096),report=[];
    for(const test of f.cases||[{name:fixture,vertices:f.vertices,results:f.results}]){
      const viewport=test.viewport||[0,0,32,32],camera=new THREE.Camera();alignPortraitPixels(camera,viewport[2],viewport[3]);
      const geometry=new THREE.BufferGeometry(),stride=f.strideFloats;
      for(const [name,offset,size]of [['position',0,3],['normal',3,3],['uv',6,2],['tangent',8,3],['binormal',11,3]])geometry.setAttribute(name,new THREE.Float32BufferAttribute(test.vertices.flatMap((_,i)=>i%stride===0?test.vertices.slice(i+offset,i+offset+size):[]),size));
      for(const native of test.results){
        const side=test.nativeCull===3?THREE.FrontSide:test.nativeCull===2?THREE.BackSide:THREE.DoubleSide;
        const mat=new THREE.ShaderMaterial({vertexShader:planetVertex.replaceAll('cameraPosition','fixtureEye').replace('uniform vec3 emissive','uniform vec3 fixtureEye;\nuniform vec3 emissive'),fragmentShader:planetFragment,uniforms,defines:native.technique==='t0'?{PLANET_FIXED:1}:native.technique==='sph_t2'?{PLANET_DX8:1}:{},side});
        const mesh=new THREE.Mesh(geometry,mat);mesh.matrix.fromArray(p.m_world);mesh.matrixAutoUpdate=false;scene.add(mesh);renderer.setRenderTarget(target);renderer.setViewport(0,0,32,32);renderer.setClearColor(new THREE.Color(5/255,7/255,11/255),13/255);renderer.clear();renderer.setViewport(...viewport);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,32,32,pixels);
        const expected=Uint8Array.from(atob(native.rgbaBase64),c=>c.charCodeAt(0));let max=0,sum=0,bad=0,coverageErrors=0,edgeMax=0;
        for(let y=0;y<32;y++)for(let x=0;x<32;x++){
          const i=(y*32+x)*4;
          const drawn=a=>a[i]!==5||a[i+1]!==7||a[i+2]!==11;
          if(drawn(pixels)!==drawn(expected))coverageErrors++;
          for(let c=0;c<3;c++){const error=Math.abs(pixels[i+c]-expected[i+c]);max=Math.max(max,error);sum+=error;if(error>2)bad++;if(x===0||x===31||y===0||y===31)edgeMax=Math.max(edgeMax,error);}
        }
        report.push({fixture:test.name,technique:native.technique,maxByteError:max,meanByteError:sum/3072,channelsOver2:bad,coverageErrors,viewportEdgeMax:edgeMax});show(test.name+' '+native.technique+' native / browser',canvas(expected,32,32),canvas(pixels,32,32));scene.remove(mesh);mat.dispose();
      }
      geometry.dispose();
    }
    target.dispose();output.textContent=JSON.stringify({pass:report.every(r=>r.channelsOver2===0&&r.coverageErrors===0),note:'All 1024 RGB pixels participate, including every viewport edge. Native RGB-only ColorWrite preserves clear alpha; portrait output forces the native opaque clear alpha.',report},null,2);
  }catch(e){output.textContent=e.stack;console.error(e);}
};
document.querySelector('#run').onclick=()=>compare('planet-native.json');
document.querySelector('#varied').onclick=()=>compare('planet-native-varied.json');
document.querySelector('#boundaries').onclick=()=>compare('planet-native-boundaries.json');
document.querySelector('#portraits').onclick=async()=>{
  try{
    images.replaceChildren();output.textContent='Loading installed models…';
    const {loadModel}=await import('../js/model.js'),{gfx}=await import('../js/gfx.js'),{db,loadGameData}=await import('../js/gamedata.js'),{capturePlanet}=await import('../js/game/planetinfo.js'),{captureSummaryPlanet}=await import('../js/game/galacticsummary.js');
    await loadGameData();const before=localStorage.getItem('swr-gfx'),old=gfx.shader,report=[];
    try{for(const detail of [3,2,1,0]){
      gfx.shader=detail;const inst=await loadModel('W_planet_Forest01.alo',{alts:[0,2]});const type=[...db.types.values()].find(t=>t.str('Galactic_Model_Name').toLowerCase()==='w_planet_forest01.alo');inst.root.scale.setScalar(type?.num('Scale_Factor',1)||1);inst.root.rotation.z=Math.PI/2;
      const game={renderer,planetViews:[{inst}]},p={index:0};const summary=await captureSummaryPlanet(game,p),info=await capturePlanet(game,p);
      const a=new Image(),b=new Image();a.src=summary;b.src=info;show('Detail '+detail+' Summary / Planet Info',a,b);report.push({detail,summaryBytes:summary.length,infoBytes:info.length});
    }}finally{gfx.shader=old;}
    output.textContent=JSON.stringify({report,savedSettingsUnchanged:before===localStorage.getItem('swr-gfx'),programs:renderer.info.programs.map(p=>({name:p.name,runnable:p.diagnostics?.runnable??true}))},null,2);
  }catch(e){output.textContent=e.stack;console.error(e);}
};

