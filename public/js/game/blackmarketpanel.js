import { db } from '../gamedata.js';
import { iconCanvasRect, iconUrl } from '../icons.js';
import { NativePanel, loadNativePanelAssets, tintShell } from './nativepanel.js';
import { GalacticEncyclopedia } from './galacticencyclopedia.js';
import { completePurchase, displayedTech } from './blackmarket.js';

const css = url => (url ? `url("${url}")` : 'none');
const key = s => String(s || '').toUpperCase();
const GREY = [128, 128, 128, 255], LIGHT = [192, 192, 192, 255], RED = [255, 16, 16, 255], WHITE = [255, 255, 255, 255];

export const loadMarketAssets = () => loadNativePanelAssets('market_frame', 'i_black_market.alo');

export class MarketPanel extends NativePanel {
  constructor(game, data) {
    super(game, data, 'black-market', db.t('TEXT_BLACK_MARKET_TITLE'));
    this.images = tintShell(this); this.open = false; this.state = null;
    this.blocker = document.createElement('div'); this.blocker.className = 'market-blocker'; this.blocker.hidden = true;
    document.body.insertBefore(this.blocker, this.root);
    this.head = [0, 1, 2, 3].map(i => this.text('market_title0' + i, ''));
    this.items = this.controls(/^MARKET_0\d$/); this.tech = this.controls(/^MARKET_TECH_LEVEL\d+$/);
    this.names = ['04', '06', '08', '10', '12'].map(n => this.text('market_title' + n, ''));
    this.prices = ['05', '07', '09', '11', '13'].map(n => this.text('market_title' + n, ''));
    this.closeButton = this.button('market_close', () => db.t('TEXT_BUTTON_CANCEL'), () => this.close());
    this.tip = new GalacticEncyclopedia(game, { comps: data.comps, model: data.model });
    this.tip.anchorFn = () => {
      const o = this.origins.get('I_BLACKMARKET_ENCYCL') || { x: 0, y: 0 }, s = this.game.overlayScale();
      return [innerWidth / 2 / s + o.x, innerHeight / 2 / s + o.y];
    };
    const over = this.comps.get('MARKET_00')?.val('Mouse_Over_Texture_Name').trim().split(/\s+/)[0] || '', r = iconCanvasRect(over);
    this.items.forEach((slot, k) => {
      slot.el.style.setProperty('--over', css(iconUrl(over)));
      slot.el.style.setProperty('--over-w', (r?.w || 0) + 'px'); slot.el.style.setProperty('--over-h', (r?.h || 0) + 'px');
      slot.el.style.setProperty('--over-x', '0px'); slot.el.style.setProperty('--over-y', '0px');
      slot.el.onclick = () => { if (slot.el.getAttribute('aria-disabled') !== 'true' && slot.row) this.buy(slot.row); };
      slot.el.onmouseenter = () => { if (slot.row) { if (slot.el.getAttribute('aria-disabled') !== 'true') this.game.audio.play(this.comps.get('MARKET_00')?.val('Mouse_Over_SFX') || ''); this.tip.showItem(slot.row.item); } };
      slot.el.onmouseleave = () => this.tip.hide();
    });
    this.tech.forEach((slot, k) => {
      slot.el.onmouseenter = () => { if (this.state) this.tip.showTech(this.state.faction, k + 1); };
      slot.el.onmouseleave = () => this.tip.hide();
    });
    this.paint();
  }

  show({ actor, planet, rows, respawn }) {
    this.game.story?.generic?.('open_black_market_menu');
    if (this.open || !rows.length || this.game.battle || this.game.baseLayout?.open) return false;
    const faction = db.faction(planet.owner);
    if (!faction) return false;
    this.open = true; this.state = { actor, planet, rows, respawn, faction: faction.name };
    this.root.hidden = this.blocker.hidden = false;
    this.game.mouse.in = false; this.game.keys.clear();
    this.reflowText();
    this.refresh();
    return true;
  }

  close() {
    if (!this.open) return;
    this.open = false; this.state = null; this.tip.hide();
    this.root.hidden = this.blocker.hidden = true;
    this.items.forEach(s => { s.row = null; });
  }

  buy(row) {
    const { actor, planet, respawn } = this.state, game = this.game;
    game.story?.signal('STORY_BUY_BLACK_MARKET', row.item.name);
    this.close();
    if (!completePurchase(game, actor, planet, row, respawn)) return;
    const f = db.faction(actor.owner);
    if (key(actor.owner) === key(game.me)) for (const tag of ['SFXEvent_New_Construction_Options_Available', 'SFXEvent_Slice_Success']) { const sfx = f?.str(tag).trim(); if (sfx) game.audio.play(sfx); }
    game.ui?.refresh();
  }

  refresh() {
    if (!this.open) return;
    const { planet, rows, faction } = this.state, g = this.game.galaxy, me = g.players.find(p => key(p.faction) === key(this.game.me));
    const title = [db.t('TEXT_BLACK_MARKET_TITLE'), db.t(planet.type.str('Text_ID')) || planet.type.name, db.t('TEXT_TECH'), db.t('TEXT_BLACK_MARKET_SLOTS')];
    this.head.forEach((el, i) => el && this.setText(el, title[i]));
    const level = displayedTech(g, faction), prefix = db.faction(faction)?.str('Tech_Level_Icon_Name') || '';
    this.tech.forEach((slot, i) => {
      slot.el.hidden = false; slot.img.hidden = false;
      const icon = `${prefix}${i + 1}.tga`, r = iconCanvasRect(icon);
      slot.img.src = iconUrl(icon); slot.img.style.width = (r?.w || 43) + 'px'; slot.img.style.height = (r?.h || 43) + 'px';
      slot.img.style.filter = i <= level - 1 ? '' : 'brightness(0.5)';
    });
    const credits = Math.trunc((me?.credits ?? 0) + 0.5);
    this.items.forEach((slot, i) => {
      slot.row = null; slot.el.hidden = true; slot.el.setAttribute('aria-disabled', 'true');
      this.setText(this.names[i], ''); this.setText(this.prices[i], '');
      this.names[i].hidden = this.prices[i].hidden = true;
      slot.img.style.filter = ''; this.tint(this.names[i], null); this.tint(this.prices[i], null);
    });
    for (const row of rows.slice(0, 5)) {
      const i = row.item.tech - 1, slot = this.items[i];
      if (!slot) continue;
      slot.row = row; slot.el.hidden = false;
      const icon = row.item.icon || 'i_button_temporary.tga', r = iconCanvasRect(icon);
      slot.img.hidden = false; slot.img.src = iconUrl(icon); slot.img.style.width = (r?.w || 43) + 'px'; slot.img.style.height = (r?.h || 43) + 'px';
      this.names[i].hidden = this.prices[i].hidden = false;
      this.setText(this.names[i], db.t(row.item.title) || row.item.name);
      const price = Math.trunc(row.price + 0.5);
      let usable = true, nameTint = WHITE, priceTint = WHITE, text = `$ ${price}`;
      if (row.bought) { usable = false; nameTint = LIGHT; priceTint = RED; text = db.t('TEXT_BLACK_MARKET_PURCHASED'); }
      else if (credits < price) { usable = false; nameTint = LIGHT; priceTint = LIGHT; slot.img.style.filter = 'brightness(0.5)'; }
      this.tint(this.names[i], nameTint); this.tint(this.prices[i], priceTint); this.setText(this.prices[i], text);
      slot.el.setAttribute('aria-disabled', usable ? 'false' : 'true');
    }
  }

  tint(el, color) { const label = this.textLabels.get(el); if (label) label.tint = color; }

  resize() { super.resize(); if (this.images) this.paint(); }

  paint() { this.paintShell(); }
}
