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
const { ScriptHost } = await import('../public/js/game/scripts.js');

const events = [],
  joins = [],
  leaves = [];
const teamA = { id: 0, players: [] },
  teamB = { id: 1, players: [] };
const pa = { id: 0, factionName: 'Empire', team: teamA, isPlayerObject: true },
  pb = { id: 1, factionName: 'Underworld', team: teamB, isPlayerObject: true };
const world = { time: 0, units: [], players: [pa, pb], neutral: null, audio: { play() {} }, onEvent: (k, d) => events.push([k, d]), selectables: () => [] };
const scripts = Object.assign(Object.create(ScriptHost.prototype), {
  game: {},
  world,
  land: false,
  missing: new Map(),
  wrapped: new WeakMap(),
  cmd: { joinTeam: (q, p) => joins.push([q, p]), leaveTeam: q => leaves.push(q) }
});
const ship = { type: db.type('Corellian_Corvette'), player: pa, x: 0, y: 0, z: 0, maxSpeed: 5, statuses: [{ kind: 'TRACTOR' }] };
const o = scripts.wrap(ship);
o.Highlight(true, 50);
assert.deepEqual(events.pop(), ['scriptHighlight', { unit: ship, on: true, z: 50, small: false }], 'Highlight sends the effect with its height');
o.Highlight_Small(false);
assert.equal(events.pop()[1].small, true);
o.Prevent_Opportunity_Fire(true);
assert.equal(ship.noOpportunity, true);
o.Set_In_Limbo(true);
assert.equal(ship.limbo, true);
o.In_End_Cinematic(true);
assert.equal(ship.inEndCinematic, true);
assert.equal(o.Is_Under_Effects_Of_Ability('Tractor_Beam'), true);
assert.equal(o.Is_Under_Effects_Of_Ability('Ion_Cannon_Shot'), false);
assert.equal(o.Can_Move(), true);
ship.suspended = true;
assert.equal(o.Can_Move(), false, 'a suspended locomotor cannot move');
const A = scripts.wrap(pa),
  B = scripts.wrap(pb);
A.Make_Ally(B);
assert.equal(joins.length, 0, 'one direction only records the relation');
B.Make_Ally(A);
assert.equal(joins.length, 1, 'both directions make them one side');
pb.team = teamA;
A.Make_Enemy(B);
assert.deepEqual(leaves, [pb], 'an enemy on the same side is split off');
B.Set_Black_Market_Tutorial(true);
assert.equal(pb.blackMarketTutorial, true);
B.Disable_Bombing_Run(true);
assert.equal(pb.bombingRunOff, true);
console.log('ok');
