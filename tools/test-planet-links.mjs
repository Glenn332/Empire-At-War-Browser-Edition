// Double-clicking a planet's name in the galactic logs and story popups jumps to that planet. Pure UI: the planet is
// found from the entry's own reference or from the text, and the camera/selection go through focusPlanet.
import assert from 'node:assert/strict';

const { resolvePlanet, planetAtOffset, planetFromEvent, linkPlanets, textAt } = await import('../public/js/game/planetlinks.js');

const world = (list, hidden = []) => {
  const planets = list.map(([name, type], index) => ({
    index,
    name: type,
    type: { name: type, str: () => '' },
    background: hidden.includes(name)
  }));
  return {
    galaxy: { planets },
    planetViews: list.map(([name]) => ({ name, show: true })),
    focused: [],
    focusPlanet(i) {
      this.focused.push(i);
      return true;
    }
  };
};

// vanilla names, a type name that differs from what is shown, a background body
const vanilla = world(
  [
    ['Coruscant', 'CORUSCANT'],
    ['Corellia', 'CORELLIA'],
    ['Mon Calamari', 'MON_CALAMARI'],
    ['Kuat', 'KUAT'],
    ['Éndor', 'ENDOR'],
    ['Nebula', 'DEEP_SPACE_1']
  ],
  ['Nebula']
);

// ---- name resolution ----
assert.equal(resolvePlanet(vanilla, 'Coruscant'), 0);
assert.equal(resolvePlanet(vanilla, 'CORUSCANT'), 0, 'case does not matter');
assert.equal(resolvePlanet(vanilla, 'endor'), 4, 'accents do not matter');
assert.equal(resolvePlanet(vanilla, 'Éndor'), 4);
assert.equal(resolvePlanet(vanilla, 'Mon_Calamari'), 2, 'the type name works too');
assert.equal(resolvePlanet(vanilla, 'mon calamari'), 2);
assert.equal(resolvePlanet(vanilla, 'Calamari'), 2, 'a single planet with that whole word');
assert.equal(resolvePlanet(vanilla, 'Cor'), -1, 'a prefix is not a name');
assert.equal(resolvePlanet(vanilla, 'Nebula'), -1, 'background bodies are not planets');
assert.equal(resolvePlanet(vanilla, 'Darth Vader'), -1, 'not a planet');
for (const bad of ['', '   ', null, undefined, 42.5, {}, [], Symbol.iterator.description]) assert.equal(resolvePlanet(vanilla, bad), -1, String(bad));
assert.equal(resolvePlanet({}, 'Kuat'), -1, 'no galaxy: no crash');
assert.equal(resolvePlanet(null, 'Kuat'), -1);

// the entry's own reference wins: a planet object or its index
assert.equal(resolvePlanet(vanilla, 3), 3);
assert.equal(resolvePlanet(vanilla, vanilla.galaxy.planets[1]), 1);
assert.equal(resolvePlanet(vanilla, { index: 2 }), 2);
assert.equal(resolvePlanet(vanilla, 99), -1);
assert.equal(resolvePlanet(vanilla, -1), -1);
assert.equal(resolvePlanet(vanilla, 5), -1, 'a background body by index is refused');

// exact beats partial: "Corellian Run" style names do not steal "Corellia"
const crowded = world([
  ['Kuat Drive Yards', 'KUAT_DRIVE_YARDS'],
  ['Kuat', 'KUAT'],
  ['Kuat', 'KUAT_2']
]);
assert.equal(resolvePlanet(crowded, 'kuat'), 1, 'the exact name, and the first of two equal names');
assert.equal(resolvePlanet(crowded, 'Kuat Drive Yards'), 0);
assert.equal(resolvePlanet(world([['Alpha Centauri', 'AC'], ['Beta Centauri', 'BC']]), 'Centauri'), -1, 'an ambiguous word is not guessed');
assert.equal(resolvePlanet(world([['Lah', 'KUAT'], ['Other', 'LAH']]), 'lah'), 0, 'the displayed name beats another planet\'s type name');

// ---- a mod: its planets, its names, the shown name different from the type name ----
const modded = world([
  ['Zhar', 'ZHAR'],
  ['Hoth Prime', 'HOTH'],
  ['Hoth', 'HOTH_OLD'],
  ['Kessel Prime', 'KESSEL'],
  ['Naboo', 'NABOO']
]);
assert.equal(resolvePlanet(modded, 'zhar'), 0);
assert.equal(resolvePlanet(modded, 'Hoth Prime'), 1);
assert.equal(resolvePlanet(modded, 'hoth'), 2, 'exact shown name beats the type name of another planet');
assert.equal(resolvePlanet(modded, 'KESSEL'), 3, 'the type name still finds a renamed planet');
assert.equal(resolvePlanet(modded, 'Kessel'), 3, 'a unique whole word of the name');
assert.equal(resolvePlanet(modded, 'Prime'), -1, 'a word shared by two planets is not guessed');

// ---- a name inside text: the longest name around the clicked character ----
const line = 'The fleet left Kuat and attacked Hoth Prime. Mon Calamari is safe, Éndor too, not Coruscantine.';
const at = word => line.indexOf(word) + 1;
assert.equal(planetAtOffset(modded, line, line.indexOf('Hoth') + 2), 1, 'Hoth Prime, not Hoth');
assert.equal(planetAtOffset(modded, line, line.indexOf('Prime') + 2), 1, 'either word of a two-word name');
assert.equal(planetAtOffset(vanilla, line, at('Kuat')), 3);
assert.equal(planetAtOffset(vanilla, line, at('Calamari')), 2);
assert.equal(planetAtOffset(vanilla, line, at('Mon Calamari')), 2);
assert.equal(planetAtOffset(vanilla, line, at('Éndor')), 4, 'accented text');
assert.equal(planetAtOffset(vanilla, 'ENDOR burns', 1), 4, 'case and accents do not matter in text');
assert.equal(planetAtOffset(vanilla, line, at('fleet')), -1, 'a word that is not a planet');
assert.equal(planetAtOffset(vanilla, line, at('Coruscantine')), -1, 'a name inside a longer word is not a match');
assert.equal(planetAtOffset(vanilla, "Kuat's yards", 2), 3, 'a possessive');
assert.equal(planetAtOffset(vanilla, 'Kuat and Corellia', 12), 1, 'the other name in the same line');
assert.equal(planetAtOffset(vanilla, 'Kuat and Corellia', -1), 3, 'no position: the first planet named');
assert.equal(planetAtOffset(vanilla, '', 0), -1);
assert.equal(planetAtOffset(vanilla, null, 0), -1);
assert.equal(planetAtOffset(vanilla, 'Kuat', 400), 3, 'an offset past the end is clamped');

// ---- the double-click ----
const el = (dataset = {}, parent = null) => ({
  dataset,
  closest(sel) {
    for (let e = this; e; e = e.parent) if (sel === '[data-planet]' && e.dataset.planet !== undefined) return e;
    return null;
  },
  parent
});
let reading = { text: '', offset: -1 };
const hit = (game, target, text, offset) => {
  reading = { text, offset };
  return planetFromEvent(game, { target, clientX: 1, clientY: 1 }, () => reading);
};
assert.equal(hit(vanilla, el(), 'Kuat falls', 1), 3, 'a name in the text');
assert.equal(hit(vanilla, el(), 'Nothing here', 3), -1, 'not a planet: nothing happens');
assert.equal(hit(vanilla, el({ planet: '2' }), 'Fleet arrived', 3), -1, 'an entry planet does not turn every word into a link');
assert.equal(hit(vanilla, el({ planet: '2', planetLabel: '' }), 'Mon Calamari: ', 12), 2, 'the place label of an entry');
assert.equal(hit(vanilla, el({ planet: '3', planetLabel: '' }), 'Elsewhere: ', 1), 3, 'the label counts even without a readable name');
assert.equal(hit(vanilla, el({ planet: '3' }), 'Kuat is under attack', -1), 3, 'position unknown: the entry planet');
assert.equal(hit(vanilla, el({ planet: '2' }), 'Kuat attacks', 1), 3, 'a name in the text beats the entry planet');
assert.equal(hit(vanilla, el({ planet: '99', planetLabel: '' }), 'x', -1), -1, 'a stale planet index is ignored');
assert.equal(hit(vanilla, el({ planet: 'abc', planetLabel: '' }), 'x', -1), -1);
assert.equal(planetFromEvent(vanilla, null), -1);
assert.equal(planetFromEvent(vanilla, { target: null }, () => {
  throw new Error('boom');
}), -1, 'a failing text lookup never throws');

// the handler: focusPlanet is called once, only for a planet, and the event is swallowed
{
  const game = world([['Kuat', 'KUAT'], ['Hoth', 'HOTH']]);
  const listeners = {};
  const root = {
    addEventListener: (t, f) => (listeners[t] = f),
    removeEventListener: t => delete listeners[t]
  };
  const off = linkPlanets(root, game, () => reading);
  let stopped = 0;
  const fire = (target, r) => {
    reading = r;
    listeners.dblclick({ target, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation: () => stopped++ });
  };
  fire(el(), { text: 'Hoth is cold', offset: 1 });
  assert.deepEqual(game.focused, [1], 'double-click focuses the planet');
  assert.equal(stopped, 1);
  fire(el(), { text: 'just words', offset: 1 });
  assert.deepEqual(game.focused, [1], 'a double-click elsewhere does nothing');
  game.focusPlanet = () => false;
  fire(el(), { text: 'Kuat', offset: 1 });
  assert.equal(stopped, 1, 'a refused jump (a battle, a modal) leaves the event alone');
  off();
  assert.equal(listeners.dblclick, undefined, 'the handler can be removed');
  assert.doesNotThrow(() => linkPlanets(null, game)());
  assert.doesNotThrow(() => linkPlanets({}, game)());
}

// a native bitmap label (the droid log): the text is on the element, the position comes from glyph widths
{
  const label = { text: 'Kuat Hoth', f: { padding: 0, bitmap: { measure: s => s.length * 10 } } };
  const canvas = { getBoundingClientRect: () => ({ left: 100, width: 90 }) };
  const row = { _nativeLabel: label, querySelector: () => canvas, parentElement: null, dataset: {} };
  const out = x => textAt(row, x, 0, null);
  assert.deepEqual(out(105), { text: 'Kuat Hoth', offset: 0 });
  assert.equal(out(155).offset, 5, 'half-way is the start of the second word');
  assert.equal(planetAtOffset(modded, 'Kuat Hoth', out(170).offset), 2, 'a click on the right-hand name');
  assert.equal(out(400).offset, 8, 'a click past the text is clamped');
  const noFont = { _nativeLabel: { text: 'Hoth', f: {} }, querySelector: () => null, getBoundingClientRect: () => ({ left: 0, width: 0 }), parentElement: null };
  assert.equal(textAt(noFont, 3, 3, null).offset, -1, 'no glyph metrics: position unknown, text kept');
}

console.log('planet links ok');
