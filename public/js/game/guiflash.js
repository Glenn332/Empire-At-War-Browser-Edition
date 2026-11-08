import * as THREE from 'three';
import { db } from '../gamedata.js';

const clock = () => performance.now() / 1000;

export function objectFlash(u, mode) {
  const C = db.constants,
    level = C ? C.num('GUI_Flash_Level', 3) : 3,
    period = mode === 3 ? (C ? C.num('GUI_Rapid_Flash_Duration', 0.1) : 0.1) : C ? C.num('GUI_Flash_Duration', 0.4) : 0.4;
  u.guiFlash = mode ? { tint: new THREE.Vector4(level, level, level, -1), period: Math.max(0.01, period), count: mode === 1 ? 1 : 3, start: clock() } : null;
  const root = u.holder || u.mesh || u.inst?.root || u.obj;
  if (!root) return false;
  if (u.guiFlashRoot === root) return true;
  u.guiFlashRoot = root;
  root.traverse(o => {
    const m = o.material;
    if (!o.isMesh || !m || !m.uniforms || !m.uniforms.tint) return;
    const before = o.onBeforeRender,
      after = o.onAfterRender;
    let saved = null;
    o.onBeforeRender = function (...a) {
      before.apply(this, a);
      const f = u.guiFlash;
      if (!f) return;
      const phase = Math.floor((clock() - f.start) / f.period);
      if (phase >= f.count * 2) {
        u.guiFlash = null;
        return;
      }
      if (phase % 2) return;
      saved = this.material.uniforms.tint.value;
      this.material.uniforms.tint.value = f.tint;
      this.material.uniformsNeedUpdate = true;
    };
    o.onAfterRender = function (...a) {
      after.apply(this, a);
      if (!saved) return;
      this.material.uniforms.tint.value = saved;
      this.material.uniformsNeedUpdate = true;
      saved = null;
    };
  });
  return true;
}
