import { binkHeader, binkChunkSize, NATIVE_BINK_FPS } from './binkdata.js';

const SLOTS = 8;
const streaming = () => !!globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function';
export class BinkPlayer {
  constructor(canvas, { onEnd = () => {}, onError = () => {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onEnd = onEnd;
    this.onError = onError;
    this.worker = null;
    this.id = 0;
    this.header = null;
    this.frames = new Map();
    this.pending = new Set();
    this.clock = 0;
    this.started = false;
    this.playing = false;
    this.loop = false;
    this.frame = -1;
    this.alpha = true;
    this.color = [255, 255, 255, 255];
    this.paused = false;
    this.skipElapsed = false;
  }
  async play(buffer, { loop = false, alpha = true, color = [255, 255, 255, 255], startFrame = 0 } = {}) {
    this.stop();
    const id = this.id,
      header = binkHeader(buffer);
    this.header = header;
    this.chunk = binkChunkSize(header);
    this.canvas.width = header.width;
    this.canvas.height = header.height;
    this.canvas.dataset.frame = '';
    this.loop = loop;
    this.alpha = alpha;
    this.color = color;
    this.startFrame = startFrame > 0 && startFrame + 1 < header.frames ? Math.trunc(startFrame) : 0;
    this.playing = true;
    this.source = buffer;
    this.retries = 0;
    if (!this.worker) this.spawn();
    else {
      const bytes = buffer.slice(0);
      this.worker.postMessage({ type: 'open', id, buffer: bytes }, [bytes]);
    }
    return header;
  }
  spawn() {
    this.worker?.terminate();
    this.worker = new Worker(new URL('./binkworker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => this.message(data);
    this.worker.onerror = e => this.failed(Error(e.message));
    const bytes = this.source.slice(0);
    this.worker.postMessage({ type: 'open', id: this.id, buffer: bytes }, [bytes]);
  }
  failed(error) {
    if (this.playing && this.retries < 2) {
      this.retries++;
      this.pending.clear();
      this.spawn();
      return;
    }
    this.stop();
    this.onError(error);
  }
  stream(start) {
    this.endStream();
    const bytes = this.header.width * this.header.height * 4;
    const ring = (this.ring = {
      control: new SharedArrayBuffer(16),
      pixels: new SharedArrayBuffer(SLOTS * bytes),
      base: start,
      read: 0,
      bytes,
      drawn: -1
    });
    ring.ctrl = new Int32Array(ring.control);
    ring.view = new Uint8Array(ring.pixels);
    this.worker.postMessage({ type: 'stream', id: this.id, control: ring.control, pixels: ring.pixels, slots: SLOTS, start });
  }
  endStream() {
    const r = this.ring;
    if (!r) return;
    Atomics.store(r.ctrl, 2, 1);
    Atomics.notify(r.ctrl, 1);
    this.ring = null;
  }
  fromRing(index) {
    const r = this.ring;
    if (!r) return false;
    const want = index - r.base,
      written = Atomics.load(r.ctrl, 0);
    if (want < r.read) {
      this.stream(index);
      return false;
    }
    while (r.read < want && r.read < written) {
      r.read++;
      Atomics.store(r.ctrl, 1, r.read);
      Atomics.notify(r.ctrl, 1);
    }
    if (r.read !== want || want >= written) return false;
    if (r.drawn !== index) {
      const image =
        this.image && this.image.width === this.header.width && this.image.height === this.header.height
          ? this.image
          : (this.image = new ImageData(this.header.width, this.header.height));
      const at = (want % SLOTS) * r.bytes;
      image.data.set(r.view.subarray(at, at + r.bytes));
      this.tint(image.data);
      this.ctx.putImageData(image, 0, 0);
      r.drawn = index;
      this.frame = index;
      this.canvas.dataset.frame = String(index);
    }
    return true;
  }
  tint(pixels) {
    const c = this.color;
    if (!this.alpha || c[0] !== 255 || c[1] !== 255 || c[2] !== 255)
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = (pixels[i] * c[0]) / 255;
        pixels[i + 1] = (pixels[i + 1] * c[1]) / 255;
        pixels[i + 2] = (pixels[i + 2] * c[2]) / 255;
        if (!this.alpha) pixels[i + 3] = 255;
      }
  }
  current() {
    return this.started ? (this.startFrame + Math.floor(this.clock * NATIVE_BINK_FPS)) % this.header.frames : this.startFrame;
  }
  message(data) {
    if (data.id !== this.id || !this.playing) return;
    if (data.type === 'error') {
      this.failed(Error(data.message));
      return;
    }
    if (data.type === 'ready') {
      if (streaming()) this.stream(this.current());
      else this.request(this.current());
      return;
    }
    if (data.type === 'frame') {
      const pixels = new Uint8ClampedArray(data.pixels),
        c = this.color;
      if (!this.alpha || c[0] !== 255 || c[1] !== 255 || c[2] !== 255)
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = (pixels[i] * c[0]) / 255;
          pixels[i + 1] = (pixels[i + 1] * c[1]) / 255;
          pixels[i + 2] = (pixels[i + 2] * c[2]) / 255;
          if (!this.alpha) pixels[i + 3] = 255;
        }
      this.frames.set(data.index, new ImageData(pixels, this.header.width, this.header.height));
      if (!this.started && this.frames.has(this.startFrame)) {
        this.started = true;
        this.draw(this.startFrame);
      }
    } else if (data.type === 'done') {
      this.pending.delete(data.start);
      this.retries = 0;
      const current =
        Math.floor(((this.startFrame + Math.floor(this.clock * NATIVE_BINK_FPS)) % this.header.frames) / this.chunk) * this.chunk;
      const next = data.start + this.chunk;
      if (data.start === current && next < this.header.frames) this.request(next);
    }
  }
  request(index) {
    const start = Math.floor(index / this.chunk) * this.chunk;
    if (this.frames.has(start) || this.pending.has(start)) return;
    this.pending.add(start);
    this.worker.postMessage({ type: 'decode', id: this.id, start, count: Math.min(this.chunk, this.header.frames - start) });
  }
  draw(index) {
    const image = this.frames.get(index);
    if (image && this.frame !== index) {
      this.ctx.putImageData(image, 0, 0);
      this.frame = index;
      this.canvas.dataset.frame = String(index);
    }
  }
  update(dt) {
    if (this.ring && this.playing && !this.started) {
      if (this.fromRing(this.startFrame)) this.started = true;
      return;
    }
    if (!this.playing || !this.started || this.paused) return;
    if (this.skipElapsed) {
      dt = 0;
      this.skipElapsed = false;
    }
    this.clock += dt;
    let index = this.startFrame + Math.floor(this.clock * NATIVE_BINK_FPS);
    if (index >= this.header.frames) {
      if (!this.loop) {
        this.stop();
        this.onEnd();
        return;
      }
      index %= this.header.frames;
    }
    if (this.ring) {
      if (index < this.ring.base) this.stream(index);
      this.fromRing(index);
      return;
    }
    this.request(index);
    this.draw(index);
    const chunk = Math.floor(index / this.chunk) * this.chunk,
      next = chunk + this.chunk < this.header.frames ? chunk + this.chunk : this.loop ? 0 : -1;
    if (next >= 0) this.request(next);
    for (const n of this.frames.keys())
      if (!(n >= chunk && n < chunk + this.chunk) && !(next >= 0 && n >= next && n < next + this.chunk)) this.frames.delete(n);
  }
  stop() {
    this.endStream();
    this.id++;
    this.playing = false;
    this.started = false;
    this.frames.clear();
    this.pending.clear();
    this.clock = 0;
    this.frame = -1;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  setPaused(on) {
    if (this.paused && !on) this.skipElapsed = true;
    this.paused = on;
  }
  dispose() {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }
}
