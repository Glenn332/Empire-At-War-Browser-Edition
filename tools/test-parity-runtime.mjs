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
const { MOD, CombatMods } = await import('../public/js/game/combatmods.js');
const { parseXML } = await import('../public/js/xml.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');
const { ScriptHost } = await import('../public/js/game/scripts.js');

// Script runtime parity with the original engine: what the game's own Lua (GAMEOBJECT, LIBRARY, GameScoring)
// gets back from the engine calls it makes, and the arrival vulnerability from GameConstants.

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });
const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  maps
    .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
    .split('\\')
    .pop()
);
const used = ['Star_Destroyer', 'Calamari_Cruiser', 'Nebulon_B_Frigate', 'Rebel_X-Wing_Squadron', 'Slave_I'];
{
  const names = new Set(),
    seen = new Set();
  for (const n of used) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}

S.resetEntityIds();
seedSim(11);
const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
w.modelOpts = { headless: true };
w.artReady = () => true;
w.onEvent = () => {};
w.fog = false;
const [empire, rebel, human] = ['Empire', 'Rebel', 'Empire'].map((f, i) =>
  w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6 }))
);
human.human = true;
const game = { world: w, land: false, map, setup: {}, human, ais: [] };
const host = await ScriptHost.create(game);
assert(host, 'the script host starts on the installed scripts');
while (!host.plans.ready) await new Promise(r => setTimeout(r, 20));
const vm = host.vm,
  wrap = e => host.wrap(e);
const run = secs => {
  for (let n = Math.round(secs / DT); n > 0; n--) w.update(DT);
};

const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0, 0);
const cal = w.spawn(T('Calamari_Cruiser'), rebel, -3000, 0, 0);
const neb = w.spawn(T('Nebulon_B_Frigate'), rebel, -3000, 400, 0);
for (const u of [sd, cal, neb]) {
  u.setOrder({ kind: 'idle' });
  for (const h of u.hardpoints) h.isWeapon = false;
}

// ---- A table keyed by game objects reaches the engine with its values (lua.js) ----
{
  let got;
  const env = vm.environment({ Probe: t => void (got = t), A: wrap(cal), B: wrap(neb) });
  assert.equal(vm.run('local t = {} t[A] = A t[B] = B Probe(t)', 'object keys', env), null);
  assert(Array.isArray(got) && got.length === 2, 'both values arrive: ' + JSON.stringify(got && got.length));
  assert(got.includes(wrap(cal)) && got.includes(wrap(neb)), 'as the object wrappers');
  assert.equal(vm.run('Probe({x = 1, [A] = A})', 'record', env), null);
  assert.deepEqual(got, { x: 1 }, 'a table with string keys keeps its record shape');
  assert.equal(vm.run('Probe({10, 20})', 'list', env), null);
  assert.deepEqual(got, [10, 20], 'a plain list is unchanged');
  assert.equal(vm.run('Probe({})', 'empty', env), null);
  assert.deepEqual(got, [], 'an empty table is an empty list');

  // PGCOMMANDS ConsiderDivertAndAOE and SUNDERED_HEART pass exactly such a set to Find_Best_Local_Threat_Center.
  assert.equal(
    vm.run(
      'local t = {} t[A] = A t[B] = B local pos, threat = Find_Best_Local_Threat_Center(t, 1000) Probe({pos ~= nil, threat or 0})',
      'threat centre',
      env
    ),
    null
  );
  assert.equal(got[0], true, 'a threat centre is found for an object-keyed set');
  assert(got[1] > 0, 'with its threat: ' + got[1]);
}

// ---- Get_Time_Till_Dead from the damage the object is taking ----
{
  const o = wrap(cal);
  assert.equal(o.Get_Time_Till_Dead(), 1e6, 'an object taking no damage is in no danger');
  for (let i = 0; i < 10; i++) {
    w.damage(cal, 200, { damageType: 'Damage_Default' });
    w.time += 0.1;
  }
  const rate = w.damageRate(cal),
    left = cal.toKill + (cal.shield || 0);
  assert(rate > 0, 'the battle measures the damage rate');
  const ttd = o.Get_Time_Till_Dead();
  assert(Math.abs(ttd - left / rate) < 1e-6, 'time till dead is what is left over the rate: ' + ttd);
  assert(ttd < 1e6, 'and is finite while taking damage');
  w.time += 60;
  assert(o.Get_Time_Till_Dead() > ttd * 100, 'the danger fades once the damage stops');
}

// ---- Scripts: per-object ScriptExit, every object in range, fighters delivered individually ----
{
  // SUNDERED_HEART.LUA (FoC) bails out with ScriptExit() for a human owner. That must not switch the script off
  // for an AI-owned Sundered Heart that comes later (scripts.js inert cache).
  const mine = w.spawn(T('Sundered_Heart'), human, 3000, 3000, 0);
  await host.prime();
  const instOf = e => host.instances.find(i => i.e === e);
  const humanInst = instOf(mine);
  assert(humanInst, 'the human Sundered Heart gets a script');
  assert.equal(humanInst.state, 'over', 'which exits on its first service');
  assert(!host.inert.has(mine.scriptType || mine.type), 'a ScriptExit does not mark the type inert');
  const theirs = w.spawn(T('Sundered_Heart'), rebel, 3000, -3000, 0);
  host.attach();
  const other = instOf(theirs);
  assert(other, 'an AI Sundered Heart spawned later still gets its script');
  host.source(other.key);
  while (host.fetching) await new Promise(r => setTimeout(r, 10));
  assert(host.start(other), 'and it starts');
  host.service(other);
  assert.equal(other.state, 'run', 'and keeps running: ' + host.errors.get(other.name));

  // SLAVE_I.LUA (FoC): Unit_Prox promotes a fighter to its squadron with Get_Parent_Object and counts each once.
  const fett = w.spawn(T('Slave_I'), empire, -2000, 3000, 0);
  host.attach();
  const ai = instOf(fett);
  assert(ai, 'an AI Slave I gets its script');
  host.source(ai.key);
  while (host.fetching) await new Promise(r => setTimeout(r, 10));
  assert(host.start(ai), 'and it starts');
  host.service(ai);
  assert.equal(ai.state, 'run', 'and keeps running: ' + host.errors.get(ai.name));
  assert.equal(ai.prox.length, 1, 'with its Unit_Prox registered');

  // Two X-Wing squadrons in range: each fighter is an event, with no cap per service.
  const sqs = [w.spawn(T('Rebel_X-Wing_Squadron'), rebel, -2000, 3100, 0), w.spawn(T('Rebel_X-Wing_Squadron'), rebel, -1950, 3050, 0)];
  const fighters = sqs.flatMap(s => s.fighters.filter(f => !f.dead));
  for (const f of fighters) {
    f.x = fett.x + 40;
    f.y = fett.y + 40;
  }
  ai.events.length = 0;
  host.queueProximity(ai, ai.prox[0]);
  const triggered = ai.events.map(ev => host.of(ev.params[1]));
  for (const f of fighters) assert(triggered.includes(f), 'every fighter in range is reported');
  assert(fighters.length > 6, 'more than the old cap of six: ' + fighters.length);
  assert(!triggered.some(x => x && x.isSquad), 'space reports fighters, not their squadrons');
  assert(!triggered.includes(cal) && !triggered.includes(sd) && !triggered.includes(fett), 'nothing out of range, nor the object itself');
  const f0 = wrap(fighters[0]);
  assert(f0.Is_Category('Fighter'), 'a reported X-Wing is a fighter');
  assert.equal(f0.Get_Parent_Object(), wrap(sqs[0]), 'whose Get_Parent_Object is its squadron');
  host.current = ai;
  try {
    assert.equal(vm.run('nearby_unit_count = 0 recent_enemy_units = {}', 'reset', ai.env), null);
    for (const ev of ai.events) {
      const r = vm.call(ai.env, 'Unit_Prox', ...ev.params);
      assert(r.ok, 'Unit_Prox runs on a fighter: ' + r.error);
    }
  } finally {
    host.current = null;
  }
  assert.equal(vm.read(ai.env, 'nearby_unit_count'), 2, 'the fighters count as their two squadrons');

  // Cancel_Event_Object_In_Range(func) cancels that handler only.
  host.current = ai;
  try {
    assert.equal(
      vm.run(
        'function P1() end function P2() end Object.Event_Object_In_Range(P1, 100) Object.Event_Object_In_Range(P2, 100) Object.Cancel_Event_Object_In_Range(P1)',
        'cancel one',
        ai.env
      ),
      null
    );
  } finally {
    host.current = null;
  }
  assert.equal(ai.prox.length, 2, 'Unit_Prox and P2 stay, P1 goes');
  assert(vm.sameRef(ai.prox[1].fn, vm.ref(ai.env, 'P2')), 'the one left is P2');
  host.current = ai;
  try {
    assert.equal(vm.run('Object.Cancel_Event_Object_In_Range()', 'cancel all', ai.env), null);
  } finally {
    host.current = null;
  }
  assert.equal(ai.prox.length, 0, 'with no handler every one on the object goes');
}

// ---- GameScoring: a death with no killing player is not scored ----
{
  const losses = () => host.losses()?.get(rebel.team)?.get(neb.type) || 0;
  assert.notEqual(host.losses(), null, 'GameScoring runs');
  const before = losses();
  host.dying = null;
  w.onEvent('killed', { unit: neb, killer: null });
  assert.equal(losses(), before, 'a death with no killer is skipped, as Update_Kill_Stats_Table does for a nil killer');
  w.onEvent('killed', { unit: neb, killer: empire });
  assert.equal(losses(), before + 1, 'a death with a killer is scored');
}

// ---- Arrival vulnerability from GameConstants (Space_Elevated_Vulnerability_*) ----
{
  const { duration, factor } = S.elevatedVulnerability();
  assert.equal(duration, db.constants.num('Space_Elevated_Vulnerability_Duration', 15));
  assert.equal(factor, db.constants.num('Space_Elevated_Vulnerability_Factor', -3));
  assert(duration > 0 && factor < 0, 'the installed data carries an arrival vulnerability');
  const mc = w.spawn(T('Calamari_Cruiser'), rebel, 5000, -3000, 0, { hyperspace: true });
  assert(mc.hyper, 'it jumps in');
  assert.deepEqual(mc.vulnerable, { until: w.time + duration, factor }, 'vulnerable from the moment it is brought in');
  assert(Math.abs(w.defenseOf(mc) - (1 - factor)) < 1e-9, 'damage x (1 - factor): ' + w.defenseOf(mc));
  const sq = w.spawn(T('Rebel_X-Wing_Squadron'), rebel, 5000, -2500, 0, { hyperspace: true });
  for (const f of sq.fighters) assert.equal(f.vulnerable?.factor, factor, 'each fighter of an arriving squadron too');
  const still = w.spawn(T('Calamari_Cruiser'), rebel, 5000, -2000, 0);
  assert.equal(w.defenseOf(still), 1, 'a ship placed on the map is not vulnerable');
  // Damage while it shows: x (1 - factor) against the same ship placed normally.
  mc.hyper.shown = true;
  for (const u of [mc, still]) u.shield = u.maxShield = 0;
  const h0 = mc.health;
  w.damage(mc, 50, { damageType: 'Damage_Default' });
  w.damage(still, 50, { damageType: 'Damage_Default' });
  assert(Math.abs((h0 - mc.health) / (still.maxHealth - still.health) - (1 - factor)) < 1e-6, 'arriving damage ratio');
  mc.setOrder({ kind: 'idle' });
  run(duration + 0.5);
  assert.equal(w.defenseOf(mc), 1, 'the vulnerability ends after the duration');
  assert.equal(mc.vulnerable, null, 'and is cleared');

  // Stacking as CombatMods does: the highest value per stacking category counts, categories add up.
  const m = new CombatMods();
  m.add(MOD.DEFENSE, 1, 'b', 0.1);
  assert(Math.abs(S.arrivalDefense(m, 0, factor) - (1 - (factor + 0.1))) < 1e-9, 'another category adds');
  m.add(MOD.DEFENSE, 0, 'a', 0.2);
  assert(Math.abs(S.arrivalDefense(m, 0, factor) - (1 - 0.3)) < 1e-9, 'a better bonus in category 0 hides it');
  assert(Math.abs(S.arrivalDefense(m, 0, factor) - (2 - m.factor(MOD.DEFENSE))) < 1e-9, 'which is then the plain defense');

  // FoC Enhanced Deployment: a Battlefield_Modifier_Ability with Disable_Reinforcement_Vulnerability.
  const xml = parseXML(`<U><Abilities><Battlefield_Modifier_Ability Name="Test_Deploy">
      <Disable_Reinforcement_Vulnerability>True</Disable_Reinforcement_Vulnerability><Apply_To_All_Allies>Yes</Apply_To_All_Allies>
    </Battlefield_Modifier_Ability></Abilities></U>`).children[0];
  const t = new ObjType('UpgradeObject', 'Test_Enhanced_Deployment');
  t.subs.set('abilities', [xml.child('Abilities')]);
  assert.equal(w.reinforcementVulnerabilityOff(rebel), false);
  const holder = { dead: false, player: rebel, type: t };
  w.units.push(holder);
  try {
    assert.equal(w.reinforcementVulnerabilityOff(rebel), true, 'the upgrade spares its owner');
    assert.equal(w.reinforcementVulnerabilityOff(empire), false, 'not the enemy');
  } finally {
    w.units.splice(w.units.indexOf(holder), 1);
  }
}

console.log('parity runtime: object-keyed tables, time till dead, proximity, ScriptExit, scoring and arrival vulnerability ok');
