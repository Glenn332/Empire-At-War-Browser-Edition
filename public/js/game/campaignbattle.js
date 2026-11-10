import { isTacticalSuperweapon } from './tacticalsuperweapon.js';

import { db } from '../gamedata.js';
import { tacticalTransportType } from './invasion.js';
import { getModelData, buildModel } from '../model.js';
import { HYPER, LOGIC_FPS } from './sim.js';

const CLASS = s => {
  const v = String(s || '').toLowerCase();
  return v.startsWith('fighter')
    ? 0
    : v.startsWith('bomber')
      ? 1
      : v.startsWith('transport')
        ? 2
        : v.startsWith('corvette')
          ? 3
          : v.startsWith('frigate')
            ? 4
            : v.startsWith('super')
              ? 6
              : v.startsWith('capital')
                ? 5
                : 4;
};
export function shipClass(t) {
  if (t.has('Ship_Class')) return CLASS(t.str('Ship_Class'));
  const f = db.type(t.list('Squadron_Units')[0]);
  return f ? (f.has('Ship_Class') ? CLASS(f.str('Ship_Class')) : 0) : 4;
}

export const spacePop = t =>
  t.has('Space_Override_Population_Value') ? t.num('Space_Override_Population_Value', 0) : t.num('Population_Value', 0);

const sizes = new Map();
export function halfSize(t) {
  if (sizes.has(t)) return sizes.get(t);
  let r = 30;
  const f = !t.has('Space_Model_Name') && db.type(t.list('Squadron_Units')[0]);
  const m = getModelData((f || t).str('Space_Model_Name'));
  if (m) {
    const inst = buildModel(m);
    r = inst.radius * (f || t).num('Scale_Factor', 1) * (f ? 3 : 1);
  }
  sizes.set(t, r);
  return r;
}

export const flagshipRider = t =>
  !!t && t.bool('Attach_To_Flagship_During_Space_Battle') && !t.str('Unique_Space_Unit') && !t.has('Space_Model_Name');

export function ridesFlagship(company) {
  const members = company.list('Company_Units').map(n => db.type(n));
  return members.length > 0 && members.every(flagshipRider);
}

export function flagshipScore(t) {
  if (t.has('Squadron_Units') || t.has('Company_Units') || t.list('CategoryMask').some(c => /^super$/i.test(c.trim()))) return 0;
  return t.num('Tactical_Health', 0) * db.constants.num('Object_Max_Health_Multiplier_Space', 1) + t.num('Shield_Points', 0);
}

export function flagshipRecord(field) {
  let best = null,
    top = 0;
  for (const u of field) {
    const s = u.companyType ? 0 : flagshipScore(u.type);
    if (s > top) {
      best = u;
      top = s;
    }
  }
  return best;
}

export function splitForCap(units, cap, linked = null) {
  if (linked) {
    const ordinary = units.filter(u => !isTacticalSuperweapon(u.type));
    const first =
      ordinary.find(u => (u.companyType || u.type).name.toUpperCase() === String(linked.hero).toUpperCase()) ||
      (linked.pathfinder && ordinary.find(u => u.pathfinder));
    if (first)
      return { field: units.filter(u => u === first || isTacticalSuperweapon(u.type)), waiting: ordinary.filter(u => u !== first) };
  } else if (units.some(u => u.pathfinder && !isTacticalSuperweapon(u.type)))
    return {
      field: units.filter(u => u.pathfinder || isTacticalSuperweapon(u.type)),
      waiting: units.filter(u => !u.pathfinder && !isTacticalSuperweapon(u.type))
    };
  const field = [],
    rest = [];
  let left = cap > 0 ? cap : Infinity;
  for (const u of units) (spacePop(u.type) < 1 || (linked && isTacticalSuperweapon(u.type)) ? field : rest).push(u);
  const take = u => {
    field.push(u);
    rest.splice(rest.indexOf(u), 1);
    left -= spacePop(u.type);
  };
  for (const t of [...new Set(rest.map(u => u.type))]) {
    const u = rest.find(x => x.type === t);
    if (u && spacePop(t) <= left) take(u);
  }
  const total = rest.length,
    room = left;
  for (const t of [...new Set(rest.map(u => u.type))]) {
    const of = rest.filter(x => x.type === t),
      n = Math.floor(Math.floor((of.length / total) * room + 0.5) / Math.max(1, spacePop(t)));
    for (const u of of.slice(0, n)) if (spacePop(t) <= left) take(u);
  }
  for (const u of rest.slice()) if (spacePop(u.type) <= left) take(u);
  return { field, waiting: rest };
}

const extents = new Map();
function extentOf(t) {
  if (extents.has(t)) return extents.get(t);
  let e = { along: 30, across: 30 };
  const m = getModelData(t.str('Space_Model_Name'));
  if (m) {
    const box = buildModel(m, { headless: true }).box,
      k = t.num('Scale_Factor', 1);
    e = { along: box.max.x * k, across: box.max.y * k };
  }
  extents.set(t, e);
  return e;
}
function groupSize(list) {
  let a = 0,
    b = 0;
  for (const u of list) {
    const t = u.type,
      members = t.has('Space_Model_Name') ? [] : t.list('Squadron_Units');
    if (!members.length) {
      const e = extentOf(t);
      b = Math.max(b, e.along);
      a = Math.max(a, e.across);
      continue;
    }
    const offsets = t.tuples('Squadron_Offsets').map(o => o.map(parseFloat));
    let x0 = 0,
      x1 = 0,
      y0 = 0,
      y1 = 0;
    members.forEach((n, i) => {
      const f = db.type(n);
      if (!f) return;
      const e = extentOf(f),
        o = offsets[i] || [0, 0];
      x0 = Math.min(x0, o[0] - e.across);
      x1 = Math.max(x1, o[0] + e.across);
      y0 = Math.min(y0, (o[1] || 0) - e.along);
      y1 = Math.max(y1, (o[1] || 0) + e.along);
    });
    b = Math.max(b, (x1 - x0) / 2);
    a = Math.max(a, (y1 - y0) / 2);
  }
  return [a * 2, b * 2, 0];
}

export function smallCraftOrder(list) {
  const f = list.filter(u => shipClass(u.type) === 0),
    b = list.filter(u => shipClass(u.type) === 1);
  if (!f.length || !b.length) return list;
  const out = [];
  if (f.length < b.length) {
    const k = Math.trunc((b.length - f.length) / 2);
    out.push(...b.slice(0, k));
    f.forEach((u, i) => out.push(b[k + i], u));
    out.push(...b.slice(k + f.length));
  } else {
    const h = Math.trunc(b.length / 2),
      extra = f.length - b.length;
    for (let i = 0; i < h; i++) out.push(b[i], f[i]);
    out.push(...f.slice(h, h + extra));
    for (let j = 0; j < b.length - h; j++) out.push(b[h + j], f[h + extra + j]);
  }
  return out;
}

const gridRows = n => (n < 3 ? 1 : n < 7 ? 2 : n < 10 ? 3 : n < 17 ? 4 : n <= 25 ? 5 : 6);
const EXTRA = {
  3: { 1: [1], 2: [0, 2] },
  4: { 1: [0], 2: [0, 2], 3: [0, 1, 2] },
  5: { 1: [0], 2: [1, 3], 3: [0, 2, 4], 4: [0, 1, 2, 3] },
  6: { 1: [0], 2: [2, 3], 3: [1, 3, 5], 4: [1, 2, 3, 4], 5: [0, 1, 2, 3, 4] }
};

export function arrange(units, at, facing) {
  const out = [],
    fx = Math.cos(facing),
    fy = Math.sin(facing);
  const put = (u, along, left) => out.push({ u, x: at.x + fx * along - fy * left, y: at.y + fy * along + fx * left });
  const grid = (list, size) => {
    if (!list.length) return size;
    const n = list.length,
      rows = gridRows(n),
      per = Math.trunc(n / rows),
      counts = Array(rows).fill(per),
      extra = n - rows * per;
    if (extra > 0) {
      const add = rows < 3 ? [...Array(extra).keys()] : EXTRA[rows]?.[extra] || [...Array(extra).keys()];
      for (const r of add) counts[r]++;
    }
    let y = rows * size[1] * 0.5 - size[1] * 0.5,
      k = 0,
      prev = 0,
      shifted = false;
    for (const cnt of counts) {
      let x0 = size[0] * 0.5 - (cnt * size[0]) / 2;
      if (prev) {
        if (prev === cnt) {
          shifted = !shifted;
          if (shifted) x0 += size[0];
        } else if (shifted) {
          x0 -= size[0];
          shifted = false;
        }
      }
      for (let c = 0; c < cnt; c++) put(list[k++], y, -(size[0] * c + x0));
      prev = cnt;
      y -= size[1];
    }
    const last = Math.max(...counts) - 1,
      v = last === 0 ? size[0] * 0.5 : last * 0.5 * size[0];
    return [v, v, size[2]];
  };
  const ring = (list, start, arc, sizeFactor, perRing) => {
    const g = groupSize(list),
      s = Math.hypot(g[0], g[1], g[2]),
      counts = [];
    let r = start + s * 0.5,
      left = list.length;
    const r0 = r;
    while (left > 0) {
      const n = Math.min(left, perRing(s, r));
      counts.push(n);
      left -= n;
      r += s * sizeFactor;
    }
    let k = 0,
      radius = r0;
    for (const n of counts) {
      const first = n === 1 ? 90 : arc.first,
        step = n === 1 ? 90 : arc.span / (n - 1);
      for (let i = 0; i < n; i++) {
        const t = ((first + i * step + 270) * Math.PI) / 180;
        put(list[k++], Math.cos(t) * radius, Math.sin(t) * radius);
      }
      radius += s;
    }
    return arc.returns === 'count' ? r : radius;
  };
  const screen = (list, start) =>
    ring(list, start, { first: 337.5, span: 225, returns: 'count' }, 0.5, (s, r) => Math.trunc(Math.max(s * 3, r * 3.926991) / (s * 0.5)));
  const lead = (list, start) =>
    ring(list, start, { first: 25, span: 130, returns: 'place' }, 1, (s, r) => Math.trunc(Math.max(s * 2, r * 2) / s) + 1);
  const cls = u => shipClass(u.type);
  const groups = [
    units.filter(u => cls(u) === 5),
    units.filter(u => cls(u) === 3 || cls(u) === 4),
    [],
    smallCraftOrder(units.filter(u => cls(u) <= 1))
  ];
  const transports = units.filter(u => cls(u) === 2);
  grid(
    units.filter(u => cls(u) === 6),
    [0, 0, 0]
  );
  let base = [0, 0, 0];
  const first = groups.findIndex(g => g.length);
  if (first < 0) grid(transports, groupSize(transports));
  else {
    base = grid(groups[first], groupSize(groups[first]));
    let radius = Math.hypot(base[0], base[1], base[2]);
    if (first + 1 < 4) {
      if (groups[first + 1].length) radius = screen(groups[first + 1], radius);
      for (let i = first + 2; i < 4; i++) if (groups[i].length) radius = lead(groups[i], radius);
    }
    if (transports.length) {
      const g = groupSize(transports),
        per = Math.max(2, Math.trunc(Math.sqrt(transports.length) + 0.99));
      let y = -base[1] - 200,
        k = 0;
      while (k < transports.length) {
        const cnt = Math.min(per, transports.length - k),
          x0 = g[0] * 0.5 - (cnt * g[0] + (cnt - 1) * 20) / 2;
        for (let c = 0; c < cnt; c++) put(transports[k++], y, -(c * (g[0] + 20) + x0));
        y -= g[1] + 20;
      }
    }
  }
  return out;
}

export function markers(map, name) {
  const want = name.toUpperCase().replace(/[\s_]+/g, ' ');
  return map.objects
    .filter(o => o.type.name.toUpperCase().replace(/[\s_]+/g, ' ') === want)
    .map(o => ({ x: o.pos[0], y: o.pos[1], z: o.pos[2] || 0, heading: (o.rot[2] * Math.PI) / 180 }));
}

export function campaignIntro(game) {
  const cb = game.setup.campaign,
    team = game.human?.team,
    book = game.campaignBook;
  if (!team || !book || game.setup.net) return;
  const arriving = book.anchors[cb.attacker.team];
  if (!arriving) return;
  const units = [...book.entity.values()].filter(e => e && !e.dead && e.player.team.id === cb.attacker.team);
  if (!units.length) return;
  const attacking = team.id === cb.attacker.team;
  hyperspaceOpening(game, {
    entry: arriving,
    own: book.anchors[team.id] || arriving,
    local: attacking,
    lead: units.find(u => !u.isSquad) || units[0],
    speech: game.human.faction
      .str(attacking ? 'SpeechEvent_Tactical_Intro_Space_Attacker' : 'SpeechEvent_Tactical_Intro_Space_Defender')
      .trim()
  });
}

const KEY_END = 120,
  OPENING_SECONDS = 5,
  SPEECH_AFTER = 10;

export function hyperspaceOpening(g, { entry, own = entry, local, lead, speech }) {
  const cine = g.cine,
    R = g.renderer,
    rig = R?.rig;
  if (!cine || !rig) return;
  const facing = Math.atan2(entry.toward.y - entry.y, entry.toward.x - entry.x),
    fx = Math.cos(facing),
    fy = Math.sin(facing),
    ez = entry.z || 0,
    start = { x: entry.x - fx * HYPER.far, y: entry.y - fy * HYPER.far, z: ez };
  let from;
  if (local) {
    from =
      Math.random() < 0.5
        ? { x: entry.x + (start.x - entry.x) * 0.05 - fy * 300, y: entry.y + (start.y - entry.y) * 0.05 + fx * 300, z: ez + 70 }
        : { x: 2 * start.x - entry.x, y: 2 * start.y - entry.y, z: ez - 70 };
  } else {
    from = { x: lead ? lead.x : start.x, y: lead ? lead.y : start.y, z: ez + 20 };
  }
  rig.x = own.x;
  rig.y = own.y;
  rig.clamp?.();
  rig.home = { ...(rig.home || {}), x: rig.x, y: rig.y };
  const pitch = rig.viewPitch ? rig.viewPitch() : rig.pitch,
    cp = Math.cos(pitch);
  const home = { x: rig.x + Math.cos(rig.yaw) * cp * rig.dist, y: rig.y + Math.sin(rig.yaw) * cp * rig.dist, z: (rig.z || 0) + Math.sin(pitch) * rig.dist };
  const ease = k => k * k * (3 - 2 * k),
    mix = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
  const spot = f => (local ? (f <= 35 ? from : mix(from, home, ease((f - 35) / (KEY_END - 35)))) : mix(from, home, ease(f / KEY_END)));
  const aim = f => (local ? (f <= 23 ? start : mix(start, { ...entry, z: ez }, ease((f - 23) / (KEY_END - 23)))) : { x: entry.x, y: entry.y, z: ez });
  let t = 0,
    spoke = false;
  const say = () => {
    if (spoke || !speech) return;
    spoke = true;
    const wait = Math.max(0, SPEECH_AFTER - t) * 1000;
    setTimeout(() => !g.over && g.audio.speech?.enqueue(speech), wait);
  };
  cine.start();
  cine.subject = lead || null;
  cine.sequence = {
    stop() {
      cine.subject = null;
      say();
    },
    frame(dt) {
      if (!g.paused) t += Math.min(dt, 0.1);
      if (t >= OPENING_SECONDS || g.over) return false;
      const f = Math.min(KEY_END, t * LOGIC_FPS),
        p = spot(f),
        q = aim(f),
        cam = R.camera;
      cam.position.set(p.x, p.y, p.z);
      cam.up.set(0, 0, 1);
      cam.lookAt(q.x, q.y, q.z);
      cine.lookX = q.x;
      cine.lookY = q.y;
      cine.camDist = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      return true;
    }
  };
}

export function placeCampaignBattle(w, map, teams, cb) {
  w.holdHyperspace = cb.linked?.cinematic === 2;
  const stations = markers(map, 'Space Station Position'),
    defend = markers(map, 'Defending Forces Position')[0] || { x: 0, y: 0 };
  const entries = markers(map, 'Attacker Entry Position');
  const entry = entries.sort((a, b) => Math.hypot(a.x - defend.x, a.y - defend.y) - Math.hypot(b.x - defend.x, b.y - defend.y))[0] || {
    x: -defend.x || -2000,
    y: -defend.y || 0
  };
  {
    const m = map.objects.find(o => o.type.name.toUpperCase().replace(/[\s_]+/g, ' ') === 'ATTACKER ENTRY POSITION');
    const p = ((m?.rot[1] || 0) * Math.PI) / 180,
      y = ((m?.rot[2] || 0) * Math.PI) / 180;
    w.retreatDir = { x: -Math.cos(p) * Math.cos(y), y: -Math.cos(p) * Math.sin(y), z: Math.sin(p) };
    w.retreatMarker = m ? { x: m.pos[0], y: m.pos[1], z: m.pos[2] || 0 } : null;
  }
  const book = {
    entity: new Map(),
    waiting: [],
    absent: [],
    station: null,
    anchors: { [cb.attacker.team]: { ...entry, toward: defend }, [cb.defender.team]: { ...defend, toward: entry } }
  };
  const owner = team => team.players.find(p => p.human) || team.players[0];
  const side = (s, at, facing, hyper) => {
    const team = teams[s.team],
      p = owner(team);
    const roster = s.units.map(u => {
      const type = tacticalTransportType(u);
      return type === u.type ? u : { ...u, type, companyType: u.type };
    });
    const { field, waiting } = splitForCap(
      roster,
      p.faction ? p.faction.num('Space_Tactical_Unit_Cap', 0) : 0,
      s === cb.attacker ? cb.linked : null
    );
    const lead = flagshipRecord(field),
      aboard = lead ? field.filter(u => u.companyType && ridesFlagship(u.companyType)) : [];
    let flagship = null;
    const companies = [];
    const placed = field.filter(r => !aboard.includes(r));
    for (const { u, x, y } of arrange(placed, at, facing)) {
      const e = w.spawn(u.type, p, x, y, facing);
      if (!e) {
        book.absent.push(u.gid);
        continue;
      }
      if (u === lead) flagship = e;
      if (u.companyType) companies.push([u.companyType, e]);
      if (hyper && !w.tacticalSuperweapons?.record(e)) w.startHyperspace(e);
      book.entity.set(u.gid, e);
    }
    for (const [company, e] of companies)
      if (!flagship) w.carryBonuses?.(company, p, e);
      else {
        w.carryBonuses?.(company, p, e, [], t => !flagshipRider(t));
        w.carryBonuses?.(company, p, flagship, [], flagshipRider);
      }
    for (const u of aboard) {
      const e = flagship || w.spawn(u.type, p, at.x, at.y, facing);
      if (!e) {
        book.absent.push(u.gid);
        continue;
      }
      w.carryBonuses?.(u.companyType, p, e);
      if (!flagship && hyper && !w.tacticalSuperweapons?.record(e)) w.startHyperspace(e);
      book.entity.set(u.gid, e);
    }
    for (const u of waiting) {
      p.reinforcements.push(u.type);
      if (u.companyType) w.carryOnArrival?.(p, u.type, u.companyType);
      if (!p.human) (p.aiPool ||= []).push({ type: u.type, owner: null });
      book.waiting.push({ ...u, team: s.team });
    }
  };
  const d = cb.defender;
  if (d.station) {
    const st = stations[Math.floor(Math.random() * stations.length)] || defend;
    const team = teams[d.team];
    book.station = team.station = team.firstStation = w.spawn(db.type(d.station), owner(team), st.x, st.y, st.heading);
  }
  const orbital = markers(map, 'Orbital Special Structure Position');
  (d.orbital || []).forEach((n, i) => {
    const t = db.type(n),
      at = orbital[i];
    if (t && at) w.spawn(t, owner(teams[d.team]), at.x, at.y, at.heading);
  });
  side(d, defend, Math.atan2(entry.y - defend.y, entry.x - defend.x), false);
  side(cb.attacker, entry, Math.atan2(defend.y - entry.y, defend.x - entry.x), true);
  for (const t of teams)
    if (!t.spawnPoints.length) {
      const at = t === teams[d.team] ? defend : entry;
      t.spawnPoints.push({ x: at.x, y: at.y, heading: Math.atan2(-at.y, -at.x) });
    }
  w.recountPop();
  return book;
}

export function sideBeaten(w, team) {
  for (const u of w.units)
    if (!u.dead && u.player.team === team && u.player.id >= 0 && !u.isPad && spaceVictoryRelevant(u.type)) return false;
  for (const s of w.squads) if (!s.dead && s.player.team === team && s.player.id >= 0 && spaceVictoryRelevant(s.type)) return false;
  return true;
}
export const spaceVictoryRelevant = t => t.bool('Victory_Relevant', false) || t.bool('Space_Victory_Relevant', false);

function wholeTeamLost(e) {
  return (
    !!e.members &&
    !!e.fighters &&
    e.members.some((name, i) => db.type(name)?.bool('Respawn_Whole_Team_When_Killed') && !e.fighters.some(f => f.member === i))
  );
}

export function battleResult(w, book, cb, winnerTeam) {
  const alive = book.absent.slice();
  const attackers = new Set((cb.attacker.units || []).map(u => u.gid));
  for (const [gid, e] of book.entity) {
    const team = w.teams[attackers.has(gid) ? cb.attacker.team : cb.defender.team],
      changedSides = !!team && w.teams.includes(e.player?.team) && e.player.team !== team;
    if ((!e.dead || e.retreated) && !changedSides && !w.parentModeDeaths?.has(e) && !(wholeTeamLost(e) && !e.retreated)) alive.push(gid);
  }
  const squadrons = new Map();
  for (const [gid, e] of book.entity) {
    if (!e.fighters || !e.members?.length || !alive.includes(gid)) continue;
    const k = (attackers.has(gid) ? 'a:' : 'd:') + e.type.name;
    if (!squadrons.has(k)) squadrons.set(k, { nominal: e.members.length, count: 0, gids: [] });
    const group = squadrons.get(k);
    group.count += e.retreated ? e.members.length : e.fighters.filter(f => !f.dead).length;
    group.gids.push(gid);
  }
  const refill = db.constants.num('Squadron_Refill_Threshold', 0.5);
  for (const group of squadrons.values()) {
    let left = group.count;
    for (const gid of group.gids) {
      const count = Math.min(group.nominal, left);
      left -= count;
      if (!(count > 0 && count / group.nominal >= refill)) alive.splice(alive.indexOf(gid), 1);
    }
  }
  for (const team of [cb.attacker.team, cb.defender.team]) {
    const t = w.teams[team],
      waiting = book.waiting.filter(u => u.team === team),
      left = new Map();
    for (const p of t.players) for (const ty of p.reinforcements) left.set(ty.name, (left.get(ty.name) || 0) + 1);
    const called = new Map();
    for (const u of waiting) {
      const n = u.type.name;
      if ((left.get(n) || 0) > 0) {
        left.set(n, left.get(n) - 1);
        alive.push(u.gid);
        continue;
      }
      const e = book.called && book.called.get(team) && book.called.get(team).find(x => x.type === u.type && !called.has(x));
      if (e) {
        called.set(e, true);
        if (!e.dead && !w.parentModeDeaths?.has(e)) alive.push(u.gid);
      }
    }
  }
  const linked = {};
  if (cb.linked) {
    const station = w.units.find(u => !u.dead && u.isStation && u.player.id >= 0);
    linked.linkedStation = station ? { type: station.type.name, level: station.type.num('Base_Level', 0) } : null;
  }
  const stationLevel =
    book.station && !book.station.dead ? (book.station.stationLevel ?? book.station.type.num('Base_Level', 0)) : undefined;
  return {
    planet: cb.planet,
    alive,
    station: !!(book.station && !book.station.dead),
    stationLevel,
    winner: winnerTeam === cb.attacker.team ? 'attacker' : 'defender',
    ...linked
  };
}
