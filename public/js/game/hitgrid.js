// The units a shot can hit, filed by map cell (ours). Every step files thousands of units and every shot looks up the
// cells it crosses, so the cells of the map are one block of numbers: for each cell and list, where its run of units
// starts in one long array. A unit is named by its place in the caller's list, and each run keeps that order. Cells
// off the map (a unit or shot that strayed past the edge) are kept in a small map of their own.

export class HitGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.lists = 1;
    this.minX = 0;
    this.minY = 0;
    this.width = 0;
    this.height = 0;
    this.starts = new Int32Array(1);
    this.cursors = new Int32Array(1);
    this.items = new Int32Array(0);
    this.spans = new Int32Array(0);
    this.outside = new Map();
    // what find() found
    this.source = this.items;
    this.from = 0;
    this.to = 0;
  }

  // Files units 0..count-1, each over the cells its reach touches. With ownList, a unit goes into every list but its
  // own (the lists are teams: a team's list holds what that team's shots can hit); without, into the one list.
  // The map's cells run from (fromX, fromY) to (toX, toY) in map units.
  build(count, centreX, centreY, reach, ownList, lists, fromX, fromY, toX, toY) {
    const size = this.cellSize,
      minX = (this.minX = Math.floor(fromX / size)),
      minY = (this.minY = Math.floor(fromY / size)),
      width = (this.width = Math.floor(toX / size) - minX + 1),
      height = (this.height = Math.floor(toY / size) - minY + 1),
      runs = width * height * lists;
    this.lists = lists;
    this.outside.clear();
    if (this.starts.length < runs + 1) {
      this.starts = new Int32Array(runs + 1);
      this.cursors = new Int32Array(runs + 1);
    }
    if (this.spans.length < count * 4) this.spans = new Int32Array(Math.max(4096, count * 8));
    const starts = this.starts,
      spans = this.spans;
    starts.fill(0, 0, runs + 1);
    let filed = 0;
    for (let unit = 0; unit < count; unit++) {
      const x0 = Math.floor((centreX[unit] - reach[unit]) / size),
        x1 = Math.floor((centreX[unit] + reach[unit]) / size),
        y0 = Math.floor((centreY[unit] - reach[unit]) / size),
        y1 = Math.floor((centreY[unit] + reach[unit]) / size),
        own = ownList ? ownList[unit] : -1;
      spans[unit * 4] = x0;
      spans[unit * 4 + 1] = x1;
      spans[unit * 4 + 2] = y0;
      spans[unit * 4 + 3] = y1;
      for (let cellX = x0; cellX <= x1; cellX++)
        for (let cellY = y0; cellY <= y1; cellY++) {
          const column = cellX - minX,
            row = cellY - minY,
            onMap = column >= 0 && column < width && row >= 0 && row < height,
            run = onMap ? (column * height + row) * lists : 0;
          for (let list = 0; list < lists; list++) {
            if (list === own) continue;
            if (onMap) {
              starts[run + list + 1]++;
              filed++;
            } else this.fileOutside(cellX, cellY, list, unit);
          }
        }
    }
    for (let run = 0; run < runs; run++) starts[run + 1] += starts[run];
    if (this.items.length < filed) this.items = new Int32Array(Math.max(4096, filed * 2));
    const items = this.items,
      cursors = this.cursors;
    cursors.set(starts.subarray(0, runs + 1));
    for (let unit = 0; unit < count; unit++) {
      const x0 = Math.max(spans[unit * 4], minX),
        x1 = Math.min(spans[unit * 4 + 1], minX + width - 1),
        y0 = Math.max(spans[unit * 4 + 2], minY),
        y1 = Math.min(spans[unit * 4 + 3], minY + height - 1),
        own = ownList ? ownList[unit] : -1;
      for (let cellX = x0; cellX <= x1; cellX++)
        for (let cellY = y0; cellY <= y1; cellY++) {
          const run = ((cellX - minX) * height + (cellY - minY)) * lists;
          for (let list = 0; list < lists; list++) if (list !== own) items[cursors[run + list]++] = unit;
        }
    }
  }

  fileOutside(cellX, cellY, list, unit) {
    const key = (cellX * 65536 + cellY) * this.lists + list;
    let units = this.outside.get(key);
    if (!units) this.outside.set(key, (units = []));
    units.push(unit);
  }

  // The units of one cell's list: true when there are any, and then they are source[from] to source[to - 1].
  find(cellX, cellY, list) {
    const column = cellX - this.minX,
      row = cellY - this.minY;
    if (column >= 0 && column < this.width && row >= 0 && row < this.height) {
      const run = (column * this.height + row) * this.lists + list;
      this.source = this.items;
      this.from = this.starts[run];
      this.to = this.starts[run + 1];
      return this.to > this.from;
    }
    if (!this.outside.size) return false;
    const units = this.outside.get((cellX * 65536 + cellY) * this.lists + list);
    if (!units) return false;
    this.source = units;
    this.from = 0;
    this.to = units.length;
    return true;
  }
}
