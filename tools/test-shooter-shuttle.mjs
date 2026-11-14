import assert from 'node:assert/strict';
globalThis.window ??= globalThis;
const { ShuttleWaves } = await import('../public/js/game/shuttle.js');

const T = name => ({ name, str: k => (k === 'Company_Transport_Unit' ? 'Craft' : ''), num: (_, d) => d });
const calls = [];
const world = {
  time: 0,
  n: 100,
  points: [],
  transports: [],
  ally: (a, b) => a === b,
  nearestOpen: (x, y) => ({ x, y }),
  reinforce: (side, name, x, y, face, landed, opts) => {
    calls.push({ side, name, x, y, hold: opts.hold, cargo: opts.cargo });
    return Promise.resolve(null);
  },
  spawn: async () => null
};
const padA = { x: 100, y: 100, reinforce: true, side: 0 },
  padB = { x: 900, y: 900, reinforce: true, side: 0 };
const sh = {
  world,
  cfg: {},
  benchN: 0,
  game: { shooterNet: null, factions: ['EMPIRE', 'REBEL'] },
  points: () => [padA, padB],
  home: () => null,
  hq: () => null
};
const W = new ShuttleWaves(sh);
assert.equal(W.on(), true, 'shuttles are on by default');
sh.cfg.shuttle = false;
assert.equal(W.on(), false, 'the setting turns them off');
sh.cfg.shuttle = true;

const foot = T('Stormtrooper_Squad'),
  car = T('Scout_Squad');
W.add({ side: 0, who: 'me', unit: foot, company: foot, cls: {}, point: padB });
for (let i = 0; i < 14; i++) W.add({ side: 0, who: 'bot', unit: foot, company: foot, done: () => {} });
W.add({ side: 0, who: 'bot', unit: car, company: car, car: true, done: () => {} });
assert.equal(W.launchIn(0), 3, 'the first wave launches 3 s after the first request');
world.time = 2.9;
W.step();
assert.equal(calls.length, 0, 'nothing launches before the wave time');
world.time = 3;
W.step();
const atB = calls.filter(c => c.x === padB.x && c.y === padB.y),
  foots = calls.filter(c => c.name === 'Stormtrooper_Squad'),
  cars = calls.filter(c => c.name === 'Scout_Squad');
assert.equal(cars.length, 1, 'a vehicle gets its own shuttle');
assert.equal(foots.length, 2, '15 soldiers fill two shuttles of up to 8');
assert(atB.length >= 1 && atB[0].hold === 0, "the player's shuttle lands first at the player's chosen pad");
const holds = calls.map(c => c.hold).sort((a, b) => a - b);
for (let i = 1; i < holds.length; i++) assert(holds[i] - holds[i - 1] >= 3, 'every shuttle of a wave launches a few seconds after the one before: ' + holds);
for (let i = 0; i < calls.length; i++)
  for (let j = i + 1; j < calls.length; j++) assert(Math.hypot(calls[i].x - calls[j].x, calls[i].y - calls[j].y) >= 110, 'shuttles get their own landing spot, clear of each other');
assert.equal(W.launchIn(0), 15, 'the next wave is 15 s later');
world.time = 18;
calls.length = 0;
W.step();
assert.equal(calls.length, 0, 'an empty wave sends nothing');
assert.equal(W.launchIn(1), 15, 'the other side runs on the same fixed clock from the start of the battle');
world.time = 20;
W.add({ side: 1, who: 'bot', unit: foot, company: foot, done: () => {} });
assert.equal(W.launchIn(1), 13, 'a request joins the queue and waits for the next launch, not 15 s from the request');
world.time = 33;
W.step();
assert.equal(calls.filter(c => c.side === 1).length, 1, 'it launches with the next wave');
calls.length = 0;

sh.points = () => [];
world.points = [{ x: 500, y: 500, side: 0 }];
W.add({ side: 0, who: 'bot', unit: foot, company: foot, done: () => {} });
world.time = 48;
W.step();
assert.equal(calls.length, 1, 'without a pad the shuttle lands at a held command post');
assert.equal(calls[0].x, 500);
console.log('PASS: shuttle waves - setting, timing, 8 per shuttle, own shuttle per vehicle, player first at its pad, stagger, post fallback');
process.exit(0);
