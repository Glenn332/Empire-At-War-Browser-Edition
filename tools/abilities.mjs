const base = process.env.SWR_URL || 'http://localhost:8377/';
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(/^https?:/.test(u) ? u : base + String(u).replace(/^\//, ''), o);
const { db, loadGameData } = await import('../public/js/gamedata.js');
const { buildListFor } = await import('../public/js/game/sim.js');
await loadGameData();
const only = (process.argv[2] || '').toUpperCase();
const seen = new Map();
const dump = (n, d = 0) =>
  n.children.length
    ? `${'  '.repeat(d)}<${n.tag}${n.attrs.Name ? ' ' + n.attrs.Name : ''}>\n` + n.children.map(c => dump(c, d + 1)).join('')
    : n.text.trim()
      ? `${'  '.repeat(d)}${n.tag}: ${n.text.trim().replace(/\s+/g, ' ')}\n`
      : '';
for (const f of ['Empire', 'Rebel', 'Underworld'])
  for (let l = 1; l <= 5; l++) {
    for (const t of buildListFor(db.type(`Skirmish_${f}_Star_Base_${l}`), f)) {
      const types = [
        t,
        ...['Squadron_Units', 'Company_Units', 'Company_Transport_Unit'].flatMap(k =>
          t
            .list(k)
            .map(n => db.type(n))
            .filter(Boolean)
        )
      ];
      for (const x of [...types])
        for (const n of x.list('Squadron_Units')) {
          const y = db.type(n);
          if (y && !types.includes(y)) types.push(y);
        }
      for (const tt of types) {
        if (!tt.has('Space_Model_Name') && !tt.has('Squadron_Units')) continue;
        for (const b of tt.sub('Unit_Abilities_Data'))
          for (const ab of b.all('Unit_Ability')) {
            const kind = ab.val('Type').toUpperCase();
            if (!seen.has(kind)) seen.set(kind, []);
            seen.get(kind).push({ unit: tt.name, ab, type: tt });
          }
      }
    }
  }
for (const [kind, list] of [...seen].sort()) {
  if (only && kind !== only) continue;
  const units = [...new Set(list.map(x => x.unit))];
  console.log(`\n=== ${kind}  (${units.join(', ')})`);
  const x = list[0];
  console.log(dump(x.ab, 1).replace(/^.*SFXEvent.*\n/gm, ''));
  const named = x.ab.val('GUI_Activated_Ability_Name');
  for (const blk of x.type.sub('Abilities'))
    for (const a of blk.children) {
      if (!named || a.attrs.Name === named || only) console.log(dump(a, 1).replace(/^.*(SFXEvent|Light_Effect|Particle).*\n/gm, ''));
    }
}
