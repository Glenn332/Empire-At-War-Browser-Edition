import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod'),
  archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const k = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = k && archive.read(k);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, ObjType, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { TacticalSuperweapons, isTacticalSuperweapon, isSuperweaponTarget } = await import('../public/js/game/tacticalsuperweapon.js');
const { TacticalVictory, tacticalAnnouncement } = await import('../public/js/game/tacticalvictory.js');
const { spaceVictoryRelevant, sideBeaten } = await import('../public/js/game/campaignbattle.js');
const { TacticalCampaign } = await import('../public/js/game/tacticalcampaign.js');
const { loadCampaignData, startingGalaxy } = await import('../public/js/game/galaxy.js');
const { loadMap } = await import('../public/js/ted.js');
const THREE = await import('three');
const { cameraEase, superweaponShot } = await import('../public/js/game/tacticalsuperweaponcamera.js');
const type = [...db.types.values()].find(isTacticalSuperweapon);
assert(type);
const fixture = (props = {}) => {
  const t = new ObjType('SpaceUnit', 'NativeFixture');
  for (const [k, v] of Object.entries(props)) t.props.set(k.toLowerCase(), [String(v)]);
  return t;
};
const a = { team: { id: 0 }, factionName: 'Empire' },
  b = { team: { id: 1 }, factionName: 'Rebel' },
  sounds = [],
  replacements = [],
  voices = [],
  victory = new TacticalVictory();
const planet = { destroyed: false, type: fixture() },
  world = { audio: { play: n => sounds.push(n) } };
let destroyed = 0;
const manager = new TacticalSuperweapons(world, {
  planet,
  defender: b.team,
  destroyPlanet: () => {
    destroyed++;
    planet.destroyed = true;
    return true;
  },
  replace: (...args) => replacements.push(args),
  voice: (...args) => voices.push(args),
  requestVictory: (...args) => victory.request(...args, manager.disableDepth)
});
const makeUnit = player => ({
  type,
  player,
  x: 0,
  y: 0,
  z: 0,
  dead: false,
  bonus: { speed: 1 },
  mods: { speed: 1 },
  syncObj() {},
  playAnim: n => sounds.push(n)
});
const targetType = [...db.types.values()].find(
  t => isSuperweaponTarget(t) && t.list('Death_By_TSW_Replacements').length && t.list('Death_Explosions').length
);
assert(targetType);
const target = {
  type: targetType,
  owner: 'Neutral',
  x: 8000,
  y: 0,
  z: 0,
  rotation: [11, 22, 33],
  remove() {
    this.removed = true;
  }
};
manager.addTarget(target);
const unit = makeUnit(a);
manager.add(unit);
manager.update();
const r = manager.record(unit);
assert.equal(r.state, 3);
assert.equal(unit.z, type.num('TSW_Z_Adjust_Relative_To_Target_Pos'));
for (let i = 0; i < 200000 && r.state !== 4; i++) manager.update();
assert.equal(r.state, 4);
assert(voices.some(x => x[1] === 0));
assert(manager.command(unit, a));
unit.player = b;
manager.update();
assert.equal(r.state, 4, 'Ownership is revalidated when Event38 executes');
unit.player = a;
assert(manager.fire(unit));
assert.equal(manager.disableDepth, 1);
assert(sounds.includes(type.str('TSW_SFXEvent_Weapon_Power_Up')));
const charge = Math.trunc(Math.fround(30 * type.num('TSW_Power_Up_Countdown_Seconds'))),
  attack = Math.trunc(Math.fround(30 * type.num('TSW_Attack_Anim_Duration_Seconds'))),
  debris = type.num('TSW_Explosion_Debris_Creation_Frame_Delay'),
  post = type.num('TSW_Post_Destruction_Wait_Frames');
for (let i = 0; i < charge - 1; i++) manager.update();
assert.equal(r.state, 5);
manager.update();
assert.equal(r.state, 6);
assert.equal(destroyed, 0);
manager.update();
assert.equal(r.state, 7);
manager.update();
assert.equal(r.state, 8);
assert(sounds.includes('ATTACK'));
for (let i = 0; i < attack; i++) manager.update();
assert.equal(r.state, 9);
assert.equal(destroyed, 0);
manager.update();
assert.equal(destroyed, 1);
assert(target.removed);
assert.equal(r.state, 10);
assert.equal(replacements.length, 1);
assert.equal(victory.winner, null);
assert.equal(victory.pending[0].type, 16);
for (let i = 0; i < debris - 1; i++) {
  manager.update();
  victory.update(manager.disableDepth, () => {});
}
assert.equal(replacements.length, 1);
manager.update();
assert.equal(r.state, 12);
assert.equal(replacements.length, 1 + targetType.list('Death_By_TSW_Replacements').length);
assert.deepEqual(replacements[1][1].rotation, [11, 22, 33]);
for (let i = 0; i < post; i++) {
  manager.update();
  assert.equal(
    victory.update(manager.disableDepth, () => {}),
    null
  );
}
assert.equal(r.state, 13);
manager.update();
assert.equal(manager.disableDepth, 0);
assert.equal(r.state, 0);
assert.equal(
  victory.update(0, () => {}),
  null
);
assert.equal(victory.winner.type, 16);
assert.equal(victory.winner.frames, 29);
for (let i = 0; i < 28; i++)
  assert.equal(
    victory.update(0, () => {}),
    null
  );
assert(victory.update(0, () => {}));
assert(!manager.fire(unit));
planet.destroyed = false;
const defender = makeUnit(b),
  d = new TacticalSuperweapons(world, { planet, defender: b.team });
d.add(defender);
d.addTarget({ ...target, dead: false, removed: false });
d.update();
assert(d.ready(defender));
assert.equal(d.record(defender).targetType, null);
const { ScriptHost } = await import('../public/js/game/scripts.js'),
  { LuaVM, loadFengari } = await import('../public/js/lua.js');
const script = Object.assign(Object.create(ScriptHost.prototype), { world: { tacticalSuperweapons: d }, missing: new Map() }),
  vm = new LuaVM(await loadFengari(), {}),
  env = vm.environment({ Weapon: script.unitWrap(defender) });
assert.equal(
  vm.run(
    'assert(Weapon.Is_Tactical_Superweapon_Ready()==true);assert(Weapon.Fire_Tactical_Superweapon()==true);assert(Weapon.Is_Tactical_Superweapon_Ready()==false);assert(Weapon.Fire_Tactical_Superweapon()==false)',
    'native TSW commands',
    env
  ),
  null
);
assert.equal(script.missing.size, 0);
assert(!new TacticalSuperweapons(world, { planet: { type: fixture({ Planet_Is_Destroyable_By_TSW: 'No' }) } }).eligible());
assert(!spaceVictoryRelevant(fixture()));
assert(spaceVictoryRelevant(fixture({ Victory_Relevant: 'No', Space_Victory_Relevant: 'Yes' })));
if (mod < 0) assert(!spaceVictoryRelevant(type), 'Native Death Star alone is not a combat-victory blocker');
a.team.players = [{ reinforcements: [] }];
assert(sideBeaten({ units: [{ type: fixture(), player: { team: a.team, id: 0 } }], squads: [] }, a.team));
assert(!sideBeaten({ units: [{ type: fixture({ Space_Victory_Relevant: 'Yes' }), player: { team: a.team, id: 0 } }], squads: [] }, a.team));
const v = new TacticalVictory();
let checks = 0;
v.update(1, () => checks++);
assert.equal(checks, 0);
v.request(a.team);
for (let i = 0; i < 209; i++)
  assert.equal(
    v.update(0, () => {}),
    null
  );
assert.equal(v.update(0, () => {}).type, 11);
let notices = 0;
const queued = new TacticalVictory(() => notices++);
queued.request(a.team, 16, 30, 1);
for (let i = 0; i < 100; i++) queued.update(1, () => {});
assert.equal(notices, 0);
queued.update(0, () => {});
assert.equal(notices, 1);
assert.equal(queued.winner.frames, 29);
const human = { team: a.team, faction: fixture({ Enemies: 'Rebel', Allies: 'Partner' }) },
  enemyTeam = { factionName: 'Rebel', id: 1 },
  noTeam = { factionName: 'Partner', id: -1 },
  speechWorld = { units: [] };
a.team.factionName = 'Empire';
assert.equal(tacticalAnnouncement(speechWorld, human, a.team).sound, 'SFXEvent_HUD_Won_Space_Battle');
speechWorld.units = [{ type, player: { factionName: 'Rebel', id: 1, team: enemyTeam }, dead: true }];
assert.equal(tacticalAnnouncement(speechWorld, human, a.team).sound, 'Space_Forced_Retreat_Due_To_Superweapon');
const k = { type: fixture({ Is_Super_Weapon_Killer: 'Yes' }), player: human };
speechWorld.units.push(k);
assert.equal(tacticalAnnouncement(speechWorld, human, a.team).sound, 'SFXEvent_HUD_Won_Space_Battle_Enemy_TSW_Present');
k.dead = true;
assert.equal(tacticalAnnouncement(speechWorld, human, enemyTeam).sound, 'SFXEvent_HUD_Lost_Space_Battle_Enemy_TSW_Present');
assert.deepEqual(tacticalAnnouncement(speechWorld, human, noTeam), {
  sound: null,
  music: 'Music_Event_Tactical_Lose',
  text: null,
  ally: false
});
const data = await loadCampaignData(),
  campaign = data.campaigns.get(mod < 0 ? 'SANDBOX_EQUAL_FOOTING_EMPIRE' : 'KNOWNSMALL_ERA_1_EMPIRE'),
  g = startingGalaxy(data, campaign),
  p = g.planets.find(p => p.owner === 'Rebel' && !p.background) || g.planets.find(p => p.owner !== g.active && !p.background);
const game = {
    galaxy: g,
    setup: { campaign: { planet: p.index } },
    world: { onEvent: kind => assert.equal(kind, 'storyDestroyPlanet'), tacticalSuperweapons: manager }
  },
  bridge = new TacticalCampaign(game, g);
const orbital = { type },
  ground = { type, owner: p.owner };
p.garrison = [ground];
p.orbitalStructures = [orbital];
p.station = type;
assert.equal(bridge.destroy(unit), false, 'No invented leader victory');
assert(p.destroyed);
assert.equal(p.garrison.length, 0);
assert.deepEqual(p.orbitalStructures, [orbital]);
assert.equal(p.station, type);
const result = bridge.result({ entity: new Map([['0:0', unit]]) });
assert(result.planetDestroyed);
assert.equal(result.galaxy.planets[p.index].destroyed, true);
assert.deepEqual(result.superweapons, [{ gid: '0:0', owner: 'Empire' }]);
const victoryGame = { galaxy: g },
  V = bridge.victory.constructor;
g.fleets = [{ owner: 'Empire', planet: p.index, units: [{ type }], leg: null }];
g.planets.forEach(p => {
  p.destroyed = p.owner === 'Rebel';
});
victoryGame.victory = new V(victoryGame);
victoryGame.victory.records.push({ type: 6, player: 'Empire', names: [] });
victoryGame.victory.superweaponBattle({
  sides: ['Empire', 'Rebel'],
  winner: 'defender',
  planet: p.index,
  alive: ['0:0'],
  superweapons: [{ gid: '0:0', owner: 'Empire' }]
});
assert.equal(victoryGame.victory.winner?.type, 6);
assert.equal(victoryGame.victory.winner?.player, 'Empire');
g.fleets = [
  { owner: 'Empire', planet: p.index, units: [{ type }], leg: null },
  { owner: 'Rebel', planet: p.index, units: [{ type: fixture({ Is_Super_Weapon_Killer: 'Yes' }) }], leg: null }
];
victoryGame.victory = new V(victoryGame);
victoryGame.victory.records.push({ type: 3, player: 'Rebel', names: [] });
const kill = {
  sides: ['Empire', 'Rebel'],
  winner: 'defender',
  planet: p.index,
  alive: ['0:0', '1:0'],
  superweapons: [{ gid: '0:0', owner: 'Empire' }]
};
victoryGame.victory.superweaponBattle(kill);
assert(kill.superweaponDestroyed);
assert.deepEqual(kill.alive, ['1:0']);
assert.equal(victoryGame.victory.winner?.type, 3);
assert.equal(victoryGame.victory.winner?.frames, 5);
const camera = new THREE.PerspectiveCamera(),
  obj = new THREE.Object3D();
obj.position.set(100, 200, 300);
obj.scale.setScalar(2);
obj.updateMatrixWorld(true);
const camGame = { map: { objects: [] }, renderer: { camera }, cine: {} },
  camUnit = {
    type: fixture(),
    obj,
    x: 100,
    y: 200,
    z: 300,
    model: { box: new THREE.Box3(new THREE.Vector3(-10, -20, -30), new THREE.Vector3(10, 20, 30)) }
  },
  shot = superweaponShot(camGame, camUnit, { x: 1000, y: 2000, z: 3000 });
assert.equal(cameraEase(0, 0.5, 0.25), 0);
assert.equal(cameraEase(1, 0.5, 0), 1);
assert.equal(cameraEase(0.5, 0.5, 0.25), 0.4);
shot.frame(0);
assert.deepEqual(camera.position.toArray(), [140, 120, 426]);
shot.frame(10);
assert.deepEqual(camera.position.toArray(), [130, 140, 396]);
shot.frame(0.25);
assert.deepEqual(camera.position.toArray(), [130, 140, 396]);
shot.frame(0.25);
assert.deepEqual(camera.position.toArray(), [400, 0, 606]);
assert.equal(shot.frame(15), false);
shot.stop();
assert.deepEqual(camera.position.toArray(), [0, 0, 0]);
const ku = g.planets.find(p => p.name.toUpperCase() === 'KUAT')?.type;
if (ku) {
  const map = await loadMap(ku.str('Space_Tactical_Map'));
  assert(map.objects.some(o => isSuperweaponTarget(o.type)));
}
console.log(
  JSON.stringify({
    overlay: mod < 0 ? 'base' : 'mod',
    weapon: type.name,
    target: targetType.name,
    frames: { charge, attack, debris, post },
    checks:
      'XYZ approach, ownership, charge, attack animation, destruction, replacements, victory holds, native defaults, campaign snapshot, map target'
  })
);
