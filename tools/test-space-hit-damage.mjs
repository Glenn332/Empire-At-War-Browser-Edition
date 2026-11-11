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
const THREE = await import('../public/vendor/three/build/three.module.js');
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const S = await import('../public/js/game/sim.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');
const { diminishingFirepower, diminishedHit, normalDamage } = await import('../public/js/game/diminishing.js');
const { parseAbilities } = await import('../public/js/game/abilities.js');
const { landAbilities } = await import('../public/js/game/landabilities.js');

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const near = (a, b, why, eps = 1e-6) => assert(Math.abs(a - b) < eps, why + ': ' + a + ' vs ' + b);

{
  assert.equal(db.constants.str('Diminishing_Firepower').replace(/\s/g, ''), '0,0.6,0.3,0.7,0.9,0.9,1,1,2,1');
  near(diminishingFirepower(0), 0.6, 'a hit in the same frame as the last takes 0.6');
  near(diminishingFirepower(0.3), 0.7, 'the spline passes 0.3 s at 0.7');
  near(diminishingFirepower(0.9), 0.9, 'and 0.9 s at 0.9');
  near(diminishingFirepower(1), 1, 'a second after, full damage');
  near(diminishingFirepower(2), 1, 'two seconds after, full');
  near(diminishingFirepower(999999), 1, 'never hit before counts as full');
  const mid = diminishingFirepower(0.1);
  assert(mid > 0.6 && mid < 0.7, 'between the points the natural cubic spline: ' + mid);
  const t = {};
  near(diminishedHit(t, 5), 1, 'the first hit is full');
  near(diminishedHit(t, 5), 0.6, 'a second hit in the same frame is 0.6');
  near(diminishedHit(t, 8), 1, 'three seconds later full again');
  assert(normalDamage(T('Proj_Ship_Turbolaser_Red')), 'a turbolaser bolt is Damage_Normal');
  assert(!normalDamage(T('Proj_Rancor_Hit')), 'a Damage_Force_Whirlwind hit is not');
  const veers = landAbilities(T('Veers_AT_AT_Walker')).find(d => d.kind === 'MAXIMUM_FIREPOWER');
  assert(veers && veers.noDiminish, 'MAXIMUM_FIREPOWER turns ALLOW_TARGET_DIMINISHING_FIREPOWER off');
  assert(parseAbilities(T('Veers_AT_AT_Walker')).find(d => d.kind === 'MAXIMUM_FIREPOWER').noDiminish);
}

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  maps
    .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
    .split('\\')
    .pop()
);
const used = [
  'Corellian_Corvette',
  'Star_Destroyer',
  'Calamari_Cruiser',
  'Victory_Destroyer',
  'Alliance_Assault_Frigate',
  'Houndstooth',
  'Slave_I',
  'TIE_Fighter_Squadron',
  'Empire_Defense_Satellite_Laser'
];
{
  const names = new Set(),
    seen = new Set();
  for (const n of used) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

function battle(seed) {
  S.resetEntityIds();
  seedSim(seed);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const [empire, rebel] = ['Empire', 'Rebel'].map((f, i) => w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6 })));
  const run = secs => {
    for (let n = Math.round(secs / DT); n > 0; n--) w.update(DT);
  };
  return { w, empire, rebel, run };
}

const bolt = T('Proj_Ship_Turbolaser_Green');

{
  const { w, empire, rebel } = battle(1);
  const shooter = w.spawn(T('Star_Destroyer'), empire, 0, 0);
  const foe = w.spawn(T('Corellian_Corvette'), rebel, 3000, 0);
  assert(!foe.hpDriven, 'a corvette keeps its hull pool');
  foe.maxHealth = foe.health = 1e9;
  const hit = () => {
    const h = foe.health;
    w.damage(foe, 100, { damageType: 'Damage_Default', attacker: empire, from: shooter, shields: false, proj: bolt });
    return h - foe.health;
  };
  const first = hit();
  assert(first > 0);
  near(hit() / first, 0.6, 'a second bolt in the same frame deals 0.6', 1e-9);
  let sum = 0;
  for (let i = 0; i < 30; i++) {
    w.time += 0.1;
    sum += hit();
  }
  const steady = sum / 30 / first;
  assert(steady > 0.6 && steady < 0.7, 'a target under steady fire, a bolt every 0.1 s, takes 60-70%: ' + steady);
  w.time += 3;
  near(hit() / first, 1, 'after a pause the next hit is full', 1e-9);
  w.time += 0.1;
  const plain = foe.health;
  w.damage(foe, 100, { damageType: 'Damage_Default', attacker: empire, shields: false });
  near((plain - foe.health) / first, 1, 'damage without a projectile and shooter is not diminished', 1e-9);
  shooter.mods.diminish = false;
  w.time += 0.05;
  near(hit() / first, 1, 'a shooter whose ability turns the flag off is not diminished', 1e-9);
}

{
  const { w, empire, rebel } = battle(2);
  const want = {
    Calamari_Cruiser: { FL: 40, FR: 40, BL: 20, BR: 20, ML: 20, MR: 20 },
    Alliance_Assault_Frigate: { FL: 40, FR: 40 },
    Victory_Destroyer: { '02': 20, '03': 20 }
  };
  const foe = w.spawn(T('Corellian_Corvette'), empire, 600, 0);
  for (const [type, hps] of Object.entries(want)) {
    const ship = w.spawn(T(type), rebel, 0, 0);
    for (const [k, v] of Object.entries(hps)) {
      const named = ship.hardpoints.find(h => new RegExp('_WEAPON_' + k + '$', 'i').test(h.def.name));
      assert(named, type + ' ' + k);
      assert.equal(named.projDamage, v, type + ' ' + k + ' has its own Projectile_Damage');
      named.target = foe;
      named.targetHp = null;
      const before = w.projectiles.length;
      w.fireHardpoint(ship, named);
      assert.equal(w.projectiles.length, before + 1);
      const p = w.projectiles[w.projectiles.length - 1];
      near(
        p.damage,
        v * p.mult,
        type + ' ' + k + ' shoots for its own ' + v + ', not the projectile ' + named.proj.num('Projectile_Damage', 0)
      );
    }
  }
  const mc = w.spawn(T('Calamari_Cruiser'), rebel, 0, 500);
  const fl = mc.hardpoints.find(h => h.projDamage === 40);
  assert.equal(fl.proj.name.toUpperCase(), 'PROJ_SHIP_ION_CANNON_LARGE');
  assert.equal(fl.proj.num('Projectile_Damage', 0), 20, 'the ion cannon bolt alone deals 20');
  const isd = w.spawn(T('Star_Destroyer'), rebel, 0, 900);
  const plain = isd.hardpoints.find(h => h.isWeapon && !(h.projDamage > 0));
  plain.target = foe;
  w.fireHardpoint(isd, plain);
  near(
    w.projectiles[w.projectiles.length - 1].damage,
    plain.proj.num('Projectile_Damage', 0),
    'a hardpoint without one uses the projectile'
  );

  const slave0 = w.spawn(T('Slave_I'), rebel, 0, -500),
    slave = slave0.isSquad ? slave0.fighters[0] : slave0;
  assert(slave.weapon, 'Slave I fires its own weapon');
  {
    assert.equal(slave.weapon.damage, 12, 'a unit type Projectile_Damage overrides its own weapons');
    w.launch(slave.weapon.proj, slave, foe, null, slave.x, slave.y, slave.z, slave.weapon.damageType, slave.weapon.inaccuracy, {
      damage: slave.weapon.damage
    });
    near(w.projectiles[w.projectiles.length - 1].damage, 12 * w.projectiles[w.projectiles.length - 1].mult, 'Slave I shoots for 12');
  }
  const sticky = T('Proj_Sticky_Bomb');
  w.launch(sticky, slave, foe, null, 0, 0, 0, sticky.str('Damage_Type'), new Map());
  near(
    w.projectiles[w.projectiles.length - 1].damage,
    400 * w.projectiles[w.projectiles.length - 1].mult,
    'a projectile of no Projectile_Damage hits for its blast damage'
  );
}

{
  const { w, empire, rebel } = battle(3);
  const boron = T('Proj_Ship_Diamond_Boron_Missile');
  assert(boron.bool('Projectile_Blast_Area_Dropoff') && boron.num('Projectile_Blast_Area_Dropoff_Tiers', 0) === 5);
  const sats = [0, 60, 120, 190].map((d, i) => {
    const s = w.spawn(T('Empire_Defense_Satellite_Laser'), rebel, d, 2000 + i * 3000);
    s.maxHealth = s.health = 1e6;
    s.maxShield = s.shield = 0;
    return s;
  });
  assert(
    sats.every(s => !s.hardpoints.some(h => h.destroyable)),
    'satellites have no destroyable hardpoints'
  );
  const raw = 150;
  const hurt = [];
  for (const s of sats) {
    const h = s.health;
    w.areaDamage(0, s.y, 200, raw, boron.str('Damage_Type'), empire, { proj: boron, z: s.z });
    hurt.push(h - s.health);
  }
  const k = db.damageMod(boron.str('Damage_Type'), sats[0].armor);
  for (let i = 0; i < sats.length; i++) {
    const s = sats[i],
      dd = Math.max(0, Math.hypot(s.x, 0) - (s.coll ? 0 : s.hitRadius));
    assert(hurt[i] <= raw * k + 1e-6, 'never more than the blast');
    const tier = 1 - Math.floor((dd * 5) / 200) / 6;
    if (!s.coll) near(hurt[i], raw * k * Math.max(0, tier), 'Diamond Boron tiered drop-off at ' + dd.toFixed(1));
  }
  near(hurt[0], raw * k, 'the centre takes the whole blast');
  assert(hurt[3] < hurt[0], 'the far one takes a lower tier');
  for (const t of [0, 1, 2])
    assert(
      [0, 1, 2, 3, 4, 5].some(n => Math.abs(hurt[t] - raw * k * (1 - n / 6)) < 1e-6),
      'a tier step: ' + hurt[t]
    );

  const bomb = T('TIE_Bomber_Bombing_Run_Bomb');
  assert(!bomb.bool('Projectile_Blast_Area_Dropoff'));
  const far = sats[3],
    h0 = far.health;
  w.areaDamage(0, far.y, 200, 125, bomb.str('Damage_Type'), empire, { proj: bomb, z: far.z });
  near(h0 - far.health, 125 * db.damageMod(bomb.str('Damage_Type'), far.armor), 'a bomb blast has no drop-off: full damage near its edge');

  const sat = sats[0],
    h1 = sat.health;
  w.areaDamage(0, sat.y, 200, 150, boron.str('Damage_Type'), empire, { proj: boron, z: sat.z, exclude: sat });
  near(sat.health, h1, 'the direct victim with no destroyable hardpoints takes no blast of its own');

  const sd = w.spawn(T('Star_Destroyer'), rebel, 0, 30000);
  for (const hp of sd.hardpoints) hp.health = hp.maxHealth = 1e6;
  sd.maxShield = sd.shield = 0;
  const ds = sd.hardpoints.filter(h => h.destroyable);
  assert(ds.length > 3, 'a Star Destroyer has destroyable hardpoints');
  const hitHp = ds[0];
  const at = hitHp.worldPos({ x: 0, y: 0, z: 0 });
  const R = 200;
  const inside = ds.filter(h => {
    const p = h.worldPos({ x: 0, y: 0, z: 0 });
    return h !== hitHp && Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z) < R;
  });
  const before = new Map(ds.map(h => [h, h.health]));
  w.areaDamage(at.x, at.y, R, 300, 'Damage_Default', empire, { proj: bomb, z: at.z, exclude: sd, hitHp });
  near(hitHp.health, before.get(hitHp), 'the hardpoint hit directly takes none of the blast');
  const kd = db.damageMod('Damage_Default', sd.armor);
  for (const h of ds) {
    const lost = before.get(h) - h.health;
    if (inside.includes(h)) near(lost, (300 * kd) / inside.length, 'the blast shared among the hardpoints inside it', 1e-3);
    else near(lost, 0, 'none for those outside');
  }
  assert(inside.length > 0, 'some hardpoints lie inside the blast');

  const many = [0, 1, 2].map(i => {
    const s = w.spawn(T('Empire_Defense_Satellite_Laser'), rebel, i * 5, 60000);
    s.maxShield = s.shield = 0;
    return s;
  });
  const capped = {
    num: (k, d) => (k === 'Projectile_Blast_Area_Max_Victims' ? 2 : bomb.num(k, d)),
    bool: (k, d) => bomb.bool(k, d),
    str: (k, d) => bomb.str(k, d)
  };
  const hs = many.map(s => s.health);
  w.areaDamage(5, 60000, 100, 10, 'Damage_Default', empire, { proj: capped, z: 0 });
  assert.equal(many.filter((s, i) => s.health < hs[i]).length, 2, 'Projectile_Blast_Area_Max_Victims caps the victims');
}

{
  const { w, empire, rebel, run } = battle(4);
  const storm = T('Nebula Small Ion');
  w.addField(storm, 0, 0);
  const ship = w.spawn(T('Corellian_Corvette'), rebel, 0, 0);
  ship.setOrder({ kind: 'idle' });
  ship.shield = ship.maxShield * 0.5;
  run(4);
  assert(w.inIonStorm(ship), 'a shield service inside an ion storm marks it');
  assert(ship.shield > ship.maxShield * 0.5, 'shields keep regenerating in a storm: ' + ship.shield);
  assert(ship.shield > db.constants.num('Depleted_Shield_Regen_Cap', 0.25), 'and the depleted cap does not apply');
  const s0 = ship.shield,
    h0 = ship.health;
  w.damage(ship, 50, { damageType: 'Damage_Default', attacker: empire });
  near(ship.shield, s0, 'a hit in a storm leaves the shield value alone');
  assert(ship.health < h0, 'and goes straight to the hull');
  assert(!(ship.shieldDownTimer > 0), 'without starting the depleted window');
  ship.x = 5000;
  run(4);
  assert(!w.inIonStorm(ship), 'out of the storm at the next service, shields work again');
  const s1 = ship.shield;
  w.damage(ship, 10, { damageType: 'Damage_Default', attacker: empire });
  assert(ship.shield < s1, 'and absorb hits');
}

{
  const { w, empire, rebel, run } = battle(5);
  const hound = w.spawn(T('Houndstooth'), rebel, 0, 0);
  const st = hound.abilities.find(a => a.def.kind === 'SENSOR_JAMMING');
  assert(st, 'Houndstooth has SENSOR_JAMMING');
  const R = st.def.node.num('Effective_Radius', 0);
  assert.equal(R, 900);
  const inRange = w.spawn(T('Corellian_Corvette'), empire, 600, 0);
  const outRange = w.spawn(T('Corellian_Corvette'), empire, 2500, 0);
  for (const u of [hound, inRange, outRange]) u.setOrder({ kind: 'idle' });
  w.useAbility(hound, 'SENSOR_JAMMING', true);
  run(0.2);
  assert(hound.isActive('SENSOR_JAMMING'), 'jamming on');
  assert(w.jammed(inRange), 'an enemy within its radius is jammed');
  assert(!w.jammed(outRange), 'one outside is not');
  assert(!w.jammed(hound), 'never itself');
  const t0 = w.time;
  inRange.x = 4000;
  run(0.2);
  assert(w.jammed(inRange) === w.time - t0 < db.constants.num('Sensor_Jamming_Time', 0.5), 'jammed for Sensor_Jamming_Time after leaving');
  run(1);
  assert(!w.jammed(inRange));
}

{
  const homing = [...db.types.values()].find(
    t =>
      t.str('Projectile_Category').trim().toUpperCase() === 'MISSILE' &&
      t.num('Max_Rate_Of_Turn', 0) > 0 &&
      t.num('Max_Speed', 0) > 0 &&
      /^Proj_Ship/i.test(t.name)
  );
  assert(homing, 'a homing ship missile');
  const flight = (jam, atHound) => {
    const { w, empire, rebel, run } = battle(6);
    const hound = w.spawn(T('Houndstooth'), rebel, 0, 0);
    hound.z ??= 0;
    const foe = w.spawn(T('Corellian_Corvette'), empire, 600, 0);
    const sd = w.spawn(T('Star_Destroyer'), atHound ? empire : rebel, -6000, 0);
    for (const u of [hound, foe, sd]) u.setOrder({ kind: 'idle' });
    if (jam) w.useAbility(hound, 'SENSOR_JAMMING', true);
    run(DT);
    w.projectiles.length = 0;
    w.launch(homing, sd, atHound ? hound : foe, null, -1500, -1000, 0, 'Damage_Default', new Map());
    const m = w.projectiles[0];
    assert(m && m.homing, 'a homing missile');
    m.vx = 0;
    m.vy = m.speed;
    m.vz = 0;
    const turn = [];
    let closest = Infinity;
    for (let i = 0; i < 300 && w.projectiles.includes(m); i++) {
      w.update(DT);
      turn.push(Math.atan2(m.vy, m.vx));
      closest = Math.min(closest, Math.hypot(m.x - hound.x, m.y - hound.y));
    }
    return { turn, closest };
  };
  const free = flight(false, false),
    jammed = flight(true, false);
  assert(Math.abs(free.turn[10] - Math.PI / 2) > 0.05, 'an unjammed missile turns toward its target');
  near(jammed.turn[10], Math.PI / 2, 'a missile at a jammed target flies straight', 1e-9);
  const reach = flight(false, true).closest;
  assert(reach < 700, 'a missile reaches a ship that is not jamming: ' + reach);
  const aside = flight(true, true).closest;
  assert(aside > 800, 'a jamming ship turns enemy missiles aside at its radius: ' + aside);
}

console.log('space hit damage: ok');
