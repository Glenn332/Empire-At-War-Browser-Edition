import * as THREE from 'three';
import { executeLand } from './landcommands.js';
import { inCategory } from './land.js';
import { keysOf, keyName } from './keybinds.js';
import { heightAt } from './terrain.js';

const OV = {
  pullStep: 0.3,
  pullIdle: 1.3,
  pullDecay: 1.6,
  outDur: 1.15,
  inDur: 0.95,
  arc: 0.28,
  startDist: 620,
  takeDist: 1.08,
  zoomIn: 0.89,
  zoomOut: 1.12,
  tick: 0.25,
  holdMin: 0.6,
  holdStop: 3,
  holdMax: 120,
  lines: 64,
  arrive: 45,
  viewMax: 40
};
const HOLDS = new Set(['move', 'formmove', 'stop', 'garrison']);
const _p = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _v = new THREE.Vector3();

const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const heroic = t => !!t && (inCategory(t, 'HERO') || t.bool('Is_Named_Hero'));

export class Overlord {
  constructor(sh) {
    this.sh = sh;
    const g = sh.game;
    if (g.setup.overlord === undefined) g.setup.overlord = !!globalThis.shooterOverlord || /[?&]overlord(&|$)/.test(location.search);
    this.on = !!g.setup.overlord && !g.setup.benchmark;
    this.pull = 0;
    this.pullAt = 0;
    this.blend = null;
    this.hover = null;
    this.held = new Set();
    this.heldAt = 0;
    this.wantDeploy = false;
    this.fov = g.camera.fov;
    this.near = g.camera.near;
    if (!this.on) return;
    this.dom();
    this.wrapCommand();
  }

  key() {
    return keyName(keysOf('SHOOTER_OVERLORD')[0] || null) || 'L';
  }

  dom() {
    const css = document.createElement('style');
    css.textContent = `
.ov-banner{position:fixed;left:50%;top:48px;transform:translateX(-50%);z-index:46;max-width:calc(100vw - 32px);overflow:hidden;padding:2px 12px 3px;font:400 calc(12px * var(--eaw-k, 1)) var(--eaw-font);letter-spacing:.06em;color:var(--eaw-cream);pointer-events:none;opacity:0;transition:opacity .4s linear .35s;white-space:nowrap}
.ov-banner b{font:400 calc(13px * var(--eaw-k, 1)) var(--eaw-bold);letter-spacing:.02em;color:var(--eaw-gold);margin-right:12px}
.ov-banner i{font-style:normal;color:var(--eaw-dim);margin:0 9px}
.shooter-command .ov-banner{opacity:1}
.ov-tip{position:fixed;z-index:47;padding:2px 10px 3px;font:400 calc(12px * var(--eaw-k, 1)) var(--eaw-bold);color:var(--eaw-gold);pointer-events:none;transform:translate(16px,16px);display:none;white-space:nowrap}
.ov-tip span{font:400 calc(11px * var(--eaw-k, 1)) var(--eaw-font);letter-spacing:.06em;color:var(--eaw-cream);margin-left:10px}
.ov-veil{position:fixed;inset:0;z-index:44;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 35%,rgba(0,0,0,.75) 100%)}
.ov-scan{position:fixed;inset:0;z-index:44;pointer-events:none;opacity:0}
.ov-card{position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:47;pointer-events:none;font:400 calc(30px * var(--eaw-k, 1)) var(--eaw-bold);color:var(--eaw-gold);text-shadow:2px 2px 0 rgba(0,0,0,.8);opacity:0;white-space:nowrap;text-align:center}
.ov-card small{display:block;margin-top:6px;font:400 calc(13px * var(--eaw-k, 1)) var(--eaw-font);letter-spacing:.08em;color:var(--eaw-cream);text-shadow:1px 1px 0 #000}
.ov-canvas{position:fixed;inset:0;z-index:3;pointer-events:none}
.shooter-command #hud{animation:ov-hud .5s linear .3s both}
@keyframes ov-hud{from{opacity:0}to{opacity:1}}`;
    const mk = (cls, parent = document.body) => {
      const e = document.createElement('div');
      e.className = cls;
      parent.appendChild(e);
      return e;
    };
    this.els = [css];
    document.head.appendChild(css);
    this.banner = mk('ov-banner eaw-frame-s');
    this.banner.innerHTML = `<b>Overlord</b>Order your squads<i>|</i>Scroll in on a unit to take it<i>|</i><span class="eaw-key">${this.key()}</span>Take selected<i>|</i><span class="eaw-key">Enter</span>Deploy`;
    this.tip = mk('ov-tip eaw-frame-s');
    this.veil = mk('ov-veil');
    this.scan = mk('ov-scan eaw-scan');
    this.card = mk('ov-card');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ov-canvas';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.els.push(this.banner, this.tip, this.veil, this.scan, this.card, this.canvas);
  }

  dispose() {
    for (const e of this.els || []) e.remove();
    document.body.classList.remove('shooter-command');
    const g = this.sh.game;
    if (this.command) g.command = this.command;
  }

  look(command) {
    const c = document.body.classList;
    c.toggle('shooter-on', !command);
    c.toggle('shooter-command', command);
  }

  wrapCommand() {
    const g = this.sh.game,
      orig = g.command.bind(g);
    this.command = g.command;
    g.command = cmd => {
      if (!this.on || !cmd || !HOLDS.has(cmd.c)) return orig(cmd);
      const w = this.sh.world,
        local = id => w.squads.find(q => q.id === id && !q.dead) || null;
      if (this.sh.netClient) {
        this.sendCommand(cmd, local);
        this.viewHold(this.idsOf(cmd).map(local), cmd);
        return {};
      }
      this.hold(this.idsOf(cmd).map(local), cmd, g.me);
      return orig(cmd);
    };
  }

  idsOf(cmd) {
    return [...(Array.isArray(cmd.u) ? cmd.u : []), ...(Array.isArray(cmd.p) ? cmd.p.map(e => e && e[0]) : [])].filter(Boolean);
  }

  hold(list, cmd, side) {
    const sh = this.sh,
      w = sh.world,
      dest = new Map();
    if (Array.isArray(cmd.p)) for (const [id, x, y] of cmd.p) dest.set(id, { x: +x, y: +y });
    for (const q of list) {
      if (!q || q.dead || q.side !== side || !q.members.length) continue;
      const m = q.members[0];
      if (m === sh.body || m.remote || q === sh.rideQ) continue;
      const d = dest.get(q.id) || (Number.isFinite(+cmd.x) ? { x: +cmd.x, y: +cmd.y } : null);
      q.held = { at: w.time, kind: cmd.c, x: d ? d.x : m.x, y: d ? d.y : m.y };
      q.noAI = true;
      for (const u of q.members) {
        sh.teamOf.delete(u);
        sh.bots.delete(u);
      }
      sh.vstate?.delete?.(q);
      this.held.add(q);
    }
  }

  viewHold(list, cmd) {
    const dest = new Map();
    if (Array.isArray(cmd.p)) for (const [id, x, y] of cmd.p) dest.set(id, { x: +x, y: +y });
    for (const q of list) {
      if (!q || q.dead) continue;
      const d = dest.get(q.id) || (Number.isFinite(+cmd.x) ? { x: +cmd.x, y: +cmd.y } : null);
      if (!d) continue;
      q.held = { at: this.sh.world.time, kind: cmd.c, x: d.x, y: d.y, view: true };
      this.held.add(q);
    }
  }

  unhold(q) {
    if (!q || !q.held) return;
    q.held = null;
    this.held.delete(q);
  }

  tickHeld() {
    const sh = this.sh,
      w = sh.world;
    if (!this.held.size || w.time < this.heldAt) return;
    this.heldAt = w.time + OV.tick;
    for (const q of [...this.held]) {
      const H = q.held,
        m = q.members && q.members.find(u => !u.dead);
      if (!H || q.dead || !m) {
        if (q) q.held = null;
        this.held.delete(q);
        continue;
      }
      if (m === sh.body || m.remote) {
        this.unhold(q);
        continue;
      }
      const age = w.time - H.at;
      if (H.view) {
        if (age > OV.viewMax || Math.hypot(m.x - H.x, m.y - H.y) < OV.arrive) this.unhold(q);
        continue;
      }
      if (age < OV.holdMin || (H.kind === 'stop' && age < OV.holdStop)) continue;
      if (age < OV.holdMax) {
        const moving = q.members.some(u => !u.dead && u.path && u.path.length) || (q.box && !q.ext && q.box.path && q.box.path.length) || !!q.moveTry || !!(q.legs && q.legs.length);
        const foe = q.foe && !q.foe.dead && (q.foe.members ? q.foe.members.some(u => !u.dead) : true);
        if (moving || foe) continue;
      }
      this.unhold(q);
      q.noAI = !!(q.crew && !q.crew.in);
    }
  }

  sendCommand(cmd, local) {
    const N = this.sh.game.shooterNet;
    if (!N || !N.session) return;
    const hid = id => {
      const q = local(id),
        u = q && q.members.find(m => !m.dead);
      return (u && N.ids.get(u)) || 0;
    };
    const out = { ...cmd };
    if (Array.isArray(cmd.u)) out.u = cmd.u.map(hid).filter(Boolean);
    if (cmd.t) out.t = hid(cmd.t);
    if (Array.isArray(cmd.p)) out.p = cmd.p.map(([id, x, y]) => [hid(id), x, y]).filter(e => e[0]);
    N.session.send(0, { k: 'sh-cmd', cmd: out });
  }

  remoteCommand(peer, cmd) {
    const sh = this.sh,
      N = sh.game.shooterNet;
    if (!this.on || !N || !cmd || !HOLDS.has(cmd.c)) return;
    const side = sh.peerSide(peer),
      sq = id => {
        const u = N.byId.get(+id);
        return u && !u.dead && u.squad && !u.squad.dead ? u.squad : null;
      },
      num = v => (Number.isFinite(+v) ? +v : 0);
    const out = { c: cmd.c, mode: typeof cmd.mode === 'string' ? cmd.mode.slice(0, 16) : '' };
    if (cmd.x !== undefined) {
      out.x = num(cmd.x);
      out.y = num(cmd.y);
    }
    if (cmd.h !== undefined) out.h = num(cmd.h);
    if (Array.isArray(cmd.u)) out.u = cmd.u.slice(0, 200).map(id => sq(id)?.id).filter(Boolean);
    if (cmd.t) out.t = sq(cmd.t)?.id || 0;
    if (Array.isArray(cmd.p)) out.p = cmd.p.slice(0, 200).map(e => [sq(e && e[0])?.id || 0, num(e && e[1]), num(e && e[2])]).filter(e => e[0]);
    const w = sh.world;
    this.hold(this.idsOf(out).map(id => w.squads.find(q => q.id === id && !q.dead) || null), out, side);
    executeLand(sh.game, side, out);
  }

  takeable(u, side = this.sh.me) {
    const sh = this.sh;
    if (!u || u.dead || u.gone || u.side !== side || u.structure || u.remote || u === sh.body) return false;
    const q = u.squad;
    if (!q || q.native || q.dead) return false;
    const N = sh.game.shooterNet;
    if (N && N.playerUnits && N.playerUnits().has(u)) return false;
    if (q.crew) return sh.netClient || !!(q.crew.in && !q.crew.in.dead && !q.crew.in.remote && q.crew.in !== sh.body);
    if (sh.netClient && u.kind !== 'INFANTRY' && !u.foot) return true;
    return !u.inside && u.speed > 0 && (u.kind === 'INFANTRY' || u.foot);
  }

  roleFor(u) {
    const sh = this.sh;
    if (heroic(u.type)) return 'hero';
    const cls = sh.classes(),
      c = cls.find(k => !k.vehicle && (k.unit === u.type || (k.units || []).includes(u.type)));
    return c ? sh.roleOf(c, cls) : 'trooper';
  }

  tickAlive(real) {
    if (!this.on || this.pull <= 0) return;
    if (performance.now() - this.pullAt > OV.pullIdle * 1000) this.pull = Math.max(0, this.pull - real * OV.pullDecay);
  }

  wheelAlive(e) {
    if (!this.on || this.blend) return;
    this.pullAt = performance.now();
    this.pull = Math.max(0, Math.min(1, this.pull + Math.sign(e.deltaY) * OV.pullStep));
    if (this.pull >= 1) this.enterCommand();
  }

  minDist() {
    const k = this.sh.game.cam?.steps;
    return (k && k[0] && k[0][0]) || 260;
  }

  wheelCommand(e) {
    const sh = this.sh,
      g = sh.game,
      v = g.view,
      ui = g.ui;
    if (!this.on || this.blend || e.target !== sh.canvas() || !e.deltaY) return false;
    if (ui?.placing || g.moveDragOn || g.chase?.on || g.track?.on || g.controlsLocked) return false;
    if (e.deltaY < 0 && v.dist <= this.minDist() * OV.takeDist) {
      const u = this.hover || this.picked();
      if (u) {
        this.takeOver(u);
        return true;
      }
    }
    const nd = g.viewDist ? g.viewDist(v.dist * (e.deltaY > 0 ? OV.zoomOut : OV.zoomIn)) : v.dist;
    if (nd === v.dist) return true;
    const p = ui?.mouse ? g.groundAt(ui.mouse.x, ui.mouse.y) : null;
    if (p) {
      const k = 1 - nd / v.dist;
      v.x += (p.x - v.x) * k;
      v.y += (p.y - v.y) * k;
    }
    v.dist = nd;
    if (g.viewTilt) v.pitch = g.viewTilt(nd);
    return true;
  }

  picked() {
    const ui = this.sh.game.ui,
      sel = ui?.selection?.filter(q => !q.dead && q.members?.length) || [];
    if (sel.length !== 1) return null;
    const u = sel[0].members.find(m => !m.dead);
    return this.takeable(u) ? u : null;
  }

  keyPress() {
    const sh = this.sh;
    if (!this.on || this.blend || sh.game.over) return;
    if (sh.state === 'command') {
      const u = this.hover || this.picked();
      if (u) this.takeOver(u);
      else sh.flash(`Point at one of your units, or select one, then press ${this.key()}`);
      return;
    }
    this.enterCommand();
  }

  deployMenu() {
    const sh = this.sh;
    if (sh.state !== 'command' || this.blend) return;
    this.wantDeploy = true;
    this.look(false);
    this.banner.style.opacity = '';
    sh.state = 'dead';
    sh.deadAt = -1e9;
    sh.lastCam = null;
    sh.openDeploy();
  }

  startBlend(kind, title, sub) {
    const cam = this.sh.game.camera;
    this.blend = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov, near: cam.near, t0: performance.now(), dur: kind === 'out' ? OV.outDur : OV.inDur, kind };
    this.card.innerHTML = `${title}<small>${sub}</small>`;
    this.whoosh(kind);
  }

  applyBlend(cam) {
    const B = this.blend;
    if (!B) return;
    const k = Math.min(1, (performance.now() - B.t0) / (B.dur * 1000)),
      e = ease(k),
      s = Math.sin(Math.PI * k);
    _p.copy(cam.position);
    _q.copy(cam.quaternion);
    const span = B.p.distanceTo(_p);
    cam.position.lerpVectors(B.p, _p, e);
    cam.position.z += Math.sin(Math.PI * e) * span * OV.arc;
    cam.quaternion.slerpQuaternions(B.q, _q, e);
    const fov = B.fov + (cam.fov - B.fov) * e,
      near = Math.min(B.near, cam.near);
    if (cam.fov !== fov || cam.near !== near) {
      cam.fov = fov;
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    this.veil.style.opacity = (s * 0.95).toFixed(3);
    this.scan.style.opacity = (s * 0.6).toFixed(3);
    this.card.style.opacity = (B.kind === 'out' ? Math.max(0, Math.sin(Math.PI * Math.min(1, k * 1.25))) : Math.max(0, Math.sin(Math.PI * Math.min(1, k * 1.4)))).toFixed(3);
    const blur = s * 1.6;
    this.sh.canvas().style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px) saturate(${(1 - s * 0.25).toFixed(3)})` : '';
    if (k >= 1) {
      this.blend = null;
      this.veil.style.opacity = this.scan.style.opacity = this.card.style.opacity = '0';
      this.sh.canvas().style.filter = '';
    }
  }

  whoosh(kind) {
    const A = this.sh.game.audio,
      ctx = A && A.ctx;
    if (!ctx || !A.master) return;
    const t = ctx.currentTime,
      vol = (A.sfxVolume ?? 0.7) * 0.5,
      d = kind === 'out' ? OV.outDur : OV.inDur,
      n = Math.floor(ctx.sampleRate * d),
      buf = ctx.createBuffer(1, n, ctx.sampleRate),
      ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(),
      f = ctx.createBiquadFilter(),
      a = ctx.createGain(),
      o = ctx.createOscillator(),
      og = ctx.createGain();
    src.buffer = buf;
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(kind === 'out' ? 260 : 1900, t);
    f.frequency.exponentialRampToValueAtTime(kind === 'out' ? 2200 : 240, t + d);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.exponentialRampToValueAtTime(0.45 * vol, t + d * 0.45);
    a.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.type = 'sine';
    o.frequency.setValueAtTime(kind === 'out' ? 70 : 140, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'out' ? 140 : 55, t + d);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.35 * vol, t + d * 0.5);
    og.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(f);
    f.connect(a);
    a.connect(A.master);
    o.connect(og);
    og.connect(A.master);
    src.start(t);
    src.stop(t + d);
    o.start(t);
    o.stop(t + d + 0.02);
  }

  release() {
    const sh = this.sh,
      w = sh.world,
      b = sh.body;
    if (!b || b.dead) return null;
    if (sh.gunQ || sh.post) sh.leave(false);
    const ride = sh.rideQ;
    if (ride) {
      for (const m of ride.members) {
        m.direct = null;
        if (m.pilot === sh.A) m.pilot = undefined;
        if (m.flies && !m.dead) {
          m.holder.rotation.x = 0;
          m.holder.rotation.y = 0;
        }
      }
      ride.direct = null;
      sh.rideQ = null;
      sh.rideLead = null;
      if (!sh.netClient) ride.noAI = false;
      sh.note('');
    }
    sh.untwist();
    b.pilot = undefined;
    if (!sh.netClient) {
      w.dropCombatMod(b, 'shooter-player');
      b.squad.noAI = false;
    } else sh.game.shooterNet?.session?.send(0, { k: 'sh-free' });
    b.squad.selectable = undefined;
    b.holder.visible = !b.inside;
    sh.body = null;
    return ride || b.squad;
  }

  enterCommand() {
    const sh = this.sh,
      g = sh.game,
      v = g.view;
    if (!this.on || sh.state === 'command' || g.over) return;
    const b = sh.body && !sh.body.dead ? sh.body : null,
      seat = b ? sh.seatOf() : null,
      at = seat || b || sh.fellAt || null,
      yaw = sh.yaw;
    this.startBlend('out', 'Tactical view', 'Command your squads');
    const left = b ? this.release() : null;
    sh.state = 'command';
    this.pull = 0;
    this.wantDeploy = false;
    sh.panel.style.display = 'none';
    sh.hud.style.display = 'none';
    if (sh.scopeEl) sh.scopeEl.style.display = 'none';
    if (sh.bigMap) sh.bigMap.style.display = 'none';
    sh.fire = sh.zoom = false;
    sh.crouched = false;
    sh.keys.clear();
    g.keys?.clear?.();
    if (document.pointerLockElement) document.exitPointerLock?.();
    sh.lastCam = null;
    sh.introUntil = 0;
    sh.introAt = sh.introAt || 1;
    if (sh.introEl) sh.introEl.style.display = 'none';
    if (at) {
      v.x = at.x;
      v.y = at.y;
    }
    v.dist = g.viewDist ? g.viewDist(OV.startDist) : OV.startDist;
    v.pitch = g.viewTilt ? g.viewTilt(v.dist) : (55 * Math.PI) / 180;
    if (b) v.yaw = yaw + Math.PI;
    this.look(true);
    if (left && g.ui?.select) g.ui.select([left]);
  }

  takeOver(u) {
    const sh = this.sh;
    if (!this.on || this.blend || !this.takeable(u)) return false;
    if (sh.netClient) {
      this.netTake(u);
      return true;
    }
    let body = u,
      ride = null;
    if (u.squad.crew) {
      ride = u.squad;
      body = ride.crew.in;
      if (!body || body.dead || body.remote) return false;
    }
    this.possessFrom(body, ride, u);
    return true;
  }

  possessFrom(body, ride, shown) {
    const sh = this.sh,
      g = sh.game;
    this.startBlend('in', sh.nameOf(shown.type), 'Taking control');
    g.ui?.select?.([]);
    this.leaveCommand();
    sh.role = this.roleFor(body);
    this.unhold(body.squad);
    if (ride) this.unhold(ride);
    sh.possess(body.squad, body, sh.role === 'hero');
    if (ride && !ride.dead && ride.members.length) {
      sh.drive(ride);
      ride.noAI = true;
    }
  }

  async netTake(u) {
    const sh = this.sh,
      N = sh.game.shooterNet;
    if (!N || this.taking) return;
    const id = N.ids.get(u);
    if (!id) return;
    this.taking = true;
    const got = await N.requestTake(id);
    this.taking = false;
    if (sh.state !== 'command') return;
    if (!got || !got.unit || got.unit.dead) {
      sh.flash('That unit cannot be taken over');
      return;
    }
    const body = got.unit,
      ride = got.seat === 'drive' && body.inside ? body.inside.squad : null;
    this.possessFrom(body, ride, u);
  }

  remoteTake(peer, id) {
    const sh = this.sh,
      N = sh.game.shooterNet;
    if (!this.on || !N) return null;
    const u = N.byId.get(+id),
      side = sh.peerSide(peer);
    if (!this.takeable(u, side)) return null;
    const had = sh.remotes.get(peer);
    if (had && !had.dead) this.remoteFree(peer);
    let body = u,
      ride = null;
    if (u.squad.crew) {
      ride = u.squad;
      body = ride.crew.in;
      if (!body || body.dead || body.remote || body === sh.body) return null;
    }
    const q = body.squad,
      hero = heroic(body.type);
    this.unhold(q);
    if (ride) this.unhold(ride);
    q.noAI = true;
    q.selectable = false;
    q.foe = null;
    body.path.length = 0;
    body.target = null;
    sh.teamOf.delete(body);
    sh.bots.delete(body);
    body.remote = { peer, s: [], kind: '', hero };
    sh.remotes.set(peer, body);
    if (ride) {
      ride.noAI = true;
      ride.foe = null;
      for (const m of ride.members) {
        m.path = [];
        m.target = null;
        m.remote = { peer, s: [], kind: '', car: true };
      }
      body.remote.ride = ride;
    }
    return { unit: body, seat: ride ? 'drive' : '' };
  }

  remoteFree(peer) {
    const sh = this.sh,
      u = sh.remotes.get(peer);
    if (!u) return;
    const R = u.remote;
    if (R && R.ride) {
      const q = R.ride;
      for (const m of q.members) {
        m.remote = null;
        if (m.flies && m.netRoll !== undefined) {
          m.netRoll = m.netTilt = undefined;
          m.holder.rotation.x = m.holder.rotation.y = 0;
        }
      }
      R.ride = null;
      q.noAI = false;
    }
    if (R && (R.gun || R.post)) sh.remoteExit(peer);
    sh.remotes.delete(peer);
    if (u.dead) return;
    u.remote = null;
    u.squad.noAI = false;
    u.squad.selectable = undefined;
    sh.world.dropCombatMod(u, 'shooter-player');
  }

  leaveCommand() {
    this.look(false);
    this.wantDeploy = false;
    this.hover = null;
    this.tip.style.display = 'none';
    this.clearCanvas();
  }

  possessed(u) {
    if (!this.on) return;
    if (!this.blend && u) this.startBlend('in', this.sh.nameOf(u.type), 'Deployed');
    if (document.body.classList.contains('shooter-command')) this.look(false);
    this.wantDeploy = false;
    this.pull = 0;
  }

  frame(real, cam) {
    const sh = this.sh,
      g = sh.game;
    sh.setFov(cam, this.fov, this.near);
    sh.eyeAt.copy(cam.position);
    sh.feedGround();
    const m = g.ui?.mouse,
      u = m && m.inside && !this.blend ? g.unitAt(m.x, m.y) : null;
    this.hover = this.takeable(u) ? u : null;
    if (this.hover) {
      this.tip.style.display = 'block';
      this.tip.style.left = m.x + 'px';
      this.tip.style.top = m.y + 'px';
      const near = g.view.dist <= this.minDist() * OV.takeDist;
      this.tip.innerHTML = `${sh.nameOf(this.hover.type)}<span>${near ? 'Scroll in' : 'Zoom in'} or ${this.key()} to take control</span>`;
    } else this.tip.style.display = 'none';
  }

  after(cam) {
    if (!this.on) return;
    this.applyBlend(cam);
  }

  paint() {
    if (!this.on) return;
    if (this.sh.state === 'command') this.draw(this.sh.game.camera);
    else if (this.drawn) this.clearCanvas();
  }

  clearCanvas() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawn = false;
  }

  draw(cam) {
    const c = this.canvas,
      x = this.ctx,
      pr = Math.min(2, devicePixelRatio || 1),
      W = innerWidth,
      H = innerHeight;
    if (c.width !== Math.round(W * pr) || c.height !== Math.round(H * pr)) {
      c.width = Math.round(W * pr);
      c.height = Math.round(H * pr);
    }
    x.setTransform(pr, 0, 0, pr, 0, 0);
    x.clearRect(0, 0, W, H);
    this.drawn = true;
    cam.updateMatrixWorld();
    const proj = (px, py, pz) => {
      _v.set(px, py, pz).project(cam);
      return _v.z < 1 && _v.z > -1 ? [((_v.x + 1) / 2) * W, ((1 - _v.y) / 2) * H] : null;
    };
    const ring = (px, py, pz, r, n = 18) => {
      x.beginPath();
      let first = true;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2,
          s = proj(px + Math.cos(a) * r, py + Math.sin(a) * r, pz);
        if (!s) return false;
        if (first) x.moveTo(s[0], s[1]);
        else x.lineTo(s[0], s[1]);
        first = false;
      }
      return true;
    };
    const now = performance.now() / 1000;
    x.lineCap = 'round';
    let n = 0;
    for (const q of this.held) {
      if (n++ >= OV.lines) break;
      const H0 = q.held,
        m = q.members && q.members.find(u => !u.dead);
      if (!H0 || !m || q.side !== this.sh.me) continue;
      const foe = q.foe && !q.foe.dead ? q.foe.members?.find(u => !u.dead) || null : null,
        way = q.box && !q.ext && q.box.path && q.box.path.length ? q.box.path : m.path || [],
        end = way.length ? way[way.length - 1] : H0,
        tx = foe ? foe.x : end.x,
        ty = foe ? foe.y : end.y,
        z0 = (m.z || 0) + 2,
        z1 = foe ? (foe.z || 0) + 2 : this.groundZ(tx, ty) + 2,
        a = proj(m.x, m.y, z0),
        b = proj(tx, ty, z1);
      if (!a || !b) continue;
      x.strokeStyle = foe ? 'rgba(255,110,90,0.8)' : 'rgba(120,205,255,0.75)';
      x.lineWidth = 1.6;
      x.setLineDash([7, 6]);
      x.lineDashOffset = -now * 24;
      x.beginPath();
      x.moveTo(a[0], a[1]);
      x.lineTo(b[0], b[1]);
      x.stroke();
      x.setLineDash([]);
      if (!foe && ring(tx, ty, z1, 9, 12)) {
        x.lineWidth = 1.8;
        x.stroke();
      }
    }
    const h = this.hover;
    if (h && !this.blend) {
      const r = Math.max(8, (h.hitRadius || 6) * 1.7) * (1 + 0.08 * Math.sin(now * 6)),
        z = (h.z || 0) + 1.5;
      x.shadowColor = 'rgba(255,200,80,0.9)';
      x.shadowBlur = 10;
      x.strokeStyle = 'rgba(255,215,106,0.95)';
      x.lineWidth = 2.4;
      if (ring(h.x, h.y, z, r, 24)) x.stroke();
      x.lineWidth = 1.2;
      x.strokeStyle = 'rgba(255,215,106,0.5)';
      if (ring(h.x, h.y, z, r * 1.35, 24)) x.stroke();
      x.shadowBlur = 0;
    }
  }

  groundZ(px, py) {
    const T = this.sh.world.terrain;
    return T ? heightAt(T, px, py) : 0;
  }
}
