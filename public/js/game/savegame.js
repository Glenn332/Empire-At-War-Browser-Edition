import { db } from '../gamedata.js';
import { buildListFor } from './sim.js';
import { useAbility, refreshMods } from './abilities.js';
import { BUILD } from '../build.js';
import { expansion } from '../edition.js';
import { snapshotGalaxy } from './galaxy.js';
import { saveBattleScripts } from './tacticalsave.js';

export const SAVE_VERSION = 2;
export const MODES = ['space', 'land', 'galactic'];
const EXT = '.swrsave';

const r1 = v => Math.round(v * 10) / 10;

export function defaultName(game) {
  if (game.galactic) return game.saveName();
  return snapshot(game).name;
}

export async function snapshotNow(game, name = '') {
  if (game.mirror) return withMultiplayer(game, await game.mirror.save(name));
  return snapshot(game, name);
}

export function snapshot(game, name = '') {
  const s = game.galactic
    ? game.galacticSnapshot(name, { version: SAVE_VERSION, build: BUILD })
    : game.landBattle
      ? game.landSnapshot(name, { version: SAVE_VERSION, build: BUILD })
      : spaceSnapshot(game, name);
  return withMultiplayer(game, s);
}

export function withMultiplayer(game, s) {
  const setup = game.setup,
    net = setup.net;
  if (s.setup) delete s.setup.net;
  if (!net || (setup.campaign && !game.galactic)) return s;
  const players = setup.players || [];
  const mine = p => p.human && (p.peer === net.me || p.peers?.includes(net.me));
  const saver = game.galactic ? players.findIndex(mine) : game.landBattle ? game.me : game.human ? game.human.id : -1;
  s.multiplayer = {
    type: setup.type || (s.mode === 'galactic' ? 'campaign' : s.mode),
    saver,
    slots: players.map(p => ({
      human: !!p.human,
      name: p.human ? String(p.name || '') : '',
      difficulty: p.difficulty,
      team: p.team,
      faction: p.faction,
      color: p.color
    }))
  };
  (s.setup?.players || []).forEach((p, i) => {
    if (players[i]?.human) p.name = players[i].name;
  });
  return s;
}

export function campaignSetup(game) {
  const plain = (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && v.constructor && v.constructor !== Object && typeof v.name === 'string' ? v.name : v;
  const { restore, ...setup } = game.setup;
  const out = JSON.parse(JSON.stringify(setup, plain));
  const tc = game.tacticalCampaign;
  if (tc && tc.galaxy) {
    const view = setup.campaign.galaxy?.view;
    out.campaign.galaxy = snapshotGalaxy(tc.galaxy);
    if (view) out.campaign.galaxy.view = { ...view };
  }
  return out;
}

function spaceCampaign(game, ref) {
  const book = game.campaignBook,
    gone = e => ({ dead: true, retreated: !!e.retreated });
  return {
    setup: campaignSetup(game),
    destroyedBy: game.tacticalCampaign?.destroyedBy || null,
    book: {
      entity: [...book.entity].map(([gid, e]) => [gid, (!e.dead && ref(e)) || gone(e)]),
      waiting: book.waiting.map(u => ({
        gid: u.gid,
        type: u.type.name,
        team: u.team,
        ...(u.companyType ? { companyType: u.companyType.name || u.companyType } : {})
      })),
      absent: book.absent.slice(),
      station: book.station ? (!book.station.dead && ref(book.station)) || gone(book.station) : null,
      called: [...(book.called || new Map())].map(([team, list]) => [team, list.map(e => (!e.dead && ref(e)) || gone(e))])
    }
  };
}

export function restoreSpaceCampaign(game, save, refs) {
  const c = save.campaign,
    book = game.campaignBook;
  if (!c || !book) return;
  const get = r => (typeof r === 'string' ? refs.get(r) || { dead: true } : { dead: true, retreated: !!(r && r.retreated) });
  book.entity = new Map(c.book.entity.map(([gid, r]) => [gid, get(r)]));
  book.waiting = c.book.waiting
    .map(u => ({ ...u, type: db.type(u.type), ...(u.companyType ? { companyType: db.type(u.companyType) } : {}) }))
    .filter(u => u.type);
  book.absent = c.book.absent.slice();
  book.station = c.book.station ? get(c.book.station) : null;
  book.called = new Map(c.book.called.map(([team, list]) => [+team, list.map(get)]));
  if (game.tacticalCampaign && c.destroyedBy) game.tacticalCampaign.destroyedBy = c.destroyedBy;
}

function spaceSnapshot(game, name) {
  const w = game.world,
    R = game.renderer;
  if (game.settle) game.settle();
  const { ents, refs } = saveRefs(w);
  const ref = e => (e ? (refs.get(e.squad || e) ?? null) : null);
  const order = o => {
    const out = { kind: o.kind };
    if (o.x !== undefined) {
      out.x = r1(o.x);
      out.y = r1(o.y);
    }
    if (o.pace !== undefined && o.pace < 1) out.pace = +o.pace.toFixed(3);
    if (o.target) {
      const t = ref(o.target);
      if (t) out.target = t;
      else if (o.kind === 'attack' || o.kind === 'guard') out.kind = 'idle';
    }
    return out;
  };
  const abilities = u =>
    u.abilities
      .map(a => ({
        kind: a.def.kind,
        active: !!a.active,
        cooldown: r1(Math.max(0, a.cooldown || 0)),
        ...(a.def.autofire ? { auto: !!a.auto } : {})
      }))
      .filter(a => a.active || a.cooldown > 0 || a.auto !== undefined);
  const queues = u =>
    [...u.buildQueues]
      .map(([key, q]) => [key, q.map(it => ({ type: it.type.name, total: it.total, left: r1(it.left), player: it.player.id }))])
      .filter(([, q]) => q.length);
  const body = u => {
    const x = u.hyper ? u.hyper.tx : u.x,
      y = u.hyper ? u.hyper.ty : u.y;
    const o = { x: r1(x), y: r1(y), z: r1(u.z), h: +u.heading.toFixed(3), hp: r1(u.health), sh: r1(u.shield) };
    if (u.hardpoints.length) o.hps = u.hardpoints.map(h => (h.alive ? r1(h.health) : -1));
    return o;
  };
  const unit = u => {
    const o = { type: u.type.name, p: u.player.id, ...body(u), order: order(u.order) };
    if (u.queue && u.queue.length) o.way = u.queue.map(order);
    if (u.target) {
      const t = ref(u.target);
      if (t) o.target = t;
    }
    const ab = abilities(u);
    if (ab.length) o.ab = ab;
    const q = queues(u);
    if (q.length) o.q = q;
    if (u.construction)
      o.con = {
        left: r1(u.construction.left),
        total: u.construction.total,
        result: u.construction.result ? u.construction.result.name : ''
      };
    if (u.padOf) o.padOf = ref(u.padOf);
    if (u.player.team.station === u) o.station = true;
    if (u.player.team.firstStation === u) o.first = true;
    if (u.garrison.length) {
      o.gar = u.garrison.map(g => ({ spawned: g.spawned || 0, remaining: g.remaining }));
      o.gt = r1(u.spawnTimer || 0);
    }
    if (u.income) o.inc = r1(u.income.timer);
    if (u.everSeenBy) o.seen = u.everSeenBy;
    return o;
  };
  const squad = s => {
    const o = {
      squad: true,
      type: s.type.name,
      p: s.player.id,
      x: r1(s.x),
      y: r1(s.y),
      h: +s.heading.toFixed(3),
      order: order(s.order),
      f: s.fighters.map(body)
    };
    if (s.queue && s.queue.length) o.way = s.queue.map(order);
    if (s.target) {
      const t = ref(s.target);
      if (t) o.target = t;
    }
    if (s.carrier) {
      const c = ref(s.carrier);
      if (c) o.carrier = c;
    }
    const ab = s.fighters[0] ? abilities(s.fighters[0]) : [];
    if (ab.length) o.ab = ab;
    return o;
  };
  const map = {};
  for (const u of w.units) {
    if (u.mapIndex === undefined) continue;
    const o = {};
    if (u.dead) o.dead = true;
    else {
      if (u.player.id >= 0) o.p = u.player.id;
      if (u.padOwner) o.owner = u.padOwner.id;
      if (u.capture && (u.capture.progress > 0 || u.capture.by))
        o.cap = { progress: r1(u.capture.progress), by: u.capture.by ? u.capture.by.id : -1 };
      if (u.health < u.maxHealth - 0.5) {
        o.hp = r1(u.health);
        if (u.hardpoints.length) o.hps = u.hardpoints.map(h => (h.alive ? r1(h.health) : -1));
      }
      const q = queues(u);
      if (q.length) o.q = q;
      if (u.everSeenBy) o.seen = u.everSeenBy;
    }
    if (Object.keys(o).length) map[u.mapIndex] = o;
  }
  const setup = game.setup;
  const campaign = setup.campaign && game.campaignBook ? spaceCampaign(game, ref) : undefined;
  const thingRef = u => (u.squad ? (r => (r ? r + '.' + u.squad.fighters.indexOf(u) : null))(ref(u.squad)) : ref(u));
  let scripts = null;
  try {
    scripts = saveBattleScripts(game, thingRef);
  } catch (error) {
    console.warn('the battle is saved without its scripts (they start over when it is loaded):', error.message || error);
  }
  return {
    format: 'sw-revival-save',
    version: SAVE_VERSION,
    build: BUILD,
    saved: new Date().toISOString(),
    ...(campaign ? { campaign } : {}),
    name:
      name ||
      `${game.map.planet || db.t(game.map.textId) || 'Skirmish'} — ${Math.floor(w.time / 60)}:${String(Math.floor(w.time % 60)).padStart(2, '0')}`,
    setup: {
      mapFile: setup.mapFile,
      credits: setup.credits,
      popCap: setup.popCap,
      fog: setup.fog,
      teamFactions: setup.teamFactions.slice(),
      players: setup.players.map(p => ({ human: !!p.human, team: p.team, color: p.color, difficulty: p.difficulty }))
    },
    mode: 'space',
    summary: {
      mode: 'space',
      planet: game.map.planet || '',
      factions: setup.teamFactions.slice(),
      time: Math.round(w.time),
      units: ents.filter(e => e.player === game.human).length
    },
    battle: {
      kind: 'space',
      time: r1(w.time),
      speed: game.speed,
      camera: { x: r1(R.rig.x), y: r1(R.rig.y), dist: r1(R.rig.dist), yaw: +R.rig.yaw.toFixed(3), pitch: +R.rig.pitch.toFixed(3) },
      teams: w.teams.map(t => ({ upgrades: [...t.upgrades], defeated: !!t.defeated })),
      players: w.players.map(p => ({
        credits: Math.round(p.credits),
        stats: { ...p.stats },
        reinforcements: p.reinforcements.map(t => t.name)
      })),
      entities: ents.map(e => (e.isSquad ? squad(e) : unit(e))),
      map,
      groups: [...game.ui.groups].map(([n, list]) => [n, list.map(ref).filter(Boolean)]).filter(([, l]) => l.length),
      selection: game.ui.selection.map(ref).filter(Boolean),
      ...(game.retreat ? { retreat: game.retreat.snapshot(thingRef) } : {}),
      ...(scripts ? { scripts } : {})
    }
  };
}

export function saveRefs(w) {
  const ents = [];
  const refs = new Map();
  for (const u of w.units) {
    if (u.dead || u.squad) continue;
    if (u.mapIndex !== undefined) refs.set(u, 'm' + u.mapIndex);
    else if (u.player.id >= 0) {
      refs.set(u, 'e' + ents.length);
      ents.push(u);
    }
  }
  for (const s of w.squads)
    if (!s.dead && s.fighters.length) {
      refs.set(s, 'e' + ents.length);
      ents.push(s);
    }
  return { ents, refs };
}

export function upgrade(s) {
  if (!s || s.format !== 'sw-revival-save' || !(s.version >= 1)) return s;
  if (s.version < 2) {
    s.mode = 'space';
    s.battle = { kind: 'space' };
    for (const k of ['time', 'speed', 'camera', 'teams', 'players', 'entities', 'map', 'groups', 'selection']) {
      if (k in s) {
        s.battle[k] = s[k];
        delete s[k];
      }
    }
    s.summary = { mode: 'space', ...(s.summary || {}) };
    s.version = 2;
  }
  return s;
}

export function validate(s) {
  if (!s || s.format !== 'sw-revival-save') return 'This is not a save file of this game.';
  if (s.version > SAVE_VERSION) return 'This save was made by a newer version of the game.';
  upgrade(s);
  if (!MODES.includes(s.mode)) return 'This save is from a part of the game this version cannot play yet.';
  const b = s.battle;
  if (s.mode === 'galactic')
    return s.setup && s.setup.campaign && s.galaxy && Array.isArray(s.galaxy.planets) ? null : 'The save file is incomplete.';
  if (s.mode === 'land') {
    if (!s.setup || !b || !Array.isArray(b.squads) || !Array.isArray(b.sites)) return 'The save file is incomplete.';
  } else if (!s.setup || !b || !Array.isArray(b.entities) || !Array.isArray(b.players) || !Array.isArray(b.teams))
    return 'The save file is incomplete.';
  if (!s.setup.mapFile || !Array.isArray(s.setup.players) || !Array.isArray(s.setup.teamFactions))
    return 'The save file has no match settings.';
  return null;
}

export function restore(game, save) {
  const snap = upgrade(save).battle;
  const w = game.world;
  const P = id => w.players.find(p => p.id === id) || null;
  const missing = [];

  const upgradeStation = w.upgradeStation;
  w.upgradeStation = () => {};
  snap.teams.forEach((ts, i) => {
    const t = w.teams[i];
    if (!t) return;
    const p = t.players[0];
    for (const n of ts.upgrades || []) {
      const ty = db.type(n);
      if (ty && p) w.applyUpgrade(p, ty);
      else if (!ty) missing.push(n);
    }
    t.defeated = !!ts.defeated;
  });
  w.upgradeStation = upgradeStation;

  for (const u of w.units) if (u.mapIndex === undefined && u.player.id >= 0 && !u.dead) w.removeUnit(u);
  for (const s of w.squads) s.dead = true;
  w.units = w.units.filter(u => !u.dead);
  w.unitGridN = Infinity;
  w.squads = [];
  for (const t of w.teams) t.station = null;

  const refs = new Map();
  const byMap = new Map();
  for (const u of w.units)
    if (u.mapIndex !== undefined) {
      byMap.set(u.mapIndex, u);
      refs.set('m' + u.mapIndex, u);
    }

  const damage = (u, o) => {
    if (o.hps && o.hps.length === u.hardpoints.length) {
      u.hardpoints.forEach((h, i) => {
        if (o.hps[i] < 0) {
          h.alive = false;
          h.health = 0;
          h.smoke = true;
          if (h.part) h.part.visible = false;
          if (h.decal) h.decal.visible = true;
        } else h.health = Math.min(h.maxHealth, o.hps[i]);
      });
    }
    if (o.hp !== undefined) u.health = Math.max(1, Math.min(u.maxHealth, o.hp));
    if (o.sh !== undefined) u.shield = Math.max(0, Math.min(u.maxShield, o.sh));
  };
  const place = (u, o) => {
    u.x = o.x;
    u.y = o.y;
    if (o.z !== undefined) u.z = o.z;
    u.heading = o.h;
    u.syncObj();
  };

  for (const [idx, o] of Object.entries(snap.map || {})) {
    const u = byMap.get(+idx);
    if (!u) continue;
    if (o.dead) {
      w.removeUnit(u);
      continue;
    }
    if (o.p !== undefined && P(o.p) && u.player !== P(o.p)) {
      u.player = P(o.p);
      u.buildList = buildListFor(u.type, u.player.factionName);
    }
    if (o.owner !== undefined) u.padOwner = P(o.owner);
    if (o.cap && u.capture) {
      u.capture.progress = o.cap.progress;
      u.capture.by = P(o.cap.by);
    }
    damage(u, o);
    if (o.seen) u.everSeenBy = o.seen;
  }
  w.units = w.units.filter(u => !u.dead);
  w.unitGridN = Infinity;

  const made = [];
  snap.entities.forEach((o, i) => {
    const type = db.type(o.type),
      p = P(o.p);
    if (!type || !p) {
      if (!type) missing.push(o.type);
      made.push(null);
      return;
    }
    const first = o.squad ? o.f[0] : o;
    const e = w.spawn(type, p, o.x, o.y, o.h);
    if (!e) {
      made.push(null);
      return;
    }
    if (e.isSquad) {
      while (e.fighters.length > o.f.length) {
        const f = e.fighters.pop();
        w.removeUnit(f);
      }
      e.fighters.forEach((f, k) => {
        place(f, o.f[k]);
        damage(f, o.f[k]);
      });
      e.x = o.x;
      e.y = o.y;
      e.heading = o.h;
    } else {
      place(e, o);
      damage(e, o);
      if (o.station) p.team.station = e;
      if (o.first) p.team.firstStation = e;
      if (o.con) e.construction = { left: o.con.left, total: o.con.total, result: db.type(o.con.result) || null };
      if (o.gar)
        o.gar.forEach((g, k) => {
          const x = e.garrison[k];
          if (!x) return;
          x.spawned = g.spawned;
          x.remaining = g.remaining ?? (x.remaining < 0 ? -1 : (g.reserve || 0) + Math.max(0, x.want - (g.spawned || 0)));
        });
      if (o.gt !== undefined) e.spawnTimer = o.gt;
      if (o.inc !== undefined && e.income) e.income.timer = o.inc;
      if (o.seen) e.everSeenBy = o.seen;
    }
    made.push(e);
    refs.set('e' + i, e);
  });
  w.units = w.units.filter(u => !u.dead);
  w.unitGridN = Infinity;

  const get = r => (r ? refs.get(r) || null : null);
  const order = o => {
    if (!o) return { kind: 'idle' };
    const out = { kind: o.kind };
    if (o.x !== undefined) {
      out.x = o.x;
      out.y = o.y;
    }
    if (o.pace !== undefined) out.pace = o.pace;
    if (o.target) {
      out.target = get(o.target);
      if (!out.target && (o.kind === 'attack' || o.kind === 'guard')) return { kind: 'idle' };
    }
    return out;
  };
  const queues = (u, list) => {
    for (const [key, items] of list || []) {
      const q = items
        .map(it => ({ type: db.type(it.type), total: it.total, left: it.left, player: P(it.player) }))
        .filter(it => it.type && it.player);
      if (q.length) {
        u.buildQueues.set(key, q);
        w.holdQueues(u);
      }
    }
  };
  for (const [idx, o] of Object.entries(snap.map || {})) {
    const u = byMap.get(+idx);
    if (u && !u.dead) queues(u, o.q);
  }
  snap.entities.forEach((o, i) => {
    const e = made[i];
    if (!e) return;
    e.setOrder(order(o.order));
    if (o.way) e.queue = o.way.map(order);
    const t = get(o.target);
    if (t) e.target = e.isSquad ? t : t.isSquad ? t.fighters[0] || null : t;
    if (e.isSquad) {
      const c = get(o.carrier);
      if (c && !c.isSquad) {
        e.carrier = c;
        const g = c.garrison.find(x => x.type === e.type) || c.garrison[0];
        if (g) g.live.push(e);
      }
    } else {
      queues(e, o.q);
      const pad = get(o.padOf);
      if (pad) {
        e.padOf = pad;
        pad.padChild = e;
        pad.obj.visible = !pad.type.bool('Hides_When_Built_On', true);
      }
    }
    const lead = e.isSquad ? e.fighters[0] : e;
    for (const a of o.ab || []) {
      const st = lead && lead.abilities.find(s => s.def.kind === a.kind);
      if (!st) continue;
      if (a.auto !== undefined)
        for (const f of e.isSquad ? e.fighters : [e]) {
          const s = f.abilities.find(x => x.def.kind === a.kind);
          if (s) s.auto = a.auto;
        }
      if (a.active && st.def.toggle && st.def.target === 'none') useAbility(w, e, a.kind, true);
      else
        for (const f of e.isSquad ? e.fighters : [e]) {
          const s = f.abilities.find(x => x.def.kind === a.kind);
          if (s) s.cooldown = a.cooldown;
        }
    }
    for (const f of e.isSquad ? e.fighters : [e]) refreshMods(f);
  });

  snap.players.forEach((ps, i) => {
    const p = w.players[i];
    if (!p) return;
    p.credits = ps.credits;
    Object.assign(p.stats, ps.stats || {});
    p.reinforcements = (ps.reinforcements || []).map(n => db.type(n)).filter(Boolean);
    if (!p.human) p.aiPool = p.reinforcements.map(type => ({ type, owner: null }));
  });
  w.time = snap.time || 0;
  w.recountPop();
  w.updateVisibility();
  return { refs, missing: [...new Set(missing)] };
}

export function restoreView(game, save, refs) {
  const snap = save.battle;
  if (game.setup.net) {
    if (game.setup.restoreSlot !== game.human?.id) return;
  } else game.setSpeed(snap.speed || 1);
  const rig = game.renderer.rig,
    c = snap.camera;
  if (c) {
    rig.x = c.x;
    rig.y = c.y;
    rig.dist = c.dist;
    rig.yaw = c.yaw;
    if (c.pitch) rig.pitch = c.pitch;
    rig.clamp();
  }
  const alive = list => (list || []).map(r => refs.get(r)).filter(e => e && !e.dead);
  for (const [n, list] of snap.groups || []) {
    const g = alive(list);
    if (g.length) game.ui.groups.set(n, g);
  }
  const sel = alive(snap.selection);
  if (sel.length) game.ui.select(sel, false);
}

const OWN = expansion() ? '' : '-eaw';
const LS = 'swr-save' + OWN + ':';
async function dir() {
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    const d = await root.getDirectoryHandle('saves' + OWN, { create: true });
    return 'createWritable' in FileSystemFileHandle.prototype ? d : null;
  } catch {
    return null;
  }
}
const meta = (id, s) => ({
  id,
  name: s.name,
  saved: s.saved,
  summary: s.summary || {},
  build: s.build,
  ...(s.multiplayer ? { mp: s.multiplayer } : {})
});

const canPack = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
const pack = async text =>
  new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const unpack = async blob => new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();

export async function listSaves() {
  const out = [];
  const d = await dir();
  if (d) {
    const listed = new Set();
    for await (const [fname, h] of d.entries()) {
      if (h.kind !== 'file' || !fname.endsWith('.meta')) continue;
      try {
        out.push(JSON.parse(await (await h.getFile()).text()));
        listed.add(fname.slice(0, -5));
      } catch {}
    }
    for await (const [fname, h] of d.entries()) {
      if (h.kind !== 'file' || !fname.endsWith('.json') || listed.has(fname.slice(0, -5))) continue;
      try {
        out.push(meta(fname.slice(0, -5), JSON.parse(await (await h.getFile()).text())));
      } catch {}
    }
  } else {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(LS)) {
          try {
            out.push(meta(k.slice(LS.length), JSON.parse(localStorage.getItem(k))));
          } catch {}
        }
      }
    } catch {}
  }
  return out.sort((a, b) => (a.saved < b.saved ? 1 : -1));
}

export async function putSave(snap, id = null) {
  id ||= 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const text = JSON.stringify(snap);
  const d = await dir();
  if (d) {
    const packed = text.length > 262144 && canPack();
    const w = await (await d.getFileHandle(id + (packed ? '.swz' : '.json'), { create: true })).createWritable();
    await w.write(packed ? await pack(text) : text);
    await w.close();
    await d.removeEntry(id + (packed ? '.json' : '.swz')).catch(() => {});
    const m = await (await d.getFileHandle(id + '.meta', { create: true })).createWritable();
    await m.write(JSON.stringify(meta(id, snap)));
    await m.close();
  } else {
    try {
      localStorage.setItem(LS + id, text);
    } catch (error) {
      throw new Error(
        'This browser has no room to keep a game of this size (' + Math.round(text.length / 1048576) + ' MB): download it instead.'
      );
    }
  }
  return id;
}

export async function getSave(id) {
  try {
    const d = await dir();
    let text;
    if (d) {
      const packed = await d.getFileHandle(id + '.swz').catch(() => null);
      text = packed ? await unpack(await packed.getFile()) : await (await (await d.getFileHandle(id + '.json')).getFile()).text();
    } else text = localStorage.getItem(LS + id);
    return text ? upgrade(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export async function deleteSave(id) {
  const d = await dir();
  if (d) for (const ext of ['.json', '.swz', '.meta']) await d.removeEntry(id + ext).catch(() => {});
  else {
    try {
      localStorage.removeItem(LS + id);
    } catch {}
  }
}

export function downloadSave(snap) {
  const safe =
    (snap.name || 'save')
      .replace(/[^\w\- ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'save';
  const url = URL.createObjectURL(new Blob([JSON.stringify(snap)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = safe + EXT;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function packSave(snap) {
  const text = JSON.stringify(snap);
  if (!canPack()) return { json: text };
  const bytes = await pack(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return { gz: btoa(bin) };
}

export async function unpackSave(p) {
  if (p.json) return upgrade(JSON.parse(p.json));
  const bin = atob(p.gz),
    bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return upgrade(JSON.parse(await unpack(new Blob([bytes]))));
}

export async function importSaveFile(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('That file is too large to be a save.');
  let snap;
  try {
    snap = JSON.parse(await file.text());
  } catch {
    throw new Error('That file could not be read as a save.');
  }
  const why = validate(snap);
  if (why) throw new Error(why);
  return { id: await putSave(snap), snap };
}
