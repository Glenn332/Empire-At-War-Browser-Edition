import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadModel } from '../model.js';
import { AnimState } from '../ala.js';
import { animClip } from './land.js';

const BAY = { len: 5.6, wid: 4.2, high: 2.1, bench: 0.3, seat: 0.3, back: 0.08, door: 1.7, doorH: 1.45, ramp: 1.9, win: 0.95, winLo: 0.62, winHi: 1.32, walk: 2.2, eye: 0.9, out: 0.75, rail: 0.17, hold: 0.45, body: 0.24, me: 0.22 },
  DOWN = new THREE.Vector3(0, 0, -1),
  UP = new THREE.Vector3(0, 0, 1),
  _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _q2 = new THREE.Quaternion();

function canvasTexture(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function panelTexture(base, seam, rows, cols, rivet) {
  return canvasTexture((x, S) => {
    x.fillStyle = base;
    x.fillRect(0, 0, S, S);
    const g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    x.strokeStyle = seam;
    x.lineWidth = 3;
    for (let r = 0; r <= rows; r++) {
      x.beginPath();
      x.moveTo(0, (r * S) / rows);
      x.lineTo(S, (r * S) / rows);
      x.stroke();
    }
    for (let k = 0; k <= cols; k++) {
      x.beginPath();
      x.moveTo((k * S) / cols, 0);
      x.lineTo((k * S) / cols, S);
      x.stroke();
    }
    if (rivet) {
      x.fillStyle = rivet;
      for (let r = 0; r < rows; r++)
        for (let k = 0; k < cols; k++) {
          const x0 = (k * S) / cols,
            y0 = (r * S) / rows;
          for (const [dx, dy] of [
            [8, 8],
            [S / cols - 8, 8],
            [8, S / rows - 8],
            [S / cols - 8, S / rows - 8]
          ]) {
            x.beginPath();
            x.arc(x0 + dx, y0 + dy, 2.2, 0, Math.PI * 2);
            x.fill();
          }
        }
    }
  });
}

const stripes = () =>
  canvasTexture((x, S) => {
    x.fillStyle = '#1a1a1a';
    x.fillRect(0, 0, S, S);
    x.fillStyle = '#d9a520';
    for (let i = -S; i < S * 2; i += 64) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + 32, 0);
      x.lineTo(i + 32 - S, S);
      x.lineTo(i - S, S);
      x.fill();
    }
  });

function mat(opts) {
  return new THREE.MeshBasicMaterial({ fog: false, side: THREE.DoubleSide, ...opts });
}

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
    world.scene.add(this.group);
  }

  box(w, d, h, m, x, y, z, solid = false) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), m);
    b.position.set(x, y, z);
    this.group.add(b);
    if (solid) this.blocks.push({ x0: x - w / 2, x1: x + w / 2, y0: y - d / 2, y1: y + d / 2 });
    return b;
  }

  tube(len, r, m, x, y, z, axis = 'x') {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m);
    if (axis === 'x') t.rotation.z = Math.PI / 2;
    else if (axis === 'z') t.rotation.x = Math.PI / 2;
    t.position.set(x, y, z);
    this.group.add(t);
    return t;
  }

  build() {
    const H = this.H,
      L = BAY.len * H,
      W = BAY.wid * H,
      T = BAY.high * H,
      g = this.group,
      wallTex = panelTexture('#5d646c', 'rgba(20,24,28,0.75)', 3, 4, 'rgba(200,210,220,0.35)'),
      floorTex = panelTexture('#3a3f45', 'rgba(10,12,14,0.9)', 8, 8, null),
      ceilTex = panelTexture('#474d54', 'rgba(15,18,20,0.8)', 2, 6, 'rgba(180,190,200,0.3)'),
      metal = mat({ color: 0x7d858e }),
      dark = mat({ color: 0x3b4047 }),
      chrome = mat({ color: 0xb8c0c8 });
    this.L = L;
    this.W = W;
    this.T = T;
    floorTex.repeat.set(L / (H * 2), W / (H * 2));
    const wallM = (rx, ry = 1) => {
        const t = wallTex.clone();
        t.needsUpdate = true;
        t.repeat.set(rx, ry);
        return mat({ map: t });
      },
      shapeM = () => wallM(1 / (H * 1.6), 1 / T);
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(L, W), mat({ map: floorTex })));
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.9, W * 0.22), mat({ color: 0x4a5058 }));
    walk.position.z = 0.04;
    g.add(walk);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(L, W), mat({ map: ceilTex }));
    ceil.position.z = T;
    g.add(ceil);
    for (const k of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.8, H * 0.1), mat({ color: 0xdff0ff }));
      strip.position.set(0, k * W * 0.32, T - 0.05);
      g.add(strip);
      this.tube(L * 0.96, H * 0.05, dark, 0, k * (W / 2 - H * 0.12), T - H * 0.1);
      this.tube(L * 0.96, H * 0.03, metal, 0, k * (W / 2 - H * 0.25), T - H * 0.08);
    }
    const ww = BAY.win * H,
      lo = BAY.winLo * H,
      hi = BAY.winHi * H;
    this.windows.push(-L * 0.2, L * 0.2);
    for (const sy of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(-L / 2, 0);
      shape.lineTo(L / 2, 0);
      shape.lineTo(L / 2, T);
      shape.lineTo(-L / 2, T);
      shape.lineTo(-L / 2, 0);
      for (const cx of this.windows) {
        const x0 = cx - ww / 2,
          hole = new THREE.Path(),
          c = ww * 0.18;
        hole.moveTo(x0 + c, lo);
        hole.lineTo(x0 + ww - c, lo);
        hole.lineTo(x0 + ww, lo + c);
        hole.lineTo(x0 + ww, hi - c);
        hole.lineTo(x0 + ww - c, hi);
        hole.lineTo(x0 + c, hi);
        hole.lineTo(x0, hi - c);
        hole.lineTo(x0, lo + c);
        hole.lineTo(x0 + c, lo);
        shape.holes.push(hole);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, hi - lo), mat({ color: 0x8fc4ff, transparent: true, opacity: 0.07, depthWrite: false }));
        glass.rotation.x = Math.PI / 2;
        glass.position.set(cx, sy * (W / 2 - 0.05), (lo + hi) / 2);
        g.add(glass);
        g.add(
          new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(hole.getPoints().map(p => new THREE.Vector3(p.x, sy * (W / 2 - 0.1), p.y))),
            new THREE.LineBasicMaterial({ color: 0x8fd0ff, fog: false })
          )
        );
        this.box(ww * 1.1, H * 0.06, H * 0.05, dark, cx, sy * (W / 2 - H * 0.03), lo - H * 0.03);
      }
      const wall = new THREE.Mesh(new THREE.ShapeGeometry(shape), shapeM());
      wall.rotation.x = Math.PI / 2;
      wall.position.y = sy * (W / 2);
      g.add(wall);
      const edges = [-L / 2 + H * 0.3, ...this.windows.flatMap(cx => [cx - ww / 2 - H * 0.08, cx + ww / 2 + H * 0.08]), L / 2 - H * 0.3],
        bd = BAY.bench * H,
        bh = BAY.seat * H;
      for (let k = 0; k < edges.length; k += 2) {
        const x0 = edges[k],
          x1 = edges[k + 1],
          len = x1 - x0;
        if (len < H * 0.45) continue;
        const cx = (x0 + x1) / 2;
        this.box(len, bd, bh, metal, cx, sy * (W / 2 - bd / 2), bh / 2, true);
        this.benches.push({ x0, x1, sy });
        const per = Math.max(1, Math.floor(len / (H * 0.62)));
        for (let s = 0; s < per; s++) this.seats.push({ x: x0 + (len * (s + 0.5)) / per, y: sy * (W / 2 - bd * 0.35), sy, face: -sy * Math.PI / 2, taken: null });
      }
      for (const cx of [-L / 2 + H * 0.05, ...this.windows.map(c => c - ww / 2 - H * 0.04), ...this.windows.map(c => c + ww / 2 + H * 0.04), L / 2 - H * 0.05])
        this.box(H * 0.08, H * 0.12, T, dark, cx, sy * (W / 2 - H * 0.06), T / 2);
      this.rails.push(this.tube(L * 0.84, H * 0.022, chrome, -L * 0.02, sy * W * BAY.rail, T * 0.62));
      for (const hx of [-L * 0.4, -L * 0.1, L * 0.2, L * 0.38]) this.rails.push(this.tube(T * 0.4, H * 0.012, chrome, hx, sy * W * BAY.rail, T * 0.82, 'z'));
      for (const hx of [-L * 0.32, -L * 0.04, L * 0.24]) this.spots.push({ x: hx, y: sy * (W * BAY.rail + H * 0.3), sy, face: -sy * Math.PI / 2, taken: null });
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, T), wallM(W / (H * 1.6)));
    back.rotation.set(Math.PI / 2, -Math.PI / 2, 0);
    back.position.set(-L / 2, 0, T / 2);
    g.add(back);
    const sc = document.createElement('canvas');
    sc.width = 512;
    sc.height = 256;
    this.screenCtx = sc.getContext('2d');
    this.screenTex = new THREE.CanvasTexture(sc);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.box(H * 0.06, H * 1.75, H * 0.92, dark, -L / 2 + 0.05, 0, H * 1.25);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(H * 1.6, H * 0.8), mat({ map: this.screenTex }));
    screen.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    screen.position.set(-L / 2 + H * 0.04, 0, H * 1.25);
    g.add(screen);
    const D = BAY.door * H,
      DH = BAY.doorH * H,
      fs = new THREE.Shape();
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
    const front = new THREE.Mesh(new THREE.ShapeGeometry(fs), shapeM());
    front.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    front.position.x = L / 2;
    g.add(front);
    for (const k of [-1, 1]) this.box(H * 0.14, H * 0.12, DH, dark, L / 2 - H * 0.07, k * (D / 2 + H * 0.06), DH / 2);
    this.box(H * 0.14, D + H * 0.24, H * 0.12, dark, L / 2 - H * 0.07, 0, DH + H * 0.06);
    const hz = stripes();
    hz.repeat.set(3, 1);
    const haz = new THREE.Mesh(new THREE.PlaneGeometry(H * 0.5, D), mat({ map: hz }));
    haz.position.set(L / 2 - H * 0.3, 0, 0.06);
    g.add(haz);
    this.box(H * 0.06, H * 0.3, H * 0.45, dark, L / 2 - H * 0.05, D / 2 + H * 0.5, H * 0.95);
    for (let i = 0; i < 3; i++) {
      const l = this.box(H * 0.03, H * 0.06, H * 0.06, mat({ color: 0xff4a32 }), L / 2 - H * 0.09, D / 2 + H * 0.5, H * 1.05 - i * H * 0.12);
      this.lights.push({ m: l, k: i });
    }
    this.hinge = new THREE.Group();
    this.hinge.position.set(L / 2, 0, 0);
    const rampLen = Math.max(DH, BAY.ramp * H);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampLen, D, H * 0.08), mat({ map: (() => {
      const t = panelTexture('#6b737c', 'rgba(25,28,32,0.8)', 4, 2, 'rgba(210,215,220,0.4)');
      return t;
    })() }));
    ramp.position.set(rampLen / 2, 0, 0);
    this.hinge.add(ramp);
    const rz = stripes();
    rz.repeat.set(4, 1);
    const rs = new THREE.Mesh(new THREE.PlaneGeometry(rampLen * 0.15, D), mat({ map: rz }));
    rs.position.set(rampLen * 0.92, 0, H * 0.045);
    this.hinge.add(rs);
    this.hinge.rotation.y = -Math.PI / 2;
    g.add(this.hinge);
    this.rampLen = rampLen;
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(D, H * 0.1), mat({ color: 0xff4a32 }));
    warn.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    warn.position.set(L / 2 - 0.15, 0, DH + H * 0.16);
    this.warn = warn;
    g.add(warn);
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
    if (this.railZ === null) {
      this.railZ = sh.z + reach * 0.86;
      for (const r of this.rails) r.position.z += this.railZ - this.T * 0.62;
    }
    const dz = Math.max(0, Math.min(reach * 0.97, this.railZ - sh.z)),
      dh = Math.sqrt(Math.max(0, reach * reach - dz * dz)),
      railY = S.seat.sy * this.W * BAY.rail;
    m.holder.position.y += railY + S.seat.sy * dh - sh.y;
    m.holder.updateMatrixWorld(true);
    const S0 = wp(bicep),
      T = g.localToWorld(new THREE.Vector3(g.worldToLocal(S0.clone()).x, railY, this.railZ)),
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
    const onRamp = open && Math.abs(ny) <= door,
      xMax = onRamp ? L / 2 + this.rampLen * Math.cos(this.rampDrop()) + r : L / 2 - r;
    if (nx > L / 2 - r && Math.abs(ny) > door) nx = Math.min(nx, L / 2 - r);
    nx = Math.max(-L / 2 + r, Math.min(xMax, nx));
    me.moving = Math.hypot(nx - me.x, ny - me.y) > 1e-3;
    me.x = nx;
    me.y = ny;
    return { out: me.x > L / 2 + this.rampLen * BAY.out * Math.cos(this.rampDrop()) };
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
    x.font = 'bold 34px sans-serif';
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
  }
}
