// The page's view of a campaign battle's story while the story itself runs on the battle thread: the story goals
// the dialog lists, and the player's clicks, selections and finished speech passed back to the story.
import { installTacticalNotices } from './tacticalnotice.js';
import { installTacticalSpeech } from './tacticalspeech.js';
import { GalacticMovies } from './galacticmovies.js';
import { installLinkedPresentation } from './linkedpresentation.js';
import { loadTacticalCameraData } from './tacticalcameradata.js';

export async function installCampaignStoryView(game) {
  const send = c => game.mirror?.worker?.postMessage({ k: 'story', ...c });
  const view = (game.tacticalStory = {
    storyGoals: [],
    seen: new Set(),
    generic: name => send({ generic: name }),
    selected: list => {
      const names = (list || []).map(s => s?.type?.name).filter(Boolean);
      if (names.length) send({ select: names });
    },
    signal: (type, name) => {
      if (type === 'STORY_SPEECH_DONE') send({ speechDone: name });
    },
    update() {},
    command() {},
    flags: { snapshot: () => [] }
  });
  installTacticalNotices(game);
  await installTacticalSpeech(game, view);
  // Linked missions: the fade and letterbox layer the mission scripts drive, and the cinematic lens.
  installLinkedPresentation(game, null);
  if (game.setup.linkedTactical) game.tacticalCameraData = await loadTacticalCameraData();
  const at = game.ui?.bar?.movieAt;
  if (!game.movies && at) game.movies = new GalacticMovies(game, null, { anchor: [at.x, at.y], root: game.ui.bar.root });
  return view;
}

// Adds a goal the story opened; returns the view's list.
export function addStoryGoal(view, request) {
  view.seen.add(request.id);
  view.storyGoals.unshift(request);
}

// Takes the story's current goals, keeping which ones were read here and leaving out ones the dialog removed.
export function mergeStoryGoals(view, goals) {
  const here = new Map(view.storyGoals.map(g => [g.id, g]));
  view.storyGoals = goals
    .filter(g => !view.seen.has(g.id) || here.has(g.id))
    .map(g => {
      view.seen.add(g.id);
      return { ...g, read: g.read || !!here.get(g.id)?.read };
    });
}
