import { db } from '../gamedata.js';
import { loadMap, skirmishMaps, registerDynamicMaps } from '../ted.js';

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
function vocabulary() {
  vocab ??= (async () => {
    const { space, custom } = await skirmishMaps();
    const files = [...new Set([...space, ...custom.space])].sort();
    const maps = [];
    for (const f of files) {
      const m = await loadMap(f).catch(() => null);
      if (m && !m.terrain) maps.push(m);
    }
    return classify(maps);
  })();
  return vocab;
}

function classify(maps) {
  const seen = new Map();
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
  const z = new Map();
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
      rocky = /aster|rock/i.test(text);
    const pad = (b.has('TACTICAL_BUILD_OBJECTS') && !t.has('Tactical_Health')) || /_PAD$/i.test(t.name);
    if (pad) (padBuilds(t).some(incomeOf) ? kinds.mine : kinds.pad).push(t);
    else if (b.has('CAPTURE_POINT')) (b.has('DUMMY_STAR_BASE') ? kinds.hub : kinds.capture).push(t);
    else if (b.has('SELECTABLE') || b.has('DUMMY_SPECIAL_WEAPON_SOURCE') || t.has('Tactical_Health')) continue;
    else if (t.bool('Is_Ion_Storm') && r > 0) kinds.ion.push(t);
    else if (t.bool('Is_Nebula') && r > 0) kinds.nebula.push(t);
    else if (t.bool('Is_Asteroid_Field') && r > 0) (scrap ? kinds.junk : kinds.field).push(t);
    else if (t.bool('Is_Decoration')) kinds.flash.push(t);
    else if (solid && rocky) kinds.rock.push(t);
    else if (solid) kinds.solidDeco.push(t);
    else if (rocky) kinds.deepRock.push(t);
    else if (scrap) kinds.scrap.push(t);
    else if (/_D\.ALO$/i.test(model) || /death|wreck|hulk/i.test(t.name)) kinds.wreck.push(t);
    else kinds.deco.push(t);
  }
  const radius = t => t.num('Space_Obstacle_Radius', 0);
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
  const host = [...hosts].sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))[0]?.[0] || kinds.field[0] || null;
  const donors = maps
    .filter(m => m.environments?.length)
    .map(m => ({
      file: m.file,
      half: Math.max(Math.abs(m.min[0]), Math.abs(m.min[1]), m.max[0], m.max[1]) || 6000
    }));
  return {
    kinds,
    z,
    host,
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
  if (!v.donors.length || !K.field.length) throw new Error('This game data has no space maps to build a dynamic map from.');
  const instant = !!opts.instant;
  const k = Math.max(2, Math.min(10, opts.teams | 0 || 2));
  const R = random(d.seed ^ Math.imul(k, 0x9e3779b1) ^ (instant ? 0x51ed270b : 0));
  const pick = a => a[Math.floor(R() * a.length)];
  const range = (a, b) => a + (b - a) * R();
  const H = d.size.half,
    P = H - 400;
  const radius = t => t.num('Space_Obstacle_Radius', 0);
  const zOf = t => v.z.get(t) ?? 0;

  const objects = [],
    solids = [],
    lanes = [];
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
    for (const p of images(x, y)) {
      add(type, p.x, p.y, z, [tilt[0], tilt[1], heading + p.turn]);
      if (r > 0) solids.push({ x: p.x, y: p.y, r });
    }
  };
  const once = (type, x, y, r, { z = zOf(type), heading = R() * 360, tilt = [0, 0] } = {}) => {
    if (!type) return;
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
  const mineAt = (x, y, place = put) => {
    const m = pick(K.mine);
    if (!m) return false;
    const [dx, dy, dz] = v.hostAt;
    if (v.host) place(v.host, x + dx, y + dy, 0, { z: dz });
    place(m, x, y, 380, { z: 0 });
    return true;
  };
  const fieldOf = (lo, hi) => {
    const list = K.field.filter(t => radius(t) >= lo && radius(t) <= hi);
    return pick(list.length ? list : K.field);
  };

  const edge = a => P / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
  let axis;
  if (!instant) {
    axis = k === 2 ? pick([1, 3, 5, 7, 1, 3, 5, 7, 0, 2, 4, 6].map(i => (i * Math.PI) / 4)) + range(-0.1, 0.1) : R() * TAU;
    const rb = k === 2 ? Math.max(P * 0.55, Math.min(edge(axis) - 1100, P * 1.05)) : Math.max(P * 0.55, P - 1000),
      bx = Math.cos(axis) * rb,
      by = Math.sin(axis) * rb;
    const f = { x: -Math.cos(axis), y: -Math.sin(axis) },
      l = { x: -f.y, y: f.x };
    const at = (fw, lt) => ({ x: bx + f.x * fw + l.x * lt, y: by + f.y * fw + l.y * lt });
    const face = Math.atan2(f.y, f.x) * DEG;
    const team = (kind, p, heading) =>
      images(p.x, p.y).forEach(q => {
        const t = db.type(`Team_${String(q.j).padStart(2, '0')}_${kind}`) || db.type(`Team_00_${kind}`);
        if (t) add(t, q.x, q.y, 0, [0, 0, heading + q.turn], { team: q.j, role: kind.toUpperCase() });
      });
    team('Space_Station', { x: bx, y: by }, face);
    team('Base_Position_Marker', at(-120, 0), face);
    for (const lt of [-260, 0, 260]) team('Spawn_Point_Marker', at(650, lt), face);
    for (const q of images(bx, by)) {
      solids.push({ x: q.x, y: q.y, r: 650 });
      lanes.push({ ax: q.x, ay: q.y, bx: 0, by: 0, r: 380 });
    }
    const home = (cands, r, gap, fn) => {
      const p = spot(cands.length, i => at(...cands[i]), r, gap, false);
      if (p) fn(p);
      return !!p;
    };
    const sides = R() < 0.5 ? [1, -1] : [-1, 1];
    for (const s of sides)
      home(
        [
          [-300, 1250 * s],
          [200, 1300 * s],
          [-700, 1100 * s],
          [700, 1250 * s],
          [-200, 1600 * s],
          [1100, 1000 * s],
          [1400, 600 * s]
        ],
        380,
        80,
        p => mineAt(p.x, p.y)
      );
    for (const s of sides)
      home(
        [
          [1300, 700 * s],
          [1500, 450 * s],
          [1100, 1000 * s],
          [1700, 800 * s]
        ],
        250,
        120,
        p => put(pick(K.pad), p.x, p.y, 250, { z: 0, heading: face })
      );
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

  const Rc = Math.max(900, Math.min(1800, P * 0.17));
  const m = k * Math.max(1, Math.round(6 / k));
  const step = TAU / m;
  const ring = (count, rr, fn) => {
    for (let i = 0; i < count / k; i++) fn(axis + (i + 0.5) * step * (m / count), rr);
  };
  const prize = () => {
    if (instant) {
      const big = K.rock[K.rock.length - 1] || K.deepRock[0];
      if (big) once(big, 0, 0, radius(big) || 250, { tilt: tilted() });
      return;
    }
    if (K.hub.length && R() < 0.6) once(pick(K.hub), 0, 0, 500, { z: 0 });
    else if (!mineAt(0, 0, once) && K.capture.length) once(pick(K.capture), 0, 0, 400, { z: 0 });
  };
  const pieces = [
    {
      ok: K.field.length > 0,
      build() {
        prize();
        ring(m, Rc, a => {
          const t = fieldOf(400, 800),
            p = polar(a, Rc);
          put(t, p.x, p.y, radius(t) * 0.5);
        });
        if (K.rock.length)
          ring(m, Rc * 1.35, a => {
            const p = polar(a + step / 2, Rc * 1.35);
            if (fits(p.x, p.y, 200, 0, false)) put(pick(K.rock), p.x, p.y, 200, { tilt: tilted() });
          });
        if (K.deepRock.length)
          ring(m * 2, Rc * 0.8, a => {
            const p = polar(a + range(-0.2, 0.2), Rc * range(0.5, 1.3));
            put(pick(K.deepRock), p.x, p.y, 0, { z: range(-1100, -500), tilt: [R() * 360, R() * 360] });
          });
      }
    },
    {
      ok: K.ion.length + K.nebula.length > 0,
      build() {
        const pool = K.ion.length ? K.ion : K.nebula,
          core = pool.filter(t => radius(t) <= Rc * 1.3).pop() || pool[0];
        once(core, 0, 0, 0);
        if (K.flash.length) for (let i = 0; i < 2; i++) once(pick(K.flash), range(-0.3, 0.3) * Rc, range(-0.3, 0.3) * Rc, 0);
        prize();
        ring(m, Rc * 1.7, a => {
          const p = polar(a, Rc * 1.7),
            t = K.nebula.length && R() < 0.6 ? pick(K.nebula.filter(n => radius(n) < Rc)) || K.nebula[0] : fieldOf(250, 550);
          put(t, p.x, p.y, radius(t) * 0.5);
        });
      }
    },
    {
      ok: K.wreck.length + K.scrap.length > 0 && K.junk.length + K.field.length > 0,
      build() {
        prize();
        const junk = K.junk.length ? K.junk : K.field;
        ring(m, Rc * 1.2, a => {
          const t = pick(junk),
            p = polar(a + range(-0.15, 0.15), Rc * range(1, 1.4));
          put(t, p.x, p.y, radius(t) * 0.5);
        });
        const hulks = K.wreck.length ? K.wreck : K.scrap;
        for (let i = 0; i < Math.max(1, Math.round(4 / k)); i++) {
          const p = polar(axis + range(0, TAU / k), Rc * range(0.45, 0.9));
          put(pick(hulks), p.x, p.y, 0, { tilt: [range(-20, 20), range(-40, 40)] });
        }
        if (K.scrap.length)
          for (let i = 0; i < Math.max(2, Math.round(8 / k)); i++) {
            const p = polar(axis + range(0, TAU / k), Rc * range(0.4, 1.6));
            put(pick(K.scrap), p.x, p.y, 0);
          }
      }
    },
    {
      ok: K.solidDeco.length + K.deco.length > 0,
      build() {
        prize();
        const parts = K.solidDeco.length ? K.solidDeco : K.deco;
        ring(m, Rc * 0.85, a => {
          const p = polar(a, Rc * 0.85);
          put(pick(parts), p.x, p.y, K.solidDeco.length ? 160 : 0, { heading: a * DEG + 90 });
        });
        if (K.deco.length)
          ring(m, Rc * 1.3, a => {
            const t = pick(K.deco),
              tan = a + Math.PI / 2;
            for (let i = -2; i <= 1; i++) {
              const p = polar(a + step / 2, Rc * 1.3),
                q = { x: p.x + Math.cos(tan) * (i + 0.5) * 110, y: p.y + Math.sin(tan) * (i + 0.5) * 110 };
              put(t, q.x, q.y, 0, { heading: tan * DEG, z: -100 });
            }
          });
        if (K.deepRock.length)
          ring(m, Rc * 0.5, a => {
            const p = polar(a + step / 2, Rc * 0.5);
            put(pick(K.deepRock), p.x, p.y, 0, { z: range(-1200, -700), tilt: [R() * 360, R() * 360] });
          });
      }
    }
  ].filter(p => p.ok);
  pick(pieces).build();
  solids.push({ x: 0, y: 0, r: Rc * 1.1 });

  if (!instant) {
    const contested = { small: 1, medium: 2, large: 3, huge: 4 }[d.size.key] || 2;
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
    const caps = d.size.key === 'small' ? (R() < 0.5 ? 1 : 0) : 1 + (d.size.key === 'huge' ? 1 : 0);
    for (let i = 0; i < caps && K.capture.length; i++) {
      const s = R() < 0.5 ? 1 : -1;
      const p = spot(30, () => polar(axis + (Math.PI / k) * s + range(-0.35, 0.35) / k, range(0.35, 0.7) * P), 450, 600);
      if (p) put(pick(K.capture), p.x, p.y, 450, { z: 0 });
    }
  }

  const themes = [
    ['field', 8],
    ['rocks', K.rock.length ? 2 : 0],
    ['nebula', K.nebula.length ? 2 : 0],
    ['ion', K.ion.length ? 1 : 0],
    ['junk', K.junk.length ? 1.5 : 0]
  ].filter(t => t[1] > 0);
  const weight = themes.reduce((a, t) => a + t[1], 0);
  const theme = () => {
    let x = R() * weight;
    for (const [name, w] of themes) if ((x -= w) < 0) return name;
    return 'field';
  };
  const total = Math.round((P * P) / 3e6) + 3;
  for (let c = 0; c < Math.ceil(total / k); c++) {
    const kind = theme();
    if (kind === 'field' || kind === 'junk') {
      const list = kind === 'junk' ? K.junk : K.field,
        first = pick(list),
        p = spot(40, anywhere, radius(first) * 0.6, 250);
      if (!p) continue;
      put(first, p.x, p.y, radius(first) * 0.6);
      const more = 1 + Math.floor(R() * 3);
      for (let i = 0; i < more; i++) {
        const t = pick(list),
          a = R() * TAU,
          dist = (radius(first) + radius(t)) * range(0.55, 0.85),
          q = { x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist };
        if (fits(q.x, q.y, radius(t) * 0.5, 0)) put(t, q.x, q.y, radius(t) * 0.5);
      }
      if (K.rock.length && R() < 0.5) {
        const a = R() * TAU,
          q = { x: p.x + Math.cos(a) * radius(first), y: p.y + Math.sin(a) * radius(first) };
        if (fits(q.x, q.y, 150, 50)) put(pick(K.rock), q.x, q.y, 150, { tilt: tilted() });
      }
      if (kind === 'junk' && K.scrap.length)
        for (let i = 0; i < 2; i++)
          put(pick(K.scrap), p.x + range(-1, 1) * radius(first) * 0.6, p.y + range(-1, 1) * radius(first) * 0.6, 0);
    } else if (kind === 'rocks') {
      const p = spot(40, anywhere, 300, 300);
      if (!p) continue;
      const n = 2 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const t = pick(K.rock),
          q = i ? { x: p.x + range(-450, 450), y: p.y + range(-450, 450) } : p;
        if (!i || fits(q.x, q.y, Math.max(80, radius(t)), 30)) put(t, q.x, q.y, Math.max(80, radius(t)), { tilt: tilted() });
      }
    } else {
      const pool = kind === 'ion' ? K.ion : K.nebula,
        t = pick(pool.filter(n => radius(n) <= P * 0.25)) || pool[0],
        p = spot(40, anywhere, radius(t) * 0.7, 200);
      if (!p) continue;
      put(t, p.x, p.y, radius(t) * 0.7);
      if (K.flash.length && R() < 0.6) put(pick(K.flash), p.x + range(-0.3, 0.3) * radius(t), p.y + range(-0.3, 0.3) * radius(t), 0);
    }
  }
  if (K.deepRock.length)
    for (let i = 0; i < Math.ceil((total * 1.5) / k); i++) {
      const p = anywhere();
      if (images(p.x, p.y).every(q => inside(q.x, q.y, 0)))
        put(pick(K.deepRock), p.x, p.y, 0, { z: range(-1400, -600), tilt: [R() * 360, R() * 360] });
    }

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
  const rad = t => t.num('Space_Obstacle_Radius', 0) * S;
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
