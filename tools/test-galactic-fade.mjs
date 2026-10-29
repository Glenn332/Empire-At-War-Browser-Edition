import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { openGame } from './megfs.mjs';
import { GalacticModelFade, galacticDistanceFade } from '../public/js/game/galacticfade.js';
import { placeGalacticModel } from '../public/js/game/galacticscenes.js';

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
close(galacticDistanceFade(10, 200, 10), 0.1);
close(galacticDistanceFade(60, 200, 10), 0.55);
close(galacticDistanceFade(110, 200, 10), 1);
close(galacticDistanceFade(1000, 200, 10), 1);
close(galacticDistanceFade(0, 200, 10), 0.1);
close(galacticDistanceFade(10, 200, 10, true), 1);

const source = new THREE.ShaderMaterial({ uniforms: { opacity: { value: 0.8 }, time: { value: 4 } }, transparent: true });
function fixture(excluded = false) {
  const root = new THREE.Group(),
    bone = new THREE.Group();
  root.add(bone);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), source);
  bone.add(mesh);
  bone.position.x = 30;
  const inst = {
    root,
    bones: [bone],
    poseVersion: 0,
    model: {
      meshes: [
        { bone: 0, bbox: [-3, -4, -12, 3, 4, 12], hidden: true },
        { bone: -1, bbox: [-1, -1, -1, 1, 1, 1] }
      ]
    }
  };
  root.updateMatrixWorld(true);
  return {
    inst,
    mesh,
    fade: new GalacticModelFade(
      inst,
      {
        bool: k => {
          assert.equal(k, 'Exclude_From_Distance_Fade');
          return excluded;
        }
      },
      true
    )
  };
}
const a = fixture(),
  b = fixture(true),
  camera = new THREE.PerspectiveCamera(45, 1, 10, 1000),
  renderer = { info: { render: { frame: 1 } } };
camera.position.set(0, 0, 10);
camera.updateMatrixWorld(true);
a.mesh.onBeforeRender(renderer, null, camera);
b.mesh.onBeforeRender(renderer, null, camera);
close(a.mesh.material.uniforms.opacity.value, 0.08);
close(b.mesh.material.uniforms.opacity.value, 0.8);
close(source.uniforms.opacity.value, 0.8);
assert.notEqual(a.mesh.material, b.mesh.material);
assert.equal(a.mesh.material.uniforms.time, source.uniforms.time);
assert.equal(a.mesh.material.side, THREE.FrontSide);
assert.deepEqual(a.fade.box.min.toArray(), [-1, -4, -12]);
assert.deepEqual(a.fade.box.max.toArray(), [33, 4, 12]);
a.inst.bones[0].position.x = 60;
a.inst.poseVersion++;
a.inst.root.updateMatrixWorld(true);
renderer.info.render.frame++;
a.mesh.onBeforeRender(renderer, null, camera);
assert.equal(a.fade.box.max.x, 63);
camera.near = 1;
a.mesh.onBeforeRender(renderer, null, camera);
assert(a.fade.value > 0.1, 'Temporary camera clip changes must invalidate the fade');
camera.position.set(1000, 0, 0);
camera.updateMatrixWorld(true);
renderer.info.render.frame++;
a.mesh.onBeforeRender(renderer, null, camera);
close(a.mesh.material.uniforms.opacity.value, 0.8);

const opaque = fixture();
const opaqueSource = new THREE.ShaderMaterial({ uniforms: { opacity: { value: 1 } }, depthWrite: true });
opaque.mesh.material = opaqueSource;
opaque.mesh.onBeforeRender = () => {};
const opaqueFade = new GalacticModelFade(opaque.inst, { bool: () => false });
camera.position.set(0, 0, 10);
camera.near = 10;
camera.updateMatrixWorld(true);
renderer.info.render.frame++;
opaque.mesh.onBeforeRender(renderer, null, camera);
assert.equal(opaque.mesh.material.transparent, false);
assert.equal(opaque.mesh.material.depthWrite, true);
assert.equal(opaque.mesh.material.blending, THREE.CustomBlending);
assert.equal(opaque.mesh.material.blendSrc, THREE.SrcAlphaFactor);
assert.equal(opaque.mesh.material.blendDst, THREE.OneMinusSrcAlphaFactor);
camera.position.z = 1000;
camera.updateMatrixWorld(true);
renderer.info.render.frame++;
opaque.mesh.onBeforeRender(renderer, null, camera);
assert.equal(opaque.mesh.material.blending, opaqueSource.blending);

const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input),
    key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, ''))),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { loadALO } = await import('../public/js/alo.js');
const { buildModel } = await import('../public/js/model.js');
const model = await loadALO('w_galaxy00.alo');
assert(model);
const inst = buildModel(model);
placeGalacticModel(inst.root, { pos: [20, -180, -10], type: { num: () => 4.6 } });
inst.root.updateMatrixWorld(true);
const fade = new GalacticModelFade(inst, { bool: () => false }, true);
camera.position.set(0, -918.4308365543867, 702.0872766248555);
camera.near = 10;
camera.updateMatrixWorld(true);
renderer.info.render.frame++;
fade.update(renderer.info.render.frame, camera);
assert(fade.value > 0.1 && fade.value < 1);
if (mod >= 0) {
  close(fade.half.length() * 4.6, 6455.93834, 0.02);
  close(fade.value, 0.31136723, 0.00001);
}
console.log(
  JSON.stringify({
    mod: mod >= 0,
    fade: fade.value,
    half: fade.half.toArray(),
    passed:
      'Native distance fade, near clips, XML exclusion, authored hidden/transparent bounds, bone changes and independent material opacity'
  })
);
