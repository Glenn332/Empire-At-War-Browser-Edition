// GPU readback: render the retail land shot batch in isolation so a muzzle
// flash, sky bloom or HUD pixel can't make an edge-on sheet pass as a bolt.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
    args: ['--enable-unsafe-swiftshader']
  });
  try {
    const page = await b.newPage(),
      gpu = process.argv.includes('--gpu');
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (/GL_INVALID|WebGLProgram: Shader Error|GPUValidationError|Error while parsing WGSL/i.test(msg.text())) errors.push(msg.text());
    });
    await page.addInitScript(base => {
      localStorage.setItem('swr.game', base ? 'eaw' : 'foc');
      localStorage.setItem('swr-shooter-hints', '1');
    }, process.argv.includes('--base'));
    await page.goto(
      (process.env.BASE_URL || 'http://localhost:8377') +
        '/play.html?autostart&mode=land&shooter&map=ENDOR&faction=Empire&enemy=Rebel&deployUI=2005' +
        (gpu ? '' : '&webgl')
    );
    await page.locator('.sh-deploy .sh-go').waitFor({ timeout: 150000 });
    const result = await page.evaluate(async gpu => {
      const T = await import('three'),
        { db } = await import('/js/gamedata.js');
      const renderer = gpu ? game.gpu : game.renderer,
        looks = game.shotLooks,
        scene = new T.Scene(),
        N = 256;
      if (!renderer) throw Error('requested renderer unavailable');
      const cam = new T.PerspectiveCamera(42, 1, 0.1, 4000),
        target = new T.WebGLRenderTarget(N, N),
        bytes = new Uint8Array(N * N * 4);
      scene.background = new T.Color(0);
      for (const batch of looks.batches) {
        const draw = batch.mesh.clone();
        draw.visible = true;
        scene.add(draw);
      }
      await Promise.all(looks.batches.map(batch => batch.mesh.material.uniforms.map.value.userData.ready));
      if (looks.lookOf(db.type('Proj_Ship_Proton_Torpedo')).batch !== looks.kites) throw Error('missile lost its authored kite');
      await renderer.compileAsync(scene, cam);
      const prev = renderer.getRenderTarget(),
        cases = [];
      try {
        if (gpu) {
          // The project's WebGPU backend builds separate pipelines for offscreen targets.
          looks.update(['Proj_Hand_Blaster_Red', 'Proj_Hand_Jawa_Ion_Blaster'].map(type =>
            ({ x: 0, y: 0, z: -9, vx: 0, vy: 0, vz: -1, w: { proj: db.type(type) } })), cam, null);
          renderer.setRenderTarget(target);
          renderer.render(scene, cam);
          renderer.endFrame();
          renderer.setRenderTarget(prev);
          await renderer.settle();
        }
        for (const [type, label, dx, dz] of [
          ['Proj_Hand_Blaster_Red', 'tail', 0, -1],
          ['Proj_Hand_Blaster_Red', 'nose', 0, 1],
          ['Proj_Hand_Blaster_Red', 'oblique', 0.48, -0.877],
          ['Proj_Hand_Blaster_Red', 'side', 1, 0],
          ['Proj_Hand_Blaster_Green', 'green', 0, -1],
          ['Proj_Hand_Jawa_Ion_Blaster', 'ion nose', 0, 1],
          ['Proj_Hand_Jawa_Ion_Blaster', 'ion tail', 0, -1]
        ]) {
          const P = db.type(type);
          if (!P) throw Error('missing retail projectile ' + type);
          const s = { x: 0, y: 0, z: -9, vx: dx, vy: 0, vz: dz, w: { proj: P } };
          looks.update([s], cam, null);
          renderer.setRenderTarget(target);
          renderer.clear();
          renderer.render(scene, cam);
          if (gpu) {
            const done = renderer.readRenderTargetPixelsAsync(target, 0, 0, N, N, bytes);
            renderer.setRenderTarget(prev);
            await done;
          } else renderer.readRenderTargetPixels(target, 0, 0, N, N, bytes);
          let x0 = N,
            y0 = N,
            x1 = -1,
            y1 = -1,
            lit = 0,
            red = 0,
            green = 0;
          for (let y = 0; y < N; y++)
            for (let x = 0; x < N; x++) {
              const i = (y * N + x) * 4;
              if (Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) < 12) continue;
              x0 = Math.min(x, x0);
              y0 = Math.min(y, y0);
              x1 = Math.max(x, x1);
              y1 = Math.max(y, y1);
              red += bytes[i];
              green += bytes[i + 1];
              lit++;
            }
          const w = Math.max(0, x1 - x0 + 1),
            h = Math.max(0, y1 - y0 + 1);
          const at = (x, y) => Array.from(bytes.slice((y * N + x) * 4, (y * N + x) * 4 + 3));
          cases.push({
            label,
            w,
            h,
            lit,
            coverage: lit / (w * h || 1),
            red,
            green,
            center: at(128, 128),
            rim: at(128, 128 + Math.floor(h * 0.38))
          });
        }
      } finally {
        renderer.setRenderTarget(prev);
        target.dispose();
      }
      return cases;
    }, gpu);
    assert.deepEqual(errors, [], 'no shader or pipeline errors');
    console.table(result);
    for (const c of result) {
      assert.ok(c.h >= 6 && c.w >= 6, c.label + ': must retain visible thickness');
      if (!['oblique', 'side'].includes(c.label)) {
        assert.ok(Math.abs(c.w - c.h) < 3 && c.coverage > 0.62 && c.coverage < 0.89, c.label + ': circular, not a point or square');
        assert.ok(Math.max(...c.center) > Math.max(...c.rim) * 1.12, c.label + ': bright core fades into rim');
      } else {
        assert.ok(c.w > c.h * 1.5, c.label + ': elongated body');
        assert.ok(Math.max(...c.center) > 215, c.label + ': continuous luminous core, not separated dots');
      }
      if (c.label === 'green') assert.ok(c.green > c.red * 1.3, 'authored green bolt');
      else if (c.label.startsWith('ion')) assert.ok(c.center[2] > c.center[0] * 1.4 && c.center[2] > c.center[1], 'authored ion tint');
      else assert.ok(c.red > c.green * 1.3, 'authored red bolt');
    }
  } finally {
    await b.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
