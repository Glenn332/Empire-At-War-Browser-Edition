import { db } from '../gamedata.js';
import { loadMap, skirmishMaps, registerDynamicMaps } from '../ted.js';
import { loadALO } from '../alo.js';

export const DYNAMIC_SIZES = [
  { key: 'small', label: 'Small', half: 5000, players: 3 },
  { key: 'medium', label: 'Medium', half: 6500, players: 4 },
  { key: 'large', label: 'Large', half: 8500, players: 6 },
  { key: 'huge', label: 'Huge', half: 11000, players: 10 },
  { key: 'massive', label: 'Massive', half: 20000, players: 10 }
];
const PREFIX = '@dynamic/';
const SEEDS_KEY = 'swr-dynamic-seeds';
const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;

export const isDynamic = name => typeof name === 'string' && name.toLowerCase().startsWith(PREFIX);
export function parseDynamic(name) {
  const m = /^@dynamic\/([a-z]+)\/(\d+)$/i.exec(String(name || ''));
  if (!m) return null;
  return { size: DYNAMIC_SIZES.find(s => s.key === m[1].toLowerCase()) || DYNAMIC_SIZES[1], seed: +m[2] >>> 0 };
}
export const dynamicName = (size, seed) => `${PREFIX}${size}/${seed >>> 0}`;
export const dynamicSize = name => parseDynamic(name)?.size || DYNAMIC_SIZES[1];
export const dynamicTitle = name => `Dynamic Map: ${dynamicSize(name).label}`;

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const seeds = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(SEEDS_KEY) || '{}');
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
})();
const keepSeeds = () => {
  try {
    localStorage.setItem(SEEDS_KEY, JSON.stringify(seeds));
  } catch {}
};
const seedOf = key => {
  if (!Number.isFinite(seeds[key])) {
    seeds[key] = newSeed();
    keepSeeds();
  }
  return seeds[key] >>> 0;
};
export const dynamicMaps = () => DYNAMIC_SIZES.map(s => dynamicName(s.key, seedOf(s.key)));
export const resizeDynamic = key => dynamicName(key, seedOf(key));
export function rerollDynamic(name) {
  const key = dynamicSize(name).key;
  seeds[key] = newSeed();
  keepSeeds();
  return dynamicName(key, seeds[key]);
}
export function adoptDynamic(name) {
  const d = parseDynamic(name);
  if (!d) return name;
  seeds[d.size.key] = d.seed;
  keepSeeds();
  return dynamicName(d.size.key, d.seed);
}
export const liveMaps = list => [...list.filter(m => !isDynamic(m)), ...(list.some(isDynamic) ? dynamicMaps() : [])];

export const seedCode = name => {
  const d = parseDynamic(name);
  return d ? `${d.size.key.toUpperCase()}-${d.seed}` : '';
};
export function readSeedCode(text, current) {
  const s = String(text || '').trim();
  const full = parseDynamic(s);
  if (full) return dynamicName(full.size.key, full.seed);
  const m = /^(?:([a-z]+)\s*[-:/ ]\s*)?(\d{1,10})$/i.exec(s);
  if (!m || +m[2] > 0xffffffff) return null;
  const size = m[1] ? DYNAMIC_SIZES.find(z => z.key === m[1].toLowerCase()) : dynamicSize(current);
  return size ? dynamicName(size.key, +m[2]) : null;
}
export function dockSeedBar(dlg, bar) {
  const box = dlg.ctl('IDC_IMAGE');
  if (!box) return;
  const n = k => parseFloat(box.style[k]) || 0;
  Object.assign(bar.el.style, {
    left: n('left') + 4 + 'px',
    top: n('top') + n('height') - 26 + 'px',
    width: n('width') - 8 + 'px'
  });
  dlg.el.appendChild(bar.el);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}
export function seedBar({ get, set, readonly = () => false, sound = () => {}, compact = false }) {
  const label = compact
    ? { copy: '⧉', copied: '✓', bad: '✕', roll: '↻' }
    : { copy: 'Copy', copied: 'Copied', bad: 'Bad seed', roll: 'Random' };
  const bar = document.createElement('div');
  bar.className = 'dyn-seed' + (compact ? ' dyn-seed-dock' : '');
  const input = document.createElement('input');
  input.className = 'dyn-seed-input';
  input.spellcheck = false;
  input.placeholder = 'Map seed';
  input.title = 'Map seed: copy it to share this map, or paste one and press Enter to play that exact map';
  const tool = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dyn-seed-btn';
    b.textContent = label;
    b.title = title;
    b.onclick = e => {
      e.stopPropagation();
      if (b.disabled) return;
      sound();
      fn();
    };
    return b;
  };
  let flash = 0;
  const say = (text, cls) => {
    clearTimeout(flash);
    copy.textContent = label[text];
    bar.classList.toggle(cls, true);
    flash = setTimeout(() => {
      copy.textContent = label.copy;
      bar.classList.remove('copied', 'bad');
    }, 1400);
  };
  const copy = tool(label.copy, 'Copy the map seed', async () => {
    if (await copyText(seedCode(get()))) say('copied', 'copied');
    else {
      input.focus();
      input.select();
    }
  });
  const roll = tool(label.roll, 'Random seed: generate a new map', () => {
    set(rerollDynamic(get()));
    update();
  });
  const apply = () => {
    if (readonly()) return update();
    const next = readSeedCode(input.value, get());
    if (!next) {
      say('bad', 'bad');
      return;
    }
    if (next !== get()) set(adoptDynamic(next));
    input.blur();
    update();
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') apply();
    else if (e.key === 'Escape') {
      input.value = seedCode(get());
      input.blur();
    }
  });
  input.addEventListener('change', apply);
  input.addEventListener('focus', () => input.select());
  bar.append(input, copy, roll);
  function update() {
    const name = get();
    bar.classList.toggle('hidden', !isDynamic(name));
    if (document.activeElement !== input) input.value = seedCode(name);
    input.readOnly = readonly();
    roll.disabled = readonly();
  }
  update();
  return { el: bar, update };
}

export const dynamicTurn = (name, teams, turn = 0) => {
  const d = parseDynamic(name),
    k = Math.max(2, Math.min(10, teams | 0)),
    step = (Math.PI * 2) / k;
  const base = d ? random(d.seed ^ 0x2545f491)() * step : 0;
  const j = Math.round((turn - base) / step);
  return base + (((j % k) + k) % k) * step;
};

const random = seed => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const median = a => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};
const incomeOf = (t, depth = 0) => {
  if (!t || depth > 3) return false;
  if (t.sub('Abilities').some(a => a.all('Income_Stream_Ability').length > 0)) return true;
  return incomeOf(db.type(t.str('Tactical_Buildable_Constructed').trim()), depth + 1);
};
const padBuilds = t =>
  t
    .list('Tactical_Buildable_Objects_Multiplayer')
    .filter(n => !db.faction(n))
    .map(n => db.type(n))
    .filter(Boolean);

let vocab = null;
export const warmDynamicMaps = () => vocabulary().catch(() => null);
const PROP_REACH = 1500;
const propReach = new Map(),
  propParts = new Map();
const CLUSTER_PARTS = 6;
const ROCK_FLOOR = 0.05;
const ABUNDANCE = [0.2, 1.6];
const rockyType = t => /aster|rock/i.test(t.name + ' ' + t.str('Space_Model_Name'));
const heft = t => {
  if (!rockyType(t)) return 0;
  const r = t.num('Space_Obstacle_Radius', 0) || (propReach.get(t) || 0) * 0.7;
  return (Math.PI * Math.max(r, 60) ** 2) / 1e6;
};
async function measure(type) {
  const model = type.str('Space_Model_Name');
  const a = model && (await loadALO(model).catch(() => null));
  if (!a || a.isParticle) return 0;
  const at = i => {
    let x = 0,
      y = 0;
    for (let b = a.bones[i], n = 0; b && n < 64; n++) {
      x += b.matrix[3];
      y += b.matrix[7];
      if (!(b.parent >= 0) || b.parent === i) break;
      i = b.parent;
      b = a.bones[i];
    }
    return [x, y];
  };
  let r = 0,
    parts = 0;
  for (const m of a.meshes) {
    if (m.hidden || !m.bbox) continue;
    parts++;
    const [bx, by] = m.bone >= 0 ? at(m.bone) : [0, 0],
      [x0, y0, , x1, y1] = m.bbox;
    r = Math.max(r, Math.hypot(bx + (x0 + x1) / 2, by + (y0 + y1) / 2) + Math.hypot(x1 - x0, y1 - y0) / 2);
  }
  propParts.set(type, parts);
  return r * type.num('Scale_Factor', 1);
}
function vocabulary() {
  vocab ??= (async () => {
    const { space, custom } = await skirmishMaps();
    const files = [...new Set([...space, ...custom.space])].sort();
    const maps = [];
    for (const f of files) {
      const m = await loadMap(f).catch(() => null);
      if (m && !m.terrain) maps.push(m);
    }
    const types = new Set();
    for (const m of maps) for (const o of m.objects) if (!o.type.num('Space_Obstacle_Radius', 0) || rockyType(o.type)) types.add(o.type);
    await Promise.all(
      [...types].map(async t => {
        const r = await measure(t);
        if (!t.num('Space_Obstacle_Radius', 0)) propReach.set(t, r);
      })
    );
    return classify(maps);
  })();
  return vocab;
}

function classify(maps) {
  const seen = new Map(),
    uses = new Map();
  for (const map of maps) for (const t of new Set(map.objects.map(o => o.type))) uses.set(t, (uses.get(t) || 0) + 1);
  const oneOff = t => maps.length >= 4 && (uses.get(t) || 0) < 2;
  for (const map of maps)
    for (const o of map.objects) {
      let e = seen.get(o.type);
      if (!e) seen.set(o.type, (e = { type: o.type, z: [] }));
      if (e.z.length < 64) e.z.push(o.pos[2]);
    }
  const kinds = {
    field: [],
    junk: [],
    nebula: [],
    ion: [],
    rock: [],
    deepRock: [],
    wreck: [],
    scrap: [],
    deco: [],
    solidDeco: [],
    flash: [],
    mine: [],
    pad: [],
    capture: [],
    hub: []
  };
  const z = new Map(),
    shipModels = new Set(
      [...db.types.values()]
        .filter(u => [...u.behaviors()].some(n => /LOCOMOTOR/.test(n)))
        .map(u => u.str('Space_Model_Name').toUpperCase())
        .filter(Boolean)
    );
  for (const e of [...seen.values()].sort((a, b) => a.type.name.localeCompare(b.type.name))) {
    const t = e.type,
      b = t.behaviors(),
      model = t.str('Space_Model_Name');
    z.set(t, median(e.z));
    if (!model || b.has('MARKER') || t.bool('Is_Marker') || t.bool('In_Background') || /^TEAM_\d\d_/i.test(t.name)) continue;
    const r = t.num('Space_Obstacle_Radius', 0),
      solid = b.has('SPACE_OBSTACLE'),
      text = t.name + ' ' + model,
      scrap = /junk|debris|scrap/i.test(text),
      rocky = rockyType(t),
      spread = r || (propReach.get(t) || 0) * 0.7,
      cluster = !solid && rocky && (propParts.get(t) || 0) >= CLUSTER_PARTS;
    const pad = (b.has('TACTICAL_BUILD_OBJECTS') && !t.has('Tactical_Health')) || /_PAD$/i.test(t.name);
    if (pad) (padBuilds(t).some(incomeOf) ? kinds.mine : kinds.pad).push(t);
    else if (b.has('CAPTURE_POINT')) (b.has('DUMMY_STAR_BASE') ? kinds.hub : kinds.capture).push(t);
    else if (b.has('SELECTABLE') || b.has('DUMMY_SPECIAL_WEAPON_SOURCE') || t.has('Tactical_Health')) continue;
    else if (shipModels.has(model.toUpperCase()) || (!r && (propReach.get(t) || 0) > PROP_REACH)) continue;
    else if (t.bool('Is_Ion_Storm') && r > 0) kinds.ion.push(t);
    else if (t.bool('Is_Nebula') && r > 0) kinds.nebula.push(t);
    else if ((t.bool('Is_Asteroid_Field') || cluster) && spread > 0) (scrap ? kinds.junk : kinds.field).push(t);
    else if (!rocky && oneOff(t)) continue;
    else if (t.bool('Is_Decoration')) kinds.flash.push(t);
    else if (solid && rocky) kinds.rock.push(t);
    else if (solid) kinds.solidDeco.push(t);
    else if (rocky) kinds.deepRock.push(t);
    else if (scrap) kinds.scrap.push(t);
    else if (/_D\.ALO$/i.test(model) || /death|wreck|hulk/i.test(t.name)) kinds.wreck.push(t);
    else kinds.deco.push(t);
  }
  const radius = t => t.num('Space_Obstacle_Radius', 0) || (propReach.get(t) || 0) * 0.7;
  for (const k of ['field', 'junk', 'nebula', 'ion', 'rock'])
    kinds[k].sort((a, b) => radius(a) - radius(b) || a.name.localeCompare(b.name));
  const fields = new Set([...kinds.field, ...kinds.junk]),
    mines = new Set(kinds.mine),
    hosts = new Map(),
    offs = [];
  for (const map of maps)
    for (const o of map.objects) {
      if (!mines.has(o.type)) continue;
      let best = null,
        bd = 260;
      for (const q of map.objects) {
        if (!fields.has(q.type)) continue;
        const d = Math.hypot(q.pos[0] - o.pos[0], q.pos[1] - o.pos[1]);
        if (d < bd) (bd = d), (best = q);
      }
      if (!best) continue;
      hosts.set(best.type, (hosts.get(best.type) || 0) + 1);
      offs.push([best.pos[0] - o.pos[0], best.pos[1] - o.pos[1], best.pos[2]]);
    }
  const host = [...hosts].sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))[0]?.[0] || null;
  const size = t => t.num('Space_Obstacle_Radius', 0);
  const homeHost =
    [...hosts.keys()].filter(t => kinds.field.includes(t)).sort((a, b) => size(a) - size(b) || a.name.localeCompare(b.name))[0] || host;
  const donors = maps
    .filter(m => m.environments?.length)
    .map(m => ({
      file: m.file,
      half: Math.max(Math.abs(m.min[0]), Math.abs(m.min[1]), m.max[0], m.max[1]) || 6000
    }));
  const kit = new Map(),
    mineSet = new Set(kinds.mine),
    mineSpots = [];
  let bases = 0,
    turnX = 0,
    turnY = 0;
  for (const map of maps) {
    const cx = (map.min[0] + map.max[0]) / 2,
      cy = (map.min[1] + map.max[1]) / 2;
    for (const s of map.objects) {
      const own = /^TEAM_(\d\d)_SPACE_STATION$/i.exec(s.type.name);
      if (!own) continue;
      bases++;
      const fx = cx - s.pos[0],
        fy = cy - s.pos[1],
        fl = Math.hypot(fx, fy) || 1,
        f = [fx / fl, fy / fl],
        h = (s.rot[2] * Math.PI) / 180,
        hf = [Math.cos(h), Math.sin(h)],
        rel = h - Math.atan2(fy, fx);
      turnX += Math.cos(rel);
      turnY += Math.sin(rel);
      for (const o of map.objects) {
        if (!mineSet.has(o.type)) continue;
        const dx = o.pos[0] - s.pos[0],
          dy = o.pos[1] - s.pos[1];
        if (dx * dx + dy * dy <= 3500 * 3500) mineSpots.push([dx * hf[0] + dy * hf[1], -dx * hf[1] + dy * hf[0]]);
      }
      const here = new Map();
      for (const o of map.objects) {
        const q = /^TEAM_(\d\d)_(.+)$/i.exec(o.type.name);
        if (
          !q ||
          q[1] !== own[1] ||
          !o.type.has('Marker_For_Specific_Object_Type') ||
          /^(SPACE_STATION|BASE_POSITION_MARKER|SPAWN_POINT_MARKER)$/i.test(q[2])
        )
          continue;
        const dx = o.pos[0] - s.pos[0],
          dy = o.pos[1] - s.pos[1];
        if (dx * dx + dy * dy > 3000 * 3000) continue;
        const key = q[2].toUpperCase();
        let e = kit.get(key);
        if (!e) kit.set(key, (e = { suffix: q[2], bases: 0, maps: new Set(), counts: [], spots: [], back: [] }));
        here.set(key, (here.get(key) || 0) + 1);
        e.spots.push([dx * hf[0] + dy * hf[1], -dx * hf[1] + dy * hf[0]]);
        e.back.push(Math.max(0, -(dx * f[0] + dy * f[1])));
        e.maps.add(map.file);
      }
      for (const [key, n] of here) {
        const e = kit.get(key);
        e.bases++;
        e.counts.push(n);
      }
    }
  }
  const baseKit = [...kit.values()]
    .filter(e => e.maps.size >= 2 && e.bases >= bases * 0.1)
    .sort((a, b) => b.bases - a.bases || a.suffix.localeCompare(b.suffix))
    .map(e => ({
      suffix: e.suffix,
      count: Math.max(1, Math.round(median(e.counts))),
      spots: e.spots,
      reach: median(e.spots.map(s => Math.hypot(s[0], s[1]))),
      back: (() => {
        const b = e.back.slice().sort((x, y) => x - y);
        return b.length ? b[Math.floor(b.length * 0.75)] : 0;
      })()
    }));
  const stationTurn = bases && Math.hypot(turnX, turnY) > bases * 0.5 ? Math.atan2(turnY, turnX) : 0;
  const rockDensity = median(
    maps.map(m => {
      const km2 = ((m.max[0] - m.min[0]) * (m.max[1] - m.min[1])) / 1e6;
      return km2 > 0 ? m.objects.reduce((a, o) => a + heft(o.type), 0) / km2 : 0;
    })
  );
  return {
    kinds,
    rockDensity,
    baseKit,
    stationTurn,
    mineSpots,
    z,
    host,
    homeHost,
    hostAt: offs.length ? [median(offs.map(o => o[0])), median(offs.map(o => o[1])), median(offs.map(o => o[2]))] : [0, 0, -100],
    donors
  };
}

const backdropOf = o => o.type.bool('In_Background') || o.type.behaviors().has('DUMMY_SPECIAL_WEAPON_SOURCE');

export async function generateDynamicMap(name, opts = {}) {
  const d = parseDynamic(name);
  if (!d) throw new Error('not a dynamic map: ' + name);
  const v = await vocabulary();
  const K = v.kinds;
  if (!v.donors.length) throw new Error('This game data has no space maps to build a dynamic map from.');
  const instant = !!opts.instant;
  const k = Math.max(2, Math.min(10, opts.teams | 0 || 2));
  const R = random(d.seed ^ Math.imul(k, 0x9e3779b1) ^ (instant ? 0x51ed270b : 0));
  const pick = a => a[Math.floor(R() * a.length)];
  const range = (a, b) => a + (b - a) * R();
  const H = d.size.half,
    P = H - 400;
  const radius = t => t.num('Space_Obstacle_Radius', 0) || (propReach.get(t) || 0) * 0.7;
  const zOf = t => v.z.get(t) ?? 0;

  const objects = [],
    solids = [],
    lanes = [],
    homes = [];
  const KEEP_OUT = 2000;
  const abundance = instant ? 1 : ABUNDANCE[0] + (ABUNDANCE[1] - ABUNDANCE[0]) * R() ** 1.3;
  const rockBudget = Math.max(1.2, (Math.max(v.rockDensity, ROCK_FLOOR) * abundance * 4 * P * P) / 1e6);
  let rocks = 0,
    rockCap = rockBudget * 0.4;
  const nearHome = (x, y, r) => homes.some(b => Math.hypot(x - b.x, y - b.y) < KEEP_OUT + r);
  const add = (type, x, y, z, rot, extra = null) =>
    objects.push({ id: objects.length + 1, crc: 0, owner: -1, type, pos: [x, y, z], rot, scale: 1, hint: '', ...extra });
  const images = (x, y) => {
    const out = [];
    for (let j = 0; j < k; j++) {
      const a = (j * TAU) / k,
        c = Math.cos(a),
        s = Math.sin(a);
      out.push({ x: x * c - y * s, y: x * s + y * c, turn: a * DEG, j });
    }
    return out;
  };
  const inside = (x, y, r) => Math.abs(x) <= P - r && Math.abs(y) <= P - r;
  const laneGap = (x, y, c) => {
    const dx = c.bx - c.ax,
      dy = c.by - c.ay,
      L = dx * dx + dy * dy || 1,
      t = Math.max(0, Math.min(1, ((x - c.ax) * dx + (y - c.ay) * dy) / L));
    return Math.hypot(x - c.ax - t * dx, y - c.ay - t * dy) - c.r;
  };
  const fits = (x, y, r, gap = 0, open = true) => {
    const all = images(x, y);
    return all.every(
      (p, j) =>
        inside(p.x, p.y, Math.min(r, 600)) &&
        solids.every(s => Math.hypot(p.x - s.x, p.y - s.y) >= r + s.r + gap) &&
        (!open || lanes.every(c => laneGap(p.x, p.y, c) >= r)) &&
        all.every((q, i) => i <= j || Math.hypot(p.x - q.x, p.y - q.y) >= 2 * r + gap)
    );
  };
  const put = (type, x, y, r, { z = zOf(type), heading = R() * 360, tilt = [0, 0] } = {}) => {
    if (!type) return;
    rocks += heft(type) * k;
    for (const p of images(x, y)) {
      add(type, p.x, p.y, z, [tilt[0], tilt[1], heading + p.turn]);
      if (r > 0) solids.push({ x: p.x, y: p.y, r });
    }
  };
  const once = (type, x, y, r, { z = zOf(type), heading = R() * 360, tilt = [0, 0], anywhere = false, free = false } = {}) => {
    if (!type || (!anywhere && nearHome(x, y, Math.max(r, radius(type))))) return false;
    const w = free ? 0 : heft(type);
    if (w && rocks + w > rockCap) return false;
    rocks += w;
    add(type, x, y, z, [tilt[0], tilt[1], heading]);
    if (r > 0) solids.push({ x, y, r });
  };
  const polar = (a, r) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  const spot = (tries, gen, r, gap, open = true) => {
    for (let i = 0; i < tries; i++) {
      const p = gen(i);
      if (p && fits(p.x, p.y, r, gap, open)) return p;
    }
    return null;
  };
  const anywhere = () => (k === 2 ? { x: range(-P, P), y: range(-P, P) } : polar(R() * TAU, Math.sqrt(R()) * P));
  const tilted = () => [range(-25, 25), range(-25, 25)];
  const mineAt = (x, y, place = put, home = false) => {
    const m = pick(K.mine);
    if (!m) return false;
    const [dx, dy, dz] = v.hostAt;
    const field = home ? v.homeHost : v.host;
    if (field) {
      const fx = x + dx,
        fy = y + dy,
        r = radius(field),
        a = R() * TAU,
        w = heft(field) * (place === put ? k : 1);
      place(field, fx, fy, 0, { z: dz });
      for (const s of [-1, 1]) {
        if (rocks + w > rockCap) break;
        const d = r * range(0.75, 0.95) * s,
          q = r * range(-0.08, 0.2);
        place(field, fx + Math.cos(a) * d - Math.sin(a) * q, fy + Math.sin(a) * d + Math.cos(a) * q, 0, { z: dz });
      }
    }
    place(m, x, y, 380, { z: 0 });
    return true;
  };

  const edge = a => P / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
  let axis;
  if (!instant) {
    axis = k === 2 ? pick([1, 3, 5, 7, 1, 3, 5, 7, 0, 2, 4, 6].map(i => (i * Math.PI) / 4)) + range(-0.1, 0.1) : R() * TAU;
    const room = Math.max(1000, ...v.baseKit.map(e => e.back + 500));
    const rb = k === 2 ? Math.max(P * 0.45, Math.min(edge(axis) - room - 100, P * 1.05)) : Math.max(P * 0.45, P - room),
      bx = Math.cos(axis) * rb,
      by = Math.sin(axis) * rb;
    const f = { x: -Math.cos(axis), y: -Math.sin(axis) },
      l = { x: -f.y, y: f.x };
    const at = (fw, lt) => ({ x: bx + f.x * fw + l.x * lt, y: by + f.y * fw + l.y * lt });
    const hs = Math.atan2(f.y, f.x) + v.stationTurn,
      atS = (fw, lt) => ({ x: bx + Math.cos(hs) * fw - Math.sin(hs) * lt, y: by + Math.sin(hs) * fw + Math.cos(hs) * lt });
    const face = Math.atan2(f.y, f.x) * DEG;
    const team = (kind, p, heading) =>
      images(p.x, p.y).forEach(q => {
        const t = db.type(`Team_${String(q.j).padStart(2, '0')}_${kind}`) || db.type(`Team_00_${kind}`);
        if (t) add(t, q.x, q.y, 0, [0, 0, heading + q.turn], { team: q.j, role: kind.toUpperCase() });
      });
    team('Space_Station', { x: bx, y: by }, hs * DEG);
    team('Base_Position_Marker', at(-120, 0), face);
    for (const lt of [-260, 0, 260]) team('Spawn_Point_Marker', at(650, lt), face);
    for (const q of images(bx, by)) {
      homes.push({ x: q.x, y: q.y });
      solids.push({ x: q.x, y: q.y, r: 650 });
      lanes.push({ ax: q.x, ay: q.y, bx: 0, by: 0, r: 380 });
    }
    for (const e of v.baseKit)
      for (let i = 0; i < e.count; i++) {
        const shuffled = e.spots
          .map((s, j) => [R(), j])
          .sort((a, b) => a[0] - b[0])
          .map(([, j]) => e.spots[j]);
        const far = shuffled.filter(s => Math.hypot(s[0], s[1]) >= e.reach),
          close = shuffled.filter(s => Math.hypot(s[0], s[1]) < e.reach);
        let p = spot(far.length, j => atS(far[j][0], far[j][1]), 350, 150, false);
        if (!p)
          p = spot(
            far.length,
            j => {
              const k = Math.max(e.reach / Math.hypot(far[j][0], far[j][1]), 0.8);
              return atS(far[j][0] * k, far[j][1] * k);
            },
            350,
            150,
            false
          );
        if (!p) p = spot(close.length, j => atS(close[j][0], close[j][1]), 350, 150, false);
        if (!p) continue;
        team(e.suffix, p, hs * DEG);
        for (const q of images(p.x, p.y)) solids.push({ x: q.x, y: q.y, r: 350 });
      }
    const home = (cands, r, gap, fn) => {
      const p = spot(cands.length, i => at(...cands[i]), r, gap, false);
      if (p) fn(p);
      return !!p;
    };
    const sides = R() < 0.5 ? [1, -1] : [-1, 1];
    const shuffledSpots = v.mineSpots
      .map((m, j) => [R(), j])
      .sort((x, y) => x[0] - y[0])
      .map(([, j]) => v.mineSpots[j]);
    const fixed = s => [
      [-300, 1250 * s],
      [200, 1300 * s],
      [-700, 1100 * s],
      [700, 1250 * s],
      [-200, 1600 * s],
      [1100, 1000 * s],
      [1400, 600 * s]
    ];
    const homeMines = [];
    for (const s of sides) {
      const cands = [
        ...shuffledSpots.map(m => atS(m[0], m[1])),
        ...shuffledSpots.map(m => atS(m[0], -m[1])),
        ...fixed(s).map(c => at(c[0], c[1]))
      ];
      const p = spot(cands.length, i => cands[i], 380, 150, false);
      if (!p) continue;
      mineAt(p.x, p.y, put, true);
      homeMines.push(p);
    }
    for (const m of homeMines) {
      const away = Math.atan2(m.y - by, m.x - bx);
      const ring = [];
      for (let i = 0; i < 36; i++) {
        const a = away + (i % 2 ? 1 : -1) * (0.3 + 0.2 * Math.floor((i % 18) / 2)),
          d = 800 + (i < 18 ? 0 : 250) + 60 * (i % 3);
        ring.push({ x: m.x + Math.cos(a) * d, y: m.y + Math.sin(a) * d });
      }
      const cands = [...ring, ...shuffledSpots.map(s => atS(s[0], s[1])), ...shuffledSpots.map(s => atS(s[0], -s[1]))];
      const p = spot(cands.length, i => cands[i], 250, 120, false);
      if (p) put(pick(K.pad), p.x, p.y, 250, { z: 0, heading: face });
    }
  } else {
    axis = dynamicTurn(name, k);
    for (let j = 0; j < k; j++) {
      const a = axis + (j * TAU) / k,
        e = edge(a);
      solids.push({ ...polar(a, e - 500), r: 1700 });
      lanes.push({
        ...Object.fromEntries(Object.entries(polar(a, e)).map(([key, n]) => ['a' + key, n])),
        bx: Math.cos(a) * e * 0.3,
        by: Math.sin(a) * e * 0.3,
        r: 700
      });
    }
  }

  const fitsOne = (x, y, r, gap = 0, open = true, reach = r) =>
    !nearHome(x, y, reach) &&
    inside(x, y, Math.min(r, 600)) &&
    solids.every(s => Math.hypot(x - s.x, y - s.y) >= r + s.r + gap) &&
    (!open || lanes.every(c => laneGap(x, y, c) >= r));
  const spotOne = (tries, gen, r, gap, open = true) => {
    for (let i = 0; i < tries; i++) {
      const p = gen(i);
      if (p && fitsOne(p.x, p.y, r, gap, open)) return p;
    }
    return null;
  };
  const square = () => ({ x: range(-P, P), y: range(-P, P) });
  const paths = [];
  const belt = (
    list,
    from,
    {
      dir = R() * TAU,
      bend = range(-1, 1) * 0.0003,
      steps = 5 + Math.floor(R() * (5 + P / 2000)),
      wide = 1 + R() ** 1.5 * 1.6,
      space = 1,
      shrink = 0.35,
      solid = 0,
      flash = 0,
      fringe = 0,
      keep = Math.min(3, steps)
    } = {}
  ) => {
    if (!list.length) return 0;
    const mark = [objects.length, solids.length, paths.length, rocks];
    let x = from.x,
      y = from.y,
      placed = 0,
      misses = 0;
    for (let i = 0; i < steps && misses < 3; i++) {
      const lead = pick(list),
        r0 = Math.max(solid, radius(lead));
      if (i) {
        const len = r0 * range(0.8, 1.1) * space;
        dir += bend * len + range(-0.12, 0.12);
        x += Math.cos(dir) * len;
        y += Math.sin(dir) * len;
      }
      const taper = Math.sin((Math.PI * (i + 0.5)) / steps) ** 0.6,
        m = Math.max(1, Math.min(Math.round(wide * taper + range(-0.3, 0.3)), Math.round(1400 / (r0 * space)))),
        nx = -Math.sin(dir),
        ny = Math.cos(dir);
      let hit = 0;
      for (let j = 0; j < m; j++) {
        const t = j ? pick(list) : lead,
          r = Math.max(solid, radius(t)),
          off = ((j - (m - 1) / 2) * range(0.7, 0.95) + range(-0.15, 0.15)) * r * space,
          along = range(-0.25, 0.25) * r * space,
          px = x + nx * off + Math.cos(dir) * along,
          py = y + ny * off + Math.sin(dir) * along;
        if (!fitsOne(px, py, r * shrink, solid ? 30 : 0, true, r)) continue;
        if (once(t, px, py, r * shrink, solid ? { tilt: tilted() } : {}) === false) continue;
        hit++;
        placed++;
        paths.push({ x: px, y: py, dir, r });
        if (K.flash.length && R() < flash) once(pick(K.flash), px + range(-0.3, 0.3) * r, py + range(-0.3, 0.3) * r, 0);
      }
      misses = hit ? 0 : misses + 1;
      if (hit && fringe && K.rock.length && R() < fringe) {
        const t = pick(K.rock),
          r = Math.max(120, radius(t)),
          off = (R() < 0.5 ? -1 : 1) * ((m / 2) * r0 * 0.8 + range(80, 350)),
          px = x + nx * off,
          py = y + ny * off;
        if (fitsOne(px, py, r, 30)) once(t, px, py, r, { tilt: tilted() });
      }
    }
    if (placed < keep) {
      objects.length = mark[0];
      solids.length = mark[1];
      paths.length = mark[2];
      rocks = mark[3];
      return 0;
    }
    return placed;
  };
  const arc = (list, o = {}) => {
    if (!list.length) return 0;
    const r = radius(list[list.length >> 1]) || 300,
      a = R() * TAU,
      rad = Math.max(Rc * range(1.2, 1.8), r * range(3, 4)),
      sign = R() < 0.5 ? -1 : 1,
      len = rad * range(0.8, 1.5);
    return belt(list, polar(a, rad), {
      dir: a + (sign * Math.PI) / 2,
      bend: sign / (rad * 2.2),
      steps: Math.max(3, Math.round(len / (r * 0.85))),
      ...o
    });
  };
  const sizedField = (lo, hi) => {
    const list = K.field.filter(t => radius(t) >= lo && radius(t) <= hi);
    return list.length ? list : K.field;
  };

  const Rc = Math.max(900, Math.min(1800, P * 0.17));
  const around = (n, rLo, rHi, fn) => {
    const base = R() * TAU;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * TAU + range(-0.35, 0.35) * (TAU / n),
        p = polar(a, Rc * range(rLo, rHi));
      fn(p, a);
    }
  };
  const prize = () => {
    if (instant) {
      const big = K.rock[K.rock.length - 1] || K.deepRock[0];
      if (big) once(big, 0, 0, radius(big) || 250, { tilt: tilted() });
      return;
    }
    const centre = (t, x, y, r, o = {}) => once(t, x, y, r, { ...o, anywhere: true });
    if (K.hub.length && R() < 0.6) centre(pick(K.hub), 0, 0, 500, { z: 0 });
    else if (!mineAt(0, 0, centre) && K.capture.length) centre(pick(K.capture), 0, 0, 400, { z: 0 });
  };
  const deep = (n, from = 0) => {
    if (!K.deepRock.length || paths.length <= from) return;
    for (let i = 0; i < n; i++) {
      const p = paths[from + Math.floor(R() * (paths.length - from))],
        along = range(-1, 1) * p.r,
        side = range(-1.6, 1.6) * p.r,
        x = p.x + Math.cos(p.dir) * along - Math.sin(p.dir) * side,
        y = p.y + Math.sin(p.dir) * along + Math.cos(p.dir) * side;
      if (inside(x, y, 0)) once(pick(K.deepRock), x, y, 0, { z: range(-1400, -500), tilt: [R() * 360, R() * 360], free: true });
    }
  };
  const pieces = [
    {
      ok: K.field.length > 0,
      build() {
        prize();
        for (let i = 0, n = R() < 0.35 ? 2 : 1; i < n; i++) arc(sizedField(300, 650), { fringe: 0.35, wide: 1 + R() * 0.9 });
        deep(6 + Math.floor(R() * 6));
      }
    },
    {
      ok: K.ion.length + K.nebula.length > 0,
      build() {
        const pool = K.ion.length ? K.ion : K.nebula,
          core = pool.filter(t => radius(t) <= Rc * 1.3).pop() || pool[0];
        once(core, range(-0.15, 0.15) * Rc, range(-0.15, 0.15) * Rc, 0);
        if (K.flash.length) for (let i = 0; i < 2; i++) once(pick(K.flash), range(-0.3, 0.3) * Rc, range(-0.3, 0.3) * Rc, 0);
        prize();
        const ring = K.nebula.filter(n => radius(n) < Rc);
        around(4 + Math.floor(R() * 4), 1.4, 2, (p, a) =>
          ring.length && R() < 0.6
            ? belt(ring, p, { dir: a + Math.PI / 2, steps: 2 + Math.floor(R() * 3), wide: 1 + R(), flash: 0.3 })
            : belt(sizedField(250, 550), p, { dir: a + Math.PI / 2, steps: 2 + Math.floor(R() * 3), wide: 1 + R() })
        );
      }
    },
    {
      ok: K.wreck.length + K.scrap.length > 0 && K.junk.length + K.field.length > 0,
      build() {
        prize();
        const junk = K.junk.length ? K.junk : K.field;
        for (let i = 0, n = R() < 0.35 ? 2 : 1; i < n; i++) arc(junk, { wide: 1 + R() * 0.6 });
        const hulks = K.wreck.length ? K.wreck : K.scrap;
        for (let i = 0; i < 2 + Math.floor(R() * 3); i++) {
          const p = polar(R() * TAU, Rc * range(0.4, 1));
          once(pick(hulks), p.x, p.y, 0, { tilt: [range(-20, 20), range(-40, 40)] });
        }
        if (K.scrap.length)
          for (let i = 0; i < 4 + Math.floor(R() * 6); i++) {
            const p = polar(R() * TAU, Rc * range(0.3, 1.7));
            once(pick(K.scrap), p.x, p.y, 0);
          }
      }
    },
    {
      ok: K.solidDeco.length + K.deco.length > 0,
      build() {
        prize();
        const parts = K.solidDeco.length ? K.solidDeco : K.deco,
          span = t => propReach.get(t) || 0;
        around(4 + Math.floor(R() * 4), 0.7, 1, (p, a) => {
          const t = pick(parts),
            r = Math.max(K.solidDeco.length ? 160 : 0, span(t));
          if (!r || fitsOne(p.x, p.y, r, 0)) once(t, p.x, p.y, r, { heading: a * DEG + 90 + range(-25, 25) });
        });
        if (K.deco.length)
          around(2 + Math.floor(R() * 4), 1.1, 1.6, (p, a) => {
            const t = pick(K.deco),
              tan = a + Math.PI / 2 + range(-0.4, 0.4),
              gap = Math.max(110, 2 * span(t)),
              n = gap > 400 ? 1 : 2 + Math.floor(R() * 4);
            for (let i = 0; i < n; i++) {
              const x = p.x + Math.cos(tan) * (i - n / 2) * gap,
                y = p.y + Math.sin(tan) * (i - n / 2) * gap;
              if (span(t) <= 55 || fitsOne(x, y, span(t), 0)) once(t, x, y, span(t) > 55 ? span(t) : 0, { heading: tan * DEG, z: -100 });
            }
          });
        deep(4 + Math.floor(R() * 4));
      }
    }
  ].filter(p => p.ok);
  pick(pieces)?.build();
  rockCap = rockBudget;
  solids.push({ x: 0, y: 0, r: Rc * 1.1 });

  if (!instant) {
    const contested = { small: 1, medium: 2, large: 3, huge: 4, massive: 6 }[d.size.key] || 2;
    for (let i = 0; i < contested; i++) {
      const p = spot(120, anywhere, 380, 450);
      if (!p) break;
      mineAt(p.x, p.y);
      if (K.pad.length && R() < 0.6) {
        const q = spot(12, () => polar(R() * TAU, range(500, 800)), 250, 150);
        const near = q && spot(1, () => ({ x: p.x + q.x, y: p.y + q.y }), 250, 150);
        if (near) put(pick(K.pad), near.x, near.y, 250, { z: 0 });
      }
    }
    const caps = { small: 1, medium: 2, large: 3, huge: 4, massive: 6 }[d.size.key] || 2;
    for (let i = 0; i < caps && K.capture.length; i++) {
      const p = spotOne(60, square, 450, 700);
      if (p) once(pick(K.capture), p.x, p.y, 450, { z: 0 });
    }
  }

  const themes = [
    ['field', K.field.length ? 7 : 0],
    ['rocks', K.rock.length ? 1.5 : 0],
    ['nebula', K.nebula.length ? 2.5 : 0],
    ['ion', K.ion.length ? 1 : 0],
    ['junk', K.junk.length ? 1.5 : 0]
  ].filter(t => t[1] > 0);
  const weight = themes.reduce((a, t) => a + t[1], 0);
  const theme = () => {
    let x = R() * weight;
    for (const [name, w] of themes) if ((x -= w) < 0) return name;
    return 'field';
  };
  const total = Math.round(((P * P) / 3.5e6 + 3) * abundance);
  for (let c = 0; c < total; c++) {
    const kind = theme();
    if (kind === 'field' || kind === 'junk') {
      const list = kind === 'junk' ? K.junk : K.field,
        p = spotOne(40, square, 250, 250),
        from = paths.length;
      if (!p || !belt(list, p, { fringe: R() < 0.5 ? 0.4 : 0 })) continue;
      if (kind === 'junk' && K.scrap.length)
        for (let i = 0; i < 2 + Math.floor(R() * 3); i++) {
          const q = paths[from + Math.floor(R() * (paths.length - from))];
          once(pick(K.scrap), q.x + range(-0.6, 0.6) * q.r, q.y + range(-0.6, 0.6) * q.r, 0);
        }
      deep(Math.floor(R() * 3), from);
    } else if (kind === 'rocks') {
      const p = spotOne(40, square, 300, 300),
        from = paths.length;
      if (!p) continue;
      belt(K.rock, p, { solid: 80, shrink: 1, space: 2.2, wide: 1 + R() * 0.9, steps: 3 + Math.floor(R() * 5) });
      deep(1 + Math.floor(R() * 3), from);
    } else {
      const pool = (kind === 'ion' ? K.ion : K.nebula).filter(n => radius(n) <= P * 0.2),
        list = pool.length ? pool : kind === 'ion' ? K.ion : K.nebula,
        p = spotOne(40, square, 300, 200);
      if (!p) continue;
      belt(
        list,
        p,
        kind === 'ion'
          ? { steps: 2 + Math.floor(R() * 2), wide: 1 + R() * 0.6, flash: 0.35, shrink: 0.45 }
          : { steps: 3 + Math.floor(R() * 4), wide: 1 + R() * 1.4, flash: 0.35, shrink: 0.45 }
      );
    }
  }
  deep(Math.round(total * 0.8));

  const donor = pick(v.donors),
    source = await loadMap(donor.file),
    grow = H / donor.half;
  for (const o of source.objects)
    if (backdropOf(o)) objects.push({ ...o, id: objects.length + 1, pos: [o.pos[0] * grow, o.pos[1] * grow, o.pos[2]] });
  return {
    file: name,
    dynamic: true,
    textId: '',
    planet: source.planet,
    objects,
    environment: source.environment,
    environments: source.environments,
    activeEnvironment: source.activeEnvironment,
    terrain: null,
    min: [-H, -H],
    max: [H, H],
    playMin: [-P, -P],
    playMax: [P, P]
  };
}

const glow = (g, x, y, r, inner, outer) => {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
};

export async function dynamicPreview(name, opts = {}, px = 512) {
  const map = await generateDynamicMap(name, opts);
  const v = await vocabulary(),
    K = v.kinds,
    is = list => t => list.includes(t);
  const H = map.max[0],
    S = px / (2 * H),
    X = x => (x + H) * S,
    Y = y => (H - y) * S;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d');
  const bg = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px * 0.75);
  bg.addColorStop(0, '#16202e');
  bg.addColorStop(1, '#030507');
  g.fillStyle = bg;
  g.fillRect(0, 0, px, px);
  const R = random(parseDynamic(name).seed);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.15 + R() * 0.55})`;
    const s = R() < 0.92 ? 1 : 2;
    g.fillRect(R() * px, R() * px, s, s);
  }
  const P = map.playMax[0];
  g.strokeStyle = 'rgba(195,171,2,0.25)';
  g.setLineDash([4, 6]);
  g.strokeRect(X(-P), Y(P), 2 * P * S, 2 * P * S);
  g.setLineDash([]);
  const rad = t => (t.num('Space_Obstacle_Radius', 0) || (propReach.get(t) || 0) * 0.7) * S;
  const layers = [
    [is(K.ion), (x, y, t) => glow(g, x, y, rad(t) * 1.15, 'rgba(90,180,255,0.55)', 'rgba(40,90,200,0)')],
    [is(K.nebula), (x, y, t) => glow(g, x, y, rad(t) * 1.15, 'rgba(190,90,220,0.5)', 'rgba(110,40,160,0)')],
    [
      t => is(K.field)(t) || is(K.junk)(t),
      (x, y, t) => {
        const r = rad(t),
          junk = K.junk.includes(t);
        glow(g, x, y, r, junk ? 'rgba(150,110,80,0.28)' : 'rgba(150,140,125,0.25)', 'rgba(0,0,0,0)');
        const n = Math.max(6, Math.round(r * r * 0.12));
        for (let i = 0; i < n; i++) {
          const a = R() * TAU,
            d = Math.sqrt(R()) * r;
          g.fillStyle = junk
            ? `rgba(170,120,90,${0.5 + R() * 0.4})`
            : `rgba(${150 + R() * 50},${140 + R() * 40},${125 + R() * 30},${0.55 + R() * 0.4})`;
          g.beginPath();
          g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.6 + R() * 1.4, 0, TAU);
          g.fill();
        }
      }
    ],
    [
      is(K.deepRock),
      (x, y, t) => {
        g.fillStyle = 'rgba(120,112,100,0.45)';
        g.beginPath();
        g.arc(x, y, Math.max(1.5, rad(t) * 0.9), 0, TAU);
        g.fill();
      }
    ],
    [
      is(K.rock),
      (x, y, t) => {
        const r = Math.max(2.5, rad(t) * 0.9);
        g.fillStyle = '#8a8378';
        g.strokeStyle = '#2b2824';
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        g.stroke();
      }
    ],
    [
      t => is(K.wreck)(t) || is(K.scrap)(t) || is(K.solidDeco)(t) || is(K.deco)(t),
      (x, y, t, o) => {
        g.save();
        g.translate(x, y);
        g.rotate((-o.rot[2] * Math.PI) / 180);
        g.fillStyle = K.wreck.includes(t) ? 'rgba(160,160,170,0.8)' : 'rgba(130,140,150,0.6)';
        const w = K.wreck.includes(t) ? 9 : 4;
        g.fillRect(-w, -1.5, 2 * w, 3);
        g.restore();
      }
    ],
    [
      t => is(K.capture)(t) || is(K.hub)(t),
      (x, y, t) => {
        const r = K.hub.includes(t) ? 8 : 6;
        glow(g, x, y, r * 2.4, 'rgba(120,255,170,0.35)', 'rgba(0,0,0,0)');
        g.fillStyle = '#7dffb0';
        g.strokeStyle = '#0b2a18';
        g.beginPath();
        for (let i = 0; i < 6; i++) g.lineTo(x + Math.cos((i * TAU) / 6) * r, y + Math.sin((i * TAU) / 6) * r);
        g.closePath();
        g.fill();
        g.stroke();
      }
    ],
    [
      is(K.mine),
      (x, y) => {
        glow(g, x, y, 13, 'rgba(255,205,60,0.45)', 'rgba(0,0,0,0)');
        g.fillStyle = '#ffd34a';
        g.strokeStyle = '#3a2a00';
        g.beginPath();
        g.moveTo(x, y - 6);
        g.lineTo(x + 6, y);
        g.lineTo(x, y + 6);
        g.lineTo(x - 6, y);
        g.closePath();
        g.fill();
        g.stroke();
      }
    ],
    [
      is(K.pad),
      (x, y) => {
        g.fillStyle = '#5fd0ff';
        g.strokeStyle = '#06222e';
        g.fillRect(x - 3.5, y - 3.5, 7, 7);
        g.strokeRect(x - 3.5, y - 3.5, 7, 7);
      }
    ]
  ];
  for (const [test, draw] of layers)
    for (const o of map.objects) {
      if (o.pos[2] < -400 || o.type.bool('In_Background') || !test(o.type)) continue;
      draw(X(o.pos[0]), Y(o.pos[1]), o.type, o);
    }
  return cv;
}

registerDynamicMaps({
  is: isDynamic,
  title: dynamicTitle,
  header: name => ({ kind: 2, players: dynamicSize(name).players, f3: 0, textId: '', planet: '', tag: '', custom: 0 }),
  load: generateDynamicMap,
  preview: dynamicPreview
});
