import { fixtureFiles, stacks } from './submod-fixture.js';
import { addModFolder, listMods, moveMod, setGameFolder, setModOn, supported } from '../public/js/mods.js';
import { setEdition } from '../public/js/edition.js';

const output = document.querySelector('#log');
const report = message => (output.textContent += `${message}\n`);
function expect(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function populate(root) {
  for (const [path, bytes] of fixtureFiles()) {
    const parts = path.split('/');
    const file = parts.pop();
    let dir = root;
    for (const name of parts) dir = await dir.getDirectoryHandle(name, { create: true });
    const writer = await (await dir.getFileHandle(file, { create: true })).createWritable();
    await writer.write(bytes);
    await writer.close();
  }
}

async function faceplates(patched) {
  const { CommandBar } = await import('../public/js/game/hud.js');
  const { loadBarSkins } = await import('../public/js/game/barskins.js');
  const skins = await loadBarSkins();
  const verts = [
    { x: 0, y: 0, u: 0, v: 0 },
    { x: 64, y: 0, u: 1, v: 0 },
    { x: 64, y: 64, u: 1, v: 1 },
    { x: 0, y: 64, u: 0, v: 1 }
  ];
  const mesh = { texture: 'probe.png', verts, indices: [0, 1, 2, 0, 2, 3], rect: { x: 0, y: 0, w: 64, h: 64 } };
  const data = { skins, shell: new Map([['PROBE_ALT0', mesh]]), comps: new Map(), reinforce: new Map() };
  class MeasuredBar extends CommandBar {
    drawFaceplate(...args) {
      return (this.painted = super.drawFaceplate(...args));
    }
  }
  const samples = [];
  for (const factionName of ['Empire', 'Rebel']) {
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
      const expected = patched && factionName === 'Empire' ? [240, 96, 32, 255] : [30, 90, 180, 255];
      expect([...context.getImageData(12, 12, 1, 1).data], expected, `${factionName} faceplate RGBA`);
      samples.push(crop.toDataURL());
    } finally {
      bar.destroy();
    }
  }
  return samples;
}

async function checkCase(edition, [mods, winner, mask, parentOnly]) {
  document.body.replaceChildren();
  for (const id of ['cmdbar', 'sidebar', 'minimap', 'reinforceWin', 'encyc'])
    document.body.append(Object.assign(document.createElement('div'), { id }));
  const { fetchText, fromInstall, loadedMods } = await import('../public/js/vfs.js');
  expect(await fromInstall(), true, 'browser-mounted game');
  expect(await loadedMods(), mods, 'enabled mod order');
  for (const [name, value] of Object.entries({ Winner: winner, Mask: mask, ParentOnly: parentOnly, Edition: edition })) {
    for (const key of [`data/probe/${name}.txt`, `DATA\\PROBE\\${name.toUpperCase()}.TXT`]) expect(await fetchText(key), value, key);
  }
  return faceplates(mods.includes('Patch'));
}

async function inFreshFrame(edition, row) {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = '?case';
  const loaded = new Promise(resolve => (frame.onload = resolve));
  document.body.append(frame);
  let timeout;
  try {
    return await Promise.race([
      loaded.then(() => frame.contentWindow.checkSubmodCase(edition, row)),
      new Promise((_, reject) => (timeout = setTimeout(() => reject(new Error('case timed out')), 30000)))
    ]);
  } finally {
    clearTimeout(timeout);
    frame.remove();
  }
}

async function run(disk) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) || !supported() || !indexedDB.databases)
    throw new Error('Use a Chromium browser on a fresh loopback origin with directory handles and IndexedDB.');
  const picked = disk ? await showDirectoryPicker({ mode: 'read' }) : null;
  if ((await indexedDB.databases()).length || localStorage.length)
    throw new Error('This origin already has data. Use a new port or browser profile.');
  const storage = await navigator.storage.getDirectory();
  const name = `submod-test-${crypto.randomUUID()}`;
  const root = picked || (await storage.getDirectoryHandle(name, { create: true }));
  try {
    if (!picked) await populate(root);
    await setGameFolder(await root.getDirectoryHandle('game'));
    const ids = new Map();
    for (const mod of ['Parent', 'Patch']) ids.set(mod, (await addModFolder(await root.getDirectoryHandle(mod))).id);
    for (const edition of ['eaw', 'foc']) {
      setEdition(edition);
      for (const row of stacks) {
        const [mods] = row;
        const label = `${edition} / ${mods.join(' + ') || 'base'}`;
        for (const [mod, id] of ids) await setModOn(id, mods.includes(mod));
        if (mods.length === 2 && (await listMods())[0].id !== ids.get(mods[0])) await moveMod(ids.get(mods[0]), -1);
        try {
          const samples = await inFreshFrame(edition, row);
          report(`PASS ${label}: folder reads and both faceplates`);
          if (edition === 'foc' && (!mods.length || (mods[0] === 'Parent' && mods.length === 2))) {
            const line = document.createElement('p');
            line.append(`${label}: `);
            for (const [index, faction] of ['Empire', 'Rebel'].entries())
              line.append(`${faction} `, Object.assign(new Image(), { src: samples[index], alt: `${faction} faceplate sample` }), ' ');
            document.querySelector('#samples').append(line);
          }
        } catch (error) {
          throw new Error(`${label}: ${error.message}`, { cause: error });
        }
      }
    }
  } finally {
    if (!picked) await storage.removeEntry(name, { recursive: true });
    setEdition('foc');
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('swr-mods');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Test database still open; close this test tab.'));
    });
  }
  report(`PASS: 8 folder stacks, 16 tactical faceplates (${disk ? 'disk' : 'browser-owned'} handles)`);
}

if (location.search === '?case') window.checkSubmodCase = checkCase;
else
  for (const button of document.querySelectorAll('button'))
    button.onclick = async () => {
      for (const control of document.querySelectorAll('button')) control.disabled = true;
      output.textContent = '';
      document.querySelector('#samples').replaceChildren();
      try {
        await run(button.id === 'disk');
      } catch (error) {
        report(`FAIL: ${error.message}`);
        console.error(error);
      } finally {
        for (const control of document.querySelectorAll('button')) control.disabled = false;
      }
    };
