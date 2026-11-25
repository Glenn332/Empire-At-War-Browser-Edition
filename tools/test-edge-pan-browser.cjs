// Chrome + retail-mounted dev server. Real mouse events, no simulated scroll keys.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
    args: ['--enable-unsafe-swiftshader']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 700 } });
    const right = [1119, 300];
    for (const mode of ['land', 'space', 'galactic']) {
      await page.goto(
        new URL(`/play.html?autostart&mode=${mode}&map=ENDOR&faction=Empire&enemy=Rebel`, process.env.BASE_URL || 'http://localhost:8377')
          .href
      );
      if (mode === 'galactic') {
        // The opening campaign briefing owns the pointer until dismissed.
        await page.locator('.galactic-story-summary').waitFor({ timeout: 120000 });
        await page.evaluate(() => game.storyDialog.close());
      }
      await page.waitForFunction(
        mode => {
          const g = window.game;
          return (
            (mode === 'land'
              ? g?.world?.units.length && !g.warming
              : mode === 'space'
                ? g?.ui?.edgeCursor
                : g?.edgeCursor && g.panFree()) && document.elementFromPoint(1119, 300) === (g.renderer.dom || g.renderer.domElement)
          );
        },
        mode,
        { timeout: 150000 }
      );
      await page.mouse.move(570, 330);
      const initial = await page.evaluate(mode => {
        const v = mode === 'space' ? game.renderer.rig : game.view;
        const b =
          mode === 'land'
            ? { x0: game.map.playMin[0], x1: game.map.playMax[0], y0: game.map.playMin[1], y1: game.map.playMax[1] }
            : mode === 'space'
              ? { x0: v.bounds.minX, x1: v.bounds.maxX, y0: v.bounds.minY, y1: v.bounds.maxY }
              : game.bounds;
        v.x = (b.x0 + b.x1) / 2;
        v.y = (b.y0 + b.y1) / 2;
        v.yaw = 0;
        return mode === 'galactic' ? v.x : v.y;
      }, mode);
      await page.mouse.move(...right);
      await page.waitForFunction(
        ([mode, initial]) => (mode === 'space' ? game.renderer.rig.y : mode === 'land' ? game.view.y : game.view.x) > initial + 1,
        [mode, initial],
        { timeout: 8000 }
      );
      console.log(`PASS: real ${mode} right edge hover`);
      if (mode !== 'land') continue;
      const frames = () =>
        page.evaluate(async () => {
          for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
          return game.view.y;
        });
      let at = await frames();
      assert.ok((await frames()) > at, 'holding keeps scrolling');
      await page.mouse.move(570, 330);
      at = await frames();
      assert.equal(await frames(), at, 'stops in interior');
      await page.evaluate(async () => (await import('/js/game/keybinds.js')).setEdgePan(false));
      await page.mouse.move(...right);
      assert.equal(await frames(), at, 'stored opt-out honored');
      await page.keyboard.down('ArrowRight');
      assert.ok((await frames()) > at, 'keyboard still pans');
      await page.keyboard.up('ArrowRight');
      await page.evaluate(async () => {
        (await import('/js/game/keybinds.js')).setEdgePan(true);
        game.view.y = game.map.playMax[1] - 0.1;
      });
      assert.equal(await frames(), await page.evaluate(() => game.map.playMax[1]), 'clamps at map boundary');
      console.log('PASS: sustained land pan, stop, opt-out, keys, map bound');
    }
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
