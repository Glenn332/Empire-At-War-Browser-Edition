import { db } from '../gamedata.js';
import { simRandom } from './simrandom.js';
import { abilityLocked } from './blackmarket.js';
import { swapped } from './weaponswap.js';

const yes = s => /^(yes|true)$/i.test(String(s || '').trim());
const names = s =>
  String(s || '')
    .split(/[\s,|]+/)
    .filter(Boolean)
    .map(x => x.toUpperCase());
const FPS = 30;

const TARGET = {
  FORCE_LIGHTNING: 'enemy',
  FORCE_TELEKINESIS: 'enemy',
  STICKY_BOMB: 'enemy',
  CAPTURE_VEHICLE: 'enemy',
  TACTICAL_BRIBE: 'enemy',
  BERSERKER: 'enemy',
  SABER_THROW: 'enemy',
  INFECTION: 'enemy',
  TARGETED_HACK: 'enemy',
  CABLE_ATTACK: 'enemy',
  MAXIMUM_FIREPOWER: 'enemy',
  TARGETED_INVULNERABILITY: 'friend',
  TARGETED_REPAIR: 'friend',
  JET_PACK: 'point',
  FOW_REVEAL_PING: 'point',
  SUMMON: 'point',
  RADIOACTIVE_CONTAMINATE: 'point',
  PROXIMITY_MINES: 'point',
  PLACE_REMOTE_BOMB: 'point'
};
const SELF = new Set([
  'FORCE_WHIRLWIND',
  'AREA_EFFECT_CONVERT',
  'AREA_EFFECT_STUN',
  'STUN',
  'FORCE_CONFUSE',
  'DRAIN_LIFE',
  'FLAME_THROWER',
  'UNTARGETED_STICKY_BOMB',
  'DEPLOY_TROOPERS',
  'DEPLOY',
  'HUNT',
  'STEALTH',
  'FORCE_CLOAK',
  'MISSILE_SHIELD',
  'LASER_DEFENSE',
  'SELF_DESTRUCT',
  'SHIELD_FLARE',
  'FORCE_SIGHT',
  'ROCKET_ATTACK',
  'AREA_EFFECT_HEAL',
  'EJECT_VEHICLE_THIEF',
  'DETONATE_REMOTE_BOMB',
  'SWAP_WEAPONS'
]);
const TOGGLE = new Set(['SPREAD_OUT', 'DEPLOY', 'HUNT', 'ROCKET_ATTACK', 'SWAP_WEAPONS']);
export const FORCE = new Set([
  'FORCE_TELEKINESIS',
  'FORCE_WHIRLWIND',
  'FORCE_LIGHTNING',
  'AREA_EFFECT_CONVERT',
  'BERSERKER',
  'FORCE_SIGHT',
  'SABER_THROW',
  'FORCE_CLOAK',
  'FORCE_CONFUSE',
  'DRAIN_LIFE'
]);
const LABELS = {
  FORCE_WHIRLWIND: 'Force push',
  FORCE_TELEKINESIS: 'Force crush',
  AREA_EFFECT_CONVERT: 'Force corrupt',
  AREA_EFFECT_STUN: 'Stun blast',
  TARGETED_INVULNERABILITY: 'Force protect',
  UNTARGETED_STICKY_BOMB: 'Drop thermal detonator',
  STICKY_BOMB: 'Thermal detonator',
  FOW_REVEAL_PING: 'Sensor ping',
  TARGETED_HACK: 'Take over turret',
  TARGETED_REPAIR: 'Repair vehicle'
};

const ICONS = {
  UNTARGETED_STICKY_BOMB: 'drop_bomb',
  DEPLOY_TROOPERS: 'deploy_stormtroopers',
  JET_PACK: 'jetpack_jump',
  FORCE_LIGHTNING: 'force_lighting',
  AREA_EFFECT_CONVERT: 'join_me',
  AREA_EFFECT_STUN: 'electronic_scramble',
  CAPTURE_VEHICLE: 'capture_vehicles',
  TARGETED_INVULNERABILITY: 'force_protect',
  CABLE_ATTACK: 'tow_cable_attack',
  RADIOACTIVE_CONTAMINATE: 'contaminate',
  FORCE_TELEKINESIS: 'force_crush',
  FORCE_WHIRLWIND: 'force_push',
  TARGETED_HACK: 'hack_turret',
  TARGETED_REPAIR: 'repair_vehicle'
};

function namedSpec(type, name) {
  if (!name) return null;
  const key = name.toUpperCase();
  for (const block of type.sub('Abilities')) for (const c of block.children) if ((c.attrs.Name || '').toUpperCase() === key) return c;
  return null;
}

const CACHE = new Map();
export function landAbilities(type) {
  if (CACHE.has(type)) return CACHE.get(type);
  const out = [];
  let blocks = [];
  try {
    blocks = type.sub('Unit_Abilities_Data');
  } catch {
    blocks = [];
  }
  for (const block of blocks)
    for (const ab of block.all('Unit_Ability')) {
      const kind = ab.val('Type').toUpperCase();
      if (!kind || out.some(d => d.kind === kind)) continue;
      const mods = new Map();
      for (const m of ab.all('Mod_Multiplier')) {
        const [k, v] = m.text.split(',').map(x => x.trim());
        const f = parseFloat(v);
        if (k && Number.isFinite(f)) mods.set(k.toUpperCase(), f);
      }
      const aim = TARGET[kind] || 'none';
      if (!mods.size && aim === 'none' && !SELF.has(kind)) continue;
      const spec = namedSpec(type, ab.val('GUI_Activated_Ability_Name')),
        sn = (k, d = 0) => (spec ? spec.num(k, d) : d);
      const blast = db.type(ab.val('Spawned_Object_Type'));
      let duration = ab.num('Expiration_Seconds', 0);
      if (kind === 'LASER_DEFENSE') duration = sn('Defense_Duration_In_Secs', 28);
      else if (kind === 'FORCE_SIGHT') duration = sn('Force_Sight_Duration_In_Secs', 10);
      else if (kind === 'DRAIN_LIFE') duration = sn('Duration_In_Seconds', 5);
      else if (kind === 'FLAME_THROWER') duration = sn('Fire_Time_In_Secs', 10);
      else if (kind === 'BERSERKER') duration = sn('Berserker_Duration_In_Secs', 6);
      else if (kind === 'FORCE_LIGHTNING') duration = sn('Damage_Application_Time_In_Secs', 2.4);
      else if (kind === 'FORCE_TELEKINESIS') duration = 1e9;
      let range = sn('Activation_Max_Range', 0) || ab.num('Targeting_Max_Attack_Distance', 0);
      if (kind === 'TARGETED_INVULNERABILITY') range = ab.num('Effective_Radius', 400);
      else if (kind === 'FOW_REVEAL_PING') range = 1e9;
      else if (kind === 'JET_PACK') range = 400;
      else if (kind === 'TARGETED_HACK' || kind === 'TARGETED_REPAIR') range = 100;
      else if (kind === 'MAXIMUM_FIREPOWER' && !range) range = type.num('Targeting_Max_Attack_Distance', 0) || 300;
      const label =
        db.t(ab.val('Alternate_Name_Text')) ||
        db.t(`TEXT_TOOLTIP_ABILITY_${kind}_NAME`) ||
        LABELS[kind] ||
        kind.toLowerCase().replace(/_/g, ' ');
      out.push({
        mustBuy: yes(ab.val('Must_Be_Bought_On_Black_Market')) || (!!spec && yes(spec.val('Must_Be_Bought_On_Black_Market'))),
        gui: ab.val('GUI_Activated_Ability_Name').trim(),
        kind,
        mods,
        node: ab,
        spec,
        blast,
        duration,
        range,
        minRange: sn('Activation_Min_Range', 0),
        byDefault: yes(ab.val('Active_By_Default')),
        recharge: ab.num('Recharge_Seconds', 0),
        toggle: TOGGLE.has(kind) || (mods.size > 0 && duration === 0 && aim === 'none' && !SELF.has(kind)),
        aim,
        target: aim === 'point' ? 'point' : aim === 'none' ? 'none' : 'unit',
        friendly: aim === 'friend',
        cats: names(spec && (spec.val('Applicable_Unit_Categories') || spec.val('Infection_CategoryMask'))),
        types: names(spec && spec.val('Applicable_Unit_Types')),
        excluded: names(spec && spec.val('Excluded_Unit_Types')),
        icon: ab.val('Alternate_Icon_Name') || (ICONS[kind] ? `i_sa_${ICONS[kind]}.tga` : ''),
        autofire: yes(ab.val('Supports_Autofire')),
        sfxOn:
          ab.val('SFXEvent_GUI_Unit_Ability_Activated') || ab.val('SFXEvent_Target_Ability') || (spec ? spec.val('SFXEvent_Activate') : ''),
        sfxOff: ab.val('SFXEvent_GUI_Unit_Ability_Deactivated'),
        label: label.charAt(0).toUpperCase() + label.slice(1)
      });
    }
  CACHE.set(type, out);
  return out;
}

const maskOf = u =>
  u.type
    .str('CategoryMask')
    .toUpperCase()
    .split(/[\s|,]+/);
const isHero = u => maskOf(u).some(c => c.includes('HERO'));
function fits(u, cats, types, excluded = []) {
  const n = u.type.name.toUpperCase();
  if (excluded.includes(n)) return false;
  if (!cats.length && !types.length) return true;
  if (cats.includes('ALL')) return true;
  const mask = maskOf(u);
  return cats.some(c => mask.includes(c)) || types.includes(n);
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (world, x, y, r, pred) => world.units.filter(u => !u.dead && !u.inside && Math.hypot(u.x - x, u.y - y) <= r && pred(u));
const effect = (world, tick) => world.effects.push(tick);
const after = (world, secs, fn) => {
  let t = secs;
  effect(world, dt => ((t -= dt) <= 0 ? (fn(), true) : false));
};
const fx = (world, name, at, dz = 0) => {
  if (name && world.onFx) world.onFx(name, at.x, at.y, (at.z || 0) + dz);
};
const sound = (world, name, at) => {
  if (name && world.onSound) world.onSound(name, at.x, at.y);
};
const beam = (world, a, b, secs, color) => world.beams.push({ a, b, until: world.time + secs, color });
const stun = (world, u, secs) => {
  u.stunUntil = Math.max(u.stunUntil || 0, world.time + secs);
  u.path = [];
  u.target = null;
};

export function setSide(world, q, side, dieAfter = 0) {
  q.side = side;
  q.foe = null;
  q.selected = false;
  q.pending = null;
  for (const u of q.members) {
    u.side = side;
    u.target = null;
    u.path = [];
  }
  if (dieAfter > 0)
    after(world, dieAfter, () => {
      for (const u of q.members.slice()) {
        u.invulnUntil = 0;
        world.hurt(u, 1e9);
      }
    });
}

export function blast(world, P, x, y, side, on = null) {
  if (!P) return;
  const at = { x, y, z: world.groundZ(x, y) };
  fx(
    world,
    P.str('Projectile_Lifetime_Detonation_Particle') ||
      P.str('Projectile_Ground_Detonation_Particle') ||
      P.str('Projectile_Object_Detonation_Particle'),
    at,
    4
  );
  sound(world, P.str('Projectile_SFXEvent_Detonate'), at);
  const foes = (r, pred) => near(world, x, y, r, u => !world.ally(u.side, side) && pred(u));
  if (P.bool('Projectile_Convert_Enemy_On_Detonation')) {
    const cats = names(P.str('Projectile_Convert_Enemy_Targets_Category_Mask'));
    const taken = new Set(
      foes(P.num('Projectile_Convert_Enemy_Radius', 100), u => !u.structure && !isHero(u) && fits(u, cats, [])).map(u => u.squad)
    );
    for (const q of taken) {
      const m = q.members[0];
      if (m) fx(world, P.str('Projectile_Convert_Enemy_Spawn_Effect'), m, 6);
      setSide(world, q, side, m ? m.type.num('Converted_To_Enemy_Die_Time_Seconds', 60) : 60);
    }
  }
  if (P.bool('Projectile_Stun_On_Detonation')) {
    const cats = names(P.str('Projectile_Stun_Victims_Category_Mask')),
      types = names(P.str('Projectile_Stun_Victims_Unit_Types'));
    for (const u of foes(P.num('Projectile_Stun_Radius', 100), u => fits(u, cats, types))) {
      stun(world, u, P.num('Projectile_Stun_Duration_Frames', 300) / FPS);
      fx(world, P.str('Projectile_Stun_Spawn_Effect'), u, u.aimZ);
    }
  }
  if (P.bool('Projectile_Instant_Heal_On_Detonation')) {
    const cats = names(P.str('Projectile_Instant_Heal_Targets_Category_Mask')),
      secs = Math.max(0.1, P.num('Projectile_Instant_Heal_Duration_Frames', 30) / FPS);
    const rate = P.num('Projectile_Instant_Heal_Health_Increase', 0) / secs;
    for (const u of near(
      world,
      x,
      y,
      P.num('Projectile_Instant_Heal_Radius', 100),
      u => world.ally(u.side, side) && !u.structure && fits(u, cats, [])
    )) {
      fx(world, P.str('Projectile_Instant_Heal_Spawn_Effect'), u, u.aimZ);
      let left = secs;
      effect(world, dt => {
        if (u.dead) return true;
        u.health = Math.min(u.maxHealth, u.health + rate * Math.min(dt, left));
        return (left -= dt) <= 0;
      });
    }
  }
  if (P.bool('Projectile_Cause_Invulnerability_On_Detonation') && on) {
    on.invulnUntil = world.time + P.num('Projectile_Cause_Invulnerability_Duration_Frames', 300) / FPS;
    fx(world, P.str('Projectile_Cause_Invulnerability_Spawn_Effect'), on, on.aimZ);
  }
  const dmg = P.num('Projectile_Blast_Area_Damage', 0),
    r = P.num('Projectile_Blast_Area_Range', 0);
  if (dmg > 0 && r > 0) {
    const tiers = P.bool('Projectile_Blast_Area_Dropoff') ? Math.max(1, P.num('Projectile_Blast_Area_Dropoff_Tiers', 3)) : 1;
    for (const u of near(world, x, y, r, u => world.blastReaches(u, side, P))) {
      const step = Math.min(tiers - 1, Math.floor((Math.hypot(u.x - x, u.y - y) / r) * tiers));
      world.hurt(u, dmg * (1 - step / tiers) * db.damageMod(P.str('Damage_Type'), u.armor));
    }
  }
  if (P.num('Land_FOW_Reveal_Range', 0) > 0 && !dmg)
    world.pings.push({ x, y, r: P.num('Land_FOW_Reveal_Range'), side, until: world.time + 10 });
}

const CLOAK_FADE = 1;
const solidParts = u => [...u.inst.meshByName].filter(([name]) => /^BASEMESH|^LIGHTSABER|^HILT/.test(name)).map(([, node]) => node);
function cloakLook(u, on, world) {
  if (!u.ghost) {
    if (world) {
      const S = world.skin(u);
      S.ghost = on ? 1 : 0;
      S.tint.set(0.45, 0.7, 1, on ? 0.35 : 0);
    }
    return;
  }
  const settle = k => {
    u.ghost.visible = k === 1;
    for (const node of solidParts(u)) node.visible = k === 0;
  };
  if (!world) {
    settle(on ? 1 : 0);
    return;
  }
  const S = world.skin(u),
    fresh = !u.cloakFade;
  u.ghost.traverse(o => {
    o.userData.cloakPart = true;
  });
  u.cloakFade = { to: on ? 1 : 0, k: u.cloakFade ? u.cloakFade.k : on ? 0 : 1 };
  u.ghost.visible = true;
  for (const node of solidParts(u)) node.visible = true;
  S.fade = u.cloakFade.k;
  if (fresh)
    world.effects.push(dt => {
      const F = u.cloakFade;
      if (!F || u.dead) {
        u.cloakFade = null;
        S.fade = -1;
        return true;
      }
      F.k = F.to > F.k ? Math.min(F.to, F.k + dt / CLOAK_FADE) : Math.max(F.to, F.k - dt / CLOAK_FADE);
      S.fade = F.k;
      if (F.k !== F.to) return false;
      settle(F.to);
      u.cloakFade = null;
      S.fade = -1;
      return true;
    });
}

const casterOf = (q, kind) => q.members.find(u => !u.dead && u.abilityKinds.has(kind)) || null;

export const bribeBase = type => {
  const own = type.num('Tactical_Bribe_Cost', 0);
  return own > 1
    ? own
    : type
        .list('Company_Units')
        .map(n => db.type(n)?.num('Tactical_Bribe_Cost', 0) || 0)
        .find(c => c > 1) || 0;
};
export function bribeCost(world, q, t) {
  const base = bribeBase(t.type);
  const hero = q.members.find(u => !u.dead && u.abilityKinds?.has('TACTICAL_BRIBE')) || q.members[0];
  if (!(base > 1) || !hero) return 0;
  return (
    base *
    hero.type.num(
      (world.planetCorruption ?? -1) === -1 ? 'Bribe_Modifier_On_Uncorrupted_Planets' : 'Bribe_Modifier_On_Corrupted_Planets',
      1
    )
  );
}
export const SILENT = 'silent';

export function cantTarget(world, q, def, tgt) {
  const c = casterOf(q, def.kind);
  if (!c) return 'No one left to do it';
  if (def.aim === 'point') return tgt && tgt.x !== undefined && world.nearestOpen(tgt.x, tgt.y) ? null : 'Not there';
  const u = tgt && tgt.unit;
  if (!u || u.dead) return 'Needs a target';
  if (def.aim === 'friend') {
    if (!world.ally(u.side, q.side)) return 'Only on your own';
    if (def.kind === 'TARGETED_REPAIR' && u.kind !== 'VEHICLE') return 'Only vehicles can be repaired';
    return null;
  }
  if (world.ally(u.side, q.side)) return 'Not on your own';
  if (def.kind === 'TARGETED_HACK') return u.structure && u.weapon ? null : 'Only turrets can be taken over';
  if (def.kind === 'TACTICAL_BRIBE') return u.structure || isHero(u) || !(bribeCost(world, q, u) > 0) ? 'Cannot be bribed' : null;
  if (def.kind === 'CAPTURE_VEHICLE') return def.types.includes(u.type.name.toUpperCase()) ? null : 'Cannot be captured';
  return fits(u, def.cats, def.types, def.excluded) ? null : 'No effect on that';
}

export function abilityBlocked(world, q, kind) {
  if (kind !== 'DEPLOY_TROOPERS') return null;
  const st = q.abilityState(kind),
    c = st && casterOf(q, kind);
  if (!st || !c) return null;
  if (c.rooted) return 'Not ready';
  const alive = (q.deployed || []).filter(s => s.members.length).length;
  return alive >= st.def.node.num('Max_Num_Spawned_Objects', 1) ? 'Too many troops deployed' : null;
}

export function useAbility(world, q, kind, tgt = null) {
  const st = q.abilityState(kind);
  if (!st || !q.members.length) return 'Not available';
  const def = st.def,
    c = casterOf(q, kind);
  if (!c) return 'Not available';
  if (abilityLocked(world.campaign, def, world.marketOf(q))) return 'Must be bought on the Black Market';
  if (FORCE.has(kind) && c.noForce > world.time) return 'The Force cannot be used here';
  if (def.toggle && kind === 'DEPLOY' && st.active && q.members.some(u => u.padSite && (u.padSite.structure || u.padSite.building)))
    return 'Something stands on it';
  if (def.toggle) {
    st.active = !st.active;
    toggled(world, q, st);
    refreshMods(world, q);
    return null;
  }
  if (st.active && (kind === 'STEALTH' || kind === 'FORCE_CLOAK')) {
    finish(world, q, st);
    return null;
  }
  if (st.active || st.cooldown > 0) return 'Not ready';
  const blocked = abilityBlocked(world, q, kind);
  if (blocked) return blocked;
  if (def.aim !== 'none') {
    const why = cantTarget(world, q, def, tgt);
    if (why) return why;
    const at = tgt.unit || tgt,
      d = dist(c, at);
    if (d > def.range) {
      q.pending = { kind, tgt };
      q.foe = null;
      const k = (d - def.range * 0.85) / d;
      world.order(q, c.x + (at.x - c.x) * k, c.y + (at.y - c.y) * k);
      return null;
    }
  }
  q.pending = null;
  if (kind === 'TACTICAL_BRIBE') {
    const cost = bribeCost(world, q, tgt.unit);
    if (!(world.credits[q.side] >= cost) || !(cost > 0)) {
      sound(world, def.spec ? def.spec.val('SFXEvent_Fail') : '', c);
      return SILENT;
    }
    world.credits[q.side] -= cost;
  }
  st.active = true;
  st.left = def.duration;
  sound(world, def.sfxOn, c);
  start(world, q, st, c, tgt);
  refreshMods(world, q);
  if (def.duration <= 0) finish(world, q, st);
  return null;
}

function finish(world, q, st) {
  if (!st.active) return;
  st.active = false;
  st.cooldown = st.def.recharge;
  const kind = st.def.kind;
  if (kind === 'STEALTH' || kind === 'FORCE_CLOAK')
    for (const u of q.members)
      if (u.abilityKinds.has(kind)) {
        u.cloaked = false;
        cloakLook(u, false, world);
      }
  if (kind === 'MISSILE_SHIELD' || kind === 'FLAME_THROWER')
    for (const u of q.members) {
      u.rooted = false;
      if (u.setup) {
        u.setup = false;
        world.cast(u, 'UNDEPLOY');
      }
    }
  if (kind === 'MAXIMUM_FIREPOWER')
    for (const u of q.members)
      if (u.fullPower) {
        u.weapon = u.fullPower;
        u.fullPower = null;
      }
  refreshMods(world, q);
}

function toggled(world, q, st) {
  const kind = st.def.kind;
  if (kind === 'DEPLOY')
    for (const u of q.members)
      if (u.abilityKinds.has(kind)) {
        const on = st.active;
        u.rooted = true;
        u.path = [];
        u.deployed = false;
        u.setup = on;
        if (!on && world.deployBuilder) world.deployBuilder(u, false);
        const secs = world.cast(u, on ? 'DEPLOY' : 'UNDEPLOY', 0, false, u.type.num('Deployment_Anim_Rate', 1) || 1)
          ? u.cast - world.time
          : 0;
        after(world, secs, () => {
          if (u.dead || u.setup !== on) return;
          if (on) {
            u.deployed = true;
            if (world.deployBuilder) world.deployBuilder(u, true);
            return;
          }
          u.rooted = false;
          if (q.afterPack) {
            const p = q.afterPack;
            q.afterPack = null;
            world.order(q, p.x, p.y, p.facing);
          }
        });
      }
  if (kind === 'HUNT') q.hunt = st.active;
  if (kind === 'SWAP_WEAPONS')
    for (const u of q.members) {
      if (!u.abilityKinds.has(kind) || !u.weapons) continue;
      u.weaponIndex = swapped(u.weaponIndex || 0, u.weapons.length);
      const g = u.weapons[u.weaponIndex];
      if (!g) continue;
      if (u.mainWeapon) {
        u.mainWeapon = g;
        u.mainRange = g.reach;
      } else if (u.fullPower) u.fullPower = g;
      else {
        u.weapon = g;
        u.range = g.reach;
      }
    }
  if (kind === 'ROCKET_ATTACK')
    for (const u of q.members) {
      if (!u.abilityKinds.has(kind)) continue;
      if (st.active) {
        if (!u.altWeapon) {
          const hps = u.type
            .list('HardPoints')
            .map(n => db.hardpoint(n))
            .filter(h => h && db.type(h.str('Fire_Projectile_Type')));
          const h = hps[0],
            P = h && db.type(h.str('Fire_Projectile_Type'));
          if (!P) continue;
          u.altWeapon = {
            proj: P,
            damage: P.num('Projectile_Damage', 10),
            damageType: P.str('Damage_Type'),
            speed: P.num('Max_Speed', 10) * FPS,
            pulses: hps.reduce((a, x) => a + Math.max(1, x.num('Fire_Pulse_Count', 1)), 0),
            pulseDelay: h.num('Fire_Pulse_Delay_Seconds', 0.3),
            recharge: h.num('Fire_Min_Recharge_Seconds', 4),
            cooldown: 1,
            left: 0,
            timer: 0
          };
          u.altRange = st.def.node.num('Targeting_Max_Attack_Distance', 0) || h.num('Fire_Range_Distance', u.range);
        }
        u.mainWeapon = u.weapon;
        u.mainRange = u.range;
        u.weapon = u.altWeapon;
        u.range = u.altRange;
      } else if (u.mainWeapon) {
        u.weapon = u.mainWeapon;
        u.range = u.mainRange;
        u.mainWeapon = null;
      }
      u.target = null;
    }
}

export function refreshMods(world, q) {
  for (const u of q.members) {
    const m = (u.mod = { speed: 1, taken: 1, delay: 1, dealt: 1 });
    for (const st of q.abilities) {
      if (!st.active || !u.abilityKinds.has(st.def.kind)) continue;
      for (const [k, v] of st.def.mods) {
        if (k === 'SPEED_MULTIPLIER') m.speed *= v;
        else if (k === 'TAKE_DAMAGE_MULTIPLIER') m.taken *= v;
        else if (k === 'WEAPON_DELAY_MULTIPLIER') m.delay *= Math.max(0.05, v);
        else if (k === 'FIRE_RATE_MULTIPLIER') m.delay /= Math.max(0.05, v);
        else if (k === 'CAUSE_DAMAGE_MULTIPLIER') m.dealt *= v;
      }
    }
  }
  const wide = q.abilities.some(st => st.active && st.def.kind === 'SPREAD_OUT')
    ? db.constants.num('Spread_Out_Spacing_Coefficient', 2) || 2
    : 1;
  if (wide !== (q.spread || 1) && q.members.length) {
    q.spread = wide;
    const m = q.members,
      cx = m.reduce((a, u) => a + u.x, 0) / m.length,
      cy = m.reduce((a, u) => a + u.y, 0) / m.length;
    if (!m.some(u => u.path.length)) world.order(q, cx, cy, m[0].heading);
  }
}

function start(world, q, st, c, tgt) {
  const def = st.def,
    kind = def.kind,
    ab = def.node,
    spec = def.spec,
    side = q.side;
  const sn = (k, d = 0) => (spec ? spec.num(k, d) : d),
    sv = k => (spec ? spec.val(k) : '');
  const t = tgt && tgt.unit;
  const foe = u => !world.ally(u.side, side) && !u.cloaked;
  const applies = u => foe(u) && fits(u, def.cats, def.types, def.excluded);
  const face = at => {
    c.heading = Math.atan2(at.y - c.y, at.x - c.x);
  };
  if (t) face(t);
  switch (kind) {
    case 'STIM_PACK': {
      const cut = ab.num('Damage_Percent_When_Activated', 0);
      for (const u of q.members) if (u.abilityKinds.has(kind)) u.health = Math.max(1, u.health - u.maxHealth * cut);
      break;
    }

    case 'FORCE_WHIRLWIND':
      world.cast(c, 'FW_ATTACK');
      fx(world, sv('Owner_Particle_Effect'), c, 4);
      after(world, sn('Travel_Time_In_Secs', 1), () => {
        for (const u of near(world, c.x, c.y, sn('Damage_Range', 75), applies)) world.hurt(u, sn('Damage_Amount', 500), null, 'FW_DIE');
      });
      break;

    case 'FORCE_LIGHTNING': {
      const struck = near(world, t.x, t.y, sn('Lightning_Targets_Radius', 100), applies)
        .sort((a, b) => dist(a, t) - dist(b, t))
        .slice(0, sn('Lightning_Max_Targets', 15));
      if (!struck.includes(t)) struck.unshift(t);
      const lit = sv('Target_Light_Effect_Color').split(',').map(parseFloat),
        from = sn('Start_Lightning_Frame_Number', 0) / FPS;
      world.cast(c, 'FL_ATTACK', def.duration);
      world.stop(q);
      c.rooted = true;
      after(world, def.duration, () => {
        c.rooted = false;
      });
      for (const u of struck) {
        stun(world, u, def.duration);
        fx(world, sv('Target_Particle_Effect'), u, u.aimZ);
        if (lit.length >= 3) world.glow(u, lit, sn('Target_Light_Effect_Duration', def.duration), sn('Target_Light_Effect_Pulse_Count', 1));
      }
      after(world, from, () => {
        if (!c.dead)
          for (const u of struck)
            if (!u.dead)
              world.bolts.push({
                a: c,
                b: u,
                aBone: sv('Lightning_Source_Bone_Name'),
                bBone: sv('Lightning_Target_Bone_Name'),
                effect: sv('Lightning_Effect_Name'),
                until: world.time + def.duration - from
              });
      });
      after(world, def.duration, () => {
        for (const u of struck) world.hurt(u, sn('Damage_Amount', 9999), null, 'FL_DIE');
      });
      break;
    }

    case 'FORCE_TELEKINESIS': {
      const every = sn('Damage_Interval_In_Secs', 0.2),
        part = sn('Damage_Percentage', 0.1),
        flat = sn('Damage_Amount', 0);
      let wait = every;
      world.stop(q);
      q.busy = true;
      world.cast(c, 'FTK_ATTACK');
      effect(world, dt => {
        if (t.dead || c.dead || !q.busy || t.side === side) {
          q.busy = false;
          finish(world, q, st);
          if (!c.dead) world.cast(c, 'FTK_RELEASE');
          return true;
        }
        if (!(c.cast > world.time)) world.cast(c, 'FTK_HOLD', 0.5, true);
        stun(world, t, every * 2);
        beam(world, c, t, dt * 2, 0xff5a4a);
        if ((wait -= dt) <= 0) {
          wait += every;
          fx(world, sv('Target_Particle_Effect'), t, t.aimZ);
          world.hurt(t, flat + t.maxHealth * part, null, 'FTK_DIE');
        }
        return false;
      });
      break;
    }

    case 'AREA_EFFECT_CONVERT':
    case 'AREA_EFFECT_STUN':
      blast(world, def.blast, c.x, c.y, side);
      break;
    case 'TARGETED_INVULNERABILITY':
      blast(world, def.blast, t.x, t.y, side, t);
      break;
    case 'FOW_REVEAL_PING':
      blast(world, def.blast, tgt.x, tgt.y, side);
      break;

    case 'STUN':
    case 'FORCE_CONFUSE': {
      const stunning = kind === 'STUN',
        r = sn(stunning ? 'Stun_Range' : 'Confuse_Range', 110),
        secs = sn(stunning ? 'Stun_Time_In_Secs' : 'Confuse_Time_In_Secs', 8);
      fx(world, sv('Owner_Particle_Effect'), c, 4);
      after(world, sn(stunning ? 'Stun_Travel_Time_In_Secs' : 'Confuse_Travel_Time_In_Secs', 1), () => {
        for (const u of near(world, c.x, c.y, r, u => applies(u) && !u.structure)) {
          if (stunning) stun(world, u, secs);
          else {
            u.confuseUntil = world.time + secs;
            u.target = null;
            u.squad.foe = null;
          }
          fx(world, sv(stunning ? 'Stunned_Effect' : 'Confuse_Effect'), u, u.aimZ);
        }
      });
      break;
    }

    case 'DRAIN_LIFE': {
      const victims = near(world, c.x, c.y, sn('Drain_Radius', 100), u => applies(u) && !u.structure)
        .sort((a, b) => dist(a, c) - dist(b, c))
        .slice(0, sn('Max_Drain_Victims', 4));
      const dps = sn('Damage_Per_Second', 15),
        heal = yes(sv('Should_Heal'));
      let left = def.duration;
      for (const u of victims) {
        if (sv('Drain_Effect_Name') && world.tables && world.tables.lightning.has(sv('Drain_Effect_Name').toUpperCase()))
          world.bolts.push({
            a: c,
            b: u,
            aBone: sv('Drain_Source_Bone_Name'),
            bBone: sv('Drain_Target_Bone_Name'),
            effect: sv('Drain_Effect_Name'),
            until: world.time + def.duration
          });
        else beam(world, c, u, def.duration, 0xb04aff);
      }
      effect(world, dt => {
        if (c.dead || (left -= dt) <= 0) return true;
        for (const u of victims)
          if (!u.dead) {
            world.hurt(u, dps * dt);
            if (heal) c.health = Math.min(c.maxHealth, c.health + dps * dt);
          }
        return false;
      });
      break;
    }

    case 'FLAME_THROWER': {
      const reach = def.range || 100,
        half = (sn('Damage_Arc_In_Degrees', 90) * Math.PI) / 360,
        every = sn('Damage_Delay_In_Secs', 0.5),
        each = (sn('Damage_Amount', 225) * every) / Math.max(every, def.duration);
      let wait = 0,
        left = def.duration;
      if (c.target) face(c.target);
      c.rooted = true;
      c.path = [];
      effect(world, dt => {
        if (c.dead || (left -= dt) <= 0 || !st.active) return true;
        if ((wait -= dt) > 0) return false;
        wait += every;
        fx(world, sv('Flame_Emitter_Model_Name'), { x: c.x + Math.cos(c.heading) * 14, y: c.y + Math.sin(c.heading) * 14, z: c.z }, c.aimZ);
        for (const u of near(world, c.x, c.y, reach, applies)) {
          let a = Math.atan2(u.y - c.y, u.x - c.x) - c.heading;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          if (Math.abs(a) <= half) world.hurt(u, each);
        }
        return false;
      });
      break;
    }

    case 'JET_PACK': {
      const o = world.nearestOpen(tgt.x, tgt.y),
        fliers = q.members.filter(u => u.abilityKinds.has(kind));
      const lead = fliers[0];
      for (const u of fliers) {
        const p = world.nearestOpen(o.x + (u.x - lead.x), o.y + (u.y - lead.y)) || o;
        u.path = [];
        u.target = null;
        u.flight = { x0: u.x, y0: u.y, x1: p.x, y1: p.y, t: 0, T: Math.max(0.6, Math.hypot(p.x - u.x, p.y - u.y) / (u.speed * 3)) };
        u.heading = Math.atan2(p.y - u.y, p.x - u.x);
      }
      break;
    }

    case 'CABLE_ATTACK': {
      const wind = (sn('Drop_Phase_Duration', 110) + sn('Pull_Phase_Duration', 140)) / FPS,
        held = sn('Paralyze_Phase_Duration', 300) / FPS;
      let left = wind;
      world.stop(q);
      q.busy = true;
      effect(world, dt => {
        if (t.dead || c.dead || !q.busy) {
          q.busy = false;
          return true;
        }
        stun(world, t, 0.5);
        beam(world, c, t, dt * 2, 0xd8d8d8);
        const a = world.time * 2.2;
        c.x = t.x + Math.cos(a) * 45;
        c.y = t.y + Math.sin(a) * 45;
        c.heading = a + Math.PI / 2;
        c.path = [];
        if ((left -= dt) > 0) return false;
        q.busy = false;
        stun(world, t, held);
        after(world, held * 0.25, () => {
          if (!t.dead) {
            t.invulnUntil = 0;
            world.hurt(t, 1e9, null, 'CA_DIE');
          }
        });
        return true;
      });
      break;
    }

    case 'RADIOACTIVE_CONTAMINATE': {
      const Z = db.type(sv('Contamination_Object_Name')),
        spot = { x: tgt.x, y: tgt.y, z: world.groundZ(tgt.x, tgt.y) };
      const h = Z && Z.sub ? Z.sub('Abilities').flatMap(a => a.all('Force_Healing_Ability'))[0] : null;
      const life =
        Z && Z.sub
          ? (Z.sub('Unit_Abilities_Data')
              .flatMap(a => a.all('Unit_Ability'))[0]
              ?.num('Expiration_Seconds', 18) ?? 18)
          : 18;
      const reach = h ? h.num('Heal_Range', 125) : 125,
        each = h ? -h.num('Heal_Amount', -1.8) : 1.8,
        every = h ? Math.max(0.05, h.num('Heal_Interval_In_Secs', 0.1)) : 0.1;
      after(world, sn('Spray_Time_In_Secs', 3), () => {
        let left = life,
          wait = 0,
          puff = 0;
        effect(world, dt => {
          if ((left -= dt) <= 0) return true;
          if ((puff -= dt) <= 0) {
            puff = 1.5;
            fx(world, ab.val('Spawned_Object_Type'), spot, 3);
          }
          if ((wait -= dt) > 0) return false;
          wait += every;
          for (const u of near(world, spot.x, spot.y, reach, u => !u.structure && !u.flies)) world.hurt(u, each);
          return false;
        });
      });
      break;
    }

    case 'STICKY_BOMB': {
      const P = db.type(sv('Grenade_Type'));
      after(world, sn('Grenade_Explode_Timer_In_Secs', 8), () => blast(world, P, t.x, t.y, side));
      break;
    }
    case 'UNTARGETED_STICKY_BOMB': {
      const x = c.x,
        y = c.y;
      after(world, ab.num('Bomb_Countdown_Seconds', 4), () => blast(world, def.blast, x, y, side));
      break;
    }
    case 'SELF_DESTRUCT':
      after(world, Math.max(0.1, def.duration), () => {
        if (c.dead) return;
        blast(world, def.blast, c.x, c.y, side);
        c.invulnUntil = 0;
        world.hurt(c, 1e9);
      });
      break;
    case 'SHIELD_FLARE':
      fx(world, sv('Owner_Particle_Effect'), c, c.aimZ);
      after(world, sn('Charge_Up_Seconds', 1), () => {
        const r = sn('Damage_Radius', 400);
        for (const u of near(world, c.x, c.y, r, foe)) world.hurt(u, sn('Max_Damage_Per_Victim', 275) * (1 - dist(u, c) / r));
      });
      break;

    case 'DEPLOY_TROOPERS': {
      const out = (q.deployed = (q.deployed || []).filter(s => s.members.length));
      const name = ab.val('Spawned_Object_Type'),
        S = db.type(name);
      const bones =
        c.inst && c.inst.bone
          ? ab
              .val('Owner_Attachment_Bone')
              .split(',')
              .map(b => c.inst.bone(b.trim()))
              .filter(Boolean)
          : [];
      if (!S || !bones.length) {
        Promise.resolve(world.spawn(name, c.x - Math.cos(c.heading) * 30, c.y - Math.sin(c.heading) * 30, c.heading, side)).then(s => {
          if (s) out.push(s);
        });
        break;
      }
      world.stop(q);
      c.rooted = true;
      c.path = [];
      const kinds = S.has('Company_Units') ? S.list('Company_Units') : [name];
      const saved = kinds.map(type => ({ type, x: c.x, y: c.y, h: c.heading, hp: Infinity }));
      const men = [],
        show = m => {
          m.scriptHidden = false;
          if (m.holder) m.holder.visible = true;
        };
      let phase = 'stop',
        until = 0,
        ready = false,
        wave = 0;
      Promise.resolve(world.spawn(name, c.x, c.y, c.heading, side, saved)).then(s => {
        ready = true;
        if (!s) return;
        out.push(s);
        s.members.forEach((m, i) => {
          m.rope = { from: c, bone: bones[i % bones.length], held: true, landing: false };
          m.scriptHidden = true;
          if (m.holder) m.holder.visible = false;
          men.push(m);
        });
        if (c.dead)
          for (const m of men) {
            m.rope.held = false;
            show(m);
          }
      });
      const play = K => (world.cast(c, K, 1e9) ? world.time + c.anim.anim.duration / (c.anim.speed || 1) : world.time);
      const ride = () => men.slice(wave * bones.length, (wave + 1) * bones.length);
      effect(world, () => {
        if (c.dead) {
          for (const m of men)
            if (m.rope) {
              m.rope.held = false;
              show(m);
            }
          return true;
        }
        if (phase === 'stop') {
          if (c.walking || c.stopping || (c.once && world.time < c.onceEnd)) return false;
          phase = 'drop';
          until = play('ROPE_DROP');
        }
        if (world.time < until) return false;
        if (phase === 'drop') {
          if (!ready) return false;
          phase = 'troops';
          until = play('TROOPDROP');
          for (const m of ride()) {
            show(m);
            world.cast(m, 'ROPESLIDE', 1e9, true);
          }
          return false;
        }
        if (phase === 'troops') {
          for (const m of ride()) if (m.rope) m.rope.held = false;
          wave++;
          if (ride().length) {
            phase = 'drop';
            return false;
          }
          phase = 'down';
        }
        if (phase === 'down') {
          if (men.some(m => m.rope && !m.dead)) return false;
          phase = 'lift';
          until = play('ROPE_LIFT');
          return false;
        }
        c.cast = 0;
        c.rooted = false;
        return true;
      });
      break;
    }
    case 'SUMMON':
      fx(world, sv('Target_Particle_Effect'), { x: tgt.x, y: tgt.y, z: world.groundZ(tgt.x, tgt.y) }, 4);
      after(world, sn('Creation_Delay_In_Seconds', 3.5), () => {
        sound(world, sv('SFXEvent_Unit_Summoned'), tgt);
        world.spawn(sv('Object_Type'), tgt.x, tgt.y, c.heading, side);
      });
      break;

    case 'CAPTURE_VEHICLE':
    case 'TACTICAL_BRIBE':
    case 'TARGETED_HACK': {
      fx(world, sv('Bribed_Effect'), t, t.aimZ + sn('Effect_Z_Offset', 0));
      if (kind === 'TACTICAL_BRIBE') {
        for (const u of t.squad.members) {
          u.bribed = true;
          fx(world, sv('Bribed_Effect_Small'), u, u.aimZ || 0);
        }
        const cloak = q.abilityState('STEALTH');
        if (cloak && cloak.active) finish(world, q, cloak);
      }
      sound(world, sv('SFXEvent_Success') || sv('SFXEvent_Activate'), t);
      setSide(world, t.squad, side);
      const copy = kind === 'CAPTURE_VEHICLE' ? db.type(t.type.str('Vehicle_Thief_Inside_Clone')) : null;
      const out = copy && landAbilities(copy).find(d => d.kind === 'EJECT_VEHICLE_THIEF');
      if (out && !t.thief) {
        t.thief = c;
        c.inside = t;
        c.path = [];
        c.target = null;
        if (c.holder) c.holder.visible = false;
        if (q.members.every(u => u.inside)) q.selected = false;
        t.abilityKinds.add(out.kind);
        if (!t.squad.abilityState(out.kind)) t.squad.abilities.push({ def: out, active: false, left: 0, cooldown: out.recharge });
        effect(world, () => {
          if (t.thief !== c) return true;
          if (!t.dead) {
            c.x = t.x;
            c.y = t.y;
            return false;
          }
          leave(world, t);
          return true;
        });
      }
      break;
    }
    case 'EJECT_VEHICLE_THIEF':
      if (c.thief) {
        leave(world, c);
        world.hurt(c, 1e9);
      }
      break;
    case 'AREA_EFFECT_HEAL':
      blast(world, def.blast, c.x, c.y, side);
      break;
    case 'MAXIMUM_FIREPOWER': {
      const P = db.type(ab.val('Projectile_Types_Override'));
      fx(world, sv('Owner_Particle_Effect'), c, c.aimZ);
      if (P && c.weapon && !c.fullPower) {
        c.fullPower = c.weapon;
        c.weapon = {
          ...c.weapon,
          proj: P,
          damage: P.num('Projectile_Damage', c.weapon.damage),
          damageType: P.str('Damage_Type') || c.weapon.damageType,
          speed: P.num('Max_Speed', 10) * FPS,
          cooldown: 0,
          left: 0,
          timer: 0,
          blastR: undefined,
          blastD: undefined,
          fall: undefined,
          lob: undefined
        };
      }
      c.target = t;
      world.attack(q, t.squad);
      break;
    }
    case 'PLACE_REMOTE_BOMB': {
      const bomb = db.type(sv('Bomb_Type'));
      if (!bomb) break;
      const P = db.type(bomb.list('Death_Explosions')[0]),
        x = tgt.x,
        y = tgt.y,
        life = bomb.num('Projectile_Max_Lifetime', 900);
      world.cast(c, sv('Toss_Anim').toUpperCase());
      after(world, sn('Spawn_Frame', 12) / FPS, () => {
        if (c.dead) return;
        const before = world.shots.length;
        const aim = { x, y, z: world.groundZ(x, y), aimZ: 0, hitRadius: 0, kind: 'INFANTRY', dead: false };
        world.fire(c, aim, {
          proj: bomb,
          damage: 0,
          damageType: '',
          speed: bomb.num('Max_Speed', 20) * FPS,
          pulses: 1,
          pulseDelay: 0,
          recharge: 0,
          cooldown: 0,
          left: 0,
          timer: 0,
          quiet: true
        });
        const shot = world.shots.length > before ? world.shots[world.shots.length - 1] : null;
        let air = 0,
          bx = x,
          by = y;
        if (shot) {
          shot.dud = true;
          shot.track = false;
          shot.target = { dead: true, x: 0, y: 0, hitRadius: 0 };
          air = shot.total / (shot.speed || 1);
          bx = shot.ax;
          by = shot.ay;
        }
        after(world, air, () =>
          lay(world, bomb, bx, by, side, u => {
            (q.bombs ||= []).push(u);
            const gone = world.time + life;
            effect(world, () => {
              if (u.dead) {
                blast(world, P, u.x, u.y, side);
                hurtOwn(world, bomb, P, u.x, u.y, side);
                q.bombs = (q.bombs || []).filter(b => b !== u);
                return true;
              }
              if (world.time >= gone) world.hurt(u, 1e9);
              return false;
            });
          })
        );
      });
      break;
    }
    case 'DETONATE_REMOTE_BOMB':
      for (const u of (q.bombs || []).slice()) if (!u.dead) world.hurt(u, 1e9);
      break;
    case 'PROXIMITY_MINES': {
      const mine = db.type(sv('Mine_Type')),
        n = Math.max(1, sn('Number_Of_Mines', 6)),
        ring = ab.num('Area_Effect_Decal_Distance', 50) * 0.5;
      if (!mine) break;
      const P = db.type(mine.list('Death_Explosions')[0]),
        trigger = sn('Trigger_Radius', 30),
        armAt = world.time + sn('Activation_Time_In_Seconds', 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2,
          mx = tgt.x + Math.cos(a) * ring,
          my = tgt.y + Math.sin(a) * ring;
        lay(world, mine, mx, my, side, u => {
          {
            let armed = false;
            effect(world, () => {
              if (u.dead) {
                blast(world, P, u.x, u.y, side);
                return true;
              }
              if (!armed) {
                if (world.time < armAt) return false;
                armed = true;
                sound(world, sv('Activate_SFX'), u);
              }
              if (near(world, u.x, u.y, trigger, o => !o.mine && !o.structure && !world.ally(o.side, side)).length) world.hurt(u, 1e9);
              return false;
            });
          }
        });
      }
      break;
    }
    case 'TARGETED_REPAIR':
      t.health = t.maxHealth;
      break;

    case 'STEALTH':
    case 'FORCE_CLOAK':
      for (const u of q.members)
        if (u.abilityKinds.has(kind)) {
          u.cloaked = true;
          u.target = null;
          cloakLook(u, true, world);
        }
      break;
    case 'MISSILE_SHIELD':
      if (yes(ab.val('Disable_Movement'))) {
        c.rooted = true;
        c.path = [];
        c.setup = true;
        world.cast(c, 'DEPLOY');
      }
      break;
    case 'FORCE_SIGHT':
      world.revealUntil[side] = world.time + def.duration;
      break;

    case 'BERSERKER': {
      const speed = sn('Berserker_Speed', 5) * FPS,
        reach = sn('Berserker_Damage_Range', 12),
        dmg = sn('Berserker_Damage', 35),
        struck = new Map();
      let left = def.duration,
        goal = t;
      c.path = [];
      effect(world, dt => {
        if (c.dead || (left -= dt) <= 0) return true;
        if (!goal || goal.dead) goal = near(world, c.x, c.y, def.range || 120, applies).sort((a, b) => dist(a, c) - dist(b, c))[0] || null;
        if (goal) {
          const d = dist(goal, c),
            go = Math.min(d, speed * dt),
            a = Math.atan2(goal.y - c.y, goal.x - c.x),
            nx = c.x + Math.cos(a) * go,
            ny = c.y + Math.sin(a) * go;
          c.heading = a;
          c.path = [];
          if (world.isOpen(nx, ny)) {
            c.x = nx;
            c.y = ny;
          }
        }
        for (const u of near(world, c.x, c.y, reach + u0(c), applies))
          if ((struck.get(u) || 0) <= world.time) {
            struck.set(u, world.time + 0.5);
            world.hurt(u, dmg);
            if (u === goal && u.dead) goal = null;
          }
        return false;
      });
      break;
    }

    case 'SABER_THROW': {
      const P = db.type(sv('Saber_Name')),
        dmg = P ? P.num('Projectile_Damage', 13) : 13,
        wide = P ? P.num('Projectile_Stun_Radius', 23) : 23,
        type = P ? P.str('Damage_Type') : '';
      const blade = { x: c.x, y: c.y, z: c.z + c.aimZ },
        speed = 220,
        cut = new Map();
      let back = false,
        goal = { x: t.x, y: t.y };
      effect(world, dt => {
        const to = back ? c : goal,
          d = dist(to, blade),
          go = Math.min(d, speed * dt);
        if (d > 0.01) {
          blade.x += ((to.x - blade.x) / d) * go;
          blade.y += ((to.y - blade.y) / d) * go;
        }
        blade.z = world.groundZ(blade.x, blade.y) + c.aimZ;
        beam(world, { x: blade.x - 4, y: blade.y - 4, z: blade.z }, { x: blade.x + 4, y: blade.y + 4, z: blade.z }, dt * 2, 0x66ff7a);
        for (const u of near(world, blade.x, blade.y, wide, foe))
          if (cut.get(u) !== back) {
            cut.set(u, back);
            world.hurt(u, dmg * db.damageMod(type, u.armor));
          }
        if (d - go < 1) {
          if (back || c.dead) return true;
          back = true;
        }
        return false;
      });
      break;
    }

    case 'INFECTION': {
      const dps = sn('Damage_Per_Second', 2),
        secs = sn('Duration_Of_Infection', 30),
        reach = sn('Distance_To_Infect', 70),
        pass = sn('Seconds_To_Infect', 2);
      const infect = (u, left) => {
        if (u.infected || u.dead) return;
        u.infected = true;
        let spread = pass;
        fx(world, sv('Infection_Particle'), u, u.aimZ);
        effect(world, dt => {
          if (u.dead || (left -= dt) <= 0) {
            u.infected = false;
            return true;
          }
          world.hurt(u, dps * dt);
          if ((spread -= dt) <= 0) {
            spread = pass;
            for (const o of near(world, u.x, u.y, reach, o => o.side === u.side && o !== u && !o.structure && fits(o, def.cats, [])))
              infect(o, left);
          }
          return false;
        });
      };
      infect(t, secs);
      break;
    }
    default:
  }
}
const u0 = c => c.hitRadius || 0;

export function tickAbilities(world, dt) {
  const fxs = world.effects;
  let k = 0;
  for (let i = 0; i < fxs.length; i++) if (!fxs[i](dt)) fxs[k++] = fxs[i];
  fxs.length = k;
  if (world.beams.length) world.beams = world.beams.filter(b => b.until > world.time);
  if (world.pings.length) world.pings = world.pings.filter(p => p.until > world.time);
  if ((world.autoTimer = (world.autoTimer ?? 0.5) - dt) <= 0) {
    world.autoTimer = 0.5;
    for (const q of world.squads)
      if (q.members.length && !q.dead && world.isHumanSide?.(q.side) && q.abilities.some(st => st.auto)) autoAbilities(world, q);
  }
  for (const q of world.squads) {
    if (!q.abilities.length || !q.members.length) continue;
    for (const st of q.abilities) {
      if (st.pend && !q.arriving && !q.forming && q.members.some(u => !u.inside && u.holder)) {
        st.pend = false;
        useAbility(world, q, st.def.kind);
      }
      if (st.cooldown > 0) st.cooldown -= dt;
      if (!st.active || st.def.toggle) continue;
      const kind = st.def.kind;
      if ((kind === 'STEALTH' || kind === 'FORCE_CLOAK') && q.foe) {
        finish(world, q, st);
        continue;
      }
      if ((kind === 'MISSILE_SHIELD' || kind === 'LASER_DEFENSE') && world.shots.length) screen(world, q, st);
      if (FORCE.has(kind)) {
        const c = casterOf(q, kind);
        if (c && c.noForce > world.time) {
          if (q.busy) q.busy = false;
          finish(world, q, st);
          continue;
        }
      }
      if ((st.left -= dt) <= 0) finish(world, q, st);
    }
    const p = q.pending;
    if (p) {
      const st = q.abilityState(p.kind),
        c = st && casterOf(q, p.kind);
      if (!c || cantTarget(world, q, st.def, p.tgt)) q.pending = null;
      else if (dist(c, p.tgt.unit || p.tgt) <= st.def.range) {
        q.pending = null;
        world.stop(q);
        useAbility(world, q, p.kind, p.tgt);
      } else if (!q.members.some(u => u.path.length)) q.pending = null;
    }
    if (q.hunt && !q.foe && !q.march && !q.members.some(u => u.path.length || u.target) && world.time >= (q.huntAt || 0)) {
      q.huntAt = world.time + 1;
      const lead = q.members[0],
        foes = lead
          ? world.units.filter(e => !e.dead && e.side >= 0 && !e.inside && !e.mine && e.x !== undefined && world.targetEnemy(lead, e))
          : [];
      if (foes.length) {
        const eyes = world.units.filter(o => !o.dead && world.ally(o.side, lead.side));
        const seen = foes.filter(
          e =>
            !e.cloaked && eyes.some(o => (o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= (o.sight ??= o.type.num('Land_FOW_Reveal_Range', 150)) ** 2)
        );
        const pick = seen.length ? seen : foes,
          prey = pick[Math.floor(simRandom() * pick.length)];
        const x = prey.x + 30 + simRandom() * 370,
          y = prey.y + 30 + simRandom() * 370;
        const o = world.nearestOpen(x, y, Math.max(...q.members.map(u => u.need || 1))) || world.nearestOpen(prey.x, prey.y);
        if (o) {
          q.post = null;
          q.legs = null;
          world.order(q, o.x, o.y);
          q.march = { x: o.x, y: o.y };
        }
      }
    }
  }
}

function lay(world, type, x, y, side, then) {
  Promise.resolve(world.spawn(type.name, x, y, 0, side))
    .then(() => {
      for (const u of world.units.filter(o => !o.dead && o.type === type && !o.mine && Math.hypot(o.x - x, o.y - y) < 6)) {
        u.mine = true;
        u.squad.noAI = true;
        u.squad.mine = true;
        u.rooted = true;
        then(u);
      }
    })
    .catch(() => {});
}

function hurtOwn(world, bomb, P, x, y, side) {
  const amount = bomb.num('Friendly_Damage_Amount', 0),
    r = P ? P.num('Projectile_Blast_Area_Range', 0) : 0;
  if (amount > 0 && r > 0)
    for (const u of near(world, x, y, r, o => world.ally(o.side, side) && !o.structure && !o.mine)) world.hurt(u, amount);
}

function leave(world, v) {
  const c = v.thief;
  v.thief = null;
  if (!c || c.dead) return;
  const o = world.nearestOpen(v.x + v.hitRadius + 12, v.y, c.need || 1) || world.nearestOpen(v.x, v.y) || v;
  c.inside = null;
  c.x = o.x;
  c.y = o.y;
  c.path = [];
  c.target = null;
  if (c.holder) c.holder.visible = true;
}

function screen(world, q, st) {
  const def = st.def,
    c = casterOf(q, def.kind);
  if (!c) return;
  const r = def.spec
    ? def.spec.num('Protection_Radius', 0) || def.node.num('Effective_Radius', 150)
    : def.node.num('Effective_Radius', 150);
  const kinds =
    def.spec && def.spec.val('Projectile_Types_Targeted')
      ? names(def.spec.val('Projectile_Types_Targeted'))
      : ['MISSILE', 'ROCKET', 'MPTL_ROCKET'];
  for (const s of world.shots) {
    if (s.done || s.from.side === q.side || Math.hypot(s.x - c.x, s.y - c.y) > r) continue;
    if (!kinds.includes(s.w.proj.str('Projectile_Category').toUpperCase())) continue;
    beam(world, c, { x: s.x, y: s.y, z: s.z }, 0.12, 0x4466ff);
    s.left = 0;
    s.dud = true;
    s.target = { dead: true, x: 0, y: 0, hitRadius: 0 };
  }
}

export function autoAbilities(world, q) {
  const fighting = q.members.find(u => u.target && !u.target.dead && u.target.x !== undefined),
    victim = fighting?.target;
  if (!victim) return;
  const ready = [];
  for (const st of q.abilities) {
    const def = st.def;
    if (!st.auto || st.active || st.cooldown > 0 || !def.spec || def.aim === 'friend') continue;
    const c = casterOf(q, def.kind);
    if (!c) continue;
    if (
      def.aim !== 'none' &&
      def.aim !== 'point' &&
      (victim.side === undefined || world.ally(victim.side, q.side) || cantTarget(world, q, def, { unit: victim }))
    )
      continue;
    if (def.aim !== 'none' && def.range && dist(c, victim) > def.range + (victim.hitRadius || 0)) continue;
    const chance = def.spec.val('Activation_Chance').trim() === '' ? 1 : def.spec.num('Activation_Chance', 1);
    if (!(chance > 0) || simRandom() > chance) continue;
    ready.push(st);
  }
  if (!ready.length) return;
  const def = ready[Math.floor(simRandom() * ready.length)].def;
  useAbility(world, q, def.kind, def.aim === 'none' ? null : def.aim === 'point' ? { x: victim.x, y: victim.y } : { unit: victim });
}

export function aiAbilities(world, q, bribeScore = null) {
  const fighting = q.members.find(u => u.target && !u.target.dead);
  for (const st of q.abilities) {
    const def = st.def;
    if (def.kind === 'SELL' || def.kind === 'UNLOAD') continue;
    const c = casterOf(q, def.kind);
    if (!c) continue;
    if (def.kind === 'DEPLOY') {
      const want = !!world.nearestFoe(c, world.units, c.range);
      if (want !== st.active && !(want && c.path.length)) useAbility(world, q, def.kind);
      continue;
    }
    if (def.kind === 'HUNT') {
      if (!st.active) useAbility(world, q, def.kind);
      continue;
    }
    if (def.kind === 'PLACE_REMOTE_BOMB') {
      if (!st.active && st.cooldown <= 0 && fighting && dist(c, fighting.target) <= def.range && dist(c, fighting.target) >= def.minRange)
        useAbility(world, q, def.kind, { x: fighting.target.x, y: fighting.target.y });
      continue;
    }
    if (def.kind === 'DETONATE_REMOTE_BOMB') {
      const due = (q.bombs || []).some(
        b =>
          !b.dead &&
          near(world, b.x, b.y, 150, o => !o.mine && !o.inside && !world.ally(o.side, q.side)).reduce(
            (n, o) => n + o.type.num('AI_Combat_Power', 50),
            0
          ) >= 200
      );
      if (due) useAbility(world, q, def.kind);
      continue;
    }
    if (def.kind === 'TACTICAL_BRIBE') {
      if (st.active || st.cooldown > 0) continue;
      let best = null;
      for (const u of world.units) {
        if (u.dead || u.cloaked || world.ally(u.side, q.side) || dist(u, c) > def.range || cantTarget(world, q, def, { unit: u })) continue;
        const cost = bribeCost(world, q, u);
        if (!(cost > 0 && cost < world.credits[q.side])) continue;
        const score = bribeScore?.(u) ?? u.squad.members.reduce((n, o) => n + o.type.num('AI_Combat_Power', 0), 0);
        if (!best || score > best.score) best = { u, score };
      }
      if (best) useAbility(world, q, def.kind, { unit: best.u });
      continue;
    }
    if (def.toggle || st.active || st.cooldown > 0 || !fighting) continue;
    if (def.aim === 'none') {
      if (
        /STEALTH|FORCE_CLOAK|SELF_DESTRUCT|DEPLOY_TROOPERS|FORCE_SIGHT|EJECT_VEHICLE_THIEF/.test(def.kind) &&
        def.kind !== 'DEPLOY_TROOPERS'
      )
        continue;
      if (
        def.kind === 'AREA_EFFECT_HEAL' &&
        !near(
          world,
          c.x,
          c.y,
          def.blast ? def.blast.num('Projectile_Instant_Heal_Radius', 100) : 100,
          u => world.ally(u.side, q.side) && !u.structure && u.health < u.maxHealth * 0.7
        ).length
      )
        continue;
      useAbility(world, q, def.kind);
    } else if (def.aim === 'enemy') {
      const t = world.units
        .filter(
          u => !u.dead && !world.ally(u.side, q.side) && !u.cloaked && dist(u, c) <= def.range && !cantTarget(world, q, def, { unit: u })
        )
        .sort((a, b) => dist(a, c) - dist(b, c))[0];
      if (t) useAbility(world, q, def.kind, { unit: t });
    }
  }
}
