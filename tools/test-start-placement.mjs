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
const { placeStartingForce } = await import('../public/js/game/galaxy.js');
const { strategicStealth } = await import('../public/js/game/galacticfog.js');
const company = [...db.types.values()].find(
  t =>
    t.list('Company_Units').some(n => db.type(n)?.bool('Always_Spawn_In_Orbit')) &&
    db.type(t.list('Company_Transport_Unit')[0]) &&
    !strategicStealth({ type: t })
);
const [A, B] = [...db.factions.values()].filter(f => f.bool('Is_Playable')).map(f => f.name);
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet' && t.bool('Planet_Surface_Accessible', true));
const ship = [...db.types.values()].find(t => t.tag === 'SpaceUnit' && t.num('Build_Cost_Credits', 0) > 0);
const make = () => ({ index: 0, type: planetType, owner: A, garrison: [], groundStructures: [], orbitalStructures: [] });
if (company) {
  let p = make(),
    fleets = [];
  placeStartingForce(p, A, company, fleets);
  assert.equal(p.garrison.length, 0, 'Always_Spawn_In_Orbit keeps the company in orbit');
  p = make();
  fleets = [{ owner: B, planet: 0, units: [{ type: ship }], leg: null }];
  placeStartingForce(p, A, company, fleets);
  assert.equal(p.garrison.length, 1, 'a visible enemy in orbit makes it land');
}
{
  const p = make(),
    infantry = [...db.types.values()].find(t => t.list('Company_Units').length && !t.list('Company_Units').some(n => db.type(n)?.bool('Always_Spawn_In_Orbit')));
  const max = db.constants.num('Max_Ground_Forces_On_Planet', 10);
  for (let i = 0; i < max; i++) p.garrison.push({ type: infantry, owner: A, stealth: true });
  placeStartingForce(p, A, infantry, []);
  assert.equal(p.garrison.length, max + 1, 'stealthed companies do not take a surface place');
}
console.log('ok', company?.name);
