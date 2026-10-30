import * as THREE from 'three';
import { db } from '../gamedata.js';
import { getModelData, buildModel } from '../model.js';
import { iconUrl, iconCanvasRect, iconAtlas } from '../icons.js';
import { loadTextureCanvas } from '../dds.js';
import { buildCost, buildTime, isUpgradeType, isSquadronType, isCompanyType, companySpaceUnits, spacePop } from './sim.js';
import { ids } from './commands.js';
import { CommandBar } from './hud.js';
import { pressed, held, groupKey, withKey, bothButtonsRotate, keysOf, keyName } from './keybinds.js';

const ORDER_KEYS = [
  ['ATTACK_MOVE', 'attackmove'],
  ['MOVE', 'move'],
  ['ATTACK', 'attack'],
  ['GUARD', 'guard'],
  ['WAYPOINT', 'waypoint']
];
import { Pointers, tacticalPointer } from './pointers.js';
import { Radar } from './radar.js';
import { showHand, formation, slotAt, stretched, laidOut, WHEEL_TURN } from './placehand.js';
import { ArcView } from './directview.js';
import { ChaseView } from './chaseview.js';
import { TrackCam, TRACK_LOOK } from './trackcam.js';

const $ = id => document.getElementById(id);
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const NO_ARCS = [];
const TURN_DRAG = 0.005;

function iconFor(type) {
  let name = type.str('Icon_Name');
  if (!name)
    for (const k of ['Squadron_Units', 'Company_Units']) {
      const t = db.type(type.list(k)[0]);
      if (t) {
        name = t.str('Icon_Name');
        break;
      }
    }
  return iconUrl(name);
}

const heroTypes = new WeakMap();
const heroType = t => {
  if (!t) return false;
  let v = heroTypes.get(t);
  if (v === undefined) heroTypes.set(t, (v = t.bool('Is_Named_Hero') || t.bool('Is_Generic_Hero') || t.bool('Show_Hero_Head')));
  return v;
};
const unitIcon = s => !s.isPad && (!!s.isSquad || heroType(s.type) || !!globalThis.showAllUnitIcons);

function iconNameFor(type) {
  let name = type.str('Icon_Name');
  if (!name)
    for (const k of ['Squadron_Units', 'Company_Units']) {
      const t = db.type(type.list(k)[0]);
      if (t) {
        name = t.str('Icon_Name');
        break;
      }
    }
  return name;
}

const ABILITY_ICONS = {
  TURBO: 'i_sa_power_to_engines',
  DEFEND: 'i_sa_defend_mode',
  SPOILER_LOCK: 'i_sa_s_foil_mode',
  FOW_REVEAL_PING: 'i_sa_sensor_ping',
  BARRAGE: 'i_sa_barrage_area'
};
Object.assign(ABILITY_ICONS, {
  ENERGY_WEAPON: 'i_sa_fire_energy_weapon',
  INVULNERABILITY: 'i_sa_evasive_maneuvers',
  MISSILE_SHIELD: 'i_sa_missile_jammer',
  FULL_SALVO: 'i_sa_full_salvo',
  CONCENTRATE_FIRE: 'i_sa_all_ships_concentrate_fire',
  HARMONIC_BOMB: 'i_sa_harmonic_bomb',
  BLAST: 'i_sa_blast',
  WEAKEN_ENEMY: 'i_sa_weaken_enemy',
  CORRUPT_SYSTEMS: 'i_sa_corrupt_systems',
  LEECH_SHIELDS: 'i_sa_leech_shields'
});
export function abilityIconName(kind, override = '') {
  for (const n of [override, (ABILITY_ICONS[kind] || 'i_sa_' + kind.toLowerCase()) + '.tga', 'i_sa_blank_button.tga'])
    if (n && iconCanvasRect(n)) return n;
  return null;
}

export function shownAbility(abilities) {
  for (let i = 0; i < Math.min(2, abilities?.length || 0); i++) if (abilities[i]?.active) return abilities[i];
  return null;
}

function abilityIcon(kind, override = '') {
  return (
    (override && iconUrl(override)) ||
    iconUrl((ABILITY_ICONS[kind] || 'i_sa_' + kind.toLowerCase()) + '.tga') ||
    iconUrl('i_sa_blank_button.tga')
  );
}

function ghostModels(type) {
  const out = [];
  const one = (t, x, y, up = 0) => {
    const f = t.str('Space_Model_Name');
    if (!f) return;
    const hardpoints = t
      .list('HardPoints')
      .map(n => db.hardpoint(n))
      .filter(Boolean)
      .map(h => ({ model: h.str('Model_To_Attach'), bone: h.str('Attachment_Bone') || h.str('Collision_Mesh') }))
      .filter(h => h.model && h.bone);
    out.push({ file: f, x: y, y: -x, z: t.num('Layer_Z_Adjust', 0) + up, scale: t.num('Scale_Factor', 1), hardpoints });
  };
  if (isSquadronType(type)) {
    const offs = type.tuples('Squadron_Offsets').map(t => t.map(parseFloat));
    type.list('Squadron_Units').forEach((n, i) => {
      const t = db.type(n);
      if (t) one(t, (offs[i] || [0, 0])[0], (offs[i] || [0, 0])[1], (offs[i] || [])[2] || 0);
    });
  } else if (isCompanyType(type)) {
    for (const t of companySpaceUnits(type)) one(t, 0, 0);
  } else one(type, 0, 0);
  return out;
}

const reticles = new Map();
function reticle(kind, tracked, color) {
  const key = kind + (tracked ? '|T|' : '|') + color;
  let r = reticles.get(key);
  if (r !== undefined) return r;
  reticles.set(key, null);
  const tag = tracked ? 'HardPoint_Target_Reticle_Enemy_Tracked_Texture' : 'HardPoint_Target_Reticle_Enemy_Texture';
  const hit = db.constants.tuples(tag).find(t => t[0].toUpperCase() === kind);
  loadTextureCanvas((hit ? hit[1] : 'I_Hard_Point_Reticle_Generic' + (tracked ? '_Tracked' : '')) + '.dds').then(src => {
    if (!src) return;
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    const g = cv.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.75;
    g.fillStyle = color;
    g.fillRect(0, 0, cv.width, cv.height);
    reticles.set(key, cv);
  });
  return null;
}

function describe(type) {
  const ids = type.list('Encyclopedia_Text');
  for (const k of ['Squadron_Units', 'Company_Units'])
    if (!ids.length) {
      const t = db.type(type.list(k)[0]);
      if (t) ids.push(...t.list('Encyclopedia_Text'));
    }
  return ids
    .map(id => db.text.get(id.toUpperCase()))
    .filter(Boolean)
    .join(' ')
    .replace(/\\n/g, ' ');
}

function typeName(type) {
  let id = type.str('Text_ID');
  if (!id || !db.text.has(id.toUpperCase()))
    for (const k of ['Squadron_Units', 'Company_Units']) {
      const t = db.type(type.list(k)[0]);
      if (t) {
        id = t.str('Text_ID');
        break;
      }
    }
  return db.t(id) || type.name.replace(/_/g, ' ');
}

export class UI {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.r = game.renderer;
    this.player = game.human;
    this.selection = [];
    this.radar = new Radar();
    this.groups = new Map();
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false };
    this.drag = null;
    this.hover = null;
    this.armed = null;
    this.lastClick = { t: 0, type: null };
    this.hudTimer = 0;
    this.buildSig = '';
    this.selSig = '';
    this.pings = [];
    this.lastAlert = -100;
    this.placing = null;
    this.reinSig = null;
    this.bar = game.hudAssets ? new CommandBar(game, this, game.hudAssets) : null;
    document.body.classList.toggle('original-hud', !!this.bar);
    this.bind();
  }

  bind() {
    const dom = this.r.dom;
    this.handlers = [];
    const on = (el, ev, fn, opts) => {
      el.addEventListener(ev, fn, opts);
      this.handlers.push(() => el.removeEventListener(ev, fn, opts));
    };
    on(dom, 'contextmenu', e => e.preventDefault());
    on(dom, 'mousedown', e => this.mouseDown(e));
    on(window, 'mousemove', e => this.mouseMove(e));
    on(window, 'mouseup', e => this.mouseUp(e));
    on(
      dom,
      'wheel',
      e => {
        e.preventDefault();
        this.wheel(e);
      },
      { passive: false }
    );
    on(window, 'keydown', e => this.keyDown(e));
    on(window, 'keyup', e => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    on(dom, 'mouseleave', () => {
      this.mouse.inside = false;
    });
    on(dom, 'mouseenter', e => {
      this.mouse.inside = true;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    const mm = $('minimap');
    on(mm, 'mousedown', e => this.minimapClick(e));
    on(mm, 'mousemove', e => {
      if (e.buttons & 1) this.minimapClick(e);
    });
    on(mm, 'contextmenu', e => e.preventDefault());
  }

  destroy() {
    for (const off of this.handlers) off();
    this.endTrack();
    this.track?.destroy();
    this.r.chase?.destroy();
    this.r.chase = null;
    if (this.bar) this.bar.destroy();
    this.game.superweaponHUD?.destroy();
  }

  wheel(e) {
    if (this.game.controlsLocked) {
      this.zoom(e.deltaY);
      return;
    }
    if (this.r.chase?.on) {
      this.r.chase.wheel(e.deltaY / 100);
      return;
    }
    if (this.track?.on) {
      this.r.rig.wheel(e.deltaY / 100);
      return;
    }
    const d = Math.sign(e.deltaY),
      pl = this.placing,
      md = this.moveDrag;
    if (md && md.on) {
      md.perm += d;
      return;
    }
    if (pl && (e.shiftKey || (pl.press && Math.hypot(this.mouse.x - pl.press.sx, this.mouse.y - pl.press.sy) > 8))) {
      pl.perm = (pl.perm || 0) + d;
      return;
    }
    if (pl && globalThis.reinforceTurn !== false) {
      this.turnPlacing(e.deltaY);
      return;
    }
    this.zoom(e.deltaY);
  }

  zoom(delta) {
    if (this.game.controlsLocked) return;
    const rig = this.r.rig;
    const before = this.r.pickGround(this.mouse.x, this.mouse.y);
    rig.wheel(delta / 100);
    rig.apply(0);
    this.r.camera.updateMatrixWorld();
    const after = this.r.pickGround(this.mouse.x, this.mouse.y);
    if (before && after) {
      rig.x += before.x - after.x;
      rig.y += before.y - after.y;
      rig.clamp();
    }
  }

  touchView(dx, dy, turn) {
    if (this.game.controlsLocked || this.game.cine.on) return;
    const rig = this.r.rig,
      k = (rig.dist / this.r.height) * 1.1;
    rig.pan(-dx * k, dy * k);
    rig.yaw += turn;
  }

  mouseDown(e) {
    if (this.game.controlsLocked) return;
    this.game.audio.unlock();
    if (this.game.cine.on) {
      if (!this.game.cine.sequence) this.game.cine.stop();
      return;
    }
    if (this.direct) {
      if (e.button === 0) this.fireHeld = true;
      return;
    }
    if (this.track?.on) {
      this.track.relock();
      return;
    }
    const m = this.mouse;
    m.x = e.clientX;
    m.y = e.clientY;
    if (bothButtonsRotate() && (e.buttons & 3) === 3 && !this.placing) {
      this.drag = null;
      this.pendingCommand = null;
      this.endMoveDrag();
      this.turnDrag = { x: m.x };
      return;
    }
    if (this.placing) {
      if (e.button === 0 && !this.placing.dragging && this.placing.list.length > 1) {
        const g = this.r.pickGround(m.x, m.y);
        if (g) this.placing.press = { sx: m.x, sy: m.y, x: g.x, y: g.y };
      } else if (e.button === 0) this.finishPlacing(m.x, m.y);
      else this.cancelPlacing();
      return;
    }
    if (e.button === 0) {
      if (this.armed) {
        if (this.runArmed(m.x, m.y) && !e.shiftKey && this.armed !== 'waypoint') this.arm(null);
        return;
      }
      this.drag = { x0: m.x, y0: m.y, x1: m.x, y1: m.y, box: false, shift: e.shiftKey };
    } else if (e.button === 2) {
      if (this.armed) {
        this.arm(null);
        return;
      }
      this.pendingCommand = { x: m.x, y: m.y, ctrl: e.ctrlKey, shift: e.shiftKey || e.altKey };
      this.ctrlTurn = e.ctrlKey && !e.shiftKey && !e.altKey ? { x: m.x, y: m.y } : null;
      const movers = this.mine().filter(s => !s.dead && (s.isSquad || s.isMobile)),
        g = this.r.pickGround(m.x, m.y),
        h = this.pick(m.x, m.y);
      if (globalThis.lineMove !== false && movers.length > 1 && g && !(h && h.player.id >= 0 && h.player.team !== this.player.team))
        this.moveDrag = { sx: m.x, sy: m.y, a: { x: g.x, y: g.y }, movers, on: false, perm: 0, ghosts: [] };
    } else if (e.button === 1) {
      e.preventDefault();
      this.panDrag = { x: m.x, y: m.y };
    }
  }

  mouseMove(e) {
    if (this.game.controlsLocked) return;
    const m = this.mouse;
    if (this.r.chase?.on) {
      this.r.chase.look(e.movementX || 0, e.movementY || 0);
      return;
    }
    if (this.track?.on) {
      const rig = this.r.rig;
      rig.yaw -= (e.movementX || 0) * TRACK_LOOK;
      rig.pitch = Math.min(1.5, Math.max(-1.5, rig.pitch + (e.movementY || 0) * TRACK_LOOK));
      return;
    }
    if (this.panDrag) {
      const k = (this.r.rig.dist / this.r.height) * 1.1;
      this.r.rig.pan(-(e.clientX - this.panDrag.x) * k, (e.clientY - this.panDrag.y) * k);
      this.panDrag.x = e.clientX;
      this.panDrag.y = e.clientY;
    }
    if (
      this.ctrlTurn &&
      !this.turnDrag &&
      e.buttons & 2 &&
      Math.abs(e.clientX - this.ctrlTurn.x) + Math.abs(e.clientY - this.ctrlTurn.y) > 5
    ) {
      this.pendingCommand = null;
      this.endMoveDrag();
      this.turnDrag = { x: e.clientX, y: e.clientY, tilt: true };
    }
    if (this.turnDrag) {
      this.r.rig.yaw -= (e.clientX - this.turnDrag.x) * TURN_DRAG;
      this.turnDrag.x = e.clientX;
      if (this.turnDrag.tilt) {
        this.r.rig.tilt((e.clientY - this.turnDrag.y) * TURN_DRAG);
        this.turnDrag.y = e.clientY;
      }
    }
    m.x = e.clientX;
    m.y = e.clientY;
    m.moved = true;
    if (this.drag) {
      this.drag.x1 = m.x;
      this.drag.y1 = m.y;
      if (Math.abs(m.x - this.drag.x0) + Math.abs(m.y - this.drag.y0) > 8) this.drag.box = true;
    }
  }

  mouseUp(e) {
    if (this.game.controlsLocked) return;
    if (this.direct && e.button === 0) {
      this.fireHeld = false;
      return;
    }
    if (e.button === 1) this.panDrag = null;
    if (e.button === 2) this.ctrlTurn = null;
    if ((e.button === 0 || e.button === 2) && this.turnDrag) {
      this.turnDrag = null;
      return;
    }
    if (e.button === 2 && this.moveDrag) {
      const md = this.moveDrag;
      this.endMoveDrag();
      if (md.on) {
        this.pendingCommand = null;
        this.finishMoveDrag(md, e.ctrlKey);
        return;
      }
    }
    if (e.button === 2 && this.pendingCommand) {
      const p = this.pendingCommand;
      this.pendingCommand = null;
      this.commandAt(p.x, p.y, p.ctrl, p.shift);
      return;
    }
    if (e.button === 0 && this.placing && this.placing.press) {
      this.finishPlacing(e.clientX, e.clientY);
      if (this.placing) this.placing.press = null;
      return;
    }
    if (e.button === 0 && this.placing && this.placing.dragging) {
      this.placing.dragging = false;
      if (e.target === this.r.dom) this.finishPlacing(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.box) {
      const x0 = Math.min(d.x0, d.x1),
        x1 = Math.max(d.x0, d.x1),
        y0 = Math.min(d.y0, d.y1),
        y1 = Math.max(d.y0, d.y1);
      const hits = [];
      for (const s of this.world.selectables()) {
        if (s.player !== this.player || !(s.isSquad || s.isMobile)) continue;
        const p = this.screenOf(s);
        if (!p.behind && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) hits.push(s);
      }
      this.select(hits, d.shift);
    } else {
      const hit = this.pick(d.x0, d.y0);
      const now = performance.now();
      if (hit && hit.player === this.player && now - this.lastClick.t < 350 && this.lastClick.type === hit.type) {
        const same = [];
        for (const s of this.world.selectables()) {
          if (s.player !== this.player || s.type !== hit.type) continue;
          const p = this.screenOf(s);
          if (!p.behind && p.x >= 0 && p.x <= this.r.width && p.y >= 0 && p.y <= this.r.height) same.push(s);
        }
        this.select(same, false);
      } else if (!hit) this.select([], d.shift);
      else if (this.canSelect(hit)) this.select([hit], d.shift);
      this.lastClick = { t: now, type: hit ? hit.type : null };
    }
  }

  keyDown(e) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const game = this.game;
    if (
      e.code === 'Escape' &&
      (game.controlsLocked || game.tacticalCinematics?.on || game.tacticalMovies?.active) &&
      game.scripts?.storyEscape()
    ) {
      e.preventDefault();
      return;
    }
    if (game.controlsLocked) return;
    this.keys.add(e.code);
    if (game.setup.attract) return;
    if (e.code === 'F2') {
      e.preventDefault();
      game.toggleBenchmark();
      return;
    }
    const squadCam = pressed(e, 'SQUAD_CAM');
    if (squadCam || pressed(e, 'BATTLE_CAM')) {
      e.preventDefault();
      const pick = this.selection.find(s => !s.dead);
      if (this.track?.on && this.track.whole !== squadCam) this.track.start(squadCam);
      else if (!game.cine.on && (this.following || pick)) {
        if (this.following) this.endTrack();
        else this.startTrack(pick, squadCam);
      } else if (!squadCam) game.cine.toggle();
      return;
      return;
    }
    if (game.cine.on) {
      if (e.code === 'Escape' && !game.cine.sequence) game.cine.stop();
      else if (pressed(e, 'PAUSE')) game.togglePause();
      return;
    }
    if (e.code === 'Escape' && this.track?.on) {
      this.endTrack();
      return;
    }
    if (e.code === 'Escape' && this.placing) {
      this.cancelPlacing();
      return;
    }
    if (pressed(e, 'DIRECT_CONTROL')) {
      this.toggleDirect();
      return;
    }
    if (pressed(e, 'DIRECT_VIEW') && this.direct) {
      this.toggleChase();
      return;
    }
    if (pressed(e, 'TOGGLE_HUD')) {
      document.body.classList.toggle('hud-hidden');
      return;
    }
    if (e.code === 'Escape' && this.direct) {
      this.releaseDirect();
      return;
    }
    if (game.menus && game.menus.open) {
      if (e.code === 'Escape') game.toggleMenu();
      return;
    }
    if (game.lock && pressed(e, 'INITIATE_CHAT')) {
      e.preventDefault();
      game.openChat();
      return;
    }
    if (e.code === 'Escape') {
      if (this.armed) this.arm(null);
      else if (this.selection.length) this.select([]);
      else game.toggleMenu();
      return;
    }
    if (pressed(e, 'PAUSE')) {
      game.togglePause();
      return;
    }
    if (pressed(e, 'SPEED_UP')) {
      game.setSpeed(Math.min(4, game.speed * 2));
      return;
    }
    if (pressed(e, 'SPEED_DOWN')) {
      game.setSpeed(Math.max(0.5, game.speed / 2));
      return;
    }
    if (pressed(e, 'STOP')) {
      this.stop();
      return;
    }
    for (let n = 1; n <= 5; n++)
      if (pressed(e, 'ABILITY_' + n)) {
        this.useAbilityAt(n);
        return;
      }
    if (pressed(e, 'SUPER_WEAPON')) {
      this.bar?.bWeapon?.click();
      return;
    }
    const armKey = ORDER_KEYS.find(([id]) => pressed(e, id))?.[1];
    if (armKey) {
      this.arm(this.armed === armKey ? null : armKey);
      return;
    }
    if (pressed(e, 'CAMERA_HOME')) {
      e.preventDefault();
      const st = this.player.station;
      if (st && !st.dead) {
        this.following = null;
        this.r.rig.x = st.x;
        this.r.rig.y = st.y;
        this.select([st]);
      }
      return;
    }
    const group = groupKey(e);
    if (group) {
      const n = group.n;
      if (group.assign) {
        e.preventDefault();
        this.groups.set(n, this.selection.slice());
        this.game.message(`Group ${n} set`);
      } else {
        const g = (this.groups.get(n) || []).filter(s => !s.dead);
        if (g.length) {
          const same = g.length === this.selection.length && g.every(s => this.selection.includes(s));
          this.select(g, false);
          if (same) {
            let x = 0,
              y = 0;
            for (const s of g) {
              x += s.x;
              y += s.y;
            }
            this.r.rig.x = x / g.length;
            this.r.rig.y = y / g.length;
          }
        }
      }
    }
  }

  mine() {
    return this.selection.filter(s => s.player === this.player && !s.dead);
  }

  pingTarget(e, hp, color) {
    const at = { x: e.x, y: e.y, z: e.isSquad ? (e.fighters[0] ? e.fighters[0].z : 40) : e.z };
    if (hp) hp.worldPos(at);
    this.pings.push({ x: at.x, y: at.y, z: at.z, t: 0, color, r: 50 });
  }

  voiceOf(list) {
    const s = list[0];
    return s ? (s.isSquad ? s.fighters[0]?.type : s.type) : null;
  }

  say(voice, ...keys) {
    if (!voice) return;
    for (const k of keys) {
      const ev = voice.str(k);
      if (ev && this.game.audio.play(ev)) return;
    }
  }

  sayMove(mine, x, y, attackMove) {
    const voice = this.voiceOf(mine);
    if (attackMove) return this.say(voice, 'SFXEvent_Attack');
    const inField = kind => this.game.world.fields?.some(f => f[kind] && (x - f.x) ** 2 + (y - f.y) ** 2 < f.r * f.r);
    const remark = inField('asteroid')
      ? voice?.str('SFXEvent_Move_Into_Asteroid_Field')
      : inField('nebula')
        ? voice?.str('SFXEvent_Move_Into_Nebula')
        : '';
    if (remark && this.game.audio.play(remark)) return;
    const u = mine[0];
    if (mine.length > 1) return this.say(voice, 'SFXEvent_Fleet_Move', 'SFXEvent_Group_Move', 'SFXEvent_Move');
    let d = Math.atan2(y - u.y, x - u.x) - u.heading;
    d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    if (d > 2.2 && !u.isSquad) return this.say(voice, 'SFXEvent_Move_Opposite', 'SFXEvent_Move');
    this.say(voice, 'SFXEvent_Move');
  }

  sayAttack(mine, hardpoint) {
    const voice = this.voiceOf(mine);
    if (voice && hardpoint) {
      const t = voice.tuples('SFXEvent_Attack_Hardpoint').find(x => x[0].toUpperCase() === hardpoint.kind);
      if (t && t[1] && this.game.audio.play(t[1])) return;
    }
    this.say(voice, 'SFXEvent_Attack');
  }

  stop() {
    const mine = this.mine();
    if (mine.length) this.game.command({ c: 'stop', u: ids(mine) });
    this.arm(null);
    this.say(this.voiceOf(mine.filter(s => s.isSquad || s.isMobile)), 'SFXEvent_Stop');
  }

  startTrack(e, whole) {
    this.following = e;
    (this.track ||= new TrackCam(this.r.dom, () => this.endTrack())).start(whole);
    if (!this.r.rig.free) this.trackPitch = this.r.rig.pitch;
    this.r.rig.free = true;
  }

  endTrack() {
    if (!this.direct) this.following = null;
    this.track?.stop();
    const rig = this.r?.rig;
    if (!rig?.free) return;
    rig.free = false;
    rig.z = 0;
    rig.pitch = this.trackPitch ?? rig.pitch;
    rig.tilt(0);
    rig.clamp();
  }

  toggleDirect() {
    if (this.direct) return this.releaseDirect();
    if (!globalThis.directControl) return;
    if (this.game.lock) {
      this.game.message('Direct control is not available in multiplayer', 'bad');
      return;
    }
    const e = this.selection.find(s => !s.dead && s.player === this.player && (s.isSquad ? s.fighters.length > 0 : s.isMobile));
    if (!e) {
      this.game.message('Select one of your ships or squadrons to take control of it', 'bad');
      return;
    }
    this.cancelPlacing();
    this.arm(null);
    e.setOrder({ kind: 'idle' });
    e.direct = {
      turn: 0,
      throttle: 0,
      firing: false,
      target: null,
      spot: {
        x: 0,
        y: 0,
        z: 0,
        dead: false,
        free: true,
        hitRadius: 0,
        heading: 0,
        speed: 0,
        sizeClass: '',
        player: { id: -1, team: { id: -1 } },
        type: { name: '', categories: () => [] }
      }
    };
    this.endTrack();
    this.direct = e;
    this.following = e;
    this.select([e]);
  }

  releaseDirect() {
    const e = this.direct;
    if (!e) return;
    e.direct = null;
    this.direct = null;
    this.following = null;
    this.fireHeld = false;
    this.r.chase?.exit();
  }

  toggleChase() {
    const C = (this.r.chase ||= new ChaseView(this.r.dom));
    C.onLost = () => C.exit();
    if (C.on) {
      C.exit();
      return;
    }
    const e = this.direct,
      lead = e.isSquad ? e.fighters.find(f => !f.dead) : e;
    let spread = 0;
    if (lead && e.isSquad) for (const f of e.fighters) if (!f.dead) spread = Math.max(spread, Math.hypot(f.x - lead.x, f.y - lead.y));
    if (lead) C.enter(lead.x, lead.y, lead.z, lead.hitRadius, lead.heading, spread * 1.6, lead.obj);
  }

  steerDirect() {
    const e = this.direct,
      D = e && e.direct;
    if (!D) return;
    if (e.dead || (e.isSquad && !e.fighters.length) || !globalThis.directControl) {
      this.releaseDirect();
      return;
    }
    const k = this.keys,
      m = this.mouse;
    D.turn = (held(k, 'SCROLL_RIGHT') ? 1 : 0) - (held(k, 'SCROLL_LEFT') ? 1 : 0);
    D.throttle = (held(k, 'SCROLL_UP') ? 1 : 0) - (held(k, 'SCROLL_DOWN') ? 1 : 0);
    const lead = e.isSquad ? e.fighters[0] : e,
      C = this.r.chase;
    if (C && C.on) {
      if (lead) C.setPivot(lead.x, lead.y, lead.z);
      const c = (this.centre ||= { x: 0, y: 0, z: 0 }),
        W = this.r.width / 2,
        H = this.r.height / 2;
      C.aimPoint(this.r.camera, lead ? lead.z : 0, C.dist + 3000, c);
      let t = null;
      const h = this.pick(W, H);
      if (h && !h.dead && h.player.id >= 0 && h.player.team !== this.player.team) {
        if (h.isSquad) {
          let bd = Infinity;
          for (const f of h.fighters) {
            const p = this.screenOf(f, (this.centreP ||= {})),
              d = (p.x - W) ** 2 + (p.y - H) ** 2;
            if (!f.dead && d < bd) {
              bd = d;
              t = f;
            }
          }
        } else t = h;
      }
      if (!t) {
        D.spot.x = c.x;
        D.spot.y = c.y;
        D.spot.z = c.z;
        t = D.spot;
      }
      D.target = t;
      D.firing = !!this.fireHeld;
      C.aim(this.world.directBears(e, t) ? 'in' : 'out');
      return;
    }
    const g = m.inside ? this.r.pickGround(m.x, m.y, undefined, lead ? lead.z : 0) : null;
    let t = null;
    const h = m.inside ? this.pick(m.x, m.y) : null;
    if (h && !h.dead && h.player.id >= 0 && h.player.team !== this.player.team) {
      if (h.isSquad) {
        let bd = Infinity;
        for (const f of h.fighters) {
          const d = g ? (f.x - g.x) ** 2 + (f.y - g.y) ** 2 : 0;
          if (!f.dead && d < bd) {
            bd = d;
            t = f;
          }
        }
      } else t = h;
    }
    if (!t && g) {
      D.spot.x = g.x;
      D.spot.y = g.y;
      D.spot.z = lead ? lead.z : 0;
      t = D.spot;
    }
    D.target = t;
    D.firing = !!this.fireHeld && !!t;
  }

  updateMoveDrag() {
    const md = this.moveDrag,
      m = this.mouse;
    md.movers = md.movers.filter(s => !s.dead && !(s.isSquad && !s.fighters.length));
    if (!md.movers.length) {
      this.endMoveDrag();
      return;
    }
    if (!md.on && Math.hypot(m.x - md.sx, m.y - md.sy) > 8) {
      md.on = true;
      md.ghosts = md.movers.map(s => this.r.makeGhost(ghostModels(s.type)));
    }
    if (!md.on) return;
    const g = this.r.pickGround(m.x, m.y);
    if (!g) return;
    const L = laidOut(
      md.movers.map(s => s.type),
      md.ghosts.map(gh => Math.max(40, gh.radius || 0)),
      md.perm,
      r => stretched(r, 30, md.a, g)
    );
    md.at = L.pts;
    md.face = L.facing;
    md.ghosts.forEach((gh, i) => gh.set(L.pts[i].x, L.pts[i].y, L.facing, true));
    showHand(
      L.seq.map(i => md.movers[i].type),
      m.x,
      m.y
    );
  }

  endMoveDrag() {
    const md = this.moveDrag;
    if (!md) return;
    for (const gh of md.ghosts) gh.remove();
    this.moveDrag = null;
    if (!this.placing) showHand(null);
  }

  finishMoveDrag(md, attackMove) {
    if (!md.at) return;
    const w = this.world,
      clampP = p => ({ x: Math.max(w.min.x, Math.min(w.max.x, p.x)), y: Math.max(w.min.y, Math.min(w.max.y, p.y)) });
    const p = md.movers.map((s, i) => {
      const q = clampP(md.at[i]);
      return [s.id, q.x, q.y];
    });
    this.game.command({ c: 'formmove', p, h: md.face, attack: !!attackMove });
    for (const [, x, y] of p) this.pings.push({ x, y, t: 0, color: attackMove ? '#ffb347' : '#6be675', r: 30 });
    this.sayMove(md.movers, p[0][1], p[0][2], attackMove);
  }

  startPlacing(type, dragging) {
    this.cancelPlacing();
    this.placing = { list: [], ghosts: [], slots: [], dragging, ok: false, x: 0, y: 0, heading: 0, turned: false, why: '' };
    this.addPlacing(type);
  }

  addPlacing(type) {
    const pl = this.placing;
    if (!pl || pl.dragging) {
      if (!pl || pl.list.length) return this.startPlacing(type, false);
    }
    const have = this.player.reinforcements.filter(t => t === type).length;
    if (pl.list.filter(t => t === type).length >= have) {
      this.game.audio.play('GUI_Bad_Sound');
      return;
    }
    pl.list.push(type);
    pl.ghosts.push(this.r.makeGhost(ghostModels(type)));
    pl.slots = formation(
      pl.ghosts.map(g => Math.max(40, g.radius || 0)),
      30
    );
    this.hudTimer = 0;
  }

  cancelPlacing() {
    if (!this.placing) return;
    for (const g of this.placing.ghosts) g.remove();
    this.placing = null;
    showHand(null);
  }

  updatePlacing() {
    const pl = this.placing;
    const g = this.r.pickGround(this.mouse.x, this.mouse.y);
    if (!g) {
      pl.ok = false;
      showHand(pl.dragging ? null : pl.list, this.mouse.x, this.mouse.y);
      return;
    }
    pl.x = g.x;
    pl.y = g.y;
    if (!pl.turned) {
      const st = this.player.station;
      const bx = st && !st.dead ? st.x : 0,
        by = st && !st.dead ? st.y : 0;
      const d = Math.hypot(g.x - bx, g.y - by);
      pl.heading = d > 200 ? Math.atan2(g.y - by, g.x - bx) : Math.atan2(-by, -bx);
    }
    let at = null,
      heading = pl.heading;
    const pr = pl.press,
      radii = pl.ghosts.map(gh => Math.max(40, gh.radius || 0));
    let L;
    if (pr && Math.hypot(this.mouse.x - pr.sx, this.mouse.y - pr.sy) > 8) {
      L = laidOut(pl.list, radii, pl.perm || 0, r => stretched(r, 30, pr, g));
      at = L.pts;
      if (globalThis.reinforceTurn !== false) heading = L.facing;
    } else {
      const c = pr || g;
      L = laidOut(pl.list, radii, pl.perm || 0, r => formation(r, 30).map(o => slotAt(o, c.x, c.y, pl.heading)));
      at = L.pts;
    }
    showHand(pl.dragging ? null : L.seq.map(i => pl.list[i]), this.mouse.x, this.mouse.y);
    pl.at = at;
    pl.face = heading;
    pl.why = '';
    pl.ok = true;
    pl.ghosts.forEach((gh, i) => {
      const p = at[i],
        why = this.world.cantReinforce(this.player, p.x, p.y) || '';
      if (why && !pl.why) pl.why = why;
      gh.set(p.x, p.y, heading, !why);
    });
    pl.ok = !pl.why;
  }

  turnPlacing(delta) {
    const pl = this.placing;
    if (pl.press) return;
    pl.turned = true;
    pl.heading += Math.sign(delta) * WHEEL_TURN;
  }

  finishPlacing(x, y) {
    const pl = this.placing;
    if (!pl) return;
    this.mouse.x = x;
    this.mouse.y = y;
    this.updatePlacing();
    if (!pl.ok) {
      this.game.message(pl.why || 'Cannot call reinforcements there', 'bad');
      this.game.audio.play('GUI_Bad_Sound');
      return;
    }
    let r = null;
    for (let i = 0; i < pl.list.length; i++) {
      const p = pl.at[i];
      r = this.game.command({ c: 'reinforce', type: pl.list[i].name, x: p.x, y: p.y, h: pl.face });
      if (r && r.why) return;
    }
    const one = pl.list.length === 1 && pl.list[0],
      left = one ? this.player.reinforcements.filter(t => t === one).length - (r ? 0 : 1) : 0;
    const more = left > 0 && this.keys.has('ShiftLeft');
    if (!more) this.cancelPlacing();
    this.hudTimer = 0;
  }

  refreshReinforcements() {
    const el = $('reinforce'),
      pool = this.player.reinforcements;
    const counts = new Map();
    for (const t of pool) counts.set(t, (counts.get(t) || 0) + 1);
    const sig = [...counts].map(([t, n]) => t.name + n).join();
    if (sig === this.reinSig) return;
    this.reinSig = sig;
    el.replaceChildren();
    if (!counts.size) return;
    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<span>Reinforcements</span><span>drag onto the map</span>';
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const [t, n] of counts) {
      const d = document.createElement('div');
      d.className = 'b';
      const url = iconFor(t);
      if (url) d.style.backgroundImage = `url(${url})`;
      else d.innerHTML = `<span class="label">${typeName(t)}</span>`;
      const c = document.createElement('span');
      c.className = 'n';
      c.textContent = n > 1 ? n : '';
      d.appendChild(c);
      d.title = typeName(t);
      d.onmousedown = ev => {
        if (ev.button === 0) {
          ev.preventDefault();
          if (globalThis.multiPlace === false) this.startPlacing(t, true);
          else this.reinPress = t;
        }
      };
      d.onmouseleave = ev => {
        if (this.reinPress === t && ev.buttons & 1) {
          this.reinPress = null;
          this.startPlacing(t, true);
        }
      };
      d.onmouseup = ev => {
        if (ev.button === 0 && this.reinPress === t) {
          this.reinPress = null;
          this.addPlacing(t);
        }
      };
      grid.appendChild(d);
    }
    el.append(head, grid);
  }

  useAbilityAt(n) {
    const kind = this.bar ? this.bar.abilityAt(n)?.kind : [...new Set(this.mine().flatMap(s => s.abilities.map(a => a.def.kind)))][n - 1];
    if (kind) this.useAbility(kind);
  }

  useAbility(kind = null) {
    const mine = this.mine();
    if (!kind) {
      for (const s of mine)
        if (s.abilities.length) {
          kind = s.abilities[0].def.kind;
          break;
        }
    }
    const users = mine.filter(s => s.abilityState(kind));
    if (!users.length) return;
    const def = users[0].abilityState(kind).def;
    const anyActive = users.some(s => s.abilityState(kind).active);
    const ready = s => {
      const st = s.abilityState(kind);
      return !st.active && !(st.cooldown > 0);
    };
    const turnOn = !anyActive || users.some(ready);
    if (def.target !== 'none' && turnOn) {
      this.arm(this.armed === 'ability:' + kind ? null : 'ability:' + kind);
      return;
    }
    const r = this.game.command({ c: 'ability', u: ids(users), kind, on: turnOn });
    if ((!r || r.ok) && !(turnOn ? def.sfxOn : def.sfxOff)) {
      const t = this.player.faction
        .tuples('SFXEvent_GUI_Toggle_Non_Hero_Ability_' + (turnOn ? 'On' : 'Off'))
        .find(x => x[0].toUpperCase() === kind);
      if (t && t[1]) this.game.audio.play(t[1]);
    }
    this.hudTimer = 0;
  }

  screenOf(s, out = {}) {
    const a = this.iconAt(s);
    return this.r.project(a.x, a.y, s.isSquad ? 40 : s.z, out);
  }

  layoutDogfights() {
    const w = this.world,
      C = 400,
      ox = w.min.x,
      oy = w.min.y;
    const at = (this.dfAt ||= new WeakMap()),
      cells = (this.dfCells ||= new Map()),
      want = (this.dfWant ||= new Map());
    for (const l of cells.values()) l.list.length = 0;
    want.clear();
    for (const s of w.squads) {
      const t = s.target;
      if (s.dead || s.hyper || !t || t.dead) {
        at.delete(s);
        continue;
      }
      let k = at.get(s);
      if (k && (s.x - k.x) ** 2 + (s.y - k.y) ** 2 > 80000) k = null;
      if (!k) {
        const r = Math.floor((t.y - oy) / C),
          sh = ((r & 1) * C) / 2,
          c = Math.floor((t.x - ox - sh) / C);
        k = { key: r * 65536 + c, x: ox + (c + 0.5) * C + sh, y: oy + (r + 0.5) * C };
        if ((s.x - k.x) ** 2 + (s.y - k.y) ** 2 > 80000) {
          at.delete(s);
          continue;
        }
        at.set(s, k);
      }
      let l = cells.get(k.key);
      if (!l) cells.set(k.key, (l = { x: k.x, y: k.y, list: [] }));
      l.list.push(s);
    }
    const P = (30 * this.r.height) / 768,
      c = (this._dfc ||= {});
    for (const [key, l] of cells) {
      const n = l.list.length;
      if (!n) {
        cells.delete(key);
        continue;
      }
      this.r.project(l.x, l.y, 40, c);
      if (c.behind) continue;
      const cols = Math.ceil(Math.sqrt(n)),
        x0 = c.x - (Math.min(n, cols) * P) / 2;
      l.list.sort((a, b) => a.id - b.id);
      l.list.forEach((s, i) => want.set(s, this.r.pickGround(x0 + (i % cols) * P, c.y - Math.floor(i / cols) * P, {}, 40)));
    }
  }

  iconAt(s) {
    if (!s.isSquad) return s;
    const want = this.dfWant?.get(s) || (s.mode === 'idle' && s.about?.cell ? s.about : s),
      now = this.world.time;
    const m = (this.icons ||= new WeakMap());
    let p = m.get(s);
    if (!p) {
      m.set(s, (p = { x: want.x, y: want.y, t: now }));
      return p;
    }
    if (s.hyper) {
      p.x = s.x;
      p.y = s.y;
      p.t = now;
      return p;
    }
    const dt = now - p.t;
    if (dt > 0) {
      p.t = now;
      const dx = want.x - p.x,
        dy = want.y - p.y,
        d = Math.hypot(dx, dy);
      const lead = s.fighters && s.fighters[0],
        step = 2 * Math.max(100, (lead && lead.maxSpeed) || 0) * dt;
      if (d <= step || dt > 2) {
        p.x = want.x;
        p.y = want.y;
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
    return p;
  }

  screenRadius(s, sp) {
    const a = this.iconAt(s),
      c = this.r.camera.position;
    const d = Math.hypot(c.x - a.x, c.y - a.y, c.z - (s.isSquad ? 40 : s.z));
    const k = this.r.height / (2 * Math.tan((this.r.camera.fov * Math.PI) / 360) * d);
    return Math.max(12, (s.isSquad ? 80 : s.visualRadius) * k);
  }

  pick(x, y) {
    let best = null,
      bd = Infinity;
    const p = {},
      all = this.world.selectablesInto((this.picking ||= []));
    for (const s of all) {
      if (s._iconFrame !== this.overlayFrame || s.dead) continue;
      const h = s._iconSize / 2 + 2;
      if (Math.abs(x - s._iconX) > h || Math.abs(y - s._iconY) > h) continue;
      const d = Math.hypot(x - s._iconX, y - s._iconY);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) return best;
    for (const s of all) {
      if (!this.world.canSee(this.player, s)) continue;
      this.screenOf(s, p);
      if (p.behind) continue;
      const r = this.screenRadius(s);
      let d = Math.hypot(p.x - x, p.y - y);
      if (d > r) {
        if (d > r * 4 || s.isSquad || !s.hpDriven || !this.hardpointAt(s, x, y, 26)) continue;
        d = r;
      }
      const score = d / r + r * 0.002;
      if (score < bd) {
        bd = score;
        best = s;
      }
    }
    return best;
  }

  arm(mode) {
    if (mode && mode !== 'special' && !mode.startsWith('ability:') && !this.mine().some(s => s.isSquad || s.isMobile || s.hasWeapons))
      mode = null;
    this.armed = mode;
    this.hudTimer = 0;
  }

  runArmed(x, y) {
    if (this.armed.startsWith('ability:')) return this.runAbility(this.armed.slice(8), x, y);
    if (this.armed === 'special') {
      const mine = (this.world.specialWeapons || []).filter(w => w.player === this.player),
        sw = mine.find(w => w.charge >= 0.99) || mine[0],
        hit = this.pick(x, y);
      if (!sw) return true;
      if (!hit || !sw.canTarget(hit)) {
        this.game.message('Not a valid target', 'bad');
        this.game.audio.play('GUI_Bad_Sound');
        return false;
      }
      const r = this.game.command({ c: 'special', t: hit.id });
      if (r && r.why) return true;
      this.pingTarget(hit, null, '#ff5a4d');
      return true;
    }
    const mine = this.mine().filter(s => s.isSquad || s.isMobile || s.hasWeapons);
    if (!mine.length) return true;
    const voice = mine[0].isSquad ? mine[0].fighters[0]?.type : mine[0].type;
    const hit = this.systemUnder(this.hover, x, y) || this.pick(x, y);
    const hostile = hit && hit.player.id >= 0 && hit.player.team !== this.player.team && !hit.isPad;
    if (this.armed === 'attack') {
      if (!hostile) {
        this.game.message('Select an enemy to attack', 'bad');
        return false;
      }
      const hp = this.hardpointAt(hit, x, y);
      this.game.command({ c: 'attack', u: ids(mine), t: hit.id, hp: hp && hit.hardpoints ? hit.hardpoints.indexOf(hp) : -1 });
      this.pingTarget(hit, hp, '#ff5a4d');
      this.sayAttack(mine, hp);
      return true;
    }
    if (this.armed === 'guard') {
      const friend = hit && hit.player.team === this.player.team && !hit.isPad && !mine.includes(hit) ? hit : null;
      const g = friend || this.r.pickGround(x, y);
      if (!g) return false;
      this.game.command({ c: 'guard', u: ids(mine), t: friend ? friend.id : 0, x: g.x, y: g.y });
      if (friend) this.pingTarget(friend, null, '#4fb3ff');
      else this.pings.push({ x: g.x, y: g.y, t: 0, color: '#4fb3ff', r: 50 });
      this.say(voice, 'SFXEvent_Guard', 'SFXEvent_Move');
      return true;
    }
    const g = this.r.pickGround(x, y);
    if (!g) return false;
    const w = this.world;
    g.x = Math.max(w.min.x, Math.min(w.max.x, g.x));
    g.y = Math.max(w.min.y, Math.min(w.max.y, g.y));
    const am = this.armed === 'attackmove',
      way = this.armed === 'waypoint';
    this.game.command({ c: 'move', u: ids(mine), x: g.x, y: g.y, attack: am, waypoint: way });
    this.pings.push({ x: g.x, y: g.y, t: 0, color: am ? '#ffb347' : way ? '#7fd4ff' : '#6be675', r: 40 });
    this.sayMove(mine, g.x, g.y, am);
    return true;
  }

  runAbility(kind, x, y) {
    const users = this.mine().filter(s => s.abilityState(kind));
    if (!users.length) return true;
    const def = users[0].abilityState(kind).def;
    let target;
    if (def.target === 'unit') {
      target = this.pick(x, y);
      if (!target || target.player.id < 0 || target.player.team === this.player.team || target.isPad) {
        this.game.message('Select an enemy target', 'bad');
        return false;
      }
    } else {
      const hit = this.pick(x, y);
      target = hit && !hit.isPad ? { x: hit.x, y: hit.y, z: hit.z } : this.r.pickGround(x, y);
      if (!target) return false;
    }
    const r = this.game.command(
      def.target === 'unit'
        ? { c: 'ability', u: ids(users), kind, on: true, t: target.id }
        : { c: 'ability', u: ids(users), kind, on: true, x: target.x, y: target.y, z: target.z || 0 }
    );
    if (r && !r.ok) return false;
    if (def.target === 'unit') this.pingTarget(target, null, '#ffd76a');
    else this.pings.push({ x: target.x, y: target.y, t: 0, color: '#ffd76a', r: 50 });
    if (kind === 'BARRAGE') this.say(this.voiceOf(users), 'SFXEvent_Barrage', 'SFXEvent_Attack');
    else if (def.target === 'unit') this.say(this.voiceOf(users), 'SFXEvent_Attack_With_Non_Hero_Ability', 'SFXEvent_Attack');
    this.hudTimer = 0;
    return true;
  }

  systemUnder(unit, x, y) {
    if (!unit || unit.dead || unit.isSquad || !unit.hpDriven || !this.world.canSee(this.player, unit)) return null;
    return this.hardpointAt(unit, x, y) ? unit : null;
  }

  amongHardpoints(unit, x, y, margin = 40) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    const w = {},
      p = {};
    this.screenOf(unit, p);
    if (!p.behind) {
      x0 = x1 = p.x;
      y0 = y1 = p.y;
    }
    for (const h of unit.hardpoints) {
      if (!h.alive || !h.targetable || !h.destroyable) continue;
      h.worldPos(w);
      this.r.project(w.x, w.y, w.z, p);
      if (p.behind) continue;
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return x >= x0 - margin && x <= x1 + margin && y >= y0 - margin && y <= y1 + margin;
  }

  hardpointAt(unit, x, y, reach = 20) {
    if (unit.isSquad || !unit.hpDriven) return null;
    let best = null,
      bd = reach;
    const w = {},
      p = {};
    for (const h of unit.hardpoints) {
      if (!h.alive || !h.targetable || !h.destroyable) continue;
      h.worldPos(w);
      this.r.project(w.x, w.y, w.z, p);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  canSelect(s) {
    const me = this.player;
    if (!s || s.dead || s.type.bool('Not_Really_Selectable')) return false;
    if (s.isPad) return s.padOwner === me;
    return s.player === me || (s.player.id >= 0 && s.player.team === me.team && s.type.bool('Is_Community_Property'));
  }

  select(list, add) {
    if (!add) for (const s of this.selection) s.selected = false;
    const next = add ? this.selection.slice() : [];
    for (const s of list) if (!next.includes(s)) next.push(s);
    this.selection = next;
    for (const s of next) s.selected = true;
    if (list.length && list[0].player === this.player) {
      const t = list[0].isSquad ? (list[0].fighters[0] ? list[0].fighters[0].type : list[0].type) : list[0].type;
      this.game.audio.play(t.str('SFXEvent_Select'));
    }
    this.selSig = '';
  }

  commandAt(x, y, attackMove, waypoint = false) {
    const mine = this.mine().filter(s => s.isSquad || s.isMobile || s.hasWeapons);
    if (!mine.length) return;
    const hit = this.systemUnder(this.hover, x, y) || this.pick(x, y) || (this.hover && !this.hover.dead ? this.hover : null);
    const voice = mine[0].isSquad ? mine[0].fighters[0]?.type : mine[0].type;
    if (hit && hit.player.team !== this.player.team && hit.player.id >= 0 && !hit.isPad) {
      const hp = this.hardpointAt(hit, x, y);
      this.game.command({ c: 'attack', u: ids(mine), t: hit.id, hp: hp && hit.hardpoints ? hit.hardpoints.indexOf(hp) : -1 });
      this.pingTarget(hit, hp, '#ff5a4d');
      this.sayAttack(mine, hp);
      return;
    }
    const g = this.r.pickGround(x, y);
    if (!g) return;
    const w = this.world;
    g.x = Math.max(w.min.x, Math.min(w.max.x, g.x));
    g.y = Math.max(w.min.y, Math.min(w.max.y, g.y));
    this.game.command({ c: 'move', u: ids(mine), x: g.x, y: g.y, attack: !!attackMove, waypoint: !!waypoint });
    this.pings.push({ x: g.x, y: g.y, t: 0, color: attackMove ? '#ffb347' : waypoint ? '#7fd4ff' : '#6be675', r: 40 });
    this.sayMove(mine, g.x, g.y, attackMove);
  }

  minimapClick(e) {
    if (this.game.controlsLocked) return;
    if (e.button === 0) this.following = null;
    const mm = $('minimap'),
      rect = mm.getBoundingClientRect();
    const w = this.world;
    const fx = (e.clientX - rect.left) / rect.width,
      fy = (e.clientY - rect.top) / rect.height;
    const x = w.min.x + fx * (w.max.x - w.min.x),
      y = w.max.y - fy * (w.max.y - w.min.y);
    const C = db.constants,
      mark = attack =>
        this.radar.event(
          C.str(attack ? 'GUI_Attack_Movement_Click_Radar_Event_Name' : 'GUI_Movement_Click_Radar_Event_Name') ||
            (attack ? 'Default_Attack_Click' : 'Default_Click'),
          x,
          y
        );
    const armed = e.button === 0 && ['attackmove', 'waypoint', 'guard', 'move'].includes(this.armed) ? this.armed : null;
    if (e.button === 2 || armed) {
      if (e.type === 'mousemove') {
        e.preventDefault();
        return;
      }
      const mine = this.mine().filter(s => s.isSquad || s.isMobile || s.hasWeapons);
      if (mine.length) {
        const attack = armed ? armed === 'attackmove' : e.ctrlKey;
        if (armed === 'guard') this.game.command({ c: 'guard', u: ids(mine), t: 0, x, y });
        else this.game.command({ c: 'move', u: ids(mine), x, y, attack: !!attack, waypoint: armed === 'waypoint' });
        this.pings.push({ x, y, t: 0, color: attack ? '#ffb347' : '#6be675', r: 40 });
        mark(attack);
        if (armed === 'guard') this.say(this.voiceOf(mine), 'SFXEvent_Guard', 'SFXEvent_Move');
        else this.sayMove(mine, x, y, attack);
      }
      if (armed && !e.shiftKey && armed !== 'waypoint') this.arm(null);
    } else {
      this.r.rig.x = x;
      this.r.rig.y = y;
      this.r.rig.clamp();
    }
    e.preventDefault();
  }

  waypointsUp() {
    return this.keys.has('AltLeft') || this.keys.has('AltRight') || this.armed === 'waypoint';
  }

  waypointPaths() {
    const out = (this._wpPaths ||= []);
    out.length = 0;
    if (!this.waypointsUp()) return out;
    for (const u of this.selection) {
      const o = u.order;
      if (u.dead || u.player !== this.player || !o || (o.kind !== 'move' && o.kind !== 'attackmove') || o.x === undefined) continue;
      const z = u.isSquad ? 40 : u.z || 0,
        pts = [
          { x: u.x, y: u.y, z, start: true },
          { x: o.x, y: o.y, z: 0 }
        ];
      for (const q of u.queue || [])
        if ((q.kind === 'move' || q.kind === 'attackmove') && q.x !== undefined) pts.push({ x: q.x, y: q.y, z: 0 });
      out.push(pts);
    }
    return out;
  }

  updateWaypointBeacons() {
    const pool = (this.beacons ||= []),
      paths = this.waypointPaths();
    let n = 0;
    const file = (this.beaconFile ??= db.constants.str('WaypointFlagModelName').trim());
    const data = file && getModelData(file);
    if (data)
      for (const pts of paths)
        for (const p of pts) {
          if (p.start) continue;
          let b = pool[n];
          if (!b) {
            const inst = buildModel(data);
            b = pool[n] = new THREE.Group();
            b.add(inst.root);
            this.r.scene.add(b);
            this.r.addIdle(inst, file);
          }
          b.position.set(p.x, p.y, p.z);
          b.visible = true;
          n++;
        }
    for (let i = n; i < pool.length; i++) pool[i].visible = false;
  }

  drawWaypointLines(g) {
    const paths = this._wpPaths;
    if (!paths || !paths.length) return;
    const a = (this._wa ||= {}),
      b = (this._wb ||= {});
    g.strokeStyle = 'rgba(255,128,128,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    for (const pts of paths)
      for (let i = 1; i < pts.length; i++) {
        this.r.project(pts[i - 1].x, pts[i - 1].y, pts[i - 1].z, a);
        this.r.project(pts[i].x, pts[i].y, pts[i].z, b);
        if (!a.behind && !b.behind) {
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
        }
      }
    g.stroke();
  }

  update(dt) {
    const rig = this.r.rig,
      k = this.keys;
    this.updateWaypointBeacons();
    const pan = rig.dist * 0.9 * dt;
    let px = 0,
      py = 0;
    if (held(k, 'SCROLL_LEFT')) px -= 1;
    if (held(k, 'SCROLL_RIGHT')) px += 1;
    if (held(k, 'SCROLL_UP')) py += 1;
    if (held(k, 'SCROLL_DOWN')) py -= 1;
    const m = this.mouse;
    if (m.inside && m.moved && !this.drag && !this.track?.on && document.hasFocus()) {
      const edge = 6;
      if (m.x < edge) px -= 1;
      else if (m.x > this.r.width - edge) px += 1;
      if (m.y < edge) py += 1;
      else if (m.y > this.r.height - edge) py -= 1;
    }
    if (this.direct) {
      px = py = 0;
      this.steerDirect();
    }
    (this.arcView ||= new ArcView(this.r.scene)).update(this.direct ? this.world.directArcs(this.direct, (this.arcs ||= [])) : NO_ARCS);
    const f = this.following;
    if (f && (f.dead || (f.isSquad && !f.fighters.length) || px || py || this.panDrag)) this.following = null;
    if (this.track?.on && this.following !== f) this.endTrack();
    else if (f && this.following) {
      const c = this.track?.on ? this.track.focus(f) : f;
      rig.x = c.x;
      rig.y = c.y;
      if (this.track?.on) rig.z = c.z;
    }
    if (px || py) rig.pan(px * pan, py * pan);
    if (held(k, 'ROTATE_LEFT')) rig.yaw -= dt * 1.2;
    if (held(k, 'ROTATE_RIGHT')) rig.yaw += dt * 1.2;
    if (held(k, 'TILT_UP')) rig.tilt(-dt * 0.9);
    if (held(k, 'TILT_DOWN')) rig.tilt(dt * 0.9);
    if (k.has('PageUp')) rig.dist *= Math.exp(-dt * 1.5);
    if (k.has('PageDown')) rig.dist *= Math.exp(dt * 1.5);
    rig.clamp();

    this.selection = this.selection.filter(s => !s.dead);
    const prev = this.hover;
    const onSystem = prev && m.inside && !this.drag?.box && !this.placing && this.systemUnder(prev, m.x, m.y);
    this.hover = onSystem ? prev : m.inside && !this.drag?.box && !this.placing ? this.pick(m.x, m.y) : null;
    if (
      !this.hover &&
      prev &&
      !prev.dead &&
      !prev.isSquad &&
      prev.hpDriven &&
      m.inside &&
      this.world.canSee(this.player, prev) &&
      this.amongHardpoints(prev, m.x, m.y)
    )
      this.hover = prev;
    const pointers = (this.pointers ||= new Pointers(this.r.dom));
    if (this.armed === 'special') {
      const mine = (this.world.specialWeapons || []).filter(w => w.player === this.player),
        sw = mine.find(w => w.charge >= 0.99) || mine[0];
      pointers.set(
        'POINTER_ATTACK_WITH_SPECIAL_WEAPON_' + (sw && this.hover && sw.canTarget(this.hover) ? Math.min(2, sw.action) : 'INVALID')
      );
    } else {
      const h = this.hover,
        sel = this.selection.filter(s => s.player === this.player && (s.isSquad || s.isMobile || s.hasWeapons));
      pointers.set(
        tacticalPointer({
          turning: !!this.turnDrag,
          direct: this.direct ? (this.world.directBears(this.direct, this.direct.direct?.target) ? 'in' : 'out') : null,
          box: this.drag?.box,
          armed: this.armed,
          placing: this.placing,
          hover: !h ? null : h.player === this.player ? 'own' : h.player.id >= 0 && h.player.team !== this.player.team ? 'enemy' : 'other',
          act: sel.length > 0,
          attack: sel.some(s => s.hasWeapons || (s.isSquad && s.fighters.some(f => !f.dead && f.hasWeapons))),
          force: k.has('ControlLeft') || k.has('ControlRight')
        })
      );
    }
    if (this.placing) this.updatePlacing();
    if (this.moveDrag) this.updateMoveDrag();
    this.r.updateSelection(this.game.endScreen || this.track?.on ? [] : this.selection, this.player);
    this.r.fogPlacing = !!this.placing;
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.15;
      this.refreshHud();
    }
  }

  drawPredictionPaths(g) {
    const me = this.player,
      p = (this._pp ||= {}),
      q = (this._pq ||= {});
    g.strokeStyle = 'rgba(128,255,128,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    for (const u of this.selection) {
      const o = u.order;
      if (
        u.dead ||
        u.isSquad ||
        u.isFighter ||
        !u.isMobile ||
        u.player !== me ||
        !o ||
        (o.kind !== 'move' && o.kind !== 'attackmove') ||
        o.x === undefined
      )
        continue;
      const r = u.route,
        pts = r && r.pts && (r.gx - o.x) ** 2 + (r.gy - o.y) ** 2 <= 150 * 150 ? r.pts : null;
      let lx = u.x,
        ly = u.y;
      this.r.project(lx, ly, u.z, p);
      const to = (x, y) => {
        if ((x - lx) ** 2 + (y - ly) ** 2 <= 400) return;
        this.r.project(x, y, u.z, q);
        if (!p.behind && !q.behind) {
          g.moveTo(p.x, p.y);
          g.lineTo(q.x, q.y);
        }
        lx = x;
        ly = y;
        p.x = q.x;
        p.y = q.y;
        p.behind = q.behind;
      };
      if (pts) for (let i = r.i; i < pts.length; i++) if (!pts[i].turn) to(pts[i].x, pts[i].y);
      to(o.x, o.y);
    }
    g.stroke();
  }

  drawOverlay(g) {
    if (this.game.endScreen) return;
    this.layoutDogfights();
    const p = {},
      me = this.player;
    const unit = Math.min(this.r.height / 768, this.r.width / 1024);
    const iconSize = Math.max(22, Math.round(28 * unit));
    const gb = this.grabBar(),
      grab = gb && gb.blank ? Math.max(16, Math.round(gb.blank.w * gb.scale * unit)) : 0;
    const grabHealth = gb && gb.health ? Math.max(10, Math.round(gb.health.w * gb.healthScale * unit)) : 0;
    this.overlayFrame = (this.overlayFrame || 0) + 1;
    for (const s of this.world.selectablesInto((this.shown ||= []))) {
      const enemy = s.player.team !== me.team && s.player.id >= 0;
      if (enemy && !this.world.canSee(me, s)) continue;
      this.screenOf(s, p);
      if (p.behind || p.x < -100 || p.x > this.r.width + 100 || p.y < -100 || p.y > this.r.height + 100) continue;
      const r = Math.min(this.screenRadius(s), 260);
      const size = grab ? grab : s.isSquad || s.isFighter ? Math.round(iconSize * 0.9) : iconSize;
      const hasIcon = unitIcon(s) && this.drawUnitIcon(g, s, p.x, p.y, enemy, size);
      const col =
        s.player.id < 0
          ? '#b9c4cf'
          : enemy
            ? '#ff5a4d'
            : s.player === me
              ? '#6be675'
              : (s.player._hex ||= '#' + s.player.color.getHexString());
      if (!this.r.rings && (s.selected || s === this.hover)) {
        g.strokeStyle = col;
        g.lineWidth = s.selected ? 1.6 : 1;
        g.globalAlpha = s.selected ? 0.95 : 0.6;
        const c = Math.max(5, r * 0.3);
        g.beginPath();
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1]
        ]) {
          g.moveTo(p.x + sx * r, p.y + sy * r - sy * c);
          g.lineTo(p.x + sx * r, p.y + sy * r);
          g.lineTo(p.x + sx * r - sx * c, p.y + sy * r);
        }
        g.stroke();
        g.globalAlpha = 1;
      }
      if (!s.isPad) {
        const w = hasIcon ? grabHealth || size : Math.max(26, Math.min(120, r * 1.5)),
          x = p.x - w / 2,
          y = hasIcon ? p.y + size / 2 + 9 : p.y - r - 9;
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(x - 1, y - 1, w + 2, 5);
        const f = s.healthFrac;
        g.fillStyle = f > 0.5 ? '#5fe067' : f > 0.25 ? '#f2c744' : '#ff5a4d';
        g.fillRect(x, y, w * f, 3);
        if (!enemy && s.player.id >= 0) {
          const a = shownAbility(s.abilities),
            name = a && abilityIconName(a.def.kind, a.def.icon),
            rect = name && iconCanvasRect(name);
          if (rect) {
            const z = Math.round(size * 0.8),
              top = hasIcon ? p.y - size / 2 - z - 3 : y - z - 8;
            g.drawImage(iconAtlas(), rect.x, rect.y, rect.w, rect.h, Math.round(p.x - z / 2), Math.round(top), z, z);
          }
        }
        if (hasIcon && s.carrier && !enemy && s.player.id >= 0) {
          const rect = iconCanvasRect('i_garrison_flag.tga');
          if (rect) {
            const k = size / 28,
              fw = Math.round(rect.w * k),
              fh = Math.round(rect.h * k);
            g.drawImage(iconAtlas(), rect.x, rect.y, rect.w, rect.h, Math.round(p.x + size / 2 + 1), Math.round(y + 3 - fh), fw, fh);
          }
        }
        if (!s.isSquad && s.maxShield > 0) {
          g.fillStyle = 'rgba(0,0,0,0.6)';
          g.fillRect(x - 1, y - 6, w + 2, 4);
          g.fillStyle = '#4fb3ff';
          g.fillRect(x, y - 5, w * Math.max(0, s.shield / s.maxShield), 2);
        }
        if (s.construction) {
          g.fillStyle = 'rgba(0,0,0,0.6)';
          g.fillRect(x - 1, y + 5, w + 2, 4);
          g.fillStyle = '#ffd76a';
          g.fillRect(x, y + 6, w * (1 - s.construction.left / s.construction.total), 2);
        }
        if (s === this.hover && this.game.setup.net && s.player.id >= 0 && s.player !== me) {
          const ty = hasIcon ? p.y - size / 2 - 5 : y - 10;
          g.font = 'bold 12px "Segoe UI", sans-serif';
          g.textAlign = 'center';
          const tw = g.measureText(s.player.name).width;
          g.fillStyle = 'rgba(0,0,0,0.7)';
          g.fillRect(p.x - tw / 2 - 4, ty - 12, tw + 8, 16);
          g.fillStyle = s.player._hex ||= '#' + s.player.color.getHexString();
          g.fillText(s.player.name, p.x, ty);
        }
      }
    }
    if ((this.predictionPaths ??= db.constants.bool('ShouldDisplayPredictionPaths', false))) this.drawPredictionPaths(g);
    this.drawWaypointLines(g);
    for (const u of this.world.units) {
      if (u.dead || !u.capture || u.padChild) continue;
      this.r.project(u.x, u.y, u.z, p);
      if (p.behind) continue;
      const owner = u.isPad ? u.padOwner : u.player.id >= 0 ? u.player : null;
      const c = u.capture;
      g.lineWidth = 2;
      if (owner) {
        g.strokeStyle = '#' + owner.color.getHexString();
        g.beginPath();
        g.arc(p.x, p.y, 15, 0, 6.283);
        g.stroke();
      }
      if (globalThis.showCaptureBars && c.by && c.by !== owner && c.progress > 0 && c.progress < c.time) {
        g.strokeStyle = '#' + c.by.color.getHexString();
        g.beginPath();
        g.arc(p.x, p.y, 19, -1.57, -1.57 + (6.283 * c.progress) / c.time);
        g.stroke();
      }
    }
    let n = 0;
    for (const pg of this.pings) {
      pg.t += 0.016;
      if (pg.t > 0.6) continue;
      this.r.project(pg.x, pg.y, pg.z || 0, p);
      g.strokeStyle = pg.color;
      g.globalAlpha = 1 - pg.t / 0.6;
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(p.x, p.y, 8 + pg.t * 40, (8 + pg.t * 40) * 0.6, 0, 0, 6.283);
      g.stroke();
      this.pings[n++] = pg;
    }
    this.pings.length = n;
    g.globalAlpha = 1;
    if (this.drag && this.drag.box) {
      const d = this.drag;
      g.strokeStyle = '#6be675';
      g.fillStyle = 'rgba(107,230,117,0.08)';
      g.lineWidth = 1;
      g.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
      g.strokeRect(d.x0 + 0.5, d.y0 + 0.5, d.x1 - d.x0, d.y1 - d.y0);
    }
    const hv = this.hover;
    const tracked = new Set();
    for (const s of this.selection)
      if (!s.isSquad && s.player === me && s.targetHp && s.targetHp.alive && !s.targetHp.unit.dead) tracked.add(s.targetHp);
    const drawHp = (h, focus, hostile, isTracked) => {
      const w = {};
      h.worldPos(w);
      this.r.project(w.x, w.y, w.z, p);
      if (p.behind) return;
      const color = hostile ? '#ff5a4d' : '#6be675';
      const img = reticle(h.kind, isTracked || focus, color);
      const s = focus ? 38 : isTracked ? 34 : 26;
      if (img) {
        g.globalAlpha = focus || isTracked ? 1 : 0.85;
        g.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
        g.globalAlpha = 1;
      } else {
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.strokeRect(p.x - s / 3, p.y - s / 3, s / 1.5, s / 1.5);
      }
      const f = h.health / h.maxHealth,
        bw = s * 0.8;
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(p.x - bw / 2 - 1, p.y + s / 2, bw + 2, 4);
      g.fillStyle = f > 0.5 ? '#5fe067' : f > 0.25 ? '#f2c744' : '#ff5a4d';
      g.fillRect(p.x - bw / 2, p.y + s / 2 + 1, bw * f, 2);
      if (focus) {
        g.font = 'bold 12px "Segoe UI", sans-serif';
        g.textAlign = 'center';
        const label = `${db.t(h.def.str('Tooltip_Text')) || h.kind.replace('HARD_POINT_', '').replace(/_/g, ' ').toLowerCase()} ${Math.round(100 * f)}%`;
        g.fillStyle = 'rgba(0,0,0,0.7)';
        g.fillRect(p.x - g.measureText(label).width / 2 - 4, p.y - s / 2 - 19, g.measureText(label).width + 8, 16);
        g.fillStyle = '#fff';
        g.fillText(label, p.x, p.y - s / 2 - 7);
      }
    };
    if (hv && !hv.isSquad && hv.hpDriven && this.world.canSee(me, hv)) {
      const hostile = hv.player.team !== me.team && hv.player.id >= 0;
      const focus = this.hardpointAt(hv, this.mouse.x, this.mouse.y);
      for (const h of hv.hardpoints) if (h.alive && h.targetable && h.destroyable && h !== focus) drawHp(h, false, hostile, tracked.has(h));
      if (focus) drawHp(focus, true, hostile, tracked.has(focus));
      for (const h of hv.hardpoints) tracked.delete(h);
    }
    for (const h of tracked) drawHp(h, false, true, true);
    if (this.armed && this.mouse.inside) {
      g.font = '12px "Segoe UI", sans-serif';
      g.textAlign = 'left';
      g.fillStyle = '#ffd76a';
      const ab = this.armed.startsWith('ability:')
        ? this.mine()
            .map(s => s.abilityState(this.armed.slice(8)))
            .find(Boolean)
        : null;
      g.fillText(
        ab
          ? ab.def.label
          : { move: 'Move', attack: 'Attack', attackmove: 'Attack move', guard: 'Guard', waypoint: 'Waypoint' }[this.armed] || '',
        this.mouse.x + 18,
        this.mouse.y + 20
      );
    }
    if (this.direct) {
      g.font = '13px "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.fillStyle = '#ffd76a';
      const msg = `Direct control: W A S D to steer, hold the left button to fire, ${keyName(keysOf('DIRECT_VIEW')[0] || null)} for the view behind it, V or Esc to let go`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.strokeText(msg, this.r.width / 2, 64);
      g.fillText(msg, this.r.width / 2, 64);
    }
    if (this.placing && this.placing.why && this.mouse.inside) {
      g.font = '12px "Segoe UI", sans-serif';
      g.textAlign = 'left';
      g.fillStyle = '#ff8a7a';
      g.fillText(this.placing.why, this.mouse.x + 18, this.mouse.y + 4);
    }
    if (this.hover && this.hover.player !== me) {
      g.font = '12px "Segoe UI", sans-serif';
      g.textAlign = 'left';
      g.fillStyle = '#d7e6f5';
      g.fillText(this.hover.name, this.mouse.x + 16, this.mouse.y + 4);
    }
  }

  grabBar() {
    if (this._grab !== undefined) return this._grab;
    const c = this.game.hudAssets?.comps?.get('ST_GRAB_BAR'),
      tex = k => (c?.val(k) || '').trim().split(/\s+/).filter(Boolean)[0] || '';
    const rgba = (c?.val('Color') || '')
        .trim()
        .split(/[\s,]+/)
        .map(Number),
      hb = this.game.hudAssets?.comps?.get('ST_HEALTH_BAR');
    const health = hb && iconCanvasRect((hb.val('Bar_Texture_Name') || '').trim().split(/\s+/)[0] || '');
    return (this._grab = c
      ? {
          blank: iconCanvasRect(tex('Blank_Texture_Name')),
          selected: iconCanvasRect(tex('Selected_Texture_Name')),
          over: iconCanvasRect(tex('Mouse_Over_Texture_Name')),
          scale: c.num('Scale', 1),
          alpha: rgba.length >= 4 && Number.isFinite(rgba[3]) ? rgba[3] / 255 : 1,
          health,
          healthScale: hb ? hb.num('Scale', 1) : 1
        }
      : null);
  }

  drawUnitIcon(g, s, x, y, enemy, size) {
    const rect = iconCanvasRect((s._iconName ??= iconNameFor(s.type) || ''));
    if (!rect) return false;
    const ix = Math.round(x - size / 2),
      iy = Math.round(y - size / 2);
    s._iconX = x;
    s._iconY = y;
    s._iconSize = size;
    s._iconFrame = this.overlayFrame;
    const selected = s.selected && !enemy;
    const alpha = (s.isSquad ? s.fighters[0]?.cloaked : s.cloaked) ? 0.4 : s === this.hover || selected ? 1 : 0.9;
    const color = s.player.id < 0 ? '#9aa7b4' : (s.player._hex ||= '#' + s.player.color.getHexString());
    const mode = selected ? 2 : s === this.hover ? 1 : 0,
      pad = 12;
    const seen = (this.iconSeen ||= new WeakMap()).get(s);
    let stamp =
      seen &&
      seen.stamp &&
      seen.color === color &&
      seen.size === size &&
      seen.mode === mode &&
      seen.alpha === alpha &&
      seen.name === s._iconName &&
      seen.gen === this.stampGen
        ? seen.stamp
        : null;
    if (!stamp) stamp = this.iconStamp(s._iconName, rect, color, size, mode, alpha, selected, pad, s);
    g.drawImage(stamp, ix - pad, iy - pad, size + pad * 2, size + pad * 2);
    return true;
  }

  iconStamp(name, rect, color, size, mode, alpha, selected, pad, s) {
    const key = name + '|' + color + '|' + size + '|' + mode + '|' + alpha;
    const stamps = this.iconStamps || (this.iconStamps = new Map());
    let stamp = stamps.get(key);
    if (!stamp) {
      const pr = Math.min(devicePixelRatio, 2),
        dim = size + pad * 2;
      stamp = document.createElement('canvas');
      stamp.width = Math.ceil(dim * pr);
      stamp.height = Math.ceil(dim * pr);
      const c = stamp.getContext('2d');
      c.scale(pr, pr);
      const art = (r, x, y, w, h, ctx = c) => ctx.drawImage(iconAtlas(), r.x, r.y, r.w, r.h, x, y, w, h);
      const bar = this.grabBar();
      const tinted = (r, inset = 0) => {
        const n = size - inset * 2;
        const t = document.createElement('canvas');
        t.width = t.height = Math.ceil(n * pr);
        const tc = t.getContext('2d');
        tc.scale(pr, pr);
        art(r, 0, 0, n, n, tc);
        tc.globalCompositeOperation = 'multiply';
        tc.fillStyle = color;
        tc.fillRect(0, 0, n, n);
        tc.globalCompositeOperation = 'destination-in';
        art(r, 0, 0, n, n, tc);
        c.drawImage(t, pad + inset, pad + inset, n, n);
      };
      c.globalAlpha = alpha * (bar ? bar.alpha : 1);
      if (bar) {
        if (bar.blank) tinted(bar.blank);
        const inset = Math.round((size * 7) / 60);
        tinted(rect, inset);
      } else {
        c.fillStyle = 'rgba(4,10,20,0.55)';
        c.fillRect(pad, pad, size, size);
        c.lineWidth = 1.75;
        c.strokeStyle = color;
        c.beginPath();
        c.roundRect(pad - 0.5, pad - 0.5, size + 1, size + 1, 3.5);
        c.stroke();
        art(rect, pad, pad, size, size);
      }
      c.globalAlpha = 1;
      const top = bar && (mode === 2 ? bar.selected : mode === 1 ? bar.over : null);
      if (top) art(top, pad, pad, size, size);
      else if (mode && !bar) {
        c.lineWidth = 3;
        c.strokeStyle = mode === 2 ? '#ffd421' : color;
        c.beginPath();
        c.roundRect(pad - 1.5, pad - 1.5, size + 3, size + 3, 4.5);
        c.stroke();
      }
      if (stamps.size > 400) {
        stamps.clear();
        this.stampGen = (this.stampGen || 0) + 1;
      }
      stamps.set(key, stamp);
    }
    let seen = this.iconSeen.get(s);
    if (!seen) this.iconSeen.set(s, (seen = {}));
    seen.stamp = stamp;
    seen.color = color;
    seen.size = size;
    seen.mode = mode;
    seen.alpha = alpha;
    seen.name = name;
    seen.gen = this.stampGen;
    return stamp;
  }

  refreshHud() {
    const p = this.player,
      w = this.world;
    $('credits').textContent = Math.floor(p.credits).toLocaleString();
    $('pop').textContent = `${p.pop}/${p.popCap}`;
    $('clock').textContent = fmtTime(w.time);
    $('speed').textContent = this.game.paused ? 'PAUSED' : this.game.speed !== 1 ? this.game.speed + '×' : '';
    let inc = 0;
    for (const u of w.units) if (!u.dead && u.player.team === p.team && u.income) inc += (u.income.value / u.income.interval) * 60;
    $('income').textContent = inc ? `+${Math.round(inc)}/min` : '';
    this.drawMinimap();
    if (this.bar) {
      this.bar.refresh();
      return;
    }
    this.refreshReinforcements();
    this.refreshQueue();
    this.refreshSelection();
    this.refreshBuild();
  }

  refreshSelection() {
    const el = $('selection'),
      sel = this.selection,
      me = this.player;
    if (!sel.length) {
      if (this.selSig || el.firstChild) {
        el.replaceChildren();
        this.selSig = '';
      }
      return;
    }
    const one = sel.length === 1 ? sel[0] : null;
    const kinds = new Map();
    for (const s of sel)
      if (s.player === me)
        for (const st of s.abilities) {
          const k = st.def.kind;
          if (!kinds.has(k)) kinds.set(k, []);
          kinds.get(k).push(s);
        }
    const canCommand = sel.some(s => s.player === me && (s.isSquad || s.isMobile));
    const sig = sel.map(s => s.id).join(',') + '|' + [...kinds.keys()].join() + '|' + canCommand;
    if (sig !== this.selSig) {
      this.selSig = sig;
      el.replaceChildren();
      const title = document.createElement('div');
      title.className = 'title';
      const sub = document.createElement('div');
      sub.className = 'sub';
      el.append(title, sub);
      const row = document.createElement('div');
      row.className = 'selrow';
      const cards = document.createElement('div');
      cards.className = 'icons';
      for (const s of sel.slice(0, 36)) {
        const d = document.createElement('div');
        d.className = 'u';
        const url = iconFor(s.type);
        if (url) d.style.backgroundImage = `url(${url})`;
        d.title = s.name;
        d.innerHTML = '<b></b><i></i>';
        d.onclick = ev => {
          if (ev.ctrlKey || ev.shiftKey)
            this.select(
              this.selection.filter(x => x !== s),
              false
            );
          else this.select([s], false);
        };
        d.ondblclick = () => {
          this.r.rig.x = s.x;
          this.r.rig.y = s.y;
        };
        d._s = s;
        cards.appendChild(d);
      }
      const abil = document.createElement('div');
      abil.className = 'abilities';
      for (const [kind, units] of kinds) {
        const b = document.createElement('button');
        b.className = 'ab';
        const def = units[0].abilityState(kind).def;
        const url = abilityIcon(kind, def.icon);
        if (url) b.style.backgroundImage = `url(${url})`;
        b.innerHTML = '<span></span>';
        const n = [...kinds.keys()].indexOf(kind) + 1;
        b.title =
          (n <= 5 ? withKey(def.label, 'ABILITY_' + n) : def.label) +
          (def.target === 'unit' ? ' — then click an enemy' : def.target === 'point' ? ' — then click a location' : '') +
          (def.recharge ? ` · ${Math.round(def.recharge)}s recharge` : '');
        b.onclick = () => this.useAbility(kind);
        b._kind = kind;
        abil.appendChild(b);
      }
      const cmds = document.createElement('div');
      cmds.className = 'commands';
      if (canCommand) {
        const COMMANDS = [
          ['move', 'i_button_command_bar_move.tga', withKey('Move', 'MOVE') + ' — go there, ignoring enemies on the way'],
          ['attack', 'i_button_command_bar_attack.tga', withKey('Attack', 'ATTACK') + ' — attack the enemy you click'],
          [
            'attackmove',
            'i_button_command_bar_attack_move.tga',
            withKey('Attack move', 'ATTACK_MOVE') + ' — go there, engaging enemies on the way'
          ],
          [
            'guard',
            'i_button_command_bar_guard.tga',
            withKey('Guard', 'GUARD') + ' — escort the friendly unit you click, or hold the clicked position'
          ],
          ['stop', 'i_button_command_bar_stop.tga', withKey('Stop', 'STOP')]
        ];
        for (const [mode, icon, tip] of COMMANDS) {
          const b = document.createElement('button');
          b.className = 'ab cmd';
          const url = iconUrl(icon);
          if (url) b.style.backgroundImage = `url(${url})`;
          else b.textContent = mode;
          b.title = tip;
          b.onclick = () => {
            if (mode === 'stop') this.stop();
            else this.arm(this.armed === mode ? null : mode);
          };
          b._mode = mode;
          cmds.appendChild(b);
        }
      }
      row.append(cmds, abil);
      el.append(cards, row);
      if (one) {
        const hps = document.createElement('div');
        hps.className = 'hps';
        el.appendChild(hps);
      }
      this.selTitle = title;
      this.selSub = sub;
    }
    for (const d of el.querySelectorAll('.u')) {
      const s = d._s;
      d.lastChild.style.width = 100 * s.healthFrac + '%';
      d.firstChild.style.width = (!s.isSquad && s.maxShield > 0 ? (100 * s.shield) / s.maxShield : 0) + '%';
      d.classList.toggle(
        'active',
        s.abilities.some(st => st.active)
      );
    }
    for (const b of el.querySelectorAll('.cmd')) b.classList.toggle('on', b._mode === this.armed);
    for (const b of el.querySelectorAll('.ab:not(.cmd)')) {
      const units = (kinds.get(b._kind) || []).filter(s => !s.dead);
      if (!units.length) continue;
      const states = units.map(s => s.abilityState(b._kind)).filter(Boolean);
      if (!states.length) continue;
      const d = states[0].def;
      const active = states.some(a => a.active),
        ready = states.some(a => !a.active && a.cooldown <= 0);
      b.classList.toggle('on', active || this.armed === 'ability:' + b._kind);
      b.classList.toggle('cool', !active && !ready);
      b.firstChild.textContent = active
        ? d.duration
          ? Math.ceil(Math.max(...states.map(a => a.timer)))
          : 'ON'
        : ready
          ? ''
          : Math.ceil(Math.min(...states.map(a => a.cooldown)));
    }
    if (one) {
      const who = pl => (pl === me ? pl.factionName : `${pl.name} · ${pl.factionName}`);
      const owner = one.player.id < 0 ? (one.isPad && one.padOwner ? who(one.padOwner) : 'Neutral') : who(one.player);
      const hasShield = !one.isSquad && one.maxShield > 0;
      this.selTitle.textContent = one.name;
      let sub = owner;
      if (one.isSquad) sub += ` · ${one.fighters.length} craft`;
      else if (!one.isPad)
        sub +=
          ` · Hull ${Math.ceil(one.health)}/${Math.ceil(one.maxHealth)}` +
          (hasShield ? ` · Shields ${Math.ceil(one.shield)}/${Math.ceil(one.maxShield)}` : '');
      if (one.construction) sub += ` · Building ${Math.round(100 * (1 - one.construction.left / one.construction.total))}%`;
      this.selSub.textContent = sub;
      const hps = el.querySelector('.hps');
      if (!one.isSquad && one.hardpoints.length) {
        const list = one.hardpoints.filter(h => h.destroyable);
        if (hps.childElementCount !== list.length) {
          hps.replaceChildren(
            ...list.map(h => {
              const sp = document.createElement('span');
              sp.innerHTML = '<em></em><b></b>';
              sp.firstChild.textContent =
                db.t(h.def.str('Tooltip_Text')) || h.kind.replace('HARD_POINT_', '').replace(/_/g, ' ').toLowerCase();
              sp.firstChild.style.fontStyle = 'normal';
              return sp;
            })
          );
        }
        list.forEach((h, i) => {
          const sp = hps.children[i];
          sp.className = h.alive ? '' : 'dead';
          sp.lastChild.textContent = h.alive ? Math.round((100 * h.health) / h.maxHealth) + '%' : '—';
        });
      }
    } else {
      const mine = sel.filter(s => s.player === me).length;
      this.selTitle.textContent = `${sel.length} units selected`;
      this.selSub.textContent = mine === sel.length ? 'Click a card to select it · Ctrl-click to remove' : '';
    }
  }

  builder() {
    const sel = this.selection.length === 1 ? this.selection[0] : null;
    if (sel && !sel.isSquad && !sel.construction) {
      if (sel.isPad && !sel.padChild) return sel;
      if (this.world.buildOptions(sel, this.player).length) return sel;
    }
    const st = this.player.station;
    return st && !st.dead ? st : null;
  }

  refreshBuild() {
    const el = $('build'),
      b = this.builder(),
      w = this.world,
      p = this.player;
    if (!b) {
      el.replaceChildren();
      this.buildSig = '';
      return;
    }
    const list = w.buildOptions(b, p);
    const queues = w.queuesOf(b, p);
    const sig = b.id + '|' + list.map(t => t.name).join() + '|' + (b.isPad ? b.padOwner === p : '');
    if (sig !== this.buildSig) {
      this.buildSig = sig;
      el.replaceChildren();
      const head = document.createElement('div');
      head.className = 'head';
      head.innerHTML = '<span></span><span></span>';
      head.firstChild.textContent = b.name;
      if (b.isPad && b.padOwner !== p) head.lastChild.textContent = 'Move ships here to take control';
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const t of list) {
        const d = document.createElement('div');
        d.className = 'b';
        const url = iconFor(t);
        if (url) d.style.backgroundImage = `url(${url})`;
        else d.innerHTML = `<span class="label">${typeName(t)}</span>`;
        const cost = document.createElement('span');
        cost.className = 'cost';
        cost.textContent = buildCost(t);
        const n = document.createElement('span');
        n.className = 'n';
        d.append(cost, n);
        d._t = t;
        d.onclick = ev => {
          const r = this.game.command({ c: 'build', b: b.id, type: t.name, n: ev.shiftKey ? 5 : 1 });
          if (!(r && r.why)) this.game.audio.play('GUI_Button_Press_2_SFX');
          this.hudTimer = 0;
        };
        d.onmouseenter = () => this.showTip(d, t, b);
        d.onmouseleave = () => $('tooltip').classList.add('hidden');
        grid.appendChild(d);
      }
      el.append(head, grid);
    }
    for (const d of el.querySelectorAll('.grid .b')) {
      const t = d._t,
        why = w.cantBuild(b, t, p);
      const done = isUpgradeType(t) && p.upgrades.has(t.name.toUpperCase());
      d.classList.toggle('off', !!why && !done);
      d.classList.toggle('done', done);
      let q = 0;
      for (const [, items] of queues) for (const it of items) if (it.type === t) q++;
      d.querySelector('.n').textContent = q || '';
    }
  }

  refreshQueue() {
    const el = $('queue'),
      w = this.world,
      p = this.player;
    const items = [];
    for (const u of w.units) {
      if (u.dead || !u.buildQueues.size) continue;
      for (const [name, q] of w.queuesOf(u, p)) q.forEach((it, i) => items.push({ u, name, it, i }));
    }
    const sig = items.map(x => x.u.id + x.name + x.it.type.name).join();
    if (sig !== this.queueSig) {
      this.queueSig = sig;
      el.replaceChildren();
      if (!items.length) return;
      const head = document.createElement('div');
      head.className = 'head';
      const research = items.filter(x => isUpgradeType(x.it.type)).length,
        recruit = items.length - research;
      head.innerHTML = '<span></span><span>click to cancel</span>';
      head.firstChild.textContent = [recruit ? `Recruitment ${recruit}` : '', research ? `Research ${research}` : '']
        .filter(Boolean)
        .join(' · ');
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const x of items) {
        const d = document.createElement('div');
        d.className = 'b' + (isUpgradeType(x.it.type) ? ' research' : '');
        const url = iconFor(x.it.type);
        if (url) d.style.backgroundImage = `url(${url})`;
        else d.innerHTML = `<span class="label">${typeName(x.it.type)}</span>`;
        const prog = document.createElement('span');
        prog.className = 'prog';
        const t = document.createElement('span');
        t.className = 'cost';
        d.append(prog, t);
        d.title = typeName(x.it.type);
        d.onclick = () => {
          this.game.command({ c: 'cancel', b: x.u.id, q: x.name, i: x.u.buildQueues.get(x.name).indexOf(x.it), type: x.it.type.name });
          this.hudTimer = 0;
        };
        d._x = x;
        grid.appendChild(d);
      }
      el.append(head, grid);
    }
    for (const d of el.querySelectorAll('.b')) {
      const it = d._x.it,
        active = d._x.u.buildQueues.get(d._x.name)?.[0] === it;
      d.querySelector('.prog').style.height = 100 * (1 - it.left / it.total) + '%';
      d.querySelector('.cost').textContent = active ? Math.ceil(it.left) + 's' : '';
      d.classList.toggle('waiting', !active);
    }
  }

  showTip(anchor, type, builder) {
    const tip = $('tooltip');
    const why = this.world.cantBuild(builder, type, this.player);
    const pop = spacePop(type);
    tip.innerHTML = `<b></b><br><span class="c">${buildCost(type)} credits</span> · ${Math.round(buildTime(type))}s${pop ? ` · ${pop} pop` : ''}<div class="w"></div><p></p>`;
    tip.querySelector('b').textContent = typeName(type);
    tip.querySelector('.w').textContent = why && !(isUpgradeType(type) && this.player.upgrades.has(type.name.toUpperCase())) ? why : '';
    tip.querySelector('p').textContent = describe(type).slice(0, 420);
    tip.classList.remove('hidden');
    const r = anchor.getBoundingClientRect(),
      tr = tip.getBoundingClientRect();
    tip.style.left = Math.max(4, Math.min(innerWidth - tr.width - 4, r.left + r.width / 2 - tr.width / 2)) + 'px';
    tip.style.top = Math.max(4, r.top - tr.height - 8) + 'px';
  }

  drawMinimap() {
    const now = performance.now(),
      dt = Math.min(0.5, (now - (this.radarAt || now)) / 1000);
    this.radarAt = now;
    this.radar.draw($('minimap'), this, dt * (this.game.paused ? 0 : this.game.speed || 1));
  }
}
