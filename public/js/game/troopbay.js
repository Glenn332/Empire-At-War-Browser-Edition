import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadModel } from '../model.js';
import { AnimState } from '../ala.js';
import { animClip } from './land.js';
import { heightAt } from './terrain.js';

const BAY = { len: 5.6, wid: 4.2, high: 2.1, bench: 0.3, seat: 0.3, door: 1.7, doorH: 1.45, ramp: 1.9, win: 0.95, winLo: 0.72, winHi: 1.32, walk: 2.2, eye: 0.9, out: 0.75, shake: 0.004 },
  _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _q2 = new THREE.Quaternion(),
  _box = new THREE.Box3(),
  DOWN = new THREE.Vector3(0, 0, -1);

function panelTexture(base, seam, rows, cols, rivet) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, 256, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  x.strokeStyle = seam;
  x.lineWidth = 3;
  for (let r = 0; r <= rows; r++) {
    x.beginPath();
    x.moveTo(0, (r * 256) / rows);
    x.lineTo(256, (r * 256) / rows);
    x.stroke();
  }
  for (let k = 0; k <= cols; k++) {
    x.beginPath();
    x.moveTo((k * 256) / cols, 0);
    x.lineTo((k * 256) / cols, 256);
    x.stroke();
  }
  if (rivet) {
    x.fillStyle = rivet;
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        const x0 = (k * 256) / cols,
          y0 = (r * 256) / rows;
        for (const [dx, dy] of [
          [8, 8],
          [256 / cols - 8, 8],
          [8, 256 / rows - 8],
          [256 / cols - 8, 256 / rows - 8]
        ]) {
          x.beginPath();
          x.arc(x0 + dx, y0 + dy, 2.2, 0, Math.PI * 2);
          x.fill();
        }
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mat(opts) {
  return new THREE.MeshBasicMaterial({ fog: false, side: THREE.DoubleSide, ...opts });
}

export class TroopBay {
  constructor(world, side, height) {
    this.world = world;
    this.side = side;
    this.H = Math.max(6, Math.min(30, height || 12));
    this.group = new THREE.Group();
    this.group.renderOrder = 2;
    this.seats = [];
    this.sitters = new Map();
    this.avatars = new Map();
    this.rampK = 0;
    this.me = { x: -this.H * 1.2, y: 0, yaw: 0, pitch: -0.05 };
    this.build();
    world.scene.add(this.group);
  }

  build() {
    const H = this.H,
      L = BAY.len * H,
      W = BAY.wid * H,
      T = BAY.high * H,
      g = this.group,
      wallTex = panelTexture('#5d646c', 'rgba(20,24,28,0.75)', 3, 4, 'rgba(200,210,220,0.35)'),
      floorTex = panelTexture('#3a3f45', 'rgba(10,12,14,0.9)', 8, 8, null),
      ceilTex = panelTexture('#474d54', 'rgba(15,18,20,0.8)', 2, 6, 'rgba(180,190,200,0.3)');
    floorTex.repeat.set(L / (H * 2), W / (H * 2));
    const wallM = (rx, ry = 1) => {
      const t = wallTex.clone();
      t.needsUpdate = true;
      t.repeat.set(rx, ry);
      return mat({ map: t });
    };
    const shapeM = () => wallM(1 / (H * 1.6), 1 / T);
    this.L = L;
    this.W = W;
    this.T = T;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), mat({ map: floorTex }));
    g.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(L, W), mat({ map: ceilTex }));
    ceil.position.z = T;
    g.add(ceil);
    for (let k = -1; k <= 1; k += 2) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.8, H * 0.12), mat({ color: 0xdff0ff }));
      strip.position.set(0, k * W * 0.18, T - 0.05);
      g.add(strip);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.84, H * 0.3), mat({ color: 0x9cc8ff, transparent: true, opacity: 0.18, depthWrite: false }));
      glow.position.set(0, k * W * 0.18, T - 0.08);
      g.add(glow);
    }
    const n = 3,
      ww = BAY.win * H,
      lo = BAY.winLo * H,
      hi = BAY.winHi * H,
      gap = (L - n * ww) / (n + 1);
    for (const sy of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(-L / 2, 0);
      shape.lineTo(L / 2, 0);
      shape.lineTo(L / 2, T);
      shape.lineTo(-L / 2, T);
      shape.lineTo(-L / 2, 0);
      for (let i = 0; i < n; i++) {
        const x0 = -L / 2 + gap + i * (ww + gap),
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
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, hi - lo), mat({ color: 0x8fc4ff, transparent: true, opacity: 0.08, depthWrite: false }));
        glass.rotation.x = Math.PI / 2;
        glass.position.set(x0 + ww / 2, sy * (W / 2 - 0.05), (lo + hi) / 2);
        g.add(glass);
        const rim = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(hole.getPoints().map(p => new THREE.Vector3(p.x, sy * (W / 2 - 0.08), p.y))),
          new THREE.LineBasicMaterial({ color: 0x8fd0ff, fog: false })
        );
        g.add(rim);
      }
      const wall = new THREE.Mesh(new THREE.ShapeGeometry(shape), shapeM());
      wall.rotation.x = Math.PI / 2;
      wall.position.y = sy * (W / 2);
      g.add(wall);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(L * 0.86, BAY.bench * H, BAY.seat * H), mat({ color: 0x6b737c }));
      bench.position.set(-L * 0.04, sy * (W / 2 - (BAY.bench * H) / 2), (BAY.seat * H) / 2);
      g.add(bench);
      for (let i = 0; i < 4; i++) this.seats.push({ x: -L / 2 + L * 0.1 + i * L * 0.2, y: sy * (W / 2 - BAY.bench * H * 0.35), sy, face: -sy * Math.PI / 2, taken: null });
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
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(H * 1.6, H * 0.8), mat({ map: this.screenTex }));
    screen.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    screen.position.set(-L / 2 + 0.06, 0, H * 1.25);
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
    this.hinge = new THREE.Group();
    this.hinge.position.set(L / 2, 0, 0);
    const rampLen = Math.max(DH, BAY.ramp * H);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampLen, D, H * 0.08), mat({ color: 0x4a5057 }));
    ramp.position.set(rampLen / 2, 0, 0);
    this.rampMesh = ramp;
    this.hinge.add(ramp);
    this.hinge.rotation.y = -Math.PI / 2;
    g.add(this.hinge);
    this.rampLen = rampLen;
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(D, H * 0.1), mat({ color: 0xff4a32 }));
    warn.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    warn.position.set(L / 2 - 0.08, 0, DH + H * 0.1);
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

  async seatModel(typeName, key) {
    const t = db.type(typeName);
    if (!t) return null;
    const file = t.str('Land_Model_Name');
    const inst = file && (await loadModel(file, { teamColor: this.world.teamColorFor(this.side, t) }).catch(() => null));
    if (!inst) return null;
    const holder = new THREE.Group();
    holder.add(inst.root);
    holder.scale.setScalar(t.num('Scale_Factor', 1));
    return { t, inst, holder, posed: false, key };
  }

  async sit(id, typeName) {
    if (this.sitters.has(id)) return;
    const seat = this.seats.find(s => !s.taken);
    if (!seat) return;
    seat.taken = id;
    const S = { seat, m: null };
    this.sitters.set(id, S);
    const m = await this.seatModel(typeName);
    if (!m || !this.sitters.has(id) || this.gone) return;
    S.m = m;
    m.holder.position.set(seat.x, seat.y, 0);
    m.holder.rotation.z = seat.face + Math.PI / 2;
    this.group.add(m.holder);
  }

  stand(id) {
    const S = this.sitters.get(id);
    if (!S) return;
    this.sitters.delete(id);
    S.seat.taken = null;
    if (S.m) this.group.remove(S.m.holder);
  }

  standOne() {
    for (const id of this.sitters.keys()) {
      this.stand(id);
      return;
    }
  }

  pose(m, sitting) {
    const clip = animClip(m.t, 'IDLE');
    if (!clip) return false;
    new AnimState(m.inst, clip, { loop: true, time: 0 }).pose();
    m.holder.updateMatrixWorld(true);
    if (sitting) {
      const names = new Map(m.inst.bones.map(x => [x.name.toUpperCase(), x])),
        b = n => names.get(n) || null,
        pelvis = b('B_PELVIS'),
        legs = [
          [b('B_THIGH_L'), b('B_CALF_L'), b('B_FOOT_L')],
          [b('B_THIGH_R'), b('B_CALF_R'), b('B_FOOT_R')]
        ];
      if (pelvis && legs.every(l => l.every(Boolean))) {
        const fwd = new THREE.Vector3(0, -1, 0).applyQuaternion(m.holder.getWorldQuaternion(new THREE.Quaternion())).setZ(0).normalize();
        for (const [thigh, calf, foot] of legs) {
          this.aim(thigh, calf, fwd);
          this.aim(calf, foot, DOWN);
        }
        m.holder.updateMatrixWorld(true);
        const base = m.holder.getWorldPosition(new THREE.Vector3()).z,
          lift = pelvis.getWorldPosition(_a).z - base,
          feet = Math.min(legs[0][2].getWorldPosition(_a).z, legs[1][2].getWorldPosition(_a).z) - base,
          seatTop = BAY.seat * this.H;
        m.holder.position.z += Math.max(seatTop - lift + this.H * 0.03, -feet);
        m.holder.updateMatrixWorld(true);
        const knee = this.group.worldToLocal(legs[0][1].getWorldPosition(new THREE.Vector3())),
          seat = [...this.sitters.values()].find(x => x.m === m)?.seat,
          edge = this.W / 2 - BAY.bench * this.H - this.H * 0.04,
          gapIn = edge - Math.abs(knee.y);
        if (seat && gapIn < 0) m.holder.position.y -= seat.sy * -gapIn;
      }
    }
    m.inst.syncFromBones?.();
    m.posed = true;
    return true;
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

  step(dt, input) {
    for (const S of this.sitters.values()) if (S.m && !S.m.posed) this.pose(S.m, true);
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
    const open = this.rampK > 0.98,
      target = this.rampOpen ? 1 : 0;
    this.rampK += (target - this.rampK) * Math.min(1, dt * 2.2);
    this.hinge.rotation.y = -Math.PI / 2 + this.rampK * (Math.PI / 2 + this.rampDrop());
    this.warn.material.color.setHex(this.rampOpen ? (Math.floor(performance.now() / 300) % 2 ? 0x5cff7a : 0x1d6b2c) : Math.floor(performance.now() / 500) % 2 ? 0xff4a32 : 0x6b1d14);
    if (!input) return null;
    const me = this.me,
      sp = BAY.walk * this.H * dt,
      c = Math.cos(me.yaw),
      s = Math.sin(me.yaw);
    let dx = (c * input.f + s * input.s) * sp,
      dy = (s * input.f - c * input.s) * sp;
    const L = this.L,
      W = this.W,
      r = this.H * 0.22,
      yMax = W / 2 - BAY.bench * this.H - r,
      door = (BAY.door * this.H) / 2 - r;
    let nx = me.x + dx,
      ny = me.y + dy;
    const onRamp = open && Math.abs(ny) <= door;
    const xMax = onRamp ? L / 2 + this.rampLen * Math.cos(this.rampDrop()) + r : L / 2 - r;
    if (me.x > L / 2 - r && Math.abs(ny) > door) ny = Math.sign(ny) * door;
    nx = Math.max(-L / 2 + r, Math.min(xMax, nx));
    ny = Math.max(-yMax, Math.min(yMax, ny));
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
