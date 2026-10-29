import { activeLanguage } from './language.js';

export function fontPolicy(face, language = activeLanguage, windows = null) {
  if (language === 5 || language === 8 || (language >= 5 && language <= 10 && (face === 'Arial Unicode MS' || face === 'EmpireAtWar')))
    face = 'Arial';
  const charset = language === 5 && windows?.platform === 2 && windows.major === 5 && windows.minor === 0 ? 128 : 0;
  return { face, charset };
}
export function fontPixels(height, size, language = activeLanguage, pixelMode = false) {
  if (language === 8) size = Math.max(7, size);
  const dpi = Math.trunc(Math.fround(Math.fround(height * 96) * Math.fround(0.0016666667)));
  return Math.max(1, pixelMode ? size : Math.trunc((dpi * size) / 72));
}
export function stretchedFontHeight(height, stretch) {
  stretch = Math.fround(stretch);
  return stretch >= Math.fround(1.0001) || stretch <= Math.fround(0.9999) ? -Math.floor(Math.fround(-height * stretch) + 0.5) : height;
}
