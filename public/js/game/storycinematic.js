import * as THREE from 'three';
import { loadModel, lighting } from '../model.js';
import { loadALA, animName, AnimState, loopTime } from '../ala.js';

const SCENE_LIGHTS = {
  sunDir: new THREE.Vector3(0, -Math.SQRT1_2, Math.SQRT1_2),
  sunColor: new THREE.Color(0.5, 0.5, 0.5),
  sunSpecular: new THREE.Color(0.5, 0.5, 0.5),
  fillDir: new THREE.Vector3(0.8529, 0.4924, -0.1736),
  fillColor: new THREE.Color(0.25, 0.25, 0.5),
  fillDir2: new THREE.Vector3(-0.4924, 0.8529, -0.1736),
  fillColor2: new THREE.Color(0.25, 0.25, 0.5),
  ambient: new THREE.Color(0, 0, 0)
};
const SCALARS = { fillWrap: 0, shadowOn: 0 };

export function cinematicFov(aspect) {
  const hfov = Math.atan(0.375 * aspect);
  return (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI;
}

export function cinematicAnimTime(clock, start, anim) {
  const t = clock - start;
  if (t < 0) return 0;
  const end = loopTime(anim);
  return end > 0 ? t % end : 0;
}

export class StoryCinematic {
  constructor(host, clock) {
    this.host = host;
    this.clock = clock;
    this.hidden = 0;
    this.generation = 0;
    this.inst = null;
    this.file = '';
    this.anim = null;
    this.start = 0;
    this.pendingAnim = null;
    this.lastClock = NaN;
    this.raf = 0;
  }
  ensureCanvas() {
    if (this.canvas) return;
    const canvas = (this.canvas = document.createElement('canvas'));
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
    this.host.appendChild(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x000000, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
    this.camera.up.set(0, 0, 1);
    const frame = () => {
      this.raf = requestAnimationFrame(frame);
      this.frame();
    };
    this.raf = requestAnimationFrame(frame);
  }
  async load(file) {
    const generation = ++this.generation;
    this.clearModel();
    this.ensureCanvas();
    this.file = file;
    const inst = await loadModel(file).catch(() => null);
    if (!inst || generation !== this.generation || !this.canvas) return false;
    this.inst = inst;
    this.scene.add(inst.root);
    this.lastClock = NaN;
    if (this.pendingAnim !== null) {
      const n = this.pendingAnim;
      this.pendingAnim = null;
      await this.play(n);
    }
    return true;
  }
  async play(n) {
    this.hidden = 0;
    if (!this.inst) {
      this.pendingAnim = n;
      return;
    }
    const generation = this.generation,
      anim = await Promise.resolve(loadALA(animName(this.file, 'IDLE'))).catch(() => null);
    if (generation !== this.generation || !anim || !this.inst) return;
    this.anim = new AnimState(this.inst, anim, { loop: true });
    this.start = n;
    this.lastClock = NaN;
  }
  hide(n) {
    this.hidden = n;
  }
  clearModel() {
    if (this.inst) this.scene?.remove(this.inst.root);
    this.inst = null;
    this.anim = null;
    this.pendingAnim = null;
  }
  update(clock) {
    if (this.anim) {
      this.anim.time = cinematicAnimTime(clock, this.start, this.anim.anim);
      this.anim.pose();
    }
    const cam = this.camera,
      root = this.inst?.root;
    root?.updateMatrixWorld(true);
    const bone = this.inst?.bone?.('Camera01');
    if (bone) {
      const s = new THREE.Vector3();
      bone.matrixWorld.decompose(cam.position, cam.quaternion, s);
    } else {
      cam.position.set(0, -40, 20);
      cam.lookAt(0, 0, 0);
    }
  }
  frame() {
    if (!this.canvas) return;
    this.canvas.hidden = !!this.hidden;
    if (this.hidden) return;
    const w = Math.max(1, Math.round(this.host.clientWidth * devicePixelRatio)),
      h = Math.max(1, Math.round(this.host.clientHeight * devicePixelRatio));
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.setSize(w, h, false);
    const aspect = w / h;
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.fov = cinematicFov(aspect);
      this.camera.updateProjectionMatrix();
    }
    const clock = this.clock();
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.update(clock);
    }
    const saved = {};
    for (const [k, v] of Object.entries(SCENE_LIGHTS)) {
      saved[k] = lighting[k].value;
      lighting[k].value = v;
    }
    for (const [k, v] of Object.entries(SCALARS)) {
      saved[k] = lighting[k].value;
      lighting[k].value = v;
    }
    try {
      this.renderer.render(this.scene, this.camera);
    } finally {
      for (const [k, v] of Object.entries(saved)) lighting[k].value = v;
    }
  }
  dispose() {
    this.generation++;
    cancelAnimationFrame(this.raf);
    this.clearModel();
    this.renderer?.dispose();
    this.canvas?.remove();
    this.canvas = null;
  }
}
