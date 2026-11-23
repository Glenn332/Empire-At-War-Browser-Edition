// Render an isolated portrait of the selected unit, not a copy of a live soldier.
// Borrow the visible deployment screen's frame clock; no separate RAF in combat.
import * as THREE from 'three';
import { loadModel } from '../model.js';
import { standaloneFileTexture } from '../dds.js';
import { loadALA, animName } from '../ala.js';
import { DeployMotion } from './deploy-motion.js';
import { fitPortrait, silhouetteBounds } from './deploy-framing.js';
import { animOverride } from './land.js';

export class DeployPreview {
  constructor(host) {
    this.host = host;
    this.serial = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(host);
  }

  clear() {
    this.inst?.root.removeFromParent();
    for (const m of this.materials || []) m.dispose();
    this.materials = [];
    for (const texture of this.ownedTextures?.values() || []) texture?.dispose();
    this.ownedTextures = null;
    this.inst = this.motion = this.bounds = null;
    this.spare = 0;
    this.host.classList.remove('rendered');
  }

  async show(unit, teamColor, icon) {
    if (this.unit === unit) return;
    this.unit = unit;
    const serial = ++this.serial;
    this.clear();
    this.host.style.setProperty('--unit-icon', icon ? `url("${icon}")` : 'none');
    const file = unit?.str('Land_Model_Name');
    if (!file) return;
    try {
      const base = animOverride(unit) || file;
      const [inst, clips] = await Promise.all([loadModel(file, { teamColor, fresh: true }), this.idleClips(base, file)]);
      if (!inst || serial !== this.serial) return;
      const needed = new Set();
      inst.root.traverse(o => {
        for (const key of ['map', 'normalMap', 'glossMap']) {
          const t = o.material?.uniforms?.[key]?.value;
          if (t?.isTexture) needed.add(t);
        }
      });
      const owned = new Map(await Promise.all([...needed].map(async t => [t, await standaloneFileTexture(t)])));
      if (serial !== this.serial) {
        for (const t of owned.values()) t?.dispose();
        return;
      }
      this.ownedTextures = owned;
      if (!this.gl) {
        this.gl = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
        this.gl.setClearColor(0, 0);
        this.gl.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        this.host.appendChild(this.gl.domElement);
        this.camera = new THREE.OrthographicCamera();
        this.camera.up.set(0, 0, 1);
        this.scene = new THREE.Scene();
        // A battlefield render target cannot be sampled in this second GL context.
        this.noShadow = new THREE.DepthTexture(1, 1);
        this.noShadow.compareFunction = THREE.LessEqualCompare;
        this.noShadow.needsUpdate = true;
      }
      // Share geometry, but keep the portrait's lighting and uploads independent.
      const copies = new Map();
      inst.root.traverse(o => {
        if (!o.isMesh || !o.material.uniforms?.map) return;
        const src = o.material;
        let m = copies.get(src);
        if (!m) {
          m = src.clone();
          for (const [k, u] of Object.entries(src.uniforms)) if (u.value?.isTexture) m.uniforms[k].value = owned.get(u.value) || u.value;
          const u = m.uniforms;
          // Shield / cloak passes do not declare the standard lit-mesh uniforms.
          if (u.shadowMap) u.shadowMap.value = this.noShadow;
          for (const k of ['shadowOn', 'fowSide', 'boltN']) if (u[k]) u[k].value = 0;
          u.fogRange?.value.set(0, 0);
          u.sunDir?.value.set(-0.6, -0.5, 0.8).normalize();
          u.sunColor?.value.setRGB(0.93, 0.91, 0.85);
          u.fillDir?.value.set(0.8, 0.5, 0.4).normalize();
          u.fillColor?.value.setRGB(0.34, 0.43, 0.56);
          u.ambient?.value.setRGB(0.46, 0.47, 0.5);
          copies.set(src, m);
          this.materials.push(m);
        }
        o.material = m;
      });
      this.inst = inst;
      this.scene.add(inst.root);
      this.motion = new DeployMotion(inst, clips);
      this.draw();
    } catch {
      // Mods without model art and machines without a second GL context keep the native unit icon.
      if (serial === this.serial) this.clear();
    }
  }

  idleClips(base, file) {
    const models = new Set([base, file]);
    return Promise.all(
      [0, 1, 2].map(async n => {
        for (const model of models) {
          const clip = await Promise.resolve(loadALA(animName(model, 'IDLE', n))).catch(() => null);
          if (clip) return clip;
        }
        return null;
      })
    );
  }

  tick(dt) {
    if (!this.motion || !this.host.classList.contains('rendered') || this.reducedMotion.matches || document.hidden) return;
    this.spare += Math.min(0.15, Math.max(dt, 0));
    if (this.spare < 1 / 30) return;
    this.motion.step(this.spare);
    this.spare = 0;
    this.gl.render(this.scene, this.camera);
  }

  measure() {
    // ALO bind boxes include e.g. invisible alternates and a speeder's rest
    // rig. Measure the pixels from the actual posed, skinned model instead.
    // One small offscreen pass on selection, never in the animation loop.
    const { inst, camera: c, gl } = this,
      n = 192;
    const center = inst.box.getCenter(new THREE.Vector3()),
      size = inst.box.getSize(new THREE.Vector3());
    const direction = new THREE.Vector3(-0.43, -1, 0.16).normalize();
    const previous = gl.getRenderTarget();
    this.probe ||= new THREE.WebGLRenderTarget(n, n);
    this.pixels ||= new Uint8Array(n * n * 4);
    let span = Math.max(1, size.length()) * 1.15;
    try {
      gl.setRenderTarget(this.probe);
      for (let attempt = 0; attempt < 3; attempt++, span *= 2) {
        c.position.copy(center).addScaledVector(direction, span * 2);
        c.lookAt(center);
        c.left = c.bottom = -span / 2;
        c.right = c.top = span / 2;
        c.near = 0.01;
        c.far = span * 4;
        c.updateProjectionMatrix();
        gl.render(this.scene, c);
        gl.readRenderTargetPixels(this.probe, 0, 0, n, n, this.pixels);
        const b = silhouetteBounds(this.pixels, n, span);
        if (b && !b.clipped) return b;
      }
    } finally {
      gl.setRenderTarget(previous);
    }
    return { x: 0, y: 0, width: Math.max(1, Math.hypot(size.x, size.y)), height: Math.max(1, size.z) };
  }

  draw() {
    const { inst, host, camera: c } = this;
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!inst || !w || !h || !host.isConnected) return;
    this.bounds ||= this.measure();
    Object.assign(c, fitPortrait(this.bounds, w / h));
    c.updateProjectionMatrix();
    this.gl.setSize(w, h, false);
    this.gl.render(this.scene, c);
    host.classList.add('rendered');
  }

  dispose() {
    ++this.serial;
    this.observer.disconnect();
    this.clear();
    this.probe?.dispose();
    this.noShadow?.dispose();
    this.gl?.dispose();
    this.gl?.forceContextLoss();
  }
}
