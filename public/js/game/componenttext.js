import { componentFont, loadComponentFont, paintNativeText } from '../nativefont.js';
import { fontFamily } from '../fonts.js';
import { db } from '../gamedata.js';
import { dialogFontPixels, uiTextHeight } from './dialogtext.js';
import { languageRevision } from '../language.js';

const yes = s => /^(true|yes|1)$/i.test(s || '');
export const componentTextAlign = (c, left = null) =>
  left === true || yes(c?.val('Left_Justified')) ? 'left' : yes(c?.val('Right_Justified')) ? 'right' : 'center';

export function setComponentText(
  el,
  c,
  value,
  { scale = 1, align = componentTextAlign(c), bottom = false, secondary = false, tint = null } = {}
) {
  value = String(value ?? '');
  const fallbackPoint = Math.trunc(db.constants?.num('Text_Button_Default_Font_Size', 7) ?? 7);
  const ownFace = c?.val('Font_Name').trim(),
    face = ownFace || db.constants?.str('Text_Button_Default_Font_Name') || 'EmpireAtWar-Medium',
    point = ownFace ? Math.trunc(c?.num('Font_Point_Size', fallbackPoint) ?? fallbackPoint) : fallbackPoint;
  const textScale = c?.num('Scale', 1) ?? 1,
    maxWidth = c?.num('Max_Text_Width', 0) ?? 0;
  const outline = yes(c?.val('Text_Outline')),
    emboss = yes(c?.val('Text_Emboss'));
  const colorName = secondary ? 'Text_Color2' : 'Text_Color',
    color =
      tint ||
      (c?.val(colorName)?.trim()
        ? c
            .val(colorName)
            .trim()
            .split(/[\s,]+/)
            .map(Number)
        : [255, 255, 255, 255]);
  const height = uiTextHeight(),
    key = JSON.stringify([value, face, point, height, scale, textScale, maxWidth, outline, emboss, color, align, bottom, languageRevision]);
  if (el._componentText?.key === key) return el._componentText;
  const state = { key, value, point, font: null };
  el._componentText = state;
  el._nativeTextVersion = (el._nativeTextVersion || 0) + 1;
  el.setAttribute('aria-label', value);
  const position = width => {
    let x = align === 'left' ? '0' : align === 'right' ? '-100%' : '-50%';
    if (/^Text$/i.test(c?.val('Type') || '') && align !== 'center')
      x = `calc(-50% + ${Math.trunc(width / 2) * (align === 'left' ? 1 : -1)}px)`;
    el.style.transform = `translate(${x},${bottom ? '50%' : '-50%'})`;
  };
  Object.assign(el.style, {
    fontFamily: fontFamily(face),
    fontSize: (dialogFontPixels(height, point) * textScale) / scale + 'px',
    fontWeight: '700',
    fontKerning: 'none',
    letterSpacing: '0',
    whiteSpace: 'pre',
    lineHeight: '1',
    color: `rgba(${color.slice(0, 3).join(',')},${(color[3] ?? 255) / 255})`
  });
  el.style.filter = '';
  el.style.textShadow = '';
  el.textContent = value;
  position(0);
  if (!value || !textScale) {
    el._nativeTextVersion = (el._nativeTextVersion || 0) + 1;
    el.replaceChildren();
    return state;
  }
  const render = () => {
    if (el._componentText !== state) return;
    for (let pt = point; ; pt--) {
      const pixels = dialogFontPixels(height, pt),
        font = componentFont(face, pixels);
      if (!font) {
        loadComponentFont(face, pixels).then(font => {
          if (font) render();
        });
        return;
      }
      if (!font.has(value)) {
        font.ensure(value).then(render);
        return;
      }
      if (ownFace && maxWidth && (font.measure(value) / scale) * textScale > maxWidth && pt > 6) continue;
      state.point = pt;
      state.font = font;
      paintNativeText(el, value, font, {
        scaleX: scale / textScale,
        scaleY: scale / textScale,
        top: color,
        outline,
        emboss,
        screenHeight: height
      });
      position(Math.max(2, Math.ceil(font.measure(value) / 2) * 2) + (outline ? 2 : emboss ? 1 : 0));
      return;
    }
  };
  render();
  return state;
}
