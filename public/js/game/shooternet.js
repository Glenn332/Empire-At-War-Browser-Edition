import { NetSession } from '../net.js';
import { heightAt } from './terrain.js';

const SNAP = { every: 1 / 15, delay: 0.15, keep: 12, drift: 0.5 },
  SEND = { every: 1 / 20, wait: 5 },
  ROSTER = { every: 1 },
  KEY = { every: 1 },
  READY = { every: 2 },
  MATCH = 4,
  Q = 4;

const membersOf = q => (q.mates || [q]).flatMap(m => m.members || []);

export class ShooterNet {
  constructor(game, cfg) {
    this.game = game;
    this.world = game.world;
    this.cfg = cfg;
    this.role = cfg.role;
    this.ids = new WeakMap();
    this.byId = new Map();
    this.next = 1;
    this.peers = new Set();
    this.sent = new Map();
    this.events = [];
    this.snapAt = 0;
    this.track = new Map();
    this.clock = null;
    this.hostT = 0;
    this.recvAt = 0;
    this.waiting = new Map();
    this.names = new Map();
    this.stats = new Map();
    this.players = [];
    this.rosterAt = 0;
    this.statAt = 0;
  }

  async start() {
    const S = (this.session = this.cfg.session || new NetSession());
    if (this.role === 'host') {
      if (!this.cfg.session) await S.connect(this.cfg.room, { host: true, name: this.cfg.name || 'Host' });
      this.hookHost();
      S.on('message', (from, m) => this.hostMessage(from, m));
      S.on('join', (p, name) => this.names.set(p, String(name || 'Player ' + p).slice(0, 24)));
      S.on('leave', p => {
        this.peers.delete(p);
        this.release(p);
        this.stats.delete(p);
      });
    } else {
      this.hookClient();
      S.on('message', (from, m) => this.clientMessage(m));
      S.on('closed', () => {
        const g = this.game;
        g.shooter?.announce('The host left the game', 'bad');
        setTimeout(() => {
          if (g.over) return;
          if (g.shooter) g.shooter.endTitle = 'Host left';
          g.end(false, { suppress: true });
        }, 3000);
      });
      S.send(0, { k: 'sh-ready' });
      this.readyTimer = setInterval(() => {
        if (this.ready || this.game.over) clearInterval(this.readyTimer);
        else S.send(0, { k: 'sh-ready' });
      }, READY.every * 1000);
    }
  }

  peerName(p) {
    return this.names.get(p) || String(this.game.players.find(x => x.human && x.peer === p)?.name || 'Player ' + p).slice(0, 24);
  }

  idOf(u) {
    let n = this.ids.get(u);
    if (!n) {
      n = this.next++;
      this.ids.set(u, n);
      this.byId.set(n, u);
    }
    return n;
  }

  setupFor() {
    const { shooterNet, net, benchmark, ...rest } = this.game.setup;
    return JSON.parse(JSON.stringify({ ...rest, benchmark: 0 }));
  }

  squadRec(q, name, seen = null) {
    const live = (seen ? q.members : membersOf(q)).filter(u => !u.dead && !u.gone && !(seen && seen.has(u)));
    if (seen) for (const u of live) seen.add(u);
    if (!live.length) return null;
    return {
      t: name || q.spawnName || q.type?.name || live[0].type.name,
      s: q.side,
      st: live[0].structure ? 1 : 0,
      m: live.map(u => [this.idOf(u), live[0].type === u.type ? 0 : u.type.name, Math.round(u.x * Q), Math.round(u.y * Q), Math.round(u.heading * 100)])
    };
  }

  hookHost() {
    const w = this.world,
      spawn = w.spawn;
    w.spawn = (...a) => {
      const p = spawn.apply(w, a);
      Promise.resolve(p).then(q => {
        if (!q) return;
        q.spawnName = a[0];
        if (!this.peers.size) return;
        const r = this.squadRec(q, a[0]);
        if (r) this.events.push(['sp', r]);
      });
      return p;
    };
    const died = w.onDeath;
    w.onDeath = u => {
      if (died) died(u);
      if (this.peers.size && this.ids.has(u)) this.events.push(['die', this.ids.get(u), u.lastDamage || '', Math.round(u.x * Q), Math.round(u.y * Q), Math.round(u.heading * 100)]);
    };
    const sh = this.game.shooter;
    if (sh) {
      const log = sh.logKill.bind(sh);
      sh.logKill = (killer, victim) => {
        log(killer, victim);
        if (this.peers.size && victim) this.events.push(['kf', killer && killer.x !== undefined ? this.idOf(killer) : 0, this.idOf(victim)]);
      };
    }
    const shot = w.onShot;
    w.onShot = s => {
      if (shot) shot(s);
      if (!this.peers.size || !s.from) return;
      const u = s.from,
        wi = s.w === u.weapon ? 0 : s.w === this.game.shooter?.nadeW ? -2 : u.guns ? u.guns.indexOf(s.w) + 1 : -1;
      if (wi === -1 || !this.ids.has(u)) return;
      const t = s.target,
        tid = t && !t.spot && t.x !== undefined && this.ids.has(t) ? this.ids.get(t) : 0;
      this.events.push(['sh', this.ids.get(u), wi, tid, tid ? 0 : Math.round((s.aimX ?? s.ax) * Q), tid ? 0 : Math.round((s.aimY ?? s.ay) * Q), tid ? 0 : Math.round((s.aimZ ?? 0) * Q)]);
    };
  }

  hostMessage(from, m) {
    if (!m || typeof m.k !== 'string') return;
    if (m.k === 'sh-hello') this.session.send(from, { k: 'sh-setup', setup: this.setupFor() });
    else if (m.k === 'sh-me') this.game.shooter?.remoteState(from, m);
    else if (m.k === 'sh-st' && Array.isArray(m.st)) this.stats.set(from, m.st.slice(0, 5).map(v => Math.max(0, Math.min(1e6, Math.round(+v || 0)))));
    else if (m.k === 'sh-f') this.game.shooter?.remoteFire(from, m);
    else if (m.k === 'sh-ab') this.game.shooter?.remoteAbility(from, m);
    else if (m.k === 'sh-exit') this.game.shooter?.remoteExit(from);
    else if (m.k === 'sh-enter') {
      const got = this.game.shooter?.remoteSeat(from);
      this.session.send(from, got ? { k: 'sh-in', r: m.r, ok: 1, seat: got.seat, id: this.idOf(got.id) } : { k: 'sh-in', r: m.r, ok: 0 });
    }
    else if (m.k === 'sh-deploy') this.deployFor(from, m);
    else if (m.k === 'sh-cmd') this.game.shooter?.ov?.remoteCommand(from, m.cmd);
    else if (m.k === 'sh-free') this.game.shooter?.ov?.remoteFree(from);
    else if (m.k === 'sh-take') {
      const sh = this.game.shooter,
        got = sh?.ov?.remoteTake(from, +m.id || 0);
      if (got) sh.names.set(got.unit, this.peerName(from));
      this.session.send(from, { k: 'sh-you', id: got ? this.idOf(got.unit) : 0, seat: got ? got.seat : '', r: m.r });
    }
    else if (m.k === 'sh-ready') {
      if (this.peers.has(from)) return;
      const roster = [],
        seen = new Set();
      for (const q of this.world.squads) {
        const r = this.squadRec(q, q.type?.name, seen);
        if (r) roster.push(r);
      }
      this.session.send(from, { k: 'sh-all', t: this.world.time, r: roster, p: this.pointsRec() });
      this.peers.add(from);
      for (const id of this.byId.keys()) this.sent.delete(id);
    }
  }

  async deployFor(from, m) {
    const sh = this.game.shooter;
    const u = sh ? await sh.remoteDeploy(from, String(m.c || ''), +m.x, +m.y, +m.v || 0) : null;
    if (u) sh.names.set(u, this.peerName(from));
    this.session.send(from, { k: 'sh-you', id: u ? this.idOf(u) : 0, r: m.r });
  }

  credit(peer, m) {
    if (this.peers.has(peer)) this.session.send(peer, { k: 'sh-cr', ...m });
  }

  release(peer) {
    const sh = this.game.shooter,
      u = sh?.remotes.get(peer);
    if (!u) return;
    sh.remoteExit(peer);
    sh.remotes.delete(peer);
    if (u.dead) return;
    u.remote = null;
    if (u.squad) u.squad.noAI = false;
  }

  async requestTake(id) {
    const r = (this.req = (this.req || 0) + 1);
    this.session.send(0, { k: 'sh-take', id, r });
    const W = (this.wantYou = { r, id: null, seat: '' }),
      unit = await this.awaitYou(r);
    return unit ? { unit, seat: W.seat } : null;
  }

  awaitYou(r) {
    return new Promise(res => {
      const until = performance.now() + SEND.wait * 1000;
      const look = () => {
        const W = this.wantYou;
        if (!W || W.r !== r || W.id === 0) return res(null);
        const u = W.id ? this.byId.get(W.id) : null;
        if (u && !u.dead) {
          this.wantYou = null;
          return res(u);
        }
        if (performance.now() > until) {
          this.wantYou = null;
          return res(null);
        }
        setTimeout(look, 50);
      };
      look();
    });
  }

  requestDeploy(name, x, y, v = 0) {
    const r = (this.req = (this.req || 0) + 1);
    this.session.send(0, { k: 'sh-deploy', c: name, x, y, v, r });
    return new Promise(res => {
      const until = performance.now() + SEND.wait * 1000;
      this.wantYou = { r, id: null };
      const look = () => {
        const W = this.wantYou;
        if (!W || W.r !== r) return res(null);
        if (W.id === 0) return res(null);
        const u = W.id ? this.byId.get(W.id) : null;
        if (u && !u.dead) {
          this.wantYou = null;
          return res(u);
        }
        if (performance.now() > until) {
          this.wantYou = null;
          return res(null);
        }
        setTimeout(look, 50);
      };
      look();
    });
  }

  playerUnits() {
    const now = performance.now();
    if (this.pu && now < this.puAt) return this.pu;
    this.puAt = now + 250;
    const out = (this.pu = new Map()),
      sh = this.game.shooter,
      mine = sh?.body;
    for (const p of this.playerRows() || []) {
      if (this.isMe(p)) continue;
      const u = (p.v && this.byId.get(p.v)) || (p.id && this.byId.get(p.id));
      if (!u || u.dead || u === mine) continue;
      out.set(u, { n: String(p.n || 'Player'), s: p.s, seat: !!p.v });
    }
    return out;
  }

  isMe(p) {
    return this.role === 'host' ? !!p.host : p.peer === this.session?.id;
  }

  playerRows() {
    const sh = this.game.shooter,
      rows = [];
    if (this.role === 'host') {
      const b = sh?.body;
      rows.push({ n: this.cfg.name || 'Host', s: this.game.me, id: b && !b.dead ? this.idOf(b) : 0, v: b && !b.dead && b.inside ? this.idOf(b.inside) : 0, st: sh ? [sh.kills, sh.assists, sh.deaths, sh.matchScore, sh.caps] : [0, 0, 0, 0, 0], host: 1 });
      for (const p of this.peers) {
        const u = sh?.remotes.get(p);
        rows.push({ n: this.peerName(p), s: sh ? sh.peerSide(p) : this.game.me, id: u && !u.dead ? this.idOf(u) : 0, v: u && !u.dead && u.inside ? this.idOf(u.inside) : 0, st: this.stats.get(p) || [0, 0, 0, 0, 0], peer: p });
      }
      return rows;
    }
    return this.players;
  }

  requestEnter() {
    const r = (this.req = (this.req || 0) + 1);
    this.session.send(0, { k: 'sh-enter', r });
    return new Promise(res => {
      this.wantIn = { r, res };
      setTimeout(() => {
        if (this.wantIn && this.wantIn.r === r) {
          this.wantIn = null;
          res(false);
        }
      }, SEND.wait * 1000);
    });
  }

  pointsRec() {
    return this.world.points.map(p => [p.side, p.taker ?? -1, Math.round((p.progress || 0) * 100)]);
  }

  hostStep() {
    const w = this.world,
      ending = this.game.over && !this.endSent;
    if (!this.peers.size || (w.time < this.snapAt && !ending)) return;
    this.snapAt = w.time + SNAP.every;
    const full = w.time >= (this.keyAt || 0),
      out = [],
      hid = [];
    if (full) this.keyAt = w.time + KEY.every;
    for (const u of w.units) {
      if (u.dead || u.gone || !this.ids.has(u)) continue;
      if (u.inside || (u.holder && u.holder.visible === false && u !== this.game.shooter?.body)) hid.push(this.ids.get(u));
      const id = this.ids.get(u),
        kind = u.animKind === '~' ? '~' + (u.onceKind || '') + '|' + (u.once || '') : u.animKind || '',
        e = [id, Math.round(u.x * Q), Math.round(u.y * Q), Math.round(u.z * Q), Math.round(u.heading * 100), Math.round((u.health / (u.maxHealth || 1)) * 100)],
        was = this.sent.get(id);
      if (!full && was && was[1] === e[1] && was[2] === e[2] && was[3] === e[3] && was[4] === e[4] && was[5] === e[5] && was.kind === kind) continue;
      if (full || !was || was.kind !== kind) e.push(kind);
      e.kind = kind;
      this.sent.set(id, e);
      out.push(e);
    }
    for (const [id, u] of this.byId)
      if (u.gone && !u.dead) {
        this.events.push(['gone', id]);
        this.byId.delete(id);
      } else if (u.gone) this.byId.delete(id);
    const g = this.game,
      sh = g.shooter;
    if (g.over && !this.endSent) {
      this.endSent = true;
      this.events.push(['end', w.winner ?? -1, w.loser ?? -1]);
    }
    const ori = [];
    for (const u of w.units) if (u.flies && !u.dead && u.netRoll !== undefined && this.ids.has(u)) ori.push([this.ids.get(u), Math.round(u.netRoll * 100), Math.round(u.netTilt * 100)]);
    const ev = this.events.splice(0),
      msg = { k: 'sh-s', t: w.time, u: out, p: this.pointsRec(), ...(ori.length ? { o: ori } : {}) },
      hk = hid.join();
    if (ev.length) for (const p of this.peers) this.session.send(p, { k: 'sh-e', t: w.time, e: ev });
    if (hk !== this.hidSent || w.time >= (this.hidAt || 0)) {
      this.hidSent = hk;
      this.hidAt = w.time + ROSTER.every;
      msg.h = hid;
    }
    if (sh?.tickets) {
      msg.T = sh.tickets.slice();
      msg.TS = sh.ticketStart;
    }
    if (w.time >= this.rosterAt) {
      this.rosterAt = w.time + ROSTER.every;
      msg.pl = this.playerRows();
      if (sh) msg.fv = sh.freeRideIds();
      const cl = sh?.netClassRows();
      if (cl) msg.cl = cl;
    }
    for (const p of this.peers) (this.session.sendFast ? this.session.sendFast(p, msg) : this.session.send(p, msg));
  }

  hookClient() {
    const w = this.world;
    w.puppet = (u, dt) => this.puppet(u, dt);
    const cap = w.onCapture;
    w.onCapture = (pt, was) => {
      if (cap) cap(pt, was);
      this.game.shooter?.captured(pt, was);
    };
    const hit = w.onImpact;
    w.onImpact = s => {
      if (hit) hit(s);
      const sh = this.game.shooter;
      if (sh && s.from === sh.body) sh.impact(s);
      else sh?.flashAt(s);
    };
    const shot = w.onShot;
    w.onShot = s => {
      if (shot) shot(s);
      const sh = this.game.shooter,
        b = sh?.body,
        f = s.from,
        car = !!(f && ((sh?.rideQ && f.squad === sh.rideQ) || (sh?.gunQ && f.squad === sh.gunQ)));
      if (!b || (f !== b && !car) || !this.session) return;
      const wi = s.w === f.weapon ? 0 : s.w === sh.nadeW ? -2 : f.guns ? f.guns.indexOf(s.w) + 1 : -1;
      if (wi === -1) return;
      const t = s.target,
        tid = t && !t.spot && t.x !== undefined && this.ids.has(t) ? this.ids.get(t) : 0;
      const hu = sh.aimHit && !sh.aimHit.dead && this.ids.has(sh.aimHit) ? sh.aimHit : null;
      this.session.send(0, { k: 'sh-f', w: wi, u: car ? this.ids.get(f) || 0 : 0, h: hu ? this.ids.get(hu) : 0, hx: hu ? Math.round(hu.x * 10) / 10 : 0, hy: hu ? Math.round(hu.y * 10) / 10 : 0, hz: hu ? Math.round(hu.z * 10) / 10 : 0, t: tid, x: Math.round((s.aimX ?? s.ax) * 10) / 10, y: Math.round((s.aimY ?? s.ay) * 10) / 10, z: Math.round((s.aimZ ?? 0) * 10) / 10 });
    };
    if (this.game.shooter) this.game.shooter.netClient = true;
    w.hurt = () => {};
    w.interp = false;
  }

  clientMessage(m) {
    if (!m || typeof m.k !== 'string') return;
    if (m.k === 'sh-all') this.roster(m);
    else if (m.k === 'sh-s') this.snapshot(m);
    else if (m.k === 'sh-e' && Array.isArray(m.e)) for (const ev of m.e) this.event(ev, +m.t || this.hostT);
    else if (m.k === 'sh-you' && this.wantYou && this.wantYou.r === m.r) {
      this.wantYou.seat = String(m.seat || '');
      this.wantYou.id = +m.id || 0;
    }
    else if (m.k === 'sh-cr') this.game.shooter?.netCredit(m);
    else if (m.k === 'sh-in' && this.wantIn && this.wantIn.r === m.r) {
      const W = this.wantIn;
      this.wantIn = null;
      const unit = m.ok ? this.byId.get(+m.id || 0) : null;
      W.res(m.ok && unit ? { seat: String(m.seat), unit } : null);
    }
    else if (m.k === 'sh-why') this.game.shooter?.flash(String(m.t || '').slice(0, 80));
  }

  async roster(m) {
    const w = this.world,
      claimed = new Set();
    this.hostT = m.t;
    this.recvAt = performance.now();
    this.clock = m.t - SNAP.delay;
    const pending = [];
    for (const r of m.r) {
      const lead = r.m[0],
        tname = String(r.t).toUpperCase();
      let matched = 0;
      for (const e of r.m) {
        const x = e[2] / Q,
          y = e[3] / Q;
        let best = null,
          bd = MATCH;
        for (const u of w.units) {
          if (u.dead || u.gone || claimed.has(u) || u.side !== r.s) continue;
          const nm = e[1] || null;
          if (nm ? u.type.name !== nm : u.squad?.type?.name?.toUpperCase() !== tname && u.type.name.toUpperCase() !== tname && !u.structure) continue;
          const d = Math.hypot(u.x - x, u.y - y);
          if (d < bd) {
            bd = d;
            best = u;
          }
        }
        if (best) {
          claimed.add(best);
          this.bind(e[0], best);
          matched++;
        }
      }
      if (!matched && lead) pending.push(this.spawnRec(r));
    }
    for (const u of w.units) if (!claimed.has(u) && !u.dead && !u.gone && (u.speed > 0 || u.weapon || u.guns)) this.remove(u);
    await Promise.all(pending);
    this.applyPoints(m.p);
    this.ready = true;
  }

  bind(id, u) {
    this.byId.set(id, u);
    this.ids.set(u, id);
    u.path = [];
    u.target = null;
    if (u.squad) {
      u.squad.noAI = true;
      u.squad.foe = null;
    }
  }

  remove(u) {
    u.dead = true;
    u.gone = true;
    u.died = -1e9;
    u.path = [];
    if (u.holder) this.world.scene.remove(u.holder);
    if (u.squad) u.squad.members = u.squad.members.filter(m => m !== u);
  }

  async spawnRec(r) {
    const w = this.world,
      e = r.m[0];
    for (const x of r.m) this.waiting.set(x[0], true);
    const q = await w.spawn(r.t, e[2] / Q, e[3] / Q, e[4] / 100, r.s);
    for (const x of r.m) this.waiting.delete(x[0]);
    if (!q) return;
    const got = membersOf(q).filter(u => !u.dead);
    r.m.forEach((x, i) => {
      const u = got[i];
      if (!u) return;
      this.bind(x[0], u);
      u.x = x[2] / Q;
      u.y = x[3] / Q;
      u.heading = x[4] / 100;
    });
    for (let i = r.m.length; i < got.length; i++) this.remove(got[i]);
  }

  snapshot(m) {
    if (m.t > this.hostT) {
      this.hostT = m.t;
      this.recvAt = performance.now();
    }
    if (this.clock === null) this.clock = m.t - SNAP.delay;
    const sh = this.game.shooter;
    if (sh && Array.isArray(m.T)) {
      sh.tickets = m.T.map(v => +v || 0);
      if (+m.TS > 0) sh.ticketStart = +m.TS;
    }
    if (m.cl && typeof m.cl === 'object') this.netClasses = m.cl;
    if (m.fv && typeof m.fv === 'object') {
      const mine = m.fv[this.game.me];
      this.freeRides = Array.isArray(mine) ? mine.map(v => +v || 0) : [];
    }
    if (Array.isArray(m.pl)) {
      this.players = m.pl;
      for (const p of m.pl) {
        const u = p.id ? this.byId.get(p.id) : null;
        if (u && sh && u !== sh.body) sh.names.set(u, String(p.n || '').slice(0, 24));
      }
    }
    for (const ev of m.e || []) this.event(ev, m.t);
    if (Array.isArray(m.h)) this.hidden(m.h);
    for (const [id, r, p] of Array.isArray(m.o) ? m.o : []) {
      const T = this.track.get(id);
      if (T) T.o = [r / 100, p / 100, m.t];
    }
    for (const e of m.u) {
      const id = e[0];
      let T = this.track.get(id);
      if (!T) this.track.set(id, (T = { s: [], kind: '' }));
      const s = { t: m.t, x: e[1] / Q, y: e[2] / Q, z: e[3] / Q, h: e[4] / 100, hp: e[5], kind: e.length > 6 ? e[6] : T.last ? T.last.kind : '' };
      const prev = T.last;
      if (prev && m.t <= prev.t) continue;
      if (prev && m.t - prev.t > SNAP.every * 1.5) T.s.push({ ...prev, t: m.t - SNAP.every });
      T.s.push(s);
      T.last = s;
      if (T.s.length > SNAP.keep) T.s.splice(0, T.s.length - SNAP.keep);
    }
    this.applyPoints(m.p);
  }

  hidden(list) {
    const now = new Set(list),
      sh = this.game.shooter;
    for (const id of this.hid || []) {
      if (now.has(id)) continue;
      const u = this.byId.get(id);
      if (!u || u === sh?.body) continue;
      u.netHidden = false;
      if (!u.dead && u.holder) u.holder.visible = true;
    }
    for (const id of now) {
      const u = this.byId.get(id);
      if (!u || u === sh?.body) continue;
      u.netHidden = true;
      if (u.holder) u.holder.visible = false;
    }
    this.hid = now;
  }

  applyPoints(list) {
    if (!list) return;
    const P = this.world.points;
    list.forEach((r, i) => {
      const p = P[i];
      if (!p) return;
      if (p.side !== r[0]) {
        const was = p.side;
        p.side = r[0];
        this.world.onCapture?.(p, was);
      }
      p.taker = r[1];
      p.progress = r[2] / 100;
    });
  }

  event(ev, at) {
    const w = this.world;
    if (ev[0] === 'sp') this.spawnRec(ev[1]);
    else if (ev[0] === 'die') {
      const u = this.byId.get(ev[1]);
      if (!u || u.dead) return;
      u.lastDamage = ev[2] || u.lastDamage;
      if (ev.length > 5 && u !== this.game.shooter?.body) {
        u.x = ev[3] / Q;
        u.y = ev[4] / Q;
        u.heading = ev[5] / 100;
        u.z = heightAt(w.terrain, u.x, u.y) + (u.lift || 0);
        if (u.holder) {
          u.holder.position.set(u.x, u.y, u.z);
          u.holder.rotation.z = u.heading + Math.PI / 2;
        }
      }
      u.health = 0;
      u.dead = true;
      u.path = [];
      u.target = null;
      u.died = w.time;
      w.die(u, '');
      if (u.squad) u.squad.members = u.squad.members.filter(m => m !== u);
      this.track.delete(ev[1]);
    } else if (ev[0] === 'kf') {
      const v = this.byId.get(ev[2]),
        k = ev[1] ? this.byId.get(ev[1]) : null;
      if (v) this.game.shooter?.logKill(k || null, v);
    } else if (ev[0] === 'end') {
      const g = this.game;
      if (g.over) return;
      w.winner = ev[1] < 0 ? undefined : ev[1];
      w.loser = ev[2] < 0 ? undefined : ev[2];
      g.end(w.winner === g.myTeam);
    } else if (ev[0] === 'gone') {
      const u = this.byId.get(ev[1]);
      if (u && !u.gone) this.remove(u);
      this.byId.delete(ev[1]);
      this.track.delete(ev[1]);
    } else if (ev[0] === 'sh') {
      const u = this.byId.get(ev[1]),
        sh = this.game.shooter;
      if (!u || u.dead || u === sh?.body || (sh?.rideQ && u.squad === sh.rideQ)) return;
      const W = ev[2] === 0 ? u.weapon : ev[2] === -2 ? sh?.nadeWeapon() : u.guns?.[ev[2] - 1];
      if (!W) return;
      const tu = ev[3] ? this.byId.get(ev[3]) : null,
        tgt = tu && !tu.dead ? tu : { spot: true, x: ev[4] / Q, y: ev[5] / Q, z: ev[6] / Q, aimZ: 0, hitRadius: 1 };
      if (!tu && !ev[4] && !ev[5]) return;
      (this.later ||= []).push({ at, u, W, t: tgt });
    }
  }

  clientStep(dt) {
    const w = this.world;
    if (this.clock === null) return;
    const est = this.hostT + (performance.now() - this.recvAt) / 1000 - SNAP.delay;
    this.clock += dt;
    if (Math.abs(est - this.clock) > SNAP.drift) this.clock = est;
    else this.clock += (est - this.clock) * Math.min(1, dt * 2);
    if (this.later && this.later.length) {
      let k = 0;
      for (const f of this.later) {
        if (f.at > this.clock + SNAP.every) {
          this.later[k++] = f;
          continue;
        }
        if (!f.u.dead && !f.u.gone && (!f.t.dead || f.t.spot)) w.fire(f.u, f.t, f.W);
      }
      this.later.length = k;
    }
    w.update(dt);
    const sh = this.game.shooter,
      b = sh?.body;
    if (sh && !sh.padsDone && this.ready && w.points.length) {
      sh.padsDone = true;
      sh.padLayer();
      sh.rockLayer();
    }
    if (sh && this.ready) {
      sh.clientTick(dt);
      if (w.time >= this.statAt) {
        this.statAt = w.time + ROSTER.every;
        this.session.send(0, { k: 'sh-st', st: [sh.kills, sh.assists, sh.deaths, sh.matchScore, sh.caps] });
      }
    }
    if (!sh || !b || sh.state !== 'alive' || w.time < (this.sendAt || 0)) return;
    this.sendAt = w.time + SEND.every;
    const lead = sh.rideQ ? sh.rideQ.members.find(m => !m.dead) : null;
    if (lead) {
      const A = lead.pilot === sh.A ? sh.A : null;
      this.session.send(0, { k: 'sh-me', id: this.ids.get(lead) || 0, x: Math.round(lead.x * 10) / 10, y: Math.round(lead.y * 10) / 10, z: Math.round(lead.z * 10) / 10, h: Math.round(lead.heading * 100) / 100, a: lead.animKind === '~' ? '' : lead.animKind || '', ...(A ? { r: Math.round((A.roll || 0) * 100) / 100, p: Math.round((A.tilt || 0) * 100) / 100 } : {}) });
      return;
    }
    if (b.inside) return;
    const a = b.animKind === '~' ? '~' + (b.onceKind || '') + '|' + (b.once || '') : b.animKind || '';
    this.session.send(0, { k: 'sh-me', x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, z: Math.round(b.z * 10) / 10, h: Math.round(b.heading * 100) / 100, a });
  }

  puppet(u, dt) {
    const w = this.world,
      id = this.ids.get(u),
      T = id ? this.track.get(id) : null,
      sh = this.game.shooter;
    if (sh && u === sh.body && u.inside) {
      if (T && T.last && u.maxHealth > 0) u.health = (u.maxHealth * T.last.hp) / 100;
      u.x = u.inside.x;
      u.y = u.inside.y;
      u.z = u.inside.z + (u.inside.aimZ || 0) * 0.5;
      return;
    }
    if (sh && u === sh.body && u.pilot) {
      if (T && T.last && u.maxHealth > 0) u.health = (u.maxHealth * T.last.hp) / 100;
      sh.pilotStep(u, dt);
      return;
    }
    if (sh && sh.rideQ && u.squad === sh.rideQ) {
      if (T && T.last && u.maxHealth > 0) u.health = (u.maxHealth * T.last.hp) / 100;
      if (u.pilot) sh.pilotStep(u, dt);
      else if (u.direct) {
        w.directStep(u, dt);
        sh.vehicleFeel(u, dt);
      }
      return;
    }
    const gunning = sh && sh.gunQ && u.squad === sh.gunQ;
    if (T && T.s.length) {
      const S = T.s,
        c = this.clock;
      let a = S[0],
        b = S[0];
      for (let i = 0; i < S.length; i++) {
        if (S[i].t <= c) a = S[i];
        if (S[i].t >= c) {
          b = S[i];
          break;
        }
        b = S[i];
      }
      const k = b.t > a.t ? Math.max(0, Math.min(1, (c - a.t) / (b.t - a.t))) : 1;
      let dh = b.h - a.h;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const nx = a.x + (b.x - a.x) * k,
        ny = a.y + (b.y - a.y) * k;
      u.v = dt > 0 ? Math.hypot(nx - u.x, ny - u.y) / dt : 0;
      u.x = nx;
      u.y = ny;
      u.z = a.z + (b.z - a.z) * k;
      u.heading = a.h + dh * k;
      if (u.maxHealth > 0) u.health = (u.maxHealth * (k < 0.5 ? a.hp : b.hp)) / 100;
      const kind = k < 0.5 ? a.kind : b.kind;
      if (kind !== T.kind) {
        T.kind = kind;
        if (kind && kind[0] === '~') {
          const [K, during] = kind.slice(1).split('|');
          if (K) w.oneShot(u, K, during || 'idle');
        } else if (kind) w.setAnim(u, kind);
      }
    } else if (!u.structure) u.z = heightAt(w.terrain, u.x, u.y) + (u.lift || 0) + (u.hoverZ || 0);
    if (u.holder) {
      u.holder.position.set(u.x, u.y, u.z);
      if (u.flies && T && T.o && this.hostT - T.o[2] < 1) u.holder.rotation.set(T.o[1], T.o[0], u.heading + Math.PI / 2, 'ZYX');
      else if (!u.fixedHeading) u.holder.rotation.z = u.heading + Math.PI / 2;
    }
    if (gunning && u.guns && !u.dead) {
      if (u.turret && !u.weapon) w.aimHead(u, dt);
      w.fireGuns(u, dt);
    }
    w.show(u, dt);
  }
}
