import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const modPath = arg('--mod', null), wanted = arg('--campaign', null), steps = +arg('--steps', 150);
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), modPath ? [modPath] : []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) { const re = new RegExp(decodeURIComponent(path.slice(11)), 'i'); return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n)))); }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, ''))), bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
let seed = 12345; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const { loadGameData } = await import('../public/js/gamedata.js'); await loadGameData();
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy } = await import('../public/js/game/galaxy.js');
const { stepVisibility } = await import('../public/js/game/galacticfog.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const data = await loadCampaignData();
const name = wanted ? wanted.toUpperCase() : (data.campaigns.get('GCMENU_REBEL') ? 'GCMENU_REBEL' : 'SANDBOX_EQUAL_FOOTING_EMPIRE');
const campaign = data.campaigns.get(name); assert(campaign, 'no such campaign ' + name);

const makeGame = restore => {
  const galaxy = startingGalaxy(data, campaign);
  if (restore) applyGalaxy(galaxy, restore);
  stepVisibility(galaxy, galaxy.active);
  const game = { galaxy, me: galaxy.active, setup: restore ? { restore: true } : {}, scriptUI: { visibility() {}, enable() {}, text() {}, icon() {}, click() {} }, neutralizePopup: { open() {}, close() {} },
    onLoadCampaign() {}, showStoryDialog() {}, showScreenText() {}, audio: { speech: { replace() {}, stopActive() {} } }, movies: { play() {}, stop() {} } };
  return game;
};
const run = (host, n) => { for (let i = 0; i < n; i++) host.update(0.2); };

const gameA = makeGame(null);
const hostA = await GalacticStoryHost.create(gameA); assert(hostA);
run(hostA, steps);
console.log(name, 'instances', hostA.instances.map(i => i.name + ':' + i.state).join(' '));
assert.deepEqual(hostA.report().errors, {}, 'the story runs clean before the save');
assert.deepEqual(hostA.persist.changed(), [], 'no script has changed a permanent table of the machine');

gameA.galaxy.fleets.splice(1, 0, { owner: gameA.galaxy.active, planet: -1, units: [], path: [], dest: -1, leg: null, pos: null });
const t0 = performance.now();
const snapshot = JSON.parse(JSON.stringify(snapshotGalaxy(gameA.galaxy)));
console.log('save took', Math.round(performance.now() - t0), 'ms');
assert(snapshot.storyLua, 'the story was written: ' + (hostA.saveError || ''));
if (process.env.SIZES) { const by = {}; for (const n of snapshot.storyLua.lua.nodes) by[n.k] = (by[n.k] || 0) + JSON.stringify(n).length; console.log('SIZES by kind', by); const big = snapshot.storyLua.lua.nodes.map((n, i) => [JSON.stringify(n).length, i, n.k]).sort((a, b) => b[0] - a[0]).slice(0, 6); console.log('largest', big); }
console.log('story state', JSON.stringify(snapshot.storyLua).length, 'bytes,', snapshot.storyLua.lua.nodes.length, 'nodes');

const gameB = makeGame(snapshot);
const t1 = performance.now();
const hostB = await GalacticStoryHost.create(gameB); assert(hostB);
console.log('load took', Math.round(performance.now() - t1), 'ms');
assert.deepEqual(hostB.report().errors, {}, 'the load is clean');
assert(!hostB.suspended, 'the scripts run again');
assert.deepEqual(hostB.instances.map(i => i.name + ':' + i.state), hostA.instances.map(i => i.name + ':' + i.state));

let randomA = seed;
const state = h => JSON.stringify(h.persist ? (() => { const d = JSON.parse(JSON.stringify(h.game.galaxy.storyLuaSnapshot())); return { lua: d.lua, instances: d.instances.map(i => ({ ...i, env: undefined })), values: d.values, goals: d.goals, flags: d.flags, plots: d.plots }; })() : null);
seed = 777; run(hostA, 60); const stateA = state(hostA);
seed = 777; run(hostB, 60); const stateB = state(hostB);
assert.equal(hostB.serviceTime.toFixed(3), hostA.serviceTime.toFixed(3));
assert.deepEqual(hostB.report().errors, hostA.report().errors, 'the same errors, if any');
if (stateA !== stateB) {
  const a = JSON.parse(stateA), b = JSON.parse(stateB);
  for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('differs in', k, JSON.stringify(a[k]).length, JSON.stringify(b[k]).length);
}
assert.equal(stateB, stateA, 'after the same time the story is the same, Lua state and all');
{
  const again = JSON.parse(JSON.stringify(snapshotGalaxy(gameB.galaxy)));
  assert(again.storyLua, 'the loaded game can be saved again');
  const gameC = makeGame(again), hostC = await GalacticStoryHost.create(gameC);
  assert.deepEqual(hostC.report().errors, {});
  seed = 4242; run(hostB, 40); const sb = state(hostB);
  seed = 4242; run(hostC, 40); const sc = state(hostC);
  assert.equal(sc, sb, 'a game loaded from a loaded game goes on the same');
  hostC.dispose();
}
console.log('ok', name, steps, 'steps then 60 more on both sides');
