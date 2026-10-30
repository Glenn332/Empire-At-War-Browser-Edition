import { db } from '../gamedata.js';
import { orderMove } from './fleets.js';
import { embarkGround, planetAllowsCompany } from './invasion.js';
import { factionRelated } from './galacticforces.js';
import { aidebug as D, who, nameOf } from '../aidebug.js';

const key = x => String(x || '').toUpperCase(),
  INF = 0xffffffff;

export class GalacticFreeStore {
  constructor(ai, controller, name) {
    this.ai = ai;
    this.c = controller;
    this.name = name;
    this.state = 'new';
    this.inst = null;
    this.entries = new Set();
    this.statuses = [];
    this.lastService = null;
    this.lastUnitService = null;
    this.serviceQueue = null;
    this.serviceAt = 0;
  }
  get game() {
    return this.ai.game;
  }
  get galaxy() {
    return this.ai.game.galaxy;
  }
  get plans() {
    return this.ai.plans;
  }
  get host() {
    return this.ai.game.story;
  }
  get owner() {
    return this.c.player.faction;
  }
  get vm() {
    return this.host.vm;
  }

  start() {
    const src = this.host.source(this.name);
    if (src === undefined) return false;
    if (typeof src !== 'string') {
      this.state = 'over';
      return false;
    }
    const P = this.plans,
      inst = this.makeInstance();
    try {
      P.withInstance(inst, () => {
        const vm = this.vm,
          error = vm.run(src, this.name, inst.env);
        if (error) throw new Error(error);
        vm.set(inst.env, 'PlayerObject', this.host.player(this.owner));
        vm.set(inst.env, 'FreeStore', this.wrapper());
        const d = vm.call(inst.env, 'Base_Definitions');
        if (!d.ok && !d.missing) throw new Error(d.error);
        vm.set(inst.env, 'PlayerObject', this.host.player(this.owner));
        vm.set(inst.env, 'FreeStore', this.wrapper());
        inst.thread = vm.thread(inst.env, 'main');
      });
      this.state = 'run';
      return true;
    } catch (error) {
      this.dispose();
      if (String(error.message).includes('@@need')) {
        this.state = 'new';
        return false;
      }
      this.ai.errors.set('FreeStore ' + this.name, error.message);
      this.state = 'over';
      return false;
    }
  }

  makeInstance() {
    const P = this.plans,
      inst = P.instance('FreeStore ' + this.name);
    inst.ai = this.c;
    inst.freeStore = this;
    inst.env = P.environment(inst);
    this.inst = inst;
    const host = this.host,
      object = host.persist?.refValue(inst.env).value,
      info = object && this.vm.envInfo.get(object);
    if (object && host.envOwners) {
      host.envOwners.set(object, { kind: 'fsenv', i: key(this.owner) });
      if (info) host.envOwners.set(info.loaded, { kind: 'fsloaded', i: key(this.owner) });
    }
    return inst;
  }

  save(s, rec) {
    const persist = this.host.persist,
      inst = this.inst;
    return {
      faction: this.owner,
      name: this.name,
      env: s.enc(persist.refValue(inst.env)),
      thread: inst.thread ? s.enc({ type: 8, value: inst.thread.co }) : null,
      values: s.js(inst.values),
      entries: [...this.entries].map(rec).filter(Boolean),
      moves: this.statuses
        .filter(m => !m.done)
        .map(m => ({ rec: rec(m.record), dest: m.dest.index }))
        .filter(m => m.rec),
      lastService: this.lastService,
      lastUnitService: this.lastUnitService,
      serviceQueue: this.serviceQueue ? this.serviceQueue.slice(this.serviceAt).map(rec).filter(Boolean) : null
    };
  }
  prepare() {
    this.makeInstance();
  }
  finish(d, restored, place) {
    const persist = this.host.persist,
      inst = this.inst;
    if (d.thread) {
      const tv = restored.value(d.thread);
      inst.thread = { co: tv.value, ref: persist.newRef(tv) };
    }
    inst.values = restored.js(d.values) || new Map();
    const list = l => (l || []).map(place).filter(r => r && !r.dead);
    this.entries = new Set(list(d.entries));
    this.statuses = [];
    for (const m of d.moves || []) {
      const record = place(m.rec),
        fleet = record && this.galaxy.fleets.find(f => f.units.includes(record)),
        dest = this.galaxy.planets[m.dest];
      if (fleet && dest) this.statuses.push({ record, fleet, dest, done: false });
    }
    this.lastService = d.lastService ?? null;
    this.lastUnitService = d.lastUnitService ?? null;
    this.serviceQueue = d.serviceQueue ? list(d.serviceQueue) : null;
    this.serviceAt = 0;
    this.state = 'run';
  }

  dispose() {
    if (this.inst?.env != null) {
      try {
        this.vm.free(this.inst.env);
      } catch {}
    }
    this.inst = null;
  }

  update() {
    if (this.state === 'new' && !this.start()) return;
    if (this.state !== 'run') return;
    const now = this.galaxy.time;
    this.scan();
    this.stepMoves();
    for (const record of [...this.entries]) this.autoLand(record);
    const vm = this.vm,
      env = this.inst.env,
      rate = vm.read(env, 'ServiceRate');
    if (typeof rate === 'number' && (this.lastService === null || now - this.lastService > rate) && this.inst.thread) {
      this.lastService = now;
      this.plans.withInstance(this.inst, () => {
        const r = vm.resume(this.inst.thread);
        if (r.error) {
          this.ai.errors.set('FreeStore ' + this.name, r.error);
          this.inst.thread = null;
        } else if (r.done) this.inst.thread = null;
      });
    }
    const unitRate = vm.read(env, 'UnitServiceRate');
    if (typeof unitRate === 'number' && (this.lastUnitService === null || now - this.lastUnitService > unitRate)) {
      this.lastUnitService = now;
      this.serviceQueue = [...this.entries];
      this.serviceAt = 0;
    }
    const queue = this.serviceQueue;
    while (queue && this.serviceAt < queue.length) {
      const record = queue[this.serviceAt];
      if (!this.entries.has(record)) {
        this.serviceAt++;
        continue;
      }
      if (!this.ai.freeStoreTurn()) break;
      this.serviceAt++;
      const r = this.call('On_Unit_Service', record);
      if (r && !r.ok && !r.missing) {
        this.ai.errors.set('FreeStore ' + this.name + '.On_Unit_Service', r.error);
        this.serviceQueue = null;
        break;
      }
    }
    if (this.serviceQueue && this.serviceAt >= this.serviceQueue.length) this.serviceQueue = null;
  }

  call(fn, record) {
    const object = this.object(record);
    if (!object) return null;
    return this.plans.withInstance(this.inst, () => this.vm.call(this.inst.env, fn, object));
  }
  where(record) {
    this.plans.refreshLocations();
    return this.plans.locations.get(record) || null;
  }
  object(record) {
    const at = this.where(record);
    return at ? this.host.object(record, at.planet || undefined, at.owner) : null;
  }
  record(o) {
    const object = o?.__object;
    return object ? object.record || object : null;
  }
  allied(other) {
    return factionRelated(this.owner, other, true);
  }
  isTransport(record, at = this.where(record)) {
    return !!at && (at.fleet ? !!record.carries : true);
  }

  scan() {
    const P = this.plans,
      seen = new Set(),
      arrived = [];
    for (const at of P.ownedLocations(this.owner)) {
      const record = at.record;
      if (
        at.owner !== this.owner ||
        record.dead ||
        P.reservations.has(record) ||
        this.host.object(record, at.planet || undefined, at.owner).__object.noAI
      )
        continue;
      seen.add(record);
      if (!this.entries.has(record) && at.planet && !at.fleet?.leg) arrived.push(record);
    }
    for (const record of [...this.entries]) if (!seen.has(record)) this.entries.delete(record);
    this.statuses = this.statuses.filter(s => seen.has(s.record));
    for (const record of arrived) {
      if (!this.ai.freeStoreTurn()) break;
      this.add(record);
    }
  }
  add(record) {
    if (this.entries.has(record) || record.dead || this.plans.reservations.has(record)) return;
    this.entries.add(record);
    const r = this.call('On_Unit_Added', record);
    if (r && !r.ok && !r.missing) this.ai.errors.set('FreeStore ' + this.name + '.On_Unit_Added', r.error);
  }

  inTransit(record) {
    const at = this.where(record);
    if (!at || !at.planet) return true;
    if (at.fleet && (at.fleet.leg || at.fleet.path?.length)) return true;
    return this.statuses.some(s => s.record === record && !s.done);
  }
  landable(p) {
    return !!p && !p.destroyed && p.type.bool('Planet_Surface_Accessible', true);
  }
  room(p) {
    return p.garrison.length < db.constants.num('Max_Ground_Forces_On_Planet', 10);
  }
  isSafe(record) {
    const at = this.where(record);
    if (!at || !at.fleet || !record.carries || !at.planet) return true;
    const p = at.planet;
    if (this.allied(p.owner) && this.room(p) && this.landable(p))
      return p.garrison.some(u => !this.allied(u.owner)) ? this.inTransit(record) : true;
    return this.inTransit(record);
  }

  moveObject(o, dest) {
    const record = this.record(o),
      to = dest?.__planet || dest?.__object?.planet || dest?.__object;
    if (!record || !this.entries.has(record) || !to || to.index === undefined) return false;
    if (this.game.paused || this.game.battle) return false;
    const g = this.galaxy,
      at = this.where(record),
      from = at?.planet;
    if (from && from.restricted) return false;
    if (this.inTransit(record)) return false;
    if (from === to) return true;
    let fleet = at.fleet;
    if (!fleet) {
      if (this.plans.blockaded(this.owner, from)) return false;
      fleet = embarkGround(g, from.index, this.owner, { records: [record], fresh: true });
      if (!fleet) return false;
      this.game.fleetView?.(fleet)?.catch?.(() => {});
    } else if (fleet.units.length > 1) {
      fleet.units = fleet.units.filter(u => u !== record);
      fleet = { owner: this.owner, units: [record], planet: from.index, pos: null, path: [], dest: -1, leg: null };
      g.fleets.push(fleet);
      this.game.fleetView?.(fleet)?.catch?.(() => {});
    }
    this.plans.locationTime = -Infinity;
    const status = { record, fleet, dest: to, done: false };
    this.statuses.push(status);
    this.hop(status);
    this.plans.tally('moves');
    if (D.on) D.log('move', 'G', g.time, who(this.c), nameOf(record) + ' from ' + (from ? from.name : '?') + ' to ' + to.name, 'freestore');
    return true;
  }
  hop(s) {
    const g = this.galaxy,
      f = s.fleet;
    if (!g.fleets.includes(f) || !f.units.includes(s.record) || this.plans.reservations.has(s.record)) {
      s.done = true;
      return;
    }
    if (f.leg || f.path?.length) return;
    const at = g.planets[f.planet];
    if (!at || at === s.dest) {
      s.done = true;
      return;
    }
    const m = this.plans.network.matrix(this.c),
      cost = m.cost[at.index * m.n + s.dest.index];
    if (cost === INF || cost >>> 16 > 0) {
      s.done = true;
      return;
    }
    const next = this.plans.network.path(this.owner, at, s.dest)[1];
    const controller = next && this.orbitController(next);
    if (!next || (controller && controller !== this.owner) || !orderMove(g, f, next.index, p => p === next)) {
      s.done = true;
      return;
    }
    this.plans.locationTime = -Infinity;
  }
  orbitController(p) {
    if (p.station && (p.spaceLevel || 0) > 0) return p.stationOwner || p.owner;
    const here = this.galaxy.fleets.filter(f => f.planet === p.index && f.units.length);
    return (here.find(f => !f.leg) || here[0])?.owner || null;
  }
  stepMoves() {
    for (const s of this.statuses) if (!s.done) this.hop(s);
    this.statuses = this.statuses.filter(s => !s.done);
  }
  autoLand(record) {
    const at = this.where(record);
    if (!at?.fleet || !record.carries || !at.planet || this.game.paused) return;
    if (this.inTransit(record) || !this.isSafe(record)) return;
    const p = at.planet;
    if (!this.room(p) || !this.landable(p) || !planetAllowsCompany(p, record.carries)) return;
    const fleet = at.fleet;
    fleet.units = fleet.units.filter(u => u !== record);
    record.type = record.carries;
    record.carries = null;
    record.owner = this.owner;
    p.garrison.push(record);
    if (!fleet.units.length) this.galaxy.fleets = this.galaxy.fleets.filter(f => f !== fleet);
    this.plans.locationTime = -Infinity;
  }

  wrapper() {
    if (this.fsWrapper) return this.fsWrapper;
    return (this.fsWrapper = {
      __wrap: true,
      __name: 'FreeStore',
      __freeStore: this,
      Get_Name: () => this.name,
      Get_Object_Count: space => {
        if (space !== true && space !== false) return this.entries.size;
        let n = 0;
        for (const r of this.entries) if (this.isTransport(r) !== space) n++;
        return n;
      },
      Is_Object_On_Free_Store: o => this.entries.has(this.record(o)),
      Is_Unit_In_Transit: o => {
        const r = this.record(o);
        return !!r && this.entries.has(r) && this.inTransit(r);
      },
      Is_Unit_Safe: o => {
        const r = this.record(o);
        return !!r && this.entries.has(r) && this.isSafe(r);
      },
      Move_Object: (o, dest) => this.moveObject(o, dest),
      __missing: this.host.absent('FreeStore')
    });
  }
}
