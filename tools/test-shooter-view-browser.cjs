// Optional full-play check: dev server with retail data, Chrome, playwright-core.
// BASE_URL and CHROME override the local defaults; pass --base for original EaW.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
    args: ['--enable-unsafe-swiftshader']
  });
  const edition = process.argv.includes('--base') ? 'eaw' : 'foc';
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(id => {
      localStorage.setItem('swr.game', id);
      localStorage.setItem('swr-shooter-hints', '1');
      if (!localStorage.getItem('swr-shooter-settings')) localStorage.setItem('swr-shooter-settings', '{"shuttle":false}');
    }, edition);
    await p.goto(
      new URL(
        '/play.html?autostart&mode=land&shooter&map=ENDOR&faction=Empire&enemy=Rebel',
        process.env.BASE_URL || 'http://127.0.0.1:8377'
      ).href
    );
    await p.waitForFunction(() => !!globalThis.game?.shooter?.world.units.length, null, { timeout: 150000 });
    assert.equal(await p.evaluate(async () => (await import('/js/edition.js')).edition()), edition);
    await p.locator('.sh-deploy .sh-go').waitFor({ timeout: 90000 });
    await p.evaluate(async () => {
      const s = game.shooter;
      const { db } = await import('/js/gamedata.js');
      const type = db.type('Imperial_Stormtrooper') || db.type('Stormtrooper');
      const from = s.spawnSpots()[0] || s.world.units.find(u => u.side === s.me && !u.dead && !u.inside);
      // Supply an actual foot soldier in both editions; Endor need not have a barracks yet.
      s.spawning = true;
      let squad;
      try {
        squad = await game.world.spawn(type.name, from.x, from.y, 0, s.me);
      } finally {
        s.spawning = false;
      }
      s.possess(squad, squad.members[0], false);
    });
    await p.waitForFunction(() => game.shooter.state === 'alive' && game.camera.near === 1);
    await p.keyboard.press('b');
    await p.waitForFunction(() => !game.shooter.third && game.camera.near === 0.3 && !game.shooter.body.inside);
    await p.keyboard.press('o');
    assert.equal(await p.locator('select[name=view]').inputValue(), 'first');
    assert.equal(await p.locator('select[name=vehicleView]').inputValue(), 'chase');
    await p.locator('.sh-set .sh-go').click();
    const flyer = await p.evaluate(async () => {
      const { db } = await import('/js/gamedata.js');
      return [...db.types.values()].find(
        t => /flying/i.test(t.str('MovementClass')) && t.str('Land_Model_Name') && /speeder/i.test(t.name) && t.num('Max_Speed', 0) > 0
      )?.name;
    });
    assert.ok(flyer, 'stock land airspeeder found');
    for (const name of ['Scout_Trooper', 'T4B_Tank', 'AT_ST_Walker', flyer]) {
      await p.evaluate(async name => {
        const s = game.shooter,
          b = s.body;
        s.spawning = true;
        let q;
        try {
          q = await game.world.spawn(name, b.x + 60, b.y + 60, 0, s.me);
        } finally {
          s.spawning = false;
        }
        if (!q?.members?.length) throw Error(`No vehicle for ${name}`);
        s.drive(q);
      }, name);
      await p.waitForFunction(name => game.shooter.rideCamera?.unit.type.name === name && game.camera.near === 1, name);
      const shape = await p.evaluate(
        () =>
          new Promise(resolve => {
            // Sample during render, before the simulation restores non-interpolated positions.
            const s = game.shooter,
              draw = s.drawTags;
            s.drawTags = function (cam) {
              this.drawTags = draw;
              draw.call(this, cam);
              const u = s.rideCamera.unit,
                d = s.eyeAt.clone();
              cam.updateMatrixWorld();
              // Test actual projected hull and aim, not just the saved preference.
              const box = u.inst.box,
                ndc = [];
              u.holder.updateWorldMatrix(true, false);
              for (const x of [box.min.x, box.max.x])
                for (const y of [box.min.y, box.max.y])
                  for (const z of [box.min.z, box.max.z]) ndc.push(d.set(x, y, z).applyMatrix4(u.holder.matrixWorld).project(cam).clone());
              const aim = d.set(s.aim.x, s.aim.y, s.aim.z).project(cam);
              resolve({
                top: Math.max(...ndc.map(a => a.y)),
                bottom: Math.min(...ndc.map(a => a.y)),
                edge: Math.max(...ndc.map(a => Math.abs(a.x))),
                aim: Math.hypot(aim.x, aim.y)
              });
            };
          })
      );
      console.log(name, shape);
      assert.ok(
        shape.top < 0.12 && shape.bottom > -1 && shape.edge < 1 && shape.aim < 0.005,
        `${name}: hull below reticle and on screen; aim centered`
      );
      await p.keyboard.press('b');
      await p.waitForFunction(() => game.shooter.cockpit && game.camera.near === 0.3);
      assert.equal(await p.evaluate(() => game.shooter.third), false, 'seat change leaves foot preference alone');
      await p.keyboard.press('e');
      await p.waitForFunction(() => !game.shooter.seated() && !game.shooter.third && game.camera.near === 0.3);
      await p.keyboard.press('o');
      const select = p.locator('select[name=vehicleView]');
      assert.equal(await select.inputValue(), 'seat');
      if (name !== flyer) await select.selectOption('chase');
      await p.locator('.sh-set .sh-go').click();
    }
    await p.reload();
    await p.waitForFunction(() => !!globalThis.game?.shooter, null, { timeout: 150000 });
    assert.deepEqual(await p.evaluate(() => [game.shooter.third, game.shooter.cockpit]), [false, true]);
    assert.deepEqual(errors, []);
    console.log(`${edition}: B on foot, chase and driver views, E exit, settings sync and reload passed`);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
