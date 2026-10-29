import { reportLinkedVictory } from './linktactical.js';
import { openRetryDialog } from './retrydialog.js';
import { db } from '../gamedata.js';
import { TacticalCampaign } from './tacticalcampaign.js';
import { TacticalSuperweapons } from './tacticalsuperweapon.js';
import { TacticalVictory } from './tacticalvictory.js';
import { superweaponShot } from './tacticalsuperweaponcamera.js';

export async function installTacticalBattle(game) {
  const campaign = (game.tacticalCampaign = await TacticalCampaign.create(game));
  game.tacticalVictory = new TacticalVictory(
    result => {
      if (result.retry) {
        game.tacticalVictoryNotice(result.team, result.suppressNotice);
        return;
      }
      game.world.onEvent('storyVictory', result);
      game.tacticalStory?.signal('STORY_VICTORY', result.team.factionName);
      reportLinkedVictory(game, result.team.factionName);
      game.tacticalVictoryNotice(result.team, result.suppressNotice);
    },
    { retry: team => !!game.useRetry && team !== game.human?.team, onRetry: () => openRetryDialog(game) }
  );
  const manager = (game.world.tacticalSuperweapons = new TacticalSuperweapons(game.world, {
    planet: campaign?.planet,
    defender: game.world.teams[game.setup.campaign?.defender.team],
    destroyPlanet: u => campaign?.destroy(u) || false,
    replace: (type, transform) => game.tacticalReplacement(type, transform),
    requestVictory: (team, type, frames) => game.tacticalVictory.request(team, type, frames, game.world.tacticalSuperweapons.disableDepth),
    resetHUD: () => game.superweaponHUD?.reset(),
    camera: (unit, target) => {
      if (game.cine) {
        game.cine.stop();
        game.cine.start();
        game.cine.sequence = superweaponShot(game, unit, target);
      }
    },
    music: name => {
      const event = db.music.get(name.toUpperCase());
      if (event) game.audio.setPlaylist(event.list('Files'), true, true);
      else if (!name) {
        game.audio.stopMusic();
        if (game.music) {
          game.music.mode = '';
          game.setMusic('ambient', true);
        }
      }
    },
    voice: (unit, threshold) => {
      const enemy = game.human.faction.list('Enemies').some(n => n.toUpperCase() === unit.player.factionName.toUpperCase());
      const suffix = threshold ? `Moving_Range_${String(threshold).padStart(2, '0')}_Seconds` : 'Moved_Into_Range';
      const name = game.human.faction.str(`SpeechEvent_Super_Weapon_${enemy ? 'Enemy_' : ''}${suffix}`);
      if (name) game.audio.speech.enqueue(name);
    }
  }));
  return manager;
}
