import { setComponentText } from './componenttext.js';
import { db } from '../gamedata.js';
import { iconUrl, iconCanvasRect } from '../icons.js';
import { CommandBar, loadHudAssets, loadFactionModel, loadShellModel, uiMeshes } from './hud.js';
import { displayIncome, intelligence } from './galacticfog.js';
import { playerIncome, fiscalCycleSeconds, cycleNumber, incomeBreakdown, planetBreakdown } from './galacticeconomy.js';
import { orders } from './galacticnet.js';
import {
  availableUnits,
  productionBlock,
  productionCost,
  productionContext,
  queueUnit,
  cancelProduction,
  populationUsed,
  populationCap
} from './galacticproduction.js';

const css = url => (url ? `url("${url}")` : 'none');
const label = t => db.t(t.str('Text_ID')) || t.name;
const truth = value => /^(true|yes|1)$/i.test(value || '');
const rounded = n => Math.sign(n) * Math.floor(Math.abs(n) + 0.5);

export async function loadGalacticHudAssets(faction = '') {
  const data = await loadHudAssets(faction);
  const shell = (await loadFactionModel(data, faction, 'I_GALACTIC_CONTROLS')) || (await loadShellModel(data?.comps, 'I_MAIN_COMMANDBAR', 'i_galactic_controls.alo'));
  return data && shell ? { ...data, shell: uiMeshes(shell), model: shell } : null;
}

export class GalacticBar extends CommandBar {
  constructor(game, data) {
    super(game, null, data);
    this.refresh();
  }

  resize() {
    this.scale = Math.min(innerHeight / 768, innerWidth / Math.max(1024, this.solid?.contentW || 0));
    this.root.style.transform = `scale(${this.scale})`;
    this.root.style.setProperty('--slack', Math.max(0, innerHeight / this.scale - 768) + 'px');
    for (const b of Object.values(this.heroBars || {})) b.el.style.transform = `scale(${this.scale})`;
    if (this.readouts) this.refresh();
  }

  drawFaceplate() {
    return super.drawFaceplate({ exclude: ['RADAR_GALACTIC'], splitTop: true }).then(() => this.resize());
  }
  anchorTop() {
    const y = this.solid?.splitY;
    if (y == null) return;
    for (const node of this.root.querySelectorAll('[data-control]')) {
      const m = this.shell.get(node.dataset.control.toUpperCase());
      node.classList.toggle('htop', !!m && m.origin.y >= y);
    }
  }
  refreshLanguage() {
    for (const node of this.root.querySelectorAll('[data-control]')) {
      const id = this.comp(node.dataset.control)?.val('Tooltip_Text').trim().split(/\s+/)[0];
      if (id) {
        if (node.dataset.card) {
          node.setAttribute('aria-label', db.t(id));
          continue;
        }
        node.title = db.t(id);
        if (node.tagName === 'BUTTON') node.setAttribute('aria-label', node.title);
      }
    }
    this.refresh();
  }

  build() {
    this.tab = 'space';
    this.page = 0;
    this.planet = -1;
    this.cycleTime = fiscalCycleSeconds();
    this.plate = document.createElement('canvas');
    this.plate.className = 'plate';
    this.root.appendChild(this.plate);
    this.drawFaceplate();
    this.onPoint = e => {
      const v = this.solidAt(e.clientX, e.clientY) ? 'auto' : 'none';
      this.plate.style.pointerEvents = v;
      if (this.plateTop) this.plateTop.style.pointerEvents = v;
    };
    for (const ev of ['pointermove', 'pointerdown']) addEventListener(ev, this.onPoint, true);
    this.readouts = {};
    for (const n of [
      'Text_Credits',
      'Text_Day_Credits',
      'Text_Day_Counter',
      'Text_Tech_Level',
      'Text_Pop_Cap',
      'Text_Planet',
      'Text_Planetary_Income'
    ]) {
      const t = (this.readouts[n] = this.text(n));
      t.dataset.control = n;
      const m = this.shell.get(n.toUpperCase()),
        off = (this.comp(n)?.val('Text_Offset') || '').split(/[\s,]+/).map(Number);
      if (m)
        Object.assign(t.style, {
          left: m.origin.x + (off[0] || 0) + 'px',
          bottom: m.origin.y + (off[1] || 0) + 'px',
          width: 'max-content',
          height: 'auto'
        });
      t.title = db.t(this.comp(n)?.val('Tooltip_Text').split(/\s+/)[0]);
    }
    const income = this.readouts.Text_Day_Credits;
    if (income) {
      income.setAttribute('aria-label', income.title);
      income.removeAttribute('title');
      income.dataset.card = 'income';
      income.style.setProperty('pointer-events', 'auto', 'important');
      income.onmouseenter = () => {
        const tip = this.game.galacticLog?.encyclopedia,
          g = this.game.galaxy,
          me = this.game.me;
        if (!tip || !g) return;
        const { rows, corruption } = incomeBreakdown(g, me);
        tip.showIncome({
          key: me,
          title: db.t(this.comp('Text_Day_Credits')?.val('Tooltip_Text').trim().split(/\s+/)[0]),
          rows,
          corruption: corruption === null ? null : { value: corruption, color: this.game.factionColor(me) }
        });
      };
      income.onmouseleave = () => this.game.galacticLog?.encyclopedia?.hide();
    }
    const planetIncomeText = this.readouts.Text_Planetary_Income;
    if (planetIncomeText) {
      planetIncomeText.setAttribute('aria-label', planetIncomeText.title);
      planetIncomeText.removeAttribute('title');
      planetIncomeText.dataset.card = 'planet-income';
      planetIncomeText.style.setProperty('pointer-events', 'auto', 'important');
      planetIncomeText.onmouseenter = () => {
        const tip = this.game.galacticLog?.encyclopedia,
          g = this.game.galaxy,
          p = g?.planets[this.game.selected];
        if (!tip || !p) return;
        const v = intelligence(g, p);
        if (!v?.income) return;
        tip.showIncome({
          key: 'p' + p.index,
          title: db.t(this.comp('Text_Planetary_Income')?.val('Tooltip_Text').trim().split(/\s+/)[0]),
          cost: displayIncome(g, p),
          rows: planetBreakdown(g, p, this.game.me, this.game.factionColor(this.game.me)),
          corruption: null,
          total: 'TEXT_TOOLTIP_CREDITS_TOTAL'
        });
      };
      planetIncomeText.onmouseleave = () => this.game.galacticLog?.encyclopedia?.hide();
    }
    this.buildStatusGlyphs();
    this.zoomButton = this.button('b_zoom', { onClick: () => this.game.toggleZoom() });
    this.zoomButton.setAttribute('role', 'button');
    this.zoomButton.dataset.control = 'b_zoom';
    this.zoomButton.classList.add('galactic-zoom');
    this.pauseButton = this.button('b_play_pause', {
      onClick: () => {
        this.game.setUserPaused(!this.game.userPaused);
        this.refresh();
      }
    });
    this.pauseButton.setAttribute('role', 'button');
    this.pauseButton.dataset.control = 'b_play_pause';
    this.filters = [];
    for (const i of [0, 1, 2, 3]) {
      const name = 'b_filters' + i,
        bit = 1 << i;
      const b = this.button(name, {
        onClick: () => {
          this.game.filters ^= bit;
          this.game.galaxy.displayFilters = this.game.filters;
          this.refresh();
        }
      });
      b.setAttribute('role', 'button');
      b.dataset.control = name;
      this.filters.push({ b, bit, name });
    }
    this.tabs = {};
    this.tabArt = {};
    for (const kind of ['space', 'ground']) {
      const img = (this.tabArt[kind] = document.createElement('img'));
      img.alt = '';
      img.style.pointerEvents = 'none';
      img.hidden = true;
      img.dataset.control = kind === 'ground' ? 'b_planet_tab' : 'b_space_tab';
      this.root.appendChild(img);
    }
    for (const [kind, name] of [
      ['space', 'b_space_tab'],
      ['ground', 'b_planet_tab']
    ]) {
      const b = (this.tabs[kind] = this.button(name, {
        onClick: () => {
          this.tab = kind;
          this.page = 0;
          this.refresh();
        }
      }));
      b.setAttribute('role', 'button');
      b.dataset.control = name;
      if (truth(this.comp(name)?.val('Swap_Texture'))) {
        b.classList.add('galactic-tab');
        b.style.background = 'none';
        const enter = b.onmouseenter;
        b.onmouseenter = () => {
          enter?.();
          this.tabHover = kind;
          this.showTabArt();
        };
        b.onmouseleave = () => {
          this.tabHover = null;
          this.showTabArt();
        };
      }
    }
    this.slots = [];
    {
      const bones = [...this.shell.keys()].filter(n => /^B_CREATE_\d+$/.test(n)).length,
        rows = db.constants.num('Strategic_Command_Bar_Buildable_Row_Count', 0);
      this.slotCount = rows > 0 ? Math.min(bones, rows) : bones;
    }
    for (let i = 0; i < this.slotCount; i++) {
      const name = 'b_Create_' + String(i).padStart(2, '0');
      const b = this.button(name, {
        onClick: () => {
          if (b._type && this.game.net) this.game.order(orders.build(this.game.galaxy, this.game.selected, b._type));
          else if (b._type && !queueUnit(this.game.galaxy, this.game.selected, this.game.me, b._type))
            this.game.audio.play(b._type.str('SFXEvent_Build_Started'));
          this.refresh();
        }
      });
      b.setAttribute('role', 'button');
      b.dataset.control = name;
      b.classList.add('galactic-build');
      b.addEventListener('pointerenter', e => {
        this.game.buildTip = { slot: i, b, x: e.clientX, y: e.clientY };
      });
      b.addEventListener('pointermove', e => {
        if (this.game.buildTip?.b === b) Object.assign(this.game.buildTip, { x: e.clientX, y: e.clientY });
      });
      b.addEventListener('pointerleave', () => {
        if (this.game.buildTip?.b === b) this.game.buildTip = null;
      });
      const cost = (b._cost = document.createElement('span'));
      this.positionCount(cost, name, true);
      b.appendChild(cost);
      this.slots.push(b);
    }
    this.buildBar = this.scrollBar(
      this.slots.map((_, i) => 'b_Create_' + String(i).padStart(2, '0')),
      o => {
        this.page = o;
        this.refresh();
      }
    );
    if (this.buildBar) for (const b of this.slots) this.buildBar.wheel(b);
    this.queueSlots = [];
    for (let i = 0; i < 10; i++) {
      const name = 'queue' + String(i).padStart(2, '0'),
        q = document.createElement('div');
      q.className = 'hqueue';
      this.root.appendChild(q);
      this.place(q, name);
      q.dataset.control = name;
      q.setAttribute('role', 'button');
      q.style.backgroundImage = css(this.tex(name, 'Blank_Texture_Name'));
      q.innerHTML = '<i class="ic"></i><i class="prog"></i><span></span>';
      this.positionCount(q.children[2], name);
      q.children[1].style.backgroundImage = css(this.tex(name, 'Build_Texture_Name'));
      q.onclick = () => {
        const item = q._item;
        if (item && this.game.net) {
          this.game.order(orders.cancel(this.game.galaxy, this.game.selected, item));
          return;
        }
        if (item && cancelProduction(this.game.galaxy, this.game.selected, this.game.me, item))
          this.game.audio.play(item.type.str('SFXEvent_Build_Cancelled'));
        this.refresh();
      };
      this.queueSlots.push(q);
    }
  }

  refreshAllegiance(g, p) {
    const c = this.comp('Text_Allegiance_A'),
      m = this.shell.get('TEXT_ALLEGIANCE_A');
    if (!c || !m) return;
    const v = p && intelligence(g, p),
      owner = v?.ownerKnown ? String(p.owner || '').toUpperCase() : '',
      side = n => String(db.constants.str(n) || '').toUpperCase(),
      index = !owner ? -1 : owner === side('Good_Side_Name') ? 0 : owner === side('Evil_Side_Name') ? 1 : owner === 'PIRATES' ? 2 : -1,
      texture = index < 0 ? '' : c.val('Icon_Alternate_Texture_Name').trim().split(/\s+/)[index] || '';
    if (texture === this.allegianceTexture) return;
    this.allegianceTexture = texture;
    this.allegianceGlyph?.remove();
    this.allegianceGlyph = null;
    if (!texture) return;
    const off = (c.val('Icon_Offset') || '0').split(/[\s,]+/).map(Number),
      scale = c.num('Scale', 1) || 1;
    const el = this.glyph(texture, 'Text_Allegiance_A', m.origin.x + (off[0] || 0), m.origin.y + (off[1] || 0));
    if (el && scale !== 1) el.style.transform = `scale(${scale})`;
    this.allegianceGlyph = el;
  }

  glyph(texture, control, x, y) {
    const r = iconCanvasRect(texture);
    if (!r) return null;
    const el = document.createElement('div');
    el.className = 'hicon';
    el.dataset.control = control;
    Object.assign(el.style, {
      left: x - r.w / 2 + 'px',
      bottom: y - r.h / 2 + 'px',
      width: r.w + 'px',
      height: r.h + 'px',
      backgroundImage: css(iconUrl(texture))
    });
    this.root.appendChild(el);
    return el;
  }

  buildStatusGlyphs() {
    const pop = this.comp('Text_Pop_Cap'),
      m = this.shell.get('TEXT_POP_CAP'),
      icon = pop?.val('Icon_Texture_Name').trim().split(/\s+/)[0];
    if (pop && m && icon) {
      const off = (pop.val('Icon_Offset') || '0').split(/[\s,]+/).map(Number);
      this.popGlyph = this.glyph(icon, 'Text_Pop_Cap', m.origin.x + (off[0] || 0), m.origin.y + (off[1] || 0));
    }
    const pip = this.comp('balance_pip'),
      bar = this.shell.get('FIGHT_BAR_G');
    this.pips = [];
    if (!pip || !bar) return;
    const num = (key, fallback) => {
      const v = (pip.val(key) || '').split(/[\s,]+/).map(Number);
      return v.length && v.every(Number.isFinite) ? v : fallback;
    };
    const gap = num('Offset', [6, 0]),
      at = num('Icon_Offset', [0, 0]),
      x = Math.floor(bar.origin.x) + 0.5,
      y = Math.floor(bar.origin.y) + 0.5;
    this.pipTextures = pip
      .all('Icon_Alternate_Texture_Name')
      .map(n => n.text.trim())
      .join(' ')
      .split(/\s+/)
      .filter(Boolean);
    const flash = (pip.val('Flash_Texture_Name') || pip.val('Selected_Texture_Name') || '').trim().split(/\s+/)[0];
    for (let i = 0; i < 10; i++) {
      const el = this.glyph(this.pipTextures[0], 'FIGHT_BAR_G', x + i * gap[0] + at[0], y + i * (gap[1] || 0) + (at[1] || 0));
      if (!el) continue;
      el.dataset.lit = '0';
      if (flash && iconCanvasRect(flash)) {
        const f = document.createElement('div');
        f.className = 'pip-flash';
        f.hidden = true;
        f.style.backgroundImage = css(iconUrl(flash));
        el.appendChild(f);
      }
      this.pips.push(el);
    }
  }

  updatePips() {
    const g = this.game.galaxy,
      f = g.fiscal,
      T = this.cycleTime;
    if (!this.pips?.length || !f) return;
    const level = Math.max(0, Math.min(9, Math.trunc((((g.time || 0) - f.previous) / T) * 10)));
    this.pips.forEach((el, i) => {
      const lit = i <= level ? '1' : '0';
      if (el.dataset.lit !== lit) {
        el.dataset.lit = lit;
        el.style.backgroundImage = css(iconUrl(this.pipTextures[Number(lit)] || this.pipTextures[0]));
      }
      const flash = el.firstChild;
      if (flash) flash.hidden = !(i === level && !this.game.userPaused);
    });
  }

  showTabArt() {
    for (const kind of ['space', 'ground']) {
      const img = this.tabArt[kind],
        name = kind === 'ground' ? 'b_planet_tab' : 'b_space_tab',
        c = this.comp(name),
        m = this.shell.get(name.toUpperCase());
      const state = kind === this.tab ? 'selected' : this.tabHover === kind ? 'over' : 'normal';
      const prop =
        state === 'selected'
          ? 'Selected_Texture_Name'
          : state === 'over' && c?.val('Mouse_Over_Texture_Name')
            ? 'Mouse_Over_Texture_Name'
            : 'Icon_Texture_Name';
      const texture = c?.val(prop).trim().split(/\s+/)[0],
        r = texture && iconCanvasRect(texture);
      img.hidden = !r || !m || !truth(c?.val('Swap_Texture'));
      if (img.hidden) continue;
      const off = (c.val(prop === 'Mouse_Over_Texture_Name' ? 'Mouse_Over_Offset' : 'Icon_Offset') || '0 0').split(/[\s,]+/).map(Number),
        scale = c.num('Scale', 1);
      img.src = iconUrl(texture);
      Object.assign(img.style, {
        left: m.origin.x + (off[0] || 0) - (r.w * scale) / 2 + 'px',
        bottom: m.origin.y + (off[1] || 0) - (r.h * scale) / 2 + 'px',
        width: r.w * scale + 'px',
        height: r.h * scale + 'px'
      });
    }
  }

  setReadout(name, value) {
    setComponentText(this.readouts[name], this.comp(name), value, { scale: this.scale, height: this.scale * 768, bottom: true });
  }

  layoutSlots(options) {
    const out = new Array(this.slotCount).fill(null),
      top = options.filter(t => t.num('GUI_Row', -1) === 0),
      bottom = options.filter(t => t.num('GUI_Row', -1) !== 0),
      visible = Math.ceil(this.slotCount / 2),
      total = Math.max(top.length, bottom.length);
    this.page = Math.max(0, Math.min(total - visible, this.page));
    for (let c = 0; c < visible; c++) {
      if (c * 2 < this.slotCount) out[c * 2] = bottom[c + this.page] || null;
      if (c * 2 + 1 < this.slotCount) out[c * 2 + 1] = top[c + this.page] || null;
    }
    this.buildBar?.set(total, visible, this.page);
    this.buildBar?.track.classList.toggle('space', this.tab === 'space');
    return out;
  }

  positionCount(el, name, secondary = false) {
    const m = this.shell.get(name.toUpperCase());
    if (!m) return;
    const off = (this.comp(name)?.val(secondary ? 'Text_Offset2' : 'Text_Offset') || '').split(/[\s,]+/).map(Number),
      r = this.rect(name);
    Object.assign(el.style, {
      position: 'absolute',
      left: m.origin.x - r.x + (off[0] || 0) + 'px',
      top: r.y + r.h - m.origin.y - (off[1] || 0) + 'px',
      right: 'auto',
      bottom: 'auto'
    });
  }

  refreshHeroes() {
    if (!this.heroShells) return;
    const g = this.game.galaxy,
      up = x => String(x || '').toUpperCase(),
      me = up(this.game.me),
      ids = (this.heroIds ||= new WeakMap());
    const hero = t =>
      !t
        ? null
        : t.bool('Is_Named_Hero')
          ? t
          : t
              .list('Company_Units')
              .map(n => db.type(n))
              .find(m => m?.bool('Is_Named_Hero')) || null;
    const list = [];
    const add = (u, at, fleet = null) => {
      const type = !u.dead && up(u.owner || fleet?.owner) === me && hero(u.carries || u.type);
      if (!type) return;
      if (!ids.has(u)) ids.set(u, (this.heroNext = (this.heroNext || 0) + 1));
      list.push({ e: { id: ids.get(u), player: this.player, healthFrac: 1, planet: at, fleet }, type });
    };
    for (const f of g.fleets) if (up(f.owner) === me) for (const u of f.units) add(u, f.leg ? f.leg.b : f.planet, f);
    for (const p of g.planets) for (const u of p.garrison || []) add(u, p.index);
    this.heroRow('good', list.slice(0, 11));
    this.heroBars.good.el.classList.add('nohp');
    this.heroBars.evil.el.style.display = 'none';
  }

  heroClick(h) {
    this.heroFocus(h);
  }

  heroFocus(h) {
    const game = this.game,
      v = game.view;
    const i = h.e.planet,
      transit = !!h.e.fleet?.leg,
      at = transit ? h.e.fleet.pos : game.galaxy.planets[i]?.pos;
    if (!at) return;
    if (!transit && i >= 0) game.select(i);
    if (v.zoom > 0 || v.dir > 0) {
      if (!transit && i >= 0 && v.planet !== i) game.zoomIn(i);
      return;
    }
    v.x = at[0];
    v.y = at[1];
  }

  refresh() {
    const game = this.game,
      g = game.galaxy,
      p = g.planets[game.selected],
      player = g.players.find(p => p.faction === game.me),
      text = this.readouts;
    const popUsed = populationUsed(g, game.me),
      popCap = populationCap(g, game.me);
    if (this.planet !== game.selected) {
      this.planet = game.selected;
      this.page = 0;
    }
    this.updatePips();
    this.setReadout('Text_Credits', '$ ' + rounded(player?.credits || 0));
    this.setReadout('Text_Day_Credits', '$ ' + rounded(playerIncome(g, game.me)));
    this.setReadout('Text_Day_Counter', db.t('TEXT_CYCLES') + ': ' + cycleNumber(g));
    this.setReadout(
      'Text_Tech_Level',
      String(game.me).toUpperCase() === 'UNDERWORLD'
        ? ''
        : db.t('TEXT_TECH') + ' ' + ((player?.tech || 0) + db.faction(game.me).num('Displayed_Tech_Level_Adjustment', 0))
    );
    this.setReadout('Text_Pop_Cap', popUsed + ' / ' + popCap);
    this.refreshHeroes();
    this.setReadout('Text_Planet', p ? label(p.type) : '');
    this.setReadout('Text_Planetary_Income', p ? '$ ' + rounded(displayIncome(g, p)) : '');
    this.refreshAllegiance(g, p);
    for (const { b, bit, name } of this.filters) {
      const selected = !!(game.filters & bit);
      b.classList.toggle('sel', selected);
      b.setAttribute('aria-pressed', String(selected));
      this.setButtonImage(
        b,
        'icon',
        (selected && this.textureName(name, 'Selected_Texture_Name')) || this.textureName(name, 'Icon_Texture_Name')
      );
    }
    const zoomIn = game.view.dir < 0 || (game.view.zoom === 0 && game.view.dir === 0);
    this.setButtonImage(this.zoomButton, 'icon', this.textureName('b_zoom', 'Icon_Alternate_Texture_Name', zoomIn ? 1 : 0));
    this.pauseButton.classList.toggle('sel', game.userPaused);
    this.pauseButton.setAttribute('aria-label', db.t(this.comp('b_play_pause')?.val('Tooltip_Text')));
    for (const [kind, b] of Object.entries(this.tabs)) {
      b.classList.toggle('sel', kind === this.tab);
      b.setAttribute('aria-pressed', String(kind === this.tab));
    }
    this.showTabArt();
    const options = p && p.owner === game.me ? availableUnits(g, p.index, game.me, this.tab) : [];
    const context = p ? productionContext(g, p, game.me) : [];
    const queueRoom = (p?.production?.[this.tab]?.length || 0) < db.constants.num('Max_Build_Queue', 5);
    this.optionCount = options.length;
    const layout = this.layoutSlots(options),
      disabled = n => !!player?.disabledTypes?.some(d => String(d).toUpperCase() === String(n).toUpperCase());
    this.slots.forEach((b, i) => {
      const t = (b._type = layout[i]);
      b.style.display = t ? '' : 'none';
      if (!t) return;
      const cost = productionCost(g, p, game.me, t, context),
        why = productionBlock(g, p.index, game.me, t, context);
      b.dataset.type = t.name;
      b.setAttribute('aria-label', label(t));
      b.removeAttribute('title');
      b._price = cost;
      b._status = /^TEXT_PRODUCTION_/.test(why || '') ? why : null;
      this.setButtonImage(
        b,
        'icon',
        t.str('Icon_Name') || db.type(t.list('Company_Units')[0] || t.list('Squadron_Units')[0])?.str('Icon_Name')
      );
      b.classList.toggle('dis', !!why || disabled(t.name));
      const bright = queueRoom && t.num('Population_Value', 0) <= Math.max(0, popCap - popUsed),
        v = bright ? 255 : 128,
        base = t.num('Build_Cost_Credits', 0),
        tint = cost < base ? [0, v, 0, 255] : cost > base ? [v, 0, 0, 255] : [v, v, v, 200];
      setComponentText(b._cost, this.comp('b_Create_' + String(i).padStart(2, '0')), String(cost), {
        scale: this.scale, height: this.scale * 768,
        secondary: true,
        tint
      });
    });
    this.queueSlots.forEach((q, i) => {
      const list = p?.owner === game.me ? p.production?.[i < 5 ? 'space' : 'ground'] || [] : [];
      const item = (q._item = list[i % 5]);
      q.style.display = item ? '' : 'none';
      if (!item) return;
      const t = item.type,
        progress = item.total > 0 ? Math.max(0, Math.min(1, 1 - item.left / item.total)) : 1;
      q.dataset.type = t.name;
      q.setAttribute('aria-label', label(t));
      q.title = label(t);
      q.children[0].style.backgroundImage = css(
        iconUrl(t.str('Icon_Name') || db.type(t.list('Company_Units')[0] || t.list('Squadron_Units')[0])?.str('Icon_Name'))
      );
      q.children[1].style.height = 36 * (1 - progress) + 'px';
      setComponentText(
        q.children[2],
        this.comp('queue' + String(i).padStart(2, '0')),
        i % 5 === 0 ? Math.round(progress * 100) + '%' : '',
        { scale: this.scale, height: this.scale * 768 }
      );
    });
  }
}
