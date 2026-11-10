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
const { db, loadGameData, skirmishStation } = await import('../public/js/gamedata.js');
await loadGameData();
const { CombatMods, MOD, combatBonus } = await import('../public/js/game/combatmods.js');
const S = await import('../public/js/game/sim.js');
const { LandWorld, LandSquad, landUnit, timeOf } = await import('../public/js/game/land.js');
const { landAbilities, useAbility: landUse, tickAbilities: landTick } = await import('../public/js/game/landabilities.js');
const { useAbility: spaceUse, recharge } = await import('../public/js/game/abilities.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');

const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const near = (a, b, why) => assert(Math.abs(a - b) < 1e-6, why + ': ' + a + ' vs ' + b);
const bonusOf = name =>
  T(name)
    .sub('Abilities')
    .flatMap(a => a.all('Combat_Bonus_Ability'))
    .map(combatBonus)[0];

const L1 = bonusOf('UL_Ability_Recharge_L1_Upgrade'),
  L2 = bonusOf('UL_Ability_Recharge_L2_Upgrade');
const rechargeOf = b => (b.mods.find(([t]) => t === MOD.RECHARGE) || [0, 0])[1];
assert(rechargeOf(L1) < 0 && rechargeOf(L2) < 0, 'the land recharge upgrades carry Ability_Recharge_Bonus_Percentage');
assert.equal(L1.key, L2.key, 'both levels share one Stacking_Category');
const cut = Math.min(rechargeOf(L1), rechargeOf(L2));

{
  const sides = [new CombatMods()];
  const owner = { side: 0 };
  const own = new CombatMods(sides, owner);
  sides[0].add(MOD.RECHARGE, 0, 'side', -0.5);
  sides[0].add(MOD.BUILD, 0, 'side', -0.5);
  sides[0].add(MOD.DAMAGE, 0, 'side', 0.5);
  near(own.factor(MOD.RECHARGE), 1, 'the recharge countdown reads only the object book');
  near(own.factor(MOD.BUILD), 1, 'the build time reads only the object book');
  near(own.factor(MOD.DAMAGE), 1.5, 'damage still merges the player book');
  own.add(MOD.RECHARGE, 3, 'a', -0.15);
  own.add(MOD.RECHARGE, 3, 'b', -0.1);
  near(own.factor(MOD.RECHARGE), 0.9, 'largest of a stacking category');
  own.add(MOD.RECHARGE, 4, 'c', -2);
  near(own.factor(MOD.RECHARGE), 0.01, 'never below one hundredth of the time');
}

{
  const world = Object.assign(Object.create(LandWorld.prototype), {
    team: [0, 1],
    wild: 2,
    time: 1,
    aiSuspended: false,
    factions: ['Underworld', 'Empire'],
    units: [],
    squads: [],
    effects: [],
    beams: [],
    pings: [],
    shots: [],
    bolts: [],
    credits: [0, 0],
    mods: []
  });
  world.groundZ = () => 0;
  world.nearestOpen = (x, y) => ({ x, y });
  world.cast = () => false;
  const make = (name, x) => {
    const type = T(name),
      squad = new LandSquad(world, type, 0),
      hp = type.num('Tactical_Health', 100) || 100;
    const u = landUnit({
      type,
      side: 0,
      squad,
      x,
      y: 0,
      z: 0,
      heading: 0,
      health: hp,
      maxHealth: hp,
      shield: 0,
      maxShield: 0,
      armor: type.str('Armor_Type'),
      dead: false,
      inside: null,
      path: [],
      range: 200,
      minRange: 0,
      abilityKinds: new Set()
    });
    for (const def of landAbilities(type)) {
      u.abilityKinds.add(def.kind);
      squad.abilities.push({ def, active: false, left: 0, cooldown: 0 });
    }
    squad.members = [u];
    world.units.push(u);
    world.squads.push(squad);
    return u;
  };
  const run = secs => {
    for (let n = Math.round(secs * 30); n > 0; n--) {
      world.time += 1 / 30;
      landTick(world, 1 / 30);
    }
  };
  const plain = make('Underworld_Merc', 0),
    fast = make('Underworld_Merc', 100);
  world.applyUpgrade(fast, T('UL_Ability_Recharge_L1_Upgrade'));
  world.applyUpgrade(fast, T('UL_Ability_Recharge_L2_Upgrade'));
  near(world.combatFactor(fast, MOD.RECHARGE), 1 + cut, 'the two upgrade levels of one category give the larger cut');
  const stim = q => q.abilityState('STIM_PACK');
  const full = stim(plain.squad).def.recharge;
  assert(full > 0, 'Stim pack has a recharge');
  for (const u of [plain, fast]) assert.equal(landUse(world, u.squad, 'STIM_PACK'), null);
  run(stim(plain.squad).def.duration + 0.5);
  assert(!stim(plain.squad).active && !stim(fast.squad).active, 'the stim pack ran out');
  near(stim(plain.squad).span, full, 'without a bonus the countdown is Recharge_Seconds');
  near(stim(fast.squad).span, full * (1 + cut), 'with the upgrade the countdown is Recharge_Seconds times one plus the bonus');
  assert(stim(fast.squad).cooldown < stim(plain.squad).cooldown, 'the upgraded merc is ready sooner');
  run(full * (1 + cut) - 0.4);
  assert.equal(landUse(world, fast.squad, 'STIM_PACK'), null, 'and can use it again once the shorter countdown ends');
  assert.equal(landUse(world, plain.squad, 'STIM_PACK'), 'Not ready', 'while the other still waits');

  const factory = make('E_Ground_Barracks', 300);
  factory.cmods = new CombatMods();
  factory.cmods.add(MOD.BUILD, 0, 'test', -0.25);
  world.credits[0] = 1e6;
  world.mods = [{ build: 1, credit: 1, damage: 1, health: 1 }];
  near(world.combatFactor(factory, MOD.BUILD), 0.75, 'the build time bonus of a structure');
  world.queues = [{ units: [], upgrades: [] }];
  world.cantBuy = () => null;
  const trooper = T('Stormtrooper_Team');
  assert.equal(world.buy(factory, trooper, 0), null);
  const queued = world.queues[0].units.at(-1);
  near(queued.total, timeOf(trooper) * 0.75, 'land: the producing structure book scales the time it queues');
  near(timeOf(trooper), trooper.num('Tactical_Build_Time_Seconds', 10), 'from Tactical_Build_Time_Seconds');
}

{
  const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
  const map = await loadMap(
    maps
      .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
      .split('\\')
      .pop()
  );
  const yard = skirmishStation('Empire');
  assert(yard, 'the skirmish Empire station');
  const used = [yard.name, 'Corellian_Corvette', 'Nebulon_B_Frigate', 'Star_Destroyer', 'TIE_Fighter_Squadron', 'Tartan_Patrol_Cruiser'];
  const names = new Set(),
    seen = new Set();
  for (const n of used) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
  const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });
  S.resetEntityIds();
  seedSim(5);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const [empire, rebel] = ['Empire', 'Rebel'].map((f, i) => w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6 })));

  let pick = null;
  for (const n of used) {
    const u = w.spawn(T(n), n === 'Corellian_Corvette' || n === 'Nebulon_B_Frigate' ? rebel : empire, 0, 0);
    const st = u && u.abilities && u.abilities.find(s => s.def.recharge > 0 && s.def.target === 'none' && !s.def.toggle);
    if (st) {
      pick = { name: n, kind: st.def.kind, owner: u.player };
      w.kill(u, null);
      break;
    }
    if (u) w.kill(u, null);
  }
  assert(pick, 'a ship with a timed self ability');
  const a = w.spawn(T(pick.name), pick.owner, 0, 3000),
    b = w.spawn(T(pick.name), pick.owner, 600, 3000);
  b.cmods = new CombatMods();
  b.cmods.add(MOD.RECHARGE, L1.key, 'upgrade', cut);
  const sa = a.abilities.find(s => s.def.kind === pick.kind),
    sb = b.abilities.find(s => s.def.kind === pick.kind),
    full = sa.def.recharge;
  for (const u of [a, b]) assert.equal(spaceUse(w, u, pick.kind, true), null, pick.name + ' uses ' + pick.kind);
  if (sa.active) for (const u of [a, b]) spaceUse(w, u, pick.kind, false);
  near(sa.cooldown, full, 'space: no bonus, the countdown is Recharge_Seconds');
  near(sb.cooldown, full * (1 + cut), 'space: the object book shortens the countdown');
  assert(String(spaceUse(w, b, pick.kind, true)).startsWith('Recharging'), 'still recharging');
  recharge(b, sb, 10000);
  near(sb.cooldown, 10000, 'Force_Ability_Recharge with seconds sets that countdown as given');
  recharge(a, sa);
  near(sa.cooldown, full, 'and without seconds puts the ability on its full recharge');

  const station = w.spawn(yard, empire, -3000, 0);
  const opts = w.buildOptions(station, empire).filter(t => !w.cantBuild(station, t, empire));
  assert(opts.length, 'the station offers something to build');
  const type = opts[0];
  assert.equal(w.startBuild(station, type, empire), null);
  const first = [...station.buildQueues.values()].flat().at(-1);
  station.cmods = new CombatMods();
  station.cmods.add(MOD.BUILD, 0, 'yard', -0.25);
  station.cmods.add(MOD.BUILD, 0, 'yard2', -0.1);
  station.cmods.add(MOD.BUILD, 1, 'dock', -0.15);
  assert.equal(w.startBuild(station, type, empire), null);
  const second = [...station.buildQueues.values()].flat().at(-1);
  near(
    second.total,
    first.total * (1 - 0.1 - 0.15),
    'space: the station book scales the time it queues, the greatest value of a category counting'
  );
  near(first.total, S.buildTime(type) * (empire.adjust ? empire.adjust.build.space : 1), 'an item queued before keeps its time');
}

console.log('combat recharge and build time ok');
