import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadALO } from '../alo.js';
import { loadALA, animName, AnimState } from '../ala.js';
import { buildModel } from '../model.js';
import { loadTextureCanvas } from '../dds.js';
import { iconCanvasRect, iconUrl } from '../icons.js';
import { uiMeshes, drawMesh, uiMeshDepthAt, uiMeshClipPath } from './hud.js';
import { tintShell, animateScan } from './nativepanel.js';
import {
  radarPlanets,
  radarPoint,
  radarWorld,
  radarAppearance,
  radarViewPoint,
  nativeRound,
  selectRadarPlanet,
  recenterRadar,
  advanceRadarFlash
} from './galacticradardata.js';

const token = (c, key) => c?.val(key).trim().split(/\s+/)[0] || '';
const label = p => db.t(p.type.str('Text_ID')) || p.name;

export async function loadGalacticRadarAssets(hud) {
  const model = await loadALO('i_galactic_radar.alo');
  const shell = model ? uiMeshes(model) : new Map(),
    materials = new Map();
  for (const mesh of model?.meshes || []) for (const sub of mesh.subs) materials.set(mesh.name.toUpperCase(), sub.material);
  const textures = new Map();
  await Promise.all(
    [...new Set([...shell.values()].map(m => m.texture).filter(Boolean))].map(async name =>
      textures.set(name, await loadTextureCanvas(name).catch(() => null))
    )
  );
  const [move, attack] = await Promise.all(['MOVE', 'ATTACK'].map(kind => loadALA(animName('i_galactic_radar.alo', kind))));
  const scan = hud.shell.get('RADAR_GALACTIC'),
    scanMaterials = new Map();
  for (const mesh of hud.model.meshes) for (const sub of mesh.subs) scanMaterials.set(mesh.name.toUpperCase(), sub.material);
  const scanTexture = scan?.texture ? await loadTextureCanvas(scan.texture).catch(() => null) : null;
  return {
    comps: hud.comps,
    indicator: { model, shell, materials, textures, move, attack },
    scan: scan && { shell: new Map([['RADAR_GALACTIC', scan]]), materials: scanMaterials, textures: new Map([[scan.texture, scanTexture]]) }
  };
}

export class GalacticRadar {
  constructor(game, data) {
    this.game = game;
    this.comps = data.comps;
    this.hover = -1;
    this.flashStates = new Map();
    this.urls = new Map();
    this.colorKeys = new Map();
    this.root = document.createElement('div');
    this.root.className = 'galactic-radar';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Galactic radar');
    this.root.style.pointerEvents = 'none';
    this.backgroundHit = document.createElement('div');
    this.backgroundHit.setAttribute('aria-hidden', 'true');
    this.backgroundHit.style.cssText = 'position:absolute;inset:0;pointer-events:auto';
    this.root.appendChild(this.backgroundHit);
    this.blips = radarPlanets(game.galaxy).map(p => {
      const el = document.createElement('div');
      el.className = 'galactic-radar-blip';
      el.dataset.planet = p.name;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', label(p));
      const flash = document.createElement('div');
      flash.className = 'galactic-radar-flash';
      flash.hidden = true;
      flash.setAttribute('aria-hidden', 'true');
      this.root.append(el, flash);
      return { p, el, flash, key: '', width: 0, height: 0, known: false };
    });
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'galactic-radar-view';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.canvas);
    this.outline = document.createElement('canvas');
    this.outline.className = 'galactic-radar-view';
    this.outline.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.outline);
    this.direction = new THREE.Vector3();
    this.corner = new THREE.Vector3();
    this.indicator = data.indicator;
    this.indicator.images = tintShell(this.indicator);
    this.instance = this.indicator.model ? buildModel(this.indicator.model) : null;
    this.instance?.syncFromBones();
    this.posed = new Map([...this.indicator.shell].map(([n, m]) => [n, { ...m, verts: m.verts.map(v => ({ ...v })) }]));
    this.frameBounds = this.indicator.shell.size
      ? {
          x: Math.floor(Math.min(...[...this.indicator.shell.values()].map(m => m.rect.x))) - 1,
          y: Math.ceil(Math.max(...[...this.indicator.shell.values()].map(m => m.rect.y + m.rect.h))) + 1,
          w:
            Math.ceil(
              Math.max(...[...this.indicator.shell.values()].map(m => m.rect.x + m.rect.w)) -
                Math.min(...[...this.indicator.shell.values()].map(m => m.rect.x))
            ) + 2,
          h:
            Math.ceil(
              Math.max(...[...this.indicator.shell.values()].map(m => m.rect.y + m.rect.h)) -
                Math.min(...[...this.indicator.shell.values()].map(m => m.rect.y))
            ) + 2
        }
      : { x: 0, y: 0, w: 1, h: 1 };
    this.scan = document.createElement('div');
    this.scan.className = 'galactic-radar-scan';
    if (data.scan) {
      const m = data.scan.shell.get('RADAR_GALACTIC'),
        r = m.rect,
        b = { x: r.x, y: r.y + r.h };
      this.game.ui.place(this.scan, 'radar_galactic');
      const material = data.scan.materials.get('RADAR_GALACTIC'),
        image = tintShell(data.scan).get('RADAR_GALACTIC');
      this.scan.style.mixBlendMode = /additive/i.test(material?.shader || '') ? 'plus-lighter' : 'normal';
      if (!m.hidden && !animateScan(this.scan, m, image, material?.params.UVScrollRate, b) && image) {
        const cv = document.createElement('canvas'),
          k = Math.max(1, Math.min(3, Math.ceil(game.ui.scale * devicePixelRatio)));
        cv.width = r.w * k;
        cv.height = r.h * k;
        cv.style.cssText = 'width:100%;height:100%;display:block';
        drawMesh(cv.getContext('2d'), image, m, (x, y) => [(x - b.x) * k, (b.y - y) * k]);
        this.scan.appendChild(cv);
      }
      game.ui.root.appendChild(this.scan);
    }
    this.root.onpointerup = e => {
      if (e.button === 0 && !game.dragFleet && game.dragGround === undefined && !game.baseLayout?.dragging) this.activate(e);
    };
    this.root.onpointermove = e => {
      const at = this.pick(e.clientX, e.clientY);
      if (at !== this.hover) {
        this.hover = at;
        this.refresh();
      }
    };
    this.root.onpointerleave = () => {
      if (this.hover !== -1) {
        this.hover = -1;
        this.refresh();
      }
    };
    this.root.oncontextmenu = e => e.preventDefault();
    this.attach();
    this.refresh();
    this.drawFrame();
  }

  attach() {
    const layout = this.game.baseLayout?.open,
      host = layout ? this.game.baseLayout : this.game.ui;
    const name = layout ? 'RADAR_GALACTIC_ADV_MAP' : 'RADAR_GALACTIC',
      mesh = host.shell.get(name),
      c = this.comps.get(name);
    if (!mesh) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    this.host = host;
    this.mesh = mesh;
    this.size = c
      ?.val('Size')
      .split(/[\s,]+/)
      .map(Number) || [175, 175];
    if (this.root.parentNode !== host.root) host.root.appendChild(this.root);
    const r = mesh.rect;
    this.backgroundHit.style.clipPath = this.outline.style.clipPath = uiMeshClipPath(mesh);
    Object.assign(this.outline.style, { left: '0px', top: '0px', width: r.w + 'px', height: r.h + 'px' });
    this.outlineKey = '';
    Object.assign(this.root.style, {
      left: r.x + 'px',
      width: r.w + 'px',
      height: r.h + 'px',
      bottom: layout ? '' : r.y + 'px',
      top: layout ? -r.y - r.h + 'px' : ''
    });
    this.origin = { x: mesh.origin.x - r.x, y: r.y + r.h - mesh.origin.y };
    for (const row of this.blips) {
      const p = radarPoint(row.p.pos, this.size);
      row.x = this.origin.x + p.x;
      row.y = this.origin.y - p.y;
      for (const el of [row.el, row.flash]) {
        el.style.left = row.x + 'px';
        el.style.top = row.y + 'px';
      }
    }
  }

  flash(planet, on = true, duration = -1) {
    if (!on) this.flashStates.delete(planet);
    else {
      const old = this.flashStates.get(planet);
      this.flashStates.set(planet, {
        persistent: duration <= 0,
        timer: duration > 0 ? duration : old?.timer || 0,
        count: duration > 0 ? 3 : old?.count || 0,
        color: old?.color || 0
      });
    }
    this.refresh();
  }

  refresh() {
    if (!this.host) return;
    const c = this.comps.get('G_RADAR_BLIP'),
      scale = c?.num('Scale', 1) ?? 1;
    for (const row of this.blips) {
      const { p, el } = row,
        appearance = radarAppearance(this.game.galaxy, p),
        selected = p.index === this.game.selected;
      const prop = selected
        ? 'Selected_Texture_Name'
        : appearance.known && p.index === this.hover
          ? 'Mouse_Over_Texture_Name'
          : 'Icon_Texture_Name';
      const name = token(c, prop) || token(c, 'Icon_Texture_Name'),
        rect = iconCanvasRect(name);
      if (!this.colorKeys.has(appearance.color)) {
        const floats = appearance.color.slice(0, 3).map(n => n / 255);
        this.colorKeys.set(appearance.color, { floats, key: floats.join(',') });
      }
      const color = this.colorKeys.get(appearance.color);
      row.width = (rect?.w || 0) * scale;
      row.height = (rect?.h || 0) * scale;
      row.known = appearance.known;
      const key = name + '|' + color.key,
        alpha = (appearance.alpha * (appearance.color[3] ?? 255)) / 255,
        state = key + '|' + alpha + '|' + selected;
      if (row.key !== state) {
        row.key = state;
        if (!this.urls.has(key)) {
          const image = this.game.tinted(name, color.floats);
          this.urls.set(key, image ? `url("${image.toDataURL()}")` : 'none');
        }
        el.style.backgroundImage = this.urls.get(key);
        el.style.width = row.width + 'px';
        el.style.height = row.height + 'px';
        el.style.opacity = String(alpha);
        el.style.pointerEvents = appearance.known ? 'auto' : 'none';
        el.setAttribute('aria-disabled', String(!appearance.known));
        el.setAttribute('aria-pressed', String(selected));
      }
      const marked = [...(this.game.tutorialFx?.markers.values() || [])].some(m => m.planet === p);
      if (marked && !row.marker) {
        const m = this.comps.get('RADAR_BLIP'),
          name = token(m, 'Icon_Texture_Name') || 'i_radar_focus.tga',
          r = iconCanvasRect(name);
        row.marker = document.createElement('span');
        row.marker.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;width:${(r?.w || 16) * scale}px;height:${(r?.h || 16) * scale}px;background:url("${iconUrl(name)}") center/100% 100% no-repeat`;
        el.appendChild(row.marker);
      }
      if (row.marker) row.marker.hidden = !marked;
      const flash = this.flashStates.get(p.index),
        flashHidden = !flash || flash.timer === 0;
      if (row.flash.hidden !== flashHidden) row.flash.hidden = flashHidden;
      if (flash) {
        const name = token(c, 'Flash_Texture_Name'),
          rect = iconCanvasRect(name);
        row.flash.style.backgroundImage = `url("${iconUrl(name)}")`;
        row.flash.style.width = (rect?.w || 0) * scale + 'px';
        row.flash.style.height = (rect?.h || 0) * scale + 'px';
        row.flash.style.filter = `brightness(${flash.color / 255})`;
      }
    }
  }

  refreshLanguage() {
    for (const { p, el } of this.blips) {
      el.title = label(p);
      el.setAttribute('aria-label', label(p));
    }
  }

  local(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    return { x: (clientX - r.left) / this.host.scale, y: (clientY - r.top) / this.host.scale };
  }

  contains(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    if (this.root.hidden || !r.width) return false;
    const at = this.local(clientX, clientY),
      mesh = this.mesh;
    return uiMeshDepthAt(mesh, mesh.rect.x + at.x, mesh.rect.y + mesh.rect.h - at.y) > -Infinity || this.pick(clientX, clientY) >= 0;
  }

  pick(clientX, clientY) {
    const at = this.local(clientX, clientY);
    for (const row of this.blips)
      if (row.known && Math.abs(at.x - row.x) <= row.width / 2 && Math.abs(at.y - row.y) <= row.height / 2) return row.p.index;
    return -1;
  }

  async activate(e) {
    if (this.game.battle) return;
    const point = this.local(e.clientX, e.clientY),
      at = this.pick(e.clientX, e.clientY),
      layout = this.game.baseLayout?.open;
    if (at >= 0) selectRadarPlanet(this.game, at);
    recenterRadar(this.game, radarWorld({ x: point.x - this.origin.x, y: this.origin.y - point.y }, this.size));
    if (layout) {
      this.game.baseLayout.close();
      await this.game.openBaseLayout();
    }
    this.refresh();
  }

  animate(kind) {
    const anim = this.indicator[kind];
    if (anim && this.instance) this.animation = new AnimState(this.instance, anim, { speed: 1.5 });
  }

  drawOutline() {
    const cam = this.game.camera,
      at = cam.position,
      d = this.corner,
      points = [];
    for (const [nx, ny] of [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1]
    ]) {
      d.set(nx, ny, 0.5).unproject(cam).sub(at);
      if (d.z > -1e-6) return false;
      const t = -at.z / d.z,
        p = radarPoint([at.x + d.x * t, at.y + d.y * t], this.size);
      points.push(this.origin.x + p.x, this.origin.y - p.y);
    }
    const r = this.mesh.rect,
      k = Math.max(1, Math.min(3, Math.ceil(this.host.scale * devicePixelRatio)));
    const key = k + '|' + points.map(n => n.toFixed(1)).join(',');
    if (key === this.outlineKey) return true;
    this.outlineKey = key;
    const cv = this.outline,
      g = cv.getContext('2d');
    if (cv.width !== r.w * k || cv.height !== r.h * k) {
      cv.width = r.w * k;
      cv.height = r.h * k;
    }
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, r.w, r.h);
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < 8; i += 2) (i ? g.lineTo : g.moveTo).call(g, points[i], points[i + 1]);
    g.closePath();
    g.stroke();
    return true;
  }

  drawFrame(dt = 0) {
    for (const [planet, state] of this.flashStates) {
      state.color = advanceRadarFlash(state, dt);
      if (!state.timer && !state.persistent) this.flashStates.delete(planet);
    }
    if (this.animation && !this.animation.done) {
      this.animation.step(dt);
      this.frameDirty = true;
    }
    const v = this.game.view,
      away = !!(this.game.baseLayout?.open || this.game.battle);
    const outline = !away && this.host && this.drawOutline();
    if (this.outline.hidden !== !outline) this.outline.hidden = !outline;
    const hidden = !!(outline || v.zoom || v.dir || away);
    if (this.canvas.hidden !== hidden) this.canvas.hidden = hidden;
    if (this.canvas.hidden || !this.host) return;
    const size = this.comps
      .get('G_RADAR_VIEW')
      ?.val('Size')
      .split(/[\s,]+/)
      .map(Number) || [132, 90];
    const p = radarViewPoint(this.game.camera.position, this.game.camera.getWorldDirection(this.direction), this.size, size);
    if (!p) return;
    const b = this.frameBounds,
      origin = this.mesh.origin;
    const left = nativeRound(origin.x + p.x) + 0.5 - this.mesh.rect.x + b.x,
      top = this.mesh.rect.y + this.mesh.rect.h - nativeRound(origin.y + p.y) - 0.5 - b.y;
    if (left !== this.frameLeft) {
      this.frameLeft = left;
      this.canvas.style.left = left + 'px';
    }
    if (top !== this.frameTop) {
      this.frameTop = top;
      this.canvas.style.top = top + 'px';
    }
    const k = Math.max(1, Math.min(3, Math.ceil(this.host.scale * devicePixelRatio)));
    if (this.frameScale === k && !this.frameDirty) return;
    this.frameScale = k;
    this.frameDirty = false;
    this.canvas.width = b.w * k;
    this.canvas.height = b.h * k;
    this.canvas.style.width = b.w + 'px';
    this.canvas.style.height = b.h + 'px';
    for (const skin of this.instance?.skins || []) {
      const mesh = this.posed.get(skin.mesh.parent.name.toUpperCase());
      if (!mesh) continue;
      const g = skin.mesh.geometry,
        pos = g.getAttribute('position'),
        indices = g.getAttribute('skinIndex'),
        weights = g.getAttribute('skinWeight'),
        m = skin.mats;
      for (let i = 0; i < mesh.verts.length; i++) {
        let x = 0,
          y = 0;
        const px = pos.getX(i),
          py = pos.getY(i),
          pz = pos.getZ(i);
        for (let n = 0; n < 4; n++) {
          const w = weights.array[i * 4 + n],
            o = indices.array[i * 4 + n] * 16;
          if (w) {
            x += (m[o] * px + m[o + 4] * py + m[o + 8] * pz + m[o + 12]) * w;
            y += (m[o + 1] * px + m[o + 5] * py + m[o + 9] * pz + m[o + 13]) * w;
          }
        }
        mesh.verts[i].x = x;
        mesh.verts[i].y = y;
      }
    }
    const ctx = this.canvas.getContext('2d');
    for (const [n, mesh] of this.posed) {
      const image = this.indicator.images.get(n);
      if (image && !mesh.hidden) drawMesh(ctx, image, mesh, (x, y) => [(x - b.x) * k, (b.y - y) * k]);
    }
  }
}
