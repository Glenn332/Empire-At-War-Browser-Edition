import { loadHudAssets } from './hud.js';
import { GalacticScreenText } from './galacticscreentext.js';

export async function installTacticalSpeech(game, host) {
  const speech = game.audio?.speech;
  if (speech) await speech.load().catch(() => null);
  game.overlayScale ??= () => Math.min(innerWidth / 1024, innerHeight / 768);
  if (!game.showScreenText && typeof document !== 'undefined') {
    const comps = game.hudAssets?.comps || (await loadHudAssets().catch(() => null))?.comps;
    if (comps?.get('TUTORIAL_TEXT')) {
      const text = (game.screenText = new GalacticScreenText(game, comps));
      text.root.style.zIndex = '10';
      game.showScreenText = request => text.show(request);
      const resize = () => text.resize();
      addEventListener('resize', resize);
      game.screenTextOff = () => removeEventListener('resize', resize);
    }
  }
  game.speechStoryDone?.();
  game.speechStoryDone = speech?.on('storydone', record => {
    host.signal('STORY_SPEECH_DONE', record.name);
    game.screenText?.show({ id: 'TEXT_SPEECH_' + record.name, remove: true });
  });
}

// the window and the speech player outlive a battle: what the battle hung on them goes with it, or the whole
// battle stays in memory after it ends
export function releaseTacticalSpeech(game) {
  game.screenTextOff?.();
  game.screenTextOff = null;
  game.speechStoryDone?.();
  game.speechStoryDone = null;
  game.screenText?.dispose();
}

export function stepTacticalSpeech(game, real) {
  game.audio?.speech?.update();
  game.screenText?.update(real);
}
