import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadModel, buildModel } from '../model.js';
import { loadALO } from '../alo.js';
import { loadALA, animName, AnimState, knownAnimations } from '../ala.js';
import { findFiles } from '../vfs.js';
import { heightAt, CELL, paveTerrain } from './terrain.js';
import { TERRAIN } from './landtables.js';
import { LandPaths } from './landpath.js';
import { POSE_MARGIN } from './landinstances.js';
import { cachedPose, settlePose } from './posecache.js';

import { equip, tickBase, shieldStops, ungarrison, hostOf, specialAttack, looks } from './landbase.js';
import { landAbilities, useAbility, abilityBlocked, refreshMods, tickAbilities } from './landabilities.js';
import { tickClashes } from './landclash.js';
import { BountyBook, bountyValue } from './bounty.js';
import { simRandom } from './simrandom.js';
import { setOf, priorityOf } from './priorities.js';
import { swapMode } from './weaponswap.js';
import { fireNum, startingWeapon, thrownReach, fixedMuzzle } from './weaponswap.js';
import { tickCollisions, resetCollideIds } from './landcollide.js';
import { SPACE_LAYER } from './tacticalcinematics.js';
import {
  CAT,
  categoryOf,
  aimsOff,
  intercept,
  inaccuracy as offAim,
  turnToward,
  rocketPath,
  boomerangPath,
  pathAt as shotPathAt,
  sweep,
  leadTurning
} from './projflight.js';

const LOGIC_FPS = 30,
  DEG = Math.PI / 180;
const ROPE_SLIDE = 3.9 * LOGIC_FPS;
export const landSpeedFactor = () => db.constants.num('Object_Max_Speed_Multiplier_Land', 1);
const SLICE_MS = 1.5;
const FOE_CELL = 128,
  FOE_PAD = 24,
  CLUTTER_CELL = 128;
const _tilt = new THREE.Quaternion(),
  _turn = new THREE.Quaternion(),
  _up = new THREE.Vector3();
const _paint = new THREE.Color();
const _ropeAt = new THREE.Vector3();
const _q = new THREE.Quaternion(),
  _X = new THREE.Vector3(1, 0, 0),
  _Y = new THREE.Vector3(0, 1, 0),
  _Z = new THREE.Vector3(0, 0, 1);

export const inCategory = (t, cat) =>
  t
    .str('CategoryMask')
    .toUpperCase()
    .split(/[\s|,]+/)
    .includes(cat);

export const animOverride = type => {
  const v = type.raw('Land_Model_Anim_Override_Name');
  if (v) for (let i = v.length - 1; i >= 0; i--) if (v[i]) return v[i];
  return '';
};

async function animOf(type, kind) {
  const file = type.str('Land_Model_Name'),
    over = animOverride(type);
  const base = file.replace(/\.alo$/i, '');
  for (const name of [over, file, 'MOV_' + base, 'MOV_E' + base.slice(1)]) {
    if (!name) continue;
    const a = await Promise.resolve(loadALA(animName(name, kind))).catch(() => null);
    if (a) return a;
  }
  return null;
}

const SETS = new Map();
let LISTING = null;
function animSet(type) {
  const base = (animOverride(type) || type.str('Land_Model_Name')).replace(/\.alo$/i, '').toUpperCase();
  let s = SETS.get(base);
  if (!s && LISTING) {
    s = { kinds: new Map(), clips: new Map(), ready: true };
    SETS.set(base, s);
    for (const n of LISTING) {
      if (!n.startsWith(base + '_')) continue;
      const m = n.slice(base.length + 1).match(/^([A-Z_]+)_\d\d\.ALA$/);
      if (m) {
        if (!s.kinds.has(m[1])) s.kinds.set(m[1], []);
        s.kinds.get(m[1]).push(n);
      }
    }
    for (const v of s.kinds.values()) v.sort();
  }
  if (!s) {
    s = { kinds: new Map(), clips: new Map(), ready: false };
    SETS.set(base, s);
    findFiles('MODELS\\\\' + base + '_[A-Z_]+_\\d\\d\\.ALA$')
      .then(list => {
        if (s.ready) return;
        for (const f of list) {
          const n = f.split('\\').pop().toUpperCase(),
            m = n.slice(base.length + 1).match(/^([A-Z_]+)_\d\d\.ALA$/);
          if (m) {
            if (!s.kinds.has(m[1])) s.kinds.set(m[1], []);
            s.kinds.get(m[1]).push(n);
          }
        }
        for (const v of s.kinds.values()) v.sort();
        s.ready = true;
        for (const k of s.want || []) variants(type, k);
      })
      .catch(() => {});
  }
  return s;
}
function variants(type, kind) {
  const s = animSet(type);
  if (!s.ready) {
    (s.want ||= new Set()).add(kind);
    return null;
  }
  let c = s.clips.get(kind);
  if (c === undefined) {
    s.clips.set(kind, (c = false));
    const names = s.kinds.get(kind);
    if (names)
      Promise.all(names.map(n => Promise.resolve(loadALA(n)).catch(() => null))).then(list => s.clips.set(kind, list.filter(Boolean)));
  }
  return c && c.length ? c : null;
}
const any = list => list[Math.floor(simRandom() * list.length)];
const WALK_ENDS = ['MOVE_ENDONE', 'MOVE_ENDTWO', 'MOVE_ENDTHREE', 'MOVE_ENDFOUR'];
const OPEN_CAP = 24;
const REPATH_PER_STEP = 4;
const SPIN_ROLL = ((20 * Math.PI) / 180) * LOGIC_FPS;

function curvePath(P) {
  const pts = [],
    at = (k, t) => {
      const p0 = P[Math.max(0, k - 1)],
        p1 = P[k],
        p2 = P[k + 1],
        p3 = P[Math.min(P.length - 1, k + 2)],
        t2 = t * t,
        t3 = t2 * t;
      return [0, 1, 2].map(
        i =>
          0.5 *
          (2 * p1[i] +
            (p2[i] - p0[i]) * t +
            (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
            (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t3)
      );
    };
  for (let k = 0; k + 1 < P.length; k++) for (let j = 0; j < 20; j++) pts.push(at(k, j / 20));
  pts.push(P[P.length - 1].slice());
  const len = [0];
  for (let i = 1; i < pts.length; i++)
    len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  return { pts, len };
}

function pathAt(path, s) {
  const { pts, len } = path;
  if (s >= len[len.length - 1]) return null;
  let i = 1;
  while (len[i] < s) i++;
  const a = pts[i - 1],
    b = pts[i],
    k = (s - len[i - 1]) / (len[i] - len[i - 1] || 1);
  return {
    x: a[0] + (b[0] - a[0]) * k,
    y: a[1] + (b[1] - a[1]) * k,
    z: a[2] + (b[2] - a[2]) * k,
    dx: b[0] - a[0],
    dy: b[1] - a[1],
    dz: b[2] - a[2]
  };
}

export function battleTypes(roots, factions, mapRoots = []) {
  const types = new Set(),
    withModel = [];
  const sides = new Set(factions.map(f => String(f).toUpperCase()));
  const affOf = t => t.list('Affiliation').map(x => x.toUpperCase());
  const ours = (t, wild) => {
    const a = affOf(t);
    return !a.length || a.some(x => sides.has(x) || (wild && (x === 'NEUTRAL' || x === 'HOSTILE')));
  };
  const looksOnly = t => /^(Particle|Projectile|Props?_|Cin_|Marker|MultiplayerStructureMarker)|Skydome/i.test(t.tag);
  const rootSet = new Set([...roots, ...mapRoots]);
  const visit = (t, wild) => {
    if (!t || types.has(t) || !ours(t, wild) || (looksOnly(t) && !rootSet.has(t))) return;
    types.add(t);
    if (t.str('Land_Model_Name')) withModel.push(t);
    for (const vals of t.props.values())
      for (const v of vals)
        for (const tok of v.split(/[\s,|]+/)) {
          if (!tok || tok.length < 3) continue;
          const o = db.type(tok);
          if (o && o !== t) visit(o, wild);
        }
  };
  for (const t of mapRoots) visit(t, true);
  for (const t of roots) visit(t, false);
  return { types, withModel };
}

export async function preloadLand(roots, factions, onProgress = () => {}, mapRoots = []) {
  const { types, withModel } = battleTypes(roots, factions, mapRoots);
  const all = (await findFiles('MODELS\\\\[^\\\\]*\\.ALA$').catch(() => [])).map(f => f.split('\\').pop().toUpperCase());
  if (all.length) {
    knownAnimations(all);
    LISTING = all;
  }
  const bases = new Set(),
    clips = new Set();
  for (const t of withModel) {
    const file = t.str('Land_Model_Name'),
      over = animOverride(t),
      base = file.replace(/\.alo$/i, '').toUpperCase();
    for (const b of [over && over.replace(/\.alo$/i, '').toUpperCase(), base, 'MOV_' + base, 'MOV_E' + base.slice(1)]) if (b) bases.add(b);
  }
  for (const base of bases) {
    const own = all.filter(n => n.startsWith(base + '_') && /^[A-Z_]+_\d\d\.ALA$/.test(n.slice(base.length + 1)));
    let s = SETS.get(base);
    if (!s) SETS.set(base, (s = { kinds: new Map(), clips: new Map(), ready: false }));
    if (!s.ready) {
      s.kinds.clear();
      for (const n of own) {
        const k = n.slice(base.length + 1).match(/^([A-Z_]+)_\d\d\.ALA$/)[1];
        if (!s.kinds.has(k)) s.kinds.set(k, []);
        s.kinds.get(k).push(n);
      }
      for (const v of s.kinds.values()) v.sort();
      s.ready = true;
    }
    for (const n of own) clips.add(n);
  }
  const jobs = [
    ...withModel.map(t => () => loadALO(t.str('Land_Model_Name')).catch(() => null)),
    ...[...clips].map(n => () => Promise.resolve(loadALA(n)).catch(() => null))
  ];
  let done = 0;
  const run = async () => {
    for (let j; (j = jobs.pop()); ) {
      await j();
      onProgress(++done, done + jobs.length);
    }
  };
  await Promise.all(Array.from({ length: 16 }, run));
  for (const base of bases) {
    const s = SETS.get(base);
    for (const [kind, names] of s.kinds)
      s.clips.set(kind, (await Promise.all(names.map(n => Promise.resolve(loadALA(n)).catch(() => null)))).filter(Boolean));
  }
  return { types: types.size, models: withModel.length, clips: clips.size };
}

function soldierExtent(u, axis) {
  const t = u.type,
    sc = t.num('Scale_Factor', 1) || 1,
    v = t.num('Custom_Hard_' + axis + 'Extent', 0);
  if (v > 0) return v * sc;
  const b = u.inst && u.inst.box,
    k = axis === 'Y' ? 'x' : 'y';
  if (b && !b.isEmpty()) return Math.max(Math.abs(b.max[k]), Math.abs(b.min[k])) * sc || 2;
  return 2;
}

const _hm = new THREE.Matrix4(),
  _hi = new THREE.Matrix4();
function liftOf(holder, B, M, first) {
  const q0 = B.quaternion.clone(),
    p0 = new THREE.Vector3(),
    p1 = new THREE.Vector3(),
    ax = i => (i === 1 ? _Y : i === 0 ? _X : _Z);
  holder.updateMatrixWorld(true);
  M.getWorldPosition(p0);
  let best = null;
  for (const i of [first, 0, 1, 2]) {
    B.quaternion.copy(q0).multiply(_q.setFromAxisAngle(ax(i), 0.3));
    B.updateMatrixWorld(true);
    M.getWorldPosition(p1);
    const dz = p1.z - p0.z;
    if (!best || Math.abs(dz) > Math.abs(best.dz) * 1.5) best = { i, dz };
  }
  B.quaternion.copy(q0);
  B.updateMatrixWorld(true);
  return best;
}

function hardpointFacing(inst, h) {
  if (!inst || !inst.bone) return 0;
  inst.root.updateMatrixWorld(true);
  _hi.copy(inst.root.matrixWorld).invert();
  const fire = inst.bone(h.str('Fire_Bone_A')),
    at = inst.bone(h.str('Attachment_Bone')) || fire;
  if (h.bool('Is_Turret') && at) {
    const e = _hm.multiplyMatrices(_hi, at.matrixWorld).elements;
    if (Math.abs(e[4]) + Math.abs(e[5]) > 0.01) return Math.atan2(-e[4], e[5]);
  }
  if (fire) {
    const e = _hm.multiplyMatrices(_hi, fire.matrixWorld).elements;
    if (Math.abs(e[0]) + Math.abs(e[1]) > 0.01) return Math.atan2(e[0], -e[1]);
  }
  if (at) {
    const e = _hm.multiplyMatrices(_hi, at.matrixWorld).elements;
    if (Math.abs(e[12]) + Math.abs(e[13]) > 0.5) return Math.atan2(e[12], -e[13]);
  }
  return 0;
}

function lobOf(w) {
  if (w.fall === undefined)
    w.fall = /^GRENADE$/i.test(w.proj.str('Projectile_Category'))
      ? w.proj.num('Projectile_Grenade_Gravity', 0) * w.proj.num('Projectile_Grenade_Gravity_Lob_Mod', 1) * LOGIC_FPS * LOGIC_FPS
      : 0;
  return w.fall;
}
function lob(w, D, dz) {
  const g = lobOf(w),
    x = D || 0.0001;
  if (!(g > 0)) return null;
  let v = w.speed,
    best = null;
  for (let k = 0; k < 64 && v > 0; k++, v *= 0.8) {
    const v2 = v * v,
      disc = v2 * v2 - 2 * g * dz * v2 - g * g * x * x;
    if (disc < 0) break;
    const u2 = (v2 - g * dz - Math.sqrt(disc)) / (((dz * dz) / (x * x) + 1) * 2);
    if (u2 < 0) break;
    best = { v, angle: Math.acos(Math.min(1, Math.sqrt(u2) / v)) };
    if (!w.proj.bool('Projectile_Grenade_Can_Lob_Slower')) break;
  }
  return best;
}

const NEUTRAL = new THREE.Color(0.6, 0.6, 0.6),
  NO_TINT = new THREE.Vector4(1, 1, 1, 0);
const _lead = { x: 0, y: 0, z: 0 },
  _off = { x: 0, y: 0, z: 0 },
  _at = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 },
  _turn3 = { x: 0, y: 0, z: 0 };
let SQUAD_ID = 0,
  COMPANY_ID = 0;
export function resetLandIds() {
  SQUAD_ID = 0;
  COMPANY_ID = 0;
  resetCollideIds();
}
const NO_HARDPOINTS = [],
  IDLE_ORDER = { kind: 'idle' };
export const FACING = Math.PI / 2;
const _placeQ = new THREE.Quaternion(),
  _placeE = new THREE.Euler(),
  _facingQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), FACING);
export function placeRotation(obj, rot) {
  obj.quaternion.setFromEuler(_placeE.set((rot[0] || 0) * DEG, (rot[1] || 0) * DEG, (rot[2] || 0) * DEG, 'ZYX')).multiply(_facingQ);
  return obj;
}
class LandUnit {
  constructor() {
    this.type = undefined;
    this.squad = undefined;
    this.off = undefined;
    this.holder = undefined;
    this.inst = undefined;
    this.x = undefined;
    this.y = undefined;
    this.z = undefined;
    this.heading = undefined;
    this.speed = undefined;
    this.turn = undefined;
    this.path = undefined;
    this.anims = undefined;
    this.anim = undefined;
    this.animKind = undefined;
    this.side = undefined;
    this.dead = undefined;
    this.gone = undefined;
    this.target = undefined;
    this.structure = undefined;
    this.site = undefined;
    this.maxHealth = undefined;
    this.health = undefined;
    this.maxShield = undefined;
    this.shield = undefined;
    this.armor = undefined;
    this.aimZ = undefined;
    this.range = undefined;
    this.weapon = undefined;
    this.turret = undefined;
    this.kind = undefined;
    this.hitRadius = undefined;
    this.captures = undefined;
    this.inaccuracy = undefined;
    this.builds = undefined;
    this.queue = undefined;
    this.income = undefined;
    this.isBase = undefined;
    this.heals = undefined;
    this.dome = undefined;
    this.drain = undefined;
    this.needsPower = undefined;
    this.power = undefined;
    this.noReinforce = undefined;
    this.noBomb = undefined;
    this.slots = undefined;
    this.ports = undefined;
    this.holds = undefined;
    this.accepts = undefined;
    this.relevant = undefined;
    this.footprint = undefined;
    this.looksOf = undefined;
    this.aiPower = undefined;
    this.uid = undefined;
    this.gravField = undefined;
    this.cage = undefined;
    this.catList = undefined;
    this.loops = undefined;
    this.fixedHeading = undefined;
    this.scanAt = undefined;
    this.antiAir = undefined;
    this.unpowered = undefined;
    this.repath = undefined;
    this.lift = undefined;
    this.flies = undefined;
    this.crusher = undefined;
    this.supercrusher = undefined;
    this.squashable = undefined;
    this.squashableBig = undefined;
    this.minRange = undefined;
    this.ranks = undefined;
    this.guns = undefined;
    this.deflects = undefined;
    this.deflect = undefined;
    this.mod = undefined;
    this.wade = undefined;
    this.ghost = undefined;
    this.foot = undefined;
    this.body = undefined;
    this.need = undefined;
    this.abilityKinds = undefined;
    this.needsDeploy = undefined;
    this.shadow = undefined;
    this.slot = undefined;
    this.jig = undefined;
    this.slotPt = undefined;
    this.wxKeys = undefined;
    this.wx = undefined;
    this.acc = undefined;
    this.back = undefined;
    this.v = undefined;
    this.fidgetAt = undefined;
    this.wallAt = undefined;
    this.detour = undefined;
    this.detourAt = undefined;
    this.prioSet = undefined;
    this.weapons = undefined;
    this.weaponIndex = undefined;
    this.evAnim = undefined;
    this.tracks = undefined;
    this.markAt = undefined;
    this.gravHit = undefined;
    this.direct = undefined;
    this.mvx = undefined;
    this.mvy = undefined;
    this.mvz = undefined;
    this.lastX = undefined;
    this.lastY = undefined;
    this.lastZ = undefined;
    this.turnW = undefined;
    this.lastH = undefined;
    this.specials = undefined;
    this.shell = undefined;
    this.slow = undefined;
    this.evT = undefined;
    this.ambient = undefined;
    this.fp = undefined;
    this.rag = undefined;
    this.jigMax = undefined;
    this.gait = undefined;
    this.once = undefined;
    this.onceEnd = undefined;
    this.invulnUntil = undefined;
    this.scriptHidden = undefined;
    this.inside = undefined;
    this.gunner = undefined;
    this.lastDamage = undefined;
    this.lastHit = undefined;
    this.hitBy = undefined;
    this.hurtBy = undefined;
    this.died = undefined;
    this.deathClone = undefined;
    this.endFx = undefined;
    this.endSfx = undefined;
    this.lieFor = undefined;
    this.vanish = undefined;
    this.fadeTime = undefined;
    this.fadeAt = undefined;
    this.skinOf = undefined;
    this.wearAt = undefined;
    this.wearTo = undefined;
    this.wearShown = undefined;
    this.house = undefined;
    this.capturable = undefined;
    this.specialAt = undefined;
    this.special = undefined;
    this.cats = undefined;
    this.stunUntil = undefined;
    this.cast = undefined;
    this.sellFor = undefined;
    this.defense = undefined;
    this.ckinds = undefined;
    this.wear = undefined;
    this.gravity = undefined;
    this.rooted = undefined;
    this.bomber = undefined;
    this.setup = undefined;
    this.askedIdle = undefined;
    this.absorb = undefined;
    this.air = undefined;
    this.untargetable = undefined;
    this.altRange = undefined;
    this.altWeapon = undefined;
    this.anchor = undefined;
    this.cloaked = undefined;
    this.noGarrison = undefined;
    this.clash = undefined;
    this.confuseUntil = undefined;
    this.crushR = undefined;
    this.deployed = undefined;
    this.doomAt = undefined;
    this.everSeen = undefined;
    this.fullPower = undefined;
    this.holstered = undefined;
    this.infected = undefined;
    this.inZone = undefined;
    this.mainRange = undefined;
    this.mainWeapon = undefined;
    this.mine = undefined;
    this.noForce = undefined;
    this.noForceFx = undefined;
    this.presenceAnim = undefined;
    this.presenceUntil = undefined;
    this.quake = undefined;
    this.sight = undefined;
    this.seen = undefined;
    this.spin = undefined;
    this.thief = undefined;
    this.usesForce = undefined;
    this.claimed = undefined;
    this.gravFxAt = undefined;
    this.padSite = undefined;
    this.revealsFiring = undefined;
    this.spotted = undefined;
    this.lastSeen = undefined;
    this.scriptZ = undefined;
    this.cinematicTransport = undefined;
    this.rope = undefined;
    this.hoverH = undefined;
    this.hoverZ = undefined;
    this.hoverState = undefined;
    this.fromStart = undefined;
    this.animAt = undefined;
    this.animT0 = undefined;
    this.stopTurn = undefined;
    this.preTurns = undefined;
    this.preTurn = undefined;
    this.stopping = undefined;
    this.walking = undefined;
    this.walkTrans = undefined;
    this.halfW = undefined;
    this.halfD = undefined;
    this.ccls = undefined;
    this.cb = undefined;
    this.ccCap = undefined;
    this.inView = undefined;
    this.inPose = undefined;
    this.ix = undefined;
    this.iy = undefined;
    this.iz = undefined;
    this.ih = undefined;
    this.istep = undefined;
    this.ipos = undefined;
    this.iq = undefined;
    this.ihold = undefined;
    this.lerp = undefined;
  }
}
export const landUnit = fields => Object.assign(new LandUnit(), fields);

export class LandSquad {
  constructor(world, type, side, extra = {}) {
    this.world = world;
    this.type = type;
    this.side = side;
    this.members = [];
    this.selected = false;
    this.id = ++SQUAD_ID;
    this.full = 0;
    this.abilities = [];
    this.fighters = [];
    this.structure = undefined;
    this.scripted = undefined;
    this.box = undefined;
    this.foe = undefined;
    this.company = undefined;
    this.forming = undefined;
    this.mates = undefined;
    this.fsKind = undefined;
    this.isTypes = undefined;
    this.ckinds = undefined;
    this.post = undefined;
    this.legs = undefined;
    this.march = undefined;
    this.marchStill = undefined;
    this.aiPlan = undefined;
    this.formSpeed = undefined;
    this.arriving = undefined;
    this.direct = undefined;
    this.craft = undefined;
    this.noAI = undefined;
    this.selectable = undefined;
    this.standRetry = undefined;
    this.advance = undefined;
    this.spot = undefined;
    this.aimAt = undefined;
    this.spread = undefined;
    this.native = undefined;
    this.pending = undefined;
    this.ext = undefined;
    this.hunt = undefined;
    this.huntAt = undefined;
    this.busy = undefined;
    this.deployed = undefined;
    this.mine = undefined;
    this.bomber = undefined;
    this.afterPack = undefined;
    this.entering = undefined;
    this.homing = undefined;
    this.mapIndex = undefined;
    this.scriptPosition = undefined;
    this.scriptHidden = undefined;
    this.scriptHeading = undefined;
    this.scriptAnimation = undefined;
    this.scriptDespawned = undefined;
    this.formPending = undefined;
    this.formMove = undefined;
    this.cb = undefined;
    this.ccCap = undefined;
    this._teamType = undefined;
    Object.assign(this, extra);
  }
  get player() {
    const w = this.world,
      sp = w.sidePlayers;
    if (!sp) return null;
    if (this.structure && w.viewer !== undefined && this.side >= 0 && w.ally(this.side, w.viewer)) return sp[w.viewer];
    return sp[this.side] || sp[w.wild] || null;
  }
  get dead() {
    return !this.members.length && !this.forming;
  }
  get isStructure() {
    return !!this.structure;
  }
  get health() {
    let h = 0;
    for (const u of this.members) h += u.health;
    return h;
  }
  get maxHealth() {
    let h = 0;
    for (const u of this.members) h += u.maxHealth;
    return Math.max(h, this.full || 0);
  }
  get hitRadius() {
    return this.members[0] ? this.members[0].hitRadius || 0 : 0;
  }
  get maxRange() {
    let r = 0;
    for (const u of this.members) r = Math.max(r, u.range || 0);
    return r;
  }
  get hardpoints() {
    return NO_HARDPOINTS;
  }
  get target() {
    for (const u of this.members) if (u.target && !u.target.dead && u.target.squad) return u.target.squad;
    return this.foe && this.foe.members.length ? this.foe : null;
  }
  get order() {
    if (this.foe && this.foe.members.length) return { kind: 'attack', target: this.foe };
    return this.pending || this.busy || this.members.some(u => u.path && u.path.length) ? { kind: 'move' } : IDLE_ORDER;
  }
  cats() {
    return this.members[0] && this.members[0].type ? this.members[0].type.categories() : this.type.categories();
  }
  get scriptType() {
    const team = db.type(this.type.str('Create_Team_Type'));
    if (team) return team;
    const t = this.members[0]?.type;
    if (t && t !== this.type && t.str('Lua_Script') && this.members.every(u => u.type === t)) return t;
    return this.type;
  }
  get isSquad() {
    return false;
  }
  get isMobile() {
    return !this.structure;
  }
  get isPad() {
    return false;
  }
  get x() {
    return this.members[0] ? this.members[0].x : this.scriptPosition?.x || 0;
  }
  get y() {
    return this.members[0] ? this.members[0].y : this.scriptPosition?.y || 0;
  }
  get z() {
    return this.members[0] ? this.members[0].z : this.scriptPosition?.z || 0;
  }
  get healthFrac() {
    let h = 0,
      m = 0;
    for (const u of this.members) {
      h += u.health;
      m += u.maxHealth;
    }
    return Math.max(0, Math.min(1, h / (Math.max(this.full, m) || 1)));
  }
  get maxShield() {
    let m = 0;
    for (const u of this.members) m += u.maxShield;
    return m;
  }
  get shield() {
    let m = 0;
    for (const u of this.members) m += u.shield;
    return m;
  }
  abilityState(kind) {
    return this.abilities.find(a => a.def.kind === kind) || null;
  }
  get sellable() {
    return !!this.structure && this.abilities.some(a => a.def.kind === 'SELL');
  }
  get heroType() {
    return this.members[0] && this.members[0].type ? this.members[0].type : this.type;
  }
  queuesFor(side) {
    const m = new Map(),
      w = this.world,
      u = this.members[0];
    if (!this.structure || !u || !w.ally(u.side, side)) return m;
    const first = w.units.find(x => x.structure && !x.dead && x.site && w.ally(x.side, side));
    if (first !== u) return m;
    const qs = w.queues[side];
    if (qs && qs.units.length) m.set('units', qs.units);
    if (qs && qs.upgrades.length) m.set('upgrades', qs.upgrades);
    w.sites.forEach((s, i) => {
      if (s.building && s.building.side === side) m.set('site' + i, [s.building]);
    });
    return m;
  }
  get buildQueues() {
    return this.queuesFor(this.world.viewer ?? this.side);
  }
}

export function buildsFor(type, faction, campaign = false) {
  const out = [];
  let on = false;
  for (const k of type
    .list(campaign ? 'Tactical_Buildable_Objects_Campaign' : 'Tactical_Buildable_Objects_Multiplayer')
    .flatMap(x => x.split(/[\s,]+/))
    .filter(Boolean)) {
    if (db.faction(k)) {
      on = !!faction && k.toUpperCase() === faction.toUpperCase();
      continue;
    }
    if (on && db.type(k)) out.push(db.type(k));
  }
  return out;
}
const revealTypes = new WeakMap();
const landReveals = t => {
  let v = revealTypes.get(t);
  if (v === undefined) revealTypes.set(t, (v = [...t.list('Behavior'), ...t.list('LandBehavior')].some(b => b.toUpperCase() === 'REVEAL')));
  return v;
};

const landingModel = (craft, variant) =>
  craft.str('Land_Model_Name') || (variant && variant !== craft ? variant.str('Land_Model_Name') : '');
export const isHeroCompany = t =>
  /hero/i.test(t.tag) ||
  t.list('Company_Units').some(n => {
    const u = db.type(n);
    return !!u && (/hero/i.test(u.tag) || inCategory(u, 'LANDHERO'));
  });
export const isUpgrade = t => /upgrade/i.test(t.tag);
export const missingFor = (world, side, t) =>
  t
    .list('Tactical_Build_Prerequisites')
    .map(n => db.type(n))
    .filter(p => p && !world.owned[side].has(p.name));
export const costOf = t => t.num('Tactical_Build_Cost_Multiplayer', 0);
export const landPop = t =>
  t.has('Land_Override_Population_Value') ? t.num('Land_Override_Population_Value', 0) : t.num('Population_Value', 0);
export const timeOf = t => t.num('Tactical_Build_Time_Seconds', 10);

export class LandWorld {
  constructor(map, scene, { factions = ['Empire', 'Rebel'], teams = null, credits = 6000, popCap = 0 } = {}) {
    this.map = map;
    this.terrain = map.terrain;
    this.scene = scene;
    this.n = this.terrain.size;
    this.units = [];
    this.squads = [];
    this.shots = [];
    this.toPose = [];
    this.mapObjects = new Map();
    this.groups = [];
    this.factions = factions;
    this.team = teams || factions.map((_, i) => i);
    {
      const sets = new Map();
      this.owned = this.team.map(t => sets.get(t) || sets.set(t, new Set()).get(t));
    }
    this.queues = factions.map(() => ({ units: [], upgrades: [] }));
    this.colors = factions.map(() => null);
    this.beaten = new Set();
    this.mods = factions.map(() => ({ build: 1, credit: 1, damage: 1, health: 1 }));
    this.credits = factions.map(() => credits);
    this.bounty = new BountyBook();
    this.collected = factions.map(() => 0);
    this.ready = factions.map(() => []);
    this.sites = [];
    this.loser = -1;
    this.popOverride = popCap;
    this.shields = [];
    this.bombing = [];
    this.wild = factions.length;
    this.effects = [];
    this.beams = [];
    this.bolts = [];
    this.glows = [];
    this.pings = [];
    this.revealUntil = factions.map(() => 0);
    this.reveals = [];
    this.onShot = null;
    this.time = 0;
    this.points = [];
    const caps = (db.faction(this.factions[0])?.str('Land_Skirmish_Unit_Cap_By_Player_Count') || '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    this.popLimit = 10;
    for (let i = 0; i + 1 < caps.length; i += 2) if (caps[i] <= 2) this.popLimit = caps[i + 1];
    this.transports = [];
    this.campaign = false;
    this.campaignAttacker = -1;
    this.campaignGarrison = new Set();
    this.onTransportOut = null;
    this.garrisons = new Map();
    this.garrisonBusy = 0;
    this.garrisonAt = 0;
    this.garrisonPlanet = null;
    this.flashes = [];
    const p = this.terrain.passability,
      n = this.n;
    this.open = new Uint8Array(n * n);
    this.kind = new Uint16Array(n * n);
    this.wet = new Uint8Array(n * n);
    this.masks = [0];
    this.roomOf = new Map();
    this.openOf = new WeakMap();
    this.groundVer = 0;
    this.tables = null;
    this.weather = {
      phases: [],
      i: 0,
      left: 0,
      name: 'clear',
      strength: 0,
      level: 0,
      from: 0,
      ease: 1,
      eased: 1,
      lightning: 0,
      fog: 0,
      fogFrom: 0,
      fogTo: 0,
      emitter: ''
    };
    const T = this.terrain;
    for (let i = 0; i < n * n; i++) {
      const L = T.layers[T.layerIndex[i]],
        ground = L && L.texture;
      const k = ground ? (p ? p[i] : TERRAIN.CLEAR) : TERRAIN.IMPASSABLE;
      this.kind[i] = k & ~TERRAIN.CLEAR ? k & ~TERRAIN.CLEAR : k;
      this.open[i] = 1;
      this.wet[i] = k & TERRAIN.WATER || (T.water && T.water.on && T.heights[i] < T.water.level) ? 1 : 0;
    }
    this.paths = new LandPaths(this);
  }

  setWeather(name) {
    const s = this.tables && this.tables.scenarios.get(String(name || '').toUpperCase());
    if (!s || !s.phases.length) return;
    const w = this.weather;
    w.phases = s.phases;
    w.emitter = s.emitter;
    w.i = 0;
    w.left = s.phases[0].seconds;
    w.name = s.phases[0].name;
    w.strength = w.level = s.phases[0].strength;
    w.lightning = s.phases[0].lightning || 0;
    w.fog = w.fogTo = s.phases[0].fog || 0;
  }
  wxOf(u) {
    const name = this.weather.name;
    if (u.wx && u.wx.name === name) return u.wx;
    if (this.weatherproof && this.weatherproof.has(u.side)) return (u.wx = { name, sight: 1, speed: 1 });
    const m = this.tables && this.tables.weather.get(name);
    u.wxKeys ??= [...u.type.list('Weather_Category'), u.type.str('MovementClass'), 'Default'].filter(Boolean).map(k => k.toUpperCase());
    const pick = map => {
      for (const k of u.wxKeys) if (map.has(k)) return map.get(k);
      return 1;
    };
    return (u.wx = { name, sight: m ? pick(m.sight) : 1, speed: m ? pick(m.speed) : 1 });
  }
  sightMod(u) {
    return this.wxOf(u).sight;
  }
  wxSpread(w) {
    const name = this.weather.name;
    if (w.wxName === name) return w.wxSpread;
    const m = this.tables && this.tables.weather.get(name),
      cat = w.proj.str('Projectile_Category').toUpperCase();
    const a = m
      ? /MPTL/i.test(w.proj.name) && m.aim.has('MPTL_ROCKET')
        ? m.aim.get('MPTL_ROCKET')
        : (m.aim.get(cat) ?? m.aim.get('DEFAULT') ?? 1)
      : 1;
    w.wxName = name;
    return (w.wxSpread = Math.max(0, 2 - a));
  }

  rooms(need = 1) {
    if (this.roomDirty) {
      this.roomOf.clear();
      this.roomByNeed = null;
      this.roomDirty = false;
      this.dirtyCells = null;
    } else if (this.dirtyCells) {
      const cells = this.dirtyCells;
      this.dirtyCells = null;
      this.mendGround(cells);
    }
    const byNeed = (this.roomByNeed ||= []),
      quick = byNeed[need];
    if (quick) return quick;
    const mask = this.maskOf(need),
      have = this.roomOf.get(mask);
    if (have) return (byNeed[need] = have);
    const n = this.n,
      o = this.open,
      room = new Uint8Array(n * n),
      k = this.kind;
    this.roomOf.set(mask, room);
    byNeed[need] = room;
    for (let i = 0; i < n * n; i++) room[i] = o[i] && k[i] && !(k[i] & ~mask) ? 3 : 0;
    for (let level = 1; level <= 2; level++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          if (room[i] !== 3) continue;
          let near = false;
          for (let dy = -1; dy <= 1 && !near; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const X = x + dx,
                Y = y + dy;
              if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
              if (room[Y * n + X] === level - 1) {
                near = true;
                break;
              }
            }
          if (near) room[i] = level;
        }
    return room;
  }

  marketOf(q) {
    return this.market?.[q.side];
  }
  ally(a, b) {
    return a === b || (this.team[a] !== undefined && this.team[a] === this.team[b]);
  }
  enemy(a, b) {
    return (
      a.side >= 0 &&
      b.side >= 0 &&
      !this.ally(a.side, b.side) &&
      (a.side !== this.wild || !!a.squad?.native) &&
      (b.side !== this.wild || !!b.squad?.native)
    );
  }
  blastReaches(o, side, proj) {
    if (!o.type.bool('Collidable_By_Projectile_Living', false)) return false;
    const immune = (proj._blastImmune ??= proj.str('Projectile_Blast_Area_Immune_Faction').trim().toUpperCase());
    if (immune) return (this.factions[o.side] || '').toUpperCase() !== immune;
    return side >= 0 && o.side >= 0 && !this.ally(side, o.side) && (o.side !== this.wild || !!o.squad?.native);
  }
  targetEnemy(a, b) {
    if (b.untargetable) return false;
    if (!(a.confuseUntil > this.time)) return this.enemy(a, b);
    return this.ally(a.side, b.side) && (a.side !== this.wild || !!a.squad?.native) && (b.side !== this.wild || !!b.squad?.native);
  }
  teamSides(side) {
    return this.team.map((t, i) => (t === this.team[side] ? i : -1)).filter(i => i >= 0);
  }

  maskOf(need) {
    const i = need >> 2,
      M = this.tables && this.tables.moves;
    if (i) return this.masks[i];
    return (need & 3) > 1
      ? (M && M.get('TRACKED')) || TERRAIN.CLEAR | TERRAIN.SHIELD
      : (M && M.get('INFANTRY')) || TERRAIN.CLEAR | TERRAIN.SHIELD | TERRAIN.INFANTRYONLY;
  }
  needOf(moveClass, room) {
    const M = this.tables && this.tables.moves,
      mask = M && M.get(String(moveClass || '').toUpperCase());
    if (!mask || mask === this.maskOf(room)) return room;
    let i = this.masks.indexOf(mask);
    if (i < 1) {
      i = this.masks.length;
      this.masks.push(mask);
    }
    return room + i * 4;
  }
  isOpen(x, y, need = 1) {
    const ix = Math.round(x / CELL),
      iy = Math.round(y / CELL);
    return ix >= 0 && iy >= 0 && ix < this.n && iy < this.n && this.rooms(need)[iy * this.n + ix] >= (need & 3);
  }

  clear(ax, ay, bx, by, need = 1) {
    const d = Math.hypot(bx - ax, by - ay),
      steps = Math.ceil(d / (CELL * 0.5)),
      n = this.n,
      room = this.rooms(need),
      wide = need & 3;
    const far = this.openness(room, wide),
      per = steps ? d / steps : 0;
    let px = -1,
      py = -1;
    for (let i = 0; i <= steps; ) {
      const t = steps ? i / steps : 0,
        ix = Math.round((ax + (bx - ax) * t) / CELL),
        iy = Math.round((ay + (by - ay) * t) / CELL);
      if (!(ix >= 0 && iy >= 0 && ix < n && iy < n && room[iy * n + ix] >= wide)) return false;
      if (px >= 0 && ix !== px && iy !== py && (room[py * n + ix] < wide || room[iy * n + px] < wide)) return false;
      const r = far[iy * n + ix],
        k = r > 2 && per > 0 ? Math.floor(((r - 2.01) * CELL) / per) : 0;
      if (k > 1) {
        i += k;
        px = -1;
      } else {
        i++;
        px = ix;
        py = iy;
      }
    }
    return true;
  }

  openness(room, wide) {
    let byWide = this.openOf.get(room);
    if (!byWide) this.openOf.set(room, (byWide = []));
    if (byWide[wide]) return byWide[wide];
    const n = this.n,
      d = (byWide[wide] = new Uint8Array(n * n));
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (room[i] < wide) continue;
        let m = x > 0 ? d[i - 1] : 0;
        if (y > 0) {
          const a = x > 0 ? d[i - n - 1] : 0,
            b = d[i - n],
            c = x < n - 1 ? d[i - n + 1] : 0;
          if (a < m) m = a;
          if (b < m) m = b;
          if (c < m) m = c;
        } else m = 0;
        d[i] = m + 1 < OPEN_CAP ? m + 1 : OPEN_CAP;
      }
    for (let y = n - 1; y >= 0; y--)
      for (let x = n - 1; x >= 0; x--) {
        const i = y * n + x;
        if (!d[i]) continue;
        let m = x < n - 1 ? d[i + 1] : 0;
        if (y < n - 1) {
          const a = x > 0 ? d[i + n - 1] : 0,
            b = d[i + n],
            c = x < n - 1 ? d[i + n + 1] : 0;
          if (a < m) m = a;
          if (b < m) m = b;
          if (c < m) m = c;
        } else m = 0;
        if (m + 1 < d[i]) d[i] = m + 1;
      }
    return d;
  }

  nearestOpen(x, y, need = 1, taken = null) {
    const n = this.n,
      cx = Math.round(x / CELL),
      cy = Math.round(y / CELL),
      room = this.rooms(need),
      wide = need & 3;
    for (let r = 0; r < 40; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r, edge = dy === -r || dy === r; dx <= r; dx = edge || dx === r ? dx + 1 : r) {
          const ix = cx + dx,
            iy = cy + dy;
          if (ix >= 0 && iy >= 0 && ix < n && iy < n && room[iy * n + ix] >= wide && !(taken && taken.has(iy * n + ix)))
            return { x: ix * CELL, y: iy * CELL };
        }
    return null;
  }

  nearestFree(u) {
    const n = this.n,
      taken = new Set();
    for (const v of this.units)
      if (v !== u && !v.dead && !v.structure && !v.inside && !v.flies) {
        const ix = Math.round(v.x / CELL),
          iy = Math.round(v.y / CELL);
        if (Math.abs(v.x - ix * CELL) < 1 && Math.abs(v.y - iy * CELL) < 1) taken.add(iy * n + ix);
      }
    return this.nearestOpen(u.x, u.y, 1, taken) || this.nearestOpen(u.x, u.y);
  }

  route(ax, ay, bx, by, need = 1) {
    return this.paths.route(ax, ay, bx, by, this.maskOf(need));
  }

  stamp(u) {
    const n = this.n;
    if (/\b(WALL|LAND_OBSTACLE)\b/i.test(u.type.str('LandBehavior') + ' ' + u.type.str('Behavior')) && u.inst && u.inst.model) {
      u.footprint = [];
      this.blockObstacle({ type: u.type, pos: [u.x, u.y, u.z], rot: [0, 0, u.heading / DEG], scale: 1 }, u.inst.model, u.footprint);
    } else this.stampModel(u);
    this.groundChanged(u.footprint);
    const apron = u.type.has('Terrain_Texture_Modifier_Material')
      ? u.type.num('Terrain_Texture_Modifier_Material', -1)
      : u.site && u.site.pad && u.site.pad.has('Terrain_Texture_Modifier_Material')
        ? u.site.pad.num('Terrain_Texture_Modifier_Material', -1)
        : -1;
    if (apron >= 0 && u.footprint.length) {
      const cells = new Set();
      for (const i of u.footprint) {
        const x = i % n,
          y = (i / n) | 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < n && y + dy < n) cells.add((y + dy) * n + x + dx);
      }
      paveTerrain(this.terrain, cells, apron);
    }
    if (u.footprint.length) this.reroute(u.footprint);
  }

  stampModel(u) {
    const n = this.n,
      h = u.holder;
    h.updateMatrixWorld(true);
    const box = new THREE.Box3(),
      part = new THREE.Box3(),
      inv = new THREE.Matrix4().copy(h.matrixWorld).invert(),
      m = new THREE.Matrix4(),
      v = new THREE.Vector3();
    h.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      for (let a = o; a && a !== h.parent; a = a.parent) if (!a.visible) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(part.copy(o.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
    });
    const most = u.hitRadius * 1.7,
      least = Math.min(most, 24),
      k = 0.9;
    const cx = (box.min.x + box.max.x) / 2,
      cy = (box.min.y + box.max.y) / 2,
      hx = ((box.max.x - box.min.x) / 2) * k,
      hy = ((box.max.y - box.min.y) / 2) * k;
    const inside = (x, y) => {
      const d = Math.hypot(x - u.x, y - u.y);
      if (d <= least) return true;
      if (d > most || box.isEmpty()) return false;
      v.set(x, y, u.z).applyMatrix4(inv);
      return Math.abs(v.x - cx) <= hx && Math.abs(v.y - cy) <= hy;
    };
    u.footprint = [];
    const c = Math.ceil(most / CELL),
      ux = Math.round(u.x / CELL),
      uy = Math.round(u.y / CELL);
    for (let iy = Math.max(0, uy - c); iy <= Math.min(n - 1, uy + c); iy++)
      for (let ix = Math.max(0, ux - c); ix <= Math.min(n - 1, ux + c); ix++)
        if (this.open[iy * n + ix] && inside(ix * CELL, iy * CELL)) {
          this.open[iy * n + ix] = 0;
          u.footprint.push(iy * n + ix);
        }
  }
  blockObstacle(o, model, cells = null) {
    const shownPart = m => m.bbox && !m.hidden && !/SHADOW|_ALT[1-9]/i.test(m.name);
    const t = o.type,
      n = this.n,
      scale = t.num('Scale_Factor', 1) * (o.scale || 1),
      given = t.num('Obstacle_Width', 0) > 0;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const m of model ? model.meshes : [])
      if (shownPart(m)) {
        x0 = Math.min(x0, m.bbox[0]);
        y0 = Math.min(y0, m.bbox[1]);
        x1 = Math.max(x1, m.bbox[3]);
        y1 = Math.max(y1, m.bbox[4]);
      }
    const has = Number.isFinite(x0);
    if (has && !given && Math.abs(o.rot[0] || 0) + Math.abs(o.rot[1] || 0) < 0.01) {
      let top = -Infinity;
      for (const m of model.meshes) if (shownPart(m)) top = Math.max(top, m.bbox[5]);
      if (top * scale < 2) return 0;
    }
    const w = t.num('Obstacle_Width', 0) || (has ? (x1 - x0) * scale : 0),
      d = t.num('Obstacle_Height', 0) || (has ? (y1 - y0) * scale : 0);
    if (!(w > 0 && d > 0)) return 0;
    const ox = t.num('Obstacle_X_Offset', 0) || (has ? x0 * scale : -w / 2),
      oy = t.num('Obstacle_Y_Offset', 0) || (has ? y0 * scale : -d / 2);
    if (has && !given && Math.abs(o.rot[0] || 0) + Math.abs(o.rot[1] || 0) > 0.01) {
      let z0 = Infinity,
        z1 = -Infinity;
      for (const m of model.meshes)
        if (shownPart(m)) {
          z0 = Math.min(z0, m.bbox[2]);
          z1 = Math.max(z1, m.bbox[5]);
        }
      const q = placeRotation(new THREE.Object3D(), o.rot).quaternion,
        v = new THREE.Vector3(),
        step = CELL / 2,
        seen = new Set();
      let closed = 0;
      for (let lx = x0; lx <= x1 + 1e-6; lx += step / scale)
        for (let ly = y0; ly <= y1 + 1e-6; ly += step / scale)
          for (let lz = z0; lz <= z1 + 1e-6; lz += step / scale) {
            v.set(lx * scale, ly * scale, lz * scale).applyQuaternion(q);
            if (o.pos[2] + v.z > heightAt(this.terrain, o.pos[0] + v.x, o.pos[1] + v.y) + 30) continue;
            const ix = Math.round((o.pos[0] + v.x) / CELL),
              iy = Math.round((o.pos[1] + v.y) / CELL),
              k = iy * n + ix;
            if (seen.has(k)) continue;
            seen.add(k);
            if (ix >= 0 && iy >= 0 && ix < n && iy < n && this.open[k]) {
              this.open[k] = 0;
              closed++;
              cells?.push(k);
            }
          }
      if (closed) this.groundChanged(cells);
      return closed;
    }
    const a = ((o.rot[2] || 0) * Math.PI) / 180 + FACING,
      c = Math.cos(a),
      sn = Math.sin(a),
      step = CELL / 2;
    let closed = 0;
    for (let lx = 0; lx <= w; lx += step)
      for (let ly = 0; ly <= d; ly += step) {
        const x = o.pos[0] + c * (lx + ox) - sn * (ly + oy),
          y = o.pos[1] + sn * (lx + ox) + c * (ly + oy);
        const ix = Math.round(x / CELL),
          iy = Math.round(y / CELL);
        if (ix >= 0 && iy >= 0 && ix < n && iy < n && this.open[iy * n + ix]) {
          this.open[iy * n + ix] = 0;
          closed++;
          cells?.push(iy * n + ix);
        }
      }
    if (closed) this.groundChanged(cells);
    return closed;
  }
  async blockWreck(u, t) {
    const n = this.n,
      before = this.groundVer,
      cells = [];
    if (/LAND_OBSTACLE/i.test(t.str('LandBehavior') + ' ' + t.str('Behavior'))) {
      const model = await loadALO(t.str('Land_Model_Name')).catch(() => null);
      if (u.gone) return;
      this.blockObstacle({ type: t, pos: [u.x, u.y, u.z], rot: [0, 0, u.heading / DEG], scale: 1 }, model, cells);
    } else {
      const s = t.num('Scale_Factor', 1) || 1,
        hx = t.num('Custom_Hard_XExtent', 0) * s,
        hy = t.num('Custom_Hard_YExtent', 0) * s;
      if (!(hx > 0 && hy > 0)) return;
      const ox = t.num('Custom_Hard_XExtent_Offset', 0) * s,
        oy = t.num('Custom_Hard_YExtent_Offset', 0) * s,
        c = Math.cos(u.heading),
        sn = Math.sin(u.heading);
      const cx = u.x + c * ox - sn * oy,
        cy = u.y + sn * ox + c * oy,
        step = CELL / 2;
      for (let lx = -hx; lx <= hx + 1e-6; lx += step)
        for (let ly = -hy; ly <= hy + 1e-6; ly += step) {
          const ix = Math.round((cx + c * lx - sn * ly) / CELL),
            iy = Math.round((cy + sn * lx + c * ly) / CELL),
            k = iy * n + ix;
          if (ix >= 0 && iy >= 0 && ix < n && iy < n && this.open[k]) {
            this.open[k] = 0;
            cells.push(k);
          }
        }
      if (cells.length) this.groundChanged(cells);
    }
    u.footprint = cells;
    if (this.groundVer !== before) this.reroute(cells);
  }

  unstamp(u) {
    for (const i of u.footprint || []) this.open[i] = 1;
    this.groundChanged(u.footprint);
    u.footprint = null;
  }

  groundChanged(cells = null) {
    this.groundVer++;
    if (this.roomDirty) return;
    if (!cells || !cells.length) {
      this.roomDirty = true;
      this.dirtyCells = null;
      return;
    }
    const d = (this.dirtyCells ||= []);
    for (const k of cells) d.push(k);
  }

  mendGround(cells) {
    const n = this.n,
      o = this.open,
      kind = this.kind;
    let x0 = n,
      y0 = n,
      x1 = -1,
      y1 = -1;
    for (const k of cells) {
      const x = k % n,
        y = (k / n) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) return;
    const ax = Math.max(0, x0 - 2),
      ay = Math.max(0, y0 - 2),
      bx = Math.min(n - 1, x1 + 2),
      by = Math.min(n - 1, y1 + 2);
    const R = OPEN_CAP + 2,
      oxa = Math.max(0, x0 - R),
      oya = Math.max(0, y0 - R),
      oxb = Math.min(n - 1, x1 + R),
      oyb = Math.min(n - 1, y1 + R);
    for (const [mask, room] of this.roomOf) {
      for (let y = ay; y <= by; y++)
        for (let x = ax; x <= bx; x++) {
          const i = y * n + x;
          room[i] = o[i] && kind[i] && !(kind[i] & ~mask) ? 3 : 0;
        }
      for (let level = 1; level <= 2; level++)
        for (let y = ay; y <= by; y++)
          for (let x = ax; x <= bx; x++) {
            const i = y * n + x;
            if (room[i] !== 3) continue;
            let near = false;
            for (let dy = -1; dy <= 1 && !near; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const X = x + dx,
                  Y = y + dy;
                if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
                if (room[Y * n + X] === level - 1) {
                  near = true;
                  break;
                }
              }
            if (near) room[i] = level;
          }
      const byWide = this.openOf.get(room);
      if (byWide)
        for (let wide = 0; wide < byWide.length; wide++) {
          const d = byWide[wide];
          if (!d) continue;
          for (let y = oya; y <= oyb; y++)
            for (let x = oxa; x <= oxb; x++) {
              const i = y * n + x;
              if (room[i] < wide) {
                d[i] = 0;
                continue;
              }
              let m = x > 0 ? d[i - 1] : 0;
              if (y > 0) {
                const a = x > 0 ? d[i - n - 1] : 0,
                  b = d[i - n],
                  c = x < n - 1 ? d[i - n + 1] : 0;
                if (a < m) m = a;
                if (b < m) m = b;
                if (c < m) m = c;
              } else m = 0;
              d[i] = m + 1 < OPEN_CAP ? m + 1 : OPEN_CAP;
            }
          for (let y = oyb; y >= oya; y--)
            for (let x = oxb; x >= oxa; x--) {
              const i = y * n + x;
              if (!d[i]) continue;
              let m = x < n - 1 ? d[i + 1] : 0;
              if (y < n - 1) {
                const a = x > 0 ? d[i + n - 1] : 0,
                  b = d[i + n],
                  c = x < n - 1 ? d[i + n + 1] : 0;
                if (a < m) m = a;
                if (b < m) m = b;
                if (c < m) m = c;
              } else m = 0;
              if (m + 1 < d[i]) d[i] = m + 1;
            }
        }
    }
  }
  reroute(cells = null) {
    const area = cells && cells.length ? this.areaOf(cells) : null,
      later = (this.toRepath ||= new Set());
    for (const u of this.units) {
      if (u.dead || u.structure || u.flies) continue;
      if ((!area || this.inArea(area, u.x, u.y)) && !this.isOpen(u.x, u.y)) {
        const o = this.nearestFree(u);
        if (o) {
          u.x = o.x;
          u.y = o.y;
        }
      }
      if (u.path.length && u.path[0] === u.slotPt) continue;
      if (u.path.length && (!area || this.crossesArea(area, u.x, u.y, u.path))) {
        if (area) later.add(u);
        else this.repath(u);
      }
    }
    for (const q of this.squads) {
      const box = q.box;
      if (!box || q.ext || !box.path.length) continue;
      if (area && !this.crossesArea(area, box.x, box.y, box.path)) continue;
      if (area) later.add(q);
      else this.repath(q);
    }
  }

  repath(e) {
    if (e.members) {
      const q = e,
        box = q.box;
      if (!box || q.ext || !box.path.length || !q.members.length) return;
      const need = Math.max(...q.members.map(u => u.need || 1)),
        goal = box.path[box.path.length - 1];
      const o = this.isOpen(goal.x, goal.y, need) ? goal : this.nearestOpen(goal.x, goal.y, need) || this.nearestOpen(goal.x, goal.y);
      const way = o && this.route(box.x, box.y, o.x, o.y, need);
      if (!way) {
        box.path.length = 0;
        box.speed = 0;
        return;
      }
      box.path = way;
      box.sides = this.sideShifts(q, box, box, way);
      box.along = 0;
      return;
    }
    const u = e;
    if (u.dead || !u.path.length || u.path[0] === u.slotPt) return;
    const goal = u.path[u.path.length - 1],
      o = this.isOpen(goal.x, goal.y) ? goal : this.nearestOpen(goal.x, goal.y);
    u.path = (o && this.route(u.x, u.y, o.x, o.y, u.need)) || [];
  }

  repathSome() {
    const later = this.toRepath;
    if (!later || !later.size) return;
    let n = REPATH_PER_STEP;
    for (const e of later) {
      later.delete(e);
      this.repath(e);
      if (--n <= 0) break;
    }
  }

  areaOf(cells) {
    const n = this.n;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const k of cells) {
      const x = (k % n) * CELL,
        y = ((k / n) | 0) * CELL;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { x0: x0 - CELL, y0: y0 - CELL, x1: x1 + CELL, y1: y1 + CELL };
  }
  inArea(a, x, y) {
    return x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1;
  }
  crossesArea(a, x, y, path) {
    let px = x,
      py = y;
    for (const p of path) {
      const dx = p.x - px,
        dy = p.y - py;
      let t0 = 0,
        t1 = 1,
        ok = true;
      for (const [d, lo, hi, o] of [
        [dx, a.x0, a.x1, px],
        [dy, a.y0, a.y1, py]
      ]) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) {
            ok = false;
            break;
          }
          continue;
        }
        let ta = (lo - o) / d,
          tb = (hi - o) / d;
        if (ta > tb) {
          const t = ta;
          ta = tb;
          tb = t;
        }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
      px = p.x;
      py = p.y;
    }
    return false;
  }

  async addPoint(o, side = -1, t = o.type) {
    const pt = {
      type: t,
      x: o.pos[0],
      y: o.pos[1],
      z: o.pos[2],
      side,
      taker: -1,
      progress: 0,
      reinforce: t.behaviors().has('REINFORCEMENT_POINT') || /REINFORCEMENT_POINT/i.test(t.name),
      radius: t.num('Capture_Point_Radius', 100),
      seconds: t.num('Capture_Point_Transition_Time_Seconds', 10),
      enable: t.num('Reinforcement_Enabling_Radius', 250),
      cap: t.num('Additional_Population_Capacity', 0),
      inst: null
    };
    this.points.push(pt);
    const inst = await loadModel(t.str('Land_Model_Name'), { teamColor: NEUTRAL }).catch(() => null);
    if (!inst) return pt;
    pt.paint = [];
    inst.root.traverse(o => {
      const m = o.isMesh && o.material;
      if (!m || !m.uniforms || !m.uniforms.colorization || !m.defines || !m.defines.COLORIZE) return;
      const own = m.clone();
      for (const k in m.uniforms) if (m.uniforms[k].value && m.uniforms[k].value.isTexture) own.uniforms[k].value = m.uniforms[k].value;
      o.material = own;
      pt.paint.push(own);
    });
    const grp = new THREE.Group();
    grp.add(inst.root);
    grp.position.set(o.pos[0], o.pos[1], o.pos[2]);
    placeRotation(grp, o.rot);
    grp.scale.setScalar(t.num('Scale_Factor', 1) * (o.scale || 1));
    this.scene.add(grp);
    pt.inst = inst;
    pt.holder = grp;
    this.showOwner(pt);
    return pt;
  }

  paintPoint(pt) {
    if (!pt.inst) return;
    const col = side => (side >= 0 && this.colors[side]) || NEUTRAL,
      k = pt.taker >= 0 ? Math.min(1, pt.progress) : 0;
    const c = _paint.copy(col(pt.side)).lerp(col(pt.taker), k);
    for (const m of pt.paint || []) m.uniforms.colorization.value.set(c.r, c.g, c.b, 1);
    const taking = pt.taker >= 0 ? (this.factions[pt.taker] || '').toUpperCase() : '';
    if (taking !== (pt.showing || '') || taking) {
      pt.showing = taking;
      for (const [name, node] of pt.inst.meshByName) {
        const m = /^(EMPIRE|REBEL|UNDERWORLD)_SYMBOL/.exec(name);
        if (!m) continue;
        const holder = pt.side >= 0 && m[1] === (this.factions[pt.side] || '').toUpperCase(),
          coming = !!taking && m[1] === taking;
        const on = coming || (holder && !taking),
          bone = pt.inst.bone(name);
        node.visible = on;
        node.userData.hidByBone = false;
        if (bone) {
          bone.visible = on;
          bone.scale.setScalar(coming ? Math.max(0.05, k) : 1);
        }
      }
      pt.inst.syncFromBones();
    }
  }

  showOwner(pt) {
    if (!pt.inst) return;
    const faction = pt.side < 0 ? '' : (this.factions[pt.side] || '').toUpperCase();
    const rows = pt.type.tuples('Faction_Anim_Subindex');
    if (rows.length) {
      const row = rows.find(
        r =>
          String(r[0] || '')
            .trim()
            .toUpperCase() === (faction || 'NEUTRAL')
      );
      const sub = row ? parseInt(row[1], 10) : NaN,
        want = (pt.wantAnim = (pt.wantAnim || 0) + 1);
      if (Number.isFinite(sub)) {
        const files = [animOverride(pt.type), pt.type.str('Land_Model_Name')].filter(Boolean);
        (async () => {
          let a = null;
          for (const f of files) {
            a = await Promise.resolve(loadALA(animName(f, 'IDLE', sub))).catch(() => null);
            if (a) break;
          }
          if (!a || pt.wantAnim !== want) return;
          pt.anim = new AnimState(pt.inst, a, { loop: true });
          pt.anim.step(0);
          pt.inst.syncFromBones();
        })();
      }
      this.paintPoint(pt);
      return;
    }
    for (const [name, node] of pt.inst.meshByName) {
      const m = /^(EMPIRE|REBEL|UNDERWORLD)_SYMBOL/.exec(name);
      const on = m ? m[1] === faction : name === 'LIGHT_NEUTRAL' ? pt.side < 0 : null;
      if (on === null) continue;
      node.visible = on;
      node.userData.hidByBone = false;
      const bone = pt.inst.bone(name);
      if (bone) bone.visible = on;
    }
    pt.inst.syncFromBones();
    this.paintPoint(pt);
  }

  updateSight(side) {
    const eyes = [];
    for (const u of this.units)
      if (!u.dead && this.ally(u.side, side))
        eyes.push([
          u.x,
          u.y,
          ((u.sight ??= u.type.num('Land_FOW_Reveal_Range', 150)) * (u.structure ? 1 : this.sightMod(u))) ** 2,
          u.z + Math.max(8, u.aimZ * 1.5)
        ]);
    for (const p of this.points)
      if (p.side >= 0 && this.ally(p.side, side))
        eyes.push([p.x, p.y, (p.sight ??= p.type.num('Land_FOW_Reveal_Range', 250)) ** 2, p.z + 30]);
    for (const p of this.pings) if (this.ally(p.side, side)) eyes.push([p.x, p.y, p.r ** 2, 1e6]);
    let all = this.revealUntil[side] > this.time;
    if (this.reveals.length) {
      this.reveals = this.reveals.filter(r => r.until > this.time && !(r.by && (r.by.state === 'over' || r.by.env !== r.env)));
      for (const r of this.reveals)
        if (r.team.id === this.team[side]) {
          if (r.r >= 1e6) all = true;
          else eyes.push([r.x, r.y, r.r * r.r, 1e6]);
        }
    }
    this.eyes = all ? null : eyes.map(e => [e[0], e[1], Math.sqrt(e[2])]);
    for (const u of this.units) {
      if (this.ally(u.side, side)) {
        u.seen = true;
        continue;
      }
      let seen = all;
      if (!seen && !u.cloaked && u.spotted) {
        const C = this.fowCell,
          cx = Math.floor(u.x / C),
          cy = Math.floor(u.y / C);
        for (const s of u.spotted)
          if (s.until > this.time && this.ally(s.side, side) && (cx - s.cx) ** 2 + (cy - s.cy) ** 2 <= s.n * s.n) {
            seen = true;
            break;
          }
      }
      if (!seen && !u.cloaked)
        for (const e of eyes)
          if ((u.x - e[0]) ** 2 + (u.y - e[1]) ** 2 <= e[2] && (u.flies || this.sightLine(e[0], e[1], e[3], u))) {
            seen = true;
            break;
          }
      if (!u.cloaked) {
        const C = (this.fowCell ||= db.constants.num('DesiredLandFOWCellSize', 15)),
          cell = Math.floor(u.x / C) * 65536 + Math.floor(u.y / C);
        const l = (u.lastSeen ||= []);
        let e = null;
        for (const x of l)
          if (x.side === side) {
            e = x;
            break;
          }
        if (seen) {
          if (e) {
            e.cell = cell;
            e.at = this.time;
          } else l.push({ side, cell, at: this.time });
        } else if (e && this.time - e.at < (this.fowRegrow ??= db.constants.num('LandFOWRegrowTime', 6)) && e.cell === cell) seen = true;
      }
      if (seen && u.structure) u.everSeen = true;
      u.seen = !!((seen && !u.cloaked) || (u.structure && u.everSeen));
    }
  }

  firedOn(u, t) {
    if (t.side < 0 || this.ally(t.side, u.side)) return;
    const until = this.time + db.constants.num('LandFOWRegrowTime', 6),
      C = (this.fowCell ||= db.constants.num('DesiredLandFOWCellSize', 15));
    const cx = Math.floor(u.x / C),
      cy = Math.floor(u.y / C),
      n = Math.floor((u.inst && u.inst.radius ? u.inst.radius * (u.holder ? u.holder.scale.x : 1) : 10) / C + 0.5);
    const list = (u.spotted ||= []);
    for (const s of list)
      if (s.side === t.side) {
        s.cx = cx;
        s.cy = cy;
        s.n = n;
        s.until = until;
        return;
      }
    list.push({ side: t.side, cx, cy, n, until });
  }

  sightLine(ex, ey, ez, u) {
    const tz = u.z + Math.max(8, (u.aimZ || 8) * 1.2),
      d = Math.hypot(u.x - ex, u.y - ey);
    if (d < 60 || ez > 1e5) return true;
    const steps = Math.min(8, Math.ceil(d / 45));
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      if (heightAt(this.terrain, ex + (u.x - ex) * k, ey + (u.y - ey) * k) > ez + (tz - ez) * k + 4) return false;
    }
    return true;
  }

  popCap(side) {
    if (this.popOverride) return this.popOverride;
    if (this.campaign && side !== this.campaignAttacker) return db.constants.num('Max_Ground_Forces_On_Planet', 10);
    if (this.campaign) {
      const base = db.faction(this.factions[side])?.num('Base_Population_Capacity', 0) || 0;
      const capacity = this.points.reduce((n, p) => n + (p.side >= 0 && this.ally(p.side, side) && p.reinforce ? p.cap : 0), base);
      return Math.min(db.constants.num('Max_Ground_Forces_On_Planet', 10), capacity);
    }
    return Math.min(
      this.popLimit,
      this.points.reduce((a, p) => a + (p.side >= 0 && this.ally(p.side, side) && p.reinforce ? p.cap : 0), 0)
    );
  }
  popUsed(side) {
    const seen = new Set();
    let n = 0;
    for (const q of this.squads) {
      if (q.side !== side || !q.members.length || q.structure || q.native || this.campaignGarrison.has(q.company) || seen.has(q.company))
        continue;
      if (q.company !== undefined) seen.add(q.company);
      n += landPop(q.type);
    }
    return n;
  }
  popPlanned(side) {
    let n = this.popUsed(side) + this.ready[side].reduce((a, t) => a + landPop(t), 0);
    for (const q of this.queues[side] ? this.queues[side].units : []) n += landPop(q.type);
    return n;
  }

  cantReinforce(side, typeName, x, y, extraPop = 0) {
    const t = db.type(typeName);
    if (!t) return 'Unknown unit';
    if (this.popUsed(side) + extraPop + landPop(t) > this.popCap(side)) return 'Population limit reached - hold more reinforcement points';
    if (!this.points.some(p => p.reinforce && p.side >= 0 && this.ally(p.side, side) && Math.hypot(p.x - x, p.y - y) <= p.enable))
      return 'Not near a reinforcement point you hold';
    if (!this.nearestOpen(x, y)) return 'No room there';
    if (
      this.units.some(
        u => u.structure && !u.dead && !this.ally(u.side, side) && u.noReinforce > 0 && Math.hypot(u.x - x, u.y - y) <= u.noReinforce
      )
    )
      return 'Too close to the enemy base';
    return null;
  }

  updatePoints(dt) {
    for (const pt of this.points) {
      if (pt.anim) pt.anim.step(dt);
      if (pt.locked) continue;
      const here = new Set();
      for (const u of this.units)
        if (
          !u.dead &&
          !u.inside &&
          u.captures &&
          (u.x - pt.x) ** 2 + (u.y - pt.y) ** 2 <= pt.radius * pt.radius &&
          ![...here].some(s => this.ally(s, u.side))
        )
          here.add(u.side);
      const only = here.size === 1 ? [...here][0] : -1;
      if (only >= 0 && !(pt.side >= 0 && this.ally(only, pt.side))) {
        if (!(pt.taker >= 0 && this.ally(pt.taker, only))) {
          pt.taker = only;
          pt.progress = 0;
        }
        pt.progress += dt / pt.seconds;
        if (pt.progress >= 1) {
          pt.side = only;
          pt.taker = -1;
          pt.progress = 0;
          this.showOwner(pt);
          if (this.onCapture) this.onCapture(pt);
        }
      } else {
        if (pt.taker >= 0) {
          pt.taker = -1;
          pt.progress = 0;
          this.showOwner(pt);
        }
        pt.taker = -1;
        pt.progress = 0;
      }
      if (pt.taker >= 0) this.paintPoint(pt);
    }
  }

  addBaseSite(o, side, built = false) {
    const faction = this.factions[side];
    let options = [];
    for (const name of o.type.list('Marker_For_Specific_Object_Type')) {
      const pad = db.type(name);
      options = pad ? buildsFor(pad, faction) : [];
      if (options.length) break;
    }
    if (!options.length) return null;
    const site = {
      base: true,
      side,
      point: null,
      pad: db.type(o.type.list('Marker_For_Specific_Object_Type').find(n => db.type(n) && buildsFor(db.type(n), faction).length) || ''),
      x: o.pos[0],
      y: o.pos[1],
      z: o.pos[2],
      rot: o.rot,
      scale: o.scale || 1,
      options,
      structure: null,
      building: null
    };
    this.sites.push(site);
    const file = site.pad ? site.pad.str('Land_Model_Name') : '';
    if (file)
      loadModel(file, {
        teamColor: this.colors[side] || null,
        alt: Math.max(
          ...site.pad
            .list('Land_Damage_Alternates')
            .map(Number)
            .filter(n => n > 0),
          0
        )
      })
        .then(inst => {
          if (!inst) return;
          const holder = new THREE.Group();
          holder.add(inst.root);
          holder.position.set(site.x, site.y, heightAt(this.terrain, site.x, site.y));
          placeRotation(holder, site.rot);
          holder.scale.setScalar(site.pad.num('Scale_Factor', 1) * site.scale);
          holder.visible = !site.structure;
          site.padHolder = holder;
          holder.userData.casts = true;
          this.scene.add(holder);
        })
        .catch(() => {});
    return built ? this.finishSite(site, options[0]).then(() => site) : site;
  }

  deployBuilder(u, on) {
    if (!on) {
      if (u.padSite) {
        this.sites = this.sites.filter(s => s !== u.padSite);
        u.padSite = null;
      }
      return;
    }
    if (
      !u.type
        .list('DeployedBehavior')
        .flatMap(x => x.split(/[\s,]+/))
        .some(x => x.toUpperCase() === 'TACTICAL_BUILD_OBJECTS')
    )
      return;
    const options = buildsFor(u.type, this.factions[u.side]);
    if (!options.length || u.padSite) return;
    let x = u.x,
      y = u.y,
      z = u.z;
    const bone = u.inst && u.inst.bone ? u.inst.bone(u.type.str('Tactical_Build_Attachment_Bone_Name').trim()) : null;
    if (bone && u.holder) {
      u.holder.updateMatrixWorld(true);
      this.boneAt(u, bone, _up);
      x = _up.x;
      y = _up.y;
      z = _up.z;
    }
    u.padSite = {
      base: true,
      side: u.side,
      point: null,
      pad: u.type,
      mdu: u,
      x,
      y,
      z,
      rot: [0, 0, (u.heading - FACING) / DEG],
      scale: 1,
      options,
      structure: null,
      building: null,
      readyAt: 0
    };
    this.sites.push(u.padSite);
  }

  addPadSite(pt, o) {
    const site = {
      base: false,
      side: -1,
      point: pt,
      pad: pt.type,
      x: o.pos[0],
      y: o.pos[1],
      z: o.pos[2],
      rot: o.rot,
      scale: o.scale || 1,
      options: null,
      structure: null,
      building: null
    };
    this.sites.push(site);
    return site;
  }

  siteOptions(site, side) {
    if (site.structure || site.building) return [];
    if (site.readyAt > this.time) return [];
    if (site.mdu) {
      const m = site.mdu,
        r = m.type.num('Capture_Point_Radius', 200);
      if (
        m.dead ||
        !m.deployed ||
        this.units.some(o => !o.dead && o.side >= 0 && !this.ally(o.side, m.side) && Math.hypot(o.x - m.x, o.y - m.y) < r)
      )
        return [];
    }
    if (site.base) return this.ally(site.side, side) ? site.options : [];
    return site.point.side >= 0 && this.ally(site.point.side, side) ? buildsFor(site.point.type, this.factions[side], this.campaign) : [];
  }

  startSite(site, uc, side) {
    if (!this.siteOptions(site, side).includes(uc)) return 'Cannot be built there';
    if (this.credits[side] < costOf(uc)) return 'Not enough credits';
    this.credits[side] -= costOf(uc);
    const secs = timeOf(uc) * this.mods[side].build;
    site.building = { uc, type: uc, side, left: secs, total: secs };
    return null;
  }

  async finishSite(site, uc, side = site.side) {
    const type = db.type(uc.str('Tactical_Buildable_Constructed')) || uc;
    const file = type.str('Land_Model_Name'),
      inst = file && (await loadModel(file, { teamColor: this.colors[side] || null, alts: true }).catch(() => null));
    if (!inst) {
      site.building = null;
      return null;
    }
    const holder = new THREE.Group();
    holder.add(inst.root);
    if (!site.mdu && !site.wall) site.z = heightAt(this.terrain, site.x, site.y);
    holder.position.set(site.x, site.y, site.z);
    placeRotation(holder, site.rot);
    holder.scale.setScalar(type.num('Scale_Factor', 1) * site.scale);
    if (!site.mdu && !site.wall && inst.box && !inst.box.isEmpty()) {
      holder.updateMatrixWorld(true);
      const b = inst.box,
        v = new THREE.Vector3();
      let low = site.z;
      for (let i = 0; i <= 4; i++)
        for (let j = 0; j <= 4; j++) {
          v.set(
            b.min.x + (b.max.x - b.min.x) * (0.06 + (0.88 * i) / 4),
            b.min.y + (b.max.y - b.min.y) * (0.06 + (0.88 * j) / 4),
            0
          ).applyMatrix4(holder.matrixWorld);
          low = Math.min(low, heightAt(this.terrain, v.x, v.y));
        }
      site.z = Math.max(site.z - 45, low);
      holder.position.z = site.z;
    }
    holder.userData.casts = true;
    this.scene.add(holder);
    const squad = new LandSquad(this, type, side, { structure: true });
    const inc = type.sub ? type.sub('Abilities').flatMap(a => a.all('Income_Stream_Ability'))[0] : null;
    const u = landUnit({
      type,
      squad,
      off: { x: 0, y: 0 },
      holder,
      inst,
      x: site.x,
      y: site.y,
      z: site.z,
      heading: site.rot[2] * DEG,
      speed: 0,
      turn: 0,
      path: [],
      anims: {},
      anim: null,
      animKind: '',
      side,
      dead: false,
      gone: false,
      target: null,
      structure: true,
      site,
      maxHealth: type.num('Tactical_Health', 1000),
      health: type.num('Tactical_Health', 1000),
      maxShield: type.num('Shield_Points', 0),
      shield: type.num('Shield_Points', 0),
      armor: type.str('Armor_Type'),
      aimZ: type.num('Ranged_Target_Z_Adjust', 25),
      range: type.num('Targeting_Max_Attack_Distance', 0),
      weapon: null,
      turret: null,
      kind: 'STRUCTURE',
      hitRadius: Math.max(20, type.num('Select_Box_Scale', 90) * 0.3),
      captures: false,
      inaccuracy: new Map(type.tuples('Targeting_Fire_Inaccuracy').map(([c, v]) => [c.toUpperCase(), parseFloat(v)])),
      builds: buildsFor(type, this.factions[side], this.campaign).filter(t => t.has('Company_Units') || isUpgrade(t)),
      queue: [],
      income: inc
        ? {
            value: inc.num('Base_Income_Value', 0),
            every: inc.num('Base_Interval_In_Secs', 5),
            timer: 0,
            skirmish: /^skirmish_automatic$/i.test(inc.val('Activation_Style').trim())
          }
        : null,
      isBase: /COMMAND.?CENTER|PALACE/i.test(type.name),
      heals: (type.sub ? type.sub('Abilities').flatMap(a => a.all('Force_Healing_Ability')) : []).map(a => ({
        range: a.num('Heal_Range', 0),
        amount: a.num('Heal_Amount', 0),
        percent: a.num('Heal_Percent', 0),
        every: Math.max(0.2, a.num('Heal_Interval_In_Secs', 1)),
        timer: 0,
        cats: a
          .val('Applicable_Unit_Categories')
          .split(/[\s,|]+/)
          .filter(Boolean)
          .map(x => x.toUpperCase()),
        types: a
          .val('Applicable_Unit_Types')
          .split(/[\s,|]+/)
          .filter(Boolean)
          .map(x => x.toUpperCase()),
        excluded: a
          .val('Excluded_Unit_Types')
          .split(/[\s,|]+/)
          .filter(Boolean)
          .map(x => x.toUpperCase()),
        sfx: a.val('SFXEvent_Target_Affected'),
        fx: a.val('Target_Particle_Effect')
      }))
    });
    this.arm(u, type, side, () => 1);
    const proj = u.weapon && u.weapon.proj;
    if (proj) {
      const tb = inst.bone(type.str('Turret_Bone_Name'));
      u.turret = tb
        ? {
            bone: tb,
            yaw: 0,
            extent: Math.PI,
            speed: type.num('Turret_Rotate_Speed', 3),
            axis: type.num('Apply_Z_Turret_Rotate_To_Axis', 2),
            barrel: null,
            pitch: 0,
            wantPitch: 0,
            lift: 0.5,
            pitchAxis: 1
          }
        : null;
      if (!tb) u.turn = 3;
      u.fixedHeading = !!tb;
      this.muzzlesOf(u, type, inst);
    }
    squad.members.push(u);
    this.units.push(u);
    this.squads.push(squad);
    if (
      /TACTICAL_SELL/i.test(type.str('Behavior') + ' ' + type.str('LandBehavior')) &&
      site.pad &&
      side >= 0 &&
      side < this.factions.length
    ) {
      u.sellFor = type.num('Tactical_Sell_Credits', 0);
      squad.abilities.push({
        def: {
          kind: 'SELL',
          label: `${db.t('TEXT_TOOLTIP_SELL_STRUCTURE') || 'Sell the current structure'} (${u.sellFor})`,
          text: db.t('TEXT_BUTTON_SELL') || 'Sell',
          aim: 'none',
          target: 'none',
          recharge: 0
        },
        active: false,
        cooldown: 0,
        auto: false
      });
    }
    const idleA = await animOf(type, 'IDLE'),
      buildA = idleA ? null : await animOf(type, 'BUILD');
    if (idleA) u.anim = new AnimState(inst, idleA, { loop: true, time: simRandom() * idleA.duration });
    else if (buildA) {
      new AnimState(inst, buildA).seek(1);
      inst.syncFromBones();
    } else {
      holder.updateMatrixWorld(true);
      let low = Infinity;
      const part = new THREE.Box3();
      for (const [name, node] of inst.meshByName) {
        if (/SHADOW|COLLISION|GIRDER|BLAST|MUZZLE|LIGHT/i.test(name)) continue;
        node.traverse(o => {
          if (!o.isMesh || !o.geometry) return;
          for (let a = o; a && a !== holder.parent; a = a.parent) if (!a.visible) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          low = Math.min(low, part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).min.z);
        });
      }
      if (Number.isFinite(low) && low - site.z > 4) holder.position.z -= low - site.z;
    }
    equip(u);
    site.structure = u;
    site.building = null;
    site.side = side;
    site.builtFrom = uc.name;
    this.stamp(u);
    return u;
  }

  grant(side, type) {
    this.owned[side].add(type.name);
    for (const u of this.units) if (this.ally(u.side, side) && !u.dead) this.applyUpgrade(u, type);
    if (!type.sub) return;
    const abs = type.sub('Abilities');
    for (const a of abs.flatMap(x => x.all('Bounty_On_Faction_Ability')))
      this.bounty.add(side, a, type.name.toUpperCase(), this.teamSides(side));
    if (abs.some(x => x.all('Weatherproof_Ability').length)) {
      for (const s of this.teamSides(side)) (this.weatherproof ||= new Set()).add(s);
      for (const u of this.units) u.wx = null;
    }
    for (const a of abs.flatMap(x => x.all('Garrison_Upgrade_Ability'))) {
      const base =
        this.units.find(u => u.isBase && !u.dead && this.ally(u.side, side)) ||
        this.units.find(u => u.structure && !u.dead && this.ally(u.side, side));
      if (!base) continue;
      a.val('Additional_Garrison_Units')
        .split(/[\s,]+/)
        .filter(n => db.type(n))
        .forEach((n, i) => {
          const ang = base.heading + 1 + i * 0.9,
            o =
              this.nearestOpen(base.x + Math.cos(ang) * (base.hitRadius + 90), base.y + Math.sin(ang) * (base.hitRadius + 90), 2) ||
              this.nearestOpen(base.x, base.y);
          if (o) Promise.resolve(this.spawn(n, o.x, o.y, ang, side)).catch(() => {});
        });
    }
  }

  applyUpgrade(u, type) {
    if (!type.sub || u.structure) return;
    for (const a of type.sub('Abilities').flatMap(x => x.all('Enable_Ability'))) {
      const names = a
          .val('Applicable_Unit_Types')
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(n => n.toUpperCase()),
        cats = a
          .val('Applicable_Unit_Categories')
          .split(/[\s,|]+/)
          .filter(Boolean)
          .map(n => n.toUpperCase());
      if (!(names.includes(u.type.name.toUpperCase()) || cats.some(c => inCategory(u.type, c)))) continue;
      const d = (u.deflects || []).find(x => x.name === a.val('Ability_Name').toUpperCase());
      if (d) {
        d.on = true;
        u.deflect = u.deflects.filter(x => x.on).sort((p, q) => q.back + q.block - p.back - p.block)[0] || null;
      }
    }
    for (const a of type.sub('Abilities').flatMap(x => x.all('Combat_Bonus_Ability'))) {
      const names = a
        .val('Applicable_Unit_Types')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(n => n.toUpperCase());
      const cats = a
        .val('Applicable_Unit_Categories')
        .split(/[\s,|]+/)
        .filter(Boolean)
        .map(n => n.toUpperCase());
      const mine = [u.type.name.toUpperCase(), u.squad.type.name.toUpperCase()];
      if (!(names.some(n => mine.includes(n)) || cats.some(c => inCategory(u.type, c)))) continue;
      const pct = k => a.num(k, 0);
      const hp = pct('Health_Bonus_Percentage'),
        sh = pct('Shield_Bonus_Percentage'),
        dmg = pct('Damage_Bonus_Percentage'),
        def = pct('Defense_Bonus_Percentage'),
        spd = pct('Movement_Speed_Bonus_Percentage') || pct('Speed_Bonus_Percentage');
      if (hp) {
        u.maxHealth *= 1 + hp;
        u.health *= 1 + hp;
      }
      if (sh) {
        u.maxShield *= 1 + sh;
        u.shield *= 1 + sh;
      }
      if (dmg && u.weapon) u.weapon.damage *= 1 + dmg;
      if (def) u.defense = (u.defense ?? 1) * (1 - Math.min(0.9, def));
      if (spd) u.speed *= 1 + spd;
    }
  }

  buy(u, type, side = u.side) {
    const why = this.cantBuy(u, type, side);
    if (why) return why;
    this.credits[side] -= costOf(type);
    const secs = timeOf(type) * this.mods[side].build;
    this.queueOf(side, type).push({ type, left: secs, total: secs, from: u, side });
    return null;
  }
  queueOf(side, type) {
    return isUpgrade(type) ? this.queues[side].upgrades : this.queues[side].units;
  }

  cantBuy(u, type, side = u.side) {
    if (u.dead || !this.ally(u.side, side) || !buildsFor(u.type, this.factions[side], this.campaign).includes(type)) return 'Not sold here';
    if (this.queueOf(side, type).length >= 5) return 'The queue is full';
    if (isHeroCompany(type)) {
      const team = this.teamSides(side);
      if (
        this.squads.some(q => q.type === type && q.members.length && team.includes(q.side)) ||
        this.transports.some(t => t.typeName === type.name && team.includes(t.side)) ||
        team.some(s => this.ready[s].includes(type) || this.queues[s].units.some(q => q.type === type))
      )
        return 'Already with your forces';
    }
    const lacks = missingFor(this, side, type);
    if (lacks.length) return 'Requires ' + lacks.map(p => db.t(p.str('Text_ID')) || p.name.replace(/_/g, ' ')).join(', ');
    if (this.credits[side] < costOf(type)) return 'Not enough credits';
    if (isUpgrade(type)) {
      if (this.owned[side].has(type.name) || this.teamSides(side).some(s => this.queues[s].upgrades.some(q => q.type === type)))
        return 'Already bought';
      return null;
    }
    if (this.popPlanned(side) + landPop(type) > this.popCap(side)) return 'Population limit reached - hold more reinforcement points';
    return null;
  }

  cancel(side, list, index) {
    const q = list[index];
    if (!q) return;
    list.splice(index, 1);
    this.credits[side] += costOf(q.type);
  }
  cancelSite(site) {
    const b = site && site.building;
    if (!b || b.done) return;
    site.building = null;
    this.credits[b.side] += costOf(b.uc);
  }

  useAbility(squad, kind, tgt = null) {
    if (kind === 'UNLOAD') {
      for (const u of squad.members) if (u.holds && u.holds.length) ungarrison(this, u);
      return null;
    }
    return kind === 'SELL' ? this.sell(squad.members[0]) : useAbility(this, squad, kind, tgt);
  }

  abilityBlocked(squad, kind) {
    return abilityBlocked(this, squad, kind);
  }

  sell(u) {
    if (!u || u.dead || !u.structure || u.sellFor === undefined) return 'Cannot be sold';
    this.credits[u.side] += u.sellFor;
    if (this.onSound) this.onSound(u.type.str('SFXEvent_Sold_Tactical'), u.x, u.y);
    u.dead = true;
    u.gone = true;
    u.target = null;
    u.died = -1e9;
    u.health = 0;
    if (u.site) {
      u.site.structure = null;
      u.site.readyAt = this.time + (u.site.pad ? u.site.pad.num('Minimum_Time_Before_Pad_Can_Build_Again', 0) : 0);
    }
    this.unstamp(u);
    if (u.holds && u.holds.length) ungarrison(this, u);
    this.scene.remove(u.holder);
    u.squad.members = [];
    return null;
  }
  groundZ(x, y) {
    return heightAt(this.terrain, x, y);
  }
  bombard(squad, x, y) {
    const mark = {
      x,
      y,
      z: this.groundZ(x, y),
      aimZ: 0,
      kind: 'STRUCTURE',
      hitRadius: -1,
      side: this.wild,
      dead: false,
      flies: false,
      type: squad.type,
      spot: true,
      path: []
    };
    mark.squad = { members: [mark], side: this.wild, spot: true, abilities: [] };
    this.attack(squad, mark.squad);
  }

  sliceOver() {
    return performance.now() - (this.sliceAt || 0) > SLICE_MS;
  }
  nextSlice() {
    return new Promise(r => {
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        if (this.sliceOver()) this.sliceAt = performance.now();
        r();
      };
      requestAnimationFrame(go);
      setTimeout(go, 50);
    });
  }

  squadOf(type, side, extra) {
    return new LandSquad(this, type, side, extra);
  }

  companyLost(u) {
    const q = u.squad;
    if (!q) return false;
    const mates = q.company !== undefined ? this.squads.filter(x => x.company === q.company && x.side === q.side) : [q];
    if (!mates.includes(q)) mates.push(q);
    return !mates.some(x => x.members.some(m => m !== u && !m.dead));
  }

  boneAt(u, bone, out) {
    if (!this.fixed && u.inView !== false) {
      bone.getWorldPosition(out);
      return out;
    }
    const r = bone.userData.restAt;
    if (!r) return out.set(u.x, u.y, u.z);
    const s = u.holder ? u.holder.scale.x : 1,
      T = u.turret;
    let a = u.heading + Math.PI / 2;
    if (T && (T.axis ?? 2) === 2 && T.bone) {
      let b = bone;
      while (b && b !== T.bone) b = b.parent;
      if (b) a += T.yaw || 0;
    }
    const c = Math.cos(a),
      sn = Math.sin(a);
    return out.set(u.x + (r.x * c - r.y * sn) * s, u.y + (r.x * sn + r.y * c) * s, u.z + r.z * s);
  }

  show(u, dt) {
    const l = this.look;
    if (u.holder && !u.holder.visible) return;
    if (l && (u.x - l.x) ** 2 + (u.y - l.y) ** 2 > l.r * l.r) return;
    if (l && l.see && !l.see(u, POSE_MARGIN)) return;
    if (!u.foot && !u.structure && !u.flies && !u.flight && u.scriptZ === undefined && u.kind === 'VEHICLE') {
      const c = Math.cos(u.heading),
        sn = Math.sin(u.heading),
        d = 10,
        t = this.terrain;
      const fz = heightAt(t, u.x + c * d, u.y + sn * d) - heightAt(t, u.x - c * d, u.y - sn * d);
      const sz = heightAt(t, u.x - sn * d, u.y + c * d) - heightAt(t, u.x + sn * d, u.y - c * d);
      _up.set(-(fz * c - sz * sn) / (2 * d), -(fz * sn + sz * c) / (2 * d), 1).normalize();
      u.holder.quaternion.copy(_tilt.setFromUnitVectors(_Z, _up)).multiply(_turn.setFromAxisAngle(_Z, u.heading + Math.PI / 2));
    }
    if (this.interp) {
      if (!u.inPose) {
        u.inPose = true;
        this.toPose.push(u);
      }
      return;
    }
    if (!u.poseDt) this.toPose.push(u);
    u.poseDt = (u.poseDt || 0) + dt;
  }

  poseQueued(dt = 0) {
    const l = this.toPose;
    if (this.interp) {
      if (dt > 0)
        for (let i = 0; i < l.length; i++) {
          const u = l[i];
          if (!u.gone) this.pose(u, dt);
        }
      return;
    }
    for (let i = 0; i < l.length; i++) {
      const u = l[i],
        dt = u.poseDt;
      u.poseDt = 0;
      if (!u.gone) this.pose(u, dt);
    }
    l.length = 0;
  }

  snapPrev() {
    const l = this.toPose;
    for (let i = 0; i < l.length; i++) l[i].inPose = false;
    l.length = 0;
    const step = (this.stepNo = (this.stepNo || 0) + 1);
    for (const u of this.units) {
      u.ix = u.x;
      u.iy = u.y;
      u.iz = u.z;
      u.ih = u.heading;
      u.istep = step;
      const h = u.holder;
      if (h) {
        (u.ipos ||= new THREE.Vector3()).copy(h.position);
        (u.iq ||= new THREE.Quaternion()).copy(h.quaternion);
        u.ihold = h;
      }
      const T = u.turret;
      if (T) {
        T.iyaw = T.yaw;
        T.ipitch = T.pitch;
      }
      if (u.guns)
        for (const g of u.guns) {
          const G = g.turret;
          if (G) {
            G.iyaw = G.yaw;
            G.ipitch = G.pitch;
          }
        }
    }
    for (const s of this.shots) {
      s.ix = s.x;
      s.iy = s.y;
      s.iz = s.z;
      s.istep = step;
    }
  }

  lerpIn(a) {
    const step = this.stepNo,
      L = (this.lerped ||= []),
      S = (this.lerpedShots ||= []);
    L.length = 0;
    S.length = 0;
    if (!(a > 0) || !step) return;
    if (a > 1) a = 1;
    const ang = (from, to) => {
      const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
      return from + d * a;
    };
    for (const u of this.units) {
      if (u.istep !== step || (u.dead && u.gone)) continue;
      const far = Math.max(60, ((u.speed || 0) / LOGIC_FPS) * 3);
      if ((u.x - u.ix) ** 2 + (u.y - u.iy) ** 2 > far * far) continue;
      const r = (u.lerp ||= {});
      r.x = u.x;
      r.y = u.y;
      r.z = u.z;
      r.h = u.heading;
      u.x = u.ix + (u.x - u.ix) * a;
      u.y = u.iy + (u.y - u.iy) * a;
      u.z = u.iz + (u.z - u.iz) * a;
      u.heading = ang(u.ih, u.heading);
      r.lx = u.x;
      r.ly = u.y;
      r.lz = u.z;
      r.lh = u.heading;
      const h = u.holder;
      r.hold = h && u.ihold === h ? h : null;
      if (r.hold) {
        (r.pos ||= new THREE.Vector3()).copy(h.position);
        (r.q ||= new THREE.Quaternion()).copy(h.quaternion);
        h.position.lerpVectors(u.ipos, r.pos, a);
        h.quaternion.slerpQuaternions(u.iq, r.q, a);
        (r.lpos ||= new THREE.Vector3()).copy(h.position);
        (r.lq ||= new THREE.Quaternion()).copy(h.quaternion);
      }
      const T = u.turret;
      if (T && T.iyaw !== undefined) {
        r.ty = T.yaw;
        r.tp = T.pitch;
        T.yaw = ang(T.iyaw, T.yaw);
        T.pitch = T.ipitch + (T.pitch - T.ipitch) * a;
        r.lty = T.yaw;
        r.ltp = T.pitch;
      } else r.ty = undefined;
      if (u.guns) {
        const G = (r.guns ||= []);
        G.length = 0;
        for (const g of u.guns) {
          const t = g.turret;
          if (!t || t.iyaw === undefined) continue;
          G.push(t, t.yaw, t.pitch);
          t.yaw = ang(t.iyaw, t.yaw);
          t.pitch = t.ipitch + (t.pitch - t.ipitch) * a;
          G.push(t.yaw, t.pitch);
        }
      }
      L.push(u);
    }
    for (const s of this.shots) {
      if (s.istep !== step) continue;
      const r = (s.lerp ||= {});
      r.x = s.x;
      r.y = s.y;
      r.z = s.z;
      s.x = s.ix + (s.x - s.ix) * a;
      s.y = s.iy + (s.y - s.iy) * a;
      s.z = s.iz + (s.z - s.iz) * a;
      r.lx = s.x;
      r.ly = s.y;
      r.lz = s.z;
      S.push(s);
    }
  }

  lerpOut() {
    for (const u of this.lerped || []) {
      const r = u.lerp;
      const same = Object.is;
      if (same(u.x, r.lx)) u.x = r.x;
      if (same(u.y, r.ly)) u.y = r.y;
      if (same(u.z, r.lz)) u.z = r.z;
      if (same(u.heading, r.lh)) u.heading = r.h;
      const h = r.hold;
      if (h) {
        if (h.position.equals(r.lpos)) h.position.copy(r.pos);
        if (h.quaternion.equals(r.lq)) h.quaternion.copy(r.q);
      }
      const T = u.turret;
      if (T && r.ty !== undefined) {
        if (same(T.yaw, r.lty)) T.yaw = r.ty;
        if (same(T.pitch, r.ltp)) T.pitch = r.tp;
      }
      const G = r.guns;
      if (G)
        for (let i = 0; i < G.length; i += 5) {
          const t = G[i];
          if (same(t.yaw, G[i + 3])) t.yaw = G[i + 1];
          if (same(t.pitch, G[i + 4])) t.pitch = G[i + 2];
        }
    }
    for (const s of this.lerpedShots || []) {
      const r = s.lerp,
        same = Object.is;
      if (same(s.x, r.lx)) s.x = r.x;
      if (same(s.y, r.ly)) s.y = r.y;
      if (same(s.z, r.lz)) s.z = r.z;
    }
    if (this.lerped) this.lerped.length = 0;
    if (this.lerpedShots) this.lerpedShots.length = 0;
  }

  tickOrders(dt) {
    const guard = db.constants.num('Land_Guard_Range', 150),
      all = this.squads,
      n = all.length;
    if (!n) return;
    this.ordersOwed = Math.min(n, (this.ordersOwed || 0) + (n * dt) / 0.2);
    let k = Math.floor(this.ordersOwed),
      i = this.ordersAt || 0;
    this.ordersOwed -= k;
    const batch = (this.ordersBatch ||= []);
    batch.length = 0;
    while (k-- > 0) {
      if (i >= n) i = 0;
      batch.push(all[i++]);
    }
    this.ordersAt = i;
    for (const q of batch) {
      if (!(q.march || q.post || (q.legs && q.legs.length)) || !q.members.length || q.structure) continue;
      const lead = q.members[0],
        moving = q.members.some(u => u.path.length),
        fighting = q.foe || q.members.some(u => u.target);
      if (q.foe && !q.foe.members.length) q.foe = null;
      if (q.post) {
        if (q.foe && Math.hypot(lead.x - q.post.x, lead.y - q.post.y) > guard * 2) {
          q.foe = null;
          for (const u of q.members) u.target = null;
          this.order(q, q.post.x, q.post.y);
          continue;
        }
        if (!q.foe) {
          const e = this.nearestFoe(
            { x: q.post.x, y: q.post.y, side: q.side, type: lead.type, prioSet: lead.prioSet, antiAir: lead.antiAir ?? false },
            this.units,
            guard
          );
          if (e) {
            this.attack(q, e.squad);
            continue;
          }
          if (!moving && Math.hypot(lead.x - q.post.x, lead.y - q.post.y) > 60) this.order(q, q.post.x, q.post.y);
        }
        continue;
      }
      if (q.march) {
        if (!q.foe) {
          const e = this.nearestFoe(lead, this.units, Math.max(lead.range, 120));
          if (e) {
            this.attack(q, e.squad);
            continue;
          }
          if (Math.hypot(lead.x - q.march.x, lead.y - q.march.y) < 70) q.march = null;
          else if (!moving && !fighting) {
            const S = q.marchStill;
            if (S && S.of === q.march && Math.hypot(lead.x - S.x, lead.y - S.y) < 15) q.march = null;
            else {
              q.marchStill = { x: lead.x, y: lead.y, of: q.march };
              this.order(q, q.march.x, q.march.y);
            }
          }
        }
        continue;
      }
      if (!moving && !fighting) {
        const p = q.legs.shift();
        this.order(q, p.x, p.y);
      }
    }
  }

  stop(squad) {
    squad.foe = null;
    squad.pending = null;
    squad.busy = false;
    squad.march = null;
    squad.post = null;
    squad.legs = null;
    squad.formMove = null;
    for (const u of squad.members) {
      u.path = [];
      u.target = null;
    }
    if (squad.box) {
      squad.box.path.length = 0;
      squad.box.speed = 0;
    }
  }

  incomeMod(u, side = u.side) {
    const best = new Map();
    for (const n of this.owned[side] || []) {
      const t = db.type(n);
      if (!t || !t.sub) continue;
      for (const a of t.sub('Abilities').flatMap(x => x.all('Income_Stream_Mod_Ability'))) {
        if (a.val('Target_Stream_Source').toUpperCase() !== u.type.name.toUpperCase()) continue;
        const k = a.val('Stacking_Category'),
          m = a.num('Income_Multiplier', 1);
        if (!best.has(k) || m > best.get(k)) best.set(k, m);
      }
    }
    let m = 1;
    for (const v of best.values()) m *= v;
    return m;
  }

  crushPass() {
    const cell = 32,
      grid = new Map(),
      list = [];
    for (const u of this.units) {
      if (u.dead || u.structure || u.kind === 'STRUCTURE' || u.flight || u.rope || u.inside || u.cinematicTransport || u.scriptHidden)
        continue;
      const k = Math.floor(u.x / cell) * 4096 + Math.floor(u.y / cell);
      (grid.get(k) || grid.set(k, []).get(k)).push(u);
      if (u.crusher && u.path.length) list.push(u);
    }
    for (const a of list) {
      const gx = Math.floor(a.x / cell),
        gy = Math.floor(a.y / cell);
      for (let i = gx - 1; i <= gx + 1; i++)
        for (let j = gy - 1; j <= gy + 1; j++) {
          for (const b of grid.get(i * 4096 + j) || []) {
            if (
              b === a ||
              b.dead ||
              a.dead ||
              b.flies !== a.flies ||
              b.inside ||
              this.ally(b.side, a.side) ||
              !(b.squashable || (a.supercrusher && b.squashableBig))
            )
              continue;
            const d = Math.hypot(b.x - a.x, b.y - a.y),
              want = a.body + b.body;
            if (d < (b.foot ? want : want * 0.8)) this.hurt(b, 1e9, null, 'CRUSHED');
          }
        }
    }
  }

  updateEconomy(dt) {
    for (const u of this.units) {
      if (!u.structure || u.dead || u.side < 0) continue;
      if (u.income && !(u.income.skirmish && this.campaign) && (u.income.timer += dt) >= u.income.every) {
        u.income.timer -= u.income.every;
        for (const s of u.site && u.site.base ? this.teamSides(u.side) : [u.side])
          this.credits[s] += u.income.value * this.incomeMod(u, s) * this.mods[s].credit;
      }
      for (const h of u.heals || []) {
        if ((h.timer += dt) < h.every) continue;
        h.timer -= h.every;
        if (!(h.range > 0)) {
          if (u.health < u.maxHealth) u.health = Math.min(u.maxHealth, u.health + h.amount + u.maxHealth * h.percent);
          continue;
        }
        let worst = null,
          wf = 1;
        for (const o of this.units) {
          if (o.dead || o.structure || !this.ally(o.side, u.side) || o.health >= o.maxHealth) continue;
          if ((o.x - u.x) ** 2 + (o.y - u.y) ** 2 > h.range * h.range) continue;
          const name = o.type.name.toUpperCase(),
            mask = o.type
              .str('CategoryMask')
              .toUpperCase()
              .split(/[\s|,]+/);
          if (
            h.excluded.includes(name) ||
            ((h.cats.length || h.types.length) && !h.cats.some(c => mask.includes(c)) && !h.types.includes(name))
          )
            continue;
          const f = o.health / o.maxHealth;
          if (f < wf) {
            wf = f;
            worst = o;
          }
        }
        if (worst) {
          worst.health = Math.min(worst.maxHealth, worst.health + h.amount + worst.maxHealth * h.percent);
          if (this.onFx) this.onFx(h.fx, worst.x, worst.y, worst.z + worst.aimZ);
          if (this.onSound) this.onSound(h.sfx, worst.x, worst.y);
        }
      }
    }
    this.queues.forEach((qs, side) => {
      for (const list of [qs.units, qs.upgrades]) {
        for (let i = list.length - 1; i >= 0; i--) if (list[i].from && list[i].from.dead) this.cancel(side, list, i);
        const q = list[0];
        if (!q || (q.left -= dt) > 0) continue;
        list.shift();
        if (isUpgrade(q.type)) this.grant(side, q.type);
        else this.ready[side].push(q.type);
        if (this.onReady) this.onReady(side, q.type);
      }
    });
    for (const site of this.sites) {
      if (site.padHolder) site.padHolder.visible = !site.structure;
      const b = site.building;
      if (b && !site.base && !this.ally(site.point.side, b.side)) {
        site.building = null;
        continue;
      }
      if (b && !b.done && (b.left -= dt) <= 0) {
        b.done = true;
        this.finishSite(site, b.uc, b.side);
      }
    }
  }

  craftOf(typeName) {
    const type = db.type(typeName),
      craft = type && db.type(type.str('Company_Transport_Unit') || '');
    const variant = craft && (db.type(craft.str('Landing_Transport_Variant')) || craft),
      file = craft && landingModel(craft, variant);
    return file ? { file, scale: variant.num('Scale_Factor', craft.num('Scale_Factor', 1)) } : null;
  }

  async reinforce(side, typeName, x, y, heading = 0) {
    const type = db.type(typeName),
      craft = type && db.type(type.str('Company_Transport_Unit') || '');
    const pending = type ? new LandSquad(this, type, side, { arriving: true }) : null;
    if (pending) {
      pending.members = [0];
      this.squads.push(pending);
    }
    const unpend = () => {
      if (pending) this.squads = this.squads.filter(q => q !== pending);
    };
    const variant = craft && (db.type(craft.str('Landing_Transport_Variant')) || craft);
    const file = craft && landingModel(craft, variant),
      inst = file && (await loadModel(file).catch(() => null));
    if (!inst) {
      const q = this.spawn(typeName, x, y, heading, side);
      Promise.resolve(q).then(unpend, unpend);
      return q;
    }
    const [land, off] = await Promise.all(['LAND', 'TAKEOFF'].map(k => Promise.resolve(loadALA(animName(file, k))).catch(() => null)));
    const holder = new THREE.Group();
    holder.add(inst.root);
    const kinds = type.has('Company_Units')
      ? type
          .list('Company_Units')
          .map(n => db.type(n))
          .filter(Boolean)
      : [type];
    const airborne = kinds.length > 0 && kinds.every(k => /flying/i.test(k.str('MovementClass')));
    const above = airborne ? Math.min(...kinds.map(k => k.num('Hover_Offset', 0))) : 0;
    holder.position.set(x, y, heightAt(this.terrain, x, y) + above);
    holder.rotation.z = heading + Math.PI / 2;
    holder.scale.setScalar(variant.num('Scale_Factor', craft.num('Scale_Factor', 1)));
    holder.userData.casts = true;
    this.scene.add(holder);
    const t = {
      holder,
      inst,
      stage: 'land',
      off,
      anim: land ? new AnimState(inst, land, {}) : null,
      side,
      typeName,
      x,
      y,
      heading,
      wait: 0,
      airborne
    };
    if (t.anim) t.anim.pose();
    t.pending = pending;
    const untargetable = !variant.bool('Is_Valid_Target', craft.bool('Is_Valid_Target', true));
    const cs = new LandSquad(this, craft, side, { structure: true, craft: true });
    const cu = (t.craft = landUnit({
      type: craft,
      squad: cs,
      off: { x: 0, y: 0 },
      holder,
      inst,
      x,
      y,
      z: holder.position.z,
      heading,
      speed: 0,
      turn: 0,
      path: [],
      anims: {},
      anim: null,
      animKind: '',
      side,
      dead: false,
      gone: false,
      target: null,
      structure: true,
      site: null,
      queue: [],
      builds: [],
      income: null,
      isBase: false,
      maxHealth: craft.num('Tactical_Health', 300),
      health: craft.num('Tactical_Health', 300),
      maxShield: 0,
      shield: 0,
      armor: craft.str('Armor_Type'),
      aimZ: 20,
      range: 0,
      weapon: null,
      turret: null,
      kind: 'VEHICLE',
      hitRadius: 30,
      captures: false,
      inaccuracy: new Map(),
      untargetable,
      invulnUntil: untargetable ? Infinity : 0
    }));
    cs.members.push(cu);
    this.units.push(cu);
    this.squads.push(cs);
    this.transports.push(t);
    return t;
  }

  updateTransports(dt) {
    let k = 0;
    for (const t of this.transports) {
      if (t.craft.dead) {
        if (t.stage === 'land') this.squads = this.squads.filter(q => q !== t.pending);
        this.scene.remove(t.holder);
        t.craft.gone = true;
        this.squads = this.squads.filter(q => q !== t.craft.squad);
        continue;
      }
      const running = t.anim ? t.anim.step(dt) : false;
      if (t.stage === 'land' && !running) {
        t.stage = 'unload';
        t.wait = 2;
        t.out = false;
        const out = this.spawn(t.typeName, t.x, t.y, t.heading, t.side);
        out.then(
          q => {
            this.squads = this.squads.filter(s => s !== t.pending);
            t.out = true;
            if (this.onTransportOut) this.onTransportOut(t, q);
            if (t.onOut) t.onOut(q);
          },
          () => {
            this.squads = this.squads.filter(s => s !== t.pending);
            t.out = true;
          }
        );
      } else if (t.stage === 'unload' && t.out && t.airborne) {
        this.scene.remove(t.holder);
        t.craft.dead = true;
        t.craft.gone = true;
        this.squads = this.squads.filter(q => q !== t.craft.squad);
        continue;
      } else if (t.stage === 'unload' && t.out && (t.wait -= dt) <= 0) {
        t.stage = 'leave';
        t.anim = t.off ? new AnimState(t.inst, t.off, {}) : null;
      } else if (t.stage === 'leave' && !running) {
        this.scene.remove(t.holder);
        t.craft.dead = true;
        t.craft.gone = true;
        this.squads = this.squads.filter(q => q !== t.craft.squad);
        continue;
      }
      this.transports[k++] = t;
    }
    this.transports.length = k;
  }

  async spawn(typeName, x, y, heading = 0, side = 0, saved = null) {
    const type = db.type(typeName);
    if (!type) return null;
    let kinds = type.has('Company_Units')
      ? type
          .list('Company_Units')
          .map(n => db.type(n))
          .filter(Boolean)
      : [type];
    if (saved) kinds = saved.map(m => db.type(m.type)).filter(Boolean);
    const stand = k => !!k.str('Lua_Script') && !/\bSELECTABLE\b/i.test(k.str('LandBehavior') + ' ' + k.str('Behavior'));
    const lone = !saved && kinds.some(k => k !== kinds[0]) ? kinds.map(stand) : kinds.map(() => false);
    const pack = kinds.filter((k, n) => !lone[n]).length,
      alone = kinds.length - pack;
    const max = saved ? 0 : type.num('Max_Squad_Size', 0),
      per = max > 0 ? max : Math.max(1, pack),
      packs = pack ? Math.ceil(pack / per) : 0,
      groups = Math.max(1, packs + alone);
    const company = ++COMPANY_ID,
      squads = Array.from({ length: groups }, () => new LandSquad(this, type, side, { company, forming: true }));
    this.spawning = squads;
    const slots = [];
    for (let n = 0, p = 0, a = 0; n < kinds.length; n++)
      slots.push(
        lone[n]
          ? { gi: packs + a++, i: 0, inGroup: 1 }
          : { gi: Math.floor(p / per), i: p % per, inGroup: Math.min(per, pack - Math.floor(p++ / per) * per) }
      );
    const foot = kinds[0] && /infantry/i.test(kinds[0].str('MovementClass'));
    const gap = foot ? 14 : 55,
      cols = foot ? 3 : per,
      apart = foot ? gap * 4.5 : 60;
    await Promise.all(
      kinds.map(async (t, n) => {
        const { gi, i, inGroup } = slots[n],
          squad = squads[gi],
          side0 = (gi - (groups - 1) / 2) * apart;
        const file = t.str('Land_Model_Name');
        const data = file && (await loadALO(file).catch(() => null));
        while (data && !this.fixed && this.sliceOver()) await this.nextSlice();
        let inst = null;
        try {
          inst = data ? buildModel(data, { teamColor: this.colors[side] || null }) : null;
        } catch {
          inst = null;
        }
        if (!inst) return;
        const [idle, move, attack, die] = await Promise.all(['IDLE', 'MOVE', 'ATTACK', 'DIE'].map(k => animOf(t, k)));
        while (!this.fixed && this.sliceOver()) await this.nextSlice();
        const off = { x: -Math.floor(i / cols) * gap, y: ((i % cols) - (Math.min(cols, inGroup) - 1) / 2) * gap };
        const c = Math.cos(heading),
          s = Math.sin(heading);
        const holder = new THREE.Group();
        holder.add(inst.root);
        holder.scale.setScalar(t.num('Scale_Factor', 1));
        holder.userData.casts = true;
        this.scene.add(holder);
        if (this.prepare) this.prepare(holder);
        const u = landUnit({
          type: t,
          squad,
          off,
          holder,
          inst,
          x: x + c * off.x - s * (off.y + side0),
          y: y + s * off.x + c * (off.y + side0),
          z: 0,
          heading,
          speed: /LOCOMOTOR/i.test(t.str('LandBehavior') + ' ' + t.str('Behavior'))
            ? t.num('Max_Speed', 1) * LOGIC_FPS * landSpeedFactor()
            : 0,
          turn: t.num('Max_Rate_Of_Turn', 10) * LOGIC_FPS * DEG * landSpeedFactor(),
          path: [],
          anims: { idle, move, attack, die },
          anim: null,
          animKind: '',
          side,
          dead: false,
          gone: false,
          target: null,
          repath: 0,
          maxHealth: t.num('Tactical_Health', 50),
          health: t.num('Tactical_Health', 50),
          maxShield: t.num('Shield_Points', 0),
          shield: t.num('Shield_Points', 0),
          armor: t.str('Armor_Type'),
          aimZ: t.num('Ranged_Target_Z_Adjust', 6),
          range: t.num('Targeting_Max_Attack_Distance', 140),
          weapon: null,
          turret: null,
          kind: inCategory(t, 'INFANTRY')
            ? 'INFANTRY'
            : inCategory(t, 'AIR')
              ? 'AIR'
              : inCategory(t, 'STRUCTURE')
                ? 'STRUCTURE'
                : 'VEHICLE',
          hitRadius: t.num('Custom_Soft_Footprint_Radius', 0) || Math.max(4, t.num('Select_Box_Scale', 12) * 0.3),
          captures: t.str('Influences_Capture_Point') ? t.bool('Influences_Capture_Point') : inCategory(t, 'INFANTRY'),
          lift: /hover|flying/i.test(t.str('MovementClass')) ? t.num('Hover_Offset', 0) : 0,
          flies: /flying/i.test(t.str('MovementClass')),
          hoverH: /LOCOMOTOR/i.test(t.str('LandBehavior') + ' ' + t.str('Behavior')) ? t.num('Hover_Height', 0) : 0,
          hoverZ: 0,
          hoverState: 0,
          crusher: /SQUASH/i.test(t.str('LandBehavior')) || /crusher/i.test(t.str('Property_Flags')),
          supercrusher: t.bool('Is_Supercrusher'),
          squashable: t.bool('Is_Squashable'),
          squashableBig: t.bool('Is_Squashable_By_Supercrusher'),
          minRange: t.num('Targeting_Min_Attack_Distance', 0),
          inaccuracy: new Map(t.tuples('Targeting_Fire_Inaccuracy').map(([c, v]) => [c.toUpperCase(), parseFloat(v)]))
        });
        const tb = inst.bone(t.str('Turret_Bone_Name'));
        if (tb)
          u.turret = {
            bone: tb,
            yaw: 0,
            extent: (t.num('Turret_Rotate_Extent_Degrees', 360) * DEG) / 2,
            speed: t.num('Turret_Rotate_Speed', 3),
            axis: t.num('Apply_Z_Turret_Rotate_To_Axis', 2),
            barrel: inst.bone(t.str('Barrel_Bone_Name')),
            pitch: 0,
            wantPitch: 0,
            lift: t.num('Turret_Elevate_Extent_Degrees', 30) * DEG,
            pitchAxis: t.num('Apply_Y_Turret_Rotate_To_Axis', 1),
            pitchSign: 1,
            selfPitch: false,
            target: null
          };
        this.arm(u, t, u.side, () => simRandom() * 1.2);
        if (u.crusher) {
          const cm = inst.meshByName.get('CRUSHER');
          if (cm) {
            const bb = new THREE.Box3().setFromObject(cm);
            if (!bb.isEmpty()) u.crushR = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) * 0.5 * holder.scale.x;
          }
        }
        const muzzle = name => {
          const bone = inst.bone(name);
          return bone
            ? { bone, flash: [...inst.meshByName].filter(([k]) => k.startsWith(name.toUpperCase() + '_FLASH')).map(([, m]) => m) }
            : null;
        };
        if (u.weapon) this.muzzlesOf(u, t, inst);
        if (u.turret && u.turret.barrel && u.turret.barrel !== u.turret.bone && u.weapon && u.weapon.muzzles[0]) {
          const T = u.turret,
            best = liftOf(holder, T.barrel, u.weapon.muzzles[0].bone, T.pitchAxis);
          if (best && Math.abs(best.dz) > 0.05) {
            T.pitchAxis = best.i;
            T.pitchSign = Math.sign(best.dz);
          }
          T.restUp = Math.abs(t.vec ? t.vec('Turret_Deployed_Rest_Angle', [0, 0, 0])[1] || 0 : 0) * DEG;
        }
        if (t.has('Turret_Targets_Ground_Vehicles') || t.has('Turret_Targets_Anything_Else')) {
          const rank = k => t.num('Turret_Targets_' + k, 9999);
          u.ranks = {
            VEHICLE: rank('Ground_Vehicles'),
            INFANTRY: rank('Ground_Infantry'),
            AIR: rank('Air_Vehicles'),
            ELSE: rank('Anything_Else')
          };
        }
        if (!landAbilities(t).some(d => d.kind === 'ROCKET_ATTACK'))
          for (const name of t.list('HardPoints')) {
            const h = db.hardpoint(name),
              P = h && db.type(h.str('Fire_Projectile_Type'));
            if (!P) continue;
            (u.guns ||= []).push({
              proj: P,
              damage: P.num('Projectile_Damage', 2),
              damageType: P.str('Damage_Type'),
              speed: P.num('Max_Speed', 10) * LOGIC_FPS,
              pulses: Math.max(1, h.num('Fire_Pulse_Count', 1)),
              pulseDelay: h.num('Fire_Pulse_Delay_Seconds', 0.2),
              recharge:
                (h.num('Fire_Min_Recharge_Seconds', 1) + h.num('Fire_Max_Recharge_Seconds', h.num('Fire_Min_Recharge_Seconds', 1))) / 2,
              cooldown: simRandom() * 1.5,
              left: 0,
              timer: 0,
              range: h.num('Fire_Range_Distance', u.range),
              spare: new Set(h.list('Fire_Category_Restrictions').map(c => c.toUpperCase())),
              muzzles: [h.str('Fire_Bone_A'), h.str('Fire_Bone_B')]
                .filter((b, i, l) => b && l.indexOf(b) === i)
                .map(muzzle)
                .filter(Boolean),
              target: null,
              scanAt: 0,
              onHead: false,
              cone: h.num('Fire_Cone_Width', 360) * DEG,
              facing: hardpointFacing(inst, h),
              hp: name,
              turret: h.bool('Is_Turret')
                ? {
                    name: h.str('Turret_Bone_Name'),
                    extent: h.num('Turret_Rotate_Extent_Degrees', 360) * DEG,
                    speed: h.num('Turret_Rotate_Speed', 3),
                    yaw: 0,
                    bone: null,
                    base: null,
                    barrelName: h.str('Barrel_Bone_Name'),
                    lift: h.num('Turret_Elevate_Extent_Degrees', 0) * DEG,
                    pitch: 0,
                    barrel: null,
                    barrelBase: null,
                    pitchAxis: 0,
                    pitchSign: 1
                  }
                : null
            });
          }
        const lone = u.guns && !u.weapon && !u.turret ? u.guns.findIndex(g => !g.turret && Math.abs(g.facing) < 30 * DEG) : -1;
        if (lone >= 0) {
          u.weapon = u.guns.splice(lone, 1)[0];
          if (!u.guns.length) u.guns = null;
        }
        if (u.turret && !u.weapon && u.guns) {
          const T = u.turret,
            under = b => {
              for (let o = b; o; o = o.parent) if (o === T.bone) return true;
              return false;
            };
          for (const g of u.guns) g.onHead = !g.turret && g.muzzles.some(m => under(m.bone));
          const g = u.guns.find(g => g.onHead),
            best = g && !T.barrel && T.lift > 0 ? liftOf(holder, T.bone, g.muzzles[0].bone, T.pitchAxis) : null;
          if (best && Math.abs(best.dz) > 0.05) {
            T.selfPitch = true;
            T.pitchAxis = best.i;
            T.pitchSign = Math.sign(best.dz);
          }
        }
        for (const name of t.list('HardPoints')) {
          const h = db.hardpoint(name),
            file = h && h.str('Model_To_Attach'),
            bone = file && inst.bone ? inst.bone(h.str('Attachment_Bone')) : null;
          if (bone)
            loadModel(file, { teamColor: this.colors[side] || null })
              .then(a => {
                if (!a || !a.root || u.gone) return;
                bone.add(a.root);
                (inst.attached ||= []).push(a.root);
                inst.pcGen = (inst.pcGen || 0) + 1;
                const g = [...(u.guns || []), ...(u.weapon && u.weapon.hp ? [u.weapon] : [])].find(x => x.hp === name);
                if (g && g.turret && a.bone) {
                  g.turret.bone = a.bone(g.turret.name) || null;
                  if (g.turret.bone) g.turret.base = g.turret.bone.quaternion.clone();
                }
                if (g && !g.muzzles.length && a.bone)
                  g.muzzles = [h.str('Fire_Bone_A'), h.str('Fire_Bone_B')]
                    .filter((b, i, l) => b && l.indexOf(b) === i)
                    .map(b => {
                      const m = a.bone(b);
                      return m ? { bone: m, flash: [] } : null;
                    })
                    .filter(Boolean);
                const T = g && g.turret,
                  B = T && T.lift > 0 && a.bone ? a.bone(T.barrelName) : null,
                  M = g && g.muzzles[0] && g.muzzles[0].bone;
                if (B && M && B !== T.bone) {
                  const q0 = B.quaternion.clone(),
                    p0 = new THREE.Vector3(),
                    p1 = new THREE.Vector3(),
                    ax = i => (i === 1 ? _Y : i === 0 ? _X : _Z);
                  a.root.updateMatrixWorld(true);
                  M.getWorldPosition(p0);
                  let best = null;
                  for (const i of [0, 1, 2]) {
                    B.quaternion.copy(q0).multiply(_q.setFromAxisAngle(ax(i), 0.3));
                    B.updateMatrixWorld(true);
                    M.getWorldPosition(p1);
                    const dz = p1.z - p0.z;
                    if (!best || Math.abs(dz) > Math.abs(best.dz) * 1.5) best = { i, dz };
                  }
                  B.quaternion.copy(q0);
                  B.updateMatrixWorld(true);
                  if (best && Math.abs(best.dz) > 0.02) {
                    T.barrel = B;
                    T.barrelBase = q0;
                    T.pitchAxis = best.i;
                    T.pitchSign = Math.sign(best.dz);
                  }
                }
              })
              .catch(() => {});
        }
        if (t.sub) {
          const ab = t.sub('Abilities').flatMap(a => a.all('Absorb_Blaster_Ability'))[0];
          u.deflects = t
            .sub('Abilities')
            .flatMap(a => a.all('Redirect_Blaster_Ability'))
            .filter(rb => rb.num('Redirect_Chance', 0) + rb.num('Block_Chance', 0) > 0)
            .map(rb => ({
              name: (rb.attrs.Name || '').toUpperCase(),
              on: !/^(no|false)$/i.test(rb.val('Initially_Enabled')),
              back: rb.num('Redirect_Chance', 0),
              block: rb.num('Block_Chance', 0),
              arc: (rb.num('Reaction_Arc_In_Degrees', 180) * DEG) / 2,
              sfx: rb.val('SFXEvent_Activate')
            }));
          u.deflect = u.deflects.filter(d => d.on).sort((a, b) => b.back + b.block - a.back - a.block)[0] || null;
          if (ab && ab.num('Absorb_Chance', 0) > 0)
            u.absorb = {
              chance: ab.num('Absorb_Chance', 0),
              part: ab.num('Damage_Absorb_Percentage', 0),
              sfx: ab.val('SFXEvent_Activate'),
              color: (ab.val('Owner_Light_Effect_Color') || '').split(',').map(parseFloat),
              secs: ab.num('Owner_Light_Effect_Duration', 0.5)
            };
        }
        if (t.num('Num_Garrison_Slots', 0) > 0) {
          hostOf(u);
          if (!squad.abilityState('UNLOAD'))
            squad.abilities.push({
              def: { kind: 'UNLOAD', label: 'Let out everyone inside', text: 'Out', aim: 'none', target: 'none', recharge: 0 },
              active: false,
              cooldown: 0,
              auto: false
            });
        }
        {
          const at = t.list('Land_Damage_Thresholds').map(Number),
            sfx = t.list('Land_Damage_SFX');
          if (at.length > 1 && sfx.length) u.wear = { at, sfx, stage: 0 };
        }
        const o = u.kind === 'STRUCTURE' || this.isOpen(u.x, u.y) ? null : this.nearestFree(u);
        if (o) {
          u.x = o.x;
          u.y = o.y;
        }
        const sv = saved && saved[n];
        if (sv) {
          u.x = sv.x;
          u.y = sv.y;
          u.heading = sv.h;
          u.health = Math.min(u.maxHealth, sv.hp);
          u.shield = Math.min(u.maxShield, sv.sh || 0);
          if (sv.o) u.off = { x: sv.o[0], y: sv.o[1] };
        }
        if (u.flies) u.captures = false;
        {
          const dm = this.mods[side];
          if (dm && dm.health !== 1) {
            u.maxHealth *= dm.health;
            u.health *= dm.health;
          }
        }
        this.setAnim(u, 'idle');
        u.mod = { speed: 1, taken: 1, delay: 1, dealt: 1 };
        u.wade = 1;
        if (this.tables)
          for (const g of t.list('SurfaceFX_Name')) {
            const k = this.tables.surface.get(g.toUpperCase()),
              wtr = k && k.get('water');
            if (wtr && wtr.speed) u.wade = Math.min(u.wade, 1 + wtr.speed);
          }
        else if (!t.num('Hover_Offset', 0)) u.wade = 0.5;
        u.ghost = inst.meshByName.get('STEALTH') || null;
        if (u.ghost) u.ghost.visible = false;
        u.foot = /infantry/i.test(t.str('MovementClass')) || inCategory(t, 'INFANTRY');
        u.body = u.foot ? 5.5 : Math.min(30, Math.max(12, u.hitRadius * 0.9));
        const span = inst.box ? Math.max(inst.box.max.x - inst.box.min.x, inst.box.max.y - inst.box.min.y) * holder.scale.x : Infinity;
        u.need = this.needOf(t.str('MovementClass'), u.foot || span <= CELL ? 1 : 2);
        u.abilityKinds = new Set();
        u.needsDeploy = landAbilities(t).some(d => d.kind === 'DEPLOY');
        u.stopTurn = t.num('Stopped_Rate_Of_Turn', 0) > 0 ? t.num('Stopped_Rate_Of_Turn', 0) * LOGIC_FPS * DEG : u.turn;
        {
          u.preTurns = t.bool('Has_Pre_Turn_Anim');
          for (const K of ['TURNL', 'TURNR', ...(u.preTurns ? ['TURNL_HALF', 'TURNR_HALF', 'TURNL_QUARTER', 'TURNR_QUARTER'] : [])])
            variants(t, K);
        }
        if (t.bool('Walk_Transition')) {
          u.walkTrans = true;
          for (const K of ['MOVESTART', ...WALK_ENDS]) variants(t, K);
        }
        if (landAbilities(t).length)
          for (const K of [
            'DEPLOY',
            'UNDEPLOY',
            'FL_ATTACK',
            'FW_ATTACK',
            'FTK_ATTACK',
            'FTK_HOLD',
            'FTK_RELEASE',
            'BLOCK_BLASTER',
            'REDIRECT_BLASTER'
          ])
            variants(t, K);
        for (const d of landAbilities(t))
          if (d.kind === 'DEPLOY_TROOPERS') {
            for (const K of ['ROPE_DROP', 'TROOPDROP', 'ROPE_LIFT']) variants(t, K);
            const S = db.type(d.node.val('Spawned_Object_Type')),
              kinds = S
                ? S.has('Company_Units')
                  ? S.list('Company_Units')
                      .map(n => db.type(n))
                      .filter(Boolean)
                  : [S]
                : [];
            for (const k of new Set(kinds)) for (const K of ['ROPESLIDE', 'ROPELAND']) variants(k, K);
          }
        for (const def of landAbilities(t)) {
          u.abilityKinds.add(def.kind);
          if (!squad.abilityState(def.kind))
            squad.abilities.push({
              def,
              active: false,
              left: 0,
              cooldown: 0,
              auto: !!(def.autofire && this.autofireSides?.has(squad.side)),
              pend: !!def.byDefault
            });
        }
        if (squad.scriptDespawned) {
          this.scene.remove(holder);
          return;
        }
        if (squad.scriptPosition) {
          const p = squad.scriptPosition;
          if (!p.preserveFormation) {
            u.x = p.x;
            u.y = p.y;
          }
          if (p.z !== undefined && (u.flies || p.z >= SPACE_LAYER / 2)) {
            u.z = p.z;
            u.scriptZ = p.z;
          }
          const offMap = !(p.x >= 0 && p.y >= 0 && p.x <= (this.n - 1) * 20 && p.y <= (this.n - 1) * 20);
          if (offMap) u.inside = { x: p.x, y: p.y, z: p.z || 0, aimZ: 0, away: true };
        }
        if (squad.scriptHeading !== undefined) u.heading = squad.scriptHeading;
        if (squad.scriptHidden !== undefined) u.scriptHidden = squad.scriptHidden;
        holder.position.set(u.x, u.y, u.scriptZ ?? heightAt(this.terrain, u.x, u.y) + (u.lift || 0) + (u.hoverZ || 0));
        holder.rotation.z = u.heading + FACING;
        holder.visible = !u.scriptHidden && !u.inside;
        if (squad.scriptAnimation) this.playOnce(u, squad.scriptAnimation);
        squad.members.push(u);
        this.units.push(u);
        for (const n of this.owned[side] || []) {
          const up = db.type(n);
          if (up) this.applyUpgrade(u, up);
        }
      })
    );
    const made = squads.filter(q => q.members.length);
    for (const squad of made) {
      squad.full = Math.max(
        squad.full,
        squad.members.reduce((a, u) => a + u.maxHealth, 0)
      );
      squad.mates = made;
      this.squads.push(squad);
    }
    for (const q of squads) q.forming = false;
    for (const q of made)
      if (q.scriptQueue) {
        const list = q.scriptQueue;
        q.scriptQueue = null;
        for (const go of list) go();
      }
    return made[0] || squads[0];
  }

  playOnce(u, kind, loop = false) {
    if (!kind) return;
    animOf(u.type, kind.toUpperCase()).then(a => {
      if (a && !u.dead) {
        u.anim = new AnimState(u.inst, a, { loop });
        u.animKind = '~script';
        u.once = 'idle';
        u.onceEnd = loop ? Infinity : this.time + a.duration;
      }
    });
  }

  extraAnim(u, name) {
    const have = u.anims[name];
    if (have !== undefined) return have || null;
    u.anims[name] = false;
    animOf(u.type, name)
      .then(a => {
        u.anims[name] = a || false;
        if (a && u.animKind === name) {
          u.animKind = '';
          this.setAnim(u, name);
        } else if (a && !u.dead) u.animKind = '';
      })
      .catch(() => {});
    return null;
  }

  cast(u, KIND, seconds = 0, loop = false, rate = 1, index = 0) {
    const vs = u.dead ? null : variants(u.type, KIND),
      a = vs && vs[index % vs.length];
    if (!a) return false;
    u.anim = new AnimState(u.inst, a, { loop, speed: rate });
    u.once = null;
    u.animKind = '~cast';
    u.cast = this.time + (seconds || a.duration / rate);
    return true;
  }

  skin(u) {
    if (u.skinOf) return u.skinOf;
    const S = (u.skinOf = { tint: new THREE.Vector4(1, 1, 1, 0), ghost: 0, fade: -1 });
    u.holder.traverse(o => {
      const m = o.material;
      if (!o.isMesh || !m || !m.uniforms || !m.uniforms.tint) return;
      const before = o.onBeforeRender,
        after = o.onAfterRender;
      o.onBeforeRender = function (...x) {
        before.apply(this, x);
        if (S.tint.w > 0 || S.ghost || S.fade >= 0) {
          const U = this.material.uniforms;
          U.tint.value = S.tint;
          if (U.ghost) U.ghost.value = S.ghost;
          if (U.dissolve) U.dissolve.value = S.fade < 0 ? 0 : this.userData.cloakPart ? 1 - S.fade : S.fade;
          this.material.uniformsNeedUpdate = true;
        }
      };
      o.onAfterRender = function (...x) {
        after.apply(this, x);
        if (S.tint.w > 0 || S.ghost || S.fade >= 0) {
          const U = this.material.uniforms;
          U.tint.value = NO_TINT;
          if (U.ghost) U.ghost.value = 0;
          if (U.dissolve) U.dissolve.value = 0;
          this.material.uniformsNeedUpdate = true;
        }
      };
    });
    return S;
  }
  glow(u, color, seconds, pulses = 1) {
    if (!u || u.dead || !(seconds > 0)) return;
    this.glows.push({ u, color, from: this.time, until: this.time + seconds, pulses: Math.max(1, pulses) });
  }
  tickGlows() {
    if (!this.glows.length) return;
    this.glows = this.glows.filter(g => {
      const S = this.skin(g.u),
        k = (this.time - g.from) / (g.until - g.from);
      if (k >= 1 || g.u.gone) {
        S.tint.w = 0;
        return false;
      }
      const p = 1 - Math.abs(((k * g.pulses) % 1) * 2 - 1);
      S.tint.set(Math.min(1, g.color[0] * 2.2), Math.min(1, g.color[1] * 2.2), Math.min(1, g.color[2] * 2.2), 0.15 + 0.5 * p);
      return true;
    });
  }

  oneShot(u, KIND, during, pick = any) {
    const vs = u.dead ? null : variants(u.type, KIND),
      a = vs && pick(vs);
    if (!a) return false;
    u.anim = new AnimState(u.inst, a, { loop: false, speed: this.animRate(u, KIND) });
    u.once = during;
    u.onceEnd = this.time + a.duration / u.anim.speed;
    u.animKind = '~';
    return true;
  }

  setAnim(u, kind) {
    if (u.cast) {
      if (this.time < u.cast && !u.dead && kind !== 'die' && !/DIE|CRUSHED/.test(kind)) return;
      u.cast = 0;
      u.animKind = '';
    }
    if (u.once) {
      if (kind === u.once && this.time < u.onceEnd) return;
      u.once = null;
      u.animKind = '';
    }
    const turn = kind === 'turnL' || kind === 'turnR';
    if (u.setup && !u.dead && (kind === 'idle' || kind === 'attack')) {
      const vs = variants(u.type, 'DEPLOY');
      if (vs) {
        if (u.animKind !== 'DEPLOYED') {
          u.animKind = 'DEPLOYED';
          u.anim = new AnimState(u.inst, vs[0], { loop: false, time: vs[0].duration - 0.02 });
        }
        return;
      }
    }
    if (u.foot && !u.dead) {
      const low = (u.squad.spread || 1) > 1,
        has = K => variants(u.type, K);
      if (turn) {
        const K = (low ? 'CROUCH' : '') + (kind === 'turnL' ? 'TURNL' : 'TURNR');
        kind = has(K) ? K : 'move';
      }
      if (low && (kind === 'idle' || kind === 'move' || kind === 'attack')) {
        const K = kind === 'move' ? 'CROUCHMOVE' : 'CROUCHIDLE';
        if (this.extraAnim(u, K)) kind = K;
      } else if (kind === 'attack' && has('ATTACKIDLE')) kind = 'ATTACKIDLE';
      else if (kind === 'move' && u.slow && has('WALKMOVE')) kind = 'WALKMOVE';
      else if (kind === 'idle' && this.winner !== undefined && this.winner === this.team[u.side] && has('CELEBRATE')) kind = 'CELEBRATE';
      else if (kind === 'idle' && u.presenceUntil > this.time && has(u.presenceAnim)) kind = u.presenceAnim;
    } else if (turn) {
      const K = kind === 'turnL' ? 'TURNL' : 'TURNR';
      kind = variants(u.type, K) ? K : 'move';
    }
    if (!u.anims.idle && !u.structure && !u.askedIdle) {
      u.askedIdle = true;
      animOf(u.type, 'IDLE').then(a => {
        if (a) {
          u.anims.idle = a;
          u.animKind = '';
        }
      });
    }
    if (u.animKind === kind) return;
    u.animKind = kind;
    const once = kind === 'die' || /DIE|CRUSHED|DEATH/.test(kind),
      K = kind.toUpperCase();
    const vs = (u.foot || /^TURN[LR]/.test(K)) && !u.structure ? variants(u.type, K) : null;
    const a =
      (vs && (K === 'IDLE' ? vs[0] : /MOVE/.test(K) ? vs[(u.gait ??= Math.floor(simRandom() * 6)) % vs.length] : any(vs))) ||
      u.anims[kind] ||
      (once ? null : u.anims.idle);
    const from0 = once || (u.fromStart && K === 'MOVE') || (u.preTurn && /^TURN[LR]/.test(K));
    u.fromStart = false;
    u.anim = a ? new AnimState(u.inst, a, { loop: !once, time: from0 ? 0 : simRandom() * a.duration, speed: this.animRate(u, K) }) : null;
    if (u.anim) {
      u.animAt = this.time;
      u.animT0 = u.anim.time;
    }
  }

  attack(squad, enemy) {
    squad.foe = enemy;
    squad.advance = 0;
    squad.spot = null;
    squad.formSpeed = null;
    for (const u of squad.members) {
      u.target = null;
    }
    const box = this.teamOf(squad);
    if (box && !squad.ext && box.path.length) {
      box.path.length = 0;
      box.speed = 0;
    }
    this.advance(squad);
  }

  advance(squad) {
    const foe = squad.foe,
      m = squad.members;
    if (!foe || !foe.members.length || !m.length || squad.structure) return;
    const mid = l => ({ x: l.reduce((a, u) => a + u.x, 0) / l.length, y: l.reduce((a, u) => a + u.y, 0) / l.length });
    const a = mid(m),
      b = mid(foe.members),
      d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    squad.advance = this.time + 1.5;
    if (squad.spot) {
      const sp = squad.spot;
      if (sp.foe !== foe || (b.x - sp.x) ** 2 + (b.y - sp.y) ** 2 > 40 * 40) squad.spot = null;
      else if (m.some(u => u.path.length)) return;
    }
    const box = this.teamOf(squad);
    if (box && !squad.ext) {
      const fb = this.teamOf(foe),
        to = fb && !foe.ext ? fb : b,
        edge = fb ? 10 : foe.members[0].body || foe.members[0].hitRadius || 0;
      const R = Math.min(...m.map(u => u.range)),
        dx = to.x - box.x,
        dy = to.y - box.y,
        far = Math.hypot(dx, dy) || 1;
      if (far <= R + edge) return;
      squad.aimAt = { x: to.x, y: to.y, r: R + edge };
      this.order(squad, to.x - (dx / far) * (R + edge * 0.5), to.y - (dy / far) * (R + edge * 0.5), Math.atan2(dy, dx));
      squad.aimAt = null;
      return;
    }
    const reach = Math.min(...m.map(u => u.range)) * 0.8;
    if (d <= reach) return;
    if (m.some(u => u.setup) && d <= Math.min(...m.map(u => u.range))) return;
    this.order(squad, b.x - ((b.x - a.x) / d) * reach, b.y - ((b.y - a.y) / d) * reach);
  }

  foesNear(x, y, reach) {
    const S = FOE_CELL,
      r = reach + FOE_PAD;
    if (r > S * 12) return this.units;
    if (this.foeGridAt !== this.time) {
      this.foeGridAt = this.time;
      const G = (this.foeGrid ||= new Map());
      for (const l of G.values()) l.length = 0;
      for (const e of this.units) {
        if (!e || e.dead || e.x === undefined) continue;
        const k = Math.floor(e.x / S) * 4096 + Math.floor(e.y / S);
        let l = G.get(k);
        if (!l) G.set(k, (l = []));
        l.push(e);
      }
    }
    const G = this.foeGrid,
      out = (this.foeList ||= []);
    out.length = 0;
    const x0 = Math.floor((x - r) / S),
      x1 = Math.floor((x + r) / S),
      y0 = Math.floor((y - r) / S),
      y1 = Math.floor((y + r) / S);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const l = G.get(cx * 4096 + cy);
        if (l) for (let i = 0; i < l.length; i++) out.push(l[i]);
      }
    return out;
  }

  arm(u, t, side, cool) {
    const swap = swapMode(t),
      base = u.range;
    u.weapons = t.list('Projectile_Types').map(n => {
      const proj = db.type(n);
      return proj
        ? {
            proj,
            damage: proj.num('Projectile_Damage', 2),
            damageType: proj.str('Damage_Type'),
            speed: proj.num('Max_Speed', 10) * LOGIC_FPS,
            pulses: Math.max(1, fireNum(t, proj, 'Projectile_Fire_Pulse_Count', 1)),
            pulseDelay: fireNum(t, proj, 'Projectile_Fire_Pulse_Delay_Seconds', 0.2),
            recharge: fireNum(t, proj, 'Projectile_Fire_Recharge_Seconds', 1),
            cooldown: cool(),
            left: 0,
            timer: 0,
            reach: thrownReach(proj) ?? base,
            inacc:
              swap && proj.has('Targeting_Fire_Inaccuracy')
                ? new Map(proj.tuples('Targeting_Fire_Inaccuracy').map(([c, v]) => [c.toUpperCase(), parseFloat(v)]))
                : null,
            fixed: -1
          }
        : null;
    });
    u.weaponIndex = Math.min(startingWeapon(t, this.campaign, this.market?.[side]), Math.max(0, u.weapons.length - 1));
    u.weapon = u.weapons[u.weaponIndex] || u.weapons[0] || null;
    if (u.weapon) u.range = u.weapon.reach;
  }

  muzzlesOf(u, t, inst) {
    const name = (t.str('Muzzle_Bone_Name').trim() || 'MuzzleA').toUpperCase(),
      out = [];
    for (let i = 0; i < 100; i++) {
      const b = name + '_' + String(i).padStart(2, '0'),
        bone = inst.boneByName.has(b) ? inst.bone(b) : null;
      if (!bone) break;
      out.push({ bone, flash: [...inst.meshByName].filter(([k]) => k.startsWith(b + '_FLASH')).map(([, m]) => m) });
    }
    (u.weapons || []).forEach((g, i) => {
      if (g) {
        g.muzzles = out;
        g.fixed = fixedMuzzle(i, u.weapons.length, out.length);
      }
    });
    return out;
  }

  nearestFoe(u, among, reach, gun = null) {
    if (this.aiSuspended && among === this.units) return null;
    if (u.retreating) return null;
    if (among === this.units && u.x !== undefined) among = this.foesNear(u.x, u.y, reach);
    const R = gun ? null : u.ranks;
    const aa = (u.antiAir ??= !!(
      u.flies ||
      (u.ranks ? u.ranks.AIR < 9999 : /ANTIAIR/i.test(u.type.str('CategoryMask').replace(/\s/g, '')) || /ANTI_AIR/i.test(u.type.name))
    ));
    const set = gun ? null : setOf(u);
    let best = null,
      bd = reach * reach,
      br = Infinity,
      bp = Infinity;
    const T = this.team,
      mine = u.confuseUntil > this.time ? undefined : T[u.side];
    for (const e of among) {
      if (mine !== undefined && e && T[e.side] === mine) continue;
      if (
        !e ||
        e.dead ||
        e === u ||
        e.cloaked ||
        e.retreating ||
        e.inside ||
        e.side < 0 ||
        (e.flies && !aa && !gun) ||
        !this.targetEnemy(u, e) ||
        e.x === undefined
      )
        continue;
      if (gun && gun.spare.has(e.flies ? 'AIR' : e.kind)) continue;
      const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
      if (d >= reach * reach) continue;
      if (gun && !gun.turret && gun.cone < Math.PI * 2) {
        let a = Math.atan2(e.y - u.y, e.x - u.x) - u.heading - (gun.facing || 0);
        a = Math.atan2(Math.sin(a), Math.cos(a));
        if (Math.abs(a) > gun.cone / 2 + (gun.onHead ? u.turret.extent : 0)) continue;
      }
      const r = R ? (e.flies ? R.AIR : e.kind === 'VEHICLE' ? R.VEHICLE : e.kind === 'INFANTRY' ? R.INFANTRY : R.ELSE) : 0;
      if (r >= 9999) continue;
      let p = 1;
      if (set) {
        p = priorityOf(set, e.type);
        if (p < 0) continue;
        if (p === Infinity) p = 1e18;
      }
      if (p < bp || (p === bp && (r < br || (r === br && d < bd)))) {
        bp = p;
        br = r;
        bd = d;
        best = e;
      }
    }
    return best;
  }

  spinAway(u) {
    const A = u.air || {},
      T = u.type.num('Spin_Away_On_Death_Time', 2);
    const v = [A.vx || 0, A.vy || 0, A.vz || 0],
      speed = Math.hypot(v[0], v[1], v[2]);
    const P0 = [u.x, u.y, u.z],
      P1 = P0.map((p, i) => p + v[i] * T),
      d = P1.map((p, i) => p - P0[i]),
      L = Math.hypot(d[0], d[1], d[2]);
    const S = { speed, end: speed * T, done: 0, path: null };
    if (!(L > 0)) return S;
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = a => {
      const l = Math.hypot(a[0], a[1], a[2]);
      return l > 0 ? a.map(x => x / l) : a;
    };
    const mid = P0.map((p, i) => (p + P1[i]) / 2),
      a = cross(
        mid.map(x => x + 1),
        d
      ),
      b = unit(cross(a, d)),
      an = unit(a);
    const th = Math.random() * Math.PI * 2,
      sn = Math.sin(th),
      cs = Math.cos(th),
      r = L * 0.3;
    const out = [P1[0] + (sn * b[0] + cs * an[0]) * r, P1[1] + (sn * b[1] + cs * an[1]) * r, P1[2] + Math.abs(sn * b[2] + cs * an[2]) * r];
    S.path = curvePath([P0, mid, out, P1]);
    return S;
  }

  die(u, how = '') {
    const kind =
      {
        CRUSHED: 'Damage_Crush',
        FW_DIE: 'Damage_Force_Whirlwind',
        FL_DIE: 'Damage_Force_Lightning',
        FTK_DIE: 'Damage_Force_Telekinesis',
        CA_DIE: 'Damage_Cable_Attack'
      }[how] ||
      u.lastDamage ||
      'Damage_Normal';
    const list = u.type.list('Death_Clone'),
      of = k => {
        const out = [];
        for (let i = 0; i + 1 < list.length; i += 2)
          if (list[i].toUpperCase() === k.toUpperCase() && db.type(list[i + 1])) out.push(db.type(list[i + 1]));
        return out;
      };
    let clones = of(kind);
    if (!clones.length && kind !== 'Damage_Normal' && !how) clones = of('Damage_Normal');
    const clone = clones.length ? any(clones) : null,
      src = clone || u.type;
    u.deathClone = clone;
    if (clone && !u.structure && clone.bool('Death_Clone_Is_Obstacle')) this.blockWreck(u, clone);
    let KIND = (clone && clone.str('Specific_Death_Anim_Type').toUpperCase()) || (how && u.foot ? how : 'DIE');
    const index = clone && clone.str('Specific_Death_Anim_Index') !== '' ? clone.num('Specific_Death_Anim_Index', 0) : -1;
    const P = 'Death_Persistence_Duration',
      lie = inCategory(u.type, 'INFANTRY') ? db.constants.num('Override_Death_Persistence_Duration', 30) : src.has(P) ? src.num(P, -1) : -1;
    u.endFx = src.list('Death_Explosions_End');
    u.endSfx = src.str('Death_SFXEvent_End_Die');
    u.fadeTime = src.num('Death_Fade_Time', 0.25);
    this.setAnim(u, 'die');
    const after = d => (lie < 0 ? Infinity : d + lie);
    const play = a => {
      if (a) {
        u.anim = new AnimState(u.inst, a, { loop: false });
        u.animKind = '~die';
        u.vanish = false;
        u.lieFor = after(a.duration);
      }
    };
    u.vanish = src.bool('Remove_Upon_Death') && !(u.anim && u.anim.anim);
    u.lieFor = u.vanish ? 0 : after(u.anim && u.anim.anim ? u.anim.anim.duration : 0);
    const file = clone ? clone.str('Land_Model_Name') : '';
    if (file && file.toUpperCase() !== u.type.str('Land_Model_Name').toUpperCase() && !/^NI_|^EI_|^RI_|^UI_/i.test(file)) {
      loadModel(file, { teamColor: this.colors[u.side] || null })
        .then(inst => {
          if (!inst || u.gone) return;
          u.inst.root.visible = false;
          u.holder.add(inst.root);
          u.inst = inst;
          u.skinOf = null;
          Promise.resolve(loadALA(animName(file, 'DIE', Math.max(0, index))))
            .then(play)
            .catch(() => {});
        })
        .catch(() => {});
      return;
    }
    if (KIND === 'DIE' && index < 0) return;
    const vs = variants(u.type, KIND);
    if (vs) play(vs[Math.min(vs.length - 1, Math.max(0, index))] || vs[0]);
    else
      Promise.resolve(loadALA(animName(animOverride(u.type) || u.type.str('Land_Model_Name'), KIND, Math.max(0, index))))
        .then(a => {
          if (!u.gone) play(a);
        })
        .catch(() => {});
  }

  collectBounty(u) {
    const b = this.bounty,
      killer = u.hitBy;
    if (!b.enabled || killer === undefined || killer < 0 || u.side === undefined || u.side < 0 || this.ally(u.side, killer)) return;
    const value = bountyValue(u.type, !this.campaign);
    for (const [s, n] of b.payouts(
      this.credits.map((_, i) => i),
      killer,
      this.factions[u.side],
      value,
      (x, y) => this.ally(x, y)
    )) {
      this.credits[s] += n * this.mods[s].credit;
      this.collected[s] += n;
    }
  }

  hurt(u, amount, from, how = '') {
    if (u.dead || u.invulnUntil > this.time) return;
    if (this.retreatState?.list.has(u)) {
      if (this.retreatState.phase === 'flight') return;
      amount *= this.retreatState.damaged(u.side);
    }
    amount *= (u.defense ?? 1) * (u.mod ? u.mod.taken : 1) * (u.shell ? db.constants.num('Base_Shield_Vulnerability_Modifier', 2) : 1);
    const soak = Math.min(u.shield, amount);
    u.shield -= soak;
    u.health -= amount - soak;
    u.lastHit = this.time;
    if (from && from.side !== undefined) u.hitBy = from.side;
    if (from && from !== u && from.type && !from.dead) {
      const m = (u.hurtBy ||= new Map()),
        r = m.get(from);
      if (r) {
        r.v = r.v * Math.exp(-(this.time - r.at) / 6) + amount;
        r.at = this.time;
      } else {
        if (m.size > 12) m.clear();
        m.set(from, { v: amount, at: this.time });
      }
    }
    if (u.structure && u.inst && u.inst.alts && u.health > 0) {
      const at = (u.wearAt ||= u.type.list('Land_Damage_Thresholds').map(Number)),
        to = (u.wearTo ||= u.type.list('Land_Damage_Alternates').map(Number)),
        f = u.health / u.maxHealth;
      let stage = 0;
      while (stage + 1 < at.length && f <= at[stage + 1]) stage++;
      const show = to[stage] ?? 0;
      if (show !== (u.wearShown ?? 0) && u.inst.alts[show]) {
        u.inst.alts.forEach(
          (list, n) =>
            list &&
            list.forEach(m => {
              m.visible = n === show && !m.userData.hiddenByDefault;
            })
        );
        u.wearShown = show;
      }
    }
    if (u.wear && u.health > 0) {
      const W = u.wear,
        f = u.health / u.maxHealth;
      let stage = 0;
      while (stage + 1 < W.at.length && f <= W.at[stage + 1]) stage++;
      if (stage > W.stage) {
        const s = W.sfx[stage];
        if (s && !/^null$/i.test(s) && this.onSound) this.onSound(s, u.x, u.y);
      }
      W.stage = stage;
    }
    if (
      u.health > 0 &&
      u.foot &&
      from &&
      !u.path.length &&
      !u.inside &&
      !(u.once && u.once !== 'attack' && this.time < u.onceEnd) &&
      (u.squad.spread || 1) <= 1 &&
      simRandom() < 0.35
    ) {
      let rel = Math.atan2(from.y - u.y, from.x - u.x) - u.heading;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const side = Math.abs(rel) < Math.PI / 4 ? 'F' : Math.abs(rel) > Math.PI * 0.75 ? 'B' : rel > 0 ? 'L' : 'R';
      const firing = u.animKind === 'ATTACKIDLE' || u.animKind === 'attack' || u.once === 'attack';
      this.oneShot(u, (firing ? 'ATTACKFLINCH' : 'FLINCH') + side, firing ? 'attack' : 'idle');
    }
    if (from && !from.dead && !u.structure && !u.squad.foe && !u.squad.busy && (!u.path.length || u.squad.march))
      this.attack(u.squad, from.squad);
    if (u.health <= 0) {
      if (u.flies && u.type.bool('Spin_Away_On_Death') && simRandom() <= u.type.num('Spin_Away_On_Death_Chance', 0)) {
        u.spin = this.spinAway(u);
        if (this.onSound) this.onSound(u.type.str('Spin_Away_On_Death_SFXEvent_Start_Die'), u.x, u.y);
        const ex = u.type.list('Spin_Away_On_Death_Explosion');
        if (ex.length && this.onFx) this.onFx(ex[Math.floor(Math.random() * ex.length)], u.x, u.y, u.z);
      }
      this.collectBounty(u);
      if (this.onDeath) this.onDeath(u);
      u.dead = true;
      u.path = [];
      u.target = null;
      u.died = this.time;
      if (u.structure) {
        u.died = -1e9;
        if (u.site) {
          u.site.structure = null;
          u.site.readyAt = this.time + (u.site.pad ? u.site.pad.num('Minimum_Time_Before_Pad_Can_Build_Again', 0) : 0);
        }
        this.unstamp(u);
        if (u.holds && u.holds.length) ungarrison(this, u);
        if (
          !this.campaign &&
          u.site &&
          u.site.base &&
          u.side < this.factions.length &&
          !this.beaten.has(this.team[u.side]) &&
          !this.units.some(x => x !== u && x.structure && !x.dead && this.ally(x.side, u.side) && x.site && x.site.base && x.relevant)
        ) {
          this.beaten.add(this.team[u.side]);
          const left = [...new Set(this.team)].filter(t => !this.beaten.has(t));
          if (left.length <= 1) {
            this.loser = this.team[u.side];
            this.winner = left[0] ?? -1;
          }
        }
        if (this.onDestroyed) this.onDestroyed(u);
      } else {
        if (u.holds && u.holds.length) ungarrison(this, u);
        this.die(u, how);
      }
      u.squad.members = u.squad.members.filter(m => m !== u);
    }
  }

  fire(u, t, w = u.weapon) {
    let sx = u.x,
      sy = u.y,
      z0 = u.z + u.aimZ * 0.8;
    const M =
      !w.muzzles || !w.muzzles.length
        ? null
        : w.fixed >= 0
          ? w.muzzles[w.fixed] || null
          : w.muzzles[(w.turn = ((w.turn ?? -1) + 1) % w.muzzles.length)];
    if (M) {
      this.boneAt(u, M.bone, _up);
      sx = _up.x;
      sy = _up.y;
      z0 = _up.z;
    }
    const P = w.proj,
      cat = categoryOf(P);
    const tz = t.z + t.aimZ * 0.6,
      speed0 = w.speed;
    const lead = leadTurning(_lead, sx, sy, z0, t.x, t.y, tz, t.mvx || 0, t.mvy || 0, t.mvz || 0, t.turnW || 0, speed0 > 0 ? speed0 : 1);
    const dist = Math.hypot(lead.x - sx, lead.y - sy, lead.z - z0),
      wxk = this.weatherproof && this.weatherproof.has(u.side) ? 1 : this.wxSpread(w);
    const inacc = Math.max(u.inaccuracy.get(t.kind) ?? 0, (w.inacc && w.inacc.get(t.kind)) || 0) * wxk;
    const off = offAim(
      _off,
      dist,
      inacc,
      u.range || dist,
      (u.type.num('Targeting_Fire_Inaccuracy_Fixed_Radius_Override', 0) || 0) * wxk,
      false
    );
    const ax = aimsOff(cat) ? lead.x + off.x : lead.x,
      ay = aimsOff(cat) ? lead.y + off.y : lead.y,
      z1 = aimsOff(cat) ? lead.z + off.z : lead.z;
    let dx = ax - sx,
      dy = ay - sy,
      dz = z1 - z0;
    if (cat === CAT.BOMB) {
      dx = Math.cos(u.heading || 0);
      dy = Math.sin(u.heading || 0);
      dz = 0;
    }
    const d = Math.hypot(dx, dy, dz) || 1;
    let speed = speed0,
      vx = (dx / d) * speed,
      vy = (dy / d) * speed,
      vz = (dz / d) * speed,
      total = d;
    if (cat === CAT.GRENADE && lobOf(w) > 0) {
      const D = Math.hypot(dx, dy) || 1,
        L = lob(w, D, dz);
      if (!L) return false;
      speed = L.v;
      const h = Math.cos(L.angle) * speed;
      vx = (dx / D) * h;
      vy = (dy / D) * h;
      vz = Math.sin(L.angle) * speed;
      total = (D / h) * speed;
    }
    if (M)
      for (const f of M.flash) {
        f.visible = true;
        this.flashes.push({ mesh: f, until: this.time + 0.07 });
      }
    if (!(speed > 0) && cat !== CAT.STATIC_BOMB) {
      if (u.foot && w === u.weapon && (u.animKind === 'ATTACKIDLE' || u.once === 'attack')) this.oneShot(u, 'ATTACK', 'attack');
      return;
    }
    const reach = (w.reach || P.num('Projectile_Max_Flight_Distance', 0)) + (t.hitRadius > 0 ? t.hitRadius : 0) + Math.abs(tz - z0);
    const shot = {
      x: sx,
      y: sy,
      z: z0,
      vx,
      vy,
      vz,
      speed,
      left: reach,
      total: reach,
      arc: 0,
      bz: z0,
      from: u,
      target: t,
      w,
      ax,
      ay,
      damage: w.damage * (u.mod ? u.mod.dealt : 1) * (this.mods[u.side] ? this.mods[u.side].damage : 1),
      cat,
      sx,
      sy,
      sz: z0,
      aimX: ax,
      aimY: ay,
      aimZ: z1,
      flown: 0,
      reach,
      age: 0,
      fall: 0,
      vz0: vz,
      path: null,
      ox: off.x * Math.cos(-(t.heading || 0)) - off.y * Math.sin(-(t.heading || 0)),
      oy: off.x * Math.sin(-(t.heading || 0)) + off.y * Math.cos(-(t.heading || 0)),
      oz: off.z
    };
    if (cat === CAT.ROCKET || cat === CAT.MPTL_ROCKET)
      shot.path = rocketPath(P, sx, sy, z0, dx / d, dy / d, dz / d, ax, ay, z1, (x, y) => heightAt(this.terrain, x, y));
    else if (cat === CAT.LIGHT_SABER)
      shot.path = boomerangPath(P, sx, sy, z0, ax, ay, z1, u.x, u.y, z0, (x, y) => heightAt(this.terrain, x, y));
    if (cat === CAT.GRENADE) {
      shot.left = shot.total = total;
    }
    const stop = this.shields.length && cat !== CAT.GRENADE ? shieldStops(this, u, ax, ay, dx / d, dy / d, w) : -1;
    if (stop > 0 && stop < d) {
      shot.cat = undefined;
      shot.vx = (dx / d) * speed;
      shot.vy = (dy / d) * speed;
      shot.vz = (dz / d) * speed;
      shot.left = shot.total = stop;
      shot.dud = true;
      shot.target = { dead: true, x: 0, y: 0, hitRadius: 0 };
      shot.ax = sx + (dx / d) * stop;
      shot.ay = sy + (dy / d) * stop;
    }
    this.shots.push(shot);
    if (!w.quiet && (u.revealsFiring ??= landReveals(u.type))) this.firedOn(u, t);
    if (u.foot && w === u.weapon && (u.animKind === 'ATTACKIDLE' || u.once === 'attack')) this.oneShot(u, 'ATTACK', 'attack');
    if (this.onShot) this.onShot(shot);
  }

  fly(u, dt) {
    const T = u.type,
      sq = u.squad;
    const A = (u.air ||= {
      v: u.speed,
      roll: 0,
      pitch: 0,
      alt: u.lift,
      away: false,
      slow: Math.min(u.speed, T.num('Min_Speed', 2) * LOGIC_FPS),
      high: Math.max(u.lift, T.num('Prepare_Strafe_Height', u.lift)),
      bank: T.num('Bank_Turn_Angle', 20) * DEG,
      rollRate: T.num('Max_Rate_Of_Roll', 4.5) * LOGIC_FPS * DEG,
      climb: T.num('Max_Lift', 2.5) * LOGIC_FPS,
      push: T.num('OverrideAcceleration', 0.2) * LOGIC_FPS * LOGIC_FPS,
      vx: 0,
      vy: 0,
      vz: 0,
      arc: Math.max(
        8 * DEG,
        u.weapon && u.weapon.cone < Math.PI * 2 ? u.weapon.cone / 2 : (T.num('Turret_Rotate_Extent_Degrees', 20) * DEG) / 2
      ),
      smoke: 0
    });
    const place = () => {
      u.z = heightAt(this.terrain, u.x, u.y) + A.alt;
      u.holder.position.set(u.x, u.y, u.z);
      u.holder.quaternion
        .copy(_turn.setFromAxisAngle(_Z, u.heading + Math.PI / 2))
        .multiply(_q.setFromAxisAngle(_Y, A.roll))
        .multiply(_q.setFromAxisAngle(_X, A.pitch));
      this.show(u, dt);
    };
    if (sq.busy) {
      A.alt = u.lift;
      place();
      return;
    }
    const w = u.weapon,
      foe = sq.foe && sq.foe.members.length ? sq.foe : (sq.foe = null);
    let tg = null;
    if (w && !(u.cloaked && !foe)) {
      w.cooldown -= dt;
      const free = !this.aiSuspended && (!u.path.length || sq.march);
      tg =
        u.target &&
        !u.target.dead &&
        !u.target.inside &&
        this.targetEnemy(u, u.target) &&
        (foe ? u.target.squad === foe : free && Math.hypot(u.target.x - u.x, u.target.y - u.y) <= u.range * 2)
          ? u.target
          : null;
      if (!tg && this.time >= (u.scanAt || 0)) {
        u.scanAt = this.time + 0.25 + simRandom() * 0.15;
        tg = foe ? this.nearestFoe(u, foe.members, 1e6) : free ? this.nearestFoe(u, this.units, u.range) : null;
      }
    }
    u.target = tg;
    let ax,
      ay,
      wantAlt = u.lift,
      wantV = u.speed;
    if (tg) {
      u.anchor = null;
      const dx = tg.x - u.x,
        dy = tg.y - u.y,
        d = Math.hypot(dx, dy);
      let rel = Math.atan2(dy, dx) - u.heading;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const room = Math.max(170, u.range * 0.6),
        M = this.map;
      if (!A.away && (d < 30 || (Math.abs(rel) > 1.2 && d < room * 0.8))) A.away = true;
      if (A.away && (d > room || (M && (u.x < M.playMin[0] || u.y < M.playMin[1] || u.x > M.playMax[0] || u.y > M.playMax[1]))))
        A.away = false;
      if (A.away) {
        ax = u.x + Math.cos(u.heading) * 100;
        ay = u.y + Math.sin(u.heading) * 100;
        wantAlt = A.high;
      } else {
        ax = tg.x;
        ay = tg.y;
        wantAlt = d < u.range * 1.15 ? u.lift : A.high;
        if (d <= u.range && d >= u.minRange && Math.abs(rel) < A.arc) {
          if (w.left > 0) {
            if ((w.timer -= dt) <= 0) {
              this.fire(u, tg);
              w.left--;
              w.timer = w.pulseDelay;
            }
          } else if (w.cooldown <= 0) {
            w.left = w.pulses;
            w.timer = 0;
            w.cooldown = w.recharge * (u.mod ? u.mod.delay : 1);
          }
        }
      }
    } else if (u.path.length) {
      const next = u.path[0];
      u.anchor = null;
      A.away = false;
      ax = next.x;
      ay = next.y;
      if (Math.hypot(ax - u.x, ay - u.y) < 45) {
        u.path.shift();
        if (!u.path.length) u.anchor = { x: next.x, y: next.y };
      }
    } else {
      const R = 90;
      A.away = false;
      wantV = (A.slow + u.speed) / 2;
      u.anchor ||= { x: u.x - Math.sin(u.heading) * R, y: u.y + Math.cos(u.heading) * R };
      const th = Math.atan2(u.y - u.anchor.y, u.x - u.anchor.x) + 0.7;
      ax = u.anchor.x + Math.cos(th) * R;
      ay = u.anchor.y + Math.sin(th) * R;
    }
    let da = Math.atan2(ay - u.y, ax - u.x) - u.heading;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const step = u.turn * dt,
      near = (v, to, by) => v + Math.max(-by, Math.min(by, to - v));
    u.heading += Math.max(-step, Math.min(step, da));
    A.roll = near(A.roll, Math.max(-1, Math.min(1, da / 0.5)) * A.bank, A.rollRate * dt);
    A.v = near(A.v, wantV, A.push * dt);
    const go = A.v * (u.mod ? u.mod.speed : 1) * this.wxOf(u).speed * (u.gravity ?? 1) * dt,
      was = A.alt;
    u.x += Math.cos(u.heading) * go;
    u.y += Math.sin(u.heading) * go;
    A.alt = near(A.alt, wantAlt, A.climb * dt);
    A.pitch = near(A.pitch, Math.atan2(was - A.alt, Math.max(1, go)), 2 * dt);
    if (dt > 0) {
      A.vx = (Math.cos(u.heading) * go) / dt;
      A.vy = (Math.sin(u.heading) * go) / dt;
      A.vz = (A.alt - was) / dt;
    }
    this.setAnim(u, 'move');
    if (u.health < u.maxHealth * 0.5 && this.onFx && u.seen !== false && (A.smoke -= dt) <= 0) {
      A.smoke = 0.35;
      const s = T.str('Damaged_Smoke_Asset_Name');
      if (s) this.onFx(s, u.x, u.y, u.z);
    }
    place();
  }

  deflects(t, s) {
    const D = t.deflect;
    if (!D || s.turned || !s.from || t.stunUntil > this.time || !/LASER/i.test(s.w.proj.str('Projectile_Category'))) return false;
    let rel = Math.atan2(s.from.y - t.y, s.from.x - t.x) - t.heading;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    if (Math.abs(rel) > D.arc) return false;
    const r = simRandom();
    if (r >= D.back + D.block) return false;
    const back = r < D.back && !s.from.dead;
    if (!t.path.length && !(t.cast > this.time)) this.cast(t, back ? 'REDIRECT_BLASTER' : 'BLOCK_BLASTER');
    if (this.onSound) this.onSound(D.sfx, t.x, t.y);
    if (back) {
      this.fire(t, s.from, { ...s.w, muzzles: null, quiet: true });
      this.shots[this.shots.length - 1].turned = true;
      this.shots[this.shots.length - 1].damage = s.damage;
    }
    return true;
  }
  absorbs(t, s) {
    const A = t.absorb;
    if (!A || !/LASER/i.test(s.w.proj.str('Projectile_Category')) || simRandom() >= A.chance) return 1;
    if (this.onSound) this.onSound(A.sfx, t.x, t.y);
    if (A.color.length >= 3) this.glow(t, A.color, A.secs, 1);
    return 1 - A.part;
  }

  flyShot(s, dt) {
    const P = s.w.proj,
      step = s.speed * dt,
      x0 = s.x,
      y0 = s.y,
      z0 = s.z;
    s.age += dt;
    if (s.dud && s.left <= 0) return this.shotEnds(s, null);
    const cat = s.cat;
    if (cat === CAT.MISSILE) {
      let T = s.target;
      if (!T || T.dead || T.inside) {
        T = s.target = null;
        const scan = (P._scan ??= P.num('Projectile_Max_Scan_Range', 0));
        if (scan > 0) {
          let bd = scan * scan;
          for (const o of this.foesNear(s.x, s.y, scan))
            if (this.shotMeets(o, s) && !o.spot) {
              const d2 = (o.x - s.x) ** 2 + (o.y - s.y) ** 2 + (o.z - s.z) ** 2;
              if (d2 < bd) {
                bd = d2;
                T = o;
              }
            }
          s.target = T;
        }
      }
      if (T) {
        const turn = (P._turn ??= (P.num('Max_Rate_Of_Turn', 0) * LOGIC_FPS * Math.PI) / 180) * dt;
        let gx = T.x,
          gy = T.y,
          gz = T.z + T.aimZ * 0.6;
        if (s.ox && s.oy && s.oz) {
          const h = T.heading || 0,
            c = Math.cos(h),
            si = Math.sin(h);
          gx += s.ox * c - s.oy * si;
          gy += s.ox * si + s.oy * c;
          gz += s.oz;
        }
        const wx = gx - s.x,
          wy = gy - s.y,
          wz = gz - s.z,
          wl = Math.hypot(wx, wy, wz) || 1,
          il = 1 / s.speed;
        turnToward(_turn3, s.vx * il, s.vy * il, s.vz * il, wx / wl, wy / wl, wz / wl, turn);
        s.vx = _turn3.x * s.speed;
        s.vy = _turn3.y * s.speed;
        s.vz = _turn3.z * s.speed;
      }
    }
    if (s.path) {
      s.flown += step;
      shotPathAt(_at, s.path, s.flown);
      s.x = _at.x;
      s.y = _at.y;
      s.z = _at.z;
      s.vx = _at.dx * s.speed;
      s.vy = _at.dy * s.speed;
      s.vz = _at.dz * s.speed;
      if (s.flown >= s.path.total) {
        s.ax = s.x;
        s.ay = s.y;
        return this.shotEnds(s, null);
      }
    } else if (cat !== CAT.STATIC_BOMB) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (cat === CAT.GRENADE) {
        s.vz = s.vz0 - s.w.fall * s.age;
        s.z = s.sz + s.vz0 * s.age - s.w.fall * s.age * s.age * 0.5;
      } else if (cat === CAT.BOMB || cat === CAT.CLUSTER_BOMB) {
        s.fall += (P._fallAcc ??= P.num('Projectile_Bomb_Fall_Accel_Rate', 0) * LOGIC_FPS * LOGIC_FPS) * dt;
        s.z += (s.vz - s.fall) * dt;
      } else s.z += s.vz * dt;
      s.flown += step;
    }
    s.left = cat === CAT.GRENADE ? Math.max(1, s.total - s.age * s.speed) : s.total - s.flown;
    s.bz = s.z;
    if (cat === CAT.LIGHT_SABER) {
      const r = (P._stunR ??= P.num('Projectile_Stun_Radius', 0));
      if (r > 0)
        for (const o of this.foesNear(s.x, s.y, r).slice()) {
          if (!this.shotMeets(o, s) || (o.x - s.x) ** 2 + (o.y - s.y) ** 2 + (o.z + o.aimZ * 0.6 - s.z) ** 2 > r * r) continue;
          this.hurt(o, s.damage * db.damageMod(s.w.damageType, o.armor), s.from);
        }
    } else if (cat !== CAT.STATIC_BOMB) {
      let hit = null,
        ht = 2;
      for (const o of this.foesNear(s.x, s.y, step + this.hitMax)) {
        if (!this.shotMeets(o, s)) continue;
        const r = o.hitRadius,
          h = Math.max(r, o.aimZ * 0.6),
          reach = r + step;
        if ((o.x - s.x) ** 2 + (o.y - s.y) ** 2 > reach * reach) continue;
        const tt = sweep(x0, y0, z0, s.x, s.y, s.z, o.x, o.y, o.z + o.aimZ * 0.6, 0, r, r, h);
        if (tt >= 0 && tt < ht) {
          ht = tt;
          hit = o;
        }
      }
      const gz = heightAt(this.terrain, s.x, s.y);
      const ga = z0 - heightAt(this.terrain, x0, y0);
      if (s.z < gz && ga > 0) {
        const gt = ga / (ga - (s.z - gz));
        if (!hit || gt < ht) {
          hit = null;
          ht = gt;
          s.ground = true;
        }
      }
      if (hit || s.ground) {
        s.x = x0 + (s.x - x0) * ht;
        s.y = y0 + (s.y - y0) * ht;
        s.z = z0 + (s.z - z0) * ht;
        if (s.ground) s.z = heightAt(this.terrain, s.x, s.y);
        s.ax = s.x;
        s.ay = s.y;
        return this.shotEnds(s, hit);
      }
    }
    const life = (P._life ??= P.num('Projectile_Max_Lifetime', 0));
    if (cat !== CAT.LIGHT_SABER && (s.reach > 0 && !(cat === CAT.GRENADE && life > 0) ? s.flown >= s.reach : life > 0 && s.age >= life)) {
      s.ax = s.x;
      s.ay = s.y;
      s.expired = true;
      return this.shotEnds(s, null);
    }
    if (
      cat === CAT.DEFAULT &&
      (P._ewr ??= P.bool('Explode_When_Reached_Target_Radius', false)) &&
      (s.x - s.sx) ** 2 + (s.y - s.sy) ** 2 + (s.z - s.sz) ** 2 >= (s.aimX - s.sx) ** 2 + (s.aimY - s.sy) ** 2 + (s.aimZ - s.sz) ** 2
    ) {
      s.ax = s.x;
      s.ay = s.y;
      return this.shotEnds(s, null);
    }
    return true;
  }

  shotMeets(o, s) {
    if (o.dead || o.inside || o.x === undefined || o.spot || !(o.hitRadius > 0)) return false;
    if (!(o.type.collidable ??= o.type.bool('Collidable_By_Projectile_Living', false))) return false;
    if (o === s.target) return true;
    const side = s.from.side;
    return side >= 0 && o.side >= 0 && !this.ally(side, o.side) && (o.side !== this.wild || !!o.squad?.native);
  }

  shotEnds(s, hit) {
    if (hit) {
      if (!hit.spot) hit.lastDamage = s.w.damageType;
      if (!this.deflects(hit, s)) this.hurt(hit, s.damage * db.damageMod(s.w.damageType, hit.armor) * this.absorbs(hit, s), s.from);
    } else this.misses = (this.misses || 0) + 1;
    const sw = s.w;
    sw.blastR ??= sw.proj.num('Projectile_Blast_Area_Range', 0);
    sw.blastD ??= sw.proj.num('Projectile_Blast_Area_Damage', 0);
    if (sw.blastR > 0 && sw.blastD > 0 && !s.dud) {
      const r2 = sw.blastR * sw.blastR;
      for (const o of this.foesNear(s.x, s.y, sw.blastR).slice()) {
        if (o.dead || o.flies || !this.blastReaches(o, s.from.side, sw.proj)) continue;
        const d2 = (o.x - s.x) ** 2 + (o.y - s.y) ** 2;
        if (d2 <= r2) this.hurt(o, sw.blastD * (1 - (0.5 * Math.sqrt(d2)) / sw.blastR) * db.damageMod(sw.damageType, o.armor), s.from);
      }
    }
    if (s.onLand) s.onLand(s);
    else if (this.onImpact) this.onImpact(s);
    s.done = true;
    return false;
  }

  fireGuns(u, dt) {
    if (this.aiSuspended) return;
    for (const g of u.guns) {
      g.cooldown -= dt;
      const D = u.squad.direct,
        a = D && D.firing && D.target;
      let t = D
        ? a && !a.dead && Math.hypot(a.x - u.x, a.y - u.y) <= g.range + (a.hitRadius > 0 ? a.hitRadius : 0)
          ? a
          : null
        : g.target &&
            !g.target.dead &&
            !g.target.inside &&
            this.targetEnemy(u, g.target) &&
            Math.hypot(g.target.x - u.x, g.target.y - u.y) <= g.range
          ? g.target
          : null;
      if (!t && !D && this.time >= g.scanAt) {
        g.scanAt = this.time + 0.3 + simRandom() * 0.2;
        t = this.nearestFoe(u, this.units, g.range, g);
      }
      if (t) {
        const head = g.onHead ? u.turret : null,
          cone = () => {
            const r = Math.atan2(t.y - u.y, t.x - u.x) - u.heading - (g.facing || 0) - (head ? head.yaw : 0);
            return Math.atan2(Math.sin(r), Math.cos(r));
          };
        let rel = cone();
        if (
          head &&
          Math.abs(rel) > g.cone / 2 &&
          head.target &&
          head.target !== t &&
          !head.target.dead &&
          this.targetEnemy(u, head.target) &&
          Math.hypot(head.target.x - u.x, head.target.y - u.y) <= g.range
        ) {
          t = head.target;
          rel = cone();
        }
        if (
          head &&
          Math.abs(rel) > g.cone / 2 &&
          Math.abs(Math.atan2(Math.sin(rel + head.yaw), Math.cos(rel + head.yaw))) <= head.extent + g.cone / 2
        ) {
          g.target = t;
          g.left = 0;
          continue;
        }
        const T = g.turret;
        if (T) {
          const want = Math.max(-T.extent / 2, Math.min(T.extent / 2, rel)),
            step = T.speed * dt;
          let d = want - T.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          T.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
          if (T.bone && T.base) T.bone.quaternion.copy(T.base).multiply(_q.setFromAxisAngle(_Z, T.yaw));
          if (T.barrel) {
            const D = Math.hypot(t.x - u.x, t.y - u.y);
            let rise = Math.atan2(t.z + t.aimZ * 0.6 - (u.z + u.aimZ * 0.8), D);
            if (lobOf(g) > 0) {
              const L = lob(g, D, t.z + t.aimZ * 0.6 - (u.z + u.aimZ * 0.8));
              if (L) rise = L.angle;
            }
            const want = Math.max(-T.lift, Math.min(T.lift, rise)),
              dp = want - T.pitch;
            T.pitch += Math.abs(dp) <= step ? dp : Math.sign(dp) * step;
            T.barrel.quaternion
              .copy(T.barrelBase)
              .multiply(_q.setFromAxisAngle(T.pitchAxis === 1 ? _Y : T.pitchAxis === 0 ? _X : _Z, T.pitch * T.pitchSign));
          }
          let off = rel - T.yaw;
          off = Math.atan2(Math.sin(off), Math.cos(off));
          if (Math.abs(off) > Math.max(0.12, Math.min(g.cone / 2, 0.3))) {
            g.target = t;
            g.left = 0;
            continue;
          }
        } else if (g.cone < Math.PI * 2 && Math.abs(rel) > g.cone / 2) t = null;
      }
      g.target = t;
      if (!t) {
        g.left = 0;
        continue;
      }
      if (g.left > 0) {
        if ((g.timer -= dt) <= 0) {
          this.fire(u, t, g);
          g.left--;
          g.timer = g.pulseDelay;
        }
      } else if (g.cooldown <= 0) {
        g.left = g.pulses;
        g.timer = 0;
        g.cooldown = g.recharge * (u.mod ? u.mod.delay : 1);
      }
    }
  }

  fight(u, dt) {
    if (this.aiSuspended && !u.squad.foe) {
      u.target = null;
      return false;
    }
    const w = u.weapon;
    if (w && u.needsDeploy && !u.deployed) {
      const sq = u.squad,
        e = sq.foe && sq.foe.members[0];
      if (e && !u.setup && !u.rooted && !u.path.length) {
        const d = Math.hypot(e.x - u.x, e.y - u.y);
        if (d <= u.range && d >= u.minRange) this.useAbility(sq, 'DEPLOY');
        else if (d > u.range && this.time >= (sq.advance || 0)) this.advance(sq);
      }
      return false;
    }
    if (!w || (u.cloaked && !u.squad.foe)) return false;
    w.cooldown -= dt;
    const sq = u.squad,
      foe = sq.foe && sq.foe.members.length ? sq.foe : (sq.foe = null);
    const team = sq.box && !sq.ext ? sq.box : null,
      reach = u.range + (team ? team.slack : 0);
    const D = sq.direct;
    let t = null;
    if (D) {
      if (team && team.path.length) {
        u.target = null;
        return false;
      }
      const a = D.firing && D.target;
      t = a && !a.dead && Math.hypot(a.x - u.x, a.y - u.y) <= reach + (a.hitRadius > 0 ? a.hitRadius : 0) ? a : null;
    } else {
      if (team && team.path.length) {
        if (foe && this.time >= sq.advance) this.advance(sq);
        u.target = null;
        return false;
      }
      if (foe && this.time >= sq.advance && (team || !sq.members.some(m => m.target && m.target.squad === foe))) this.advance(sq);
      t =
        u.target && !u.target.dead && this.targetEnemy(u, u.target) && Math.hypot(u.target.x - u.x, u.target.y - u.y) <= reach
          ? u.target
          : null;
      if (!t && this.time >= (u.scanAt || 0)) {
        u.scanAt = this.time + 0.2 + simRandom() * 0.15;
        if (foe) t = this.nearestFoe(u, foe.members, reach);
        if (!t && (!u.path.length || u.turret || foe)) t = this.nearestFoe(u, this.units, reach);
      }
    }
    if (t && u.minRange > 0 && Math.hypot(t.x - u.x, t.y - u.y) < u.minRange) t = null;
    u.target = t;
    if (!t) {
      if (u.turret) {
        u.turret.wantPitch = u.setup ? u.turret.restUp || 0 : 0;
        this.aimTurret(u, 0, dt);
      }
      return false;
    }
    const want = Math.atan2(t.y - u.y, t.x - u.x);
    let aimed;
    if (u.turret) {
      let rel = want - u.heading;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const inArc = Math.abs(rel) <= u.turret.extent;
      let rise = Math.atan2(t.z + t.aimZ * 0.6 - (u.z + u.aimZ * 0.8), Math.hypot(t.x - u.x, t.y - u.y));
      if (lobOf(w) > 0) {
        const L = lob(w, Math.hypot(t.x - u.x, t.y - u.y), t.z + t.aimZ * 0.6 - (u.z + u.aimZ * 0.8));
        if (L) rise = L.angle;
      }
      u.turret.wantPitch = Math.max(-u.turret.lift, Math.min(u.turret.lift, rise));
      aimed = this.aimTurret(u, Math.max(-u.turret.extent, Math.min(u.turret.extent, rel)), dt) && inArc;
      if (!inArc && !u.path.length) {
        const step = u.turn * dt;
        u.heading += Math.abs(rel) <= step ? rel : Math.sign(rel) * step;
      }
    } else {
      if (u.path.length && !foe) return false;
      if (u.path.length && foe && t.squad !== foe && Math.hypot(u.path[u.path.length - 1].x - u.x, u.path[u.path.length - 1].y - u.y) > 30)
        return false;
      u.path = [];
      let da = want - u.heading;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const step = u.turn * dt;
      u.heading += Math.abs(da) <= step ? da : Math.sign(da) * step;
      aimed = Math.abs(da) < 0.25;
    }
    if (aimed && specialAttack(this, u, t, dt)) {
      if (u.special && u.special.kind === 'quake') this.setAnim(u, 'attack');
      return true;
    }
    if (aimed) {
      if (w.left > 0) {
        if ((w.timer -= dt) <= 0) {
          this.fire(u, t);
          w.left--;
          w.timer = w.pulseDelay;
        }
      } else if (w.cooldown <= 0) {
        w.left = w.pulses;
        w.timer = 0;
        w.cooldown = w.recharge * (u.mod ? u.mod.delay : 1);
      }
    }
    if (u.path.length) return false;
    this.setAnim(u, 'attack');
    return true;
  }

  directArcs(u, out = []) {
    out.length = 0;
    if (!u || u.dead) return out;
    const add = (a, half, r) => {
      if (r > 0) out.push({ x: u.x, y: u.y, z: u.z, a, half: Math.min(Math.PI, half), r });
    };
    if (u.weapon) add(u.heading, u.turret ? u.turret.extent : u.direct && u.direct.throttle ? 0.35 : Math.PI, u.range);
    for (const g of u.guns || []) add(u.heading + (g.facing || 0), this.gunHalf(u, g), g.range);
    return out;
  }
  slotOf(lead, u) {
    const dx = u.x - lead.x,
      dy = u.y - lead.y,
      ch = Math.cos(lead.heading),
      sh = Math.sin(lead.heading);
    return { a: dx * ch + dy * sh, c: -dx * sh + dy * ch };
  }

  gunHalf(u, g) {
    const own = g.turret ? g.turret.extent / 2 + Math.min(g.cone / 2, 0.3) : g.cone >= Math.PI * 2 - 1e-3 ? Math.PI : g.cone / 2;
    return Math.min(Math.PI, own + (g.onHead && u.turret ? u.turret.extent : 0));
  }
  directBears(u, t) {
    if (!u || u.dead || !t) return false;
    const d = Math.hypot(t.x - u.x, t.y - u.y),
      hr = t.hitRadius > 0 ? t.hitRadius : 0;
    let rel = Math.atan2(t.y - u.y, t.x - u.x) - u.heading;
    rel = Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel)));
    if (u.weapon && d <= u.range + hr && rel <= (u.turret ? u.turret.extent : u.direct && u.direct.throttle ? 0.35 : Math.PI)) return true;
    return (u.guns || []).some(g => {
      if (d > g.range + hr) return false;
      let r = Math.atan2(t.y - u.y, t.x - u.x) - u.heading - (g.facing || 0);
      r = Math.abs(Math.atan2(Math.sin(r), Math.cos(r)));
      return r <= this.gunHalf(u, g);
    });
  }

  directStep(u, dt) {
    const D = u.direct,
      w = u.weapon;
    u.path = [];
    u.target = null;
    if (u.guns && u.side >= 0) this.fireGuns(u, dt);
    if (u.turret && !u.weapon && u.guns) this.aimHead(u, dt);
    let go = 0;
    const L = D.lead;
    if (u === L || !L || L.dead) {
      u.heading -= Math.max(-1, Math.min(1, D.turn)) * Math.min(u.turn || 2, 2.2) * dt;
      go = (D.throttle > 0 ? u.speed : D.throttle < 0 ? -u.speed * 0.5 : 0) * dt;
      if (go) {
        const fx = u.x + Math.cos(u.heading) * go,
          fy = u.y + Math.sin(u.heading) * go;
        if (u.flies || this.isOpen(fx, fy, (u.need & ~3) | 1)) {
          u.x = fx;
          u.y = fy;
        }
      }
    } else {
      const o = D.slots.get(u) || D.slots.set(u, this.slotOf(L, u)).get(u),
        ch = Math.cos(L.heading),
        sh = Math.sin(L.heading);
      const sx = L.x + ch * o.a - sh * o.c,
        sy = L.y + sh * o.a + ch * o.c,
        dx = sx - u.x,
        dy = sy - u.y,
        d = Math.hypot(dx, dy);
      const turn = (want, k = 1) => {
        let da = want - u.heading;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const s = Math.min(u.turn || 2, 2.2) * 2 * dt * k;
        u.heading += Math.abs(da) <= s ? da : Math.sign(da) * s;
      };
      if (d > 4) {
        const step = Math.min(d, u.speed * (d > 20 ? 1.33 : 1) * dt),
          fx = u.x + (dx / d) * step,
          fy = u.y + (dy / d) * step;
        if (u.flies || this.isOpen(fx, fy, (u.need & ~3) | 1)) {
          u.x = fx;
          u.y = fy;
          go = step;
        }
        turn(d > 12 ? Math.atan2(dy, dx) : L.heading);
      } else turn(L.heading);
    }
    u.v = dt > 0 ? Math.abs(go) / dt : 0;
    let shooting = false;
    const t = D.firing ? D.target : null;
    if (w && !(u.needsDeploy && !u.deployed)) {
      w.cooldown -= dt;
      if (t && !t.dead && Math.hypot(t.x - u.x, t.y - u.y) <= u.range + (t.hitRadius > 0 ? t.hitRadius : 0)) {
        let rel = Math.atan2(t.y - u.y, t.x - u.x) - u.heading;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        let aimed;
        if (u.turret) {
          let rise = Math.atan2(t.z + t.aimZ * 0.6 - (u.z + u.aimZ * 0.8), Math.hypot(t.x - u.x, t.y - u.y));
          if (lobOf(w) > 0) {
            const L = lob(w, Math.hypot(t.x - u.x, t.y - u.y), t.z + t.aimZ * 0.6 - (u.z + u.aimZ * 0.8));
            if (L) rise = L.angle;
          }
          u.turret.wantPitch = Math.max(-u.turret.lift, Math.min(u.turret.lift, rise));
          aimed = this.aimTurret(u, Math.max(-u.turret.extent, Math.min(u.turret.extent, rel)), dt) && Math.abs(rel) <= u.turret.extent;
        } else {
          if (!go) {
            const step = u.turn * dt;
            const turned = Math.abs(rel) <= step ? rel : Math.sign(rel) * step;
            u.heading += turned;
            rel -= turned;
          }
          aimed = Math.abs(rel) < 0.35;
        }
        if (aimed) {
          shooting = true;
          if (w.left > 0) {
            if ((w.timer -= dt) <= 0) {
              this.fire(u, t);
              w.left--;
              w.timer = w.pulseDelay;
            }
          } else if (w.cooldown <= 0) {
            w.left = w.pulses;
            w.timer = 0;
            w.cooldown = w.recharge * (u.mod ? u.mod.delay : 1);
          }
        }
      } else if (u.turret) {
        u.turret.wantPitch = 0;
        this.aimTurret(u, 0, dt);
      }
    }
    this.setAnim(u, go ? 'move' : shooting ? 'attack' : 'idle');
    if (go) this.moveRate(u);
    if (!u.flies) u.z = u.scriptZ ?? heightAt(this.terrain, u.x, u.y) + u.lift + u.hoverZ;
    u.holder.position.set(u.x, u.y, u.z);
    u.holder.rotation.z = u.heading + Math.PI / 2;
    this.show(u, dt);
  }

  aimHead(u, dt) {
    const T = u.turret,
      g = u.guns.find(g => g.onHead && g.target && !g.target.dead),
      t = g ? g.target : null;
    T.target = t;
    if (!t) {
      T.wantPitch = 0;
      this.aimTurret(u, 0, dt);
      return;
    }
    let rel = Math.atan2(t.y - u.y, t.x - u.x) - u.heading;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const rise = Math.atan2(t.z + t.aimZ * 0.6 - (u.z + u.aimZ * 0.8), Math.hypot(t.x - u.x, t.y - u.y));
    T.wantPitch = Math.max(-T.lift, Math.min(T.lift, rise));
    this.aimTurret(u, Math.max(-T.extent, Math.min(T.extent, rel)), dt);
  }

  ropeStep(u, dt) {
    const R = u.rope;
    if (R.held && (R.from.dead || R.from.gone)) R.held = false;
    if (R.held) {
      this.boneAt(R.from, R.bone, _ropeAt);
      u.x = _ropeAt.x;
      u.y = _ropeAt.y;
      u.z = _ropeAt.z;
      u.heading = R.from.heading;
    } else if (!R.landing) {
      const g = heightAt(this.terrain, u.x, u.y);
      u.z = Math.max(g, u.z - ROPE_SLIDE * dt);
      if (u.z <= g) {
        R.landing = true;
        u.cast = 0;
        if (!this.cast(u, 'ROPELAND')) u.rope = null;
      }
    } else if (this.time >= u.cast) u.rope = null;
    u.holder.position.set(u.x, u.y, u.z);
    u.holder.rotation.z = u.heading + Math.PI / 2;
    this.show(u, dt);
  }

  aimTurret(u, rel, dt) {
    const T = u.turret;
    let d = rel - T.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = T.speed * dt;
    T.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
    const dp = T.wantPitch - T.pitch;
    T.pitch += Math.abs(dp) <= step ? dp : Math.sign(dp) * step;
    return Math.abs(d) < 0.12;
  }

  pose(u, dt) {
    if (this.poseCache && cachedPose(u, dt, this)) {
      if (u.looksOf !== false) looks(this, u, dt);
      return;
    }
    if (u.anim) u.anim.step(dt);
    if (u.looksOf !== false) looks(this, u, dt);
    if (u.turret) {
      this.turnTurret(u);
      u.inst.syncFromBones();
    }
  }

  turnTurret(u) {
    const T = u.turret;
    const ax = i => (i === 1 ? _Y : i === 0 ? _X : _Z);
    const turn = (bone, key, axis, angle, lift = 0) => {
      if (!bone) return;
      if (T[key + 'Out'] && bone.quaternion.equals(T[key + 'Out'])) bone.quaternion.copy(T[key + 'Base']);
      (T[key + 'Base'] ||= new THREE.Quaternion()).copy(bone.quaternion);
      bone.quaternion.multiply(_q.setFromAxisAngle(ax(axis), angle));
      if (lift) bone.quaternion.multiply(_q.setFromAxisAngle(ax(T.pitchAxis), lift));
      (T[key + 'Out'] ||= new THREE.Quaternion()).copy(bone.quaternion);
    };
    turn(T.bone, 'yaw', T.axis, T.yaw, T.selfPitch ? T.pitch * (T.pitchSign || 1) : 0);
    if (T.barrel !== T.bone) turn(T.barrel, 'pitch', T.pitchAxis, T.pitch * (T.pitchSign || 1));
  }

  animRate(u, K) {
    if (u.structure) return 1;
    const t = u.type;
    if (/^MOVE/.test(K)) {
      const B = t.num('Scale_Factor', 1) * t.num('Movement_Animation_Speed', 0);
      return B > 0 && u.speed > 0 ? u.speed / LOGIC_FPS / B : 1;
    }
    if (/^TURN[LR]/.test(K)) {
      const r = t.num('Rotation_Animation_Speed', 0),
        turn = t.num('Stopped_Rate_Of_Turn', 0) > 0 ? t.num('Stopped_Rate_Of_Turn', 0) : t.num('Max_Rate_Of_Turn', 0);
      return r > 0 && turn > 0 ? turn / r : 1;
    }
    return 1;
  }

  moveRate(u) {
    if (u.animKind !== 'move' || !u.anim || !(u.speed > 0)) return;
    u.anim.speed = this.animRate(u, 'MOVE') * Math.max(0.1, Math.min(1, (u.v || 0) / u.speed));
  }

  walkEnd(u) {
    const ends = WALK_ENDS.map(K => variants(u.type, K)).filter(Boolean);
    if (!ends.length) return;
    const a = u.anim,
      starting = u.once === 'move';
    let k = 0,
      at = 0;
    if (!starting && a && u.animKind === 'move' && a.anim.duration > 0) {
      const part = a.anim.duration / ends.length,
        t = ((u.animT0 || 0) + (this.time - (u.animAt ?? this.time)) * (a.speed || 1)) % a.anim.duration;
      k = Math.min(ends.length - 1, Math.floor(t / part));
      at = t - k * part;
    } else if (!starting) return;
    const clip = ends[k][0];
    u.anim = new AnimState(u.inst, clip, { loop: false, time: Math.min(at, clip.duration * 0.99), speed: this.animRate(u, 'MOVE_ENDONE') });
    u.once = 'idle';
    u.onceEnd = this.time + (clip.duration - u.anim.time) / u.anim.speed;
    u.animKind = '~';
    u.fromStart = false;
  }

  preTurnOf(u, da) {
    const deg = Math.abs(da) / DEG,
      L = da > 0 ? 'TURNL' : 'TURNR',
      full = u.stopTurn || u.turn;
    let anim = L,
      rate = full;
    if (deg < 22.5) {
      anim = L + '_QUARTER';
      rate = full * 0.25 * (deg / 11.25);
    } else if (deg < 45) {
      anim = L + '_HALF';
      rate = full * 0.5;
    }
    if (!variants(u.type, anim)) anim = variants(u.type, L) ? L : 'move';
    return { anim, rate: Math.max(rate, full * 0.05) };
  }

  walkDecel(u) {
    const t = u.type,
      B = t.num('Scale_Factor', 1) * t.num('Movement_Animation_Speed', 0),
      s = variants(t, 'MOVESTART'),
      n = s && s[0].frames;
    if (!(B > 0) || !n) return 0;
    const v = u.speed / LOGIC_FPS;
    return (B / n) * (v / B) * (v / B) * LOGIC_FPS * LOGIC_FPS;
  }

  walkStopStarts(u, d) {
    const dec = this.walkDecel(u),
      v = u.v || u.speed;
    if (!(dec > 0) || d > (v * v) / (2 * dec)) return false;
    this.walkEnd(u);
    u.stopping = { v, dec, to: u.path[u.path.length - 1] };
    return true;
  }

  walkStop(u, next, d, dt) {
    const s = u.stopping;
    s.v = Math.max(0, s.v - s.dec * dt);
    const go = Math.min(d, s.v * dt);
    if (d > 1e-6 && go > 0) {
      const nx = u.x + ((next.x - u.x) / d) * go,
        ny = u.y + ((next.y - u.y) / d) * go;
      if (this.isOpen(nx, ny, (u.need & ~3) | 1)) {
        u.x = nx;
        u.y = ny;
      }
    }
    u.v = dt > 0 ? go / dt : 0;
    if (s.v <= 0 || d - go < 0.5) {
      u.path = [];
      u.stopping = null;
      u.walking = false;
      u.v = 0;
    }
    u.z = u.scriptZ ?? heightAt(this.terrain, u.x, u.y) + u.lift + u.hoverZ;
    u.holder.position.set(u.x, u.y, u.z);
    u.holder.rotation.z = u.heading + Math.PI / 2;
    this.show(u, dt);
  }

  hoverStep(u, dt, moving) {
    const rate = u.speed * this.paceOf(u) * dt;
    if (moving && u.hoverState !== 1) u.hoverState = 2;
    if (u.hoverState === 2) {
      u.hoverZ = Math.min(u.hoverH, u.hoverZ + rate);
      if (u.hoverZ >= u.hoverH) u.hoverState = 1;
      return moving;
    }
    if (u.hoverState === 3) {
      u.hoverZ = Math.max(0, u.hoverZ - rate);
      if (u.hoverZ <= 0) u.hoverState = 0;
    }
    return false;
  }

  pursuit(u) {
    const rs = this.retreatState;
    return rs && u.side !== rs.player && u.side !== this.wild && u.side >= 0 && !rs.list.has(u) ? rs.pursue(u.side) : 1;
  }

  paceOf(u) {
    const wet = this.wet[Math.round(u.y / CELL) * this.n + Math.round(u.x / CELL)] ? u.wade : 1;
    return (
      u.mod.speed *
      this.pursuit(u) *
      this.wxOf(u).speed *
      (u.gravity ?? 1) *
      wet *
      (u.shell ? db.constants.num('Base_Shield_Speed_Modifier', 0.5) : 1)
    );
  }

  teamOf(q) {
    if (q.box !== undefined) return q.box;
    const m = q.members;
    if (!m.length || q.forming) return null;
    if (q.structure || !m.every(u => u.foot && !u.flies && /LAND_TEAM_INFANTRY_LOCOMOTOR/i.test(u.type.str('LandBehavior'))))
      return (q.box = null);
    const made = db.type(q.type.str('Create_Team_Type')),
      T = made || (q.type.has('ContainerArrangement') ? q.type : m[0].type);
    const num = (a, b, d) => T.num(a, 0) || T.num(b, 0) || d;
    const box = (q.box = {
      x: m.reduce((a, u) => a + u.x, 0) / m.length,
      y: m.reduce((a, u) => a + u.y, 0) / m.length,
      heading: m[0].heading,
      speed: 0,
      path: [],
      face: null,
      max: T.num('Max_Speed', m[0].type.num('Max_Speed', 1)) * LOGIC_FPS * landSpeedFactor(),
      turn: T.num('Max_Rate_Of_Turn', 12) * LOGIC_FPS * DEG * landSpeedFactor(),
      accel: num('Override_Acceleration', 'OverrideAcceleration', 0.1) * LOGIC_FPS * LOGIC_FPS,
      decel: num('Override_Deceleration', 'OverrideDeceleration', 0.1) * LOGIC_FPS * LOGIC_FPS,
      scattered: /dart/i.test(T.str('ContainerArrangement')),
      lay: null,
      n: 0,
      k: 1,
      rear: 0,
      hw: 0,
      slack: 10,
      stall: 0
    });
    this.layout(q, box, box.heading);
    const c = Math.cos(box.heading),
      s = Math.sin(box.heading);
    for (const u of m)
      if (u.slot && !u.inside && this.isOpen(box.x + c * u.slot.x - s * u.slot.y, box.y + s * u.slot.x + c * u.slot.y)) {
        u.x = box.x + c * u.slot.x - s * u.slot.y;
        u.y = box.y + s * u.slot.x + c * u.slot.y;
      }
    return box;
  }

  layout(q, box, face) {
    const m = q.members.filter(u => !u.dead && !u.inside),
      n = m.length,
      k = q.spread || 1;
    box.lay = face;
    box.n = n;
    box.k = k;
    if (!n) return;
    let X = 0,
      Y = 0,
      gap = 0,
      foot = 0;
    for (const u of m) {
      const t = u.type;
      u.halfW = soldierExtent(u, 'Y');
      u.halfD = soldierExtent(u, 'X');
      X = Math.max(X, u.halfD);
      Y = Math.max(Y, u.halfW);
      gap = Math.max(gap, t.num('FormationSpacing', 0) * 20 * k);
      foot = Math.max(foot, t.num('Custom_Soft_Footprint_Radius', 0) || 3);
    }
    const cols = Math.ceil(Math.sqrt(n)),
      rows = Math.ceil(n / cols),
      side = 2 * Y + gap,
      deep = 2 * X + gap;
    const c = Math.cos(face),
      s = Math.sin(face);
    const along = u => (u.x - box.x) * c + (u.y - box.y) * s,
      across = u => -(u.x - box.x) * s + (u.y - box.y) * c;
    const front = m.slice().sort((a, b) => along(b) - along(a));
    let spots = null;
    if (box.scattered && n > 1) {
      let seed = (q.id * 2654435761 + n * 40503) >>> 0;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const hx = ((rows - 1) / 2) * deep + X,
        hy = ((cols - 1) / 2) * side + Y,
        apart = (foot + 5) ** 2;
      spots = [];
      for (let tries = 0; spots.length < n && tries < 1000; tries++) {
        const p = { x: (rnd() * 2 - 1) * hx, y: (rnd() * 2 - 1) * hy };
        if (!spots.some(o => (o.x - p.x) ** 2 + (o.y - p.y) ** 2 < apart)) spots.push(p);
      }
      if (spots.length < n) spots = null;
      else spots.sort((a, b) => b.x - a.x);
    }
    const rowsOf = [];
    for (let r = 0; r < rows; r++) rowsOf.push(front.slice(r * cols, (r + 1) * cols).sort((a, b) => across(a) - across(b)));
    const depth = rowsOf.map(row => Math.max(...row.map(u => u.halfD)));
    const at = [0];
    for (let r = 1; r < rows; r++) at.push(at[r - 1] - (gap / 2 + depth[r - 1]) - (gap / 2 + depth[r]));
    const span = depth[0] - (at[rows - 1] - depth[rows - 1]),
      lift = span / 2 - depth[0];
    let widest = 0;
    rowsOf.forEach((row, r) => {
      const mine = spots ? spots.slice(r * cols, (r + 1) * cols).sort((a, b) => a.y - b.y) : null;
      const width = row.reduce((a, u) => a + 2 * u.halfW, 0) + gap * (row.length - 1);
      widest = Math.max(widest, width / 2);
      let y = -width / 2;
      row.forEach((u, i) => {
        y += u.halfW;
        const p = mine ? mine[i] : { x: at[r] + lift, y: row.length === 1 ? 0 : y };
        y += u.halfW + gap;
        u.slot = p;
        u.off = { x: p.x / k, y: p.y / k };
        u.jig ||= { x: 0, y: 0 };
      });
    });
    box.rear = spots ? ((rows - 1) / 2) * deep + X : span / 2;
    box.hw = spots ? ((cols - 1) / 2) * side + Y : widest;
    box.slack = Math.hypot(box.rear, box.hw) + 10;
  }

  groundBox(q, x, y) {
    const b = q.box;
    return { x: x ?? b.x, y: y ?? b.y, c: Math.cos(b.heading), s: Math.sin(b.heading), hx: b.rear, hy: b.hw };
  }

  overlap(A, B) {
    const dx = B.x - A.x,
      dy = B.y - A.y;
    let least = 1;
    for (let k = 0; k < 4; k++) {
      const P = k < 2 ? A : B,
        nx = k & 1 ? -P.s : P.c,
        ny = k & 1 ? P.c : P.s;
      const reach =
        A.hx * Math.abs(A.c * nx + A.s * ny) +
        A.hy * Math.abs(-A.s * nx + A.c * ny) +
        B.hx * Math.abs(B.c * nx + B.s * ny) +
        B.hy * Math.abs(-B.s * nx + B.c * ny);
      const v = 1 - Math.abs(dx * nx + dy * ny) / reach;
      if (v <= 0) return 0;
      if (v < least) least = v;
    }
    return least;
  }

  standingOn(q, x, y, over = 0.05) {
    const mine = this.groundBox(q, x, y),
      far = (mine.hx + mine.hy + 60) ** 2;
    for (const o of this.squads) {
      const ob = o.box;
      if (!ob || o === q || o.ext || ob.path.length || !o.members.length || o.members[0].inside) continue;
      if ((ob.x - x) ** 2 + (ob.y - y) ** 2 > far) continue;
      if (this.overlap(mine, this.groundBox(o)) > over) return true;
    }
    return false;
  }

  tickStanding() {
    const least = db.constants.num('MinimumStoppedVsStoppedOverlapCoefficient', 0.15),
      now = this.time;
    const teams = this.squads.filter(
      q => q.box && !q.ext && !q.box.path.length && q.members.length && !q.structure && !q.members[0].inside && q.box.n
    );
    const busy = q => q.busy || q.pending || q.members.some(u => u.rooted || u.stunUntil > now);
    const mark = q =>
      (q.foe && q.foe.members.length ? q.foe.members[0] : (q.members.find(u => u.target && !u.target.dead) || {}).target) || null;
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++) {
        const A = teams[i],
          B = teams[j],
          a = A.box,
          b = B.box;
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > (a.rear + a.hw + b.rear + b.hw) ** 2) continue;
        if (now < (A.standRetry || 0) || now < (B.standRetry || 0) || a.path.length || b.path.length) continue;
        if (!(this.overlap(this.groundBox(A), this.groundBox(B)) > least)) continue;
        A.standRetry = B.standRetry = now + 1;
        const ba = busy(A),
          bb = busy(B),
          ta = mark(A),
          tb = mark(B);
        let M = null;
        if (ba || bb) M = ba && bb ? null : ba ? B : A;
        else if (ta || tb) M = ta && tb ? null : ta ? B : A;
        else M = a.max > b.max ? A : b.max > a.max ? B : B;
        if (!M) continue;
        const O = M === A ? B : A,
          m = M.box,
          o = O.box,
          t = M === A ? ta : tb;
        let dir = t ? Math.atan2(t.y - m.y, t.x - m.x) : Math.atan2(m.y - o.y, m.x - o.x);
        if (!t && (m.x - o.x) ** 2 + (m.y - o.y) ** 2 < 1) dir = m.heading + Math.PI / 2;
        const need = Math.max(...M.members.map(u => u.need || 1)),
          cap = Math.min(10, 1.5 * Math.max(m.rear, m.hw));
        let spot = null;
        for (let ring = 0, r = 0, step = 1; ring < 20 && !spot; ring++) {
          r += step;
          step = Math.min(cap, step + 0.8);
          for (let k = 0; k < 9 && !spot; k++) {
            const ang = dir + ((k & 1 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 8,
              x = m.x + Math.cos(ang) * r,
              y = m.y + Math.sin(ang) * r;
            if (this.isOpen(x, y, need) && !this.standingOn(M, x, y, 0)) spot = { x, y };
          }
        }
        if (!spot) continue;
        const way = this.route(m.x, m.y, spot.x, spot.y, need);
        if (!way) continue;
        m.path = way.slice();
        m.face = m.heading;
        m.stall = 0;
        for (const u of M.members) u.path = [(u.slotPt ||= { x: u.x, y: u.y })];
        if (M.post) M.post = { x: spot.x, y: spot.y };
      }
  }

  tickTeams(dt) {
    if (this.time >= (this.standAt || 0)) {
      this.standAt = this.time + db.constants.num('FramesPerCollisionCheck', 4) / LOGIC_FPS;
      this.tickStanding();
    }
    for (const q of this.squads) {
      const box = q.box === undefined ? this.teamOf(q) : q.box;
      if (!box) continue;
      let ext = false,
        live = 0,
        sx = 0,
        sy = 0;
      for (const u of q.members) {
        if (u.dead || u.inside) continue;
        live++;
        sx += u.x;
        sy += u.y;
        if (u.path.length && u.path[0] !== u.slotPt) ext = true;
      }
      if (!live) continue;
      if (ext) {
        q.ext = true;
        box.path.length = 0;
        box.speed = 0;
        continue;
      }
      if (q.ext) {
        q.ext = false;
        box.x = sx / live;
        box.y = sy / live;
        box.lay = null;
      }
      if (box.lay === null || box.n !== live || box.k !== (q.spread || 1) || Math.cos(box.heading - box.lay) <= 0.99)
        this.layout(q, box, box.heading);
      const p = box.path[0];
      if (!p) {
        box.speed = 0;
        continue;
      }
      if (this.time >= (box.nearAt || 0)) {
        box.nearAt = this.time + 0.2;
        const last = box.path[box.path.length - 1],
          ahead = box.max * db.constants.num('MovingVsMovingLookAheadTime', 1.5) + box.rear;
        if (box.path.length === 1 && (last.x - box.x) ** 2 + (last.y - box.y) ** 2 < ahead * ahead && this.standingOn(q, last.x, last.y)) {
          const dx = last.x - box.x,
            dy = last.y - box.y,
            len = Math.hypot(dx, dy) || 1;
          let back = 5;
          while (back < len && this.standingOn(q, last.x - (dx / len) * back, last.y - (dy / len) * back)) back += 5;
          const keep = Math.max(0, len - back + 3);
          if (keep < 4) {
            box.path.length = 0;
            box.speed = 0;
            box.face = null;
            continue;
          }
          box.path[0] = { x: box.x + (dx / len) * keep, y: box.y + (dy / len) * keep };
        }
        const near = box.near || (box.near = []),
          reach = box.slack + 45;
        near.length = 0;
        for (const o of this.squads) {
          if (o === q || o.structure || !o.members.length) continue;
          const ob = o.box || o.members[0];
          if (!o.members[0].foot || (ob.x - box.x) ** 2 + (ob.y - box.y) ** 2 > (reach + (o.box ? o.box.slack : 10)) ** 2) continue;
          for (const u of o.members) if (!u.dead && !u.inside && !u.flies) near.push(u);
        }
      }
      const dx = p.x - box.x,
        dy = p.y - box.y,
        d = Math.hypot(dx, dy);
      let da = Math.atan2(dy, dx) - box.heading;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (d > 1) {
        const step = box.turn * dt;
        box.heading += Math.abs(da) <= step ? da : Math.sign(da) * step;
      }
      let cap = Math.min(q.formSpeed ? Math.min(box.max, q.formSpeed.v) : box.max, q.ccCap ?? Infinity);
      const c = Math.cos(box.heading),
        s = Math.sin(box.heading);
      if (box.stall < 4)
        for (const u of q.members) {
          if (u.dead || u.inside || u.rooted || u.stunUntil > this.time) continue;
          const lag = -((u.x - box.x) * c + (u.y - box.y) * s) - (box.rear + 2);
          if (lag > 0) cap = Math.min(cap, box.max * (1 - Math.min(1, lag / 10)));
        }
      box.stall = cap < 1 ? box.stall + dt : box.speed > 1 ? 0 : box.stall;
      if (Math.abs(da) > 0.6 && d > 1) cap = 0;
      if (box.path.length === 1) cap = Math.min(cap, Math.sqrt(2 * box.decel * d) + 1);
      box.speed += Math.max(-box.decel * dt, Math.min(box.accel * dt, cap - box.speed));
      const go = Math.min(d, box.speed * dt);
      if (d > 0) {
        box.x += (dx / d) * go;
        box.y += (dy / d) * go;
      }
      if (box.sides) {
        box.along += go;
        const S = box.sides,
          at = box.along;
        let i = 0;
        while (i + 1 < S.s.length && S.s[i + 1] <= at) i++;
        const off = i + 1 < S.s.length ? S.v[i] + ((S.v[i + 1] - S.v[i]) * (at - S.s[i])) / Math.max(1e-6, S.s[i + 1] - S.s[i]) : S.v[i];
        box.ox = -Math.sin(box.heading) * off;
        box.oy = Math.cos(box.heading) * off;
      } else box.ox = box.oy = 0;
      if (d - go < 1) {
        box.path.shift();
        if (!box.path.length) {
          box.speed = 0;
          if (box.face !== null && box.face !== undefined) box.heading = box.face;
          box.face = null;
        }
      }
    }
  }

  blocked(u, to) {
    if (u.detour) {
      u.detour = null;
      u.detourAt = this.time + 45 / LOGIC_FPS;
      return false;
    }
    if (this.time < (u.detourAt || 0)) return false;
    const foot = u.foot ? (u.need & ~3) | 1 : u.need,
      reach = (u.fp ?? u.hitRadius ?? 0) + 40;
    const way = this.isOpen(to.x, to.y, foot) ? this.route(u.x, u.y, to.x, to.y, foot) : null;
    const team = !!(u.squad && u.squad.box && !u.squad.ext && u.slot);
    let len = 0,
      px = u.x,
      py = u.y;
    if (way)
      for (const p of way) {
        len += Math.hypot(p.x - px, p.y - py);
        px = p.x;
        py = p.y;
      }
    if (!way || (!team && len > Math.hypot(to.x - u.x, to.y - u.y) + 2 * reach)) {
      u.detourAt = this.time + 45 / LOGIC_FPS;
      return false;
    }
    if (team) u.detour = way.slice();
    else {
      u.path.splice(0, 1, ...way);
      u.detourAt = this.time + 0.5;
    }
    return true;
  }

  teamWalk(u, box, dt) {
    const c = Math.cos(box.heading),
      s = Math.sin(box.heading),
      j = u.jig,
      t = u.type;
    const lx = u.slot.x + j.x,
      ly = u.slot.y + j.y,
      pt = (u.slotPt ||= { x: 0, y: 0 });
    pt.x = box.x + c * lx - s * ly + (box.ox || 0);
    pt.y = box.y + s * lx + c * ly + (box.oy || 0);
    if (u.rooted) {
      u.v = 0;
      return false;
    }
    const dx = pt.x - u.x,
      dy = pt.y - u.y,
      pace = this.paceOf(u),
      own = u.speed * pace;
    const acc = (u.acc ??= (t.num('OverrideAcceleration', 0) || t.num('Override_Acceleration', 0) || 0.05) * LOGIC_FPS * LOGIC_FPS);
    let wantH,
      wantV,
      v = u.v || 0;
    if (box.path.length) {
      const ex = dx * c + dy * s,
        ey = -dx * s + dy * c,
        ts = Math.min(box.speed, own);
      wantV = Math.abs(ex) <= 1 ? ts : ex > 0 ? ts + (own - ts) * Math.min(1, ex / 10) : ts * (1 - Math.min(1, -ex / 10) ** 2);
      const f = Math.min(0.5, Math.abs(ey) / 10),
        sg = Math.sign(ey);
      wantH = Math.atan2(s * (1 - f) + c * sg * f, c * (1 - f) - s * sg * f);
      const near = box.near;
      if (near && near.length && v > 0.5) {
        const hx = Math.cos(wantH),
          hy = Math.sin(wantH),
          lx2 = -hy,
          ly2 = hx,
          mine = (u.fp ??= t.num('Custom_Soft_Footprint_Radius', 0) || 3);
        let ax = 0,
          ay = 0;
        for (const o of near) {
          const ox = o.x - u.x,
            oy = o.y - u.y,
            R = (mine + (o.fp ??= o.type.num('Custom_Soft_Footprint_Radius', 0) || 3)) * 1.3,
            d2 = ox * ox + oy * oy;
          if (d2 >= R * R || o.dead) continue;
          if ((o.v || 0) > 1 && Math.cos(o.heading - u.heading) > 0.5) continue;
          const wgt = 1 - Math.sqrt(d2) / R,
            side = lx2 * ox + ly2 * oy < 0 ? 1 : -1;
          const open = k2 => this.isOpen(u.x + lx2 * k2 * 25, u.y + ly2 * k2 * 25, (u.need & ~3) | 1);
          const go2 = open(side) ? side : open(-side) ? -side : 0;
          ax += lx2 * go2 * wgt;
          ay += ly2 * go2 * wgt;
        }
        if (ax || ay) {
          const k2 = Math.min(1, v / Math.max(1, own));
          wantH = Math.atan2(hy + ay * k2, hx + ax * k2);
        }
      }
      if (box.speed > 0) {
        const rag = (u.rag ??= t.num('FormationRaggedness', 0)),
          most = (u.jigMax ??= t.num('MaxJiggleDistance', 0));
        if (rag && most) {
          const k = (box.speed / box.max) * rag;
          j.x = Math.max(-most, Math.min(most, j.x + (simRandom() * 2 - 1) * k));
          j.y = Math.max(-most, Math.min(most, j.y + (simRandom() * 2 - 1) * k));
        }
      }
      u.back = false;
      u.wallAt = null;
    } else {
      const d = Math.hypot(dx, dy),
        held = u.wallAt && Math.abs(u.wallAt.x - pt.x) < 1 && Math.abs(u.wallAt.y - pt.y) < 1;
      if (held || (u.back ? d < 1 : d <= 4)) {
        u.back = false;
        u.v = 0;
        u.detour = null;
        if (u.path.length && u.path[0] === pt) u.path = [];
        if (!u.target) {
          let da = box.heading - u.heading;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          const step = u.turn * dt;
          u.heading += Math.abs(da) <= step ? da : Math.sign(da) * step;
        }
        return false;
      }
      u.back = true;
      wantH = Math.atan2(dy, dx);
      wantV = Math.min(own, Math.sqrt(2 * acc * d));
    }
    if (u.detour) {
      const p0 = u.detour[0],
        ex = p0.x - u.x,
        ey = p0.y - u.y;
      if (ex * ex + ey * ey < 9) {
        u.detour.shift();
        if (!u.detour.length) u.detour = null;
      } else if (this.isOpen(pt.x, pt.y, (u.need & ~3) | 1) && this.clear(u.x, u.y, pt.x, pt.y, (u.need & ~3) | 1)) u.detour = null;
      if (u.detour) {
        const q0 = u.detour[0];
        wantH = Math.atan2(q0.y - u.y, q0.x - u.x);
        wantV = own;
      }
    }
    let da = wantH - u.heading;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const step = u.turn * dt;
    u.heading += Math.abs(da) <= step ? da : Math.sign(da) * step;
    if ((u.back || u.detour) && Math.abs(da) > 0.6) wantV = 0;
    v += Math.max(-acc * dt, Math.min(acc * dt, wantV - v));
    u.v = v;
    u.slow = pace < 0.75;
    const go = v * dt,
      fx = u.x + Math.cos(u.heading) * go,
      fy = u.y + Math.sin(u.heading) * go;
    const aim = u.detour ? u.detour[0] : pt,
      ax = aim.x - u.x,
      ay = aim.y - u.y,
      ad = Math.hypot(ax, ay) || 1,
      sx = u.x + (ax / ad) * Math.min(ad, go),
      sy = u.y + (ay / ad) * Math.min(ad, go);
    if (this.isOpen(fx, fy, (u.need & ~3) | 1)) {
      u.x = fx;
      u.y = fy;
    } else if (go > 0 && this.isOpen(sx, sy, (u.need & ~3) | 1)) {
      u.x = sx;
      u.y = sy;
    } else {
      const foot = (u.need & ~3) | 1,
        there = this.isOpen(pt.x, pt.y, foot);
      u.v = v = 0;
      if (!(there || box.path.length) || !this.blocked(u, there ? pt : box.path[0])) {
        if (!box.path.length) {
          u.wallAt = { x: pt.x, y: pt.y };
          u.back = false;
        }
      }
    }
    if (!u.path.length || u.path[0] !== pt) u.path = [pt];
    this.setAnim(u, v > 2 ? 'move' : u.back && Math.abs(da) > 0.6 ? (da > 0 ? 'turnL' : 'turnR') : 'idle');
    this.moveRate(u);
    return true;
  }

  order(squad, x, y, facing = null) {
    const m = squad.members;
    if (this.clutterAt === this.time) this.clutterSent.push(squad);
    const fp = squad.formPending;
    squad.formPending = null;
    if (fp && this.groups.includes(fp.F) && Math.abs(fp.at.x - x) < 1 && Math.abs(fp.at.y - y) < 1) {
      squad.formMove = fp.F;
      fp.F.members.find(e => e.q === squad).dest = fp.at;
    } else squad.formMove = null;
    if (!m.length || m.every(u => !(u.speed > 0))) return false;
    for (const u of m) u.scriptZ = undefined;
    if (m.some(u => u.setup && u.needsDeploy)) {
      const st = squad.abilityState('DEPLOY');
      if (st && st.active) {
        squad.afterPack = { x, y, facing };
        this.useAbility(squad, 'DEPLOY');
        return true;
      }
    }
    const cx = m.reduce((a, u) => a + u.x, 0) / m.length,
      cy = m.reduce((a, u) => a + u.y, 0) / m.length;
    const face = facing ?? Math.atan2(y - cy, x - cx),
      c = Math.cos(face),
      s = Math.sin(face),
      k = squad.spread || 1;
    const need = Math.max(...m.map(u => u.need || 1)),
      fliers = m.every(u => u.flies);
    const goal = this.isOpen(x, y, need) ? { x, y } : this.nearestOpen(x, y, need) || this.nearestOpen(x, y);
    if (!goal) return false;
    if (squad.formSpeed && (squad.formSpeed.x - x) ** 2 + (squad.formSpeed.y - y) ** 2 > 25) squad.formSpeed = null;
    const box = this.teamOf(squad);
    if (box) {
      if (squad.ext) {
        box.x = cx;
        box.y = cy;
        squad.ext = false;
      }
      const at = this.isOpen(box.x, box.y) ? box : m[0];
      {
        const g = this.ground(squad),
          hx = g.hx,
          hy = g.hy;
        const come = Math.atan2(goal.y - at.y, goal.x - at.x),
          f = facing ?? come,
          fc = Math.cos(f),
          fs = Math.sin(f),
          only = [squad];
        if (this.cluttered(goal.x, goal.y, hx, hy, fc, fs, need, only)) {
          const vx = -Math.cos(come),
            vy = -Math.sin(come),
            aim = squad.aimAt,
            SIDES = [
              [1, 0],
              [0, 1],
              [-1, 0],
              [0, -1]
            ];
          const gx = goal.x,
            gy = goal.y;
          search: for (let k = 0; k <= 40; k++) {
            const ring = k ? ((k + 7) >> 3) * 20 : 0,
              turn = ((k & 7) * Math.PI) / 4,
              ax = gx + Math.cos(turn) * ring,
              ay = gy + Math.sin(turn) * ring;
            if (k && !this.isOpen(ax, ay, need)) continue;
            for (let n = 0, d = 0; n < 40; n++) {
              const m = n & 7;
              let px, py;
              if (m < 4) {
                const dd = 0.5 * d * (n & 1 ? -0.75 : 1);
                px = ax + vx * dd;
                py = ay + vy * dd;
                d += 7;
              } else {
                const dd = (d - 28) * 0.5,
                  kk = Math.min(hx, hy),
                  side = SIDES[m - 4];
                px = ax + vx * dd + side[0] * kk;
                py = ay + vy * dd + side[1] * kk;
              }
              if (aim && (px - aim.x) ** 2 + (py - aim.y) ** 2 > aim.r * aim.r) continue;
              if (!this.isOpen(px, py, need) || this.cluttered(px, py, hx, hy, fc, fs, need, only)) continue;
              goal.x = px;
              goal.y = py;
              break search;
            }
          }
        }
      }
      const way = this.route(at.x, at.y, goal.x, goal.y, need);
      if (!way) return false;
      box.path = way.slice();
      box.face = facing;
      box.stall = 0;
      box.sides = this.sideShifts(squad, box, at, way);
      box.along = 0;
      for (const u of m) u.path = [(u.slotPt ||= { x: u.x, y: u.y })];
      return true;
    }
    const from = this.isOpen(cx, cy) ? { x: cx, y: cy } : m[0];
    const way = fliers ? [goal] : this.route(from.x, from.y, goal.x, goal.y, need);
    if (!way) return false;
    for (const u of m) {
      const slot = (px, py, a) => {
        const ca = Math.cos(a),
          sa = Math.sin(a);
        return { x: px + (ca * u.off.x - sa * u.off.y) * k, y: py + (sa * u.off.x + ca * u.off.y) * k };
      };
      let end = { x: goal.x + (c * u.off.x - s * u.off.y) * k, y: goal.y + (s * u.off.x + c * u.off.y) * k };
      if (u.flies) {
        u.path = [end];
        continue;
      }
      if (!this.isOpen(end.x, end.y, u.need)) end = this.nearestOpen(end.x, end.y, u.need) || goal;
      const path = [];
      let px = u.x,
        py = u.y;
      for (let i = 0; i + 1 < way.length; i++) {
        const w = way[i],
          side = slot(w.x, w.y, Math.atan2(w.y - (i ? way[i - 1].y : from.y), w.x - (i ? way[i - 1].x : from.x)));
        const p = this.isOpen(side.x, side.y, u.need) && this.clear(px, py, side.x, side.y, u.need) ? side : w;
        if (p === w && !this.clear(px, py, w.x, w.y, u.need)) {
          const r = this.route(px, py, w.x, w.y, u.need);
          if (r) path.push(...r);
          else path.push(w);
        } else path.push(p);
        px = path[path.length - 1].x;
        py = path[path.length - 1].y;
      }
      if (this.clear(px, py, end.x, end.y, u.need)) path.push(end);
      else {
        const r = this.route(px, py, end.x, end.y, u.need);
        if (r) path.push(...r);
        else path.push(goal);
      }
      u.path = path;
    }
    if (squad.formMove) for (const u of m) if (!u.flies) u.path = [];
    return true;
  }

  sideShifts(q, box, from, way) {
    const m = q.members.filter(u => !u.dead && !u.inside);
    if (!m.length) return null;
    if (box.lay === null || box.lay === undefined || m.some(u => !u.slot)) this.layout(q, box, box.heading);
    let half = 0,
      spacing = 0,
      need = 1;
    for (const u of m) {
      if (!u.slot) continue;
      const t = u.type,
        ext = u.halfW ?? soldierExtent(u, 'Y');
      half = Math.max(half, Math.abs(u.slot.y) + ext);
      spacing = Math.max(spacing, t.num('FormationSpacing', 0));
      need = Math.max(need, u.need || 1);
    }
    if (half < 4) return null;
    return this.routeSides([{ x: from.x, y: from.y }, ...way], half, half + 10 * spacing + 10, (need & ~3) | 1);
  }

  routeSides(pts, half, R, foot) {
    const W = 2 * half;
    const room = (x, y, dx, dy) => {
      for (let d = 3; d <= R; d += 3) if (!this.isOpen(x + dx * d, y + dy * d, foot)) return d - 3;
      return R;
    };
    const S = [],
      L = [],
      Rt = [];
    let s = 0,
      next = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i],
        b = pts[i + 1],
        len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-6) continue;
      const ux = (b.x - a.x) / len,
        uy = (b.y - a.y) / len,
        px = -uy,
        py = ux;
      for (; next <= s + len; next += 30) {
        const k = next - s,
          x = a.x + ux * k,
          y = a.y + uy * k;
        let l = room(x, y, px, py),
          r = room(x, y, -px, -py);
        if (l < R || r < R)
          for (let j = 1; j <= 4; j++) {
            const ax = x + ux * 15 * j,
              ay = y + uy * 15 * j;
            l = Math.min(l, room(ax, ay, px, py));
            r = Math.min(r, room(ax, ay, -px, -py));
          }
        S.push(next);
        L.push(l);
        Rt.push(r);
      }
      s += len;
    }
    if (S.length < 2) return null;
    const ahead = Math.floor(half / 30) + 1,
      v = new Array(S.length).fill(0),
      free = new Array(S.length).fill(Infinity);
    let any = false;
    for (let i = 0; i < S.length; i++) {
      let l = Infinity,
        r = Infinity;
      for (let j = i; j < Math.min(S.length, i + ahead); j++) {
        l = Math.min(l, L[j]);
        r = Math.min(r, Rt[j]);
      }
      const h = Math.min(W, l + r) / 2;
      if (l < h || r < h) {
        v[i] = r <= l ? h - r : l - h;
        any = true;
      }
      if (l + r < W) {
        free[i] = l + r;
        any = true;
      }
    }
    if (!any) return null;
    const wide = free.slice();
    for (let i = 0; i < S.length; i++)
      if (free[i] < Infinity)
        for (let j = Math.max(0, i - 2); j <= Math.min(S.length - 1, i + 2); j++) wide[j] = Math.min(wide[j], free[i]);
    v[0] = 0;
    for (let i = 1; i < v.length; i++) {
      const lim = S[i] - S[i - 1];
      v[i] = Math.max(v[i - 1] - lim, Math.min(v[i - 1] + lim, v[i]));
    }
    for (let i = v.length - 2; i > 0; i--) {
      const lim = S[i + 1] - S[i];
      v[i] = Math.max(v[i + 1] - lim, Math.min(v[i + 1] + lim, v[i]));
    }
    for (let i = 1; i < v.length; i++) {
      const lim = S[i] - S[i - 1];
      v[i] = Math.max(v[i - 1] - lim, Math.min(v[i - 1] + lim, v[i]));
    }
    return { s: S, v, free: wide };
  }

  groupMove(f, place, face) {
    const from = this.isOpen(f.x, f.y, f.need) ? { x: f.x, y: f.y } : this.nearestOpen(f.x, f.y, f.need) || { x: f.x, y: f.y };
    const way = this.route(from.x, from.y, place.x, place.y, f.need);
    if (!way || !way.length) return null;
    const pts = [from, ...way],
      cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const spacing = Math.max(0, ...f.units.map(u => u.g.q.type.num('FormationSpacing', 0)));
    const F = {
      f,
      face,
      pts,
      cum,
      len: cum[cum.length - 1],
      along: 0,
      speed: f.speed,
      stall: 0,
      layouts: new Map(),
      sides: this.routeSides(pts, f.hw, f.hw + 10 * spacing + 10, (f.need & ~3) | 1),
      members: f.units.map(u => ({ q: u.g.q, g: u.g, dest: null }))
    };
    if (F.len < 1) return null;
    this.groups.push(F);
    return F;
  }

  groupAt(F, d) {
    const { pts, cum } = F;
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    const a = pts[i - 1],
      b = pts[i],
      len = cum[i] - cum[i - 1] || 1,
      k = Math.max(0, Math.min(1, (d - cum[i - 1]) / len));
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  groupPlace(F, m, d, P) {
    const S = F.sides;
    let shift = 0,
      free = Infinity;
    if (S) {
      let i = 0;
      while (i + 1 < S.s.length && S.s[i + 1] <= d) i++;
      shift = i + 1 < S.s.length ? S.v[i] + ((S.v[i + 1] - S.v[i]) * (d - S.s[i])) / Math.max(1e-6, S.s[i + 1] - S.s[i]) : S.v[i];
      free = S.free[i];
    }
    const f = F.f,
      side = free < Infinity ? Math.max(0.5, Math.round((free / 20) * 2) / 2) : f.S;
    let lay = F.layouts.get(side);
    if (!lay) {
      lay = new Map(this.formationRows(f.form, Math.min(f.S, side), f.mx, f.my, Math.cos(f.dir), Math.sin(f.dir)).map(u => [u.g.q, u.off]));
      F.layouts.set(side, lay);
    }
    const off = lay.get(m.q) || { x: 0, y: 0 },
      c = Math.cos(P.h),
      s = Math.sin(P.h);
    m.off = off;
    return { x: P.x + c * off.x - s * off.y - s * shift, y: P.y + s * off.x + c * off.y + c * shift, h: P.h };
  }

  tickGroups(dt) {
    if (!this.groups.length) return;
    let k = 0;
    for (const F of this.groups) {
      const live = F.members.filter(m => m.q.formMove === F && m.dest && m.q.members.length && !m.q.dead);
      if (live.length < 2 || F.along >= F.len) {
        for (const m of live) {
          m.q.formMove = null;
          m.q.formSpeed = { v: F.speed, x: m.dest.x, y: m.dest.y };
          this.order(m.q, m.dest.x, m.dest.y, F.face);
        }
        continue;
      }
      const lead = q => q.members.find(u => !u.dead && !u.inside);
      const P = this.groupAt(F, F.along),
        pc = Math.cos(P.h),
        ps = Math.sin(P.h);
      let worst = 0;
      for (const m of live) {
        const u = lead(m.q);
        m.lag = 0;
        if (!u || m.q.foe || u.target) continue;
        const at = this.groupPlace(F, m, F.along, P);
        m.lag = (at.x - u.x) * pc + (at.y - u.y) * ps;
        worst = Math.max(worst, m.lag);
      }
      if (worst <= 20) F.stall = 0;
      else F.stall += dt;
      const cap = F.stall < 4 ? F.speed * (1 - Math.min(1, Math.max(0, worst - 20) / 40)) : F.speed;
      F.along = Math.min(F.len, F.along + cap * dt);
      for (const m of live) {
        const best = Math.max(...m.q.members.map(u => u.speed || 0)),
          lag = m.lag;
        const v = lag >= 0 ? cap + (best - cap) * Math.min(1, lag / 20) : cap * Math.max(0, 1 + lag / 20);
        m.q.formSpeed = { v: Math.max(0.1, v), x: m.dest.x, y: m.dest.y };
      }
      const d = Math.min(F.len, F.along + 40),
        Q = this.groupAt(F, d);
      for (const m of live) {
        if (m.q.foe) continue;
        const at = this.groupPlace(F, m, d, Q),
          c = Math.cos(Q.h),
          s = Math.sin(Q.h),
          kk = m.q.spread || 1;
        for (const u of m.q.members) {
          if (u.dead || u.inside || u.target) continue;
          if (u.path.length && u.path[0] !== u.formPt) continue;
          const o = u.off || { x: 0, y: 0 };
          let pt = { x: at.x + (c * o.x - s * o.y) * kk, y: at.y + (s * o.x + c * o.y) * kk };
          if (!this.isOpen(pt.x, pt.y, u.need)) pt = this.groupAt(F, Math.max(0, Math.min(F.len, d + (m.off ? m.off.x : 0))));
          u.formPt = pt;
          if (!this.clear(u.x, u.y, pt.x, pt.y, u.need) && this.time >= (u.formRouteAt || 0)) {
            u.formRouteAt = this.time + 1;
            const r = this.route(u.x, u.y, pt.x, pt.y, u.need);
            if (r && r.length) {
              r[r.length - 1] = pt;
              u.path = r;
              continue;
            }
          }
          u.path = [pt];
        }
      }
      this.groups[k++] = F;
    }
    this.groups.length = k;
  }

  ground(q) {
    const m = q.members,
      u = m[0],
      t = u.type,
      box = this.teamOf(q);
    let hx, hy;
    if (box) hx = hy = Math.max(6, box.slack - 10);
    else {
      const X = t.num('Custom_Hard_XExtent', 0) || u.body || 10,
        Y = t.num('Custom_Hard_YExtent', 0) || u.body || 10;
      let ox = 0,
        oy = 0;
      for (const v of m) {
        ox = Math.max(ox, Math.abs(v.off.x));
        oy = Math.max(oy, Math.abs(v.off.y));
      }
      hx = ox + X;
      hy = oy + Y;
    }
    const gap = t.num('FormationSpacing', 0),
      x = box ? box.x : m.reduce((a, v) => a + v.x, 0) / m.length,
      y = box ? box.y : m.reduce((a, v) => a + v.y, 0) / m.length;
    return {
      q,
      x,
      y,
      hx,
      hy,
      w: (2 * hy) / 20 + gap,
      d: (2 * hx) / 20 + gap,
      team: !!box,
      solo: /solo/i.test(t.str('FormationGrouping')),
      sameOrder: /sameorder/i.test(t.str('FormationGrouping')),
      order: t.num('FormationOrder', 0),
      cls: (/\w*LOCOMOTOR/i.exec(t.str('LandBehavior')) || [''])[0].toUpperCase(),
      hero: inCategory(t, 'HERO') || inCategory(t, 'LANDHERO'),
      range: Math.max(...m.map(v => v.range || 0)),
      need: Math.max(...m.map(v => v.need || 1)),
      flies: m.every(v => v.flies),
      speed: box ? box.max : Math.min(...m.map(v => v.speed))
    };
  }

  formations(list, dir) {
    const all = list.map(q => this.ground(q)),
      per = db.constants.num('Max_Formation_Area', 14) || 14;
    const k = Math.floor(all.reduce((a, g) => a + 4 * g.hx * g.hy, 0) / 400 / per) + 1;
    let clusters = [all];
    if (k > 1 && k <= all.length) {
      all.forEach((g, i) => (g.c = i % k));
      for (let pass = 0; pass < 100; pass++) {
        const mid = Array.from({ length: k }, () => ({ x: 0, y: 0, n: 0 }));
        for (const g of all) {
          const m = mid[g.c];
          m.x += g.x;
          m.y += g.y;
          m.n++;
        }
        let moved = false;
        for (const g of all) {
          let best = g.c,
            bd = Infinity;
          mid.forEach((m, i) => {
            if (!m.n) return;
            const d = (m.x / m.n - g.x) ** 2 + (m.y / m.n - g.y) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          if (best !== g.c) {
            g.c = best;
            moved = true;
          }
        }
        if (!moved) break;
      }
      clusters = Array.from({ length: k }, (_, i) => all.filter(g => g.c === i)).filter(c => c.length);
    }
    const near = db.constants.num('VehicleFormationRecruitmentDistance', 100),
      split = db.constants.bool('ShouldInfantryTeamsSplitAcrossFormations', true);
    const c = Math.cos(dir),
      s = Math.sin(dir),
      out = [];
    for (const cl of clusters) {
      const left = cl.slice(),
        mx = cl.reduce((a, g) => a + g.x, 0) / cl.length,
        my = cl.reduce((a, g) => a + g.y, 0) / cl.length;
      while (left.length) {
        left.sort((a, b) => (a.x - mx) ** 2 + (a.y - my) ** 2 - (b.x - mx) ** 2 - (b.y - my) ** 2);
        const seed = left.shift(),
          form = [seed];
        if (!seed.solo && !(seed.team && split)) {
          for (let grew = true; grew; ) {
            grew = false;
            for (let i = left.length - 1; i >= 0; i--) {
              const g = left[i];
              if (g.solo || (g.team && split) || g.cls !== seed.cls || ((g.sameOrder || seed.sameOrder) && g.order !== seed.order))
                continue;
              if (!form.some(f => (f.x - g.x) ** 2 + (f.y - g.y) ** 2 <= near * near)) continue;
              form.push(g);
              left.splice(i, 1);
              grew = true;
            }
          }
        }
        const S0 =
          form.length === 1
            ? 0
            : Math.max(
                Math.ceil(Math.sqrt(form.length)) * Math.max(...form.map(g => g.w)) + 0.25,
                Math.sqrt(Math.max(1, 1.8 * form.reduce((a, g) => a + g.w * g.d, 0)))
              );
        const units = this.formationRows(form, S0, mx, my, c, s);
        let hd = 0,
          hw = 0,
          x = 0,
          y = 0;
        for (const u of units) {
          hd = Math.max(hd, Math.abs(u.off.x) + u.g.hx);
          hw = Math.max(hw, Math.abs(u.off.y) + u.g.hy);
          x += u.g.x;
          y += u.g.y;
        }
        out.push({
          units,
          form,
          S: S0,
          mx,
          my,
          dir,
          x: x / units.length,
          y: y / units.length,
          hd,
          hw,
          need: Math.max(...units.map(u => u.g.need)),
          flies: units.every(u => u.g.flies),
          speed: Math.min(...units.map(u => u.g.speed))
        });
      }
    }
    return out;
  }

  formationRows(form, S, mx, my, c, s) {
    const units = [];
    if (form.length === 1) {
      units.push({ g: form[0], off: { x: 0, y: 0 } });
      return units;
    }
    S = Math.max(S, Math.max(...form.map(g => g.w)));
    const key = g => (g.hero ? -1 : g.range);
    let tol = 0,
      kinds;
    const rank = () => {
      const vals = [...new Set(form.map(key))].sort((a, b) => a - b),
        groups = [];
      for (const v of vals) {
        const last = groups[groups.length - 1];
        if (last && v >= 0 && last[0] >= 0 && v - last[0] <= tol) last.push(v);
        else groups.push([v]);
      }
      return groups;
    };
    for (kinds = rank(); kinds.length >= 4 && tol < 600; kinds = rank()) tol += 15;
    const rows = [];
    for (const grp of kinds) {
      const of = form.filter(g => grp.includes(key(g))).sort((a, b) => (a.q.type.name < b.q.type.name ? -1 : 1));
      let row = [],
        wide = 0;
      for (const g of of) {
        if (row.length && wide + g.w > S) {
          rows.push(row);
          row = [];
          wide = 0;
        }
        row.push(g);
        wide += g.w;
      }
      if (row.length) rows.push(row);
    }
    let back = 0,
      prev = 0;
    rows.forEach((row, r) => {
      const deep = Math.max(...row.map(g => g.d));
      if (r) back += ((prev + deep) / 2) * 20;
      prev = deep;
      row.sort((a, b) => -(a.x - mx) * s + (a.y - my) * c - (-(b.x - mx) * s + (b.y - my) * c));
      const gap = (S - row.reduce((a, g) => a + g.w, 0)) / (row.length + 1);
      let at = 0;
      for (const g of row) {
        at += gap + g.w / 2;
        units.push({ g, off: { x: -back, y: (at - S / 2) * 20 } });
        at += g.w / 2;
      }
    });
    for (const u of units) u.off.x += back / 2;
    return units;
  }

  places(squads, x, y, facing = null) {
    const list = squads.filter(q => q.members.length),
      out = new Map();
    if (!list.length) return out;
    if (list.length === 1) {
      out.set(list[0], { x, y, face: facing });
      return out;
    }
    const mx = list.reduce((a, q) => a + q.members[0].x, 0) / list.length,
      my = list.reduce((a, q) => a + q.members[0].y, 0) / list.length;
    const forms = this.formations(list, facing ?? Math.atan2(y - my, x - mx));
    const C = { x: forms.reduce((a, f) => a + f.x, 0) / forms.length, y: forms.reduce((a, f) => a + f.y, 0) / forms.length };
    forms.sort((a, b) => (a.x - C.x) ** 2 + (a.y - C.y) ** 2 - (b.x - C.x) ** 2 - (b.y - C.y) ** 2);
    const P = forms[0],
      from = this.isOpen(P.x, P.y) ? P : P.units[0].g.q.members[0],
      need = Math.max(...forms.map(f => f.need));
    const room = db.constants.num('BetweenFormationSpacing', 5),
      SIDES = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1]
      ];
    for (let k = 0; k <= 41; k++) {
      const forced = k === 41,
        ring = forced || !k ? 0 : ((k + 7) >> 3) * 20,
        turn = ((k & 7) * Math.PI) / 4;
      const A = { x: x + Math.cos(turn) * ring, y: y + Math.sin(turn) * ring };
      let way = null;
      if (!forced) {
        if (!this.isOpen(A.x, A.y, need)) continue;
        way = this.near(from.x, from.y, A.x, A.y, need);
        if (!way) continue;
      } else way = this.route(from.x, from.y, A.x, A.y, need);
      const pts = [from, ...(way && way.length ? way : [A])];
      const start = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      let end = Math.atan2(pts[pts.length - 1].y - pts[pts.length - 2].y, pts[pts.length - 1].x - pts[pts.length - 2].x);
      if (facing !== null && db.constants.bool('Rotate_Formation_Facing_Moves', true)) end = facing;
      const face = facing ?? end,
        theta = end - start,
        ct = Math.cos(theta),
        st = Math.sin(theta),
        c = Math.cos(face),
        s = Math.sin(face);
      const placed = [];
      let failed = false;
      for (let i = 0; i < forms.length && !failed; i++) {
        const f = forms[i];
        let vx = (f.x - C.x) * ct - (f.y - C.y) * st,
          vy = (f.x - C.x) * st + (f.y - C.y) * ct,
          vl = Math.hypot(vx, vy);
        if (vl < 1e-3 || (i === 0 && forms.length === 1)) {
          vx = -Math.cos(end);
          vy = -Math.sin(end);
        } else {
          vx /= vl;
          vy /= vl;
        }
        const hx = f.hd + room,
          hy = f.hw + room;
        const fits = (px, py) => {
          const ax = (A.x - px) * c + (A.y - py) * s,
            ay = -(A.x - px) * s + (A.y - py) * c;
          if (forms.length > 1 && Math.abs(ax) < hx && Math.abs(ay) < hy) return false;
          for (const o of placed) {
            const ox = (o.x - px) * c + (o.y - py) * s,
              oy = -(o.x - px) * s + (o.y - py) * c;
            if (Math.abs(ox) < hx + o.hx && Math.abs(oy) < hy + o.hy) return false;
          }
          return true;
        };
        let d = 0,
          pos = null,
          blocked = false,
          last = A;
        for (let n = 0; n < 40 && !pos; n++) {
          const m = n & 7;
          let px, py;
          if (m < 4) {
            const dd = i === 0 && !blocked ? 0.5 * d * (n & 1 ? -0.75 : 1) : d;
            px = A.x + vx * dd;
            py = A.y + vy * dd;
            d += 7;
          } else {
            const dd = (d - 28) * (i === 0 ? 0.5 : 1),
              kk = Math.min(hx, hy),
              side = SIDES[m - 4];
            px = A.x + vx * dd + side[0] * kk;
            py = A.y + vy * dd + side[1] * kk;
          }
          last = { x: px, y: py };
          if (!fits(px, py)) continue;
          if (f.flies) {
            pos = last;
            break;
          }
          if (!this.isOpen(px, py, f.need)) {
            blocked = true;
            continue;
          }
          if (blocked && !this.near(A.x, A.y, px, py, f.need)) continue;
          if (this.cluttered(px, py, hx, hy, c, s, f.need, list)) continue;
          pos = last;
        }
        if (!pos && forced) pos = last;
        if (!pos) {
          failed = true;
          break;
        }
        placed.push({ x: pos.x, y: pos.y, hx, hy, f });
      }
      if (failed) continue;
      for (const p of placed) {
        const pace = p.f.units.length > 1 ? p.f.speed : null;
        const F = p.f.units.length > 1 && !p.f.flies ? this.groupMove(p.f, p, face) : null;
        for (const u of p.f.units) {
          const at = { x: p.x + c * u.off.x - s * u.off.y, y: p.y + s * u.off.x + c * u.off.y, face };
          out.set(u.g.q, at);
          u.g.q.formSpeed = pace ? { v: pace, x: at.x, y: at.y } : null;
          u.g.q.formPending = F ? { F, at } : null;
        }
      }
      break;
    }
    return out;
  }

  near(ax, ay, bx, by, need) {
    if (this.clear(ax, ay, bx, by, need)) return [{ x: bx, y: by }];
    const way = this.route(ax, ay, bx, by, need);
    if (!way) return null;
    let len = 0,
      px = ax,
      py = ay;
    for (const p of way) {
      len += Math.hypot(p.x - px, p.y - py);
      px = p.x;
      py = p.y;
    }
    return len <= 1.8 * Math.hypot(bx - ax, by - ay) ? way : null;
  }

  clutterNear(px, py, reach) {
    if (this.clutterAt !== this.time || this.clutterCount !== this.squads.length) {
      this.clutterAt = this.time;
      this.clutterCount = this.squads.length;
      const G = (this.clutterGrid ||= new Map()),
        moving = (this.clutterMoving ||= []);
      for (const l of G.values()) l.length = 0;
      moving.length = 0;
      (this.clutterSent ||= []).length = 0;
      for (const q of this.squads) {
        if (q.structure || !q.members.length) continue;
        if (q.box && !q.ext && q.box.path.length) {
          moving.push(q);
          continue;
        }
        const m0 = q.members[0],
          k = Math.floor(m0.x / CLUTTER_CELL) * 4096 + Math.floor(m0.y / CLUTTER_CELL);
        let l = G.get(k);
        if (!l) G.set(k, (l = []));
        l.push(q);
      }
    }
    const out = (this.clutterList ||= []),
      seen = (this.clutterSeen ||= new Set()),
      G = this.clutterGrid,
      r = reach + FOE_PAD;
    out.length = 0;
    seen.clear();
    const add = q => {
      if (!seen.has(q)) {
        seen.add(q);
        out.push(q);
      }
    };
    for (const q of this.clutterMoving) add(q);
    for (const q of this.clutterSent) add(q);
    const x0 = Math.floor((px - r) / CLUTTER_CELL),
      x1 = Math.floor((px + r) / CLUTTER_CELL),
      y0 = Math.floor((py - r) / CLUTTER_CELL),
      y1 = Math.floor((py + r) / CLUTTER_CELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const l = G.get(cx * 4096 + cy);
        if (l) for (let i = 0; i < l.length; i++) add(l[i]);
      }
    return out;
  }

  cluttered(px, py, hx, hy, c, s, need, sent) {
    const most = 0.15 * hx * hy,
      step = CELL;
    let area = 0;
    for (let a = -hx; a <= hx; a += step)
      for (let b = -hy; b <= hy; b += step) {
        if (!this.isOpen(px + c * a - s * b, py + s * a + c * b, need)) {
          area += step * step;
          if (area > most) return true;
        }
      }
    const wide = Math.hypot(hx, hy) + db.constants.num('Destination_Collision_Query_Extension', 60);
    for (const q of this.clutterNear(px, py, wide + 60)) {
      if (q.structure || !q.members.length || sent.includes(q)) continue;
      const m0 = q.members[0];
      if (q.box && !q.ext && q.box.path.length) {
        const end = q.box.path[q.box.path.length - 1],
          r = Math.max(6, q.box.slack - 10) * 0.8;
        const ax = (end.x - px) * c + (end.y - py) * s,
          ay = -(end.x - px) * s + (end.y - py) * c;
        if (Math.abs(ax) < hx + r && Math.abs(ay) < hy + r) {
          area += Math.PI * r * r;
          if (area > most) return true;
        }
        continue;
      }
      if ((m0.x - px) ** 2 + (m0.y - py) ** 2 > (wide + 60) ** 2) continue;
      for (const u of q.members) {
        if (u.dead || u.inside || u.flies || (u.path && u.path.length)) continue;
        const ax = (u.x - px) * c + (u.y - py) * s,
          ay = -(u.x - px) * s + (u.y - py) * c,
          r = u.foot ? (u.fp ??= u.type.num('Custom_Soft_Footprint_Radius', 0) || 3) : u.body || 5;
        if (Math.abs(ax) < hx + r && Math.abs(ay) < hy + r) {
          area += Math.PI * r * r;
          if (area > most) return true;
        }
      }
    }
    return false;
  }

  attackGroup(squads, foe) {
    const list = squads.filter(q => q.members.length && !q.structure);
    if (!foe || !foe.members.length) return;
    const tb = this.teamOf(foe),
      fm = foe.members;
    const T = tb && !foe.ext ? tb : { x: fm.reduce((a, u) => a + u.x, 0) / fm.length, y: fm.reduce((a, u) => a + u.y, 0) / fm.length };
    const edge = tb ? Math.max(6, tb.slack - 10) : fm[0].body || fm[0].hitRadius || 0,
      lone = db.constants.num('Solo_Attack_Range', 60);
    const all = list.map(q => this.ground(q)),
      cands = [];
    for (const g of all) {
      const d = Math.hypot(g.x - T.x, g.y - T.y),
        reach = Math.min(...g.q.members.map(u => u.range || 0));
      if (
        g.solo ||
        d <= reach + edge ||
        d < Math.hypot(g.hx, g.hy) + reach + lone ||
        g.q.members.some(u => u.flies || (u.needsDeploy && u.weapon))
      )
        this.attack(g.q, foe);
      else cands.push(g);
    }
    if (!cands.length) return;
    if (cands.length === 1) {
      this.attack(cands[0].q, foe);
      return;
    }
    const R = Math.min(...list.map(q => Math.min(...q.members.map(u => u.range || 0)))) + edge;
    const mx = cands.reduce((a, g) => a + g.x, 0) / cands.length,
      my = cands.reduce((a, g) => a + g.y, 0) / cands.length;
    const P = cands.reduce((a, g) => ((g.x - mx) ** 2 + (g.y - my) ** 2 < (a.x - mx) ** 2 + (a.y - my) ** 2 ? g : a));
    const dir = Math.atan2(P.y - T.y, P.x - T.x),
      c = Math.cos(dir),
      s = Math.sin(dir);
    cands.sort((a, b) => -(a.x - T.x) * s + (a.y - T.y) * c - (-(b.x - T.x) * s + (b.y - T.y) * c));
    const least = edge * 1.4;
    const ring = (set, r, half) => {
      const n = set.length,
        mid = n >> 1,
        out = new Array(n),
        FIVE = 5 * DEG;
      const at = (g, ang) => {
        const px = T.x + Math.cos(dir + ang) * r,
          py = T.y + Math.sin(dir + ang) * r;
        for (const o of out) if (o && (o.x - px) ** 2 + (o.y - py) ** 2 < ((o.g.hy + g.hy) * 0.9) ** 2) return null;
        if (
          !this.isOpen(px, py, g.need) ||
          this.cluttered(px, py, g.hx, g.hy, Math.cos(dir + ang + Math.PI), Math.sin(dir + ang + Math.PI), g.need, list)
        )
          return null;
        const stop = Math.max(0, r - edge - 10);
        if (!this.clear(px, py, px - Math.cos(dir + ang) * stop, py - Math.sin(dir + ang) * stop, 1)) return null;
        if (!this.route(g.x, g.y, px, py, g.need)) return null;
        return { g, x: px, y: py };
      };
      const step = (i, k) => Math.asin(Math.min(1, (set[i].hy + set[k].hy) / (2 * r)));
      let a = n & 1 ? 0 : 2 * Math.asin(Math.min(1, set[mid].hy / (2 * r)));
      for (; Math.abs(a) <= half && !(out[mid] = at(set[mid], a)); a = a === 0 ? FIVE : a > 0 ? -a : -a + FIVE);
      if (!out[mid]) return null;
      for (const way of [-1, 1]) {
        let cur = a;
        for (let k = mid + way; k >= 0 && k < n; k += way) {
          let ang = cur + way * (k === mid + way ? 2 : 1) * step(k, k - way);
          for (; Math.abs(ang) <= half && !(out[k] = at(set[k], ang)); ang += way * FIVE);
          if (!out[k]) return null;
          cur = ang;
        }
      }
      return out;
    };
    let plan = null;
    for (let k = db.constants.num('Base_Land_Targeting_Arc_Angle_Coefficient', 0.2); k > -1 && !plan; k -= 0.2) {
      const half = ((1 - k) * Math.PI) / 2,
        got = [];
      let rest = cands.slice(),
        r = R,
        ok = true;
      while (rest.length && ok) {
        const D = Math.max(...rest.map(g => g.hx)),
          at = r - D;
        if (at - D < least || at < Math.max(least, R * k)) {
          ok = false;
          break;
        }
        let put = null,
          n = rest.length;
        for (; n > 0 && !(put = ring(rest.slice(0, n), at, half)); n--);
        if (!put) {
          ok = false;
          break;
        }
        got.push(...put);
        rest = rest.slice(n);
        r = at - D;
      }
      if (ok) plan = got;
    }
    if (!plan) {
      for (const g of cands) this.attack(g.q, foe);
      return;
    }
    for (const p of plan) {
      const q = p.g.q;
      q.foe = foe;
      q.advance = this.time + 1.5;
      for (const u of q.members) u.target = null;
      this.order(q, p.x, p.y, Math.atan2(T.y - p.y, T.x - p.x));
      q.spot = { foe, x: T.x, y: T.y };
    }
  }

  orderGroup(squads, x, y) {
    const at = this.places(squads, x, y);
    for (const [q, p] of at) this.order(q, p.x, p.y, p.face);
    return at;
  }

  checkOverrun() {
    const C = db.constants,
      multiple = parseFloat(C.str('Tactical_Overrun_Multiple')) || 0,
      teams = [...new Set(this.team)];
    if (!(multiple > 0) || teams.length !== 2 || this.time < C.num('Minimum_Tactical_Overrun_Time_In_Secs', 30)) return;
    const power = [0, 0];
    for (const u of this.units) if (!u.dead) power[teams.indexOf(this.team[u.side])] += Math.max(0, u.type.num('AI_Combat_Power', 0));
    const strong = power[0] >= power[1] ? 0 : 1;
    if (!(power[strong] > power[1 - strong] * multiple) || (this.overrun ||= new Set()).has(teams[strong])) return;
    this.overrun.add(teams[strong]);
    this.team.forEach((t, side) => {
      if (t === teams[strong]) {
        this.revealUntil[side] = Infinity;
        this.onOverrun?.(side);
      }
    });
  }

  update(dt) {
    if (this.interp) this.snapPrev();
    this.time += dt;
    this.repathSome();
    if ((this.pointsDt = (this.pointsDt || 0) + dt) >= 0.2) {
      this.updatePoints(this.pointsDt);
      this.pointsDt = 0;
    }
    this.updateTransports(dt);
    this.updateEconomy(dt);
    tickCollisions(this);
    this.tickTeams(dt);
    this.tickGroups(dt);
    if (this.campaign && (this.overrunDt = (this.overrunDt || 0) + dt) >= 0.5) {
      this.overrunDt = 0;
      this.checkOverrun();
    }
    const wx = this.weather;
    if (wx.phases.length && (wx.left -= dt) <= 0) {
      wx.i = (wx.i + 1) % wx.phases.length;
      const ph = wx.phases[wx.i],
        was = wx.name,
        prev = wx.phases[(wx.i + wx.phases.length - 1) % wx.phases.length];
      wx.left = ph.seconds;
      wx.name = ph.name;
      wx.strength = ph.strength;
      wx.lightning = ph.lightning || 0;
      wx.from = wx.level;
      wx.ease = prev.ease || 1;
      wx.eased = 0;
      wx.fogFrom = wx.fog;
      wx.fogTo = ph.fog || 0;
      if (was !== wx.name && this.onWeather) this.onWeather(wx.name);
    }
    if (wx.eased < 1) {
      wx.eased = Math.min(1, wx.eased + dt / wx.ease);
      wx.level = wx.from + (wx.strength - wx.from) * wx.eased;
      wx.fog = wx.fogFrom + (wx.fogTo - wx.fogFrom) * wx.eased;
    } else {
      wx.level = wx.strength;
      wx.fog = wx.fogTo;
    }
    tickAbilities(this, dt);
    this.tickGlows();
    tickBase(this, dt);
    tickClashes(this);
    if (this.time >= (this.sepAt || 0)) {
      this.sepAt = this.time + 0.2;
      this.crushPass();
    }
    this.tickOrders(dt);
    if (dt > 0)
      for (const u of this.units) {
        if (u.lastX !== undefined) {
          u.mvx = (u.x - u.lastX) / dt;
          u.mvy = (u.y - u.lastY) / dt;
          u.mvz = ((u.z || 0) - u.lastZ) / dt;
        }
        u.lastX = u.x;
        u.lastY = u.y;
        u.lastZ = u.z || 0;
        const moving = (u.mvx || 0) ** 2 + (u.mvy || 0) ** 2 > 1,
          h = moving ? Math.atan2(u.mvy, u.mvx) : undefined;
        u.turnW = h === undefined || u.lastH === undefined ? 0 : Math.atan2(Math.sin(h - u.lastH), Math.cos(h - u.lastH)) / dt;
        u.lastH = h;
      }
    let k = 0;
    if (this.shots.length) {
      let m = 0;
      for (const u of this.units) if (!u.dead && u.hitRadius > m) m = u.hitRadius;
      this.hitMax = m;
    }
    for (const s of this.shots) {
      if (s.cat !== undefined) {
        if (this.flyShot(s, dt)) this.shots[k++] = s;
        continue;
      }
      if (s.track && !s.target.dead) {
        const T = s.target,
          sp = s.speed ?? s.w.speed,
          dx = T.x + s.ox - s.x,
          dy = T.y + s.oy - s.y,
          dz = T.z + T.aimZ * 0.6 - s.bz,
          d = Math.hypot(dx, dy, dz) || 1;
        s.vx = (dx / d) * sp;
        s.vy = (dy / d) * sp;
        s.vz = (dz / d) * sp;
        s.left = d;
        s.total = Math.max(s.total, d);
        s.ax = T.x + s.ox;
        s.ay = T.y + s.oy;
      }
      const go = Math.min(s.left, (s.speed ?? s.w.speed) * dt);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.left -= go;
      if (s.track && (s.flown += go) >= s.reach) {
        s.track = false;
        s.ax = s.x;
        s.ay = s.y;
        s.left = 0;
        s.expired = true;
      }
      {
        const k = Math.max(0, 1 - s.left / s.total);
        s.bz += s.vz * dt;
        s.z = s.bz + (s.arc ? s.arc * 4 * k * (1 - k) : 0);
      }
      if (s.left > 8 && s.left < s.total * 0.95) {
        const gz = heightAt(this.terrain, s.x, s.y);
        if (s.z < gz - 2) {
          s.ax = s.x;
          s.ay = s.y;
          s.z = gz;
          s.left = 0;
          s.ground = true;
        }
      }
      if (s.left > 0.01) {
        this.shots[k++] = s;
        continue;
      }
      const t = s.target;
      if (!t.dead && !t.spot) t.lastDamage = s.w.damageType;
      if (!s.ground && !s.expired && !t.dead && Math.hypot(t.x - s.ax, t.y - s.ay) <= t.hitRadius && !this.deflects(t, s))
        this.hurt(t, s.damage * db.damageMod(s.w.damageType, t.armor) * this.absorbs(t, s), s.from);
      else this.misses = (this.misses || 0) + 1;
      const sw = s.w;
      sw.blastR ??= sw.proj.num('Projectile_Blast_Area_Range', 0);
      sw.blastD ??= sw.proj.num('Projectile_Blast_Area_Damage', 0);
      if (sw.blastR > 0 && sw.blastD > 0 && !s.dud) {
        const r2 = sw.blastR * sw.blastR;
        for (const o of this.foesNear(s.ax, s.ay, sw.blastR).slice()) {
          if (o.dead || o.flies || !this.blastReaches(o, s.from.side, sw.proj)) continue;
          const d2 = (o.x - s.ax) ** 2 + (o.y - s.ay) ** 2;
          if (d2 <= r2) this.hurt(o, sw.blastD * (1 - (0.5 * Math.sqrt(d2)) / sw.blastR) * db.damageMod(sw.damageType, o.armor), s.from);
        }
      }
      if (s.onLand) s.onLand(s);
      else if (this.onImpact) this.onImpact(s);
      s.done = true;
    }
    this.shots.length = k;
    if (this.flashes.length) this.flashes = this.flashes.filter(f => (this.time < f.until ? true : (f.mesh.visible = false)));
    let alive = 0;
    for (const u of this.units) {
      if (u.dead && u.flies && !u.gone) {
        const S = u.spin,
          A = u.air;
        if (S && A && S.path && (S.done += S.speed * dt) < S.end) {
          const at = pathAt(S.path, S.done);
          if (at && at.z > heightAt(this.terrain, at.x, at.y)) {
            u.x = at.x;
            u.y = at.y;
            u.z = at.z;
            u.heading = Math.atan2(at.dy, at.dx);
            A.pitch = Math.atan2(-at.dz, Math.hypot(at.dx, at.dy)) || 0;
            A.roll += SPIN_ROLL * dt;
            u.holder.position.set(u.x, u.y, u.z);
            u.holder.quaternion
              .copy(_turn.setFromAxisAngle(_Z, u.heading + Math.PI / 2))
              .multiply(_q.setFromAxisAngle(_Y, A.roll))
              .multiply(_q.setFromAxisAngle(_X, A.pitch));
            this.units[alive++] = u;
            continue;
          }
        }
        if (S && this.onFx) {
          const ex = u.type.list('Death_Explosions');
          if (ex.length) this.onFx(ex[Math.floor(Math.random() * ex.length)], u.x, u.y, u.z);
        }
        u.gone = true;
        this.scene.remove(u.holder);
        continue;
      }
      if (u.dead) {
        if (u.anim) {
          const l = this.look,
            seen = !l || (u.holder.visible && (u.x - l.x) ** 2 + (u.y - l.y) ** 2 <= l.r * l.r && (!l.see || l.see(u, POSE_MARGIN)));
          const posed = t => (this.poseCache && cachedPose(u, t, this)) || (t ? u.anim.step(t) : u.anim.pose(), true);
          if (seen) posed(dt);
          else u.anim.advance(dt);
          if (u.anim.done) {
            if (!seen) posed(0);
            u.anim = null;
          }
        }
        if (!u.gone && this.time - u.died > (u.lieFor ?? Infinity)) {
          const endFx = u.endFx || [];
          let end = u.vanish || endFx.length > 0 || !(u.fadeTime > 0);
          if (!end) {
            if (u.fadeAt === undefined) {
              u.fadeAt = this.time;
              settlePose(u.inst);
            }
            const w = (2 / u.fadeTime) * (this.time - u.fadeAt),
              left = (1 + w) * Math.exp(-w);
            this.skin(u).fade = 1 - left;
            end = left <= 0.025;
          }
          if (end) {
            u.gone = true;
            this.scene.remove(u.holder);
            if (u.footprint && !u.structure) this.unstamp(u);
            if (endFx.length && this.onFx) this.onFx(endFx[Math.floor(Math.random() * endFx.length)], u.x, u.y, u.z + 4);
            if (u.endSfx && this.onSound) this.onSound(u.endSfx, u.x, u.y);
          }
        }
        if (!u.gone) this.units[alive++] = u;
        continue;
      }
      this.units[alive++] = u;
      if (u.cinematicTransport) continue;
      if (u.structure) {
        if (u.weapon && u.side >= 0 && !u.unpowered && !(u.stunUntil > this.time)) {
          this.fight(u, dt);
          if (!u.fixedHeading) u.holder.rotation.z = u.heading + Math.PI / 2;
          if (u.turret) this.show(u, dt);
        } else if (u.anim) this.show(u, dt);
        continue;
      }
      if (u.inside) {
        u.x = u.inside.x;
        u.y = u.inside.y;
        u.z = u.inside.z + u.inside.aimZ * 0.5;
        if (u.gunner) this.fight(u, dt);
        continue;
      }
      if (u.rope) {
        this.ropeStep(u, dt);
        continue;
      }
      if (u.flight) {
        const f = u.flight,
          k = Math.min(1, (f.t += dt) / f.T);
        u.x = f.x0 + (f.x1 - f.x0) * k;
        u.y = f.y0 + (f.y1 - f.y0) * k;
        u.z = heightAt(this.terrain, u.x, u.y) + Math.sin(Math.PI * k) * 45;
        u.holder.position.set(u.x, u.y, u.z);
        u.holder.rotation.z = u.heading + Math.PI / 2;
        if (k >= 1) u.flight = null;
        continue;
      }
      if (u.stunUntil > this.time) {
        this.setAnim(u, 'idle');
        u.holder.position.set(u.x, u.y, u.z);
        continue;
      }
      if (u.direct) {
        this.directStep(u, dt);
        continue;
      }
      if (u.flies && !u.rooted && u.scriptZ === undefined) {
        if (u.guns && u.side >= 0) this.fireGuns(u, dt);
        this.fly(u, dt);
        continue;
      }
      if (u.rooted) u.path = [];
      if (u.guns && u.side >= 0 && !(u.cloaked && !u.squad.foe)) this.fireGuns(u, dt);
      if (u.turret && !u.weapon && u.guns) this.aimHead(u, dt);
      if (this.fight(u, dt)) {
        if (u.hoverH > 0) this.hoverStep(u, dt, false);
        u.z = u.scriptZ ?? heightAt(this.terrain, u.x, u.y) + u.lift + u.hoverZ;
        u.holder.position.set(u.x, u.y, u.z);
        u.holder.rotation.z = u.heading + Math.PI / 2;
        this.show(u, dt);
        continue;
      }
      if (u.hoverH > 0 && this.hoverStep(u, dt, !!(u.path.length || (u.squad.box && !u.squad.ext && u.slot && u.squad.box.path.length)))) {
        u.v = 0;
        this.setAnim(u, 'idle');
        u.z = u.scriptZ ?? heightAt(this.terrain, u.x, u.y) + u.lift + u.hoverZ;
        u.holder.position.set(u.x, u.y, u.z);
        u.holder.rotation.z = u.heading + Math.PI / 2;
        this.show(u, dt);
        continue;
      }
      const led = u.squad.box && !u.squad.ext && u.slot ? this.teamWalk(u, u.squad.box, dt) : false;
      const next = led ? null : u.path[0];
      if (!led) u.v = 0;
      if (led) {
      } else if (next) {
        const dx = next.x - u.x,
          dy = next.y - u.y,
          d = Math.hypot(dx, dy);
        const want = Math.atan2(dy, dx);
        let da = want - u.heading;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (u.stopping && u.stopping.to !== u.path[u.path.length - 1]) u.stopping = null;
        if (u.stopping) {
          this.walkStop(u, next, d, dt);
          continue;
        }
        if (u.walkTrans && u.walking && u.path.length === 1 && Math.abs(da) < 0.6 && this.walkStopStarts(u, d)) {
          this.walkStop(u, next, d, dt);
          continue;
        }
        if (u.preTurns && !u.preTurn && Math.abs(da) > (u.stopTurn || u.turn) / LOGIC_FPS) u.preTurn = this.preTurnOf(u, da);
        const step = (u.preTurn ? u.preTurn.rate : u.turn) * dt,
          turned = Math.abs(da) <= step ? da : Math.sign(da) * step;
        u.heading += turned;
        if (u.preTurn && u.preTurn.until && this.time >= u.preTurn.until)
          u.preTurn = Math.abs(da - turned) > 1e-3 ? this.preTurnOf(u, da - turned) : null;
        if (u.preTurn) {
          u.walking = false;
          this.setAnim(u, u.preTurn.anim);
          if (!u.preTurn.until) u.preTurn.until = this.time + (u.anim ? u.anim.anim.duration / (u.anim.speed || 1) : 0);
          u.z = u.scriptZ ?? heightAt(this.terrain, u.x, u.y) + u.lift + u.hoverZ;
          u.holder.position.set(u.x, u.y, u.z);
          u.holder.rotation.z = u.heading + Math.PI / 2;
          this.show(u, dt);
          continue;
        }
        if (Math.abs(da) < 0.6 && !u.walking && u.walkTrans && this.oneShot(u, 'MOVESTART', 'move')) u.fromStart = true;
        u.walking = Math.abs(da) < 0.6;
        if (Math.abs(da) < 0.6) {
          const pace = this.paceOf(u);
          u.slow = pace < 0.75;
          const go = Math.min(
            d,
            Math.min((u.squad.formSpeed ? Math.min(u.speed, u.squad.formSpeed.v) : u.speed) * pace, u.ccCap ?? Infinity) * dt
          );
          u.v = dt > 0 ? go / dt : 0;
          const fx = u.x + Math.cos(u.heading) * go,
            fy = u.y + Math.sin(u.heading) * go;
          if (u.flies || this.isOpen(fx, fy, (u.need & ~3) | 1)) {
            u.x = fx;
            u.y = fy;
          } else if (this.isOpen(u.x + (dx / d) * go, u.y + (dy / d) * go, (u.need & ~3) | 1)) {
            u.x += (dx / d) * go;
            u.y += (dy / d) * go;
          } else if (!this.blocked(u, next)) u.path = [];
        }
        if (d < Math.max(2, u.speed * dt * 1.5)) u.path.shift();
        this.setAnim(u, Math.abs(da) < 0.6 ? 'move' : da > 0 ? 'turnL' : 'turnR');
        this.moveRate(u);
      } else {
        if (u.walking && u.walkTrans) this.walkEnd(u);
        u.walking = false;
        u.preTurn = null;
        u.stopping = null;
        this.setAnim(u, 'idle');
        if (u.foot && u.animKind === 'idle' && this.time > (u.fidgetAt ??= this.time + 5 + simRandom() * 15)) {
          u.fidgetAt = this.time + 8 + simRandom() * 16;
          this.oneShot(u, 'IDLE', 'idle', vs => (vs.length > 1 ? vs[1 + Math.floor(simRandom() * (vs.length - 1))] : null));
        }
      }
      u.z = u.scriptZ ?? heightAt(this.terrain, u.x, u.y) + u.lift + u.hoverZ;
      u.holder.position.set(u.x, u.y, u.z);
      u.holder.rotation.z = u.heading + Math.PI / 2;
      this.show(u, dt);
    }
    this.units.length = alive;
  }
}
