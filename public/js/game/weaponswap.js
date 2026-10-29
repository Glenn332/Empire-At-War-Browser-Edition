import { abilityLocked } from './blackmarket.js';

const yes = s => /^(yes|true|1)$/i.test(String(s || '').trim());

export function swapMode(type) {
  if (type._swap === undefined) {
    const kinds = [];
    for (const block of type.sub ? type.sub('Unit_Abilities_Data') : []) for (const ab of block.all('Unit_Ability')) kinds.push(ab.val('Type').trim().toUpperCase());
    type._swap = type.list('Projectile_Types').length > 1 || kinds.slice(0, 2).includes('SWAP_WEAPONS');
  }
  return type._swap;
}

export function fireNum(type, proj, tag, dflt) {
  return swapMode(type) && proj && proj.has(tag) ? proj.num(tag, dflt) : type.num(tag, dflt);
}

export function startingWeapon(type, campaign, bought) {
  for (const block of type.sub ? type.sub('Abilities') : []) for (const a of block.all('Permanent_Weapon_Swap_Ability')) {
    const enabled = a.val('Initially_Enabled');
    if (enabled.trim() && !yes(enabled)) continue;
    if (abilityLocked(campaign, { mustBuy: yes(a.val('Must_Be_Bought_On_Black_Market')), gui: a.attrs.Name || '' }, bought)) continue;
    return Math.max(0, Math.floor(a.num('Weapon_Index', 0)));
  }
  return 0;
}

export function fireSound(type, proj) {
  return (type.list('Projectile_Types').length > 1 && proj && proj.str('SFXEvent_Fire')) || type.str('SFXEvent_Fire');
}

export function thrownReach(proj) {
  if (!proj || !/^GRENADE$/i.test(proj.str('Projectile_Category').trim())) return null;
  const g = proj.num('Projectile_Grenade_Gravity', 0) * proj.num('Projectile_Grenade_Gravity_Lob_Mod', 1), v = proj.num('Max_Speed', 0);
  return g > 0 && v > 0 ? v * v / g : null;
}

export const fixedMuzzle = (i, weapons, muzzles) => (weapons > 1 && muzzles >= 2 ? i : -1);

export const swapped = (index, count) => (count > 1 ? (index ? 0 : 1) : index);
