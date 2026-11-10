import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
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
const { LandWorld } = await import('../public/js/game/land.js');
const { setupBombard, canBombard, bombardCharge, bombardOf, bombardTargetWhy, orbitalBombard, bombardLightsNow, tickBase } = await import(
  '../public/js/game/landbase.js'
);
const { seedSim } = await import('../public/js/game/simrandom.js');
seedSim(7);

const C = db.constants,
  min = C.num('Min_Bombard_Interval_Seconds', 260);
const world = () =>
  Object.assign(Object.create(LandWorld.prototype), {
    factions: ['Rebel', 'Empire'],
    team: [0, 1],
    campaign: false,
    time: 0,
    units: [],
    squads: [],
    sites: [],
    points: [],
    pings: [],
    reveals: [],
    revealUntil: [0, 0],
    shields: [],
    shots: [],
    bombing: [],
    owned: [new Set(), new Set()],
    fowOn: true,
    sidePlayers: [{}, {}],
    groundZ: () => 0
  });

{
  const w = world();
  setupBombard(w, null);
  for (const side of [0, 1]) {
    const r = bombardOf(w, side);
    assert.equal(r.present, true, 'skirmish: playable faction with orbital ships is enabled');
    assert.equal(r.readyAt, min, 'ready Min_Bombard_Interval_Seconds after the start');
    assert(r.ship, 'a listed ship type supplies the sounds');
  }
  assert.equal(canBombard(w, 0), false);
  w.time = min / 2;
  assert.ok(Math.abs(bombardCharge(w, 0) - 0.5) < 1e-9, 'recharge fill runs from start to ready');
  w.time = min;
  assert.equal(canBombard(w, 0), true);
  w.sidePlayers[0].bombardmentRemoved = true;
  assert.equal(canBombard(w, 0), false, 'Remove_Orbital_Bombardment(true) disables');
  w.sidePlayers[0].bombardmentRemoved = false;
  assert.equal(canBombard(w, 0), true, 'Remove_Orbital_Bombardment(false) enables');
}

{
  const ship = db.faction('Empire').list('Bombardment_Required_Orbital_Ships')[0];
  const w = world();
  setupBombard(w, {
    planet: 3,
    galaxy: {
      fleets: [
        { owner: 'Empire', planet: 3, leg: null, units: [[ship, null, -1, {}]] },
        { owner: 'Rebel', planet: 3, leg: null, units: [['Rebel_X-Wing_Squadron', null, -1, {}]] }
      ]
    }
  });
  assert.equal(bombardOf(w, 1).present, true, 'galactic: the side with a required ship in orbit is enabled');
  assert.equal(bombardOf(w, 1).ship, db.type(ship));
  assert.equal(bombardOf(w, 0).present, false, 'galactic: no required ship in orbit, no bombardment');
}

{
  const w = world();
  setupBombard(w, null);
  w.time = min;
  assert.match(bombardTargetWhy(w, 0, 500, 500) || '', /line of sight/, 'fogged spot is rejected');
  w.units.push({ dead: false, side: 0, x: 480, y: 500, structure: true, sight: 300, type: bombardOf(w, 0).ship });
  assert.equal(bombardTargetWhy(w, 0, 500, 500), null, 'revealed spot is fine');
  w.shields.push({ x: 520, y: 500, r: 100, side: 0 });
  assert.match(bombardTargetWhy(w, 0, 500, 500) || '', /shield/, 'any owner shield blocks, own included');
  w.shields.length = 0;
  w.fowOn = false;
  assert.equal(bombardTargetWhy(w, 1, 500, 500), null, 'no fog check when fog is off');
  w.fowOn = true;

  assert.equal(orbitalBombard(w, 0, 500, 500), null);
  assert.equal(bombardOf(w, 0).readyAt, min + min, 'next bombardment Min_Bombard_Interval_Seconds after firing');
  const F = db.faction('Rebel'),
    blob = F.num('Bombardment_Blob_Size', 200),
    P = db.type(F.list('Bombardment_Projectile')[0]),
    m = Math.max(1, P.num('Projectile_Blast_Area_Range', 0));
  w.time = min + 120;
  tickBase(w, 0);
  const shots = w.shots.map(s => Math.hypot(s.aimX - 500, s.aimY - 500));
  assert(shots.length > 2, 'salvos fired');
  for (const d of shots.slice(1)) assert(d >= m - 1e-6 && d <= blob - m + 1e-6, `scatter ${d} within [${m}, ${blob - m}]`);
}

{
  const w = world();
  w.time = 0;
  w.bombardLights = [{ x: 0, y: 0, at: 0, frames: 100, color: [1, 0.5, 0] }];
  w.time = 85 / 30;
  const peak = bombardLightsNow(w, 0, 0);
  assert.ok(Math.abs(peak.color[0] - 1) < 1e-6, 'full at 85% of its life');
  assert.deepEqual(peak.dir, [0, 0, 1], 'straight down over the camera target');
  w.time = 42.5 / 30;
  assert.ok(Math.abs(bombardLightsNow(w, 0, 0).color[0] - 0.5) < 1e-6, 'linear ramp up');
  w.time = 92.5 / 30;
  assert.ok(Math.abs(bombardLightsNow(w, 0, 0).color[0] - 0.5) < 1e-6, 'linear fade over the last 15%');
  w.time = 101 / 30;
  assert.equal(bombardLightsNow(w, 0, 0), null, 'gone after its life');
}

console.log('ok');
