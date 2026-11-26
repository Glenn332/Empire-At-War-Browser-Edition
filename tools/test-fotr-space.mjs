// Space battle fixes found in a Fall of the Republic skirmish: a double right-click sends fighters to the point,
// the fleet tender's heal pulse mends fighters, a mining asteroid comes back after Tactical_Respawn_Time_In_Secs,
// heroes take the big health bar of their size class and build queue items show the encyclopedia popup.
// Runs on the base game; with SWR_TEST_MOD pointing at Fall of the Republic it uses that mod's ships.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const modPath = process.env.SWR_TEST_MOD;
const archive = openGame(gameDir, modPath ? [modPath] : []);
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
const { execute } = await import('../public/js/game/commands.js');
const { useAbility, healPulseOf } = await import('../public/js/game/abilities.js');

const DT = 1 / 30;
const pick = (...names) => {
  for (const n of names) if (n && db.type(n)) return db.type(n);
  return null;
};
const fotr = !!pick('Class_C_Support') && !!pick('Hardcell_Tender');
const SHIP = pick(fotr ? 'Class_C_Frigate' : '', 'Star_Destroyer', 'Victory_I_Star_Destroyer'),
  SQUAD = pick(fotr ? 'Clone_ARC_170_Squadron' : '', 'TIE_Fighter_Squadron', 'X-Wing_Squadron'),
  // every Fall of the Republic ship with the Fleet tender pulse; none in the base game
  TENDERS = ['Class_C_Support', 'Skirmish_Pelta_Support', 'Pelta_Support', 'Munificent_Tender', 'DH_Omni', 'Hutt_Galleon', 'Jarl_Pelta']
    .map(n => pick(n))
    .filter(Boolean),
  PAD = pick('Mineral_Extractor_Pad');
assert(SHIP && SQUAD && PAD, 'the ships, squadron and mining pad of the test');
const PAD_BUILDS = S.buildListFor(PAD, 'Empire');
assert(PAD_BUILDS.length, 'the mining pad builds an extractor');
{
  const names = new Set(),
    seen = new Set();
  for (const t of [SHIP, SQUAD, ...TENDERS, PAD, ...PAD_BUILDS, ...PAD_BUILDS.map(t => db.type(t.str('Tactical_Buildable_Constructed')))].filter(Boolean)) S.modelsForType(t, null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const mapName = ['_MP_SPACE_ALDERAAN.TED', '_MP_SPACE_ATRAVIS_MADNESS.TED'].find(n => [...archive.index.keys()].some(k => k.endsWith(n)));
assert(mapName, 'a space map to fight on');
const map = await loadMap(mapName);
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });
function setup(seed = 11) {
  S.resetEntityIds();
  seedSim(seed);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const [a, b] = ['Empire', 'Rebel'].map((f, i) =>
    w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6, human: i === 0 }))
  );
  return { w, a, b };
}
const step = (w, s) => {
  for (let t = 0; t < s; t += DT) w.update(DT);
};

// 1. Double right-click with fighters and a ship selected: the squadron flies to the point at its own speed
// instead of escorting the ship; a plain right-click still has it escort.
{
  const run = max => {
    const { w, a } = setup(21);
    const ship = w.spawn(SHIP, a, -3000, 0, 0),
      sq = w.spawn(SQUAD, a, -3000, 500, 0);
    execute(w, a, { c: 'move', u: [ship.id, sq.id], x: 4000, y: 0, ...(max ? { fast: true } : {}) });
    return { w, ship, sq };
  };
  const plain = run(false);
  assert(plain.sq.order.wing && plain.sq.order.wing.escort === plain.ship, 'a plain move keeps the squadron with the ship');
  const quick = run(true);
  assert(quick.sq.order.kind === 'move' && quick.sq.order.pace === 1, 'a double-click move: squadron at its own pace');
  assert(!quick.sq.order.wing || !quick.sq.order.wing.escort, 'and escorting no ship');
  step(quick.w, 12);
  step(plain.w, 12);
  const lead = s => s.fighters[0];
  assert(lead(quick.sq).x > quick.ship.x + 100, 'the squadron runs ahead of the slower ship: ' + lead(quick.sq).x + ' vs ' + quick.ship.x);
  assert(lead(quick.sq).x > lead(plain.sq).x + 300, 'and gets further than an escort: ' + lead(quick.sq).x + ' vs ' + lead(plain.sq).x);
  console.log('double-click: squadron at x ' + lead(quick.sq).x.toFixed(0) + ', escort at ' + lead(plain.sq).x.toFixed(0));
}

// 2. The fleet tender (Fall of the Republic Class_C_Support): its HARMONIC_BOMB spawns Proj_Fleet_Tender_Fighter_Heal,
// which heals Fighter | Bomber inside Projectile_Instant_Heal_Radius by Projectile_Instant_Heal_Health_Increase.
for (const TENDER of TENDERS) {
  const { w, a, b } = setup(31);
  const tender = w.spawn(TENDER, a, 0, 0, 0),
    sq = w.spawn(SQUAD, a, 300, 0, 0),
    far = w.spawn(SQUAD, a, 3000, 0, 0),
    foe = w.spawn(SQUAD, b, 0, 400, 0);
  for (const q of [sq, far, foe]) {
    q.setOrder({ kind: 'idle' });
    for (const f of q.fighters) f.holdFire = true;
  }
  tender.holdFire = true;
  const st = tender.abilities.find(s => s.def.kind === 'HARMONIC_BOMB');
  assert(st, 'the tender has its heal pulse ability');
  const heal = healPulseOf(st.def),
    proj = db.type(st.def.node.val('Spawned_Object_Type'));
  assert(heal && proj, 'the ability spawns a healing projectile: ' + st.def.node.val('Spawned_Object_Type'));
  assert.equal(heal.radius, proj.num('Projectile_Instant_Heal_Radius', 0));
  const add = proj.num('Projectile_Instant_Heal_Health_Increase', 0);
  assert(add > 0, 'it heals some health');
  for (const q of [sq, far, foe]) for (const f of q.fighters) f.health = f.maxHealth * 0.4;
  const before = sq.fighters.map(f => f.health);
  const why = useAbility(w, tender, 'HARMONIC_BOMB', true, null);
  assert(!why, 'the pulse goes off: ' + why);
  step(w, 1.5);
  sq.fighters.forEach((f, i) =>
    assert(Math.abs(f.health - Math.min(f.maxHealth, before[i] + add)) < 1e-6, 'a fighter in reach is healed: ' + before[i] + ' -> ' + f.health)
  );
  for (const f of far.fighters) assert(f.health < f.maxHealth * 0.41, 'a fighter out of reach is not');
  for (const f of foe.fighters) assert(f.health < f.maxHealth * 0.41, 'an enemy fighter is not');
  assert(st.cooldown > 0, 'the ability recharges');
  // on autofire it goes off by itself when a hurt fighter is in reach
  st.cooldown = 0;
  st.auto = true;
  for (const f of sq.fighters) f.health = f.maxHealth * 0.4;
  step(w, 3);
  assert(sq.fighters.every(f => f.health > f.maxHealth * 0.4), 'autofire heals the hurt squadron');
  console.log(TENDER.name + ': fighters healed by ' + add + ' within ' + heal.radius);
}

// 3. The mining asteroid (Mineral_Extractor_Pad, Destroy_When_Child_Dies) goes with the extractor built on it and
// comes back after its Tactical_Respawn_Time_In_Secs, neutral and empty.
{
  const { w, a } = setup(41);
  const respawn = PAD.num('Tactical_Respawn_Time_In_Secs', 0);
  assert(respawn > 0 && PAD.bool('Destroy_When_Child_Dies'), 'the pad respawns and dies with its child in the XML');
  const pad = w.spawn(PAD, w.neutral, 2000, 2000, 0);
  pad.mapIndex = 9001;
  assert(pad.isPad, 'the asteroid is a build pad');
  pad.padOwner = a;
  assert(!w.startBuild(pad, PAD_BUILDS[0], a), 'the extractor goes up');
  const uc = pad.padChild;
  assert(uc && uc.construction, 'under construction on the pad');
  step(w, uc.construction.total + 1);
  const built = pad.padChild;
  assert(built && !built.construction && !built.dead, 'the extractor is built: ' + (built && built.type.name));
  w.kill(built, null);
  assert(pad.dead, 'the asteroid goes with its extractor');
  const back = () => w.units.find(u => !u.dead && u.type === PAD && u.mapIndex === 9001);
  step(w, 1);
  assert(!back(), 'and is not back at once');
  step(w, respawn - 2);
  assert(!back(), 'nor before ' + respawn + ' s');
  step(w, 2);
  const again = back();
  assert(again, 'it is back after ' + respawn + ' s');
  assert(!again.padChild && !again.padOwner && Math.hypot(again.x - 2000, again.y - 2000) < 1, 'empty, unowned and where it was');
  console.log('mining asteroid back after ' + respawn + ' s');
}

// 4. Health bar under a hero's icon: a large hero ship keeps the bar a ship its size has; squadrons and small heroes
// keep the icon's grab-bar width.
{
  const { overlayBarWidth } = await import('../public/js/game/ui.js');
  const big = { isSquad: false, isFighter: false },
    sq = { isSquad: true };
  assert.equal(overlayBarWidth(big, false, 70, 28, 40), 105, 'a ship without an icon: as wide as it shows');
  assert.equal(overlayBarWidth(big, true, 70, 28, 40), 105, 'a large hero ship under its icon: the same bar');
  assert.equal(overlayBarWidth(big, true, 10, 28, 40), 40, 'a small hero ship: the grab bar');
  assert.equal(overlayBarWidth(sq, true, 70, 28, 40), 40, 'a squadron: the grab bar');
  assert.equal(overlayBarWidth(big, true, 70, 28, 0), 105, 'no grab bar skin: still by size');
  const hero = pick(fotr ? 'Yularen_Resolute' : '', 'Home_One');
  if (hero) {
    const { w, a } = setup(51);
    const names = new Set(),
      seen = new Set();
    S.modelsForType(hero, null, names, seen);
    await preloadModels([...names].filter(Boolean));
    const h = w.spawn(hero, a, 0, 0, 0);
    assert(!h.isSquad && !h.isFighter, hero.name + ' is a hero ship');
    assert(overlayBarWidth(h, true, 80, 28, 40) > 40, hero.name + ' takes the large bar under its icon');
  }
  // the overlay draws with it
  const src = readFileSync(new URL('../public/js/game/ui.js', import.meta.url), 'utf8');
  assert(/const w = overlayBarWidth\(s, hasIcon, r, size, grabHealth\)/.test(src), 'drawOverlay sizes the bar with overlayBarWidth');
}

// 5. Build queue items show the encyclopedia popup of what they build, as the unit buttons do.
{
  const { CommandBar } = await import('../public/js/game/hud.js');
  const type = SHIP,
    calls = [];
  const bar = {
    queueSlots: [{ _item: { it: { type }, u: { id: 3 }, name: 'q' } }, { _item: null }],
    tipOn: (id, t) => calls.push(['on', id, t]),
    hideInfo: () => calls.push(['off'])
  };
  CommandBar.prototype.queueHover.call(bar, 0, true);
  CommandBar.prototype.queueHover.call(bar, 0, false);
  CommandBar.prototype.queueHover.call(bar, 1, true);
  assert.deepEqual(calls, [['on', 'queue0', type], ['off'], ['off']], 'hovering a queue item targets the encyclopedia with its type');
  const shown = [];
  const info = { tipTarget: null, world: { cantBuild: () => '' }, player: {}, showInfo: (t, o) => shown.push([t, o]) };
  CommandBar.prototype.tipOn.call(info, 'queue0', type);
  info.tipTarget.show();
  assert(shown.length === 1 && shown[0][0] === type, 'which shows the same popup the unit buttons show');
  const src = readFileSync(new URL('../public/js/game/hud.js', import.meta.url), 'utf8');
  const make = src.slice(src.indexOf('this.queueSlots = [];'), src.indexOf('this.queueSlots.push(q);'));
  assert(/q\.onmouseenter = \(\) => this\.queueHover\(i, true\)/.test(make), 'every queue slot enters the hover');
  assert(/q\.onmouseleave = \(\) => this\.queueHover\(i, false\)/.test(make), 'and leaves it');
}

console.log('fotr space tests passed' + (fotr ? ' (Fall of the Republic data)' : ''));
