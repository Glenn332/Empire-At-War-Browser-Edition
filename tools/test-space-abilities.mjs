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
const { parseXML } = await import('../public/js/xml.js');
await loadGameData();
const S = await import('../public/js/game/sim.js');
const { parseAbilities, autoSpecials } = await import('../public/js/game/abilities.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};

// A mod-style type: the given XML on top of a stock type.
function modded(parent, xml) {
  const node = parseXML(xml).children[0].children[0],
    t = new ObjType(node.tag, node.attrs.Name);
  for (const c of node.children) {
    const key = c.tag.toLowerCase(),
      into = c.children.length ? t.subs : t.props;
    if (!into.has(key)) into.set(key, []);
    into.get(key).push(c.children.length ? c : c.text.trim());
  }
  t.parent = T(parent);
  db.types.set(t.name.toUpperCase(), t);
  return t;
}

modded(
  'Proj_Special_Obiwan_Instant_Heal_Blast',
  `<X><Projectile Name="Proj_Test_Fleet_Repair">
    <Projectile_Instant_Heal_Radius>600</Projectile_Instant_Heal_Radius>
    <Projectile_Instant_Heal_Targets_Category_Mask>Corvette | Frigate | Capital</Projectile_Instant_Heal_Targets_Category_Mask>
    <Projectile_Instant_Heal_Health_Increase>400</Projectile_Instant_Heal_Health_Increase>
  </Projectile></X>`
);
const tenderType = modded(
  'Corellian_Corvette',
  `<X><SpaceUnit Name="Test_Fleet_Tender">
    <Unit_Abilities_Data SubObjectList="Yes">
      <Unit_Ability>
        <Type>AREA_EFFECT_HEAL</Type>
        <Recharge_Seconds>10</Recharge_Seconds>
        <Spawned_Object_Type>Proj_Test_Fleet_Repair</Spawned_Object_Type>
        <Supports_Autofire>Yes</Supports_Autofire>
      </Unit_Ability>
    </Unit_Abilities_Data>
  </SpaceUnit></X>`
);
const laser = `<Laser_Defense_Ability Name="NAME">
        <Activation_Style>Space_Automatic</Activation_Style>
        <Projectile_Types_Targeted>MISSILE, TORPEDO, ROCKET</Projectile_Types_Targeted>
        <Protection_Radius>500</Protection_Radius>
        <Recharge_Time_In_Secs>0.25</Recharge_Time_In_Secs>
      </Laser_Defense_Ability>`;
const guardType = modded(
  'Corellian_Corvette',
  `<X><SpaceUnit Name="Test_Point_Defense_Corvette">
    <Unit_Abilities_Data SubObjectList="Yes"></Unit_Abilities_Data>
    <Abilities SubObjectList="Yes">
      ${laser.replace('NAME', 'Fore_Point_Defense')}
      ${laser.replace('NAME', 'Aft_Point_Defense')}
      ${laser.replace('NAME', 'Locked_Point_Defense').replace('<Activation_Style>', '<Initially_Enabled>No</Initially_Enabled><Activation_Style>')}
    </Abilities>
  </SpaceUnit></X>`
);
const heal = (name, body) => `<Force_Healing_Ability Name="${name}">
        <Activation_Style>Space_Automatic</Activation_Style>
        <Heal_Range>550</Heal_Range>
        <Heal_Percent>0.1</Heal_Percent>
        <Heal_Interval_In_Secs>1</Heal_Interval_In_Secs>
        <Single_Target_Heal>No</Single_Target_Heal>
        ${body}
      </Force_Healing_Ability>`;
const dockType = modded(
  'Rebel_Defense_Satellite_Repair',
  `<X><SpaceUnit Name="Test_Repair_Dock">
    <Abilities SubObjectList="Yes">
      ${heal('Capital_Repair', '<Applicable_Unit_Categories>Capital</Applicable_Unit_Categories><Excluded_Unit_Types>Home_One</Excluded_Unit_Types>')}
      ${heal('Corvette_Repair', '<Applicable_Unit_Types>Corellian_Corvette</Applicable_Unit_Types>')}
    </Abilities>
  </SpaceUnit></X>`
);

const missile = [...db.types.values()].find(t => /^missile$/i.test(t.str('Projectile_Category').trim()) && t.num('Max_Speed', 0) > 0);
assert(missile, 'a missile projectile');
const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  (maps.find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n)) || maps.find(n => /SPACE/.test(n))).split('\\').pop()
);
{
  const names = new Set(),
    seen = new Set();
  for (const n of ['Corellian_Corvette', 'Calamari_Cruiser', 'Home_One', 'Star_Destroyer', 'Rebel_Defense_Satellite_Repair', 'Slave_I'])
    S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

function battle(human = false) {
  S.resetEntityIds();
  seedSim(7);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const players = ['Rebel', 'Empire'].map((f, i) =>
    w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6, human: human && !i }))
  );
  const run = seconds => {
    for (let n = Math.round(seconds / DT); n > 0; n--) w.update(DT);
  };
  return { w, players, run };
}
const wound = (u, f) => {
  u.health = u.maxHealth * f;
  for (const hp of u.hardpoints) if (hp.destroyable) hp.health = hp.maxHealth * f;
};
const parts = u => u.hardpoints.filter(h => h.destroyable && h.alive);

// The tender's ability is read from the XML although the engine has no handler named after its type.
{
  const defs = parseAbilities(tenderType),
    def = defs.find(d => d.kind === 'AREA_EFFECT_HEAL');
  assert(def && def.blast && def.autofire && !def.toggle, 'an ability that only names a projectile is kept');
  assert.equal(def.recharge, 10);
}

// An AI tender repairs on its own, but only once somebody near it is hurt.
{
  const { w, players, run } = battle();
  const tender = w.spawn(tenderType, players[0], 0, 0, 0),
    ship = w.spawn(T('Calamari_Cruiser'), players[0], 300, 0, 0),
    far = w.spawn(T('Calamari_Cruiser'), players[0], 3000, 0, 0),
    state = tender.abilities.find(s => s.def.kind === 'AREA_EFFECT_HEAL');
  assert(state && state.auto, 'the tender carries the ability with autofire on');
  run(2);
  assert.equal(state.cooldown, 0, 'nothing to repair, the ability is not spent');
  wound(ship, 0.5);
  wound(far, 0.5);
  assert(parts(ship).length, 'the patient has hardpoints');
  run(1.5);
  assert(state.cooldown > 0, 'the tender used its ability');
  assert(ship.health > ship.maxHealth * 0.5, 'hull repaired');
  for (const hp of parts(ship)) assert(hp.health > hp.maxHealth * 0.5, 'hardpoints repaired');
  assert(ship.healthFrac > 0.5, 'the health bar moves');
  assert(far.healthFrac <= 0.5 + 1e-9, 'ships out of reach are not repaired');
  const first = ship.healthFrac;
  run(12);
  assert(ship.healthFrac > first, 'the tender repairs again after the recharge');
}

// Hardpoints that are gone for good are not something to repair, so they do not keep the tender busy.
{
  const { w, players, run } = battle();
  const tender = w.spawn(tenderType, players[0], 0, 0, 0),
    ship = w.spawn(T('Calamari_Cruiser'), players[0], 300, 0, 0),
    lost = parts(ship)[0];
  lost.alive = false;
  lost.health = 0;
  run(3);
  assert(ship.healthFrac < 1, 'the ship is short of a hardpoint');
  assert.equal(tender.abilities[0].cooldown, 0, 'the tender does not fire for a lost hardpoint');
}

// Stock abilities of the same shape (a bomb set off at the owner) now fire on autofire as their XML asks.
{
  const { w, players, run } = battle();
  const bomber = w.spawn(T('Slave_I'), players[0], 0, 0, 0),
    state = bomber.abilities.find(s => s.def.kind === 'HARMONIC_BOMB');
  assert(state && state.def.blast && state.auto, 'the harmonic bomb is an autofire area ability');
  run(2);
  assert.equal(state.cooldown, 0, 'no enemy near, no bomb');
  const enemy = w.spawn(T('Star_Destroyer'), players[1], 150, 0, Math.PI);
  enemy.holdFire = true;
  run(1.5);
  assert(state.cooldown > 0, 'the bomb is dropped once an enemy is in its blast');
}

// A player with autofire off uses the same ability by hand (the path the command bar and Lua take).
{
  const { w, players, run } = battle(true);
  players[0].autofire = false;
  const tender = w.spawn(tenderType, players[0], 0, 0, 0),
    ship = w.spawn(T('Calamari_Cruiser'), players[0], 300, 0, 0),
    state = tender.abilities.find(s => s.def.kind === 'AREA_EFFECT_HEAL');
  wound(ship, 0.5);
  run(2);
  assert(!state.auto && state.cooldown === 0 && ship.health <= ship.maxHealth * 0.5 + 1e-6, 'no autofire, no repair');
  assert.equal(w.useAbility(tender, 'AREA_EFFECT_HEAL', true), null);
  assert(ship.health > ship.maxHealth * 0.5 && state.cooldown > 0, 'the manual repair works');
}

// Automatic point defense with no command-bar ability runs from the start and never switches off.
{
  assert.equal(parseAbilities(guardType).filter(d => d.kind === 'LASER_DEFENSE').length, 0);
  assert.equal(autoSpecials(guardType).length, 2, 'every enabled automatic laser defense is read');
  const { w, players, run } = battle();
  const guard = w.spawn(guardType, players[0], 0, 0, 0),
    enemy = w.spawn(T('Star_Destroyer'), players[1], 6000, 0, Math.PI);
  enemy.holdFire = true;
  guard.holdFire = true;
  assert.equal(guard.passives.length, 2);
  const shootDown = why => {
    w.launchPoint(missile, enemy, 450, 0, 0, 0, 0, 0);
    const shot = w.projectiles[w.projectiles.length - 1];
    assert(shot && !shot.dead, 'a missile is in flight');
    let beam = false;
    for (let i = 0; i < 60 && !beam; i++) {
      run(DT);
      beam = w.beams.some(b => b.a === guard && b.b.id === undefined);
    }
    assert(beam && shot.dead, why);
  };
  run(0.5);
  shootDown('the point defense shoots down a missile right away');
  run(45);
  shootDown('and still does after its Defense_Duration_In_Secs');
}

// Every Force_Healing_Ability block runs, with its own type filters.
{
  const { w, players, run } = battle();
  const dock = w.spawn(dockType, players[0], 0, 0, 0),
    capital = w.spawn(T('Calamari_Cruiser'), players[0], 300, 0, 0),
    corvette = w.spawn(T('Corellian_Corvette'), players[0], -300, 0, 0),
    excluded = w.spawn(T('Home_One'), players[0], 0, 400, 0);
  assert.equal(dock.heals.length, 2);
  for (const u of [capital, corvette, excluded]) wound(u, 0.5);
  run(3);
  assert(capital.healShare() > 0.5 + 1e-6, 'the first block repairs capital ships');
  assert(corvette.healShare() > 0.5 + 1e-6, 'the second block repairs the listed type');
  assert(excluded.healShare() <= 0.5 + 1e-6, 'Excluded_Unit_Types are left alone');
}

console.log('space abilities: ok');
