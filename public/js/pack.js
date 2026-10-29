import { inApp } from './platform.js';

export async function startServiceWorker({ mayReload = () => true } = {}) {
  if (!('serviceWorker' in navigator)) return false;
  if (inApp()) {
    try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch {}
    return false;
  }
  const within = (p, ms) => Promise.race([p, new Promise(res => setTimeout(res, ms))]);
  try {
    await within(navigator.serviceWorker.register('sw.js'), 4000);
    await within(navigator.serviceWorker.ready, 4000);
    if (!navigator.serviceWorker.controller) {
      await within(new Promise(res => navigator.serviceWorker.addEventListener('controllerchange', res, { once: true })), 3000);
    }
    if (navigator.serviceWorker.controller && !globalThis.crossOriginIsolated && window.top === window && mayReload()) {
      let again = false; try { again = !sessionStorage.getItem('swr-coi-reload'); if (again) sessionStorage.setItem('swr-coi-reload', '1'); } catch {}
      if (again) { location.reload(); await new Promise(() => {}); }
    }
    return !!navigator.serviceWorker.controller;
  } catch (e) {
    console.warn('service worker unavailable:', e.message);
    return false;
  }
}

export async function packInfo() {
  try {
    const root = await navigator.storage.getDirectory();
    const idx = JSON.parse(await (await (await root.getFileHandle('index.json')).getFile()).text());
    const tar = await (await root.getFileHandle('game.tar')).getFile();
    if (idx.tarSize !== tar.size) return null;
    return { files: Object.keys(idx.files).length, tarSize: tar.size, imported: idx.imported, eaw: !!idx.eaw };
  } catch { return null; }
}

export async function removePack() {
  const root = await navigator.storage.getDirectory();
  for (const name of ['index.json', 'game.tar']) await root.removeEntry(name).catch(() => {});
  await tellWorker();
}

function tellWorker() {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw) return Promise.resolve();
  return new Promise(res => {
    const done = () => { navigator.serviceWorker.removeEventListener('message', done); res(); };
    navigator.serviceWorker.addEventListener('message', done);
    sw.postMessage('reload-pack');
    setTimeout(done, 2000);
  });
}

function octal(bytes, start, len) {
  let s = '';
  for (let i = start; i < start + len; i++) { const c = bytes[i]; if (c === 0 || c === 32) { if (s) break; continue; } s += String.fromCharCode(c); }
  return s ? parseInt(s, 8) : 0;
}

function cstr(bytes, start, len) {
  let s = '';
  for (let i = start; i < start + len && bytes[i]; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function fileStream(file, piece = 8 << 20) {
  let at = 0;
  return new ReadableStream({
    async pull(ctl) {
      if (at >= file.size) { ctl.close(); return; }
      const end = Math.min(file.size, at + piece);
      ctl.enqueue(new Uint8Array(await file.slice(at, end).arrayBuffer()));
      at = end;
    },
  }, { highWaterMark: 0 });
}

async function openSink(dir, name, handle) {
  let w = null;
  try {
    w = new Worker(new URL('./opfswriter.js', import.meta.url), { type: 'module' });
    const waiting = new Map(), ahead = [];
    let next = 0, failed = null, at = 0;
    const stop = e => { failed ||= e; for (const p of waiting.values()) p.rej(failed); waiting.clear(); };
    w.onmessage = ({ data }) => {
      const p = waiting.get(data.id);
      waiting.delete(data.id);
      if (!data.error) { if (p) p.res(); return; }
      stop(Object.assign(new Error(data.error.replace(/^QuotaExceededError: /, '')), /^QuotaExceededError/.test(data.error) ? { name: 'QuotaExceededError' } : {}));
    };
    w.onerror = e => { e.preventDefault(); stop(new Error(e.message || 'The writer stopped')); };
    const ask = (msg, transfer = []) => new Promise((res, rej) => {
      if (failed) { rej(failed); return; }
      const id = ++next;
      waiting.set(id, { res, rej });
      w.postMessage({ ...msg, id }, transfer);
    });
    await ask({ open: await (await navigator.storage.getDirectory()).resolve(dir), name });
    return {
      async write(bytes) {
        const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
        const from = at;
        at += buf.byteLength;
        const p = ask({ at: from, chunk: buf }, [buf]);
        p.catch(() => {});
        ahead.push(p);
        if (ahead.length > 8) await ahead.shift();
      },
      async close() { try { await Promise.all(ahead); await ask({ close: true }); } finally { w.terminate(); } },
      async abort() { await ask({ close: true }).catch(() => {}); w.terminate(); },
    };
  } catch (e) {
    if (w) w.terminate();
    console.warn('OPFS writer worker unavailable, writing from the page:', e.message);
  }
  if (!handle.createWritable) throw new Error('This browser cannot write to the Origin Private File System');
  const out = await handle.createWritable();
  return { write: bytes => out.write(bytes), close: () => out.close(), abort: () => out.abort() };
}

export async function storeTar(source, total, dir, name, onProgress = () => {}, what = 'the folder') {
  if (!dir) throw new Error('This browser has no Origin Private File System');
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress gzip streams');
  if (navigator.storage.persist) await navigator.storage.persist().catch(() => {});
  const handle = await dir.getFileHandle(name, { create: true });
  const out = await openSink(dir, name, handle);

  let read = 0;
  const counter = new TransformStream({ transform(chunk, ctl) { read += chunk.byteLength; ctl.enqueue(chunk); } });
  const src = source.getReader(), first = await src.read();
  const lead = first.value || new Uint8Array(0);
  const raw = new ReadableStream({
    start(ctl) { if (lead.byteLength) ctl.enqueue(lead); if (first.done) ctl.close(); },
    async pull(ctl) { const { done, value } = await src.read(); if (done) ctl.close(); else ctl.enqueue(value); },
    cancel(r) { return src.cancel(r); },
  });
  const gz = lead[0] === 0x1f && lead[1] === 0x8b;
  if (lead[0] === 0x50 && lead[1] === 0x4b) { await src.cancel().catch(() => {}); await out.abort().catch(() => {}); await dir.removeEntry(name).catch(() => {}); throw new Error(`This is a .zip file. Make a .tar of ${what} instead.`); }
  const reader = (gz ? raw.pipeThrough(counter).pipeThrough(new DecompressionStream('gzip')) : raw.pipeThrough(counter)).getReader();
  const paths = new Map();
  const header = new Uint8Array(512);
  let fill = 0, skip = 0, pos = 0, count = 0, lastReport = 0, last = '';
  let body = null, bodyAt = 0, bodyType = 0, longName = null;
  const fail = async e => { await dir.removeEntry(name).catch(() => {}); throw e; };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let i = 0;
      const len = value.byteLength;
      while (i < len) {
        if (body) {
          const n = Math.min(body.length - bodyAt, len - i);
          body.set(value.subarray(i, i + n), bodyAt);
          bodyAt += n; i += n; pos += n; skip -= n;
          if (bodyAt === body.length) {
            if (bodyType === 76) longName = cstr(body, 0, body.length);
            else for (const m of new TextDecoder().decode(body).matchAll(/^\d+ path=(.*)$/gm)) longName = m[1];
            body = null;
          }
          continue;
        }
        if (skip > 0) { const n = Math.min(skip, len - i); skip -= n; i += n; pos += n; continue; }
        const n = Math.min(512 - fill, len - i);
        header.set(value.subarray(i, i + n), fill);
        fill += n; i += n; pos += n;
        if (fill < 512) break;
        fill = 0;
        if (!header[0]) continue;
        const size = octal(header, 124, 12), type = header[156];
        skip = Math.ceil(size / 512) * 512;
        if (type === 0 || type === 48) {
          const prefix = cstr(header, 345, 155), name = cstr(header, 0, 100);
          const path = (longName ?? ((prefix ? prefix + '/' : '') + name)).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
          paths.set(path.toLowerCase(), [pos, size, path]);
          count++; last = path;
        } else if ((type === 120 || type === 76) && size && size < 65536) { body = new Uint8Array(size); bodyAt = 0; bodyType = type; }
        if (type !== 120 && type !== 76 && type !== 103) longName = null;
      }
      await out.write(value);
      const now = performance.now();
      if (now - lastReport > 100) { lastReport = now; onProgress(total ? read / total : 0, count, last); }
    }
    await out.close();
  } catch (e) {
    await out.abort().catch(() => {});
    return fail(e);
  }
  if (!count) return fail(new Error('No files found in it - is this a tar archive?'));
  const stored = (await handle.getFile()).size;
  if (stored !== pos) return fail(new Error(`Only ${(stored / 1048576).toFixed(0)} of ${(pos / 1048576).toFixed(0)} MB could be stored in the browser - is the disk full?`));
  return { handle, paths, count, pos };
}

export async function importPack(source, total, onProgress = () => {}, onStage = () => {}) {
  const root = navigator.storage?.getDirectory ? await navigator.storage.getDirectory() : null;
  if (root) await root.removeEntry('index.json').catch(() => {});
  const { handle, paths, pos } = await storeTar(source, total, root, 'game.tar', onProgress, 'the game folder');
  const fail = async e => { await root.removeEntry('game.tar').catch(() => {}); throw e; };
  const base = gameBase(paths);
  if (base === null) return fail(new Error('This archive does not hold the game\'s folder (GameData and corruption).'));
  onStage('Reading the game\'s archives');
  let index, eaw;
  try { ({ files: index, eaw } = await indexInstall(await handle.getFile(), paths, base, onStage)); }
  catch (e) { return fail(e); }
  const n = Object.keys(index).length;
  const idx = await (await root.getFileHandle('index.json', { create: true })).createWritable();
  await idx.write(JSON.stringify({ tarSize: pos, imported: new Date().toISOString(), kind: 'install', files: index, eaw }));
  await idx.close();
  await tellWorker();
  onProgress(1, n);
  return { files: n, tarSize: pos };
}

export function tarTree(tar, paths, base) {
  const dir = name => ({ kind: 'directory', name, kids: new Map(), async *entries() { yield* this.kids; } });
  const top = dir('');
  for (const [low, [off, size, path]] of paths) {
    if (!low.startsWith(base)) continue;
    const parts = path.slice(base.length).split('/').filter(Boolean), name = parts.pop();
    let d = top;
    for (const part of parts) { let k = d.kids.get(part); if (!k || k.kind !== 'directory') d.kids.set(part, k = dir(part)); d = k; }
    d.kids.set(name, { kind: 'file', name, getFile: async () => tar.slice(off, off + size) });
  }
  return top;
}

async function indexInstall(tar, paths, base, progress, { expansion = true } = {}) {
  const top = tarTree(tar, paths, base);
  const { scanGame } = await import('./mods.js');
  const at = rel => paths.get((base + rel).toLowerCase());
  return { files: expansion ? indexOf(await scanGame(top, progress), at) : null, eaw: indexOf(await scanGame(top, progress, 0, { expansion: false }), at) };
}

export async function ensureOriginal(onStage = () => {}) {
  const root = await navigator.storage.getDirectory();
  const data = JSON.parse(await (await (await root.getFileHandle('index.json')).getFile()).text());
  if (data.eaw) return true;
  if (data.kind !== 'install') return false;
  onStage('Reading the archive for the original game');
  const tar = await (await root.getFileHandle('game.tar')).getFile(), paths = new Map();
  let longName = null;
  for (let pos = 0; pos + 512 <= tar.size;) {
    const h = new Uint8Array(await tar.slice(pos, pos + 512).arrayBuffer());
    pos += 512;
    if (!h[0]) continue;
    const size = octal(h, 124, 12), type = h[156];
    if (type === 0 || type === 48) {
      const prefix = cstr(h, 345, 155), name = cstr(h, 0, 100);
      const path = (longName ?? ((prefix ? prefix + '/' : '') + name)).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
      paths.set(path.toLowerCase(), [pos, size, path]);
    } else if ((type === 120 || type === 76) && size && size < 65536) {
      const body = new Uint8Array(await tar.slice(pos, pos + size).arrayBuffer());
      if (type === 76) longName = cstr(body, 0, body.length);
      else for (const m of new TextDecoder().decode(body).matchAll(/^\d+ path=(.*)$/gm)) longName = m[1];
    }
    if (type !== 120 && type !== 76 && type !== 103) longName = null;
    pos += Math.ceil(size / 512) * 512;
  }
  const base = gameBase(paths);
  if (base === null) return false;
  onStage('Reading the original game\'s archives');
  data.eaw = (await indexInstall(tar, paths, base, onStage, { expansion: false })).eaw;
  const idx = await (await root.getFileHandle('index.json', { create: true })).createWritable();
  await idx.write(JSON.stringify(data));
  await idx.close();
  await tellWorker();
  return true;
}

function gameBase(paths) {
  let base = null;
  for (const p of paths.keys()) { const m = /^(.*?)(?:gamedata|corruption)\/data\/megafiles\.xml$/.exec(p); if (m && (base === null || m[1].length < base.length)) base = m[1]; }
  return base;
}

function indexOf(found, at) {
  const index = {};
  for (const [key, e] of Object.entries(found.files)) {
    if (typeof e === 'string') { const f = at(e); if (f) index[key] = [f[0], f[1]]; continue; }
    const meg = at(found.megs[e[0]]);
    if (meg) index[key] = [meg[0] + e[1], e[2]];
  }
  return index;
}

export async function assetsAvailable() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return (await fetch('asset/Data/XML/GameObjectFiles.xml', { method: 'GET' })).status === 200; } catch { await new Promise(res => setTimeout(res, 400)); }
  }
  return false;
}
