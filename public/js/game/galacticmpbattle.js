import { db } from '../gamedata.js';

const key = x => String(x || '').toUpperCase();

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
    b.local = humans.some(f => key(f) === key(game.me));
    if (humans.length >= 2 || (game.setup.singlePlayerCampaign && humans.length)) {
      const peers = f => game.setup.players.filter(p => p.human && !p.left && key(p.faction) === key(f)).map(p => p.peer);
      for (const p of b.setup.players)
        if (p.human) {
          const all = peers(p.faction);
          Object.assign(p, { peer: all[0], peers: all, name: game.playerName(p.faction) });
        }
      b.setup.seed = (Math.imul((game.setup.seed >>> 0) ^ 0x9e3779b9, 31) + b.id * 0x85ebca6b) >>> 0;
      b.tag = 'b' + b.id;
      const fighting = new Set(b.setup.players.flatMap(p => p.peers || []));
      b.setup.spectators = game.setup.players.filter(p => p.human && !p.left && !fighting.has(p.peer)).map(p => p.peer);
      b.spectator = b.setup.spectators.includes(net.me);
      b.local = b.local || b.spectator;
      if (b.local) b.setup.net = { session: channel(net.session, b.tag), me: net.me, spectators: b.setup.spectators };
    }
    this.current = b;
  }

  left(faction, pid, gone = true) {
    const game = this.game,
      b = this.current;
    game.pendingBattle?.left?.(pid, faction, gone);
    if (!b || b.done || !gone) return;
    b.humans = b.humans.filter(f => key(f) !== key(faction));
    if (b.humans.length) return;
    b.done = true;
    this.closeFrame(b);
    b.setup.net?.session?.close?.();
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

  result(faction, id, r) {
    const game = this.game,
      b = this.current;
    if (!b || b.id !== id || b.done || !b.humans.some(f => key(f) === key(faction)) || !r || typeof r !== 'object') return;
    b.done = true;
    this.closeFrame(b);

    b.setup.net?.session?.close?.();
    this.current = null;
    game.battle = null;
    if (game.fadeEl) game.fadeEl.style.opacity = '0';
    game.applyResult({ ...r, mode: b.mode, planet: b.p, sides: [b.attacker, b.defender] });
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
