import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame } from './tools/megfs.mjs';
import { NativeFonts } from './tools/native-fonts.mjs';
import zlib from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = process.env.SWR_GAME || path.resolve(HERE, '..', 'Star Wars Empire at War');
const portArg = process.argv.indexOf('--port');
const PORT = Number((portArg > 0 && process.argv[portArg + 1]) || process.env.PORT || 8377);
const PUBLIC = path.join(HERE, 'public');
const MODS = process.argv
  .flatMap((a, i) => (a === '--mod' && process.argv[i + 1] ? [process.argv[i + 1]] : []))
  .concat((process.env.SWR_MOD || '').split(';').filter(Boolean));

let game = null;
const STATIC = !!process.env.SWR_STATIC || process.argv.includes('--static');
if (fs.existsSync(GAME) && !STATIC) {
  const t0 = Date.now();
  game = openGame(GAME, MODS);
  console.log(
    `indexed ${game.index.size} game files in ${Date.now() - t0} ms from ${GAME}${MODS.length ? ' with ' + MODS.join(', ') : ''}`
  );
} else {
  console.log('no game install mounted: serving static files only (assets come from the imported archive)');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'text/xml; charset=windows-1252',
  '.txt': 'text/plain; charset=windows-1252',
  '.lua': 'text/plain; charset=windows-1252',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};
const mime = p => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function send(res, code, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra });
  res.end(body);
}

function serveStatic(req, res, rel) {
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found: ' + rel);
    res.writeHead(200, {
      'Content-Type': mime(file),
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      ...(/\.html$/i.test(file) ? { 'Document-Policy': 'js-profiling' } : {})
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const games = { foc: game && { game, fonts: new NativeFonts(game) }, eaw: null };
function gameFor(url) {
  if (!game || url.searchParams.get('game') !== 'eaw') return games.foc;
  if (!games.eaw) {
    const g = openGame(GAME, MODS, { expansion: false });
    games.eaw = { game: g, fonts: new NativeFonts(g) };
    console.log(`indexed ${g.index.size} files of the original game`);
  }
  return games.eaw;
}
http
  .createServer(async (req, res) => {
    if (!STATIC) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    }
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.has('jsprofile')) res.setHeader('Document-Policy', 'js-profiling');
    let p;
    try {
      p = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, 'bad path');
    }

    if (p.startsWith('/asset/')) {
      const which = gameFor(url),
        nativeFonts = which && which.fonts;
      const assets = which && (url.searchParams.has('language') ? which.game.forLanguage(url.searchParams.get('language')) : which.game);
      let key = assets && assets.resolve(p.slice(7));
      if (!key && nativeFonts && /^Data\/Fonts\/Raster\//i.test(p.slice(7))) {
        try {
          const bytes = await nativeFonts.asset(p.slice(7));
          if (bytes)
            return send(res, 200, zlib.gzipSync(bytes), MIME['.json'], { 'Content-Encoding': 'gzip', 'Cache-Control': 'max-age=86400' });
        } catch (error) {
          console.warn('font raster:', error.message);
        }
      }
      if (!key) return send(res, 204, '');
      const size = assets.index.get(key).size,
        range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        const a = range[1] ? +range[1] : Math.max(0, size - +range[2]),
          b = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
        if (a > b || a >= size) return send(res, 416, '', 'text/plain', { 'Content-Range': `bytes */${size}` });
        return send(res, 206, assets.readPart(key, a, b - a + 1), mime(key), {
          'Content-Range': `bytes ${a}-${b}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'max-age=86400'
        });
      }
      return send(res, 200, assets.read(key), mime(key), { 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=86400' });
    }
    if (p === '/api/find') {
      if (!game) return send(res, 404, 'no game mounted');
      let rx;
      try {
        rx = new RegExp(url.searchParams.get('q') || '.', 'i');
      } catch {
        return send(res, 400, 'bad regex');
      }
      const out = [];
      for (const k of gameFor(url).game.index.keys()) if (rx.test(k)) out.push(k);
      return send(res, 200, JSON.stringify(out.sort()), MIME['.json']);
    }
    if (p === '/api/modinfo') {
      const e = game && gameFor(url).game.index.get((url.searchParams.get('key') || '').replace(/\//g, '\\').toUpperCase());
      const at = e && e.file && path.resolve(e.file).toLowerCase(),
        root =
          at &&
          MODS.map(r => path.resolve(r))
            .filter(r => at.startsWith(r.toLowerCase() + path.sep))
            .pop();
      let info = null;
      try {
        const f = root && fs.readdirSync(root).find(n => n.toLowerCase() === 'modinfo.json');
        if (f) info = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8').replace(/^\ufeff/, ''));
      } catch {}
      return send(res, 200, JSON.stringify(info), MIME['.json']);
    }
    serveStatic(req, res, p === '/' ? 'index.html' : p.slice(1));
  })
  .listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}/`));
