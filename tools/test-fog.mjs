import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod >= 0 ? [process.argv[mod + 1]] : []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = decodeURIComponent(path.replace(/^asset\//, ''))
      .replaceAll('/', String.fromCharCode(92))
      .toUpperCase(),
    data = archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { startingGalaxy, loadCampaignData, snapshotGalaxy, applyGalaxy } = await import('../public/js/game/galaxy.js');
const data = await loadCampaignData();
const campaign = data.campaigns.get(mod < 0 ? 'SANDBOX_EQUAL_FOOTING_REBEL' : 'FULLLARGE_ERA_3_EMPIRE');
assert(campaign);
const G = () => startingGalaxy(data, campaign);
const { stepVisibility, intelligence, VIS, displayIncome } = await import('../public/js/game/galacticfog.js');
const g = G(),
  viewer = g.active;
stepVisibility(g, viewer);
const realUnknown = g.planets.filter(p => !p.background && !intelligence(g, p).discovered);
assert(realUnknown.length > 0, 'Campaign starts with unknown planets');
const p = realUnknown.find(p => p.type.str('Galactic_Model_Name'));
assert(p, 'Unknown planet uses a data-defined model');
const enemy = g.players.find(p => p.faction !== viewer).faction;
g.autoReveal = false;
g.fleets = [];
for (const q of g.planets) {
  q.owner = enemy;
  q.station = null;
  q.groundStructures = [];
  q.orbitalStructures = [];
  q.garrison = [];
}
g.visibility = null;
stepVisibility(g, viewer);
assert.equal(intelligence(g, p).discovered, false);
const type = [...db.types.values()].find(t => t.num('Tactical_Health') > 0 && !t.bool('Is_Stealth_Company') && !t.sub('Abilities').length);
assert(type, 'Ordinary visit fixture has a non-stealth unit');
g.fleets.push({ owner: viewer, planet: p.index, units: [{ type }], path: [], dest: -1, leg: null, pos: p.pos.slice() });
const delay = Math.floor(30 * db.constants.num('Planet_Reveal_Delay_Time', 0.5)) + 1;
stepVisibility(g, viewer, delay);
assert.equal(intelligence(g, p).discovered, false, 'Strict reveal delay');
const partial = snapshotGalaxy(g),
  restored = G();
applyGalaxy(restored, partial);
assert.equal(intelligence(restored, restored.planets[p.index]).revealFrames, delay, 'Partial visit survives snapshot');
stepVisibility(g, viewer, 1);
assert.equal(intelligence(g, p).discovered, true, 'Visit reveals after strict delay');
g.fleets = [];
stepVisibility(g, viewer, 30);
assert.equal(intelligence(g, p).discovered, true, 'Departure retains discovery');
assert.equal(intelligence(g, p).fleetOverlay, false, 'Discovery alone does not reveal enemy portraits');
assert.equal(intelligence(g, p).groundContents, false, 'Discovery alone does not reveal defenders');
assert.equal(displayIncome(g, p), p.type.num('Planet_Credit_Value', 0), 'Hidden income uses public base');
p.visibilityModifiers = [{ owner: viewer, mask: VIS.FLEET_PRESENCE }];
stepVisibility(g, viewer);
assert.equal(intelligence(g, p).fleetOverlay, false, 'Presence alone does not admit portraits');
p.visibilityModifiers[0].mask = VIS.FLEET_COUNT;
stepVisibility(g, viewer);
assert.equal(intelligence(g, p).fleetOverlay, true, 'Count admits portraits');
p.visibilityModifiers = [];
g.displayFilters = 11;
const saved = snapshotGalaxy(g),
  returned = G();
applyGalaxy(returned, saved);
stepVisibility(returned, viewer);
assert.equal(intelligence(returned, returned.planets[p.index]).discovered, true, 'Discovery survives battle snapshot');
assert.equal(returned.displayFilters, 11, 'Overlay filters survive battle snapshot');
assert.equal(intelligence(returned, returned.planets[p.index]).fleetOverlay, false, 'Expired intelligence stays hidden after return');
console.log(
  JSON.stringify({
    campaign: campaign.name,
    planets: g.planets.length,
    initialUnknown: realUnknown.length,
    fixturePlanet: p.name,
    result: 'fog fixtures passed; no story or browser simulation'
  })
);
