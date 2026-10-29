import * as THREE from 'three';
import { buildModel } from '../model.js';

export function portraitBounds(inst) {
  const box=new THREE.Box3(),part=new THREE.Box3(),matrix=new THREE.Matrix4();
  const inverse=inst.root.matrixWorld.clone().invert();
  for(const mesh of inst.model.meshes){
    if(!mesh.bbox)continue;
    part.min.fromArray(mesh.bbox);part.max.fromArray(mesh.bbox,3);
    matrix.multiplyMatrices(inverse,(inst.bones[mesh.bone]||inst.root).matrixWorld);
    box.union(part.applyMatrix4(matrix));
  }
  return box.applyMatrix4(inst.root.matrixWorld);
}

export async function preparePlanetPortrait(source,{info=false}={}) {
  const inst=buildModel(source.model,{alt:1});
  inst.root.position.copy(source.root.position);inst.root.scale.copy(source.root.scale);inst.root.quaternion.copy(source.root.quaternion);
  if(info)inst.root.rotateZ(2.6179938316345215);
  inst.syncFromBones();
  const materials=new Set(),pending=[];
  inst.root.traverse(o=>{if(!o.isMesh)return;materials.add(o.material);for(const u of Object.values(o.material.uniforms||{}))if(u.value?.isTexture)pending.push(u.value.userData.ready);pending.push(o.material.userData.ready);});
  let opacity=1,scale=null,found=false;
  source.root.traverse(o=>{if(!o.isMesh)return;const u=o.material.uniforms;if(!found&&u?.opacity)opacity=u.opacity.value;if(!scale&&u?.lightScale){opacity=u.opacity?.value??1;scale=u.lightScale.value.clone();found=true;}});
  await Promise.all(pending);
  const copies=new Map();
  for(const material of materials){
    const copy=material.clone();copy.userData={...material.userData};
    copy.uniforms={...material.uniforms};
    copy.side=material.side===THREE.FrontSide?THREE.BackSide:material.side===THREE.BackSide?THREE.FrontSide:material.side;
    if(copy.fragmentShader)copy.fragmentShader=copy.fragmentShader.replace(/\bgl_FrontFacing\b/g,'(!gl_FrontFacing)');
    if(copy.uniforms.opacity)copy.uniforms.opacity={value:info?1:opacity};
    if(copy.uniforms.lightScale){
      copy.uniforms.lightScale={value:info?new THREE.Vector4(1,1,1,1):(scale||material.uniforms.lightScale.value).clone()};
      copy.blending=copy.uniforms.lightScale.value.w*(copy.uniforms.opacity?.value??1)<1?THREE.CustomBlending:THREE.NormalBlending;
    }
    copies.set(material,copy);
  }
  inst.root.traverse(o=>{if(o.isMesh)o.material=copies.get(o.material);});
  return {inst,dispose:()=>{for(const m of copies.values())m.dispose();}};
}

export function portraitViewport(bounds,width,height) {
  const [left,right,top,bottom]=bounds.map(Math.fround);
  const x=Math.trunc(Math.fround(width*left)),y=Math.trunc(Math.fround(height*Math.fround(1-top)));
  return [x,y,Math.trunc(Math.fround(width*right))-x,Math.trunc(Math.fround(height*Math.fround(1-bottom)))-y];
}

export function alignPortraitPixels(camera,width,height) {
  const raster=new THREE.Matrix4().set(1,0,0,1/width,0,-1,0,1/height,0,0,1,0,0,0,0,1);
  camera.projectionMatrix.premultiply(raster);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
