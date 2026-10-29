import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {openGame} from './megfs.mjs';

const install=fileURLToPath(new URL('../../Star Wars Empire at War',import.meta.url));
const base=openGame(install);
const read=archive=>new TextDecoder('windows-1252').decode(archive.read(archive.resolve('Data/XML/TacticalCameras.xml')));
let requests=0;
globalThis.fetch=async input=>{
  assert.equal(decodeURIComponent(String(input)),'asset/Data/XML/TacticalCameras.xml');
  requests++;
  return new Response(read(base));
};
const {TACTICAL_CAMERA_DEFAULTS,parseTacticalCameraData,loadTacticalCameraData}=await import('../public/js/game/tacticalcameradata.js');
assert.deepEqual(parseTacticalCameraData(null),{near:70,far:7000,fadeBegin:7000,fadeEnd:7000});
assert.deepEqual(parseTacticalCameraData('<TacticalCameras><TacticalCamera Name="Land_Mode"><Far_Clip>5</Far_Clip></TacticalCamera></TacticalCameras>'),TACTICAL_CAMERA_DEFAULTS);
assert.deepEqual(parseTacticalCameraData('<TacticalCameras><TacticalCamera Name="Unlocked"><Near_Clip>2</Near_Clip><Object_Fade_Begin>9000.0f</Object_Fade_Begin></TacticalCamera><TacticalCamera Name="Unlocked"><Far_Clip>41000</Far_Clip></TacticalCamera></TacticalCameras>'),{near:2,far:41000,fadeBegin:9000,fadeEnd:7000});
const expectedBase={near:1,far:60000,fadeBegin:10000,fadeEnd:11000};
assert.deepEqual(parseTacticalCameraData(read(base)),expectedBase);
const first=loadTacticalCameraData();
assert.equal(first,loadTacticalCameraData(),'Concurrent consumers share the original VFS request');
assert.deepEqual(await first,expectedBase);
assert.equal(await loadTacticalCameraData(),await first);
assert.equal(requests,1);
assert(Object.isFrozen(await first));
const modPath=process.env.SWR_TEST_MOD||process.argv[2]||'';
if(existsSync(modPath)){
  const mod=openGame(install,[modPath]);
  assert.deepEqual(parseTacticalCameraData(read(mod)),{near:1,far:6000000,fadeBegin:100000,fadeEnd:120000});
}else if(process.env.SWR_TEST_MOD||process.argv[2])throw Error(`Missing requested mod fixture: ${modPath}`);
console.log('PASS: native Unlocked lens defaults, original base/mod XML overrides, float suffixes, partial entries and cached VFS loading');
