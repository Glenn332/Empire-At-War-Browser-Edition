// Retail camera regression: keep a real trooper's chest under the drawn pip through both transitions.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
    args: ['--enable-unsafe-swiftshader']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(base => {
      localStorage.setItem('swr.game', base ? 'eaw' : 'foc');
      localStorage.setItem('swr-shooter-hints', '1');
      localStorage.setItem('swr-shooter-settings', '{"shuttle":false}');
    }, process.argv.includes('--base'));
    await page.goto(
      (process.env.BASE_URL || 'http://localhost:8377') +
        '/play.html?autostart&mode=land&shooter&map=ENDOR&faction=Empire&enemy=Rebel&deployUI=2005'
    );
    await page.locator('.sh-deploy .sh-go').waitFor({ timeout: 150000 });
    const seq = await page.evaluate(async () => {
      const s = game.shooter,
        w = s.world,
        c = game.camera,
        f = s.spawnSpots()[0] || w.units.find(u => u.side === s.me && !u.dead && !u.inside);
      s.spawning = true;
      let e;
      try {
        const q = await w.spawn('Stormtrooper', f.x + 40, f.y, 0, s.me);
        s.possess(q, q.members[0], false);
        e = (await w.spawn('Rebel_Trooper', s.body.x + 120, s.body.y, 0, 1)).members[0];
      } finally {
        s.spawning = false;
      }
      s.setCfg('view', 'third');
      // Freeze gameplay while advancing the production camera at 60 Hz. Only
      // this target is in the lane, so the test doesn't depend on spawn traffic.
      const units = w.units;
      w.units = [s.body, e];
      try {
        e.holder.visible = true;
        s.yaw = s.pitch = s.shake = s.kickDebt = s.dip = 0;
        s.smoothZ = s.body.z;
        s.zoom = false;
        const vec = () => s.eyeAt.clone();
        const aimAtChest = () => {
          const a = vec().set(e.x, e.y, e.z + s.heightOf(e) * 0.62);
          // Random spawn positions can start with a terrain-shortened boom.
          // Let it settle before using one frame as the transition reference.
          for (let i = 0; i < 100; i++) {
            s.frame(1 / 60, c);
            const d = vec().copy(a).sub(c.position);
            s.yaw = Math.atan2(d.y, d.x);
            s.pitch = Math.atan2(d.z, Math.hypot(d.x, d.y));
          }
          s.frame(1 / 60, c);
          if (s.aimHit !== e) throw Error('fixture: hip reticle did not acquire enemy');
          return vec().set(s.aim.x, s.aim.y, s.aim.z);
        };
        const target = aimAtChest(),
          rows = [];
        for (const [zoom, frames] of [
          [true, 72],
          [false, 72],
          [true, 4],
          [false, 2],
          [true, 72]
        ]) {
          s.zoom = zoom;
          let worst = 0,
            worldDrift = 0,
            dropped = 0,
            x,
            y;
          for (let i = 0; i < frames; i++) {
            s.frame(1 / 60, c);
            c.updateMatrixWorld();
            const a = target.clone().project(c),
              r = s.sight.el.getBoundingClientRect();
            x = (r.left + r.width / 2) / innerWidth;
            y = (r.top + r.height / 2) / innerHeight;
            worst = Math.max(worst, Math.hypot(((a.x + 1) / 2 - x) * innerWidth, ((1 - a.y) / 2 - y) * innerHeight));
            worldDrift = Math.max(worldDrift, target.distanceTo(vec().copy(s.aim)));
            if (s.aimHit !== e) dropped++;
          }
          const head = s.body.inst.bone('B_HEAD').getWorldPosition(vec()).project(c);
          rows.push({ zoom, worst, worldDrift, dropped, x, y, headX: (head.x + 1) / 2, headY: (1 - head.y) / 2 });
        }
        const yaw = s.yaw,
          pitch = s.pitch;
        s.yaw += 0.42;
        s.pitch += 0.16;
        s.frame(1 / 60, c);
        if (s.aimHit === e || target.distanceTo(vec().copy(s.aim)) < 10)
          throw Error('shoulder sight stuck to the old target after looking away');
        s.yaw = yaw;
        s.pitch = pitch;
        // Turning past terrain can retract the boom; returning eases it out.
        for (let i = 0; i < 100; i++) s.frame(1 / 60, c);
        if (s.aimHit !== e || target.distanceTo(vec().copy(s.aim)) > 0.01)
          throw Error(`did not reacquire the original chest point: ${target.distanceTo(vec().copy(s.aim))}`);
        return rows;
      } finally {
        w.units = units;
      }
    });
    console.log(seq);
    assert.ok(
      seq.every(r => r.worst < 1 && r.worldDrift < 0.01 && !r.dropped),
      'stationary chest must stay under the pip, including the first and last frames'
    );
    assert.ok(seq[0].x < 0.49 && seq[0].x > 0.44 && Math.abs(seq[0].y - 0.34) < 0.02, 'raised shoulder sight a little left of center');
    assert.ok(Math.abs(seq[1].x - 0.5) < 0.002 && Math.abs(seq[1].y - 0.34) < 0.002, 'ordinary chase unchanged');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
