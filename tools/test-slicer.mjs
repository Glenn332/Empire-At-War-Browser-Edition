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
const S = await import('../public/js/game/galacticslicer.js');
const hero = [...db.types.values()].find(t => t.sub('Abilities').some(n => n.children.some(a => a.tag.toUpperCase() === 'SLICER_ABILITY')));
if (!hero) {
  console.log('no slicer in this data: skipped');
  process.exit(0);
}
const ability = hero
  .sub('Abilities')
  .flatMap(n => n.children)
  .find(a => a.tag.toUpperCase() === 'SLICER_ABILITY');
const owner = hero.list('Affiliation')[0];
const enemy = [...db.factions.values()].find(
  f =>
    f.name !== owner &&
    ['REBEL', 'EMPIRE', 'UNDERWORLD'].includes(f.name.toUpperCase()) &&
    !db.faction(owner).list('Allies').includes(f.name)
).name;

const c = S.curve('0,1.75, 1,1.5, 2,1.25, 3,1.0, 4,0.75, 5,0.5');
assert.equal(c(0), 1.75);
assert.equal(c(3), 1);
assert.equal(c(2.5), 1.125);
assert.equal(c(9), 0.5);
assert.equal(c(-1), 1.75);

const player = { faction: owner, ai: 'Easy', credits: 10000, tech: 2, maxTech: 5, unlockedTypes: [], lockedTypes: [] };
const g = { players: [player], planets: [], fleets: [], routes: [], time: 0 };
const pool = S.pool(g, player);
assert(
  pool.length > 0 &&
    pool.every(t => t.bool('Build_Can_Be_Unlocked_By_Slicer') && t.bool('Build_Initially_Locked') && t.num('Tech_Level', 0) <= 2),
  'what the slicer can unlock'
);
player.unlockedTypes.push(pool[0].name);
assert(!S.pool(g, player).includes(pool[0]), 'an unlocked type leaves the pool');
player.unlockedTypes.length = 0;
player.lockedTypes.push(pool[0].name);
assert(!S.pool(g, player).includes(pool[0]), 'a type the story locked is not offered');
player.lockedTypes.length = 0;

const planetType = [...db.types.values()].find(
  t => t.tag.toLowerCase() === 'planet' && t.list('Planet_Slice_Affinity_Types').some(n => pool.some(p => p.name === n))
);
const liked = pool.find(p => planetType.list('Planet_Slice_Affinity_Types').includes(p.name)),
  plain = pool.find(p => !planetType.list('Planet_Slice_Affinity_Types').includes(p.name) && p.num('Slice_Cost_Credits', 0) > 0);
const planet = { type: planetType, owner: enemy, index: 0, name: planetType.name, garrison: [], killedHeroes: [] };
const rows = S.options({}, owner, planet, ability, [liked, plain]);
const mult = S.curve(ability.val('Cost_Multiplier_By_Planet_Tech_Availability'), [
  [0, 1],
  [5, 1]
])(planetType.num('Planet_Tech_Availability_Rating', 0));
assert(
  Math.abs(rows[1].cost - mult * plain.num('Slice_Cost_Credits', 0)) < 1e-6,
  'the cost: the curve at the planet rating times the type cost'
);
assert(
  Math.abs(rows[0].cost - (mult + ability.num('Cost_Affinity_Modifier', 0)) * liked.num('Slice_Cost_Credits', 0)) < 1e-6,
  'an affinity type costs less'
);
assert(rows.every(r => r.chance >= 0 && r.chance <= 1));
assert.equal(rows[1].chance, 1, 'in the data the chance is one');

const world = () => {
  const p = { ...player, unlockedTypes: [], credits: 10000, tech: 2 },
    despawned = [];
  return {
    p,
    despawned,
    game: {
      galaxy: { players: [p], planets: [{ ...planet, killedHeroes: [] }], fleets: [], routes: [], time: 0 },
      me: 'Nobody',
      audio: { play() {} },
      story: { despawn: o => despawned.push(o) }
    }
  };
};
const actor = { owner, record: { type: hero, owner }, dead: false };
{
  const { p, game, despawned } = world(),
    pl = game.galaxy.planets[0],
    row = { type: plain, cost: 900, chance: 1 };
  assert.equal(S.executeSlice(game, actor, pl, row, false, 60), true);
  assert.equal(p.credits, 9100);
  assert(p.unlockedTypes.includes(plain.name), 'unlocked');
  assert.equal(p.tech, 2, 'a list of several does not raise the level');
  assert.equal(despawned.length, 1);
  assert.equal(pl.killedHeroes[0].dueFrame, 60 * 30, 'queued to come back after the rolled time');
}
{
  const { p, game } = world(),
    pl = game.galaxy.planets[0];
  S.executeSlice(game, actor, pl, { type: plain, cost: 100, chance: 1 }, true, 60);
  assert.equal(p.tech, 3, 'the only choice raises the tech level');
}
{
  for (const [k, credits, due] of [
    [0, 10000, 120],
    [0.4, 10000, 60],
    [0.9, 9900, 60]
  ]) {
    const { p, game, despawned } = world(),
      pl = game.galaxy.planets[0],
      seq = [0.999, k];
    assert.equal(
      S.executeSlice(game, actor, pl, { type: plain, cost: 100, chance: 0.5 }, false, 60, () => seq.shift() ?? 0),
      false
    );
    assert.equal(p.credits, credits);
    assert(!p.unlockedTypes.length);
    assert.equal(despawned.length, 1);
    assert.equal(pl.killedHeroes[0].dueFrame, due * 30);
  }
  const { game } = world();
  assert.equal(
    S.executeSlice(game, actor, game.galaxy.planets[0], { type: plain, cost: 99999, chance: 1 }, false, 60),
    false,
    'too dear at execution: nothing happens'
  );
}
{
  const { p, game } = world(),
    pl = game.galaxy.planets[0];
  pl.owner = enemy;
  p.credits = 0;
  assert.equal(S.activateSlicer(game, { ...actor, planet: pl }, pl, ability), false, 'nothing it can pay for');
  p.credits = 1e6;
  assert.equal(S.activateSlicer(game, { ...actor, planet: pl }, pl, ability), true);
  assert.equal(p.unlockedTypes.length, 1);
  pl.owner = owner;
  p.unlockedTypes.length = 0;
  assert.equal(S.activateSlicer(game, { ...actor, planet: pl }, pl, ability), false, 'not on its own planet');
  const rolls = [0, 1, 2, 3, 4, 5, 6].map(t => S.respawnRoll({ tech: t }, ability, () => 0.5));
  assert(rolls[0] > 0 && rolls[5] === 0, 'out of range: the default time');
}
console.log('ok', hero.name, owner, 'against', enemy, pool.length, 'in the pool');
