import { db } from '../gamedata.js';
import { simRandom } from './simrandom.js';

const tables = new WeakMap();

function tableOf(t) {
  let table = tables.get(t);
  if (table) return table;
  const list = t.list('Destruction_Survivors'),
    rows = [];
  let total = 0;
  for (let i = 0; i + 1 < list.length; i += 2) {
    const kind = db.type(list[i]),
      chance = parseFloat(list[i + 1]);
    if (!(chance > 0)) continue;
    total += chance;
    if (kind) rows.push([kind, total]);
  }
  const lo = Math.max(0, Math.trunc(t.num('Minimum_Destruction_Survivor_Count', 1)));
  table = { rows, total, lo, hi: Math.max(lo, Math.trunc(t.num('Maximum_Destruction_Survivor_Count', lo))) };
  tables.set(t, table);
  return table;
}

export function survivorPicks(t) {
  if (!t || typeof t.list !== 'function') return [];
  const T = tableOf(t);
  if (!T.rows.length) return [];
  const out = [],
    count = T.lo + Math.floor(simRandom() * (T.hi - T.lo + 1));
  for (let k = 0; k < count; k++) {
    const r = simRandom();
    if (r > T.total) continue;
    out.push((T.rows.find(([, at]) => r <= at) || T.rows[T.rows.length - 1])[0]);
  }
  return out;
}
