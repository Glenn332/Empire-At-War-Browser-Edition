import * as THREE from '../../vendor/three/build/three.module.js';
import { db } from '../gamedata.js';
import { buildListFor } from './sim.js';
import { UNIT, SHOT, POINT, ABILITY } from './spacerecord.js';
import { battleSnapshot } from './spaceprobe.js';
import { TURN } from './netgame.js';
import { pageOverlay } from '../vfs.js';

const TICK = 1 / 30,
  LAG = 1.5 * TICK,
  LAG_MAX = 6 * TICK;

export class SpaceMirror {
  static headless(game) {
    const m = Object.create(SpaceMirror.prototype);
    m.init(game);
    m.ready = true;
    return m;
  }

  init(game) {
    this.game = game;
    this.world = game.world;
    this.byW = new Map();
    this.toW = new WeakMap();
    this.shots = new Map();
    this.queue = [];
    this.ready = false;
    this.lastAt = 0;
    this.stats = { records: 0, applyMs: 0, events: 0, failed: 0, stepMs: 0 };
    this.jobWorkers = [];
    this.held = new Set();
    this.pending = [];
    this.inFlight = false;
  }

  constructor(game, loaded = null) {
    this.init(game);
    const w = this.world;
    const start = battleSnapshot(game, loaded && loaded.save, loaded && loaded.refs);
    this.saves = new Map();
    this.pace = '';
    const page = new Map();
    for (const q of w.squads) {
      page.set(q.id, q);
      for (const f of q.fighters) page.set(f.id, f);
    }
    for (const u of w.units) page.set(u.id, u);
    this.worker = new Worker(new URL('./spacebattleworker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = e => {
      const m = e.data;
      if (m.k === 'ready') {
        for (const [wid, pid] of m.ids) {
          const x = page.get(pid);
          if (x) this.match(wid, x);
        }
        this.ready = true;
        this.setupMs = m.ms;
        this.scriptsFrom = m.scriptsFrom;
        this.onReady();
      } else if (m.k === 'step') {
        this.queue.push(m);
        if (game.lock) this.lockStepped(m);
      } else if (m.k === 'saved') {
        const s = this.saves.get(m.id);
        this.saves.delete(m.id);
        if (s) {
          if (m.save) s.res(m.save);
          else s.rej(new Error(m.error));
        }
      } else if (m.k === 'result') game.commandResult(m.cmd, { why: m.why });
      else if (m.k === 'vfs') this.answerFile(m);
      else if (m.k === 'spawnJobs') {
        for (let i = 0; i < m.n; i++) {
          const wk = new Worker(new URL('./jobworker.js', import.meta.url), { type: 'module' });
          wk.onerror = e => console.error('job worker', e.message);
          wk.postMessage({ sh: m.sh, slot: i });
          this.jobWorkers.push(wk);
        }
      } else if (m.ok === false) console.error('space worker:', m.error);
    };
    this.worker.onerror = e => console.error('space worker', e.message);
    this.worker.postMessage({
      ...start,
      k: 'run',
      base: new URL('.', location.href).href,
      nojobs: new URLSearchParams(location.search).has('nojobs')
    });
    this.whenReady = new Promise(res => {
      this.onReady = res;
    });
    game.execute = (pid, cmd) => {
      this.pending.push([pid, this.ours(cmd)]);
      return {};
    };
    game.hashState = () => {
      this.wantHash = true;
      return undefined;
    };
    game.takeOver = p => {
      p.human = false;
      return true;
    };
  }

  async answerFile(m) {
    let result;
    try {
      const o = await pageOverlay();
      if (m.op === 'meta') result = o ? { names: o.names, whole: !!o.whole } : null;
      else if (o) result = await o[m.op](...m.args);
    } catch (e) {
      console.warn('space worker file', m.op, m.args && m.args[0], e);
    }
    if (result instanceof ArrayBuffer) result = result.slice(0);
    else if (ArrayBuffer.isView(result)) result = result.slice().buffer;
    this.worker.postMessage({ k: 'vfsr', id: m.id, result }, result instanceof ArrayBuffer ? [result] : []);
  }

  save(name = '') {
    const g = this.game,
      rig = g.renderer.rig,
      wid = e => this.toW.get(e);
    const view = {
      speed: g.speed,
      camera: { x: rig.x, y: rig.y, dist: rig.dist, yaw: rig.yaw, pitch: rig.pitch },
      groups: [...(g.ui?.groups || [])].map(([n, list]) => [n, list.map(wid).filter(x => x !== undefined)]),
      selection: (g.ui?.selection || []).map(wid).filter(x => x !== undefined)
    };
    const id = (this.saveIds = (this.saveIds || 0) + 1);
    return new Promise((res, rej) => {
      this.saves.set(id, { res, rej });
      this.worker.postMessage({ k: 'save', id, name, view });
    });
  }

  match(wid, x) {
    this.byW.set(wid, x);
    this.toW.set(x, wid);
  }

  command(cmd) {
    this.worker.postMessage({ k: 'cmd', cmd: this.ours(cmd) });
  }

  ours(cmd) {
    const page = new Map();
    for (const u of this.world.units) page.set(u.id, u);
    for (const q of this.world.squads) {
      page.set(q.id, q);
      for (const f of q.fighters) page.set(f.id, f);
    }
    const wid = id => {
      const x = id ? page.get(id) : null,
        w = x && this.toW.get(x);
      return w === undefined ? 0 : w;
    };
    const out = { ...cmd };
    if (Array.isArray(cmd.u)) out.u = cmd.u.map(wid).filter(Boolean);
    if (cmd.t) out.t = wid(cmd.t);
    if (cmd.b) out.b = wid(cmd.b);
    if (Array.isArray(cmd.p)) out.p = cmd.p.map(([id, ...rest]) => [wid(id), ...rest]).filter(([id]) => id);
    return out;
  }

  hardpointLost(unit, hp) {
    hp.alive = false;
    hp.health = 0;
    for (const px of unit.proxies)
      if (px.hp === hp && !px.on) {
        px.on = true;
        unit.pendingProxies.push(px);
      }
    if (hp.part) hp.part.visible = false;
    if (hp.decal) hp.decal.visible = true;
    hp.smoke = !unit.proxies.some(px => px.hp === hp);
  }

  frame(real = 0) {
    const g = this.game;
    if (!this.ready) return;
    if (g.lock) this.lockFrame(real);
    else {
      const pace = (g.paused || g.tacticalMovies?.pausesMode ? 'p' : '') + g.speed;
      if (pace !== this.pace) {
        this.pace = pace;
        this.worker.postMessage({ k: 'pace', speed: g.speed, paused: pace[0] === 'p' });
      }
      this.playback(real, pace[0] === 'p' ? 0 : g.speed);
      return;
    }
    if (this.queue.length) {
      const t = performance.now();
      for (const m of this.queue.splice(0)) {
        g.settle();
        this.apply(m);
        g.remember();
      }
      this.lastAt = performance.now();
      this.stats.applyMs += this.lastAt - t;
    }
    g.present(Math.min(1, (performance.now() - this.lastAt) / (TICK * 1000)));
  }

  playback(real, rate) {
    const g = this.game,
      Q = this.queue;
    if (!Q.length && this.shown === undefined) return;
    const newest = Q.length ? Q[Q.length - 1].time : this.shown;
    if (this.clock === undefined) this.clock = Q[0].time - TICK;
    const lag = newest - this.clock;
    if (lag > LAG_MAX) this.clock = newest - LAG;
    else this.clock += real * rate * (1 + Math.max(-0.15, Math.min(0.15, (lag - LAG) / (8 * TICK))));
    if (Q.length && Q[0].time - TICK <= this.clock) {
      const t = performance.now();
      let n = 0;
      while (Q.length && Q[0].time - TICK <= this.clock) {
        const m = Q.shift();
        g.settle();
        this.apply(m);
        g.remember();
        this.shown = m.time;
        n++;
      }
      this.worker.postMessage({ k: 'seen', n });
      this.lastAt = performance.now();
      this.stats.applyMs += this.lastAt - t;
    }
    g.present(this.shown === undefined ? 0 : Math.max(0, Math.min(1, (this.clock - this.shown + TICK) / TICK)));
  }

  lockFrame(real) {
    const g = this.game,
      lock = g.lock,
      behind = lock.behind();
    if (g.paused) g.owed = 0;
    g.owed = Math.min((g.owed || 0) + (g.paused ? 0 : real * g.speed), (4 + behind * TURN) * TICK);
    if (behind > 1) g.owed = Math.max(g.owed, Math.min(behind, 3) * TICK);
    this.pump();
    lock.frame(g.owed / TICK, 1, this.inFlight ? 'the battle thread' : null, 0);
    if (lock.started && !g.paused && g.owed >= 2 * TICK) {
      if ((g.stalled = (g.stalled || 0) + real) > 2 && !g.stallSaid) {
        g.stallSaid = true;
        const who = lock.waitingFor();
        g.message(who.length ? `Waiting for ${who.join(', ')}…` : 'Waiting…', 'bad');
      }
    } else {
      g.stalled = 0;
      g.stallSaid = false;
    }
  }

  pump() {
    const g = this.game,
      lock = g.lock;
    if (this.inFlight || g.owed < TICK || g.paused) return;
    if (!lock.step() || g.paused) return;
    this.inFlight = true;
    g.owed -= TICK;
    this.worker.postMessage({ k: 'lockstep', cmds: this.pending.splice(0), hash: this.wantHash });
    this.wantHash = false;
  }

  lockStepped(m) {
    const lock = this.game.lock;
    if (m.hash !== undefined) {
      const n = Math.floor(lock.tick / TURN);
      lock.hashes.set(n, m.hash);
      if (lock.log.length && lock.log[lock.log.length - 1] === undefined) lock.log[lock.log.length - 1] = m.hash;
    }
    this.inFlight = false;
    lock.stepped();
    this.pump();
  }

  applyProps(m) {
    const w = this.world,
      player = id => (id < 0 ? w.neutral : w.players.find(p => p.id === id) || w.neutral),
      order = o =>
        o
          ? { kind: o[0], x: o[1] ?? undefined, y: o[2] ?? undefined, target: o[3] >= 0 ? this.byW.get(o[3]) || null : null }
          : { kind: 'idle' };
    for (const [wid, v] of m.props || []) {
      const e = this.byW.get(wid);
      if (!e || e.dead) continue;
      const pl = player(v[0]);
      if (e.isSquad) {
        e.player = pl;
        e.fighters = v[1].map(id => this.byW.get(id)).filter(f => f && !f.dead);
        e.order = order(v[2]);
        e.queue = v[3].length ? v[3].map(order) : undefined;
        e.mode = v[4] || undefined;
        e.about = v[5] ? { x: v[5][0], y: v[5][1], cell: !!v[5][2] } : undefined;
        e.target = v[6] >= 0 ? this.byW.get(v[6]) || null : null;
        continue;
      }
      if (e.player !== pl) {
        e.player = pl;
        if (!e.isPad && e.capture) {
          e.buildList = pl.id >= 0 ? buildListFor(e.type, pl.factionName) : [];
          e._lists = null;
        }
      }
      if (e.capture) {
        e.capture.progress = v[1];
        e.capture.by = v[2] >= 0 ? player(v[2]) : null;
      }
      if (v[3] > (e.lastHitTime ?? -100)) e.radarHit = 3;
      e.lastHitTime = v[3];
      e.inNebula = !!v[4];
      e.ionUntil = v[5];
      e.scriptHidden = !!v[6];
      if (v[7]) e.maxHealth = v[7];
      if (v[8] || e.maxShield) e.maxShield = v[8];
      e.order = order(v[9]);
      e.queue = v[10].length ? v[10].map(order) : undefined;
      const t = v[11] && this.byW.get(v[11][0]);
      e.targetHp = (t && t.hardpoints && t.hardpoints[v[11][1]]) || null;
    }
    (m.teams || []).forEach((id, i) => {
      const t = w.teams[i];
      if (t) t.station = id >= 0 ? this.byW.get(id) || t.station : null;
    });
    const st = m.state;
    if (st) {
      if (st[0] !== null) w.lastViewerCombat = st[0];
      w.reveals = st[1]
        .map(([ti, x, y, r, until]) => ({ team: w.teams[ti], x, y, r, until: until < 0 ? Infinity : until }))
        .filter(r => r.team);
      w.reveal = !!st[2];
      w.fogLifted = st[3];
      (st[4] || []).forEach(([firedAt, readyAt, left], i) => {
        const sw = w.specialWeapons && w.specialWeapons[i];
        if (!sw) return;
        sw.firedAt = firedAt;
        sw.readyAt = readyAt;
        sw.left = left;
      });
    }
  }

  apply(m) {
    const w = this.world,
      st = this.stats;
    st.records++;
    if (m.stepMs !== undefined) st.stepMs = m.stepMs;
    if (m.jobs) st.jobs = m.jobs;
    w.time = m.time;
    for (const s of m.spawns) {
      const ty = db.type(s.type),
        owner = s.player < 0 ? w.neutral : w.players.find(p => p.id === s.player);
      if (!ty || !owner || this.byW.has(s.wid)) continue;
      const en = w.spawn(ty, owner, s.x, s.y, s.heading);
      if (!en) continue;
      this.match(s.wid, en);
      if (en.isSquad && s.fighters)
        en.fighters.forEach((f, i) => {
          if (s.fighters[i] !== undefined) this.match(s.fighters[i], f);
        });
    }
    const fx = w.fx,
      audio = w.audio;
    for (const [to, name, args] of m.events) {
      const a = args.map(x => this.back(x)),
        target = to === 'fx' ? fx : to === 'audio' ? audio : to === 'game' ? this.game : to === 'world' ? w : a.shift(),
        f = target && target[name];
      if (typeof f !== 'function') continue;
      try {
        f.apply(target, a);
        st.events++;
      } catch {
        st.failed++;
      }
    }
    const U = m.units,
      seen = new Set();
    for (let o = 0; o < U.length; o += UNIT) {
      const e = this.byW.get(U[o]);
      if (!e) continue;
      seen.add(U[o]);
      const flags = U[o + 1];
      if (flags & 16) {
        e.x = U[o + 2];
        e.y = U[o + 3];
        e.heading = U[o + 5];
        e.hyper = flags & 4 ? U[o + 12] : 0;
        e.carrier = U[o + 14] >= 0 ? this.byW.get(U[o + 14]) || null : null;
        if (flags & 1) e.dead = true;
        continue;
      }
      if (flags & 1) {
        if (!e.dead) w.removeUnit(e);
        continue;
      }
      e.x = U[o + 2];
      e.y = U[o + 3];
      e.z = U[o + 4];
      e.heading = U[o + 5];
      e.roll = U[o + 6];
      e.pitch = U[o + 7];
      if (e.maxHealth) e.health = U[o + 8] * e.maxHealth;
      if (e.maxShield) e.shield = U[o + 9] * e.maxShield;
      e.speed = U[o + 10];
      e.shieldFlash = U[o + 11];
      if (flags & 4) {
        e.hyper ||= { f: 0, tx: e.x, ty: e.y, h: e.heading, shown: true };
        e.hyper.dark = U[o + 12];
        const shown = !(flags & 64);
        if (e.hyper.shown !== shown) {
          e.hyper.shown = shown;
          e.obj.scale.setScalar(shown ? e.scale || 1 : 1e-4);
          e.obj.updateMatrix();
        }
      } else if (e.hyper) {
        e.hyper = null;
        e.obj.scale.setScalar(e.scale || 1);
      }
      e.cloaked = !!(flags & 8);
      if (flags & 32) e.flip = true;
      e.seenBy = U[o + 13];
      e.target = U[o + 14] >= 0 ? this.byW.get(U[o + 14]) || null : null;
      e.aim = Number.isNaN(U[o + 15]) ? undefined : U[o + 15];
    }
    for (const [wid, e] of this.byW) {
      if (seen.has(wid)) continue;
      this.byW.delete(wid);
      if (e.dead) continue;
      if (e.isSquad) e.dead = true;
      else w.removeUnit(e);
    }
    const H = m.points;
    for (let o = 0; o < H.length; o += POINT) {
      const u = this.byW.get(H[o]),
        hp = u && !u.dead && u.hardpoints && u.hardpoints[H[o + 1]];
      if (!hp) continue;
      if (!H[o + 2] && hp.alive) this.hardpointLost(u, hp);
      hp.target = H[o + 3] >= 0 ? this.byW.get(H[o + 3]) || null : null;
      if (hp.maxHealth) hp.health = H[o + 4] * hp.maxHealth;
    }
    if (m.beams || w.beams.length)
      w.beams = (m.beams || []).flatMap(([a, b, color, width, bone, kind]) => {
        const from = this.byW.get(a),
          to = this.byW.get(b);
        return from && to ? [{ a: from, b: to, color, width, bone, kind, until: Infinity }] : [];
      });
    for (const [wid, child, a, b] of m.pads || []) {
      const e = this.byW.get(wid);
      if (!e || e.dead) continue;
      if (child === -4) {
        e.construction ||= { result: db.type(e.type.str('Tactical_Buildable_Constructed')) };
        e.construction.left = a;
        e.construction.total = b;
        continue;
      }
      const c = child >= 0 ? this.byW.get(child) || null : null;
      e.padChild = c;
      if (c) c.padOf = e;
      if (a !== -3) e.padOwner = a === -2 ? null : w.players.find(p => p.id === a) || null;
      if (e.obj) e.obj.visible = !c || !e.type.bool('Hides_When_Built_On', true);
    }
    const A = m.abilities;
    for (let o = 0; o < A.length; o += ABILITY) {
      const u = this.byW.get(A[o]),
        st = u && u.abilities && u.abilities[A[o + 1]];
      if (!st) continue;
      st.active = !!(A[o + 2] & 1);
      st.auto = !!(A[o + 2] & 2);
      st.timer = A[o + 3];
      st.cooldown = A[o + 4];
    }
    for (const [id, credits, pop, popCap, popExtra, called, upgrades, bought, stats, bounty, locked, unlocked] of m.players) {
      const p = w.players.find(x => x.id === id);
      if (!p) continue;
      p.credits = credits;
      p.pop = pop;
      p.popCap = popCap;
      p.popExtra = popExtra;
      if (p.mirrorCalled !== called) {
        p.mirrorCalled = called;
        p.reinforcements = called
          ? called
              .split('|')
              .map(n => db.type(n))
              .filter(Boolean)
          : [];
      }
      if (p.mirrorUpgrades !== upgrades) {
        p.mirrorUpgrades = upgrades;
        p.upgrades.clear();
        for (const n of upgrades ? upgrades.split('|') : []) p.upgrades.add(n);
      }
      if (p.mirrorBought !== bought) {
        p.mirrorBought = bought;
        p.everBought = new Map();
        for (const kv of bought ? bought.split('|') : []) {
          const i = kv.lastIndexOf('='),
            t = db.type(kv.slice(0, i));
          if (t) p.everBought.set(t, +kv.slice(i + 1));
        }
      }
      if (stats) Object.assign(p.stats, stats);
      p.bounty = bounty || 0;
      const types = l => new Set((l || []).map(n => db.type(n)).filter(Boolean));
      if (locked && (locked.length || p.lockedTech)) p.lockedTech = types(locked);
      if (unlocked && (unlocked.length || p.unlockedTech)) p.unlockedTech = types(unlocked);
    }
    this.applyProps(m);
    this.game.advisor?.update(TICK);
    const held = new Set();
    for (const [wid, qs] of m.queues) {
      const u = this.byW.get(wid);
      if (!u || u.dead || !u.buildQueues) continue;
      held.add(u);
      const names = new Set();
      for (const [k, items] of qs) {
        names.add(k);
        let q = u.buildQueues.get(k);
        if (!q) u.buildQueues.set(k, (q = []));
        q.length = Math.min(q.length, items.length);
        items.forEach(([type, total, left, pid], i) => {
          let it = q[i];
          if (!it || it.type.name !== type) {
            const ty = db.type(type);
            if (!ty) return;
            it = q[i] = { type: ty };
          }
          it.total = total;
          it.left = left;
          it.player = w.players.find(p => p.id === pid) || null;
        });
      }
      for (const k of [...u.buildQueues.keys()]) if (!names.has(k)) u.buildQueues.delete(k);
      w.holdQueues(u);
    }
    for (const u of this.held) if (!held.has(u) && u.buildQueues) u.buildQueues.clear();
    this.held = held;
    if (st.records % 30 === 0) {
      w.units = w.units.filter(u => !u.dead);
      w.squads = w.squads.filter(q => !q.dead);
    }
    for (const f of m.fresh) {
      const def = db.type(f.def);
      if (def)
        this.shots.set(f.id, {
          id: f.id,
          def,
          x: 0,
          y: 0,
          z: 0,
          vx: 0,
          vy: 0,
          vz: 1,
          speed: f.speed || 1,
          width: f.width,
          length: f.length,
          r: f.r,
          g: f.g,
          b: f.b,
          missile: f.missile,
          age: 0,
          hidden: false,
          fxs: null,
          fxSeen: 0
        });
    }
    const S = m.shots,
      now = [];
    for (let o = 0; o < S.length; o += SHOT) {
      const p = this.shots.get(S[o]);
      if (!p) continue;
      p.x = S[o + 1];
      p.y = S[o + 2];
      p.z = S[o + 3];
      p.vx = S[o + 4];
      p.vy = S[o + 5];
      p.vz = S[o + 6];
      p.age = S[o + 7];
      p.hidden = S[o + 8] > 0;
      now.push(p);
    }
    if (this.shots.size > now.length * 2 + 1024) {
      const live = new Set(now.map(p => p.id));
      for (const id of this.shots.keys()) if (!live.has(id)) this.shots.delete(id);
    }
    w.projectiles = now;
  }

  back(a) {
    if (a === null || typeof a !== 'object') return a;
    if (a.$u !== undefined) return this.byW.get(a.$u);
    if (a.$pl !== undefined) return a.$pl < 0 ? this.world.neutral : this.world.players.find(p => p.id === a.$pl);
    if (a.$tm !== undefined) return this.world.teams.find(t => t.id === a.$tm) || null;
    if (a.$t !== undefined) return db.type(a.$t) || null;
    if (a.$v) return new THREE.Vector3(a.$v[0], a.$v[1], a.$v[2]);
    if (a.$c !== undefined) return new THREE.Color(a.$c);
    if (a.$p !== undefined) return this.shots.get(a.$p) || null;
    if (Array.isArray(a)) return a.map(x => this.back(x));
    const o = {};
    for (const k in a) o[k] = this.back(a[k]);
    return o;
  }

  stop() {
    for (const wk of this.jobWorkers) wk.terminate();
    this.worker.terminate();
  }
}
