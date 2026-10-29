import { db } from '../gamedata.js';
import { carriedCompany, canLand, planetAllowsCompany } from './invasion.js';
import { intelligence } from './galacticfog.js';

const normalized = s => s.toUpperCase().replace(/[_\s]+/g, ' ');
const compatible = (m, t) => m.type.list('Marker_For_Specific_Object_Type').some(n => n.toUpperCase() === t.name.toUpperCase());

export function layoutMarkerGroups(markers) {
  const pool = name => markers.filter(m => normalized(m.type.name) === name);
  const inside = pool('IN BASE SPECIAL STRUCTURE POSITION');
  if (inside.length) {
    const cx = inside.reduce((n, m) => n + m.x, 0) / inside.length,
      cy = inside.reduce((n, m) => n + m.y, 0) / inside.length;
    inside.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - (b.x - cx) ** 2 - (b.y - cy) ** 2);
  }
  const outside = pool('OUT BASE SPECIAL STRUCTURE POSITION'),
    units = pool('DEFENDING FORCES POSITION'),
    ordinary = new Set([...inside, ...outside, ...units]);
  return {
    inside,
    outside,
    specific: markers.filter(m => !ordinary.has(m) && m.type.list('Marker_For_Specific_Object_Type').length),
    units
  };
}

export const canViewBaseLayout = (g, p, viewer) =>
  !!p && !p.destroyed && p.type.bool('Planet_Surface_Accessible', true) && (p.owner === viewer || !!intelligence(g, p)?.groundContents);

export function assignBaseLayout(p, markers, persist = false) {
  const groups = layoutMarkerGroups(markers);
  const buildings = [...groups.inside, ...groups.specific, ...groups.outside].map(marker => ({
    marker,
    record: null,
    type: null,
    fixed: groups.specific.includes(marker)
  }));
  const units = groups.units.map(marker => ({ marker, record: null }));
  const structures = p.groundStructures.filter(u => u.owner === p.owner),
    troops = p.garrison.filter(u => u.owner === p.owner);
  const assigned = new Set(),
    additional = [];
  const put = (slot, record, type = record.type, fixed = false) => {
    slot.record = record;
    slot.type = type;
    slot.fixed = fixed;
    if (!fixed) {
      assigned.add(record);
      if (persist) record.markerId = slot.marker.id;
    }
  };
  for (const u of structures) {
    const other = db.type(u.type.str('Place_Other_Type_At_Every_Specific_Marker_Position'));
    if (other) {
      for (const slot of buildings) if (!slot.record && compatible(slot.marker, other)) put(slot, u, u.type, true);
      assigned.add(u);
    }
    for (const n of u.type.list('Tactical_Additional_Structure_Type')) {
      const type = db.type(n);
      if (type && !additional.some(a => a.type === type)) additional.push({ type, source: u });
    }
  }
  for (const u of structures.slice().reverse()) {
    if (assigned.has(u)) continue;
    const slot = buildings.find(s => !s.record && compatible(s.marker, u.type));
    if (slot) {
      put(slot, u, u.type, true);
      slot.alpha = 192 / 255;
      assigned.add(u);
    }
  }
  for (const a of additional.reverse()) {
    const slot = buildings.find(s => !s.record && compatible(s.marker, a.type));
    if (slot) put(slot, a.source, a.type, true);
  }
  const ordinary = u =>
    /^OUT_BASE$/i.test(u.type.str('Base_Position')) ? [...groups.outside, ...groups.inside] : [...groups.inside, ...groups.outside];
  for (const u of structures.slice().reverse()) {
    if (assigned.has(u)) continue;
    const eligible = ordinary(u),
      slot = buildings.find(s => !s.record && s.marker.id === u.markerId && eligible.includes(s.marker));
    if (slot) put(slot, u);
  }
  for (const u of structures) {
    if (assigned.has(u)) continue;
    for (const marker of ordinary(u)) {
      const slot = buildings.find(s => s.marker === marker && !s.record);
      if (slot) {
        put(slot, u);
        break;
      }
    }
  }
  assigned.clear();
  for (const u of troops) {
    const slot = units.find(s => !s.record && s.marker.id === u.markerId);
    if (slot) {
      slot.record = u;
      assigned.add(u);
    }
  }
  for (const u of troops)
    if (!assigned.has(u)) {
      const slot = units.find(s => !s.record);
      if (slot) {
        slot.record = u;
        if (persist) u.markerId = slot.marker.id;
      }
    }
  return { buildings, units, groups };
}

export function swapLayoutMarkers(p, layout, from, to, owner) {
  if (p.owner !== owner || from === to || from.fixed || to.fixed) return false;
  const list = layout.buildings.includes(from) ? layout.buildings : layout.units.includes(from) ? layout.units : null;
  if (!list || !list.includes(to) || !from.record) return false;
  const a = from.record,
    b = to.record;
  a.markerId = to.marker.id;
  if (b) b.markerId = from.marker.id;
  return true;
}

export function layoutOrbitCompanies(g, p, owner) {
  return g.fleets.flatMap(f =>
    f.planet === p.index && !f.leg && f.owner === owner
      ? f.units.flatMap(unit => {
          const type = carriedCompany(unit);
          return type ? [{ fleet: f, unit, type }] : [];
        })
      : []
  );
}

export function embarkLayoutCompany(g, p, owner, record) {
  const transport = record && db.type(record.type.list('Company_Transport_Unit')[0]);
  if (p.owner !== owner || !transport || !p.garrison.includes(record) || record.owner !== owner) return false;
  let fleet = g.fleets.find(f => f.planet === p.index && !f.leg && f.owner === owner);
  if (!fleet) {
    fleet = { owner, units: [], planet: p.index, pos: null, path: [], dest: -1, leg: null };
    g.fleets.push(fleet);
  }
  fleet.units.push({ type: transport, carries: record.type, markerId: record.markerId ?? -1 });
  p.garrison.splice(p.garrison.indexOf(record), 1);
  return true;
}

export function landLayoutCompany(g, p, owner, entry, target) {
  if (
    p.owner !== owner ||
    !entry ||
    entry.fleet.owner !== owner ||
    !g.fleets.includes(entry.fleet) ||
    !target ||
    normalized(target.marker.type.name) !== 'DEFENDING FORCES POSITION' ||
    !canLand(g, entry.fleet, p.index) ||
    !entry.fleet.units.includes(entry.unit) ||
    !planetAllowsCompany(p, entry.type)
  )
    return false;
  const old = target.record,
    transport = old && db.type(old.type.list('Company_Transport_Unit')[0]);
  if (p.garrison.length >= db.constants.num('Max_Ground_Forces_On_Planet', 10) || (old && (!transport || !p.garrison.includes(old))))
    return false;
  entry.fleet.units.splice(entry.fleet.units.indexOf(entry.unit), 1);
  if (old) {
    entry.fleet.units.push({ type: transport, carries: old.type, markerId: old.markerId ?? -1 });
    p.garrison.splice(p.garrison.indexOf(old), 1);
  }
  p.garrison.push({ type: entry.type, owner, markerId: target.marker.id });
  g.fleets = g.fleets.filter(f => f.units.length);
  return true;
}

export function layoutMarkerPoint(marker, origin, width, height, scale) {
  return { x: origin.x + (marker.x - 0.5) * width * scale, y: origin.y + (marker.y - 0.5) * height * scale };
}
