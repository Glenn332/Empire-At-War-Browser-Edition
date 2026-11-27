// Presentation-only policies for large battles. None of these affect simulation or multiplayer state.
export function projectedRadius(radius, distance, viewportHeight, fovDegrees) {
  return (radius * viewportHeight) / Math.max(1, 2 * distance * Math.tan((fovDegrees * Math.PI) / 360));
}

export function visualDetail(radiusPixels) {
  if (radiusPixels < 5) return 0; // glow/icon-scale: no hardpoint posing or decorative emitters
  if (radiusPixels < 14) return 1; // simplified presentation and low-frequency turret posing
  return 2;
}

export function importantShadowCaster(unit) {
  if (!unit.casters || unit.squad || unit.isFighter) return false;
  // Fighters and small corvettes are numerous and contribute little at tactical camera distances.
  return (unit.visualRadius || 0) >= 45;
}

export function shadowDue(now, previous, intervalMs = 1000 / 15) {
  return previous === undefined || now - previous >= intervalMs;
}

export function effectBudget(totalUnits) {
  // Large fleets retain every gameplay projectile, but decorative trails/models have bounded work.
  const pressure = Math.max(1, totalUnits / 160);
  return {
    shotModels: Math.max(180, Math.floor(700 / pressure)),
    shotEffects: Math.max(100, Math.floor(400 / pressure)),
    smokePerFrame: Math.max(2, Math.floor(12 / pressure))
  };
}

export function workerCount(role, cores = globalThis.navigator?.hardwareConcurrency || 4) {
  const n = Math.max(1, cores | 0);
  if (role === 'scan') return n <= 4 ? 1 : Math.min(5, n - 3);
  if (role === 'routes') return n <= 4 ? 1 : Math.min(3, Math.floor(n / 3));
  if (role === 'collect') return n < 8 ? 0 : Math.min(2, n - 6);
  if (role === 'decode') return n <= 4 ? 1 : Math.min(3, n - 2);
  return 1;
}
