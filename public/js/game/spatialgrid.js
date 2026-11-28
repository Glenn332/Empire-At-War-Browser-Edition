// Incremental multi-cell obstacle index. Cell arrays retain their identity for fighter-move packing.
// Quiet frames reuse each obstacle's key array and write no grid cells.
export function rebuildObstacleGrid(state, units, cellSize, padding, inLookTree, cullOf) {
  const grid = state.grid || (state.grid = new Map()),
    obstacles = state.obstacles || (state.obstacles = []),
    memberships = state.memberships || (state.memberships = new Map()),
    present = state.present || (state.present = new Set());
  present.clear();
  let n = 0,
    changed = state.cellSize !== cellSize;
  if (changed) {
    grid.clear();
    memberships.clear();
  }
  state.cellSize = cellSize;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    unit.gridAt = i;
    if (unit.dead || unit.hyper || !inLookTree(unit.type)) continue;
    present.add(unit);
    obstacles[n++] = unit;
    const c = cullOf(unit),
      radius = Math.max(unit.radius || 0, unit.hitRadius || 0, unit.collR || 0, c ? Math.hypot(c[0] - unit.x, c[1] - unit.y) + Math.hypot(c[3], c[4]) : 0) + padding;
    const before = memberships.get(unit),
      x0 = Math.floor((unit.x - radius) / cellSize),
      x1 = Math.floor((unit.x + radius) / cellSize),
      y0 = Math.floor((unit.y - radius) / cellSize),
      y1 = Math.floor((unit.y + radius) / cellSize),
      count = radius > padding ? (x1 - x0 + 1) * (y1 - y0 + 1) : 0;
    if (!before || before.x0 !== x0 || before.x1 !== x1 || before.y0 !== y0 || before.y1 !== y1 || before.count !== count) {
      changed = true;
      if (before) for (const key of before.keys) remove(grid, key, unit);
      const keys = [];
      if (count)
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++) {
            const key = x * 65536 + y;
            keys.push(key);
            let list = grid.get(key);
            if (!list) grid.set(key, (list = []));
            list.push(unit);
          }
      memberships.set(unit, { x0, x1, y0, y1, count, keys });
    }
  }
  obstacles.length = n;
  for (const [unit, record] of memberships) {
    if (!present.has(unit)) {
      changed = true;
      for (const key of record.keys) remove(grid, key, unit);
      memberships.delete(unit);
    }
  }
  // Newly inserted units are appended in world order. Existing cells already retain that order.
  if (changed) for (const list of grid.values()) if (list.length > 1) list.sort((a, b) => a.gridAt - b.gridAt);
  state.rebuilds = (state.rebuilds || 0) + (changed ? 1 : 0);
  return state;
}

function remove(grid, key, unit) {
  const list = grid.get(key);
  if (!list) return;
  const at = list.indexOf(unit);
  if (at >= 0) list.splice(at, 1);
}
