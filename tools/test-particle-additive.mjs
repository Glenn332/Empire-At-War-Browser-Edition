import assert from 'node:assert/strict';

globalThis.Worker = class {
  postMessage() {}
  terminate() {}
};
const THREE = await import('../public/vendor/three/build/three.module.js');
const { ParticleManager } = await import('../public/js/particles.js');
const { families } = await import('../public/js/gpu/programs.js');

const pm = new ParticleManager(new THREE.Scene());
pm.prepare({ compile() {} }, null);
const [normal, additive, heat] = pm.kept.map(b => b.material);

assert.equal(additive.blending, THREE.CustomBlending, 'additive particles blend by factors');
assert.equal(additive.blendSrc, THREE.OneFactor, 'source factor one');
assert.equal(additive.blendDst, THREE.OneFactor, 'destination factor one');
const addMain = additive.fragmentShader.slice(additive.fragmentShader.indexOf('void main'));
assert.match(addMain, /texture2D\(map, vUv\)\.rgb \* vTint\.rgb/, 'additive colour is the texture colour times the vertex colour');
assert.doesNotMatch(addMain, /\.a\b|\.w\b/, 'additive colour ignores the texture and vertex alphas');

assert.match(normal.fragmentShader, /texture2D\(map, vUv\) \* vTint/, 'alpha particles keep the texture times the vertex colour with its alpha');
assert.equal(normal.blending, THREE.NormalBlending, 'alpha particles keep the alpha blend');
assert.match(heat.fragmentShader, /t\.a \* vTint\.a/, 'heat keeps its alpha');

const fam = families.find(f => f.name === 'particles');
assert.ok(fam, 'particle program family');
for (const [m, kind] of [
  [additive, 'add'],
  [normal, 'normal'],
  [heat, 'heat']
]) {
  assert.ok(fam.match(m), 'family matches the ' + kind + ' batch');
  assert.equal(fam.key(m), 'particles|' + kind, 'WebGPU kind of the ' + kind + ' batch');
}
const wgsl = fam.code(additive);
const fs = wgsl.slice(wgsl.indexOf('@fragment'));
assert.match(fs, /textureSample\(mapT, mapS, v\.vUv\)\.rgb \* v\.vTint\.rgb, 1\.0\)/, 'WebGPU additive colour is the texture colour times the vertex colour');
assert.doesNotMatch(fs, /\.a\b/, 'WebGPU additive colour ignores both alphas');

console.log('particle additive: ok');
