import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) { const re = new RegExp(decodeURIComponent(path.slice(11)), 'i'); return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n)))); }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])), data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js'); await loadGameData();
const { RetreatCoordinator } = await import('../public/js/game/retreat.js');
const playable = [...db.factions.values()].filter(f => f.bool('Is_Playable')).map(f => f.name);
const [a, b] = playable;
let clock = 0, block = 0; const sounds = [], removed = [], ended = [];
const players = [{ f: a, team: 0 }, { f: b, team: 1 }, { f: 'Neutral', team: 2 }];
const units = [{ id: 1, p: players[0] }, { id: 2, p: players[0] }, { id: 3, p: players[1] }];
const coordinator = campaign => new RetreatCoordinator({
  prefix: 'Space', campaign, time: () => clock, players: () => players, factionOf: p => p.f, teamOf: p => p.team, isSide: p => p.team < 2,
  units: p => units.filter(u => u.p === p && u.id !== 2), everything: p => units.filter(u => u.p === p), blocker: () => block,
  remove: (e, lost) => removed.push([e.id, lost]), end: (enemy, p) => ended.push([enemy.f, p.f]), play: (s, p) => sounds.push([s, p.f]), show: () => {},
});
let c = coordinator(false);
assert.equal(c.canRetreat(players[0]), 1, 'no way back outside a campaign battle');
c = coordinator(true);
assert.equal(c.canRetreat(players[2]), 1, 'not one of the two sides');
assert.equal(c.canRetreat(players[0]), 2, 'too early: the allowed timer runs 30 seconds');
clock = 31; assert.equal(c.canRetreat(players[0]), 0);
block = 3; assert.equal(c.request(players[0]), 3, 'a gravity well prevents it'); assert(!c.active);
const refusal = sounds.at(-1); assert(refusal, 'a refusal is voiced'); block = 0; sounds.length = 0;
assert.equal(c.request(players[0]), 0); assert(c.active, 'the countdown runs');
assert.equal(c.canRetreat(players[1]), 5, 'another player is retreating');
assert(sounds.some(([s, who]) => who === players[0].f), 'the retreater hears the begin sound');
assert.equal(c.request(players[0]), 0); assert(!c.active, 'cancelled'); assert(!removed.length);
c.request(players[0]);
const seconds = db.faction(a).num('Space_Retreat_Countdown_Seconds', 10);
c.step(seconds - 1); assert(c.active && !ended.length);
block = 6; c.step(0.1); assert(!c.active, 'a refusal during the countdown cancels it'); block = 0;
c.request(players[0]); c.step(seconds + 0.5);
assert(c.done && !c.active); assert.deepEqual(ended, [[b, a]], 'the enemy wins by the retreat');
assert.deepEqual(removed.sort((x, y) => x[0] - y[0]), [[1, false], [2, true]], 'what can go goes, what cannot is lost');
assert.equal(c.canRetreat(players[0]), 1, 'nothing more to retreat');

{
  let t2 = 0; const log = { begun: null, cancelled: 0, ended: [], phase: [] }, pos = new Map(), mine = [{ id: 1, p: players[0] }, { id: 3, p: players[0] }, { id: 4, p: players[0] }, { id: 9, p: players[1] }];
  for (const u of mine) pos.set(u.id, 0);
  const f = new RetreatCoordinator({
    prefix: 'Space', campaign: true, time: () => t2, players: () => players, factionOf: p => p.f, teamOf: p => p.team, isSide: p => p.team < 2,
    units: p => mine.filter(u => u.p === p), everything: p => mine.filter(u => u.p === p), blocker: () => 0,
    remove: (e, lost) => removed.push([e.id, lost]), end: (enemy, p) => log.ended.push([enemy.f, p.f]), play: () => {}, show: () => {},
    begin: state => { log.begun = state; }, cancelled: state => { log.cancelled++; }, flightStart: state => log.phase.push(state.phase), flightEnd: () => log.phase.push('end'),
    move: (e, d) => pos.set(e.id, pos.get(e.id) + d),
  });
  removed.length = 0; t2 = 40;
  assert.equal(f.request(players[0]), 0); assert(log.begun.list.has(mine[0]), 'the request lists the units that can go'); assert.equal(log.begun.phase, 'countdown');
  const pursue = db.faction(b).num('Space_Retreat_Pursue_Max_Speed_Mod_Factor', 1), damaged = db.faction(a).num('Space_Retreat_Units_Damaged_Mod_Factor', 1);
  assert.equal(log.begun.pursue(players[1]), pursue, 'the pursuers go by their own faction factor'); assert.equal(log.begun.damaged(players[0]), damaged);
  f.cancel(); assert.equal(log.cancelled, 1);
  f.request(players[0]); f.step(db.faction(a).num('Space_Retreat_Countdown_Seconds', 10) + 0.1);
  assert.equal(log.begun.phase, 'flight', 'no more harm from the end of the countdown'); assert(!log.ended.length, 'the battle goes on while they fly');
  const fast = db.faction(a).num('Space_Retreat_Flight_Move_Increment', 500);
  for (let i = 0; i < 88; i++) f.step(1 / 30);
  assert(!log.ended.length, 'the 88th frame is still flight');
  f.step(1 / 30); assert.deepEqual(log.ended, [[b, a]], 'the 89th frame ends it'); assert.deepEqual(removed.sort((x, y) => x[0] - y[0]), [[1, false], [3, false], [4, false]]);
  assert.equal(pos.get(1), 29 * 8.125 + 59 * fast, 'the first is released at the 30th frame');
  assert.equal(pos.get(3), 30 * 8.125 + 58 * fast, 'the next one frame later'); assert.equal(pos.get(4), 31 * 8.125 + 57 * fast);
  assert.equal(pos.get(9), 0, 'the others stay'); assert.equal(log.phase.at(-1), 'end');
}

{
  let t3 = 0; const log = { frames: [], explode: [], heard: [], ended: [], cameraEnd: 0, total: 450 };
  const mine = [{ id: 1, p: players[0] }, { id: 3, p: players[0] }], f = new RetreatCoordinator({
    prefix: 'Space', campaign: true, time: () => t3, players: () => players, factionOf: p => p.f, teamOf: p => p.team, isSide: p => p.team < 2,
    units: p => mine.filter(u => u.p === p), everything: p => mine.filter(u => u.p === p), blocker: () => 0,
    remove: () => {}, end: (enemy, p) => log.ended.push(log.frames.at(-1)), play: () => {}, show: () => {},
    begin: () => {}, move: () => {}, cameraStart: () => log.total, cameraFrame: n => log.frames.push(n), cameraEnd: () => { log.cameraEnd++; },
    explode: p => log.explode.push([log.frames.at(-1), p.f]), released: e => log.heard.push([log.frames.at(-1), e.id]),
  });
  t3 = 40; f.request(players[0]); f.step(db.faction(a).num('Space_Retreat_Countdown_Seconds', 10) + 0.1);
  for (let i = 0; i < 600 && f.flight; i++) f.step(1 / 30);
  assert.deepEqual(log.ended, [450], 'it ends when the camera is done'); assert.deepEqual(log.explode, [[181, a]], 'the station goes at frame 181'); assert.equal(log.cameraEnd, 1);
  assert.deepEqual(log.heard, [[30, 1], [31, 3]], 'each ship is heard leaving as it is let go');
  const g2 = []; const none = new RetreatCoordinator({ prefix: 'Space', campaign: true, time: () => 99, players: () => players, factionOf: p => p.f, teamOf: p => p.team, isSide: p => p.team < 2,
    units: () => [], everything: () => [], blocker: () => 0, remove: () => {}, end: () => g2.push('end'), play: () => {}, show: () => {}, move: () => {}, cameraStart: () => 0 });
  none.start = -100; none.request(players[0]); none.step(11.5); assert.deepEqual(g2, ['end'], 'no ships and no station: no cinematic');
}
{
  const { setRetreatDisabled, retreatDisabled } = await import('../public/js/game/retreat.js');
  const land = (blockaded, objects = []) => new RetreatCoordinator({ prefix: 'Land', campaign: true, time: () => 99, players: () => players, factionOf: p => p.f, teamOf: p => p.team, isSide: p => p.team < 2,
    units: () => [], everything: () => objects, blocker: () => 0, remove: () => {}, end: () => {}, play: () => {}, show: () => {}, blockaded: () => blockaded, isLocal: p => p === players[0] });
  const blockade = db.constants.num('Blockade_Run_Attrition_Factor', 0), landBase = db.constants.num('Land_Retreat_Attrition_Factor', 0);
  assert.equal(land(false).attrition(players[0]), Math.min(1, landBase), 'no blockade: the constant alone');
  assert.equal(land(true).attrition(players[0]), Math.min(1, landBase + blockade), 'a ship in orbit adds the blockade factor');
  assert.equal(land(true, [{ type: { bool: k => k === 'Prevents_Blockade_Run_Attrition' } }]).attrition(players[0]), Math.min(1, landBase), 'an ion cannon takes it off');
  const space = new RetreatCoordinator({ prefix: 'Space', campaign: true, time: () => 99, players: () => players, factionOf: p => p.f, teamOf: p => p.team, isSide: p => p.team < 2,
    units: () => [], everything: () => [], blocker: () => 0, remove: () => {}, end: () => {}, play: () => {}, show: () => {}, blockaded: () => true });
  assert.equal(space.attrition(players[0]), Math.min(1, db.constants.num('Space_Retreat_Attrition_Factor', 0)), 'space has no blockade term');
  const c2 = land(false); c2.start = -100;
  setRetreatDisabled(a, true); assert(retreatDisabled(a)); assert.equal(c2.canRetreat(players[0]), 1, 'DISABLE_RETREAT: no way back'); assert.equal(c2.canRetreat(players[1]), 0);
  setRetreatDisabled(a, false); assert.equal(c2.canRetreat(players[0]), 0, 'a 0 gives it back');
  assert.equal(c2.requestByFaction(a), false, 'a script cannot send the local human'); assert(!c2.active);
  assert.equal(c2.requestByFaction(b), true, 'it can send the other side'); assert.equal(c2.active.player, players[1]);
}
{
  const ability = (m, cat) => ({ num: (k, d) => (k === 'Retreat_Loss_Mitigation' ? m : k === 'Stacking_Category' ? cat : d) });
  const unit = (...abilities) => ({ type: { sub: () => [{ all: tag => (tag === 'Retreat_Protection_Ability' ? abilities : []) }] } });
  const c = new RetreatCoordinator({ prefix: 'Space', campaign: true, time: () => 99, players: () => players, factionOf: p => p.f, teamOf: p => p.team, isSide: p => p.team < 2,
    units: () => [], everything: () => [unit(ability(0.1, 0), ability(0.3, 0)), unit(ability(0.2, 1), ability(1.5, 2), ability(-1, 3))], blocker: () => 0, remove: () => {}, end: () => {}, play: () => {}, show: () => {} });
  assert(Math.abs(c.mitigation(players[0]) - 0.5) < 1e-9, 'category 0 gives 0.3, category 1 gives 0.2, the invalid ones nothing: ' + c.mitigation(players[0]));
}
console.log('ok', a, b, seconds);
