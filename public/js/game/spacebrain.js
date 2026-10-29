import { db } from '../gamedata.js';
import { readBrain, aiSets, aiPlayer, Reason, catParam, typeParam } from './landbrain.js';

const FILES = ['OffensiveSpaceEquations', 'AI_Equations_Underworld_Space', 'AI_Equations_ExpansionGeneric_LandSkirmish', 'BasicGalacticEquations', 'BudgetingEquations', 'HeroEquations'];
const SETS = ['BasicOffensiveSpaceSet', 'AI_GoalSet_Underworld_Space'];
const LEVELS = { easy: 'Easy', medium: 'Normal', hard: 'Hard' };

const BRAINS = new Map();
export async function loadSpaceBrain(faction = null) {
  const sets = (faction && await aiSets(faction)) || SETS, key = sets.join(' ');
  if (!BRAINS.has(key)) BRAINS.set(key, readBrain(FILES, sets));
  const brain = await BRAINS.get(key), p = faction ? await aiPlayer(faction) : null;
  return Object.assign(Object.create(brain), { player: p ? { space: p.templates.space, land: p.templates.land, ext: p.ext } : null, sleep: 1 });
}

const power = u => (u.aiPower ??= Math.max(0, u.type.num('AI_Combat_Power', 0)));
const cats = u => u.type.categories();
const inCats = (u, want) => !want || want.some(c => cats(u).has(c) || (c === 'HERO' && cats(u).has('SPACEHERO')) || (c === 'STRUCTURE' && u.isStructure));
const fits = (u, c, types) => inCats(u, c) && (!types.length || types.includes(u.type.name.toUpperCase()));

export class SpaceMind extends Reason {
  constructor(brain, world, player, { enemies, seen = null, enemyStart = null } = {}) {
    super(brain);
    this.w = world; this.p = player; this.seen = seen; this.enemyStart = enemyStart;
    const counted = u => !u.dead && u.player.id >= 0 && !u.isPad && !u.hyper && u !== u.player.team.firstStation;
    this.friends = world.units.filter(u => counted(u) && u.player.team === player.team);
    this.foes = world.units.filter(u => counted(u) && u.player.team !== player.team);
    this.total = this.sum(this.friends, null, [], 0) + this.sum(this.foes, null, [], 0);
    const c = db.constants;
    this.cell = Math.max(50, c.num('DesiredSpaceFOWCellSize', 100) * Math.max(1, c.num('AI_FogCellsPerThreatCell', 4)));
    this.gx = Math.max(1, Math.ceil((world.max.x - world.min.x) / this.cell)); this.gy = Math.max(1, Math.ceil((world.max.y - world.min.y) / this.cell));
    this.areaScale = c.num('AI_SpaceAreaThreatScaleFactor', 1) || 1;
    this.grids = new Map();
    const st = player.station, foe = world.teams.find(t => t !== player.team && t.station && !t.station.dead);
    this.level = st && !st.dead && st !== player.team.firstStation ? st.type.num('Base_Level', 1) : 0;
    this.theirLevel = foe && foe.station !== foe.firstStation ? foe.station.type.num('Base_Level', 1) : 0;
  }

  weigh(u, att) { return power(u) * (att ? 1 - (1 - Math.max(0, Math.min(1, u.healthFrac ?? 1))) * att : 1); }
  sum(list, c, types = [], att = 0) { let n = 0; for (const u of list) if (fits(u, c, types)) n += this.weigh(u, att); return n; }
  norm(v, by = this.total) { return v <= 0 ? 0 : v > by ? 1 : v / by; }
  nearest(list, t, c, types) {
    let d = 1e18;
    const r0 = t.unit ? t.unit.hitRadius || 0 : 0;
    for (const u of list) { if (u === t.unit || !fits(u, c, types)) continue; const v = Math.hypot(u.x - t.x, u.y - t.y) - r0 - (u.hitRadius || 0); if (v < d) d = v; }
    return d;
  }

  grid(foe, kind, cats, att) {
    const key = (foe ? 'e' : 'f') + kind + (cats ? cats.join('|') : '') + '@' + att;
    let g = this.grids.get(key);
    if (g) return g;
    const { gx, gy, cell } = this, w = this.w, least = cell * Math.SQRT2 / 2;
    g = new Float32Array(gx * gy);
    for (const u of foe ? this.foes : this.friends) {
      if (!inCats(u, cats)) continue;
      const v = this.weigh(u, att);
      if (!(v > 0)) continue;
      const ux = u.x - w.min.x, uy = u.y - w.min.y;
      if (kind === 'stand') { g[Math.max(0, Math.min(gy - 1, Math.round(uy / cell - 0.5))) * gx + Math.max(0, Math.min(gx - 1, Math.round(ux / cell - 0.5)))] += v; continue; }
      const R = Math.max(least, u.maxRange || (u.weapon && u.weapon.range) || 0);
      const x0 = Math.max(0, Math.floor((ux - R) / cell)), x1 = Math.min(gx - 1, Math.floor((ux + R) / cell)), y0 = Math.max(0, Math.floor((uy - R) / cell)), y1 = Math.min(gy - 1, Math.floor((uy + R) / cell));
      const each = v / (4 * R * R) * cell * cell;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * gx + x] += each;
    }
    this.grids.set(key, g);
    return g;
  }

  at(t, foe, kind, cats, att) {
    const w = this.w, cell = this.cell, R = t.unit ? Math.max(t.unit.maxRange || 0, (t.unit.weapon && t.unit.weapon.range) || 0, cell / 2) : 0;
    const r = t.rect || { x: t.x - R, y: t.y - R, w: 2 * R, h: 2 * R };
    const x0 = Math.max(0, Math.floor((r.x - w.min.x) / cell)), x1 = Math.min(this.gx - 1, Math.floor((r.x + r.w - w.min.x) / cell)), y0 = Math.max(0, Math.floor((r.y - w.min.y) / cell)), y1 = Math.min(this.gy - 1, Math.floor((r.y + r.h - w.min.y) / cell));
    const g = this.grid(foe, kind, cats, att);
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) n += g[y * this.gx + x];
    if (t.unit && kind === 'stand' && foe === (t.unit.player.team !== this.p.team) && inCats(t.unit, cats)) n = Math.max(0, n - this.weigh(t.unit, att));
    return kind === 'force' ? n * this.areaScale : n;
  }

  see(name, params, t) {
    const w = this.w, p = this.p, c = catParam(params), types = typeParam(params);
    const [who, ...rest] = name.split('.');
    const what = rest.join('.').toUpperCase().replace(/^LOCATION\./, '');
    const att = parseFloat((params.find(([k]) => /Attenuator/i.test(k)) || [0, 0])[1]) || 0;
    if (who === 'Game') {
      if (what === 'FORCEVISIBILITY') {
        let n = 0, seen = 0;
        const one = u => { if (!inCats(u, c)) return; n++; if (!w.fog || (u.seenBy & p.bit)) seen++; };
        for (const u of this.foes) one(u);
        for (const u of this.friends) if (u.player !== p) one(u);
        return n ? seen / n : 0;
      }
      if (what === 'ISCAMPAIGNGAME') return w.campaign ? 1 : 0;
      return what === 'AGE' ? w.time : what === 'FORCEUNNORMALIZED' ? this.total : 0;
    }
    if (/^Script_/i.test(who) && w.scripts) {
      const args = params.filter(([k]) => /Script_/i.test(k)).map(([k, v]) => (/Number|Float/i.test(k) ? +v : String(v).replace(/^"|"$/g, '')));
      const key = who + '|' + args.join(',') + '|' + (t ? t.key : '');
      let v = (this.asked ||= new Map()).get(key);
      if (v === undefined) { v = w.scripts.evaluate(who.slice(7), p, t, args); if (v !== undefined) this.asked.set(key, v); }
      if (v !== undefined) return v;
    }
    if (/^Script_GetDistanceToNearestSpaceField/i.test(who)) {
      if (!t) return 1e9;
      const kind = (params.find(([k]) => /Script_String/i.test(k)) || [0, ''])[1].toUpperCase();
      let d = 1e9;
      for (const f of w.fields) if (kind === 'ASTEROID' ? f.asteroid : kind === 'NEBULA' ? f.nebula : false) d = Math.min(d, Math.max(0, Math.hypot(f.x - t.x, f.y - t.y) - f.r));
      return d;
    }
    if (who === 'Variable_Self' || who === 'Variable_Enemy') {
      const self = who === 'Variable_Self', own = self ? this.friends : this.foes, other = self ? this.foes : this.friends;
      switch (what) {
        case 'FRIENDLYFORCEUNNORMALIZED': case 'FORCEUNNORMALIZED': return this.sum(own, c, [], att);
        case 'FRIENDLYFORCE': case 'FORCE': return this.norm(this.sum(own, c, [], att));
        case 'ENEMYFORCEUNNORMALIZED': return this.sum(other, c, [], att);
        case 'ENEMYFORCE': return this.norm(this.sum(other, c, [], att));
        case 'FORCENBTD': return this.norm(this.sum(own, c, [], att), this.sum(own, null, [], 0));
        case 'REINFORCEMENTSUNNORMALIZED': return self ? p.reinforcements.reduce((n, ty) => n + (ty.num('AI_Combat_Power', 0) || ty.list('Squadron_Units').reduce((m, x) => m + (db.type(x) ? db.type(x).num('AI_Combat_Power', 20) : 0), 0)), 0) : 0;
        case 'BASELEVEL': return self ? this.level : this.theirLevel;
        case 'TECHLEVEL': { if (self) return p.techLevel; const foe = w.players.find(x => x.id >= 0 && x.team !== p.team); return foe ? foe.techLevel : 0; }
        case 'UNITSPACEAVAILABLE': return self ? Math.max(0, p.popCap - p.pop) : 0;
        case 'CREDITSUNNORMALIZED': return self ? p.credits : 0;
        case 'ISFACTION': return self && params.some(([k, v]) => /Faction/i.test(k) && v.toUpperCase() === p.factionName.toUpperCase()) ? 1 : 0;
        case 'ISDIFFICULTY': return params.some(([, v]) => new RegExp('\\[' + (LEVELS[p.difficulty] || 'Normal') + '\\]', 'i').test(v)) ? 1 : 0;
        case 'HASUNIT': return types.length && own.some(u => types.includes(u.type.name.toUpperCase())) ? 1 : 0;
        case 'TACTICALBUILTSTRUCTURECOUNT': return own.filter(u => u.isStructure && !u.construction && (!types.length || types.includes(u.type.name.toUpperCase()))).length;
        case 'OPENBUILDPADCOUNT': return self ? w.units.filter(u => !u.dead && u.isPad && !u.padChild && u.padOwner === p && (!types.length || types.includes(u.type.name.toUpperCase()))).length : 0;
        case 'ISDEFENDER': { if (w.defenderTeam === undefined) return 0; const mine = p.team === w.teams[w.defenderTeam]; return (self ? mine : !mine) ? 1 : 0; }
        case 'CANRETREAT': return self && w.retreat && w.retreat.canRetreat(p) === 0 ? 1 : 0;
        case 'ISRETREATING': { const r = w.retreat?.active; return r && ((r.player.team === p.team) === self) ? 1 : 0; }
        default: return 0;
      }
    }
    if (who === 'Variable_Target' && t) {
      const u = t.unit;
      switch (what) {
        case 'TYPE.ISTYPE': return t.type && types.includes(t.type.name.toUpperCase()) ? 1 : 0;
        case 'ISCONTESTABLE': return u && u.capture ? 1 : 0;
        case 'HASBUILTOBJECT': return u && u.padChild ? 1 : 0;
        case 'ENEMYFORCEUNNORMALIZED': return this.at(t, true, 'force', c, att);
        case 'FRIENDLYFORCEUNNORMALIZED': return this.at(t, false, 'force', c, att);
        case 'ENEMYFORCE': return this.norm(this.at(t, true, 'force', c, att));
        case 'FRIENDLYFORCE': return this.norm(this.at(t, false, 'force', c, att));
        case 'ENEMYFORCENBTD': return this.norm(this.at(t, true, 'force', c, att), this.sum(this.foes, null, [], 0));
        case 'FRIENDLYFORCENBTD': return this.norm(this.at(t, false, 'force', c, att), this.sum(this.friends, null, [], 0));
        case 'ENEMYUNITCONCENTRATIONUNNORMALIZED': return this.at(t, true, 'stand', c, 0);
        case 'FRIENDLYUNITCONCENTRATIONUNNORMALIZED': return this.at(t, false, 'stand', c, 0);
        case 'ENEMYUNITCONCENTRATION': return this.norm(this.at(t, true, 'stand', c, 0));
        case 'FRIENDLYUNITCONCENTRATION': return this.norm(this.at(t, false, 'stand', c, 0));
        case 'ENEMYUNITCONCENTRATIONNBTD': return this.norm(this.at(t, true, 'stand', c, 0), this.sum(this.foes, null, [], 0));
        case 'FRIENDLYUNITCONCENTRATIONNBTD': return this.norm(this.at(t, false, 'stand', c, 0), this.sum(this.friends, null, [], 0));
        case 'FORCEUNNORMALIZED': return u && inCats(u, c) ? this.weigh(u, att) : 0;
        case 'FORCE': return u && inCats(u, c) ? this.norm(this.weigh(u, att)) : 0;
        case 'FORCENBTD': return u && inCats(u, c) ? this.norm(this.weigh(u, att), this.sum(u.player.team === p.team ? this.friends : this.foes, null, [], 0)) : 0;
        case 'ISBUILDPAD': return u && u.isPad ? 1 : 0;
        case 'DISTANCETONEARESTFRIENDLY': return this.nearest(this.friends, t, c, types);
        case 'DISTANCETONEARESTENEMY': return this.nearest(this.foes, t, c, types);
        case 'HEALTH': return u ? u.healthFrac : 1;
        case 'SHIELD': return u && u.maxShield > 0 ? u.shield / u.maxShield : 0;
        case 'CONTAINSHERO': return u && (cats(u).has('SPACEHERO') || cats(u).has('HERO')) ? 1 : 0;
        case 'HARDPOINTHEALTH': {
          const kind = 'HARD_POINT_' + ((params.find(([k]) => /Hard_Point_Type/i.test(k)) || [0, ''])[1].match(/\[([^\]]*)\]/) || ['', ''])[1].trim().toUpperCase();
          const hps = u ? u.hardpoints.filter(h => h.kind === kind) : [];
          return hps.length ? hps.filter(h => h.alive).length / hps.length : 0;
        }
        case 'AREENGINESONLINE': return u && u.isMobile && u.engineAlive() ? 1 : 0;
        case 'TIMELASTSEENUNNORMALIZED': return this.seen ? this.seen(t) : 0;
        case 'TIMELASTSEEN': return w.time > 0 ? Math.min(1, (this.seen ? this.seen(t) : 0) / w.time) : 0;
        case 'ISENEMYSTARTLOCATION': { if (!this.enemyStart) return 0; const L = 2 * Math.hypot(w.max.x - w.min.x, w.max.y - w.min.y) / 2; return Math.max(0, 1 - Math.hypot(this.enemyStart.x - t.x, this.enemyStart.y - t.y) / L); }
        case 'ISFRIENDLYSTARTLOCATION': { const st = p.station; if (!st) return 0; const L = 2 * Math.hypot(w.max.x - w.min.x, w.max.y - w.min.y) / 2; return Math.max(0, 1 - Math.hypot(st.x - t.x, st.y - t.y) / L); }
        default: return 0;
      }
    }
    return 0;
  }
}

export const target = {
  unit: u => ({ key: 'u' + u.id, unit: u, x: u.x, y: u.y, type: u.type }),
  place: (x, y, r) => ({ key: 'l' + Math.round(x) + ',' + Math.round(y), x, y, r, type: null, rect: { x: x - r, y: y - r, w: 2 * r, h: 2 * r } }),
  region: (i, x0, y0, w, h, size) => ({ key: 'r' + i, region: i, x: x0 + size / 2, y: y0 + size / 2, type: null, rect: { x: x0, y: y0, w, h } }),
};
