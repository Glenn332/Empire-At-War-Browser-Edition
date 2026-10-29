import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.innerWidth = 1024;
globalThis.innerHeight = 768;
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
const { db, ObjType, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadALO } = await import('../public/js/alo.js');
const { parseXML } = await import('../public/js/xml.js');
const { PendingBattle } = await import('../public/js/game/galacticpending.js');
const { autoCombatant, overrunSide, nativeAutoContrast } = await import('../public/js/game/galacticautoresolve.js');

const comps = new Map();
const walk = n => {
  if (n.attrs?.Name) comps.set(n.attrs.Name.toUpperCase(), n);
  for (const c of n.children || []) walk(c);
};
for (const root of parseXML(archive.read(archive.resolve('Data/XML/CommandBarComponentFiles.xml')).toString('latin1')).children)
  for (const node of root.children) {
    const data = archive.read(archive.resolve('Data/XML/' + node.text.trim()));
    if (data) walk(parseXML(data.toString('latin1')));
  }
for (const [shell, bones] of [
  ['PENDING_BATTLE_SHELL', ['text_attack_choice', 'choice_button_left', 'choice_button_right', 'graph_left', 'graph_right']],
  ['STORY_PENDING_BATTLE_SHELL', ['text_attack_single', 'attack_button_single']]
]) {
  const component = comps.get(shell);
  assert(component, shell + ' is a command bar component');
  const model = await loadALO(component.val('Model_Name'));
  assert(model, shell + ' model loads');
  const names = new Set(model.bones.map(b => b.name.toLowerCase()));
  for (const bone of bones) {
    assert(names.has(bone), `${shell} has bone ${bone}`);
    assert(comps.has(bone.toUpperCase()), `${bone} is a component`);
  }
}
assert.equal(comps.get('GRAPH_LEFT').val('Blank_Texture_Name').trim().split(/\s+/).length, 6, 'Six stack frames, as g_planet_fleet');

assert(/IMMINENT/i.test(db.t('TEXT_TACTICAL_SPACE_BATTLE_IS_PENDING')) && /IMMINENT/i.test(db.t('TEXT_TACTICAL_LAND_BATTLE_IS_PENDING')));
assert(db.t('TEXT_BUTTON_BEGIN') && db.t('TEXT_BUTTON_RESOLVE_BATTLE') && db.t('TEXT_BUTTON_RETURN_TO_GALACTIC'));

const calls = [];
const game = {
  me: 'Empire',
  autoResolveOption: false,
  galacticPauseCount: 0,
  pauseGalactic(on) {
    this.galacticPauseCount += on ? 1 : -1;
  },
  startBattle(...args) {
    calls.push(['fight', ...args]);
  },
  galaxy: { planets: [{ index: 0, name: 'P', type: { str: () => '' } }], fleets: [], players: [] },
  battles: {
    overrunNow: false,
    overrun() {
      return this.overrunNow;
    },
    resolveFor() {
      calls.push(['resolve']);
      return null;
    }
  },
  scriptUI: {
    visibility(n, on) {
      calls.push(['visible', n, on]);
    },
    text() {},
    place() {},
    play() {},
    ready: async () => {},
    shells: new Map([
      ['PENDING_BATTLE_SHELL', {}],
      ['STORY_PENDING_BATTLE_SHELL', {}]
    ]),
    comps
  },
  radar: { flash() {} },
  audio: { play() {}, setPlaylist() {}, stopMusic() {} },
  keys: new Set()
};
const pending = new PendingBattle(game),
  request = { p: 0, attacker: 'Rebel', defender: 'Empire', mode: 'space', options: {} };
assert.equal(pending.single(request), false, 'Auto-Resolve is offered by default');
const campaign = (flags, lists = {}) => ({ bool: (k, d = false) => (k in flags ? flags[k] : d), list: k => lists[k] || [] });
game.galaxy.planets[0].type.name = 'Fondor';
game.galaxy.campaign = campaign({ Is_Autoresolve_Allowed: false });
assert.equal(pending.single(request), true, 'Is_Autoresolve_Allowed false: Begin only');
game.galaxy.campaign = campaign({});
assert.equal(pending.single(request), false, 'the campaign saying nothing allows it');
const exclusions = { Autoresolve_Exclusion_Locations: ['Fondor', 'land', 'Jabiim', 'space'] };
game.galaxy.campaign = campaign({ Is_Story_Campaign: true }, exclusions);
assert.equal(pending.single(request), false, 'Fondor is excluded on the ground only');
assert.equal(pending.single({ ...request, mode: 'land' }), true, 'a story campaign excludes the planet and mode pair');
game.galaxy.campaign = campaign({ Is_Story_Campaign: false }, exclusions);
assert.equal(pending.single({ ...request, mode: 'land' }), false, 'the exclusions are for story campaigns only');
delete game.galaxy.campaign;
{
  const { loadCampaignData } = await import('../public/js/game/galaxy.js');
  const story = [...(await loadCampaignData()).campaigns.values()].find(c => c.list('Autoresolve_Exclusion_Locations').length);
  console.log('a loaded campaign with exclusions:', story ? story.name : '(none)');
  if (story) {
    const real = story.list('Autoresolve_Exclusion_Locations');
    assert(real.length % 2 === 0, 'the exclusions are (planet, mode) pairs');
    game.galaxy.campaign = story;
    const story_ = story.bool('Is_Story_Campaign');
    for (let i = 0; i < real.length; i += 2) {
      game.galaxy.planets[0].type.name = real[i];
      assert.equal(pending.single({ ...request, mode: real[i + 1].toLowerCase() }), story_, real[i] + ' ' + real[i + 1]);
    }
    delete game.galaxy.campaign;
  }
}
game.galaxy.planets[0].type.name = '';
pending.disable(0, true);
assert.equal(pending.single(request), true, 'ENABLE_AUTORESOLVE with a flag takes it away from that planet');
pending.disable(0, false);
assert.equal(pending.single(request), false);

const shells = game.scriptUI.shells;
game.scriptUI.shells = new Map();
await pending.begin(request);
assert.equal(calls.at(-1)[0], 'fight');
assert(!pending.busy && game.galacticPauseCount === 0);
calls.length = 0;
game.scriptUI.shells = shells;
await pending.begin(request);
assert(pending.busy && game.galacticPauseCount === 1, 'The player is asked, with the galactic clock held');
assert(
  calls.some(c => c[0] === 'visible' && c[1] === 'PENDING_BATTLE_SHELL' && c[2]),
  'the choice shell is shown'
);
assert(calls.some(c => c[0] === 'visible' && c[1] === 'STORY_PENDING_BATTLE_SHELL' && !c[2]));
assert.equal(pending.begin(request), false, 'One pending conflict at a time');
pending.click('choice_button_left');
assert(!pending.busy && game.galacticPauseCount === 0, 'Begin lets the clock go on');
assert.deepEqual(calls.at(-1), ['fight', 0, 'Rebel', 'Empire', 'space', {}], 'Begin starts the tactical battle');

calls.length = 0;
pending.disable(0, true);
await pending.begin(request);
assert(
  calls.some(c => c[0] === 'visible' && c[1] === 'STORY_PENDING_BATTLE_SHELL' && c[2]),
  'the single-button shell'
);
pending.click('choice_button_right');
assert(pending.busy, 'No Auto-Resolve on the single-button shell');
pending.click('attack_button_single');
assert(!pending.busy && calls.at(-1)[0] === 'fight');
pending.disable(0, false);

calls.length = 0;
game.autoResolveOption = true;
pending.begin(request);
assert.deepEqual(
  calls.map(c => c[0]),
  ['resolve', 'fight'],
  'The Auto-Resolve option resolves without asking'
);
assert(!pending.busy && game.galacticPauseCount === 0);
game.autoResolveOption = false;
game.battles.overrunNow = true;
calls.length = 0;
pending.begin(request);
assert.equal(calls[0][0], 'resolve', 'An overrun resolves without asking');
calls.length = 0;
pending.disable(0, true);
calls.length = 0;
await pending.begin(request);
assert(pending.busy && calls.some(c => c[0] === 'visible' && c[1] === 'STORY_PENDING_BATTLE_SHELL' && c[2]));
pending.click('attack_button_single');
pending.disable(0, false);
game.battles.overrunNow = false;
const bool = db.constants.bool;
db.constants.bool = (k, d) => (k === 'Strategic_Queue_Tactical_Battles' ? false : bool.call(db.constants, k, d));
calls.length = 0;
await pending.begin(request);
assert.deepEqual(
  calls.map(c => c[0]),
  ['fight'],
  'Without Strategic_Queue_Tactical_Battles the battle starts at once'
);
db.constants.bool = bool;

const contrast = await nativeAutoContrast(new Map([['FIGHTER', { types: new Map(), kinds: new Map([['FIGHTER', 1]]) }]]));
const fixture = (name, power) => {
  const t = new ObjType('SpaceUnit', name);
  for (const [k, v] of Object.entries({ AI_Combat_Power: power, CategoryMask: 'Fighter' })) t.props.set(k.toLowerCase(), [String(v)]);
  return t;
};
const [a, b] = [...db.factions.values()].filter(t => t.bool('Is_Playable')).map(t => t.name),
  unit = fixture('PendingFixture', 10);
const many = Array.from({ length: 20 }, () => autoCombatant(unit, a)),
  one = [autoCombatant(unit, b)];
assert.equal(overrunSide(many, one, contrast, db.constants), -1, 'Overrun_Auto_Resolve_Multiple is unset in the data');
const multiple = { num: (n, d) => (n === 'Overrun_Auto_Resolve_Multiple' ? 8 : db.constants.num(n, d)) };
assert.equal(overrunSide(many, one, contrast, multiple), 1, 'The defender is overrun');
assert.equal(overrunSide(one, many, contrast, multiple), 0);
assert.equal(
  overrunSide(
    many,
    [autoCombatant(fixture('PendingHero', 10), b, {})].map(u => ({ ...u, hero: true })),
    contrast,
    multiple
  ),
  -1,
  'A hero stops it'
);

const mine1 = autoCombatant(unit, a),
  mine2 = autoCombatant(unit, a),
  theirs = autoCombatant(unit, b);
const lost = pending.losses(
  {
    sides: [[mine1, mine2], [theirs]],
    result: {
      sides: [
        { alive: new Set([mine1]), stations: new Map() },
        { alive: new Set(), stations: new Map() }
      ]
    }
  },
  a,
  b
);
assert.equal(lost.yours.get(unit), 1);
assert.equal(lost.enemy.get(unit), 1);
assert.equal(lost.mine.length, 1);
const defending = pending.losses(
  {
    sides: [[mine1], [theirs]],
    result: {
      sides: [
        { alive: new Set(), stations: new Map() },
        { alive: new Set([theirs]), stations: new Map() }
      ]
    }
  },
  b,
  a
);
assert.equal(defending.yours.get(unit), 1, 'The player is the defender here: its losses are the second roster'.length ? 1 : 0);
console.log(JSON.stringify({ mod: mod >= 0, status: 'PASS' }));
