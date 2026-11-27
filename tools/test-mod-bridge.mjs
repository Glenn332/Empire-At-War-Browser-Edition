// The app's own webview on Linux has no File System Access API and no service worker, so a mod
// folder there is read through the app's own bridge (api/local/list and api/local/file). The
// handle localFolder() builds has to answer what scan() and the overlay ask a real handle, or the
// mod shows up in no list and no mod file is found.
//
// Runs without a game install. With SWR_TEST_MOD (a mod folder with Data in it), or the installed
// Thrawn's Revenge, it also reads that real folder through the bridge.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const real = process.env.SWR_TEST_MOD;

// ---- the app's end of the bridge: the same answers api/local/list and api/local/file give ----
// the app joins names with a backslash (localfolder.js join()), and Rust's PathBuf accepts both
const at = p => p.replace(/\\/g, '/');
function bridge(root) {
  globalThis.fetch = async (url, init) => {
    const u = new URL(url, 'http://swr.localhost/');
    const p = at(u.searchParams.get('path'));
    if (u.pathname === '/api/local/list') {
      try {
        const rows = readdirSync(p, { withFileTypes: true }).map(e => {
          const f = path.join(p, e.name);
          return [e.name, e.isDirectory(), e.isDirectory() ? 0 : statSync(f).size];
        });
        return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }
    if (u.pathname === '/api/local/file') {
      const want = (init?.headers?.Range || init?.headers?.range || globalThis.__range || '').toString();
      const range = /bytes=(\d+)-(\d+)/.exec(want);
      const [a, b] = range ? [Number(range[1]), Number(range[2])] : [0, Infinity];
      return new Response(readFileSync(p).subarray(a, b + 1), { status: range ? 206 : 200 });
    }
    return new Response('not found', { status: 404 });
  };
}

// a mod folder as the app lists it: Data with the archive megafiles.xml names, and a loose file
const made = path.join(import.meta.dirname, '..', '.tmp-test-bridge-mod');
function makeMod() {
  rmSync(made, { recursive: true, force: true });
  const data = path.join(made, 'Data');
  for (const d of ['XML', 'Art']) mkdirSync(path.join(data, d), { recursive: true });
  const meg = Buffer.alloc(64 + 2 + 13 + 20);
  meg.writeUInt32LE(1, 0); // one name
  meg.writeUInt32LE(1, 4); // one file
  meg.writeUInt16LE(13, 8);
  Buffer.from('CONFIG\\A.XML').copy(meg, 10);
  meg.writeUInt32LE(0, 10 + 13 + 8); // offset
  meg.writeUInt32LE(4, 10 + 13 + 12); // size
  meg.writeUInt32LE(0, 10 + 13 + 16); // name index
  writeFileSync(path.join(data, 'Config.meg'), meg);
  writeFileSync(path.join(data, 'megafiles.xml'), '<Mega_Files><File>Data\\Config.meg</File></Mega_Files>');
  writeFileSync(path.join(data, 'XML', 'TacticalCameras.xml'), '<Tactical_Cameras><Near_Plane>1</Near_Plane></Tactical_Cameras>');
  writeFileSync(path.join(made, 'modinfo.json'), '{"name":"Bridge Test Mod","version":"1.0"}');
  return made;
}

const { localFolder } = await import('../public/js/localfolder.js');
const { scan } = await import('../public/js/mods.js');

// Linux paths must remain native when the mod scanner descends into Data.
globalThis.window = { __TAURI_INTERNALS__: {} };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'X11; Linux x86_64' }, configurable: true });
bridge(real || made);
const nativeHandle = localFolder(real || made);
const nativeData = await nativeHandle.getDirectoryHandle('Data');
assert.ok(nativeData.path.endsWith('/Data'), 'Linux mod folders use forward slashes for child paths');
assert.ok(!nativeData.path.endsWith('\\Data'), 'Linux must not treat a backslash as a filename character');
delete globalThis.window;
delete globalThis.navigator;

// ---- what the scanner and the overlay ask of a handle ----
for (const [label, root] of [['a made mod', makeMod()], ...(existsSync(real) ? [["Thrawn's Revenge", real]] : [])]) {
  bridge(root);
  const handle = localFolder(root);

  // a handle the page cannot ask about permission for is dropped from the overlay
  assert.equal(handle.kind, 'directory', `${label}: kind`);
  assert.equal(typeof handle.getDirectoryHandle, 'function', `${label}: getDirectoryHandle`);
  assert.equal(await handle.queryPermission({ mode: 'read' }), 'granted', `${label}: queryPermission`);
  assert.equal(await handle.requestPermission({ mode: 'read' }), 'granted', `${label}: requestPermission`);
  const info = await handle.getFileHandle('modinfo.json');
  assert.equal(await info.queryPermission({ mode: 'read' }), 'granted', `${label}: a file handle answers too`);

  const found = await scan(handle, () => {});
  assert.ok(found.count > 0, `${label}: files found`);
  assert.ok(found.megs.length > 0, `${label}: archives from megafiles.xml`);

  // an archive entry is [index, offset, size], as the overlay's reads expect
  for (const [key, e] of Object.entries(found.files))
    if (Array.isArray(e)) assert.equal(e.length, 3, `${label}: ${key} is [index, offset, size]`);

  // loose files are what a mod overrides XML and scripts with; they are stored as paths
  const loose = Object.entries(found.files).filter(([, v]) => typeof v === 'string');
  assert.ok(loose.length > 0, `${label}: loose files are indexed as paths`);

  // the loose file reads back through the bridge with the size and stamp the change check uses
  const at = String((loose.find(([k]) => /XML/.test(k)) || loose[0])[1]);
  const parts = at.split(/[\\/]/);
  const inside = parts.slice(parts.lastIndexOf(path.basename(root)) + 1);
  assert.ok(inside.length > 1, `${label}: the bridge path names the file inside the folder`);
  let dir = handle;
  for (const part of inside.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  const blob = await (await dir.getFileHandle(inside.at(-1))).getFile();
  const onDisk = statSync(path.join(root, ...inside)).size;
  assert.equal(blob.size, onDisk, `${label}: blob size matches the file`);
  assert.equal(blob.lastModified, 0, `${label}: lastModified, which the change stamp reads`);
  const bytes = await blob.slice(0, Math.min(64, blob.size)).arrayBuffer();
  assert.equal(bytes.byteLength, Math.min(64, onDisk), `${label}: a byte range reads back`);

  console.log(`${label}: ${found.count.toLocaleString()} files, ${found.megs.length} archives, ${loose.length} loose`);
}

// ---- the overlay's lookups must find loose entries, which are not archive tuples ----
{
  const src = readFileSync(fileURLToPath(new URL('../public/js/mods.js', import.meta.url)), 'utf8');
  assert.match(src, /if \(m\.files\[key\] != null\) return \[m, m\.files\[key\]\]/, 'a loose entry wins in where()');
  assert.match(src, /if \(m\.files\[key\] != null\) return m\.game \? -1 : i/, 'a loose entry is ranked in rank()');
  assert.ok(!/m\.files\[key\] !== undefined/.test(src), 'no lookup still demands an archive tuple');
  const mods = await import('../public/js/mods.js');
  assert.equal(typeof mods.bridged, 'function', 'the app bridge counts as folder support');
}

rmSync(made, { recursive: true, force: true });
console.log('mod bridge ok');
