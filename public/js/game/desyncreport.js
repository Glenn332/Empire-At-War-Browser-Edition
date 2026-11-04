const F64 = new Float64Array(1),
  U32 = new Uint32Array(F64.buffer);

export function unitHash(values) {
  let g = 0x811c9dc5 | 0;
  for (const v of values) {
    F64[0] = v || 0;
    g = Math.imul(g ^ U32[0], 0x01000193);
    g = Math.imul(g ^ U32[1], 0x01000193);
  }
  return g >>> 0;
}

const FIELDS = ['x', 'y', 'z', 'heading', 'speed', 'health', 'shield'];
const SKIP = new Set(['camera', 'groups', 'selection', 'name', 'saved', 'multiplayer', 'view', 'summary', 'speed']);
const MAX = 40;

export function unitDetail(world) {
  const out = [];
  const add = (u, squad, i) => {
    const o = u.order;
    out.push([
      u.id ?? (squad ? 's' : 'u') + i,
      u.type?.name || '',
      u.player?.id ?? u.side ?? -1,
      u.dead ? 1 : 0,
      ...FIELDS.map(k => (typeof u[k] === 'number' ? u[k] : null)),
      o?.kind || '',
      o && typeof o.x === 'number' ? o.x : null,
      o && typeof o.y === 'number' ? o.y : null,
      u.target ? (u.target.id ?? 'set') : null,
      squad ? 1 : 0
    ]);
  };
  (world.units || []).forEach((u, i) => add(u, false, i));
  (world.squads || []).forEach((s, i) => {
    if (!s.dead) add(s, true, i);
  });
  return out;
}

const COLS = ['dead', ...FIELDS, 'order', 'order x', 'order y', 'target', 'squad'];

const show = v => {
  if (v === undefined) return 'missing';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(12));
  const s = JSON.stringify(v);
  return s && s.length > 80 ? s.slice(0, 77) + '...' : s;
};

function diffTree(a, b, path, out, label) {
  if (out.length >= MAX || a === b) return;
  const objA = a !== null && typeof a === 'object',
    objB = b !== null && typeof b === 'object';
  if (!objA || !objB || Array.isArray(a) !== Array.isArray(b)) {
    if (Number.isNaN(a) && Number.isNaN(b)) return;
    out.push(`${path}: ${show(a)} / ${show(b)}`);
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${path}: ${a.length} entries / ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length) && out.length < MAX; i++)
      diffTree(a[i], b[i], `${path}[${label ? label(a[i], i) : i}]`, out, null);
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (SKIP.has(k)) continue;
    diffTree(a[k], b[k], path ? path + '.' + k : k, out, k === 'entities' ? (e, i) => `${i} ${e?.type || 'squadron'}` : null);
  }
}

function units(rows) {
  const m = new Map();
  for (const r of rows || []) m.set(r[0], r);
  return m;
}

function sameList(a, b, key) {
  a = a || [];
  b = b || [];
  const from = Math.max(a.length ? key(a[0]) : 0, b.length ? key(b[0]) : 0);
  const A = a.filter(x => key(x) >= from),
    B = b.filter(x => key(x) >= from);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = JSON.stringify(A[i]),
      y = JSON.stringify(B[i]);
    if (x !== y) return { i, x: A[i], y: B[i], from };
  }
  return null;
}

export function compareReports(mine, theirs, who) {
  const L = [];
  L.push(
    `[desync report] host / ${who}: the state check at turn ${mine.bad} differed; both sides recorded at turn ${mine.at}${
      mine.at !== theirs.at ? ` (${who} at turn ${theirs.at}!)` : ''
    }`
  );
  const r1 = mine.rng,
    r2 = theirs.rng;
  if (r1 && r2) {
    const same = JSON.stringify(r1.state) === JSON.stringify(r2.state);
    L.push(
      `random numbers drawn since the battle started: ${r1.draws} / ${r2.draws}${
        r1.draws !== r2.draws ? ` (${who} drew ${r2.draws - r1.draws > 0 ? '+' : ''}${r2.draws - r1.draws}: code ran on one side only)` : ''
      }; generator ${same ? 'the same' : 'different'}`
    );
  }
  const k1 = mine.record,
    k2 = theirs.record;
  if (k1 && k2) {
    const a = new Map(k1.ids.map((id, i) => [id, k1.hs[i]])),
      b = new Map(k2.ids.map((id, i) => [id, k2.hs[i]]));
    const d1 = units(mine.units);
    const name = id => {
      const r = d1.get(id);
      return r ? `#${id} ${r[1]} (player ${r[2]})` : `#${id}`;
    };
    const apart = [...a.keys()].filter(id => b.has(id) && a.get(id) !== b.get(id)),
      onlyA = [...a.keys()].filter(id => !b.has(id)),
      onlyB = [...b.keys()].filter(id => !a.has(id));
    L.push(
      `units at the check (turn ${mine.bad}): ${a.size} / ${b.size}, ${apart.length} differ` +
        (apart.length ? ': ' + apart.slice(0, 12).map(name).join(', ') + (apart.length > 12 ? ', ...' : '') : '') +
        (onlyA.length ? `; only on the host: ${onlyA.slice(0, 8).map(name).join(', ')}` : '') +
        (onlyB.length ? `; only on ${who}: ${onlyB.slice(0, 8).join(', ')}` : '')
    );
  } else L.push('units at the check: no record (the check turn was too long ago)');
  const u1 = units(mine.units),
    u2 = units(theirs.units);
  const lines = [];
  let count = 0;
  for (const [id, a] of u1) {
    const b = u2.get(id);
    if (!b) {
      count++;
      if (lines.length < 20) lines.push(`  #${id} ${a[1]} (player ${a[2]}) only on the host`);
      continue;
    }
    const diffs = [];
    for (let i = 3; i < a.length; i++) if (a[i] !== b[i]) diffs.push(`${COLS[i - 3]} ${show(a[i])} / ${show(b[i])}`);
    if (a[1] !== b[1] || a[2] !== b[2]) diffs.unshift(`type/player ${a[1]} ${a[2]} / ${b[1]} ${b[2]}`);
    if (!diffs.length) continue;
    count++;
    if (lines.length < 20) lines.push(`  #${id} ${a[1]} (player ${a[2]}): ${diffs.join(', ')}`);
  }
  for (const [id, b] of u2)
    if (!u1.has(id)) {
      count++;
      if (lines.length < 20) lines.push(`  #${id} ${b[1]} (player ${b[2]}) only on ${who}`);
    }
  L.push(`units at turn ${mine.at}, full precision: ${count} of ${u1.size} differ${count ? ':' : ''}`, ...lines);
  const o = sameList(mine.orders, theirs.orders, x => x[0]);
  L.push(
    o
      ? `orders: first difference at turn ${(o.x || o.y)[0]}: ${show(o.x)} / ${show(o.y)} (lockstep delivered different orders)`
      : `orders: the same (${(mine.orders || []).length} in the last turns)`
  );
  if (mine.routes || theirs.routes) {
    const r = sameList(mine.routes, theirs.routes, x => x[0]);
    L.push(
      r
        ? `routes: first difference at step ${(r.x || r.y)[0]}: ${show(r.x)} / ${show(r.y)}`
        : `routes: the same (${(mine.routes || []).length} answers in the last steps)`
    );
  }
  if (mine.save && theirs.save) {
    const out = [];
    diffTree(mine.save.battle || mine.save, theirs.save.battle || theirs.save, '', out, null);
    L.push(`saved battle state: ${out.length ? out.length + (out.length >= MAX ? '+' : '') + ' differences' : 'the same'}`);
    for (const d of out) L.push('  ' + d);
  } else L.push('saved battle state: not taken on ' + (mine.save ? who : 'the host'));
  return L.join('\n');
}
