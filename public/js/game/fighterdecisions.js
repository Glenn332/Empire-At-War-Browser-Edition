// Collects the fighters that reached their steering decision in the unit loop and decides them together.
// Whole squadrons that are not dogfighting go to the decision kernel (on the job threads when the battle has
// them); dogfighting squadrons, lone fighters and anything the kernel does not cover are decided one by one on
// the battle thread as before. Results come back as move requests in a fixed order.
import { DF, DS, FIRE, MODE, TARGET, DecideScene, decideSquad } from './fighterdecide.js';
import { DECIDE_CAP, DECIDE_HEAD } from './scanjobs.js';
import { db } from '../gamedata.js';

// The type values a decision reads, looked up once per type rather than per fighter and step.
const typeConstants = t =>
  (t._decideConstants ||= {
    maxSpeed: t.num('Max_Speed', 0),
    overrideDecel: (t._dec ??= t.num('OverrideDeceleration', 0)),
    layerZ: t.num('Layer_Z_Adjust', 0)
  });
const grown = (array, size) => (array && array.length >= size ? array : new Float64Array(Math.max(size, array ? array.length * 2 : 1024)));

export class FighterDecisions {
  constructor(world) {
    this.world = world;
    this.fighters = [];
    this.squadOrder = [];
    this.bySquad = new Map();
    this.kernelSquads = [];
    this.local = { head: new Float64Array(8), fighters: null, squads: null };
    this.sideMin = undefined;
    this.sideMax = undefined;
  }

  // Called from the unit loop when a fighter reaches its steering decision.
  add(unit) {
    this.fighters.push(unit);
  }

  run(dt) {
    const list = this.fighters;
    this.fighters = [];
    if (!list.length) return;
    const w = this.world,
      bySquad = this.bySquad,
      order = this.squadOrder,
      kernel = this.kernelSquads,
      lone = [];
    bySquad.clear();
    order.length = 0;
    kernel.length = 0;
    for (const u of list) {
      if (u.dead || u.suspended) continue;
      const s = u.squad;
      if (!s) {
        lone.push(u);
        continue;
      }
      let group = bySquad.get(s);
      if (!group) {
        bySquad.set(s, (group = []));
        order.push(s);
      }
      group.push(u);
    }
    for (const s of order) {
      const group = bySquad.get(s);
      if (this.fitsKernel(s, group)) kernel.push(s);
      else for (const u of group) w.updateFighter(u, dt);
    }
    for (const u of lone) w.updateFighter(u, dt);
    if (!kernel.length) return;
    let fighterCount = 0;
    for (const s of kernel) fighterCount += s.fighters.length;
    const ahead = w.ahead,
      shared = ahead && ahead.decideShared();
    const fits = shared && fighterCount <= DECIDE_CAP.FIGHTERS && kernel.length <= DECIDE_CAP.SQUADS;
    const store = fits ? shared : this.localStore(fighterCount, kernel.length);
    this.pack(store, kernel);
    const scene = new DecideScene(store.fighters, store.squads);
    scene.sideMin = store.head[DECIDE_HEAD.SIDE_MIN];
    scene.sideMax = store.head[DECIDE_HEAD.SIDE_MAX];
    if (fits) ahead.runDecisions(kernel.length);
    else for (let i = 0; i < kernel.length; i++) decideSquad(scene, i);
    this.unpack(store, kernel);
  }

  // A squadron goes to the kernel when every one of its fighters is deciding this step, they all have formation
  // slots, and it is not dogfighting another squadron (that changes the shared dogfight grid and other fighters).
  fitsKernel(s, group) {
    if (group.length !== s.fighters.length) return false;
    for (const f of s.fighters) if (f.dead || !f.slot || !f.fstate) return false;
    const mode = s.mode || 'idle',
      tgt = mode === 'combat' && s.target && !s.target.dead ? s.target : null;
    if (tgt && tgt.isSquad && !s.approach) return false;
    if (tgt && !s.aim) return false;
    if (mode === 'move' && !(s.routed && s.route) && !s.goal) return false;
    return true;
  }

  localStore(fighters, squads) {
    const L = this.local;
    L.fighters = grown(L.fighters, fighters * DF.STRIDE);
    L.squads = grown(L.squads, squads * DS.STRIDE);
    return L;
  }

  pack(store, kernel) {
    const w = this.world,
      f = store.fighters,
      sq = store.squads,
      C = db.constants;
    store.head[DECIDE_HEAD.SIDE_MIN] = this.sideMin ??= C.num('FormationMinimumSideError', 0.1);
    store.head[DECIDE_HEAD.SIDE_MAX] = this.sideMax ??= C.num('FormationMaximumSideError', 30);
    store.head[DECIDE_HEAD.SQUADS] = kernel.length;
    let row = 0;
    for (let i = 0; i < kernel.length; i++) {
      const s = kernel[i],
        r = i * DS.STRIDE,
        mode = s.mode || 'idle',
        tgt = mode === 'combat' && s.target && !s.target.dead ? s.target : null,
        o = s.order,
        D = s.direct,
        about = s.about,
        aim = s.aim,
        route = s.routed && s.route ? s.route : null;
      sq[r + DS.FIRST] = row;
      sq[r + DS.COUNT] = s.fighters.length;
      sq[r + DS.MODE] = mode === 'move' ? MODE.MOVE : mode === 'combat' ? MODE.COMBAT : MODE.IDLE;
      sq[r + DS.TARGET] = tgt ? (tgt.isSquad ? TARGET.SQUAD : TARGET.UNIT) : TARGET.NONE;
      sq[r + DS.APPROACH] = s.approach ? 1 : 0;
      sq[r + DS.AIM_X] = aim ? aim.x : 0;
      sq[r + DS.AIM_Y] = aim ? aim.y : 0;
      sq[r + DS.AIM_Z] = aim ? aim.z : 0;
      sq[r + DS.RUN_IN] = s.runIn ? 1 : 0;
      sq[r + DS.STACKED] = s.stacked ? 1 : 0;
      sq[r + DS.ROUTED] = route ? 1 : 0;
      sq[r + DS.ROUTE_DX] = route ? route.dx : 0;
      sq[r + DS.ROUTE_DY] = route ? route.dy : 0;
      sq[r + DS.ROUTE_SX] = route ? route.sx : 0;
      sq[r + DS.ROUTE_SY] = route ? route.sy : 0;
      sq[r + DS.GOAL_X] = s.goal ? s.goal.x : 0;
      sq[r + DS.GOAL_Y] = s.goal ? s.goal.y : 0;
      sq[r + DS.HAS_ABOUT] = about ? 1 : 0;
      sq[r + DS.ABOUT_X] = about ? about.x : 0;
      sq[r + DS.ABOUT_Y] = about ? about.y : 0;
      sq[r + DS.CRUISE] = s.cruise === undefined ? NaN : s.cruise;
      sq[r + DS.PACE] = o.pace ?? 1;
      sq[r + DS.TRAVEL] = s.travel ?? NaN;
      sq[r + DS.SPEED] = s.speed;
      sq[r + DS.ERR] = s.err || 0;
      sq[r + DS.TOLERANCE] = s.tolerance ??= s.type.num('Squadron_Formation_Error_Tolerance', 0);
      sq[r + DS.DIRECT] = D ? 1 : 0;
      sq[r + DS.DIRECT_TURN] = D ? D.turn : 0;
      sq[r + DS.DIRECT_THROTTLE] = D ? D.throttle : 0;
      sq[r + DS.DIRECT_FIRING] = D && D.firing && D.target && !D.target.dead ? 1 : 0;
      sq[r + DS.FIRE_TARGET_ALIVE] = s.fireTarget && !s.fireTarget.dead ? 1 : 0;
      sq[r + DS.ORDER_IDLE] = o.kind === 'idle' ? 1 : 0;
      sq[r + DS.GUARDING_TARGET] = o.kind === 'guard' && o.target ? 1 : 0;
      for (const u of s.fighters) {
        const fr = row * DF.STRIDE,
          t = u.type,
          fly = w.flight(u);
        f[fr + DF.ID] = u.id;
        f[fr + DF.X] = u.x;
        f[fr + DF.Y] = u.y;
        f[fr + DF.Z] = u.z;
        f[fr + DF.HEADING] = u.heading;
        f[fr + DF.PITCH] = u.pitch === undefined ? NaN : u.pitch;
        f[fr + DF.SPEED] = u.speed;
        f[fr + DF.TURN_RATE] = u.turnRate;
        f[fr + DF.MIN_SPEED] = u.minSpeed;
        f[fr + DF.MAX_SPEED] = u.maxSpeed;
        f[fr + DF.OWN] = u.bonus.speed * u.mods.speed * w.pursuit(u);
        f[fr + DF.SLOT_X] = u.slot.x;
        f[fr + DF.SLOT_Y] = u.slot.y;
        f[fr + DF.SLOT_Z] = u.slot.z;
        const k = typeConstants(t);
        f[fr + DF.THRUST] = fly.thrust;
        f[fr + DF.ACCEL] = u.accel === undefined ? NaN : u.accel;
        f[fr + DF.TYPE_MAX_SPEED] = k.maxSpeed;
        f[fr + DF.OVERRIDE_DECEL] = k.overrideDecel;
        f[fr + DF.GZ_BASE] = k.layerZ + 35 + (s.stacked ? u.slot.z : (u.id * 37) % 50);
        f[fr + DF.FIRE_IDLE] = (u.fireIdle ??= t.bool('Can_Fighter_Fire_When_Idle')) ? 1 : 0;
        row++;
      }
    }
  }

  unpack(store, kernel) {
    const w = this.world,
      f = store.fighters,
      sq = store.squads,
      moves = w.fighterMoves;
    for (let i = 0; i < kernel.length; i++) {
      const s = kernel[i],
        r = i * DS.STRIDE,
        first = sq[r + DS.FIRST],
        travel = sq[r + DS.TRAVEL];
      s.travel = travel === travel ? travel : s.travel;
      const D = s.direct;
      for (let k = 0; k < s.fighters.length; k++) {
        const u = s.fighters[k],
          st = u.fstate,
          fr = (first + k) * DF.STRIDE,
          fire = f[fr + DF.FIRE];
        st.mode = f[fr + DF.ATTACKING] ? 'attack' : 'form';
        st.fireAt = fire === FIRE.TARGET ? s.target : fire === FIRE.SQUAD_TARGET ? s.fireTarget : fire === FIRE.DIRECT ? D.target : null;
        moves.request(
          u,
          f[fr + DF.GOAL_X],
          f[fr + DF.GOAL_Y],
          f[fr + DF.GOAL_Z],
          f[fr + DF.GOAL_Z_DEFAULT],
          f[fr + DF.WANT],
          f[fr + DF.WANT_IF_HIT],
          f[fr + DF.TURN_FACTOR],
          f[fr + DF.LOOP_ALLOWED] !== 0,
          k === 0
        );
      }
    }
  }
}
