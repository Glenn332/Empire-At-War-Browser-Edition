import { recentFrames, lastMinute, perfTimeline, backgroundSwitches } from './perfsampler.js';
import { processSnapshot, processStatsLines } from './procstats.js';

const PROFILE_MS = 3000;
const PROFILE_TOP = 30;
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/i;
const INTEGRATED_GPU = /intel|uhd|iris|radeon\(tm\) graphics|vega \d+ graphics|adreno|mali|apple m\d/i;

function threeRenderer(game) {
  const holder = game?.renderer;
  return holder?.renderer || holder || null;
}

function rendererKind(game, renderer) {
  if (!renderer) return 'none';
  if (renderer.isMirror) return renderer.webgpu ? 'WebGPU on the render thread' : 'WebGL on the render thread';
  if (renderer.isWebGLRenderer) return 'WebGL';
  if (game?.renderer?.gpu || renderer.device) return 'WebGPU';
  return 'unknown';
}

const DRAW_SAMPLE_MS = 500;

async function drawsPerFrame(renderer) {
  const info = renderer.info;
  if (!info?.render || typeof info.reset !== 'function') return null;
  const wasAuto = info.autoReset;
  let frames = 0,
    counting = true;
  const count = () => {
    if (!counting) return;
    frames++;
    requestAnimationFrame(count);
  };
  info.autoReset = false;
  info.reset();
  requestAnimationFrame(count);
  await new Promise(done => setTimeout(done, DRAW_SAMPLE_MS));
  counting = false;
  const calls = info.render.calls,
    triangles = info.render.triangles;
  info.autoReset = wasAuto;
  info.reset();
  if (frames < 2) return null;
  return { drawCalls: Math.round(calls / frames), triangles: Math.round(triangles / frames), framesSampled: frames };
}

export async function rendererSnapshot(game) {
  const renderer = threeRenderer(game);
  if (!renderer) return null;
  const canvas = renderer.domElement;
  const info = renderer.info || {};
  const ratio = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : null;
  const perFrame = await drawsPerFrame(renderer).catch(() => null);
  return {
    kind: rendererKind(game, renderer),
    canvas: canvas ? { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight } : null,
    pixelRatio: ratio,
    drawCalls: perFrame?.drawCalls ?? null,
    triangles: perFrame?.triangles ?? null,
    framesSampled: perFrame?.framesSampled ?? 0,
    programs: info.programs?.length ?? null,
    textures: info.memory?.textures ?? null,
    geometries: info.memory?.geometries ?? null,
    renderThreadMs: renderer.workN ? +(renderer.workMs / renderer.workN).toFixed(2) : null
  };
}

function threadSnapshot(game) {
  const stats = game?.mirror?.stats;
  if (!stats) return null;
  return {
    battleThreadStepMs: stats.stepMs ? +stats.stepMs.toFixed(2) : null,
    battleThreadPhasesMs: stats.stepPhases ? Object.fromEntries(Object.entries(stats.stepPhases).map(([phase, ms]) => [phase, +ms.toFixed(2)])) : null,
    applyMsPerStep: stats.records ? +(stats.applyMs / stats.records).toFixed(2) : null,
    jobs: stats.jobs || null
  };
}

function summarizeProfile(trace, ms) {
  const frames = trace.frames || [],
    stacks = trace.stacks || [],
    resources = trace.resources || [];
  const label = frameId => {
    const frame = frames[frameId];
    if (!frame) return '(unknown)';
    const file = frame.resourceId !== undefined ? (resources[frame.resourceId] || '').split('/').pop().split('?')[0] : '';
    return `${frame.name || '(anonymous)'}${file ? ` ${file}:${frame.line ?? '?'}` : ''}`;
  };
  const self = new Map(),
    total = new Map();
  let busy = 0;
  for (const sample of trace.samples || []) {
    if (sample.stackId === undefined) continue;
    busy++;
    const seen = new Set();
    let stackId = sample.stackId,
      top = true;
    while (stackId !== undefined) {
      const stack = stacks[stackId];
      if (!stack) break;
      const name = label(stack.frameId);
      if (top) self.set(name, (self.get(name) || 0) + 1);
      top = false;
      if (!seen.has(name)) {
        seen.add(name);
        total.set(name, (total.get(name) || 0) + 1);
      }
      stackId = stack.parentId;
    }
  }
  const samples = (trace.samples || []).length;
  const rank = map =>
    [...map]
      .sort((a, b) => b[1] - a[1])
      .slice(0, PROFILE_TOP)
      .map(([name, count]) => ({ name, percent: +((count / Math.max(1, samples)) * 100).toFixed(1) }));
  return { ms, samples, busyPercent: +((busy / Math.max(1, samples)) * 100).toFixed(1), self: rank(self), total: rank(total) };
}

export async function cpuProfile(game) {
  if (typeof Profiler === 'undefined') return { why: 'the browser does not allow profiling on this page' };
  if (game && (game.paused || game.menus?.open)) return { why: 'the game was paused; press Ctrl+Shift+B while the slowdown happens to include one' };
  let profiler;
  try {
    profiler = new Profiler({ sampleInterval: 2, maxBufferSize: 30000 });
  } catch (error) {
    return { why: `profiling was refused (${error.message || error})` };
  }
  await new Promise(done => setTimeout(done, PROFILE_MS));
  try {
    return { profile: summarizeProfile(await profiler.stop(), PROFILE_MS) };
  } catch (error) {
    return { why: String(error.message || error) };
  }
}

export function profileText(result) {
  if (!result?.profile) return `No CPU profile: ${result?.why || 'not taken'}\n`;
  const { profile } = result;
  const lines = [
    `Main thread CPU profile over ${profile.ms / 1000} s: ${profile.samples} samples, busy ${profile.busyPercent}% of the time`,
    '',
    'Own time (where the time is spent):',
    ...profile.self.map(entry => `  ${String(entry.percent).padStart(5)}%  ${entry.name}`),
    '',
    'Including what each function calls:',
    ...profile.total.map(entry => `  ${String(entry.percent).padStart(5)}%  ${entry.name}`)
  ];
  return lines.join('\n') + '\n';
}

async function stageAverages() {
  try {
    const { diag } = await import('./diag.js');
    const report = diag.report(true);
    return { stages: report.averageStageMs, gpu: report.gpu, hitches: report.hitches, byCause: report.byCause, missed: report.missedRefreshes, full: report };
  } catch {
    return null;
  }
}

async function graphicsSettings() {
  try {
    const { gfx, pixelRatio, supersampling } = await import('./gfx.js');
    return { ...gfx, effectivePixelRatio: +pixelRatio().toFixed(2), supersampling: supersampling() };
  } catch {
    return null;
  }
}

export async function collectPerformance(game) {
  const [stages, settings, renderer, processes] = await Promise.all([
    stageAverages(),
    graphicsSettings(),
    rendererSnapshot(game),
    processSnapshot().catch(() => null)
  ]);
  return {
    frames: recentFrames(),
    lastMinute: lastMinute(),
    renderer,
    threads: threadSnapshot(game),
    stages,
    settings,
    // what the game's processes use now, and over the last benchmark run when there was one
    processes,
    benchmarkProcesses: globalThis.benchmarkResult?.processes || null,
    backgroundSwitches: backgroundSwitches(),
    timeline: perfTimeline()
  };
}

export function performanceWarnings(performance, system, power) {
  const out = [];
  const gpuName = system?.webgl?.renderer || '';
  if (SOFTWARE_RENDERER.test(gpuName)) out.push('the browser draws without the graphics card (software rendering): turn on hardware acceleration');
  const webgpu = system?.webgpu;
  if (webgpu?.twoGpus && INTEGRATED_GPU.test(gpuName)) out.push('the game is drawn on the built-in GPU although a faster one is present');
  else if (INTEGRATED_GPU.test(gpuName)) out.push('drawn on a built-in (integrated) GPU');
  if (power?.batterySaver) out.push('Windows battery saver is on');
  if (power?.pluggedIn === false) out.push('running on battery');
  else if (system?.battery && !system.battery.charging) out.push('running on battery');
  for (const preference of power?.gpuPreferences || []) if (preference.gpu === 'power saving') out.push(`Windows is set to use the power-saving GPU for ${preference.program}`);
  const mode = power ? (power.pluggedIn === false ? power.powerModeOnBattery : power.powerModePluggedIn) : null;
  if (mode === 'best power efficiency') out.push('Windows power mode is best power efficiency');
  const frames = performance?.frames;
  if (frames && frames.usualFps <= 31 && frames.displayHz <= 31) out.push('the frame rate sits at 30: the display or browser may be limited to 30 Hz');
  if ((performance?.backgroundSwitches || 0) > 4) out.push(`the game went to the background ${performance.backgroundSwitches} times (browsers slow background tabs)`);
  const settings = performance?.settings;
  if (settings && settings.supersampling > 1) out.push(`supersampling is ${settings.supersampling}x`);
  const canvas = performance?.renderer?.canvas;
  if (canvas && canvas.width * canvas.height > 8.5e6) out.push(`the game draws ${canvas.width}x${canvas.height} pixels`);
  if (system?.cores && system.cores <= 4) out.push(`only ${system.cores} CPU threads`);
  if (system?.deviceMemoryGB && system.deviceMemoryGB <= 4) out.push(`about ${system.deviceMemoryGB} GB memory reported`);
  const heap = system?.heapMB;
  if (heap?.used && heap?.limit && heap.used > heap.limit * 0.8) out.push('the page is close to its memory limit');
  return out;
}

export function performanceLines(performance, warnings, profileResult) {
  const lines = [];
  const frames = performance?.frames;
  if (frames)
    lines.push(
      `  Frames: usually ${frames.usualFps} fps (${frames.usualMs} ms), 1% low ${frames.onePercentLowFps} fps, worst ${frames.worstMs} ms; display about ${frames.displayHz} Hz`
    );
  const minute = performance?.lastMinute;
  if (minute)
    lines.push(
      `  Last minute: ${minute.averageFps} fps average, lowest second ${minute.lowestFps} fps, ${minute.verySlowFrames} frames over 50 ms, long tasks ${minute.longTaskMs} ms${minute.units != null ? `, ${minute.units} units` : ''}`
    );
  const renderer = performance?.renderer;
  if (renderer)
    lines.push(
      `  Renderer: ${renderer.kind}${renderer.canvas ? `, ${renderer.canvas.width}x${renderer.canvas.height} pixels` : ''}${renderer.pixelRatio ? ` (${renderer.pixelRatio.toFixed(2)}x)` : ''}${renderer.drawCalls != null ? `, ${renderer.drawCalls} draw calls` : ''}${renderer.triangles != null ? `, ${Math.round(renderer.triangles / 1000)}k triangles` : ''}${renderer.renderThreadMs != null ? `, render thread ${renderer.renderThreadMs} ms per frame` : ''}`
    );
  const threads = performance?.threads;
  if (threads?.battleThreadStepMs != null) {
    const phases = threads.battleThreadPhasesMs;
    const split = phases ? ` (${Object.entries(phases).map(([phase, ms]) => `${phase} ${ms}`).join(', ')})` : '';
    lines.push(`  Battle thread: ${threads.battleThreadStepMs} ms per step${split}`);
  }
  const stages = performance?.stages;
  if (stages?.stages && Object.keys(stages.stages).length)
    lines.push(`  Main thread per frame (ms): ${Object.entries(stages.stages).map(([name, ms]) => `${name} ${ms}`).join(', ')}`);
  if (stages?.gpu && typeof stages.gpu === 'object') lines.push(`  GPU time: ${stages.gpu.averageMs} ms average, worst ${stages.gpu.worstMs} ms`);
  const settings = performance?.settings;
  if (settings)
    lines.push(
      `  Graphics: shaders ${settings.shader}, shadows ${settings.shadows ? settings.shadow : 'off'}, resolution scale ${settings.scale}, supersampling ${settings.supersampling}x, anti-aliasing ${settings.aa ? 'on' : 'off'}, particles ${settings.particle}`
    );
  lines.push(...processStatsLines(performance?.processes, '  ', 'Processes now'));
  lines.push(...processStatsLines(performance?.benchmarkProcesses, '  ', 'Processes during the last benchmark'));
  lines.push(`  CPU profile: ${profileResult?.profile ? 'included (profile.txt)' : profileResult?.why || 'not taken'}`);
  lines.push(`  Possible causes: ${warnings.length ? warnings.join('; ') : 'none spotted'}`);
  return lines;
}
