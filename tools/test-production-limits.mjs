import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { currentCount } = await import('../public/js/game/galacticproduction.js');
const company = [...db.types.values()].find(t => t.list('Company_Units').length >= 1 && db.type(t.list('Company_Units')[0]));
const member = db.type(company.list('Company_Units')[0]);
const owner = 'Empire';
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet');
const planet = extra => ({ index: 0, type: planetType, owner, garrison: [], groundStructures: [], orbitalStructures: [], station: null, ...extra });
const g = (planets, fleets = []) => ({ planets, fleets });
assert.equal(currentCount(g([planet()]), owner, company, null), 0);
assert.equal(currentCount(g([planet({ garrison: [{ type: company, owner }] })]), owner, company, null), 1, 'the company itself');
assert.equal(
  currentCount(g([planet({ garrison: [{ type: member, owner }, { type: member, owner }] })]), owner, company, null),
  2,
  'what is held of a Company_Units member counts for the company, as the engine adds the largest member count'
);
assert.equal(
  currentCount(g([planet({ garrison: [{ type: company, owner }, { type: member, owner }] })]), owner, company, null),
  2,
  'own plus the largest related count'
);
assert.equal(currentCount(g([planet({ garrison: [{ type: member, owner: 'Rebel' }] })]), owner, company, null), 0, 'only the player own');
console.log('ok', company.name, member.name);
