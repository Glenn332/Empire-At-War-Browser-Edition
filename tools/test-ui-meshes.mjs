import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, ''))),
    b = key && archive.read(key);
  return new Response(b ? new Uint8Array(b) : null, { status: b ? 200 : 404 });
};
const { uiMeshes, uiBoneTransforms } = await import('../public/js/game/hud.js');
const { ScriptUI } = await import('../public/js/game/scriptui.js');
const { loadALO } = await import('../public/js/alo.js');
const pickAt = (meshes, x, y) => {
  const shell = { centered: true, dialog: true, root: { hidden: false, style: { left: '0', top: '0' } } };
  const controls = new Map([...meshes].map(([name, mesh]) => [name, { name, mesh, shell }]));
  return ScriptUI.prototype.pick.call(
    { game: { overlayScale: () => 1 }, controls, modal: true, state: () => ({ visible: true, enabled: true }) },
    x,
    -y
  )?.name;
};
const pos = new Float32Array([0, 0, 0, 30, 0, 0, 30, 200, 0, 0, 200, 0]),
  uv = new Float32Array(8);
const model = {
  bones: [
    { name: 'root', parent: -1, matrix: [0, -1, 0, 100, 1, 0, 0, 200, 0, 0, 1, 0] },
    { name: 'child', parent: 0, matrix: [2, 0, 0, 10, 0, 3, 0, 20, 0, 0, 1, 0] }
  ],
  meshes: [
    {
      name: 'rotated',
      bone: 1,
      hidden: true,
      subs: [
        {
          geometry: { stride: 128, nVerts: 4, vertices: { pos, uv }, indices: new Uint16Array([0, 1, 2, 0, 2, 3]) },
          material: { params: {} }
        }
      ]
    }
  ]
};
const mesh = uiMeshes(model).get('ROTATED');
assert.deepEqual(mesh.origin, { x: 80, y: 210, z: 0 });
assert.deepEqual(mesh.rect, { x: -520, y: 210, w: 600, h: 60 });
assert.deepEqual(
  mesh.verts.map(p => [p.x, p.y]),
  [
    [80, 210],
    [80, 270],
    [-520, 270],
    [-520, 210]
  ]
);
assert.equal(uiBoneTransforms(model)[1][3], 80);
model.bones = [{ name: 'root', parent: -1, matrix: [0, 0, 1, 10, 0, 1, 0, 20, -1, 0, 0, 30] }];
model.meshes[0].bone = 0;
pos[2] = 7;
assert.deepEqual(uiMeshes(model).get('ROTATED').verts[0], { x: 17, y: 20, z: 30, u: 0, v: 0 });
const names = ['i_tactical_controls.alo', 'i_main_reinforce.alo', 'i_galactic_controls.alo', 'i_galactic_organize.alo'];
let unchangedBorders = 0;
for (const name of names) {
  const source = await loadALO(name);
  assert(source, name);
  const meshes = uiMeshes(source);
  assert(meshes.size);
  for (const m of meshes.values()) {
    assert(Object.values(m.rect).every(Number.isFinite));
    assert(Number.isFinite(m.origin.x) && Number.isFinite(m.origin.y));
  }
  for (const part of source.meshes.filter(m => !m.hidden)) {
    let x = 0,
      y = 0,
      simple = true;
    for (let b = source.bones[part.bone]; b; b = source.bones[b.parent]) {
      const m = b.matrix;
      x += m[3];
      y += m[7];
      if ([0, 1, 2, 4, 5, 6, 8, 9, 10].some(i => Math.abs(m[i] - ([0, 5, 10].includes(i) ? 1 : 0)) > 1e-7)) simple = false;
    }
    if (!simple) continue;
    const g = part.subs.filter(s => s.geometry.vertices).at(-1)?.geometry;
    if (!g) continue;
    const p = g.vertices.pos,
      xs = [],
      ys = [];
    for (let i = 0; i < g.nVerts; i++) {
      xs.push(x + p[i * 3]);
      ys.push(y + p[i * 3 + 1]);
    }
    assert.deepEqual(meshes.get(part.name.toUpperCase()).rect, {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys)
    });
    unchangedBorders++;
  }
}
assert(unchangedBorders > 0);
if (mod >= 0) {
  const source = await loadALO('i_galactic_conquest_menu.alo');
  if (source) {
    const meshes = uiMeshes(source);
    const label = meshes.get('S_SHIELD_25');
    assert(label);
    assert(Math.abs(label.rect.w - 203.77426147460938) < 0.001);
    assert(Math.abs(label.rect.h - 28.723018646240234) < 0.001);
    assert.equal(label.origin.x, -12.399290084838867);
    assert.equal(label.origin.y, 252);
    const submenu = uiMeshes(await loadALO('i_Progressives_Submenu.alo')),
      map = submenu.get('PROG_MAP_01');
    assert(map);
    assert(Math.abs(map.rect.w - 200) < 0.001);
    assert(Math.abs(map.rect.h - 30) < 0.001);
    assert.equal(map.origin.x, -410);
    assert.equal(map.origin.y, 135);
    const primary = submenu.get('PROG_MAP_06'),
      disabled = submenu.get('DISABLED_PROG_MAP_06'),
      enabled = submenu.get('ENABLED_PROG_MAP_06');
    assert.equal(primary.depth, 7);
    assert.equal(primary.depth, disabled.depth);
    assert.equal(primary.depth, enabled.depth);
    assert(primary.order < disabled.order && primary.order < enabled.order);
    const candidates = new Map([...submenu].filter(([name]) => /^(?:DISABLED_|ENABLED_)?PROG_MAP_06$/.test(name)));
    assert.equal(pickAt(candidates, -410, -15), 'PROG_MAP_06');
    const factions = uiMeshes(await loadALO('i_factions_submenu.alo'));
    assert(factions.get('FACTION_02').depth > factions.get('ENABLED_FACTION_02').depth);
    assert(factions.get('FACTION_02').depth > factions.get('DISABLED_FACTION_02').depth);
    const factionCandidates = new Map([...factions].filter(([name]) => /^(?:DISABLED_|ENABLED_)?FACTION_02$/.test(name)));
    assert.equal(pickAt(new Map([...factionCandidates].reverse()), 420, 170), 'FACTION_02');
  }
}
const triangle = z => ({
  indices: [0, 1, 2],
  verts: [
    { x: 0, y: 0, z: z[0] },
    { x: 10, y: 0, z: z[1] },
    { x: 0, y: 10, z: z[2] }
  ]
});
const depthCandidates = new Map([
  ['SLOPING', triangle([1, 9, 1])],
  ['FLAT', triangle([4, 4, 4])]
]);
assert.equal(pickAt(depthCandidates, 1, 1), 'FLAT');
assert.equal(pickAt(depthCandidates, 8, 1), 'SLOPING');
assert.equal(
  pickAt(
    new Map([
      ['FIRST', triangle([3, 3, 3])],
      ['SECOND', triangle([3, 3, 3])]
    ]),
    2,
    2
  ),
  'FIRST'
);
const state = { name: 'TEST', tint: [1, 0, 0, 0.25] },
  control = { state: () => state, comps: new Map([['TEST', { val: () => 'true' }]]), apply: () => {} };
ScriptUI.prototype.enable.call(control, 'TEST', false);
assert.deepEqual(state.tint, [128 / 255, 128 / 255, 128 / 255, 1]);
assert.deepEqual(state.layerTint, state.tint);
ScriptUI.prototype.enable.call(control, 'TEST', true);
assert.deepEqual(state.tint, [1, 1, 1, 1]);
console.log(`UI mesh hierarchy checks passed (${mod < 0 ? 'base' : 'mod'}); ${unchangedBorders} existing faceplate borders unchanged.`);
