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
const { PendingBattle } = await import('../public/js/game/galacticpending.js');

const make = (pid, players) => {
  const shown = new Map(),
    orders = [],
    outcomes = [];
  let clock = 1000;
  const game = {
    net: {},
    setup: { net: true, players, options: {} },
    localPid: pid,
    actingPid: pid,
    me: players[pid].faction,
    now: () => clock,
    isHuman: f => players.some(p => p.human && p.faction === f),
    order: o => orders.push(o),
    galaxy: { planets: [{ index: 0, name: 'P', type: db.type('Kuat') || [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet') }], players: [], fleets: [] },
    scriptUI: {
      shells: new Map([['PENDING_BATTLE_SHELL', {}], ['STORY_PENDING_BATTLE_SHELL', {}]]),
      visibility: (n, on) => shown.set(n, on),
      text: () => {},
      ready: async () => {},
      place: () => {},
      play: () => {}
    },
    radar: null,
    pauseGalactic: () => {},
    startBattle: () => outcomes.push('fight'),
    battles: { resolveFor: () => (outcomes.push('resolve'), null) }
  };
  const pb = new PendingBattle(game);
  return { game, pb, shown, orders, outcomes, advance: s => (clock += s * 1000) };
};
const players = [
  { human: true, faction: 'Rebel' },
  { human: true, faction: 'Empire' },
  { human: false, faction: 'Underworld' }
];
const request = () => ({ p: 0, attacker: 'Rebel', defender: 'Empire', mode: 'space', options: {} });

{
  const { pb, shown, orders, game } = make(0, players);
  assert.ok(pb.begin(request()));
  await new Promise(r => setTimeout(r));
  assert.equal(shown.get('PENDING_BATTLE_SHELL'), true, 'the vote uses the pending shell');
  assert.deepEqual(pb.request.voters, [0, 1], 'every connected human votes');
  pb.click('choice_button_right');
  assert.deepEqual(orders, [{ c: 'battle', id: 1, choice: 'resolve' }], 'Auto-Resolve votes auto');
  assert.equal(shown.get('choice_button_right'), false, 'the buttons go after voting');
  pb.answer('Rebel', 1, 'resolve');
  game.actingPid = 1;
  pb.answer('Empire', 1, 'resolve');
  assert.equal(pb.request, null, 'all voted: decided');
}
{
  const { pb, outcomes, game } = make(0, players);
  pb.begin(request());
  pb.answer('Rebel', 1, 'resolve');
  game.actingPid = 1;
  pb.answer('Empire', 1, 'fight');
  assert.deepEqual(outcomes, ['fight'], 'one tactical vote means a tactical battle');
}
{
  const { pb, orders, advance } = make(1, players);
  pb.begin(request());
  pb.tick();
  assert.equal(orders.length, 0);
  advance(db.constants.num('Battle_Pending_Timeout_Seconds', 30) + 0.01);
  pb.tick();
  assert.deepEqual(orders, [{ c: 'battle', id: 1, choice: 'fight' }], 'on timeout the local vote is tactical');
}
{
  const { pb, outcomes } = make(0, players);
  pb.begin({ ...request(), defender: 'Underworld' });
  assert.deepEqual(outcomes, ['resolve', 'fight'], 'a battle against the AI resolves at once');
}
console.log('ok');
