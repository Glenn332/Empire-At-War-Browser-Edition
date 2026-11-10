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
const { CombatMods, MOD, SPACE, LAND, bonusSourceDefs, bonusTypeFits } = await import('../public/js/game/combatmods.js');
const S = await import('../public/js/game/sim.js');
const { LandWorld, LandSquad, landUnit } = await import('../public/js/game/land.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');

const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const near = (a, b, why) => assert(Math.abs(a - b) < 1e-6, why + ': ' + a + ' vs ' + b);

{
  const names = d => d.map(x => x.node.attrs.Name);
  assert.deepEqual(names(bonusSourceDefs(T('Grand_Moff_Tarkin'), SPACE)), ['Tarkin_Combat_Bonus'], 'Tarkin: a space bonus');
  assert.deepEqual(names(bonusSourceDefs(T('Grand_Moff_Tarkin'), LAND)), [], 'Tarkin gives nothing on the ground');
  assert.deepEqual(names(bonusSourceDefs(T('Emperor_Palpatine'), SPACE)), ['Emperor_Space_Combat_Bonus']);
  assert.deepEqual(names(bonusSourceDefs(T('Emperor_Palpatine'), LAND)), ['Emperor_Land_Combat_Bonus']);
  assert.deepEqual(names(bonusSourceDefs(T('Mon_Mothma'), SPACE)), ['Mothma_Combat_Bonus'], 'Combat_Automatic: space');
  assert.deepEqual(names(bonusSourceDefs(T('Mon_Mothma'), LAND)), ['Mothma_Combat_Bonus'], 'Combat_Automatic: land');
  assert.deepEqual(names(bonusSourceDefs(T('General_Veers'), SPACE)), [], 'Ground_Automatic is not used in space');
  const veers = bonusSourceDefs(T('General_Veers'), LAND)[0];
  assert(!bonusTypeFits(veers, T('Veers_AT_AT_Walker')), 'a bonus skips the Unique_Ground_Unit of its hero');
  assert(bonusTypeFits(veers, T('AT_AT_Walker')), 'and reaches the other vehicles');
  const piet = bonusSourceDefs(T('Captain_Piet'), SPACE);
  assert(!bonusTypeFits(piet[0], T('Accuser_Star_Destroyer')), 'Piet skips his Accuser');
  assert(bonusTypeFits(piet[1], T('Star_Destroyer')), 'Piet_Combat_Bonus_Star_Destroyer names its type');
  assert(!bonusTypeFits(piet[1], T('Victory_Destroyer')), 'and only that type');
}

{
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
    bonusSeen: 0
  });
  world.sideMods = factions.map(() => new CombatMods());
  const make = (name, side) => {
    const type = T(name),
      squad = new LandSquad(world, type, side),
      hp = type.num('Tactical_Health', 100) || 100,
      sh = type.num('Shield_Points', 0);
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
      shield: sh,
      maxShield: sh,
      dead: false
    });
    squad.members.push(u);
    world.units.push(u);
    world.squads.push(squad);
    world.syncCombatBonuses();
    return u;
  };
  const trooper = make('Stormtrooper', 0),
    base = trooper.maxHealth,
    rebel = make('Rebel_Trooper', 1),
    rebelBase = rebel.maxHealth;
  const emperor = make('Emperor_Palpatine', 0);
  near(trooper.maxHealth, base * 1.25, 'the Emperor on the field raises his side infantry health');
  near(trooper.health, base * 1.25, 'current health rises by the gain');
  near(rebel.maxHealth, rebelBase, 'enemies are untouched');
  near(emperor.maxHealth, T('Emperor_Palpatine').num('Tactical_Health', 100), 'the source does not take its own bonus');
  const ally = make('Stormtrooper', 2);
  near(ally.maxHealth, base * 1.25, 'an allied player unit made later takes it on creation');
  trooper.health = base;
  emperor.dead = true;
  world.syncCombatBonuses();
  near(trooper.maxHealth, base, 'the source dies: the bonus is taken back');
  near(trooper.health, base, 'health is clamped to the new maximum');
  near(ally.maxHealth, base, 'from every unit it reached');

  const yoda = make('Yoda', 1);
  near(world.combatFactor(rebel, MOD.DAMAGE), 1.25, 'Yoda: rebel damage +25%');
  near(world.combatFactor(trooper, MOD.DAMAGE), 1, 'not the enemy');
  near(world.combatFactor(yoda, MOD.DAMAGE), 1, 'not himself');

  const shelter = make('Rebel_Trooper', 1);
  world.carryBonuses(T('Mon_Mothma_Team'), shelter);
  near(rebel.maxHealth, rebelBase * 1.25, 'Mon Mothma staying in a transport gives her bonus to the battle');
  shelter.dead = true;
  world.syncCombatBonuses();
  near(rebel.maxHealth, rebelBase, 'and loses it with what holds her');

  const hero = make('Darth_Vader', 0),
    vaderBase = hero.maxHealth;
  world.bonusSource(T('Prop_EmpireHeroEnhancement'), -1);
  near(hero.maxHealth, vaderBase * 1.5, 'a neutral prop with Specific_Faction reaches the land heroes of that faction');
  near(world.combatFactor(hero, MOD.DAMAGE), 1.25, 'with its damage');
  near(trooper.maxHealth, base, 'not other categories');
  const han = make('Han_Solo', 1);
  near(han.maxHealth, T('Han_Solo').num('Tactical_Health', 100), 'nor heroes of another faction');
}

{
  const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
  const map = await loadMap(
    maps
      .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
      .split('\\')
      .pop()
  );
  const used = [
    'Star_Destroyer',
    'Victory_Destroyer',
    'Accuser_Star_Destroyer',
    'Home_One',
    'Corellian_Corvette',
    'Shuttle_Tyderium',
    'Alliance_Shuttle',
    'Nebulon_B_Frigate'
  ];
  const names = new Set(),
    seen = new Set();
  for (const n of used) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
  const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });
  const build = () => {
    S.resetEntityIds();
    seedSim(3);
    const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
    w.modelOpts = { headless: true };
    w.artReady = () => true;
    w.onEvent = () => {};
    w.fog = false;
    const players = ['Empire', 'Rebel'].map((f, i) => w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 0 })));
    return { w, empire: players[0], rebel: players[1] };
  };
  const { w, empire, rebel } = build();
  const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0),
    hull = sd.maxHealth,
    shields = sd.maxShield,
    vd = w.spawn(T('Victory_Destroyer'), empire, 300, 0),
    vdHull = vd.maxHealth,
    corvette = w.spawn(T('Corellian_Corvette'), rebel, 2000, 0),
    corvetteHull = corvette.maxHealth;
  const shuttle = w.spawn(T('Grand_Moff_Tarkin_Team'), empire, -500, 0);
  assert.equal(shuttle.type.name.toUpperCase(), 'SHUTTLE_TYDERIUM', 'Tarkin comes into space in his transport');
  near(sd.maxHealth, hull * 1.25, 'Tarkin carried in the fleet: hull +25%');
  near(sd.maxShield, shields * 1.1, 'shields +10%');
  near(sd.bonus.damage, 1.1, 'damage +10%');
  near(sd.bonus.defense, 0.9, 'defense 10%: damage taken x0.9');
  near(sd.bonus.speed, 1.1, 'speed +10%');
  near(corvette.maxHealth, corvetteHull, 'enemies untouched');
  const accuser = w.spawn(T('Accuser_Star_Destroyer'), empire, 600, 0);
  near(sd.maxHealth, hull * 1.5, 'Piet: the general bonus shares key 0 with Tarkin (largest), his Star_Destroyer bonus has key 1 (adds)');
  near(vd.maxHealth, vdHull * 1.25, 'a Victory Destroyer takes only key 0');
  near(accuser.bonus.health, 1.25, 'the Accuser takes Tarkin only: its own bonuses skip it');
  w.kill(shuttle, null);
  w.tickBonuses();
  near(sd.maxHealth, hull * 1.5, 'Tarkin gone: Piet still holds key 0 at the same size');
  near(sd.bonus.damage, 1, 'Tarkin damage bonus gone');
  near(sd.maxShield, shields, 'shields back');
  w.kill(accuser, null);
  w.tickBonuses();
  near(sd.maxHealth, hull, 'everything gone: back to the type hull');

  const home = w.spawn(T('Home_One'), rebel, 2200, 300);
  near(corvette.maxHealth, corvetteHull * 1.25, 'Home One: Akbar bonus on the rebel fleet');
  near(home.bonus.health, 1, 'Home One does not take its own bonus');
  const mothma = w.spawn(T('Mon_Mothma_Team'), rebel, 2400, 0);
  near(corvette.maxHealth, corvetteHull * 1.25, 'Mon Mothma health bonus shares key 0 with Akbar: the largest counts');
  w.kill(home, null);
  w.tickBonuses();
  near(corvette.maxHealth, corvetteHull * 1.25, 'Home One lost, Mon Mothma keeps the 25%');
  w.kill(mothma, null);
  w.tickBonuses();
  near(corvette.maxHealth, corvetteHull, 'both gone');

  const vet = w.spawn(T('General_Veers_Team'), empire, -900, 0);
  near(sd.maxHealth, hull, 'a Ground_Automatic bonus does nothing in space');
  if (vet) w.kill(vet, null);

  const ups = ['RS_Enhanced_Shielding_L2_Upgrade', 'RS_Enhanced_Shielding_L3_Upgrade'].map(T);
  const shieldOf = t =>
    t
      .sub('Abilities')
      .flatMap(a => a.all('Combat_Bonus_Ability'))
      .reduce((m, a) => Math.max(m, a.num('Shield_Bonus_Percentage', 0)), 0);
  const frigate = w.spawn(T('Nebulon_B_Frigate'), rebel, 2600, 0),
    fShield = frigate.maxShield,
    cShield = corvette.maxShield;
  for (const t of ups) w.applyUpgrade(rebel, t);
  const levels = ups.map(shieldOf);
  assert(fShield > 0 && levels.every(v => v > 0));
  near(frigate.maxShield, fShield * (1 + Math.max(...levels)), 'upgrade levels of one Stacking_Category replace each other');
  near(corvette.maxShield, cShield, 'a type the upgrade does not list is untouched');
  const later = w.spawn(T('Nebulon_B_Frigate'), rebel, 2800, 0);
  near(later.maxShield, frigate.maxShield, 'a ship made after the upgrade has it on creation');

  const twin = build();
  const a = twin.w.spawn(T('Star_Destroyer'), twin.empire, 0, 0);
  twin.w.spawn(T('Grand_Moff_Tarkin_Team'), twin.empire, -500, 0);
  const again = build();
  const b = again.w.spawn(T('Star_Destroyer'), again.empire, 0, 0);
  again.w.spawn(T('Grand_Moff_Tarkin_Team'), again.empire, -500, 0);
  assert.equal(a.maxHealth, b.maxHealth, 'the same battle gives the same numbers');
  assert.deepEqual(
    twin.w.bonusHolders.map(h => h.keys),
    again.w.bonusHolders.map(h => h.keys),
    'source keys are built from entity ids, the same on every machine'
  );
  assert.deepEqual(twin.w.carriedBy(twin.w.bonusHolders[0].host), ['Grand_Moff_Tarkin'], 'a save lists what a transport carries');
  twin.w.carryOnArrival(twin.empire, T('Shuttle_Tyderium'), T('Mon_Mothma_Team'));
  const late = twin.w.spawn(T('Shuttle_Tyderium'), twin.empire, 0, 900);
  twin.w.bonusArrival(twin.empire, T('Shuttle_Tyderium'), late);
  assert.deepEqual(twin.w.carriedBy(late), ['Mon_Mothma'], 'a waiting company brings its hero bonus when its transport arrives');

  const { placeCampaignBattle, battleResult, flagshipRider, ridesFlagship, flagshipScore } = await import(
    '../public/js/game/campaignbattle.js'
  );
  for (const n of ['Grand_Moff_Tarkin', 'Mon_Mothma', 'Emperor_Palpatine'])
    assert(flagshipRider(T(n)), n + ' has Attach_To_Flagship_During_Space_Battle and no space unit');
  assert(!flagshipRider(T('Captain_Piet')), 'Piet has his own ship');
  assert(!flagshipRider(T('Darth_Vader')), 'Vader does not attach');
  for (const n of ['Grand_Moff_Tarkin_Team', 'Mon_Mothma_Team', 'Emperor_Palpatine_Team'])
    assert(ridesFlagship(T(n)), n + ' rides the flagship');
  assert(!ridesFlagship(T('Piet_Team')), 'Piet_Team comes in its own ship');
  assert(flagshipScore(T('Star_Destroyer')) > flagshipScore(T('Victory_Destroyer')), 'hull and shields pick the flagship');
  const supers = T('Death_Star').list('CategoryMask');
  assert(supers.some(c => /^super$/i.test(c.trim())));
  assert.equal(flagshipScore(T('Death_Star')), 0, 'a Super ship is never the flagship');
  assert.equal(flagshipScore(T('Grand_Moff_Tarkin_Team')), 0, 'nor a company');

  const battle = (units, foes = []) => {
    const f = build(),
      cb = {
        planet: 'Kuat',
        attacker: { team: 1, units: foes.map((n, i) => ({ gid: 'r' + i, type: T(n) })) },
        defender: { team: 0, units: units.map((n, i) => ({ gid: 'e' + i, type: T(n) })) },
        linked: null
      };
    return { ...f, cb, book: placeCampaignBattle(f.w, map, f.w.teams, cb) };
  };
  const fleet = battle(['Victory_Destroyer', 'Grand_Moff_Tarkin_Team', 'Star_Destroyer', 'Victory_Destroyer'], ['Corellian_Corvette']);
  const flag = fleet.book.entity.get('e2'),
    escort = fleet.book.entity.get('e0');
  assert.equal(flag.type.name, 'Star_Destroyer');
  assert.equal(fleet.book.entity.get('e1'), flag, 'Tarkin is aboard the fleet flagship, the ship with the most hull and shields');
  assert(!fleet.w.units.some(u => /shuttle/i.test(u.type.name)), 'his shuttle does not come into the battle');
  assert.deepEqual(fleet.w.carriedBy(flag), ['Grand_Moff_Tarkin'], 'a save lists the hero the flagship carries');
  near(flag.bonus.health, 1.25, 'the flagship takes the bonus of the hero aboard');
  near(escort.bonus.health, 1.25, 'and the rest of the fleet');
  near(fleet.book.entity.get('r0').bonus.health, 1, 'enemies untouched');
  assert(battleResult(fleet.w, fleet.book, fleet.cb, 0).alive.includes('e1'), 'flagship alive: Tarkin survives');
  flag.retreated = true;
  assert(battleResult(fleet.w, fleet.book, fleet.cb, 0).alive.includes('e1'), 'a retreated flagship keeps him');
  flag.retreated = false;
  fleet.w.kill(flag, null);
  fleet.w.tickBonuses();
  near(escort.bonus.health, 1, 'flagship destroyed: the bonus is gone');
  assert(!battleResult(fleet.w, fleet.book, fleet.cb, 0).alive.includes('e1'), 'and Tarkin is lost with it');

  const loaded = build(),
    host = loaded.w.spawn(T('Star_Destroyer'), loaded.empire, 0, 0),
    side = loaded.w.spawn(T('Victory_Destroyer'), loaded.empire, 300, 0);
  loaded.w.carry(['Grand_Moff_Tarkin'], loaded.empire, host);
  near(host.bonus.health, 1.25, 'a loaded flagship gives its rider bonus to itself again');
  near(side.bonus.health, 1.25, 'and to the fleet');

  const alone = battle(['Grand_Moff_Tarkin_Team']);
  const ride = alone.book.entity.get('e0');
  assert.equal(ride.type.name.toUpperCase(), 'SHUTTLE_TYDERIUM', 'no ship to ride: Tarkin keeps his transport');
  assert.deepEqual(alone.w.carriedBy(ride), ['Grand_Moff_Tarkin']);

  const twice = battle(['Victory_Destroyer', 'Mon_Mothma_Team', 'Star_Destroyer']),
    again2 = battle(['Victory_Destroyer', 'Mon_Mothma_Team', 'Star_Destroyer']);
  assert.deepEqual(
    twice.w.bonusHolders.map(h => h.keys),
    again2.w.bonusHolders.map(h => h.keys),
    'flagship keys are built from entity ids'
  );

  assert.equal(fleet.book.entity.get('e2').flagship, true, 'the ship carrying a hero is marked as the flagship');
  assert(!escort.flagship, 'the others are not');
  assert(!alone.book.entity.get('e0').flagship, 'a transport carrying its own hero is no flagship');
  const plain = battle(['Victory_Destroyer', 'Star_Destroyer']);
  assert(!plain.w.units.some(u => u.flagship), 'no rider: the engine marks no flagship');

  const rebels = (upgrade, extra = {}) => {
    const f = build();
    if (upgrade) f.w.applyUpgrade(f.rebel, T(upgrade));
    const cb = {
      planet: 'Kuat',
      attacker: { team: 0, units: [{ gid: 'i0', type: T('Victory_Destroyer') }] },
      defender: {
        team: 1,
        units: ['MC30_Frigate', 'Mon_Mothma_Team', 'Pirate_Frigate_Captain'].map((n, i) => ({ gid: 'r' + i, type: T(n) }))
      },
      linked: null,
      ...extra
    };
    return { ...f, cb, book: placeCampaignBattle(f.w, map, f.w.teams, cb) };
  };
  assert(
    flagshipScore(T('Pirate_Frigate_Captain')) > flagshipScore(T('MC30_Frigate')) &&
      flagshipScore(T('Pirate_Frigate_Captain')) < flagshipScore(T('MC30_Frigate')) + 0.25 * T('MC30_Frigate').num('Shield_Points', 0),
    'the two frigates are close enough for a shield upgrade to decide'
  );
  const bare = rebels(null);
  assert.equal(bare.book.entity.get('r1').type.name, 'Pirate_Frigate_Captain', 'no upgrade: the pirate frigate has the most hull and shields');
  assert(bare.book.entity.get('r1').flagship);
  const shielded = rebels('RS_Enhanced_Shielding_L2_Upgrade');
  const mc30 = shielded.book.entity.get('r0');
  assert.equal(shielded.book.entity.get('r1'), mc30, 'Enhanced Shielding L2 lifts the MC30 above it: Mothma rides the MC30');
  assert(mc30.flagship && !shielded.book.entity.get('r2').flagship);
  const hullOf = t => t.num('Tactical_Health', 0) * db.constants.num('Object_Max_Health_Multiplier_Space', 1);
  near(
    flagshipScore(mc30.type, mc30),
    hullOf(mc30.type) * 1.25 + mc30.type.num('Shield_Points', 0) * 1.25,
    'the score takes the shield upgrade and the hull bonus of Mothma aboard'
  );
  const free = rebels(null, { upgrades: { Rebel: { space: ['RS_Enhanced_Shielding_L1_Upgrade'] } } });
  assert(free.rebel.upgrades.has('RS_ENHANCED_SHIELDING_L1_UPGRADE'), 'galaxy-wide upgrades are held before the fleets arrive');
  shielded.rebel.adjust = { health: 2, shield: 0.5 };
  near(
    flagshipScore(mc30.type, mc30),
    hullOf(mc30.type) * 1.25 * 2 + mc30.type.num('Shield_Points', 0) * 1.25 * 0.5,
    'the difficulty multipliers of the owner count'
  );
  shielded.rebel.adjust = null;

  const { snapshot, restore } = await import('../public/js/game/savegame.js');
  const live = battle(['Victory_Destroyer', 'Grand_Moff_Tarkin_Team', 'Star_Destroyer']);
  const game = {
    world: live.w,
    renderer: { rig: { x: 0, y: 0, dist: 1000, yaw: 0, pitch: 0.5 } },
    map: { planet: 'Kuat', activeEnvironment: 0 },
    setup: { mapFile: '', credits: 0, popCap: 0, fog: false, teamFactions: ['Empire', 'Rebel'], players: [] },
    ui: { groups: new Map(), selection: [] },
    speed: 1,
    human: live.empire
  };
  const save = JSON.parse(JSON.stringify(snapshot(game, 'flagship')));
  assert.equal(save.battle.entities.filter(o => o.flag).length, 1, 'the save marks one flagship');
  const back = build();
  const { refs } = restore({ world: back.w }, save);
  const marked = [...refs.values()].filter(e => e && e.flagship);
  assert.equal(marked.length, 1, 'a loaded battle keeps the flagship mark');
  assert.equal(marked[0].type.name, 'Star_Destroyer');
  assert.deepEqual(back.w.carriedBy(marked[0]), ['Grand_Moff_Tarkin'], 'and the hero aboard it');
}

console.log('combat bonus abilities ok');
