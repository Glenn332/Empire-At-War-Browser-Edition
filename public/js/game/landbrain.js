import { db } from '../gamedata.js';
import { fetchText, findFiles } from '../vfs.js';
import { simRandom } from './simrandom.js';

const FILES = ['BasicLandEquations', 'AI_Equations_ExpansionGeneric_Land', 'AI_Equations_ExpansionGeneric_LandSkirmish', 'AI_Equations_Empire_Land', 'AI_Equations_Rebel_Land', 'AI_Equations_Underworld_Land', 'BudgetingEquations', 'HeroEquations'];
const SETS = ['BasicLandGoalSet', 'AI_GoalSet_ExpansionGeneric_Land', 'AI_GoalSet_Empire_Land', 'AI_GoalSet_Rebel_Land', 'AI_GoalSet_Underworld_Land'];

function tokens(src) {
  const out = [], re = /\s*(?:(\d+\.?\d*|\.\d+)|("[^"]*")|([A-Za-z_][A-Za-z_0-9.]*(?:\[[^\]]*\])?)|(>=|<=|==|!=|[-+*\/()<>{},=#]))/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1] !== undefined) out.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2].slice(1, -1) });
    else if (m[3] !== undefined) out.push({ t: 'id', v: m[3] });
    else out.push({ t: m[4] });
  }
  return out;
}

function parse(src) {
  const T = tokens(src);
  let i = 0;
  const peek = () => (T[i] ? T[i].t : ''), take = t => (peek() === t ? T[i++] : null);
  const bin = (next, ops) => () => { let a = next(); for (let op = peek(); ops.includes(op); op = peek()) { i++; a = [op, a, next()]; } return a; };
  const primary = () => {
    const k = T[i++];
    if (!k) return ['num', 0];
    if (k.t === 'num') return ['num', k.v];
    if (k.t === '(') { const e = expr(); take(')'); return e; }
    if (k.t === '-') return ['-', ['num', 0], unary()];
    if (k.t !== 'id') return ['num', 0];
    if (peek() === '(') {
      i++;
      const args = [];
      while (peek() && peek() !== ')') { args.push(expr()); take(','); }
      take(')');
      return ['call', k.v.toLowerCase(), args];
    }
    const params = [];
    if (take('{')) {
      while (peek() && peek() !== '}') {
        const name = T[i++], eq = take('='), val = eq ? T[i++] : null;
        if (name && val) params.push([name.v, String(val.v)]);
        take(',');
      }
      take('}');
    }
    return ['see', k.v, params];
  };
  const unary = () => (peek() === '-' ? (i++, ['-', ['num', 0], unary()]) : primary());
  const rnd = () => { const a = unary(); return take('#') ? ['#', a, unary()] : a; };
  const mul = bin(rnd, ['*', '/']), add = bin(mul, ['+', '-']), expr = bin(add, ['>', '>=', '<', '<=', '==', '!=']);
  return expr();
}

let PLAYERS = null;
export async function aiSets(faction) {
  PLAYERS ||= (async () => {
    const out = new Map();
    const files = await findFiles('XML\\\\AI\\\\PLAYERS\\\\[^\\\\]*\\.XML$').catch(() => []);
    for (const f of files) {
      const s = ((await fetchText('Data/XML/AI/Players/' + f.split('\\').pop()).catch(() => null)) || '').replace(/<!--[\s\S]*?-->/g, '');
      const name = /<Name>\s*([^<]*?)\s*<\/Name>/.exec(s), sets = /<GoalProposalFunctionSets>([^<]*)<\/GoalProposalFunctionSets>/.exec(s);
      const tag = k => { const m = new RegExp('<' + k + '>\\s*([^<]*?)\\s*</' + k + '>', 'i').exec(s); return m ? m[1] : ''; };
      const tpl = k => { const m = new RegExp('<Templates>[\\s\\S]*?<' + k + '>([^<]*)</' + k + '>', 'i').exec(s); return m ? m[1].split(/\s+/).filter(Boolean) : []; };
      const adj = k => { const m = new RegExp('<Difficulty_Adjustments>[\\s\\S]*?<' + k + '>([^<]*)</' + k + '>', 'i').exec(s); return m ? m[1].trim() : ''; };
      if (name) out.set(name[1].toUpperCase(), { name:name[1],sets: sets ? sets[1].split(/\s+/).filter(Boolean) : null, space: tag('SpaceFreeStoreScript'), land: tag('LandFreeStoreScript'), galactic:tag('GalacticFreeStoreScript'), templates: { land: tpl('Land'), space: tpl('Space'), galactic:tpl('Galactic') }, ext: parseInt(tag('GoalSetExtensionSize'), 10) || 0,
        adjust: { easy: adj('Easy'), normal: adj('Normal'), hard: adj('Hard') } });
    }
    return out;
  })();
  const f = db.faction(faction);
  const p = f && (await PLAYERS).get(f.str('Basic_AI').toUpperCase());
  return (p && p.sets) || null;
}

export async function aiPlayer(faction) {
  await aiSets(faction);
  const f = db.faction(faction);
  return (f && (await PLAYERS).get(f.str('Basic_AI').toUpperCase())) || null;
}

export async function aiPlayerType(name) {
  await aiSets(null);
  return (await PLAYERS).get(String(name||'').toUpperCase())||null;
}
export async function aiPlayerTypes(){await aiSets(null);return [...(await PLAYERS).values()];}

let ADJUST = null;
export async function difficultyAdjustment(faction, difficulty, playerType=null) {
  ADJUST ||= fetchText('Data/XML/DifficultyAdjustments.xml').then(s => {
    const out = new Map();
    for (const m of (s || '').replace(/<!--[\s\S]*?-->/g, '').matchAll(/<Difficulty_Adjustment\s+Name\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/Difficulty_Adjustment>/gi)) {
      const n = k => { const v = new RegExp('<' + k + '>\\s*([-\\d.]+)', 'i').exec(m[2]); return v ? +v[1] : 1; };
      out.set(m[1].toUpperCase(), { credit: n('Credit_Multiplier'), damage: n('Damage_Multiplier'), health: n('Health_Multiplier'), shield: n('Shield_Multiplier'), bribe: n('Bribe_Cost_Multiplier'), galacticSleep:n('Galactic_AI_Goal_Cycle_Sleep_Duration'),galacticContrast:n('Galactic_AI_Contrast_Multiplier'),
        build: { space: n('Space_Build_Time_Multiplier'), land: n('Land_Build_Time_Multiplier') } });
    }
    return out;
  }).catch(() => new Map());
  const lv = { easy: 'easy', medium: 'normal', normal: 'normal', hard: 'hard' }[String(difficulty || 'normal').toLowerCase()] || 'normal';
  const p = playerType||await aiPlayer(faction);
  if(playerType&&!p.adjust?.[lv])return null;
  return (await ADJUST).get(((p && p.adjust && p.adjust[lv]) || lv + '_Default').toUpperCase()) || null;
}

export async function aiFreeStore(faction) {
  await aiSets(faction);
  const f = db.faction(faction), p = f && (await PLAYERS).get(f.str('Basic_AI').toUpperCase());
  return { space: (p && p.space) || '', land: (p && p.land) || '' };
}

const dirFiles = async dir => (await findFiles('XML\\\\AI\\\\' + dir + '\\\\[^\\\\]*\\.XML$').catch(() => [])).map(f => f.split('\\').pop().replace(/\.XML$/i, ''));

export async function readBrain(FILES, SETS, GOALS = null, shared = null) {
  if(shared)return Object.assign(Object.create(shared),{fnOf:await readGoalFunctions(SETS)});
  const get = f => fetchText('Data/XML/AI/' + f).catch(() => null);
  const first = new Set(FILES.map(f => f.toUpperCase()));
  FILES = FILES.concat((await dirFiles('PERCEPTUALEQUATIONS')).filter(f => !first.has(f.toUpperCase())).sort());
  GOALS ||= await dirFiles('GOALS');
  const strip = s => (s || '').replace(/<!--[\s\S]*?-->/g, '');
  const eq = new Map(), fnOf = new Map(), goals = new Map(), defs = new Map(), templates = new Map();
  for (const f of FILES) {
    const s = strip(await get('PerceptualEquations/' + f + '.xml')).replace(/<\/?Equations>/g, '');
    for (const m of s.matchAll(/<([A-Za-z_0-9]+)>/g)) {
      const end = s.indexOf('</' + m[1] + '>', m.index);
      if (end > 0 && !eq.has(m[1].toUpperCase()) && !/^[<\s]*$/.test(s.slice(m.index + m[0].length, end))) { try { eq.set(m[1].toUpperCase(), parse(s.slice(m.index + m[0].length, end))); } catch { } }
    }
  }
  for(const [goal,fns]of await readGoalFunctions(SETS))fnOf.set(goal,fns);
  for (const f of GOALS) {
    const lg = strip(await get('Goals/' + f + '.xml'));
    for (const m of lg.matchAll(/<([A-Za-z_0-9]+)>\s*<AIGoalApplicationFlags>\s*([^<]*?)\s*<\/AIGoalApplicationFlags>/g)) {
      const name = m[1].toUpperCase(), flags = m[2].split('|').map(x => x.trim().toUpperCase());
      goals.set(name, flags);
      const end = lg.indexOf('</' + m[1] + '>', m.index), body = end > 0 ? lg.slice(m.index, end) : '';
      const one = k => { const x = new RegExp('<' + k + '>\\s*([^<]*?)\\s*</' + k + '>', 'i').exec(body); return x ? x[1] : ''; };
      const all = k => [...body.matchAll(new RegExp('<' + k + '>\\s*([^<]*?)\\s*</' + k + '>', 'gi'))].flatMap(x => x[1].split(/[\s,|]+/)).map(x => x.trim().toUpperCase()).filter(Boolean);
      if (!defs.has(name)) defs.set(name, {
        name, flags, bits: flags.reduce((a, f) => a | (GOAL_BITS[f] || 0), 0), mode: one('GameMode').toUpperCase(), category: one('Category').toUpperCase(), reach: one('Reachability').toUpperCase(),
        like: all('Is_Like'), exclusions: all('Global_Exclusions'), perFailure: parseFloat(one('Per_Failure_Desire_Adjust')) || 0, perStartFailure: parseFloat(one('Per_Activation_Failure_Desire_Adjust')) || 0,
        track: parseFloat(one('Tracking_Duration')) || 0, startTrack: parseFloat(one('Activation_Tracking_Duration')) || 0,
        timeLimit:one('Time_Limit')===''?-1:parseFloat(one('Time_Limit')),buildDelay:one('Build_Time_Delay_Tolerance')===''?2:parseFloat(one('Build_Time_Delay_Tolerance')),
      });
    }
  }
  for (const f of await dirFiles('TEMPLATES')) {
    const s = strip(await get('Templates/' + f + '.xml'));
    for (const m of s.matchAll(/<([A-Za-z_0-9]+)>\s*<Priority>/g)) {
      const end = s.indexOf('</' + m[1] + '>', m.index), body = end > 0 ? s.slice(m.index, end) : '';
      const one = k => { const x = new RegExp('<' + k + '>\\s*([^<]*?)\\s*</' + k + '>', 'i').exec(body); return x ? x[1] : ''; };
      const part = k => { const x = new RegExp('<' + k + '>([\\s\\S]*?)</' + k + '>', 'i').exec(body); return x ? x[1] : ''; };
      const sw = k => { const b = part(k), goalsOf = (/<Goals>([\s\S]*?)<\/Goals>/i.exec(b) || ['', ''])[1], list = t => [...goalsOf.matchAll(new RegExp('<' + t + '>\\s*([^<]*?)\\s*</' + t + '>', 'gi'))].map(x => x[1].toUpperCase()); const plansOf=(/<Plans>([\s\S]*?)<\/Plans>/i.exec(b)||['',''])[1], plans=t=>[...plansOf.matchAll(new RegExp('<'+t+'>\\s*([^<]*?)\\s*</'+t+'>','gi'))].map(x=>x[1].toUpperCase());return { cats: list('Category'), goals: list('Goal_Type'),plans:{names:plans('Name'),goals:plans('Goal_Type'),cats:plans('Goal_Category')} }; };
      const budget = [...part('Budget').matchAll(/<([A-Za-z_0-9]+)>\s*([^<]*?)\s*<\/\1>/g)].map(x => [x[1].toUpperCase(), x[2].toUpperCase()]);
      const tactical = [...part('Tactical_Budget_Allowance').matchAll(/<([A-Za-z_0-9]+)>\s*([^<]*?)\s*<\/\1>/g)].map(x => [x[1].toUpperCase(), parseFloat(x[2]) || 0]);
      if (!templates.has(m[1].toUpperCase())) templates.set(m[1].toUpperCase(), { name: m[1], priority: parseFloat(one('Priority')) || 0, trigger: one('Trigger').toUpperCase(), untrigger: one('Un_Trigger').toUpperCase(), on: sw('Turn_On'), off: sw('Turn_Off'), budget, tactical });
    }
  }
  return { eq, fnOf, goals, defs, templates };
}

async function readGoalFunctions(sets){
  const out=new Map();
  for(const file of sets){
    const source=((await fetchText('Data/XML/AI/GoalFunctions/'+file+'.xml').catch(()=>null))||'').replace(/<!--[\s\S]*?-->/g,'');
    for(const m of source.matchAll(/<Goal>\s*([^<\s]+)\s*<\/Goal>\s*<Function>\s*([^<\s]+)\s*<\/Function>/g)){
      const name=m[1].toUpperCase();if(!out.has(name))out.set(name,[]);out.get(name).push(m[2].toUpperCase());
    }
  }
  return out;
}

const GOAL_BITS = { FRIENDLY: 1, ENEMY: 2, NEUTRAL: 4, CONTESTED: 8, GLOBAL: 0x10, FRIENDLY_UNIT: 0x20, ENEMY_UNIT: 0x40, FRIENDLY_STRUCTURE: 0x80, ENEMY_STRUCTURE: 0x100, TACTICAL_LOCATION: 0x200,
  FRIENDLY_BUILD_PAD: 0x400, ENEMY_BUILD_PAD: 0x800, FRIENDLY_CASH_POINT: 0x1000, ENEMY_CASH_POINT: 0x2000, FRIENDLY_REINFORCEMENT_POINT: 0x4000, ENEMY_REINFORCEMENT_POINT: 0x8000 };

const BRAINS = new Map();
export async function loadBrain(faction = null) {
  const sets = (faction && await aiSets(faction)) || SETS, key = sets.join(' ');
  if (!BRAINS.has(key)) BRAINS.set(key, readBrain(FILES, sets));
  const brain = await BRAINS.get(key), p = faction ? await aiPlayer(faction) : null;
  return Object.assign(Object.create(brain), { player: p ? { land: p.templates.land, ext: p.ext } : null, sleep: 1 });
}

const power = u => (u.aiPower ??= Math.max(0, u.type.num('AI_Combat_Power', 0)));
const CELL20 = 20;
const cats = u => (u.catList ??= u.type.str('CategoryMask').toUpperCase().split(/[\s|,]+/).filter(Boolean));
const inCats = (u, want) => !want || want.some(c => cats(u).includes(c) || (c === 'HERO' && cats(u).some(x => /HERO/.test(x))));
export const catParam = params => { const p = params.filter(([k]) => /Parameter_Category/i.test(k)).flatMap(([, v]) => (v.match(/\[([^\]]*)\]/) || ['', v])[1].split('|').map(x => x.trim().toUpperCase())).filter(Boolean); return p.length ? p : null; };
export const typeParam = params => params.filter(([k]) => /Parameter_Type/i.test(k)).map(([, v]) => v.toUpperCase());

export class Reason {
  constructor(brain) { this.b = brain; this.memo = new Map(); }
  see() { return 0; }

  run(e, t) {
    switch (e[0]) {
      case 'num': return e[1];
      case '+': return this.run(e[1], t) + this.run(e[2], t);
      case '-': return this.run(e[1], t) - this.run(e[2], t);
      case '*': { const a = this.run(e[1], t); return a === 0 ? 0 : a * this.run(e[2], t); }
      case '/': { const d = this.run(e[2], t); return d === 0 ? 0 : this.run(e[1], t) / d; }
      case '>': return this.run(e[1], t) > this.run(e[2], t) ? 1 : 0;
      case '>=': return this.run(e[1], t) >= this.run(e[2], t) ? 1 : 0;
      case '<': return this.run(e[1], t) < this.run(e[2], t) ? 1 : 0;
      case '<=': return this.run(e[1], t) <= this.run(e[2], t) ? 1 : 0;
      case '==': return this.run(e[1], t) === this.run(e[2], t) ? 1 : 0;
      case '!=': return this.run(e[1], t) !== this.run(e[2], t) ? 1 : 0;
      case '#': { const a = this.run(e[1], t), b = this.run(e[2], t); return a + simRandom() * (b - a); }
      case 'call': { const a = e[2].map(x => this.run(x, t)); return e[1] === 'clamp' ? Math.min(a[2], Math.max(a[1], a[0])) : e[1] === 'max' ? Math.max(...a) : e[1] === 'min' ? Math.min(...a) : 0; }
      case 'see': {
        const m = /^Function_(.+)\.Evaluate$/i.exec(e[1]);
        return m ? this.fn(m[1].toUpperCase(), t) : this.see(e[1], e[2], t);
      }
      default: return 0;
    }
  }

  fn(name, t) {
    if (name === 'ZERO') return 0;
    if (name === 'ONE') return 1;
    if (name === 'REALLYBIG'&&!this.b.eq.has(name)) return 1000;
    const e = this.b.eq.get(name);
    if (!e) return 0;
    const key = name + '|' + (t ? t.key : '');
    if (this.memo.has(key)) return this.memo.get(key);
    this.memo.set(key, 0);
    const v = this.run(e, t);
    this.memo.set(key, Number.isFinite(v) ? v : 0);
    return this.memo.get(key);
  }

  desire(goal, t = null) {
    const fns = this.b.fnOf.get(goal.toUpperCase());
    return fns ? Math.max(...fns.map(f => this.fn(f, t))) : 0;
  }
}

export class Mind extends Reason {
  constructor(brain, world, side, { difficulty = 'Normal', seen = null, sees = null } = {}) {
    super(brain);
    this.w = world; this.side = side; this.difficulty = /^medium$/i.test(String(difficulty)) ? 'Normal' : difficulty; this.seen = seen; this.sees = sees;
    const w = world;
    this.friends = w.units.filter(u => !u.dead && u.side >= 0 && w.ally(u.side, side) && !u.bomber);
    this.foes = w.units.filter(u => !u.dead && u.side >= 0 && !w.ally(u.side, side) && !u.bomber && !u.inside);
    const weigh = (u, att) => power(u) * (att ? 1 - (1 - Math.max(0, Math.min(1, u.health / (u.maxHealth || 1)))) * att : 1);
    this.weigh = weigh;
    const sum = (list, c, att = 0) => list.reduce((n, u) => n + (inCats(u, c) ? weigh(u, att) : 0), 0);
    this.sum = sum;
    this.total = Math.max(0, sum(this.friends) + sum(this.foes));
    this.faction = (w.factions[side] || '').toUpperCase();
    this.owned = new Set(w.teamSides(side).flatMap(s => [...w.owned[s]]).map(n => n.toUpperCase()));
    const c = db.constants;
    this.cell = Math.max(20, c.num('DesiredLandFOWCellSize', 15) * Math.max(1, c.num('AI_FogCellsPerThreatCell', 4)));
    this.gn = Math.max(1, Math.ceil((w.n - 1) * CELL20 / this.cell));
    this.areaScale = c.num('AI_LandAreaThreatScaleFactor', 1) || 1;
    this.grids = new Map();
    if (!w.zoneAt) {
      w.zoneAt = new Map();
      for (const z of w.map.zones || []) for (const k of z.cells) if (!w.zoneAt.has(k)) w.zoneAt.set(k, z);
    }
  }

  norm(v, by = this.total) { return v <= 0 ? 0 : v > by ? 1 : v / by; }

  zoneOf(x, y) { return this.w.zoneAt.get((Math.round(x / CELL20) & 0xffff) | (Math.round(y / CELL20) << 16)) || null; }

  zone(t) { return t.zone || (t.inZone !== undefined ? t.inZone : (t.inZone = this.zoneOf(t.x, t.y))); }

  cellsOf(z) {
    if (z.pc && z.pcSize === this.cell) return z.pc;
    const set = new Set(), k = CELL20 / this.cell, gn = this.gn;
    for (const key of z.cells) { const gx = Math.min(gn - 1, Math.floor((key & 0xffff) * k)), gy = Math.min(gn - 1, Math.floor((key >>> 16) * k)); set.add(gy * gn + gx); }
    z.pcSize = this.cell;
    return (z.pc = Int32Array.from(set));
  }

  grid(foe, kind, cats, att) {
    const key = (foe ? 'e' : 'f') + kind + (cats ? cats.join('|') : '') + '@' + att;
    let g = this.grids.get(key);
    if (g) return g;
    const gn = this.gn, cell = this.cell, least = cell * Math.SQRT2 / 2, cap = db.constants.num('AI_LandThreatRangeCap', 0);
    g = new Float32Array(gn * gn);
    for (const u of foe ? this.foes : this.friends) {
      if (!inCats(u, cats)) continue;
      const v = this.weigh(u, att);
      if (!(v > 0)) continue;
      if (kind === 'stand') { g[Math.max(0, Math.min(gn - 1, Math.round(u.y / cell - 0.5))) * gn + Math.max(0, Math.min(gn - 1, Math.round(u.x / cell - 0.5)))] += v; continue; }
      let R = Math.max(least, u.range || 0);
      if (cap > 0) R = Math.min(R, Math.max(least, cap));
      const x0 = Math.max(0, Math.floor((u.x - R) / cell)), x1 = Math.min(gn - 1, Math.floor((u.x + R) / cell)), y0 = Math.max(0, Math.floor((u.y - R) / cell)), y1 = Math.min(gn - 1, Math.floor((u.y + R) / cell));
      const each = v / (4 * R * R) * cell * cell;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * gn + x] += each;
    }
    this.grids.set(key, g);
    return g;
  }

  at(t, foe, kind, cats, att) {
    const z = this.zone(t);
    if (!z) return 0;
    const g = this.grid(foe, kind, cats, att);
    let n = 0;
    for (const i of this.cellsOf(z)) n += g[i];
    if (t.unit && kind === 'stand' && foe !== this.w.ally(t.unit.side, this.side) && inCats(t.unit, cats)) n = Math.max(0, n - this.weigh(t.unit, att));
    return kind === 'force' ? n * this.areaScale : n;
  }

  route(a, b) {
    if (!a || !b) return -1;
    if (a === b) return 0;
    const zs = this.w.map.zones || [];
    let R = this.routes;
    if (!R) {
      const n = zs.length, D = new Float64Array(n * n).fill(Infinity);
      const idx = new Map(zs.map((z, i) => [z, i]));
      const hi = zs.map(z => Math.floor(Math.max(0, this.at(z.target || { zone: z, x: z.x, y: z.y }, true, 'force', null, 0)) / 100) || 1);
      for (let i = 0; i < n; i++) {
        D[i * n + i] = 0;
        for (const l of zs[i].links || []) {
          const j = l.to;
          if (j === undefined || j === i || !zs[j]) continue;
          const v = hi[j] * 65536 + (Math.floor(Math.hypot(zs[j].x - zs[i].x, zs[j].y - zs[i].y) / 10) & 0xffff);
          if (v < D[i * n + j]) D[i * n + j] = v;
        }
      }
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
        const ik = D[i * n + k];
        if (ik === Infinity) continue;
        for (let j = 0; j < n; j++) { const v = ik + D[k * n + j]; if (v < D[i * n + j]) D[i * n + j] = v; }
      }
      R = this.routes = { D, n, idx };
    }
    const i = R.idx.get(a), j = R.idx.get(b);
    if (i === undefined || j === undefined) return -1;
    const v = R.D[i * R.n + j];
    return v === Infinity ? -1 : v;
  }

  ownStart(t) {
    const w = this.w, L = 2 * (w.n - 1) * CELL20 * Math.SQRT2;
    const marks = (w.startMarks ||= (() => { const m = new Map(); for (const o of w.map.objects || []) { const r = /^TEAM_(\d\d)_BASE_POSITION_MARKER$/i.exec(o.type.name); if (r) { const k = +r[1]; if (!m.has(k)) m.set(k, []); m.get(k).push({ x: o.pos[0], y: o.pos[1] }); } } return m; })());
    let at = marks.get(w.team[this.side]);
    if (!at || !at.length) at = this.friends.filter(x => x.isBase);
    let best = 0;
    for (const x of at) best = Math.max(best, 1 - Math.hypot(x.x - t.x, x.y - t.y) / L);
    return best;
  }

  nearest(list, t, c, types) {
    let d = 1e18;
    const r0 = t.unit ? t.unit.hitRadius || 0 : 0;
    for (const u of list) {
      if (u === t.unit || !inCats(u, c) || (types && types.length && !types.includes(u.type.name.toUpperCase()))) continue;
      const v = Math.hypot(u.x - t.x, u.y - t.y) - r0 - (u.hitRadius || 0);
      if (v < d) d = v;
    }
    return d;
  }

  see(name, params, t) {
    const w = this.w, side = this.side, c = catParam(params), types = typeParam(params);
    const [who, ...rest] = name.split('.');
    const what = rest.join('.').toUpperCase().replace(/^LOCATION\./, '');
    const att = parseFloat((params.find(([k]) => /Attenuator/i.test(k)) || [0, 0])[1]) || 0;
    if (/^Script_/i.test(who) && w.scriptHost && w.sidePlayers) {
      const args = params.filter(([k]) => /Script_/i.test(k)).map(([k, v]) => (/Number|Float/i.test(k) ? +v : String(v).replace(/^"|"$/g, '')));
      const key = who + '|' + args.join(',') + '|' + (t ? t.key : '');
      let v = (this.asked ||= new Map()).get(key);
      if (v === undefined) { v = w.scriptHost.evaluate(who.slice(7), w.sidePlayers[side], t, args); if (v !== undefined) this.asked.set(key, v); }
      return v === undefined ? 0 : v;
    }
    if (who === 'Game') {
      if (what === 'AGE') return w.time;
      if (what === 'FORCEVISIBILITY') {
        let n = 0, seen = 0;
        const one = u => { if (u.side === this.side || !inCats(u, c)) return; n++; if (!this.sees || this.sees(u.x, u.y)) seen++; };
        for (const u of this.foes) one(u);
        for (const u of this.friends) one(u);
        return n ? seen / n : 0;
      }
      if (what === 'FORCEUNNORMALIZED') return this.total;
      if (what === 'ISCAMPAIGNGAME') return w.campaign ? 1 : 0;
      return 0;
    }
    if (who === 'Variable_Self' || who === 'Variable_Enemy') {
      const self = who === 'Variable_Self', own = self ? this.friends : this.foes, other = self ? this.foes : this.friends;
      switch (what) {
        case 'FRIENDLYFORCEUNNORMALIZED': case 'FORCEUNNORMALIZED': case 'LANDEDFORCEUNNORMALIZED': return this.sum(own, c, att);
        case 'FRIENDLYFORCE': case 'FORCE': return this.norm(this.sum(own, c, att));
        case 'ENEMYFORCEUNNORMALIZED': return this.sum(other, c, att);
        case 'ENEMYFORCE': return this.norm(this.sum(other, c, att));
        case 'FORCENBTD': return this.norm(this.sum(own, c, att), this.sum(own, null, 0));
        case 'REINFORCEMENTSUNNORMALIZED': return self ? (w.ready[side] || []).reduce((n, ty) => n + ty.list('Company_Units').reduce((m, x) => m + (db.type(x) ? db.type(x).num('AI_Combat_Power', 30) : 0), 0), 0) : 0;
        case 'TACTICALBUILTSTRUCTURECOUNT': return own.filter(u => u.structure && (!types.length || types.includes(u.type.name.toUpperCase()))).length;
        case 'HASUNIT': return own.some(u => types.includes(u.type.name.toUpperCase())) || types.some(n => this.owned.has(n)) || (types.includes('REINFORCEMENT_POINT') && w.points.some(p => p.reinforce && p.side >= 0 && w.ally(p.side, side))) ? 1 : 0;
        case 'ISFACTION': return params.some(([k, v]) => /Faction/i.test(k) && v.toUpperCase() === this.faction) ? 1 : 0;
        case 'ISDIFFICULTY': return params.some(([, v]) => new RegExp('\\[' + this.difficulty + '\\]', 'i').test(v)) ? 1 : 0;
        case 'UNITSPACEAVAILABLE': return Math.max(0, w.popCap(side) - w.popUsed(side));
        case 'BASELEVEL': return 1 + [...this.owned].filter(n => /LEVEL_\w+_TECH/.test(n)).length;
        case 'OPENBUILDPADCOUNT': return w.sites.filter(s => !s.structure && !s.building && w.siteOptions(s, side).length).length;
        case 'CREDITSUNNORMALIZED': return w.credits[side];
        case 'ISBOMBINGRUNAVAILABLE': return [...this.owned].some(n => /BOMBING_RUN/.test(n)) && !w.bombing.some(b => b.side === side) ? 1 : 0;
        case 'ISORBITALBOMBARDMENTAVAILABLE': { const r = w.bombard && w.bombard[side]; return r && r.present && !r.run && w.time >= r.readyAt ? 1 : 0; }
        case 'ISDEFENDER': { if (w.defenderSide === undefined) return 0; const mine = w.ally(side, w.defenderSide); return (self ? mine : !mine) ? 1 : 0; }
        case 'CANRETREAT': return self && w.retreat && w.retreat.canRetreat(side) === 0 ? 1 : 0;
        case 'ISRETREATING': { const r = w.retreat?.active; return r && (w.ally(r.player, side) === self) ? 1 : 0; }
        default: return 0;
      }
    }
    if (who === 'Variable_Target' && t) {
      const u = t.unit;
      if (what.startsWith('HINTS.')) { const z = this.zone(t), k = what.slice(6), props = z && z.props; if (!props) return 0; for (const n in props) if (n.toUpperCase() === k) return props[n]; return 0; }
      switch (what) {
        case 'TYPE.ISTYPE': return t.type && types.includes(t.type.name.toUpperCase()) ? 1 : 0;
        case 'OWNER.ISFACTION': { const f = t.owner >= 0 && t.owner < w.factions.length ? w.factions[t.owner].toUpperCase() : ''; return params.some(([k, v]) => /Faction/i.test(k) && v.toUpperCase() === f) ? 1 : 0; }
        case 'HASBUILTOBJECT': return t.site && (t.site.structure || t.site.building) ? 1 : 0;
        case 'ISCONTESTABLE': return t.point ? 1 : 0;
        case 'ISINSIDEFRIENDLYSHIELD': case 'ISINSIDEENEMYSHIELD': {
          const mine = what === 'ISINSIDEFRIENDLYSHIELD';
          for (const s of w.units) if (s.dome && s.dome.on && !s.dead && s.side >= 0 && w.ally(s.side, side) === mine && (s.x - t.x) ** 2 + (s.y - t.y) ** 2 < s.dome.r * s.dome.r) return 1;
          return 0;
        }
        case 'ISBUILDPAD': return t.site && !t.unit && String(t.key).startsWith('s') ? 1 : 0;
        case 'CONTAINSHERO': {
          if (!u) return 0;
          const is = x => !x.dead && (types.length ? types.includes(x.type.name.toUpperCase()) : cats(x).some(k => /HERO/.test(k)));
          const all = [u, ...(u.squad ? u.squad.members : []), ...(u.holds || []).flatMap(q => q.members.filter(m => m.inside === u))];
          return all.some(is) ? 1 : 0;
        }
        case 'ENEMYFORCEUNNORMALIZED': return this.at(t, true, 'force', c, att);
        case 'FRIENDLYFORCEUNNORMALIZED': return this.at(t, false, 'force', c, att);
        case 'ENEMYFORCE': return this.norm(this.at(t, true, 'force', c, att));
        case 'FRIENDLYFORCE': return this.norm(this.at(t, false, 'force', c, att));
        case 'ENEMYFORCENBTD': return this.norm(this.at(t, true, 'force', c, att), this.sum(this.foes, null, 0));
        case 'FRIENDLYFORCENBTD': return this.norm(this.at(t, false, 'force', c, att), this.sum(this.friends, null, 0));
        case 'ENEMYUNITCONCENTRATIONUNNORMALIZED': return this.at(t, true, 'stand', c, 0);
        case 'FRIENDLYUNITCONCENTRATIONUNNORMALIZED': return this.at(t, false, 'stand', c, 0);
        case 'ENEMYUNITCONCENTRATION': return this.norm(this.at(t, true, 'stand', c, 0));
        case 'FRIENDLYUNITCONCENTRATION': return this.norm(this.at(t, false, 'stand', c, 0));
        case 'ENEMYUNITCONCENTRATIONNBTD': return this.norm(this.at(t, true, 'stand', c, 0), this.sum(this.foes, null, 0));
        case 'FRIENDLYUNITCONCENTRATIONNBTD': return this.norm(this.at(t, false, 'stand', c, 0), this.sum(this.friends, null, 0));
        case 'DISTANCETONEARESTFRIENDLY': return this.nearest(this.friends, t, c, types);
        case 'DISTANCETONEARESTENEMY': return this.nearest(this.foes, t, c, types);
        case 'TIMELASTSEENUNNORMALIZED': return this.seen ? this.seen(t) : 0;
        case 'TIMELASTSEEN': return w.time > 0 ? Math.min(1, (this.seen ? this.seen(t) : 0) / w.time) : 0;
        case 'ADDITIONALPOPULATIONCAPACITY': return t.point && t.point.type ? t.point.type.num('Additional_Population_Capacity', 0) : 0;
        case 'HEALTH': return u ? u.health / u.maxHealth : 1;
        case 'SHIELD': return u && u.maxShield > 0 ? u.shield / u.maxShield : 0;
        case 'FORCEUNNORMALIZED': return u && inCats(u, c) ? this.weigh(u, att) : 0;
        case 'FORCE': return u && inCats(u, c) ? this.norm(this.weigh(u, att)) : 0;
        case 'FORCENBTD': return u && inCats(u, c) ? this.norm(this.weigh(u, att), this.sum(w.ally(u.side, side) ? this.friends : this.foes, null, 0)) : 0;
        case 'HASTAKENDAMAGE': { const secs = parseFloat((params.find(([k]) => /Time/i.test(k)) || [0, 5])[1]) || 5; return u && u.lastHit !== undefined && w.time - u.lastHit <= secs ? 1 : 0; }
        case 'GARRISONSLOTSAVAILABLE': return u && u.slots ? Math.max(0, u.slots - (u.holds || []).reduce((n, q) => n + q.members.filter(m => m.inside === u).length, 0)) : 0;
        case 'ISENEMYSTARTLOCATION': return 1 - this.ownStart(t);
        case 'ISFRIENDLYSTARTLOCATION': return this.ownStart(t);
        case 'ISVALIDBOMBINGTARGET': return !w.units.some(x => x.structure && !x.dead && !w.ally(x.side, side) && x.noBomb > 0 && Math.hypot(x.x - t.x, x.y - t.y) <= x.noBomb) ? 1 : 0;
        default: return 0;
      }
    }
    return 0;
  }
}

export const target = {
  unit: u => ({ key: 'u' + (u.uid ??= ++UID), unit: u, x: u.x, y: u.y, type: u.type, owner: u.side, site: u.site || null, point: u.capturable || null }),
  site: (s, type) => ({ key: 's' + (s.uid ??= ++UID), site: s, x: s.x, y: s.y, type: type || s.pad, owner: s.base ? s.side : s.point ? s.point.side : -1, point: s.point || null }),
  point: p => ({ key: 'p' + (p.uid ??= ++UID), point: p, x: p.x, y: p.y, type: p.type, owner: p.side, site: p.site || null }),
  place: (x, y) => ({ key: 'l' + Math.round(x / 60) + ',' + Math.round(y / 60), x, y, type: null, owner: -1 }),
  zone: z => ({ key: 'z' + z.index, zone: z, x: z.x, y: z.y, type: null, owner: -1 }),
};
let UID = 0;
export function resetBrainIds() { UID = 0; }

export function buildGoal(uc) {
  const n = uc.name.toUpperCase();
  if (/COMMAND_CENTER|PALACE/.test(n)) return 'Tactical_Multiplayer_Build_Command_Center';
  if (/BARRACKS|MERC_OUTPOST/.test(n)) return 'Tactical_Multiplayer_Build_Barracks';
  if (/MINERAL_PROCESSOR|MINING/.test(n)) return 'Build_Econ_Structure';
  if (/ANTI_VEHICLE|TURBOLASER/.test(n)) return 'Build_AntiVehicle_Turret';
  if (/ANTI_AIR/.test(n)) return 'Build_AntiAir_Turret';
  if (/ANTI_INFANTRY/.test(n)) return 'Build_AntiInfantry_Turret';
  if (/BACTA/.test(n)) return 'Build_Bacta_Tank';
  if (/MDU_REPAIR/.test(n)) return 'Build_MDU_Repair_Facility';
  if (/REPAIR/.test(n)) return 'Build_Repair_Bay';
  if (/BUNKER/.test(n)) return 'Build_Bunker';
  if (/EM_FIELD/.test(n)) return 'Build_EM_Field_Generator';
  if (/GRENADE_MORTAR/.test(n)) return 'Build_Grenade_Mortar';
  if (/OFFENSIVE_SENSOR/.test(n)) return 'Build_Offensive_Sensor_Node';
  if (/MOBILE_SHIELD/.test(n)) return 'Build_Mobile_Shield_Generator';
  if (/RAPID_FIRE/.test(n)) return 'Build_Rapid_Fire_Laser';
  return 'Tactical_Multiplayer_Build_Basic_Structure';
}
