import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
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
const { useAbility } = await import('../public/js/game/abilities.js');
const { PathCore } = await import('../public/js/game/pathcore.js');

const DT = 1 / 30,
  DEG = Math.PI / 180;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const near = (a, b, eps, why) => assert(Math.abs(a - b) <= eps, why + ': ' + a + ' vs ' + b);

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  maps
    .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
    .split('\\')
    .pop()
);
const used = [
  'Star_Destroyer',
  'Corellian_Corvette',
  'Nebulon_B_Frigate',
  'Calamari_Cruiser',
  'Interdictor_Cruiser',
  'Victory_Destroyer',
  'Acclamator_Assault_Ship',
  'TIE_Fighter_Squadron',
  'Skirmish_Hutt_Asteroid_Base',
  'Empire_Star_Base_1'
];
{
  const names = new Set(),
    seen = new Set();
  for (const n of used) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

function battle(seed, opts = {}) {
  S.resetEntityIds();
  seedSim(seed);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const [empire, rebel] = ['Empire', 'Rebel'].map((f, i) =>
    w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6, human: !!opts.human }))
  );
  const run = secs => {
    for (let n = Math.round(secs / DT); n > 0; n--) w.update(DT);
  };
  return { w, empire, rebel, run };
}

const destroy = (w, u, pred) => {
  for (const h of u.hardpoints) if (pred(h) && h.alive) w.destroyHardpoint(u, h, null);
};
const settle = u => {
  u.speed = 0;
  u.setOrder({ kind: 'idle' });
};

{
  const { w, empire } = battle(1);
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0, 0);
  const S0 = w.sideFirepower(sd);
  const power = T('Star_Destroyer').num('AI_Combat_Power', 0);
  const guns = sd.hardpoints.filter(h => h.isWeapon),
    pw = h => h.proj.num('AI_Combat_Power', 0),
    sum = guns.reduce((s, h) => s + pw(h), 0),
    hull = guns.filter(h => h.proj.bool('Projectile_Does_Hitpoint_Damage', true)).reduce((s, h) => s + pw(h), 0);
  assert(hull < sum, 'the ion cannons do no hull damage and take no share');
  near(S0[0], (power * hull) / sum, 1e-6, 'every hull-damaging Star Destroyer gun bears forward');
  near(S0[1], S0[2], 1e-6, 'the sides are even');
  assert(S0[1] > 0 && S0[3] === 0, 'and nothing bears astern');
  assert.equal(w.facingOffset(sd, 0.3), 0, 'with the bow strongest a ship turns its nose on the target');
  const neb = w.spawn(T('Nebulon_B_Frigate'), empire, 0, 0, 0);
  for (const h of neb.hardpoints) if (h.isWeapon) h.coneWidth = 90;
  neb.sides = null;
  const N = w.sideFirepower(neb);
  assert(N[0] === 0 && N[1] > 0 && N[1] === N[2], 'narrowed Nebulon cones bear only to the sides: ' + N);
  assert.equal(
    w.facingOffset(neb, 0),
    Math.PI / 2,
    'right beats the bow first; the tie with the left keeps it when the bearing is dead ahead'
  );
  assert.equal(w.facingOffset(neb, 2), -Math.PI / 2, 'the tie goes to the left when the target is nearer the left beam');
  assert.equal(w.facingOffset(neb, -2), Math.PI / 2, 'and stays right when it is off the right beam');
  destroy(w, neb, h => h.isWeapon && h.fireYaw < 0);
  assert.equal(neb.sides, null, 'losing a weapon hardpoint works the sides out again');
  assert.equal(w.facingOffset(neb, 0), -Math.PI / 2, 'with the right guns gone the left side faces the target');
}

{
  const { w, empire, rebel, run } = battle(2);
  const neb = w.spawn(T('Nebulon_B_Frigate'), empire, 0, 0, 0);
  for (const h of neb.hardpoints) if (h.isWeapon) h.coneWidth = 90;
  destroy(w, neb, h => h.isWeapon && h.fireYaw < 0);
  const foe = w.spawn(T('Corellian_Corvette'), rebel, 600, 0, Math.PI);
  foe.setOrder({ kind: 'idle' });
  foe.hardpoints.forEach(h => (h.isWeapon = false));
  settle(neb);
  neb.target = foe;
  neb.setOrder({ kind: 'attack', target: foe });
  assert.equal(w.turnSlowdown(neb), 3, 'a frigate turns in place at a third of its rate');
  const rate = neb.turnRate / 3;
  run(Math.PI / 4 / rate);
  near(neb.heading, -Math.PI / 4, 0.06, 'the broadside turn runs at the constant slowed rate');
  run(Math.PI / 4 / rate + 1);
  near(neb.heading, -Math.PI / 2, 0.02, 'a Nebulon with only its left guns brings its left side round on the target');
  foe.x = 600 * Math.cos(-8 * DEG);
  foe.y = 600 * Math.sin(-8 * DEG);
  const h0 = neb.heading;
  run(2);
  near(neb.heading, h0, 1e-9, 'within ten degrees it does not turn');
}

{
  const { w, empire, run } = battle(3);
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0, 0);
  assert.equal(w.turnSlowdown(sd), 4, 'a capital ship turns in place at a quarter of its rate');
  settle(sd);
  sd.setOrder({ kind: 'idle', face: Math.PI / 2 });
  const secs = Math.PI / 2 / (sd.turnRate / 4);
  run(secs / 2);
  near(sd.heading, Math.PI / 4, 0.03, 'the facing turn after a move is linear over |turn| / rate x slowdown');
  run(secs / 2 + 0.1);
  near(sd.heading, Math.PI / 2, 1e-9, 'and ends on the facing');
  const corv = w.spawn(T('Corellian_Corvette'), empire, 2000, 0, 0);
  assert.equal(w.turnSlowdown(corv), 2, 'a corvette at half');
}

{
  const { w, empire } = battle(4);
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0, 0);
  const hp = sd.hardpoints.find(h => h.def.name === 'HP_Star_Destroyer_Weapon_FL');
  assert(hp.frame, 'the cone frame comes from fire bone A');
  const F = hp.frame,
    o = { x: sd.x + F.ox, y: sd.y + F.oy, z: sd.z + F.oz };
  const along = (d, up = 0) => w.hpInCone(sd, hp, o.x + F.xx * d + F.zx * up, o.y + F.xy * d + F.zy * up, o.z + F.xz * d + F.zz * up);
  assert(along(800), 'straight down the fire bone is inside');
  assert(!along(-800), 'behind it is not');
  const tanUp = Math.tan(hp.coneUp);
  assert(along(800, 800 * tanUp * 0.9), 'inside Fire_Cone_Height');
  assert(!along(800, 800 * tanUp * 1.1), 'above Fire_Cone_Height is outside: the cone has a height');
  const yaw = a =>
    w.hpInCone(
      sd,
      hp,
      o.x + (F.xx * Math.cos(a) + F.yx * Math.sin(a)) * 800,
      o.y + (F.xy * Math.cos(a) + F.yy * Math.sin(a)) * 800,
      o.z + (F.xz * Math.cos(a) + F.yz * Math.sin(a)) * 800
    );
  assert(yaw(hp.coneHalf * 0.95) && yaw(-hp.coneHalf * 0.95), 'inside Fire_Cone_Width');
  assert(!yaw(hp.coneHalf * 1.05) && !yaw(-hp.coneHalf * 1.05), 'outside Fire_Cone_Width');
  const def = hp.def,
    bare = new Proxy(def, {
      get: (t, k) => (k === 'num' ? (n, d) => (/^Fire_Cone/.test(n) ? d : def.num(n, d)) : typeof t[k] === 'function' ? t[k].bind(t) : t[k])
    });
  const H = new hp.constructor(sd, bare);
  assert.equal(H.coneHalf, 0, 'a missing Fire_Cone_Width is 0, as the engine reads it');
  assert.equal(H.coneUp, 0, 'and a missing Fire_Cone_Height');
}

{
  const { w, empire, rebel, run } = battle(5);
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0, 0);
  const mc = w.spawn(T('Calamari_Cruiser'), rebel, 1500, 300, Math.PI);
  mc.setOrder({ kind: 'idle' });
  mc.hardpoints.forEach(h => (h.isWeapon = false));
  settle(sd);
  const seen = [];
  const real = w.launch.bind(w);
  w.launch = (proj, shooter, target, targetHp, ...rest) => {
    if (shooter === sd && target === mc) seen.push([targetHp, w.nearestHp(mc, sd)]);
    return real(proj, shooter, target, targetHp, ...rest);
  };
  run(10);
  assert(seen.length > 0, 'the Star Destroyer fires');
  for (const [h, best] of seen) {
    assert(h && h.targetable, 'an opportunity hardpoint shot goes at a targetable hardpoint');
    assert.equal(h, best, 'the nearest one to the shooter');
  }
  seen.length = 0;
  sd.setOrder({ kind: 'attack', target: mc });
  sd.target = mc;
  run(10);
  const pick = w.pickHardpoint(mc, sd.x, sd.y, sd);
  assert(
    seen.some(([h]) => h === pick),
    'an attack order aims by the Hard_Point_Priorities pick'
  );
}

{
  const { w, empire, rebel, run } = battle(6);
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0, 0);
  const foe = w.spawn(T('Corellian_Corvette'), rebel, 900, 0, Math.PI);
  foe.setOrder({ kind: 'idle' });
  foe.hardpoints.forEach(h => (h.isWeapon = false));
  settle(sd);
  const hp = sd.hardpoints.find(h => h.def.name === 'HP_Star_Destroyer_Weapon_FL');
  assert.equal(hp.pulseDelay, hp.def.num('Fire_Pulse_Delay_Seconds', 0), 'Fire_Pulse_Delay_Seconds as written');
  for (const h of sd.hardpoints) if (h !== hp) h.isWeapon = false;
  let block = true,
    shots = 0;
  w.launch = (proj, shooter) => {
    if (shooter !== sd) return true;
    if (block) return false;
    shots++;
    return true;
  };
  hp.cooldown = 0;
  for (let i = 0; i < 90 && !hp.pulsesLeft; i++) w.update(DT);
  run(0.2);
  assert.equal(hp.pulsesLeft, hp.pulses, 'a burst whose pulse cannot fire keeps all its pulses');
  run(3);
  assert.equal(hp.pulsesLeft, hp.pulses, 'and waits for its shot, the recharge not started');
  block = false;
  w.update(DT);
  assert.equal(shots, 1, 'the held pulse goes as soon as it can');
  run(hp.pulseDelay * (hp.pulses + 1));
  assert.equal(shots, hp.pulses, 'then the rest of the burst');
  assert.equal(hp.pulsesLeft, 0);
  assert(hp.cooldown > 0, 'and the recharge follows the last pulse fired');
}

{
  const { w, empire, rebel } = battle(7);
  const sd = w.spawn(T('Star_Destroyer'), rebel, 0, 0, 0);
  const foe = w.spawn(T('Corellian_Corvette'), empire, 900, 0, Math.PI);
  sd.enemies = [foe];
  const hp = sd.hardpoints.find(h => h.def.name === 'HP_Star_Destroyer_Weapon_FL');
  hp.rules = { manual: false, idle: false, busy: false };
  hp.lookAt = 0;
  hp.target = null;
  hp.rechargeMax = 3;
  assert(!sd.player.human);
  assert.equal(w.hardpointTarget(sd, hp), foe, 'an AI hardpoint with Fire_Max_Recharge_Seconds at the cutoff takes opportunity shots');
  hp.lookAt = 0;
  hp.target = null;
  hp.rechargeMin = 1;
  hp.rechargeMax = 3.5;
  assert.equal(w.hardpointTarget(sd, hp), null, 'above it, Fire_Max_Recharge_Seconds decides, not the minimum');
}

{
  const { w, empire, run } = battle(8);
  const neb = w.spawn(T('Nebulon_B_Frigate'), empire, 0, 0, 0);
  const { parseAbilities, attachAbilities } = await import('../public/js/game/abilities.js');
  attachAbilities(neb, parseAbilities(T('Corellian_Corvette')));
  const first = neb.hardpoints.find(h => h.kind === 'HARD_POINT_ENGINE');
  neb.hardpoints.push(new first.constructor(neb, first.def));
  const engines = neb.hardpoints.filter(h => h.kind === 'HARD_POINT_ENGINE');
  assert.equal(engines.length, 2, 'a Nebulon given a second engine');
  settle(neb);
  neb.setOrder({ kind: 'move', x: 4000, y: 0 });
  run(25);
  const full = neb.speed;
  assert(full > 0);
  assert.equal(useAbility(w, neb, 'TURBO', true), null);
  w.destroyHardpoint(neb, engines[0], null);
  assert(neb.engineAlive(), 'one engine lost leaves the engines on');
  assert(neb.isActive('TURBO'), 'and Turbo on');
  for (const h of engines.slice(1)) w.destroyHardpoint(neb, h, null);
  assert(!neb.engineAlive(), 'the last engine lost switches them off');
  assert(!neb.isActive('TURBO'), 'and Turbo with them');
  const rate = neb.turnRate;
  neb.setOrder({ kind: 'move', x: 9000, y: 0 });
  run(20);
  near(neb.speed / full, db.constants.num('Engines_Disabled_Speed_Modifier', 1), 0.03, 'speed by Engines_Disabled_Speed_Modifier');
  assert.equal(neb.turnRate, rate, 'turn rate unchanged');
}

{
  const { w, empire } = battle(9);
  const ic = w.spawn(T('Interdictor_Cruiser'), empire, 0, 0, 0);
  assert.equal(useAbility(w, ic, 'INTERDICT', true), null);
  assert(ic.isActive('INTERDICT'));
  destroy(w, ic, h => h.kind === 'HARD_POINT_GRAVITY_WELL');
  assert(!ic.isActive('INTERDICT'), 'the gravity well destroyed switches INTERDICT off');
  for (const st of ic.abilities) st.cooldown = 0;
  assert(useAbility(w, ic, 'INTERDICT', true), 'and it cannot be used again');
  assert(!ic.isActive('INTERDICT'));
}

{
  const { w, empire, run } = battle(10);
  const vd = w.spawn(T('Victory_Destroyer'), empire, 0, 0, 0);
  const bays = vd.hardpoints.filter(h => h.kind === 'HARD_POINT_FIGHTER_BAY');
  const spawned = u => u.garrison.reduce((s, g) => s + (g.spawned || 0), 0);
  assert(vd.garrison.length && bays.length, 'a Victory carries fighters and has bays');
  for (const b of bays) w.destroyHardpoint(vd, b, null);
  const n = spawned(vd);
  for (const g of vd.garrison) g.live.length = 0;
  run(30);
  assert.equal(spawned(vd), n, 'with every bay gone nothing launches');
  const hutt = w.spawn(T('Skirmish_Hutt_Asteroid_Base'), empire, 3000, 3000, 0);
  assert(hutt.garrison.length, 'the Hutt asteroid base lists squadrons');
  run(30);
  assert.equal(spawned(hutt), 0, 'a type with no fighter bay never launches');
}

{
  const { w, empire, rebel } = battle(11);
  const sd = T('Star_Destroyer');
  const K = db.constants.num('Space_Reinforcement_Collision_Check_Distance', 200);
  assert.equal(w.cantReinforce(empire, 0, 0, 0, sd, 0), null, 'an empty lane is clear');
  const other = w.spawn(T('Star_Destroyer'), rebel, -K * 0.6, 0, Math.PI / 2);
  other.speed = 0;
  assert(w.cantReinforce(empire, 0, 0, 0, sd, 0), 'a ship of the same layer in the last stretch of the approach blocks the drop');
  other.x = -K * 0.6;
  other.y = 1500;
  other.heading = -Math.PI / 2;
  assert.equal(w.cantReinforce(empire, 0, 0, 0, sd, 0), null, 'standing off the lane it does not');
  other.speed = 1500 / (115 / 30) + 50;
  assert(w.cantReinforce(empire, 0, 0, 0, sd, 0), 'moving across the lane within 115 frames it does');
  other.speed = 0;
  other.y = 6000;
  const corv = w.spawn(T('Corellian_Corvette'), rebel, -K * 0.5, 0, 0);
  corv.speed = 0;
  assert.equal(w.cantReinforce(empire, 0, 0, 0, sd, 0), null, 'another layer does not block a capital ship');
  assert(w.cantReinforce(empire, 0, 0, 0, T('Corellian_Corvette'), 0), 'its own layer does');
  assert.equal(w.cantReinforce(empire, 0, 0, 0, T('TIE_Fighter_Squadron'), 0), null, 'a corvette does not block a squadron');
  const base = w.spawn(T('Empire_Star_Base_1'), rebel, 3000, -3000, 0);
  assert(w.cantReinforce(empire, base.x + 100, base.y, 0, T('TIE_Fighter_Squadron'), 0), 'the static layer blocks every drop');
}

{
  const { w, empire, rebel, run } = battle(12);
  const vd = w.spawn(T('Victory_Destroyer'), empire, -4000, 0, 0);
  const foe = w.spawn(T('Corellian_Corvette'), rebel, 0, 0, 0);
  foe.setOrder({ kind: 'idle' });
  foe.hardpoints.forEach(h => (h.isWeapon = false));
  vd.setOrder({ kind: 'attack', target: foe });
  vd.target = foe;
  run(90);
  const want = Math.max(vd.type.num('Targeting_Min_Attack_Distance', 0) + foe.hitRadius, 0.9 * (vd.engageRange + foe.hitRadius));
  const d = Math.hypot(vd.x - foe.x, vd.y - foe.y);
  assert(d <= want + 5 && d >= want - 250, 'an attack order closes to the Arrange_Attack ring radius: ' + d + ' vs ' + want);
}

{
  const { w, empire } = battle(13);
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0, 0);
  const world = { time: 0, min: { x: -8000, y: -8000 }, max: { x: 8000, y: 8000 }, fields: [], hazardous: () => false };
  const ship = () => ({
    id: 77,
    x: 0,
    y: 0,
    heading: 0,
    speed: sd.maxSpeed,
    maxSpeed: sd.maxSpeed,
    turnRate: sd.turnRate,
    accel: sd.accel,
    radius: sd.radius,
    layer: sd.layer,
    pathExt: w.paths.ext(sd),
    asteroidDamage: false,
    shielded: false
  });
  const js = new PathCore(world, w.paths.K, w.paths.ringStep);
  assert.equal(js.find(ship(), 3000, 0), null, 'a clear move with no facing flies straight');
  const face = Math.PI / 2;
  const pts = js.find(ship(), 3000, 0, face);
  assert(pts && pts.length >= 3, 'a move with a facing is planned');
  const last = pts[pts.length - 1];
  near(last.x, 3000, 1, 'onto the goal');
  near(last.y, 0, 1, 'onto the goal');
  assert(Math.abs(wrap(last.h - face)) < w.paths.K.matchFace, 'arriving on the facing: ' + last.h);
  const bytes = readFileSync(new URL('../public/js/game/pathsearch.wasm', import.meta.url));
  const env = { now: () => performance.now(), cos: Math.cos, sin: Math.sin, atan2: Math.atan2, acos: Math.acos };
  const inst = (await WebAssembly.instantiate(bytes, { env })).instance;
  const wa = new PathCore(world, w.paths.K, w.paths.ringStep);
  wa.wasm = { ex: inst.exports, mem: inst.exports.memory };
  for (const [gx, gy, f] of [
    [3000, 0, face],
    [3000, 0, undefined],
    [-2500, 1800, 0],
    [1200, -2600, Math.PI],
    [600, 0, -Math.PI / 2]
  ]) {
    const a = js.find(ship(), gx, gy, f),
      b = wa.find(ship(), gx, gy, f);
    assert.deepEqual(b, a, 'the WebAssembly search is the JS one: ' + [gx, gy, f]);
  }
}

{
  const { w, empire } = battle(14);
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0, 0);
  settle(sd);
  sd.setOrder({ kind: 'move', x: 3500, y: 0, face: Math.PI / 2 });
  let at = null;
  for (let i = 0; i < 30 * 120 && at === null; i++) {
    w.update(DT);
    if (sd.order.kind === 'idle') at = sd.heading;
  }
  assert(at !== null, 'it arrives');
  assert(Math.abs(wrap(at - Math.PI / 2)) < 20 * DEG, 'planned onto its facing it arrives on it: ' + at / DEG);
}

console.log('space facing: ok');
