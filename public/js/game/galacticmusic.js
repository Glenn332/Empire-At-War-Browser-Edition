import { db } from '../gamedata.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
export const MUSIC_STRATEGIC = 1,
  MUSIC_SCRIPT = 12;
const KEEP = (1 << 1) | (1 << 8) | (1 << 11) | (1 << 12);

export function strategicMusicEvent(game) {
  return db.music.get(key(db.faction(game.me)?.str('Strategic_Map_Music_Event'))) || null;
}

export function startStrategicMusic(game, force = false) {
  const audio = game.audio;
  if (!audio?.playMusicEvent || game.modeSuspended || game.over) return false;
  if (!force && audio.musicMode >= 0 && (KEEP >> audio.musicMode) & 1) return false;
  const event = strategicMusicEvent(game);
  return event ? audio.playMusicEvent(event, MUSIC_STRATEGIC) : false;
}

export function playScriptMusic(game, name) {
  const event = db.music.get(key(name));
  return event && game.audio?.playMusicEvent ? game.audio.playMusicEvent(event, MUSIC_SCRIPT) : false;
}
