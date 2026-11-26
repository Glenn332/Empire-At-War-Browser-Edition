import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
globalThis.fetch = async input => {
  const key = archive.resolve(decodeURIComponent(String(input).replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
Object.assign(globalThis, { innerWidth: 1024, innerHeight: 768 });
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy } = await import('../public/js/game/galaxy.js');
const { GalacticGame } = await import('../public/js/game/galactic.js');
const { PendingBattle } = await import('../public/js/game/galacticpending.js');
const { GalacticLog } = await import('../public/js/game/galacticlog.js');
const { galaxyHash } = await import('../public/js/game/galacticnet.js');
const { campaignDefaults, applyGroundAutoResolve } = await import('../public/js/game/campaignsettings.js');
const { searchPlanets, recordLocation, locationRows, locationEntries, LOCATION_LIMIT } = await import(
  '../public/js/game/galacticsearch.js'
);

const data = await loadCampaignData();
const campaign = [...data.campaigns.values()].find(c => /^MULTIPLAYER_SANDBOX/i.test(c.name));
assert(campaign, 'a campaign to test against');

// ---- planet search ----
const names = ['Coruscant', 'Corellia', 'Kuat', 'Mon Calamari', 'Corulag', 'Éndor', 'Hidden'];
const searchGame = () => ({
  galaxy: {
    planets: names.map((name, index) => ({ index, name, type: { str: () => '' }, background: name === 'Hidden' }))
  },
  planetViews: names.map(name => ({ name, show: true }))
});
{
  const g = searchGame();
  assert.deepEqual(
    searchPlanets(g, 'cor').map(r => r.name),
    ['Corellia', 'Corulag', 'Coruscant'],
    'prefix matches, alphabetical'
  );
  assert.deepEqual(searchPlanets(g, 'CALA').map(r => r.name), ['Mon Calamari'], 'any part of the name, any case');
  assert.deepEqual(searchPlanets(g, 'endor').map(r => r.name), ['Éndor'], 'accents do not matter');
  assert.deepEqual(searchPlanets(g, 'hidden'), [], 'background bodies are not planets');
  assert.deepEqual(searchPlanets(g, '  '), [], 'an empty box finds nothing');
  assert.equal(searchPlanets(g, 'o', 2).length, 2, 'the list is capped');
  assert.equal(searchPlanets(g, 'cor')[0].index, 1, 'the result carries the planet index to select');
  g.planetViews[1].name = 'Renamed';
  assert.deepEqual(searchPlanets(g, 'corel'), [], 'the displayed name is what is searched');
}

// ---- enter / click: centre the camera and select ----
const focus = (extra = {}) => {
  const planets = [
    { index: 0, pos: [10, 20, 0] },
    { index: 1, pos: [30, 40, 0] }
  ];
  const game = {
    galaxy: { planets },
    view: { x: 0, y: 0, z: 5, zoom: 0, dir: 0, planet: -1 },
    cam: { plane: 7 },
    selected: -1,
    selects: [],
    zoomed: [],
    select(i) {
      this.selects.push(i);
      this.selected = i;
    },
    zoomIn(i) {
      this.zoomed.push(i);
    },
    ...extra
  };
  return game;
};
{
  const game = focus();
  assert.equal(GalacticGame.prototype.focusPlanet.call(game, 1), true);
  assert.deepEqual([game.view.x, game.view.y, game.view.z], [30, 40, 7], 'the camera is centred on the planet');
  assert.deepEqual(game.selects, [1], 'and the planet is selected through select()');
  assert.equal(GalacticGame.prototype.focusPlanet.call(game, 9), false, 'no such planet');
  for (const block of [{ battle: {} }, { controlsLocked: true }, { over: true }, { scriptUI: { modal: true } }]) {
    const blocked = focus(block);
    assert.equal(GalacticGame.prototype.focusPlanet.call(blocked, 0), false);
    assert.deepEqual(blocked.selects, [], 'nothing moves while the game is busy');
  }
  const zoomed = focus({ view: { x: 0, y: 0, z: 5, zoom: 1, dir: 0, planet: 0 } });
  GalacticGame.prototype.focusPlanet.call(zoomed, 1);
  assert.deepEqual(zoomed.zoomed, [1], 'from inside a planet the existing zoom path moves on');
}

// ---- location log ----
const logGame = () => {
  const galaxy = startingGalaxy(data, campaign),
    shown = [];
  const game = { galaxy, me: galaxy.players[0].faction, locationUI: { refresh: () => shown.push(1) }, planetViews: [] };
  return { game, galaxy, shown, log: new GalacticLog(game, null) };
};
{
  const { game, galaxy, shown, log } = logGame();
  galaxy.time = 130;
  const before = galaxyHash({ galaxy });
  galaxy.time = 65;
  log.message('Fleet approaching', { planet: 2 });
  galaxy.time = 130;
  log.message('General news');
  log.locate(1, 'Corvette produced');
  assert.equal(locationEntries(galaxy).length, 2, 'only events with a place are kept');
  assert.equal(shown.length, 2, 'the open panel is told');
  const rows = locationRows(game);
  assert.deepEqual(
    rows.map(r => [r.planet, r.text, r.time]),
    [
      [1, 'Corvette produced', '02:10'],
      [2, 'Fleet approaching', '01:05']
    ],
    'newest first, each with time, planet and text'
  );
  assert.equal(rows[0].name, game.galaxy.planets[1].type.str('Text_ID') ? rows[0].name : galaxy.planets[1].name, 'the planet name is shown');
  assert.equal(galaxyHash({ galaxy }), before, 'the log is not part of the state the peers compare');
  assert.equal(recordLocation(galaxy, 9999, 'x'), null, 'an unknown planet is ignored');
  for (let i = 0; i < LOCATION_LIMIT + 20; i++) recordLocation(galaxy, 0, 'e' + i);
  assert.equal(locationEntries(galaxy).length, LOCATION_LIMIT, 'the log is capped');
  assert.equal(locationEntries(galaxy).at(-1).text, 'e' + (LOCATION_LIMIT + 19), 'and keeps the newest');
  // the existing log is saved with the galaxy, so the locations go with it
  const copy = startingGalaxy(data, campaign);
  applyGalaxy(copy, JSON.parse(JSON.stringify(snapshotGalaxy(galaxy))));
  assert.deepEqual(locationEntries(copy), locationEntries(galaxy), 'the location log is saved and restored with the log');
}

// ---- the option: default, setup flow, old saves ----
{
  assert.equal(campaignDefaults(campaign, campaign.str('Starting_Active_Player')).groundAutoResolve, false, 'off by default');
  const g = {};
  applyGroundAutoResolve(g, { options: { groundAutoResolve: true } });
  assert.equal(g.groundAutoResolve, true, 'the shared setup option reaches the galaxy');
  applyGroundAutoResolve(g, { options: { groundAutoResolve: false } });
  assert.equal(g.groundAutoResolve, false, 'and can be switched off');
  const old = {};
  applyGroundAutoResolve(old, { options: { credits: 1, autoResolve: 2 } });
  applyGroundAutoResolve(old, {});
  assert.equal(old.groundAutoResolve, undefined, 'a setup without the option leaves the old behaviour');
  const galaxy = startingGalaxy(data, campaign);
  galaxy.groundAutoResolve = true;
  const restored = startingGalaxy(data, campaign);
  applyGalaxy(restored, JSON.parse(JSON.stringify(snapshotGalaxy(galaxy))));
  assert.equal(restored.groundAutoResolve, true, 'the choice is saved with the game');
  const plain = JSON.parse(JSON.stringify(snapshotGalaxy(startingGalaxy(data, campaign))));
  assert.ok(!Object.hasOwn(plain, 'groundAutoResolve'), 'a game that never had it saves nothing');
  const legacy = startingGalaxy(data, campaign);
  applyGalaxy(legacy, plain);
  assert.equal(legacy.groundAutoResolve, undefined, 'an old save keeps the prompt');
}

// ---- ground battles with the option on and off ----
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet');
const players = [
  { human: true, peer: 0, faction: 'Rebel' },
  { human: true, peer: 1, faction: 'Empire' }
];
const make = ({ net, option, campaign: camp = null, autoResolveOption = false }) => {
  const outcomes = [],
    orders = [];
  const game = {
    net: net ? {} : null,
    setup: { net: !!net, players, options: {} },
    localPid: 0,
    actingPid: 0,
    me: 'Rebel',
    autoResolveOption,
    now: () => 0,
    isHuman: f => players.some(p => p.human && p.faction === f),
    playable(humans) {
      return GalacticGame.prototype.playable.call(this, humans);
    },
    order: o => orders.push(o),
    galaxy: { planets: [{ index: 0, name: 'P', type: planetType }], players: [], fleets: [], campaign: camp, groundAutoResolve: option },
    scriptUI: {
      shells: new Map([
        ['PENDING_BATTLE_SHELL', {}],
        ['STORY_PENDING_BATTLE_SHELL', {}]
      ]),
      visibility: () => {},
      text: () => {},
      ready: async () => {},
      place: () => {},
      play: () => {}
    },
    radar: null,
    keys: { clear() {} },
    pauseGalactic: () => {},
    startBattle: () => outcomes.push('fight'),
    battles: { resolveFor: () => (outcomes.push('resolve'), null), overrun: () => false }
  };
  return { game, pb: new PendingBattle(game), outcomes, orders };
};
// the vote dialog needs a document; the votes themselves are what is checked
console.error = () => {};
const battle = mode => ({ p: 0, attacker: 'Rebel', defender: 'Empire', mode, options: {} });
for (const net of [false, true]) {
  const where = net ? 'multiplayer' : 'single player';
  {
    const { pb, outcomes } = make({ net, option: true });
    pb.begin(battle('land'));
    assert.deepEqual(outcomes, ['resolve', 'fight'], `${where}: a ground battle is auto-resolved without the prompt`);
    assert.equal(pb.request, null, `${where}: nothing is asked`);
  }
  {
    const { pb, outcomes } = make({ net, option: true });
    await Promise.resolve(pb.begin(battle('space'))).catch(() => {});
    assert.ok(pb.request, `${where}: a space battle still asks`);
    assert.ok(!outcomes.includes('resolve'), `${where}: and is not auto-resolved`);
  }
  {
    const { pb, outcomes } = make({ net, option: false });
    await Promise.resolve(pb.begin(battle('land'))).catch(() => {});
    assert.ok(pb.request, `${where}: with the option off the ground battle asks`);
    assert.ok(!outcomes.includes('resolve'), `${where}: and nothing is resolved`);
  }
  {
    const { pb, outcomes } = make({ net, option: undefined });
    await Promise.resolve(pb.begin(battle('land'))).catch(() => {});
    assert.ok(pb.request, `${where}: an old save (no option) asks as before`);
    assert.ok(!outcomes.includes('resolve'));
  }
  {
    const story = {
      bool: (tag, d) => (tag === 'Is_Story_Campaign' ? true : d),
      list: tag => (tag === 'Autoresolve_Exclusion_Locations' ? [planetType.name, 'LAND'] : [])
    };
    const { pb, outcomes } = make({ net, option: true, campaign: story });
    await Promise.resolve(pb.begin(battle('land'))).catch(() => {});
    assert.ok(pb.request, `${where}: a story location that forbids auto-resolve still asks`);
    assert.ok(!outcomes.includes('resolve'));
  }
  {
    const off = { bool: (tag, d) => (tag === 'Is_Autoresolve_Allowed' ? false : d), list: () => [] };
    const { pb, outcomes } = make({ net, option: true, campaign: off });
    await Promise.resolve(pb.begin(battle('land'))).catch(() => {});
    assert.ok(pb.request, `${where}: a campaign without auto-resolve still asks`);
    assert.ok(!outcomes.includes('resolve'));
  }
}
console.log('gc qol ok');
