import { panelOffer, closeOffer } from './panelside.js';
import { Lockstep, TURN } from './netgame.js';
import { ticker } from '../net.js';
import { simRandomState } from './simrandom.js';
import { db } from '../gamedata.js';
import { snapshot, putSave } from './savegame.js';
import { embarkLayoutCompany, landLayoutCompany } from './baselayoutdata.js';
import { carriedCompany } from './invasion.js';
import { humanPath } from './fleets.js';
import { choicesOf, executeCorruption } from './galacticcorruption.js';
import { executeSlice } from './galacticslicer.js';
import { executeHack } from './galactichack.js';
import { sabotageStructure } from './galacticsabotage.js';
import { completePurchase } from './blackmarket.js';
import { locateRecord } from './galacticsell.js';
import { isRaidForce } from './raid.js';

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
    mixInt(f.nid);
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

// by stable id where the simulation stamped one (multiplayer), else by position
export function recordRef(g, u) {
  if (!u) return null;
  if (Number.isInteger(u.nid)) return ['n', u.nid];
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
  if (w === 'n') return Number.isInteger(a) ? recordById(g, a) : null;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  if (w === 'f') return g.fleets[a]?.units[b] || null;
  const p = g.planets[a];
  return (p && { g: p.garrison, s: p.groundStructures, o: p.orbitalStructures }[w]?.[b]) || null;
}
function recordById(g, id) {
  for (const f of g.fleets) for (const u of f.units) if (u.nid === id) return u;
  for (const p of g.planets)
    for (const l of [p.garrison, p.groundStructures, p.orbitalStructures]) for (const u of l) if (u.nid === id) return u;
  return null;
}
// fleet units carry no owner of their own: ask where the record sits, so another faction's hero can't be borrowed
const ownsRecord = (g, rec, faction, planet = null) => {
  const at = !rec?.dead && locateRecord(g, rec);
  return !!at && key(at.owner) === key(faction) && (!planet || at.planet === planet.index);
};
export const fleetRef = (g, f) => (!f ? -1 : Number.isInteger(f.nid) ? ['n', f.nid] : g.fleets.indexOf(f));
const fleetOf = (g, r) =>
  Array.isArray(r)
    ? (r[0] === 'n' && Number.isInteger(r[1]) && g.fleets.find(f => f.nid === r[1])) || null
    : Number.isInteger(r) && r >= 0
      ? g.fleets[r] || null
      : null;
// a fleet the order named that is gone by now: the order is dropped rather than run on whatever took its place
const lostFleet = (g, r) => r != null && r !== -1 && !fleetOf(g, r);
const refs = (g, list) => (list ? list.map(u => recordRef(g, u)) : null);
const records = (g, list) => (Array.isArray(list) ? list.map(r => fromRecordRef(g, r)).filter(Boolean) : null);
const lostRecords = (g, list) => Array.isArray(list) && records(g, list).length !== list.length;

function sideRef(g, s) {
  return s && { kind: s.kind, planet: s.planet, fleet: fleetRef(g, s.fleet), recs: refs(g, s.records), slot: s.slot, pf: !!s.pf };
}
const SIDE_KINDS = new Set(['fleet', 'ground']);
const index = v => v == null || Number.isInteger(v);
const fleetIndex = v => index(v) || (Array.isArray(v) && v[0] === 'n' && Number.isInteger(v[1]));
function sideOf(g, s) {
  if (!s || typeof s !== 'object' || !SIDE_KINDS.has(s.kind) || !Number.isInteger(s.planet) || !fleetIndex(s.fleet) || !index(s.slot))
    return null;
  if (lostFleet(g, s.fleet) || lostRecords(g, s.recs)) return null;
  return { kind: s.kind, planet: s.planet, fleet: fleetOf(g, s.fleet), records: records(g, s.recs), slot: s.slot, pf: !!s.pf };
}

export const orders = {
  move: (g, f, to, slot = null, extra = {}) => ({
    c: 'move',
    f: fleetRef(g, f),
    to,
    slot,
    raid: !!extra.raid,
    ability: extra.ability ? recordRef(g, extra.ability) : null,
    path: humanPath(g, f, to)
  }),
  transfer: (g, f, slot, recs, tf) => ({ c: 'transfer', f: fleetRef(g, f), slot, recs: refs(g, recs), tf: fleetRef(g, tf) }),
  embark: (g, p, { records: recs = null, fleet = null, slot, fresh = false, to = -1 } = {}) => ({
    c: 'embark',
    p,
    recs: refs(g, recs),
    tf: fleetRef(g, fleet),
    slot,
    fresh: !!fresh,
    to,
    path:
      fresh && g.planets[to]
        ? humanPath(g, { owner: g.planets[p]?.garrison.find(u => u.owner)?.owner, units: recs || g.planets[p]?.garrison || [] }, to, p)
        : null
  }),
  land: (g, f, p, recs = null, raid = false) => ({ c: 'land', f: fleetRef(g, f), p, recs: refs(g, recs), raid: !!raid }),
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
  slot: (g, rec, p) => ({ c: 'slot', rec: recordRef(g, rec), p }),
  sell: (g, rec) => ({ c: 'sell', rec: recordRef(g, rec) })
};

// planet, slot and list indices must be plain integers (fleets may also be named by id): a string "3" still finds planet 3 but then
// never matches it again in the battle and blockade checks
const INDEX_FIELDS = ['p', 'to', 'slot', 'i'],
  FLEET_FIELDS = ['f', 'tf'],
  COUNTED_IDS = new Set(['marker', 'layoutLand', 'choice', 'battle', 'result']);
const validCommand = cmd =>
  !!cmd &&
  typeof cmd === 'object' &&
  INDEX_FIELDS.every(k => index(cmd[k])) &&
  FLEET_FIELDS.every(k => fleetIndex(cmd[k])) &&
  (!COUNTED_IDS.has(cmd.c) || Number.isInteger(cmd.id)) &&
  (cmd.c !== 'choice' || Number.isInteger(cmd.index));

export function runCommand(game, faction, cmd) {
  const g = game.galaxy,
    own = f => f && key(f.owner) === key(faction);
  if (!validCommand(cmd)) return {};
  switch (cmd.c) {
    case 'move': {
      const f = fleetOf(g, cmd.f);
      // the sender's route only: a peer finding its own would read its own fog of war and could disagree
      if (!own(f) || !g.planets[cmd.to] || !Array.isArray(cmd.path)) return {};
      const hero = cmd.ability ? fromRecordRef(g, cmd.ability) : null;
      if (game.moveFleet(f, cmd.to, Number.isInteger(cmd.slot) ? cmd.slot : null, Array.isArray(cmd.path) ? cmd.path : null)) {
        if (cmd.raid) f.raid = cmd.to;
        if (hero && f.units.includes(hero)) hero.pendingAbility = cmd.to;
      }
      return {};
    }
    case 'transfer': {
      const f = fleetOf(g, cmd.f),
        tf = fleetOf(g, cmd.tf);
      if (!own(f) || (tf && !own(tf)) || lostFleet(g, cmd.tf) || lostRecords(g, cmd.recs)) return {};
      if (game.transferUnits(f, cmd.slot, records(g, cmd.recs), tf)) game.galacticBattleChanged();
      return {};
    }
    case 'embark': {
      const tf = fleetOf(g, cmd.tf);
      if ((tf && !own(tf)) || lostFleet(g, cmd.tf) || lostRecords(g, cmd.recs)) return {};
      if (cmd.fresh) {
        if (g.planets[cmd.to] && !Array.isArray(cmd.path)) return {};
        const f = game.embarkFresh(cmd.p, cmd.slot);
        if (f && g.planets[cmd.to] && game.moveFleet(f, cmd.to, cmd.slot, Array.isArray(cmd.path) ? cmd.path : null) && cmd.landOn) f.landOn = cmd.to;
      } else game.embark(cmd.p, { records: records(g, cmd.recs), fleet: tf, slot: cmd.slot });
      return {};
    }
    case 'land': {
      const f = fleetOf(g, cmd.f);
      if (own(f) && !lostRecords(g, cmd.recs)) game.land(f, cmd.p, { records: records(g, cmd.recs), raid: !!cmd.raid && isRaidForce(f) });
      return {};
    }
    case 'drop': {
      const s = sideOf(g, cmd.s),
        t = sideOf(g, cmd.t);
      if (s && t && (s.kind !== 'fleet' || s.fleet) && game.dropUnits(s, t)) game.galacticBattleChanged();
      return {};
    }
    case 'build': {
      const type = db.type(cmd.type);
      if (!type) return {};
      const why = game.queueBuild(cmd.p, type);
      return why ? { why } : { ok: true, type };
    }
    case 'cancel': {
      const item = (cmd.q === 'space' || cmd.q === 'ground') && g.planets[cmd.p]?.production[cmd.q]?.[cmd.i];
      if (item && item.type.name === cmd.type && game.cancelBuild(cmd.p, item)) return { ok: true, type: item.type };
      return {};
    }
    case 'slot': {
      const rec = fromRecordRef(g, cmd.rec),
        p = g.planets[cmd.p];
      if (rec && p && ownsRecord(g, rec, faction) && game.activateHeroSlot(rec, p, faction)) game.galacticBattleChanged();
      return {};
    }
    case 'marker': {
      const rec = fromRecordRef(g, cmd.rec),
        p = g.planets[cmd.p];
      if (!rec || !p || key(p.owner) !== key(faction) || !ownsRecord(g, rec, faction, p) || !Number.isInteger(cmd.id)) return {};
      rec.markerId = cmd.id;
      return { ok: true };
    }
    case 'layoutEmbark': {
      const p = g.planets[cmd.p];
      return p && embarkLayoutCompany(g, p, faction, fromRecordRef(g, cmd.rec)) ? { ok: true, layout: true } : {};
    }
    case 'layoutLand': {
      const p = g.planets[cmd.p],
        fleet = fleetOf(g, cmd.f),
        unit = fromRecordRef(g, cmd.unit),
        type = unit && carriedCompany(unit),
        marker = { id: cmd.id, type: { name: String(cmd.marker || '') } };
      if (!p || !fleet || !unit || !type) return {};
      const target = { marker, record: p.garrison.find(u => u.markerId === cmd.id) || null };
      return landLayoutCompany(g, p, faction, { fleet, unit, type }, target) ? { ok: true, layout: true } : {};
    }
    case 'panel': {
      const rec = fromRecordRef(g, cmd.rec),
        planet = g.planets[cmd.p];
      if (!rec || !planet || !ownsRecord(g, rec, faction)) return {};
      // only a row the game offered this hero here, at the price it rolled
      const offer = panelOffer(game, rec, cmd.kind, planet);
      if (!offer || key(offer.owner) !== key(faction)) return {};
      const actor = game.story?.object?.(rec, planet, faction)?.__object || { owner: faction, record: rec, type: rec.carries || rec.type };
      const credits = g.players.find(p => key(p.faction) === key(faction))?.credits ?? 0;
      let done = false,
        spent = false;
      if (cmd.kind === 'corruption') {
        const choice = choicesOf(planet.type).find(c => c.slot === cmd.slot);
        done = !!choice && executeCorruption(game, actor, planet, choice);
      } else if (cmd.kind === 'slice') {
        const row = offer.rows.find(r => key(r.type.name) === key(cmd.type));
        spent = !!row && row.cost <= credits;
        done = !!row && executeSlice(game, actor, planet, row, offer.only, offer.respawn);
      } else if (cmd.kind === 'hack') done = executeHack(game, actor, planet);
      else if (cmd.kind === 'sabotage') {
        const structure = fromRecordRef(g, cmd.s),
          row = structure && offer.rows.find(r => r.structure === structure);
        done = !!row && sabotageStructure(game, actor, planet, structure, row.price);
      } else if (cmd.kind === 'market') {
        const row = offer.rows.find(r => key(r.item.name) === key(cmd.item));
        if (row) {
          game.story?.signal?.('STORY_BUY_BLACK_MARKET', row.item.name);
          done = completePurchase(game, actor, planet, row, offer.respawn);
        }
      }
      if (done || spent) closeOffer(game, rec);
      if (done) game.galacticBattleChanged?.();
      return done ? { ok: true } : {};
    }
    case 'save': {
      const mine = game.actingPid === game.localPid,
        name = String(cmd.name || '').slice(0, 64);
      // another player's saves are written here at most every 30 seconds: each one serializes the whole galaxy
      const last = (game.netSavedAt ||= new Map()),
        now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (!mine && now - (last.get(key(faction)) ?? -Infinity) < 30000) return {};
      if (!mine) last.set(key(faction), now);
      try {
        // another player's save lands in one slot per player here, so a flood of saves can't fill this disk
        const slot = mine ? (cmd.slot != null ? String(cmd.slot) : null) : 'net-' + key(faction).replace(/[^A-Z0-9_]/g, '');
        putSave(snapshot(game, name), slot)
          .then(() => game.message?.(`${db.t('TEXT_SAVE_GAME_TITLE') || 'Save Game'}: ${name}`, 'good'))
          .catch(error => console.error(error));
      } catch (error) {
        console.error(error);
      }
      return {};
    }
    case 'sell': {
      const rec = fromRecordRef(g, cmd.rec);
      return rec && game.sellRecord(rec, faction) ? { ok: true } : {};
    }
    case 'battle':
      game.pendingBattle?.answer?.(faction, cmd.id, cmd.choice);
      return {};
    case 'select':
      game.storySelect?.(game.actingPid, cmd.p | 0);
      return {};
    case 'zoom':
      game.storyZoom?.(game.actingPid, cmd.p | 0, !!cmd.out);
      return {};
    case 'ui':
      game.scriptClick?.(game.actingPid, String(cmd.name || ''), !!cmd.native);
      return {};
    case 'dialog':
      game.dialogDone?.(game.actingPid, cmd.id);
      return {};
    case 'choice':
      game.story?.neutralizeAnswer?.(faction, cmd.id, cmd.index, typeof cmd.gui === 'string' ? cmd.gui : null);
      return {};
    case 'result':
      game.mpBattles?.result(faction, cmd.id, cmd.r, game.actingPid);
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
