import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
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



const DT = 1 / 30,
  DEG = Math.PI / 180;
const T = n => {
  const t = db.type(n);
  assert(t, n);
  return t;
};
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const near = (a, b, eps, why) => assert(Math.abs(a - b) <= eps, why + ': ' + a + ' vs ' + b);

const maps = [...archive.index.keys()].filter(n => /\\MAPS\\[^\\]*\.TED$/.test(n));
const map = await loadMap(
  maps
    .find(n => /_SPACE_PLANET_/.test(n) && /KUAT/.test(n))
    .split('\\')
    .pop()
);
const used = ['Star_Destroyer', 'Corellian_Corvette', 'Nebulon_B_Frigate', 'Calamari_Cruiser', 'X-Wing', 'Empire_Star_Base_1'];
{
  const names = new Set(),
    seen = new Set();
  for (const n of used) S.modelsForType(T(n), null, names, seen);
  await preloadModels([...names].filter(Boolean));
}
const nothing = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : nothing), apply: () => undefined });
function battle(seed) {
  S.resetEntityIds();
  seedSim(seed);
  const w = new S.World({ scene: new THREE.Scene(), fx: nothing, audio: nothing, map });
  w.modelOpts = { headless: true };
  w.artReady = () => true;
  w.onEvent = () => {};
  w.fog = false;
  const [empire, rebel] = ['Empire', 'Rebel'].map((f, i) =>
    w.addPlayer(new S.Player(i, w.addTeam(new S.Team(i, f)), { credits: 1e6, human: i === 0 }))
  );
  const run = secs => {
    for (let n = Math.round(secs / DT); n > 0; n--) w.update(DT);
  };
  return { w, empire, rebel, run };
}
const M = db.constants.num('Object_Max_Speed_Multiplier_Space', 1);

// 1. Bank: limited by Bank_Turn_Angle, moves at Max_Rate_Of_Roll, scaled by how hard the ship turns.
for (const name of ['Star_Destroyer', 'Calamari_Cruiser', 'Corellian_Corvette']) {
  const t = T(name),
    bank = t.num('Bank_Turn_Angle', 0) * DEG,
    rollRate = t.num('Max_Rate_Of_Roll', 0) * 30 * DEG * M;
  assert(bank > 0 && rollRate > 0, name + ' banks in the XML');
  const { w, empire } = battle(11);
  const u = w.spawn(t, empire, 0, 0, 0);
  assert.equal(u.bankAngle, bank, name + ' bank angle is Bank_Turn_Angle in radians');
  assert.equal(u.rollRate, rollRate, name + ' roll rate is Max_Rate_Of_Roll per logic frame');
  // a hard, long turn: most of the angle is reached, never passed, and never faster than the roll rate
  u.speed = u.maxSpeed;
  u.setOrder({ kind: 'move', x: -3000, y: 1500 });
  let top = 0,
    step = 0,
    last = 0;
  for (let n = 0; n < 30 * 120; n++) {
    w.update(DT);
    top = Math.max(top, Math.abs(u.roll));
    step = Math.max(step, Math.abs(u.roll - last));
    last = u.roll;
  }
  assert(top <= bank + 1e-9, `${name} never banks past ${(bank / DEG).toFixed(1)} degrees: ${(top / DEG).toFixed(2)}`);
  assert(top > bank * 0.5, `${name} leans well into a hard turn: ${(top / DEG).toFixed(2)}`);
  assert(step <= rollRate * DT + 1e-9, `${name} rolls no faster than Max_Rate_Of_Roll: ${step} vs ${rollRate * DT}`);
  // straight on, no lean
  const h = battle(13),
    s = h.w.spawn(t, h.empire, 0, 0, 0);
  s.speed = s.maxSpeed;
  s.setOrder({ kind: 'move', x: 6000, y: 0 });
  h.run(5);
  near(s.roll, 0, 1e-9, name + ' flies level on a straight leg');
}
{
  // the lean follows the share of Max_Rate_Of_Turn actually used
  const t = T('Star_Destroyer');
  const lean = share => {
    const { w, empire } = battle(14),
      u = w.spawn(t, empire, 0, 0, 0);
    u.rollRate = 1e6;
    u.roll = 0;
    const turn = u.turnRate * DT * share;
    S.bankIntoTurn(u, turn, u.turnRate, DT);
    return u.roll / u.bankAngle;
  };
  near(lean(1), 1, 1e-9, 'full turn rate, full bank');
  near(lean(0.5), 0.5, 1e-9, 'half the turn rate, half the bank');
  near(lean(0.1), 0.1, 1e-9, 'a tenth of the turn rate, a tenth of the bank');
  near(lean(-0.5), -0.5, 1e-9, 'the other way, the other side');
}

// 2. Double right-click: the command flag reaches the sim and every ship goes at its own top speed.
const { execute } = await import('../public/js/game/commands.js');
{
  const start = flag => {
    const { w, empire, run } = battle(21);
    const sd = w.spawn(T('Star_Destroyer'), empire, 0, 0, 0),
      cv = w.spawn(T('Corellian_Corvette'), empire, 0, 200, 0);
    assert(cv.maxSpeed > sd.maxSpeed, 'the corvette is the faster ship');
    execute(w, empire, { c: 'move', u: [sd.id, cv.id], x: 7000, y: 100, ...(flag ? { fast: true } : {}) });
    return { sd, cv, w, run, empire };
  };
  const plain = start(false);
  assert(plain.cv.order.pace < 1, 'a plain move holds the faster ship to the formation pace: ' + plain.cv.order.pace);
  assert.equal(plain.sd.order.pace, 1);
  const quick = start(true);
  assert.equal(quick.cv.order.pace, 1, 'a double-click move skips the formation pace');
  assert.equal(quick.sd.order.pace, 1);
  plain.run(12);
  quick.run(12);
  const top = u => u.maxSpeed * u.bonus.speed * u.mods.speed;
  assert(Math.abs(quick.cv.speed - top(quick.cv)) < top(quick.cv) * 0.02, 'the corvette runs at its own top speed: ' + quick.cv.speed);
  assert(plain.cv.speed < top(plain.cv) * 0.95, 'matched to the group it runs slower: ' + plain.cv.speed);
  assert(quick.cv.x > plain.cv.x, 'and gets further');
  const am = start(false);
  execute(am.w, am.empire, { c: 'move', u: [am.sd.id, am.cv.id], x: 7000, y: 100, attack: true, fast: true });
  assert.equal(am.cv.order.pace, 1, 'a double-click attack move rushes as well');
  const other = start(false);
  execute(other.w, other.w.players[1], { c: 'move', u: [other.sd.id], x: 100, y: 100, fast: true });
  assert.notEqual(other.sd.order.x, 100, 'only the owner moves a ship');
}
{
  const { DoubleClick, DOUBLE_CLICK_MS } = await import('../public/js/game/doubleclick.js');
  const d = new DoubleClick();
  assert(!d.hit(100, 100, 0), 'the first click is single');
  assert(d.hit(103, 99, DOUBLE_CLICK_MS - 1), 'a second click on the same spot in time is double');
  assert(!d.hit(103, 99, DOUBLE_CLICK_MS), 'the pair is used up, a third starts a new one');
  assert(!d.hit(300, 100, DOUBLE_CLICK_MS + 10), 'a click elsewhere is single');
  assert(!d.hit(300, 100, DOUBLE_CLICK_MS * 3), 'too late is single');
}

// 3. Hero icons: every slot has the encyclopedia hover wired, in space, land and on the galactic map.
{
  const { CommandBar } = await import('../public/js/game/hud.js');
  const { GalacticBar } = await import('../public/js/game/galactichud.js');
  const { GalacticGame } = await import('../public/js/game/galactic.js');
  const { TooltipGate } = await import('../public/js/game/tooltipgate.js');
  const type = T('Star_Destroyer'),
    h = { e: { id: 7 }, type };
  const calls = [];
  const bar = { tipOn: (id, t) => calls.push(['on', id, t]), hideInfo: () => calls.push(['off']) };
  CommandBar.prototype.heroHover.call(bar, h, true);
  CommandBar.prototype.heroHover.call(bar, h, false);
  assert.deepEqual(calls, [['on', 'hero7', type], ['off']], 'hovering a hero slot targets the encyclopedia with its type');
  // that target is what refreshInfo hands to the gate, which shows the unit encyclopedia box
  const shown = [];
  const enc = { shown: null, root: { style: {} }, hide() {}, hideLinked() {} };
  const gate = new TooltipGate({ delayTooltips: false }, enc);
  const info = { tipTarget: null, world: { cantBuild: () => '' }, player: {}, showInfo: (t, o) => shown.push([t, o]) };
  CommandBar.prototype.tipOn.call(info, 'hero7', type);
  assert(info.tipTarget && typeof info.tipTarget.show === 'function', 'the hover leaves a gate target');
  info.tipTarget.show();
  assert(shown.length === 1 && shown[0][0] === type, 'which shows the same popup the unit buttons show');
  assert(gate, 'gate constructed');
  // galactic map
  const game = { heroTip: null };
  GalacticBar.prototype.heroHover.call({ game }, h, true);
  assert.equal(game.heroTip.type, type);
  GalacticBar.prototype.heroHover.call({ game }, { e: { id: 8 }, type }, false);
  assert(game.heroTip, 'leaving another slot keeps this hero hover');
  GalacticBar.prototype.heroHover.call({ game }, h, false);
  assert.equal(game.heroTip, null);
  const hits = [],
    typed = [];
  const fake = {
    galacticLog: { encyclopedia: { showType: t => typed.push(t) } },
    tips: { update() {}, hover: t => hits.push(t) },
    heroTip: { id: 7, type }
  };
  GalacticGame.prototype.corruptionTip.call(fake);
  assert.equal(hits.length, 1, 'the galactic tooltip pass takes the hero hover first');
  hits[0].show();
  assert.deepEqual(typed, [type], 'and shows the unit encyclopedia for the hero type');
  // wiring in the slot builder and the style sheet
  const src = readFileSync(new URL('../public/js/game/hud.js', import.meta.url), 'utf8');
  const row = src.slice(src.indexOf('  heroRow(side, list)'));
  assert(/d\.onmouseenter = \(\) => this\.heroHover\(d\._h, true\)/.test(row), 'every slot enters the hero hover');
  assert(/d\.onmouseleave = \(\) => this\.heroHover\(d\._h, false\)/.test(row), 'and leaves it');
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert(/\.heroslot \{[^}]*pointer-events: auto/.test(css), 'hero slots take the pointer, enemy heroes too');
}
console.log('controls, tilt and hero icon tests passed');
