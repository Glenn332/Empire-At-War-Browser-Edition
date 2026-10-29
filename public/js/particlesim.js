const TAU = Math.PI * 2;
const SAMPLES = 32;

export function sampleGroup(g, out) {
  switch (g.type) {
    case 1:
      for (let i = 0; i < 3; i++) out[i] = g.min[i] + Math.random() * (g.max[i] - g.min[i]);
      break;
    case 2:
      for (let i = 0; i < 3; i++) out[i] = (Math.random() * 2 - 1) * g.cube;
      break;
    case 3: {
      const z = Math.random() * 2 - 1,
        a = Math.random() * TAU,
        s = Math.sqrt(1 - z * z);
      const rad = g.sphereEdge ? g.sphereR : Math.random() * g.sphereR;
      out[0] = Math.cos(a) * s * rad;
      out[1] = Math.sin(a) * s * rad;
      out[2] = z * rad;
      break;
    }
    case 4: {
      const a = Math.random() * TAU,
        rad = g.cylEdge ? g.cylR : Math.random() * g.cylR;
      out[0] = Math.cos(a) * rad;
      out[1] = Math.sin(a) * rad;
      out[2] = Math.random() * g.cylH;
      break;
    }
    default:
      out[0] = g.point[0];
      out[1] = g.point[1];
      out[2] = g.point[2];
  }
  return out;
}

export function sampleTrack(table, k) {
  const x = k * (SAMPLES - 1),
    i = x | 0;
  if (i < 1) return table[0];
  if (i >= SAMPLES - 1) return table[SAMPLES - 1];
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}

class Batch {
  constructor(key, desc) {
    this.key = key;
    this.desc = desc;
    this.told = false;
    this.cap = 256;
    this.count = 0;
    this.center = new Float32Array(this.cap * 4);
    this.tint = new Float32Array(this.cap * 4);
    this.cell = new Float32Array(this.cap * 4);
    this.slot = new Float32Array(this.cap);
  }
  grow() {
    const n = (this.cap *= 2),
      g = (old, per) => {
        const a = new Float32Array(n * per);
        a.set(old);
        return a;
      };
    this.center = g(this.center, 4);
    this.tint = g(this.tint, 4);
    this.cell = g(this.cell, 4);
    this.slot = g(this.slot, 1);
  }
  add(x, y, z, half, r, g, b, a, col, row, cellSize, angle, slot) {
    if (this.count >= this.cap) {
      if (this.cap >= 16384) return;
      this.grow();
    }
    const n = this.count++,
      i = n * 4;
    const c = this.center,
      t = this.tint,
      u = this.cell;
    c[i] = x;
    c[i + 1] = y;
    c[i + 2] = z;
    c[i + 3] = half;
    t[i] = r;
    t[i + 1] = g;
    t[i + 2] = b;
    t[i + 3] = a;
    u[i] = col;
    u[i + 1] = row;
    u[i + 2] = cellSize;
    u[i + 3] = angle;
    this.slot[n] = slot;
  }
}

const _v = [0, 0, 0];

export function basisOf(e) {
  const b = [];
  for (let c = 0; c < 3; c++) {
    const x = e[c * 4],
      y = e[c * 4 + 1],
      z = e[c * 4 + 2],
      l = Math.hypot(x, y, z) || 1;
    b.push(x / l, y / l, z / l);
  }
  return b.every((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) < 1e-4) ? null : b;
}

const turn = (B, v) => {
  const x = v[0],
    y = v[1],
    z = v[2];
  v[0] = B[0] * x + B[3] * y + B[6] * z;
  v[1] = B[1] * x + B[4] * y + B[7] * z;
  v[2] = B[2] * x + B[5] * y + B[8] * z;
  return v;
};
const cl = v => (v < 0 ? 0 : v > 255 ? 1 : v / 255);

class System {
  constructor(sim, def, f, opts) {
    this.sim = sim;
    this.def = def;
    this.points = opts.points || null;
    this.basis = opts.basis || null;
    this.scale = opts.scale || 1;
    this.slot = opts.slot ?? -1;
    this.density = 1;
    this.emitting = true;
    this.orphaned = false;
    this.age = 0;
    this.maxEmit = opts.maxEmit ?? Infinity;
    this.dead = false;
    this.visible = true;
    this.f = { x: 0, y: 0, z: 0, rot: 0, roll: 0, scale: 1, vx: 0, vy: 0, bright: 1, dx: 0, dy: 0, dz: 0, lr: 0, ll: 0, lt: 0, ...f };
    this.emitters = def.emitters
      .filter(e => !e.heat || sim.heatOn)
      .map(e => ({ e, time: 0, next: e.delay, bursts: 0, parts: [], trailAcc: 0, pointIdx: 0, accel: this.basis ? turn(this.basis, [...e.accel]) : e.accel }));
    for (const s of this.emitters) s.trailState = s.e.trail ? this.emitters.find(o => o.e === s.e.trail) : null;
    for (const s of this.emitters) if (s.e.skipTime > 0) for (let t = 0; t <= s.e.skipTime; t += 0.1) this.stepEmitter(s, 0.1);
  }

  spawn(s, age, at) {
    const e = s.e,
      f = this.f,
      sc = f.scale * this.scale;
    if (s.parts.length > 1500 || this.sim.total > 30000) return;
    const cr = Math.cos(f.rot),
      sr = Math.sin(f.rot);
    let lx, ly, lz;
    if (at) {
      lx = at[0];
      ly = at[1];
      lz = at[2];
    } else if (e.emitMode && this.points && this.points.length) {
      const pt = this.points[e.emitMode === 3 ? s.pointIdx++ % this.points.length : (Math.random() * this.points.length) | 0];
      lx = pt[0];
      ly = pt[1];
      lz = pt[2];
    } else if (f.ll > 0) {
      const u2 = Math.random(),
        u3 = Math.random(),
        a = Math.random() * TAU;
      let t = (u2 * f.lt) / 2;
      if (u3 < 0.5) t = 1 - t;
      const z = t * f.ll,
        r = (1 - 2 * t) ** 2 * f.lr * (e.pos.cylEdge ? 1 : Math.random());
      const ca = Math.cos(a) * r,
        sa = Math.sin(a) * r,
        hl = Math.hypot(f.dx, f.dy) || 1;
      const bx = hl > 1e-6 ? -f.dy / hl : 1,
        by = hl > 1e-6 ? f.dx / hl : 0,
        cx = f.dy * 0 + -f.dz * by,
        cy = f.dz * bx,
        cz = f.dx * by - f.dy * bx;
      lx = bx * ca + cx * sa + f.dx * z;
      ly = by * ca + cy * sa + f.dy * z;
      lz = cz * sa + f.dz * z;
      sampleGroup(e.vel, _v);
      let vx2 = _v[0],
        vy2 = _v[1],
        vz2 = _v[2];
      const ol2 = Math.hypot(lx, ly, lz);
      let rx2 = 0,
        ry2 = 0,
        rz2 = 0;
      if (e.radialSpeed && ol2 > 1e-4) {
        const k = e.radialSpeed / ol2;
        rx2 = lx * k;
        ry2 = ly * k;
        rz2 = lz * k;
      }
      const q = {
        life: e.lifetime * (1 - Math.random() * e.randLife),
        age: age || 0,
        x: f.x + lx,
        y: f.y + ly,
        z: f.z + lz,
        vx: vx2,
        vy: vy2,
        vz: vz2,
        rx: rx2,
        ry: ry2,
        rz: rz2,
        size: 1 + (Math.random() * 2 - 1) * e.randScale,
        angle: 0,
        flip: e.randRotDir && Math.random() < 0.5,
        cr: (Math.random() * e.randColor[0] * 100) | 0,
        cg: 0,
        cb: 0,
        ca: -((Math.random() * e.randColor[3] * 100) | 0),
        world: true
      };
      q.cg = e.greyRand ? q.cr : (Math.random() * e.randColor[1] * 100) | 0;
      q.cb = e.greyRand ? q.cr : (Math.random() * e.randColor[2] * 100) | 0;
      if (e.staticRot) q.angle = e.tracks[6][0] * TAU * (1 + (Math.random() * 2 - 1) * e.randRot);
      s.parts.push(q);
      this.sim.total++;
      return;
    } else {
      sampleGroup(e.pos, _v);
      if (this.basis) turn(this.basis, _v);
      lx = _v[0] * sc;
      ly = _v[1] * sc;
      lz = _v[2] * sc;
    }
    sampleGroup(e.vel, _v);
    if (this.basis && !at) turn(this.basis, _v);
    let vx = _v[0] * sc,
      vy = _v[1] * sc,
      vz = _v[2] * sc;
    const ol = Math.hypot(lx, ly, lz);
    let rx = 0,
      ry = 0,
      rz = 0;
    if (e.radialSpeed && ol > 1e-4) {
      const k = (e.radialSpeed * sc) / ol;
      rx = lx * k;
      ry = ly * k;
      rz = lz * k;
    }
    const p = {
      life: e.lifetime * (1 - Math.random() * e.randLife),
      age: age || 0,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      size: 1 + (Math.random() * 2 - 1) * e.randScale,
      angle: 0,
      flip: e.randRotDir && Math.random() < 0.5,
      cr: (Math.random() * e.randColor[0] * 100) | 0,
      cg: 0,
      cb: 0,
      ca: -((Math.random() * e.randColor[3] * 100) | 0)
    };
    p.cg = e.greyRand ? p.cr : (Math.random() * e.randColor[1] * 100) | 0;
    p.cb = e.greyRand ? p.cr : (Math.random() * e.randColor[2] * 100) | 0;
    if (e.staticRot) p.angle = e.tracks[6][0] * TAU * (1 + (Math.random() * 2 - 1) * e.randRot);
    if (e.objectSpace && !at) {
      p.x = lx;
      p.y = ly;
      p.z = lz;
      p.vx = vx;
      p.vy = vy;
      p.vz = vz;
      p.rx = rx;
      p.ry = ry;
      p.rz = rz;
    } else if (at) {
      p.x = lx;
      p.y = ly;
      p.z = lz;
      p.vx = vx;
      p.vy = vy;
      p.vz = vz;
    } else {
      p.x = f.x + cr * lx - sr * ly;
      p.y = f.y + sr * lx + cr * ly;
      p.z = f.z + lz;
      p.vx = cr * vx - sr * vy + f.vx;
      p.vy = sr * vx + cr * vy + f.vy;
      p.vz = vz + (f.vz || 0);
      p.rx = cr * rx - sr * ry;
      p.ry = sr * rx + cr * ry;
      p.rz = rz;
    }
    p.world = !e.objectSpace || !!at;
    s.parts.push(p);
    this.sim.total++;
  }

  stepEmitter(s, dt) {
    const e = s.e,
      f = this.f;
    s.time += dt;
    if (this.emitting && !e.slave) {
      while (s.time >= s.next && (!e.burst || e.nBursts === 0 || s.bursts < e.nBursts)) {
        const n = e.burst ? e.perBurst : e.emitMode === 3 && this.points ? this.points.length : 1;
        const age = Math.min(s.time - s.next, e.lifetime * 0.9);
        const dens = this.density * (e.burst && n <= 2 ? 1 : this.sim.detail);
        for (let i = 0; i < n; i++) if (dens >= 1 || Math.random() < dens) this.spawn(s, age);
        s.bursts++;
        s.next += e.emitMode === 3 && !e.burst ? Math.max(e.interval, 0.25) : e.interval;
      }
    }
    const parts = s.parts;
    let n = 0;
    const ax = s.accel[0],
      ay = s.accel[1],
      az = s.accel[2] - e.gravity;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.sim.total--;
        continue;
      }
      p.vx += ax * dt;
      p.vy += ay * dt;
      p.vz += az * dt;
      if (e.radialAccel) {
        const ox = p.world ? p.x - f.x : p.x,
          oy = p.world ? p.y - f.y : p.y,
          oz = p.world ? p.z - f.z : p.z;
        const l = Math.hypot(ox, oy, oz);
        if (l > 1e-3) {
          const k = (e.radialAccel * dt) / l;
          p.vx += ox * k;
          p.vy += oy * k;
          p.vz += oz * k;
        }
      }
      p.x += (p.vx + p.rx) * dt;
      p.y += (p.vy + p.ry) * dt;
      p.z += (p.vz + p.rz) * dt;
      if (!e.staticRot) {
        const rs = sampleTrack(e.tracks[6], p.age / p.life);
        if (rs) p.angle += rs * TAU * dt * (1 + (Math.random() * 2 - 1) * e.randRot);
      }
      parts[n++] = p;
    }
    parts.length = n;
    if (s.trailState && n) {
      const t = s.trailState;
      t.trailAcc += dt * t.e.perSecond;
      const emit = t.trailAcc | 0;
      t.trailAcc -= emit;
      if (emit) {
        const cr = Math.cos(f.rot),
          sr = Math.sin(f.rot);
        for (const p of parts) {
          const wx = p.world ? p.x : f.x + cr * p.x - sr * p.y,
            wy = p.world ? p.y : f.y + sr * p.x + cr * p.y,
            wz = p.world ? p.z : f.z + p.z;
          for (let k = 0; k < emit; k++) this.spawn(t, 0, [wx, wy, wz]);
        }
      }
    }
  }

  update(dt) {
    if ((this.age += dt) > this.maxEmit) this.emitting = false;
    let live = 0,
      pending = false;
    for (const s of this.emitters) {
      this.stepEmitter(s, dt);
      live += s.parts.length;
      const e = s.e;
      if (this.emitting && !e.slave && (!e.burst || e.nBursts === 0 || s.bursts < e.nBursts)) pending = true;
    }
    if (!live && !pending) this.dead = true;
  }

  draw() {
    if (!this.visible) return;
    const f = this.f,
      cr = Math.cos(f.rot),
      sr = Math.sin(f.rot),
      sc = f.scale * this.scale;
    const co = Math.cos(f.roll || 0),
      so = Math.sin(f.roll || 0);
    const slot = this.slot;
    for (const s of this.emitters) {
      const e = s.e;
      if (!s.parts.length) continue;
      const batch = this.sim.batch(e);
      const T = e.tracks,
        cell = 1 / e.grid;
      for (const p of s.parts) {
        const k = p.age / p.life;
        const idx = sampleTrack(T[5], k) | 0;
        let x = p.x,
          y = p.y,
          z = p.z,
          at = -1;
        if (!p.world) {
          if (slot >= 0) at = slot;
          else {
            const lx = p.x * co + p.z * so,
              lz = p.z * co - p.x * so;
            x = f.x + cr * lx - sr * p.y;
            y = f.y + sr * lx + cr * p.y;
            z = f.z + lz;
          }
        }
        const bright = f.bright;
        batch.add(
          x,
          y,
          z,
          0.5 * sampleTrack(T[4], k) * p.size * sc,
          cl(sampleTrack(T[0], k) + p.cr) * bright,
          cl(sampleTrack(T[1], k) + p.cg) * bright,
          cl(sampleTrack(T[2], k) + p.cb) * bright,
          cl(sampleTrack(T[3], k) + p.ca) * bright,
          idx % e.grid,
          ((idx / e.grid) | 0) % e.grid,
          cell,
          p.flip ? -p.angle : p.angle,
          at
        );
      }
    }
  }
}

export const FRAME = 21;

export class ParticleSim {
  constructor() {
    this.defs = new Map();
    this.systems = new Map();
    this.batches = new Map();
    this.total = 0;
    this.heatOn = false;
    this.heatScene = false;
    this.detail = 1;
  }

  batch(e) {
    let b = e._batch;
    if (b && b.heat === (e.heat && this.heatScene)) return b.batch;
    const additive = e.blend === 1 || e.blend === 4,
      heat = e.heat && this.heatScene;
    const key = e.texture.toUpperCase() + (heat ? '|H' : additive ? '|A' : '|B') + (e.noDepth ? 'N' : '');
    let batch = this.batches.get(key);
    if (!batch) this.batches.set(key, (batch = new Batch(key, { key, texture: e.texture, additive, noDepth: !!e.noDepth, heat: !!heat })));
    e._batch = { heat, batch };
    return batch;
  }

  create(id, key, f, opts) {
    const def = this.defs.get(key);
    if (!def) return;
    this.systems.set(id, new System(this, def, f, opts));
  }

  step(dt, frames) {
    const dead = [];
    for (let i = 0; i + FRAME <= frames.length; i += FRAME) {
      const id = frames[i],
        s = this.systems.get(id);
      if (!s) continue;
      if (frames[i + 12]) {
        for (const em of s.emitters) this.total -= em.parts.length;
        this.systems.delete(id);
        dead.push(id);
        continue;
      }
      const f = s.f;
      f.x = frames[i + 1];
      f.y = frames[i + 2];
      f.z = frames[i + 3];
      f.rot = frames[i + 4];
      f.roll = frames[i + 5];
      f.scale = frames[i + 6];
      f.vx = frames[i + 7];
      f.vy = frames[i + 8];
      f.bright = frames[i + 13];
      f.dx = frames[i + 14];
      f.dy = frames[i + 15];
      f.dz = frames[i + 16];
      f.lr = frames[i + 17];
      f.ll = frames[i + 18];
      f.lt = frames[i + 19];
      f.vz = frames[i + 20];
      s.visible = frames[i + 9] !== 0;
      s.density = frames[i + 10];
      const em = frames[i + 11];
      if (em !== 1) s.emitting = false;
      if (em === 2 && !s.orphaned) {
        s.orphaned = true;
        for (const st of s.emitters) if (st.parts.length) st.parts = st.parts.filter(p => p.world);
      }
    }
    for (const b of this.batches.values()) b.count = 0;
    for (const [id, s] of this.systems) {
      if (dt > 0) s.update(dt);
      if (s.dead) {
        this.systems.delete(id);
        dead.push(id);
        continue;
      }
      s.draw();
    }
    return dead;
  }
}
