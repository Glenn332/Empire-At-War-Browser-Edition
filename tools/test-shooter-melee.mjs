import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const archive = openGame(gameDir);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.addEventListener ??= () => {};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { LandWorld } = await import('../public/js/game/land.js');
const { Shooter } = await import('../public/js/game/shooter.js');

const vader = db.type('Darth_Vader'),
  trooper = db.type('Imperial_Stormtrooper') || db.type('Stormtrooper');
assert(vader && trooper);

const world = Object.assign(Object.create(LandWorld.prototype), {
  time: 0,
  wild: 3,
  shots: [],
  units: [],
  team: [0, 1, 2, 3],
  factions: [],
  mods: [],
  shields: []
});
world.fireDelay = () => 1;
const fired = [];
world.fire = (u, t, w) => {
  fired.push({ t, at: world.time });
  world.shots.push({ from: u, target: t, w, damage: w.damage });
};
let onceKinds = [];
world.oneShot = (u, KIND, during, pick) => {
  const vs = [{ duration: 0.9 }, { duration: 0.7 }, { duration: 1.5 }],
    a = pick(vs);
  onceKinds.push(vs.indexOf(a));
  u.once = during;
  u.onceEnd = world.time + a.duration;
  return true;
};
const unit = (type, x, side) => {
  const u = {
    type,
    x,
    y: 0,
    z: 0,
    side,
    heading: 0,
    foot: true,
    kind: 'INFANTRY',
    dead: false,
    hitRadius: 2,
    path: [],
    speed: 30,
    need: 1,
    squad: { native: false }
  };
  u.weapon = {
    proj: db.type(type.list('Projectile_Types')[0]),
    damage: 100,
    recharge: 1,
    cooldown: 0,
    left: 0,
    reach: type.num('Targeting_Max_Attack_Distance', 20)
  };
  u.range = u.weapon.reach;
  world.units.push(u);
  return u;
};
const me = unit(vader, 0, 0),
  foe = unit(trooper, 60, 1);
const sh = Object.assign(Object.create(Shooter.prototype), {
  world,
  game: { audio: null },
  body: me,
  shake: 0,
  dip: 0,
  eye: 10,
  swing: null,
  melee: false
});
sh.walkable = () => true;

assert.equal(sh.meleeOf(me), true, 'a short-reach unit is melee');
assert.equal(sh.meleeOf(foe), false, 'a rifleman is not melee');

const P = { fire: true, yaw: 0, dash: null };
const dt = 1 / 30;
let S = sh.swingStep(me, P, dt);
assert(S && S.dash > 0 && S.target === foe, 'the first swing picks the target ahead and lunges at it');
const x0 = me.x;
for (let i = 0; i < 6; i++) {
  world.time += dt;
  sh.swingStep(me, P, dt);
}
assert(me.x > x0 + 15, 'the lunge closes the gap: ' + me.x);
while (world.time < S.end - dt) {
  world.time += dt;
  sh.swingStep(me, P, dt);
}
assert.equal(fired.length, 1, 'one strike per swing');
assert(Math.abs(fired[0].at - (S.t0 + (S.end - S.t0) * 0.42)) < 0.05, 'the strike lands mid-swing, not at the start');
assert.equal(me.once, 'attack', 'the swing animation is still playing up to the end');
for (let i = 0; i < 400 && onceKinds.length < 3; i++) {
  world.time += dt;
  sh.swingStep(me, P, dt);
}
assert.deepEqual(onceKinds, [0, 1, 2], 'holding attack chains the swing variants as a combo');
const gaps = fired.map((f, i) => (i ? f.at - fired[i - 1].at : 1));
assert(
  gaps.every(g => g >= 0.69),
  'a new swing never cuts the previous one: ' + gaps
);
for (let i = 0; i < 90; i++) {
  world.time += dt;
  sh.swingStep(me, P, dt);
}
assert.equal(world.shots.at(-1).damage > 100 || world.shots.some(s => s.damage > 100), true, 'the finisher hits harder');

P.fire = false;
for (let i = 0; i < 90; i++) {
  world.time += dt;
  sh.swingStep(me, P, dt);
}
onceKinds = [];
P.fire = true;
sh.swingStep(me, P, dt);
assert.deepEqual(onceKinds, [0], 'after a pause the combo starts over');

foe.x = 300;
P.fire = true;
sh.swing = null;
fired.length = 0;
for (let i = 0; i < 60; i++) {
  world.time += dt;
  sh.swingStep(me, P, dt);
}
assert.equal(fired.length, 0, 'a swing at nothing whiffs and deals no damage');

const bot = unit(vader, 500, 1);
bot.once = 'attack';
bot.onceEnd = world.time + 0.5;
assert.equal(sh.ready(bot, foe, bot.weapon), false, 'a melee bot waits for its swing to end before the next hit');
bot.onceEnd = world.time - 0.01;
sh.aiShooter = () => false;
assert.equal(sh.ready(bot, foe, bot.weapon), true, 'and swings again after it');

const Dd = { name: 'X', on: true, back: 0, block: 0.3, arc: Math.PI, turn: 0, cats: [], types: [], excluded: [], sfx: '' };
const laser = [...db.types.values()].find(t => /LASER/i.test(t.str('Projectile_Category')) && !t.has('Projectile_Block_Chance_Modifier'));
const block = guard => {
  const t = { x: 0, y: 0, heading: 0, deflects: [Dd], blockBoost: guard };
  let n = 0;
  for (let i = 0; i < 4000; i++) if (world.deflectFor(t, { from: { x: 100, y: 0, type: trooper }, w: { proj: laser } })) n++;
  return n / 4000;
};
const open = block(undefined),
  guarded = block(2);
assert(Math.abs(open - 0.3) < 0.04 && Math.abs(guarded - 0.6) < 0.04, 'guarding doubles the data block chance: ' + open + ' ' + guarded);

const q = { direct: { lead: null }, members: [] };
assert.equal(sh.playerHeld(q), true, 'a driven squad is player held');
assert.equal(sh.playerHeld({ members: [{}] }), false, 'an AI squad is not');
me.squad = { members: [me] };
assert.equal(sh.playerHeld(me.squad), true, "the player's own squad is held");
let ordered = 0;
world.order = () => (ordered++, true);
world.advance = () => {};
Object.assign(sh, { raw: false, vstate: new Map(), teamOf: new Map(), bots: new Map(), offsets: new Map() });
sh.hook();
world.order({ direct: {}, members: [], crew: null, side: 0 }, 10, 10);
assert.equal(ordered, 0, 'an AI move order does not reach the squad the player drives, so it is not packed up');
sh.raw = true;
world.order({ direct: {}, members: [], crew: null, side: 0 }, 10, 10);
assert.equal(ordered, 1, "the shooter's own orders still go through");
console.log('PASS: shooter melee swings, combo, lunge, guard, bot swing gate, player-held squads, no AI orders to driven vehicles');
process.exit(0);
