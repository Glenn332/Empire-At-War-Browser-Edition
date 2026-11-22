const SECONDS_KEPT = 900;
const SLOW_FRAME_MS = 33.4;
const VERY_SLOW_FRAME_MS = 50;

const seconds = [];
const intervals = new Float32Array(600);
let intervalCount = 0;
let intervalAt = 0;
let lastFrame = 0;
let current = null;
let started = false;
let hiddenChanges = 0;

function unitCount(game) {
  try {
    const units = game?.world?.units || game?.units;
    return Array.isArray(units) ? units.length : null;
  } catch {
    return null;
  }
}

function gameMode(game) {
  if (!game || game.setup?.attract) return 'menu';
  if (game.galactic) return 'galactic';
  if (game.landBattle) return 'land';
  return game.world ? 'space' : 'menu';
}

function bucketFor(now) {
  const second = Math.floor(now / 1000);
  if (current && current.second === second) return current;
  const game = window.game;
  current = {
    second,
    frames: 0,
    totalMs: 0,
    worstMs: 0,
    slow: 0,
    verySlow: 0,
    longTaskMs: 0,
    worstScript: null,
    mode: gameMode(game),
    units: unitCount(game),
    paused: !!game?.paused,
    speed: game?.speed ?? null,
    hidden: document.hidden
  };
  seconds.push(current);
  if (seconds.length > SECONDS_KEPT) seconds.shift();
  return current;
}

function onFrame(now) {
  requestAnimationFrame(onFrame);
  if (lastFrame && !document.hidden) {
    const interval = now - lastFrame;
    const bucket = bucketFor(now);
    bucket.frames++;
    bucket.totalMs += interval;
    if (interval > bucket.worstMs) bucket.worstMs = interval;
    if (interval > SLOW_FRAME_MS) bucket.slow++;
    if (interval > VERY_SLOW_FRAME_MS) bucket.verySlow++;
    intervals[intervalAt] = interval;
    intervalAt = (intervalAt + 1) % intervals.length;
    intervalCount = Math.min(intervals.length, intervalCount + 1);
  }
  lastFrame = now;
}

function observe(type, handle) {
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) handle(entry);
    }).observe({ type, buffered: false });
  } catch {}
}

export function startPerfSampler() {
  if (started || typeof requestAnimationFrame === 'undefined') return;
  started = true;
  requestAnimationFrame(onFrame);
  document.addEventListener('visibilitychange', () => {
    hiddenChanges++;
    lastFrame = 0;
  });
  observe('longtask', entry => (bucketFor(performance.now()).longTaskMs += entry.duration));
  observe('long-animation-frame', entry => {
    const top = (entry.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
    if (!top) return;
    const bucket = bucketFor(performance.now());
    const label = `${(top.sourceURL || '').split('/').pop()}:${top.sourceFunctionName || top.invoker || ''} ${Math.round(top.duration)}ms`;
    if (!bucket.worstScript || top.duration > bucket.worstScript.ms) bucket.worstScript = { ms: Math.round(top.duration), label };
  });
}

const percentile = (sorted, fraction) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] : 0);

export function recentFrames() {
  const list = Array.from(intervals.subarray(0, intervalCount)).sort((a, b) => a - b);
  if (!list.length) return null;
  const usual = percentile(list, 0.5);
  return {
    frames: list.length,
    usualMs: +usual.toFixed(1),
    usualFps: Math.round(1000 / usual),
    onePercentLowFps: Math.round(1000 / percentile(list, 0.99)),
    worstMs: Math.round(list[list.length - 1]),
    displayHz: Math.round(1000 / percentile(list, 0.05))
  };
}

export function perfTimeline() {
  return seconds.map(bucket => ({
    second: bucket.second,
    fps: bucket.frames,
    averageMs: bucket.frames ? +(bucket.totalMs / bucket.frames).toFixed(1) : null,
    worstMs: Math.round(bucket.worstMs),
    slowFrames: bucket.slow,
    verySlowFrames: bucket.verySlow,
    longTaskMs: Math.round(bucket.longTaskMs),
    worstScript: bucket.worstScript?.label || null,
    mode: bucket.mode,
    units: bucket.units,
    paused: bucket.paused,
    speed: bucket.speed,
    hidden: bucket.hidden
  }));
}

export function lastMinute() {
  const cutoff = Math.floor(performance.now() / 1000) - 60;
  const recent = seconds.filter(bucket => bucket.second >= cutoff && !bucket.hidden && bucket.frames);
  if (!recent.length) return null;
  const frames = recent.reduce((sum, bucket) => sum + bucket.frames, 0);
  return {
    seconds: recent.length,
    averageFps: Math.round(frames / recent.length),
    lowestFps: Math.min(...recent.map(bucket => bucket.frames)),
    verySlowFrames: recent.reduce((sum, bucket) => sum + bucket.verySlow, 0),
    longTaskMs: Math.round(recent.reduce((sum, bucket) => sum + bucket.longTaskMs, 0)),
    units: recent[recent.length - 1].units
  };
}

export const backgroundSwitches = () => hiddenChanges;
