import {hintedObjects} from './tacticalobjects.js';
import { loadFengari, LuaVM, LuaRef, Multi } from '../lua.js';
import { db } from '../gamedata.js';
import { fetchText, findFiles } from '../vfs.js';
import { useAbility } from './abilities.js';
import { orderMove, orderAttack, orderGuard, orderStop } from './orders.js';
import { loadSpaceBrain, SpaceMind, target as mindTarget } from './spacebrain.js';
import { Plans } from './aiplans.js';
import { simRandom } from './simrandom.js';
import { namedSet } from './priorities.js';
import { aidebug as D, who, group, targetOf, nameOf } from '../aidebug.js';
import { installBattlePersistence } from './tacticalsave.js';

const settable = (o, k) => { for (let p = o; p; p = Object.getPrototypeOf(p)) { const d = Object.getOwnPropertyDescriptor(p, k); if (d) return !!(d.set || d.writable); } return true; };
const NATIVES = 'Find_Hint Story_Event Create_Thread Find_Object_Type Find_All_Objects_Of_Type Find_Player Transition_Cinematic_Camera_Key Create_Generic_Object Lock_Controls Find_First_Object Spawn_Unit Set_Cinematic_Target_Key Set_Cinematic_Camera_Key Suspend_AI Fade_Screen_In Find_All_Objects_With_Hint Transition_Cinematic_Target_Key Add_Radar_Blip Find_Nearest Start_Cinematic_Camera End_Cinematic_Camera Letter_Box_Out Fade_Screen_Out Letter_Box_In Remove_Radar_Blip Point_Camera_At Transition_To_Tactical_Camera EvaluatePerception Cancel_Fast_Forward FindTarget Allow_Localized_SFX Get_Story_Plot Get_Game_Mode FindDeadlyEnemy Create_Cinematic_Transport Assemble_Fleet Stop_All_Music Remove_All_Text Stop_All_Speech Cinematic_Zoom Resume_Mode_Based_Music Project_By_Unit_Range Weather_Audio_Pause Find_Marker FindPlanet Do_End_Cinematic_Cleanup Spawn_From_Reinforcement_Pool Promote_To_Space_Cinematic_Layer Set_Cinematic_Environment Play_Bink_Movie Find_Best_Local_Threat_Center Purge_Goals Reinforce_Unit Resume_Hyperspace_In Scroll_Camera_To Play_Music Enable_Distance_Fog Evaluate_In_Galactic_Context Stop_Bink_Movie Find_Nearest_Space_Field Start_Cinematic_Space_Retreat StringCompare Find_Path Zoom_Camera GiveDesireBonus Play_Lightning_Effect Is_Multiplayer_Mode Master_Volume_Restore Force_Weather Apply_Markup DumpCallStack Rotate_Camera_By WaitForStarbase EvaluateTypeList Add_Objective Get_Most_Defended_Position Remove_Planet_Highlight Add_Planet_Highlight Spawn_Special_Weapon MessagBox _MessagePopup _OuputDebug _ScriptMessage'.split(' ');

const ONLY_FORCES = new Set(['Get_Unit_Table', 'Are_All_Units_On_Free_Store', 'Get_Force_Count', 'Produce_Force', 'Release_Forces']);
const LEVELS = { easy: 'Easy', medium: 'Normal', hard: 'Hard' };
const lead = e => (e && e.isSquad ? e.fighters[0] : e);
const body = e => (e && !e.isSquad && e.members ? e.members[0] : lead(e));
function shouldSwitch(u, t) {
  if (!u || !u.type || !t || !t.type || t.dead) return false;
  const P = u.type.list('Projectile_Types').map(n => db.type(n));
  if (P.length < 2) return false;
  const shielded = t.maxShield > 0 && t.shield > 0;
  const armor = shielded ? t.shieldArmor ?? t.type.str('Shield_Armor_Type') : typeof t.armor === 'string' ? t.armor : t.type.str('Armor_Type');
  const score = p => (p && p.bool(shielded ? 'Projectile_Does_Shield_Damage' : 'Projectile_Does_Hitpoint_Damage', true) ? p.num('Projectile_Damage', 0) * db.damageMod(p.str('Damage_Type'), armor) : 0);
  const cur = u.weaponIndex || 0, now = score(P[cur]);
  return P.some((p, i) => i !== cur && score(p) > now);
}
const HARM_FADE = 6;
const gone = e => !e || e.dead || (e.isSquad && !e.fighters.length);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const hasProp = (t, name) => (t._props ||= new Set(t.str('Property_Flags').split('|').map(x => x.trim().toUpperCase()).filter(Boolean))).has(String(name).trim().toUpperCase());

export class ScriptHost {
  static async create(game) {
    const files = await findFiles('SCRIPTS\\\\.*\\.LUA$').catch(() => []);
    if (!files.length) return null;
    const fengari = await loadFengari().catch(() => null);
    return fengari ? new ScriptHost(game, fengari, files) : null;
  }

  constructor(game, fengari, files) {
    this.game = game; this.world = game.world;
    this.index = new Map();
    const lib = k => (/\\LIBRARY\\/.test(k) ? 0 : 1);
    for (const k of files.slice().sort((a, b) => lib(a) - lib(b))) {
      const parts = k.replace(/^.*?\\SCRIPTS\\/, '').replace(/\.LUA$/, '').split('\\');
      for (let i = 0; i < parts.length; i++) { const key = parts.slice(i).join('/'); if (!this.index.has(key)) this.index.set(key, k); }
    }
    this.sources = new Map();
    this.fetching = 0;
    this.missing = new Map();
    this.errors = new Map();
    this.inert = new Set();
    this.instances = [];
    this.values = new Map();
    this.wrapped = new WeakMap();
    this.brains = new Map();
    this.current = null;
    this.storyInstances=[];this.storyTime=0;
    this.sids = 0;
    this.vm = new LuaVM(fengari, { source: key => this.source(key) });
    this.vm.traceHost = () => ({ inst: this.current, t: this.world ? this.world.time : NaN, mode: this.land ? 'L' : 'S' });
    this.vm.pairsLua50();
    this.land = !!game.land;
    this.cmd = game.cmd || {
      move: (us, x, y, attack, exact) => orderMove(us, x, y, !!attack, false, !!exact),
      attack: (us, t) => { const x = t && t.isPad ? t.padChild : t, p = us[0] && us[0].player; if (!x || x.dead || !p || x.player.team === p.team) return; orderAttack(us, x); },
      guard: (us, t) => orderGuard(us, t),
      stop: us => orderStop(us),
      ability: (e, kind, on, target) => useAbility(this.world, e, kind, on, target),
      build: (e, type, check) => !!(this.world.scriptBuild && this.world.scriptBuild(e, type, check)),
    };
    this.cmd = this.logged(this.cmd);
    this.globals();
    this.plans = new Plans(this);
    this.scoring = this.index.has('GAMESCORING') ? { e: null, global: true, name: 'GameScoring', key: 'GAMESCORING', state: 'new', next: 0, prox: [], events: [], values: new Map(), exit: false } : null;
    this.told = [];
    if (this.scoring) {
      this.add(this.scoring);
      this.tell('Game_Mode_Starting_Event', this.land ? 'Land' : 'Space', String(game.setup.mapFile || '').replace(/\.TED$/i, ''));
      const before = this.world.onEvent;
      this.world.onEvent = (kind, data) => {
        before.call(this.world, kind, data);
        if (kind === 'killed') {
          const u = data.unit, sq = u.squad, what = sq || u;
          if (sq && sq.fighters.some(f => f !== u && !f.dead)) return;
          this.dying = what; this.tell('Tactical_Unit_Destroyed_Event', this.wrap(what), this.player(data.killer || this.world.neutral)); this.dying = null;
        }
        else if (kind === 'built' || kind === 'reinforcementReady') this.tell('Tactical_Production_End_Event', this.type(data.type), this.player(data.player), this.wrap(data.player.station));
        else if (kind === 'gameover') this.tell('Game_Mode_Ending_Event', this.land ? 'Land' : 'Space');
      };
    }
    { const before = this.world.onEvent;
      this.world.onEvent = (kind, data) => { before.call(this.world, kind, data); if (kind === 'killed' && this.story) for (const t of new Set([data.unit?.type?.name, data.unit?.squad?.type?.name].filter(Boolean))) this.story.signal('STORY_TACTICAL_DESTROY', t); }; }
    if (!this.land) for (const p of this.world.players) loadSpaceBrain(p.factionName).then(b => this.brains.set(p, b)).catch(() => {});
    installBattlePersistence(this);
  }

  revealWrap(r) { return { __wrap: true, __name: 'Reveal', __reveal: r, Is_Valid: () => true, Undo_Reveal: () => { r.until = 0; }, __missing: this.absent('Reveal') }; }

  add(inst) { inst.sid ??= ++this.sids; this.instances.push(inst); return inst; }

  evaluate(name, player, target, args) {
    const vm = this.vm, key = String(name).toUpperCase();
    const mine = (this.evaluators ||= new Map()), id = key + '|' + player.id;
    let ev = mine.get(id);
    if (ev === null) return undefined;
    if (!ev) {
      const src = this.source('EVALUATORS/' + key);
      if (src === undefined) return undefined;
      if (src === null) { mine.set(id, null); return undefined; }
      const env = vm.environment({ PlayerObject: this.player(player) });
      const err = vm.run(src, 'Evaluator ' + key, env);
      if (err) { vm.free(env); if (!err.includes('@@need')) { this.errors.set('Evaluator ' + key, err); mine.set(id, null); } return undefined; }
      mine.set(id, (ev = { env, name: 'Evaluator ' + key }));
    }
    const thing = target && this.game.targetThing ? this.game.targetThing(target) : null;
    const t = thing ? this.wrap(thing) : target && (target.unit ? this.wrap(target.unit.squad || target.unit) : target.x !== undefined ? this.pos(target.x, target.y, 0) : undefined);
    vm.set(ev.env, 'Target', t);
    const was = this.current;
    this.current = ev;
    let r;
    try { r = vm.call(ev.env, 'Evaluate', ...args); } finally { this.current = was; }
    if (!r.ok) { if (!r.missing) this.errors.set(ev.name, r.error); return undefined; }
    return typeof r.value === 'number' ? r.value : r.value === true ? 1 : 0;
  }

  async preloadAll() {
    const byFile = new Map();
    for (const [key, file] of this.index) { if (this.sources.has(key)) continue; if (!byFile.has(file)) byFile.set(file, []); byFile.get(file).push(key); }
    const files = [...byFile.keys()];
    const one = async () => {
      for (let file; (file = files.pop());) {
        const text = await fetchText(file.replace(/\\/g, '/')).catch(() => null);
        for (const key of byFile.get(file)) if (!this.sources.has(key)) this.sources.set(key, text ?? null);
      }
    };
    await Promise.all(Array.from({ length: 12 }, one));
    while (this.fetching || !this.plans.ready) await new Promise(r => setTimeout(r, 20));
    if (!this.land) await Promise.all(this.world.players.map(p => loadSpaceBrain(p.factionName).then(b => this.brains.set(p, b)).catch(() => {})));
  }

  source(key) {
    if (this.sources.has(key)) return this.sources.get(key);
    const file = this.index.get(key);
    if (!file) { this.sources.set(key, null); return null; }
    this.fetch(key, file);
    return undefined;
  }
  fetch(key, file) {
    if (this.sources.has(key) || this.pending?.has(key)) return;
    (this.pending ||= new Set()).add(key);
    this.fetching++;
    fetchText(file.replace(/\\/g, '/')).catch(() => null).then(text => {
      this.sources.set(key, text ?? null);
      this.pending.delete(key); this.fetching--;
      for (const m of (text || '').matchAll(/require\s*\(?\s*["']([^"']+)["']/g)) {
        const k = m[1].replace(/\.lua$/i, '').replace(/[\\.]/g, '/').toUpperCase();
        if (this.index.has(k)) this.fetch(k, this.index.get(k));
      }
    });
  }

  lock(e) { if (e && e.order && e.order.kind !== 'idle') (this.locks ||= new WeakMap()).set(e, e.order.kind); }
  locked(e) {
    const k = this.locks && this.locks.get(e);
    if (k === undefined) return false;
    if (gone(e) || !e.order || e.order.kind !== k) { this.locks.delete(e); return false; }
    return true;
  }
  absent(kind) { return name => (/^[A-Z]/.test(name) && !ONLY_FORCES.has(name) ? (() => { const k = kind + '.' + name; this.missing.set(k, (this.missing.get(k) || 0) + 1); }) : undefined); }

  wrap(x) {
    if (!x) return undefined;
    let w = this.wrapped.get(x);
    if (!w) this.wrapped.set(x, (w = x.isPlayerObject ? this.playerWrap(x) : x.isTypeObject ? this.typeWrap(x) : this.unitWrap(x)));
    return w;
  }
  player(p) { if (p) p.isPlayerObject = true; return this.wrap(p); }
  campaignPlayer(n) {
    if (!this.game.setup?.campaign) return null;
    const faction = db.faction(n);
    if (!faction) return null;
    const known = (this.campaignPlayers ||= new Map());
    let p = known.get(faction.name.toUpperCase());
    if (!p) { p = { id: 1000 + known.size, factionName: faction.name, faction, team: 'campaign:' + faction.name.toUpperCase(), credits: 0, human: false, difficulty: 'medium', techLevel: 0, absent: true }; known.set(faction.name.toUpperCase(), p); }
    return p;
  }
  type(t) { if (t) t.isTypeObject = true; return this.wrap(t); }
  of(v) { return v && v.__entity ? v.__entity : null; }
  at(v) { if (v && v.__force) return this.plans.at(v); const e = this.of(v); return e ? { x: e.x, y: e.y, z: e.z || 0 } : v && v.__pos ? v : null; }
  pos(x, y, z = 0) { return { __wrap: true, __pos: true, __name: 'Position', x, y, z, Is_Valid: () => true, Get_Game_Object: () => undefined, Get_Distance: o => { const b = this.at(o); return b ? Math.hypot(b.x - x, b.y - y) : 1e9; }, Get_XYZ: () => new Multi(x, y, z), __missing: this.absent('Position') }; }

  typeWrap(t) {
    return {
      __wrap: true, __type: t, __name: t.name,
      Get_Name: () => t.name.toUpperCase(),
      Is_Hero: () => /HERO/.test(t.str('CategoryMask').toUpperCase()),
      Get_Combat_Rating: () => t.num('AI_Combat_Power', 0),
      Get_Score_Cost_Credits: () => t.num('Score_Cost_Credits', 0),
      Get_Max_Range: () => t.num('Targeting_Max_Attack_Distance', t.num('Max_Attack_Distance', 800)),
      Get_Min_Range: () => t.num('Targeting_Min_Attack_Distance', 0),
      Get_Build_Cost: () => t.num('Tactical_Build_Cost_Multiplayer', t.num('Build_Cost_Credits', 0)),
      Get_Tactical_Build_Cost: () => t.num('Tactical_Build_Cost_Multiplayer', 0),
      Get_Tech_Level: () => t.num('Tech_Level', 0),
      Is_Valid: () => true,
      Is_Affected_By_Missile_Shield: () => /^(ROCKET|MPTL_ROCKET)$/i.test(t.str('Projectile_Category').trim()),
      Is_Affiliated_With: o => { const q = o && o.__player; return !!q && t.list('Affiliation').some(a => a.toUpperCase() === String(q.factionName || '').toUpperCase()); },
      Is_Build_Locked: o => { const q = o && o.__player; return !!(q && q.lockedTech && q.lockedTech.has(t)) || (t.bool('Build_Initially_Locked') && !(q && q.unlockedTech && q.unlockedTech.has(t))); },
      Is_Obsolete: () => false,
      Get_Bribe_Cost: hero => { const q = this.of(hero); return q && this.cmd.bribeCost ? this.cmd.bribeCost(q, t) : 0; },
      Is_Affected_By_Laser_Defense: () => /^(MISSILE|ROCKET|MPTL_ROCKET)$/i.test(t.str('Projectile_Category').trim()),
      __missing: this.absent('Type'),
    };
  }

  playerWrap(p) {
    const w = this.world, neutral=player=>player===w.neutral||player.id<0||!!player.faction?.bool?.('Is_Neutral');
    return {
      __wrap: true, __player: p, __name: p.factionName,
      Is_Valid: () => true,
      Get_Faction_Name: () => p.factionName.toUpperCase(),
      Get_Name: () => p.name || p.factionName,
      Get_ID: () => p.id,
      Is_Human: () => !!p.human,
      Is_Neutral: () => neutral(p),
      Is_Enemy: o => { const q = o && o.__player; return !!q && !neutral(q) && !neutral(p) && q.team !== p.team; },
      Is_Ally: o => { const q = o && o.__player; return !!q && q.team === p.team; },
      Get_Credits: () => p.credits,
      Select_Object: o => { const e = this.of(o); if (e && this.cmd.selectFor) this.cmd.selectFor(p, e); },
      Give_Money: n => { n = +n || 0; p.credits += n > 0 && p.adjust ? n * p.adjust.credit : n; },
      Get_Tech_Level: () => p.techLevel,
      Release_Credits_For_Tactical: amount => {
        const s = this.world.tacticalSessions?.[p.id]; if (!s || !s.ai) return;
        const left = s.reserve - s.released; let x = amount === undefined ? -1 : +amount; if (!Number.isFinite(x)) return;
        if (x < 0 || x >= left) x = left;
        p.credits = Math.max(0, p.credits + (x > 0 ? x * s.adjust : x));
        s.released = Math.min(s.reserve, s.released + x);
      },
      Get_Difficulty: () => LEVELS[p.difficulty] || 'Normal',
      Get_Space_Station: () => (p.station && !p.station.dead ? this.wrap(p.station) : undefined),
      Get_Enemy: () => { const foe = w.players.find(x => !neutral(x) && !neutral(p) && x !== p && x.team !== p.team); return foe ? this.player(foe) : undefined; },
      Retreat: () => !!w.retreat?.requestByFaction(p.factionName),
      Lock_Tech: o => { const t = o && o.__type; if (t) { (p.lockedTech ||= new Set()).add(t); if (p.unlockedTech) p.unlockedTech.delete(t); } },
      Unlock_Tech: o => { const t = o && o.__type; if (t) { (p.unlockedTech ||= new Set()).add(t); if (p.lockedTech) p.lockedTech.delete(t); } },
      __missing: this.absent('Player'),
    };
  }

  unitWrap(e) {
    const w = this.world, self = this;
    const members = () => (self.land && e.members && !e.mapMarker ? e.members.filter(u => !u.dead) : e.isSquad ? e.fighters : [e]);
    const place = (x, y, heading, z) => { const dx = x - e.x, dy = y - e.y; for (const u of members()) { u.x += dx; u.y += dy; if (z !== undefined && u.type) u.z = z + u.type.num('Layer_Z_Adjust', 0); if (heading !== undefined) u.heading = heading; if (u.syncObj) u.syncObj(); } if (e.isSquad && settable(e, 'x')) { e.x = x; e.y = y; } };
    const ab = name => { const u = lead(e); return u && u.abilities ? u.abilities.find(s => s.def.kind === String(name || '').toUpperCase()) : null; };
    const obj = {
      __wrap: true, __entity: e, __name: e.type.name,
      Is_Valid: () => !gone(e) || self.dying === e,
      Service_Wrapper: () => {},
      Get_Owner: () => self.player(e.player),
      Get_Type: () => self.type(e.scriptType || e.type),
      Get_Game_Scoring_Type: () => self.type(e.type),
      Get_Position: () => self.pos(e.x, e.y, e.z || 0),
      Get_Bone_Position: name => {
        const u = e.members?.[0] || lead(e) || e, inst = u && (u.inst || u.model), bone = name && inst?.bone ? inst.bone(String(name)) : null;
        if (!bone) return self.pos(e.x, e.y, e.z || 0);
        if (self.world.fixed && self.world.boneAt) { const v = self.world.boneAt(u, bone, { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }); return self.pos(v.x, v.y, v.z); }
        bone.updateWorldMatrix(true, false); const m = bone.matrixWorld.elements;
        let top = bone; while (top.parent) top = top.parent;
        if (top !== bone && !top.isScene && u.obj && top !== u.obj) {
          u.obj.updateWorldMatrix(true, false); const o = u.obj.matrixWorld.elements, x = m[12], y = m[13], z = m[14];
          return self.pos(o[0] * x + o[4] * y + o[8] * z + o[12], o[1] * x + o[5] * y + o[9] * z + o[13], o[2] * x + o[6] * y + o[10] * z + o[14]);
        }
        return self.pos(m[12], m[13], m[14]);
      },
      Get_Hull: () => { const u = lead(e); return u ? u.healthFrac : 0; },
      Get_Health: () => { const u = lead(e); return u ? u.healthFrac : 0; },
      Get_Shield: () => { const u = lead(e); return u && u.maxShield > 0 ? u.shield / u.maxShield : 0; },
      Get_Rate_Of_Damage_Taken: () => {
        const u = lead(e); if (!u) return 0;
        const now = w.time, total = u.health + (u.shield || 0), last = obj.__seen;
        obj.__seen = { t: now, total };
        if (!last || now - last.t < 0.05) return obj.__rate || 0;
        return (obj.__rate = Math.max(0, (last.total - total) / (now - last.t)));
      },
      Is_Category: name => { const u = lead(e), c = String(name || '').toUpperCase(); return !!u && c.split(/\s*\|\s*/).some(x => u.type.categories().has(x)); },
      Get_Parent_Object: () => { const u = e.isSquad ? null : e; return u && u.squad ? self.wrap(u.squad) : u && u.carrier ? self.wrap(u.carrier) : undefined; },
      Is_In_Garrison: () => !!(self.cmd.inGarrison && self.cmd.inGarrison(e)),
      Get_Garrisoned_Units: () => (self.cmd.garrisoned ? self.cmd.garrisoned(e).map(x => self.wrap(x)) : []),
      Can_Garrison: o => !!(self.cmd.canGarrison && self.cmd.canGarrison(e, self.of(o))),
      Garrison: o => { if (self.cmd.garrison) self.cmd.garrison(e, self.of(o)); },
      Leave_Garrison: () => { if (self.cmd.leaveGarrison) self.cmd.leaveGarrison(e); },
      Should_Switch_Weapons: o => shouldSwitch(body(e), body(self.of(o))),
      Fire_Special_Weapon: o => { const t = self.of(o); if (!e.isSpecialWeapon || !t || gone(t)) return undefined; return e.fire(t.squad || t) ? undefined : obj; },
      Turn_To_Face: o => { const p = self.at(o); if (!p) return; if(self.cmd.face)return self.cmd.face(e,p); for (const u of members()) { u.heading = Math.atan2(p.y - u.y, p.x - u.x); if (u.syncObj) u.syncObj(); } },
      Face_Immediate: o => obj.Turn_To_Face(o),
      Play_Animation: (name, loop, index) => { if (self.cmd.animate) self.cmd.animate(e, String(name || '').toUpperCase(), !!loop, +index || 0); },
      Has_Garrison: () => !!(self.cmd.garrisoned && self.cmd.garrisoned(e).length),
      Eject_Garrison: () => { if (self.cmd.leaveGarrison) self.cmd.leaveGarrison(e); },
      Get_Hint: () => { const u = lead(e), index=e.mapIndex??u?.mapIndex, o=index!==undefined&&self.game.map?self.game.map.objects[index]:null; return (o && o.hint) || e.hint || (e.point && e.point.hint) || (w.dynamicHints||w.w?.dynamicHints||[]).find(entry=>entry.object===e)?.hint || ''; },
      Disable_Capture: on => { if (e.point) e.point.locked = on !== false; },
      Reset_Ability_Counter: () => { for (const u of members()) for (const s of u.abilities || []) s.cooldown = 0; for (const s of e.abilities || []) s.cooldown = 0; },
      Force_Ability_Recharge: name => { const s = ab(name); if (s) s.cooldown = 0; },
      Set_Single_Ability_Autofire: (name, on) => { const s = ab(name); if (s) s.auto = on !== false; },
      Sell: () => { if (self.cmd.sell) self.cmd.sell(e); },
      Mark_Parent_Mode_Object_For_Death: () => { (this.world.parentModeDeaths ||= new Set()).add(e); },
      Get_Planet_Location: () => this.story?.planet(this.story.galaxy?.planets[this.story.game.setup.campaign?.planet]),
      Get_Attack_Target: () => { const u = lead(e), t = (e.order && e.order.kind === 'attack' && e.order.target) || (u && u.target); return t && !gone(t) ? self.wrap(t.squad || t) : undefined; },
      Get_Current_Projectile_Type: () => { const u = lead(e), h = u && (u.hardpoints || []).find(x => x.isWeapon && x.alive !== false && x.proj); const t = h ? h.proj : u && db.type(u.type.list('Projectile_Types')[0] || ''); return t ? self.type(t) : undefined; },
      Get_All_Projectile_Types: () => {
        const out = new Set(), u = lead(e);
        for (const n of u ? u.type.list('HardPoints') : []) { const h = db.hardpoint(n), t = h && db.type(h.str('Fire_Projectile_Type')); if (t) out.add(t); }
        for (const n of u ? u.type.list('Projectile_Types') : []) { const t = db.type(n); if (t) out.add(t); }
        return [...out].map(t => self.type(t));
      },
      Is_Affected_By_Missile_Shield: () => !!obj.Get_Type()?.Is_Affected_By_Missile_Shield(),
      Is_Affected_By_Laser_Defense: () => !!obj.Get_Type()?.Is_Affected_By_Laser_Defense(),
      Has_Active_Orders: () => { const u = e; return !!u.order && u.order.kind !== 'idle'; },
      Are_Engines_Online: () => { const u = lead(e); return !!u && (!u.engineAlive || u.engineAlive()); },
      Get_Distance: o => { const p = self.at(o); return p ? dist(e, p) : 1e9; },
      Is_Ability_Ready: name => { const s = ab(name); return !!s && !s.active && !(s.cooldown > 0); },
      Is_Tactical_Superweapon_Ready: () => !!self.world.tacticalSuperweapons?.ready(lead(e)),
      Fire_Tactical_Superweapon: () => !!self.world.tacticalSuperweapons?.fire(lead(e)),
      Is_Ability_Active: name => { const s = ab(name); return !!s && !!s.active; },
      Is_Ability_Autofire: name => { const s = ab(name); return !!s && !!s.auto; },
      Activate_Ability: (name, arg) => {
        const kind = String(name || '').toUpperCase();
        if (!ab(kind)) return;
        if (arg === false) self.cmd.ability(e, kind, false);
        else if (arg === true || arg === undefined) self.cmd.ability(e, kind, true);
        else { const t = self.of(arg) || self.at(arg); if (t) self.cmd.ability(e, kind, true, t); }
      },
      Move_To: o => { const p = self.at(o); if (!p) return undefined; self.cmd.move([e], p.x, p.y, false, true); return self.plans.block(() => gone(e) || !e.order || e.order.kind === 'idle' || dist(e, p) < 300); },
      Attack_Move: o => { const p = self.at(o); if (!p) return undefined; self.cmd.move([e], p.x, p.y, true, false); return self.plans.block(() => gone(e) || !e.order || e.order.kind === 'idle'); },
      Attack_Target: o => { const t = self.of(o); if (!t || gone(t)) return undefined; self.cmd.attack([e], t); return self.plans.block(() => gone(e) || gone(t)); },
      Guard_Target: o => { const t = self.of(o); if (!t || gone(t)) return undefined; self.cmd.guard([e], t); return self.plans.block(() => gone(e) || gone(t)); },
      Divert: o => { const p = self.at(o); if (!p || !e.order || e.order.kind !== 'move') return undefined; const b = obj.Move_To(o); (self.diverts ||= new WeakMap()).set(e, p); return b; },
      Is_On_Diversion: () => { const p = self.diverts && self.diverts.get(e), u = body(e); if (!p) return false; if (u && e.order && e.order.kind === 'move' && Math.hypot(u.x - p.x, u.y - p.y) > 40) return true; self.diverts.delete(e); return false; },
      Lock_Current_Orders: () => { self.lock(e); },
      Unlock_Current_Orders: () => { if (self.locks) self.locks.delete(e); },
      Set_Targeting_Priorities: name => { const set = namedSet(name); if (set) for (const b of (e.isSquad ? e.fighters : e.members) || [e]) if (b) b.prioSet = set; },
      Has_Attack_Target: () => { const u = lead(e); return !!(u && u.target && !u.target.dead); },
      Has_Property: name => !!lead(e) && hasProp(e.scriptType || lead(e).type, name),
      Has_Ability: name => !!ab(name),
      Is_Good_Against: o => { const a = lead(e), b = lead(self.of(o)); return !!(a && b && a.type && b.type && self.goodAgainst(a.scriptType || a.type, b.scriptType || b.type)); },
      Get_Game_Object: () => obj,
      Get_Time_Till_Dead: () => 1e6,
      Get_Build_Pad_Contents: () => { const c = self.cmd.padContents ? self.cmd.padContents(e) : e.padContents ? e.padContents() : e.padChild; return c && c.type ? self.wrap(c) : undefined; },
      Build: (type, check) => { const t = (type && type.__type) || db.type(String(type || '')); if (!t) { self.missing.set('Build: unknown type', (self.missing.get('Build: unknown type') || 0) + 1); return false; } return !!(self.cmd.build && self.cmd.build(e, t, check === true)); },
      Stop: () => self.cmd.stop([e]),
      Hide: on => { if (self.cmd.hide) return self.cmd.hide(e, on !== false); for (const u of members()) u.scriptHidden = on !== false; },
      Make_Invulnerable: on => { if (self.cmd.invulnerable) return self.cmd.invulnerable(e, on !== false); for (const u of members()) u.invulnerable = on !== false; },
      Set_Cannot_Be_Killed: on => { for (const u of members()) u.cannotDie = on !== false; },
      Prevent_All_Fire: on => { for (const u of members()) u.holdFire = on !== false; },
      Prevent_AI_Usage: on => { e.noAI = on !== false; },
      Suspend_Locomotor: on => { for (const u of members()) u.suspended = on !== false; },
      Set_Garrison_Spawn: on => { for (const u of members()) u.noGarrison = on === false; },
      Is_Selectable: () => e.selectable !== false,
      Is_In_Nebula: () => members().some(u => u.inNebula),
      Is_In_Asteroid_Field: () => members().some(u => u.inAsteroids),
      Is_In_Ion_Storm: () => members().some(u => u.inIon),
      Get_Contained_Object_Count: () => { const g = self.cmd.garrisoned ? self.cmd.garrisoned(e) : []; return g.length ? g.length : e.isSquad || (self.land && e.members) ? members().length : 0; },
      Override_Max_Speed: v => { for (const u of (self.land && e.members?.length ? e.members : members())) { const k = 'maxSpeed' in u ? 'maxSpeed' : 'speed', b = k === 'maxSpeed' ? 'baseMaxSpeed' : 'baseSpeed'; u[b] ??= u[k]; u[k] = +v > 0 ? +v * 30 * (self.land ? db.constants.num('Object_Max_Speed_Multiplier_Land', 1) : 1) : u[b]; } },
      Teleport: o => { const p = self.at(o); if (!p) return; if (self.cmd.teleport) return self.cmd.teleport(e, p.x, p.y, p.z); place(p.x, p.y, undefined, p.z); },
      Teleport_And_Face: o => {
        const p = self.at(o), t = self.of(o), heading = t && t.heading !== undefined ? t.heading : undefined; if (!p) return;
        if (!self.cmd.teleport) { place(p.x, p.y, heading, p.z); return; }
        self.cmd.teleport(e, p.x, p.y, p.z);
        if (heading !== undefined) { for (const u of members()) { u.heading = heading; if (u.syncObj) u.syncObj(); } if (e.mapMarker) e.heading = heading; if (self.land && !e.mapMarker) e.scriptHeading = heading; }
      },
      Change_Owner: o => { const p = o && o.__player; if (!p) return; if (self.cmd.owner) return self.cmd.owner(e, p); for (const u of members()) u.player = p; e.player = p; w.recountPop(); },
      Play_SFX_Event: name => { const owner = lead(e) ? lead(e).player : null; if (w.audio.playAt && owner && !self.localizedSFX) w.audio.playAt(owner, String(name || ''), e.x, e.y); else w.audio.play(String(name || ''), e.x, e.y); },
      Attach_Particle_Effect: name => {
        const t = db.type(String(name || '')), file = t ? t.str('Space_Model_Name') || t.str('Land_Model_Name') : String(name || '');
        const fx = self.game.renderer && self.game.renderer.fxParticles;
        if (fx && file) try { fx.spawn(file, f => { f.x = e.x; f.y = e.y; f.z = e.z || 0; f.rot = 0; f.scale = 1; f.vx = f.vy = 0; return !gone(e); }, { maxEmit: 4 }); } catch { }
      },
      Cinematic_Hyperspace_In: frames => { w.startHyperspace(e); for (const u of members()) { u.scriptHidden = false; if (u.hyper) u.hyper.f = Math.max(0, 25 - (+frames || 0)); } },
      Cancel_Hyperspace: () => { for (const u of members()) if (u.hyper) { u.x = u.hyper.tx; u.y = u.hyper.ty; u.hyper = null; u.obj.scale.setScalar(u.scale); u.obj.updateMatrix(); u.syncObj(); } if (e.isSquad) e.hyper = 0; },
      Hyperspace_Away: () => obj.Despawn(),
      Take_Damage: n => { if (self.cmd.damage) return self.cmd.damage(e, +n || 0); for (const u of e.isSquad ? e.fighters.slice() : [e]) if (!u.dead) w.damage(u, +n || 0, { quiet: true }); },
      Get_Parent_Mode_Object_ID: () => (typeof e.id === 'number' ? e.id : 0),
      Set_Importance: () => {},
      Set_Selectable: on => { if (self.cmd.selectable) return self.cmd.selectable(e, on !== false); for (const u of e.isSquad ? e.fighters : [e]) u.selectable = on !== false; e.selectable = on !== false; },
      Despawn: () => {
        for (const u of e.isSquad ? e.fighters.slice() : [e]) w.removeUnit(u);
        if (e.isSquad) { e.fighters.length = 0; e.dead = true; }
        w.recountPop();
      },
      Event_Object_In_Range: (fn, range, filter) => { const inst = self.current; if (inst && fn instanceof LuaRef) inst.prox.push({ fn, range: +range || 0, who: filter && filter.__player || null, of: e }); },
      Cancel_Event_Object_In_Range: () => { const inst = self.current; if (inst) inst.prox = inst.prox.filter(p => p.of !== e); },
      __missing: this.absent('Object'),
    };
    return obj;
  }

  globals() {
    const vm = this.vm, w = this.world, self = this;
    for (const n of NATIVES) vm.global(n, n.startsWith('_') ? () => {} : () => { this.missing.set(n, (this.missing.get(n) || 0) + 1); });
    vm.global('Add_Objective', (id, flag) => { if (typeof id !== 'string' || typeof flag !== 'boolean') throw new Error('Add_Objective -- expected a text id and a boolean'); this.story?.objectives.add(id, flag); });
    vm.global('Start_Cinematic_Space_Retreat', (id, seconds) => { this.game.startCinematicRetreat?.(Number(id), Number(seconds)); });
    const hollow = this.hollow = kind => { const o = { __wrap: true, __name: kind, __hollow: kind, Is_Valid: () => true }; o.__missing = name => (/^[A-Z]/.test(name) ? (() => { const k = kind + '.' + name; this.missing.set(k, (this.missing.get(k) || 0) + 1); return /^(Create|Get|Find|Parse)/.test(name) ? hollow(kind) : undefined; }) : undefined); return o; };
    vm.global('SFXManager',hollow('SFXManager'));
    vm.global('Thread',{__wrap:true,__name:'Thread',Kill:id=>{const inst=this.current,t=inst?.threads.find(t=>t.id===id);if(t&&t!==inst.running){vm.free(t.ref);inst.threads=inst.threads.filter(x=>x!==t);}},__missing:this.absent('Thread')});
    vm.global('DiscreteDistribution', this.distributions = { __wrap: true, __name: 'DiscreteDistribution', __missing: this.absent('DiscreteDistribution'), Create: () => {
      const items = [];
      return {
        __wrap: true, __name: 'DiscreteDistribution', __dist: items, Is_Valid: () => true, __missing: this.absent('DiscreteDistribution'),
        Insert: (value, weight) => { items.push([value, Math.max(0, +weight || 0)]); },
        Sample: () => { let sum = 0; for (const [, x] of items) sum += x; let r = simRandom() * sum; for (const [v, x] of items) { r -= x; if (r <= 0) return v; } return items.length ? items[items.length - 1][0] : undefined; },
      };
    } });
    vm.global('Game_Message', id => { const t = db.t(String(id || '')) || String(id || ''); if (t && this.game.message) this.game.message(t); });
    vm.global('Enable_Fog', on => { if (this.land && typeof on === 'boolean') (w.game || this.game).environmentFogEnabled = on; });
    vm.global('Enable_Distance_Fog', (...args) => {
      const [on] = args;
      const environment = (w.game || this.game).map?.environment;
      if (args.length === 1 && typeof on === 'boolean' && environment?.fog) environment.fog.on = on;
    });
    vm.global('Hide_Object', (o, on) => { const x = this.wrap(this.of(o)); if (x && x.Hide) x.Hide(on !== 0 && on !== false); });
    vm.global('Check_Story_Flag', () => false);
    vm.global('Get_Story_Plot', name => this.story?.plotWrapper(name));
    vm.global('Story_Event', name => this.story?.signal('STORY_AI_NOTIFICATION',name));
    vm.global('FindPlanet',{__wrap:true,__name:'FindPlanet',__call:name=>this.story?.planet(this.story.galaxy?.planets.find(p=>p.name.toUpperCase()===String(name).toUpperCase())),Get_All_Planets:()=>this.story?.galaxy?.planets.filter(p=>!p.background).map(p=>this.story.planet(p))||[]});
    const weighted = () => {
      const list = [];
      const kinds = [];
      const add = (t, wgt) => { const ty = typeOf(t); if (ty) list.push([ty, +wgt || 0]); else if (typeof t === 'string' && t.trim()) kinds.push([t.trim().toUpperCase(), +wgt || 0]); };
      return {
        __wrap: true, __name: 'WeightedTypeList', __weighted: list, __kinds: kinds, Is_Valid: () => true,
        Parse: (names, weights) => {
          if (Array.isArray(names)) names.forEach((n, i) => add(n, Array.isArray(weights) ? weights[i] : weights));
          else { const parts = String(names || '').split(',').map(x => x.trim()).filter(Boolean); if (Array.isArray(weights)) parts.forEach((n, i) => add(n, weights[i])); else for (let i = 0; i + 1 < parts.length; i += 2) add(parts[i], parts[i + 1]); }
        },
        Add_Type: add,
        Get_Count: () => list.length,
        Get_Weight: t => { const ty = typeOf(t), e = list.find(x => x[0] === ty); return e ? e[1] : 0; },
        Get_Type_At: i => (list[+i - 1] ? this.type(list[+i - 1][0]) : undefined),
        __missing: this.absent('WeightedTypeList'),
      };
    };
    vm.global('WeightedTypeList', this.weightedLists = { __wrap: true, __name: 'WeightedTypeList', Create: weighted, __missing: this.absent('WeightedTypeList') });
    vm.global('Find_Hint', (type,hint) => {
      const t=typeOf(type);if(!t)return undefined;
      return this.wrap(hintedObjects(this,t,hint)[0]);
    });
    vm.global('Find_All_Objects_With_Hint', (...args) => args.length===1&&typeof args[0]==='string'?hintedObjects(this,null,args[0]).map(o=>this.wrap(o)):undefined);
    const typeOf = n => (n && n.__type) || db.type(String(n || ''));
    const playerOf = n => (n && n.__player) || null;
    const live = () => [...w.selectables()].filter(e => !gone(e));
    vm.global('Hide_Sub_Object', (o, hide, name) => {
      const e = this.of(o), want = String(name || '').toUpperCase(), off = !(hide === 0 || hide === false);
      if (!e || !want) return;
      for (const u of e.isSquad ? e.fighters : e.members && e.members.length ? e.members : [e]) {
        const inst = u.model || u.inst;
        if (!inst || !inst.meshByName) continue;
        for (const [k, node] of inst.meshByName) if (k === want || k.startsWith(want + '#')) { node.visible = !off; node.userData.hidByBone = false; node.userData.scriptHid = off; }
      }
    });
    vm.global('Get_Game_Mode', () => (this.land ? 'Land' : 'Space'));
    vm.global('Set_New_Environment', n => { this.game.setEnvironmentIndex?.(Number(n) || 0); });
    vm.global('Play_Lightning_Effect', (name, from, to) => {
      const lw = w.w, a = this.at(from), b = this.at(to), def = lw?.tables?.lightning?.get(String(name || '').toUpperCase());
      if (!lw?.bolts || !a || !b || !def) return;
      lw.bolts.push({ a: { x: a.x, y: a.y, z: a.z || 0, aimZ: 0 }, b: { x: b.x, y: b.y, z: b.z || 0, aimZ: 0 }, effect: name, until: lw.time + def.bolts * def.every[1] + 1e-3 });
    });
    this.localizedSFX = false;
    vm.global('Allow_Localized_SFX', on => { if (this.land) this.localizedSFX = on === true || on === 1; });
    vm.global('Create_Position', (x, y, z) => this.pos(+x || 0, +y || 0, +z || 0));
    vm.global('StringCompare', (a, b) => String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase());
    vm.global('Is_Multiplayer_Mode', () => !!(this.game && this.game.setup && this.game.setup.net));
    vm.global('Is_Campaign_Game', () => !!this.game?.setup?.campaign);
    vm.global('GetThreadID', () => 0);
    vm.global('_ScriptExit', () => { if (this.current) this.current.exit = true; });
    vm.global('GetCurrentTime', { __wrap: true, __name: 'GetCurrentTime', __call: () => this.current?.story?this.storyTime:w.time, Frame: () => this.current?.story?Math.fround(Math.fround(Math.floor(w.time*30+1e-6))*Math.fround(1/30)):Math.round(w.time * 30) });
    vm.global('GameRandom', { __wrap: true, __name: 'GameRandom', __call: (a, b) => Math.floor(a + simRandom() * (b - a + 1)), Free_Random: (a, b) => Math.floor(a + simRandom() * (b - a + 1)), Get_Float: (a = 0, b = 1) => a + simRandom() * (b - a) });
    vm.global('GlobalValue', { __wrap: true, __name: 'GlobalValue', Get: k => this.values.get(String(k)), Set: (k, v) => { this.values.set(String(k), v); } });
    vm.global('Find_Player', name => {
      const n = String(name || '').toUpperCase();
      if (n === 'LOCAL') return this.player(this.game.setup?.net ? w.players.find(p => p.human) || this.game.human : this.game.human);
      if (n === 'NEUTRAL') return this.player(w.neutral);
      return this.player(w.players.find(p => p.factionName.toUpperCase() === n) || this.campaignPlayer(n));
    });
    vm.global('Evaluate_In_Galactic_Context', (name, player) => {
      const table = this.game.setup?.campaign?.galacticPerceptions, p = player && player.__player;
      if (!table || !p) return undefined;
      const value = table[String(p.factionName || '').toUpperCase()]?.[String(name || '').toUpperCase()];
      return typeof value === 'number' ? value : undefined;
    });
    vm.global('Find_Object_Type', n => this.type(typeOf(n)));
    vm.global('Find_First_Object', n => { const t = typeOf(n); return t ? this.wrap(live().find(e => e.type === t || e.scriptType === t || (lead(e) && lead(e).type === t))) : undefined; });
    vm.global('Find_All_Objects_Of_Type', (a, b) => {
      const p = playerOf(a), t = p ? null : typeOf(a), cat = p && b ? String(b).toUpperCase() : null;
      if (!p && !t && typeof a === 'string') { const of = playerOf(b); return live().filter(e => lead(e) && hasProp(e.scriptType || lead(e).type, a) && (!of || e.player === of)).map(e => this.wrap(e)); }
      return live().filter(e => (t ? e.type === t || e.scriptType === t || (lead(e) && lead(e).type === t) : p ? e.player === p && (!cat || lead(e).type.categories().has(cat)) : false)).map(e => this.wrap(e));
    });
    const lua = vm.lua;
    const spawnUnit = L => {
      const t = typeOf(vm.get(1, L)), where = vm.get(2, L), at = this.at(where), p = playerOf(vm.get(3, L));
      const now = () => {
        if (!t || !at || !p) return [];
        const from = this.of(where), e = w.spawn(t, p, at.x, at.y, from && from.heading !== undefined ? from.heading : 0);
        return e ? [this.wrap(e)] : [];
      };
      if (this.game.spawnNow) { const e = t && at && p ? this.game.spawnNow(t, p, at) : null; vm.push(e ? [this.wrap(e)] : [], L); return 1; }
      return whenArt(L, t, now);
    };
    const whenArt = (L, t, now) => {
      const wait = t && this.game.artFor ? this.game.artFor(t) : null, inst = this.current;
      if (wait && inst && inst.thread && L === inst.thread.co) {
        const hold = inst.blocked = { ready: false };
        wait.then(() => { hold.ready = true; });
        return lua.lua_yieldk(L, 0, 0, L2 => { inst.blocked = null; vm.push(now(), L2); return 1; });
      }
      vm.push(now(), L);
      return 1;
    };
    spawnUnit.__raw = true;
    vm.global('Spawn_Unit', spawnUnit);
    const createObject = L => {
      const t = typeOf(vm.get(1, L)), at = this.at(vm.get(2, L)), p = playerOf(vm.get(3, L));
      if (!t || !at || !p) { vm.push(undefined, L); return 1; }
      if (this.game.spawnNow) { const e = this.game.spawnNow(t, p, at); vm.push(e ? this.wrap(e) : undefined, L); return 1; }
      return whenArt(L, t, () => this.wrap(w.spawn(t, p, at.x, at.y, 0)));
    };
    const reinforceUnit = L => {
      const t = typeOf(vm.get(1, L)), at = this.at(vm.get(2, L)), p = playerOf(vm.get(3, L));
      if (!t || !at || !p) { vm.push(undefined, L); return 1; }
      return whenArt(L, t, () => this.wrap(w.spawn(t, p, at.x, at.y, 0, { hyperspace: true })));
    };
    createObject.__raw = reinforceUnit.__raw = true;
    vm.global('Create_Generic_Object', createObject);
    vm.global('Reinforce_Unit', reinforceUnit);
    const nearest = (from, pred) => { let best = null, bd = 1e18; for (const e of live()) { if (e === from || !pred(e)) continue; const d = dist(e, from); if (d < bd) { bd = d; best = e; } } return best; };
    const worth = u => { const l = lead(u); return l ? l.type.num('AI_Combat_Power', 0) * (l.healthFrac ?? 1) || 1 : 0; };
    vm.global('Find_Best_Local_Threat_Center', (list, radius) => {
      const us = (Array.isArray(list) ? list : []).map(o => this.of(o)).filter(e => !gone(e)), r = +radius || 300;
      let best = null, top = 0;
      for (const a of us) { let s = 0, x = 0, y = 0, n = 0; for (const b of us) if (dist(a, b) <= r) { s += worth(b); x += b.x; y += b.y; n++; } if (s > top) { top = s; best = { x: x / n, y: y / n }; } }
      return best ? new Multi(this.pos(best.x, best.y, 0), top) : new Multi(undefined, 0);
    });
    vm.global('Get_Most_Defended_Position', (o, player) => {
      const from = this.at(o), p = playerOf(player);
      if (!from || !p) return undefined;
      const own = w.units.filter(u => !u.dead && u.player.team === p.team && !u.isPad && !u.isFighter);
      let best = null, top = 0;
      for (const a of own) { if (dist(a, from) > 6000) continue; let s = 0; for (const b of own) if (dist(a, b) <= 1200) s += worth(b) * (b.isStructure ? 3 : 1); if (s > top) { top = s; best = a; } }
      return best ? this.pos(best.x, best.y, 0) : undefined;
    });
    vm.global('FogOfWar', {
      __wrap: true, __name: 'FogOfWar', __missing: this.absent('FogOfWar'),
      Reveal_All: player => { const p = playerOf(player); if (!p) return undefined; const r = { team: p.team, pl: p, x: 0, y: 0, r: 1e7, until: Infinity, by: this.current, env: this.current && this.current.env }; w.reveals.push(r); return this.revealWrap(r); },
      Reveal: (player, where, radius) => { const p = playerOf(player), at = this.at(where); if (!p || !at) return undefined; const r = { team: p.team, pl: p, x: at.x, y: at.y, r: +radius || 500, until: Infinity, by: this.current, env: this.current && this.current.env }; w.reveals.push(r); return this.revealWrap(r); },
    });
    vm.global('FindDeadlyEnemy', o => {
      const us = o && o.__force ? o.__force.units : [this.of(o)].filter(Boolean);
      const sum = new Map();
      for (const e of us) for (const u of (e.isSquad ? e.fighters : e.members || [e])) for (const [who, rec] of u.hurtBy || []) {
        const v = rec.v * Math.exp(-(w.time - rec.at) / HARM_FADE);
        if (v > 0.5 && !gone(who)) sum.set(who, (sum.get(who) || 0) + v);
      }
      let best = null, bv = 0;
      for (const [who, v] of sum) if (v > bv) { bv = v; best = who; }
      return best ? this.wrap(best.squad && (best.squad.isSquad || best.squad.members) ? best.squad : best) : undefined;
    });
    vm.global('Project_By_Unit_Range', (unit, place) => {
      const a = this.at(unit), b = this.at(place);
      if (!a || !b) return undefined;
      const u = unit && unit.__force ? lead(unit.__force.units[0]) : lead(this.of(unit)), d = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(d > 1e-6)) return undefined;
      const reach = (u && (u.maxRange || u.range)) || 800;
      return this.pos(b.x + (b.x - a.x) / d * reach, b.y + (b.y - a.y) / d * reach, 0);
    });
    vm.global('Find_Nearest_Space_Field', (o, kind) => {
      const a = this.at(o), k = String(kind || '').toUpperCase();
      let best = null, bd = 1e18;
      for (const f of a ? w.fields : []) { if (k === 'ASTEROID' ? !f.asteroid : k === 'NEBULA' ? !f.nebula : false) continue; const d = Math.hypot(f.x - a.x, f.y - a.y); if (d < bd) { bd = d; best = f; } }
      return best ? this.pos(best.x, best.y, 0) : undefined;
    });
    const findTarget = (who, perception, kinds, fraction = 1, reach = 0, rc = null) => {
      const inst = this.current, ai = (who && who.__force && who.__force.inst.ai) || (inst && inst.ai), mind = ai && ai.mind;
      if (!mind) return undefined;
      const want = String(kinds || '').toUpperCase(), from = this.at(who), name = String(perception || '').toUpperCase(), p = ai.player;
      const cands = [], list = ai.findable ? ai.findable(want) : null;
      if (list) for (const { t, thing } of list) cands.push({ t, out: () => (thing ? this.wrap(thing) : this.pos(t.x, t.y, 0)), at: t });
      else {
      if (/LOCATION/.test(want)) for (const pl of ai.places) cands.push({ t: pl, out: () => this.pos(pl.x, pl.y, 0), at: pl });
      const units = (foe, struct) => { for (const u of w.units) { if (u.dead || u.player.id < 0 || u.isPad || (u.squad && u.squad.fighters[0] !== u)) continue; if ((u.player.team !== p.team) !== foe || !!u.isStructure !== struct) continue; if (foe && ai.enemies && !ai.enemies.includes(u)) continue; cands.push({ t: (ai.targetOf || mindTarget.unit)(u), out: () => this.wrap(u.squad || u), at: u }); } };
      if (/ENEMY_UNIT|ENEMY(?!_)/.test(want)) units(true, false);
      if (/ENEMY_STRUCTURE|ENEMY(?!_)/.test(want)) units(true, true);
      if (/FRIENDLY_UNIT|FRIENDLY(?!_)/.test(want)) units(false, false);
      if (/FRIENDLY_STRUCTURE|FRIENDLY(?!_)/.test(want)) units(false, true);
      }
      let best = [], top = -Infinity;
      for (const c of cands) {
        if (reach > 0 && from && Math.hypot(c.at.x - from.x, c.at.y - from.y) > reach) continue;
        if (rc && !reachableFrom(mind, rc, c.t)) continue;
        const v = mind.fn(name, c.t);
        if (!(v > 0)) continue;
        c.v = v; best.push(c); if (v > top) top = v;
      }
      best = best.filter(c => c.v >= top * Math.min(1, Math.max(0, +fraction || 1)) - 1e-9);
      return best.length ? best[Math.floor(simRandom() * best.length)].out() : undefined;
    };
    const reachableFrom = (mind, rc, t) => {
      if (!mind.route || !mind.zoneOf || !t || !t.zone || !rc.from) return true;
      const k = ['NO_THREAT', 'LOW_THREAT', 'MEDIUM_THREAT', 'HIGH_THREAT', 'ANY_THREAT'].indexOf(rc.name);
      if (k < 0) return false;
      if (k === 4) return true;
      const tol = k === 0 ? 0 : db.constants.num(['Low_Threat_Reachability_Tolerance', 'Medium_Threat_Reachability_Tolerance', 'High_Threat_Reachability_Tolerance'][k - 1], 1000);
      const r = mind.route(mind.zoneOf(rc.from.x, rc.from.y), t.zone);
      return r >= 0 && Math.floor(r / 65536) * 100 <= tol;
    };
    vm.global('Purge_Goals', player => {
      const p = playerOf(player), me = this.current;
      for (const inst of this.plans.live) if (inst !== me && inst.ai.player === p && inst.state === 'run' && !inst.flags?.buys && inst.forces.some(f => f.specs.length)) inst.purged = true;
    });
    vm.global('FindTarget', { __wrap: true, __name: 'FindTarget', __call: findTarget, Reachable_Target: (player, perception, kinds, reachability, fraction, origin, most) => findTarget(origin || player, perception, kinds, fraction, +most || 0, origin ? { name: String(reachability || '').toUpperCase(), from: this.at(origin) } : null), __missing: this.absent('FindTarget') });
    this.messages = new Map();
    vm.global('_CustomScriptMessage', (file, text) => { const k = String(file || ''); let l = this.messages.get(k); if (!l) this.messages.set(k, (l = [])); if (l.length < 20000) l.push(String(text)); });
    vm.global('Find_Nearest', (o, a, b, c) => {
      const e = this.of(o) || this.at(o); if (!e) return undefined;
      const name = typeof a === 'string' ? a.trim().toUpperCase() : '', names = name.split('|').map(n => n.trim()).filter(Boolean), p = playerOf(name ? b : a), mine = (name ? c : b) !== false;
      const kindOf = x => { const u = lead(x), t = u && (u.scriptType || u.type); if (!t) return false; const c = x.cats ? x.cats() : t.categories(); return names.some(n => hasProp(t, n) || c.has(n) || t.name.toUpperCase() === n); };
      return this.wrap(nearest(e, x => (!name || kindOf(x)) && !x.isPad && x.player!==w.neutral && x.player.id >= 0 && (!p || ((mine ? x.player.team === p.team : x.player.team !== p.team) && (!w.fog || mine || w.canSee(p, lead(x) || x))))));
    });
    vm.global('EvaluatePerception', (name, player, tgt) => {
      const p = playerOf(player), brain = p && this.brains.get(p);
      if (this.game.perceive) return this.game.perceive(p, String(name || '').toUpperCase(), this.of(tgt));
      if (!brain) return 0;
      const mind = (this.minds ||= new Map()).get(p) && this.mindAt === w.time ? this.minds.get(p) : null;
      const m = mind || new SpaceMind(brain, w, p, { enemies: w.units.filter(u => !u.dead && u.player.id >= 0 && u.player.team !== p.team && u.targetableUnit) });
      if (!mind) { if (this.mindAt !== w.time) this.minds.clear(); this.mindAt = w.time; this.minds.set(p, m); }
      const e = this.of(tgt), u = lead(e);
      return m.fn(String(name || '').toUpperCase(), u ? mindTarget.unit(u) : null);
    });
  }

  losses() {
    const inst = this.scoring, vm = this.vm, w = this.world;
    if (!inst || inst.state !== 'run' || inst.env === undefined) return null;
    if (!inst.asksLosses) {
      inst.asksLosses = true;
      vm.run('function __Losses(pid) local all = TacticalKillStatsTable; local t = all and death_index and all[death_index] and all[death_index][pid]; local out = {}; if type(all) ~= "table" then return nil end; if t then for ty, pe in pairs(t) do table.insert(out, ty.Get_Name()); table.insert(out, pe.kills) end end; return out end', 'losses', inst.env);
    }
    const out = new Map();
    for (const p of w.players) {
      if (p.id < 0) continue;
      const r = vm.call(inst.env, '__Losses', p.id);
      if (!r.ok || !Array.isArray(r.value)) return null;
      const m = out.get(p.team) || out.set(p.team, new Map()).get(p.team);
      for (let i = 0; i + 1 < r.value.length; i += 2) { const t = db.type(String(r.value[i])); if (t) m.set(t, (m.get(t) || 0) + (+r.value[i + 1] || 0)); }
    }
    return out;
  }

  tell(name, ...args) {
    const inst = this.scoring;
    if (!inst || inst.state === 'over') return undefined;
    if (inst.state !== 'run') { if (this.told.length < 400) this.told.push([name, args]); return undefined; }
    this.current = inst;
    let r;
    try { r = this.vm.call(inst.env, name, ...args); } finally { this.current = null; }
    if (!r.ok && !r.missing) this.errors.set('GameScoring.' + name, r.error);
    return r.ok ? r.value : undefined;
  }

  contrast() {
    if (this.contrastTable) return this.contrastTable;
    const src = this.source('PGAICOMMANDS');
    if (src === undefined) return null;
    const table = new Map();
    if (typeof src === 'string') {
      const vals = new Map();
      const env = this.vm.environment({
        __contrast: (kind, list) => { if (list && list.__weighted) table.set(String(kind || '').toUpperCase(), { types: new Map(list.__weighted), kinds: list.__kinds || [] }); },
        Script: { __wrap: true, __name: 'PGAICommands', Get_Name: () => 'PGAICommands', Debug_Should_Issue_Event_Alert: () => false, __missing: this.absent('Script') },
        ThreadValue: { __wrap: true, __name: 'ThreadValue', __call: k => vals.get(String(k)), Get: k => vals.get(String(k)), Set: (k, v) => { vals.set(String(k), v); }, Reset: () => vals.clear() },
        GetEvent: { __wrap: true, __name: 'GetEvent', Reset: () => {}, __call: () => undefined, Params: () => undefined },
      });
      try {
        const err = this.vm.run(src, 'PGAICommands', env);
        if (err && String(err).includes('@@need')) { this.vm.free(env); return null; }
        this.vm.set(env, 'PlanDefinitionLoad', true);
        this.vm.call(env, 'Base_Definitions');
        this.vm.run('for i, e in pairs(EnemyContrastTypes or {}) do __contrast(e, FriendlyContrastTypes[i]) end', 'contrast', env);
      } finally { this.vm.free(env); }
    }
    if (table.size || typeof src !== 'string') this.contrastTable = table;
    return table;
  }

  goodAgainst(mine, theirs) {
    const table = this.contrast();
    if (!table) return false;
    let most = 0;
    const kinds = mine.categories();
    for (const k of theirs.categories()) {
      const list = table.get(k);
      if (!list) continue;
      let v = list.types.get(mine);
      if (v === undefined) { v = 1; for (const [name, wgt] of list.kinds) if (wgt !== 1 && kinds.has(name)) { v = wgt; break; } }
      if (v > most) most = v;
    }
    return most > 1;
  }

  logged(cmd) {
    const host = this;
    const log = (kind, us, text) => {
      const i = host.current, u = us && us[0], side = (i && (i.ai || i.player)) || (u && (u.player || host.game.world?.sidePlayers?.[u.side]));
      D.log(kind, host.land ? 'L' : 'S', host.world.time, who(side), (i && i.plan && i.goal ? i.goal + ': ' : '') + group(us) + ' ' + text, !i ? '' : i.plan ? 'plan' : i.fs ? 'freestore' : 'story');
    };
    const out = { ...cmd };
    if (cmd.move) out.move = (us, x, y, attack, exact) => { if (D.on) log(attack ? 'attackmove' : 'move', us, (attack ? 'attack-move' : 'move') + ' to ' + targetOf({ x, y })); return cmd.move(us, x, y, attack, exact); };
    if (cmd.attack) out.attack = (us, t) => { if (D.on) log('attack', us, 'attack ' + nameOf(t)); return cmd.attack(us, t); };
    if (cmd.guard) out.guard = (us, t) => { if (D.on) log('guard', us, 'guard ' + nameOf(t)); return cmd.guard(us, t); };
    if (cmd.stop) out.stop = us => { if (D.on) log('stop', us, 'stop'); return cmd.stop(us); };
    if (cmd.ability) out.ability = (e, kind, on, t) => { if (D.on) log('ability', [e], (on === false ? 'off ' : 'use ') + kind + (t ? ' on ' + targetOf(t) : '')); return cmd.ability(e, kind, on, t); };
    if (cmd.garrison) out.garrison = (e, t) => { if (D.on) log('move', [e], 'garrison into ' + nameOf(t)); return cmd.garrison(e, t); };
    return out;
  }

  freeStore(player, name, units, ai = null) {
    const had = this.instances.find(i => i.fs && i.player === player);
    if (!name || (had && !had.restored)) return;
    const inst = had || { global: true, fs: true, player, ai, name, key: name.toUpperCase(), state: 'new', next: 0, prox: [], events: [], values: new Map(), exit: false, mainAt: 0 };
    inst.ai = ai;
    inst.setup = () => {
      this.vm.set(inst.env, 'PlayerObject', this.player(player));
      this.vm.set(inst.env, 'FreeStore', this.freeStoreWrap(inst));
    };
    const due = new WeakMap();
    let phase = 0;
    inst.pollEachStep = true;
    inst.poll = () => {
      if (!inst.mainAt) return;
      const time = this.world.time, every = inst.rate;
      this.current = inst;
      try {
        for (const e of units()) {
          if (gone(e) || this.locked(e)) continue;
          let at = due.get(e);
          if (at === undefined) due.set(e, (at = time + (phase++ % 8) / 8 * every));
          if (time < at) continue;
          due.set(e, time + every);
          const before = e.order;
          const r = this.vm.call(inst.env, 'On_Unit_Service', this.wrap(e));
          if (!r.ok && !r.missing) { this.errors.set(name + '.On_Unit_Service', r.error); break; }
          if (e.order && e.order !== before) { e.order.fs = true; e.fsKind = e.order.kind; }
        }
      } finally { this.current = null; }
    };
    if (had) { had.restored = false; return; }
    this.add(inst);
  }

  freeStoreWrap(inst) { return (inst.fsWrap ||= { __wrap: true, __name: 'FreeStore', __fsOf: inst, __missing: this.absent('FreeStore'), Get_Name: () => inst.name }); }

  attach() {
    const w = this.world;
    for (const e of [...w.units, ...(w.squads || [])]) {
      if (e.scripted || e.dead) continue;
      e.scripted = true;
      const type = e.scriptType || e.type, name = type.str('Lua_Script');
      if (!name || this.inert.has(type)) continue;
      this.add({ e, name, key: name.toUpperCase(), state: 'new', next: 0, prox: [], events: [], values: new Map(), exit: false });
    }
  }

  start(inst) {
    const vm = this.vm, src = this.source(inst.key);
    if (src === undefined) return false;
    if (src === null) { inst.state = 'over'; return false; }
    const need = msg => typeof msg === 'string' && msg.includes('@@need');
    const fail = (where, msg) => { if (need(msg)) { this.drop(inst); inst.state = 'new'; return false; } this.errors.set(inst.name, where + ': ' + msg); this.drop(inst); inst.state = 'over'; return false; };
    inst.prox = []; inst.events = []; inst.values.clear(); inst.exit = false; inst.threads = []; inst.threadIds = 0; inst.running = null;
    this.makeEnv(inst);
    this.current = inst;
    try {
      const err = vm.run(src, inst.name, inst.env);
      if (err) return fail('load', err);
      const d = vm.call(inst.env, 'Base_Definitions');
      if (!d.ok && !d.missing) return fail('Base_Definitions', d.error);
      return this.started(inst);
    } finally { this.current = null; }
  }

  makeEnv(inst) {
    const vm = this.vm;
    const values = {
      Script: { __wrap: true, __name: inst.name, Get_Name: () => inst.name, Debug_Should_Issue_Event_Alert: () => false, __missing: this.absent('Script') },
      ThreadValue: (() => { const of = () => { const t = inst.running || inst; return (t.values ||= new Map()); };
        return { __wrap: true, __name: 'ThreadValue', __call: k => of().get(String(k)), Get: k => of().get(String(k)), Set: (k, v) => { of().set(String(k), v); }, Reset: () => of().clear() }; })(),
      Create_Thread: Object.assign((name, arg) => {
        const t = vm.thread(inst.env, String(name));
        if (!t) return -1;
        t.id = ++inst.threadIds; t.arg = arg; t.values = new Map();
        inst.threads.push(t);
        return t.id;
      }, {}),
      GetEvent: {
        __wrap: true, __name: 'GetEvent', Reset: () => { inst.events.length = 0; },
        __call: () => { const ev = inst.events.shift(); inst.params = ev ? ev.params : undefined; return ev ? ev.fn : undefined; },
        Params: () => inst.params,
      },
    };
    inst.env = vm.environment(values);
    this.persistence?.owned(inst, values);
    return inst.env;
  }

  started(inst) {
    const vm = this.vm;
    const fail = () => { this.drop(inst); inst.state = 'over'; return false; };
    {
      if (inst.e) vm.set(inst.env, 'Object', this.wrap(inst.e));
      if (inst.setup) inst.setup();
      if (inst.begin) {
        if (!inst.begin()) return fail();
        inst.thread = null; inst.state = 'run'; inst.services = 0;
        return true;
      }
      inst.thread = vm.thread(inst.env, 'main');
      if (!inst.thread&&!inst.story) return fail();
      inst.rate = Math.max(inst.story?1/30:0.05, +vm.read(inst.env, 'ServiceRate') || (inst.story?0.2:1));
      if (inst.fs) { inst.mainEvery = inst.rate; inst.rate = Math.max(0.25, +vm.read(inst.env, 'UnitServiceRate') || 2); }
      inst.state = 'run'; inst.services = 0;
      return true;
    }
  }

  drop(inst) {
    if (inst.thread) { this.vm.free(inst.thread.ref); inst.thread = null; }
    for (const t of inst.threads || []) this.vm.free(t.ref);
    inst.threads = [];
    if (inst.fns) { for (const r of inst.fns.values()) if (r) this.vm.free(r); inst.fns.clear(); }
    if (inst.events) inst.events.length = 0;
    if (inst.env !== undefined) { this.vm.free(inst.env); inst.env = undefined; }
  }

  service(inst) {
    const vm = this.vm, w = this.world, e = inst.e;
    const clock=inst.story?this.storyTime:w.time;
    if (!inst.global && gone(e)) { this.drop(inst); inst.state = 'over'; return; }
    if (inst.blocked) { if (!inst.blocked.ready) { inst.next = clock + 0.1; return; } }
    else for (const p of inst.prox) {
      if (gone(p.of)) continue;
      let n = 0;
      for (const o of w.selectables()) {
        if (o === p.of || gone(o) || (p.who && o.player !== p.who) || dist(o, p.of) > p.range) continue;
        inst.events.push({ fn: p.fn, params: [this.wrap(p.of), this.wrap(o)] });
        if (++n >= 6) break;
      }
    }
    if (inst.poll && !inst.pollEachStep) inst.poll();
    this.current = inst;
    let r;
    try {
      if (inst.fs && w.time < inst.mainAt) r = { done: false };
      else { r = inst.thread ? vm.resume(inst.thread) : { done: false }; if (inst.fs) inst.mainAt = w.time + inst.mainEvery; }
      if (!inst.blocked) for (const t of inst.threads.slice()) {
        inst.running = t;
        const tr = vm.resume(t, t.arg);
        inst.running = null;
        if (tr.error && tr.error.includes('@@need')) { r = { done: true, error: tr.error }; break; }
        if (tr.done || tr.value === false) { if (tr.error && !inst.exit) this.errors.set(inst.plan ? inst.name : inst.name + ' (thread)', tr.error); vm.free(t.ref); inst.threads = inst.threads.filter(x => x !== t); }
      }
    } finally { this.current = null; inst.running = null; }
    if (inst.blocked && !r.done) { inst.next = clock + 0.1; return; }
    inst.services++;
    if (r.error && r.error.includes('@@need')) { this.drop(inst); inst.state = inst.story?'over':'new'; if(inst.story)this.errors.set(inst.name,'Runtime module was not prefetched; story stopped to prevent replay: '+r.error); return; }
    if (r.error && !inst.exit) this.errors.set(inst.name, r.error);
    if (r.done || r.value === false || inst.exit || (inst.plan && !inst.threads.length)) {
      if (inst.services === 1 && !r.error && e) this.inert.add(e.scriptType || e.type);
      this.drop(inst); inst.state = 'over';
    }
  }

  async prime() {
    const w = this.world;
    this.attach();
    const mine = this.instances.filter(i => i.e && !i.plan && !i.story && !i.fs && i.state === 'new');
    for (let round = 0; round < 8; round++) {
      for (const inst of mine) if (inst.state === 'new') this.source(inst.key);
      while (this.fetching) await new Promise(r => setTimeout(r, 10));
      let waiting = 0;
      for (const inst of mine) {
        if (inst.state !== 'new') continue;
        if (this.start(inst)) { inst.next = w.time + inst.rate; this.service(inst); }
        else if (inst.state === 'new') waiting++;
      }
      if (!waiting) break;
    }
    const s = this.scoring;
    if (s && s.state === 'new') {
      this.source(s.key);
      while (this.fetching) await new Promise(r => setTimeout(r, 10));
      if (this.start(s)) { s.next = w.time + simRandom() * 0.3; for (const [name, args] of this.told.splice(0)) this.tell(name, ...args); }
    }
  }

  update(dt) {
    const w = this.world;
    this.attach();
    if(!w.aiSuspended)this.plans.update();
    let started = 0;
    const list = this.instances, n = list.length, budget = this.budgetMs ?? Infinity, t0 = budget < Infinity ? performance.now() : 0;
    const first = budget < Infinity && n ? (this.turn = ((this.turn || 0) + 1) % n) : 0;
    for (let i = 0; i < n; i++) {
      const inst = list[(first + i) % n];
      if (budget < Infinity && performance.now() - t0 > budget) break;
      if(inst.story||w.aiSuspended&&(inst.plan||inst.fs))continue;
      if (inst.state === 'new') {
        if (started < 2 && !this.fetching && this.start(inst)) {
          started++; inst.next = w.time + simRandom() * 0.3;
          if (inst===this.scoring) for (const [name, args] of this.told.splice(0)) this.tell(name, ...args);
        }
        continue;
      }
      if (inst.state === 'run' && w.time >= inst.next) { inst.next = w.time + inst.rate; this.service(inst); }
      if (inst.state === 'run' && inst.pollEachStep && !inst.blocked) inst.poll();
    }
    if (this.instances.length > 64 && this.instances.some(i => i.state === 'over')) this.instances = this.instances.filter(i => i.state !== 'over');
  }

  async settle(ms = 4000) {
    const w = this.world, t0 = performance.now();
    for (;;) {
      w.refresh?.();
      this.attach();
      let left = 0;
      for (const inst of this.instances) {
        if (inst.story || inst.plan) continue;
        if (inst.state === 'new') {
          if (!this.fetching && this.start(inst)) { if (inst === this.scoring) for (const [name, args] of this.told.splice(0)) this.tell(name, ...args); }
          else { left++; continue; }
        }
        if (inst.state === 'run' && (inst.services || 0) < 2) { this.service(inst); inst.next = w.time + simRandom() * inst.rate; if (inst.state === 'run' && inst.services < 2) left++; }
      }
      if (!left || performance.now() - t0 > ms) break;
      await new Promise(r => setTimeout(r, 20));
    }
  }

  addStoryScript(name,plot){
    const inst={global:true,story:true,plot,name,key:String(name).replace(/\.lua$/i,'').replace(/[\\.]/g,'/').toUpperCase(),state:'new',next:0,prox:[],events:[],values:new Map(),exit:false};
    this.add(inst);this.storyInstances.push(inst);this.source(inst.key);return inst;
  }
  storyCallback(inst,name){
    if(inst.env==null)return;
    const previous=this.current;this.current=inst;
    try{const result=this.vm.call(inst.env,'Story_Event_Trigger',name);if(!result.ok&&!result.missing)this.errors.set(inst.name,result.error);}
    finally{this.current=previous;}
  }
  storyEscape(){
    let handled=false;
    for(const inst of this.storyInstances){if(inst.env==null)continue;const previous=this.current;this.current=inst;
      try{const result=this.vm.call(inst.env,'Story_Handle_Esc');if(!result.missing){handled=true;if(!result.ok)this.errors.set(inst.name,result.error);}}
      finally{this.current=previous;}}
    return handled;
  }
  updateStory(dt=0){
    this.storyTime+=Math.max(0,+dt||0);
    for(const inst of this.storyInstances){
      if(inst.state==='new'&&!this.fetching)this.start(inst);
      if(inst.state==='run'&&this.storyTime>=inst.next){inst.next=this.storyTime+inst.rate;this.service(inst);}
    }
  }
  async compileAll(ms = 8000) {
    const t0 = performance.now(), pause = () => new Promise(r => setTimeout(r, 20));
    while (performance.now() - t0 < ms && (this.fetching || !this.plans.ready)) await pause();
    for (const [key, src] of this.sources) {
      if (performance.now() - t0 > ms) break;
      if (typeof src === 'string') { this.vm.compile(src, key); await null; }
    }
    return t0;
  }

  async warm(ms = 8000) {
    const t0 = await this.compileAll(ms), pause = () => new Promise(r => setTimeout(r, 20));
    while (performance.now() - t0 < ms) {
      this.update(0);this.updateStory(0);
      if (!this.fetching && (!this.scoring || this.scoring.state !== 'new')&&this.storyInstances.every(i=>i.state!=='new')) break;
      await pause();
    }
  }

  report() {
    const by = {};
    for (const i of this.instances) by[i.name + ' ' + i.state] = (by[i.name + ' ' + i.state] || 0) + 1;
    return { instances: by, inert: [...this.inert].map(t => t.name), errors: Object.fromEntries(this.errors), missing: Object.fromEntries([...this.missing].sort((a, b) => b[1] - a[1])) };
  }
}
