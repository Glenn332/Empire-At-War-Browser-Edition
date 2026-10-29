import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cinematicOffset, cinematicKeyPosition, TacticalCinematics } from '../public/js/game/tacticalcinematics.js';
import { openGame } from './megfs.mjs';
import { parseTacticalCameraData } from '../public/js/game/tacticalcameradata.js';
import { fileURLToPath } from 'node:url';
import { parseTED } from '../public/js/ted.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
let p = cinematicOffset(100, 30, 90, true);
near(p.x, Math.sqrt(7500));
near(p.y, 0);
near(p.z, 50);
assert.deepEqual(cinematicOffset(1, 2, 3, false), { x: 1, y: 2, z: 3 });
const obj = new THREE.Object3D();
obj.position.set(10, 20, 30);
obj.rotation.z = Math.PI / 2;
const entity = { x: 10, y: 20, z: 30, obj, type: { num: () => 6 } },
  key = { entity, position: { x: 0, y: 0, z: 0 }, offset: { x: 2, y: 3, z: 4 }, rotate: false, muzzle: false };
p = cinematicKeyPosition(key);
assert.deepEqual(p, { x: 12, y: 23, z: 40 });
key.rotate = true;
p = cinematicKeyPosition(key);
near(p.x, 7);
near(p.y, 22);
near(p.z, 40);
entity.dead = true;
obj.position.x = 50;
assert.deepEqual(cinematicKeyPosition(key), p);
const camera = new THREE.PerspectiveCamera(55, 1, 5, 40000);
camera.position.set(0, 0, 100);
const game = {
    landBattle: true,
    camera,
    view: { x: 0, y: 0 },
    tacticalCameraData: { near: 1, far: 60000, fadeBegin: 10000, fadeEnd: 11000 }
  },
  scripts = { at: o => o, of: o => o?.__entity || null };
const cine = new TacticalCinematics(game, scripts);
cine.start(false);
assert.equal(camera.near, 1);
assert.equal(camera.far, 10000, 'Native initial projection lease');
cine.key('position', [{ x: 0, y: 0, z: 0 }, 0, 0, 100, 0, null, 0, 0]);
cine.key('position', [{ x: 0, y: 0, z: 0 }, 2, 100, 0, 100, 0, null, 0, 0], true);
cine.update(0.5);
p = cine.evaluate('position');
near(p.x, 12.5);
near(p.z, 100);
cine.update(0);
near(cine.evaluate('position').x, 12.5);
cine.update(1.5);
near(cine.evaluate('position').x, 100);
cine.paint();
near(camera.position.x, 100);
assert.equal(camera.near, 1);
assert.equal(camera.far, 60000);
cine.stop();
near(camera.position.x, 0);
assert.equal(camera.near, 5);
assert.equal(camera.far, 40000);
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
game.tacticalCameraData = parseTacticalCameraData(archive.read(archive.resolve('Data/XML/TacticalCameras.xml')).toString());
cine.start(false);
cine.paint();
assert.equal(camera.far, 60000);
const starPoint = new THREE.Vector3(0, 0, -31729).project(camera);
assert(starPoint.z < 1, 'Native authored star radius fits Unlocked GPU projection');
camera.aspect = 2;
cine.stop();
assert.equal(camera.aspect, 2);
assert.equal(camera.far, 40000);
const spaceCamera = new THREE.PerspectiveCamera(55, 1, 4, 9000),
  override = () => {};
const space = {
  landBattle: false,
  renderer: { camera: spaceCamera, cameraOverride: override, rig: { x: 0, y: 0 } },
  tacticalCameraData: { near: 2, far: 90000 }
};
const spaceCine = new TacticalCinematics(space, scripts);
spaceCine.start(false);
space.renderer.cameraOverride();
assert.equal(spaceCamera.near, 2);
assert.equal(spaceCamera.far, 90000);
spaceCine.stop();
assert.equal(spaceCamera.far, 9000);
assert.equal(space.renderer.cameraOverride, override);
const bytes = archive.read(archive.resolve('Data/Art/Maps/EM02_An_Organized_Resistance.TED'));
const map = parseTED(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
assert.equal(map.environments[0].name, 'Afternoon_Sunset');
assert.equal(map.environment, map.environments[map.activeEnvironment]);
assert(!map.environments.some(e => e.name === 'Cinematic'), 'Original Thyferra has no cinematic environment override');
console.log(
  'PASS: native polar axes, attachment transforms, dead-source retention, simulation-timed eased keys, projection restoration and original TED environment names'
);

const { paintFog } = await import('../public/js/game/terrain.js'),
  terrain = { size: 5 };
paintFog(terrain, null, false);
assert(terrain.fog.image.data.every(value => value === 255));
assert(terrain.fogSeen.every(value => value === 0));
paintFog(terrain, null);
assert(terrain.fogSeen.every(value => value === 1));
