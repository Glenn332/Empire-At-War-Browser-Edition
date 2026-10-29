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
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { LandWorld, LandSquad, landUnit } = await import('../public/js/game/land.js');
const A = await import('../public/js/game/landabilities.js');
const C = await import('../public/js/game/campaignland.js');
const tyber = db.type('Tyber_Zann');
if (!tyber || !A.landAbilities(tyber).some(d => d.kind === 'TACTICAL_BRIBE')) {
  console.log('no Tyber bribe in this data: skipped');
  process.exit(0);
}

const world = Object.assign(Object.create(LandWorld.prototype), {
  team: [0, 1, 1],
  wild: 3,
  time: 1,
  units: [],
  squads: [],
  effects: [],
  beams: [],
  pings: [],
  credits: [1000, 1000, 0],
  mods: [],
  planetCorruption: -1,
  marketOf: () => null,
  campaign: null,
  ally(a, b) {
    return this.team[a] === this.team[b];
  },
  order() {},
  stop() {},
  attack() {},
  skin() {
    return { tint: { set() {} } };
  }
});
const sounds = [],
  fx = [];
world.onSound = name => sounds.push(name);
world.onFx = name => fx.push(name);
const make = (type, side, x) => {
  const squad = new LandSquad(world, type, side);
  const unit = landUnit({
    type,
    side,
    squad,
    x,
    y: 0,
    z: 0,
    health: 100,
    maxHealth: 100,
    dead: false,
    inside: false,
    flies: false,
    cloaked: false,
    path: [],
    range: 200,
    minRange: 0,
    scanAt: Infinity,
    aimZ: 3,
    abilityKinds: new Set()
  });
  squad.members = [unit];
  world.units.push(unit);
  world.squads.push(squad);
  return unit;
};
const zann = make(tyber, 0, 0);
for (const def of A.landAbilities(tyber)) {
  zann.abilityKinds.add(def.kind);
  zann.squad.abilities.push({ def, active: false, left: 0, cooldown: 0, auto: false });
}
const def = zann.squad.abilityState('TACTICAL_BRIBE').def;
const priced = [...db.types.values()].find(
  t => t.tag === 'GroundInfantry' && t.num('Tactical_Bribe_Cost', 0) > 1 && !t.name.includes('Converted')
);
const base = priced.num('Tactical_Bribe_Cost', 0);
const cheap = make(priced, 1, 50),
  free = make(db.type('Rancor') || priced, 1, 60);

assert.equal(A.bribeCost(world, zann.squad, cheap), base * tyber.num('Bribe_Modifier_On_Uncorrupted_Planets', 1));
world.planetCorruption = 3;
assert.equal(A.bribeCost(world, zann.squad, cheap), base * tyber.num('Bribe_Modifier_On_Corrupted_Planets', 1));
assert.equal(tyber.num('Bribe_Modifier_On_Corrupted_Planets', 1), 0.75);
world.planetCorruption = -1;
assert(
  A.bribeBase(
    db.type([...db.types.values()].find(t => t.list('Company_Units').some(n => db.type(n)?.num('Tactical_Bribe_Cost', 0) > 1)).name)
  ) > 1
);
assert.equal(A.bribeBase(db.type('Stormtrooper_Squad') || db.type('Stormtrooper')) >= 0, true);
assert.notEqual(A.cantTarget(world, zann.squad, def, { unit: zann }), null, 'not on its own');
assert.equal(A.cantTarget(world, zann.squad, def, { unit: cheap }), null, 'an enemy with a price');

const second = landUnit({
  type: priced,
  side: 1,
  squad: cheap.squad,
  x: 51,
  y: 0,
  z: 0,
  health: 100,
  maxHealth: 100,
  dead: false,
  inside: false,
  flies: false,
  cloaked: false,
  path: [],
  range: 200,
  minRange: 0,
  scanAt: Infinity,
  aimZ: 3,
  abilityKinds: new Set()
});
cheap.squad.members.push(second);
world.units.push(second);
const cloak = zann.squad.abilityState('STEALTH');
cloak.active = true;
cloak.left = 30;
zann.cloaked = true;
const before = world.credits[0];
assert.equal(A.useAbility(world, zann.squad, 'TACTICAL_BRIBE', { unit: cheap }), null, 'it goes');
assert.equal(world.credits[0], before - base);
assert(cheap.side === 0 && second.side === 0 && cheap.squad.side === 0, 'the squad is ours now');
assert(cheap.bribed && second.bribed, 'marked bribed');
assert(sounds.includes(def.spec.val('SFXEvent_Success')) || sounds.length, 'the success sound');
assert(fx.includes(def.spec.val('Bribed_Effect')), 'the big effect');
assert(!cloak.active, 'Tyber is seen after it');
assert.equal(zann.squad.abilityState('TACTICAL_BRIBE').cooldown, 50, 'it recharges 50 seconds');

const poor = make(priced, 1, 55);
world.credits[0] = base - 1;
zann.squad.abilityState('TACTICAL_BRIBE').cooldown = 0;
sounds.length = 0;
assert.equal(A.useAbility(world, zann.squad, 'TACTICAL_BRIBE', { unit: poor }), A.SILENT);
assert.equal(poor.side, 1);
assert.equal(world.credits[0], base - 1);
assert.equal(zann.squad.abilityState('TACTICAL_BRIBE').cooldown, 0);
assert.deepEqual(sounds, [def.spec.val('SFXEvent_Fail')]);

world.credits[0] = base + 1;
zann.squad.abilityState('TACTICAL_BRIBE').cooldown = 0;
zann.cloaked = false;
poor.x = 500;
A.aiAbilities(world, zann.squad);
assert.equal(poor.side, 1, 'out of reach');
poor.x = 40;
world.credits[0] = base - 1;
A.aiAbilities(world, zann.squad);
assert.equal(poor.side, 1, 'it cannot pay');
world.credits[0] = base + 1;
A.aiAbilities(world, zann.squad);
assert.equal(poor.side, 0, 'it paid');

{
  const a = make(priced, 1, 30),
    b = make(priced, 1, 35);
  world.credits[0] = base * 10;
  zann.squad.abilityState('TACTICAL_BRIBE').cooldown = 0;
  zann.cloaked = false;
  A.aiAbilities(world, zann.squad, u => (u === b ? 9 : 1));
  assert(b.side === 0 && a.side === 1, 'the higher score is bought');
}
{
  const solo = [...db.types.values()].find(t => t.list('Company_Units').length === 1 && db.type(t.list('Company_Units')[0])),
    records = [{ gid: 'a', type: solo.name }];
  const squads = new Map([['a', [{ members: [{ dead: false, side: 0, bribed: true }] }]]]);
  assert.deepEqual(C.consolidatedCompanies(records, squads, new Set(), 1), [], 'lost to the side it was taken from');
  assert.deepEqual(C.consolidatedCompanies(records, squads, new Set()), ['a'], 'without a side the old count');
  const stay = new Map([['a', [{ members: [{ dead: false, side: 1 }] }]]]);
  assert.deepEqual(C.consolidatedCompanies(records, stay, new Set(), 1), ['a'], 'an ordinary survivor stays');
}
console.log('ok');
