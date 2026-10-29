import { fetchText } from '../vfs.js';
import { parseXML } from '../xml.js';

const sets = new Map();

export async function loadPrioritySets() {
  const dir = 'Data/XML/';
  const index = parseXML(await fetchText(dir + 'TargetingPrioritySetFiles.xml'));
  const files = [];
  const walk = n => { if (n.tag.toLowerCase() === 'file') files.push(n.text.trim()); n.children.forEach(walk); };
  walk(index);
  for (const f of files) {
    let root;
    try { root = parseXML(await fetchText(dir + f)); } catch { continue; }
    const each = n => {
      if (n.tag.toLowerCase() === 'priority_set' && n.attrs.Name) {
        const rank = new Map();
        const toks = n.val('Attack_Priorities').split(/[,\s]+/).filter(Boolean);
        for (let i = 0; i + 1 < toks.length; i += 2) { const v = parseFloat(toks[i + 1]); if (Number.isFinite(v)) rank.set(toks[i].toUpperCase(), v); }
        const names = k => n.val(k).split(/[,\s|]+/).filter(Boolean).map(s => s.toUpperCase());
        const never = new Set(names('Unit_Exclusions'));
        sets.set(n.attrs.Name.toUpperCase(), { rank, never, noCats: names('Category_Exclusions'), noProps: names('Property_Exclusions'),
          hardPoints: names('Hard_Point_Priorities').map(s => s.replace(/^HARD_POINT_/, '')), noHardPoints: new Set(names('Hard_Point_Exclusions').map(s => s.replace(/^HARD_POINT_/, ''))) });
      }
      n.children.forEach(each);
    };
    each(root);
  }
  return sets.size;
}

export function namedSet(name) { return sets.get(String(name || '').trim().toUpperCase()) || null; }

export function setOf(u) { return u.prioSet || prioritySet(u.type); }

export function prioritySet(type) {
  if (type._prio === undefined) type._prio = sets.get(type.str('Targeting_Priority_Set').toUpperCase()) || null;
  return type._prio;
}

export function priorityOf(set, targetType) {
  let memo = set.memo || (set.memo = new Map()), r = memo.get(targetType);
  if (r !== undefined) return r;
  const name = targetType.name.toUpperCase(), cats = targetType.categories();
  const props = (targetType._props ||= new Set(targetType.str('Property_Flags').split('|').map(x => x.trim().toUpperCase()).filter(Boolean)));
  if (set.never.has(name) || (set.noCats || []).some(c => cats.has(c)) || (set.noProps || []).some(p => props.has(p))) r = -1;
  else if (set.rank.has(name)) r = set.rank.get(name);
  else {
    r = Infinity;
    for (const c of cats) { const v = set.rank.get(c); if (v !== undefined && v < r) r = v; }
    if (r === Infinity) for (const p of props) { const v = set.rank.get(p); if (v !== undefined && v < r) r = v; }
  }
  memo.set(targetType, r);
  return r;
}
