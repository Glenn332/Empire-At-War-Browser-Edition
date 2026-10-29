import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
const { db, loadGameData, ObjType } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData } = await import('../public/js/game/galaxy.js');
const { campaignMenuRows, campaignMenuVariant } = await import('../public/js/game/campaignmenu.js');
const data = await loadCampaignData(),
  regular = campaignMenuRows(data.campaigns),
  tutorial = campaignMenuRows(data.campaigns, id => db.t(id), { tutorial: true });
assert(regular.length && tutorial.length);
for (const rows of [regular, tutorial]) {
  assert.equal(new Set(rows.map(r => r.key)).size, rows.length, 'One row per Campaign_Set');
  for (const r of rows) {
    assert(!r.campaign.bool('Is_Multiplayer'));
    assert.equal(r.label, db.t(r.campaign.str('Text_ID')));
  }
}
assert(regular.every(r => r.campaign.bool('Is_Listed', true) && !r.campaign.bool('Tutorial')));
assert(tutorial.every(r => r.campaign.bool('Tutorial')));
const variant = campaignMenuVariant(data.campaigns, 'sandbox_equal_footing', 'empire');
if (mod < 0) {
  assert.equal(regular.length, 6);
  assert.equal(tutorial.length, 8);
  assert.equal(variant?.name, 'Sandbox_Equal_Footing_Empire');
} else {
  assert.equal(tutorial.length, 1);
  assert.equal(tutorial[0].campaign.name, 'GCMenu_Rebel');
  assert(!regular.some(r => r.campaign.name === 'GCMenu_Rebel'));
}
assert.equal(campaignMenuVariant(data.campaigns, 'missing_campaign_set', 'Empire'), null);
const hidden = [...data.campaigns.values()].find(c => !c.bool('Is_Listed', true) && c.str('Starting_Active_Player'));
if (hidden)
  assert(
    campaignMenuVariant(data.campaigns, hidden.str('Campaign_Set'), hidden.str('Starting_Active_Player')),
    'Faction resolution includes unlisted variants'
  );

const fixture = (name, properties) => {
  const c = new ObjType('Campaign', name);
  for (const [k, v] of Object.entries(properties)) c.props.set(k.toLowerCase(), [String(v)]);
  return [name, c];
};
const filters = new Map([
  fixture('Visible', { Campaign_Set: 'Regular', Text_ID: 'B', Sort_Order: 2 }),
  fixture('VisibleOtherFaction', { Campaign_Set: 'Regular', Text_ID: 'B', Sort_Order: 2 }),
  fixture('First', { Campaign_Set: 'First', Text_ID: 'Z', Sort_Order: 1 }),
  fixture('Unlisted', { Campaign_Set: 'Unlisted', Is_Listed: false }),
  fixture('Multiplayer', { Campaign_Set: 'Multiplayer', Is_Multiplayer: true, Tutorial: true }),
  fixture('Tutorial', { Campaign_Set: 'Tutorial', Text_ID: 'A', Tutorial: true, Is_Listed: false })
]);
assert.deepEqual(
  campaignMenuRows(filters, x => x).map(r => r.key),
  ['FIRST', 'REGULAR']
);
assert.deepEqual(
  campaignMenuRows(filters, x => x, { tutorial: true }).map(r => r.key),
  ['TUTORIAL'],
  'Tutorial selector ignores Is_Listed and excludes multiplayer'
);

const rc = await (await fetch('asset/Data/Resources/GUIDialog/GUIDialogs.rc')).text();
const layouts = new Map([...rc.matchAll(/(IDD_\w+)\s+DIALOG[\s\S]*?\r?\nEND/g)].map(m => [m[1], m[0]]));
for (const id of ['IDD_SELECT_TUTORIAL_DIALOG', 'IDD_CUSTOM_CAMPAIGN_STAGING_DIALOG']) {
  const text = layouts.get(id);
  assert(text, id);
  for (const ctl of ['IDC_STAGING_MAP_LIST', 'IDC_CAMPAIGN_DESCRIPTION', 'IDC_CANCEL_BUTTON', 'IDC_PLAY_BUTTON'])
    assert(text.includes(ctl), `${id}: ${ctl}`);
}
for (const ctl of ['IDC_FACTION_COMBO', 'IDC_RADIO_CUSTOM_EASY', 'IDC_RADIO_CUSTOM_MEDIUM', 'IDC_RADIO_CUSTOM_HARD'])
  assert(layouts.get('IDD_CUSTOM_CAMPAIGN_STAGING_DIALOG').includes(ctl));
if (mod >= 0)
  assert(
    layouts.get('IDD_MAIN_MENU_DIALOG').includes('"TEXT_BUTTON_GALACTIC_CONQUEST",IDC_MAIN_MENU_TUTORIAL'),
    'Mod conquest entry uses the native Tutorial button'
  );

const listeners = new Map();
globalThis.addEventListener = (name, fn) => listeners.set(name, fn);
globalThis.removeEventListener = name => listeners.delete(name);
globalThis.window = { game: null };
let dialog;
const openDialog = async (id, options) => {
  const layout = layouts.get(id),
    callbacks = new Map(),
    controls = new Map([...layout.matchAll(/\b(IDC_\w+)\b/g)].map(m => [m[1], { setAttribute() {}, addEventListener() {} }]));
  return (dialog = {
    id,
    options,
    callbacks,
    closed: false,
    ctl: id => controls.get(id),
    show() {},
    enable() {},
    setText() {},
    setImage() {},
    close() {
      this.closed = true;
    },
    on(id, fn) {
      if (controls.has(id)) callbacks.set(id, fn);
    },
    combo(id, options, value, change) {
      this.faction = value;
      this.pickFaction = change;
    },
    radios(ids, value, change) {
      this.pickDifficulty = change;
    },
    list(id, rows, pick) {
      this.rows = rows;
      this.pickCampaign = pick;
      return {
        select(key) {
          pick(rows.find(r => r.key === key));
        }
      };
    }
  });
};
globalThis.__campaignMenuTest = { db, loadCampaignData, openDialog, loadTextureCanvas: async () => null };
const source = (await readFile(new URL('../public/js/game/campaignmenu.js', import.meta.url), 'utf8'))
  .replace(/^import\s+[^\n]+;\r?\n/gm, '')
  .replace(/^/, 'const { db, loadCampaignData, openDialog, loadTextureCanvas } = globalThis.__campaignMenuTest;\n');
const { openCampaignMenu } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
let result,
  cancelled = 0;
assert(
  await openCampaignMenu({
    tutorial: true,
    start: setup => {
      result = setup;
    },
    cancel: () => {
      cancelled++;
    }
  })
);
assert.equal(dialog.id, 'IDD_SELECT_TUTORIAL_DIALOG');
assert.equal(dialog.options.nativeLists, true);
assert.deepEqual(
  dialog.rows.map(r => r.key),
  tutorial.map(r => r.key)
);
assert(
  dialog.rows.every(row => row.icon === 'i_dialogue_blank.tga'),
  'Uncompleted tutorials use the native blank image column'
);
dialog.callbacks.get('IDC_PLAY_BUTTON')();
assert.deepEqual(result, {
  mode: 'galactic',
  campaign: tutorial[0].campaign.name,
  faction: tutorial[0].campaign.str('Starting_Active_Player'),
  difficulty: 'medium',
  players: [],
  teamFactions: []
});
assert(dialog.closed);
assert.equal(listeners.size, 0);
result = null;
await openCampaignMenu({
  start: setup => {
    result = setup;
  },
  cancel: () => {
    cancelled++;
  }
});
assert.equal(dialog.id, 'IDD_CUSTOM_CAMPAIGN_STAGING_DIALOG');
const playable = regular.find(r =>
  [...db.factions.values()].some(f => f.bool('Is_Playable') && campaignMenuVariant(data.campaigns, r.key, f.name))
);
assert(playable);
const faction = [...db.factions.values()].find(f => f.bool('Is_Playable') && campaignMenuVariant(data.campaigns, playable.key, f.name));
dialog.pickCampaign(playable);
dialog.pickFaction(faction.name);
dialog.pickDifficulty('IDC_RADIO_CUSTOM_HARD');
dialog.callbacks.get('IDC_PLAY_BUTTON')();
const picked = campaignMenuVariant(data.campaigns, playable.key, faction.name);
assert.deepEqual(result, {
  mode: 'galactic',
  campaign: picked.name,
  faction: picked.str('Starting_Active_Player'),
  difficulty: 'hard',
  players: [],
  teamFactions: []
});
await openCampaignMenu({
  tutorial: true,
  isTutorialComplete: () => true,
  start() {
    assert.fail('Escape must not start a campaign');
  },
  cancel: () => {
    cancelled++;
  }
});
assert(
  dialog.rows.every(row => row.icon === 'checked_box.tga'),
  'Completed tutorials use the original completion sprite'
);
listeners.get('keydown')({ code: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
assert(dialog.closed);
assert.equal(cancelled, 1);
assert.equal(listeners.size, 0);
console.log(
  JSON.stringify({
    mod: mod >= 0,
    regular: regular.length,
    tutorial: tutorial.length,
    result: 'installed menu routing, filters, faction variants, exact launch payloads, difficulty and Escape passed'
  })
);
