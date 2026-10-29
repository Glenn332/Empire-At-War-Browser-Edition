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
const bm = await import('../public/js/game/blackmarket.js');
const items = await bm.loadBlackMarket();
if (!items.length) {
  console.log('no black market items in this data: skipped');
  process.exit(0);
}
assert(
  items.every(i => i.name && i.faction && i.abilities.length),
  'every item has a name, a faction and abilities'
);

const item = items[0],
  ability = item.abilities[0];
assert.equal(bm.itemFor(ability).name, item.name);
assert.equal(bm.marketLocked(false, true, ability, []), false, 'a battle with no galaxy checks nothing');
assert.equal(bm.marketLocked(true, false, ability, []), false, 'an ability with no flag is open');
assert.equal(bm.marketLocked(true, true, ability, []), true, 'not bought: off');
assert.equal(bm.marketLocked(true, true, ability, [item.name.toLowerCase()]), false, 'bought: on');
assert.equal(bm.marketLocked(true, true, 'No_Such_Ability_Anywhere', []), false, 'an ability no item lists stays open');

const planet = { owner: item.faction, type: { num: (k, d) => (k === 'Planet_Black_Market_Modifier' ? 100 : d) } };
const level = db.faction(item.faction)?.num('Displayed_Tech_Level_Adjustment', 0) || 0;
const high = { players: [{ faction: item.faction, tech: item.tech - level + 1 }] },
  low = { players: [{ faction: item.faction, tech: 0 }] };
const abilityNode = { num: (k, d) => (k === 'Price_Modifier' ? 2 : d) };
assert.equal(bm.itemPrice(high, item, planet, abilityNode), (item.cost + 100) * 2, 'at the item level: the plain price');
if (item.tech - level > 0)
  assert.equal(
    bm.itemPrice(low, item, planet, abilityNode),
    Math.round((item.cost + 100) * 2 * item.uncommon),
    'below it: the uncommon multiplier'
  );

const player = { faction: item.faction, credits: 1e6, tech: 9, blackMarket: [] };
const g = { players: [player] };
const rows = bm.offers(g, player, planet, abilityNode);
assert(rows.length && rows.every(r => r.item.faction.toUpperCase() === item.faction.toUpperCase()));
player.blackMarket.push(rows[0].item.name);
const again = bm.offers(g, player, planet, abilityNode);
assert.equal(again.length, rows.length, 'what the player has stays in the list');
assert.equal(again.filter(r => r.bought).length, 1, 'marked bought');
assert(!again.find(r => r.bought).item.name.includes('zzz'));
assert.equal(
  bm.aiChoice(
    again.filter(r => r.bought),
    1e9
  ),
  null,
  'the computer player does not pick what it has'
);
assert.equal(bm.aiChoice(rows, 0), null, 'nothing affordable: no purchase');
const cheap = [
  { price: 10, item: 'a' },
  { price: 990, item: 'b' }
];
assert.equal(bm.aiChoice(cheap, 5000, () => 0.5).item, 'b');
assert.equal(bm.aiChoice(cheap, 5000, () => 0.001).item, 'a');
assert.equal(bm.aiChoice(cheap, 100, () => 0.9).item, 'a', 'only the affordable ones are weighed');
const buyer = { faction: item.faction, credits: 400, blackMarket: [] };
const gb = { players: [buyer], planets: [], time: 0 };
assert.equal(bm.buyItem(gb, buyer, { item, price: 500 }), false, 'too dear');
assert.equal(bm.buyItem(gb, buyer, { item, price: 300 }), true);
assert.equal(buyer.credits, 100);
assert.deepEqual(buyer.blackMarket, [item.name], 'paid and owned');

const heroes = [...db.types.values()].filter(t =>
  t.sub('Abilities').some(n => n.children.some(a => a.tag.toUpperCase() === 'BLACK_MARKET_ABILITY'))
);
assert(heroes.length, 'a hero carries the Black_Market_Ability');
const ab = heroes[0]
  .sub('Abilities')
  .flatMap(n => n.children)
  .find(a => a.tag.toUpperCase() === 'BLACK_MARKET_ABILITY');
assert(ab.val('Min_Respawn_Times') && ab.val('Max_Respawn_Times'), 'respawn times by tech level');

const { groundActivated } = await import('../public/js/game/planetdestruction.js');
const hero = heroes.find(t => db.faction(t.list('Affiliation')[0])?.bool('Is_Playable'));
const seller = items[0].faction;
console.log('end to end with', hero?.name);
if (hero) {
  const owner = db.faction(hero.list('Affiliation')[0]).name;
  const mk = corruption => {
    const record = { type: hero, owner },
      planet = {
        owner: seller,
        currentCorruption: corruption,
        type: { num: (k, d) => (k === 'Planet_Black_Market_Modifier' ? 0 : d) },
        garrison: [],
        groundStructures: []
      };
    const actor = { record, type: hero, owner, planet, dead: false };
    const ai = { faction: owner, ai: 'Easy', credits: 1e6, tech: 0, blackMarket: [] };
    const galaxy = { players: [ai, { faction: seller, credits: 0, tech: 0 }], planets: [planet], time: 0 };
    const despawned = [];
    return { game: { galaxy, me: 'Nobody', story: { despawn: a => despawned.push(a) } }, actor, planet, ai, despawned };
  };
  const wrong = mk(3);
  assert.equal(groundActivated(wrong.game, wrong.actor), false, 'not on a planet of another corruption');
  assert.equal(wrong.ai.blackMarket.length, 0);
  const ok = mk(6);
  assert.equal(groundActivated(ok.game, ok.actor), true);
  assert.equal(ok.ai.blackMarket.length, 1, 'one item bought');
  assert(items.find(i => i.name === ok.ai.blackMarket[0]).faction === seller, 'one of the planet owner faction');
  assert(ok.ai.credits < 1e6, 'it is paid');
  assert.equal(ok.despawned.length, 1, 'Causes_Despawn takes the hero off');
  assert.equal(ok.planet.killedHeroes.length, 1, 'and queues it to come back');
  const human = mk(6);
  human.game.me = owner;
  human.ai.ai = null;
  let asked = null;
  human.game.openBlackMarket = r => {
    asked = r;
  };
  assert.equal(groundActivated(human.game, human.actor), false, 'a human is shown the panel; the ability itself buys nothing');
  assert(asked && asked.rows.length === 5 && asked.planet === human.planet, 'the panel gets the five offers and the planet');
  assert.equal(human.ai.blackMarket.length, 0);
  assert.equal(human.despawned.length, 0, 'the hero stays until a purchase');
  const row = asked.rows[1];
  human.ai.credits = row.price - 1;
  assert.equal(bm.completePurchase(human.game, human.actor, human.planet, row, 60), false, 'too dear at execution: nothing happens');
  human.ai.credits = row.price + 5;
  assert.equal(bm.completePurchase(human.game, human.actor, human.planet, row, 60), true);
  assert.equal(human.ai.credits, 5);
  assert.deepEqual(human.ai.blackMarket, [row.item.name]);
  assert.equal(human.despawned.length, 1);
  assert.equal(human.planet.killedHeroes[0].dueFrame, 60 * 30, 'back after the rolled time');
  assert.equal(bm.completePurchase(human.game, human.actor, human.planet, row, 60), false, 'an item the player has is not bought again');
  assert.equal(bm.rollRespawn(human.game.galaxy, human.ai, ab, () => 0.5) >= 0, true);
  assert.equal(bm.rollRespawn(human.game.galaxy, { faction: 'Nobody' }, ab), 0, 'out of range: the default time');
}

const { landAbilities } = await import('../public/js/game/landabilities.js');
const flagged = [...db.types.values()].flatMap(t => landAbilities(t)).filter(d => d.mustBuy);
const { parseAbilities } = await import('../public/js/game/abilities.js');
const spaceFlagged = [...db.types.values()]
  .flatMap(t => {
    try {
      return parseAbilities(t);
    } catch {
      return [];
    }
  })
  .filter(d => d.mustBuy);
assert(spaceFlagged.length, 'a space ability carries the flag');
for (const d of [...flagged, ...spaceFlagged]) assert(d.gui, 'a flagged ability names its GUI_Activated_Ability_Name');
const sold = [...flagged, ...spaceFlagged].filter(d => bm.itemFor(d.gui));
assert(sold.length, 'a flagged ability is sold by an item');
assert.equal(bm.abilityLocked(true, sold[0], []), true);
assert.equal(bm.abilityLocked(true, sold[0], [bm.itemFor(sold[0].gui).name]), false);
assert.equal(bm.abilityLocked(false, sold[0], []), false);
console.log('ok', items.length, 'items,', heroes.length, 'hero(es),', flagged.length, 'flagged land abilities');
