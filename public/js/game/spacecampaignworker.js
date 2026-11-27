// A campaign (galactic conquest) space battle on the battle thread: rebuilds what the page set up around the battle
// (the book of who fought, the treasury, retreat, victory, tactical superweapons, the story plots) and steps it with
// the battle. What the player sees or hears is passed to the page as game events.
import { db } from '../gamedata.js';
import { restoreSpaceCampaign, restoreTacticalSuperweapons } from './savegame.js';
import { installTacticalBattle } from './tacticalbattle.js';
import { TacticalStoryHost } from './tacticalstory.js';
import { spaceRetreat, startCinematicRetreat, stepCinematicJumps, autoResolveBattle, campaignVictoryStep, tacticalCredits } from './spacecampaign.js';
import { plain } from './spacebattlehooks.js';
import { StoryFlags } from './storyflags.js';
import { storyTypes } from './storyart.js';
import { isSuperweaponTarget, superweaponClipNames } from './tacticalsuperweapon.js';
import { loadALA } from '../ala.js';
import { promoteToCinematicLayer } from './cinematiclayer.js';
import { modelsForType } from './sim.js';
import { preloadModels } from '../model.js';

const TICK = 1 / 30;

const typed = list => (list || []).map(u => ({ ...u, type: typeof u.type === 'string' ? db.type(u.type) : u.type })).filter(u => u.type);

// Game methods the campaign code calls for what is seen or heard; on the battle thread they become page events.
function presentation(game, events) {
  const tell =
    (to, name) =>
    (...a) => {
      events.push([to, name, a.map(x => plain(x))]);
    };
  for (const name of [
    'retreatCameraStart',
    'retreatCameraFrame',
    'retreatCameraEnd',
    'retreatLine',
    'superweaponCamera',
    'openRetryDialog',
    'showScreenText',
    'playScriptMovie',
    'stopScriptMovie',
    'toggleStorySummary'
  ])
    game[name] = tell('game', name);
  game.audio = {
    play: tell('audio', 'play'),
    playAt: tell('audio', 'playAt'),
    playFor: tell('audio', 'playFor'),
    setPlaylist: tell('audio', 'setPlaylist'),
    stopMusic: tell('audio', 'stopMusic'),
    speech: {
      load: async () => {},
      on: () => null,
      replace: tell('speech', 'replace'),
      enqueue: tell('speech', 'enqueue')
    }
  };
  game.movies = { play: tell('movies', 'play'), stop: tell('movies', 'stop') };
  // Story camera moves set renderer.x / renderer.y; the page's camera follows.
  const camera = tell('game', 'storyCameraAxis');
  game.renderer = {
    set x(v) {
      camera('x', v);
    },
    set y(v) {
      camera('y', v);
    }
  };
  // Tutorial style rewards that only change what is shown (flashes, highlights, dialogs) play on the page.
  game.forwardStoryReward = e => {
    tell('game', 'storyReward')(e.reward, e.rewards || [], e.name || '', e.plot?.owner || null);
    return true;
  };
  game.ui = { refresh: tell('ui', 'refresh') };
  // Linked mission scripts: the camera, screen effects, controls lock, music and movies are the page's; suspending
  // the AI and lifting units onto the cinematic layer change the battle and stay here.
  const cinematic = (op, ...a) => events.push(['game', 'cinematicCall', [op, ...a.map(x => plain(x))]]);
  game.tacticalCinematics = { stop: () => cinematic('stop') };
  game.forwardPresentation = (name, args) => tell('game', 'linkedPresentationCall')(name, args);
  game.installMissionScripts = scripts => {
    if (!scripts) return;
    const vm = scripts.vm,
      at = v => {
        const p = scripts.at(v);
        return p ? { x: p.x, y: p.y, z: p.z || 0 } : null;
      },
      key = (channel, transition) => (...args) => {
        const i = transition ? 2 : 1,
          out = args.slice();
        out[0] = at(args[0]);
        out[i + 4] = scripts.of(args[i + 4]) || null;
        cinematic('key', channel, transition, out);
      };
    vm.global('Point_Camera_At', v => {
      const p = at(v);
      if (p) cinematic('point', p);
    });
    vm.global('Start_Cinematic_Camera', (...args) => cinematic('start', args));
    vm.global('End_Cinematic_Camera', () => cinematic('stop'));
    vm.global('Set_Cinematic_Camera_Key', key('position', false));
    vm.global('Set_Cinematic_Target_Key', key('target', false));
    vm.global('Transition_Cinematic_Camera_Key', key('position', true));
    vm.global('Transition_Cinematic_Target_Key', key('target', true));
    vm.global('Transition_To_Tactical_Camera', seconds => cinematic('tactical', seconds));
    vm.global('Promote_To_Space_Cinematic_Layer', v => {
      const e = scripts.of(v);
      if (e) promoteToCinematicLayer(e);
    });
    vm.global('Set_Cinematic_Environment', on => tell('game', 'setCinematicEnvironment')(on));
    vm.global('Lock_Controls', (...args) => {
      if (args.length) tell('game', 'lockControls')(typeof args[0] === 'number' && args[0] > 0);
    });
    vm.global('Suspend_AI', on => {
      game.world.aiSuspended = typeof on === 'number' && on > 0;
    });
    vm.global('Weather_Audio_Pause', on => tell('game', 'pauseWeatherAudio')(on === true));
    vm.global('Play_Bink_Movie', name => tell('game', 'playScriptMovie')(name));
    vm.global('Stop_Bink_Movie', () => tell('game', 'stopScriptMovie')());
    for (const name of ['Stop_All_Music', 'Play_Music', 'Resume_Mode_Based_Music', 'Stop_All_Speech'])
      vm.global(name, (...args) => tell('game', 'missionAudioCall')(name, args));
  };
  // Story goals are kept here; the page shows them and keeps track of which were read.
  game.showStoryDialog = request => tell('game', 'storyGoalOpened')(request, true);
  game.notifyStoryGoal = (request, sound = true) => tell('game', 'storyGoalOpened')(request, false, sound);
  game.storyDialog = { refreshSummary: () => tell('game', 'storyGoalsChanged')(game.tacticalStory?.storyGoals || []) };
  if (!('story' in game)) Object.defineProperty(game, 'story', { get: () => game.tacticalStory, configurable: true });
}

// Sets the campaign battle up on `game` (the battle thread's stand-in for the page game). `refs` maps save
// references to the restored entities. Returns the per-step and input handlers.
export async function campaignBattle(game, m, refs, thing, events) {
  const w = game.world,
    cs = m.campaignWorld || {},
    save = m.save;
  const cb = (game.setup.campaign = { ...(save.campaign?.setup?.campaign || game.setup.campaign) });
  cb.attacker = { ...cb.attacker, units: typed(cb.attacker.units) };
  cb.defender = { ...cb.defender, units: typed(cb.defender.units) };
  w.retreatDir = cs.retreatDir;
  w.retreatMarker = cs.retreatMarker;
  w.overrunSides = (cs.overrunSides || []).map(i => w.teams[i]).filter(Boolean);
  w.market = cs.market || {};
  if (cs.tacticalSessions) w.tacticalSessions = cs.tacticalSessions;
  if (cs.reinforcementsOff) w.reinforcementsOff = new Set(cs.reinforcementsOff);
  game.over = false;
  // The player on this page: in multiplayer each peer's story, retreat button and sounds are its own player's.
  if (m.viewer !== null && m.viewer !== undefined) game.human = w.players.find(p => p.id === m.viewer) || game.human;
  presentation(game, events);
  game.campaignBook = { entity: new Map(), waiting: [], absent: [], station: null, anchors: {}, called: new Map() };
  restoreSpaceCampaign(game, save, refs);
  game.campaignBook.called ||= new Map();
  // Reinforcements called down from the reserve go back to the galaxy only if they are on this list, as on the page.
  const told = w.onEvent;
  w.onEvent = (kind, data) => {
    told.call(w, kind, data);
    if (kind !== 'built' || !data?.entity || !data.player?.team) return;
    const called = game.campaignBook.called,
      team = data.player.team.id;
    if (!called.has(team)) called.set(team, []);
    called.get(team).push(data.entity);
  };
  await installTacticalBattle(game);
  // Tactical superweapons: the targets are map objects (scenery on the page), in map order on both sides.
  const manager = w.tacticalSuperweapons;
  manager.replace = (type, transform) => events.push(['game', 'tacticalReplacement', [plain(type), plain(transform)]]);
  manager.resetHUD = () => events.push(['game', 'superweaponHUDReset', []]);
  manager.music = name => events.push(['game', 'superweaponMusic', [name]]);
  for (const o of game.map?.objects || []) {
    if (!isSuperweaponTarget(o.type) || manager.planet?.destroyed) continue;
    const index = manager.targets.length;
    manager.addTarget({
      type: o.type,
      owner: 'Neutral',
      x: o.pos[0],
      y: o.pos[1],
      z: o.pos[2],
      rotation: o.rot.slice(),
      scale: o.scale || 1,
      dead: false,
      remove: () => events.push(['game', 'superweaponTargetGone', [index]])
    });
  }
  // The battle's units were put back before the manager existed; on the page it saw them arrive.
  for (const u of w.units) if (!u.dead) manager.add(u);
  // The superlaser opens fire on a frame of its ATTACK clip, so this thread needs the clip timing too.
  await Promise.all(
    [...new Set(manager.units.flatMap(u => superweaponClipNames(u.type)))].map(name => Promise.resolve(loadALA(name)).catch(() => null))
  );
  restoreTacticalSuperweapons(w, save.battle?.superweapons, thing);
  let weaponsShown = '';
  game.tacticalVictory.notify = result => {
    if (result.retry) {
      events.push(['game', 'campaignWinner', [plain(result.team), !!result.suppressNotice, null, false]]);
      return;
    }
    w.onEvent('storyVictory', result);
    game.tacticalStory?.signal('STORY_VICTORY', result.team.factionName);
    // The page reports the victory to a linked mission's galaxy, which may hand back story flags.
    const flags = game.tacticalStory?.flags?.snapshot?.() || [];
    events.push(['game', 'campaignWinner', [plain(result.team), !!result.suppressNotice, flags, true]]);
  };
  game.retreat = spaceRetreat(game, cb);
  if (save.battle?.retreat) game.retreat.restore(save.battle.retreat, thing);
  game.startCinematicRetreat = (id, seconds) => startCinematicRetreat(game, id, seconds);
  let retreating = false,
    shown = '';
  return {
    // Story plots need the battle scripts compiled first, and come before saved scripts are put back.
    story: async (scripts, restoring) => {
      // Types the story plots name are loaded up front, as the page does, so story spawns never wait for art.
      const plots = [...(cb.storyPlots || []).map(p => p.name), game.setup.tacticalStoryPlot, 'SANDBOX_STANDARD.XML'].filter(Boolean),
        names = new Set(),
        seen = new Set();
      for (const t of await storyTypes(plots).catch(() => [])) modelsForType(t, null, names, seen);
      await preloadModels([...names].filter(Boolean)).catch(() => null);
      await TacticalStoryHost.create(game, scripts, { restoring });
    },
    command(player, cmd) {
      if (cmd.c === 'superweapon') {
        const id = Array.isArray(cmd.u) ? cmd.u[0] : 0,
          unit = id ? w.units.find(u => u.id === id) : null;
        if (unit) manager.command(unit, player, false);
        return true;
      }
      if (cmd.c === 'autoresolve') {
        if (!game.over && !game.tacticalVictory.winner) autoResolveBattle(game, player);
        return true;
      }
      if (player === game.human) game.tacticalStory?.command?.(w, cmd);
      return false;
    },
    input(c) {
      const story = game.tacticalStory;
      if (!story) return;
      if (c.generic) story.generic(c.generic);
      if (c.select) for (const name of c.select) story.signal('STORY_SELECT_UNIT', name);
      if (c.speechDone) story.signal('STORY_SPEECH_DONE', c.speechDone);
      if (c.flags) story.flags = new StoryFlags(c.flags);
      if (c.escape) game.scripts?.storyEscape?.();
    },
    step() {
      const outcome = campaignVictoryStep(game);
      if (outcome) {
        if (w.tacticalSessions) outcome.credits = tacticalCredits(w);
        outcome.storyFlags = game.tacticalStory?.flags?.snapshot?.() || null;
        game.over = true;
        events.push(['game', 'campaignFinished', [JSON.parse(JSON.stringify(outcome))]]);
        w.onEvent('gameover', { winner: w.winner, ready: true });
      }
      game.retreat?.step(TICK);
      stepCinematicJumps(game, TICK);
      game.scripts?.updateStory?.(TICK);
      game.tacticalStory?.update();
      // Story switches the page reads: reinforcements and advisor per faction, fog, skirmish rules.
      const state = JSON.stringify({
        reinforcements: game.reinforcementsEnabled || null,
        advisor: game.advisorEnabled || null,
        fog: !!w.fog,
        skirmishRules: !!game.skirmishRules
      });
      if (state !== shown) {
        shown = state;
        events.push(['game', 'storyState', [JSON.parse(state)]]);
      }
      // What the superweapon button and countdown on the page show.
      if (manager.units.length) {
        const list = manager.units
          .filter(u => !u.dead)
          .map(u => {
            const r = manager.record(u);
            return [plain(u), r.state, r.target ? manager.targets.indexOf(r.target) : -1, r.speed, r.previousDistance];
          });
        const shownNow = JSON.stringify([list, manager.eligible(), manager.disableDepth]);
        if (shownNow !== weaponsShown) {
          weaponsShown = shownNow;
          events.push(['game', 'superweaponState', JSON.parse(shownNow)]);
        }
      }
      const now = !!game.retreat?.active && game.retreat.active.player === game.human;
      if (now !== retreating) {
        retreating = now;
        events.push(['game', 'retreatActive', [now]]);
      }
    }
  };
}
