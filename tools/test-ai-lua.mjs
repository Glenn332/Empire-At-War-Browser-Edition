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
const { seedSim, simRandom, simRandomState, setSimRandomState } = await import('../public/js/game/simrandom.js');
const { ScriptHost } = await import('../public/js/game/scripts.js');
const { hardpointKind, collisionBits, weakestHardpoint } = await import('../public/js/game/aiplans.js');
const { SpaceMind, loadSpaceBrain } = await import('../public/js/game/spacebrain.js');
const { SpaceGoals } = await import('../public/js/game/spacegoals.js');
const { SpecialWeapon } = await import('../public/js/game/superweapon.js');

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
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
  'Calamari_Cruiser',
  'Nebulon_B_Frigate',
  'TIE_Fighter_Squadron',
  'Mineral_Extractor_Pad',
  'Empire_Mineral_Extractor',
  'Skirmish_Empire_Star_Base_2'
];
{
  const names = new Set(),
    seen = new Set();
  for (const n of used) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

const S0 = S.World;
S.resetEntityIds();
seedSim(7);
const w = new S0({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
w.modelOpts = { headless: true };
w.artReady = () => true;
w.onEvent = () => {};
w.fog = false;
const [empire, rebel] = ['Empire', 'Rebel'].map((f, i) => w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6 })));
const game = { world: w, land: false, map, setup: {}, human: null, ais: [] };
const host = await ScriptHost.create(game);
assert(host, 'the script host starts on the installed scripts');
while (!host.plans.ready) await new Promise(r => setTimeout(r, 20));
const plans = host.plans,
  vm = host.vm;
const run = secs => {
  for (let n = Math.round(secs / DT); n > 0; n--) w.update(DT);
};

const mind = { at: () => 0 };
const aiOf = p => ({ player: p, mind, mine: () => [], value: () => 1 });
const plan = (p, names, lua = '') => {
  const inst = { ai: aiOf(p), forces: [], events: [], state: 'run', plan: true, thing: null, threads: [] };
  inst.env = vm.environment({});
  const src =
    lua +
    '\nfunction Default_Unit_Damaged(tf, unit, attacker, deliberate) end' +
    '\nfunction Default_Current_Target_Destroyed(tf) end' +
    '\nfunction Default_Original_Target_Owner_Changed(tf, old, new) end' +
    '\nfunction Default_Unit_Ability_Finished(tf, unit) end' +
    '\nfunction Default_Unit_Ability_Cancelled(tf, unit, ability) end' +
    '\nfunction Default_Unit_No_Threat(tf, unit) end' +
    '\nfunction Default_Unit_Move_Finished(tf, unit) end';
  assert.equal(vm.run(src, 'AI Lua test', inst.env), null);
  for (const name of names) {
    const f = { name, specs: [], units: [], had: false, moving: new Set(), seen: new Map(), inst, pool: [] };
    inst.forces.push(f);
    plans.force(f);
  }
  return inst;
};
const add = (inst, i, ...es) => {
  for (const e of es) inst.forces[i].take(e);
};
const wrap = e => host.wrap(e);
const told = (inst, name) => inst.events.filter(ev => ev.fn === plans.handler(inst, name));

const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0, 0);
const cal = w.spawn(T('Calamari_Cruiser'), rebel, -3000, 0, 0);
const neb = w.spawn(T('Nebulon_B_Frigate'), rebel, -3000, 400, 0);
for (const u of [sd, cal, neb]) for (const h of u.hardpoints) h.isWeapon = false;

{
  assert.equal(hardpointKind('Shield_Generator'), 1);
  assert.equal(hardpointKind('Engine'), 0);
  assert.equal(hardpointKind('HARD_POINT_WEAPON_LASER'), 5);
  assert.equal(hardpointKind('Random'), -1);
  assert.equal(collisionBits('ASTEROID | NEBULA'), 20);
  assert.equal(collisionBits('ION_FIELD'), null, 'an unknown collision type is refused as the engine does');
}

{
  const inst = plan(rebel, ['MainForce']),
    f = inst.forces[0];
  add(inst, 0, cal, neb);
  const gens = sd.hardpoints.filter(h => h.kind === 'HARD_POINT_SHIELD_GENERATOR');
  assert(gens.length >= 1, 'the Star Destroyer has a shield generator');
  const ions = sd.hardpoints.filter(h => h.kind === 'HARD_POINT_WEAPON_ION_CANNON');
  assert(ions.length >= 2, 'and at least two ion cannons');
  ions[1].health = ions[1].maxHealth * 0.4;
  assert.equal(weakestHardpoint(sd, 8), ions[1], 'the weakest ion cannon by health fraction');
  const b = f.wrapper.Attack_Target(wrap(sd), 'Shield_Generator', 500);
  assert(b && b.IsFinished, 'Attack_Target on a hard point kind returns a block');
  assert.equal(cal.order.kind, 'attack');
  assert.equal(cal.targetHp, weakestHardpoint(sd, 1), 'each member aims at the weakest shield generator');
  w.time += DT;
  assert.equal(b.IsFinished(), false);
  for (const h of gens) w.destroyHardpoint(sd, h, null);
  w.time += DT;
  assert.equal(b.IsFinished(), true, 'without repeat the block ends when that hard point falls');
  assert.equal(f.wrapper.Attack_Target(wrap(sd), 'Shield_Generator', 500), undefined, 'none of the kind left: nil');

  const e = f.wrapper.Attack_Target(wrap(sd), 'Weapon_Ion_Cannon', true);
  assert(e);
  assert.equal(cal.targetHp, ions[1], 'with repeat the weakest ion cannon first');
  w.time += DT;
  w.destroyHardpoint(sd, ions[1], null);
  assert.equal(e.IsFinished(), false, 'with repeat it moves to the next ion cannon');
  w.time += DT;
  assert(cal.targetHp && cal.targetHp.kind === 'HARD_POINT_WEAPON_ION_CANNON' && cal.targetHp.alive && cal.targetHp !== ions[1]);
  for (const h of ions) if (h.alive) w.destroyHardpoint(sd, h, null);
  w.time += DT;
  assert.equal(e.IsFinished(), true, 'and ends when none of the kind are left');

  const before = simRandomState();
  const want = Math.floor(simRandom() * 14);
  setSimRandomState(before);
  const r = f.wrapper.Attack_Target(wrap(sd), 'Random');
  assert.deepEqual(simRandomState(), (setSimRandomState(before), simRandom(), simRandomState()), 'Random draws one sim random');
  if (want === 13 || want >= 11) assert(r, 'a draw past the weapon kinds attacks the ship itself');
  assert.equal(f.wrapper.Attack_Target(wrap(sd), 'Not_A_Kind', 1), undefined, 'an unknown kind with more arguments: nil');
  assert.equal(f.wrapper.Attack_Target(wrap(sd), 10, 'ION_FIELD'), undefined, 'an unknown avoidance: nil');
  console.log('Attack_Target hard points: ok');
}
{
  const a = w.spawn(T('Corellian_Corvette'), empire, 2000, 2000, 0),
    b = w.spawn(T('Corellian_Corvette'), empire, 2100, 2000, 0),
    g1 = w.spawn(T('Corellian_Corvette'), empire, 2000, 2400, 0),
    g2 = w.spawn(T('Corellian_Corvette'), empire, 2100, 2400, 0);
  const inst = plan(empire, ['MainForce', 'EscortForce']);
  add(inst, 0, a, b);
  add(inst, 1, g1, g2);
  const was = simRandomState();
  const pick = [a, b][Math.floor(simRandom() * 2)];
  setSimRandomState(was);
  const blk = inst.forces[1].wrapper.Guard_Target(inst.forces[0].wrapper);
  assert(blk, 'guarding a task force returns a block');
  assert.equal(g1.order.kind, 'guard');
  assert.equal(g1.order.target?.id, pick.id, 'one member drawn with the sim random is guarded as an object');
  assert.equal(g2.order.target?.id, pick.id);
  w.time += DT;
  assert.equal(blk.IsFinished(), false);
  pick.player = rebel;
  w.time += DT;
  assert.equal(blk.IsFinished(), true, 'the block ends when the guarded member becomes an enemy');
  pick.player = empire;
  const blk2 = inst.forces[1].wrapper.Guard_Target(wrap(pick));
  w.time += DT;
  assert.equal(blk2.IsFinished(), false);
  w.kill(pick, null);
  w.time += DT;
  assert.equal(blk2.IsFinished(), true, 'and when it dies');
  plans.poll(inst);
  assert.equal(told(inst, 'Default_Current_Target_Destroyed').length, 2, 'Current_Target_Destroyed to every task force of the plan');
  assert.equal(
    inst.forces[1].wrapper.Guard_Target(plan(empire, ['Empty']).forces[0].wrapper),
    undefined,
    'guarding an empty task force: nil'
  );
  console.log('Guard_Target on a task force: ok');
}

{
  const t = w.spawn(T('Calamari_Cruiser'), rebel, 0, 2500, 0),
    m1 = w.spawn(T('Corellian_Corvette'), empire, 3000, 2500, 0),
    m2 = w.spawn(T('Corellian_Corvette'), empire, 3000, 2100, 0);
  t.heading = 0;
  const inst = plan(empire, ['FlankForce']);
  add(inst, 0, m1, m2);
  const R = T('Calamari_Cruiser').num('Space_FOW_Reveal_Range', 0);
  assert(R > 0);
  let asked = [];
  mind.at = q => {
    asked.push(q.rect);
    return Math.abs(q.rect.x + q.rect.w / 2 - -1000) < 1 ? 900 : 0;
  };
  const blk = inst.forces[0].wrapper.Prepare_Ambush(wrap(t), 'back', 1000, 500);
  assert(blk, 'Prepare_Ambush returns a block');
  assert.equal(asked[0].w, R, 'the threat is read over a square of the target type reveal range');
  assert(Math.abs(m1.order.x - -(1000 + R)) < 400 && Math.abs(m1.order.y - 2500) < 400, 'behind the target, a reveal range further on: ' + m1.order.x);
  w.time += DT;
  assert.equal(blk.IsFinished(), false);
  m1.setOrder({ kind: 'idle' });
  w.time += DT;
  assert.equal(blk.IsFinished(), false, 'one member arrived');
  plans.poll(inst);
  assert.equal(told(inst, 'Default_Unit_Move_Finished').length, 1, 'Unit_Move_Finished for each arrival');
  t.heading = Math.PI / 2;
  asked = [];
  w.time += 6;
  blk.IsFinished();
  assert(asked.length, 'planned again after 150 frames');
  assert(Math.abs(m2.order.x) < 400 && Math.abs(m2.order.y - (2500 - 1000)) < 400, 'following the target facing: ' + m2.order.y);
  m1.setOrder({ kind: 'idle' });
  m2.setOrder({ kind: 'idle' });
  w.time += DT;
  assert.equal(blk.IsFinished(), true);
  assert.equal(blk.Result(), true, 'everyone arrived: true');
  mind.at = () => 1e9;
  const none = inst.forces[0].wrapper.Prepare_Ambush(wrap(t), 'left', 1000, 500);
  w.time += DT;
  assert(none && none.IsFinished() === true && none.Result() === false, 'no safe point inside the map: finished at once, false');
  mind.at = () => 0;
  const dead = inst.forces[0].wrapper.Prepare_Ambush(wrap(t), 'front', 800, 500);
  w.kill(t, null);
  w.time += DT;
  assert.equal(dead.IsFinished(), true);
  assert.equal(dead.Result(), true, 'the target dying is a success');
  assert.equal(inst.forces[0].wrapper.Prepare_Ambush(wrap(m1), 'up', 800, 500), undefined, 'an unknown direction: nil');
  console.log('Prepare_Ambush: ok');
}

{
  const scout = w.spawn(T('Corellian_Corvette'), rebel, -4000, 4000, 0);
  const inst = plan(rebel, ['MainForce']);
  add(inst, 0, scout);
  w.fog = true;
  plans.seenGrid(rebel);
  const g = plans.seenGrid(rebel);
  const S = db.constants.num('AI_SpaceEvaluatorRegionSize', 2000);
  const cell = host.pos(0, 0, 0, 'CELL_3_2');
  assert.equal(String(cell.__name), 'CELL_3_2');
  w.time += 2;
  const blk = inst.forces[0].wrapper.Explore_Area(cell);
  assert(blk, 'Explore_Area returns a block');
  assert.equal(scout.order.kind, 'move');
  const p0 = { x: scout.order.x, y: scout.order.y };
  assert(Math.abs(p0.x) <= S / 2 + g.cell && Math.abs(p0.y) <= S / 2 + g.cell, 'a point inside the target area');
  const row = Math.floor((w.max.y - p0.y) / g.cell),
    col = Math.floor((p0.x - w.min.x) / g.cell);
  const y0 = w.max.y - (Math.floor((w.max.y - (S / 2)) / g.cell) + 0.5) * g.cell,
    x0 = w.min.x + (Math.floor((-S / 2 - w.min.x) / g.cell) + 0.5) * g.cell;
  assert(Math.abs(p0.y - y0) < 1 && Math.abs(p0.x - x0) < 1, 'never seen cells tie, the first from the top left wins');
  g.at.fill(w.time);
  g.at[row * g.nx + col + 1] = 0.5;
  g.at[(row + 1) * g.nx + col] = 0.25;
  scout.setOrder({ kind: 'idle' });
  w.time += DT;
  assert.equal(blk.IsFinished(), false);
  assert(Math.abs(scout.order.y - (p0.y - g.cell)) < 1 && Math.abs(scout.order.x - p0.x) < 1, 'then the cell seen longest ago');
  g.at.fill(w.time + 1);
  scout.setOrder({ kind: 'idle' });
  w.time += DT;
  assert.equal(blk.IsFinished(), true, 'nothing left unseen: finished');
  w.fog = false;
  console.log('Explore_Area: ok');
}

{
  const foe = w.spawn(T('Calamari_Cruiser'), rebel, 4000, -4000, 0),
    m = w.spawn(T('Corellian_Corvette'), empire, 1000, -4000, 0),
    solo = w.spawn(T('Corellian_Corvette'), empire, 1000, -4300, 0);
  const inst = plan(empire, ['MainForce']);
  add(inst, 0, m);
  const blk = inst.forces[0].wrapper.Attack_Move(wrap(foe));
  assert.equal(m.order.kind, 'attack', 'Attack_Move on an object attacks it');
  assert.equal(m.order.target, foe);
  w.time += DT;
  assert.equal(blk.IsFinished(), false);
  m.x = foe.x - 500;
  m.y = foe.y;
  w.fog = true;
  foe.seenBy = 0;
  w.time += DT;
  assert.equal(blk.IsFinished(), true, 'arrived with the target hidden in the fog: finished');
  w.fog = false;
  const blk2 = inst.forces[0].wrapper.Attack_Move(wrap(foe));
  w.time += DT;
  m.x = foe.x - 500;
  assert.equal(blk2.IsFinished(), false, 'a seen target is attacked on after arrival');
  const one = wrap(solo).Attack_Move(wrap(foe));
  assert.equal(solo.order.kind, 'attack', 'a single unit too');
  w.time += DT;
  assert.equal(one.IsFinished(), false);
  foe.player = empire;
  assert.equal(one.IsFinished(), true, 'until the target is no longer an enemy');
  w.time += DT;
  assert.equal(blk2.IsFinished(), true);
  foe.player = rebel;
  console.log('Attack_Move on an object: ok');
}

{
  const pad = w.spawn(T('Mineral_Extractor_Pad'), w.neutral || empire, 3500, 3500, 0),
    m = w.spawn(T('Corellian_Corvette'), empire, 3500, 3000, 0),
    shooter = w.spawn(T('Corellian_Corvette'), rebel, 4000, 3000, 0);
  assert(pad.isPad);
  const inst = plan(empire, ['MainForce']);
  inst.thing = pad;
  add(inst, 0, m);
  plans.poll(inst);
  pad.padOwner = empire;
  plans.poll(inst);
  const ev = told(inst, 'Default_Original_Target_Owner_Changed');
  assert.equal(ev.length, 1, 'Original_Target_Owner_Changed when the target pad is captured');
  assert.equal(ev[0].params[2].__player, empire);
  assert.equal(wrap(pad).Get_Owner().__player, empire, 'Get_Owner on a captured pad');
  inst.events.length = 0;
  shooter.target = m;
  w.damage(m, 30, { damageType: 'Damage_Default', attacker: rebel, from: shooter });
  w.damage(m, 30, { damageType: 'Damage_Default', attacker: rebel, from: shooter });
  const hit = told(inst, 'Default_Unit_Damaged');
  assert.equal(hit.length, 1, 'Unit_Damaged queued once');
  assert.equal(hit[0].params[2].__entity, shooter, 'with the real attacker');
  assert.equal(hit[0].params[3], true, 'deliberate when the attacker targets it');
  inst.events.length = 0;
  plans.poll(inst);
  assert.equal(m.threats.map.get(shooter) > 0, true, 'the damage is tracked against the attacker');
  w.time += 60;
  plans.poll(inst);
  assert.equal(told(inst, 'Default_Unit_No_Threat').length, 1, 'Unit_No_Threat once the tracked threat decays away');
  inst.events.length = 0;
  assert.equal(inst.forces[0].wrapper.Activate_Ability('NO_SUCH_ABILITY', true), undefined);
  assert.equal(told(inst, 'Default_Unit_Ability_Finished').length, 1, 'a member that cannot use the ability: Unit_Ability_Finished');
  inst.events.length = 0;
  w.onUnitSignal(m, 'Unit_Ability_Cancelled', 'TURBO');
  plans.poll(inst);
  const c = told(inst, 'Default_Unit_Ability_Cancelled');
  assert.equal(c.length, 1);
  assert.equal(c[0].params[2], 'TURBO');
  console.log('task force events: ok');
}

{
  const ast = { x: -3500, y: -2000, r: 800, asteroid: true },
    ship = w.spawn(T('Calamari_Cruiser'), rebel, -4400, -2000, 0);
  w.fields.push(ast);
  const inst = plan(rebel, ['MainForce']);
  add(inst, 0, ship);
  assert(ship.asteroidDamage, 'a cruiser takes asteroid damage');
  assert.equal(w.hazardous(ast, ship), true, 'an asteroid field is avoided by default');
  inst.forces[0].wrapper.Move_To(host.pos(-2000, -2000, 0), 10, 'ASTEROID | NEBULA');
  assert.equal(ship.order.through, 20, 'the avoidance string is carried on the order');
  assert.equal(w.hazardous(ast, ship), false, 'and the route search may path through the field');
  const blk = inst.forces[0].wrapper.Attack_Target(wrap(sd), 10, 'ASTEROID');
  assert(blk && ship.order.kind === 'attack' && ship.order.through === 4, 'Attack_Target carries it too');
  inst.forces[0].wrapper.Move_To(host.pos(-2000, -2000, 0), 10);
  assert.equal(w.hazardous(ast, ship), true, 'a later plain move avoids it again');
  w.fields.splice(w.fields.indexOf(ast), 1);
  console.log('avoidance: ok');
}

{
  const sq = w.spawn(T('TIE_Fighter_Squadron'), empire, 4000, 0, 0),
    pad = w.spawn(T('Mineral_Extractor_Pad'), w.neutral || empire, 4000, 1500, 0),
    gun = new SpecialWeapon(w, T('Ground_Empire_Hypervelocity_Gun'), empire, 0, 0, 0);
  w.specialWeapons = w.specialWeapons || [];
  w.specialWeapons.push(gun);
  pad.padOwner = empire;
  const probe = vm.environment({});
  const lua = src => {
    assert.equal(vm.run('function Probe() ' + src + ' end', 'AI Lua view', probe), null);
    const r = vm.call(probe, 'Probe');
    assert(r.ok, r.error);
    return r.value;
  };
  const names = lua(
    'local t = {} for _, o in pairs(Find_All_Objects_Of_Type(Find_Player("Empire"))) do table.insert(t, o.Get_Type().Get_Name()) end return table.concat(t, " ")'
  ).split(' ');
  assert(names.includes('TIE_FIGHTER_SQUADRON'), 'the squadron');
  assert(names.includes('TIE_FIGHTER'), 'its fighters one by one');
  assert(names.includes('MINERAL_EXTRACTOR_PAD'), 'a captured pad');
  assert(names.includes('GROUND_EMPIRE_HYPERVELOCITY_GUN'), 'the planet weapon');
  assert.equal(names.filter(n => n === 'TIE_FIGHTER').length, sq.fighters.length);
  const built = w.spawn(T('Empire_Mineral_Extractor'), empire, 4000, 1500, 0);
  pad.padChild = built;
  const pads = lua('local n = 0 for _, o in pairs(Find_All_Objects_Of_Type("Mineral_Extractor_Pad")) do n = n + 1 end return n');
  assert.equal(pads, w.units.filter(u => !u.dead && u.type === T('Mineral_Extractor_Pad')).length, 'a pad with a structure on it is still listed');
  assert.equal(lua('return tostring(Create_Position(1, 2, 0))'), 'Position');
  const goals = new SpaceGoals(w, () => []);
  const region = goals.regions[0];
  assert.equal(region.name, 'CELL_0_0');
  assert.equal(goals.thingOf(region).name, 'CELL_0_0', 'a cell target keeps its name for AITarget');
  const brain = await loadSpaceBrain('Empire');
  const station = w.spawn(T('Skirmish_Empire_Star_Base_2'), empire, -4000, -4000, 0);
  const m = new SpaceMind(brain, w, empire, { enemies: [] });
  assert.equal(m.sum([station], ['STRUCTURE']), 0, 'the station counts by its category mask only, not as a Structure');
  assert(m.sum([station], ['CAPITAL']) > 0, 'it is a Capital');
  console.log('Lua object view: ok');
}

console.log('ai lua: ok');
