import { crc32 } from './enginehash.js';

const PLAYED_KEY = 'swr-profile-tutorials-played',
  OLD_FINISHED = 'swr-profile-finished-tutorials',
  OLD_SUGGESTED = 'swr-profile-suggested-tutorial';
const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const signed = n => n | 0;

export function tutorialsPlayed(storage = globalThis.localStorage) {
  try {
    let text = storage?.getItem(PLAYED_KEY);
    if (text == null) {
      const list = [];
      const old = JSON.parse(storage?.getItem(OLD_FINISHED) || '[]');
      if (Array.isArray(old)) for (const n of old) list.push(signed(crc32(key(n))));
      if (storage?.getItem(OLD_SUGGESTED) === '1') list.push(-1);
      text = list.join(',');
      if (list.length) storage?.setItem(PLAYED_KEY, text);
    }
    return String(text || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => parseInt(s, 10))
      .filter(n => !Number.isNaN(n));
  } catch {
    return [];
  }
}

function addPlayed(value, storage) {
  const list = tutorialsPlayed(storage);
  if (list.includes(value)) return;
  list.push(value);
  try {
    storage?.setItem(PLAYED_KEY, list.join(','));
  } catch {}
}

export function tutorialFinished(name, storage = globalThis.localStorage) {
  return tutorialsPlayed(storage).includes(signed(crc32(key(name))));
}

export function finishTutorial(name, storage = globalThis.localStorage) {
  addPlayed(signed(crc32(String(name ?? ''))), storage);
}

export function tutorialSuggestionDue(storage = globalThis.localStorage) {
  return tutorialsPlayed(storage).length === 0;
}

export function markTutorialSuggestion(storage = globalThis.localStorage) {
  addPlayed(-1, storage);
}
