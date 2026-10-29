import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

const mod = process.argv.indexOf('--mod'),
  archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, ''))),
    b = key && archive.read(key);
  return new Response(b ? new Uint8Array(b) : null, { status: b ? 200 : 404 });
};
const { db, ObjType, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { parseXML } = await import('../public/js/xml.js');
const { loadALO } = await import('../public/js/alo.js');
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy } = await import('../public/js/game/galaxy.js');
const {
  appendLog,
  logRows,
  logLegend,
  advisorHints,
  historyFactions,
  sampleHistory,
  updateHistory,
  historyChart,
  summaryEconomy,
  summaryPopulation,
  summaryFleetRows,
  techTreeDialog,
  nativeRound
} = await import('../public/js/game/galacticlogdata.js');
const { historyLabels } = await import('../public/js/game/galactichistory.js');
const { renderTechTree } = await import('../public/js/game/galactictechtree.js');
const { GalacticLog } = await import('../public/js/game/galacticlog.js');
const { encyclopediaLines } = await import('../public/js/game/galacticencyclopedia.js');
const { encyclopediaAbilityIcons } = await import('../public/js/game/nativeabilityicons.js');
const data = await loadCampaignData(),
  campaign = data.campaigns.get(mod < 0 ? 'SANDBOX_EQUAL_FOOTING_EMPIRE' : 'KNOWNSMALL_ERA_1_EMPIRE');
assert(campaign);
const g = startingGalaxy(data, campaign),
  me = g.active,
  player = g.players.find(p => p.faction === me);

for (const p of g.players) {
  assert.deepEqual(p.advisorHints, { Galactic: true, Space: true, Land: true });
  assert.equal(p.advisorHintIndex, 0);
  assert.equal(p.advisorHintFrame, 90);
}
assert.equal(new Set(g.players.map(p => p.advisorHints)).size, g.players.length, 'Hint flags are independent per player');
const unopened = snapshotGalaxy(g),
  unopenedRestore = startingGalaxy(data, campaign);
applyGalaxy(unopenedRestore, JSON.parse(JSON.stringify(unopened)));
assert.deepEqual(snapshotGalaxy(unopenedRestore), unopened, 'An untouched campaign round-trips before any lazy UI initialization');
const legacy = structuredClone(unopened);
delete legacy.players[0].advisorHints;
delete legacy.players[0].advisorHintIndex;
delete legacy.players[0].advisorHintFrame;
const legacyRestore = startingGalaxy(data, campaign);
applyGalaxy(legacyRestore, legacy);
assert.deepEqual(legacyRestore.players[0].advisorHints, { Galactic: true, Space: true, Land: true });
assert.equal(legacyRestore.players[0].advisorHintIndex, 0);
assert.equal(legacyRestore.players[0].advisorHintFrame, 90);
legacy.players[0].advisorHints = { Space: false };
legacy.players[0].advisorHintFrame = 0;
applyGalaxy(legacyRestore, legacy);
assert.deepEqual(
  legacyRestore.players[0].advisorHints,
  { Galactic: true, Space: false, Land: true },
  'Missing legacy modes get defaults without enabling an explicitly disabled mode'
);
assert.equal(legacyRestore.players[0].advisorHintFrame, 0);
delete legacyRestore.players[0].advisorHints;
const canonical = snapshotGalaxy(legacyRestore);
assert.equal(legacyRestore.players[0].advisorHints, undefined, 'Snapshot compatibility does not mutate live state');
assert.deepEqual(canonical.players[0].advisorHints, { Galactic: true, Space: true, Land: true });
const copyProbe = snapshotGalaxy(g);
copyProbe.players[0].advisorHints.Space = false;
assert.equal(g.players[0].advisorHints.Space, true, 'Snapshot flags do not alias live player state');

g.fiscal = { cycle: 4, previous: 0, next: 45 };
const record = appendLog(g, 'A long original message', [21, 42, 63, 255]);
assert.equal(record.heading, db.t('TEXT_LOG_CYCLE_01').replace('##0', '4'));
const rows = logRows(g);
assert.equal(rows.length, 3);
assert.equal(rows[0].wrap, false);
assert.equal(rows[1].wrap, true);
assert.equal(rows[1].color, 'rgba(21,42,63,1)');
assert.equal(rows[2].text, db.t('TEXT_HELP_SEPERATOR'));
g.log.ui = { page: 2, metric: 'military', techSpace: true };
assert.equal(
  logLegend().length,
  Math.min(db.constants.list('Planet_Ability_Text_IDs').length, db.constants.list('Planet_Ability_Icon_Names').length)
);
assert(logLegend().every(r => r.color.length === 3));
assert.deepEqual(advisorHints(player), { Galactic: true, Space: true, Land: true });
player.advisorHints.Space = false;
player.advisorHints.Galactic = false;
player.advisorHints.Land = false;
player.advisorHintIndex = 3;
player.advisorHintFrame = 500;
const saved = snapshotGalaxy(g),
  restored = startingGalaxy(data, campaign);
applyGalaxy(restored, saved);
assert.deepEqual(restored.log, g.log);
assert.deepEqual(restored.players.find(p => p.faction === me).advisorHints, player.advisorHints);
assert.equal(restored.players.find(p => p.faction === me).advisorHintFrame, 500);
assert.equal(restored.players.find(p => p.faction === me).advisorHintIndex, 3);
assert.notStrictEqual(
  restored.players.find(p => p.faction === me).advisorHints,
  player.advisorHints,
  'Restored flags are not shared with live or saved state'
);
assert.notStrictEqual(restored.players.find(p => p.faction === me).advisorHints, saved.players.find(p => p.faction === me).advisorHints);
player.advisorHints.Galactic = player.advisorHints.Land = true;
const restoredUI = new GalacticLog({ galaxy: restored });
assert.equal(restoredUI.page, 2);
assert.equal(restoredUI.historyMetric, 'military');
assert.equal(restoredUI.techSpace, true);

g.log.history = {};
g.log.historyFrame = undefined;
g.time = 1;
updateHistory(g);
assert.deepEqual(
  g.log.history[me].map(r => r.frame),
  [0, 1, 2, 30]
);
assert.equal(g.log.history[me][0].economy, Math.fround(player.credits));
assert.deepEqual(
  historyFactions(g).map(p => p.faction.toUpperCase()),
  ['Good_Side_Name', 'Evil_Side_Name', 'Corrupt_Side_Name']
    .map(k => db.constants.str(k).toUpperCase())
    .filter(n => g.players.some(p => p.faction.toUpperCase() === n))
);
assert.equal(historyChart(g, 'planets').maximum, g.planets.filter(p => !p.background).length);
assert.equal(historyChart(g, 'tech').maximum, 5);
for (let i = 2; i < 102; i++) sampleHistory(g, i * 30);
assert(g.log.history[me].length < 100);
assert.equal(g.log.history[me][1].frame, 16, 'Native history coalesces adjacent sample pairs');
assert.equal(new Set(historyLabels([0, 0, 0], 0.03).map(p => p.y)).size, 3);
const closeTo = (actual, expected) => assert(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const separated = historyLabels([0.98, 0.95, 0.9], 0.1);
[0.95, 0.85, 0.9].forEach((y, i) => closeTo(separated[i].y, y));
closeTo(historyLabels([0.5], 0.1, 768)[0].y, (384 - 0.5) / 768);
const nativeHeight = 81 / 1244,
  requestedHeight = 66 / 1244;
assert(historyLabels([0.5, 0.5, 0.5], nativeHeight).at(0).y > historyLabels([0.5, 0.5, 0.5], requestedHeight).at(0).y);
assert.deepEqual(encyclopediaLines('alpha beta gamma', 11), ['alpha', 'beta gamma']);
assert.deepEqual(encyclopediaLines('abcdefghij', 5), ['abcd', 'efgh', 'ij']);
assert.deepEqual(encyclopediaLines('A\\nB', 41), ['A\\nB']);
assert.deepEqual(encyclopediaLines('x'.repeat(1025), 41), []);

const type = (name, fields) => {
  const t = new ObjType('Test', name);
  for (const [k, v] of Object.entries(fields)) t.props.set(k.toLowerCase(), [String(v)]);
  return t;
};
const abilityType = type('TEST_ABILITIES', {}),
  abilities = parseXML(
    '<Unit_Abilities_Data><Unit_Ability><Type>JET_PACK</Type></Unit_Ability><Unit_Ability><Type>JET_PACK</Type><Alternate_Icon_Name>mod_icon.tga</Alternate_Icon_Name></Unit_Ability><Unit_Ability><Type>JET_PACK</Type></Unit_Ability><Unit_Ability><Type>HARASS</Type></Unit_Ability><Unit_Ability><Type>UNKNOWN</Type></Unit_Ability></Unit_Abilities_Data>'
  ).children[0];
abilityType.subs.set('unit_abilities_data', [abilities]);
assert.deepEqual(encyclopediaAbilityIcons(abilityType), ['i_sa_jetpack_jump.tga', 'mod_icon.tga', 'i_sa_jetpack_jump.tga', '']);
const bonus = parseXML(
  '<Abilities><Planet_Income_Bonus_Ability><Percentage_Income_Modifier>0.25</Percentage_Income_Modifier><Absolute_Income_Modifier>1</Absolute_Income_Modifier></Planet_Income_Bonus_Ability></Abilities>'
).children[0];
const mine = type('TEST_MINE', { Behavior: 'DUMMY_GROUND_STRUCTURE', Icon_Name: 'mine.tga', Additional_Population_Capacity: 2 });
mine.subs.set('abilities', [bonus]);
const hero = type('TEST_HERO', { Behavior: 'HERO', Icon_Name: 'hero.tga', Is_Named_Hero: true });
hero.subs.set('abilities', [bonus]);
const pt = type('TEST_PLANET', { Planet_Credit_Value: 10, Additional_Population_Capacity: 3 }),
  p = {
    index: 0,
    owner: me,
    type: pt,
    groundStructures: [{ owner: me, type: mine }],
    orbitalStructures: [],
    garrison: [{ owner: me, type: hero }],
    production: { ground: [], space: [] }
  };
const fixture = {
  players: [player],
  planets: [p, { index: 1, owner: me }],
  routes: [{ a: 0, b: 1, type: type('TEST_ROUTE', { Credit_Gain_Factor: 0.25 }) }],
  fleets: []
};
assert.deepEqual(summaryEconomy(fixture, p), { base: 10, routes: 3, mining: 4, count: 1, icon: 'mine.tga', source: mine, total: 17 });
assert.equal(summaryPopulation(p, me), 5);
assert.equal(nativeRound(-2.5), -3);

const leaf = type('TEST_LEAF', { AI_Combat_Power: 7, Icon_Name: 'leaf.tga' }),
  company = type('TEST_COMPANY', { Company_Units: 'TEST_LEAF TEST_LEAF TEST_LEAF', AI_Combat_Power: 999, Icon_Name: 'company.tga' });
db.types.set('TEST_LEAF', leaf);
db.types.set('TEST_COMPANY', company);
const empty = { ...p, index: 1, garrison: [], groundStructures: [] };
p.garrison = [
  { owner: me, type: company },
  { owner: me, type: company },
  { owner: me, type: hero }
];
fixture.routes = [];
fixture.planets = [p, empty];
fixture.fleets = [{ owner: me, planet: 0, slot: 2, units: [{ type: leaf }] }];
const fleets = summaryFleetRows(fixture, fixture.planets, me);
assert.deepEqual(
  fleets.map(r => r.kind),
  [0, 3, -1]
);
assert.equal(fleets[0].icons[0].type, hero);
assert.equal(fleets[0].icons[1].count, 2);
assert(fleets[0].first && !fleets[1].first && fleets[2].first);
p.garrison = [{ owner: me, type: company }];
p.groundStructures = [];
empty.groundStructures = [];
empty.orbitalStructures = [];
fixture.fleets = [];
fixture.log = null;
sampleHistory(fixture, 0);
assert.equal(fixture.log.history[me][0].military, 42, 'Every constituent occurrence supplies power, overriding the company field');
db.types.delete('TEST_LEAF');
db.types.delete('TEST_COMPANY');

const played = [],
  game = { galaxy: g, me, paused: true, audio: { play: s => played.push(s) } },
  log = new GalacticLog(game);
const before = g.log.messages.length;
log.message('normal', { urgent: false });
log.message('urgent A');
log.message('urgent B');
assert.equal(g.log.messages.length, before);
log.update(0);
assert.equal(g.log.messages.at(-1).text, 'urgent B');
assert.equal(played.at(-1), db.faction(me).str('SFXEvent_HUD_Advisor_Urgent'));
log.update(1000);
assert.equal(g.log.messages.at(-1).text, 'urgent A');
log.update(1000);
assert.equal(g.log.messages.at(-1).text, 'normal');
assert.equal(played.at(-1), db.faction(me).str('SFXEvent_HUD_Advisor_Message'));
const hints = db.faction(me).list('Galactic_Advisor_Hints');
if (hints.length) {
  player.advisorHintIndex = 0;
  player.advisorHintFrame = 90;
  game.paused = false;
  g.time = 3;
  log.update(1000);
  assert.equal(g.log.messages.at(-1).text, db.t(hints[0]));
  assert.equal(player.advisorHintIndex, 1 % hints.length);
  assert.equal(player.advisorHintFrame, 90 + Math.round(30 * db.constants.num('Advisor_Hint_Interval', 300)));
  assert.deepEqual(g.log.messages.at(-1).color, [0, 193, 91]);
  const n = g.log.messages.length;
  player.advisorHintFrame = 0;
  player.advisorHints.Galactic = false;
  log.update(1000);
  assert.equal(g.log.messages.length, n);
}

const rc = await (await fetch('asset/Data/Resources/GUIDialog/GUIDialogs.rc')).text();
for (const id of [
  'IDD_DROID_LOG',
  'IDD_DATA_CHART',
  'IDD_SUMMARY_SCREEN_PRODUCTION',
  'IDD_SUMMARY_SCREEN_FLEETS',
  'IDD_SUMMARY_SCREEN_ECONOMY'
])
  assert(rc.includes(id));
const allControls = new Map();
let treeIcons = 0,
  lockedIcons = 0;
for (const faction of g.players.filter(p => db.faction(p.faction).bool('Is_Playable')))
  for (const space of [false, true]) {
    const id = techTreeDialog(faction.faction, space),
      layout = rc.match(new RegExp('^' + id + '\\s+DIALOG[\\s\\S]*?^END', 'm'))?.[0];
    if (!layout) continue;
    const ctls = new Map([...layout.matchAll(/IDC_\w+/g)].map(m => [m[0], { dataset: {}, setAttribute() {} }]));
    allControls.set(id, ctls);
    await renderTechTree(
      {
        game: { galaxy: g, me: faction.faction },
        techSpace: space,
        showType() {},
        show() {},
        picture(d, cid, icon, color) {
          assert(ctls.has(cid));
          if (cid.startsWith('IDC_TECHTREE_')) {
            treeIcons++;
            if (color[0] === 90) lockedIcons++;
          }
        }
      },
      { def: { controls: [...ctls.keys()].map(id => ({ id })) }, ctl: id => ctls.get(id), radios() {}, onLanguageRefresh() {} }
    );
  }
assert(treeIcons > 10);
const model = await loadALO('i_galactic_controls.alo');
assert(model.bones.some(b => b.name.toUpperCase() === 'TEXT_GALACTIC_HELP'));
const begin = performance.now();
for (let i = 0; i < 50; i++) sampleHistory(g, 4000 + i * 30);
const samplingMs = (performance.now() - begin) / 50;
console.log(
  JSON.stringify({
    mod: mod >= 0,
    planets: g.planets.filter(p => !p.background).length,
    legend: logLegend().length,
    treeDialogs: allControls.size,
    treeIcons,
    lockedIcons,
    samplingMs,
    result:
      'log triples and queue, hints snapshot, native history sampling and compression, resolved company power, summary ledgers and grouping, native layouts and Tech Tree mapping passed'
  })
);
