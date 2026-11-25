// Frame caps (galaxy, battles, menu backdrop) and the memory fixes: orders and battle results copied into the window
// that keeps them, render targets that free their GPU textures on dispose(), particle batches that shrink back and
// lasers that upload only the shots in flight.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as THREE from 'three';

// no game files here: textures the batches ask for are simply missing
globalThis.fetch = async () => new Response(null, { status: 404 });

const { FrameGate, MENU_FPS, menuFrameCap, frameCap, gfx } = await import('../public/js/gfx.js');

// draws a gate lets through over `seconds` of a screen refreshing at `hz` (with an optional jitter in ms)
function draws(cap, hz, seconds = 10, jitter = 0) {
  const gate = new FrameGate(cap);
  let n = 0,
    seed = 7;
  for (let i = 0; i < hz * seconds; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const at = (i * 1000) / hz + (jitter ? ((seed / 4294967296) * 2 - 1) * jitter : 0);
    if (!gate.skip(at)) n++;
  }
  return n / seconds;
}

{
  assert.equal(draws(60, 60), 60, 'a 60 Hz screen under a 60 cap draws every refresh');
  assert.ok(draws(60, 60, 10, 1.5) >= 59.5, 'and keeps every refresh with a little timing jitter');
  const fast = draws(60, 144);
  assert.ok(fast <= 60.5 && fast >= 55, `a 144 Hz screen under a 60 cap draws ${fast} a second`);
  const fastest = draws(60, 240);
  assert.ok(fastest <= 60.5 && fastest >= 55, `a 240 Hz screen under a 60 cap draws ${fastest} a second`);
  assert.ok(draws(60, 75) <= 60.5, 'a 75 Hz screen stays under the cap');
  assert.equal(draws(0, 144), 144, 'no cap draws every refresh');
  const menu = draws(MENU_FPS, 144);
  assert.ok(menu <= 30.5 && menu >= 27, `the menu backdrop on a 144 Hz screen draws ${menu} a second`);
  assert.ok(Math.abs(draws(MENU_FPS, 60) - 30) <= 0.15, 'and every other refresh of a 60 Hz screen');
  const was = gfx.fpsCap;
  gfx.fpsCap = 60;
  assert.equal(frameCap(), 60);
  assert.equal(menuFrameCap(), MENU_FPS, 'the menu backdrop is capped below the battle cap');
  gfx.fpsCap = 0;
  assert.equal(frameCap(), 0, 'the option turns the battle cap off');
  assert.equal(menuFrameCap(), MENU_FPS, 'the menu backdrop stays capped');
  gfx.fpsCap = 20;
  assert.equal(menuFrameCap(), 20, 'a lower battle cap also holds for the menu');
  gfx.fpsCap = was;
  // a skipped refresh runs nothing: the drawn ones see all the time that passed, so game time is the same
  const gate = new FrameGate(60);
  let last = 0,
    seen = 0;
  for (let i = 1; i <= 1440; i++) {
    const now = (i * 1000) / 144;
    if (gate.skip(now)) continue;
    seen += now - last;
    last = now;
  }
  assert.ok(Math.abs(seen - last) < 1e-9 && last > 9950, 'the drawn frames cover all of the elapsed time');
}

// An object made in another window (a battle frame) keeps that whole window alive while anything holds it.
const otherRealm = vm.runInNewContext('({ alive: ["U1", "U2"], credits: { EMPIRE: { credits: 5 } }, flags: [[1, 2]] })');
assert.notEqual(Object.getPrototypeOf(otherRealm.alive), Array.prototype, 'the test object really comes from another realm');
{
  const { ownCopy } = await import('../public/js/game/plainobject.js');
  const copy = ownCopy(otherRealm);
  assert.deepEqual(copy, JSON.parse(JSON.stringify(otherRealm)));
  assert.equal(Object.getPrototypeOf(copy), Object.prototype, 'the copy is made in this realm');
  assert.equal(Object.getPrototypeOf(copy.alive), Array.prototype, 'down to its arrays');
  assert.equal(Object.getPrototypeOf(copy.credits.EMPIRE), Object.prototype);
  const live = { fn() {} };
  assert.equal(ownCopy(live), live, 'something that cannot be copied is kept as it is');
  assert.equal(ownCopy(null), null);
}

{
  const { Lockstep, wireCopy } = await import('../public/js/game/netgame.js');
  const session = { on: () => () => {}, send() {}, broadcast() {} };
  const game = {
    setup: {
      players: [
        { human: true, peer: 0 },
        { human: true, peer: 1 }
      ]
    },
    message() {}
  };
  const lock = new Lockstep(game, { session, me: 0 });
  clearInterval(lock.pinger);
  const cmd = { c: 'result', id: 3, r: otherRealm, skip: undefined, far: Infinity };
  lock.command(cmd);
  const [[pid, kept]] = lock.collected;
  assert.equal(pid, lock.hostPlayer);
  assert.notEqual(kept, cmd, 'the host keeps its own copy of its order');
  assert.deepEqual(kept, JSON.parse(JSON.stringify(cmd)), 'the very order its peers get over the wire');
  assert.equal(Object.getPrototypeOf(kept.r.alive), Array.prototype, 'made in the window that keeps the order log');
  assert.ok(!('skip' in kept) && kept.far === null, 'undefined and Infinity read as a peer reads them');
  assert.equal(wireCopy('x'), 'x');
  const client = new Lockstep(game, { session: { ...session, send: (to, m) => (client.sent = m) }, me: 1 });
  clearInterval(client.pinger);
  client.command({ c: 'move' });
  assert.equal(client.collected.length, 0, 'a client sends its orders to the host');
  assert.equal(client.sent.cmd.c, 'move');
}

// The WebGPU renderer frees a render target's textures when it is disposed, and gives every target its own gen.
{
  globalThis.GPUTextureUsage ||= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  const { GPURenderer } = await import('../public/js/gpu/renderer.js');
  let made = 0,
    destroyed = 0;
  const device = {
    createTexture: () => {
      made++;
      return { createView: () => ({}), destroy: () => destroyed++ };
    }
  };
  const r = Object.create(GPURenderer.prototype);
  Object.assign(r, {
    device,
    targets: new WeakMap(),
    textures: new WeakMap(),
    depthViews: new WeakMap(),
    clears: new Map(),
    trash: [],
    encoder: null
  });
  const shadow = new THREE.WebGLRenderTarget(64, 64, { depthBuffer: true });
  shadow.depthTexture = new THREE.DepthTexture(64, 64);
  const s = r.targetOf(shadow);
  assert.equal(made, 2, 'a colour and a depth texture');
  assert.ok(r.depthViews.get(shadow.depthTexture), 'its depth can be sampled');
  const other = new THREE.WebGLRenderTarget(64, 64, { depthBuffer: true });
  other.depthTexture = new THREE.DepthTexture(64, 64);
  const s2 = r.targetOf(other);
  assert.notEqual(s.gen, s2.gen, 'two targets never share a gen, so a cached pass bind group cannot outlive one');
  shadow.dispose();
  assert.equal(destroyed, 2, 'dispose() destroys its textures at once when no frame is being recorded');
  assert.equal(r.targets.get(shadow), undefined);
  assert.equal(r.depthViews.get(shadow.depthTexture), undefined);
  assert.equal(r.textures.get(shadow.texture), undefined);
  r.encoder = {};
  other.dispose();
  assert.equal(destroyed, 2, 'while a frame is recorded they wait for it to be submitted');
  assert.equal(r.trash.length, 2);
  r.encoder = null;
  const again = r.targetOf(shadow);
  assert.ok(again !== s && again.gen > s2.gen, 'a target used after dispose() is made anew');
  shadow.dispose();
  shadow.dispose();
  assert.equal(destroyed, 4, 'disposing twice frees once');
}

// Particle batches shrink back after a big fight; lasers upload only the shots in flight.
{
  globalThis.Worker ||= class {
    postMessage() {}
  };
  const { Batch } = await import('../public/js/particles.js');
  const b = new Batch(null, false, false, false, { value: null });
  const big = 20000,
    src = n => new Float32Array(n * 4);
  b.set(big, src(big), src(big), src(big), new Float32Array(big), src(big));
  assert.ok(b.cap >= big, 'a batch grows to the fight');
  const grown = b.cap;
  for (let i = 0; i < 2400; i++) b.set(i % 2 ? 100 : 0, src(100), src(100), src(100), new Float32Array(100), src(100));
  assert.ok(b.cap < grown && b.cap >= 200, `and shrinks back once the fight is over (${grown} to ${b.cap})`);
  assert.equal(b.center.array.length, b.cap * 4, 'its buffers with it');
  const steady = b.cap;
  for (let i = 0; i < 4800; i++) b.set(150, src(150), src(150), src(150), new Float32Array(150), src(150));
  assert.equal(b.cap, steady, 'a steady load does not make it grow and shrink over and over');
  assert.equal(b.count, 150);
  assert.deepEqual(b.center.updateRanges, [{ start: 0, count: 600 }], 'only the live particles are uploaded');

  const { LaserBatch } = await import('../public/js/game/laser.js');
  const L = new LaserBatch(4000, false);
  const look = { u: 0, v: 0, size: 0.25, r: 1, g: 1, b: 1 };
  L.begin();
  L.add(0, 0, 0, 1, 0, 0, 10, 2, look);
  L.add(0, 0, 0, 1, 0, 0, 10, 2, look);
  const versions = L.attrs.map(a => a.version);
  L.end();
  assert.equal(L.mesh.geometry.instanceCount, 2);
  assert.deepEqual(
    L.attrs.map(a => a.updateRanges),
    L.attrs.map(a => [{ start: 0, count: 2 * a.itemSize }]),
    'two shots upload two shots, not the pool of 4000'
  );
  assert.ok(L.attrs.every((a, i) => a.version > versions[i]));
  L.begin();
  const quiet = L.attrs.map(a => a.version);
  L.end();
  assert.deepEqual(
    L.attrs.map(a => a.version),
    quiet,
    'no shots, no upload'
  );
}

console.log('frame caps and render memory: ok');
