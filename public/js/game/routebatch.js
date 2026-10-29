import * as THREE from 'three';
import { ROUTE_SPARK_SEEDS, routeSparkFraction } from './galacticroutes.js';

const QUAD_VERT = `
attribute float side;
attribute vec3 aAcross;
attribute float aWidth;
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = uv; vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + aAcross * side * aWidth * .5, 1.0);
}`;
const SPARK_VERT = `
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
void main() { vUv = uv; vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
void main() { gl_FragColor = texture2D(map, vUv) * vColor; }`;
const SPARKS = ROUTE_SPARK_SEEDS.length;

export class RouteBatches {
  constructor(scene, texture, blendOf) { this.scene = scene; this.texture = texture; this.blendOf = blendOf; this.groups = []; }

  key(look) { return look.texture + '|' + this.blendOf(look) + '|' + look.spark; }

  clear() {
    for (const g of this.groups) { this.scene.remove(g.mesh); g.mesh.geometry.dispose(); g.mesh.material.dispose(); }
    this.groups = [];
  }

  build(routes) {
    this.clear();
    const quads = new Map(), sparks = new Map();
    for (const rt of routes) {
      rt.qw = rt.qr = rt.qg = rt.qb = rt.qa = rt.sr = rt.sg = rt.sb = rt.sa = undefined;
      const blending = this.blendOf(rt.look), qk = rt.look.texture + '|' + blending, sk = rt.look.spark;
      (quads.get(qk) || quads.set(qk, { texture: rt.look.texture, blending, routes: [] }).get(qk)).routes.push(rt);
      (sparks.get(sk) || sparks.set(sk, { texture: sk, routes: [] }).get(sk)).routes.push(rt);
    }
    for (const spec of quads.values()) this.addQuads(spec);
    for (const spec of sparks.values()) this.addSparks(spec);
    this.dirty = false;
  }

  addQuads({ texture, blending, routes }) {
    const n = routes.length, position = new Float32Array(n * 12), sideA = new Float32Array(n * 4), uv = new Float32Array(n * 8), across = new Float32Array(n * 12), width = new Float32Array(n * 4), color = new Float32Array(n * 16), index = new Uint32Array(n * 6);
    routes.forEach((rt, i) => {
      position.set([...rt.A, ...rt.A, ...rt.B, ...rt.B], i * 12); sideA.set([-1, 1, -1, 1], i * 4); uv.set([1, 1, 0, 1, 1, 0, 0, 0], i * 8);
      for (let v = 0; v < 4; v++) across.set(rt.axes.across, i * 12 + v * 3);
      const b = i * 4; index.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6);
      rt.quad = { base: i * 4, group: null };
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3)); geo.setAttribute('side', new THREE.BufferAttribute(sideA, 1)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aAcross', new THREE.BufferAttribute(across, 3));
    geo.setAttribute('aWidth', new THREE.BufferAttribute(width, 1).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('aColor', new THREE.BufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending, side: THREE.DoubleSide, uniforms: { map: { value: this.texture(texture) } } }));
    mesh.frustumCulled = false; mesh.renderOrder = 3; this.scene.add(mesh);
    const group = { mesh, width, color, geo, dirty: false }; this.groups.push(group);
    for (const rt of routes) rt.quad.group = group;
  }

  addSparks({ texture, routes }) {
    const n = routes.length, per = SPARKS * 4, position = new Float32Array(n * per * 3), uv = new Float32Array(n * per * 2), color = new Float32Array(n * per * 4), index = new Uint32Array(n * SPARKS * 6);
    routes.forEach((rt, i) => {
      for (let s = 0; s < SPARKS; s++) { uv.set([1, 1, 0, 1, 1, 0, 0, 0], (i * per + s * 4) * 2); const b = i * per + s * 4; index.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], (i * SPARKS + s) * 6); }
      rt.spark = { base: i * per, group: null };
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage)); geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: SPARK_VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { map: { value: this.texture(texture) } } }));
    mesh.frustumCulled = false; mesh.renderOrder = 4; this.scene.add(mesh);
    const group = { mesh, position, color, geo, dirty: false, positionDirty: false }; this.groups.push(group);
    for (const rt of routes) rt.spark.group = group;
  }

  setQuad(rt, width, r, g, b, a) {
    const q = rt.quad, w = q.group.width, c = q.group.color, i = q.base;
    if (rt.qw === width && rt.qr === r && rt.qg === g && rt.qb === b && rt.qa === a) return;
    rt.qw = width; rt.qr = r; rt.qg = g; rt.qb = b; rt.qa = a;
    for (let v = 0; v < 4; v++) { w[i + v] = width; c.set([r, g, b, a], (i + v) * 4); }
    q.group.dirty = true;
  }

  setSparkColor(rt, r, g, b, a) {
    const s = rt.spark, c = s.group.color, first = s.base;
    if (rt.sr === r && rt.sg === g && rt.sb === b && rt.sa === a) return;
    rt.sr = r; rt.sg = g; rt.sb = b; rt.sa = a;
    for (let v = 0; v < SPARKS * 4; v++) c.set([r, g, b, a], (first + v) * 4);
    s.group.dirty = true;
  }

  moveSparks(rt, ticks) {
    const s = rt.spark, p = s.group.position, x = rt.axes.across, z = rt.axes.along, A = rt.A, B = rt.B;
    for (let i = 0; i < SPARKS; i++) {
      const t = routeSparkFraction(ROUTE_SPARK_SEEDS[i], ticks);
      for (let j = 0; j < 4; j++) {
        const sx = (j & 1 ? 1 : -1) * 1.75, sz = (j & 2 ? 1 : -1) * 1.75, o = (s.base + i * 4 + j) * 3;
        p[o] = A[0] + (B[0] - A[0]) * t + x[0] * sx + z[0] * sz;
        p[o + 1] = A[1] + (B[1] - A[1]) * t + x[1] * sx + z[1] * sz;
        p[o + 2] = A[2] + (B[2] - A[2]) * t + z[2] * sz;
      }
    }
    s.group.positionDirty = true;
  }

  flush() {
    for (const g of this.groups) {
      if (g.dirty) { if (g.width) g.geo.attributes.aWidth.needsUpdate = true; g.geo.attributes.aColor.needsUpdate = true; g.dirty = false; }
      if (g.positionDirty) { g.geo.attributes.position.needsUpdate = true; g.positionDirty = false; }
    }
  }
}
