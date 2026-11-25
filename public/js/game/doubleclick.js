// A second click on about the same spot within the system double-click time. The Windows default is half a second and
// the double-click rectangle is a few pixels either way; both are looser here so a mouse hand is not punished.
export const DOUBLE_CLICK_MS = 500;
export const DOUBLE_CLICK_PX = 8;

export class DoubleClick {
  constructor() {
    this.last = null;
  }

  // True when this click is the second of a pair; the next click then starts a new pair.
  hit(x, y, now = performance.now()) {
    const l = this.last;
    if (l && now - l.t <= DOUBLE_CLICK_MS && Math.hypot(x - l.x, y - l.y) <= DOUBLE_CLICK_PX) {
      this.last = null;
      return true;
    }
    this.last = { t: now, x, y };
    return false;
  }
}
