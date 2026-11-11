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
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { CombatMods, MOD } = await import('../public/js/game/combatmods.js');
const { LandWorld, LandSquad, landUnit } = await import('../public/js/game/land.js');
const { landAbilities, refreshMods } = await import('../public/js/game/landabilities.js');

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const near = (a, b, why) => assert(Math.abs(a - b) < 1e-6, why + ': ' + a + ' vs ' + b);

function makeWorld() {
  const factions = ['Empire', 'Rebel', 'Empire'];
  const world = Object.assign(Object.create(LandWorld.prototype), {
    team: [0, 1, 0],
    wild: 3,
    time: 1,
    factions,
    units: [],
    squads: [],
    sideMods: null,
    bonusHolders: [],
    bonusSeen: 0,
    shots: 0
  });
  world.sideMods = factions.map(() => new CombatMods());
  world.fire = () => world.shots++;
  world.make = (name, side) => {
    const type = T(name),
      squad = new LandSquad(world, type, side),
      hp = type.num('Tactical_Health', 100) || 100;
    const u = landUnit({
      type,
      side,
      squad,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      health: hp,
      maxHealth: hp,
      shield: 0,
      maxShield: 0,
      dead: false
    });
    world.arm(u, type, side, () => 0);
    world.energyOf(u);
    squad.members.push(u);
    world.units.push(u);
    world.squads.push(squad);
    world.syncCombatBonuses();
    return u;
  };
  return world;
}

{
  const world = makeWorld();
  world.trackDamage = () => {};
  world.retaliate = () => {};
  const atst = world.make('AT_ST_Walker', 0);
  const tank = world.make('T2B_Tank', 1);
  tank.health = tank.maxHealth = 1e9;
  tank.path ??= [];
  const P = atst.weapon.proj;
  const hit = () => {
    const h = tank.health;
    world.hurt(tank, 10, atst, '', P);
    return h - tank.health;
  };
  const first = hit();
  assert(first > 0);
  near(hit() / first, 0.6, 'on land too a second shot in the same frame deals 0.6');
  world.time += 0.3;
  near(hit() / first, 0.7, 'and 0.7 three tenths of a second after');
  world.time += 5;
  near(hit() / first, 1, 'full after a pause');
  const h = tank.health;
  world.hurt(tank, 10, atst);
  near((h - tank.health) / first, 1, 'damage that is not a projectile hit is not diminished');
  const def = landAbilities(db.type('Veers_AT_AT_Walker')).find(d => d.kind === 'MAXIMUM_FIREPOWER');
  atst.abilityKinds = new Set(['MAXIMUM_FIREPOWER']);
  refreshMods(world, { members: [atst], abilities: [{ active: true, def }] });
  assert(atst.mod.noDiminish);
  near(hit() / first, 1, 'MAXIMUM_FIREPOWER, its flag off, is not diminished');
}

{
  const world = makeWorld();
  const torp = db.type('Proj_Ground_Proton_Torpedo');
  assert.equal(torp.num('Projectile_Damage', -1), 0);
  near(
    world.shotDamage({ damage: 0, mult: 1.5, w: { proj: torp } }),
    20 * 1.5,
    'a land shot of no Projectile_Damage hits for its blast damage'
  );
  near(world.shotDamage({ damage: 7, mult: 1, w: { proj: torp } }), 7, 'otherwise its own');
}

console.log('land hit damage: ok');
