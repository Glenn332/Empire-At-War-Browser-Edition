import { db, skirmishStation } from '../gamedata.js';
import { buildListFor, isUpgradeType, buildCost, isCompanyType, companySpaceUnits } from './sim.js';
import { arrange, shipClass, spacePop } from './campaignbattle.js';
import { InstantRules } from './instantrules.js';

export { InstantRules };

export const INSTANT_MAX_PLAYERS = 10;
export const INSTANT_MAX_TEAMS = 10;
export const INSTANT_BUDGET = 15000;
export const INSTANT_BUDGET_MIN = 1000;
export const INSTANT_BUDGET_MAX = 100000000;

export const isHeroType = t => [...t.categories()].some(c => c.includes('HERO'));

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
      offered = new Set(out.flatMap(r => shipsOf(r.type)).map(s => rootOf(s)).filter(isHeroType)),
      extra = [];
    for (const t of db.types.values()) {
      if (got.has(t) || isUpgradeType(t) || !t.list('Affiliation').some(a => a.toUpperCase() === F)) continue;
      const cost = t.num('Tactical_Build_Cost_Multiplayer', 0);
      if (!(cost >= 50) || [...t.categories()].some(c => c.includes('NONCOMBAT'))) continue;
      const ships = shipsFor(t).filter(s => s.behaviors().has('SELECTABLE') || s.has('Squadron_Units'));
      if (!ships.length || !(isHeroType(t) || ships.some(isHeroType))) continue;
      if (t.tag.toLowerCase() === 'starbase' || t.behaviors().has('TACTICAL_BUILD_OBJECTS')) continue;
      const roots = ships.map(rootOf);
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

export function placeInstantBattle(w, teams, setup) {
  const armies = setup.instant.armies || [];
  const used = teams.filter(t => t.players.some(p => p.id >= 0));
  const turn = setup.instant.turn || 0,
    count = used.length;
  const margin = 120,
    inX = x => Math.max(w.min.x + margin, Math.min(w.max.x - margin, x)),
    inY = y => Math.max(w.min.y + margin, Math.min(w.max.y - margin, y));
  const fleets = new Map();
  used.forEach((team, k) => {
    const list = [];
    for (const p of team.players) {
      if (p.id < 0) continue;
      for (const name of armies[p.id] || []) for (const type of shipsOf(db.type(name))) list.push({ type, player: p });
    }
    let back = 0,
      side = 0;
    for (const { u, x, y } of arrange(list, { x: 0, y: 0 }, 0)) {
      const r = u.type.has('Squadron_Units') ? 60 : 100;
      back = Math.max(back, r - x);
      side = Math.max(side, Math.abs(y) + r);
    }
    const angle = turn + (k * 2 * Math.PI) / Math.max(1, count);
    const at = edgePoint(w.min, w.max, angle, EDGE_MARGIN + Math.max(back, Math.min(side, 600) * 0.5));
    team.spawnPoints.push({ x: at.x, y: at.y, heading: at.facing });
    for (const p of team.players) if (p.id >= 0) p.spawn = team.spawnPoints[0];
    const placed = [],
      spots = [];
    for (const { u, x, y } of arrange(list, at, at.facing)) {
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
    this.rules = new InstantRules(game.world, () => game.human, (text, cls) => game.message(text, cls));
  }

  step(dt) {
    if (!this.game.over) this.rules.step(dt);
  }

  intro() {
    const g = this.game,
      cine = g.cine,
      R = g.renderer,
      mine = this.fleets.get(g.human.team);
    if (!mine || !mine.units.length || !cine) return;
    const { at, units, reach } = mine,
      cx = mine.center.x,
      cy = mine.center.y;
    const ships = units.filter(u => !u.isSquad);
    const lead = ships.length ? ships.reduce((a, b) => ((b.visualRadius || 0) > (a.visualRadius || 0) ? b : a)) : null;
    const fx = Math.cos(at.facing),
      fy = Math.sin(at.facing),
      side = Math.random() < 0.5 ? -1 : 1;
    const LEN = 8.5;
    let t = 0;
    const speech = g.human.faction.str('SpeechEvent_Tactical_Intro_Space_Attacker').trim();
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
}
