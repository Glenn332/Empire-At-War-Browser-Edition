import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy, forceKind } = await import('../public/js/game/galaxy.js');
const { GalacticGame } = await import('../public/js/game/galactic.js');
const { placeCampaignBattle, battleResult } = await import('../public/js/game/campaignbattle.js');

const data = await loadCampaignData(),
  campaign = [...data.campaigns.values()].find(c => c.list('Locations').length > 20);
const g = startingGalaxy(data, campaign),
  factions = [...new Set(g.players.map(p => p.faction))];
const [A, B] = factions,
  C = factions[2] || 'Underworld';
const stations = [...db.types.values()].filter(t => forceKind(t) === 'station'),
  top = stations.find(t => t.num('Base_Level', 0) >= 3 && db.type(t.str('Prev_Level_Base').trim())),
  orbitalType = [...db.types.values()].find(t => forceKind(t) === 'orbital structure') || stations[0];
assert(top && orbitalType);
const pl = g.planets.find(p => !p.background);
const fleet = owner => ({ owner, planet: pl.index, leg: null, path: [], dest: -1, units: [{ type: stations[0], owner }] });
const reset = stationOwner => {
  pl.owner = stationOwner;
  pl.station = top;
  pl.stationOwner = stationOwner;
  pl.spaceLevel = top.num('Base_Level', 0);
  pl.orbitalStructures = [
    { type: orbitalType, owner: stationOwner },
    { type: orbitalType, owner: stationOwner }
  ];
  g.fleets = [];
};
const game = {
  galaxy: g,
  me: A,
  setup: {},
  victory: { superweaponBattle() {}, tacticalDeaths() {} },
  battles: { retreat() {} },
  autoResolveFor: () => ({ allowed: true }),
  techLevels: () => ({}),
  blackMarketOwned: () => ({}),
  view: { x: 0, y: 0 },
  cam: { pull: 0 }
};
Object.setPrototypeOf(game, GalacticGame.prototype);
const apply = r => GalacticGame.prototype.applyResult.call(game, { mode: 'space', planet: pl.index, alive: [], winner: 'attacker', ...r });

// A fights B over C's station: C's station stays out of the battle and must survive it.
reset(C);
apply({ sides: [A, B], station: false, stationFought: null, orbitalFought: [] });
assert.equal(pl.station, top, "a battle between two other factions leaves a third faction's starbase alone");
assert.equal(pl.orbitalStructures.length, 2);

// The defender's starbase destroyed: owner cleared, orbital structures go with it, and the story hears of both.
reset(B);
const told = [];
game.story = {
  reasonCache: new Map(),
  errors: new Map(),
  battleContext: () => null,
  battleFinished() {},
  deaths: fn => fn(),
  stationChanged: (planet, from, to, killer) => told.push(['station', from, to, killer]),
  combatDeath: (record, planet, owner, killer) => told.push(['death', record.dead, owner, killer])
};
apply({ sides: [A, B], station: false, stationFought: top.name, orbitalFought: ['o:0', 'o:1'], alive: ['o:0', 'o:1'] });
game.story = null;
assert.deepEqual(told, [
  ['station', top, null, A],
  ['death', undefined, B, A],
  ['death', undefined, B, A]
]);
assert.equal(pl.station, null);
assert.equal(pl.spaceLevel, 0);
assert.equal(pl.stationOwner, null, 'a destroyed starbase no longer has an owner');
assert.equal(pl.orbitalStructures.length, 0, 'orbital structures do not outlive the starbase');

// Damaged starbase steps down along Prev_Level_Base; a destroyed orbital structure stays destroyed.
reset(B);
const level = top.num('Base_Level', 0) - 1;
apply({ sides: [A, B], station: true, stationLevel: level, stationFought: top.name, orbitalFought: ['o:0', 'o:1'], alive: ['o:1'] });
assert.equal(pl.station, db.type(top.str('Prev_Level_Base').trim()));
assert.equal(pl.spaceLevel, level);
assert.equal(pl.stationOwner, B);
assert.equal(pl.orbitalStructures.length, 1, 'the orbital structure destroyed in battle is removed from the planet');

// Tactical bookkeeping: orbital structures carry record ids and report their survival.
reset(B);
g.fleets = [fleet(A), fleet(B)];
game.battle = { p: pl.index, attacker: A, defender: B, mode: 'space' };
const cb = GalacticGame.prototype.battleSetup.call(game).campaign;
assert.equal(cb.defender.station, top.name);
assert.deepEqual(
  cb.defender.orbital.map(o => o.gid),
  ['o:0', 'o:1']
);
const marker = { type: { name: 'Orbital_Special_Structure_Position' }, pos: [0, 0, 0], rot: [0, 0, 0] };
const player = (f, human) => ({ human, faction: db.faction(f), reinforcements: [], aiPool: [] }),
  teams = [
    { players: [player(A, true)], spawnPoints: [] },
    { players: [player(B, false)], spawnPoints: [] }
  ];
const w = {
  spawn: type => ({ type, dead: false }),
  startHyperspace() {},
  recountPop() {},
  teams,
  units: [],
  squads: [],
  players: []
};
const book = placeCampaignBattle(w, { objects: [marker, marker] }, teams, {
  ...cb,
  attacker: { ...cb.attacker, units: [] },
  defender: { ...cb.defender, units: [] }
});
book.orbital.get('o:0').dead = true;
const r = battleResult(w, book, cb, 0);
assert.deepEqual(r.orbitalFought, ['o:0', 'o:1']);
assert(!r.alive.includes('o:0') && r.alive.includes('o:1'));
assert.equal(r.stationFought, top.name);
console.log('PASS: tactical station and orbital structure results apply only to what fought');
