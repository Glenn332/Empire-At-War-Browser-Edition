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
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, ''))), data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js'); await loadGameData();
const { loadCampaignData, startingGalaxy, forceKind } = await import('../public/js/game/galaxy.js');
const { stepVisibility, VIS } = await import('../public/js/game/galacticfog.js');
const { overviewContents, stableSlots, overviewIcon, packOverviewFleet, PlanetOverview } = await import('../public/js/game/planetoverview.js');
const { parseALO } = await import('../public/js/alo.js');
const { uiMeshes } = await import('../public/js/game/hud.js');
const { loadIcons, iconCanvasRect } = await import('../public/js/icons.js');
globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
globalThis.document = { createElement: () => ({ getContext: () => ({ putImageData() {} }) }) };
await loadIcons();
const data = await loadCampaignData(), campaign = [...data.campaigns.values()].find(c => c.list('Locations').some(n => { const t = db.type(n); return t && !t.bool('In_Background') && t.bool('Planet_Surface_Accessible', true); }) && c.tuples('Home_Location').length);
assert(campaign, 'Data contains a playable campaign');
const g = startingGalaxy(data, campaign), viewer = g.active, enemy = [...db.factions.values()].find(f => f.name !== viewer && !f.bool('Is_Neutral')).name;
const p = g.planets.find(p => !p.background && p.type.bool('Planet_Surface_Accessible', true));
const company = [...db.types.values()].find(t => forceKind(t) === 'company' && t.list('Company_Units').length);
const structure = [...db.types.values()].find(t => forceKind(t) === 'ground structure');
assert(p && company && structure, 'Actual data supplies a planet, company and structure');
g.autoReveal = false; g.fleets = [];
for (const q of g.planets) { q.owner = enemy; q.station = null; q.garrison = []; q.groundStructures = []; q.orbitalStructures = []; }
p.garrison = [{ type: company, owner: viewer }, { type: company, owner: viewer }];
p.groundStructures = [{ type: structure, owner: viewer }]; p.owner = viewer;
stepVisibility(g, viewer);
let state = overviewContents(g, p);
assert.equal(state.ground[0], p.garrison[0]); assert.equal(state.structures[0], p.groundStructures[0]);
assert.equal(state.capacity, p.type.num('Special_Structures_Land', 3));
const slots = new WeakMap(), [a, b] = p.garrison, c = { type: company, owner: viewer };
assert.equal(stableSlots([a, b], 3, slots)[1].unit, b);
assert.equal(stableSlots([b, c], 3, slots)[1].unit, b, 'Survivor keeps its pad');
assert.equal(stableSlots([b, c], 3, slots)[0].unit, c, 'Arrival fills the free pad');
assert.equal(stableSlots([null, null], 3, slots).filter(Boolean).length, 2, 'Count-only unknowns occupy distinct pads');
assert.equal(stableSlots([a, b, c], 1, slots).filter(Boolean).length, 1, 'A mod model bounds its own pad count');
p.owner = enemy; p.garrison.forEach(u => u.owner = enemy); p.groundStructures.forEach(u => u.owner = enemy);
stepVisibility(g, viewer); state = overviewContents(g, p);
assert.equal(state.ground.length, 0, 'Hidden defenders have no slots');
assert(state.structures.every(u => u === null), 'Visible building level does not reveal building identities');
p.visibilityModifiers = [{ owner: viewer, mask: VIS.GROUND_COUNT }]; stepVisibility(g, viewer);
assert.deepEqual(overviewContents(g, p).ground, [null, null], 'Count-only spy shows unknown portraits');
p.visibilityModifiers[0].mask = VIS.GROUND_CONTENTS | VIS.SPECIAL; stepVisibility(g, viewer);
assert.equal(overviewContents(g, p).ground[0], p.garrison[0]);
assert.equal(overviewContents(g, p).structures[0], p.groundStructures[0]);
p.visibilityModifiers = [];
g.fleets = [{ owner: viewer, planet: p.index, leg: null, units: [{ type: company }] }];
stepVisibility(g, viewer);
assert.equal(overviewContents(g, p).fleets[0].units[0], g.fleets[0].units[0], 'Own orbital units remain known over foreign ground');
g.fleets[0].owner = enemy; stepVisibility(g, viewer);
assert.equal(overviewContents(g, p).fleets.length, 0, 'Unseen enemy fleets do not enter the panes');
p.visibilityModifiers = [{ owner: viewer, mask: VIS.FLEET_COUNT }]; stepVisibility(g, viewer);
assert.deepEqual(overviewContents(g, p).fleets[0].units, [null]);
assert.equal(overviewIcon(null), 'i_button_unknown.tga');
assert.notEqual(overviewIcon(company), 'i_button_unknown.tga', 'A known company uses the actual atlas');
const { loadFileList } = await import('../public/js/gamedata.js');
const { parseXML } = await import('../public/js/xml.js');
let model = 'i_galactic_organize.alo';
for (const file of await loadFileList('CommandBarComponentFiles.xml')) {
  const key = archive.resolve('Data/XML/' + file), xml = key && archive.read(key)?.toString('latin1');
  if (xml) for (const top of parseXML(xml).children) for (const node of top.children) if (node.attrs.Name?.toUpperCase() === 'I_MAIN_ORGANIZE') model = node.val('Model_Name') || model;
}
const bytes = archive.read(archive.resolve('Data/Art/Models/' + model)); assert(bytes);
const shell = uiMeshes(parseALO(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
assert([...shell.keys()].some(n => /^PAD_\d+$/.test(n)), 'Original shell has ground pads');
assert(shell.has('LAND_ART_ALT' + p.type.num('Zoomed_Terrain_Index', 0)), 'Actual planet terrain has an authored alternate');
assert(shell.has('PLANET_STRUCTURE_00'), 'Original structure controls exist');
const cells = [...shell.keys()].filter(n => /^Q1_\d{4}$/.test(n)).sort().map(name => ({ name }));
const wide = [...db.types.values()].find(t => { const n = overviewIcon(t), r = iconCanvasRect(n); return /^big_/i.test(n) && r?.w >= 52 && r.h < 52; });
assert(wide, 'Actual atlas supplies a wide fleet portrait');
const ship = { type: wide }, next = { type: wide }, fleetSlots = new WeakMap();
let packed = packOverviewFleet([ship], cells, fleetSlots);
assert.equal(packed.compact, false); assert.equal(packed.slots[0].reserved, true, 'Pathfinder control is reserved');
assert.equal(packed.slots[1].unit, ship); assert.equal(packed.slots[2].reserved, true, 'Wide picture reserves its right neighbour');
packed = packOverviewFleet([ship, next], cells, fleetSlots);
assert.equal(packed.slots[1].count, 2, 'Identical fleet types share a counted stack');
packed = packOverviewFleet([ship], cells.slice(0, 2), new WeakMap());
assert.equal(packed.compact, true, 'A constrained mod shell falls back to compact portraits');
assert.equal(packed.slots[1].unit, ship);
console.log(JSON.stringify({ mod: mod >= 0, campaign: campaign.name, model, groundPads: [...shell.keys()].filter(n => /^PAD_\d+$/.test(n)).length, result: 'overview data, visibility and stable-slot checks passed' }));

for(const [width,height] of [[1024,768],[1280,720],[1920,1080],[800,900]]){
  const scale=Math.min(width/1024,height/768),root={style:{left:width/2+.5*scale+'px',top:height/2-.5*scale+'px'}};
  const host={root,scale};
  for(const [name,mesh]of shell)if(/^(PAD_\d+|Q[123]_\d{4})$/.test(name)){
    const triangle=Array.from(mesh.indices.slice(0,3),index=>mesh.verts[index]);
    const x=triangle.reduce((sum,v)=>sum+v.x,0)/3,y=triangle.reduce((sum,v)=>sum+v.y,0)/3;
    assert(PlanetOverview.prototype.hitControl.call(host,{clientX:parseFloat(root.style.left)+x*scale,clientY:parseFloat(root.style.top)-y*scale},mesh),name);
    assert(!PlanetOverview.prototype.hitControl.call(host,{clientX:parseFloat(root.style.left)+(mesh.rect.x+mesh.rect.w+10)*scale,clientY:parseFloat(root.style.top)-y*scale},mesh));
  }
}
console.log('PASS: original empty ground/fleet cell collision triangles at four viewport aspect ratios');

globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};
const selected={type:company,owner:viewer},matching={type:company,owner:viewer},foreign={type:company,owner:enemy};
const panel={game:{me:viewer,galaxy:{planets:[{garrison:[selected,matching,foreign]}]}},ground:[],fleets:[],dragging:null,chosen:new Set(),showSlot(){}};
const gesture={button:0,clientX:10,clientY:10,preventDefault(){},stopPropagation(){}};
const drag=source=>PlanetOverview.prototype.beginDrag.call(panel,gesture,source,null);
drag({kind:'ground',planet:0,records:[selected]});assert.deepEqual(panel.dragging.source.records,[selected]);
PlanetOverview.prototype.cancelDrag.call(panel);gesture.ctrlKey=true;
drag({kind:'ground',planet:0,records:[selected]});assert.deepEqual(panel.dragging.source.records,[selected,matching]);
PlanetOverview.prototype.cancelDrag.call(panel);
drag({kind:'fleet',planet:0,fleet:{units:[selected,matching]},records:[selected]});assert.deepEqual(panel.dragging.source.records,[selected,matching]);
PlanetOverview.prototype.cancelDrag.call(panel);
console.log('PASS: normal single-company and Ctrl same-parent portrait drag selection');
