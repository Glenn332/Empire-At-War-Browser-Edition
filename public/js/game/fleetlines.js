import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadTexture } from '../dds.js';
import { visibleTransit } from './galacticfog.js';
import { routeAxes } from './galacticroutes.js';

const WIDTH = 2;
const VERT = `
attribute vec3 aColor;
varying vec2 vUv;
varying vec3 vColor;
void main() { vUv = uv; vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
uniform sampler2D map;
varying vec2 vUv;
varying vec3 vColor;
void main() { gl_FragColor = texture2D(map, vUv) * vec4(vColor, 1.0); }`;

export class FleetLines {
  constructor(scene) {
    this.scene = scene; this.capacity = 0; this.mesh = null;
    this.texture = db.constants.str('Fleet_Movement_Line_Texture_Name').trim() || 'w_galaxy_line.tga';
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { map: { value: loadTexture(this.texture, { repeat: false }) } } });
  }

  grow(n) {
    this.mesh && (this.scene.remove(this.mesh), this.mesh.geometry.dispose());
    this.capacity = Math.max(64, n * 2);
    const cap = this.capacity, index = new Uint32Array(cap * 6), uv = new Float32Array(cap * 8);
    for (let i = 0; i < cap; i++) { const b = i * 4; index.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6); uv.set([1, 1, 0, 1, 1, 0, 0, 0], i * 8); }
    const geo = new THREE.BufferGeometry();
    this.position = new Float32Array(cap * 12); this.color = new Float32Array(cap * 12);
    geo.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geo, this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; this.scene.add(this.mesh);
  }

  update(galaxy, viewer, colorOf) {
    const shown = this.shown || (this.shown = []);
    shown.length = 0;
    for (const f of galaxy.fleets) if (f.leg && f.units.length && visibleTransit(galaxy, f, viewer)) shown.push(f);
    const n = shown.length;
    if (n > this.capacity || !this.mesh) this.grow(n);
    let q = 0;
    for (const f of shown) {
      const A = f.pos, B = f.leg.to, across = routeAxes(A, B).across, c = colorOf(f.owner), o = q * 12;
      for (let v = 0; v < 4; v++) {
        const P = v < 2 ? A : B, s = v & 1 ? 1 : -1;
        for (let k = 0; k < 3; k++) { this.position[o + v * 3 + k] = P[k] + across[k] * s * WIDTH / 2; this.color[o + v * 3 + k] = c[k]; }
      }
      q++;
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, q * 6);
    if (q || this.drawn) { g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; }
    this.drawn = q;
  }
}
