import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { 'thrawns-revenge': { type: 'string' } } });
assert(process.env.SWR_GAME, 'Set SWR_GAME to your Gold Pack installation directory');
const conversion = values['thrawns-revenge'];
const layers = [...(conversion ? [conversion] : []), fileURLToPath(new URL('./fixtures/submod-build-clock', import.meta.url))];
const load = name => import(pathToFileURL(path.resolve(name)).href);
const { openGame } = await load('tools/megfs.mjs');
const archive = openGame(process.env.SWR_GAME, layers, { expansion: true });
try {
  globalThis.fetch = async input => {
    const url = new URL(input, 'http://fixture/');
    if (url.pathname === '/api/find') {
      const pattern = new RegExp(url.searchParams.get('q'), 'i');
      return Response.json([...archive.index.keys()].filter(key => pattern.test(key)));
    }
    const key = url.pathname.startsWith('/asset/') && archive.resolve(decodeURIComponent(url.pathname.slice(7)));
    return new Response(key ? archive.read(key) : null, { status: key ? 200 : 404 });
  };
  const { db, loadGameData } = await load('public/js/gamedata.js');
  const { startingGalaxy, loadCampaignData, snapshotGalaxy, applyGalaxy } = await load('public/js/game/galaxy.js');
  const { difficultyAdjustment } = await load('public/js/game/landbrain.js');
  const { queueAIProduction, stepProduction } = await load('public/js/game/galacticproduction.js');
  const { seedSim } = await load('public/js/game/simrandom.js');
  seedSim(7001);
  await loadGameData();
  const data = await loadCampaignData();
  const campaign = data.campaigns.get(conversion ? 'KNOWNSMALL_ERA_1_EMPIRE' : 'SANDBOX_EQUAL_FOOTING_EMPIRE');
  assert(campaign, 'pinned FoC campaign is present');
  const galaxy = startingGalaxy(data, campaign);
  const planet = galaxy.planets.find(entry => entry.name === (conversion ? 'Bakura' : 'AlzocIII'));
  const type = db.type(conversion ? 'Naval_Academy' : 'Underworld_Merc_Squad');
  assert(planet && type, 'pinned production site and unit are present');
  assert.equal(planet.owner, conversion ? 'Warlords' : 'Underworld');
  const adjustment = await difficultyAdjustment(planet.owner, 'easy');
  assert.deepEqual(adjustment?.build, { land: 1, space: 1, galactic: 2 }, 'the submod overrides the actual AI difficulty profile');
  const job = queueAIProduction(galaxy, planet.index, planet.owner, type, adjustment);
  assert(job, 'the AI order is accepted');
  const fundedOrder = { pay: order => order.type.name === type.name, complete() {}, failed() {} };
  const deadline = conversion ? 40 : 8;
  stepProduction(galaxy, deadline / 2, fundedOrder);
  const saved = JSON.parse(JSON.stringify(snapshotGalaxy(galaxy)));
  const restored = startingGalaxy(data, campaign);
  applyGalaxy(restored, saved);
  const queue = restored.planets[planet.index].production.ground;
  assert.equal(queue[0]?.type.name, type.name, 'the same order resumes');
  assert.equal(queue[0].left, job.left, 'the production clock survives a snapshot round trip');
  const afterResume = queue[0].left;
  const advance = seconds =>
    stepProduction(restored, seconds, fundedOrder).some(record => record.type.name === type.name && record.planet === planet.index);
  const completed = advance(deadline / 2);
  const remaining = queue[0]?.left ?? 0;
  if (!completed && remaining > 0) assert(advance(remaining), 'the late order eventually completes');
  const trace = { duration: job.total, afterResume, completed, remaining };
  console.log(`${campaign.name} / ${planet.name} / ${type.name}: ${JSON.stringify(trace)}`);
  assert.deepEqual(trace, { duration: deadline, afterResume: deadline / 2, completed: true, remaining: 0 }, 'pinned upstream gameplay');
  console.log('PASS: modded AI build and snapshot/resume match upstream 8fc96be');
} finally {
  archive.close();
}
