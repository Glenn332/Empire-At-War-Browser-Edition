import assert from 'node:assert/strict';
import { ObjType, db } from '../public/js/gamedata.js';
import { Audio } from '../public/js/audio.js';

function soundEvent(name, fields) {
  const event = new ObjType('SFXEvent', name);
  for (const [key, value] of Object.entries(fields)) event.props.set(key.toLowerCase(), [String(value)]);
  db.sfx.set(name.toUpperCase(), event);
  return event;
}

class FakeParam {
  constructor() {
    this.value = 1;
  }
  cancelScheduledValues() {}
  setTargetAtTime(value) {
    this.value = value;
  }
  linearRampToValueAtTime(value) {
    this.value = value;
  }
}
class FakeNode {
  connect() {}
  disconnect() {}
}
class FakeSource extends FakeNode {
  constructor(context) {
    super();
    this.context = context;
    this.playbackRate = new FakeParam();
    this.onended = null;
    this.startedAt = null;
    this.stoppedAt = null;
  }
  start(at) {
    this.startedAt = at;
    this.context.started.push(this);
  }
  stop(at) {
    this.stoppedAt = at;
  }
  end() {
    this.onended?.();
  }
}
const context = {
  currentTime: 0,
  started: [],
  state: 'running',
  createBufferSource() {
    return new FakeSource(this);
  },
  createGain() {
    const node = new FakeNode();
    node.gain = new FakeParam();
    return node;
  },
  createStereoPanner() {
    const node = new FakeNode();
    node.pan = new FakeParam();
    return node;
  }
};

const audio = new Audio();
audio.ctx = context;
audio.master = new FakeNode();
audio.buffer = async () => ({ duration: 1, length: 44100, sampleRate: 44100, numberOfChannels: 1 });
audio.listener = { x: 0, y: 0, dist: 1500 };
audio.falloff = 1;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

soundEvent('Test_Turbolaser_Fire', {
  Samples: 'Test_Turbolaser.wav',
  Is_3D: 'Yes',
  Max_Instances: 2,
  Priority: 4,
  Volume_Saturation_Distance: 100000,
  Min_Volume: 100,
  Max_Volume: 100
});
audio.play('Test_Turbolaser_Fire', 900, 0);
audio.play('Test_Turbolaser_Fire', 600, 0);
await settle();
assert.equal(context.started.length, 2, 'two instances start under Max_Instances 2');
const [farthest, middle] = context.started;
audio.play('Test_Turbolaser_Fire', 2000, 0);
await settle();
assert.equal(context.started.length, 2, 'at the cap a shot farther than every playing one is refused');
audio.play('Test_Turbolaser_Fire', 100, 0);
await settle();
assert.equal(context.started.length, 3, 'at the cap a nearer shot starts');
assert.notEqual(farthest.stoppedAt, null, 'the nearer shot takes the place of the farthest instance');
assert.equal(middle.stoppedAt, null, 'the other instance plays on');
assert.equal(audio.instances.get('Test_Turbolaser_Fire').size, 2, 'the instance count stays at the cap');
farthest.end();
assert.equal(audio.instances.get('Test_Turbolaser_Fire').size, 2, 'a replaced instance ending is not counted twice');

audio.play('Test_Turbolaser_Fire', 50, 0);
audio.play('Test_Turbolaser_Fire', 40, 0);
audio.play('Test_Turbolaser_Fire', 30, 0);
await settle();
assert.equal(context.started.length, 5, 'shots replaced before their sample starts never start');
assert.equal(audio.instances.get('Test_Turbolaser_Fire').size, 2, 'a burst in one frame keeps the cap');

soundEvent('Test_Flat_Click', { Samples: 'Test_Click.wav', Is_2D: 'Yes', Is_3D: 'No', Min_Volume: 100, Max_Volume: 100 });
const before = context.started.length;
audio.play('Test_Flat_Click');
audio.play('Test_Flat_Click');
await settle();
assert.equal(context.started.length, before + 1, 'Max_Instances defaults to one, and at the cap a 2-D event is refused');

for (const source of [...context.started]) source.end();
context.started.length = 0;
for (let i = 0; i < 40; i++)
  soundEvent('Test_Shot_' + i, { Samples: 'Test_Shot.wav', Is_3D: 'Yes', Max_Instances: 4, Priority: 4, Volume_Saturation_Distance: 100000, Min_Volume: 100, Max_Volume: 100 });
for (let i = 0; i < 32; i++) audio.play('Test_Shot_' + i, 1000 + i, 0);
await settle();
assert.equal(audio.positional.size, 32, 'thirty-two positional voices play');
audio.play('Test_Shot_32', 5000, 0);
await settle();
assert.equal(context.started.length, 32, 'with every voice taken a farther shot of the same priority is refused');
audio.play('Test_Shot_33', 10, 0);
await settle();
assert.equal(context.started.length, 33, 'a nearer shot of the same priority takes a voice');
assert.notEqual(context.started[31].stoppedAt, null, 'from the farthest of the least important');
soundEvent('Test_Explosion', { Samples: 'Test_Boom.wav', Is_3D: 'Yes', Max_Instances: 3, Priority: 2, Volume_Saturation_Distance: 100000, Min_Volume: 100, Max_Volume: 100 });
audio.play('Test_Explosion', 20, 0);
await settle();
assert.equal(context.started.length, 34, 'a more important sound takes a voice');
soundEvent('Test_Ambient', { Samples: 'Test_Hum.wav', Is_3D: 'Yes', Max_Instances: 3, Priority: 5, Volume_Saturation_Distance: 100000, Min_Volume: 100, Max_Volume: 100 });
audio.play('Test_Ambient', 1, 0);
await settle();
assert.equal(context.started.length, 34, 'a less important sound does not take a voice');
assert.equal(audio.positional.size, 32, 'the voice budget holds');
console.log('audio instance rules ok');
