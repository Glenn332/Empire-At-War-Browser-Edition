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
const { db, loadGameData, ObjType } = await import('../public/js/gamedata.js');
await loadGameData();
const S = await import('../public/js/game/sim.js');
const A = await import('../public/js/game/abilities.js');
const { parseXML } = await import('../public/js/xml.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');

// Fixes for a Thrawn's Revenge multiplayer space skirmish: fog of war, fighter targeting, heal pulses, ability
// effects, stationary reinforcements and the hyperspace arrival window. Each block below is one behaviour.

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

// ---- Fog: capture points show what the viewer last saw, sounds stop at the fog (a bare world, no map) ----
{
  const team = id => new S.Team(id, 'Empire');
  const ta = team(0),
    tb = team(1),
    tc = team(2);
  const pa = { id: 0, team: ta, get bit() { return ta.bit; } },
    pb = { id: 1, team: tb, get bit() { return tb.bit; } },
    pc = { id: 2, team: tc, get bit() { return tc.bit; } },
    neutral = { id: -1, team: new S.Team(-1, 'Neutral'), bit: 0 };
  const scout = { player: pa, x: 0, y: 0, revealRange: 500, dead: false };
  const pad = { player: neutral, x: 3000, y: 0, isPad: true, padOwner: null, padChild: null, capture: { progress: 0, by: null, time: 10 }, dead: false };
  const w = Object.assign(Object.create(S.World.prototype), {
    units: [scout, pad],
    reveals: [],
    fog: true,
    viewer: pa,
    reveal: false,
    fogLifted: 0,
    time: 0,
    fowCell: 100,
    fowRegrow: 6,
    min: { x: -5000, y: -5000 },
    max: { x: 5000, y: 5000 }
  });
  const look = dt => {
    w.time += dt;
    w.markViewCells();
  };
  look(0.25);
  assert.equal(pad.viewSees, false, 'the pad starts out of sight');
  assert.equal(w.shownOwner(pad), null, 'an unseen pad is neutral');
  pad.capture.by = pb;
  pad.capture.progress = 4;
  assert.equal(w.viewWatches(pad), false, 'an enemy capture in the fog shows no capture bar');
  pad.padOwner = pb;
  look(0.25);
  assert.equal(w.shownOwner(pad), null, 'an enemy capture the viewer did not see leaves the pad grey');
  scout.x = 2900;
  look(0.25);
  assert.equal(pad.viewSees, true, 'the scout sees the pad');
  assert.equal(w.shownOwner(pad), pb, 'in sight the pad shows its real owner');
  assert.equal(w.viewWatches(pad), true, 'a capture in sight shows its bar');
  scout.x = 0;
  look(0.25);
  assert.equal(pad.viewSees, false, 'the fog regrow window does not count as sight');
  pad.padOwner = pc;
  look(1);
  assert.equal(w.shownOwner(pad), pb, 'out of sight it keeps the owner last seen, not a later capture');
  const child = { player: pc, dead: false };
  pad.padChild = child;
  assert.equal(S.captureOwner(pad), pc, 'a pad built on belongs to its building');
  pad.padOwner = pa;
  pad.padChild = null;
  assert.equal(w.shownOwner(pad), pa, 'the viewer always sees its own side hold a pad');
  w.fog = false;
  assert.equal(w.shownOwner(pad), pa, 'without fog the real owner shows');
  w.fog = true;

  assert.equal(w.audible(4000, 4000, pb), false, 'an enemy sound in the fog is not heard');
  assert.equal(w.audible(4000, 4000, pa), true, 'the viewer hears its own side anywhere');
  assert.equal(w.audible(10, 10, pb), true, 'an enemy sound in sight is heard');
  w.reveal = true;
  assert.equal(w.audible(4000, 4000, pb), true, 'revealed maps hear everything');
  w.reveal = false;
  w.fogLifted = pa.bit;
  assert.equal(w.viewWatches(pad), true, 'an overrun lifts the fog for the capture bar too');
}

// ---- Abilities: a named ability's Owner_Particle_Effect, a heal pulse that fires for hurt fighters ----
{
  const particle = [...db.types.values()].find(t => /^particle$/i.test(t.tag) && t.str('Space_Model_Name'));
  assert(particle, 'a particle type to name');
  const xml = parseXML(`<U>
    <Unit_Abilities_Data><Unit_Ability><Type>SENSOR_JAMMING</Type><GUI_Activated_Ability_Name>Test_Jam</GUI_Activated_Ability_Name>
      <Expiration_Seconds>10</Expiration_Seconds><Effective_Radius>300</Effective_Radius></Unit_Ability></Unit_Abilities_Data>
    <Abilities><Sensor_Jamming_Ability Name="Test_Jam"><Owner_Particle_Effect>${particle.name}</Owner_Particle_Effect>
      <Owner_Particle_Bone_Name>ROOT</Owner_Particle_Bone_Name></Sensor_Jamming_Ability></Abilities></U>`).children[0];
  const t = new ObjType('SpaceUnit', 'Test_Jammer');
  t.subs.set('unit_abilities_data', [xml.child('Unit_Abilities_Data')]);
  t.subs.set('abilities', [xml.child('Abilities')]);
  const [jam] = A.parseAbilities(t);
  assert.equal(jam.kind, 'SENSOR_JAMMING');
  assert.equal(jam.ownerParticle, particle.str('Space_Model_Name'), "the jammer shows its ability's Owner_Particle_Effect");
  assert.deepEqual(jam.ownerParticleBones, ['ROOT'], 'on its Owner_Particle_Bone_Name');

  const healer = [...db.types.values()].find(x => /^projectile$/i.test(x.tag) && x.bool('Projectile_Instant_Heal_On_Detonation'));
  assert(healer, 'a healing projectile');
  const pulse = parseXML(
    `<Unit_Ability><Type>HARMONIC_BOMB</Type><Spawned_Object_Type>${healer.name}</Spawned_Object_Type></Unit_Ability>`
  ).children[0];
  const heal = A.healPulseOf({ kind: 'HARMONIC_BOMB', node: pulse });
  assert(heal && heal.radius === healer.num('Projectile_Instant_Heal_Radius', 100), 'a HARMONIC_BOMB spawning a heal is a heal pulse');
  assert.equal(A.healPulseOf({ kind: 'BLAST', node: pulse }), null, 'other kinds are not');
}

// ---- A real battle: arrivals, stationary reinforcements, fighter lead, squadrons placed on the map ----
const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  maps
    .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
    .split('\\')
    .pop()
);
const used = ['Star_Destroyer', 'Calamari_Cruiser', 'Rebel_Defense_Satellite_Repair', 'TIE_Fighter_Squadron', 'X-Wing_Squadron'];
{
  const names = new Set(),
    seen = new Set();
  for (const n of used) if (db.type(n)) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
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

{
  const { w, rebel } = battle(1);
  const sat = w.spawn(T('Rebel_Defense_Satellite_Repair'), rebel, 0, 0, 0, { hyperspace: true });
  assert(!sat.isMobile, 'the satellite has no locomotor');
  assert.equal(sat.hyper, null, 'a reinforcement that cannot move is set down at once, no hyperspace jump');
  const mc = w.spawn(T('Calamari_Cruiser'), rebel, 2000, 0, 0, { hyperspace: true });
  assert(mc.hyper && !mc.hyper.shown, 'a ship jumps in');
}

{
  const { w, empire, rebel, run } = battle(2);
  const a = w.spawn(T('Calamari_Cruiser'), rebel, 0, 0),
    b = w.spawn(T('Calamari_Cruiser'), rebel, 0, 3000);
  for (const u of [a, b]) {
    u.setOrder({ kind: 'idle' });
    u.shield = u.maxShield = 0;
  }
  w.startHyperspace(a);
  const h0 = a.health;
  w.damage(a, 100, { damageType: 'Damage_Default' });
  assert.equal(a.health, h0, 'a ship not yet out of hyperspace cannot be hit');
  assert.equal(S.inJump(a), true);
  a.hyper.shown = true;
  assert.equal(S.inJump(a), false, 'once its streak shows it is in the battle');
  w.damage(a, 100, { damageType: 'Damage_Default' });
  w.damage(b, 100, { damageType: 'Damage_Default' });
  const lostA = h0 - a.health,
    lostB = b.maxHealth - b.health;
  assert(lostB > 0, 'a hit lands');
  // GameConstants Space_Elevated_Vulnerability_Factor as a DEFENSE modifier: damage x (1 - factor).
  const arrival = 1 - S.elevatedVulnerability().factor;
  assert(Math.abs(lostA / lostB - arrival) < 1e-6, 'an arriving ship takes ' + arrival + 'x: ' + lostA / lostB);
  // Its jump done, the cruiser is back where it was placed for the next check.
  a.x = a.hyper.tx;
  a.y = a.hyper.ty;
  a.hyper = null;

  // An arriving Star Destroyer opens fire on a cruiser in reach while it finishes the jump.
  const sd = w.spawn(T('Star_Destroyer'), empire, -1500, 0);
  sd.setOrder({ kind: 'idle' });
  sd.hyper = { f: 60, tx: sd.x, ty: sd.y, h: 0, shown: true };
  w.holdHyperspace = true;
  const before = a.health + b.health;
  let fired = 0;
  const fire = w.fireHardpoint.bind(w);
  w.fireHardpoint = (u, ...rest) => {
    const ok = fire(u, ...rest);
    if (ok && u === sd) fired++;
    return ok;
  };
  run(4);
  assert(sd.hyper, 'still arriving (held)');
  assert(fired > 0, 'the arriving ship fired');
  assert(a.health + b.health < before || w.projectiles.length > 0, 'and its shots are out');
}

{
  const { w, empire, rebel, run } = battle(3);
  const sq = w.spawn(T('TIE_Fighter_Squadron'), empire, 0, 0);
  assert.equal(sq.alone, true, 'a squadron put on the map chases within Idle_Chase_Range like one that arrived');
  sq.setOrder({ kind: 'idle' });
  assert.equal(sq.alone, false, 'a Stop order parks it');
  sq.setOrder({ kind: 'move', x: 6000, y: 0 });
  const mc = w.spawn(T('Calamari_Cruiser'), rebel, 2500, 3000);
  mc.setOrder({ kind: 'idle' });
  assert(w.units.indexOf(sq.fighters[0]) < w.units.indexOf(mc), 'the fighters come before the cruiser in the update order');
  // Whatever the order, a ship firing at a fighter sees the fighter's last step in its history (lead prediction).
  const seen = [];
  const upd = w.updateWeapons.bind(w);
  w.updateWeapons = (u, dt) => {
    if (u === mc) for (const f of sq.fighters) if (!f.dead && f.l1x !== undefined) seen.push(Math.hypot(f.x - f.l1x, f.y - f.l1y));
    return upd(u, dt);
  };
  run(3);
  const moving = seen.filter(d => d > 0.01).length;
  assert(seen.length > 0, 'the cruiser looked at the fighters');
  assert(moving / seen.length > 0.9, 'the fighters show their movement to the cruiser: ' + moving + ' of ' + seen.length);
}

console.log('skirmish parity: fog, abilities, arrivals and fighter targeting ok');
