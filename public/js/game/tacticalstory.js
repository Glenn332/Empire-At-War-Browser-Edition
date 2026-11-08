import { installTacticalMission } from './tacticalmission.js';
import { installLinkedPresentation } from './linkedpresentation.js';
import { linkedParent } from './linktactical.js';
import { StoryPlots } from './storyplots.js';
import { StoryFlags } from './storyflags.js';
import { TacticalCampaign } from './tacticalcampaign.js';
import { db } from '../gamedata.js';
import { setRetreatDisabled } from './retreat.js';
import { loadTacticalCameraData } from './tacticalcameradata.js';
import { sandboxGate, sandboxPlot, setSandboxObjectives } from './tacticalsandbox.js';
import { openRetryDialog } from './retrydialog.js';
import { tutorialReward } from './tutorialrewards.js';
import { installTacticalSpeech } from './tacticalspeech.js';
const key = s =>
  String(s || '')
    .replace(/\\/g, '/')
    .toUpperCase();
export class TacticalStoryHost extends StoryPlots {
  static async create(game, scripts, { restoring = false } = {}) {
    if (!game.tacticalCampaign && game.setup.campaign?.galaxy) game.tacticalCampaign = await TacticalCampaign.create(game);
    const host = (game.tacticalStory = new TacticalStoryHost(game, scripts));
    for (const request of game.setup.campaign?.storyPlots || []) await host.readPlot(request.name, '', request.owner);
    if (sandboxGate(game)) await host.readPlot(sandboxPlot(game), '', game.human?.factionName || game.factions?.[game.me]);
    if (game.setup.tacticalStoryPlot)
      await host.readPlot(game.setup.tacticalStoryPlot, '', game.human?.factionName || game.factions?.[game.me]);
    await installTacticalSpeech(game, host);
    installLinkedPresentation(game, scripts);
    if (game.setup.linkedTactical) {
      game.tacticalCameraData = await loadTacticalCameraData();
      installTacticalMission(game, scripts);
    }
    if (scripts) {
      scripts.story = host;
      for (const plot of host.plots.values()) if (plot.scriptName) plot.instance = scripts.addStoryScript(plot.scriptName, plot);
      if (scripts.storyInstances.length && !restoring) await scripts.warm();
    }
    if (!restoring) host.update();
    return host;
  }
  constructor(game, scripts) {
    super();
    this.game = game;
    this.scripts = scripts;
    this.plots = new Map();
    this.eventTypes = new Map();
    this.timedEvents = new Set();
    this.errors = new Map();
    this.missing = new Map();
    this.storyGoals = [];
    this.storyGoalId = 0;
    this.resetDepth = 0;
    this.time = 0;
    this.galaxy = game.tacticalCampaign?.galaxy;
    this.flags = new StoryFlags(this.galaxy?.storyFlagsSaved || game.setup.campaign?.galaxy?.storyFlags);
    if (this.galaxy) this.galaxy.storyFlagSnapshot = () => this.flags.snapshot();
    this.planets = new WeakMap();
    this.disableDepth = 0;
  }
  currentStoryPlot() {
    return this.scripts?.current?.plot;
  }
  absent(kind) {
    return name => (/^[A-Z]/.test(name) ? () => this.unsupported(kind + '.' + name) : undefined);
  }
  unsupported(name) {
    this.missing.set(name, (this.missing.get(name) || 0) + 1);
  }
  invokeStoryCallback(inst, name) {
    this.scripts?.storyCallback(inst, name);
  }
  planet(p) {
    if (!p) return undefined;
    let wrapper = this.planets.get(p);
    if (wrapper) return wrapper;
    const owner = () => this.scripts?.world.players.find(player => key(player.factionName) === key(p.owner));
    wrapper = {
      __wrap: true,
      __name: p.name,
      __planet: p,
      Is_Valid: () => true,
      Get_Type: () => this.scripts?.type(p.type),
      Get_Owner: () => this.scripts?.player(owner()),
      Is_Planet_Destroyed: () => !!p.destroyed,
      __missing: this.absent('Planet')
    };
    this.planets.set(p, wrapper);
    return wrapper;
  }
  reward(e) {
    if (this.commonReward(e)) return;
    const p = e.rewards,
      game = this.game,
      manager = game.world.tacticalSuperweapons || this;
    switch (e.reward) {
      case '':
        break;
      case 'CREDITS': {
        const owner = key(e.plot?.owner || this.factionOf({ side: game.me })),
          amount = parseFloat(p[0]) || 0,
          w = game.world;
        if (w.credits && game.factions) {
          const side = game.factions.findIndex(f => key(f) === owner);
          if (side >= 0) w.credits[side] = Math.max(0, w.credits[side] + amount);
        } else {
          const pl = (w.players || []).find(q => key(q.factionName) === owner);
          if (pl) pl.credits = Math.max(0, pl.credits + amount);
        }
        break;
      }
      case 'POSITION_CAMERA':
      case 'SCROLL_CAMERA': {
        const u = (game.world.units || []).find(x => !x.dead && key(x.type?.name) === key(p[0]));
        if (!u) break;
        const o =
          e.reward === 'POSITION_CAMERA'
            ? String(p[1] || '')
                .split(',')
                .map(n => parseFloat(n) || 0)
            : [0, 0];
        if (game.view && game.landBattle !== false && 'dist' in game.view) {
          game.view.x = u.x + (o[0] || 0);
          game.view.y = u.y + (o[1] || 0);
        } else if (game.renderer) {
          game.renderer.x = u.x + (o[0] || 0);
          game.renderer.y = u.y + (o[1] || 0);
        }
        break;
      }
      case 'USE_RETRY_DIALOG':
        game.useRetry = true;
        break;
      case 'ACTIVATE_RETRY_DIALOG':
        openRetryDialog(game);
        break;
      case 'DISABLE_REINFORCEMENTS': {
        const on = (parseInt(p[0], 10) || 0) === 0,
          list = (game.reinforcementsEnabled ||= {});
        const off = (game.world.reinforcementsOff ||= new Set());
        for (const f of p[1] ? [p[1]] : game.factions || game.world.players?.map(q => q.factionName) || []) {
          list[key(f)] = on;
          if (on) off.delete(key(f));
          else off.add(key(f));
        }
        game.ui?.refresh?.();
        break;
      }
      case 'SET_ADVISOR': {
        const owner = e.plot?.owner || this.factionOf({ side: game.me });
        (game.advisorEnabled ||= {})[key(owner)] = (parseInt(p[0], 10) || 0) !== 0;
        break;
      }
      case 'ENABLE_FOW': {
        const on = (parseInt(p[0], 10) || 0) !== 0;
        if (game.world) game.world.fog = on;
        if (game.setup) game.setup.fog = on;
        break;
      }
      case 'SET_SANDBOX_OBJECTIVES':
        if (!setSandboxObjectives(this, game, e.plot, db.constants))
          this.errors.set(e.name, 'Unable to set sandbox objectives due to missing subplot');
        break;
      case 'LINK_TACTICAL':
        if (!linkedParent(game)?.queueLinkedTactical(p)) this.unsupported('Reward.LINK_TACTICAL');
        break;
      case 'ENABLE_VICTORY':
        if (parseInt(p[0], 10)) {
          if (manager.disableDepth > 0) manager.disableDepth--;
          if (!manager.disableDepth) game.tacticalVictory?.release();
        } else manager.disableDepth++;
        break;
      case 'VICTORY': {
        const quiet = !!parseInt(p[1], 10);
        if (game.storyTacticalVictory) {
          if (game.storyTacticalVictory(p[0], quiet) === false) this.unsupported('Reward.VICTORY:' + p[0]);
          break;
        }
        const team = (this.scripts?.world || game.world).teams.find(t => key(t.factionName) === key(p[0]));
        if (!team || !game.tacticalVictory) {
          this.unsupported('Reward.VICTORY:' + p[0]);
          break;
        }
        manager.disableDepth = 0;
        game.tacticalVictory.request(team, 16, quiet ? 30 : 210, 0, quiet);
        break;
      }
      case 'ENABLE_BOUNTY_COLLECTION':
        if (game.world.bounty) game.world.bounty.enabled = true;
        break;
      case 'DISABLE_BOUNTY_COLLECTION':
        if (game.world.bounty) game.world.bounty.enabled = false;
        break;
      case 'DISABLE_RETREAT':
        setRetreatDisabled(p[0], (parseInt(p[1], 10) || 0) !== 0);
        break;
      case 'FORCE_RETREAT': {
        const c = game.world?.retreat;
        if (c && !c.active) c.requestByFaction(p[0]);
        break;
      }
      case 'HIDE_AUTORESOLVE':
        break;
      case 'SPEECH':
        if (p[0]) game.audio?.speech?.replace(p[0]);
        break;
      case 'MULTIMEDIA':
        if (p[0])
          game.showScreenText?.({
            id: p[0],
            textId: p[0],
            text: db.t(p[0]),
            duration: p[1] ? +p[1] : 5,
            variable: p[2] || '',
            remove: !!p[3],
            teletype: !p[4] || +p[4] !== 0,
            color: p[5] || ''
          });
        if (p[7]) game.audio?.speech?.replace(p[7]);
        if (p[8]) game.movies?.play(p[8], !!parseInt(p[9], 10));
        break;
      case 'COMMANDBAR_MOVIE':
        if (p[0]) game.movies?.play(p[0], !!parseInt(p[1], 10));
        break;
      case 'STOP_COMMANDBAR_MOVIE':
        game.movies?.stop();
        break;
      case 'SCREEN_TEXT':
        game.showScreenText?.({
          id: p[0],
          textId: p[0],
          text: db.t(p[0]),
          duration: p[1] ? +p[1] : 5,
          variable: p[2] || '',
          remove: !!p[3],
          teletype: !p[4] || +p[4] !== 0,
          color: p[5] || ''
        });
        break;
      default:
        if (!tutorialReward(this, e)) this.unsupported('Reward.' + e.reward);
    }
  }
  update() {
    this.time = this.game.world.time;
    this.pollEvents();
    this.pollDestroyed();
    this.pollProximity();
    this.pollFogReveal();
  }
  pollFogReveal() {
    const objects = (this.eventTypes.get('STORY_FOG_OBJECT_REVEAL') || []).filter(e => this.waiting(e)),
      points = (this.eventTypes.get('STORY_FOG_POSITION_REVEAL') || []).filter(e => this.waiting(e));
    if (!objects.length && !points.length) return;
    const game = this.game,
      w = this.scripts?.world || game.world;
    if (!w?.viewFogged) return;
    const me = key(game.human?.factionName || this.factionOf({ side: game.me })),
      lead = u => (u?.isSquad ? u.fighters?.[0] : u) || u,
      typeName = u => key((u.scriptType || u.type || lead(u)?.type)?.name);
    for (const e of points) {
      if (e.plot?.owner && key(e.plot.owner) !== me) continue;
      if (!w.viewFogged(parseFloat(e.params[0]) || 0, parseFloat(e.params[1]) || 0)) this.fire(e);
    }
    if (!objects.length) return;
    const all = [...(w.selectables?.() || []), ...(w.units || [])].filter(u => u && !u.dead);
    for (const e of objects) {
      if (e.plot?.owner && key(e.plot.owner) !== me) continue;
      const wanted = String(e.params[0] || '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(key);
      if (all.some(u => wanted.includes(typeName(u)) && !w.viewFogged(lead(u).x, lead(u).y))) this.fire(e);
    }
  }
  selected(list) {
    for (const s of list || []) if (s?.type?.name) this.signal('STORY_SELECT_UNIT', s.type.name);
  }
  command(world, cmd) {
    const all = [...(world?.units || []), ...(world?.squads || [])],
      find = id => (id ? all.find(u => u.id === id && !u.dead) : null),
      units = (Array.isArray(cmd?.u) ? cmd.u : []).map(find).filter(Boolean);
    if (cmd?.c === 'move' && !cmd.t && cmd.x !== undefined)
      for (const u of units) this.commanded(u.type?.name, { x: +cmd.x || 0, y: +cmd.y || 0, z: +cmd.z || 0 });
    else if (cmd?.c === 'formmove')
      for (const [id, x, y] of Array.isArray(cmd.p) ? cmd.p : []) this.commanded(find(id)?.type?.name, { x: +x || 0, y: +y || 0, z: 0 });
    else if (cmd?.c === 'guard' && cmd.t) {
      const target = find(cmd.t);
      if (target) for (const u of units) this.guarded(u.type?.name, target.type?.name);
    } else if (cmd?.c === 'attack' && cmd.t && cmd.hp >= 0) {
      const hardpoint = find(cmd.t)?.hardpoints?.[cmd.hp];
      if (hardpoint?.def?.name) this.signal('STORY_ATTACK_HARDPOINT', hardpoint.def.name);
    }
  }
  storyNames(s) {
    return String(s || '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(key);
  }
  storyObjects(names) {
    const w = this.scripts?.world || this.game.world,
      all = [...(w.selectables?.() || []), ...[...(this.game.world?.mapObjects?.values() || [])].flat()];
    return all.filter(u => u && !u.dead && names.includes(key((u.scriptType || u.type)?.name)));
  }
  commanded(type, at) {
    if (!type) return;
    for (const e of this.eventTypes.get('STORY_COMMAND_UNIT') || []) {
      if (!this.waiting(e) || !this.storyNames(e.params[0]).includes(key(type))) continue;
      const targets = this.storyNames(e.params[1]),
        range = parseFloat(e.params[2]) || 0;
      if (!targets.length || range === 0) {
        this.fire(e);
        continue;
      }
      if (this.storyObjects(targets).some(t => Math.hypot((t.x || 0) - at.x, (t.y || 0) - at.y, (t.z || 0) - at.z) < range)) this.fire(e);
    }
  }
  guarded(type, target) {
    if (!type || !target) return;
    for (const e of this.eventTypes.get('STORY_GUARD_UNIT') || []) {
      if (!this.waiting(e)) continue;
      const units = this.storyNames(e.params[0]),
        guards = this.storyNames(e.params[1]),
        i = units.indexOf(key(type));
      if (i >= 0 && guards[i] === key(target)) this.fire(e);
    }
  }
  pollProximity() {
    const list = (this.eventTypes.get('STORY_UNIT_PROXIMITY') || []).filter(e => this.waiting(e));
    if (!list.length) return;
    const game = this.game,
      w = this.scripts?.world || game.world,
      me = key(game.human?.factionName || this.factionOf({ side: game.me })),
      lead = u => (u?.isSquad ? u.fighters?.[0] : u) || u,
      typeName = u => key((u.scriptType || u.type || lead(u)?.type)?.name),
      all = [...(w.selectables?.() || []), ...[...(game.world.mapObjects?.values() || [])].flat()].filter(u => u && !u.dead),
      mine = all.filter(u => !u.mapMarker && key(this.factionOf(u)) === me && !u.container && !u.inside);
    const names = s =>
      String(s || '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(key);
    for (const e of list) {
      if (e.plot?.owner && key(e.plot.owner) !== me) continue;
      const want = names(e.params[0]),
        targets = all.filter(u => names(e.params[1]).includes(typeName(u))),
        range = parseFloat(e.params[2]) || 0;
      if (!targets.length) continue;
      const near = mine.some(u => {
        if (want.length && !want.includes(typeName(u))) return false;
        const a = lead(u);
        return targets.some(t => {
          const b = lead(t);
          return Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0), (b.z || 0) - (a.z || 0)) < range;
        });
      });
      if (near) this.fire(e);
    }
  }
  reinforceOwner(e) {
    return e.plot?.owner || this.factionOf({ side: this.game.me });
  }
  factionOf(u) {
    return u?.player?.factionName ?? this.game.factions?.[u?.side] ?? '';
  }
  pollDestroyed() {
    const list = this.eventTypes.get('STORY_CHECK_DESTROYED');
    if (!list?.length) return;
    const w = this.game.world,
      all = [...(w.units || []), ...(w.squads || [])].filter(u => !u.dead);
    for (const e of list) {
      if (e.disabled || e.completed || !(e.active ?? this.prerequisites(e)) || e.plot?.active === false) continue;
      const mode = key(e.params[1]),
        faction = key(e.params[0]),
        mine = u => key(this.factionOf(u)) === faction;
      let done = false;
      if (mode === 'DESTROY_ALL_INDIGENOUS_SPAWNERS') {
        const t = key(e.params[2]);
        done = !!t && !all.some(u => key(u.type?.name) === t);
      } else if (mode === 'DESTROY_ALL') done = !!faction && !all.some(mine);
      else if (mode === 'DESTROY_ALL_UNITS') done = !!faction && !all.some(u => mine(u) && !u.structure);
      else if (mode === 'DESTROY_ALL_STRUCTURES') done = !!faction && !all.some(u => mine(u) && u.structure);
      if (done) this.fire(e);
    }
  }
  report() {
    return {
      plots: [...this.plots.values()].map(p => ({ name: p.name, owner: p.owner, script: p.scriptName, state: p.instance?.state })),
      errors: Object.fromEntries(this.errors),
      missing: Object.fromEntries(this.missing)
    };
  }
}
