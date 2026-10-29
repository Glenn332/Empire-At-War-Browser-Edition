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
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { summaryRows, bountyLine, fillSummary } = await import('../public/js/game/summary.js');

const types = [...db.types.values()];
const costly = types.filter(t => t.num('Score_Cost_Credits', 0) >= 1),
  free = types.filter(t => t.num('Score_Cost_Credits', 0) < 1);
const hero = costly.find(t => [...t.categories()].some(c => c.includes('HERO'))),
  plain = costly.filter(t => ![...t.categories()].some(c => c.includes('HERO')));
assert(hero && plain.length > 3 && free.length, 'the data has heroes, ordinary types and types without a score cost');

const later = plain[3],
  earlier = plain[1];
const rows = summaryRows(
  new Map([
    [later, 2],
    [free[0], 5],
    [hero, 1],
    [earlier, 7]
  ])
);
assert.deepEqual(
  rows.units.map(r => r[0]),
  [earlier, later],
  'ordinary types in the order of the type records, not by count'
);
assert.deepEqual(
  rows.units.map(r => r[1]),
  [7, 2]
);
assert.deepEqual(rows.heroes, [[hero, 1]]);
assert.deepEqual(summaryRows(null), { heroes: [], units: [] });

assert.equal(bountyLine(0, false), null);
assert.equal(bountyLine(undefined, false), null);
assert.match(bountyLine(250, false), /250/);
assert.doesNotMatch(bountyLine(250, false), /%d/);
assert.match(bountyLine(0, true), /0/);
const collectors = [...(db.factions?.values?.() ?? [])].filter(f => f.bool('Benefits_From_Corruption'));
console.log('factions that benefit from corruption:', collectors.map(f => f.name).join(', ') || '(none listed)');

const ctl = new Map(),
  log = { text: new Map(), caption: new Map(), shown: new Map() };
for (const side of ['YOUR', 'ENEMY']) {
  for (let i = 0; i < 12; i++) {
    ctl.set(`IDC_${side}_UNIT${i}`, { style: {} });
    ctl.set(`IDC_${side}_UNIT_NAME${i}`, { style: {} });
  }
  for (let i = 0; i < 5; i++) ctl.set(`IDC_${side}_HERO${i}`, { style: {} });
}
for (const id of ['IDC_TIME_STATIC']) ctl.set(id, { style: {} });
const dlg = {
  def: { controls: [] },
  ctl: id => ctl.get(id) || null,
  setText: (id, t) => log.text.set(id, t),
  setImage() {},
  imageFrame() {},
  show: (id, on) => log.shown.set(id, on),
  imageText: (id, t) => log.caption.set(id, t),
  scroll() {}
};
fillSummary(dlg, {
  title: 't',
  time: 'x',
  planet: 'p',
  yours: new Map([
    [later, 2],
    [earlier, 1],
    [hero, 3]
  ]),
  enemy: new Map(),
  bounty: 0,
  collects: false
});
assert.equal(log.shown.get('IDC_STATIC_BOUNTY'), false, 'no bounty, no line');
assert.equal(log.caption.get('IDC_YOUR_UNIT0'), '', 'a single loss has no count');
assert.equal(log.caption.get('IDC_YOUR_UNIT1'), '2', 'two losses: the count on the picture');
assert.equal(log.caption.get('IDC_YOUR_HERO0'), '3');
assert.equal(log.text.get('IDC_YOUR_UNIT_NAME1'), db.t(later.str('Text_ID')) || later.name, 'the name carries no count');
assert.equal(log.shown.get('IDC_YOUR_UNIT2'), false);
assert.equal(log.shown.get('IDC_ENEMY_UNIT0'), false);
fillSummary(dlg, { title: 't', time: 'x', planet: 'p', yours: new Map(), enemy: new Map(), bounty: 120, collects: false });
assert.equal(log.shown.get('IDC_STATIC_BOUNTY'), true);
assert.match(log.text.get('IDC_STATIC_BOUNTY'), /120/);
console.log('ok');
