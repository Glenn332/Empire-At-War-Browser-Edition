// The main menu battle and cinematic mode shot camera draws through the clip planes of the Unlocked TacticalCamera
// (TacticalCameras.xml), as the scripted cinematic camera does, not a fixed far plane of 10000. With the large ships
// of Thrawn's Revenge a frigate push-in starts up to ten ship lengths behind its subject and pans to a target ahead
// of it: past 10000 the frustum test of the instanced ship draw dropped whole ships out of the picture mid-pan.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { openGame } from './megfs.mjs';

const { db } = await import('../public/js/gamedata.js');
db.constants ||= { num: (_k, d) => d, list: () => [], bool: (_k, d) => d, str: () => '' };
const { Cinematic, cinematicLens } = await import('../public/js/game/cinematic.js');
const { cinematicShot } = await import('../public/js/game/spacecinematic.js');
const { TACTICAL_CAMERA_DEFAULTS, parseTacticalCameraData } = await import('../public/js/game/tacticalcameradata.js');
// Cinematic.start marks the page; nothing else of the DOM is used here
globalThis.document ||= {
  body: { classList: { add() {}, remove() {}, contains: () => false, toggle() {} } },
  documentElement: { style: { setProperty() {} } }
};

const install = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
const read = archive => new TextDecoder('windows-1252').decode(archive.read(archive.resolve('Data/XML/TacticalCameras.xml')));
const vanillaLens = parseTacticalCameraData(read(openGame(install)));
assert.deepEqual(vanillaLens, { near: 1, far: 60000, fadeBegin: 10000, fadeEnd: 11000 });
const trPath = process.env.SWR_TEST_MOD || 'E:/SteamLibrary/steamapps/workshop/content/32470/1125571106';
const trLens = existsSync(trPath) ? parseTacticalCameraData(read(openGame(install, [trPath]))) : null;
if (trLens) assert.deepEqual(trLens, { near: 1, far: 6000000, fadeBegin: 100000, fadeEnd: 120000 });

// A Thrawn's Revenge sized frigate (half extents) heading +x with its target 6000 ahead.
const type = name => ({
  name,
  _cinematicExtents: [220, 900, 160],
  categories: () => new Set(['FRIGATE']),
  num: (_k, d) => d,
  str: () => '',
  bool: (_k, d) => d
});
const target = { id: 2, x: 6000, y: 0, z: 0, heading: Math.PI, type: type('TARGET'), hardpoints: [], visualRadius: 120, isMobile: true };
const subject = { id: 1, x: 0, y: 0, z: 0, heading: 0, type: type('SUBJECT'), hardpoints: [], visualRadius: 120, isMobile: true, target };
target.target = subject;

function battle(lens) {
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 20, 90000);
  const game = {
    renderer: { camera, rig: { x: 0, y: 0, clamp() {} } },
    ui: { select() {}, arm() {} },
    human: { bit: 1, station: null },
    world: { fog: false, units: [subject, target] },
    tacticalCameraData: lens
  };
  return { game, camera };
}

// Whether the ship draw keeps a unit: the same sphere test as Instances.collect.
const frustum = new THREE.Frustum(),
  pm = new THREE.Matrix4(),
  sphere = new THREE.Sphere();
function drawn(camera, u) {
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  sphere.center.set(u.x, u.y, u.z || 0);
  sphere.radius = u.visualRadius * 2.5;
  return frustum.intersectsSphere(sphere);
}

function runShot(lens) {
  const { game, camera } = battle(lens);
  const cine = new Cinematic(game);
  const random = Math.random;
  Math.random = () => 0.999; // the farthest push-in start the engine rolls: ten lengths back, seven up
  let shot;
  try {
    shot = cinematicShot(game, subject);
  } finally {
    Math.random = random;
  }
  assert.ok(shot.duration > 0 && shot.lag === 0.9, 'the frigate push-in that pans to its target');
  cine.start({ letterbox: false });
  cine.shot = Object.assign(shot, { t: 0, fresh: true });
  const out = [];
  for (let t = 0; t < shot.duration - 0.05; t += 1 / 30) {
    cine.frame(1 / 30);
    out.push({
      t: shot.t,
      far: camera.far,
      near: camera.near,
      subject: drawn(camera, subject),
      target: drawn(camera, target),
      toTarget: camera.position.distanceTo(new THREE.Vector3(target.x, target.y, 0))
    });
  }
  cine.stop();
  return { out, camera };
}

// the scenario is real: the pan starts more than 10000 from the target
{
  const { out } = runShot(vanillaLens);
  assert.ok(out[0].toTarget > 10000, `push-in starts ${out[0].toTarget.toFixed(0)} from its target`);
}

// with the Unlocked lens every frame of the pan draws both ships; a 10000 far plane would have culled the target
for (const lens of [vanillaLens, trLens].filter(Boolean)) {
  const { out, camera } = runShot(lens);
  for (const f of out) {
    assert.equal(f.near, lens.near);
    assert.equal(f.far, lens.far);
  }
  const late = out.filter(f => f.t >= out[out.length - 1].t * 0.75);
  assert.ok(
    late.every(f => f.target),
    'the target the camera pans to stays drawn'
  );
  assert.ok(
    out.some(f => f.toTarget > 10000 && f.target),
    'a target beyond 10000 is still drawn'
  );
  assert.equal(camera.far, 90000, 'the battle camera far plane comes back when the shots stop');
  assert.equal(camera.near, 20);
}
{
  // what a fixed 10000 far plane did to the same shot
  const { out } = runShot({ ...vanillaLens, far: 10000 });
  assert.ok(
    out.some(f => f.toTarget > 10000 && !f.target),
    'a 10000 far plane drops the target ship mid-shot'
  );
}

// no lens loaded: the engine's own Unlocked defaults
assert.equal(cinematicLens({}), TACTICAL_CAMERA_DEFAULTS);
assert.equal(cinematicLens({ tacticalCameraData: trLens || vanillaLens }), trLens || vanillaLens);

// the space battle (menu backdrop included) loads the lens before the shot camera can start
{
  const main = readFileSync(fileURLToPath(new URL('../public/js/main.js', import.meta.url)), 'utf8');
  const load = main.indexOf('this.tacticalCameraData ||= await loadTacticalCameraData()'),
    make = main.indexOf('this.cine = new Cinematic(this)');
  assert.ok(load > 0 && make > load, 'main.js loads the Unlocked lens before it makes the shot camera');
}

console.log(
  `PASS: menu shot camera uses the Unlocked lens (vanilla 1-60000${trLens ? ", Thrawn's Revenge 1-6000000" : ''}), keeps far ships drawn through a push-in pan and restores the battle lens`
);
