import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
import { parseXML } from '../public/js/xml.js';
import { binkHeader, binkChunkSize, NATIVE_BINK_FPS } from '../public/js/binkdata.js';
import { BinkPlayer } from '../public/js/bink.js';
import createCore from '../public/vendor/ffmpeg/ffmpeg-core.js';

const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
const read = path => {
  const resolved = archive.resolve(path);
  assert(resolved, path);
  return archive.read(resolved);
};
const root = parseXML(new TextDecoder('windows-1252').decode(read('Data/XML/Movies.xml')));
const movies = [];
const visit = n => {
  if (n.tag === 'Movie') movies.push(n);
  for (const c of n.children) visit(c);
};
visit(root);
const movie = movies.find(m => m.attrs.Name === 'Pestage_Loop') || movies.find(m => /true|yes|1/i.test(m.val('Alpha')));
assert(movie);
const bytes = read(movie.val('Movie_File')),
  buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  header = binkHeader(buffer);
assert.equal(NATIVE_BINK_FPS, 30);
assert(header.alpha);
assert(binkChunkSize(header) * header.width * header.height * 4 <= 8 * 1024 * 1024);
assert.throws(() => binkHeader(new ArrayBuffer(5)), /Truncated/);
globalThis.self = { location: { href: import.meta.url } };
const core = await createCore({ wasmBinary: fs.readFileSync(new URL('../public/vendor/ffmpeg/ffmpeg-core.wasm', import.meta.url)) });
const errors = [];
core.setLogger(({ message }) => {
  if (!/^Aborted/.test(message)) errors.push(message);
});
core.FS.writeFile('/movie.bik', new Uint8Array(buffer));
let output = [];
const dev = core.FS.makedev(200, 0);
core.FS.registerDevice(dev, {
  write(stream, bytes, offset, length) {
    output.push(Uint8Array.from(bytes.subarray(offset, offset + length)));
    return length;
  }
});
core.FS.mkdev('/frames', 0o666, dev);
const decode = (start, count) => {
  output = [];
  errors.length = 0;
  const before = performance.now();
  const result = core.exec(
    '-v',
    'error',
    '-ss',
    String(start / header.fps),
    '-i',
    '/movie.bik',
    '-frames:v',
    String(count),
    '-an',
    '-pix_fmt',
    'rgba',
    '-f',
    'rawvideo',
    '/frames'
  );
  core.reset();
  assert.equal(result, 0, errors.join('\n'));
  const pixels = Buffer.concat(output);
  assert.equal(pixels.length, header.width * header.height * 4 * count);
  return { pixels, ms: performance.now() - before };
};
const count = Math.min(32, header.frames),
  sequential = decode(0, count),
  index = count - 1,
  seek = decode(index, 1),
  frameBytes = header.width * header.height * 4;
assert.deepEqual(
  seek.pixels,
  sequential.pixels.subarray(index * frameBytes, (index + 1) * frameBytes),
  'Chunk seeks must reproduce sequential Bink frames exactly'
);
assert(!sequential.pixels.subarray(0, frameBytes).equals(seek.pixels), 'Original movie must advance');
let transparent = 0,
  opaque = 0;
for (let i = 3; i < seek.pixels.length; i += 4) {
  if (seek.pixels[i] === 0) transparent++;
  if (seek.pixels[i] > 200) opaque++;
}
assert(transparent > 0 && opaque > 0, 'Hologram keeps original transparent background and visible figure');
globalThis.Worker = class {
  postMessage() {}
  terminate() {}
};
globalThis.ImageData = class {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};
const canvas = { dataset: {}, getContext: () => ({ putImageData() {}, clearRect() {} }) };
let ended = 0;
const player = new BinkPlayer(canvas, { onEnd: () => ended++ });
const frame = (id, index) => player.message({ type: 'frame', id, index, pixels: new Uint8Array([0, 0, 0, 0]).buffer });
await player.play(buffer);
const first = player.id;
player.message({ type: 'ready', id: first });
for (let i = 0; i < Math.min(header.frames, 60); i++) frame(first, i);
player.update(1);
assert.equal(player.frame, 30, 'Native 30 fps overrides the 15 fps Pestage header');
player.setPaused(true);
player.update(5);
assert.equal(player.clock, 1);
player.setPaused(false);
player.update(5);
assert.equal(player.clock, 1, 'Resume excludes time spent paused');
assert(player.frames.size <= player.chunk * 2, 'Only two chunks survive playback advancement');
player.update(header.frames / 30);
assert.equal(ended, 1);
assert.equal(player.playing, false);
assert.equal(player.frames.size, 0);
await player.play(buffer, { loop: true });
const second = player.id;
player.message({ type: 'ready', id: second });
frame(second, 0);
player.update(header.frames / 30);
assert.equal(player.playing, true);
assert.equal(player.frame, 0);
assert.equal(ended, 1);
frame(first, 80);
assert(!player.frames.has(80), 'Replaced movie decode responses cannot reappear');
player.stop();
frame(second, 1);
assert.equal(player.frames.size, 0);
player.dispose();
console.log(
  JSON.stringify({
    movie: movie.attrs.Name,
    ...header,
    nativeSeconds: header.frames / 30,
    chunkFrames: binkChunkSize(header),
    seekMilliseconds: seek.ms,
    transparentPixels: transparent,
    visiblePixels: opaque,
    result: 'Exact chunk seek, animated RGBA and bounded frame buffers passed'
  })
);
