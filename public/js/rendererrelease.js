import * as THREE from '../vendor/three/build/three.module.js';

// three hangs a 'dispose' handler of each WebGL renderer on every texture, material, geometry and render target that
// renderer draws. Those objects are shared through the texture, material and model caches and outlive a battle, so
// the handlers kept every finished battle's renderer in memory, and with it the last camera and scene it drew. The
// objects that get such a handler are noted here, and a renderer that is put away takes its handlers off all of them.
const holders = new Set();
const noted = new WeakSet();
const add = THREE.EventDispatcher.prototype.addEventListener;
THREE.EventDispatcher.prototype.addEventListener = function (type, listener) {
  if (type === 'dispose' && !noted.has(this)) {
    noted.add(this);
    holders.add(new WeakRef(this));
  }
  return add.call(this, type, listener);
};

export function dropDisposeHandlers(handlers) {
  if (!handlers.size) return;
  for (const ref of holders) {
    const o = ref.deref();
    if (!o) {
      holders.delete(ref);
      continue;
    }
    const list = o._listeners?.dispose;
    if (list) for (const fn of list.slice()) if (handlers.has(fn)) o.removeEventListener('dispose', fn);
  }
}

// the renderer's handlers are found by having it draw one small thing of its own into a target of its own; that also
// leaves it holding this throwaway camera and scene instead of the battle's
function handlersOf(renderer) {
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  tex.needsUpdate = true;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const target = new THREE.WebGLRenderTarget(1, 1);
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, new THREE.Camera());
    renderer.setRenderTarget(null);
  } catch {}
  const found = new Set();
  for (const o of [tex, geo, mat, target, target.texture]) for (const fn of o._listeners?.dispose || []) found.add(fn);
  for (const o of [geo, mat, tex, target]) o.dispose();
  return found;
}

// call before the renderer is disposed and its context let go: a renderer without a context draws nothing
export function releaseRenderer(renderer) {
  if (!renderer?.isWebGLRenderer) return;
  dropDisposeHandlers(handlersOf(renderer));
}
