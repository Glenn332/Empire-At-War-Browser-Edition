import * as THREE from 'three';
import { heightAt, CELL } from './terrain.js';
import { TERRAIN } from './landtables.js';
import { AnimState } from '../ala.js';
import { TroopBay, bayExit } from './troopbay.js';
import { buildsFor, isHeroCompany } from './land.js';

const WAVE = { every: 15, first: 3, cap: 8, gap: 3, unload: 0.6, ramp: 1.2, walk: 3.2, space: 110, rings: [1, 2, 3], linger: 2.5, out: 12 },
  ROOM = { send: 0.1, shake: 0.012, fov: 70 },
  _c = new THREE.Vector3(),
  _p = new THREE.Vector3(),
  _box = new THREE.Box3();

export class ShuttleWaves {
  constructor(sh) {
    this.sh = sh;
    this.queues = [];
    this.next = [];
    this.key = 0;
    this.flights = new Map();
    this.visuals = new Map();
    this.room = null;
    this.rideKey = 0;
    this.rideId = '';
    this.clientWait = 0;
  }

  on() {
    const sh = this.sh;
    return sh.cfg.shuttle !== false && !sh.benchN;
  }

  clock() {
    const w = this.sh.world,
      n = Math.max(this.sh.game.factions?.length || 0, this.queues.length);
    for (let s = 0; s < n; s++) {
      this.queues[s] ||= [];
      if (this.next[s] === undefined) this.next[s] = w.time + WAVE.first;
    }
  }

  launchIn(side) {
    const w = this.sh.world;
    this.clock();
    return Math.max(0, Math.ceil((this.next[side] ?? w.time) - w.time));
  }

  waiting(side, who) {
    if ((this.queues[side] || []).some(e => e.who === who)) return true;
    for (const F of this.flights.values()) if (F.side === side && !F.landed && F.load.some(e => e.who === who)) return true;
    return false;
  }

  add(e) {
    this.clock();
    if (!e.car && e.who !== 'bot') return this.board(e);
    if (!e.car) {
      const F = this.openFlight(e.side, null);
      if (F) {
        this.seat(F, e);
        return e;
      }
    }
    this.queues[e.side].push(e);
    return e;
  }

  openFlight(side, z) {
    for (const F of this.flights.values()) if (F.side === side && !F.launched && F.load.length < WAVE.cap && (!z || F.z === z)) return F;
    return null;
  }

  flight(side, z, o, launched) {
    const w = this.sh.world,
      face = Math.atan2(w.n * 10 - z.y, w.n * 10 - z.x),
      F = { key: ++this.key, side, z, face, o, load: [], launched, landed: false, inside: new Map(), pos: new Map(), stood: new Set(), t: null, bots: 0 };
    this.flights.set(F.key, F);
    return F;
  }

  board(e) {
    const zones = this.zones(e.side),
      z = this.near(zones, e.point) || e.point || zones[0];
    if (!z) {
      this.direct(e.side, e);
      return e;
    }
    let F = this.openFlight(e.side, z);
    if (!F) {
      const w = this.sh.world,
        early = [...this.flights.values()].filter(f => f.side === e.side && !f.launched).length,
        face = Math.atan2(w.n * 10 - z.y, w.n * 10 - z.x);
      F = this.flight(e.side, z, this.spot(z, face, this.takenSpots(), false), false);
      this.seat(F, e);
      const q = this.queues[e.side];
      for (let i = 0; i < q.length && F.load.length < WAVE.cap; )
        if (q[i].who === 'bot' && !q[i].car) this.seat(F, q.splice(i, 1)[0]);
        else i++;
      this.fly(F, this.launchIn(e.side) + early * WAVE.gap);
      return e;
    }
    this.seat(F, e);
    return e;
  }

  seat(F, e) {
    if (e.who === 'bot' && this.sh.isDummy(e.unit)) {
      const real = this.sh.realTypes(e.unit);
      if (real) e.unit = real[Math.floor(Math.random() * real.length)];
    }
    F.load.push(e);
    if (!F.H && this.seatType(e.unit)) F.H = this.heightOf(this.seatType(e.unit));
    if (e.who === 'bot') e.sid = 'b' + ++F.bots;
    else e.sid = e.who === 'me' ? 'h' : 'p' + e.who;
    this.seatEvent(F);
    if (e.who === 'me') this.startRoom(F);
    else if (e.who !== 'bot' && e.notify) e.notify({ key: F.key, rid: e.sid });
  }

  seatEvent(F) {
    const N = this.sh.game.shooterNet;
    if (!N || !N.peers?.size) return;
    N.events.push(['seat', F.key, F.load.map(e => [e.sid, this.seatName(e), e.who === 'bot' ? 0 : 1])]);
  }

  step() {
    const w = this.sh.world,
      now = w.time;
    this.clock();
    for (let s = 0; s < this.queues.length; s++) {
      if (now < this.next[s]) continue;
      this.next[s] += WAVE.every;
      if (this.next[s] <= now) this.next[s] = now + WAVE.every;
      this.launch(s, this.queues[s].splice(0));
    }
    this.shield();
    this.keepClear();
    for (const F of this.flights.values()) {
      if (F.inside.size && now >= F.forceAt) for (const e of [...F.inside.keys()]) this.riderOut(F, e, null);
      if (F.gone || (F.t && (F.t.craft?.gone || F.t.craft?.dead) && !F.inside.size)) this.flights.delete(F.key);
    }
  }

  keepClear() {
    const w = this.sh.world,
      dt = Math.max(0, Math.min(0.1, w.time - (this.clearT ?? w.time))),
      me = this.sh.body,
      solid = [];
    this.clearT = w.time;
    for (const t of this.blocked || []) if (!(w.transports || []).includes(t) || t.craft?.dead) this.unblock(t);
    for (const t of w.transports || []) {
      if (!t.cargo || !t.holder || t.craft?.dead) continue;
      const a = t.anim,
        k = a && a.anim ? a.time / Math.max(1e-3, a.anim.duration) : 1;
      const low = (t.stage === 'land' && !(t.hold > 0) && k > 0.55) || t.stage === 'unload' || (t.stage === 'leave' && k < 0.35);
      if (!low) {
        if (t.blockCells) this.unblock(t);
        continue;
      }
      if (!t.clearR) {
        t.holder.updateMatrixWorld(true);
        _box.setFromObject(t.holder);
        const half = Math.hypot(_box.max.x - _box.min.x, _box.max.y - _box.min.y) * 0.32,
          F = this.flights.get(t.shuttleKey),
          ramp = F ? bayExit(F.H, 1).x * 0.85 : 70;
        t.clearR = Math.max(12, Math.min(half, ramp));
      }
      solid.push({ x: t.roomX ?? t.x, y: t.roomY ?? t.y, r: t.clearR });
      if (!t.blockCells) this.block(t, t.roomX ?? t.x, t.roomY ?? t.y, t.clearR * 0.9);
    }
    if (!solid.length) return;
    for (const u of w.units || []) {
      if (u.dead || u.inside || u.structure || u.flies || !(u.speed > 0)) continue;
      for (const S of solid) {
        const R = S.r + (u.foot ? 2 : u.hitRadius || 8),
          within = p => Math.hypot(p.x - S.x, p.y - S.y) < R * 1.05;
        if (u.path && u.path.length && Math.hypot(u.x - S.x, u.y - S.y) < R * 2.5) {
          while (u.path.length > 1 && within(u.path[0])) u.path.shift();
          if (u.path.length === 1 && within(u.path[0])) u.path.length = 0;
        }
        const dx = u.x - S.x,
          dy = u.y - S.y,
          d = Math.hypot(dx, dy);
        if (d >= R) continue;
        let a = d > 1e-3 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
        const goal = u !== me ? (u.path && u.path[0]) || (u.target && !u.target.dead ? u.target : null) : null;
        if (goal && !within(goal)) {
          const ga = Math.atan2(goal.y - S.y, goal.x - S.x),
            diff = Math.atan2(Math.sin(ga - a), Math.cos(ga - a));
          a += Math.sign(diff) * Math.min(Math.abs(diff), ((u.speed || 20) * dt) / R);
        }
        u.x = S.x + Math.cos(a) * R;
        u.y = S.y + Math.sin(a) * R;
      }
    }
  }

  block(t, x, y, r) {
    const w = this.sh.world,
      n = w.n,
      cells = [],
      i0 = Math.max(0, Math.floor((x - r) / CELL)),
      i1 = Math.min(n - 1, Math.ceil((x + r) / CELL)),
      j0 = Math.max(0, Math.floor((y - r) / CELL)),
      j1 = Math.min(n - 1, Math.ceil((y + r) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(i * CELL - x, j * CELL - y) <= r) cells.push(j * n + i);
    const own = [];
    t.blockCells = own;
    (this.blocked ||= new Set()).add(t);
    if (!cells.length || !w.occupy) return;
    for (const k of cells) own.push(k);
    w.occupy(own, cells, TERRAIN.OBSTACLE);
    w.groundChanged(cells);
    if (w.reroute) w.reroute(cells);
  }

  unblock(t) {
    const w = this.sh.world,
      own = t.blockCells;
    t.blockCells = null;
    this.blocked?.delete(t);
    if (!own || !own.length || !w.vacate) return;
    w.vacate(own);
    if (w.reroute) w.reroute(own);
  }

  zones(side) {
    const sh = this.sh,
      w = sh.world,
      pads = sh.points(side);
    if (pads.length) return pads;
    const home = sh.home(side) || sh.hq(side);
    return w.points
      .filter(p => p.side >= 0 && w.ally(p.side, side))
      .sort((a, b) => (home ? Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y) : 0));
  }

  near(list, p) {
    if (!p) return null;
    let best = null,
      bd = Infinity;
    for (const z of list) {
      const d = Math.hypot(z.x - p.x, z.y - p.y);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  }

  takenSpots() {
    const w = this.sh.world,
      out = [];
    for (const t of w.transports || []) if (t.cargo && !t.craft?.dead) out.push({ x: t.x, y: t.y, face: t.heading });
    for (const F of this.flights.values()) if (!F.gone) out.push({ x: F.o.x, y: F.o.y, face: F.face });
    return out;
  }

  launch(side, entries) {
    const w = this.sh.world,
      zones = this.zones(side),
      open = [...this.flights.values()].filter(F => F.side === side && !F.launched);
    for (const F of open) F.launched = true;
    const rest = [];
    for (const e of entries) {
      const F = !e.car && open.find(f => f.load.length < WAVE.cap);
      if (F) this.seat(F, e);
      else rest.push(e);
    }
    const groups = new Map();
    let pick = null;
    for (const e of rest) {
      let z = e.who !== 'bot' && e.point ? this.near(zones, e.point) || e.point : null;
      if (!z && zones.length) z = e.car ? zones[Math.floor(Math.random() * zones.length)] : (pick ||= zones[(this.turn = ((this.turn ?? -1) + 1) % zones.length)]);
      if (!z) {
        this.direct(side, e);
        continue;
      }
      let g = groups.get(z);
      if (!g) groups.set(z, (g = { foot: [], car: [] }));
      (e.car ? g.car : g.foot).push(e);
    }
    const taken = this.takenSpots();
    let i = open.length;
    for (const [z, g] of groups) {
      const loads = [];
      for (let k = 0; k < g.foot.length; k += WAVE.cap) loads.push(g.foot.slice(k, k + WAVE.cap));
      for (const e of g.car) loads.push([e]);
      const base = Math.atan2(w.n * 10 - z.y, w.n * 10 - z.x);
      for (const load of loads) {
        const o = this.spot(z, base, taken, load[0].car);
        taken.push({ x: o.x, y: o.y, face: base });
        const F = this.flight(side, z, o, true);
        for (const e of load) this.seat(F, e);
        this.fly(F, i++ * WAVE.gap);
      }
    }
  }

  spot(z, base, taken, car) {
    const w = this.sh.world,
      D = Math.max(WAVE.space, this.space || 0),
      lane = (p, x, y) => {
        const f = p.face ?? base,
          dx = x - p.x,
          dy = y - p.y,
          ahead = dx * Math.cos(f) + dy * Math.sin(f),
          side = Math.abs(-dx * Math.sin(f) + dy * Math.cos(f));
        return ahead > 0 && ahead < D * 1.6 && side < D * 0.6;
      },
      props = [...w.points.filter(p => p.holder), ...(w.units || []).filter(u => u.structure && !u.dead && !u.squad?.craft)],
      clearOf = (x, y) => props.every(p => Math.hypot(p.x - x, p.y - y) >= D * 0.9 + (p.hitRadius > 0 && p.structure ? p.hitRadius : 0)),
      free = (x, y) => clearOf(x, y) && taken.every(p => Math.hypot(p.x - x, p.y - y) >= D && !lane(p, x, y) && !lane({ x, y, face: base }, p.x, p.y));
    const tries = [[0, 0]];
    for (const k of WAVE.rings) {
      const n = 6 * k;
      for (let j = 0; j < n; j++) {
        const a = base + Math.PI / 2 + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * ((Math.PI * 2) / n),
          off = Math.atan2(Math.sin(a - base), Math.cos(a - base));
        if (Math.abs(off) < Math.PI / 3) continue;
        tries.push([Math.cos(a) * D * k, Math.sin(a) * D * k]);
      }
    }
    for (const ramp of [true, false])
      for (const [dx, dy] of tries) {
        const o = w.nearestOpen(z.x + dx, z.y + dy, car ? 3 : 1);
        if (o && free(o.x, o.y) && (!ramp || this.rampClear(o.x, o.y, base))) return { x: o.x, y: o.y };
      }
    const a = Math.random() * Math.PI * 2,
      r = D * (WAVE.rings.length + 1);
    return w.nearestOpen(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, car ? 3 : 1) || { x: z.x + Math.cos(a) * r, y: z.y + Math.sin(a) * r };
  }

  rampClear(x, y, face) {
    const w = this.sh.world,
      c = Math.cos(face),
      s = Math.sin(face);
    for (let i = 0; i < 3; i++) {
      const exit = bayExit(12, i),
        px = x + c * exit.x - s * exit.y,
        py = y + s * exit.x + c * exit.y,
        open = w.nearestOpen(px, py, 1);
      if (!open || open.x !== Math.round(px / CELL) * CELL || open.y !== Math.round(py / CELL) * CELL) return false;
    }
    return true;
  }

  async direct(side, e) {
    const sh = this.sh,
      w = sh.world,
      z = e.point || sh.home(side) || sh.hq(side);
    if (!z) return this.lose(e);
    const o = w.nearestOpen(z.x, z.y) || { x: z.x, y: z.y },
      u = await this.make(side, e, o, 0);
    if (u) this.out(e, u);
    else this.lose(e);
  }

  async make(side, e, o, h) {
    const sh = this.sh,
      w = sh.world;
    let q = null;
    try {
      if (e.who === 'bot') {
        const real = sh.isDummy(e.unit) ? sh.realTypes(e.unit) : null,
          t = real ? real[Math.floor(Math.random() * real.length)] : e.unit;
        q = sh.single(await sh.spawnKept(t.name, o.x, o.y, h, side));
      } else q = await sh.spawnClass(e.cls, o, h, side);
    } catch {
      q = null;
    }
    if (e.who === 'bot') this.settle(e, q);
    else if (q) {
      q.noAI = true;
      q.selectable = false;
    }
    return (q && q.members[0]) || null;
  }

  settle(e, q) {
    if (e.settled) return;
    e.settled = true;
    if (e.done) e.done(q);
  }

  out(e, u) {
    const sh = this.sh;
    if (e.who === 'me') {
      this.endRoom();
      if (sh.state !== 'alive') sh.boarded(e, u);
    } else if (e.who !== 'bot' && e.resolve) e.resolve(u);
  }

  lose(e) {
    if (e.who === 'bot') this.settle(e, null);
    else if (e.who === 'me') {
      this.endRoom();
      this.sh.boardFailed();
    } else if (e.resolve) e.resolve(null);
  }

  fly(F, hold) {
    const sh = this.sh,
      w = sh.world,
      N = sh.game.shooterNet,
      side = F.side,
      comp = this.craftCompany(F),
      byUnit = new Map();
    let exits = 0;
    const opts = {
      hold,
      interval: WAVE.unload,
      ramp: WAVE.ramp + WAVE.walk,
      cargo: async t => {
        F.landed = true;
        F.launched = true;
        if (t && t.inst) {
          t.holder.updateMatrixWorld(true);
          const c = this.centroid(t, _c);
          t.roomX = c.x;
          t.roomY = c.y;
        }
        const at = t ? { x: t.x, y: t.y } : F.o,
          bots = [];
        for (const e of F.load) {
          const u = await this.make(side, e, at, F.face);
          if (!u) {
            this.lose(e);
            continue;
          }
          if (e.who === 'bot') {
            byUnit.set(u, e);
            bots.push(u);
          } else if (t) {
            u.boarding = true;
            u.inside = t.craft;
            if (u.holder) u.holder.visible = false;
            F.inside.set(e, u);
          } else this.out(e, u);
        }
        F.forceAt = w.time + WAVE.out;
        if (!t) {
          for (const u of bots) this.out(byUnit.get(u), u);
          F.gone = true;
        }
        return bots;
      },
      onLeave: (u, t) => {
        const e = byUnit.get(u),
          i = exits++;
        this.exit(u, t, F.face, i, u.foot ? bayExit(F.H, i) : null);
        if (e) {
          this.stood(F, e.sid);
          this.out(e, u);
        }
      },
      onLost: () => {
        if (!F.landed) for (const e of F.load) this.lose(e);
        F.gone = true;
      },
      keepOpen: () => F.inside.size > 0
    };
    if (!comp) {
      opts.cargo(null);
      return;
    }
    Promise.resolve(w.reinforce(side, comp, F.o.x, F.o.y, F.face, null, opts)).then(t => {
      if (!t) return;
      F.t = t;
      t.shuttleKey = F.key;
    });
    if (N && N.peers?.size) N.events.push(['shut', F.key, side, comp, Math.round(F.o.x * 10) / 10, Math.round(F.o.y * 10) / 10, Math.round(F.face * 100) / 100, Math.round(hold * 10) / 10, Math.round((F.H || 12) * 100) / 100]);
  }

  craftCompany(F) {
    const e = F.load.find(x => x.company && x.company.str('Company_Transport_Unit')) || F.load[0];
    if (e && e.company && e.company.str('Company_Transport_Unit')) return e.company.name;
    for (const c of this.sh.classes(F.side)) if (c.company && !c.hero && c.company.str('Company_Transport_Unit')) return c.company.name;
    return this.anyTransportCompany(F.side) || (e && e.company ? e.company.name : '');
  }

  anyTransportCompany(side) {
    const w = this.sh.world,
      faction = this.sh.game.factions[side];
    for (const u of w.units) {
      if (u.dead || !u.structure || !w.ally(u.side, side)) continue;
      for (const t of buildsFor(u.type, faction, w.campaign)) if (t.str('Company_Transport_Unit') && !isHeroCompany(t)) return t.name;
    }
    return '';
  }

  stood(F, sid) {
    F.stood.add(sid);
    if (this.room && this.room.key === F.key && this.room.bay) this.room.bay.leave(sid);
    const N = this.sh.game.shooterNet;
    if (N && N.peers?.size) N.events.push(['stand', F.key, sid]);
  }

  exit(u, t, face, i, local = null) {
    const w = this.sh.world;
    if (!t.exitR) {
      _box.setFromObject(t.holder);
      t.exitR = Math.max(10, Math.min(90, Math.max(_box.max.x - _box.min.x, _box.max.y - _box.min.y) * 0.55));
      this.space = Math.max(this.space || 0, t.exitR * 2.6);
    }
    const c = Math.cos(face),
      s = Math.sin(face);
    let x, y;
    if (local) {
      const ox = t.roomX ?? t.x,
        oy = t.roomY ?? t.y;
      x = ox + c * local.x - s * local.y;
      y = oy + s * local.x + c * local.y;
    } else {
      const R = t.exitR + (u.foot ? 6 : u.hitRadius || 10) + Math.floor(i / 3) * 10,
        lat = ((i % 3) - 1) * 10;
      x = t.x + c * R - s * lat;
      y = t.y + s * R + c * lat;
    }
    const cellX = Math.round(x / CELL),
      cellY = Math.round(y / CELL),
      open = w.nearestOpen(x, y, u.foot ? 1 : 3),
      sameCell = open && cellX * CELL === open.x && cellY * CELL === open.y,
      underOwnCraft = !!t.blockCells?.includes(cellY * w.n + cellX) && this.openBeneath(t, cellX, cellY),
      o = !open || sameCell || underOwnCraft ? { x, y } : open;
    u.x = o.x;
    u.y = o.y;
    u.z = heightAt(w.terrain, u.x, u.y) + (u.lift || 0) + (u.hoverZ || 0);
    u.heading = local && Number.isFinite(local.yaw) ? local.yaw + face : face;
    if (u.holder) {
      u.holder.position.set(u.x, u.y, u.z);
      u.holder.rotation.z = u.heading + Math.PI / 2;
    }
  }

  openBeneath(t, cellX, cellY) {
    const w = this.sh.world,
      cell = cellY * w.n + cellX,
      owners = w.occ?.get(cell) || [];
    let kind = w.baseKind?.[cell] ?? 0;
    for (let j = 0; j < owners.length; j += 2) if (owners[j] !== t.blockCells) kind |= owners[j + 1];
    return !(kind & (TERRAIN.STEEP | TERRAIN.OBSTACLE | TERRAIN.REBELWALL | TERRAIN.EMPIREWALL | TERRAIN.WATER | TERRAIN.IMPASSABLE));
  }

  riderOut(F, e, local) {
    const u = F.inside.get(e),
      t = F.t;
    if (!u || !t) return;
    F.inside.delete(e);
    u.inside = null;
    u.boarding = false;
    if (t.roomX === undefined && t.inst) {
      t.holder.updateMatrixWorld(true);
      const c = this.centroid(t, _c);
      t.roomX = c.x;
      t.roomY = c.y;
    }
    this.exit(u, t, F.face, 0, local || bayExit(F.H, 1));
    if (u.holder) u.holder.visible = !u.scriptHidden;
    F.pos.delete(e.sid);
    this.out(e, u);
  }

  remotePos(peer, m) {
    const F = this.flights.get(+m.key);
    if (!F) return;
    const e = F.load.find(x => x.who === peer);
    if (!e) return;
    const p = { x: +m.x || 0, y: +m.y || 0, h: +m.h || 0, m: !!m.m };
    F.pos.set(e.sid, p);
    const N = this.sh.game.shooterNet;
    for (const o of F.load) if (o.who !== 'bot' && o.who !== 'me' && o.who !== peer) N?.session?.send(o.who, { k: 'sh-rp', key: F.key, id: e.sid, ...p });
    if (m.out && F.inside.has(e)) this.riderOut(F, e, { x: p.x, y: p.y, yaw: p.h });
  }

  startRoom(F) {
    if (this.room) this.endRoom();
    this.room = { key: F.key, F, V: null, bay: null, K: null, sendAt: 0, exited: false };
    this.sh.panel.style.display = 'none';
    this.sh.lock?.();
  }

  rideFor(key, rid) {
    this.rideKey = key;
    if (rid) this.rideId = rid;
    this.clientWait = 0;
    if (this.room && this.room.key === key) return;
    if (this.room) this.endRoom();
    this.room = { key, F: null, V: null, bay: null, K: null, sendAt: 0, exited: false };
    this.sh.panel.style.display = 'none';
    this.sh.lock?.();
  }

  endRoom() {
    const R = this.room;
    if (!R) return;
    this.room = null;
    this.rideKey = 0;
    const craft = R.F ? R.F.t : R.V;
    if (craft && craft.holder) {
      const at = R.bay ? R.bay.group.position : craft.holder.position;
      this.hideCraft = { craft, x: at.x, y: at.y, r: R.bay ? R.bay.L * 1.4 : 120, until: this.sh.world.time + 20 };
      craft.holder.visible = false;
    }
    if (R.bay) R.bay.dispose();
  }

  riding() {
    return !!this.room;
  }

  inRoom() {
    return !!this.room;
  }

  craftOf(R) {
    if (R.F) return R.F.t && R.F.t.inst ? R.F.t : null;
    const V = this.visuals.get(R.key);
    R.V = V && V.ready ? V : null;
    return R.V;
  }

  centroid(craft, out) {
    out.set(0, 0, 0);
    const bones = craft.inst.bones;
    for (const b of bones) out.add(b.getWorldPosition(_p));
    return out.multiplyScalar(1 / Math.max(1, bones.length));
  }

  landedOffset(craft) {
    const clip = craft.anim?.anim || craft.landClip;
    if (!clip) return 13;
    const S = new AnimState(craft.inst, clip, {});
    S.seek(0.9999);
    S.pose();
    craft.holder.updateMatrixWorld(true);
    const c = this.centroid(craft, _c),
      k = c.z - heightAt(this.sh.world.terrain, c.x, c.y);
    if (craft.anim) craft.anim.pose();
    craft.holder.updateMatrixWorld(true);
    return Math.max(0, k);
  }

  roomFrame(cam, real, input) {
    const R = this.room,
      sh = this.sh,
      w = sh.world;
    if (!R) return false;
    if (R.F && (R.F.gone || (R.F.t && R.F.t.craft?.dead))) {
      this.endRoom();
      sh.boardFailed(true);
      return false;
    }
    const craft = this.craftOf(R);
    if (!craft) return true;
    if (!R.bay) {
      const own = R.F ? R.F.load.find(e => e.who === 'me') : null,
        cls = own?.unit || (sh.pick && sh.pick.unit);
      R.bay = new TroopBay(w, R.F ? R.F.side : sh.me, R.F?.H || R.V?.H || this.heightOf(this.seatType(cls)));
      R.K = this.landedOffset(craft);
      R.face = R.F ? R.F.face : craft.heading;
      sh.yaw = R.face + Math.PI;
      sh.pitch = -0.05;
    }
    craft.holder.visible = false;
    craft.holder.updateMatrixWorld(true);
    const c = this.smooth(R, this.centroid(craft, _c)),
      bay = R.bay,
      ground = heightAt(w.terrain, c.x, c.y),
      landed = R.F ? !!R.F.t && R.F.t.stage !== 'land' : craft.stage !== 'land',
      top = this.groundTop(c, R.face, bay),
      floor = landed ? top : Math.max(top, c.z - R.K),
      vz = landed ? 0 : R.tv.z;
    if (landed && R.F && R.F.t.roomX === undefined) {
      R.F.t.roomX = c.x;
      R.F.t.roomY = c.y;
    }
    const tilt = landed ? 0 : Math.max(-0.08, Math.min(0.08, vz / -6000)),
      shake = landed ? 0 : Math.min(1, Math.abs(vz) / 300) * ROOM.shake;
    bay.place(_p.set(c.x, c.y, 0), R.face, floor, tilt, Math.sin(performance.now() / 700) * shake * 2);
    bay.rampOpen = landed;
    {
      const end = bay.toWorld(bay.L / 2 + bay.rampLen, 0, 0, _p),
        drop = floor - heightAt(w.terrain, end.x, end.y);
      bay.rampTilt = Math.max(0, Math.min(0.6, Math.asin(Math.max(-1, Math.min(1, drop / bay.rampLen)))));
    }
    this.syncSeats(R);
    if (landed && R.landAt === undefined) {
      R.landAt = performance.now() / 1000;
      const list = R.F ? R.F.load.map(e => [e.sid, '', e.who === 'bot' ? 0 : 1]) : R.V?.seats || [];
      list
        .filter(x => !x[2])
        .forEach(([sid], i) => bay.walkOut(sid, R.landAt + WAVE.ramp + WAVE.walk + i * WAVE.unload, i));
    }
    bay.me.yaw = sh.yaw - R.face;
    bay.me.pitch = sh.pitch;
    const res = bay.step(real, R.exited ? null : input);
    if (res && res.out && landed && !R.exited) this.leaveRoom(R);
    if (!this.room) return false;
    const eye = bay.eyeWorld(_p);
    if (shake) {
      const t = performance.now() / 1000,
        a = shake * bay.H * 3;
      eye.x += Math.sin(t * 21) * a;
      eye.y += Math.sin(t * 17 + 1.3) * a;
      eye.z += Math.sin(t * 25 + 2.1) * a;
    }
    cam.position.copy(eye);
    cam.up.set(0, 0, 1);
    const cp = Math.cos(sh.pitch);
    cam.lookAt(eye.x + Math.cos(sh.yaw) * cp, eye.y + Math.sin(sh.yaw) * cp, eye.z + Math.sin(sh.pitch));
    sh.setFov(cam, ROOM.fov, 5);
    const v = sh.game.view;
    v.x = c.x;
    v.y = c.y;
    if (w.time >= (R.screenAt || 0)) {
      R.screenAt = w.time + 0.25;
      const lz = R.F ? R.F.o : { x: craft.x, y: craft.y },
        n = R.F ? R.F.load.length : (R.V?.seats || []).length,
        launch = this.netLaunch(R);
      bay.screen(
        landed
          ? ['RAMP DOWN', 'GO GO GO', `TROOPS ${n}`]
          : launch > 0
            ? ['STANDBY', `LAUNCH IN ${launch}`, `TROOPS ${n} / ${WAVE.cap}`]
            : ['DESCENT', `ALT ${Math.max(0, Math.round((floor - ground) / 4))}`, `LZ ${Math.round(Math.hypot(lz.x - c.x, lz.y - c.y) / 4)}`]
      );
    }
    this.sendPos(R);
    return true;
  }

  smooth(R, c) {
    const now = performance.now() / 1000;
    if (!R.tc) {
      R.tc = c.clone();
      R.tv = new THREE.Vector3();
      R.tt = now;
    } else if (R.tc.distanceToSquared(c) > 1e-6) {
      const dt = Math.max(1 / 240, now - R.tt);
      R.tv.copy(c).sub(R.tc).multiplyScalar(1 / dt);
      if (R.tv.lengthSq() > 4e6) R.tv.setLength(2000);
      R.tc.copy(c);
      R.tt = now;
    } else if (now - R.tt > 0.15) R.tv.set(0, 0, 0);
    return c.copy(R.tc).addScaledVector(R.tv, Math.min(now - R.tt, 1 / 20));
  }

  groundTop(c, face, bay) {
    const ter = this.sh.world.terrain,
      co = Math.cos(face),
      si = Math.sin(face),
      hx = bay.L / 2,
      hy = bay.W / 2;
    let top = -Infinity;
    for (const [lx, ly] of [
      [0, 0],
      [hx, hy],
      [hx, -hy],
      [-hx, hy],
      [-hx, -hy],
      [hx, 0],
      [-hx, 0],
      [0, hy],
      [0, -hy]
    ])
      top = Math.max(top, heightAt(ter, c.x + co * lx - si * ly, c.y + si * lx + co * ly));
    return top + 0.3;
  }

  shield() {
    const H = this.hideCraft,
      b = this.sh.body;
    if (!H) return;
    const gone = !H.craft.holder || H.craft.gone || H.craft.craft?.gone;
    const clear = !!b && !b.dead && this.sh.state === 'alive' && Math.hypot(b.x - H.x, b.y - H.y) > H.r;
    if (gone || clear || this.sh.world.time > H.until) {
      if (H.craft.holder && !this.room) H.craft.holder.visible = true;
      this.hideCraft = null;
    } else H.craft.holder.visible = false;
  }

  netLaunch(R) {
    if (R.F) {
      const t = R.F.t;
      return t && t.stage === 'land' && t.hold > 0 ? Math.ceil(t.hold) : 0;
    }
    const V = R.V;
    return V && V.hold > 0 ? Math.ceil(V.hold) : 0;
  }

  seatType(type) {
    if (!type || !this.sh.isDummy(type)) return type || null;
    return this.sh.realOf(type);
  }

  seatName(entry) {
    return this.seatType(entry.unit)?.name || '';
  }

  heightOf(t) {
    if (!t) return 12;
    const s = t.num ? t.num('Scale_Factor', 1) : 1;
    return Math.max(8, Math.min(24, 11 * s));
  }

  syncSeats(R) {
    const bay = R.bay,
      list = R.F ? R.F.load.map(e => [e.sid, this.seatName(e), e.who === 'bot' ? 0 : 1]) : R.V?.seats || [],
      stood = R.F ? R.F.stood : (R.V.stood ||= new Set()),
      want = new Set(),
      mine = R.F ? 'h' : this.rideId;
    for (const [sid, name, human] of list) {
      if (sid === mine) continue;
      want.add(sid);
      if (!name) continue;
      if (human) {
        if (!bay.avatars.has(sid)) bay.avatar(sid, name);
        const p = R.F ? R.F.pos.get(sid) : R.V?.pos?.get(sid);
        if (p) bay.moveAvatar(sid, p.x, p.y, p.h, p.m);
      } else if (!bay.sitters.has(sid) && !stood.has(sid) && !bay.left.has(sid)) bay.sit(sid, name, String(R.key));
    }
    for (const sid of [...bay.avatars.keys()]) if (!want.has(sid)) bay.dropAvatar(sid);
  }

  sendPos(R) {
    const sh = this.sh,
      w = sh.world,
      N = sh.game.shooterNet,
      bay = R.bay;
    if (!N || !N.session || w.time < R.sendAt) return;
    R.sendAt = w.time + ROOM.send;
    const me = bay.me,
      p = { x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, h: Math.round(me.yaw * 100) / 100, m: me.moving ? 1 : 0 };
    if (R.F) {
      for (const e of R.F.load) if (e.who !== 'bot' && e.who !== 'me') N.session.send(e.who, { k: 'sh-rp', key: R.F.key, id: 'h', ...p });
    } else N.session.send(0, { k: 'sh-rp', key: R.key, ...p });
  }

  leaveRoom(R) {
    const me = R.bay.me;
    if (R.F) {
      const e = R.F.load.find(x => x.who === 'me');
      if (!e || !R.F.inside.has(e)) return;
      R.exited = true;
      this.riderOut(R.F, e, { x: me.x, y: me.y, yaw: me.yaw });
    } else {
      R.exited = true;
      this.sh.game.shooterNet?.session?.send(0, { k: 'sh-rp', key: R.key, x: me.x, y: me.y, h: me.yaw, m: 0, out: 1 });
    }
  }

  pending(key) {
    let V = this.visuals.get(key);
    if (!V) this.visuals.set(key, (V = { key, ready: false, gone: false, seats: [], pos: new Map(), stood: new Set(), stage: 'land', hold: 0 }));
    return V;
  }

  netSeats(key, list) {
    this.pending(key).seats = Array.isArray(list) ? list : [];
  }

  netStand(key, sid) {
    const V = this.pending(key);
    V.stood.add(sid);
    const R = this.room;
    if (R && R.key === key && R.bay) R.bay.leave(sid);
  }

  netPos(m) {
    const V = this.visuals.get(+m.key);
    if (V) V.pos.set(String(m.id), { x: +m.x || 0, y: +m.y || 0, h: +m.h || 0, m: !!m.m });
  }

  async visual(ev) {
    const [, key, side, comp, x, y, face, hold] = ev,
      w = this.sh.world,
      V = this.pending(key);
    if (V.ready || V.loading) return;
    Object.assign(V, { side, x, y, heading: face, hold: +hold || 0, stage: 'land', loading: true, ground: 0, H: +ev[8] || 12 });
    const L = await w.landingCraft(comp);
    if (!L || V.gone) {
      this.visuals.delete(key);
      return;
    }
    const holder = new THREE.Group();
    holder.add(L.inst.root);
    holder.position.set(x, y, heightAt(w.terrain, x, y));
    holder.rotation.z = face + Math.PI / 2;
    holder.scale.setScalar(L.scale);
    holder.userData.casts = true;
    w.scene.add(holder);
    Object.assign(V, { holder, inst: L.inst, off: L.off, landClip: L.land, anim: L.land ? new AnimState(L.inst, L.land, {}) : null, ready: true });
    if (V.anim) V.anim.pose();
  }

  stepVisuals(dt) {
    this.shield();
    for (const [key, V] of this.visuals) {
      if (!V.ready) continue;
      if (V.hold > 0) {
        V.hold -= dt;
        continue;
      }
      const running = V.anim ? V.anim.step(dt) : false,
        mine = this.room && this.room.key === key && !this.room.exited;
      if (V.stage === 'land' && !running) {
        V.stage = 'unload';
        V.ground = WAVE.ramp + WAVE.walk + Math.max(1, V.seats.length) * WAVE.unload + WAVE.linger;
      } else if (V.stage === 'unload' && !mine && (V.ground -= dt) <= 0) {
        V.stage = 'leave';
        V.anim = V.off ? new AnimState(V.inst, V.off, {}) : null;
      } else if (V.stage === 'leave' && !running) {
        this.sh.world.scene.remove(V.holder);
        V.gone = true;
        this.visuals.delete(key);
        if (this.room && this.room.key === key) this.endRoom();
      }
    }
  }

  dispose() {
    this.endRoom();
    for (const V of this.visuals.values()) if (V.holder) this.sh.world.scene.remove(V.holder);
    this.visuals.clear();
  }
}
