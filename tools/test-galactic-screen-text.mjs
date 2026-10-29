import assert from 'node:assert/strict';
import { db } from '../public/js/gamedata.js';
import { GalacticScreenText, wrapScreenText } from '../public/js/game/galacticscreentext.js';
assert.deepEqual(
  wrapScreenText('alpha beta gamma', 10, s => s.length),
  ['alpha beta', 'gamma']
);
assert.deepEqual(
  wrapScreenText('line one\\nline two\n\nline three', 40, s => s.length),
  ['line one', 'line two', 'line three']
);
assert.deepEqual(
  wrapScreenText('abcdefgh', 3, s => s.length),
  ['abc', 'def', 'gh']
);
assert.deepEqual(
  wrapScreenText('x'.repeat(8192), 9000, s => s.length),
  []
);
class Element {
  constructor() {
    this.style = {};
    this.children = [];
    this.hidden = false;
    this.textContent = '';
  }
  appendChild(e) {
    this.children.push(e);
    e.parent = this;
    return e;
  }
  setAttribute() {}
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this);
  }
  getContext() {
    return { measureText: s => ({ width: s.length * 8, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }) };
  }
}
globalThis.innerHeight = 768;
globalThis.document = { body: new Element(), createElement: () => new Element() };
const component = props => ({
  val: k => props[k] ?? '',
  str: k => props[k] ?? '',
  num: (k, d) => (props[k] === undefined ? d : +props[k])
});
db.constants = component({ Speech_Text_Color: '255 255 255', Text_Reveal_Rate: 4 });
const comps = new Map([
  [
    'TUTORIAL_TEXT',
    component({ Font_Point_Size: 6, Font_Name: 'Arial', Scale: 0.95, Size: '64 11', Text_Offset: '0 -33', Left_Justified: 'True' })
  ],
  ['TUTORIAL_TEXT_BACK', component({ Size: '512 14', Offset: '7 2', Color: '255 255 255 0' })]
]);
const display = new GalacticScreenText({ overlayScale: () => 1, audio: { play() {} } }, comps);
display.show({ id: 'first', text: 'one', duration: -1, teletype: false });
display.show({ id: 'second', text: 'two', duration: 2, teletype: false });
assert.equal(display.rows[0].el.style.left, '5px');
assert.equal(display.rows[0].el.style.top, '43px');
assert.equal(display.rows[1].el.style.top, '54px');
assert(display.back.hidden);
display.show({ id: 'first', text: 'replacement', duration: -1, teletype: false });
assert.deepEqual(
  display.rows.map(r => r.id),
  ['second', 'first']
);
display.update(2);
assert.deepEqual(
  display.rows.map(r => r.id),
  ['first']
);
assert.equal(display.rows[0].el.style.top, '43px');
display.show({ id: 'first', remove: true });
assert.equal(display.rows.length, 0);
display.show({ id: 'First', text: 'uppercase', duration: -1, teletype: false });
display.show({ id: 'first', remove: true });
assert.equal(display.rows.length, 1);
display.removeAll();
display.show({ id: 'typed', text: 'abcd\\nefgh', duration: -1, teletype: true });
display.update(0.5);
assert.deepEqual(
  display.rows.map(r => r.shown),
  ['ab', '']
);
display.update(0.5);
assert.deepEqual(
  display.rows.map(r => r.shown),
  ['abcd', '']
);
display.update(0.5);
assert.deepEqual(
  display.rows.map(r => r.shown),
  ['abcd', 'ef']
);
display.show({ id: 'literal', text: 'total %s', variable: 'undefined_type', duration: -1, teletype: false });
assert.equal(display.rows.at(-1).text, 'total %s');
display.removeAll();
let sounds = 0;
display.game.audio.play = () => sounds++;
db.text.set('TEXT_LIVE_HINT', 'original');
display.show({ id: 'TEXT_LIVE_HINT', textId: 'TEXT_LIVE_HINT', text: 'original', kind: 'HINT', duration: 10 });
display.update(0.5);
const remaining = display.rows[0].duration,
  revealed = display.rows[0].progress,
  clock = display.clock,
  soundCount = sounds;
db.text.set('TEXT_LIVE_HINT', 'translated');
await display.refreshLanguage();
assert.equal(display.rows[0].text, 'translated');
assert.equal(display.rows[0].duration, remaining);
assert.equal(display.rows[0].progress, revealed);
assert.equal(display.clock, clock);
assert.equal(sounds, soundCount, 'Language refresh cannot replay hint or teletype sounds');
let release;
display.resize = () => {};
display.bitmap = { ensure: () => new Promise(resolve => (release = resolve)) };
const pending = display.refreshLanguage();
await Promise.resolve();
display.update(20);
release();
await pending;
assert.equal(display.rows.length, 0, 'An expired message cannot return after a slow language glyph load');
display.dispose();
assert.equal(document.body.children.length, 0);
console.log('Galactic screen text passed: native wrapping, row placement, exact IDs, replacement, lifetime and sequential teletype.');
