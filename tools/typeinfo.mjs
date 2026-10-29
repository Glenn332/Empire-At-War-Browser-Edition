const base = process.env.SWR_URL || 'http://localhost:8377/';
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(/^https?:/.test(u) ? u : base + String(u).replace(/^\//, ''), o);
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const rx = new RegExp(process.argv[3] || '.', 'i');
for (let t = db.type(process.argv[2]), d = 0; t; t = t.parent, d++) {
  console.log(`${'#'.repeat(d + 1)} ${t.tag} ${t.name}`);
  for (const [k, v] of t.props) if (rx.test(k)) console.log(`  ${k}: ${v.join(' || ').replace(/\s+/g, ' ').slice(0, 220)}`);
  for (const [k, v] of t.subs) if (rx.test(k)) console.log(`  [${k}] x${v.length}: ${v.map(n => n.children.map(c => c.attrs.Name || c.val('Type') || c.tag).join(',')).join(' | ').slice(0, 300)}`);
}
