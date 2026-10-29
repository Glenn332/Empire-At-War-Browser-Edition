import { fetchText, fetchBinary } from './vfs.js';
import { parseXML } from './xml.js';
import { languageName, speechFile } from './localizedmedia.js';
export { speechFile } from './localizedmedia.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const words = s =>
  String(s || '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
let definitions;
export function parseSpeechEvents(source) {
  const events = new Map();
  const visit = node => {
    if (key(node.tag) === 'SPEECHEVENT' && node.attrs.Name) {
      const files = node.all('Files').flatMap(n => words(n.text)),
        textIds = node.all('Text_ID').flatMap(n => words(n.text));
      events.set(key(node.attrs.Name), {
        name: node.attrs.Name,
        files,
        textIds,
        volume: Math.max(0, Math.min(100, Math.trunc(node.num('Volume_Percent', 100))))
      });
    }
    for (const child of node.children) visit(child);
  };
  visit(parseXML(source || ''));
  return events;
}
export function loadSpeechEvents() {
  return (definitions ||= fetchText('Data/XML/SpeechEvents.xml').then(parseSpeechEvents));
}
export class SpeechPlayer {
  constructor(audio, { events = null, random = Math.random, readBuffer = null } = {}) {
    this.audio = audio;
    this.events = events;
    this.random = random;
    this.readBuffer = readBuffer;
    this.loading = null;
    this.queue = [];
    this.suspended = 0;
    this.listeners = new Map();
    this.buffers = new Map();
    this.errors = new Map();
  }
  get language() {
    return languageName();
  }
  async load() {
    if (this.events) return this.events;
    if (!this.loading)
      this.loading = loadSpeechEvents().then(events => {
        this.events = events;
        return events;
      });
    return this.loading;
  }
  on(kind, callback) {
    const listeners = this.listeners.get(kind) || new Set();
    listeners.add(callback);
    this.listeners.set(kind, listeners);
    return () => listeners.delete(callback);
  }
  emit(kind, record) {
    for (const callback of [...(this.listeners.get(kind) || [])]) callback(record);
  }
  enqueue(name) {
    if (!String(name || '').trim()) return null;
    const event = this.events?.get(key(name));
    if (this.events && !event) {
      this.errors.set(String(name), 'Unknown SpeechEvent');
      return null;
    }
    const record = {
      name: event?.name || String(name),
      event,
      language: this.language,
      state: 'queued',
      file: '',
      textId: '',
      sample: -1,
      buffer: null,
      source: null,
      gain: null,
      offset: 0,
      startedAt: 0,
      duration: 0,
      reason: ''
    };
    this.queue.push(record);
    if (!this.events)
      this.load().catch(error => {
        this.errors.set(record.name, error.message);
      });
    return record;
  }
  replace(name) {
    this.clear(true);
    return this.enqueue(name);
  }
  async buffer(file, language = this.language) {
    const id = key(file);
    if (this.buffers.has(id)) {
      const value = this.buffers.get(id);
      this.buffers.delete(id);
      this.buffers.set(id, value);
      return value;
    }
    const value = this.readBuffer
      ? Promise.resolve().then(() => this.readBuffer(file, language))
      : fetchBinary(file, { language }).then(bytes => (bytes ? this.audio.ctx.decodeAudioData(bytes.slice(0)) : null));
    const safe = value.catch(error => {
      this.errors.set(file, error.message);
      return null;
    });
    this.buffers.set(id, safe);
    while (this.buffers.size > 4) this.buffers.delete(this.buffers.keys().next().value);
    return safe;
  }
  update() {
    if (this.suspended || !this.events || !this.queue.length) return;
    const record = this.queue[0];
    if (record.state === 'ended') {
      this.queue.shift();
      this.disconnect(record);
      record.buffer = null;
      this.emit('done', record);
      this.emit('storydone', record);
      return;
    }
    if (!record.event) {
      record.event = this.events.get(key(record.name));
      if (!record.event) {
        this.errors.set(record.name, 'Unknown SpeechEvent');
        this.queue.shift();
        return;
      }
      record.name = record.event.name;
    }
    if (!this.audio.ctx || this.audio.ctx.state !== 'running') return;
    if (record.state === 'queued') {
      const event = record.event;
      record.state = 'loading';
      if (!event.files.length) {
        this.fail(record, 'SpeechEvent has no Files');
        return;
      }
      record.sample = Math.min(event.files.length - 1, Math.floor(this.random() * event.files.length));
      record.file = speechFile(event.files[record.sample], record.language);
      record.textId = event.files.length === event.textIds.length ? event.textIds[record.sample] : '';
      this.buffer(record.file, record.language).then(buffer => {
        if (record.state !== 'loading') return;
        if (!buffer) {
          this.fail(record, 'Speech sample could not be opened');
          return;
        }
        record.buffer = buffer;
        record.duration = buffer.duration;
        record.state = 'ready';
        if (!this.suspended && this.audio.ctx.state === 'running') this.start(record);
      });
    } else if (record.state === 'ready' || record.state === 'paused') this.start(record);
  }
  start(record) {
    const context = this.audio.ctx;
    if (!record.buffer || this.suspended || context.state !== 'running') return;
    try {
      const source = context.createBufferSource(),
        gain = context.createGain();
      source.buffer = record.buffer;
      source.playbackRate.value = 1;
      gain.gain.value = (record.event.volume / 100) * this.audio.voiceVolume;
      source.connect(gain);
      gain.connect(this.audio.master);
      record.source = source;
      record.gain = gain;
      record.startedAt = context.currentTime;
      record.state = 'playing';
      source.onended = () => {
        if (record.source === source && record.state === 'playing') {
          record.offset = record.duration;
          record.state = 'ended';
          record.reason = 'ended';
        }
      };
      source.start(0, record.offset);
      this.emit('start', record);
    } catch (error) {
      this.fail(record, error.message);
    }
  }
  fail(record, message) {
    this.errors.set(record.name, message);
    record.state = 'ended';
    record.reason = 'failed';
  }
  disconnect(record) {
    if (record.source) {
      record.source.onended = null;
      try {
        record.source.stop();
      } catch {}
      record.source.disconnect();
      record.source = null;
    }
    record.gain?.disconnect();
    record.gain = null;
  }
  clear(notify = true) {
    const removed = this.queue.splice(0);
    for (const record of removed) {
      record.state = 'cancelled';
      record.reason = 'cancelled';
      this.disconnect(record);
      record.buffer = null;
    }
    if (notify) for (const record of removed) this.emit('storydone', record);
  }
  stopActive() {
    const record = this.queue[0];
    if (!record || !['playing', 'paused'].includes(record.state)) return;
    this.disconnect(record);
    record.state = 'ended';
    record.reason = 'stopped';
  }
  suspend() {
    if (this.suspended++ !== 0) return;
    const record = this.queue[0];
    if (record?.state !== 'playing') return;
    record.offset = Math.min(record.duration, record.offset + Math.max(0, this.audio.ctx.currentTime - record.startedAt));
    this.disconnect(record);
    record.state = 'paused';
  }
  resume() {
    if (this.suspended > 0) this.suspended--;
  }
  setVolume() {
    for (const record of this.queue) if (record.gain) record.gain.gain.value = (record.event.volume / 100) * this.audio.voiceVolume;
  }
  report() {
    return {
      suspended: this.suspended,
      queue: this.queue.map(r => ({
        name: r.name,
        file: r.file,
        state: r.state,
        textId: r.textId,
        offset: r.offset,
        duration: r.duration
      })),
      errors: Object.fromEntries(this.errors)
    };
  }
}
