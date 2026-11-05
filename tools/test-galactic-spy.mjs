import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { startingGalaxy, loadCampaignData } = await import('../public/js/game/galaxy.js');
const { stepVisibility, intelligence, VIS } = await import('../public/js/game/galacticfog.js');
const { spyMask, canSpy, activateSpy, spyDuration } = await import('../public/js/game/galacticspy.js');
const { groundActivated } = await import('../public/js/game/planetdestruction.js');
const key = s => String(s || '').toUpperCase();
const holder = [...db.types.values()].find(t =>
  t
    .sub('Abilities')
    .flatMap(n => n.children)
    .some(a => key(a.tag) === 'SYSTEM_SPY_ABILITY' && key(a.val('Activation_Style')) === 'GROUND_ACTIVATED')
);
if (!holder) {
  console.log('no ground activated spy in this data: skipped');
  process.exit(0);
}
const ability = holder
  .sub('Abilities')
  .flatMap(n => n.children)
  .find(a => key(a.tag) === 'SYSTEM_SPY_ABILITY');
const yes = tag => /^(yes|true|1)$/i.test(ability.val(tag).trim());
const mask = spyMask(ability);
if (yes('See_Base_Levels')) assert.equal(mask & 6, 6);
if (yes('See_Fleet_Contents')) assert.equal(mask & 0x70, 0x70, 'fleet contents bring the fleet count');
if (yes('See_Ground_Company_Contents')) assert.equal(mask & 0x180, 0x180, 'company contents bring the company count');
if (!yes('See_Credit_Income')) assert.equal(mask & 8, 0);

const data = await loadCampaignData();
const campaign = [...data.campaigns.values()].find(c => c.name && startingGalaxy(data, c).planets.length > 2);
const g = startingGalaxy(data, campaign),
  [me, them] = g.players.map(p => p.faction);
g.autoReveal = false;
g.fleets = [];
for (const q of g.planets) {
  q.owner = them;
  q.station = null;
  q.groundStructures = [];
  q.orbitalStructures = [];
  q.garrison = [];
}
const target = g.planets.find(p => !p.background);
const company = [...db.types.values()].find(t => t.list('Company_Units').some(n => key(n) === key(holder.name))) || holder;
const record = { type: company, owner: me };
const fleet = { owner: me, planet: target.index, units: [record], path: [], dest: -1, leg: null, pos: target.pos.slice() };
g.fleets.push(fleet);
const despawned = [],
  signals = [];
const game = { galaxy: g, me, audio: { play() {} }, story: { despawn: a => despawned.push(a), signal: (t, v) => signals.push([t, v]) } };
const actor = { owner: me, record, type: company, planet: target, dead: false };
assert.equal(canSpy(game, actor, target), true, 'an enemy planet can be spied on');
assert.equal(canSpy(game, actor, { ...target, owner: me }), false, 'not your own planet');
g.time = 100;
g.visibility = null;
stepVisibility(g, me);
const before = intelligence(g, target).mask;
assert.equal(groundActivated(game, actor), true, 'the ground activated spy fires');
g.fleets = [];
stepVisibility(g, me);
assert.equal(intelligence(g, target).mask & mask, mask, 'the planet shows what the spy sees');
assert(intelligence(g, target).mask !== before);
assert.deepEqual(
  signals,
  [
    ['STORY_LAND_ON', target.type.name],
    ['STORY_DEPLOY', company.name]
  ],
  'the story hears the landing and the hero deployed'
);
if (yes('Causes_Despawn')) {
  assert.equal(despawned.length, 1, 'the spy leaves the map');
  assert.equal(
    target.killedHeroes?.length ?? 0,
    db.constants.num('Default_Hero_Respawn_Time', -1) >= 0 ? 1 : 0,
    'and is queued to come back when the data gives a respawn time'
  );
}
g.time = 100 + spyDuration(ability) + 0.01;
stepVisibility(g, me);
assert.equal(intelligence(g, target).mask & mask & ~before, 0, 'the view ends with the duration');
const other = g.planets.find(p => !p.background && p !== target);
if (!(company.num('Galactic_Influence_Range', 0) > 0 || holder.num('Galactic_Influence_Range', 0) > 0))
  assert(!other.visibilityModifiers?.length, 'only the target planet without an influence range');
assert.equal(activateSpy(game, { ...actor, planet: { ...target, owner: me } }, { ...target, owner: me }, ability, holder), false);
console.log(
  'ok',
  holder.name,
  'respawn',
  db.constants.num('Default_Hero_Respawn_Time', -1),
  'mask',
  mask.toString(16),
  'for',
  spyDuration(ability),
  's on',
  target.name
);
