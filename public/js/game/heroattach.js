import { db } from '../gamedata.js';
import { fetchText } from '../vfs.js';

const limits = new Map();
const scriptOf = type => {
  const own = type.str('Lua_Script').trim();
  if (own) return own;
  for (const n of type.list('Company_Units')) {
    const s = db.type(n)?.str('Lua_Script').trim();
    if (s) return s;
  }
  return '';
};
const isHero = t => t.bool('Is_Named_Hero') || t.bool('Is_Generic_Hero') || t.list('Company_Units').some(n => db.type(n)?.bool('Is_Named_Hero') || db.type(n)?.bool('Is_Generic_Hero'));

export async function loadHeroAttach() {
  const files = new Map();
  for (const t of db.types.values()) {
    if (!isHero(t)) continue;
    const name = scriptOf(t);
    if (!name) continue;
    (files.get(name.toUpperCase()) || files.set(name.toUpperCase(), []).get(name.toUpperCase())).push(t);
  }
  await Promise.all(
    [...files].map(async ([name, types]) => {
      const text = await fetchText('Data/Scripts/GameObject/' + name + '.lua').catch(() => '');
      if (!text) return;
      const read = tag => {
        const m = new RegExp('^\s*' + tag + '\s*=\s*(-?[\d.]+)', 'm').exec(text);
        return m ? +m[1] : 0;
      };
      const limit = { min: read('MinPlanAttachCost'), max: read('MaxPlanAttachCost') };
      for (const t of types) limits.set(t, limit);
    })
  );
}

export function heroAttachRefused(type, planCost) {
  const limit = limits.get(type);
  if (!limit) return false;
  return (limit.min > 0 && planCost < limit.min) || (limit.max > 0 && planCost > limit.max);
}
