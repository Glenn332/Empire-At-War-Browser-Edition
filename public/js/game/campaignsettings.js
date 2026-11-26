import { db } from '../gamedata.js';
import { unlockBelowTech } from './galacticproduction.js';
import { expansion } from '../edition.js';

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
    autoResolve: 2,
    groundAutoResolve: false,
    randomEvents: true
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

// The lobby's "auto-resolve all ground battles" choice rides in the shared setup so every peer agrees. A setup or save
// from before the option has no value, which keeps the old attack/retreat prompt.
export function applyGroundAutoResolve(g, setup) {
  const on = setup?.options?.groundAutoResolve;
  if (on !== undefined) g.groundAutoResolve = !!on;
  const events = setup?.options?.randomEvents;
  if (events !== undefined) g.randomEvents = !!events;
}

// Only the original game's AI players carry the random-event goals (fleet rampages, planet flips, traps), which they
// switch off when Game.InterventionsEnabled reads 0. The expansion has none, so there the box keeps our ground
// auto-resolve choice; in the original game it is "Allow random events" again and ground auto-resolve gets a box of its own.
export const offersRandomEvents = () => !expansion();

export function optionBoxes(dlg, st, groundLabel) {
  const ground = id =>
    dlg.check(id, st.groundAutoResolve === true, on => {
      st.groundAutoResolve = on;
    });
  if (!offersRandomEvents()) {
    dlg.setText('IDC_ALLOW_RANDOM_EVENTS', groundLabel);
    ground('IDC_ALLOW_RANDOM_EVENTS');
    return;
  }
  dlg.check('IDC_ALLOW_RANDOM_EVENTS', st.randomEvents !== false, on => {
    st.randomEvents = on;
  });
  const box = dlg.ctl('IDC_ALLOW_RANDOM_EVENTS');
  if (!box) return;
  // the second label is too long to sit beside the first, so it takes the row below
  const top = parseFloat(box.style.top) || 0,
    height = parseFloat(box.style.height) || 0;
  if (!dlg.ctl('IDC_SWR_GROUND_AUTORESOLVE'))
    dlg.clone(
      'IDC_ALLOW_RANDOM_EVENTS',
      'IDC_SWR_GROUND_AUTORESOLVE',
      null,
      top + (box.parentNode?._top || 0) + Math.max(20, height * 1.8)
    );
  dlg.setText('IDC_SWR_GROUND_AUTORESOLVE', groundLabel);
  ground('IDC_SWR_GROUND_AUTORESOLVE');
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
