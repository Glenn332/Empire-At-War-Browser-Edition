import { simRandom } from './simrandom.js';
import { db } from '../gamedata.js';
import { fetchText } from '../vfs.js';
import { parseXML } from '../xml.js';
import { adjustCredits } from './galacticeconomy.js';
import { scheduleHeroRespawn } from './galacticherorespawn.js';

const key = s => String(s || '').trim().toUpperCase();
let items = null;

export async function loadBlackMarket() {
  if (items) return items;
  const xml = await fetchText('Data/XML/BlackMarketItems.xml').catch(() => null);
  items = [];
  for (const node of parseXML(xml || '<x/>').children[0]?.children || []) {
    if (!node.attrs?.Name) continue;
    const list = tag => node.val(tag).split(/[\s,]+/).filter(Boolean);
    items.push({
      name: node.attrs.Name, faction: node.val('Faction'), tech: node.num('Tech_Level', 0), abilities: list('Ability_Names'),
      cost: node.num('Base_Cost_Credits', 0), uncommon: node.num('Uncommon_Price_Multiplier', 1), icon: node.val('Icon_Name'),
      title: node.val('Localized_Name'), description: node.val('Localized_Description'), units: list('Used_By_Units'),
      tutorialTech: node.num('Tutorial_Tech_Level', 0), tutorialCost: node.num('Tutorial_Base_Cost_Credits', 0),
    });
  }
  return items;
}
export const blackMarketItems = () => items || [];

export const itemFor = ability => items?.find(i => i.abilities.some(n => key(n) === key(ability))) || null;

export function marketLocked(campaign, mustBuy, name, bought) {
  if (!campaign || !mustBuy || !name) return false;
  const item = itemFor(name);
  return !!item && !(bought || []).some(n => key(n) === key(item.name));
}

export const abilityLocked = (campaign, def, bought) => marketLocked(campaign, def.mustBuy, def.gui, bought);

export function itemPrice(g, item, planet, ability) {
  const owner = g.players.find(p => key(p.faction) === key(item.faction));
  const level = (owner?.tech ?? 0) + (db.faction(item.faction)?.num('Displayed_Tech_Level_Adjustment', 0) || 0);
  let price = (item.cost + planet.type.num('Planet_Black_Market_Modifier', 0)) * (ability?.num?.('Price_Modifier', 1) ?? 1);
  if (owner && level < item.tech) price *= item.uncommon;
  return Math.round(price);
}

export const displayedTech = (g, faction) => (g.players.find(p => key(p.faction) === key(faction))?.tech ?? 0) + (db.faction(faction)?.num('Displayed_Tech_Level_Adjustment', 0) || 0);

export function offers(g, player, planet, ability) {
  return blackMarketItems().filter(i => key(i.faction) === key(planet.owner))
    .map(item => ({ item, price: itemPrice(g, item, planet, ability), bought: (player.blackMarket || []).some(n => key(n) === key(item.name)) }));
}

export function rollRespawn(g, player, ability, random = simRandom) {
  const list = tag => ability.val(tag).split(/[\s,]+/).map(parseFloat).filter(Number.isFinite), lo = list('Min_Respawn_Times'), hi = list('Max_Respawn_Times');
  const index = displayedTech(g, player.faction) - 1;
  if (!lo.length || index < 0 || index > 4) return 0;
  const a = lo[index] ?? 0, b = hi[index] ?? a;
  return a + (b - a) * random();
}

export function completePurchase(game, actor, planet, row, respawn) {
  const g = game.galaxy, player = g.players.find(p => key(p.faction) === key(actor.owner));
  if (!player || actor.dead || row.price > player.credits || (player.blackMarket || []).some(n => key(n) === key(row.item.name))) return false;
  buyItem(g, player, row);
  scheduleHeroRespawn(game, actor.record || actor, planet, actor.owner, null, respawn, true);
  game.story?.despawn(actor);
  return true;
}

export function buyItem(g, player, row) {
  if (player.credits < row.price) return false;
  adjustCredits(g, player.faction, -row.price);
  (player.blackMarket ||= []).push(row.item.name);
  return true;
}

export function aiChoice(rows, credits, random = simRandom) {
  const can = rows.filter(r => !r.bought && r.price <= credits && r.price > 0), total = can.reduce((n, r) => n + r.price, 0);
  if (!can.length) return null;
  let at = random() * total;
  for (const r of can) { at -= r.price; if (at <= 0) return r; }
  return can.at(-1);
}

export function canBlackMarket(game, actor, planet) {
  const seller = planet.politicalOwner ?? planet.owner;
  return !!seller && (planet.currentCorruption ?? -1) === 6 && !!db.faction(planet.owner)?.bool('Is_Playable') && key(seller) !== key(actor.owner) && !db.faction(actor.owner)?.list('Allies').some(n => key(n) === key(seller));
}

export function activateBlackMarket(game, actor, planet, ability) {
  const g = game.galaxy, owner = actor.owner, player = g.players.find(p => key(p.faction) === key(owner));
  const seller = planet.politicalOwner ?? planet.owner;
  if (planet.marketRestricted || !player || (planet.currentCorruption ?? -1) !== 6 || !db.faction(planet.owner)?.bool('Is_Playable') || !items || key(seller) === key(owner) || db.faction(owner)?.list('Allies').some(n => key(n) === key(seller))) return false;
  const respawn = rollRespawn(g, player, ability), rows = offers(g, player, planet, ability);
  if (player.ai === null || player.faction === game.me) { if (rows.length) game.openBlackMarket?.({ actor, planet, rows, respawn }); return false; }
  const row = aiChoice(rows, player.credits);
  if (!row || !buyItem(g, player, row)) return false;
  scheduleHeroRespawn(game, actor.record || actor, planet, owner, null, respawn, true);
  return true;
}
