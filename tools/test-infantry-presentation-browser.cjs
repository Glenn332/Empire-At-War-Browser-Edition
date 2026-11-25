// Optional retail-mounted browser check. Tests the visible laser batch / launcher model,
// not just the simulated fire position. BASE_URL, CHROME and --base as in test-shooter-view-browser.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
async function checkRoll(page, first, f, s) {
  // Sample the draw, before restoring the upright holder for simulation.
  await page.evaluate(first => {
    const sh = game.shooter;
    sh.setCfg('view', first ? 'first' : 'third');
    sh.zoom = false;
    sh.yaw = sh.pitch = 0;
    game.speed = 0.55;
    window.rollSamples = [];
    game.sameFrame = cam => {
      const d = sh.P.dash;
      if (!d) return;
      const k = sh.viewKit,
        tip = first && k?.muzzle.getWorldPosition(sh.eyeAt.clone()).project(cam),
        h = sh.body.holder;
      window.rollSamples.push({
        dir: [d.x, d.y],
        at: [sh.body.x, sh.body.y],
        up: h.matrixWorld.elements[10] / h.scale.z,
        bank: cam.matrixWorld.elements[2],
        y: tip && tip.y
      });
    };
  }, first);
  await page.waitForFunction(() => game.shooter.world.time > game.shooter.dodgeAt + 1.41);
  const keys = [f === 1 ? 'w' : f === -1 ? 's' : null, s === 1 ? 'd' : s === -1 ? 'a' : null].filter(Boolean);
  for (const k of keys) await page.keyboard.down(k);
  await page.keyboard.press('v');
  await page.waitForFunction(() => window.rollSamples.length > 0);
  for (const k of keys) await page.keyboard.up(k);
  await page.waitForFunction(() => !game.shooter.P.dash);
  const frames = await page.evaluate(() => {
    game.sameFrame = null;
    game.speed = 1;
    return window.rollSamples;
  });
  const l = Math.hypot(f, s),
    dx = f / l,
    dy = -s / l;
  assert.ok(
    frames.every(a => Math.abs(a.dir[0] - dx) < 0.001 && Math.abs(a.dir[1] - dy) < 0.001),
    'latched camera-relative direction'
  );
  const a = frames[0].at,
    b = frames.at(-1).at;
  assert.ok((b[0] - a[0]) * dx + (b[1] - a[1]) * dy > 1, 'roll travelled after key release');
  if (first)
    assert.ok(
      frames.some(f => Math.abs(f.bank) > 0.18 && f.y < -0.42),
      'first-person bank and gun tuck'
    );
  else
    assert.ok(
      frames.some(f => f.up < -0.6),
      'third-person model tumbled in the scene'
    );
  assert.ok(
    await page.evaluate(() => Math.abs(game.shooter.body.holder.quaternion.x) + Math.abs(game.shooter.body.holder.quaternion.y) < 0.0001),
    'upright before simulation'
  );
}
async function checkFocusedBolt(page, fp) {
  const sample = await page.evaluate(() => {
    const s = game.shooter,
      c = game.camera,
      L = game.shotLooks,
      b = s.body,
      src = s.shotSource;
    s.spread = 0.02; // sustained-fire bloom must not move the focus dot's aim point
    s.jitter(b);
    s.world.fire(b, s.spot, b.weapon);
    const shot = s.world.shots.at(-1),
      look = L.lookOf(shot.w.proj);
    // Advance one tick before first display, as can happen on a slow frame.
    for (const key of ['x', 'y', 'z']) shot[key] += shot['v' + key] / 30;
    const sim = [shot.x, shot.y, shot.z];
    L.update([shot], c, null, src);
    const batch = look.laser.kite ? L.kites : L.beams,
      v = s.eyeAt.clone(),
      dir = v.clone().set(...batch.b.slice(0, 3)),
      tail = v
        .clone()
        .set(...batch.a.slice(0, 3))
        .addScaledVector(dir, -(batch.a[3] / 2 + batch.b[3])),
      i = shot.w.fixed >= 0 ? shot.w.fixed : shot.w.turn,
      tip = (s.firstPerson ? src.barrels[i] : shot.w.muzzles[i].bone).getWorldPosition(v),
      delta = v.clone().set(shot.aimX, shot.aimY, shot.aimZ).sub(tip),
      pixel = a => Math.hypot((a.x * innerWidth) / 2, (a.y * innerHeight) / 2),
      rect = s.sight.el.getBoundingClientRect(),
      pip = v.clone().set((2 * (rect.left + rect.width / 2)) / innerWidth - 1, 1 - (2 * (rect.top + rect.height / 2)) / innerHeight, 0),
      dotMiss = pixel(delta.clone().add(tip).project(c).sub(pip)),
      lineError = dir.angleTo(delta),
      boreError = s.firstPerson && src.axis.clone().transformDirection(src.root.matrixWorld).angleTo(delta),
      muzzleMiss = pixel(tail.project(c).sub(tip.project(c)));
    return {
      dotMiss,
      lineError,
      boreError,
      muzzleMiss,
      width: batch.b[3] / look.wide,
      simIntact: sim.every((n, i) => n === [shot.x, shot.y, shot.z][i])
    };
  });
  console.log(fp ? 'focused first person' : 'focused shoulder', sample);
  assert.ok(sample.muzzleMiss < 1 && sample.dotMiss < 1 && sample.lineError < 0.002 && sample.simIntact);
  if (fp) assert.ok(sample.boreError < 0.005);
  assert.ok(sample.width > (fp ? 0.15 : 1.5));
}

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
    args: ['--enable-unsafe-swiftshader']
  });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } }),
      errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(base => {
      localStorage.setItem('swr.game', base ? 'eaw' : 'foc');
      localStorage.setItem('swr-shooter-hints', '1');
      localStorage.setItem('swr-shooter-settings', '{"shuttle":false}');
    }, process.argv.includes('--base'));
    await p.goto(
      new URL(
        '/play.html?autostart&mode=land&shooter&map=ENDOR&faction=Empire&enemy=Rebel&deployUI=2005',
        process.env.BASE_URL || 'http://localhost:8377'
      ).href
    );
    await p.locator('.sh-deploy .sh-go').waitFor({ timeout: 150000 });
    for (const name of ['Stormtrooper', 'Plex_Soldier', 'Han_Solo']) {
      await p.evaluate(async name => {
        const s = game.shooter,
          { db } = await import('/js/gamedata.js'),
          t = db.type(name),
          f = s.spawnSpots()[0] || s.world.units.find(u => u.side === s.me && !u.dead && !u.inside);
        s.spawning = true;
        try {
          // CP position and squad facing vary by edition; don't test a stride
          // by walking the fixture straight into a spawn building.
          let lane;
          for (let radius = 0; radius <= 18 && !lane; radius++) {
            for (let i = -radius; i <= radius && !lane; i++)
              for (let j = -radius; j <= radius && !lane; j++) {
                if (Math.max(Math.abs(i), Math.abs(j)) !== radius) continue;
                const x = f.x + 40 * i,
                  y = f.y + 40 * j;
                let clear = true;
                for (let dx = -20; dx <= 260 && clear; dx += 20)
                  for (let dy = -40; dy <= 40 && clear; dy += 20) clear = s.walkable(x + dx, y + dy, 1);
                if (clear) lane = [x, y];
              }
          }
          if (!lane) throw Error('no open gait test lane');
          const q = await s.world.spawn(t.name, ...lane, 0, s.me);
          s.possess(q, q.members[0], false);
        } finally {
          s.spawning = false;
        }
        s.body.heading = s.yaw = 0;
        s.pitch = 0;
        s.zoom = false;
        s.setCfg('view', 'third');
      }, name);
      for (const zoom of [false, true]) {
        await p.evaluate(zoom => {
          game.shooter.zoom = zoom;
        }, zoom);
        await p.waitForFunction(
          zoom => Math.abs(game.camera.fov - (zoom ? 32 : 70)) < 0.3 && Math.abs(game.shooter.shoulder - Number(zoom)) < 0.002,
          zoom
        );
        const frame = await p.evaluate(() => {
          const s = game.shooter,
            c = game.camera,
            head = s.body.inst.bone('B_HEAD').getWorldPosition(s.eyeAt.clone()).project(c),
            a = s.eyeAt.clone().set(s.aim.x, s.aim.y, s.aim.z).project(c),
            r = s.sight.el.getBoundingClientRect();
          const row = s.wpn.firstElementChild;
          return {
            head: [head.x, head.y],
            aim: [(1 + a.x) / 2, (1 - a.y) / 2],
            sight: [(r.left + r.right) / 2 / innerWidth, (r.top + r.bottom) / 2 / innerHeight],
            shape: s.sight.el.dataset.shape,
            heat: getComputedStyle(s.sight.el.querySelector('.bf-heat')).display,
            blades: getComputedStyle(s.sight.el.querySelector('.bf-blades')).display,
            opacity: getComputedStyle(s.sight.el).opacity,
            corners: ['::before', '::after'].map(p => getComputedStyle(row, p).content)
          };
        });
        if (zoom) {
          assert.ok(frame.head[0] < -0.2 && frame.head[0] > -0.92, `${name}: dot right of shoulder: ${frame.head}`);
          assert.deepEqual([frame.shape, frame.blades, frame.heat], ['focus', 'none', 'none']);
        } else assert.ok(Math.abs(frame.head[0]) < 0.2 && frame.head[1] < 0.15, `${name}: centered hip view: ${frame.head}`);
        assert.equal(frame.opacity, '0.2');
        assert.ok(
          frame.aim.every((v, i) => Math.abs(v - frame.sight[i]) < 0.002) &&
            Math.abs(frame.sight[0] - (zoom ? 0.47 : 0.5)) < 0.002 &&
            Math.abs(frame.sight[1] - 0.34) < 0.002,
          `${name} ${zoom}: ${JSON.stringify(frame)}`
        );
        assert.deepEqual(frame.corners, ['none', 'none']);
      }
      if (name === 'Stormtrooper') {
        await checkFocusedBolt(p, false);
        await checkRoll(p, false, 1, 1);
        await checkRoll(p, true, 0, -1);
      }
      await p.evaluate(() => {
        game.shooter.zoom = false;
        game.shooter.setCfg('view', 'first');
      });
      await p.waitForFunction(() => game.shooter.firstPerson && !!game.shooter.viewKit?.root);
      if (name === 'Stormtrooper') {
        await p.evaluate(() => {
          game.shooter.zoom = true;
        });
        await p.waitForFunction(() => Math.abs(game.camera.fov - 32) < 0.3);
        await checkFocusedBolt(p, true);
        await p.evaluate(() => {
          game.shooter.zoom = false;
        });
      }
      const poses = () =>
        p.evaluate(async () => {
          const s = game.shooter,
            res = [];
          // One full stride of simulation, not a fixed count of display frames.
          const until = s.world.time + 1.1;
          while (s.world.time < until) {
            await new Promise(requestAnimationFrame);
            const v = s.viewKit.muzzle.getWorldPosition(s.eyeAt.clone()).project(game.camera);
            res.push([v.x, v.y, s.body.v]);
          }
          return res;
        });
      await p.keyboard.down('KeyW');
      await p.waitForFunction(() => game.shooter.body.v > 1);
      const walk = await poses();
      assert.ok(Math.max(...walk.map(a => a[0])) - Math.min(...walk.map(a => a[0])) > 0.012, `${name} walk: ${JSON.stringify(walk)}`);
      await p.keyboard.down('ShiftLeft');
      await p.waitForFunction(() => game.shooter.viewKit.sprint > 0.85);
      const run = await poses();
      assert.ok(
        run.some(a => a[1] < -0.49 && a[0] < 0 && a[0] > -0.25),
        `${name} lowered sprint`
      );
      await p.keyboard.up('ShiftLeft');
      // Sample an actual fired projectile in the current animated stride. For a pill,
      // project the tail cap from the GPU batch values (the center is NOT the muzzle).
      const result = await p.evaluate(() => {
        const s = game.shooter,
          w = s.world,
          c = game.camera,
          k = s.viewKit,
          L = game.shotLooks;
        w.fire(s.body, s.spot, s.body.weapon);
        const shot = w.shots.at(-1);
        if (shot.from !== s.body) throw Error('no shot');
        const sim = [shot.x, shot.y, shot.z];
        L.update([shot], c, null, k);
        const look = L.lookOf(shot.w.proj),
          v = s.eyeAt.clone(),
          tip = (k.barrels[shot.w.fixed >= 0 ? shot.w.fixed : shot.w.turn] || k.muzzle).getWorldPosition(s.eyeAt.clone());
        const batch = look.kind === 'pill' && (look.laser.kite ? L.kites : L.beams);
        if (batch) {
          if (!batch.count) throw Error('no visible laser batch');
          const n = batch.a[3] / 2 + batch.b[3];
          v.set(batch.a[0] - n * batch.b[0], batch.a[1] - n * batch.b[1], batch.a[2] - n * batch.b[2]);
        } else if (look.kind === 'model') v.copy(L.live.get(shot).holder.position);
        else if (look.kind === 'fx') v.copy(L.live.get(shot).pose);
        else throw Error('invisible projectile');
        v.project(c);
        tip.project(c);
        return {
          kind: look.kind,
          px: Math.hypot(((v.x - tip.x) * innerWidth) / 2, ((v.y - tip.y) * innerHeight) / 2),
          unchanged: sim.every((a, i) => a === [shot.x, shot.y, shot.z][i])
        };
      });
      await p.keyboard.up('KeyW');
      console.log(name, result);
      assert.ok(result.px < 1 && result.unchanged, 'visible launch within one pixel; sim untouched');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: centered chase and right shoulder dot, reticle projection, cornerless kit, gait and actual muzzle-rendered shots');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
