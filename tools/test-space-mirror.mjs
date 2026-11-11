import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const arg = k => {
  const i = process.argv.indexOf(k);
  return i < 0 ? null : process.argv[i + 1];
};
const mod = arg('--mod'),
  verbose = process.argv.includes('--verbose');
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
const { db, loadGameData, spawnList } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadMap } = await import('../public/js/ted.js');
const { preloadModels } = await import('../public/js/model.js');
const S = await import('../public/js/game/sim.js');
const { seedSim } = await import('../public/js/game/simrandom.js');
const { SpaceRecorder } = await import('../public/js/game/spacerecord.js');
const { keeper, hookBattle, stepRecord } = await import('../public/js/game/spacebattlehooks.js');
const { SpaceMirror } = await import('../public/js/game/spacemirror.js');
const { execute } = await import('../public/js/game/commands.js');
const { placeSpecialWeapons } = await import('../public/js/game/superweapon.js');

const TICK = 1 / 30;
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const mapFile =
  (arg('--map') && maps.find(n => n.includes(arg('--map').toUpperCase()))) ||
  maps.find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n)) ||
  maps.find(n => /SPACE/.test(n));
assert(mapFile, 'a space map');
const map = await loadMap(mapFile.split('\\').pop());

const stationOf = f => [...db.types.values()].find(t => new RegExp('^Skirmish_' + f + '_Star_Base_1$', 'i').test(t.name));
const sensor = [...db.types.values()].find(
  t => t.behaviors().has('CAPTURE_POINT') && !t.behaviors().has('BUILD_PAD') && /sensor/i.test(t.name) && t.str('Space_Model_Name')
);
const squadOf = f =>
  [...db.types.values()].find(
    t =>
      S.isSquadronType(t) &&
      t
        .str('Affiliation')
        .toUpperCase()
        .split(/[,\s]+/)
        .includes(f.toUpperCase()) &&
      t.num('Build_Cost_Credits', 0) > 0
  );
const empire = { faction: 'Empire', station: stationOf('Empire'), at: [-3000, 0] },
  rebel = { faction: 'Rebel', station: stationOf('Rebel'), at: [3000, 0] };
assert(empire.station && rebel.station, 'skirmish stations');
const empireSquad = squadOf('Empire'),
  rebelSquad = squadOf('Rebel');
assert(empireSquad && rebelSquad, 'squadron types');
const sideOf = t =>
  ['EMPIRE', 'REBEL'].findIndex(f =>
    t
      .str('Affiliation')
      .toUpperCase()
      .split(/[,\s]+/)
      .includes(f)
  );
const carrier = [...db.types.values()].find(
  t => t.tag === 'SpaceUnit' && t.str('Space_Model_Name') && sideOf(t) >= 0 && spawnList(t, 1).length
);
assert(carrier, 'a ship that launches fighters');

const names = new Set(),
  seen = new Set();
for (const t of [empire.station, rebel.station, sensor, empireSquad, rebelSquad, carrier].filter(Boolean))
  S.modelsForType(t, null, names, seen);
for (const e of spawnList(carrier, 1)) S.modelsForType(e.type, null, names, seen);
for (const side of [empire, rebel])
  for (const n of db.faction(side.faction).list('Space_Skirmish_AI_Default_Forces')) {
    const t = db.type(n);
    if (t) S.modelsForType(t, null, names, seen);
  }
await preloadModels([...names].filter(Boolean));

function build(events) {
  S.resetEntityIds();
  seedSim(7);
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
  const sides = [empire, rebel].map((side, i) => {
    const team = w.addTeam(new S.Team(i, side.faction));
    const p = w.addPlayer(new S.Player(i, team, { human: i === 0, credits: 20000, color: new THREE.Color(i ? 0xff0000 : 0x00ff00) }));
    team.spawnPoints.push({ x: side.at[0] * 0.8, y: 600, heading: 0 });
    team.station = team.firstStation = w.spawn(side.station, p, side.at[0], side.at[1], i ? Math.PI : 0);
    for (const [k, n] of db.faction(side.faction).list('Space_Skirmish_AI_Default_Forces').entries()) {
      const t = db.type(n);
      if (t) w.spawn(t, p, side.at[0] * 0.7, -800 + k * 200, i ? Math.PI : 0);
    }
    return p;
  });
  w.viewer = sides[0];
  w.spawn(carrier, sides[sideOf(carrier)], sideOf(carrier) ? 1200 : -1200, 900, 0);
  if (sensor) w.spawn(sensor, w.neutral, -1600, -700, 0);
  placeSpecialWeapons(w, map.objects);
  w.recountPop();
  return w;
}

const events = [],
  spawns = [];
const truth = build(events);
events.length = 0;
const undo = hookBattle(truth, events, spawns);
const told = [],
  heard = [];
const hooked = truth.onEvent;
truth.onEvent = (kind, data) => {
  told.push([kind, data]);
  hooked(kind, data);
};
const page = build(null);
page.onEvent = (kind, data) => heard.push([kind, data]);
const game = new Proxy({ world: page, advisor: undefined, lock: undefined, reveal: false }, { get: (t, k) => (k in t ? t[k] : nothing) });
const mirror = SpaceMirror.headless(game);
for (const e of [...page.units, ...page.squads, ...page.squads.flatMap(q => q.fighters)]) mirror.match(e.id, e);
const rec = new SpaceRecorder(truth);

const simOnly = {
  unit: [
    'capAff',
    'cull',
    'energy',
    'enemies',
    'flip',
    'flyBy',
    'flyTimer',
    'garrison',
    'home',
    'homeOf',
    'launchZ',
    'fstate',
    'fireCone',
    'fireIdle',
    'gridAt',
    'hitReach',
    'hurtBy',
    'income.rate',
    'income.timer',
    'influences',
    'ionStormAt',
    'isField',
    'jammedAt',
    'lastAttacker',
    'l1x',
    'l1y',
    'l1z',
    'l2x',
    'l2y',
    'l2z',
    'lastNormalHit',
    'lossAt',
    'lossRate',
    'pathExt',
    'pathOff',
    'pickAt',
    'scanTimer',
    'shieldAt',
    'shieldDownTimer',
    'shieldTick',
    'spawnTimer',
    'weapon',
    'weapons',
    'going',
    'cruise',
    'order.startAt',
    'order.force',
    'hyper.f',
    'hyper.tx',
    'hyper.ty',
    'hyper.h'
  ],
  squad: [
    'aim',
    'chase',
    'fireTarget',
    'pickHp',
    'pickOf',
    'goal',
    'guardAt',
    'guardOf',
    'home',
    'homeOf',
    'idleFrom',
    'err',
    'alone',
    'route',
    'routed',
    'order.group',
    'order.pace',
    'order.wing',
    'order.force',
    'cruise',
    'scanTimer',
    'tolerance',
    'travel'
  ]
};
const IGNORE = new Set([...simOnly.unit.flatMap(k => ['Unit.' + k, 'Fighter.' + k]), ...simOnly.squad.map(k => 'Squad.' + k)]);

const diffs = new Map();
const note = (key, msg) => {
  const d = diffs.get(key);
  if (d) d.n++;
  else diffs.set(key, { n: 1, msg });
};
const isEntity = v => v instanceof S.Unit || v instanceof S.Squad;
const twin = a => (isEntity(a) ? mirror.byW.get(a.id) : null);
const unset = v => v === undefined || v === null || v === false || v === 0;
function same(a, b, depth, path) {
  if (a === b || (unset(a) && unset(b))) return true;
  if (isEntity(a) && a.dead && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number')
    return (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(a));
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (isEntity(a)) return twin(a) === b;
  if (a instanceof S.Player) return b instanceof S.Player && a.id === b.id;
  if (a instanceof S.Team) return b instanceof S.Team && truth.teams.indexOf(a) === page.teams.indexOf(b);
  if (typeof a.str === 'function' && typeof a.name === 'string') return a.name === b.name;
  if (a.isColor) return a.getHex() === b.getHex?.();
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i], depth + 1, path));
  if (a instanceof Set) return b instanceof Set && a.size === b.size && [...a].every(x => [...b].some(y => same(x, y, depth + 1, path)));
  if (a instanceof Map) {
    const full = m => new Map([...m].filter(([, v]) => !(Array.isArray(v) && !v.length)));
    a = full(a);
    b = b instanceof Map ? full(b) : b;
  }
  if (a instanceof Map)
    return (
      b instanceof Map &&
      a.size === b.size &&
      [...a].every(([k, v]) => [...b].some(([k2, v2]) => same(k, k2, depth + 1, path) && same(v, v2, depth + 1, path)))
    );
  if (Object.getPrototypeOf(a) !== Object.prototype) return true;
  if (depth > 2) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys)
    if (typeof a[k] !== 'function' && !IGNORE.has(path + '.' + k) && !same(a[k], b[k], depth + 1, path + '.' + k)) return false;
  return true;
}
const show = v =>
  isEntity(v)
    ? v.type.name + '#' + v.id
    : v instanceof S.Player
      ? 'player ' + v.id
      : v && typeof v === 'object'
        ? JSON.stringify(v, (k, x) =>
            isEntity(x) ? x.type.name + '#' + x.id : x instanceof S.Player ? 'P' + x.id : x && x.isColor ? '#' : x
          )?.slice(0, 120)
        : String(v);
const plainObject = v => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
function where(a, b, key) {
  if (a instanceof Map && b instanceof Map) {
    for (const [k, v] of a) if (!same(v, b.get(k), 1, key)) return where(v, b.get(k), key + '[]');
    return [key, a, b];
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i], 1, key)) return where(a[i], b[i], key + '[]');
    return [key, a, b];
  }
  if (!plainObject(a) || !plainObject(b)) return [key, a, b];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (typeof a[k] !== 'function' && !IGNORE.has(key + '.' + k) && !same(a[k], b[k], 1, key + '.' + k))
      return where(a[k], b[k], key + '.' + k);
  return [key, a, b];
}
function compareObject(kind, a, b) {
  for (const k of Object.keys(a)) {
    const key = kind + '.' + k;
    if (k === 'id') continue;
    if (IGNORE.has(key) || typeof a[k] === 'function') continue;
    if (!same(a[k], b[k], 0, key)) {
      const [at, x, y] = where(a[k], b[k], key);
      note(at, `${show(a)?.slice(0, 40)}: worker ${show(x)} page ${show(y)}`);
    }
  }
}
const isPlain = v => v && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype);
function sameEvent(a, b, depth) {
  if (a === truth) return b === page;
  if (a && a.isVector3) return !!b && b.isVector3 === true && a.distanceTo(b) < 1e-3;
  if (
    a === null ||
    typeof a !== 'object' ||
    isEntity(a) ||
    a instanceof S.Player ||
    a instanceof S.Team ||
    a instanceof Map ||
    a instanceof Set
  )
    return same(a, b, 0, 'event');
  if (typeof a.str === 'function' && typeof a.name === 'string') return same(a, b, 0, 'event');
  if (a.isColor) return same(a, b, 0, 'event');
  if (!b || typeof b !== 'object') return false;
  if (depth > 2) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameEvent(x, b[i], depth + 1));
  for (const k of Object.keys(a)) {
    const v = a[k];
    if (typeof v === 'function' || v === truth.fx || v === truth.audio) continue;
    if (!isPlain(a) && v && typeof v === 'object' && !isEntity(v) && !(v instanceof S.Player) && v !== truth) continue;
    if (!sameEvent(v, b[k], depth + 1)) return false;
  }
  return true;
}
const eventKinds = new Set();
function compareEvents() {
  assert.equal(heard.length, told.length, 'the page heard as many battle events as the worker told');
  for (const [i, [kind, data]] of told.entries()) {
    const [pageKind, pageData] = heard[i];
    eventKinds.add(kind);
    if (pageKind !== kind || !sameEvent(data, pageData, 0))
      note(
        'event.' + kind,
        `the page got ${pageKind} with ${Object.keys(pageData || {}).join(', ')} for worker data ${Object.keys(data || {}).join(', ')}`
      );
  }
  told.length = heard.length = 0;
}
const covered = new Set();
function cover() {
  for (const q of truth.squads) {
    if (q.dead) continue;
    if (q.hyper) covered.add('squadron in hyperspace');
    if (q.fighters[0]?.hyper && !q.fighters[0].hyper.shown) covered.add('ships hidden in the jump');
    if (q.carrier) covered.add('garrison launch');
    if (q.fighters.length < q.members.length) covered.add('fighter losses');
    if (q.target) covered.add('squadron target');
    if (q.mode === 'idle' && q.about?.cell) covered.add('idle squadron anchor');
    if (twin(q) && twin(q).id !== q.id) covered.add('entity spawned mid-battle');
  }
  if (truth.units.some(u => u.type === sensor && u.player.id >= 0)) covered.add('capture');
  if (truth.units.some(u => u.capture?.progress > 0)) covered.add('capture progress');
  if (foe.station && foe.station !== foe.team.firstStation) covered.add('station upgrade');
  if (me.upgrades.size) covered.add('upgrade');
  if (me.stats.killed || foe.stats.killed) covered.add('kills');
  if (me.everBought?.size) covered.add('lifetime build count');
}
function compare() {
  cover();
  for (const u of truth.units) {
    if (u.dead) continue;
    const p = twin(u);
    if (!p) {
      note('missing.' + (u.isFighter ? 'fighter' : 'unit'), u.type.name + '#' + u.id);
      continue;
    }
    compareObject(u.isFighter ? 'Fighter' : 'Unit', u, p);
  }
  for (const q of truth.squads) {
    if (q.dead) continue;
    const p = twin(q);
    if (!p) {
      note('missing.squad', q.type.name + '#' + q.id);
      continue;
    }
    compareObject('Squad', q, p);
    if (S.hiddenInJump(q) !== S.hiddenInJump(p)) note('overlay.hiddenInJump', q.type.name + '#' + q.id + ': worker ' + S.hiddenInJump(q));
    if (S.hiddenInJump(q) && p.fighters.some(f => f.obj.scale.x > 0.01)) note('overlay.hiddenShipsShown', q.type.name + '#' + q.id);
  }
  truth.players.forEach((pl, i) => compareObject('Player', pl, page.players[i]));
  truth.teams.forEach((t, i) => compareObject('Team', t, page.teams[i]));
}

const [me, foe] = truth.players.filter(p => p.id >= 0);
const want = [
  'squadron in hyperspace',
  'ships hidden in the jump',
  'garrison launch',
  'fighter losses',
  'squadron target',
  'idle squadron anchor',
  'entity spawned mid-battle',
  'capture',
  'capture progress',
  'station upgrade',
  'upgrade',
  'kills',
  'lifetime build count',
  'beacon event',
  'special weapon event'
];
const steps = +(arg('--steps') || 1200);
const at = {
  30: () => {
    me.reinforcements.push(empireSquad);
    assert.deepEqual(execute(truth, me, { c: 'reinforce', type: empireSquad.name, x: -2200, y: 300, h: 0 }), {});
  },
  60: () => {
    const t = truth.buildOptions(me.station, me).find(t => S.isSquadronType(t));
    assert(t, 'the station builds a squadron');
    assert.deepEqual(execute(truth, me, { c: 'build', b: me.station.id, type: t.name }), {});
  },
  90: () => {
    const up = [...db.types.values()].find(t => S.isUpgradeType(t) && t.str('Affiliation').toUpperCase().includes('EMPIRE'));
    if (up) truth.applyUpgrade(me, up);
  },
  120: () => {
    const q = truth.squads.find(s => !s.dead && s.player === foe);
    if (q) for (const f of q.fighters.slice(0, 1)) truth.damage(f, 1e9, { quiet: true });
  },
  150: () => {
    const q = truth.squads.find(s => !s.dead && s.player === me && !s.hyper && s.fighters[0]?.isFighter),
      s = truth.units.find(u => !u.dead && u.type === sensor);
    if (q && s) execute(truth, me, mirror.ours({ c: 'move', u: [twin(q).id], x: s.x, y: s.y }));
  },
  200: () => {
    const q = truth.squads.filter(s => !s.dead && s.player === me && !s.hyper).pop();
    execute(truth, me, mirror.ours({ c: 'formmove', p: [[twin(q).id, -1000, -1000]], h: 0 }));
  },
  260: () => truth.upgradeStation(foe, foe.station),
  320: () => {
    assert.deepEqual(execute(truth, me, { c: 'beacon', x: 0, y: 0, z: 0 }), {});
  },
  340: () => {
    const sw = truth.specialWeapons.find(s => s.player === me),
      up = [...db.types.values()].find(
        t =>
          (t.bool('Is_Skirmish_Tactical_Super_Weapon') || t.bool('Enable_Special_Weapons')) &&
          t.str('Affiliation').toUpperCase().includes('EMPIRE')
      );
    assert(sw && up, 'a special weapon and the upgrade that arms it');
    me.upgrades.add(up.name);
    const t = [...truth.units, ...truth.squads].find(u => sw.canTarget(u));
    assert(t, 'a special weapon target');
    assert.equal(sw.fire(t), null);
  },
  300: () => {
    for (const f of truth.squads.find(s => !s.dead && s.player === foe)?.fighters || []) [f.x, f.y] = [me.station.x + 300, me.station.y];
  }
};
for (let i = 1; i <= steps; i++) {
  at[i]?.();
  if (verbose && i % 150 === 0) {
    const s = truth.units.find(u => u.type === sensor);
    console.log(`step ${i}: sensor capture ${s?.capture?.progress.toFixed(1)}, ${diffs.size} fields differ`);
  }
  truth.updateBegin(TICK);
  truth.updateSome(Infinity);
  truth.updateEnd();
  const { message } = stepRecord(truth, rec, spawns, events);
  mirror.apply(structuredClone(message));
  compareEvents();
  compare();
}
undo();
if (eventKinds.has('beacon')) covered.add('beacon event');
if (eventKinds.has('specialWeaponFired')) covered.add('special weapon event');
if (verbose) console.log('battle events seen: ' + [...eventKinds].sort().join(', '));

const s = truth.units.find(u => u.type === sensor);
console.log(
  `map ${mapFile.split('\\').pop()}, ${steps} steps, ${truth.units.filter(u => !u.dead).length} units, ${truth.squads.filter(q => !q.dead).length} squads, sensor owner ${s?.player.id}, station ${foe.station?.type.name}`
);
const list = [...diffs].sort((a, b) => b[1].n - a[1].n);
for (const [k, d] of list) console.log(`${k}  x${d.n}  ${verbose ? d.msg : d.msg.slice(0, 140)}`);
assert.equal(list.length, 0, `${list.length} fields differ between the battle worker and the page`);
const missed = want.filter(k => !covered.has(k));
assert.deepEqual(missed, [], 'the battle never reached: ' + missed.join(', '));
assert.equal(mirror.stats.failed, 0, 'every battle event plays on the page');
console.log('space mirror parity ok');
