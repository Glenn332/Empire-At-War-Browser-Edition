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
const { flagshipScore } = await import('../public/js/game/campaignbattle.js');
const { landHealth } = await import('../public/js/game/land.js');

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const near = (a, b, why, eps = 1e-3) => assert(Math.abs(a - b) < eps, why + ': ' + a + ' vs ' + b);
const K = db.constants.num('Object_Max_Health_Multiplier_Space', 0),
  GAP = db.constants.num('Hull_Vs_Hard_Points_Health_Constraint', 0);
assert.equal(K, 1.5, 'GameConstants: Object_Max_Health_Multiplier_Space');
assert.equal(GAP, 0.2, 'GameConstants: Hull_Vs_Hard_Points_Health_Constraint');

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  maps
    .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
    .split('\\')
    .pop()
);
const used = ['Star_Destroyer', 'Calamari_Cruiser', 'Rebel_Defense_Satellite_Repair'];
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
const hpSum = u => u.hardpoints.filter(h => h.destroyable).reduce((a, h) => a + Math.max(0, h.health), 0);
const hpMax = u => u.hardpoints.filter(h => h.destroyable).reduce((a, h) => a + h.maxHealth, 0);
const quiet = u => {
  u.setOrder({ kind: 'idle' });
  u.shield = 0;
  u.maxShield = 0;
};

{
  const { w, empire, rebel } = battle(1);
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0),
    mc = w.spawn(T('Calamari_Cruiser'), rebel, 5000, 0);
  near(sd.maxHealth, 7500 * K, 'the hull is Tactical_Health times Object_Max_Health_Multiplier_Space');
  near(sd.health, sd.maxHealth, 'and starts full');
  near(mc.maxHealth, 8500 * K, 'Mon Calamari hull');
  for (const h of sd.hardpoints) near(h.maxHealth, h.def.num('Health', 0) * K, 'each hardpoint is its Health times the multiplier');
  near(hpMax(sd), 3275 * K, 'the Star Destroyer hardpoints: their own pool');
  near(hpMax(mc), 3010 * K, 'the Mon Calamari hardpoints: their own pool');
  assert(sd.hpDies && mc.hpDies, 'Should_Be_Destroyed_When_All_Hardpoints_Destroyed defaults to Yes');
  near(flagshipScore(T('Star_Destroyer')), 7500 * K + T('Star_Destroyer').num('Shield_Points', 0), 'the flagship score takes the same hull');
  near(landHealth(T('Star_Destroyer'), 0), 7500 * db.constants.num('Object_Max_Health_Multiplier_Land', 1), 'land uses its own multiplier');
}

{
  const { w, empire, rebel, run } = battle(2);
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0),
    mc = w.spawn(T('Calamari_Cruiser'), rebel, 8000, 0);
  quiet(sd);
  quiet(mc);
  const gun = mc.hardpoints[0];
  w.damage(mc, 100, { damageType: 'Damage_Default', hp: gun });
  near(gun.health, gun.maxHealth - 100 * db.damageMod('Damage_Default', mc.armor), 'a hit aimed at a hardpoint goes to it');
  near(mc.health, mc.maxHealth, 'the hull keeps its own health');
  w.damage(mc, 100, { damageType: 'Damage_Default' });
  assert(mc.health < mc.maxHealth, 'a hit on no hardpoint goes to the hull');
  const hull = mc.health,
    rest = hpSum(mc);
  gun.health = 1;
  w.damage(mc, 500, { damageType: 'Damage_Default', hp: gun });
  assert(!gun.alive, 'the hardpoint is destroyed');
  near(mc.health, hull, 'its overflow does not reach the hull');
  const after = hpSum(mc);
  w.damage(mc, 500, { damageType: 'Damage_Default', hp: gun });
  near(hpSum(mc), after, 'a shot aimed at a destroyed hardpoint does no damage');
  near(mc.health, hull, 'not to the hull either');
  assert(rest > after);

  for (const h of mc.hardpoints) {
    h.alive = true;
    h.health = h.maxHealth * 0.5;
  }
  mc.health = mc.maxHealth;
  near(mc.healthFrac, 0.5, 'health is the smaller of the hull share and the hardpoint share', 1e-2);
  run(DT);
  near(mc.health / mc.maxHealth, mc.hardpointShare() + GAP, 'the hull is pulled to within the constraint of its hardpoints', 1e-3);
  for (const h of mc.hardpoints) if (h.destroyable) h.health = h.maxHealth;
  mc.hardpoints[0].health = mc.hardpoints[0].maxHealth * 0.6;
  mc.health = mc.maxHealth * 0.3;
  const before = mc.hardpoints.map(h => h.health),
    share0 = mc.hardpointShare(),
    cap = 0.3 + GAP,
    e = (share0 - cap) * hpMax(mc);
  run(DT);
  near(mc.health / mc.maxHealth, 0.3, 'hardpoints above the hull do not raise it');
  mc.hardpoints.forEach((h, i) => near(h.health, before[i] - (before[i] / hpMax(mc)) * e, 'each hardpoint loses its excess in proportion to its health', 1e-2));
}

{
  const { w, empire, rebel } = battle(3);
  const mc = w.spawn(T('Calamari_Cruiser'), rebel, 8000, 0);
  quiet(mc);
  const live = mc.hardpoints.filter(h => h.destroyable);
  for (const h of live.slice(1)) w.damage(mc, 1e6, { damageType: 'Damage_Default', hp: h });
  assert(!mc.dead, 'a ship with one destroyable hardpoint left lives');
  near(mc.health, mc.maxHealth, 'and its hull is untouched by the hits');
  w.damage(mc, 1e6, { damageType: 'Damage_Default', hp: live[0] });
  assert(mc.dead, 'the last destroyable hardpoint gone, the ship dies');

  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0);
  quiet(sd);
  w.damage(sd, 1e6, { damageType: 'Damage_Default' });
  assert(sd.dead, 'the hull at zero, the ship dies');
  assert(sd.hardpoints.every(h => !h.destroyable || (!h.alive && h.health === 0)), 'and death destroys the remaining hardpoints');
}

{
  const { w, empire, rebel, run } = battle(4);
  const sat = w.spawn(T('Rebel_Defense_Satellite_Repair'), rebel, 0, 0),
    mc = w.spawn(T('Calamari_Cruiser'), rebel, 200, 0);
  quiet(mc);
  assert(sat.heal && sat.heal.range > 0, 'the repair satellite heals in range');
  mc.health = mc.maxHealth;
  mc.hardpoints.forEach((h, i) => (h.health = h.maxHealth * (0.9 - i * 0.01)));
  const was = mc.hardpoints.map(h => h.health);
  sat.heal.timer = 0;
  w.updateHeal(sat, DT);
  const changed = mc.hardpoints.filter((h, i) => h.health !== was[i]);
  assert.equal(changed.length, 1, 'one hardpoint per tick');
  const worst = mc.hardpoints[mc.hardpoints.length - 1];
  assert.equal(changed[0], worst, 'the least healthy one');
  near(worst.health, Math.min(worst.maxHealth, was[was.length - 1] + worst.maxHealth * sat.heal.percent + sat.heal.amount), 'by Heal_Percent of its own maximum');
  near(mc.health, mc.maxHealth, 'the hull is left alone while a hardpoint is hurt');

  for (const h of mc.hardpoints) h.health = h.maxHealth;
  mc.health = mc.maxHealth * 0.5;
  mc.heal = { range: 0, percent: 0.1, amount: 0, interval: 1, timer: 0, cats: [] };
  w.updateHeal(mc, DT);
  near(mc.health, mc.maxHealth * 0.6, 'no hardpoint hurt: the hull is healed instead');
  mc.heal = undefined;

  const st = w.spawn(T('Empire_Star_Base_1'), empire, -6000, 0);
  const hp = st.hardpoints.find(h => h.destroyable && h.def.num('Repair_Amount_Per_Frame', 0) > 0);
  assert(hp, 'a station hardpoint with Repair_Amount_Per_Frame');
  for (const h of st.hardpoints) if (h.destroyable) h.health = h.maxHealth * 0.5;
  hp.health = hp.maxHealth * 0.2;
  st.health = st.maxHealth * 0.3;
  assert(w.repairHardpoint(empire, st, st.hardpoints.indexOf(hp)), 'a hurt station hardpoint can be repaired');
  const gain = hp.def.num('Repair_Amount_Per_Frame', 0);
  w.tickRepairs(DT);
  near(hp.health, hp.maxHealth * 0.2 + gain, 'the repaired hardpoint gains Repair_Amount_Per_Frame');
  const share = st.hardpointShare();
  assert(share > 0.3);
  near(st.health, st.maxHealth * 0.3 * (share - 0.3 + 1), 'and the hull below the hardpoints is raised by the gap', 1e-2);
  run(1);
}

{
  const { w, empire } = battle(5);
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0);
  quiet(sd);
  assert(sd.asteroidDamage, 'a Star Destroyer takes asteroid damage');
  w.fields.push({ x: 0, y: 0, r: 900, asteroid: true, nebula: false, ion: false, radar: true });
  const full = hpSum(sd);
  sd.speed = 0;
  for (let n = 0; n < 80; n++) w.updateFields(sd, 0.25);
  near(hpSum(sd), full, 'standing still in a field does no damage');
  near(sd.health, sd.maxHealth, 'to the hull either');
  sd.speed = 40;
  sd.hyper = { f: 0 };
  for (let n = 0; n < 80; n++) w.updateFields(sd, 0.25);
  near(hpSum(sd), full, 'nor in hyperspace');
  sd.hyper = null;
  for (let n = 0; n < 40; n++) w.updateFields(sd, 0.25);
  assert(hpSum(sd) < full, 'moving through it, the hits land on the hardpoints: ' + hpSum(sd) + ' of ' + full);
  near(sd.health, sd.maxHealth, 'not on the hull');
  const hits = full - hpSum(sd),
    each = db.constants.num('Asteroid_Field_Damage', 0) * db.damageMod('Damage_Asteroid', sd.armor);
  near(hits / each, Math.round(hits / each), 'whole asteroid hits, each on one hardpoint', 1e-2);
}

{
  const { snapshot, restore } = await import('../public/js/game/savegame.js');
  const live = battle(6);
  const sd = live.w.spawn(T('Star_Destroyer'), live.empire, 0, 0),
    mc = live.w.spawn(T('Calamari_Cruiser'), live.rebel, 3000, 0);
  quiet(sd);
  sd.hardpoints[2].health = sd.hardpoints[2].maxHealth * 0.25;
  live.w.destroyHardpoint(sd, sd.hardpoints[3], null);
  sd.health = sd.maxHealth * 0.7;
  const game = {
    world: live.w,
    renderer: { rig: { x: 0, y: 0, dist: 1000, yaw: 0, pitch: 0.5 } },
    map: { planet: 'Kuat', activeEnvironment: 0 },
    setup: { mapFile: '', credits: 0, popCap: 0, fog: false, teamFactions: ['Empire', 'Rebel'], players: [] },
    ui: { groups: new Map(), selection: [] },
    speed: 1,
    human: live.empire
  };
  const save = JSON.parse(JSON.stringify(snapshot(game, 'pools')));
  const back = battle(6);
  const { refs } = restore({ world: back.w }, save);
  const sd2 = [...refs.values()].find(e => e && e.type && e.type.name === 'Star_Destroyer');
  assert(sd2, 'the Star Destroyer is back');
  near(sd2.health, sd.health, 'the hull is saved on its own', 0.11);
  sd.hardpoints.forEach((h, i) => {
    assert.equal(sd2.hardpoints[i].alive, h.alive, 'hardpoint ' + i + ' alive');
    near(sd2.hardpoints[i].health, h.health, 'hardpoint ' + i + ' health', 0.11);
  });
  near(sd2.healthFrac, sd.healthFrac, 'the same health share', 1e-3);
  assert(mc);
}

console.log('space health pools: ok');
