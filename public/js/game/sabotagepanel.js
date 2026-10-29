import { db } from '../gamedata.js';
import { iconCanvasRect, iconUrl } from '../icons.js';
import { NativePanel, loadNativePanelAssets, tintShell } from './nativepanel.js';
import { encyclopediaLines } from './galacticencyclopedia.js';

const css = url => (url ? `url("${url}")` : 'none');
export const loadSabotageAssets = () => loadNativePanelAssets('bm_frame', 'i_sabotage.alo');
const PRICES = ['000', '001', '100', '101', '200', '201', '300', '301', '400', '401'];

export class SabotagePanel extends NativePanel {
  constructor(game, data) {
    super(game, data, 'slice-panel sabotage-panel', db.t('TEXT_SABOTAGE_BUILDING'));
    this.images = tintShell(this); this.open = false; this.state = null;
    this.blocker = document.createElement('div'); this.blocker.className = 'market-blocker'; this.blocker.hidden = true;
    document.body.insertBefore(this.blocker, this.root);
    this.heading = this.text('bm_title01', db.t('TEXT_SABOTAGE_BUILDING'));
    this.lines = [];
    this.slots = this.controls(/^BM_\d{4}$/);
    this.names = this.slots.map((_, i) => this.text('bm_title_' + (402 + i), ''));
    this.names2 = this.slots.map((_, i) => this.extraLine('bm_title_' + (402 + i)));
    this.prices = this.slots.map((_, i) => this.text('bm_title_' + PRICES[i], ''));
    this.closeButton = this.button('bm_close', () => db.t('TEXT_BUTTON_CANCEL'), () => this.close());
    const over = this.comps.get('BM_0000')?.val('Mouse_Over_Texture_Name').trim().split(/\s+/)[0] || '', r = iconCanvasRect(over);
    this.slots.forEach(slot => {
      slot.el.style.setProperty('--over', css(iconUrl(over)));
      slot.el.style.setProperty('--over-w', (r?.w || 0) + 'px'); slot.el.style.setProperty('--over-h', (r?.h || 0) + 'px');
      slot.el.style.setProperty('--over-x', '0px'); slot.el.style.setProperty('--over-y', '0px');
      slot.el.onclick = () => { if (slot.el.getAttribute('aria-disabled') !== 'true' && slot.row) this.choose(slot.row); };
      slot.el.onmouseenter = () => { if (slot.row) { this.game.galacticLog?.encyclopedia?.showType(slot.row.structure.type, false); if (slot.el.getAttribute('aria-disabled') !== 'true') this.game.audio.play(this.comps.get('BM_0000')?.val('Mouse_Over_SFX') || ''); } };
      slot.el.onmouseleave = () => this.game.galacticLog?.encyclopedia?.hide();
    });
    this.paint();
  }

  extraLine(name) {
    const el = this.text(name, ''); if (!el) return el;
    const o = this.origins.get(name.toUpperCase()), off = this.comps.get(name.toUpperCase())?.val('Text_Offset2').trim().split(/\s+/).map(Number) || [0, 0];
    el.style.top = (-o.y - (off[1] || 0)) + 'px'; el.style.left = (o.x + (off[0] || 0)) + 'px';
    return el;
  }

  show({ actor, planet, ability, rows }) {
    this.game.story?.generic?.('open_galactic_sabotage_menu');
    if (this.open || !rows.length || this.game.battle || this.game.baseLayout?.open || this.game.marketPanel?.open || this.game.corruptionPanel?.open || this.game.slicePanel?.open) return false;
    this.open = true; this.state = { actor, planet, ability, rows: rows.slice(0, 10) };
    this.root.hidden = this.blocker.hidden = false;
    this.game.mouse.in = false; this.game.keys.clear();
    this.reflowText();
    this.fill();
    this.refresh();
    return true;
  }

  close() {
    if (!this.open) return;
    this.open = false; this.state = null; this.game.galacticLog?.encyclopedia?.hide();
    this.root.hidden = this.blocker.hidden = true;
    for (const slot of this.slots) slot.row = null;
  }

  choose(row) {
    const { actor, planet, ability } = this.state, game = this.game;
    this.close();
    game.executeSabotageChoice?.(actor, planet, ability, row);
    game.ui?.refresh();
  }

  fill() {
    for (const el of this.lines) { this.textLabels.delete(el); el.remove(); }
    this.lines = [];
    const o = this.origins.get('BM_TEXT_STEAL'), size = this.comps.get('BM_TEXT_STEAL')?.val('Size').replace('`', '').trim().split(/\s+/).map(Number) || [37, 10];
    encyclopediaLines(db.t('TEXT_SABOTAGE_DESCRIPTION'), size[0]).forEach((line, k) => {
      const el = this.text('bm_text_steal', line, true); if (!el) return;
      el.style.top = (-o.y + k * size[1]) + 'px'; this.lines.push(el);
    });
    this.setText(this.heading, db.t('TEXT_SABOTAGE_BUILDING'));
  }

  refresh() {
    if (!this.open) return;
    const { actor, rows } = this.state, game = this.game, player = game.galaxy.players.find(p => String(p.faction).toUpperCase() === String(actor.owner).toUpperCase());
    const credits = Math.trunc((player?.credits ?? 0) + 0.5);
    const tint = (el, color) => { const label = this.textLabels.get(el); if (label) { label.tint = color; this.setText(el, label.source ?? label.value); } };
    this.slots.forEach((slot, i) => {
      const row = rows[i];
      slot.row = row || null; slot.el.hidden = !row;
      for (const el of [this.names[i], this.names2[i], this.prices[i]]) if (el) el.hidden = !row;
      if (!row) { slot.el.setAttribute('aria-disabled', 'true'); return; }
      const type = row.structure.type, icon = type.str('Icon_Name') || 'i_button_temporary.tga', r = iconCanvasRect(icon);
      slot.img.hidden = false; slot.img.src = iconUrl(icon); slot.img.style.width = (r?.w || 43) + 'px'; slot.img.style.height = (r?.h || 43) + 'px';
      const name = db.t(type.str('Text_ID')) || type.name, [first, ...rest] = encyclopediaLines(name, 20);
      const price = Math.trunc(row.price + 0.5), usable = credits >= price;
      const grey = [128, 128, 128, 255], white = [255, 255, 255, 255], red = [255, 64, 64, 255];
      this.setText(this.names[i], first || ''); this.setText(this.names2[i], rest.join(' ')); this.setText(this.prices[i], `$ ${price}`);
      tint(this.names[i], usable ? white : grey); tint(this.names2[i], usable ? white : grey); tint(this.prices[i], !usable ? grey : price > type.num('Sabotage_Cost_Credits', 0) ? red : white);
      slot.img.style.filter = usable ? '' : 'brightness(0.5)';
      slot.el.setAttribute('aria-disabled', usable ? 'false' : 'true');
    });
  }

  resize() { super.resize(); if (this.images) this.paint(); }
  paint() { this.paintShell(); }
}
