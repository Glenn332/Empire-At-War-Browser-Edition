import { db } from '../gamedata.js';
import { abilityLocked } from './blackmarket.js';
import { swapped } from './weaponswap.js';
import { simRandom } from './simrandom.js';

const sound = (world, u, name) => { const a = world.audio, e = u && u.isSquad ? u.fighters[0] || u : u; if (a.playAt && e && e.player) a.playAt(e.player, name, u.x, u.y); else a.play(name, u.x, u.y); };

const rand = (a, b) => a + simRandom() * (b - a);
const TAU = Math.PI * 2;

const LABELS = {
  HUNT: 'Hunt for enemies', SPOILER_LOCK: 'Lock S-foils', TURBO: 'Boost engines', DEFEND: 'Boost shields',
  FOW_REVEAL_PING: 'Sensor ping', ENERGY_WEAPON: 'Proton beam', BLAST: 'Blast cannon', INTERDICT: 'Gravity well generator',
  LURE: 'Lure', BARRAGE: 'Barrage area', LUCKY_SHOT: 'Lucky shot', SUPER_LASER: 'Superlaser', DEPLOY_SQUAD: 'Deploy squadron',
};

const TARGET = {
  BARRAGE: 'point', CLUSTER_BOMB: 'point', FOW_REVEAL_PING: 'point', WEAKEN_ENEMY: 'point',
  BUZZ_DROIDS: 'unit', CONCENTRATE_FIRE: 'unit', CORRUPT_SYSTEMS: 'unit', ENERGY_WEAPON: 'unit', ION_CANNON_SHOT: 'unit',
  LEECH_SHIELDS: 'unit', TRACTOR_BEAM: 'unit', LUCKY_SHOT: 'unit', SUPER_LASER: 'unit',
};
const SELF = new Set(['SWAP_WEAPONS', 'HUNT', 'BLAST', 'HARMONIC_BOMB', 'INTERDICT', 'LASER_DEFENSE', 'LURE', 'MISSILE_SHIELD', 'SELF_DESTRUCT',
  'SENSOR_JAMMING', 'STEALTH', 'FULL_SALVO', 'DEPLOY_SQUAD']);
const TOGGLE = new Set(['HUNT', 'SPOILER_LOCK', 'INTERDICT', 'LURE', 'MISSILE_SHIELD', 'SWAP_WEAPONS']);

function namedSpec(type, name) {
  if (!name) return null;
  for (let t = type; t; t = t.parent) {
    for (const blk of t.subs.get('abilities') || []) for (const a of blk.children) if (a.attrs.Name === name) return a;
  }
  return null;
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
      const target = TARGET[kind] || 'none';
      if (!mods.size && target === 'none' && !SELF.has(kind)) continue;
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
      const label = LABELS[kind] || kind.toLowerCase().replace(/_/g, ' ');
      out.push({
        kind, mods, node: ab, spec, target, duration,
        mustBuy: /^(yes|true|1)$/i.test(ab.val('Must_Be_Bought_On_Black_Market')) || !!spec && /^(yes|true|1)$/i.test(spec.val('Must_Be_Bought_On_Black_Market')), gui: ab.val('GUI_Activated_Ability_Name').trim(),
        recharge: ab.num('Recharge_Seconds', 0),
        byDefault: /^(yes|true|1)$/i.test(ab.val('Active_By_Default').trim()),
        toggle: TOGGLE.has(kind) || (mods.size > 0 && duration === 0 && target === 'none' && !SELF.has(kind)),
        range: sn('Activation_Max_Range', 0) || ab.num('Effective_Radius', 0) || (kind === 'ION_CANNON_SHOT' || kind === 'BUZZ_DROIDS' ? 700 : 0) || (shot ? shot.num('Projectile_Max_Flight_Distance', 1800) * 0.9 : 0),
        immobile: /^(yes|true)$/i.test(ab.val('Disable_Movement')),
        icon: ab.val('Alternate_Icon_Name'),
        sfxOn: ab.val('SFXEvent_GUI_Unit_Ability_Activated'), sfxOff: ab.val('SFXEvent_GUI_Unit_Ability_Deactivated'), sfxTarget: ab.val('SFXEvent_Target_Ability').trim(),
        autofire: /^(yes|true)$/i.test(ab.val('Supports_Autofire')),
        label: label.charAt(0).toUpperCase() + label.slice(1),
      });
    }
  }
  return out;
}

export function attachAbilities(unit, defs) {
  const auto = !!(unit.player && unit.player.human && (unit.player.autofire ?? (unit.world && unit.world.autofire)));
  unit.abilities = defs.map(def => ({ def, active: false, timer: 0, cooldown: 0, data: null, acc: 0, auto: auto && def.autofire, pend: !!def.byDefault }));
}

export function refreshMods(u) {
  const m = u.mods;
  m.weaponDelay = 1; m.shieldRegen = 1; m.shieldInterval = 1; m.speed = 1; m.damageTaken = 1; m.damageDealt = 1;
  for (const st of u.abilities) {
    if (!st.active) continue;
    const g = st.def.mods;
    m.weaponDelay *= g.get('WEAPON_DELAY_MULTIPLIER') ?? 1;
    if (g.has('FIRE_RATE_MULTIPLIER')) m.weaponDelay /= Math.max(0.1, g.get('FIRE_RATE_MULTIPLIER'));
    m.shieldRegen *= g.get('SHIELD_REGEN_MULTIPLIER') ?? 1;
    m.shieldInterval *= g.get('SHIELD_REGEN_INTERVAL_MULTIPLIER') ?? 1;
    m.speed *= g.get('SPEED_MULTIPLIER') ?? 1;
    m.damageTaken *= g.get('TAKE_DAMAGE_MULTIPLIER') ?? 1;
    if (st.def.immobile) m.speed = 0;
    if (st.def.kind === 'FULL_SALVO') m.weaponDelay *= 0.15;
    if (st.def.kind === 'BLAST' && st.data && st.data.fired) m.damageDealt *= st.def.spec ? st.def.spec.num('Damage_Multiplier', 5) : 5;
  }
  for (const s of u.statuses) {
    m.speed *= s.speed ?? 1; m.damageTaken *= s.damageTaken ?? 1; m.damageDealt *= s.damageDealt ?? 1; m.weaponDelay *= s.weaponDelay ?? 1;
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
const posOf = e => (e.isSquad ? (e.fighters[0] || e) : e);

function validTarget(def, target) {
  const spec = def.spec;
  if (!spec) return true;
  const cats = spec.val('Applicable_Unit_Categories').toUpperCase().split(/[\s|,]+/).filter(Boolean);
  const types = spec.val('Applicable_Unit_Types').toUpperCase().split(/[\s,]+/).filter(Boolean);
  const excluded = spec.val('Excluded_Unit_Types').toUpperCase().split(/[\s,]+/).filter(Boolean);
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
    if ((lead.abilityLock || 0) > world.time) return lead.inNebula ? 'Abilities do not work inside a nebula' : 'Abilities are still recovering from the nebula';
    if (st0.active && (def.toggle || def.duration > 0)) return null;
    if (kind === 'DEFEND' && lead.ionUntil > world.time) return 'Disabled by an ion stun';
    if (st0.cooldown > 0) return `Recharging (${Math.ceil(st0.cooldown)}s)`;
    if (def.target === 'unit') {
      let t = target && target.isSquad ? target.fighters[0] : target;
      if (!t || t.dead || t.x === undefined || !t.type) return 'Select an enemy target';
      if (!hostile(lead, t)) return 'Select an enemy target';
      if (!validTarget(def, t)) return 'Cannot be used on that target';
      if (def.range && Math.hypot(t.x - e.x, t.y - e.y) > def.range + t.hitRadius) {
        if (!approach || !(e.isSquad || lead.isMobile)) return 'Out of range';
        e.setOrder({ kind: 'attack', target: target.squad || target, reach: def.range * 0.85 });
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
    if (!st || st.active === on && (def.toggle || def.duration > 0)) continue;
    if (on) { if (st.cooldown > 0) continue; start(world, u, st, target); }
    else if (st.active) stop(world, u, st);
    any = true;
  }
  return any ? null : 'Not ready';
}

function swapWeapon(u) {
  if (!u.weapons) return;
  u.weaponIndex = swapped(u.weaponIndex, u.weapons.length);
  if (u.weapons[u.weaponIndex]) u.weapon = u.weapons[u.weaponIndex];
}

function start(world, u, st, target) {
  const def = st.def, kind = def.kind;
  st.data = { target, t: 0 };
  st.acc = 0;
  const timed = def.toggle || def.duration > 0;
  if (timed) { st.active = true; st.timer = def.duration; }
  else st.cooldown = def.recharge;
  if (kind !== 'STEALTH' && def.target !== 'none') { const c = u.abilities.find(s => s.active && s.def.kind === 'STEALTH'); if (c) stop(world, u, c); }

  if (kind === 'SWAP_WEAPONS') swapWeapon(u);
  switch (kind) {
    case 'CLUSTER_BOMB': {
      const proj = db.type(def.spec ? def.spec.val('Bomb_Type') : '') || db.type('Proj_Cluster_Bomb');
      const n = def.spec ? def.spec.num('Number_Of_Bombs', 12) : 12;
      for (let i = 0; i < n && proj; i++) {
        const a = simRandom() * TAU, r = Math.sqrt(simRandom()) * 170;
        world.launchPoint(proj, u, u.x, u.y, u.z + 10, target.x + Math.cos(a) * r, target.y + Math.sin(a) * r, 0, { delay: i * 0.08 });
      }
      break;
    }
    case 'HARMONIC_BOMB': {
      const proj = db.type(def.node.val('Spawned_Object_Type'));
      if (proj) world.delayed(def.node.num('Bomb_Countdown_Seconds', 1.5), u.x, u.y, u.z, () => world.detonate(proj, u.player, u.x, u.y, u.z, 1));
      world.fx.flash(u.x, u.y, u.z, 30, 0xffcc66);
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
      addStatus(world, target, { kind: 'CONCENTRATE', source: u.player.team, dur: def.node.num('Expiration_Seconds', 15),
        damageTaken: 1 + (def.spec ? def.spec.num('Target_Damage_Increase_Percent', 0.5) : 0.5), mark: true });
      st.active = false; st.cooldown = def.recharge;
      break;
    case 'CORRUPT_SYSTEMS':
      addStatus(world, target, { kind: 'CORRUPT', source: u, dur: def.spec.num('Duration_In_Seconds', 12),
        shieldDps: def.spec.num('Shield_Drain_Per_Second', 60), damageDealt: 0.6 });
      world.beams.push({ a: u, b: target, color: [0.4, 1, 0.5], until: world.time + 0.8, width: 6 });
      break;
    case 'BUZZ_DROIDS':
      addStatus(world, target, { kind: 'BUZZ', source: u.squad || u, dur: 20, dps: 12, sparks: true, owner: u.player });
      world.beams.push({ a: u, b: target, color: [1, 0.8, 0.3], until: world.time + 0.5, width: 3 });
      break;
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
      if (proj) world.launch(proj, u, target, null, u.x, u.y, u.z, proj.str('Damage_Type'), new Map(), { mult: def.mods.get('CAUSE_DAMAGE_MULTIPLIER') ?? 1 });
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
    case 'TRACTOR_BEAM': case 'ENERGY_WEAPON': case 'LEECH_SHIELDS':
      if (!u.squad) u.target = target;
      break;
  }
  refreshMods(u);
  if (kind === 'SPOILER_LOCK') u.playAnim('UNDEPLOY');
  sound(world, u, def.sfxOn);
}

function stop(world, u, st) {
  const def = st.def;
  st.active = false;
  st.cooldown = def.recharge;
  if (def.kind === 'SWAP_WEAPONS') swapWeapon(u);
  if (def.kind === 'TRACTOR_BEAM' && st.data && st.data.target && !st.data.target.dead) {
    const t = st.data.target;
    t.statuses = t.statuses.filter(s => !(s.kind === 'TRACTOR' && s.source === u));
    refreshMods(t);
  }
  st.data = null;
  refreshMods(u);
  if (def.kind === 'SPOILER_LOCK') u.playAnim('DEPLOY');
  sound(world, u, def.sfxOff);
}

const inRange = (u, t, r) => (t.x - u.x) ** 2 + (t.y - u.y) ** 2 <= (r + t.hitRadius) ** 2;

export function tickAbilities(world, u, dt) {
  if (u.statuses.length) {
    let changed = false;
    for (let i = u.statuses.length - 1; i >= 0; i--) {
      const s = u.statuses[i];
      if (world.time >= s.until || (s.source && s.source.dead)) { u.statuses.splice(i, 1); changed = true; continue; }
      if (s.shieldDps && u.shield > 0) u.shield = Math.max(0, u.shield - s.shieldDps * dt);
      if (s.dps) world.damage(u, s.dps * dt, { damageType: 'Damage_Default', attacker: s.owner || null, shields: false, quiet: true });
      if (u.dead) return;
      if (s.sparks && simRandom() < dt * 6) world.fx.hit(u.x + rand(-1, 1) * u.hitRadius * 0.6, u.y + rand(-1, 1) * u.hitRadius * 0.6, u.z + u.height * 0.3, 8);
    }
    if (changed) refreshMods(u);
  }
  for (const st of u.abilities) {
    if (st.pend && !u.hyper) { st.pend = false; useAbility(world, u, st.def.kind, true); }
    if (!st.active) { if (st.cooldown > 0) st.cooldown -= dt; continue; }
    const def = st.def, d = st.data || (st.data = {});
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
          const h = guns[(simRandom() * guns.length) | 0], p = h.worldPos({});
          const a = simRandom() * TAU, r = Math.sqrt(simRandom()) * radius;
          world.launchPoint(proj || h.proj, u, p.x, p.y, p.z, d.target.x + Math.cos(a) * r, d.target.y + Math.sin(a) * r, 0, {});
          if (h.fireSfx && simRandom() < 0.3) world.audio.play(h.fireSfx, p.x, p.y);
        }
        break;
      }
      case 'BLAST':
        if (!d.fired && d.t >= (def.spec ? def.spec.num('Charge_Up_Seconds', 5) : 5)) {
          d.fired = true; refreshMods(u);
          world.fx.flash(u.x, u.y, u.z, u.visualRadius * 1.5, 0xfff0a0);
          for (const h of u.hardpoints) if (h.isWeapon) h.cooldown = 0;
        }
        break;
      case 'TRACTOR_BEAM':
        if (!tgt || tgt.dead || !inRange(u, tgt, def.range * 1.15)) { stop(world, u, st); continue; }
        if (!tgt.statuses.some(s => s.kind === 'TRACTOR' && s.source === u)) {
          addStatus(world, tgt, { kind: 'TRACTOR', source: u, dur: 999, speed: 1 - (def.spec ? def.spec.num('Target_Speed_Decrease_Percent', 0.75) : 0.75) });
        }
        world.beam(u, tgt, [0.45, 0.6, 1], 10);
        break;
      case 'ENERGY_WEAPON':
        if (!tgt || tgt.dead || !inRange(u, tgt, def.range * 1.2)) { stop(world, u, st); continue; }
        world.damage(tgt, (def.spec ? def.spec.num('Damage_Per_Frame', 50) : 50) * 30 * dt, { damageType: 'Damage_Default', attacker: u.player, x: tgt.x, y: tgt.y, z: tgt.z, quiet: simRandom() > dt * 12 });
        world.beam(u, tgt, [0.4, 1, 0.5], 14);
        break;
      case 'SUPER_LASER': {
        const sp = def.spec, fireAt = (sp ? sp.num('Fire_Frame', 60) : 60) / 30;
        if (!tgt || tgt.dead) { stop(world, u, st); continue; }
        if (d.t < fireAt) break;
        if (!d.fired) { d.fired = true; world.audio.play(def.node.val('SFXEvent_Special_Ability_Loop').trim(), u.x, u.y); }
        const c = sp ? sp.val('Line_Color').trim().split(/[\s,]+/).map(Number) : [];
        world.damage(tgt, (sp ? sp.num('Damage_Per_Frame', 500) : 500) * 30 * dt, { damageType: 'Damage_Default', attacker: u.player, x: tgt.x, y: tgt.y, z: tgt.z, quiet: simRandom() > dt * 12 });
        world.beam(u, tgt, c.length >= 3 && c.every(Number.isFinite) ? [c[0] / 255, c[1] / 255, c[2] / 255] : [0, 0.93, 0.47], sp ? sp.num('Line_Width', 35) : 35);
        break;
      }
      case 'LEECH_SHIELDS': {
        if (!tgt || tgt.dead || !inRange(u, tgt, def.range * 1.1)) { stop(world, u, st); continue; }
        const take = Math.min(tgt.shield, (def.spec ? def.spec.num('Shield_Damage_Per_Second', 100) : 100) * dt);
        tgt.shield -= take;
        u.shield = Math.min(u.maxShield, u.shield + take);
        world.beam(u, tgt, [0.2, 0.3, 1], 12);
        break;
      }
      case 'LASER_DEFENSE': {
        const r = def.spec ? def.spec.num('Protection_Radius', 500) : 500;
        const every = def.spec ? def.spec.num('Recharge_Time_In_Secs', 0.5) : 0.5;
        if ((st.acc += dt) < every) break;
        st.acc = 0;
        for (const p of world.projectiles) {
          if (!p.missile || p.dead || !p.owner || p.owner.team === u.player.team) continue;
          if ((p.x - u.x) ** 2 + (p.y - u.y) ** 2 > r * r) continue;
          p.dead = true;
          world.fx.hit(p.x, p.y, p.z, 10);
          if (def.kind === 'LASER_DEFENSE') { world.beams.push({ a: u, b: { x: p.x, y: p.y, z: p.z }, color: [0.3, 0.3, 1], until: world.time + 0.12, width: 4 }); break; }
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
      case 'SENSOR_JAMMING':
        world.jammers.push({ team: u.player.team, x: u.x, y: u.y, r: Math.max(300, def.node.num('Effective_Radius', 300)) + 150 });
        break;
      case 'INTERDICT':
        world.interdictors.push({ team: u.player.team, x: u.x, y: u.y });
        break;
    }
    if (!st.active) continue;
    if (def.duration > 0 && (st.timer -= dt) <= 0) {
      if (def.kind === 'SELF_DESTRUCT') {
        const proj = db.type(def.node.val('Spawned_Object_Type'));
        const { x, y, z } = u;
        world.kill(u, null);
        if (proj) world.detonate(proj, u.player, x, y, z, 1, true);
        return;
      }
      stop(world, u, st);
    }
  }
}

export function aiUseAbilities(world, e, onlyAuto = false) {
  const lead = posOf(e);
  if (!lead || !lead.abilities || !lead.abilities.length) return;
  const victim = e.isSquad ? (e.target && !e.target.dead ? posOf(e.target) : null) : (lead.target && !lead.target.dead ? lead.target : null);
  if (!victim || victim.x === undefined || !victim.type) return;
  const ready = [];
  for (const st of lead.abilities) {
    const def = st.def;
    if ((onlyAuto && !st.auto) || st.active || st.cooldown > 0 || !def.spec) continue;
    if (def.target === 'unit' && (!hostile(lead, victim) || !validTarget(def, victim))) continue;
    if (def.target !== 'none' && def.range && Math.hypot(victim.x - lead.x, victim.y - lead.y) > def.range + (victim.hitRadius || 0)) continue;
    const chance = def.spec.val('Activation_Chance').trim() === '' ? 1 : def.spec.num('Activation_Chance', 1);
    if (!(chance > 0) || simRandom() > chance) continue;
    ready.push(st);
  }
  if (!ready.length) return;
  const def = ready[Math.floor(simRandom() * ready.length)].def;
  useAbility(world, e, def.kind, true, def.target === 'unit' ? victim : def.target === 'point' ? { x: victim.x, y: victim.y } : null);
}
