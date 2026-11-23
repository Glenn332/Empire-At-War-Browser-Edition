import { Vector3 } from 'three';
import { CAT } from './projflight.js';

// One visual launch per local projectile. Freeze its rendered origin on the
// first drawn frame, not the simulation tick. Never move a hit or network shot.
export class MuzzleLaunches {
  constructor() {
    this.live = new WeakMap();
    this.focused = new WeakSet();
  }
  start(s, source, focus = false) {
    if (!source || !s.w || s.w !== source.weapon) return null;
    const i = s.w.fixed >= 0 ? s.w.fixed : s.w.turn,
      kit = !!source.root;
    const node = kit ? source.barrels?.[i] || source.muzzle : source === s.from && s.w.muzzles?.[i]?.bone;
    if (!node) return null;
    const tip = node.getWorldPosition(new Vector3());
    this.live.set(s, { source, kit, node, tip, focus, axis: new Vector3(), pose: {} });
    if (focus) this.focused.add(s);
    return tip;
  }
  sample(s, source) {
    const l = this.live.get(s);
    if (!l) return s;
    if (source !== l.source || s.turned) {
      this.live.delete(s);
      return s;
    }
    if (!l.first) {
      l.node.getWorldPosition(l.tip);
      l.first = { x: s.x, y: s.y, z: s.z };
      l.axis.set(s.aimX - l.tip.x, s.aimY - l.tip.y, s.aimZ - l.tip.z).normalize();
      if (!l.focus && l.kit) l.axis.copy(source.axis).transformDirection(source.root.matrixWorld);
      l.range = Math.min(75, Math.max(2, Math.hypot(s.aimX - l.tip.x, s.aimY - l.tip.y, s.aimZ - l.tip.z) || 75));
      // A focused blaster traces one straight line from the visible muzzle to
      // its real aim point. Do not bend it along the viewmodel's angled bore
      // and then back across the sight; do not straighten rockets or lobbed shots.
      if (l.focus && !s.arc && (s.cat === CAT.LASER || s.cat === CAT.DEFAULT)) {
        const dx = s.aimX - s.x,
          dy = s.aimY - s.y,
          dz = s.aimZ - s.z;
        if (dx * s.vx + dy * s.vy + dz * s.vz > 0) {
          l.converge = Math.hypot(dx, dy, dz);
          l.range = Math.min(l.range, l.converge);
        }
      }
    }
    const d = Math.hypot(s.x - l.first.x, s.y - l.first.y, s.z - l.first.z),
      t = d / (l.converge || l.range);
    if (t >= 1) {
      this.live.delete(s);
      return s;
    }
    const speed = Math.hypot(s.vx, s.vy, s.vz),
      p = l.pose;
    if (l.converge) {
      const dx = l.tip.x - l.first.x,
        dy = l.tip.y - l.first.y,
        dz = l.tip.z - l.first.z;
      p.x = s.x + dx * (1 - t);
      p.y = s.y + dy * (1 - t);
      p.z = s.z + dz * (1 - t);
      p.vx = s.vx - (dx * speed) / l.converge;
      p.vy = s.vy - (dy * speed) / l.converge;
      p.vz = s.vz - (dz * speed) / l.converge;
    } else {
      const w = t * t * (3 - 2 * t),
        dw = (6 * t * (1 - t) * speed) / l.range,
        ax = l.tip.x + l.axis.x * d,
        ay = l.tip.y + l.axis.y * d,
        az = l.tip.z + l.axis.z * d;
      p.x = ax + (s.x - ax) * w;
      p.y = ay + (s.y - ay) * w;
      p.z = az + (s.z - az) * w;
      p.vx = l.axis.x * speed * (1 - w) + s.vx * w + (s.x - ax) * dw;
      p.vy = l.axis.y * speed * (1 - w) + s.vy * w + (s.y - ay) * dw;
      p.vz = l.axis.z * speed * (1 - w) + s.vz * w + (s.z - az) * dw;
    }
    const n = Math.min(1, d / l.range);
    p.launch = 1 - n * n * (3 - 2 * n);
    p.near = l.kit ? p.launch : 0; // world-scale barrels never use viewmodel scale
    return p;
  }
}
