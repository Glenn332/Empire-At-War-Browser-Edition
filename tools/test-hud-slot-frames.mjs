// Tactical unit/build slots draw their pad frame (s_select_XX Blank_Texture_Name) under the icon:
// ground pad on land, space pad in space, and the names resolve in the command bar atlas.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
import { parseXML } from '../public/js/xml.js';

class Node {
  constructor(tag) {
    this.tag = tag;
    this.className = '';
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.innerHTML = '';
  }
  appendChild(n) {
    this.children.push(n);
    return n;
  }
  prepend(n) {
    this.children.unshift(n);
  }
  get firstChild() {
    return this.children[0] || { style: {} };
  }
}
globalThis.document = { createElement: tag => new Node(tag) };

const { CommandBar, selectPadIndex } = await import('../public/js/game/hud.js');

const dir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
let comps = null,
  atlas = null;
if (fs.existsSync(dir)) {
  const archive = openGame(dir, []),
    read = p => {
      const k = archive.resolve(p);
      return k && archive.read(k);
    };
  const xml = read('Data/XML/CommandBarComponents.xml'),
    mtd = read('Data/Art/Textures/MT_CommandBar.mtd');
  if (xml) {
    comps = new Map();
    for (const c of parseXML(Buffer.from(xml).toString('latin1')).children[0]?.children || [])
      if (c.attrs.Name) comps.set(c.attrs.Name.toUpperCase(), c);
  }
  if (mtd) {
    const b = new Uint8Array(mtd),
      d = new DataView(b.buffer, b.byteOffset, b.byteLength);
    atlas = new Set();
    for (let i = 0, n = d.getUint32(0, true); i < n; i++) {
      let name = '';
      for (let j = 0, o = 4 + i * 81; j < 64 && b[o + j]; j++) name += String.fromCharCode(b[o + j]);
      atlas.add(name.toUpperCase());
    }
  }
}
// Without game data, use the stock definition of the slot.
if (!comps)
  comps = new Map(
    [...parseXML(
      '<R><CommandBarComponent Name="s_select_00"><Blank_Texture_Name>i_button_pad_rebel.tga i_button_pad_empire.tga</Blank_Texture_Name></CommandBarComponent></R>'
    ).children[0].children].map(c => [c.attrs.Name.toUpperCase(), c])
  );

assert.equal(selectPadIndex({ land: true }), 0);
assert.equal(selectPadIndex({}), 1);
assert.equal(selectPadIndex({ land: () => true }), 1, 'galactic game.land() is a method, not the land flag');

const slot = (game, i = 0) => {
  const bar = Object.create(CommandBar.prototype);
  Object.assign(bar, {
    game,
    comps,
    skin: null,
    root: new Node('div'),
    place: n => n,
    thin: n => n,
    tex: (name, prop, index) => `${name}|${prop}|${bar.textureName(name, prop, index)}`
  });
  return bar.selectSlot(i).el;
};
for (const [game, want] of [
  [{ land: true }, 'i_button_pad_rebel.tga'],
  [{}, 'i_button_pad_empire.tga']
]) {
  const s = slot(game),
    pad = s.children[0];
  assert.equal(pad.className, 'pad', 'pad layer sits under the icon');
  assert.equal(pad.tag, 'i');
  assert.equal(pad.style.backgroundImage, `url("s_select_00|Blank_Texture_Name|${want}")`);
  assert.match(s.innerHTML, /class="ic"/);
}

if (atlas && comps.size > 1) {
  for (let i = 0; i < 24; i++) {
    const name = 's_select_' + String(i).padStart(2, '0');
    if (!comps.has(name.toUpperCase())) continue;
    for (const game of [{ land: true }, {}]) {
      const bar = Object.assign(Object.create(CommandBar.prototype), { comps });
      const tex = bar.textureName(name, 'Blank_Texture_Name', selectPadIndex(game));
      assert(tex, name + ' has a pad texture');
      assert(atlas.has(tex.toUpperCase()), tex + ' is in MT_CommandBar');
    }
  }
}
console.log('hud slot frames ok' + (atlas ? '' : ' (no game data)'));
