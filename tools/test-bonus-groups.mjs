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
const { seedSim } = await import('../public/js/game/simrandom.js');
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const maps = [...archive.index.keys()].filter(name => /MAPS.*\.TED$/.test(name));
const map = await loadMap(maps.find(name => /_SPACE_PLANET_/.test(name) && /KUAT/.test(name)).split(String.fromCharCode(92)).pop());
{
  const names = new Set(),
    seen = new Set();
  for (const n of ['Rogue_Squadron_Space', 'Rebel_X-Wing_Squadron', 'TIE_Fighter_Squadron']) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });
S.resetEntityIds();
seedSim(5);
const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
w.modelOpts = { headless: true };
w.artReady = () => true;
w.onEvent = () => {};
w.fog = false;
const [rebel, empire] = ['Rebel', 'Empire'].map((f, i) => w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 0 })));
const look = u => JSON.stringify(u.bonus);

// Units of one type and owner that offer the same Combat_Bonus_Ability share one source.
const xwing = w.spawn(T('Rebel_X-Wing_Squadron'), rebel, 0, 0).fighters[0],
  tie = w.spawn(T('TIE_Fighter_Squadron'), empire, 3000, 0).fighters[0],
  plain = look(xwing),
  tiePlain = look(tie);
const a = w.spawn(T('Rogue_Squadron_Space'), rebel, 200, 0);
const boosted = look(xwing);
assert.notEqual(boosted, plain, 'Rogue Squadron gives allied fighters its bonus');
assert.equal(look(tie), tiePlain, 'not enemy fighters');
const sources = w.bonusHolders.length;
w.spawn(T('Rogue_Squadron_Space'), rebel, 400, 0);
assert.equal(look(xwing), boosted, 'a second Rogue Squadron gives the same bonus: the largest of a category counts');
assert.equal(w.bonusHolders.length, sources, 'both share one source per offering type');
for (const _ of [1, 2, 3, 4, 5, 6, 7, 8]) w.spawn(T('Rogue_Squadron_Space'), rebel, 600, 0);
assert.equal(w.bonusHolders.length, sources, 'ten Rogue Squadrons still share them');

// killing hosts: the bonus stays while any host lives
const all = w.squads.filter(q => q.type.name === 'Rogue_Squadron_Space');
const survivor = all[all.length - 1].fighters[0];
for (const q of all) for (const f of q.fighters) if (f !== survivor) w.kill(f, null);
w.tickBonuses();
assert.equal(look(xwing), boosted, 'one Rogue fighter left: the others keep the bonus');
assert.equal(look(survivor), tiePlain, 'and the last one no longer takes its own');
w.kill(survivor, null);
w.tickBonuses();
assert.equal(look(xwing), plain, 'the last Rogue gone: the bonus is taken back');
assert.equal(w.bonusHolders.length, 0, 'and the source goes with it');
console.log('bonus groups ok');
