import assert from 'node:assert/strict';
import { Audio } from '../public/js/audio.js';

Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'X11; Linux x86_64' }, configurable: true });
globalThis.window = { __TAURI_INTERNALS__: {} };
const contexts = [];
class FakeContext {
  constructor() {
    this.state = 'suspended';
    this.destination = {};
    this.created = [];
    contexts.push(this);
  }
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  createBufferSource() {
    const source = {
      connect() {},
      disconnect() {},
      stop() {},
      start() {
        source.started = true;
      }
    };
    this.created.push(source);
    return source;
  }
  async decodeAudioData() {
    return { duration: 60 };
  }
  async resume() {
    this.state = 'running';
  }
}
window.AudioContext = FakeContext;
globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
globalThis.SWR_OVERLAY = {
  async read(path) {
    assert.match(path, /^DATA\\AUDIO\\MUSIC\\/);
    return new Uint8Array([1, 2, 3]);
  }
};
const audio = new Audio();
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
audio.setPlaylist(['EMPIRE_AT_WAR.MP3'], false, true);
await settle();
assert.equal(contexts.length, 1, 'Linux music never falls back to HTMLAudio before the first click');
assert.ok(audio.music.buffer, 'the track is decoded while audio is locked');
assert.equal(audio.music.buffer.duration, 60);
assert.equal(audio.music.paused, false, 'the decoded track is ready to play');
assert.equal(audio.ctx.created.length, 1, 'Web Audio queues the source while the context is locked');
audio.unlock();
await settle();
assert.equal(audio.ctx.state, 'running');
assert.equal(audio.music.paused, false);
assert.equal(audio.music.source.started, true, 'the queued track starts after unlock');
assert.equal(audio.music.volume, audio.musicLevel(), 'the fade API can read the current volume');
audio.setPlaylist(['EMPIRE_AT_WAR.MP3'], true, true);
await settle();
assert.equal(audio.music.source.started, true, 'fading in a new track still starts it');
audio.stopMusic();
assert.equal(audio.music, null);
assert.equal(audio.playlist.length, 0);
console.log('locked Linux music and fade lifecycle ok');
