import { db } from '../gamedata.js';
import { markers } from './campaignbattle.js';
import { tickGarrisons } from './landgarrison.js';
import { assignBaseLayout, layoutMarkerGroups } from './baselayoutdata.js';

const normalize = s => s.toUpperCase().replace(/[\s_]+/g, ' ');
const relevant = t => t.bool('Victory_Relevant', true) || t.bool('Land_Victory_Relevant');

export function pathfinder(units,authoredHero='') {
  const selected=units.find(u=>u.type.toUpperCase()===String(authoredHero).toUpperCase()||db.type(u.type)?.list('Company_Units').some(n=>n.toUpperCase()===String(authoredHero).toUpperCase()));if(selected)return selected;
  const hero = u => { const t = db.type(u.type); return t && (/hero/i.test(t.tag) || t.bool('Is_Named_Hero') || t.list('Company_Units').some(n => /hero/i.test(db.type(n)?.tag || ''))); };
  for (const heroes of [false, true]) {
    const list = units.filter(u => hero(u) === heroes);
    for (const name of db.constants.list('Preferred_Pathfinder_Types')) { const u = list.find(u => u.type.toUpperCase() === name.toUpperCase()); if (u) return u; }
    if (list.length) return list[0];
  }
  return units[0];
}

function remember(book, gid, squad) { book.companies.set(gid, squad ? (squad.mates || [squad]) : []); }

export function structureMarkers(map, type) {
  const compatible = map.objects.filter(o => o.type.list('Marker_For_Specific_Object_Type').some(n => n.toUpperCase() === type.name.toUpperCase()));
  if (compatible.length) return compatible;
  const groups = layoutMarkerGroups(map.objects.map(o => ({ ...o, x: o.pos[0], y: o.pos[1] })));
  return /^OUT_BASE$/i.test(type.str('Base_Position')) ? [...groups.outside, ...groups.inside] : [...groups.inside, ...groups.outside];
}

export function savedCompanyMarker(map, markerId) {
  const slot = map.objects.find(o => o.id === markerId && normalize(o.type.name) === 'DEFENDING FORCES POSITION');
  return slot ? { x: slot.pos[0], y: slot.pos[1], heading: slot.rot[2] * Math.PI / 180 - Math.PI / 2 } : null;
}

export async function placeLandInvasion(w, map, cb) {
  const a = cb.attacker, d = cb.defender;
  w.campaignAttacker = a.side;
  if(cb.linked&&!cb.linked.sandbox)return {companies:new Map(),structures:new Map(),replacements:new Map(),proxyStructures:new Set(),lostStructures:new Set(),transports:new Map(),waiting:[],pending:0,absent:[],persistent:new Map(),anchors:{}};
  const defs = markers(map, 'Defending Forces Position'), defend = defs[0];
  if (!defend) throw new Error('Campaign land map has no Defending Forces Position');
  const entries = markers(map, 'Attacker Entry Position');
  const entry = entries.sort((a, b) => Math.hypot(a.x - defend.x, a.y - defend.y) - Math.hypot(b.x - defend.x, b.y - defend.y))[0];
  if (!entry) throw new Error('Campaign land map has no Attacker Entry Position');
  const book = { companies: new Map(), structures: new Map(), replacements: new Map(), proxyStructures: new Set(), lostStructures: new Set(), transports: new Map(), waiting: [], pending: 0, absent: [], planetType: db.type(cb.planetType), anchors: { [a.side]: entry, [d.side]: defend } };
  book.persistent=new Map();
  const finishSite=w.finishSite.bind(w),positionKey=site=>site.x+':'+site.y;
  w.finishSite=async(site,type,side)=>{
    const unit=await finishSite(site,type,side),pad=site.pad||site.mdu?.type;
    if(unit&&pad?.bool('Tactically_Built_Child_Object_Persists')){
      const level=d.structures.filter(r=>book.absent.includes(r.gid)||(book.proxyStructures.has(r.gid)?!book.lostStructures.has(r.gid):book.structures.get(r.gid)?.some(u=>!u.dead))).length;
      book.persistent.set(positionKey(site),{unit,site,type:type.name,owner:cb.sides[side===a.side?0:1],position:[site.x,site.y,site.z],baseLevel:Math.min(5,level)});
    }
    return unit;
  };
  for(const saved of d.tacticalStructures||[]){
    const site=w.sites.find(s=>s.pad&&Math.abs(s.x-saved.position[0])<0.0001&&Math.abs(s.y-saved.position[1])<0.0001),type=db.type(saved.type);
    if(!site||!type)continue;
    const unit=await w.finishSite(site,type,saved.owner===cb.sides[0]?a.side:d.side);
    if(unit)book.persistent.set(positionKey(site),{...saved,position:saved.position.slice(),unit,site});
  }
  const records = d.structures.flatMap(s => { const type = db.type(s.type); return type ? [{ ...s, type, owner: d.side }] : []; });
  const layout = assignBaseLayout({ owner: d.side, groundStructures: records, garrison: [] }, map.objects.map(o => ({ ...o, x: o.pos[0], y: o.pos[1] })));
  const build = async slot => {
    const record = slot.record, additional = slot.type !== record.type, other = !additional && db.type(record.type.str('Place_Other_Type_At_Every_Specific_Marker_Position'));
    const type = other || slot.type, mark = slot.marker;
    const site = { base: true, side: d.side, point: null, pad: null, x: mark.pos[0], y: mark.pos[1], z: mark.pos[2], rot: mark.rot, scale: mark.scale || 1, options: [], structure: null, building: null };
    w.sites.push(site);
    const u = await w.finishSite(site, type, d.side);
    if (!additional && u) {
      const objects = book.structures.get(record.gid) || []; objects.push(u); book.structures.set(record.gid, objects);
      if (other) { book.replacements.set(u, record.gid); book.proxyStructures.add(record.gid); }
    }
  };
  const slots = layout.buildings.filter(s => s.record);
  for (const s of slots.filter(s => s.type === s.record.type && s.record.type.str('Place_Other_Type_At_Every_Specific_Marker_Position'))) await build(s);
  for (const s of slots.filter(s => s.type === s.record.type && !s.record.type.str('Place_Other_Type_At_Every_Specific_Marker_Position'))) await build(s);
  for (const s of slots.filter(s => s.type !== s.record.type)) await build(s);
  for (const record of records) if (!book.structures.has(record.gid)) book.absent.push(record.gid);
  const spawn = async (u, side, at) => {
    const open = w.nearestOpen(at.x, at.y);
    if (!open) { book.absent.push(u.gid); return; }
    remember(book, u.gid, await w.spawn(u.type, open.x, open.y, at.heading || 0, side));
  };
  for (let i = 0; i < d.units.length; i++) await spawn(d.units[i], d.side, savedCompanyMarker(map, d.units[i].markerId) || defs[i % defs.length]);
  const first = pathfinder(a.units,cb.linked?.hero);
  for (const u of a.units) {
    const type = db.type(u.type);
    if (!type) continue;
    if (u === first) await spawn(u, a.side, entry);
    else { w.ready[a.side].push(type); book.waiting.push({ ...u, side: a.side, type }); }
  }
  for (const p of w.points.filter(p => p.reinforce)) {
    const present = new Set(w.units.filter(u => !u.dead && u.side >= 0 && u.side < w.factions.length &&
      (u.captures || u.side === a.side) && Math.hypot(u.x - p.x, u.y - p.y) <= p.radius).map(u => u.side));
    if (present.size) p.side = present.size === 1 ? [...present][0] : -1;
    w.showOwner(p);
  }
  const reinforce = w.reinforce.bind(w);
  w.reinforce = async (side, name, x, y, heading) => {
    const record = book.waiting.find(r => r.side === side && r.type.name.toUpperCase() === name.toUpperCase());
    if (record) book.waiting.splice(book.waiting.indexOf(record), 1);
    book.pending++;
    try {
      const made = await reinforce(side, name, x, y, heading);
      if (record) {
        if (made && made.pending) {
          book.transports.set(made, record.gid);
        } else remember(book, record.gid, made);
      }
      return made;
    } finally { book.pending--; }
  };
  w.onTransportOut = (transport, squad) => {
    const id = book.transports.get(transport);
    if (id !== undefined) { remember(book, id, squad); book.transports.delete(transport); }
  };
  w.garrisonPlanet = book.planetType;
  await tickGarrisons(w, true);
  return book;
}

export function invasionStructureDeath(w, book, u) {
  const id = book.replacements.get(u);
  if (id !== undefined && !w.units.some(other => other !== u && !other.dead && other.type === u.type && w.ally(other.side, u.side))) book.lostStructures.add(id);
}

export function invasionWinner(w, book, cb) {
  if (book.pending || w.garrisonBusy) return null;
  const present = side => w.squads.some(q => q.side === side && !q.native && !q.craft &&
    (q.forming || q.arriving || q.members.some(u => !u.dead && relevant(u.type)))) ||
    w.transports.some(t => t.side === side && t.stage === 'land' && !t.craft.dead);
  if (!present(cb.attacker.side)) return cb.defender.side;
  if (!present(cb.defender.side)) return cb.attacker.side;
  if (db.constants.bool('Land_Base_Destruction_Forces_Retreat') && cb.defender.structures.length &&
    !w.units.some(u => !u.dead && u.side === cb.defender.side && u.type.list('LandBehavior').includes('DUMMY_LAND_BASE_LEVEL_COMPONENT') && relevant(u.type))) return cb.attacker.side;
  return null;
}

export function consolidatedCompanies(records, companies, untouched = new Set(), side = undefined) {
  const groups = new Map(), ids = [];
  for (const record of records) {
    const type = db.type(record.type);
    if (!type) continue;
    const nominal = Math.max(1, type.list('Company_Units').length);
    const squads = companies.get(record.gid) || [];
    const count = untouched.has(record.gid) ? nominal : squads.reduce((n, q) => n + q.members.filter(u => (!u.dead || u.retreated) && !(u.bribed && u.side !== side && side !== undefined)).length, 0);
    if (!groups.has(type)) groups.set(type, { nominal, count: 0, records: [] });
    const group = groups.get(type); group.count += count; group.records.push(record);
  }
  const threshold = db.constants.num('Transport_Refill_Threshold', 0.5);
  for (const group of groups.values()) {
    let left = group.count;
    for (const record of group.records) {
      const count = Math.min(group.nominal, left); left -= count;
      if (count > 0 && count / group.nominal >= threshold) ids.push(record.gid);
    }
  }
  return ids;
}

export function landInvasionResult(w, book, cb, winnerSide) {
  const untouched = new Set([...book.absent, ...book.waiting.map(u => u.gid)]);
  for (const [t, id] of book.transports) if (t.stage === 'land' && !t.craft.dead) untouched.add(id);
  const ids = [...consolidatedCompanies(cb.attacker.units, book.companies, untouched, cb.attacker.side), ...consolidatedCompanies(cb.defender.units, book.companies, untouched, cb.defender.side)];
  for (const id of book.absent) if (id.startsWith('s:')) ids.push(id);
  for (const [id, objects] of book.structures) if (book.proxyStructures.has(id) ? !book.lostStructures.has(id) : objects.some(u => !u.dead)) ids.push(id);
  return { mode: 'land', planet: cb.planet, sides: cb.sides, winner: winnerSide === cb.attacker.side ? 'attacker' : 'defender',
    alive: ids.filter(id=>!book.companies.get(id)?.some(q=>w.parentModeDeaths?.has(q))&&!book.structures.get(id)?.some(u=>w.parentModeDeaths?.has(u.squad||u))), participants: cb.attacker.units.map(u => u.gid),
    tacticalStructures:[...(book.persistent?.values()||[])].filter(p=>!p.unit.dead&&p.site.structure===p.unit).map(({type,owner,position,baseLevel})=>({type,owner,position:position.slice(),baseLevel})) };
}
