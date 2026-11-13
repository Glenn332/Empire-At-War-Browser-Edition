import { MOD } from './combatmods.js';
import { db } from '../gamedata.js';

const KINDS = {
  COMBAT_MOD_DEFENSE: MOD.DEFENSE,
  COMBAT_MOD_DAMAGE: MOD.DAMAGE,
  COMBAT_MOD_HEALTH: MOD.HEALTH,
  COMBAT_MOD_SHIELD: MOD.SHIELD,
  COMBAT_MOD_ENERGY: MOD.ENERGY,
  COMBAT_MOD_SPEED: MOD.SPEED,
  COMBAT_MOD_FIRE_RATE: MOD.FIRE_RATE,
  COMBAT_MOD_SIGHT: MOD.SIGHT,
  COMBAT_MOD_FIRE_RANGE: MOD.RANGE,
  COMBAT_MOD_RANGE: MOD.RANGE
};
const cache = new WeakMap();
let keys = 0;

export function projectileMod(P) {
  if (!P || typeof P.str !== 'function') return null;
  if (cache.has(P)) return cache.get(P);
  const kind = KINDS[P.str('Projectile_Combat_Mod').trim().toUpperCase()],
    dur = P.num('Projectile_Combat_Mod_Duration', 0),
    value = P.num('Projectile_Combat_Mod_Value', 0);
  const pm =
    kind === undefined || !(dur > 0) || !value
      ? null
      : {
          type: kind,
          value,
          dur,
          key: 1000000 + ++keys,
          effect: P.str('Projectile_Combat_Mod_Effect').trim(),
          spaceFx: '',
          landFx: '',
          cats: P.list('Projectile_Combat_Mod_Category_Mask').map(c => c.toUpperCase())
        };
  if (pm && pm.effect) {
    const e = db.type(pm.effect);
    pm.spaceFx = e ? e.str('Space_Model_Name') || e.str('Land_Model_Name') : '';
    pm.landFx = e ? e.str('Land_Model_Name') || e.str('Space_Model_Name') : '';
  }
  cache.set(P, pm);
  return pm;
}

export class ProjectileMods {
  constructor() {
    this.live = [];
  }
  apply(time, u, P, add) {
    const pm = projectileMod(P);
    if (!pm || u.dead) return;
    if (pm.cats.length) {
      const own = u.type.categories();
      if (!pm.cats.some(c => own.has(c))) return;
    }
    for (const e of this.live)
      if (e.u === u && e.pm === pm) {
        add(u, pm, false);
        e.until = time + pm.dur;
        return true;
      }
    add(u, pm, true);
    this.live.push({ u, pm, until: time + pm.dur });
    return true;
  }
  tick(time, drop) {
    if (!this.live.length) return;
    let k = 0;
    for (const e of this.live) {
      if (e.u.dead) continue;
      if (time >= e.until) {
        drop(e.u, e.pm);
        continue;
      }
      this.live[k++] = e;
    }
    this.live.length = k;
  }
}
