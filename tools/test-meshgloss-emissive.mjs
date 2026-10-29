import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {openGame} from './megfs.mjs';
import {parseALO} from '../public/js/alo.js';
import {buildModel} from '../public/js/model.js';
import {gfx} from '../public/js/gfx.js';
import {effectInfo} from '../public/js/fxo.js';

const mod=process.argv.indexOf('--mod');
const archive=openGame(fileURLToPath(new URL('../../Star Wars Empire at War',import.meta.url)),mod<0?[]:[process.argv[mod+1]]);
const read=name=>{const bytes=archive.read(archive.resolve(name));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);};
globalThis.fetch=async input=>{
  const key=archive.resolve(decodeURIComponent(String(input).replace(/^asset\//,''))),bytes=key&&archive.read(key);
  return new Response(bytes?new Uint8Array(bytes):null,{status:bytes?200:404});
};

const effect=read('Data/Art/Shaders/MeshGloss.fxo'),words=new Uint32Array(effect);
assert(words.some((word,i)=>word===5&&words[i+1]===0x81070000&&words[i+2]===0xb0e40000&&words[i+3]===0x90e40000));
const fallback=effectInfo(effect).techniques.find(t=>t.annotations.LOD==='FIXEDFUNCTION');
assert(fallback?.passes.some(pass=>pass.states.some(state=>state.id===103&&state.index===0&&state.value===5)));

const original=parseALO(read('Data/Art/Models/w_stars_cine_lua.alo'));
const source=original.meshes.find(mesh=>mesh.subs.some(sub=>sub.material.shader==='meshgloss.fx'));
assert(source);
const params=source.subs[0].material.params;
assert.deepEqual(params.Diffuse.slice(0,3),[0,0,0]);
assert.deepEqual(params.Specular.slice(0,3),[0,0,0]);
assert(Math.abs(params.Emissive[0]-100/255)<1e-7);
const fixture=(overrides={},shader='meshgloss.fx')=>{
  const sub=source.subs[0];
  const model={...original,meshes:[{...source,subs:[{...sub,material:{shader,params:{...params,...overrides}}}]}]};
  const instance=buildModel(model);let material;
  instance.root.traverse(node=>{if(node.isMesh)material=node.material;});
  assert(material);return material;
};
for(const detail of [3,0]){
  gfx.shader=detail;
  const emissive=fixture(),lit=fixture({Specular:[.1,0,0,0]}),diffuse=fixture({Diffuse:[0,.1,0,0]});
  assert.equal(emissive.defines.NATIVE_MESH_GLOSS_EMISSIVE,1);
  assert.equal(lit.defines.NATIVE_MESH_GLOSS_EMISSIVE,undefined);
  assert.equal(diffuse.defines.NATIVE_MESH_GLOSS_EMISSIVE,undefined);
  assert.notEqual(emissive,lit,'Specular differences must not share the emissive-only cached material');
  assert.equal(fixture().defines.NATIVE_MESH_GLOSS_EMISSIVE,1);
  assert.equal(fixture({},'mesh.fx').defines.NATIVE_MESH_GLOSS_EMISSIVE,undefined);
  assert.equal(emissive.uniforms.fogRange,lit.uniforms.fogRange);
  assert.equal(emissive.transparent,false);assert.equal(emissive.depthWrite,true);
}
console.log('PASS: original MeshGloss mul_x2 / fixed MODULATE2X, emissive-only selection, material cache isolation and retained fog/depth state',mod>=0?'(mod overlay)':'(base)');
