import assert from 'node:assert/strict';
import { GalacticStoryHost } from '../public/js/game/galacticstory.js';

const host = game => {
  const calls = [];
  const h = Object.assign(Object.create(GalacticStoryHost.prototype), {
    game,
    plots: new Map(),
    eventTypes: new Map(),
    timedEvents: new Set(),
    instances: [],
    pending: new Map(),
    time: 0,
    lastLogicTick: -1,
    reasonCache: new Map(),
    resetDepth: 0,
    errors: new Map()
  });
  h.replayDelayed = () => calls.push('delayed');
  h.serviceObjectScripts = () => calls.push('objects');
  h.pollEvents = () => {};
  return { h, calls };
};

// a peer whose battle frame is open (or already closed) must service the same ticks as every other peer
for (const [label, game, expect] of [
  ['net, frame open, lockstep idle', { setup: { net: {} }, net: {}, busy: false, modeSuspended: true }, ['delayed', 'objects']],
  ['net, frame closed, lockstep battle', { setup: { net: {} }, net: {}, busy: true, modeSuspended: false }, []],
  ['single player in a battle', { setup: {}, busy: true, modeSuspended: true }, []],
  ['single player on the map', { setup: {}, busy: false, modeSuspended: false }, ['delayed', 'objects']]
]) {
  const { h, calls } = host(game);
  h.update(0, false, 1 / 30);
  assert.deepEqual(calls, expect, label);
}

// warm-up in a net game waits for slow loads instead of giving up on a wall-clock timeout
{
  const realNow = performance.now;
  let clock = 0;
  performance.now = () => clock;
  try {
    for (const net of [false, true]) {
      const { h } = host({ setup: net ? { net: {} } : {} });
      const inst = { state: 'new', tags: [], events: [] };
      h.instances = [inst];
      let loads = 0;
      h.update = () => {
        if (inst.state !== 'new') return;
        if (++loads < 4) {
          clock += 5000; // each script fetch takes five seconds
          h.pending.set(
            'm' + loads,
            Promise.resolve().then(() => h.pending.delete('m' + loads))
          );
        } else inst.state = 'run';
      };
      await h.warm();
      assert.equal(inst.state, net ? 'run' : 'new', net ? 'net warm-up settles' : 'single player keeps its timeout');
    }
  } finally {
    performance.now = realNow;
  }
}
console.log('story net gates ok');
