// Optional full-play check: dev server with retail data, Chrome, playwright-core.
// BASE_URL and CHROME override the local defaults; pass --base for original EaW.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

async function checkCombatHud(p) {
  const layout = await p.evaluate(() => {
    const s = game.shooter,
      rect = el => el.getBoundingClientRect();
    return {
      radarTopRight: rect(s.radar).right > innerWidth * 0.96 && rect(s.radar).top < innerHeight * 0.08,
      compassBottom: rect(s.compass).bottom > innerHeight * 0.95,
      kitBottomLeft: rect(s.bars).left < innerWidth * 0.08 && rect(s.bars).bottom > innerHeight * 0.95,
      tickets: s.readout.banks.map(bank => {
        const crest = bank.querySelector('.bf-crest.has-art');
        return [bank.innerText, crest?.title, crest && getComputedStyle(crest).color];
      }),
      kit: s.bars.innerText,
      borders: [s.bars, s.hpBar.parentElement, s.wpnBar.parentElement].map(el => getComputedStyle(el).borderLeftWidth)
    };
  });
  assert.ok(layout.radarTopRight && layout.compassBottom && layout.kitBottomLeft);
  for (const [count] of layout.tickets) assert.match(count, /^\d+$/);
  assert.deepEqual(
    layout.tickets.map(t => t.slice(1)),
    [
      ['Empire', 'rgb(54, 134, 242)'],
      ['Rebel', 'rgb(185, 40, 39)']
    ]
  );
  assert.doesNotMatch(layout.kit, /kills|deaths|tickets/i);
  assert.deepEqual(layout.borders, ['0px', '0px', '0px']);
  const health = await p.evaluate(async () => {
    const s = game.shooter,
      b = s.body,
      w = s.world;
    let q;
    s.spawning = true;
    try {
      q = await w.spawn(
        b.type.name,
        b.x + 45,
        b.y,
        0,
        game.factions.findIndex(f => /rebel/i.test(f))
      );
    } finally {
      s.spawning = false;
    }
    const target = q.members[0],
      old = target.health,
      ro = s.readout,
      o = s.eyeAt.clone().set(target.x, target.y, target.z + s.heightOf(target) + 6);
    // Shoot a short sight line down onto the fixture, independent of random units near spawn.
    const dir = o.clone().set(0, 0, -1);
    if (s.aimRay(o, dir) !== target) throw Error('aim ray did not acquire the nearby opposing infantry');
    s.drawHud();
    const ink = () => getComputedStyle(s.sight.el.querySelector('.bf-pip')).fill;
    const before = [ro.el.dataset.mode, ro.fill.style.width, ink()];
    target.health = target.maxHealth * 0.4;
    s.drawHud();
    const loss = ro.track.querySelector('.bf-lost-hp');
    const after = [
      ro.label.textContent,
      ro.fill.style.width,
      getComputedStyle(ro.fill).backgroundColor,
      loss.style.left,
      loss.style.width,
      getComputedStyle(loss).backgroundColor
    ];
    target.health = old;
    s.aimRay(o.setZ(o.z + 5000), dir.set(0, 0, 1));
    s.drawHud();
    const off = [ro.el.dataset.mode, getComputedStyle(ro.center).visibility, ...ro.banks.map(b => b.getBoundingClientRect().width > 0)],
      emptyInk = ink();
    const side = target.side;
    target.side = s.me;
    s.aimRay(o.setZ(target.z + s.heightOf(target) + 6), dir.set(0, 0, -1));
    s.drawHud();
    const friendlyInk = ink();
    target.side = side;
    const sample = (unit, now) => {
      ro.aim(unit, () => 'Friendly', true, false, now);
      return [...ro.track.querySelectorAll('.bf-lost-hp')].map(el => [
        parseFloat(el.style.left),
        Math.round(parseFloat(el.style.width)),
        +el.style.opacity
      ]);
    };
    const ally = { type: b.type, health: 80, maxHealth: 100 };
    const pulses = [sample(ally, 1)]; // acquisition of an already damaged ally
    ally.health = 70;
    pulses.push(sample(ally, 20));
    ally.health = 60;
    pulses.push(sample(ally, 290), sample(ally, 560)); // distinct intervals and fade clocks
    ally.health = 100;
    pulses.push(sample(ally, 570)); // healing clears ghosts
    ally.health = 90;
    pulses.push(sample(ally, 600), sample(ally, 1200)); // expires even when still aimed
    ally.health = 80;
    pulses.push(sample(ally, 1250), sample(target, 1251), sample(null, 1252));
    const g = s.gun,
      states = [],
      original = { ...g };
    for (const [kind, heat, hot] of [
      ['heat', 0, false],
      ['heat', 0.05, false],
      ['heat', 0.5, false],
      ['heat', 1, true],
      ['heat', 0.1, true],
      ['ammo', 0, false]
    ]) {
      Object.assign(g, { kind, heat, hot });
      s.drawHud();
      states.push([
        s.sight.ticks.map(t => +t.classList.contains('lit')).join(''),
        s.sight.el.classList.contains('venting'),
        getComputedStyle(s.wpnBar.parentElement).display !== 'none'
      ]);
    }
    Object.assign(g, original);
    s.drawHud();
    return [before, after, off, pulses, emptyInk, friendlyInk, states];
  });
  assert.deepEqual(health[0], ['enemy', '100%', 'rgb(255, 80, 64)']);
  assert.ok(health[1][0]);
  assert.equal(health[1][1], '40%');
  assert.notEqual(health[1][2], 'rgb(255, 255, 255)');
  assert.deepEqual(health[1].slice(3), ['40%', '60%', 'rgb(255, 255, 255)']);
  assert.deepEqual(health[2], ['empty', 'hidden', true, true]);
  const pulses = health[3];
  assert.deepEqual(
    pulses.map(p => p.map(s => s.slice(0, 2))),
    [
      [],
      [[70, 10]],
      [
        [70, 10],
        [60, 10]
      ],
      [[60, 10]],
      [],
      [[90, 10]],
      [],
      [[80, 10]],
      [],
      []
    ]
  );
  assert.ok(pulses[2][0][2] > 0 && pulses[2][0][2] < 1 && pulses[2][1][2] === 1);
  assert.equal(health[4], 'rgb(196, 196, 196)');
  assert.equal(health[5], 'rgb(95, 179, 255)');
  assert.deepEqual(health[6], [
    ['000000000', false, false],
    ['000010000', false, false],
    ['001111100', false, false],
    ['111111111', true, false],
    ['000010000', true, false],
    ['000000000', false, true]
  ]);
  const capture = await p.evaluate(() => {
    const s = game.shooter,
      pt = s.world.points.find(p => p.reinforce && !p.locked),
      saved = { side: pt.side, taker: pt.taker, progress: pt.progress },
      result = [];
    try {
      for (const [side, taker, progress] of [
        [1, -2, 0.25],
        [1, -2, 0.75],
        [-1, -1, 0],
        [-1, 0, 0.25],
        [-1, 0, 0.75],
        [0, -1, 0],
        [0, -2, 0.75],
        [-1, 1, 0.75]
      ]) {
        Object.assign(pt, { side, taker, progress });
        s.drawCapture(pt);
        const d = s.captureDial;
        result.push([d.el.hidden, d.el.dataset.side, Number(d.arc.style.strokeDashoffset), d.emblem.firstChild.title]);
      }
    } finally {
      Object.assign(pt, saved);
    }
    return result;
  });
  assert.deepEqual(capture, [
    [false, 'enemy', 25, 'Rebel'],
    [false, 'enemy', 75, 'Rebel'],
    [false, 'neutral', 100, 'Neutral'],
    [false, 'ally', 75, 'Empire'],
    [false, 'ally', 25, 'Empire'],
    [false, 'ally', 0, 'Empire'],
    [false, 'ally', 75, 'Empire'],
    [false, 'enemy', 25, 'Rebel']
  ]);
  await p.keyboard.down('Tab');
  await p.locator('.sh-board:visible .sh-board-line').first().waitFor();
  assert.match(await p.locator('.sh-board').innerText(), /deaths.*score/i);
  await p.keyboard.up('Tab');
}

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
    await p.waitForFunction(() => !!game.shooter.viewKit?.root);
    const sweep = await p.evaluate(async () => {
      const s = game.shooter,
        c = game.camera,
        k = s.viewKit,
        v = s.eyeAt.clone(),
        result = [];
      const wait = () => new Promise(requestAnimationFrame);
      for (const [yaw, pitch] of [
        [0, 0],
        [2.9, 1.3],
        [-2.1, -1.35],
        [0, 0]
      ]) {
        s.yaw = yaw;
        s.pitch = pitch;
        await wait();
        const pos = k.muzzle.getWorldPosition(v).project(c);
        result.push([pos.x, pos.y, k.axis.clone().transformDirection(k.root.matrixWorld).angleTo(c.getWorldDirection(v))]);
      }
      return result;
    });
    for (const [x, y, angle] of sweep)
      assert.ok(Math.abs(x - 0.22) < 0.005 && Math.abs(y + 0.22) < 0.005 && angle < 0.09, `unsteady weapon: ${[x, y, angle]}`);
    await checkCombatHud(p);
    await p.keyboard.press('o');
    assert.equal(await p.locator('select[name=view]').inputValue(), 'first');
    assert.equal(await p.locator('select[name=aimMode]').inputValue(), 'hold');
    await p.locator('select[name=aimMode]').selectOption('toggle');
    assert.equal(await p.locator('select[name=vehicleView]').inputValue(), 'chase');
    await p.locator('.sh-set .sh-go').click();
    await p.mouse.click(640, 400);
    await p.waitForFunction(() => document.pointerLockElement === game.shooter.canvas());
    await p.mouse.click(640, 400, { button: 'right' });
    assert.equal(await p.evaluate(() => game.shooter.zoom), true, 'toggle zoom stays on after release');
    await p.mouse.click(640, 400, { button: 'right' });
    assert.equal(await p.evaluate(() => game.shooter.zoom), false);
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
      const kit = await p.evaluate(() => {
        const s = game.shooter,
          v = s.seatOf(),
          prev = [v.health, v.maxShield, v.shield];
        try {
          v.health = v.maxHealth * 0.6;
          v.maxShield = 100;
          v.shield = 35;
          s.drawHud();
          const out = [
            s.bars.innerText.trim(),
            s.vhN.textContent,
            s.hpBar.style.width,
            s.shBar.style.width,
            s.hpBar.parentElement === s.shBar.parentElement,
            s.shBar.hidden,
            getComputedStyle(s.wpn).display,
            getComputedStyle(s.shBar).borderTopWidth,
            s.vhGun.hidden
          ];
          v.shield = 0;
          s.drawHud();
          out.push(s.shBar.hidden, s.hpBar.style.width);
          return out;
        } finally {
          [v.health, v.maxShield, v.shield] = prev;
          s.drawHud();
        }
      });
      assert.ok(kit[1].length && kit[0].includes(kit[1]));
      assert.doesNotMatch(kit[0], /\d\s*\/\s*\d|km\/h|\balt\b/i);
      assert.deepEqual(kit.slice(2), ['60%', '35%', true, false, 'none', '2px', false, true, '60%']);
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
