import * as THREE from 'three';
import { db } from '../gamedata.js';
import { heightAt } from './terrain.js';
import { buildsFor, costOf, inCategory, isUpgrade, missingFor, isHeroCompany, animReady, animClip } from './land.js';
import { AnimState } from '../ala.js';
import { setParticleDepth } from '../particles.js';
import { PostFX } from './post.js';
import { lensMaterial } from './lens.js';
import { lighting, boltLights } from '../model.js';
import { gfx } from '../gfx.js';
import { surfaceAt, SURFACES } from './landsurface.js';
import { activeLoadScreen } from './loadscreen.js';
import { iconUrl } from '../icons.js';
import { simRandom } from './simrandom.js';
import { settlePose } from './posecache.js';
import { MOD } from './combatmods.js';
import { categoryOf, CAT } from './projflight.js';
import { pressed, held, keysOf, keyName } from './keybinds.js';
import { canGarrison, putInside, ungarrison } from './landbase.js';
import { Overlord } from './overlord.js';
import { eawSkin } from './eawskin.js';
import { TERRAIN } from './landtables.js';

const REACH = 1600,
  STRAY = 500,
  SENS = 0.0022,
  JUMP = 70,
  GRAVITY = 190,
  RESPAWN = 5,
  DEATH_CAM = 3,
  CREW_REACH = 500,
  FOV = 70,
  ZOOM_FOV = 32,
  MOD_KEY = 917001,
  RANGE_UP = { INFANTRY: 1.5, VEHICLE: 1, AIR: 0.5 },
  PLAYER_HEALTH = 1,
  PLAYER_DAMAGE = 1.5,
  PLAYER_FIRE_RATE = 3,
  FOOT_DAMAGE = 1,
  FOOT_FIRE_RATE = 1,
  VISION = 1.4,
  IDLE_GO = 1.5,
  BOT_TICK = 0.25,
  LIGHT_HIT = 14,
  AIR = { slow: 0.35, cruise: 0.7, accel: 0.8, floor: 12, ceil: 380, climb: 0.9, lift: 0.6, roll: 0.9, look: 60 },
  RADAR = { size: 170, range: 900 },
  ADS_SPEED = 0.65,
  HOME = { reach: 420, out: 70, tries: 12 },
  FIELD_CAP = 50,
  HEAT = { burst: 3.5, cool: 0.55, delay: 0.3, unlock: 0.25, minShots: 6 },
  AMMO = { rocket: 6, grenade: 4, refill: 2.5 },
  REGEN = { wait: 5, rate: 0.05, heal: 0.12, reach: 1.25, tick: 0.5 },
  KICK = { heat: 0.012, ammo: 0.05, yaw: 0.35, recover: 7 },
  BOB = { walk: 0.012, run: 0.02, rate: 0.055 },
  DODGE = { speed: 2.6, time: 0.32, cool: 1.4 },
  SPRINT_FOV = 8,
  MARKERS = { fade: 140, names: 220, maxFeed: 5, feedLife: 6, feedNear: 700 },
  COMPASS = { w: 460, h: 30, span: Math.PI * 0.9 },
  INTRO = { ms: 7000 },
  LOW_TICKETS = 0.2,
  PAD_TOPS = { cell: 10, kinds: /(Build|Outpost|Mineral_Processor)_Pad/i, inset: 3, maxUp: 24 },
  INCOME_PER_MIN = 2000,
  BOT_RESPAWN = { delay: 10, perTick: 3, vehicle: 0.12, maxVehicles: 6 },
  ALLY_TAGS = { range: 700, size: 4.5, min: 2.2 },
  RECOIL = 0.09,
  FP_TILT = { min: -0.1, max: 0.45 },
  FIX = { yaw: 0.9, pitch: 0.8 },
  FP_MUZZLE_Y = -0.42,
  SOUND_FALLOFF = 2,
  DUMMY = { wait: 3 },
  REMOTE = { delay: 0.1, keep: 10, fire: 0.04, reach: 45 },
  IDLE_GUN = { firing: false, target: null },
  LAG = { reach: 60 },
  PLAYER_TAG = { reach: 2400, foeReach: 700, font: 15, edge: 40, showDist: 120 },
  CONQUEST = { mult: 2, crewMax: 30 },
  GUN_POSE = { face: 0.3, hold: 1.2 },
  SLOT_ROUTE = { every: 1.5 },
  ROCK = { cell: 8, minH: 12, minW: 20, steps: 4, wall: 10, foot: 6, steep: 0.6, headroom: 22, closeHits: 1, keep: 1 },
  BONUS = { damage: 8, recharge: 1.5 },
  EVEN = { key: 917003, source: 'shooter-even', minRange: 80 },
  CATCHUP = { delay: 4 },
  SHORT = { range: 80, weight: 0.15 },
  STALL = { fails: 3, still: 15, moved: 30, avoid: 60, skip: 10 },
  SCORE = { foot: 100, car: 250, assistMin: 10, assistMax: 90, assistStep: 5 },
  WALK = { slope: 1, wet: 6, drive: 0.9 },
  THROW = { time: 0.55, up: 1.7, down: -0.5, peak: 0.4 },
  MUZZLE = 0.55,
  REPOS = { hits: 3, still: 7, moved: 15, rings: [35, 60, 90], turns: [0, 0.5, -0.5, 1, -1, 1.5, -1.5], wait: 4 },
  SQUAD_ICON = { reach: 900, up: 1.5, size: 9 },
  WATCH = { back: 34, up: 16, side: 9, swap: 20, ease: 4 },
  SHADOW = { half: 700, ahead: 0.35 },
  GLOW = { slots: 8, reach: 700, radius: 38, power: 0.9, blast: 110, blastPower: 1.6, blastTime: 0.18 },
  OCCLUDE = { slots: 16, reach: 320, foot: 7, footPower: 0.45, car: 1.3, carPower: 0.55 },
  GRADE = { bloom: 0.4, cutoff: 0.96, sun: 0.12, sat: 1.08, contrast: 1.06, vignette: 0.22, focus: 6, motion: 0.35, motionMax: 0.02 },
  CLUTTER = { maxR: 18, copies: 2, ring: [18, 55], reach: 650, max: 450, tick: 1 },
  DAMAGE_FX = { smoke: 0.5, fire: 0.25, every: 0.35, reach: 1600, smokeFx: 'Smoke_Medium_Land', fireFx: 'Environmental_Fire_Damage_Particles', bigFx: 'Smoke_Big_Land' },
  WRECK = { time: 25, fade: 2.5 },
  FEEL = { roll: 0.07, pitch: 0.07, max: 0.12, sway: 0.035, stride: 40, shake: 0.5, settle: 5 },
  BOOST = { speed: 1.6, fov: 10, roll: 0.75, side: 1.3 },
  WARN = { beep: 0.6 },
  ROLE = { scout: 1.25, heavy: 1.6, heavyFire: 1.8 },
  ROLE_TEXT = {
    trooper: 'Trooper - rifle and thermal detonators',
    rocket: 'Rocket trooper - lock-on launcher, strong against vehicles',
    scout: 'Scout - long rifle with a zoom scope',
    heavy: 'Heavy - big heat sink for long bursts',
    hero: 'Hero'
  },
  GRENADE = { count: 2, speed: 1.3, radius: 2.2, damage: 4, refill: 6, arc: 28, reach: 0.92 },
  LOCK = { cone: 0.09, time: 1.2, damage: 1.5, reach: 1.1 },
  SCOPE = { fov: 12, damage: 1.6, spread: 0.15, sens: 0.18 },
  HEAVY = { heat: 0.55 },
  HERO = { points: 1500, drain: 1 / 150, kill: 0.08 },
  SQUAD_SPAWN = { calm: 5, max: 4 },
  AUDIO = { air: 300, airMin: 1800, muffle: 700, quiet: 0.55, occReach: 2500, hrtf: 1500, wetMax: 0.4, wetTick: 0.5, whiz: 35, whizGap: 120, stride: 15, stepReach: 150, stepMax: 6, fight: 900, verb: 1.6 },
  STEP_SFX = { grass: 'GRASS', snow: 'SNOW', ice: 'SNOW', water: 'WATER', concrete: 'CONCRETE', mud: 'MUD' },
  ENGAGE_SCAN = 0.4,
  FIGHT_HOLD = 12,
  FP_EYE = { back: 0.135, right: -0.06, up: 0.087, crouchLift: 0.12 },
  TICKETS = { start: 150, foot: 1, vehicle: 2, bleed: 5 },
  AIM_PITCH = { chest: 0.35, arms: 0.65, raise: 0.45, min: -1, max: 1.1 },
  SPREAD_OUT = { far: 120, min: 10, max: 55 },
  HOP = { min: 40, max: 70, every: [5, 8] },
  CALM = { blind: 1, end: 1.5, stop: 60 },
  SEP = { gap: 1.7, min: 11, speed: 20 },
  COVER = { health: 0.55, hurt: 2, ring: [35, 60, 90], hold: [3, 5.5] },
  SKILL = {
    easy: { damage: 0.6, strafe: 0.1, cover: 0.3, aim: 1.5, react: [0.45, 0.8] },
    normal: { damage: 1, strafe: 0.2, cover: 0.6, aim: 1, react: [0.25, 0.6] },
    hard: { damage: 1.4, strafe: 0.3, cover: 0.85, aim: 0.7, react: [0.18, 0.4] }
  },
  TEAM = { size: 4, join: 450, tick: 2, bound: 260, swap: 4, slot: 24, follow: 45, hop: [40, 75], guard: 350, look: 300, reroute: 80, routeAge: 12, offRoute: 140 },
  SUPP = { near: 26, add: 0.3, decay: 2.5, cover: 0.55, aim: 2 },
  ACC = { base: 0.012, tSpeed: 60, own: 40, settle: 0.35, settleT: 2.5 },
  VEH = { bail: 0.2, halt: 2.5, gap: 2, fast: 160, overshoot: 180, run: 5 },
  RETREAT = { below: 0.3, until: 0.75, time: 25 },
  HEAD = 2,
  HEAD_FROM = 0.8,
  SIGHT_TTL = 0.4,
  SPREAD = { still: 0.005, walk: 0.016, run: 0.03, air: 0.04, crouch: 0.6, zoom: 0.5, bloom: 0.03, cool: 0.1, max: 0.02 };

const PALETTES = {
  normal: { enemy: '#ff5040', enemyRGB: '255,80,64', enemySoft: '#ff7a64', ally: '#5fb3ff', allyRGB: '95,179,255', allySoft: '#7cc7ff', friend: '#4fd06a', friendRGB: '70,235,110' },
  safe: { enemy: '#ff9f1a', enemyRGB: '255,159,26', enemySoft: '#ffb85c', ally: '#4aa8ff', allyRGB: '74,168,255', allySoft: '#8cc8ff', friend: '#5ad1ff', friendRGB: '90,209,255' }
};
const PAL = { ...PALETTES.normal };
function usePalette(safe) {
  Object.assign(PAL, safe ? PALETTES.safe : PALETTES.normal);
  const r = document.documentElement.style;
  r.setProperty('--sh-ally-soft', PAL.allySoft);
  r.setProperty('--sh-enemy-soft', PAL.enemySoft);
}
const CFG_KEY = 'swr-shooter-settings',
  CFG_DEFAULT = { fov: 70, sens: 1, ads: 1, invert: false, view: 'third', crosshair: 'ring', bob: true, colorblind: false, assist: true };
function loadCfg() {
  let got = {};
  try {
    got = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {};
  } catch {}
  return { ...CFG_DEFAULT, ...got };
}
const TIPS = [
  'Hold a command post to spawn there and to heal and restock.',
  'Heroes unlock every 1500 points - captures and kills both count.',
  'Troopers can hold the grenade key to see where a thermal detonator lands.',
  'Rocket troopers lock onto vehicles while aiming down the sights.',
  'Spawn on a squad leader who is out of combat to join the push.',
  'Empty friendly vehicles appear on this screen and spawn you in the driver seat.',
  'Bolts that pass close by suppress soldiers - keep the pressure on.',
  'Press the view key in a vehicle for the cockpit or gun view.'
];
const PAD = { dead: 0.16, look: 2.8, adsLook: 0.5, assist: 0.45, cone: 0.07, trigger: 0.4 };

const LOWER_BONES = /ROOT|PELVIS|HIP|THIGH|CALF|SHIN|FOOT|TOE|LEG/i;

const RIDE_CAM = { tall: 1.6, back: 1.9, side: 0.32, lift: 1.12, eye: 1.04, ahead: 0.62, settle: 7 },
  SHOT_GAIN = { foot: 1.7, ride: 1.35 };

const SHOOTER_CSS = `
.sh-hit { position: absolute; left: 50%; top: 50%; width: 40px; height: 40px; margin: -20px 0 0 -20px; opacity: 0; transition: opacity .18s ease-out; filter: drop-shadow(0 0 1px #000); }
.sh-hit.pop { animation: sh-pop .14s ease-out; }
.sh-hit.kill svg { transform: scale(1.2); }
@keyframes sh-pop { from { transform: scale(1.35); } to { transform: scale(1); } }
.sh-banner { position: fixed; left: 50%; top: 22%; transform: translateX(-50%); z-index: 55; pointer-events: none; font: 400 calc(26px * var(--eaw-k, 1)) var(--eaw-bold); color: rgb(225,70,45); text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000; opacity: 0; white-space: nowrap; }
.sh-banner.show { animation: sh-fade 3.2s linear forwards; }
@keyframes sh-fade { 0% { opacity: 0; } 8% { opacity: 1; } 82% { opacity: 1; } 100% { opacity: 0; } }
.sh-cap { position: absolute; left: 50%; top: 92px; transform: translateX(-50%); width: calc(330px * var(--eaw-k, 1)); padding: 4px 10px 6px; text-align: center; }
.sh-cap-t { margin-bottom: 4px; font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-cap-bar { width: 100%; }
.sh-cap-bar i { transition: width .2s linear; }
.sh-vig { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(150,0,0,.5) 85%, rgba(110,0,0,.8) 100%); }
.sh-wpn { position: absolute; right: 222px; bottom: 26px; width: calc(250px * var(--eaw-k, 1)); padding: 4px 10px 6px; }
.sh-wpn-n { font: 400 calc(13px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); margin-bottom: 4px; }
.sh-wpn-bar { width: 100%; }
.sh-wpn-s, .sh-wpn-x { margin-top: 3px; font: 400 calc(11px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-wpn-x { color: var(--eaw-dim); }
.sh-wpn.hot .sh-wpn-s { color: rgb(235,80,50); animation: sh-blink .5s steps(2) infinite; }
@keyframes sh-blink { 50% { opacity: .4; } }
.sh-pop { position: absolute; left: 50%; top: 50%; margin: -52px 0 0 22px; font: 400 calc(16px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); text-shadow: 1px 1px 0 #000; pointer-events: none; animation: sh-pop-up .9s linear forwards; }
.sh-pop.assist { color: var(--eaw-cream); font-size: calc(13px * var(--eaw-k, 1)); }
.sh-pop.kill { color: var(--eaw-gold); }
@keyframes sh-pop-up { 0% { opacity: 0; transform: translateY(4px); } 12% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-22px); } }
.sh-compass { position: absolute; left: 50%; top: 52px; transform: translateX(-50%); width: 460px; height: 30px; background: rgba(0,0,0,.35); }
.sh-feed { position: absolute; right: 18px; top: 18px; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-list); text-shadow: 1px 1px 0 #000; }
.sh-feed-row { padding: 1px 8px; background: rgba(0,0,0,.45); }
.sh-feed-row.mine { background: rgba(80,70,0,.55); }
.sh-feed-row i { font-style: normal; color: var(--eaw-cream); margin: 0 7px; opacity: .75; }
.sh-ann { position: fixed; left: 50%; top: 168px; transform: translateX(-50%); z-index: 45; display: flex; flex-direction: column; align-items: center; gap: 3px; pointer-events: none; }
.sh-ann-row { font: 400 calc(15px * var(--eaw-k, 1)) var(--eaw-bold); text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000; animation: sh-fade 4s linear forwards; }
.sh-ann-row.good { color: var(--sh-ally-soft, #7cc7ff); } .sh-ann-row.bad { color: var(--sh-enemy-soft, #ff7a64); } .sh-ann-row.info { color: var(--eaw-gold); }
.sh-bigmap { position: fixed; inset: 0; z-index: 58; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.5); pointer-events: none; }
.sh-bigmap-box { padding: 0 6px 6px; }
.sh-bigmap canvas { display: block; width: min(74vh, 74vw); height: min(74vh, 74vw); margin-top: 6px; }
.sh-intro { position: fixed; inset: 0; z-index: 62; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding-bottom: 14vh; pointer-events: none; background: linear-gradient(180deg, rgba(0,0,0,.4), transparent 22%, transparent 64%, rgba(0,0,0,.55)); }
.sh-intro-t { font: 400 calc(46px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); text-shadow: 2px 2px 0 rgba(0,0,0,.75); animation: sh-fade-in 1s linear; }
.sh-intro-s { margin-top: 6px; font: 400 calc(14px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .08em; color: var(--eaw-cream); text-shadow: 1px 1px 0 #000; }
.sh-intro-c { margin-top: 16px; font: 400 calc(17px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-cream); text-shadow: 1px 1px 0 #000; }
.sh-intro-k { margin-top: 8px; font: 400 calc(11px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-dim); }
@keyframes sh-fade-in { from { opacity: 0; } to { opacity: 1; } }
.sh-end { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.6); }
.sh-frame.sh-end-box { width: min(calc(1000px * var(--eaw-k, 1)), 96vw); }
.sh-end-body { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 10px 6px 12px; }
.sh-end-body canvas { width: 100%; height: auto; display: block; }
.sh-end-you { margin-top: 10px; font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-tbl { width: 100%; border-collapse: collapse; font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-list); color: #fff; }
.sh-tbl th { text-align: left; font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); padding: 3px 6px; border-bottom: 1px solid rgba(195,171,2,.45); }
.sh-tbl td { padding: 3px 6px; border-bottom: 1px solid rgba(255,255,255,.06); }
.sh-tbl tr.me td { background: rgba(195,171,2,.18); }
.sh-tbl td:not(:first-child), .sh-tbl th:not(:first-child) { text-align: right; }
.sh-end-aw div { margin: 3px 0; font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-end .sh-foot { padding: 6px 6px 2px; }
.sh-ret-rocket { border-radius: 3px !important; border-style: dashed !important; }
.sh-ret-scout { border-width: 1px !important; }
.sh-ret-scout::before { content: ''; position: absolute; left: 50%; top: -9px; bottom: -9px; width: 1px; background: rgba(255,215,106,.85); }
.sh-ret-scout::after { content: ''; position: absolute; top: 50%; left: -9px; right: -9px; height: 1px; background: rgba(255,215,106,.85); }
.sh-ret-heavy { border-width: 4px !important; border-style: double !important; }
.sh-ret-hero { border-color: rgba(124,199,255,.95) !important; }
.sh-scope { position: fixed; inset: 0; z-index: 39; pointer-events: none; display: none; background: radial-gradient(circle at center, transparent 0, transparent 34vmin, rgba(0,0,0,.94) calc(34vmin + 2px)); }
.sh-scope::before { content: ''; position: absolute; left: 50%; top: 16vmin; bottom: 16vmin; width: 1px; background: rgba(0,0,0,.85); }
.sh-scope::after { content: ''; position: absolute; top: 50%; left: calc(50% - 34vmin); right: calc(50% - 34vmin); height: 1px; background: rgba(0,0,0,.85); }
.sh-card.ride::after, .sh-card.hero::after { position: absolute; top: 3px; right: 5px; font: 400 calc(10px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); text-shadow: 1px 1px 0 #000; }
.sh-card.ride::after { content: 'Ride'; }
.sh-card.hero::after { content: 'Hero'; }
.sh-card.locked { opacity: .45; }
.sh-vhud { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); width: calc(300px * var(--eaw-k, 1)); padding: 4px 10px 6px; }
.sh-vh-n { font: 400 calc(13px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); margin-bottom: 4px; }
.sh-vh-row { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
.sh-vh-row span { width: calc(64px * var(--eaw-k, 1)); font: 400 calc(10px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .08em; color: var(--eaw-cream); }
.sh-vh-row .sh-bar { flex: 1; }
.sh-vh-row i.s { filter: hue-rotate(170deg) saturate(1.4); }
.sh-vh-info { margin-top: 4px; font: 400 calc(11px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-vh-warn { display: none; margin-top: 5px; text-align: center; font: 400 calc(13px * var(--eaw-k, 1)) var(--eaw-bold); color: rgb(235,80,50); text-shadow: 1px 1px 0 #000; animation: sh-blink .5s steps(1) infinite; }
.sh-ch-dot { border-color: transparent !important; }
.sh-ch-cross { border-color: transparent !important; }
.sh-ch-cross::before { content: ''; position: absolute; left: 50%; top: -6px; bottom: -6px; width: 2px; margin-left: -1px; background: rgba(255,215,106,.85); box-shadow: 0 0 2px #000; }
.sh-ch-cross::after { content: ''; position: absolute; top: 50%; left: -6px; right: -6px; height: 2px; margin-top: -1px; background: rgba(255,215,106,.85); box-shadow: 0 0 2px #000; }
.sh-set { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.55); }
.sh-frame.sh-set-box { width: min(calc(580px * var(--eaw-k, 1)), 94vw); }
.sh-set-body { padding: 8px 6px 4px; display: flex; flex-direction: column; gap: 7px; }
.sh-set-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: calc(24px * var(--eaw-k, 1)); font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .08em; color: var(--eaw-cream); }
.sh-set-row .eaw-select { width: calc(200px * var(--eaw-k, 1)); }
.sh-set-range { display: flex; align-items: center; gap: 10px; }
.sh-set-range input { width: calc(200px * var(--eaw-k, 1)); }
.sh-set-range b { width: calc(62px * var(--eaw-k, 1)); text-align: right; font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-list); color: #fff; }
.sh-set .sh-foot { padding: 10px 6px 2px; }
.sh-setbtn { margin: 0; }
.sh-tip { padding: 0 6px 6px; font: 400 calc(11px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-dim); }
.sh-hints { position: fixed; right: 18px; top: 120px; z-index: 46; padding: 4px 12px 8px; pointer-events: none; }
.sh-hints-t { font: 400 calc(14px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); margin-bottom: 5px; }
.sh-hints table { font: 400 calc(11px * var(--eaw-k, 1)) var(--eaw-list); color: #fff; }
.sh-hints td { padding: 2px 12px 2px 0; }
.sh-hints td:first-child { font-family: var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-hints td:last-child { color: var(--eaw-dim); }
.sh-hints-k { margin-top: 6px; font: 400 calc(10px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-dim); }
.sh-deploy { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.5); }
.sh-frame { width: min(calc(1180px * var(--eaw-k, 1)), 96vw); }
.sh-head { display: flex; align-items: baseline; justify-content: space-between; padding: 0 6px 8px; }
.sh-title { font: 400 calc(24px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); text-shadow: 1px 1px 0 rgba(0,0,0,.6); }
.sh-sub { font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .08em; color: var(--eaw-cream); }
.sh-body { display: flex; gap: calc(18px * var(--eaw-k, 1)); padding: 4px 6px 6px; }
.sh-mapbox { flex: 0 0 auto; width: min(calc(500px * var(--eaw-k, 1)), 44vw); }
.sh-mapwrap { line-height: 0; width: 100%; }
.sh-map { display: block; width: 100%; height: auto; aspect-ratio: 1; }
.sh-maphint { margin-top: 6px; font: 400 calc(11px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-dim); }
.sh-side { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
.sh-label { font: 400 calc(14px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); margin-bottom: 6px; }
.sh-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(136px * var(--eaw-k, 1)), 1fr)); gap: calc(6px * var(--eaw-k, 1)); max-height: calc(272px * var(--eaw-k, 1)); overflow: auto; }
.sh-card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 4px 5px; cursor: pointer; font: 400 calc(11px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .05em; color: var(--eaw-cream); }
.sh-card:hover:not(.locked) { filter: brightness(1.25); }
.sh-card.on { outline: 2px solid var(--eaw-gold); outline-offset: -1px; filter: brightness(1.3); }
.sh-icon { width: calc(54px * var(--eaw-k, 1)); height: calc(54px * var(--eaw-k, 1)); background: #000 center / cover no-repeat; outline: 1px solid rgba(195,171,2,.55); }
.sh-cname { max-width: 100%; text-align: center; line-height: 1.2; min-height: 2.4em; overflow-wrap: anywhere; }
.sh-cost { font: 400 calc(10px * var(--eaw-k, 1)) var(--eaw-list); color: var(--eaw-gold); }
.sh-detail { display: flex; gap: 12px; margin-top: 10px; padding: 6px 8px; }
.sh-portrait { flex: 0 0 calc(92px * var(--eaw-k, 1)); height: calc(92px * var(--eaw-k, 1)); background: #000 center / cover no-repeat; outline: 1px solid rgba(195,171,2,.6); }
.sh-dtext { flex: 1 1 auto; min-width: 0; }
.sh-dname { font: 400 calc(16px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); overflow-wrap: anywhere; }
.sh-dkind { margin: 2px 0 7px; font: 400 calc(11px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-stat { display: flex; align-items: center; gap: 8px; margin: 4px 0; font: 400 calc(11px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-stat span { flex: 0 0 calc(84px * var(--eaw-k, 1)); }
.sh-stat .sh-bar { flex: 1 1 auto; }
.sh-foot { display: flex; align-items: center; justify-content: flex-end; gap: calc(10px * var(--eaw-k, 1)); margin-top: auto; padding-top: calc(12px * var(--eaw-k, 1)); }
.sh-status { flex: 1 1 auto; min-width: 0; font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-go { min-width: calc(150px * var(--eaw-k, 1)); }
.sh-tickets { position: fixed; left: 50%; top: 10px; transform: translateX(-50%); z-index: 45; display: flex; gap: 18px; padding: 3px 14px 4px; pointer-events: none; white-space: nowrap; font: 400 calc(13px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-cream); }
.sh-tickets span.mine { color: var(--eaw-gold); }
.sh-tickets b { font: 400 1em var(--eaw-list); margin-left: 6px; color: #fff; }
.sh-me { position: absolute; left: 22px; bottom: 22px; width: calc(250px * var(--eaw-k, 1)); padding: 4px 10px 6px; }
.sh-me-n { margin-bottom: 4px; font: 400 calc(13px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); }
.sh-me .eaw-bar { margin-top: 3px; }
.sh-me-s { margin-top: 5px; font: 400 calc(11px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-hudtext { font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000; }
.sh-credit { font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-bold); color: var(--eaw-gold); text-shadow: 1px 1px 0 #000; }
.sh-board { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); z-index: 65; min-width: calc(460px * var(--eaw-k, 1)); padding: 0 6px 8px; display: none; pointer-events: none; }
.sh-board-line { margin-top: 8px; font: 400 calc(12px * var(--eaw-k, 1)) var(--eaw-font); letter-spacing: .06em; color: var(--eaw-cream); }
.sh-radar { border-radius: 50%; background: rgba(0,0,0,.55); box-shadow: 0 0 0 2px rgba(195,171,2,.75), 0 0 0 3px rgba(0,0,0,.8); }
`;

const _fwd = new THREE.Vector3(),
  _hd = new THREE.Vector3(),
  _nu = new THREE.Vector3(),
  _tq = new THREE.Quaternion(),
  _sv = new THREE.Vector3(),
  _lk = new THREE.Vector3(),
  _v = new THREE.Vector3(),
  _box = new THREE.Box3(),
  _q = new THREE.Quaternion(),
  _q2 = new THREE.Quaternion(),
  _mz = new THREE.Vector3(),
  _gpv = new THREE.Vector3(),
  _gs = new THREE.Vector3(),
  _gm = new THREE.Matrix4(),
  _gm2 = new THREE.Matrix4(),
  _ndc = new THREE.Vector3(),
  _bw = new THREE.Vector3(),
  _off = new THREE.Vector3(),
  _rot = new THREE.Vector3(),
  _pq = new THREE.Quaternion(),
  _gp = new THREE.Vector3(),
  _ax = new THREE.Vector3(),
  _X = new THREE.Vector3(1, 0, 0),
  _Y = new THREE.Vector3(0, 1, 0),
  _Z = new THREE.Vector3(0, 0, 1);

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export const shooterWanted = setup =>
  setup.mode === 'land' &&
  !setup.net &&
  !setup.campaign?.linked &&
  !setup.restore &&
  (!setup.benchmark || new URLSearchParams(location.search).has('shooter')) &&
  !setup.spectate &&
  (new URLSearchParams(location.search).has('shooter') || !!globalThis.shooterMode || !!setup.shooter);

export class Shooter {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.me = game.me;
    this.body = null;
    this.rideQ = null;
    this.state = 'deploy';
    this.deadAt = 0;
    this.readyAt = 0;
    this.cfg = loadCfg();
    usePalette(this.cfg.colorblind);
    this.third = this.cfg.view !== 'first';
    this.yaw = 0;
    this.pitch = -0.05;
    this.keys = new Set();
    this.fire = false;
    this.zoom = false;
    this.pick = null;
    this.from = null;
    this.spawning = false;
    this.crewed = new Set();
    this.crewAt = 0;
    this.kills = 0;
    this.deaths = 0;
    this.lastCam = null;
    this.eye = 10;
    this.camBack = 30;
    this.P = { f: 0, s: 0, run: false, crouch: false, jump: false, h: 0, vz: 0, fire: false, zoom: false, spot: null, yaw: 0, dodge: false, dash: null };
    this.spot = { x: 0, y: 0, z: 0, aimZ: 0, hitRadius: 0, kind: 'INFANTRY', dead: true, side: -1, mvx: 0, mvy: 0, mvz: 0, path: [], spot: true };
    this.aim = { x: 0, y: 0, z: 0, aimZ: 0, hitRadius: 0, kind: 'INFANTRY', dead: true, side: -1, mvx: 0, mvy: 0, mvz: 0, path: [], spot: true };
    this.spread = SPREAD.still;
    this.bloom = 0;
    this.los = new WeakMap();
    this.heights = new Map();
    this.blockers = [];
    this.blockersAt = -1;
    this.headUntil = 0;
    this.hurtMarks = [];
    this.bots = new Map();
    this.offsets = new Map();
    this.raw = false;
    this.botAt = 0;
    this.A = { throttle: 0, turn: 0, up: 0, yaw: 0, pitch: 0, v: 0, roll: 0, tilt: 0, boost: false, barrel: null };
    this.gunQ = null;
    this.gunD = null;
    this.post = null;
    this.rideLead = null;
    this.aimHit = null;
    this.stats = { heads: 0, vehicles: 0 };
    this.losses = [];
    this.counted = new WeakSet();
    this.twist = { bone: null, head: null, arms: [], want: 0, pitch: 0, raise: 0, live: [], overlay: false, upper: null, muzzle: null, fixYaw: 0, fixPitch: 0, mask: null, rigid: [], kick: 0 };
    const tk = new URLSearchParams(location.search).get('tickets');
    this.ticketStart = Math.max(1, parseInt(tk, 10) || (+globalThis.shooterTickets >= 50 ? Math.round(+globalThis.shooterTickets) : TICKETS.start));
    this.tickets = game.setup.benchmark ? null : game.factions.map(() => this.ticketStart);
    this.conquest = game.setup.campaign ? { ready: false, pools: new Map(), byUnit: new WeakMap(), crewed: new WeakSet() } : null;
    this.bleedAt = 0;
    this.ticketEl = null;
    if (this.tickets) this.ticketBar();
    this.radarAt = 0;
    this.ended = false;
    this.letters = new Map();
    this.dummyOf = new Map();
    this.remotes = new Map();
    this.peerDealt = new WeakMap();
    this.bornOf = new WeakMap();
    this.kept = new WeakSet();
    this.pendingDummies = [];
    this.rocks = null;
    this.rocksClosed = false;
    this.closedCells = null;
    this.structN = undefined;
    this.even = null;
    this.evenAt = 0;
    this.evened = new WeakSet();
    this.ammoOf = new WeakMap();
    this.ammoAt = new WeakMap();
    this.fpZ = undefined;
    this.dealt = new WeakMap();
    this.assists = 0;
    this.pops = 0;
    this.crouched = false;
    this.throwAt = -9;
    this.benchN = game.setup.benchmark || 0;
    this.watched = null;
    this.watchAt = 0;
    this.watchCam = null;
    this.padWas = [];
    this.padOn = false;
    this.padMove = { f: 0, s: 0, run: false };
    this.tipAt = 0;
    this.tipN = Math.floor(Math.random() * TIPS.length);
    this.hinted = false;
    this.postFx = null;
    this.postReady = false;
    this.postCompiled = false;
    this.lens = null;
    this.focusK = 0;
    this.lastLook = null;
    this.flashes = [];
    this.groundU = [];
    this.boltTint = new Map();
    this.clutterAt = 0;
    this.clutterN = 0;
    this.cluttered = new WeakSet();
    this.wrecks = [];
    this.fxAt = 0;
    this.feel = { u: null, h: 0, v: 0, roll: 0, pitch: 0, phase: 0, step: 0 };
    this.shake = 0;
    this.cockpit = false;
    this.seatBox = { u: null, len: 0, top: 0 };
    this.stomps = new Map();
    this.warnAt = 0;
    this.warning = '';
    this.role = 'trooper';
    this.roles = new Map();
    this.nades = 0;
    this.nadeAt = 0;
    this.nadeW = undefined;
    this.nadeHeld = false;
    this.nadeSpot = { x: 0, y: 0, z: 0, aimZ: 0, hitRadius: 0, kind: 'INFANTRY', dead: true, side: -1, mvx: 0, mvy: 0, mvz: 0, path: [], spot: true };
    this.lockT = null;
    this.lockK = 0;
    this.scopedShots = new WeakSet();
    this.heroAt = HERO.points;
    this.heroSaid = false;
    this.squadSpots = new WeakMap();
    this.ear = { x: 0, y: 0, z: 0, ready: false };
    this.verbIn = null;
    this.verbNode = null;
    this.wet = 0;
    this.wetAt = 0;
    this.whizzed = new WeakSet();
    this.passing = new Set();
    this.whizAt = 0;
    this.strides = new Map();
    this.stepNames = new Map();
    this.teams = [];
    this.teamOf = new Map();
    this.teamN = 0;
    this.directAt = 0;
    this.supp = new Map();
    this.aimOf = new Map();
    this.vstate = new Map();
    this.armorKill = new Map();
    this.ledger = new Map();
    this.names = new Map();
    this.nameCount = [];
    this.feed = [];
    this.history = [];
    this.historyAt = 0;
    this.lowWarned = [];
    this.announces = [];
    this.introAt = 0;
    this.introUntil = 0;
    this.caps = 0;
    this.gun = { kind: 'heat', heat: 0, hot: false, lastShot: -9, per: 0.1, ammo: 0, max: 0, refillAt: 0, kick: KICK.heat };
    this.kickDebt = 0;
    this.pain = 0;
    this.beatAt = 0;
    this.bobPhase = 0;
    this.dip = 0;
    this.smoothZ = null;
    this.fovNow = FOV;
    this.dodgeAt = -9;
    this.healing = false;
    this.regenAt = 0;
    this.matchScore = 0;
    this.sfxCtx = null;
    this.hqs = new Map();
    this.respawns = [];
    this.spawningN = [];
    this.optionsAt = [];
    this.options = [];
    this.respawnAt = 0;
    this.sizes = new Map();
    this.homes = new Map();
    this.fpMuzzleY = FP_MUZZLE_Y;
    this.eyeAt = new THREE.Vector3();
    this.lastOf = new WeakMap();
    this.hitUntil = 0;
    this.killUntil = 0;
    this.hooked = false;
    this.dom();
    this.input();
    this.ov = new Overlord(this);
    if (game.audio) game.audio.falloff = SOUND_FALLOFF;
    setParticleDepth(true);
    game.ground?.traverse?.(o => {
      const U = o.material && o.material.uniforms;
      if (U && U.texU && U.detail) {
        U.detail.value = 1;
        if (U.glowAt) this.groundU.push(U);
      }
    });
    for (let i = 1; i < this.groundU.length; i++) {
      const U = this.groundU[i];
      U.glowAt.value = this.groundU[0].glowAt.value;
      U.glowTint.value = this.groundU[0].glowTint.value;
      U.occAt.value = this.groundU[0].occAt.value;
    }
    const gpuSide = game.gpuOn ? Promise.all([import('../gpu/programs-space.js'), import('../gpu/programs-lens.js')]) : Promise.resolve();
    gpuSide.then(
      () => {
        this.postReady = true;
      },
      () => {
        this.postReady = false;
      }
    );
    document.body.classList.add('shooter-on');
  }

  made(q) {
    if (this.netClient) return;
    this.learnDummy(q);
    if (this.trim(q)) return;
    const u = q.members[0];
    for (const m of q.members) {
      const up = RANGE_UP[m.kind];
      if (!up || q.native || q.side < 0 || q.side === this.world.wild || m.structure || !(m.speed > 0) || m.minRange > 0 || !(m.range >= 60)) continue;
      this.world.addCombatMod(m, MOD.RANGE, MOD_KEY, 'shooter', up);
      const wp = m.weapon,
        plain = !this.antiArmor(m) && !!wp && !(wp.damage > BONUS.damage) && !((wp.recharge || 0) > BONUS.recharge),
        dmg = (plain ? 1 + FOOT_DAMAGE : 1) * this.skill(q.side).damage - 1;
      if (m.kind === 'INFANTRY' && dmg !== 0) this.world.addCombatMod(m, MOD.DAMAGE, MOD_KEY, 'shooter', dmg);
      if (m.kind === 'INFANTRY' && FOOT_FIRE_RATE > 0 && plain) this.world.addCombatMod(m, MOD.FIRE_RATE, MOD_KEY, 'shooter', FOOT_FIRE_RATE);
      if (this.evenStats()) this.evenUnit(m);
    }
    if (!u || q.structure || q.craft || q.native || u.structure || !(u.speed > 0)) return;
    if ((u.kind !== 'VEHICLE' && u.kind !== 'AIR') || u.foot) return;
    if (inCategory(u.type, 'HERO') || isHeroCompany(q.type) || u.type.bool('Is_Named_Hero')) return;
    q.crew = { in: null, claim: null, at: 0, gunner: null, gunClaim: null, gunAt: 0, guns: !!(u.guns && u.guns.length) };
    q.noAI = true;
    this.crewed.add(q);
  }

  isDummy(t) {
    return !!t && !!t.str('Lua_Script') && !/\bSELECTABLE\b/i.test(t.str('LandBehavior') + ' ' + t.str('Behavior'));
  }

  scriptSpawned(q, by) {
    const lead = by.members ? by.members[0] : by,
      t = by.scriptType || (lead && lead.type) || by.type;
    if (!this.isDummy(t)) return;
    this.bornOf.set(q, { t, by: by.squad || by });
    if (q.members[0]) this.learnDummy(q);
  }

  learnDummy(q) {
    const b = this.bornOf.get(q),
      m = q.members[0];
    if (!b || !m || b.done) return;
    b.done = true;
    if (m.structure) return;
    const C = this.conquest,
      byGid = C && (C.byUnit.get(b.by.members?.[0]) || C.byUnit.get(b.by));
    if (byGid) C.byUnit.set(m, byGid);
    let L = this.dummyOf.get(b.t);
    if (!L) this.dummyOf.set(b.t, (L = new Map()));
    L.set(m.type, (L.get(m.type) || 0) + 1);
    const now = this.world.time;
    this.pendingDummies = this.pendingDummies.filter(p => now < p.until);
    const p = this.pendingDummies.find(p => p.take && p.by === b.by);
    if (p) {
      const take = p.take;
      p.take = null;
      this.kept.add(q);
      take(q);
    }
  }

  realTypes(t) {
    const L = this.dummyOf.get(t);
    return L && L.size ? [...L.keys()] : null;
  }

  realOf(t) {
    const L = this.dummyOf.get(t);
    if (!L || !L.size) return null;
    let best = null,
      bn = -1;
    for (const [k, n] of L) if (n > bn) {
      bn = n;
      best = k;
    }
    return best;
  }

  cardName(c) {
    return c.dummy && c.unit === c.dummy ? this.nameOf(c.company) : this.nameOf(c.unit);
  }

  trim(q) {
    const w = this.world,
      m = q.members[0];
    if (this.spawning || this.kept.has(q) || !m || q.side < 0 || q.side === w.wild || q.native || q.structure || m.structure || !(m.speed > 0)) return false;
    if (m.foot) {
      if (this.popUsed(q.side) <= this.fieldCap(q.side)) return false;
    } else {
      if (this.conquest || (m.kind !== 'VEHICLE' && m.kind !== 'AIR')) return false;
      if (inCategory(m.type, 'HERO') || m.type.bool('Is_Named_Hero')) return false;
      let n = 0;
      for (const u of w.units) if (!u.dead && !u.gone && u.side === q.side && !u.foot && !u.structure && u.speed > 0 && (u.kind === 'VEHICLE' || u.kind === 'AIR') && !u.squad?.native) n++;
      if (n <= BOT_RESPAWN.maxVehicles) return false;
    }
    q.scriptDespawned = true;
    q.forming = false;
    for (const u of q.members) {
      u.dead = u.gone = true;
      u.health = 0;
      u.target = null;
      w.unstamp(u);
      if (u.holder) w.scene.remove(u.holder);
    }
    q.members.length = 0;
    return true;
  }

  evenStats() {
    if (this.even) return this.even;
    if (this.world.time < (this.evenAt || 0)) return null;
    this.evenAt = this.world.time + 1;
    const n = this.game.factions.length,
      base = [];
    for (let s = 0; s < n; s++) {
      if (this.world.beaten.has(this.world.team[s])) continue;
      const cls = this.classes(s);
      let best = null;
      for (const c of cls) {
        const t = c.unit;
        if (c.hero || c.heroSpawn || !/infantry/i.test(t.str('MovementClass')) || this.roleOf(c, cls) === 'rocket') continue;
        if (!(t.num('Targeting_Max_Attack_Distance', 0) >= EVEN.minRange) || !(t.num('Tactical_Health', 0) > 0)) continue;
        if (!best || c.cost < best.cost) best = c;
      }
      if (!best) return null;
      if (!base.includes(best.unit)) base.push(best.unit);
    }
    if (base.length < 2) return null;
    const mean = f => base.reduce((a, t) => a + f(t), 0) / base.length,
      H = mean(t => t.num('Tactical_Health', 0)),
      R = mean(t => t.num('Targeting_Max_Attack_Distance', 0));
    this.even = new Map(base.map(t => [t, { h: H / t.num('Tactical_Health', 1), r: R / t.num('Targeting_Max_Attack_Distance', 1) }]));
    for (const u of this.world.units) if (!u.dead) this.evenUnit(u);
    return this.even;
  }

  evenUnit(u) {
    const e = this.even && this.even.get(u.type);
    if (!e || this.evened.has(u) || u.dead) return;
    this.evened.add(u);
    const w = this.world;
    if (Math.abs(e.h - 1) > 1e-3) {
      const was = u.maxHealth > 0 ? u.health / u.maxHealth : 1;
      w.addCombatMod(u, MOD.HEALTH, EVEN.key, EVEN.source, e.h - 1);
      if (u.maxHealth > 0) u.health = Math.min(u.maxHealth, u.maxHealth * was);
    }
    if (Math.abs(e.r - 1) > 1e-3) w.addCombatMod(u, MOD.RANGE, EVEN.key, EVEN.source, (1 + (RANGE_UP[u.kind] || 0)) * (e.r - 1));
  }

  respawnDelay(side) {
    const w = this.world;
    let own = 0,
      foe = 0;
    for (const p of w.points) {
      if (!p.reinforce || p.side < 0) continue;
      if (w.ally(p.side, side)) own++;
      else foe++;
    }
    return own < foe ? CATCHUP.delay : BOT_RESPAWN.delay;
  }

  reachOfClass(c) {
    return c.unit.num('Targeting_Max_Attack_Distance', 0) || this.statsOf(c).range || 0;
  }

  rocketsLeft(u) {
    if (!this.antiArmor(u) || !this.aiShooter(u)) return Infinity;
    const n = this.ammoOf.get(u);
    return n === undefined ? AMMO.rocket : n;
  }

  shotFired(s) {
    const u = s.from;
    if (!u || u.dead || s.w !== u.weapon || !this.antiArmor(u) || !this.aiShooter(u)) return;
    this.ammoOf.set(u, Math.max(0, this.rocketsLeft(u) - 1));
  }

  reach(u) {
    if (this.body && (u === this.body || (this.rideQ && u.squad === this.rideQ))) return REACH;
    return u.kind === 'INFANTRY' || u.kind === 'VEHICLE' ? STRAY : 0;
  }

  parked(u, dt) {
    const w = this.world;
    u.path.length = 0;
    u.target = null;
    u.v = 0;
    w.setAnim(u, 'idle');
    if (!u.flies) u.z = u.scriptZ ?? heightAt(w.terrain, u.x, u.y) + u.lift + u.hoverZ;
    else {
      const g = heightAt(w.terrain, u.x, u.y) + Math.min(u.lift || 0, 6);
      u.z = u.z > g ? Math.max(g, u.z - 50 * dt) : g;
    }
    u.holder.position.set(u.x, u.y, u.z);
    u.holder.rotation.z = u.heading + Math.PI / 2;
    w.show(u, dt);
  }

  pilotStep(u, dt) {
    if (u.pilot === this.A) return this.airStep(u, dt);
    const w = this.world,
      P = u.pilot;
    u.path.length = 0;
    u.target = null;
    let f = P.f,
      s = P.s;
    const l = Math.hypot(f, s);
    if (l > 1) {
      f /= l;
      s /= l;
    }
    const aiming = P.fire || P.zoom;
    const sp = u.speed * (P.run && f > 0 && !aiming ? 1.7 : aiming ? ADS_SPEED : 1) * (P.crouch ? 0.45 : 1),
      cy = Math.cos(P.yaw),
      sy = Math.sin(P.yaw),
      need = (u.need & ~3) | 1;
    let dx = (cy * f + sy * s) * sp * dt,
      dy = (sy * f - cy * s) * sp * dt;
    if (P.dodge) {
      P.dodge = false;
      if (w.time >= this.dodgeAt + DODGE.cool && P.h <= 0) {
        this.dodgeAt = w.time;
        const l = Math.hypot(f, s) || 1,
          mf = f || s ? f / l : 0,
          ms = f || s ? s / l : 1;
        P.dash = { t: DODGE.time, x: cy * mf + sy * ms, y: sy * mf - cy * ms };
        this.dip = Math.max(this.dip, this.eye * 0.35);
      }
    }
    if (P.dash) {
      const v = u.speed * DODGE.speed * dt;
      dx = P.dash.x * v;
      dy = P.dash.y * v;
      if ((P.dash.t -= dt) <= 0) P.dash = null;
    }
    let go = 0;
    if (dx || dy) {
      const x0 = u.x,
        y0 = u.y;
      if (this.walkable(u.x + dx, u.y, need)) u.x += dx;
      if (this.walkable(u.x, u.y + dy, need)) u.y += dy;
      go = Math.hypot(u.x - x0, u.y - y0);
    }
    {
      const fp = this.third === false;
      let want = P.yaw;
      if (go) {
        const md = Math.atan2(dy, dx),
          rel = wrap(md - P.yaw);
        want = aiming || fp ? (Math.abs(rel) > 2.2 ? P.yaw : P.yaw + Math.max(-1, Math.min(1, rel))) : md;
      }
      const da = wrap(want - u.heading),
        st = 10 * dt;
      u.heading += Math.abs(da) <= st ? da : Math.sign(da) * st;
      this.twist.want = aiming || fp ? Math.max(-1.1, Math.min(1.1, wrap(P.yaw - u.heading))) : 0;
      this.twist.pitch = aiming || fp ? Math.max(AIM_PITCH.min, Math.min(AIM_PITCH.max, this.pitch)) : 0;
      this.twist.raise = fp ? AIM_PITCH.raise : 0;
    }
    if (P.jump && P.h <= 0) P.vz = JUMP;
    P.jump = false;
    if (P.h > 0 || P.vz > 0) {
      P.vz -= GRAVITY * dt;
      P.h = Math.max(0, P.h + P.vz * dt);
      if (P.h <= 0) {
        this.dip = Math.max(this.dip, Math.min(this.eye * 0.3, -P.vz * 0.03));
        P.vz = 0;
      }
    }
    u.z = heightAt(w.terrain, u.x, u.y) + P.h;
    u.v = dt > 0 ? go / dt : 0;
    const wpn = u.weapon;
    let shooting = false;
    const S = SPREAD,
      want = (P.h > 0 ? S.air : P.run && go ? S.run : go ? S.walk : S.still) * (P.crouch ? S.crouch : 1) * (P.zoom ? (this.role === 'scout' ? SCOPE.spread : S.zoom) : 1);
    if (wpn) {
      wpn.cooldown -= dt;
      if (P.fire && P.spot && this.canFire()) {
        shooting = true;
        this.jitter(u);
        const L = this.lockK >= 1 && this.lockT && !this.lockT.dead ? this.lockT : null;
        w.burst(u, L || this.spot, wpn, dt);
      } else if (P.fire && !this.canFire()) this.denied();
    }
    this.bloom = Math.max(0, Math.min(S.max, this.bloom + (shooting ? S.bloom : -S.cool) * dt));
    this.spread += (want + this.bloom - this.spread) * Math.min(1, dt * 8);
    const has = K => animReady(u.type, K),
      fp = this.third === false;
    let kind;
    this.twist.overlay = ((go && (shooting || aiming)) || fp) && !(go && has('FIRE_MOVE')) && has('ATTACKIDLE');
    if (go) kind = shooting || aiming ? (has('FIRE_MOVE') ? 'FIRE_MOVE' : has('WALKMOVE') ? 'WALKMOVE' : 'move') : P.crouch && has('CROUCHMOVE') ? 'CROUCHMOVE' : 'move';
    else if (shooting) kind = 'attack';
    else if (aiming || fp) kind = has('ATTACKIDLE') ? 'attack' : 'idle';
    else kind = P.crouch && has('CROUCHIDLE') ? 'CROUCHIDLE' : 'idle';
    w.setAnim(u, kind);
    if (go) w.moveRate(u);
    u.holder.position.set(u.x, u.y, u.z);
    u.holder.rotation.z = u.heading + Math.PI / 2;
    w.show(u, dt);
  }

  spend(side, n, u = null) {
    const T = this.tickets,
      w = this.world,
      C = this.conquest;
    if (C?.ready) {
      if (u) {
        const P = C.pools.get(C.byUnit.get(u));
        if (P && P.lives > 0) P.lives--;
      } else {
        let best = null;
        for (const P of C.pools.values()) if (P.side === side && P.lives > 0 && (!best || P.lives > best.lives)) best = P;
        if (best) best.lives = Math.max(0, best.lives - n);
      }
      this.conquestTally();
      return;
    }
    if (!T || T[side] <= 0) return;
    this.setTickets(side, Math.max(0, T[side] - n));
  }

  ticketTeam(s) {
    const t = this.world.team?.[s];
    return t === undefined ? 's' + s : t;
  }

  setTickets(side, v) {
    const k = this.ticketTeam(side);
    for (let s = 0; s < this.tickets.length; s++) if (this.ticketTeam(s) === k) this.tickets[s] = v;
  }

  teamTickets() {
    const T = this.tickets,
      g = this.game,
      out = [],
      seen = new Map();
    if (!T) return out;
    for (let s = 0; s < T.length; s++) {
      const k = this.ticketTeam(s);
      let e = seen.get(k);
      if (!e) {
        e = { team: k, side: s, names: [], t: T[s], mine: false };
        seen.set(k, e);
        out.push(e);
      }
      const n = String(g.factions[s] || 'Side ' + s);
      if (!e.names.includes(n)) e.names.push(n);
      if (s === this.me) e.mine = true;
    }
    for (const e of out) e.label = e.names.join(' / ');
    return out;
  }

  warnLow() {
    const w = this.world;
    for (const e of this.teamTickets()) {
      const key = 't' + e.team;
      if (this.lowWarned[key] || e.t > this.ticketStart * LOW_TICKETS) continue;
      this.lowWarned[key] = true;
      const ours = w.ally(e.side, this.me) || e.mine;
      this.announce(ours ? 'Our reinforcements are running low' : 'Enemy reinforcements are running low', ours ? 'bad' : 'good');
    }
  }

  nominalSoldiers(t, depth = 0) {
    const list = t.list('Company_Units');
    if (!list.length || depth > 3) return 1;
    let n = 0;
    for (const name of list) {
      const k = db.type(name);
      if (!k || inCategory(k, 'HERO') || k.bool('Is_Named_Hero')) continue;
      n += k.has('Company_Units') ? this.nominalSoldiers(k, depth + 1) : Math.max(1, k.list('Squad_Units').length || 1);
    }
    return Math.max(1, n);
  }

  leafTypes(t, depth = 0) {
    const out = [];
    for (const name of t.list('Company_Units')) {
      const k = db.type(name);
      if (!k) continue;
      if (k.has('Company_Units') && depth < 3) out.push(...this.leafTypes(k, depth + 1));
      else out.push(k);
    }
    return out;
  }

  conquestSetup() {
    const C = this.conquest,
      cb = this.game.setup.campaign,
      book = this.game.invasionBook;
    if (!C || C.ready || !cb || !book || book.pending) return;
    const mult = +globalThis.shooterConquest > 0 ? +globalThis.shooterConquest : CONQUEST.mult;
    for (const sideRec of [cb.attacker, cb.defender]) {
      for (const rec of sideRec.units || []) {
        const t = db.type(rec.type);
        if (!t || isHeroCompany(t)) continue;
        const leaves = this.leafTypes(t).filter(k => /infantry/i.test(k.str('MovementClass')) && !inCategory(k, 'HERO') && !k.bool('Is_Named_Hero'));
        if (!leaves.length) continue;
        const real = leaves.map(k => (this.isDummy(k) ? this.realOf(k) || k : k));
        const size = this.nominalSoldiers(t);
        C.pools.set(rec.gid, { gid: rec.gid, side: sideRec.side, type: t, units: real, dummy: this.isDummy(leaves[0]) ? leaves[0] : null, lives: Math.round(size * mult), size, alive: 0, pending: 0 });
      }
    }
    C.ready = true;
    C.start = new Map();
    this.conquestMap();
    this.conquestTally();
    for (let s = 0; s < this.tickets.length; s++) C.start.set(s, this.tickets[s]);
    this.ticketStart = Math.max(1, ...this.tickets);
    this.crewVehicles();
  }

  claimFor(q, gid) {
    const C = this.conquest;
    if (!C) return;
    const P = C.pools.get(gid);
    for (const m of q.mates ? q.mates.flatMap(x => x.members) : q.members)
      if (!C.byUnit.has(m)) {
        C.byUnit.set(m, gid);
        if (P && !m.dead) P.alive++;
      }
  }

  conquestMap() {
    const C = this.conquest,
      book = this.game.invasionBook;
    if (!C?.ready || !book) return;
    for (const [gid, squads] of book.companies) {
      if (!C.pools.has(gid)) continue;
      for (const q of squads || []) for (const m of q.members) if (!C.byUnit.has(m)) C.byUnit.set(m, gid);
    }
  }

  conquestTally() {
    const C = this.conquest,
      w = this.world,
      T = this.tickets;
    if (!C?.ready || !T) return;
    for (const P of C.pools.values()) P.alive = 0;
    const cars = new Map();
    for (const u of w.units) {
      if (u.dead || u.gone) continue;
      const P = C.pools.get(C.byUnit.get(u));
      if (P) P.alive++;
      else if (u.squad && this.crewed.has(u.squad) && u === u.squad.members[0] && u.side >= 0) cars.set(u.side, (cars.get(u.side) || 0) + 1);
    }
    const cb = this.game.setup.campaign,
      teams = new Set([this.ticketTeam(cb.attacker.side), this.ticketTeam(cb.defender.side)]),
      sum = new Map();
    for (let s = 0; s < T.length; s++) {
      const k = this.ticketTeam(s);
      if (!teams.has(k)) continue;
      let n = cars.get(s) || 0;
      for (const P of C.pools.values()) if (P.side === s) n += P.lives;
      sum.set(k, (sum.get(k) || 0) + n);
    }
    for (let s = 0; s < T.length; s++) if (sum.has(this.ticketTeam(s))) T[s] = sum.get(this.ticketTeam(s));
  }

  conquestClasses(side) {
    const C = this.conquest,
      out = [];
    if (!C?.ready) return out;
    for (const P of C.pools.values()) {
      if (P.side !== side) continue;
      const spare = Math.min(P.lives, P.size) - P.alive - P.pending;
      if (spare <= 0) continue;
      const k = P.units[0];
      out.push({ company: P.type, unit: k, units: P.units, foot: true, cost: 0, gid: P.gid, spare, dummy: P.dummy });
    }
    return out;
  }

  crewType(side) {
    const C = this.conquest;
    for (const P of C?.pools.values() || []) if (P.side === side && P.units[0]) return P.units[0];
    const faction = String(this.game.factions[side] || '').toUpperCase();
    let best = null,
      bc = Infinity;
    for (const t of db.types.values()) {
      if (!t || !t.str || !t.has('Company_Units') || isHeroCompany(t)) continue;
      const aff = t.list('Affiliation').map(a => a.toUpperCase());
      if (!aff.includes(faction)) continue;
      const k = this.leafTypes(t).find(x => /infantry/i.test(x.str('MovementClass')) && !inCategory(x, 'HERO') && !x.bool('Is_Named_Hero') && !this.isDummy(x));
      if (!k) continue;
      const c = costOf(t, this.game.factions[side]) || 0;
      if (c < bc) {
        bc = c;
        best = k;
      }
    }
    return best;
  }

  async crewVehicles() {
    const C = this.conquest,
      w = this.world;
    if (!C) return;
    let n = 0;
    for (const q of [...this.crewed]) {
      const v = q.members[0];
      if (!v || v.dead || q.crew.in || C.crewed.has(q) || q.side < 0 || n >= CONQUEST.crewMax) continue;
      C.crewed.add(q);
      const t = this.crewType(q.side);
      if (!t) continue;
      n++;
      this.spawning = true;
      const sq = await w.spawn(t.name, v.x, v.y, v.heading, q.side);
      this.spawning = false;
      const u = sq && sq.members[0];
      if (!u || v.dead || q.crew.in) {
        if (u) this.trimNow(sq);
        continue;
      }
      this.board(u, q);
    }
  }

  trimNow(q) {
    const w = this.world;
    for (const u of q.members) {
      u.dead = u.gone = true;
      u.health = 0;
      if (u.holder) w.scene.remove(u.holder);
    }
    q.members.length = 0;
  }

  netClassRows() {
    const C = this.conquest,
      out = {};
    if (!C?.ready) return null;
    for (const P of C.pools.values()) {
      const spare = Math.min(P.lives, P.size) - P.alive - P.pending;
      if (spare <= 0 || !P.units[0]) continue;
      (out[P.side] ||= []).push([P.type.name, P.units[0].name, spare, P.gid]);
    }
    return out;
  }

  conquestHolds(winner) {
    const C = this.conquest,
      cb = this.game.setup.campaign;
    if (!C?.ready || winner === null || winner === undefined) return false;
    const loser = winner === cb.attacker.side ? cb.defender.side : cb.attacker.side;
    for (const P of C.pools.values()) if (P.side === loser && P.lives > P.alive && this.points(loser).length) return true;
    return false;
  }

  conquestOutcome(out) {
    const C = this.conquest;
    if (!C?.ready || !out || !Array.isArray(out.alive)) return;
    const alive = new Set(out.alive);
    for (const P of C.pools.values()) {
      if (P.lives > 0) alive.add(P.gid);
      else alive.delete(P.gid);
    }
    out.alive = [...alive];
  }

  lastStand() {
    const T = this.tickets,
      w = this.world;
    if (!T) return;
    for (let side = 0; side < T.length; side++) {
      if (T[side] > 0) continue;
      const team = w.team[side];
      if (team === undefined || w.beaten.has(team)) continue;
      if (T.some((t, s) => s !== side && w.team[s] === team && t > 0)) continue;
      const standing = w.units.some(u => !u.dead && !u.gone && u.side >= 0 && w.team[u.side] === team && !u.structure && u.speed > 0 && !u.squad?.native);
      const landing = w.transports.some(t => t.stage === 'land' && w.team[t.side] === team);
      if (standing || landing || (this.spawningN[side] || 0) > 0) continue;
      this.beat(team);
    }
  }

  beat(team) {
    const w = this.world;
    if (team === undefined || w.beaten.has(team)) return;
    w.beaten.add(team);
    const left = [...new Set(w.team.slice(0, w.playerSides ?? w.team.length))].filter(t => !w.beaten.has(t));
    if (left.length <= 1) {
      w.loser = team;
      w.winner = left[0] ?? -1;
    }
  }

  bleed() {
    const w = this.world,
      pts = w.points.filter(p => !p.locked);
    if (!pts.length) return;
    const held = new Map();
    for (const p of pts) if (p.side >= 0) held.set(w.team[p.side], (held.get(w.team[p.side]) || 0) + 1);
    for (const [team, n] of held) {
      if (n * 2 <= pts.length) continue;
      const done = new Set();
      for (let s = 0; s < this.tickets.length; s++) {
        const k = this.ticketTeam(s);
        if (w.team[s] === team || done.has(k) || this.tickets[s] <= 0) continue;
        done.add(k);
        this.spend(s, 1);
      }
    }
  }

  ticketBar() {
    const e = (this.ticketEl = document.createElement('div'));
    e.className = 'sh-tickets eaw-frame-s';
    document.body.appendChild(e);
  }

  drawTickets() {
    if (!this.ticketEl) return;
    const T = this.teamTickets(),
      key = T.map(e => `${e.mine ? 1 : 0}${e.label}:${e.t}`).join('|');
    if (this.ticketKey === key) return;
    this.ticketKey = key;
    this.ticketEl.replaceChildren(
      ...T.map(e => {
        const sp = document.createElement('span'),
          b = document.createElement('b');
        if (e.mine) sp.className = 'mine';
        sp.textContent = e.label;
        b.textContent = String(e.t);
        sp.appendChild(b);
        return sp;
      })
    );
  }

  skill(side) {
    if (side === this.me || this.world.ally(side, this.me)) return SKILL.normal;
    const d = String(this.game.players[side]?.difficulty || 'normal').toLowerCase();
    return /easy/.test(d) ? SKILL.easy : /hard/.test(d) ? SKILL.hard : SKILL.normal;
  }

  hook() {
    const w = this.world,
      order = w.order,
      advance = w.advance;
    w.advance = sq => {
      if (this.isBot(sq) && this.bots.has(sq.members[0])) {
        sq.advance = w.time + 1.5;
        return;
      }
      return advance.call(w, sq);
    };
    w.order = (sq, x, y, facing = null, exact = false) => {
      if (!this.raw && sq.crew) {
        const vs = this.vstate.get(sq);
        if (vs && w.time < vs.halt) {
          vs.later = [x, y];
          return true;
        }
      }
      if (!this.raw && this.isBot(sq)) {
        if (this.teamOf.has(sq.members[0])) return true;
        const st = this.bots.get(sq.members[0]);
        if (st && (st.mode === 'cover' || st.mode === 'fight' || st.mode === 'retreat') && w.time < st.until) {
          st.later = [x, y, facing, exact];
          return true;
        }
        const u = sq.members[0];
        if (!exact && Math.hypot(x - u.x, y - u.y) > SPREAD_OUT.far) {
          let o = this.offsets.get(sq);
          if (!o) {
            const r = SPREAD_OUT.min + Math.random() * (SPREAD_OUT.max - SPREAD_OUT.min),
              a = Math.random() * Math.PI * 2;
            this.offsets.set(sq, (o = { x: Math.cos(a) * r, y: Math.sin(a) * r }));
          }
          const p = w.nearestOpen(x + o.x, y + o.y, (u.need & ~3) | 1);
          if (p) {
            x = p.x;
            y = p.y;
          }
        }
      }
      return order.call(w, sq, x, y, facing, exact);
    };
  }

  isBot(sq) {
    const u = sq && sq.members.length === 1 ? sq.members[0] : null;
    return !!u && (u.kind === 'INFANTRY' || (u.foot && !u.structure)) && !u.pilot && !u.inside && u.speed > 0 && sq.side >= 0 && sq.side !== this.world.wild && !sq.native && !sq.direct && !sq.noAI;
  }

  send(sq, x, y, face, hold) {
    const w = this.world,
      L = sq.members[0],
      need = L ? (L.need & ~3) | 1 : 1,
      straight = !L || L.flies || (w.clear(L.x, L.y, x, y, need) && this.lineOk(L, x, y, need));
    this.raw = true;
    let r;
    try {
      r = w.order(sq, x, y, face, straight);
    } finally {
      this.raw = false;
    }
    sq.clearGo = this.world.time + hold;
    const u = sq.members[0];
    if (!u || r === false) return false;
    return u.path.length > 0 || !!(sq.box && !sq.ext && sq.box.path && sq.box.path.length) || Math.hypot(x - u.x, y - u.y) < 12;
  }

  canGo(T, p) {
    return !p || !(T.avoid && T.avoid.get(p) > this.world.time);
  }

  giveUp(T) {
    const now = this.world.time;
    if (T.post) (T.avoid ||= new Map()).set(T.post, now + STALL.avoid);
    if (T.role === 'push') T.pushFoe = now + STALL.avoid;
    const live = T.mates.filter(m => !m.dead && m !== T.lead);
    if (live.length) T.lead = live[Math.floor(Math.random() * live.length)];
    T.post = null;
    T.prey = null;
    T.role = '';
    T.spot = null;
    T.fails = 0;
    T.sAt = now;
    T.moveAt = now + 1;
  }

  fake(at, like) {
    return { x: at.x, y: at.y, z: heightAt(this.world.terrain, at.x, at.y), kind: like.kind, type: like.type, holder: like.holder, aimZ: like.aimZ, hitRadius: like.hitRadius, flies: false };
  }

  think() {
    const w = this.world,
      now = w.time;
    for (const [u, st] of this.bots) if (u.dead || u.gone) this.bots.delete(u);
    for (const sq of w.squads) {
      if (!this.isBot(sq)) continue;
      const u = sq.members[0];
      let st = this.bots.get(u);
      if (!st) this.bots.set(u, (st = this.newBot(now + Math.random() * 1.5)));
      const box = sq.box && !sq.ext ? sq.box : null,
        walking = u.path.length > 0 || (!!box && box.path.length > 0);
      if (!walking && now >= (st.unstickAt || 0)) {
        st.unstickAt = now + 2;
        const need = (u.need & ~3) | 1;
        if (!w.isOpen(u.x, u.y, need) || this.inWall(u.x, u.y)) {
          const o = this.outOfWall(u, need) || w.nearestOpen(u.x, u.y, need);
          if (o && Math.hypot(o.x - u.x, o.y - u.y) < 60) {
            u.x = o.x;
            u.y = o.y;
            u.z = heightAt(w.terrain, u.x, u.y);
            if (u.holder) u.holder.position.set(u.x, u.y, u.z);
          }
        }
      }
      if (st.mode === 'retreat') {
        if ((u.health >= u.maxHealth * RETREAT.until && this.rocketsLeft(u) >= AMMO.rocket) || now >= st.until) st.mode = '';
        else {
          if (!walking && !this.inHealZone(u) && now >= st.retryAt) {
            st.retryAt = now + 2;
            const h = this.healSpot(u);
            if (h) this.send(sq, h.x, h.y, null, 1);
          }
          continue;
        }
      } else if ((u.health < u.maxHealth * RETREAT.below || this.rocketsLeft(u) <= 0) && now >= st.retreatAt && !this.inHealZone(u)) {
        const h = this.healSpot(u);
        if (h && Math.hypot(h.x - u.x, h.y - u.y) > 80) {
          st.mode = 'retreat';
          st.until = now + RETREAT.time;
          st.retreatAt = now + RETREAT.time + 10;
          st.later = null;
          st.resume = null;
          u.target = null;
          this.send(sq, h.x, h.y, null, 1);
          continue;
        }
      }
      if (st.mode === 'cover') {
        if (now < st.until) continue;
        st.mode = '';
        const L = st.later;
        st.later = null;
        if (L) w.order(sq, L[0], L[1], L[2], L[3]);
      }
      if (now >= (st.scan || 0)) {
        st.scan = now + ENGAGE_SCAN + Math.random() * 0.15;
        if (this.combat(sq, u, st, now)) {
          st.idleSince = now;
          if (this.stuck(u, st, now) && this.reposition(sq, u, st, u.target, now)) continue;
        }
        else if (st.mode === 'fight' && (st.calmAt = st.calmAt || now + CALM.end) <= now) {
          st.calmAt = 0;
          st.mode = '';
          const L = st.later || (st.resume ? [st.resume.x, st.resume.y, null, false] : null);
          st.later = null;
          st.resume = null;
          if (sq.foe && (!sq.foe.members.length || !sq.foe.members.some(m => !m.dead))) sq.foe = null;
          if (L) {
            w.order(sq, L[0], L[1], L[2], L[3]);
            continue;
          }
        }
      }
      if (st.mode !== 'fight' && !walking && !u.target && !sq.aiPlan && !this.teamOf.has(u)) {
        st.idleSince ??= now;
        if (now - st.idleSince > IDLE_GO) {
          st.idleSince = now + 4;
          const goal = this.objective(u);
          if (goal) {
            w.order(sq, goal.x, goal.y);
            continue;
          }
        }
      } else st.idleSince = now;
      const t = u.target;
      if (!t || t.dead || u.path.length || now < st.next) continue;
      const K = this.skill(sq.side);
      if (((now - (u.lastHit ?? -9) < COVER.hurt && u.health < u.maxHealth * COVER.health) || this.suppressed(u) > SUPP.cover) && now >= st.covered && Math.random() < K.cover) {
        st.covered = now + 12;
        const spot = this.cover(u, t);
        if (spot) {
          const d = Math.hypot(spot.x - u.x, spot.y - u.y),
            go = d / Math.max(10, u.speed) + 0.4;
          st.mode = 'cover';
          st.until = now + go + COVER.hold[0] + Math.random() * (COVER.hold[1] - COVER.hold[0]);
          st.next = st.until;
          this.send(sq, spot.x, spot.y, Math.atan2(t.y - spot.y, t.x - spot.x), go + 0.3);
          continue;
        }
      }
      st.next = now + HOP.every[0] + Math.random() * (HOP.every[1] - HOP.every[0]);
      if (Math.random() >= K.strafe) continue;
      const side = Math.atan2(t.y - u.y, t.x - u.x) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2,
        r = HOP.min + Math.random() * (HOP.max - HOP.min),
        x = u.x + Math.cos(side) * r,
        y = u.y + Math.sin(side) * r;
      if (!w.isOpen(x, y, (u.need & ~3) | 1)) continue;
      if (!this.lineClear(this.fake({ x, y }, u), t)) continue;
      this.send(sq, x, y, Math.atan2(t.y - y, t.x - x), r / Math.max(10, u.speed) + 0.3);
    }
    this.march();
    this.drivers();
  }

  spreadOut(dt) {
    const w = this.world,
      C = SEP.min * 2,
      grid = (this.sepGrid ||= new Map()),
      list = [];
    grid.clear();
    for (const u of w.units) {
      if (u.dead || u.inside || !u.foot || u.structure || u.flies || u.speed <= 0) continue;
      const k = Math.floor(u.x / C) * 4096 + Math.floor(u.y / C);
      let b = grid.get(k);
      if (!b) grid.set(k, (b = []));
      b.push(u);
      list.push(u);
    }
    const step = SEP.speed * dt;
    for (const u of list) {
      if (u === this.body || u.v > 2 || !this.isBot(u.squad)) continue;
      const gx = Math.floor(u.x / C),
        gy = Math.floor(u.y / C);
      let px = 0,
        py = 0;
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const b = grid.get((gx + i) * 4096 + gy + j);
          if (!b) continue;
          for (const o of b) {
            if (o === u) continue;
            const want = Math.max(SEP.min, ((u.hitRadius || 0) + (o.hitRadius || 0)) * SEP.gap),
              dx = u.x - o.x,
              dy = u.y - o.y,
              d2 = dx * dx + dy * dy;
            if (d2 >= want * want) continue;
            const d = Math.sqrt(d2);
            if (d < 1e-3) {
              const a = (u.uid || 0) * 2.399;
              px += Math.cos(a);
              py += Math.sin(a);
            } else {
              const f = (want - d) / want;
              px += (dx / d) * f;
              py += (dy / d) * f;
            }
          }
        }
      const m = Math.hypot(px, py);
      if (m < 1e-3) continue;
      const k = Math.min(step, step * m) / m,
        nx = u.x + px * k,
        ny = u.y + py * k,
        need = (u.need & ~3) | 1;
      if (!this.footOk(u, nx, ny, need)) continue;
      const sq = u.squad,
        box = sq && sq.box && !sq.ext ? sq.box : null;
      if (box && box.path && box.path.length) continue;
      const ddx = nx - u.x,
        ddy = ny - u.y;
      u.x = nx;
      u.y = ny;
      if (box) {
        box.x += ddx;
        box.y += ddy;
      }
    }
  }

  stuck(u, st, now) {
    const t = u.target;
    if (!t || t.dead || now < st.reposAt || st.mode !== 'fight') return false;
    if (st.fAt < 0 || Math.hypot(u.x - st.fx, u.y - st.fy) > REPOS.moved) {
      st.fx = u.x;
      st.fy = u.y;
      st.fAt = now;
    }
    if (st.groundHits >= REPOS.hits) return true;
    return now - st.fAt > REPOS.still && now - st.hitAt > REPOS.still;
  }

  reposition(sq, u, st, t, now) {
    const w = this.world,
      need = (u.need & ~3) | 1,
      base = Math.atan2(t.y - u.y, t.x - u.x);
    st.reposAt = now + REPOS.wait;
    st.groundHits = 0;
    st.fAt = -1;
    let best = null;
    for (const r of REPOS.rings) {
      for (const da of REPOS.turns) {
        const a = base + da,
          x = u.x + Math.cos(a) * r,
          y = u.y + Math.sin(a) * r;
        if (!w.isOpen(x, y, need) || !this.lineClear(this.fake({ x, y }, u), t)) continue;
        best = { x, y };
        break;
      }
      if (best) break;
    }
    if (!best) {
      const d = Math.hypot(t.x - u.x, t.y - u.y),
        k = Math.min(0.45, 90 / Math.max(1, d)),
        o = w.nearestOpen(u.x + (t.x - u.x) * k, u.y + (t.y - u.y) * k, need);
      if (!o) return false;
      best = o;
    }
    const go = Math.hypot(best.x - u.x, best.y - u.y) / Math.max(10, u.speed) + 0.5;
    st.next = now + go + 0.5;
    st.chaseTo = best;
    if (st.mode === 'cover') st.mode = 'fight';
    this.send(sq, best.x, best.y, Math.atan2(t.y - best.y, t.x - best.x), go);
    const m = this.los.get(u);
    if (m) m.delete(t);
    return true;
  }

  shotLanded(s) {
    const f = s.from;
    if (!f || f.side < 0 || !s.target || s.target.spot) return;
    const st = this.bots.get(f);
    if (!st) return;
    if (s.struck) {
      if (s.struck === s.target || !s.struck.structure) {
        st.groundHits = 0;
        st.hitAt = this.world.time;
      }
      return;
    }
    const t = s.target;
    if (t.dead || t.x === undefined) return;
    if (Math.hypot(s.x - t.x, s.y - t.y) > 25 && Math.hypot(s.x - f.x, s.y - f.y) < Math.hypot(t.x - f.x, t.y - f.y)) st.groundHits++;
  }

  roleMark(x, cx, cy, role, r, col) {
    x.save();
    x.translate(cx, cy);
    x.lineWidth = Math.max(1.2, r * 0.28);
    x.strokeStyle = col;
    x.fillStyle = col;
    x.beginPath();
    if (role === 'defend') {
      x.moveTo(0, -r);
      x.lineTo(r * 0.85, -r * 0.6);
      x.lineTo(r * 0.7, r * 0.25);
      x.lineTo(0, r);
      x.lineTo(-r * 0.7, r * 0.25);
      x.lineTo(-r * 0.85, -r * 0.6);
      x.closePath();
      x.stroke();
    } else if (role === 'hunt') {
      x.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      x.moveTo(-r, 0);
      x.lineTo(r, 0);
      x.moveTo(0, -r);
      x.lineTo(0, r);
      x.stroke();
    } else if (role === 'attack') {
      x.moveTo(-r * 0.8, r * 0.8);
      x.lineTo(r * 0.8, -r * 0.8);
      x.moveTo(r * 0.8, r * 0.8);
      x.lineTo(-r * 0.8, -r * 0.8);
      x.stroke();
      x.beginPath();
      x.moveTo(r * 0.8, -r * 0.8);
      x.lineTo(r * 0.25, -r * 0.8);
      x.lineTo(r * 0.8, -r * 0.25);
      x.closePath();
      x.moveTo(-r * 0.8, -r * 0.8);
      x.lineTo(-r * 0.25, -r * 0.8);
      x.lineTo(-r * 0.8, -r * 0.25);
      x.closePath();
      x.fill();
    } else {
      x.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }

  squadBadge(x, cx, cy, T, r, dpr) {
    const col = `rgb(${PAL.friendRGB})`;
    x.fillStyle = 'rgba(8,10,14,0.72)';
    x.strokeStyle = col;
    x.lineWidth = 1.5 * dpr;
    x.beginPath();
    x.moveTo(cx - r * 2.2, cy - r * 1.3);
    x.lineTo(cx + r * 2.2, cy - r * 1.3);
    x.lineTo(cx + r * 2.2, cy + r * 0.9);
    x.lineTo(cx, cy + r * 1.6);
    x.lineTo(cx - r * 2.2, cy + r * 0.9);
    x.closePath();
    x.fill();
    x.stroke();
    for (let i = 0; i < Math.min(4, T.mates.length); i++) {
      x.fillStyle = col;
      x.beginPath();
      x.arc(cx - r * 1.45 + i * r * 0.62, cy + r * 0.95 - r * 0.25, r * 0.2, 0, Math.PI * 2);
      x.fill();
    }
    this.roleMark(x, cx, cy - r * 0.25, T.role, r * 0.75, T.role === 'defend' ? `rgb(${PAL.allyRGB})` : T.role === 'hunt' ? '#ffd76a' : col);
  }

  newBot(next) {
    return { next, mode: '', until: 0, later: null, covered: 0, scan: 0, resume: null, attacker: null, attackedAt: -99, reactAt: 0, chaseAt: 0, idleSince: undefined, retryAt: 0, retreatAt: 0, followAt: 0, unstickAt: 0, groundHits: 0, hitAt: 0, reposAt: 0, fx: 0, fy: 0, fAt: -1, skip: null, skipUntil: 0 };
  }

  destOf(u) {
    const sq = u.squad,
      box = sq && sq.box && !sq.ext ? sq.box : null,
      list = u.path.length ? u.path : box && box.path.length ? box.path : null;
    return list ? list[list.length - 1] : null;
  }

  healSpot(u) {
    let best = null,
      bd = Infinity;
    for (const p of this.points(u.side)) {
      const d = Math.hypot(p.x - u.x, p.y - u.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return null;
    const a = Math.random() * Math.PI * 2,
      r = Math.random() * (best.radius || 100) * 0.4;
    return this.world.nearestOpen(best.x + Math.cos(a) * r, best.y + Math.sin(a) * r, (u.need & ~3) | 1) || best;
  }

  antiArmor(u) {
    const t = u.type;
    let v = this.armorKill.get(t);
    if (v === undefined) {
      const c = u.weapon && u.weapon.proj ? categoryOf(u.weapon.proj) : -1;
      v = c === CAT.ROCKET || c === CAT.MPTL_ROCKET || c === CAT.MISSILE;
      this.armorKill.set(t, v);
    }
    return v;
  }

  aiShooter(u) {
    if (!u || u === this.body || u.remote || u.structure || u.side < 0) return false;
    const q = u.squad;
    return !q || (q !== this.rideQ && q !== this.gunQ);
  }

  footGun(u, t, dt) {
    if (!u.foot || u.weapon || u.pilot || u.direct || u === this.body) return true;
    if ((u.v || 0) > 2) return false;
    let rel = Math.atan2(t.y - u.y, t.x - u.x) - u.heading;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const step = (u.stopTurn || u.turn || 3) * dt;
    u.heading += Math.abs(rel) <= step ? rel : Math.sign(rel) * step;
    u.gunAt = this.world.time;
    return Math.abs(rel) <= GUN_POSE.face;
  }

  gunPose(u) {
    return u.foot && !u.weapon && this.world.time - (u.gunAt ?? -99) < GUN_POSE.hold;
  }

  ready(u, t) {
    if (u.kind !== 'INFANTRY' || !t || !this.aiShooter(u)) return true;
    if (this.rocketsLeft(u) <= 0) return false;
    if ((u.v || 0) > 2 || (t.x !== undefined && !t.spot && !this.sees(u, t))) return false;
    const now = this.world.time;
    let a = this.aimOf.get(u);
    if (!a) this.aimOf.set(u, (a = { t: null, since: 0, at: 0 }));
    if (a.t !== t) {
      const R = this.skill(u.side).react;
      a.t = t;
      a.since = now;
      a.at = now + R[0] + Math.random() * (R[1] - R[0]);
    }
    return now >= a.at;
  }

  aimError(u, t, dist, off) {
    if (u && u.remote && t && t.spot) {
      off.x = off.y = off.z = 0;
      return;
    }
    if (!t || t.structure || !this.aiShooter(u)) return;
    const now = this.world.time,
      a = this.aimOf.get(u),
      on = a && a.t === t ? now - a.since : u.kind === 'INFANTRY' ? 0 : ACC.settleT * 0.6,
      ts = Math.hypot(t.mvx || 0, t.mvy || 0),
      os = Math.hypot(u.mvx || 0, u.mvy || 0),
      far = 0.6 + 0.8 * Math.min(1.5, dist / Math.max(60, u.range || dist)),
      ang =
        ACC.base *
        this.skill(u.side).aim *
        far *
        (1 + ts / ACC.tSpeed) *
        (1 + os / ACC.own) *
        (1 + SUPP.aim * this.suppressed(u)) *
        Math.max(ACC.settle, 1 - on / ACC.settleT),
      r = dist * ang * Math.sqrt(Math.random()),
      th = Math.random() * Math.PI * 2;
    off.x += Math.cos(th) * r;
    off.y += Math.sin(th) * r;
    off.z += (Math.random() - 0.5) * r * 0.6;
  }

  suppressed(u) {
    const s = this.supp.get(u);
    return s ? s.v * Math.exp(-(this.world.time - s.at) / SUPP.decay) : 0;
  }

  suppress(u, from) {
    const now = this.world.time,
      v = Math.min(1, this.suppressed(u) + SUPP.add);
    let s = this.supp.get(u);
    if (!s) this.supp.set(u, (s = { v: 0, at: 0 }));
    s.v = v;
    s.at = now;
    if (from && from.x !== undefined && !from.dead) this.react(u, from);
  }

  nearMiss(s) {
    const f = s.from,
      w = this.world;
    if (!f || f.side < 0 || f.x === undefined) return;
    const t = s.target;
    if (t && t !== s.struck && !t.dead && t.x !== undefined && t.kind === 'INFANTRY' && this.bots.has(t) && w.enemy(t, f)) this.suppress(t, f);
    const N = SUPP.near;
    for (const u of this.bots.keys()) {
      if (u === t || u === s.struck || u.dead || Math.abs(u.x - s.x) > N || Math.abs(u.y - s.y) > N) continue;
      if (Math.hypot(u.x - s.x, u.y - s.y) > N || !w.enemy(u, f)) continue;
      this.suppress(u, f);
    }
  }

  callOut(u, from) {
    const T = this.teamOf.get(u);
    if (!T) return;
    const now = this.world.time;
    for (const m of T.mates) {
      if (m === u || m.dead || (m.target && !m.target.dead)) continue;
      const st = this.bots.get(m);
      if (!st || st.mode === 'retreat') continue;
      st.attacker = from;
      st.attackedAt = now;
      st.scan = 0;
    }
  }

  organize() {
    const w = this.world;
    for (const [u, T] of this.teamOf) if (u.dead || u.gone || !this.isBot(u.squad)) this.teamOf.delete(u);
    for (const u of this.aimOf.keys()) if (u.dead || u.gone) this.aimOf.delete(u);
    for (const u of this.supp.keys()) if (u.dead || u.gone) this.supp.delete(u);
    for (const q of this.vstate.keys()) if (q.dead || !q.members.length) this.vstate.delete(q);
    this.teams = this.teams.filter(T => {
      T.mates = T.mates.filter(m => this.teamOf.get(m) === T);
      if (!T.mates.includes(T.lead)) T.lead = T.mates[0];
      return T.mates.length > 0;
    });
    const join = u => {
      let best = null,
        bd = TEAM.join;
      for (const T of this.teams) {
        if (T.side !== u.side || T.mates.length >= TEAM.size || T.mates.includes(u)) continue;
        const d = Math.hypot(T.lead.x - u.x, T.lead.y - u.y);
        if (d < bd) {
          bd = d;
          best = T;
        }
      }
      return best;
    };
    for (const sq of w.squads) {
      if (!this.isBot(sq)) continue;
      const u = sq.members[0];
      if (this.teamOf.has(u)) continue;
      let T = join(u);
      if (!T) this.teams.push((T = { side: u.side, lead: u, mates: [], post: null, role: '', prey: null, spot: null, moveAt: 0, swapAt: 0, phase: 0, n: ++this.teamN, fails: 0, avoid: null, sx: u.x, sy: u.y, sAt: this.world.time, pushFoe: 0 }));
      T.mates.push(u);
      this.teamOf.set(u, T);
    }
    for (const T of this.teams) {
      if (T.mates.length !== 1) continue;
      const u = T.mates[0],
        O = join(u);
      if (!O || O.mates.length === 1) continue;
      O.mates.push(u);
      this.teamOf.set(u, O);
      T.mates.length = 0;
    }
    this.teams = this.teams.filter(T => T.mates.length > 0);
    for (let s = 0; s < this.game.factions.length; s++) this.directSide(s);
  }

  directSide(side) {
    const w = this.world,
      teams = this.teams.filter(T => T.side === side);
    if (!teams.length) return;
    const foes = w.units.filter(e => !e.dead && !e.inside && e.side >= 0 && e.side !== w.wild && !e.structure && e.speed > 0 && !w.ally(e.side, side)),
      bases = this.points(side),
      fromBase = p => bases.reduce((m, b) => Math.min(m, Math.hypot(b.x - p.x, b.y - p.y)), Infinity),
      G = TEAM.guard,
      asks = [];
    for (const p of w.points) {
      if (p.locked) continue;
      const own = p.side >= 0 && w.ally(p.side, side),
        taking = p.taker >= 0 && !w.ally(p.taker, side),
        value = p.reinforce ? 1.5 : 1;
      let threat = 0;
      for (const e of foes) if (Math.abs(e.x - p.x) < G && Math.abs(e.y - p.y) < G && Math.hypot(e.x - p.x, e.y - p.y) < G) threat++;
      const want = Math.min(3, 1 + Math.floor(threat / 4));
      if (own) {
        if (taking || threat) asks.push({ p, role: 'defend', want, score: value * 2 + threat * 0.2 + (taking ? 1 : 0) });
      } else asks.push({ p, role: 'attack', want, score: value - fromBase(p) / 1500 });
    }
    asks.sort((a, b) => b.score - a.score);
    const free = new Set(teams),
      armor = foes.filter(e => (e.kind === 'VEHICLE' || e.kind === 'AIR') && !e.foot && !(e.squad?.crew && !e.squad.crew.in));
    if (armor.length && teams.length >= 3) {
      let hunter = null,
        hs = 0;
      for (const T of teams) {
        const n = T.mates.filter(m => this.antiArmor(m)).length;
        if (n > hs || (n === hs && n > 0 && T.role === 'hunt')) {
          hs = n;
          hunter = T;
        }
      }
      if (hunter) {
        let prey = hunter.prey && !hunter.prey.dead && armor.includes(hunter.prey) ? hunter.prey : null;
        if (!prey) {
          let bd = Infinity;
          for (const e of armor) {
            const d = Math.hypot(e.x - hunter.lead.x, e.y - hunter.lead.y);
            if (d < bd) {
              bd = d;
              prey = e;
            }
          }
        }
        this.task(hunter, 'hunt', null, prey);
        free.delete(hunter);
      }
    }
    for (const A of asks)
      for (const T of free)
        if (A.want > 0 && T.post === A.p && T.role === A.role && this.canGo(T, A.p)) {
          A.want--;
          free.delete(T);
        }
    for (const A of asks)
      while (A.want > 0 && free.size) {
        let best = null,
          bd = Infinity;
        for (const T of free) {
          if (!this.canGo(T, A.p)) continue;
          const d = Math.hypot(T.lead.x - A.p.x, T.lead.y - A.p.y);
          if (d < bd) {
            bd = d;
            best = T;
          }
        }
        if (!best) break;
        this.task(best, A.role, A.p, null);
        free.delete(best);
        A.want--;
      }
    const atk = asks.filter(A => A.role === 'attack');
    let i = 0;
    for (const T of free) {
      let A = null;
      for (let k = 0; k < atk.length && !A; k++) {
        const c = atk[(i + k) % atk.length];
        if (this.canGo(T, c.p)) A = c;
      }
      i++;
      if (A) this.task(T, 'attack', A.p, null);
      else {
        const any = asks.find(c => this.canGo(T, c.p));
        if (any) this.task(T, any.role, any.p, null);
        else this.task(T, 'push', null, null);
      }
    }
  }

  task(T, role, p, prey) {
    if (T.role === role && T.post === p && T.prey === prey) return;
    T.role = role;
    T.post = p;
    T.prey = prey;
    T.spot = null;
    T.moveAt = 0;
  }

  goalOf(T) {
    const w = this.world;
    if (T.role === 'hunt') return T.prey && !T.prey.dead ? T.prey : null;
    if (T.role === 'push') return T.pushFoe > this.world.time ? this.nearestFoe(T.lead) : this.objective(T.lead);
    const p = T.post;
    if (!p) return null;
    if (!T.spot) {
      const a = Math.random() * Math.PI * 2,
        r = Math.random() * (p.radius || 100) * 0.5;
      T.spot = w.nearestOpen(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, (T.lead.need & ~3) | 1) || { x: p.x, y: p.y };
    }
    return T.spot;
  }

  alongRoute(T, L, gx, gy, need, fresh = false) {
    const w = this.world,
      now = w.time;
    let R = T.route;
    if (fresh || !R || Math.hypot(R.gx - gx, R.gy - gy) > TEAM.reroute || now - R.at > TEAM.routeAge) {
      const way = w.route(L.x, L.y, gx, gy, need);
      if (!way || !way.length) {
        T.route = null;
        return null;
      }
      R = T.route = { gx, gy, at: now, pts: [{ x: L.x, y: L.y }, ...way] };
    }
    const P = R.pts;
    let bi = 0,
      bt = 0,
      bd = Infinity;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i],
        b = P[i + 1],
        vx = b.x - a.x,
        vy = b.y - a.y,
        t = Math.max(0, Math.min(1, ((L.x - a.x) * vx + (L.y - a.y) * vy) / (vx * vx + vy * vy || 1))),
        dx = L.x - (a.x + vx * t),
        dy = L.y - (a.y + vy * t),
        dd = dx * dx + dy * dy;
      if (dd < bd) {
        bd = dd;
        bi = i;
        bt = t;
      }
    }
    if (bd > TEAM.offRoute * TEAM.offRoute) return fresh ? null : this.alongRoute(T, L, gx, gy, need, true);
    let ax = P[bi].x + (P[bi + 1].x - P[bi].x) * bt,
      ay = P[bi].y + (P[bi + 1].y - P[bi].y) * bt,
      left = TEAM.bound;
    for (let i = bi; i < P.length - 1; i++) {
      const b = P[i + 1],
        seg = Math.hypot(b.x - ax, b.y - ay);
      if (seg >= left) return { x: ax + ((b.x - ax) * left) / seg, y: ay + ((b.y - ay) * left) / seg };
      left -= seg;
      ax = b.x;
      ay = b.y;
    }
    return { x: gx, y: gy };
  }

  boundTo(L, gx, gy, T = null) {
    const w = this.world,
      d = Math.hypot(gx - L.x, gy - L.y),
      need = (L.need & ~3) | 1;
    if (d <= TEAM.bound * 1.3) return { x: gx, y: gy };
    if (T) {
      const p = this.alongRoute(T, L, gx, gy, need);
      if (p) return p;
    }
    const ux = (gx - L.x) / d,
      uy = (gy - L.y) / d,
      bx = L.x + ux * TEAM.bound,
      by = L.y + uy * TEAM.bound,
      look = this.fake({ x: bx + ux * TEAM.look, y: by + uy * TEAM.look }, L);
    let best = null,
      bs = Infinity;
    for (let k = 0; k < 7; k++) {
      const a = (k * Math.PI) / 3,
        r = k ? 45 : 0,
        x = bx + Math.cos(a) * r,
        y = by + Math.sin(a) * r;
      if (!w.isOpen(x, y, need)) continue;
      const s = (this.lineClear(look, this.fake({ x, y }, L)) ? 100 : 0) + r * 0.2 + Math.random() * 5;
      if (s < bs) {
        bs = s;
        best = { x, y };
      }
    }
    return best || { x: gx, y: gy };
  }

  march() {
    const w = this.world,
      now = w.time;
    for (const T of this.teams) {
      let L = T.lead;
      if (!L || L.dead) continue;
      const modeOf = m => {
        const st = this.bots.get(m);
        return st && st.mode && (st.mode !== 'fight' && st.mode !== 'cover' ? true : now < st.until) ? st.mode : '';
      };
      if (modeOf(L) === 'retreat') {
        const alt = T.mates.find(m => !m.dead && modeOf(m) !== 'retreat');
        if (!alt) continue;
        T.lead = L = alt;
      }
      if (T.mates.some(m => modeOf(m) === 'fight' || modeOf(m) === 'cover')) {
        T.sx = L.x;
        T.sy = L.y;
        T.sAt = now;
        this.overwatch(T, now);
        continue;
      }
      const goal = this.goalOf(T);
      if (!goal) continue;
      const hold = T.post ? (T.post.radius || 100) * 0.6 : 60,
        dist = Math.hypot(goal.x - L.x, goal.y - L.y),
        dest = this.destOf(L),
        there = dist <= hold && !dest;
      if (there || Math.hypot(L.x - T.sx, L.y - T.sy) > STALL.moved) {
        T.sx = L.x;
        T.sy = L.y;
        T.sAt = now;
      } else if (now - T.sAt > STALL.still) {
        this.giveUp(T);
        continue;
      }
      if (!modeOf(L) && now >= T.moveAt) {
        T.moveAt = now + (there ? 2 : 1.5);
        if (!there && (!dest || T.role === 'hunt' || Math.hypot(dest.x - goal.x, dest.y - goal.y) > TEAM.bound * 1.5 + 10)) {
          const b = this.boundTo(L, goal.x, goal.y, T);
          if (b && this.send(L.squad, b.x, b.y, null, 0.5)) T.fails = 0;
          else if (++T.fails >= STALL.fails) {
            this.giveUp(T);
            continue;
          }
        }
      }
      const anchor = this.destOf(L) || L,
        dir = anchor === L ? Math.atan2(goal.y - L.y, goal.x - L.x) : Math.atan2(anchor.y - L.y, anchor.x - L.x),
        cd = Math.cos(dir),
        sd = Math.sin(dir),
        rest = T.mates.length - 1;
      let i = 0;
      for (const m of T.mates) {
        if (m === L || m.dead) continue;
        i++;
        const st = this.bots.get(m);
        if (!st || modeOf(m) || now < st.followAt) continue;
        let x, y;
        if (there) {
          const a = (i / Math.max(1, rest)) * Math.PI * 2 + T.n,
            r = hold * 0.7;
          x = L.x + Math.cos(a) * r;
          y = L.y + Math.sin(a) * r;
        } else {
          const k = Math.ceil(i / 2),
            back = TEAM.slot * k,
            lat = (i % 2 ? 1 : -1) * TEAM.slot * k;
          x = anchor.x - cd * back - sd * lat;
          y = anchor.y - sd * back + cd * lat;
        }
        const md = this.destOf(m);
        if (Math.hypot(m.x - x, m.y - y) <= TEAM.follow || (md && Math.hypot(md.x - x, md.y - y) <= TEAM.follow)) continue;
        const o = w.nearestOpen(x, y, (m.need & ~3) | 1);
        if (!o) continue;
        st.followAt = now + 1;
        this.send(m.squad, o.x, o.y, there ? null : dir, 0.5);
      }
    }
  }

  overwatch(T, now) {
    const w = this.world,
      hot = T.mates.find(m => !m.dead && this.bots.get(m)?.mode === 'fight' && m.target && !m.target.dead);
    if (hot)
      for (const m of T.mates) {
        const st = this.bots.get(m);
        if (m === hot || m.dead || !st || st.mode || m.target || now < st.followAt || this.destOf(m)) continue;
        if (Math.hypot(hot.x - m.x, hot.y - m.y) <= TEAM.slot * 3) continue;
        const a = Math.random() * Math.PI * 2,
          o = w.nearestOpen(hot.x + Math.cos(a) * TEAM.slot * 1.5, hot.y + Math.sin(a) * TEAM.slot * 1.5, (m.need & ~3) | 1);
        if (!o) continue;
        st.followAt = now + 2;
        this.send(m.squad, o.x, o.y, Math.atan2(hot.target.y - o.y, hot.target.x - o.x), 0.5);
      }
    if (now < T.swapAt) return;
    T.swapAt = now + TEAM.swap;
    T.phase ^= 1;
    T.mates.forEach((m, i) => {
      if (m.dead || i % 2 !== T.phase) return;
      const st = this.bots.get(m),
        t = m.target;
      if (!st || st.mode !== 'fight' || !t || t.dead || m.path.length) return;
      const d = Math.hypot(t.x - m.x, t.y - m.y);
      if (d < m.range * 0.45 || !this.sees(m, t)) return;
      const r = TEAM.hop[0] + Math.random() * (TEAM.hop[1] - TEAM.hop[0]),
        a = Math.atan2(t.y - m.y, t.x - m.x) + (Math.random() - 0.5) * 0.9,
        x = m.x + Math.cos(a) * r,
        y = m.y + Math.sin(a) * r;
      if (!w.isOpen(x, y, (m.need & ~3) | 1)) return;
      st.next = now + 2;
      this.send(m.squad, x, y, Math.atan2(t.y - y, t.x - x), r / Math.max(10, m.speed) + 0.3);
    });
  }

  fastCar(v) {
    return !v.flies && v.kind === 'VEHICLE' && v.speed >= VEH.fast;
  }

  vorder(q, x, y) {
    this.raw = true;
    try {
      this.world.order(q, x, y, null, true);
    } finally {
      this.raw = false;
    }
  }

  drivers() {
    const w = this.world,
      now = w.time;
    for (const q of this.crewed) {
      const C = q.crew,
        v = q.members[0];
      if (!v || v.dead || !C.in || C.in === this.body || q === this.rideQ || q === this.gunQ || q.noAI) continue;
      let vs = this.vstate.get(q);
      if (!vs) this.vstate.set(q, (vs = { halt: 0, gap: 0, later: null, held: false, sign: 1 }));
      if (v.health < v.maxHealth * VEH.bail) {
        for (const c of [C.in, C.gunner]) if (c && c !== this.body && !c.dead) this.eject(c, q, false);
        continue;
      }
      if (now >= vs.halt && vs.held) {
        vs.held = false;
        vs.gap = now + VEH.gap;
        const L = vs.later;
        vs.later = null;
        if (L) this.vorder(q, L[0], L[1]);
      }
      const t = v.target && !v.target.dead && !v.target.inside ? v.target : null;
      if (!t || v.flies || now < vs.halt) continue;
      const d = Math.hypot(t.x - v.x, t.y - v.y);
      if (this.fastCar(v)) {
        if (d > v.range * 1.6) continue;
        const a = Math.atan2(t.y - v.y, t.x - v.x) + vs.sign * 0.35,
          o = w.nearestOpen(t.x + Math.cos(a) * VEH.overshoot, t.y + Math.sin(a) * VEH.overshoot, v.need);
        vs.sign = -vs.sign;
        if (!o) continue;
        const p = this.destOf(v);
        if (!vs.held) vs.later = p ? [p.x, p.y] : null;
        this.vorder(q, o.x, o.y);
        vs.halt = now + VEH.run;
        vs.held = true;
      } else if (now >= vs.gap && this.destOf(v) && d <= v.range && this.sees(v, t)) {
        const p = this.destOf(v);
        vs.later = p ? [p.x, p.y] : null;
        vs.halt = now + VEH.halt;
        vs.held = true;
        v.path.length = 0;
        if (q.box && !q.ext && q.box.path) q.box.path.length = 0;
      }
    }
  }

  combat(sq, u, st, now) {
    const w = this.world,
      R = u.range,
      V = R * VISION,
      cur = u.target && !u.target.dead && !u.target.inside ? u.target : null,
      anti = this.antiArmor(u),
      near = [];
    for (const e of w.foesNear(u.x, u.y, V)) {
      if (e.dead || e.inside || e.side < 0 || e.cloaked || !w.enemy(u, e) || !w.targetEnemy(u, e)) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d <= V) near.push([d, e]);
    }
    near.sort((a, b) => a[0] - b[0]);
    let best = null,
      bs = Infinity;
    const score = (e, d, seen) => {
      const hp = e.maxHealth > 0 ? e.health / e.maxHealth : 1;
      let s = d / R + hp * 0.35 + (seen ? 0 : 0.6);
      if (e === cur) s -= 0.3;
      if (e === st.attacker && now - (st.attackedAt || -99) < 4) s -= 0.6;
      if (e.structure) s += 0.4;
      if (anti) s += e.kind === 'INFANTRY' ? 0.25 : e.structure ? 0 : -0.8;
      return s;
    };
    for (let i = 0; i < near.length && i < 8; i++) {
      const [d, e] = near[i];
      if (e === st.skip && now < st.skipUntil) continue;
      if (!this.sees(u, e)) continue;
      const s = score(e, d, true);
      if (s < bs) {
        bs = s;
        best = e;
      }
    }
    const a = st.attacker;
    if (a && !a.dead && !a.inside && a !== best && !(a === st.skip && now < st.skipUntil) && now - (st.attackedAt || -99) < 4 && w.enemy(u, a)) {
      const d = Math.hypot(a.x - u.x, a.y - u.y);
      if (d <= V * 1.5) {
        const s = score(a, d, this.sees(u, a));
        if (s < bs) {
          bs = s;
          best = a;
        }
      }
    }
    if (!best) return false;
    if (best !== cur || sq.foe !== best.squad || st.mode !== 'fight') this.engage(sq, u, best, st);
    st.until = now + FIGHT_HOLD;
    st.calmAt = 0;
    const d = Math.hypot(best.x - u.x, best.y - u.y),
      sees = this.sees(u, best);
    if (sees) st.blindAt = 0;
    else st.blindAt ||= now;
    const blind = !sees && now - st.blindAt >= CALM.blind;
    if ((d > R * 0.95 || blind) && now >= (st.chaseAt || 0) && u.speed > 0) {
      st.chaseAt = now + 2.5;
      if (d <= R * 0.95 && now >= (st.reposAt || 0) && this.reposition(sq, u, st, best, now)) return true;
      const k = Math.max(0, d - R * 0.7) / Math.max(1, d),
        x = u.x + (best.x - u.x) * (d > R * 0.95 ? k : 0.5),
        y = u.y + (best.y - u.y) * (d > R * 0.95 ? k : 0.5),
        o = w.nearestOpen(x, y, (u.need & ~3) | 1);
      if (!o || !this.send(sq, o.x, o.y, Math.atan2(best.y - o.y, best.x - o.x), 1.6)) {
        st.skip = best;
        st.skipUntil = now + STALL.skip;
      } else st.chaseTo = o;
    } else if (d <= R * 0.9 && sees && u.path.length && !(sq.clearGo > now)) {
      const end = this.destOf(u),
        chase = st.chaseTo && end && Math.hypot(end.x - st.chaseTo.x, end.y - st.chaseTo.y) < 30;
      if (end && !chase && Math.hypot(end.x - u.x, end.y - u.y) > CALM.stop) {
        u.path.length = 0;
        if (sq.box && !sq.ext && sq.box.path) sq.box.path.length = 0;
      }
    }
    return true;
  }

  nearestFoe(u) {
    const w = this.world;
    let best = null,
      bd = Infinity;
    for (const e of w.units) {
      if (e.dead || e.inside || e.side < 0 || e.structure || !w.enemy(u, e)) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  objective(u) {
    const w = this.world;
    let best = null,
      bd = Infinity;
    for (const p of w.points) {
      if (p.locked || (p.side >= 0 && w.ally(p.side, u.side))) continue;
      const d = Math.hypot(p.x - u.x, p.y - u.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) return best;
    for (const e of w.units) {
      if (e.dead || e.inside || e.side < 0 || !w.enemy(u, e)) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  engage(sq, u, e, st) {
    const box = sq.box && !sq.ext ? sq.box : null,
      list = u.path.length ? u.path : box && box.path.length ? box.path : null;
    if (list && st && !st.resume) {
      const p = list[list.length - 1];
      st.resume = { x: p.x, y: p.y };
    }
    if (list && st && st.mode === 'fight') sq.foe = e.squad;
    else this.world.attack(sq, e.squad);
    u.target = e;
    if (st) {
      st.next = this.world.time + 0.8 + Math.random() * 0.8;
      st.mode = 'fight';
      st.until = this.world.time + FIGHT_HOLD;
    }
  }

  react(u, from) {
    const w = this.world,
      sq = u.squad;
    if (!from || from.dead || from.x === undefined || !from.squad || !this.isBot(sq) || !w.enemy(u, from)) return;
    let st = this.bots.get(u);
    if (!st) this.bots.set(u, (st = this.newBot(w.time)));
    st.attacker = from;
    st.attackedAt = w.time;
    this.callOut(u, from);
    if (st.mode === 'retreat') return;
    if (st.mode === 'cover' && w.time < st.until) return;
    if (w.time < (st.reactAt || 0)) return;
    st.reactAt = w.time + 0.4;
    this.combat(sq, u, st, w.time);
  }

  cover(u, t) {
    const w = this.world,
      need = (u.need & ~3) | 1,
      away = Math.atan2(u.y - t.y, u.x - t.x);
    let best = null,
      bs = Infinity;
    for (const r of COVER.ring)
      for (let k = 0; k < 10; k++) {
        const a = away + ((k - 4.5) / 10) * Math.PI * 1.4,
          x = u.x + Math.cos(a) * r,
          y = u.y + Math.sin(a) * r;
        if (!w.isOpen(x, y, need)) continue;
        if (this.lineClear(t, this.fake({ x, y }, u))) continue;
        const s = r - Math.hypot(x - t.x, y - t.y) * 0.2;
        if (s < bs) {
          bs = s;
          best = { x, y };
        }
      }
    return best;
  }

  jitter(u) {
    const a = this.aim,
      s = this.spot,
      d = Math.hypot(a.x - u.x, a.y - u.y, a.z - u.z - this.eye),
      r = d * Math.tan(this.spread) * Math.sqrt(Math.random()),
      t = Math.random() * Math.PI * 2,
      p = Math.acos(2 * Math.random() - 1);
    s.x = a.x + r * Math.sin(p) * Math.cos(t);
    s.y = a.y + r * Math.sin(p) * Math.sin(t);
    s.z = a.z + r * Math.cos(p);
  }

  heightOf(u) {
    const t = u.type;
    let h = this.heights.get(t);
    if (h === undefined) {
      h = 0;
      if (u.holder) {
        _box.setFromObject(u.holder);
        h = _box.max.z - _box.min.z;
      }
      if (!(h >= 4 && h <= 60)) h = Math.max(8, (u.aimZ || 6) * 1.6);
      this.heights.set(t, h);
    }
    return h;
  }

  eyeOf(u) {
    return u.z + (u.kind === 'INFANTRY' ? this.heightOf(u) * 0.9 : Math.max(u.aimZ || 0, u.hitRadius * 0.6, 6));
  }

  sees(u, e) {
    const w = this.world,
      now = w.time;
    let m = this.los.get(u);
    if (!m) this.los.set(u, (m = new Map()));
    const c = m.get(e);
    if (c !== undefined && now < Math.abs(c)) return c > 0;
    if (m.size > 48) m.clear();
    const ok = this.lineClear(u, e);
    const until = now + SIGHT_TTL + Math.random() * 0.2;
    m.set(e, ok ? until : -until);
    return ok;
  }

  lineClear(u, e) {
    const w = this.world,
      T = w.terrain,
      ex = u.x,
      ey = u.y,
      ez = u.kind === 'INFANTRY' ? u.z + this.heightOf(u) * MUZZLE : this.eyeOf(u),
      tx = e.x,
      ty = e.y,
      tz = e.structure ? e.z + Math.max(8, e.hitRadius * 0.5) : e.z + (e.kind === 'INFANTRY' ? this.heightOf(e) * MUZZLE : Math.max(e.aimZ || 0, 6)),
      dx = tx - ex,
      dy = ty - ey,
      d = Math.hypot(dx, dy);
    if (d < 40 || u.flies || e.flies) return true;
    const steps = Math.min(40, Math.ceil(d / 20));
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      const sx = ex + dx * k,
        sy = ey + dy * k,
        lz = ez + (tz - ez) * k + 1;
      if (heightAt(T, sx, sy) > lz) return false;
    }
    if (this.rocks) {
      const fr = (u.hitRadius || 0) + 6,
        tr = (e.hitRadius || 0) * 1.2 + 6,
        m = Math.ceil(d / (ROCK.cell * 0.5));
      for (let i = 1; i < m; i++) {
        const k = i / m,
          sx = ex + dx * k,
          sy = ey + dy * k;
        if (!this.solidAt(sx, sy, ez + (tz - ez) * k)) continue;
        if (Math.hypot(sx - ex, sy - ey) > fr && Math.hypot(sx - tx, sy - ty) > tr) return false;
      }
    }
    if (w.time >= this.blockersAt) {
      this.blockersAt = w.time + 1;
      this.blockers = w.units.filter(b => b.structure && !b.dead && b.hitRadius > 14);
    }
    const L2 = d * d;
    for (const b of this.blockers) {
      if (b === e || b === u || b.dead) continue;
      const k = ((b.x - ex) * dx + (b.y - ey) * dy) / L2;
      if (k <= 0.02 || k >= 0.98) continue;
      const px = ex + dx * k - b.x,
        py = ey + dy * k - b.y,
        r = b.hitRadius * 0.7;
      if (px * px + py * py < r * r && ez + (tz - ez) * k < b.z + b.hitRadius) return false;
    }
    return true;
  }

  hitScale(s, hit) {
    const b = this.body;
    if (s.from && s.from.remote) {
      if (hit.kind !== 'INFANTRY' || s.z < hit.z + this.heightOf(hit) * HEAD_FROM) return 1;
      s.head = true;
      return HEAD;
    }
    if (!b || s.from !== b) return 1;
    let k = this.scopedShots.has(s) ? SCOPE.damage : 1;
    if (this.role === 'rocket' && hit.kind !== 'INFANTRY' && !hit.structure) k *= LOCK.damage;
    if (hit.kind !== 'INFANTRY' || s.z < hit.z + this.heightOf(hit) * HEAD_FROM) return k;
    this.headUntil = performance.now() + 400;
    this.stats.heads++;
    return HEAD * k;
  }

  airStep(u, dt) {
    const w = this.world,
      A = this.A,
      T = w.terrain,
      top = (w.n - 1) * 20;
    const want = u.speed * (A.throttle > 0 ? (A.boost ? BOOST.speed : 1) : A.throttle < 0 ? AIR.slow : AIR.cruise);
    A.v += Math.max(-u.speed * AIR.accel * dt, Math.min(u.speed * AIR.accel * dt, want - A.v));
    const rate = Math.max(1.2, Math.min(2.4, u.turn || 1.5)),
      da = wrap(A.yaw - u.heading) + A.turn * -0.6,
      step = rate * dt,
      turned = Math.abs(da) <= step ? da : Math.sign(da) * step;
    u.heading += turned;
    A.roll += (Math.max(-AIR.roll, Math.min(AIR.roll, (turned / Math.max(dt, 1e-3)) * 0.45)) - A.roll) * Math.min(1, dt * 4);
    const vz = (Math.sin(Math.max(-0.7, Math.min(0.7, A.pitch + 0.08))) * AIR.climb + A.up * AIR.lift) * Math.max(A.v, u.speed * 0.4);
    const ch = Math.cos(u.heading),
      sh = Math.sin(u.heading);
    let x = u.x + ch * A.v * dt,
      y = u.y + sh * A.v * dt,
      spin = 0;
    if (A.barrel) {
      const B = A.barrel;
      B.t = Math.min(1, B.t + dt / BOOST.roll);
      const k = B.t * B.t * (3 - 2 * B.t);
      spin = B.dir * Math.PI * 2 * k;
      const side = B.dir * BOOST.side * u.speed * Math.sin(Math.PI * B.t) * dt;
      x += sh * side;
      y -= ch * side;
      if (B.t >= 1) A.barrel = null;
    }
    x = Math.max(20, Math.min(top - 20, x));
    y = Math.max(20, Math.min(top - 20, y));
    const ground = Math.max(heightAt(T, x, y), heightAt(T, x + ch * AIR.look, y + sh * AIR.look)),
      floor = ground + Math.max(AIR.floor, (u.lift || 0) * 0.5),
      ceil = ground + AIR.ceil;
    let z = u.z + vz * dt;
    if (z < floor) z = Math.min(floor, u.z + Math.max(vz, 60) * dt + (floor - u.z) * Math.min(1, dt * 6));
    if (z < floor - 2) z = floor - 2;
    z = Math.min(ceil, z);
    const climb = dt > 0 ? (z - u.z) / dt : 0;
    A.tilt += (Math.atan2(climb, Math.max(A.v, 1)) - A.tilt) * Math.min(1, dt * 5);
    u.x = x;
    u.y = y;
    u.z = z;
    u.v = A.v;
    u.path.length = 0;
    u.target = null;
    const D = u.squad.direct;
    if (D) {
      if (u.guns && u.guns.length) w.fireGuns(u, dt);
      const wp = u.weapon;
      if (wp) {
        wp.cooldown -= dt;
        if (D.firing && D.target) w.burst(u, D.target, wp, dt);
      }
    }
    w.setAnim(u, 'move');
    w.show(u, dt);
    u.holder.position.set(u.x, u.y, u.z);
    u.holder.quaternion
      .setFromAxisAngle(_Z, u.heading + Math.PI / 2)
      .multiply(_q.setFromAxisAngle(_Y, A.roll + spin))
      .multiply(_q.setFromAxisAngle(_X, A.tilt));
  }

  reticle() {
    this.cross.className = `sh-ret sh-ret-${this.role} sh-ch-${this.cfg.crosshair}`;
  }

  saveCfg() {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(this.cfg));
    } catch {}
  }

  setCfg(key, value) {
    const C = this.cfg;
    C[key] = value;
    if (key === 'view') this.third = value !== 'first';
    if (key === 'crosshair') this.reticle();
    if (key === 'colorblind') {
      usePalette(value);
      this.feedDirty = true;
      this.annDirty = true;
    }
    this.saveCfg();
  }

  openSettings() {
    if (!this.setEl) this.buildSettings();
    this.setEl.style.display = 'flex';
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.fire = this.zoom = false;
  }

  closeSettings() {
    if (this.setEl) this.setEl.style.display = 'none';
  }

  buildSettings() {
    const E = (this.setEl = document.createElement('div'));
    E.className = 'sh-set';
    E.style.display = 'none';
    E.innerHTML = '<div class="sh-frame sh-set-box eaw-frame"><div class="sh-head"><div class="sh-title">Shooter Settings</div></div><div class="sh-set-body"></div><div class="sh-foot"><div></div><button class="sh-go eaw-btn">Done</button></div></div>';
    document.body.appendChild(E);
    const body = E.querySelector('.sh-set-body'),
      C = this.cfg;
    const row = (label, input) => {
      const r = document.createElement('label');
      r.className = 'sh-set-row';
      const t = document.createElement('span');
      t.textContent = label;
      r.append(t, input);
      body.appendChild(r);
      return input;
    };
    const range = (label, key, min, max, step, fmt) => {
      const wrapEl = document.createElement('div'),
        i = document.createElement('input'),
        v = document.createElement('b');
      wrapEl.className = 'sh-set-range';
      i.type = 'range';
      i.className = 'eaw-range';
      i.min = min;
      i.max = max;
      i.step = step;
      i.value = C[key];
      v.textContent = fmt(C[key]);
      i.oninput = () => {
        this.setCfg(key, +i.value);
        v.textContent = fmt(+i.value);
      };
      wrapEl.append(i, v);
      row(label, wrapEl);
    };
    const check = (label, get, set) => {
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.className = 'eaw-check';
      i.checked = get();
      i.onchange = () => set(i.checked);
      row(label, i);
    };
    const pick = (label, key, opts) => {
      const i = document.createElement('select');
      i.className = 'eaw-select';
      for (const [v, t] of opts) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        i.appendChild(o);
      }
      i.value = C[key];
      i.onchange = () => this.setCfg(key, i.value);
      row(label, i);
    };
    range('Field of view', 'fov', 55, 100, 1, v => `${v} deg`);
    range('Mouse sensitivity', 'sens', 0.3, 2.5, 0.05, v => `${v.toFixed(2)}x`);
    range('Aiming sensitivity', 'ads', 0.3, 2, 0.05, v => `${v.toFixed(2)}x`);
    check('Invert look', () => C.invert, v => this.setCfg('invert', v));
    pick('Default view', 'view', [
      ['third', 'Third person'],
      ['first', 'First person']
    ]);
    pick('Crosshair', 'crosshair', [
      ['ring', 'Ring'],
      ['dot', 'Dot'],
      ['cross', 'Cross']
    ]);
    check('Head bob', () => C.bob, v => this.setCfg('bob', v));
    const level = (label, name, key, id) => {
      const wrapEl = document.createElement('div'),
        i = document.createElement('input'),
        v = document.createElement('b'),
        now = Math.round((typeof globalThis[name] === 'number' ? globalThis[name] : globalThis[name] === false ? 0 : name === 'shooterFocus' ? 1 : 0) * 100),
        txt = n => (n > 0 ? `${n}%` : 'Off');
      wrapEl.className = 'sh-set-range';
      i.type = 'range';
      i.className = 'eaw-range';
      i.min = 0;
      i.max = 100;
      i.step = 5;
      i.value = now;
      v.textContent = txt(now);
      i.oninput = () => {
        const n = +i.value;
        globalThis[name] = n / 100;
        v.textContent = txt(n);
        try {
          localStorage.setItem(key, String(n));
        } catch {}
        const page = document.getElementById(id);
        if (page) page.value = n;
      };
      wrapEl.append(i, v);
      row(label, wrapEl);
    };
    level('Aim focus blur', 'shooterFocus', 'swr-shooter-focus', 'optShooterFocus');
    level('Motion blur', 'shooterBlur', 'swr-shooter-blur', 'optShooterBlur');
    check('Colourblind-safe markers', () => C.colorblind, v => this.setCfg('colorblind', v));
    check('Gamepad aim assist', () => C.assist, v => this.setCfg('assist', v));
    E.querySelector('.sh-go').onclick = () => this.closeSettings();
    E.addEventListener('mousedown', e => e.stopPropagation());
    E.addEventListener('keydown', e => e.stopPropagation());
  }

  gamepad(real) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [],
      gp = [...pads].find(p => p && p.connected && p.mapping === 'standard') || [...pads].find(p => p && p.connected);
    const M = this.padMove;
    if (!gp) {
      M.f = M.s = 0;
      return;
    }
    const B = i => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > PAD.trigger),
      was = this.padWas,
      down = i => B(i) && !was[i],
      up = i => !B(i) && was[i],
      dz = v => (Math.abs(v) < PAD.dead ? 0 : Math.sign(v) * ((Math.abs(v) - PAD.dead) / (1 - PAD.dead)) ** 1.6),
      ax = i => dz(gp.axes[i] || 0);
    const lx = ax(0),
      ly = ax(1),
      rx = ax(2),
      ry = ax(3);
    const any = lx || ly || rx || ry || gp.buttons.some(b => b && b.pressed);
    if (any && !this.padOn) {
      this.padOn = true;
      this.note('Gamepad connected - left stick moves, right stick looks, triggers aim and fire');
    }
    if (this.state !== 'alive') {
      M.f = M.s = 0;
      if (down(0)) {
        if (this.introUntil > performance.now()) this.introUntil = 0;
        else this.deploy();
      }
      if ((down(14) || down(15)) && this.panel.style.display !== 'none') {
        const cls = this.cards();
        if (cls.length) {
          const i = Math.max(0, cls.findIndex(c => c === this.pick));
          this.pick = cls[(i + (down(15) ? 1 : cls.length - 1)) % cls.length];
          this.refreshDeploy(true);
        }
      }
      if ((down(4) || down(5)) && this.panel.style.display !== 'none') {
        const pts = this.spawnSpots();
        if (pts.length) {
          const i = Math.max(0, pts.indexOf(this.from));
          this.from = pts[(i + (down(5) ? 1 : pts.length - 1)) % pts.length];
          this.refreshDeploy(true);
        }
      }
      if (down(9)) this.openSettings();
    } else if (!this.setEl || this.setEl.style.display === 'none') {
      M.f = -ly;
      M.s = lx;
      if (down(10)) M.run = !M.run;
      if (Math.hypot(lx, ly) < 0.3) M.run = false;
      const C = this.cfg;
      let rate = PAD.look * C.sens * real * (this.zoom ? PAD.adsLook * C.ads : 1);
      if (C.assist && (rx || ry) && this.assistTarget()) rate *= PAD.assist;
      this.yaw = wrap(this.yaw - rx * rate);
      this.pitch = Math.max(-1.4, Math.min(1.35, this.pitch - ry * rate * (C.invert ? -1 : 1)));
      if (down(7)) this.fire = true;
      if (up(7)) this.fire = false;
      if (down(6)) this.zoom = true;
      if (up(6)) this.zoom = false;
      if (down(0)) this.P.jump = true;
      if (down(1) && !this.seatOf()) this.crouched = !this.crouched;
      if (down(2)) this.seated() ? this.leave() : this.enter();
      if (down(3)) {
        if (this.seatOf() && !this.post) this.cockpit = !this.cockpit;
        else this.third = !this.third;
      }
      if (down(5)) this.P.dodge = true;
      if (down(4)) this.nadeHeld = true;
      if (up(4) && this.nadeHeld) {
        this.nadeHeld = false;
        this.throwNade();
      }
      if (down(12)) this.ability(0);
      if (down(14)) this.ability(1);
      if (down(15)) this.ability(2);
      if (down(13)) this.bigMap.style.display = this.bigMap.style.display === 'none' ? 'flex' : 'none';
      this.scoreEl.style.display = B(8) || held(this.keys, 'SHOOTER_SCORES') ? 'block' : 'none';
      if (down(9)) this.openSettings();
    }
    for (let i = 0; i < gp.buttons.length; i++) was[i] = B(i);
  }

  assistTarget() {
    const b = this.body,
      E = this.eyeAt,
      w = this.world;
    if (!b || !E) return false;
    const h = this.aimHit;
    if (h && !h.dead && h.side >= 0 && w.enemy(b, h)) return true;
    const cy = Math.cos(this.yaw),
      sy = Math.sin(this.yaw),
      cp = Math.cos(this.pitch),
      sp = Math.sin(this.pitch),
      R = (b.range || 400) * 1.2;
    for (const e of w.foesNear(b.x, b.y, R)) {
      if (e.dead || e.inside || e.side < 0 || !w.enemy(b, e)) continue;
      const dx = e.x - E.x,
        dy = e.y - E.y,
        dz = e.z + (e.aimZ || 6) - E.z,
        l = Math.hypot(dx, dy, dz);
      if (l < 1) continue;
      if (Math.acos(Math.max(-1, Math.min(1, (dx * cy * cp + dy * sy * cp + dz * sp) / l))) < PAD.cone) return true;
    }
    return false;
  }

  hints() {
    if (this.hinted) return;
    this.hinted = true;
    let seen = false;
    try {
      seen = localStorage.getItem('swr-shooter-hints') === '1';
    } catch {}
    if (seen) return;
    try {
      localStorage.setItem('swr-shooter-hints', '1');
    } catch {}
    const K = id => this.keyText(id),
      E = document.createElement('div');
    E.className = 'sh-hints eaw-frame-s';
    const rows = [
      ['Move', `${K('SCROLL_UP')} ${K('SCROLL_LEFT')} ${K('SCROLL_DOWN')} ${K('SCROLL_RIGHT')}`, 'Left stick'],
      ['Look, fire, aim', 'Mouse, left and right button', 'Right stick, RT, LT'],
      ['Sprint, crouch, jump', `${K('SHOOTER_SPRINT')}, ${K('SHOOTER_CROUCH')}, ${K('SHOOTER_JUMP')}`, 'L3, B, A'],
      ['Dodge', K('SHOOTER_DODGE'), 'RB'],
      ['Thermal detonator', `hold ${K('SHOOTER_GRENADE')}`, 'hold LB'],
      ['Enter or leave', K('SHOOTER_ENTER'), 'X'],
      ['Abilities', `${K('SHOOTER_ABILITY_1')} ${K('SHOOTER_ABILITY_2')} ${K('SHOOTER_ABILITY_3')}`, 'D-pad'],
      ['View, map, scores', `${K('DIRECT_VIEW')}, ${K('SHOOTER_MAP')}, ${K('SHOOTER_SCORES')}`, 'Y, D-pad down, View'],
      ['Settings', K('SHOOTER_SETTINGS'), 'Menu'],
      ...(this.ov?.on ? [['Tactical view', `${K('SHOOTER_OVERLORD')}, scroll out`, '-']] : [])
    ];
    E.innerHTML = '<div class="sh-hints-t">Controls</div><table></table><div class="sh-hints-k">Click or press any key to close</div>';
    const t = E.querySelector('table');
    for (const [a, k, p] of rows) {
      const tr = document.createElement('tr');
      for (const v of [a, k, p]) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    document.body.appendChild(E);
    const close = () => {
      E.remove();
      removeEventListener('keydown', close, true);
      removeEventListener('mousedown', close, true);
      clearTimeout(timer);
    };
    const timer = setTimeout(close, 15000);
    setTimeout(() => {
      addEventListener('keydown', close, true);
      addEventListener('mousedown', close, true);
    }, 600);
    this.hintEl = E;
  }

  postFor(R) {
    if (!this.postReady) return null;
    let P = this.postFx;
    if (!P) {
      P = this.postFx = new PostFX(R);
      P.strength = GRADE.bloom;
      P.mBright.uniforms.cutoff.value = GRADE.cutoff;
      this.lens = lensMaterial();
      P.finish = mid => {
        const u = this.lens.uniforms;
        u.map.value = mid.texture;
        u.texel.value.set(1 / mid.width, 1 / mid.height);
        P.pass(this.lens, null);
      };
      this.postCompiled = !R.compileAsync || !!R.isMirror || R === this.game.gpu;
      if (!this.postCompiled)
        (async () => {
          for (const m of [P.mBright, P.mBlur, P.mCombine, this.lens]) {
            P.quad.material = m;
            await Promise.resolve(R.compileAsync(P.quad, P.quadCam, P.quadScene)).catch(() => {});
          }
          this.postCompiled = true;
        })();
    }
    if (!this.postCompiled) return null;
    P.r = R;
    if (P.w !== innerWidth || P.h !== innerHeight || P.pr !== R.getPixelRatio()) {
      P.resize(innerWidth, innerHeight);
      P.pr = R.getPixelRatio();
    }
    P.bloom = !!gfx.bloom;
    this.grade();
    return P;
  }

  grade() {
    const u = this.lens.uniforms,
      sc = lighting.sunColor.value,
      top = Math.max(1e-3, sc.r, sc.g, sc.b),
      k = GRADE.sun,
      real = this.realDt || 0.016;
    u.tint.value.setRGB(1 + (sc.r / top - 1) * k, 1 + (sc.g / top - 1) * k, 1 + (sc.b / top - 1) * k);
    u.sat.value = GRADE.sat;
    u.contrast.value = GRADE.contrast;
    u.vignette.value = GRADE.vignette;
    const focus = typeof globalThis.shooterFocus === 'number' ? globalThis.shooterFocus : globalThis.shooterFocus === false ? 0 : 1,
      aim = this.state === 'alive' && this.zoom && focus > 0 && !(this.role === 'scout' && !this.seatOf());
    this.focusK += ((aim ? focus : 0) - this.focusK) * Math.min(1, real * GRADE.focus);
    u.focus.value = this.focusK < 0.01 ? 0 : this.focusK;
    const L = this.lastLook || (this.lastLook = { yaw: this.yaw, pitch: this.pitch });
    let mx = 0,
      my = 0;
    const blur = typeof globalThis.shooterBlur === 'number' ? globalThis.shooterBlur : globalThis.shooterBlur ? 1 : 0;
    if (blur > 0 && this.state === 'alive') {
      const cam = this.game.camera,
        fy = (cam.fov * Math.PI) / 180,
        fx = 2 * Math.atan(Math.tan(fy / 2) * cam.aspect);
      mx = (wrap(this.yaw - L.yaw) / fx) * GRADE.motion * blur;
      my = (-(this.pitch - L.pitch) / fy) * GRADE.motion * blur;
      const l = Math.hypot(mx, my);
      if (l > GRADE.motionMax) {
        mx *= GRADE.motionMax / l;
        my *= GRADE.motionMax / l;
      }
    }
    u.motion.value.set(mx, my);
    L.yaw = this.yaw;
    L.pitch = this.pitch;
  }

  shadowBox(size) {
    if ((this.state !== 'alive' && !(this.benchN && this.watched)) || !this.eyeAt) return null;
    const half = SHADOW.half,
      tx = (2 * half) / Math.max(1, size),
      x = this.eyeAt.x + Math.cos(this.yaw) * half * SHADOW.ahead,
      y = this.eyeAt.y + Math.sin(this.yaw) * half * SHADOW.ahead;
    return { x: Math.round(x / tx) * tx, y: Math.round(y / tx) * tx, half };
  }

  flashAt(s) {
    const c = s.w && s.w.proj ? categoryOf(s.w.proj) : -1;
    if (c !== CAT.ROCKET && c !== CAT.MPTL_ROCKET && c !== CAT.MISSILE && c !== CAT.GRENADE && c !== CAT.BOMB) return;
    this.flashes.push({ x: s.x, y: s.y, z: (s.z ?? heightAt(this.world.terrain, s.x, s.y)) + 6, until: performance.now() + GLOW.blastTime * 1000 });
    if (this.flashes.length > 6) this.flashes.shift();
  }

  tintOf(P) {
    let t = this.boltTint.get(P);
    if (!t) {
      const n = P.name;
      t = /green/i.test(n) ? [0.35, 1, 0.4] : /blue/i.test(n) ? [0.4, 0.6, 1] : /red/i.test(n) ? [1, 0.3, 0.2] : [1, 0.65, 0.3];
      this.boltTint.set(P, t);
    }
    return t;
  }

  feedGround() {
    const U = this.groundU[0];
    if (!U) return;
    const w = this.world,
      E = this.eyeAt,
      G = U.glowAt.value,
      C = U.glowTint.value,
      O = U.occAt.value,
      now = performance.now(),
      R2 = GLOW.reach * GLOW.reach;
    let n = 0;
    this.flashes = this.flashes.filter(f => now < f.until);
    for (const f of this.flashes) {
      if (n >= GLOW.slots) break;
      const k = (f.until - now) / (GLOW.blastTime * 1000);
      G[n].set(f.x, f.y, f.z, GLOW.blast);
      C[n++].set(1, 0.7, 0.35, GLOW.blastPower * k);
    }
    if (E && n < GLOW.slots) {
      const near = this.nearShots || (this.nearShots = []);
      near.length = 0;
      for (const s of w.shots) {
        if (s.done || s.hidden || !s.w || !s.w.proj) continue;
        const d2 = (s.x - E.x) ** 2 + (s.y - E.y) ** 2;
        if (d2 < R2) near.push(d2, s);
      }
      while (n < GLOW.slots && near.length) {
        let bi = 0;
        for (let i = 2; i < near.length; i += 2) if (near[i] < near[bi]) bi = i;
        const s = near[bi + 1],
          t = this.tintOf(s.w.proj);
        near.splice(bi, 2);
        G[n].set(s.x, s.y, s.z ?? heightAt(w.terrain, s.x, s.y) + 6, GLOW.radius);
        C[n++].set(t[0], t[1], t[2], GLOW.power);
      }
    }
    {
      const A = boltLights.boltAt.value,
        B = boltLights.boltTint.value;
      for (let i = 0; i < n; i++) {
        A[i].copy(G[i]);
        B[i].copy(C[i]);
      }
      boltLights.boltN.value = n;
    }
    for (; n < GLOW.slots; n++) G[n].w = 0;
    let m = 0;
    if (E) {
      const RR = OCCLUDE.reach;
      for (const u of w.units) {
        if (m >= OCCLUDE.slots) break;
        if (u.dead || u.inside || u.flies || u.structure || !u.holder || !u.holder.visible || Math.abs(u.x - E.x) > RR || Math.abs(u.y - E.y) > RR) continue;
        const foot = u.foot;
        O[m++].set(u.x, u.y, foot ? OCCLUDE.foot : Math.max(8, u.hitRadius * OCCLUDE.car), foot ? OCCLUDE.footPower : OCCLUDE.carPower);
      }
    }
    for (; m < OCCLUDE.slots; m++) O[m].z = 0;
  }

  clutter() {
    const g = this.game,
      w = this.world,
      E = this.eyeAt,
      props = g.props;
    if (!props || !E || this.clutterN >= CLUTTER.max) return;
    const R = CLUTTER.reach,
      add = [];
    for (const p of props) {
      if (p.clutter || this.cluttered.has(p) || p.scriptHidden || !p.inst || !p.grp || p.grp.parent !== g.scene) continue;
      if (Math.abs(p.x - E.x) > R || Math.abs(p.y - E.y) > R) continue;
      this.cluttered.add(p);
      const r = (p.inst.radius || 0) * p.grp.scale.x;
      if (!(r > 0) || r > CLUTTER.maxR || (p.inst.skins && p.inst.skins.length) || (g.propAnims || []).some(a => a.grp === p.grp)) continue;
      for (let i = 0; i < CLUTTER.copies && this.clutterN < CLUTTER.max; i++) {
        const a = Math.random() * Math.PI * 2,
          d = CLUTTER.ring[0] + Math.random() * (CLUTTER.ring[1] - CLUTTER.ring[0]),
          x = p.x + Math.cos(a) * d,
          y = p.y + Math.sin(a) * d;
        if (!w.isOpen(x, y, 1)) continue;
        const c = p.grp.clone();
        c.position.set(x, y, heightAt(w.terrain, x, y) + (p.grp.position.z - heightAt(w.terrain, p.x, p.y)));
        c.rotation.z = Math.random() * Math.PI * 2;
        c.scale.multiplyScalar(0.7 + Math.random() * 0.4);
        c.matrixAutoUpdate = true;
        c.updateMatrixWorld(true);
        c.traverse(o => {
          o.matrixAutoUpdate = false;
        });
        c.matrixWorldAutoUpdate = false;
        c.userData.casts = true;
        g.scene.add(c);
        add.push({ grp: c, holder: c, inst: p.inst, x, y, scriptHidden: false, clutter: true });
        this.clutterN++;
      }
    }
    for (const e of add) props.push(e);
  }

  vehicleFeel(u, dt) {
    if (u !== this.rideLead || !this.rideQ || u.flies || !u.holder || !(dt > 0)) return;
    const F = this.feel,
      T = this.world.terrain;
    if (F.u !== u) {
      F.u = u;
      F.h = u.heading;
      F.v = u.v || 0;
      F.roll = F.pitch = F.phase = 0;
      F.step = 0;
    }
    const sp = Math.max(1, u.speed),
      rate = wrap(u.heading - F.h) / dt,
      acc = ((u.v || 0) - F.v) / dt,
      k = Math.min(1, (u.v || 0) / sp);
    F.h = u.heading;
    F.v = u.v || 0;
    const lim = a => Math.max(-FEEL.max, Math.min(FEEL.max, a));
    F.roll += (lim(-rate * k * FEEL.roll) - F.roll) * Math.min(1, dt * FEEL.settle);
    F.pitch += (lim((-acc / sp) * FEEL.pitch * 3) - F.pitch) * Math.min(1, dt * FEEL.settle * 0.8);
    let sway = 0;
    const stomp = this.stompOf(u);
    if (stomp) {
      const was = Math.floor(F.phase / Math.PI);
      F.phase += ((u.v || 0) * dt * Math.PI) / FEEL.stride;
      sway = Math.sin(F.phase) * FEEL.sway * k;
      if (Math.floor(F.phase / Math.PI) !== was && k > 0.1) {
        this.shake = Math.max(this.shake, FEEL.shake);
        this.game.audio.play(stomp, u.x, u.y);
      }
    }
    const L = u.loco,
      c = Math.cos(u.heading),
      sn = Math.sin(u.heading),
      a = L && L.len > 0 ? L.len / 2 : 0,
      b = L && L.wid > 0 ? L.wid / 2 : 0,
      fz = a > 0 ? heightAt(T, u.x + c * a, u.y + sn * a) - heightAt(T, u.x - c * a, u.y - sn * a) : 0,
      sz = b > 0 ? heightAt(T, u.x - sn * b, u.y + c * b) - heightAt(T, u.x + sn * b, u.y - c * b) : 0,
      gx = a > 0 ? fz / (2 * a) : 0,
      gy = b > 0 ? sz / (2 * b) : 0;
    _nu.set(-(gx * c - gy * sn), -(gx * sn + gy * c), 1).normalize();
    u.holder.quaternion
      .copy(_tq.setFromUnitVectors(_Z, _nu))
      .multiply(_q.setFromAxisAngle(_Z, u.heading + Math.PI / 2))
      .multiply(_q.setFromAxisAngle(_Y, F.roll + sway))
      .multiply(_q.setFromAxisAngle(_X, F.pitch));
  }

  stompOf(u) {
    const t = u.type;
    if (this.stomps.has(t)) return this.stomps.get(t);
    let name = '';
    const parts = t.name.toUpperCase().split('_');
    for (let n = parts.length; n > 0 && !name; n--) {
      const k = `UNIT_ANIM_${parts.slice(0, n).join('_')}_FOOT_PLANT`;
      if (db.sfx.get(k)) name = k;
    }
    if (!name && /walker/i.test(t.str('MovementClass'))) name = db.sfx.get('UNIT_ANIM_AT_ST_FOOT_PLANT') ? 'UNIT_ANIM_AT_ST_FOOT_PLANT' : '';
    this.stomps.set(t, name);
    return name;
  }

  heightOfSeat(v) {
    const B = this.seatBox;
    if (B.u !== v) {
      B.u = v;
      _box.setFromObject(v.holder);
      B.top = Math.max(4, _box.max.z - v.z);
      B.len = Math.max(4, Math.hypot(_box.max.x - _box.min.x, _box.max.y - _box.min.y) * 0.5);
      B.z = null;
    }
    return B.top;
  }

  seatView(v, d, real = 0.016) {
    const B = this.seatBox;
    this.heightOfSeat(v);
    if (this.gunQ && v === this.gunQ.members[0]) {
      const bone = v.turret?.barrel || v.guns?.find(g => g.muzzles && g.muzzles.length)?.muzzles[0]?.bone || v.weapon?.muzzles?.[0]?.bone;
      if (bone) {
        bone.updateWorldMatrix(true, false);
        _sv.setFromMatrixPosition(bone.matrixWorld);
        return _sv.set(_sv.x + d.x * 5, _sv.y + d.y * 5, Math.max(_sv.z + 2, v.z + B.top + 3) + d.z * 5);
      }
    }
    const c = Math.cos(v.heading),
      s = Math.sin(v.heading),
      tall = !v.flies && B.top > v.hitRadius * RIDE_CAM.tall,
      want = v.z + B.top * (tall ? RIDE_CAM.eye : 0.95) + 1.5;
    B.z = B.z === null || Math.abs(want - B.z) > B.top * 0.5 ? want : B.z + (want - B.z) * Math.min(1, real * RIDE_CAM.settle);
    const ahead = B.len * (tall ? RIDE_CAM.ahead : 0.35);
    return _sv.set(v.x + c * ahead, v.y + s * ahead, B.z);
  }

  damageFx() {
    const w = this.world,
      now = w.time,
      at = this.eyeAt,
      R = DAMAGE_FX.reach,
      fx = name => (db.type(name) ? name : '');
    if (!w.onFx) return;
    this.fxNames ||= { smoke: fx(DAMAGE_FX.smokeFx), fire: fx(DAMAGE_FX.fireFx), big: fx(DAMAGE_FX.bigFx) };
    const N = this.fxNames;
    for (const u of w.units) {
      if (u.dead || u.structure || u.foot || u.flies || u.inside || !(u.speed > 0) || (u.kind !== 'VEHICLE' && u.kind !== 'AIR')) continue;
      if (u.health >= u.maxHealth * DAMAGE_FX.smoke || Math.abs(u.x - at.x) > R || Math.abs(u.y - at.y) > R) continue;
      if (this.cockpit && this.rideQ && u === this.rideQ.members[0]) continue;
      const top = u.z + Math.max(u.aimZ || 0, u.hitRadius * 0.6, 6),
        back = u.hitRadius * 0.5,
        rx = u.x - Math.cos(u.heading) * back,
        ry = u.y - Math.sin(u.heading) * back;
      const own = u.type.str('Damaged_Smoke_Asset_Name');
      if (N.smoke || own) w.onFx(own || N.smoke, rx, ry, top);
      if (u.health < u.maxHealth * DAMAGE_FX.fire && N.fire) w.onFx(N.fire, rx, ry, top - 2);
    }
    this.wrecks = this.wrecks.filter(r => now < r.until);
    for (const r of this.wrecks) {
      if (Math.abs(r.x - at.x) > R || Math.abs(r.y - at.y) > R) continue;
      if (N.fire && now < r.until - WRECK.fade * 2) w.onFx(N.fire, r.x, r.y, r.z);
      if (N.big || N.smoke) w.onFx(N.big || N.smoke, r.x, r.y, r.z + 4);
    }
  }

  wrecked(u) {
    if (u.structure || u.foot || u.flies || u.side < 0 || (u.kind !== 'VEHICLE' && u.kind !== 'AIR') || !(u.speed > 0)) return;
    const w = this.world;
    if (u.vanish) u.vanish = false;
    if (u.lieFor !== Infinity) u.lieFor = Math.max(u.lieFor || 0, WRECK.time);
    u.fadeTime = Math.max(u.fadeTime || 0, WRECK.fade);
    this.wrecks.push({ x: u.x, y: u.y, z: heightAt(w.terrain, u.x, u.y) + Math.max(4, (u.aimZ || 6) * 0.6), until: w.time + WRECK.time });
  }

  vehicleWarning(v) {
    const w = this.world;
    let msg = '';
    for (const s of w.shots) {
      if (s.done || s.target !== v || !s.from || !w.enemy(v, s.from)) continue;
      const c = categoryOf(s.w.proj);
      if (c === CAT.ROCKET || c === CAT.MPTL_ROCKET || c === CAT.MISSILE) {
        msg = 'MISSILE INCOMING';
        break;
      }
    }
    if (!msg)
      for (const u of this.bots.keys())
        if (!u.dead && u.target === v && this.antiArmor(u) && w.enemy(v, u)) {
          msg = 'LOCK-ON WARNING';
          break;
        }
    return msg;
  }

  drawVehicleHud(now) {
    const seat = this.rideQ || this.gunQ,
      v = seat ? seat.members[0] : null,
      E = this.vhud;
    if (!v || v.dead) {
      if (E.style.display !== 'none') E.style.display = 'none';
      this.warning = '';
      return;
    }
    E.style.display = 'block';
    const w = this.world,
      hull = Math.max(0, Math.min(1, v.health / (v.maxHealth || 1))),
      sh = v.maxShield > 0 ? Math.max(0, Math.min(1, v.shield / v.maxShield)) : -1,
      wp = v.weapon || (v.guns && v.guns[0]),
      ready = wp ? 1 - Math.max(0, Math.min(1, (wp.cooldown || 0) / Math.max(0.1, (wp.recharge || 1) * w.fireDelay(v)))) : 1,
      spd = Math.round((v.flies ? this.A.v : v.v || 0) * 0.45),
      alt = v.flies ? Math.round((v.z - heightAt(w.terrain, v.x, v.y)) / 8) : null,
      warn = this.vehicleWarning(v);
    this.vhN.textContent = `${this.nameOf(v.type)}${this.gunQ === seat ? '  -  gunner' : ''}`;
    this.vhHull.style.width = `${Math.round(hull * 100)}%`;
    this.vhHull.style.background = hull < DAMAGE_FX.fire ? '#ff4a32' : hull < DAMAGE_FX.smoke ? '#ffa040' : '#5fd27a';
    this.vhShRow.style.display = sh >= 0 ? 'flex' : 'none';
    if (sh >= 0) this.vhSh.style.width = `${Math.round(sh * 100)}%`;
    this.vhWp.style.width = `${Math.round(ready * 100)}%`;
    const info = `${spd} km/h${alt !== null ? `   ALT ${alt} m` : ''}${this.A.boost && v.flies ? '   BOOST' : ''}`;
    if (this.vhInfo.textContent !== info) this.vhInfo.textContent = info;
    if (warn !== this.warning) {
      this.warning = warn;
      this.vhWarn.textContent = warn;
      this.vhWarn.style.display = warn ? 'block' : 'none';
    }
    if (warn && now >= this.warnAt) {
      this.warnAt = now + WARN.beep * 1000 * (warn === 'MISSILE INCOMING' ? 0.5 : 1);
      this.sfx('warn');
    }
  }

  light(v) {
    return !!v && (v.flies || v.kind === 'AIR' || v.hitRadius < LIGHT_HIT);
  }

  mine(from) {
    const b = this.body;
    return !!b && (from === b || (!!from.squad && (from.squad === this.rideQ || from.squad === this.gunQ)));
  }

  seated() {
    return !!(this.rideQ || this.gunQ || this.post);
  }

  seatOf() {
    return this.rideQ ? this.rideQ.members[0] || this.rideLead : this.gunQ ? this.gunQ.members[0] : this.post;
  }

  gunner(u) {
    if (this.gunQ && u.squad === this.gunQ) return this.gunD;
    return u.squad?.crew?.gunner?.remote ? IDLE_GUN : null;
  }

  listen(L, cam) {
    this.hearing(cam);
    const b = this.body,
      at = this.state === 'alive' && b ? this.seatOf() || b : null;
    if (!at) return;
    L.x = at.x;
    L.y = at.y;
    L.dist = Math.max(40, Math.min(160, Math.hypot(cam.position.x - at.x, cam.position.y - at.y, cam.position.z - at.z)));
  }

  soundSetup() {
    const A = this.game.audio,
      ctx = A && A.ctx;
    if (!ctx || !A.master || this.verbIn) return !!this.verbIn;
    const n = Math.floor(ctx.sampleRate * AUDIO.verb),
      ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    this.verbNode = ctx.createConvolver();
    this.verbNode.buffer = ir;
    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 0;
    this.verbIn.connect(this.verbNode);
    this.verbNode.connect(A.master);
    A.spatial = this;
    return true;
  }

  route(g, x, y) {
    const A = this.game.audio,
      ctx = A.ctx,
      E = this.ear,
      T = this.world.terrain,
      z = heightAt(T, x, y) + 6,
      d = Math.hypot(x - E.x, y - E.y, z - E.z);
    if (!Number.isFinite(d)) {
      g.connect(A.master);
      return;
    }
    let out = g,
      f = d <= AUDIO.air ? 22050 : Math.max(AUDIO.airMin, 22050 * Math.pow(AUDIO.air / d, 0.9));
    if (d > 60 && d < AUDIO.occReach && this.occludes(x, y, z)) {
      f = Math.min(f, AUDIO.muffle);
      g.gain.value *= AUDIO.quiet;
    }
    if (f < 18000) {
      const q = ctx.createBiquadFilter();
      q.type = 'lowpass';
      q.frequency.value = f;
      out.connect(q);
      out = q;
    }
    const p = ctx.createPanner();
    p.panningModel = d < AUDIO.hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'linear';
    p.rolloffFactor = 0;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
    out.connect(p);
    p.connect(A.master);
    if (this.verbIn && this.wet > 0.01) p.connect(this.verbIn);
  }

  occludes(x, y, z) {
    const E = this.ear,
      T = this.world.terrain,
      dx = x - E.x,
      dy = y - E.y,
      dz = z - E.z,
      d = Math.hypot(dx, dy),
      steps = Math.min(16, Math.ceil(d / 60));
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      if (heightAt(T, E.x + dx * k, E.y + dy * k) > E.z + dz * k + 4) return true;
    }
    return false;
  }

  enclosure() {
    const w = this.world,
      T = w.terrain,
      E = this.ear;
    let n = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4,
        c = Math.cos(a),
        s = Math.sin(a);
      if (heightAt(T, E.x + c * 60, E.y + s * 60) > E.z + 20 || heightAt(T, E.x + c * 130, E.y + s * 130) > E.z + 45) n++;
    }
    if (w.time >= this.blockersAt) {
      this.blockersAt = w.time + 1;
      this.blockers = w.units.filter(b => b.structure && !b.dead && b.hitRadius > 14);
    }
    let walls = 0;
    for (const b of this.blockers || []) if (!b.dead && Math.hypot(b.x - E.x, b.y - E.y) < b.hitRadius + 70) walls++;
    return Math.min(1, n / 8 + walls * 0.25);
  }

  hearing(cam) {
    if (!this.soundSetup()) return;
    const A = this.game.audio,
      ctx = A.ctx,
      E = this.ear,
      Lr = ctx.listener;
    cam.getWorldDirection(_fwd);
    E.x = cam.position.x;
    E.y = cam.position.y;
    E.z = cam.position.z;
    E.ready = true;
    if (Lr.positionX) {
      Lr.positionX.value = E.x;
      Lr.positionY.value = E.y;
      Lr.positionZ.value = E.z;
      Lr.forwardX.value = _fwd.x;
      Lr.forwardY.value = _fwd.y;
      Lr.forwardZ.value = _fwd.z;
      Lr.upX.value = 0;
      Lr.upY.value = 0;
      Lr.upZ.value = 1;
    } else {
      Lr.setPosition(E.x, E.y, E.z);
      Lr.setOrientation(_fwd.x, _fwd.y, _fwd.z, 0, 0, 1);
    }
    const now = performance.now() / 1000;
    if (now >= this.wetAt) {
      this.wetAt = now + AUDIO.wetTick;
      this.wet = this.enclosure() * AUDIO.wetMax;
      this.verbIn.gain.setTargetAtTime(this.wet * (A.sfxVolume ?? 0.7), ctx.currentTime, 0.3);
    }
    const b = this.body;
    if (this.state !== 'alive' || !b || b.dead) return;
    this.whizzes(b);
    this.footsteps(b);
  }

  whizzes(b) {
    const w = this.world,
      hz = b.z + this.heightOf(b) * 0.9,
      R = AUDIO.whiz;
    const now = performance.now();
    for (const s of this.passing) {
      if (s.done) {
        this.passing.delete(s);
        continue;
      }
      if ((s.vx || 0) * (s.x - b.x) + (s.vy || 0) * (s.y - b.y) <= 0) continue;
      this.passing.delete(s);
      if (now < this.whizAt) continue;
      this.whizAt = now + AUDIO.whizGap;
      this.whiz(s.x, s.y, s.vx || 0, s.vy || 0);
    }
    for (const s of w.shots) {
      if (s.done || !s.from || s.from.side < 0 || this.whizzed.has(s) || this.mine(s.from) || !w.enemy(b, s.from)) continue;
      if (Math.abs(s.x - b.x) > R || Math.abs(s.y - b.y) > R || Math.hypot(s.x - b.x, s.y - b.y, (s.z ?? hz) - hz) > R) continue;
      this.whizzed.add(s);
      this.passing.add(s);
    }
  }

  whiz(x, y, vx, vy) {
    const A = this.game.audio,
      ctx = A.ctx;
    this.sfx('noise');
    const t = ctx.currentTime,
      src = ctx.createBufferSource(),
      f = ctx.createBiquadFilter(),
      g = ctx.createGain(),
      v = Math.hypot(vx, vy) || 1;
    if (!Number.isFinite(x + y + vx + vy) || !this.noiseBuf) return;
    src.buffer = this.noiseBuf;
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.28);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * (A.sfxVolume ?? 0.7), t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(f);
    f.connect(g);
    this.route(g, x + (vx / v) * 20, y + (vy / v) * 20);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.32);
  }

  stepEvent(u) {
    const T = this.world.terrain,
      L = T.padTop;
    let key = '';
    if (L && u.x >= 0 && u.y >= 0) {
      const i = (u.x / L.cell) | 0,
        j = (u.y / L.cell) | 0;
      if (i < L.w && j < L.w && L.a[j * L.w + i] > 0 && Math.abs(L.a[j * L.w + i] - u.z) < 3) key = 'CONCRETE';
    }
    if (!key) key = STEP_SFX[SURFACES[surfaceAt(T, u.x, u.y)]] || 'DIRT';
    let name = this.stepNames.get(key);
    if (name === undefined) {
      const want = `UNIT_ANIM_${key}_INFANTRY_FOOT_PLANT`;
      name = db.sfx.get(want) ? want : db.sfx.get('UNIT_ANIM_DIRT_INFANTRY_FOOT_PLANT') ? 'UNIT_ANIM_DIRT_INFANTRY_FOOT_PLANT' : '';
      this.stepNames.set(key, name);
    }
    return name;
  }

  footsteps(b) {
    const w = this.world,
      A = this.game.audio,
      T = w.terrain,
      list = [];
    if (!b.inside && b.foot) list.push(b);
    for (const u of w.units) {
        if (u === b || u.dead || u.inside || !u.foot || u.flies || Math.abs(u.x - b.x) > AUDIO.stepReach || Math.abs(u.y - b.y) > AUDIO.stepReach) continue;
        if (Math.hypot(u.x - b.x, u.y - b.y) > AUDIO.stepReach) continue;
        list.push(u);
      if (list.length > AUDIO.stepMax) break;
    }
    const seen = new Set(list);
    for (const u of this.strides.keys()) if (!seen.has(u)) this.strides.delete(u);
    for (const u of list) {
      let s = this.strides.get(u);
      if (!s) this.strides.set(u, (s = { x: u.x, y: u.y, acc: Math.random() * AUDIO.stride }));
      const d = Math.hypot(u.x - s.x, u.y - s.y);
      s.x = u.x;
      s.y = u.y;
      if (d > 30 || u.z > heightAt(T, u.x, u.y) + 2) continue;
      if ((s.acc += d) < AUDIO.stride) continue;
      s.acc = 0;
      const name = this.stepEvent(u);
      if (!name) continue;
      if (u === b) A.forceNext = true;
      A.play(name, u.x, u.y);
    }
  }

  nearFight(x, y) {
    const at = this.state === 'alive' && this.body ? this.body : this.lastCam ? this.lastCam.p : null;
    return !!at && Math.abs(x - at.x) < AUDIO.fight && Math.abs(y - at.y) < AUDIO.fight && Math.hypot(x - at.x, y - at.y) < AUDIO.fight;
  }

  ability(n) {
    const w = this.world,
      sq = this.rideQ || (this.body && this.body.squad);
    if (!sq) return;
    const list = sq.abilities.filter(a => !/^(SELL|UNLOAD|SPREAD_OUT)$/.test(a.def.kind));
    const st = list[n];
    if (!st) return;
    const def = st.def,
      hit = this.aimHit && !this.aimHit.dead ? this.aimHit : null;
    let tgt = null;
    if (def.aim === 'point') tgt = { x: this.aim.x, y: this.aim.y, ...(hit ? { unit: hit } : {}) };
    else if (def.aim && def.aim !== 'none') {
      if (!hit) {
        this.flash('Aim at a target');
        return;
      }
      tgt = { unit: hit };
    }
    if (this.netClient) {
      const Nn = this.game.shooterNet,
        tu = tgt?.unit && Nn?.ids.get(tgt.unit);
      Nn?.session?.send(0, { k: 'sh-ab', n, x: tgt?.x, y: tgt?.y, t: tu || 0 });
      return;
    }
    const why = w.useAbility(sq, def.kind, tgt);
    if (typeof why === 'string' && why) this.flash(why);
  }

  flash(text) {
    this.note(text);
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => this.tip.textContent === text && this.note(''), 1800);
  }

  popup(text, kind = '') {
    const e = document.createElement('div');
    e.className = 'sh-pop' + (kind ? ' ' + kind : '');
    e.textContent = text;
    e.style.marginTop = `${-54 - (this.pops % 3) * 24}px`;
    this.pops++;
    this.hud.appendChild(e);
    setTimeout(() => {
      e.remove();
      this.pops = Math.max(0, this.pops - 1);
    }, 1100);
  }

  creditKill(u) {
    const b = this.body,
      now = performance.now(),
      pts = u.kind === 'INFANTRY' ? SCORE.foot : SCORE.car;
    if (this.role === 'hero' && b && !b.dead) b.health = Math.min(b.maxHealth, b.health + b.maxHealth * HERO.kill);
    this.killUntil = now + 900;
    this.kills++;
    this.matchScore += pts;
    this.popup(`${now < this.headUntil && u.kind === 'INFANTRY' ? 'HEADSHOT' : 'KILL'} +${pts}`, 'kill');
  }

  creditAssist(u, dealt) {
    const full = u.kind === 'INFANTRY' ? SCORE.foot : SCORE.car,
      raw = (Math.min(1, dealt / Math.max(1, u.maxHealth)) * full) / SCORE.assistStep,
      pts = Math.max(SCORE.assistMin, Math.min(Math.round(full * SCORE.assistMax / 100), Math.round(raw) * SCORE.assistStep));
    this.assists++;
    this.matchScore += pts;
    this.popup(`ASSIST +${pts}`, 'assist');
  }

  hurtSeen(u, from) {
    const b = this.body;
    if (!b || !from || from.x === undefined || from === b) return;
    if (u !== b && !(this.rideQ && u.squad === this.rideQ)) return;
    const now = performance.now(),
      list = this.hurtMarks;
    this.lastHitBy = from;
    this.lastHitAt = this.world.time;
    const old = list.find(m => m.from === from);
    if (old) old.at = now;
    else {
      list.push({ from, at: now });
      if (list.length > 4) list.shift();
    }
  }

  tick(dt) {
    const w = this.world;
    if (!this.padsDone && w.points.length) {
      this.padsDone = true;
      this.padLayer();
      this.rockLayer();
    }
    if (!this.hooked) {
      this.hooked = true;
      const prev = w.onImpact;
      w.onImpact = s => {
        if (prev) prev(s);
        this.impact(s);
      };
      this.hook();
      w.onScriptSpawn = (q, by) => this.scriptSpawned(q, by);
      const shotWas = w.onShot;
      w.onShot = s => {
        if (shotWas) shotWas(s);
        this.shotFired(s);
      };
      const cap = w.onCapture;
      w.onCapture = (pt, was) => {
        if (cap) cap(pt, was);
        this.captured(pt, was);
      };
      const hurt = w.hurt;
      w.hurt = (u, amount, from, how, shot) => {
        if (amount > 0) {
          this.hurtSeen(u, from);
          if (u === this.body || (this.rideQ && u.squad === this.rideQ)) this.hurtMe(amount);
          if (!u.dead && from) this.react(u, from.inside && from.inside.x !== undefined && !from.gunner ? from.inside : from);
        }
        const hp0 = u.health,
          mineHit = amount > 0 && !!from && this.mine(from) && u.side >= 0 && !w.ally(u.side, this.me) && !u.structure,
          peerHit = amount > 0 && from?.remote && u.side >= 0 && !w.ally(u.side, from.side) && !u.structure ? from.remote.peer : null;
        const r = hurt.call(w, u, amount, from, how, shot);
        if (mineHit) this.dealt.set(u, (this.dealt.get(u) || 0) + Math.max(0, hp0 - Math.max(0, u.health)));
        if (peerHit !== null) {
          let D = this.peerDealt.get(u);
          if (!D) this.peerDealt.set(u, (D = new Map()));
          D.set(peerHit, (D.get(peerHit) || 0) + Math.max(0, hp0 - Math.max(0, u.health)));
        }
        if (u.dead && !this.counted.has(u)) {
          this.counted.add(u);
          if (u.side >= 0 && !w.ally(u.side, this.me)) {
            if (from && this.mine(from)) this.creditKill(u);
            else if (!u.structure && (this.dealt.get(u) || 0) > 0) this.creditAssist(u, this.dealt.get(u));
          }
          this.peerCredit(u, from, shot);
          if (u.side >= 0) this.losses[u.side] = (this.losses[u.side] || 0) + 1;
          if (this.tickets && u.side >= 0 && u.side < this.tickets.length && !u.structure)
            this.spend(u.side, u.kind === 'INFANTRY' ? TICKETS.foot : TICKETS.vehicle, this.conquest?.ready ? u : null);
          if (from && this.mine(from) && u.side >= 0 && !w.ally(u.side, this.me) && u.kind !== 'INFANTRY' && !u.structure) this.stats.vehicles++;
          if (u.side >= 0 && !u.structure && u.side !== w.wild && !u.squad?.native) this.logKill(from, u);
          this.wrecked(u);
          if (u.structure) this.rocksDirty = true;
        }
        return r;
      };
    }
    if (this.state === 'alive' && this.body && this.body.dead) this.died();
    if (this.rideQ && (this.rideQ.dead || !this.rideQ.members.length)) this.leave(true);
    if (this.gunQ && (this.gunQ.dead || !this.gunQ.members.length)) this.leave(true);
    if (this.post && this.post.dead) this.leave(true);
    const b0 = this.body;
    if (this.post && b0 && !b0.dead && b0.weapon) {
      const wp = b0.weapon;
      wp.cooldown -= dt;
      if (this.fire && this.canFire()) {
        this.jitter(b0);
        w.burst(b0, this.spot, wp, dt);
      }
    }
    for (const q of this.crewed) {
      const C = q.crew;
      if (q.dead || !q.members.length) {
        const lightV = this.light(this.lastOf.get(q));
        for (const c of [C.in, C.gunner]) {
          if (!c || c === this.body || c.dead) continue;
          if (lightV) {
            c.inside = undefined;
            c.holder.visible = true;
            w.hurt(c, 1e9, null);
          } else this.eject(c, q, true);
        }
        C.gunner = null;
        for (const c of [C.claim, C.gunClaim]) if (c && !c.dead) c.squad.noAI = false;
        this.crewed.delete(q);
        continue;
      }
      if (q.members[0]) this.lastOf.set(q, q.members[0]);
      if (C.gunner && C.gunner.dead) C.gunner = null;
      const gc = C.gunClaim;
      if (gc && (gc.dead || gc.inside || gc.pilot || C.gunner)) {
        if (!gc.dead && !gc.inside) gc.squad.noAI = false;
        C.gunClaim = null;
      }
      if (C.gunClaim) {
        const v = q.members[0],
          c = C.gunClaim;
        if (Math.hypot(c.x - v.x, c.y - v.y) <= v.hitRadius * 2 + 30) this.seat(c, q);
        else if (w.time >= C.gunAt) {
          C.gunAt = w.time + 1.5;
          w.order(c.squad, v.x, v.y);
        }
      }
      if (C.in) {
        if (C.in.dead) {
          C.in = null;
          q.noAI = true;
        }
        continue;
      }
      const c = C.claim;
      if (c && (c.dead || c.inside || c.pilot)) C.claim = null;
      if (!C.claim) continue;
      const v = q.members[0],
        d = Math.hypot(c.x - v.x, c.y - v.y);
      if (d <= v.hitRadius * 2 + 30) this.board(c, q);
      else if (w.time >= C.at) {
        C.at = w.time + 1.5;
        w.order(c.squad, v.x, v.y);
      }
    }
    if (this.tickets && w.time >= this.bleedAt) {
      this.bleedAt = w.time + TICKETS.bleed;
      this.bleed();
    }
    if (w.time >= this.fxAt) {
      this.fxAt = w.time + DAMAGE_FX.every;
      this.damageFx();
    }
    if (w.time >= this.directAt) {
      this.directAt = w.time + TEAM.tick;
      this.organize();
    }
    if (w.time >= this.botAt) {
      this.botAt = w.time + BOT_TICK;
      this.think();
    }
    this.spreadOut(dt);
    if (w.time >= this.crewAt) {
      this.crewAt = w.time + 1;
      if (this.conquest) {
        if (!this.conquest.ready) this.conquestSetup();
        else {
          this.conquestMap();
          this.conquestTally();
          this.crewVehicles();
        }
      }
      this.claimCrews();
      this.homeDrops();
      this.lastStand();
      this.evenStats();
      let ns = 0;
      for (const u of w.units) if (u.structure && !u.dead && !u.gone) ns++;
      if (ns !== this.structN) {
        if (this.structN !== undefined) this.rocksDirty = true;
        this.structN = ns;
      }
      if (this.rocksDirty) this.rockLayer();
    }
    this.coolGun(dt);
    if (w.time >= this.historyAt && this.tickets) {
      this.historyAt = w.time + 5;
      this.history.push([w.time, ...this.tickets]);
      this.warnLow();
    }
    if (w.time >= this.regenAt) {
      this.regenAt = w.time + REGEN.tick;
      this.regen();
    }
    if (w.time >= this.respawnAt) {
      this.respawnAt = w.time + 0.5;
      this.respawnBots();
    }
    if (this.state === 'dead' && !this.game.over && w.time >= this.deadAt + DEATH_CAM && this.panel.style.display === 'none') this.respawnView();
    this.refreshDeploy();
    this.ov?.tickHeld();
    this.drawTickets();
  }

  clientTick(dt) {
    const w = this.world;
    if (this.state === 'alive' && this.body && this.body.dead) this.died();
    if (this.rideQ && (this.rideQ.dead || !this.rideQ.members.length || this.rideQ.members.every(m => m.dead))) this.leave(true);
    if (!this.heroSaid && this.matchScore >= this.heroAt) {
      this.heroSaid = true;
      this.announce('Hero unlocked - choose one at your next deploy', 'good');
    }
    if (w.time >= this.fxAt) {
      this.fxAt = w.time + DAMAGE_FX.every;
      this.damageFx();
    }
    if (w.time >= this.crewAt) {
      this.crewAt = w.time + 1;
      let ns = 0;
      for (const u of w.units) if (u.structure && !u.dead && !u.gone) ns++;
      if (ns !== this.structN) {
        if (this.structN !== undefined) this.rocksDirty = true;
        this.structN = ns;
      }
      if (this.rocksDirty && this.padsDone) this.rockLayer();
    }
    if ((this.gunQ && (this.gunQ.dead || !this.gunQ.members.length)) || (this.post && this.post.dead)) this.leave(true);
    const b0 = this.body;
    if (this.post && b0 && !b0.dead && b0.weapon) {
      const wp = b0.weapon;
      wp.cooldown -= dt;
      if (this.fire && this.canFire()) {
        this.jitter(b0);
        w.burst(b0, this.spot, wp, dt);
      }
    }
    this.coolGun(dt);
    if (w.time >= this.historyAt && this.tickets) {
      this.historyAt = w.time + 5;
      this.history.push([w.time, ...this.tickets]);
      this.warnLow();
    }
    if (this.state === 'dead' && !this.game.over && w.time >= this.deadAt + DEATH_CAM && this.panel.style.display === 'none') this.respawnView();
    this.refreshDeploy();
    this.ov?.tickHeld();
    this.drawTickets();
  }

  claimCrews() {
    const w = this.world,
      taken = new Set();
    for (const q of this.crewed) {
      if (q.crew.claim) taken.add(q.crew.claim);
      if (q.crew.gunClaim) taken.add(q.crew.gunClaim);
    }
    for (const q of this.crewed) {
      const C = q.crew;
      const needGun = C.in && C.guns && !C.gunner && !C.gunClaim && this.gunQ !== q && this.rideQ !== q;
      if (!needGun && (C.in || C.claim)) continue;
      const v = q.members[0];
      if (!C.in && v && v.health < v.maxHealth * VEH.bail) continue;
      let best = null,
        bd = CREW_REACH;
      for (const s of w.squads) {
        const m = s.members[0];
        if (s.side !== q.side || s.members.length !== 1 || !m || m.dead || m.inside || m.pilot || m.kind !== 'INFANTRY') continue;
        if (s.noAI || s.entering || s.arriving || taken.has(m) || inCategory(m.type, 'HERO') || m.type.bool('Is_Named_Hero')) continue;
        const d = Math.hypot(m.x - v.x, m.y - v.y);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      if (best) {
        if (needGun) {
          C.gunClaim = best;
          C.gunAt = 0;
        } else {
          C.claim = best;
          C.at = 0;
        }
        best.squad.noAI = true;
        taken.add(best);
      }
    }
  }

  board(u, q) {
    const v = q.members[0];
    u.inside = v;
    u.gunner = false;
    u.path.length = 0;
    u.target = null;
    u.holder.visible = false;
    if (q.crew) {
      q.crew.in = u;
      q.crew.claim = null;
    }
    if (u !== this.body) q.noAI = false;
  }

  seat(u, q) {
    const v = q.members[0];
    u.inside = v;
    u.gunner = false;
    u.path.length = 0;
    u.target = null;
    u.holder.visible = false;
    q.crew.gunner = u;
    q.crew.gunClaim = null;
  }

  manned(u) {
    const q = u.squad,
      C = q && q.crew;
    if (!C) return true;
    return !!C.gunner || this.rideQ === q || this.gunQ === q;
  }

  eject(u, q, hurt) {
    const w = this.world,
      v = q.members[0] || u.inside;
    u.inside = undefined;
    const a = (v?.heading || 0) + Math.PI / 2,
      r = (v?.hitRadius || 10) + 12,
      o = w.nearestOpen((v?.x ?? u.x) + Math.cos(a) * r, (v?.y ?? u.y) + Math.sin(a) * r) || { x: u.x, y: u.y };
    u.x = o.x;
    u.y = o.y;
    u.z = heightAt(w.terrain, u.x, u.y);
    u.holder.position.set(u.x, u.y, u.z);
    u.holder.visible = true;
    if (hurt) u.health = Math.max(1, Math.min(u.health, u.maxHealth * 0.3));
    if (u !== this.body) u.squad.noAI = false;
    if (q.crew && q.crew.in === u) {
      q.crew.in = null;
      if (!q.dead) q.noAI = true;
    }
    if (q.crew && q.crew.gunner === u) q.crew.gunner = null;
  }

  near(v, pad) {
    const b = this.body;
    return Math.hypot(v.x - b.x, v.y - b.y) - v.hitRadius < pad;
  }

  enter() {
    const b = this.body,
      w = this.world;
    if (!b || b.inside) return;
    if (this.netClient) return this.netEnter();
    let best = null,
      bd = Infinity;
    for (const q of this.crewed) {
      const v = q.members[0];
      if (!v || q.crew.in || q.side !== this.me) continue;
      const d = Math.hypot(v.x - b.x, v.y - b.y) - v.hitRadius;
      if (d < 45 && d < bd) {
        bd = d;
        best = q;
      }
    }
    if (best) return this.drive(best);
    for (const q of this.crewed) {
      const v = q.members[0];
      if (v && q.crew.in && q.side === this.me && v.guns && v.guns.length && !q.crew.gunner && this.near(v, 45)) return this.takeGun(q);
    }
    for (const h of w.units) {
      if (h.dead || !h.slots || h.side !== this.me || !this.near(h, 60) || !canGarrison(w, b.squad, h)) continue;
      if (!putInside(w, b.squad, h)) continue;
      b.gunner = false;
      this.post = h;
      this.yaw = h.heading || this.yaw;
      this.note(`${this.nameOf(h.type)}: fire from inside, ${this.keyText('SHOOTER_ENTER')} to get out`);
      return;
    }
  }

  keyText(id) {
    return keyName(keysOf(id)[0] || null);
  }

  drive(q) {
    const b = this.body;
    if (q.crew?.claim) {
      q.crew.claim.squad.noAI = false;
      q.crew.claim = null;
    }
    this.board(b, q);
    const lead = q.members[0];
    const D = { turn: 0, throttle: 0, firing: false, target: null, lead, spot: this.spot, far: true };
    D.slots = new Map();
    q.direct = D;
    for (const m of q.members) m.direct = D;
    q.foe = null;
    for (const m of q.members) {
      m.path = [];
      m.target = null;
    }
    this.rideQ = q;
    this.rideLead = lead;
    this.yaw = lead.heading;
    if (lead.flies) {
      const A = this.A;
      A.v = 0;
      A.roll = A.tilt = 0;
      A.yaw = lead.heading;
      lead.pilot = A;
      this.pitch = 0.15;
      this.note(
        `${this.nameOf(lead.type)}: mouse to steer and climb, W S speed, ${this.keyText('SHOOTER_SPRINT')} boost, ${this.keyText('SHOOTER_DODGE')} barrel roll, ${this.keyText('SHOOTER_JUMP')} ${this.keyText('SHOOTER_CROUCH')} up and down, ${this.keyText('SHOOTER_ENTER')} to get out`
      );
    } else this.note(`${this.nameOf(lead.type)}: W S to drive, A D to turn, mouse to aim, ${this.keyText('DIRECT_VIEW')} cockpit view, ${this.keyText('SHOOTER_ENTER')} to get out`);
  }

  takeGun(q) {
    const b = this.body,
      v = q.members[0];
    b.inside = v;
    b.gunner = false;
    b.path.length = 0;
    b.target = null;
    b.holder.visible = false;
    this.gunQ = q;
    if (q.crew?.gunClaim) {
      q.crew.gunClaim.squad.noAI = false;
      q.crew.gunClaim = null;
    }
    if (q.crew) q.crew.gunner = b;
    this.gunD = { turn: 0, throttle: 0, firing: false, target: null, lead: v, slots: new Map(), spot: this.spot, far: true };
    this.note(`${this.nameOf(v.type)} gunner: mouse to aim, ${this.keyText('DIRECT_VIEW')} barrel view, ${this.keyText('SHOOTER_ENTER')} to get out`);
  }

  leave(lost = false) {
    const b = this.body,
      w = this.world,
      alive = b && !b.dead;
    if (this.netClient && (this.rideQ || this.gunQ || this.post)) this.game.shooterNet?.session?.send(0, { k: 'sh-exit' });
    if (this.netClient && this.post) {
      const h = this.post;
      this.post = null;
      if (alive && b.inside === h) this.eject(b, { members: [h] }, false);
    }
    if (this.rideQ) {
      const q = this.rideQ,
        v = q.members[0] || this.rideLead;
      for (const m of q.members) {
        m.direct = null;
        if (m.pilot === this.A) m.pilot = undefined;
        if (m.flies && !m.dead) {
          m.holder.rotation.x = 0;
          m.holder.rotation.y = 0;
        }
      }
      q.direct = null;
      this.rideQ = null;
      this.rideLead = null;
      if (alive && b.inside) {
        if (lost && this.light(v)) {
          b.inside = undefined;
          b.holder.visible = true;
          w.hurt(b, 1e9, null);
        } else this.eject(b, q, lost);
      } else if (q.crew) q.crew.in = null;
    }
    if (this.gunQ) {
      const q = this.gunQ,
        v = q.members[0] || b?.inside;
      this.gunQ = null;
      this.gunD = null;
      if (q.crew && q.crew.gunner === b) q.crew.gunner = null;
      if (alive && b.inside) {
        if (lost && this.light(v)) {
          b.inside = undefined;
          b.holder.visible = true;
          w.hurt(b, 1e9, null);
        } else this.eject(b, q, lost);
      }
    }
    if (this.post) {
      const h = this.post;
      this.post = null;
      if (alive && b.inside === h) {
        if (h.dead) {
          b.inside = undefined;
          this.eject(b, { members: [h] }, true);
          h.holds = (h.holds || []).filter(q => q !== b.squad);
        } else ungarrison(w, h, null, null, b.squad);
        b.holder.visible = true;
      }
    }
    this.note('');
  }

  nameOf(t) {
    return (t && (db.t(t.str('Text_ID')) || t.name.replace(/_/g, ' '))) || '';
  }

  classes(side = this.me, vehicles = false) {
    const w = this.world,
      faction = this.game.factions[side],
      out = new Map();
    const netCls = this.netClient && this.conquest ? this.game.shooterNet?.netClasses?.[side] : null;
    if (this.conquest?.ready || netCls) {
      if (netCls)
        for (const [cname, uname, spare, gid] of netCls) {
          const t = db.type(cname),
            k = db.type(uname);
          if (t && k) out.set('gid:' + gid, { company: t, unit: k, units: [k], foot: true, cost: 0, gid, spare });
        }
      else for (const c of this.conquestClasses(side)) out.set('gid:' + c.gid, c);
      for (const q of w.squads) {
        const m = q.members[0];
        if (q.side !== side || q.members.length !== 1 || !m || m.dead || m.inside || m.pilot || m.flies || !/infantry/i.test(m.type.str('MovementClass'))) continue;
        if (!(inCategory(m.type, 'HERO') || m.type.bool('Is_Named_Hero'))) continue;
        out.set('hero:' + m.type.name, { company: q.type, unit: m.type, cost: 0, hero: q });
      }
      return [...out.values()];
    }
    for (const u of w.units) {
      if (u.dead || !u.structure || !w.ally(u.side, side)) continue;
      for (const t of buildsFor(u.type, faction, w.campaign)) {
        if (out.has(t.name) || isUpgrade(t) || !t.has('Company_Units') || isHeroCompany(t)) continue;
        const kinds = t
          .list('Company_Units')
          .map(n => db.type(n))
          .filter(Boolean);
        const k = kinds[0];
        if (!k || inCategory(k, 'HERO') || k.bool('Is_Named_Hero')) continue;
        const foot = /infantry/i.test(k.str('MovementClass'));
        if (!foot && !vehicles) continue;
        if (missingFor(w, side, t).length) continue;
        const dummy = this.isDummy(k) ? k : null,
          real = dummy ? this.realOf(dummy) : null;
        out.set(t.name, { company: t, unit: real || k, units: dummy ? this.realTypes(dummy) || kinds : kinds, foot, cost: Math.max(0, Math.round(costOf(t, faction) / Math.max(1, kinds.length))), dummy });
      }
    }
    for (const q of vehicles ? [] : w.squads) {
      const m = q.members[0];
      if (q.side !== side || q.members.length !== 1 || !m || m.dead || m.inside || m.pilot || m.flies || !/infantry/i.test(m.type.str('MovementClass'))) continue;
      if (!(inCategory(m.type, 'HERO') || m.type.bool('Is_Named_Hero'))) continue;
      out.set('hero:' + m.type.name, { company: q.type, unit: m.type, cost: 0, hero: q });
    }
    if (!out.size)
      for (const q of w.squads) {
        const m = q.members[0];
        if (q.side !== side || !m || m.kind !== 'INFANTRY' || inCategory(m.type, 'HERO') || out.has(m.type.name)) continue;
        out.set(m.type.name, { company: q.type, unit: m.type, cost: 0 });
      }
    return [...out.values()];
  }

  points(side = this.me) {
    const w = this.world,
      list = w.points.filter(p => p.reinforce && p.side >= 0 && w.ally(p.side, side)),
      h = this.home(side);
    if (h) list.push(h);
    return list;
  }

  respawnBots() {
    const w = this.world,
      now = w.time,
      T = this.tickets;
    for (let s = 0; s < this.game.factions.length; s++) {
      const q = (this.respawns[s] ||= []);
      if (w.beaten.has(w.team[s]) || (T && T[s] <= 0)) {
        q.length = 0;
        continue;
      }
      let coming = 0;
      for (const t of w.transports) if (t.side === s && t.stage === 'land') coming += this.sizeOf(db.type(t.typeName));
      const want = this.fieldCap() - this.popUsed(s) - coming - q.length - (this.spawningN[s] || 0);
      const delay = this.benchN ? 0 : this.respawnDelay(s);
      for (let i = 0; i < want; i++) q.push(now + delay);
      let n = 0;
      while (q.length && q[0] <= now && n < (this.benchN ? 12 : BOT_RESPAWN.perTick)) {
        if (!this.respawnOne(s)) break;
        q.shift();
        n++;
      }
    }
  }

  respawnOne(s) {
    const w = this.world,
      now = w.time;
    if (now >= (this.optionsAt[s] || 0) || this.conquest?.ready) {
      this.optionsAt[s] = now + 5;
      this.options[s] = this.classes(s, true);
    }
    const opts = this.options[s] || [],
      feet = opts.filter(c => c.foot && !c.hero && (!c.gid || c.spare > 0)),
      cars = opts.filter(c => !c.foot),
      pts = this.points(s);
    if (!feet.length || !pts.length) return false;
    let pick;
    let rides = 0;
    if (cars.length) for (const u of w.units) if (!u.dead && u.side === s && !u.structure && u.speed > 0 && !u.foot) rides++;
    if (cars.length && rides < BOT_RESPAWN.maxVehicles && Math.random() < BOT_RESPAWN.vehicle) pick = cars[Math.floor(Math.random() * cars.length)];
    else {
      const wt = feet.map(c => (c.gid ? Math.max(0.1, c.spare || 0) : 1 / Math.sqrt(c.cost + 20)) * (this.reachOfClass(c) < SHORT.range ? SHORT.weight : 1)),
        sum = wt.reduce((a, b) => a + b, 0);
      let r = Math.random() * sum;
      pick = feet[feet.length - 1];
      for (let i = 0; i < feet.length; i++) if ((r -= wt[i]) <= 0) {
        pick = feet[i];
        break;
      }
    }
    const kinds = pick.units || [pick.unit],
      t = kinds[Math.floor(Math.random() * kinds.length)],
      p = pts[Math.floor(Math.random() * pts.length)],
      a = Math.random() * Math.PI * 2,
      r = 30 + Math.random() * 50,
      o = w.nearestOpen(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, t.str('MovementClass').match(/infantry/i) ? 1 : 3);
    if (!o) return false;
    this.spawningN[s] = (this.spawningN[s] || 0) + 1;
    const pool = pick.gid ? this.conquest?.pools.get(pick.gid) : null;
    if (pool) {
      pool.pending++;
      pick.spare--;
    }
    const face = Math.atan2(w.n * 10 - o.y, w.n * 10 - o.x);
    Promise.resolve(w.spawn(t.name, o.x, o.y, face, s))
      .catch(() => null)
      .then(q => {
        this.spawningN[s] = Math.max(0, (this.spawningN[s] || 1) - 1);
        if (pool) pool.pending = Math.max(0, pool.pending - 1);
        if (q && pick.gid) this.claimFor(q, pick.gid);
      });
    return true;
  }

  hq(side) {
    const w = this.world;
    let h = this.hqs.get(side);
    if (!h || h.dead) {
      h = w.units.find(u => u.isBase && !u.dead && u.side === side) || null;
      this.hqs.set(side, h);
    }
    return h;
  }

  home(side) {
    const h = this.hq(side);
    if (!h) {
      const a = this.conquest && this.game.invasionBook?.anchors?.[side];
      if (!a) return null;
      let p = this.homes.get(side);
      if (!p || p.of !== a) {
        const o = this.world.nearestOpen(a.x, a.y) || { x: a.x, y: a.y };
        p = { x: o.x, y: o.y, side, reinforce: true, home: true, of: a, enable: HOME.reach };
        this.homes.set(side, p);
      }
      return p;
    }
    let p = this.homes.get(side);
    if (!p || p.of !== h) {
      const w = this.world,
        a0 = Math.atan2(w.n * 10 - h.y, w.n * 10 - h.x),
        r = h.hitRadius + HOME.out,
        goals = w.points.filter(q => q.reinforce);
      let best = null,
        bs = -1;
      for (let i = 0; i < HOME.tries; i++) {
        const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * ((Math.PI * 2) / HOME.tries),
          o = w.nearestOpen(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r);
        if (!o) continue;
        let n = 0;
        for (const q of goals) {
          const way = w.route(o.x, o.y, q.x, q.y, 1);
          if (way && way.length) n++;
        }
        if (n > bs) {
          bs = n;
          best = o;
        }
        if (n === goals.length) break;
      }
      const o = best || w.nearestOpen(h.x + Math.cos(a0) * r, h.y + Math.sin(a0) * r) || { x: h.x + r, y: h.y };
      p = { x: o.x, y: o.y, side, reinforce: true, home: true, of: h, enable: HOME.reach };
      this.homes.set(side, p);
    }
    return p;
  }

  nearHome(side, x, y) {
    const w = this.world;
    for (let s = 0; s < w.team.length; s++) {
      if (!w.ally(s, side)) continue;
      const h = this.hq(s);
      if (h && Math.hypot(h.x - x, h.y - y) <= h.hitRadius + HOME.reach) return true;
    }
    return false;
  }

  homeDrops() {
    const w = this.world;
    for (let s = 0; s < this.game.factions.length; s++) {
      const list = w.ready[s];
      if (!list || !list.length || w.points.some(p => p.reinforce && p.side >= 0 && w.ally(p.side, s))) continue;
      const h = this.home(s);
      if (!h) continue;
      const t = list[0],
        a = Math.random() * Math.PI * 2,
        o = w.nearestOpen(h.x + Math.cos(a) * 40, h.y + Math.sin(a) * 40);
      if (!o || w.cantReinforce(s, t.name, o.x, o.y)) continue;
      list.splice(0, 1);
      w.reinforce(s, t.name, o.x, o.y, Math.atan2(w.n * 10 - o.y, w.n * 10 - o.x));
    }
  }

  rockLayer() {
    const g = this.game,
      w = this.world,
      T = w.terrain,
      side = (T.size - 1) * 20,
      C = ROCK.cell,
      W = Math.ceil(side / C) + 1,
      a = new Float32Array(W * W).fill(-Infinity),
      lo = new Float32Array(W * W).fill(Infinity),
      flat = this.liftedOver ? null : new Float32Array(W * W).fill(Infinity),
      box = new THREE.Box3(),
      A = new THREE.Vector3(),
      B = new THREE.Vector3(),
      D = new THREE.Vector3(),
      P = new THREE.Vector3();
    let any = false;
    const mark = (x, y, z) => {
      const i = Math.floor(x / C),
        j = Math.floor(y / C);
      if (i < 0 || j < 0 || i >= W || j >= W) return;
      const k = j * W + i;
      if (z > a[k]) a[k] = z;
      if (z < lo[k]) lo[k] = z;
    };
    const solids = [];
    for (const p of g.props || []) if (!p.clutter && !p.scriptHidden && p.grp && p.grp.parent === g.scene) solids.push(p.grp);
    const props = solids.length,
      domes = new Map();
    for (const u of w.units)
      if (u.structure && !u.dead && !u.gone && u.holder && u.holder.visible !== false && !(u.speed > 0)) {
        solids.push(u.holder);
        if (u.dome?.meshes) domes.set(u.holder, u.dome.meshes);
      }
    let n = 0;
    for (const grp of solids) {
      const prop = n++ < props;
      const p = { grp };
      p.grp.updateMatrixWorld(true);
      box.setFromObject(p.grp);
      if (box.isEmpty()) continue;
      const ground = heightAt(T, (box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2);
      if (box.max.z - ground < (prop ? ROCK.minH : ROCK.minH * 0.6) || Math.max(box.max.x - box.min.x, box.max.y - box.min.y) < (prop ? ROCK.minW : ROCK.minW * 0.4)) continue;
      const skip = new Set(domes.get(grp) || []);
      p.grp.traverse(o => {
        if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position || skip.has(o) || [].concat(o.material || []).some(m => m && m.transparent)) return;
        const pos = o.geometry.attributes.position,
          idx = o.geometry.index,
          M = o.matrixWorld,
          n = idx ? idx.count : pos.count;
        for (let t = 0; t + 2 < n; t += 3) {
          const ia = idx ? idx.getX(t) : t,
            ib = idx ? idx.getX(t + 1) : t + 1,
            ic = idx ? idx.getX(t + 2) : t + 2;
          A.fromBufferAttribute(pos, ia).applyMatrix4(M);
          B.fromBufferAttribute(pos, ib).applyMatrix4(M);
          D.fromBufferAttribute(pos, ic).applyMatrix4(M);
          const ux = B.x - A.x,
            uy = B.y - A.y,
            uz = B.z - A.z,
            vx = D.x - A.x,
            vy = D.y - A.y,
            vz = D.z - A.z,
            nx = uy * vz - uz * vy,
            ny = uz * vx - ux * vz,
            nz = ux * vy - uy * vx,
            nl = Math.hypot(nx, ny, nz);
          if (!(nl > 1e-6)) continue;
          const steep = Math.abs(nz) / nl <= ROCK.steep;
          if (!steep && !flat) continue;
          const span = Math.max(A.distanceTo(B), B.distanceTo(D), D.distanceTo(A)),
            m = Math.max(1, Math.min(ROCK.steps * 8, Math.ceil(span / (C * 0.6))));
          if (!steep) {
            for (let u = 0; u <= m; u++)
              for (let v = 0; u + v <= m; v++) {
                P.copy(A)
                  .multiplyScalar(1 - (u + v) / m)
                  .addScaledVector(B, u / m)
                  .addScaledVector(D, v / m);
                const i = Math.floor(P.x / C),
                  j = Math.floor(P.y / C);
                if (i >= 0 && j >= 0 && i < W && j < W && P.z < flat[j * W + i]) flat[j * W + i] = P.z;
              }
            continue;
          }
          for (let u = 0; u <= m; u++)
            for (let v = 0; u + v <= m; v++) {
              P.copy(A)
                .multiplyScalar(1 - (u + v) / m)
                .addScaledVector(B, u / m)
                .addScaledVector(D, v / m);
              mark(P.x, P.y, P.z);
            }
        }
        any = true;
      });
    }
    for (let k = 0; k < a.length; k++) {
      if (a[k] === -Infinity) continue;
      const i = k % W,
        j = (k / W) | 0,
        g0 = heightAt(T, (i + 0.5) * C, (j + 0.5) * C);
      if (a[k] < g0 + 3) {
        a[k] = -Infinity;
        lo[k] = Infinity;
      }
    }
    if (!this.liftedOver) {
      this.liftedOver = true;
      this.liftOverheads(a, lo, flat, W, C);
    }
    if (!this.rocks) this.homes.clear();
    this.closeRocks(a, lo, W, C);
    this.rocks = any ? { cell: C, w: W, a, lo } : null;
    this.rocksDirty = false;
  }

  liftOverheads(a, lo, flat, W, C) {
    const w = this.world,
      T = w.terrain,
      N = w.n,
      lifted = [];
    if (!w.occ) return;
    for (const [k, list] of w.occ) {
      if (!list || !list.length) continue;
      const ix = k % N,
        iy = (k / N) | 0,
        x = ix * 20,
        y = iy * 20,
        g0 = heightAt(T, x, y);
      let over = 0,
        wall = 0;
      for (let oy = -8; oy <= 8; oy += 8)
        for (let ox = -8; ox <= 8; ox += 8) {
          const i = Math.floor((x + ox) / C),
            j = Math.floor((y + oy) / C);
          if (i < 0 || j < 0 || i >= W || j >= W) continue;
          const r = j * W + i;
          if (a[r] !== -Infinity) {
            if (lo[r] < g0 + ROCK.headroom) wall++;
            else over++;
          } else if (flat && flat[r] >= g0 + ROCK.headroom && flat[r] < Infinity) over++;
        }
      if (wall || !over) continue;
      for (let m = list.length - 2; m >= 0; m -= 2) if (Array.isArray(list[m])) list.splice(m, 2);
      if (!list.length) w.occ.delete(k);
      w.reKind(k);
      lifted.push(k);
    }
    if (!lifted.length) return;
    w.groundChanged(lifted);
    if (w.reroute) w.reroute(lifted);
    this.liftedCells = lifted.length;
  }

  closeRocks(a, lo, W, C) {
    this.rocksClosed = true;
    const w = this.world,
      T = w.terrain,
      N = w.n,
      cells = [],
      wallAt = (x, y, g) => {
        const i = Math.floor(x / C),
          j = Math.floor(y / C);
        if (i < 0 || j < 0 || i >= W || j >= W) return false;
        const k = j * W + i;
        return a[k] > g + ROCK.wall && lo[k] < g + ROCK.foot;
      };
    for (let iy = 0; iy < N; iy++)
      for (let ix = 0; ix < N; ix++) {
        const k = iy * N + ix;
        if (!w.open[k] && !(this.closedCells && this.closedCells.has(k))) continue;
        const x = ix * 20,
          y = iy * 20,
          g0 = heightAt(T, x, y);
        let hits = 0;
        for (let oy = -7; oy <= 7; oy += 7) for (let ox = -7; ox <= 7; ox += 7) if (wallAt(x + ox, y + oy, g0)) hits++;
        if (hits >= ROCK.closeHits) cells.push(k);
      }
    const had = this.closedCells || new Set(),
      now = new Set(cells),
      changed = [];
    for (const k of had) if (!now.has(k)) {
      w.open[k] = 1;
      changed.push(k);
    }
    for (const k of now) if (!had.has(k)) {
      w.open[k] = 0;
      changed.push(k);
    }
    for (const k of had) if (now.has(k)) w.open[k] = 0;
    this.closedCells = now;
    if (!changed.length) return;
    w.groundChanged(changed);
    this.keepLinks(now, changed, a, lo, W, C);
    if (w.reroute) w.reroute(changed);
  }

  keepLinks(closed, changed, a, lo, W, C) {
    const w = this.world,
      N = w.n,
      T = w.terrain,
      sides = this.game.factions.length,
      ends = [];
    for (let s = 0; s < sides; s++) {
      const h = this.home(s);
      if (h) ends.push(h);
    }
    const goals = w.points.filter(p => p.reinforce);
    if (!ends.length || !goals.length) return;
    const reach = (p, q) => {
      w.paths?.sync?.();
      const r = w.route(p.x, p.y, q.x, q.y, 1);
      return !!(r && r.length);
    };
    const wet = T.water && T.water.on ? T.water.level : -Infinity,
      ok = new Uint8Array(W * W),
      pass = new Uint8Array(N * N),
      all = [...closed];
    for (const k of all) w.open[k] = 1;
    w.groundChanged(all);
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) if (w.isOpen(ix * 20, iy * 20, 1)) pass[iy * N + ix] = 1;
    for (const k of all) if (closed.has(k)) w.open[k] = 0;
    w.groundChanged(all);
    for (let j = 0; j < W; j++)
      for (let i = 0; i < W; i++) {
        const x = (i + 0.5) * C,
          y = (j + 0.5) * C,
          ix = Math.round(x / 20),
          iy = Math.round(y / 20);
        if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
        const k = iy * N + ix;
        if (!pass[k]) continue;
        const g = heightAt(T, x, y),
          r = j * W + i;
        if (a[r] > g + ROCK.wall && lo[r] < g + ROCK.foot) continue;
        if (g < wet - WALK.wet) continue;
        const sl = Math.max(Math.abs(heightAt(T, x + 10, y) - heightAt(T, x - 10, y)), Math.abs(heightAt(T, x, y + 10) - heightAt(T, x, y - 10))) / 20;
        if (sl > WALK.slope) continue;
        ok[r] = 1;
      }
    const cellOf = p => Math.min(W - 1, Math.max(0, Math.floor(p.y / C))) * W + Math.min(W - 1, Math.max(0, Math.floor(p.x / C)));
    const opened = [];
    for (const h of ends) {
      const want = goals.filter(q => !reach(h, q));
      if (!want.length) continue;
      const from = new Int32Array(W * W).fill(-1),
        start = cellOf(h),
        queue = [start];
      from[start] = start;
      for (let qi = 0; qi < queue.length; qi++) {
        const r = queue[qi],
          i = r % W,
          j = (r / W) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di,
            nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
          const nr = nj * W + ni;
          if (from[nr] >= 0 || !ok[nr]) continue;
          from[nr] = r;
          queue.push(nr);
        }
      }
      for (const q of want) {
        let r = cellOf(q);
        if (from[r] < 0) {
          let best = -1,
            bd = Infinity;
          const qi = r % W,
            qj = (r / W) | 0;
          for (let dj = -3; dj <= 3; dj++)
            for (let di = -3; di <= 3; di++) {
              const nr = (qj + dj) * W + qi + di;
              if (nr >= 0 && nr < W * W && from[nr] >= 0 && di * di + dj * dj < bd) {
                bd = di * di + dj * dj;
                best = nr;
              }
            }
          if (best < 0) continue;
          r = best;
        }
        for (let guard = 0; guard < W * W && r !== start; guard++, r = from[r]) {
          const x = ((r % W) + 0.5) * C,
            y = (((r / W) | 0) + 0.5) * C,
            ix = Math.round(x / 20),
            iy = Math.round(y / 20);
          for (let dy = -ROCK.keep; dy <= ROCK.keep; dy++)
            for (let dx = -ROCK.keep; dx <= ROCK.keep; dx++) {
              const ax = ix + dx,
                ay = iy + dy,
                k = ay * N + ax;
              if (ax < 0 || ay < 0 || ax >= N || ay >= N || !closed.has(k)) continue;
              if (!ok[cellOf({ x: ax * 20, y: ay * 20 })]) continue;
              closed.delete(k);
              w.open[k] = 1;
              opened.push(k);
            }
        }
      }
    }
    if (!opened.length) return;
    w.groundChanged(opened);
    for (const k of opened) changed.push(k);
    this.keptLinks = opened.length;
  }

  inWall(x, y) {
    const R = this.rocks;
    if (!R || x < 0 || y < 0) return false;
    const i = Math.floor(x / R.cell),
      j = Math.floor(y / R.cell);
    if (i >= R.w || j >= R.w) return false;
    const k = j * R.w + i;
    if (R.a[k] === -Infinity) return false;
    const g = heightAt(this.world.terrain, x, y);
    return R.a[k] > g + ROCK.wall && R.lo[k] < g + ROCK.foot;
  }

  lineOk(u, x, y, need) {
    const d = Math.hypot(x - u.x, y - u.y),
      n = Math.max(1, Math.ceil(d / (ROCK.cell * 0.5)));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      if (!this.footOk(u, u.x + (x - u.x) * k, u.y + (y - u.y) * k, need)) return false;
    }
    return true;
  }

  footOk(u, x, y, need) {
    const w = this.world;
    if (w.isOpen(x, y, need)) return this.stepOk(u, x, y);
    if (!this.closedCells) return false;
    const ix = Math.round(x / 20),
      iy = Math.round(y / 20);
    return ix >= 0 && iy >= 0 && ix < w.n && iy < w.n && this.closedCells.has(iy * w.n + ix) && this.stepOk(u, x, y);
  }

  stepOk(u, x, y) {
    return !u.foot || u.flies || u.structure || !this.rocks || !this.inWall(x, y) || this.inWall(u.x, u.y);
  }

  fitSlot(u, pt, cx, cy) {
    const w = this.world,
      need = (u.need & ~3) | 1,
      ok = (x, y) => this.footOk(u, x, y, need) && !this.inWall(x, y);
    if (!ok(pt.x, pt.y)) {
      const x0 = pt.x,
        y0 = pt.y;
      let fit = false;
      for (let k = 1; k <= 4 && !fit; k++) {
        const f = k / 4,
          x = x0 + (cx - x0) * f,
          y = y0 + (cy - y0) * f;
        if (ok(x, y)) {
          pt.x = x;
          pt.y = y;
          fit = true;
        }
      }
      if (!fit) {
        if (ok(u.x, u.y)) {
          pt.x = u.x;
          pt.y = u.y;
        }
        return;
      }
    }
    const now = w.time;
    if (u.detour || now < (u.slotRouteAt || 0) || Math.hypot(pt.x - u.x, pt.y - u.y) < 12 || this.lineOk(u, pt.x, pt.y, need)) return;
    u.slotRouteAt = now + SLOT_ROUTE.every;
    const from = w.isOpen(u.x, u.y, need) ? null : this.outOfWall(u, need) || w.nearestOpen(u.x, u.y, need),
      a = from || u,
      way = w.route(a.x, a.y, pt.x, pt.y, need);
    if (!way || !way.length) return;
    const pts = way.map(p => ({ x: p.x, y: p.y }));
    if (from) pts.unshift({ x: from.x, y: from.y });
    u.detour = pts;
  }

  outOfWall(u, need) {
    const w = this.world;
    for (let r = ROCK.cell; r <= ROCK.cell * 8; r += ROCK.cell)
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2,
          x = u.x + Math.cos(a) * r,
          y = u.y + Math.sin(a) * r;
        if (w.isOpen(x, y, need) && !this.inWall(x, y)) return { x, y };
      }
    return null;
  }

  solidAt(x, y, z) {
    const R = this.rocks;
    if (!R || x < 0 || y < 0) return false;
    const i = Math.floor(x / R.cell),
      j = Math.floor(y / R.cell);
    if (i >= R.w || j >= R.w) return false;
    const k = j * R.w + i;
    return z < R.a[k] && z > R.lo[k] - 1;
  }

  rockAt(x, y) {
    const R = this.rocks;
    if (!R || x < 0 || y < 0) return -Infinity;
    const i = Math.floor(x / R.cell),
      j = Math.floor(y / R.cell);
    return i < R.w && j < R.w ? R.a[j * R.w + i] : -Infinity;
  }

  rockCut(s, x0, y0, z0, x1, y1, z1) {
    if (!this.rocks) return -1;
    const f0 = s.from,
      f = f0 && f0.inside && f0.inside.x !== undefined ? f0.inside : f0 && f0 === this.body && this.post ? this.post : f0,
      t = s.target && s.target.x !== undefined && !s.target.spot ? s.target : null,
      fr = f ? (f.hitRadius || 0) + 6 : 0,
      tr = t ? (t.hitRadius || 0) * 1.2 + 6 : 0,
      d = Math.hypot(x1 - x0, y1 - y0),
      n = Math.max(1, Math.ceil(d / (ROCK.cell * 0.5)));
    for (let i = 1; i <= n; i++) {
      const k = i / n,
        x = x0 + (x1 - x0) * k,
        y = y0 + (y1 - y0) * k;
      if (f && Math.abs(x - f.x) < fr && Math.abs(y - f.y) < fr && Math.hypot(x - f.x, y - f.y) < fr) continue;
      if (t && Math.abs(x - t.x) < tr && Math.abs(y - t.y) < tr && Math.hypot(x - t.x, y - t.y) < tr) continue;
      if (this.solidAt(x, y, z0 + (z1 - z0) * k)) return k;
    }
    return -1;
  }

  padLayer() {
    const w = this.world,
      T = w.terrain,
      side = (T.size - 1) * 20,
      C = PAD_TOPS.cell,
      W = Math.ceil(side / C) + 1,
      a = new Float32Array(W * W).fill(-Infinity),
      inv = new THREE.Matrix4(),
      m = new THREE.Matrix4(),
      box = new THREE.Box3(),
      part = new THREE.Box3(),
      p = new THREE.Vector3();
    let any = false;
    for (const pt of w.points) {
      const h = pt.holder;
      if (!h || !PAD_TOPS.kinds.test(pt.type.name)) continue;
      h.updateMatrixWorld(true);
      inv.copy(h.matrixWorld).invert();
      box.makeEmpty();
      const world = new THREE.Box3(),
        shown = o => {
          for (let a = o; a && a !== h.parent; a = a.parent) if (a.visible === false) return false;
          return true;
        };
      h.traverse(o => {
        if (!o.isMesh || !o.geometry || !shown(o) || [].concat(o.material || []).some(q => q && q.transparent)) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        part.copy(o.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
        box.union(part);
        part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        world.union(part);
      });
      if (box.isEmpty()) continue;
      const top = world.max.z - 0.5,
        inset = PAD_TOPS.inset / Math.max(1e-3, h.scale.x);
      if (top - heightAt(T, (world.min.x + world.max.x) / 2, (world.min.y + world.max.y) / 2) > PAD_TOPS.maxUp) continue;
      for (let j = Math.max(0, Math.floor(world.min.y / C)); j <= Math.min(W - 1, Math.ceil(world.max.y / C)); j++)
        for (let i = Math.max(0, Math.floor(world.min.x / C)); i <= Math.min(W - 1, Math.ceil(world.max.x / C)); i++) {
          p.set((i + 0.5) * C, (j + 0.5) * C, top).applyMatrix4(inv);
          if (p.x < box.min.x + inset || p.x > box.max.x - inset || p.y < box.min.y + inset || p.y > box.max.y - inset) continue;
          const k = j * W + i;
          if (top > a[k]) a[k] = top;
          any = true;
        }
    }
    T.padTop = any ? { cell: C, w: W, a } : null;
  }

  blocks(o, s) {
    const f = s.from;
    return !!o.structure && !o.dead && !o.gone && !o.inside && o.hitRadius > 0 && o !== f && !(f && f.inside === o) && o.holder?.visible !== false;
  }

  captured(pt, was) {
    const w = this.world,
      L = pt.reinforce ? this.letterOf(pt) : '',
      label = L ? `Command post ${L}` : 'Capture point';
    if (pt.side >= 0) {
      for (const u of w.units)
        if (!u.dead && !u.inside && !u.structure && u.captures !== false && u.side >= 0 && w.ally(u.side, pt.side) && Math.hypot(u.x - pt.x, u.y - pt.y) <= (pt.radius || 100) * 1.2) {
          this.record(u).caps++;
          if (u === this.body) {
            this.caps++;
            this.matchScore += 200;
            this.popup('CAPTURE +200', 'kill');
          }
        }
    }
    if (!pt.reinforce) return;
    if (pt.side >= 0 && w.ally(pt.side, this.me)) this.announce(`${label} captured`, 'good');
    else if (was >= 0 && w.ally(was, this.me)) this.announce(`${label} lost`, 'bad');
    else if (pt.side >= 0) this.announce(`Enemy took ${label}`, 'bad');
  }

  letterOf(p) {
    let l = this.letters.get(p);
    if (l === undefined) {
      const list = this.world.points.filter(q => q.reinforce);
      list.forEach((q, i) => this.letters.set(q, String.fromCharCode(65 + (i % 26))));
      l = this.letters.get(p) ?? '';
      if (!this.letters.has(p)) this.letters.set(p, '');
    }
    return l;
  }

  nameFor(u) {
    if (!u) return '';
    if (u === this.body || (this.rideQ && u.squad === this.rideQ)) return 'You';
    let n = this.names.get(u);
    if (!n) {
      const s = u.side >= 0 ? u.side : 9,
        k = (this.nameCount[s] = (this.nameCount[s] || 0) + 1);
      n = `${this.nameOf(u.type)} ${k}`;
      this.names.set(u, n);
    }
    return n;
  }

  record(u) {
    const key = u === this.body || (this.rideQ && u.squad === this.rideQ) ? 'me' : u;
    let r = this.ledger.get(key);
    if (!r) this.ledger.set(key, (r = { name: key === 'me' ? 'You' : this.nameFor(u), side: u.side, kills: 0, vkills: 0, caps: 0, me: key === 'me' }));
    return r;
  }

  logKill(killer, victim) {
    const w = this.world,
      b = this.body,
      mine = killer && this.mine(killer),
      me = victim === b;
    if (killer && killer.side >= 0 && killer.x !== undefined) {
      const r = this.record(killer);
      if (victim.kind === 'INFANTRY') r.kills++;
      else r.vkills++;
    }
    const at = b || this.fellAt;
    if (!mine && !me && at && Math.hypot(victim.x - at.x, victim.y - at.y) > MARKERS.feedNear) return;
    this.feed.push({
      a: killer && killer.x !== undefined ? this.nameFor(killer) : '',
      as: killer ? killer.side : -1,
      v: me ? 'You' : this.nameFor(victim),
      vs: victim.side,
      mine: mine || me,
      at: performance.now()
    });
    if (this.feed.length > MARKERS.maxFeed) this.feed.shift();
    this.feedDirty = true;
  }

  announce(text, tone = 'info') {
    this.announces.push({ text, tone, at: performance.now() });
    if (this.announces.length > 3) this.announces.shift();
    this.annDirty = true;
  }

  income(dt) {
    const w = this.world,
      g = (INCOME_PER_MIN / 60) * dt;
    for (let s = 0; s < this.game.factions.length; s++) {
      if (w.beaten.has(w.team[s])) continue;
      w.credits[s] += g;
      if (w.earned) w.earned[s] += g;
    }
  }

  watch(cam, real) {
    const w = this.world,
      now = w.time;
    let u = this.watched;
    if (!u || u.dead || u.inside || now >= this.watchAt) {
      let best = null,
        bs = -1;
      const pool = this.netClient ? w.units.filter(x => x.foot && !x.structure).map(x => [x, null]) : this.bots;
      for (const [b, st] of pool) {
        if (b.dead || b.inside || b.side !== this.me) continue;
        const s = (st ? (st.mode === 'fight' ? 2 : 0) : (b.v || 0) > 2 ? 1 : 0) + Math.random();
        if (s > bs) {
          bs = s;
          best = b;
        }
      }
      if (best) {
        u = this.watched = best;
        this.watchAt = now + WATCH.swap;
        this.watchCam = null;
      }
    }
    if (!u) return false;
    const h = u.heading,
      c = Math.cos(h),
      s = Math.sin(h),
      want = { x: u.x - c * WATCH.back + s * WATCH.side, y: u.y - s * WATCH.back - c * WATCH.side, z: u.z + WATCH.up };
    const C = (this.watchCam ||= { ...want }),
      k = Math.min(1, real * WATCH.ease);
    C.x += (want.x - C.x) * k;
    C.y += (want.y - C.y) * k;
    C.z += (want.z - C.z) * k;
    C.z = Math.max(C.z, heightAt(w.terrain, C.x, C.y) + 3);
    cam.position.set(C.x, C.y, C.z);
    cam.up.set(0, 0, 1);
    cam.lookAt(u.x + c * 60, u.y + s * 60, u.z + 10);
    this.yaw = h;
    this.pitch = 0;
    this.setFov(cam, this.cfg.fov, 1);
    this.eyeAt.copy(cam.position);
    const v = this.game.view;
    v.x = u.x;
    v.y = u.y;
    v.dist = 1300;
    this.feedGround();
    if (w.time >= this.clutterAt) {
      this.clutterAt = w.time + CLUTTER.tick;
      this.clutter();
    }
    return true;
  }

  fieldCap() {
    const c = +globalThis.shooterCap;
    return this.benchN || (c >= 10 ? Math.round(c) : FIELD_CAP);
  }

  sizeOf(t) {
    if (!t) return 1;
    let n = this.sizes.get(t);
    if (n === undefined) this.sizes.set(t, (n = t.has('Company_Units') ? Math.max(1, t.list('Company_Units').length) : 1));
    return n;
  }

  popUsed(side) {
    const w = this.world;
    let n = 0;
    for (const u of w.units) if (!u.dead && !u.gone && u.side === side && u.foot && !u.structure && !u.pilot && !u.squad?.native && u.speed > 0) n++;
    return n;
  }

  async deploy() {
    const w = this.world,
      c = this.pick,
      p = this.from;
    if (!c || this.spawning || this.state === 'alive') return;
    if (w.time < this.readyAt) return;
    const heroic = !!(c.hero || c.heroSpawn);
    if (heroic && this.matchScore < this.heroAt) return;
    if (this.netClient && c.vehicle) return this.netRide(c);
    if (this.netClient && heroic) return this.netDeploy(c, this.from || { x: c.hero?.members[0]?.x ?? 0, y: c.hero?.members[0]?.y ?? 0 }, true);
    this.role = this.roleOf(c, this.classes());
    if (c.hero) {
      const u = c.hero.members[0];
      if (!u || u.dead || u.inside) return;
      this.heroUsed();
      this.possess(c.hero, u, true);
      return;
    }
    if (c.vehicle) {
      const q = c.vehicle,
        v = q.members[0],
        foot = this.classes().find(x => !x.hero);
      if (!v || v.dead || q.crew.in || q.side !== this.me || !foot) return;
      if (this.tickets && this.tickets[this.me] <= 0) return;
      this.spawning = true;
      const a = v.heading + Math.PI / 2,
        o = w.nearestOpen(v.x + Math.cos(a) * (v.hitRadius + 12), v.y + Math.sin(a) * (v.hitRadius + 12)) || { x: v.x, y: v.y };
      const sq = await w.spawn(foot.unit.name, o.x, o.y, v.heading, this.me);
      this.spawning = false;
      const u = sq && sq.members[0];
      if (!u) return;
      this.role = this.roleOf(foot, this.classes());
      this.possess(sq, u, false);
      if (!q.dead && q.members.length && !q.crew.in) this.drive(q);
      return;
    }
    const cost = this.tickets ? 0 : c.cost;
    if (this.tickets && this.tickets[this.me] <= 0) return;
    if (!p || w.credits[this.me] < cost) return;
    if (this.netClient) return this.netDeploy(c, p);
    this.spawning = true;
    const a = simRandom() * Math.PI * 2,
      o = w.nearestOpen(p.x + Math.cos(a) * 40, p.y + Math.sin(a) * 40) || { x: p.x, y: p.y };
    const face = Math.atan2(this.game.view.y - o.y, this.game.view.x - o.x);
    w.credits[this.me] -= cost;
    const q = await this.spawnClass(c, o, face, this.me);
    this.spawning = false;
    const u = q && q.members[0];
    if (!u) {
      w.credits[this.me] += cost;
      return;
    }
    if (heroic) this.heroUsed();
    this.possess(q, u, heroic);
  }

  async spawnClass(c, o, face, side) {
    const q = await this.spawnClassRaw(c, o, face, side);
    if (q && c.gid) this.claimFor(q, c.gid);
    return q;
  }

  async spawnClassRaw(c, o, face, side) {
    const w = this.world;
    if (!(c.dummy && c.unit === c.dummy)) return w.spawn(c.unit.name, o.x, o.y, face, side);
    const entry = { by: null, until: w.time + DUMMY.wait, take: null },
      got = new Promise(res => {
        entry.take = res;
        setTimeout(() => res(null), DUMMY.wait * 1000 + 500);
      });
    const was = this.spawning;
    this.spawning = false;
    const dq = await w.spawn(c.unit.name, o.x, o.y, face, side);
    this.spawning = was;
    entry.by = dq;
    this.pendingDummies.push(entry);
    const q = dq ? await got : null;
    return q && q.members[0] && !q.members[0].dead ? q : null;
  }

  async netDeploy(c, p, hero = false) {
    const N = this.game.shooterNet;
    if (!N || this.spawning) return;
    this.spawning = true;
    const u = await N.requestDeploy(c.company.name, p.x, p.y);
    this.spawning = false;
    if (!u || u.dead || this.state === 'alive') {
      if (!u) this.flash('Could not deploy');
      return;
    }
    if (hero) this.heroUsed();
    this.possess(u.squad, u, hero);
  }

  async netRide(c) {
    const N = this.game.shooterNet,
      v = c.vehicle.members[0],
      foot = this.classes().find(x => !x.hero && !x.heroSpawn && !x.vehicle);
    if (!N || !v || !foot || this.spawning) return;
    this.spawning = true;
    const u = await N.requestDeploy(foot.company.name, v.x, v.y, N.ids.get(v));
    this.spawning = false;
    if (!u || u.dead || this.state === 'alive') {
      if (!u) this.flash('Could not deploy');
      return;
    }
    this.role = this.roleOf(foot, this.classes());
    this.possess(u.squad, u, false);
    if (!c.vehicle.dead && c.vehicle.members.length) this.drive(c.vehicle);
  }

  async netEnter() {
    const b = this.body,
      N = this.game.shooterNet;
    if (!N || this.entering) return;
    this.entering = true;
    const got = await N.requestEnter();
    this.entering = false;
    const t = got && got.unit;
    if (!got || !t || !this.body || this.body.dead || t.dead) {
      if (!got) this.flash('Nothing to enter here');
      return;
    }
    if (got.seat === 'drive') this.drive(t.squad);
    else if (got.seat === 'gun') this.takeGun(t.squad);
    else if (got.seat === 'post') {
      b.inside = t;
      b.gunner = false;
      b.path.length = 0;
      b.target = null;
      b.holder.visible = false;
      this.post = t;
      this.yaw = t.heading || this.yaw;
      this.note(`${this.nameOf(t.type)}: fire from inside, ${this.keyText('SHOOTER_ENTER')} to get out`);
    }
  }

  peerSide(peer) {
    const i = this.game.players.findIndex(p => p.human && (p.peer === peer || p.peers?.includes(peer)));
    return i >= 0 ? i : this.me;
  }

  async remoteDeploy(peer, name, x, y, vid = 0) {
    const w = this.world,
      side = this.peerSide(peer),
      had = this.remotes.get(peer);
    if (had && !had.dead) return null;
    if (vid) {
      const v = this.game.shooterNet?.byId.get(vid),
        q = v && v.squad,
        foot = this.classes(side).find(k => !k.hero && !k.heroSpawn && !k.vehicle && k.company.name === name) || this.classes(side).find(k => !k.hero && !k.heroSpawn && !k.vehicle);
      if (!v || v.dead || !q || !this.crewed.has(q) || q.crew.in || q.side !== side || !foot) return null;
      if (this.tickets && this.tickets[side] <= 0) return null;
      const a = v.heading + Math.PI / 2,
        o = w.nearestOpen(v.x + Math.cos(a) * (v.hitRadius + 12), v.y + Math.sin(a) * (v.hitRadius + 12)) || { x: v.x, y: v.y };
      this.spawning = true;
      const sq = await w.spawn(foot.unit.name, o.x, o.y, v.heading, side);
      this.spawning = false;
      const u = sq && sq.members[0];
      if (!u) return null;
      sq.noAI = true;
      sq.selectable = false;
      sq.foe = null;
      u.path.length = 0;
      u.target = null;
      if (PLAYER_HEALTH > 0) w.addCombatMod(u, MOD.HEALTH, MOD_KEY + 1, 'shooter-player', PLAYER_HEALTH);
      w.addCombatMod(u, MOD.DAMAGE, MOD_KEY, 'shooter-player', PLAYER_DAMAGE);
      w.addCombatMod(u, MOD.FIRE_RATE, MOD_KEY, 'shooter-player', PLAYER_FIRE_RATE);
      u.remote = { peer, s: [], kind: '', hero: false };
      this.remotes.set(peer, u);
      if (!q.dead && !q.crew.in) this.remoteEnter(peer, v);
      return u;
    }
    const c = this.classes(side).find(k => k.company.name === name && !k.vehicle);
    if (!c || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (this.tickets && this.tickets[side] <= 0) return null;
    const hero = !!(c.hero || c.heroSpawn);
    let q = null;
    if (c.hero) {
      const h = c.hero.members[0];
      if (!h || h.dead || h.inside || h.remote || h === this.body) return null;
      q = c.hero;
    } else {
      const a = simRandom() * Math.PI * 2,
        o = w.nearestOpen(x + Math.cos(a) * 40, y + Math.sin(a) * 40) || { x, y };
      this.spawning = true;
      q = await this.spawnClass(c, o, a + Math.PI, side);
      this.spawning = false;
    }
    const u = q && q.members[0];
    if (!u) return null;
    q.noAI = true;
    q.selectable = false;
    q.foe = null;
    u.path.length = 0;
    u.target = null;
    if (!hero) {
      if (PLAYER_HEALTH > 0) w.addCombatMod(u, MOD.HEALTH, MOD_KEY + 1, 'shooter-player', PLAYER_HEALTH);
      w.addCombatMod(u, MOD.DAMAGE, MOD_KEY, 'shooter-player', PLAYER_DAMAGE);
      w.addCombatMod(u, MOD.FIRE_RATE, MOD_KEY, 'shooter-player', PLAYER_FIRE_RATE);
    }
    u.remote = { peer, s: [], kind: '', hero };
    this.remotes.set(peer, u);
    return u;
  }

  freeRideIds() {
    const N = this.game.shooterNet,
      out = {};
    if (!N) return out;
    for (const q of this.crewed) {
      const v = q.members[0];
      if (!v || v.dead || q.crew.in || q.side < 0 || v.health < v.maxHealth * VEH.bail) continue;
      (out[q.side] ||= []).push(N.idOf(v));
    }
    return out;
  }

  remoteSeat(peer) {
    const w = this.world,
      u = this.remotes.get(peer);
    if (!u || u.dead || u.inside) return null;
    const near = (v, pad) => Math.hypot(v.x - u.x, v.y - u.y) - v.hitRadius < pad;
    let best = null,
      bd = Infinity;
    for (const q of this.crewed) {
      const v = q.members[0];
      if (!v || v.dead || q.crew.in || q.side !== u.side) continue;
      const d = Math.hypot(v.x - u.x, v.y - u.y) - v.hitRadius;
      if (d < REMOTE.reach && d < bd) {
        bd = d;
        best = q;
      }
    }
    if (best && this.remoteEnter(peer, best.members[0])) return { seat: 'drive', id: best.members[0] };
    for (const q of this.crewed) {
      const v = q.members[0];
      if (!v || v.dead || !q.crew.in || q.crew.gunner || q.side !== u.side || !v.guns || !v.guns.length || !near(v, REMOTE.reach)) continue;
      if (q.crew.gunClaim) {
        q.crew.gunClaim.squad.noAI = false;
        q.crew.gunClaim = null;
      }
      this.seat(u, q);
      u.remote.gun = q;
      return { seat: 'gun', id: v };
    }
    for (const h of w.units) {
      if (h.dead || !h.slots || h.side !== u.side || !near(h, REMOTE.reach + 15) || !canGarrison(w, u.squad, h)) continue;
      if (!putInside(w, u.squad, h)) continue;
      u.gunner = false;
      u.remote.post = h;
      return { seat: 'post', id: h };
    }
    return null;
  }

  remoteEnter(peer, v) {
    const u = this.remotes.get(peer),
      q = v && v.squad;
    if (!u || u.dead || u.inside || !q || v.dead || !this.crewed.has(q) || q.crew.in || q.side !== u.side) return false;
    if (Math.hypot(v.x - u.x, v.y - u.y) - v.hitRadius > REMOTE.reach + 25) return false;
    if (q.crew.claim) {
      q.crew.claim.squad.noAI = false;
      q.crew.claim = null;
    }
    this.board(u, q);
    q.noAI = true;
    q.foe = null;
    for (const m of q.members) {
      m.path = [];
      m.target = null;
      m.remote = { peer, s: [], kind: '', car: true };
    }
    u.remote.ride = q;
    return true;
  }

  remoteExit(peer) {
    const w = this.world,
      u = this.remotes.get(peer),
      R = u?.remote;
    if (!R) return;
    if (R.ride) {
      const q = R.ride;
      for (const m of q.members) {
        m.remote = null;
        if (m.flies && m.netRoll !== undefined) {
          m.netRoll = m.netTilt = undefined;
          m.holder.rotation.x = m.holder.rotation.y = 0;
        }
      }
      R.ride = null;
      if (!u.dead && u.inside) this.eject(u, q, false);
    }
    if (R.gun) {
      const q = R.gun;
      R.gun = null;
      if (q.crew && q.crew.gunner === u) q.crew.gunner = null;
      if (!u.dead && u.inside) this.eject(u, q, false);
      u.squad.noAI = true;
    }
    if (R.post) {
      const h = R.post;
      R.post = null;
      if (!u.dead && u.inside === h) {
        if (h.dead) {
          u.inside = undefined;
          this.eject(u, { members: [h] }, true);
          h.holds = (h.holds || []).filter(q => q !== u.squad);
        } else ungarrison(w, h, null, null, u.squad);
        u.holder.visible = true;
      }
      u.squad.noAI = true;
    }
  }

  remoteUnit(peer, id) {
    const u = this.remotes.get(peer);
    if (!u || u.dead || !u.remote) return null;
    if (!id) return u.inside && !u.remote.post ? null : u;
    const v = this.game.shooterNet?.byId.get(id);
    if (!v || v.dead) return null;
    if (v.remote && v.remote.peer === peer && v.remote.car) return v;
    return u.remote.gun && v.squad === u.remote.gun && u.remote.gun.crew?.gunner === u ? v : null;
  }

  remoteAbility(peer, m) {
    const w = this.world,
      u = this.remotes.get(peer);
    if (!u || u.dead || !u.remote) return;
    const sq = u.remote.ride || u.squad;
    if (!sq) return;
    const list = sq.abilities.filter(a => !/^(SELL|UNLOAD|SPREAD_OUT)$/.test(a.def.kind)),
      st = list[m.n | 0];
    if (!st) return;
    const def = st.def,
      hit = m.t ? this.game.shooterNet?.byId.get(m.t) : null;
    let tgt = null;
    if (def.aim === 'point') {
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
      tgt = { x: m.x, y: m.y, ...(hit && !hit.dead ? { unit: hit } : {}) };
    } else if (def.aim && def.aim !== 'none') {
      if (!hit || hit.dead) return;
      tgt = { unit: hit };
    }
    const why = w.useAbility(sq, def.kind, tgt);
    if (typeof why === 'string' && why) this.game.shooterNet?.session?.send(peer, { k: 'sh-why', t: why.slice(0, 80) });
  }

  peerCredit(u, from, shot) {
    const N = this.game.shooterNet,
      D = this.peerDealt.get(u);
    if (!N || u.side < 0) return;
    const killer = from?.remote && !this.world.ally(u.side, from.side) ? from.remote.peer : null,
      full = u.kind === 'INFANTRY' ? SCORE.foot : SCORE.car;
    if (killer !== null && from.remote.hero && !from.dead) from.health = Math.min(from.maxHealth, from.health + from.maxHealth * HERO.kill);
    if (killer !== null) N.credit(killer, { c: 'kill', pts: full, inf: u.kind === 'INFANTRY' ? 1 : 0, head: shot?.head ? 1 : 0, car: u.kind !== 'INFANTRY' && !u.structure ? 1 : 0 });
    if (!D || u.structure) return;
    for (const [peer, dealt] of D) {
      if (peer === killer || !(dealt > 0)) continue;
      const raw = (Math.min(1, dealt / Math.max(1, u.maxHealth)) * full) / SCORE.assistStep,
        pts = Math.max(SCORE.assistMin, Math.min(Math.round((full * SCORE.assistMax) / 100), Math.round(raw) * SCORE.assistStep));
      N.credit(peer, { c: 'assist', pts });
    }
  }

  netCredit(m) {
    const now = performance.now(),
      pts = Math.max(0, Math.min(1000, +m.pts || 0));
    if (m.c === 'kill') {
      this.killUntil = now + 900;
      this.kills++;
      this.matchScore += pts;
      if (m.head) this.stats.heads++;
      if (m.car) this.stats.vehicles++;
        this.popup(`${m.head && m.inf ? 'HEADSHOT' : 'KILL'} +${pts}`, 'kill');
    } else if (m.c === 'assist') {
      this.assists++;
      this.matchScore += pts;
      this.popup(`ASSIST +${pts}`, 'assist');
    }
  }

  remoteFire(peer, m) {
    const w = this.world,
      u = this.remotes.get(peer),
      N = this.game.shooterNet;
    if (!u || u.dead || !u.remote || !N) return;
    const R = u.remote,
      now = w.time,
      nade = m.w === -2,
      shooter = this.remoteUnit(peer, m.u | 0);
    if (!shooter) return;
    if (nade ? now < (R.nadeAt || 0) : now < (R.fireAt || 0)) return;
    const W = nade ? (shooter === u ? this.nadeWeapon() : null) : m.w === 0 ? shooter.weapon : shooter.guns?.[m.w - 1];
    if (!W || ![m.x, m.y, m.z].every(Number.isFinite)) return;
    if (nade) R.nadeAt = now + 0.8;
    else R.fireAt = now + REMOTE.fire;
    const tu = m.t ? N.byId.get(m.t) : null,
      t = tu && !tu.dead ? tu : (R.spot ||= { x: 0, y: 0, z: 0, aimZ: 0, hitRadius: 0, kind: 'INFANTRY', dead: true, side: -1, mvx: 0, mvy: 0, mvz: 0, path: [], spot: true });
    if (t === R.spot) {
      t.x = m.x;
      t.y = m.y;
      t.z = m.z;
      const hu = m.h ? N.byId.get(m.h) : null;
      if (hu && !hu.dead && !hu.inside && w.enemy(shooter, hu) && Number.isFinite(m.hx) && Number.isFinite(m.hy)) {
        const dx = hu.x - m.hx,
          dy = hu.y - m.hy;
        if (dx * dx + dy * dy <= LAG.reach * LAG.reach) {
          t.x += dx;
          t.y += dy;
          t.z += Number.isFinite(m.hz) ? hu.z - m.hz : 0;
        }
      }
    }
    w.fire(shooter, t, W);
  }

  remoteState(peer, m) {
    const ride = this.remotes.get(peer)?.remote?.ride;
    if (ride && (ride.dead || !ride.members.length || ride.members.every(x => x.dead))) this.remoteExit(peer);
    const u = this.remoteUnit(peer, m.id | 0);
    if (!u) return;
    const n = [m.x, m.y, m.z, m.h];
    if (!n.every(Number.isFinite)) return;
    const R = u.remote;
    R.s.push({ t: this.world.time, x: m.x, y: m.y, z: m.z, h: m.h, r: Number.isFinite(m.r) ? m.r : 0, p: Number.isFinite(m.p) ? m.p : 0, kind: typeof m.a === 'string' ? m.a.slice(0, 40) : R.kind });
    if (R.s.length > REMOTE.keep) R.s.splice(0, R.s.length - REMOTE.keep);
  }

  remoteStep(u, dt) {
    const w = this.world,
      R = u.remote,
      S = R.s;
    u.path.length = 0;
    u.target = null;
    if (R.hero && !u.inside && dt > 0) {
      const loss = u.maxHealth * HERO.drain * dt;
      if (u.health > loss + 1) u.health -= loss;
      else {
        w.hurt(u, u.health + 1, null);
        return;
      }
    }
    if (u.inside && !R.car) {
      u.x = u.inside.x;
      u.y = u.inside.y;
      u.z = u.inside.z + (u.inside.aimZ || 0) * 0.5;
      return;
    }
    if (S.length) {
      const c = w.time - REMOTE.delay;
      let a = S[0],
        b = S[0];
      for (const s of S) {
        if (s.t <= c) a = s;
        b = s;
        if (s.t >= c) break;
      }
      const k = b.t > a.t ? Math.max(0, Math.min(1, (c - a.t) / (b.t - a.t))) : 1,
        nx = a.x + (b.x - a.x) * k,
        ny = a.y + (b.y - a.y) * k;
      u.v = dt > 0 ? Math.hypot(nx - u.x, ny - u.y) / dt : 0;
      u.x = nx;
      u.y = ny;
      u.z = a.z + (b.z - a.z) * k;
      u.heading = a.h + wrap(b.h - a.h) * k;
      if (u.flies) {
        u.netRoll = (a.r || 0) + ((b.r || 0) - (a.r || 0)) * k;
        u.netTilt = (a.p || 0) + ((b.p || 0) - (a.p || 0)) * k;
      }
      const kind = k < 0.5 ? a.kind : b.kind;
      if (kind && kind !== R.kind) {
        R.kind = kind;
        if (kind[0] === '~') {
          const [K, during] = kind.slice(1).split('|');
          if (K) w.oneShot(u, K, during || 'idle');
        } else w.setAnim(u, kind);
      }
    }
    u.holder.position.set(u.x, u.y, u.z);
    if (u.flies && u.netRoll !== undefined) u.holder.rotation.set(u.netTilt, u.netRoll, u.heading + Math.PI / 2, 'ZYX');
    else u.holder.rotation.z = u.heading + Math.PI / 2;
    w.show(u, dt);
  }

  heroUsed() {
    this.heroAt = this.matchScore + HERO.points;
    this.heroSaid = false;
    this.role = 'hero';
  }

  respawnView() {
    if (this.ov?.on && !this.ov.wantDeploy) this.ov.enterCommand();
    else this.openDeploy();
  }

  buffPlayer(u) {
    const w = this.world;
    if (PLAYER_HEALTH > 0) w.addCombatMod(u, MOD.HEALTH, MOD_KEY + 1, 'shooter-player', PLAYER_HEALTH);
    w.addCombatMod(u, MOD.DAMAGE, MOD_KEY, 'shooter-player', PLAYER_DAMAGE);
    w.addCombatMod(u, MOD.FIRE_RATE, MOD_KEY, 'shooter-player', PLAYER_FIRE_RATE);
  }

  untwist() {
    const T = this.twist;
    if (T.head) T.head.scale.setScalar(1);
    if (this.body && this.body.inst) {
      this.body.inst.skinMask = null;
      this.body.inst.skinPin = null;
      for (const o of T.rigid || []) o.visible = true;
      this.body.inst.syncFromBones();
    }
    T.mask = null;
    T.rigid = [];
    T.bone = T.head = null;
    T.arms = [];
    T.live = [];
  }

  possess(q, u, hero) {
    const w = this.world;
    q.noAI = true;
    q.selectable = false;
    q.foe = null;
    u.path.length = 0;
    u.target = null;
    this.P.h = this.P.vz = 0;
    this.game.keys?.clear?.();
    this.lastHitBy = null;
    this.P.yaw = this.yaw = u.heading;
    this.pitch = -0.05;
    u.pilot = this.P;
    settlePose(u.inst);
    this.body = u;
    if (!hero) this.buffPlayer(u);
    this.spread = SPREAD.still;
    this.bloom = 0;
    this.hurtMarks.length = 0;
    this.setupGun(u);
    this.nades = this.role === 'trooper' && this.nadeWeapon() ? GRENADE.count : 0;
    this.nadeAt = 0;
    this.lockT = null;
    this.lockK = 0;
    this.reticle();
    this.smoothZ = null;
    this.dip = 0;
    this.kickDebt = 0;
    this.pain = 0;
    this.state = 'alive';
    _box.setFromObject(u.holder);
    const h = Math.max(6, Math.min(40, _box.max.z - _box.min.z || u.aimZ * 1.6 || 10));
    this.eye = h * 0.9;
    this.camBack = h * 2.6;
    this.big = u.kind !== 'INFANTRY' && !u.foot ? { top: Math.max(4, _box.max.z - u.z), len: Math.max(4, Math.hypot(_box.max.x - _box.min.x, _box.max.y - _box.min.y) * 0.5), z: null } : null;
    const T = this.twist;
    T.bone = u.inst?.bone('B_CHEST') || u.inst?.bone('B_SPINE') || u.inst?.bone('B_TORSO') || null;
    T.head = u.inst?.bone('B_HEAD') || null;
    T.arms = [
      ['B_CLAV_R', 'B_BICEP_R', 'B_UPPERARM_R'],
      ['B_CLAV_L', 'B_BICEP_L', 'B_UPPERARM_L']
    ]
      .map(names => names.map(n => u.inst?.bone(n)).find(Boolean))
      .filter(Boolean);
    T.live = [];
    T.muzzle = u.inst?.bones?.find(x => /^MUZZLE/i.test(x.name)) || null;
    {
      const keep = new Set(),
        bones = u.inst?.bones || [],
        all = new Set(bones);
      T.gunRoot = null;
      if (T.muzzle && T.bone) {
        const under = new Set();
        T.bone.traverse(o => under.add(o));
        if (!under.has(T.muzzle)) {
          const above = new Set();
          for (let a = T.bone.parent; a; a = a.parent) above.add(a);
          let g = T.muzzle;
          while (g.parent && all.has(g.parent) && !above.has(g.parent)) g = g.parent;
          T.gunRoot = g;
        }
      }
      for (const root of T.gunRoot ? [...T.arms, T.gunRoot] : T.arms) root.traverse(o => all.has(o) && keep.add(o));
      T.mask = keep.size ? new Set(bones.filter(x => !keep.has(x))) : null;
      T.rigid = [];
      if (T.mask) for (const bn of T.mask) for (const c of bn.children) if (!all.has(c) && c.visible) T.rigid.push(c);
    }
    T.fixYaw = T.fixPitch = 0;
    T.calib = null;
    T.heads = null;
    T.headNow = 0;
    this.fpZ = undefined;
    T.anchor = null;
    T.gunRel = null;
    this.panel.style.display = 'none';
    this.hud.style.display = 'block';
    this.ov?.possessed(u);
    this.lock();
    this.hints();
  }

  died() {
    const fell = this.body;
    if (fell) this.fellAt = { x: fell.x, y: fell.y, z: fell.z + this.eye * 0.5 };
    const k = this.lastHitBy;
    this.killer = k && this.world.time - (this.lastHitAt || -99) < 4 && k.x !== undefined ? k : null;
    this.killerName = this.killer ? this.nameOf(this.killer.type) : '';
    this.deathCam = null;
    this.leave(true);
    this.untwist();
    const w = this.world;
    this.deaths++;
    this.state = 'dead';
    this.deadAt = w.time;
    this.readyAt = w.time + RESPAWN;
    if (this.body) this.body.pilot = undefined;
    this.body = null;
    this.fire = this.zoom = false;
    this.crouched = false;
    this.hud.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (this.killerName) this.banner(`Killed by ${this.killerName}`);
    this.game.keys?.clear?.();
  }

  banner(text) {
    let e = this.bannerEl;
    if (!e) {
      e = this.bannerEl = document.createElement('div');
      e.className = 'sh-banner';
      document.body.appendChild(e);
    }
    e.textContent = text;
    e.classList.remove('show');
    void e.offsetWidth;
    e.classList.add('show');
  }

  intro(cam) {
    const now = performance.now();
    if (!this.introAt && (activeLoadScreen() || this.world.time < 0.3)) return true;
    if (!this.introAt) {
      this.introAt = now;
      this.introUntil = now + INTRO.ms;
      const name = (db.t(this.game.map?.textId) || this.game.map?.planet || 'Battle').replace(/^.*?[-\u2013:]\s*/, '');
      this.introEl.innerHTML = '<div class="sh-intro-t"></div><div class="sh-intro-s">Conquest - capture and hold the command posts</div><div class="sh-intro-c"></div><div class="sh-intro-k">Press any key to skip</div>';
      this.introEl.querySelector('.sh-intro-t').textContent = name;
      this.introEl.style.display = 'flex';
      this.panel.style.display = 'none';
    }
    if (now >= this.introUntil) {
      if (this.introEl.style.display !== 'none') this.introEl.style.display = 'none';
      return false;
    }
    const w = this.world,
      side = (w.n - 1) * 20,
      k = (now - this.introAt) / INTRO.ms,
      home = this.home(this.me) || { x: side / 2, y: side / 2 },
      cx = side / 2,
      cy = side / 2,
      a0 = Math.atan2(home.y - cy, home.x - cx),
      a = a0 + k * 0.9,
      r = side * (0.42 - 0.12 * k),
      x = cx + Math.cos(a) * r,
      y = cy + Math.sin(a) * r,
      z = heightAt(w.terrain, x, y) + 520 - 220 * k;
    cam.position.set(x, y, Math.max(z, heightAt(w.terrain, x, y) + 60));
    cam.up.set(0, 0, 1);
    cam.lookAt(cx, cy, heightAt(w.terrain, cx, cy));
    this.setFov(cam, 55, 5);
    const left = Math.ceil((this.introUntil - now) / 1000),
      c = this.introEl.querySelector('.sh-intro-c'),
      t = `Deploying in ${left}`;
    if (c && c.textContent !== t) c.textContent = t;
    return true;
  }

  killCam(cam, real) {
    const at = this.fellAt,
      k = this.killer,
      w = this.world,
      t = Math.min(1, (w.time - this.deadAt) / 0.8),
      ease = t * t * (3 - 2 * t);
    const D = (this.deathCam ||= { from: this.lastCam.p.clone(), q: this.lastCam.q.clone(), fov: cam.fov || FOV });
    if (!at) {
      cam.position.copy(D.from);
      cam.quaternion.copy(D.q);
      return;
    }
    const tx = k ? k.x : at.x + Math.cos(this.yaw) * 50,
      ty = k ? k.y : at.y + Math.sin(this.yaw) * 50,
      tz = k ? k.z + (k.kind === 'INFANTRY' ? this.heightOf(k) * 0.6 : Math.max(k.aimZ || 0, (k.hitRadius || 8) * 0.5)) : at.z;
    const dx = tx - at.x,
      dy = ty - at.y,
      dl = Math.hypot(dx, dy) || 1;
    const ex = at.x - (dx / dl) * 22,
      ey = at.y - (dy / dl) * 22,
      ez = Math.max(heightAt(w.terrain, ex, ey) + 6, at.z + 16);
    cam.position.set(D.from.x + (ex - D.from.x) * ease, D.from.y + (ey - D.from.y) * ease, D.from.z + (ez - D.from.z) * ease);
    cam.up.set(0, 0, 1);
    cam.lookAt(tx, ty, tz);
    _q2.copy(cam.quaternion);
    cam.quaternion.copy(D.q).slerp(_q2, ease);
    const d = Math.hypot(tx - cam.position.x, ty - cam.position.y, tz - cam.position.z),
      size = k ? Math.max(12, (k.hitRadius || 6) * 3) : 40,
      want = Math.max(22, Math.min(FOV, ((2 * Math.atan(size / Math.max(1, d))) * 180) / Math.PI));
    this.setFov(cam, Math.round((D.fov + (want - D.fov) * ease) * 10) / 10, 1);
  }

  shotBoost(s) {
    return this.seatOf() && s && s.w !== this.body?.weapon ? SHOT_GAIN.ride : SHOT_GAIN.foot;
  }

  recoil(from, s) {
    if (from !== this.body) return;
    if (s && s.w === this.nadeW) return;
    if (s && this.role === 'scout' && this.zoom) this.scopedShots.add(s);
    this.twist.kick = Math.min(0.3, this.twist.kick + RECOIL);
    const g = this.gun,
      w = this.world;
    g.lastShot = w.time;
    if (g.kind === 'heat') {
      g.heat = Math.min(1, g.heat + g.per);
      if (g.heat >= 1 && !g.hot) {
        g.hot = true;
        this.sfx('vent');
      }
    } else g.ammo = Math.max(0, g.ammo - 1);
    const k = g.kick * (this.zoom ? 0.6 : 1) * (this.P.crouch ? 0.7 : 1);
    this.pitch = Math.min(1.35, this.pitch + k);
    this.kickDebt += k;
    this.yaw = wrap(this.yaw + (Math.random() - 0.5) * k * KICK.yaw);
  }

  setupGun(u) {
    const g = this.gun,
      wp = u.weapon,
      P = wp && wp.proj,
      cat = P ? categoryOf(P) : CAT.DEFAULT;
    g.heat = 0;
    g.hot = false;
    g.lastShot = -9;
    g.refillAt = 0;
    g.name = this.nameOf(u.type);
    if (cat === CAT.ROCKET || cat === CAT.MPTL_ROCKET || cat === CAT.MISSILE || cat === CAT.GRENADE) {
      g.kind = 'ammo';
      g.max = g.ammo = cat === CAT.GRENADE ? AMMO.grenade : AMMO.rocket;
      g.kick = KICK.ammo;
    } else {
      g.kind = 'heat';
      const rate = wp ? Math.max(1, wp.pulses || 1) / Math.max(0.05, (wp.recharge || 1) * this.world.fireDelay(u)) : 4;
      g.per = 1 / Math.max(HEAT.minShots, Math.round(rate * HEAT.burst));
      if (this.role === 'heavy') g.per *= HEAVY.heat;
      g.kick = KICK.heat;
    }
  }

  canFire() {
    const g = this.gun;
    return g.kind === 'heat' ? !g.hot : g.ammo > 0;
  }

  denied() {
    const now = performance.now();
    if (now < (this.deniedAt || 0)) return;
    this.deniedAt = now + 450;
    this.sfx('empty');
  }

  coolGun(dt) {
    const g = this.gun,
      w = this.world;
    if (g.kind === 'heat') {
      if (w.time - g.lastShot > HEAT.delay) g.heat = Math.max(0, g.heat - HEAT.cool * dt * (g.hot ? 0.8 : 1));
      if (g.hot && g.heat <= HEAT.unlock) g.hot = false;
    } else if (g.ammo < g.max && this.body && this.inHealZone(this.body)) {
      if (w.time >= g.refillAt) {
        if (g.refillAt > 0) g.ammo++;
        g.refillAt = w.time + AMMO.refill;
      }
    } else g.refillAt = 0;
    if (this.role === 'trooper' && this.nadeW && this.nades < GRENADE.count && this.body && this.inHealZone(this.body)) {
      if (w.time >= this.nadeAt) {
        if (this.nadeAt > 0) this.nades++;
        this.nadeAt = w.time + GRENADE.refill;
      }
    } else this.nadeAt = 0;
    const b = this.body;
    if (this.role === 'hero' && this.state === 'alive' && b && !b.dead && !b.inside) {
      const loss = b.maxHealth * HERO.drain * dt;
      if (b.health > loss + 1) b.health -= loss;
      else w.hurt(b, b.health + 1, null);
    }
    if (!this.heroSaid && this.matchScore >= this.heroAt) {
      this.heroSaid = true;
      this.announce('Hero unlocked - choose one at your next deploy', 'good');
    }
  }

  driveOk(u, x, y) {
    const w = this.world,
      ix = Math.round(x / 20),
      iy = Math.round(y / 20);
    if (ix < 0 || iy < 0 || ix >= w.n || iy >= w.n) return false;
    const k = iy * w.n + ix;
    if (!w.open[k] || w.kind[k] & ~(TERRAIN.CLEAR | TERRAIN.STEEP | TERRAIN.SHIELD)) return false;
    const T = w.terrain,
      h = heightAt(T, x, y),
      wet = T.water;
    if (wet && wet.on && wet.level !== undefined && h < wet.level - WALK.wet) return false;
    const s = Math.max(Math.abs(heightAt(T, x + 10, y) - heightAt(T, x - 10, y)), Math.abs(heightAt(T, x, y + 10) - heightAt(T, x, y - 10))) / 20;
    return s <= WALK.drive;
  }

  walkable(x, y, need) {
    const w = this.world;
    if (w.isOpen(x, y, need)) return true;
    const ix = Math.round(x / 20),
      iy = Math.round(y / 20);
    if (ix < 0 || iy < 0 || ix >= w.n || iy >= w.n || !w.open[iy * w.n + ix]) return false;
    const T = w.terrain,
      h = heightAt(T, x, y),
      wet = T.water;
    if (wet && wet.level !== undefined && h < wet.level - WALK.wet) return false;
    const s = Math.max(Math.abs(heightAt(T, x + 10, y) - heightAt(T, x - 10, y)), Math.abs(heightAt(T, x, y + 10) - heightAt(T, x, y - 10))) / 20;
    return s <= WALK.slope;
  }

  throwPitch() {
    const k = (this.world.time - this.throwAt) / THROW.time;
    if (k < 0 || k > 1) return 0;
    if (k < THROW.peak) {
      const a = k / THROW.peak;
      return THROW.up * a * a * (3 - 2 * a);
    }
    const b = (k - THROW.peak) / (1 - THROW.peak);
    return b < 0.5 ? THROW.up + (THROW.down - THROW.up) * (b / 0.5) : THROW.down * (1 - (b - 0.5) / 0.5);
  }

  roleOf(c, cls) {
    if (c.hero || c.heroSpawn) return 'hero';
    if (c.vehicle) return 'trooper';
    let r = this.roles.get(c.unit);
    if (r) return r;
    const P = db.type((c.unit.str('Projectile_Types').split(',')[0] || '').trim()),
      cat = P ? categoryOf(P) : -1;
    if (cat === CAT.ROCKET || cat === CAT.MPTL_ROCKET || cat === CAT.MISSILE) r = 'rocket';
    else {
      const foot = cls.filter(x => !x.hero && !x.heroSpawn && !x.vehicle),
        S = foot.map(x => this.statsOf(x)),
        med = k => {
          const v = S.map(s => s[k]).filter(v => v > (k === 'range' ? SHORT.range : 0)).sort((a, b) => a - b);
          return v.length ? v[(v.length - 1) >> 1] : 0;
        },
        me = this.statsOf(c);
      if (foot.length > 1 && me.range > 0 && me.range >= med('range') * ROLE.scout) r = 'scout';
      else if (foot.length > 1 && ((me.health > 0 && me.health >= med('health') * ROLE.heavy) || (me.fire > 0 && me.fire >= med('fire') * ROLE.heavyFire))) r = 'heavy';
      else r = 'trooper';
    }
    this.roles.set(c.unit, r);
    return r;
  }

  heroCards() {
    const w = this.world,
      side = this.me,
      faction = this.game.factions[side],
      out = new Map();
    for (const u of w.units) {
      if (u.dead || !u.structure || !w.ally(u.side, side)) continue;
      for (const t of buildsFor(u.type, faction, w.campaign)) {
        if (out.has(t.name) || !isHeroCompany(t) || missingFor(w, side, t).length) continue;
        const k = db.type(t.list('Company_Units')[0] || '');
        if (!k || !/infantry/i.test(k.str('MovementClass')) || !k.str('Projectile_Types')) continue;
        if (w.units.some(x => !x.dead && x.type === k && w.ally(x.side, side))) continue;
        out.set(t.name, { company: t, unit: k, cost: 0, heroSpawn: true });
      }
    }
    return [...out.values()];
  }

  rides() {
    const out = [];
    if (this.netClient) {
      const N = this.game.shooterNet;
      for (const id of N?.freeRides || []) {
        const v = N.byId.get(id),
          q = v && v.squad;
        if (!v || v.dead || !q || q === this.rideQ) continue;
        out.push({ company: q.type || v.type, unit: v.type, cost: 0, vehicle: q });
      }
      return out;
    }
    for (const q of this.crewed) {
      const v = q.members[0];
      if (!v || v.dead || q.side !== this.me || q.crew.in || q === this.rideQ || v.health < v.maxHealth * VEH.bail) continue;
      out.push({ company: q.type, unit: v.type, cost: 0, vehicle: q });
    }
    return out;
  }

  cards() {
    const cls = this.classes();
    return [...cls, ...this.rides(), ...this.heroCards()];
  }

  spawnSpots() {
    const list = this.points(),
      w = this.world,
      now = w.time;
    let n = 0;
    for (const T of this.teams) {
      if (T.side !== this.me || n >= SQUAD_SPAWN.max) continue;
      const L = T.lead;
      if (!L || L.dead || L.inside) continue;
      const st = this.bots.get(L);
      if ((st && st.mode === 'fight' && now < st.until) || now - (L.lastHit ?? -99) < SQUAD_SPAWN.calm) continue;
      let s = this.squadSpots.get(T);
      if (!s)
        this.squadSpots.set(
          T,
          (s = {
            squad: T,
            n: 0,
            get x() {
              return T.lead.x;
            },
            get y() {
              return T.lead.y;
            }
          })
        );
      s.n = ++n;
      list.push(s);
    }
    return list;
  }

  nadeWeapon() {
    if (this.nadeW !== undefined) return this.nadeW;
    let P = null,
      any = null;
    for (const t of db.types.values()) {
      if (!t || !t.str || !/^GRENADE$/i.test(t.str('Projectile_Category')) || !(t.num('Projectile_Blast_Area_Range', 0) > 0)) continue;
      any ||= t;
      if (/thermal/i.test(t.str('Projectile_Ground_Detonation_Particle'))) {
        P = t;
        break;
      }
    }
    P ||= any;
    if (!P) return (this.nadeW = null);
    const reachOf = W => {
      const g = this.lobGravity(W);
      return g > 0 ? ((W.speed * W.speed) / g) * GRENADE.reach : 0;
    };
    const W = {
      proj: P,
      damage: 0,
      damageType: P.str('Damage_Type'),
      speed: P.num('Max_Speed', 10) * 30 * GRENADE.speed,
      pulses: 1,
      pulseDelay: 0,
      recharge: 1,
      cooldown: 0,
      left: 0,
      timer: 0,
      baseRange: 0,
      range: 0,
      spare: new Set(),
      inacc: [],
      muzzles: [],
      target: null,
      fixed: -1,
      blastR: Math.max(12, P.num('Projectile_Blast_Area_Range', 0)) * GRENADE.radius,
      blastD: Math.max(10, P.num('Projectile_Blast_Area_Damage', 0)) * GRENADE.damage
    };
    W.range = W.baseRange = reachOf(W);
    return (this.nadeW = W);
  }

  lobGravity(W) {
    return W.proj.num('Projectile_Grenade_Gravity', 0) * W.proj.num('Projectile_Grenade_Gravity_Lob_Mod', 1) * 900;
  }

  lobPlan(W, D, dz) {
    const g = this.lobGravity(W),
      x = D || 0.0001;
    if (!(g > 0)) return null;
    let v = W.speed,
      best = null;
    for (let k = 0; k < 64 && v > 0; k++, v *= 0.8) {
      const v2 = v * v,
        disc = v2 * v2 - 2 * g * dz * v2 - g * g * x * x;
      if (disc < 0) break;
      const u2 = (v2 - g * dz - Math.sqrt(disc)) / (((dz * dz) / (x * x) + 1) * 2);
      if (u2 < 0) break;
      best = { v, angle: Math.acos(Math.min(1, Math.sqrt(u2) / v)), g };
      if (!W.proj.bool('Projectile_Grenade_Can_Lob_Slower')) break;
    }
    return best;
  }

  nadeTarget() {
    const b = this.body,
      W = this.nadeW,
      a = this.aim,
      T = this.nadeSpot;
    let dx = a.x - b.x,
      dy = a.y - b.y,
      d = Math.hypot(dx, dy);
    if (!(d > 1)) {
      dx = Math.cos(this.yaw);
      dy = Math.sin(this.yaw);
      d = 1;
    }
    const k = Math.min(d, W.range) / d;
    T.x = b.x + dx * k;
    T.y = b.y + dy * k;
    T.z = heightAt(this.world.terrain, T.x, T.y);
    return T;
  }

  throwNade() {
    const b = this.body,
      w = this.world,
      W = this.nadeWeapon();
    if (!W || !b || b.dead || this.seatOf() || this.role !== 'trooper') return;
    if (this.nades <= 0) {
      this.denied();
      return;
    }
    const t = this.nadeTarget();
    if (w.fire(b, t, W) === false) {
      this.flash('Out of reach');
      return;
    }
    this.nades--;
    this.throwAt = w.time;
    if (animReady(b.type, 'BOMBTOSS') && w.oneShot(b, 'BOMBTOSS', 'toss')) b.cast = b.onceEnd;
  }

  lockOn(real, d) {
    const b = this.body;
    if (this.role !== 'rocket' || !this.zoom || !b || this.seatOf()) {
      this.lockT = null;
      this.lockK = 0;
      return;
    }
    const w = this.world,
      E = this.eyeAt,
      R = (b.range || 300) * LOCK.reach;
    let best = null,
      ba = LOCK.cone;
    for (const e of w.units) {
      if (e.dead || e.inside || e.structure || e.foot || (e.kind !== 'VEHICLE' && e.kind !== 'AIR') || e.side < 0 || !w.enemy(b, e)) continue;
      const dx = e.x - E.x,
        dy = e.y - E.y,
        dz = e.z + (e.aimZ || 0) - E.z,
        l = Math.hypot(dx, dy, dz);
      if (l > R || l < 1) continue;
      const a = Math.acos(Math.max(-1, Math.min(1, (dx * d.x + dy * d.y + dz * d.z) / l)));
      if (a < ba) {
        ba = a;
        best = e;
      }
    }
    if (best && !this.sees(b, best)) best = null;
    if (best !== this.lockT) {
      if (best && this.lockK < 1) this.sfx('empty');
      this.lockT = best;
      this.lockK = 0;
    } else if (best) {
      const was = this.lockK;
      this.lockK = Math.min(1, this.lockK + real / LOCK.time);
      if (was < 1 && this.lockK >= 1) this.sfx('lock');
    }
  }

  drawAimAids(x, cam, dpr) {
    const b = this.body,
      w = this.world;
    if (!b || this.state !== 'alive') return;
    if (this.nadeHeld && this.role === 'trooper' && this.nadeW && this.nades > 0 && !this.seatOf()) {
      const W = this.nadeW,
        t = this.nadeTarget(),
        z0 = b.z + (b.aimZ || 0),
        D = Math.hypot(t.x - b.x, t.y - b.y),
        L = this.lobPlan(W, D, t.z - z0);
      if (L) {
        const ux = (t.x - b.x) / (D || 1),
          uy = (t.y - b.y) / (D || 1),
          vh = Math.cos(L.angle) * L.v,
          vz = Math.sin(L.angle) * L.v,
          T = D / Math.max(1, vh);
        x.strokeStyle = 'rgba(255,215,106,0.9)';
        x.lineWidth = 2 * dpr;
        x.setLineDash([6 * dpr, 5 * dpr]);
        x.beginPath();
        let first = true;
        for (let i = 1; i <= GRENADE.arc; i++) {
          const s = (T * i) / GRENADE.arc;
          _ndc.set(b.x + ux * vh * s, b.y + uy * vh * s, z0 + vz * s - 0.5 * L.g * s * s).project(cam);
          if (_ndc.z > 1) {
            first = true;
            continue;
          }
          const px = (_ndc.x * 0.5 + 0.5) * x.canvas.width,
            py = (-_ndc.y * 0.5 + 0.5) * x.canvas.height;
          if (first) x.moveTo(px, py);
          else x.lineTo(px, py);
          first = false;
        }
        x.stroke();
        x.setLineDash([]);
        x.beginPath();
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2,
            px0 = t.x + Math.cos(a) * W.blastR,
            py0 = t.y + Math.sin(a) * W.blastR;
          _ndc.set(px0, py0, heightAt(w.terrain, px0, py0) + 1).project(cam);
          const px = (_ndc.x * 0.5 + 0.5) * x.canvas.width,
            py = (-_ndc.y * 0.5 + 0.5) * x.canvas.height;
          if (i) x.lineTo(px, py);
          else x.moveTo(px, py);
        }
        x.strokeStyle = 'rgba(255,90,60,0.9)';
        x.stroke();
      }
    }
    const e = this.lockT;
    if (e && !e.dead) {
      _ndc.set(e.x, e.y, e.z + (e.aimZ || e.hitRadius * 0.5 || 8)).project(cam);
      if (_ndc.z < 1) {
        const px = (_ndc.x * 0.5 + 0.5) * x.canvas.width,
          py = (-_ndc.y * 0.5 + 0.5) * x.canvas.height,
          locked = this.lockK >= 1,
          dist = Math.max(1, cam.position.distanceTo(_lk.set(e.x, e.y, e.z))),
          focal = x.canvas.height / 2 / Math.tan((cam.fov * Math.PI) / 360),
          fit = Math.max(22 * dpr, Math.min(180 * dpr, (Math.max(e.hitRadius || 0, e.aimZ || 0) * 0.75 * focal) / dist)),
          r = locked ? fit : fit + (1 - this.lockK) * 30 * dpr,
          c = r * 0.4;
        x.strokeStyle = locked ? 'rgba(255,74,50,1)' : 'rgba(255,215,106,0.95)';
        x.lineWidth = 2.5 * dpr;
        x.beginPath();
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1]
        ]) {
          x.moveTo(px + sx * r, py + sy * (r - c));
          x.lineTo(px + sx * r, py + sy * r);
          x.lineTo(px + sx * (r - c), py + sy * r);
        }
        x.stroke();
        x.font = `bold ${11 * dpr}px Arial,sans-serif`;
        x.textAlign = 'center';
        x.textBaseline = 'top';
        x.fillStyle = x.strokeStyle;
        x.fillText(locked ? 'LOCKED' : `LOCKING ${Math.round(this.lockK * 100)}%`, px, py + r + 4 * dpr);
      }
    }
  }

  inHealZone(u) {
    const w = this.world;
    for (const p of w.points)
      if (p.reinforce && p.side >= 0 && w.ally(p.side, u.side) && Math.hypot(p.x - u.x, p.y - u.y) <= (p.radius || 100) * REGEN.reach) return true;
    const h = this.home(u.side);
    return !!h && Math.hypot(h.x - u.x, h.y - u.y) <= 100 * REGEN.reach;
  }

  regen() {
    const w = this.world,
      now = w.time,
      k = REGEN.tick;
    this.healing = false;
    for (const u of w.units) {
      if (u.dead || u.structure || u.inside || !u.foot || u.side < 0 || u === this.body) continue;
      const left = this.rocketsLeft(u);
      if (left < AMMO.rocket && this.inHealZone(u)) {
        const at = this.ammoAt.get(u) || 0;
        if (now >= at) {
          if (at > 0) this.ammoOf.set(u, left + 1);
          this.ammoAt.set(u, now + AMMO.refill);
        }
      } else this.ammoAt.delete(u);
    }
    for (const u of w.units) {
      if (u.dead || u.structure || u.inside || !u.foot || u.side < 0 || u.health >= u.maxHealth || (u === this.body && this.role === 'hero')) continue;
      let r = 0;
      if (this.inHealZone(u)) r = REGEN.heal;
      else if (now - (u.lastHit ?? -99) > REGEN.wait) r = REGEN.rate;
      if (!r) continue;
      u.health = Math.min(u.maxHealth, u.health + u.maxHealth * r * k);
      if (u === this.body && r === REGEN.heal) this.healing = true;
    }
  }

  sfx(kind) {
    const A = this.game.audio,
      ctx = A && A.ctx;
    if (!ctx || !A.master) return;
    const t = ctx.currentTime,
      vol = (A.sfxVolume ?? 0.7) * 0.9,
      tone = (f, d, type, g, at = 0, f2 = f) => {
        const o = ctx.createOscillator(),
          a = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f, t + at);
        if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + at + d);
        a.gain.setValueAtTime(0.0001, t + at);
        a.gain.exponentialRampToValueAtTime(g * vol, t + at + 0.005);
        a.gain.exponentialRampToValueAtTime(0.0001, t + at + d);
        o.connect(a);
        a.connect(A.master);
        o.start(t + at);
        o.stop(t + at + d + 0.02);
      },
      noise = (d, g, freq) => {
        const n = Math.floor(ctx.sampleRate * d),
          buf = (this.noiseBuf ||= ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate));
        if (!this.noiseFilled) {
          this.noiseFilled = true;
          const ch = buf.getChannelData(0);
          for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
        }
        const src = ctx.createBufferSource(),
          f = ctx.createBiquadFilter(),
          a = ctx.createGain();
        src.buffer = buf;
        f.type = 'bandpass';
        f.frequency.value = freq;
        f.Q.value = 0.8;
        a.gain.setValueAtTime(g * vol, t);
        a.gain.exponentialRampToValueAtTime(0.0001, t + d);
        src.connect(f);
        f.connect(a);
        a.connect(A.master);
        src.start(t, 0, Math.min(1, n / ctx.sampleRate));
        src.stop(t + d);
      };
    if (kind === 'lock') {
      tone(2300, 0.05, 'square', 0.08);
      tone(3100, 0.07, 'square', 0.07, 0.045);
    } else if (kind === 'vent') noise(0.6, 0.25, 2600);
    else if (kind === 'noise') noise(0.001, 0.0002, 1000);
    else if (kind === 'warn') {
      tone(1350, 0.06, 'square', 0.07);
      tone(1350, 0.06, 'square', 0.07, 0.11);
    }
    else if (kind === 'empty') tone(320, 0.03, 'square', 0.06);
    else if (kind === 'beat') {
      tone(62, 0.13, 'sine', 0.5);
      tone(55, 0.12, 'sine', 0.35, 0.22);
    }
  }

  hurtMe(amount) {
    const b = this.body;
    if (!b || !(amount > 0)) return;
    if (this.game.music) this.game.music.fought = this.world.time;
    this.pain = Math.min(1, this.pain + 0.25 + (amount / Math.max(1, b.maxHealth)) * 2);
  }

  impact(s) {
    this.nearMiss(s);
    this.shotLanded(s);
    this.flashAt(s);
    const b = this.body;
    if (!b || !s.struck || s.struck.side < 0 || !this.world.enemy(b, s.struck)) return;
    if (!this.mine(s.from)) return;
    const now = performance.now();
    this.hitUntil = now + 120;
  }

  owns(e) {
    if (this.game.menus?.open || this.game.over) return false;
    if (e && e.type && e.type.startsWith('key') && (e.code === 'Escape' || /^F\d+$/.test(e.code))) return false;
    return true;
  }

  canvas() {
    return this.game.renderer.domElement;
  }

  lock() {
    const c = this.canvas();
    if (document.pointerLockElement !== c) c.requestPointerLock?.()?.catch?.(() => {});
  }

  input() {
    const g = this.game,
      on = (ev, fn) => g.listen(ev, fn, { capture: true });
    on('keydown', e => {
      if (!this.owns(e)) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (this.setEl && this.setEl.style.display !== 'none') {
        if (e.code === 'Escape' || pressed(e, 'SHOOTER_SETTINGS')) this.closeSettings();
        e.stopImmediatePropagation();
        return;
      }
      if (this.ov?.on && pressed(e, 'SHOOTER_OVERLORD')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (!e.repeat) this.ov.keyPress();
        return;
      }
      if (this.state === 'command') {
        if (e.code === 'Enter') {
          e.stopImmediatePropagation();
          this.ov.deployMenu();
        }
        return;
      }
      if (this.state !== 'alive') {
        if (pressed(e, 'SHOOTER_SETTINGS')) {
          this.openSettings();
          e.stopImmediatePropagation();
          return;
        }
        if (this.introUntil > performance.now()) {
          this.introUntil = 0;
          e.stopImmediatePropagation();
          return;
        }
        if (e.code === 'Enter') this.deploy();
        else if (/^(Key[WASD]|Arrow)/.test(e.code)) return;
        e.stopImmediatePropagation();
        return;
      }
      e.stopImmediatePropagation();
      e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (pressed(e, 'SHOOTER_JUMP')) {
        this.P.jump = true;
        this.crouched = false;
      }
      if (pressed(e, 'SHOOTER_CROUCH') && !this.seatOf()) this.crouched = !this.crouched;
      if (pressed(e, 'SHOOTER_DODGE')) this.P.dodge = true;
      if (pressed(e, 'SHOOTER_GRENADE')) this.nadeHeld = true;
      if (pressed(e, 'SHOOTER_SETTINGS')) this.openSettings();
      if (pressed(e, 'SHOOTER_MAP')) this.bigMap.style.display = this.bigMap.style.display === 'none' ? 'flex' : 'none';
      if (pressed(e, 'SHOOTER_ENTER')) this.seated() ? this.leave() : this.enter();
      if (pressed(e, 'DIRECT_VIEW')) {
        if (this.seatOf() && !this.post) this.cockpit = !this.cockpit;
        else this.third = !this.third;
      }
      if (pressed(e, 'SHOOTER_SCORES')) this.scoreEl.style.display = 'block';
      for (let n = 1; n <= 3; n++) if (pressed(e, 'SHOOTER_ABILITY_' + n) || pressed(e, 'ABILITY_' + n)) this.ability(n - 1);
    });
    on('keyup', e => {
      this.keys.delete(e.code);
      if (!held(this.keys, 'SHOOTER_SCORES')) this.scoreEl.style.display = 'none';
      if (this.nadeHeld && !held(this.keys, 'SHOOTER_GRENADE')) {
        this.nadeHeld = false;
        if (this.state === 'alive') this.throwNade();
      }
      if (this.state === 'alive' && this.owns(e)) e.stopImmediatePropagation();
    });
    on('mousemove', e => {
      if (this.state !== 'alive' || document.pointerLockElement !== this.canvas()) return;
      e.stopImmediatePropagation();
      const C = this.cfg,
        k = (this.zoom ? (this.role === 'scout' && !this.seatOf() ? SCOPE.sens : 0.45) * C.ads : 1) * C.sens;
      this.yaw = wrap(this.yaw - e.movementX * SENS * k);
      this.pitch = Math.max(-1.4, Math.min(1.35, this.pitch - e.movementY * SENS * k * (C.invert ? -1 : 1)));
    });
    on('mousedown', e => {
      if (this.introUntil > performance.now()) this.introUntil = 0;
      if (!this.owns(e)) return;
      if (this.state === 'command') return;
      if (e.target !== this.canvas()) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (this.state !== 'alive') return;
      if (document.pointerLockElement !== this.canvas()) {
        this.lock();
        return;
      }
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.zoom = true;
    });
    on('mouseup', e => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.zoom = false;
      if (this.state === 'alive' && this.owns(e)) e.stopImmediatePropagation();
    });
    on('wheel', e => {
      if (!this.owns(e)) return;
      if (this.state === 'alive') {
        e.stopImmediatePropagation();
        this.ov?.wheelAlive(e);
      } else if (this.state === 'command' && this.ov?.wheelCommand(e)) e.stopImmediatePropagation();
    });
    on('contextmenu', e => {
      if (this.state === 'alive') e.preventDefault();
    });
    on('blur', () => {
      this.keys.clear();
      this.fire = this.zoom = false;
      this.scoreEl.style.display = 'none';
    });
    document.addEventListener(
      'pointerlockchange',
      () => {
        if (document.pointerLockElement !== this.canvas()) {
          this.fire = this.zoom = false;
          this.keys.clear();
        }
      },
      { signal: g.life.signal }
    );
  }

  aimRay(o, d) {
    const w = this.world,
      skip = this.body,
      ride = this.rideQ,
      gq = this.gunQ,
      post = this.post;
    let best = REACH,
      hit = null;
    for (const u of w.units) {
      if (u.dead || u.inside || u === skip || u === post || (ride && u.squad === ride) || (gq && u.squad === gq) || !(u.hitRadius > 0) || u.holder?.visible === false) continue;
      const tall = u.kind === 'INFANTRY' ? this.heightOf(u) : 0,
        r = u.structure ? u.hitRadius * 0.8 : Math.max(u.hitRadius, 3),
        cx = u.x - o.x,
        cy = u.y - o.y,
        cz = (tall ? u.z + tall * 0.5 : u.z + (u.aimZ || 0) * 0.6) - o.z,
        t = cx * d.x + cy * d.y + cz * d.z;
      if (t <= 0 || t - r > best) continue;
      const px = cx - d.x * t,
        py = cy - d.y * t,
        pz = (cz - d.z * t) * (u.structure ? 1 : tall ? r / (tall * 0.5) : 0.6);
      if (px * px + py * py + pz * pz <= r * r) {
        best = t;
        hit = u;
      }
    }
    let prev = 0;
    for (let t = 4; t < best; t += t < 200 ? 4 : 10) {
      if (o.z + d.z * t <= heightAt(w.terrain, o.x + d.x * t, o.y + d.y * t)) {
        best = (prev + t) / 2;
        hit = null;
        break;
      }
      prev = t;
    }
    const s = this.aim;
    s.x = o.x + d.x * best;
    s.y = o.y + d.y * best;
    s.z = o.z + d.z * best;
    this.spot.x = s.x;
    this.spot.y = s.y;
    this.spot.z = s.z;
    this.aimHit = hit;
    return hit;
  }

  frame(real, cam) {
    if (this.state === 'command' && this.ov?.on) this.ov.frame(real, cam);
    else {
      if (this.state === 'alive') this.ov?.tickAlive(real);
      this.frameCore(real, cam);
    }
    this.ov?.after(cam);
  }

  frameCore(real, cam) {
    const g = this.game,
      w = this.world,
      v = g.view,
      b = this.body;
    const P = this.P;
    this.realDt = real;
    this.gamepad(real);
    if (g.over && !this.ended) this.endStats();
    if ((this.benchN || this.game.setup.shooterNet?.spectator) && this.state !== 'alive') {
      this.panel.style.display = 'none';
      this.introUntil = 0;
      this.introAt = 1;
      if (this.watch(cam, real)) return;
    }
    if (this.state !== 'alive' || !b) {
      if (this.state === 'dead' && this.lastCam && w.time < this.deadAt + DEATH_CAM) {
        this.killCam(cam, real);
        return;
      }
      if (this.lastCam) {
        const at = this.fellAt || this.lastCam.p;
        v.x = at.x;
        v.y = at.y;
        v.dist = 460;
        v.pitch = 55 * (Math.PI / 180);
        this.lastCam = null;
      }
      if (this.state === 'deploy' && this.intro(cam, real)) return;
      this.setFov(cam, 55, 5);
      if (this.state === 'deploy' && !g.over && this.panel.style.display === 'none') this.openDeploy();
      return;
    }
    const k = this.keys,
      ride = this.rideQ,
      seat = this.seatOf();
    const M = this.padMove,
      f = Math.max(-1, Math.min(1, (held(k, 'SCROLL_UP') ? 1 : 0) - (held(k, 'SCROLL_DOWN') ? 1 : 0) + M.f)),
      s = Math.max(-1, Math.min(1, (held(k, 'SCROLL_RIGHT') ? 1 : 0) - (held(k, 'SCROLL_LEFT') ? 1 : 0) + M.s));
    const up = (held(k, 'SHOOTER_JUMP') ? 1 : 0) - (held(k, 'SHOOTER_CROUCH') ? 1 : 0);
    if (seat) {
      P.f = P.s = 0;
      P.fire = false;
      const lead = ride ? ride.members[0] : null,
        D = ride && ride.direct;
      if (D && lead) {
        if (D.lead !== lead) {
          D.lead = lead;
          D.slots.clear();
        }
        for (const m of ride.members) m.direct = D;
        D.turn = s;
        D.throttle = f;
      }
      if (lead && lead.pilot === this.A) {
        const A = this.A;
        A.throttle = f;
        A.turn = s;
        A.up = up;
        A.yaw = this.yaw;
        A.pitch = this.pitch;
        A.boost = held(k, 'SHOOTER_SPRINT') && f > 0;
        if (P.dodge && !A.barrel) A.barrel = { t: 0, dir: s < 0 ? -1 : 1 };
      }
      P.dodge = false;
    } else {
      P.f = f;
      P.s = s;
      P.run = held(k, 'SHOOTER_SPRINT') || M.run;
      if (P.run && (P.f || P.s)) this.crouched = false;
      P.crouch = this.crouched;
      P.yaw = this.yaw;
      P.zoom = this.zoom;
    }
    const cy = Math.cos(this.yaw),
      sy = Math.sin(this.yaw),
      cp = Math.cos(this.pitch),
      sp = Math.sin(this.pitch);
    const d = _v.set(cy * cp, sy * cp, sp);
    const scoped = !seat && this.zoom && this.role === 'scout',
      pk = this.ov ? this.ov.pull * this.ov.pull : 0,
      fp = !seat && (!this.third || scoped) && pk < 0.02;
    {
      const r = Math.min(this.kickDebt, this.kickDebt * KICK.recover * real);
      this.pitch -= r;
      this.kickDebt -= r;
      this.dip *= Math.exp(-real * 9);
      if (this.smoothZ === null || Math.abs(b.z - this.smoothZ) > this.eye * 3) this.smoothZ = b.z;
      else this.smoothZ += (b.z - this.smoothZ) * Math.min(1, real * (b.z > this.smoothZ ? 14 : 22));
    }
    const moving = !seat && (b.v || 0) > 1 && P.h <= 0,
      running = moving && P.run && !this.zoom,
      hh = this.eye / 0.9;
    if (moving) this.bobPhase += real * (b.v || 0) * BOB.rate;
    const bobA = moving && this.cfg.bob ? hh * (running ? BOB.run : BOB.walk) * (this.zoom ? 0.35 : 1) : 0,
      bobZ = Math.abs(Math.sin(this.bobPhase)) * bobA - this.dip,
      bobX = Math.sin(this.bobPhase) * bobA * 0.6,
      bz = this.smoothZ ?? b.z;
    const inner = !!seat && !this.post && this.cockpit && pk < 0.02;
    if (inner) cam.position.copy(this.seatView(seat, d, real));
    else if (seat) {
      const top = this.heightOfSeat(seat),
        tall = !seat.structure && !seat.flies && !this.post && top > seat.hitRadius * RIDE_CAM.tall,
        big = seat.structure ? seat.hitRadius * 1.6 : seat.hitRadius * 4.5,
        back = Math.max(this.post ? 40 : 60, big, tall ? top * RIDE_CAM.back : 0) * (this.zoom ? 0.6 : 1) * (1 + pk * 1.8),
        side = tall ? top * RIDE_CAM.side : 0,
        pz = tall ? seat.z + top * RIDE_CAM.lift + back * 0.12 : seat.z + Math.max(seat.aimZ || 0, seat.hitRadius * 0.8) + back * 0.12;
      cam.position.set(seat.x - d.x * back + sy * side, seat.y - d.y * back - cy * side, pz - d.z * back);
    } else if (fp && this.big) {
      const G = this.big,
        want = bz + G.top * RIDE_CAM.eye + 1.5,
        ahead = G.len * RIDE_CAM.ahead,
        hc = Math.cos(b.heading),
        hs = Math.sin(b.heading);
      G.z = G.z === null || Math.abs(want - G.z) > G.top * 0.5 ? want : G.z + (want - G.z) * Math.min(1, real * RIDE_CAM.settle);
      cam.position.set(b.x + hc * ahead, b.y + hs * ahead, G.z);
    } else if (fp) {
      const h = this.eye / 0.9,
        back = h * FP_EYE.back,
        side = h * FP_EYE.right;
      const hn = this.twist.headNow,
        floor = hn > 0 ? bz + hn + this.eye * 0.03 + h * (FP_EYE.up + (P.crouch ? FP_EYE.crouchLift : 0)) : -Infinity,
        off = Math.max(P.crouch ? bz + this.eye * 0.65 + h * FP_EYE.up : bz + this.eye + h * FP_EYE.up, floor) - bz;
      this.fpZ = this.fpZ === undefined ? off : this.fpZ + (off - this.fpZ) * Math.min(1, real * 10);
      const ez = bz + this.fpZ;
      cam.position.set(b.x - cy * back + sy * (side + bobX), b.y - sy * back - cy * (side + bobX), ez + bobZ);
    } else if (this.big) {
      const G = this.big,
        back = Math.max(this.camBack, G.top * RIDE_CAM.back) * (this.zoom ? 0.6 : 1) * (1 + pk * 2.6),
        side = G.top * RIDE_CAM.side,
        pz = bz + G.top * RIDE_CAM.lift + pk * back * 0.5;
      cam.position.set(b.x - d.x * back + sy * side, b.y - d.y * back - cy * side, pz - d.z * back);
    } else {
      const back = this.camBack * (this.zoom ? 0.55 : 1) * (1 + pk * 2.6),
        side = this.eye * 0.35,
        pz = bz + this.eye * (P.crouch ? 0.75 : 1.05) + bobZ * 0.5 + pk * this.camBack * 1.2;
      cam.position.set(b.x - d.x * back + sy * side, b.y - d.y * back - cy * side, pz - d.z * back);
    }
    if (this.shake > 0.01) {
      const m = this.shake * (inner ? 1.4 : 2.5);
      cam.position.x += (Math.random() - 0.5) * m;
      cam.position.y += (Math.random() - 0.5) * m;
      cam.position.z += (Math.random() - 0.5) * m;
    }
    this.shake *= Math.exp(-real * 8);
    const floor = heightAt(w.terrain, cam.position.x, cam.position.y) + 2;
    if (cam.position.z < floor) cam.position.z = floor;
    cam.up.set(0, 0, 1);
    cam.lookAt(cam.position.x + d.x, cam.position.y + d.y, cam.position.z + d.z);
    {
      const boosting = !!seat && this.A.boost && this.rideQ && this.rideQ.members[0]?.pilot === this.A,
        want = this.zoom ? (scoped ? SCOPE.fov : ZOOM_FOV * (this.cfg.fov / FOV)) : this.cfg.fov + (running ? SPRINT_FOV : 0) + (boosting ? BOOST.fov : 0);
      this.fovNow += (want - this.fovNow) * Math.min(1, real * 10);
      this.setFov(cam, Math.round(this.fovNow * 10) / 10, fp || inner ? 0.3 : 1);
    }
    b.holder.visible = !b.inside;
    this.eyeAt.copy(cam.position);
    this.pose(b, fp && !this.big);
    if (scoped) b.holder.visible = false;
    this.scopeEl.style.display = scoped ? 'block' : 'none';
    this.feedGround();
    if (w.time >= this.clutterAt) {
      this.clutterAt = w.time + CLUTTER.tick;
      this.clutter();
    }
    this.lockOn(real, d);
    this.aimRay(cam.position, d);
    P.spot = this.aim;
    P.fire = !seat && this.fire;
    if (ride && ride.direct) {
      ride.direct.target = this.aim;
      ride.direct.firing = this.fire;
    }
    if (this.gunD) {
      this.gunD.target = this.aim;
      this.gunD.firing = this.fire;
    }
    const at = seat || b;
    v.x = at.x;
    v.y = at.y;
    v.dist = 1300;
    (this.lastCam ||= { p: new THREE.Vector3(), q: new THREE.Quaternion() }).p.copy(cam.position);
    this.lastCam.q.copy(cam.quaternion);
    this.drawHud();
    this.drawTags(cam);
  }

  pose(u, fp) {
    const T = this.twist,
      B = T.bone;
    if (T.head) {
      const s = fp ? 0.001 : 1;
      if (T.head.scale.x !== s) T.head.scale.setScalar(s);
    }
    const view = fp && !u.inside && T.mask && T.mask.size > 0;
    if (view !== !!u.inst.skinMask) {
      u.inst.skinMask = view ? T.mask : null;
      u.inst.skinPin = view ? T.bone : null;
      for (const o of T.rigid) o.visible = !view;
    }
    for (const L of T.live)
      if (L.bone.quaternion.equals(L.after)) {
        L.bone.quaternion.premultiply(_q2.copy(L.delta).invert());
        if (L.pos0 && L.bone.position.equals(L.pos1)) L.bone.position.copy(L.pos0);
      }
    T.live.length = 0;
    const base = u.anim && u.anim.anim;
    if (fp && base && T.head && !u.inside) {
      const heads = (T.heads ||= new Map());
      if (!heads.has(base)) {
        new AnimState(u.inst, base, { loop: true }).pose();
        u.holder.updateMatrixWorld(true);
        T.head.getWorldPosition(_hd);
        heads.set(base, _hd.z - u.holder.position.z);
        u.anim.pose();
      }
      T.headNow = heads.get(base);
    }
    if (!T.calib && T.muzzle && T.muzzle.parent && !u.inside) {
      const clip = animClip(u.type, 'ATTACKIDLE');
      if (clip) {
        new AnimState(u.inst, clip, { loop: true }).pose();
        u.inst.root.updateMatrixWorld(true);
        T.muzzle.getWorldPosition(_mz);
        T.muzzle.parent.getWorldPosition(_gp);
        T.calib = {
          y: wrap(Math.atan2(_mz.y - _gp.y, _mz.x - _gp.x) - u.heading),
          p: Math.atan2(_mz.z - _gp.z, Math.hypot(_mz.x - _gp.x, _mz.y - _gp.y))
        };
        if (T.gunRoot) {
          T.anchor = u.inst.bone('B_HAND_R') || u.inst.bone('B_HAND_L') || T.bone;
          T.gunRel = T.anchor ? new THREE.Matrix4().copy(T.anchor.matrixWorld).invert().multiply(T.gunRoot.matrixWorld) : null;
        }
      }
    }
    if (T.overlay && !u.inside) {
      const clip = animClip(u.type, 'ATTACKIDLE');
      if (clip) {
        if (!T.upper || T.upper.anim !== clip || T.upper.inst !== u.inst) {
          T.upper = new AnimState(u.inst, clip, { loop: true });
          T.upper.bound = T.upper.bound.filter(b => !LOWER_BONES.test(b.bone.name));
        }
        T.upper.advance(this.realDt || 0);
        T.upper.pose();
      }
    }
    const yaw = u.inside ? 0 : T.want,
      pitch = u.inside ? 0 : T.pitch,
      rx = Math.sin(this.yaw),
      ry = -Math.cos(this.yaw);
    const bend = (bone, a, p, pivot = null) => {
      if (!bone || !bone.parent || (Math.abs(a) < 1e-3 && Math.abs(p) < 1e-3)) return;
      bone.parent.getWorldQuaternion(_q2);
      _pq.copy(_q2);
      _q2.invert();
      const delta = new THREE.Quaternion();
      if (Math.abs(p) >= 1e-3) delta.setFromAxisAngle(_ax.set(rx, ry, 0).applyQuaternion(_q2).normalize(), p);
      if (Math.abs(a) >= 1e-3) delta.multiply(_q.setFromAxisAngle(_ax.copy(_Z).applyQuaternion(_q2).normalize(), a));
      const pos0 = pivot ? bone.position.clone() : null;
      if (pivot) {
        bone.getWorldPosition(_bw);
        _off.copy(pivot).sub(_bw);
        _rot.copy(_off).applyQuaternion(_q.copy(_pq).multiply(delta).multiply(_q2));
        _bw.add(_off).sub(_rot);
        bone.position.copy(bone.parent.worldToLocal(_bw));
      }
      bone.quaternion.premultiply(delta);
      T.live.push({ bone, delta, after: bone.quaternion.clone(), pos0, pos1: pos0 ? bone.position.clone() : null });
    };
    const aimed = !u.inside && Math.abs(T.want) + Math.abs(T.pitch) + (T.overlay ? 1 : 0) > 1e-3;
    if (!aimed) {
      T.fixYaw *= 0.8;
      T.fixPitch *= 0.8;
    }
    const held = view && T.overlay && T.upper,
      chestYaw = yaw + (aimed ? T.fixYaw : 0),
      chestPitch = held ? pitch : pitch * (T.arms.length ? AIM_PITCH.chest : 1),
      gunPivot = T.gunRoot && B ? (held ? _gpv.copy(this.eyeAt) : B.getWorldPosition(_gpv)) : null;
    bend(B, chestYaw, chestPitch, held ? this.eyeAt : null);
    const kick = T.kick;
    T.kick *= Math.exp(-(this.realDt || 0) * 14);
    const armPitch = (held ? 0 : pitch * AIM_PITCH.arms) + (u.inside ? 0 : T.raise || 0) + (aimed ? T.fixPitch : 0) + kick;
    const toss = u === this.body ? this.throwPitch() : 0;
    for (const arm of T.arms) bend(arm, 0, armPitch + (arm === T.arms[0] ? toss : 0));
    const pinned = T.overlay && T.gunRel && T.anchor && T.gunRoot.parent;
    if (pinned) {
      const G = T.gunRoot;
      T.anchor.updateWorldMatrix(true, false);
      G.parent.updateWorldMatrix(true, false);
      _gm.copy(G.parent.matrixWorld).invert().multiply(_gm2.multiplyMatrices(T.anchor.matrixWorld, T.gunRel));
      _gm.decompose(G.position, G.quaternion, _gs);
    } else if (gunPivot) bend(T.gunRoot, chestYaw, chestPitch + armPitch, gunPivot);
    const M = T.muzzle,
      G = M && M.parent;
    if (aimed && G && G.isBone !== false) {
      M.getWorldPosition(_mz);
      G.getWorldPosition(_gp);
      const cal = T.calib || { y: 0, p: 0 },
        ey = wrap(Math.atan2(_mz.y - _gp.y, _mz.x - _gp.x) - this.yaw - cal.y),
        ep = Math.atan2(_mz.z - _gp.z, Math.hypot(_mz.x - _gp.x, _mz.y - _gp.y)) - this.pitch - kick - cal.p;
      if (T.calib && Math.abs(ey) < 1.4) T.fixYaw = Math.max(-FIX.yaw, Math.min(FIX.yaw, T.fixYaw - ey * 0.35));
      if (fp) {
        const C = this.game.camera;
        C.updateMatrixWorld();
        _ndc.copy(_mz).project(C);
        let err = _ndc.z < 1 ? _ndc.y - this.fpMuzzleY : 0;
        if (ep > FP_TILT.max) err = Math.max(err, (ep - FP_TILT.max) * 2);
        if (ep < FP_TILT.min) err = Math.min(err, (ep - FP_TILT.min) * 2);
        T.fixPitch = Math.max(-FIX.pitch, Math.min(FIX.pitch, T.fixPitch - err * 0.25));
      } else if (T.calib && Math.abs(ep) < 1.4) T.fixPitch = Math.max(-FIX.pitch, Math.min(FIX.pitch, T.fixPitch - ep * 0.3));
    }
    if (B || T.head || T.arms.length) u.inst.syncFromBones();
  }

  endStats() {
    this.ended = true;
    this.panel.style.display = 'none';
    const g = this.game,
      w = this.world,
      won = w.winner === g.myTeam,
      el = document.createElement('div');
    el.className = 'sh-end';
    el.innerHTML = `<div class="sh-frame sh-end-box eaw-frame"><div class="sh-head"><div class="sh-title"></div><div class="sh-sub"></div></div>
      <div class="sh-end-body"><div><div class="sh-label">Reinforcements</div><div class="eaw-frame-s" style="line-height:0"><canvas width="420" height="200"></canvas></div><div class="sh-end-you"></div><div class="sh-end-pl" style="margin-top:10px"></div></div>
      <div><div class="sh-label">Top Soldiers</div><table class="sh-end-t sh-tbl"></table><div class="sh-label" style="margin-top:12px">Awards</div><div class="sh-end-aw"></div></div></div>
      <div class="sh-foot"><div></div><button class="sh-go eaw-btn">Continue</button></div></div>`;
    el.querySelector('.sh-title').textContent = this.endTitle || (won ? 'Victory' : 'Defeat');
    el.querySelector('.sh-sub').textContent = this.tickets ? this.teamTickets().map(e => `${e.label} ${e.t}`).join('   ') : g.factions.join('   ');
    el.querySelector('.sh-end-pl').replaceChildren(...this.rowsTable(this.playerTable()));
    el.querySelector('.sh-end-you').textContent = `You: ${this.kills} kills, ${this.assists} assists, ${this.stats.heads} headshots, ${this.stats.vehicles} vehicles, ${this.caps} captures, ${this.deaths} deaths, score ${this.matchScore}`;
    const rows = [...this.ledger.values()].sort((p, q) => q.kills + q.vkills * 2 + q.caps - (p.kills + p.vkills * 2 + p.caps)),
      t = el.querySelector('.sh-end-t');
    t.innerHTML = '<tr><th>Name</th><th>Kills</th><th>Vehicles</th><th>Captures</th></tr>';
    for (const r of rows.slice(0, 5)) {
      const tr = document.createElement('tr');
      if (r.me) tr.className = 'me';
      for (const v of [r.name, r.kills, r.vkills, r.caps]) {
        const td = document.createElement('td');
        td.textContent = String(v);
        tr.appendChild(td);
      }
      if (r.side >= 0) tr.firstChild.style.color = w.ally(r.side, this.me) ? PAL.allySoft : PAL.enemySoft;
      t.appendChild(tr);
    }
    const best = key => rows.reduce((m, r) => (r[key] > (m ? m[key] : 0) ? r : m), null),
      aw = el.querySelector('.sh-end-aw'),
      list = [
        ['Most kills', best('kills'), 'kills'],
        ['Vehicle hunter', best('vkills'), 'vkills'],
        ['Point taker', best('caps'), 'caps']
      ];
    for (const [title, r, key] of list) {
      const d = document.createElement('div');
      d.textContent = r ? `${title}: ${r.name} (${r[key]})` : `${title}: -`;
      aw.appendChild(d);
    }
    const cv = el.querySelector('canvas'),
      x = cv.getContext('2d'),
      H = this.history.concat(this.tickets ? [[w.time, ...this.tickets]] : []);
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.fillRect(0, 0, cv.width, cv.height);
    if (H.length > 1) {
      const t0 = H[0][0],
        t1 = H[H.length - 1][0] || 1,
        top = Math.max(1, ...H.flatMap(r => r.slice(1)));
      for (const e of this.teamTickets()) {
        const s = e.side;
        x.strokeStyle = w.ally(s, this.me) || e.mine ? PAL.ally : PAL.enemy;
        x.lineWidth = 2.5;
        x.beginPath();
        H.forEach((r, i) => {
          const px = 10 + ((r[0] - t0) / Math.max(1e-3, t1 - t0)) * (cv.width - 20),
            py = cv.height - 10 - (r[s + 1] / top) * (cv.height - 20);
          if (i) x.lineTo(px, py);
          else x.moveTo(px, py);
        });
        x.stroke();
      }
    }
    el.querySelector('.sh-go').onclick = () => {
      el.remove();
      if (g.campaignOutcome) g.returnToGalaxy();
      else if (!g.menus?.open) g.toggleMenu?.();
    };
    document.body.appendChild(el);
    this.endEl = el;
    this.hud.style.display = 'none';
    this.panel.style.display = 'none';
    this.bigMap.style.display = 'none';
    this.introEl.style.display = 'none';
    if (this.ticketEl) this.ticketEl.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  setFov(cam, fov, near) {
    if (cam.fov !== fov || cam.near !== near) {
      cam.fov = fov;
      cam.near = near;
      cam.updateProjectionMatrix();
    }
  }

  dom() {
    const el = (tag, css, parent = document.body) => {
      const e = document.createElement(tag);
      if (css) e.style.cssText = css;
      parent.appendChild(e);
      return e;
    };
    eawSkin();
    if (!document.getElementById('shooter-css')) {
      const st = document.createElement('style');
      st.id = 'shooter-css';
      st.textContent = SHOOTER_CSS;
      document.head.appendChild(st);
    }
    this.hud = el('div', 'position:fixed;inset:0;pointer-events:none;z-index:40;display:none');
    this.cross = el(
      'div',
      'position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid rgba(255,215,106,.85);box-shadow:0 0 2px #000',
      this.hud
    );
    this.dot = el('div', 'position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;background:#ffd76a', this.hud);
    this.vhud = el('div', '', this.hud);
    this.vhud.className = 'sh-vhud eaw-frame-s';
    this.vhud.style.display = 'none';
    this.vhud.innerHTML =
      '<div class="sh-vh-n"></div><div class="sh-vh-row"><span>Hull</span><div class="sh-bar eaw-bar"><i class="h"></i></div></div><div class="sh-vh-row s"><span>Shield</span><div class="sh-bar eaw-bar"><i class="s"></i></div></div><div class="sh-vh-row"><span>Weapon</span><div class="sh-bar eaw-bar"><i class="w"></i></div></div><div class="sh-vh-info"></div><div class="sh-vh-warn"></div>';
    this.vhN = this.vhud.querySelector('.sh-vh-n');
    this.vhHull = this.vhud.querySelector('i.h');
    this.vhSh = this.vhud.querySelector('i.s');
    this.vhShRow = this.vhud.querySelector('.sh-vh-row.s');
    this.vhWp = this.vhud.querySelector('i.w');
    this.vhInfo = this.vhud.querySelector('.sh-vh-info');
    this.vhWarn = this.vhud.querySelector('.sh-vh-warn');
    this.scopeEl = el('div', '', document.body);
    this.scopeEl.className = 'sh-scope';
    this.wpnX = null;
    this.compass = el('canvas', '', this.hud);
    this.compass.className = 'sh-compass';
    this.compass.width = COMPASS.w;
    this.compass.height = COMPASS.h;
    this.feedEl = el('div', '', this.hud);
    this.feedEl.className = 'sh-feed';
    this.annEl = el('div', '', document.body);
    this.annEl.className = 'sh-ann';
    this.bigMap = el('div', '', document.body);
    this.bigMap.className = 'sh-bigmap';
    this.bigMap.style.display = 'none';
    this.bigMap.innerHTML = '<div class="sh-bigmap-box eaw-frame"><div class="sh-title">Battlefield</div><canvas width="760" height="760"></canvas><div class="sh-maphint">M to close</div></div>';
    this.bigCv = this.bigMap.querySelector('canvas');
    this.introEl = el('div', '', document.body);
    this.introEl.className = 'sh-intro';
    this.introEl.style.display = 'none';
    this.vig = el('div', '', this.hud);
    this.vig.className = 'sh-vig';
    this.wpn = el('div', '', this.hud);
    this.wpn.className = 'sh-wpn eaw-frame-s';
    this.wpn.innerHTML = '<div class="sh-wpn-n"></div><div class="sh-wpn-bar eaw-bar"><i></i></div><div class="sh-wpn-s"></div>';
    this.wpnN = this.wpn.querySelector('.sh-wpn-n');
    this.wpnBar = this.wpn.querySelector('i');
    this.wpnS = this.wpn.querySelector('.sh-wpn-s');
    this.wpnX = el('div', '', this.wpn);
    this.wpnX.className = 'sh-wpn-x';
    this.mark = el('div', '', this.hud);
    this.mark.className = 'sh-hit';
    this.mark.innerHTML =
      '<svg viewBox="0 0 40 40" width="40" height="40"><path d="M6 6L15 15M34 6L25 15M6 34L15 25M34 34L25 25" fill="none" stroke-width="3.2" stroke-linecap="round"/></svg>';
    this.markPath = this.mark.querySelector('path');
    this.markShown = 0;
    this.arcs = [0, 1, 2, 3].map(() =>
      el(
        'div',
        'position:absolute;left:50%;top:50%;width:180px;height:180px;margin:-90px 0 0 -90px;border-radius:50%;border:5px solid transparent;border-top-color:rgba(255,40,30,.85);display:none',
        this.hud
      )
    );
    this.bars = el('div', '', this.hud);
    this.bars.className = 'sh-me eaw-frame-s';
    this.name = el('div', '', this.bars);
    this.name.className = 'sh-me-n';
    const bar = color => {
      const o = el('div', '', this.bars);
      o.className = 'eaw-bar';
      return el('i', `width:100%;background:${color}`, o);
    };
    this.hpBar = bar('#5fd35f');
    this.shBar = bar('#5fb3ff');
    this.shBar.parentElement.style.display = 'none';
    this.score = el('div', '', this.bars);
    this.score.className = 'sh-me-s';
    this.hint = el('div', 'position:absolute;left:50%;top:62%;transform:translateX(-50%)', this.hud);
    this.hint.className = 'sh-hudtext';
    this.tip = el('div', 'position:absolute;left:50%;top:86px;transform:translateX(-50%);white-space:nowrap', this.hud);
    this.tip.className = 'sh-hudtext';
    this.credit = el('div', 'position:absolute;right:24px;bottom:24px', this.hud);
    this.credit.className = 'sh-credit';
    this.radar = el(
      'canvas',
      `position:absolute;right:20px;bottom:50px;width:${RADAR.size}px;height:${RADAR.size}px`,
      this.hud
    );
    this.radar.className = 'sh-radar';
    this.radar.width = this.radar.height = RADAR.size;
    this.tagCv = el('canvas', 'position:absolute;inset:0;width:100%;height:100%', this.hud);
    this.cap = el('div', '', this.hud);
    this.cap.className = 'sh-cap eaw-frame-s';
    this.cap.innerHTML = '<div class="sh-cap-t"></div><div class="sh-cap-bar eaw-bar"><i></i></div>';
    this.capT = this.cap.querySelector('.sh-cap-t');
    this.capBar = this.cap.querySelector('i');
    this.abil = el('div', 'position:absolute;left:22px;bottom:122px;line-height:18px', this.hud);
    this.abil.className = 'sh-hudtext';
    this.scoreEl = el('div', '');
    this.scoreEl.className = 'sh-board eaw-frame';
    this.panel = el('div', '');
    this.panel.className = 'sh-deploy';
    this.panel.style.display = 'none';
    this.panel.innerHTML = `
      <div class="sh-frame eaw-frame">
        <div class="sh-head"><div class="sh-title">Deploy</div><div class="sh-sub"></div></div>
        <div class="sh-body">
          <div class="sh-mapbox"><div class="sh-mapwrap eaw-frame-s"><canvas class="sh-map" width="460" height="460"></canvas></div><div class="sh-maphint">Click a reinforcement point you hold to spawn there</div></div>
          <div class="sh-side">
            <div class="sh-label">Soldier</div>
            <div class="sh-cards"></div>
            <div class="sh-detail eaw-frame-s">
              <div class="sh-portrait"></div>
              <div class="sh-dtext"><div class="sh-dname"></div><div class="sh-dkind"></div><div class="sh-stats"></div></div>
            </div>
            <div class="sh-foot"><div class="sh-status"></div><button class="sh-go eaw-btn">Deploy</button></div>
          </div>
        </div>
      </div>`;
    for (const ev of ['mousedown', 'mouseup', 'click', 'wheel', 'contextmenu']) this.panel.addEventListener(ev, e => e.stopPropagation());
    const q = s => this.panel.querySelector(s);
    this.title = q('.sh-title');
    this.sub = q('.sh-sub');
    this.list = q('.sh-cards');
    this.mapCv = q('.sh-map');
    this.portrait = q('.sh-portrait');
    this.dname = q('.sh-dname');
    this.dkind = q('.sh-dkind');
    this.statBars = q('.sh-stats');
    this.wait = q('.sh-status');
    this.go = q('.sh-go');
    this.go.onclick = () => this.deploy();
    this.mapCv.addEventListener('mousedown', e => this.mapClick(e));
    this.mapCv.addEventListener('mousemove', e => {
      this.mapHover = this.mapPoint(e);
      this.mapCv.style.cursor = this.mapHover ? 'pointer' : 'default';
    });
  }

  note(text) {
    this.tip.textContent = text;
  }

  groundImage() {
    const ui = this.game.ui;
    if (!ui) return null;
    if (!ui.ground && ui.radarGround) ui.ground = ui.radarGround();
    return ui.ground || null;
  }

  mapFrame(cv = this.mapCv) {
    const g = this.game,
      lo = g.map.playMin || [0, 0],
      side = (g.terrain.size - 1) * 20,
      hi = g.map.playMax || [side, side],
      W = cv.width,
      span = Math.max(hi[0] - lo[0], hi[1] - lo[1]),
      k = W / span,
      ox = (W - (hi[0] - lo[0]) * k) / 2,
      oy = (W - (hi[1] - lo[1]) * k) / 2;
    return { lo, hi, k, ox, oy, W, side, X: x => ox + (x - lo[0]) * k, Y: y => W - oy - (y - lo[1]) * k };
  }

  mapPoint(e) {
    const r = this.mapCv.getBoundingClientRect(),
      F = this.mapFrame(),
      sx = ((e.clientX - r.left) / r.width) * F.W,
      sy = ((e.clientY - r.top) / r.height) * F.W;
    let best = null,
      bd = 26;
    for (const p of this.spawnSpots()) {
      const d = Math.hypot(F.X(p.x) - sx, F.Y(p.y) - sy);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  mapClick(e) {
    const p = this.mapPoint(e);
    if (!p) return;
    this.from = p;
    this.game.view.x = p.x;
    this.game.view.y = p.y;
    this.refreshDeploy(true);
  }

  drawMap(cv = this.mapCv) {
    const big = cv !== this.mapCv,
      x = cv.getContext('2d'),
      F = this.mapFrame(this.mapCv),
      w = this.world,
      ground = this.groundImage(),
      t = performance.now() / 1000,
      S = cv.width / F.W;
    x.setTransform(S, 0, 0, S, 0, 0);
    x.fillStyle = '#05080b';
    x.fillRect(0, 0, F.W, F.W);
    if (ground) {
      const C = 20;
      x.imageSmoothingEnabled = true;
      x.drawImage(ground, F.lo[0] / C, (F.side - F.hi[1]) / C, (F.hi[0] - F.lo[0]) / C, (F.hi[1] - F.lo[1]) / C, F.ox, F.oy, (F.hi[0] - F.lo[0]) * F.k, (F.hi[1] - F.lo[1]) * F.k);
      x.fillStyle = 'rgba(0,0,0,0.3)';
      x.fillRect(0, 0, F.W, F.W);
    }
    x.strokeStyle = 'rgba(255,215,106,0.08)';
    x.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const v = (F.W / 8) * i;
      x.beginPath();
      x.moveTo(v, 0);
      x.lineTo(v, F.W);
      x.moveTo(0, v);
      x.lineTo(F.W, v);
      x.stroke();
    }
    for (const u of w.units) {
      if (u.dead || u.inside || u.side < 0 || u.side === w.wild) continue;
      const ally = w.ally(u.side, this.me);
      x.fillStyle = ally ? `rgba(${PAL.allyRGB},0.9)` : `rgba(${PAL.enemyRGB},0.9)`;
      const px = F.X(u.x),
        py = F.Y(u.y);
      if (u.structure) x.fillRect(px - 3, py - 3, 6, 6);
      else x.fillRect(px - 1.5, py - 1.5, u.kind === 'INFANTRY' ? 3 : 4.5, u.kind === 'INFANTRY' ? 3 : 4.5);
    }
    const mine = this.spawnSpots();
    for (const p of [...w.points, ...mine.filter(m => m.home || m.squad)]) {
      const px = F.X(p.x),
        py = F.Y(p.y),
        spawn = mine.includes(p),
        sel = p === this.from,
        hov = p === this.mapHover;
      if (spawn) {
        const r = sel ? 13 : hov ? 12 : 10;
        if (sel) {
          x.strokeStyle = `rgba(255,215,106,${0.5 + 0.5 * Math.sin(t * 5)})`;
          x.lineWidth = 2;
          x.beginPath();
          x.arc(px, py, r + 6 + 3 * Math.sin(t * 5), 0, Math.PI * 2);
          x.stroke();
        }
        x.fillStyle = sel ? '#ffd76a' : p.squad ? `rgba(${PAL.allyRGB},0.95)` : 'rgba(80,200,120,0.95)';
        x.strokeStyle = '#05080b';
        x.lineWidth = 2;
        x.beginPath();
        x.arc(px, py, r, 0, Math.PI * 2);
        x.fill();
        x.stroke();
        x.fillStyle = '#05080b';
        x.font = 'bold 12px "EmpireAtWar-Bold","Segoe UI",sans-serif';
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(p.home ? 'H' : p.squad ? 'S' + p.n : this.letterOf(p) || String(mine.indexOf(p) + 1), px, py + 0.5);
      } else {
        x.fillStyle = p.side < 0 ? 'rgba(190,190,190,0.85)' : w.ally(p.side, this.me) ? `rgba(${PAL.allyRGB},0.85)` : `rgba(${PAL.enemyRGB},0.9)`;
        x.beginPath();
        x.moveTo(px, py - 7);
        x.lineTo(px + 7, py);
        x.lineTo(px, py + 7);
        x.lineTo(px - 7, py);
        x.closePath();
        x.fill();
        if (p.reinforce) {
          x.fillStyle = '#05080b';
          x.font = 'bold 9px "EmpireAtWar-Bold","Segoe UI",sans-serif';
          x.textAlign = 'center';
          x.textBaseline = 'middle';
          x.fillText(this.letterOf(p), px, py + 0.5);
        }
      }
    }
    if (big && this.body) {
      const b = this.body,
        px = F.X(b.x),
        py = F.Y(b.y),
        a = -this.yaw;
      x.save();
      x.translate(px, py);
      x.rotate(a);
      x.fillStyle = '#ffd76a';
      x.strokeStyle = '#05080b';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(10, 0);
      x.lineTo(-6, 6);
      x.lineTo(-3, 0);
      x.lineTo(-6, -6);
      x.closePath();
      x.fill();
      x.stroke();
      x.restore();
    }
    const at = this.lastCam ? this.lastCam.p : null;
    if (at && this.state === 'dead') {
      x.strokeStyle = '#ff4a32';
      x.lineWidth = 2.5;
      const px = F.X(at.x),
        py = F.Y(at.y);
      x.beginPath();
      x.moveTo(px - 6, py - 6);
      x.lineTo(px + 6, py + 6);
      x.moveTo(px + 6, py - 6);
      x.lineTo(px - 6, py + 6);
      x.stroke();
    }
    const players = this.game.shooterNet?.playerUnits();
    if (players)
      for (const [u, p] of players) {
        if (u.dead) continue;
        const px = F.X(u.x),
          py = F.Y(u.y),
          ally = w.ally(u.side, this.me);
        this.playerMark(x, px, py, ally, 7);
        x.font = '700 12px "EmpireAtWar-Bold","Segoe UI",sans-serif';
        x.textAlign = 'left';
        x.textBaseline = 'middle';
        const tw = x.measureText(p.n).width;
        x.fillStyle = 'rgba(8,10,14,0.8)';
        x.fillRect(px + 9, py - 9, tw + 10, 18);
        x.fillStyle = ally ? PAL.ally : PAL.enemy;
        x.fillRect(px + 9, py - 9, 3, 18);
        x.fillStyle = '#fff';
        x.fillText(p.n, px + 15, py);
      }
  }

  statsOf(c) {
    const w = this.world,
      t = c.unit,
      u = (c.hero && c.hero.members[0]) || w.units.find(x => !x.dead && x.type === t);
    const wp = u && u.weapon;
    return {
      health: u ? u.maxHealth : t.num('Tactical_Health', 0),
      fire: wp ? (wp.damage * Math.max(1, wp.pulses || 1)) / Math.max(0.1, wp.recharge || 1) : 0,
      range: u ? u.range : t.num('Targeting_Max_Attack_Distance', 0),
      speed: t.num('Max_Speed', 0)
    };
  }

  openDeploy() {
    this.panel.style.display = 'flex';
    this.listKey = '';
    this.refreshDeploy(true);
  }

  refreshDeploy(force = false) {
    if (this.panel.style.display === 'none') return;
    const now = performance.now();
    if (now >= (this.mapAt || 0)) {
      this.mapAt = now + 50;
      this.drawMap();
    }
    if (!force && now < (this.panelAt || 0)) return;
    this.panelAt = now + 400;
    const w = this.world,
      g = this.game,
      cls = this.cards(),
      pts = this.spawnSpots(),
      heroOk = this.matchScore >= this.heroAt;
    if (!this.pick || !cls.some(c => c.unit === this.pick.unit && c.vehicle === this.pick.vehicle)) this.pick = cls[0] || null;
    else this.pick = cls.find(c => c.unit === this.pick.unit && c.vehicle === this.pick.vehicle);
    if (!this.from || !pts.includes(this.from)) this.from = pts[0] || null;
    const key = cls.map(c => c.unit.name + c.cost + (c.vehicle ? 'v' : '')).join() + '|' + this.pick?.unit.name + '|' + heroOk;
    if (key !== this.listKey) {
      this.listKey = key;
      this.title.textContent = this.state === 'dead' ? (this.killerName ? `Killed by ${this.killerName}` : 'You were killed') : 'Deploy';
      this.list.textContent = '';
      for (const c of cls) {
        const b = document.createElement('button');
        const heroic = c.hero || c.heroSpawn;
        b.className = 'sh-card eaw-frame-s' + (c === this.pick ? ' on' : '') + (heroic ? ' hero' : '') + (c.vehicle ? ' ride' : '') + (heroic && !heroOk ? ' locked' : '');
        const icon = this.iconOf(c.unit);
        b.innerHTML = `<div class="sh-icon"${icon ? ` style="background-image:url('${icon}')"` : ''}></div><div class="sh-cname"></div><div class="sh-cost"></div>`;
        b.querySelector('.sh-cname').textContent = this.cardName(c);
        b.querySelector('.sh-cost').textContent = heroic ? (heroOk ? 'Hero' : `${this.heroAt} points`) : c.vehicle ? 'Vehicle' : this.tickets ? 'Free' : `${c.cost} credits`;
        b.onclick = () => {
          this.pick = c;
          this.refreshDeploy(true);
        };
        this.list.appendChild(b);
      }
      const c = this.pick;
      if (c) {
        const icon = this.iconOf(c.unit);
        this.portrait.style.backgroundImage = icon ? `url('${icon}')` : 'none';
        this.dname.textContent = this.cardName(c);
        this.dkind.textContent = c.hero
          ? 'Hero - takes over the hero where it stands, health drains over time and kills restore it'
          : c.heroSpawn
            ? 'Hero - health drains over time and kills restore it'
            : c.vehicle
              ? 'Vehicle - spawn in the driver seat'
              : ROLE_TEXT[this.roleOf(c, cls)] || 'Infantry';
        const all = cls.map(x => this.statsOf(x)),
          mine = this.statsOf(c),
          rows = [
            ['Health', 'health'],
            ['Firepower', 'fire'],
            ['Range', 'range'],
            ['Speed', 'speed']
          ];
        this.statBars.textContent = '';
        for (const [label, key2] of rows) {
          const max = Math.max(1e-6, ...all.map(s => s[key2])),
            row = document.createElement('div');
          row.className = 'sh-stat';
          row.innerHTML = '<span></span><div class="sh-bar eaw-bar"><i></i></div>';
          row.querySelector('span').textContent = label;
          row.querySelector('i').style.width = `${Math.round((mine[key2] / max) * 100)}%`;
          this.statBars.appendChild(row);
        }
      }
    }
    const left = Math.ceil(this.readyAt - w.time),
      money = Math.floor(w.credits[this.me]);
    const out = this.tickets && this.tickets[this.me] <= 0;
    this.sub.textContent = `${g.factions[this.me]}${this.tickets ? `  -  ${this.tickets[this.me]} tickets` : `  -  ${money} credits`}`;
    const pc = this.pick,
      locked = !!pc && (pc.hero || pc.heroSpawn) && !heroOk,
      free = !!pc && (pc.hero || pc.vehicle);
    if (now >= this.tipAt) {
      this.tipAt = now + 7000;
      this.tipN = (this.tipN + 1) % TIPS.length;
      if (this.tipEl) this.tipEl.textContent = `Tip: ${TIPS[this.tipN]}`;
    }
    if (!this.tipEl && this.go && this.go.parentElement) {
      const foot = this.go.parentElement;
      this.tipEl = document.createElement('div');
      this.tipEl.className = 'sh-tip';
      this.tipEl.textContent = `Tip: ${TIPS[this.tipN]}`;
      foot.parentElement.insertBefore(this.tipEl, foot);
      const b = document.createElement('button');
      b.className = 'sh-setbtn eaw-btn';
      b.textContent = 'Settings';
      b.onclick = () => this.openSettings();
      foot.insertBefore(b, this.go);
      if (this.ov?.on) {
        const t = document.createElement('button');
        t.className = 'sh-setbtn eaw-btn';
        t.textContent = 'Tactical View';
        t.title = `${this.ov.key()}: command your squads from the tactical view`;
        t.onclick = () => this.ov.keyPress();
        foot.insertBefore(t, b);
      }
    }
    this.wait.textContent = out
      ? 'No tickets left'
      : locked
        ? `Hero unlocks at ${this.heroAt} points - you have ${this.matchScore}`
      : left > 0
        ? `Ready in ${left} s`
        : this.pick && !this.tickets && !this.pick.hero && money < this.pick.cost
          ? 'Not enough credits'
          : !this.from && !free
            ? 'Hold a reinforcement point to spawn'
            : this.from?.squad && !free
              ? `Spawn with squad ${this.from.n} - press Enter or Deploy`
              : 'Press Enter or Deploy';
    this.go.disabled = out || locked || left > 0 || !this.pick || (!this.from && !free) || (!this.tickets && !this.pick?.hero && money < (this.pick?.cost || 0));
  }

  iconOf(t) {
    const n = t.str('Icon_Name');
    return n ? iconUrl(n) : '';
  }

  drawHud() {
    const b = this.body,
      now = performance.now(),
      ride = this.rideQ,
      u = ride ? ride.members[0] : b;
    if (!u) return;
    this.name.textContent = this.nameOf(u.type);
    this.hpBar.style.width = `${Math.max(0, Math.min(1, u.health / (u.maxHealth || 1))) * 100}%`;
    const sh = u.maxShield > 0;
    this.shBar.parentElement.style.display = sh ? 'block' : 'none';
    if (sh) this.shBar.style.width = `${Math.max(0, Math.min(1, u.shield / u.maxShield)) * 100}%`;
    this.score.textContent = `Kills ${this.kills}   Deaths ${this.deaths}   Score ${this.matchScore}`;
    this.credit.textContent = this.tickets ? `Tickets ${this.tickets[this.me]}` : `Credits ${Math.floor(this.world.credits[this.me])}`;
    {
      const hit = Math.max(this.hitUntil, this.killUntil, this.headUntil);
      if (hit !== this.markShown && now < hit) {
        this.markShown = hit;
        this.mark.classList.remove('pop');
        void this.mark.offsetWidth;
        this.mark.classList.add('pop');
      }
      const on = now < hit;
      this.mark.style.opacity = on ? '1' : '0';
      this.markPath.style.stroke = now < this.killUntil ? '#ff4a32' : now < this.headUntil ? '#ffd23a' : '#ffffff';
      this.mark.classList.toggle('kill', now < this.killUntil);
    }
    const cam = this.game.camera,
      focal = innerHeight / 2 / Math.tan((cam.fov * Math.PI) / 360),
      size = ride ? 22 : Math.max(10, Math.min(120, 2 * Math.tan(this.spread) * focal + 8));
    this.cross.style.width = this.cross.style.height = `${size}px`;
    this.cross.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
    const marks = this.hurtMarks;
    for (let i = 0; i < this.arcs.length; i++) {
      const m = marks[i],
        a = this.arcs[i],
        age = m ? (now - m.at) / 1000 : 9;
      if (age > 1.2 || !m.from || m.from.x === undefined) {
        a.style.display = 'none';
        continue;
      }
      const rel = Math.atan2(m.from.y - u.y, m.from.x - u.x) - this.yaw;
      a.style.display = 'block';
      a.style.opacity = String(Math.max(0, 1 - age / 1.2));
      a.style.transform = `rotate(${-rel}rad)`;
    }
    this.drawAbilities();
    this.drawWeapon(now, u);
    this.drawVehicleHud(now);
    this.drawCompass(u);
    this.drawFeed(now);
    if (this.bigMap.style.display !== 'none' && now >= (this.bigAt || 0)) {
      this.bigAt = now + 100;
      this.drawMap(this.bigCv);
    }
    this.drawCapture(u);
    if (now >= this.radarAt) {
      this.radarAt = now;
      this.drawRadar(u);
      if (this.scoreEl.style.display === 'block') this.drawBoard();
    }
    const locked = document.pointerLockElement === this.canvas();
    let hint = this.healing ? 'Healing' : '';
    if (locked && !ride && b) {
      for (const q of this.crewed) {
        const v = q.members[0];
        if (v && !q.crew.in && q.side === this.me && Math.hypot(v.x - b.x, v.y - b.y) - v.hitRadius < 45) {
          hint = `${this.keyText('SHOOTER_ENTER')}: get in ${this.nameOf(v.type)}`;
          break;
        }
        if (v && q.crew.in && !q.crew.gunner && q.side === this.me && v.guns && v.guns.length && Math.hypot(v.x - b.x, v.y - b.y) - v.hitRadius < 45) {
          hint = `${this.keyText('SHOOTER_ENTER')}: man the guns of ${this.nameOf(v.type)}`;
          break;
        }
      }
      if (!hint)
        for (const h of this.world.units)
          if (!h.dead && h.slots && h.side === this.me && this.near(h, 60) && canGarrison(this.world, b.squad, h)) {
            hint = `${this.keyText('SHOOTER_ENTER')}: go into ${this.nameOf(h.type)}`;
            break;
          }
    }
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
  }

  drawTags(cam) {
    const players = this.game.shooterNet ? this.game.shooterNet.playerUnits() : null;
    const cv = this.tagCv,
      w = this.world,
      dpr = Math.min(2, window.devicePixelRatio || 1),
      W = Math.round(innerWidth * dpr),
      H = Math.round(innerHeight * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const x = cv.getContext('2d');
    x.clearRect(0, 0, W, H);
    const b = this.body,
      seat = this.seatOf(),
      at = cam.position,
      R = ALLY_TAGS.range;
    cam.updateMatrixWorld();
    this.drawAimAids(x, cam, dpr);
    for (const p of w.points) {
      if (!p.reinforce) continue;
      const d = Math.hypot(p.x - at.x, p.y - at.y),
        fade = Math.min(1, Math.max(0, (d - MARKERS.fade * 0.5) / MARKERS.fade));
      if (fade <= 0.02) continue;
      _ndc.set(p.x, p.y, (p.z || heightAt(w.terrain, p.x, p.y)) + 70).project(cam);
      if (_ndc.z > 1 || _ndc.z < -1 || Math.abs(_ndc.x) > 1 || Math.abs(_ndc.y) > 1) continue;
      const px = (_ndc.x * 0.5 + 0.5) * W,
        py = (-_ndc.y * 0.5 + 0.5) * H,
        r = 12 * dpr,
        own = p.side >= 0 && w.ally(p.side, this.me),
        col = p.side < 0 ? '190,190,190' : own ? PAL.allyRGB : PAL.enemyRGB,
        busy = p.taker !== -1,
        pulse = busy ? 0.55 + 0.45 * Math.sin(performance.now() / 160) : 1;
      x.globalAlpha = fade * 0.95;
      x.fillStyle = `rgba(8,10,14,0.75)`;
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
      x.fill();
      x.lineWidth = 2.5 * dpr;
      x.strokeStyle = `rgba(${col},${pulse})`;
      x.stroke();
      if (busy) {
        x.strokeStyle = p.taker >= 0 && w.ally(p.taker, this.me) ? `rgba(${PAL.allyRGB},1)` : `rgba(${PAL.enemyRGB},1)`;
        x.beginPath();
        x.arc(px, py, r + 3 * dpr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p.progress));
        x.stroke();
      }
      x.fillStyle = `rgb(${col})`;
      x.font = `bold ${13 * dpr}px Arial,sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(this.letterOf(p), px, py + dpr);
      x.font = `${10 * dpr}px Arial,sans-serif`;
      x.fillStyle = 'rgba(232,220,184,0.85)';
      x.fillText(`${Math.round(d / 8)} m`, px, py + r + 9 * dpr);
    }
    x.globalAlpha = 1;
    for (const T of this.teams) {
      const L = T.lead;
      if (!L || L.dead || L.inside || !this.world.ally(T.side, this.me) || !T.role) continue;
      const d = Math.hypot(L.x - at.x, L.y - at.y);
      if (d > SQUAD_ICON.reach || d < 30) continue;
      _ndc.set(L.x, L.y, L.z + this.heightOf(L) * SQUAD_ICON.up + 4).project(cam);
      if (_ndc.z > 1 || Math.abs(_ndc.x) > 1 || Math.abs(_ndc.y) > 1) continue;
      x.globalAlpha = Math.min(1, Math.max(0.35, 1.2 - d / SQUAD_ICON.reach));
      this.squadBadge(x, (_ndc.x * 0.5 + 0.5) * W, (-_ndc.y * 0.5 + 0.5) * H, T, SQUAD_ICON.size * dpr, dpr);
    }
    x.globalAlpha = 1;
    x.fillStyle = `rgba(${PAL.friendRGB},0.95)`;
    x.strokeStyle = 'rgba(0,0,0,0.75)';
    x.lineWidth = 1.5 * dpr;
    for (const u of w.units) {
      if (u.dead || u.inside || u.holder?.visible === false || u.structure || u === b || u === seat || u.side < 0 || !w.ally(u.side, this.me) || !(u.speed > 0)) continue;
      const dx = u.x - at.x,
        dy = u.y - at.y;
      if (dx * dx + dy * dy > R * R) continue;
      const top = u.kind === 'INFANTRY' ? this.heightOf(u) * 1.15 : Math.max(u.aimZ || 0, u.hitRadius || 8) * 1.3;
      _ndc.set(u.x, u.y, u.z + top).project(cam);
      if (_ndc.z > 1 || _ndc.z < -1 || Math.abs(_ndc.x) > 1.05 || Math.abs(_ndc.y) > 1.05) continue;
      const d = Math.sqrt(dx * dx + dy * dy),
        r = Math.max(ALLY_TAGS.min, ALLY_TAGS.size * (1 - (d / R) * 0.5)) * dpr,
        px = (_ndc.x * 0.5 + 0.5) * W,
        py = (-_ndc.y * 0.5 + 0.5) * H;
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
      x.fill();
      x.stroke();
      if (d < MARKERS.names && !players?.has(u)) {
        x.font = `${10 * dpr}px Arial,sans-serif`;
        x.textAlign = 'center';
        x.textBaseline = 'bottom';
        x.fillStyle = 'rgba(150,240,170,0.9)';
        x.fillText(this.nameFor(u), px, py - r - 2 * dpr);
        x.fillStyle = `rgba(${PAL.friendRGB},0.95)`;
      }
    }
    if (players && players.size) this.drawPlayerTags(x, cam, at, players, W, H, dpr);
  }

  drawPlayerTags(x, cam, at, players, W, H, dpr) {
    const w = this.world,
      b = this.body;
    for (const [u, p] of players) {
      if (u.dead || (u.holder?.visible === false && !p.seat)) continue;
      const ally = w.ally(u.side, this.me),
        dx = u.x - at.x,
        dy = u.y - at.y,
        d = Math.hypot(dx, dy);
      if (ally ? d > PLAYER_TAG.reach : d > PLAYER_TAG.foeReach || !b || b.dead || !this.sees(b, u)) continue;
      const top = u.kind === 'INFANTRY' ? this.heightOf(u) * 1.15 : Math.max(u.aimZ || 0, u.hitRadius || 8) * 1.4;
      _ndc.set(u.x, u.y, u.z + top).project(cam);
      if (_ndc.z > 1 || _ndc.z < -1) continue;
      let px = (_ndc.x * 0.5 + 0.5) * W,
        py = (-_ndc.y * 0.5 + 0.5) * H;
      const off = Math.abs(_ndc.x) > 1 || Math.abs(_ndc.y) > 1;
      if (off && !ally) continue;
      const pad = PLAYER_TAG.edge * dpr;
      px = Math.max(pad, Math.min(W - pad, px));
      py = Math.max(pad, Math.min(H - pad, py));
      const col = ally ? PAL.allyRGB : PAL.enemyRGB,
        k = Math.max(0.75, 1 - (d / PLAYER_TAG.reach) * 0.4),
        fs = Math.round(PLAYER_TAG.font * k * dpr),
        label = p.n + (ally && d > PLAYER_TAG.showDist ? `  ${Math.round(d / 8)} m` : '');
      x.font = `700 ${fs}px Arial,sans-serif`;
      const tw = x.measureText(label).width,
        bw = tw + 14 * dpr,
        bh = fs + 8 * dpr,
        cy = py - 12 * dpr - bh / 2;
      x.globalAlpha = off ? 0.75 : 1;
      x.fillStyle = 'rgba(8,10,14,0.78)';
      x.strokeStyle = `rgba(${col},0.95)`;
      x.lineWidth = 1.5 * dpr;
      x.beginPath();
      x.rect(px - bw / 2, cy - bh / 2, bw, bh);
      x.fill();
      x.stroke();
      x.fillStyle = `rgba(${col},0.95)`;
      x.fillRect(px - bw / 2, cy - bh / 2, 3 * dpr, bh);
      x.fillStyle = '#fff';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(label, px + 1.5 * dpr, cy + dpr);
      x.fillStyle = `rgba(${col},0.95)`;
      x.beginPath();
      x.moveTo(px - 8 * dpr, py - 11 * dpr);
      x.lineTo(px + 8 * dpr, py - 11 * dpr);
      x.lineTo(px, py - 2 * dpr);
      x.closePath();
      x.fill();
      x.globalAlpha = 1;
    }
  }

  playerMark(x, px, py, ally, r) {
    x.fillStyle = ally ? PAL.ally : PAL.enemy;
    x.strokeStyle = '#fff';
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(px, py - r * 1.3);
    x.lineTo(px + r, py + r * 0.9);
    x.lineTo(px - r, py + r * 0.9);
    x.closePath();
    x.fill();
    x.stroke();
  }

  drawWeapon(now, u) {
    const g = this.gun,
      b = this.body,
      seat = this.rideQ || this.gunQ;
    this.wpn.style.display = seat ? 'none' : 'block';
    if (!seat) {
      if (this.wpnN.textContent !== g.name) this.wpnN.textContent = g.name || '';
      if (g.kind === 'heat') {
        this.wpnBar.style.width = `${Math.round(g.heat * 100)}%`;
        this.wpnBar.style.background = g.hot ? '#ff4a32' : g.heat > 0.7 ? '#ffa040' : '';
        const t = g.hot ? 'OVERHEATED' : 'HEAT';
        if (this.wpnS.textContent !== t) this.wpnS.textContent = t;
        this.wpn.classList.toggle('hot', g.hot);
      } else {
        this.wpnBar.style.width = `${Math.round((g.ammo / Math.max(1, g.max)) * 100)}%`;
        this.wpnBar.style.background = g.ammo ? '' : '#ff4a32';
        const t = `${g.ammo} / ${g.max}${g.ammo < g.max && this.healing ? '  restocking' : ''}`;
        if (this.wpnS.textContent !== t) this.wpnS.textContent = t;
        this.wpn.classList.toggle('hot', !g.ammo);
      }
      const extra =
        this.role === 'trooper' && this.nadeW
          ? `Thermal detonators ${this.nades} / ${GRENADE.count}  (${this.keyText('SHOOTER_GRENADE')})`
          : this.role === 'rocket'
            ? this.lockK >= 1
              ? 'Target locked'
              : 'Aim at a vehicle to lock on'
            : this.role === 'scout'
              ? 'Right mouse for the scope'
              : this.role === 'hero'
                ? 'Hero - kills restore health'
                : '';
      if (this.wpnX && this.wpnX.textContent !== extra) this.wpnX.textContent = extra;
    }
    const real = Math.min(0.1, (now - (this.hudAt || now)) / 1000);
    this.hudAt = now;
    this.pain = Math.max(0, this.pain - real * 0.9);
    const low = b && b.maxHealth > 0 ? 1 - b.health / b.maxHealth : 0,
      v = Math.min(1, this.pain + Math.max(0, low - 0.6) * 1.2);
    this.vig.style.opacity = v.toFixed(3);
    if (b && b.health < b.maxHealth * 0.3 && now >= this.beatAt) {
      this.beatAt = now + 900;
      this.sfx('beat');
    }
  }

  drawCompass(at) {
    const c = this.compass,
      x = c.getContext('2d'),
      W = COMPASS.w,
      H = COMPASS.h,
      span = COMPASS.span,
      w = this.world,
      toX = a => W / 2 - (wrap(a - this.yaw) / span) * W;
    x.clearRect(0, 0, W, H);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 15) {
      const a = (deg * Math.PI) / 180,
        px = toX(a);
      if (px < 0 || px > W) continue;
      const card = { 90: 'N', 0: 'E', 270: 'S', 180: 'W' }[deg];
      if (card) {
        x.fillStyle = '#ffd76a';
        x.font = 'bold 13px "EmpireAtWar-Bold","Segoe UI",sans-serif';
        x.fillText(card, px, H / 2 + 1);
      } else {
        x.fillStyle = 'rgba(232,220,184,0.55)';
        x.fillRect(px - 0.5, deg % 45 ? H - 8 : H - 12, 1, deg % 45 ? 6 : 10);
      }
    }
    for (const p of w.points) {
      if (!p.reinforce) continue;
      const px = toX(Math.atan2(p.y - at.y, p.x - at.x));
      if (px < 8 || px > W - 8) continue;
      x.fillStyle = p.side < 0 ? '#bbb' : w.ally(p.side, this.me) ? PAL.ally : PAL.enemy;
      x.font = 'bold 11px "EmpireAtWar-Bold","Segoe UI",sans-serif';
      x.fillText(this.letterOf(p), px, 7);
    }
    const now = performance.now();
    for (const m of this.hurtMarks) {
      if (now - m.at > 2500 || !m.from || m.from.x === undefined) continue;
      const px = toX(Math.atan2(m.from.y - at.y, m.from.x - at.x));
      if (px < 4 || px > W - 4) continue;
      x.fillStyle = 'rgba(255,60,40,0.9)';
      x.beginPath();
      x.moveTo(px, H - 2);
      x.lineTo(px - 5, H - 10);
      x.lineTo(px + 5, H - 10);
      x.fill();
    }
    x.fillStyle = '#ffd76a';
    x.fillRect(W / 2 - 1, 0, 2, 5);
  }

  drawFeed(now) {
    const live = this.feed.filter(f => now - f.at < MARKERS.feedLife * 1000);
    if (live.length !== this.feed.length) {
      this.feed = live;
      this.feedDirty = true;
    }
    if (this.feedDirty) {
      this.feedDirty = false;
      const w = this.world,
        tint = s => (s < 0 ? '#bbb' : w.ally(s, this.me) ? PAL.allySoft : PAL.enemySoft);
      this.feedEl.textContent = '';
      for (const f of this.feed) {
        const row = document.createElement('div');
        row.className = 'sh-feed-row' + (f.mine ? ' mine' : '');
        const a = document.createElement('span'),
          k = document.createElement('i'),
          v = document.createElement('span');
        a.textContent = f.a || 'Unknown';
        a.style.color = tint(f.as);
        k.textContent = '\u2715';
        v.textContent = f.v;
        v.style.color = tint(f.vs);
        row.append(a, k, v);
        this.feedEl.appendChild(row);
      }
    }
    const ann = this.announces.filter(a => now - a.at < 4000);
    if (ann.length !== this.announces.length || this.annDirty) {
      this.announces = ann;
      this.annDirty = false;
      this.annEl.textContent = '';
      for (const a of ann) {
        const d = document.createElement('div');
        d.className = 'sh-ann-row ' + a.tone;
        d.textContent = a.text;
        this.annEl.appendChild(d);
      }
    }
  }

  drawCapture(at) {
    const w = this.world,
      g = this.game;
    let pt = null,
      bd = Infinity;
    for (const p of w.points) {
      if (p.locked) continue;
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (d <= (p.radius || 100) * 1.15 && d < bd) {
        bd = d;
        pt = p;
      }
    }
    if (!pt) {
      if (this.cap.style.display !== 'none') this.cap.style.display = 'none';
      return;
    }
    this.cap.style.display = 'block';
    const name = s => (s >= 0 ? String(g.factions[s] || 'Side ' + s) : 'Neutral'),
      kind = pt.reinforce ? 'Reinforcement point' : 'Capture point',
      mine = pt.side >= 0 && w.ally(pt.side, this.me);
    let text, fill, color;
    if (pt.taker === -1) {
      text = `${kind} - ${pt.side >= 0 ? 'held by ' + name(pt.side) : 'neutral'}`;
      fill = pt.side >= 0 ? 1 : 0;
      color = pt.side < 0 ? '#9a9a9a' : mine ? PAL.friend : PAL.enemy;
    } else if (pt.taker >= 0) {
      const us = w.ally(pt.taker, this.me);
      text = `${kind} - ${us ? 'capturing' : name(pt.taker) + ' capturing'}`;
      fill = Math.min(1, pt.progress);
      color = us ? PAL.friend : PAL.enemy;
    } else {
      text = `${kind} - contested`;
      fill = Math.min(1, pt.progress);
      color = '#ffd76a';
    }
    if (this.capT.textContent !== text) this.capT.textContent = text;
    this.capBar.style.width = `${Math.round(fill * 100)}%`;
    this.capBar.style.background = color;
  }

  drawAbilities() {
    const sq = this.rideQ || (this.body && this.body.squad);
    const list = sq ? sq.abilities.filter(a => !/^(SELL|UNLOAD|SPREAD_OUT)$/.test(a.def.kind)).slice(0, 3) : [];
    const text = list
      .map((st, i) => {
        const name = st.def.kind.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
        const left = st.cooldown > 0 ? ` (${Math.ceil(st.cooldown)} s)` : st.active ? ' (on)' : '';
        return `${this.keyText('SHOOTER_ABILITY_' + (i + 1))}  ${name}${left}`;
      })
      .join('\n');
    if (this.abilText !== text) {
      this.abilText = text;
      this.abil.textContent = '';
      for (const line of text ? text.split('\n') : []) {
        const d = document.createElement('div');
        d.textContent = line;
        this.abil.appendChild(d);
      }
    }
  }

  drawRadar(at) {
    const c = this.radar,
      x = c.getContext('2d'),
      S = RADAR.size,
      R = RADAR.range,
      k = S / 2 / R,
      w = this.world,
      rot = -this.yaw + Math.PI / 2,
      cr = Math.cos(rot),
      sr = Math.sin(rot);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, S, S);
    x.save();
    x.beginPath();
    x.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    x.clip();
    const ground = this.groundImage();
    if (ground) {
      const C = 20,
        side = (this.game.terrain.size - 1) * C;
      x.setTransform(k * cr * C, -k * sr * C, k * sr * C, k * cr * C, S / 2 + k * (-cr * at.x - sr * (side - at.y)), S / 2 - k * (-sr * at.x + cr * (side - at.y)));
      x.globalAlpha = 0.85;
      x.imageSmoothingEnabled = true;
      x.drawImage(ground, 0, 0);
      x.globalAlpha = 1;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = 'rgba(0,0,0,0.25)';
      x.fillRect(0, 0, S, S);
    }
    const put = (px, py) => {
      const dx = px - at.x,
        dy = py - at.y;
      return [S / 2 + (dx * cr - dy * sr) * k, S / 2 - (dx * sr + dy * cr) * k];
    };
    for (const p of w.points) {
      if (Math.hypot(p.x - at.x, p.y - at.y) > R * 1.1) continue;
      const [px, py] = put(p.x, p.y);
      x.fillStyle = p.side < 0 ? '#bbb' : w.ally(p.side, this.me) ? PAL.friend : PAL.enemy;
      x.beginPath();
      x.moveTo(px, py - 6);
      x.lineTo(px + 6, py);
      x.lineTo(px, py + 6);
      x.lineTo(px - 6, py);
      x.closePath();
      x.fill();
    }
    for (const u of w.units) {
      if (u.dead || u.inside || u === this.body || u.side < 0) continue;
      const dx = u.x - at.x,
        dy = u.y - at.y;
      if (dx * dx + dy * dy > R * R) continue;
      const [px, py] = put(u.x, u.y),
        ally = w.ally(u.side, this.me);
      x.fillStyle = u.side === w.wild ? '#c8b070' : ally ? PAL.ally : PAL.enemy;
      const r = u.structure ? 3.5 : u.kind === 'INFANTRY' ? 1.6 : 2.6;
      if (u.structure) x.fillRect(px - r, py - r, r * 2, r * 2);
      else {
        x.beginPath();
        x.arc(px, py, r, 0, Math.PI * 2);
        x.fill();
      }
    }
    for (const T of this.teams) {
      const L = T.lead;
      if (!L || L.dead || !w.ally(T.side, this.me) || !T.role) continue;
      const dx = L.x - at.x,
        dy = L.y - at.y;
      if (dx * dx + dy * dy > R * R) continue;
      const [px, py] = put(L.x, L.y);
      this.roleMark(x, px, py - 7, T.role, 4, T.role === 'defend' ? PAL.ally : T.role === 'hunt' ? '#ffd76a' : PAL.friend);
    }
    const players = this.game.shooterNet?.playerUnits();
    if (players)
      for (const [u] of players) {
        if (u.dead) continue;
        const dx = u.x - at.x,
          dy = u.y - at.y;
        if (dx * dx + dy * dy > R * R) continue;
        const [px, py] = put(u.x, u.y);
        const ally = this.world.ally(u.side, this.me),
          pulse = 7 + 2 * Math.sin(performance.now() / 180);
        x.strokeStyle = ally ? PAL.ally : PAL.enemy;
        x.lineWidth = 1.5;
        x.beginPath();
        x.arc(px, py, pulse, 0, Math.PI * 2);
        x.stroke();
        this.playerMark(x, px, py, ally, 5.5);
      }
    x.restore();
    x.fillStyle = '#ffd76a';
    x.beginPath();
    x.moveTo(S / 2, S / 2 - 7);
    x.lineTo(S / 2 + 5, S / 2 + 5);
    x.lineTo(S / 2 - 5, S / 2 + 5);
    x.closePath();
    x.fill();
  }

  drawBoard() {
    const w = this.world,
      g = this.game,
      rows = [];
    rows.push(['Side', 'Soldiers', 'Vehicles', 'Lost', 'Points']);
    for (let s = 0; s < g.factions.length; s++) {
      let foot = 0,
        cars = 0;
      for (const u of w.units) {
        if (u.dead || u.side !== s || u.structure) continue;
        if (u.kind === 'INFANTRY') foot++;
        else cars++;
      }
      const pts = w.points.filter(p => p.side === s).length;
      rows.push([String(g.factions[s] || 'Side ' + s), foot, cars, this.losses[s] || 0, pts, s === this.me]);
    }
    const lines = [];
    if (this.tickets) lines.push('Tickets: ' + this.teamTickets().map(e => `${e.label} ${e.t}`).join('   '));
    lines.push(`You: ${this.kills} kills   ${this.stats.heads} headshots   ${this.stats.vehicles} vehicles   ${this.deaths} deaths`);
    const players = this.playerTable(),
      key = JSON.stringify([rows, lines, players]);
    if (this.boardKey === key) return;
    this.boardKey = key;
    const head = document.createElement('div'),
      t = document.createElement('table');
    head.className = 'sh-title';
    head.textContent = 'Scores';
    t.className = 'sh-tbl';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r[5]) tr.className = 'me';
      for (const v of r.slice(0, 5)) {
        const c = document.createElement(i ? 'td' : 'th');
        c.textContent = String(v);
        tr.appendChild(c);
      }
      t.appendChild(tr);
    });
    const out = [head, t];
    for (const l of lines) {
      const d = document.createElement('div');
      d.className = 'sh-board-line';
      d.textContent = l;
      out.push(d);
    }
    out.push(...this.rowsTable(players));
    this.scoreEl.replaceChildren(...out);
  }

  rowsTable(rows) {
    if (!rows || rows.length < 2) return [];
    const t = document.createElement('table');
    t.className = 'sh-tbl';
    t.style.marginTop = '8px';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.me) tr.className = 'me';
      for (const v of r) {
        const c = document.createElement(i ? 'td' : 'th');
        c.textContent = String(v);
        tr.appendChild(c);
      }
      t.appendChild(tr);
    });
    return [t];
  }

  playerTable() {
    const N = this.game.shooterNet,
      P = N ? N.playerRows() : null;
    if (!P || P.length < 2) return [];
    const out = [['Player', 'Kills', 'Assists', 'Deaths', 'Score']];
    for (const p of [...P].sort((a, b) => (b.st?.[3] || 0) - (a.st?.[3] || 0))) {
      const st = p.st || [0, 0, 0, 0, 0],
        row = [String(p.n || '').slice(0, 24), st[0], st[1], st[2], st[3]];
      row.me = N.isMe(p);
      out.push(row);
    }
    return out;
  }

  dispose() {
    if (this.game.audio) this.game.audio.falloff = 1;
    setParticleDepth(false);
    if (this.world?.terrain) this.world.terrain.padTop = null;
    document.body.classList.remove('shooter-on');
    this.hud.remove();
    this.panel.remove();
    this.endEl?.remove();
    this.ticketEl?.remove();
    this.bannerEl?.remove();
    this.setEl?.remove();
    this.hintEl?.remove();
    for (const U of this.groundU) {
      for (const v of U.glowAt.value) v.w = 0;
      boltLights.boltN.value = 0;
      for (const v of U.occAt.value) v.z = 0;
    }
    if (this.game.props) {
      const keep = this.game.props.filter(p => !p.clutter);
      for (const p of this.game.props) if (p.clutter) p.grp.removeFromParent();
      this.game.props.length = 0;
      this.game.props.push(...keep);
    }
    this.scopeEl?.remove();
    this.ov?.dispose();
    if (this.game.audio && this.game.audio.spatial === this) this.game.audio.spatial = null;
    this.verbIn?.disconnect();
    this.verbNode?.disconnect();
    this.annEl?.remove();
    this.bigMap?.remove();
    this.introEl?.remove();
    this.scoreEl?.remove();
    if (document.pointerLockElement) document.exitPointerLock?.();
  }
}
