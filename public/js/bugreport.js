import { BUILD } from './build.js';
import { inApp } from './platform.js';
import { makeZip } from './zipwriter.js';

const SETTINGS_SKIPPED = new Set(['swr.lobby', 'swr.mpname']);
const MAX_SETTING_LENGTH = 4000;
const MAX_SCREEN_TEXT = 40000;
const SAVE_TIMEOUT_MS = 10000;
const WORKER_TIMEOUT_MS = 4000;

const pause = ms => new Promise(done => setTimeout(done, ms));

const withTimeout = (promise, ms, fallback = null) => Promise.race([Promise.resolve(promise).catch(() => fallback), pause(ms).then(() => fallback)]);

const nextFrame = () => new Promise(done => {
  const timer = setTimeout(done, 120);
  requestAnimationFrame(() => {
    clearTimeout(timer);
    done();
  });
});

export function redactPaths(text) {
  return text
    .replace(/([A-Za-z]:[\\/]{1,2}(?:Users|Documents and Settings)[\\/]{1,2})[^\\/"'\s<>|]+/gi, '$1<user>')
    .replace(/(\/(?:home|Users)\/)[^/"'\s<>|]+/g, '$1<user>');
}

function safeJson(value, { depth = 8, maxArray = 2000 } = {}) {
  const seen = new WeakSet();
  const walk = (item, level) => {
    if (item === null || item === undefined) return item ?? null;
    const kind = typeof item;
    if (kind === 'number') return Number.isFinite(item) ? item : String(item);
    if (kind === 'string' || kind === 'boolean') return item;
    if (kind === 'bigint') return String(item);
    if (kind === 'function' || kind === 'symbol') return undefined;
    if (item instanceof Error) return { error: item.name, message: item.message, stack: item.stack };
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return `[${item.constructor.name} of ${item.byteLength} bytes]`;
    if (typeof Element !== 'undefined' && item instanceof Element) return `<${item.tagName.toLowerCase()}>`;
    if (seen.has(item)) return '[circular]';
    if (level >= depth) return Array.isArray(item) ? `[array of ${item.length}]` : '[object]';
    seen.add(item);
    if (item instanceof Map) return { map: walk([...item].slice(0, maxArray), level + 1) };
    if (item instanceof Set) return { set: walk([...item].slice(0, maxArray), level + 1) };
    if (Array.isArray(item)) {
      const out = item.slice(0, maxArray).map(entry => walk(entry, level + 1) ?? null);
      if (item.length > maxArray) out.push(`... ${item.length - maxArray} more`);
      return out;
    }
    const out = {};
    for (const key of Object.keys(item)) {
      let entry;
      try {
        entry = item[key];
      } catch {
        continue;
      }
      const shown = walk(entry, level + 1);
      if (shown !== undefined) out[key] = shown;
    }
    return out;
  };
  return JSON.stringify(walk(value, 0), null, 1);
}

function consoleText() {
  const log = window.swrConsoleLog;
  if (!log) return 'The console recorder was not running on this page.\n';
  const lines = [];
  if (log.dropped) lines.push(`(${log.dropped} older entries were dropped)`);
  for (const entry of log.entries) {
    const clock = new Date(entry.time).toISOString().slice(11, 23);
    const since = (entry.at / 1000).toFixed(3).padStart(9);
    const repeats = entry.repeats > 1 ? ` (x${entry.repeats})` : '';
    lines.push(`${clock} +${since}s ${entry.level.toUpperCase().padEnd(5)} ${entry.text}${repeats}`);
  }
  return lines.join('\n') + '\n';
}

function problemLines(limit) {
  const entries = window.swrConsoleLog?.entries || [];
  return entries
    .filter(entry => entry.level === 'error' || entry.level === 'warn')
    .slice(-limit)
    .map(entry => `${entry.level.toUpperCase()}: ${entry.text.split('\n').slice(0, 4).join('\n    ')}`);
}

function webglInfo() {
  try {
    const canvas = document.createElement('canvas');
    const options = { powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
    if (!gl) return { available: false };
    const details = gl.getExtension('WEBGL_debug_renderer_info');
    const info = {
      available: true,
      version: gl.getParameter(gl.VERSION),
      vendor: details ? gl.getParameter(details.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: details ? gl.getParameter(details.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      extensions: gl.getSupportedExtensions()
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return info;
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

async function webgpuAdapter(powerPreference) {
  try {
    const adapter = await withTimeout(navigator.gpu.requestAdapter({ powerPreference }), 3000);
    if (!adapter) return null;
    const info = adapter.info || {};
    return {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      fallback: !!(info.isFallbackAdapter ?? adapter.isFallbackAdapter),
      features: [...adapter.features]
    };
  } catch (error) {
    return { error: String(error) };
  }
}

const adapterName = adapter => (adapter ? [adapter.vendor, adapter.architecture, adapter.description].filter(Boolean).join(' ') || 'unnamed' : 'none');

async function webgpuInfo() {
  if (!navigator.gpu) return { available: false };
  const [highPerformance, lowPower] = await Promise.all([webgpuAdapter('high-performance'), webgpuAdapter('low-power')]);
  return {
    available: true,
    highPerformance,
    lowPower,
    twoGpus: !!(highPerformance && lowPower && adapterName(highPerformance) !== adapterName(lowPower))
  };
}

async function batteryInfo() {
  try {
    const battery = await withTimeout(navigator.getBattery?.(), 2000);
    if (!battery) return null;
    return { charging: battery.charging, level: Math.round(battery.level * 100) };
  } catch {
    return null;
  }
}

async function systemInfo() {
  const memory = performance.memory;
  const storage = await withTimeout(navigator.storage?.estimate?.(), 2000);
  const highEntropy = await withTimeout(
    navigator.userAgentData?.getHighEntropyValues?.(['platformVersion', 'architecture', 'bitness', 'fullVersionList']),
    2000
  );
  return {
    userAgent: navigator.userAgent,
    userAgentData: highEntropy || navigator.userAgentData || null,
    platform: navigator.platform,
    languages: navigator.languages,
    cores: navigator.hardwareConcurrency,
    deviceMemoryGB: navigator.deviceMemory ?? null,
    screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, colorDepth: screen.colorDepth },
    window: { width: innerWidth, height: innerHeight, devicePixelRatio, fullscreen: !!document.fullscreenElement, visible: document.visibilityState },
    heapMB: memory ? { used: Math.round(memory.usedJSHeapSize / 1048576), limit: Math.round(memory.jsHeapSizeLimit / 1048576) } : null,
    storageMB: storage ? { used: Math.round((storage.usage || 0) / 1048576), quota: Math.round((storage.quota || 0) / 1048576) } : null,
    features: {
      crossOriginIsolated: self.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      fileSystemAccess: 'showDirectoryPicker' in window,
      compressionStream: typeof CompressionStream !== 'undefined',
      webAssembly: typeof WebAssembly !== 'undefined'
    },
    webgl: webglInfo(),
    webgpu: await webgpuInfo(),
    battery: await batteryInfo(),
    uptimeSeconds: Math.round(performance.now() / 1000)
  };
}

async function appInfo() {
  if (!inApp()) return null;
  const readJson = async url => {
    try {
      const response = await fetch(url);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
  const [app, setup, localMods, power] = await Promise.all([readJson('api/app'), readJson('api/setup'), readJson('api/localmods'), readJson('api/power')]);
  return { app, setup, localMods, power };
}

async function contentInfo() {
  const out = {};
  try {
    const content = await import('./content.js');
    out.running = await withTimeout(content.loadContent(), 4000);
    out.description = content.describeContent(out.running);
  } catch {}
  try {
    out.graphics = { ...(await import('./gfx.js')).gfx };
  } catch {}
  return out;
}

function storedSettings() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('swr') || SETTINGS_SKIPPED.has(key)) continue;
      const value = localStorage.getItem(key) || '';
      out[key] = value.length > MAX_SETTING_LENGTH ? `[${value.length} characters]` : value;
    }
  } catch {}
  return out;
}

const shortLabel = value => (value && typeof value === 'object' ? (value.name ?? value.id ?? '[object]') : value);

function plainFields(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value === null || typeof value !== 'object' || Array.isArray(value)));
}

function gameMode(game) {
  if (!game || game.setup?.attract) return 'menu';
  if (game.galactic) return 'galactic';
  if (game.landBattle) return 'land';
  if (game.world) return 'space';
  return 'menu';
}

function gameState(game) {
  if (!game || game.setup?.attract) return { mode: 'menu' };
  const world = game.world;
  const players = (world?.players || []).map(player => ({
    id: player.id,
    name: player.name,
    faction: shortLabel(player.faction),
    team: shortLabel(player.team),
    human: player.human,
    credits: typeof player.credits === 'number' ? Math.round(player.credits) : undefined,
    defeated: player.defeated || player.dead || undefined
  }));
  return {
    mode: gameMode(game),
    setup: game.setup ? { ...game.setup, net: game.setup.net ? plainFields(game.setup.net) : undefined } : null,
    paused: !!game.paused,
    over: !!game.over,
    speed: game.speed,
    time: world?.time ?? game.galaxy?.time ?? null,
    units: world?.units ? world.units.filter(unit => !unit.dead).length : undefined,
    squads: world?.squads ? world.squads.filter(squad => !squad.dead).length : undefined,
    players: players.length ? players : undefined,
    battleWorker: !!game.mirror?.worker,
    openDialogs: document.querySelectorAll('.dlg-veil').length
  };
}

async function multiplayerInfo(game) {
  const lock = game?.lock;
  const reports = window.desyncReports || [];
  if (!lock && !reports.length) return null;
  const out = { reports: reports.map(report => report.text) };
  if (lock) {
    out.lockstep = {
      me: lock.me,
      host: lock.host,
      epoch: lock.epoch,
      tick: lock.tick,
      started: lock.started,
      desynced: !!lock.desynced,
      lost: !!lock.lost,
      peers: lock.peers,
      gone: [...(lock.gone || [])],
      players: Object.fromEntries([...(lock.playerOf || [])].map(([peer, player]) => [peer, lock.player?.(player)?.name || player])),
      stats: (() => {
        try {
          return lock.netStats(game.stepSec || 1 / 30);
        } catch {
          return null;
        }
      })(),
      stalls: (() => {
        try {
          return lock.stalls?.report(true);
        } catch {
          return null;
        }
      })(),
      recentHashes: Object.fromEntries(lock.hashes || []),
      hashLog: lock.log,
      orders: lock.orderLog,
      reportText: lock.reportText || null
    };
    out.unitsNow = await currentUnits(game, lock);
  }
  return out;
}

async function currentUnits(game, lock) {
  try {
    if (game.mirror?.worker && game.mirror.diag) return await withTimeout(game.mirror.diag(lock.tick), WORKER_TIMEOUT_MS);
    if (game.world) {
      const { unitDetail } = await import('./game/desyncreport.js');
      return { units: unitDetail(game.world) };
    }
  } catch (error) {
    return { failed: String(error) };
  }
  return null;
}

async function performanceInfo() {
  try {
    const { diag } = await import('./diag.js');
    return diag.report(true);
  } catch (error) {
    return { failed: String(error) };
  }
}

async function saveGameFile(game) {
  if (!game || gameMode(game) === 'menu' || game.tacticalCinematics?.on) return null;
  try {
    const { snapshotNow } = await import('./game/savegame.js');
    const snapshot = await withTimeout(snapshotNow(game, 'Bug report'), SAVE_TIMEOUT_MS);
    return snapshot ? JSON.stringify(snapshot) : null;
  } catch (error) {
    console.warn('[bug report] the game could not be saved', error);
    return null;
  }
}

function visibleText() {
  const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > MAX_SCREEN_TEXT ? text.slice(0, MAX_SCREEN_TEXT) + '\n...' : text;
}

async function appScreenshot() {
  try {
    const response = await fetch('api/screenshot', { cache: 'no-store' });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function requestTabCapture() {
  if (inApp() || !navigator.mediaDevices?.getDisplayMedia) return null;
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: 5 },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude'
    });
  } catch {
    return null;
  }
}

async function frameFromStream(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await withTimeout(video.play(), 3000);
    await withTimeout(
      new Promise(done => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(() => done()) : video.addEventListener('loadeddata', done, { once: true }))),
      3000
    );
    await pause(200);
    if (!video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise(done => canvas.toBlob(done, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  }
}

async function captureScreen(tabCapture, hideDuringCapture) {
  const hidden = hideDuringCapture.filter(Boolean).map(element => [element, element.style.visibility]);
  for (const [element] of hidden) element.style.visibility = 'hidden';
  try {
    await nextFrame();
    await nextFrame();
    const screenText = visibleText();
    const picture = inApp() ? await appScreenshot() : tabCapture ? await frameFromStream(tabCapture) : null;
    return { picture, screenText };
  } finally {
    for (const [element, visibility] of hidden) element.style.visibility = visibility;
    if (tabCapture) for (const track of tabCapture.getTracks()) track.stop();
  }
}

function gpuLine(webgpu) {
  if (!webgpu?.available) return 'not available';
  if (webgpu.twoGpus) return `two GPUs: high performance ${adapterName(webgpu.highPerformance)}, power saving ${adapterName(webgpu.lowPower)}`;
  return adapterName(webgpu.highPerformance);
}

function powerLine(battery, power) {
  const parts = [];
  if (power?.hasBattery === false) parts.push('no battery');
  else if (power && power.pluggedIn != null) parts.push(power.pluggedIn ? 'plugged in' : `on battery${power.batteryPercent != null ? ' ' + power.batteryPercent + '%' : ''}`);
  else if (battery) parts.push(battery.charging ? (battery.level >= 100 ? 'plugged in or no battery' : `charging ${battery.level}%`) : `on battery ${battery.level}%`);
  else parts.push('battery not reported');
  if (power?.batterySaver) parts.push('battery saver on');
  const mode = power ? (power.pluggedIn === false ? power.powerModeOnBattery : power.powerModePluggedIn) : null;
  if (mode) parts.push(`Windows power mode ${mode}`);
  for (const preference of power?.gpuPreferences || [])
    if (preference.gpu !== 'not set') parts.push(`${preference.program === 'DirectXUserGlobalSettings' ? 'default' : preference.program} GPU setting ${preference.gpu}`);
  return parts.join(', ');
}

function stamp(date) {
  const two = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}_${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}`;
}

function summaryText({ created, game, system, app, content, multiplayer, picture, save }) {
  const state = gameState(game);
  const lines = [
    'Empire at War Browser Edition - bug report',
    `Created: ${created.toISOString()}`,
    `Build: ${BUILD}${app?.app?.version ? `  app ${app.app.version}` : ''}  (${inApp() ? 'desktop app' : 'browser'})`,
    `Page: ${location.pathname}${location.search}`,
    `Browser: ${system.userAgent}`,
    `GPU: ${system.webgl.renderer || 'unknown'}`,
    `WebGPU: ${gpuLine(system.webgpu)}`,
    `Power: ${powerLine(system.battery, app?.power)}`,
    `Window: ${system.window.width}x${system.window.height} at ${system.window.devicePixelRatio}x, screen ${system.screen.width}x${system.screen.height}`,
    `Game and mods: ${content.description || 'not recorded'}`,
    `Mode: ${state.mode}${state.setup?.mapFile || state.setup?.map ? `  map ${state.setup.mapFile || state.setup.map}` : ''}${state.time != null ? `  game time ${Number(state.time).toFixed(1)}` : ''}${state.paused ? '  paused' : ''}${state.over ? '  over' : ''}`,
    `Multiplayer: ${multiplayer ? (multiplayer.lockstep ? `yes, ${multiplayer.lockstep.host ? 'host' : 'client'}, turn ${multiplayer.lockstep.tick}${multiplayer.lockstep.desynced ? ', DESYNCED' : ''}` : 'no game, earlier desync reports kept') : 'no'}`,
    `Desync reports: ${multiplayer?.reports?.length || 0}`,
    `Console: ${Object.entries(window.swrConsoleLog?.counts || {}).map(([level, count]) => `${count} ${level}`).join(', ') || 'not recorded'}`,
    `Screenshot: ${picture ? 'included' : 'not included (screen capture was declined or is not available)'}`,
    `Save game: ${save ? 'included (savegame.swrsave, load it from Load Game)' : 'not included'}`,
    '',
    'Last warnings and errors:',
    ...(problemLines(25).length ? problemLines(25) : ['  none'])
  ];
  return lines.join('\n') + '\n';
}

export async function createBugReport({ game = window.game, hideDuringCapture = [], tabCapture = null } = {}) {
  const created = new Date();
  const { picture, screenText } = await captureScreen(tabCapture, hideDuringCapture);
  const [system, app, content, multiplayer, performanceReport, save] = await Promise.all([
    systemInfo(),
    appInfo(),
    contentInfo(),
    multiplayerInfo(game),
    performanceInfo(),
    saveGameFile(game)
  ]);
  const files = [
    { name: 'report.txt', data: summaryText({ created, game, system, app, content, multiplayer, picture, save }) },
    { name: 'console.txt', data: consoleText() },
    { name: 'screen.txt', data: screenText + '\n' },
    { name: 'system.json', data: safeJson({ ...system, app }) },
    { name: 'settings.json', data: safeJson({ content, stored: storedSettings() }) },
    { name: 'game.json', data: safeJson(gameState(game)) },
    { name: 'performance.json', data: safeJson(performanceReport) }
  ];
  if (multiplayer) {
    files.push({ name: 'multiplayer.json', data: safeJson(multiplayer, { depth: 10, maxArray: 20000 }) });
    multiplayer.reports.forEach((text, i) => files.push({ name: `desync-${i + 1}.txt`, data: text + '\n' }));
    (window.desyncReports || []).forEach((report, i) => {
      if (report.raw) files.push({ name: `desync-${i + 1}-data.json`, data: safeJson(report.raw, { depth: 12, maxArray: 20000 }) });
    });
  }
  for (const file of files) if (typeof file.data === 'string') file.data = redactPaths(file.data);
  if (save) files.push({ name: 'savegame.swrsave', data: save });
  if (picture) files.push({ name: 'screenshot.png', data: picture });
  return { name: `eaw-bug-report_${stamp(created)}.zip`, blob: await makeZip(files, created), picture: !!picture };
}

async function saveInApp(name, blob) {
  const response = await fetch('api/save-report?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
  if (!response.ok) throw new Error(await response.text());
  const { path } = await response.json();
  return path ? { saved: true, where: path } : { saved: false };
}

function saveInBrowser(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { saved: true, where: null };
}

export async function saveBugReport(options = {}) {
  const report = await createBugReport(options);
  const result = inApp() ? await saveInApp(report.name, report.blob) : saveInBrowser(report.name, report.blob);
  console.info('[bug report]', result.saved ? `saved ${result.where || report.name} (${Math.round(report.blob.size / 1024)} KB)` : 'not saved');
  return { ...result, name: report.name, picture: report.picture };
}

if (typeof window !== 'undefined') window.bugReport = (options = {}) => saveBugReport(options);
