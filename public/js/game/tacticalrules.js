import { db } from '../gamedata.js';

let rules = { campaign: false, skirmish: false, corrupted: false };

export function setTacticalRules(next) {
  rules = { campaign: !!next?.campaign, skirmish: !!next?.skirmish, corrupted: !!next?.corrupted };
  return rules;
}
export const tacticalRules = () => rules;
export const setSkirmishRules = on => setTacticalRules({ ...rules, skirmish: !!on });
export const campaignRules = () => rules.campaign && !rules.skirmish;

export function tacticalCost(type) {
  const multiplayer = type.num('Tactical_Build_Cost_Multiplayer', 0);
  if (!campaignRules()) return multiplayer;
  const campaign = type.num('Tactical_Build_Cost_Campaign', 0);
  return campaign > 0 ? campaign : multiplayer;
}

export function padCost(type, faction) {
  let cost = tacticalCost(type);
  if (campaignRules() && rules.corrupted) {
    const scale = parseFloat(db.faction(faction)?.list('Corruption_Tactical_Build_Pad_Price_Multipliers').flatMap(s => s.split(/[\s,]+/)).filter(Boolean)[1]);
    if (Number.isFinite(scale)) cost *= scale;
  }
  return Math.trunc(cost);
}

export const buildListTag = () => (campaignRules() ? 'Tactical_Buildable_Objects_Campaign' : 'Tactical_Buildable_Objects_Multiplayer');
