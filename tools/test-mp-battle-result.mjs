import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
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
const { MpBattles, checkedResult, REPORT_TIMEOUT } = await import('../public/js/game/galacticmpbattle.js');
const { isTacticalSuperweapon } = await import('../public/js/game/tacticalsuperweapon.js');

const types = [...db.types.values()];
const tsw = types.find(t => isTacticalSuperweapon(t));
const ship = types.find(t => /^Star_Destroyer$/i.test(t.name)) || types.find(t => t.list('CategoryMask').some(m => /capital/i.test(m)));
const rebelShip = types.find(t => /^Nebulon_B_Frigate$/i.test(t.name)) || ship;
assert(tsw && ship, 'found a tactical superweapon and a ship type');

const planet = { destroyed: false, station: null, type: { bool: (_, d) => d } };
const galaxy = { planets: [planet] };
const treasury = (credits, ai = false) => ({
  credits,
  ai,
  share: ai ? 500 : 0,
  parts: ai ? [['Military', 500]] : [],
  adjust: 1,
  cap: 40000
});
const battle = (mode, attackerUnits) => ({
  id: 1,
  p: 0,
  mode,
  attacker: 'EMPIRE',
  defender: 'REBEL',
  humans: ['EMPIRE', 'REBEL'],
  setup: {
    players: [
      { human: true, faction: 'EMPIRE', peer: 0, peers: [0] },
      { human: true, faction: 'REBEL', peer: 1, peers: [1] }
    ],
    campaign: {
      planet: 0,
      sides: ['EMPIRE', 'REBEL'],
      treasury: { EMPIRE: treasury(5000), REBEL: treasury(3000) },
      attacker: { team: 0, units: attackerUnits },
      defender: { team: 1, units: [{ gid: '1:0', type: rebelShip.name }], station: null, structures: [] }
    }
  }
});

// Fields that do not belong to the battle are dropped or clamped.
{
  const b = battle('space', [{ gid: '0:0', type: ship.name }]);
  const r = checkedResult(galaxy, b, {
    planet: 0,
    winner: 'attacker',
    alive: ['0:0', '7:3', 'g:0', 5],
    credits: { EMPIRE: { credits: 1e9 }, REBEL: { credits: 'x' }, PIRATES: { credits: 0 } },
    planetDestroyed: true,
    planetDestroyedBy: 'EMPIRE',
    superweaponDestroyed: true,
    storyDelayed: [{ type: 'STORY_MISSION_LOST', name: 'x' }],
    upgradesBuilt: [{ type: 'NoSuchUpgrade', owner: 'EMPIRE' }]
  });
  assert.deepEqual(r.alive, ['0:0']);
  assert.equal(r.credits.EMPIRE.credits, 40000, 'credits capped by the treasury cap');
  assert.equal(r.credits.REBEL, undefined, 'non-number credits ignored');
  assert.equal(r.credits.PIRATES, undefined, 'factions outside the battle ignored');
  assert.equal(r.planetDestroyed, undefined, 'no superweapon took part, so the planet survives');
  assert.equal(r.superweaponDestroyed, undefined);
  assert.deepEqual(r.storyDelayed, [{ type: 'STORY_MISSION_LOST', name: 'x' }], 'a lost-mission story event is kept');
  assert.deepEqual(r.upgradesBuilt, []);
  assert.equal(r.station, false);
  assert.equal(checkedResult(galaxy, b, { planet: 3, winner: 'attacker' }), null, 'wrong planet');
  assert.equal(checkedResult(galaxy, b, { winner: 'attacker', sides: ['REBEL', 'EMPIRE'] }), null, 'wrong sides');
  assert.equal(checkedResult(galaxy, b, { winner: 'attacker', mode: 'land' }), null, 'wrong mode');
  assert.equal(checkedResult(galaxy, b, { winner: 'nobody' }), null, 'no winner');
  const skirmish = battle('space', [{ gid: '0:0', type: ship.name }]);
  skirmish.setup.campaign.skirmishRules = true;
  assert.equal(
    checkedResult(galaxy, skirmish, { winner: 'attacker', credits: { EMPIRE: { credits: 9000 } } }).credits.EMPIRE.credits,
    5000
  );
}
// A superweapon in the attacker's fleet can destroy the planet, but only for its own side.
{
  const b = battle('space', [{ gid: '0:0', type: tsw.name }]);
  const r = checkedResult(galaxy, b, { winner: 'attacker', alive: ['0:0'], planetDestroyed: true, planetDestroyedBy: 'Empire' });
  assert.equal(r.planetDestroyed, true);
  assert.equal(r.planetDestroyedBy, 'EMPIRE');
  assert.equal(
    checkedResult(galaxy, b, { winner: 'attacker', planetDestroyed: true, planetDestroyedBy: 'REBEL' }).planetDestroyed,
    undefined
  );
}
// Land results only keep units that were in the battle.
{
  // the tactical battle shares the setup object and swaps type names for type objects in place
  const b = battle('space', [{ gid: '0:0', type: ship }]);
  b.setup.campaign.defender.orbital = [{ gid: 'o:0', type: ship }];
  const v = checkedResult(galaxy, b, {
    winner: 'defender',
    alive: ['0:0', 'o:0'],
    storyDelayed: [{ type: 'STORY_MISSION_LOST', name: 'M1' }, { type: 'EVIL' }]
  });
  assert(v, 'a setup holding type objects still checks');
  assert.deepEqual(v.alive, ['0:0', 'o:0'], 'surviving orbital structures stay in the report');
  assert.deepEqual(v.orbitalFought, ['o:0']);
  assert.deepEqual(v.storyDelayed, [{ type: 'STORY_MISSION_LOST', name: 'M1' }]);
}
{
  const b = battle('land', [{ gid: '0:0', type: ship.name }]);
  b.setup.campaign.defender.structures = [{ gid: 's:0', type: ship.name }];
  const r = checkedResult(galaxy, b, {
    mode: 'land',
    planet: 0,
    sides: ['EMPIRE', 'REBEL'],
    winner: 'defender',
    alive: ['s:0', 's:1', '1:0'],
    participants: ['0:0', '1:0', '2:0'],
    tacticalStructures: [
      { type: ship.name, owner: 'REBEL', position: [1, 2, 3] },
      { type: ship.name, owner: 'PIRATES', position: [1, 2, 3] },
      { type: ship.name, owner: 'REBEL', position: ['a', 2] }
    ]
  });
  assert.deepEqual(r.alive, ['1:0', 's:0']);
  assert.deepEqual(r.participants, ['0:0']);
  assert.equal(r.tacticalStructures.length, 1);
}

// PvP: both sides must report the same result; disagreement falls back to the tactical host.
const fakeGame = () => {
  const applied = [];
  return {
    applied,
    galaxy,
    setup: {
      players: [
        { human: true, faction: 'EMPIRE', peer: 0 },
        { human: true, faction: 'REBEL', peer: 1 }
      ]
    },
    applyResult: r => applied.push(r),
    galacticBattleChanged() {},
    syncFleetViews() {},
    playerName: f => f
  };
};
const warn = console.warn;
console.warn = () => {};
try {
  const win = { planet: 0, winner: 'attacker', alive: ['0:0'] },
    lose = { planet: 0, winner: 'defender', alive: ['1:0'] };
  {
    const game = fakeGame(),
      m = new MpBattles(game);
    m.current = battle('space', [{ gid: '0:0', type: ship.name }]);
    m.result('EMPIRE', 1, win, 0);
    assert.equal(game.applied.length, 0, 'one side alone does not decide a PvP battle');
    m.result('REBEL', 1, { ...win, alive: ['0:0'] }, 1);
    assert.equal(game.applied.length, 1, 'matching reports are applied');
    assert.equal(game.applied[0].winner, 'attacker');
  }
  {
    const game = fakeGame(),
      m = new MpBattles(game);
    m.current = battle('space', [{ gid: '0:0', type: ship.name }]);
    m.result('REBEL', 1, lose, 1);
    m.result('EMPIRE', 1, win, 0);
    assert.equal(game.applied.length, 1);
    assert.equal(game.applied[0].winner, 'attacker', "disagreement takes the host's report");
  }
  {
    const game = fakeGame(),
      m = new MpBattles(game);
    m.current = battle('space', [{ gid: '0:0', type: ship.name }]);
    m.result('REBEL', 1, lose, 1);
    for (let i = 0; i < REPORT_TIMEOUT - 1; i++) m.tick();
    assert.equal(game.applied.length, 0, 'before the timeout a missing host report is waited for');
    m.tick();
    assert.equal(game.applied.length, 1, 'a timeout without the host report takes the first report instead of hanging');
    assert.equal(game.applied[0].winner, 'defender');
  }
  {
    const game = fakeGame(),
      m = new MpBattles(game);
    let resolved = 0;
    game.battles = { resolveFor: () => resolved++ };
    m.current = battle('space', [{ gid: '0:0', type: ship.name }]);
    m.result('REBEL', 1, { ...lose, winner: 'nobody' }, 1);
    m.result('EMPIRE', 1, { ...win, planet: 99 }, 0);
    for (let i = 0; i < REPORT_TIMEOUT; i++) m.tick();
    assert.equal(game.applied.length, 0);
    assert.equal(resolved, 1, 'when every report is refused the battle is auto-resolved instead of holding the galaxy');
    assert.equal(m.current, null);
  }
  {
    const game = fakeGame(),
      m = new MpBattles(game);
    m.current = battle('space', [{ gid: '0:0', type: ship.name }]);
    m.result('EMPIRE', 1, win, 0);
    for (let i = 0; i < REPORT_TIMEOUT - 1; i++) m.tick();
    assert.equal(game.applied.length, 0);
    m.tick();
    assert.equal(game.applied.length, 1, "after the timeout the host's report stands");
  }
  {
    const game = fakeGame(),
      m = new MpBattles(game);
    const b = battle('space', [{ gid: '0:0', type: ship.name }]);
    b.humans = ['EMPIRE'];
    m.current = b;
    m.result('REBEL', 1, lose, 1);
    assert.equal(game.applied.length, 0, 'a side that is not human in this battle cannot report');
    m.result('EMPIRE', 1, win, 0);
    assert.equal(game.applied.length, 1, 'against the AI the human side decides');
  }
  {
    const game = fakeGame(),
      m = new MpBattles(game);
    const b = battle('land', [{ gid: '0:0', type: ship.name }]);
    b.setup.shooter = true;
    m.current = b;
    m.result('REBEL', 1, { ...lose, mode: 'land' }, 1);
    assert.equal(game.applied.length, 0, 'shooter battles take only the host report');
    m.result('EMPIRE', 1, { ...win, mode: 'land' }, 0);
    assert.equal(game.applied.length, 1);
  }
} finally {
  console.warn = warn;
}
console.log('mp battle result ok');
