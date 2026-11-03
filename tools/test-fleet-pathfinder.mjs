import assert from 'node:assert/strict';
import { openGame } from './megfs.mjs';
import { fileURLToPath } from 'node:url';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod >= 0 ? [process.argv[mod + 1]] : []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = decodeURIComponent(path.replace(/^asset\//, ''))
    .replaceAll('/', String.fromCharCode(92))
    .toUpperCase();
  const data = archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy } = await import('../public/js/game/galaxy.js');
const { dropOverviewUnits, aiPathfinder, pathfinderCell } = await import('../public/js/game/fleetmanagement.js');
const { splitForCap } = await import('../public/js/game/campaignbattle.js');
const { packOverviewFleet } = await import('../public/js/game/planetoverview.js');
const { pathfinder } = await import('../public/js/game/campaignland.js');

const data = await loadCampaignData();
const campaign = data.campaigns.get('SANDBOX_EQUAL_FOOTING_REBEL') || [...data.campaigns.values()][0];
const g = startingGalaxy(data, campaign),
  me = g.active,
  enemy = db
    .faction(me)
    .list('Enemies')
    .find(n => db.faction(n));
const ships = [...db.types.values()].filter(
  t => t.str('Space_Model_Name') && !t.has('Squadron_Units') && t.list('Affiliation').some(n => n.toUpperCase() === me.toUpperCase())
);
assert(ships.length >= 2 && enemy);
const p = g.planets.find(p => !p.background);
g.fleets = [];
const [a, b, c] = [ships[0], ships[1], ships[0]].map(type => ({ type, owner: me, markerId: -1 }));
const fleet = { owner: me, units: [a, b, c], planet: p.index, pos: null, path: [], dest: -1, leg: null, slot: 0 };
g.fleets.push(fleet);
const game = { galaxy: g, me, over: false, busy: false, controlsLocked: false };

assert.equal(pathfinderCell(), '0000', 'without Pathfinder_Slot_Index the first cell is the pathfinder slot');
const side = recs => ({ kind: 'fleet', planet: p.index, fleet, records: recs });
assert(dropOverviewUnits(game, side([b]), { kind: 'fleet', planet: p.index, slot: 0, fleet, pf: true }));
assert(b.pathfinder && !a.pathfinder && !c.pathfinder);
assert(dropOverviewUnits(game, side([a]), { kind: 'fleet', planet: p.index, slot: 0, fleet, pf: true }));
assert(a.pathfinder && !b.pathfinder, 'one pathfinder per fleet');

const cells = ['0000', '0001', '0002', '0100'].map(n => ({ name: 'Q1_' + n }));
const packed = packOverviewFleet([b, a, c], cells, new WeakMap());
assert.equal(packed.slots[0].unit, a, 'the pathfinder is drawn in its slot');
assert(!packed.slots.slice(1).some(s => s?.unit === a));

const copy = startingGalaxy(data, campaign);
applyGalaxy(copy, JSON.parse(JSON.stringify(snapshotGalaxy(g))));
const saved = copy.fleets.find(f => f.planet === p.index && f.owner === me);
assert.deepEqual(
  saved.units.map(u => !!u.pathfinder),
  [true, false, false],
  'the flag survives save and load'
);

const roster = fleet.units.map((u, i) => ({ gid: '0:' + i, type: u.type, pathfinder: !!u.pathfinder }));
const split = splitForCap(roster, 100);
assert.deepEqual(
  split.field.map(u => u.gid),
  ['0:0'],
  'a flagged unit arrives first, alone'
);
assert.equal(split.waiting.length, 2);
assert.equal(
  splitForCap(
    roster.map(u => ({ ...u, pathfinder: false })),
    100
  ).waiting.length,
  0
);

assert(dropOverviewUnits(game, side([a]), { kind: 'fleet', planet: p.index, slot: 0, fleet, pf: false }));
assert(!a.pathfinder, 'dragging out of the slot clears it');

const ai = [b, c].map(u => ({ type: u.type, owner: enemy, markerId: -1 }));
const list = db.constants.props.get('preferred_pathfinder_types') || [],
  prefer = names => {
    db.constants.props.set('preferred_pathfinder_types', names);
    db.constants._list?.clear();
    db.constants._raw?.clear();
  };
prefer([ai[1].type.name]);
g.aiPathfinders = false;
assert.equal(aiPathfinder(g, enemy, ai), null, 'off by default');
g.aiPathfinders = true;
assert.equal(aiPathfinder(g, enemy, ai), ai[1], 'the AI picks from Preferred_Pathfinder_Types');
assert.equal(aiPathfinder(g, me, ai), null, 'humans use the slot themselves');
prefer([]);
assert.equal(aiPathfinder(g, enemy, ai), null, 'no listed type, no pathfinder');
prefer(list);

assert.equal(pathfinder([{ type: 'A' }, { type: 'B', pathfinder: true }]).type, 'B', 'land invasions take the flagged company first');
console.log('PASS: pathfinder slot, overview cell, save round trip, space split, AI pick and land pick');
