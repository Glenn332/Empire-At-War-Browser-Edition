import assert from 'node:assert/strict';
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { Shooter } = await import('../public/js/game/shooter.js');

const world = { time: 0, units: [] },
  body = { foot: true },
  sounds = [],
  s = Object.assign(Object.create(Shooter.prototype), {
    world,
    body,
    melee: false,
    role: 'rocket',
    gun: { kind: 'ammo', heat: 0, hot: false, lastShot: -9, per: 0.1, ammo: 4, max: 4, refillAt: 0, reloadAt: 0, kick: 0.05 },
    twist: { kick: 0 },
    P: {},
    pitch: 0,
    yaw: 0,
    kickDebt: 0,
    scopedShots: new Set(),
    sfx: k => sounds.push(k),
    inHealZone: () => false
  });
const tick = secs => {
  for (let i = 0; i < secs * 30; i++) {
    world.time += 1 / 30;
    s.coolGun(1 / 30);
  }
};

for (let i = 0; i < 4; i++) {
  assert(s.canFire());
  s.recoil(body, { w: 1 });
}
assert.equal(s.gun.ammo, 0);
assert(!s.canFire(), 'empty gun must not fire');
assert(s.gun.reloadAt > 0, 'empty gun starts reloading by itself');
tick(1.5);
assert(!s.canFire() && s.gun.ammo === 0, 'still reloading halfway');
tick(2);
assert.equal(s.gun.ammo, 4, 'reload refills the magazine');
assert(s.canFire() && !s.gun.reloadAt);
assert(sounds.includes('reload') && sounds.includes('loaded'));

s.recoil(body, { w: 1 });
s.reload();
assert(s.gun.reloadAt > 0 && !s.canFire(), 'manual reload on a partial magazine');
tick(3.5);
assert.equal(s.gun.ammo, 4);
s.reload();
assert.equal(s.gun.reloadAt, 0, 'full magazine does not reload');

const bot = { foot: true, side: 1, weapon: {}, health: 10, maxHealth: 10 };
Object.assign(s, { ammoOf: new WeakMap(), ammoAt: new WeakMap(), reloadOf: new WeakMap(), antiArmor: () => true, aiShooter: () => true, home: () => null, healing: false });
world.units = [bot];
for (let i = 0; i < 6; i++) s.shotFired({ from: bot, w: bot.weapon });
assert.equal(s.rocketsLeft(bot), 0);
assert(s.reloadOf.has(bot), 'bot starts reloading when empty');
world.time += 3.1;
s.regen();
assert.equal(s.rocketsLeft(bot), 6, 'bot reloads without a heal zone');
console.log('shooter reload ok');
