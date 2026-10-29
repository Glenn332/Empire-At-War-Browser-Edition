import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { openGame } from './megfs.mjs';
import { effectInfo, selectEffectTechnique, effectLOD } from '../public/js/fxo.js';
import { GalacticModelFade } from '../public/js/game/galacticfade.js';
const mod = process.argv.indexOf('--mod'),
  archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input),
    key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, ''))),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { loadALO } = await import('../public/js/alo.js'),
  { buildModel } = await import('../public/js/model.js'),
  { gfx } = await import('../public/js/gfx.js');
const { preparePlanetPortrait, portraitBounds, portraitViewport, alignPortraitPixels } = await import(
  '../public/js/game/planetportrait.js'
);
const bytes = archive.read(archive.resolve('Data/Art/Shaders/Planet.fxo')),
  buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  effect = effectInfo(buffer);
assert.deepEqual(
  [0, 1, 2, 3].map(d => selectEffectTechnique(effect, d).name),
  ['t0', 't0', 'sph_t2', 'sph_t3']
);
assert.equal(effect.techniques.at(-1).passes[1].annotations.AlamoCleanup, 1);
assert.equal(effectInfo(buffer.slice(0, -16)).techniques.length, 0, 'Truncated effect is rejected atomically');
const technique = (name, annotations) => ({ name, annotations, passes: [] });
const caps = {
  techniques: [
    technique('max_viewport', {}),
    technique('a', { LOD: 'DX9', VENDOR_FILTER_0: 123 }),
    technique('b', { LOD: 'DX8ATI', WaterLOD: 'DX9' }),
    technique('c', { LOD: 'FIXEDFUNCTION' })
  ]
};
assert.equal(selectEffectTechnique(caps, 3, { vendor: 123, water: 0 }).name, 'c');
assert.equal(selectEffectTechnique(caps, 3, { validate: t => t.name !== 'a' }).name, 'b');
assert.equal(effectLOD('unknown'), 3);
const firstPlanet = inst => {
  let result;
  inst.root.traverse(o => {
    if (o.isMesh && o.material.userData.planet && !result) result = o.material;
  });
  return result;
};
const deferred = new THREE.ShaderMaterial({ uniforms: { opacity: { value: 1 } } });
let resolved;
deferred.userData = { planet: true, ready: new Promise(r => (resolved = r)) };
const deferredRoot = new THREE.Group(),
  deferredMesh = new THREE.Mesh(new THREE.PlaneGeometry(), deferred);
deferredRoot.add(deferredMesh);
new GalacticModelFade({ root: deferredRoot, bones: [], model: { meshes: [] } }, { bool: () => true });
deferred.defines = { PLANET_FIXED: 1 };
deferred.userData.planetTechnique = 't0';
resolved();
await deferredMesh.material.userData.ready;
assert.deepEqual(deferredMesh.material.defines, { PLANET_FIXED: 1 });
assert.equal(deferredMesh.material.userData.planetTechnique, 't0');
const model = await loadALO('W_planet_Forest01.alo');
assert(model);
const source = buildModel(model, { alts: [0, 2] });
new GalacticModelFade(source, { bool: () => true }, true);
source.root.position.set(8, 12, 16);
source.root.scale.set(2, 3, 4);
source.root.rotation.z = 0.6;
source.bones[0].position.x += 500;
source.bones[0].quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.2);
source.syncFromBones();
const sourceMaterial = firstPlanet(source);
sourceMaterial.uniforms.opacity.value = 0.4;
sourceMaterial.uniforms.lightScale.value = new THREE.Vector4(0.7, 0.8, 0.9, 0.6);
const summary = await preparePlanetPortrait(source),
  info = await preparePlanetPortrait(source, { info: true });
for (const portrait of [summary, info]) {
  assert.deepEqual(portrait.inst.bones[0].position.toArray(), portrait.inst.bones[0].userData.rest.p.toArray());
  assert.deepEqual(portrait.inst.root.position.toArray(), [8, 12, 16]);
  assert.deepEqual(portrait.inst.root.scale.toArray(), [2, 3, 4]);
  assert(
    [...portrait.inst.meshByName.keys()].some(n => /_ALT1(?!\d)/.test(n)),
    'Native ALT1 portrait geometry is built'
  );
  assert(![...portrait.inst.meshByName.keys()].some(n => /_ALT[02](?!\d)/.test(n)));
  const material = firstPlanet(portrait.inst);
  assert.equal(material.uniforms.sunDir, sourceMaterial.uniforms.sunDir, 'Capture keeps temporary native environment bindings');
  assert.equal(material.side, THREE.BackSide);
  assert.equal(material.depthWrite, true);
  assert.equal(material.transparent, false);
}
assert.equal(firstPlanet(summary.inst).uniforms.opacity.value, 0.4);
assert.deepEqual(firstPlanet(summary.inst).uniforms.lightScale.value.toArray(), [0.7, 0.8, 0.9, 0.6]);
assert.equal(firstPlanet(summary.inst).blending, THREE.CustomBlending);
assert.equal(firstPlanet(info.inst).uniforms.opacity.value, 1);
assert.deepEqual(firstPlanet(info.inst).uniforms.lightScale.value.toArray(), [1, 1, 1, 1]);
assert.equal(firstPlanet(info.inst).blending, THREE.NormalBlending);
assert.equal(sourceMaterial.uniforms.opacity.value, 0.4);
const local = new THREE.Box3(),
  part = new THREE.Box3(),
  matrix = new THREE.Matrix4(),
  bones = [];
for (const b of model.bones) {
  const m = b.matrix;
  const o = new THREE.Object3D();
  o.matrix.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
  o.matrixAutoUpdate = false;
  bones.push(o);
}
const root = new THREE.Group();
model.bones.forEach((b, i) => (b.parent < 0 ? root : bones[b.parent]).add(bones[i]));
root.updateMatrixWorld(true);
for (const m of model.meshes) {
  if (!m.bbox) continue;
  part.min.fromArray(m.bbox);
  part.max.fromArray(m.bbox, 3);
  local.union(part.applyMatrix4(bones[m.bone]?.matrixWorld || matrix.identity()));
}
const expected = local.applyMatrix4(summary.inst.root.matrixWorld),
  actual = portraitBounds(summary.inst);
assert(
  expected.min.distanceTo(actual.min) < 1e-5 && expected.max.distanceTo(actual.max) < 1e-5,
  'Full authored rest bounds include hidden/ALT/transparent children'
);
const alternate = {
  ...model,
  meshes: model.meshes.filter(m => /_ALT1(?!\d)/i.test(m.name)).flatMap(m => [m, { ...m, name: m.name.replace(/_ALT1/i, '_ALT12') }])
};
const twelve = buildModel(alternate, { alt: 12 });
assert(twelve.meshByName.size > 0);
assert([...twelve.meshByName.keys()].every(n => /_ALT12/.test(n)));
for (const detail of [0, 1, 2, 3]) {
  gfx.shader = detail;
  const inst = buildModel(model, { alt: 1 }),
    m = firstPlanet(inst);
  await m.userData.ready;
  assert.equal(m.userData.planetTechnique, detail < 2 ? 't0' : detail === 2 ? 'sph_t2' : 'sph_t3');
  assert.equal(
    m.uniforms.cloudMap.value.anisotropy,
    detail < 2 ? 1 : mod < 0 ? 1 : 16,
    'Fixed stage1 inherits global linear state, not sampler parameter anisotropy'
  );
}
gfx.shader = 3;
const pair = mod < 0 ? ['W_planet_Forest01.alo', 'W_planet_wayland_low.alo'] : ['w_planet_tatooine_low.alo', 'w_planet_tatooine_high.alo'];
const instances = await Promise.all(pair.map(async name => buildModel(await loadALO(name), { alts: true }))),
  materials = instances.map(firstPlanet);
assert(materials.every(Boolean));
const values = mod < 0 ? 'cityColor' : 'specular';
assert.notEqual(materials[0], materials[1]);
assert.notDeepEqual(materials[0].uniforms[values].value.toArray(), materials[1].uniforms[values].value.toArray());
assert.equal(
  firstPlanet(buildModel(instances[0].model, { alts: true })),
  materials[0],
  'Identical authored materials still share cache entries'
);
const camera = new THREE.PerspectiveCamera(40, 1, 1, 100),
  point = new THREE.Vector4(0.2, 0.4, -5, 1),
  before = point.clone().applyMatrix4(camera.projectionMatrix);
alignPortraitPixels(camera, 128, 512);
const after = point.clone().applyMatrix4(camera.projectionMatrix);
assert(Math.abs(after.x / after.w - before.x / before.w - 1 / 128) < 1e-10);
assert(Math.abs(after.y / after.w + before.y / before.w - 1 / 512) < 1e-10);
assert.deepEqual(portraitViewport([0.129, 0.752, 0.876, 0.249], 512, 512), [66, 63, 319, 321]);
assert.deepEqual(portraitViewport([0, 1, 1, 0], 128, 128), [0, 0, 128, 128]);
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { capturePlanet } = await import('../public/js/game/planetinfo.js'),
  { captureSummaryPlanet } = await import('../public/js/game/galacticsummary.js');
const { lighting, planetLighting } = await import('../public/js/model.js');
const environment = () =>
  JSON.stringify(
    [lighting, planetLighting].map(uniforms =>
      Object.fromEntries(
        Object.entries(uniforms).map(([key, u]) => [
          key,
          u.value?.isTexture ? u.value.uuid : u.value?.toArray ? u.value.toArray() : u.value
        ])
      )
    )
  );
for (const capture of [capturePlanet, captureSummaryPlanet]) {
  const previous = { target: true },
    viewport = new THREE.Vector4(3, 7, 101, 93),
    color = new THREE.Color(0.3, 0.4, 0.5);
  const state = { target: previous, viewport: viewport.clone(), color: color.clone(), alpha: 0.75 },
    before = environment();
  let copies = 0,
    disposed = 0;
  const nativeVec = db.constants.vec;
  db.constants.vec = function (key, def) {
    return key === 'Battle_Load_Planet_Viewport' ? [0.125, 0.75, 0.875, 0.25] : nativeVec.call(this, key, def);
  };
  const renderer = {
    getRenderTarget: () => state.target,
    getViewport: v => v.copy(state.viewport),
    getClearColor: c => c.copy(state.color),
    getClearAlpha: () => state.alpha,
    setRenderTarget: t => (state.target = t),
    setViewport: (...args) => (args[0]?.isVector4 ? state.viewport.copy(args[0]) : state.viewport.set(...args)),
    setClearColor: (c, a) => {
      state.color.set(c);
      state.alpha = a;
    },
    clear: () => {},
    render: (scene, camera) => {
      assert(camera.projectionMatrix.elements[5] < 0, 'Portrait projection uses native top-down coverage');
      if (capture === capturePlanet)
        assert.deepEqual(
          state.viewport.toArray(),
          [64, 64, 320, 320],
          'Native XML viewport is left/right/top/bottom, with top-down origin'
        );
      scene.traverse(o => {
        if (o.isMesh) {
          copies++;
          o.material.addEventListener('dispose', () => disposed++);
        }
      });
      throw new Error('Test render failure');
    }
  };
  try {
    await assert.rejects(capture({ renderer, planetViews: [{ inst: source }] }, { index: 0 }), /Test render failure/);
  } finally {
    db.constants.vec = nativeVec;
  }
  assert.equal(environment(), before);
  assert.equal(state.target, previous);
  assert.deepEqual(state.viewport.toArray(), viewport.toArray());
  assert.deepEqual(state.color.toArray(), color.toArray());
  assert.equal(state.alpha, 0.75);
  assert(copies > 0 && disposed === copies);
}
summary.dispose();
info.dispose();
console.log({
  mod: mod >= 0,
  result:
    'native FXO selection, pass cleanup, resources, ALT1 rest captures, full bounds, LightScale/opacity, multi-digit ALT, real material-cache collisions, pixel centers and failed-render restoration passed'
});
