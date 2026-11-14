import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { AnimState } from '../ala.js';

const WAVE = { every: 15, first: 3, cap: 8, gap: 3, unload: 0.35, ramp: 1, space: 110, rings: [1, 2, 3], linger: 2.5 },
  RIDE = { ahead: 0.9, up: 0.12, down: 0.32, ease: 6, fade: 600 },
  _c = new THREE.Vector3(),
  _p = new THREE.Vector3(),
  _box = new THREE.Box3();

const CSS = `
.sh-shuttle { position: fixed; inset: 0; pointer-events: none; z-index: 30; opacity: 0; transition: opacity .6s ease; }
.sh-shuttle.on { opacity: 1; }
.sh-shuttle svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.sh-shuttle .sh-sh-t { position: absolute; left: 50%; transform: translateX(-50%); font: 400 calc(13px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .18em; color: #bfe4ff; text-shadow: 0 0 6px rgba(80,170,255,.8); white-space: nowrap; }
.sh-shuttle .sh-sh-top { top: 6%; font-size: calc(16px * var(--eaw-k, 1)); }
.sh-shuttle .sh-sh-bot { bottom: 4.5%; display: flex; gap: 4em; }
.sh-shuttle .sh-sh-bot b { font-weight: 400; color: #ffd76a; text-shadow: 0 0 6px rgba(255,190,80,.7); }
.sh-shuttle .sh-sh-go { color: #ffd76a; text-shadow: 0 0 8px rgba(255,190,80,.9); }
`;

const FRAME = `
<svg viewBox="0 0 1600 900" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="shf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b3036"/><stop offset=".5" stop-color="#15181c"/><stop offset="1" stop-color="#0b0d10"/>
    </linearGradient>
    <linearGradient id="shg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="rgba(170,215,255,.10)"/><stop offset=".45" stop-color="rgba(170,215,255,.02)"/><stop offset=".5" stop-color="rgba(220,240,255,.08)"/><stop offset=".56" stop-color="rgba(170,215,255,.02)"/><stop offset="1" stop-color="rgba(120,180,255,.10)"/>
    </linearGradient>
    <radialGradient id="shv" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,10,20,.55)"/></radialGradient>
  </defs>
  <path fill="url(#shg)" d="M250 120 L1350 120 L1530 500 L1260 800 L340 800 L70 500 Z"/>
  <rect width="1600" height="900" fill="url(#shv)"/>
  <path fill="url(#shf)" fill-rule="evenodd" d="M0 0 H1600 V900 H0 Z M250 120 L1350 120 L1530 500 L1260 800 L340 800 L70 500 Z"/>
  <path fill="url(#shf)" d="M770 120 L830 120 L812 300 L788 300 Z"/>
  <path fill="url(#shf)" d="M70 500 L120 500 L420 800 L340 800 Z" opacity=".85"/>
  <path fill="url(#shf)" d="M1530 500 L1480 500 L1180 800 L1260 800 Z" opacity=".85"/>
  <path fill="none" stroke="rgba(110,190,255,.55)" stroke-width="2" d="M250 120 L1350 120 L1530 500 L1260 800 L340 800 L70 500 Z"/>
  <path fill="none" stroke="rgba(255,255,255,.07)" stroke-width="1.5" d="M200 70 L1400 70 M40 560 L300 845 M1560 560 L1300 845 M0 860 H1600"/>
  <g fill="#6c7680">
    <circle cx="230" cy="96" r="4"/><circle cx="1370" cy="96" r="4"/><circle cx="60" cy="470" r="4"/><circle cx="1540" cy="470" r="4"/><circle cx="330" cy="830" r="4"/><circle cx="1270" cy="830" r="4"/>
  </g>
  <g class="sh-sh-lights">
    <circle cx="140" cy="840" r="6" fill="#ff4a32"/><circle cx="1460" cy="840" r="6" fill="#ff4a32"/>
  </g>
</svg>
<div class="sh-sh-t sh-sh-top"></div>
<div class="sh-sh-t sh-sh-bot"><span>ALT <b class="alt"></b></span><span>LZ <b class="lz"></b></span><span>TROOPS <b class="n"></b></span></div>`;

export class ShuttleWaves {
  constructor(sh) {
    this.sh = sh;
    this.queues = [];
    this.next = [];
    this.key = 0;
    this.visuals = new Map();
    this.ride = null;
    this.rideKey = 0;
    this.boardUntil = 0;
    this.el = null;
  }

  on() {
    const sh = this.sh;
    return sh.cfg.shuttle !== false && !sh.benchN;
  }

  add(e) {
    this.clock();
    (this.queues[e.side] ||= []).push(e);
    return e;
  }

  clock() {
    const w = this.sh.world,
      n = Math.max(this.sh.game.factions?.length || 0, this.queues.length);
    for (let s = 0; s < n; s++) {
      this.queues[s] ||= [];
      if (this.next[s] === undefined) this.next[s] = w.time + WAVE.first;
    }
  }

  launchIn(side) {
    const w = this.sh.world;
    return Math.max(0, Math.ceil((this.next[side] ?? w.time) - w.time));
  }

  waiting(side, who) {
    return (this.queues[side] || []).some(e => e.who === who);
  }

  cancel(side, who) {
    const q = this.queues[side] || [];
    for (let i = q.length - 1; i >= 0; i--) if (q[i].who === who) q.splice(i, 1);
  }

  step() {
    const w = this.sh.world,
      now = w.time;
    this.clock();
    for (let s = 0; s < this.queues.length; s++) {
      const q = this.queues[s];
      if (now < this.next[s]) continue;
      this.next[s] += WAVE.every;
      if (this.next[s] <= now) this.next[s] = now + WAVE.every;
      if (q.length) this.launch(s, q.splice(0));
    }
  }

  zones(side) {
    const sh = this.sh,
      w = sh.world,
      pads = sh.points(side);
    if (pads.length) return pads;
    const home = sh.home(side) || sh.hq(side);
    return w.points
      .filter(p => p.side >= 0 && w.ally(p.side, side))
      .sort((a, b) => (home ? Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y) : 0));
  }

  near(list, p) {
    if (!p) return null;
    let best = null,
      bd = Infinity;
    for (const z of list) {
      const d = Math.hypot(z.x - p.x, z.y - p.y);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  }

  launch(side, entries) {
    const sh = this.sh,
      w = sh.world,
      zones = this.zones(side);
    const groups = new Map(),
      seats = new Map();
    let pick = null;
    for (const e of entries)
      if (e.who !== 'bot' && e.point && !e.car) {
        const z = this.near(zones, e.point) || e.point;
        seats.set(z, (seats.get(z) || 0) + 1);
      }
    for (const e of entries) {
      let z = null;
      if (e.who !== 'bot' && e.point) z = this.near(zones, e.point) || e.point;
      else if (!e.car) {
        for (const [pz, n] of seats)
          if (n % WAVE.cap) {
            z = pz;
            seats.set(pz, n + 1);
            break;
          }
      }
      if (!z && zones.length) z = e.car ? zones[Math.floor(Math.random() * zones.length)] : (pick ||= zones[(this.turn = ((this.turn ?? -1) + 1) % zones.length)]);
      if (!z) {
        this.direct(side, e);
        continue;
      }
      let g = groups.get(z);
      if (!g) groups.set(z, (g = { foot: [], car: [] }));
      (e.car ? g.car : g.foot).push(e);
    }
    const flights = [],
      taken = [];
    for (const t of w.transports) if (t.cargo && !t.craft.dead) taken.push({ x: t.x, y: t.y });
    for (const [z, g] of groups) {
      g.foot.sort((a, b) => (a.who === 'bot') - (b.who === 'bot'));
      const loads = [];
      for (let i = 0; i < g.foot.length; i += WAVE.cap) loads.push(g.foot.slice(i, i + WAVE.cap));
      for (const e of g.car) loads.push([e]);
      const base = Math.atan2(w.n * 10 - z.y, w.n * 10 - z.x);
      for (const load of loads) {
        const o = this.spot(z, base, taken, load[0].car);
        taken.push(o);
        flights.push({ load, o, face: base, me: load.some(e => e.who !== 'bot') });
      }
    }
    flights.sort((a, b) => b.me - a.me);
    flights.forEach((f, i) => this.fly(side, f.load, f.o, f.face, i * WAVE.gap));
  }

  spot(z, base, taken, car) {
    const w = this.sh.world,
      D = Math.max(WAVE.space, this.space || 0),
      free = (x, y) => taken.every(p => Math.hypot(p.x - x, p.y - y) >= D);
    const tries = [[0, 0]];
    for (const k of WAVE.rings) {
      const n = 6 * k;
      for (let j = 0; j < n; j++) {
        const a = base + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * ((Math.PI * 2) / n);
        tries.push([Math.cos(a) * D * k, Math.sin(a) * D * k]);
      }
    }
    for (const [dx, dy] of tries) {
      const o = w.nearestOpen(z.x + dx, z.y + dy, car ? 3 : 1);
      if (o && free(o.x, o.y)) return { x: o.x, y: o.y };
    }
    const a = Math.random() * Math.PI * 2,
      r = D * (WAVE.rings.length + 1);
    return w.nearestOpen(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, car ? 3 : 1) || { x: z.x + Math.cos(a) * r, y: z.y + Math.sin(a) * r };
  }

  async direct(side, e) {
    const sh = this.sh,
      w = sh.world,
      z = e.point || sh.home(side) || sh.hq(side);
    if (!z) return this.lose(e);
    const o = w.nearestOpen(z.x, z.y) || { x: z.x, y: z.y },
      u = await this.make(side, e, o, 0);
    if (u) this.out(e, u);
    else this.lose(e);
  }

  async make(side, e, o, h) {
    const sh = this.sh,
      w = sh.world;
    let q = null;
    try {
      q = e.who === 'bot' ? await w.spawn(e.unit.name, o.x, o.y, h, side) : await sh.spawnClass(e.cls, o, h, side);
    } catch {
      q = null;
    }
    if (e.who === 'bot') this.settle(e, q);
    else if (q) {
      q.noAI = true;
      q.selectable = false;
    }
    const u = q && q.members[0];
    if (u) e.unitRef = u;
    return u || null;
  }

  exit(u, t, face, i) {
    const w = this.sh.world;
    if (!t.exitR) {
      _box.setFromObject(t.holder);
      t.exitR = Math.max(10, Math.min(90, Math.max(_box.max.x - _box.min.x, _box.max.y - _box.min.y) * 0.55));
      this.space = Math.max(this.space || 0, t.exitR * 2.6);
    }
    const R = t.exitR + (u.foot ? 6 : (u.hitRadius || 10)) + Math.floor(i / 3) * 10,
      lat = ((i % 3) - 1) * 10,
      c = Math.cos(face),
      s = Math.sin(face),
      o = w.nearestOpen(t.x + c * R - s * lat, t.y + s * R + c * lat, u.foot ? 1 : 3) || { x: t.x + c * R, y: t.y + s * R };
    u.x = o.x;
    u.y = o.y;
    u.z = heightAt(w.terrain, u.x, u.y) + (u.lift || 0) + (u.hoverZ || 0);
    u.heading = face;
    if (u.holder) {
      u.holder.position.set(u.x, u.y, u.z);
      u.holder.rotation.z = u.heading + Math.PI / 2;
    }
  }

  out(e, u) {
    const sh = this.sh;
    if (e.who === 'me') {
      this.endRide();
      if (sh.state !== 'alive') sh.boarded(e, u);
    } else if (e.who !== 'bot' && e.resolve) e.resolve(u);
  }

  settle(e, q) {
    if (e.settled) return;
    e.settled = true;
    if (e.done) e.done(q);
  }

  lose(e) {
    if (e.who === 'bot') this.settle(e, null);
    else if (e.who === 'me') {
      this.endRide();
      this.sh.boardFailed();
    } else if (e.resolve) e.resolve(null);
  }

  fly(side, load, o, face, hold) {
    const sh = this.sh,
      w = sh.world,
      key = ++this.key,
      comp = (load.find(e => e.company && e.company.str('Company_Transport_Unit')) || load[0]).company,
      byUnit = new Map(),
      N = sh.game.shooterNet;
    let landed = false,
      exits = 0;
    const opts = {
      hold,
      interval: WAVE.unload,
      ramp: WAVE.ramp,
      cargo: async t => {
        landed = true;
        const at = t ? { x: t.x, y: t.y } : o,
          list = [];
        for (const e of load) {
          const u = await this.make(side, e, at, face);
          if (!u) {
            this.lose(e);
            continue;
          }
          byUnit.set(u, e);
          if (e.who !== 'bot') u.boarding = true;
          list.push(u);
        }
        if (!t) for (const u of list) this.out(byUnit.get(u), u);
        return list;
      },
      onLeave: (u, t) => {
        const e = byUnit.get(u);
        u.boarding = false;
        this.exit(u, t, face, exits++);
        if (e) this.out(e, u);
      },
      onLost: () => {
        if (!landed) for (const e of load) this.lose(e);
      }
    };
    for (const e of load) if (e.who === 'bot') e.flying = true;
    const p = w.reinforce(side, comp.name, o.x, o.y, face, null, opts);
    const me = load.find(e => e.who === 'me');
    Promise.resolve(p).then(t => {
      if (!t) return;
      t.shuttleKey = key;
      if (me) this.startRide(t, key, load.length, o);
    });
    for (const e of load) if (e.who !== 'bot' && e.who !== 'me' && e.notify) e.notify({ key, n: load.length });
    if (N && N.peers?.size) N.events.push(['shut', key, side, comp.name, Math.round(o.x * 10) / 10, Math.round(o.y * 10) / 10, Math.round(face * 100) / 100, hold, load.length]);
  }

  startRide(t, key, n, o) {
    const sh = this.sh;
    this.ride = { t, key, n, lz: o, fresh: true, cam: new THREE.Vector3(), look: new THREE.Vector3(), prev: null, fwd: new THREE.Vector3(Math.cos(t.heading), Math.sin(t.heading), 0), r: 0 };
    sh.panel.style.display = 'none';
    this.show(true);
  }

  rideVisual(v) {
    this.ride = { t: v, key: v.key, n: v.n, lz: { x: v.x, y: v.y }, fresh: true, cam: new THREE.Vector3(), look: new THREE.Vector3(), prev: null, fwd: new THREE.Vector3(Math.cos(v.heading), Math.sin(v.heading), 0), r: 0, visual: true };
    this.sh.panel.style.display = 'none';
    this.show(true);
  }

  endRide() {
    if (!this.ride) return;
    this.ride = null;
    this.rideKey = 0;
    this.show(false);
  }

  riding() {
    return !!this.ride;
  }

  show(on) {
    if (on && !this.el) {
      const st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      this.el = document.createElement('div');
      this.el.className = 'sh-shuttle';
      this.el.innerHTML = FRAME;
      document.body.appendChild(this.el);
      this.top = this.el.querySelector('.sh-sh-top');
      this.alt = this.el.querySelector('.alt');
      this.lz = this.el.querySelector('.lz');
      this.cnt = this.el.querySelector('.n');
      this.lights = this.el.querySelector('.sh-sh-lights');
    }
    if (this.el) this.el.classList.toggle('on', !!on);
  }

  camera(cam, real) {
    const R = this.ride,
      sh = this.sh,
      w = sh.world;
    if (!R) return false;
    const t = R.t;
    if (!t || (t.craft && t.craft.dead) || t.gone) {
      this.endRide();
      if (!R.visual) sh.boardFailed(true);
      return false;
    }
    const inst = t.inst,
      bones = inst.bones;
    t.holder.updateMatrixWorld(true);
    _c.set(0, 0, 0);
    for (const b of bones) _c.add(b.getWorldPosition(_p));
    _c.multiplyScalar(1 / Math.max(1, bones.length));
    const ccx = _c.x,
      ccy = _c.y;
    if (!R.r) {
      _box.setFromObject(t.holder);
      R.r = Math.max(8, Math.min(120, (_box.max.x - _box.min.x + _box.max.y - _box.min.y) * 0.25));
    }
    const vel = R.prev ? _p.copy(_c).sub(R.prev) : _p.set(0, 0, 0),
      sp = vel.length() / Math.max(1e-3, real),
      ground = heightAt(w.terrain, _c.x, _c.y),
      alt = Math.max(0, _c.z - ground);
    if (sp > 6 && Math.hypot(vel.x, vel.y) > 1e-3) {
      const k = Math.min(1, real * 3);
      R.fwd.x += (vel.x / Math.hypot(vel.x, vel.y) - R.fwd.x) * k;
      R.fwd.y += (vel.y / Math.hypot(vel.x, vel.y) - R.fwd.y) * k;
      R.fwd.z = 0;
      R.fwd.normalize();
    }
    (R.prev ||= new THREE.Vector3()).copy(_c);
    const pos = _p.copy(_c).addScaledVector(R.fwd, R.r * RIDE.ahead);
    pos.z += R.r * RIDE.up;
    const dive = alt > 40 ? Math.min(0.75, RIDE.down + alt / 4000) : RIDE.down * 0.6,
      lx = pos.x + R.fwd.x * 100,
      ly = pos.y + R.fwd.y * 100,
      lz = pos.z - Math.tan(dive) * 100;
    const e = R.fresh ? 1 : Math.min(1, real * RIDE.ease);
    R.fresh = false;
    R.cam.lerp(pos, e);
    if (e === 1) R.cam.copy(pos);
    R.look.lerp(_c.set(lx, ly, lz), e);
    if (e === 1) R.look.set(lx, ly, lz);
    cam.position.copy(R.cam);
    cam.up.set(0, 0, 1);
    cam.lookAt(R.look);
    sh.setFov(cam, 62, 5);
    const down = (t.stage && t.stage !== 'land') || t.down;
    if (this.top) {
      const msg = down ? 'TOUCHDOWN  -  RAMP DOWN' : alt > 600 ? 'INBOUND  -  DESCENDING TO LANDING ZONE' : 'FINAL APPROACH  -  BRACE';
      if (this.top.textContent !== msg) this.top.textContent = msg;
      this.top.classList.toggle('sh-sh-go', !!down);
      this.alt.textContent = String(Math.round(alt / 4));
      this.lz.textContent = String(Math.round(Math.hypot(R.lz.x - ccx, R.lz.y - ccy) / 4));
      this.cnt.textContent = String(R.n);
      if (this.lights) this.lights.style.opacity = Math.floor(performance.now() / 400) % 2 ? '1' : '0.25';
    }
    const v = sh.game.view;
    v.x = ccx;
    v.y = ccy;
    return true;
  }

  async visual(ev) {
    const [, key, side, comp, x, y, face, hold, n] = ev,
      w = this.sh.world;
    if (this.visuals.has(key)) return;
    const V = { key, side, x, y, heading: face, n, hold: +hold || 0, stage: 'land', ready: false, gone: false, ground: 0 };
    this.visuals.set(key, V);
    const L = await w.landingCraft(comp);
    if (!L || V.gone) {
      this.visuals.delete(key);
      return;
    }
    const holder = new THREE.Group();
    holder.add(L.inst.root);
    holder.position.set(x, y, heightAt(w.terrain, x, y));
    holder.rotation.z = face + Math.PI / 2;
    holder.scale.setScalar(L.scale);
    holder.userData.casts = true;
    w.scene.add(holder);
    Object.assign(V, { holder, inst: L.inst, off: L.off, anim: L.land ? new AnimState(L.inst, L.land, {}) : null, ready: true });
    if (V.anim) V.anim.pose();
    if (this.rideKey === key) this.rideVisual(V);
  }

  stepVisuals(dt) {
    for (const [key, V] of this.visuals) {
      if (!V.ready) continue;
      if (V.hold > 0) {
        V.hold -= dt;
        continue;
      }
      const running = V.anim ? V.anim.step(dt) : false;
      if (V.stage === 'land' && !running) {
        V.stage = 'unload';
        V.down = true;
        V.ground = WAVE.ramp + V.n * WAVE.unload + WAVE.linger;
      } else if (V.stage === 'unload' && (V.ground -= dt) <= 0) {
        V.stage = 'leave';
        V.anim = V.off ? new AnimState(V.inst, V.off, {}) : null;
      } else if (V.stage === 'leave' && !running) {
        this.sh.world.scene.remove(V.holder);
        V.gone = true;
        this.visuals.delete(key);
        if (this.ride && this.ride.t === V) this.endRide();
      }
    }
  }

  rideFor(key) {
    this.rideKey = key;
    const V = this.visuals.get(key);
    if (V && V.ready) this.rideVisual(V);
  }

  dispose() {
    for (const V of this.visuals.values()) if (V.holder) this.sh.world.scene.remove(V.holder);
    this.visuals.clear();
    if (this.el) this.el.remove();
    this.el = null;
  }
}
