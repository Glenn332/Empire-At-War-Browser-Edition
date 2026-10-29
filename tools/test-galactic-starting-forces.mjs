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
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData, ObjType } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy, placeStartingForce } = await import('../public/js/game/galaxy.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const { stepVisibility } = await import('../public/js/game/galacticfog.js');
const { pauseGalactic } = await import('../public/js/game/galacticpause.js');
const campaignArg = process.argv.indexOf('--campaign'),
  data = await loadCampaignData(),
  campaign = data.campaigns.get(
    campaignArg < 0 ? (mod < 0 ? 'SANDBOX_EQUAL_FOOTING_EMPIRE' : 'KNOWNSMALL_ERA_1_EMPIRE') : process.argv[campaignArg + 1].toUpperCase()
  );
assert(campaign);
const g = startingGalaxy(data, campaign),
  game = {
    galaxy: g,
    me: g.active,
    setup: { difficulty: 'medium' },
    neutralizePopup: { close() {}, open() {} },
    scriptUI: { visibility() {}, enable() {}, text() {}, icon() {} },
    galacticPauseCount: 0,
    userPaused: false,
    paused: false
  };
game.pauseGalactic = on => pauseGalactic(game, on);
game.scriptUI.click = (name, forced) => {
  if (forced && name.toUpperCase() === 'B_PLAY_PAUSE') game.paused = !game.paused;
  else if (!forced) game.story?.clickGUI(name);
};
stepVisibility(g, game.me);
const host = await GalacticStoryHost.create(game);
assert(host);
for (let i = 0; i < 900; i++) {
  if (host.pending.size) await Promise.all([...host.pending.values()]);
  host.update(1 / 30);
}
assert.deepEqual(host.report().errors, {});
const byFaction = () =>
  g.players.map(player => {
    const faction = player.faction,
      owned = g.planets.filter(p => p.owner === faction);
    return {
      faction,
      ai: player.ai,
      planets: owned.length,
      structures: g.planets.reduce((n, p) => n + p.groundStructures.filter(u => u.owner === faction).length, 0),
      ground: g.planets.reduce((n, p) => n + p.garrison.filter(u => u.owner === faction).length, 0),
      ships: g.fleets.filter(f => f.owner === faction).reduce((n, f) => n + f.units.length, 0)
    };
  });
console.log(JSON.stringify({ campaign: campaign.name, factions: byFaction(), missing: host.report().missing }));
const p = g.planets.find(p => p.owner === game.me),
  owner = host.player(game.me),
  station = [...db.types.values()].find(t => t.list('Behavior').includes('DUMMY_STAR_BASE'));
assert(p && station);
const phantomCount = host.created.length;
assert.equal(host.spawn(host.type(station), host.planet(p), owner), undefined);
assert.equal(p.station, station);
assert.equal(host.created.length, phantomCount);
const invalid = [...db.types.values()].find(
  t => !t.list('Behavior').some(b => b.startsWith('DUMMY_')) && !t.has('Create_Additional_Object')
);
assert(invalid);
assert.equal(host.spawn(host.type(invalid), host.planet(p), owner), undefined);
assert.equal(host.created.length, phantomCount);
assert.equal(placeStartingForce(p, game.me, station, g.fleets), undefined);
const generic = host.createGeneric(invalid.name, host.position(12, 34, 56), owner);
assert(generic?.Is_Valid());
assert.equal(host.created.length, phantomCount + 1);
assert(host.objects().some(o => o === generic.__object));
assert.deepEqual(generic.__object.pos, [12, 34, 56]);
host.despawn(generic.__object);
assert(!host.objects().includes(generic.__object));
const extra = [...db.types.values()].find(t => t.list('Behavior').includes('DUMMY_STARSHIP') && !t.has('Create_Additional_Object'));
assert(extra);
const parent = new ObjType('Generic', 'UnsupportedParent');
parent.props.set('create_additional_object', [extra.name]);
const ships = g.fleets.reduce((n, f) => n + f.units.length, 0);
assert.equal(host.spawn(host.type(parent), host.planet(p), owner), undefined);
assert.equal(
  g.fleets.reduce((n, f) => n + f.units.length, 0),
  ships + 1,
  'Successful additional creation does not replace the native main return'
);
const closedType = new ObjType('Planet', 'ClosedSurface');
closedType.props.set('planet_surface_accessible', ['No']);
const closed = { type: closedType, index: 0, garrison: [], groundStructures: [], orbitalStructures: [] };
const building = new ObjType('Generic', 'GroundWithExtra');
building.props.set('behavior', ['DUMMY_GROUND_STRUCTURE']);
building.props.set('create_additional_object', [extra.name]);
const emptyFleets = [];
assert.equal(placeStartingForce(closed, game.me, building, emptyFleets), undefined);
assert.equal(emptyFleets.length, 0, 'Inaccessible ground structure rejects before creating additional objects');
assert.equal(
  host.perception('Variable_Target.MaxStructureSlotsUnnormalized', [], owner, { planet: closed }),
  3,
  'Missing capacity retains the compiled type default'
);
host.vm.global('__spawnPlanet', host.planet(p));
host.vm.global('__spawnStation', host.type(station));
host.vm.global('__spawnOwner', owner);
host.vm.exec('assert(Spawn_Unit(__spawnStation,__spawnPlanet,__spawnOwner)==nil)', 'Native null spawn return');
const routes = g.routes,
  fleets = g.fleets,
  ground = p.garrison,
  stations = p.station;
try {
  g.routes = [
    { a: p.index, b: 1 },
    { a: p.index, b: 2 }
  ];
  g.fleets = [];
  p.garrison = [];
  assert.equal(
    host.perception('Variable_Target.FriendlyForce.HasSpaceForce', [], owner, { planet: p }),
    0,
    'Starbase alone is not a space force'
  );
  g.fleets = [{ owner: game.me, planet: p.index, leg: null, units: [{ type: extra }] }];
  assert.equal(host.perception('Variable_Target.FriendlyForce.HasSpaceForce', [], owner, { planet: p }), 1);
  g.fleets[0].units[0].stealth = true;
  assert.equal(host.perception('Variable_Target.FriendlyForce.HasSpaceForce', [], owner, { planet: p }), 0);
  assert.equal(
    host.perception('Variable_Target.MaxStructureSlotsUnnormalized', [], owner, { planet: p }),
    p.type.num('Special_Structures_Land', 3)
  );
  assert.equal(host.perception('Variable_Target.TradeRoutes', [], owner, { planet: p }), 1);
} finally {
  g.routes = routes;
  g.fleets = fleets;
  p.garrison = ground;
  p.station = stations;
}
if (mod >= 0) {
  const definitions = suffix => {
    const path = [...archive.index.keys()].find(k => k.endsWith(suffix));
    assert(path);
    const env = host.vm.environment({});
    try {
      assert.equal(host.vm.run('Expected=(function()\n' + archive.read(path).toString() + '\nend)()', path, env), null);
      return host.vm.read(env, 'Expected');
    } finally {
      host.vm.free(env);
    }
  };
  const roster = definitions('ERAONESTARTSET.LUA'),
    empire = definitions('EMPIREPROGRESSSET.LUA');
  let checked = 0;
  const records = host.objects();
  for (const [faction, worlds] of Object.entries({ ...roster, EMPIRE: empire.PESTAGE }))
    for (const [planet, list] of Object.entries(worlds)) {
      const location = g.planets.find(p => p.name.toUpperCase() === planet && p.owner.toUpperCase() === faction);
      if (!location) continue;
      for (const entry of list) {
        const name = typeof entry === 'string' ? entry : entry.object;
        assert(
          records.some(o => o.planet === location && o.owner.toUpperCase() === faction && o.type.name.toUpperCase() === name.toUpperCase()),
          faction + ': missing authored starting hero ' + name + ' at ' + planet
        );
        checked++;
      }
    }
  assert(checked > 50);
  assert(!host.objects().some(o => o.type.name.toUpperCase() === 'GENERATE_FORCE'), 'All authored random-force markers are consumed');
  console.log(JSON.stringify({ authoredHeroEntriesChecked: checked }));
  for (const row of byFaction().filter(r => r.planets && !db.faction(r.faction).bool('Is_Neutral')))
    assert(row.ground > 0 && row.ships > 0, JSON.stringify(row));
  const before = JSON.stringify(byFaction());
  for (let i = 0; i < 150; i++) host.update(1 / 30);
  assert.equal(JSON.stringify(byFaction()), before, 'Startup must not repeat while initialized scripts service');
  assert(
    !Object.keys(host.report().missing).some(n => /MaxStructureSlotsUnnormalized|HasSpaceForce|HasGroundForce|TradeRoutes$/.test(n)),
    'Starting-force equation tokens must be supported'
  );
}
host.dispose();
archive.close();
console.log('Campaign XML placement, native spawn returns, all present factions and startup replay guards passed');
