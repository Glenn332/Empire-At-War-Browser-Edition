import { BUILD } from '../build.js';
import { contentNow } from '../content.js';
import { stageStart } from './transit.js';

export const REPLAY_FORMAT = 'sw-revival-replay';
export const REPLAY_EXT = '.swrreplay';
const REPLAY_VERSION = 1;
const LOG_TIMEOUT_MS = 5000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const plainSetup = setup =>
  JSON.parse(
    JSON.stringify(setup, (key, value) =>
      value && typeof value === 'object' && !Array.isArray(value) && value.constructor && value.constructor !== Object ? undefined : value
    )
  );

export function replayUnavailableReason(game) {
  if (!game || game.setup?.attract) return 'not in a battle';
  if (game.galactic) return 'galactic campaigns are not recorded';
  if (game.landBattle) return 'land battles are not recorded yet';
  if (game.setup?.net) return 'multiplayer battles are not recorded (see the multiplayer files)';
  if (game.setup?.campaign || game.setup?.linkedTactical) return 'campaign battles are not recorded';
  if (game.setup?.restore) return 'the battle was loaded from a save';
  if (!game.mirror) return 'the battle is not running on the battle thread';
  if (!game.recording) return 'recording is switched off in Tweaks';
  return null;
}

export async function captureReplay(game) {
  if (replayUnavailableReason(game)) return null;
  const log = await Promise.race([game.mirror.replayLog(), new Promise(done => setTimeout(() => done(null), LOG_TIMEOUT_MS))]);
  if (!log?.inputs) return null;
  const { net, restore, replay, ...setup } = game.setup;
  return {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    build: BUILD,
    saved: new Date().toISOString(),
    content: contentNow(),
    setup: plainSetup(setup),
    until: log.step,
    inputs: log.inputs,
    checks: log.checks
  };
}

export function validateReplay(replay) {
  if (!replay || replay.format !== REPLAY_FORMAT) return 'That file is not a battle replay.';
  if (replay.version > REPLAY_VERSION) return 'That replay was made by a newer version of the game.';
  if (!replay.setup || !Array.isArray(replay.inputs) || !Number.isFinite(replay.until) || !Number.isFinite(replay.setup.seed))
    return 'That replay is incomplete.';
  return null;
}

export async function readReplayFile(file) {
  if (!file.name.toLowerCase().endsWith(REPLAY_EXT)) return null;
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is too large to be a replay.');
  let replay;
  try {
    replay = JSON.parse(await file.text());
  } catch {
    throw new Error('That replay could not be read.');
  }
  const why = validateReplay(replay);
  if (why) throw new Error(why);
  return replay;
}

export function startReplay(replay) {
  stageStart({ ...replay.setup, replay: { inputs: replay.inputs, checks: replay.checks || [], until: replay.until } });
}
