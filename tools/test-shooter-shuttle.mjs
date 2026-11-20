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
    calls.push({ side, name, x, y, face, hold: opts.hold, at: world.time + opts.hold, cargo: opts.cargo });
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
  hq: () => null,
  panel: { style: {} },
  lock: () => {},
  classes: () => [],
  isDummy: () => false,
  realOf: () => null,
  realTypes: () => null
};
const W = new ShuttleWaves(sh);
assert.equal(W.on(), true, 'shuttles are on by default');
sh.cfg.shuttle = false;
assert.equal(W.on(), false, 'the setting turns them off');
sh.cfg.shuttle = true;

const foot = T('Stormtrooper_Squad'),
  car = T('Scout_Squad');
W.add({ side: 0, who: 'me', unit: foot, company: foot, cls: {}, point: padB });
assert.equal(calls.length, 1, "the player boards a shuttle at once");
assert.equal(calls[0].at, 3, 'it holds above the landing zone until the wave launches');
assert(W.inRoom(), 'the player is in the troop bay while waiting');
for (let i = 0; i < 14; i++) W.add({ side: 0, who: 'bot', unit: foot, company: foot, done: () => {} });
W.add({ side: 0, who: 'bot', unit: car, company: car, car: true, done: () => {} });
const own = W.flights.get(1);
assert.equal(own.load.length, 8, "waiting bots take the free seats in the player's shuttle");
world.time = 2.9;
W.step();
assert.equal(calls.length, 1, 'no other shuttle launches before the wave time');
world.time = 3;
W.step();
const atB = calls.filter(c => c.x === padB.x && c.y === padB.y),
  foots = calls.filter(c => c.name === 'Stormtrooper_Squad'),
  cars = calls.filter(c => c.name === 'Scout_Squad');
assert.equal(cars.length, 1, 'a vehicle gets its own shuttle');
assert.equal(foots.length, 2, '15 soldiers fill two shuttles of up to 8');
assert(atB.length >= 1 && calls[0] === atB[0] && calls.every(c => c.at >= calls[0].at), "the player's shuttle lands at the player's chosen pad and launches first");
const holds = calls.map(c => c.at).sort((a, b) => a - b);
for (let i = 1; i < holds.length; i++) assert(holds[i] - holds[i - 1] >= 3, 'every shuttle of a wave launches a few seconds after the one before: ' + holds);
for (let i = 0; i < calls.length; i++)
  for (let j = 0; j < calls.length; j++) {
    if (i === j) continue;
    const a = calls[i],
      b = calls[j],
      dx = b.x - a.x,
      dy = b.y - a.y;
    if (j > i) assert(Math.hypot(dx, dy) >= 110, 'shuttles get their own landing spot, clear of each other');
    const ahead = dx * Math.cos(a.face) + dy * Math.sin(a.face),
      side = Math.abs(-dx * Math.sin(a.face) + dy * Math.cos(a.face));
    assert(!(ahead > 0 && ahead < 176 && side < 66), 'no shuttle lands in the ramp lane in front of another');
  }
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
console.log('PASS: shuttle waves - setting, boarding at once, bots fill the bay, fixed clock, 8 per shuttle, own shuttle per vehicle, stagger, spacing, clear ramp lanes, post fallback');
process.exit(0);
