import * as THREE from 'three';

export function galacticDistanceFade(distance, radius, near, excluded = false) {
  if (excluded) return 1;
  const d = distance - near;
  const t = d <= 0 ? 0 : radius <= 0 ? 1 : Math.min(1, d / (radius * 0.5));
  return 0.1 + 0.9 * t * t * (3 - 2 * t);
}

export class GalacticModelFade {
  constructor(inst, type, singleSided = false) {
    this.inst = inst;
    this.excluded = type.bool('Exclude_From_Distance_Fade');
    this.entries = inst.model.meshes
      .filter(m => m.bbox)
      .map(m => ({
        bone: inst.bones[m.bone] || inst.root,
        box: new THREE.Box3(new THREE.Vector3(...m.bbox.slice(0, 3)), new THREE.Vector3(...m.bbox.slice(3, 6)))
      }));
    this.box = new THREE.Box3();
    this.half = new THREE.Vector3();
    this.inverse = new THREE.Matrix4();
    this.boneMatrix = new THREE.Matrix4();
    this.part = new THREE.Box3();
    this.pose = -1;
    this.frame = -1;
    this.camera = null;
    this.near = -1;
    this.value = 1;
    this.tint = new THREE.Vector3(1, 1, 1);
    inst.fade = this;
    const materials = new Map();
    inst.root.traverse(o => {
      if (!o.isMesh) return;
      const source = o.material;
      let material = materials.get(source);
      if (!material) {
        material = source.clone();
        material.userData = { ...source.userData };
        if (source.userData.planet && source.userData.ready)
          material.userData.ready = source.userData.ready.then(() => {
            if (JSON.stringify(material.defines) !== JSON.stringify(source.defines)) {
              material.defines = { ...source.defines };
              material.needsUpdate = true;
            }
            material.userData.planetTechnique = source.userData.planetTechnique;
          });
        material.uniforms = {
          ...source.uniforms,
          ...(source.uniforms.opacity ? { opacity: { value: source.uniforms.opacity.value } } : {}),
          ...(source.uniforms.lightScale ? { lightScale: { value: source.uniforms.lightScale.value.clone() } } : {})
        };
        if (!source.transparent) {
          material.blendSrc = THREE.SrcAlphaFactor;
          material.blendDst = THREE.OneMinusSrcAlphaFactor;
          material.blendEquation = THREE.AddEquation;
        }
        if (singleSided) material.side = THREE.FrontSide;
        materials.set(source, material);
      }
      o.material = material;
      const before = o.onBeforeRender;
      o.onBeforeRender = (renderer, scene, camera, geometry, drawMaterial, group) => {
        before.call(o, renderer, scene, camera, geometry, drawMaterial, group);
        this.update(renderer.info.render.frame, camera);
        if (material.uniforms.lightScale) {
          const s = source.uniforms.lightScale.value,
            L = material.uniforms.lightScale.value,
            t = this.tint;
          if (L.x !== s.x * t.x || L.y !== s.y * t.y || L.z !== s.z * t.z || L.w !== s.w) {
            L.set(s.x * t.x, s.y * t.y, s.z * t.z, s.w);
            material.uniformsNeedUpdate = true;
          }
        }
        if (material.uniforms.opacity) {
          const opacity = source.uniforms.opacity.value * this.value;
          if (material.uniforms.opacity.value !== opacity) {
            material.uniforms.opacity.value = opacity;
            material.uniformsNeedUpdate = true;
          }
          if (!source.transparent)
            material.blending = opacity * (material.uniforms.lightScale?.value.w ?? 1) < 1 ? THREE.CustomBlending : THREE.NormalBlending;
        }
      };
    });
  }

  update(frame, camera) {
    if (this.frame === frame && this.camera === camera && this.near === camera.near) return;
    this.frame = frame;
    this.camera = camera;
    this.near = camera.near;
    if (this.excluded) {
      this.value = 1;
      return;
    }
    const inst = this.inst,
      matrix = inst.root.matrixWorld,
      e = matrix.elements;
    if (this.pose !== inst.poseVersion) {
      this.pose = inst.poseVersion;
      this.box.makeEmpty();
      this.inverse.copy(matrix).invert();
      for (const entry of this.entries) {
        this.boneMatrix.multiplyMatrices(this.inverse, entry.bone.matrixWorld);
        this.part.copy(entry.box).applyMatrix4(this.boneMatrix);
        this.box.union(this.part);
      }
      this.box.getSize(this.half).multiplyScalar(0.5);
    }
    const h = this.half;
    const radius = Math.hypot(
      Math.abs(e[0] * h.x) + Math.abs(e[4] * h.y) + Math.abs(e[8] * h.z),
      Math.abs(e[1] * h.x) + Math.abs(e[5] * h.y) + Math.abs(e[9] * h.z),
      Math.abs(e[2] * h.x) + Math.abs(e[6] * h.y) + Math.abs(e[10] * h.z)
    );
    const c = camera.matrixWorld.elements;
    this.value = galacticDistanceFade(Math.hypot(e[12] - c[12], e[13] - c[13], e[14] - c[14]), radius, camera.near);
  }
}
