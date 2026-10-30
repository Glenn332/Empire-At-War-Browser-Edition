import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadModel } from '../model.js';

export function beaconType(faction) {
  const name = faction ? faction.str('Multiplayer_Beacon_Type').trim() : '';
  return name ? db.type(name) : null;
}

export class Beacons {
  constructor() {
    this.list = [];
    this.last = new Map();
  }

  ready(owner, now) {
    const prev = this.last.get(owner);
    return prev === undefined || now - prev >= Math.max(0, db.constants.num('BeaconPlaceDelay', 5000)) / 1000;
  }

  place(owner, type, x, y, z, now) {
    if (!type || !this.ready(owner, now)) return null;
    this.last.set(owner, now);
    this.list = this.list.filter(b => b.owner !== owner && b.until > now);
    const b = { owner, type, x, y, z, until: now + type.num('Beacon_Lifetime_In_Secs', 10) };
    this.list.push(b);
    return b;
  }

  live(now) {
    return this.list.filter(b => b.until > now);
  }
}

export class BeaconView {
  constructor(scene, modelTag, { colorOf = null, onModel = null } = {}) {
    this.scene = scene;
    this.modelTag = modelTag;
    this.colorOf = colorOf;
    this.onModel = onModel;
    this.shown = new Map();
  }

  update(list) {
    const keep = new Set(list);
    for (const [b, holder] of this.shown)
      if (!keep.has(b)) {
        this.scene.remove(holder);
        this.shown.delete(b);
      }
    for (const b of list) {
      if (this.shown.has(b)) continue;
      const holder = new THREE.Group();
      holder.position.set(b.x, b.y, b.z);
      this.scene.add(holder);
      this.shown.set(b, holder);
      const file = b.type.str(this.modelTag).trim();
      if (file)
        loadModel(file, { teamColor: this.colorOf?.(b.owner) || undefined })
          .then(inst => {
            if (!inst || this.shown.get(b) !== holder) return;
            holder.add(inst.root);
            this.onModel?.(inst, file);
          })
          .catch(() => {});
    }
  }

  clear() {
    this.update([]);
  }
}
