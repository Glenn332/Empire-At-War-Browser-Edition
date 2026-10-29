import * as THREE from 'three';
import { buildModel } from '../model.js';
import { loadALO } from '../alo.js';
import { loadParticles } from '../particles.js';

export class ShotModels {
  constructor(scene) {
    this.scene = scene;
    this.byFile = new Map();
    this.pools = [];
  }

  lookOf(P) {
    let look = P._shotModel;
    if (look === undefined) {
      const file = P.num('Projectile_Custom_Render', 0) > 0 ? '' : P.str('Space_Model_Name');
      look = P._shotModel = file ? { file: file.toUpperCase(), scale: P.num('Scale_Factor', 1) } : null;
    }
    if (!look) return null;
    const f = look.file;
    if (!this.byFile.has(f)) { this.byFile.set(f, null); this.load(f); }
    return this.byFile.get(f);
  }

  async load(file) {
    const data = await loadALO(file).catch(() => null);
    const parts = [], proxies = [];
    if (data && data.isParticle) proxies.push({ name: file, x: 0, y: 0, z: 0 });
    else if (data) {
      const inst = buildModel(data);
      inst.root.updateMatrixWorld(true);
      const byMat = new Map();
      for (const group of inst.meshByName.values()) {
        if (!group.parent || !group.visible) continue;
        let shown = true;
        for (let b = group.parent; b && b !== inst.root; b = b.parent) if (!b.visible) shown = false;
        if (!shown) continue;
        for (const mesh of group.children) {
          if (!mesh.isMesh) continue;
          let list = byMat.get(mesh.material);
          if (!list) byMat.set(mesh.material, (list = []));
          list.push(mesh);
        }
      }
      for (const [mat, meshes] of byMat) parts.push(this.pool(mat, meshes));
      for (const px of inst.proxies) {
        if (px.hidden) continue;
        const e = px.bone.matrixWorld.elements;
        proxies.push({ name: px.name, x: e[12], y: e[13], z: e[14] });
      }
    }
    const files = await Promise.all(proxies.map(px => Promise.resolve(loadParticles(px.name)).catch(() => null)));
    const live = proxies.filter((px, i) => files[i]);
    this.byFile.set(file, parts.length || live.length ? { parts, proxies: live } : null);
  }

  pool(mat, meshes) {
    const names = Object.keys(meshes[0].geometry.attributes).filter(k => meshes.every(m => m.geometry.attributes[k]));
    let nv = 0, ni = 0;
    for (const m of meshes) { nv += m.geometry.attributes.position.count; ni += m.geometry.index.count; }
    const out = {}, index = new Uint32Array(ni), _v = new THREE.Vector3(), _n = new THREE.Matrix3();
    for (const k of names) out[k] = new Float32Array(nv * meshes[0].geometry.attributes[k].itemSize);
    let v0 = 0, i0 = 0;
    for (const m of meshes) {
      const g = m.geometry, n = g.attributes.position.count;
      _n.getNormalMatrix(m.matrixWorld);
      for (const k of names) {
        const src = g.attributes[k], size = src.itemSize, dst = out[k];
        for (let i = 0; i < n; i++) {
          if (k === 'position') { _v.fromBufferAttribute(src, i).applyMatrix4(m.matrixWorld); _v.toArray(dst, (v0 + i) * 3); }
          else if (k === 'normal' || k === 'tangent' || k === 'binormal') { _v.fromBufferAttribute(src, i).applyMatrix3(_n).normalize(); _v.toArray(dst, (v0 + i) * 3); }
          else for (let c = 0; c < size; c++) dst[(v0 + i) * size + c] = src.array[i * size + c];
        }
      }
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) index[i0 + i] = idx[i] + v0;
      v0 += n; i0 += idx.length;
    }
    const geo = new THREE.BufferGeometry();
    for (const k of names) geo.setAttribute(k, new THREE.BufferAttribute(out[k], meshes[0].geometry.attributes[k].itemSize));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const p = { geo, mat, order: meshes[0].renderOrder, n: 0, cap: 0, im: null };
    this.size(p, 64);
    this.pools.push(p);
    return p;
  }

  size(p, cap) {
    const old = p.im;
    p.geo.setAttribute('instanceTint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    const im = new THREE.InstancedMesh(p.geo, p.mat, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false; im.matrixAutoUpdate = false; im.renderOrder = p.order; im.count = 0; im.visible = false;
    if (old) { im.instanceMatrix.array.set(old.instanceMatrix.array); this.scene.remove(old); old.dispose(); }
    this.scene.add(im);
    p.im = im; p.cap = cap;
  }

  begin() { for (const p of this.pools) p.n = 0; }

  add(parts, scale, x, y, z, dx, dy, dz) {
    let ux = -dz * dx, uy = -dz * dy, uz = 1 - dz * dz;
    const ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-4) { ux = 1; uy = 0; uz = 0; } else { ux /= ul; uy /= ul; uz /= ul; }
    const a0 = -(dy * uz - dz * uy) * scale, a1 = -(dz * ux - dx * uz) * scale, a2 = -(dx * uy - dy * ux) * scale;
    const b0 = -dx * scale, b1 = -dy * scale, b2 = -dz * scale;
    const c0 = ux * scale, c1 = uy * scale, c2 = uz * scale;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.n === p.cap) this.size(p, p.cap * 2);
      const o = p.im.instanceMatrix.array, k = p.n++ * 16;
      o[k] = a0; o[k + 1] = a1; o[k + 2] = a2; o[k + 3] = 0;
      o[k + 4] = b0; o[k + 5] = b1; o[k + 6] = b2; o[k + 7] = 0;
      o[k + 8] = c0; o[k + 9] = c1; o[k + 10] = c2; o[k + 11] = 0;
      o[k + 12] = x; o[k + 13] = y; o[k + 14] = z; o[k + 15] = 1;
    }
  }

  end() {
    for (const p of this.pools) {
      const im = p.im;
      im.count = p.n; im.visible = p.n > 0;
      if (!p.n) continue;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, p.n * 16); im.instanceMatrix.needsUpdate = true;
    }
  }
}

