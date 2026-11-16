import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadModel } from '../model.js';
import { AnimState } from '../ala.js';
import { animClip } from './land.js';
import { bakeRoom, lookFor, lookOf, shadedBox, shadedTube, shadedMat, fitUV, gameTexture, sharedBay, bayMaterial } from './baylook.js';

const BAY = { len: 5.6, wid: 4.2, high: 2.1, bench: 0.3, seat: 0.3, back: 0.08, door: 1.7, doorH: 1.45, ramp: 1.42, win: 0.95, winLo: 0.62, winHi: 1.32, walk: 2.2, eye: 0.9, out: 0.75, rail: 0.17, railH: 0.93, railR: 0.022, hold: 0.45, body: 0.24, me: 0.22 },
  DOWN = new THREE.Vector3(0, 0, -1),
  UP = new THREE.Vector3(0, 0, 1),
  _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _q2 = new THREE.Quaternion();

const hash = s => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

export function bayExit(H, i = 0) {
  const h = Math.max(6, Math.min(30, H || 12)),
    rampLen = Math.max(BAY.doorH * h, BAY.ramp * h);
  return { x: (BAY.len * h) / 2 + rampLen * Math.cos(0.25) + h * 0.35, y: ((i % 3) - 1) * h * 0.45, yaw: 0 };
}

export class TroopBay {
  constructor(world, side, height) {
    this.world = world;
    this.side = side;
    this.H = Math.max(6, Math.min(30, height || 12));
    this.group = new THREE.Group();
    this.seats = [];
    this.spots = [];
    this.blocks = [];
    this.benches = [];
    this.windows = [];
    this.rails = [];
    this.railZ = null;
    this.sitters = new Map();
    this.left = new Set();
    this.avatars = new Map();
    this.lights = [];
    this.rampK = 0;
    this.me = { x: -this.H * 1.2, y: 0, yaw: 0, pitch: -0.05, moving: false };
    this.build();
    this.shell = [...this.group.children];
    this.group.userData.casts = true;
    world.scene.add(this.group);
  }

  box(w, d, h, tex, x, y, z, solid = false, tint = 1, tile = 0.9) {
    const b = shadedBox(w, d, h, tex, tile * this.H, tint);
    b.position.set(x, y, z);
    this.group.add(b);
    if (solid) this.blocks.push({ x0: x - w / 2, x1: x + w / 2, y0: y - d / 2, y1: y + d / 2 });
    return b;
  }

  tube(len, r, tex, x, y, z, axis = 'x', tint = 1) {
    const t = shadedTube(len, r, tex, tint);
    if (axis === 'x') t.rotation.z = Math.PI / 2;
    else if (axis === 'z') t.rotation.x = Math.PI / 2;
    t.position.set(x, y, z);
    this.group.add(t);
    return t;
  }

  surface(geo, map, u0, du, v0, dv) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - u0) / du, (uv.getY(i) - v0) / dv);
    uv.needsUpdate = true;
    const m = new THREE.Mesh(geo, bayMaterial(map));
    this.group.add(m);
    return m;
  }

  build() {
    const H = this.H,
      L = BAY.len * H,
      W = BAY.wid * H,
      T = BAY.high * H,
      g = this.group,
      key = lookFor(this.world.factions?.[this.side]),
      look = lookOf(key),
      trim = look.trim,
      pipe = look.pipe,
      ww = BAY.win * H,
      lo = BAY.winLo * H,
      hi = BAY.winHi * H,
      D = BAY.door * H,
      DH = BAY.doorH * H,
      bd = BAY.bench * H,
      bh = BAY.seat * H;
    this.L = L;
    this.W = W;
    this.T = T;
    this.look = key;
    this.windows.push(-L * 0.2, L * 0.2);
    for (const sy of [-1, 1]) {
      const edges = [-L / 2 + H * 0.3, ...this.windows.flatMap(cx => [cx - ww / 2 - H * 0.08, cx + ww / 2 + H * 0.08]), L / 2 - H * 0.3];
      for (let k = 0; k < edges.length; k += 2) {
        const x0 = edges[k],
          x1 = edges[k + 1],
          len = x1 - x0;
        if (len < H * 0.45) continue;
        this.benches.push({ x0, x1, sy });
        const per = Math.max(1, Math.floor(len / (H * 0.62)));
        for (let s = 0; s < per; s++) this.seats.push({ x: x0 + (len * (s + 0.5)) / per, y: sy * (W / 2 - bd * 0.35), sy, face: (-sy * Math.PI) / 2, taken: null });
      }
    }
    const tx = bakeRoom(key, {
      L: BAY.len,
      W: BAY.wid,
      T: BAY.high,
      D: BAY.door,
      DH: BAY.doorH,
      winLo: BAY.winLo,
      winHi: BAY.winHi,
      windows: this.windows.map(x => x / H),
      benches: this.benches.map(b => ({ x0: b.x0 / H, x1: b.x1 / H, sy: b.sy })),
      bench: BAY.bench,
      seat: BAY.seat
    }).textures;
    this.surface(new THREE.PlaneGeometry(L, W), tx.floor, 0, 1, 0, 1);
    this.surface(new THREE.PlaneGeometry(L, W), tx.ceil, 0, 1, 0, 1).position.z = T;
    for (const k of [-1, 1]) {
      this.tube(L * 0.96, H * 0.05, pipe, 0, k * (W / 2 - H * 0.12), T - H * 0.1, 'x', 0.55);
      this.tube(L * 0.96, H * 0.03, pipe, 0, k * (W / 2 - H * 0.25), T - H * 0.08, 'x', 0.75);
      for (const x of [-0.4, -0.13, 0.13, 0.4]) this.box(H * 0.06, H * 0.34, H * 0.05, trim, x * L, k * (W / 2 - H * 0.17), T - H * 0.025, false, 0.6, 0.4);
    }
    for (const sy of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(-L / 2, 0);
      shape.lineTo(L / 2, 0);
      shape.lineTo(L / 2, T);
      shape.lineTo(-L / 2, T);
      shape.lineTo(-L / 2, 0);
      for (const cx of this.windows) {
        const x0 = cx - ww / 2,
          c = ww * 0.18,
          outline = (p, e) => {
            p.moveTo(x0 + c - e * 0.4, lo - e);
            p.lineTo(x0 + ww - c + e * 0.4, lo - e);
            p.lineTo(x0 + ww + e, lo + c - e * 0.4);
            p.lineTo(x0 + ww + e, hi - c + e * 0.4);
            p.lineTo(x0 + ww - c + e * 0.4, hi + e);
            p.lineTo(x0 + c - e * 0.4, hi + e);
            p.lineTo(x0 - e, hi - c + e * 0.4);
            p.lineTo(x0 - e, lo + c - e * 0.4);
            p.lineTo(x0 + c - e * 0.4, lo - e);
            return p;
          };
        shape.holes.push(outline(new THREE.Path(), 0));
        const ring = outline(new THREE.Shape(), H * 0.07);
        ring.holes.push(outline(new THREE.Path(), 0));
        const frame = new THREE.Mesh(fitUV(new THREE.ExtrudeGeometry(ring, { depth: H * 0.09, bevelEnabled: false }), H * 0.5), shadedMat(trim, 0.5));
        frame.rotation.x = Math.PI / 2;
        frame.position.y = sy > 0 ? W / 2 + 0.02 : -W / 2 + H * 0.09 - 0.02;
        g.add(frame);
        const glass = new THREE.Mesh(
          new THREE.PlaneGeometry(ww, hi - lo),
          new THREE.MeshBasicMaterial({ color: 0x9cc8f0, transparent: true, opacity: 0.1, depthWrite: false, fog: false, side: THREE.DoubleSide })
        );
        glass.rotation.x = Math.PI / 2;
        glass.position.set(cx, sy * (W / 2 + H * 0.03), (lo + hi) / 2);
        g.add(glass);
        this.box(ww * 1.12, H * 0.1, H * 0.05, trim, cx, sy * (W / 2 - H * 0.05), lo - H * 0.07, false, 0.75, 0.5);
      }
      const wall = this.surface(new THREE.ShapeGeometry(shape), tx.wall, -L / 2, L, 0, T);
      wall.rotation.x = Math.PI / 2;
      wall.position.y = sy * (W / 2);
      for (const b of this.benches) {
        if (b.sy !== sy) continue;
        const len = b.x1 - b.x0,
          cx = (b.x0 + b.x1) / 2;
        this.box(len, bd, H * 0.06, trim, cx, sy * (W / 2 - bd / 2), bh - H * 0.03, false, 0.95, 0.7);
        this.box(len - H * 0.06, H * 0.03, bh - H * 0.07, trim, cx, sy * (W / 2 - bd + H * 0.07), (bh - H * 0.07) / 2, false, 0.45, 0.7);
        for (const lx of [b.x0 + H * 0.06, b.x1 - H * 0.06]) this.box(H * 0.05, bd - H * 0.04, bh - H * 0.06, trim, lx, sy * (W / 2 - bd / 2), (bh - H * 0.06) / 2, false, 0.55, 0.5);
        this.blocks.push({ x0: b.x0, x1: b.x1, y0: sy > 0 ? W / 2 - bd : -W / 2, y1: sy > 0 ? W / 2 : -W / 2 + bd });
      }
      for (const cx of [-L / 2 + H * 0.05, ...this.windows.map(c => c - ww / 2 - H * 0.12), ...this.windows.map(c => c + ww / 2 + H * 0.12), L / 2 - H * 0.05])
        this.box(H * 0.1, H * 0.1, T, trim, cx, sy * (W / 2 - H * 0.05), T / 2, false, 0.6, 0.6);
      const rz = BAY.railH * H;
      this.railZ = rz;
      this.rails.push(this.tube(L * 0.84, H * BAY.railR, pipe, -L * 0.02, sy * W * BAY.rail, rz, 'x', 1.15));
      for (const hx of [-L * 0.4, -L * 0.1, L * 0.2, L * 0.38]) this.rails.push(this.tube(T - rz, H * 0.012, pipe, hx, sy * W * BAY.rail, (T + rz) / 2, 'z', 0.9));
      for (const hx of [-L * 0.32, -L * 0.04, L * 0.24]) this.spots.push({ x: hx, y: sy * (W * BAY.rail + H * 0.3), sy, face: (-sy * Math.PI) / 2, taken: null });
    }
    const back = this.surface(new THREE.PlaneGeometry(W, T), tx.back, 0, 1, 0, 1);
    back.rotation.set(Math.PI / 2, -Math.PI / 2, 0);
    back.position.set(-L / 2, 0, T / 2);
    const sc = document.createElement('canvas');
    sc.width = 512;
    sc.height = 256;
    this.screenCtx = sc.getContext('2d');
    this.screenTex = new THREE.CanvasTexture(sc);
    this.box(H * 0.08, H * 1.78, H * 0.95, trim, -L / 2 + H * 0.04, 0, H * 1.25, false, 0.4, 0.5);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(H * 1.6, H * 0.8), new THREE.MeshBasicMaterial({ map: this.screenTex, fog: false, side: THREE.DoubleSide }));
    screen.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    screen.position.set(-L / 2 + H * 0.085, 0, H * 1.25);
    g.add(screen);
    const fs = new THREE.Shape();
    fs.moveTo(-W / 2, 0);
    fs.lineTo(W / 2, 0);
    fs.lineTo(W / 2, T);
    fs.lineTo(-W / 2, T);
    fs.lineTo(-W / 2, 0);
    const dh = new THREE.Path();
    dh.moveTo(-D / 2, 0);
    dh.lineTo(D / 2, 0);
    dh.lineTo(D / 2, DH);
    dh.lineTo(-D / 2, DH);
    dh.lineTo(-D / 2, 0);
    fs.holes.push(dh);
    const front = this.surface(new THREE.ShapeGeometry(fs), tx.front, -W / 2, W, 0, T);
    front.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    front.position.x = L / 2;
    for (const k of [-1, 1]) this.box(H * 0.16, H * 0.14, DH, trim, L / 2 - H * 0.08, k * (D / 2 + H * 0.07), DH / 2, false, 0.55, 0.5);
    this.box(H * 0.16, D + H * 0.28, H * 0.14, trim, L / 2 - H * 0.08, 0, DH + H * 0.07, false, 0.55, 0.5);
    this.box(H * 0.06, H * 0.3, H * 0.45, trim, L / 2 - H * 0.05, D / 2 + H * 0.5, H * 0.95, false, 0.35, 0.4);
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(H * 0.03, H * 0.06, H * 0.06), new THREE.MeshBasicMaterial({ color: 0xff4a32, fog: false }));
      l.position.set(L / 2 - H * 0.09, D / 2 + H * 0.5, H * 1.05 - i * H * 0.12);
      g.add(l);
      this.lights.push({ m: l, k: i });
    }
    this.hinge = new THREE.Group();
    this.hinge.position.set(L / 2 + H * 0.06, 0, 0);
    const rampLen = Math.max(DH, BAY.ramp * H),
      rampGeo = new THREE.BoxGeometry(rampLen, D, H * 0.08),
      ruv = rampGeo.attributes.uv,
      rp = rampGeo.attributes.position,
      rn = rampGeo.attributes.normal,
      rt = look.rampTile * H;
    for (let i = 0; i < ruv.count; i++) {
      const x = rp.getX(i),
        y = rp.getY(i),
        z = rp.getZ(i);
      if (Math.abs(rn.getZ(i)) > 0.5) ruv.setXY(i, rt ? x / rt : ((y + D / 2) / D) * 0.48, rt ? y / rt : x / (D * 0.5));
      else ruv.setXY(i, (Math.abs(rn.getX(i)) > 0.5 ? y : x) / (H * 0.6), z / (H * 0.6));
    }
    ruv.needsUpdate = true;
    const rampMap = gameTexture(look.ramp),
      ramp = new THREE.Mesh(
        rampGeo,
        [0.6, 0.6, 0.65, 0.65, 0.9, 0.35].map(k => bayMaterial(rampMap, k))
      );
    ramp.position.set(rampLen / 2, 0, 0);
    this.hinge.add(ramp);
    for (const k of [-1, 1]) {
      const rail = shadedBox(rampLen, H * 0.06, H * 0.1, trim, H * 0.5, 0.5);
      rail.position.set(rampLen / 2, k * (D / 2 - H * 0.03), H * 0.07);
      this.hinge.add(rail);
    }
    this.hinge.rotation.y = -Math.PI / 2;
    g.add(this.hinge);
    this.rampLen = rampLen;
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(D * 0.6, H * 0.06), new THREE.MeshBasicMaterial({ color: 0xff4a32, fog: false, side: THREE.DoubleSide }));
    warn.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    warn.position.set(L / 2 - H * 0.17, 0, DH + H * 0.07);
    this.warn = warn;
    g.add(warn);
  }

  castPass(on) {
    for (const o of this.shell) o.visible = !on;
  }

  shadowView() {
    const p = this.group.position;
    return { x: p.x, y: p.y, z: p.z, half: this.L * 0.75, yaw: this.group.rotation.z };
  }

  place(origin, yaw, floorZ, sway = 0, roll = 0) {
    const g = this.group;
    g.position.set(origin.x, origin.y, floorZ);
    g.rotation.set(roll, sway, yaw, 'ZYX');
    g.updateMatrixWorld(true);
  }

  toWorld(x, y, z = 0, out = _c) {
    return out.set(x, y, z).applyMatrix4(this.group.matrixWorld);
  }

  async seatModel(typeName) {
    const t = db.type(typeName);
    if (!t) return null;
    const file = t.str('Land_Model_Name'),
      inst = file && (await loadModel(file, { teamColor: this.world.teamColorFor(this.side, t) }).catch(() => null));
    if (!inst) return null;
    const holder = new THREE.Group();
    holder.add(inst.root);
    holder.scale.setScalar(t.num('Scale_Factor', 1));
    return { t, inst, holder, posed: false };
  }

  async sit(id, typeName, seed = '') {
    if (this.sitters.has(id)) return;
    const r = hash(seed + ':' + id),
      standing = r < 0.45 && this.spots.some(s => !s.taken),
      list = standing ? this.spots : this.seats,
      free = list.filter(s => !s.taken);
    if (!free.length) return;
    const spot = free[Math.floor(hash(id + seed) * free.length) % free.length];
    spot.taken = id;
    const S = { seat: spot, m: null, mode: standing ? 'hold' : 'sit', hand: hash(seed + id + 'h') < 0.5 ? 'R' : 'L' };
    this.sitters.set(id, S);
    const m = await this.seatModel(typeName);
    if (!m || !this.sitters.has(id) || this.gone) return;
    S.m = m;
    m.holder.position.set(spot.x, spot.y, 0);
    m.holder.rotation.z = spot.face + Math.PI / 2;
    this.group.add(m.holder);
  }

  walkOut(id, arrive, i) {
    const S = this.sitters.get(id);
    if (!S || S.walk) return;
    const end = bayExit(this.H, i),
      lane = ((i % 3) - 1) * this.H * 0.18,
      from = S.m ? S.m.holder.position : { x: S.seat.x, y: S.seat.y },
      pts = [
        { x: from.x, y: lane + Math.sign(from.y || 1) * this.H * 0.1 },
        { x: this.L / 2 - this.H * 0.3, y: lane * 0.5 },
        { x: end.x - this.H * 0.35, y: end.y }
      ];
    let d = Math.hypot(pts[0].x - from.x, pts[0].y - from.y);
    for (let k = 1; k < pts.length; k++) d += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    const now = performance.now() / 1000,
      start = Math.max(now + 0.8 + i * 0.15, arrive - d / (BAY.walk * this.H * 0.8));
    S.walk = { pts, k: 0, start, arrive, anim: null };
  }

  stepWalk(S, dt) {
    const Wk = S.walk,
      m = S.m,
      now = performance.now() / 1000;
    if (!m || now < Wk.start) return;
    if (!Wk.anim) {
      const clip = animClip(m.t, 'MOVE') || animClip(m.t, 'IDLE');
      if (!clip) return;
      Wk.anim = new AnimState(m.inst, clip, { loop: true });
      m.holder.position.z = 0;
      S.seat.taken = null;
    }
    const p = m.holder.position;
    let left = 0,
      prev = p;
    for (let k = Wk.k; k < Wk.pts.length; k++) {
      left += Math.hypot(Wk.pts[k].x - prev.x, Wk.pts[k].y - prev.y);
      prev = Wk.pts[k];
    }
    const v = Math.max(BAY.walk * this.H * 0.8, left / Math.max(0.2, Wk.arrive - now));
    let step = v * dt;
    while (step > 0 && Wk.k < Wk.pts.length) {
      const q = Wk.pts[Wk.k],
        dx = q.x - p.x,
        dy = q.y - p.y,
        d = Math.hypot(dx, dy);
      if (d > 1e-3) m.holder.rotation.z = Math.atan2(dy, dx) + Math.PI / 2;
      if (d <= step) {
        p.x = q.x;
        p.y = q.y;
        step -= d;
        Wk.k++;
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        step = 0;
      }
    }
    p.z = this.floorAt(p.x);
    Wk.anim.step(dt);
    m.inst.syncFromBones?.();
    if (Wk.k >= Wk.pts.length || now > Wk.arrive + 1.5) this.stand([...this.sitters.entries()].find(([, x]) => x === S)?.[0]);
  }

  leave(id) {
    const S = this.sitters.get(id);
    if (S && S.walk && S.walk.anim) S.walk.arrive = Math.min(S.walk.arrive, performance.now() / 1000 + 0.3);
    else this.stand(id);
  }

  stand(id) {
    const S = this.sitters.get(id);
    if (!S) return;
    this.left.add(id);
    this.sitters.delete(id);
    S.seat.taken = null;
    if (S.m) this.group.remove(S.m.holder);
  }

  bones(m) {
    const names = new Map(m.inst.bones.map(x => [x.name.toUpperCase(), x]));
    return n => names.get(n) || null;
  }

  pose(S) {
    const m = S.m,
      clip = animClip(m.t, 'IDLE');
    if (!clip) return false;
    new AnimState(m.inst, clip, { loop: true, time: 0 }).pose();
    m.holder.updateMatrixWorld(true);
    const b = this.bones(m);
    if (S.mode === 'sit') this.sitPose(S, b);
    else this.holdPose(S, b);
    m.inst.syncFromBones?.();
    m.posed = true;
    return true;
  }

  sitPose(S, b) {
    const m = S.m,
      pelvis = b('B_PELVIS'),
      legs = [
        [b('B_THIGH_L'), b('B_CALF_L'), b('B_FOOT_L')],
        [b('B_THIGH_R'), b('B_CALF_R'), b('B_FOOT_R')]
      ];
    if (!pelvis || !legs.every(l => l.every(Boolean))) return;
    const fwd = new THREE.Vector3(0, -1, 0).applyQuaternion(m.holder.getWorldQuaternion(new THREE.Quaternion())).setZ(0).normalize();
    for (const [thigh, calf, foot] of legs) {
      this.aim(thigh, calf, fwd);
      this.aim(calf, foot, DOWN);
    }
    m.holder.updateMatrixWorld(true);
    const base = m.holder.getWorldPosition(new THREE.Vector3()).z,
      lift = pelvis.getWorldPosition(new THREE.Vector3()).z - base,
      feet = Math.min(legs[0][2].getWorldPosition(new THREE.Vector3()).z, legs[1][2].getWorldPosition(new THREE.Vector3()).z) - base;
    m.holder.position.z += Math.max(BAY.seat * this.H - lift + this.H * 0.03, -feet);
    m.holder.updateMatrixWorld(true);
    const knee = this.group.worldToLocal(legs[0][1].getWorldPosition(new THREE.Vector3())),
      edge = this.W / 2 - BAY.bench * this.H - this.H * 0.04,
      gapIn = edge - Math.abs(knee.y);
    if (gapIn < 0) m.holder.position.y -= S.seat.sy * -gapIn;
  }

  holdPose(S, b) {
    const m = S.m,
      side = this.freeHand(m, b) || S.hand,
      bicep = b('B_BICEP_' + side),
      farm = b('B_FARM_' + side),
      hand = b('B_HAND_' + side);
    if (!bicep || !farm || !hand) return;
    const g = this.group,
      wp = o => o.getWorldPosition(new THREE.Vector3()),
      up = wp(farm).distanceTo(wp(bicep)),
      lo = wp(hand).distanceTo(wp(farm)),
      reach = (up + lo) * 0.96,
      sh = g.worldToLocal(wp(bicep));
    const grip = this.railZ - this.H * BAY.railR - lo * 0.32,
      dz = Math.max(0, Math.min(reach * 0.97, grip - sh.z)),
      dh = Math.sqrt(Math.max(0, reach * reach - dz * dz)),
      railY = S.seat.sy * this.W * BAY.rail;
    m.holder.position.y += railY + S.seat.sy * dh - sh.y;
    m.holder.updateMatrixWorld(true);
    const S0 = wp(bicep),
      T = g.localToWorld(new THREE.Vector3(g.worldToLocal(S0.clone()).x, railY + S.seat.sy * this.H * BAY.railR * 1.8, grip)),
      D = Math.min(S0.distanceTo(T), up + lo - 1e-3),
      dir = T.clone().sub(S0).normalize(),
      out = new THREE.Vector3(side === 'R' ? 1 : -1, 0, 0).applyQuaternion(m.holder.getWorldQuaternion(new THREE.Quaternion())),
      bend = DOWN.clone().addScaledVector(out, 0.6),
      n = bend.sub(dir.clone().multiplyScalar(bend.dot(dir))).normalize(),
      cosA = Math.max(-1, Math.min(1, (up * up + D * D - lo * lo) / (2 * up * D))),
      sinA = Math.sqrt(1 - cosA * cosA),
      E = S0.clone().addScaledVector(dir, up * cosA).addScaledVector(n, up * sinA);
    this.aim(bicep, farm, E.clone().sub(S0).normalize());
    this.aim(farm, hand, T.clone().sub(wp(farm)).normalize());
  }

  freeHand(m, b) {
    const muzzle = m.inst.bones.find(x => /^MUZZLE/i.test(x.name));
    if (!muzzle) return null;
    const R = b('B_HAND_R'),
      L = b('B_HAND_L');
    for (let p = muzzle.parent; p; p = p.parent) {
      if (p === R) return 'L';
      if (p === L) return 'R';
    }
    return null;
  }

  aim(bone, child, want) {
    bone.updateWorldMatrix(true, false);
    bone.getWorldPosition(_a);
    child.getWorldPosition(_b);
    const d = _b.sub(_a).normalize();
    _q.setFromUnitVectors(d, want);
    bone.parent.getWorldQuaternion(_q2);
    const inv = _q2.clone().invert();
    bone.quaternion.premultiply(inv.multiply(_q).multiply(_q2));
    bone.updateWorldMatrix(false, true);
  }

  async avatar(id, typeName) {
    let A = this.avatars.get(id);
    if (A) return A;
    A = { m: null, x: 0, y: 0, h: 0, tx: 0, ty: 0, th: 0, moving: false, anim: null, kind: '' };
    this.avatars.set(id, A);
    A.m = await this.seatModel(typeName);
    if (A.m && this.avatars.get(id) === A && !this.gone) this.group.add(A.m.holder);
    return A;
  }

  dropAvatar(id) {
    const A = this.avatars.get(id);
    if (!A) return;
    this.avatars.delete(id);
    if (A.m) this.group.remove(A.m.holder);
  }

  moveAvatar(id, x, y, h, moving) {
    const A = this.avatars.get(id);
    if (!A) return;
    A.tx = x;
    A.ty = y;
    A.th = h;
    A.moving = moving;
  }

  solids() {
    const r = BAY.body * this.H,
      out = [];
    for (const S of this.sitters.values()) if ((S.mode === 'hold' || (S.walk && S.walk.anim)) && S.m) out.push({ x: S.m.holder.position.x, y: S.m.holder.position.y, r });
    for (const A of this.avatars.values()) out.push({ x: A.x, y: A.y, r });
    return out;
  }


  step(dt, input) {
    for (const S of [...this.sitters.values()]) {
      if (S.walk) this.stepWalk(S, dt);
      else if (S.m && !S.m.posed) this.pose(S);
    }
    for (const A of this.avatars.values()) {
      if (!A.m) continue;
      const k = Math.min(1, dt * 10);
      A.x += (A.tx - A.x) * k;
      A.y += (A.ty - A.y) * k;
      A.h = A.th;
      A.m.holder.position.set(A.x, A.y, 0);
      A.m.holder.rotation.z = A.h + Math.PI / 2;
      const want = A.moving ? 'MOVE' : 'IDLE';
      if (A.kind !== want) {
        const clip = animClip(A.m.t, want) || animClip(A.m.t, 'IDLE');
        if (clip) {
          A.anim = new AnimState(A.m.inst, clip, { loop: true });
          A.kind = want;
        }
      }
      if (A.anim) {
        A.anim.step(dt);
        A.m.inst.syncFromBones?.();
      }
    }
    const open = this.rampK > 0.98;
    this.rampK += ((this.rampOpen ? 1 : 0) - this.rampK) * Math.min(1, dt * 2.2);
    this.hinge.rotation.y = -Math.PI / 2 + this.rampK * (Math.PI / 2 + this.rampDrop());
    const blink = Math.floor(performance.now() / 300) % 2;
    this.warn.material.color.setHex(this.rampOpen ? (blink ? 0x5cff7a : 0x1d6b2c) : Math.floor(performance.now() / 500) % 2 ? 0xff4a32 : 0x6b1d14);
    for (const l of this.lights) l.m.material.color.setHex(this.rampOpen ? 0x5cff7a : (Math.floor(performance.now() / 250) + l.k) % 3 === 0 ? 0xffd76a : 0xff4a32);
    if (!input) return null;
    const me = this.me,
      sp = BAY.walk * this.H * dt,
      c = Math.cos(me.yaw),
      s = Math.sin(me.yaw),
      L = this.L,
      door = (BAY.door * this.H) / 2 - BAY.me * this.H;
    let nx = me.x + (c * input.f + s * input.s) * sp,
      ny = me.y + (s * input.f - c * input.s) * sp;
    const r = BAY.me * this.H,
      yMax = this.W / 2 - r * 0.7;
    if (Math.abs(ny) > yMax) ny = Math.sign(ny) * yMax;
    for (const B of this.blocks) {
      if (nx > B.x0 - r && nx < B.x1 + r && ny > B.y0 - r && ny < B.y1 + r) {
        if (!(me.x > B.x0 - r && me.x < B.x1 + r)) nx = me.x;
        else ny = me.y;
      }
    }
    for (const o of this.solids()) {
      const dx = nx - o.x,
        dy = ny - o.y,
        d = Math.hypot(dx, dy),
        min = o.r + r;
      if (d < min && d > 1e-4) {
        nx = o.x + (dx / d) * min;
        ny = o.y + (dy / d) * min;
      }
    }
    const wall = L / 2 - r,
      outside = me.x > wall + 1e-3,
      rampEnd = L / 2 + this.rampLen * Math.cos(this.rampDrop());
    let off = false;
    if (!outside) {
      if (nx > wall && !(open && Math.abs(ny) <= door)) nx = wall;
    } else {
      if (nx <= wall && Math.abs(ny) > door) nx = wall + 2e-3;
      if (nx > L / 2 + r && Math.abs(ny) > (BAY.door * this.H) / 2) off = true;
    }
    nx = Math.max(-L / 2 + r, Math.min(rampEnd + r, nx));
    me.moving = Math.hypot(nx - me.x, ny - me.y) > 1e-3;
    me.x = nx;
    me.y = ny;
    return { out: off || me.x > L / 2 + this.rampLen * BAY.out * Math.cos(this.rampDrop()) };
  }

  rampDrop() {
    return this.rampTilt ?? 0.25;
  }

  floorAt(x) {
    const L = this.L;
    if (x <= L / 2) return 0;
    return -Math.min(this.rampLen, x - L / 2) * Math.sin(this.rampDrop()) * this.rampK;
  }

  eyeWorld(out) {
    const me = this.me;
    return this.toWorld(me.x, me.y, this.floorAt(me.x) + BAY.eye * this.H, out);
  }

  screen(lines) {
    const x = this.screenCtx,
      key = lines.join('|');
    if (key === this.screenKey) return;
    this.screenKey = key;
    x.fillStyle = '#04121c';
    x.fillRect(0, 0, 512, 256);
    x.strokeStyle = 'rgba(110,190,255,0.8)';
    x.lineWidth = 4;
    x.strokeRect(6, 6, 500, 244);
    x.fillStyle = 'rgba(110,190,255,0.08)';
    for (let y = 10; y < 250; y += 6) x.fillRect(8, y, 496, 2);
    x.font = 'bold 34px "EmpireAtWar-Bold","Segoe UI",sans-serif';
    x.textAlign = 'center';
    lines.forEach((l, i) => {
      x.fillStyle = i === 0 ? '#ffd76a' : '#bfe4ff';
      x.fillText(l, 256, 62 + i * 52);
    });
    this.screenTex.needsUpdate = true;
  }

  dispose() {
    this.gone = true;
    this.world.scene.remove(this.group);
    this.group.traverse(o => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      for (const m of [o.material].flat()) if (m && !sharedBay(m.map)) m.dispose();
    });
    this.screenTex?.dispose();
  }
}
