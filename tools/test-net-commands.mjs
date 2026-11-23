import assert from 'node:assert/strict';
import { runCommand, fromRecordRef } from '../public/js/game/galacticnet.js';
import { dropOverviewUnits } from '../public/js/game/fleetmanagement.js';
import { NeutralizeShell } from '../public/js/game/neutralizeshell.js';
import { GalacticStoryHost } from '../public/js/game/galacticstory.js';

// orders from another machine are checked before they touch the galaxy
const planet = { index: 0, owner: 'Empire', garrison: [{ type: {}, owner: 'Empire' }], groundStructures: [], orbitalStructures: [] };
planet.production = { space: [], ground: [] };
const fleet = { owner: 'Empire', planet: 0, units: [{ type: {} }], path: [], dest: -1, leg: null };
const calls = [];
const game = {
  galaxy: { planets: [planet], fleets: [fleet] },
  embarkFresh: (...a) => calls.push(['embarkFresh', ...a]),
  embark: (...a) => calls.push(['embark', ...a]),
  moveFleet: (...a) => calls.push(['moveFleet', ...a]),
  land: (...a) => calls.push(['land', ...a]),
  queueBuild: (...a) => calls.push(['queueBuild', ...a]),
  transferUnits: (...a) => calls.push(['transferUnits', ...a]),
  dropUnits: (s, t) => dropOverviewUnits({ galaxy: game.galaxy, me: 'Empire', audio: null }, s, t),
  galacticBattleChanged: () => {}
};
const run = cmd => assert.deepEqual(runCommand(game, 'Empire', cmd), {}, JSON.stringify(cmd));

run({ c: 'drop', s: { kind: 'fleet', planet: 0, fleet: -1 }, t: { kind: 'ground', planet: 0, fleet: -1 } });
run({ c: 'drop', s: { kind: 'fleet', planet: '0', fleet: 0 }, t: { kind: 'ground', planet: 0, fleet: -1 } });
run({ c: 'drop', s: null, t: 7 });
run({ c: 'embark', p: '0', fresh: true, slot: 0, to: -1, path: null });
run({ c: 'embark', p: 0, fresh: true, slot: '1', to: -1, path: null });
run({ c: 'move', f: '0', to: 0, slot: null, path: [0] });
run({ c: 'move', f: 0, to: 0.5, slot: null, path: [0] });
run({ c: 'land', f: 0, p: [0] });
run({ c: 'build', p: '0', type: 'X' });
run({ c: 'cancel', p: 0, q: '__proto__', i: 0 });
run({ c: 'marker', p: 0, rec: ['g', 0, 0], id: '3' });
run(null);
assert.deepEqual(calls, [], 'no malformed order reached the game');
assert.equal(fromRecordRef(game.galaxy, ['g', '0', 0]), null, 'record refs take integer indices only');
assert.equal(fromRecordRef(game.galaxy, ['f', 0, 'length']), null, 'not a property of the unit list');
assert.equal(fromRecordRef(game.galaxy, ['g', 0, 0]), planet.garrison[0]);
runCommand(game, 'Empire', { c: 'embark', p: 0, fresh: true, slot: 0, to: -1, path: null });
assert.equal(calls.length, 1, 'a well-formed order still runs');

// a neutralize answer passes on only the popup's own button names
assert(NeutralizeShell.control('H_0201', true) && NeutralizeShell.control('H_CLOSE', false));
assert(!NeutralizeShell.control('H_CLOSE', true) && !NeutralizeShell.control('B_TACTICAL_OVERRIDE', false));
const clicked = [];
const story = Object.assign(Object.create(GalacticStoryHost.prototype), {
  game: { localFaction: 'Rebel' },
  popup: { close() {} },
  clickGUI: name => clicked.push(name)
});
story.choices = new Map([[1, { owner: 'EMPIRE', rows: [] }]]);
story.neutralizeAnswer('Empire', 1, -1, 'SOME_STORY_BUTTON');
story.choices.set(2, { owner: 'EMPIRE', rows: [] });
story.neutralizeAnswer('Empire', 2, -1, 'H_CLOSE');
story.neutralizeAnswer('Empire', 3, -1, 'H_CLOSE');
assert.deepEqual(clicked, ['H_CLOSE'], 'only the close button, and only for an open prompt');
console.log('net commands ok');
