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
const { stepDetection } = await import('../public/js/game/galacticdetect.js');
const [A, B] = [...db.factions.values()].filter(f => f.bool('Is_Playable')).map(f => f.name);

const ability = (tag, vals) => ({
  tag,
  attrs: { Name: tag + '_X' },
  val: (k, d = '') => (k in vals ? String(vals[k]) : d),
  num: (k, d) => (k in vals ? +vals[k] : d)
});
const hero = (name, flags, list) => ({
  name,
  bool: (k, d = false) => (k in flags ? flags[k] : d),
  num: (k, d) => d,
  str: () => '',
  list: () => [],
  sub: k => (k === 'Abilities' ? [{ children: list, all: tag => list.filter(a => a.tag.toUpperCase() === tag.toUpperCase()) }] : [])
});
const detector = hero('Hunter', { Is_Generic_Hero: true }, [
  ability('Detect_Hero_Ability', {
    Initially_Enabled: 'Yes',
    Activation_Style: 'Galactic_Automatic',
    Detect_Interval_In_Seconds: 5,
    Detection_Chance: 1,
    Detect_Credit_Siphon_Effects: 'Yes'
  }),
  ability('Eliminate_Hero_Ability', { Initially_Enabled: 'Yes', Activation_Style: 'Hero_Detected' })
]);
const spy = (named, evadeChance = 0) =>
  hero('Spy', { Is_Generic_Hero: !named, Is_Named_Hero: named }, [
    ability('Galactic_Stealth_Ability', { Initially_Enabled: 'Yes', Evade_Detection_Chance: evadeChance })
  ]);
const planetType = [...db.types.values()].find(t => t.tag.toLowerCase() === 'planet');
const world = (targets, extra = {}) => {
  const p = { index: 0, type: planetType, owner: A, garrison: [{ type: detector, owner: A }, ...targets], groundStructures: [], orbitalStructures: [], creditSiphonOwner: -1, ...extra };
  const respawned = [];
  return {
    p,
    respawned,
    game: { galaxy: { time: 0, planets: [p], fleets: [], players: [{ faction: A }, { faction: B }] }, story: null, me: A },
    queue: respawned
  };
};
{
  const target = { type: spy(false), owner: B },
    w = world([target]);
  stepDetection(w.game);
  assert.equal(w.p.garrison.length, 2, 'nothing before the first interval has passed');
  w.game.galaxy.time = 5;
  stepDetection(w.game);
  assert(target.dead && w.p.garrison.length === 1, 'a stealthed enemy hero is detected and eliminated');
  assert(w.p.killedHeroes?.length || target.dead, 'it is queued to return');
}
{
  const target = { type: spy(false, 1), owner: B },
    w = world([target]);
  w.game.galaxy.time = 5;
  stepDetection(w.game);
  w.game.galaxy.time = 10;
  stepDetection(w.game);
  assert(!target.dead, 'an evade chance of 1 always slips away');
}
{
  const target = { type: spy(true, 1), owner: B },
    w = world([target]);
  w.game.galaxy.time = 5;
  stepDetection(w.game);
  w.game.galaxy.time = 10;
  stepDetection(w.game);
  assert(target.dead, 'a generic detector always finds a named hero, whatever it evades');
}
{
  const friend = { type: spy(false), owner: A },
    w = world([friend]);
  w.game.galaxy.time = 5;
  stepDetection(w.game);
  w.game.galaxy.time = 10;
  stepDetection(w.game);
  assert(!friend.dead, 'never a friend');
}
{
  const w = world([], { creditSiphonOwner: B, creditSiphonPct: 0.5, creditSiphonEnd: 1e9 });
  w.game.galaxy.time = 5;
  stepDetection(w.game);
  w.game.galaxy.time = 10;
  stepDetection(w.game);
  assert.equal(w.p.creditSiphonOwner, -1, 'a siphon on a friendly planet is found and ended');
}
{
  const w = world([], { owner: B, creditSiphonOwner: A, creditSiphonPct: 0.5, creditSiphonEnd: 1e9 });
  w.game.galaxy.time = 5;
  stepDetection(w.game);
  w.game.galaxy.time = 10;
  stepDetection(w.game);
  assert.equal(w.p.creditSiphonOwner, A, 'not on a planet the detector does not hold');
}
console.log('ok', A, B);
