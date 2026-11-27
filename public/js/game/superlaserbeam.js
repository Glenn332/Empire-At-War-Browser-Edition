import * as THREE from 'three';
import { loadTexture } from '../dds.js';

const MAX_BEAMS = 8;
const _camera = new THREE.Vector3(),
  _along = new THREE.Vector3(),
  _side = new THREE.Vector3();

// The superlaser line, as the original game draws it: a camera-facing strip Line_Width wide from the owner's bone to
// the target, its Beam_Texture_Name repeating every Line_Width units along the beam and stepping one of
// Num_Anim_Frames each drawn frame, tinted with Line_Color.
export class SuperLaserBeams {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map();
    this.frame = 0;
  }

  meshFor(texture) {
    const key = texture.toUpperCase();
    let mesh = this.meshes.get(key);
    if (mesh) return mesh;
    const positions = new Float32Array(MAX_BEAMS * 12),
      uvs = new Float32Array(MAX_BEAMS * 8),
      colors = new Float32Array(MAX_BEAMS * 16),
      index = new Uint32Array(MAX_BEAMS * 6);
    for (let i = 0; i < MAX_BEAMS; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: loadTexture(texture) } },
      vertexShader:
        'attribute vec4 color; varying vec4 vColor; varying vec2 vUv; void main() { vColor = color; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform sampler2D map; varying vec4 vColor; varying vec2 vUv; void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vColor.rgb * vColor.a, 1.0); }',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.count = 0;
    this.scene.add(mesh);
    this.meshes.set(key, mesh);
    return mesh;
  }

  // beams: [{ from, to, width, color, texture, frames }]
  update(beams, camera) {
    this.frame++;
    camera.getWorldPosition(_camera);
    for (const mesh of this.meshes.values()) mesh.count = 0;
    for (const beam of beams) {
      const mesh = this.meshFor(beam.texture);
      if (mesh.count >= MAX_BEAMS) continue;
      const slot = mesh.count++,
        { from, to, width } = beam,
        geometry = mesh.geometry;
      _along.subVectors(to, from);
      const length = _along.length() || 1;
      _side.subVectors(_camera, from).cross(_along).normalize().multiplyScalar(width / 2);
      geometry.attributes.position.array.set(
        [
          from.x + _side.x, from.y + _side.y, from.z + _side.z,
          from.x - _side.x, from.y - _side.y, from.z - _side.z,
          to.x + _side.x, to.y + _side.y, to.z + _side.z,
          to.x - _side.x, to.y - _side.y, to.z - _side.z
        ],
        slot * 12
      );
      const frames = Math.max(1, beam.frames),
        offset = (this.frame % frames) / frames,
        repeats = length / Math.max(1, width);
      geometry.attributes.uv.array.set([offset, 0, offset, 1, offset + repeats, 0, offset + repeats, 1], slot * 8);
      const [r, g, b] = beam.color;
      for (let v = 0; v < 4; v++) geometry.attributes.color.array.set([r, g, b, 1], slot * 16 + v * 4);
    }
    for (const mesh of this.meshes.values()) {
      const geometry = mesh.geometry;
      geometry.setDrawRange(0, mesh.count * 6);
      mesh.visible = mesh.count > 0;
      if (mesh.count) geometry.attributes.position.needsUpdate = geometry.attributes.uv.needsUpdate = geometry.attributes.color.needsUpdate = true;
    }
  }
}
