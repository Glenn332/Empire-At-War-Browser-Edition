export function placeGalacticModel(root, planet) {
  root.position.set(...planet.pos);
  root.rotation.set(0, 0, Math.PI / 2);
  root.scale.setScalar(planet.type.num('Scale_Factor', 1));
}

export function renderGalacticScenes(renderer, camera, main, background, midground, midforeground) {
  const autoClear = renderer.autoClear, near = camera.near, far = camera.far;
  const restoreClip = () => { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); };
  const distant = scene => {
    camera.near = 10; camera.far = 100000; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    restoreClip();
  };
  try {
    renderer.autoClear = false;
    renderer.clear();
    if (background?.children.length) distant(background);
    renderer.clearDepth();
    if (midground?.children.length) distant(midground);
    if (midforeground?.children.length) distant(midforeground);
    renderer.render(main, camera);
  } finally {
    if (camera.near !== near || camera.far !== far) restoreClip();
    renderer.autoClear = autoClear;
  }
}
