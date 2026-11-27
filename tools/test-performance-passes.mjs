import assert from 'node:assert/strict';
import * as THREE from 'three';
import { shadowCacheKey, shadowRedrawDue } from '../public/js/game/shadowcache.js';
import { rebuildObstacleGrid } from '../public/js/game/spatialgrid.js';
import { projectedRadius, visualDetail, importantShadowCaster, shadowDue, effectBudget, workerCount } from '../public/js/game/performance.js';

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
  assert.equal(shadowRedrawDue(130, 100, false), false, 'WASD camera motion cannot bypass the shadow budget');
  assert.equal(shadowRedrawDue(170, 100, false), true, 'camera motion redraws at the next 15 Hz slot');
  assert.equal(shadowRedrawDue(130, 100, true), true, 'a changed caster set redraws immediately');
  const small = effectBudget(100), large = effectBudget(400);
  assert.ok(large.shotModels < small.shotModels && large.shotEffects < small.shotEffects && large.smokePerFrame < small.smokePerFrame);
  assert.ok(effectBudget(10000).shotModels >= 180, 'even extreme battles retain a useful visual baseline');
  assert.equal(workerCount('routes', 4), 1);
  assert.equal(workerCount('scan', 4), 1);
  assert.equal(workerCount('collect', 4), 0);
  assert.equal(workerCount('decode', 4), 1);
  assert.ok(workerCount('scan', 12) <= 5 && workerCount('routes', 12) <= 3, 'high-core machines remain bounded');
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

console.log('shadow cache, post-processing and incremental obstacle grid: ok');
