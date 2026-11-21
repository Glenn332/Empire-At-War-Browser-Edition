import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const modPath = process.env.SWR_TEST_MOD;
const archive = openGame(gameDir, modPath ? [modPath] : []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const pattern = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(name => pattern.test(name))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { Pathfinder, layerMask } = await import('../public/js/game/pathfind.js');
const { PathCore, searchBudget } = await import('../public/js/game/pathcore.js');

const LOGIC_FPS = 30,
  DEG = Math.PI / 180,
  speedFactor = db.constants.num('Object_Max_Speed_Multiplier_Space', 1);
const capitalTypes = [...db.types.values()].filter(
  type =>
    type.tag === 'SpaceUnit' &&
    type.behaviors().has('ASTEROID_FIELD_DAMAGE') &&
    (layerMask(type) & 4) === layerMask(type) &&
    type.num('Max_Speed', 0) > 0
);
assert(capitalTypes.length, 'a capital ship that takes asteroid damage');
const playable = capitalTypes.filter(type => !/template|generic/i.test(type.name));
const shipType = playable.find(type => /star_destroyer/i.test(type.name)) || playable[0] || capitalTypes[0];
const hullLength = Math.max(300, shipType.num('Custom_Hard_XExtent', 0) * (shipType.num('Scale_Factor', 1) || 1)),
  hullWidth = Math.max(120, shipType.num('Custom_Hard_YExtent', 0) * (shipType.num('Scale_Factor', 1) || 1));
const makeShip = (x, y, heading) => ({
  id: 5,
  x,
  y,
  heading,
  speed: 0,
  maxSpeed: shipType.num('Max_Speed', 0) * LOGIC_FPS * speedFactor,
  turnRate: shipType.num('Max_Rate_Of_Turn', 1) * LOGIC_FPS * DEG * speedFactor,
  accel: shipType.num('OverrideAcceleration', 0) * LOGIC_FPS * LOGIC_FPS * speedFactor || 20,
  radius: hullLength,
  layer: layerMask(shipType),
  pathExt: { ax: hullLength, sd: hullWidth, r: Math.max(hullLength, hullWidth) },
  asteroidDamage: true,
  shielded: false
});

const { loadMap } = await import('../public/js/ted.js');
const BACKSLASH = String.fromCharCode(92);
const spaceMaps = [...archive.index.keys()]
  .filter(name => name.includes(BACKSLASH + 'MAPS' + BACKSLASH) && /SPACE[^\\]*\.TED$/.test(name))
  .map(name => name.split(BACKSLASH).pop());
const fieldsOf = map => {
  const found = [];
  for (const placed of map.objects) {
    const type = placed.type;
    if (!type || !type.bool('Is_Asteroid_Field')) continue;
    const radius = type.num('Space_Obstacle_Radius', 0) * type.num('Scale_Factor', 1) * (placed.scale || 1);
    if (radius > 0) found.push({ x: placed.pos[0], y: placed.pos[1], r: radius, asteroid: true, ion: false });
  }
  return found;
};
const loaded = [];
for (const name of spaceMaps) {
  let map = null;
  try {
    map = await loadMap(name);
  } catch {
    continue;
  }
  if (!map?.objects || !map.playMin) continue;
  loaded.push({ name, map, fields: fieldsOf(map) });
}
loaded.sort((a, b) => b.fields.length - a.fields.length);
const busiest = loaded.slice(0, Number(process.env.SWR_ASTEROID_MAPS || 10)).filter(entry => entry.fields.length);
assert(busiest.length, 'a space map with asteroid fields');
const world = {
  time: 0,
  min: { x: 0, y: 0 },
  max: { x: 0, y: 0 },
  fields: [],
  hazardous: (field, unit) => (field.asteroid && unit.asteroidDamage) || (field.ion && unit.shielded)
};
const constants = new Pathfinder({ ...world }).K;
const wasmBytes = readFileSync(new URL('../public/js/game/pathsearch.wasm', import.meta.url));
const env = { now: () => performance.now(), cos: Math.cos, sin: Math.sin, atan2: Math.atan2, acos: Math.acos };
const instance = (await WebAssembly.instantiate(wasmBytes, { env })).instance;
const core = withWasm => {
  const pathCore = new PathCore(world, constants, 50);
  if (withWasm) pathCore.wasm = { ex: instance.exports, mem: instance.exports.memory };
  return pathCore;
};
const budget = searchBudget(constants);
let everyTry = 0;
for (let k = 0, tryStates = constants.maxExp; k < constants.tries; k++, tryStates = k >= 2 ? Math.floor(tryStates * constants.expGrow) : tryStates) everyTry += tryStates + 1;
assert.equal(budget, everyTry, 'the budget is every try of the engine schedule');

const outsideFields = (fields, x, y, pad) => fields.every(field => (field.x - x) ** 2 + (field.y - y) ** 2 > (field.r + pad) ** 2);
const casesFor = entry => {
  const { map, fields } = entry,
    minX = map.playMin[0],
    minY = map.playMin[1],
    maxX = map.playMax[0],
    maxY = map.playMax[1],
    pad = hullLength * 1.5,
    found = [];
  const spot = (fx, fy) => {
    for (let ring = 0; ring < 12; ring++)
      for (let k = 0; k < 8; k++) {
        const x = minX + (maxX - minX) * fx + Math.cos(k * 0.785) * ring * 250,
          y = minY + (maxY - minY) * fy + Math.sin(k * 0.785) * ring * 250;
        if (x > minX + pad && x < maxX - pad && y > minY + pad && y < maxY - pad && outsideFields(fields, x, y, pad)) return [x, y];
      }
    return null;
  };
  for (const [fx, fy, tx, ty] of [
    [0.1, 0.5, 0.9, 0.5],
    [0.5, 0.1, 0.5, 0.9],
    [0.1, 0.1, 0.9, 0.9],
    [0.9, 0.1, 0.1, 0.9],
    [0.3, 0.3, 0.7, 0.7],
    [0.2, 0.8, 0.8, 0.2]
  ]) {
    const from = spot(fx, fy),
      to = spot(tx, ty);
    if (from && to) found.push([from[0], from[1], Math.atan2(to[1] - from[1], to[0] - from[0]), to[0], to[1]]);
  }
  return found;
};
const useMap = entry => {
  world.min = { x: entry.map.playMin[0], y: entry.map.playMin[1] };
  world.max = { x: entry.map.playMax[0], y: entry.map.playMax[1] };
  world.fields = entry.fields;
};
const OLD_STATES = 20000;
const cost = () => ({ ms: 0, worstMs: 0 });
const add = (entry, ms) => {
  entry.ms += ms;
  entry.worstMs = Math.max(entry.worstMs, ms);
};
const timed = (pathCore, ship, gx, gy) => {
  const started = performance.now(),
    route = pathCore.find(ship, gx, gy);
  return { route, ms: performance.now() - started, states: pathCore.statesUsed };
};
const tally = { old: 0, now: 0, routeThread: 0, total: 0, states: 0, worstStates: 0, wasm: cost(), js: cost(), routeThreadWasm: cost(), batches: 0, deferred: 0, worstBatchMs: 0, worstBatchStates: 0 };
const perMap = [];
for (const entry of busiest) {
  useMap(entry);
  const wasmCore = core(true),
    jsCore = core(false),
    oldCore = core(true),
    routeThreadCore = core(true);
  wasmCore.expBudget = jsCore.expBudget = budget;
  oldCore.expBudget = OLD_STATES;
  const cases = casesFor(entry);
  let found = 0,
    batchLeft = budget,
    batchMs = 0,
    batchStates = 0;
  for (const [x, y, heading, gx, gy] of cases) {
    tally.total++;
    const oldRoute = oldCore.find(makeShip(x, y, heading), gx, gy);
    if (!oldRoute || oldRoute.length) tally.old++;
    const lockstep = timed(wasmCore, makeShip(x, y, heading), gx, gy),
      route = lockstep.route;
    add(tally.wasm, lockstep.ms);
    tally.states += lockstep.states;
    tally.worstStates = Math.max(tally.worstStates, lockstep.states);
    if (batchLeft > 0) {
      batchLeft -= lockstep.states;
      batchMs += lockstep.ms;
      batchStates += lockstep.states;
    } else tally.deferred++;
    const jsSearch = timed(jsCore, makeShip(x, y, heading), gx, gy);
    add(tally.js, jsSearch.ms);
    assert.deepEqual(route, jsSearch.route, 'the WebAssembly search is the JS one');
    if (!route || route.length) {
      tally.now++;
      found++;
    }
    const thread = timed(routeThreadCore, makeShip(x, y, heading), gx, gy);
    add(tally.routeThreadWasm, thread.ms);
    assert.deepEqual(thread.route, route, 'the single player route thread finds what lockstep finds');
    if (!thread.route || thread.route.length) tally.routeThread++;
    if (route && route.length) {
      const end = route[route.length - 1];
      assert(Math.hypot(end.x - gx, end.y - gy) < 600, 'a route ends at the goal: ' + [end.x, end.y, gx, gy]);
    }
  }
  tally.batches++;
  tally.worstBatchMs = Math.max(tally.worstBatchMs, batchMs);
  tally.worstBatchStates = Math.max(tally.worstBatchStates, batchStates);
  perMap.push(entry.name + ' ' + found + '/' + cases.length);
}
const ms = (entry, count) => (entry.ms / count).toFixed(1) + ' ms mean, ' + entry.worstMs.toFixed(1) + ' worst';
console.log(shipType.name + ', ' + budget + ' states per search (every try), maps: ' + busiest.map(entry => entry.name + ' (' + entry.fields.length + ' fields)').join(', '));
console.log('routes found: ' + tally.now + ' / ' + tally.total + ' (with ' + OLD_STATES + ' states: ' + tally.old + ', single player route thread: ' + tally.routeThread + ')');
console.log('per map: ' + perMap.join(', '));
console.log('states per search: ' + Math.round(tally.states / tally.total) + ' mean, ' + tally.worstStates + ' worst');
console.log('lockstep search: wasm ' + ms(tally.wasm, tally.total) + '; js ' + ms(tally.js, tally.total));
console.log('single player route thread: wasm ' + ms(tally.routeThreadWasm, tally.total));
console.log('lockstep batch of a map: ' + tally.worstBatchMs.toFixed(1) + ' ms worst, ' + tally.worstBatchStates + ' states, ' + tally.deferred + ' searches deferred to the next batch');
assert(tally.now >= tally.old, 'no route lost to the bigger budget');
console.log('space asteroid route ok');
