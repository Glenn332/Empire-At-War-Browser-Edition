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
    smokePerFrame: Math.max(2, Math.floor(12 / pressure)),
    // Transparent quads are fill-rate bound on integrated GPUs. Keep nearby combat readable
    // while reducing overlapping decorative glow area and emission in large fleets.
    glowScale: Math.max(0.45, 1 / Math.sqrt(pressure)),
    trailRate: Math.max(0.2, 1 / pressure),
    simpleParticles: Math.max(600, Math.floor(5000 / pressure))
  };
}

// Keep the nearest presentation items without repeatedly scanning the retained list.
// The retained list is sorted nearest-first; insertion is O(log budget + budget) with no per-item full scan.
export function retainNearest(out, item, distance, limit) {
  item.fxDistance = distance;
  if (!limit || (out.length >= limit && distance >= out[out.length - 1].fxDistance)) return;
  let lo = 0,
    hi = out.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (out[mid].fxDistance <= distance) lo = mid + 1;
    else hi = mid;
  }
  out.splice(lo, 0, item);
  if (out.length > limit) out.pop();
}

export function selectionTransformKey(selection, viewer) {
  let hash = 2166136261;
  const add = value => {
    hash = Math.imul(hash ^ (Math.round(value * 16) | 0), 16777619) >>> 0;
  };
  const textHash = value => {
    const s = String(value || '');
    for (let i = 0; i < s.length; i++) add(s.charCodeAt(i));
  };
  for (const selected of selection) {
    if (selected.dead || selected.isPad) continue;
    const units = selected.isSquad ? selected.fighters : [selected];
    for (const unit of units) {
      if (unit.dead) continue;
      add(unit.id || 0);
      add(unit.x);
      add(unit.y);
      add(unit.z || 0);
      add(unit.heading || 0);
      add(unit.ringSize || 0);
      add(unit.ringZ || 0);
      add(unit.player === viewer ? 1 : 0);
    }
    const heal = !selected.isSquad && selected.player === viewer ? selected.heal : null;
    if (heal?.blob && heal.range > 0) {
      textHash(heal.blob);
      add(heal.range);
    }
  }
  return hash;
}

export function commandBarStateKey(selection, world, player, ui, bar) {
  let hash = 2166136261;
  const add = value => {
    hash = Math.imul(hash ^ (value | 0), 16777619) >>> 0;
  };
  const text = value => {
    const s = String(value || '');
    for (let i = 0; i < s.length; i++) add(s.charCodeAt(i));
  };
  add(player.pop || 0);
  add(player.popCap || 0);
  add(player.techLevel || 0);
  add(player.reinforcements?.length || 0);
  text(ui.armed);
  add(ui.placing ? 1 : 0);
  add(bar.unitScroll || 0);
  add(bar.buildScroll || 0);
  for (const unit of world.units) {
    if (unit.dead) continue;
    for (const queue of unit.buildQueues?.values?.() || [])
      for (const item of queue) {
        add(unit.id || 0);
        text(item.type?.name);
        add(Math.ceil((item.left || 0) * 10));
      }
  }
  for (const unit of selection) {
    add(unit.id || 0);
    add(unit.dead ? 1 : 0);
    add(Math.round((unit.healthFrac || 0) * 10));
    add(unit.maxShield > 0 ? Math.round((unit.shield / unit.maxShield) * 100) : -1);
    add(unit.shieldBarDown ? 1 : 0);
    for (const ability of unit.abilities || []) {
      add(ability.active ? 1 : 0);
      add(ability.auto ? 1 : 0);
      add(Math.ceil((ability.cooldown || 0) * 10));
    }
  }
  return hash;
}

export function cinematicPresentation(game) {
  return !!(game?.cine?.on || game?.tacticalCinematics?.on);
}

export function workerCount(role, cores = globalThis.navigator?.hardwareConcurrency || 4) {
  const n = Math.max(1, cores | 0);
  if (role === 'scan') return n <= 4 ? 1 : Math.min(5, n - 3);
  if (role === 'routes') return n <= 4 ? 1 : Math.min(3, Math.floor(n / 3));
  if (role === 'collect') return n < 8 ? 0 : Math.min(2, n - 6);
  if (role === 'decode') return n <= 4 ? 1 : Math.min(3, n - 2);
  return 1;
}
