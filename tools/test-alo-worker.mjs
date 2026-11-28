import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';

// Browser-shaped module Worker backed by Node's worker_threads for an actual parser round trip.
let started = 0;
class BrowserWorker {
  constructor(url) {
    started++;
    this.worker = new NodeWorker(url);
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.(error));
  }
  postMessage(message, transfer) {
    this.worker.postMessage(message, transfer);
  }
  terminate() {
    this.worker.terminate();
  }
}
globalThis.Worker = BrowserWorker;
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 4 }, configurable: true });

const { loadALO } = await import('../public/js/alo.js');
const chunk = (type, body = new Uint8Array(), container = false) => {
  const out = new Uint8Array(8 + body.length),
    view = new DataView(out.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, body.length | (container ? 0x80000000 : 0), true);
  out.set(body, 8);
  return out;
};
const join = parts => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
};
const name = new TextEncoder().encode('TEST_SHIP');
globalThis.fetch = async () => new Response(join([chunk(0x400, chunk(0x401, name), true)]), { status: 200 });
const loaded = await loadALO('worker-round-trip.alo');
assert.ok(started > 0, 'the parser worker was started');
assert.equal(loaded.meshes[0].name, 'TEST_SHIP');
assert.equal(loaded.isParticle, false);
console.log('ALO worker parsing: ok');
