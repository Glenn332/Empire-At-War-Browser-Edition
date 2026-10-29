import * as THREE from '../../vendor/three/build/three.module.js';
import { db, spawnList, SPAWN_TIERS } from '../gamedata.js';
import { Pathfinder, layerMask, ASTEROID_LAYERS } from './pathfind.js';
import { prioritySet, priorityOf, setOf } from './priorities.js';
import { BountyBook, bountyValue } from './bounty.js';
import { getModelData, buildModel, flattenModel } from '../model.js';
import { getALA, animName, AnimState } from '../ala.js';
import { parseAbilities, attachAbilities, tickAbilities, useAbility, refreshMods, addStatus, aiUseAbilities } from './abilities.js';
import { simRandom } from './simrandom.js';
import { collisionOf, meshHit } from './collmesh.js';
import {
  CAT,
  categoryOf,
  aimsOff,
  intercept,
  inaccuracy as offAim,
  turnToward,
  rocketPath,
  pathAt,
  sweep,
  sweepBox,
  leadTurning
} from './projflight.js';
import { fireNum, startingWeapon, fireSound, fixedMuzzle } from './weaponswap.js';
import { leadPoint } from './orders.js';
export const spacePop = t =>
  t.has('Space_Override_Population_Value') ? t.num('Space_Override_Population_Value', 0) : t.num('Population_Value', 0);

export const LOGIC_FPS = 30;

export function stationLevel(unit) {
  const base = unit.type.num('Base_Level', 0),
    hps = unit.hardpoints.filter(h => h.destroyable),
    total = hps.length,
    gone = hps.filter(h => !h.alive).length;
  if (!total || base > total) return base;
  if (gone >= total) return 0;
  return Math.max(0, Math.min(base, base - Math.trunc((gone * base) / total)));
}
const PROBE_CELL = 1024,
  PROBE_PAD = 80;
const _nearCap = [],
  byGridAt = (a, b) => a.gridAt - b.gridAt;
const LAUNCHES_PER_STEP = 2;
const UNIT_CELL = 1024,
  UNIT_PAD = 200;
const HIT_CELL = 256;
const VIS_CELL = 512;
const LOOP_OVER = (170 * Math.PI) / 180,
  DOG_CELL = 400,
  DOG_NEAR = 80000,
  PAIR_TIME = 10,
  IDLE_NEAR = 90,
  IDLE_CELL = 120;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
export const SHIELD_FLASH = 0.1,
  SHIELD_FADE = 0.28;

export const wrapAngle = a => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + simRandom() * (b - a);
const dist2 = (a, b) => {
  const dx = a.x - b.x,
    dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const SIZE_CLASSES = ['FIGHTER', 'BOMBER', 'TRANSPORT', 'CORVETTE', 'FRIGATE', 'CAPITAL', 'SUPER', 'STRUCTURE'];

export function sizeClass(type) {
  const cats = type.categories();
  for (const c of SIZE_CLASSES) if (cats.has(c)) return c;
  const sc = type.str('Ship_Class').toUpperCase();
  return SIZE_CLASSES.includes(sc) ? sc : 'FRIGATE';
}

export function buildListFor(type, factionName) {
  const out = [];
  let current = null;
  for (const tok of type.list('Tactical_Buildable_Objects_Multiplayer')) {
    if (db.faction(tok)) {
      current = tok.toUpperCase();
      continue;
    }
    if (current === factionName.toUpperCase()) {
      const t = db.type(tok);
      if (t) out.push(t);
    }
  }
  return out;
}

export function particleFile(typeName) {
  const t = db.type(typeName);
  return t ? t.str('Space_Model_Name') || t.str('Land_Model_Name') : '';
}

export const buildCost = t => t.num('Tactical_Build_Cost_Multiplayer', t.num('Build_Cost_Credits', 0));
export const buildTime = t => t.num('Tactical_Build_Time_Seconds', t.num('Build_Time_Seconds', 10));
export const isSquadronType = t => t.has('Squadron_Units');
export const isCompanyType = t => t.has('Company_Units');
export function companySpaceUnits(type) {
  const out = [];
  const add = n => {
    const t = db.type(n);
    if (t && (t.has('Space_Model_Name') || t.has('Squadron_Units')) && !out.includes(t)) out.push(t);
  };
  for (const n of type.list('Company_Units')) {
    const hero = db.type(n);
    if (hero) {
      add(hero.str('Unique_Space_Unit'));
      add(n);
    }
  }
  if (!out.length) for (const n of type.list('Company_Transport_Unit')) add(n);
  return out;
}

export const isUpgradeType = t => t.tag.toLowerCase() === 'upgradeobject';

export function modelsForType(type, factions = null, out = new Set(), seen = new Set(), later = null) {
  if (!type || seen.has(type)) return out;
  seen.add(type);
  const m = type.str('Space_Model_Name');
  if (m) out.add(m);
  for (const hpName of type.list('HardPoints')) {
    const hp = db.hardpoint(hpName);
    if (!hp) continue;
    if (hp.str('Model_To_Attach')) out.add(hp.str('Model_To_Attach'));
    modelsForType(db.type(hp.str('Fire_Projectile_Type')), factions, out, seen, later);
  }
  for (const k of [
    'Squadron_Units',
    'Company_Units',
    'Company_Transport_Unit',
    'Unique_Space_Unit',
    'Projectile_Types',
    'Tactical_Buildable_Constructed',
    'Next_Level_Base'
  ])
    for (const n of type.list(k)) modelsForType(db.type(n), factions, out, seen, later);
  for (let n = 0; n < SPAWN_TIERS; n++)
    for (const tup of [...type.tuples('Starting_Spawned_Units_Tech_' + n), ...type.tuples('Reserve_Spawned_Units_Tech_' + n)])
      modelsForType(db.type(tup[0]), factions, out, seen, later);
  for (const tup of type.tuples('Death_Clone')) modelsForType(db.type(tup[1]), factions, out, seen, later);
  const builds = factions
    ? factions.flatMap(f => buildListFor(type, f))
    : type.list('Tactical_Buildable_Objects_Multiplayer').map(n => db.type(n));
  for (const t of builds) {
    if (!later) modelsForType(t, factions, out, seen);
    else if (t && !seen.has(t) && !later.includes(t)) later.push(t);
  }
  return out;
}

const NEBULA_KEEPS = new Set([
  'HUNT',
  'LURE',
  'LUCKY_SHOT',
  'DEPLOY_TROOPERS',
  'DEPLOY_STORMTROOPERS',
  'SELF_DESTRUCT',
  'SPRINT',
  'ION_CANNON_SHOT',
  'SPOILER_LOCK',
  'MAXIMUM_FIREPOWER',
  'MAX_FIREPOWER',
  'STIM_PACK'
]);

const isFieldType = t => t.bool('Is_Asteroid_Field') || t.bool('Is_Nebula') || t.bool('Is_Ion_Storm');
const flownThrough = u => (u.isField ??= isFieldType(u.type) || (u.isStructure && !u.type.behaviors().has('SPACE_OBSTACLE')));

export class Team {
  constructor(id, factionName) {
    this.id = id;
    this.factionName = factionName;
    this.players = [];
    this.station = null;
    this.firstStation = null;
    this.spawnPoints = [];
    this.upgrades = new Set();
    this.bonuses = [];
    this.incomeMods = [];
    this.defeated = false;
    this.bit = id >= 0 ? 1 << id : 0;
    this.mapSide = false;
  }
}

const HYPER = (() => {
  const ease = x => (x <= 0.5 ? (x * 4) / 3 : 2 / 3 + ((x - (x * x) / 2 - 0.5 + 0.125) * 4) / 3 / 0.5);
  const step = f =>
    f < 25 ? 0 : f < 35 ? 750 : f < 45 ? 750 - ease((f - 34) / 10) * 741.875 : f < 120 ? 8.125 : 8.125 - ease((f - 119) / 30) * 8.125;
  const gone = [0];
  for (let f = 0; f < 150; f++) gone.push(gone[f] + step(f));
  return { frames: 150, show: 35, gone, far: gone[150] };
})();

export class Player {
  constructor(id, team, { human = false, credits = 6000, color = null, popCap = 0, name = '', difficulty = 'medium' } = {}) {
    this.id = id;
    this.team = team;
    team.players.push(this);
    this.faction = db.faction(team.factionName);
    this.factionName = this.faction.name;
    this.human = human;
    this.name = name || (human ? 'You' : 'Bot ' + id);
    this.difficulty = difficulty;
    this.credits = credits;
    if (color instanceof THREE.Color) this.color = color;
    else {
      const c = color || this.faction.vec('Color', [200, 200, 200]);
      this.color = new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
    }
    this.pop = 0;
    this.popCap = 0;
    this.popCapFixed = popCap;
    this.stats = { built: 0, lost: 0, killed: 0, earned: 0 };
    this.bounty = 0;
    this.campaignTech = undefined;
    this.basePos = { x: 0, y: 0 };
    this.reinforcements = [];
    this.adjust = null;
  }
  get bit() {
    return this.team.bit;
  }
  get upgrades() {
    return this.team.upgrades;
  }
  get bonuses() {
    return this.team.bonuses;
  }
  get incomeMods() {
    return this.team.incomeMods;
  }
  get spawnPoints() {
    return this.team.spawnPoints;
  }
  get station() {
    return this.team.station;
  }
  get techLevel() {
    const st = this.team.station;
    let n = this.campaignTech !== undefined ? this.campaignTech : st && !st.dead ? st.type.num('Base_Level', 1) : 1;
    for (const name of this.team.upgrades) {
      const t = db.type(name);
      if (t && t.bool('Tactical_Build_Increments_Tech_Level')) n++;
    }
    return n;
  }
  set station(s) {
    this.team.station = s;
  }
  get defeated() {
    return this.team.defeated;
  }
  allied(other) {
    return !!other && other.team === this.team;
  }
}

class Hardpoint {
  constructor(unit, def) {
    this.unit = unit;
    this.def = def;
    this.kind = def.str('Type').toUpperCase();
    this.maxHealth = def.num('Health', 100);
    this.health = this.maxHealth;
    this.alive = true;
    this.targetable = def.bool('Is_Targetable', true);
    this.destroyable = def.bool('Is_Destroyable', true);
    this.proj = db.type(def.str('Fire_Projectile_Type'));
    this.isWeapon = !!this.proj;
    this.range = def.num('Fire_Range_Distance', 0);
    this.coneHalf = Math.min(180, def.num('Fire_Cone_Width', 360) / 2) * DEG;
    this.rechargeMin = def.num('Fire_Min_Recharge_Seconds', 2);
    this.rechargeMax = def.num('Fire_Max_Recharge_Seconds', this.rechargeMin);
    this.pulses = Math.max(1, def.num('Fire_Pulse_Count', 1));
    this.pulseDelay = def.num('Fire_Pulse_Delay_Seconds', 0.2);
    this.damageType = def.str('Damage_Type') || (this.proj ? this.proj.str('Damage_Type') : 'Damage_Default');
    this.inaccuracy = new Map(def.tuples('Fire_Inaccuracy_Distance').map(([c, v]) => [c.toUpperCase(), parseFloat(v)]));
    this.fireSfx = def.str('Fire_SFXEvent');
    this.restrict = new Set(def.list('Fire_Category_Restrictions').map(c => c.toUpperCase()));
    this.cooldown = rand(0, this.rechargeMax);
    this.pulsesLeft = 0;
    this.pulseTimer = 0;
    this.fireIndex = 0;
    this.forward = def.bool('Fires_Forward');
    this.target = null;
    this.targetHp = null;
    this.local = { x: 0, y: 0, z: 0 };
    this.fireLocal = [];
    this.facing = 0;
    this.model = null;
    this.decal = null;
    this.bone = undefined;
    this.part = undefined;
    this.smoke = undefined;
    this.rules = undefined;
    this.lookAt = undefined;
  }
  worldPos(out) {
    const u = this.unit,
      c = Math.cos(u.heading),
      s = Math.sin(u.heading),
      l = this.local;
    out.x = u.x + c * l.x - s * l.y;
    out.y = u.y + s * l.x + c * l.y;
    out.z = u.z + l.z;
    return out;
  }
}

let nextId = 1;
let shotIds = 0;
export function resetEntityIds() {
  nextId = 1;
}

export class Unit {
  constructor(world, type, player, x, y, heading) {
    this.world = world;
    this.id = nextId++;
    this.type = type;
    this.player = player;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.z = type.num('Layer_Z_Adjust', 0);
    this.speed = 0;
    this.roll = 0;
    this.dead = false;
    this.selected = false;
    const beh = type.behaviors();
    this.revealsFiring = beh.has('REVEAL');
    this.isFighter = beh.has('FIGHTER_LOCOMOTOR');
    this.isMobile = this.isFighter || beh.has('SIMPLE_SPACE_LOCOMOTOR') || beh.has('STARSHIP_LOCOMOTOR');
    this.isPad = (beh.has('TACTICAL_BUILD_OBJECTS') && !type.has('Tactical_Health')) || type.name.toUpperCase().endsWith('_PAD');
    this.isStation = type.tag.toLowerCase() === 'starbase';
    this.isStructure = !this.isMobile;
    this.layer = layerMask(type);
    this.asteroidDamage = beh.has('ASTEROID_FIELD_DAMAGE') && ASTEROID_LAYERS.has(this.layer);
    this.underConstruction = beh.has('TACTICAL_UNDER_CONSTRUCTION');
    this.selectable = beh.has('SELECTABLE') || this.isPad || type.has('Tactical_Buildable_Objects_Multiplayer');
    this.targetableUnit = !this.isPad && type.bool('Collidable_By_Projectile_Living', !this.isPad);
    this.sizeClass = sizeClass(type);
    this.scale = type.num('Scale_Factor', 1);
    this.armor = type.str('Armor_Type', 'Armor_Default');
    this.shieldArmor = type.str('Shield_Armor_Type', 'Shield_Default');
    this.maxSpeed = type.num('Max_Speed', 0) * LOGIC_FPS;
    this.minSpeed = type.num('Min_Speed', 0) * LOGIC_FPS;
    this.turnRate = type.num('Max_Rate_Of_Turn', 1) * LOGIC_FPS * DEG;
    this.bankAngle = type.num('Bank_Turn_Angle', 0) * DEG;
    this.accel = type.num('OverrideAcceleration', 0) * LOGIC_FPS * LOGIC_FPS || Math.max(10, this.maxSpeed * 0.6);
    this.maxShield = type.num('Shield_Points', 0);
    this.shield = this.maxShield;
    this.shieldRate = type.num('Shield_Refresh_Rate', 0) / db.constants.num('ShieldRechargeIntervalInSecs', 3);
    this.shieldDownTimer = 0;
    this.shieldTick = 0;
    const cap = type.behaviors().has('POWERED') ? type.num('Energy_Capacity', 0) : 0;
    this.energy = cap > 0 ? { value: cap, cap, refill: type.num('Energy_Refresh_Rate', 0), tick: 0 } : null;
    this.ionUntil = 0;
    this.attackRange = type.num('Targeting_Max_Attack_Distance', 800);
    this.pop = spacePop(type);
    this.hardpoints = [];
    this.baseHealth = type.num('Tactical_Health', 100);
    this.maxHealth = this.baseHealth;
    this.health = this.maxHealth;
    this.order = { kind: 'idle' };
    this.target = null;
    this.targetHp = null;
    this.enemies = [];
    this.scanTimer = simRandom() * 0.5;
    this.squad = null;
    this.carrier = null;
    this.radius = 30;
    this.hitRadius = 20;
    this.height = 20;
    this.lastHitTime = -100;
    this.buildQueues = new Map();
    this.buildList = [];
    this.padChild = null;
    this.padOf = null;
    this.capture = null;
    this.income = null;
    this.garrison = [];
    this.spawnTimer = 0;
    this.hyper = null;
    this.engineGlows = [];
    this.bonus = { damage: 1, defense: 1, speed: 1, health: 1, shield: 1, hm: 1 };
    this.abilities = [];
    this.statuses = [];
    this.cloaked = false;
    this.mods = { weaponDelay: 1, shieldRegen: 1, shieldInterval: 1, speed: 1, damageTaken: 1, damageDealt: 1 };
    this.revealRange = type.num('Space_FOW_Reveal_Range', 600);
    this.seenBy = 0;
    this.everSeenBy = 0;
    this.weapon = null;
    this.weapons = null;
    this.weaponIndex = 0;
    this.obj = new THREE.Group();
    this.obj.quaternion._onChange(NO_EULER);
    this.model = null;
    this.visualRadius = undefined;
    this.ringSize = undefined;
    this.ringZ = undefined;
    this.engineMeshes = undefined;
    this.parts = undefined;
    this.proxies = undefined;
    this.pendingProxies = undefined;
    this.hasEngineFx = undefined;
    this.shieldMesh = undefined;
    this.shieldFlash = undefined;
    this.shieldGlow = undefined;
    this.shieldAt = undefined;
    this.selectScale = undefined;
    this.hpDriven = undefined;
    this.maxRange = undefined;
    this.engageRange = undefined;
    this.hasWeapons = undefined;
    this.turrets = undefined;
    this.anim = undefined;
    this.modelFile = undefined;
    this.buildAnim = undefined;
    this.casters = undefined;
    this.animOwed = undefined;
    this.halfLen = undefined;
    this.halfWid = undefined;
    this.mapIndex = undefined;
    this.gridAt = undefined;
    this.direct = undefined;
    this.hitA = undefined;
    this.hitB = undefined;
    this.hitC = undefined;
    this.hitZ = undefined;
    this.hitF = undefined;
    this.hitL = undefined;
    this.hitReach = undefined;
    this.turnW = undefined;
    this.lastH = undefined;
    this.coll = undefined;
    this.collR = undefined;
    this.collBall = undefined;
    this.isField = undefined;
    this.pathExt = undefined;
    this.construction = undefined;
    this.heal = undefined;
    this.padOwner = undefined;
    this.capAff = undefined;
    this.influences = undefined;
    this.fieldTimer = undefined;
    this.inAsteroids = undefined;
    this.inNebula = undefined;
    this.inIon = undefined;
    this.haze = undefined;
    this.asteroidFx = undefined;
    this.instList = undefined;
    this.instWarm = undefined;
    this.instMoves = undefined;
    this.instStamp = undefined;
    this._iconName = undefined;
    this._iconX = undefined;
    this._iconY = undefined;
    this._iconSize = undefined;
    this._iconFrame = undefined;
    this.darkHooked = undefined;
    this.spotted = undefined;
    this.revealSize = undefined;
    this.lastSeen = undefined;
    this.px = undefined;
    this.py = undefined;
    this.pz = undefined;
    this.ph = undefined;
    this.pr = undefined;
    this.cx = undefined;
    this.cy = undefined;
    this.cz = undefined;
    this.ch = undefined;
    this.cr = undefined;
    this.tx = undefined;
    this.ty = undefined;
    this.tz = undefined;
    this.th = undefined;
    this.tr = undefined;
    this.ix = undefined;
    this.iy = undefined;
    this.iz = undefined;
    this.ih = undefined;
    this.ir = undefined;
    this.wasShown = undefined;
    this.pitch = undefined;
    this.pp = undefined;
    this.cp = undefined;
    this.tp = undefined;
    this.pitched = undefined;
    this.flip = undefined;
    this.launchZ = undefined;
    this.slot = undefined;
    this.member = undefined;
    this.fstate = undefined;
    this.flyBy = undefined;
    this.flyTimer = undefined;
    this.spawnDelay = undefined;
    this.pickAt = undefined;
    this.lossRate = undefined;
    this.lossAt = undefined;
    this.hurtBy = undefined;
    this.radarHit = undefined;
    this.lastAttacker = undefined;
    this.lastAlarm = undefined;
    this.queue = undefined;
    this.route = undefined;
    this.slotCheck = undefined;
    this.slotX = undefined;
    this.slotY = undefined;
    this.slotAt = undefined;
    this.handDeploy = undefined;
    this.guardFollow = undefined;
    this.guardAt = undefined;
    this.guardOf = undefined;
    this.homeOf = undefined;
    this.home = undefined;
    this.huntTimer = undefined;
    this.sysAt = undefined;
    this.abilityLock = undefined;
    this.slotAt = undefined;
    this.attackPositioning = false;
    this.pendingAbility = undefined;
    this.baseMaxSpeed = undefined;
    this.scripted = undefined;
    this.scriptHidden = undefined;
    this.cannotDie = undefined;
    this.holdFire = undefined;
    this.invulnerable = undefined;
    this.noAI = undefined;
    this.noGarrison = undefined;
    this.suspended = undefined;
    this.aiPower = undefined;
    this.aiPlan = undefined;
    this.goalTarget = undefined;
    this.ckinds = undefined;
    this.fsKind = undefined;
    this.isTypes = undefined;
    this._lists = undefined;
    this.prioSet = undefined;
    this.setup();
  }

  setup() {
    const t = this.type,
      w = this.world;
    const data = getModelData(t.str('Space_Model_Name'));
    if (data) {
      this.model = buildModel(data, { teamColor: this.player && this.player.id >= 0 ? this.player.color : null, ...w.modelOpts });
      this.obj.add(this.model.root);
      const r = this.model.radius * this.scale;
      this.revealSize = r;
      this.height = (this.model.box.max.z - this.model.box.min.z) * this.scale;
      this.radius = t.num('Custom_Soft_Footprint_Radius', 0) || t.num('Custom_Footprint_Radius', 0) || Math.max(8, r * 0.7);
      this.hitRadius = Math.max(10, r * 0.55);
      if (!this.isFighter) {
        const b = this.model.box,
          s = this.scale;
        this.hitA = Math.max(4, (b.max.y - b.min.y) * 0.5 * s);
        this.hitB = Math.max(4, (b.max.x - b.min.x) * 0.5 * s);
        this.hitC = Math.max(4, (b.max.z - b.min.z) * 0.5 * s);
        this.hitZ = (b.max.z + b.min.z) * 0.5 * s;
        this.hitF = -(b.max.y + b.min.y) * 0.5 * s;
        this.hitL = (b.max.x + b.min.x) * 0.5 * s;
      }
      this.coll = collisionOf(data);
      if (this.coll) {
        const B = this.coll.box;
        this.collR = Math.hypot(Math.max(-B[0], B[3]), Math.max(-B[1], B[4]), Math.max(-B[2], B[5])) * this.scale;
      }
      {
        const m = t.num('Collision_Box_Modifier', 1),
          b = this.model.box;
        this.collBall = m > 1 ? Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) * 0.5 * this.scale * m : 0;
      }
      this.visualRadius = Math.max(10, r);
      if (this.isMobile && !this.isFighter) {
        const b = this.model.box;
        this.halfLen = Math.max(this.radius * 0.8, (b.max.y - b.min.y) * 0.5 * this.scale * 0.9);
        this.halfWid = Math.max(8, Math.min(this.halfLen, (b.max.x - b.min.x) * 0.5 * this.scale * 0.9));
      }
    } else {
      this.visualRadius = this.radius;
    }
    const box = t.num('Select_Box_Scale', 0);
    this.ringSize = box * 10 > this.visualRadius ? box : this.visualRadius * 2.2;
    this.ringZ = t.num('Select_Box_Z_Adjust', 0);
    this.engineMeshes = [];
    this.parts = [];
    this.proxies = [];
    this.pendingProxies = [];
    this.hasEngineFx = false;
    this.shieldMesh = null;
    this.shieldFlash = 0;
    this.shieldGlow = 0;
    this.shieldAt = { x: 0, y: 0, z: 0 };
    if (this.model) {
      for (const [name, mesh] of this.model.meshByName) {
        if (/BLAST/.test(name)) mesh.visible = false;
        else if (/^ENGINE/.test(name) && mesh.userData.hiddenByDefault) this.engineMeshes.push(mesh);
        else if (name === 'SHIELD') {
          if (!mesh.children.some(m => m.material && m.material.userData.shield)) {
            mesh.visible = false;
            continue;
          }
          this.shieldMesh = mesh;
          for (const m of mesh.children) {
            m.onBeforeRender = () => {
              const u = m.material.uniforms;
              if (!u.flash) return;
              u.flash.value = this.shieldGlow;
              u.hitPos.value.set(this.shieldAt.x, this.shieldAt.y, this.shieldAt.z);
              u.hitRadius.value = Math.max(40, this.visualRadius * 0.6);
              m.material.uniformsNeedUpdate = true;
            };
            m.renderOrder = 4;
          }
        }
      }
    }
    this.obj.scale.setScalar(this.scale);
    this.obj.matrixAutoUpdate = false;
    this.obj.updateMatrix();
    this.obj.userData.ship = true;
    this.selectScale = t.num('Select_Box_Scale', this.visualRadius * 2);

    for (const name of t.list('HardPoints')) {
      const def = db.hardpoint(name);
      if (!def) continue;
      const hp = new Hardpoint(this, def);
      this.attachHardpoint(hp);
      this.hardpoints.push(hp);
    }
    const destroyable = this.hardpoints.filter(h => h.destroyable);
    this.hpDriven = destroyable.length > 0;
    if (this.hpDriven) {
      this.maxHealth = destroyable.reduce((a, h) => a + h.maxHealth, 0);
      this.health = this.maxHealth;
    }
    if (db.type(t.list('Projectile_Types')[0]) && !this.hardpoints.some(h => h.isWeapon)) {
      const muzzles = [],
        inaccuracy = new Map(t.tuples('Fire_Inaccuracy_Distance').map(([c, v]) => [c.toUpperCase(), parseFloat(v)]));
      if (this.model) {
        for (const [name, bone] of this.model.boneByName) {
          if (/^MUZZLE[A-Z]?_\d+$/.test(name) || /^FP_/.test(name)) muzzles.push(this.localOf(bone));
        }
      }
      this.weapons = t.list('Projectile_Types').map(n => {
        const proj = db.type(n);
        return proj
          ? {
              proj,
              pulses: Math.max(1, fireNum(t, proj, 'Projectile_Fire_Pulse_Count', 1)),
              pulseDelay: fireNum(t, proj, 'Projectile_Fire_Pulse_Delay_Seconds', 0.1),
              recharge: fireNum(t, proj, 'Projectile_Fire_Recharge_Seconds', 2),
              cooldown: rand(0, 1.5),
              pulsesLeft: 0,
              pulseTimer: 0,
              range: Math.min(this.attackRange, proj.num('Projectile_Max_Flight_Distance', 600)),
              damageType: t.str('Damage_Type') || proj.str('Damage_Type'),
              inaccuracy,
              muzzles,
              muzzleIndex: 0,
              fixed: -1
            }
          : null;
      });
      this.weapons.forEach((g, i) => {
        if (g) g.fixed = fixedMuzzle(i, this.weapons.length, muzzles.length);
      });
      this.weaponIndex = Math.min(startingWeapon(t, this.world.campaign, this.world.marketOf(this)), this.weapons.length - 1);
      this.weapon = this.weapons[this.weaponIndex] || this.weapons[0];
    }
    this.maxRange = Math.max(
      this.attackRange,
      ...this.hardpoints.filter(h => h.isWeapon).map(h => h.range),
      this.weapon ? this.weapon.range : 0
    );
    this.engageRange = this.type.num('Targeting_Max_Attack_Distance', 0) || this.maxRange;
    this.hasWeapons = !!this.weapon || this.hardpoints.some(h => h.isWeapon);

    if (this.model) {
      const damageBones = new Map();
      for (const hp of this.hardpoints) {
        const b = this.model.bone(hp.def.str('Damage_Particles'));
        if (b) damageBones.set(b, hp);
      }
      for (const px of this.model.proxies) {
        if (px.hidden && /^pi/i.test(px.name)) {
          this.proxies.push({
            name: px.name,
            bone: px.bone,
            local: this.localOf(px.bone),
            damage: false,
            hp: null,
            on: false,
            sys: null,
            byBone: false,
            ion: true
          });
          continue;
        }
        if (px.hidden) continue;
        let hp = null;
        for (let b = px.bone; b && !hp; b = b.parent) hp = damageBones.get(b) || null;
        const damage = !!hp || /damage|smoke|fire|elec|_ALT\d/i.test(px.name) || /_ALT\d/i.test(px.bone.name);
        let byBone = false;
        for (let b = px.bone; b && b !== this.model.root && !byBone; b = b.parent) byBone = !b.visible;
        const proxy = { name: px.name, bone: px.bone, local: this.localOf(px.bone), damage, hp, on: false, sys: null, byBone };
        this.proxies.push(proxy);
        if (!damage) this.pendingProxies.push(proxy);
        if (/engine/i.test(px.name)) this.hasEngineFx = true;
      }
      if (this.hasEngineFx) {
        this.engineMeshes.length = 0;
        this.engineGlows.length = 0;
      }
    }

    const inc = t.sub('Abilities').flatMap(a => a.all('Income_Stream_Ability'))[0];
    if (inc)
      this.income = {
        value: inc.num('Base_Income_Value', 0),
        interval: inc.num('Base_Interval_In_Secs', 10),
        timer: 0,
        source: t,
        skirmish: /^skirmish_automatic$/i.test(inc.val('Activation_Style').trim())
      };
    const heal = t.sub('Abilities').flatMap(a => a.all('Force_Healing_Ability'))[0];
    if (heal && this.isStructure) {
      this.heal = {
        range: heal.num('Heal_Range', 0),
        percent: heal.num('Heal_Percent', 0),
        amount: heal.num('Heal_Amount', 0),
        interval: Math.max(0.1, heal.num('Heal_Interval_In_Secs', 1)),
        single: !/^(no|false)$/i.test(heal.val('Single_Target_Heal', 'Yes')),
        cats: heal
          .val('Applicable_Unit_Categories')
          .split(/[,|\s]+/)
          .filter(Boolean)
          .map(c => c.toUpperCase()),
        sfx: heal.val('SFXEvent_Target_Affected'),
        timer: 1
      };
    }
    if (this.player && this.player.id >= 0) {
      this.buildList = buildListFor(t, this.player.factionName);
      for (const e of spawnList(t, this.player.techLevel))
        this.garrison.push({ type: e.type, want: e.start, remaining: e.remaining, live: [] });
      this.spawnDelay = t.num('Spawned_Squadron_Delay_Seconds', 5);
      this.spawnTimer = (this.id % 16) / 16;
    }
    if (t.behaviors().has('CAPTURE_POINT')) {
      this.capture = {
        radius: t.num('Capture_Point_Radius', 500),
        time: t.num('Capture_Point_Transition_Time_Seconds', 10),
        progress: 0,
        by: null
      };
    }
    attachAbilities(this, parseAbilities(t));
    this.applyBonuses();
    this.setupAnimation();
    if (this.model) {
      const flat = flattenModel(this.model);
      if (flat) {
        this.obj.remove(this.model.root);
        this.obj.add(flat);
      }
      for (const part of this.parts) this.obj.add(part);
    }
    if (!this.isFighter && this.visualRadius >= 60 && this.model) {
      const min = this.model.radius * 0.3;
      this.obj.traverse(o => {
        if (!o.isMesh || !o.material || o.material.transparent || !o.material.uniforms || !o.material.uniforms.shadowMap) return;
        for (let q = o; q && q !== this.obj; q = q.parent) if (!q.visible) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        if (o.geometry.boundingSphere.radius >= min) (this.casters ||= []).push(o);
      });
    }
    this.syncObj();
    w.scene.add(this.obj);
  }

  setupAnimation() {
    const t = this.type,
      model = this.model;
    this.turrets = [];
    this.anim = null;
    if (!model) return;
    const speed = d => (d.num('Turret_Rotate_Speed', 3) || 3) * LOGIC_FPS * DEG;
    const turret = (inst, def, hp) => {
      const bone = inst.bone(def.str('Turret_Bone_Name'));
      if (!bone) return;
      const barrel = inst.bone(def.str('Barrel_Bone_Name'));
      const tilt = barrel && barrel !== bone ? barrel : bone;
      inst.root.updateMatrixWorld(true);
      const toBone = inst.root
        .getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(tilt.getWorldQuaternion(new THREE.Quaternion()))
        .invert();
      const fwd = new THREE.Vector3(0, -1, 0).applyQuaternion(toBone),
        up = new THREE.Vector3(0, 0, 1).applyQuaternion(toBone);
      const axis = fwd.cross(up).normalize();
      const half = d => (Math.min(180, d) * DEG) / 2;
      this.turrets.push({
        inst,
        bone,
        rest: bone.quaternion.clone(),
        yaw: 0,
        hp,
        speed: speed(def),
        tilt,
        tiltRest: tilt.quaternion.clone(),
        axis,
        pitch: 0,
        yawLimit: half(def.num('Turret_Rotate_Extent_Degrees', 360)),
        pitchLimit: half(def.num('Turret_Elevate_Extent_Degrees', 60))
      });
    };
    if (t.str('Turret_Bone_Name')) turret(model, t, null);
    for (const hp of this.hardpoints) {
      const name = hp.def.str('Turret_Bone_Name');
      if (name) turret(hp.model && hp.model.bone(name) ? hp.model : model, hp.def, hp);
    }
    this.modelFile = t.str('Space_Model_Name');
    this.buildAnim = null;
    if (this.underConstruction) {
      const a = getALA(animName(this.modelFile || '', 'BUILD'));
      if (a) {
        this.buildAnim = new AnimState(model, a, {});
        return;
      }
    }
    if (this.isFighter) this.playAnim('DEPLOY');
    else this.playAnim('IDLE', { loop: true, random: true });
  }

  playAnim(kind, { loop = false, random = false } = {}) {
    const a = this.model && getALA(animName(this.modelFile || '', kind));
    if (!a) return false;
    this.anim = new AnimState(this.model, a, { loop, time: random ? Math.random() * a.duration : 0 });
    return true;
  }

  abilityState(kind) {
    return this.abilities.find(s => s.def.kind === kind) || null;
  }
  isActive(kind) {
    const s = this.abilityState(kind);
    return !!s && s.active;
  }

  modelMatrix(node, out) {
    const root = this.model.root;
    root.updateWorldMatrix(true, true);
    return out.copy(root.matrixWorld).invert().multiply(node.matrixWorld);
  }

  localOf(bone) {
    const e = this.modelMatrix(bone, _m1).elements;
    return { x: -e[13] * this.scale, y: e[12] * this.scale, z: e[14] * this.scale, ax: -e[1], ay: e[0] };
  }

  proxyPoints(proxy) {
    if (proxy.points !== undefined) return proxy.points;
    proxy.points = null;
    let mesh = null,
      group = null;
    for (const b of [proxy.bone, proxy.bone.parent]) {
      if (!b) continue;
      for (const g of this.model.meshByName.values()) {
        if ((g.userData.bone || g.parent) === b && g.children.some(m => m.isMesh)) {
          group = g;
          mesh = g.children.find(m => m.isMesh);
          break;
        }
      }
      if (mesh) break;
    }
    if (!mesh) return null;
    const pos = mesh.geometry.attributes.position;
    const mw = (group.userData.bone ? group.matrix : this.modelMatrix(mesh, _m1)).elements,
      pw = this.modelMatrix(proxy.bone, _m2).elements;
    const seen = new Set(),
      pts = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i);
      const wx = mw[0] * x + mw[4] * y + mw[8] * z + mw[12] - pw[12],
        wy = mw[1] * x + mw[5] * y + mw[9] * z + mw[13] - pw[13],
        wz = mw[2] * x + mw[6] * y + mw[10] * z + mw[14] - pw[14];
      const key = Math.round(wx) + ',' + Math.round(wy) + ',' + Math.round(wz);
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push([wx * this.scale, wy * this.scale, wz * this.scale]);
    }
    const step = Math.max(1, Math.ceil(pts.length / 40));
    proxy.points = pts.filter((_, i) => i % step === 0);
    return proxy.points;
  }

  attachHardpoint(hp) {
    const def = hp.def,
      model = this.model;
    if (!model) return;
    const bone = model.bone(def.str('Attachment_Bone')) || model.bone(def.str('Collision_Mesh'));
    const fireA = model.bone(def.str('Fire_Bone_A')),
      fireB = model.bone(def.str('Fire_Bone_B'));
    const anchor = bone || fireA;
    if (anchor) hp.local = this.localOf(anchor);
    for (const fb of [fireA, fireB]) if (fb) hp.fireLocal.push(this.localOf(fb));
    if (!hp.fireLocal.length) hp.fireLocal.push(hp.local);
    const f = hp.fireLocal[0];
    if (fireA && Math.abs(f.ax) + Math.abs(f.ay) > 0.01) hp.facing = Math.atan2(f.ay, f.ax);
    else hp.facing = Math.atan2(hp.local.y, hp.local.x);
    hp.bone = bone;
    const attach = getModelData(def.str('Model_To_Attach'));
    if (attach && bone) {
      hp.model = buildModel(attach, { teamColor: this.player && this.player.id >= 0 ? this.player.color : null, ...this.world.modelOpts });
      const own = fireA ? [] : [def.str('Fire_Bone_A'), def.str('Fire_Bone_B')].map(n => n && hp.model.bone(n)).filter(Boolean);
      if (own.length) {
        const at = this.modelMatrix(bone, _m2),
          root = hp.model.root;
        root.updateMatrixWorld(true);
        const inv = _m3.copy(root.matrixWorld).invert();
        hp.fireLocal = own.map(b => {
          const e = _m1.copy(at).multiply(inv).multiply(b.matrixWorld).elements;
          return { x: -e[13] * this.scale, y: e[12] * this.scale, z: e[14] * this.scale, ax: -e[1], ay: e[0] };
        });
        const f0 = hp.fireLocal[0];
        if (Math.abs(f0.ax) + Math.abs(f0.ay) > 0.01) hp.facing = Math.atan2(f0.ay, f0.ax);
      }
      let part = flattenModel(hp.model);
      if (!part) {
        part = new THREE.Group();
        part.matrixAutoUpdate = false;
        part.add(hp.model.root);
      }
      part.matrix.copy(this.modelMatrix(bone, _m1));
      hp.part = part;
      this.parts.push(part);
    }
    hp.decal = model.mesh(def.str('Damage_Decal'));
    if (hp.decal) hp.decal.visible = false;
    const eng = model.bone(def.str('Engine_Particles'));
    if (eng && !this.engineGlows.length && !model.proxies.some(p => /engine/i.test(p.name) && !p.hidden))
      this.engineGlows.push({ local: this.localOf(eng), size: 1.4, hp });
  }

  applyBonuses() {
    const p = this.player;
    const b = { damage: 1, defense: 1, speed: 1, health: 1, shield: 1 };
    if (p && p.id >= 0) {
      const cats = this.type.categories(),
        name = this.type.name.toUpperCase();
      const base = this.type.parent ? this.type.parent.name.toUpperCase() : '';
      for (const bn of p.bonuses) {
        if (!(bn.types.has(name) || bn.types.has(base) || [...bn.cats].some(c => cats.has(c)))) continue;
        b.damage += bn.damage;
        b.defense += bn.defense;
        b.speed += bn.speed;
        b.health += bn.health;
        b.shield += bn.shield;
      }
    }
    const adj = p && p.adjust,
      hm = adj ? adj.health : 1,
      was = this.bonus.hm || 1;
    b.hm = hm;
    if (hm !== was) {
      const k = hm / was;
      this.maxHealth *= k;
      this.health *= k;
      for (const h of this.hardpoints) {
        h.maxHealth *= k;
        h.health *= k;
      }
    }
    const oldMax = this.maxShield;
    this.maxShield = this.type.num('Shield_Points', 0) * b.shield * (adj ? adj.shield : 1);
    if (this.maxShield > oldMax) this.shield += this.maxShield - oldMax;
    else if (this.shield > this.maxShield) this.shield = this.maxShield;
    this.bonus = b;
  }

  get alive() {
    return !this.dead;
  }
  get healthFrac() {
    return this.maxHealth > 0 ? clamp(this.health / this.maxHealth, 0, 1) : 0;
  }
  get name() {
    return db.t(this.type.str('Text_ID')) || this.type.name;
  }

  syncObj() {
    const o = this.obj;
    o.position.set(this.x, this.y, this.z);
    _qz.setFromAxisAngle(_Z, this.heading + Math.PI / 2);
    if (this.pitch) {
      _qr.setFromAxisAngle(_X, -this.pitch);
      _qz.multiply(_qr);
    }
    if (this.roll) {
      _qr.setFromAxisAngle(_Y, this.roll);
      _qz.multiply(_qr);
    }
    o.quaternion.copy(_qz);
    o.updateMatrix();
  }

  engineAlive() {
    for (const h of this.hardpoints) if (!h.alive && h.kind === 'HARD_POINT_ENGINE') return false;
    return true;
  }
  shieldGenerators() {
    let n = 0,
      up = 0;
    for (const h of this.hardpoints)
      if (h.kind === 'HARD_POINT_SHIELD_GENERATOR') {
        n++;
        if (h.alive || !h.destroyable) up++;
      }
    return n ? up / n : 1;
  }

  setOrder(order, keepQueue = false) {
    this.order = order;
    if (!keepQueue) this.queue = null;
    if (order.kind !== 'attack') this.targetHp = null;
  }
}

const _Z = new THREE.Vector3(0, 0, 1),
  _Y = new THREE.Vector3(0, 1, 0),
  _X = new THREE.Vector3(1, 0, 0);
const _qz = new THREE.Quaternion(),
  _qr = new THREE.Quaternion();
const NO_EULER = () => {};
const _m1 = new THREE.Matrix4(),
  _m2 = new THREE.Matrix4(),
  _m3 = new THREE.Matrix4();
const _fl = { x: 0, y: 0, z: 0 };
const _p = { x: 0, y: 0, z: 0 },
  _p2 = { x: 0, y: 0, z: 0 },
  _p3 = { x: 0, y: 0, z: 0 },
  _p4 = { x: 0, y: 0, z: 0 },
  _p5 = { x: 0, y: 0, z: 0 },
  _ms0 = { x: 0, y: 0, z: 0 },
  _ms1 = { x: 0, y: 0, z: 0 };
const segNear = (x0, y0, z0, x1, y1, z1, cx, cy, cz, r) => {
  const dx = x1 - x0,
    dy = y1 - y0,
    dz = z1 - z0,
    l = dx * dx + dy * dy + dz * dz;
  let k = l > 0 ? ((cx - x0) * dx + (cy - y0) * dy + (cz - z0) * dz) / l : 0;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  const ex = x0 + dx * k - cx,
    ey = y0 + dy * k - cy,
    ez = z0 + dz * k - cz;
  return ex * ex + ey * ey + ez * ez <= r * r;
};
const velocityOf = (u, out) => {
  const s = u.speed || 0,
    p = u.pitch || 0,
    f = Math.cos(p) * s,
    h = u.heading || 0;
  out.x = Math.cos(h) * f;
  out.y = Math.sin(h) * f;
  out.z = u.isFighter ? Math.sin(p) * s : 0;
  return out;
};

export class Squad {
  constructor(world, type, player, x, y, heading) {
    this.world = world;
    this.id = nextId++;
    this.type = type;
    this.player = player;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.fighters = [];
    this.order = { kind: 'idle' };
    this.target = null;
    this.selected = false;
    this.dead = false;
    this.carrier = null;
    this.scanTimer = simRandom();
    this.pop = spacePop(type);
    this.isBomber = type.bool('Is_Bomber', false);
    this.replenish = undefined;
    this.travel = undefined;
    this.about = undefined;
    this.mode = undefined;
    this.tolerance = undefined;
    this.loose = undefined;
    this.goal = undefined;
    this.aim = undefined;
    this.aimHp = undefined;
    this.approach = undefined;
    this.runIn = undefined;
    this.cell = undefined;
    this.hyper = undefined;
    this.px = undefined;
    this.py = undefined;
    this.cx = undefined;
    this.cy = undefined;
    this.tx = undefined;
    this.ty = undefined;
    this.ix = undefined;
    this.iy = undefined;
    this.queue = undefined;
    this.homeOf = undefined;
    this.home = undefined;
    this.guardFollow = undefined;
    this.guardAt = undefined;
    this.guardOf = undefined;
    this.huntTimer = undefined;
    this.pendingAbility = undefined;
    this._iconName = undefined;
    this._iconX = undefined;
    this._iconY = undefined;
    this._iconSize = undefined;
    this._iconFrame = undefined;
    this.scripted = undefined;
    this.noAI = undefined;
    this.spotted = undefined;
    this.aiPower = undefined;
    this.aiPlan = undefined;
    this.goalTarget = undefined;
    this.ckinds = undefined;
    this.fsKind = undefined;
    this.isTypes = undefined;
    this._lists = undefined;
    this.idleFrom = undefined;
    const members = type.has('Squadron_Units') ? type.list('Squadron_Units') : [type.name];
    const offsets = type.tuples('Squadron_Offsets').map(t => t.map(parseFloat));
    this.stacked = offsets.some(o => o[2]);
    this.launch = (name, i, px, py, h) => {
      const ft = db.type(name);
      if (!ft) return null;
      const off = offsets[i] || [-(i * 30), (i % 2 ? 30 : -30) * i, 0];
      const c = Math.cos(h),
        s = Math.sin(h);
      const u = new Unit(world, ft, player, px + c * off[0] - s * off[1], py + s * off[0] + c * off[1], h);
      u.squad = this;
      u.slot = { x: off[0], y: off[1], z: off[2] || 0 };
      if (this.stacked) u.z += 35 + u.slot.z;
      u.member = i;
      u.speed = u.maxSpeed * 0.8;
      u.fstate = {
        mode: 'form',
        timer: 0,
        breakHeading: 0,
        target: null,
        snap: null,
        loop: undefined,
        avoid: undefined,
        taken: undefined,
        partner: undefined,
        until: undefined
      };
      this.fighters.push(u);
      world.units.push(u);
      return u;
    };
    this.members = members;
    members.forEach((name, i) => this.launch(name, i, x, y, heading));
    for (const f of this.fighters) {
      const ab = f.type
        .sub('Unit_Abilities_Data')
        .flatMap(a => a.all('Unit_Ability'))
        .find(a => a.val('Type').trim().toUpperCase() === 'REPLENISH_WINGMEN');
      if (ab) {
        this.replenish = {
          leader: f,
          every: ab.num('Recharge_Seconds', 60) || 60,
          timer: ab.num('Recharge_Seconds', 60) || 60,
          sfx: ab.val('SFXEvent_GUI_Unit_Ability_Activated').trim()
        };
        break;
      }
    }
    this.size = members.length || 1;
    const f0 = this.fighters[0];
    if (f0) {
      const defs = f0.abilities.map(s => s.def);
      const says = d => d.mods.size + d.node.children.length + (d.spec ? 1 : 0);
      const team = db.type(type.str('Create_Team_Type'));
      for (const d of [...parseAbilities(type), ...(team ? parseAbilities(team) : [])]) {
        const i = defs.findIndex(x => x.kind === d.kind);
        if (i < 0) defs.push(d);
        else if (says(d) > says(defs[i])) defs[i] = d;
      }
      for (const f of this.fighters) attachAbilities(f, defs);
    }
    this.speed = f0 ? Math.min(...this.fighters.map(f => f.maxSpeed)) : 100;
    this.sizeClass = f0 ? f0.sizeClass : 'FIGHTER';
    this.selectable = true;
    this.isSquad = true;
  }
  get alive() {
    return !this.dead;
  }
  get name() {
    return db.t(this.type.str('Text_ID')) || this.type.name;
  }
  get healthFrac() {
    let h = 0,
      m = 0;
    for (const f of this.fighters) {
      h += f.health;
      m += f.maxHealth;
    }
    const total = this.size;
    return m ? (h / m) * (this.fighters.length / total) : 0;
  }
  get radius() {
    return 60;
  }
  get visualRadius() {
    return 70;
  }
  setOrder(order, keepQueue = false) {
    this.order = order;
    if (!keepQueue) this.queue = null;
    this.target = order.kind === 'attack' ? order.target || null : null;
  }
  get abilities() {
    return this.fighters[0] ? this.fighters[0].abilities : [];
  }
  abilityState(kind) {
    return this.abilities.find(s => s.def.kind === kind) || null;
  }
  isActive(kind) {
    const s = this.abilityState(kind);
    return !!s && s.active;
  }
}

export class World {
  constructor({ scene, fx, audio, map }) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.map = map;
    this.time = 0;
    this.units = [];
    this.squads = [];
    this.projectiles = [];
    this.obstacles = [];
    this.specialWeapons = [];
    this.tacticalSuperweapons = null;
    this.bounty = new BountyBook();
    this.players = [];
    this.teams = [];
    this.neutral = new Player(-1, new Team(-1, 'Neutral'));
    this.min = { x: map.playMin[0], y: map.playMin[1] };
    this.max = { x: map.playMax[0], y: map.playMax[1] };
    this.paths = new Pathfinder(this);
    this.winner = null;
    this.fog = true;
    this.reveal = false;
    this.fogTimer = 0;
    this.solid = [];
    this.beams = [];
    this.reveals = [];
    this.fogLifted = 0;
    this.jammers = [];
    this.interdictors = [];
    this.timers = [];
    this.fields = [];
    this.onEvent = () => {};
  }

  addTeam(t) {
    this.teams.push(t);
    return t;
  }
  addPlayer(p) {
    this.players.push(p);
    return p;
  }

  spawn(type, player, x, y, heading = 0, opts = {}) {
    if (isCompanyType(type)) {
      let last = null;
      for (const ut of companySpaceUnits(type)) last = this.spawn(ut, player, x, y, heading, opts);
      return last;
    }
    let e;
    if (isSquadronType(type) || type.behaviors().has('FIGHTER_LOCOMOTOR')) {
      e = new Squad(this, type, player, x, y, heading);
      this.squads.push(e);
    } else {
      e = new Unit(this, type, player, x, y, heading);
      this.units.push(e);
    }
    this.tacticalSuperweapons?.add(e);
    if (opts.hyperspace && !this.tacticalSuperweapons?.record(e)) this.startHyperspace(e);
    this.recountPop();
    return e;
  }

  startHyperspace(e) {
    for (const u of e.isSquad ? e.fighters : [e]) {
      u.hyper = { f: 0, tx: u.x, ty: u.y, h: u.heading, shown: false };
      u.x -= Math.cos(u.heading) * HYPER.far;
      u.y -= Math.sin(u.heading) * HYPER.far;
      u.syncObj();
      u.obj.scale.setScalar(1e-4);
      u.obj.updateMatrix();
    }
    if (e.isSquad) e.hyper = HYPER.frames / LOGIC_FPS;
  }

  removeUnit(u) {
    u.dead = true;
    this.scene.remove(u.obj);
  }

  recountPop() {
    for (const p of this.players) {
      p.pop = 0;
      p.popCap = p.faction ? p.faction.num('Space_Tactical_Unit_Cap', 0) : 0;
      p.popExtra = 0;
    }
    for (const u of this.units) {
      if (u.dead || !u.player || u.player.id < 0) continue;
      if (!u.squad) u.player.pop += u.pop;
      const cap = u.type.num('Additional_Population_Capacity', 0);
      if (cap) for (const p of u.isStation ? u.player.team.players : [u.player]) p.popExtra += cap;
    }
    for (const p of this.players) if (!(p.popCap > 0)) p.popCap = p.popExtra;
    for (const p of this.players) if (p.popCapFixed > 0) p.popCap = p.popCapFixed;
    if (!this.campaign) for (const p of this.players) for (const t of p.reinforcements) p.pop += spacePop(t);
    for (const s of this.squads) if (!s.dead && !s.carrier) s.player.pop += s.pop;
  }

  *selectables() {
    for (const s of this.squads) if (!s.dead) yield s;
    for (const u of this.units) if (!u.dead && !u.squad && u.selectable && !(u.isPad && u.padChild)) yield u;
  }

  selectablesInto(out) {
    out.length = 0;
    for (const s of this.squads) if (!s.dead) out.push(s);
    for (const u of this.units) if (!u.dead && !u.squad && u.selectable && !(u.isPad && u.padChild)) out.push(u);
    return out;
  }

  ownedCount(player, typeName) {
    const n = typeName.toUpperCase();
    let c = 0;
    for (const u of this.units)
      if (
        !u.dead &&
        !u.squad &&
        (u.player === player || (u.isStation && u.player.team === player.team)) &&
        (u.type.upperName ||= u.type.name.toUpperCase()) === n
      )
        c++;
    for (const s of this.squads) if (!s.dead && s.player === player && (s.type.upperName ||= s.type.name.toUpperCase()) === n) c++;
    return c;
  }

  holdQueues(u) {
    (this.queueHolders ||= new Set()).add(u);
  }
  *withQueues() {
    const set = this.queueHolders;
    if (!set) return;
    for (const u of set) {
      if (u.dead) {
        set.delete(u);
        continue;
      }
      if (u.buildQueues.size) yield u;
    }
  }

  queuedCount(player, type, teamWide = false) {
    let c = 0;
    for (const u of this.withQueues()) {
      if (u.player.team !== player.team) continue;
      for (const q of u.buildQueues.values()) for (const it of q) if (it.type === type && (teamWide || it.player === player)) c++;
    }
    return c;
  }

  queuesOf(builder, player) {
    const out = [];
    for (const [k, q] of builder.buildQueues) if (k.startsWith(player.id + ':')) out.push([k, q]);
    return out;
  }

  buildOptions(builder, player) {
    if (!builder.isPad)
      return builder.player === player ||
        ((builder.isStation || builder.type.bool('Is_Community_Property')) && builder.player.team === player.team)
        ? builder.buildList
        : [];
    if (builder.padOwner !== player || builder.padChild) return [];
    builder._lists ||= new Map();
    let l = builder._lists.get(player);
    if (!l) builder._lists.set(player, (l = buildListFor(builder.type, player.factionName)));
    return l;
  }

  marketOf(u) {
    return this.market?.[u.player?.factionName];
  }

  pursuit(u) {
    const rs = this.retreatState;
    return rs && u.player !== rs.player && u.player.id >= 0 && !rs.list.has(u) && !rs.list.has(u.squad) ? rs.pursue(u.player) : 1;
  }

  cantBuild(builder, type, player = null) {
    const p = player || (builder.isPad ? builder.padOwner : builder.player);
    if (!p) return 'Not under your control';
    if (!this.buildOptions(builder, p).includes(type)) return 'Not available';
    const nameU = type.name.toUpperCase();
    if (isUpgradeType(type)) {
      if (p.upgrades.has(nameU)) return 'Already researched';
      if (this.queuedCount(p, type, true)) return this.queuedCount(p, type) ? 'In progress' : 'Already being researched by an ally';
    }
    for (const req of type.list('Tactical_Build_Prerequisites')) {
      const rt = db.type(req);
      const met = rt && isUpgradeType(rt) ? p.upgrades.has(req.toUpperCase()) : this.ownedCount(p, req) > 0;
      if (!met) return 'Requires ' + db.t(rt?.str('Text_ID') || req);
    }
    const L = k => type.num(k, 0);
    const standing = q =>
      this.ownedCount(q, type.name) +
      this.queuedCount(q, type) +
      this.companyCount(q, type) +
      q.reinforcements.filter(t => t === type).length;
    const team = (p.team && p.team.players) || [p],
      ever = q => (q.everBought && q.everBought.get(type)) || 0;
    if (L('Build_Limit_Current_Per_Player') > 0 && standing(p) >= L('Build_Limit_Current_Per_Player')) return 'Limit reached';
    if (L('Build_Limit_Current_For_All_Allies') > 0 && team.reduce((n, q) => n + standing(q), 0) >= L('Build_Limit_Current_For_All_Allies'))
      return 'Limit reached';
    if (L('Build_Limit_Lifetime_Per_Player') > 0 && ever(p) >= L('Build_Limit_Lifetime_Per_Player')) return 'Limit reached';
    if (L('Build_Limit_Lifetime_For_All_Allies') > 0 && team.reduce((n, q) => n + ever(q), 0) >= L('Build_Limit_Lifetime_For_All_Allies'))
      return 'Limit reached';
    if (!isUpgradeType(type)) {
      const pop = spacePop(type);
      if (pop > 0 && p.pop + pop + this.queuedPop(p) > p.popCap) return 'Population cap reached';
    }
    if (p.lockedTech && p.lockedTech.has(type)) return 'Not available';
    if (p.human && !builder.isPad && builder.buildQueues) {
      const q = builder.buildQueues.get(p.id + ':' + type.str('Tactical_Production_Queue', 'Tactical_Units'));
      if (q && q.length >= db.constants.num('Max_Build_Queue', 5)) return 'Build queue full';
    }
    if (p.credits < buildCost(type)) return 'Not enough credits';
    return null;
  }

  companyCount(p, type) {
    if (!isCompanyType(type)) return 0;
    let c = 0;
    for (const t of companySpaceUnits(type)) c += this.ownedCount(p, t.name);
    return c;
  }

  queuedPop(p) {
    let c = 0;
    for (const u of this.withQueues()) {
      if (u.player.team !== p.team) continue;
      for (const q of u.buildQueues.values()) for (const it of q) if (it.player === p && !isUpgradeType(it.type)) c += spacePop(it.type);
    }
    return c;
  }

  startBuild(builder, type, player = null) {
    const why = this.cantBuild(builder, type, player);
    if (why) return why;
    const p = player || (builder.isPad ? builder.padOwner : builder.player);
    p.credits -= buildCost(type);
    (p.everBought ||= new Map()).set(type, (p.everBought.get(type) || 0) + 1);
    if (builder.isPad) {
      this.raiseOnPad(builder, type, p);
      return null;
    }
    const qn = p.id + ':' + type.str('Tactical_Production_Queue', 'Tactical_Units');
    let q = builder.buildQueues.get(qn);
    if (!q) builder.buildQueues.set(qn, (q = []));
    this.holdQueues(builder);
    const secs = buildTime(type) * (p.adjust ? p.adjust.build.space : 1);
    q.push({ type, total: secs, left: secs, player: p });
    if (this.bring) this.bring(type);
    this.audio.playFor(p, type.str('SFXEvent_Build_Started'));
    return null;
  }

  raiseOnPad(builder, type, p) {
    const uc = this.spawn(type, p, builder.x, builder.y, builder.heading);
    uc.padOf = builder;
    builder.padChild = uc;
    const secs = buildTime(type) * (p.adjust ? p.adjust.build.space : 1);
    uc.construction = { left: secs, total: secs, result: db.type(type.str('Tactical_Buildable_Constructed')) };
    builder.obj.visible = !builder.type.bool('Hides_When_Built_On', true);
    this.audio.playFor(p, type.str('SFXEvent_Build_Started'));
    this.audio.playAt(p, p.faction.str('SFXEvent_Tactical_Object_Building_Started'), builder.x, builder.y);
    return uc;
  }

  scriptBuild(pad, type, check) {
    const p = pad && pad.isPad ? pad.padOwner : null;
    if (!p || pad.dead || pad.padChild || !type) return false;
    if (check && (!this.buildOptions(pad, p).includes(type) || this.cantBuild(pad, type, p))) return false;
    (p.everBought ||= new Map()).set(type, (p.everBought.get(type) || 0) + 1);
    this.raiseOnPad(pad, type, p);
    return true;
  }

  cancelBuild(builder, queueName, index) {
    const q = builder.buildQueues.get(queueName);
    if (!q || !q[index]) return;
    const [it] = q.splice(index, 1);
    it.player.credits += buildCost(it.type);
    if (it.player.everBought && it.player.everBought.get(it.type) > 0)
      it.player.everBought.set(it.type, it.player.everBought.get(it.type) - 1);
    this.audio.playFor(it.player, it.type.str('SFXEvent_Build_Cancelled'));
  }

  completeBuild(builder, type, player = null) {
    const p = player || builder.player;
    p.stats.built++;
    if (isUpgradeType(type)) {
      this.applyUpgrade(p, type, builder);
      this.onEvent('upgrade', { player: p, type });
      return;
    }
    if (p.human) {
      p.reinforcements.push(type);
      this.recountPop();
      if (!this.audio.playFor(p, type.str('SFXEvent_Build_Complete')))
        this.audio.playFor(p, p.faction.str('Reinforcements_Ready_SFXEvent'));
      this.onEvent('reinforcementReady', { player: p, type });
      return;
    }
    if (this.goals && this.scripts && !this.scripts.plansOff) {
      (p.aiPool ||= []).push({ type, owner: null });
      p.reinforcements.push(type);
      this.recountPop();
      this.audio.playFor(p, type.str('SFXEvent_Build_Complete'));
      this.onEvent('reinforcementReady', { player: p, type });
      return;
    }
    this.arrive(p, type, builder);
  }

  arrive(p, type, builder = p.station) {
    const sp = p.spawnPoints.length
      ? p.spawnPoints[p.stats.built % p.spawnPoints.length]
      : { x: (builder ? builder.x : 0) + 400, y: builder ? builder.y : 0, heading: builder ? builder.heading : 0 };
    const jitter = () => rand(-160, 160);
    const e = this.spawn(type, p, sp.x + jitter(), sp.y + jitter(), sp.heading, { hyperspace: true });
    this.audio.playFor(p, type.str('SFXEvent_Build_Complete'));
    this.onEvent('built', { player: p, type, entity: e });
    return e;
  }

  reinforceStep(p, pool, at, st) {
    if (this.reinforcementsOff?.has(String(p.factionName || '').toUpperCase())) return null;
    const entry = pool[pool.length - 1],
      type = entry && entry.type;
    if (!type) return null;
    const sp = p.spawnPoints[0],
      th = sp ? sp.heading : 0;
    for (let i = 0; i < 10; i++) {
      const a = th + i * 0.6283185;
      const x = Math.min(this.max.x, Math.max(this.min.x, at.x - Math.cos(a) * st.r));
      const y = Math.min(this.max.y, Math.max(this.min.y, at.y - Math.sin(a) * st.r));
      if (!this.cantReinforce(p, x, y)) {
        pool.pop();
        const k = p.reinforcements.indexOf(type),
          j = p.aiPool ? p.aiPool.indexOf(entry) : -1;
        if (k >= 0) p.reinforcements.splice(k, 1);
        if (j >= 0) p.aiPool.splice(j, 1);
        const e = this.spawn(type, p, x, y, Math.atan2(at.y - y, at.x - x) || th, { hyperspace: true });
        this.audio.playFor(p, p.faction.str('Reinforcements_Enroute_SFXEvent'));
        this.onEvent('built', { player: p, type, entity: e });
        st.r = this.insidePrevention(p, at) ? 1000 : 0;
        return e;
      }
      if (st.r === 0) break;
    }
    st.r += 500;
    return null;
  }

  insidePrevention(p, at) {
    for (const u of this.units) {
      if (u.dead || u.player.team === p.team || u.player.id < 0) continue;
      const r = u.type.num('Reinforcement_Prevention_Radius', 0);
      if (r > 0 && (u.x - at.x) ** 2 + (u.y - at.y) ** 2 < r * r) return true;
    }
    return false;
  }

  cantReinforce(player, x, y) {
    if (x < this.min.x || x > this.max.x || y < this.min.y || y > this.max.y) return 'Outside the battle area';
    let seen = !this.fog;
    for (const u of this.units) {
      if (u.dead || u.hyper) continue;
      const d2 = (u.x - x) ** 2 + (u.y - y) ** 2;
      if (u.player.team === player.team) {
        if (!seen && d2 <= u.revealRange * u.revealRange) seen = true;
      } else if (u.player.id >= 0) {
        const r = u.type.num('Reinforcement_Prevention_Radius', 0);
        if (r > 0 && d2 < r * r)
          return u.type.bool('Is_Interdictor') ? 'An enemy gravity well blocks hyperspace here' : 'Too close to an enemy structure';
      }
      if (u.isStructure && !u.isFighter && !flownThrough(u) && d2 < (u.radius * 0.9) ** 2) return 'Blocked';
    }
    for (const r of this.reveals) if (r.team === player.team && (r.x - x) ** 2 + (r.y - y) ** 2 < r.r * r.r) seen = true;
    return seen ? null : 'No line of sight to that area';
  }

  deployReinforcement(player, type, x, y, heading) {
    const i = player.reinforcements.indexOf(type);
    if (i < 0) return 'Not available';
    const why = this.cantReinforce(player, x, y);
    if (why) return why;
    player.reinforcements.splice(i, 1);
    const e = this.spawn(type, player, x, y, heading, { hyperspace: true });
    this.audio.playFor(player, player.faction.str('Reinforcements_Enroute_SFXEvent'));
    this.onEvent('built', { player, type, entity: e });
    return null;
  }

  buildersOf(p) {
    const out = [];
    for (const u of this.units)
      if (
        !u.dead &&
        !u.isPad &&
        !u.construction &&
        u.buildList &&
        u.buildList.length &&
        (u.player === p || u === p.station || (u.player.team === p.team && u.type.bool('Is_Community_Property')))
      )
        out.push(u);
    return out;
  }

  applyUpgrade(p, type, at = null) {
    const raisesStation = type.sub('Abilities').some(ab => ab.children.some(a => a.tag.toLowerCase() === 'starbase_upgrade_ability'));
    if (!raisesStation) p.upgrades.add(type.name.toUpperCase());
    for (const ab of type.sub('Abilities')) {
      for (const a of ab.children) {
        const kind = a.tag.toLowerCase();
        if (kind === 'starbase_upgrade_ability') this.upgradeStation(p, at);
        else if (kind === 'combat_bonus_ability') {
          const split = s =>
            new Set(
              s
                .split(/[\s,|]+/)
                .filter(Boolean)
                .map(x => x.toUpperCase())
            );
          p.bonuses.push({
            types: split(a.val('Applicable_Unit_Types')),
            cats: split(a.val('Applicable_Unit_Categories')),
            damage: a.num('Damage_Bonus_Percentage'),
            defense: a.num('Defense_Bonus_Percentage'),
            speed: a.num('Movement_Speed_Bonus_Percentage'),
            health: a.num('Health_Bonus_Percentage'),
            shield: a.num('Shield_Bonus_Percentage')
          });
          for (const u of this.units) if (!u.dead && u.player.team === p.team) u.applyBonuses();
        } else if (kind === 'income_stream_mod_ability') {
          p.incomeMods.push({
            mult: a.num('Income_Multiplier', 1),
            add: a.num('Income_Additive_Value', 0),
            stack: a.val('Stacking_Category').trim(),
            source: a.val('Target_Stream_Source').toUpperCase()
          });
        } else if (kind === 'bounty_on_faction_ability') {
          this.bounty.add(
            p,
            a,
            type.name.toUpperCase(),
            this.players.filter(q => q.id >= 0 && q.team === p.team)
          );
        }
      }
    }
  }

  upgradeStation(p, at = null) {
    const old = at && at.isStation ? at : p.station;
    if (!old || old.dead) return;
    const main = old === p.station;
    const next = db.type(old.type.str('Next_Level_Base'));
    if (!next) return;
    const frac = old.healthFrac;
    const queues = old.buildQueues;
    const sel = old.selected;
    const pad = old.padOf,
      padOwner = pad && pad.padOwner,
      padShown = pad && pad.obj.visible;
    this.removeUnit(old);
    const st = this.spawn(next, old.player, old.x, old.y, old.heading);
    if (pad) {
      st.padOf = pad;
      pad.padChild = st;
      pad.padOwner = padOwner;
      pad.obj.visible = padShown;
    }
    st.buildQueues = queues;
    this.holdQueues(st);
    st.selected = sel;
    const carried = old.garrison.flatMap(g => g.live.filter(sq => !sq.dead));
    for (const sq of carried) sq.carrier = st;
    for (const g of st.garrison) {
      g.live = carried.filter(sq => sq.type === g.type);
      g.spawned = Math.min(g.want, g.live.length);
    }
    const kept = new Set(st.garrison.flatMap(g => g.live));
    for (const sq of carried)
      if (!kept.has(sq)) {
        if (st.garrison[0]) st.garrison[0].live.push(sq);
      }
    for (const h of st.hardpoints) h.health = h.maxHealth * Math.max(frac, 0.5);
    st.health = st.maxHealth * Math.max(frac, 0.5);
    if (main) p.station = st;
    this.fx.flash(st.x, st.y, st.z, st.visualRadius * 2.5, 0x99ccff);
    this.onEvent('stationUpgraded', { player: p, station: st, old });
    this.recountPop();
  }

  damage(
    target,
    amount,
    {
      damageType,
      hp = null,
      attacker = null,
      shields = true,
      hull = true,
      x,
      y,
      z,
      fx = null,
      quiet = false,
      from = null,
      proj = null
    } = {}
  ) {
    if (target.dead || target.hyper || target.invulnerable) return;
    const retreating = this.retreatState?.list.has(target);
    if (retreating) {
      if (this.retreatState.phase === 'flight') return;
      amount *= this.retreatState.damaged(target.player);
    }
    amount *= target.mods.damageTaken;
    {
      const by = attacker && (attacker.player || attacker);
      if (by && by.adjust && by !== target.player) amount *= by.adjust.damage;
    }
    if (amount <= 0) return;
    target.lossRate = this.damageRate(target) + amount / 2;
    target.lossAt = this.time;
    if (from && !from.dead) {
      const m = (target.hurtBy ||= new Map()),
        r = m.get(from);
      if (r) {
        r.v = r.v * Math.exp(-(this.time - r.at) / 6) + amount;
        r.at = this.time;
      } else {
        if (m.size > 12) m.clear();
        m.set(from, { v: amount, at: this.time });
      }
    }
    if (quiet) x = undefined;
    target.lastHitTime = this.time;
    target.radarHit = 3;
    if (attacker) {
      this.lastCombat = this.time;
      const v = this.viewer;
      const from = attacker.player || attacker;
      if (v && (target.player?.team === v.team || from.team === v.team)) this.lastViewerCombat = this.time;
    }
    target.lastAttacker = attacker;
    const alerts = (this.lastBaseAlert ||= new Map()),
      team = target.player.team;
    if (target.isStation && team.players.some(p => p.human) && this.time - (alerts.get(team) ?? -99) > 30) {
      alerts.set(team, this.time);
      const v = this.viewer,
        hearer = v && v.team === team ? v : team.players.find(p => p.human);
      this.audio.playFor(hearer, target.player.faction.str('SFXEvent_Space_Base_Under_Attack_Announcement'));
      this.onEvent('baseAttacked', { unit: target });
    }
    if (shields && target.maxShield > 0 && target.shieldDownTimer > 0) {
      const inc = db.constants.num('Depleted_Shield_Damage_Increment', 0);
      if (inc > 0) target.shieldDownTimer = Math.min(db.constants.num('Depleted_Shield_Disable_Time', 5), target.shieldDownTimer + inc);
    }
    if (shields && target.shield > 0 && target.maxShield > 0) {
      const k = db.damageMod(damageType, target.shieldArmor),
        d = amount * k,
        took = Math.min(d, target.shield);
      target.shield -= took;
      if (target.shield <= 0) {
        target.shield = 0;
        target.shieldDownTimer = db.constants.num('Depleted_Shield_Disable_Time', 5);
      }
      target.shieldFlash = SHIELD_FLASH + SHIELD_FADE;
      if (x !== undefined) {
        target.shieldAt.x = x;
        target.shieldAt.y = y;
        target.shieldAt.z = z ?? target.z;
      } else {
        target.shieldAt.x = target.x;
        target.shieldAt.y = target.y;
        target.shieldAt.z = target.z;
      }
      if (!(k > 0) || d <= took) {
        this.fx.shieldHit(x, y, z, target, fx && fx.shield);
        return;
      }
      amount = (d - took) / k;
    }
    if (proj && target.energy && target.energy.value > 0 && proj.bool('Projectile_Does_Energy_Damage')) {
      const k = db.damageMod(damageType, target.shieldArmor) || 1,
        d = amount * k,
        drained = Math.min(target.energy.value, d);
      target.energy.value -= drained;
      if (drained > 0 && proj.bool('Projectile_Disables_Engines_When_Power_Drained')) {
        const secs = proj.num('Projectile_Disable_Engines_Duration', 0);
        if (secs > 0) addStatus(this, target, { kind: 'ENGINES_OFF', source: null, dur: secs, speed: 0 });
      }
      if (d <= drained) return;
      amount = (d - drained) / k;
    }
    if (!hull) return;
    const before = target.healthFrac;
    if (target.player.human && !target.isStation && this.time - (target.lastAlarm ?? -99) > 30) {
      const alarm = target.type.str('SFXEvent_Unit_Under_Attack');
      if (alarm && this.time - (this.lastAlarm ?? -99) > 8) {
        target.lastAlarm = this.lastAlarm = this.time;
        this.audio.playFor(target.player, alarm);
      }
    }
    let d = (amount * db.damageMod(damageType, target.armor)) / target.bonus.defense;
    this.fx.hit(x, y, z, Math.min(40, 6 + d * 0.5), fx && fx.hit);
    if (target.hpDriven) {
      if (!hp || !hp.alive || !hp.destroyable) hp = this.pickHardpoint(target, x, y);
      if (!hp) {
        this.kill(target, attacker);
        return;
      }
      hp.health -= d;
      if (hp.health <= 0) this.destroyHardpoint(target, hp, attacker);
      let sum = 0;
      for (const h of target.hardpoints) if (h.destroyable && h.alive) sum += h.health;
      target.health = sum;
      if (sum <= 0) this.kill(target, attacker);
      else {
        this.damageProxies(target);
        this.healthVoice(target, before, attacker);
      }
    } else {
      target.health -= d;
      if (target.health <= 0) this.kill(target, attacker);
      else {
        this.damageProxies(target);
        this.healthVoice(target, before, attacker);
      }
    }
  }

  damageProxies(u) {
    const loose = u.proxies.filter(p => p.damage && !p.hp);
    if (!loose.length) return;
    const want = Math.floor((1 - u.healthFrac) * (loose.length + 1));
    for (let i = 0; i < want && i < loose.length; i++)
      if (!loose[i].on) {
        loose[i].on = true;
        u.pendingProxies.push(loose[i]);
      }
  }

  pickHardpoint(target, x, y, by = null) {
    const set = by ? setOf(by) : null,
      order = set && set.hardPoints && set.hardPoints.length ? set.hardPoints : null;
    let best = null,
      bd = Infinity,
      bk = Infinity;
    for (const h of target.hardpoints) {
      if (!h.alive || !h.destroyable) continue;
      const kind = h.kind.replace(/^HARD_POINT_/, '');
      if (set && set.noHardPoints && set.noHardPoints.has(kind)) continue;
      const i = order ? order.indexOf(kind) : -1,
        k = order ? (i < 0 ? 1e18 : i + 1) : 0;
      h.worldPos(_p);
      const d = x === undefined ? 0 : (_p.x - x) ** 2 + (_p.y - y) ** 2;
      if (k < bk || (k === bk && d < bd)) {
        bk = k;
        bd = d;
        best = h;
      }
    }
    return best;
  }

  destroyHardpoint(unit, hp, attacker) {
    hp.alive = false;
    hp.health = 0;
    hp.worldPos(_p);
    this.fx.explosion(_p.x, _p.y, _p.z, 45, false, particleFile(hp.def.str('Death_Explosion_Particles')));
    this.audio.play(hp.def.str('Death_Explosion_SFXEvent'), _p.x, _p.y);
    for (const px of unit.proxies)
      if (px.hp === hp && !px.on) {
        px.on = true;
        unit.pendingProxies.push(px);
      }
    if (hp.part) hp.part.visible = false;
    if (hp.decal) hp.decal.visible = true;
    if (hp.kind === 'HARD_POINT_SHIELD_GENERATOR' && unit.shieldGenerators() === 0) {
      unit.shield = 0;
      if (!(unit.shieldDownTimer > 0)) unit.shieldDownTimer = db.constants.num('Depleted_Shield_Disable_Time', 5);
    }
    hp.smoke = !unit.proxies.some(px => px.hp === hp);
    if (unit.player && unit.player.human) {
      const ev = unit.type.tuples('SFXEvent_Hardpoint_Destroyed').find(t => t[0].toUpperCase() === hp.kind);
      if (ev && ev[1]) this.audio.playFor(unit.player, ev[1]);
    }
    if (unit.isStation) {
      const level = stationLevel(unit),
        was = unit.stationLevel ?? unit.type.num('Base_Level', 0);
      if (level !== was) {
        unit.stationLevel = level;
        this.onEvent('stationLevelLost', { unit, level });
      }
    }
  }

  collectBounty(entity, at, killer) {
    const b = this.bounty;
    if (!b.enabled || !killer || killer.id < 0 || entity.isPad || entity.underConstruction) return;
    const owner = entity.player;
    if (owner && owner.team === killer.team) return;
    const value = bountyValue(entity.type, !!this.skirmish);
    for (const [p, n] of b.payouts(
      this.players.filter(q => q.id >= 0),
      killer,
      owner ? owner.factionName : '',
      value,
      (x, y) => x.team === y.team
    )) {
      const got = n * (p.adjust ? p.adjust.credit : 1);
      p.credits += got;
      p.bounty += n;
      if (p.human) this.fx.floatText(at.x, at.y, at.z + at.height, '+' + n);
    }
  }

  kill(u, attacker) {
    if (u.dead) return;
    if (u.cannotDie) {
      u.health = Math.max(1, u.health);
      return;
    }
    this.removeUnit(u);
    const big = u.visualRadius;
    this.fx.explosion(u.x, u.y, u.z, clamp(big * 1.1, 14, 600), big > 120, particleFile(u.type.list('Death_Explosions')[0]));
    this.fx.deathClone(u);
    this.audio.play(
      u.type.str('Death_SFXEvent_Start_Die') || (big > 120 ? 'Unit_Star_Destroyer_Death_SFX' : 'Unit_Fighter_Death_SFX'),
      u.x,
      u.y
    );
    if (u.player && u.player.id >= 0 && !u.underConstruction) {
      u.player.stats.lost++;
      if (u.player.human && !u.isFighter && this.time - (this.lastLossVoice ?? -99) > 8) {
        this.lastLossVoice = this.time;
        this.audio.playFor(
          u.player,
          u.type.str('SFXEvent_Unit_Lost') ||
            u.player.factionName[0].toUpperCase() + 'HD_' + (u.isStructure ? 'Structure_Destroyed' : 'Unit_Destroyed')
        );
      }
    }
    if (attacker && attacker.id >= 0) attacker.stats.killed++;
    this.onEvent('killed', { unit: u, killer: attacker || null });
    if (u.squad) {
      const s = u.squad;
      s.fighters = s.fighters.filter(f => f !== u);
      this.collectBounty(u, u, attacker);
      if (!s.fighters.length) {
        s.dead = true;
        this.onEvent('died', { entity: s });
        this.collectBounty(s, u, attacker);
      }
    } else {
      this.onEvent('died', { entity: u });
      this.collectBounty(u, u, attacker);
    }
    if (u.padOf) {
      const pad = u.padOf;
      pad.padChild = null;
      pad.obj.visible = true;
      pad.padOwner = null;
      if (pad.capture) pad.capture.progress = 0;
    }
    if (u.isStation && u.player.team.station === u && !this.campaign) this.checkVictory(u.player.team);
    this.recountPop();
  }

  checkVictory(loser) {
    loser.defeated = true;
    const alive = this.teams.filter(t => !t.defeated && !t.mapSide);
    if (alive.length === 1) {
      this.winner = alive[0];
      this.onEvent('gameover', { winner: alive[0] });
    }
  }

  update(dt) {
    this.updateBegin(dt);
    this.updateSome(Infinity);
    this.updateEnd();
  }

  updateBegin(dt) {
    this.stepDt = dt;
    this.stepAt = 0;
    this.time += dt;
    this.launches = 0;
    const units = this.units;
    this.jammers.length = 0;
    this.interdictors.length = 0;
    this.obstacles = units.filter(
      o => !o.dead && !o.isFighter && !o.isPad && !o.hyper && (o.isMobile || o.isStructure) && !flownThrough(o)
    );
    const grid = this.obstacleGrid || (this.obstacleGrid = new Map());
    for (const l of grid.values()) l.length = 0;
    for (const o of this.obstacles) {
      const r = Math.max(o.radius || 0, o.hitRadius || 0) + PROBE_PAD;
      if (r <= PROBE_PAD) continue;
      const x0 = Math.floor((o.x - r) / PROBE_CELL),
        x1 = Math.floor((o.x + r) / PROBE_CELL),
        y0 = Math.floor((o.y - r) / PROBE_CELL),
        y1 = Math.floor((o.y + r) / PROBE_CELL);
      for (let ix = x0; ix <= x1; ix++)
        for (let iy = y0; iy <= y1; iy++) {
          const k = ix * 65536 + iy;
          let l = grid.get(k);
          if (!l) grid.set(k, (l = []));
          l.push(o);
        }
    }
    const ug = this.unitGrid || (this.unitGrid = new Map());
    for (const l of ug.values()) l.length = 0;
    for (let i = 0; i < units.length; i++) {
      const o = units[i];
      o.gridAt = i;
      if (o.dead) continue;
      const k = Math.floor(o.x / UNIT_CELL) * 65536 + Math.floor(o.y / UNIT_CELL);
      let l = ug.get(k);
      if (!l) ug.set(k, (l = []));
      l.push(o);
    }
    this.unitGridN = units.length;
    if (this.timers.length) {
      const due = this.timers.filter(t => t.at <= this.time);
      if (due.length) {
        this.timers = this.timers.filter(t => t.at > this.time);
        for (const t of due) t.fn();
      }
    }
    if (this.beams.length) this.beams = this.beams.filter(b => b.until > this.time && !b.a.dead);
    if (this.reveals.length)
      this.reveals = this.reveals.filter(r => r.until > this.time && !(r.by && (r.by.state === 'over' || r.by.env !== r.env)));
    const solid = this.solid;
    solid.length = 0;
    for (const u of units) if (!u.dead && !u.isFighter && !u.hyper && !(u.isPad && !u.isStation) && !flownThrough(u)) solid.push(u);
    this.paths.sync();
    if ((this.autoTimer = (this.autoTimer ?? 0.5) - dt) <= 0) {
      this.autoTimer = 0.5;
      for (const u of units) if (u.pendingAbility && !u.dead) this.checkPending(u);
      for (const sq of this.squads) if (sq.pendingAbility && !sq.dead) this.checkPending(sq);
      for (const u of units) {
        if (u.dead || !u.player.human || u.hyper || !u.abilities.length || !u.abilities.some(a => a.auto)) continue;
        if (!u.squad) aiUseAbilities(this, u, true);
        else if (u.squad.fighters[0] === u) aiUseAbilities(this, u.squad, true);
      }
    }
  }

  updateSome(upTo) {
    const units = this.units,
      dt = this.stepDt;
    let i = this.stepAt;
    for (; i < units.length && i < upTo; i++) {
      const u = units[i];
      if (u.dead) continue;
      if (u.hyper) {
        this.updateHyper(u, dt);
        continue;
      }
      if (u.retreatFlight) continue;
      this.updateUnit(u, dt);
    }
    this.stepAt = i;
    return i >= units.length;
  }

  updateEnd() {
    const units = this.units,
      dt = this.stepDt;
    for (const s of this.squads) if (!s.dead) this.updateSquad(s, dt);
    for (const sw of this.specialWeapons) sw.update();
    this.tacticalSuperweapons?.update();
    if (this.skirmish && (this.bonusTimer = (this.bonusTimer ?? 0.5) - dt) <= 0) {
      this.bonusTimer += 0.5;
      this.losingTeamBonus(0.5);
    }
    this.updateProjectiles(dt);
    if ((this.fogTimer -= dt) <= 0) {
      this.fogTimer = 0.25;
      this.updateVisibility();
    }
    if ((this.overrunFrame = (this.overrunFrame || 0) + 1) % 15 === 0) this.checkOverrun();
    if (units.length > 64 && (this._gc = (this._gc || 0) + dt) > 3) {
      this._gc = 0;
      for (const u of units)
        if (u.dead) {
          u.enemies.length = 0;
          u.hurtBy = undefined;
        }
      this.units = units.filter(u => !u.dead);
      this.squads = this.squads.filter(s => !s.dead);
      this.unitGridN = Infinity;
    }
    this.paths.flush();
  }

  checkOverrun() {
    const sides = this.overrunSides,
      C = db.constants,
      multiple = parseFloat(C.str('Tactical_Overrun_Multiple')) || 0;
    if (
      !this.campaign ||
      !this.fog ||
      !sides ||
      !(multiple > 0) ||
      this.overrunFrame < LOGIC_FPS * C.num('Minimum_Tactical_Overrun_Time_In_Secs', 30)
    )
      return;
    const power = team => {
      let n = 0;
      for (const u of this.units) if (!u.dead && u.player.team === team) n += Math.max(0, u.type.num('AI_Combat_Power', 0));
      return n;
    };
    const [a, b] = sides.map(power),
      strong = a >= b ? sides[0] : sides[1];
    if (Math.max(a, b) > Math.min(a, b) * multiple && !(this.fogLifted & strong.bit)) {
      this.fogLifted |= strong.bit;
      this.updateVisibility();
      this.onEvent('overrun', { team: strong });
    }
  }

  updateHyper(u, dt) {
    const h = u.hyper;
    if (this.holdHyperspace) return;
    h.f += dt * LOGIC_FPS;
    if (h.f >= HYPER.frames) {
      u.x = h.tx;
      u.y = h.ty;
      u.obj.scale.setScalar(u.scale);
      u.syncObj();
      u.hyper = null;
      return;
    }
    const i = Math.floor(h.f),
      gone = HYPER.gone[i] + (HYPER.gone[i + 1] - HYPER.gone[i]) * (h.f - i),
      left = HYPER.far - gone;
    u.x = h.tx - Math.cos(h.h) * left;
    u.y = h.ty - Math.sin(h.h) * left;
    u.syncObj();
    if (!h.shown && h.f >= HYPER.show) {
      h.shown = true;
      u.obj.scale.setScalar(u.scale);
      u.obj.updateMatrix();
      if (!u.isFighter || u.squad.fighters[0] === u)
        this.audio.playAt(
          u.player,
          u.player.faction
            ? u.player.faction.str('SFXEvent_Arrive_From_Hyperspace') || 'Unit_Ship_Hyperspace_Enter'
            : 'Unit_Ship_Hyperspace_Enter',
          u.x,
          u.y
        );
    }
    h.dark = h.shown ? 1 - (h.f - HYPER.show) / (HYPER.frames - HYPER.show) : 1;
  }

  updateUnit(u, dt) {
    if (u.abilities.length || u.statuses.length) {
      tickAbilities(this, u, dt);
      if (u.dead) return;
    }
    if (u.energy) {
      const en = u.energy,
        every = (this.energyInterval ??= Math.max(0.05, db.constants.num('EnergyRechargeIntervalInSecs', 5)));
      if ((en.tick += dt) >= every) {
        en.tick -= every;
        en.value = Math.min(en.cap, en.value + en.refill);
      }
    }
    if (u.maxShield > 0) {
      if (u.shieldDownTimer > 0) u.shieldDownTimer -= dt;
      const base = (this.shieldInterval ??= Math.max(0.05, db.constants.num('ShieldRechargeIntervalInSecs', 3)));
      const every = Math.max(0.05, base * u.mods.shieldInterval);
      if ((u.shieldTick += dt) >= every && u.ionUntil > this.time) u.shieldTick -= every;
      else if (u.shieldTick >= every) {
        u.shieldTick -= every;
        let next = Math.max(0, Math.min(u.maxShield, u.shield + u.shieldRate * base * u.mods.shieldRegen * u.shieldGenerators()));
        if (u.shieldDownTimer > 0) next = Math.min(next, (this.depletedCap ??= db.constants.num('Depleted_Shield_Regen_Cap', 0.25)));
        const gain = next - u.shield;
        if (gain > 0 && u.energy) {
          const cost = gain * (this.energyRate ??= db.constants.num('EnergyToShieldExchangeRate', 5));
          if (cost > u.energy.value) next = u.shield;
          else u.energy.value -= cost;
        }
        u.shield = next;
      }
    }
    if (u.construction) {
      u.construction.left -= dt;
      if (u.construction.left <= 0) this.finishConstruction(u);
      return;
    }
    if (u.buildQueues.size) {
      for (const q of u.buildQueues.values()) {
        if (!q.length) continue;
        q[0].left -= dt;
        if (q[0].left <= 0) {
          if (this.artReady && !this.artReady(q[0].type)) q[0].left = 0;
          else {
            const it = q.shift();
            this.completeBuild(u, it.type, it.player);
          }
        }
      }
    }
    if (u.heal && u.player.id >= 0 && !u.construction) this.updateHeal(u, dt);
    if (u.income && u.player.id >= 0 && !(u.income.skirmish && this.campaign)) {
      u.income.timer += dt;
      if (u.income.timer >= u.income.interval) {
        u.income.timer -= u.income.interval;
        let v = u.income.value,
          add = 0,
          mult = 1;
        const src = u.type.name.toUpperCase();
        const best = new Map();
        for (const m of u.player.incomeMods) {
          if (m.source && !m.source.includes(src)) continue;
          if (!m.stack) {
            mult *= m.mult;
            add += m.add;
            continue;
          }
          const b = best.get(m.stack);
          if (!b) best.set(m.stack, { mult: m.mult, add: m.add });
          else {
            b.mult = Math.max(b.mult, m.mult);
            b.add = Math.max(b.add, m.add);
          }
        }
        for (const b of best.values()) {
          mult *= b.mult;
          add += b.add;
        }
        v = v * mult + add;
        u.income.rate = v / Math.max(1e-3, u.income.interval);
        for (const pl of u.player.team.players) {
          const g = v * (pl.adjust ? pl.adjust.credit : 1);
          pl.credits += g;
          pl.stats.earned += g;
        }
        if (u.player.team.players.some(pl => pl.human)) this.fx.floatText(u.x, u.y, u.z + u.height, '+' + Math.round(v));
      }
    }
    if (u.capture) this.updateCapture(u, dt);
    if (u.garrison.length && !(u.isStation && this.skirmish)) this.updateGarrison(u, dt);
    if (this.fields.length && u.player.id >= 0 && (u.fieldTimer = (u.fieldTimer ?? (u.id % 8) * 0.03) - dt) <= 0) {
      u.fieldTimer = 0.25;
      this.updateFields(u, 0.25);
      if (u.dead) return;
    }
    if (u.flyBy === undefined) {
      u.flyBy = u.type.str('SFXEvent_Ambient_Moving') || null;
      u.flyTimer = rand(0, u.type.num('SFXEvent_Ambient_Moving_Max_Delay_Seconds', 10));
    }
    if (u.flyBy && u.speed > 1 && (u.flyTimer -= dt) <= 0) {
      u.flyTimer = rand(
        u.type.num('SFXEvent_Ambient_Moving_Min_Delay_Seconds', 5),
        u.type.num('SFXEvent_Ambient_Moving_Max_Delay_Seconds', 10)
      );
      this.audio.playAt(u.player, u.flyBy, u.x, u.y);
    }
    if (u.player.id < 0) {
      if (u.isMobile) u.syncObj();
      return;
    }

    if (u.hasWeapons || u.squad) {
      u.scanTimer -= dt;
      if (u.scanTimer <= 0) {
        u.scanTimer = (u.isFighter ? 1.2 : 0.4) + simRandom() * 0.2;
        this.scan(u);
      }
    }
    if (u.isFighter) {
      if (!u.suspended) this.updateFighter(u, dt);
    } else {
      if (u.isMobile && !u.suspended) this.updateShip(u, dt);
      this.updateWeapons(u, dt);
      if (u.weapon) this.updateTurret(u, dt);
    }
  }

  finishConstruction(u) {
    const { result } = u.construction;
    const pad = u.padOf;
    const sel = u.selected;
    this.removeUnit(u);
    if (!result) return;
    this.audio.playAt(u.player, u.player.faction.str('SFXEvent_Tactical_Object_Building_Complete'), u.x, u.y);
    const built = this.spawn(result, u.player, u.x, u.y, u.heading);
    built.padOf = pad;
    built.selected = sel;
    if (pad) pad.padChild = built;
    this.audio.playFor(u.player, result.str('SFXEvent_Build_Complete') || 'GUI_Build_Complete');
    this.onEvent('built', { player: u.player, type: result, entity: built, replaced: u });
  }

  updateCapture(pad, dt) {
    if (pad.padChild) return;
    const c = pad.capture,
      r2 = c.radius * c.radius;
    const owner = pad.isPad ? pad.padOwner || null : pad.player && pad.player.id >= 0 ? pad.player : null;
    if (owner && this.time < db.constants.num('Space_Capture_Allowed_Countdown_Seconds', 30)) return;
    const aff = (pad.capAff ||= pad.type
      .str('Affiliation')
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(x => x.toUpperCase()));
    let side = null,
      mixed = false,
      kept = !pad.isPad;
    const near = this.near(pad, c.radius, _nearCap);
    for (const o of near) {
      if (o === pad || o.dead || o.hyper || o.isPad || o.player.id < 0) continue;
      if (((o.influences ??= o.type.bool('Influences_Capture_Point', true)), !o.influences)) continue;
      const dz = (o.z || 0) - (pad.z || 0);
      if ((o.x - pad.x) ** 2 + (o.y - pad.y) ** 2 + dz * dz > r2) continue;
      if (aff.length && !aff.includes(o.player.factionName.toUpperCase())) continue;
      if (owner) {
        if (o.player.team !== owner.team) {
          mixed = true;
          break;
        }
        kept = true;
        continue;
      }
      if (!side) side = o.player;
      else if (side.team !== o.player.team) {
        mixed = true;
        break;
      }
    }
    const toward = owner ? (mixed || !kept ? null : owner) : mixed ? null : side;
    if (toward === owner) {
      if (c.progress > 0) c.progress = Math.max(0, c.progress - dt);
      if (c.progress <= 0) c.by = owner;
      return;
    }
    if (c.by !== toward) c.by = toward;
    c.progress += dt;
    if (c.progress < c.time) return;
    c.progress = 0;
    const previous = owner;
    if (previous && !toward) this.audio.playFor(previous, previous.faction.str('SFXEvent_HUD_Build_Pad_Lost'));
    if (pad.isPad) pad.padOwner = toward;
    else {
      pad.player = toward || this.neutral;
      pad.buildList = toward ? buildListFor(pad.type, toward.factionName) : [];
      pad.buildQueues.clear();
    }
    c.by = toward;
    if (!toward) {
      this.onEvent('neutralised', { pad, player: previous });
      return;
    }
    pad.padOwner = toward;
    this.onEvent('captured', { pad, player: toward });
    const ev = toward.faction.tuples('SFXEvent_Tactical_Gain_Friendly_Control').find(t => /Build_Pad/i.test(t[0]));
    this.audio.playFor(toward, ev ? ev[1] : toward.faction.str('SFXEvent_HUD_Build_Pad_Captured'));
  }

  ionHit(p, hit, x, y) {
    const d = p.def;
    if (!(d.num('Projectile_Ion_Stun_Radius', 0) > 0)) {
      this.ionStun(hit, d);
      return;
    }
    const r = d.num('Projectile_Stun_Radius', 0),
      owner = p.owner;
    if (!(r > 0) || !d.num('Projectile_Stun_Duration_Frames', 0)) return;
    for (const o of this.units)
      if (!o.dead && owner && o.player.id >= 0 && o.player.team !== owner.team && (o.x - x) ** 2 + (o.y - y) ** 2 <= r * r)
        this.ionStun(o, d);
  }

  ionStun(u, d) {
    if (u.dead || u.hyper || !u.type.behaviors().has('ION_STUN_EFFECT')) return;
    const dur = d.num('Projectile_Ion_Stun_Duration', 0);
    if (!(dur > 0)) return;
    const until = d.bool('Projectile_Ion_Stun_Stack_Duration', false) && u.ionUntil > this.time ? u.ionUntil + dur : this.time + dur;
    const cut = k => 1 - Math.min(0.99, Math.max(0, d.num(k, 0)));
    addStatus(this, u, {
      kind: 'ION',
      source: null,
      dur: until - this.time,
      speed: cut('Projectile_Ion_Stun_Speed_Reduction_Percent'),
      weaponDelay: 1 / cut('Projectile_Ion_Stun_Shot_Rate_Reduction_Percent')
    });
    u.ionUntil = until;
    if (u.abilities.some(s => s.def.kind === 'DEFEND' && s.active)) useAbility(this, u, 'DEFEND', false);
    for (const px of u.proxies)
      if (px.ion && !px.on) {
        px.on = true;
        u.pendingProxies.push(px);
      }
  }

  deploySquad(u) {
    if (!u.garrison.length) return false;
    const before = u.garrison.reduce((n, g) => n + (g.spawned || 0), 0);
    u.spawnTimer = 0;
    this.updateGarrison(u, 0, true);
    return u.garrison.reduce((n, g) => n + (g.spawned || 0), 0) > before;
  }

  updateGarrison(u, dt, byHand = false) {
    if (!byHand && (u.handDeploy ??= u.abilities.some(a => a.def.kind === 'DEPLOY_SQUAD'))) return;
    const gs = u.garrison;
    let full = true;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i],
        live = g.live,
        n = live.length,
        was = n >= g.want;
      let k = 0;
      for (let j = 0; j < n; j++) if (!live[j].dead) live[k++] = live[j];
      if (k < n) {
        live.length = k;
        if (full && was) u.spawnTimer = u.spawnDelay;
      }
      full = full && was && k === n;
    }
    if (u.noGarrison) return;
    let bays = 0,
      baysUp = 0;
    for (const h of u.hardpoints)
      if (h.kind === 'HARD_POINT_FIGHTER_BAY') {
        bays++;
        if (h.alive) baysUp++;
      }
    if (bays && !baysUp) return;
    u.spawnTimer -= dt;
    if (u.spawnTimer > 0) return;
    if (!byHand && this.launches >= LAUNCHES_PER_STEP) return;
    const first = Math.min(gs.length - 1, Math.floor(rand(0, gs.length)));
    for (let i = 0; i < gs.length; i++) {
      const g = gs[(first + i) % gs.length];
      if (g.live.length >= g.want || g.remaining === 0) continue;
      if (g.remaining > 0) g.remaining--;
      g.spawned = (g.spawned || 0) + 1;
      const bay = u.hardpoints.find(h => h.kind === 'HARD_POINT_FIGHTER_BAY');
      const p = bay ? bay.worldPos({}) : { x: u.x, y: u.y };
      const out = u.heading;
      const s = this.spawn(g.type, u.player, p.x + Math.cos(out) * u.radius, p.y + Math.sin(out) * u.radius, out);
      if (s) {
        s.carrier = u;
        this.recountPop();
        g.live.push(s);
        this.launches++;
        if (s.isSquad)
          for (const f of s.fighters) {
            f.z = u.z;
            f.launchZ = 1;
          }
        if (s.isSquad && u.isMobile) s.setOrder({ kind: 'guard', target: u });
      }
      u.spawnTimer = u.spawnDelay;
      return;
    }
  }

  addField(type, x, y, scale = 1) {
    const asteroid = type.bool('Is_Asteroid_Field'),
      nebula = type.bool('Is_Nebula'),
      ion = type.bool('Is_Ion_Storm');
    const r = type.num('Space_Obstacle_Radius', 0) * scale;
    if (!(asteroid || nebula || ion) || r <= 0) return;
    this.fields.push({ x, y, r, asteroid, nebula, ion, radar: !type.has('Is_Visible_On_Radar') || type.bool('Is_Visible_On_Radar') });
  }

  updateFields(u, step) {
    let ast = 0,
      neb = false,
      ion = false;
    for (const f of this.fields) {
      const dx = u.x - f.x,
        dy = u.y - f.y;
      if (dx * dx + dy * dy > f.r * f.r) continue;
      if (f.asteroid) ast++;
      if (f.nebula) neb = true;
      if (f.ion) ion = true;
    }
    const c = db.constants,
      t = u.type;
    const entered = neb && !u.inNebula;
    u.inAsteroids = ast > 0;
    u.inNebula = neb;
    u.inIon = ion;
    if (neb) {
      u.abilityLock = this.time + c.num('Nebula_Ability_Disable_Time', 5);
      if (entered)
        for (const st of u.abilities) if (st.active && !NEBULA_KEEPS.has(st.def.kind)) useAbility(this, u.squad || u, st.def.kind, false);
    }
    if (ion && u.maxShield > 0) {
      u.shield = 0;
      u.shieldDownTimer = Math.max(u.shieldDownTimer || 0, c.num('Ion_Storm_Shield_Disable_Time', 5));
    }
    if (ast && u.asteroidDamage) {
      const p = c.num('Asteroid_Field_Damage_Rate', 0.2);
      let hits = 0;
      for (let k = Math.round(step * 30) * ast; k > 0; k--) if (simRandom() <= p) hits++;
      if (!hits) return;
      const a = rand(0, TAU),
        d = rand(0, u.hitRadius * 0.7);
      const x = u.x + Math.cos(a) * d,
        y = u.y + Math.sin(a) * d;
      const show = this.time >= (u.asteroidFx ?? 0);
      if (show) {
        u.asteroidFx = this.time + rand(0.6, 1.2);
        this.audio.playAt(u.player, t.str('SFXEvent_Damaged_By_Asteroid'), x, y);
      }
      this.damage(u, hits * c.num('Asteroid_Field_Damage', 20), {
        damageType: 'Damage_Asteroid',
        x,
        y,
        z: u.z + u.height * 0.3,
        quiet: !show,
        fx: { hit: particleFile(t.str('Asteroid_Damage_Hit_Particles')) }
      });
    }
  }

  loopEmitters(out) {
    out.length = 0;
    const viewer = this.viewer,
      bit = viewer ? viewer.bit : 0;
    for (const u of this.units) {
      if (u.dead || u.hyper || (bit && !(u.seenBy & bit))) continue;
      const t = u.type;
      let ev;
      if (u.construction) ev = u.player.faction ? u.player.faction.str('SFXEvent_Tactical_Object_Building_Loop') : '';
      else ev = (u.speed > 2 ? t.str('SFXEvent_Engine_Moving_Loop') : t.str('SFXEvent_Engine_Idle_Loop')) || t.str('SFXEvent_Ambient_Loop');
      if (ev) out.push({ id: u.id, event: ev, x: u.x, y: u.y });
    }
    return out;
  }

  healthVoice(target, before, attacker) {
    const after = target.healthFrac;
    const low = db.constants.num('Health_Low_Percent_Threshold', 0.33),
      crit = db.constants.num('Health_Critical_Percent_Threshold', 0.1);
    const level = before > crit && after <= crit ? 'Critical' : before > low && after <= low ? 'Low' : null;
    if (!level || this.time - (this.lastHealthVoice ?? -99) < 5) return;
    let ev = '',
      who = null;
    if (target.player.human) {
      ev = target.type.str(`SFXEvent_Health_${level}_Warning`);
      who = target.player;
    } else if (attacker && attacker.human) {
      for (const u of this.units) {
        if (u.dead || u.player !== attacker || (u.target !== target && !(u.squad && u.squad.target === (target.squad || target)))) continue;
        ev = u.type.str(`SFXEvent_Enemy_Damaged_Health_${level}_Warning`);
        if (ev) break;
      }
      who = attacker;
    }
    if (ev && this.audio.playFor(who, ev)) this.lastHealthVoice = this.time;
  }

  losingTeamBonus(span) {
    const k = db.constants.num('Multiplayer_Losing_Team_Bonus_Credit_Percentage', 0);
    if (!(k > 0)) return;
    const teams = this.teams.filter(t => t.players.some(p => p.id >= 0));
    const used = new Set(this.players.filter(p => p.id >= 0).map(p => (p.factionName || '').toUpperCase()));
    const idle = (this.idleFactions ??= [...db.factions.values()].filter(
      f => /^(yes|true)$/i.test(f.str('Is_Playable')) && !used.has(f.name.toUpperCase())
    ).length);
    if (!((teams.length === 2 && idle === 1) || (teams.length === 3 && idle === 0))) return;
    const rate = new Map();
    for (const u of this.units)
      if (u.income && !u.dead && !u.construction && u.player.id >= 0)
        rate.set(u.player, (rate.get(u.player) || 0) + (u.income.rate ?? u.income.value / Math.max(1e-3, u.income.interval)));
    const tot = t => t.players.reduce((a, p) => a + (rate.get(p) || 0), 0);
    const totals = teams.map(t => [t, tot(t)]);
    const top = Math.max(...totals.map(x => x[1]), 0);
    if (!(top > 0)) return;
    const richest = totals.find(x => x[1] === top)[0];
    for (const [t, earn] of totals) {
      if (t === richest || !t.station || t.station.dead) continue;
      const bonus = (top - earn) * k * span,
        ps = t.players.filter(p => p.id >= 0 && !p.defeated);
      for (const p of ps) {
        const v = bonus * (ps.length === 1 ? 1 : earn > 0 ? 1 - (rate.get(p) || 0) / earn : 1 / ps.length);
        const g = v * (p.adjust ? p.adjust.credit : 1);
        p.credits += g;
        p.stats.earned += g;
      }
    }
  }

  updateVisibility() {
    const units = this.units;
    const all = this.teams.reduce((m, t) => m | t.bit, 0);
    if (!this.fog) {
      for (const u of units) if (!u.dead) u.seenBy = all;
      return;
    }
    const C = VIS_CELL,
      grid = this.visGrid || (this.visGrid = new Map());
    for (const l of grid.values()) l.length = 0;
    let maxHit = 0,
      gx0 = Infinity,
      gx1 = -Infinity,
      gy0 = Infinity,
      gy1 = -Infinity;
    for (const u of units) {
      if (u.dead) continue;
      if (u.player.id < 0) {
        u.seenBy = all;
        continue;
      }
      let mask = u.player.bit | (u.cloaked ? 0 : this.fogLifted);
      for (const rv of this.reveals) if (!u.cloaked && (u.x - rv.x) ** 2 + (u.y - rv.y) ** 2 < rv.r * rv.r) mask |= rv.team.bit;
      if (u.spotted && !u.cloaked) {
        const C = this.fowCell,
          cx = Math.floor(u.x / C),
          cy = Math.floor(u.y / C);
        for (const s of u.spotted) if (s.until > this.time && (cx - s.cx) ** 2 + (cy - s.cy) ** 2 <= s.n * s.n) mask |= s.team.bit;
      }
      u.visMask = mask;
      if (u.hitRadius > maxHit) maxHit = u.hitRadius;
      const cx = Math.floor(u.x / C),
        cy = Math.floor(u.y / C),
        k = cx * 65536 + cy;
      if (cx < gx0) gx0 = cx;
      if (cx > gx1) gx1 = cx;
      if (cy < gy0) gy0 = cy;
      if (cy > gy1) gy1 = cy;
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(u);
    }
    for (const o of units) {
      if (o.dead || o.player.id < 0) continue;
      const bit = o.player.bit,
        reach = Math.max(o.revealRange + maxHit, 160);
      if (!(reach >= 0)) continue;
      const x0 = Math.max(gx0, Math.floor((o.x - reach) / C)),
        x1 = Math.min(gx1, Math.floor((o.x + reach) / C)),
        y0 = Math.max(gy0, Math.floor((o.y - reach) / C)),
        y1 = Math.min(gy1, Math.floor((o.y + reach) / C));
      for (let ix = x0; ix <= x1; ix++)
        for (let iy = y0; iy <= y1; iy++) {
          const l = grid.get(ix * 65536 + iy);
          if (l)
            for (const u of l) {
              if (u.visMask & bit) continue;
              const r = u.cloaked ? 160 : o.revealRange + u.hitRadius;
              if (dist2(u, o) <= r * r) u.visMask |= bit;
            }
        }
    }
    const FC = (this.fowCell ||= db.constants.num('DesiredSpaceFOWCellSize', 100)),
      regrow = (this.fowRegrow ??= db.constants.num('SpaceFOWRegrowTime', 6)),
      now = this.time;
    for (const u of units) {
      if (u.dead || u.player.id < 0) continue;
      let mask = u.visMask;
      if (!u.cloaked) {
        const cell = Math.floor(u.x / FC) * 65536 + Math.floor(u.y / FC);
        for (const tm of this.teams) {
          if (tm.bit === u.player.bit || tm === u.player.team) continue;
          const l = (u.lastSeen ||= []);
          let e = null;
          for (const x of l)
            if (x.team === tm) {
              e = x;
              break;
            }
          if (mask & tm.bit) {
            if (e) {
              e.cell = cell;
              e.at = now;
            } else l.push({ team: tm, cell, at: now });
          } else if (e && now - e.at < regrow && e.cell === cell) mask |= tm.bit;
        }
      }
      if (u.isStructure) mask |= u.everSeenBy;
      u.seenBy = mask;
      u.everSeenBy |= mask;
    }
    if (this.reveal && this.viewer) {
      const b = this.viewer.bit;
      for (const u of units) if (!u.dead) u.seenBy |= b;
      for (const s of this.squads) for (const f of s.fighters) f.seenBy |= b;
    }
  }

  tacticalPop(t) {
    return t.has('Space_Override_Population_Value') ? t.num('Space_Override_Population_Value', 0) : undefined;
  }

  canSee(player, e) {
    if (!this.fog || !player || player.id < 0) return true;
    if (e.isSquad) return e.fighters.some(f => f.seenBy & player.bit);
    return (e.seenBy & player.bit) !== 0;
  }

  near(at, range, out) {
    out.length = 0;
    const ug = this.unitGrid;
    if (!ug || this.unitGridN > this.units.length) {
      for (const o of this.units) out.push(o);
      return out;
    }
    const pad = range + UNIT_PAD,
      x0 = Math.floor((at.x - pad) / UNIT_CELL),
      x1 = Math.floor((at.x + pad) / UNIT_CELL),
      y0 = Math.floor((at.y - pad) / UNIT_CELL),
      y1 = Math.floor((at.y + pad) / UNIT_CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++) {
        const l = ug.get(ix * 65536 + iy);
        if (l) for (const o of l) out.push(o);
      }
    if (out.length > 1) out.sort(byGridAt);
    for (let i = this.unitGridN; i < this.units.length; i++) out.push(this.units[i]);
    return out;
  }

  scan(u) {
    const range = u.maxRange + 250;
    const r2 = range * range;
    const list = u.enemies;
    list.length = 0;
    const me = u.player;
    const bit = me.bit;
    const take = o => {
      if (
        !(o.dead || o.player.team === me.team || o.player.id < 0 || !o.targetableUnit || o.hyper || !(o.seenBy & bit)) &&
        dist2(u, o) <= r2
      )
        list.push(o);
    };
    const ug = this.unitGrid;
    if (ug && this.unitGridN <= this.units.length) {
      const pad = range + UNIT_PAD,
        x0 = Math.floor((u.x - pad) / UNIT_CELL),
        x1 = Math.floor((u.x + pad) / UNIT_CELL),
        y0 = Math.floor((u.y - pad) / UNIT_CELL),
        y1 = Math.floor((u.y + pad) / UNIT_CELL);
      for (let ix = x0; ix <= x1; ix++)
        for (let iy = y0; iy <= y1; iy++) {
          const l = ug.get(ix * 65536 + iy);
          if (l) for (const o of l) take(o);
        }
      if (list.length > 1) list.sort((a, b) => a.gridAt - b.gridAt);
      for (let i = this.unitGridN; i < this.units.length; i++) take(this.units[i]);
    } else for (const o of this.units) take(o);
    if (u.squad) return;
    const ord = u.order;
    if (ord.kind === 'attack' && ord.target && this.resolveTarget(ord.target)) {
      u.target = this.resolveTarget(ord.target);
      return;
    }
    const reach = u.type.num('Targeting_Max_Attack_Distance', 0) || u.maxRange,
      set = setOf(u);
    const inReach = o => dist2(u, o) <= (reach + o.hitRadius) ** 2;
    const rate = o => (set ? priorityOf(set, o.type) : 1);
    let cur =
      u.target && !u.target.dead && !u.target.hyper && u.target.targetableUnit && u.target.seenBy & bit && inReach(u.target)
        ? u.target
        : null;
    if (cur) {
      const left = (cur.health + (cur.shield || 0)) / Math.max(1e-6, this.damageRate(cur));
      if (rate(cur) === 1 || left <= u.type.num('Targeting_Stickiness_Time_Threshold', 0)) {
        u.target = cur;
        return;
      }
    }
    if (this.time < (u.pickAt || 0)) {
      u.target = cur;
      return;
    }
    u.pickAt = this.time + 1 + simRandom() * 0.5;
    const low = db.constants.num('Health_Low_Percent_Threshold', 0.33);
    let best = cur,
      br = cur ? rate(cur) : 0;
    for (const o of list) {
      if (o === cur || !inReach(o)) continue;
      const r = rate(o);
      if (r < 0) continue;
      if (!best) {
        best = o;
        br = r;
        continue;
      }
      const lo = o.healthFrac <= low,
        lb = best.healthFrac <= low;
      if (lo !== lb ? lo : r < br || dist2(u, o) < dist2(u, best)) {
        best = o;
        br = r;
      }
    }
    u.target = best;
  }

  damageRate(o) {
    return o.lossRate ? o.lossRate * Math.exp(-(this.time - o.lossAt) / 2) : 0;
  }

  resolveTarget(t) {
    if (!t || t.dead) return null;
    if (t.isSquad) return t.fighters[0] || null;
    return t;
  }

  bestTarget(u, list) {
    const cats = u.type.categories(),
      set = setOf(u);
    let best = null,
      bs = -Infinity;
    for (const o of list) {
      let s = -Math.sqrt(dist2(u, o));
      if (set) {
        const p = priorityOf(set, o.type);
        if (p < 0) continue;
        s -= (p === Infinity ? 20 : p) * 1e5;
      } else if (cats.has('ANTI' + o.sizeClass)) s += 600;
      if (o.isStructure) s -= 150;
      if (o.underConstruction) s -= 200;
      if (s > bs) {
        bs = s;
        best = o;
      }
    }
    return best;
  }

  updateShip(u, dt) {
    if (u.direct) return this.steerShip(u, dt);
    this.updateHunt(u, dt);
    const ord = u.order;
    let goal = null,
      stopAt = 12,
      faceOnly = null;
    if (ord.kind === 'move' || ord.kind === 'attackmove') {
      goal = ord;
      if (ord.kind === 'attackmove' && u.target && dist2(u, u.target) < (u.engageRange * 0.8) ** 2) {
        goal = null;
        faceOnly = u.target;
      }
    } else if (ord.kind === 'attack') {
      const t = this.resolveTarget(ord.target);
      if (!t) {
        u.setOrder({ kind: 'idle' });
      } else {
        const sys =
          u.targetHp && u.targetHp.alive && u.targetHp.unit === t ? u.targetHp.worldPos((u.sysAt ||= { x: 0, y: 0, z: 0 })) : null;
        const want = (ord.reach || Math.max(150, u.engageRange * 0.55)) + (sys ? 0 : t.hitRadius);
        const at = sys || t;
        if (ord.offset && !ord.reach) {
          const L = leadPoint(t, (ord.meetAt ?? this.time) - this.time),
            p = (u.slotAt ||= { x: 0, y: 0 });
          p.x = L.x + ord.offset.x;
          p.y = L.y + ord.offset.y;
          if (ord.startAt > this.time) faceOnly = t;
          else if (dist2(u, p) > 40 * 40) {
            goal = p;
            stopAt = 30;
          } else faceOnly = t;
        } else if (dist2(u, at) > want * want) {
          goal = at;
          stopAt = want;
        } else faceOnly = t;
      }
    } else if (ord.kind === 'guard') {
      const t = ord.target;
      if (t && t.dead) u.setOrder({ kind: 'idle' });
      else {
        const p = this.guardSpot(u, ord);
        const keep = t ? (t.radius || 60) + u.radius + 120 : 30;
        if (dist2(u, p) > keep * keep) {
          goal = p;
          stopAt = keep;
        } else if (u.target) faceOnly = u.target;
      }
    } else if (ord.kind === 'idle' && u.target && u.hasWeapons && !u.isStructure) {
      if (u.homeOf !== ord) {
        u.homeOf = ord;
        u.home = { x: u.x, y: u.y };
      }
      const t = u.target,
        chase = u.type.num('Idle_Chase_Range', 0) + (t.target === u ? u.type.num('Autonomous_Move_Extension_Vs_Attacker', 0) : 0);
      if (chase > 0 && dist2(u, t) > (u.engageRange * 0.8) ** 2 && dist2(u.home, t) < (u.maxRange + chase) ** 2) {
        goal = t;
        stopAt = u.engageRange * 0.7;
      } else faceOnly = t;
    }
    if (ord.kind === 'idle' && u.isMobile && !u.isFighter) {
      if (u.homeOf !== ord) {
        u.homeOf = ord;
        u.home = { x: u.x, y: u.y };
      }
      if (!u.target && !goal && dist2(u, u.home) > 150 * 150) {
        goal = u.home;
        stopAt = 40;
      }
    }

    const engine = u.engineAlive() ? 1 : 0.2;
    const maxSpeed = Math.min(
      u.maxSpeed * u.bonus.speed * u.mods.speed * engine * (ord.pace ?? 1) * this.pursuit(u),
      ord.kind === 'guard' && u.guardFollow ? Math.max(2 * (u.guardFollow.speed || 0), 20) : Infinity
    );
    const turnRate = u.turnRate * (engine < 1 ? 0.5 : 1);
    let wantSpeed = 0,
      turn = 0;
    let via = false,
      legSpeed = Infinity;
    if (goal) {
      const wp = this.paths.next(u, goal, stopAt < 60 && (ord.kind === 'move' || ord.kind === 'attackmove'));
      if (wp) {
        goal = wp;
        via = !!wp.via;
        if (wp.speed !== undefined && wp.speed < u.maxSpeed * 0.99) legSpeed = (maxSpeed * wp.speed) / Math.max(1, u.maxSpeed);
      }
    }
    if (goal) {
      const dx = goal.x - u.x,
        dy = goal.y - u.y;
      const d = Math.hypot(dx, dy);
      if (!via && d <= stopAt) {
        if (ord.kind === 'move' || ord.kind === 'attackmove') this.arrived(u);
      } else {
        const diff = wrapAngle(Math.atan2(dy, dx) - u.heading);
        turn = clamp(diff, -turnRate * dt, turnRate * dt);
        const align = Math.max(0, Math.cos(diff));
        wantSpeed = Math.min(legSpeed, maxSpeed * (Math.abs(diff) > 1.0 ? 0.3 : align));
        if (!via && Math.abs(diff) > 0.6 && d < (2.5 * Math.max(u.speed, maxSpeed * 0.3)) / turnRate) wantSpeed = 0;
        const brake = (u.speed * u.speed) / (2 * u.accel) + stopAt;
        if (!via && d < brake) wantSpeed = Math.min(wantSpeed, maxSpeed * clamp((d - stopAt) / Math.max(1, brake - stopAt), 0.08, 1));
      }
    } else if (faceOnly && u.sizeClass !== 'STRUCTURE') {
      const diff = wrapAngle(Math.atan2(faceOnly.y - u.y, faceOnly.x - u.x) - u.heading);
      if (Math.abs(diff) > 0.5) turn = clamp(diff, -turnRate * dt * 0.6, turnRate * dt * 0.6);
    }
    if (!goal && !faceOnly && ord.kind === 'idle' && ord.face !== undefined)
      turn = clamp(wrapAngle(ord.face - u.heading), -turnRate * dt, turnRate * dt);
    u.heading = wrapAngle(u.heading + turn);
    const a = u.accel * dt;
    u.speed += clamp(wantSpeed - u.speed, -a * 1.5, a);
    const bankTarget = dt > 0 ? clamp(-turn / (turnRate * dt || 1), -1, 1) * u.bankAngle : 0;
    u.roll += (bankTarget - u.roll) * Math.min(1, dt * 1.5);
    if (u.speed > 0.01) {
      u.x += Math.cos(u.heading) * u.speed * dt;
      u.y += Math.sin(u.heading) * u.speed * dt;
    }
    u.x = clamp(u.x, this.min.x, this.max.x);
    u.y = clamp(u.y, this.min.y, this.max.y);
    u.syncObj();
  }

  steerShip(u, dt) {
    const D = u.direct,
      engine = u.engineAlive() ? 1 : 0.2;
    const maxSpeed = u.maxSpeed * u.bonus.speed * u.mods.speed * engine,
      turnRate = u.turnRate * (engine < 1 ? 0.5 : 1);
    const turn = clamp(-D.turn, -1, 1) * turnRate * dt,
      want = D.throttle > 0 ? maxSpeed * Math.min(1, D.throttle) : 0;
    u.heading = wrapAngle(u.heading + turn);
    const a = u.accel * dt;
    u.speed += clamp(want - u.speed, -a * (D.throttle < 0 ? 3 : 1.5), a);
    if (u.speed < 0) u.speed = 0;
    const bankTarget = dt > 0 ? clamp(-turn / (turnRate * dt || 1), -1, 1) * u.bankAngle : 0;
    u.roll += (bankTarget - u.roll) * Math.min(1, dt * 1.5);
    if (u.speed > 0.01) {
      u.x += Math.cos(u.heading) * u.speed * dt;
      u.y += Math.sin(u.heading) * u.speed * dt;
    }
    u.x = clamp(u.x, this.min.x, this.max.x);
    u.y = clamp(u.y, this.min.y, this.max.y);
    u.syncObj();
  }

  directArcs(e, out = []) {
    out.length = 0;
    if (e.isSquad) {
      for (const f of e.fighters) if (!f.dead) out.push(...this.directArcs(f, (this.arcOne ||= [])));
      return out;
    }
    const lead = e;
    if (!lead || lead.dead) return out;
    const seen = new Set();
    const add = (facing, half, r) => {
      if (!(r > 0)) return;
      half = Math.min(Math.PI, half);
      const k = Math.round(facing * 20) + '|' + Math.round(half * 20) + '|' + Math.round(r / 10);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ x: lead.x, y: lead.y, z: lead.z, a: lead.heading + facing, half, r });
    };
    if (lead.isFighter) {
      if (lead.weapon) add(0, 0.5, lead.weapon.range);
      for (const hp of lead.hardpoints) if (hp.isWeapon && hp.alive) add(0, Math.max(hp.coneHalf, 0.4), hp.range);
    } else {
      for (const hp of lead.hardpoints) if (hp.isWeapon && hp.alive) add(hp.facing || 0, hp.coneHalf, hp.range);
      if (lead.weapon) add(0, Math.PI, lead.weapon.range);
    }
    return out;
  }

  directBears(e, t) {
    if (e.isSquad) return e.fighters.some(f => !f.dead && this.directBears(f, t));
    const lead = e;
    if (!lead || lead.dead || !t) return false;
    const dx = t.x - lead.x,
      dy = t.y - lead.y,
      d = Math.hypot(dx, dy),
      off = Math.abs(wrapAngle(Math.atan2(dy, dx) - lead.heading)),
      hr = t.hitRadius > 0 ? t.hitRadius : 0;
    if (lead.isFighter) {
      if (lead.weapon && (t.free || d <= lead.weapon.range + hr) && off <= 0.5) return true;
      return lead.hardpoints.some(
        hp =>
          hp.isWeapon &&
          hp.alive &&
          (t.free || d <= hp.range + hr) &&
          off <= Math.max(hp.coneHalf, 0.4) &&
          !(t.type && this.restricted(hp, t))
      );
    }
    if (lead.weapon && (t.free || d <= lead.weapon.range + hr)) return true;
    return lead.hardpoints.some(hp => hp.isWeapon && hp.alive && this.canBear(lead, hp, t));
  }

  hazardous(f, e) {
    const lead = e.isSquad ? e.fighters[0] : e;
    return !!lead && ((f.asteroid && lead.asteroidDamage) || (f.ion && lead.maxShield > 0));
  }

  inHazard(e) {
    return this.fields.some(f => this.hazardous(f, e) && (e.x - f.x) ** 2 + (e.y - f.y) ** 2 < f.r * f.r);
  }

  clearOf(e, x, y) {
    const pad = (e.radius || 40) + 60;
    for (let pass = 0; pass < 6; pass++) {
      const f = this.fields.find(f => this.hazardous(f, e) && (x - f.x) ** 2 + (y - f.y) ** 2 < (f.r + pad * 0.5) ** 2);
      if (!f) break;
      let dx = x - f.x,
        dy = y - f.y,
        d = Math.hypot(dx, dy);
      if (d < 1) {
        dx = -f.x;
        dy = -f.y;
        d = Math.hypot(dx, dy) || 1;
      }
      x = clamp(f.x + (dx / d) * (f.r + pad), this.min.x, this.max.x);
      y = clamp(f.y + (dy / d) * (f.r + pad), this.min.y, this.max.y);
    }
    return { x, y };
  }

  arrived(e) {
    const next = e.queue && e.queue.shift();
    if (next) e.setOrder(next, true);
    else e.setOrder(e.order.face !== undefined ? { kind: 'idle', face: e.order.face } : { kind: 'idle' });
  }

  updateHeal(u, dt) {
    const h = u.heal;
    if ((h.timer -= dt) > 0) return;
    h.timer = h.interval;
    const mend = t => {
      if (t.hpDriven) {
        let sum = 0;
        for (const p of t.hardpoints)
          if (p.destroyable && p.alive) {
            p.health = Math.min(p.maxHealth, p.health + p.maxHealth * h.percent + h.amount);
            sum += p.health;
          }
        t.health = sum;
      } else t.health = Math.min(t.maxHealth, t.health + t.maxHealth * h.percent + h.amount);
    };
    if (h.range <= 0) {
      if (u.health < u.maxHealth - 0.5) mend(u);
      return;
    }
    let best = null,
      bf = 1;
    for (const t of this.units) {
      if (t.dead || t === u || t.hyper || t.player.team !== u.player.team || t.isStructure) continue;
      const f = t.healthFrac;
      if (f >= 0.999 || (t.x - u.x) ** 2 + (t.y - u.y) ** 2 > h.range * h.range) continue;
      const cats = t.type.categories();
      if (h.cats.length && !h.cats.some(c => cats.has(c) || (c === 'HERO' && (cats.has('SPACEHERO') || cats.has('HERO'))))) continue;
      if (!h.single) {
        mend(t);
        continue;
      }
      if (f < bf) {
        bf = f;
        best = t;
      }
    }
    if (best) {
      mend(best);
      if (h.sfx && this.time - (h.said ?? -9) > 1.5) {
        h.said = this.time;
        this.audio.playAt(best.player, h.sfx, best.x, best.y);
      }
      this.onEvent('healed', { unit: best, by: u });
    }
  }

  updateWeapons(u, dt) {
    if (u.cloaked || u.holdFire) return;
    for (const hp of u.hardpoints) {
      if (!hp.isWeapon || !hp.alive) continue;
      if (hp.pulsesLeft > 0) {
        hp.pulseTimer -= dt;
        if (hp.pulseTimer <= 0) {
          if (hp.target && !hp.target.dead && this.canBear(u, hp, hp.target)) this.fireHardpoint(u, hp);
          hp.pulsesLeft--;
          hp.pulseTimer = hp.pulseDelay;
          if (hp.pulsesLeft === 0) hp.cooldown = rand(hp.rechargeMin, hp.rechargeMax) * u.mods.weaponDelay;
        }
        continue;
      }
      hp.cooldown -= dt;
      if (hp.cooldown > 0) continue;
      const t = this.hardpointTarget(u, hp);
      if (!t) {
        hp.cooldown = 0.25 + simRandom() * 0.25;
        continue;
      }
      hp.target = t;
      hp.targetHp = u.targetHp && u.targetHp.unit === t && u.targetHp.alive ? u.targetHp : null;
      if (hp.targetHp) {
        hp.worldPos(_p);
        hp.targetHp.worldPos(_p2);
        if ((_p2.x - _p.x) ** 2 + (_p2.y - _p.y) ** 2 > (hp.range + 40) ** 2) hp.targetHp = null;
      }
      hp.pulsesLeft = hp.pulses;
      hp.pulseTimer = 0;
    }
  }

  updateTurret(u, dt) {
    const w = u.weapon;
    let t = u.target && !u.target.dead ? u.target : null;
    const reach = tt => (w.range + tt.hitRadius) ** 2;
    if (t && dist2(u, t) > reach(t)) t = null;
    if (!t) {
      let bd = Infinity;
      for (const o of u.enemies) {
        if (o.dead) continue;
        const d = dist2(u, o);
        if (d < bd && d <= reach(o)) {
          bd = d;
          t = o;
        }
      }
    }
    if (t) u.aim = Math.atan2(t.y - u.y, t.x - u.x);
    if (w.pulsesLeft > 0) {
      w.pulseTimer -= dt;
      if (w.pulseTimer <= 0) {
        if (t) {
          const m = (w.fixed >= 0 ? w.muzzles[w.fixed] : w.muzzles.length ? w.muzzles[w.muzzleIndex++ % w.muzzles.length] : null) || {
            x: 0,
            y: 0,
            z: u.height * 0.5
          };
          const c = Math.cos(u.aim),
            s = Math.sin(u.aim);
          const x = u.x + c * m.x - s * m.y,
            y = u.y + s * m.x + c * m.y,
            z = u.z + m.z;
          this.launch(
            w.proj,
            u,
            t,
            null,
            x,
            y,
            z,
            w.damageType,
            w.inaccuracy,
            (w.forward ??= u.type.bool('Fires_Forward')) ? { range: w.range, forward: u.heading } : { range: w.range }
          );
          const sfx = fireSound(u.type, w.proj);
          if (sfx && w.pulsesLeft === w.pulses) this.audio.play(sfx, x, y);
        }
        w.pulsesLeft--;
        w.pulseTimer = w.pulseDelay;
        if (!w.pulsesLeft) w.cooldown = w.recharge * u.mods.weaponDelay;
      }
      return;
    }
    w.cooldown -= dt;
    if (w.cooldown <= 0 && t) {
      w.pulsesLeft = w.pulses;
      w.pulseTimer = 0;
    }
  }

  restricted(hp, t) {
    if (!hp.restrict.size) return false;
    if (hp.restrict.has(t.sizeClass)) return true;
    for (const c of t.type.categories()) if (hp.restrict.has(c)) return true;
    return false;
  }

  canBear(u, hp, t) {
    if (this.restricted(hp, t)) return false;
    hp.worldPos(_p);
    const dx = t.x - _p.x,
      dy = t.y - _p.y;
    const reach = hp.range + t.hitRadius;
    if (!t.free && dx * dx + dy * dy > reach * reach) return false;
    if (hp.coneHalf >= Math.PI * 0.99) return true;
    return Math.abs(wrapAngle(Math.atan2(dy, dx) - (u.heading + hp.facing))) <= hp.coneHalf;
  }

  hardpointTarget(u, hp) {
    if (u.direct) {
      const a = u.direct.firing && u.direct.target;
      return a && !a.dead && this.canBear(u, hp, a) ? a : null;
    }
    const D = hp.def,
      ord = u.order.kind === 'attack' && u.target && !u.target.dead && this.resolveTarget(u.order.target) === u.target ? u.target : null;
    if (ord && this.canBear(u, hp, ord)) return ord;
    hp.rules ??= {
      manual: D.bool('Requires_Manual_Target_Assignment'),
      idle: D.bool('Allow_Opportunity_Fire_When_Idle', true),
      busy: D.bool('Allow_Opportunity_Fire_When_Targeting', true)
    };
    if (hp.rules.manual) return null;
    if (
      !(ord ? hp.rules.busy : hp.rules.idle) &&
      !(!u.player.human && hp.rechargeMin <= db.constants.num('Hardpoint_Recharge_Cutoff_For_Opportunity_Fire', 3))
    )
      return null;
    const had = hp.target;
    if (had && !had.dead && had !== ord && this.canBear(u, hp, had)) return had;
    if (this.time < (hp.lookAt || 0)) return null;
    hp.lookAt = this.time + 0.5;
    const set = setOf(u);
    let best = null,
      br = Infinity;
    hp.worldPos(_p);
    const px = _p.x,
      py = _p.y,
      range = hp.range;
    for (const o of u.enemies) {
      if (o.dead) continue;
      const dx = o.x - px,
        dy = o.y - py,
        reach = range + o.hitRadius;
      if (dx * dx + dy * dy > reach * reach || !this.canBear(u, hp, o)) continue;
      const r = set ? priorityOf(set, o.type) : 1;
      if (r < 0 || (best && !(r < br))) continue;
      best = o;
      br = r;
      if (r === 1) break;
    }
    return best;
  }

  fireHardpoint(u, hp) {
    const L = hp.fireLocal,
      a0 = L[0] || hp.local || { x: 0, y: 0, z: 0 },
      b0 = L[1];
    let fl = a0;
    if (b0 && b0 !== a0) {
      const r = simRandom,
        f = _fl;
      f.x = a0.x + (b0.x - a0.x) * r();
      f.y = a0.y + (b0.y - a0.y) * r();
      f.z = a0.z + (b0.z - a0.z) * r();
      fl = f;
    }
    const c = Math.cos(u.heading),
      s = Math.sin(u.heading);
    const x = u.x + c * fl.x - s * fl.y,
      y = u.y + s * fl.x + c * fl.y,
      z = u.z + fl.z;
    this.launch(
      hp.proj,
      u,
      hp.target,
      hp.targetHp,
      x,
      y,
      z,
      hp.damageType,
      hp.inaccuracy,
      hp.forward ? { range: hp.range, forward: u.heading + hp.facing } : { range: hp.range }
    );
    if (hp.fireSfx) this.audio.play(hp.fireSfx, x, y);
  }

  launch(proj, shooter, target, targetHp, x, y, z, damageType, inaccuracy, opts = null) {
    const speed = proj.num('Max_Speed', 20) * LOGIC_FPS;
    if (!(speed > 0)) return;
    if (!targetHp && target.hpDriven) targetHp = this.pickHardpoint(target, x, y, shooter);
    const cat = categoryOf(proj),
      tp = targetHp ? targetHp.worldPos(_p2) : { x: target.x, y: target.y, z: target.z };
    const tv = velocityOf(target, _p5),
      lead = leadTurning(_p3, x, y, z, tp.x, tp.y, tp.z, tv.x, tv.y, tv.z, target.turnW || 0, speed);
    const dist = Math.hypot(lead.x - x, lead.y - y, lead.z - z);
    const off = offAim(
      _p4,
      dist,
      inaccuracy.get(target.sizeClass) ?? 0,
      shooter.type?.num('Targeting_Max_Attack_Distance', 0) || shooter.attackRange || (opts && opts.range) || dist,
      shooter.type?.num('Targeting_Fire_Inaccuracy_Fixed_Radius_Override', 0) || 0,
      true
    );
    for (const j of this.jammers)
      if (j.team === target.player.team && (target.x - j.x) ** 2 + (target.y - j.y) ** 2 < j.r * j.r) {
        if (simRandom() < 0.65) {
          const a = simRandom() * TAU;
          off.x += Math.cos(a) * target.hitRadius * 2;
          off.y += Math.sin(a) * target.hitRadius * 2;
        }
        break;
      }
    const aim = aimsOff(cat) ? { x: lead.x + off.x, y: lead.y + off.y, z: lead.z + off.z } : { x: lead.x, y: lead.y, z: lead.z };
    let dx = aim.x - x,
      dy = aim.y - y,
      dz = aim.z - z;
    if (cat === CAT.BOMB) {
      dx = Math.cos(shooter.heading || 0);
      dy = Math.sin(shooter.heading || 0);
      dz = 0;
    }
    if (opts && opts.forward !== undefined) {
      dx = Math.cos(opts.forward);
      dy = Math.sin(opts.forward);
      dz = 0;
      off.x = off.y = off.z = 0;
    }
    const len = Math.hypot(dx, dy, dz) || 1;
    const col = proj.vec('Projectile_Laser_Color', [255, 255, 255, 255]);
    const homing = cat === CAT.MISSILE;
    const reach = ((opts && opts.range) || proj.num('Projectile_Max_Flight_Distance', 2000)) + (target.hitRadius || 0) + Math.abs(tp.z - z);
    this.projectiles.push({
      id: ++shotIds,
      def: proj,
      x,
      y,
      z,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      vz: (dz / len) * speed,
      speed,
      cat,
      target,
      targetHp,
      ox: homing ? off.x * Math.cos(-(target.heading || 0)) - off.y * Math.sin(-(target.heading || 0)) : 0,
      oy: homing ? off.x * Math.sin(-(target.heading || 0)) + off.y * Math.cos(-(target.heading || 0)) : 0,
      oz: homing ? off.z : 0,
      sx: x,
      sy: y,
      sz: z,
      aim,
      flown: 0,
      reach,
      fall: 0,
      team: shooter.player.team,
      path:
        cat === CAT.ROCKET || cat === CAT.MPTL_ROCKET ? rocketPath(proj, x, y, z, dx / len, dy / len, dz / len, aim.x, aim.y, aim.z) : null,
      damage: proj.num('Projectile_Damage', 5) * shooter.bonus.damage * shooter.mods.damageDealt * (opts && opts.mult ? opts.mult : 1),
      blastRange: proj.num('Projectile_Blast_Area_Range', 0),
      blastDamage: proj.num('Projectile_Blast_Area_Damage', 0),
      ion: opts ? opts.ion || 0 : 0,
      ionSpeed: opts && opts.ionSpeed,
      ionDelay: opts && opts.ionDelay,
      damageType: damageType || proj.str('Damage_Type'),
      owner: shooter.player,
      from: shooter.isSpecialWeapon ? null : shooter,
      shields: proj.bool('Projectile_Does_Shield_Damage', true),
      hull: proj.bool('Projectile_Does_Hitpoint_Damage', true),
      homing,
      turn: proj.num('Max_Rate_Of_Turn', 0) * LOGIC_FPS * DEG,
      scan: proj.num('Projectile_Max_Scan_Range', 0),
      width: proj.num('Projectile_Width', 3),
      length: proj.num('Projectile_Length', 10),
      fx: (proj._fx ||= {
        hit: particleFile(proj.str('Projectile_Object_Detonation_Particle')),
        shield: particleFile(proj.str('Projectile_Absorbed_By_Shields_Particle'))
      }),
      r: col[0] / 255,
      g: col[1] / 255,
      b: col[2] / 255,
      missile: homing || /MISSILE|TORPEDO|ROCKET|BOMB/i.test(proj.str('Projectile_Category')),
      life: proj.num('Projectile_Max_Lifetime', 0),
      end: particleFile(proj.str('Projectile_Lifetime_Detonation_Particle')),
      age: 0,
      fxs: null,
      fxSeen: 0
    });
    const made = (proj._made ??= particleFile(proj.str('Projectile_Object_Creation_Particle')));
    if (made && this.fx.made) this.fx.made(made, x, y, z);
    if (shooter.revealsFiring && !shooter.isSpecialWeapon) this.firedOn(shooter, target);
  }

  firedOn(u, target) {
    const team = target.player && target.player.id >= 0 ? target.player.team : null;
    if (!team || !this.fog || team === u.player.team) return;
    const until = this.time + db.constants.num('SpaceFOWRegrowTime', 6),
      C = (this.fowCell ||= db.constants.num('DesiredSpaceFOWCellSize', 100));
    const cx = Math.floor(u.x / C),
      cy = Math.floor(u.y / C),
      n = Math.floor((u.revealSize || 10) / C + 0.5);
    const list = (u.spotted ||= []);
    for (const s of list)
      if (s.team === team) {
        s.cx = cx;
        s.cy = cy;
        s.n = n;
        s.until = until;
        return;
      }
    list.push({ team, cx, cy, n, until });
  }

  launchPoint(proj, shooter, x, y, z, tx, ty, tz, { delay = 0 } = {}) {
    if (!proj) return;
    const speed = Math.max(60, proj.num('Max_Speed', 12) * LOGIC_FPS);
    const dx = tx - x,
      dy = ty - y,
      dz = tz - z,
      len = Math.hypot(dx, dy, dz) || 1;
    const col = proj.vec('Projectile_Laser_Color', [255, 200, 120, 255]);
    this.projectiles.push({
      id: ++shotIds,
      def: proj,
      x,
      y,
      z,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      vz: (dz / len) * speed,
      speed,
      target: null,
      targetHp: null,
      ox: 0,
      oy: 0,
      oz: 0,
      point: { x: tx, y: ty, z: tz },
      wait: delay,
      cat: -1,
      flown: 0,
      reach: len + 50,
      team: shooter.player.team,
      damage: proj.num('Projectile_Damage', 20) * shooter.bonus.damage * shooter.mods.damageDealt,
      damageType: proj.str('Damage_Type'),
      owner: shooter.player,
      shields: proj.bool('Projectile_Does_Shield_Damage', true),
      hull: proj.bool('Projectile_Does_Hitpoint_Damage', true),
      homing: false,
      turn: 0,
      width: proj.num('Projectile_Width', 4),
      length: proj.num('Projectile_Length', 10),
      blastRange: proj.num('Projectile_Blast_Area_Range', 0),
      blastDamage: proj.num('Projectile_Blast_Area_Damage', 0),
      ion: 0,
      fx: (proj._fx ||= {
        hit: particleFile(proj.str('Projectile_Object_Detonation_Particle')),
        shield: particleFile(proj.str('Projectile_Absorbed_By_Shields_Particle'))
      }),
      r: col[0] / 255,
      g: col[1] / 255,
      b: col[2] / 255,
      missile: true,
      age: 0,
      fxs: null,
      fxSeen: 0
    });
  }

  areaDamage(x, y, radius, amount, damageType, owner, { shields = true, hull = true, proj = null } = {}) {
    const immune = proj ? (proj._blastImmune ??= proj.str('Projectile_Blast_Area_Immune_Faction').trim().toUpperCase()) : '';
    for (const o of this.units.slice()) {
      if (o.dead || o.hyper || !o.targetableUnit) continue;
      if (immune) {
        if (String(o.player.factionName || '').toUpperCase() === immune) continue;
      } else if (o.player.id < 0 || (owner && o.player.team === owner.team)) continue;
      if (!(o.type.collidable ??= o.type.bool('Collidable_By_Projectile_Living', false))) continue;
      const d = Math.hypot(o.x - x, o.y - y) - o.hitRadius;
      if (d > radius) continue;
      const k = d <= 0 ? 1 : 1 - 0.7 * (d / radius);
      this.damage(o, amount * k, { damageType, attacker: owner, shields, hull, x: o.x, y: o.y, z: o.z, proj });
    }
  }

  detonate(proj, owner, x, y, z, scale = 1, big = false) {
    const range = proj.num('Projectile_Blast_Area_Range', 150) * scale,
      dmg = proj.num('Projectile_Blast_Area_Damage', 0) || proj.num('Projectile_Damage', 100);
    this.fx.explosion(
      x,
      y,
      z,
      Math.min(600, range * 0.8),
      big || range > 300,
      particleFile(proj.str('Projectile_Lifetime_Detonation_Particle')) || particleFile(proj.str('Projectile_Object_Detonation_Particle'))
    );
    this.audio.play(proj.str('Projectile_SFXEvent_Detonate') || 'Unit_Star_Destroyer_Death_SFX', x, y);
    this.areaDamage(x, y, range, dmg, proj.str('Damage_Type'), owner, {
      shields: proj.bool('Projectile_Does_Shield_Damage', true),
      hull: proj.bool('Projectile_Does_Hitpoint_Damage', true),
      proj
    });
  }

  delayed(seconds, x, y, z, fn) {
    this.timers.push({ at: this.time + seconds, fn });
  }

  beam(a, b, color, width) {
    this.beams.push({ a, b, color, until: this.time + 0.06, width });
  }

  useAbility(e, kind, on = true, target = null, approach = false) {
    return useAbility(this, e, kind, on, target, approach);
  }

  checkPending(e) {
    const p = e.pendingAbility;
    if (!p) return;
    const lead = e.isSquad ? e.fighters[0] : e,
      t = p.target,
      ord = e.order;
    const same = ord.kind === 'attack' && ord.reach && (ord.target === t || ord.target === t.squad);
    if (!lead || t.dead || this.time > p.until || !same) {
      e.pendingAbility = null;
      return;
    }
    const st = lead.abilities.find(a => a.def.kind === p.kind);
    if (!st) {
      e.pendingAbility = null;
      return;
    }
    if (Math.hypot(t.x - e.x, t.y - e.y) > st.def.range + t.hitRadius) return;
    e.pendingAbility = null;
    ord.reach = 0;
    const why = useAbility(this, e, p.kind, true, t);
    if (!why && st.def.sfxOn) this.audio.playFor(e.player, st.def.sfxOn);
  }

  updateProjectiles(dt) {
    const ps = this.projectiles;
    if (dt > 0)
      for (const u of this.units) {
        const h = u.heading || 0;
        u.turnW = u.lastH === undefined ? 0 : Math.atan2(Math.sin(h - u.lastH), Math.cos(h - u.lastH)) / dt;
        u.lastH = h;
      }
    if (ps.length) this.makeHitGrid();
    const deflect = (this._deflect ||= []);
    deflect.length = 0;
    if (ps.some(p => p.homing))
      for (const u of this.units) {
        if (u.dead) continue;
        let r = (u.type._missileShield ??= u.type.num('Passive_Missile_Shield_Radius', 0));
        if (u.abilities.length && u.isActive('MISSILE_SHIELD')) r = u.abilityState('MISSILE_SHIELD').def.node.num('Effective_Radius', r);
        if (r > 0) deflect.push(u, r);
      }
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.dead) continue;
      if (p.wait > 0) {
        p.wait -= dt;
        ps[n++] = p;
        continue;
      }
      let keep = true;
      const step = p.speed * dt;
      p.age += dt;
      const t = p.target;
      if (p.point) {
        const dx = p.point.x - p.x,
          dy = p.point.y - p.y,
          dz = p.point.z - p.z;
        if (Math.hypot(dx, dy, dz) <= step + 4) {
          const range = p.blastRange || 60;
          this.fx.explosion(p.point.x, p.point.y, p.point.z, Math.min(160, range * 0.7), false, p.fx.hit);
          this.areaDamage(p.point.x, p.point.y, range, p.blastDamage || p.damage, p.damageType, p.owner, {
            shields: p.shields,
            hull: p.hull,
            proj: p.def
          });
          continue;
        }
      }
      if (p.cat < 0) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if ((p.flown += step) >= p.reach) keep = false;
        if (keep) ps[n++] = p;
        continue;
      }
      if (p.homing && (!t || t.dead || t.hyper)) {
        p.target = p.targetHp = null;
        if (p.scan > 0) {
          let best = null,
            bd = p.scan * p.scan;
          for (const o of this.units)
            if (!o.dead && !o.hyper && o.targetableUnit && o.player.id >= 0 && o.player.team !== p.team) {
              const d2 = (o.x - p.x) ** 2 + (o.y - p.y) ** 2 + (o.z - p.z) ** 2;
              if (d2 < bd) {
                bd = d2;
                best = o;
              }
            }
          p.target = best;
        }
      }
      const x0 = p.x,
        y0 = p.y,
        z0 = p.z;
      if (p.path) {
        p.flown += step;
        pathAt(_p, p.path, p.flown);
        p.x = _p.x;
        p.y = _p.y;
        p.z = _p.z;
        p.vx = _p.dx * p.speed;
        p.vy = _p.dy * p.speed;
        p.vz = _p.dz * p.speed;
        if (p.flown >= p.path.total) keep = false;
      } else {
        if (p.homing && p.target) {
          const tt = p.target,
            tp =
              p.targetHp && p.targetHp.alive && p.targetHp.unit === tt
                ? p.targetHp.worldPos(_p)
                : ((_p.x = tt.x), (_p.y = tt.y), (_p.z = tt.z), _p);
          let gx = tp.x,
            gy = tp.y,
            gz = tp.z;
          if (p.ox && p.oy && p.oz) {
            const h = tt.heading || 0,
              c = Math.cos(h),
              s = Math.sin(h);
            gx += p.ox * c - p.oy * s;
            gy += p.ox * s + p.oy * c;
            gz += p.oz;
          }
          let wx = gx - p.x,
            wy = gy - p.y,
            wz = gz - p.z;
          for (let k = 0; k < deflect.length; k += 2) {
            const d = deflect[k],
              r = deflect[k + 1];
            if (d.player.team === p.owner.team) continue;
            const ax = p.x - d.x,
              ay = p.y - d.y,
              az = p.z - (d.z || 0);
            if (ax * ax + ay * ay + az * az < r * r) {
              wx = ax || 1;
              wy = ay;
              wz = az;
              break;
            }
          }
          const wl = Math.hypot(wx, wy, wz) || 1,
            il = 1 / p.speed;
          turnToward(_p4, p.vx * il, p.vy * il, p.vz * il, wx / wl, wy / wl, wz / wl, p.turn * dt);
          p.vx = _p4.x * p.speed;
          p.vy = _p4.y * p.speed;
          p.vz = _p4.z * p.speed;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.cat === CAT.BOMB || p.cat === CAT.CLUSTER_BOMB) {
          p.fall += p.def.num('Projectile_Bomb_Fall_Accel_Rate', 0) * LOGIC_FPS * LOGIC_FPS * dt;
          p.z -= p.fall * dt;
        }
        p.flown += step;
      }
      if (keep) {
        let hit = null,
          ht = 2;
        const hg = this.hitGrid,
          C = HIT_CELL;
        const cx0 = Math.floor(Math.min(x0, p.x) / C),
          cx1 = Math.floor(Math.max(x0, p.x) / C),
          cy0 = Math.floor(Math.min(y0, p.y) / C),
          cy1 = Math.floor(Math.max(y0, p.y) / C);
        for (let ix = cx0; ix <= cx1; ix++)
          for (let iy = cy0; iy <= cy1; iy++) {
            const l = hg.get(ix * 65536 + iy);
            if (l)
              for (const o of l) {
                if (o.dead || o.player.team === p.team) continue;
                const r = Math.max(o.hitReach || o.hitRadius, o.collR || 0, o.collBall || 0) + step;
                if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 > r * r) continue;
                const h = o.heading || 0,
                  ch = Math.cos(h),
                  sh = Math.sin(h);
                let tt = o.coll
                  ? segNear(x0, y0, z0, p.x, p.y, p.z, o.x, o.y, o.z, o.collR)
                    ? this.meshStep(o, x0, y0, z0, p.x, p.y, p.z)
                    : -1
                  : o.hitA
                    ? sweepBox(
                        x0,
                        y0,
                        z0,
                        p.x,
                        p.y,
                        p.z,
                        o.x + ch * o.hitF - sh * o.hitL,
                        o.y + sh * o.hitF + ch * o.hitL,
                        o.z + o.hitZ,
                        h,
                        o.hitA,
                        o.hitB,
                        o.hitC
                      )
                    : sweep(x0, y0, z0, p.x, p.y, p.z, o.x, o.y, o.z, 0, o.hitRadius, o.hitRadius, o.hitRadius);
                if (tt < 0 && o.collBall > 0) tt = sweep(x0, y0, z0, p.x, p.y, p.z, o.x, o.y, o.z, 0, o.collBall, o.collBall, o.collBall);
                if (tt >= 0 && tt < ht) {
                  ht = tt;
                  hit = o;
                }
              }
          }
        if (hit) {
          const hx = x0 + (p.x - x0) * ht,
            hy = y0 + (p.y - y0) * ht,
            hz = z0 + (p.z - z0) * ht;
          const hp = hit.hpDriven
            ? p.targetHp && p.targetHp.alive && p.target === hit
              ? p.targetHp
              : this.pickHardpoint(hit, hx, hy, p.from)
            : null;
          this.damage(hit, p.damage, {
            damageType: p.damageType,
            hp,
            attacker: p.owner,
            from: p.from,
            shields: p.shields,
            hull: p.hull,
            x: hx,
            y: hy,
            z: hz,
            fx: p.fx,
            proj: p.def
          });
          if (p.def.bool('Projectile_Ion_Stun_On_Detonation')) this.ionHit(p, hit, hx, hy);
          if (p.blastRange > 0 && p.blastDamage > 0)
            this.areaDamage(hx, hy, p.blastRange, p.blastDamage * 0.5, p.damageType, p.owner, {
              shields: p.shields,
              hull: p.hull,
              proj: p.def
            });
          keep = false;
          p.hitDone = true;
        }
      }
      if (keep && (p.reach > 0 ? p.flown >= p.reach : p.life > 0 && p.age >= p.life)) keep = false;
      if (
        keep &&
        p.cat === CAT.DEFAULT &&
        p.def.bool('Explode_When_Reached_Target_Radius', false) &&
        (p.x - p.sx) ** 2 + (p.y - p.sy) ** 2 + (p.z - p.sz) ** 2 >= (p.aim.x - p.sx) ** 2 + (p.aim.y - p.sy) ** 2 + (p.aim.z - p.sz) ** 2
      )
        keep = false;
      if (!keep && p.reach !== undefined && !p.hitDone) {
        if (p.end) this.fx.hit(p.x, p.y, p.z, 8, p.end);
        if (p.blastRange > 0 && p.blastDamage > 0)
          this.areaDamage(p.x, p.y, p.blastRange, p.blastDamage, p.damageType, p.owner, { shields: p.shields, hull: p.hull, proj: p.def });
      }
      if (keep) ps[n++] = p;
    }
    ps.length = n;
  }

  makeHitGrid() {
    const hg = this.hitGrid || (this.hitGrid = new Map()),
      C = HIT_CELL;
    for (const l of hg.values()) l.length = 0;
    for (const o of this.units) {
      if (o.dead || o.hyper || !o.targetableUnit || o.player.id < 0) continue;
      if (!(o.type.collidable ??= o.type.bool('Collidable_By_Projectile_Living', false))) continue;
      const r = Math.max(
        o.hitA ? (o.hitReach ??= Math.hypot(o.hitA, o.hitB) + Math.abs(o.hitF) + Math.abs(o.hitL)) : o.hitRadius,
        o.collR || 0,
        o.collBall || 0
      );
      const x0 = Math.floor((o.x - r) / C),
        x1 = Math.floor((o.x + r) / C),
        y0 = Math.floor((o.y - r) / C),
        y1 = Math.floor((o.y + r) / C);
      for (let ix = x0; ix <= x1; ix++)
        for (let iy = y0; iy <= y1; iy++) {
          const k = ix * 65536 + iy;
          let l = hg.get(k);
          if (!l) hg.set(k, (l = []));
          l.push(o);
        }
    }
  }

  meshStep(o, x0, y0, z0, x1, y1, z1) {
    const k = 1 / (o.scale || 1),
      a = -((o.heading || 0) + Math.PI / 2),
      c = Math.cos(a),
      s = Math.sin(a);
    const P = o.pitch || 0,
      R = o.roll || 0,
      cp = Math.cos(P),
      sp = Math.sin(P),
      cr = Math.cos(-R),
      sr = Math.sin(-R);
    const to = (x, y, z, out) => {
      x -= o.x;
      y -= o.y;
      z -= o.z;
      let X = x * c - y * s,
        Y = x * s + y * c,
        Z = z;
      if (P) {
        const y2 = Y * cp - Z * sp,
          z2 = Y * sp + Z * cp;
        Y = y2;
        Z = z2;
      }
      if (R) {
        const x2 = X * cr + Z * sr,
          z2 = -X * sr + Z * cr;
        X = x2;
        Z = z2;
      }
      out.x = X * k;
      out.y = Y * k;
      out.z = Z * k;
      return out;
    };
    const A = to(x0, y0, z0, _ms0),
      B = to(x1, y1, z1, _ms1);
    return meshHit(o.coll, A.x, A.y, A.z, B.x - A.x, B.y - A.y, B.z - A.z);
  }

  updateHunt(e, dt) {
    if (e.order.kind !== 'idle' || !e.isActive('HUNT')) return;
    if ((e.huntTimer = (e.huntTimer || 0) - dt) > 0) return;
    e.huntTimer = 1;
    const bit = e.player.bit;
    let best = null,
      bd = Infinity;
    for (const o of this.units) {
      if (o.dead || o.player.id < 0 || o.player.team === e.player.team || !o.targetableUnit || o.hyper || !(o.seenBy & bit)) continue;
      let dd = dist2(e, o);
      if (o.isStructure) dd *= 4;
      if (dd < bd) {
        bd = dd;
        best = o;
      }
    }
    if (best) {
      e.setOrder({ kind: 'attack', target: best.squad || best });
      if (!e.isSquad) e.target = best;
    } else {
      e.setOrder({ kind: 'attackmove', ...this.clearOf(e, rand(this.min.x, this.max.x) * 0.85, rand(this.min.y, this.max.y) * 0.85) });
    }
  }

  closing(lead, tgt, ord) {
    if (lead.attackPositioning || lead.type.bool('Keep_Moving_In_Battle')) return false;
    const T = tgt.isSquad ? tgt.fighters[0] || tgt : tgt,
      range = lead.type.num('Targeting_Max_Attack_Distance', 0) || lead.maxRange || 0,
      reach = range + (T.hitRadius || 0);
    if (!ord.sent) {
      ord.sent = { x: T.x, y: T.y };
      ord.chaseAt = this.time + 1;
      ord.engaged = false;
    } else if (this.time >= ord.chaseAt) {
      ord.chaseAt = this.time + 1;
      if (dist2(ord.sent, T) > (range / 2) ** 2) {
        ord.sent.x = T.x;
        ord.sent.y = T.y;
        ord.engaged = false;
      }
    }
    if (dist2(lead, T) <= reach * reach) ord.engaged = true;
    return !ord.engaged;
  }

  updateSquad(s, dt) {
    if (s.hyper) {
      s.hyper -= dt;
      if (s.hyper <= 0) s.hyper = 0;
      this.centerSquad(s);
      return;
    }
    const rp = s.replenish;
    if (rp && !rp.leader.dead && s.fighters.length < s.members.length) {
      if ((rp.timer -= dt) <= 0) {
        rp.timer = rp.every;
        const have = new Set(s.fighters.map(f => f.member));
        s.members.forEach((name, i) => {
          if (!have.has(i)) {
            const u = s.launch(name, i, rp.leader.x, rp.leader.y, rp.leader.heading);
            if (u) u.z = rp.leader.z;
          }
        });
        if (rp.sfx) this.audio.playFor(s.player, rp.sfx);
        this.recountPop();
      }
    } else if (rp) rp.timer = rp.every;
    if (s.direct) {
      s.mode = 'idle';
      s.target = null;
      this.centerSquad(s);
      return;
    }
    this.updateHunt(s, dt);
    const ord = s.order;
    s.scanTimer -= dt;
    let tgt = s.target && !s.target.dead ? s.target : null;
    if (ord.kind === 'attack') {
      tgt = ord.target && !ord.target.dead ? ord.target : null;
      if (!tgt) s.setOrder({ kind: 'idle' });
    } else if (s.scanTimer <= 0) {
      s.scanTimer = 0.7;
      const lead = s.fighters[0];
      if (ord.kind === 'idle' && s.homeOf !== ord) {
        s.homeOf = ord;
        s.home = { x: s.x, y: s.y };
      }
      const lt = s.type,
        kind = ord.kind;
      const range =
        kind === 'guard'
          ? lt.num('Guard_Chase_Range', 0)
          : kind === 'attackmove'
            ? lt.num('Attack_Move_Response_Range', 0)
            : lt.num('Idle_Chase_Range', 0);
      const ext = lt.num('Autonomous_Move_Extension_Vs_Attacker', 0);
      const anchor = kind === 'guard' ? (ord.target ? this.posOf(ord.target) : ord) : kind === 'idle' && s.home ? s.home : s;
      const reach = (lead && lead.weapon ? lead.weapon.range : lead && lead.maxRange) || 400;
      const attacking = o => {
        const t = o.squad ? o.squad.target : o.target;
        return t === s || (t && t.squad === s);
      };
      const within = o => {
        if (range < 0) return false;
        const r = range + (attacking(o) ? ext : 0) + reach;
        return dist2(anchor, this.posOf(o)) <= r * r;
      };
      const chase2 = Math.max(range + ext + reach, 1) ** 2;
      if (tgt && !within(tgt)) tgt = null;
      if (!tgt && lead && ord.kind !== 'move') {
        let best = null,
          bs = Infinity;
        const set = setOf(lead);
        for (const o of this.units) {
          if (o.dead || o.player.team === s.player.team || o.player.id < 0 || !o.targetableUnit || o.hyper || !(o.seenBy & s.player.bit))
            continue;
          if (!within(o)) continue;
          let d = dist2(anchor, o);
          if (set) {
            const p = priorityOf(set, o.type);
            if (p < 0) continue;
            d += (p === Infinity ? 20 : p) * chase2 * 2;
          } else if (s.isBomber === o.isFighter) d += chase2;
          if (o.isStructure) d += chase2 * 0.5;
          if (d < bs) {
            bs = d;
            best = o;
          }
        }
        tgt = best ? best.squad || best : null;
      }
    }
    s.target = tgt;

    const lead = s.fighters[0];
    if (!lead) return;
    s.x = lead.x;
    s.y = lead.y;
    s.heading = lead.heading;
    let top = Infinity;
    for (const f of s.fighters) if (f.maxSpeed < top) top = f.maxSpeed;
    s.speed = top;
    let mode = 'idle',
      about = null;
    if (tgt && ord.kind === 'attack' && this.closing(lead, tgt, ord)) {
      mode = 'move';
      s.goal = ord.sent;
    } else if (tgt) {
      mode = 'combat';
      if (tgt.isSquad) {
        const tl = tgt.fighters[0] || tgt,
          row = Math.floor(tl.y / DOG_CELL),
          off = row & 1 ? DOG_CELL / 2 : 0;
        (s.cell ||= { x: 0, y: 0 }).x = (Math.floor((tl.x - off) / DOG_CELL) + 0.5) * DOG_CELL + off;
        s.cell.y = (row + 0.5) * DOG_CELL;
        if (!tgt.target && tgt.order.kind !== 'move' && tgt.order.kind !== 'attack') tgt.target = s;
      } else {
        const hp = ord.kind === 'attack' && ord.target === tgt && ord.hp && ord.hp.alive ? ord.hp : null;
        const aim = (s.aim = hp ? hp.worldPos(s.aim || {}) : { x: tgt.x, y: tgt.y, z: tgt.z });
        s.aimHp = hp;
        const R = this.flight(lead).strafe + tgt.hitRadius,
          dx = aim.x - lead.x,
          dy = aim.y - lead.y;
        s.approach = dx * dx + dy * dy > R * R;
        s.runIn = Math.abs(wrapAngle(Math.atan2(dy, dx) - lead.heading)) <= Math.PI / 4;
      }
    } else if (ord.kind === 'move' || ord.kind === 'attackmove') {
      if (dist2(lead, ord) > IDLE_NEAR * IDLE_NEAR) {
        mode = 'move';
        s.goal = ord;
      } else {
        about = { x: ord.x, y: ord.y };
        this.arrived(s);
      }
    } else if (ord.kind === 'guard') {
      if (ord.target && ord.target.dead) {
        const t = this.posOf(ord.target);
        s.setOrder({ kind: 'move', x: t.x, y: t.y });
      } else {
        const p = this.guardSpot(s, ord),
          keep = 150 + (ord.target ? ord.target.radius || 0 : 0);
        if (dist2(lead, p) > keep * keep) {
          mode = 'move';
          s.goal = p;
        } else about = p;
      }
    } else if (ord.kind === 'idle' && s.home) {
      if (dist2(lead, s.home) > IDLE_NEAR * IDLE_NEAR * 4) {
        mode = 'move';
        s.goal = s.home;
      } else about = s.home;
    }
    if (mode === 'idle') {
      const from = about || (s.mode !== 'idle' || !s.about ? lead : null),
        f = s.idleFrom;
      if (from && (s.mode !== 'idle' || !f || f.x !== from.x || f.y !== from.y)) {
        s.idleFrom = { x: from.x, y: from.y };
        s.about = this.idleCell(s, from);
      }
    }
    s.mode = mode;
    let worst = 0;
    const c = Math.cos(lead.heading),
      sn = Math.sin(lead.heading);
    for (let i = 1; i < s.fighters.length; i++) {
      const f = s.fighters[i],
        ox = f.slot.x - lead.slot.x,
        oy = f.slot.y - lead.slot.y;
      const e = (lead.x + c * ox - sn * oy - f.x) ** 2 + (lead.y + sn * ox + c * oy - f.y) ** 2;
      if (e > worst) worst = e;
    }
    s.loose = worst > (s.tolerance ??= s.type.num('Squadron_Formation_Error_Tolerance', 0)) ** 2;
  }

  idleCell(s, p) {
    const C = IDLE_CELL,
      mn = this.map.min,
      mx = this.map.max,
      ox = mn[0],
      oy = mn[1];
    const cols = Math.max(1, Math.floor((mx[0] - ox) / C)),
      rows = Math.max(1, Math.floor((mx[1] - oy) / C));
    const cx = (c, r) => ox + c * C + C / 2 + (r & 1 ? C / 2 : 0),
      cy = r => oy + r * C + C / 2;
    const taken = new Set();
    for (const q of this.squads) {
      if (q === s || q.dead || q.mode !== 'idle' || !q.about || !q.about.cell) continue;
      const r = Math.round((q.about.y - oy - C / 2) / C);
      taken.add(r * cols + Math.round((q.about.x - ox - C / 2 - (r & 1 ? C / 2 : 0)) / C));
    }
    const r0 = Math.floor((p.y - oy) / C),
      row = clamp(r0, 0, rows - 1);
    const col = clamp(Math.floor((Math.max(p.x - (r0 & 1 ? C / 2 : 0), ox) - ox) / C), 0, cols - 1);
    if (!taken.has(row * cols + col)) return { x: cx(col, row), y: cy(row), cell: true };
    let looked = 0;
    for (let d = 1; ; d++) {
      const ra = Math.max(0, row - d),
        rb = Math.min(rows - 1, row + d),
        ca = Math.max(0, col - d),
        cb = Math.min(cols - 1, col + d);
      let best = null,
        bd = Infinity;
      for (let r = ra; r <= rb; r++) {
        for (let c = ca; c <= cb; c++) {
          if (c !== ca && r !== ra && r !== rb && !(c === col && r === row)) c = cb;
          if (!taken.has(r * cols + c)) {
            const x = cx(c, r),
              y = cy(r),
              e = (x - p.x) ** 2 + (y - p.y) ** 2;
            if (e < bd) {
              bd = e;
              best = { x, y, cell: true };
            }
          }
          if (++looked >= 64) return { x: p.x, y: p.y, cell: false };
        }
      }
      if (best) return best;
    }
  }

  centerSquad(s) {
    let x = 0,
      y = 0;
    for (const f of s.fighters) {
      x += f.x;
      y += f.y;
    }
    if (s.fighters.length) {
      s.x = x / s.fighters.length;
      s.y = y / s.fighters.length;
    }
  }

  posOf(e) {
    return e.isSquad ? e.fighters[0] || e : e;
  }

  guardSpot(u, ord) {
    const t = ord.target;
    u.guardFollow = null;
    if (!t) return ord;
    const p = this.posOf(t),
      lead = u.isSquad ? u.fighters[0] || u : u;
    const R = Math.min(
      (lead.type.num('Targeting_Max_Attack_Distance', 0) || lead.maxRange || 800) / 2,
      db.constants.num('Space_Guard_Range', 750)
    );
    const o = t.order;
    if (o && (o.kind === 'move' || o.kind === 'attackmove') && o.x !== undefined && dist2(lead, p) <= R * R) {
      u.guardFollow = t;
      return { x: o.x, y: o.y };
    }
    if (!u.guardAt || u.guardOf !== t || dist2(u.guardAt, p) > R * R) {
      u.guardAt = { x: p.x, y: p.y };
      u.guardOf = t;
    }
    return u.guardAt;
  }

  flight(u) {
    const t = u.type;
    return (
      t._fly ||
      (t._fly = {
        lift: t.num('Max_Lift', 0) * LOGIC_FPS * DEG,
        roll: (t.num('Max_Rate_Of_Roll', 0) || 5) * LOGIC_FPS * DEG,
        thrust: t.num('Max_Thrust', 0) * LOGIC_FPS * LOGIC_FPS,
        bank: t.num('Bank_Turn_Angle', 0) * DEG,
        strafe: t.num('Strafe_Distance', 0),
        follow: t.num('Minimum_Follow_Distance', 0)
      })
    );
  }

  fly(u, tx, ty, tz, want, dt, k = 1, over = true) {
    const F = this.flight(u),
      st = u.fstate;
    u.roll ||= 0;
    const err = wrapAngle(Math.atan2(ty - u.y, tx - u.x) - u.heading);
    if (
      !st.loop &&
      over &&
      F.lift > 0 &&
      Math.abs(err) > LOOP_OVER &&
      u.speed > u.minSpeed * 0.5 &&
      (tx - u.x) ** 2 + (ty - u.y) ** 2 > 400
    ) {
      st.loop = Math.atan2(tz - u.z, Math.hypot(tx - u.x, ty - u.y)) - (u.pitch || 0) > 0 ? 1 : -1;
    }
    if (st.loop) {
      u.pitch = (u.pitch || 0) + st.loop * F.lift * dt * k;
      u.roll += clamp(-u.roll, -F.roll * dt, F.roll * dt);
      if (Math.abs(u.pitch) >= Math.PI / 2) {
        u.pitch = st.loop * Math.PI - u.pitch;
        u.heading = wrapAngle(u.heading + Math.PI);
        u.roll = wrapAngle(u.roll + Math.PI);
        st.loop = undefined;
        u.flip = true;
      }
    } else {
      const bank = -clamp(err, -F.bank, F.bank);
      u.roll += clamp(bank - u.roll, -F.roll * dt, F.roll * dt);
      if (!(u.roll * bank < 0) || Math.abs(u.roll) < 0.02)
        u.heading = wrapAngle(u.heading + clamp(err, -u.turnRate * dt * k, u.turnRate * dt * k));
    }
    const a = (F.thrust || u.accel) * dt * k;
    u.speed += clamp(want - u.speed, -a, a);
    if (!st.loop && F.lift > 0) {
      const h = Math.max(Math.hypot(tx - u.x, ty - u.y), u.speed / Math.max(0.1, u.turnRate)),
        p = u.pitch || 0;
      const level = (Math.abs(p) / F.lift) * u.speed;
      const dz = (tz - u.z) * (h < level ? h / level : 1);
      u.pitch = p + clamp(Math.atan2(dz, h) - p, -F.lift * dt * k, F.lift * dt * k);
    }
    const flat = Math.cos(u.pitch || 0);
    u.x += Math.cos(u.heading) * u.speed * flat * dt;
    u.y += Math.sin(u.heading) * u.speed * flat * dt;
    if (st.loop || F.lift > 0) u.z += Math.sin(u.pitch || 0) * u.speed * dt;
    else u.z += (tz - u.z) * Math.min(1, dt * 0.8);
  }

  updateFighter(u, dt) {
    const s = u.squad,
      st = u.fstate,
      F = this.flight(u);
    const lead = s ? s.fighters[0] : u,
      mode = s ? s.mode || 'idle' : 'idle',
      own = u.bonus.speed * u.mods.speed * this.pursuit(u);
    const top = (s ? s.speed : u.maxSpeed) * own,
      low = u.minSpeed * own;
    const tgt = mode === 'combat' && s.target && !s.target.dead ? s.target : null;
    let gx = 0,
      gy = 0,
      want = top,
      k = 1,
      form = lead !== u,
      fireAt = null;
    st.snap = null;
    if (tgt && tgt.isSquad) {
      const cell = s.cell || lead;
      let p = st.partner;
      if (p && (p.dead || this.time >= st.until)) p = st.partner = null;
      if (!p && this.time >= (st.taken || 0) && dist2(lead, cell) <= DOG_NEAR) {
        const reach = ((u.weapon ? u.weapon.range : u.maxRange) || 400) ** 2;
        for (const e of tgt.fighters) {
          const dx = e.x - u.x,
            dy = e.y - u.y;
          if (e.dead || dx * dx + dy * dy > reach || Math.abs(wrapAngle(Math.atan2(dy, dx) - u.heading)) > Math.PI / 2) continue;
          p = st.partner = e;
          st.until = this.time + PAIR_TIME;
          if (e.fstate) {
            e.fstate.taken = this.time + PAIR_TIME;
            e.fstate.partner = null;
          }
          break;
        }
      }
      if (p) {
        form = false;
        gx = p.x;
        gy = p.y;
        want = dist2(u, p) < F.follow * F.follow ? low : clamp(p.speed, low, top);
        fireAt = p;
      } else {
        fireAt = tgt.fighters.length ? tgt.fighters[u.member % tgt.fighters.length] : null;
        if (!form) {
          gx = cell.x;
          gy = cell.y;
        }
      }
    } else if (tgt) {
      fireAt = tgt;
      const aim = s.aim || tgt;
      if (s.approach || (!form && s.runIn)) {
        form = false;
        gx = aim.x;
        gy = aim.y;
      } else if (!form) {
        gx = u.x + Math.cos(u.heading) * 300;
        gy = u.y + Math.sin(u.heading) * 300;
      }
    } else if (mode === 'move' && !form) {
      gx = s.goal.x;
      gy = s.goal.y;
      want = top * (s.order.pace ?? 1);
    } else if (mode === 'idle' && !form) {
      const c = s ? s.about || u : u,
        d = Math.hypot(u.x - c.x, u.y - c.y);
      if (d < 10) {
        gx = u.x + Math.cos(u.heading) * 50;
        gy = u.y + Math.sin(u.heading) * 50;
      } else {
        gx = c.x;
        gy = c.y;
      }
      want = top;
    }
    if (form) {
      const ch = Math.cos(lead.heading),
        sh = Math.sin(lead.heading),
        ox = u.slot.x - lead.slot.x,
        oy = u.slot.y - lead.slot.y;
      const px = lead.x + ch * ox - sh * oy,
        py = lead.y + sh * ox + ch * oy,
        ahead = lead.speed / Math.max(0.1, lead.turnRate);
      gx = px + ch * ahead;
      gy = py + sh * ahead;
      want = s.travel ?? top;
      if (s.loose) {
        const behind = (px - u.x) * ch + (py - u.y) * sh,
          room = Math.max(4, (want * 0.5) ** 2 / (2 * (F.thrust || u.accel)));
        k = 1 + 0.5 * clamp(behind / room, -1, 1);
        want *= k;
      }
    } else if (s && lead === u) s.travel = want;
    const D = s ? s.direct : u.direct;
    if (D) {
      const pace = D.throttle > 0 ? top : D.throttle < 0 ? low : (top + low) / 2,
        h = lead.heading - clamp(D.turn, -1, 1) * 1.2;
      if (!form) {
        gx = u.x + Math.cos(h) * 400;
        gy = u.y + Math.sin(h) * 400;
        want = pace;
      } else {
        const ch = Math.cos(lead.heading),
          sh = Math.sin(lead.heading),
          ox = u.slot.x - lead.slot.x,
          oy = u.slot.y - lead.slot.y;
        const px = lead.x + ch * ox - sh * oy,
          py = lead.y + sh * ox + ch * oy,
          behind = (px - u.x) * ch + (py - u.y) * sh;
        gx = px + Math.cos(h) * 400;
        gy = py + Math.sin(h) * 400;
        want = pace * (1 + 0.5 * clamp(behind / 60, -1, 1));
      }
      fireAt = D.firing && D.target && !D.target.dead ? D.target : null;
    } else if (!tgt && u.enemies.length) {
      st.snap = u.enemies.find(e => !e.dead && e.isFighter) || null;
    }
    st.mode = tgt ? 'attack' : 'form';
    const away = this.probe(u, st, lead === u, dt);
    if (away) {
      gx = away.x;
      gy = away.y;
      want = top;
    }
    const cruiseZ = u.type.num('Layer_Z_Adjust', 0) + 35 + (u.squad && u.squad.stacked && u.slot ? u.slot.z : (u.id * 37) % 50);
    this.fly(u, gx, gy, cruiseZ, want, dt, k, !(mode === 'idle' && !tgt));
    u.syncObj();

    const w = u.weapon;
    if (u.cloaked) return;
    if (!D) fireAt ||= st.snap;
    if (!w) {
      if (u.hasWeapons) this.updateFighterHardpoints(u, dt, fireAt, st);
      return;
    }
    if (w.pulsesLeft > 0) {
      w.pulseTimer -= dt;
      if (w.pulseTimer <= 0) {
        if (fireAt && !fireAt.dead) this.fireFighter(u, w, fireAt);
        w.pulsesLeft--;
        w.pulseTimer = w.pulseDelay;
        if (!w.pulsesLeft) w.cooldown = w.recharge * rand(0.85, 1.15) * u.mods.weaponDelay;
      }
      return;
    }
    w.cooldown -= dt;
    if (w.cooldown > 0 || !fireAt || st.mode === 'break') return;
    const dx = fireAt.x - u.x,
      dy = fireAt.y - u.y;
    const reach = w.range + fireAt.hitRadius;
    if (!fireAt.free && dx * dx + dy * dy > reach * reach) return;
    if (Math.abs(wrapAngle(Math.atan2(dy, dx) - u.heading)) > 0.5) return;
    w.pulsesLeft = w.pulses;
    w.pulseTimer = 0;
  }

  updateFighterHardpoints(u, dt, target, st) {
    if (u.holdFire) return;
    for (const hp of u.hardpoints) {
      if (!hp.isWeapon || !hp.alive) continue;
      if (hp.pulsesLeft > 0) {
        hp.pulseTimer -= dt;
        if (hp.pulseTimer <= 0) {
          if (hp.target && !hp.target.dead) this.fireHardpoint(u, hp);
          hp.pulsesLeft--;
          hp.pulseTimer = hp.pulseDelay;
          if (hp.pulsesLeft === 0) hp.cooldown = rand(hp.rechargeMin, hp.rechargeMax) * u.mods.weaponDelay;
        }
        continue;
      }
      hp.cooldown -= dt;
      if (hp.cooldown > 0 || !target || target.dead || st.mode === 'break' || this.restricted(hp, target)) continue;
      const dx = target.x - u.x,
        dy = target.y - u.y,
        reach = hp.range + target.hitRadius;
      if (!target.free && dx * dx + dy * dy > reach * reach) continue;
      if (Math.abs(wrapAngle(Math.atan2(dy, dx) - u.heading)) > Math.max(hp.coneHalf, 0.4)) continue;
      hp.target = target;
      hp.targetHp = null;
      hp.pulsesLeft = hp.pulses;
      hp.pulseTimer = 0;
    }
  }

  fireFighter(u, w, target) {
    const m = (w.fixed >= 0 ? w.muzzles[w.fixed] : w.muzzles.length ? w.muzzles[w.muzzleIndex++ % w.muzzles.length] : null) || {
      x: 8,
      y: 0,
      z: 0
    };
    const c = Math.cos(u.heading),
      s = Math.sin(u.heading);
    const x = u.x + c * m.x - s * m.y,
      y = u.y + s * m.x + c * m.y,
      z = u.z + m.z;
    const sq = u.squad,
      hp = sq && sq.aimHp && sq.target === target && sq.aimHp.alive ? sq.aimHp : null;
    this.launch(
      w.proj,
      u,
      target,
      hp,
      x,
      y,
      z,
      w.damageType,
      w.inaccuracy,
      (w.forward ??= u.type.bool('Fires_Forward')) ? { range: w.range, forward: u.heading } : { range: w.range }
    );
    const sfx = fireSound(u.type, w.proj);
    if (sfx && w.pulsesLeft === w.pulses) this.audio.play(sfx, x, y);
  }

  probe(u, st, leader, dt) {
    if (st.avoid > 0) {
      st.avoid -= dt;
      return { x: u.x + (Math.cos(u.heading) * u.speed * 10) / LOGIC_FPS, y: u.y + (Math.sin(u.heading) * u.speed * 10) / LOGIC_FPS };
    }
    const T = (2 / Math.max(0.05, u.turnRate)) * (leader ? 2 : 1),
      v = u.speed * T;
    if (v < 1) return null;
    const ex = Math.cos(u.heading),
      ey = Math.sin(u.heading);
    let hit = null,
      best = Infinity;
    const step = u.speed / LOGIC_FPS;
    const near =
      step <= PROBE_PAD
        ? this.obstacleGrid && this.obstacleGrid.get(Math.floor(u.x / PROBE_CELL) * 65536 + Math.floor(u.y / PROBE_CELL))
        : this.obstacles;
    if (!near) return null;
    for (const o of near) {
      const r = o.hitRadius || o.radius || 0;
      if (!r) continue;
      const ox = o.x - u.x,
        oy = o.y - u.y,
        d2 = ox * ox + oy * oy;
      const bound = Math.max(o.radius || 0, r) + u.speed / LOGIC_FPS;
      if (d2 > bound * bound || d2 < r * r) continue;
      const along = ox * ex + oy * ey;
      if (along < 0) continue;
      const off2 = d2 - along * along;
      if (off2 > r * r) continue;
      const at = along - Math.sqrt(r * r - off2);
      if (at <= v && at < best) {
        best = at;
        hit = o;
      }
    }
    if (!hit) return null;
    st.avoid = 15 / LOGIC_FPS;
    const ax = u.x - hit.x,
      ay = u.y - hit.y;
    return ax || ay ? { x: u.x + ax, y: u.y + ay } : { x: u.x + 100, y: u.y };
  }
}
