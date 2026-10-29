import { simRandom } from './simrandom.js';
import { db } from '../gamedata.js';
import { activeLanguage } from '../language.js';
import { changeController } from './galacticpolitics.js';
import {StoryPlots} from './storyplots.js';
import {StoryFlags} from './storyflags.js';
import { fetchText, findFiles } from '../vfs.js';
import { LuaVM, LuaRef, Multi, loadFengari } from '../lua.js';
import { GalacticNeutralizePopup } from './galacticpopup.js';
import { NeutralizeShell } from './neutralizeshell.js';
import { readBrain, Reason, typeParam, catParam } from './landbrain.js';
import { placeStartingForce, forceKind } from './galaxy.js';
import { planetAllowsCompany } from './invasion.js';
import { planetIncome, playerIncome } from './galacticeconomy.js';
import { groundLevel } from './galacticproduction.js';
import { advisorHints } from './galacticlogdata.js';
import { strategicStealth } from './galacticfog.js';
import { battleStory, battleClassSummary, destroyStory, destroyBaseStory, conquerStory, scoringCall } from './galacticbattleevents.js';
import { strategicPower } from './galacticforces.js';
import { groundActivated } from './planetdestruction.js';
import { orderMove } from './fleets.js';
import { scheduleHeroRespawn, forceHeroRespawn } from './galacticherorespawn.js';
import { sabotageReward } from './galacticsabotage.js';
import { galacticBounty, ownerCorruption } from './galacticbounty.js';
import { blackMarketItems } from './blackmarket.js';
import { startRemoval } from './galacticcorruption.js';
import { installPersistence, saveStory, restoreStory } from './galacticstorysave.js';
import { playScriptMusic, startStrategicMusic } from './galacticmusic.js';
import { galacticStoryReward } from './storyrewards.js';
import { aidebug as D, who, group, nameOf } from '../aidebug.js';

const key = s => String(s || '').replace(/\\/g, '/').toUpperCase();
const moduleKey = s => key(s).replace(/\.LUA$/i, '').replace(/\./g, '/');
const yes = s => /^(true|yes|1)$/i.test(String(s));
const split = s => String(s || '').split(',').map(s => s.trim()).filter(Boolean);

export class GalacticStoryHost extends StoryPlots {
  static async create(game, { warm = true } = {}) {
    const restoring = !!game.setup?.restore;
    const files = await findFiles('SCRIPTS\\\\.*\\.LUA$').catch(() => []);
    if (!files.length && !restoring) return null;
    const host = new GalacticStoryHost(game, await loadFengari(), files);
    game.story = host;
    if (restoring) {
      host.brain=await readBrain(['BasicGalacticEquations'],[],[]);
      const saved = game.galaxy.storyLuaSaved;
      if (saved) {
        try { await restoreStory(host, saved); await host.fetchSources(); return host; }
        catch (error) {
          console.error(error); host.errors.set('Story restore', String(error.message || error));
          for (const inst of host.instances) host.drop(inst);
          host.instances.length = 0; host.plots.clear(); host.eventTypes.clear(); host.timedEvents.clear(); host.storyScripts.clear(); host.scoring = undefined;
        }
      }
      await host.restoreCombatEvents(game.galaxy.storySaved||[]);
      host.suspended = true;
      host.errors.set('Tactical return', 'The story scripts were not saved with this game: they stay stopped');
      return host;
    }
    await host.initialize(warm);
    return host;
  }

  constructor(game, fengari, files) {
    super();
    this.game = game; this.index = new Map(); this.prefetchModules = new Map(); this.moduleAliases = new Map(); this.sources = new Map(); this.pending = new Map(); this.sourceQueue = []; this.activeSources = 0;
    this.instances = []; this.plots = new Map(); this.storyScripts = new Map(); this.eventTypes = new Map(); this.timedEvents = new Set(); this.values = new Map(); this.aiFlags = new Map(); this.types = new WeakMap();
    this.players = new Map(); this.planets = new WeakMap(); this.errors = new Map(); this.missing = new Map();
    this.reasonCache = new Map(); this.parameterCache = new WeakMap(); this.objectCache = null;
    this.current = null; this.running = false; this.disposed = false; this.suspended = false; this.time = 0; this.serviceTime = 0; this.lastLogicTick = -1; this.resetDepth = 0; this.loadRequest = null; this.storyGoals = []; this.storyGoalId = 0;
    this.created = []; this.objectWrappers = new WeakMap();
    game.galaxy.storySnapshot=()=>this.combatSnapshot();
    this.flags=new StoryFlags(game.galaxy.storyFlagsSaved);
    game.galaxy.storyFlagSnapshot=()=>this.flags.snapshot();
    game.galaxy.storyLuaSnapshot=()=>{ try { return saveStory(this); } catch (error) { console.warn('The story could not be saved: ' + error.message); this.saveError = error.message; return null; } };
    this.popup = game.neutralizePopup ||= NeutralizeShell.available(game) ? new NeutralizeShell(game) : new GalacticNeutralizePopup(game);
    for (const path of files.slice().sort((a, b) => Number(!/\\LIBRARY\\/i.test(a)) - Number(!/\\LIBRARY\\/i.test(b)))) {
      const parts = key(path).replace(/^.*?\/SCRIPTS\//, '').replace(/\.LUA$/, '').split('/');
      for (let i = 0; i < parts.length; i++) {
        const n = parts.slice(i).join('/'); if (!this.index.has(n)) this.index.set(n, path);
        const aliases = this.moduleAliases.get(n) || []; aliases.push(parts.join('/')); this.moduleAliases.set(n, aliases);
      }
      if (parts.at(-1) === 'INIT') for (let i = 0; i < parts.length - 1; i++) {
        const alias = parts.slice(i, -1).join('/'), modules = this.prefetchModules.get(alias) || [];
        modules.push(parts.join('/')); this.prefetchModules.set(alias, modules);
      }
    }
    this.vm = new LuaVM(fengari, { source: n => this.source(n) });
    this.vm.traceHost = () => ({ inst: this.current, t: this.game.galaxy ? this.game.galaxy.time : NaN, mode: 'G' });
    this.vm.pairsLua50();
    this.globals();
    installPersistence(this);
  }

  async fetchSources() {
    for (const inst of this.instances) if (inst.state !== 'over') this.source(inst.key);
    while (this.pending.size) await Promise.all([...this.pending.values()]);
  }

  async initialize(warm = true) {
    this.brain = await readBrain(['BasicGalacticEquations'], [], []);
    const override = this.game.setup?.startingTechLevel;
    if (Number.isInteger(override) && override >= 0 && override < 6) for (const player of this.game.galaxy.players) player.tech = Math.max(0, Math.min(player.maxTech, override));
    const campaign = this.game.galaxy.campaign;
    const entries = campaign.list('Story_Name').slice();
    if (this.game.setup?.net && this.game.setup.singlePlayerCampaign && this.game.data) {
      const set = key(campaign.str('Campaign_Set')), variants = [...this.game.data.campaigns.values()].filter(c => key(c.str('Campaign_Set')) === set);
      for (const faction of this.game.galaxy.humans || []) {
        const own = variants.find(c => key(c.str('Starting_Active_Player')) === faction);
        if (!own || own === campaign) continue;
        const theirs = own.list('Story_Name'), at = theirs.findIndex((v, i) => i % 2 === 0 && key(v) === faction);
        if (at < 0 || !theirs[at + 1]) continue;
        const here = entries.findIndex((v, i) => i % 2 === 0 && key(v) === faction);
        if (here >= 0) entries[here + 1] = theirs[at + 1]; else entries.push(theirs[at], theirs[at + 1]);
      }
    }
    for (let i = 0; i + 1 < entries.length; i += 2) await this.readPlot(entries[i + 1], '', entries[i]);
    for (const faction of ['Rebel', 'Empire', 'Underworld']) {
      const plot = campaign.str(faction + '_Story_Name');
      if (plot) await this.readPlot(plot, '', faction);
    }
    if (this.index.has('GAMESCORING')) this.scoring = this.addScript('GameScoring', true);
    if (this.scoring) {
      this.scoring.initialCallbacks = [['Game_Mode_Starting_Event', ['Galactic', campaign.name]]];
      await this.warmInstance(this.scoring);
    }
    for (const plot of this.plots.values()) this.startPlot(plot);
    if (warm) await this.warm(); else this.unwarmed = true;
  }

  startPlot(plot) {
    for (const p of [plot, ...[...this.plots.values()].filter(q => q.parent === plot)]) if (p?.scriptName && !p.instance) {
      const inst = p.instance = this.addScript(p.scriptName); inst.plot = p; this.storyScripts.set(p, inst);
    }
  }

  addScript(name, scoring = false) {
    const inst = { name, key: moduleKey(name), scoring, state: 'new', env: null, thread: null,
      events: [], tags: [], history: [], values: new Map(), threads: [], next: 0, exit: false, initialized: false, starts: 0, needs: [] };
    this.instances.push(inst); this.source(inst.key); return inst;
  }

  source(name) {
    const requested = moduleKey(name), path = this.index.get(requested);
    const n = path ? moduleKey(key(path).replace(/^.*?\/SCRIPTS\//, '')) : requested;
    if (this.sources.has(n)) return this.sources.get(n);
    if (!path) { this.sources.set(n, null); return null; }
    if (!this.pending.has(n)) {
      const p = this.fetchSource(path.replace(/\\/g, '/')).catch(error => {
        this.errors.set('Lua source: ' + path, String(error.message || error)); return null;
      }).then(src => {
        if (src === null && !this.errors.has('Lua source: ' + path)) this.errors.set('Lua source: ' + path, 'Indexed Lua source was not readable');
        this.sources.set(n, src); this.pending.delete(n);
        if (this.disposed) return;
        for (const m of (src || '').matchAll(/require\s*\(?\s*["']([^"']+)["']/g)) this.source(m[1]);
        for (const m of (src || '').matchAll(/ModContentLoader\.get\s*\(\s*["']([^"']+)["']/g)) {
          const suffix = '/' + moduleKey(m[1]);
          for (const name of this.index.keys()) if (name.endsWith(suffix)) this.source(name);
        }
        for (const m of (src || '').matchAll(/["']([^"'\r\n]+)["']/g)) {
          const name = moduleKey(m[1]);
          for (const candidate of this.moduleAliases.get(name) || []) this.source(candidate);
          for (const candidate of this.prefetchModules.get(name) || []) this.source(candidate);
          if (/[/_]$/.test(name)) for (const [alias, candidates] of this.moduleAliases) if (alias.startsWith(name)) for (const candidate of candidates) this.source(candidate);
        }
        for (const m of (src || '').matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) for (const candidate of this.moduleAliases.get(moduleKey(m[1])) || []) this.source(candidate);
      });
      this.pending.set(n, p);
    }
    return undefined;
  }

  fetchSource(path) {
    return new Promise((resolve, reject) => { this.sourceQueue.push({ path, resolve, reject }); this.drainSources(); });
  }
  drainSources() {
    while (this.activeSources < 8 && this.sourceQueue.length) {
      const job = this.sourceQueue.shift(); this.activeSources++;
      fetchText(job.path).then(job.resolve, job.reject).finally(() => { this.activeSources--; this.drainSources(); });
    }
  }

  clickFaction(name) {
    const want = key(name);
    for (const e of this.eventTypes.get('STORY_CLICK_GUI') || []) {
      if (!String(e.params[0] || '').split(',').some(n => key(n.trim()) === want)) continue;
      const inst = this.storyScripts.get(e.plot) || e.plot?.instance, src = inst && this.sources.get(moduleKey(inst.key)) || inst && this.source(inst.key);
      if (typeof src !== 'string') continue;
      const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const handler = src.match(new RegExp('\\b' + esc(e.name) + '\\s*=\\s*([A-Za-z_]\\w*)'));
      if (!handler) continue;
      const at = src.search(new RegExp('function\\s+' + esc(handler[1]) + '\\s*\\(')); if (at < 0) continue;
      const end = src.indexOf('\nfunction ', at + 1), body = src.slice(at, end < 0 ? undefined : end);
      for (const m of body.matchAll(/\b[A-Za-z_]\w*\s*=\s*(?:[\w.:]+\s*\(\s*)?"([A-Za-z0-9_]+)"/g)) { const f = db.faction(m[1]); if (f) return f.name; }
    }
    return null;
  }

  heard() {
    const owner = this.firingPlot?.owner ?? this.current?.plot?.owner;
    return this.game.storyAudience ? this.game.storyAudience(owner) : true;
  }
  speechQueued(name) { if (this.game.setup?.net) (this.speechDone ||= []).push(name); }

  absent(kind) { return name => /^[A-Z]/.test(name) ? (...args) => this.unsupported(kind + '.' + name, args) : undefined; }
  unsupported(name) { this.missing.set(name, (this.missing.get(name) || 0) + 1); }

  globals() {
    const vm = this.vm, game = this.game, self = this;
    for (const n of ['_ScriptMessage', '_OuputDebug']) vm.global(n, () => {});
    vm.global('_MessagePopup', s => game.message?.(String(s)));
    vm.global('DumpCallStack', () => '');
    vm.global('GetThreadID', () => this.current?.running?.id || 0);
    vm.global('_ScriptExit', () => { if (this.current) this.current.exit = true; });
    vm.global('Get_Game_Mode', () => game.modeSuspended&&game.linkedMission&&!game.linkedMission.popped?(game.linkedMission.request.mode==='space'?'Space':'Land'):'Galactic');
    vm.global('Is_Multiplayer_Mode', () => !!game.setup?.net);
    vm.global('Is_Campaign_Game', () => true);
    vm.global('DiscreteDistribution', { __wrap: true, __name: 'DiscreteDistribution', __missing: this.absent('DiscreteDistribution'), Create: () => {
      const items = [];
      return {
        __wrap: true, __name: 'DiscreteDistribution', Is_Valid: () => true, __missing: this.absent('DiscreteDistribution'),
        Insert: (value, weight) => { items.push([value, Math.max(0, +weight || 0)]); },
        Sample: () => { let sum = 0; for (const [, x] of items) sum += x; let r = simRandom() * sum; for (const [v, x] of items) { r -= x; if (r <= 0) return v; } return items.length ? items[items.length - 1][0] : undefined; },
      };
    } });
    vm.global('StringCompare', (a, b) => key(a) === key(b));
    vm.global('GetCurrentTime', { __wrap: true, __name: 'GetCurrentTime', __call: () => this.serviceTime, Frame: () => Math.fround(Math.fround(Math.floor(this.time*30+1e-6))*Math.fround(1/30)), Galactic_Time: () => Math.fround(Math.fround(Math.floor(this.time*30+1e-6))*Math.fround(1/30)) });
    vm.global('GlobalValue', { __wrap: true, __name: 'GlobalValue', Get: k => this.values.get(String(k)), Set: (k, v) => { if (v == null) this.values.delete(String(k)); else this.values.set(String(k), v); } });
    vm.global('GameRandom', { __wrap: true, __name: 'GameRandom', __call: (a, b) => Math.floor(a + simRandom() * (b - a + 1)), Free_Random: (a, b) => Math.floor(a + simRandom() * (b - a + 1)), Get_Float: (a = 0, b = 1) => a + simRandom() * (b - a) });
    vm.global('Find_Object_Type', name => this.type(db.type(String(name || ''))));
    vm.global('Find_Player', name => this.player(key(name) === 'LOCAL' ? (game.storyLocal ? game.storyLocal(this.current?.plot?.owner) : game.me || game.galaxy.active) : name));
    const findPlanet = name => game.galaxy.planets.find(p => key(p.name) === key(name));
    vm.global('FindTarget', { __wrap: true, __name: 'FindTarget', __call: (owner, equation, flags, probability, range) => game.ai?.findTarget(owner?.__faction, equation, flags, probability, null, null, range),
      Reachable_Target: (owner, equation, flags, reach, probability, target, range) => game.ai?.findTarget(owner?.__faction, equation, flags, probability, target?.__planet, reach, range) });
    vm.global('FindPlanet', { __wrap: true, __name: 'FindPlanet', __call: name => this.planet(findPlanet(name)), Get_All_Planets: () => game.galaxy.planets.filter(p => !p.background).map(p => this.planet(p)) });
    vm.global('Get_Story_Plot', name => this.plotWrapper(name));
    vm.global('Story_Event', name => this.signal('STORY_AI_NOTIFICATION', name));
    vm.global('GUI_Component_Visibility', (name, on) => game.scriptUI?.visibility(String(name), on !== false && on !== 0));
    vm.global('GUI_Component_Enable', (name, on) => game.scriptUI?.enable(String(name), on !== false && on !== 0));
    vm.global('GUI_Component_Text', (name, text) => game.scriptUI?.text(String(name), String(text ?? '')));
    vm.global('GUI_Button_Icon', (name, icon, ...args) => game.scriptUI?.icon(String(name), String(icon), ...args));
    vm.global('Check_Story_Flag', (player, name, target, clear) => {
      const flags = this.aiFlags.get(key(player?.__faction)), id = key(name) + '|' + key(target?.__planet?.name || target?.__object?.type.name);
      const result = !!flags?.has(id); if (result && clear) flags.delete(id); return result;
    });
    vm.global('Create_Position', (x, y, z = 0) => this.position(x, y, z));
    vm.global('Lock_Controls', on => { game.controlsLocked = on !== false && on !== 0; });
    vm.global('Game_Message', name => game.message?.(db.t(String(name))));
    vm.global('Play_Music', name => { playScriptMusic(game, name); });
    vm.global('Stop_All_Music', () => { game.audio?.stopMusic?.(); });
    vm.global('Add_Objective', (id, flag) => { if (typeof id !== 'string' || typeof flag !== 'boolean') throw new Error('Add_Objective -- expected a text id and a boolean'); this.objectives.add(id, flag); });
    vm.global('Resume_Mode_Based_Music', () => { startStrategicMusic(game, true); });
    vm.global('Remove_All_Text', () => game.removeScreenText?.());
    vm.global('Stop_All_Speech', () => game.audio?.speech?.stopActive());
    vm.global('Suspend_AI', on => { game.suspendAI = on !== false && on !== 0; });
    vm.global('Find_First_Object', name => { const p = findPlanet(name), n = key(name?.__type?.name || name); return p ? this.planet(p) : this.object(this.objectIndex().byType.get(n)?.[0]); });
    vm.global('Find_All_Objects_Of_Type', (name, category) => {
      if (name?.__faction) return (this.objectIndex().byOwner.get(key(name.__faction)) || []).filter(o => !category || o.type.categories().has(key(category))).map(o => this.object(o));
      const n = key(name?.__type?.name || name); return game.galaxy.planets.filter(p => key(p.name) === n).map(p => this.planet(p)).concat((this.objectIndex().byType.get(n) || []).map(o => this.object(o)));
    });
    vm.global('Spawn_Unit', (type, where, owner) => { const object = this.spawn(type, where, owner); return object ? [this.object(object)] : undefined; });
    vm.global('Create_Generic_Object', (type, where, owner) => this.createGeneric(type,where,owner));
    vm.global('Assemble_Fleet', list => this.fleet(list));
    vm.global('EvaluatePerception', (name, owner, location) => {
      const p = location?.__planet || location?.__object?.planet;
      if (key(name) === 'ENEMY_PRESENT') return p ? this.objects().some(o => o.planet === p && this.player(o.owner)?.Is_Enemy(owner)) ? 1 : 0 : 0;
      if(game.ai?.plans.ready&&game.ai.shared?.eq.has(key(name)))return game.ai.evaluate(name,owner?.__faction,p);
      if (!this.brain?.eq.has(key(name))) return self.unsupported('EvaluatePerception:' + name);
      const ownerKey = key(owner?.__faction); let reason = this.reasonCache.get(ownerKey);
      if (!reason) { reason = new Reason(this.brain); reason.see = (variable, params, target) => this.perception(variable, params, owner, target); this.reasonCache.set(ownerKey, reason); }
      return reason.fn(key(name), { key: p?.index ?? '', planet: p, object: location?.__object });
    });
    for (const name of ['Allow_Localized_SFX', 'Play_SFX_Event', 'Set_Cinematic_Camera_Key', 'Set_Cinematic_Target_Key', 'Transition_Cinematic_Camera_Key', 'Transition_Cinematic_Target_Key', 'Start_Cinematic_Camera', 'End_Cinematic_Camera', 'Fade_Screen_In', 'Fade_Screen_Out', 'Letter_Box_In', 'Letter_Box_Out', 'Point_Camera_At', 'Enable_Fog', 'Force_Weather']) vm.global(name, (...args) => self.unsupported(name, args));
  }

  type(t) {
    if (!t) return undefined;
    let wrapper = this.types.get(t);
    if (!wrapper) {
      wrapper = { __wrap: true, __type: t, __name: t.name, Is_Valid: () => true, Get_Name: () => key(t.name),
        Get_Combat_Rating: () => strategicPower(t), Get_Score_Cost_Credits: () => t.num('Score_Cost_Credits'),
        Get_Build_Cost: () => t.num('Build_Cost_Credits'),
        Get_Tech_Level: () => t.num('Tech_Level', 0), Is_Hero:()=>t.bool('Is_Named_Hero')||t.bool('Is_Generic_Hero'), __missing: this.absent('Type') };
      this.types.set(t, wrapper);
    }
    return wrapper;
  }

  player(name) {
    const faction = db.faction(String(name || '')); if (!faction) return undefined;
    const id = key(faction.name); if (this.players.has(id)) return this.players.get(id);
    const data = () => this.game.galaxy.players.find(p => key(p.faction) === id);
    const f = { __wrap: true, __name: faction.name, __faction: faction.name, Is_Valid: () => true,
      Get_Faction_Name: () => id, Get_Name: () => faction.name, Get_ID: () => [...db.factions.values()].indexOf(faction),
      Is_Human: () => this.game.isHuman ? this.game.isHuman(id) : id === key(this.game.me || this.game.galaxy.active), Is_Neutral: () => faction.bool('Is_Neutral'),
      Enable_Advisor_Hints: (mode,on) => {const p=data(),name=({GALACTIC:'Galactic',SPACE:'Space',LAND:'Land'})[key(mode)];if(p&&name)advisorHints(p)[name]=!!on;},
      Get_Credits: () => data()?.credits || 0, Give_Money: n => { const p = data(); if (p) {p.credits += +n || 0;this.game.galaxy.victoryCreditChange?.(p.faction);if(D.on)this.dbg('changes',p.faction,((+n||0)<0?'takes ':'gives ')+Math.abs(+n||0)+' credits (now '+Math.round(p.credits)+')');} },
      Get_Tech_Level: () => data()?.tech || 0, Get_Difficulty: () => ({ easy: 'Easy', medium: 'Normal', hard: 'Hard' }[this.game.setup?.difficulty] || 'Normal'),
      Lock_Tech: type => this.tech(faction.name, type?.__type, false), Unlock_Tech: type => this.tech(faction.name, type?.__type, true),
      Is_Enemy: other => faction.list('Enemies').some(n => key(n) === key(other?.__faction)),
      Is_Ally: other => id === key(other?.__faction) || faction.list('Allies').some(n => key(n) === key(other?.__faction)),
      __missing: this.absent('Player') };
    this.players.set(id, f); return f;
  }

  position(x, y, z = 0) { return { __wrap: true, __name: 'Position', __pos: true, x, y, z, Is_Valid: () => true, Get_XYZ: () => new Multi(x, y, z), __missing: this.absent('Position') }; }
  tech(owner, type, enable) {
    const player = this.game.galaxy.players.find(p => key(p.faction) === key(owner)); if (!player || !type) return;
    const add = enable ? 'unlockedTypes' : 'lockedTypes', remove = enable ? 'lockedTypes' : 'unlockedTypes';
    const name = key(type.name); if (!player[add].includes(name)) player[add].push(name);
    if (D.on) this.dbg('changes', player.faction, (enable ? 'unlocks ' : 'locks ') + type.name);
    player[remove] = player[remove].filter(n => key(n) !== name);
  }
  perception(variable, params, owner, target) {
    const name = key(variable), type = target.object?.type || target.planet?.type, g = this.game.galaxy, p = target.planet;
    let parameters = this.parameterCache.get(params); if (!parameters) { parameters = { types: typeParam(params), categories: catParam(params), factions:params.filter(([n])=>/^Parameter_Faction$/i.test(n)).map(([,v])=>key(v)) }; this.parameterCache.set(params, parameters); }
    const { types, categories, factions } = parameters;
    if (name === 'VARIABLE_TARGET.TYPE.ISTYPE') return types.some(n => n === key(type?.name)) ? 1 : 0;
    if (name === 'VARIABLE_TARGET.TYPE.ISCATEGORY') return categories?.some(n => type?.categories().has(n)) ? 1 : 0;
    const at = (object, friendly = true) => (!p || object.planet === p) && (friendly ? key(object.owner) === key(owner?.__faction) : owner?.Is_Enemy(this.player(object.owner)));
    const matching = object => (!types.length || types.includes(key(object.type.name))) && (!categories || categories.some(c => object.type.categories().has(c)));
    if (name === 'VARIABLE_TARGET.MAXGROUNDBASELEVEL') return target.planet?.type.num('Max_Ground_Base_Level', 0) || 0;
    if (name === 'VARIABLE_TARGET.MAXSTRUCTURESLOTSUNNORMALIZED') return p?.structureSlots??p?.type.num('Special_Structures_Land',3)??0;
    if (name === 'VARIABLE_TARGET.MAXSTARBASELEVEL') return target.planet?.type.num('Max_Space_Base', 0) || 0;
    if (name === 'VARIABLE_SELF.TECHLEVEL') return owner?.Get_Tech_Level() || 0;
    if (name === 'VARIABLE_SELF.CREDITS') return owner?.Get_Credits() || 0;
    if (name === 'VARIABLE_SELF.GROSSINCOMEUNNORMALIZED') return playerIncome(g, owner?.__faction);
    if (name === 'VARIABLE_SELF.PLANETSCONTROLLEDUNNORMALIZED') return g.planets.filter(p => !p.background && key(p.owner) === key(owner?.__faction)).length;
    if (name === 'VARIABLE_SELF.ISFACTION') return params.some(([n,v]) => /Parameter_(Faction|Faction_Name)/i.test(n) && key(v) === key(owner?.__faction)) ? 1 : 0;
    if (name === 'VARIABLE_SELF.ISDIFFICULTY') return params.some(([,v]) => key(v).includes(key(this.game.setup?.difficulty === 'medium' ? 'Normal' : this.game.setup?.difficulty || 'Normal'))) ? 1 : 0;
    if (name === 'VARIABLE_TARGET.BASEINCOME') return p?.type.num('Planet_Credit_Value', 0) || 0;
    if (name === 'VARIABLE_TARGET.INCOMEUNNORMALIZED') return p ? planetIncome(g,p) : 0;
    if (name === 'VARIABLE_TARGET.GROUNDBASELEVELUNNORMALIZED') return p ? groundLevel(p, p.owner) : 0;
    if (name === 'VARIABLE_TARGET.STARBASELEVELUNNORMALIZED' || name === 'VARIABLE_TARGET.STARBASELEVEL') return p?.spaceLevel || 0;
    if (name === 'VARIABLE_TARGET.MAXSTARBASELEVELUNNORMALIZED') return p?.type.num('Max_Space_Base', 0) || 0;
    if (name === 'VARIABLE_TARGET.OPENSTRUCTURESLOTSUNNORMALIZED') return p ? Math.max(0, p.type.num('Special_Structures_Land', 0) - p.groundStructures.length) : 0;
    if (name === 'VARIABLE_TARGET.HASSTRUCTURE' || name === 'VARIABLE_SELF.HASSTRUCTURE') return this.objects().some(o => at(o) && matching(o)) ? 1 : 0;
    if (name === 'VARIABLE_TARGET.ACTIVETRADEROUTES') {
      if(!p)return 0;const routes=g.routes.filter(r=>r.a===p.index||r.b===p.index),source=this.player(p.owner);
      return routes.length?routes.filter(r=>source?.Is_Ally(this.player(g.planets[r.a===p.index?r.b:r.a].owner))).length/routes.length:0;
    }
    if (name === 'VARIABLE_TARGET.TRADEROUTES') {
      const counts=g.planets.map(()=>0);for(const r of g.routes){counts[r.a]++;counts[r.b]++;}
      const maximum=Math.max(0,...counts);return p&&maximum?counts[p.index]/maximum:0;
    }
    if (name === 'VARIABLE_TARGET.ISCONNECTEDTO') {
      const destinations = params.filter(([n]) => /Parameter_(Type|Planet|Location)/i.test(n)).map(([,v]) => key(v));
      if (!p) return 0;
      const seen = new Set([p.index]), queue = [p.index];
      for (let i = 0; i < queue.length; i++) { const at = queue[i]; if (destinations.includes(key(g.planets[at].name))) return 1;
        for (const link of g.links?.[at] || []) { const next = typeof link === 'number' ? link : link.to; if (next != null && !seen.has(next)) { seen.add(next); queue.push(next); } }
      }
      return 0;
    }
    const presence=/^VARIABLE_TARGET\.(FRIENDLYFORCE|ENEMYFORCE)\.HAS(SPACE|GROUND)FORCE$/.exec(name);
    if(presence){
      if(!p)return 0;
      const friendly=presence[1]==='FRIENDLYFORCE',space=presence[2]==='SPACE';
      const matches=who=>(friendly?owner?.Is_Ally(this.player(who)):owner?.Is_Enemy(this.player(who)))&&(!factions.length||factions.includes(key(who)));
      return space?+g.fleets.some(f=>f.planet===p.index&&!f.leg&&matches(f.owner)&&f.units.some(u=>!u.dead&&!strategicStealth(u))):+p.garrison.some(u=>!u.dead&&matches(u.owner));
    }
    if (name === 'VARIABLE_TARGET.FRIENDLYFORCE.HASGROUNDUNITSBITFIELD') return this.objects().some(o => at(o) && forceKind(o.type) === 'company' && matching(o)) ? 1 : 0;
    if (name === 'VARIABLE_TARGET.FRIENDLYFORCE.HASSPACEUNITSBITFIELD') return this.objects().some(o => at(o) && ['starship','squadron'].includes(forceKind(o.type)) && matching(o)) ? 1 : 0;
    if (name === 'VARIABLE_TARGET.ISOWNEDBYSELF') return key(target.planet?.owner) === key(owner?.__faction) ? 1 : 0;
    const flag = /^VARIABLE_STORYFLAG\[([^\]]+)\]$/i.exec(variable);
    if (flag) return +this.flags.get(flag[1]) || 0;
    if (/\.STRUCTURECOUNT$/.test(name)) {
      return this.objects().filter(o => (!target.planet || o.planet === target.planet) && key(o.owner) === key(owner?.__faction) && (!types.length || types.includes(key(o.type.name))) && (!categories || categories.some(n => o.type.categories().has(n)))).length;
    }
    this.unsupported('Perception.' + variable); return 0;
  }
  planet(p) {
    if (!p) return undefined;
    let wrapper = this.planets.get(p);
    if (!wrapper) {
      wrapper = { __wrap: true, __name: p.name, __planet: p, Is_Valid: () => true, Get_Type: () => this.type(p.type),
        Get_Owner: () => this.player(p.owner), Get_Position: () => this.position(...p.pos), Get_Planet_Location: () => wrapper, Get_Game_Object: () => wrapper,
        Get_Starbase_Level: () => p.spaceLevel || 0, Get_Groundbase_Level: () => p.groundLevel || 0,
        Get_Final_Blow_Player:()=>this.player(p.finalBlowOwner||this.neutralOwner()), Is_Planet_Destroyed:()=>!!p.destroyed,
        Is_Corrupted:()=>(p.currentCorruption??-1)!==-1,
        Get_Is_Planet_AI_Usable:()=>!p.background&&!p.destroyed&&!p.restricted&&(this.game.galaxy.autoReveal!==false||!!p.revealed),
        Change_Owner: owner => { if (owner?.__faction) {const old=changeController(p,owner.__faction,this.game.galaxy);this.planetCaptured(p,old);if(D.on)this.dbg('changes',owner.__faction,nameOf(p)+' given to '+owner.__faction+(old?' (was '+old+')':''));} },
        Attach_Particle_Effect: (type, bone) => { this.game.attachParticle?.(p, type?.__name ?? type, typeof bone === 'string' ? bone : null); },
        __missing: this.absent('Planet') };
      this.planets.set(p, wrapper);
    }
    return wrapper;
  }

  objectIndex() {
    const list = this.objects();
    if (this.indexed?.list === list) return this.indexed;
    const byType = new Map(), byOwner = new Map(), add = (m, k, o) => { const a = m.get(k); if (a) a.push(o); else m.set(k, [o]); };
    for (const o of list) { add(byType, key(o.type.name), o); add(byOwner, key(o.owner), o); }
    return this.indexed = { list, byType, byOwner };
  }

  objects() {
    if (this.objectCache) return this.objectCache;
    const out = this.created.filter(o => !o.dead);
    for (const p of this.game.galaxy.planets) {
      for (const record of [...(p.groundStructures || []), ...(p.orbitalStructures || []), ...(p.garrison || [])]) {
        if (record.dead) continue;
        const wrapper = this.object(record, p); if (wrapper) out.push(wrapper.__object);
      }
    }
    for (const fleet of this.game.galaxy.fleets) for (const record of fleet.units) {
      if (record.dead) continue;
      const wrapper = this.object(record, this.game.galaxy.planets[fleet.planet], fleet.owner); if (wrapper) out.push(wrapper.__object);
    }
    return this.objectCache = out;
  }
  dbg(kind, faction, text) {
    const i = this.current, g = this.game.galaxy, side = g.players.find(p => key(p.faction) === key(faction)) || { faction };
    D.log(kind, 'G', g.time, who(side), (i && i.name ? i.name + ': ' : '') + text, !i ? 'story' : i.plan ? 'plan' : i.freeStore ? 'freestore' : 'story');
  }
  spawn(type, where, owner) {
    const t = type?.__type || db.type(String(type || '')), planet = where?.__planet || where?.__object?.planet;
    if (!t || !planet || !owner?.__faction) return undefined;
    this.objectCache = null; this.reasonCache.clear();
    const fleets=this.game.galaxy.fleets,firstNewFleet=fleets.length;
    const record=placeStartingForce(planet, owner.__faction, t, fleets);
    if(record)this.game.victory?.heroSpawned(t,owner.__faction);
    if(D.on)this.dbg('spawn',owner.__faction,record?'spawned '+nameOf(record)+' at '+nameOf(planet):'could not spawn '+t.name+' at '+nameOf(planet));
    for (let i=firstNewFleet;i<fleets.length;i++){
      this.game.fleetView?.(fleets[i])?.catch?.(error => this.errors.set('Spawn_Unit model', error.message));
      this.game.battles?.arrive(fleets[i],planet.index);
    }
    if (record) return this.object(record, planet, owner.__faction).__object;
    return undefined;
  }
  createGeneric(type,where,owner) {
    const t=type?.__type||db.type(String(type||'')),planet=where?.__planet||where?.__object?.planet;
    const pos=where?.__pos?[where.x,where.y,where.z]:where?.__object?.pos||planet?.pos;
    if(!t||!owner?.__faction||!pos)return undefined;
    const object={type:t,owner:owner.__faction,planet:planet||null,pos:pos.slice(),dead:false};
    this.created.push(object);this.objectCache=null;return this.object(object);
  }
  object(record, planet = record?.planet, owner = record?.owner) {
    if (!record) return undefined;
    let result = this.objectWrappers.get(record); if (result) { if (planet) result.__object.planet = planet; if (owner) result.__object.owner = owner; return result; }
    const object = record.planet||record.pos ? record : { record, type: record.carries || record.type, owner: owner || planet?.owner, planet, dead: false };
    result = { __wrap: true, __name: object.type.name, __object: object, Is_Valid: () => !object.dead && !record.dead,
      Get_Type: () => this.type(object.type), Get_Owner: () => this.player(object.owner), Get_Planet_Location: () => this.planet(object.planet),
      Get_Game_Scoring_Type:()=>this.type(record.carries||object.type), Get_Final_Blow_Player:()=>this.player(object.finalBlowOwner||this.neutralOwner()),
      Force_Test_Space_Conflict:()=>object.planet?this.game.battles?.testSpace(object.planet.index,object.owner):undefined,
      Get_Position: () => this.position(...(object.pos||object.planet?.pos || [0,0,0])), Get_Game_Object: () => result,
      Is_Category: category => object.type.categories().has(key(category)),
      Is_Transport: () => forceKind(object.type) === 'company',
      Can_Land_On_Planet: target => { const p = target?.__planet; return !!p && forceKind(object.type) === 'company' && !p.destroyed && p.type.bool('Planet_Surface_Accessible', true) && planetAllowsCompany(p, object.type) && p.garrison.length < db.constants.num('Max_Ground_Forces_On_Planet', 10); },
      Get_Garrisoned_Units: () => [],
      Prevent_AI_Usage: on => { object.noAI = !!on; }, Mark_Parent_Mode_Object_For_Death: () => { object.deleteAfterBattle = true; },
      Despawn: () => this.despawn(object), Activate_Ability: filter => {this.activate(object, filter);},
      Set_Check_Contested_Space: on => {record.checkContestedSpace=!!on;},
      __missing: this.absent('Object') };
    this.objectWrappers.set(record, result); if (object !== record) this.objectWrappers.set(object, result); return result;
  }
  despawn(object) {
    this.objectCache = null; this.reasonCache.clear();
    object.dead = true; const record = object.record || object; record.dead = true;
    const g = this.game.galaxy;
    for (const p of g.planets) for (const list of ['groundStructures', 'orbitalStructures', 'garrison']) {
      const index = p[list]?.indexOf(record); if (index >= 0) p[list].splice(index, 1);
    }
    for (let i = g.fleets.length - 1; i >= 0; i--) {
      const fleet = g.fleets[i], index = fleet.units.indexOf(record); if (index >= 0) fleet.units.splice(index, 1);
      if (!fleet.units.length) {
        const view = this.game.fleetViews?.get(fleet); if (view?.inst?.root) this.game.scene?.remove(view.inst.root);
        this.game.fleetViews?.delete(fleet); g.fleets.splice(i, 1);
      }
    }
  }
  fleet(list) {
    const objects = (Array.isArray(list) ? list : []).map(o => o?.__object).filter(Boolean);
    return { __wrap: true, __name: 'Fleet', __force: true, __objects: objects, Is_Valid: () => objects.some(o => !o.dead),
      Get_Unit_Table: () => objects.filter(o => !o.dead).map(o => this.object(o)),
      Get_Owner: () => this.player(objects[0]?.owner), Get_Planet_Location: () => this.planet(objects[0]?.planet),
      Activate_Ability: filter => { for (const o of objects) this.activate(o, filter); }, Move_To: target => this.moveFleet(objects, target), __missing: this.absent('Fleet') };
  }
  moveFleet(objects, target) {
    const g = this.game.galaxy, to = target?.__planet || target?.__object?.planet; if (!to) return undefined;
    const records = new Set(objects.filter(o => !o.dead).map(o => o.record || o));
    const held = g.fleets.filter(f => !f.leg && f.planet >= 0 && f.units.some(u => records.has(u)));
    if (!held.length) return undefined;
    const fleet = held[0];
    for (const other of held.slice(1)) {
      if (other.planet !== fleet.planet || key(other.owner) !== key(fleet.owner)) continue;
      const moving = other.units.filter(u => records.has(u)); other.units = other.units.filter(u => !records.has(u)); fleet.units.push(...moving);
    }
    g.fleets = g.fleets.filter(f => f.units.length);
    const from = fleet.planet;
    if (fleet.planet !== to.index && !orderMove(g, fleet, to.index)) return undefined;
    if (D.on) this.dbg('move', fleet.owner, 'fleet of ' + group([...records]) + (from !== to.index ? ' from ' + nameOf(g.planets[from]) : '') + ' to ' + nameOf(to));
    const born = g.time || 0, holders = () => g.fleets.filter(f => f.units.some(u => records.has(u) && !u.dead));
    const arrived = () => holders().some(f => !f.leg && f.planet === to.index), gone = () => !holders().some(f => f.leg || f.planet === to.index || f === fleet);
    return { __wrap: true, __name: 'Block', Is_Valid: () => true, IsFinished: () => (g.time || 0) > born && (arrived() || gone()), Result: () => arrived() };
  }
  activate(object, filter) {return groundActivated(this.game,object,filter,(actor,ability)=>this.neutralize(actor,ability));}
  neutralize(object, ability) {
    const g = this.game.galaxy, planet = g.planets[object.planet?.index ?? object.planet];
    if (!planet || !ability) return false;
    const rows = this.neutralizeRows(object, ability, planet), owner = g.players.find(p => key(p.faction) === key(object.owner));
    const human = this.game.isHuman ? this.game.isHuman(object.owner) : key(object.owner) === key(this.game.me || g.active);
    if (!rows.length) { if (human) this.game.audio?.play('GUI_Bad_Sound'); return false; }
    const choose = row => this.neutralizeExecute(object, ability, planet, row);
    if (!human) {
      const affordable = rows.filter(r => r.valid && owner && owner.credits >= r.cost);
      return affordable.length ? choose(affordable[Math.floor(simRandom() * affordable.length)]) : false;
    }
    if (this.game.setup?.net) {
      const id = this.choiceId = (this.choiceId || 0) + 1;
      (this.choices ||= new Map()).set(id, { object, ability, planet, rows, owner: key(object.owner) });
      if (key(object.owner) === key(this.game.me)) this.popup.open(rows, (row, gui) => { this.game.order({ c: 'choice', id, index: Number.isInteger(row?.key) ? row.key : rows.indexOf(row), gui }); return true; }, { cancel: gui => this.game.order({ c: 'choice', id, index: -1, gui }) });
      return true;
    }
    this.popup.open(rows, choose); return true;
  }
  neutralizeAnswer(faction, id, index, gui) {
    const c = this.choices?.get(id);
    if (!c || key(faction) !== c.owner || (index >= 0 && !c.rows[index])) return;
    this.choices.delete(id);
    if (key(this.game.me) === c.owner) this.popup.close();
    if (index >= 0) this.neutralizeExecute(c.object, c.ability, c.planet, c.rows[index]);
    if (gui) this.clickGUI(String(gui));
  }
  heroTypes(type) {
    const members = [...type.list('Company_Units'), ...type.list('Squadron_Units')].map(n => db.type(n)).filter(Boolean);
    return (members.length ? members : [type]).filter(t => t.bool('Is_Named_Hero') || t.bool('Is_Generic_Hero'));
  }
  neutralizeRows(object, ability, planet) {
    const hunterMajor = this.heroTypes(object.type).some(t => t.bool('Is_Named_Hero')), yes = v => /^(yes|true|1)$/i.test(String(v || '').trim()), rows = [];
    for (const o of this.objects()) {
      if (o.dead || o.planet !== planet || key(o.owner) === key(object.owner) || o === object) continue;
      for (const type of this.heroTypes(o.type)) {
        const major = type.bool('Is_Named_Hero');
        const valid = yes(ability.val(major ? 'Can_Neutralize_Major_Heroes' : 'Can_Neutralize_Minor_Heroes', 'No')) &&
          type.bool(hunterMajor ? 'Can_Be_Neutralized_By_Major_Heroes' : 'Can_Be_Neutralized_By_Minor_Heroes', true);
        rows.push({ object: o, type, major, valid, cost: Math.round(this.neutralizeCost(ability, planet, o, type, major)) });
      }
    }
    return rows;
  }
  neutralizeCost(ability, planet, target, type, major) {
    const curve = (tag, x) => {
      const v = String(ability.val(tag, '') || '').split(/[\s,]+/).map(parseFloat).filter(Number.isFinite), pts = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
      if (!pts.length) return 0; if (x <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1; }
      return pts.at(-1)[1];
    };
    const base = type.num('Neutralization_Cost', 0) * (+ability.val(major ? 'General_Major_Hero_Cost_Mod' : 'General_Minor_Hero_Cost_Mod', '1') || 0);
    let protection = 1;
    for (const o of this.objects()) {
      if (o.dead || o.planet !== planet || key(o.owner) !== key(target.owner)) continue;
      for (const t of [o.type, ...this.heroTypes(o.type)]) for (const a of t.sub('Abilities').flatMap(n => n.children)) if (key(a.tag) === 'HERO_PROTECTION_ABILITY') protection = Math.max(protection, +a.val('Neutralization_Cost_Multiplier', '1') || 1);
    }
    const corrupted = (planet.currentCorruption ?? -1) !== -1 ? 1 : 0;
    return base + curve('Cost_Mod_By_Base_Level', groundLevel(planet, planet.owner)) * base + (protection - 1) * base +
      (major ? curve('Cost_Mod_By_Previous_Neutralizations', this.neutralized?.get(key(type.name)) || 0) * base : 0) - curve('Cost_Mod_By_Planetary_Corruption_Level', corrupted) * base;
  }
  neutralizeExecute(object, ability, planet, row) {
    const g = this.game.galaxy, owner = g.players.find(p => key(p.faction) === key(object.owner)), human = key(object.owner) === key(this.game.me);
    if (!row || !row.valid || !owner || owner.credits < row.cost || row.object.dead || object.dead) { if (human) this.game.audio?.play('GUI_Bad_Sound'); return false; }
    const roll = tag => { const [lo, hi = lo] = String(ability.val(tag, '') || '').split(/[\s,]+/).map(parseFloat).filter(Number.isFinite); return lo === undefined ? 0 : lo + simRandom() * (hi - lo); };
    const mine = object.record || object;
    if (planet.type.bool('Planet_Vigilance') && this.heroTypes(object.type).some(t => t.bool('Is_Generic_Hero'))) {
      if (human) this.game.notify?.(db.t('TEXT_NEUTRALIZE_HERO_FAILURE_VIGILANCE'), object.owner);
      else if (key(row.object.owner) === key(this.game.me)) this.game.notify?.(db.t('TEXT_NEUTRALIZE_HERO_PREVENTED_VIGILANCE'), row.object.owner);
      this.despawn(object); return true;
    }
    const target = row.object.record || row.object;
    this.despawn(row.object);
    scheduleHeroRespawn(this.game, target, planet, row.object.owner, object.owner, roll('Target_Respawn_Time_In_Secs'), true);
    owner.credits -= row.cost;
    (this.neutralized ||= new Map()).set(key(row.type.name), (this.neutralized.get(key(row.type.name)) || 0) + 1);
    this.signal('STORY_GENERIC', 'hero_neutralized');
    this.callback(this.scoring, 'Galactic_Neutralized_Event', this.type(row.type), this.object(object));
    if (human) this.game.audio?.play(ability.val('SFXEvent_Activate', ''));
    this.neutralizeNotice(object, row, planet);
    this.despawn(object);
    scheduleHeroRespawn(this.game, mine, planet, object.owner, null, roll('Owner_Respawn_Time_In_Secs'), true);
    return true;
  }

  neutralizeNotice(object, row, planet) {
    const me = key(this.game.me), mine = key(object.owner) === me, theirs = key(row.object.owner) === me;
    if (!mine && !theirs) return;
    const hunter = this.heroTypes(object.type)[0] || object.type, hero = row.type, named = t => t.bool('Is_Named_Hero'), name = t => db.t(t.str('Text_ID')) || t.name;
    const where = db.t(planet.type.str('Text_ID')) || planet.name;
    let text;
    if (activeLanguage === 0) {
      const temporarily = named(hero) ? ' temporarily' : '';
      text = mine ? `${named(hunter) ? '' : 'Your '}${name(hunter)} has${temporarily} neutralized ${named(hero) ? '' : 'an enemy '}${name(hero)} on ${where}!`
        : `${named(hero) ? '' : 'Your '}${name(hero)} has been${temporarily} neutralized by ${named(hunter) ? '' : 'an enemy '}${name(hunter)} on ${where}!`;
    } else {
      const id = named(hunter) ? `TEXT_${key(hunter.name)}_NEUTRALIZES_${key(hero.name)}` : `TEXT_BOUNTY_HUNTER_NEUTRALIZES_${key(hero.name)}`, line = db.t(id);
      text = (line && line !== id ? line : db.t('TEXT_GENERIC_NEUTRALIZE_MESSAGE')) + ' ' + where;
    }
    this.game.notify?.(text, object.owner);
  }

  callback(inst, name, ...params) {
    if (!inst || inst.state !== 'run') return;
    const fn = this.vm.ref(inst.env, name); if (fn) inst.events.push({ fn, params });
  }

  neutralOwner(){return [...db.factions.values()].find(t=>t.bool('Is_Neutral'))?.name;}
  scoringCall(name,...args){scoringCall(this,name,...args);}
  combatDeath(record,planet,owner,killer,paid=true){
    if(!record||record.dead)return;
    if(paid)galacticBounty(this.game,record,planet,owner,killer);
    const wrapper=this.object(record,planet,owner),object=wrapper.__object;object.finalBlowOwner=killer||this.neutralOwner();
    this.scoringCall('Galactic_Unit_Destroyed_Event',wrapper,this.player(object.finalBlowOwner));
    destroyStory(this,record.type,record.carries||record.type,planet);
    this.game.victory?.heroKilled(record,planet,owner,object.finalBlowOwner);
    this.objectCache=null;this.reasonCache.clear();
  }
  battleContext(planet,owners){battleClassSummary(this,planet,owners);return null;}
  battleFinished(planet,owners,sides,winner,space){battleStory(this,planet,owners,sides,winner,space);}
  stationChanged(planet,oldType,newType,killer){
    if(oldType===newType)return;planet.finalBlowOwner=killer||this.neutralOwner();
    if(oldType?.num('Base_Level',planet.spaceLevel||0)>0&&(!newType||newType.num('Base_Level',0)===0))destroyBaseStory(this,planet);
    this.scoringCall('Galactic_Starbase_Level_Change',this.planet(planet),this.type(oldType),this.type(newType));
  }
  captureBaseCleanup(planet,owner){
    if(planet.station&&key(planet.stationOwner||planet.owner)!==key(owner))this.stationChanged(planet,planet.station,null,owner);
    for(const record of planet.orbitalStructures)if(key(record.owner)!==key(owner))this.combatDeath(record,planet,record.owner,owner);
  }
  planetCaptured(planet,oldOwner){
    if(oldOwner===planet.owner)return;
    ownerCorruption(planet,oldOwner,planet.owner,this.game.galaxy);
    conquerStory(this,planet);
    this.scoringCall('Galactic_Planet_Faction_Change',this.planet(planet),this.player(planet.owner),this.player(oldOwner));
    this.game.victory?.ownershipChanged();
    this.objectCache=null;this.reasonCache.clear();
  }
  reward(e) {
    if(this.commonReward(e))return;
    const game = this.game, p = e.rewards;
    switch (e.reward) {
      case '': break;
      case 'ENABLE_VICTORY': game.victory?.enable(!!parseInt(p[0],10)); break;
      case 'ENABLE_INVASION': {
        const planet=p[0]&&game.galaxy.planets.find(planet=>key(planet.type.name)===key(p[0]));
        if(planet)planet.invasionEnabled=!p[1]||!!parseInt(p[1],10);
        break;
      }
      case 'VICTORY': game.victory?.storyVictory(p[0],!!parseInt(p[1],10)); break;
      case 'FORCE_CLICK_GUI': game.scriptUI?.click(p[0] || '', true); break;
      case 'ENABLE_EVENT': case 'DISABLE_EVENT':
        if (key(p[0]) === 'TUTORIAL_CLICK_GUI') game.scriptUI?.enable(p[1] || '', e.reward === 'ENABLE_EVENT');
        else this.unsupported('Reward.' + e.reward + ':' + p[0]);
        break;
      case 'LOCK_CONTROLS': game.controlsLocked = +p[0] !== 0; break;
      case 'REVEAL_ALL_PLANETS':
        for(const planet of game.galaxy.planets)planet.revealed=true;
        for (const v of game.galaxy.visibility?.planets || []) v.discovered = true;
        break;
      case 'SET_PLANET_RESTRICTED': {
        const planet=game.galaxy.planets.find(planet=>key(planet.name)===key(p[0]));
        if(planet&&p[1]!==undefined)planet.restricted=!!parseInt(p[1],10);
        break;
      }
      case 'ENABLE_AUTORESOLVE': {
        const planet=game.galaxy.planets.find(planet=>key(planet.name)===key(p[0]));
        if(planet)game.pendingBattle?.disable(planet.index,!p[1]||(parseInt(p[1],10)||0)!==0);
        break;
      }
      case 'HIDE_AUTORESOLVE': break;
      case 'ENABLE_BOUNTY_COLLECTION': this.bountyOn = true; break;
      case 'DISABLE_BOUNTY_COLLECTION': this.bountyOn = false; break;
      case 'GIVE_BLACK_MARKET': {
        const player = game.galaxy.players.find(q => key(q.faction) === key(e.plot.owner || game.me)), item = blackMarketItems().find(i => key(i.name) === key(p[0]));
        if (player && item && !(player.blackMarket ||= []).some(n => key(n) === key(item.name))) player.blackMarket.push(item.name);
        break;
      }
      case 'RESTRICT_BLACK_MARKET': {
        const planet = game.galaxy.planets.find(planet => key(planet.name) === key(p[0]));
        if (planet) planet.marketRestricted = p[1] === undefined || !!(parseInt(p[1], 10) || 0);
        break;
      }
      case 'REMOVE_CORRUPTION': {
        const planet = game.galaxy.planets.find(planet => key(planet.name) === key(p[0]));
        if (planet) startRemoval(game, planet, p[1] === undefined ? 10 : +p[1] || 0);
        break;
      }
      case 'RESTRICT_ALL_ABILITIES': case 'RESTRICT_SABOTAGE': {
        const planet = game.galaxy.planets.find(planet => key(planet.name) === key(p[0]));
        if (planet) planet[e.reward === 'RESTRICT_SABOTAGE' ? 'sabotageRestricted' : 'abilitiesRestricted'] = p[1] === undefined || !!(parseInt(p[1], 10) || 0);
        break;
      }
      case 'SABOTAGE_STRUCTURE': {
        const planet = game.galaxy.planets.find(planet => key(planet.name) === key(p[0]));
        if (planet && p[1]) sabotageReward(game, planet, p[1]);
        break;
      }
      case 'ENABLE_SABOTAGE': game.galaxy.sabotageOff = !(p[0] === undefined || !!(parseInt(p[0], 10) || 0)); break;
      case 'RESTRICT_CORRUPTION': {
        const planet = game.galaxy.planets.find(planet => key(planet.name) === key(p[0]));
        if (planet) planet.corruptionRestricted = p[1] === undefined || !!(parseInt(p[1], 10) || 0);
        break;
      }
      case 'ENABLE_GALACTIC_CORRUPTION_HOLOGRAM': {
        const planet = game.galaxy.planets.find(planet => key(planet.name) === key(p[0]));
        if (planet) planet.showCorruptionHologram = p[1] === undefined || !!(parseInt(p[1], 10) || 0);
        break;
      }
      case 'FORCE_RESPAWN': if (p[0]) forceHeroRespawn(game, p[0]); break;
      case 'TRIGGER_AI': {
        const faction = db.faction(p[1]), player = faction && game.galaxy.players.find(player => key(player.faction) === key(faction.name));
        const target = p[2] && game.galaxy.planets.find(planet => key(planet.name) === key(p[2]));
        if (player && p[0] && (!p[2] || target)) {
          const id = key(player.faction), flags = this.aiFlags.get(id) || new Set();
          flags.add(key(p[0]) + '|' + key(target?.name)); this.aiFlags.set(id, flags);
        }
        break;
      }
      case 'REMOVE_STORY_GOAL': { const index = this.storyGoals.findIndex(g => g.tag === p[0]); if (index >= 0) this.storyGoals.splice(index, 1); this.game.storyDialog?.refreshSummary(); break; }
      case 'STORY_GOAL_COMPLETED': { const goal = this.storyGoals.find(g => g.tag === p[0]); if (goal) goal.completed = true; this.game.storyDialog?.refreshSummary(); break; }
      case 'SET_TECH_LEVEL': {
        const player = game.galaxy.players.find(player => key(player.faction) === key(p[0]));
        if (player) { const level = Math.trunc(+p[1] || 0); player.maxTech = Math.max(player.maxTech, level); player.tech = Math.max(0, Math.min(player.maxTech, level)); this.signal('STORY_TECH_LEVEL', String(player.tech)); }
        break;
      }
      case 'SET_MAX_TECH_LEVEL': {
        const player = game.galaxy.players.find(player => key(player.faction) === key(p[0]));
        if (player) player.maxTech = Math.trunc(+p[1] || 0);
        break;
      }
      case 'TUTORIAL_PLAYER': case 'SET_TUTORIAL_PLAYER': {
        const player = game.galaxy.players.find(player => key(player.faction) === key(p[0]));
        if (player) player.tutorial = true;
        break;
      }
      case 'SWITCH_CONTROL': {
        const player = game.galaxy.players.find(player => key(player.faction) === key(p[0]));
        if(player){player.ai=p[1];game.ai?.reconcile().catch(error=>this.errors.set('AI control',error.message));}
        break;
      }
      case 'SCREEN_TEXT': if (this.heard()) this.game.showScreenText?.({ id: p[0], textId:p[0], text: db.t(p[0]), duration: p[1] ? +p[1] : 5, variable: p[2] || '', remove: !!p[3], teletype: !p[4] || +p[4] !== 0, color: p[5] || '' }); break;
      case 'MULTIMEDIA':
        if(p[7])this.speechQueued(p[7]);
        if(!this.heard())break;
        if(p[0])game.showScreenText?.({id:p[0],textId:p[0],text:db.t(p[0]),duration:p[1]?+p[1]:5,variable:p[2]||'',remove:!!p[3],teletype:!p[4]||+p[4]!==0,color:p[5]||''});
        if(p[7])game.audio?.speech?.replace(p[7]);
        if(p[8])game.movies?.play(p[8],!!parseInt(p[9]));
        break;
      case 'SPEECH': if(p[0]){this.speechQueued(p[0]);if(this.heard())game.audio?.speech?.replace(p[0]);} break;
      case 'COMMANDBAR_MOVIE': if(p[0]&&this.heard())game.movies?.play(p[0],!!parseInt(p[1])); break;
      case 'STOP_COMMANDBAR_MOVIE': if(this.heard())game.movies?.stop(); break;
      case 'BUILDABLE_UNIT': {
        const player = game.galaxy.players.find(q => key(q.faction) === key(e.plot.owner || game.me));
        if (player) for (const [names, unlock] of [[p[0], true], [p[1], false]]) for (const name of split(names)) {
          const type = db.type(name); if (!type) continue;
          const n = key(type.name), keep = list => { player[list] = (player[list] || []).filter(x => key(x) !== n); };
          if (unlock) { keep('lockedTypes'); (player.unlockedTypes ||= []).push(n); }
          else { keep('unlockedTypes'); (player.lockedTypes ||= []).push(n); }
        }
        break;
      }
      case 'UNIQUE_UNIT': case 'LOCK_UNIT': case 'ENABLE_BUILDABLE': case 'DISABLE_BUILDABLE': {
        const owner = db.faction(p[1])?.name || e.plot.owner || game.me;
        const player = game.galaxy.players.find(q => key(q.faction) === key(owner));
        if (player) for (const name of split(p[0])) {
          const type = db.type(name); if (!type) continue;
          const n = key(type.name), has = list => (player[list] ||= []).some(x => key(x) === n), drop = list => { player[list] = (player[list] || []).filter(x => key(x) !== n); }, add = list => { if (!has(list)) player[list].push(n); };
          if (e.reward === 'UNIQUE_UNIT') { drop('lockedTypes'); add('unlockedTypes'); }
          else if (e.reward === 'LOCK_UNIT') add('lockedTypes');
          else if (e.reward === 'DISABLE_BUILDABLE') add('disabledTypes');
          else drop('disabledTypes');
        }
        break;
      }
      case 'PLANET_FACTION': {
        const planet = p[0] && game.galaxy.planets.find(q => key(q.type.name) === key(p[0]) || key(q.name) === key(p[0])), faction = db.faction(p[1])?.name;
        if (planet && faction && !planet.background) { const old = changeController(planet, faction, game.galaxy); if (old !== planet.owner) { game.ai?.invalidate?.(); this.planetCaptured(planet, old); game.galacticBattleChanged?.(); } }
        break;
      }
      case 'SPAWN_HERO': {
        const planet = game.galaxy.planets.find(location => key(location.name) === key(p[1]));
        this.spawn(db.type(p[0]) && this.type(db.type(p[0])), this.planet(planet), this.player(e.plot.owner || game.me)); break;
      }
      case 'SET_TUTORIAL_PLAYER': game.tutorialPlayer = +p[0] !== 0; break;
      case 'PAUSE_GALACTIC': if(game.setup?.net)game.scriptPause?.(true);else if(game.pauseGalactic)game.pauseGalactic(true);else game.paused=true;break;
      case 'UNPAUSE_GALACTIC': if(game.setup?.net)game.scriptPause?.(false);else if(game.pauseGalactic)game.pauseGalactic(false);else game.paused=false;break;
      case 'PAUSE_GALACTIC_GAME': {const on=!String(p[0]??'').length||(parseInt(p[0],10)||0)!==0;if(game.setup?.net)game.scriptPause?.(on);else if(game.pauseGalactic)game.pauseGalactic(on);else game.paused=on;break;}
      case 'LINK_TACTICAL': if(!game.queueLinkedTactical?.(p))this.errors.set(e.name,'LINK_TACTICAL request rejected: invalid parameters or a transition is already queued');break;
      case 'LOAD_CAMPAIGN': {
        const factions = [...db.factions.values()], faction = factions[+p[1]];
        this.loadRequest = { mode: 'galactic', campaign: p[0], faction: faction?.name,
          difficulty: ['easy', 'medium', 'hard'][+p[2]] || 'medium',
          ...(p[3] != null && p[3] !== '' && +p[3] >= 0 && +p[3] < 6 ? { startingTechLevel: +p[3] } : {}) };
        break;
      }
      default: if (!galacticStoryReward(this, e)) this.unsupported('Reward.' + e.reward);
    }
  }

  invokeStoryCallback(inst,name){
    if(inst.env==null)return;
    const before=this.current;this.current=inst;
    try{const result=this.vm.call(inst.env,'Story_Event_Trigger',name);if(!result.ok&&!result.missing)this.errors.set(inst.name,result.error);}
    finally{this.current=before;}
  }

  environment(inst, extra) {
    const vm = this.vm, localValues = () => inst.running?.values || inst.values;
    const values = {
      Script: { __wrap: true, __name: inst.name, Get_Name: () => inst.name, Debug_Should_Issue_Event_Alert: () => false, __missing: this.absent('Script') },
      ThreadValue: { __wrap: true, __name: 'ThreadValue', __call: n => localValues().get(String(n)), Get: n => localValues().get(String(n)), Set: (n, v) => localValues().set(String(n), v), Reset: () => localValues().clear() },
      GetEvent: { __wrap: true, __name: 'GetEvent', Reset: () => { inst.events.length = 0; }, __call: () => { const e = inst.events.shift(); inst.params = e?.params; return e?.fn; }, Params: () => inst.params },
      Create_Thread: (name, arg) => { const thread = vm.thread(inst.env, String(name)); if (!thread) return -1; thread.id = inst.threads.length + 1; thread.arg = arg; thread.values = new Map(); inst.threads.push(thread); return thread.id; },
    };
    if (extra) Object.assign(values, extra);
    for (const k of Object.keys(values)) if (values[k] && values[k].__wrap) { values[k].__inst = inst; values[k].__hostName = k; }
    inst.hostValues = values;
    const env = vm.environment(values), index = this.instances.indexOf(inst), object = this.persist.refValue(env).value, info = vm.envInfo.get(object);
    const owner = index >= 0 ? ['env', 'loaded', index] : inst.plan && inst.id !== undefined ? ['penv', 'ploaded', inst.id] : null;
    if (owner) { this.envOwners.set(object, { kind: owner[0], i: owner[2] }); if (info) this.envOwners.set(info.loaded, { kind: owner[1], i: owner[2] }); }
    return env;
  }

  start(inst) {
    const src = this.source(inst.key); if (src === undefined) return;
    if (src === null) { this.errors.set(inst.name, 'Lua script was not found'); inst.state = 'over'; return; }
    const vm = this.vm;
    inst.tags = inst.history.slice();
    inst.env = this.environment(inst); inst.values.clear(); inst.exit = false; inst.starts++; this.current = inst;
    try {
      const error = vm.run(src, inst.name, inst.env); if (error) throw new Error(error);
      const definitions = vm.call(inst.env, 'Base_Definitions'); if (!definitions.ok && !definitions.missing) throw new Error(definitions.error);
      for (const [name, args] of inst.initialCallbacks || []) { const fn = vm.ref(inst.env, name); if (fn) inst.events.push({ fn, params: args, release: true }); }
      inst.thread = vm.thread(inst.env, 'main'); inst.rate = Math.max(1 / 30, +vm.read(inst.env, 'ServiceRate') || 0.2);
      inst.state = 'run'; inst.initialized = true;
    } catch (error) {
      this.drop(inst);
      if (String(error.message).includes('@@need')) { inst.needs.push(String(error.message).match(/@@need ([^\r\n]+)/)?.[1]); inst.state = 'new'; }
      else { this.errors.set(inst.name, error.message); inst.state = 'over'; }
    } finally { this.current = null; }
  }

  service(inst) {
    if (inst.state !== 'run') return;
    const vm = this.vm; this.current = inst;
    try {
      const r = inst.thread ? vm.resume(inst.thread) : { done: false };
      if (r.error) throw new Error(r.error);
      for (const thread of inst.threads.slice()) {
        inst.running = thread; const result = vm.resume(thread, thread.arg); inst.running = null;
        if (result.error) throw new Error(result.error);
        if (result.done || result.value === false) { vm.free(thread.ref); inst.threads.splice(inst.threads.indexOf(thread), 1); }
      }
      if (inst.exit || r.done || r.value === false) { this.drop(inst); inst.state = 'over'; }
    } catch (error) {
      this.drop(inst);
      if (String(error.message).includes('@@need')) {
        const module = String(error.message).match(/@@need ([^\r\n]+)/)?.[1]; inst.needs.push(module);
        this.errors.set(inst.name, 'Runtime module was not prefetched: ' + module + '. Script stopped to prevent replaying campaign actions.\n' + error.message);
      } else this.errors.set(inst.name, error.message);
      inst.state = 'over';
    } finally { this.current = null; inst.running = null; }
  }

  update(dt = 0, force = false, serviceDt = dt) {
    if (this.disposed || this.running) return;
    this.time += Math.max(0, +dt || 0);
    this.serviceTime = (this.serviceTime ?? 0) + Math.max(0, +serviceDt || 0);
    const tick = Math.floor(this.serviceTime * 30 + 1e-6), service=force||tick!==this.lastLogicTick;
    this.lastLogicTick = tick; this.running = true;
    if (this.speechDone?.length) { const done = this.speechDone.splice(0); for (const n of done) this.signal('STORY_SPEECH_DONE', n); }
    if(service){this.objectCache=null;this.reasonCache.clear();}
    try {
      if(service&&!this.suspended)for (const inst of this.instances) {
        if (inst.state === 'new') { if (!this.pending.size) this.start(inst); }
        if (inst.state === 'run' && (force || this.serviceTime >= inst.next)) {
          inst.next = this.serviceTime + inst.rate; this.service(inst);
        }
      }
      this.pollEvents(!service);
    } finally { this.running = false; }
    if (this.loadRequest) { const request = this.loadRequest; this.loadRequest = null; this.game.onLoadCampaign?.(request); }
  }

  async warmInstance(inst, timeout = 12000) {
    const start = performance.now();
    while (performance.now() - start < timeout && inst.state === 'new') {
      if (this.pending.size) await Promise.all([...this.pending.values()]);
      else this.start(inst);
    }
  }
  async warm(timeout = 12000) {
    const start = performance.now();
    while (performance.now() - start < timeout && !this.disposed) {
      if (this.pending.size) await Promise.all([...this.pending.values()]);
      this.update(0, true);
      if (!this.pending.size && this.instances.every(i => i.state !== 'new') && this.instances.every(i => !i.tags.length && !i.events.length)) {
        this.update(0, true); break;
      }
    }
  }
  drop(inst) {
    if (inst.trigger) { this.vm.free(inst.trigger); inst.trigger = null; }
    if (inst.thread) { this.vm.free(inst.thread.ref); inst.thread = null; }
    for (const thread of inst.threads) this.vm.free(thread.ref); inst.threads.length = 0;
    if (inst.env != null) { this.vm.free(inst.env); inst.env = null; }
  }
  report() { return { instances: this.instances.map(i => ({ name: i.name, state: i.state })), errors: Object.fromEntries(this.errors), missing: Object.fromEntries(this.missing) }; }
  dispose() { this.disposed = true; this.popup.close(); for (const inst of this.instances) this.drop(inst); }
}
