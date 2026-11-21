import { db } from '../gamedata.js';

const known = id => !!id && db.text.has(id.trim().toUpperCase());

export function abilityText(ability, kind, fallback) {
  const pick = (field, suffix) => {
    const own = (ability?.val(field) || '').trim().split(/\s+/)[0];
    if (known(own)) return db.t(own);
    const id = `TEXT_TOOLTIP_ABILITY_${kind}_${suffix}`;
    return known(id) ? db.t(id) : '';
  };
  const name = pick('Alternate_Name_Text', 'NAME') || fallback;
  return { label: name.charAt(0).toUpperCase() + name.slice(1), description: pick('Alternate_Description_Text', 'DESCRIPTION') };
}
