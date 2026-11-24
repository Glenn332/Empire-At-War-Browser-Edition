// A campaign (galactic conquest) space battle on the battle thread: rebuilds what the page set up around the battle
// (the book of who fought, the treasury, retreat, victory, tactical superweapons, the story plots) and steps it with
// the battle. What the player sees or hears is passed to the page as game events.
import { db } from '../gamedata.js';
import { restoreSpaceCampaign } from './savegame.js';
import { installTacticalBattle } from './tacticalbattle.js';
import { TacticalStoryHost } from './tacticalstory.js';
import { spaceRetreat, startCinematicRetreat, stepCinematicJumps, autoResolveBattle, campaignVictoryStep, tacticalCredits } from './spacecampaign.js';
import { plain } from './spacebattlehooks.js';

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
  game.ui = { refresh: tell('ui', 'refresh') };
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
  presentation(game, events);
  game.campaignBook = { entity: new Map(), waiting: [], absent: [], station: null, anchors: {}, called: new Map() };
  restoreSpaceCampaign(game, save, refs);
  game.campaignBook.called ||= new Map();
  await installTacticalBattle(game);
  game.tacticalVictory.notify = result => {
    if (result.retry) {
      events.push(['game', 'campaignWinner', [plain(result.team), !!result.suppressNotice]]);
      return;
    }
    w.onEvent('storyVictory', result);
    game.tacticalStory?.signal('STORY_VICTORY', result.team.factionName);
    events.push(['game', 'campaignWinner', [plain(result.team), !!result.suppressNotice]]);
  };
  game.retreat = spaceRetreat(game, cb);
  if (save.battle?.retreat) game.retreat.restore(save.battle.retreat, thing);
  game.startCinematicRetreat = (id, seconds) => startCinematicRetreat(game, id, seconds);
  let retreating = false;
  return {
    // Story plots need the battle scripts compiled first, and come before saved scripts are put back.
    story: async (scripts, restoring) => {
      await TacticalStoryHost.create(game, scripts, { restoring });
    },
    command(player, cmd) {
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
      const now = !!game.retreat?.active && game.retreat.active.player === game.human;
      if (now !== retreating) {
        retreating = now;
        events.push(['game', 'retreatActive', [now]]);
      }
    }
  };
}
