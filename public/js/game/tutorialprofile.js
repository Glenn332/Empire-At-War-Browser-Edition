const PROFILE_KEY = 'swr-profile-finished-tutorials';
const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();

function read(storage) {
  try {
    const list = JSON.parse(storage?.getItem(PROFILE_KEY) || '[]');
    return new Set(Array.isArray(list) ? list.map(key) : []);
  } catch {
    return new Set();
  }
}

export function tutorialFinished(name, storage = globalThis.localStorage) {
  return read(storage).has(key(name));
}

export function finishTutorial(name, storage = globalThis.localStorage) {
  const set = read(storage);
  set.add(key(name));
  try {
    storage?.setItem(PROFILE_KEY, JSON.stringify([...set]));
  } catch {}
}
