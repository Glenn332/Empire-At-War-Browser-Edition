import { Lockstep, TURN } from './netgame.js';
import { ticker } from '../net.js';
import { simRandomState } from './simrandom.js';
import { db } from '../gamedata.js';

export const GTICK = 1 / 30;
const key = x => String(x || '').toUpperCase();

export function galaxyHash(game) {
  const g = game.galaxy;
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
  const mixStr = s => {
    s = String(s || '');
    mixInt(s.length);
    for (let i = 0; i < s.length; i++) mixInt(s.charCodeAt(i));
  };
  mix(g.time);
  for (const x of simRandomState()) mixInt(x);
  for (const p of g.players) {
    mixStr(p.faction);
    mix(p.credits);
    mixInt(p.tech);
    mixStr(p.ai);
  }
  for (const p of g.planets) {
    mixStr(p.owner);
    mixStr(p.station?.name);
    mixInt(p.spaceLevel);
    mixInt(p.garrison.length);
    mixInt(p.groundStructures.length);
    mixInt(p.orbitalStructures.length);
    for (const k of ['space', 'ground'])
      for (const q of p.production[k]) {
        mixStr(q.type?.name);
        mix(q.left);
      }
  }
  mixInt(g.fleets.length);
  for (const f of g.fleets) {
    mixStr(f.owner);
    mixInt(f.planet);
    mixInt(f.dest);
    mixInt(f.units.length);
    for (const u of f.units) mixStr(u.type?.name);
    if (f.pos) {
      mix(f.pos[0]);
      mix(f.pos[1]);
    }
  }
  return h >>> 0;
}

export function recordRef(g, u) {
  if (!u) return null;
  for (let fi = 0; fi < g.fleets.length; fi++) {
    const ui = g.fleets[fi].units.indexOf(u);
    if (ui >= 0) return ['f', fi, ui];
  }
  for (const p of g.planets)
    for (const [w, list] of [
      ['g', p.garrison],
      ['s', p.groundStructures],
      ['o', p.orbitalStructures]
    ]) {
      const i = list.indexOf(u);
      if (i >= 0) return [w, p.index, i];
    }
  return null;
}
export function fromRecordRef(g, r) {
  if (!Array.isArray(r)) return null;
  const [w, a, b] = r;
  if (w === 'f') return g.fleets[a]?.units[b] || null;
  const p = g.planets[a];
  return (p && { g: p.garrison, s: p.groundStructures, o: p.orbitalStructures }[w]?.[b]) || null;
}
const fleetRef = (g, f) => (f ? g.fleets.indexOf(f) : -1);
const fleetOf = (g, i) => (Number.isInteger(i) && i >= 0 ? g.fleets[i] || null : null);
const refs = (g, list) => (list ? list.map(u => recordRef(g, u)) : null);
const records = (g, list) => (Array.isArray(list) ? list.map(r => fromRecordRef(g, r)).filter(Boolean) : null);

function sideRef(g, s) {
  return s && { kind: s.kind, planet: s.planet, fleet: fleetRef(g, s.fleet), recs: refs(g, s.records), slot: s.slot };
}
function sideOf(g, s) {
  return s && { kind: s.kind, planet: s.planet, fleet: fleetOf(g, s.fleet), records: records(g, s.recs), slot: s.slot };
}

export const orders = {
  move: (g, f, to, slot = null, extra = {}) => ({
    c: 'move',
    f: fleetRef(g, f),
    to,
    slot,
    raid: !!extra.raid,
    ability: extra.ability ? recordRef(g, extra.ability) : null
  }),
  transfer: (g, f, slot, recs, tf) => ({ c: 'transfer', f: fleetRef(g, f), slot, recs: refs(g, recs), tf: fleetRef(g, tf) }),
  embark: (g, p, { records: recs = null, fleet = null, slot, fresh = false, to = -1 } = {}) => ({
    c: 'embark',
    p,
    recs: refs(g, recs),
    tf: fleetRef(g, fleet),
    slot,
    fresh: !!fresh,
    to
  }),
  land: (g, f, p, recs = null) => ({ c: 'land', f: fleetRef(g, f), p, recs: refs(g, recs) }),
  drop: (g, s, t) => ({ c: 'drop', s: sideRef(g, s), t: sideRef(g, t) }),
  build: (g, p, type) => ({ c: 'build', p, type: type.name }),
  cancel: (g, p, item) => {
    const pl = g.planets[p];
    for (const q of ['space', 'ground']) {
      const i = pl?.production[q].indexOf(item) ?? -1;
      if (i >= 0) return { c: 'cancel', p, q, i, type: item.type.name };
    }
    return null;
  },
  slot: (g, rec, p) => ({ c: 'slot', rec: recordRef(g, rec), p })
};

export function runCommand(game, faction, cmd) {
  const g = game.galaxy,
    own = f => f && key(f.owner) === key(faction);
  switch (cmd.c) {
    case 'move': {
      const f = fleetOf(g, cmd.f);
      if (!own(f) || !g.planets[cmd.to]) return {};
      const hero = cmd.ability ? fromRecordRef(g, cmd.ability) : null;
      if (game.moveFleet(f, cmd.to, Number.isInteger(cmd.slot) ? cmd.slot : null)) {
        if (cmd.raid) f.raid = cmd.to;
        if (hero && f.units.includes(hero)) hero.pendingAbility = cmd.to;
      }
      return {};
    }
    case 'transfer': {
      const f = fleetOf(g, cmd.f),
        tf = fleetOf(g, cmd.tf);
      if (!own(f) || (tf && !own(tf))) return {};
      if (game.transferUnits(f, cmd.slot, records(g, cmd.recs), tf)) game.galacticBattleChanged();
      return {};
    }
    case 'embark': {
      const tf = fleetOf(g, cmd.tf);
      if (tf && !own(tf)) return {};
      if (cmd.fresh) {
        const f = game.embarkFresh(cmd.p, cmd.slot);
        if (f && g.planets[cmd.to]) game.moveFleet(f, cmd.to, cmd.slot);
      } else game.embark(cmd.p, { records: records(g, cmd.recs), fleet: tf, slot: cmd.slot });
      return {};
    }
    case 'land': {
      const f = fleetOf(g, cmd.f);
      if (own(f)) game.land(f, cmd.p, { records: records(g, cmd.recs) });
      return {};
    }
    case 'drop': {
      const s = sideOf(g, cmd.s),
        t = sideOf(g, cmd.t);
      if (s && t && game.dropUnits(s, t)) game.galacticBattleChanged();
      return {};
    }
    case 'build': {
      const type = db.type(cmd.type);
      if (!type) return {};
      const why = game.queueBuild(cmd.p, type);
      return why ? { why } : { ok: true, type };
    }
    case 'cancel': {
      const item = g.planets[cmd.p]?.production[cmd.q]?.[cmd.i];
      if (item && item.type.name === cmd.type && game.cancelBuild(cmd.p, item)) return { ok: true, type: item.type };
      return {};
    }
    case 'slot': {
      const rec = fromRecordRef(g, cmd.rec),
        p = g.planets[cmd.p];
      if (rec && p && key(rec.owner ?? faction) === key(faction) && game.activateHeroSlot(rec, p, faction)) game.galacticBattleChanged();
      return {};
    }
    case 'battle':
      game.pendingBattle?.answer?.(faction, cmd.id, cmd.choice);
      return {};
    case 'select':
      game.storySelect?.(game.actingPid, cmd.p | 0);
      return {};
    case 'ui':
      game.scriptClick?.(game.actingPid, String(cmd.name || ''), !!cmd.native);
      return {};
    case 'dialog':
      game.dialogDone?.(game.actingPid, cmd.id);
      return {};
    case 'choice':
      game.story?.neutralizeAnswer?.(faction, cmd.id, cmd.index | 0, typeof cmd.gui === 'string' ? cmd.gui : null);
      return {};
    case 'result':
      game.mpBattles?.result(faction, cmd.id, cmd.r);
      return {};
    case 'left':
      return {};
  }
  return {};
}

export class GalacticNet {
  constructor(game, net) {
    this.game = game;
    this.net = net;
    this.lock = new Lockstep(game, net);
    this.owed = 0;
    this.last = 0;
    this.stalled = 0;
  }

  get host() {
    return this.lock.host;
  }

  async ready() {
    await this.lock.ready();
    this.last = performance.now();
    this.ticker = ticker(GTICK * 1000, () => this.pump());
  }

  stop() {
    this.ticker?.stop();
    this.ticker = null;
    clearInterval(this.lock.pinger);
  }

  loading() {
    const g = this.game;
    if (g.ai?.syncing) return 'a computer player coming online';
    if (g.story?.pending?.size) return 'story scripts loading';
    return null;
  }

  pump() {
    const g = this.game,
      L = this.lock;
    if (g.over) {
      this.stop();
      return;
    }
    const now = performance.now(),
      real = Math.max(0, Math.min(0.25, (now - this.last) / 1000));
    this.last = now;
    if (g.battle && !g.battle.gone) g.advanceBattle(real);
    const behind = L.behind();
    if (g.paused) this.owed = 0;
    this.owed = Math.min(this.owed + (g.paused ? 0 : real), (4 + behind * TURN) * GTICK);
    if (behind > 1) this.owed = Math.max(this.owed, Math.min(behind, 3) * GTICK);
    const t0 = performance.now();
    let held = null;
    while (this.owed >= GTICK) {
      held = this.loading();
      if (held || !L.step()) break;
      if (g.paused) {
        this.owed = 0;
        break;
      }
      g.netStep(GTICK * g.speed);
      L.stepped();
      this.owed -= GTICK;
      if (performance.now() - t0 > 60) break;
    }
    L.frame(this.owed / GTICK, 1, held, performance.now() - t0);
    if (L.started && !g.paused && this.owed >= 2 * GTICK) {
      if ((this.stalled += real) > 2 && !this.stallSaid) {
        this.stallSaid = true;
        const who = held ? [] : L.waitingFor();
        g.message(who.length ? `Waiting for ${who.join(', ')}...` : 'Waiting...');
      }
    } else {
      this.stalled = 0;
      this.stallSaid = false;
    }
  }
}
