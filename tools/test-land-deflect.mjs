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
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData, ObjType } = await import('../public/js/gamedata.js');
const { parseXML } = await import('../public/js/xml.js');
await loadGameData();
const { LandWorld } = await import('../public/js/game/land.js');
const { seedSim } = await import('../public/js/game/simrandom.js');

const trooper = db.type('Rebel_Infantry') || db.type('Squad_Rebel_Trooper') || [...db.types.values()].find(t => t.categories().has('INFANTRY'));
const tank = [...db.types.values()].find(t => t.categories().has('VEHICLE') && !t.categories().has('INFANTRY'));
const laser = [...db.types.values()].find(t => /LASER/i.test(t.str('Projectile_Category')) && !t.has('Projectile_Redirect_Chance_Modifier'));
const soft = [...db.types.values()].find(t => t.has('Projectile_Redirect_Chance_Modifier'));
assert(trooper && tank && laser && soft);

const D = (o = {}) => ({ name: 'X', on: true, back: 0, block: 0, arc: Math.PI, turn: 0, cats: [], types: [], excluded: [], sfx: '', ...o });
const world = Object.assign(Object.create(LandWorld.prototype), { time: 1, wild: 3, shots: [] });
world.cast = () => {};
world.groundZ = () => 0;
world.fire = (from, aim, w) => world.shots.push({ from, target: aim, w });
const hero = (deflects) => ({ x: 0, y: 0, heading: 0, path: [], side: 0, type: trooper, deflects, deflect: deflects.some(d => d.on) });
const shooter = type => ({ x: 100, y: 0, side: 1, dead: false, type });
const shot = (from, proj = laser) => ({ from, w: { proj }, damage: 10 });

seedSim(1);
let t = hero([D({ cats: ['VEHICLE'], back: 1 }), D({ cats: ['INFANTRY'], block: 1 })]);
assert.equal(world.deflects(t, shot(shooter(trooper))), true);
assert.equal(world.shots.at(-1).target.spot, true, 'the infantry ability blocks: the bolt goes off to a spot');
assert.equal(world.deflects(t, shot(shooter(tank))), true);
assert.equal(world.shots.at(-1).target.type, tank, 'the vehicle ability redirects at the vehicle');

t = hero([D({ cats: ['VEHICLE'], back: 1 })]);
assert.equal(world.deflects(t, shot(shooter(trooper))), false, 'no ability for the shooter category: the bolt lands');
const gone = shooter(tank);
gone.dead = true;
assert.equal(world.deflects(t, shot(gone)), false, 'a shooter that is gone is neither redirected nor blocked');
t = hero([D({ back: 1, arc: 0.5 })]);
const behind = shooter(trooper);
behind.x = -100;
assert.equal(world.deflects(t, shot(behind)), false, 'outside the reaction arc');
t = hero([D({ back: 1, on: false })]);
assert.equal(world.deflects(t, shot(shooter(trooper))), false, 'a disabled ability does nothing');

const m = soft.num('Projectile_Redirect_Chance_Modifier', 1);
t = hero([D({ back: 1 })]);
let n = 0;
for (let i = 0; i < 2000; i++) if (world.deflectFor(t, shot(shooter(trooper), soft))) n++;
assert(Math.abs(n / 2000 - m) < 0.05, 'the projectile redirect modifier scales the chance');
console.log('PASS: land blaster redirect and block');
