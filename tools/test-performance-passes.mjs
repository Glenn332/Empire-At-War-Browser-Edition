import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { shadowCacheKey, shadowRedrawDue } from '../public/js/game/shadowcache.js';
import { rebuildObstacleGrid } from '../public/js/game/spatialgrid.js';
import { projectedRadius, visualDetail, importantShadowCaster, shadowDue, effectBudget, workerCount, retainNearest, selectionTransformKey, commandBarStateKey, cinematicPresentation } from '../public/js/game/performance.js';
import { warmGpuBatches } from '../public/js/game/gpuwarmup.js';

// Large-battle presentation budgets scale with screen size and fleet pressure, never gameplay state.
{
  assert.equal(visualDetail(projectedRadius(100, 100, 1080, 42)), 2, 'near ships retain full detail');
  assert.equal(visualDetail(10), 1, 'medium ships use reduced presentation');
  assert.equal(visualDetail(3), 0, 'tiny ships skip decorative hardpoint work');
  assert.equal(importantShadowCaster({ casters: [{}], visualRadius: 100 }), true, 'capital ships cast');
  assert.equal(importantShadowCaster({ casters: [{}], visualRadius: 20 }), false, 'small ships do not cast');
  assert.equal(importantShadowCaster({ casters: [{}], visualRadius: 100, squad: {} }), false, 'squadron fighters do not cast');
  assert.equal(shadowDue(100, undefined), true);
  assert.equal(shadowDue(130, 100), false, 'dynamic shadows wait for their 15 Hz slot');
  assert.equal(shadowDue(170, 100), true);
  assert.equal(shadowRedrawDue(110, 100), false, 'WASD camera motion cannot bypass the shadow budget');
  assert.equal(shadowRedrawDue(170, 100), true, 'camera motion redraws at the next 15 Hz slot');
  assert.equal(shadowRedrawDue(110, 100), false, 'a changed caster set also waits for the shadow budget');
  const small = effectBudget(100), large = effectBudget(400);
  assert.ok(large.shotModels < small.shotModels && large.shotEffects < small.shotEffects && large.smokePerFrame < small.smokePerFrame);
  assert.ok(large.glowScale < small.glowScale && large.trailRate < small.trailRate && large.simpleParticles < small.simpleParticles, 'large fleets reduce transparent overdraw');
  assert.ok(effectBudget(10000).shotModels >= 180, 'even extreme battles retain a useful visual baseline');
  assert.equal(workerCount('routes', 4), 1);
  assert.equal(workerCount('scan', 4), 1);
  assert.equal(workerCount('collect', 4), 0);
  assert.equal(workerCount('decode', 4), 1);
  assert.ok(workerCount('scan', 12) <= 5 && workerCount('routes', 12) <= 3, 'high-core machines remain bounded');
  assert.equal(cinematicPresentation({ cine: { on: true } }), true, 'arrival shots skip tactical HUD work');
  assert.equal(cinematicPresentation({ tacticalCinematics: { on: true } }), true, 'scripted shots skip tactical HUD work');
  assert.equal(cinematicPresentation({ cine: { on: false } }), false, 'normal play retains tactical HUD work');
}

// Nearest-shot selection retains exactly the same set as sorting, without quadratic scans.
{
  for (let n = 0; n < 300; n++) {
    const items = Array.from({ length: n }, (_, id) => ({ id })),
      selected = [],
      limit = Math.min(37, n);
    for (const item of items) retainNearest(selected, item, (item.id * 7919) % 101, limit);
    const expected = items.map(item => ({ id: item.id, d: (item.id * 7919) % 101 })).sort((a, b) => a.d - b.d || a.id - b.id).slice(0, limit);
    assert.deepEqual(selected.map(item => item.id), expected.map(item => item.id));
  }
}

// GPU warm-up performs one real tiny draw per batch, yields between batches, uploads textures
// once and restores the previous target. A failed batch is retried instead of disabling the queue.
{
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
    material = new THREE.MeshBasicMaterial({ map: texture }),
    geometry = new THREE.BoxGeometry(),
    previous = new THREE.WebGLRenderTarget(8, 8),
    uploaded = new WeakSet();
  let target = previous,
    draws = 0,
    uploads = 0,
    compiles = 0;
  const renderer = {
    isWebGLRenderer: true,
    getRenderTarget: () => target,
    setRenderTarget: value => (target = value),
    initTexture: () => uploads++,
    compile: () => compiles++,
    render: () => draws++
  };
  await warmGpuBatches(renderer, new THREE.Camera(), [{ im: new THREE.InstancedMesh(geometry, material, 1) }], uploaded);
  assert.equal(draws, 1, 'driver work is forced by a real draw');
  assert.equal(compiles, 1);
  assert.equal(uploads, 1);
  assert.equal(target, previous, 'the live render target is restored');
  await warmGpuBatches(renderer, new THREE.Camera(), [{ im: new THREE.InstancedMesh(geometry, material, 1) }], uploaded);
  assert.equal(uploads, 1, 'texture upload is not repeated for later batches');
  previous.dispose();
}

// Preparing an unseen unit builds its batches without changing visibility or simulation state.
{
  const { Instances } = await import('../public/js/game/instances.js');
  const { instanceable } = await import('../public/js/model.js');
  const scene = new THREE.Scene(),
    obj = new THREE.Group(),
    material = new THREE.MeshBasicMaterial(),
    mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  instanceable.add(material);
  obj.add(mesh);
  obj.visible = false;
  scene.add(obj);
  const unit = { dead: false, obj, model: { billboards: [] }, hardpoints: [], turrets: [], x: 0, y: 0, z: 0 },
    batches = new Instances(scene),
    matrix = obj.matrix.clone();
  let compiled = 0;
  const fakeRenderer = { isWebGLRenderer: true, compile: () => compiled++, render() {}, setRenderTarget() {}, getRenderTarget: () => null };
  batches.prepareUnits([unit], fakeRenderer, new THREE.Camera());
  assert.equal(obj.visible, false, 'fog-hidden units stay hidden');
  assert.deepEqual(obj.matrix.elements, matrix.elements, 'preparation does not move the unit');
  assert.equal(compiled, 1, 'new batches are compiled before first visibility');
  assert.equal(batches.list[0].ready, false, 'a batch is not used while its asynchronous warm-up is pending');
  await batches.warming;
  assert.equal(batches.list[0].ready, true, 'the completed batch can now be instanced');
  batches.prepareUnits([unit], fakeRenderer, new THREE.Camera());
  assert.equal(compiled, 1, 'an unchanged model is not prepared every frame');
  batches.release(unit);
}

// Streaming movies draw the shared frame directly when no tint is needed.
{
  const { BinkPlayer } = await import('../public/js/bink.js');
  const oldImageData = globalThis.ImageData;
  globalThis.ImageData = class {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
  let drawn = null;
  const player = new BinkPlayer({ dataset: {}, getContext: () => ({ putImageData: image => (drawn = image), clearRect() {} }) });
  player.header = { width: 1, height: 1 };
  const pixels = new SharedArrayBuffer(8 * 4);
  player.ring = { base: 0, read: 0, bytes: 4, drawn: -1, pixels, view: new Uint8Array(pixels), ctrl: new Int32Array(new SharedArrayBuffer(16)) };
  player.ring.view.set([1, 2, 3, 255]);
  Atomics.store(player.ring.ctrl, 0, 1);
  assert.equal(player.fromRing(0), true);
  assert.equal(drawn.data.buffer, pixels, 'the canvas receives a view, not a copied full-frame buffer');
  assert.deepEqual([...drawn.data], [1, 2, 3, 255]);
  player.stop();
  if (oldImageData) globalThis.ImageData = oldImageData;
  else delete globalThis.ImageData;
}

// Large mixed selections keep their layout and do not repeatedly rescan every stack.
{
  const { layoutSelectionPanels } = await import('../public/js/game/commandbargroups.js');
  const player = { id: 0 },
    units = [];
  for (let i = 0; i < 240; i++) {
    const type = { name: 'Type_' + (i % 40) };
    units.push({ id: i, type, player, abilities: [], isMobile: true });
  }
  const layout = layoutSelectionPanels(units, new Map(), 0, 0);
  assert.equal(layout.items.length, 24);
  assert.ok(layout.totalColumns >= 12, 'the complete selection remains scrollable');
  assert.ok(layout.items.some(item => item?.group), 'large stacks collapse into bounded slots');
}

// Selection merging is linear, preserves order and does not replay story/audio for a repeated Ctrl+A.
{
  const { UI } = await import('../public/js/game/ui.js');
  const player = { id: 0 },
    units = Array.from({ length: 100 }, (_, id) => ({ id, player, selected: false, type: { str: () => '' } }));
  let stories = 0,
    voices = 0;
  const ui = Object.create(UI.prototype);
  Object.assign(ui, {
    selection: [],
    player,
    hudTimer: 1,
    game: { tacticalStory: { selected: list => (stories += list.length) } },
    voiceOf: () => null,
    speak: () => voices++
  });
  ui.select(units);
  assert.equal(ui.selection.length, 100);
  assert.equal(stories, 100);
  assert.equal(voices, 1);
  assert.equal(ui.hudTimer, 0, 'a changed selection refreshes on the next frame');
  ui.select(units);
  assert.equal(stories, 100, 'an identical selection does not replay story events');
  assert.equal(voices, 1, 'an identical selection does not replay audio');
  ui.select(units.slice(0, 50), true);
  assert.equal(ui.selection.length, 100, 'duplicates are removed with Set membership');
  ui.select([]);
  assert.ok(units.every(unit => !unit.selected), 'clearing selection clears every unit flag');
}

// Dirty keys change only when the corresponding presentation state changes.
{
  const player = { id: 0, pop: 10, popCap: 20, techLevel: 1, reinforcements: [] },
    unit = { id: 1, player, x: 1, y: 2, z: 3, heading: 0.5, ringSize: 20, ringZ: 2, healthFrac: 1, shield: 50, maxShield: 100, abilities: [] },
    selection = [unit],
    world = { units: [unit] },
    ui = { armed: null, placing: null },
    bar = { unitScroll: 0, buildScroll: 0 };
  unit.buildQueues = new Map();
  const ring = selectionTransformKey(selection, player),
    hud = commandBarStateKey(selection, world, player, ui, bar);
  assert.equal(selectionTransformKey(selection, player), ring);
  assert.equal(commandBarStateKey(selection, world, player, ui, bar), hud);
  unit.x += 1;
  assert.notEqual(selectionTransformKey(selection, player), ring, 'moving a selected ship rebuilds its ring');
  unit.healthFrac = 0.84;
  assert.notEqual(commandBarStateKey(selection, world, player, ui, bar), hud, 'a displayed health threshold refreshes the HUD');
  const beforeQueue = commandBarStateKey(selection, world, player, ui, bar);
  unit.buildQueues.set('space', [{ type: { name: 'Test' }, left: 2, total: 4 }]);
  assert.notEqual(commandBarStateKey(selection, world, player, ui, bar), beforeQueue, 'build queues invalidate the HUD');
}

// F2 diagnostics expose percentiles and the worst frame in the current sample window.
{
  const { Diag } = await import('../public/js/diag.js');
  const d = new Diag();
  for (let i = 1; i <= 100; i++) d.recent[i - 1] = i;
  d.filled = 100;
  const stats = d.frameStats();
  assert.equal(stats.median, 50);
  assert.equal(stats.p95, 95);
  assert.equal(stats.p99, 99);
  assert.equal(stats.worst, 100);
  assert.ok(Math.abs(stats.low1 - 1000 / 99) < 1e-9);
}

// The F2 overlay is a pure read-out: it carries no save button (reports belong in the bug report
// and the diag panel), so the overlay stays pointer-transparent and battle controls never compete
// with overlay input.
{
  const source = readFileSync(new URL('../public/js/benchoverlay.js', import.meta.url), 'utf8');
  assert.ok(!/<button[^>]+data-k="save"/.test(source), 'the F2 overlay has no save button');
  assert.ok(!/pointer-events:auto/.test(source), 'the overlay stays pointer-transparent');
}

// The diag save action downloads a JSON report containing benchmark and diagnostic metrics.
{
  const { Diag } = await import('../public/js/diag.js');
  const d = new Diag(),
    oldDocument = globalThis.document,
    oldURL = globalThis.URL,
    oldWindow = globalThis.window;
  let downloaded = '',
    revoked = '';
  const link = { click() {}, remove() {} };
  globalThis.window = {};
  globalThis.document = { body: { appendChild() {} }, createElement: () => link };
  globalThis.URL = { createObjectURL: blob => ((downloaded = blob), 'blob:test'), revokeObjectURL: () => (revoked = 'yes') };
  try {
    const result = await d.saveReport({ benchmark: { avgFps: 60 } });
    assert.equal(result.saved, true);
    assert.match(result.name, /^eaw-performance_.*\.json$/);
    assert.equal(downloaded.type, 'application/json');
    const saved = JSON.parse(await downloaded.text());
    assert.equal(saved.benchmark.avgFps, 60);
    assert.ok(saved.diagnostics.frameStats);
    assert.equal(revoked, '', 'object URL remains alive until the download starts');
  } finally {
    if (oldDocument) globalThis.document = oldDocument;
    else delete globalThis.document;
    if (oldURL) globalThis.URL = oldURL;
    else delete globalThis.URL;
    if (oldWindow) globalThis.window = oldWindow;
    else delete globalThis.window;
  }
}

// Shadow maps are reused only while the exact camera and caster transforms remain unchanged.
{
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 100);
  camera.updateMatrixWorld();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld();
  const unit = { dead: false, casters: [mesh], obj: { visible: true, matrix: new THREE.Matrix4() }, x: 0 };
  const units = [unit],
    casts = () => true;
  const first = shadowCacheKey(camera, units, casts);
  assert.equal(shadowCacheKey(camera, units, casts), first, 'a quiet frame reuses its shadow map');
  mesh.position.x = 1;
  mesh.updateMatrixWorld();
  assert.notEqual(shadowCacheKey(camera, units, casts), first, 'a moving turret or part invalidates shadows');
  const moved = shadowCacheKey(camera, units, casts);
  unit.obj.visible = false;
  assert.notEqual(shadowCacheKey(camera, units, casts), moved, 'visibility invalidates shadows');
  unit.obj.visible = true;
  camera.position.x = 2;
  camera.updateMatrixWorld();
  assert.notEqual(shadowCacheKey(camera, units, casts), moved, 'camera movement invalidates shadows');
}

// The incremental obstacle index is exactly equivalent to the former full rebuild.
{
  const state = {},
    units = [];
  for (let i = 0; i < 80; i++) units.push({ id: i, x: (i % 10) * 700 - 3000, y: Math.floor(i / 10) * 800 - 2500, radius: 50 + i * 3, hitRadius: 70, collR: 0, type: { obstacle: i % 7 !== 0 } });
  const eligible = type => type.obstacle,
    cull = () => null;
  const full = () => {
    const grid = new Map();
    for (const o of units) {
      if (o.dead || o.hyper || !eligible(o.type)) continue;
      const r = Math.max(o.radius || 0, o.hitRadius || 0, o.collR || 0) + 80;
      for (let x = Math.floor((o.x - r) / 1024); x <= Math.floor((o.x + r) / 1024); x++)
        for (let y = Math.floor((o.y - r) / 1024); y <= Math.floor((o.y + r) / 1024); y++) {
          const key = x * 65536 + y;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(o.id);
        }
    }
    return [...grid].filter(([, list]) => list.length).sort((a, b) => a[0] - b[0]);
  };
  const check = () => {
    rebuildObstacleGrid(state, units, 1024, 80, eligible, cull);
    const actual = [...state.grid].filter(([, list]) => list.length).map(([key, list]) => [key, list.map(o => o.id)]).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(actual, full());
  };
  for (let step = 0; step < 100; step++) {
    const u = units[step % units.length];
    u.x += step % 3 === 0 ? 1100 : 17;
    if (step % 11 === 0) u.hyper = !u.hyper;
    if (step % 17 === 0) u.dead = !u.dead;
    if (step % 23 === 0) u.radius += 200;
    check();
    const before = state.rebuilds;
    rebuildObstacleGrid(state, units, 1024, 80, eligible, cull);
    assert.equal(state.rebuilds, before, `quiet step ${step} writes no obstacle cells`);
  }
  units.splice(5, 1);
  check();
}

// The battle frame consults the live presentation policy, not the state at gate construction.
{
  const source = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8'),
    frame = source.match(/  frame\(now\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(frame, 'the battle frame loop is present');
  assert.match(frame, /new FrameGate\(\(\) =>\s+battleFrameCap\(/);
  assert.match(frame, /this\.paused,[\s\S]*?this\.cine\?\.on/);
}

// Live frames build missing batches, but startup explicitly owns all driver warm-up draws.
// Re-entering shader compilation from the render loop stalls exactly when a cinematic hands back to play.
{
  const source = readFileSync(new URL('../public/js/game/render.js', import.meta.url), 'utf8'),
    draw = source.match(/  draw\(world, r, dt\) \{([\s\S]*?)\n  async skinCompare/)?.[1];
  assert.ok(draw, 'the space draw method is present');
  assert.doesNotMatch(draw, /prepareUnits\(world\.units, r, cam\)|shotModels\.prepare\(r, cam\)/);
  assert.match(draw, /instances\.prepareUnits\(world\.units\)/, 'newly arriving units still get their CPU batch work');
}

// Linux WebKitGTK receives raw POST bytes, not a Blob whose custom-scheme resolution segfaults.
{
  const { appRequestBody } = await import('../public/js/platform.js'),
    oldWindow = globalThis.window;
  globalThis.window = { __TAURI_INTERNALS__: {} };
  try {
    const body = await appRequestBody(new Blob(['report bytes']));
    assert.ok(body instanceof ArrayBuffer, 'desktop Blob bodies become raw bytes before fetch');
    assert.equal(new TextDecoder().decode(body), 'report bytes');
    globalThis.window = {};
    const browserBlob = new Blob(['browser']);
    assert.equal(await appRequestBody(browserBlob), browserBlob, 'browser downloads keep their Blob');
  } finally {
    if (oldWindow) globalThis.window = oldWindow;
    else delete globalThis.window;
  }
}

// The Linux AppImage writes reports directly: opening WebKitGTK's native chooser can segfault the app.
{
  const source = readFileSync(new URL('../src-tauri/src/report.rs', import.meta.url), 'utf8'),
    linux = source.match(/#\[cfg\(any\(mobile, target_os = "linux"\)\)\]\npub fn save[\s\S]*?\n\}/)?.[0];
  assert.ok(linux, 'Linux shares the direct report save path');
  assert.match(linux, /data_dir\(\)\.join\("reports"\)/);
  assert.doesNotMatch(linux, /FileDialog|save_file/);
}

// Post-processing allocates only enabled effect targets and uses the cheap copy path without bloom/heat.
{
  globalThis.fetch = async () => new Response(null, { status: 404 });
  const { PostFX } = await import('../public/js/game/post.js');
  const renderer = {
    getPixelRatio: () => 1,
    setRenderTarget(target) { this.target = target; },
    render() { this.draws = (this.draws || 0) + 1; },
    getClearColor: out => out.setRGB(0, 0, 0),
    getClearAlpha: () => 1,
    setClearColor() {},
    clear() {}
  };
  const post = new PostFX(renderer);
  post.resize(800, 600);
  post.finish = () => {};
  assert.equal(post.begin(), true);
  assert.deepEqual(Object.keys(post.targets).sort(), ['mid', 'scene'], 'no disabled-effect render targets');
  post.end(new THREE.Camera());
  assert.equal(post.quad.material, post.mCopy, 'one texture read when bloom and heat are off');
  assert.equal(renderer.draws, 1, 'only the final copy is drawn');
  post.bloom = true;
  post.begin();
  assert.ok(post.targets.a1 && post.targets.a2 && !post.targets.heat, 'enabling bloom allocates only bloom targets');
  renderer.draws = 0;
  post.end(new THREE.Camera());
  assert.equal(renderer.draws, 6, 'bright pass, four blur passes and combine');
  assert.equal(post.quad.material, post.mCombine);
  post.bloom = false;
  post.begin();
  assert.deepEqual(Object.keys(post.targets).sort(), ['mid', 'scene'], 'disabling bloom releases its targets on the next pass');
}

// The overlay icon stamp cache evicts old entries instead of clearing wholesale: a large mod
// battle draws more distinct stamps than the cap, and a cleared cache rebuilds every icon on
// the screen each frame, which froze WebKitGTK for seconds at the enemy fleet and reinforcements.
{
  const source = readFileSync(new URL('../public/js/game/ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /stamps\.clear\(\)/, 'the stamp cache never clears wholesale');
  assert.match(source, /stamps\.delete\(k\)/, 'the oldest stamps are evicted one by one');
  assert.doesNotMatch(source, /stampGen \+ 1|stampGen\+\+/, 'eviction does not globally invalidate live stamps');
}

console.log('shadow cache, post-processing and incremental obstacle grid: ok');
