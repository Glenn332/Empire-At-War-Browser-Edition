import { parseALO } from '../public/js/alo.js';
const base = process.env.SWR_URL || 'http://localhost:8377/';
const rx = new RegExp(process.argv[2] || '.', 'i');
const xml = await (await fetch(base + 'asset/Data/XML/CommandBarComponents.xml')).text();
const shells = [...xml.matchAll(/<CommandBarComponent Name="([^"]+)">([\s\S]*?)<\/CommandBarComponent>/g)]
  .map(m => ({ name: m[1], model: (m[2].match(/<Model_Name>\s*([^<\s]+)/) || [])[1] }))
  .filter(s => s.model);
const seen = new Set();
for (const s of shells) {
  const key = s.model.toUpperCase();
  if (seen.has(key)) continue;
  seen.add(key);
  let m;
  try {
    m = parseALO(await (await fetch(`${base}asset/Data/Art/Models/${s.model}`)).arrayBuffer());
  } catch {
    console.log(s.name, s.model, '(not readable)');
    continue;
  }
  const names = m.meshes.map(x => x.name);
  const hit = rx.test(s.name) || rx.test(s.model) ? names : names.filter(n => rx.test(n));
  if (!hit.length) continue;
  console.log(`${s.name}  ${s.model}  ${names.length} meshes`);
  if (process.argv[2]) console.log('   ' + hit.join(' '));
}
