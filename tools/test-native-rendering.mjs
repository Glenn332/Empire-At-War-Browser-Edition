import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {openGame} from './megfs.mjs';
import {NativeFonts} from './native-fonts.mjs';
import {effectSamplers} from '../public/js/fxo.js';
import {nativeTextMask,nativeTextPixels,loadNativeFont,loadComponentFont,nativeFontPath} from '../public/js/nativefont.js';
import {wrapStaticText,wrapDialogText} from '../public/js/game/dialogtext.js';
import {galacticLight} from '../public/js/game/galacticlighting.js';
import {planetEnvironment} from '../public/js/planetlighting.js';

const mod=process.argv.indexOf('--mod'),game=openGame(fileURLToPath(new URL('../../Star Wars Empire at War',import.meta.url)),mod<0?[]:[process.argv[mod+1]]);
const bytes=game.read(game.resolve('Data/Art/Shaders/Planet.fxo')),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),samplers=effectSamplers(buffer);
assert.equal(samplers.size,4);
for(const states of samplers.values()){
  assert.equal(states.get(0xa9),mod<0?2:3);assert.equal(states.get(0xaa),mod<0?2:3);assert.equal(states.get(0xab),mod<0?2:3);
  assert.equal(states.get(0xae)??1,mod<0?1:16);assert.equal(states.get(0xa5),1);assert.equal(states.get(0xa6),1);
}
assert.equal(effectSamplers(buffer.slice(0,32)).size,0,'Malformed FXO cannot override sampler defaults');
assert.deepEqual(wrapStaticText('abc',3,s=>s.length),['abc']);assert.deepEqual(wrapDialogText('abc',3,s=>s.length),['ab','c']);
assert.deepEqual(wrapStaticText('alpha\\n\\nbeta\n\n',20,s=>s.length),['alpha','beta']);
assert.deepEqual(wrapStaticText('Ground Structures',8,s=>s.length),['Ground','Structur','es']);assert.deepEqual(wrapStaticText('A'.repeat(8192),100,s=>s.length),[]);
const close=(actual,expected)=>assert(actual.every((value,i)=>Math.abs(value-expected[i])<1e-6));
close(galacticLight([0,160,58],[0,235,18],.5,0).direction,[.18124306,.49796122,.84804810]);
close(galacticLight([0,160,58],[0,235,18],.5,.5).direction,[-.23695940,.75153921,.61566148]);
close(galacticLight([0,160,58],[0,235,18],.5,1).direction,[-.77905989,.54550361,.30901699]);
assert.equal(galacticLight([0,0,90],[0,235,90],.4,.5).intensity,.45,'Zoom XML targets absolute intensity');
const environment=planetEnvironment({ambient:[.1,.2,.3],lights:[
  {dir:[1,0,0],nativeDir:[0,-1,0],color:[.2,.3,.4],specular:[.4,.6,.8],intensity:.25},
  {nativeDir:[1,0,0],color:[.1,.2,.3]}, {nativeDir:[0,0,1],color:[.3,.2,.1]},
]});
assert.deepEqual(environment,{sunDir:[0,-1,0],sunColor:[.2,.3,.4],sunSpecular:[.2,.3,.4],
  fillDir:[1,0,0],fillColor:[.1,.2,.3],fillDir2:[0,0,1],fillColor2:[.3,.2,.1],ambient:[.1,.2,.3]},
  'Planet lighting uses native directions, independent fills and twice-intensity authored specular');
assert.deepEqual(planetEnvironment({}).sunSpecular,[1,1,1]);

const mask={width:2,height:2,data:new Uint8Array([10,80,200,40])};
const outlined=nativeTextPixels(mask,{outline:true});
assert.deepEqual(Array.from({length:4},(_,y)=>Array.from({length:4},(_,x)=>outlined.pixels[(y*4+x)*4+3])),[
  [10,80,80,80],[200,10,80,80],[200,200,40,40],[200,200,40,0],
]);
const ordinary=nativeTextPixels({width:2,height:1,data:new Uint8Array([128,0])});assert.deepEqual([...ordinary.pixels.slice(0,4)],[128,128,128,128]);
const translucent=nativeTextPixels(mask,{outline:true,top:[255,255,255,128]});assert.equal(translucent.pixels[3],5,'Black outline receives text alpha');
const embossed=nativeTextPixels({width:2,height:3,data:new Uint8Array([255,128,255,0,0,0])},{emboss:true,screenHeight:600});
assert.equal(embossed.pixels[3],127);assert.deepEqual([...embossed.pixels.slice(12,16)],[255,255,255,255]);assert.equal(embossed.shine[(1*3+1)*4+3],64);

if(process.platform==='win32'){
  const raster=new NativeFonts(game);
  try {
    const decode=bytes=>{const atlas=JSON.parse(bytes);atlas.data=zlib.gunzipSync(Buffer.from(atlas.mask,'base64'));return atlas;};
    const cases=[['Arial',16,1000,[18,15,7],[15,9,4,13]],['EmpireAtWar-Medium',16,1200,[22,18,11],[16,13,8,16]],['Arial Bold',18,1000,[21,17,9],[17,11,5,15]]];
    for(const [face,height,stretch,metrics,widths]of cases){
      const atlas=decode(await raster.asset(`Data/Fonts/Raster/${encodeURIComponent(face)}~${height}~${stretch}~0.json`));
      assert.deepEqual([atlas.height,atlas.ascent,atlas.average],metrics);assert.deepEqual([... 'Wg M'].map(c=>atlas.widths[c.charCodeAt(0)]),widths);
      if(face==='EmpireAtWar-Medium'){
        const hashes=['40925ead96ffbd7fc399883f49b6d2bf2ec00eb705c723b7cac4b9b824c6f659','5eb6885c4016ab77db69858d32a6cc381f2287efae104629892062286cd92476','86d2cf5b090f43ee54d8f7c1dcf746a853951191457ff6dac96269a9d24860b9','12126a71d3a92da147de149f2319629ff4d168984c8d2c4046d233d77470caec'];
        for(const [i,c]of [...'Wg M'].entries()){const code=c.charCodeAt(0),start=atlas.offsets[code],glyph=atlas.data.subarray(start,start+atlas.widths[code]*atlas.height);assert.equal(crypto.createHash('sha256').update(glyph).digest('hex'),hashes[i]);}
      }
    }
    globalThis.fetch=async input=>{const url=decodeURIComponent(String(input).replace(/^asset\//,''));const bytes=await raster.asset(url);return new Response(bytes,{status:bytes?200:404});};
    const font=await loadNativeFont('EmpireAtWar-Medium',16,1.2);assert(font);assert.equal(font.measure('Wg M',2),61,'Every UTF-16 glyph includes padding, including the last');
    const normal=decode(await raster.asset(nativeFontPath('Arial',16))),bold=decode(await raster.asset(nativeFontPath('Arial',16,1,0,true)));
    assert.equal(normal.weight,400);assert.equal(bold.weight,700,'Native components retain GetFont bold1 separately from resource-dialog bold0');
    assert.notDeepEqual(normal.data,bold.data,'The GDI component glyphs must not reuse the normal-weight mask');
    const deadband=decode(await raster.asset(nativeFontPath('Arial',16,1.00005)));
    assert.deepEqual(deadband.data,normal.data,'Native stretch deadband retains the initial unstretched font');
    const shiftJis=decode(await raster.asset(nativeFontPath('Arial',16,1.2,0,false,128)));
    assert.equal(shiftJis.charset,128,'Legacy Japanese charset survives stretch recreation');
    assert.equal(normal.charset,0);
    assert.notEqual(nativeFontPath('Arial',16,1,0,true,128),nativeFontPath('Arial',16,1,0,true));
    assert.notStrictEqual(await loadComponentFont('Arial',16),await loadNativeFont('Arial',16),'Normal and component variants have separate browser cache entries');
    const text=nativeTextMask(font,'Wg M',2);assert.equal(text.width,62,'String bitmap rounds up to even width');
    console.log({mod:mod>=0,nativeFont:font.face,result:'native GDI metrics and independent glyph hashes, exact outline/emboss pixels, FXO sampler states passed'});
  }finally{raster.close();}
}else console.log('FXO and pixel fixtures passed; GDI generator checks require Windows');
