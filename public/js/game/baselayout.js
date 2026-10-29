import { db } from '../gamedata.js';
import { loadTextureCanvas } from '../dds.js';
import { loadMapLayoutHeader } from '../ted.js';
import { iconCanvasRect, iconUrl } from '../icons.js';
import { NativePanel, loadNativePanelAssets, tintShell, animateScan } from './nativepanel.js';
import { drawMesh } from './hud.js';
import { displayIncome, intelligence, stepVisibility, VIS } from './galacticfog.js';
import { assignBaseLayout, canViewBaseLayout, layoutMarkerPoint, swapLayoutMarkers, layoutOrbitCompanies, embarkLayoutCompany, landLayoutCompany } from './baselayoutdata.js';

const title = type => db.t(type.str('Text_ID')) || type.name;
const previewName = p => { const name = p.type.str('Land_Tactical_Map').trim(); return name ? name.replace(/\.[^./\\]+$/, '') + '.tga' : 'maptemp.tga'; };
const textures = new Map();
const texture = name => { if (!textures.has(name)) textures.set(name, loadTextureCanvas(name).catch(() => null)); return textures.get(name); };

export async function loadBaseLayoutAssets() {
  const [main, overlay] = await Promise.all([loadNativePanelAssets('map_shell', 'planetary_mode.alo'), loadNativePanelAssets('map_overlay_shell', 'planetary_mode_overlay.alo')]);
  return main && overlay ? { ...main, overlay } : null;
}

export class BaseLayout extends NativePanel {
  constructor(game, data) {
    super(game, data, 'base-layout', db.t('TEXT_BASE_LAYOUT'));
    this.shellImages = tintShell(this); this.overlayImages = tintShell(this.overlay);
    this.open = false; this.planet = -1; this.generation = 0; this.header = { markers: [], extent: 0 }; this.preview = null;
    this.blocker = document.createElement('div'); this.blocker.className = 'base-layout-blocker'; this.blocker.hidden = true;
    document.body.insertBefore(this.blocker, this.root);
    this.map = document.createElement('canvas'); this.map.className = 'layout-map'; this.root.appendChild(this.map);
    this.overlayCanvas = document.createElement('canvas'); this.overlayCanvas.className = 'layout-overlay'; this.overlayCanvas.style.cssText = this.plate.style.cssText; this.root.appendChild(this.overlayCanvas);
    this.scanCanvas = document.createElement('canvas'); this.scanCanvas.className = 'layout-scan'; this.scanCanvas.style.cssText = this.plate.style.cssText; this.root.appendChild(this.scanCanvas);
    this.scans = document.createElement('div'); this.scans.className = 'layout-scan'; this.scans.style.cssText = this.plate.style.cssText; this.root.appendChild(this.scans);
    this.animatedScans = new Set();
    for (const [name, mesh] of this.overlay.shell) {
      const material = this.overlay.materials.get(name);
      if (!mesh.hidden && /additive/i.test(material?.shader || '') && animateScan(this.scans, mesh, this.overlayImages.get(name), material.params.UVScrollRate, this.bounds)) this.animatedScans.add(name);
    }
    this.palette = this.controls(/^LAND_FLEET_\d+$/); this.buildings = this.controls(/^BUILD_PAD\d+$/); this.units = this.controls(/^UNIT_PAD\d+$/);
    this.shields = [];
    this.labels = {};
    for (const [name, id] of [['ground_forces_text', 'TEXT_GROUND_FORCES'], ['drage_drop_text', 'TEXT_DRAG_AND_DROP'], ['unit_cap_text', 'TEXT_UNIT_CAP'], ['building_cap_text', 'TEXT_BUILDING_CAP']]) this.text(name, ()=>db.t(id));
    for (const name of ['unit_cap_number', 'building_cap_number', 'Planet_name_text', 'Planetary_Income_number', 'Day_Counter_text']) this.labels[name] = this.text(name, '');
    this.button('back_button', ()=>db.t('TEXT_BACK_BUTTON'), () => this.close());
    this.button('b_zoom_adv_map', '', () => this.close());
    for (const [name, tag] of [['weather', 'Encyclopedia_Weather_Icon'], ['planet_bonus', 'Planet_Ability_Icon']]) {
      const img = document.createElement('img'); img.className = 'layout-planet-icon'; img.alt = ''; this.root.appendChild(img);
      this[tag] = { img, name };
    }
    for (const slot of [...this.palette, ...this.buildings, ...this.units]) this.bindDrag(slot);
    this.paletteArea = document.createElement('div'); this.paletteArea.className = 'layout-palette-target'; this.paletteArea.setAttribute('aria-label', db.t('TEXT_GROUND_FORCES'));
    if (this.palette.length) {
      const x = Math.min(...this.palette.map(s => s.mesh.rect.x)), y = Math.min(...this.palette.map(s => s.mesh.rect.y));
      const right = Math.max(...this.palette.map(s => s.mesh.rect.x + s.mesh.rect.w)), top = Math.max(...this.palette.map(s => s.mesh.rect.y + s.mesh.rect.h));
      this.place(this.paletteArea, { x, y, w: right - x, h: top - y });
    }
    this.root.appendChild(this.paletteArea);
    this.paletteArea.onpointerup = e => this.finishDrag(e, { kind: 'palette' });
    this.resize();
  }

  resize() { super.resize(); if (this.overlayCanvas) { this.paint(); this.positionMarkers(); } }

  async show(p) {
    if (this.open || !canViewBaseLayout(this.game.galaxy, p, this.game.me) || this.game.battle) return false;
    this.open = true; this.planet = p.index; this.root.hidden = this.blocker.hidden = false; this.reflowText();
    this.game.mouse.in = false; this.game.keys.clear();
    this.hudWasHidden = document.getElementById('hud').hidden; document.getElementById('hud').hidden = true;
    this.game.overview.root.hidden = true;
    this.game.radar?.attach(); this.game.radar?.refresh();
    this.header = { markers: [], extent: 0 }; this.preview = null; this.layout = null;
    this.paint(); this.refresh();
    const generation = ++this.generation, map = p.type.str('Land_Tactical_Map').trim();
    const [preview, header] = await Promise.all([texture(previewName(p)), map ? loadMapLayoutHeader(map) : Promise.resolve({ markers: [], extent: 0 })]);
    if (!this.open || generation !== this.generation) return false;
    const image = preview || await texture('maptemp.tga');
    if (!this.open || generation !== this.generation) return false;
    this.preview = image; this.header = header;
    this.paint(); this.refresh();
    return true;
  }

  close() {
    if (!this.open) return;
    this.open = false; this.generation++; this.cancelDrag();
    this.root.hidden = this.blocker.hidden = true;
    this.game.radar?.attach(); this.game.radar?.refresh();
    document.getElementById('hud').hidden = this.hudWasHidden;
    this.game.overview.update(); this.game.overview.refresh(); this.game.ui?.refresh();
  }

  refresh() {
    if (!this.open) return;
    const g = this.game.galaxy, p = g.planets[this.planet], viewer = this.game.me, v = intelligence(g, p);
    if (this.game.battle || !canViewBaseLayout(g, p, viewer)) { this.close(); return; }
    if (this.dragging) return;
    const own = p.owner === viewer;
    this.layout = assignBaseLayout(p, this.header.markers, own);
    this.root.dataset.planet = p.name; this.root.setAttribute('aria-label', title(p.type) + ' — ' + db.t('TEXT_BASE_LAYOUT'));
    const putText = (name, value) => { if (this.labels[name]) this.setText(this.labels[name],value); };
    putText('unit_cap_number', p.garrison.length + ' / ' + this.game.overview.ground.length);
    putText('building_cap_number', p.groundStructures.length + ' / ' + p.type.num('Special_Structures_Land', 3));
    putText('Planet_name_text', title(p.type)); putText('Planetary_Income_number', String(Math.round(displayIncome(g, p))));
    putText('Day_Counter_text', db.t('TEXT_CYCLES') + ': ' + (g.fiscal?.cycle || 0));
    for (const tag of ['Encyclopedia_Weather_Icon', 'Planet_Ability_Icon']) {
      const { img, name } = this[tag], origin = this.origins.get(name.toUpperCase()), icon = p.type.str(tag);
      img.hidden = !origin || !iconUrl(icon); if (img.hidden) continue;
      img.src = iconUrl(icon); img.style.left = origin.x + 'px'; img.style.top = -origin.y + 'px';
      const scale = this.comps.get(name.toUpperCase())?.num('Scale', 1) ?? 1, rect = iconCanvasRect(icon);
      if (rect) { img.style.width = rect.w * scale + 'px'; img.style.height = rect.h * scale + 'px'; }
    }
    const groups = [];
    for (const entry of layoutOrbitCompanies(g, p, viewer)) {
      const existing = groups.find(a => a.entry.type === entry.type);
      if (existing) existing.count++; else groups.push({ entry, count: 1 });
    }
    this.palette.forEach((slot, i) => {
      const row = groups[i]; this.put(slot, row ? { unit: { type: row.entry.type }, count: row.count } : null, { big: false });
      slot.target = { kind: 'palette', entry: row?.entry };
      slot.canDrag = !!row && own && p.garrison.length < db.constants.num('Max_Ground_Forces_On_Planet', 10);
      slot.el.setAttribute('aria-disabled', String(!slot.canDrag));
    });
    const fill = (controls, slots, kind, known) => controls.forEach((slot, i) => {
      const data = slots[i]; slot.target = data ? { kind, slot: data } : null;
      if (!data) { slot.el.hidden = true; return; }
      const unit = data.record && known ? { type: data.type || data.record.type } : null;
      const blank = this.comps.get(slot.name)?.val('Blank_Texture_Name').trim().split(/\s+/).filter(Boolean).at(-1) || 'i_button_units.tga';
      this.put(slot, data.record ? { unit } : null, { blank: data.record ? '' : blank, big: false });
      slot.img.style.opacity = String(data.alpha ?? 1);
      slot.canDrag = own && !!data.record && !data.fixed;
      slot.el.setAttribute('aria-disabled', String(!own || !!data.fixed)); slot.el.dataset.markerId = data.marker.id;
    });
    fill(this.buildings, this.layout.buildings, 'building', own || !!(v?.mask & VIS.SPECIAL));
    fill(this.units, this.layout.units, 'unit', own || !!v?.groundContents);
    this.positionMarkers(); this.drawShields();
  }

  positionMarkers() {
    if (!this.layout) return;
    const origin = this.origins.get('MAP_WINDOW'), c = this.comps.get('MAP_WINDOW'), scale = c?.num('Scale', 1) ?? 1;
    const width = this.preview?.width || 512, height = this.preview?.height || 512;
    for (const slot of [...this.buildings, ...this.units]) if (slot.target?.slot) {
      const p = layoutMarkerPoint(slot.target.slot.marker, origin, width, height, scale);
      this.place(slot.el, { x: p.x - slot.mesh.rect.w / 2, y: p.y - slot.mesh.rect.h / 2, w: slot.mesh.rect.w, h: slot.mesh.rect.h });
    }
  }

  drawShields() {
    for (const img of this.shields) img.remove(); this.shields = [];
    if (!this.layout || !this.header.extent || !this.preview) return;
    const scale = this.comps.get('MAP_WINDOW')?.num('Scale', 1) ?? 1, origin = this.origins.get('MAP_WINDOW');
    for (const slot of this.layout.buildings) {
      const radius = slot.type?.num('Base_Shield_Radius', 0) || 0;
      if (!radius || !iconUrl('shield_range.tga')) continue;
      const img = document.createElement('img'), p = layoutMarkerPoint(slot.marker, origin, this.preview.width, this.preview.height, scale);
      img.src = iconUrl('shield_range.tga'); img.alt = ''; img.className = 'layout-shield';
      const size = radius * this.preview.width * scale / this.header.extent * 2;
      this.place(img, { x: p.x - size / 2, y: p.y - size / 2, w: size, h: size });
      this.root.appendChild(img); this.shields.push(img);
    }
  }

  paint() {
    if (!this.overlayCanvas) return;
    const b = this.bounds, k = Math.min(3, Math.max(1, Math.ceil(this.scale * devicePixelRatio)), Math.sqrt(12e6 / (b.w * b.h)));
    for (const [cv, data, images, additive] of [[this.plate, this, this.shellImages, false], [this.overlayCanvas, this.overlay, this.overlayImages, false], [this.scanCanvas, this.overlay, this.overlayImages, true]]) {
      const meshes = [...data.shell].filter(([n, m]) => !m.hidden && m.texture && n !== 'MAP_WINDOW' && !(additive && this.animatedScans.has(n)) && /additive/i.test(data.materials.get(n)?.shader || '') === additive).sort((a, c) => c[1].rect.w * c[1].rect.h - a[1].rect.w * a[1].rect.h);
      if (!meshes.length) { cv.width = cv.height = 1; continue; }
      cv.width = b.w * k; cv.height = b.h * k; const ctx = cv.getContext('2d');
      for (const [n, mesh] of meshes) {
        const img = images.get(n);
        if (img) drawMesh(ctx, img, mesh, (x, y) => [(x - b.x) * k, (b.y - y) * k]);
      }
    }
    const origin = this.origins.get('MAP_WINDOW'), scale = this.comps.get('MAP_WINDOW')?.num('Scale', 1) ?? 1, img = this.preview;
    this.map.hidden = !img;
    if (!img) return;
    this.map.width = img.width; this.map.height = img.height;
    this.place(this.map, { x: origin.x - img.width * scale / 2, y: origin.y - img.height * scale / 2, w: img.width * scale, h: img.height * scale });
    const ctx = this.map.getContext('2d'); ctx.drawImage(img, 0, 0);
    const color = this.comps.get('MAP_WINDOW')?.val('Color').split(/[\s,]+/).map(Number);
    this.map.style.opacity = String((color?.[3] ?? 255) / 255);
    if (color?.length >= 3) { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = `rgb(${color.slice(0, 3).join(',')})`; ctx.fillRect(0, 0, img.width, img.height); ctx.globalCompositeOperation = 'source-over'; }
  }

  bindDrag(slot) {
    slot.el.onpointerdown = e => {
      if (e.button !== 0 || !slot.canDrag || this.dragging) return;
      e.preventDefault(); this.dragging = { from: slot.target, x: e.clientX, y: e.clientY };
      this.ghost = slot.img.cloneNode(); this.ghost.className = 'layout-drag-ghost'; this.ghost.hidden = true; document.body.appendChild(this.ghost);
      this.onMove = event => {
        if (!this.dragging) return;
        this.dragging.moved ||= Math.hypot(event.clientX - this.dragging.x, event.clientY - this.dragging.y) > 3;
        this.ghost.hidden = !this.dragging.moved;
        Object.assign(this.ghost.style, { left: event.clientX + 'px', top: event.clientY + 'px', width: slot.img.style.width, height: slot.img.style.height, transform: `translate(-50%, -50%) scale(${this.scale})` });
      };
      this.onDrop = event => this.finishDrag(event, null);
      addEventListener('pointermove', this.onMove); addEventListener('pointerup', this.onDrop);
    };
    slot.el.onpointerup = e => this.finishDrag(e, slot.target);
  }

  finishDrag(e, target) {
    if (!this.dragging) return;
    const { from, moved } = this.dragging, g = this.game.galaxy, p = g.planets[this.planet];
    let changed = false;
    if (moved && target) {
      if (from.kind === target.kind && ['building', 'unit'].includes(from.kind)) changed = swapLayoutMarkers(p, this.layout, from.slot, target.slot, this.game.me);
      else if (from.kind === 'unit' && target.kind === 'palette') changed = embarkLayoutCompany(g, p, this.game.me, from.slot.record);
      else if (from.kind === 'palette' && target.kind === 'unit') changed = landLayoutCompany(g, p, this.game.me, from.entry, target.slot);
    }
    this.cancelDrag();
    if (changed) {
      this.game.mergeFleets(); stepVisibility(g, this.game.me);
      for (const [f, view] of this.game.fleetViews) if (!g.fleets.includes(f)) { this.game.scene.remove(view.inst.root); this.game.fleetViews.delete(f); }
      for (const f of g.fleets) if (!this.game.fleetViews.has(f)) this.game.fleetView(f);
      this.game.ui?.refresh();
    }
    this.refresh();
  }

  cancelDrag() { removeEventListener('pointermove', this.onMove); removeEventListener('pointerup', this.onDrop); this.ghost?.remove(); this.ghost = null; this.dragging = null; }
}
