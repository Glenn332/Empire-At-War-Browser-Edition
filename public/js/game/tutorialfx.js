import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadModel } from '../model.js';
import { loadALA, animName, AnimState } from '../ala.js';
import { iconUrl } from '../icons.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const ARROW = 'i_tutorial_arrow.alo',
  POOL = 10;

export class TutorialFx {
  constructor(game) {
    this.game = game;
    this.arrows = [];
    this.renderer = null;
    this.disposed = false;
    this.markers = new Map();
  }

  element(name) {
    return document.querySelector(`[data-component="${CSS.escape(key(name))}"]`);
  }

  flashComponent(name, { period = 0.5, count = 3, forever = false, arrow = true, tag = '' } = {}) {
    const el = this.element(name);
    if (!el) return false;
    const comp = this.game.ui?.comp?.(name) || this.game.ui?.bar?.comp?.(name) || this.game.hud?.comp?.(name);
    const tex = comp && (this.textureOf(comp, 'Flash_Texture_Name') || this.textureOf(comp, 'Icon_Texture_Name'));
    this.flashElement(el, tex, { period, count, forever });
    if (arrow) this.pointAt({ el, tag });
    return true;
  }
  textureOf(comp, tag) {
    const name = comp?.val?.(tag)?.trim().split(/\s+/)[0];
    return name ? iconUrl(name) : '';
  }
  flashElement(el, url, { period = 0.5, count = 3, forever = false } = {}) {
    el.querySelector(':scope > .tutorial-flash')?.remove();
    const f = document.createElement('span');
    f.className = 'tutorial-flash';
    f.style.cssText = `position:absolute;inset:0;pointer-events:none;mix-blend-mode:plus-lighter;background:${url ? `url("${url}") center/100% 100% no-repeat` : 'rgba(255,255,255,.6)'};animation:tutorial-flash ${period}s linear ${forever ? 'infinite' : count}`;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    f.addEventListener('animationend', () => f.remove());
    el.appendChild(f);
  }

  async pointAt({ el = null, at = null, planet = null, tag = '' }) {
    if (this.arrows.length >= POOL) return null;
    const entry = { el, at, planet, tag: key(tag), inst: null, anim: null };
    this.arrows.push(entry);
    const inst = await loadModel(ARROW).catch(() => null);
    if (!inst || this.disposed || !this.arrows.includes(entry)) return null;
    entry.inst = inst;
    const a = await loadALA(animName(ARROW, 'IDLE')).catch(() => null);
    if (a) entry.anim = new AnimState(inst, a, { loop: true });
    this.scene().add(inst.root);
    return entry;
  }
  hideArrow(tag = '') {
    const i = this.arrows.findIndex(a => a.tag === key(tag));
    if (i < 0) return;
    const [a] = this.arrows.splice(i, 1);
    if (a.inst) this.overlay?.scene.remove(a.inst.root);
  }
  clearArrows() {
    for (const a of this.arrows) if (a.inst) this.overlay?.scene.remove(a.inst.root);
    this.arrows = [];
  }

  scene() {
    if (!this.overlay) {
      const canvas = document.createElement('canvas');
      canvas.className = 'tutorial-arrows';
      canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:11';
      document.body.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene(),
        camera = new THREE.OrthographicCamera(-512, 512, 384, -384, 1, 1000);
      camera.position.set(0, 0, 500);
      camera.lookAt(0, 0, 0);
      this.overlay = { canvas, renderer, scene, camera, size: '' };
    }
    return this.overlay.scene;
  }
  gui(x, y) {
    const s = Math.min(innerWidth / 1024, innerHeight / 768);
    return [(x - innerWidth / 2) / s, (innerHeight / 2 - y) / s];
  }

  update(dt) {
    for (const h of this.highlights?.values() || []) h.anim?.step?.(dt);
    if (!this.overlay || this.disposed) return;
    const o = this.overlay,
      s = Math.min(innerWidth / 1024, innerHeight / 768),
      w = innerWidth / s,
      h = innerHeight / s,
      size = innerWidth + 'x' + innerHeight;
    if (o.size !== size) {
      o.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
      o.renderer.setSize(innerWidth, innerHeight, false);
      o.camera.left = -w / 2;
      o.camera.right = w / 2;
      o.camera.top = h / 2;
      o.camera.bottom = -h / 2;
      o.camera.updateProjectionMatrix();
      o.size = size;
    }
    let any = false;
    for (const a of this.arrows) {
      if (!a.inst) continue;
      let p = null;
      if (a.el) {
        const r = a.el.getBoundingClientRect();
        if (r.width || r.height) p = [r.left + r.width / 2, r.top + r.height / 2];
      } else if (a.at) p = a.at();
      else if (a.planet)
        p = this.game.overlayPoint?.(a.planet.pos) && [this.game.overlayPoint(a.planet.pos).x, this.game.overlayPoint(a.planet.pos).y];
      a.inst.root.visible = !!p;
      if (!p) continue;
      const [x, y] = this.gui(p[0], p[1]);
      a.inst.root.position.set(x, y, -100);
      a.anim?.step?.(dt);
      any = true;
    }
    o.canvas.style.display = any ? '' : 'none';
    if (any) o.renderer.render(o.scene, o.camera);
  }

  async highlight(target, on, { scene = null, parent = null, position = null } = {}) {
    const store = (this.highlights ||= new Map());
    const old = store.get(target);
    if (old) {
      old.root.parent?.remove(old.root);
      store.delete(target);
    }
    if (!on) return;
    const fx = db.type('Object_Highlight'),
      file = fx?.str('Space_Model_Name') || fx?.str('Land_Model_Name') || 'W_HILIGHT_FX.ALO';
    const inst = await loadModel(file).catch(() => null);
    if (!inst) return;
    const a = await loadALA(animName(file, 'IDLE')).catch(() => null);
    const holder = parent || scene;
    if (!holder) return;
    if (position) inst.root.position.set(position.x, position.y, position.z);
    holder.add(inst.root);
    store.set(target, { root: inst.root, anim: a ? new AnimState(inst, a, { loop: true }) : null });
  }
  marker(id, place) {
    if (place) this.markers.set(id, place);
    else this.markers.delete(id);
    this.game.radar?.refresh?.();
  }

  dispose() {
    this.disposed = true;
    this.clearArrows();
    this.overlay?.renderer.dispose();
    this.overlay?.canvas.remove();
  }
}
