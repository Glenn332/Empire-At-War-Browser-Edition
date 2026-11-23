// Reference adapter for main's browser folder route. Forks may replace this file, not the fixture or expectations.
import { addModFolder, listMods, moveMod, setGameFolder, setModOn } from '../public/js/mods.js';
import { setEdition } from '../public/js/edition.js';

const ids = new Map();
export async function mount(root) {
  await setGameFolder(await root.getDirectoryHandle('game'));
  for (const mod of ['Parent', 'Patch']) ids.set(mod, (await addModFolder(await root.getDirectoryHandle(mod))).id);
}

export async function selectStack(edition, mods) {
  setEdition(edition);
  for (const [mod, id] of ids) await setModOn(id, mods.includes(mod));
  if (mods.length === 2 && (await listMods())[0].id !== ids.get(mods[0])) await moveMod(ids.get(mods[0]), -1);
}

export async function mountedMods() {
  const { fromInstall, loadedMods } = await import('../public/js/vfs.js');
  return (await fromInstall()) ? loadedMods() : null;
}

export async function readText(path) {
  const { fetchText } = await import('../public/js/vfs.js');
  return fetchText(path);
}

export async function faceplatePixel(factionName) {
  document.body.replaceChildren();
  for (const id of ['cmdbar', 'sidebar', 'minimap', 'reinforceWin', 'encyc'])
    document.body.append(Object.assign(document.createElement('div'), { id }));
  const { CommandBar } = await import('../public/js/game/hud.js');
  const { loadBarSkins } = await import('../public/js/game/barskins.js');
  const verts = [
    { x: 0, y: 0, u: 0, v: 0 },
    { x: 64, y: 0, u: 1, v: 0 },
    { x: 64, y: 64, u: 1, v: 1 },
    { x: 0, y: 64, u: 0, v: 1 }
  ];
  const mesh = { texture: 'probe.png', verts, indices: [0, 1, 2, 0, 2, 3], rect: { x: 0, y: 0, w: 64, h: 64 } };
  const data = { skins: await loadBarSkins(), shell: new Map([['PROBE_ALT0', mesh]]), comps: new Map(), reinforce: new Map() };
  class MeasuredBar extends CommandBar {
    drawFaceplate(...args) {
      return (this.painted = super.drawFaceplate(...args));
    }
  }
  const game = { human: { factionName, faction: { name: factionName } }, world: {}, map: {} };
  const bar = new MeasuredBar(game, { selection: [] }, data);
  try {
    await bar.painted;
    const plate = bar.plate;
    const scale = plate.width / parseFloat(plate.style.width);
    const crop = document.createElement('canvas');
    crop.width = crop.height = 24;
    const context = crop.getContext('2d');
    context.drawImage(plate, 8 * scale, plate.height - 48 * scale, 24 * scale, 24 * scale, 0, 0, 24, 24);
    return [...context.getImageData(12, 12, 1, 1).data];
  } finally {
    bar.destroy();
  }
}

export async function reset() {
  ids.clear();
  setEdition('foc');
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('swr-mods');
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Test database still open; close this test tab.'));
  });
}
