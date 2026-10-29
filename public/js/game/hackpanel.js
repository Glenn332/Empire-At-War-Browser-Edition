import { db } from '../gamedata.js';
import { NativePanel, loadNativePanelAssets, tintShell } from './nativepanel.js';
import { wrapDialogText, dialogFontPixels, uiTextHeight } from './dialogtext.js';
import { componentFont, loadComponentFont } from '../nativefont.js';
import { hackCost } from './galactichack.js';

export const loadHackAssets = () => loadNativePanelAssets('hack_shell', 'i_hack.alo');

export class HackPanel extends NativePanel {
  constructor(game, data) {
    super(game, data, 'slice-panel hack-panel', db.t('TEXT_ABILITY_SLOT_HACK_SUPER_WEAPON'));
    this.images = tintShell(this); this.open = false; this.state = null;
    this.blocker = document.createElement('div'); this.blocker.className = 'market-blocker'; this.blocker.hidden = true;
    document.body.insertBefore(this.blocker, this.root);
    this.heading = this.text('hack_title01', () => db.t('TEXT_ABILITY_SLOT_HACK_SUPER_WEAPON'));
    this.lines = [0, 1, 2, 3, 4, 5, 6].map(i => this.text('hack_text_0' + i, ''));
    this.cost = this.text('hack_cost', '');
    this.acceptButton = this.button('hack_hack', () => db.t('TEXT_BUTTON_ACCEPT'), () => this.choose());
    this.closeButton = this.button('hack_close', () => db.t('TEXT_BUTTON_CANCEL'), () => this.close());
    this.paint();
  }

  show({ actor, planet }) {
    if (this.open || this.game.battle || this.game.baseLayout?.open || this.game.marketPanel?.open || this.game.corruptionPanel?.open || this.game.slicePanel?.open) return false;
    this.open = true; this.state = { actor, planet };
    this.root.hidden = this.blocker.hidden = false;
    this.game.mouse.in = false; this.game.keys.clear();
    this.refresh();
    return true;
  }

  async refresh() {
    if (!this.open) return;
    const c = this.comps.get('HACK_TEXT_00'), size = (c?.val('Size') || '').trim().split(/\s+/).map(Number), width = size[1] > 0 ? size[1] : 292;
    const face = c?.val('Font_Name') || 'Arial', pixels = dialogFontPixels(uiTextHeight(), c?.num('Font_Point_Size', 7) || 7), textScale = c?.num('Scale', 1) ?? 1;
    const text = db.t('TEXT_HACK_SUPER_WEAPON_DESCRIPTION'), font = componentFont(face, pixels) || await loadComponentFont(face, pixels);
    if (font) await font.ensure?.(text);
    if (!this.open) return;
    const measure = s => font ? font.measure(s) / this.scale * textScale : s.length * 5;
    const lines = wrapDialogText(text, width, measure);
    this.lines.forEach((el, i) => this.setText(el, lines[i] || ''));
    this.setText(this.cost, '$ ' + Math.round(hackCost()));
    this.reflowText();
  }

  close() {
    if (!this.open) return;
    this.open = false; this.state = null;
    this.root.hidden = this.blocker.hidden = true;
  }

  choose() {
    const { actor, planet } = this.state;
    this.close();
    this.game.executeHackChoice?.(actor, planet);
  }

  resize() { super.resize(); if (this.images) this.paint(); }
  paint() { this.paintShell(); }
}
