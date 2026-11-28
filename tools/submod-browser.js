import { fixtureFiles, stackReads, stacks } from './submod-fixture.js';

const output = document.querySelector('#log');
const report = message => (output.textContent += `${message}\n`);
function expect(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const error = new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    error.name = 'ProfileMismatch';
    throw error;
  }
}

const profiles = {
  'loose-stack/1': {
    method: 'readText',
    coverage: '8 folder stacks',
    async check(adapter, row, edition) {
      for (const [path, expected] of stackReads(row, edition)) expect(await adapter.readText(path), expected, path);
    }
  },
  'tactical-faceplate/1': {
    method: 'faceplatePixel',
    coverage: '16 faction samples',
    async check(adapter, row) {
      for (const faction of ['Empire', 'Rebel']) {
        const expected = row.mods.includes('Patch') && faction === 'Empire' ? [240, 96, 32, 255] : [30, 90, 180, 255];
        expect(await adapter.faceplatePixel(faction), expected, `${faction} faceplate RGBA`);
      }
    }
  }
};

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

async function checkCase(profile, edition, row) {
  const adapter = await import('./submod-browser-adapter.js');
  expect(await adapter.mountedMods(), row.mods, 'mounted game and enabled mod order');
  await profiles[profile].check(adapter, row, edition);
}

async function inFreshFrame(profile, edition, row) {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = '?case';
  const loaded = new Promise(resolve => (frame.onload = resolve));
  document.body.append(frame);
  let timeout;
  try {
    await Promise.race([
      loaded.then(() => frame.contentWindow.checkSubmodCase(profile, edition, row)),
      new Promise((_, reject) => (timeout = setTimeout(() => reject(new Error('case timed out')), 30000)))
    ]);
  } finally {
    clearTimeout(timeout);
    frame.remove();
  }
}

async function runProfile(profile, adapter, handles) {
  const { method, coverage } = profiles[profile];
  if (typeof adapter[method] !== 'function') return report(`NOT TESTED ${profile}: adapter does not provide ${method}`);
  for (const edition of ['eaw', 'foc']) {
    for (const row of stacks) {
      try {
        await adapter.selectStack(edition, row.mods);
        await inFreshFrame(profile, edition, row);
      } catch (error) {
        const status = error.name === 'ProfileMismatch' ? 'FAIL' : 'ERROR';
        return report(`${status} ${profile}: ${edition} / ${row.mods.join(' + ') || 'base'}: ${error.message}`);
      }
    }
  }
  report(`PASS ${profile}: ${coverage} (${handles} handles)`);
}

async function run(disk, selection) {
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) ||
    !globalThis.indexedDB?.databases ||
    !navigator.storage?.getDirectory
  )
    throw new Error('Use a Chromium browser on a fresh loopback origin with directory handles and IndexedDB.');
  const picked = disk ? await showDirectoryPicker({ mode: 'read' }) : null;
  if ((await indexedDB.databases()).length || localStorage.length)
    throw new Error('This origin already has data. Use a new port or browser profile.');
  const adapter = await import('./submod-browser-adapter.js');
  const storage = await navigator.storage.getDirectory();
  const name = `submod-test-${crypto.randomUUID()}`;
  const root = picked || (await storage.getDirectoryHandle(name, { create: true }));
  try {
    if (!picked) await populate(root);
    await adapter.mount(root);
    for (const profile of Object.keys(profiles)) {
      if (selection === 'all' || selection === profile) await runProfile(profile, adapter, disk ? 'disk' : 'browser-owned');
      else report(`NOT TESTED ${profile}: not selected`);
    }
  } finally {
    try {
      await adapter.reset();
    } finally {
      if (!picked) await storage.removeEntry(name, { recursive: true });
    }
  }
}

if (location.search === '?case') window.checkSubmodCase = checkCase;
else {
  const controls = document.querySelectorAll('button, select');
  for (const button of document.querySelectorAll('button'))
    button.onclick = async () => {
      for (const control of controls) control.disabled = true;
      output.textContent = '';
      try {
        await run(button.id === 'disk', document.querySelector('#profile').value);
      } catch (error) {
        report(`ERROR: ${error.message}`);
      } finally {
        for (const control of controls) control.disabled = false;
      }
    };
}
