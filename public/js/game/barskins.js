import { findFiles } from '../vfs.js';
import { loadTextureCanvas, canvasUrl } from '../dds.js';
import { iconCanvasRect } from '../icons.js';

export const textureKey = name =>
  String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '')
    .toUpperCase();

const RANK = { DDS: 0, TGA: 1, PNG: 2 };
const sub = dir => `^DATA\\\\${dir}\\\\COMMANDBAR\\\\[^\\\\]+\\\\[^\\\\]+`;

export async function loadBarSkins() {
  const [textures, models, xml] = await Promise.all(
    [sub('ART\\\\TEXTURES') + '\\.(DDS|TGA|PNG)$', sub('ART\\\\MODELS') + '\\.ALO$', sub('XML') + '\\.XML$'].map(q =>
      findFiles(q).catch(() => null)
    )
  );
  const skins = new Map();
  const skinOf = key => {
    const parts = key.split(/[\\/]/),
      faction = parts[parts.length - 2].toUpperCase();
    let s = skins.get(faction);
    if (!s) skins.set(faction, (s = { files: new Map(), icons: new Map(), rects: new Map(), models: new Map(), xml: [] }));
    return { s, parts };
  };
  for (const key of textures || []) {
    const { s, parts } = skinOf(key),
      file = parts.slice(3).join('/'),
      k = textureKey(key),
      ext = key.split('.').pop().toUpperCase();
    const prev = s.files.get(k);
    if (!prev || RANK[ext] < RANK[prev.split('.').pop().toUpperCase()]) s.files.set(k, file);
  }
  for (const key of models || []) {
    const { s, parts } = skinOf(key);
    s.models.set(textureKey(key), parts.slice(3).join('/'));
  }
  for (const key of (xml || []).sort()) {
    const { s, parts } = skinOf(key);
    s.xml.push(parts.slice(2).join('/'));
  }
  await Promise.all(
    [...skins.values()].map(s => decodeSkinIcons(s, [...s.files.keys()].filter(k => iconCanvasRect(k + '.tga') || iconCanvasRect(k + '.dds'))))
  );
  return skins;
}

export async function decodeSkinIcons(skin, names) {
  await Promise.all(
    [...new Set(names.map(textureKey))]
      .filter(k => skin.files.has(k) && !skin.icons.has(k))
      .map(async k => {
        const cv = await loadTextureCanvas(skin.files.get(k)).catch(() => null);
        if (!cv) return;
        skin.rects.set(k, { x: 0, y: 0, w: cv.width, h: cv.height });
        skin.icons.set(k, await canvasUrl(cv));
      })
  );
}
