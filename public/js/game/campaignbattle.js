import {isTacticalSuperweapon} from './tacticalsuperweapon.js';

import { db } from '../gamedata.js';
import {tacticalTransportType} from './invasion.js';
import { getModelData, buildModel } from '../model.js';

const CLASS = s => {
  const v = String(s || '').toLowerCase();
  return v.startsWith('fighter') ? 0 : v.startsWith('bomber') ? 1 : v.startsWith('transport') ? 2 : v.startsWith('corvette') ? 3 : v.startsWith('frigate') ? 4 : v.startsWith('super') ? 6 : v.startsWith('capital') ? 5 : 4;
};
export function shipClass(t) {
  if (t.has('Ship_Class')) return CLASS(t.str('Ship_Class'));
  const f = db.type(t.list('Squadron_Units')[0]);
  return f ? (f.has('Ship_Class') ? CLASS(f.str('Ship_Class')) : 0) : 4;
}

export const spacePop = t => (t.has('Space_Override_Population_Value') ? t.num('Space_Override_Population_Value', 0) : t.num('Population_Value', 0));

const sizes = new Map();
export function halfSize(t) {
  if (sizes.has(t)) return sizes.get(t);
  let r = 30;
  const f = !t.has('Space_Model_Name') && db.type(t.list('Squadron_Units')[0]);
  const m = getModelData((f || t).str('Space_Model_Name'));
  if (m) { const inst = buildModel(m); r = inst.radius * (f || t).num('Scale_Factor', 1) * (f ? 3 : 1); }
  sizes.set(t, r);
  return r;
}

export function splitForCap(units, cap, linked=null) {
  if(linked){
    const ordinary=units.filter(u=>!isTacticalSuperweapon(u.type));
    const first=ordinary.find(u=>(u.companyType||u.type).name.toUpperCase()===String(linked.hero).toUpperCase())||(linked.pathfinder&&ordinary.find(u=>u.pathfinder));
    if(first)return {field:units.filter(u=>u===first||isTacticalSuperweapon(u.type)),waiting:ordinary.filter(u=>u!==first)};
  }
  const field = [], rest = [];
  let left = cap > 0 ? cap : Infinity;
  for (const u of units) (spacePop(u.type) < 1 || linked&&isTacticalSuperweapon(u.type) ? field : rest).push(u);
  const take = u => { field.push(u); rest.splice(rest.indexOf(u), 1); left -= spacePop(u.type); };
  for (const t of [...new Set(rest.map(u => u.type))]) { const u = rest.find(x => x.type === t); if (u && spacePop(t) <= left) take(u); }
  const total = rest.length, room = left;
  for (const t of [...new Set(rest.map(u => u.type))]) {
    const of = rest.filter(x => x.type === t), n = Math.floor(Math.floor(of.length / total * room + 0.5) / Math.max(1, spacePop(t)));
    for (const u of of.slice(0, n)) if (spacePop(t) <= left) take(u);
  }
  for (const u of rest.slice()) if (spacePop(u.type) <= left) take(u);
  return { field, waiting: rest };
}

const gridRows = n => (n < 3 ? 1 : n < 7 ? 2 : n < 10 ? 3 : n < 17 ? 4 : n <= 25 ? 5 : 6);

export function arrange(units, at, facing) {
  const out = [], fx = Math.cos(facing), fy = Math.sin(facing);
  const put = (u, a, b) => out.push({ u, x: at.x + fx * a - fy * b, y: at.y + fy * a + fx * b });
  const grid = (list, back) => {
    if (!list.length) return 0;
    const cell = 2 * Math.max(...list.map(u => halfSize(u.type))), rows = gridRows(list.length), per = Math.ceil(list.length / rows);
    list.forEach((u, i) => { const r = Math.floor(i / per), c = i % per, stagger = r % 2 ? cell / 2 : 0; put(u, -back - r * cell, (c - (per - 1) / 2) * cell + stagger); });
    return rows * cell;
  };
  const arc = (list, radius, span, from) => {
    if (!list.length) return;
    list.forEach((u, i) => { const t = from + (list.length > 1 ? i / (list.length - 1) : 0.5) * span; put(u, Math.cos(t) * radius, Math.sin(t) * radius); });
  };
  const cls = u => shipClass(u.type);
  const supers = units.filter(u => cls(u) === 6), caps = units.filter(u => cls(u) === 5), mid = units.filter(u => cls(u) === 3 || cls(u) === 4);
  const small = units.filter(u => cls(u) <= 1), carriers = units.filter(u => cls(u) === 2);
  let depth = grid(supers, 0);
  const rows = [caps, mid, small].filter(r => r.length);
  const screen = supers.length ? 0 : 1;
  let radius = depth / 2;
  rows.forEach((row, k) => {
    const rd = 2 * Math.max(...row.map(u => halfSize(u.type)));
    if (k === 0 && !supers.length) { depth = grid(row, 0); radius = depth / 2; return; }
    radius += rd / 2;
    if (k === screen) arc(row, radius, 225 * Math.PI / 180, -112.5 * Math.PI / 180);
    else arc(row, radius, 130 * Math.PI / 180, 25 * Math.PI / 180);
    radius += rd / 2;
  });
  carriers.forEach((u, i) => { const per = Math.max(1, Math.ceil(Math.sqrt(carriers.length))), s = 2 * halfSize(u.type) + 20; put(u, -depth - 200 - Math.floor(i / per) * s, (i % per - (per - 1) / 2) * s); });
  return out;
}

export function markers(map, name) {
  const want = name.toUpperCase().replace(/[\s_]+/g, ' ');
  return map.objects.filter(o => o.type.name.toUpperCase().replace(/[\s_]+/g, ' ') === want).map(o => ({ x: o.pos[0], y: o.pos[1], heading: o.rot[2] * Math.PI / 180 }));
}

export function placeCampaignBattle(w, map, teams, cb) {
  w.holdHyperspace=cb.linked?.cinematic===2;
  const stations = markers(map, 'Space Station Position'), defend = markers(map, 'Defending Forces Position')[0] || { x: 0, y: 0 };
  const entries = markers(map, 'Attacker Entry Position');
  const entry = entries.sort((a, b) => Math.hypot(a.x - defend.x, a.y - defend.y) - Math.hypot(b.x - defend.x, b.y - defend.y))[0] || { x: -defend.x || -2000, y: -defend.y || 0 };
  { const m = map.objects.find(o => o.type.name.toUpperCase().replace(/[\s_]+/g, ' ') === 'ATTACKER ENTRY POSITION');
    const p = (m?.rot[1] || 0) * Math.PI / 180, y = (m?.rot[2] || 0) * Math.PI / 180;
    w.retreatDir = { x: -Math.cos(p) * Math.cos(y), y: -Math.cos(p) * Math.sin(y), z: Math.sin(p) };
    w.retreatMarker = m ? { x: m.pos[0], y: m.pos[1], z: m.pos[2] || 0 } : null; }
  const book = { entity: new Map(), waiting: [], absent: [], station: null, anchors: { [cb.attacker.team]: { ...entry, toward: defend }, [cb.defender.team]: { ...defend, toward: entry } } };
  const owner = team => team.players.find(p => p.human) || team.players[0];
  const side = (s, at, facing, hyper) => {
    const team = teams[s.team], p = owner(team);
    const roster=s.units.map(u=>{const type=tacticalTransportType(u);return type===u.type?u:{...u,type,companyType:u.type};});
    const { field, waiting } = splitForCap(roster, p.faction ? p.faction.num('Space_Tactical_Unit_Cap', 0) : 0,s===cb.attacker?cb.linked:null);
    for (const { u, x, y } of arrange(field, at, facing)) {
      const e = w.spawn(u.type, p, x, y, facing);
      if (!e) { book.absent.push(u.gid); continue; }
      if (hyper && !w.tacticalSuperweapons?.record(e)) w.startHyperspace(e);
      book.entity.set(u.gid, e);
    }
    for (const u of waiting) { p.reinforcements.push(u.type); if (!p.human) (p.aiPool ||= []).push({ type: u.type, owner: null }); book.waiting.push({ ...u, team: s.team }); }
  };
  const d = cb.defender;
  if (d.station) {
    const st = stations[Math.floor(Math.random() * stations.length)] || defend;
    const team = teams[d.team];
    book.station = team.station = team.firstStation = w.spawn(db.type(d.station), owner(team), st.x, st.y, st.heading);
  }
  const orbital = markers(map, 'Orbital Special Structure Position');
  (d.orbital || []).forEach((n, i) => { const t = db.type(n), at = orbital[i]; if (t && at) w.spawn(t, owner(teams[d.team]), at.x, at.y, at.heading); });
  side(d, defend, Math.atan2(entry.y - defend.y, entry.x - defend.x), false);
  side(cb.attacker, entry, Math.atan2(defend.y - entry.y, defend.x - entry.x), true);
  for (const t of teams) if (!t.spawnPoints.length) { const at = t === teams[d.team] ? defend : entry; t.spawnPoints.push({ x: at.x, y: at.y, heading: Math.atan2(-at.y, -at.x) }); }
  w.recountPop();
  return book;
}

export function sideBeaten(w, team) {
  for (const u of w.units) if (!u.dead && u.player.team === team && u.player.id >= 0 && !u.isPad && spaceVictoryRelevant(u.type)) return false;
  for (const s of w.squads) if (!s.dead && s.player.team === team && s.player.id >= 0 && spaceVictoryRelevant(s.type)) return false;
  return !team.players.some(p => p.reinforcements.some(spaceVictoryRelevant));
}
export const spaceVictoryRelevant=t=>t.bool('Victory_Relevant',false)||t.bool('Space_Victory_Relevant',false);

function wholeTeamLost(e) {
  return !!e.members && !!e.fighters && e.members.some((name, i) => db.type(name)?.bool('Respawn_Whole_Team_When_Killed') && !e.fighters.some(f => f.member === i));
}

export function battleResult(w, book, cb, winnerTeam) {
  const alive = book.absent.slice();
  for (const [gid, e] of book.entity) if ((!e.dead||e.retreated)&&!w.parentModeDeaths?.has(e)&&!(wholeTeamLost(e)&&!e.retreated)) alive.push(gid);
  for (const team of [cb.attacker.team, cb.defender.team]) {
    const t = w.teams[team], waiting = book.waiting.filter(u => u.team === team), left = new Map();
    for (const p of t.players) for (const ty of p.reinforcements) left.set(ty.name, (left.get(ty.name) || 0) + 1);
    const called = new Map();
    for (const u of waiting) {
      const n = u.type.name;
      if ((left.get(n) || 0) > 0) { left.set(n, left.get(n) - 1); alive.push(u.gid); continue; }
      const e = book.called && book.called.get(team) && book.called.get(team).find(x => x.type === u.type && !called.has(x));
      if (e) { called.set(e, true); if (!e.dead&&!w.parentModeDeaths?.has(e)) alive.push(u.gid); }
    }
  }
  const linked={};if(cb.linked){const station=w.units.find(u=>!u.dead&&u.isStation&&u.player.id>=0);linked.linkedStation=station?{type:station.type.name,level:station.type.num('Base_Level',0)}:null;}
  const stationLevel = book.station && !book.station.dead ? book.station.stationLevel ?? book.station.type.num('Base_Level', 0) : undefined;
  return { planet: cb.planet, alive, station: !!(book.station && !book.station.dead), stationLevel, winner: winnerTeam === cb.attacker.team ? 'attacker' : 'defender', ...linked };
}
