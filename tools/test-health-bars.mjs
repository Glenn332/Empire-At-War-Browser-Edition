import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
import { spaceBarWidth, landBarWidth } from '../public/js/game/healthbars.js';

// Plain ships keep the size-driven bar they always had.
for (const r of [0, 10, 40, 79, 80, 200, 260]) assert.equal(spaceBarWidth(r), Math.max(26, Math.min(120, r * 1.5)));
// A hero cruiser carries an icon, but its bar still follows the hull.
assert.equal(spaceBarWidth(90, 22), spaceBarWidth(90), 'a hero cruiser gets the same bar as a plain cruiser of that size');
assert.equal(spaceBarWidth(260, 22), 120);
assert.equal(spaceBarWidth(5, 40), 40, 'a small hero ship is never narrower than its icon bar');
// Squadrons stay with the icon-wide bar.
assert.equal(spaceBarWidth(260, 22, true), 22);
assert.equal(spaceBarWidth(60, 0, true), 90);

const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();

// Every hardpoint a space type lists must be registered, and a variant that names
// none of its own must still see the list of the type it is a variant of.
let heroes = 0;
for (const t of db.types.values()) {
  if (!t.str('Space_Model_Name')) continue;
  const names = t.list('HardPoints');
  for (const n of names) assert.ok(db.hardpoint(n), `${t.name}: hardpoint ${n} is registered`);
  if (t.parent && !t.props.has('hardpoints')) assert.deepEqual(names, t.parent.list('HardPoints'), `${t.name} inherits its hardpoints`);
  if (!(t.bool('Is_Named_Hero') || t.bool('Is_Generic_Hero') || t.bool('Show_Hero_Head'))) continue;
  if (!t.list('CategoryMask').some(c => /^(Corvette|Frigate|Capital)$/i.test(c))) continue;
  heroes++;
  assert.ok(names.length > 0, `${t.name} has hardpoints`);
}
assert.ok(heroes > 0, 'the data has hero cruisers');

// Land: the biggest walkers get the wide bar, everything else keeps its old one.
const unit = name => {
  const type = db.type(name);
  assert.ok(type, name);
  return { type, maxHealth: type.num('Tactical_Health', 0) };
};
assert.equal(landBarWidth(unit('AT_AT_Walker')), 70);
if (db.type('Veers_AT_AT_Walker')) assert.equal(landBarWidth(unit('Veers_AT_AT_Walker')), 70);
assert.equal(landBarWidth(unit('AT_ST_Walker')), 44);
assert.equal(landBarWidth(unit('Stormtrooper')), 22);
assert.equal(landBarWidth({ structure: {}, maxHealth: 10 }), 70);
assert.equal(landBarWidth({ maxHealth: 200 }), 44);
console.log('health bars ok');
