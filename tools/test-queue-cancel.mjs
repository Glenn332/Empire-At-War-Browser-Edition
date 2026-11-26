import assert from 'node:assert/strict';
import { guardNativeUI, nativeAllowed } from '../public/js/nativeui.js';
import { CommandBar } from '../public/js/game/hud.js';
import { GalacticBar } from '../public/js/game/galactichud.js';
import { World } from '../public/js/game/sim.js';
import { execute } from '../public/js/game/commands.js';
import { runCommand, orders } from '../public/js/game/galacticnet.js';
import { cancelProduction } from '../public/js/game/galacticproduction.js';

// the browser's own menu and image dragging stay off the game screens, but text fields and links keep theirs
const node = (tag, parent = null, attrs = {}) => ({
  tag,
  parent,
  attrs,
  nodeType: 1,
  closest(sel) {
    for (let o = this; o; o = o.parent) {
      if (sel.split(',').some(s => matches(o, s.trim()))) return o;
    }
    return null;
  }
});
const matches = (o, s) => {
  const m = s.match(/^(\w*)(?:\[([\w-]+)(?:=(?:"([^"]*)"|(\w+)))?\])?$/);
  if (!m) return false;
  const [, tag, attr, quoted, bare] = m;
  if (tag && o.tag !== tag) return false;
  if (!attr) return !!tag;
  if (!(attr in o.attrs)) return false;
  return quoted === undefined && bare === undefined ? true : o.attrs[attr] === (quoted ?? bare);
};
const hud = node('div'),
  icon = node('i', node('div', hud)),
  img = node('img', hud),
  field = node('input', hud),
  link = node('span', node('a', hud, { href: 'x' })),
  text = { nodeType: 3, parentElement: icon };
assert.equal(nativeAllowed(icon), false, 'a HUD icon has no native menu');
assert.equal(nativeAllowed(text), false, 'nor the text inside it');
assert.equal(nativeAllowed(field), true, 'a text field keeps copy and paste');
assert.equal(nativeAllowed(link), true, 'a link keeps its menu');
const selection = { isCollapsed: false, toString: () => 'copied', containsNode: n => n === icon };
assert.equal(nativeAllowed(icon, selection), true, 'selected text can still be copied');
assert.equal(nativeAllowed(img, selection), false, 'a selection elsewhere does not open the menu on an image');

const listeners = [];
const win = { addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }), getSelection: () => null };
guardNativeUI(win);
guardNativeUI(win);
assert.deepEqual(
  listeners.map(l => [l.type, l.capture]),
  [
    ['contextmenu', true],
    ['dragstart', true]
  ],
  'installed once, in the capture phase so panels that stop propagation are covered'
);
const fire = (type, target) => {
  const e = { type, target, prevented: false, preventDefault: () => (e.prevented = true) };
  for (const l of listeners) if (l.type === type) l.fn(e);
  return e.prevented;
};
assert.equal(fire('contextmenu', icon), true, 'right click on a queue icon shows no browser menu');
assert.equal(fire('dragstart', img), true, 'an icon image cannot be dragged out');
assert.equal(fire('contextmenu', field), false);
assert.equal(fire('dragstart', field), false);

// tactical: a click or right click on a queued build sends a cancel that refunds it
const type = (name, cost) => ({ name, has: () => false, num: (k, d) => (k === 'Build_Cost_Credits' ? cost : d), str: () => '' });
const fighter = type('TIE_Fighter_Squadron', 550),
  bomber = type('TIE_Bomber_Squadron', 700);
const player = {
  id: 0,
  credits: 1000,
  factionName: 'EMPIRE',
  everBought: new Map([
    [fighter, 2],
    [bomber, 1]
  ])
};
const qn = '0:Tactical_Units';
const station = { id: 5, dead: false, buildQueues: new Map([[qn, []]]) };
const queue = station.buildQueues.get(qn);
queue.push(
  { type: fighter, total: 10, left: 4, player },
  { type: bomber, total: 10, left: 10, player },
  { type: fighter, total: 10, left: 10, player }
);
const played = [];
const world = { units: [station], squads: [], audio: { playFor: (p, sfx) => played.push(sfx) }, cancelBuild: World.prototype.cancelBuild };
const sent = [];
const bar = { game: { command: cmd => (sent.push(cmd), execute(world, player, cmd)) }, ui: { hudTimer: 5 } };
const cancel = it => CommandBar.prototype.cancelQueued.call(bar, { u: station, name: qn, it });
cancel(queue[1]);
assert.deepEqual(sent.at(-1), { c: 'cancel', b: 5, q: qn, i: 1, type: 'TIE_Bomber_Squadron' });
assert.deepEqual(
  queue.map(it => it.type.name),
  ['TIE_Fighter_Squadron', 'TIE_Fighter_Squadron'],
  'the clicked item leaves the queue'
);
assert.equal(player.credits, 1700, 'and its price comes back');
assert.equal(player.everBought.get(bomber), 0);
assert.equal(bar.ui.hudTimer, 0, 'the HUD redraws at once');
cancel(queue[0]);
assert.equal(player.credits, 2250);
assert.equal(queue.length, 1);
// a second cancel already in flight (multiplayer) for an item that is gone finds the same type further back, never another type
execute(world, player, { c: 'cancel', b: 5, q: qn, i: 1, type: 'TIE_Fighter_Squadron' });
assert.equal(queue.length, 0);
execute(world, player, { c: 'cancel', b: 5, q: qn, i: 0, type: 'TIE_Fighter_Squadron' });
assert.equal(player.credits, 2800, 'nothing is refunded twice');
execute(world, { ...player, id: 1 }, { c: 'cancel', b: 5, q: qn, i: 0, type: 'TIE_Fighter_Squadron' });
CommandBar.prototype.cancelQueued.call(bar, null);

// galactic: the same for a planet's production queue, single player and over the network
const planet = () => ({ owner: 'EMPIRE', production: { space: [], ground: [] } });
const item = (name, cost, extra = {}) => ({
  type: { name, str: () => name + '_Cancel_SFX' },
  owner: 'EMPIRE',
  cost,
  total: 30,
  left: 30,
  ...extra
});
const galaxy = (credits = 100) => ({ creditCapOverride: 1e9, planets: [planet()], players: [{ faction: 'EMPIRE', credits }] });
{
  const g = galaxy(),
    sounds = [];
  const a = item('Acclamator', 1200),
    b = item('AT_AT_Company', 800),
    c = item('Victory', 2500, { payg: true, paid: 400 });
  g.planets[0].production.space.push(a, c);
  g.planets[0].production.ground.push(b);
  let refreshed = 0;
  const gbar = {
    game: { galaxy: g, selected: 0, me: 'EMPIRE', net: null, audio: { play: s => sounds.push(s) } },
    refresh: () => refreshed++
  };
  GalacticBar.prototype.cancelItem.call(gbar, b);
  assert.deepEqual(g.planets[0].production.ground, [], 'a ground item is cancelled');
  assert.equal(g.players[0].credits, 900, 'and fully refunded');
  GalacticBar.prototype.cancelItem.call(gbar, c);
  assert.equal(g.players[0].credits, 1300, 'pay as you go gives back only what was paid so far');
  assert.deepEqual(sounds, ['AT_AT_Company_Cancel_SFX', 'Victory_Cancel_SFX']);
  assert.equal(refreshed, 2);
  GalacticBar.prototype.cancelItem.call(gbar, null);
  assert.equal(refreshed, 2, 'an empty slot does nothing');
}
{
  // multiplayer: the click only sends an order; every machine applies it in turn order
  const g = galaxy(),
    a = item('Acclamator', 1200),
    b = item('Acclamator', 1200);
  g.planets[0].production.space.push(a, b);
  const ordersSent = [];
  const gbar = {
    game: { galaxy: g, selected: 0, me: 'EMPIRE', net: {}, order: cmd => ordersSent.push(cmd), audio: { play() {} } },
    refresh() {}
  };
  GalacticBar.prototype.cancelItem.call(gbar, a);
  GalacticBar.prototype.cancelItem.call(gbar, a);
  assert.equal(g.planets[0].production.space.length, 2, 'nothing changes before the order comes back');
  assert.deepEqual(ordersSent[0], orders.cancel(g, 0, a));
  assert.deepEqual(ordersSent[0], { c: 'cancel', p: 0, q: 'space', i: 0, type: 'Acclamator' });
  const host = { galaxy: g, cancelBuild: (p, it) => cancelProduction(g, p, 'EMPIRE', it) };
  assert.equal(runCommand(host, 'EMPIRE', ordersSent[0]).ok, true);
  assert.deepEqual(g.planets[0].production.space, [b]);
  assert.equal(g.players[0].credits, 1300);
  runCommand(host, 'EMPIRE', ordersSent[1]);
  assert.equal(g.players[0].credits, 2500, 'a double click cancels the next one of the same type, as it does offline');
  assert.deepEqual(runCommand(host, 'EMPIRE', ordersSent[1]), {}, 'an empty queue ignores a late cancel');
  assert.equal(g.players[0].credits, 2500);
}
console.log('queue cancel ok');
