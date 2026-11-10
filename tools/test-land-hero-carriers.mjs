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
const { LandWorld } = await import('../public/js/game/land.js');
const { loadMap } = await import('../public/js/ted.js');
const { placeLandInvasion, landInvasionResult, restoreSheltered } = await import('../public/js/game/campaignland.js');

const map = await loadMap('_Land_Planet_Bestine_02.ted');
const near = (a, b, why) => assert(Math.abs(a - b) < 1e-6, why + ': ' + a + ' vs ' + b);
const world = factions => {
  const w = new LandWorld(map, new THREE.Scene(), { factions });
  w.fixed = true;
  return w;
};
const base = name => db.type(name).num('Tactical_Health', 50);
const one = async (w, name, side, x = 600, y = 600) => (await w.spawn(name, x, y, 0, side)).members[0];

{
  const w = world(['Empire', 'Rebel']);
  const trooper = await one(w, 'Imperial_Stormtrooper_Squad', 0, 500, 500),
    hp = base(trooper.type.name);
  const q = await w.spawn('General_Veers_Team', 600, 600, 0, 0),
    walker = q.members[0];
  assert.equal(q.members.length, 1, 'Veers comes as one unit');
  assert.equal(walker.type.name.toUpperCase(), 'VEERS_AT_AT_WALKER', 'a hero with Unique_Ground_Unit is made as that unit');
  assert.equal(walker.rider?.name.toUpperCase(), 'GENERAL_VEERS', 'and rides in it');
  near(trooper.maxHealth, hp * 1.25, 'Veers in his walker raises the health of his side');
  near(walker.maxHealth, base('Veers_AT_AT_Walker'), 'not of his own walker');
  const tank = await one(w, 'Imperial_Heavy_Assault_Company', 0, 700, 700);
  near(tank.maxHealth, base(tank.type.name) * 1.25, 'a vehicle made later takes it');
  const rebel = await one(w, 'Rebel_Infantry_Squad', 1, 900, 900);
  near(rebel.maxHealth, base(rebel.type.name), 'enemies untouched');
  assert.equal(w.bonusHolders.filter(h => h.type.name.toUpperCase() === 'GENERAL_VEERS').length, 1, 'one carrier for Veers');
  walker.dead = true;
  w.syncCombatBonuses();
  near(trooper.maxHealth, hp, 'the walker dies: his bonus goes with it');

  const saved = await w.spawn('General_Veers_Team', 600, 600, 0, 0, [
    { type: 'Veers_AT_AT_Walker', rider: 'General_Veers', x: 600, y: 600, h: 0, hp: 100 }
  ]);
  assert.equal(saved.members[0].rider?.name.toUpperCase(), 'GENERAL_VEERS', 'a saved walker keeps its rider');
  near(trooper.maxHealth, hp * 1.25, 'and its bonus');
  const plain = await w.spawn('AT_AT_Walker', 800, 600, 0, 0);
  assert(!plain || plain.members.every(u => !u.rider), 'an ordinary walker carries nobody');
}

const invasion = (attacker, defender, units) => ({
  sides: [attacker, defender],
  attacker: { side: 0, units: units.attacker },
  defender: { side: 1, units: units.defender, structures: [] },
  planetType: null
});

{
  const w = world(['Rebel', 'Empire']);
  const cb = invasion('Rebel', 'Empire', {
    attacker: [
      { gid: 'a1', type: 'Mon_Mothma_Team' },
      { gid: 'a2', type: 'Rebel_Infantry_Squad' },
      { gid: 'a3', type: 'Rebel_Infantry_Squad' }
    ],
    defender: [{ gid: 'd1', type: 'Imperial_Stormtrooper_Squad' }]
  });
  const book = await placeLandInvasion(w, map, cb);
  const landed = w.units.find(u => u.side === 0 && !u.dead),
    foe = w.units.find(u => u.side === 1 && !u.dead);
  assert(landed && foe, 'both sides are on the field');
  near(landed.maxHealth, base(landed.type.name) * 1.25, 'an attacking hero staying in its transport gives its bonus');
  near(foe.maxHealth, base(foe.type.name), 'not to the defender');
  assert(book.absent.includes('a1'), 'the hero stays off the map');
  assert(!w.ready[0].some(t => t.name.toUpperCase() === 'MON_MOTHMA_TEAM'), 'and is not offered as a reinforcement');
  assert(
    w.ready[0].some(t => t.name.toUpperCase() === 'REBEL_INFANTRY_SQUAD'),
    'the others wait as reinforcements'
  );
  const later = await one(w, 'Rebel_Infantry_Squad', 0, 300, 300);
  near(later.maxHealth, base(later.type.name) * 1.25, 'a reinforcement landing later takes it');
  const result = landInvasionResult(w, book, cb, 1);
  assert(result.alive.includes('a1'), 'the hero in the transport survives the battle');
}

{
  const w = world(['Empire', 'Rebel']);
  const shelters = [await one(w, 'Ground_Cantina_R', 1, 400, 900), await one(w, 'Ground_Cantina_R', 1, 900, 400)];
  for (const s of shelters) assert(s.type.bool('Can_Contain_Heroes_During_Ground_Battle'));
  const cb = invasion('Empire', 'Rebel', {
    attacker: [{ gid: 'a1', type: 'Imperial_Stormtrooper_Squad' }],
    defender: [
      { gid: 'd1', type: 'Mon_Mothma_Team' },
      { gid: 'd2', type: 'Rebel_Infantry_Squad' }
    ]
  });
  const book = await placeLandInvasion(w, map, cb);
  const home = book.contained.get('d1'),
    other = shelters.find(s => s !== home),
    rebel = w.units.find(u => u.side === 1 && !u.dead && !u.type.bool('Can_Contain_Heroes_During_Ground_Battle')),
    hp = base(rebel.type.name);
  assert(home, 'the defending hero shelters in a structure');
  near(rebel.maxHealth, hp * 1.25, 'and gives its bonus from there');
  const saved = JSON.parse(JSON.stringify([...book.contained].map(([gid, u]) => [gid, shelters.indexOf(u)])));
  restoreSheltered(
    w,
    book,
    cb,
    saved.map(([gid, i]) => [gid, shelters[i]])
  );
  assert.equal(book.contained.get('d1'), home, 'a load keeps the saved shelter');
  near(rebel.maxHealth, hp * 1.25, 'the bonus is not given twice');
  restoreSheltered(w, book, cb, [['d1', other]]);
  assert.equal(book.contained.get('d1'), other, 'a save naming another shelter moves the hero there');
  near(rebel.maxHealth, hp * 1.25, 'with one bonus');
  home.dead = true;
  w.syncCombatBonuses();
  near(rebel.maxHealth, hp * 1.25, 'the old shelter no longer carries it');
  assert(landInvasionResult(w, book, cb, 1).alive.includes('d1'), 'the sheltered hero survives while its shelter stands');
  other.dead = true;
  w.syncCombatBonuses();
  near(rebel.maxHealth, hp, 'the new shelter falls: the bonus goes');
  assert(!landInvasionResult(w, book, cb, 1).alive.includes('d1'), 'and the hero with it');
  restoreSheltered(w, book, cb, [['d1', null]]);
  assert(!book.contained.has('d1'), 'a shelter lost before the save keeps the hero lost');
}

console.log('land hero carriers ok');
