// Steps the benchmark space battle (play.html?benchmark=N) without a page and reports what a step costs.
//   node tools/bench-space.mjs --mod <dir> --ships 400 --steps 900
//   node --cpu-prof tools/bench-space.mjs ...      a profile of the battle steps
// There are no job threads here, so the parts the battle thread hands to them run inline.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { openGame } from './megfs.mjs';

const arg = (key, fallback = null) => {
  const at = process.argv.indexOf(key);
  return at < 0 ? fallback : process.argv[at + 1];
};
const mod = arg('--mod', process.env.SWR_TEST_MOD || null),
  mapName = arg('--map', '_MP_SPACE_ATRAVIS_MADNESS.TED'),
  shipsPerSide = +arg('--ships', 400),
  steps = +arg('--steps', 900),
  warmUpSteps = +arg('--skip', 300),
  factions = arg('--factions', 'Empire,Rebel').split(',');

const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod ? [mod] : []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('file:')) {
    try {
      return new Response(readFileSync(fileURLToPath(path.split('?')[0])));
    } catch {
      return new Response(null, { status: 404 });
    }
  }
  if (path.startsWith('api/find?q=')) {
    const pattern = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(name => pattern.test(name))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
globalThis.onmessage = null;
globalThis.postMessage = () => {};

const THREE = await import('../public/vendor/three/build/three.module.js');
const { db, loadGameData, spawnList, skirmishStation } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const S = await import('../public/js/game/sim.js');
const { seedSim } = await import('../public/js/game/simrandom.js');
const { orderMove } = await import('../public/js/game/orders.js');
const { benchFleet } = await import('../public/js/game/benchfleet.js');
const { SpaceRecorder } = await import('../public/js/game/spacerecord.js');
const { stateHash } = await import('../public/js/game/netgame.js');
const { keeper, hookBattle } = await import('../public/js/game/spacebattlehooks.js');
const { loadPrioritySets } = await import('../public/js/game/priorities.js');
await loadPrioritySets().catch(() => null);

const TICK = 1 / 30;

const map = await loadMap(mapName, { teams: 2 });
if (!map) throw new Error('map not found: ' + mapName);
const sides = factions.map(faction => ({ faction, station: skirmishStation(faction), fleet: benchFleet(faction) }));
const modelNames = new Set(),
  seenTypes = new Set();
for (const side of sides) {
  if (!side.fleet.length) throw new Error('no benchmark fleet for ' + side.faction);
  for (const type of [side.station, ...side.fleet].filter(Boolean)) {
    S.modelsForType(type, null, modelNames, seenTypes);
    for (const entry of spawnList(type, 1)) S.modelsForType(entry.type, null, modelNames, seenTypes);
    for (const name of type.list('Squadron_Units')) if (db.type(name)) S.modelsForType(db.type(name), null, modelNames, seenTypes);
  }
}
await preloadModels([...modelNames].filter(Boolean));

S.resetEntityIds();
seedSim(4242);
// effects and sounds are noted for the page as on the battle thread, and dropped after every step
const events = [],
  spawns = [];
const world = new S.World({ scene: new THREE.Scene(), fx: keeper('fx', events), audio: keeper('audio', events), map });
world.modelOpts = { headless: true };
world.artReady = () => true;
hookBattle(world, events, spawns);
world.skirmish = false;
world.fog = false;
const columns = Math.ceil(Math.sqrt(shipsPerSide * 1.6)),
  spacing = 230;
const marginX = (world.max.x - world.min.x) * 0.025,
  marginY = (world.max.y - world.min.y) * 0.025;
const insideX = x => Math.max(world.min.x + marginX, Math.min(world.max.x - marginX, x)),
  insideY = y => Math.max(world.min.y + marginY, Math.min(world.max.y - marginY, y));
sides.forEach((side, index) => {
  const team = world.addTeam(new S.Team(index, side.faction)),
    player = world.addPlayer(new S.Player(index, team, { human: index === 0, credits: 6000, color: new THREE.Color(0xffffff) })),
    direction = index ? -1 : 1,
    spawned = [];
  player.popCap = 9999;
  for (let i = 0; i < shipsPerSide; i++) {
    const row = Math.floor(i / columns),
      column = i % columns;
    const entity = world.spawn(
      side.fleet[i % side.fleet.length],
      player,
      insideX(-direction * (1100 + row * spacing)),
      insideY((column - (columns - 1) / 2) * spacing),
      direction > 0 ? 0 : Math.PI
    );
    if (entity) spawned.push(entity);
  }
  for (const entity of spawned) orderMove([entity], direction > 0 ? world.max.x - marginX : world.min.x + marginX, entity.y, true);
});
world.viewer = world.players[0];
world.recountPop();
await world.paths.deterministic?.();

const recorder = new SpaceRecorder(world);
const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const stepMs = [],
  recordMs = [],
  parts = {};
// the battle's state every hundred steps, folded into one number: two runs that print the same played the same battle
let peakUnits = 0,
  peakShots = 0,
  waited = 0,
  played = 0,
  noted = 0;
for (let step = 0; step < steps; step++) {
  for (let spin = 0; !world.paths.ready(); spin++) {
    if (spin > 200000) throw new Error('route answers never arrived at step ' + step);
    waited++;
    await new Promise(resolve => setImmediate(resolve));
  }
  if (step % 100 === 0) played = (Math.imul(played, 31) + stateHash(world)) >>> 0;
  const from = performance.now();
  world.updateBegin(TICK);
  world.updateSome(Infinity);
  world.updateEnd();
  const stepped = performance.now();
  recorder.write();
  const recorded = performance.now();
  noted += events.length;
  events.length = 0;
  spawns.length = 0;
  if (step >= warmUpSteps) {
    stepMs.push(stepped - from);
    recordMs.push(recorded - stepped);
    for (const part in world.stepTimes) parts[part] = (parts[part] || 0) + world.stepTimes[part];
  }
  for (const part in world.stepTimes) world.stepTimes[part] = 0;
  peakUnits = Math.max(peakUnits, world.units.length);
  peakShots = Math.max(peakShots, world.projectiles.length);
  if (step % 30 === 0) await new Promise(resolve => setImmediate(resolve));
}
world.paths.stop?.();
const living = world.units.filter(unit => !unit.dead),
  armed = living.filter(unit => !unit.isFighter && unit.hasWeapons),
  enemiesKnown = Math.round(mean(armed.map(unit => unit.enemies.length))),
  measured = Math.max(1, stepMs.length);
console.log(
  `bench-space: ${mapName}, ${shipsPerSide} a side (${factions.join(' v ')}), steps ${warmUpSteps}-${steps}: ` +
    `${living.length} units alive (${living.filter(unit => unit.isFighter).length} fighters, a ship knows of ${enemiesKnown} enemies), peak ${peakUnits} units and ${peakShots} shots`
);
console.log(
  `  step ${mean(stepMs).toFixed(2)} ms, record ${mean(recordMs).toFixed(2)} ms, ${Math.round(noted / steps)} effects and sounds a step, waited on routes ${waited} times, battle ${played.toString(16)}`
);
console.log(
  '  ' +
    Object.entries(parts)
      .map(([part, total]) => `${part} ${(total / measured).toFixed(2)}`)
      .join(', ')
);
process.exit(0);
