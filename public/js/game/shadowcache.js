// Reuse a shadow map only while its camera and every caster's actual world matrix stay unchanged.
// Unit position alone is insufficient: turrets, hardpoints and idle animations also cast shadows.
// Camera motion changes the lookup matrix every frame, but must not bypass the dynamic redraw budget.
export function shadowCacheKey(camera, units, castsShadow, scene) {
  const c = camera.matrixWorldInverse.elements,
    p = camera.projectionMatrix.elements;
  let cameraHash = 2166136261,
    casterHash = 2166136261;
  const addCamera = value => {
    cameraHash = Math.imul(cameraHash ^ value, 16777619) >>> 0;
  };
  const addCaster = value => {
    casterHash = Math.imul(casterHash ^ value, 16777619) >>> 0;
  };
  for (let i = 0; i < 16; i++) {
    addCamera(floatBits(c[i]));
    addCamera(floatBits(p[i]));
  }
  let count = 0;
  for (const unit of units) {
    if (unit.dead || !unit.casters || !castsShadow(unit)) continue;
    const visible = unit.obj.visible || unit.instStamp > 0;
    if (!visible) continue;
    count++;
    addCaster(unit.id || 0);
    for (const mesh of unit.casters) {
      const entry = mesh.userData.instEntry,
        derived = entry && unit.instStatic && unit.obj.parent === scene,
        e = derived ? unit.obj.matrix.elements : mesh.matrixWorld.elements;
      if (derived) for (let i = 0; i < 16; i++) addCaster(floatBits(entry.local.elements[i]));
      for (let i = 0; i < 16; i++) addCaster(floatBits(e[i]));
    }
  }
  return `${count}:${cameraHash}:${casterHash}`;
}

export function shadowRedrawDue(now, previous, intervalMs = 1000 / 15) {
  return previous === undefined || now - previous >= intervalMs - 1e-6;
}

const floats = new Float32Array(1),
  bits = new Uint32Array(floats.buffer);
function floatBits(value) {
  floats[0] = value;
  return bits[0];
}
