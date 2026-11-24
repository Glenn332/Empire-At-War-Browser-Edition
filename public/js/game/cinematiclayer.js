// The space cinematic layer: story scripts lift units far above the battle for staged shots.
export const SPACE_LAYER = 20000;

// Lifts a unit (or a squadron's fighters, or a company's members) onto the cinematic layer.
export function promoteToCinematicLayer(e) {
  const units = e.members?.length ? e.members : e.fighters?.length ? e.fighters : [e];
  for (const u of units) {
    if (u.point) u.point.z = (u.point.z || 0) + SPACE_LAYER;
    else u.z = (u.z || 0) + SPACE_LAYER;
    const object = u.obj || u.holder || u.grp;
    if (object) {
      object.position.z += SPACE_LAYER;
      object.updateMatrixWorld(true);
    }
    u.syncObj?.();
  }
}
