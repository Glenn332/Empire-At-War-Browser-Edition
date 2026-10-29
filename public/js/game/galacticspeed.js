export const STRATEGIC_FRAMES = [10, 20, 30, 45, 60];
export const STRATEGIC_DEFAULT = 2;
const KEY = 'swr-strategic-game-speed';

export function strategicIndex() {
  try { const n = parseInt(localStorage.getItem(KEY), 10); if (n >= 0 && n < STRATEGIC_FRAMES.length) return n; } catch { }
  return STRATEGIC_DEFAULT;
}
export function saveStrategicIndex(index) { try { localStorage.setItem(KEY, String(index)); } catch { } }
export const strategicMultiplier = index => STRATEGIC_FRAMES[index] / 30;
export const strategicIndexOf = speed => { let best = STRATEGIC_DEFAULT; STRATEGIC_FRAMES.forEach((f, i) => { if (Math.abs(f / 30 - speed) < Math.abs(STRATEGIC_FRAMES[best] / 30 - speed)) best = i; }); return best; };
