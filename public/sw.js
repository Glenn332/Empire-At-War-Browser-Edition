const SHELL = 'swr-shell-v4';
const SCOPE = new URL(self.registration.scope).pathname;

const MIME = {
  xml: 'text/xml; charset=windows-1252',
  txt: 'text/plain; charset=windows-1252',
  lua: 'text/plain; charset=windows-1252',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  json: 'application/json'
};

let pack = null;
let hasPack = null;

function loadPack() {
  pack ||= (async () => {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) return null;
      const root = await navigator.storage.getDirectory();
      const idx = await (await root.getFileHandle('index.json')).getFile();
      const tar = await (await root.getFileHandle('game.tar')).getFile();
      const data = JSON.parse(await idx.text());
      if (data.tarSize !== tar.size) return null;
      return { index: new Map(Object.entries(data.files)), eaw: data.eaw ? new Map(Object.entries(data.eaw)) : null, file: tar };
    } catch {
      return null;
    }
  })();
  pack.then(p => {
    hasPack = !!p;
  });
  return pack;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('swr-shell-') && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
      await loadPack();
    })()
  )
);
self.addEventListener('message', e => {
  if (e.data === 'reload-pack') {
    pack = null;
    hasPack = null;
    e.waitUntil(loadPack().then(p => e.source && e.source.postMessage({ pack: !!p })));
  }
});

const indexFor = (p, u) => (new URL(u).searchParams.get('game') === 'eaw' ? p.eaw || new Map() : p.index);

function lookup(index, key) {
  let e = index.get(key);
  if (!e && key.endsWith('.TGA')) e = index.get(key.slice(0, -4) + '.DDS');
  return e;
}

async function network(request) {
  try {
    return await fetch(request);
  } catch {
    try {
      return await fetch(request.url, { cache: 'no-store' });
    } catch (e) {
      return new Response('network error: ' + e.message, { status: 503 });
    }
  }
}

async function serveAsset(request, rel) {
  const p = await loadPack();
  if (!p) return network(request);
  let key;
  try {
    key = decodeURIComponent(rel).replace(/\//g, '\\').toUpperCase();
  } catch {
    return new Response('bad path', { status: 400 });
  }
  const e = lookup(indexFor(p, request.url), key);
  if (!e) return network(request);
  const [off, size] = e;
  const type = MIME[key.slice(key.lastIndexOf('.') + 1).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    let a = range[1] ? +range[1] : Math.max(0, size - +range[2]);
    let b = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
    if (a > b || a >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(p.file.slice(off + a, off + b + 1), {
      status: 206,
      headers: { 'Content-Type': type, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes' }
    });
  }
  return new Response(p.file.slice(off, off + size), {
    headers: { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' }
  });
}

async function serveFind(request, url) {
  const p = await loadPack();
  if (!p) return network(request);
  let rx;
  try {
    rx = new RegExp(url.searchParams.get('q') || '.', 'i');
  } catch {
    return new Response('bad regex', { status: 400 });
  }
  const out = [];
  for (const k of indexFor(p, request.url).keys()) if (rx.test(k)) out.push(k);
  return new Response(JSON.stringify(out.sort()), { headers: { 'Content-Type': 'application/json' } });
}

async function fresh(request) {
  const res = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
  return res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
}

async function serveShell(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fresh(request);
    if (res.ok && res.status === 200) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

const ISOLATED = new Set(['document', 'iframe', 'frame', 'worker', 'sharedworker', 'script']);
function isolate(res) {
  if (!res || res.status === 0 || res.headers.get('Cross-Origin-Embedder-Policy')) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const CDN_FFMPEG = /^https:\/\/cdn\.jsdelivr\.net\/npm\/@ffmpeg\/core@([\w.-]+)\//;
async function serveImmutable(event, prefix, version) {
  const request = event.request,
    name = prefix + version,
    cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200)
    event.waitUntil(
      (async () => {
        await cache.put(request, res.clone());
        for (const k of await caches.keys()) if (k.startsWith(prefix) && k !== name) await caches.delete(k);
      })()
    );
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const cdn = CDN_FFMPEG.exec(req.url);
  if (cdn) {
    event.respondWith(serveImmutable(event, 'swr-ffmpeg-', cdn[1]));
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return;
  const wants = req.mode === 'navigate' || ISOLATED.has(req.destination);
  if (hasPack === false) {
    if (wants)
      event.respondWith(
        fresh(req)
          .catch(() => network(req))
          .then(isolate)
      );
    return;
  }
  if (hasPack === null) loadPack();
  const rel = url.pathname.slice(SCOPE.length);
  if (rel.startsWith('asset/')) event.respondWith(serveAsset(req, rel.slice(6)));
  else if (rel === 'api/find') event.respondWith(serveFind(req, url));
  else if (rel === 'build.json') return;
  else event.respondWith(wants ? serveShell(req).then(isolate) : serveShell(req));
});
