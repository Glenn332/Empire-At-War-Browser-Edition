import { db } from '../gamedata.js';
import { GalacticStoryDialog } from './galacticstorydialog.js';

const factionOf = game => game.human?.faction || db.faction(game.human?.factionName || game.factions?.[game.me]);

export function installTacticalNotices(game) {
  if (game.tacticalNotices) return;
  game.tacticalNotices = true;
  if (!('story' in game)) Object.defineProperty(game, 'story', { get: () => game.tacticalStory, configurable: true });
  const dialog = () => (game.storyDialog ||= new GalacticStoryDialog(game));
  game.showStoryDialog = request => {
    const d = dialog();
    if (d.opened) return d.refreshSummary();
    return d.show(request);
  };
  game.notifyStoryGoal = (request, sound = true) => {
    if (game.storyDialog?.opened) return game.storyDialog.refreshSummary();
    const f = factionOf(game),
      text = db.t(f?.str('Default_Transmission_Message'));
    if (text) {
      if (game.advisor?.message) game.advisor.message(text, f?.str('SFXEvent_HUD_Advisor_Urgent'));
      else game.message?.(text);
    }
    if (sound) game.audio?.play(f?.str('SFXEvent_Mission_Added'));
  };
  game.toggleStorySummary = () => {
    const d = dialog();
    if (d.opened) d.close();
    else d.showSummary();
  };
}
