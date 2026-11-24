import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

// multiplayer orders name fleets and units by stable ids, so a fleet list that shifts before the order runs can't redirect it
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
globalThis.fetch = async input => {
  const key = archive.resolve(decodeURIComponent(String(input).replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy, stampIds } = await import('../public/js/game/galaxy.js');
const { runCommand, orders, recordRef, fromRecordRef, fleetRef } = await import('../public/js/game/galacticnet.js');

const data = await loadCampaignData();
const campaign = data.campaigns.get('SANDBOX_EQUAL_FOOTING_EMPIRE');
const g = startingGalaxy(data, campaign);
const owner = g.fleets[0].owner,
  type = g.fleets[0].units[0].type,
  p = g.fleets[0].planet;
const fleet = units => ({ owner, planet: p, slot: 0, units, path: [], dest: -1, leg: null, pos: null });
const a = fleet([{ type }]),
  b = fleet([{ type }, { type }]);
g.fleets.unshift(a, b);
stampIds(g);
const ids = new Set();
for (const f of g.fleets) for (const x of [f, ...f.units]) ids.add(x.nid);
for (const pl of g.planets) for (const u of [...pl.garrison, ...pl.groundStructures, ...pl.orbitalStructures]) ids.add(u.nid);
assert(![...ids].some(id => !Number.isInteger(id)), 'every fleet and record is stamped');
const count =
  g.fleets.reduce((n, f) => n + 1 + f.units.length, 0) +
  g.planets.reduce((n, pl) => n + pl.garrison.length + pl.groundStructures.length + pl.orbitalStructures.length, 0);
assert.equal(ids.size, count, 'ids are unique');

const landed = [];
const game = { galaxy: g, land: (f, at, opts) => landed.push({ f, at, opts }) };
const land = orders.land(g, b, p, [b.units[1]]),
  unit = recordRef(g, b.units[1]);
assert.deepEqual(land.f, ['n', b.nid]);
// an earlier fleet leaves the list (swept, merged) between the order and its turn
g.fleets.splice(g.fleets.indexOf(a), 1);
runCommand(game, owner, land);
assert.equal(landed.length, 1);
assert.equal(landed[0].f, b, 'the order still lands the fleet it named');
assert.deepEqual(landed[0].opts.records, [b.units[1]], 'and the unit it named');
assert.equal(fromRecordRef(g, unit), b.units[1]);

// the named unit is gone: nothing lands rather than another unit
const gone = b.units.pop();
runCommand(game, owner, land);
assert.equal(landed.length, 1, 'an order for a unit that no longer exists is dropped');
b.units.push(gone);
// the named fleet is gone
g.fleets.splice(g.fleets.indexOf(b), 1);
runCommand(game, owner, orders.land(g, b, p));
assert.equal(landed.length, 1, 'an order for a fleet that no longer exists is dropped');
let moved = 0;
const transfer = orders.transfer(g, g.fleets[0], 0, null, b);
runCommand({ galaxy: g, transferUnits: () => moved++ }, owner, transfer);
assert.equal(moved, 0, 'a transfer into a fleet that is gone does not start a new fleet');
g.fleets.push(b);

// the raid flag travels with a land order
landed.length = 0;
runCommand(game, owner, orders.land(g, b, p, null, true));
assert.equal(landed[0].opts.raid, !!(await import('../public/js/game/raid.js')).isRaidForce(b), 'raid only for a raid force');

// copies of a record get their own id, the first keeps it
const copy = { ...b.units[0] };
g.planets[p].garrison.push(copy);
const before = b.units[0].nid;
stampIds(g);
assert.equal(b.units[0].nid, before);
assert.notEqual(copy.nid, before);
g.planets[p].garrison.pop();

// ids and the counter survive a save
const snap = JSON.parse(JSON.stringify(snapshotGalaxy(g)));
const h = startingGalaxy(data, campaign);
applyGalaxy(h, snap);
assert.deepEqual(
  h.fleets.map(f => [f.nid, f.units.map(u => u.nid)]),
  g.fleets.map(f => [f.nid, f.units.map(u => u.nid)])
);
assert.equal(h.nextId, g.nextId);
stampIds(h);
assert.equal(h.nextId, g.nextId, 'loading hands out no new ids');

// an older save without ids gets them the same way on every machine
const old = JSON.parse(JSON.stringify(snap), (k, v) => (k === 'nid' || k === 'nextId' ? undefined : v));
assert(!JSON.stringify(old).includes('nid'));
const x = startingGalaxy(data, campaign),
  y = startingGalaxy(data, campaign);
applyGalaxy(x, old);
applyGalaxy(y, old);
stampIds(x);
stampIds(y);
assert.deepEqual(
  x.fleets.map(f => fleetRef(x, f)),
  y.fleets.map(f => fleetRef(y, f))
);
assert.deepEqual(
  x.fleets.flatMap(f => f.units.map(u => recordRef(x, u))),
  y.fleets.flatMap(f => f.units.map(u => recordRef(y, u)))
);

// unstamped (single-player) records keep the positional refs
const sp = startingGalaxy(data, campaign);
const r = recordRef(sp, sp.fleets[0].units[0]);
assert.equal(r[0], 'f');
assert.equal(fromRecordRef(sp, r), sp.fleets[0].units[0]);
assert.equal(fleetRef(sp, sp.fleets[0]), 0);
console.log('fleet ids ok');
