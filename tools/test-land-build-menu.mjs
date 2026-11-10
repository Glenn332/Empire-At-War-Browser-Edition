import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { LandWorld, buildsFor } = await import('../public/js/game/land.js');
const world = () =>
  Object.assign(Object.create(LandWorld.prototype), {
    factions: ['Rebel', 'Empire'],
    team: [0, 1],
    campaign: false,
    time: 0,
    units: [],
    sites: [],
    owned: [new Set(), new Set()]
  });

{
  const w = world();
  const lob = [...db.types.values()].find(t => /LOBBING_SUPERWEAPON/i.test(t.str('LandBehavior')));
  assert(lob, 'a lobbing superweapon structure exists');
  const filler = [...db.types.values()].filter(t => t.has('Tactical_Build_Time_Seconds')).slice(0, 8);
  const site = { base: true, side: 0, options: [lob, ...filler], structure: null, building: null };
  w.sites.push(site);
  assert.equal(w.siteMenu(site, 0).length, 6, 'at most six options');
  assert(w.siteOptions(site, 0).includes(lob));
  w.units.push({ dead: false, side: 0, type: lob });
  assert(!w.siteMenu(site, 0).includes(lob), 'one-per-player type dropped once owned');
  assert.equal(w.siteMenu(site, 1).length, 0, 'enemy pad offers nothing');
  w.units.length = 0;
  const other = { base: true, side: 0, options: [lob], structure: null, building: { uc: lob, side: 0, left: 5, total: 10 } };
  w.sites.push(other);
  assert(!w.siteMenu(site, 0).includes(lob), 'also dropped while one is being built');
  assert.equal(w.siteOptions(other, 0).length, 0, 'a building pad takes no new order');
  assert(w.siteMenu(other, 0).length <= 1, 'the menu itself stays listable while building');
}

{
  const mdu = [...db.types.values()].find(
    t => t.list('DeployedBehavior').some(b => /TACTICAL_BUILD_OBJECTS/i.test(b)) && buildsFor(t, 'Empire', true).length
  );
  assert(mdu, 'an Empire mobile defence unit exists');
  for (const campaign of [false, true]) {
    const w = world();
    w.campaign = campaign;
    const u = { type: mdu, side: 1, x: 100, y: 100, z: 0, heading: 0, dead: false, deployed: true };
    w.units.push(u);
    w.deployBuilder(u, true);
    assert(u.padSite && w.sites.includes(u.padSite), 'deploying opens a build site');
    assert.deepEqual(
      u.padSite.options.map(t => t.name),
      buildsFor(mdu, 'Empire', campaign).map(t => t.name),
      'options follow the campaign or multiplayer list'
    );
    assert(w.siteOptions(u.padSite, 1).length > 0);
    w.units.push({ dead: false, side: 0, x: 100 + mdu.num('Capture_Point_Radius', 200) / 2, y: 100 });
    assert.equal(w.siteOptions(u.padSite, 1).length, 0, 'an enemy inside the capture radius blocks building');
    w.deployBuilder(u, false);
    assert(!u.padSite && !w.sites.length, 'undeploying closes it');
  }
}
console.log('ok');
