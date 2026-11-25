export const UNIT = 16,
  SHOT = 9,
  POINT = 5,
  ABILITY = 5;

export const beamMessage = beam => [
  beam.a.id,
  beam.b.id !== undefined ? beam.b.id : [beam.b.x, beam.b.y, beam.b.z || 0],
  beam.color,
  beam.width,
  beam.bone,
  beam.kind
];

export function beamFromMessage(unitById, [from, to, color, width, bone, kind]) {
  const source = unitById.get(from),
    target = Array.isArray(to) ? { x: to[0], y: to[1], z: to[2] } : unitById.get(to);
  return source && target ? { a: source, b: target, color, width, bone, kind, until: Infinity } : null;
}

// Deep equality for the plain values the props channel carries (numbers, strings, null and arrays
// of them). Compared element by element instead of through JSON text, which cost several
// milliseconds a step once thousands of units were recorded. NaN equals NaN, as it did as JSON.
function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
    return true;
  }
  return typeof a === 'number' && typeof b === 'number' && a !== a && b !== b;
}

export class SpaceRecorder {
  constructor(world) {
    this.world = world;
    this.units = new Float32Array(1024 * UNIT);
    this.shots = new Float32Array(1024 * SHOT);
    this.points = new Float32Array(4096 * POINT);
    this.abilities = new Float32Array(1024 * ABILITY);
    this.nUnits = 0;
    this.nShots = 0;
    this.nPoints = 0;
    this.nAbilities = 0;
    this.players = [];
    this.queues = [];
    this.known = new Set();
    this.newestShot = 0;
    this.fresh = [];
    this.sent = new Map();
    this.sentPoints = new Map();
    this.sentAbilities = new Map();
    this.props = [];
    this.teams = [];
    this.world_ = [];
  }

  changed(id, v) {
    if (sameValue(this.sent.get(id), v)) return;
    this.sent.set(id, v);
    this.props.push([id, v]);
  }

  // True when a unit's slow state is what was last sent, checked field by field without building the list
  // writeProps would compare. Most units change none of these in a step.
  unitPropsUnchanged(u) {
    const prev = this.sent.get(u.id);
    if (!prev) return false;
    const c = u.capture,
      th = u.targetHp,
      o = u.order,
      q = u.queue,
      sentOrder = prev[9];
    if (
      prev[0] !== (u.player ? u.player.id : -1) ||
      prev[1] !== (c ? c.progress : 0) ||
      prev[2] !== (c && c.by ? c.by.id : -1) ||
      prev[3] !== (u.lastHitTime ?? -100) ||
      prev[4] !== (u.inNebula ? 1 : 0) ||
      prev[5] !== (u.ionUntil || 0) ||
      prev[6] !== (u.scriptHidden ? 1 : 0) ||
      prev[7] !== (u.maxHealth || 0) ||
      prev[8] !== (u.maxShield || 0) ||
      (q && q.length) ||
      prev[10].length ||
      (th && th.unit && th.unit.hardpoints && th.alive) ||
      prev[11] !== null
    )
      return false;
    if (!(o && o.kind && o.kind !== 'idle')) return sentOrder === null;
    return (
      !!sentOrder &&
      sentOrder[0] === o.kind &&
      sentOrder[1] === (o.x ?? null) &&
      sentOrder[2] === (o.y ?? null) &&
      sentOrder[3] === (o.target && !o.target.dead ? o.target.id : -1)
    );
  }

  // The same check for a squadron: true only when every field matches what was last sent.
  squadPropsUnchanged(q) {
    const prev = this.sent.get(q.id);
    if (!prev) return false;
    const ids = prev[1],
      fs = q.fighters,
      about = q.about,
      sentAbout = prev[5],
      o = q.order,
      sentOrder = prev[2];
    if (
      prev[0] !== (q.player ? q.player.id : -1) ||
      ids.length !== fs.length ||
      (q.queue && q.queue.length) ||
      prev[3].length ||
      prev[4] !== (q.mode || null) ||
      prev[6] !== (q.target && !q.target.dead ? q.target.id : -1) ||
      prev[7] !== q.dogKey
    )
      return false;
    for (let i = 0; i < fs.length; i++) if (ids[i] !== fs[i].id) return false;
    if (about ? !sentAbout || sentAbout[0] !== about.x || sentAbout[1] !== about.y || sentAbout[2] !== (about.cell ? 1 : 0) : sentAbout !== null)
      return false;
    if (!(o && o.kind && o.kind !== 'idle')) return sentOrder === null;
    return (
      !!sentOrder &&
      sentOrder[0] === o.kind &&
      sentOrder[1] === (o.x ?? null) &&
      sentOrder[2] === (o.y ?? null) &&
      sentOrder[3] === (o.target && !o.target.dead ? o.target.id : -1)
    );
  }

  writeProps() {
    const w = this.world;
    let live = 0;
    this.props = [];
    const order = o =>
      o && o.kind && o.kind !== 'idle' ? [o.kind, o.x ?? null, o.y ?? null, o.target && !o.target.dead ? o.target.id : -1] : null;
    for (const u of w.units) {
      if (u.dead) continue;
      live++;
      if (this.unitPropsUnchanged(u)) continue;
      const c = u.capture,
        th = u.targetHp,
        hs = th && th.unit && th.unit.hardpoints;
      this.changed(u.id, [
        u.player ? u.player.id : -1,
        c ? c.progress : 0,
        c && c.by ? c.by.id : -1,
        u.lastHitTime ?? -100,
        u.inNebula ? 1 : 0,
        u.ionUntil || 0,
        u.scriptHidden ? 1 : 0,
        u.maxHealth || 0,
        u.maxShield || 0,
        order(u.order),
        (u.queue || []).map(order).filter(Boolean),
        hs && th.alive ? [th.unit.id, hs.indexOf(th)] : null
      ]);
    }
    for (const q of w.squads) {
      if (q.dead) continue;
      live++;
      if (this.squadPropsUnchanged(q)) continue;
      this.changed(q.id, [
        q.player ? q.player.id : -1,
        q.fighters.map(f => f.id),
        order(q.order),
        (q.queue || []).map(order).filter(Boolean),
        q.mode || null,
        q.about ? [q.about.x, q.about.y, q.about.cell ? 1 : 0] : null,
        q.target && !q.target.dead ? q.target.id : -1,
        q.dogKey
      ]);
    }
    if (this.sent.size > live * 2 + 256) {
      const seen = new Set();
      for (const u of w.units) if (!u.dead) seen.add(u.id);
      for (const q of w.squads) if (!q.dead) seen.add(q.id);
      for (const id of this.sent.keys()) if (!seen.has(id)) this.sent.delete(id);
    }
    this.teams = w.teams.map(t => (t.station && !t.station.dead ? t.station.id : -1));
    this.world_ = [
      w.lastViewerCombat ?? null,
      (w.reveals || []).map(r => [w.teams.indexOf(r.team), r.x, r.y, r.r, r.until === Infinity ? -1 : r.until]),
      w.reveal ? 1 : 0,
      w.fogLifted || 0,
      (w.specialWeapons || []).map(sw => [sw.firedAt, sw.readyAt, sw.left]),
      w.dogs ? [...w.dogs.cells].filter(c => c[1].length).map(([k, l]) => [k, l.map(q => q.id)]) : [],
      w.players.map(p => [p.id, p.manualStart, p.manualSpan]),
      w.storyBlips?.size
        ? [...w.storyBlips].map(([name, b]) => [name, b.obj && !b.obj.dead ? b.obj.id : -1, b.x ?? null, b.y ?? null, b.until ?? null])
        : null
    ];
  }

  write() {
    const w = this.world,
      us = w.units,
      qs = w.squads,
      ps = w.projectiles;
    const n = us.length + qs.length;
    if (n * UNIT > this.units.length) this.units = new Float32Array(Math.ceil(n * 1.5) * UNIT);
    if (ps.length * SHOT > this.shots.length) this.shots = new Float32Array(Math.ceil(ps.length * 1.5) * SHOT);
    const U = this.units,
      S = this.shots;
    let o = 0;
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      U[o] = u.id;
      U[o + 1] =
        (u.dead ? 1 : 0) |
        (u.isFighter ? 2 : 0) |
        (u.hyper ? 4 : 0) |
        (u.cloaked ? 8 : 0) |
        (u.flip ? 32 : 0) |
        (u.hyper && !u.hyper.shown ? 64 : 0) |
        (u.shieldBarDown ? 128 : 0);
      u.flip = false;
      U[o + 2] = u.x;
      U[o + 3] = u.y;
      U[o + 4] = u.z || 0;
      U[o + 5] = u.heading;
      U[o + 6] = u.roll || 0;
      U[o + 7] = u.pitch || 0;
      U[o + 8] = u.maxHealth ? u.health / u.maxHealth : 1;
      U[o + 9] = u.maxShield ? u.shield / u.maxShield : 0;
      U[o + 10] = u.speed || 0;
      U[o + 11] = u.shieldFlash || 0;
      U[o + 12] = u.hyper ? (u.hyper.dark ?? 1) : 0;
      U[o + 13] = u.seenBy || 0;
      U[o + 14] = u.target && !u.target.dead ? u.target.id : -1;
      U[o + 15] = u.aim === undefined ? NaN : u.aim;
      o += UNIT;
    }
    let np = 0;
    for (let i = 0; i < us.length; i++) np += us[i].hardpoints ? us[i].hardpoints.length : 0;
    if (np * POINT > this.points.length) this.points = new Float32Array(Math.ceil(np * 1.5) * POINT);
    const H = this.points;
    let h = 0;
    for (let i = 0; i < us.length; i++) {
      const u = us[i],
        hs = u.hardpoints;
      if (!hs || u.dead || !hs.length) continue;
      // Only the hardpoints that changed since the page last heard of them are written: in a big battle nearly all
      // of the thousands of hardpoints are the same from one step to the next.
      let sent = this.sentPoints.get(u.id);
      if (!sent || sent.length !== hs.length * 3) this.sentPoints.set(u.id, (sent = new Float64Array(hs.length * 3).fill(NaN)));
      for (let k = 0; k < hs.length; k++) {
        const hp = hs[k],
          alive = hp.alive ? 1 : 0,
          target = hp.target && !hp.target.dead ? hp.target.id : -1,
          health = hp.maxHealth ? hp.health / hp.maxHealth : 1,
          at = k * 3;
        if (sent[at] === alive && sent[at + 1] === target && sent[at + 2] === health) continue;
        sent[at] = alive;
        sent[at + 1] = target;
        sent[at + 2] = health;
        H[h] = u.id;
        H[h + 1] = k;
        H[h + 2] = alive;
        H[h + 3] = target;
        H[h + 4] = health;
        h += POINT;
      }
    }
    this.nPoints = h / POINT;
    if (this.sentPoints.size > us.length * 2 + 1024) {
      const live = new Set();
      for (let i = 0; i < us.length; i++) if (!us[i].dead) live.add(us[i].id);
      for (const id of this.sentPoints.keys()) if (!live.has(id)) this.sentPoints.delete(id);
      for (const id of this.sentAbilities.keys()) if (!live.has(id)) this.sentAbilities.delete(id);
    }
    let na = 0;
    for (let i = 0; i < us.length; i++) if (!us[i].dead) na += us[i].abilities ? us[i].abilities.length : 0;
    if (na * ABILITY > this.abilities.length) this.abilities = new Float32Array(Math.ceil(na * 1.5) * ABILITY);
    const A = this.abilities,
      queues = (this.queues = []);
    let a = 0;
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (u.dead) continue;
      if (u.abilities && u.abilities.length) {
        // like hardpoints, an ability is written only when it changed: most of a big battle's abilities sit idle
        let sent = this.sentAbilities.get(u.id);
        if (!sent || sent.length !== u.abilities.length * 3)
          this.sentAbilities.set(u.id, (sent = new Float64Array(u.abilities.length * 3).fill(NaN)));
        for (let k = 0; k < u.abilities.length; k++) {
          const st = u.abilities[k],
            flags = (st.active ? 1 : 0) | (st.auto ? 2 : 0),
            timer = st.timer || 0,
            cooldown = st.cooldown || 0,
            at = k * 3;
          if (sent[at] === flags && sent[at + 1] === timer && sent[at + 2] === cooldown) continue;
          sent[at] = flags;
          sent[at + 1] = timer;
          sent[at + 2] = cooldown;
          A[a] = u.id;
          A[a + 1] = k;
          A[a + 2] = flags;
          A[a + 3] = timer;
          A[a + 4] = cooldown;
          a += ABILITY;
        }
      }
      if (u.buildQueues && u.buildQueues.size) {
        const qs = [];
        for (const [k, q] of u.buildQueues)
          if (q.length) qs.push([k, q.map(it => [it.type.name, it.total, it.left, it.player ? it.player.id : -1])]);
        if (qs.length) queues.push([u.id, qs]);
      }
    }
    this.nAbilities = a / ABILITY;
    const pads = (this.pads = []);
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (u.dead) continue;
      if (u.isPad || u.padChild || u.padOwner !== undefined)
        pads.push([u.id, u.padChild && !u.padChild.dead ? u.padChild.id : -1, u.padOwner ? u.padOwner.id : u.padOwner === null ? -2 : -3]);
      if (u.construction) pads.push([u.id, -4, u.construction.left, u.construction.total]);
      // What this page's viewer last saw of a capture point (see World.markViewCells).
      if (u.capture && u.viewSees !== undefined) pads.push([u.id, -5, u.viewSees ? 1 : 0, u.viewOwner ? u.viewOwner.id : -1]);
    }
    this.players = w.players
      .filter(p => p.id >= 0)
      .map(p => [
        p.id,
        p.credits,
        p.pop,
        p.popCap,
        p.popExtra,
        (p.reinforcements || []).map(t => t.name).join('|'),
        [...p.upgrades].join('|'),
        p.everBought ? [...p.everBought].map(([t, n]) => t.name + '=' + n).join('|') : '',
        p.stats,
        p.bounty || 0,
        p.lockedTech ? [...p.lockedTech].map(t => t.name) : [],
        p.unlockedTech ? [...p.unlockedTech].map(t => t.name) : []
      ]);
    this.writeProps();
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      U[o] = q.id;
      U[o + 1] = (q.dead ? 1 : 0) | (q.hyper ? 4 : 0) | 16;
      U[o + 2] = q.x;
      U[o + 3] = q.y;
      U[o + 4] = 0;
      U[o + 5] = q.heading || 0;
      for (let k = 6; k < UNIT; k++) U[o + k] = 0;
      U[o + 12] = q.hyper || 0;
      U[o + 14] = q.carrier && !q.carrier.dead ? q.carrier.id : -1;
      o += UNIT;
    }
    this.nUnits = n;
    o = 0;
    this.fresh.length = 0;
    if (w.shots && w.shotRowsOf === ps && w.shotRowCount === ps.length) this.writeShotRows(w.shots, w.shotRows, ps, S);
    else this.writeShotObjects(ps, S);
    this.nShots = ps.length;
    return (this.nUnits * UNIT + this.nShots * SHOT + this.nPoints * POINT) * 4;
  }

  freshShot(p, id) {
    this.fresh.push({
      id,
      def: p.def.name,
      speed: p.speed,
      width: p.width,
      length: p.length,
      r: p.r,
      g: p.g,
      b: p.b,
      missile: !!p.missile
    });
  }

  // The battle's shots straight from their rows of numbers (see shots.js). Shots are numbered as they are made and
  // listed in that order, so one numbered above the newest written so far is new to the page.
  writeShotRows(store, rows, ps, S) {
    const newestBefore = this.newestShot;
    let o = 0;
    for (let i = 0; i < ps.length; i++) {
      const row = rows[i],
        id = store.id[row];
      if (id > newestBefore) {
        this.freshShot(ps[i], id);
        if (id > this.newestShot) this.newestShot = id;
      }
      S[o] = id;
      S[o + 1] = store.x[row];
      S[o + 2] = store.y[row];
      S[o + 3] = store.z[row] || 0;
      S[o + 4] = store.vx[row];
      S[o + 5] = store.vy[row];
      S[o + 6] = store.vz[row];
      S[o + 7] = store.age[row] || 0;
      S[o + 8] = store.hidden[row];
      o += SHOT;
    }
  }

  // The same from a plain list of shots (a world whose shots are not kept in rows).
  writeShotObjects(ps, S) {
    let o = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!this.known.has(p.id)) {
        this.known.add(p.id);
        this.freshShot(p, p.id);
      }
      S[o] = p.id;
      S[o + 1] = p.x;
      S[o + 2] = p.y;
      S[o + 3] = p.z || 0;
      S[o + 4] = p.vx;
      S[o + 5] = p.vy;
      S[o + 6] = p.vz;
      S[o + 7] = p.age || 0;
      S[o + 8] = p.hidden ? 1 : 0;
      o += SHOT;
    }
    if (this.known.size > ps.length * 2 + 4096) {
      const live = new Set(ps.map(p => p.id));
      for (const id of this.known) if (!live.has(id)) this.known.delete(id);
    }
  }
}
