// server.mjs rasterises font pages on request: what a caller asks for is bounded (faces, sizes, memory).
// The GDI worker is stood in for, so this runs anywhere.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NativeFonts } from './native-fonts.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-font-test-'));
const nf = new NativeFonts({ index: new Map() });
let asked = 0;
nf.start = async () => {};
nf.directory = dir;
nf.alias.set('EMPIREATWAR-MEDIUM', null);
nf.request = async v => (asked++, { face: v.face, mask: Buffer.from('x').toString('base64') });
const name = (face, height = 16, stretch = 1000, page = 0) =>
  `Data/Fonts/Raster/${encodeURIComponent(face)}~${height}~${stretch}~${page}.json`;

assert.equal(await nf.asset(name('Arial', 16, 9000)), null, 'a stretch past 8x is refused');
assert.equal(await nf.asset(name('Arial', 300)), null, 'a height past 256 is refused');
assert.equal(await nf.asset(name('a/b')), null, 'a face with a path in it is refused');
assert.equal(await nf.asset(name('x'.repeat(65))), null, 'a long face is refused');
assert.equal(asked, 0);

assert.ok(await nf.asset(name('EmpireAtWar-Medium')), "the game's own face");
for (let i = 0; i < 16; i++) assert.ok(await nf.asset(name('System Face ' + i)), 'a few other faces');
assert.equal(await nf.asset(name('Made Up Face')), null, 'but not any number of made-up ones');
assert.ok(await nf.asset(name('EmpireAtWar-Medium', 20)), "the game's faces still work after that");

for (let h = 1; h <= 256; h++) await nf.asset(name('EmpireAtWar-Medium', h, 1000, 1));
assert.ok(nf.pending.size <= 256, 'pages kept in memory are bounded: ' + nf.pending.size);
const before = asked;
await nf.asset(name('EmpireAtWar-Medium', 1, 1000, 0));
assert.equal(asked, before + 1);
nf.pending.clear();
await nf.asset(name('EmpireAtWar-Medium', 1, 1000, 0));
assert.equal(asked, before + 1, 'a page dropped from memory comes back from the disk cache');
fs.rmSync(dir, { recursive: true, force: true });
console.log('native font limits ok');
