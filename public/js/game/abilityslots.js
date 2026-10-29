import { db } from '../gamedata.js';
import { canHack } from './galactichack.js';
import { planetDestructionAllowed, hasPlanetDestruction } from './planetdestruction.js';
import { canCorrupt, canRemove } from './galacticcorruption.js';
import { canSlice } from './galacticslicer.js';
import { canBlackMarket } from './blackmarket.js';
import { canSabotageWith } from './galacticsabotage.js';

const key = s => String(s || '').trim().toUpperCase();
const same = (a, b) => key(a) === key(b);
const yes = s => !/^(no|false|0)$/i.test(String(s ?? 'yes').trim() || 'yes');
const list = tag => db.constants.str(tag).split(/[,\s]+/).filter(Boolean).map(key);

export const SLOTS = [
  { code: 6, text: 'TEXT_TOOLTIP_ABILITY_DESTROY_PLANET_NAME', names: 'Activated_Destroy_Planet_Ability_Names', tag: 'PLANET_DESTRUCTION_ABILITY', can: (g, a, p) => planetDestructionAllowed(g, a, p) },
  { code: 1, text: 'TEXT_ABILITY_SLOT_SLICE', names: 'Activated_Slice_Ability_Names', tag: 'SLICER_ABILITY', can: (g, a, p) => canSlice(g, a, p) },
  { code: 9, text: 'TEXT_ABILITY_SLOT_BLACK_MARKET', names: 'Activated_Black_Market_Ability_Names', tag: 'BLACK_MARKET_ABILITY', can: (g, a, p) => !p.marketRestricted && canBlackMarket(g, a, p), restrict: 'marketRestricted' },
  { code: 2, text: 'TEXT_ABILITY_SLOT_SABOTAGE', names: 'Activated_Sabotage_Ability_Names', tag: 'GALACTIC_SABOTAGE_ABILITY', can: (g, a, p, ability) => !p.sabotageRestricted && g.galaxy.sabotageOff !== true && (p.currentCorruption ?? -1) !== -1 && canSabotageWith(g, a, p, ability) },
  { code: 3, text: 'TEXT_ABILITY_SLOT_SPY', names: 'Activated_System_Spy_Ability_Names', tag: 'SYSTEM_SPY_ABILITY', can: () => true },
  { code: 4, text: 'TEXT_ABILITY_SLOT_NEUTRALIZE_HERO', names: 'Activated_Neutralize_Hero_Ability_Names', tag: 'NEUTRALIZE_HERO_ABILITY', can: (g, a, p) => g.story?.canNeutralize?.(a, p) ?? true },
  { code: 5, text: 'TEXT_ABILITY_SLOT_SIPHON_CREDITS', names: 'Activated_Siphon_Credits_Ability_Names', tag: 'SIPHON_CREDITS_ABILITY', can: (g, a, p) => canSiphon(g, a, p) },
  { code: 7, text: 'TEXT_ABILITY_SLOT_CORRUPT_PLANET', names: 'Activated_Corrupt_Planet_Ability_Names', tag: 'CORRUPTION_ABILITY', can: (g, a, p) => canCorrupt(g, a, p) },
  { code: 8, text: 'TEXT_ABILITY_SLOT_REMOVE_CORRUPTION', names: 'Activated_Remove_Corruption_Ability_Names', tag: 'REMOVE_CORRUPTION_ABILITY', can: (g, a, p) => canRemove(g, a, p) },
  { code: 10, text: 'TEXT_ABILITY_SLOT_HACK_SUPER_WEAPON', names: 'Activated_Hack_Super_Weapon_Ability_Names', tag: 'HACK_SUPER_WEAPON_ABILITY', can: (g, a, p) => canHack(g, a, p) },
];

const friendly = (a, b) => same(a, b) || !!db.faction(a)?.list('Allies').some(n => same(n, b));

function canSiphon(game, actor, planet) {
  const owner = planet.politicalOwner ?? planet.owner, main = f => ['REBEL', 'EMPIRE', 'UNDERWORLD'].includes(key(f));
  return !!owner && main(owner) && main(actor.owner) && !same(owner, actor.owner) && !db.faction(actor.owner)?.list('Allies').some(n => same(n, owner)) && !planet.destroyed && !(planet.creditSiphonOwner && planet.creditSiphonOwner !== -1);
}

function abilitiesOf(record) {
  const type = record.carries || record.type, members = [type, ...[...type.list('Company_Units'), ...type.list('Squadron_Units')].map(n => db.type(n)).filter(Boolean)];
  return members.flatMap(t => t.sub('Abilities').flatMap(n => n.children));
}

export const isHero = record => { const t = record.carries || record.type, members = [t, ...t.list('Company_Units').map(n => db.type(n)).filter(Boolean)]; return members.some(m => m.bool('Is_Named_Hero') || m.bool('Is_Generic_Hero')); };

export function slotFor(game, record, planet, owner = record.owner) {
  if (!record || !planet || planet.abilitiesRestricted) return null;
  const actor = { owner, record, planet };
  const abilities = abilitiesOf(record).filter(a => yes(a.val('Initially_Enabled', 'Yes')));
  for (const slot of SLOTS) {
    if (slot.restrict && planet[slot.restrict]) continue;
    const names = list(slot.names);
    for (const a of abilities) {
      if (a.tag.toUpperCase() !== slot.tag || !names.includes(key(a.attrs?.Name))) continue;
      const style = key(a.val('Activation_Style', 'Ground_Activated'));
      if (style !== 'GROUND_ACTIVATED') continue;
      if (slot.can(game, actor, planet, a)) return { code: slot.code, text: slot.text, label: db.t(slot.text) };
    }
  }
  return null;
}

export { hasPlanetDestruction };

export function activateSlot(game, record, planet, owner = record.owner) {
  const story = game.story;
  if (!story) return false;
  const object = story.object(record, planet, owner).__object;
  return !!story.activate(object);
}
