import { slotFor, activateSlot, isHero } from './abilityslots.js';
import { db } from '../gamedata.js';
import { iconCanvasRect, iconUrl } from '../icons.js';
import { isRaidForce } from './raid.js';
import { strategicStealth } from './galacticfog.js';
import { drawMesh, uiMeshDepthAt } from './hud.js';
import { NativePanel, loadNativePanelAssets, typeIcon } from './nativepanel.js';
export { overviewIcon } from './nativepanel.js';
import { intelligence, unitVisible, VIS } from './galacticfog.js';
import { canViewBaseLayout } from './baselayoutdata.js';
import { canOpenPlanetInfo } from './planetinfodata.js';
import { dropOverviewUnits, pathfinderCell, pathfinderAuto } from './fleetmanagement.js';
import { orders } from './galacticnet.js';
import { canSell, sellPrice } from './galacticsell.js';
import { allied } from './humanroute.js';
import { Pointers } from './pointers.js';

const nameOf = type => type && (db.t(type.str('Text_ID')) || type.name);

export function overviewContents(g, p) {
  const v = p && intelligence(g, p),
    open = !!p && p.type.bool('Planet_Surface_Accessible', true),
    viewer = g.visibility?.viewer;
  const ground = open && v?.groundCount ? p.garrison.filter(u => allied(u.owner, p.owner)).map(u => (unitVisible(g, u, viewer, p, { ground: true }) ? u : null)) : [];
  const structures = open && v?.groundLevel ? p.groundStructures.map(u => (unitVisible(g, u, viewer, p, { ground: true, structure: true }) ? u : null)) : [];
  const here = p ? g.fleets.filter(f => f.planet === p.index && !f.leg && f.units.length) : [];
  const fleets = [],
    own = [0, 1, 2].map(() => null);
  for (const f of here.filter(f => f.owner === viewer)) {
    let slot = f.slot ?? 0;
    if (own[slot]) slot = [0, 1, 2].find(i => !own[i]);
    if (slot !== undefined) own[slot] = f;
  }
  for (const slot of [1, 2])
    if (own[slot]) fleets[slot] = { fleet: own[slot], fleets: [own[slot]], units: own[slot].units };
  const others = here.filter(
    f => f.owner !== viewer && (allied(f.owner, viewer) || (v?.fleetOverlay && !f.units.every(u => strategicStealth(u, f.owner))))
  );
  if (others.length) {
    const all = others.flatMap(f => f.units),
      order = [];
    for (const u of all) if (!order.includes(u.type)) order.push(u.type);
    const grouped = order.flatMap(t => all.filter(u => u.type === t)),
      known = others.some(f => allied(f.owner, viewer)) || v?.fleetContents,
      strongest = grouped.reduce((best, u) => (!best || u.type.num('AI_Combat_Power', 0) > best.type.num('AI_Combat_Power', 0) ? u : best), null);
    const units = known
      ? grouped
      : v?.fleetCount
        ? grouped.map(u => (u === strongest || unitVisible(g, u, viewer, p, { owner: others.find(f => f.units.includes(u))?.owner }) ? u : null))
        : [strongest];
    fleets[0] = { fleet: others[0], units, foreign: true };
  }
  if (own[0]) {
    const prior = fleets[0];
    fleets[0] = { fleet: own[0], fleets: [own[0]], units: [...(prior?.units || []), ...own[0].units] };
  }
  return {
    open,
    known: !!v?.groundCount,
    ground,
    structures,
    fleets,
    own,
    capacity: open ? Math.max(0, p.type.num('Special_Structures_Land', 3)) : 0,
    station: p?.station && v?.spaceLevel ? p.station : null
  };
}

export function stableSlots(units, count, indices) {
  const slots = Array(count).fill(null),
    pending = [];
  for (const u of units) {
    const i = u && indices.get(u);
    if (Number.isInteger(i) && i >= 0 && i < count && !slots[i]) slots[i] = { unit: u };
    else pending.push(u);
  }
  for (const u of pending) {
    const i = slots.indexOf(null);
    if (i < 0) break;
    slots[i] = { unit: u };
    if (u) indices.set(u, i);
  }
  return slots;
}

const typeOrder = new Map();
const orderOf = type => {
  if (!type) return Infinity;
  if (!typeOrder.size) [...db.types.values()].forEach((t, i) => typeOrder.set(t, i));
  return typeOrder.get(type) ?? Infinity;
};

export function packOverviewFleet(units, cells, indices, prefix = '', pf = '0000', auto = false) {
  const groups = [],
    byType = new Map(),
    positions = new Map(cells.map((s, i) => [s.name.slice(-4), i]));
  let lead = null;
  const flagged = units.find(u => u?.pathfinder) || (auto ? units.find(Boolean) : null);
  for (const unit of units) {
    if (unit && unit === flagged && pf && positions.has(pf) && !lead) {
      lead = { unit, count: 1 };
      continue;
    }
    const type = unit && (unit.carries || unit.type),
      key = type?.name,
      existing = key && byType.get(key);
    if (existing) {
      existing.count++;
      existing.members.push(unit);
      continue;
    }
    const group = { unit, count: 1, members: [unit], type };
    groups.push(group);
    if (key) byType.set(key, group);
  }
  groups.sort((a, b) => orderOf(a.type) - orderOf(b.type));
  const savedIndex = g => {
    for (const m of g.members) {
      const i = m && indices.get(m);
      if (Number.isInteger(i) && i >= 0) return i;
    }
    return undefined;
  };
  const attempt = (compact, preserve) => {
    const slots = Array(cells.length).fill(null);
    if (pf && positions.has(pf)) slots[positions.get(pf)] = lead ? { ...lead } : { reserved: true };
    const place = (group, i) => {
      if (!Number.isInteger(i) || i < 0 || i >= cells.length) return false;
      const type = group.unit && (group.unit.carries || group.unit.type),
        icon = typeIcon(type);
      const big = iconCanvasRect(prefix + 'big_' + icon) || iconCanvasRect('big_' + icon);
      const wide = !compact && big?.w >= 52,
        tall = !compact && big?.h >= 52;
      const row = +cells[i].name.slice(-4, -2),
        col = +cells[i].name.slice(-2),
        required = [i];
      const index = (r, c) => positions.get(String(r).padStart(2, '0') + String(c).padStart(2, '0'));
      if (wide) required.push(index(row, col + 1));
      if (tall) required.push(index(row + 1, col));
      if (wide && tall) required.push(index(row + 1, col + 1));
      if (required.some(n => n === undefined || slots[n])) return false;
      for (const n of required) slots[n] = { reserved: true, anchor: i };
      slots[i] = { ...group };
      return true;
    };
    const pending = groups.filter(g => !preserve || !place(g, savedIndex(g)));
    for (const g of pending) if (!cells.some((_, i) => place(g, i))) return null;
    slots.forEach((g, i) => {
      if (g?.unit) for (const m of g.members || [g.unit]) indices.set(m, i);
    });
    return { slots, compact };
  };
  return (
    attempt(false, true) ||
    attempt(false, false) ||
    attempt(true, false) || {
      compact: true,
      slots: [lead ? { ...lead } : { reserved: true }, ...groups].slice(0, cells.length)
    }
  );
}

export const loadOverviewAssets = () => loadNativePanelAssets('i_main_organize', 'i_galactic_organize.alo');

export class PlanetOverview extends NativePanel {
  constructor(game, data) {
    super(game, data, 'planet-overview', 'Planet overview');
    this.indices = this.fleetIndices = {
      get: u => u?.guiIndex,
      set: (u, i) => {
        if (u) u.guiIndex = i;
      }
    };
    this.paintKey = '';
    this.planet = -1;
    this.ground = this.controls(/^PAD_\d+$/);
    this.structures = this.controls(/^PLANET_STRUCTURE_\d+$/);
    this.spacePads = this.controls(/^SPACE_PAD_\d+$/).sort((a, b) => parseInt(a.name.slice(10), 10) - parseInt(b.name.slice(10), 10));
    this.fleets = [1, 2, 3].map(i => ({
      slots: this.controls(new RegExp(`^Q${i}_\\d{4}$`)),
      label: this.text('text_fleet' + i, () => db.t('TEXT_FLEET_PANE_' + (i - 1)), true)
    }));
    const alternates = (this.comps.get('ICON_FLEET01')?.val('Icon_Alternate_Texture_Name') || '').trim().split(/\s+/).filter(Boolean),
      tips = (this.comps.get('ICON_FLEET01')?.val('Tooltip_Text') || '').trim().split(/\s+/).filter(Boolean);
    this.fleetIcons = [1, 2, 3].map(i => {
      const origin = this.origins.get('ICON_FLEET0' + i);
      if (!origin) return null;
      const img = document.createElement('img');
      img.alt = '';
      img.className = 'overview-fleet-icon';
      img.hidden = true;
      Object.assign(img.style, { left: origin.x + 'px', top: -origin.y + 'px' });
      this.root.appendChild(img);
      return { img, alternates, tips };
    });
    this.baseButton = this.button('advanced_planetary', '', () => game.openBaseLayout());
    this.baseButton?.setAttribute('aria-label', db.t('TEXT_BASE_LAYOUT'));
    this.baseLabel = this.text('Text_Land_Fleet', () => db.t('TEXT_BASE_LAYOUT'));
    this.baseLabel2 = this.text('Text_Land_Fleet', '');
    if (this.baseLabel2) {
      const o = this.origins?.get('TEXT_LAND_FLEET'),
        off = this.comps.get('TEXT_LAND_FLEET')?.val('Text_Offset2').trim().split(/\s+/).map(Number) || [0, 0];
      if (o) {
        this.baseLabel2.style.top = -o.y - (off[1] || 0) + 'px';
        this.baseLabel2.style.left = o.x + (off[0] || 0) + 'px';
      }
    }
    this.infoButton = this.button('planet_info', '', () => game.openPlanetInfo());
    this.infoButton?.setAttribute('aria-label', db.t('TEXT_BUTTON_PLANET_INFO'));
    this.infoLabel = this.text('planet_info', () => db.t('TEXT_BUTTON_PLANET_INFO'));
    this.dragging = null;
    this.chosen = new Set();
    this.root.addEventListener('pointerdown', e => this.beginBox(e));
    this.abilitySlot = this.button('Slot_00', '', () => {});
    this.abilityLabel = this.text('Slot_00', '');
    if (this.abilitySlot) {
      this.abilitySlot.hidden = true;
      this.abilitySlot.style.zIndex = '3';
      this.abilitySlot.onpointerup = e => {
        this.slotDrop = true;
      };
    }
    if (this.abilityLabel) {
      this.abilityLabel.hidden = true;
      this.abilityLabel.style.zIndex = '3';
    }
    for (const slot of [...this.ground, ...this.structures, ...this.spacePads, ...this.fleets.flatMap(f => f.slots)]) {
      slot.record = null;
      slot.el.addEventListener('pointerenter', e => (game.overviewTip = { slot, x: e.clientX, y: e.clientY }));
      slot.el.addEventListener('pointermove', e => {
        if (game.overviewTip?.slot === slot) Object.assign(game.overviewTip, { x: e.clientX, y: e.clientY });
      });
      slot.el.addEventListener('pointerleave', () => {
        if (game.overviewTip?.slot === slot) game.overviewTip = null;
      });
      slot.el.oncontextmenu = e => {
        e.preventDefault();
        this.offerSale(slot, e);
      };
    }
    for (const slot of [...this.ground, ...this.fleets.flatMap(f => f.slots)]) {
      slot.el.style.zIndex = '1';
      slot.el.ondragstart = e => e.preventDefault();
      slot.el.onpointerdown = e => this.hitControl(e, slot.mesh) && this.beginDrag(e, slot.source, slot.dragImage || slot.img, slot);
      slot.el.onpointerup = e => this.finishDrag(e, this.hitControl(e, slot.mesh) ? slot.target : null);
    }
    this.resize();
  }

  offerSale(slot, e) {
    const game = this.game,
      rec = slot.record,
      tip = game.galacticLog?.encyclopedia;
    if (!tip || !rec || !canSell(game.galaxy, rec, game.me)) return;
    const text = ` ${db.t('TEXT_BUTTON_SELL')} ${nameOf(rec.carries || rec.type)} ($ ${sellPrice(rec)}) `;
    tip.menu(
      text,
      e.clientX,
      e.clientY,
      () => {
        if (!canSell(game.galaxy, rec, game.me)) return;
        game.audio.play('GUI_Structure_Sold');
        game.order(orders.sell(game.galaxy, rec));
      },
      { button: 'g_ground_sell', pointer: 'POINTER_TACTICAL_SELL', over: [slot.el] }
    );
  }

  emptyControl(slot) {
    slot.record = null;
    slot.icon = '';
    slot.img.hidden = true;
    this.setText(slot.count, '');
    slot.el.style.setProperty('--blank', 'none');
    slot.el.style.setProperty('--over', 'none');
    delete slot.el.dataset.type;
    slot.el.title = '';
    slot.el.removeAttribute('aria-label');
    slot.el.removeAttribute('role');
    slot.el.hidden = false;
  }

  covers(cx, cy) {
    if (this.root.hidden) return false;
    const x = (cx - parseFloat(this.root.style.left)) / this.scale,
      y = -(cy - parseFloat(this.root.style.top)) / this.scale;
    for (const [n, mesh] of this.shell)
      if ((/^Q[123]_FRAME$/.test(n) || n.startsWith('LAND_ART_ALT')) && uiMeshDepthAt(mesh, x, y) > -Infinity) return true;
    return false;
  }

  hitControl(e, mesh) {
    const x = (e.clientX - parseFloat(this.root.style.left)) / this.scale,
      y = -(e.clientY - parseFloat(this.root.style.top)) / this.scale;
    return uiMeshDepthAt(mesh, x, y) > -Infinity;
  }

  allSlots() {
    return [...this.ground, ...this.fleets.flatMap(f => f.slots)];
  }

  chosenSources(primary) {
    return this.allSlots()
      .filter(s => s.source && s.source !== primary && s.source.planet === primary.planet && s.source.records.some(r => this.chosen.has(r)))
      .map(s => s.source);
  }

  paintChosen() {
    const live = new Set();
    for (const s of this.allSlots()) {
      const rec = s.source?.records?.[0];
      if (rec) live.add(rec);
      s.el.classList.toggle('chosen', !!rec && this.chosen.has(rec));
    }
    for (const r of [...this.chosen]) if (!live.has(r)) this.chosen.delete(r);
  }

  beginBox(e) {
    if (e.button !== 0 || this.dragging || this.game.busy || this.game.controlsLocked) return;
    if (e.target.closest?.('.overview-slot,button,.native-button')) return;
    const shift = e.shiftKey,
      box = { x: e.clientX, y: e.clientY, moved: false, el: null };
    const move = ev => {
      if (!box.moved && Math.hypot(ev.clientX - box.x, ev.clientY - box.y) > 12) {
        box.moved = true;
        box.el = document.createElement('div');
        box.el.style.cssText = 'position:fixed;z-index:15;pointer-events:none;border:1px solid #fff;background:rgba(255,255,255,.2)';
        document.body.appendChild(box.el);
      }
      if (box.el)
        Object.assign(box.el.style, {
          left: Math.min(box.x, ev.clientX) + 'px',
          top: Math.min(box.y, ev.clientY) + 'px',
          width: Math.abs(ev.clientX - box.x) + 'px',
          height: Math.abs(ev.clientY - box.y) + 'px'
        });
    };
    const up = ev => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      box.el?.remove();
      if (!box.moved) {
        if (!shift) this.chosen.clear();
      } else {
        const l = Math.min(box.x, ev.clientX),
          r = Math.max(box.x, ev.clientX),
          t = Math.min(box.y, ev.clientY),
          b = Math.max(box.y, ev.clientY);
        this.chosen.clear();
        for (const s of this.allSlots()) {
          const rec = s.source?.records?.[0],
            rc = s.el.getBoundingClientRect(),
            x = rc.left + rc.width / 2,
            y = rc.top + rc.height / 2;
          if (rec && !s.el.hidden && x >= l && x <= r && y >= t && y <= b) this.chosen.add(rec);
        }
      }
      this.paintChosen();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  beginDrag(e, source, image, slot = null) {
    if (e.button !== 0 || !source || this.dragging || this.game.busy || this.game.controlsLocked) return;
    e.preventDefault();
    e.stopPropagation();
    const pressed = source.records?.[0];
    if (pressed && !this.chosen.has(pressed) && !e.shiftKey) this.chosen.clear();
    this.press = { record: pressed, shift: e.shiftKey, was: pressed ? this.chosen.has(pressed) : false };
    if (e.ctrlKey && source.records?.length === 1) {
      const one = source.records[0],
        type = one.carries || one.type,
        all = source.kind === 'ground' ? this.game.galaxy.planets[source.planet].garrison : source.fleet.units;
      source = {
        ...source,
        records: all.filter(u => (u.carries || u.type) === type && (source.kind !== 'ground' || u.owner === this.game.me))
      };
    }
    if (pressed && this.chosen.size && (this.chosen.has(pressed) || e.shiftKey)) this.chosen.add(pressed);
    this.dragging = { source, x: e.clientX, y: e.clientY, moved: false, empty: [] };
    (this.dragCursor ||= new Pointers(document.body)).set('POINTER_GRABBING');
    this.showSlot(source);
    for (const slot of [...this.ground, ...this.fleets.flatMap(f => f.slots)])
      if (slot.el.hidden) {
        this.dragging.empty.push(slot);
        this.emptyControl(slot);
      }
    if (image) {
      this.ghost = image.cloneNode();
      this.ghost.className = 'layout-drag-ghost';
      this.ghost.hidden = true;
      document.body.appendChild(this.ghost);
    }
    this.onMove = event => {
      const drag = this.dragging;
      if (!drag) return;
      drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 12;
      if (this.ghost) {
        this.ghost.hidden = !drag.moved;
        Object.assign(this.ghost.style, {
          left: event.clientX + 'px',
          top: event.clientY + 'px',
          transform: `translate(-50%,-50%) scale(${this.scale})`
        });
      }
    };
    this.onDrop = event => this.finishDrag(event, null);
    this.onCancel = () => this.cancelDrag();
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onDrop);
    addEventListener('blur', this.onCancel);
  }

  showSlot(source) {
    this.slotDrop = false;
    this.slotCode = null;
    const record = source?.records?.length === 1 ? source.records[0] : null,
      planet = record && this.game.galaxy.planets[source.planet];
    const owner = source?.fleet?.owner ?? record?.owner;
    if (!record || owner !== this.game.me || !isHero(record) || !this.abilitySlot) return;
    const slot = slotFor(this.game, record, planet, owner);
    if (!slot) return;
    this.slotCode = slot.code;
    this.abilitySlot.hidden = false;
    if (this.abilityLabel) {
      this.abilityLabel.hidden = false;
      this.setText(this.abilityLabel, slot.label);
    }
  }

  finishDrag(e, target) {
    if (!this.dragging) return;
    const { source, moved } = this.dragging,
      onSlot = this.slotDrop && this.slotCode;
    this.cancelDrag();
    if (onSlot && source.records?.length === 1) {
      if (this.game.net) {
        this.game.order(orders.slot(this.game.galaxy, source.records[0], source.planet));
        this.refresh();
        return;
      }
      const fired = activateSlot(
        this.game,
        source.records[0],
        this.game.galaxy.planets[source.planet],
        source.fleet?.owner ?? source.records[0].owner
      );
      if (fired) {
        this.game.galacticBattleChanged();
        this.game.ui?.refresh();
      }
      this.refresh();
      return;
    }
    const press = this.press;
    this.press = null;
    if (!moved && press?.record) {
      if (press.shift) {
        if (press.was) this.chosen.delete(press.record);
        else this.chosen.add(press.record);
      } else {
        this.chosen.clear();
        this.chosen.add(press.record);
      }
    }
    if (moved && source.kind === 'ground' && target?.kind === 'ground' && target.planet === source.planet && Number.isInteger(target.cell)) {
      if (this.movePad(source, target)) {
        this.paintKey = '';
        this.refresh();
      }
      return;
    }
    const group = moved && source.records?.some(r => this.chosen.has(r)) ? this.chosenSources(source) : [];
    if (moved && target?.kind === 'fleet' && Number.isInteger(target.cell) && !target.pf)
      for (const s of [source, ...group]) for (const r of s.records || []) r.guiIndex = target.cell;
    if (this.game.net) {
      if (moved && target) for (const s of [source, ...group]) this.game.order(orders.drop(this.game.galaxy, s, target));
      this.refresh();
      this.paintChosen();
      return;
    }
    let changed = moved && dropOverviewUnits(this.game, source, target);
    for (const other of moved && target ? group : []) changed = dropOverviewUnits(this.game, other, target) || changed;
    if (changed) {
      this.game.galacticBattleChanged();
      this.game.ui?.refresh();
    }
    this.refresh();
    this.paintChosen();
  }

  badge(slot, record) {
    const type = record && (record.carries || record.type),
      on = !!type && strategicStealth({ type }, record.owner);
    (slot.grab ||= new Pointers(slot.el)).set(slot.source ? 'POINTER_CAN_GRAB' : null);
    if (!on) {
      if (slot.badgeEl) slot.badgeEl.hidden = true;
      return;
    }
    const r = iconCanvasRect('i_icon_stealth.tga');
    if (!r) return;
    if (!slot.badgeEl) {
      slot.badgeEl = document.createElement('img');
      slot.badgeEl.alt = '';
      slot.badgeEl.src = iconUrl('i_icon_stealth.tga');
      Object.assign(slot.badgeEl.style, { position: 'absolute', left: '0px', top: '0px', width: r.w + 'px', height: r.h + 'px', pointerEvents: 'none', zIndex: 2 });
      slot.el.appendChild(slot.badgeEl);
    }
    slot.badgeEl.hidden = false;
    slot.badgeEl.style.left = slot.img.offsetLeft + 'px';
    slot.badgeEl.style.top = slot.img.offsetTop + 'px';
  }

  movePad(source, target) {
    const p = this.game.galaxy.planets[source.planet],
      rec = source.records?.[0];
    if (!p || !rec || !p.garrison.includes(rec)) return false;
    const count = this.ground.length,
      slot = target.cell,
      at = i => p.garrison.find(u => u !== rec && u.guiIndex === i);
    rec.guiIndex = -1;
    if (at(slot)) {
      let empty = -1;
      for (let i = slot + 1; i < count && empty < 0; i++) if (!at(i)) empty = i;
      for (let i = slot - 1; i >= 0 && empty < 0; i--) if (!at(i)) empty = i;
      if (empty > slot) for (let i = empty - 1; i >= slot; i--) at(i).guiIndex = i + 1;
      else if (empty >= 0) for (let i = empty + 1; i <= slot; i++) at(i).guiIndex = i - 1;
    }
    rec.guiIndex = slot;
    return true;
  }

  cancelDrag() {
    this.dragCursor?.set(null);
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onDrop);
    removeEventListener('blur', this.onCancel);
    for (const slot of this.dragging?.empty || []) slot.el.hidden = true;
    if (this.abilitySlot) this.abilitySlot.hidden = true;
    if (this.abilityLabel) this.abilityLabel.hidden = true;
    this.slotCode = null;
    this.ghost?.remove();
    this.ghost = null;
    this.dragging = null;
  }

  update() {
    const game = this.game,
      p = game.galaxy.planets[game.view.planet];
    const visible = !!p && !game.battle && !game.baseLayout?.open && game.view.zoom > 0.9;
    const opened = this.root.hidden && visible;
    const closing = !this.root.hidden && !visible;
    this.root.hidden = !visible;
    if (closing) this.game.galacticLog?.encyclopedia?.closeMenu();
    if (!visible) {
      if (this.dragging) this.cancelDrag();
      return;
    }
    this.root.style.opacity = Math.max(0, Math.min(1, (game.view.zoom - 0.9) * 10));
    if (opened) {
      this.refresh();
      this.reflowText();
    }
  }

  refresh() {
    if (this.dragging) return;
    this.baseButton?.setAttribute('aria-label', db.t('TEXT_BASE_LAYOUT'));
    this.infoButton?.setAttribute('aria-label', db.t('TEXT_BUTTON_PLANET_INFO'));
    const game = this.game,
      p = game.galaxy.planets[game.view.planet];
    if (this.root.hidden || !p) return;
    this.root.setAttribute('aria-label', nameOf(p.type) + ' — planet overview');
    if (this.planet !== p.index) {
      this.planet = p.index;
      this.paintKey = '';
    }
    const state = overviewContents(game.galaxy, p);
    if (this.infoButton) {
      const tutorial = game.galaxy.players.find(p => p.faction === game.me)?.tutorial;
      this.infoButton.hidden = !!(tutorial && game.view.zoom === 1 && !game.view.dir);
      this.infoButton.disabled = !canOpenPlanetInfo(game, game.galaxy.planets[game.selected]);
      if (this.infoLabel) this.infoLabel.hidden = this.infoButton.hidden;
    }
    if (this.baseButton) {
      this.baseButton.hidden = !!p.destroyed;
      this.baseButton.disabled = false;
    }
    if (this.baseLabel) this.baseLabel.hidden = !!p.destroyed;
    if (this.baseLabel2) {
      this.baseLabel2.hidden = !!p.destroyed;
      this.setText(this.baseLabel2, p.destroyed || canViewBaseLayout(game.galaxy, p, game.me) ? '' : db.t('TEXT_UNKNOWN'));
    }
    const terrain = p.destroyed ? 8 : Math.max(0, p.type.num('Zoomed_Terrain_Index', 0));
    this.paint(terrain, state.known);
    const units = stableSlots(state.ground, this.ground.length, this.indices);
    this.ground.forEach((s, i) => {
      const record = units[i]?.unit;
      s.target = { kind: 'ground', planet: p.index, cell: i };
      s.source = p.owner === game.me && record?.owner === game.me ? { kind: 'ground', planet: p.index, records: [record] } : null;
      this.put(s, units[i]);
      this.badge(s, record);
      this.track(s, record);
      if (!units[i] && state.open) this.emptyControl(s);
    });
    const count = Math.min(this.structures.length, state.capacity),
      built = stableSlots(state.structures, count, this.indices);
    this.structures.forEach((s, i) => {
      const c = this.comps.get(s.name),
        blankName = c?.val('Blank_Texture_Name').trim().split(/\s+/)[0];
      this.put(s, built[i], { blank: state.open && i < count ? blankName : '', big: false });
      this.track(s, built[i]?.unit);
    });
    this.spacePads.forEach((s, i) => {
      const blankName = this.comps.get(s.name)?.val('Blank_Texture_Name').trim().split(/\s+/)[0];
      const record = i === 0 && state.station ? { unit: { type: state.station, owner: p.stationOwner || p.owner } } : null;
      this.put(s, record, { blank: blankName || '', big: false });
      this.track(s, null);
    });
    this.fleets.forEach((f, i) => {
      const fleet = state.fleets[i]?.fleet,
        units = state.fleets[i]?.units || [],
        pf = pathfinderCell(),
        packed = packOverviewFleet(units, f.slots, this.fleetIndices, this.prefix, pf, pathfinderAuto());
      const mark = this.fleetIcons[i],
        raid = !!fleet && isRaidForce(fleet),
        stealth = !!fleet && fleet.units.length > 0 && fleet.units.every(u => strategicStealth(u, fleet.owner)),
        pick = stealth ? 0 : raid ? 1 : -1;
      if (mark) {
        const name = mark.alternates[pick],
          rect = name && iconCanvasRect(name);
        mark.img.hidden = !name || !rect;
        if (name && rect) {
          mark.img.src = iconUrl(name);
          mark.img.style.width = rect.w + 'px';
          mark.img.style.height = rect.h + 'px';
          mark.img.title = db.t(mark.tips[pick]) || '';
        }
      }
      f.slots.forEach((s, n) => {
        const anchor = packed.slots[n]?.anchor,
          record = packed.slots[n]?.unit || packed.slots[anchor]?.unit;
        s.dragImage = anchor !== undefined ? f.slots[anchor].img : s.img;
        const home = (state.fleets[i]?.fleets || (fleet ? [fleet] : [])).find(x => x.units.includes(record)) || fleet;
        s.target = { kind: 'fleet', planet: p.index, slot: i, fleet: state.own?.[i] || null, pf: !!pf && s.name.endsWith('_' + pf), cell: n };
        s.source = home?.owner === game.me && record && !record.structure ? { kind: 'fleet', planet: p.index, fleet: home, records: [record] } : null;
        this.put(s, packed.slots[n], {
          blank: pf && s.name.endsWith('_' + pf) ? this.comps.get(s.name)?.val('Blank_Texture_Name') : '',
          packed: packed.compact
        });
        if (anchor !== undefined) this.emptyControl(s);
        this.badge(s, anchor !== undefined ? null : record);
        this.track(s, record?.structure || record);
      });
    });
    this.paintChosen();
  }

  track(slot, record) {
    slot.record = record || null;
    if (slot.record) slot.el.removeAttribute('title');
  }

  paint(terrain, known) {
    const key = [terrain, known, this.scale, devicePixelRatio].join('|');
    if (key === this.paintKey) return;
    this.paintKey = key;
    const b = this.bounds,
      k = Math.min(3, Math.max(1, Math.ceil(this.scale * devicePixelRatio)), Math.max(1, Math.floor(Math.sqrt(12e6 / (b.w * b.h))))),
      cv = this.plate;
    cv.width = b.w * k;
    cv.height = b.h * k;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    for (const [n, mesh] of this.shell) {
      if (!/^Q[123]_FRAME$/.test(n) && n !== 'LAND_ART_ALT' + terrain) continue;
      const img = this.textures.get(mesh.texture);
      if (!img) continue;
      ctx.globalAlpha = n.startsWith('LAND_ART') && !known ? 0.25 : 1;
      drawMesh(ctx, img, mesh, (x, y) => [(x - b.x) * k, (b.y - y) * k]);
    }
  }
}
