import { db } from '../gamedata.js';
import { iconCanvasRect, iconUrl } from '../icons.js';
import { NativePanel, loadNativePanelAssets, tintShell } from './nativepanel.js';
import { encyclopediaLines } from './galacticencyclopedia.js';

const css = url => (url ? `url("${url}")` : 'none');
export const loadSliceAssets = () => loadNativePanelAssets('target_type_back', 'i_neutralize_hero.alo');

export class SlicePanel extends NativePanel {
  constructor(game, data) {
    super(game, data, 'slice-panel', db.t('TEXT_SLICE_DIALOG_TITLE'));
    this.images = tintShell(this);
    this.open = false;
    this.state = null;
    this.blocker = document.createElement('div');
    this.blocker.className = 'market-blocker';
    this.blocker.hidden = true;
    document.body.insertBefore(this.blocker, this.root);
    this.heading = this.text('h_title', '');
    this.lines = [];
    this.slots = this.controls(/^H_\d{4}$/);
    this.names = this.slots.map((_, i) => this.text('h_name_' + String(i).padStart(2, '0'), ''));
    this.names2 = this.slots.map((_, i) => this.extraLine('h_name_' + String(i).padStart(2, '0')));
    this.prices = this.slots.map((_, i) => this.text('h_price_' + String(i).padStart(2, '0'), ''));
    this.closeButton = this.button(
      'h_close',
      () => db.t('TEXT_BUTTON_CANCEL'),
      () => this.close()
    );
    const over = this.comps.get('H_0000')?.val('Mouse_Over_Texture_Name').trim().split(/\s+/)[0] || '',
      r = iconCanvasRect(over);
    this.slots.forEach((slot, i) => {
      slot.el.style.setProperty('--over', css(iconUrl(over)));
      slot.el.style.setProperty('--over-w', (r?.w || 0) + 'px');
      slot.el.style.setProperty('--over-h', (r?.h || 0) + 'px');
      slot.el.style.setProperty('--over-x', '0px');
      slot.el.style.setProperty('--over-y', '0px');
      slot.el.onclick = () => {
        if (slot.el.getAttribute('aria-disabled') !== 'true' && slot.row) this.choose(slot.row);
      };
      slot.el.onmouseenter = () => {
        if (slot.row) {
          this.game.galacticLog?.encyclopedia?.showType(slot.row.type, false);
          if (slot.el.getAttribute('aria-disabled') !== 'true') this.game.audio.play(this.comps.get('H_0000')?.val('Mouse_Over_SFX') || '');
        }
      };
      slot.el.onmouseleave = () => this.game.galacticLog?.encyclopedia?.hide();
    });
    this.paint();
  }

  extraLine(name) {
    const el = this.text(name, '');
    if (!el) return el;
    const o = this.origins.get(name.toUpperCase()),
      off = this.comps.get(name.toUpperCase())?.val('Text_Offset2').trim().split(/\s+/).map(Number) || [0, 0];
    el.style.top = -o.y - (off[1] || 0) + 'px';
    el.style.left = o.x + (off[0] || 0) + 'px';
    return el;
  }

  show({ actor, planet, rows, respawn, only }) {
    if (
      this.open ||
      !rows.length ||
      this.game.battle ||
      this.game.baseLayout?.open ||
      this.game.marketPanel?.open ||
      this.game.corruptionPanel?.open
    )
      return false;
    this.open = true;
    this.state = { actor, planet, rows: rows.slice(0, 12), respawn, only };
    this.root.hidden = this.blocker.hidden = false;
    this.game.mouse.in = false;
    this.game.keys.clear();
    this.reflowText();
    this.fill();
    this.refresh();
    return true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.state = null;
    this.game.galacticLog?.encyclopedia?.hide();
    this.root.hidden = this.blocker.hidden = true;
    for (const slot of this.slots) slot.row = null;
  }

  choose(row) {
    const { actor, planet, respawn, only } = this.state,
      game = this.game;
    this.close();
    game.executeSliceChoice?.(actor, planet, row, only, respawn);
    game.story?.generic?.('slice');
    game.ui?.refresh();
  }

  fill() {
    const { rows } = this.state,
      frame = Math.max(0, Math.min(5, Math.trunc((rows.length - 1) / 2)));
    this.frame = frame;
    this.paint();
    const shift = (5 - frame) * 43;
    for (const el of this.lines) {
      this.textLabels.delete(el);
      el.remove();
    }
    this.lines = [];
    const o = this.origins.get('TEXT_HERO'),
      size = this.comps.get('TEXT_HERO')?.val('Size').trim().split(/\s+/).map(Number) || [57, 10];
    encyclopediaLines(db.t('TEXT_SLICE_DIALOG_DESCRIPTION'), size[0]).forEach((line, k) => {
      const el = this.text('text_hero', line);
      if (!el) return;
      el.style.top = -o.y - shift + k * size[1] + 'px';
      this.lines.push(el);
    });
    const m = this.shell.get('H_CLOSE'),
      b = this.closeButton,
      label = this.root.querySelector('.ht[data-control="H_CLOSE"]'),
      c = this.origins.get('H_CLOSE'),
      off = this.comps.get('H_CLOSE')?.val('Text_Offset').trim().split(/\s+/).map(Number) || [0, 0];
    if (m && b) b.style.top = -m.rect.y - m.rect.h - shift + 'px';
    if (label && c) label.style.top = -c.y - (off[1] || 0) - shift + 'px';
    this.setText(this.heading, db.t('TEXT_SLICE_DIALOG_TITLE'));
  }

  refresh() {
    if (!this.open) return;
    const { actor, rows } = this.state,
      game = this.game,
      player = game.galaxy.players.find(p => String(p.faction).toUpperCase() === String(actor.owner).toUpperCase());
    const credits = Math.trunc((player?.credits ?? 0) + 0.5);
    const tint = (el, color) => {
      const label = this.textLabels.get(el);
      if (label) {
        label.tint = color;
        this.setText(el, label.source ?? label.value);
      }
    };
    this.slots.forEach((slot, i) => {
      const row = rows[i];
      slot.row = row || null;
      slot.el.hidden = !row;
      for (const el of [this.names[i], this.names2[i], this.prices[i]]) if (el) el.hidden = !row;
      if (!row) {
        slot.el.setAttribute('aria-disabled', 'true');
        return;
      }
      const icon = row.type.str('Icon_Name') || 'i_button_temporary.tga',
        r = iconCanvasRect(icon);
      slot.img.hidden = false;
      slot.img.src = iconUrl(icon);
      slot.img.style.width = (r?.w || 43) + 'px';
      slot.img.style.height = (r?.h || 43) + 'px';
      const name = db.t(row.type.str('Text_ID')) || row.type.name,
        [first, ...rest] = encyclopediaLines(name, 20);
      const price = Math.trunc(row.cost + 0.5),
        usable = credits >= price,
        color = usable ? [255, 255, 255, 255] : [128, 128, 128, 255];
      this.setText(this.names[i], first || '');
      this.setText(this.names2[i], rest.join(' '));
      this.setText(this.prices[i], `$ ${price}`);
      tint(this.names[i], color);
      tint(this.names2[i], color);
      tint(this.prices[i], color);
      slot.img.style.filter = usable ? '' : 'brightness(0.5)';
      slot.el.setAttribute('aria-disabled', usable ? 'false' : 'true');
    });
  }

  resize() {
    super.resize();
    if (this.images) this.paint();
  }
  paint() {
    this.paintShell(name => name === `FRAME_ALT${this.frame ?? 5}`);
  }
}
