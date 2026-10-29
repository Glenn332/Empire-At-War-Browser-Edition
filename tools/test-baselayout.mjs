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
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy, forceKind } = await import('../public/js/game/galaxy.js');
const { parseMapLayoutHeader, parseTED } = await import('../public/js/ted.js');
const { assignBaseLayout, layoutMarkerGroups, layoutMarkerPoint, swapLayoutMarkers, canViewBaseLayout, layoutOrbitCompanies, embarkLayoutCompany, landLayoutCompany } = await import('../public/js/game/baselayoutdata.js');
const { savedCompanyMarker, placeLandInvasion, invasionStructureDeath, landInvasionResult } = await import('../public/js/game/campaignland.js');
const { stepVisibility, VIS } = await import('../public/js/game/galacticfog.js');
const { GalacticGame } = await import('../public/js/game/galactic.js');
const data = await loadCampaignData();
const usable = t => t && !t.bool('In_Background') && t.bool('Planet_Surface_Accessible', true) && t.str('Land_Tactical_Map') && archive.resolve('Data/Art/Maps/' + t.str('Land_Tactical_Map'));
const campaign = [...data.campaigns.values()].find(c => c.list('Locations').some(n => usable(db.type(n)))); assert(campaign);
const fresh = () => startingGalaxy(data, campaign), g = fresh(), p = g.planets.find(p => usable(p.type)), owner = g.active;
const bytes = archive.read(archive.resolve('Data/Art/Maps/' + p.type.str('Land_Tactical_Map')));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), header = parseMapLayoutHeader(buffer), map = parseTED(buffer);
assert(header.markers.length > 0 && header.extent > 0, 'Native map supplies marker header and full extent');
assert.equal(header.extent, map.terrain.size * 20, 'UI normalization uses the full native grid extent, including its last cell');
for (const m of header.markers) {
  const o = map.objects.find(o => o.id === m.id); assert(o, 'Header IDs resolve to tactical objects');
  assert.equal(o.crc, m.crc);
  assert(Math.abs(m.x - o.pos[0] / header.extent) < 0.00001, JSON.stringify({ map: p.type.str('Land_Tactical_Map'), marker: m.id, header: [m.x, m.y], pos: o.pos, extent: header.extent }));
  assert(Math.abs(m.y - o.pos[1] / header.extent) < 0.00001);
}
const groups = layoutMarkerGroups(header.markers); assert(groups.inside.length && groups.units.length > 1);
const special = groups.specific.flatMap(m => m.type.list('Marker_For_Specific_Object_Type').map(n => db.type(n))).find(t => t && forceKind(t) === 'ground structure' && !t.str('Place_Other_Type_At_Every_Specific_Marker_Position'));
if (special) {
  const record = { type: special, owner }, fixture = { owner, garrison: [], groundStructures: [record] };
  const slots = assignBaseLayout(fixture, header.markers, true), fixed = slots.buildings.find(s => s.record === record && s.type === special);
  assert(fixed?.fixed && fixed.alpha === 192 / 255, 'Specific structures use the native disabled portrait alpha');
  assert(!swapLayoutMarkers(fixture, slots, fixed, slots.buildings.find(s => !s.fixed), owner));
}
const normal = [...db.types.values()].find(t => forceKind(t) === 'ground structure' && !t.has('Place_Other_Type_At_Every_Specific_Marker_Position') && !groups.specific.some(m => m.type.list('Marker_For_Specific_Object_Type').some(n => n.toUpperCase() === t.name.toUpperCase())));
const company = [...db.types.values()].find(t => forceKind(t) === 'company' && db.type(t.list('Company_Transport_Unit')[0]) && t.list('Company_Units').length);
assert(normal && company);
g.autoReveal = false; g.fleets = [];
for (const q of g.planets) { q.owner = null; q.garrison = []; q.groundStructures = []; q.orbitalStructures = []; q.station = null; }
p.owner = owner; p.garrison = [{ type: company, owner }, { type: company, owner }]; p.groundStructures = [{ type: normal, owner }];
let layout = assignBaseLayout(p, header.markers, true);
assert(p.garrison.every(u => Number.isInteger(u.markerId)), 'Default troop markers persist');
assert(Number.isInteger(p.groundStructures[0].markerId));
const a = layout.units.find(s => s.record === p.garrison[0]), b = layout.units.find(s => s.record === p.garrison[1]);
assert(swapLayoutMarkers(p, layout, a, b, owner));
assert.equal(p.garrison[0].markerId, b.marker.id); assert.equal(p.garrison[1].markerId, a.marker.id);
assert(!swapLayoutMarkers(p, layout, a, layout.buildings[0], owner), 'A troop cannot enter a building slot');
const built = layout.buildings.find(s => s.record && !s.fixed), empty = layout.buildings.find(s => !s.record && !s.fixed);
assert(built && empty && swapLayoutMarkers(p, layout, built, empty, owner), JSON.stringify({ normal: normal.name, built: built && { fixed: built.fixed, id: built.marker.id }, empty: empty && empty.marker.id, count: layout.buildings.length }));
assert.equal(p.groundStructures[0].markerId, empty.marker.id);
const selected = map.objects.find(o => o.id === p.groundStructures[0].markerId);
const unitAt = savedCompanyMarker(map, p.garrison[0].markerId), unitObject = map.objects.find(o => o.id === p.garrison[0].markerId);
assert.equal(unitAt.x, unitObject.pos[0]); assert.equal(unitAt.y, unitObject.pos[1]);
assert.equal(unitAt.heading, unitObject.rot[2] * Math.PI / 180 - Math.PI / 2);
const projected = layoutMarkerPoint({ x: 0.25, y: 0.75 }, { x: 92, y: 7 }, 512, 256, 1.25);
assert.deepEqual(projected, { x: -68, y: 87 }, 'Projection uses texture dimensions and native bottom-up Y');
layout = assignBaseLayout(p, header.markers, true);
const defender = p.garrison[0], markerId = defender.markerId;
assert(embarkLayoutCompany(g, p, owner, defender));
let entry = layoutOrbitCompanies(g, p, owner)[0]; assert(entry && entry.unit.markerId === markerId);
layout = assignBaseLayout(p, header.markers, true);
const target = layout.units.find(s => s.record === p.garrison[0]), previous = target.record;
const invalidBefore = JSON.stringify(snapshotGalaxy(g));
assert(!landLayoutCompany(g, p, owner, entry, layout.buildings[0]), 'Transports cannot land on structure markers');
assert.equal(JSON.stringify(snapshotGalaxy(g)), invalidBefore);
assert(landLayoutCompany(g, p, owner, entry, target), 'Landing at occupied defense marker embarks its old company');
assert(p.garrison.some(u => u.type === company && u.markerId === target.marker.id));
assert(layoutOrbitCompanies(g, p, owner).some(e => e.unit.markerId === previous.markerId));
entry = layoutOrbitCompanies(g, p, owner)[0];
const cap = db.constants.num('Max_Ground_Forces_On_Planet', 10);
while (p.garrison.length < cap) p.garrison.push({ type: company, owner });
layout = assignBaseLayout(p, header.markers, true);
const fullBefore = JSON.stringify(snapshotGalaxy(g));
assert(!landLayoutCompany(g, p, owner, entry, layout.units[0]), 'A full surface cannot start an orbital replacement');
assert.equal(JSON.stringify(snapshotGalaxy(g)), fullBefore, 'Rejected transfer is atomic');
p.garrison.length = 2;
const snap = snapshotGalaxy(g), restored = fresh(); applyGalaxy(restored, snap);
assert.deepEqual(snapshotGalaxy(restored), snap, 'Marker IDs and carried-company identity survive battle snapshots');
const oldSnapshot = structuredClone(snap); oldSnapshot.planets[p.index].garrison = oldSnapshot.planets[p.index].garrison.map(row => row.slice(0, 2));
applyGalaxy(restored, oldSnapshot); assert(restored.planets[p.index].garrison.every(u => u.markerId === -1), 'Older snapshots remain supported');
const game = new GalacticGame({}, { audio: null, progress: null }); game.galaxy = g; game.me = owner; game.pendingBattle = { allowed: () => true };
const foe = [...db.factions.values()].find(t => t.name !== owner && !t.bool('Is_Neutral')).name;
game.battle = { p: p.index, attacker: foe, defender: owner }; game.view = {}; game.cam = { pull: 0 };
const setup = game.landBattleSetup();
assert.equal(setup.campaign.defender.units[0].markerId, p.garrison[0].markerId);
assert.equal(setup.campaign.defender.structures[0].markerId, p.groundStructures[0].markerId);
const spawned = [], sites = [], world = { sites, points: [], units: [], factions: [owner, foe], ready: [[], []], time: 0,
  nearestOpen: (x, y) => ({ x, y }), spawn: async (type, x, y, heading, side) => { spawned.push({ type, x, y, heading, side }); return { members: [] }; },
  finishSite: async () => null, reinforce() {}, showOwner() {} };
await placeLandInvasion(world, map, setup.campaign);
const tacticalUnit = spawned.find(u => u.side === setup.campaign.defender.side), tacticalStructure = sites[0];
const currentUnitMarker = map.objects.find(o => o.id === setup.campaign.defender.units[0].markerId);
assert.equal(tacticalUnit.x, currentUnitMarker.pos[0]); assert.equal(tacticalUnit.y, currentUnitMarker.pos[1]);
assert.equal(tacticalUnit.heading, currentUnitMarker.rot[2] * Math.PI / 180 - Math.PI / 2);
assert.equal(tacticalStructure.x, selected.pos[0]); assert.equal(tacticalStructure.y, selected.pos[1]);
assert.deepEqual(tacticalStructure.rot, selected.rot);
const repeated = [...db.types.values()].find(t => {
  const other = db.type(t.str('Place_Other_Type_At_Every_Specific_Marker_Position'));
  return other && groups.specific.filter(m => m.type.list('Marker_For_Specific_Object_Type').some(n => n.toUpperCase() === other.name.toUpperCase())).length > 1;
});
if (repeated) {
  sites.length = 0;
  const other = db.type(repeated.str('Place_Other_Type_At_Every_Specific_Marker_Position'));
  const tactical = { ...world, units: [], squads: [], ally: (a,b) => a === b, campaignGarrison: new Set(),
    finishSite: async (site, type, side) => { const u = { type, side, dead: false, x: site.x, y: site.y, heading: 0 }; tactical.units.push(u); return u; } };
  const cb = { ...setup.campaign, attacker: { ...setup.campaign.attacker, units: [] }, defender: { ...setup.campaign.defender, units: [], structures: [{ gid: 's:0', type: repeated.name }] } };
  const book = await placeLandInvasion(tactical, map, cb), children = tactical.units.filter(u => u.type === other);
  assert.equal(children.length, groups.specific.filter(m => m.type.list('Marker_For_Specific_Object_Type').some(n => n.toUpperCase() === other.name.toUpperCase())).length);
  assert(!tactical.units.some(u => u.type === repeated), 'Strategic proxy model is omitted');
  for (const u of children.slice(0, -1)) { invasionStructureDeath(tactical, book, u); u.dead = true; }
  assert(landInvasionResult(tactical, book, cb, cb.defender.side).alive.includes('s:0'), 'Any surviving replacement retains the strategic structure');
  const last = children.at(-1), unrelated = { ...last, dead: false }; tactical.units.push(unrelated);
  invasionStructureDeath(tactical, book, last); last.dead = true;
  assert(!book.lostStructures.has('s:0'));
  last.dead = false; unrelated.dead = true; invasionStructureDeath(tactical, book, last); last.dead = true;
  assert(!landInvasionResult(tactical, book, cb, cb.defender.side).alive.includes('s:0'), 'Last friendly replacement death removes the linked strategic structure');
}
{
  const childType=p.groundStructures[0].type,pad={bool:n=>n==='Tactically_Built_Child_Object_Persists'},site={pad,x:123,y:456,z:7,rot:[0,0,45],structure:null};
  const cb={...setup.campaign,attacker:{...setup.campaign.attacker,units:[]},defender:{...setup.campaign.defender,units:[],tacticalStructures:[{type:childType.name,owner:setup.campaign.sides[1],position:[123,456,7],baseLevel:1}]}};
  const tactical={sites:[site],points:[],units:[],factions:world.factions,ready:[[],[]],time:0,reinforce(){},showOwner(){},spawn:async()=>null,
    finishSite:async(s,type,side)=>{if(!s.pad)return null;const u={type,side,dead:false};s.structure=u;tactical.units.push(u);return u;}};
  const book=await placeLandInvasion(tactical,map,cb);
  assert.equal(book.persistent.size,1);assert.equal(site.structure.type,childType);assert.deepEqual(site.rot,[0,0,45]);
  let result=landInvasionResult(tactical,book,cb,cb.defender.side);assert.deepEqual(result.tacticalStructures,cb.defender.tacticalStructures);
  site.structure.dead=true;result=landInvasionResult(tactical,book,cb,cb.defender.side);assert.deepEqual(result.tacticalStructures,[],'A destroyed saved child is removed');
  await tactical.finishSite(site,childType,cb.defender.side);await tactical.finishSite(site,childType,cb.defender.side);assert.equal(book.persistent.size,1,'Saved positions never duplicate');
  assert.equal(landInvasionResult(tactical,book,cb,cb.defender.side).tacticalStructures.length,1);
}
stepVisibility(g, owner); assert(canViewBaseLayout(g, p, owner));
p.owner = foe; p.garrison.forEach(u => u.owner = foe); p.groundStructures.forEach(u => u.owner = foe); g.fleets = [];
stepVisibility(g, owner); assert(!canViewBaseLayout(g, p, owner));
p.visibilityModifiers = [{ owner, mask: VIS.GROUND_COUNT }]; stepVisibility(g, owner);
assert(!canViewBaseLayout(g, p, owner), 'Count-only spies do not unlock Base Layout');
p.visibilityModifiers[0].mask = VIS.GROUND_CONTENTS; stepVisibility(g, owner);
assert(canViewBaseLayout(g, p, owner), 'Surface intelligence unlocks an enemy preview');
layout = assignBaseLayout(p, header.markers);
const readOnlyBefore = JSON.stringify(snapshotGalaxy(g));
assert(!swapLayoutMarkers(p, layout, layout.units[0], layout.units[1], owner));
assert.equal(JSON.stringify(snapshotGalaxy(g)), readOnlyBefore, 'Enemy previews cannot edit assignments');
console.log(JSON.stringify({ mod: mod >= 0, map: p.type.str('Land_Tactical_Map'), markers: header.markers.length, extent: header.extent, result: 'header, assignments, swaps, transfers, visibility, snapshots and battle marker handoff passed' }));
