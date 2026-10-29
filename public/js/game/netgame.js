import { execute } from './commands.js';
import { simRandomState } from './simrandom.js';

export const TURN = 3;
const DELAY = 2;
const MAX_AHEAD = 8;
const HASH_EVERY = 10;

export function stateHash(world) {
  let h = 0x811c9dc5 | 0;
  const f64 = new Float64Array(1),
    u32 = new Uint32Array(f64.buffer);
  const mixInt = v => {
    h = Math.imul(h ^ (v | 0), 0x01000193);
  };
  const mix = v => {
    f64[0] = v || 0;
    mixInt(u32[0]);
    mixInt(u32[1]);
  };
  mix(world.time);
  for (const x of simRandomState()) mixInt(x);
  for (const p of world.players) {
    mix(p.credits);
    mixInt(p.id);
  }
  mixInt(world.units.length);
  mixInt(world.projectiles.length);
  for (const u of world.units) {
    mixInt(u.id);
    mix(u.x);
    mix(u.y);
    mix(u.heading);
    mix(u.health);
    mix(u.shield);
  }
  return h >>> 0;
}

export class Lockstep {
  constructor(game, net) {
    this.game = game;
    this.session = net.session;
    this.me = net.me;
    this.host = net.me === 0;
    this.turns = new Map();
    this.tick = 0;
    this.started = false;
    this.ackOf = new Map();
    this.loaded = new Set();
    this.hashes = new Map();
    this.log = [];
    this.collected = [];
    this.issued = DELAY - 1;
    this.playerOf = new Map(
      game.setup.players
        .flatMap((cfg, i) => (cfg.peers || [cfg.peer]).map(peer => [peer, cfg.human ? i : -1]))
        .filter(([peer, i]) => peer !== undefined && i >= 0)
    );
    this.peers = [...new Set([...this.playerOf.keys(), ...(net.spectators || [])])].filter(p => p !== 0);
    this.gone = new Set();
    this.hostPlayer = this.playerOf.get(0);
    this.resumed = -1;
    this.pausedAt = -1;
    this.onMessage = this.session.on('message', (from, m) => this.receive(from, m));
    this.session.on('leave', peer => this.dropped(peer));
    this.session.on('closed', why => {
      if (!this.game.over)
        this.game.message(why === 'host left' ? 'The host has left the game.' : 'The connection to the game was lost.', 'bad');
      this.lost = true;
    });
    for (let n = 0; n < DELAY; n++) this.turns.set(n, []);
    this.stalls = new StallLog(this);
    if (typeof window !== 'undefined') window.stallLog = this.stalls;
    this.pinger = setInterval(() => {
      if (this.lost) return;
      const t = performance.now();
      if (this.host) {
        for (const p of this.peers) if (!this.gone.has(p)) this.session.send(p, { k: 'ping', t });
      } else this.session.send(0, { k: 'ping', t });
    }, 2000);
  }

  frame(owed, limit, extra, stepMs = 0) {
    this.owedNow = owed;
    this.stalls.frame(owed, limit, extra, stepMs);
  }

  netStats(stepSec) {
    const now = performance.now(),
      r = (this.rate ||= { t: now, tick: this.tick, tps: 0 });
    if (now - r.t >= 500) {
      r.tps = ((this.tick - r.tick) * 1000) / (now - r.t);
      r.t = now;
      r.tick = this.tick;
    }
    const g = this.game,
      speed = g.speed || 1,
      pings = [...this.stalls.pings.values()].map(l => l[l.length - 1]).filter(v => v >= 0);
    const ping = pings.length ? Math.max(...pings) : null,
      list = this.stalls.list;
    return {
      tps: r.tps,
      target: g.paused || g.over ? 0 : speed / stepSec,
      turns: r.tps / TURN,
      ping,
      behind: Math.max(0, Math.round(this.owedNow || 0)),
      stalls: list.length,
      stallMs: list.reduce((a, e) => a + e.ms, 0),
      now: this.stalls.ep ? this.stalls.ep.cause : null,
      delay: (DELAY * TURN * stepSec * 1000) / speed + (this.host || ping === null ? 0 : ping / 2),
      desync: !!this.desynced,
      host: this.host
    };
  }

  clock() {
    const g = this.game;
    return g.world ? g.world.time : g.galaxy?.time || 0;
  }

  player(pid) {
    return this.game.netPlayer ? this.game.netPlayer(pid) : this.game.world.players[pid];
  }

  ready() {
    return new Promise(done => {
      if (this.started) {
        done();
        return;
      }
      this.go = done;
      if (this.host) {
        this.loaded.add(0);
        this.checkLoaded();
        return;
      }
      const say = () => {
        if (!this.started) this.session.send(0, { k: 'loaded' });
        else clearInterval(this.loadedTimer);
      };
      say();
      this.loadedTimer = setInterval(say, 1000);
    });
  }

  checkLoaded() {
    if (this.started || !this.go || !this.peers.every(p => this.loaded.has(p) || this.gone.has(p))) return;
    this.session.broadcast({ k: 'go' });
    this.begin();
  }
  begin() {
    this.started = true;
    clearInterval(this.loadedTimer);
    this.go?.();
  }

  command(cmd) {
    if (this.host) this.collected.push([this.playerOf.get(0), cmd]);
    else this.session.send(0, { k: 'cmd', cmd });
  }

  receive(from, m) {
    if (m.k === 'ping') {
      this.session.send(from, { k: 'pong', t: m.t });
      return;
    }
    if (m.k === 'pong') {
      if (Number.isFinite(m.t)) this.stalls.ping(from, performance.now() - m.t);
      return;
    }
    if (m.k === 'stallq') {
      this.session.send(from, { k: 'stalls', text: this.stalls.report() });
      return;
    }
    if (m.k === 'stalls') {
      const who = this.host ? this.player(this.playerOf.get(from))?.name || 'A player' : this.player(this.hostPlayer)?.name || 'The host';
      this.stalls.show(`${who}: ${String(m.text || '').slice(0, 600)}`);
      return;
    }
    if (this.host) {
      const pid = this.playerOf.get(from);
      if (m.k === 'cmd' && pid !== undefined && !this.gone.has(from) && m.cmd && typeof m.cmd.c === 'string')
        this.collected.push([pid, m.cmd]);
      else if (m.k === 'loaded') {
        this.loaded.add(from);
        if (this.started) this.session.send(from, { k: 'go' });
        else this.checkLoaded();
      } else if (m.k === 'chat' && pid !== undefined) this.chat(pid, m.text, !!m.team);
      else if (m.k === 'ack') {
        this.ackOf.set(from, m.n);
        if (m.h !== undefined) {
          const ours = this.hashes.get(m.n);
          if (ours !== undefined && ours !== m.h && !this.desynced) {
            this.desynced = true;
            this.session.broadcast({ k: 'desync', n: m.n });
            this.desync(m.n);
          }
        }
      }
    } else {
      if (m.k === 'turn') this.turns.set(m.n, m.cmds);
      else if (m.k === 'go') this.begin();
      else if (m.k === 'desync') this.desync(m.n);
      else if (m.k === 'resume') this.lift(m.n);
      else if (m.k === 'chat') this.game.chatLine?.(this.player(m.from), m.text, m.team);
    }
  }

  dropped(peer) {
    if (!this.host || this.gone.has(peer)) return;
    this.gone.add(peer);
    const pid = this.playerOf.get(peer);
    if (pid !== undefined && [...this.playerOf].every(([p, i]) => i !== pid || this.gone.has(p))) this.collected.push([pid, { c: 'left' }]);
    else if (pid !== undefined) this.game.peerLeft?.(peer, pid);
    this.checkLoaded();
  }

  togglePause() {
    if (!this.host) {
      this.game.message('Only the host can pause the game.', 'bad');
      return;
    }
    if (this.game.paused) {
      this.session.broadcast({ k: 'resume', n: this.pausedAt });
      this.lift(this.pausedAt);
    } else this.command({ c: 'pause' });
  }
  setSpeed(s) {
    if (!this.host && !this.game.anyoneSetsSpeed) {
      this.game.message('Only the host can change the game speed.', 'bad');
      return;
    }
    this.command({ c: 'speed', s });
  }
  lift(n) {
    this.resumed = Math.max(this.resumed, n);
    if (this.pausedAt <= this.resumed) this.game.paused = false;
  }

  say(text, team) {
    text = String(text || '')
      .slice(0, 200)
      .trim();
    if (!text) return;
    if (text.toLowerCase() === '/stalls') {
      this.stalls.show(`You: ${this.stalls.report()}`);
      console.info('[stalls]', this.stalls.report(true));
      if (this.host) this.session.broadcast({ k: 'stallq' });
      else this.session.send(0, { k: 'stallq' });
      return;
    }
    if (this.host) this.chat(this.hostPlayer, text, team);
    else this.session.send(0, { k: 'chat', text, team });
  }
  chat(pid, text, team) {
    text = String(text || '')
      .slice(0, 200)
      .trim();
    const from = this.player(pid);
    if (!text || !from) return;
    for (const [peer, id] of this.playerOf) {
      if (this.gone.has(peer)) continue;
      const to = this.player(id);
      if (team && to.team !== from.team) continue;
      if (peer === 0) this.game.chatLine?.(from, text, team);
      else this.session.send(peer, { k: 'chat', from: pid, text, team });
    }
  }

  waitingFor() {
    if (!this.host) return [this.player(this.hostPlayer)?.name || 'the host'];
    const n = Math.floor(this.tick / TURN);
    return this.peers
      .filter(p => !this.gone.has(p) && (this.ackOf.get(p) ?? -1) < n - MAX_AHEAD)
      .map(p => this.player(this.playerOf.get(p))?.name || 'a player');
  }

  desync(n) {
    this.desynced = true;
    this.game.message(`The battle has drifted apart between the players (turn ${n}). It goes on, but no longer in agreement.`, 'bad');
    console.warn('[lockstep] desync at turn', n);
  }

  behind() {
    return this.host ? 0 : Math.max(0, Math.max(...this.turns.keys(), 0) - Math.floor(this.tick / TURN) - DELAY);
  }

  step() {
    if (!this.started) return false;
    const n = Math.floor(this.tick / TURN);
    if (this.tick % TURN === 0 && !this.turnBegun) {
      if (this.host) {
        const late = this.peers.filter(p => !this.gone.has(p) && (this.ackOf.get(p) ?? -1) < n - MAX_AHEAD);
        if (late.length) {
          this.blocked = 'waiting for ' + late.map(p => this.player(this.playerOf.get(p))?.name || 'a player').join(', ');
          return false;
        }
        while (this.issued < n + DELAY) {
          const t = ++this.issued,
            cmds = this.collected.splice(0);
          this.turns.set(t, cmds);
          this.session.broadcast({ k: 'turn', n: t, cmds });
        }
      }
      const cmds = this.turns.get(n);
      if (!cmds) {
        this.blocked = 'no turn yet from the host';
        return false;
      }
      this.turns.delete(n);
      this.turnBegun = true;
      if (n % HASH_EVERY === 0) {
        const h = this.game.hashState ? this.game.hashState() : stateHash(this.game.world);
        this.hashes.set(n, h);
        if (this.log.length < 10000) this.log.push(h);
      }
      if (this.hashes.size > 64) this.hashes.delete(this.hashes.keys().next().value);
      this.blocked = null;
      for (const [pid, cmd] of cmds) {
        const player = this.player(pid);
        if (!player) continue;
        if (cmd.c === 'pause') {
          if (pid === this.hostPlayer && n > this.resumed) {
            this.pausedAt = n;
            this.game.paused = true;
          }
          continue;
        }
        if (cmd.c === 'speed') {
          if ((pid === this.hostPlayer || this.game.anyoneSetsSpeed) && (this.game.speeds || [0.5, 1, 2, 4]).includes(+cmd.s)) {
            this.game.speed = +cmd.s;
            this.game.speedChanged?.(player);
          }
          continue;
        }
        if (cmd.c === 'left') {
          if (player.left) continue;
          const ai = this.game.takeOver(player, pid);
          this.game.message(`${player.name} has left the game.${ai ? ' The computer takes over their forces.' : ''}`, 'bad');
        }
        let r;
        try {
          r = this.game.execute ? this.game.execute(pid, cmd) : execute(this.game.world, player, cmd);
        } catch (e) {
          console.error('[lockstep] command', cmd, e);
          continue;
        }
        if (pid === this.playerOf.get(this.me)) this.game.commandResult(cmd, r);
      }
    }
    return true;
  }

  stepped() {
    this.tick++;
    if (this.tick % TURN === 0) {
      this.turnBegun = false;
      const n = this.tick / TURN - 1;
      if (!this.host) this.session.send(0, n % HASH_EVERY === 0 ? { k: 'ack', n, h: this.hashes.get(n) } : { k: 'ack', n });
    }
  }
}

class StallLog {
  constructor(lock) {
    this.lock = lock;
    this.list = [];
    this.ep = null;
    this.last = 0;
    this.lastStep = 0;
    this.pings = new Map();
  }

  frame(owed, limit, extra, stepMs) {
    const L = this.lock,
      g = L.game,
      now = performance.now(),
      gap = this.last ? now - this.last : 0;
    this.last = now;
    if (!L.started || g.paused || g.over) {
      this.end(now);
      if (g.over && !this.told) {
        this.told = true;
        clearInterval(L.pinger);
        console.info('[stalls] battle over:', this.report(true));
      }
      return;
    }
    if (gap >= 250 && !document.hidden && this.lastStep < gap / 2) this.add('browser pause', gap);
    this.lastStep = stepMs;
    const cause = owed > limit ? extra || L.blocked || 'slow steps' : stepMs > 40 ? 'slow steps' : null;
    if (cause !== (this.ep && this.ep.cause)) {
      this.end(now);
      if (cause) this.ep = { cause, start: now, at: L.clock() };
    }
  }
  end(now) {
    if (this.ep) {
      this.add(this.ep.cause, now - this.ep.start, this.ep.at);
      this.ep = null;
    }
  }
  add(cause, ms, at = this.lock.clock()) {
    if (ms < 100) return;
    this.list.push({ cause, ms, at });
    if (this.list.length > 2000) this.list.shift();
  }

  ping(peer, ms) {
    const l = this.pings.get(peer) || [];
    l.push(ms);
    if (l.length > 300) l.shift();
    this.pings.set(peer, l);
  }

  report(full = false) {
    const L = this.lock,
      clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      sec = ms => (ms / 1000).toFixed(1) + ' s';
    const by = new Map();
    for (const e of this.list) {
      const b = by.get(e.cause) || { n: 0, ms: 0, max: 0 };
      b.n++;
      b.ms += e.ms;
      b.max = Math.max(b.max, e.ms);
      by.set(e.cause, b);
    }
    const total = this.list.reduce((a, e) => a + e.ms, 0);
    let out =
      `at ${clock(L.clock())}: ` +
      (this.list.length
        ? `${this.list.length} stall${this.list.length === 1 ? '' : 's'}, ${sec(total)} in all - ` +
          [...by]
            .sort((a, b) => b[1].ms - a[1].ms)
            .map(([c, b]) => `${c} ${b.n}x ${sec(b.ms)} (longest ${sec(b.max)})`)
            .join('; ')
        : 'no stalls');
    const links = [...this.pings].map(([peer, l]) => {
      const s = l.slice().sort((a, b) => a - b),
        name = peer === 0 ? 'host' : L.player(L.playerOf.get(peer))?.name || 'player';
      return `${name} ${(L.session.linkMode && L.session.linkMode(peer)) || '?'} ping ${Math.round(s[s.length >> 1])} ms (worst ${Math.round(s[s.length - 1])})`;
    });
    if (links.length) out += '. Links: ' + links.join(', ');
    if (full && this.list.length)
      out +=
        '\nLongest: ' +
        this.list
          .slice()
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 10)
          .map(e => `${clock(e.at)} ${e.cause} ${sec(e.ms)}`)
          .join(' | ');
    return out;
  }

  show(text) {
    this.lock.game.message(text, '', '', 30000);
  }
}
