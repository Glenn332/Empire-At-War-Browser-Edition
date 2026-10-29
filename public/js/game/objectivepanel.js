import { db } from '../gamedata.js';
import { loadHudAssets } from './hud.js';
import { loadTextureCanvas } from '../dds.js';
import { iconCanvasRect, iconUrl } from '../icons.js';
import { fontFamily } from '../fonts.js';
import { componentFont, paintNativeText } from '../nativefont.js';
import { dialogFontPixels, uiTextHeight } from './dialogtext.js';
import { encyclopediaLines } from './galacticencyclopedia.js';
import { activeLanguage } from '../language.js';

const yes = s => /^(yes|true|1)$/i.test(String(s || '').trim());
const pair = (c, k, fallback) => { const v = c?.val(k); if (!v) return fallback; const a = v.trim().split(/[\s,]+/).map(Number); return a.length >= 2 && a.every(Number.isFinite) ? a : fallback; };
const token = (c, k) => c?.val(k)?.trim().split(/\s+/)[0] || '';
const rgba = a => `rgba(${a.slice(0, 3).join(',')},${(a[3] ?? 255) / 255})`;
const UNSET = 1e17;

const panels = new WeakMap();
export function objectivePanel(game) {
  let panel = panels.get(game);
  if (!panel) { panel = new ObjectivePanel(game); panels.set(game, panel); }
  return panel;
}

export class ObjectivePanel {
  constructor(game) {
    this.game = game; this.list = null; this.images = new Map(); this.ready = null; this.disposed = false;
    this.root = document.createElement('div'); this.root.className = 'objective-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'status'); this.root.setAttribute('aria-label', 'Objectives');
    this.root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:8';
    document.body.appendChild(this.root);
    this.onResize = () => this.paint(); addEventListener('resize', this.onResize);
  }
  comp(name) { return this.comps?.get(name.toUpperCase()); }
  async load() {
    if (!this.ready) this.ready = (async () => {
      const assets = await loadHudAssets().catch(() => null); this.comps = assets?.comps || new Map();
      const back = this.comp('objective_back'), icon = this.comp('objective_icon');
      const names = [token(back, 'Blank_Texture_Name'), (back?.val('Icon_Alternate_Texture_Name') || '').trim().split(/\s+/)[0], token(icon, 'Icon_Texture_Name'),
        (icon?.val('Icon_Alternate_Texture_Name') || '').trim().split(/\s+/)[0], 'i_encyclopedia_border.tga'].filter(Boolean);
      await Promise.all(names.map(name => {
        const r = iconCanvasRect(name), url = r && iconUrl(name);
        if (url) { this.images.set(name.toUpperCase(), { url, w: r.w, h: r.h }); return null; }
        return loadTextureCanvas(name).then(c => { if (c) this.images.set(name.toUpperCase(), { url: c.toDataURL(), w: c.width, h: c.height }); }).catch(() => {});
      }));
    })();
    return this.ready;
  }
  update(list, sound = false) {
    this.list = list;
    if (sound) { const sfx = this.comp('objective_icon')?.val('Click_SFX')?.trim() || 'GUI_Button_Press_2_SFX'; this.game.audio?.play?.(sfx); }
    this.load().then(() => this.paint());
  }
  visible() { return !!this.list && this.list.display && !this.disposed && !this.game.over && !(this.game.objectivesHidden?.()); }
  art(name, cx, cy, w, h, alpha = 1) {
    const img = this.images.get(String(name).toUpperCase()); if (!img) return;
    const el = document.createElement('img'); el.src = img.url; el.alt = '';
    el.style.cssText = `position:absolute;left:${cx - w / 2}px;top:${-cy - h / 2}px;width:${w}px;height:${h}px;opacity:${alpha}`;
    this.root.appendChild(el);
  }
  text(kind, str, x, y, colour) {
    const c = this.comp(kind), face = token(c, 'Font_Name') || 'Arial', pt = c?.num('Font_Point_Size', 7) || 7, scale = this.scale, cs = c?.num('Scale', 1) ?? 1;
    const el = document.createElement('span'); el.textContent = str;
    el.style.cssText = `position:absolute;left:${x}px;top:${-y}px;white-space:pre;line-height:1;transform:translateY(-50%);font:${dialogFontPixels(uiTextHeight(), pt) * cs / scale}px ${fontFamily(face)};color:${rgba(colour)}`;
    const bitmap = componentFont(face, dialogFontPixels(uiTextHeight(), pt));
    if (bitmap) { if (!bitmap.has(str)) bitmap.ensure(str).then(() => this.paint()); paintNativeText(el, str, bitmap, { scaleX: scale / cs, scaleY: scale / cs, top: rgba(colour), outline: yes(c?.val('Text_Outline')) }); }
    else if (yes(c?.val('Text_Outline'))) el.style.textShadow = '0 0 1px #000,0 0 1px #000';
    this.root.appendChild(el);
  }
  paint() {
    this.root.replaceChildren();
    if (!this.visible() || !this.comps) { this.root.hidden = true; return; }
    const back = this.comp('objective_back'), head = this.comp('objective_header_text'), body = this.comp('objective_text'), icon = this.comp('objective_icon');
    const scale = this.scale = Math.min(innerWidth / 1024, innerHeight / 768), u = 1 / scale;
    const B = pair(back, 'Size', [266, 14]), O = pair(back, 'Offset', [5, 2]), Hh = pair(head, 'Size', [5, 18]), T = pair(body, 'Size', [40, 16]), I = pair(icon, 'Size', [16, 16]);
    const wide = pair(back, 'Default_Offset_Widescreen', null), D = innerWidth / innerHeight >= 1.75 && wide && Math.abs(wide[0]) < UNSET ? wide : pair(back, 'Default_Offset', [0, 0]);
    const items = this.list.items, battle = items.filter(o => o.flag), goals = items.filter(o => !o.flag);
    const number = n => n + (activeLanguage === 5 ? '.' : '. '), limit = Math.trunc(T[0] * (innerWidth === 800 ? 0.95 : 1));
    const lines = o => encyclopediaLines(number(o.flag ? items.indexOf(o) + 1 : o.serial) + o.text, limit);
    const count = [...battle, ...goals].reduce((n, o) => n + lines(o).length, 0);
    const H = (battle.length ? Hh[1] + Hh[0] : 0) + Hh[1] + Hh[0] + count * T[1] + 2 * O[1];
    const alt = (back?.val('Icon_Alternate_Texture_Name') || '').trim().split(/\s+/);
    this.art(alt[0], D[0], D[1] + H / 2, B[0] + 2 * u, H + 2 * u);
    this.art(token(back, 'Blank_Texture_Name'), D[0], D[1] + H / 2, B[0], H, (pair(back, 'Color', [255, 255, 255, 255])[3] ?? 255) / 255);
    const xi = D[0] - B[0] / 2 + O[0] + I[0] / 2, xt = xi + I[0] / 2;
    const white = pair(body, 'Text_Color', [255, 255, 255, 255]), grey = pair(body, 'Text_Color2', [128, 128, 128, 255]), red = pair(head, 'Text_Color2', [255, 0, 0, 255]);
    let y = D[1] + H - O[1] - Hh[1] / 2;
    const section = (header, list, plain) => {
      this.text('objective_header_text', db.t(header), xi, y, pair(head, 'Text_Color', [255, 255, 255, 255]));
      y -= (Hh[1] + Hh[0]) / 2;
      const border = this.images.get('I_ENCYCLOPEDIA_BORDER.TGA'); if (border) this.art('i_encyclopedia_border.tga', D[0], y, border.w, border.h);
      y -= (Hh[0] + T[1]) / 2;
      for (const o of list) {
        if (!plain && o.state) this.art(o.state === 2 ? (icon?.val('Icon_Alternate_Texture_Name') || '').trim().split(/\s+/)[0] : token(icon, 'Icon_Texture_Name'), xi, y, I[0], I[1]);
        const colour = plain || !o.state ? white : o.state === 1 ? grey : red;
        for (const line of lines(o)) { this.text('objective_text', line, xt, y, colour); y -= T[1]; }
      }
    };
    if (battle.length) section('TEXT_TEST_BATTLE_INFO_HEADER', battle, true);
    section('TEXT_TEST_OBJECTIVE_HEADER', goals, false);
    Object.assign(this.root.style, { left: innerWidth / 2 + 'px', top: innerHeight / 2 + 'px', transform: `scale(${scale})`, transformOrigin: '0 0' });
    this.root.hidden = false;
  }
  dispose() { this.disposed = true; removeEventListener('resize', this.onResize); this.root.remove(); }
}
