import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const arg = k => {
  const i = process.argv.indexOf(k);
  return i < 0 ? null : process.argv[i + 1];
};
const mod = arg('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod ? [mod] : []);
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
const THREE = await import('../public/vendor/three/build/three.module.js');
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const S = await import('../public/js/game/sim.js');
const { seedSim } = await import('../public/js/game/simrandom.js');
const { SpaceRecorder } = await import('../public/js/game/spacerecord.js');
const { keeper, hookBattle, stepRecord, applyDirect } = await import('../public/js/game/spacebattlehooks.js');
const { SpaceMirror } = await import('../public/js/game/spacemirror.js');
const { UI } = await import('../public/js/game/ui.js');

const TICK = 1 / 30;
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const mapFile = maps.find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n)) || maps.find(n => /SPACE/.test(n));
assert(mapFile, 'a space map');
const map = await loadMap(mapFile.split('\\').pop());

const of = f => t =>
  t
    .str('Affiliation')
    .toUpperCase()
    .split(/[,\s]+/)
    .includes(f);
const pickType = (want, f) => db.type(want) || [...db.types.values()].find(t => t.tag === 'SpaceUnit' && of(f)(t) && !S.isSquadronType(t) && t.num('Build_Cost_Credits', 0) > 0 && t.num('Max_Speed', 0) > 0 && t.str('Space_Model_Name'));
const ship = pickType('Tartan_Patrol_Cruiser', 'EMPIRE'),
  target = pickType('Corellian_Corvette', 'REBEL'),
  squadron = [...db.types.values()].find(t => S.isSquadronType(t) && of('EMPIRE')(t) && t.num('Build_Cost_Credits', 0) > 0);
assert(ship && squadron && target, 'an Empire ship, an Empire squadron and a Rebel ship');

const names = new Set(),
  seen = new Set();
for (const t of [ship, squadron, target]) S.modelsForType(t, null, names, seen);
await preloadModels([...names].filter(Boolean));

function build(events) {
  S.resetEntityIds();
  seedSim(11);
  const w = new S.World({
    scene: new THREE.Scene(),
    fx: events ? keeper('fx', events) : nothing,
    audio: events ? keeper('audio', events) : nothing,
    map
  });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.skirmish = true;
  w.fog = false;
  const players = ['Empire', 'Rebel'].map((f, i) => {
    const team = w.addTeam(new S.Team(i, f));
    return w.addPlayer(new S.Player(i, team, { human: i === 0, credits: 0, color: new THREE.Color(i ? 0xff0000 : 0x00ff00) }));
  });
  w.viewer = players[0];
  w.spawn(ship, players[0], -2000, -1500, 0);
  w.spawn(squadron, players[0], -2000, 1500, 0);
  w.spawn(target, players[1], 2500, 0, Math.PI);
  w.spawn(target, players[1], 9000, 9000, Math.PI);
  w.recountPop();
  return w;
}

const events = [],
  spawns = [];
const worker = build(events);
events.length = 0;
hookBattle(worker, events, spawns);
const page = build(null);
const inbox = [];
const game = new Proxy(
  { world: page, advisor: undefined, lock: undefined, reveal: false, message: () => {} },
  { get: (t, k) => (k in t ? t[k] : nothing) }
);
const mirror = SpaceMirror.headless(game);
mirror.worker = { postMessage: m => inbox.push(m) };
game.mirror = mirror;
for (const e of [...page.units, ...page.squads, ...page.squads.flatMap(q => q.fighters)]) mirror.match(e.id, e);
const rec = new SpaceRecorder(worker);

const ui = Object.create(UI.prototype);
Object.assign(ui, {
  game,
  world: page,
  player: page.players[0],
  selection: [],
  keys: new Set(),
  mouse: { x: 0, y: 0, inside: false },
  fireHeld: false,
  r: { chase: null, pickGround: () => null, width: 800, height: 600 },
  pick: () => null,
  cancelPlacing() {},
  arm() {},
  endTrack() {},
  select(list) {
    this.selection = list;
  }
});
globalThis.directControl = true;

const step = n => {
  for (let i = 0; i < n; i++) {
    ui.driveDirect();
    for (const m of inbox.splice(0)) if (m.k === 'direct') applyDirect(worker, m.id, m.m);
    worker.updateBegin(TICK);
    worker.updateSome(Infinity);
    worker.updateEnd();
    mirror.apply(structuredClone(stepRecord(worker, rec, spawns, events).message));
  }
};
const twin = e => worker.units.find(u => u.id === mirror.toW.get(e)) || worker.squads.find(q => q.id === mirror.toW.get(e));
const press = code => ui.keys.add(code);
const lift = code => ui.keys.delete(code);
const take = e => {
  ui.selection = [e];
  ui.toggleDirect();
  assert.equal(ui.direct, e, 'V takes control of the selected unit');
};
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));

step(5);
const pageShip = page.units.find(u => u.type === ship),
  workShip = twin(pageShip);
take(pageShip);
step(1);
assert(workShip.direct, 'the battle worker knows the ship is under direct control');

{
  const x0 = workShip.x,
    y0 = workShip.y,
    h0 = workShip.heading;
  press('KeyW');
  step(150);
  lift('KeyW');
  const moved = Math.hypot(workShip.x - x0, workShip.y - y0),
    along = (workShip.x - x0) * Math.cos(h0) + (workShip.y - y0) * Math.sin(h0);
  assert(moved > 50, `W moves the ship forward (moved ${moved.toFixed(0)})`);
  assert(along > moved * 0.9, 'W moves the ship along its heading');
  assert(Math.abs(angle(workShip.heading - h0)) < 0.01, 'W alone does not turn the ship');
  assert(Math.abs(pageShip.x - workShip.x) < 1 && Math.abs(pageShip.y - workShip.y) < 1, 'the page shows where the worker moved the ship');
}
for (const [code, sign] of [
  ['KeyD', -1],
  ['KeyA', 1]
]) {
  const h0 = workShip.heading;
  press(code);
  step(60);
  lift(code);
  const turned = angle(workShip.heading - h0);
  assert(Math.sign(turned) === sign && Math.abs(turned) > 0.05, `${code.slice(3)} turns the ship (turned ${turned.toFixed(3)})`);
}

{
  const workTarget = worker.units.find(u => u.type === target),
    pageTarget = page.units.find(u => u.type === target);
  workTarget.x = pageTarget.x = workShip.x + Math.cos(workShip.heading) * 900;
  workTarget.y = pageTarget.y = workShip.y + Math.sin(workShip.heading) * 900;
  workTarget.setOrder({ kind: 'idle' });
  const life = () => workTarget.health + (workTarget.shield || 0) + workTarget.hardpoints.reduce((s, hp) => s + (hp.health || 0), 0);
  ui.mouse.inside = true;
  ui.pick = () => pageTarget;
  ui.r.pickGround = () => ({ x: pageTarget.x, y: pageTarget.y });
  const before = life();
  step(90);
  assert.equal(life(), before, 'a controlled ship holds fire until the button is held');
  ui.fireHeld = true;
  step(240);
  ui.fireHeld = false;
  assert(life() < before, 'holding fire makes the controlled ship shoot the unit under the cursor');
  ui.mouse.inside = false;
  ui.pick = () => null;
}

ui.toggleDirect();
step(1);
assert.equal(ui.direct, null, 'V again lets go of the ship');
assert.equal(workShip.direct, null, 'the battle worker lets go of the ship too');

const pageSquad = page.squads.find(q => q.type === squadron),
  workSquad = twin(pageSquad);
take(pageSquad);
step(1);
assert(workSquad.direct, 'the battle worker knows the squadron is under direct control');
{
  const lead = workSquad.fighters[0],
    h0 = lead.heading;
  press('KeyW');
  step(120);
  lift('KeyW');
  const x0 = lead.x,
    y0 = lead.y,
    h1 = lead.heading;
  press('KeyW');
  step(60);
  lift('KeyW');
  assert(Math.hypot(lead.x - x0, lead.y - y0) > 100, 'W flies the squadron');
  assert(Math.abs(angle(lead.heading - h1)) < 0.2, 'W alone flies the squadron straight');
  press('KeyD');
  step(60);
  lift('KeyD');
  assert(Math.abs(angle(lead.heading - h0)) > 0.3, 'D turns the squadron');
}
{
  const workTarget = worker.units.findLast(u => u.type === target && !u.dead),
    pageTarget = page.units.find(u => mirror.toW.get(u) === workTarget.id),
    lead = workSquad.fighters.find(f => !f.dead),
    life = () => workTarget.health + (workTarget.shield || 0) + workTarget.hardpoints.reduce((s, hp) => s + (hp.health || 0), 0);
  workTarget.x = pageTarget.x = lead.x + Math.cos(lead.heading) * 500;
  workTarget.y = pageTarget.y = lead.y + Math.sin(lead.heading) * 500;
  workTarget.setOrder({ kind: 'idle' });
  ui.mouse.inside = true;
  ui.pick = () => pageTarget;
  ui.r.pickGround = () => ({ x: pageTarget.x, y: pageTarget.y });
  const before = life();
  ui.fireHeld = true;
  step(150);
  ui.fireHeld = false;
  assert(life() < before, 'holding fire makes the controlled squadron shoot the unit under the cursor');
  workTarget.x = pageTarget.x = lead.x - 30000;
  workTarget.y = pageTarget.y = lead.y;
  ui.pick = () => null;
  const ahead = () => {
    const f = workSquad.fighters.find(f => !f.dead);
    return { x: f.x + Math.cos(f.heading) * 600, y: f.y + Math.sin(f.heading) * 600 };
  };
  ui.r.pickGround = () => ahead();
  step(30);
  let idle = 0,
    shots = 0;
  const seen = new Set(worker.projectiles);
  const count = () => {
    let n = 0;
    for (const p of worker.projectiles)
      if (!seen.has(p)) {
        seen.add(p);
        n++;
      }
    return n;
  };
  for (let i = 0; i < 90; i++) {
    step(1);
    idle += count();
  }
  ui.fireHeld = true;
  for (let i = 0; i < 90; i++) {
    step(1);
    shots += count();
  }
  ui.fireHeld = false;
  assert(shots > idle, `holding fire at empty space under the cursor makes the squadron shoot (${shots} shots, ${idle} without the button)`);
  ui.mouse.inside = false;
  ui.r.pickGround = () => null;
}
ui.releaseDirect();
step(1);
assert.equal(workSquad.direct, null, 'Escape lets go of the squadron in the battle worker');

console.log(`space direct control ok (${ship.name}, ${squadron.name}, target ${target.name})`);
