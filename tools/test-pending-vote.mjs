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
  { human: true, faction: 'Underworld' }
];
const request = () => ({ p: 0, attacker: 'Rebel', defender: 'Empire', mode: 'space', options: {} });

{
  const { pb, game } = make(2, players);
  assert.ok(pb.begin(request()));
  assert.deepEqual(pb.request.voters, [0, 1], 'only the two sides of the battle vote');
  game.actingPid = 0;
  pb.answer('Rebel', 1, 'resolve');
  assert.ok(pb.request, 'the vote waits for the other side');
  game.actingPid = 1;
  pb.answer('Empire', 1, 'resolve');
  assert.equal(pb.request, null, 'both sides voted: decided');
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
  const { pb, outcomes } = make(0, players);
  pb.begin(request());
  const steps = pb.request.timeout;
  for (let i = 0; i < steps; i++) pb.tick();
  assert.ok(outcomes.length, 'the countdown decides with the default when time runs out');
}
{
  const { pb, outcomes } = make(0, [{ human: true, faction: 'Rebel' }, { human: false, faction: 'Empire' }]);
  pb.begin(request());
  assert.deepEqual(outcomes, ['resolve', 'fight'], 'a battle against the AI resolves at once');
}
console.log('ok');
