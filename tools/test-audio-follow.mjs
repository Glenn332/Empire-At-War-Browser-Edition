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
  constructor(value = 1) {
    this.value = value;
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
  }
  start() {
    this.context.started.push(this);
  }
  stop() {}
  end() {
    this.onended?.();
  }
}
const param = () => new FakeParam(0);
const context = {
  currentTime: 0,
  started: [],
  panners: [],
  state: 'running',
  listener: { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() },
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
    node.pan = new FakeParam(0);
    return node;
  },
  createPanner() {
    const node = new FakeNode();
    node.positionX = param();
    node.positionY = param();
    node.positionZ = param();
    this.panners.push(node);
    return node;
  }
};

const audio = new Audio();
audio.ctx = context;
audio.master = new FakeNode();
audio.buffer = async () => ({ duration: 1, length: 44100, sampleRate: 44100, numberOfChannels: 1 });
audio.space3D = { sat: 1.5, roll: 2, pull: 60 };
const camera = { matrixWorld: { elements: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, -800, 600, 1] } };
audio.listenFrom(camera);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

soundEvent('Test_Fighter_Flyby', { Samples: 'Test_Flyby.wav', Is_3D: 'Yes', Max_Instances: 4, Volume_Saturation_Distance: 200, Min_Volume: 100, Max_Volume: 100 });
const fighter = { x: 100, y: 0, dead: false };
audio.playAt(null, 'Test_Fighter_Flyby', 110, 5, fighter);
await settle();
const panner = context.panners.at(-1);
assert.equal(panner.positionX.value, 110, 'the sound starts where it was played');
fighter.x = 500;
fighter.y = 300;
audio.listenFrom(camera);
assert.equal(panner.positionX.value, 510, 'the sound moves with the craft and keeps its offset');
assert.equal(panner.positionY.value, 305, 'on both axes');

audio.play('Test_Fighter_Flyby', 0, 0);
await settle();
const still = context.panners.at(-1);
fighter.x = 900;
audio.listenFrom(camera);
assert.equal(still.positionX.value, 0, 'a sound played without a source stays put');
assert.equal(panner.positionX.value, 910, 'while the followed one keeps moving');

fighter.dead = true;
fighter.x = 2000;
audio.listenFrom(camera);
assert.equal(panner.positionX.value, 910, 'a dead craft leaves its sound where it died');
assert.equal(audio.following.size, 0, 'and stops being followed');

soundEvent('Test_Engine_Loop', { Samples: 'Test_Engine.wav', Is_3D: 'Yes', Max_Instances: 4, Volume_Saturation_Distance: 400, Max_Volume: 100 });
const ship = { x: 0, y: 0, dead: false };
audio.setLoops([{ id: 7, event: 'Test_Engine_Loop', x: 0, y: 0, unit: ship }]);
await settle();
const loop = audio.loops.get(7);
assert.ok(loop.panner, 'the engine loop is placed');
ship.x = 250;
audio.listenFrom(camera);
assert.equal(loop.panner.positionX.value, 250, 'an engine loop follows its ship every frame, between loop refreshes');

audio.spatial = null;
audio.ear.placed = true;
const speakers = new Audio();
speakers.ctx = { ...context, createPanner: undefined };
speakers.master = new FakeNode();
speakers.buffer = audio.buffer;
speakers.space3D = audio.space3D;
speakers.listenFrom(camera);
const craft = { x: 0, y: 0, dead: false };
speakers.playFrom(craft, 'Test_Fighter_Flyby', 0, 0);
await settle();
const [flat] = [...speakers.following];
assert.ok(flat?.pan, 'without a panner node the sound uses the stereo pan');
craft.x = 1000;
speakers.listenFrom(camera);
assert.ok(flat.pan.pan.value > 0.5, 'and its pan swings toward the craft');

const human = { id: 0 };
audio.human = human;
soundEvent('Test_Unit_Move', { Samples: 'Test_Move.wav', Is_2D: 'Yes', Is_Unit_Response_VO: 'Yes', Localize: 'No', Max_Instances: 1, Min_Volume: 100, Max_Volume: 100, Overlap_Test: 'Unit_A' });
soundEvent('Test_Advisor', { Samples: 'Test_Advisor.wav', Is_2D: 'Yes', Is_HUD_VO: 'Yes', Is_Ambient_VO: 'Yes', Min_Volume: 100, Max_Volume: 100 });
const cruiser = { x: audio.ear.x, y: audio.ear.y, dead: false };
const before = context.panners.length;
audio.playFor(human, 'Test_Unit_Move', cruiser);
await settle();
assert.equal(context.panners.length, before + 1, 'a unit reply is placed at its ship');
const voicePanner = context.panners.at(-1);
const reply = [...audio.following].find(s => s.voice);
assert.ok(reply, 'and follows it');
assert.equal(voicePanner.rolloffFactor, 0, 'the panner only places it, the voice falloff sets its level');
const near = reply.gain.gain.value;
cruiser.x += 4000;
audio.listenFrom(camera);
assert.equal(voicePanner.positionX.value, cruiser.x, 'the reply moves with the ship');
const far = reply.gain.gain.value;
assert.ok(far < near * 0.6, 'and gets quieter as the ship flies away');
cruiser.x += 100000;
audio.listenFrom(camera);
assert.ok(reply.gain.gain.value >= near * 0.19, 'but a far ship stays audible');
assert.equal(audio.positional.has(reply), false, 'voices never take a battle sound slot');

const flatBefore = context.panners.length;
audio.playFor(human, 'Test_Advisor', cruiser);
await settle();
assert.equal(context.panners.length, flatBefore, 'advisor lines stay flat');
assert.equal(audio.playFor({ id: 1 }, 'Test_Unit_Move', cruiser), false, 'other players never speak to you');
console.log('audio follow ok');
