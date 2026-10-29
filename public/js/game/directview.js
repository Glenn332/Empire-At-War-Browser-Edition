import * as THREE from 'three';

const MAX = 12000;
const STEP = 0.06;

export class ArcView {
  constructor(scene) {
    const fillGeo = new THREE.BufferGeometry(),
      edgeGeo = new THREE.BufferGeometry();
    this.fill = new Float32Array(MAX * 3);
    this.edge = new Float32Array(MAX * 3);
    fillGeo.setAttribute('position', new THREE.BufferAttribute(this.fill, 3).setUsage(THREE.DynamicDrawUsage));
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(this.edge, 3).setUsage(THREE.DynamicDrawUsage));
    this.fillMesh = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff7a3a,
        transparent: true,
        opacity: 0.1,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    this.edgeMesh = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: 0xffa060, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false })
    );
    for (const m of [this.fillMesh, this.edgeMesh]) {
      m.frustumCulled = false;
      m.renderOrder = 9;
      m.visible = false;
      scene.add(m);
    }
  }

  update(arcs, zOf = null) {
    if (!arcs.length && !this.fillMesh.visible) return;
    let f = 0,
      e = 0;
    const F = this.fill,
      E = this.edge;
    const put = (A, i, x, y, z) => {
      A[i] = x;
      A[i + 1] = y;
      A[i + 2] = z;
      return i + 3;
    };
    const zz = (x, y, z) => (zOf ? zOf(x, y) : z);
    for (const c of arcs) {
      const full = c.half >= Math.PI - 1e-3,
        n = Math.max(4, Math.ceil((2 * c.half) / STEP));
      if ((f + n * 9) / 3 > MAX || (e + (n + 2) * 6) / 3 > MAX) break;
      const cz = zz(c.x, c.y, c.z);
      let px = c.x + Math.cos(c.a - c.half) * c.r,
        py = c.y + Math.sin(c.a - c.half) * c.r,
        pz = zz(px, py, c.z);
      if (!full) {
        e = put(E, e, c.x, c.y, cz);
        e = put(E, e, px, py, pz);
      }
      for (let i = 1; i <= n; i++) {
        const a = c.a - c.half + (2 * c.half * i) / n,
          qx = c.x + Math.cos(a) * c.r,
          qy = c.y + Math.sin(a) * c.r,
          qz = zz(qx, qy, c.z);
        f = put(F, f, c.x, c.y, cz);
        f = put(F, f, px, py, pz);
        f = put(F, f, qx, qy, qz);
        e = put(E, e, px, py, pz);
        e = put(E, e, qx, qy, qz);
        px = qx;
        py = qy;
        pz = qz;
      }
      if (!full) {
        e = put(E, e, px, py, pz);
        e = put(E, e, c.x, c.y, cz);
      }
    }
    const k = 1 / Math.sqrt(Math.max(1, arcs.length / 2));
    this.fillMesh.material.opacity = 0.1 * k;
    this.edgeMesh.material.opacity = 0.55 * Math.max(0.35, k);
    const fg = this.fillMesh.geometry,
      eg = this.edgeMesh.geometry;
    fg.setDrawRange(0, f / 3);
    eg.setDrawRange(0, e / 3);
    fg.attributes.position.needsUpdate = true;
    eg.attributes.position.needsUpdate = true;
    this.fillMesh.visible = this.edgeMesh.visible = f > 0;
  }
}
