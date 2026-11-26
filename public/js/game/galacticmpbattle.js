import { db } from '../gamedata.js';
import { isTacticalSuperweapon } from './tacticalsuperweapon.js';

const key = x => String(x || '').toUpperCase();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// the tactical battle runs on the very same setup object and swaps unit type names for the types themselves
const typeOf = t => (typeof t === 'string' ? db.type(t) : t && typeof t.list === 'function' ? t : null);
// Lockstep ticks a PvP battle waits for every side's report before taking the tactical host's.
export const REPORT_TIMEOUT = 1800;

// The parts of a reported tactical result that the battle could have produced; null when it is not about this battle.
export function checkedResult(galaxy, b, r) {
  const cb = b?.setup?.campaign,
    sides = [b?.attacker, b?.defender],
    land = b?.mode === 'land';
  if (!cb || !r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (r.planet !== undefined && r.planet !== b.p) return null;
  if (r.mode !== undefined && r.mode !== b.mode) return null;
  if (r.sides !== undefined && (!Array.isArray(r.sides) || r.sides.length !== 2 || r.sides.some((f, i) => key(f) !== key(sides[i]))))
    return null;
  if (r.winner !== 'attacker' && r.winner !== 'defender') return null;
  const roster = new Map();
  for (const [list, side] of [
    [cb.attacker?.units, 0],
    [cb.defender?.units, 1],
    [land ? cb.defender?.structures : cb.defender?.orbital, 1]
  ])
    for (const u of list || []) roster.set(String(u.gid), { side, type: typeOf(u.type) });
  const sideOf = owner => sides.find(f => key(f) === key(owner)),
    list = v => (Array.isArray(v) ? v : []);
  const out = {
    mode: b.mode,
    planet: b.p,
    sides,
    winner: r.winner,
    alive: [...new Set(list(r.alive).filter(id => typeof id === 'string' && roster.has(id)))].sort()
  };
  if (Number.isInteger(r.victoryType)) out.victoryType = r.victoryType;
  const pl = galaxy.planets[b.p];
  if (land) {
    out.participants = list(cb.attacker?.units).map(u => String(u.gid));
    if (Array.isArray(r.tacticalStructures))
      out.tacticalStructures = r.tacticalStructures
        .flatMap(u => {
          const owner = sideOf(u?.owner),
            pos = Array.isArray(u?.position) ? u.position.slice(0, 3) : [];
          return owner && typeof u.type === 'string' && db.type(u.type) && pos.length >= 2 && pos.every(Number.isFinite)
            ? [{ type: u.type, owner, position: pos }]
            : [];
        })
        .slice(0, 256);
  } else {
    const fought = !!cb.defender?.station;
    out.station = fought ? !!r.station : !!pl?.station;
    // which starbase and orbital structures were in the battle comes from the setup, never from the report
    out.stationFought = cb.defender?.station || null;
    out.orbitalFought = list(cb.defender?.orbital).map(o => String(o.gid));
    if (fought && r.station && Number.isInteger(r.stationLevel) && r.stationLevel >= 0) out.stationLevel = r.stationLevel;
    out.superweapons = list(r.superweapons).flatMap(w => {
      const at = typeof w?.gid === 'string' && roster.get(w.gid);
      return at && key(w.owner) === key(sides[at.side]) && at.type?.list('CategoryMask').some(m => /^super$/i.test(m))
        ? [{ gid: w.gid, owner: sides[at.side] }]
        : [];
    });
    const by = sideOf(r.planetDestroyedBy);
    if (
      r.planetDestroyed === true &&
      by &&
      pl &&
      !pl.destroyed &&
      pl.type.bool('Planet_Is_Destroyable_By_TSW', true) &&
      [...roster.values()].some(u => sides[u.side] === by && u.type && isTacticalSuperweapon(u.type))
    ) {
      out.planetDestroyed = true;
      out.planetDestroyedBy = by;
    }
  }
  if (r.credits && typeof r.credits === 'object') {
    out.credits = {};
    for (const side of sides) {
      const id = key(side),
        t = cb.treasury?.[id],
        v = r.credits[id];
      if (!t || !v || typeof v !== 'object' || !Number.isFinite(v.credits)) continue;
      const before = Math.max(0, t.credits || 0),
        cap = !cb.skirmishRules && Number.isFinite(t.cap) ? Math.max(before, t.cap * (t.ai ? Math.max(1, t.adjust ?? 1) : 1)) : before,
        credits = clamp(v.credits, 0, cap);
      out.credits[id] = t.ai
        ? { credits, ai: true, delta: clamp(Number.isFinite(v.delta) ? v.delta : 0, -before, cap), parts: t.parts || [] }
        : { credits, ai: false };
    }
  }
  // story events the battle held back (a lost mission); nothing else is ever replayed from these
  if (Array.isArray(r.storyDelayed))
    out.storyDelayed = r.storyDelayed
      .flatMap(d => (d?.type === 'STORY_MISSION_LOST' && typeof d.name === 'string' ? [{ type: d.type, name: d.name.slice(0, 128) }] : []))
      .slice(0, 16);
  if (Array.isArray(r.upgradesBuilt))
    out.upgradesBuilt = r.upgradesBuilt
      .flatMap(u => {
        const owner = sideOf(u?.owner);
        return owner && typeof u.type === 'string' && db.type(u.type) ? [{ type: u.type, owner }] : [];
      })
      .slice(0, 64);
  return out;
}

export function channel(session, tag) {
  const offs = [];
  const sub = off => (offs.push(off), off);
  return {
    get id() {
      return session.id;
    },
    on(ev, fn) {
      if (ev === 'message')
        return sub(
          session.on('message', (from, m) => {
            if (m && m.k === tag) fn(from, m.m);
          })
        );
      return sub(session.on(ev, fn));
    },
    send(to, m) {
      session.send(to, { k: tag, m });
    },
    broadcast(m, except) {
      session.broadcast({ k: tag, m }, except);
    },
    linkMode: peer => session.linkMode?.(peer),
    close() {
      for (const off of offs.splice(0)) off();
    }
  };
}

export class MpBattles {
  constructor(game) {
    this.game = game;
    this.count = 0;
    this.current = null;
  }

  humansOf(b) {
    return [b.attacker, b.defender].filter(f => this.game.isHuman(f));
  }

  begin(b) {
    const game = this.game;
    b.id = ++this.count;
    const humans = this.humansOf(b),
      net = game.setup.net;
    b.humans = humans;
    b.setup = b.mode === 'land' ? game.landBattleSetup() : game.battleSetup();
    if (b.mode === 'land' && game.setup.shooter) b.setup.shooter = true;
    b.local = humans.some(f => key(f) === key(game.me));
    if (game.playable(humans)) {
      const peers = f => game.setup.players.filter(p => p.human && !p.left && key(p.faction) === key(f)).map(p => p.peer);
      for (const p of b.setup.players)
        if (p.human) {
          const all = peers(p.faction);
          Object.assign(p, { peer: all[0], peers: all, name: game.playerName(p.faction) });
        }
      b.setup.seed = (Math.imul((game.setup.seed >>> 0) ^ 0x9e3779b9, 31) + b.id * 0x85ebca6b) >>> 0;
      b.tag = 'b' + b.id;
      const fighting = new Set(b.setup.players.flatMap(p => p.peers || []));
      const watching = game.setup.players.filter(p => p.human && !p.left && !fighting.has(p.peer));
      b.setup.spectators = watching.map(p => p.peer);
      b.setup.spectatorNames = watching.map(p => p.name);
      b.spectator = b.setup.spectators.includes(net.me);
      b.local = b.local || b.spectator;
      if (b.local && b.setup.shooter)
        b.setup.shooterNet = {
          role: net.me === 0 ? 'host' : 'client',
          session: channel(net.session, b.tag),
          me: net.me,
          name: game.playerName?.(game.me) || 'Host',
          spectator: b.spectator
        };
      else if (b.local) b.setup.net = { session: channel(net.session, b.tag), me: net.me, spectators: b.setup.spectators };
    }
    this.current = b;
  }

  left(faction, pid, gone = true) {
    const game = this.game,
      b = this.current;
    game.pendingBattle?.left?.(pid, faction, gone);
    if (!b || b.done || !gone) return;
    b.humans = b.humans.filter(f => key(f) !== key(faction));
    if (b.humans.length) return this.settle(b);
    this.autoresolve(b);
  }

  // nobody is left to fight it, or no usable report came in: resolve it the same way on every machine
  autoresolve(b) {
    const game = this.game;
    b.done = true;
    this.closeFrame(b);
    b.setup.net?.session?.close?.();
    b.setup.shooterNet?.session?.close?.();
    this.current = null;
    game.battle = null;
    if (game.fadeEl) game.fadeEl.style.opacity = '0';
    game.battles.resolveFor({
      p: b.p,
      attacker: b.attacker,
      defender: b.defender,
      mode: b.mode,
      options: { records: b.records || (b.invasionIds ? game.battles.landRecords(b.invasionIds) : []) }
    });
    game.syncFleetViews();
  }

  launch(b) {
    const game = this.game;
    if (!b.local) {
      game.message(this.waitText(b));
      return;
    }
    game.planetInfo?.close();
    game.galacticLog?.close();
    game.storyDialog?.close?.();
    game.baseLayout?.close?.();
    game.menus?.closeAll?.();
    game.keys?.clear();
    if (game.mouse) game.mouse.in = false;
    game.setUIPause('mp-battle', true);
    this.music = game.audio?.music;
    this.musicPlaying = !!this.music && !this.music.paused;
    this.audioRunning = game.audio?.ctx?.state === 'running';
    this.music?.pause();
    game.audio?.setLoops?.([]);
    game.audio?.ctx?.suspend();
    const frame = (b.frame = document.createElement('iframe'));
    frame.title = 'Tactical battle';
    frame.allow = 'autoplay';
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483646;background:#000';
    this.covered = Array.from(document.body.children || []).map(el => [el, el.inert]);
    for (const [el] of this.covered) el.inert = true;
    game.modeSuspended = true;
    const url = new URL('../../play.html', import.meta.url);
    url.searchParams.set('mp-battle', String(b.id));
    frame.src = url.href;
    document.body.appendChild(frame);
    frame.focus();
  }

  waitText(b) {
    const g = this.game.galaxy,
      planet = g.planets[b.p],
      name = db.t(planet?.type.str('Text_ID')) || planet?.name || '';
    return `${b.humans.map(f => this.game.playerName(f)).join(' and ')} ${b.humans.length > 1 ? 'are' : 'is'} fighting at ${name}. The galaxy waits until the battle is over.`;
  }

  returned(result) {
    const b = this.current;
    if (!b || b.sent) return;
    b.sent = true;
    const { galaxy, ...r } = result || {};
    this.closeFrame(b);
    this.game.message('Waiting for the battle to be taken into the galaxy...');
    this.game.order({ c: 'result', id: b.id, r });
  }

  hostPeer(b) {
    const fighting = (b.setup?.players || []).flatMap(p => p.peers || []);
    return fighting.includes(0) ? 0 : fighting.length ? Math.min(...fighting) : undefined;
  }

  result(faction, id, r, pid) {
    const game = this.game,
      b = this.current;
    if (!b || b.id !== id || b.done) return;
    const peer = game.setup.players?.[pid]?.peer;
    if (b.setup?.shooter ? peer !== 0 : !b.humans.some(f => key(f) === key(faction))) return;
    let v = null;
    try {
      v = checkedResult(game.galaxy, b, r);
    } catch (error) {
      console.error(error);
    }
    if (!v) {
      console.warn(`Battle ${id}: ignored a result from ${game.playerName?.(faction) || faction} that does not match the battle`);
      // still start the clock, so a battle whose every report is refused can't hold the galaxy forever
      b.reports ||= new Map();
      b.refused = (b.refused || 0) + 1;
      return this.settle(b);
    }
    if (b.setup?.shooter) return this.finish(b, v);
    const reports = (b.reports ||= new Map()),
      report = { faction: key(faction), peer, r: v, digest: JSON.stringify(v) };
    if (!reports.has(report.faction)) reports.set(report.faction, report);
    b.first ||= report;
    if (peer === this.hostPeer(b)) b.hostReport = report;
    this.settle(b);
  }

  // Every human side has to report the same result; otherwise the tactical host's report stands.
  settle(b) {
    if (!b || b.done || !b.reports) return;
    const got = b.humans.map(f => b.reports.get(key(f))).filter(Boolean),
      split = new Set(got.map(x => x.digest)).size > 1;
    if (!split && got.length && got.length === b.humans.length) return this.finish(b, got[0].r);
    if (!split && (b.waited || 0) < REPORT_TIMEOUT) return;
    const host = this.hostPeer(b),
      hostFaction = key(this.game.setup.players?.find(p => p.human && p.peer === host)?.faction),
      fallback = b.hostReport || b.reports.get(hostFaction);
    if (fallback) {
      console.warn(
        `Battle ${b.id}: ${split ? 'the sides reported different results' : 'not every side reported a result'}; using the tactical host's report`
      );
      return this.finish(b, fallback.r);
    }
    // the host's report never came: after the wait take the first usable one, or resolve the battle if there is none
    if ((b.waited || 0) < REPORT_TIMEOUT) return;
    if (b.first) {
      console.warn(`Battle ${b.id}: the tactical host sent no result; using the first report that came in`);
      return this.finish(b, b.first.r);
    }
    console.warn(`Battle ${b.id}: no usable battle result came in; resolving the battle automatically`);
    this.autoresolve(b);
  }

  tick() {
    const b = this.current;
    if (!b || b.done || !b.reports) return;
    if ((b.waited = (b.waited || 0) + 1) >= REPORT_TIMEOUT) this.settle(b);
  }

  finish(b, r) {
    const game = this.game;
    b.done = true;
    this.closeFrame(b);

    b.setup.net?.session?.close?.();
    b.setup.shooterNet?.session?.close?.();
    this.current = null;
    game.battle = null;
    if (game.fadeEl) game.fadeEl.style.opacity = '0';
    game.applyResult(r);
    game.galacticBattleChanged();
    game.ai?.invalidate();
    game.syncFleetViews();
    game.ui?.refresh();
    game.overview?.refresh();
    game.radar?.refresh();
  }

  closeFrame(b) {
    if (!b.frame) return;
    const child = b.frame.contentWindow?.game,
      game = this.game;
    if (child) {
      child.paused = true;
      child.over = true;
      child.missTicker?.stop?.();
      child.tacticalMovies?.dispose?.();
      child.audio?.stopMusic?.();
      child.audio?.ctx?.close?.();
      const renderer = child.renderer?.renderer || child.renderer;
      renderer?.dispose?.();
      renderer?.forceContextLoss?.();
    }
    b.frame.remove();
    b.frame = null;
    for (const [el, inert] of this.covered || []) el.inert = inert;
    game.setUIPause('mp-battle', false);
    if (this.audioRunning) game.audio?.ctx?.resume();
    if (this.musicPlaying && game.audio?.music === this.music) this.music.play().catch(() => {});
    game.modeSuspended = false;
    game.last = performance.now();
    game.fit();
    requestAnimationFrame(game.frame);
  }
}

export function mpBattleParent() {
  if (typeof window === 'undefined' || window.parent === window) return null;
  try {
    const parent = window.parent.game,
      b = parent?.mpBattles?.current;
    return b?.frame?.contentWindow === window ? parent : null;
  } catch {
    return null;
  }
}
