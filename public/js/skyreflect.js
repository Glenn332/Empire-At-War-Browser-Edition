import * as THREE from '../vendor/three/build/three.module.js';

export const SKY_FACE = 128;
export const SKY_FACES = [
  [1, 0, 0, 0, 0, 1],
  [-1, 0, 0, 0, 0, 1],
  [0, 1, 0, 0, 0, 1],
  [0, -1, 0, 0, 0, 1],
  [0, 0, 1, 0, 1, 0],
  [0, 0, -1, 0, 1, 0]
];

const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
black.needsUpdate = true;

export const skyAtlas = { value: black };

let target = null,
  eye = null;

export function renderSkyAtlas(renderer, sky) {
  if (!target) {
    target = new THREE.WebGLRenderTarget(SKY_FACE * 6, SKY_FACE, { depthBuffer: true });
    target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
    target.texture.generateMipmaps = false;
    target.texture.colorSpace = THREE.NoColorSpace;
    eye = new THREE.PerspectiveCamera(90, 1, 1, 1e7);
  }
  const kept = renderer.getRenderTarget(),
    keptClear = renderer.autoClear;
  const at = sky.children.map(d => d.position.clone());
  for (const d of sky.children) d.position.set(0, 0, 0);
  renderer.autoClear = false;
  target.viewport.set(0, 0, SKY_FACE * 6, SKY_FACE);
  renderer.setRenderTarget(target);
  renderer.clear();
  SKY_FACES.forEach(([fx, fy, fz, ux, uy, uz], i) => {
    eye.position.set(0, 0, 0);
    eye.up.set(ux, uy, uz);
    eye.lookAt(fx, fy, fz);
    eye.updateMatrixWorld(true);
    target.viewport.set(i * SKY_FACE, 0, SKY_FACE, SKY_FACE);
    renderer.setRenderTarget(target);
    renderer.render(sky, eye);
  });
  target.viewport.set(0, 0, SKY_FACE * 6, SKY_FACE);
  sky.children.forEach((d, i) => d.position.copy(at[i]));
  renderer.setRenderTarget(kept);
  renderer.autoClear = keptClear;
  skyAtlas.value = target.texture;
}

export function clearSkyAtlas() {
  skyAtlas.value = black;
}

export const skyTarget = () => target;
