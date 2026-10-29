import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
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
const { spaceRosters, landRosters, resolveTactical } = await import('../public/js/game/tacticalautoresolve.js');
const { packContrast, unpackContrast } = await import('../public/js/game/galacticautoresolve.js');
const { strategicPower } = await import('../public/js/game/galacticforces.js');

const t0 = [...db.types.values()].find(t => strategicPower(t) > 0);
const table = new Map([['CAPITAL', { types: new Map([[t0, 1.5]]), kinds: new Map([['FIGHTER', 0.5]]) }]]);
const back = unpackContrast(JSON.parse(JSON.stringify(packContrast(table))));
assert.equal(back.get('CAPITAL').types.get(t0), 1.5);
assert.equal(back.get('CAPITAL').kinds.get('FIGHTER'), 0.5);
assert.deepEqual(packContrast(null), []);
assert.equal(unpackContrast(undefined).size, 0);

const strong = [...db.types.values()]
  .filter(t => (strategicPower(t) > 0 && t.tag.toLowerCase() === 'spaceunit') || (strategicPower(t) > 0 && t.categories().has('CAPITAL')))
  .slice(0, 6);
assert(strong.length >= 3, 'ships with power exist');
const team = [{ id: 0 }, { id: 1 }],
  player = (i, faction) => ({ id: i, team: team[i], factionName: faction });
const units = [];
const add = (n, type, p) => {
  for (let i = 0; i < n; i++) units.push({ type, player: p, dead: false });
};
const empire = player(0, 'Empire'),
  rebel = player(1, 'Rebel');
add(8, strong[0], empire);
add(2, strong[0], rebel);
const world = { teams: team, units };
const campaign = { attacker: { team: 0 }, defender: { team: 1 }, autoResolve: { allowed: true, contrast: [] } };
const rosters = spaceRosters(world, campaign);
assert.equal(rosters[0].length, 8);
assert.equal(rosters[1].length, 2);
assert.equal(rosters[0][0].entity, units[0]);
const res = resolveTactical(rosters, campaign, { space: true, random: () => 0.5 });
assert.equal(res.winner, 0, 'the larger force wins');
assert(
  res.doomed.every(e => units.includes(e)),
  'the doomed are battlefield entities'
);
assert(res.doomed.filter(e => e.player === rebel).length >= 1, 'the loser takes losses');
units[0].dead = true;
units[1].isPad = true;
units[2].underConstruction = true;
assert.equal(spaceRosters(world, campaign)[0].length, 5);
const land = {
  units: [
    { type: strong[0], side: 0, dead: false },
    { type: strong[0], side: 0, dead: false, structure: true },
    { type: strong[0], side: 1, dead: false }
  ]
};
const lr = landRosters(land, ['Empire', 'Rebel'], [0, 1]);
assert.deepEqual(
  lr.map(r => r.length),
  [1, 1]
);
console.log('ok, multiplier', db.constants.num('Auto_Resolve_Tactical_Multiplier', 1));
