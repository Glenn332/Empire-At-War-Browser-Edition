import trap from '../pointertrap.js';

export const TRACK_LOOK = 0.004;

const centre = { x: 0, y: 0, z: 0 };

function middle(e, list) {
  let x = 0,
    y = 0,
    z = 0,
    n = 0;
  for (const u of list)
    if (!u.dead && Number.isFinite(u.x)) {
      x += u.x;
      y += u.y;
      z += u.z || 0;
      n++;
    }
  centre.x = n ? x / n : e.x;
  centre.y = n ? y / n : e.y;
  centre.z = n ? z / n : e.z || 0;
  return centre;
}

export class TrackCam {
  constructor(dom, onLost) {
    this.dom = dom;
    this.onLost = onLost;
    this.on = false;
    this.locked = false;
    this.target = dom;
    this.lockChange = () => {
      const held = !!document.pointerLockElement && document.pointerLockElement === this.target;
      if (this.locked && !held && this.on) this.onLost();
      this.locked = held;
    };
    this.hold = () => {
      if (!this.on || !trap.locked) return;
      trap.x = innerWidth / 2;
      trap.y = innerHeight / 2;
    };
    document.addEventListener('pointerlockchange', this.lockChange);
    addEventListener('mousemove', this.hold);
  }

  focus(e) {
    const list = (e.isSquad ? e.fighters : e.members) || [e];
    if (!this.whole && list.length > 1) {
      const l = this.lead;
      if (!l || l.dead || l.inside || !list.includes(l))
        this.lead = list.find(u => !u.dead && !u.inside && !u.foot) || list.find(u => !u.dead && !u.inside) || null;
      if (this.lead) return this.lead;
    }
    return middle(e, list);
  }

  start(whole = false) {
    this.whole = whole;
    this.lead = null;
    if (this.on) return;
    this.on = true;
    document.body.classList.add('track-cam');
    if (trap.locked) {
      this.target = document.pointerLockElement;
      this.locked = true;
      this.hold();
    } else {
      this.target = this.dom;
      this.relock();
    }
  }

  relock() {
    if (!this.on || this.locked || document.pointerLockElement) return;
    try {
      this.dom.requestPointerLock?.()?.catch?.(() => {});
    } catch {}
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    this.lead = null;
    document.body.classList.remove('track-cam');
    this.locked = false;
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  destroy() {
    this.stop();
    document.removeEventListener('pointerlockchange', this.lockChange);
    removeEventListener('mousemove', this.hold);
  }
}
