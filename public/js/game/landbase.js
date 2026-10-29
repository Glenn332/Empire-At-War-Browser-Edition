import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadModel } from '../model.js';
import { buildsFor, isUpgrade, landUnit } from './land.js';
import { FORCE, blast } from './landabilities.js';
import { simRandom } from './simrandom.js';
import { categoryOf } from './projflight.js';

const yes = s => /^(yes|true)$/i.test(String(s || '').trim());
const abilityOf = (type, tag) => (type.sub ? type.sub('Abilities').flatMap(a => a.all(tag)) : []);

const words = s => String(s || '').split(/[\s,|]+/).filter(Boolean).map(x => x.toUpperCase());
function specialsOf(type) {
  const out = [];
  const read = (tag, kind) => { for (const a of abilityOf(type, tag)) out.push({
    kind, a, min: a.num('Activation_Min_Range', 0), max: a.num('Activation_Max_Range', 50), chance: a.num('Activation_Chance', 1),
    cats: words(a.val('Applicable_Unit_Categories')), types: words(a.val('Applicable_Unit_Types')), not: words(a.val('Excluded_Unit_Types')),
    amount: a.num('Damage_Amount', 0), part: a.num('Damage_Percentage', 0),
  }); };
  read('Earthquake_Attack_Ability', 'quake'); read('Eat_Attack_Ability', 'eat'); read('Arc_Sweep_Attack_Ability', 'sweep');
  return out.length ? out : false;
}
const suitsSpecial = (S, t) => {
  const name = t.type.name.toUpperCase();
  if (S.not.includes(name)) return false;
  if (S.types.includes(name)) return true;
  if (!S.cats.length) return !S.types.length;
  const mask = (t.cats ||= words(t.type.str('CategoryMask')));
  return S.cats.includes('ALL') || S.cats.some(c => mask.includes(c) || (c === 'STRUCTURE' && t.structure));
};
const _bone = new THREE.Vector3();

export function specialAttack(world, u, t, dt) {
  const list = (u.specials ??= specialsOf(u.type));
  if (!list) return false;
  const A = u.special;
  if (A) {
    if (A.kind !== 'quake') { if (world.time < A.until) return true; u.special = null; return false; }
    if (t !== A.t || t.dead) { u.special = null; return false; }
    for (A.acc += dt; A.acc >= A.every; A.acc -= A.every) {
      world.hurt(t, t.maxHealth * A.S.part + A.S.amount, u);
      if (world.onFx && A.fx) world.onFx(A.fx, t.x + (Math.random() - 0.5) * t.hitRadius, t.y + (Math.random() - 0.5) * t.hitRadius, t.z);
    }
    return true;
  }
  if (world.time < (u.specialAt || 0)) return false;
  u.specialAt = world.time + Math.max(0.5, u.weapon ? u.weapon.recharge : 1);
  const d = Math.hypot(t.x - u.x, t.y - u.y) - (t.structure ? t.hitRadius || 0 : 0);
  for (const S of list) {
    if (S.kind === 'quake' || d < S.min || d > S.max || !suitsSpecial(S, t) || simRandom() >= S.chance) continue;
    const a = S.a, rate = a.num('Attack_Animation_Speedup', 1) || 1, FPS = 30;
    if (S.kind === 'quake') {
      u.special = { kind: 'quake', S, t, acc: 0, every: Math.max(0.05, a.num('Damage_Interval_In_Secs', 0.4)), fx: a.val('Target_Particle_Effect').trim() };
      if (world.onSound) world.onSound(a.val('SFXEvent_Activate').trim(), u.x, u.y);
      return true;
    }
    const ok = world.cast(u, a.val('Attack_Animation').trim().toUpperCase() || 'ATTACK', 0, false, rate, Math.max(0, a.num('Attack_Animation_Subindex', 0)));
    const secs = ok ? u.cast - world.time : 2;
    u.special = { kind: S.kind, until: world.time + secs };
    if (S.kind === 'eat') {
      const grab = world.time + a.num('Attachment_Frame', 14) / FPS / rate, gone = world.time + a.num('Target_Destruction_Frame', 110) / FPS / rate;
      const bone = u.inst && u.inst.bone ? u.inst.bone(a.val('Owner_Attachment_Bone').trim()) : null;
      let held = false;
      world.effects.push(() => {
        if (u.dead || t.dead) { if (held && !t.dead) { t.lift = 0; t.stunUntil = 0; } return true; }
        if (world.time < grab) return false;
        if (!held) { held = true; t.path = []; t.target = null; t.stunUntil = gone + 1; world.cast(t, a.val('Target_Grabbed_Animation').trim().toUpperCase()); }
        if (bone) { world.boneAt(u, bone, _bone); t.x = _bone.x; t.y = _bone.y; t.lift = Math.max(0, _bone.z - world.groundZ(_bone.x, _bone.y)); }
        if (world.time < gone) return false;
        world.hurt(t, t.maxHealth * S.part + S.amount + 1e6, u, 'EATEN');
        t.lieFor = 0; t.vanish = true; if (t.holder) t.holder.visible = false;
        u.health = Math.min(u.maxHealth, u.health + a.num('Health_Per_Victim', 0));
        return true;
      });
    } else {
      const half = a.num('Arc_Width_In_Degrees', 120) * Math.PI / 360, r0 = a.num('Arc_Min_Range', 0), r1 = a.num('Arc_Max_Range', 30);
      const from = world.time + a.num('Begin_Applying_Damage_Frame', 0) / FPS / rate, over = Math.max(0.01, a.num('Damage_Sweep_Time_In_Secs', 0.2) / rate);
      const rtl = /^(yes|true)$/i.test(a.val('Apply_Damage_Right_To_Left').trim()), hit = new Set(), face = u.heading;
      world.effects.push(() => {
        if (u.dead) return true;
        if (world.time < from) return false;
        const k = Math.min(1, (world.time - from) / over), edge = rtl ? -half + 2 * half * k : half - 2 * half * k;
        for (const o of world.units) {
          if (o.dead || o.inside || hit.has(o) || o === u || world.ally(o.side, u.side) || !suitsSpecial(S, o)) continue;
          const dx = o.x - u.x, dy = o.y - u.y, dd = Math.hypot(dx, dy);
          if (dd < r0 || dd > r1 + (o.hitRadius || 0)) continue;
          let rel = Math.atan2(dy, dx) - face; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
          if (Math.abs(rel) > half || (rtl ? rel > edge : rel < edge)) continue;
          hit.add(o);
          world.hurt(o, o.maxHealth * S.part + S.amount, u, 'FW_DIE');
        }
        return k >= 1;
      });
    }
    return true;
  }
  return false;
}

function endQuake(world, u) {
  if (!u.quake) return;
  u.quake = null;
  u.cast = 0;
  if (!u.dead) world.cast(u, 'FB_RELEASE');
}
function tickQuakes(world, step) {
  for (const u of world.units) {
    if (u.dead || u.structure || u.inside || u.clash) continue;
    const list = (u.specials ??= specialsOf(u.type));
    const S = list && list.find(x => x.kind === 'quake');
    if (!S) continue;
    const Q = u.quake;
    const foe = u.squad.foe && u.squad.foe.structure ? u.squad.foe.members.find(m => !m.dead) : null;
    const reach = t => { const d = Math.hypot(t.x - u.x, t.y - u.y) - (t.hitRadius || 0); return d >= S.min - (t.hitRadius || 0) && d <= S.max; };
    if (foe && u.path.length && reach(foe)) u.path = [];
    if (u.path.length || (u.target && !u.target.structure) || u.stunUntil > world.time) { endQuake(world, u); continue; }
    let t = Q && !Q.t.dead && reach(Q.t) ? Q.t : foe && reach(foe) ? foe : null;
    if (!t && !u.squad.foe) t = world.units.find(o => o.structure && !o.dead && !world.ally(o.side, u.side) && suitsSpecial(S, o) && reach(o)) || null;
    if (!t || !suitsSpecial(S, t)) { endQuake(world, u); continue; }
    if (!Q || Q.t !== t) {
      if (simRandom() >= S.chance) continue;
      u.quake = { t, acc: 0, phase: '' };
      if (world.onSound) world.onSound(S.a.val('SFXEvent_Activate').trim(), u.x, u.y);
    }
    const q = u.quake, every = Math.max(0.05, S.a.num('Damage_Interval_In_Secs', 0.4)), fx = S.a.val('Target_Particle_Effect').trim();
    u.heading = Math.atan2(t.y - u.y, t.x - u.x);
    if (!q.phase) { u.cast = 0; if (world.cast(u, 'FB_ATTACK')) q.phase = 'in'; else world.setAnim(u, 'attack'); }
    else if (q.phase === 'in' && world.time >= u.cast) { u.cast = 0; if (world.cast(u, 'FB_HOLD', 1e6, true)) q.phase = 'hold'; }
    for (q.acc += step; q.acc >= every; q.acc -= every) {
      world.hurt(t, t.maxHealth * S.part + S.amount, u);
      const r = (t.hitRadius || 20) * 0.6;
      if (world.onFx && fx) world.onFx(fx, t.x + (Math.random() - 0.5) * r, t.y + (Math.random() - 0.5) * r, t.z);
    }
    if (t.dead) endQuake(world, u);
  }
}

function tickCages(world) {
  for (const g of world.units) {
    if (g.dead || g.unpowered || !(g.cage ??= /DISABLE_FORCE_ABILITIES/i.test(g.type.str('LandBehavior') + ' ' + g.type.str('Behavior')))) continue;
    const r = g.type.num('Disable_Force_Abilities_Range', 0);
    for (const u of world.units) {
      if (u.dead || u.structure || !u.abilityKinds || Math.hypot(u.x - g.x, u.y - g.y) > r) continue;
      if (!(u.usesForce ??= [...u.abilityKinds].some(k => FORCE.has(k)))) continue;
      u.noForce = world.time + 0.6;
      if (world.onFx && world.time >= (u.noForceFx || 0)) { u.noForceFx = world.time + 2.5; world.onFx('Ysalamiri_Force_Drain_Effect', u.x, u.y, u.z + (u.aimZ || 0)); }
    }
  }
}

const RELAX = 2;
function presenceOf(type) {
  if (type._presence !== undefined) return type._presence;
  const map = new Map();
  let anim = '';
  for (const tok of type.list('Presence_Induced_Animations')) { if (db.type(tok)) { if (anim) map.set(db.type(tok), anim); } else anim = tok.trim().toUpperCase(); }
  return (type._presence = map.size ? map : null);
}
function tickPresence(world) {
  for (const g of world.units) {
    const T = g.dead ? (g.gone ? null : g.deathClone) : g.type;
    if (!T || !(T._imposing ??= /IMPOSING_PRESENCE/i.test(T.str('LandBehavior') + ' ' + T.str('Behavior')))) continue;
    const r = T.num('Presence_Range', 0);
    if (!(r > 0)) continue;
    for (const u of world.units) {
      if (u.dead || u === g || !u.foot || Math.abs(u.x - g.x) > r || Math.abs(u.y - g.y) > r) continue;
      const map = presenceOf(u.type), anim = map && map.get(T);
      if (!anim) continue;
      if (u.presenceAnim !== anim || !(u.presenceUntil > world.time)) { u.presenceAnim = anim; if (u.animKind === 'idle') u.animKind = ''; }
      u.presenceUntil = world.time + RELAX;
    }
  }
}

const _still = new THREE.Vector2(0, 0);
function looksOf(u) {
  const t = u.type, flags = t.str('LandBehavior') + ' ' + t.str('Behavior'), out = {};
  if (/TREAD_SCROLL/i.test(flags) && u.inst && u.inst.mesh) {
    const treads = [];
    for (const name of ['TREAD_L', 'TREAD_R']) {
      const g = u.inst.mesh(name);
      if (!g) continue;
      const at = new THREE.Vector2(), tr = { meshes: [], at, side: 0 };
      g.traverse(o => {
        if (!o.isMesh || !o.material || !o.material.uniforms || !o.material.uniforms.uvScroll) return;
        if (o.geometry && o.geometry.boundingBox && u.holder) { u.holder.updateWorldMatrix(true, true); tr.side = u.holder.worldToLocal(o.localToWorld(o.geometry.boundingBox.getCenter(new THREE.Vector3()))).x; }
        const before = o.onBeforeRender, after = o.onAfterRender;
        o.onBeforeRender = function (...x) { before.apply(this, x); this.material.uniforms.uvScroll.value = at; this.material.uniformsNeedUpdate = true; };
        o.onAfterRender = function (...x) { after.apply(this, x); this.material.uniforms.uvScroll.value = _still; this.material.uniformsNeedUpdate = true; };
        tr.meshes.push(o);
      });
      if (tr.meshes.length) treads.push(tr);
    }
    if (treads.length) out.tread = { treads, rate: t.num('Tread_Scroll_Rate', 0), x: u.x, y: u.y, h: u.heading };
  }
  if (/HOLSTER_WEAPON/i.test(flags) && u.inst && u.inst.bone) {
    const bone = u.inst.bone(t.str('Holster_Weapon_Bone_Name')), v = k => { const a = t.list(k).map(parseFloat); return new THREE.Vector3(a[0] || 0, a[1] || 0, a[2] || 0); };
    if (bone) out.holster = { bone, drawn: v('Holster_Drawn_Bone_Translation'), away: v('Holster_Holstered_Bone_Translation'), over: Math.max(0.01, t.num('Holster_Transition_Time_In_Secs', 0.2)),
      min: t.num('Holster_Minimum_Drawn_Time_In_Secs', 15), k: 1, want: 1, needed: -1e9, base: new THREE.Vector3(), out: new THREE.Vector3(NaN, 0, 0), quiet: t.bool('Holster_Disable_Engine_Loops') };
  }
  return out.tread || out.holster ? out : false;
}
const _off = new THREE.Vector3();
export function looks(world, u, dt) {
  const L = (u.looksOf ??= looksOf(u));
  if (!L) return;
  const T = L.tread;
  if (T) {
    const c = Math.cos(u.heading), s = Math.sin(u.heading), scale = u.holder ? u.holder.scale.x : 1;
    const fwd = (u.x - T.x) * c + (u.y - T.y) * s;
    let turn = u.heading - T.h; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    T.x = u.x; T.y = u.y; T.h = u.heading;
    for (const tr of T.treads) { let v = tr.at.x + (fwd - turn * tr.side * scale) * T.rate; v -= Math.floor(v); tr.at.x = v; }
  }
  const H = L.holster;
  if (H) {
    const sq = u.squad, busy = !!u.target || !!u.clash || !!u.quake || u.cast > world.time || (sq && sq.abilities.some(a => a.active && !a.def.toggle));
    if (busy) H.needed = world.time;
    const want = world.time - H.needed > H.min ? 1 : 0;
    if (want !== H.want) { H.want = want; if (world.onSound) world.onSound(u.type.str(want ? 'SFXEvent_Holster_Weapon' : 'SFXEvent_Draw_Weapon'), u.x, u.y); }
    H.k += Math.max(-dt / H.over, Math.min(dt / H.over, H.want - H.k));
    u.holstered = H.quiet && H.k > 0.5;
    const b = H.bone;
    if (!b.position.equals(H.out)) H.base.copy(b.position);
    b.position.copy(H.base).add(_off.copy(H.drawn).lerp(H.away, H.k));
    H.out.copy(b.position);
    if (u.inst.syncFromBones) u.inst.syncFromBones();
  }
}

function tickAmbient(world, step) {
  for (const u of world.units) {
    if (u.dead || u.inside || u.structure || !u.path || !u.path.length) continue;
    const t = u.type;
    if (!(u.ambient ??= /AMBIENT_SFX/i.test(t.str('LandBehavior') + ' ' + t.str('Behavior')) && t.str('SFXEvent_Ambient_Moving') ? { left: Math.random() * t.num('SFXEvent_Ambient_Moving_Max_Delay_Seconds', 10) } : false)) continue;
    if ((u.ambient.left -= step) > 0) continue;
    const lo = t.num('SFXEvent_Ambient_Moving_Min_Delay_Seconds', 5), hi = Math.max(lo, t.num('SFXEvent_Ambient_Moving_Max_Delay_Seconds', 10));
    u.ambient.left = lo + Math.random() * (hi - lo);
    if (world.onSound && u.seen !== false) world.onSound(t.str('SFXEvent_Ambient_Moving'), u.x, u.y);
  }
}

function tickGravity(world) {
  const fields = world.units.filter(u => !u.dead && !u.unpowered && (u.gravField ??= /GRAVITY_CONTROL_FIELD/i.test(u.type.str('LandBehavior') + ' ' + u.type.str('Behavior'))));
  for (const u of world.units) {
    if (u.dead || u.structure || !(u.gravHit ??= u.type.bool('Is_Affected_By_Gravity_Control_Field'))) continue;
    let slow = 0, fx = '';
    for (const g of fields) {
      if (world.ally(g.side, u.side) || Math.hypot(g.x - u.x, g.y - u.y) > g.type.num('Gravity_Control_Field_Range', 0)) continue;
      const s = g.type.num('Gravity_Control_Field_Slow_Fraction', 0);
      if (s > slow) { slow = s; fx = g.type.str('Gravity_Control_Field_Effect'); }
    }
    u.gravity = 1 - Math.min(0.95, slow);
    if (slow > 0 && fx && world.onFx && world.time >= (u.gravFxAt || 0)) { u.gravFxAt = world.time + 2; world.onFx(fx, u.x, u.y, u.z + (u.aimZ || 0) * 0.5); }
  }
}

export function equip(u) {
  const t = u.type;
  const r = /BASE_SHIELD/i.test(t.str('LandBehavior')) && !t.bool('Base_Shield_Always_Off') ? t.num('Base_Shield_Radius', 0) : 0;
  u.dome = r > 0 ? { r, color: t.str('Shield_Normal_Color'), colors: [t.str('Shield_Normal_Color'), t.str('Shield_Upgraded_Color') || t.str('Shield_Normal_Color')], powered: t.bool('Shield_Requires_Base_Power', true) } : null;
  const dl = abilityOf(t, 'Drain_Life_Ability')[0];
  u.drain = dl && /special_attack|automatic/i.test(dl.val('Activation_Style')) ? {
    dps: dl.num('Damage_Per_Second', 5), r: dl.num('Drain_Radius', 200), most: Math.max(1, dl.num('Max_Drain_Victims', 4)), heal: yes(dl.val('Should_Heal')),
    cats: dl.val('Applicable_Unit_Categories').split(/[\s,|]+/).filter(Boolean).map(c => c.toUpperCase()), effect: dl.val('Drain_Effect_Name'), from: dl.val('Drain_Source_Bone_Name'), to: dl.val('Drain_Target_Bone_Name'),
    sfx: dl.val('SFXEvent_Activate'), links: new Map(),
  } : null;
  u.needsPower = /POWERED/i.test(t.str('Behavior') + ' ' + t.str('LandBehavior'));
  u.power = abilityOf(t, 'Base_Power_Ability').length > 0;
  u.noReinforce = t.num('Reinforcement_Prevention_Radius', 0);
  u.noBomb = t.num('Bombing_Run_Prevention_Radius', 0);
  hostOf(u, t);
  if (!/CanContainGarrison/i.test(t.str('Property_Flags'))) u.slots = 0;
  u.relevant = t.str('Victory_Relevant') ? t.bool('Victory_Relevant') : true;
}

export function shieldsUp(world) {
  const out = [];
  for (const u of world.units) {
    if (!u.dome || u.dead) continue;
    u.dome.on = !u.dome.powered || world.units.some(x => x.power && !x.dead && world.ally(x.side, u.side));
    u.dome.strong = world.teamSides(u.side).some(s => [...world.owned[s]].some(n => { const t = db.type(n); return t && abilityOf(t, 'Battlefield_Modifier_Ability').some(a => yes(a.val('Base_Shield_Upgrade'))); }));
    u.dome.color = u.dome.strong ? u.dome.colors[1] : u.dome.colors[0];
    if (u.dome.on !== u.dome.was) {
      u.dome.was = u.dome.on;
      world.playOnce(u, u.type.str(u.dome.on ? 'Shield_On_Anim' : 'Shield_Off_Anim'), true);
    }
    if (u.dome.on) out.push({ x: u.x, y: u.y, r: u.dome.r, side: u.side, strong: u.dome.strong });
  }
  return out;
}

export function shieldStops(world, u, ax, ay, dx, dy, w = u.weapon) {
  const energy = /LASER|ION|^$|DEFAULT/i.test(w.proj.str('Projectile_Category'));
  for (const s of world.shields || []) {
    if (!energy && !s.strong) continue;
    if (world.ally(s.side, u.side) || Math.hypot(ax - s.x, ay - s.y) >= s.r || Math.hypot(u.x - s.x, u.y - s.y) <= s.r) continue;
    const ox = u.x - s.x, oy = u.y - s.y, a = dx * dx + dy * dy, b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - s.r * s.r, disc = b * b - 4 * a * c;
    if (a > 0 && disc >= 0) return Math.max(1, (-b - Math.sqrt(disc)) / (2 * a));
  }
  return -1;
}

const bombTicket = (world, side) => [...world.owned[side]].find(n => { const t = db.type(n); return t && abilityOf(t, 'Battlefield_Modifier_Ability').some(a => yes(a.val('Enable_Bombing_Runs'))); });
export const canBomb = (world, side) => !!bombTicket(world, side) && !world.bombing.some(b => b.side === side);

export function bombingRun(world, side, x, y) {
  const ticket = bombTicket(world, side);
  if (!ticket) return 'No bombing run available';
  if (world.units.some(u => u.structure && !u.dead && !world.ally(u.side, side) && u.noBomb > 0 && Math.hypot(u.x - x, u.y - y) <= u.noBomb)) return 'The enemy shield keeps the bombers away from there';
  const faction = world.factions[side].toUpperCase(), F = db.faction(world.factions[side]);
  const type = (F && db.type(F.str('Skirmish_Land_Bomber').trim())) || [...db.types.values()].find(t => t.tag === 'LandBombingUnit' && t.str('Affiliation').toUpperCase().includes(faction));
  if (!type) return 'No bombers';
  world.owned[side].delete(ticket);
  const home = world.units.find(u => u.isBase && world.ally(u.side, side)) || { x: x - 1, y };
  const d = Math.hypot(x - home.x, y - home.y) || 1, ux = (x - home.x) / d, uy = (y - home.y) / d, reach = 1100;
  const bomb = db.type(type.list('Projectile_Types')[0]);
  const run = {
    side, type, bomb, x, y, ux, uy, along: -reach, reach, speed: type.num('Max_Speed', 6) * 30, height: type.num('Hover_Offset', 100) + type.num('Layer_Z_Adjust', 0),
    every: Math.max(0.2, type.num('Projectile_Fire_Recharge_Seconds', 0.2)), wait: 0, craft: [], bombs: [],
  };
  for (const off of [-70, 0, 70]) {
    const holder = new THREE.Group();
    holder.scale.setScalar(type.num('Scale_Factor', 1));
    holder.rotation.z = Math.atan2(uy, ux) + Math.PI / 2;
    world.scene.add(holder);
    const craft = { off, holder, unit: null };
    run.craft.push(craft);
    loadModel(type.str('Land_Model_Name'), { teamColor: world.colors[side] || null }).then(inst => {
      holder.add(inst.root);
      const squad = world.squadOf(type, side, { native: true, bomber: true, busy: true });
      const u = craft.unit = landUnit({
        type, squad, off: { x: 0, y: 0 }, holder, inst, x: x - ux * reach, y: y - uy * reach, z: 0, heading: Math.atan2(uy, ux), speed: 0, turn: 0, path: [], anims: {}, anim: null, animKind: '',
        side, dead: false, gone: false, target: null, maxHealth: type.num('Tactical_Health', 100), health: type.num('Tactical_Health', 100), maxShield: 0, shield: 0,
        armor: type.str('Armor_Type'), aimZ: 0, range: 0, weapon: null, turret: null, kind: 'AIR', hitRadius: Math.max(8, type.num('Select_Box_Scale', 40) * 0.3), captures: false, inaccuracy: new Map(),
        lift: run.height, flies: true, rooted: true, bomber: true, body: 12, need: 1, mod: { speed: 1, taken: 1, delay: 1, dealt: 1 },
      });
      squad.members.push(u); world.units.push(u);
    }).catch(() => {});
  }
  world.bombing.push(run);
  if (world.onSound) world.onSound(type.str('SFXEvent_Bomb_Run_Incoming'), x, y);
  return null;
}

function tickBombing(world, dt) {
  for (const run of world.bombing) {
    run.along += run.speed * dt;
    run.craft = run.craft.filter(c => !(c.unit && c.unit.dead));
    for (const c of run.craft) {
      const px = run.x + run.ux * run.along - run.uy * c.off, py = run.y + run.uy * run.along + run.ux * c.off;
      c.x = px; c.y = py; c.z = world.groundZ(px, py) + run.height;
      c.holder.position.set(px, py, c.z);
      if (c.unit) { c.unit.x = px; c.unit.y = py; c.unit.z = c.z; }
    }
    if (Math.abs(run.along) < 150 && (run.wait -= dt) <= 0) {
      run.wait = run.every;
      for (const c of run.craft) run.bombs.push({ x: c.x + run.ux * 30, y: c.y + run.uy * 30, z: c.z, v: 0 });
    }
    const g = (run.bomb ? run.bomb.num('Projectile_Bomb_Fall_Accel_Rate', 0.2) : 0.2) * 900;
    run.bombs = run.bombs.filter(b => {
      b.v += g * dt; b.z -= b.v * dt;
      const floor = world.groundZ(b.x, b.y);
      if (b.z > floor) return true;
      const P = run.bomb, r = P ? P.num('Projectile_Blast_Area_Range', 100) : 100, dmg = P ? P.num('Projectile_Blast_Area_Damage', 50) : 50;
      if (world.onFx && P) world.onFx(P.str('Projectile_Ground_Detonation_Particle'), b.x, b.y, floor + 3);
      if (world.onSound && P) world.onSound(P.str('Projectile_SFXEvent_Detonate') || 'SFX_Grenade_Detonation', b.x, b.y);
      for (const u of world.units) {
        if (u.dead || world.ally(u.side, run.side) || u.inside || u.flies) continue;
        const d = Math.hypot(u.x - b.x, u.y - b.y);
        if (d <= r) world.hurt(u, dmg * (1 - 0.5 * d / r) * db.damageMod(P ? P.str('Damage_Type') : '', u.armor));
      }
      return false;
    });
  }
  world.bombing = world.bombing.filter(run => {
    if (run.along < run.reach || run.bombs.length) return true;
    for (const c of run.craft) { world.scene.remove(c.holder); if (c.unit) { c.unit.dead = true; c.unit.gone = true; c.unit.squad.members = []; } }
    return false;
  });
}

export function bombardOf(world, side) { const all = (world.bombard ||= []); return (all[side] ||= { present: false, readyAt: 0, run: null, told: false }); }
export function enableBombard(world, side, on = true) { const r = bombardOf(world, side); r.present = !!on; r.told = false; }
export const canBombard = (world, side) => { const r = world.bombard && world.bombard[side]; return !!r && r.present && !r.run && world.time >= r.readyAt; };

const listOf = (F, tag) => F.list(tag).flatMap(x => x.split(/[\s,]+/)).filter(Boolean);

export function orbitalBombard(world, side, x, y) {
  if (!canBombard(world, side)) return 'Orbital bombardment is not ready';
  if (world.shields.some(s => !world.ally(s.side, side) && Math.hypot(s.x - x, s.y - y) < s.r)) return 'An enemy shield protects that place';
  if (side === world.viewer && world.seenNow && !world.seenNow(x, y)) return 'No line of sight to that area';
  const F = db.faction(world.factions[side]);
  const projs = F ? listOf(F, 'Bombardment_Projectile').map(n => db.type(n)).filter(Boolean) : [];
  if (!projs.length) return 'No fleet to bombard from';
  const C = db.constants, nums = s => String(s || '').split(/[\s,]+/).filter(Boolean).map(Number).filter(n => !isNaN(n));
  const dist = nums(C.str('Bombardment_Distribution'));
  const off = nums(C.str('Bombardment_Offset'));
  const ship = F ? listOf(F, 'Bombardment_Required_Orbital_Ships').map(n => db.type(n)).find(Boolean) : null;
  const shotDelay = F.num('Bombardment_Shot_Delay', 0.2);
  const run = {
    side, x, y, salvo: 0, shot: 0, salvos: Math.max(1, F.num('Bombardment_Number_Of_Salvos', 1)), per: Math.max(1, F.num('Bombardment_Shots_Per_Salvo', 1)),
    shotDelay, salvoDelay: F.num('Bombardment_Salvo_Delay', 1), next: world.time + F.num('Bombardment_Initial_Delay', 1) + shotDelay,
    dist: dist.length ? dist : [0, 1, 2, 3], di: Math.floor(simRandom() * Math.max(1, dist.length)), height: off[2] || 600, offX: off[0] || 0, offY: off[1] || 0,
    reach: F.num('Bombardment_Blob_Size', 200), projs, particles: listOf(F, 'Bombardment_Particle'),
  };
  bombardOf(world, side).run = run;
  if (run.particles[0] && world.onFx) world.onFx(run.particles[0], x, y, world.groundZ(x, y) + 3);
  if (ship && world.onSound) world.onSound(ship.str('SFXEvent_Bombard_Incoming'), x, y);
  return null;
}

function bombardShot(world, run) {
  const P = run.projs[Math.min(run.salvo, run.projs.length - 1)];
  let ax = run.x, ay = run.y;
  if ((run.salvo > 0 || run.shot > 0) && run.per > 1) {
    const q = run.dist[run.di++ % run.dist.length], a = (q * 90 + simRandom() * 89) * Math.PI / 180, r = simRandom() * run.reach;
    ax += Math.cos(a) * r; ay += Math.sin(a) * r;
  }
  const floor = world.groundZ(ax, ay), sx = ax + run.offX, sy = ay + run.offY, z0 = floor + run.height, speed = Math.max(1, P.num('Max_Speed', 20)) * 30;
  const dx = ax - sx, dy = ay - sy, dz = floor - z0, d = Math.hypot(dx, dy, dz) || 1, dmg = P.num('Projectile_Damage', 0);
  const w = { proj: P, speed, damage: dmg, damageType: P.str('Damage_Type'), muzzles: null };
  const reach = P.num('Projectile_Max_Flight_Distance', 0) + Math.abs(dz);
  world.shots.push({
    x: sx, y: sy, z: z0, vx: dx / d * speed, vy: dy / d * speed, vz: dz / d * speed, speed, left: reach, total: reach, arc: 0, bz: z0, w, ax, ay, damage: dmg, dud: true,
    cat: categoryOf(P), sx, sy, sz: z0, aimX: ax, aimY: ay, aimZ: floor, flown: 0, reach, age: 0, fall: 0, vz0: dz / d * speed, ox: 0, oy: 0, oz: 0, path: null,
    from: { side: run.side, dead: true, x: sx, y: sy, type: P }, target: { dead: true, x: ax, y: ay, hitRadius: 0 },
    onLand: s => blast(world, P, s.ax, s.ay, run.side),
  });
}

function tickBombard(world) {
  for (let side = 0; side < world.bombard.length; side++) {
    const r = world.bombard[side];
    if (!r) continue;
    const run = r.run;
    if (run) {
      while (r.run && world.time >= run.next) {
        bombardShot(world, run);
        if (++run.shot < run.per) { run.next += run.shotDelay; continue; }
        run.shot = 0;
        if (++run.salvo < run.salvos) {
          run.next += run.salvoDelay;
          const p = run.particles[run.salvo];
          if (p && world.onFx) world.onFx(p, run.x, run.y, world.groundZ(run.x, run.y) + 3);
          continue;
        }
        r.run = null; r.told = false;
        const C = db.constants, lo = C.num('Min_Bombard_Interval_Seconds', 260), hi = Math.max(lo, C.num('Max_Bombard_Interval_Seconds', lo));
        r.readyAt = world.time + lo + simRandom() * (hi - lo);
        for (const n of [...world.owned[side]]) { const t = db.type(n); if (t && t.behaviors().has('DUMMY_DESTROY_AFTER_PLANETARY_BOMBARD')) world.owned[side].delete(n); }
      }
    } else if (r.present && !r.told && world.time >= r.readyAt) {
      r.told = true;
      const v = world.viewer, F = v !== undefined && v >= 0 ? db.faction(world.factions[v]) : null;
      if (F && world.onSound) world.onSound(F.str(side === v ? 'SFXEvent_Bombard_Available' : world.ally(side, v) ? 'SFXEvent_Bombard_Ally_Available' : 'SFXEvent_Bombard_Enemy_Available'));
    }
  }
}

export function hostOf(u, t = u.type) {
  u.slots = t.num('Num_Garrison_Slots', 0);
  u.ports = t.num('Num_Garrison_Guns', 0); u.holds = [];
  u.accepts = new Set(t.list('Garrison_Category').map(c => c.toUpperCase()));
}
const kindOf = u => u.type.list('Garrison_Category').map(c => c.toUpperCase());
const sizeOf = u => Math.max(1, u.type.num('Garrison_Value', 1));
const suits = (host, u) => u !== host && !u.flies && !u.slots && kindOf(u).some(k => host.accepts.has(k));
const squadSize = (host, q) => Math.max(1, ...q.members.filter(u => suits(host, u)).map(sizeOf));
const usedOf = host => host.holds.reduce((n, q) => n + (q.members.some(u => u.inside === host) ? squadSize(host, q) : 0), 0);

export function canGarrison(world, squad, host) {
  if (!host || host.dead || !host.slots || !world.ally(host.side, squad.side)) return false;
  const fit = squad.members.filter(u => suits(host, u));
  return fit.length > 0 && squadSize(host, squad) <= host.slots - usedOf(host);
}

export function garrison(world, squad, host) {
  if (!host || host.dead || !host.slots) return 'Nothing to go into';
  if (!world.ally(host.side, squad.side)) return 'Not yours';
  const fit = squad.members.filter(u => suits(host, u));
  if (!fit.length) return 'They do not fit inside';
  if (squadSize(host, squad) > host.slots - usedOf(host)) return 'It is full';
  const o = world.nearestOpen(host.x, host.y, squad.members[0].need || 1) || world.nearestOpen(host.x, host.y);
  if (!o) return 'No way in';
  squad.entering = host; squad.foe = null;
  world.order(squad, o.x, o.y);
  return null;
}

export function ungarrison(world, host, x = null, y = null, only = null) {
  const mult = db.constants.num('Garrisoned_Max_Attack_Distance_Multiplier', 1.5), out = host.type.num('Garrison_Exit_Dist', 50) + host.hitRadius * 0.5;
  host.holds.forEach((q, k) => {
    if (only && q !== only) return;
    const a = k * 2.1, need = (q.members[0] && q.members[0].need) || 1;
    const o = world.nearestOpen(host.x + Math.cos(a) * (out + 20), host.y + Math.sin(a) * (out + 20), need) || world.nearestOpen(host.x, host.y) || host;
    for (const u of q.members) {
      if (u.inside !== host) continue;
      u.inside = null; u.gunner = false; u.range /= mult; u.holder.visible = true;
      u.x = o.x + (simRandom() - 0.5) * 16; u.y = o.y + (simRandom() - 0.5) * 16; u.path = []; u.target = null;
    }
    if (x !== null && q.members.length) world.order(q, x, y);
  });
  host.holds = only ? host.holds.filter(q => q !== only) : [];
  if (host.hoverH > 0) host.hoverState = 3;
}

function tickGarrisons(world) {
  for (const q of world.squads) {
    const host = q.entering;
    if (!host) continue;
    if (host.dead || !q.members.length || !world.ally(host.side, q.side)) { q.entering = null; continue; }
    const gap = Math.min(...q.members.map(u => Math.hypot(u.x - host.x, u.y - host.y)));
    if (gap > host.hitRadius * 2 + 70) { if (!q.members.some(u => u.path.length)) q.entering = null; continue; }
    q.entering = null;
    putInside(world, q, host);
  }
}

export function putInside(world, q, host) {
  if (!host || host.dead || !host.slots) return false;
  const mult = db.constants.num('Garrisoned_Max_Attack_Distance_Multiplier', 1.5);
  if (!q.members.some(u => u.inside === host) && squadSize(host, q) > host.slots - usedOf(host)) return false;
  let any = false;
  let ports = host.ports - host.holds.reduce((a, s) => a + s.members.filter(u => u.gunner && u.inside === host).length, 0);
  for (const u of q.members) {
    if (u.inside || !suits(host, u)) continue;
    any = true;
    u.inside = host; u.path = []; u.target = null; u.range *= mult; u.gunner = ports-- > 0; u.holder.visible = false; u.x = host.x; u.y = host.y; u.z = host.z;
  }
  if (!any) return false;
  if (host.hoverH > 0) host.hoverState = 3;
  if (!host.holds.includes(q)) host.holds.push(q);
  if (q.members.every(u => u.inside)) q.selected = false;
  return true;
}

export async function addWall(world, o) {
  const f = o.owner >= 0 ? [...db.factions.values()][o.owner] : null;
  let side = f ? world.factions.findIndex(x => x.toUpperCase() === f.name.toUpperCase()) : -1;
  if (side < 0) side = world.wild;
  const site = { base: false, wall: true, side, point: { side: -1, type: o.type }, x: o.pos[0], y: o.pos[1], z: o.pos[2], rot: o.rot, scale: o.scale || 1, options: [], structure: null, building: null };
  const u = await world.finishSite(site, o.type, side);
  if (u) u.relevant = false;
  return u;
}

export async function addHouse(world, o) {
  const t = o.type, first = db.type(t.list('Spawned_Indigenous_Units_Type')[0]);
  let aff = t.str('Affiliation').toUpperCase();
  if ((!aff || aff.includes('NEUTRAL')) && first) aff = first.str('Affiliation').toUpperCase();
  if (!aff || aff.includes('NEUTRAL') || simRandom() >= t.num('Spawn_Indigenous_Units_Chance', 1)) return null;
  let side = world.factions.findIndex(f => aff.includes(f.toUpperCase()));
  if (side < 0) side = world.wild;
  if (world.planetCorruption === 4 && first?.bool('Is_Indigenous_Unit_Corruptible', true)) {
    const ally = world.factions.findIndex(f => db.faction(f)?.bool('Benefits_From_Corruption'));
    if (ally >= 0) side = ally;
  }
  const site = { base: false, native: true, side, point: { side: -1, type: t }, x: o.pos[0], y: o.pos[1], z: o.pos[2], rot: o.rot, scale: o.scale || 1, options: [], structure: null, building: null };
  const u = await world.finishSite(site, t, side);
  if (!u) return null;
  u.relevant = false;
  u.house = {
    pack: t.str('Spawned_Indigenous_Pack_Type') || t.list('Spawned_Indigenous_Units_Type')[0], every: Math.max(2, t.num('Spawned_Indigenous_Units_Delay_Seconds', 20)), timer: 3,
    most: t.num('Spawned_Indigenous_Units_Quantity', 10), radius: t.num('Spawn_Indigenous_Units_Radius', 80), out: [], busy: false,
    leash: t.num('Max_Distance_From_Spawner', 0),
  };
  return u;
}

function tickHouses(world, dt) {
  for (const u of world.units) {
    const h = u.house;
    if (h && h.leash > 0 && !u.dead) for (const q of h.out) {
      const lead = q.members[0];
      if (lead && Math.hypot(lead.x - u.x, lead.y - u.y) > h.leash + Math.max(lead.range, 60) && !q.homing) {
        const o = world.nearestOpen(u.x + (simRandom() - 0.5) * h.radius, u.y + (simRandom() - 0.5) * h.radius);
        if (o) { q.foe = null; q.march = null; for (const m of q.members) m.target = null; world.order(q, o.x, o.y); q.homing = true; }
      } else if (lead && q.homing && Math.hypot(lead.x - u.x, lead.y - u.y) < h.leash) q.homing = false;
    }
    if (!h || u.dead || h.busy || (h.timer -= dt) > 0) continue;
    h.timer = h.every;
    h.out = h.out.filter(q => q.members.length);
    if (h.out.reduce((a, q) => a + q.members.length, 0) >= h.most) continue;
    const a = simRandom() * Math.PI * 2, o = world.nearestOpen(u.x + Math.cos(a) * h.radius, u.y + Math.sin(a) * h.radius);
    if (!o) continue;
    h.busy = true;
    Promise.resolve(world.spawn(h.pack, o.x, o.y, a, u.side)).then(q => {
      h.busy = false;
      if (!q) return;
      for (const m of q.members) m.captures = false;
      q.native = true;
      h.out.push(q);
    }).catch(() => { h.busy = false; });
  }
}

export async function addCapturable(world, pt, o) {
  const site = { base: false, capturable: true, side: -1, point: pt, x: o.pos[0], y: o.pos[1], z: o.pos[2], rot: o.rot, scale: o.scale || 1, options: [], structure: null, building: null };
  const u = await world.finishSite(site, pt.type, -1);
  if (!u) return null;
  if (pt.holder) pt.holder.visible = false;
  u.relevant = false; u.capturable = pt; u.builds = [];
  if (pt.type.bool('Immune_To_Damage')) u.invulnUntil = Infinity;
  return u;
}

export function tickCapturables(world) {
  for (const u of world.units) {
    const pt = u.capturable;
    if (!pt || u.dead) continue;
    if (u.doomAt && world.time >= u.doomAt) { u.doomAt = 0; u.invulnUntil = 0; world.hurt(u, 10001); continue; }
    if (u.side === pt.side) continue;
    u.side = u.squad.side = pt.side; u.target = null;
    const script = u.type.str('Lua_Script').toUpperCase(), real = pt.side >= 0 && pt.side < world.factions.length;
    if (real && !u.claimed && (script === 'SECONDARYHEAVYFACTORY' || script === 'SECONDARYMININGFACILITY')) {
      u.claimed = true; pt.locked = true;
      if (script === 'SECONDARYMININGFACILITY') { world.credits[pt.side] += 800; u.doomAt = world.time + 3; }
      else u.doomAt = world.time + 45;
    }
    u.builds = pt.side >= 0 && pt.side < world.factions.length ? buildsFor(u.type, world.factions[pt.side], world.campaign).filter(t => t.has('Company_Units') || isUpgrade(t)) : [];
  }
}

export function tickBase(world, dt) {
  if (world.bombing.length) tickBombing(world, dt);
  if (world.bombard) tickBombard(world);
  if ((world.baseDt = (world.baseDt || 0) + dt) < 0.2) return;
  const step = world.baseDt; world.baseDt = 0;
  for (const s of world.sites) if (s.mdu && s.mdu.dead) {
    if (s.structure && !s.structure.dead && !s.mdu.type.bool('Tactically_Built_Child_Object_Persists')) world.hurt(s.structure, 1e9);
    world.sites = world.sites.filter(x => x !== s); s.mdu.padSite = null; break;
  }
  world.shields = shieldsUp(world);
  tickGravity(world);
  tickCages(world);
  tickPresence(world);
  tickAmbient(world, step);
  tickQuakes(world, step);
  for (const u of world.units) {
    if (!u.structure || !u.needsPower || u.dead) continue;
    const wants = world.sites.some(s => s.base && s.pad && world.ally(s.side, u.side) && /POWER_GENERATOR/i.test(s.pad.name));
    u.unpowered = wants && !world.units.some(x => x.power && !x.dead && world.ally(x.side, u.side));
  }
  for (const u of world.units) {
    const D = u.drain;
    if (!D || u.dead || u.side < 0 || u.unpowered) continue;
    const victims = world.units.filter(e => !e.dead && !e.structure && !e.inside && !e.flies && !e.cloaked && e.side >= 0 && !world.ally(e.side, u.side) && Math.hypot(e.x - u.x, e.y - u.y) <= D.r &&
      (!D.cats.length || e.type.str('CategoryMask').toUpperCase().split(/[\s|,]+/).some(c => D.cats.includes(c)))).sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y)).slice(0, D.most);
    for (const e of victims) {
      world.hurt(e, D.dps * step, u);
      if (D.heal) u.health = Math.min(u.maxHealth, u.health + D.dps * step);
      const link = D.links.get(e);
      if (link && world.bolts.includes(link)) link.until = world.time + 0.5;
      else { const l = { a: u, b: e, aBone: D.from, bBone: D.to, effect: D.effect, until: world.time + 0.5 }; D.links.set(e, l); world.bolts.push(l); if (world.onSound) world.onSound(D.sfx, u.x, u.y); }
    }
    for (const e of D.links.keys()) if (!victims.includes(e)) D.links.delete(e);
  }
  for (const u of world.units) {
    if (u.dead || u.structure) continue;
    u.shell = world.shields.some(s => !world.ally(s.side, u.side) && Math.abs(Math.hypot(u.x - s.x, u.y - s.y) - s.r) < 25);
  }
  tickCapturables(world);
  tickGarrisons(world);
  tickHouses(world, step);
}
