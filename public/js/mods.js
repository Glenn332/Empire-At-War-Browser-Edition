const DB = 'swr-mods',
  STORE = 'mods';
import { languageName } from './localizedmedia.js';
import { languageId } from './language.js';
import { expansion } from './edition.js';
import { localFolder, localMods, inApp } from './localfolder.js';
const up = s => s.toUpperCase();

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode),
      q = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      d.close();
      res(q && q.result);
    };
    t.onerror = t.onabort = () => {
      d.close();
      rej(t.error);
    };
  });
}

export const supported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;
export const archivesSupported = () =>
  typeof window !== 'undefined' && 'indexedDB' in window && !!(navigator.storage && navigator.storage.getDirectory);
const modDir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('mods', { create: true });

export async function listMods() {
  return ((await tx('readonly', s => s.getAll())) || [])
    .filter(m => !m.game)
    .sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id) || a.id - b.id);
}

export async function moveMod(id, by) {
  const list = await listMods(),
    i = list.findIndex(m => m.id === id),
    j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  await Promise.all(
    list.map((m, n) => {
      m.order = n;
      return tx('readwrite', s => s.put(m));
    })
  );
  return true;
}
export async function removeMod(id) {
  const m = await tx('readonly', s => s.get(id));
  await tx('readwrite', s => s.delete(id));
  if (m && m.archive) await (await modDir()).removeEntry(m.archive.file).catch(() => {});
  if (m && m.local) keepDismissed([...dismissedLocal(), m.local]);
}

const DISMISSED = 'swr-local-removed';
const plainPath = p => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const samePath = (a, b) => !!a && !!b && plainPath(a) === plainPath(b);
const within = (p, dir) => plainPath(p).startsWith(plainPath(dir) + '\\');
export function dismissedLocal() {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED) || '[]');
  } catch {
    return [];
  }
}
function keepDismissed(list) {
  try {
    localStorage.setItem(DISMISSED, JSON.stringify([...new Set(list)]));
  } catch {}
}
export function restoreLocal(source) {
  keepDismissed(source ? dismissedLocal().filter(f => !samePath(f, source) && !within(f, source)) : []);
}

export async function syncLocalMods(progress = () => {}) {
  const items = await localMods();
  if (!items) return null;
  const mods = (await listMods()).filter(m => m.local),
    out = { added: [], updated: [], removed: [] };
  const skip = dismissedLocal();
  for (const it of items) {
    const m = mods.find(x => samePath(x.local, it.folder)),
      folder = it.folder
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop();
    const name = it.name || folder;
    if (m && m.version === it.version) continue;
    if (!m && skip.some(f => samePath(f, it.folder))) continue;
    const found = await scan(localFolder(it.folder), t => progress(`${name}: ${t}`));
    const where = { local: it.folder, workshop: it.workshop || undefined, source: it.source, version: it.version, scanned: Date.now() };
    if (m) {
      Object.assign(m, found, where, m.named || !it.name ? {} : { name, named: true });
      await tx('readwrite', s => s.put(m));
      out.updated.push(m.label || m.name);
    } else {
      const mod = { name, named: !!it.name, on: false, ...where, ...found };
      mod.id = await tx('readwrite', s => s.add(mod));
      out.added.push(name);
    }
  }
  for (const m of mods)
    if (!items.some(it => samePath(it.folder, m.local))) {
      await tx('readwrite', s => s.delete(m.id));
      out.removed.push(m.label || m.name);
    }
  return out;
}

const PROFILES = 'swr-mod-profiles';
export function listProfiles() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILES) || '[]');
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
const keepProfiles = list => {
  try {
    localStorage.setItem(PROFILES, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
};
export async function saveProfile(name) {
  name = String(name || '').trim();
  if (!name) return false;
  const mods = (await listMods()).map(m => ({ id: m.id, name: m.name, on: !!m.on }));
  return keepProfiles(
    [...listProfiles().filter(p => p.name !== name), { name, saved: Date.now(), mods }].sort((a, b) => a.name.localeCompare(b.name))
  );
}
export function deleteProfile(name) {
  return keepProfiles(listProfiles().filter(p => p.name !== name));
}
function matchProfile(profile, list) {
  const left = new Set(list),
    out = [],
    missing = [];
  for (const e of profile.mods) {
    const m = [...left].find(x => x.id === e.id) || [...left].find(x => x.name === e.name);
    if (m) {
      left.delete(m);
      out.push([m, e.on]);
    } else if (e.on) missing.push(e.name);
  }
  return { out, rest: [...left], missing };
}
export async function loadProfile(name) {
  const p = listProfiles().find(x => x.name === name);
  if (!p) return null;
  const { out, rest, missing } = matchProfile(p, await listMods());
  const all = [...out, ...rest.map(m => [m, false])];
  await Promise.all(
    all.map(([m, on], n) => {
      m.order = n;
      m.on = on;
      return tx('readwrite', s => s.put(m));
    })
  );
  return { missing };
}
export function profileInUse(profile, list) {
  const on = list.filter(m => m.on),
    { out } = matchProfile(profile, list),
    want = out.filter(([, o]) => o).map(([m]) => m);
  return want.length === profile.mods.filter(e => e.on).length && on.length === want.length && on.every((m, i) => m === want[i]);
}
export async function setModLabel(id, label) {
  const m = await tx('readonly', s => s.get(id));
  if (m) {
    label = String(label || '').trim();
    if (label) m.label = label;
    else delete m.label;
    await tx('readwrite', s => s.put(m));
  }
}
export async function setModOn(id, on) {
  const m = await tx('readonly', s => s.get(id));
  if (m) {
    m.on = !!on;
    await tx('readwrite', s => s.put(m));
  }
}

async function child(dir, name, kind) {
  const want = name.toLowerCase();
  for await (const [n, h] of dir.entries()) if (n.toLowerCase() === want && (!kind || h.kind === kind)) return h;
  return null;
}
async function walk(dir, rel) {
  let h = dir;
  const real = [];
  for (const part of rel.split('/').filter(Boolean)) {
    h = await child(h, part);
    if (!h) return null;
    real.push(h.name);
  }
  return { handle: h, path: real.join('/') };
}

async function megEntries(file) {
  const head = new DataView(await file.slice(0, 8).arrayBuffer());
  const nNames = head.getUint32(0, true),
    nFiles = head.getUint32(4, true);
  const buf = await file.slice(0, Math.min(file.size, 64 + nNames * 300 + nFiles * 20)).arrayBuffer();
  const dv = new DataView(buf),
    bytes = new Uint8Array(buf),
    names = [];
  let p = 8;
  for (let i = 0; i < nNames; i++) {
    const len = dv.getUint16(p, true);
    p += 2;
    let s = '';
    for (let k = 0; k < len; k++) s += String.fromCharCode(bytes[p + k]);
    names.push(s);
    p += len;
  }
  const out = [];
  for (let i = 0; i < nFiles; i++, p += 20)
    out.push([up(names[dv.getUint32(p + 16, true)]), dv.getUint32(p + 12, true), dv.getUint32(p + 8, true)]);
  return out;
}

async function scanRoot(acc, root, prefix, more, progress) {
  const { megs, files, gone } = acc;
  const data = await child(root, 'Data', 'directory');
  if (!data) return false;
  const names = [];
  const list = await child(data, 'megafiles.xml', 'file');
  if (list)
    for (const m of (await (await list.getFile()).text()).matchAll(/<File>\s*([^<]+?)\s*<\/File>/g)) names.push(m[1].replace(/\\/g, '/'));
  for (const rel of [...names, ...more]) {
    const hit = await walk(root, rel);
    if (!hit || hit.handle.kind !== 'file' || megs.includes(prefix + hit.path)) continue;
    progress('Reading ' + hit.handle.name);
    const at = megs.push(prefix + hit.path) - 1;
    for (const [key, off, size] of await megEntries(await hit.handle.getFile())) {
      files[key] = [at, off, size];
      gone.delete(key);
    }
  }
  const loose = async (dir, rel) => {
    const here = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') await loose(h, rel + '/' + name);
      else if (!/\.meg$/i.test(name)) here.push([rel + '/' + name, h]);
    }
    for (let i = 0; i < here.length; i += 64) {
      const part = here.slice(i, i + 64),
        sizes = await Promise.all(part.map(([, h]) => h.getFile().then(f => f.size)));
      part.forEach(([path], k) => {
        const key = up(path.replace(/\//g, '\\'));
        if (sizes[k]) {
          files[key] = prefix + path;
          gone.delete(key);
        } else {
          delete files[key];
          gone.add(key);
        }
      });
      acc.n += part.length;
      progress(acc.n.toLocaleString() + ' files read');
    }
  };
  await loose(data, data.name);
  return true;
}
const fresh = () => ({ megs: [], files: {}, gone: new Set(), n: 0 });
const done = acc => ({ megs: acc.megs, files: acc.files, gone: [...acc.gone], count: Object.keys(acc.files).length });

export async function scan(handle, progress = () => {}) {
  const acc = fresh();
  if (!(await scanRoot(acc, handle, '', [], progress)))
    throw new Error("This folder has no Data folder in it: choose the mod's own folder.");
  return done(acc);
}

export async function scanGame(handle, progress = () => {}, language = 0, { expansion = true } = {}) {
  const acc = fresh();
  const patches = [
    'Data/Patch.meg',
    'Data/Patch2.meg',
    'Data/64Patch.meg',
    ...['sfx2d_non_localized', 'sfx3d_non_localized', 'sfx2d_' + languageName(language).toLowerCase()].map(f => `Data/Audio/SFX/${f}.meg`)
  ];
  let any = false;
  for (const name of expansion ? ['GameData', 'corruption'] : ['GameData']) {
    const root = await child(handle, name, 'directory');
    if (root && (await child((await child(root, 'Data', 'directory')) || root, 'megafiles.xml', 'file')))
      any = (await scanRoot(acc, root, root.name + '/', patches, progress)) || any;
  }
  if (!any)
    throw new Error("This is not the game's folder: choose the one that holds GameData and corruption (“Star Wars Empire at War”).");
  for (const name of expansion ? ['corruption', 'GameData'] : ['GameData']) {
    const exe = await walk(handle, name + '/StarWarsG.exe');
    if (!exe) continue;
    progress('Reading the typefaces');
    const d = new Uint8Array(await (await exe.handle.getFile()).arrayBuffer()),
      dv = new DataView(d.buffer);
    const at = acc.megs.push(exe.path) - 1,
      latin = (o, n) => {
        let t = '';
        for (let i = 0; i < n; i++) t += String.fromCharCode(d[o + i]);
        return t;
      };
    for (let i = 0; i + 12 < d.length; i++) {
      if (d[i] !== 0 || d[i + 1] !== 1 || d[i + 2] !== 0 || d[i + 3] !== 0) continue;
      const n = dv.getUint16(i + 4);
      if (n < 8 || n > 40 || i + 12 + n * 16 > d.length) continue;
      let end = 0,
        nameAt = 0,
        ok = true;
      for (let k = 0; k < n && ok; k++) {
        const o = i + 12 + k * 16,
          tag = latin(o, 4),
          off = dv.getUint32(o + 8),
          len = dv.getUint32(o + 12);
        if (!/^[ -~]{4}$/.test(tag) || i + off + len > d.length) ok = false;
        if (tag === 'name') nameAt = i + off;
        end = Math.max(end, off + len);
      }
      if (!ok || !nameAt) continue;
      let ps = '';
      const count = dv.getUint16(nameAt + 2),
        strings = nameAt + dv.getUint16(nameAt + 4);
      for (let k = 0; k < count && !ps; k++) {
        const o = nameAt + 6 + k * 12;
        if (dv.getUint16(o + 6) !== 6) continue;
        const raw = latin(strings + dv.getUint16(o + 10), dv.getUint16(o + 8));
        ps = dv.getUint16(o) === 1 ? raw : raw.replace(/\0/g, '');
      }
      if (/^EmpireAtWar-\w+$/.test(ps))
        for (const dir of ['Data\\Fonts\\', 'Data\\Fonts\\Game\\']) acc.files[up(dir + ps + '.ttf')] = [at, i, end];
    }
    break;
  }
  return done(acc);
}

export const compatSupported = () =>
  typeof document !== 'undefined' &&
  'indexedDB' in window &&
  'webkitdirectory' in document.createElement('input') &&
  !/Android|iPhone|iPad|Mobile/.test(navigator.userAgent);
export const foldersSupported = () => supported() || compatSupported();

function fileTree(files) {
  const get = (d, n, kind) => {
    const h = d.kids.get(n.toLowerCase());
    if (!h || h.kind !== kind) throw new DOMException(n + ' was not found', 'NotFoundError');
    return h;
  };
  const dir = name => ({
    kind: 'directory',
    name,
    kids: new Map(),
    async *entries() {
      for (const h of this.kids.values()) yield [h.name, h];
    },
    async getDirectoryHandle(n) {
      return get(this, n, 'directory');
    },
    async getFileHandle(n) {
      return get(this, n, 'file');
    }
  });
  let root = null;
  for (const f of files) {
    const parts = (f.webkitRelativePath || f.name).split('/'),
      name = parts.pop();
    let d = (root ||= dir(parts[0] || ''));
    for (const p of parts.slice(1)) {
      let k = d.kids.get(p.toLowerCase());
      if (!k) d.kids.set(p.toLowerCase(), (k = dir(p)));
      d = k;
    }
    d.kids.set(name.toLowerCase(), { kind: 'file', name, getFile: async () => f });
  }
  return root;
}
export function pickFolder() {
  return new Promise(res => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.hidden = true;
    const end = tree => {
      input.remove();
      res(tree);
    };
    input.onchange = () => end(input.files.length ? fileTree(input.files) : null);
    input.oncancel = () => end(null);
    document.body.append(input);
    input.click();
  });
}
async function sameFolder(m, tree) {
  const paths = [
    ...m.megs,
    ...Object.values(m.files)
      .filter(e => typeof e === 'string')
      .slice(0, 20)
  ];
  if (!paths.length) return !!(await child(tree, 'Data', 'directory'));
  for (const p of paths) if (!(await walk(tree, p))) return false;
  return true;
}

const GAME = 'game';
export async function getGame() {
  const d = await db();
  return new Promise(res => {
    const t = d.transaction(STORE),
      q = t.objectStore(STORE).get(GAME);
    t.oncomplete = () => {
      d.close();
      res(q.result || null);
    };
    t.onerror = () => {
      d.close();
      res(null);
    };
  });
}
export function removeGame() {
  return tx('readwrite', s => s.delete(GAME));
}
export async function chooseGame(progress) {
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'swr-game', mode: 'read' });
  } catch {
    return null;
  }
  return setGameFolder(handle, progress);
}
export async function chooseGameCompat(progress) {
  const tree = await pickFolder();
  return tree && setGameFolder(tree, progress, { compat: true });
}
export async function setGameFolder(handle, progress, { compat = false } = {}) {
  const game = {
    id: GAME,
    game: true,
    name: handle.name,
    on: true,
    ...(compat ? { compat } : { handle }),
    scanned: Date.now(),
    ...(await scanGame(handle, progress))
  };
  await tx('readwrite', s => s.put(game));
  return game;
}

export async function addMod(progress) {
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'swr-mod', mode: 'read' });
  } catch {
    return null;
  }
  return addModFolder(handle, progress);
}
export async function addModCompat(progress) {
  const tree = await pickFolder();
  return tree && addModFolder(tree, progress, { compat: true });
}

export async function addModFolder(handle, progress, { compat = false } = {}) {
  const found = await scan(handle, progress);
  const name = (await infoName(handle)) || (await workshopNames([handle.name]))[handle.name];
  const mod = {
    name: name || handle.name,
    named: !!name,
    on: true,
    ...(compat ? { compat, info: await readInfo(handle) } : { handle }),
    scanned: Date.now(),
    ...found
  };
  mod.id = await tx('readwrite', s => s.add(mod));
  return mod;
}

export async function addModArchive(file, progress = () => {}) {
  const { storeTar, tarTree, fileStream } = await import('./pack.js');
  const dir = await modDir(),
    name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tar`;
  const { handle, paths } = await storeTar(
    fileStream(file),
    file.size,
    dir,
    name,
    (f, n) => progress(`copying ${Math.round(f * 100)}% · ${n.toLocaleString()} files`),
    "the mod's folder"
  );
  try {
    let base = null;
    for (const p of paths.keys()) {
      const m = /^((?:[^/]+\/)*?)data\//.exec(p);
      if (m && (base === null || m[1].length < base.length)) base = m[1];
    }
    if (base === null) throw new Error("This archive has no Data folder in it: make the .tar of the mod's own folder.");
    const tar = await handle.getFile(),
      root = tarTree(tar, paths, base);
    const found = await scan(root, progress);
    const used = new Set([...found.megs, ...Object.values(found.files).filter(e => typeof e === 'string')]),
      entries = {};
    for (const [low, [off, size, path]] of paths)
      if (low.startsWith(base) && used.has(path.slice(base.length))) entries[path.slice(base.length)] = [off, size];
    const folder = folderOf(paths, base),
      info = (await infoName(root)) || (await workshopNames([folder || '']))[folder];
    const mod = {
      name: info || folder || file.name.replace(/\.(tar(\.gz)?|tgz|gz)$/i, ''),
      named: !!info,
      on: true,
      archive: { file: name, size: tar.size, entries },
      info: await readInfo(root),
      scanned: Date.now(),
      ...found
    };
    mod.id = await tx('readwrite', s => s.add(mod));
    return mod;
  } catch (e) {
    await dir.removeEntry(name).catch(() => {});
    throw e;
  }
}
function folderOf(paths, base) {
  if (!base) return null;
  for (const [low, [, , path]] of paths)
    if (low.startsWith(base)) return path.slice(0, base.length).split('/').filter(Boolean).pop() || null;
  return null;
}

async function readInfo(handle) {
  try {
    const file = await child(handle, 'modinfo.json', 'file');
    return file ? JSON.parse((await (await file.getFile()).text()).replace(/^﻿/, '')) : null;
  } catch {
    return null;
  }
}
async function infoName(handle) {
  const info = await readInfo(handle);
  for (const n of [info && info.name, info && info.steamdata && info.steamdata.title])
    if (typeof n === 'string' && n.trim()) return n.trim();
  return null;
}

async function workshopNames(ids) {
  ids = [...new Set(ids.filter(id => /^\d+$/.test(id)))];
  if (!ids.length || !inApp()) return {};
  try {
    const r = await fetch('api/workshop?ids=' + ids.join(','));
    return r.ok && /json/.test(r.headers.get('content-type') || '') ? await r.json() : {};
  } catch {
    return {};
  }
}

export async function nameMods() {
  const left = (await listMods()).filter(m => !m.named);
  let changed = false;
  const keep = async (m, name) => {
    Object.assign(m, { name, named: true });
    await tx('readwrite', s => s.put(m));
    changed = true;
  };
  for (const m of left) {
    if (!m.handle || !m.handle.queryPermission || (await m.handle.queryPermission({ mode: 'read' }).catch(() => 'denied')) !== 'granted')
      continue;
    const name = await infoName(m.handle);
    if (name) await keep(m, name);
  }
  const rest = left.filter(m => !m.named),
    names = await workshopNames(rest.map(m => m.name));
  for (const m of rest) if (names[m.name]) await keep(m, names[m.name]);
  return changed;
}

export async function rescanMod(id, progress, tree) {
  const m = await tx('readonly', s => s.get(id));
  if (!m) return null;
  if (m.local) {
    Object.assign(m, await scan(localFolder(m.local), progress), { scanned: Date.now() });
    await tx('readwrite', s => s.put(m));
    return m;
  }
  if (m.compat) {
    if (!tree) throw new Error("Choose the mod's folder again to read it.");
    Object.assign(m, await scan(tree, progress), { info: await readInfo(tree), scanned: Date.now() });
    await tx('readwrite', s => s.put(m));
    return m;
  }
  if (
    (await m.handle.queryPermission({ mode: 'read' })) !== 'granted' &&
    (await m.handle.requestPermission({ mode: 'read' })) !== 'granted'
  )
    throw new Error('The browser was not allowed to read the folder.');
  Object.assign(m, await scan(m.handle, progress), { scanned: Date.now() });
  await tx('readwrite', s => s.put(m));
  return m;
}

function askAgain(mods) {
  return new Promise(res => {
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(2,6,12,.92);color:#cfe3f7;font:15px/1.5 system-ui,sans-serif';
    const inner = document.createElement('div');
    inner.style.cssText = 'max-width:460px;padding:26px 30px;border:1px solid #2c5a86;background:#0a1826;text-align:center';
    const p = document.createElement('p');
    p.textContent = `Your browser needs your go-ahead again to read ${mods.length === 1 ? 'the folder “' + mods[0].name + '”' : mods.length + " folders (the game's and the mods')"}.`;
    const yes = document.createElement('button'),
      no = document.createElement('button');
    yes.textContent = 'Allow and continue';
    no.textContent = 'Continue without';
    for (const b of [yes, no])
      b.style.cssText =
        'margin:14px 6px 0;padding:9px 16px;font:inherit;color:#fff;background:#174a78;border:1px solid #4a9be0;cursor:pointer';
    no.style.background = '#0d1f31';
    inner.append(p, yes, no);
    box.append(inner);
    (document.body || document.documentElement).append(box);
    yes.onclick = async () => {
      const ok = [];
      for (const m of mods) if ((await m.handle.requestPermission({ mode: 'read' }).catch(() => 'denied')) === 'granted') ok.push(m);
      box.remove();
      res(ok);
    };
    no.onclick = () => {
      box.remove();
      res([]);
    };
  });
}

function pickAgain(mods) {
  return new Promise(res => {
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(2,6,12,.92);color:#cfe3f7;font:15px/1.5 system-ui,sans-serif';
    const inner = document.createElement('div');
    inner.style.cssText = 'max-width:500px;padding:26px 30px;border:1px solid #2c5a86;background:#0a1826;text-align:center';
    const one = mods.length === 1,
      p = document.createElement('p'),
      note = document.createElement('p'),
      say = document.createElement('p');
    const why = supported()
      ? `${one ? 'This folder is' : 'These folders are'} installed in a place your browser protects (such as Program Files), so ${one ? 'it is' : 'they are'} opened in compatibility mode`
      : `This browser cannot keep access to a folder, so ${one ? 'this one is' : 'these are'} opened in compatibility mode`;
    p.textContent = `${why}, and the browser does not remember ${one ? 'it' : 'them'} after the page reloads. Choose ${one ? 'it' : 'them'} again to play:`;
    note.textContent = 'If the browser asks whether to “upload” the files: nothing leaves your computer, this page only reads them.';
    note.style.cssText = 'font-size:13px;opacity:.75';
    say.style.cssText = 'color:#ff9c8a;min-height:1.5em;margin:8px 0 0';
    const ok = [],
      style =
        'display:block;width:100%;margin:8px 0 0;padding:9px 16px;font:inherit;color:#fff;background:#174a78;border:1px solid #4a9be0;cursor:pointer';
    const finish = () => {
      box.remove();
      res(ok);
    };
    const picks = mods.map(m => {
      const b = document.createElement('button'),
        shown = m.game ? 'the game folder “' + m.name + '”' : '“' + (m.label || m.name) + '”';
      b.textContent = `Choose ${shown}…`;
      b.style.cssText = style;
      b.onclick = async () => {
        const tree = await pickFolder();
        if (!tree) return;
        if (!(await sameFolder(m, tree))) {
          say.textContent = `“${tree.name}” is not the folder ${shown} was read from.`;
          return;
        }
        m.handle = tree;
        ok.push(m);
        say.textContent = '';
        b.disabled = true;
        b.textContent = `✓ ${shown}`;
        b.style.cursor = 'default';
        b.style.opacity = '.6';
        if (ok.length === mods.length) finish();
      };
      return b;
    });
    const no = document.createElement('button');
    no.textContent = 'Continue without';
    no.style.cssText = style.replace('display:block;width:100%;', '') + ';margin-top:14px;background:#0d1f31';
    no.onclick = finish;
    inner.append(p, ...picks, say, note, no);
    box.append(inner);
    (document.body || document.documentElement).append(box);
  });
}

export async function openOverlay() {
  if (!foldersSupported() && !archivesSupported()) return null;
  const game = foldersSupported() ? await getGame() : null;
  const usable = m => (m.local ? true : m.compat ? compatSupported() : m.handle && supported());
  let mods = [
    ...(game && usable(game) ? [game] : []),
    ...(await listMods()).filter(m => m.on && (m.archive ? archivesSupported() : usable(m)))
  ];
  for (const m of mods)
    if (m.archive)
      m.tar = await (await modDir()).getFileHandle(m.archive.file).then(
        h => h.getFile(),
        () => null
      );
  for (const m of mods) if (m.local) m.handle = localFolder(m.local);
  const lost = mods.filter(m => m.archive && !m.tar);
  if (lost.length) {
    console.warn(
      'mod archives no longer in the site storage:',
      lost.map(m => m.name)
    );
    mods = mods.filter(m => !lost.includes(m));
  }
  if (!mods.length) return null;
  const repick = mods.filter(m => m.compat);
  if (repick.length) {
    const ok = await pickAgain(repick);
    mods = mods.filter(m => !m.compat || ok.includes(m));
  }
  if (!mods.length) return null;
  const state = await Promise.all(
    mods.map(m => (m.archive || m.compat || m.local ? 'granted' : m.handle.queryPermission({ mode: 'read' }).catch(() => 'denied')))
  );
  const asked = mods.filter((m, i) => state[i] !== 'granted');
  if (asked.length) {
    const ok = await askAgain(asked);
    mods = mods.filter(m => !asked.includes(m) || ok.includes(m));
  }
  if (!mods.length) return null;
  const eaw = !expansion();
  if (eaw && game && mods.includes(game)) {
    if (!game.eaw) {
      game.eaw = await scanGame(game.handle, () => {}, 0, { expansion: false });
      const { handle, ...rest } = game;
      await tx('readwrite', s => s.put(game.compat ? rest : game)).catch(() => {});
    }
    mods = mods.map(m => (m === game ? { ...game, ...game.eaw } : m));
  }
  const gameLayer = mods.find(m => m.game);
  for (const m of mods) {
    m.gone = new Set(m.gone);
    m.dirs = new Map();
    m.megFiles = [];
  }
  const top = mods.slice().reverse();
  const languageViews = new Map([[0, Promise.resolve(top)]]);
  const mediaView = language => {
    const id = languageId(language) ?? 0;
    if (!gameLayer) return Promise.resolve(top);
    if (!languageViews.has(id))
      languageViews.set(
        id,
        scanGame(game.handle, () => {}, id, { expansion: !eaw }).then(found => {
          const variant = { ...game, ...found, gone: new Set(found.gone), dirs: new Map(), megFiles: [] };
          return mods.map(m => (m === gameLayer ? variant : m)).reverse();
        })
      );
    return languageViews.get(id);
  };

  const fileOf = async (m, path) => {
    if (m.archive) {
      const e = m.archive.entries[path];
      if (!e) throw new Error('not in the mod archive: ' + path);
      return m.tar.slice(e[0], e[0] + e[1]);
    }
    const parts = path.split('/'),
      name = parts.pop();
    let dir = m.handle,
      at = '';
    for (const part of parts) {
      at += '/' + part;
      let h = m.dirs.get(at);
      if (!h) {
        h = dir.getDirectoryHandle(part);
        m.dirs.set(at, h);
      }
      dir = await h;
    }
    return (await dir.getFileHandle(name)).getFile();
  };
  const bytes = async (m, e, head = Infinity) => {
    if (typeof e === 'string') {
      const f = await fileOf(m, e);
      return (head < f.size ? f.slice(0, head) : f).arrayBuffer();
    }
    const meg = await (m.megFiles[e[0]] ||= fileOf(m, m.megs[e[0]]));
    return meg.slice(e[1], e[1] + Math.min(e[2], head)).arrayBuffer();
  };
  const where = (key, layers = top) => {
    for (const m of layers) {
      if (m.files[key] !== undefined) return [m, m.files[key]];
      if (m.gone.has(key)) return null;
    }
    return undefined;
  };
  const whole = mods.some(m => m.game),
    generated = key => key.startsWith('DATA\\FONTS\\RASTER\\');
  return {
    names: mods.filter(m => !m.game).map(m => m.name),
    whole,
    async read(key, language, head) {
      const layers = language === undefined ? top : await mediaView(language);
      let hit = where(key, layers);
      if (hit === undefined && key.endsWith('.TGA')) hit = where(key.slice(0, -4) + '.DDS', layers);
      if (!hit) return whole && !generated(key) ? null : hit;
      try {
        return await bytes(hit[0], hit[1], head);
      } catch (e) {
        console.warn('file from disk', key, e);
        return whole ? null : undefined;
      }
    },
    infoFor(key) {
      const hit = where(key);
      if (hit === undefined) return undefined;
      if (!hit || hit[0].game) return null;
      const m = hit[0];
      return (m.infoRead ||= m.handle ? readInfo(m.handle) : Promise.resolve(m.info || null));
    },
    async readGame(key) {
      if (!gameLayer) return undefined;
      const hit = where(
        key,
        top.filter(m => m.game)
      );
      if (!hit) return null;
      try {
        return await bytes(hit[0], hit[1]);
      } catch {
        return null;
      }
    },
    rank(key) {
      for (let i = 0; i < top.length; i++) {
        const m = top[i];
        if (m.files[key] !== undefined) return m.game ? -1 : i;
        if (m.gone.has(key)) return -1;
      }
      return -1;
    },
    find(regex, list) {
      const rx = new RegExp(regex, 'i'),
        out = new Set();
      for (const k of list) if (where(k) !== null) out.add(k);
      for (const m of mods) for (const k in m.files) if (rx.test(k) && where(k)) out.add(k);
      return [...out].sort();
    }
  };
}
