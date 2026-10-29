import assert from 'node:assert/strict';
import * as THREE from 'three';
import { placeGalacticModel, renderGalacticScenes } from '../public/js/game/galacticscenes.js';
const root=new THREE.Group();
placeGalacticModel(root,{pos:[20,-180,-10],type:{num(k,d){assert.equal(k,'Scale_Factor');assert.equal(d,1);return 4.6;}}});
root.updateMatrixWorld(true);
const forward=new THREE.Vector3(1,0,0).applyMatrix4(root.matrixWorld);
assert.ok(forward.distanceTo(new THREE.Vector3(20,-175.4,-10))<1e-10);
assert.equal(root.rotation.x,0);assert.equal(root.rotation.y,0);
const main={name:'main',children:[{}]}, back={name:'background',children:[{}]}, mid={name:'midground',children:[{}]}, front={name:'midforeground',children:[{}]};
for (const saved of [true,false]) {
  const calls=[], camera={near:1,far:20000,updateProjectionMatrix(){}};
  const renderer={autoClear:saved,clear(){calls.push('clear');},clearDepth(){calls.push('depth');},render(scene,cam){assert.equal(this.autoClear,false);calls.push([scene.name,cam.near,cam.far]);}};
  renderGalacticScenes(renderer,camera,main,back,mid,front);
  assert.deepEqual(calls,['clear',['background',10,100000],'depth',['midground',10,100000],['midforeground',10,100000],['main',1,20000]]);
  assert.equal(renderer.autoClear,saved);assert.equal(camera.near,1);assert.equal(camera.far,20000);
  renderer.render=()=>{throw Error('draw failure');};
  assert.throws(()=>renderGalacticScenes(renderer,camera,main,back),/draw failure/);
  assert.equal(renderer.autoClear,saved);assert.equal(camera.near,1);assert.equal(camera.far,20000);
}
console.log('Galactic model pose and scene passes passed: native forward-axis turn, draw order, depth clear, temporary clips, renderer and camera restoration.');
