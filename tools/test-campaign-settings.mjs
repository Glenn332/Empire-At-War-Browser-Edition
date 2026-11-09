import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
globalThis.fetch = async input => {
  const key = archive.resolve(decodeURIComponent(String(input).replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData } = await import('../public/js/game/galaxy.js');
const S = await import('../public/js/game/campaignsettings.js');
const data = await loadCampaignData();
const camp = [...data.campaigns.values()].find(c => c.str('Starting_Active_Player').toUpperCase() === 'REBEL' && c.tuples('Starting_Credits').length);
assert.ok(camp, 'a Rebel campaign with starting credits');
const limits = S.campaignLimits(camp);
assert.deepEqual([limits.custom, limits.minTech, limits.maxTech, limits.minCredits, limits.maxCredits], [true, 1, 5, 0, 10000], 'engine defaults');
const d = S.campaignDefaults(camp, 'Rebel');
assert.equal(d.custom, false);
assert.equal(d.autoResolve, 2, 'ask by default');
assert.equal(S.techAdjust('Rebel'), db.faction('Rebel').num('Displayed_Tech_Level_Adjustment', 0));
const r = S.techRange(limits, 'Rebel');
assert.equal(r.lo, 1 - r.adj);
assert.equal(r.hi, 5 - r.adj);
assert.equal(S.creditSteps(limits), 11, 'one slider stop per thousand');
assert.equal(S.creditsAt(limits, 0), 0);
assert.equal(S.creditsAt(limits, 0.31), 4000, 'rounded up to the next thousand');
assert.equal(S.creditsAt(limits, 1), 10000);

const g = { players: [{ faction: 'Rebel' }, { faction: 'Empire' }, { faction: 'Underworld' }] };
S.applyCampaignSettings(g, { ...d }, 'Rebel');
assert.equal(g.players[0].credits, undefined, 'untouched settings leave each faction its own values');
S.applyCampaignSettings(g, { custom: true, credits: 7000, tech: 1, maxTech: 3, autoResolve: 0 }, 'Rebel');
const adj = f => S.techAdjust(f);
for (const p of g.players) {
  assert.equal(p.credits, 7000, 'every player gets the slider credits');
  assert.equal(p.tech, 1 + adj('Rebel') + (adj(p.faction) ? -1 : 0));
  assert.equal(p.maxTech, 3 + adj('Rebel') + (adj(p.faction) ? -1 : 0));
}
assert.equal(g.campaignAutoResolve, 0);
console.log('ok', camp.name, 'adj', r.adj);
