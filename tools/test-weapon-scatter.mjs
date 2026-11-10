import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { fireNum, swapMode } = await import('../public/js/game/weaponswap.js');
const { World } = await import('../public/js/game/sim.js');

const kind = (name, tags, projectiles = []) => ({
  name,
  _swap: undefined,
  sub: () => [],
  has: k => k in tags,
  num: (k, d) => (k in tags ? +tags[k] : d),
  list: k => (k === 'Projectile_Types' ? projectiles : [])
});
const bare = kind('Proj_Bare', {}),
  own = kind('Proj_Own', { Projectile_Fire_Recharge_Seconds: 3, Projectile_Fire_Pulse_Count: 2, Projectile_Fire_Pulse_Delay_Seconds: 0.4 });
const unitTags = { Projectile_Fire_Recharge_Seconds: 5, Projectile_Fire_Pulse_Count: 4, Projectile_Fire_Pulse_Delay_Seconds: 0.3 };
const two = kind('Two_Guns', unitTags, ['Proj_Bare', 'Proj_Own']),
  one = kind('One_Gun', unitTags, ['Proj_Bare']);
assert(swapMode(two) && !swapMode(one));
assert.equal(fireNum(two, own, 'Projectile_Fire_Recharge_Seconds', 1), 3, 'swap mode: the projectile numbers');
assert.equal(
  fireNum(two, bare, 'Projectile_Fire_Recharge_Seconds', 1),
  0,
  'a projectile without its own recharge has the type default, not the unit one'
);
assert.equal(fireNum(two, bare, 'Projectile_Fire_Pulse_Count', 1), 1);
assert.equal(fireNum(two, bare, 'Projectile_Fire_Pulse_Delay_Seconds', 0.2), 1);
assert.equal(fireNum(one, bare, 'Projectile_Fire_Recharge_Seconds', 1), 5, 'one projectile: the unit numbers');

const proj = db.type('Proj_Ship_Small_Laser_Cannon_Red'),
  fighter = db.type('TIE_Fighter'),
  xwing = db.type('X-Wing');
assert(proj && fighter && xwing);
assert(
  xwing.has('Fire_Inaccuracy_Distance') && !xwing.has('Targeting_Fire_Inaccuracy'),
  'a craft lists a hardpoint tag the type does not read'
);
const world = Object.assign(Object.create(World.prototype), {
  jammers: [],
  projectiles: [],
  pickHardpoint: () => null,
  inConeFrom: () => true
});
const shooter = {
  type: xwing,
  player: { team: 0 },
  bonus: { damage: 1 },
  mods: { damageDealt: 1 },
  abilities: [],
  attackRange: 450
};
const target = { x: 400, y: 0, z: 0, type: fighter, player: { team: 1 }, hitRadius: 10, heading: 0 };
const fire = (inaccuracy, opts = { range: 400 }) => {
  world.projectiles.length = 0;
  world.launch(proj, shooter, target, null, 0, 0, 0, 'Damage_Default', inaccuracy, opts);
  const p = world.projectiles[0];
  return Math.hypot(p.aim.x - 400, p.aim.y, p.aim.z);
};
const xwingWeapon = [new Map(xwing.tuples('Targeting_Fire_Inaccuracy').map(([c, v]) => [c.toUpperCase(), parseFloat(v)]))];
for (let i = 0; i < 50; i++) assert.equal(fire(xwingWeapon), 0, 'no Targeting_Fire_Inaccuracy on the craft: its own guns aim true');
let widest = 0;
for (let i = 0; i < 400; i++) {
  const d = fire(
    new Map([
      ['CORVETTE', 500],
      ['FIGHTER', 10]
    ])
  );
  assert(d <= 20 * Math.sqrt(3) + 1e-6, 'a hardpoint scatters by twice its Fire_Inaccuracy_Distance at its reach');
  widest = Math.max(widest, d);
}
assert(widest > 10 * Math.sqrt(3), 'the space scatter is doubled');
for (let i = 0; i < 100; i++) assert.equal(fire(new Map([['CORVETTE', 500]])), 0, 'no entry for any category of the target');
const near = [];
for (let i = 0; i < 400; i++) near.push(fire([new Map([['FIGHTER', 5]]), new Map([['FIGHTER', 10]])], { range: 400 }));
assert(
  Math.max(...near) > 10 * Math.sqrt(3) * (400 / 450) && Math.max(...near) <= 20 * Math.sqrt(3) * (400 / 450) + 1e-6,
  'swap mode: the wider of unit and projectile, over Targeting_Max_Attack_Distance'
);
shooter.abilities = [{ active: true, def: { node: { num: k => (k === 'Targeting_Fire_Inaccuracy_Fixed_Radius_Override' ? 30 : 0) } } }];
const fixed = [];
for (let i = 0; i < 400; i++) fixed.push(fire(xwingWeapon));
assert(Math.max(...fixed) > 30 && Math.max(...fixed) <= 30 * Math.sqrt(3) + 1e-6, 'an active fixed radius override is taken as it is');
console.log('weapon scatter ok');
