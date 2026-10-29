import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
import { NativeFonts } from './native-fonts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PORT = +arg('--port', 9335),
  QUICK = process.argv.includes('--quick');
const MODS = process.argv.flatMap((a, i) => (a === '--mod' && process.argv[i + 1] ? [process.argv[i + 1]] : []));
const GAME = process.env.SWR_GAME || path.resolve(HERE, '..', '..', 'Star Wars Empire at War');

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const target = targets.find(t => t.type === 'page' && /swr\.localhost|^swr:/.test(t.url));
if (!target) {
  console.log(
    'no app page among',
    targets.map(t => t.url)
  );
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let nextId = 0;
const waiting = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data),
    w = waiting.get(m.id);
  if (w) {
    waiting.delete(m.id);
    w(m);
  }
};
async function page(fn, ...args) {
  const id = ++nextId;
  ws.send(
    JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true }
    })
  );
  const m = await new Promise(r => waiting.set(id, r));
  if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
  return m.result.result.value;
}

const assetUrl = (key, q = '') => 'asset/' + key.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/') + (q ? '?' + q : '');
const sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
async function pageHashes(keys, q) {
  const out = {};
  for (let i = 0; i < keys.length; i += 2000) {
    Object.assign(
      out,
      await page(
        async urls => {
          const res = {},
            list = [...urls];
          const one = async () => {
            for (let u; (u = list.shift()); ) {
              const r = await fetch(u[1]);
              if (r.status !== 200) {
                res[u[0]] = 'status ' + r.status;
                continue;
              }
              const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await r.arrayBuffer()));
              res[u[0]] = [...d.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
            }
          };
          await Promise.all(Array.from({ length: 32 }, one));
          return res;
        },
        keys.slice(i, i + 2000).map(k => [k, assetUrl(k, q)])
      )
    );
    process.stdout.write(`\r  ${Math.min(i + 2000, keys.length)} / ${keys.length}`);
  }
  process.stdout.write('\n');
  return out;
}

let failures = 0;
const fail = (what, detail) => {
  failures++;
  if (failures < 40) console.log('  MISMATCH', what, detail ?? '');
};

async function compare(label, view, q, keys) {
  const t0 = Date.now();
  const got = await pageHashes(keys, q);
  let bytes = 0;
  for (const k of keys) {
    const b = view.read(k);
    bytes += b.length;
    if (got[k] !== sha(b)) fail(label + ' ' + k, `${got[k]} vs ${sha(b)}`);
  }
  console.log(`${label}: ${keys.length} files, ${(bytes / 1e6).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

console.log('page:', target.url, '- cross-origin isolated:', await page(() => globalThis.crossOriginIsolated));
const sample = keys => (QUICK ? keys.filter((_, i) => i % 50 === 0) : keys);

const foc = openGame(GAME, MODS);
const list = await page(async () => (await fetch('api/find?q=.')).json());
const mine = [...foc.index.keys()].sort();
if (JSON.stringify(list) !== JSON.stringify(mine))
  fail('api/find', `${list.length} keys vs ${mine.length}; first different: ${mine.find((k, i) => k !== list[i])}`);
else console.log(`api/find: the same ${list.length} keys`);
const rx = '^DATA\\\\FONTS\\\\[^\\\\]+\\.(TTF|OTF)$';
const fonts = await page(async q => (await fetch('api/find?q=' + encodeURIComponent(q))).json(), rx);
if (JSON.stringify(fonts) !== JSON.stringify(mine.filter(k => new RegExp(rx, 'i').test(k)))) fail('api/find fonts', fonts);
await compare('files', foc, '', sample(mine));

const de = foc.forLanguage(1);
const changed = [...de.index.keys()].filter(k => !foc.index.has(k) || foc.index.get(k) !== de.index.get(k));
await compare('language=1', de, 'language=1', changed);

const eaw = openGame(GAME, MODS, { expansion: false });
const eawList = await page(async () => (await fetch('api/find?q=.&game=eaw')).json());
const eawMine = [...eaw.index.keys()].sort();
if (JSON.stringify(eawList) !== JSON.stringify(eawMine)) fail('api/find game=eaw', `${eawList.length} vs ${eawMine.length}`);
await compare(
  'game=eaw',
  eaw,
  'game=eaw',
  sample(eawMine).filter((_, i) => i % 10 === 0)
);

const dds = mine.find(k => /^DATA\\ART\\TEXTURES\\.*\.DDS$/.test(k) && !foc.index.has(k.slice(0, -4) + '.TGA'));
const tga = await page(
  async u => {
    const r = await fetch(u);
    return [r.status, (await r.arrayBuffer()).byteLength];
  },
  assetUrl(dds.slice(0, -4) + '.TGA')
);
if (tga[0] !== 200 || tga[1] !== foc.read(dds).length) fail('.tga -> .dds', tga);
const missing = await page(async u => (await fetch(u)).status, assetUrl('Data\\No\\Such\\File.xml'));
if (missing !== 204) fail('missing file', missing);

for (const k of [
  mine.find(
    k =>
      foc.index.get(k).file && MODS.some(m => path.resolve(foc.index.get(k).file).toLowerCase().startsWith(path.resolve(m).toLowerCase()))
  ),
  mine.find(k => foc.index.get(k).meg)
].filter(Boolean)) {
  const got = await page(async k => (await fetch('api/modinfo?key=' + encodeURIComponent(k))).text(), k);
  const e = foc.index.get(k),
    at = e.file && path.resolve(e.file).toLowerCase();
  const root =
    at &&
    MODS.map(r => path.resolve(r))
      .filter(r => at.startsWith(r.toLowerCase() + path.sep))
      .pop();
  let info = null;
  try {
    const fs = await import('node:fs');
    const f = root && fs.readdirSync(root).find(n => n.toLowerCase() === 'modinfo.json');
    if (f) info = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8').replace(/^﻿/, ''));
  } catch {}
  if (JSON.stringify(JSON.parse(got)) !== JSON.stringify(info)) fail('api/modinfo ' + k, got.slice(0, 200));
  else console.log(`api/modinfo ${k}: ${info ? "the mod's" : 'null'}`);
}

const raster = 'Data/Fonts/Raster/' + encodeURIComponent('Arial') + '~14~f' + new Uint32Array(new Float32Array([1]).buffer)[0] + '~0.json';
const theirs = await page(async u => {
  const r = await fetch(u);
  return r.status === 200 ? r.text() : 'status ' + r.status;
}, 'asset/' + raster);
const nf = new NativeFonts(foc),
  ours = JSON.parse((await nf.asset(raster)).toString());
nf.close();
let parsed;
try {
  parsed = JSON.parse(theirs);
} catch {
  fail('raster', theirs.slice(0, 200));
}
if (parsed) {
  const mask = v => zlib.gunzipSync(Buffer.from(v.mask, 'base64')).toString('hex');
  const strip = v => JSON.stringify({ ...v, mask: undefined });
  if (mask(parsed) !== mask(ours) || strip(parsed) !== strip(ours))
    fail('raster', strip(parsed).slice(0, 300) + ' vs ' + strip(ours).slice(0, 300));
  else console.log('raster: the same glyph page');
}

console.log(failures ? `${failures} mismatches` : 'all the same');
ws.close();
process.exit(failures ? 1 : 0);
