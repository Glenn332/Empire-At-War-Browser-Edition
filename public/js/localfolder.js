import { inApp } from './platform.js';
export { inApp };

const q = path => 'path=' + encodeURIComponent(path);
const join = (dir, name) => dir.replace(/[\\/]+$/, '') + '\\' + name;
const notFound = n => new DOMException(n + ' was not found', 'NotFoundError');

class LocalBlob {
  constructor(path, name, start, end) {
    this.path = path;
    this.name = name;
    this.start = start;
    this.end = end;
  }
  get size() {
    return this.end - this.start;
  }
  slice(a = 0, b = this.size) {
    const at = n => (n < 0 ? Math.max(this.size + n, 0) : Math.min(n, this.size));
    return new LocalBlob(this.path, this.name, this.start + at(a), this.start + Math.max(at(a), at(b)));
  }
  async arrayBuffer() {
    if (!this.size) return new ArrayBuffer(0);
    const r = await fetch('api/local/file?' + q(this.path), { headers: { Range: `bytes=${this.start}-${this.end - 1}` } });
    if (!r.ok) throw new Error(`could not read ${this.path} (${r.status})`);
    return r.arrayBuffer();
  }
  async text() {
    return new TextDecoder().decode(await this.arrayBuffer());
  }
}

function file(path, name, size) {
  return {
    kind: 'file',
    name,
    path,
    async getFile() {
      return new LocalBlob(path, name, 0, size);
    }
  };
}

export function localFolder(
  path,
  name = path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop()
) {
  let kids = null;
  const list = () =>
    (kids ||= fetch('api/local/list?' + q(path))
      .then(async r => {
        if (!r.ok) throw new Error(`could not read the folder ${path} (${r.status})`);
        const m = new Map();
        for (const [n, dir, size] of await r.json())
          m.set(n.toLowerCase(), dir ? localFolder(join(path, n), n) : file(join(path, n), n, size));
        return m;
      })
      .catch(e => {
        kids = null;
        throw e;
      }));
  const get = async (n, kind) => {
    const h = (await list()).get(n.toLowerCase());
    if (!h || h.kind !== kind) throw notFound(n);
    return h;
  };
  return {
    kind: 'directory',
    name,
    path,
    async *entries() {
      for (const h of (await list()).values()) yield [h.name, h];
    },
    getDirectoryHandle(n) {
      return get(n, 'directory');
    },
    getFileHandle(n) {
      return get(n, 'file');
    }
  };
}

const asJson = async r => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : null);
const call = async (url, params = {}) => {
  const r = await fetch(url + '?' + new URLSearchParams(params));
  if (r.status === 400) throw new Error(await r.text());
  return asJson(r);
};

export async function localMods() {
  if (!inApp()) return null;
  try {
    return await asJson(await fetch('api/localmods'));
  } catch {
    return null;
  }
}

export function appSetup(change, params) {
  return inApp() ? call('api/setup' + (change ? '/' + change : ''), params) : Promise.resolve(null);
}

export async function appPickFolder(title, from) {
  const r = await call('api/pick-folder', { title, ...(from ? { from } : {}) });
  return r && r.path;
}
