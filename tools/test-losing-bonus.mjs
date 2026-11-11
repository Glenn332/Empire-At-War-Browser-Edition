import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const archive = openGame(gameDir);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const THREE = await import('../public/vendor/three/build/three.module.js');
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const S = await import('../public/js/game/sim.js');
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const { seedSim } = await import('../public/js/game/simrandom.js');
const { LandWorld } = await import('../public/js/game/land.js');
const { loadLandTables } = await import('../public/js/game/landtables.js');
const { losingSideBonus } = await import('../public/js/game/losingbonus.js');

const DT = 1 / 30;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const near = (a, b, why, eps = 1e-3) => assert(Math.abs(a - b) < eps, why + ': ' + a + ' vs ' + b);
const K = db.constants.num('Multiplayer_Losing_Team_Bonus_Credit_Percentage', 0);
assert.equal(K, 0.08, 'GameConstants: Multiplayer_Losing_Team_Bonus_Credit_Percentage');

{
  const got = new Map(),
    give = (p, v) => got.set(p, (got.get(p) || 0) + v),
    rates = { a: 1, b: 3, c: 2, d: 0 };
  losingSideBonus(
    [
      { players: ['a', 'b'], earn: 4, paid: true },
      { players: ['c'], earn: 2, paid: true },
      { players: ['d'], earn: 10, paid: true }
    ],
    p => rates[p],
    0.1,
    give,
    () => false
  );
  near(got.get('c'), (10 - 2) * 0.1, 'the poorest side gets its share of the gap to the richest');
  near(got.get('a'), (10 - 4) * 0.1 * (1 - 1 / 4), 'a player of the middle side gets the part of the others in it');
  near(got.get('b'), (10 - 4) * 0.1 * (1 - 3 / 4), 'the one earning most of a side gets least');
  assert(!got.has('d'), 'the richest side gets nothing');
  got.clear();
  losingSideBonus(
    [
      { players: ['a'], earn: 1, paid: false },
      { players: ['c'], earn: 2, paid: true },
      { players: ['d'], earn: 10, paid: true }
    ],
    p => rates[p],
    0.1,
    give,
    p => p === 'c'
  );
  assert.equal(got.size, 0, 'a side without its station, or a defeated player, is not paid');
  losingSideBonus(
    [
      { players: ['a'], earn: 1, paid: true },
      { players: ['d'], earn: 10, paid: true }
    ],
    p => rates[p],
    0.1,
    give,
    () => false
  );
  assert.equal(got.size, 0, 'two sides: no bonus');
}

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  maps
    .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
    .split('\\')
    .pop()
);
const stations = [
  'Skirmish_Rebel_Star_Base_1',
  'Skirmish_Empire_Star_Base_1',
  'Skirmish_Underworld_Star_Base_1',
  'Empire_Mineral_Extractor'
];
{
  const names = new Set(),
    seen = new Set();
  for (const n of stations) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

function battle(factions) {
  S.resetEntityIds();
  seedSim(1);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  w.skirmish = true;
  const players = factions.map((f, i) => w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1000 })));
  players.forEach((p, i) => {
    const st = w.spawn(T(stations[i]), p, -4000 + i * 4000, 3000, 0);
    p.station = st;
  });
  const run = secs => {
    for (let n = Math.round(secs / DT); n > 0; n--) w.update(DT);
  };
  return { w, players, run };
}
const dock = st => st.hardpoints.find(h => h.kind === 'HARD_POINT_ENABLE_SPECIAL_ABILITY');

{
  const { w, players, run } = battle(['Rebel', 'Empire']);
  const [rebel] = players,
    st = rebel.station;
  assert(dock(st), 'the first station level has its supply dock hardpoint');
  run(10);
  near(st.income.rate, (30 + 20) / 10, 'the station pays 30 a 10 s and its supply dock adds 20 while it stands', 1e-6);
  near(rebel.credits, 1000 + 50, 'so an idle side makes 5 credits a second', 0.5);
  dock(st).alive = false;
  run(10);
  near(st.income.rate, 30 / 10, 'with the dock destroyed the station pays 30 a 10 s', 1e-6);

  const ex = [0, 1, 2].map(i => w.spawn(T('Empire_Mineral_Extractor'), players[1], 2000, -3000 + i * 1500, 0));
  run(1);
  assert(
    ex.every(e => e.income && e.income.rate === 20),
    'an extractor pays 200 a 10 s'
  );
  const before = rebel.credits;
  run(60);
  near(rebel.credits - before, 60 * 3, 'two sides and the third playable faction unplayed: the losing side gets no bonus', 0.5);
}

{
  const { players, run } = battle(['Rebel', 'Empire', 'Underworld']);
  const [rebel, empire, under] = players;
  for (const h of rebel.station.hardpoints) if (h.kind === 'HARD_POINT_ENABLE_SPECIAL_ABILITY') h.alive = false;
  run(1);
  const r = rebel.credits,
    e = empire.credits,
    u = under.credits;
  run(60);
  near(empire.credits - e, 60 * 5, 'three sides: the richest gets no bonus', 0.5);
  near(under.credits - u, 60 * 5, 'nor does one tied with it', 0.5);
  near(rebel.credits - r, 60 * (3 + (5 - 3) * K), 'the poorest gets 0.08 of the gap to the richest', 0.5);
}

{
  const t = await loadLandTables();
  near(t.difficulty.get('easy').shield, 0.3, 'Easy_Default Shield_Multiplier');
  near(t.difficulty.get('normal').shield, 1, 'Normal_Default Shield_Multiplier');
  near(t.difficulty.get('hard').shield, 0.5, 'Hard_Default Shield_Multiplier');
}

const landMap = await loadMap('_Land_Planet_Bestine_02.ted');
const land = factions => {
  const w = new LandWorld(landMap, new THREE.Scene(), { factions });
  w.fixed = true;
  return w;
};

{
  const w = land(['Empire', 'Rebel']);
  w.mods[1] = { build: 1, credit: 1, damage: 1, health: 1, shield: 0.3 };
  const ai = (await w.spawn('T2B_Tank', 600, 600, 0, 1)).members[0],
    pts = T('T2B_Tank').num('Shield_Points', 0);
  assert(pts > 0, 'T2B_Tank has Shield_Points');
  near(ai.maxShield, pts * 0.3, 'an AI land unit takes its difficulty Shield_Multiplier');
  near(ai.shield, pts * 0.3, 'and starts full');
  w.mods[0] = { build: 1, credit: 1, damage: 1, health: 1, shield: 1 };
  const human = (await w.spawn('T2B_Tank', 800, 600, 0, 0)).members[0];
  near(human.maxShield, pts, 'a side without an adjustment keeps its shield');
}

{
  const fake = (side, value, every) => ({
    structure: true,
    dead: false,
    side,
    income: { value, every, timer: 0 },
    site: null,
    type: T('Skirmish_Ground_Mining_Facility_E')
  });
  const three = land(['Empire', 'Rebel', 'Underworld']);
  three.playerSides = 3;
  three.team = [0, 1, 2];
  three.units = [fake(0, 125, 5), fake(1, 125, 5), fake(1, 125, 5), fake(2, 125, 5), fake(2, 125, 5), fake(2, 125, 5), fake(2, 125, 5)];
  three.owned = [new Set(), new Set(), new Set()];
  three.credits = [0, 0, 0];
  three.losingTeamBonus(1);
  near(three.credits[0], (100 - 25) * K, 'land: the poorest side gets its share of the gap, no station needed');
  near(three.credits[1], (100 - 50) * K, 'land: so does the middle one');
  near(three.credits[2], 0, 'land: the richest gets nothing');
  three.beaten.add(0);
  three.credits = [0, 0, 0];
  three.losingTeamBonus(1);
  near(three.credits[0], 0, 'land: a defeated side is not paid');

  const two = land(['Empire', 'Rebel']);
  two.playerSides = 2;
  two.team = [0, 1];
  two.units = [fake(0, 125, 5), fake(1, 125, 5), fake(1, 125, 5)];
  two.owned = [new Set(), new Set()];
  two.credits = [0, 0];
  two.losingTeamBonus(1);
  assert.deepEqual(two.credits, [0, 0], 'land: two sides, no bonus');
}

console.log('losing bonus ok');
