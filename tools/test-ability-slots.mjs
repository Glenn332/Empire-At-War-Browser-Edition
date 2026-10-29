import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) { const re = new RegExp(decodeURIComponent(path.slice(11)), 'i'); return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n)))); }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])), data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js'); await loadGameData();
const S = await import('../public/js/game/abilityslots.js');
const B = await import('../public/js/game/blackmarket.js'); await B.loadBlackMarket();
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && t.list('Corruption_1_Type').length && t.num('Planet_Credit_Value', 0) > 0);
const mk = (owner, extra = {}) => ({ index: 0, type: planetType, name: planetType.name, owner, currentCorruption: -1, garrison: [], groundStructures: [], orbitalStructures: [], ...extra });
const game = (planets = []) => ({ galaxy: { planets, fleets: [], players: [{ faction: 'Rebel', credits: 1000, tech: 2, unlockedTypes: [], lockedTypes: [] }, { faction: 'Empire', credits: 1000, tech: 2 }, { faction: 'Underworld', credits: 1000, tech: 2 }], time: 0, routes: [] }, me: 'Rebel' });
const rec = (name, owner) => ({ type: db.type(name), owner });
const labels = { 1: 'TEXT_ABILITY_SLOT_SLICE', 5: 'TEXT_ABILITY_SLOT_SIPHON_CREDITS', 7: 'TEXT_ABILITY_SLOT_CORRUPT_PLANET', 8: 'TEXT_ABILITY_SLOT_REMOVE_CORRUPTION', 9: 'TEXT_ABILITY_SLOT_BLACK_MARKET' };

const r2 = db.type('Droid_R2D2') ? rec('Droids_Team', 'Rebel') : null;
if (r2.type) {
  const p = mk('Empire'), g = game([p]);
  const slot = S.slotFor(g, r2, p, 'Rebel'); assert.equal(slot?.code, 1); assert.equal(slot.text, labels[1]);
  p.owner = 'Rebel'; assert.equal(S.slotFor(g, r2, p, 'Rebel'), null, 'not on its own planet');
  p.owner = 'Empire'; p.abilitiesRestricted = true; assert.equal(S.slotFor(g, r2, p, 'Rebel'), null, 'RESTRICT_ALL_ABILITIES');
}
{
  const saboteur = rec('Underworld_Saboteur_Team', 'Underworld'); if (!saboteur.type) saboteur.type = db.type('Underworld_Saboteur');
  const p = mk('Empire'), g = game([p]);
  if (saboteur.type) {
    assert.equal(S.slotFor(g, saboteur, p, 'Underworld')?.code, 7, 'spread corruption');
    p.currentCorruption = 2; assert.notEqual(S.slotFor(g, saboteur, p, 'Underworld')?.code, 7, 'a corrupted planet offers no more corruption'); p.currentCorruption = -1;
    p.corruptionRestricted = true; assert.notEqual(S.slotFor(g, saboteur, p, 'Underworld')?.code, 7, 'RESTRICT_CORRUPTION'); p.corruptionRestricted = false;
  }
  const smuggler = [...db.types.values()].find(t => t.list('Company_Units').some(n => /smuggler/i.test(n)) && t.list('Affiliation').includes('Rebel'));
  if (smuggler) { assert.equal(S.slotFor(g, { type: smuggler, owner: 'Rebel' }, p, 'Rebel')?.code, 5, 'steal credits'); p.creditSiphonOwner = 'Rebel'; assert.equal(S.slotFor(g, { type: smuggler, owner: 'Rebel' }, p, 'Rebel'), null, 'one siphon on a planet'); }
  const tyber = [...db.types.values()].find(t => t.sub('Abilities').some(n => n.children.some(a => a.tag.toUpperCase() === 'BLACK_MARKET_ABILITY')));
  const market = mk('Empire', { currentCorruption: 6 });
  assert.equal(S.slotFor(game([market]), { type: tyber, owner: 'Underworld' }, market, 'Underworld')?.code, 9, 'buy');
  market.marketRestricted = true; assert.equal(S.slotFor(game([market]), { type: tyber, owner: 'Underworld' }, market, 'Underworld'), null, 'RESTRICT_BLACK_MARKET');
  const vader = [...db.types.values()].find(t => t.sub('Abilities').some(n => n.children.some(a => a.tag.toUpperCase() === 'REMOVE_CORRUPTION_ABILITY')) && t.list('Affiliation').includes('Empire'));
  const own = mk('Empire', { currentCorruption: 3 });
  assert.equal(S.slotFor(game([own]), { type: vader, owner: 'Empire' }, own, 'Empire')?.code, 8, 'remove corruption');
  own.currentCorruption = -1; assert.equal(S.slotFor(game([own]), { type: vader, owner: 'Empire' }, own, 'Empire'), null, 'nothing to remove');
}
assert(S.isHero({ type: db.type('Droids_Team') || [...db.types.values()].find(t => t.bool('Is_Named_Hero')) }), 'a hero');
console.log('ok');
