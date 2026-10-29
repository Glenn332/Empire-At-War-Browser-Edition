import { db } from '../gamedata.js';
import { fontFamily } from '../fonts.js';
import { componentFont, loadComponentFont, paintNativeText } from '../nativefont.js';
import { iconUrl } from '../icons.js';
import { dialogFontPixels, dialogStaticText, uiTextHeight } from './dialogtext.js';
import { languageRevision } from '../language.js';
const pair = s =>
  String(s || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
const yes = s => /^(true|yes|1)$/i.test(s || '');
const token = (c, key) => c?.val(key).trim().split(/\s+/)[0] || '';
function requestText(request) {
  let text = String(request.textId ? db.t(request.textId) : (request.text ?? db.t(String(request.id || ''))));
  const variable = request.variable && db.type(request.variable);
  return variable ? text.replace(/%s/, db.t(variable.str('Text_ID')) || variable.name) : text;
}

export function wrapScreenText(text, width, measure) {
  if (text.length >= 8192) return [];
  const out = [];
  for (let line of dialogStaticText(text).split('\n'))
    while (line.length) {
      if (measure(line) <= width) {
        out.push(line);
        break;
      }
      let end = line.lastIndexOf(' '),
        spaced = true;
      while (end >= 0 && measure(line.slice(0, end)) > width) end = line.lastIndexOf(' ', end - 1);
      if (end < 0) {
        spaced = false;
        end = line.length - 1;
        while (end > 1 && measure(line.slice(0, end)) > width) end--;
      }
      out.push(line.slice(0, end));
      line = line.slice(end + (spaced ? 1 : 0));
    }
  return out;
}

export class GalacticScreenText {
  constructor(game, comps) {
    this.game = game;
    this.comps = comps;
    this.rows = [];
    this.clock = 0;
    this.requests = new Map();
    this.textComponent = comps.get('TUTORIAL_TEXT');
    this.backComponent = comps.get('TUTORIAL_TEXT_BACK');
    this.root = document.createElement('div');
    this.root.className = 'galactic-screen-text';
    this.root.setAttribute('aria-live', 'polite');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6';
    this.back = document.createElement('div');
    this.back.style.cssText = 'position:absolute;pointer-events:none';
    this.root.appendChild(this.back);
    this.ctx = document.createElement('canvas').getContext('2d');
    document.body.appendChild(this.root);
    this.resize();
  }

  show(request, { silent = false, preserve = null } = {}) {
    const id = String(request.id || '');
    if (!id) return;
    const token = Symbol();
    this.requests.set(id, token);
    const old = this.rows.filter(r => r.id === id);
    for (const r of old) r.el.remove();
    this.rows = this.rows.filter(r => r.id !== id);
    if (request.remove) {
      this.layout();
      return;
    }
    const text = requestText(request);
    const duration = request.duration === undefined ? 5 : Number.isFinite(+request.duration) ? +request.duration : 0;
    const teletype = request.teletype !== false;
    if (this.bitmap && !this.bitmap.has(text)) {
      this.bitmap.ensure(text).then(() => {
        if (this.requests.get(id) === token) this.show(request, { silent, preserve });
      });
      return;
    }
    const kind = String(request.kind || '').toUpperCase(),
      colorKey = { HINT: 'Hint_Text_Color', SYSTEM: 'System_Text_Color', TASK: 'Task_Text_Color' }[kind] || 'Speech_Text_Color';
    if (kind === 'HINT' && !silent) this.game.audio?.play('GUI_Text_Hint_SFX');
    const explicit = pair(request.color),
      color = explicit.length >= 3 ? explicit : pair(db.constants.str(colorKey) || '255 255 255');
    const backSize = pair(this.backComponent?.val('Size')),
      width = (backSize[0] || 600) - 9;
    const outlinePad = yes(this.textComponent?.val('Text_Outline')) ? Math.trunc(innerHeight / 600 + 0.5) : 0;
    const measure = line => {
      if (this.bitmap) return this.bitmap.measure(line) + outlinePad;
      let w = 0;
      for (let i = 0; i < line.length; i++) w += Math.round(this.ctx.measureText(line[i]).width);
      return w + outlinePad;
    };
    const lines = wrapScreenText(text, Math.trunc(width * this.scale), measure);
    for (let index = 0; index < lines.length; index++) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;white-space:pre;line-height:1;pointer-events:none';
      el.style.color = `rgb(${color.slice(0, 3).join(',')})`;
      this.root.appendChild(el);
      const row = {
        id,
        request,
        text: lines[index],
        duration: preserve?.duration ?? duration,
        indefinite: duration === -1,
        teletype,
        progress: teletype ? 0 : lines[index].length,
        index,
        last: index === 0 ? this.clock : null,
        el,
        shown: ''
      };
      if (preserve && teletype) {
        row.progress = Math.min(row.text.length, preserve.progress);
        preserve.progress = Math.max(0, preserve.progress - row.text.length);
        if (row.progress) row.last = this.clock;
      }
      this.rows.push(row);
      this.paint(row);
    }
    this.layout();
  }

  paint(row) {
    const text = row.teletype ? row.text.slice(0, Math.min(1023, Math.trunc(row.progress))) : row.text;
    if (text !== row.shown) {
      row.shown = text;
      row.el.textContent = text;
      if (this.bitmap)
        paintNativeText(row.el, text, this.bitmap, {
          scaleX: 1 / (this.textComponent?.num('Scale', 1) ?? 1),
          scaleY: 1 / (this.textComponent?.num('Scale', 1) ?? 1),
          top: row.el.style.color,
          outline: yes(this.textComponent?.val('Text_Outline'))
        });
    }
  }

  update(dt) {
    this.clock += Math.max(0, dt);
    let changed = false;
    this.rows = this.rows.filter(row => {
      if (!row.indefinite && (row.duration -= dt) <= 0) {
        row.el.remove();
        changed = true;
        return false;
      }
      return true;
    });
    const rate = db.constants.num('Text_Reveal_Rate', 120);
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (!r.teletype || r.progress >= r.text.length) continue;
      if (r.last === null) {
        const prev = this.rows[i - 1];
        if (!prev || prev.progress < prev.text.length) continue;
        r.last = prev.last ?? this.clock;
      }
      const before = Math.trunc(r.progress);
      r.progress = Math.min(r.text.length, r.progress + (this.clock - r.last) * rate);
      r.last = this.clock;
      if (Math.trunc(r.progress) > before) this.game.audio?.play(token(this.textComponent, 'Mouse_Over_SFX'));
      this.paint(r);
    }
    if (changed) this.layout();
  }

  resize() {
    this.scale = this.game.overlayScale();
    const c = this.textComponent,
      font = dialogFontPixels(uiTextHeight(), c?.num('Font_Point_Size', 6) ?? 6);
    this.bitmap = componentFont(c?.val('Font_Name') || 'EmpireAtWar-Medium', font);
    const revision = languageRevision;
    const pending =
      !this.bitmap &&
      loadComponentFont(c?.val('Font_Name') || 'EmpireAtWar-Medium', font).then(bitmap => {
        if (bitmap && this.font === font && revision === languageRevision) {
          this.bitmap = bitmap;
          this.height = bitmap.height;
          for (const row of this.rows) {
            row.shown = null;
            this.paint(row);
          }
          this.layout();
        }
      });
    this.font = font;
    this.family = fontFamily(c?.val('Font_Name') || 'EmpireAtWar-Medium');
    this.ctx.font = `700 ${font}px ${this.family}`;
    this.ctx.fontKerning = 'none';
    const metric = this.ctx.measureText('Mg');
    this.height = this.bitmap?.height || (metric.fontBoundingBoxAscent || font * 0.8) + (metric.fontBoundingBoxDescent || font * 0.2);
    for (const row of this.rows) {
      row.shown = null;
      this.paint(row);
    }
    this.layout();
    return pending;
  }

  async refreshLanguage() {
    await this.resize();
    const groups = new Map(this.rows.filter(row => row.request).map(row => [row.id, row.request]));
    await this.bitmap?.ensure([...groups.values()].map(requestText).join(''));
    for (const [id, request] of groups) {
      const rows = this.rows.filter(row => row.id === id);
      if (!rows.length || rows[0].request !== request) continue;
      this.show(request, {
        silent: true,
        preserve: { duration: rows[0].duration, progress: rows.reduce((n, row) => n + row.progress, 0) }
      });
    }
  }

  layout() {
    const c = this.textComponent,
      back = this.backComponent,
      scale = this.scale,
      offset = pair(c?.val('Text_Offset'));
    const size = pair(c?.val('Size')),
      step = size[1] || 14,
      fontScale = c?.num('Scale', 1) ?? 1;
    const first = Math.floor(10 * scale) + 0.5,
      pitch = Math.floor((10 + step) * scale) + 0.5 - first;
    const x = Math.trunc(5 * scale) + (offset[0] || 0) * scale,
      y = Math.trunc(first) - (offset[1] || 0) * scale;
    const align = yes(c?.val('Right_Justified')) ? 'right' : yes(c?.val('Left_Justified')) ? 'left' : 'center';
    for (let i = 0; i < this.rows.length; i++) {
      const el = this.rows[i].el;
      Object.assign(el.style, {
        left: x + 'px',
        top: y + i * pitch + 'px',
        fontFamily: this.family,
        fontSize: this.font * fontScale + 'px',
        lineHeight: this.height * fontScale + 'px',
        fontWeight: '700',
        fontKerning: 'none',
        transform: `translate(${align === 'left' ? '0' : align === 'right' ? '-100%' : '-50%'},-50%)`
      });
      if (!this.bitmap && yes(c?.val('Text_Outline'))) el.style.textShadow = '-1px 0 #000,1px 0 #000,0 -1px #000,0 1px #000';
    }
    const backSize = pair(back?.val('Size')),
      backOffset = pair(back?.val('Offset')),
      color = pair(back?.val('Color') || '255 255 255 255');
    const width = ((backSize[0] || 600) + 5) * scale,
      height = this.rows.length * step * scale + 4;
    this.back.hidden = !this.rows.length || color[3] === 0;
    Object.assign(this.back.style, {
      left: 3 + (backOffset[0] || 0) * scale + 'px',
      top: 10 * scale - (step * scale) / 2 - 2 - (backOffset[1] || 0) * scale + 'px',
      width: width + 'px',
      height: height + 'px',
      opacity: String((color[3] ?? 255) / 255),
      background: `url("${iconUrl(token(back, 'Blank_Texture_Name'))}") center / 100% 100% no-repeat`
    });
    this.root.hidden = !this.rows.length;
  }

  removeAll() {
    this.requests.clear();
    for (const r of this.rows) r.el.remove();
    this.rows = [];
    this.layout();
  }
  dispose() {
    this.requests.clear();
    this.root.remove();
    this.rows = [];
  }
}
