import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const key = archive.resolve(decodeURIComponent(String(input).replace(/^asset\//, ''))),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { loadALO } = await import('../public/js/alo.js');
const { parseXML } = await import('../public/js/xml.js');
const { uiMeshes, uiMeshDepthAt, uiMeshClipPath, commandButtonArt } = await import('../public/js/game/hud.js');
const { GalacticRadar } = await import('../public/js/game/galacticradar.js');
const { ScriptUI } = await import('../public/js/game/scriptui.js');
const comps = new Map();
const walk = n => {
  if (n.attrs?.Name) comps.set(n.attrs.Name.toUpperCase(), n);
  for (const c of n.children || []) walk(c);
};
const files = parseXML(archive.read(archive.resolve('Data/XML/CommandBarComponentFiles.xml')).toString('latin1'));
for (const root of files.children)
  for (const node of root.children) {
    const data = archive.read(archive.resolve('Data/XML/' + node.text.trim()));
    if (data) walk(parseXML(data.toString('latin1')));
  }
const shell = uiMeshes(await loadALO('i_galactic_controls.alo'));
const raw = archive.read(archive.resolve('Data/Art/Textures/MT_CommandBar.mtd')),
  icons = new Map();
for (let i = 0; i < raw.readUInt32LE(0); i++) {
  const at = 4 + i * 81,
    name = raw
      .toString('latin1', at, at + 64)
      .replace(/\0.*$/, '')
      .toUpperCase();
  icons.set(name, { w: raw.readUInt32LE(at + 72), h: raw.readUInt32LE(at + 76) });
}
const pause = shell.get('B_PLAY_PAUSE'),
  radar = shell.get('RADAR_GALACTIC'),
  component = comps.get('B_PLAY_PAUSE');
assert(pause && radar && component);
const icon = icons.get(component.val('Icon_Texture_Name').toUpperCase()),
  art = commandButtonArt(pause, component, icon);
assert.equal(art.w, icon.w * component.num('Scale', 1));
assert.equal(art.h, icon.h * component.num('Scale', 1));
assert.equal(pause.rect.x + art.x, pause.origin.x);
assert.equal(pause.rect.y + pause.rect.h - art.y, pause.origin.y);
if (mod >= 0) {
  assert.equal(art.w, 25.6);
  assert.equal(art.h, 25.6);
  assert(art.w < pause.rect.w && art.h < pause.rect.h, 'The mod pause image must not stretch to its slanted collision bounds');
}
const offsetComponent = { val: key => (key === 'Icon_Offset' ? '7 -11' : ''), num: () => 0.4 };
const offset = commandButtonArt(pause, offsetComponent, { w: 80, h: 60 });
assert.equal(pause.rect.x + offset.x, pause.origin.x + 7);
assert.equal(pause.rect.y + pause.rect.h - offset.y, pause.origin.y - 11);
assert.deepEqual([offset.w, offset.h], [32, 24]);
const clip = uiMeshClipPath(radar);
assert.equal((clip.match(/M/g) || []).length, radar.indices.length / 3, 'The browser hit path contains every authored radar triangle');
assert.equal((clip.match(/Z/g) || []).length, radar.indices.length / 3);
assert(uiMeshDepthAt(radar, radar.origin.x, radar.origin.y) > -Infinity);
const previousDocument = globalThis.document;
const element = () => ({
  style: {},
  dataset: {},
  children: [],
  setAttribute() {},
  append(...items) {
    this.children.push(...items);
  },
  appendChild(item) {
    this.children.push(item);
  }
});
globalThis.document = { createElement: element };
const scriptRoot = element(),
  scriptUI = { comps, controls: new Map(), state: () => ({}), apply() {}, sizeText() {} };
const control = ScriptUI.prototype.buildControl.call(scriptUI, { root: scriptRoot, centered: false }, 'RADAR_GALACTIC', radar);
assert.equal(control.b.style.pointerEvents, 'none');
assert.equal(control.b.children[0].style.pointerEvents, 'auto');
assert.equal(control.b.children[0].style.clipPath, clip);
assert.equal(control.b.children[0].style.inset, '0');
globalThis.document = previousDocument;
if (mod >= 0) {
  for (const name of ['B_PLAY_PAUSE', 'B_STORY_ARC_G']) {
    const button = shell.get(name),
      x = button.rect.x + button.rect.w / 2,
      y = button.rect.y + button.rect.h / 2;
    assert(
      x >= radar.rect.x && x < radar.rect.x + radar.rect.w && y >= radar.rect.y && y < radar.rect.y + radar.rect.h,
      name + ' reproduces the old bounding-box interception'
    );
    assert.equal(uiMeshDepthAt(radar, x, y), -Infinity, name + ' center is outside the original radar triangles');
  }
}
for (const [width, height] of [
  [1024, 768],
  [1920, 1080],
  [800, 1200],
  [3840, 2160]
]) {
  const scale = Math.min(width / 1024, height / 768),
    r = radar.rect;
  const bounds = { left: r.x * scale, top: height - (r.y + r.h) * scale, width: r.w * scale, height: r.h * scale };
  const fake = {
    mesh: radar,
    host: { scale },
    root: { hidden: false, getBoundingClientRect: () => bounds },
    pick: () => -1,
    local: GalacticRadar.prototype.local
  };
  for (const [x, y] of [
    [r.x + 0.1, r.y + 0.1],
    [r.x + r.w - 0.1, r.y + 0.1],
    [r.x + 0.1, r.y + r.h - 0.1],
    [r.x + r.w - 0.1, r.y + r.h - 0.1],
    [radar.origin.x, radar.origin.y]
  ]) {
    const expected = uiMeshDepthAt(radar, x, y) > -Infinity;
    assert.equal(GalacticRadar.prototype.contains.call(fake, x * scale, height - y * scale), expected, `${width}x${height} ${x},${y}`);
  }
}
console.log(
  JSON.stringify({
    mod: mod >= 0,
    pauseImage: [art.w, art.h],
    radarTriangles: radar.indices.length / 3,
    result: 'Native atlas scale, bone offsets, round radar hit path and resized hit mapping passed'
  })
);
