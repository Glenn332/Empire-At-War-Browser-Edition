export const UNIT = 16, SHOT = 9, POINT = 5, ABILITY = 5;

export class SpaceRecorder {
  constructor(world) {
    this.world = world;
    this.units = new Float32Array(1024 * UNIT);
    this.shots = new Float32Array(1024 * SHOT);
    this.points = new Float32Array(4096 * POINT);
    this.abilities = new Float32Array(1024 * ABILITY);
    this.nUnits = 0; this.nShots = 0; this.nPoints = 0; this.nAbilities = 0;
    this.players = []; this.queues = [];
    this.known = new Set();
    this.fresh = [];
  }

  write() {
    const w = this.world, us = w.units, qs = w.squads, ps = w.projectiles;
    const n = us.length + qs.length;
    if (n * UNIT > this.units.length) this.units = new Float32Array(Math.ceil(n * 1.5) * UNIT);
    if (ps.length * SHOT > this.shots.length) this.shots = new Float32Array(Math.ceil(ps.length * 1.5) * SHOT);
    const U = this.units, S = this.shots;
    let o = 0;
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      U[o] = u.id; U[o + 1] = (u.dead ? 1 : 0) | (u.isFighter ? 2 : 0) | (u.hyper ? 4 : 0) | (u.cloaked ? 8 : 0);
      U[o + 2] = u.x; U[o + 3] = u.y; U[o + 4] = u.z || 0; U[o + 5] = u.heading; U[o + 6] = u.roll || 0; U[o + 7] = u.pitch || 0;
      U[o + 8] = u.maxHealth ? u.health / u.maxHealth : 1; U[o + 9] = u.maxShield ? u.shield / u.maxShield : 0;
      U[o + 10] = u.speed || 0; U[o + 11] = u.shieldFlash || 0; U[o + 12] = u.hyper ? (u.hyper.dark ?? 1) : 0;
      U[o + 13] = u.seenBy || 0;
      U[o + 14] = u.target && !u.target.dead ? u.target.id : -1; U[o + 15] = u.aim === undefined ? NaN : u.aim;
      o += UNIT;
    }
    let np = 0;
    for (let i = 0; i < us.length; i++) np += us[i].hardpoints ? us[i].hardpoints.length : 0;
    if (np * POINT > this.points.length) this.points = new Float32Array(Math.ceil(np * 1.5) * POINT);
    const H = this.points;
    let h = 0;
    for (let i = 0; i < us.length; i++) {
      const u = us[i], hs = u.hardpoints;
      if (!hs || u.dead) continue;
      for (let k = 0; k < hs.length; k++) {
        const hp = hs[k];
        H[h] = u.id; H[h + 1] = k; H[h + 2] = hp.alive ? 1 : 0; H[h + 3] = hp.target && !hp.target.dead ? hp.target.id : -1; H[h + 4] = hp.maxHealth ? hp.health / hp.maxHealth : 1;
        h += POINT;
      }
    }
    this.nPoints = h / POINT;
    let na = 0;
    for (let i = 0; i < us.length; i++) if (!us[i].dead) na += us[i].abilities ? us[i].abilities.length : 0;
    if (na * ABILITY > this.abilities.length) this.abilities = new Float32Array(Math.ceil(na * 1.5) * ABILITY);
    const A = this.abilities, queues = this.queues = [];
    let a = 0;
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (u.dead) continue;
      if (u.abilities) for (let k = 0; k < u.abilities.length; k++) {
        const st = u.abilities[k];
        A[a] = u.id; A[a + 1] = k; A[a + 2] = st.active ? 1 : 0; A[a + 3] = st.timer || 0; A[a + 4] = st.cooldown || 0;
        a += ABILITY;
      }
      if (u.buildQueues && u.buildQueues.size) {
        const qs = [];
        for (const [k, q] of u.buildQueues) if (q.length) qs.push([k, q.map(it => [it.type.name, it.total, it.left, it.player ? it.player.id : -1])]);
        if (qs.length) queues.push([u.id, qs]);
      }
    }
    this.nAbilities = a / ABILITY;
    this.players = w.players.filter(p => p.id >= 0).map(p => [p.id, p.credits, p.pop, p.popCap, p.popExtra, (p.reinforcements || []).map(t => t.name).join('|')]);
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      U[o] = q.id; U[o + 1] = (q.dead ? 1 : 0) | 16; U[o + 2] = q.x; U[o + 3] = q.y; U[o + 4] = 0; U[o + 5] = q.heading || 0;
      for (let k = 6; k < UNIT; k++) U[o + k] = 0;
      o += UNIT;
    }
    this.nUnits = n;
    o = 0;
    this.fresh.length = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!this.known.has(p.id)) {
        this.known.add(p.id);
        this.fresh.push({ id: p.id, def: p.def.name, speed: p.speed, width: p.width, length: p.length, r: p.r, g: p.g, b: p.b, missile: !!p.missile });
      }
      S[o] = p.id; S[o + 1] = p.x; S[o + 2] = p.y; S[o + 3] = p.z || 0; S[o + 4] = p.vx; S[o + 5] = p.vy; S[o + 6] = p.vz;
      S[o + 7] = p.age || 0; S[o + 8] = p.hidden ? 1 : 0;
      o += SHOT;
    }
    this.nShots = ps.length;
    if (this.known.size > ps.length * 2 + 4096) { const live = new Set(ps.map(p => p.id)); for (const id of this.known) if (!live.has(id)) this.known.delete(id); }
    return (this.nUnits * UNIT + this.nShots * SHOT + this.nPoints * POINT) * 4;
  }
}
