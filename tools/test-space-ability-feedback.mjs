import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const modDir = process.env.SWR_TEST_MOD || '';
const archive = openGame(gameDir, modDir ? [modDir] : []);
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
const { parseAbilities, autoSpecials } = await import('../public/js/game/abilities.js');
const { beamMessage, beamFromMessage } = await import('../public/js/game/spacerecord.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');

const DT = 1 / 30;
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });
const recorder = calls =>
  new Proxy(
    {},
    {
      get: (t, name) =>
        typeof name === 'string'
          ? (...args) => {
              calls.push([name, args]);
              return nothing;
            }
          : undefined
    }
  );

const spaceTypes = [...db.types.values()].filter(t => t.tag === 'SpaceUnit' && t.str('Space_Model_Name'));
const laserType = spaceTypes.find(t => [...parseAbilities(t), ...autoSpecials(t)].some(d => d.kind === 'LASER_DEFENSE' && d.spec && d.spec.val('Zap_SFXEvent')));
const healType = spaceTypes.find(t =>
  t
    .sub('Abilities')
    .flatMap(a => a.all('Force_Healing_Ability'))
    .some(h => h.num('Heal_Range', 0) > 0 && h.val('Target_Particle_Effect') && h.val('Target_Light_Effect_Type'))
);
const particleType = [...db.types.values()].find(
  t => t.str('Space_Model_Name') && !S.isSquadronType(t) && parseAbilities(t).some(d => d.ownerParticle && d.duration > 0)
);
const missile = [...db.types.values()].find(t => /^missile$/i.test(t.str('Projectile_Category').trim()) && t.num('Max_Speed', 0) > 0);
const target = spaceTypes.find(t => /^Corellian_Corvette$/i.test(t.name)) || spaceTypes.find(t => t.categories().has('CORVETTE'));
assert(laserType && missile && target, 'a laser defense ship, a missile and a target');

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  (maps.find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n)) || maps.find(n => /SPACE/.test(n))).split('\\').pop()
);
{
  const names = new Set(),
    seen = new Set();
  for (const t of [laserType, healType, particleType, target].filter(Boolean)) S.modelsForType(t, null, names, seen);
  await preloadModels([...names].filter(Boolean));
}

function battle() {
  S.resetEntityIds();
  seedSim(5);
  const fxCalls = [],
    audioCalls = [];
  const w = new S.World({ scene: new THREE.Scene(), fx: recorder(fxCalls), audio: recorder(audioCalls), map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const players = ['Empire', 'Rebel'].map((f, i) => w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6 })));
  const run = seconds => {
    for (let n = Math.round(seconds / DT); n > 0; n--) w.update(DT);
  };
  return { w, players, run, fxCalls, audioCalls };
}

{
  const { w, players, run, audioCalls } = battle();
  const guard = w.spawn(laserType, players[0], 0, 0, 0),
    enemy = w.spawn(target, players[1], 900, 0, Math.PI);
  const state = [...guard.abilities, ...guard.passives].find(s => s.def.kind === 'LASER_DEFENSE'),
    spec = state.def.spec;
  state.active = true;
  state.timer = state.def.duration;
  w.launchPoint(missile, enemy, 450, 0, 0, 0, 0, 0);
  let beam = null;
  for (let i = 0; i < 90 && !beam; i++) {
    run(DT);
    beam = w.beams.find(b => b.a === guard && b.b.id === undefined);
  }
  assert(beam, 'the point defense draws a beam to the projectile it destroys');
  const rgb = spec
    .val('Laser_Color')
    .split(/[\s,]+/)
    .map(Number);
  assert.deepEqual(
    beam.color.map(c => Math.round(c * 255)),
    rgb.slice(0, 3),
    'the beam uses Laser_Color'
  );
  assert.equal(beam.width, spec.num('Laser_Beam_Width', 4), 'the beam uses Laser_Beam_Width');
  near(beam.until - w.time, spec.num('Laser_Beam_Frames', 2) / 30, 'the beam lasts Laser_Beam_Frames', 0.05);
  const boneNames = spec
    .val('Bone_Names')
    .split(/[\s,|]+/)
    .filter(Boolean);
  if (guard.model && boneNames.some(n => guard.model.bone(n))) assert(boneNames.includes(beam.bone), 'the beam leaves from a Bone_Names bone');
  assert(
    audioCalls.some(([, args]) => args.includes(spec.val('Zap_SFXEvent'))),
    'the zap plays Zap_SFXEvent'
  );
  const crossed = beamFromMessage(new Map([[guard.id, guard]]), structuredClone(beamMessage(beam)));
  assert(crossed && crossed.a === guard, 'the point beam crosses the worker message');
  assert.deepEqual([crossed.b.x, crossed.b.y, crossed.b.z], [beam.b.x, beam.b.y, beam.b.z || 0]);
}

if (healType) {
  const { w, players, run, fxCalls } = battle();
  const healer = w.spawn(healType, players[0], 0, 0, 0),
    hurt = w.spawn(target, players[0], 200, 0, 0);
  hurt.health = hurt.maxHealth * 0.5;
  for (const hp of hurt.hardpoints) if (hp.destroyable) hp.health = hp.maxHealth * 0.5;
  run(healer.heal.interval * 2 + 0.5);
  const particle = fxCalls.find(([name, args]) => name === 'attachFx' && args[0] === hurt);
  assert(particle && particle[1][1], 'the healed ship shows Target_Particle_Effect');
  assert(
    fxCalls.some(([name, args]) => name === 'unitFlash' && args[0] === hurt),
    'the healed ship flashes Target_Light_Effect_Color'
  );
} else console.log('no space Force_Healing_Ability with a target effect in this data, heal feedback skipped');

{
  const { w, players, fxCalls } = battle();
  const tender = [...db.types.values()].find(
    t => t.bool('Projectile_Instant_Heal_On_Detonation') && (t.str('Projectile_Instant_Heal_Spawn_Effect') || t.str('Projectile_Object_Detonation_Particle'))
  );
  if (tender) {
    w.detonate(tender, players[0], 0, 0, 0);
    assert(!fxCalls.some(([name]) => name === 'explosion'), 'a heal blast draws no explosion');
  }
  const ship = w.spawn(target, players[0], 0, 0, 0);
  ship.health = ship.maxHealth * 0.5;
  if (tender && tender.str('Projectile_Instant_Heal_Spawn_Effect')) {
    const fakeHeal = Object.create(tender);
    fakeHeal.str = key =>
      key === 'Projectile_Instant_Heal_Targets_Category_Mask' ? '' : tender.str(key);
    fxCalls.length = 0;
    w.instantHeal(fakeHeal, players[0], 0, 0);
    if (S.particleFile(tender.str('Projectile_Instant_Heal_Spawn_Effect')))
      assert(
        fxCalls.some(([name, args]) => name === 'attachFx' && args[0] === ship && args[1]),
        'the instant heal shows Projectile_Instant_Heal_Spawn_Effect'
      );
  }
}

if (particleType) {
  const { w, players, fxCalls } = battle();
  const unit = w.spawn(particleType, players[0], 0, 0, 0),
    state = unit.abilities.find(s => s.def.ownerParticle && s.def.duration > 0);
  const why = w.useAbility(unit, state.def.kind, true);
  assert(!why || /black market/i.test(why), String(why));
  if (!why)
    assert(
      fxCalls.some(([name, args]) => name === 'abilityFx' && (args[0] === unit || (unit.isSquad && unit.fighters.includes(args[0]))) && args[2] === state.def.ownerParticle),
      'the ability shows its Particle_Effect on the owner'
    );
}

function near(a, b, why, eps = 1e-3) {
  assert(Math.abs(a - b) < eps, why + ': ' + a + ' vs ' + b);
}
console.log('space ability feedback: ok');
