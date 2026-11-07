import { db } from '../gamedata.js';
import { fetchBinary } from '../vfs.js';
import { activeLanguage, LANGUAGES } from '../language.js';
import { fontPixels } from '../fontpolicy.js';
import { loadNativeFont, nativeTextMask, nativeTextPixels } from '../nativefont.js';
import { loadTextureCanvas } from '../dds.js';

export function parseCreditsText(buf) {
  const out = [];
  if (!buf) return out;
  const dv = new DataView(buf),
    n = dv.getUint32(0, true);
  if (n > Math.floor((buf.byteLength - 4) / 12)) return out;
  const lens = [];
  for (let i = 0; i < n; i++) lens.push([dv.getUint32(8 + i * 12, true), dv.getUint32(12 + i * 12, true)]);
  let p = 4 + n * 12;
  if (lens.reduce((bytes, [v, k]) => bytes + v * 2 + k, p) > buf.byteLength) return out;
  const u16 = new TextDecoder('utf-16le'),
    bytes = new Uint8Array(buf),
    values = [];
  for (const [v] of lens) {
    values.push(u16.decode(new Uint8Array(buf, p, v * 2)));
    p += v * 2;
  }
  for (let i = 0; i < n; i++) {
    let style = '';
    for (let j = 0; j < lens[i][1]; j++) style += String.fromCharCode(bytes[p + j]);
    p += lens[i][1];
    out.push({ style, text: values[i] === '[TBL]' ? '' : values[i] });
  }
  return out;
}

async function creditsText() {
  for (const language of new Set([activeLanguage, 0])) {
    const buf = await fetchBinary(`Data/Text/CreditsText_${LANGUAGES[language]}.dat`).catch(() => null);
    if (buf) return parseCreditsText(buf);
  }
  return [];
}

const color = (name, fallback) => {
  const v = String(db.constants.str(name, '') || '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const c = v.length >= 3 && v.every(Number.isFinite) ? v : fallback;
  return [c[0] * 255, c[1] * 255, c[2] * 255, (c[3] ?? 1) * 255];
};

export function creditsFade(y, margin) {
  const smooth = t => (3 - t * 2) * t * t;
  if (y < margin) return 0;
  if (y < margin * 2) return margin < y ? smooth((y - margin) / (margin * 2 - margin)) : 0;
  const top = 1 - margin * 2;
  if (y < top) return 1;
  return 1 - (top < y ? (y < 1 - margin ? smooth((y - top) / (1 - margin - top)) : 1) : 0);
}

export class CreditsRoll {
  static async create(game, { width = innerWidth, height = innerHeight } = {}) {
    const c = db.constants,
      lines = await creditsText(),
      font = await loadNativeFont(c.str('Credits_Font', 'Arial').trim(), fontPixels(height, c.num('Credits_Font_Size', 14)), 1, true).catch(
        () => null
      );
    const roll = new CreditsRoll(game, width, height);
    const normal = [color('Credits_Top_Color', [1, 1, 1]), color('Credits_Bottom_Color', [1, 1, 1])],
      header = [color('Credits_Header_Top_Color', [1, 1, 1]), color('Credits_Header_Bottom_Color', [1, 1, 1])];
    const step = Math.floor(c.num('Credits_Spacing', 0.04) * height);
    let y = height + 0.5;
    for (const line of lines) {
      const [top, bottom] = /HEADER/.test(line.style) ? header : normal;
      let image = null;
      if (font && line.text) {
        const px = nativeTextPixels(nativeTextMask(font, line.text), { top, bottom, screenHeight: height });
        image = document.createElement('canvas');
        image.width = px.width;
        image.height = px.height;
        image.getContext('2d').putImageData(new ImageData(px.pixels, px.width, px.height), 0, 0);
      }
      roll.texts.push({ image, x: image ? (width - image.width) / 2 : 0, y });
      y += step;
    }
    for (let i = 1; i <= 3; i++) {
      const name = c.str(`Credits_Logo_${i}_Name`, '').trim();
      if (!name) continue;
      const tex = await loadTextureCanvas(name).catch(() => null);
      if (!tex) continue;
      const w = c.num(`Credits_Logo_${i}_Width`, 0) * width,
        h = ((c.num(`Credits_Logo_${i}_Height`, 0) * (tex.height / 768)) / (tex.width / 1024)) * height,
        x = i === 1 ? 0 : i === 2 ? 0.5 * width - w * 0.5 : width - w;
      roll.logos.push({ image: tex, x, y: y + c.num(`Credits_Logo_${i}_Y_Offset`, 0) * height, w, h, alpha: 1 });
    }
    const music = db.music?.get('GAME_CREDITS_MUSIC_EVENT');
    if (music && game?.audio?.playMusicEvent) game.audio.playMusicEvent(music, 14);
    return roll;
  }

  constructor(game, width, height) {
    this.game = game;
    this.width = width;
    this.height = height;
    this.texts = [];
    this.logos = [];
    this.scroll = 0;
    this.rate = db.constants.num('Credits_Scroll_Rate', -0.1);
    this.margin = db.constants.num('Credits_Margin', 0.04);
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:71';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.draw();
  }

  get done() {
    return this.texts.every(t => t.y <= 0) && this.logos.every(l => l.y <= 0);
  }

  update(dt, paused) {
    if (paused) return;
    this.scroll += this.rate * dt;
    const px = 1 / this.height;
    if (this.scroll > px) return;
    this.scroll += px;
    for (const t of this.texts) t.y -= 1;
    for (const l of this.logos) {
      l.y -= 1;
      l.alpha = creditsFade(l.y / this.height, this.margin);
    }
    this.draw();
  }

  draw() {
    const { ctx, height } = this;
    ctx.clearRect(0, 0, this.width, height);
    for (const t of this.texts)
      if (t.image && t.y < height && t.y + t.image.height > 0) ctx.drawImage(t.image, Math.round(t.x), Math.round(t.y));
    for (const l of this.logos)
      if (l.alpha > 0 && l.y < height && l.y + l.h > 0) {
        ctx.globalAlpha = l.alpha;
        ctx.drawImage(l.image, l.x, l.y, l.w, l.h);
        ctx.globalAlpha = 1;
      }
  }

  dispose() {
    this.canvas.remove();
  }
}
