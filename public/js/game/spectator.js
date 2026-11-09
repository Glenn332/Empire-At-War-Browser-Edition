import { db } from '../gamedata.js';
import { iconUrl } from '../icons.js';
import { iconNameFor } from './hud.js';
import { isUpgradeType } from './sim.js';
import { isUpgrade } from './land.js';
import { loadTextureCanvas, canvasUrl } from '../dds.js';

const LOG_MAX = 300;
const HISTORY_STEP = 5;
const HISTORY_MAX = 720;
const CARD = 196;
const T = (id, fallback) => db.t(id) || fallback;
const SVG = {
  power:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1 9.7 6.3 15 8l-5.3 1.7L8 15 6.3 9.7 1 8l5.3-1.7z" fill="currentColor"/></svg>',
  eye: '<svg viewBox="0 0 20 12" aria-hidden="true"><path d="M1 6c2.4-3.4 5.4-5 9-5s6.6 1.6 9 5c-2.4 3.4-5.4 5-9 5S3.4 9.4 1 6z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="6" r="2.4" fill="currentColor"/></svg>',
  eyeOff:
    '<svg viewBox="0 0 20 12" aria-hidden="true"><path d="M1 6c2.4-3.4 5.4-5 9-5s6.6 1.6 9 5c-2.4 3.4-5.4 5-9 5S3.4 9.4 1 6z" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".55"/><path d="M3 11.5 17 .5" stroke="currentColor" stroke-width="1.6"/></svg>',
  prev: '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="M8 1 2 8l6 7" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  next: '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="m2 1 6 7-6 7" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  income:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12 6.5 7.5 9.5 10 14 4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 4h4.5v4.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  pop: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="5" r="2.4" fill="currentColor"/><circle cx="11" cy="5.6" r="2" fill="currentColor" opacity=".7"/><path d="M1 14c0-3 2-4.6 4.5-4.6S10 11 10 14z" fill="currentColor"/><path d="M10.6 14c0-1.6-.4-2.8-1.2-3.7.5-.3 1-.4 1.6-.4 2.2 0 4 1.4 4 4.1z" fill="currentColor" opacity=".7"/></svg>',
  upgrade:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 14 7.5H10.2V14H5.8V7.5H2z" fill="currentColor"/></svg>',
  locate:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 0v4M8 12v4M0 8h4M12 8h4" stroke="currentColor" stroke-width="1.4"/></svg>'
};

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const num = n => Math.round(n).toLocaleString();
const perMinute = (h, k, i) => {
  let j = k;
  while (j > 0 && h[k].t - h[j].t < 60) j--;
  const dt = h[k].t - h[j].t;
  return dt >= 5 && h[k].e && h[j].e ? (Math.max(0, h[k].e[i] - h[j].e[i]) / dt) * 60 : 0;
};
const GRAPHS = [
  { tab: 'Combat power', title: 'Combat power over time', value: (h, k, i) => h[k].p[i] || 0, fmt: v => num(v) },
  { tab: 'Income', title: 'Income per minute (over the last minute)', value: perMinute, fmt: v => `+${num(v)} / min` },
  { tab: 'Earned', title: 'Credits earned in total', value: (h, k, i) => h[k].e?.[i] || 0, fmt: v => num(v) },
  { tab: 'Credits', title: 'Credits banked', value: (h, k, i) => h[k].c?.[i] || 0, fmt: v => num(v) },
  {
    tab: 'Population',
    title: 'Population used',
    value: (h, k, i) => h[k].u?.[i] || 0,
    fmt: (v, p, i) => (p.cap?.[i] ? `${num(v)} / ${num(p.cap[i])}` : num(v))
  },
  { tab: 'Kills', title: 'Enemy units destroyed', value: (h, k, i) => h[k].k?.[i] || 0, fmt: v => num(v) },
  { tab: 'Losses', title: 'Own units lost', value: (h, k, i) => h[k].l?.[i] || 0, fmt: v => num(v) },
  { tab: 'Units lost', title: 'Units lost over time (hover a dot to see which)', lanes: true }
];
const short = n => (n >= 100000 ? `${(n / 1000).toFixed(0)}k` : n >= 10000 ? `${(n / 1000).toFixed(1)}k` : num(n));
const colorHex = c => (c && c.getHexString ? '#' + c.getHexString() : '#c3ab02');
const nameOf = type => T(type.str('Text_ID'), type.name.replace(/_/g, ' '));
const crests = new Map();
export function paintCrest(node, faction) {
  const name = db.faction(faction)?.str('Icon_Name') || '';
  if (!name || !node) return;
  const own = iconUrl(name);
  if (own) {
    node.style.backgroundImage = `url(${own})`;
    return;
  }
  const key = name.toUpperCase();
  if (!crests.has(key))
    crests.set(
      key,
      loadTextureCanvas(name)
        .then(cv => (cv ? canvasUrl(cv) : null))
        .catch(() => null)
    );
  crests.get(key).then(url => {
    if (url) node.style.backgroundImage = `url(${url})`;
  });
}
const blank = () => ({ credits: 0, power: 0, units: 0, out: false, income: 0, pop: 0, cap: 0, upgrades: null });
const worth = type => !!type && (type.num('Score_Cost_Credits', 0) >= 1 || typePower(type) > 0);
const upgradeName = n => {
  const t = typeof n === 'string' ? db.type(n) : n;
  return t ? nameOf(t) : String(n).replace(/_/g, ' ');
};
const powerCache = new Map();
const typePower = type => {
  let v = powerCache.get(type);
  if (v === undefined) powerCache.set(type, (v = Math.max(0, type.num('AI_Combat_Power', 0))));
  return v;
};

class SpaceSource {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.bar = game.ui?.bar || null;
    this.fogAvailable = !!this.world.fog;
    this.list = this.world.teams.filter(t => !t.mapSide && t.players.some(p => p.id >= 0));
    this.teams = this.list.map(t => {
      const lead = this.leader(t);
      return {
        key: t,
        faction: t.factionName,
        color: colorHex(lead?.color),
        names: t.players.filter(p => p.id >= 0).map(p => p.name)
      };
    });
    this.bought = new Map();
    for (const p of this.players()) this.bought.set(p, new Map(p.everBought || []));
    this.killers = new WeakMap();
    this.tally = this.list.map(() => ({ lost: 0, killed: 0 }));
  }

  players() {
    return this.world.players.filter(p => p.id >= 0 && !p.team.mapSide);
  }

  leader(team) {
    return team.players.find(p => p.id >= 0) || team.players[0];
  }

  time() {
    return this.world.time || 0;
  }

  measure() {
    const out = this.list.map(() => blank()),
      index = new Map(this.list.map((t, i) => [t, i]));
    for (const u of this.world.units) {
      if (u.dead || !u.player || u.player.id < 0) continue;
      const i = index.get(u.player.team);
      if (i === undefined) continue;
      out[i].power += typePower(u.type);
      if (!u.isPad && !u.squad) out[i].units++;
    }
    this.list.forEach((team, i) => {
      const o = out[i];
      for (const p of team.players)
        if (p.id >= 0) {
          o.credits += Math.max(0, p.credits || 0);
          o.income += (p.stats?.earned || 0) + (p.bounty || 0);
          o.pop += p.pop || 0;
          o.cap += p.popCap || 0;
        }
      o.upgrades = team.upgrades || null;
      o.out = team.defeated || (o.units === 0 && !(team.station && !team.station.dead));
    });
    return out;
  }

  totals() {
    return this.list.map((team, i) => {
      const t = { built: 0, lost: this.tally[i].lost, killed: this.tally[i].killed };
      for (const p of team.players) if (p.id >= 0 && p.stats) t.built += p.stats.built || 0;
      return t;
    });
  }

  production() {
    const index = new Map(this.list.map((t, i) => [t, i])),
      out = this.list.map(() => []);
    for (const u of this.world.units) {
      if (u.dead || !u.buildQueues?.size) continue;
      for (const q of u.buildQueues.values())
        q.forEach((it, k) => {
          const i = index.get(it.player?.team);
          if (i === undefined || !it.type) return;
          out[i].push({ type: it.type, active: k === 0, done: k === 0 && it.total > 0 ? 1 - it.left / it.total : 0, who: it.player.name });
        });
    }
    return out;
  }

  follow(i, fogOn) {
    const g = this.game,
      w = this.world,
      p = this.leader(this.list[i]);
    g.human = p;
    if (g.audio) g.audio.human = p;
    if (g.ui) {
      g.ui.player = p;
      g.ui.select?.([]);
      g.ui.hudTimer = 0;
    }
    if (this.bar) {
      this.bar.player = p;
      this.bar.sig = this.bar.queueSig = this.bar.sideSig = this.bar.reinSig = '';
      for (const h of Object.values(this.bar.heroBars || {})) h.sig = '';
    }
    const viewer = fogOn && this.fogAvailable ? p : null;
    w.viewer = viewer;
    g.mirror?.setViewer?.(viewer);
    if (g.ui?.radar) g.ui.radar.seeAll = !viewer;
    const fog = g.renderer?.fog;
    if (fog) {
      fog.state.fill(1);
      fog.timer = 0;
    }
  }

  poll(add) {
    for (const p of this.players()) {
      const now = p.everBought;
      if (!now) continue;
      let was = this.bought.get(p);
      if (!was) this.bought.set(p, (was = new Map()));
      for (const [type, n] of now) {
        const before = was.get(type) || 0;
        if (n > before) add({ kind: isUpgradeType(type) ? 'upgrade' : 'unit', ...this.who(p), type, count: n - before });
        if (n !== before) was.set(type, n);
      }
    }
  }

  who(p) {
    return { who: p.name, color: colorHex(p.color), team: p.team };
  }

  event(kind, d, add) {
    if (!d) return;
    if (kind === 'killed') {
      const u = d.unit;
      if (!u) return;
      const k = { by: d.killer || null, x: u.x, y: u.y };
      this.killers.set(u, k);
      if (u.squad) this.killers.set(u.squad, k);
      return;
    }
    if (kind === 'died') return this.died(d.entity, add);
    if (kind === 'specialWeaponFired') return this.fired(d, add);
    if (kind !== 'built' || !d.entity || !d.player || d.player.id < 0 || d.player.team?.mapSide) return;
    const e = d.entity,
      at = this.where(e);
    add({ kind: 'spawn', ...this.who(d.player), type: d.type || e.type, entity: e, x: at?.x, y: at?.y, count: 1 });
  }

  died(e, add) {
    if (!e || !e.player || e.player.id < 0 || e.player.team?.mapSide || e.isPad || (!e.isSquad && e.squad) || !worth(e.type)) return;
    const k = this.killers.get(e),
      x = Number.isFinite(e.x) ? e.x : k?.x,
      y = Number.isFinite(e.y) ? e.y : k?.y,
      by = k?.by && k.by.id >= 0 && k.by.team !== e.player.team ? k.by : null,
      i = this.list.indexOf(e.player.team),
      ki = by ? this.list.indexOf(by.team) : -1;
    if (i >= 0) this.tally[i].lost++;
    if (ki >= 0) this.tally[ki].killed++;
    add({
      kind: e.isStation ? 'station' : 'lost',
      ...this.who(e.player),
      type: e.type,
      x,
      y,
      count: 1,
      by: by ? by.name : null,
      byColor: by ? colorHex(by.color) : null
    });
  }

  fired(d, add) {
    const w = d.weapon,
      p = w?.player;
    if (!p || p.id < 0 || !w.type) return;
    const t = d.target,
      at = t ? this.where(t) || (Number.isFinite(t.x) ? { x: t.x, y: t.y } : null) : null;
    add({
      kind: 'weapon',
      ...this.who(p),
      type: w.type,
      x: at?.x,
      y: at?.y,
      count: 1,
      target: t?.type ? nameOf(t.type) : null
    });
  }

  where(e) {
    if (!e || e.dead) return null;
    if (Number.isFinite(e.x) && Number.isFinite(e.y)) return { x: e.x, y: e.y };
    const f = e.fighters?.find(f => !f.dead) || e.fighters?.[0];
    return f && Number.isFinite(f.x) ? { x: f.x, y: f.y } : null;
  }

  look(at, e) {
    const rig = this.game.renderer?.rig;
    if (!rig) return;
    rig.x = at.x;
    rig.y = at.y;
    const ui = this.game.ui;
    if (ui?.track?.on) ui.endTrack();
    if (!e || e.dead || !e.player) return;
    const v = this.world.viewer,
      seen = !v || e.player.team === v.team || (e.isSquad ? e.fighters?.some(f => f.seenBy & v.bit) : e.seenBy & v.bit);
    if (!seen || !ui) return;
    ui.select?.([e]);
    ui.following = e;
  }

  cinema() {
    const ui = this.game.ui;
    if (!ui || this.game.cine?.on) return false;
    if (ui.track?.on) {
      ui.endTrack();
      return true;
    }
    const pick = ui.selection?.find(s => !s.dead && (!s.isSquad || s.fighters?.length));
    if (!pick) return false;
    ui.startTrack(pick, false);
    return true;
  }
}

class LandSource {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.bar = game.ui?.bar || null;
    this.fogAvailable = game.setup.fog !== false;
    const sides = game.players.map((_, i) => i).filter(i => game.teams[i] !== undefined);
    const keys = [...new Set(sides.map(s => game.teams[s]))].sort((a, b) => a - b);
    let bots = 0;
    this.names = game.players.map(p => p.name || (p.human ? 'Player' : `Bot ${++bots}`));
    this.sides = keys.map(t => sides.filter(s => game.teams[s] === t));
    this.teams = keys.map((t, i) => ({
      key: t,
      faction: game.factions[this.sides[i][0]],
      color: colorHex(this.world.colors?.[this.sides[i][0]]),
      names: this.sides[i].map(s => this.names[s])
    }));
    this.sideTeam = new Map();
    this.sides.forEach((list, i) => list.forEach(s => this.sideTeam.set(s, i)));
    this.seen = new WeakSet();
    this.tally = this.teams.map(() => ({ built: 0, lost: 0, killed: 0 }));
    this.mark(() => {});
  }

  time() {
    return this.world.time || 0;
  }

  totals() {
    return this.tally.map(t => ({ ...t }));
  }

  production() {
    const w = this.world,
      out = this.teams.map(() => []);
    this.sides.forEach((list, i) =>
      list.forEach(s => {
        const q = w.queues?.[s];
        if (!q) return;
        for (const l of [q.units, q.upgrades])
          l.forEach((it, k) =>
            out[i].push({ type: it.type, active: k === 0, done: k === 0 && it.total > 0 ? 1 - it.left / it.total : 0, who: this.names[s] })
          );
      })
    );
    for (const site of w.sites || []) {
      const b = site.building,
        i = b ? this.sideTeam.get(b.side) : undefined;
      if (!b || b.done || i === undefined) continue;
      out[i].push({
        type: db.type(b.uc.str('Tactical_Buildable_Constructed')) || b.uc,
        active: true,
        done: b.total > 0 ? 1 - b.left / b.total : 0,
        who: this.names[b.side]
      });
    }
    return out;
  }

  died(u, add) {
    const w = this.world,
      i = this.sideTeam.get(u.side);
    if (i === undefined) return;
    const building = !!u.structure && !u.squad;
    if (!building && !w.companyLost(u)) return;
    const type = u.squad?.type || u.type;
    if (!worth(type)) return;
    this.tally[i].lost++;
    const k = u.hitBy,
      ki = k !== undefined && k >= 0 ? this.sideTeam.get(k) : undefined,
      by = ki !== undefined && ki !== i ? k : undefined;
    if (by !== undefined) this.tally[ki].killed++;
    add({
      kind: u.structure ? 'station' : 'lost',
      ...this.who(u.side),
      type,
      x: u.x,
      y: u.y,
      count: 1,
      by: by !== undefined ? this.names[by] : null,
      byColor: by !== undefined ? colorHex(w.colors?.[by]) : null
    });
  }

  measure() {
    const w = this.world,
      out = this.teams.map(() => blank());
    for (const u of w.units) {
      if (u.dead) continue;
      const i = this.sideTeam.get(u.side);
      if (i !== undefined) out[i].power += typePower(u.type);
    }
    for (const q of w.squads) {
      if (!q.members?.length) continue;
      const i = this.sideTeam.get(q.side);
      if (i !== undefined && !q.structure) out[i].units++;
    }
    this.teams.forEach((t, i) => {
      const o = out[i];
      for (const s of this.sides[i]) {
        o.credits += Math.max(0, w.credits?.[s] || 0);
        o.income += (w.earned?.[s] || 0) + (w.collected?.[s] || 0);
        o.pop += w.popUsed?.(s) || 0;
        o.cap += w.popCap?.(s) || 0;
      }
      o.upgrades = w.owned?.[this.sides[i][0]] || null;
      o.out = !!w.beaten?.has(t.key);
    });
    return out;
  }

  follow(i, fogOn) {
    const g = this.game,
      w = this.world,
      side = this.sides[i][0];
    this.swapMemory(i, fogOn && this.fogAvailable);
    g.me = side;
    g.myTeam = this.teams[i].key;
    g.reveal = !(fogOn && this.fogAvailable);
    if (!g.lock) w.viewer = side;
    const ui = g.ui;
    if (ui) {
      ui.me = side;
      ui.seeAll = g.reveal;
      ui.fogDirty = true;
      if (w.sidePlayers?.[side]) ui.player = w.sidePlayers[side];
      if (ui.selection) {
        for (const s of ui.selection) s.selected = false;
        ui.selection = [];
      }
    }
    if (this.bar) {
      this.bar.player = ui?.player || this.bar.player;
      this.bar.sig = this.bar.queueSig = this.bar.sideSig = this.bar.reinSig = '';
      for (const h of Object.values(this.bar.heroBars || {})) h.sig = '';
    }
    g.hudTimer = 0;
  }

  swapMemory(i, on) {
    const t = this.game.terrain;
    if (!t?.fogSeen) return;
    this.memory ||= new Map();
    if (this.memoryOf !== undefined && this.memoryOn)
      this.memory.set(this.memoryOf, { seen: t.fogSeen.slice(), light: t.fogLight ? t.fogLight.slice() : null });
    if (on && (this.memoryOf !== i || !this.memoryOn)) {
      const kept = this.memory.get(i);
      if (kept) t.fogSeen.set(kept.seen);
      else t.fogSeen.fill(0);
      if (t.fogLight) {
        if (kept?.light) t.fogLight.set(kept.light);
        else t.fogLight.fill(0);
      }
      if (t.fog) {
        t.fog.image.data.fill(0);
        t.fog.needsUpdate = true;
      }
    }
    this.memoryOf = i;
    this.memoryOn = on;
  }

  who(side) {
    const i = this.sideTeam.get(side);
    return { who: this.names[side], color: colorHex(this.world.colors?.[side]), team: this.teams[i]?.key };
  }

  mark(add) {
    const w = this.world;
    this.sides.flat().forEach(side => {
      const q = w.queues?.[side];
      if (!q) return;
      for (const it of [...q.units, ...q.upgrades]) {
        if (this.seen.has(it)) continue;
        this.seen.add(it);
        const up = isUpgrade(it.type);
        if (!up) this.tally[this.sideTeam.get(side)].built++;
        add({ kind: up ? 'upgrade' : 'unit', ...this.who(side), type: it.type, count: 1 });
      }
    });
    for (const s of w.sites || []) {
      const b = s.building;
      if (!b || this.seen.has(b) || !this.sideTeam.has(b.side)) continue;
      this.seen.add(b);
      this.tally[this.sideTeam.get(b.side)].built++;
      add({ kind: 'unit', ...this.who(b.side), type: db.type(b.uc.str('Tactical_Buildable_Constructed')) || b.uc, count: 1 });
    }
    for (const q of w.squads) {
      if (this.seen.has(q) || !q.members?.length || q.arriving || q.craft) continue;
      this.seen.add(q);
      if (!this.sideTeam.has(q.side)) continue;
      const at = this.where(q);
      add({ kind: 'spawn', ...this.who(q.side), type: q.type || q.members[0].type, entity: q, x: at?.x, y: at?.y, count: 1 });
    }
  }

  poll(add) {
    this.mark(add);
  }

  event() {}

  where(q) {
    const u = q?.members?.find(u => !u.dead);
    return u && Number.isFinite(u.x) ? { x: u.x, y: u.y } : null;
  }

  look(at, q) {
    const g = this.game,
      v = g.view;
    if (!v) return;
    if (g.track?.on) g.endTrack();
    v.x = at.x;
    v.y = at.y;
    if (q && !q.dead && q.members?.length) g.following = q;
  }

  cinema() {
    const g = this.game;
    if (g.cine?.on) return false;
    if (g.track?.on) {
      g.endTrack();
      return true;
    }
    const pick = g.ui?.selection?.find(s => !s.dead && s.members?.length);
    if (!pick) return false;
    g.startTrack(pick, false);
    return true;
  }
}

export class SpectatorView {
  constructor(game, kind = 'space', { quiet = false } = {}) {
    this.game = game;
    this.src = kind === 'land' ? new LandSource(game) : new SpaceSource(game);
    this.teams = this.src.teams;
    this.tracked = 0;
    this.fogAvailable = this.src.fogAvailable;
    this.fogOn = false;
    this.offset = 0;
    this.filter = 'all';
    this.log = [];
    this.winner = null;
    this.stats = this.teams.map(() => ({ credits: -1, power: -1, out: null, rate: null, pop: null, ups: null, income: 0, peak: 0 }));
    this.earnLog = [];
    this.history = [];
    this.deaths = [];
    this.histStep = HISTORY_STEP;
    this.quiet = quiet;
    this.timer = setInterval(() => this.update(), 250);
    if (quiet) {
      this.update();
      return;
    }
    document.body.classList.add('spectating');
    this.buildTop();
    this.buildLog();
    this.onKey = e => this.key(e);
    addEventListener('keydown', this.onKey, true);
    this.onResize = () => this.layout();
    addEventListener('resize', this.onResize);
    this.layout();
    this.track(0, true);
    this.update();
  }

  teamLabel(i) {
    return `${T('TEXT_TEAM', 'Team')} ${i + 1}`;
  }

  factionLabel(team) {
    const f = db.faction(team.faction);
    return f ? T(f.str('Text_ID'), team.faction) : team.faction;
  }

  indexOf(key) {
    return this.teams.findIndex(t => t.key === key);
  }

  winnerTitle(key) {
    const i = this.indexOf(key);
    if (i < 0) return 'Battle over';
    return `${this.teamLabel(i)} (${this.factionLabel(this.teams[i])}) wins`;
  }

  finished(key) {
    this.winner = key ?? null;
    this.freeze();
    this.update();
    if (!this.quiet) this.renderCards();
  }

  freeze() {
    if (this.final) return this.final;
    this.update();
    const t = this.src.time(),
      m = this.src.measure(),
      last = this.history[this.history.length - 1];
    if (!last || last.t < t) this.history.push(this.snap(t, m));
    this.final = {
      t,
      m,
      totals: this.src.totals(),
      stats: this.stats.map(st => ({ income: st.income, peak: st.peak, out: st.out }))
    };
    return this.final;
  }

  placeChat(dlg) {
    const box = dlg.ctl?.('IDC_TEAM_MEMBERS_ONLY');
    if (box?.lastChild) box.lastChild.textContent = 'Send to spectators only';
    const top = dlg.el.getBoundingClientRect().top;
    if (this.drop > top) dlg.el.style.translate = `0 ${this.drop - top}px`;
  }

  followTeam(key) {
    const i = this.indexOf(key);
    if (i >= 0) this.track(i, true);
  }

  buildTop() {
    const hud = document.getElementById('hud');
    const root = (this.top = el('div', 'sp-top', hud));
    root.id = 'spectatorTop';
    const head = el('div', 'sp-head', root);
    el('span', 'sp-tag', head, T('TEXT_SPECTATOR', 'Spectator'));
    this.clockEl = el('span', 'sp-clock', head, '0:00');
    this.fogBtn = el('button', 'sp-fog', head);
    this.fogBtn.type = 'button';
    this.fogBtn.onclick = () => this.toggleFog();
    const strip = (this.strip = el('div', 'sp-strip', root));
    this.prevBtn = el('button', 'sp-nav', strip, SVG.prev);
    this.prevBtn.type = 'button';
    this.prevBtn.title = 'Previous teams';
    this.prevBtn.onclick = () => this.scroll(-1);
    this.viewport = el('div', 'sp-view', strip);
    this.rail = el('div', 'sp-rail', this.viewport);
    this.nextBtn = el('button', 'sp-nav', strip, SVG.next);
    this.nextBtn.type = 'button';
    this.nextBtn.title = 'More teams';
    this.nextBtn.onclick = () => this.scroll(1);
    this.viewport.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        e.stopPropagation();
        this.scroll(Math.sign(e.deltaY || e.deltaX));
      },
      { passive: false }
    );
    this.cards = this.teams.map((team, i) => {
      const c = el('button', 'sp-card', this.rail);
      c.type = 'button';
      c.style.setProperty('--tc', team.color);
      paintCrest(el('span', 'sp-crest', c), team.faction);
      const who = el('span', 'sp-who', c);
      el('b', '', who, this.teamLabel(i));
      const names = team.names.join(', ');
      el('small', '', who).textContent = `${this.factionLabel(team)} · ${names}`;
      const stats = el('span', 'sp-stats', c);
      const cr = el('span', 'sp-stat sp-cr', stats);
      const coin = el('i', 'sp-credit', cr);
      const credit = iconUrl('i_icon_credit.tga');
      if (credit) coin.style.backgroundImage = `url(${credit})`;
      const crN = el('em', '', cr, '0');
      const pw = el('span', 'sp-stat sp-pw', stats, SVG.power);
      const pwN = el('em', '', pw, '0');
      const more = el('span', 'sp-stats sp-more', c);
      const inc = el('span', 'sp-stat sp-inc', more, SVG.income);
      const incN = el('em', '', inc, '+0');
      const pop = el('span', 'sp-stat sp-pop', more, SVG.pop);
      const popN = el('em', '', pop, '0/0');
      const up = el('span', 'sp-stat sp-up', more, SVG.upgrade);
      const upN = el('em', '', up, '0');
      const meter = el('span', 'sp-meter', c);
      const fill = el('i', '', meter);
      const badge = el('span', 'sp-badge', c);
      el('span', 'sp-key', c, String((i + 1) % 10));
      c.title = `${this.teamLabel(i)} · ${this.factionLabel(team)}\n${names}\nClick or press ${(i + 1) % 10} to follow this team`;
      c.onclick = () => this.track(i);
      return { c, crN, pwN, incN, popN, upN, fill, badge };
    });
    const balance = el('div', 'sp-balance', root);
    this.segments = this.teams.map((team, i) => {
      const s = el('button', 'sp-seg', balance);
      s.type = 'button';
      s.style.setProperty('--tc', team.color);
      s.onclick = () => this.track(i);
      return s;
    });
    this.pager = el('div', 'sp-keys', root);
  }

  buildLog() {
    const bar = this.src.bar;
    const box = (this.logBox = el('div', 'sp-log'));
    if (bar) {
      const names = [];
      for (let i = 0; i < 24; i++) names.push('s_select_' + String(i).padStart(2, '0'));
      for (let i = 0; i < 12; i++) names.push('special_border_' + String(i).padStart(2, '0'));
      const rs = names.map(n => bar.rect(n)).filter(Boolean);
      if (rs.length) {
        const x0 = Math.min(...rs.map(r => r.x)),
          y0 = Math.min(...rs.map(r => r.y)),
          x1 = Math.max(...rs.map(r => r.x + r.w)),
          y1 = Math.max(...rs.map(r => r.y + r.h));
        Object.assign(box.style, { left: x0 + 'px', bottom: y0 + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px' });
        bar.root.appendChild(box);
        bar.root.classList.add('spectating');
      } else box.classList.add('floating');
    } else box.classList.add('floating');
    if (!box.parentNode) document.getElementById('hud').appendChild(box);
    const head = el('div', 'sp-log-head', box);
    el('b', '', head, 'Battle log');
    const tabs = el('span', 'sp-tabs', head);
    this.tabs = [
      ['all', 'All teams'],
      ['tracked', 'Followed team'],
      ['production', 'Production']
    ].map(([k, label]) => {
      const b = el('button', '', tabs, label);
      b.type = 'button';
      b.onclick = () => {
        this.filter = k;
        this.renderLog();
      };
      return [k, b];
    });
    this.legend = el(
      'span',
      'sp-legend',
      head,
      '<i class="k-unit"></i>Bought<i class="k-upgrade"></i>Upgrade<i class="k-spawn"></i>Arrived<i class="k-lost"></i>Lost<i class="k-weapon"></i>Superweapon'
    );
    this.list = el('div', 'sp-list', box);
    this.list.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    this.empty = el('div', 'sp-empty', this.list, 'Purchases, upgrades, arrivals and losses will show here.');
    this.prod = el('div', 'sp-prod', box);
    this.prod.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    this.prodRows = this.teams.map((team, i) => {
      const r = el('div', 'sp-prod-row', this.prod);
      r.style.setProperty('--tc', team.color);
      const name = el('button', 'sp-prod-team', r);
      name.type = 'button';
      el('i', 'pip', name);
      el('span', '', name).textContent = this.teamLabel(i);
      name.title = `${this.teamLabel(i)} · ${this.factionLabel(team)} · click to follow`;
      name.onclick = () => this.track(i);
      const items = el('div', 'sp-prod-items', r);
      return { r, items, sig: null, bars: [] };
    });
    this.renderLog();
  }

  renderProduction() {
    if (this.filter !== 'production') return;
    const all = this.src.production();
    this.prodRows.forEach((row, i) => {
      const list = all[i] || [],
        active = list.filter(x => x.active),
        waiting = new Map();
      for (const x of list) if (!x.active) waiting.set(x.type, (waiting.get(x.type) || 0) + 1);
      const sig = active.map(x => x.type.name).join('|') + '#' + [...waiting].map(([t, n]) => t.name + n).join('|');
      if (sig !== row.sig) {
        row.sig = sig;
        row.items.replaceChildren();
        row.bars = [];
        const chip = (type, cls, title) => {
          const c = el('span', 'sp-chip ' + cls, row.items);
          const icon = iconUrl(iconNameFor(type) || '');
          if (icon) c.style.backgroundImage = `url(${icon})`;
          c.title = title;
          return c;
        };
        for (const x of active) {
          const c = chip(x.type, 'busy', `${nameOf(x.type)} · ${x.who}`);
          row.bars.push(el('i', 'bar', c));
        }
        for (const [type, n] of waiting) {
          const c = chip(type, 'wait', `${nameOf(type)} · ${n} waiting`);
          if (n > 1) el('em', '', c, '×' + n);
        }
        if (!list.length) el('span', 'sp-idle', row.items, 'Nothing in production');
      }
      active.forEach((x, k) => {
        if (row.bars[k]) row.bars[k].style.width = `${Math.round(Math.max(0, Math.min(1, x.done)) * 100)}%`;
      });
      row.r.classList.toggle('on', i === this.tracked);
      row.r.classList.toggle('out', !!this.stats[i]?.out);
    });
  }

  layout() {
    const s = Math.min(innerHeight / 768, innerWidth / 1024);
    this.scale = s;
    const room = Math.max(CARD + 80, Math.min(innerWidth / s - 220, 4 * CARD + 80));
    this.visible = Math.max(1, Math.min(this.teams.length, Math.floor((room - 64) / CARD)));
    this.top.style.transform = `translateX(-50%) scale(${s})`;
    this.viewport.style.width = this.visible * CARD - 6 + 'px';
    this.drop = 0;
    this.clampOffset();
  }

  clampOffset() {
    this.offset = Math.max(0, Math.min(this.teams.length - this.visible, this.offset));
    this.rail.style.transform = `translateX(${-this.offset * CARD}px)`;
    const paged = this.teams.length > this.visible;
    this.prevBtn.disabled = !paged || this.offset <= 0;
    this.nextBtn.disabled = !paged || this.offset >= this.teams.length - this.visible;
    this.strip.classList.toggle('paged', paged);
    this.pager.innerHTML =
      (paged ? `<span>Teams ${this.offset + 1}–${this.offset + this.visible} of ${this.teams.length}</span>` : '') +
      '<span><kbd>Tab</kbd> next team</span><span><kbd>1</kbd>–<kbd>0</kbd> pick team</span><span><kbd>F</kbd> fog of war</span><span><kbd>C</kbd> follow selected</span>';
  }

  scroll(d) {
    if (!d) return;
    this.offset += d;
    this.clampOffset();
  }

  track(i, quiet = false) {
    const n = this.teams.length;
    if (!n) return;
    this.tracked = ((i % n) + n) % n;
    if (this.tracked < this.offset) this.offset = this.tracked;
    else if (this.tracked >= this.offset + this.visible) this.offset = this.tracked - this.visible + 1;
    this.clampOffset();
    this.applyVision();
    this.renderCards();
    if (this.filter === 'tracked') this.renderLog();
    if (!quiet) this.game.audio?.play?.('GUI_Button_Press_2_SFX');
  }

  toggleFog() {
    if (!this.fogAvailable) {
      this.game.message?.('Fog of war is off for this battle.', 'bad');
      return;
    }
    this.fogOn = !this.fogOn;
    this.applyVision();
    this.renderCards();
    this.game.audio?.play?.('GUI_Button_Press_2_SFX');
  }

  applyVision() {
    const on = this.fogOn && this.fogAvailable;
    this.src.follow(this.tracked, on);
    this.fogBtn.classList.toggle('on', on);
    this.fogBtn.disabled = !this.fogAvailable;
    this.fogBtn.innerHTML = !this.fogAvailable
      ? `${SVG.eye}<span>Fog of war off for this battle</span>`
      : on
        ? `${SVG.eyeOff}<span>Fog of war <b>On</b> · seeing as ${this.teamLabel(this.tracked)}</span>`
        : `${SVG.eye}<span>Fog of war <b>Off</b> · full vision</span>`;
    this.fogBtn.title = 'Toggle fog of war [F]';
  }

  key(e) {
    const menu = document.getElementById('menu');
    if ((menu && !menu.classList.contains('hidden')) || this.game.menus?.stack?.length) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let hit = true;
    if (e.code === 'Tab') this.track(this.tracked + (e.shiftKey ? -1 : 1));
    else if (/^Digit\d$/.test(e.code) && !e.shiftKey) {
      const n = +e.code.slice(5),
        i = n === 0 ? 9 : n - 1;
      if (i < this.teams.length) this.track(i);
    } else if (e.code === 'KeyF' && !e.shiftKey) this.toggleFog();
    else if (e.code === 'KeyC' && !e.shiftKey) hit = this.src.cinema();
    else hit = false;
    if (hit) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  update() {
    if (!this.src.world) return;
    if (this.quiet) {
      this.src.poll(item => this.add(item));
      const m = this.src.measure();
      this.sample(this.src.time(), m);
      m.forEach((x, i) => {
        const st = this.stats[i];
        st.income = x.income;
        st.peak = Math.max(st.peak || 0, x.power);
        st.out = x.out;
      });
      return;
    }
    this.clockEl.textContent = clock(this.src.time());
    const drop = Math.round(this.top.offsetHeight * this.scale + 10);
    if (drop !== this.drop) document.body.style.setProperty('--sp-drop', (this.drop = drop) + 'px');
    this.src.poll(item => this.add(item));
    const m = this.src.measure(),
      now = this.src.time();
    this.sample(now, m);
    const rates = this.rates();
    const total = m.reduce((a, x) => a + x.power, 0) || 1,
      top = Math.max(1, ...m.map(x => x.power));
    this.teams.forEach((team, i) => {
      const { credits, power, out, pop, cap, upgrades } = m[i],
        st = this.stats[i],
        card = this.cards[i];
      const rate = Math.round(rates[i]);
      if (rate !== st.rate) {
        st.rate = rate;
        card.incN.textContent = '+' + short(rate);
        card.incN.parentNode.title = `Income ${num(rate)} credits per minute (last minute)`;
      }
      const ps = `${Math.round(pop)}/${Math.round(cap)}`;
      if (ps !== st.pop) {
        st.pop = ps;
        card.popN.textContent = ps;
        card.popN.parentNode.title = `Population ${ps}`;
      }
      const ups = upgrades ? [...upgrades] : [],
        us = ups.join('|');
      if (us !== st.ups) {
        st.ups = us;
        card.upN.textContent = String(ups.length);
        card.upN.parentNode.title = ups.length
          ? `Upgrades owned (${ups.length}):\n${ups.map(upgradeName).join('\n')}`
          : 'No upgrades owned';
      }
      st.income = m[i].income;
      st.peak = Math.max(st.peak || 0, power);
      if (Math.floor(credits) !== st.credits) {
        st.credits = Math.floor(credits);
        card.crN.textContent = short(credits);
        card.crN.parentNode.title = `${num(credits)} credits available`;
      }
      if (Math.round(power) !== st.power) {
        st.power = Math.round(power);
        card.pwN.textContent = short(power);
        card.pwN.parentNode.title = `Combat power ${num(power)} · ${Math.round((power / total) * 100)}% of the field`;
      }
      card.fill.style.width = `${(power / top) * 100}%`;
      const seg = this.segments[i];
      seg.style.flexGrow = power > 0 ? power / total : 0;
      seg.classList.toggle('gone', power <= 0);
      seg.title = `${this.teamLabel(i)} · ${this.factionLabel(team)}: ${Math.round((power / total) * 100)}% of the combat power`;
      if (out !== st.out) {
        st.out = out;
        card.c.classList.toggle('out', out);
      }
    });
    this.renderProduction();
  }

  sample(t, m) {
    if (this.final) return;
    const last = this.earnLog[this.earnLog.length - 1];
    if (!last || t - last.t >= 1 || t < last.t) {
      if (last && t < last.t) this.earnLog.length = 0;
      this.earnLog.push({ t, v: m.map(x => x.income) });
      while (this.earnLog.length > 2 && t - this.earnLog[1].t >= 60) this.earnLog.shift();
    }
    const h = this.history[this.history.length - 1];
    if (!h || t - h.t >= this.histStep || t < h.t) {
      this.history.push(this.snap(t, m));
      if (this.history.length > HISTORY_MAX) {
        this.history = this.history.filter((_, k) => k % 2 === 0);
        this.histStep *= 2;
      }
    }
  }

  snap(t, m) {
    const tot = this.src.totals();
    return {
      t,
      p: m.map(x => Math.round(x.power)),
      c: m.map(x => Math.round(x.credits)),
      e: m.map(x => Math.round(x.income)),
      u: m.map(x => Math.round(x.pop || 0)),
      cap: m.map(x => Math.round(x.cap || 0)),
      k: tot.map(x => x?.killed || 0),
      l: tot.map(x => x?.lost || 0)
    };
  }

  rates() {
    const a = this.earnLog[0],
      b = this.earnLog[this.earnLog.length - 1],
      span = a && b ? b.t - a.t : 0;
    if (span < 5) return this.teams.map(() => 0);
    return this.teams.map((_, i) => (Math.max(0, b.v[i] - a.v[i]) / span) * 60);
  }

  report({ losses, planet = '', onExit, rehost = null, me, won, exitLabel = 'Exit' }) {
    const { t, m, totals, stats } = this.freeze(),
      mine = me === undefined ? -1 : this.indexOf(me),
      order = this.teams
        .map((_, i) => i)
        .sort((a, b) => (this.teams[b].key === this.winner) - (this.teams[a].key === this.winner) || (b === mine) - (a === mine) || a - b);
    document.getElementById('spReport')?.remove();
    const root = el('div', 'sp-report');
    root.id = 'spReport';
    const panel = el('div', 'sp-rep-panel', root);
    const head = el('div', 'sp-rep-head', panel);
    el('span', 'sp-tag', head, 'Battle report');
    const h2 = el('h2', '', head);
    if (mine >= 0) {
      h2.textContent = won ? T('TEXT_WIN_BATTLE', 'Victory!') : T('TEXT_LOST_BATTLE', 'Defeat!');
      h2.classList.add(won ? 'won' : 'lost');
    } else h2.textContent = this.winnerTitle(this.winner);
    el('span', 'sp-rep-time', head).textContent = `${planet ? planet + ' · ' : ''}${clock(t)}`;
    const table = el('div', 'sp-rep-table', panel);
    const cols = ['Built', 'Lost', 'Kills', 'Earned', 'Peak power', 'Upgrades'];
    const hr = el('div', 'sp-rep-row sp-rep-cols', table);
    el('span', 'sp-rep-team', hr, 'Team');
    for (const c of cols) el('span', 'sp-rep-n', hr, c);
    for (const i of order) {
      const team = this.teams[i],
        tot = totals[i] || { built: 0, lost: 0, killed: 0 },
        st = stats[i],
        won = team.key === this.winner;
      const row = el('div', 'sp-rep-row' + (won ? ' won' : '') + (st.out && !won ? ' out' : '') + (i === mine ? ' me' : ''), table);
      row.style.setProperty('--tc', team.color);
      const who = el('span', 'sp-rep-team', row);
      const crest = el('i', 'sp-crest', who);
      paintCrest(crest, team.faction);
      const tx = el('span', '', who);
      el('b', '', tx).textContent = this.teamLabel(i) + (won ? ' · Victor' : '') + (i === mine ? ' · You' : '');
      el('small', '', tx).textContent = `${this.factionLabel(team)} · ${team.names.join(', ')}`;
      const ups = m[i].upgrades ? [...m[i].upgrades] : [];
      const vals = [tot.built, tot.lost, tot.killed, short(st.income || 0), short(st.peak || 0), ups.length];
      vals.forEach((v, k) => {
        const n = el('span', 'sp-rep-n', row, String(v));
        if (k === 5 && ups.length) n.title = ups.map(upgradeName).join('\n');
      });
      const lost = [...(losses?.get(team.key) || new Map())].filter(([ty, n]) => n > 0 && worth(ty)).sort((a, b) => b[1] - a[1]);
      const strip = el('div', 'sp-rep-lost', table);
      strip.style.setProperty('--tc', team.color);
      el('span', 'sp-rep-label', strip, lost.length ? 'Losses' : 'No losses');
      for (const [ty, n] of lost.slice(0, 32)) {
        const c = el('span', 'sp-chip', strip);
        const ic = iconUrl(iconNameFor(ty) || '');
        if (ic) c.style.backgroundImage = `url(${ic})`;
        c.title = `${nameOf(ty)} ×${n}`;
        if (n > 1) el('em', '', c, '×' + n);
      }
      if (lost.length > 32) el('span', 'sp-rep-more', strip, `+${lost.length - 32} more`);
    }
    const watch = this.graphs(el('div', 'sp-rep-chart', panel));
    const foot = el('div', 'sp-rep-foot', panel);
    const close = () => {
      watch?.disconnect();
      root.remove();
    };
    if (rehost) {
      const b = el('button', 'sp-rep-btn', foot, 'Back to Game Setup');
      b.type = 'button';
      b.onclick = () => {
        close();
        rehost();
      };
    }
    const exit = el('button', 'sp-rep-btn main', foot, exitLabel);
    exit.type = 'button';
    exit.onclick = () => {
      close();
      onExit?.();
    };
    document.body.appendChild(root);
    return { el: root, close };
  }

  graphs(box) {
    const head = el('div', 'sp-rep-graph-head', box);
    const sub = el('div', 'sp-rep-sub', head);
    const tabs = el('div', 'sp-tabs', head);
    const plot = el('div', 'sp-rep-plot', box);
    const h = this.history;
    if (h.length < 2) {
      sub.textContent = 'Battle graphs';
      el('p', 'sp-empty', plot, 'Not enough of the battle was seen to draw this.');
      return;
    }
    const btns = GRAPHS.map((g, k) => {
      const b = el('button', '', tabs, g.tab);
      b.type = 'button';
      b.onclick = () => show(k);
      return b;
    });
    const show = k => {
      const g = GRAPHS[k];
      btns.forEach((b, j) => b.classList.toggle('on', j === k));
      sub.textContent = g.title;
      plot.textContent = '';
      if (g.lanes) this.lanes(plot);
      else this.graph(plot, g);
      this.graphTab = k;
    };
    let size = '';
    const watch = new ResizeObserver(() => {
      const next = `${plot.clientWidth}x${plot.clientHeight}`;
      if (next === size || !plot.clientWidth) return;
      size = next;
      show(this.graphTab || 0);
    });
    watch.observe(plot);
    return watch;
  }

  lanes(plot) {
    const W = Math.max(320, Math.round(plot.clientWidth) || 640),
      H = Math.max(160, Math.round(plot.clientHeight) || 190),
      L = 110,
      R = 16,
      Tp = 8,
      B = 30,
      h = this.history,
      n = this.teams.length;
    const t0 = h[0].t,
      t1 = h[h.length - 1].t,
      span = Math.max(1, t1 - t0),
      lane = (H - Tp - B) / n;
    const x = t => L + ((Math.min(t1, Math.max(t0, t)) - t0) / span) * (W - L - R),
      y = i => Tp + lane * (i + 0.5);
    const step = (span * 12) / (W - L - R),
      groups = new Map();
    for (const d of this.deaths) {
      if (d.t > t1 + 0.5) continue;
      const key = `${d.i}|${Math.floor((d.t - t0) / step)}`;
      let gr = groups.get(key);
      if (!gr) groups.set(key, (gr = { i: d.i, from: d.t, to: d.t, n: 0, station: false, list: [] }));
      gr.from = Math.min(gr.from, d.t);
      gr.to = Math.max(gr.to, d.t);
      gr.n++;
      gr.station ||= d.station;
      gr.list.push(d);
    }
    const dots = [...groups.values()];
    let s = `<svg viewBox="0 0 ${W} ${H}" class="sp-rep-svg" role="img" aria-label="Units lost over time">`;
    for (let i = 0; i < n; i++) {
      const yy = y(i).toFixed(1),
        c = this.teams[i].color,
        total = this.deaths.filter(d => d.i === i && d.t <= t1 + 0.5).length;
      s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="lane" stroke="${c}"/>`;
      s += `<text x="${L - 10}" y="${yy}" class="ylab lanelab" fill="${c}">${this.teamLabel(i)} · ${total}</text>`;
      if (i) s += `<line x1="${L}" x2="${W - R}" y1="${(Tp + lane * i).toFixed(1)}" y2="${(Tp + lane * i).toFixed(1)}" class="grid"/>`;
    }
    for (const f of [0, 0.25, 0.5, 0.75, 1])
      s += `<text x="${x(t0 + span * f).toFixed(1)}" y="${H - 8}" class="xlab${f === 1 ? ' end' : ''}">${clock(t0 + span * f)}</text>`;
    const rOf = gr => Math.min(Math.max(4, lane * 0.42), 3.5 + Math.sqrt(gr.n) * 2.2);
    dots.forEach((gr, k) => {
      const cx = x((gr.from + gr.to) / 2),
        cy = y(gr.i),
        r = rOf(gr),
        c = this.teams[gr.i].color;
      gr.cx = cx;
      gr.cy = cy;
      gr.r = r;
      s += gr.station
        ? `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="${c}" class="death st" data-k="${k}" transform="rotate(45 ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`
        : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${c}" class="death" data-k="${k}"/>`;
      if (gr.n > 1) s += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" class="dotn">${gr.n}</text>`;
    });
    s += `<line class="cross" y1="${Tp}" y2="${H - B}" visibility="hidden"/></svg>`;
    plot.insertAdjacentHTML('beforeend', s);
    if (!dots.length) el('p', 'sp-rep-none', plot, 'No units were lost.');
    const svg = plot.querySelector('svg'),
      cross = svg.querySelector('.cross'),
      tip = el('div', 'sp-rep-tip', plot);
    let on = null;
    const leave = () => {
      on?.classList.remove('hot');
      on = null;
      cross.setAttribute('visibility', 'hidden');
      tip.style.display = 'none';
    };
    const move = e => {
      const box = svg.getBoundingClientRect(),
        sx = ((e.clientX - box.left) / box.width) * W,
        sy = ((e.clientY - box.top) / box.height) * H;
      let best = null,
        bd = Infinity;
      for (const gr of dots) {
        const d = Math.hypot(gr.cx - sx, gr.cy - sy) - gr.r;
        if (d < bd) {
          bd = d;
          best = gr;
        }
      }
      if (!best || bd > 10) return leave();
      const node = svg.querySelector(`[data-k="${dots.indexOf(best)}"]`);
      if (node !== on) {
        on?.classList.remove('hot');
        on = node;
        on?.classList.add('hot');
      }
      cross.setAttribute('x1', best.cx);
      cross.setAttribute('x2', best.cx);
      cross.setAttribute('visibility', 'visible');
      tip.textContent = '';
      const team = this.teams[best.i];
      el('div', 'sp-rep-tip-time', tip, best.to - best.from >= 1 ? `${clock(best.from)} – ${clock(best.to)}` : clock(best.from));
      const head = el('div', 'sp-rep-tip-row', tip);
      head.style.setProperty('--tc', team.color);
      el('i', '', head);
      el('span', '', head, `${this.teamLabel(best.i)} · ${this.factionLabel(team)} lost ${best.n}`);
      const byType = new Map();
      for (const d of best.list) {
        const key = d.type.name + '|' + (d.by || '');
        const r = byType.get(key) || { type: d.type, n: 0, by: d.by, byColor: d.byColor };
        r.n++;
        byType.set(key, r);
      }
      const rows = [...byType.values()].sort((a, b) => b.n - a.n);
      for (const r of rows.slice(0, 12)) {
        const row = el('div', 'sp-rep-tip-unit', tip);
        const ic = el('span', 'sp-chip', row);
        const url = iconUrl(iconNameFor(r.type) || '');
        if (url) ic.style.backgroundImage = `url(${url})`;
        el('span', 'nm', row, nameOf(r.type) + (r.n > 1 ? ` ×${r.n}` : ''));
        if (r.by) {
          const by = el('span', 'by', row, 'by ' + r.by);
          if (r.byColor) by.style.color = r.byColor;
        }
      }
      if (rows.length > 12) el('div', 'sp-rep-tip-more', tip, `+${rows.length - 12} more`);
      tip.style.display = 'block';
      const pb = plot.getBoundingClientRect(),
        left = box.left - pb.left + (best.cx / W) * box.width,
        top = box.top - pb.top + (best.cy / H) * box.height,
        right = left + 16 + tip.offsetWidth > pb.width;
      tip.style.left = `${right ? left - 16 - tip.offsetWidth : left + 16}px`;
      tip.style.top = `${Math.min(Math.max(0, top - tip.offsetHeight / 2), Math.max(0, pb.height - tip.offsetHeight))}px`;
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', leave);
  }

  graph(plot, g) {
    const W = Math.max(320, Math.round(plot.clientWidth) || 640),
      H = Math.max(160, Math.round(plot.clientHeight) || 190),
      L = 64,
      R = 16,
      Tp = 14,
      B = 30,
      h = this.history,
      n = this.teams.length;
    const vals = h.map((p, k) => this.teams.map((_, i) => g.value(h, k, i)));
    const t0 = h[0].t,
      t1 = h[h.length - 1].t,
      span = Math.max(1, t1 - t0),
      top = Math.max(1, ...vals.flat());
    const x = t => L + ((t - t0) / span) * (W - L - R),
      y = v => Tp + (1 - v / top) * (H - Tp - B);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="sp-rep-svg" role="img" aria-label="${g.title}">`;
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const yy = y(top * f).toFixed(1);
      s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 8}" y="${yy}" class="ylab">${short(top * f)}</text>`;
    }
    for (const f of [0, 0.25, 0.5, 0.75, 1]) s += `<text x="${x(t0 + span * f).toFixed(1)}" y="${H - 8}" class="xlab${f === 1 ? ' end' : ''}">${clock(t0 + span * f)}</text>`;
    const order = this.teams.map((_, i) => i).sort((a, b) => (this.teams[a].key === this.winner) - (this.teams[b].key === this.winner));
    for (const i of order) {
      const pts = h.map((p, k) => `${x(p.t).toFixed(1)},${y(vals[k][i]).toFixed(1)}`).join(' '),
        c = this.teams[i].color;
      s += `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="${this.teams[i].key === this.winner ? 3.2 : 2.2}" stroke-linejoin="round"/>`;
      s += `<circle cx="${x(t1).toFixed(1)}" cy="${y(vals[h.length - 1][i]).toFixed(1)}" r="4" fill="${c}"/>`;
    }
    s += `<g class="hover" visibility="hidden"><line class="cross" y1="${Tp}" y2="${H - B}"/>`;
    for (let i = 0; i < n; i++) s += `<circle r="5" fill="${this.teams[i].color}" class="dot"/>`;
    s += `</g><rect x="${L}" y="${Tp}" width="${W - L - R}" height="${H - Tp - B}" fill="transparent" class="catch"/></svg>`;
    plot.insertAdjacentHTML('beforeend', s);
    const svg = plot.lastChild,
      hover = svg.querySelector('.hover'),
      cross = hover.querySelector('.cross'),
      dots = [...hover.querySelectorAll('.dot')],
      tip = el('div', 'sp-rep-tip', plot);
    const leave = () => {
      hover.setAttribute('visibility', 'hidden');
      tip.style.display = 'none';
    };
    const move = e => {
      const box = svg.getBoundingClientRect(),
        sx = ((e.clientX - box.left) / box.width) * W,
        t = t0 + ((sx - L) / (W - L - R)) * span;
      let k = 0;
      for (let j = 1; j < h.length; j++) if (Math.abs(h[j].t - t) < Math.abs(h[k].t - t)) k = j;
      const px = x(h[k].t);
      cross.setAttribute('x1', px);
      cross.setAttribute('x2', px);
      dots.forEach((d, i) => {
        d.setAttribute('cx', px);
        d.setAttribute('cy', y(vals[k][i]));
      });
      hover.setAttribute('visibility', 'visible');
      tip.textContent = '';
      el('div', 'sp-rep-tip-time', tip, clock(h[k].t));
      const rank = vals[k].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
      for (const [v, i] of rank) {
        const r = el('div', 'sp-rep-tip-row', tip);
        r.style.setProperty('--tc', this.teams[i].color);
        el('i', '', r);
        el('span', '', r, `${this.teamLabel(i)} · ${this.factionLabel(this.teams[i])}`);
        el('b', '', r, g.fmt(v, h[k], i));
      }
      tip.style.display = 'block';
      const pb = plot.getBoundingClientRect(),
        left = box.left - pb.left + (px / W) * box.width,
        right = left + 14 + tip.offsetWidth > pb.width;
      tip.style.left = `${right ? left - 14 - tip.offsetWidth : left + 14}px`;
      tip.style.top = `${Math.max(0, e.clientY - pb.top - tip.offsetHeight / 2)}px`;
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', leave);
  }

  landDeath(u) {
    if (this.src.died) this.src.died(u, item => this.add(item));
  }

  renderCards() {
    const on = this.fogOn && this.fogAvailable;
    this.cards.forEach((card, i) => {
      const team = this.teams[i],
        me = i === this.tracked,
        won = this.winner !== null && this.winner === team.key;
      card.c.classList.toggle('on', me);
      card.c.classList.toggle('won', won);
      card.badge.innerHTML = won ? 'Victor' : me ? (on ? SVG.eyeOff : SVG.eye) : '';
      card.badge.title = me ? 'Following this team' : '';
      this.segments[i].classList.toggle('on', me);
    });
  }

  event(kind, d) {
    this.src.event(kind, d, item => this.add(item));
  }

  add(item) {
    item.time = this.src.time();
    if ((item.kind === 'lost' || item.kind === 'station') && !this.final) {
      const i = this.indexOf(item.team);
      if (i >= 0) this.deaths.push({ t: item.time, i, type: item.type, station: item.kind === 'station', by: item.by, byColor: item.byColor });
    }
    if (this.quiet) return;
    const last = this.log[0];
    if (
      last &&
      item.kind !== 'spawn' &&
      last.kind === item.kind &&
      last.who === item.who &&
      last.type === item.type &&
      item.time - last.time < 2
    ) {
      last.count += item.count;
      last.time = item.time;
      if (last.row) this.fillRow(last);
      return;
    }
    this.log.unshift(item);
    if (this.log.length > LOG_MAX) {
      const gone = this.log.pop();
      gone.row?.remove();
    }
    if (this.shows(item)) {
      this.list.prepend(this.row(item));
      this.empty.remove();
      while (this.list.childElementCount > 120) {
        const r = this.list.lastElementChild;
        const it = this.log.find(x => x.row === r);
        if (it) it.row = null;
        r.remove();
      }
    }
  }

  shows(item) {
    if (this.filter === 'production') return false;
    return this.filter === 'all' || item.team === this.teams[this.tracked]?.key;
  }

  row(item) {
    const r = el('div', `sp-row k-${item.kind}`);
    item.row = r;
    r.style.setProperty('--tc', item.color);
    this.fillRow(item);
    if (item.kind === 'spawn' || Number.isFinite(item.x)) {
      r.classList.add('go');
      r.onclick = () => this.look(item);
    }
    return r;
  }

  fillRow(item) {
    const r = item.row,
      icon = iconUrl(iconNameFor(item.type) || ''),
      what = {
        unit: 'purchased',
        upgrade: 'purchased upgrade',
        spawn: 'deployed',
        lost: 'lost',
        station: 'lost',
        weapon: 'fired'
      }[item.kind],
      go = item.kind === 'spawn' || Number.isFinite(item.x),
      ti = this.indexOf(item.team);
    r.innerHTML =
      `<time>${clock(item.time)}</time><i class="pip"></i>` +
      `<span class="ic"${icon ? ` style="background-image:url(${icon})"` : ''}></span>` +
      `<span class="tx"><span class="who"></span> ${what} <b></b>${item.count > 1 ? ` <em>×${item.count}</em>` : ''}` +
      (item.by ? ` to <span class="by"></span>` : '') +
      (item.target ? ` at <span class="at"></span>` : '') +
      `</span>` +
      (go ? `<span class="loc" title="Move the camera there">${SVG.locate}</span>` : '');
    r.querySelector('.who').textContent = item.who;
    r.querySelector('b').textContent = nameOf(item.type);
    if (item.by) {
      const by = r.querySelector('.by');
      by.textContent = item.by;
      by.style.color = item.byColor;
    }
    if (item.target) r.querySelector('.at').textContent = item.target;
    r.title =
      `${ti >= 0 ? this.teamLabel(ti) + ' · ' : ''}${item.who} · ${nameOf(item.type)}` +
      (item.by ? ` · destroyed by ${item.by}` : '') +
      (go ? '\nClick to move the camera there' : '');
  }

  renderLog() {
    for (const [k, b] of this.tabs) b.classList.toggle('on', k === this.filter);
    const prod = this.filter === 'production';
    this.logBox.classList.toggle('producing', prod);
    if (prod) {
      for (const r of this.prodRows) r.sig = null;
      this.renderProduction();
      return;
    }
    this.list.replaceChildren();
    let n = 0;
    for (const item of this.log) {
      item.row = null;
      if (n >= 120 || !this.shows(item)) continue;
      this.list.appendChild(this.row(item));
      n++;
    }
    if (!n) this.list.appendChild(this.empty);
  }

  look(item) {
    const e = item.entity;
    const live = this.src.where(e),
      at = live || (Number.isFinite(item.x) ? { x: item.x, y: item.y } : null);
    if (!at) return;
    this.src.look(at, live ? e : null);
    item.row?.classList.add('flash');
    setTimeout(() => item.row?.classList.remove('flash'), 600);
    this.game.audio?.play?.('GUI_Button_Press_2_SFX');
  }

  destroy() {
    clearInterval(this.timer);
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('resize', this.onResize);
    this.top?.remove();
    this.logBox?.remove();
    document.getElementById('spReport')?.remove();
    this.src.bar?.root?.classList.remove('spectating');
    document.body.classList.remove('spectating');
    document.body.style.removeProperty('--sp-drop');
  }
}
