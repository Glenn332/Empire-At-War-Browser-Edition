import { openOverlay } from './mods.js';
import { languageId } from './language.js';
import { expansion } from './edition.js';

const overlay = openOverlay().catch(e => {
  console.warn('mods', e);
  return null;
});
const keyOf = path => path.replace(/\//g, '\\').toUpperCase();

const cache = new Map();

const there = r => r.ok && r.status !== 204;

const base = () => globalThis.SWR_BASE || '';

const GAME = expansion() ? '' : 'game=eaw';
function url(path, language) {
  const q = [language === undefined ? '' : 'language=' + language, GAME].filter(Boolean).join('&');
  return base() + 'asset/' + path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/') + (q ? '?' + q : '');
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
    fetchNow(u)
      .then(ok, no)
      .finally(() => {
        out--;
        next();
      });
  }
};
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

export async function fetchText(path) {
  const buf = await fetchBinary(path);
  return buf ? new TextDecoder('windows-1252').decode(buf) : null;
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
