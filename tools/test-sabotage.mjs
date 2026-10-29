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
const X = await import('../public/js/game/galacticsabotage.js');
const S = await import('../public/js/game/abilityslots.js');
const { planetIncome } = await import('../public/js/game/galacticeconomy.js');
const B = await import('../public/js/game/blackmarket.js'); await B.loadBlackMarket();

const saboteur = db.type('Underworld_Saboteur_Team') || db.type('Underworld_Saboteur');
const ability = saboteur && [saboteur, ...saboteur.list('Company_Units').map(n => db.type(n))].filter(Boolean).flatMap(t => t.sub('Abilities').flatMap(n => n.children)).find(a => a.tag.toUpperCase() === 'GALACTIC_SABOTAGE_ABILITY');
if (!ability) { console.log('no sabotage ability in this data: skipped'); process.exit(0); }
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && t.list('Corruption_1_Type').length && t.num('Planet_Credit_Value', 0) > 0);
const structureTypes = [...db.types.values()].filter(t => t.num('Sabotage_Cost_Credits', 0) > 0).slice(0, 3);
assert(structureTypes.length >= 2, 'structures with a sabotage price');
const unit = (type, owner) => ({ type, owner, dead: false });
const mk = (owner, extra = {}) => ({ index: 0, type: planetType, name: planetType.name, owner, currentCorruption: 2, garrison: [], groundStructures: [], orbitalStructures: [], production: { ground: [], space: [] }, ...extra });
const messages = [], story = [];
const game = (planets, credits = 30000) => ({
  galaxy: { planets, fleets: [], players: [{ faction: 'Rebel', credits: 1000, tech: 2, ai: 1 }, { faction: 'Empire', credits: 1000, tech: 2, ai: 1 }, { faction: 'Underworld', credits, tech: 2, ai: 1 }], time: 100, routes: [] },
  me: 'Underworld', message: t => messages.push(t), story: { signal: (...a) => story.push(a), despawn: u => { u.dead = true; }, reasonCache: new Map() }, audio: { play() {} },
});
const actor = { owner: 'Underworld', record: { type: saboteur, owner: 'Underworld' }, planet: null };

{
  const p = mk('Empire', { groundStructures: [unit(structureTypes[0], 'Empire')] }), g = game([p]);
  assert.deepEqual(X.sabotageOptions(ability, p, 'Underworld'), [3].concat(X.sabotageOptions(ability, p, 'Underworld').filter(c => c !== 3)));
  assert(X.canSabotageWith(g, actor, p, ability));
  p.currentCorruption = -1; assert(!X.sabotageOptions(ability, p, 'Underworld').includes(3), 'only a corrupted planet');
  p.currentCorruption = 2; p.owner = 'Underworld'; assert(!X.canSabotageWith(g, actor, p, ability), 'not its own planet');
  p.owner = 'Empire'; p.groundStructures = []; assert(!X.sabotageOptions(ability, p, 'Underworld').includes(3), 'nothing to destroy');
}
{
  const s = unit(structureTypes[0], 'Empire'), p = mk('Empire', { groundStructures: [s] }), base = s.type.num('Sabotage_Cost_Credits', 0), factor = ability.num('Sabotage_Cost_Increase_Factor', 2);
  assert.equal(X.sabotagePrice(ability, p, s), Math.round(base));
  p.sabotageCount = 2; assert.equal(X.sabotagePrice(ability, p, s), Math.round(factor ** 2 * base));
  assert.equal(X.sabotagePrice(ability, p, s, true), s.type.num('Tutorial_Sabotage_Cost_Credits', 0) || base);
  assert.equal(X.sabotagePrice(ability, p, unit(db.type('Empire_Stormtrooper') || planetType, 'Empire')), -1, 'no price: not offered');
}
{
  const s1 = unit(structureTypes[0], 'Empire'), s2 = unit(structureTypes[1], 'Empire'), p = mk('Empire', { groundStructures: [s1, s2] }), g = game([p]), a = { ...actor, planet: p };
  const price = X.sabotagePrice(ability, p, s1);
  assert(X.sabotageStructure(g, a, p, s1, price));
  assert(s1.dead && !p.groundStructures.includes(s1) && p.groundStructures.includes(s2));
  assert.equal(g.galaxy.players[2].credits, 30000 - price); assert.equal(p.sabotageCount, 1);
  assert(story.some(e => e[0] === 'STORY_GALACTIC_SABOTAGE' && e[1] === structureTypes[0].name), 'the story hears it');
  assert(messages.length === 1 && /destroyed/i.test(messages[0]), 'the saboteur\'s side is told: ' + messages);
  assert(a.record.type && p.killedHeroes?.some(e => e.owner === 'Underworld'), 'the hero is queued to come back');
  assert(X.sabotagePrice(ability, p, s2) >= Math.round(2 * s2.type.num('Sabotage_Cost_Credits', 0)) * (ability.num('Sabotage_Cost_Increase_Factor', 2) === 2 ? 1 : 0), 'the next costs more');
  const poor = game([mk('Empire', { groundStructures: [s2] })], 1);
  assert(!X.sabotageStructure(poor, a, poor.galaxy.planets[0], s2, 5000));
  const gift = mk('Empire', { groundStructures: [unit(structureTypes[0], 'Empire')] }), free = game([gift]);
  assert(X.sabotageReward(free, gift, structureTypes[0].name) && !gift.groundStructures.length && free.galaxy.players[2].credits === 30000);
}
{
  const a1 = unit(structureTypes[0], 'Empire'), a2 = unit(structureTypes[1], 'Empire'), p = mk('Empire', { groundStructures: [a1, a2] }), g = game([p]), a = { ...actor, planet: p }; g.me = 'Rebel';
  assert(X.activateSabotage(g, a, p, ability), 'the computer destroyed one');
  assert.equal(p.groundStructures.length, 1);
  const q = mk('Empire', { groundStructures: [unit(structureTypes[0], 'Empire')] }), h = game([q]); let opened = null; h.galaxy.players[2].ai = null; h.openSabotageMenu = r => { opened = r; return true; };
  assert(!X.activateSabotage(h, { ...actor, planet: q }, q, ability) && opened, 'a human gets the menu');
  assert(opened.rows.length === 1 && opened.rows[0].price >= 1);
  const broke = mk('Empire', { groundStructures: [unit(structureTypes[0], 'Empire')] }), c = game([broke], 1); c.me = 'Rebel';
  assert(!X.activateSabotage(c, { ...actor, planet: broke }, broke, ability) && broke.groundStructures.length === 1, 'cannot pay: nothing');
}
{
  const p = mk('Empire'), g = game([p]);
  const before = planetIncome(g.galaxy, p); assert(before > 0);
  p.incomeHaltUntil = 150; assert.equal(planetIncome(g.galaxy, p), 0, 'halted');
  g.galaxy.time = 151; assert.equal(planetIncome(g.galaxy, p), before, 'over');
  p.incomeHaltUntil = -1; assert.equal(planetIncome(g.galaxy, p), 0, 'for good');
}
{
  const p = mk('Empire', { groundStructures: [unit(structureTypes[0], 'Empire')] }), g = game([p]);
  assert.equal(S.slotFor(g, { type: saboteur, owner: 'Underworld' }, p, 'Underworld')?.code, 2);
  p.sabotageRestricted = true; assert.notEqual(S.slotFor(g, { type: saboteur, owner: 'Underworld' }, p, 'Underworld')?.code, 2, 'RESTRICT_SABOTAGE'); p.sabotageRestricted = false;
  p.currentCorruption = -1; assert.notEqual(S.slotFor(g, { type: saboteur, owner: 'Underworld' }, p, 'Underworld')?.code, 2, 'needs corruption');
  g.galaxy.sabotageOff = true; p.currentCorruption = 2; assert.notEqual(S.slotFor(g, { type: saboteur, owner: 'Underworld' }, p, 'Underworld')?.code, 2, 'ENABLE_SABOTAGE off');
}
{
  const a1 = unit(structureTypes[0], 'Empire'), p = mk('Empire', { groundStructures: [a1] }), g = game([p]); g.me = 'Rebel'; story.length = 0; messages.length = 0;
  const before = g.galaxy.players[2].credits;
  assert(X.activateSabotage(g, { ...actor, planet: p }, p, ability) && g.galaxy.players[2].credits === before, 'the computer player keeps its credits');
  assert(!story.some(e => e[0] === 'STORY_GALACTIC_SABOTAGE') && story.some(e => e[0] === 'STORY_LAND_ON'), 'only the landing is told');
  const flags = { Can_Reduce_Ground_Base_Level: 'Yes', Can_Reduce_Starbase_Level: 'Yes', Can_Cancel_Production: 'Yes', Can_Destroy_Special_Structure: 'No', Can_Halt_Credit_Production: 'Yes', Duration_Of_Credit_Halt: '0' };
  const fake = { val: k => flags[k] ?? '', num: (k, d = 0) => (k === 'Duration_Of_Credit_Halt' ? +flags[k] : d) };
  const many = Array.from({ length: 6 }, () => unit(structureTypes[0], 'Empire')), q = mk('Empire', { groundStructures: many, production: { space: [{ type: structureTypes[1] }], ground: [{ type: structureTypes[0] }] } });
  assert.deepEqual(X.sabotageOptions(fake, q, 'Underworld'), [0, 2, 4]);
  const h = game([q]); h.me = 'Rebel';
  const ok = X.activateSabotage(h, { ...actor, planet: q }, q, fake); assert(ok);
  assert(q.groundStructures.length < 6 || q.incomeHaltUntil > 100 || q.production.space.length + q.production.ground.length < 2, 'something happened');
  const r = mk('Empire'), w = game([r]); w.me = 'Rebel'; assert(X.activateSabotage(w, { ...actor, planet: r }, r, { ...fake, val: k => (k === 'Can_Halt_Credit_Production' ? 'Yes' : 'No') }));
  assert.equal(r.incomeHaltUntil, 110, 'ten seconds from time 100'); const first = r.incomeHaltUntil; w.galaxy.time = 105; X.activateSabotage(w, { ...actor, planet: r }, r, { ...fake, val: k => (k === 'Can_Halt_Credit_Production' ? 'Yes' : 'No') });
  assert.equal(r.incomeHaltUntil, 115, 'a new halt ends later; one that is running is not stacked'); w.galaxy.time = 100;
  const six = mk('Empire', { groundStructures: Array.from({ length: 6 }, () => unit(structureTypes[0], 'Empire')) }), z = game([six]); z.me = 'Rebel';
  assert(X.activateSabotage(z, { ...actor, planet: six }, six, { ...fake, val: k => (k === 'Can_Reduce_Ground_Base_Level' ? 'Yes' : 'No') }));
  assert.equal(six.groundStructures.length, 4, 'level 5 goes to level 4: down to four structures');
  const generic = [...db.types.values()].find(t => t.bool('Is_Generic_Hero') && t.list('Company_Units').length === 0);
  const vig = mk('Empire', { groundStructures: [unit(structureTypes[0], 'Empire')] }), vv = game([vig]); vv.me = 'Rebel'; const realBool = vig.type.bool.bind(vig.type);
  if (generic) { const v2 = Object.create(vig.type); v2.bool = k => k === 'Planet_Vigilance' || realBool(k); vig.type = v2; story.length = 0; assert(X.activateSabotage(vv, { owner: 'Underworld', record: { type: generic, owner: 'Underworld' }, planet: vig }, vig, ability)); assert.equal(vig.groundStructures.length, 1, 'nothing was destroyed'); }
}
{
  const base = db.type('Empire_Star_Base_2'), next = base && db.type(base.str('Next_Level_Base').trim());
  if (base && next) {
    const p = mk('Empire', { station: base, stationOwner: 'Empire', spaceLevel: base.num('Base_Level', 2), production: { space: [{ type: next, owner: 'Empire', cost: 700 }], ground: [] } }), g = game([p]); g.me = 'Rebel';
    const flags = { Can_Reduce_Starbase_Level: 'Yes' }, fake = { val: k => flags[k] ?? 'No', num: (k, d = 0) => d }, before = g.galaxy.players[1].credits;
    assert(X.activateSabotage(g, { ...actor, planet: p }, p, fake));
    assert.equal(p.station?.name, db.type(base.str('Prev_Level_Base').trim())?.name, 'one level down');
    assert.equal(p.production.space.length, 0, 'the upgrade was cancelled'); assert.equal(g.galaxy.players[1].credits, before + 700, 'and refunded');
  }
}
console.log('ok');
