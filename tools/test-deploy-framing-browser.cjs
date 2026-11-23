// Optional integration test: run the dev server with retail data mounted first.
// Requires playwright-core and Chrome. Overrides: BASE_URL, CHROME. No asset export.
// node tools/test-deploy-framing-browser.cjs [--base]
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

async function measure(page, name) {
  return page.evaluate(async name => {
    const { db } = await import('/js/gamedata.js');
    const s = game.shooter,
      preview = s.bf.preview,
      type = db.type(name);
    await preview.show(type, s.world.teamColorFor(s.me, type), s.iconOf(type));
    if (!preview.inst) throw new Error(`${name}: no model rendered`);
    preview.draw();
    const gl = preview.gl.getContext(),
      w = gl.drawingBufferWidth,
      h = gl.drawingBufferHeight;
    const rgba = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    let l = w,
      r = -1,
      b = h,
      t = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (rgba[(x + y * w) * 4 + 3] < 100) continue;
        l = Math.min(l, x);
        r = Math.max(r, x);
        b = Math.min(b, y);
        t = Math.max(t, y);
      }
    const rect = preview.host.getBoundingClientRect(),
      go = s.go.getBoundingClientRect();
    const x = (l + r + 1) / (2 * w),
      y = (t + b + 1) / (2 * h);
    return {
      x,
      y,
      margin: Math.min(l / w, (w - 1 - r) / w, b / h, (h - 1 - t) / h),
      ink: r >= l && t >= b,
      spawnOffset: (rect.left + x * rect.width - go.left - go.width / 2) / innerWidth
    };
  }, name);
}

(async () => {
  const edition = process.argv.includes('--base') ? 'eaw' : 'foc';
  const browser = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
    headless: true,
    args: ['--enable-unsafe-swiftshader']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(id => localStorage.setItem('swr.game', id), edition);
    await page.goto(
      new URL(
        '/play.html?autostart&mode=land&shooter&map=ENDOR&faction=Empire&enemy=Rebel&deployUI=2005',
        process.env.BASE_URL || 'http://127.0.0.1:8377'
      ).href
    );
    await page.locator('.bf-model.rendered canvas').waitFor({ timeout: 150000 });
    // Base Endor begins with neutral posts. Let the AI capture one normally.
    await page.waitForFunction(() => game.shooter.spawnSpots().length > 0, null, { timeout: 90000 });
    const { names, actualEdition } = await page.evaluate(async () => {
      game.paused = true;
      const { db } = await import('/js/gamedata.js'),
        { animOverride } = await import('/js/game/land.js'),
        { edition } = await import('/js/edition.js');
      const models = new Map();
      for (const t of db.types.values()) {
        const file = t.str('Land_Model_Name'),
          movement = t.str('MovementClass');
        if (!file || !movement || t.num('Max_Speed', 0) <= 0) continue;
        const vehicle =
          t.list('CategoryMask').some(n => /^(VEHICLE|AIR)$/i.test(n)) ||
          /^(GroundVehicle|Mobile_Defense_Unit|LandBombingUnit)$/i.test(t.tag);
        if (!vehicle) continue;
        const key = `${file}|${animOverride(t)}`.toUpperCase();
        if (!models.has(key)) models.set(key, t.name);
      }
      return { names: [...models.values()], actualEdition: edition() };
    });
    assert.equal(actualEdition, edition);
    assert(names.length >= (edition === 'eaw' ? 26 : 47), 'incomplete stock mobile vehicle catalog');
    const check = async name => {
      const p = await measure(page, name);
      assert(
        p.ink && Math.abs(p.x - 0.5) < 0.045 && Math.abs(p.y - 0.5) < 0.045 && Math.abs(p.spawnOffset) < 0.03 && p.margin > 0.015,
        `${name}: ${JSON.stringify(p)}`
      );
    };
    for (const name of names) await check(name);
    for (const size of [
      { width: 1440, height: 810 },
      { width: 390, height: 844 }
    ]) {
      await page.setViewportSize(size);
      for (const name of ['Scout_Trooper', 'AT_ST_Walker', 'T4B_Tank', 'Squad_Stormtrooper']) await check(name);
    }
    // Go through the actual selector, not just the preview API. Two bikes are
    // one card and switching layouts keeps the same match and deployable class.
    await page.setViewportSize({ width: 1280, height: 960 });
    const scoutLabel = await page.evaluate(async () => {
      const s = game.shooter,
        p = s.spawnSpots()[0];
      s.chooseSpawn(p);
      s.spawning = true;
      try {
        for (let i = 0; i < 2; i++) await game.world.spawn('Scout_Trooper', p.x + i * 20, p.y, 0, s.me);
      } finally {
        s.spawning = false;
      }
      s.refreshDeploy(true);
      return s.cardName(s.cards().find(c => c.unit.name === 'Scout_Trooper'));
    });
    const scout = page.locator('.bf-card').filter({ has: page.getByText(scoutLabel, { exact: true }) });
    assert.equal(await scout.count(), 1);
    await scout.click();
    await page.waitForFunction(() => game.shooter.bf.preview.unit === game.shooter.pick.unit && game.shooter.bf.preview.inst);
    await page.evaluate(() => game.shooter.setCfg('deployUI', 'original'));
    await page.locator('.sh-card.on').waitFor();
    await page.evaluate(() => game.shooter.setCfg('deployUI', '2005'));
    await page.locator('.bf-model.rendered canvas').waitFor();
    assert.equal(await page.locator('.bf-card.on strong').innerText(), scoutLabel);
    // Exercise the preserved Deploy button too, not just a layout round-trip.
    if (edition === 'eaw') await page.evaluate(() => game.shooter.setCfg('deployUI', 'original'));
    await page.evaluate(() => (game.paused = false));
    await page.locator('.sh-deploy .sh-go').click();
    await page.waitForFunction(() => game.shooter.state === 'alive' && !!game.shooter.rideQ, null, { timeout: 90000 });
    assert.deepEqual(errors, []);
    console.log(
      `${edition}: ${names.length}/${names.length} mobile vehicle model/rig pairs centered and unclipped; widescreen and portrait spot checks passed.`
    );
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
