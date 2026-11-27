import { db, skirmishStation } from '../gamedata.js';
import { buildListFor, isUpgradeType, buildCost, isCompanyType, companySpaceUnits } from './sim.js';
import { arrange, footprint, shipClass, spacePop } from './campaignbattle.js';
import { InstantRules } from './instantrules.js';

export { InstantRules };

export const INSTANT_MAX_TEAMS = 10;
export const INSTANT_BUDGET = 15000;
export const INSTANT_BUDGET_MIN = 1000;
export const INSTANT_BUDGET_MAX = 100000000;

// A hero squadron such as Rogue Squadron carries Is_Named_Hero but no CategoryMask; the SpaceHero mask sits on
// its galactic container, which instant action never places.
const heroFlag = t => !!t && ([...t.categories()].some(c => c.includes('HERO')) || t.bool('Is_Named_Hero') || t.bool('Is_Generic_Hero'));
export const isHeroType = t => heroFlag(t) || t.list('Squadron_Units').some(n => heroFlag(db.type(n)));

export function leftOutOfInstant(type) {
  const b = type.behaviors();
  if ((b.has('TACTICAL_BUILD_OBJECTS') && !type.has('Tactical_Health')) || type.name.toUpperCase().endsWith('_PAD')) return true;
  if (b.has('CAPTURE_POINT')) return true;
  return type.sub('Abilities').some(a => a.all('Income_Stream_Ability').length > 0);
}

const mobile = t => {
  if (t.has('Squadron_Units')) return true;
  const b = t.behaviors();
  return b.has('SIMPLE_SPACE_LOCOMOTOR') || b.has('STARSHIP_LOCOMOTOR') || b.has('FIGHTER_LOCOMOTOR');
};

const companyShips = t => {
  const out = [];
  for (const n of t.list('Company_Units')) {
    const m = db.type(n);
    if (!m) continue;
    for (const s of [db.type(m.str('Unique_Space_Unit')), m])
      if (s && (s.has('Space_Model_Name') || s.has('Squadron_Units')) && !out.includes(s)) out.push(s);
  }
  if (!out.length)
    for (const n of t.list('Company_Transport_Unit')) {
      const s = db.type(n);
      if (s && isHeroType(s) && (s.has('Space_Model_Name') || s.has('Squadron_Units')) && !out.includes(s)) out.push(s);
    }
  return out;
};

export function shipsOf(type) {
  if (!type) return [];
  if (!isCompanyType(type)) return [type];
  const own = companyShips(type);
  return own.length ? own : companySpaceUnits(type);
}

const shipsFor = t => (isCompanyType(t) ? companyShips(t) : t.has('Space_Model_Name') || t.has('Squadron_Units') ? [t] : []).filter(mobile);

export const CLASS_GROUPS = [
  { key: 'craft', label: 'Fighters & Bombers', of: c => c <= 1 },
  { key: 'light', label: 'Corvettes & Transports', of: c => c === 2 || c === 3 },
  { key: 'frigate', label: 'Frigates', of: c => c === 4 },
  { key: 'capital', label: 'Capital Ships', of: c => c >= 5 }
];

const rosters = new Map();
export function instantRoster(faction, allHeroes = true) {
  const key = String(faction).toUpperCase() + (allHeroes ? '+' : '');
  if (rosters.has(key)) return rosters.get(key);
  const builders = [],
    seen = new Set(),
    out = [],
    got = new Set();
  for (let st = skirmishStation(faction), guard = 0; st && guard < 8; st = db.type(st.str('Next_Level_Base')), guard++)
    if (!seen.has(st)) {
      seen.add(st);
      builders.push(st);
    }
  for (const t of db.types.values())
    if (!seen.has(t) && t.behaviors().has('CAPTURE_POINT') && t.list('Tactical_Buildable_Objects_Multiplayer').length) {
      seen.add(t);
      builders.push(t);
    }
  for (const st of builders)
    for (const t of buildListFor(st, faction)) {
      if (got.has(t) || isUpgradeType(t)) continue;
      const ships = shipsFor(t);
      if (!ships.length) continue;
      if (t.tag.toLowerCase() === 'starbase' || t.behaviors().has('TACTICAL_BUILD_OBJECTS')) continue;
      const cost = buildCost(t);
      if (!(cost > 0)) continue;
      got.add(t);
      out.push({
        type: t,
        name: t.name,
        label: db.t(t.str('Text_ID')) || t.name.replace(/_/g, ' '),
        cost,
        pop: ships.reduce((n, s) => n + spacePop(s), 0),
        cls: Math.max(...ships.map(shipClass)),
        hero: isHeroType(t) || ships.some(isHeroType),
        icon: t.str('Icon_Name') || ships[0].str('Icon_Name')
      });
    }
  if (allHeroes) {
    const F = String(faction).toUpperCase(),
      look = list => list.map(s => (s.str('Space_Model_Name') || s.name).toUpperCase()).join('+'),
      rootOf = t => {
        let r = t;
        for (let k = 0; k < 8; k++) {
          const up = db.type(r.str('Variant_Of_Existing_Type').trim());
          if (!up || up === r) break;
          r = up;
        }
        return r;
      },
      offered = new Set(
        out
          .flatMap(r => shipsOf(r.type))
          .flatMap(s => [s, rootOf(s)])
          .filter(isHeroType)
      ),
      extra = [];
    for (const t of db.types.values()) {
      if (got.has(t) || isUpgradeType(t) || !t.list('Affiliation').some(a => a.toUpperCase() === F)) continue;
      const cost = t.num('Tactical_Build_Cost_Multiplayer', 0);
      if (!(cost >= 50) || [...t.categories()].some(c => c.includes('NONCOMBAT'))) continue;
      const ships = shipsFor(t).filter(s => s.behaviors().has('SELECTABLE') || s.has('Squadron_Units'));
      if (!ships.length || !(isHeroType(t) || ships.some(isHeroType))) continue;
      if (t.tag.toLowerCase() === 'starbase' || t.behaviors().has('TACTICAL_BUILD_OBJECTS')) continue;
      const roots = ships.map(rootOf);
      // A named ship can be a variant of a plain one (The Peacebringer), so the ship itself is matched as well as its root.
      if (ships.some(s => isHeroType(s) && offered.has(s))) continue;
      if (roots.some(r => isHeroType(r) && (offered.has(r) || !r.list('Affiliation').some(a => a.toUpperCase() === F)))) continue;
      extra.push({
        type: t,
        name: t.name,
        label: db.t(t.str('Text_ID')) || t.name.replace(/_/g, ' '),
        cost,
        pop: ships.reduce((n, s) => n + spacePop(s), 0),
        cls: Math.max(...ships.map(shipClass)),
        hero: true,
        extra: true,
        icon: t.str('Icon_Name') || ships[0].str('Icon_Name'),
        same: roots.map(r => r.name.toUpperCase()).join('+') + '|' + look(ships)
      });
    }
    extra.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    const models = new Set(),
      known = new Set(out.filter(r => r.hero).map(r => r.label.trim().toUpperCase() + '|' + look(shipsOf(r.type))));
    for (const r of extra) {
      const k = r.label.trim().toUpperCase() + '|' + r.same;
      if (models.has(k) || known.has(r.label.trim().toUpperCase() + '|' + r.same.split('|')[1])) continue;
      models.add(k);
      delete r.same;
      out.push(r);
    }
  }
  out.sort((a, b) => a.hero - b.hero || a.cls - b.cls || a.cost - b.cost || a.label.localeCompare(b.label));
  rosters.set(key, out);
  return out;
}

export function armyCost(roster, names) {
  const by = new Map(roster.map(r => [r.name, r]));
  let n = 0;
  for (const name of names) n += by.get(name)?.cost || 0;
  return n;
}

export function canAdd(roster, names, budget, entry) {
  if (!entry) return false;
  if (entry.hero && names.includes(entry.name)) return false;
  return armyCost(roster, names) + entry.cost <= budget;
}

export function randomArmy(roster, budget, rnd = Math.random) {
  const out = [],
    heroes = new Set();
  let left = budget;
  const big = roster.filter(r => !r.hero && r.cls >= 4 && r.cost <= budget * 0.45);
  if (big.length && rnd() < 0.85) {
    const r = big[Math.floor(rnd() * big.length)];
    out.push(r.name);
    left -= r.cost;
  }
  for (let guard = 0; guard < 4000; guard++) {
    const can = roster.filter(r => r.cost <= left && !(r.hero && heroes.has(r.name)) && !(r.hero && rnd() < 0.6));
    if (!can.length) {
      if (!roster.some(r => r.cost <= left && !(r.hero && heroes.has(r.name)))) break;
      continue;
    }
    const weights = can.map(r => Math.sqrt(r.cost) * (r.hero ? 0.5 : 1));
    let pick = rnd() * weights.reduce((a, b) => a + b, 0),
      i = 0;
    while (i < can.length - 1 && (pick -= weights[i]) > 0) i++;
    const r = can[i];
    out.push(r.name);
    left -= r.cost;
    if (r.hero) heroes.add(r.name);
  }
  const order = new Map(roster.map((r, i) => [r.name, i]));
  return out.sort((a, b) => order.get(a) - order.get(b));
}

export const EDGE_MARGIN = 350;

export function edgePoint(min, max, angle, inset = EDGE_MARGIN) {
  const cx = (min.x + max.x) / 2,
    cy = (min.y + max.y) / 2,
    half = Math.min(max.x - min.x, max.y - min.y) / 2,
    room = Math.min(inset, half * 0.4),
    hx = Math.max(0, (max.x - min.x) / 2 - room),
    hy = Math.max(0, (max.y - min.y) / 2 - room),
    c = Math.cos(angle),
    s = Math.sin(angle);
  const t = Math.min(Math.abs(c) > 1e-6 ? hx / Math.abs(c) : Infinity, Math.abs(s) > 1e-6 ? hy / Math.abs(s) : Infinity);
  const x = cx + c * t,
    y = cy + s * t;
  return { x, y, facing: Math.atan2(cy - y, cx - x), angle };
}

export function entryPoints(min, max, count, turn = 0, inset = EDGE_MARGIN) {
  const out = [];
  for (let k = 0; k < count; k++) out.push(edgePoint(min, max, turn + (k * 2 * Math.PI) / Math.max(1, count), inset));
  return out;
}

// Small fleets keep the campaign formation. Past this depth its forward rings
// reach toward the map centre, so bigger fleets are packed in rows instead.
const FORMATION_DEPTH = 900;
const GAP_MIN = 40,
  GAP = 0.15,
  GAP_SIDE = 0.35,
  SQUEEZE_MIN = 0.15,
  CORNER_CLEAR = 1500;

// The map border as one loop, counter-clockwise: bottom, right, top, left.
// t runs along a side from its first corner; (nx, ny) points into the map.
function borderOf(min, max) {
  const W = max.x - min.x,
    H = max.y - min.y;
  const sides = [
    { len: W, nx: 0, ny: 1, tx: 1, ty: 0, x0: min.x, y0: min.y, t: p => p.x - min.x },
    { len: H, nx: -1, ny: 0, tx: 0, ty: 1, x0: max.x, y0: min.y, t: p => p.y - min.y },
    { len: W, nx: 0, ny: -1, tx: -1, ty: 0, x0: max.x, y0: max.y, t: p => max.x - p.x },
    { len: H, nx: 1, ny: 0, tx: 0, ty: -1, x0: min.x, y0: max.y, t: p => max.y - p.y }
  ];
  let from = 0;
  for (const s of sides) {
    s.from = from;
    from += s.len;
  }
  const L = from,
    cx = (min.x + max.x) / 2,
    cy = (min.y + max.y) / 2,
    // Loop position of a point, pushed out to the border from the map centre so
    // a point on a diagonal lands on the corner rather than either side of it.
    loop = q => {
      const dx = q.x - cx,
        dy = q.y - cy,
        r = Math.min(Math.abs(dx) > 1e-6 ? W / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? H / 2 / Math.abs(dy) : Infinity),
        p = Number.isFinite(r) ? { x: cx + dx * r, y: cy + dy * r } : { x: max.x, y: cy };
      const d = [p.y - min.y, max.x - p.x, max.y - p.y, p.x - min.x];
      const i = d.indexOf(Math.min(...d)),
        s = sides[i];
      return s.from + Math.max(0, Math.min(s.len, s.t(p)));
    };
  return { sides, L, loop };
}

const wrap = (v, L) => ((v % L) + L) % L;

// Each fleet owns the border halfway to its neighbours and lines up along the
// side holding most of that share; a corner tie goes to the later side, so
// fleets at the corners turn the same way round and never share a side end.
function borderShares(min, max, points) {
  const B = borderOf(min, max),
    { sides, L } = B,
    pos = points.map(B.loop),
    order = pos.map((_, i) => i).sort((a, b) => pos[a] - pos[b] || a - b),
    n = points.length;
  return points.map((_, i) => {
    const r = order.indexOf(i),
      prev = pos[order[(r + n - 1) % n]],
      next = pos[order[(r + 1) % n]],
      P = pos[i];
    const a = P - (wrap(P - prev, L) || L) / 2,
      b = P + (wrap(next - P, L) || L) / 2;
    let best = null;
    sides.forEach((s, k) => {
      for (const shift of [-L, 0, L]) {
        const u0 = Math.max(a, s.from + shift),
          u1 = Math.min(b, s.from + shift + s.len);
        if (u1 - u0 <= 0) continue;
        if (!best || u1 - u0 > best.u1 - best.u0 + 1 || (u1 - u0 > best.u1 - best.u0 - 1 && u0 > best.u0))
          best = { k, u0, u1, t0: u0 - s.from - shift, t1: u1 - s.from - shift };
      }
    });
    return { ...best, a, b, side: sides[best.k], sides, L };
  });
}

// Rows along the map side, biggest ships at the back, each ship spaced by its
// own size rather than the largest in its group. Local coords: along is the
// side's inward normal, left runs along the side; the block is centred on 0.
// skew is the angle between the ships' facing and that normal.
export function packFleet(list, room, maxDepth = Infinity, skew = 0) {
  const sn = Math.abs(Math.sin(skew)),
    cs = Math.abs(Math.cos(skew));
  const cells = list.map((u, i) => {
    // Long ships get more room beside them, so they can turn out of the line.
    const [len, beam] = footprint(u.type),
      long = Math.max(len, beam),
      side = Math.max(GAP_MIN, long * GAP_SIDE),
      ahead = Math.max(GAP_MIN, long * GAP);
    return { u, i, c: shipClass(u.type), w: len * sn + beam * cs + side, d: len * cs + beam * sn + ahead };
  });
  cells.sort((p, q) => q.c - p.c || q.w * q.d - p.w * p.d || p.i - q.i);
  const area = cells.reduce((s, c) => s + c.w * c.d, 0),
    widest = cells.reduce((m, c) => Math.max(m, c.w), 0);
  const rowsOf = width => {
    const rows = [];
    let row = null;
    for (const c of cells) {
      if (!row || row.w + c.w > width) rows.push((row = { cells: [], w: 0, d: 0 }));
      row.cells.push(c);
      row.w += c.w;
      row.d = Math.max(row.d, c.d);
    }
    return rows;
  };
  const deep = rows => rows.reduce((s, r) => s + r.d, 0);
  const rows = rowsOf(Math.max(widest, Math.min(room, Math.sqrt(area * 4))));
  // Thousands of ships cannot fit at full spacing; squeeze the rows rather than
  // let the block run across the centre of the map.
  const full = deep(rows),
    k = full > maxDepth ? Math.max(SQUEEZE_MIN, maxDepth / full) : 1,
    depth = full * k,
    out = [];
  let along = -depth / 2;
  for (const r of rows) {
    let left = r.w / 2;
    for (const c of r.cells) {
      out.push({ u: c.u, along: along + (r.d * k) / 2, left: left - c.w / 2 });
      left -= c.w;
    }
    along += r.d * k;
  }
  return { slots: out, depth, width: rows.reduce((m, r) => Math.max(m, r.w), 0) };
}

export function placeInstantBattle(w, teams, setup) {
  const armies = setup.instant.armies || [];
  const used = teams.filter(t => t.players.some(p => p.id >= 0));
  const turn = setup.instant.turn || 0,
    count = used.length;
  const margin = 120,
    inX = x => Math.max(w.min.x + margin, Math.min(w.max.x - margin, x)),
    inY = y => Math.max(w.min.y + margin, Math.min(w.max.y - margin, y));
  const fleets = new Map(),
    edges = used.map((_, k) => edgePoint(w.min, w.max, turn + (k * 2 * Math.PI) / Math.max(1, count))),
    midX = (w.min.x + w.max.x) / 2,
    midY = (w.min.y + w.max.y) / 2,
    half = Math.min(w.max.x - w.min.x, w.max.y - w.min.y) / 2,
    maxDepth = half * 0.5,
    shares = borderShares(w.min, w.max, edges),
    clampT = (t, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, t)));
  // First pass: each fleet's ships, whether it keeps the campaign formation, and
  // how far in it reaches when packed on its whole share of the border.
  const plans = used.map((team, k) => {
    const list = [];
    for (const p of team.players) {
      if (p.id < 0) continue;
      for (const name of armies[p.id] || []) for (const type of shipsOf(db.type(name))) list.push({ type, player: p });
    }
    let back = 0,
      front = 0,
      side = 0;
    for (const { u, x, y } of arrange(list, { x: 0, y: 0 }, 0)) {
      const r = u.type.has('Squadron_Units') ? 60 : 100;
      back = Math.max(back, r - x);
      front = Math.max(front, x + r);
      side = Math.max(side, Math.abs(y) + r);
    }
    const sh = shares[k],
      s = sh.side,
      t0 = Math.max(sh.t0, margin),
      t1 = Math.min(sh.t1, s.len - margin),
      pack = front + back > FORMATION_DEPTH || 2 * side > t1 - t0,
      mid = clampT(s.t(edges[k]), t0, t1),
      px = s.x0 + s.tx * mid + s.nx * (EDGE_MARGIN + 1000),
      py = s.y0 + s.ty * mid + s.ny * (EDGE_MARGIN + 1000),
      skew = Math.atan2(midY - py, midX - px) - Math.atan2(s.ny, s.nx);
    if (!pack) return { team, list, back, side, pack, skew, t0: mid - side, t1: mid + side, inward: EDGE_MARGIN + front + back };
    const est = packFleet(list, t1 - t0, maxDepth, skew);
    return { team, list, back, side, pack, skew, t0, t1, inward: EDGE_MARGIN + Math.min(est.depth, maxDepth) };
  });
  // Second pass: fleets sharing a side leave a gap between them, and where two
  // fleets meet round a map corner the one with more side to spare steps back
  // far enough to clear the other's depth (a tie goes against the fleet whose
  // share wraps the corner).
  const holds = (sh, c) => wrap(c - sh.a, sh.L) < sh.b - sh.a;
  plans.forEach((p, k) => {
    if (!p.pack) return;
    const sh = shares[k];
    if (shares.some((o, j) => j !== k && o.k === sh.k && Math.abs(o.t1 - sh.t0) < 1)) p.t0 += CORNER_CLEAR / 2;
    if (shares.some((o, j) => j !== k && o.k === sh.k && Math.abs(o.t0 - sh.t1) < 1)) p.t1 -= CORNER_CLEAR / 2;
  });
  const sides = shares[0]?.sides || [];
  sides.forEach((before, i) => {
    const after = (i + 1) % 4,
      corner = before.from + before.len;
    // The fleet on each side nearest this corner, and how far it stays from it.
    const nearest = (side, gapOf) =>
      plans.reduce((m, p, j) => (shares[j].k !== side || gapOf(p) >= (m?.gap ?? Infinity) ? m : { j, p, gap: gapOf(p) }), null);
    const A = nearest(i, p => before.len - p.t1),
      B = nearest(after, p => p.t0);
    if (!A || !B || A.gap >= B.p.inward + CORNER_CLEAR || B.gap >= A.p.inward + CORNER_CLEAR) return;
    const lenA = A.p.t1 - A.p.t0,
      lenB = B.p.t1 - B.p.t0,
      aYields = !B.p.pack || (A.p.pack && (Math.abs(lenA - lenB) > 1 ? lenA > lenB : holds(shares[A.j], corner)));
    // Never give up more than most of the stretch: a fleet squeezed into a
    // sliver would run a single file across the map instead.
    if (aYields) {
      if (A.p.pack) A.p.t1 = Math.max(A.p.t0 + lenA * 0.4, Math.min(A.p.t1, before.len - B.p.inward - CORNER_CLEAR));
    } else if (B.p.pack) B.p.t0 = Math.min(B.p.t1 - lenB * 0.4, Math.max(B.p.t0, A.p.inward + CORNER_CLEAR));
  });
  plans.forEach((plan, k) => {
    const { team, list, back, side } = plan,
      edge = edges[k],
      s = shares[k].side;
    let at, packed;
    if (plan.pack) {
      const room = Math.max(0, plan.t1 - plan.t0);
      packed = packFleet(list, room, maxDepth, plan.skew);
      const hw = Math.min(packed.width, room) / 2,
        tc = clampT(s.t(edge), plan.t0 + hw, plan.t1 - hw),
        inward = Math.min(EDGE_MARGIN + packed.depth / 2, half * 0.8),
        x = s.x0 + s.tx * tc + s.nx * inward,
        y = s.y0 + s.ty * tc + s.ny * inward;
      at = { x, y, facing: Math.atan2(midY - y, midX - x) };
    } else at = edgePoint(w.min, w.max, edge.angle, EDGE_MARGIN + Math.max(back, Math.min(side, 600) * 0.5));
    team.spawnPoints.push({ x: at.x, y: at.y, heading: at.facing });
    for (const p of team.players) if (p.id >= 0) p.spawn = team.spawnPoints[0];
    const slots = packed
      ? packed.slots.map(q => ({ u: q.u, x: at.x + s.nx * q.along + s.tx * q.left, y: at.y + s.ny * q.along + s.ty * q.left }))
      : arrange(list, at, at.facing);
    const placed = [],
      spots = [];
    for (const { u, x, y } of slots) {
      const e = w.spawn(u.type, u.player, inX(x), inY(y), at.facing);
      if (!e) continue;
      if (!w.tacticalSuperweapons?.record(e)) w.startHyperspace(e);
      placed.push(e);
      spots.push({ x: inX(x), y: inY(y), r: e.isSquad ? 60 : e.visualRadius || 60 });
    }
    let cx = at.x,
      cy = at.y,
      reach = 0;
    if (spots.length) {
      cx = spots.reduce((a, s) => a + s.x, 0) / spots.length;
      cy = spots.reduce((a, s) => a + s.y, 0) / spots.length;
      for (const s of spots) reach = Math.max(reach, Math.hypot(s.x - cx, s.y - cy) + s.r);
    }
    fleets.set(team, { at, units: placed, center: { x: cx, y: cy }, reach: Math.max(350, reach) });
  });
  w.recountPop();
  return fleets;
}

export class InstantBattle {
  constructor(game, fleets) {
    this.game = game;
    this.fleets = fleets;
    this.rules = new InstantRules(
      game.world,
      () => (game.observer ? null : game.human),
      (text, cls) => game.message(text, cls),
      !!game.setup.net
    );
  }

  step(dt) {
    if (!this.game.over) this.rules.step(dt);
  }

  intro() {
    const g = this.game,
      mine = this.fleets.get(g.human.team);
    if (!mine || !mine.units.length) return;
    fleetIntro(g, {
      units: mine.units,
      center: mine.center,
      facing: mine.at.facing,
      reach: mine.reach,
      speech: g.human.faction.str('SpeechEvent_Tactical_Intro_Space_Attacker').trim()
    });
  }
}

export function fleetIntro(g, { units, center, facing, reach, speech }) {
  const cine = g.cine,
    R = g.renderer;
  if (!cine || !units.length) return;
  const cx = center.x,
    cy = center.y;
  const ships = units.filter(u => !u.isSquad);
  const lead = ships.length ? ships.reduce((a, b) => ((b.visualRadius || 0) > (a.visualRadius || 0) ? b : a)) : null;
  const fx = Math.cos(facing),
    fy = Math.sin(facing),
    side = Math.random() < 0.5 ? -1 : 1;
  const LEN = 8.5;
  let t = 0;
  const skip = e => {
    if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      cine.stop();
    }
  };
  addEventListener('keydown', skip, true);
  const pos = { x: 0, y: 0, z: 0 },
    look = { x: 0, y: 0, z: 0 };
  cine.start();
  cine.subject = lead;
  cine.sequence = {
    stop() {
      removeEventListener('keydown', skip, true);
      const rig = R.rig;
      if (rig) {
        rig.x = cx;
        rig.y = cy;
        rig.clamp?.();
        rig.home = { ...(rig.home || {}), x: cx, y: cy };
      }
      cine.subject = null;
    },
    frame(dt) {
      if (!g.paused) t += Math.min(dt, 0.1);
      if (t >= LEN || g.over) return false;
      if (speech && t > 1.2 && !this.spoke) {
        this.spoke = true;
        g.audio.speech?.enqueue(speech);
      }
      const k = Math.min(1, t / LEN),
        e = k * k * (3 - 2 * k);
      const ahead = reach * (1.2 - 0.25 * e),
        off = side * reach * (0.35 + 0.3 * e),
        up = reach * (0.1 + 0.4 * e);
      pos.x = cx + fx * ahead - fy * off;
      pos.y = cy + fy * ahead + fx * off;
      pos.z = up;
      look.x = cx - fx * reach * 0.35 * (1 - e);
      look.y = cy - fy * reach * 0.35 * (1 - e);
      look.z = 0;
      const cam = R.camera;
      if (cam.fov !== 55) {
        cam.fov = 55;
        cam.updateProjectionMatrix();
      }
      cam.position.set(pos.x, pos.y, pos.z);
      cam.up.set(0, 0, 1);
      cam.lookAt(look.x, look.y, look.z);
      cine.lookX = look.x;
      cine.lookY = look.y;
      cine.camDist = Math.hypot(pos.x - look.x, pos.y - look.y, pos.z - look.z);
      return true;
    }
  };
}
