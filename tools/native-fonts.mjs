import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { fontInfo, fontFileFace } from '../public/js/fontname.js';

// a page asks for a handful of faces and sizes; these bound what any caller can make the GDI worker do
const KEEP = 256,
  QUEUE_MAX = 256,
  DISK_MAX = 4000,
  OTHER_FACES = 16,
  STRETCH_MAX = 8;

export class NativeFonts {
  constructor(game) {
    this.game = game;
    this.pending = new Map();
    this.queue = [];
    this.worker = null;
    this.directory = null;
    this.alias = new Map();
    this.otherFaces = new Set();
    this.writes = 0;
  }
  async start() {
    if (this.started) return this.started;
    this.started = (async () => {
      if (process.platform !== 'win32') throw new Error('Generate native font assets on Windows before packing');
      const keys = [...this.game.index.keys()].filter(k => /^DATA\\FONTS\\.*\.(TTF|OTF)$/.test(k) && !k.startsWith('DATA\\FONTS\\GAME\\')),
        fonts = keys.map(k => this.game.read(k));
      const claims = [];
      keys.forEach((k, i) => {
        const info = fontInfo(fonts[i]),
          exe = /\.exe$/i.test(this.game.index.get(k).file || '');
        if (info) [fontFileFace(k), info.full, info.family].forEach((name, kind) => name && claims.push({ name, kind, exe, info }));
      });
      claims.sort((a, b) => a.exe - b.exe || a.kind - b.kind);
      for (const { name, info } of claims)
        if (!this.alias.has(name.toUpperCase()))
          this.alias.set(name.toUpperCase(), [info.full, info.family].some(n => n.toUpperCase() === name.toUpperCase()) ? null : info.full);
      const hash = crypto.createHash('sha256').update('GDI4-v4');
      for (const font of fonts) hash.update(font);
      this.directory = path.join(os.tmpdir(), 'sw-revival-fonts', hash.digest('hex').slice(0, 24));
      fs.mkdirSync(this.directory, { recursive: true });
      this.worker = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./gdi-font.ps1', import.meta.url))],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const lines = createInterface({ input: this.worker.stdout });
      lines.on('line', line => {
        const item = this.queue.shift();
        if (!item) return;
        try {
          const value = JSON.parse(line);
          if (value.error) item.reject(new Error(value.error));
          else item.resolve(value);
        } catch (e) {
          item.reject(e);
        }
      });
      const fail = error => {
        for (const item of this.queue.splice(0)) item.reject(error);
      };
      this.worker.on('error', fail);
      this.worker.on('exit', code => {
        this.worker = null;
        fail(new Error('GDI worker exited ' + code));
      });
      this.worker.stderr.on('data', b => {
        this.lastError = String(b);
      });
      await this.request({ fonts: fonts.map(b => b.toString('base64')) });
    })();
    return this.started;
  }
  request(value) {
    if (this.queue.length >= QUEUE_MAX) return Promise.reject(new Error('too many font requests at once'));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.worker.stdin.write(JSON.stringify(value) + '\n');
    });
  }
  async asset(name) {
    const m = /^DATA[\\/]FONTS[\\/]RASTER[\\/]([^\\/]+)~(\d+)~(f?\d+)~(\d+)(~b1)?(?:~c(\d+))?\.JSON$/i.exec(name);
    if (!m) return null;
    const bits = Buffer.alloc(4);
    if (m[3][0].toLowerCase() === 'f') bits.writeUInt32LE(Number(m[3].slice(1)) >>> 0);
    const face = decodeURIComponent(m[1]),
      height = +m[2],
      stretch = m[3][0].toLowerCase() === 'f' ? bits.readFloatLE() : +m[3] / 1000,
      page = +m[4],
      bold = !!m[5],
      charset = +(m[6] || 0);
    if (
      !face ||
      face.length > 64 ||
      /[\u0000-\u001f\\/]/.test(face) ||
      height < 1 ||
      height > 256 ||
      !Number.isFinite(stretch) ||
      stretch <= 0 ||
      stretch > STRETCH_MAX ||
      page > 255 ||
      ![0, 128].includes(charset)
    )
      return null;
    const key = JSON.stringify([face.toUpperCase(), height, stretch, page, bold, charset]);
    let job = this.pending.get(key);
    if (job) {
      // most recently used last, so the oldest is the first to go
      this.pending.delete(key);
      this.pending.set(key, job);
      return job;
    }
    await this.start();
    // the game's own faces always; a few others (system fonts a mod names), not any name a caller makes up
    const upper = face.toUpperCase();
    if (!this.alias.has(upper) && !this.otherFaces.has(upper)) {
      if (this.otherFaces.size >= OTHER_FACES) return null;
      this.otherFaces.add(upper);
    }
    job = (async () => {
      const file = path.join(this.directory, crypto.createHash('sha256').update(key).digest('hex') + '.json');
      if (fs.existsSync(file)) return fs.readFileSync(file);
      const value = await this.request({ face: this.alias.get(upper) || face, height, stretch, page, bold, charset });
      value.mask = zlib.gzipSync(Buffer.from(value.mask, 'base64')).toString('base64');
      value.compression = 'gzip';
      const bytes = Buffer.from(JSON.stringify(value));
      fs.writeFileSync(file, bytes);
      if (++this.writes % 100 === 0) this.prune();
      return bytes;
    })().catch(error => {
      this.pending.delete(key);
      throw error;
    });
    this.pending.set(key, job);
    while (this.pending.size > KEEP) this.pending.delete(this.pending.keys().next().value);
    return job;
  }
  // the disk cache keeps the most recently written pages
  prune() {
    try {
      const files = fs
        .readdirSync(this.directory)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const at = path.join(this.directory, f);
          return { at, t: fs.statSync(at).mtimeMs };
        });
      if (files.length <= DISK_MAX) return;
      files.sort((a, b) => a.t - b.t);
      for (const f of files.slice(0, files.length - DISK_MAX)) fs.rmSync(f.at, { force: true });
    } catch {}
  }
  close() {
    this.worker?.stdin.end();
  }
}
