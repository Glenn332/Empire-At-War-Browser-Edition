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
