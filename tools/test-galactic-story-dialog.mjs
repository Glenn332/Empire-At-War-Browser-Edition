import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, ''))),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { GalacticStoryDialog, parseStoryDialog, storyDialogEntry, storyDialogLines, storySummaryHeader, storySummaryColors } = await import(
  '../public/js/game/galacticstorydialog.js'
);
const read = async path => {
  const response = await fetch('asset/' + path);
  assert(response.ok, path);
  return response.text();
};

let refreshed = 0,
  closed = 0;
const active = { open: true, summary: true, summaryTab: true, refreshSummary: async () => refreshed++, close: () => closed++ };
await GalacticStoryDialog.prototype.showSummary.call(active, { id: 7 });
assert.equal(refreshed, 1);
assert.equal(closed, 0);
assert.equal(active.summaryTab, true);
await GalacticStoryDialog.prototype.showSummary.call(active);
assert.equal(closed, 1);
const records = [3, 1, 2].map(id => ({ id, name: 'Dialog_E_Sandbox_Intro', chapter: 0, completed: false, entries: [] }));
let chosen;
const summaryState = {
  open: true,
  summary: true,
  summaryTab: false,
  refreshGeneration: 0,
  summaryRowsOrder: [1, 2],
  summarySelected: 2,
  game: { story: { storyGoals: records } },
  dialog: {
    list: (id, rows, pick) => ({ select: key => pick((typeof rows === 'function' ? rows() : rows).find(row => row.key === key)) })
  },
  selectSummary: row => {
    chosen = row.key;
  }
};
await GalacticStoryDialog.prototype.refreshSummary.call(summaryState);
assert.equal(chosen, 1, 'Native incoming insertion preserves numeric row index, not record identity');
await GalacticStoryDialog.prototype.refreshSummary.call(summaryState, { id: 2 });
assert.equal(chosen, 2, 'Initial preferred record selection remains available');

const intro = await read('Data/Scripts/Story/Dialog_E_Sandbox_Intro.txt');
const chapter0 = parseStoryDialog(intro, 0),
  chapter1 = parseStoryDialog(intro, 1);
assert(chapter0.length && chapter1.length);
assert(chapter0.some(c => c.op === 'EXTRA_TEXT'));
assert(chapter0.some(c => c.op === 'WAIT' && c.value === 'SPEECH'));
assert(!chapter0.some(c => c.op === 'MOVIE'), 'Commented native commands stay inactive');
assert.notDeepEqual(chapter0, chapter1, 'Only the requested native chapter is selected');
assert.deepEqual(parseStoryDialog(intro, 99999), []);
assert.deepEqual(
  storySummaryHeader([
    { op: 'TEXTCOLOR', value: '80 90 100 255' },
    { op: 'TEXT', value: 'Message title' },
    { op: 'TEXTCOLOR', value: '0 0 0 0' },
    { op: 'TEXT', value: 'Body' }
  ]),
  { title: 'Message title', color: [80, 90, 100, 255] }
);
assert.deepEqual(storySummaryColors([255, 255, 0, 255], { read: true }), { top: [168, 168, 0, 168], bottom: [172, 172, 255, 255] });
assert.deepEqual(storySummaryColors([255, 255, 255, 176], { read: false }), { top: [255, 255, 255, 176], bottom: [255, 255, 255, 176] });
assert.deepEqual(storySummaryColors([255, 255, 255, 176], { read: true, completed: true }), {
  top: [168, 168, 168, 116],
  bottom: [168, 168, 168, 116]
});
const extra = { text: 'Extra %s: %d%%', params: ['entry', 7] },
  introLines = storyDialogLines(chapter0, [extra]);
assert(introLines.some(line => line.text === 'Extra entry: 7%'));
assert(introLines.some(line => line.color.join() === '255,24,39,255'));
for (const c of chapter0.filter(c => c.op === 'TEXT' && db.text.has(c.value.toUpperCase())))
  assert(
    introLines.some(line => line.text === db.t(c.value)),
    c.value
  );

db.text.set('TEXT_STORY_DIALOG_TEST_FORMAT', '%s / %d / %2$s / %%');
db.text.set('TEXT_STORY_DIALOG_TEST_VARIABLE', 'Variable: %s');
assert.equal(storyDialogEntry({ text: 'TEXT_STORY_DIALOG_TEST_FORMAT', params: ['First', 5] }), 'First / 5 / 5 / %');
const type = [...db.types.values()].find(type => type.str('Text_ID') && db.text.has(type.str('Text_ID').toUpperCase()));
assert(type);
assert.equal(storyDialogEntry({ text: '%s', params: [type] }), db.t(type.str('Text_ID')));
assert.equal(storyDialogEntry({ text: '%s', params: [{ __type: type, __name: type.name }] }), db.t(type.str('Text_ID')));
assert.equal(storyDialogEntry({ text: '%s', params: [{ type }] }), db.t(type.str('Text_ID')));
assert.equal(storyDialogEntry({ text: '%s', params: [{ name: {} }] }), '');
const fixture = parseStoryDialog(
  `
// comment
[CHAPTER 0]
TEXTCOLOR 10 20 30 40
TEXT discarded
NEWLINE 2
CLEARTEXT
TEXTCOLOR 80 90 100 110
EXTRA_TEXT
TEXT TEXT_STORY_DIALOG_TEST_VARIABLE
[CHAPTER 1]
TEXT wrong chapter
`,
  0
);
assert.deepEqual(storyDialogLines(fixture, [extra], 'active'), [
  { text: 'Extra entry: 7%', color: [80, 90, 100, 110] },
  { text: 'Variable: active', color: [80, 90, 100, 110] }
]);
assert.deepEqual(storyDialogLines([{ op: 'NEWLINE', value: '2' }]), [
  { text: ' ', color: [255, 255, 255, 255] },
  { text: ' ', color: [255, 255, 255, 255] }
]);
db.text.delete('TEXT_STORY_DIALOG_TEST_FORMAT');
db.text.delete('TEXT_STORY_DIALOG_TEST_VARIABLE');

const docs = [];
if (mod >= 0)
  for (const [name, minimum] of [
    ['Documentation_TiersAndTraits', 600],
    ['Documentation_StoryOverview', 100]
  ]) {
    const commands = parseStoryDialog(await read(`Data/Scripts/Story/${name}.txt`), 0),
      lines = storyDialogLines(commands);
    assert(lines.length >= minimum, `${name}: native content was retained`);
    for (const c of commands.filter(c => c.op === 'TEXT')) {
      assert(db.text.has(c.value.toUpperCase()), `${name}: localized text ${c.value}`);
      assert(
        lines.some(line => line.text === db.t(c.value)),
        `${name}: ${c.value}`
      );
    }
    assert(
      lines.some(line => line.color[0] !== line.color[1] || line.color[1] !== line.color[2]),
      `${name}: per-row colors`
    );
    docs.push({ name, commands: commands.length, rows: lines.length });
  }
if (mod >= 0) {
  const generated = parseStoryDialog(await read('Data/Scripts/Story/Dialog_Government_Display.txt'), 0);
  assert(generated.some(c => c.op === 'EXTRA_TEXT'));
  assert(storyDialogLines(generated, [extra]).some(line => line.text === 'Extra entry: 7%'));
}
const rc = await read('Data/Resources/GUIDialog/GUIDialogs.rc'),
  native = rc.match(/IDD_STORY_DIALOG\s+DIALOG[\s\S]*?\r?\nEND/)?.[0];
assert(native);
for (const id of ['IDC_STORY_TEXT', 'IDC_STATIC', 'IDC_STORY_DIALOG_CLOSE_BUTTON', 'IDC_STORY_DIALOG_ACCEPT', 'IDC_STORY_DIALOG_CANCEL'])
  assert(native.includes(id), id);
const summary = rc.match(/IDD_STORY_SUMMARY_DIALOG\s+DIALOG[\s\S]*?\r?\nEND/)?.[0];
assert(summary);
for (const id of ['IDC_GOAL_LIST', 'IDC_STORY_RECAP', 'IDC_RADIO_ACTIVE', 'IDC_RADIO_COMPLETED', 'IDC_SUMMARY_DIALOG_CLOSE_BUTTON'])
  assert(summary.includes(id), id);
console.log(
  JSON.stringify({
    mod: mod >= 0,
    introCommands: chapter0.length,
    docs,
    result: 'native chapters, localized content, generated text, reset commands, row colors and RC controls passed'
  })
);
