import { setComponentText } from './componenttext.js';
import { db } from '../gamedata.js';
import { loadALO } from '../alo.js';
import { iconUrl, iconCanvasRect } from '../icons.js';
import { CommandBar, loadHudAssets, uiMeshes } from './hud.js';
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

export async function loadGalacticHudAssets() {
  const [data, shell] = await Promise.all([loadHudAssets(), loadALO('i_galactic_controls.alo')]);
  return data && shell ? { ...data, shell: uiMeshes(shell), model: shell } : null;
}

export class GalacticBar extends CommandBar {
  constructor(game, data) {
    super(game, null, data);
    this.refresh();
  }

  resize() {
    this.scale = Math.min(innerHeight / 768, innerWidth / 1024);
    this.root.style.transform = `scale(${this.scale})`;
    this.root.style.setProperty('--slack', Math.max(0, innerHeight / this.scale - 768) + 'px');
    if (this.readouts) this.refresh();
  }

  drawFaceplate() {
    return super.drawFaceplate({ exclude: ['RADAR_GALACTIC'], splitTop: true });
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
    this.slotCount = [...this.shell.keys()].filter(n => /^B_CREATE_\d+$/.test(n)).length;
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
      const cost = (b._cost = document.createElement('span'));
      this.positionCount(cost, name, true);
      b.appendChild(cost);
      b.addEventListener(
        'wheel',
        e => {
          e.preventDefault();
          e.stopPropagation();
          this.page = Math.max(0, Math.min(Math.ceil(this.optionCount / this.slotCount) - 1, this.page + Math.sign(e.deltaY)));
          this.refresh();
        },
        { passive: false }
      );
      this.slots.push(b);
    }
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
    setComponentText(this.readouts[name], this.comp(name), value, { scale: this.scale, bottom: true });
  }

  layoutSlots(options) {
    const out = new Array(this.slotCount).fill(null);
    let odd = 1,
      even = 0;
    for (const t of options) {
      if (t.num('GUI_Row', -1) === 0) {
        if (odd < this.slotCount) out[odd] = t;
        odd += 2;
      } else {
        if (even < this.slotCount) out[even] = t;
        even += 2;
      }
    }
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
      db.t('TEXT_TECH') + ' ' + ((player?.tech || 0) + db.faction(game.me).num('Displayed_Tech_Level_Adjustment', 0))
    );
    this.setReadout('Text_Pop_Cap', popUsed + ' / ' + popCap);
    this.setReadout('Text_Planet', p ? label(p.type) : '');
    this.setReadout('Text_Planetary_Income', p ? String(rounded(displayIncome(g, p))) : '');
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
    this.page = 0;
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
      b.title = label(t) + '\n$ ' + cost + (why ? '\n' + db.t(why) : '');
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
        scale: this.scale,
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
        { scale: this.scale }
      );
    });
  }
}
