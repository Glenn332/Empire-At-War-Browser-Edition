import assert from 'node:assert/strict';
import {
  LANGUAGES,
  languageId,
  resolveLanguageText,
  activeLanguage,
  textFile,
  onLanguageChange,
  languageRevision
} from '../public/js/language.js';
import { fontPolicy, fontPixels, stretchedFontHeight } from '../public/js/fontpolicy.js';
import { dialogFontPixels } from '../public/js/game/dialogtext.js';
import { loadNativeFont, nativeFont, prepareComponentFonts } from '../public/js/nativefont.js';
import { fontFamily } from '../public/js/fonts.js';
import { loadGameData, db, switchLanguage } from '../public/js/gamedata.js';

assert.equal(LANGUAGES.length, 11);
for (const [id, name] of LANGUAGES.entries()) {
  assert.equal(languageId(name.toLowerCase()), id);
  assert.equal(languageId(String(id)), id);
  const forced = id === 5 || id === 8,
    excluded = id >= 5;
  assert.equal(fontPolicy('EmpireAtWar-Medium', id).face, forced ? 'Arial' : 'EmpireAtWar-Medium');
  assert.equal(fontPolicy('Arial Unicode MS', id).face, excluded ? 'Arial' : 'Arial Unicode MS');
  assert.equal(fontPolicy('EmpireAtWar', id).face, excluded ? 'Arial' : 'EmpireAtWar');
  assert.equal(fontPolicy('empireatwar', id).face, forced ? 'Arial' : 'empireatwar', 'Native exclusions are case-sensitive');
  assert.equal(fontPolicy('A Mod Font', id).face, forced ? 'Arial' : 'A Mod Font');
  assert.equal(fontPolicy('A Mod Font', id).charset, 0);
  for (const height of [480, 600, 768, 1080, 2160])
    for (const size of [4, 6, 7, 12, 20]) {
      const authored = id === 8 ? Math.max(7, size) : size;
      const dpi = Math.trunc(Math.fround(Math.fround(height * 96) * Math.fround(0.0016666667)));
      assert.equal(fontPixels(height, size, id), Math.max(1, Math.trunc((dpi * authored) / 72)));
      assert.equal(fontPixels(height, size, id, true), authored, 'Russian clamp precedes pixel-mode selection');
    }
}
for (const invalid of [-1, 11, 'unknown', '']) assert.equal(languageId(invalid), null);
assert.equal(fontPolicy('Example', 5, { platform: 2, major: 5, minor: 0 }).charset, 128);
for (const windows of [
  null,
  { platform: 2, major: 5, minor: 1 },
  { platform: 2, major: 10, minor: 0 },
  { platform: 1, major: 5, minor: 0 }
])
  assert.equal(fontPolicy('Example', 5, windows).charset, 0);
assert.equal(fontPolicy('Example', 8, { platform: 2, major: 5, minor: 0 }).charset, 0);
for (const stretch of [1, 0.99995, 1.00005]) assert.equal(stretchedFontHeight(18, stretch), 18);
assert.equal(stretchedFontHeight(18, 1.2), 22);

const probe = async (requested, available) => {
  const calls = [],
    result = await resolveLanguageText(async path => {
      const id = LANGUAGES.findIndex((_, i) => path === textFile(i));
      calls.push(id);
      return available.includes(id) ? new Uint8Array([id]).buffer : null;
    }, requested);
  return { calls, result };
};
assert.deepEqual((await probe(8, [0, 8])).calls, [8]);
assert.equal((await probe(8, [0])).result.language, 0);
assert.deepEqual((await probe(8, [3, 4])).calls, [8, 0, 1, 2, 3]);
assert.equal((await probe(8, [])).result.language, 8);
assert.equal((await probe(8, [])).result.bytes, null);

const key = Buffer.from('TEXT_TEST'),
  value = Buffer.from('Привет 世界', 'utf16le'),
  dat = Buffer.alloc(16 + key.length + value.length);
dat.writeUInt32LE(1);
dat.writeUInt32LE(value.length / 2, 8);
dat.writeUInt32LE(key.length, 12);
value.copy(dat, 16);
key.copy(dat, 16 + value.length);
const requests = [];
globalThis.fetch = async input => {
  const path = decodeURIComponent(String(input).replace(/^asset\//, ''));
  requests.push(path);
  if (path === textFile(8)) return new Response(dat);
  if (path === textFile(0)) return new Response(dat);
  if (path === textFile(1)) return new Response(new Uint8Array([255, 255, 255, 255]));
  if (path === 'Data/XML/GameConstants.xml') return new Response('<Root><GameConstants/></Root>');
  if (path.startsWith('Data/Fonts/Raster/'))
    return new Response(
      JSON.stringify({
        height: 10,
        ascent: 8,
        face: path.includes('Arial') ? 'Arial' : 'EmpireAtWar-Medium',
        widths: Array(256).fill(5),
        offsets: Array(256).fill(0),
        mask: Buffer.alloc(50, 255).toString('base64')
      })
    );
  return new Response(null, { status: 404 });
};
db.text.set('ENGLISH_ONLY', 'must not leak');
await loadGameData(undefined, { language: 'Russian' });
assert.equal(activeLanguage, 8);
assert.equal(db.text.get('TEXT_TEST'), 'Привет 世界');
assert(!db.text.has('ENGLISH_ONLY'));
assert.equal(dialogFontPixels(600, 6), 9);
assert.equal(fontFamily('EmpireAtWar-Medium'), 'Arial, Helvetica, sans-serif');
const russian = await loadNativeFont('EmpireAtWar-Medium', 9, 1, true);
await russian.ensure('Привет 世界');
assert.equal(russian.face, 'Arial');
assert.strictEqual(nativeFont('Other Mod Face', 9, 1, true), russian, 'Substituted faces share actual glyph assets');
assert(requests.some(p => p.includes('Arial~9~') && p.endsWith('~4~b1.json')));
assert(requests.some(p => p.includes('Arial~9~') && p.endsWith('~78~b1.json')));
await prepareComponentFonts(new Map([['test', { val: () => 'Mod Display Face', num: () => 6 }]]), 600);
assert(!requests.some(p => p.includes('Mod Display Face')), 'Component preload uses the same localized point and face policy');
globalThis.location = { search: '?language=English' };
await loadGameData();
assert.equal(activeLanguage, 0, 'Browser query selects the text and font language');
delete globalThis.location;
await loadGameData(undefined, { language: 'Japanese' });
assert.equal(activeLanguage, 0, 'Missing requested DAT resolves font language to English too');
const english = await loadNativeFont('EmpireAtWar-Medium', 9, 1, true);
assert.notStrictEqual(english, russian, 'A language substitution cannot contaminate another face cache');
assert.equal(dialogFontPixels(600, 6), 8);
const table = db.text,
  events = [],
  stops = [0, 1, 2].map(phase =>
    onLanguageChange(async change => {
      await Promise.resolve();
      events.push([phase, change.language, activeLanguage]);
    }, phase)
  );
const revision = languageRevision;
assert.deepEqual(await Promise.all([switchLanguage('Russian'), switchLanguage('English'), switchLanguage('French')]), [8, 0, 0]);
assert.deepEqual(
  events,
  [
    [0, 8, 8],
    [1, 8, 8],
    [2, 8, 8],
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0]
  ],
  'Concurrent switches serialize table/font/layout refreshes, including same resolved language'
);
assert.strictEqual(db.text, table);
assert.equal(languageRevision, revision + 3);
const before = [...db.text];
await assert.rejects(switchLanguage('German'));
assert.deepEqual([...db.text], before);
assert.equal(activeLanguage, 0, 'Malformed DAT must not partially publish a new context');
await assert.rejects(switchLanguage('invalid'), RangeError);
let completed = false;
const failing = onLanguageChange(() => {
    throw new Error('fixture');
  }, 0),
  last = onLanguageChange(() => {
    completed = true;
  }, 2);
await assert.rejects(switchLanguage('English'), AggregateError);
assert(completed, 'One failed view cannot prevent other panels refreshing');
failing();
last();
await switchLanguage('Russian');
assert.equal(activeLanguage, 8, 'The queue recovers from failed loads or callbacks');
for (const stop of stops) stop();
await switchLanguage('English');
console.log(
  'All 11 native language policies, size conversion, DAT fallback, translated database, component preload and Unicode pages passed'
);
