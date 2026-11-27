import { openOverlay, openStep } from './mods.js';
import { languageId } from './language.js';
import { expansion } from './edition.js';
import { isLua50Chunk, lua50ToSource } from './lua50.js';

const overlay = (globalThis.SWR_OVERLAY ? Promise.resolve(globalThis.SWR_OVERLAY) : openOverlay()).catch(e => {
  console.warn('mods', e);
  return null;
});
export const pageOverlay = () => overlay;
let overlayState = 'waiting';
overlay.then(o => (overlayState = o ? 'open' : 'none'));
const open = new Set();
export function pendingFiles() {
  return {
    folders: overlayState === 'waiting' && openStep ? 'waiting: ' + openStep : overlayState,
    queued: queued.length,
    inFlight: out,
    reading: [...open].slice(0, 5)
  };
}
const keyOf = path =>
  String(path)
    .replace(/[\\/]+/g, '\\')
    .toUpperCase();

const cache = new Map();

const there = r => r.ok && r.status !== 204;

const base = () => globalThis.SWR_BASE || '';

const GAME = expansion() ? '' : 'game=eaw';
function url(path, language) {
  const q = [language === undefined ? '' : 'language=' + language, GAME].filter(Boolean).join('&');
  return (
    base() +
    'asset/' +
    String(path)
      .replace(/[\\/]+/g, '/')
      .split('/')
      .map(encodeURIComponent)
      .join('/') +
    (q ? '?' + q : '')
  );
}

let worker = null,
  nextId = 0;
const waiting = new Map();
const fetchHere = u => fetch(u).then(r => (there(r) ? r.arrayBuffer() : null));
const MAX_OUT = 48;
let out = 0;
const queued = [];
const next = () => {
  while (out < MAX_OUT && queued.length) {
    out++;
    const [u, ok, no] = queued.shift();
    fetchRetry(u)
      .then(ok, no)
      .finally(() => {
        out--;
        next();
      });
  }
};
const fetchRetry = (u, tries = 0) =>
  fetchNow(u).catch(e =>
    tries < 2 ? new Promise(r => setTimeout(r, 300 * (tries + 1))).then(() => fetchRetry(u, tries + 1)) : Promise.reject(e)
  );
function fetchOff(u) {
  return new Promise((ok, no) => {
    queued.push([u, ok, no]);
    next();
  });
}
function fetchNow(u) {
  if (worker === null) {
    try {
      worker =
        typeof Worker !== 'undefined' && typeof location !== 'undefined'
          ? new Worker(new URL('./fetchworker.js', import.meta.url), { type: 'module' })
          : false;
      if (worker) {
        worker.onmessage = e => {
          const w = waiting.get(e.data.id);
          if (!w) return;
          waiting.delete(e.data.id);
          if (e.data.error) w.reject(new Error(e.data.error));
          else w.resolve(e.data.buf);
        };
        worker.onerror = () => {
          console.warn('fetchworker.js did not start; fetching on the page');
          worker = false;
          for (const w of waiting.values()) fetchHere(w.u).then(w.resolve, w.reject);
          waiting.clear();
        };
      }
    } catch {
      worker = false;
    }
  }
  if (!worker) return fetchHere(u);
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, u });
    worker.postMessage({ id, url: new URL(u, location.href).href });
  });
}

export function fetchBinary(path, { language, keep = true } = {}) {
  if (language !== undefined) language = languageId(language) ?? 0;
  const key = path.toUpperCase() + (language === undefined ? '' : '|language=' + language);
  let p = cache.get(key);
  if (!p) {
    const own = () => fetchOff(url(path, language));
    p = overlay.then(o => (o ? o.read(keyOf(path), language) : undefined)).then(b => (b !== undefined ? b : own()));
    cache.set(key, p);
    open.add(path);
    p.finally(() => open.delete(path)).catch(() => {});
    p.then(
      b => {
        if (!keep && cache.get(key) === p) cache.delete(key);
      },
      () => {
        if (cache.get(key) === p) cache.delete(key);
      }
    );
  }
  return p;
}

export async function fetchHead(path, bytes) {
  const o = await overlay;
  const mine = o ? await o.read(keyOf(path), undefined, bytes) : undefined;
  if (mine !== undefined) return mine ? mine.slice(0, bytes) : null;
  const r = await fetch(url(path), { headers: { Range: 'bytes=0-' + (bytes - 1) } }).catch(() => null);
  if (!r || !there(r)) return null;
  const b = await r.arrayBuffer();
  return b.byteLength > bytes ? b.slice(0, bytes) : b;
}

const totalOf = response => {
  const match = /\/(\d+)\s*$/.exec(response.headers.get('Content-Range') || '');
  return match ? +match[1] : null;
};

export async function fetchPart(path, from, length) {
  const local = await overlay;
  if (local) {
    const mine = local.readPart
      ? await local.readPart(keyOf(path), from, length)
      : await local.read(keyOf(path), undefined, from + length).then(bytes => (bytes ? bytes.slice(from) : bytes));
    if (mine !== undefined) return mine && { bytes: mine, total: null };
  }
  const response = await fetch(url(path), { headers: { Range: `bytes=${from}-${from + length - 1}` } }).catch(() => null);
  if (response && response.status === 416) return { bytes: new ArrayBuffer(0), total: totalOf(response) };
  if (!response || !there(response)) return null;
  const bytes = await response.arrayBuffer();
  if (response.status === 206) return { bytes, total: totalOf(response) };
  return { bytes: bytes.slice(from, from + length), total: bytes.byteLength };
}

// XML is parsed once into a tree, so its bytes are not kept after the read (a large mod has hundreds of megabytes).
export async function fetchText(path) {
  const buf = await fetchBinary(path, { keep: !/\.xml$/i.test(path) });
  if (!buf) return null;
  if (/\.lua$/i.test(path) && isLua50Chunk(buf)) return lua50ToSource(buf);
  return new TextDecoder('windows-1252').decode(buf);
}

export const assetUrl = url;
export async function mediaUrl(path) {
  const o = await overlay,
    b = o ? await o.read(keyOf(path)) : undefined;
  return b ? URL.createObjectURL(new Blob([b])) : url(path);
}
export const loadedMods = () => overlay.then(o => (o ? o.names : []));
export function fetchGameFile(path) {
  return overlay.then(o => (o ? o.readGame(keyOf(path)) : undefined)).then(b => (b !== undefined ? b : fetchOff(url(path))));
}
export async function modInfo(path) {
  const o = await overlay,
    mine = o ? await o.infoFor(keyOf(path)) : undefined;
  if (mine !== undefined) return mine;
  const r = await fetch(base() + 'api/modinfo?key=' + encodeURIComponent(keyOf(path)) + (GAME ? '&' + GAME : '')).catch(() => null);
  return r && there(r) ? r.json().catch(() => null) : null;
}
export const modRank = path => overlay.then(o => (o ? o.rank(keyOf(path)) : -1));
export const fromInstall = () => overlay.then(o => !!(o && o.whole));

export async function findFiles(regex) {
  const o = await overlay;
  if (o && o.whole) return o.find(regex, []);
  const list = await fetch(base() + 'api/find?q=' + encodeURIComponent(regex) + (GAME ? '&' + GAME : '')).then(r => r.json());
  return o ? o.find(regex, list) : list;
}

export class ChunkReader {
  constructor(buffer, start = 0, end = buffer.byteLength) {
    this.buf = buffer;
    this.dv = new DataView(buffer);
    this.pos = start;
    this.end = end;
  }
  *chunks(start = this.pos, end = this.end) {
    let p = start;
    while (p + 8 <= end) {
      const type = this.dv.getUint32(p, true);
      const raw = this.dv.getUint32(p + 4, true);
      const size = raw & 0x7fffffff;
      if (p + 8 + size > end) return;
      yield { type, container: raw >>> 31 === 1, start: p + 8, end: p + 8 + size };
      p += 8 + size;
    }
  }
  *minis(c) {
    let p = c.start;
    while (p + 2 <= c.end) {
      const type = this.dv.getUint8(p),
        size = this.dv.getUint8(p + 1);
      yield { type, start: p + 2, size };
      p += 2 + size;
    }
  }
  str(start, end) {
    const bytes = new Uint8Array(this.buf, start, end - start);
    let n = bytes.indexOf(0);
    if (n < 0) n = bytes.length;
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  f32(p) {
    return this.dv.getFloat32(p, true);
  }
  u32(p) {
    return this.dv.getUint32(p, true);
  }
  i32(p) {
    return this.dv.getInt32(p, true);
  }
  vec(p, n) {
    const o = [];
    for (let i = 0; i < n; i++) o.push(this.dv.getFloat32(p + i * 4, true));
    return o;
  }
}
