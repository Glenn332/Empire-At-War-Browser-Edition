import { buildCost, isUpgradeType, isSquadronType } from './sim.js';
import { orderMove, orderAttack, orderGuard } from './orders.js';
import { aiUseAbilities } from './abilities.js';
import { loadSpaceBrain, SpaceMind, target } from './spacebrain.js';
import { simRandom } from './simrandom.js';

const DIFFICULTY = {
  easy: { think: 3.0, income: 0.8, waveBase: 7000, waveGrowth: 1.25, plans: new Set(['pad', 'destroy', 'defend']) },
  medium: { think: 2.0, income: 1.0, waveBase: 5500, waveGrowth: 1.2, plans: new Set(['pad', 'destroy', 'defend', 'escort', 'sweep', 'bombing', 'scout', 'burn']) },
  hard: { think: 1.2, income: 1.35, waveBase: 4500, waveGrowth: 1.15, plans: new Set(['pad', 'destroy', 'defend', 'escort', 'sweep', 'bombing', 'scout', 'burn', 'flank', 'artillery']) },
};

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const dist = (a, b) => Math.sqrt(d2(a, b));
const alive = e => e && !e.dead && (!e.isSquad || e.fighters.length > 0);
const cats = e => (e.isSquad ? (e.fighters[0] ? e.fighters[0].type.categories() : new Set()) : e.type.categories());
const isFighter = e => e.isSquad && !e.isBomber;
const isBomber = e => e.isSquad && e.isBomber;
const isHeavy = e => !e.isSquad && (cats(e).has('FRIGATE') || cats(e).has('CAPITAL') || cats(e).has('SUPER'));
const isCapital = e => !e.isSquad && (cats(e).has('CAPITAL') || cats(e).has('SUPER') || cats(e).has('SPACEHERO'));
const isArtillery = e => !e.isSquad && /MARAUDER|BROADSIDE/i.test(e.type.name);
const isCorvette = e => !e.isSquad && cats(e).has('CORVETTE') && !isArtillery(e);
const idle = e => e.order.kind === 'idle' || !!e.order.fs || (!!e.fsKind && e.fsKind === e.order.kind);

export class SkirmishAI {
  constructor(world, player, difficulty = 'medium', brain = undefined) {
    this.world = world;
    this.player = player;
    this.cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium; this.difficulty = difficulty;
    this.timer = 2 + simRandom() * 2;
    this.waveSize = this.cfg.waveBase;
    this.lastCredits = player.credits;
    this.plans = [];
    const foe = world.teams.find(t => t !== player.team && t.station);
    this.enemyStart = foe ? { x: foe.station.x, y: foe.station.y } : { x: 0, y: 0 };
    this.brain = null;
    this.brainReady = brain !== undefined ? Promise.resolve((this.brain = brain)) : loadSpaceBrain(player.factionName).then(b => { this.brain = b; }).catch(() => {});
    const N = 5, sx = (world.max.x - world.min.x) / N, sy = (world.max.y - world.min.y) / N;
    this.places = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) this.places.push(target.place(world.min.x + (i + 0.5) * sx, world.min.y + (j + 0.5) * sy, Math.max(sx, sy) * 0.6));
    this.seenAt = new Map();
    this.buyAt = 0; this.cashAt = -1e9;
  }

  think() {
    const w = this.world, enemies = this.known(), mine = this.mine();
    for (const pl of this.places) if (mine.some(e => d2(e, pl) < (pl.r + 600) ** 2)) this.seenAt.set(pl.key, w.time);
    this.enemies = enemies;
    this.mind = this.brain ? new SpaceMind(this.brain, w, this.player, { enemies, enemyStart: this.enemyStart, seen: t => w.time - (this.seenAt.get(t.key) ?? 0) }) : null;
  }
  desire(goal, tgt = null) { return this.mind ? this.mind.desire(goal, tgt) : 1; }

  update(dt) {
    const p = this.player;
    if (p.defeated) return;
    const gained = p.credits - this.lastCredits;
    if (gained > 0 && this.cfg.income !== 1) p.credits += gained * (this.cfg.income - 1);
    this.lastCredits = p.credits;
    const goals = this.world.goals;
    this.led = !!(goals && this.brain && goals.tick(this, dt));
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.cfg.think * (0.8 + simRandom() * 0.4);
    if (this.led) { this.lastCredits = p.credits; return; }
    this.think();
    this.economy();
    this.production();
    this.military();
    this.lastCredits = p.credits;
  }

  mine() {
    const out = [];
    for (const e of this.world.selectables()) if (e.player === this.player && (e.isSquad || e.isMobile) && !e.hyper && !e.noAI) out.push(e);
    return out;
  }

  value(e) { return buildCost(e.type) * e.healthFrac; }

  threat(u) { return (buildCost(u.squad ? u.squad.type : u.type) || u.maxHealth * 0.6) * (u.squad ? 1 / Math.max(1, u.squad.size || 1) : 1) * u.healthFrac; }

  scripted() { const h = this.world.scripts; return h && !h.plansOff && h.plans && h.plans.ready ? h.plans : null; }

  plan(goal, thing = null, most = 1) {
    const P = this.scripted();
    if (!P || !P.can(goal)) return false;
    if (P.running(this, goal, thing) || P.count(this, goal) >= most || P.count(this) >= 12) return true;
    const key = goal + '|' + (thing ? thing.id ?? thing.key ?? '' : ''), t = this.world.time;
    if (t - ((this.tried ||= new Map()).get(key) ?? -99) < 8) return true;
    this.tried.set(key, t);
    const inst = P.start(this, goal, thing);
    if (inst) inst.tryKey = key;
    return true;
  }

  economy() {
    const w = this.world, p = this.player;
    if (this.mind && this.desire('Skirmish_Generate_Magic_Cash_Drop_Space') > 0) {
      if (!this.plan('Skirmish_Generate_Magic_Cash_Drop_Space') && w.time - this.cashAt > 120) { p.credits += 6000; this.cashAt = w.time; }
    }
    for (const u of w.units) {
      if (u.dead || !u.isPad || u.padChild || u.padOwner !== p) continue;
      const options = w.buildOptions(u, p), mine = options.find(t => /MINERAL_EXTRACTOR/i.test(t.name));
      const goal = mine ? 'Build_Refinery_Space' : 'Build_Structure_Space';
      if (this.desire(goal, target.unit(u)) <= 0) continue;
      if (this.plan(goal)) continue;
      for (const t of mine ? [mine] : options) {
        if (!w.cantBuild(u, t, p)) { w.startBuild(u, t, p); break; }
      }
    }
  }

  production() {
    const w = this.world, p = this.player, st = p.station;
    if (!st || st.dead) return;
    const queued = w.queuesOf(st, p).reduce((a, [, q]) => a + q.length, 0);
    if (queued >= 3) return;
    const list = w.buildOptions(st, p);
    const options = list.filter(t => !w.cantBuild(st, t, p));
    const raises = t => isUpgradeType(t) && (t.bool('Tactical_Build_Increments_Tech_Level') || t.sub('Abilities').some(ab => ab.children.some(a => a.tag.toLowerCase() === 'starbase_upgrade_ability')));
    let levelUp = null, levelAt = null;
    for (const b of w.buildersOf(p)) { levelUp = w.buildOptions(b, p).find(t => raises(t) && [null, 'Not enough credits'].includes(w.cantBuild(b, t, p))); if (levelUp) { levelAt = b; break; } }
    const want = { station: levelUp ? this.desire('Skirmish_Upgrade_Space_Station') : 0, units: this.desire('Tactical_Multiplayer_Build_Space_Units_Generic'), upgrades: this.desire('Purchase_Space_Upgrades_Generic') };
    if (!levelUp && this.mind && this.mind.fn('SKIRMISH_NEEDS_NEW_SPACE_STATION') > 0) want.units = Math.max(want.units, 1);
    this.wants = want;
    if (this.scripted()) {
      const order = [['Skirmish_Upgrade_Space_Station', want.station], ['Tactical_Multiplayer_Build_Space_Units_Generic', want.units], ['Purchase_Space_Upgrades_Generic', want.upgrades]].filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
      const P = this.scripted();
      if (order.length && order.every(([g]) => P.can(g))) {
        for (const [g] of order) if (!P.count(this, g) && P.canBegin(this, g)) this.plan(g);
        return;
      }
    }
    if (want.station > 0 && want.station >= want.units && want.station >= want.upgrades) {
      { const b = levelAt || st; if (!w.queuedCount(p, levelUp, true) && !w.cantBuild(b, levelUp, p)) w.startBuild(b, levelUp, p); }
      return;
    }
    if (!options.length || w.time < this.buyAt) return;
    const level = this.stationLevel(), purse = level <= 1 ? 2000 : level === 2 ? 4000 : 6000, wait = level <= 1 ? 30 : level === 2 ? 50 : 80;
    const upgrades = options.filter(isUpgradeType).filter(t => t !== levelUp);
    const units = options.filter(t => !isUpgradeType(t));
    if (want.upgrades > 0 && want.upgrades >= want.units && upgrades.length) {
      w.startBuild(st, upgrades[Math.floor(simRandom() * upgrades.length)], p);
      this.buyAt = p.credits >= purse ? 0 : w.time + 120;
      return;
    }
    if (!(want.units > 0) || !units.length) return;
    units.sort((a, b) => buildCost(b) - buildCost(a));
    const fighters = units.filter(isSquadronType);
    for (let n = queued; n < 3; n++) {
      const can = units.filter(t => !w.cantBuild(st, t, p));
      if (!can.length) break;
      const squads = can.filter(isSquadronType), haveSquads = w.squads.filter(q => !q.dead && q.player === p).length + w.queuesOf(st, p).reduce((a, [, q]) => a + q.filter(it => isSquadronType(it.type || it)).length, 0);
      const pick = squads.length && fighters.length && haveSquads < 3 + level && simRandom() < 0.45 ? squads[Math.floor(simRandom() * squads.length)] : can[Math.floor(simRandom() ** 2 * can.length)];
      w.startBuild(st, pick, p);
    }
    if (p.credits < purse) this.buyAt = w.time + wait;
  }

  stationLevel() { return this.player.techLevel; }

  known() {
    const w = this.world, p = this.player, out = [];
    for (const u of w.units) {
      if (u.dead || u.player.id < 0 || u.player.team === p.team || !u.targetableUnit || u.hyper) continue;
      if (!w.fog || w.canSee(p, u) || (u.isStructure && (u.everSeenBy & p.bit))) out.push(u);
    }
    return out;
  }

  strengthAt(enemies, at, r = 1300) { let s = 0; for (const u of enemies) if (d2(u, at) < r * r) s += this.threat(u); return s; }

  start(kind, units, extra = {}) {
    const plan = { kind, units: units.slice(), born: this.world.time, phase: 0, ...extra };
    for (const e of units) e.aiPlan = plan;
    this.plans.push(plan);
    return plan;
  }

  end(plan) {
    for (const e of plan.units) if (e.aiPlan === plan) e.aiPlan = null;
    for (const e of plan.wing || []) if (e.aiPlan === plan) e.aiPlan = null;
    plan.done = true;
  }

  has(kind) { return this.plans.some(p => p.kind === kind); }
  can(kind) { return this.cfg.plans.has(kind); }

  military() {
    const w = this.world, p = this.player, st = p.station, t = w.time;
    const mine = this.mine();
    if (!mine.length) { this.plans = []; return; }
    const enemies = this.enemies;
    for (const e of mine) aiUseAbilities(w, e);

    for (const plan of this.plans) {
      plan.units = plan.units.filter(alive);
      if (plan.wing) plan.wing = plan.wing.filter(alive);
      if (!plan.units.length) { this.end(plan); continue; }
      this.step(plan, enemies);
    }
    for (const pl of this.plans) if (pl.kind === 'burn' && this.mind && !(this.desire('Burn_Units_Space') > 0)) this.end(pl);
    this.plans = this.plans.filter(pl => !pl.done);
    const busy = new Set();
    const free = () => mine.filter(e => !e.aiPlan && !busy.has(e));
    const take = (list, n) => list.slice(0, n);
    const home = st && !st.dead ? st : mine[0];

    for (const e of free()) if (idle(e) && !(e.target && !e.target.dead) && w.inHazard(e)) orderMove([e], e.x, e.y, false, false, true);

    const want = [];
    const ask = (kind, goals, tgt, thing) => { if (!this.can(kind)) return; const d = Math.max(...goals.map(g => this.desire(g, tgt))); if (d > 0) want.push({ kind, d, thing, goal: goals.reduce((a, g) => (this.desire(g, tgt) > this.desire(a, tgt) ? g : a)) }); };
    if (st && !st.dead) ask('defend', ['Defend_Space_Station'], target.unit(st), st);
    if (this.mind) ask('burn', ['Burn_Units_Space'], null, null);
    for (const e of enemies) {
      if (e.isPad || (e.isFighter && e.squad && e.squad.fighters[0] !== e)) continue;
      const tg = target.unit(e);
      if (!e.isFighter) { ask('destroy', ['Destroy_Unit', 'Destroy_Unit_Minimal'], tg, e); ask('bombing', ['Bomb_Unit'], tg, e); }
    }
    for (const big of mine) if (!big.isSquad) ask('escort', ['Space_Escort_Goal'], target.unit(big), big);
    for (const pl of this.places) { ask('sweep', ['Sweep_Area'], pl, pl); ask('scout', ['Space_Scout'], pl, pl); ask('artillery', ['Space_Artillery'], pl, pl); }
    for (const u of w.units) if (!u.dead && u.capture && !u.padChild && (!u.padOwner || u.padOwner.team !== p.team) && (u.isPad || u.player.team !== p.team)) ask('pad', ['Secure_Build_Pad_Space'], target.unit(u), u);
    want.sort((a, b) => b.d - a.d);
    this.wanted = want.slice(0, 12).map(x => [x.kind, x.thing ? (x.thing.type ? x.thing.type.name : 'place') : '', +x.d.toFixed(1)]);

    let artillery = false;
    const MOST = { pad: 3, escort: 2, destroy: 2, bombing: 1, sweep: 1, scout: 1, artillery: 1, defend: 1, burn: 1 };
    for (const { kind, thing, goal } of want) {
      if (this.plan(goal, thing, MOST[kind] || 1)) continue;
      if (kind === 'burn') {
        if (this.has('burn')) break;
        for (const pl of this.plans) this.end(pl);
        this.plans = [];
        this.start('burn', mine);
        break;
      } else if (kind === 'defend') {
        const near = enemies.filter(e => !e.isStructure && d2(e, st) < 2500 * 2500);
        const big = near.filter(e => !e.isFighter).sort((a, b) => d2(a, st) - d2(b, st))[0] || near[0];
        if (!big) continue;
        const guards = free().filter(e => idle(e) || e.order.kind === 'guard' || (e.order.kind === 'attack' && !alive(e.order.target)));
        if (guards.length) orderAttack(guards, big.squad || big);
        for (const e of free()) busy.add(e);
      } else if (kind === 'pad') {
        if (this.plans.filter(pl => pl.kind === 'pad').length >= 3 || this.plans.some(pl => pl.kind === 'pad' && pl.target === thing)) continue;
        const runners = free().filter(e => idle(e) && (isCorvette(e) || (e.isSquad && !e.carrier))).sort((a, b) => d2(a, thing) - d2(b, thing));
        const others = free().filter(e => idle(e) && !e.isSquad && !isCapital(e) && !isArtillery(e)).sort((a, b) => d2(a, thing) - d2(b, thing));
        const lead = runners[0] || others[0];
        if (!lead) continue;
        const plan = this.start('pad', [lead], { target: thing });
        plan.wing = take(free().filter(e => idle(e) && e !== lead && (isFighter(e) || isCorvette(e))), 1);
        for (const e of plan.wing) e.aiPlan = plan;
      } else if (kind === 'scout') {
        if (this.has('scout')) continue;
        const scout = free().filter(e => idle(e) && (isFighter(e) || isCorvette(e))).sort((a, b) => d2(a, thing) - d2(b, thing))[0];
        if (scout) this.start('scout', [scout], { target: { x: thing.x, y: thing.y } });
      } else if (kind === 'escort') {
        if (this.plans.filter(pl => pl.kind === 'escort').length >= 2 || this.plans.some(pl => pl.kind === 'escort' && pl.target === thing)) continue;
        const wing = take(free().filter(e => idle(e) && isFighter(e)).sort((a, b) => d2(a, thing) - d2(b, thing)), 1);
        if (wing.length && free().length > 2) this.start('escort', wing, { target: thing });
      } else if (kind === 'artillery') {
        if (artillery) continue;
        artillery = true;
        for (const e of free()) if (isArtillery(e)) this.start('artillery', [e]);
      } else if (kind === 'bombing') {
        if (this.has('bombing')) continue;
        const bombers = free().filter(e => idle(e) && isBomber(e));
        if (bombers.length < 2) continue;
        const plan = this.start('bombing', take(bombers, 6), { target: thing });
        plan.wing = take(free().filter(e => idle(e) && isFighter(e)), 2);
        for (const e of plan.wing) e.aiPlan = plan;
      } else if (kind === 'destroy') {
        if (this.plans.some(pl => pl.kind === 'destroy' || pl.kind === 'flank')) continue;
        const ready = free().filter(e => idle(e) && !isArtillery(e)).slice(0, 20);
        if (!ready.length) continue;
        const force = ready.reduce((a, e) => a + this.value(e), 0), guard = this.strengthAt(enemies, thing);
        const wave = force >= this.waveSize;
        if (!((force >= guard * 1.1 && force >= 1200) || wave)) continue;
        if (wave) this.waveSize *= this.cfg.waveGrowth;
        const ships = ready.filter(e => !e.isSquad), fighters = ready.filter(isFighter);
        if (this.cfg.plans.has('flank') && ships.length >= 2 && fighters.length && !thing.isStructure && simRandom() < 0.6) {
          const plan = this.start('flank', ready.filter(e => !fighters.slice(0, 3).includes(e)), { target: thing, launched: force });
          plan.wing = fighters.slice(0, 3);
          for (const e of plan.wing) e.aiPlan = plan;
        } else this.start('destroy', ready, { target: thing, launched: force });
      } else if (kind === 'sweep') {
        if (this.has('sweep')) continue;
        const prey = enemies.filter(e => (e.isFighter || cats(e).has('CORVETTE') || cats(e).has('TRANSPORT')) && d2(e, thing) < thing.r * thing.r).sort((a, b) => d2(a, home) - d2(b, home))[0];
        const light = free().filter(e => idle(e) && (isFighter(e) || isCorvette(e)));
        if (!prey || light.length < 2) continue;
        const force = take(light, 4), strength = force.reduce((a, e) => a + this.value(e), 0);
        if (this.strengthAt(enemies, prey) <= strength * 1.3) this.start('sweep', force, { target: { x: prey.x, y: prey.y } });
      }
    }
  }

  step(plan, enemies) {
    const w = this.world, t = w.time, age = t - plan.born, units = plan.units, lead = units[0];
    const tgt = plan.target;
    const near = (at, r, pred = () => true) => enemies.filter(e => d2(e, at) < r * r && pred(e));
    const deadliest = at => near(at, 1500).sort((a, b) => this.threat(b) - this.threat(a))[0];
    switch (plan.kind) {
      case 'scout': {
        if (plan.phase === 0) { orderMove(units, tgt.x, tgt.y, false, false, true); plan.phase = 1; }
        else if (plan.phase === 1 && (d2(lead, tgt) < 900 * 900 || idle(lead))) {
          orderMove(units, tgt.x + (simRandom() - 0.5) * 2400, tgt.y + (simRandom() - 0.5) * 2400, false, false, true);
          plan.phase = 2; plan.until = t + 10;
        } else if (plan.phase === 2 && t > plan.until) this.end(plan);
        if (age > 150) this.end(plan);
        break;
      }
      case 'pad': {
        const taken = tgt.dead || tgt.padChild || (tgt.padOwner && tgt.padOwner.team === this.player.team) || (!tgt.isPad && tgt.player.team === this.player.team);
        if (taken || age > 120) { this.end(plan); break; }
        if (plan.phase === 0 || (idle(lead) && d2(lead, tgt) > 250 * 250)) { orderMove([lead], tgt.x + 60, tgt.y + 60, true, false, true); plan.phase = 1; }
        for (const e of plan.wing || []) if (e.order.kind !== 'guard' || e.order.target !== lead) orderGuard([e], lead);
        break;
      }
      case 'escort': {
        if (!alive(tgt)) { this.end(plan); break; }
        for (const e of units) if (e.order.kind !== 'guard' || e.order.target !== tgt) orderGuard([e], tgt);
        break;
      }
      case 'artillery': {
        const close = near(lead, 1000, e => !e.isStructure)[0];
        if (close) {
          const d = dist(lead, close) || 1, away = w.clearOf(lead, lead.x + (lead.x - close.x) / d * 900, lead.y + (lead.y - close.y) / d * 900);
          lead.setOrder({ kind: 'move', x: away.x, y: away.y });
          break;
        }
        const reach = lead.maxRange * 0.92;
        const inRange = near(lead, lead.maxRange + 500, e => !e.isFighter).sort((a, b) => this.threat(b) - this.threat(a))[0];
        const any = inRange || enemies.filter(e => !e.isFighter).sort((a, b) => d2(a, lead) - d2(b, lead))[0];
        if (!any) { if (!idle(lead)) lead.setOrder({ kind: 'idle' }); this.end(plan); break; }
        if (lead.order.kind !== 'attack' || lead.order.target !== any) { lead.setOrder({ kind: 'attack', target: any, reach }); lead.target = any; }
        break;
      }
      case 'bombing': {
        if (!alive(tgt) || age > 240) { this.end(plan); break; }
        const wing = plan.wing || [];
        if (plan.phase === 0) {
          const d = dist(lead, tgt) || 1, hold = Math.max(0, d - 2200);
          const rally = w.clearOf(lead, lead.x + (tgt.x - lead.x) / d * hold, lead.y + (tgt.y - lead.y) / d * hold);
          orderMove(units, rally.x, rally.y, false, false, true);
          if (wing.length) orderMove(wing, tgt.x, tgt.y, true);
          plan.phase = 1; plan.until = t + 30;
        } else if (plan.phase === 1) {
          const ahead = wing.some(e => d2(e, tgt) < d2(lead, tgt) && (d2(e, tgt) < 900 * 900 || (e.target && !e.target.dead)));
          if (!wing.length || ahead || t > plan.until) { orderAttack(units, tgt.squad || tgt); plan.phase = 2; }
        } else {
          for (const e of units) if (idle(e)) orderAttack([e], tgt.squad || tgt);
          for (const e of wing) if (idle(e)) orderGuard([e], lead);
        }
        break;
      }
      case 'sweep': {
        if (age > 150) { this.end(plan); break; }
        if (plan.phase === 0) { orderMove(units, tgt.x, tgt.y, true, false, true); plan.phase = 1; break; }
        if (!units.some(idle)) break;
        const at = { x: lead.x, y: lead.y };
        const pick = near(at, 3000, e => cats(e).has('TRANSPORT'))[0]
          || near(at, 3000, e => e.isFighter || cats(e).has('CORVETTE')).sort((a, b) => d2(a, at) - d2(b, at))[0] || deadliest(at);
        if (pick) orderAttack(units.filter(idle), pick.squad || pick); else this.end(plan);
        break;
      }
      case 'destroy': case 'flank': {
        const left = units.reduce((a, e) => a + this.value(e), 0);
        if (!alive(tgt) || left < plan.launched * 0.3 || age > 420) {
          const st = this.player.station;
          if (alive(tgt) && st && !st.dead) orderMove(units, st.x + 300, st.y + 300, false, false, true);
          this.end(plan);
          break;
        }
        if (plan.phase === 0) { orderMove(units, tgt.x, tgt.y, true, false, true); plan.phase = 1; }
        for (const e of units) if (idle(e) && !(e.target && !e.target.dead)) { const k = deadliest(e) || tgt; orderAttack([e], k.squad || k); }
        if (plan.kind === 'flank' && plan.wing && plan.wing.length) {
          const wing = plan.wing, w0 = wing[0];
          if (plan.wingPhase === undefined) {
            const h = tgt.heading || 0;
            for (const a of [Math.PI, -Math.PI / 2, Math.PI / 2]) {
              const x = tgt.x + Math.cos(h + a) * 1000, y = tgt.y + Math.sin(h + a) * 1000;
              if (x > w.min.x && x < w.max.x && y > w.min.y && y < w.max.y) { plan.ambush = w.clearOf(w0, x, y); break; }
            }
            if (!plan.ambush) { for (const e of wing) e.aiPlan = null; plan.wing = []; break; }
            orderMove(wing, plan.ambush.x, plan.ambush.y, false, false, true);
            plan.wingPhase = 0;
          } else if (plan.wingPhase === 0) {
            if (units.some(e => d2(e, tgt) < (e.maxRange + 200) ** 2) || age > 120) { orderAttack(wing, tgt.squad || tgt); plan.wingPhase = 1; }
          } else for (const e of wing) if (idle(e)) orderAttack([e], tgt.squad || tgt);
        }
        break;
      }
      case 'burn': {
        for (const e of this.mine()) if (!e.aiPlan) { e.aiPlan = plan; units.push(e); }
        const at = { x: lead.x, y: lead.y };
        const all = this.world.units.filter(u => !u.dead && u.player.id >= 0 && u.player.team !== this.player.team && u.targetableUnit && !u.hyper);
        const goal = all.filter(e => e.isStructure || cats(e).has('CAPITAL')).sort((a, b) => d2(a, at) - d2(b, at))[0] || all.sort((a, b) => d2(a, at) - d2(b, at))[0];
        if (!goal) break;
        const todo = units.filter(e => idle(e) || (e.order.kind === 'attack' && !alive(e.order.target)) || plan.phase === 0);
        if (todo.length) orderMove(todo, goal.x, goal.y, true);
        plan.phase = 1;
        break;
      }
    }
  }
}
