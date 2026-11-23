import { db, factionColor } from '../gamedata.js';
import { iconUrl } from '../icons.js';
import { loadTextureCanvas, canvasUrl } from '../dds.js';

const textures = new Map();
// The multiplayer preview emblem is in the retail command-bar atlas (the
// nominal Icon_Name isn't always installed). Mods may supply a loose texture.
export function factionBadge(name, teamTint = true) {
  const node = document.createElement('span');
  node.className = 'bf-crest';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', name || 'Neutral');
  node.title = name || 'Neutral';
  node.dataset.glyph = name ? name.slice(0, 1).toUpperCase() : '◇';
  if (!name) return node;
  if (teamTint) node.style.color = factionColor(name) || 'inherit';
  const f = db.faction(name),
    names = [f?.str('Multiplayer_Map_Preview_Icon'), f?.str('Icon_Name')].filter(Boolean);
  const apply = url => {
    if (!url) return;
    node.style.setProperty('--crest-art', `url("${url}")`);
    node.classList.add('has-art');
  };
  // Original EaW has no multiplayer preview field. Its encyclopedia and
  // command-bar atlas still contain the real emblems, including the pirates'.
  const atlas =
    names.map(iconUrl).find(Boolean) || iconUrl(`I_ENCYCLOPEDIA_${name}_SYMBOL.TGA`) || iconUrl(`I_BUTTON_COMMAND_BAR_${name}_SYMBOL.TGA`);
  if (atlas) apply(atlas);
  else if (names.length) {
    const key = names.join('|');
    if (!textures.has(key))
      textures.set(
        key,
        (async () => {
          for (const n of names) {
            const cv = await loadTextureCanvas(n).catch(() => null);
            if (cv) return canvasUrl(cv);
          }
          return '';
        })()
      );
    textures.get(key).then(apply);
  }
  return node;
}
