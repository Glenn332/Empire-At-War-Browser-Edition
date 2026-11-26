// The tactical pointer holds steady while the mouse rests on an enemy. Fall of the Republic battles swarm every
// enemy ship with squadrons: an own squadron icon crossing the cursor took the hover for a frame and handed it
// back, so the pointer flipped between POINTER_ATTACK and POINTER_SELECT many times a second (space), and on land
// a member walking across the hovered squad or a refresh landing on the edge of a pick flipped it between
// POINTER_ATTACK and POINTER_MOVE. Animated pointer frames are named by their trailing frame number.
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { UI } = await import('../public/js/game/ui.js');
const { LandUI } = await import('../public/js/game/landhud.js');
const { LandGame } = await import('../public/js/game/landgame.js');
const { tacticalPointer, pointerFrameName, Pointers } = await import('../public/js/game/pointers.js');

// animated pointer frame names
assert.equal(pointerFrameName('ATTACKPOINTER_00', 0), 'ATTACKPOINTER_00');
assert.equal(pointerFrameName('ATTACKPOINTER_00', 3), 'ATTACKPOINTER_03');
assert.equal(pointerFrameName('MAP_SCROLLING_MODE_POINTER_00', 1), 'MAP_SCROLLING_MODE_POINTER_01');
assert.equal(pointerFrameName('cantpointer', 0), 'cantpointer');
assert.equal(pointerFrameName('cantpointer', 1), null, 'a texture without a frame number is a single frame');
assert.equal(pointerFrameName('P10_SPECIAL_00', 2), 'P10_SPECIAL_02', 'a digit earlier in the name is not the frame number');

// ---- space ----
const me = { id: 0, team: { id: 0 } },
  foe = { id: 1, team: { id: 1 } };
const enemy = { id: 10, player: foe, x: 0, y: 0, z: 0, sx: 400, sy: 300, r: 120, hardpoints: [] },
  ownSquad = { id: 11, player: me, isSquad: true, fighters: [{}], sx: 430, sy: 310, r: 20 };

function spaceUI(pickAt) {
  const ui = Object.create(UI.prototype);
  Object.assign(ui, {
    hover: null,
    drag: null,
    placing: null,
    player: me,
    overlayFrame: 1,
    frame: 0,
    pick: (x, y) => pickAt(ui.frame, x, y),
    systemUnder: () => null,
    amongHardpoints: () => false,
    hardpointAt: () => null,
    sees: () => true,
    screenOf: (s, out = {}) => Object.assign(out, { x: s.sx, y: s.sy, behind: false }),
    screenRadius: s => s.r
  });
  return ui;
}
const spacePointer = (ui, h) =>
  tacticalPointer({
    hover: !h ? null : h.player === ui.player ? 'own' : h.player.id >= 0 && h.player.team !== ui.player.team ? 'enemy' : 'other',
    act: true,
    attack: true
  });

{
  // an own squadron icon crosses the resting cursor every other frame (icons win the pick)
  const ui = spaceUI((f, x, y) => (f % 2 ? ownSquad : enemy));
  const m = { x: 410, y: 305, inside: true };
  const seen = [];
  for (ui.frame = 0; ui.frame < 12; ui.frame++) {
    ui.updateHover(m);
    seen.push(spacePointer(ui, ui.hover));
  }
  assert.deepEqual(new Set(seen), new Set(['POINTER_ATTACK']), `space pointer held: ${seen.join(' ')}`);

  // the mouse moves onto the squadron: the hover follows the mouse
  ui.frame = 1;
  m.x = 431;
  ui.updateHover(m);
  assert.equal(ui.hover, ownSquad, 'moving the mouse re-picks');

  // the hovered enemy leaves the resting cursor: the hover is picked again
  const ui2 = spaceUI(() => null);
  ui2.hover = enemy;
  ui2.hoverX = 410;
  ui2.hoverY = 305;
  const away = { ...enemy, sx: 900, sy: 700 };
  ui2.hover = away;
  ui2.updateHover({ x: 410, y: 305, inside: true });
  assert.equal(ui2.hover, null, 'a ship that moved off the cursor is no longer hovered');

  // a dead or unseen ship is dropped at once
  const ui3 = spaceUI(() => null);
  ui3.hover = { ...enemy, dead: true };
  ui3.hoverX = 410;
  ui3.hoverY = 305;
  ui3.updateHover({ x: 410, y: 305, inside: true });
  assert.equal(ui3.hover, null);
  // leaving the view drops the hover
  const ui4 = spaceUI(() => enemy);
  ui4.hover = enemy;
  ui4.hoverX = 410;
  ui4.hoverY = 305;
  ui4.updateHover({ x: 410, y: 305, inside: false });
  assert.equal(ui4.hover, null);
}

{
  // before: the same frames through the old rule (pick every frame) alternate, which is the reported flicker
  const seen = [];
  for (let f = 0; f < 6; f++) seen.push(spacePointer({ player: me }, f % 2 ? ownSquad : enemy));
  assert.deepEqual(seen.slice(0, 2), ['POINTER_ATTACK', 'POINTER_SELECT']);
}

// ---- land ----
{
  const camera = new THREE.PerspectiveCamera(55, 1, 5, 40000);
  globalThis.innerWidth = 800;
  globalThis.innerHeight = 800;
  camera.position.set(0, -300, 300);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const game = Object.create(LandGame.prototype);
  Object.assign(game, { camera, iconHits: [], menus: { open: false } });
  const squad = { id: 5, members: [] },
    trooper = { x: 0, y: 0, z: 0, aimZ: 6, body: 4, squad, side: 1 };
  squad.members.push(trooper);
  const passer = { x: 0, y: 0, z: 0, aimZ: 6, body: 4, squad: { id: 6, members: [] }, side: 0 };
  passer.squad.members.push(passer);
  // where the trooper stands on screen
  const p = new THREE.Vector3(0, 0, 6).project(camera),
    sx = ((p.x + 1) / 2) * innerWidth,
    sy = ((1 - p.y) / 2) * innerHeight;
  assert.ok(game.standHit(trooper, sx, sy) < 1, 'the cursor is on the trooper');
  assert.ok(game.squadUnder(squad, sx, sy));
  assert.ok(!game.squadUnder(squad, sx + 200, sy), 'and off it 200 px away');

  const ui = Object.create(LandUI.prototype);
  Object.assign(ui, { game, mouse: { x: sx, y: sy, inside: true }, hover: null });
  const pointerOf = h => tacticalPointer({ land: true, hover: !h ? null : h === passer.squad ? 'own' : 'enemy', act: true, attack: true });
  const seen = [];
  // refreshes alternate between the enemy, an own unit walking across it and nothing (the edge of the pick)
  const picks = [trooper, passer, trooper, null, trooper, passer, null, trooper];
  for (const u of picks) {
    ui.updateHover(u);
    seen.push(pointerOf(ui.hover));
  }
  assert.deepEqual(new Set(seen), new Set(['POINTER_ATTACK']), `land pointer held: ${seen.join(' ')}`);
  // the mouse moves: the next pick wins
  ui.mouse.x += 3;
  ui.updateHover(passer);
  assert.equal(ui.hover, passer.squad);
  // the enemy walks off the resting cursor
  ui.mouse.x -= 3;
  ui.updateHover(trooper);
  assert.equal(ui.hover, squad);
  trooper.x = 400;
  passer.x = 400;
  ui.updateHover(null);
  assert.equal(ui.hover, null, 'a squad that walked off the cursor is no longer hovered');
}

// ---- the pointer element is set at once when a pointer is already loaded (no await between frames) ----
{
  globalThis.fetch = async () => new Response(null, { status: 404 });
  const el = { style: { cursor: 'x' } };
  const ptr = new Pointers(el);
  await ptr.set('POINTER_TEST_MISSING'); // first use loads (nothing here, so no image)
  assert.equal(el.style.cursor, '');
  ptr.set('');
  el.style.cursor = 'x';
  const r = ptr.set('POINTER_TEST_MISSING');
  assert.equal(r, undefined, 'a loaded pointer is applied synchronously');
  assert.equal(el.style.cursor, '');
}

console.log(
  'PASS: space and land hover hold while the mouse rests on an enemy, pointer frames named by their number, loaded pointers set at once'
);
