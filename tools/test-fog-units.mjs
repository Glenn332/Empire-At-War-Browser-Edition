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
const { unitVisible, strategicStealth, useGalaxy, visibilityLevel, VIS } = await import('../public/js/game/galacticfog.js');
const { setAbilityOverride } = await import('../public/js/game/abilityoverride.js');

const T = n => db.type(n);
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet');
const make = mask => {
  const p = { index: 0, type: planetType, owner: 'Empire' };
  return { p, g: { planets: [p], players: [{ faction: 'Rebel' }, { faction: 'Empire' }], visibility: { planets: [{ mask, fleetContents: !!(mask & VIS.FLEET_CONTENTS), groundContents: !!(mask & VIS.GROUND_CONTENTS) }] } } };
};

const han = { type: T('Han_Solo'), owner: 'Rebel' },
  smuggler = { type: T('Generic_Smuggler_R'), owner: 'Rebel' },
  ship = { type: T('Corellian_Corvette'), owner: 'Rebel' };
assert.ok(han.type && smuggler.type && ship.type);
{
  const { g, p } = make(0);
  useGalaxy(g);
  assert.equal(unitVisible(g, han, 'Rebel', p), true, 'own units are always seen');
  assert.equal(unitVisible(g, han, 'Empire', p), false, 'a stealthed named hero needs the major bit');
  assert.equal(unitVisible(g, ship, 'Empire', p), false, 'a plain unit needs fleet contents');
}
{
  const { g, p } = make(VIS.FLEET_CONTENTS);
  assert.equal(unitVisible(g, ship, 'Empire', p), true);
  assert.equal(unitVisible(g, han, 'Empire', p), false, 'fleet contents do not show a stealthed hero');
}
{
  const { g, p } = make(VIS.MAJOR_HEROES);
  assert.equal(unitVisible(g, han, 'Empire', p), true, 'See_Major shows named heroes');
  assert.equal(unitVisible(g, smuggler, 'Empire', p), false, 'but not generic ones');
  const { g: g2, p: p2 } = make(VIS.MINOR_HEROES);
  assert.equal(unitVisible(g2, smuggler, 'Empire', p2), true, 'See_Minor shows generic heroes');
}
{
  const { g, p } = make(VIS.SPECIAL);
  assert.equal(unitVisible(g, { type: ship.type, owner: 'Rebel' }, 'Empire', p, { ground: true, structure: true }), true, 'structures need the special bit');
}
{
  const { g } = make(0);
  useGalaxy(g);
  assert.equal(strategicStealth({ type: T('Boba_Fett'), owner: 'Empire' }), true, 'a missing Initially_Enabled counts as enabled');
  assert.equal(strategicStealth(han), true);
  setAbilityOverride(g.players[0], 'Han_Solo', 'Han_Solo_Galactic_Stealth', true);
  assert.equal(strategicStealth(han), false, 'REMOVE_POWER turns the stealth off for that player');
  assert.equal(strategicStealth({ type: han.type }, 'Rebel'), false, 'fleet units take the owner of their fleet');
  assert.equal(strategicStealth({ type: han.type }, 'Empire'), true, 'other players keep their own setting');
  assert.equal(strategicStealth({ type: T('Chewbacca'), owner: 'Rebel' }), true, 'only for that type');
  setAbilityOverride(g.players[0], 'Han_Solo', 'Han_Solo_Galactic_Stealth', false);
  assert.equal(strategicStealth(han), true, 'NEW_POWER turns it back on');
}
assert.equal(visibilityLevel('Fleet_Contents'), 0x40);
assert.equal(visibilityLevel('planet_owner'), 0x9fff);
assert.equal(visibilityLevel('Good_Default'), 0x11);
assert.equal(visibilityLevel('Nope'), null);
console.log('ok');
