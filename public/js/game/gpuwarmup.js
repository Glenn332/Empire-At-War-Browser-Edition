import * as THREE from 'three';

// One batch per turn. A whole fleet can have hundreds of geometry/material pairs: compiling
// and drawing all of them in one call freezes WebKitGTK when a cinematic hands back to play.
// Give the browser a chance to paint between batches. A zero-delay timer alone may run
// several queued jobs before the next animation frame on WebKitGTK.
const nextTurn = () =>
  new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 100); // hidden tabs still finish their preparation
    } else setTimeout(resolve, 0);
  });

export function uploadGpuTextures(renderer, batches, uploaded = new WeakSet()) {
  if (!renderer?.initTexture) return;
  const textures = new Set();
  for (const batch of batches) {
    const material = (batch.im || batch).material;
    if (material?.uniforms)
      for (const uniform of Object.values(material.uniforms)) {
        const texture = uniform?.value;
        if (texture?.isTexture) textures.add(texture);
      }
    if (material?.map?.isTexture) textures.add(material.map);
  }
  for (const texture of textures) {
    if (uploaded.has(texture) || !(texture.image || texture.mipmaps?.length)) continue;
    uploaded.add(texture);
    try {
      renderer.initTexture(texture);
    } catch {}
  }
}

export async function warmGpuBatches(renderer, camera, batches, uploaded = new WeakSet(), target = null) {
  if (!renderer?.render || !renderer?.setRenderTarget || !batches.length) return;
  // Mirror/WebGPU renderers compile on their own render thread; a tiny Three.js WebGL
  // framebuffer does not belong to them. Only the direct WebGL renderer needs that draw.
  if (!renderer.isWebGLRenderer) return;
  uploadGpuTextures(renderer, batches, uploaded);
  const previous = renderer.getRenderTarget?.() || null;
  // Reuse the target across turns; allocating a framebuffer is not free either.
  const owned = !target;
  target ||= new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
  try {
    for (const batch of batches) {
      const source = batch.im || batch;
      if (!source.geometry || !source.material) continue;
      const mesh = source.isInstancedMesh ? new THREE.InstancedMesh(source.geometry, source.material, 1) : new THREE.Mesh(source.geometry, source.material);
      mesh.frustumCulled = false;
      const scene = new THREE.Scene();
      scene.add(mesh);
      try {
        renderer.setRenderTarget(target);
        if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
        else renderer.compile?.(scene, camera);
        // compileAsync waits for KHR_parallel_shader_compile where available; this small real
        // draw also covers drivers whose completion reporting is unreliable.
        renderer.render(scene, camera);
      } finally {
        scene.clear();
        renderer.setRenderTarget(previous);
      }
      await nextTurn();
    }
  } finally {
    renderer.setRenderTarget(previous);
    if (owned) target.dispose();
  }
}

