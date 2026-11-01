export const STRATEGIC_FRAMES = [10, 20, 30, 45, 60];
export const STRATEGIC_DEFAULT = 2;
const KEY = 'swr-strategic-game-speed';

export function strategicIndex() {
  try {
    const n = parseInt(localStorage.getItem(KEY), 10);
    if (n >= 0 && n < STRATEGIC_FRAMES.length) return n;
  } catch {}
  return STRATEGIC_DEFAULT;
}
export function saveStrategicIndex(index) {
  try {
    localStorage.setItem(KEY, String(index));
  } catch {}
}
const TACTICAL_KEY = 'swr-tactical-game-speed';
export function tacticalSpeed() {
  try {
    const s = parseFloat(localStorage.getItem(TACTICAL_KEY));
    if (s >= 0.5 && s <= 2) return s;
  } catch {}
  return 1;
}
export function saveTacticalSpeed(speed) {
  try {
    localStorage.setItem(TACTICAL_KEY, String(speed));
  } catch {}
}
export const strategicMultiplier =index => STRATEGIC_FRAMES[index] / 30;
export const strategicIndexOf = speed => {
  let best = STRATEGIC_DEFAULT;
  STRATEGIC_FRAMES.forEach((f, i) => {
    if (Math.abs(f / 30 - speed) < Math.abs(STRATEGIC_FRAMES[best] / 30 - speed)) best = i;
  });
  return best;
};
