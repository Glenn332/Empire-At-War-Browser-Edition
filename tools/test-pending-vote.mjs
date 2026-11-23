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
const { GalacticGame } = await import('../public/js/game/galactic.js');

const make = (pid, players, campaign = null) => {
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
    playable(humans) {
      return GalacticGame.prototype.playable.call(this, humans);
    },
    order: o => orders.push(o),
    galaxy: { planets: [{ index: 0, name: 'P', type: db.type('Kuat') || [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet') }], players: [], fleets: [], campaign },
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
const solo = [
  { human: true, faction: 'Rebel' },
  { human: true, faction: 'Underworld' },
  { human: false, faction: 'Empire' }
];
{
  const { pb, outcomes } = make(0, solo);
  pb.begin(request());
  assert.deepEqual(pb.request?.voters, [0], 'one human side against the AI is put to that side');
  pb.answer('Rebel', 1, 'fight');
  assert.deepEqual(outcomes, ['fight'], 'and can be fought');
}
{
  const { pb, outcomes, game } = make(0, solo);
  game.setup.options.autoResolve = 0;
  pb.begin(request());
  assert.equal(pb.request, null, 'the lobby asked to always auto-resolve');
  assert.deepEqual(outcomes, ['resolve', 'fight']);
}
{
  const { pb, outcomes } = make(0, [{ human: false, faction: 'Rebel' }, ...solo.slice(1)]);
  pb.begin(request());
  assert.deepEqual(outcomes, ['resolve', 'fight'], 'AI against AI resolves at once');
}
{
  const campaign = { bool: (tag, d) => (tag === 'Is_Autoresolve_Allowed' ? false : d), list: () => [] };
  const { pb, outcomes, game } = make(0, players, campaign);
  pb.begin(request());
  assert.ok(pb.request.locked, 'the campaign rules out auto-resolve');
  assert.equal(pb.request.fallback, 'fight');
  pb.answer('Rebel', 1, 'resolve');
  assert.ok(!pb.request.answers.has(0), 'a resolve vote is refused');
  pb.answer('Rebel', 1, 'fight');
  game.actingPid = 1;
  pb.answer('Empire', 1, 'fight');
  assert.deepEqual(outcomes, ['fight']);
}
{
  const story = { bool: (tag, d) => (tag === 'Is_Story_Campaign' ? true : d), list: () => [] };
  const { pb, outcomes, game } = make(0, players, story);
  pb.begin(request());
  assert.ok(!pb.request.locked);
  pb.answer('Rebel', 1, 'resolve');
  pb.disable(0, true);
  game.actingPid = 1;
  pb.answer('Empire', 1, 'resolve');
  assert.deepEqual(outcomes, ['fight'], 'auto-resolve forbidden while the vote ran: fought anyway');
}
console.log('ok');
