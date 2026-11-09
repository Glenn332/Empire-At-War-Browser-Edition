import { db } from '../gamedata.js';
import { unlockBelowTech } from './galacticproduction.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();

export const techAdjust = faction => db.faction(faction)?.num('Displayed_Tech_Level_Adjustment', 0) || 0;

function factionValue(campaign, tag, faction, fallback) {
  const row = campaign.tuples(tag).find(t => key(t[0]) === key(faction));
  return row ? +row[1] || 0 : fallback;
}

export function campaignLimits(campaign) {
  return {
    custom: campaign.bool('Supports_Custom_Settings', true),
    minTech: campaign.num('Min_Custom_Tech_Level', 1),
    maxTech: campaign.num('Max_Custom_Tech_Level', 5),
    minCredits: campaign.num('Min_Custom_Starting_Credits', 0),
    maxCredits: campaign.num('Max_Custom_Starting_Credits', 10000)
  };
}

export function campaignDefaults(campaign, faction) {
  return {
    custom: false,
    credits: factionValue(campaign, 'Starting_Credits', faction, 0),
    tech: factionValue(campaign, 'Starting_Tech_Level', faction, 0),
    maxTech: factionValue(campaign, 'Max_Tech_Level', faction, 5),
    autoResolve: 2
  };
}

export const creditSteps = limits => Math.floor((limits.maxCredits - limits.minCredits) / 1000) + 1;

export function creditsAt(limits, position) {
  const span = limits.maxCredits - limits.minCredits;
  return Math.trunc((Math.trunc(span * position + 0.5) + 999) / 1000) * 1000 + limits.minCredits;
}

export function techRange(limits, faction) {
  const adj = techAdjust(faction);
  return { lo: limits.minTech - adj, hi: limits.maxTech - adj, adj };
}

export function applyCampaignSettings(g, settings, human) {
  if (!settings?.custom) return;
  const start = settings.tech + techAdjust(human),
    max = settings.maxTech + techAdjust(human);
  for (const p of g.players) {
    const shift = techAdjust(p.faction) ? -1 : 0;
    p.credits = settings.credits;
    p.tech = start + shift;
    p.maxTech = max + shift;
    unlockBelowTech(p);
  }
  g.campaignAutoResolve = settings.autoResolve;
}
