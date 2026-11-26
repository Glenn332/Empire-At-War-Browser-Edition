// Co-op galactic conquest (two players on one side) and land battle fixes:
// - a story popup raised while the story window is already open held the galaxy for good (clock frozen, fleets stuck
//   on their first frame of travel), because the window never answered for it;
// - a scripted button pressed by one player changed what the other player's screen showed;
// - a right click on the land minimap sent no move order.
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
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, ''))),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { GalacticGame } = await import('../public/js/game/galactic.js');
const { GalacticStoryDialog } = await import('../public/js/game/galacticstorydialog.js');
const { ScriptUI } = await import('../public/js/game/scriptui.js');
const { runCommand } = await import('../public/js/game/galacticnet.js');
const { minimapPoint } = await import('../public/js/game/landhud.js');
// ScriptUI keeps an SVG holder for its outline filters
globalThis.document ||= { createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {} } };

const proto = GalacticGame.prototype;
const PLAYERS = [
  { human: true, peer: 0, name: 'Host', faction: 'Rebel' },
  { human: true, peer: 1, name: 'Guest', faction: 'Rebel' }
];

// One peer of a co-op game: just the parts of the galaxy screen the story popups and holds go through.
function peer(me) {
  const orders = [],
    messages = [];
  const game = Object.create(proto);
  Object.assign(game, {
    setup: { net: { me }, players: PLAYERS.map(p => ({ ...p })) },
    net: {},
    me: 'Rebel',
    galaxy: { humans: ['REBEL'] },
    paused: false,
    orders,
    messages,
    order: cmd => orders.push(cmd),
    message: text => messages.push(text),
    isHuman: f => String(f).toUpperCase() === 'REBEL',
    story: { storyGoals: [], generic() {} }
  });
  // the story window without its screen: open, summary and popups are what decide who has answered
  const dialog = Object.create(GalacticStoryDialog.prototype);
  Object.assign(dialog, { game, open: false, summary: false, popupRequests: [], refreshSummary: async () => {} });
  dialog.show = async request => {
    dialog.open = true;
    dialog.summary = true;
    dialog.popupRequests = request?.id ? [request] : [];
    return true;
  };
  dialog.close = function () {
    if (!this.open) return;
    const popups = this.popupRequests || [];
    this.popupRequests = [];
    const sent = (game.dialogSent ||= new Set());
    for (const popup of popups) {
      sent.add(popup.id);
      game.order({ c: 'dialog', id: popup.id });
    }
    this.open = false;
    this.summary = false;
    const next = this.queuedPopups?.shift();
    if (next) this.show(next);
  };
  game.storyDialog = dialog;
  return game;
}
// what storyplots.openDialog does on every machine when a story event with a popup fires
const raise = (game, request) => {
  game.story.storyGoals.unshift(request);
  game.holdForDialog(request, 'Rebel');
  if (game.storyAudience('Rebel')) game.showStoryDialog(request);
};
// the lockstep turn: every order of every peer runs on every peer, as sent by its player
const exchange = peers => {
  const all = peers.flatMap((p, pid) => p.orders.splice(0).map(cmd => [pid, cmd]));
  for (const p of peers) for (const [pid, cmd] of all) p.dialogDone(pid, cmd.id);
};

// 1. The freeze: popup 7 arrives while popup 6 is still being read on both screens.
{
  const peers = [peer(0), peer(1)];
  const six = { id: 6, name: 'Dialog', popup: true },
    seven = { id: 7, name: 'Dialog', popup: true };
  for (const p of peers) raise(p, { ...six });
  for (const p of peers) assert(p.storyDialog.opened && p.held, 'a popup holds the galaxy while it is read');
  for (const p of peers) raise(p, { ...seven });
  for (const p of peers) assert.deepEqual(p.storyDialog.popupRequests.map(r => r.id), [6, 7], 'the open window takes in the second popup');
  for (const p of peers) p.storyDialog.close();
  exchange(peers);
  for (const p of peers) {
    assert.equal(p.held, false, 'closing the window answers both popups, so the galaxy runs again');
    assert.equal(p.holds.size, 0);
  }
}

// 2. A popup raised while a choice dialog is up waits for it, then shows.
{
  const p = peer(0);
  p.storyDialog.open = true;
  p.storyDialog.summary = false;
  raise(p, { id: 3, popup: true });
  assert(p.storyDialog.holding(3) && p.held);
  p.storyDialog.close();
  assert(p.storyDialog.opened && p.storyDialog.popupRequests.some(r => r.id === 3), 'the waiting popup opens after the choice dialog');
}

// 3. No hold stays on without a reason on screen: the watchdog reopens a popup this player still owes, answers one
//    whose goal is gone, and tells the other players who they wait for.
{
  const peers = [peer(0), peer(1)];
  for (const p of peers) {
    const request = { id: 9, popup: true };
    p.story.storyGoals.unshift(request);
    p.holdForDialog(request, 'Rebel'); // shown nowhere: the window was never opened for it
  }
  peers[0].watchHolds(0);
  assert(peers[0].storyDialog.opened && peers[0].storyDialog.holding(9), 'the popup the host owes is put back on screen');
  peers[0].storyDialog.close();
  peers[1].story.storyGoals.length = 0; // a script removed the goal on the guest's side of the story view
  peers[1].watchHolds(0);
  assert.deepEqual(peers[1].orders, [{ c: 'dialog', id: 9 }], 'a hold for a goal that is gone is answered');
  peers[1].watchHolds(500);
  assert.equal(peers[1].orders.length, 1, 'the watchdog answers once');
  exchange(peers);
  for (const p of peers) assert.equal(p.held, false);

  const q = [peer(0), peer(1)];
  for (const p of q) p.holds = new Map([[11, new Set([1])]]);
  q[0].watchHolds(0);
  assert(q[0].messages.some(m => /Waiting for Guest/.test(m)), 'the waiting player is told who holds the galaxy');
  q[0].scriptPauses = 1;
  q[0].holds.clear();
  q[0].watchHolds(5000);
  assert(q[0].messages.some(m => /campaign script has paused/.test(m)), 'a script pause is said out loud');
}

// 4. The 'dialog' order goes through runCommand to the player who sent it.
{
  const p = peer(1);
  p.holds = new Map([[4, new Set([0, 1])]]);
  p.actingPid = 0;
  runCommand(p, 'Rebel', { c: 'dialog', id: 4 });
  p.actingPid = 1;
  runCommand(p, 'Rebel', { c: 'dialog', id: 4 });
  p.actingPid = undefined;
  assert.equal(p.held, false);
}

// 5. Scripted buttons: a click by one co-op player runs its game effects on both machines, but only the clicker's
//    screen shows the press. Hidden-or-shown is per screen, so it no longer decides whether the click runs.
{
  const comp = (vals = {}) => ({ val: k => vals[k] || '', num: () => 1 });
  const comps = new Map([
    ['B_SPACE_FILTER01', comp({ Tab: 'True', Group: 'FilterBuilds' })],
    ['B_SPACE_FILTER02', comp({ Tab: 'True', Group: 'FilterBuilds' })]
  ]);
  const machine = local => {
    const signals = [],
      game = {
        net: {},
        localPid: local,
        ui: { root: { querySelectorAll: () => [] } },
        story: { clickGUI: n => signals.push(n) },
        order() {}
      };
    const ui = new ScriptUI(game, { comps, shell: new Map() });
    ui.apply = () => {};
    return { game, ui, signals };
  };
  const host = machine(0),
    guest = machine(1);
  host.ui.state('B_SPACE_FILTER02').selected = true;
  guest.ui.state('B_SPACE_FILTER02').selected = true;
  // the guest presses filter 1: the 'ui' order runs on both machines as galactic.scriptClick does it
  for (const m of [host, guest]) {
    m.game.uiPid = 1;
    m.ui.click('B_SPACE_FILTER01', false, true);
    m.game.uiPid = undefined;
  }
  assert.deepEqual(host.signals, ['B_SPACE_FILTER01']);
  assert.deepEqual(guest.signals, ['B_SPACE_FILTER01'], 'the click reaches the story on both machines alike');
  assert.equal(host.ui.state('B_SPACE_FILTER01').selected, false, "the host's tabs stay as the host left them");
  assert.equal(host.ui.state('B_SPACE_FILTER02').selected, true);
  assert.equal(guest.ui.state('B_SPACE_FILTER01').selected, true, "the guest's own screen shows the press");
  assert.equal(guest.ui.state('B_SPACE_FILTER02').selected, false);
  // a menu button the host has hidden but the guest has open still runs everywhere when the guest clicks it
  host.ui.state('B_SPACE_FILTER02').visible = false;
  for (const m of [host, guest]) {
    m.game.uiPid = 1;
    assert.equal(m.ui.click('B_SPACE_FILTER02', false, true), true);
    m.game.uiPid = undefined;
  }
  assert.equal(host.signals.length, guest.signals.length, 'both machines carry out the same clicks');
  // a disabled button is shared state: refused everywhere
  for (const m of [host, guest]) m.ui.state('B_SPACE_FILTER01').enabled = false;
  for (const m of [host, guest]) assert.equal(m.ui.click('B_SPACE_FILTER01', false, true), false);
  assert.equal(host.ui.elsewhere(), false, 'outside a click nothing is attributed to another player');
}

// 6. The land minimap: a point on it is a spot of the playable area, north up.
{
  const rect = { left: 10, top: 100, width: 200, height: 200 },
    lo = [-1000, -500],
    hi = [1000, 1500];
  assert.deepEqual(minimapPoint(rect, 10, 300, lo, hi), { x: -1000, y: -500 }, 'bottom left corner');
  assert.deepEqual(minimapPoint(rect, 210, 100, lo, hi), { x: 1000, y: 1500 }, 'top right corner');
  assert.deepEqual(minimapPoint(rect, 110, 200, lo, hi), { x: 0, y: 500 }, 'centre');
  assert.deepEqual(minimapPoint(rect, 400, -50, lo, hi), { x: 1000, y: 1500 }, 'clamped to the map');
}

console.log('co-op galaxy fixes ok: popups during an open story window, hold watchdog, per-player scripted buttons, land minimap');
