import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const modPath = arg('--mod', null),
  wanted = arg('--campaign', null),
  steps = +arg('--steps', 150);
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), modPath ? [modPath] : []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, ''))),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
let seed = 12345;
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy } = await import('../public/js/game/galaxy.js');
const { stepVisibility } = await import('../public/js/game/galacticfog.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const data = await loadCampaignData();
const name = wanted ? wanted.toUpperCase() : data.campaigns.get('GCMENU_REBEL') ? 'GCMENU_REBEL' : 'SANDBOX_EQUAL_FOOTING_EMPIRE';
const campaign = data.campaigns.get(name);
assert(campaign, 'no such campaign ' + name);

const makeGame = restore => {
  const galaxy = startingGalaxy(data, campaign);
  if (restore) applyGalaxy(galaxy, restore);
  stepVisibility(galaxy, galaxy.active);
  const game = {
    galaxy,
    me: galaxy.active,
    setup: restore ? { restore: true } : {},
    scriptUI: { visibility() {}, enable() {}, text() {}, icon() {}, click() {} },
    neutralizePopup: { open() {}, close() {} },
    onLoadCampaign() {},
    showStoryDialog() {},
    showScreenText() {},
    audio: { speech: { replace() {}, stopActive() {} } },
    movies: { play() {}, stop() {} }
  };
  return game;
};
const run = (host, n) => {
  for (let i = 0; i < n; i++) host.update(0.2);
};

const state = h =>
  JSON.stringify(
    (() => {
      const d = JSON.parse(JSON.stringify(h.game.galaxy.storyLuaSnapshot()));
      return {
        lua: d.lua,
        instances: d.instances.map(i => ({ ...i, env: undefined })),
        values: d.values,
        goals: d.goals,
        flags: d.flags,
        plots: d.plots
      };
    })()
  );
let game = makeGame(null),
  host = await GalacticStoryHost.create(game);
for (let round = 0; round < 6; round++) {
  run(host, 250);
  const snap = JSON.parse(JSON.stringify(snapshotGalaxy(game.galaxy)));
  const gameB = makeGame(snap),
    hostB = await GalacticStoryHost.create(gameB);
  assert.deepEqual(hostB.report().errors, {}, 'round ' + round);
  seed = 99 + round;
  run(host, 80);
  const a = state(host);
  seed = 99 + round;
  run(hostB, 80);
  const b = state(hostB);
  assert.equal(b, a, 'round ' + round + ': same after the load');
  console.log('round', round, 'ok', a.length, 'bytes of state');
  host.dispose();
  game = gameB;
  host = hostB;
}
console.log('stress ok');
