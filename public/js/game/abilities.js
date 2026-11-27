import { db, particleFile } from '../gamedata.js';
import { abilityLocked } from './blackmarket.js';
import { swapped } from './weaponswap.js';
import { simRandom } from './simrandom.js';
import { MOD } from './combatmods.js';
import { abilityText } from './abilitytext.js';
import { getALA, animName } from '../ala.js';

const sound = (world, u, name) => {
  const a = world.audio,
    e = u && u.isSquad ? u.fighters[0] || u : u;
  if (a.playAt && e && e.player) a.playAt(e.player, name, u.x, u.y, e);
  else a.play(name, u.x, u.y);
};

const rand = (a, b) => a + simRandom() * (b - a);
const TAU = Math.PI * 2;

const LABELS = {
  HUNT: 'Hunt for enemies',
  SPOILER_LOCK: 'Lock S-foils',
  TURBO: 'Boost engines',
  DEFEND: 'Boost shields',
  FOW_REVEAL_PING: 'Sensor ping',
  ENERGY_WEAPON: 'Proton beam',
  BLAST: 'Blast cannon',
  INTERDICT: 'Gravity well generator',
  LURE: 'Lure',
  BARRAGE: 'Barrage area',
  LUCKY_SHOT: 'Lucky shot',
  SUPER_LASER: 'Superlaser',
  DEPLOY_SQUAD: 'Deploy squadron'
};

const TARGET = {
  BARRAGE: 'point',
  CLUSTER_BOMB: 'point',
  FOW_REVEAL_PING: 'point',
  WEAKEN_ENEMY: 'point',
  BUZZ_DROIDS: 'point',
  CONCENTRATE_FIRE: 'unit',
  CORRUPT_SYSTEMS: 'unit',
  ENERGY_WEAPON: 'unit',
  ION_CANNON_SHOT: 'unit',
  LEECH_SHIELDS: 'unit',
  TRACTOR_BEAM: 'unit',
  LUCKY_SHOT: 'unit',
  SUPER_LASER: 'unit'
};
const SELF = new Set([
  'SWAP_WEAPONS',
  'HUNT',
  'BLAST',
  'HARMONIC_BOMB',
  'INTERDICT',
  'LASER_DEFENSE',
  'LURE',
  'MISSILE_SHIELD',
  'SELF_DESTRUCT',
  'SENSOR_JAMMING',
  'STEALTH',
  'FULL_SALVO',
  'DEPLOY_SQUAD'
]);
const TOGGLE = new Set(['HUNT', 'SPOILER_LOCK', 'INTERDICT', 'LURE', 'MISSILE_SHIELD', 'SWAP_WEAPONS']);

const LASER_DEFENSE_DEFAULT_COLOR = [0.3, 0.3, 1];
const ENGINE_FRAMES_PER_SECOND = 30;

const specList = (spec, tag) =>
  spec
    ? spec
        .val(tag)
        .split(/[\s,|]+/)
        .filter(Boolean)
    : [];

function laserDefenseLook(def) {
  if (def.laserLook) return def.laserLook;
  const spec = def.spec,
    rgb = specList(spec, 'Laser_Color').map(Number);
  return (def.laserLook = {
    color: rgb.length >= 3 && rgb.slice(0, 3).every(Number.isFinite) ? rgb.slice(0, 3).map(c => c / 255) : LASER_DEFENSE_DEFAULT_COLOR,
    width: spec ? spec.num('Laser_Beam_Width', 4) : 4,
    seconds: Math.max(1, spec ? spec.num('Laser_Beam_Frames', 2) : 2) / ENGINE_FRAMES_PER_SECOND,
    boneNames: specList(spec, 'Bone_Names'),
    zapSound: spec ? spec.val('Zap_SFXEvent') : ''
  });
}

const laserDefenseBones = new WeakMap();

function laserDefenseBoneLocals(unit, boneNames) {
  const model = unit.model;
  if (!model || !model.bone || !unit.localOf || !boneNames.length) return null;
  let byNames = laserDefenseBones.get(model);
  if (!byNames) laserDefenseBones.set(model, (byNames = new Map()));
  const key = boneNames.join();
  let locals = byNames.get(key);
  if (!locals) {
    locals = [];
    for (const name of boneNames) {
      const bone = model.bone(name);
      if (bone) locals.push({ name, local: unit.localOf(bone) });
    }
    byNames.set(key, locals);
  }
  return locals;
}

function nearestLaserBone(unit, boneNames, point) {
  const locals = laserDefenseBoneLocals(unit, boneNames);
  if (!locals || !locals.length) return null;
  const cos = Math.cos(unit.heading || 0),
    sin = Math.sin(unit.heading || 0);
  let nearest = null,
    nearestDistance = Infinity;
  for (const { name, local } of locals) {
    const dx = unit.x + cos * local.x - sin * local.y - point.x,
      dy = unit.y + sin * local.x + cos * local.y - point.y,
      dz = (unit.z || 0) + local.z - point.z,
      distance = dx * dx + dy * dy + dz * dz;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = name;
    }
  }
  return nearest;
}

function laserDefenseZap(world, unit, def, projectile) {
  const look = laserDefenseLook(def),
    point = { x: projectile.x, y: projectile.y, z: projectile.z || 0 };
  if (look.zapSound) sound(world, unit, look.zapSound);
  world.beams.push({
    a: unit,
    b: point,
    color: look.color,
    until: world.time + look.seconds,
    width: look.width,
    bone: nearestLaserBone(unit, look.boneNames, point),
    kind: ''
  });
}

function showOwnerParticle(world, unit, abilityState) {
  const def = abilityState.def,
    index = unit.abilities.indexOf(abilityState);
  if (!def.ownerParticle || index < 0) return;
  const shown = unit.isSquad ? unit.fighters[0] : unit;
  if (shown && (!world.viewerSees || world.viewerSees(shown))) world.fx.abilityFx?.(unit, index, def.ownerParticle, def.ownerParticleBones);
}

function namedSpec(type, name) {
  name = name.trim().toUpperCase();
  if (!name) return null;
  for (let t = type; t; t = t.parent) {
    for (const blk of t.subs.get('abilities') || [])
      for (const a of blk.children) if ((a.attrs.Name || '').trim().toUpperCase() === name) return a;
  }
  return null;
}

// An ability with no handler of its own that names a projectile sets it off on its owner (area heal, stun, bomb).
function blastOf(ab, kind, target) {
  if (target !== 'none' || (SELF.has(kind) && kind !== 'HARMONIC_BOMB')) return null;
  const obj = db.type(ab.val('Spawned_Object_Type').trim());
  return obj && /^projectile$/i.test(obj.tag) ? obj : null;
}

export function parseAbilities(type) {
  const out = [];
  for (const block of type.sub('Unit_Abilities_Data')) {
    for (const ab of block.all('Unit_Ability')) {
      const kind = ab.val('Type').toUpperCase();
      if (!kind || out.some(d => d.kind === kind)) continue;
      const mods = new Map();
      for (const m of ab.all('Mod_Multiplier')) {
        const [k, v] = m.text.split(',').map(x => x.trim());
        const f = parseFloat(v);
        if (k && Number.isFinite(f)) mods.set(k.toUpperCase(), f);
      }
      const target = TARGET[kind] || 'none',
        blast = blastOf(ab, kind, target);
      if (!mods.size && target === 'none' && !SELF.has(kind) && !blast) continue;
      const spec = namedSpec(type, ab.val('GUI_Activated_Ability_Name'));
      const sn = (k, d = 0) => (spec ? spec.num(k, d) : d);
      let duration = ab.num('Expiration_Seconds', 0);
      if (kind === 'BLAST') duration = sn('Charge_Up_Seconds', 5) + 3;
      else if (kind === 'LASER_DEFENSE') duration = sn('Defense_Duration_In_Secs', 30);
      else if (kind === 'LEECH_SHIELDS') duration = sn('Duration_In_Secs', 25);
      else if (kind === 'CORRUPT_SYSTEMS') duration = 0;
      else if (kind === 'TRACTOR_BEAM') duration = 20;
      else if (kind === 'FULL_SALVO' && !duration) duration = 7;
      else if (kind === 'SELF_DESTRUCT' && !duration) duration = 3.5;
      else if (kind === 'LUCKY_SHOT' || kind === 'DEPLOY_SQUAD') duration = 0;
      else if (kind === 'SUPER_LASER') duration = sn('Fire_Frame', 60) / 30 + (duration || 2);
      const shot = kind === 'LUCKY_SHOT' ? db.type(ab.val('Projectile_Types_Override')) : null;
      const { label, description } = abilityText(ab, kind, LABELS[kind] || kind.toLowerCase().replace(/_/g, ' '));
      out.push({
        kind,
        mods,
        noDiminish: ab.all('Mod_Flag').some(m => {
          const [k, v = ''] = m.text.split(',');
          return /^ALLOW_TARGET_DIMINISHING_FIREPOWER(_FLAG)?$/i.test(k.trim()) && !/^(yes|true|1)$/i.test(v.trim());
        }),
        node: ab,
        spec,
        blast,
        target,
        duration,
        mustBuy:
          /^(yes|true|1)$/i.test(ab.val('Must_Be_Bought_On_Black_Market')) ||
          (!!spec && /^(yes|true|1)$/i.test(spec.val('Must_Be_Bought_On_Black_Market'))),
        gui: ab.val('GUI_Activated_Ability_Name').trim(),
        recharge: ab.num('Recharge_Seconds', 0),
        byDefault: /^(yes|true|1)$/i.test(ab.val('Active_By_Default').trim()),
        toggle: TOGGLE.has(kind) || (mods.size > 0 && duration === 0 && target === 'none' && !SELF.has(kind) && !blast),
        range:
          sn('Activation_Max_Range', 0) ||
          ab.num('Effective_Radius', 0) ||
          (kind === 'ION_CANNON_SHOT' || kind === 'BUZZ_DROIDS' ? 700 : 0) ||
          (shot ? shot.num('Projectile_Max_Flight_Distance', 1800) * 0.9 : 0),
        immobile: /^(yes|true)$/i.test(ab.val('Disable_Movement')),
        icon: ab.val('Alternate_Icon_Name'),
        sfxOn: ab.val('SFXEvent_GUI_Unit_Ability_Activated'),
        sfxOff: ab.val('SFXEvent_GUI_Unit_Ability_Deactivated'),
        sfxTarget: ab.val('SFXEvent_Target_Ability').trim(),
        autofire: /^(yes|true)$/i.test(ab.val('Supports_Autofire')),
        // The effect on the user: the unit ability's Particle_Effect, else the Owner_Particle_Effect of the ability it
        // names (a Sensor_Jamming_Ability's jammer field), on that ability's Owner_Particle_Bone_Name.
        ownerParticle: target === 'none' ? particleFile(ab.val('Particle_Effect')) || (spec ? particleFile(spec.val('Owner_Particle_Effect')) : '') : '',
        ownerParticleBones:
          target !== 'none' || particleFile(ab.val('Particle_Effect')) || !spec
            ? specList(ab, 'Owner_Attachment_Bone')
            : specList(spec, 'Owner_Particle_Bone_Name').length
              ? specList(spec, 'Owner_Particle_Bone_Name')
              : specList(ab, 'Owner_Attachment_Bone'),
        label,
        description
      });
    }
  }
  return out;
}

const AUTO_STYLE = /^(global|combat|space|skirmish)_automatic$/i;
export function autoSpecials(type) {
  const out = [],
    named = new Set();
  for (const block of type.sub('Unit_Abilities_Data'))
    for (const ab of block.all('Unit_Ability')) named.add(ab.val('GUI_Activated_Ability_Name').trim());
  for (const block of type.sub('Abilities'))
    for (const spec of block.all('Laser_Defense_Ability')) {
      if (!AUTO_STYLE.test(spec.val('Activation_Style').trim()) || named.has((spec.attrs.Name || '').trim())) continue;
      if (/^(no|false|0)$/i.test(spec.val('Initially_Enabled').trim())) continue;
      out.push({
        kind: 'LASER_DEFENSE',
        mods: new Map(),
        noDiminish: false,
        node: spec,
        spec,
        blast: null,
        target: 'none',
        duration: spec.num('Defense_Duration_In_Secs', 30),
        mustBuy: false,
        gui: '',
        recharge: 0,
        byDefault: true,
        toggle: false,
        range: 0,
        immobile: false,
        icon: '',
        sfxOn: '',
        sfxOff: '',
        sfxTarget: '',
        autofire: false,
        ownerParticle: '',
        ownerParticleBones: [],
        passive: true,
        ...abilityText(null, 'LASER_DEFENSE', 'Laser defense')
      });
    }
  return out;
}

export function attachAbilities(unit, defs, passive = []) {
  const p = unit.player,
    auto = !!(p && (p.human ? (p.autofire ?? (unit.world && unit.world.autofire)) : p.id >= 0));
  unit.passives = passive.map(def => ({ def, active: false, timer: 0, cooldown: 0, data: null, acc: 0, auto: false, pend: true }));
  unit.abilities = defs.map(def => ({
    def,
    active: false,
    timer: 0,
    cooldown: 0,
    data: null,
    acc: 0,
    auto: auto && def.autofire,
    pend: !!def.byDefault
  }));
  // what tickAbilities walks every step: the abilities, then the passives. Joined once here, not for every step.
  unit.tickedAbilities = unit.passives.length ? unit.abilities.concat(unit.passives) : unit.abilities;
}

export function refreshMods(u) {
  const m = u.mods;
  m.weaponDelay = 1;
  m.shieldRegen = 1;
  m.shieldInterval = 1;
  m.energyRegen = 1;
  m.energyInterval = 1;
  m.speed = 1;
  m.damageTaken = 1;
  m.damageDealt = 1;
  m.diminish = true;
  for (const st of u.abilities) {
    if (!st.active) continue;
    if (st.def.noDiminish) m.diminish = false;
    const g = st.def.mods;
    m.weaponDelay *= g.get('WEAPON_DELAY_MULTIPLIER') ?? 1;
    if (g.has('FIRE_RATE_MULTIPLIER')) m.weaponDelay /= Math.max(0.1, g.get('FIRE_RATE_MULTIPLIER'));
    m.shieldRegen *= g.get('SHIELD_REGEN_MULTIPLIER') ?? 1;
    m.shieldInterval *= g.get('SHIELD_REGEN_INTERVAL_MULTIPLIER') ?? 1;
    m.energyRegen *= g.get('ENERGY_REGEN_MULTIPLIER') ?? 1;
    m.energyInterval *= g.get('ENERGY_REGEN_INTERVAL_MULTIPLIER') ?? 1;
    m.speed *= g.get('SPEED_MULTIPLIER') ?? 1;
    m.damageTaken *= g.get('TAKE_DAMAGE_MULTIPLIER') ?? 1;
    if (st.def.immobile) m.speed = 0;
    if (st.def.kind === 'BLAST' && st.data && st.data.fired) m.damageDealt *= st.def.spec ? st.def.spec.num('Damage_Multiplier', 5) : 5;
  }
  for (const s of u.statuses) {
    m.speed *= s.speed ?? 1;
    m.damageTaken *= s.damageTaken ?? 1;
    m.damageDealt *= s.damageDealt ?? 1;
    m.weaponDelay *= s.weaponDelay ?? 1;
  }
  u.cloaked = u.abilities.some(st => st.active && st.def.kind === 'STEALTH');
}

export function addStatus(world, u, s) {
  if (u.dead) return;
  const old = u.statuses.findIndex(x => x.kind === s.kind && x.source === s.source);
  if (old >= 0) u.statuses.splice(old, 1);
  s.until = world.time + s.dur;
  u.statuses.push(s);
  refreshMods(u);
}

const hostile = (a, b) => b.player.id >= 0 && a.player.team !== b.player.team;
const members = e => (e.isSquad ? e.fighters : [e]);
const posOf = e => (e.isSquad ? e.fighters[0] || e : e);

function validTarget(def, target) {
  const spec = def.spec;
  if (!spec) return true;
  const cats = spec
    .val('Applicable_Unit_Categories')
    .toUpperCase()
    .split(/[\s|,]+/)
    .filter(Boolean);
  const types = spec
    .val('Applicable_Unit_Types')
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  const excluded = spec
    .val('Excluded_Unit_Types')
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  const name = target.type.name.toUpperCase();
  if (excluded.includes(name)) return false;
  if (!cats.length || cats.includes('ALL') || types.includes(name)) return true;
  const tc = target.type.categories();
  return cats.some(c => tc.has(c));
}

export function useAbility(world, e, kind, on = true, target = null, approach = false) {
  const lead = posOf(e);
  if (!lead || !lead.abilities) return 'No such ability';
  const st0 = lead.abilities.find(s => s.def.kind === kind);
  if (!st0) return 'No such ability';
  const def = st0.def;
  if (on && abilityLocked(world.campaign, def, world.marketOf(lead))) return 'Must be bought on the Black Market';
  if (on) {
    if ((lead.abilityLock || 0) > world.time)
      return lead.inNebula ? 'Abilities do not work inside a nebula' : 'Abilities are still recovering from the nebula';
    if (st0.active && (def.toggle || def.duration > 0) && (def.target === 'none' || !target)) return null;
    if (kind === 'DEFEND' && lead.ionUntil > world.time) return 'Disabled by an ion stun';
    if (kind === 'DEFEND' && world.inIonStorm && world.inIonStorm(lead)) return 'Shields do not work inside an ion storm';
    if (kind === 'INTERDICT' && lead.hardpoints?.some(h => h.kind === 'HARD_POINT_GRAVITY_WELL' && !h.alive))
      return 'The gravity well is destroyed';
    if (st0.cooldown > 0) return `Recharging (${Math.ceil(st0.cooldown)}s)`;
    if (def.target === 'unit') {
      let t = target && target.isSquad ? target.fighters[0] : target;
      if (!t || t.dead || t.x === undefined || !t.type) return 'Select an enemy target';
      if (!hostile(lead, t)) return 'Select an enemy target';
      if (!validTarget(def, t)) return 'Cannot be used on that target';
      if (def.range && !inRange(e.isSquad ? lead : e, t, def.range)) {
        if (!approach || !(e.isSquad || lead.isMobile)) return 'Out of range';
        e.setOrder({ kind: 'attack', target: target.squad || target, reach: def.range * 0.85 + (lead.hitRadius || 0) });
        e.pendingAbility = { kind, target: t, until: world.time + 90 };
        return null;
      }
      target = t;
    } else if (def.target === 'point') {
      if (!target || target.x === undefined) return 'Select a location';
      const range = kind === 'BARRAGE' ? lead.maxRange * 1.15 : def.range;
      if (range && kind !== 'FOW_REVEAL_PING' && Math.hypot(target.x - e.x, target.y - e.y) > range) return 'Out of range';
      target = { x: target.x, y: target.y };
    }
  }
  let any = false;
  for (const u of members(e)) {
    const st = u.abilities.find(s => s.def.kind === kind);
    if (on && st && st.active && kind === 'SUPER_LASER') continue;
    if (on && st && st.active && !def.toggle && def.duration > 0 && def.target !== 'none' && target) {
      retarget(u, st, target);
      any = true;
      continue;
    }
    if (!st || (st.active === on && (def.toggle || def.duration > 0))) continue;
    if (on) {
      if (st.cooldown > 0) continue;
      start(world, u, st, target);
    } else if (st.active) stop(world, u, st);
    any = true;
  }
  return any ? null : 'Not ready';
}

export function recharge(u, st, secs) {
  if (secs === undefined) {
    const m = u && u.cmods;
    secs = st.def.recharge * (m && m.size ? m.factor(MOD.RECHARGE) : 1);
  }
  st.cooldown = st.span = secs > 0 ? secs : 0;
}

function swapWeapon(u) {
  if (!u.weapons) return;
  u.weaponIndex = swapped(u.weaponIndex, u.weapons.length);
  if (u.weapons[u.weaponIndex]) u.weapon = u.weapons[u.weaponIndex];
}

function retarget(u, st, target) {
  st.data = { target, t: st.data ? st.data.t : 0 };
  const kind = st.def.kind;
  if ((kind === 'TRACTOR_BEAM' || kind === 'ENERGY_WEAPON' || kind === 'LEECH_SHIELDS') && !u.squad) u.target = target;
}

function start(world, u, st, target) {
  const def = st.def,
    kind = def.kind;
  st.data = { target, t: 0 };
  st.acc = 0;
  const timed = def.toggle || def.duration > 0;
  if (timed) {
    st.active = true;
    st.timer = def.duration;
    showOwnerParticle(world, u, st);
  } else recharge(u, st);
  if (kind === 'INTERDICT') world.onEvent('interdict', { unit: u, on: true });
  if (kind !== 'STEALTH' && def.target !== 'none') {
    const c = u.abilities.find(s => s.active && s.def.kind === 'STEALTH');
    if (c) stop(world, u, c);
  }

  if (kind === 'SWAP_WEAPONS') swapWeapon(u);
  switch (kind) {
    case 'CLUSTER_BOMB': {
      const proj = db.type(def.spec ? def.spec.val('Bomb_Type') : '') || db.type('Proj_Cluster_Bomb');
      const n = def.spec ? def.spec.num('Number_Of_Bombs', 12) : 12;
      for (let i = 0; i < n && proj; i++) {
        const a = simRandom() * TAU,
          r = Math.sqrt(simRandom()) * 170;
        world.launchPoint(proj, u, u.x, u.y, u.z + 10, target.x + Math.cos(a) * r, target.y + Math.sin(a) * r, 0, { delay: i * 0.08 });
      }
      break;
    }
    case 'FOW_REVEAL_PING': {
      const obj = db.type(def.node.val('Spawned_Object_Type'));
      const r = obj ? obj.num('Space_FOW_Reveal_Range', 1000) : 1000;
      world.reveals.push({ team: u.player.team, x: target.x, y: target.y, r, until: world.time + 15 });
      world.fx.flash(target.x, target.y, 0, r * 0.5, 0x66ccff);
      break;
    }
    case 'WEAKEN_ENEMY': {
      const obj = db.type(def.node.val('Spawned_Object_Type'));
      const r = obj ? obj.num('Projectile_Weaken_Enemy_Radius', 300) : 300;
      const dur = obj ? obj.num('Projectile_Weaken_Enemy_Duration_Seconds', 15) : 15;
      const take = 1 + (obj ? obj.num('Projectile_Weaken_Enemy_Take_Damage_Increase_Percent', 0) : 0);
      const deal = 1 - (obj ? obj.num('Projectile_Weaken_Enemy_Cause_Damage_Reduction_Percent', 0.2) : 0.2);
      for (const o of world.units) {
        if (o.dead || !hostile(u, o) || Math.hypot(o.x - target.x, o.y - target.y) > r + o.hitRadius) continue;
        addStatus(world, o, { kind: 'WEAKEN', source: u.player.team, dur, damageTaken: take, damageDealt: deal });
      }
      world.fx.flash(target.x, target.y, 0, r, 0xff66cc);
      break;
    }
    case 'CONCENTRATE_FIRE':
      addStatus(world, target, {
        kind: 'CONCENTRATE',
        source: u.player.team,
        dur: def.node.num('Expiration_Seconds', 15),
        damageTaken: 1 + (def.spec ? def.spec.num('Target_Damage_Increase_Percent', 0.5) : 0.5),
        mark: true
      });
      st.active = false;
      recharge(u, st);
      break;
    case 'CORRUPT_SYSTEMS':
      addStatus(world, target, {
        kind: 'CORRUPT',
        source: u,
        dur: def.spec.num('Duration_In_Seconds', 12),
        shieldDps: def.spec.num('Shield_Drain_Per_Second', 60),
        damageDealt: 0.6
      });
      world.beams.push({ a: u, b: target, color: [0.4, 1, 0.5], until: world.time + 0.8, width: 6 });
      break;
    case 'BUZZ_DROIDS': {
      const obj = def.spec && db.type(def.spec.val('Object_Type'));
      if (obj) {
        if (!u.squad || u.squad.fighters[0] === u) world.spawnSwarm(obj, u, target, def.spec);
        break;
      }
      let victim = null,
        best = 200 ** 2;
      for (const o of world.units) {
        if (o.dead || o.hyper || !o.targetableUnit || !hostile(u, o)) continue;
        const d = (o.x - target.x) ** 2 + (o.y - target.y) ** 2;
        if (d < best) {
          best = d;
          victim = o;
        }
      }
      if (!victim) break;
      addStatus(world, victim, { kind: 'BUZZ', source: u.squad || u, dur: 20, dps: 12, sparks: true, owner: u.player });
      world.beams.push({ a: u, b: victim, color: [1, 0.8, 0.3], until: world.time + 0.5, width: 3 });
      break;
    }
    case 'ION_CANNON_SHOT': {
      const proj = db.type(def.node.val('Projectile_Types_Override'));
      if (proj) world.launch(proj, u, target, null, u.x, u.y, u.z, proj.str('Damage_Type'), new Map());
      break;
    }
    case 'SELF_DESTRUCT':
      world.fx.flash(u.x, u.y, u.z, u.visualRadius, 0xff5533);
      break;
    case 'LUCKY_SHOT': {
      if (u.squad && u.squad.fighters[0] !== u) break;
      const proj = db.type(def.node.val('Projectile_Types_Override'));
      if (proj)
        world.launch(proj, u, target, null, u.x, u.y, u.z, proj.str('Damage_Type'), new Map(), {
          mult: def.mods.get('CAUSE_DAMAGE_MULTIPLIER') ?? 1
        });
      sound(world, u, def.sfxTarget);
      break;
    }
    case 'SUPER_LASER':
      if (!u.squad) u.target = target;
      sound(world, u, def.sfxTarget);
      break;
    case 'DEPLOY_SQUAD':
      if (!world.deploySquad(u)) st.cooldown = 0;
      break;
    case 'TRACTOR_BEAM':
    case 'ENERGY_WEAPON':
    case 'LEECH_SHIELDS':
      if (!u.squad) u.target = target;
      break;
    default: {
      const proj = def.blast;
      if (!proj || (u.squad && u.squad.fighters[0] !== u)) break;
      const bomb = kind === 'HARMONIC_BOMB',
        secs = def.node.num('Bomb_Countdown_Seconds', bomb ? 1.5 : 0),
        { x, y, z } = u,
        go = () => world.detonate(proj, u.player, x, y, z, 1);
      if (secs > 0) world.delayed(secs, x, y, z, go);
      else go();
      if (bomb) world.fx.flash(x, y, z, 30, 0xffcc66);
      else if (def.sfxTarget) sound(world, u, def.sfxTarget);
    }
  }
  refreshMods(u);
  if (kind === 'SPOILER_LOCK') u.playAnim('DEPLOY', { reverses: 'UNDEPLOY' });
  sound(world, u, def.sfxOn);
}

function ended(world, u, st) {
  stop(world, u, st);
  world.onUnitSignal?.(u.squad || u, 'Unit_Ability_Finished');
}

function stop(world, u, st) {
  const def = st.def;
  st.active = false;
  recharge(u, st);
  if (def.kind === 'INTERDICT') world.onEvent('interdict', { unit: u, on: false });
  if (def.kind === 'SWAP_WEAPONS') swapWeapon(u);
  if (def.kind === 'TRACTOR_BEAM' && st.data && st.data.target && !st.data.target.dead) {
    const t = st.data.target;
    t.statuses = t.statuses.filter(s => !(s.kind === 'TRACTOR' && s.source === u));
    refreshMods(t);
  }
  st.data = null;
  refreshMods(u);
  if (def.kind === 'SPOILER_LOCK') u.playAnim('UNDEPLOY', { reverses: 'DEPLOY' });
  if (def.kind === 'SUPER_LASER') u.playAnim?.('IDLE', { loop: true });
  sound(world, u, def.sfxOff);
}

export const inRange = (u, t, r) => (t.x - u.x) ** 2 + (t.y - u.y) ** 2 <= (r + (u.hitRadius || 0) + (t.hitRadius || 0)) ** 2;

export function tickAbilities(world, u, dt) {
  if (u.statuses.length) {
    let changed = false;
    for (let i = u.statuses.length - 1; i >= 0; i--) {
      const s = u.statuses[i];
      if (world.time >= s.until || (s.source && s.source.dead)) {
        u.statuses.splice(i, 1);
        changed = true;
        continue;
      }
      if (s.shieldDps && u.shield > 0) u.shield = Math.max(0, u.shield - s.shieldDps * dt);
      if (s.dps) world.damage(u, s.dps * dt, { damageType: 'Damage_Default', attacker: s.owner || null, shields: false, quiet: true });
      if (u.dead) return;
      if (s.sparks && simRandom() < dt * 6)
        world.fx.hit(u.x + rand(-1, 1) * u.hitRadius * 0.6, u.y + rand(-1, 1) * u.hitRadius * 0.6, u.z + u.height * 0.3, 8);
    }
    if (changed) refreshMods(u);
  }
  const ticked =
    u.tickedAbilities && (u.passives?.length ? u.tickedAbilities.length === u.abilities.length + u.passives.length : u.tickedAbilities === u.abilities)
      ? u.tickedAbilities
      : u.passives?.length
        ? u.abilities.concat(u.passives)
        : u.abilities;
  for (const st of ticked) {
    if (st.pend && !u.hyper) {
      st.pend = false;
      if (st.def.passive) {
        st.active = true;
        st.timer = st.def.duration;
        st.acc = 0;
        st.data = { t: 0 };
        showOwnerParticle(world, u, st);
      } else useAbility(world, u, st.def.kind, true);
    }
    if (!st.active) {
      if (st.cooldown > 0) st.cooldown -= dt;
      continue;
    }
    const def = st.def,
      d = st.data || (st.data = {});
    d.t = (d.t || 0) + dt;
    const tgt = d.target && d.target.type ? d.target : null;
    switch (def.kind) {
      case 'BARRAGE': {
        const proj = db.type(def.node.val('Projectile_Types_Override'));
        const radius = def.node.num('Targeting_Fire_Inaccuracy_Fixed_Radius_Override', 320);
        const guns = u.hardpoints.filter(h => h.isWeapon && h.alive);
        st.acc += dt * Math.max(2, guns.length * 1.5);
        while (st.acc >= 1 && guns.length) {
          st.acc -= 1;
          const h = guns[(simRandom() * guns.length) | 0],
            p = h.worldPos({});
          const a = simRandom() * TAU,
            r = Math.sqrt(simRandom()) * radius;
          world.launchPoint(proj || h.proj, u, p.x, p.y, p.z, d.target.x + Math.cos(a) * r, d.target.y + Math.sin(a) * r, 0, {});
          if (h.fireSfx && simRandom() < 0.3 && (!world.audible || world.audible(p.x, p.y, u.player))) world.audio.play(h.fireSfx, p.x, p.y);
        }
        break;
      }
      case 'BLAST':
        if (!d.fired && d.t >= (def.spec ? def.spec.num('Charge_Up_Seconds', 5) : 5)) {
          d.fired = true;
          refreshMods(u);
          world.fx.flash(u.x, u.y, u.z, u.visualRadius * 1.5, 0xfff0a0);
          for (const h of u.hardpoints) if (h.isWeapon) h.cooldown = 0;
        }
        break;
      case 'TRACTOR_BEAM':
        if (!tgt || tgt.dead || !inRange(u, tgt, def.range * 1.15)) {
          ended(world, u, st);
          continue;
        }
        if (!tgt.statuses.some(s => s.kind === 'TRACTOR' && s.source === u)) {
          addStatus(world, tgt, {
            kind: 'TRACTOR',
            source: u,
            dur: 999,
            speed: 1 - (def.spec ? def.spec.num('Target_Speed_Decrease_Percent', 0.75) : 0.75)
          });
        }
        world.beam(u, tgt, [0.45, 0.6, 1], 10, 'HP_trac_bone', 'tractor');
        break;
      case 'ENERGY_WEAPON':
        if (!tgt || tgt.dead || !inRange(u, tgt, def.range * 1.2)) {
          ended(world, u, st);
          continue;
        }
        if (d.hpOf !== tgt) {
          d.hpOf = tgt;
          d.hp = world.nearestHardpoint(tgt, u.x, u.y, u.z || 0);
        }
        if (d.hp && d.hp.destroyable && !d.hp.alive) {
          ended(world, u, st);
          continue;
        }
        world.damage(tgt, (def.spec ? def.spec.num('Damage_Per_Frame', 50) : 50) * 30 * dt, {
          damageType: 'Damage_Default',
          hp: d.hp,
          attacker: u.player,
          x: tgt.x,
          y: tgt.y,
          z: tgt.z,
          quiet: simRandom() > dt * 12
        });
        world.beam(u, tgt, [0.4, 1, 0.5], 14, 'HP_trac_bone');
        break;
      case 'SUPER_LASER':
        if (superLaserStep(world, u, st, tgt, dt)) continue;
        break;
      case 'LEECH_SHIELDS': {
        if (!tgt || tgt.dead || !inRange(u, tgt, def.range * 1.1)) {
          ended(world, u, st);
          continue;
        }
        const take = Math.min(tgt.shield, (def.spec ? def.spec.num('Shield_Damage_Per_Second', 100) : 100) * dt);
        tgt.shield -= take;
        u.shield = Math.min(u.maxShield, u.shield + take);
        world.beam(u, tgt, [0.2, 0.3, 1], 12);
        break;
      }
      case 'LASER_DEFENSE': {
        const r = def.spec ? def.spec.num('Protection_Radius', 500) : 500;
        const every = def.spec ? def.spec.num('Recharge_Time_In_Secs', 0.5) : 0.5;
        const kinds = (def.kinds ??= def.spec
            ? def.spec
                .val('Projectile_Types_Targeted')
                .split(/[,|\s]+/)
                .filter(Boolean)
                .map(c => c.toUpperCase())
            : []),
          gone = def.spec ? def.spec.num('Projectile_Dist_Travelled', 0) : 0;
        if ((st.acc += dt) < every) break;
        st.acc = 0;
        // The first shot in the list that passes every test is taken, so the tests may run in any order: distance
        // first, which rules out nearly every shot of a big battle, and the shot type's category is read once per type.
        const team = u.player.team,
          unitX = u.x,
          unitY = u.y,
          unitZ = u.z || 0,
          reach = r * r;
        // where the battle keeps its shots in rows of numbers (shots.js), far shots are passed over from those
        const shots = world.projectiles,
          store = world.shots,
          rows = world.shotRows,
          inRows = !!store && world.shotRowsOf === shots && world.shotRowCount === shots.length;
        for (let i = 0; i < shots.length; i++) {
          if (inRows) {
            const row = rows[i];
            if (store.dead[row]) continue;
            if ((store.x[row] - unitX) ** 2 + (store.y[row] - unitY) ** 2 + ((store.z[row] || 0) - unitZ) ** 2 > reach) continue;
          }
          const p = shots[i];
          if (!inRows) {
            if (p.dead) continue;
            if ((p.x - unitX) ** 2 + (p.y - unitY) ** 2 + ((p.z || 0) - unitZ) ** 2 > reach) continue;
          }
          if (!p.owner || p.owner.team === team) continue;
          if (kinds.length ? !(p.def && kinds.includes((p.def.upperCategory ??= p.def.str('Projectile_Category').trim().toUpperCase()))) : !p.missile)
            continue;
          if ((p.flown || 0) <= gone) continue;
          p.dead = true;
          world.fx.hit(p.x, p.y, p.z, 10);
          laserDefenseZap(world, u, def, p);
          break;
        }
        break;
      }
      case 'LURE':
        if ((st.acc += dt) >= 1 && u.squad && u.squad.fighters[0] === u) {
          st.acc = 0;
          for (const s of world.squads) {
            if (s.dead || s.player.team === u.player.team || s.order.kind === 'move') continue;
            if ((s.x - u.x) ** 2 + (s.y - u.y) ** 2 < 900 * 900) s.target = u.squad;
          }
        }
        break;
      case 'SENSOR_JAMMING': {
        const r = def.node.num('Effective_Radius', 0);
        if (r > 0)
          for (const o of world.units)
            if (
              !o.dead &&
              o.isMobile &&
              o.player.team !== u.player.team &&
              (o.x - u.x) ** 2 + (o.y - u.y) ** 2 + ((o.z || 0) - (u.z || 0)) ** 2 <= r * r
            )
              o.jammedAt = world.time;
        break;
      }
      case 'INTERDICT':
        world.interdictors.push({ team: u.player.team, x: u.x, y: u.y });
        break;
    }
    if (!st.active) continue;
    if (def.duration > 0 && !def.passive && def.kind !== 'SUPER_LASER' && (st.timer -= dt) <= 0) {
      if (def.kind === 'SELF_DESTRUCT') {
        const proj = db.type(def.node.val('Spawned_Object_Type'));
        const { x, y, z } = u;
        world.kill(u, null);
        if (proj) world.detonate(proj, u.player, x, y, z, 1, true);
        return;
      }
      ended(world, u, st);
    }
  }
}

// The Death Star II superlaser, as in the original game: after Fire_Delay the station turns toward its target
// (Face_Target) until the target is inside Firing_Cone, plays its ATTACK clip (Attack_Anim_Sub_Index), opens fire on
// the clip's Fire_Frame and burns the target with Damage_Per_Frame for Expiration_Seconds. It stops early when the
// target dies or leaves Activation_Max_Range. Returns true once the ability has ended.
function superLaserStep(world, unit, abilityState, target, dt) {
  const def = abilityState.def,
    spec = def.spec,
    data = abilityState.data;
  if (!target || target.dead || (def.range && !inRange(unit, target, def.range))) {
    ended(world, unit, abilityState);
    return true;
  }
  if (!data.phase) data.phase = 'delay';
  if (data.phase === 'delay') {
    if (data.t < (spec ? spec.num('Fire_Delay', 0) : 0)) return false;
    data.phase = spec && /^(yes|true|1)$/i.test(spec.val('Face_Target').trim()) ? 'turn' : 'charge';
    if (data.phase === 'charge') startSuperLaserClip(unit, spec, data);
  }
  if (data.phase === 'turn') {
    if (!turnTowardTarget(unit, target, spec, dt)) return false;
    data.phase = 'charge';
    startSuperLaserClip(unit, spec, data);
  }
  if (data.phase === 'charge') {
    data.clipTime += dt;
    if (!superLaserFireFrameReached(unit, spec, data.clipTime)) return false;
    data.phase = 'fire';
    data.fireLeft = def.node.num('Expiration_Seconds', 0);
    if (!world.audible || world.audible(unit.x, unit.y, unit.player))
      world.audio.playFrom(unit, def.node.val('SFXEvent_Special_Ability_Loop').trim(), unit.x, unit.y);
    return false;
  }
  if ((data.fireLeft -= dt) <= 0) {
    ended(world, unit, abilityState);
    return true;
  }
  world.damage(target, (spec ? spec.num('Damage_Per_Frame', 500) : 500) * 30 * dt, {
    damageType: 'Damage_Default',
    attacker: unit.player,
    x: target.x,
    y: target.y,
    z: target.z,
    quiet: simRandom() > dt * 12
  });
  world.beam(unit, target, superLaserColor(spec), spec ? spec.num('Line_Width', 35) : 35, superLaserBone(spec), 'superlaser');
  return false;
}

function startSuperLaserClip(unit, spec, data) {
  data.clipTime = 0;
  unit.playAnim?.('ATTACK', { index: spec ? spec.num('Attack_Anim_Sub_Index', 0) : 0 });
}

// Fire_Frame counts frames of the ATTACK clip; with no such clip the laser fires at once.
function superLaserFireFrameReached(unit, spec, clipTime) {
  const clip = getALA(animName(unit.type.str('Space_Model_Name'), 'ATTACK', spec ? spec.num('Attack_Anim_Sub_Index', 0) : 0));
  if (!clip) return true;
  return clipTime >= clip.duration || clipTime * clip.fps >= (spec ? spec.num('Fire_Frame', 0) : 0);
}

// Yaw only, at Turn_Rate degrees per logic frame (the unit's own Max_Rate_Of_Turn when Turn_Rate is not above 0).
function turnTowardTarget(unit, target, spec, dt) {
  const coneDegrees = spec ? spec.num('Firing_Cone', 45) : 45,
    cone = ((coneDegrees >= 90 ? 0.01 : coneDegrees) * Math.PI) / 180,
    wanted = Math.atan2(target.y - unit.y, target.x - unit.x);
  let difference = wanted - (unit.heading || 0);
  difference = Math.atan2(Math.sin(difference), Math.cos(difference));
  if (Math.abs(difference) <= cone) return true;
  const ownRate = spec ? spec.num('Turn_Rate', -1) : -1,
    degreesPerFrame = ownRate > 0 ? ownRate : unit.type.num('Max_Rate_Of_Turn', 0),
    step = ((degreesPerFrame * 30 * Math.PI) / 180) * dt;
  unit.heading = (unit.heading || 0) + Math.sign(difference) * Math.min(Math.abs(difference), step);
  unit.syncObj?.();
  return false;
}

function superLaserColor(spec) {
  const rgb = spec
    ? spec
        .val('Line_Color')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
    : [];
  return rgb.length >= 3 && rgb.every(Number.isFinite) ? [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] : [0, 0.93, 0.47];
}

function superLaserBone(spec) {
  return (spec ? spec.val('Owner_Particle_Bone_Name') : '').trim().split(/[\s,]+/)[0] || null;
}

const supportSwarm = def =>
  def.kind === 'BUZZ_DROIDS' && !!def.spec && !!def.spec.val('Object_Type') && !(def.spec.num('Enemy_Damage_Per_Second', 0) > 0);

function hurtAlly(world, lead, range) {
  let best = null,
    bf = 0.9;
  for (const o of world.units) {
    if (o.dead || o.hyper || o.swarm || o.isFighter || o.player.team !== lead.player.team || o.player.id < 0) continue;
    if (range && Math.hypot(o.x - lead.x, o.y - lead.y) > range + (o.hitRadius || 0)) continue;
    const f = o.healthFrac;
    if (f < bf) {
      bf = f;
      best = o;
    }
  }
  return best;
}

// A unit ability whose spawned object heals on detonation (a fleet tender's fighter repair pulse, a HARMONIC_BOMB
// spawning Proj_Fleet_Tender_Fighter_Heal): what it heals, and how far.
export function healPulseOf(def) {
  if (def.kind !== 'HARMONIC_BOMB') return null;
  if (def._heal !== undefined) return def._heal;
  const proj = db.type(def.node.val('Spawned_Object_Type'));
  if (!proj || !proj.bool('Projectile_Instant_Heal_On_Detonation')) return (def._heal = null);
  const cats = proj
    .str('Projectile_Instant_Heal_Targets_Category_Mask')
    .split(/[|,\s]+/)
    .filter(Boolean)
    .map(c => c.toUpperCase());
  return (def._heal = { radius: proj.num('Projectile_Instant_Heal_Radius', 100), cats });
}

function blastUseful(world, lead, proj) {
  if (proj.bool('Projectile_Instant_Heal_On_Detonation')) return world.instantHeal(proj, lead.player, lead.x, lead.y, true);
  const r = proj.num('Projectile_Blast_Area_Range', 150) * 0.8;
  for (const o of world.units)
    if (
      !o.dead &&
      !o.hyper &&
      o.targetableUnit &&
      hostile(lead, o) &&
      (!world.canSee || world.canSee(lead.player, o)) &&
      inRange(lead, o, r)
    )
      return true;
  return false;
}

export function aiUseAbilities(world, e, onlyAuto = false) {
  const lead = posOf(e);
  if (!lead || !lead.abilities || !lead.abilities.length) return;
  // Area abilities go off around their owner and need no attack target.
  for (const st of lead.abilities) {
    const def = st.def;
    if (!def.blast || (onlyAuto && !st.auto) || st.active || st.cooldown > 0 || (lead.abilityLock || 0) > world.time) continue;
    if (blastUseful(world, lead, def.blast) && !useAbility(world, e, def.kind, true)) return;
  }
  const victim = e.isSquad ? (e.target && !e.target.dead ? posOf(e.target) : null) : lead.target && !lead.target.dead ? lead.target : null;
  if (!victim || victim.x === undefined || !victim.type) return;
  const ready = [];
  for (const st of lead.abilities) {
    const def = st.def;
    if ((onlyAuto && !st.auto) || st.active || st.cooldown > 0 || !def.spec || def.blast) continue;
    if (def.target === 'unit' && (!hostile(lead, victim) || !validTarget(def, victim))) continue;
    if (def.target !== 'none' && def.range && !inRange(lead, victim, def.range)) continue;
    const chance = def.spec.val('Activation_Chance').trim() === '' ? 1 : def.spec.num('Activation_Chance', 1);
    if (!(chance > 0) || simRandom() > chance) continue;
    ready.push(st);
  }
  if (!ready.length) return;
  const def = ready[Math.floor(simRandom() * ready.length)].def;
  if (supportSwarm(def)) {
    const ally = hurtAlly(world, lead, def.range);
    if (ally) useAbility(world, e, def.kind, true, { x: ally.x, y: ally.y });
    return;
  }
  useAbility(world, e, def.kind, true, def.target === 'unit' ? victim : def.target === 'point' ? { x: victim.x, y: victim.y } : null);
}
