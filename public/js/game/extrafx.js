import { lighting, boltLights } from '../model.js';
import { lensMaterial } from './lens.js';

export const GRADE = { bloom: 0.4, cutoff: 0.96, sun: 0.12, sat: 1.08, contrast: 1.06, vignette: 0.22 };
export const BOLT = { slots: 16 };

export const extraFxOn = () => !!globalThis.extraFx;

export function gradeLens(u) {
  const sc = lighting.sunColor.value,
    top = Math.max(1e-3, sc.r, sc.g, sc.b),
    k = GRADE.sun;
  u.tint.value.setRGB(1 + (sc.r / top - 1) * k, 1 + (sc.g / top - 1) * k, 1 + (sc.b / top - 1) * k);
  u.sat.value = GRADE.sat;
  u.contrast.value = GRADE.contrast;
  u.vignette.value = GRADE.vignette;
}

export function useGrade(P, on) {
  if (on === !!P.extraLens) return;
  if (on) {
    const lens = (P.extraLens = lensMaterial());
    P.finish = mid => {
      const u = lens.uniforms;
      u.map.value = mid.texture;
      u.texel.value.set(1 / mid.width, 1 / mid.height);
      gradeLens(u);
      P.pass(lens, null);
    };
  } else {
    P.finish = null;
    P.extraLens = null;
  }
  if (P.w) P.resize(P.w, P.h);
}

const tints = new WeakMap();
export function boltTint(def, r = 1, g = 1, b = 1) {
  if (r < 0.99 || g < 0.99 || b < 0.99) return [r, g, b];
  let t = tints.get(def);
  if (!t) {
    const n = def && def.name ? def.name : '';
    t = /green/i.test(n) ? [0.35, 1, 0.4] : /blue/i.test(n) ? [0.4, 0.6, 1] : /red/i.test(n) ? [1, 0.3, 0.2] : [1, 0.65, 0.3];
    tints.set(def, t);
  }
  return t;
}

export class BoltFeed {
  constructor(slots = BOLT.slots) {
    this.slots = slots;
    this.d = new Float64Array(slots);
    this.v = Array.from({ length: slots }, () => new Float32Array(8));
    this.n = 0;
    this.worst = 0;
  }
  begin(x, y, z, reach = Infinity) {
    this.ex = x;
    this.ey = y;
    this.ez = z;
    this.r2 = reach * reach;
    this.n = 0;
    this.worst = 0;
  }
  add(x, y, z, radius, r, g, b, power, bias = 1, prio = -1) {
    const d2 = prio >= 0 ? prio : ((x - this.ex) ** 2 + (y - this.ey) ** 2 + (z - this.ez) ** 2) * bias;
    if (d2 > this.r2) return;
    let i;
    if (this.n < this.slots) i = this.n++;
    else if (d2 < this.d[this.worst]) i = this.worst;
    else return;
    this.d[i] = d2;
    const v = this.v[i];
    v[0] = x;
    v[1] = y;
    v[2] = z;
    v[3] = radius;
    v[4] = r;
    v[5] = g;
    v[6] = b;
    v[7] = power;
    if (this.n === this.slots) {
      let w = 0;
      for (let k = 1; k < this.n; k++) if (this.d[k] > this.d[w]) w = k;
      this.worst = w;
    }
  }
  end(ground = null) {
    const A = boltLights.boltAt.value,
      T = boltLights.boltTint.value,
      n = Math.min(this.n, A.length, this.slots);
    for (let i = 0; i < n; i++) {
      const v = this.v[i];
      A[i].set(v[0], v[1], v[2], v[3]);
      T[i].set(v[4], v[5], v[6], v[7]);
    }
    boltLights.boltN.value = n;
    if (ground) {
      const G = ground.glowAt.value,
        C = ground.glowTint.value;
      for (let i = 0; i < G.length; i++) {
        if (i < n) {
          const v = this.v[i];
          G[i].set(v[0], v[1], v[2], v[3]);
          C[i].set(v[4], v[5], v[6], v[7]);
        } else G[i].w = 0;
      }
    }
  }
}

export function clearBolts(ground = null) {
  boltLights.boltN.value = 0;
  if (ground) for (const g of ground.glowAt.value) g.w = 0;
}
